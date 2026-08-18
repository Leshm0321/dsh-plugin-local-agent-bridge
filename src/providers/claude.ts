import {
  listSessions,
  query as claudeQuery,
  type CanUseTool,
  type ElicitationRequest,
  type ElicitationResult,
  type Options,
  type PermissionMode,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKControlGetContextUsageResponse,
  type SDKPartialAssistantMessage,
  type SpawnOptions,
} from '@anthropic-ai/claude-agent-sdk'
import {
  scrubbedParentEnv,
  type SubprocessHandle,
  type SubprocessRuntime,
} from '@deepseek-ai/dsh-subprocess'
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
  BridgePermissionMode,
  BridgeNativeSessionsResult,
  BridgeQuestion,
} from '../types.ts'
import { toolDetail } from '../core/tool-detail.ts'
import { claudeSpawnSpec, ManagedClaudeProcess } from './claude-process.ts'

/**
 * How many native sessions to offer for resumption. A picker exists for
 * recognising recent work, not for browsing an archive, and every entry carries
 * operator-authored text that has to cross to the browser.
 */
const NATIVE_SESSION_LIMIT = 30

/**
 * Bridge permission mode to the SDK's own.
 *
 * One-to-one: Claude Code has a native mode for each of the five the panel
 * offers, which is why the panel's vocabulary was taken from this product in the
 * first place. `bypass` really does disable the approval callback — the browser
 * is not asked, because there is nothing to ask.
 */
const CLAUDE_PERMISSION_MODES: Record<BridgePermissionMode, PermissionMode> = {
  auto: 'auto',
  manual: 'default',
  acceptEdits: 'acceptEdits',
  plan: 'plan',
  bypass: 'bypassPermissions',
}

interface ActiveClaudeTurn {
  readonly controller: AbortController
  query: Query | null
  child: SubprocessHandle | null
}

interface ClaudeTurnProjection {
  readonly toolNames: Map<string, string>
  /**
   * Arguments per in-flight tool call, so the completed event can show the call
   * and its result together. Entries are removed as results arrive; a turn that
   * ends with calls outstanding drops its projection wholesale.
   */
  readonly toolInputs: Map<string, unknown>
  locatorCaptured: boolean
  emittedText: boolean
  sawResult: boolean
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function safeTarget(input: Record<string, unknown>, blockedPath?: string): string | null {
  if (blockedPath !== undefined) return redactText(blockedPath, 512)
  for (const key of ['file_path', 'path', 'command', 'url', 'pattern']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim().length > 0) return redactText(value, 512)
  }
  return null
}

function askQuestions(input: Record<string, unknown>): BridgeQuestion[] {
  const values = Array.isArray(input.questions) ? input.questions : []
  return values.flatMap((value, index) => {
    const question = object(value)
    if (question === null || typeof question.question !== 'string') return []
    const options = Array.isArray(question.options)
      ? question.options.flatMap((candidate) => {
        const option = object(candidate)
        return option !== null && typeof option.label === 'string'
          ? [{
              value: option.label,
              label: option.label,
              description: typeof option.description === 'string' ? option.description : null,
            }]
          : []
      })
      : []
    return [{
      id: `q-${String(index)}`,
      header: typeof question.header === 'string' ? question.header : 'Question',
      prompt: question.question,
      secret: false,
      allowFreeText: true,
      multiSelect: question.multiSelect === true,
      options,
    }]
  })
}

function questionAnswers(
  questions: readonly BridgeQuestion[],
  resolution: ProviderInteractionResolution,
): Record<string, string> {
  if (resolution.kind !== 'question') return {}
  const output: Record<string, string> = {}
  for (const question of questions) {
    const selected = resolution.answers[question.id]
    if (selected !== undefined) output[question.prompt] = selected.join(', ')
  }
  return output
}

function elicitationQuestions(request: ElicitationRequest): BridgeQuestion[] {
  if (request.mode === 'url') return []
  const schema = object(request.requestedSchema)
  const properties = object(schema?.properties)
  if (properties === null) {
    return [{
      id: 'response',
      header: request.displayName ?? 'Input',
      prompt: request.message,
      secret: false,
      allowFreeText: true,
      multiSelect: false,
      options: [],
    }]
  }
  return Object.entries(properties).map(([id, raw]) => {
    const property = object(raw)
    const choices = Array.isArray(property?.enum) ? property.enum.filter(value => typeof value === 'string') : []
    return {
      id,
      header: typeof property?.title === 'string' ? property.title : id,
      prompt: typeof property?.description === 'string' ? property.description : request.message,
      secret: property?.writeOnly === true || property?.format === 'password',
      allowFreeText: choices.length === 0,
      multiSelect: property?.type === 'array',
      options: choices.map(value => ({ value, label: value, description: null })),
    }
  })
}

function elicitationContent(
  questions: readonly BridgeQuestion[],
  resolution: ProviderInteractionResolution,
): Record<string, string | number | boolean | string[]> {
  if (resolution.kind !== 'question') return {}
  const content: Record<string, string | number | boolean | string[]> = {}
  for (const question of questions) {
    const values = resolution.answers[question.id] ?? []
    content[question.id] = values.length <= 1 ? values[0] ?? '' : [...values]
  }
  return content
}

function permissionCallback(hooks: ProviderTurnHooks): CanUseTool {
  return async (toolName, rawInput, options): Promise<PermissionResult> => {
    const input = redactValue(rawInput)
    if (toolName === 'AskUserQuestion') {
      const questions = askQuestions(input)
      const resolution = await hooks.requestInteraction({
        kind: 'question',
        safeSummary: 'Claude Code needs input before it can continue.',
        toolName,
        target: null,
        questions,
      })
      return {
        behavior: 'allow',
        updatedInput: { ...rawInput, answers: questionAnswers(questions, resolution) },
        toolUseID: options.toolUseID,
        decisionClassification: 'user_temporary',
      }
    }
    const resolution = await hooks.requestInteraction({
      kind: 'approval',
      safeSummary: redactText(options.title ?? options.description ?? `Claude Code wants to use ${toolName}.`, 1_024),
      toolName,
      target: safeTarget(input, options.blockedPath),
      questions: [],
    })
    if (resolution.kind === 'approval' && resolution.action === 'allow') {
      return {
        behavior: 'allow',
        updatedInput: rawInput,
        toolUseID: options.toolUseID,
        decisionClassification: 'user_temporary',
      }
    }
    return {
      behavior: 'deny',
      message: 'The user denied this operation.',
      interrupt: resolution.kind === 'approval' && resolution.action === 'cancel',
      toolUseID: options.toolUseID,
      decisionClassification: 'user_reject',
    }
  }
}

async function onElicitation(
  hooks: ProviderTurnHooks,
  request: ElicitationRequest,
): Promise<ElicitationResult> {
  // URL elicitations can be authentication flows. This bridge never forwards
  // vendor or MCP login URLs to the browser.
  if (request.mode === 'url') return { action: 'decline' }
  const questions = elicitationQuestions(request)
  const resolution = await hooks.requestInteraction({
    kind: 'question',
    safeSummary: redactText(request.message, 1_024),
    toolName: `mcp:${request.serverName}`,
    target: request.serverName,
    questions,
  })
  if (resolution.kind !== 'question') return { action: 'cancel' }
  return { action: 'accept', content: elicitationContent(questions, resolution) }
}

function contentBlocks(message: SDKMessage): readonly Record<string, unknown>[] {
  if (message.type !== 'assistant' && message.type !== 'user') return []
  const content = message.message.content
  if (!Array.isArray(content)) return []
  const blocks: Record<string, unknown>[] = []
  for (const block of content) {
    const value = object(block)
    if (value !== null) blocks.push(value)
  }
  return blocks
}

async function projectPartial(
  message: SDKPartialAssistantMessage,
  hooks: ProviderTurnHooks,
  projection: ClaudeTurnProjection,
): Promise<void> {
  const assistantItemId = `claude-assistant-${hooks.bridgeTurnId}`
  const event = object(message.event)
  if (event?.type !== 'content_block_delta') return
  const delta = object(event.delta)
  if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
    projection.emittedText = true
    await hooks.emit({
      type: 'bridge/text-delta',
      data: { text: delta.text, itemId: assistantItemId },
    })
  }
  if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
    await hooks.emit({
      type: 'bridge/reasoning-delta',
      data: { text: delta.thinking, itemId: assistantItemId },
    })
  }
}

async function projectMessage(
  message: SDKMessage,
  hooks: ProviderTurnHooks,
  projection: ClaudeTurnProjection,
): Promise<void> {
  if ('session_id' in message && typeof message.session_id === 'string' && !projection.locatorCaptured) {
    await hooks.setNativeSessionLocator(message.session_id)
    projection.locatorCaptured = true
  }
  if (message.type === 'stream_event') {
    await projectPartial(message, hooks, projection)
    return
  }
  if (message.type === 'assistant') {
    if (message.error === 'authentication_failed' || message.error === 'oauth_org_not_allowed') {
      throw new BridgeError('HOST_AUTH_REQUIRED')
    }
    for (const block of contentBlocks(message)) {
      if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
        projection.toolNames.set(block.id, block.name)
        const input = object(block.input) ?? {}
        const target = safeTarget(input)
        projection.toolInputs.set(block.id, input)
        const startedDetail = toolDetail(input)
        await hooks.emit({
          type: 'bridge/tool-started',
          data: {
            itemId: block.id,
            toolName: block.name,
            summary: target === null ? block.name : `${block.name}: ${target}`,
            status: 'running',
            ...startedDetail === undefined ? {} : { detail: startedDetail },
          },
        })
        if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(block.name)) {
          await hooks.emit({
            type: 'bridge/file-change',
            data: { itemId: block.id, summary: target ?? `${block.name} file change` },
          })
        }
      }
    }
    return
  }
  if (message.type === 'user') {
    for (const block of contentBlocks(message)) {
      if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue
      const failed = block.is_error === true
      const toolName = projection.toolNames.get(block.tool_use_id) ?? 'tool'
      // Carries the arguments again alongside the result: the completed row is
      // the one a reader opens, and a result without the call that produced it
      // is half the story.
      const detail = toolDetail(projection.toolInputs.get(block.tool_use_id), block.content)
      projection.toolInputs.delete(block.tool_use_id)
      await hooks.emit({
        type: 'bridge/tool-completed',
        data: {
          itemId: block.tool_use_id,
          toolName,
          summary: failed ? `${toolName} failed` : `${toolName} completed`,
          status: failed ? 'failed' : 'completed',
          ...detail === undefined ? {} : { detail },
        },
      })
    }
    return
  }
  if (message.type === 'tool_progress') {
    await hooks.emit({
      type: 'bridge/tool-updated',
      data: {
        itemId: message.tool_use_id,
        toolName: message.tool_name,
        summary: `${message.tool_name} running for ${String(Math.round(message.elapsed_time_seconds))}s`,
        status: 'running',
      },
    })
    return
  }
  if (message.type === 'tool_use_summary') {
    for (const itemId of message.preceding_tool_use_ids) {
      const toolName = projection.toolNames.get(itemId) ?? 'tool'
      await hooks.emit({
        type: 'bridge/tool-updated',
        data: { itemId, toolName, summary: message.summary, status: 'running' },
      })
    }
    return
  }
  if (message.type === 'auth_status' && message.error !== undefined) {
    throw new BridgeError('HOST_AUTH_REQUIRED')
  }
  if (message.type !== 'result') return
  projection.sawResult = true
  if (message.subtype !== 'success' || message.is_error) {
    const detail = message.subtype === 'success' ? message.result : message.errors.join('; ')
    throw /auth|oauth|login/i.test(detail)
      ? new BridgeError('HOST_AUTH_REQUIRED')
      : new Error(detail || message.subtype)
  }
  if (!projection.emittedText && message.result.trim().length > 0) {
    projection.emittedText = true
    await hooks.emit({
      type: 'bridge/text-delta',
      data: { text: message.result, itemId: `claude-assistant-${hooks.bridgeTurnId}` },
    })
  }
}

/**
 * Ask the SDK how much context the session has consumed and record it.
 *
 * Only the totals cross to the browser. The response also carries a per-category
 * breakdown including memory-file paths, which is Host filesystem detail with no
 * business in a browser, so it is dropped here rather than filtered later.
 *
 * Silent on failure: an SDK build without this control request must not disturb
 * the turn, and a missing figure is simply not shown.
 * @param query - the live SDK query for the turn.
 * @param hooks - the turn's hooks, for reporting back.
 */
async function reportUsage(query: Query, hooks: ProviderTurnHooks): Promise<void> {
  let usage: SDKControlGetContextUsageResponse
  try {
    usage = await query.getContextUsage()
  } catch {
    return
  }
  await hooks.reportContextUsage({
    usedTokens: usage.totalTokens,
    maxTokens: usage.maxTokens > 0 ? usage.maxTokens : null,
    model: usage.model.length === 0 ? null : usage.model,
  })
}

/**
 * Run an optional SDK control request, distinguishing failure from an empty answer.
 *
 * Null rather than an empty list, because the two mean different things to the
 * operator: a product that answered "none" has been asked, while a product that
 * could not be asked has not — and only the second should keep the panel saying
 * so. Covers both shapes of failure: a rejected promise from a product that
 * declined the request, and a synchronous throw from an SDK build where the
 * method does not exist at all.
 * @param read - the control request to attempt.
 * @returns what the product reported, or null when it could not be asked.
 */
async function readOrNull<T>(read: () => Promise<T[]>): Promise<T[] | null> {
  try {
    return await read()
  } catch {
    return null
  }
}

export class ClaudeProviderAdapter implements NativeProviderAdapter {
  readonly id = 'claude' as const
  readonly supportsSteer = false
  private readonly active = new Map<string, ActiveClaudeTurn>()
  /**
   * Completions per session, captured during a turn.
   *
   * `supportedCommands()` and `mcpServerStatus()` live on the SDK's Query, which
   * exists only while a turn is running — there is no way to ask an idle session.
   * So the list is read once the query is open and kept, and a session that has
   * never run a turn reports `pending` rather than an empty list. Re-read on
   * every turn, because the operator can add a skill or an MCP server on the Host
   * between turns.
   */
  private readonly completions = new Map<string, BridgeCompletionsResult>()

  constructor(
    private readonly subprocess: SubprocessRuntime,
    private readonly executable: string,
    private readonly graceMs = 3_000,
  ) {}

  async startTurn({ text, hooks }: ProviderTurnRequest): Promise<void> {
    if (this.active.has(hooks.bridgeSessionId)) throw new BridgeError('TURN_CONFLICT')
    const controller = new AbortController()
    const relayAbort = (): void => controller.abort(hooks.signal.reason)
    hooks.signal.addEventListener('abort', relayAbort, { once: true })
    const active: ActiveClaudeTurn = { controller, query: null, child: null }
    this.active.set(hooks.bridgeSessionId, active)
    const options: Options = {
      abortController: controller,
      cwd: hooks.cwd,
      pathToClaudeCodeExecutable: this.executable,
      env: scrubbedParentEnv(),
      includePartialMessages: true,
      permissionMode: CLAUDE_PERMISSION_MODES[hooks.permissionMode],
      canUseTool: permissionCallback(hooks),
      onElicitation: request => onElicitation(hooks, request),
      ...hooks.nativeSessionLocator === null ? {} : { resume: hooks.nativeSessionLocator },
      spawnClaudeCodeProcess: (spawnOptions: SpawnOptions) => {
        const child = this.subprocess.spawn(claudeSpawnSpec(spawnOptions, this.graceMs))
        active.child = child
        return new ManagedClaudeProcess(child)
      },
    }
    const projection: ClaudeTurnProjection = {
      toolNames: new Map(),
      toolInputs: new Map(),
      locatorCaptured: hooks.nativeSessionLocator !== null,
      emittedText: false,
      sawResult: false,
    }
    try {
      active.query = claudeQuery({ prompt: text, options })
      // Fire and forget: the turn must not wait on a convenience read, and a
      // product that refuses the control request still has to run its turn. The
      // catch is the last line of defence — captureCompletions already swallows
      // its own failures, and an unhandled rejection here would surface as a
      // process-level error during an unrelated test or, worse, in production.
      void this.captureCompletions(hooks.bridgeSessionId, active.query).catch(() => {})
      // Read once the query is open and again when the turn ends, so the figure
      // reflects the turn that just ran rather than the one before it.
      void reportUsage(active.query, hooks).catch(() => {})
      for await (const message of active.query) {
        await projectMessage(message, hooks, projection)
      }
      if (!projection.sawResult) throw new BridgeError('PROVIDER_PROTOCOL_ERROR')
      await reportUsage(active.query, hooks).catch(() => {})
    } finally {
      hooks.signal.removeEventListener('abort', relayAbort)
      await this.cleanup(active)
      this.active.delete(hooks.bridgeSessionId)
    }
  }

  async listNativeSessions(cwd: string): Promise<BridgeNativeSessionsResult> {
    try {
      const sessions = await listSessions({
        dir: cwd,
        // The SDK's own guidance for a session picker: excluding programmatic
        // entrypoints gives the same set the operator sees from `/resume` in a
        // terminal, and in particular hides the sessions this bridge created
        // itself — offering those back would be a loop, not a feature.
        includeProgrammatic: false,
        limit: NATIVE_SESSION_LIMIT,
      })
      return {
        sessions: sessions.map(session => ({
          locator: session.sessionId,
          // customTitle is what the operator named it; summary is the product's
          // own; firstPrompt is the last resort. All three are the operator's
          // text round-tripping through the product, so all three are redacted.
          title: redactText(session.customTitle ?? session.summary ?? session.firstPrompt ?? session.sessionId, 200),
          updatedAt: session.lastModified,
          branch: session.gitBranch === undefined ? null : redactText(session.gitBranch, 120),
        })),
        unavailable: false,
      }
    } catch {
      // An SDK build without session enumeration, or an unreadable store. The
      // browser then offers no resume rather than an error.
      return { sessions: [], unavailable: true }
    }
  }

  async listCompletions(bridgeSessionId: string): Promise<BridgeCompletionsResult> {
    return this.completions.get(bridgeSessionId) ?? { completions: [], pending: true }
  }

  /**
   * Read the session's commands and MCP servers off a live query.
   *
   * Every failure is swallowed: this is a browser convenience, and an SDK that
   * declines a control request — an older build, a product mid-shutdown — must
   * not disturb the turn that is starting. The previous list stays in that case,
   * which is better than emptying it.
   * @param bridgeSessionId - session to record against.
   * @param query - the live SDK query for the turn just started.
   */
  private async captureCompletions(bridgeSessionId: string, query: Query): Promise<void> {
    // Each read is wrapped rather than chained with .catch(), because an SDK
    // build that predates one of these control requests has no such method: the
    // call then throws synchronously, before there is a promise to catch on.
    const [commands, servers] = await Promise.all([
      readOrNull(() => query.supportedCommands()),
      readOrNull(() => query.mcpServerStatus()),
    ])
    // Neither request landed, so nothing was learned. Leaving the session pending
    // is the honest answer: recording an empty list would tell the operator this
    // product has no commands, when in fact it was never able to say.
    if (commands === null && servers === null) return
    const completions: BridgeCompletion[] = [
      ...(commands ?? []).map(command => ({
        kind: 'command' as const,
        name: redactText(command.name, 128),
        // Claude Code resolves these as slash commands, so that is the form the
        // composer needs.
        insertText: `/${redactText(command.name, 128)}`,
        description: command.description.length === 0 ? null : redactText(command.description, 512),
        argumentHint: command.argumentHint.length === 0 ? null : redactText(command.argumentHint, 128),
        status: null,
      })),
      ...(servers ?? []).map(server => ({
        kind: 'mcp' as const,
        name: redactText(server.name, 128),
        insertText: null,
        // serverInfo only arrives once connected; its absence is not an error.
        description: server.serverInfo === undefined ? null : redactText(server.serverInfo.name, 512),
        argumentHint: null,
        status: server.status,
      })),
    ]
    // A turn that was cancelled before this resolved must not resurrect state
    // for a session the engine has since disposed.
    if (this.active.has(bridgeSessionId) || this.completions.has(bridgeSessionId)) {
      this.completions.set(bridgeSessionId, { completions, pending: false })
    }
  }

  async steer(): Promise<void> {
    throw new BridgeError('TURN_CONFLICT')
  }

  async cancel(bridgeSessionId: string): Promise<void> {
    const active = this.active.get(bridgeSessionId)
    if (active === undefined) return
    try {
      await active.query?.interrupt()
    } catch {
      // The abort controller and managed process remain authoritative.
    }
    active.controller.abort(new BridgeError('USER_CANCELLED'))
  }

  async disposeSession(bridgeSessionId: string): Promise<void> {
    this.completions.delete(bridgeSessionId)
    const active = this.active.get(bridgeSessionId)
    if (active === undefined) return
    await this.cancel(bridgeSessionId)
    await this.cleanup(active)
    this.active.delete(bridgeSessionId)
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.active.keys()].map(id => this.disposeSession(id)))
  }

  private async cleanup(active: ActiveClaudeTurn): Promise<void> {
    try {
      active.query?.close()
    } catch {
      // Continue to tree-scoped cleanup.
    }
    const child = active.child
    if (child === null) return
    child.terminate()
    await child.waitForExit().catch(() => false)
    await child.done.catch(() => {})
    active.child = null
  }
}
