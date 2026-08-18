import Ajv, { type ValidateFunction } from 'ajv'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import { type NativeCommand, nativeCommand } from '../core/platform.ts'
import { toolDetail } from '../core/tool-detail.ts'
import type {
  SubprocessHandle,
  SubprocessRuntime,
} from '@deepseek-ai/dsh-subprocess'
import agentMessageDeltaSchema from '../../generated/codex/0.147.0/schema/v2/AgentMessageDeltaNotification.json'
import commandApprovalSchema from '../../generated/codex/0.147.0/schema/CommandExecutionRequestApprovalParams.json'
import fileApprovalSchema from '../../generated/codex/0.147.0/schema/FileChangeRequestApprovalParams.json'
import itemCompletedSchema from '../../generated/codex/0.147.0/schema/v2/ItemCompletedNotification.json'
import itemStartedSchema from '../../generated/codex/0.147.0/schema/v2/ItemStartedNotification.json'
import reasoningDeltaSchema from '../../generated/codex/0.147.0/schema/v2/ReasoningSummaryTextDeltaNotification.json'
import turnCompletedSchema from '../../generated/codex/0.147.0/schema/v2/TurnCompletedNotification.json'
import userInputSchema from '../../generated/codex/0.147.0/schema/ToolRequestUserInputParams.json'
import mcpElicitationSchema from '../../generated/codex/0.147.0/schema/McpServerElicitationRequestParams.json'
import permissionsApprovalSchema from '../../generated/codex/0.147.0/schema/PermissionsRequestApprovalParams.json'
import { BridgeError } from '../core/errors.ts'
import type {
  NativeProviderAdapter,
  ProviderInteractionResolution,
  ProviderTurnHooks,
  ProviderTurnRequest,
} from '../core/provider.ts'
import { redactText, redactValue } from '../core/redaction.ts'
import type {
  BridgeCompletion,
  BridgeCompletionsResult,
  BridgeModel,
  BridgeModelsResult,
  BridgeNativeSession,
  BridgeNativeSessionsResult,
  BridgePermissionMode,
  BridgeQuestion,
  BridgeToolDetail,
} from '../types.ts'

type JsonObject = Record<string, unknown>

interface CodexThread {
  readonly id: string
}

interface CodexTurn {
  readonly id: string
  readonly status: 'completed' | 'interrupted' | 'failed' | 'inProgress'
  readonly error: JsonObject | null
}

interface CommandExecutionRequestApprovalParams {
  readonly threadId: string
  readonly turnId: string
  readonly reason?: string | null
  readonly command?: string | null
  readonly cwd?: string | null
}

interface FileChangeRequestApprovalParams {
  readonly threadId: string
  readonly turnId: string
  readonly reason?: string | null
  readonly grantRoot?: string | null
}

interface PermissionsRequestApprovalParams {
  readonly threadId: string
  readonly turnId: string
  readonly reason: string | null
  readonly cwd: string
  readonly permissions: {
    readonly network: JsonObject | null
    readonly fileSystem: JsonObject | null
  }
}

interface ToolRequestUserInputParams {
  readonly threadId: string
  readonly turnId: string
  readonly questions: readonly {
    readonly id: string
    readonly header: string
    readonly question: string
    readonly isOther: boolean
    readonly isSecret: boolean
    readonly options: readonly { readonly label: string; readonly description: string }[] | null
  }[]
}

type McpServerElicitationRequestParams = {
  readonly threadId: string
  readonly turnId: string | null
  readonly serverName: string
  readonly message: string
} & (
  | { readonly mode: 'url'; readonly url: string; readonly elicitationId: string }
  | { readonly mode: 'form' | 'openai/form'; readonly requestedSchema: JsonObject }
)

interface ItemNotification {
  readonly threadId: string
  readonly turnId: string
  readonly item: JsonObject
}

interface CodexConnection {
  readonly epoch: number
  readonly child: SubprocessHandle
  readonly transport: JsonRpcLineTransport
  closing: boolean
}

interface CodexSessionState {
  readonly bridgeSessionId: string
  threadId: string | null
  attachedEpoch: number
  activeTurnId: string | null
  pendingTurnId: string | null
  hooks: ProviderTurnHooks | null
  completion: PromiseWithResolvers<CodexTurn> | null
  earlyCompleted: CodexTurn | null
  readonly itemNames: Map<string, string>
}

const ajv = new Ajv({ allErrors: true, strict: false })
const validators = new Map<string, ValidateFunction>([
  ['item/agentMessage/delta', ajv.compile(agentMessageDeltaSchema)],
  ['item/reasoning/summaryTextDelta', ajv.compile(reasoningDeltaSchema)],
  ['item/started', ajv.compile(itemStartedSchema)],
  ['item/completed', ajv.compile(itemCompletedSchema)],
  ['turn/completed', ajv.compile(turnCompletedSchema)],
  ['item/commandExecution/requestApproval', ajv.compile(commandApprovalSchema)],
  ['item/fileChange/requestApproval', ajv.compile(fileApprovalSchema)],
  ['item/permissions/requestApproval', ajv.compile(permissionsApprovalSchema)],
  ['item/tool/requestUserInput', ajv.compile(userInputSchema)],
  ['mcpServer/elicitation/request', ajv.compile(mcpElicitationSchema)],
])

function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BridgeError('PROVIDER_PROTOCOL_ERROR', `Codex returned an invalid ${label}.`)
  }
  return value as JsonObject
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new BridgeError('PROVIDER_PROTOCOL_ERROR', `Codex returned an invalid ${label}.`)
  }
  return value
}

function validate<T>(method: string, params: JsonObject): T {
  const validator = validators.get(method)
  if (validator !== undefined && !validator(params)) {
    throw new BridgeError('PROVIDER_PROTOCOL_ERROR', `Codex returned an invalid ${method} payload.`)
  }
  return params as T
}

/** Environment variable carrying the executable path for the Windows spawn. */
const CODEX_EXECUTABLE_ENV = 'DSH_LOCAL_AGENT_CODEX_EXECUTABLE'

/** How many native threads to offer for resumption; see the Claude adapter's note. */
const NATIVE_SESSION_LIMIT = 30

/**
 * Models requested at most. The product ships a handful; a ceiling keeps a
 * misbehaving reply from filling a picker.
 */
const MODEL_LIMIT = 32

/**
 * Bridge permission mode to Codex's approval policy.
 *
 * Only the three modes Codex can honour through this one setting. Two are
 * deliberately absent rather than approximated:
 *
 * `acceptEdits` has no equivalent — Codex has no "auto-accept file edits but
 * still ask before commands" policy, and mapping it to anything else would obey
 * a different rule than the operator chose.
 *
 * `plan` exists in Codex only as a collaboration mode, whose payload requires a
 * model and, per the protocol, takes precedence over the model, reasoning effort
 * and developer instructions the operator configured on the Host. Silently
 * overriding all three to set a permission mode is not a trade worth making.
 *
 * `never` genuinely stops Codex asking, so the browser is never prompted.
 */
const CODEX_APPROVAL_POLICIES: Partial<Record<BridgePermissionMode, 'untrusted' | 'on-request' | 'never'>> = {
  auto: 'on-request',
  manual: 'untrusted',
  bypass: 'never',
}

/**
 * The argv that starts the Codex App Server over stdio.
 * @param executable - resolved absolute path to `codex`.
 * @param platform - target platform; defaults to the running one.
 * @returns the spawn description.
 */
export function executableArgv(executable: string, platform: NodeJS.Platform = process.platform): NativeCommand {
  return nativeCommand(executable, ['app-server', '--stdio'], CODEX_EXECUTABLE_ENV, platform)
}

function approvalOutcome(resolution: ProviderInteractionResolution): 'accept' | 'decline' | 'cancel' {
  if (resolution.kind !== 'approval') return 'cancel'
  return resolution.action === 'allow' ? 'accept' : resolution.action === 'deny' ? 'decline' : 'cancel'
}

function questionViews(params: ToolRequestUserInputParams): BridgeQuestion[] {
  return params.questions.map(question => ({
    id: question.id,
    header: question.header,
    prompt: question.question,
    secret: question.isSecret,
    allowFreeText: question.isOther,
    multiSelect: false,
    options: (question.options ?? []).map(option => ({
      value: option.label,
      label: option.label,
      description: option.description,
    })),
  }))
}

function mcpQuestions(params: McpServerElicitationRequestParams): BridgeQuestion[] {
  if (params.mode === 'url') return []
  const schema = object(params.requestedSchema, 'MCP elicitation schema')
  const properties = schema.properties === undefined ? null : object(schema.properties, 'MCP elicitation properties')
  if (properties === null) {
    return [{
      id: 'response',
      header: 'Input',
      prompt: params.message,
      secret: false,
      allowFreeText: true,
      multiSelect: false,
      options: [],
    }]
  }
  return Object.entries(properties).map(([id, raw]) => {
    const property = object(raw, `MCP elicitation property ${id}`)
    const choices = Array.isArray(property.enum) ? property.enum.filter(value => typeof value === 'string') : []
    return {
      id,
      header: typeof property.title === 'string' ? property.title : id,
      prompt: typeof property.description === 'string' ? property.description : params.message,
      secret: property.writeOnly === true || property.format === 'password',
      allowFreeText: choices.length === 0,
      multiSelect: property.type === 'array',
      options: choices.map(value => ({ value, label: value, description: null })),
    }
  })
}

function answersOf(
  questions: readonly BridgeQuestion[],
  resolution: ProviderInteractionResolution,
): Record<string, { answers: string[] }> {
  if (resolution.kind !== 'question') return {}
  return Object.fromEntries(questions.map(question => [
    question.id,
    { answers: [...(resolution.answers[question.id] ?? [])] },
  ]))
}

function mcpContent(
  questions: readonly BridgeQuestion[],
  resolution: ProviderInteractionResolution,
): JsonObject {
  if (resolution.kind !== 'question') return {}
  return Object.fromEntries(questions.map((question) => {
    const values = resolution.answers[question.id] ?? []
    return [question.id, values.length <= 1 ? values[0] ?? '' : [...values]]
  }))
}

function turnFailure(turn: CodexTurn): BridgeError | null {
  if (turn.status === 'completed') return null
  if (turn.status === 'interrupted') return new BridgeError('USER_CANCELLED')
  const error = turn.error as unknown as JsonObject | null
  if (error?.codexErrorInfo === 'contextWindowExceeded') return new BridgeError('CONTEXT_LIMIT')
  const message = error === null ? '' : JSON.stringify(redactValue(error))
  if (/auth|login|oauth|unauthori[sz]ed/i.test(message)) return new BridgeError('HOST_AUTH_REQUIRED')
  return new BridgeError('PROVIDER_START_FAILED')
}

/**
 * The arguments and result to show for one Codex item.
 *
 * Field names are per item type and were read off the protocol schema rather than
 * guessed: a shell call carries `command` and `aggregatedOutput`, an MCP call
 * carries `arguments` with `result` or `error`, a file change carries `changes`.
 * An item type not listed here contributes no detail rather than a JSON dump of
 * whatever it happens to hold.
 * @param item - the raw item from the notification.
 * @returns the detail, or undefined when this item type has none.
 */
function itemDetail(item: JsonObject): BridgeToolDetail | undefined {
  switch (item.type) {
    case 'commandExecution':
      return toolDetail(item.command, item.aggregatedOutput)
    case 'fileChange':
      return toolDetail(item.changes)
    case 'mcpToolCall':
      // `error` replaces `result` on failure; showing whichever is present keeps
      // a failed call as informative as a successful one.
      return toolDetail(item.arguments, item.error ?? item.result)
    case 'dynamicToolCall':
      return toolDetail(item.arguments ?? item.input, item.output ?? item.result)
    default:
      return undefined
  }
}

function itemProjection(item: JsonObject): {
  readonly itemId: string
  readonly toolName: string
  readonly summary: string
  readonly failed: boolean
  readonly fileChange: boolean
} | null {
  const itemId = typeof item.id === 'string' ? item.id : null
  if (itemId === null || typeof item.type !== 'string') return null
  switch (item.type) {
    case 'commandExecution':
      return {
        itemId,
        toolName: 'shell',
        summary: redactText(typeof item.command === 'string' ? item.command : 'Command execution', 1_024),
        failed: item.status === 'failed' || item.status === 'declined',
        fileChange: false,
      }
    case 'fileChange':
      return {
        itemId,
        toolName: 'file-change',
        summary: redactText(JSON.stringify(item.changes), 1_024),
        failed: item.status === 'failed' || item.status === 'declined',
        fileChange: true,
      }
    case 'mcpToolCall':
      return {
        itemId,
        toolName: `${String(item.server)}/${String(item.tool)}`,
        summary: `${String(item.server)}/${String(item.tool)}`,
        failed: item.status === 'failed',
        fileChange: false,
      }
    case 'dynamicToolCall':
      return {
        itemId,
        toolName: item.namespace === null ? String(item.tool) : `${String(item.namespace)}/${String(item.tool)}`,
        summary: String(item.tool),
        failed: item.status === 'failed' || item.success === false,
        fileChange: false,
      }
    case 'webSearch':
      return {
        itemId,
        toolName: 'web-search',
        summary: 'Web search',
        failed: false,
        fileChange: false,
      }
    case 'collabAgentToolCall':
      return {
        itemId,
        toolName: `collab:${String(item.tool)}`,
        summary: typeof item.prompt === 'string' ? item.prompt : String(item.tool),
        failed: item.status === 'failed',
        fileChange: false,
      }
    default:
      return null
  }
}

/**
 * Read a `thread/list` reply into resumable sessions.
 *
 * Codex reports each thread with an absolute rollout-transcript path under
 * `~/.codex/sessions`; it is dropped here rather than carried and redacted, so
 * there is nothing for the browser to leak. Timestamps arrive in seconds, unlike
 * everything else on this wire, and are converted once at the boundary.
 *
 * A thread the bridge itself created is kept: unlike Claude Code, where resuming
 * a bridge-made session would be a loop, a Codex thread is the operator's work
 * whichever client started it, and the App Server marks the source rather than
 * hiding it.
 * @param reply - the raw JSON-RPC result.
 * @returns sessions, most recently active first.
 */
function codexThreads(reply: unknown): BridgeNativeSession[] {
  const sessions: BridgeNativeSession[] = []
  for (const thread of readArray(readProperty(reply, 'data'))) {
    const locator = readString(readProperty(thread, 'id')) ?? readString(readProperty(thread, 'sessionId'))
    if (locator === null) continue
    const name = readString(readProperty(thread, 'name'))
    const preview = readString(readProperty(thread, 'preview'))
    const seconds = readProperty(thread, 'updatedAt') ?? readProperty(thread, 'recencyAt')
    sessions.push({
      locator: redactText(locator, 128),
      title: redactText(name ?? preview ?? locator, 200),
      // Seconds on this call, milliseconds everywhere else in the bridge.
      updatedAt: typeof seconds === 'number' ? seconds * 1_000 : 0,
      branch: null,
    })
  }
  return sessions.sort((left, right) => right.updatedAt - left.updatedAt)
}

/**
 * Read a `model/list` reply into selectable models.
 *
 * Codex reports far more per model than a picker needs — upgrade prompts, input
 * modalities, personality support, a marketing blurb under `availabilityNux`.
 * Only the identity, the one-line description and the reasoning efforts cross
 * over; the rest is either product-tour copy or a capability this bridge has no
 * way to honour, and offering it would imply otherwise.
 *
 * Hidden models are dropped. The App Server flags them as not for presentation,
 * and the operator can still reach one by configuring Codex directly.
 *
 * Parsing is permissive for the same reason as the skills reader: this is a
 * convenience, so an unfamiliar reply shape yields fewer models rather than an
 * error.
 * @param reply - the raw JSON-RPC result, or null when the call failed.
 * @returns models in the order the product listed them.
 */
function codexModels(reply: unknown): BridgeModel[] {
  const models: BridgeModel[] = []
  for (const entry of readArray(readProperty(reply, 'data'))) {
    const id = readString(readProperty(entry, 'model')) ?? readString(readProperty(entry, 'id'))
    if (id === null) continue
    if (readProperty(entry, 'hidden') === true) continue
    const displayName = readString(readProperty(entry, 'displayName'))
    const description = readString(readProperty(entry, 'description'))
    const efforts: string[] = []
    for (const effort of readArray(readProperty(entry, 'supportedReasoningEfforts'))) {
      const level = readString(readProperty(effort, 'reasoningEffort'))
      if (level !== null) efforts.push(redactText(level, 32))
    }
    models.push({
      id: redactText(id, 128),
      displayName: redactText(displayName ?? id, 128),
      description: description === null ? null : redactText(description, 512),
      efforts,
      defaultEffort: (() => {
        const fallback = readString(readProperty(entry, 'defaultReasoningEffort'))
        // Only reported when it is one the product also says it accepts, so the
        // panel cannot preselect an effort that would then be refused.
        return fallback !== null && efforts.includes(fallback) ? fallback : null
      })(),
    })
  }
  return models
}

/**
 * Read a `skills/list` reply into completions.
 *
 * Codex groups skills by working directory and reports each one with an
 * absolute `SKILL.md` path, a scope and an enabled flag. Only the name and
 * description cross to the browser: the path is Host filesystem detail that has
 * no business leaving the Host, and it is dropped here rather than redacted so
 * there is nothing to leak by accident.
 *
 * Parsing is deliberately permissive. This is a read-only convenience, so a
 * reply shaped differently by a future Codex yields fewer entries instead of
 * failing a turn.
 * @param reply - the raw JSON-RPC result, or null when the call failed.
 * @returns completions for every enabled skill.
 */
function codexSkills(reply: unknown): BridgeCompletion[] {
  const groups = readArray(readProperty(reply, 'data'))
  const completions: BridgeCompletion[] = []
  for (const group of groups) {
    for (const skill of readArray(readProperty(group, 'skills'))) {
      const name = readString(readProperty(skill, 'name'))
      if (name === null) continue
      if (readProperty(skill, 'enabled') === false) continue
      const description = readString(readProperty(skill, 'description'))
      completions.push({
        kind: 'command',
        name: redactText(name, 128),
        // A Codex skill is not a slash command; its name is what the model
        // resolves, so that is what goes in the composer.
        insertText: redactText(name, 128),
        description: description === null ? null : redactText(description, 512),
        argumentHint: null,
        status: null,
      })
    }
  }
  return completions
}

/**
 * Read an `mcpServerStatus/list` reply into completions.
 * @param reply - the raw JSON-RPC result, or null when the call failed.
 * @returns one information-only completion per configured server.
 */
function codexMcpServers(reply: unknown): BridgeCompletion[] {
  const completions: BridgeCompletion[] = []
  for (const server of readArray(readProperty(reply, 'data'))) {
    const name = readString(readProperty(server, 'name'))
    if (name === null) continue
    const info = readProperty(server, 'serverInfo')
    const version = readString(readProperty(info, 'version'))
    const toolNames = Object.keys(readRecord(readProperty(server, 'tools')))
    completions.push({
      kind: 'mcp',
      name: redactText(name, 128),
      insertText: null,
      description: [
        version === null ? null : `v${version}`,
        toolNames.length === 0 ? null : toolNames.slice(0, 6).join(', '),
      ].filter(part => part !== null).join(' · ') || null,
      argumentHint: null,
      // Codex reports auth rather than connection state here.
      status: readString(readProperty(server, 'authStatus')),
    })
  }
  return completions
}

/** Read one property off an unknown value, or undefined when it is not an object. */
function readProperty(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined
}

/** Narrow an unknown value to an array, or empty. */
function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** Narrow an unknown value to a record, or empty. */
function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** Narrow an unknown value to a non-empty string, or null. */
function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

export class CodexProviderAdapter implements NativeProviderAdapter {
  readonly id = 'codex' as const
  readonly supportsSteer = true
  private readonly sessions = new Map<string, CodexSessionState>()
  private connection: CodexConnection | null = null
  private connecting: Promise<CodexConnection> | null = null
  private epoch = 0
  private disposed = false

  constructor(
    private readonly subprocess: SubprocessRuntime,
    private readonly executable: string,
    private readonly graceMs = 3_000,
  ) {}

  async startTurn({ text, hooks }: ProviderTurnRequest): Promise<void> {
    const state = this.session(hooks)
    if (state.completion !== null) throw new BridgeError('TURN_CONFLICT')
    const connection = await this.ensureConnection()
    await this.ensureThread(connection, state, hooks)
    state.hooks = hooks
    state.itemNames.clear()
    state.earlyCompleted = null
    const completion = Promise.withResolvers<CodexTurn>()
    state.completion = completion
    try {
      const approvalPolicy = CODEX_APPROVAL_POLICIES[hooks.permissionMode]
      const response = object(await connection.transport.request('turn/start', {
        threadId: state.threadId as string,
        input: [{ type: 'text', text, text_elements: [] }],
        // Omitted entirely for a mode Codex cannot express, so the product keeps
        // whatever the operator configured on the Host rather than being handed
        // an approximation.
        ...approvalPolicy === undefined ? {} : { approvalPolicy },
        // Both are per-turn overrides that also stick for subsequent turns, and
        // both are omitted when the operator has chosen nothing, so the model and
        // effort configured in Codex itself stay in force.
        ...hooks.model === null ? {} : { model: hooks.model },
        ...hooks.effort === null ? {} : { effort: hooks.effort },
      }, hooks.signal), 'turn/start response')
      const turn = object(response.turn, 'turn/start turn') as unknown as CodexTurn
      const turnId = string(turn.id, 'turn/start turn id')
      if (state.pendingTurnId !== null && state.pendingTurnId !== turnId) {
        throw new BridgeError('PROVIDER_PROTOCOL_ERROR')
      }
      state.activeTurnId = turnId
      state.pendingTurnId = null
      if (state.earlyCompleted !== null) completion.resolve(state.earlyCompleted)
      const completed = await completion.promise
      const failure = turnFailure(completed)
      if (failure !== null) throw failure
    } finally {
      state.activeTurnId = null
      state.pendingTurnId = null
      state.hooks = null
      state.completion = null
      state.earlyCompleted = null
    }
  }

  async listNativeSessions(cwd: string): Promise<BridgeNativeSessionsResult> {
    if (this.disposed) return { sessions: [], unavailable: true }
    let connection: CodexConnection
    try {
      connection = await this.ensureConnection()
    } catch {
      return { sessions: [], unavailable: true }
    }
    // `cwd` accepts a path or a list of paths and matches exactly, so scoping to
    // the workspace is enough — no client-side filtering of a global listing.
    const reply = await connection.transport
      .request('thread/list', { cwd, limit: NATIVE_SESSION_LIMIT, archived: false })
      .catch(() => null)
    if (reply === null) return { sessions: [], unavailable: true }
    return { sessions: codexThreads(reply), unavailable: false }
  }

  async listCompletions(_bridgeSessionId: string, cwd: string): Promise<BridgeCompletionsResult> {
    if (this.disposed) return { completions: [], pending: true }
    let connection: CodexConnection
    try {
      connection = await this.ensureConnection()
    } catch {
      // Starting the App Server just to list skills is not worth reporting a
      // failure for; the browser shows nothing and the next attempt retries.
      return { completions: [], pending: true }
    }
    const [skills, servers] = await Promise.all([
      // The workspace directory is passed explicitly, so a session that has not
      // yet started a thread still gets that directory's skills. Empty `cwds`
      // would fall back to the App Server process's own directory, which is
      // wherever DSH was launched from and has nothing to do with the session.
      connection.transport.request('skills/list', { cwds: [cwd], forceReload: false }).catch(() => null),
      connection.transport.request('mcpServerStatus/list', {}).catch(() => null),
    ])
    if (skills === null && servers === null) return { completions: [], pending: true }
    return {
      completions: [...codexSkills(skills), ...codexMcpServers(servers)],
      pending: false,
    }
  }

  /**
   * Models the App Server offers, readable at any time.
   *
   * Unlike Claude Code, this needs no live turn: the App Server answers
   * `model/list` from the account's configuration, so a session created a moment
   * ago can already choose. The session id is unused for that reason.
   * @returns the product's models, or `unavailable` when it could not be asked.
   */
  async listModels(): Promise<BridgeModelsResult> {
    if (this.disposed) return { models: [], unavailable: true }
    let connection: CodexConnection
    try {
      connection = await this.ensureConnection()
    } catch {
      return { models: [], unavailable: true }
    }
    const reply = await connection.transport
      .request('model/list', { limit: MODEL_LIMIT, includeHidden: false })
      .catch(() => null)
    if (reply === null) return { models: [], unavailable: true }
    return { models: codexModels(reply), unavailable: false }
  }

  async steer(bridgeSessionId: string, text: string): Promise<void> {
    const state = this.sessions.get(bridgeSessionId)
    const connection = this.connection
    if (state === undefined || state.threadId === null || state.activeTurnId === null || connection === null) {
      throw new BridgeError('TURN_CONFLICT')
    }
    await connection.transport.request('turn/steer', {
      threadId: state.threadId,
      expectedTurnId: state.activeTurnId,
      input: [{ type: 'text', text, text_elements: [] }],
    })
  }

  async cancel(bridgeSessionId: string): Promise<void> {
    const state = this.sessions.get(bridgeSessionId)
    const connection = this.connection
    if (state === undefined || state.threadId === null || state.activeTurnId === null || connection === null) return
    await connection.transport.request('turn/interrupt', {
      threadId: state.threadId,
      turnId: state.activeTurnId,
    }).catch(() => {})
  }

  async disposeSession(bridgeSessionId: string): Promise<void> {
    await this.cancel(bridgeSessionId)
    const state = this.sessions.get(bridgeSessionId)
    state?.completion?.reject(new BridgeError('USER_CANCELLED'))
    this.sessions.delete(bridgeSessionId)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    for (const state of this.sessions.values()) state.completion?.reject(new BridgeError('USER_CANCELLED'))
    this.sessions.clear()
    await this.closeConnection()
  }

  private session(hooks: ProviderTurnHooks): CodexSessionState {
    let state = this.sessions.get(hooks.bridgeSessionId)
    if (state === undefined) {
      state = {
        bridgeSessionId: hooks.bridgeSessionId,
        threadId: hooks.nativeSessionLocator,
        attachedEpoch: 0,
        activeTurnId: null,
        pendingTurnId: null,
        hooks: null,
        completion: null,
        earlyCompleted: null,
        itemNames: new Map(),
      }
      this.sessions.set(hooks.bridgeSessionId, state)
    }
    return state
  }

  private async ensureConnection(): Promise<CodexConnection> {
    if (this.disposed) throw new BridgeError('CONNECTION_LOST')
    if (this.connection !== null) return this.connection
    if (this.connecting !== null) return await this.connecting
    this.connecting = this.openConnection()
    try {
      return await this.connecting
    } finally {
      this.connecting = null
    }
  }

  private async openConnection(): Promise<CodexConnection> {
    const command = executableArgv(this.executable)
    const child = this.subprocess.spawn({
      argv: command.argv,
      cwd: process.cwd(),
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 65_536 } },
      graceMs: this.graceMs,
      env: command.env,
    })
    if (child.stdin === undefined || child.stdout === undefined) {
      child.terminate()
      throw new BridgeError('PROVIDER_START_FAILED')
    }
    const transport = new JsonRpcLineTransport(child.stdout, child.stdin)
    const connection: CodexConnection = {
      epoch: ++this.epoch,
      child,
      transport,
      closing: false,
    }
    transport.onRequest((method, params) => this.handleRequest(method, params))
    transport.onNotification((method, params) => {
      void this.handleNotification(method, params).catch(error => this.failConnection(connection, error))
    })
    transport.start()
    try {
      object(await transport.request('initialize', {
        clientInfo: {
          name: 'dsh-plugin-local-agent-bridge',
          title: 'DeepSeek Harness Local Agent Bridge',
          version: '0.1.0',
        },
        capabilities: { experimentalApi: true, requestAttestation: false },
      }), 'initialize response')
      transport.notify('initialized')
      await transport.flush()
    } catch (error) {
      connection.closing = true
      transport.close()
      child.terminate()
      await child.waitForExit().catch(() => false)
      throw error
    }
    this.connection = connection
    void child.done.then(
      () => this.failConnection(connection, new BridgeError('CONNECTION_LOST')),
      error => this.failConnection(connection, error),
    )
    return connection
  }

  private async ensureThread(
    connection: CodexConnection,
    state: CodexSessionState,
    hooks: ProviderTurnHooks,
  ): Promise<void> {
    if (state.attachedEpoch === connection.epoch && state.threadId !== null) return
    const response = state.threadId === null
      ? object(await connection.transport.request('thread/start', {
          cwd: hooks.cwd,
          ephemeral: false,
          approvalsReviewer: 'user',
        }, hooks.signal), 'thread/start response')
      : object(await connection.transport.request('thread/resume', {
          threadId: state.threadId,
          cwd: hooks.cwd,
          excludeTurns: true,
          approvalsReviewer: 'user',
        }, hooks.signal), 'thread/resume response')
    const thread = object(response.thread, 'thread response') as unknown as CodexThread
    const threadId = string(thread.id, 'thread id')
    if (state.threadId !== null && state.threadId !== threadId) throw new BridgeError('NATIVE_SESSION_ORPHANED')
    state.threadId = threadId
    state.attachedEpoch = connection.epoch
    if (hooks.nativeSessionLocator === null) await hooks.setNativeSessionLocator(threadId)
  }

  private async handleRequest(method: string, rawParams: JsonObject): Promise<unknown> {
    if (method.startsWith('account/login/') || method === 'account/login/start') {
      throw new BridgeError('PROVIDER_PROTOCOL_ERROR', 'Codex attempted an unsupported login flow.')
    }
    const state = this.stateForRequest(rawParams)
    const hooks = state.hooks
    if (hooks === null) throw new BridgeError('PROVIDER_PROTOCOL_ERROR')
    switch (method) {
      case 'item/commandExecution/requestApproval': {
        const params = validate<CommandExecutionRequestApprovalParams>(method, rawParams)
        this.validateTurn(state, params.turnId)
        const resolution = await hooks.requestInteraction({
          kind: 'approval',
          safeSummary: redactText(params.reason ?? params.command ?? 'Codex wants to run a command.', 1_024),
          toolName: 'shell',
          target: params.command ?? params.cwd ?? null,
          questions: [],
        })
        return { decision: approvalOutcome(resolution) }
      }
      case 'item/fileChange/requestApproval': {
        const params = validate<FileChangeRequestApprovalParams>(method, rawParams)
        this.validateTurn(state, params.turnId)
        const resolution = await hooks.requestInteraction({
          kind: 'approval',
          safeSummary: redactText(params.reason ?? 'Codex wants to change files.', 1_024),
          toolName: 'file-change',
          target: params.grantRoot ?? null,
          questions: [],
        })
        return { decision: approvalOutcome(resolution) }
      }
      case 'item/permissions/requestApproval': {
        const params = validate<PermissionsRequestApprovalParams>(method, rawParams)
        this.validateTurn(state, params.turnId)
        const resolution = await hooks.requestInteraction({
          kind: 'approval',
          safeSummary: redactText(params.reason ?? 'Codex requests additional permissions.', 1_024),
          toolName: 'permissions',
          target: params.cwd,
          questions: [],
        })
        if (approvalOutcome(resolution) !== 'accept') return { permissions: {}, scope: 'turn' }
        return {
          permissions: {
            ...params.permissions.network === null ? {} : { network: params.permissions.network },
            ...params.permissions.fileSystem === null ? {} : { fileSystem: params.permissions.fileSystem },
          },
          scope: 'turn',
        }
      }
      case 'item/tool/requestUserInput': {
        const params = validate<ToolRequestUserInputParams>(method, rawParams)
        this.validateTurn(state, params.turnId)
        const questions = questionViews(params)
        const resolution = await hooks.requestInteraction({
          kind: 'question',
          safeSummary: 'Codex needs input before it can continue.',
          toolName: 'request-user-input',
          target: null,
          questions,
        })
        return { answers: answersOf(questions, resolution) }
      }
      case 'mcpServer/elicitation/request': {
        const params = validate<McpServerElicitationRequestParams>(method, rawParams)
        if (params.mode === 'url') return { action: 'decline', content: null, _meta: null }
        const questions = mcpQuestions(params)
        const resolution = await hooks.requestInteraction({
          kind: 'question',
          safeSummary: redactText(params.message, 1_024),
          toolName: `mcp:${params.serverName}`,
          target: params.serverName,
          questions,
        })
        return { action: 'accept', content: mcpContent(questions, resolution), _meta: null }
      }
      default:
        throw new BridgeError('PROVIDER_PROTOCOL_ERROR', `Unsupported Codex server request: ${method}`)
    }
  }

  private async handleNotification(method: string, rawParams: JsonObject): Promise<void> {
    if (method === 'turn/started') {
      const threadId = string(rawParams.threadId, 'turn/started thread id')
      const state = this.stateForThread(threadId)
      if (state?.completion === null || state === undefined) return
      const turn = object(rawParams.turn, 'turn/started turn')
      const turnId = string(turn.id, 'turn/started turn id')
      if (state.activeTurnId === null) state.pendingTurnId = turnId
      return
    }
    if (method === 'thread/tokenUsage/updated') {
      // Codex pushes usage rather than answering a query, and does so whenever it
      // changes — so this arrives several times per turn and simply overwrites.
      const threadId = readString(readProperty(rawParams, 'threadId'))
      const state = threadId === null ? undefined : this.stateForThread(threadId)
      const usage = readProperty(rawParams, 'tokenUsage')
      const total = readProperty(usage, 'total')
      const used = readProperty(total, 'totalTokens')
      const hooks = state?.hooks ?? null
      if (hooks === null || typeof used !== 'number') return
      const window = readProperty(usage, 'modelContextWindow')
      await hooks.reportContextUsage({
        usedTokens: used,
        maxTokens: typeof window === 'number' && window > 0 ? window : null,
        // Codex reports the model on the thread, not here.
        model: null,
      })
      // The same notification carries the running total, which is a different
      // fact from how full the window is: one only grows, the other moves both
      // ways as the thread compacts.
      const count = (key: string): number => {
        const value = readProperty(total, key)
        return typeof value === 'number' && value > 0 ? value : 0
      }
      await hooks.reportTokenUsage({
        input: count('inputTokens'),
        output: count('outputTokens'),
        cacheRead: count('cachedInputTokens'),
        cacheWrite: count('cacheWriteInputTokens'),
        // The product's own total, not a sum of the parts: Codex counts reasoning
        // output separately and adding the fields would double it.
        total: used,
      })
      return
    }
    if (method === 'item/agentMessage/delta') {
      const params = validate<{ threadId: string; turnId: string; itemId: string; delta: string }>(method, rawParams)
      const state = this.activeState(params.threadId, params.turnId)
      await state.hooks?.emit({
        type: 'bridge/text-delta',
        data: { text: params.delta, itemId: params.itemId },
      })
      return
    }
    if (method === 'item/reasoning/summaryTextDelta') {
      const params = validate<{ threadId: string; turnId: string; itemId: string; delta: string }>(method, rawParams)
      const state = this.activeState(params.threadId, params.turnId)
      await state.hooks?.emit({
        type: 'bridge/reasoning-delta',
        data: { text: params.delta, itemId: params.itemId },
      })
      return
    }
    if (method === 'item/started' || method === 'item/completed') {
      const params = method === 'item/started'
        ? validate<ItemNotification>(method, rawParams)
        : validate<ItemNotification>(method, rawParams)
      const state = this.activeState(params.threadId, params.turnId)
      const projected = itemProjection(params.item)
      if (projected === null) return
      state.itemNames.set(projected.itemId, projected.toolName)
      const detail = itemDetail(params.item)
      await state.hooks?.emit({
        type: method === 'item/started' ? 'bridge/tool-started' : 'bridge/tool-completed',
        data: {
          itemId: projected.itemId,
          toolName: projected.toolName,
          summary: projected.summary,
          status: method === 'item/started' ? 'running' : projected.failed ? 'failed' : 'completed',
          ...detail === undefined ? {} : { detail },
        },
      })
      if (method === 'item/completed' && projected.fileChange) {
        await state.hooks?.emit({
          type: 'bridge/file-change',
          data: { itemId: projected.itemId, summary: projected.summary },
        })
      }
      return
    }
    if (method !== 'turn/completed') return
    const params = validate<{ threadId: string; turn: CodexTurn }>(method, rawParams)
    const state = this.stateForThread(params.threadId)
    if (state?.completion === null || state === undefined) return
    if (state.activeTurnId === null) {
      const turnId = string(params.turn.id, 'turn/completed turn id')
      state.pendingTurnId = turnId
      state.earlyCompleted = params.turn
      return
    }
    if (params.turn.id === state.activeTurnId) state.completion.resolve(params.turn)
  }

  private stateForRequest(params: JsonObject): CodexSessionState {
    const threadId = string(params.threadId, 'server request thread id')
    const state = this.stateForThread(threadId)
    if (state === undefined) throw new BridgeError('PROVIDER_PROTOCOL_ERROR')
    if (params.turnId !== null && params.turnId !== undefined) this.validateTurn(state, string(params.turnId, 'server request turn id'))
    return state
  }

  private stateForThread(threadId: string): CodexSessionState | undefined {
    return [...this.sessions.values()].find(state => state.threadId === threadId)
  }

  private activeState(threadId: string, turnId: string): CodexSessionState {
    const state = this.stateForThread(threadId)
    if (state === undefined) throw new BridgeError('PROVIDER_PROTOCOL_ERROR')
    this.validateTurn(state, turnId)
    return state
  }

  private validateTurn(state: CodexSessionState, turnId: string): void {
    const expected = state.activeTurnId ?? state.pendingTurnId
    if (expected === null) state.pendingTurnId = turnId
    else if (expected !== turnId) throw new BridgeError('PROVIDER_PROTOCOL_ERROR')
  }

  private failConnection(connection: CodexConnection, error: unknown): void {
    if (connection.closing) return
    connection.closing = true
    if (this.connection === connection) this.connection = null
    connection.transport.close()
    for (const state of this.sessions.values()) {
      if (state.attachedEpoch !== connection.epoch) continue
      state.attachedEpoch = 0
      state.completion?.reject(error instanceof Error ? error : new BridgeError('CONNECTION_LOST'))
    }
  }

  private async closeConnection(): Promise<void> {
    const connection = this.connection
    this.connection = null
    if (connection === null) return
    connection.closing = true
    connection.transport.close()
    try {
      connection.child.stdin?.end()
    } catch {
      // Continue to tree-scoped cleanup.
    }
    connection.child.terminate()
    await connection.child.waitForExit().catch(() => false)
    await connection.child.done.catch(() => {})
  }
}
