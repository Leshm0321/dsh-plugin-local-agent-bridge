import { extname } from 'node:path'
import Ajv, { type ValidateFunction } from 'ajv'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
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
import type { BridgeQuestion } from '../types.ts'

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

function executableArgv(executable: string): { argv: string[]; env?: NodeJS.ProcessEnv } {
  const extension = extname(executable).toLowerCase()
  if (process.platform !== 'win32' || extension !== '.cmd' && extension !== '.bat') {
    return { argv: [executable, 'app-server', '--stdio'] }
  }
  return {
    argv: ['cmd.exe', '/d', '/v:off', '/s', '/c', '%DSH_LOCAL_AGENT_CODEX_EXECUTABLE%', 'app-server', '--stdio'],
    env: { DSH_LOCAL_AGENT_CODEX_EXECUTABLE: `"${executable}"` },
  }
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
      const response = object(await connection.transport.request('turn/start', {
        threadId: state.threadId as string,
        input: [{ type: 'text', text, text_elements: [] }],
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
      await state.hooks?.emit({
        type: method === 'item/started' ? 'bridge/tool-started' : 'bridge/tool-completed',
        data: {
          itemId: projected.itemId,
          toolName: projected.toolName,
          summary: projected.summary,
          status: method === 'item/started' ? 'running' : projected.failed ? 'failed' : 'completed',
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
