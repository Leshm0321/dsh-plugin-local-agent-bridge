import { randomUUID } from 'node:crypto'
import type {
  BridgeEvent,
  BridgeInteractionRespondRequest,
  BridgeInteractionRespondResult,
  BridgeSendResult,
  BridgeSessionCreateRequest,
  BridgeSessionReadRequest,
  BridgeSessionReadResult,
  BridgeCompletionsResult,
  BridgeFileSearchResult,
  BridgeModelsResult,
  BridgeNativeSessionsResult,
  BridgePermissionMode,
  BridgeRateLimit,
  BridgeSessionStatus,
  BridgeSessionView,
  BridgeStatusNote,
  BridgeTurnStatus,
  BridgeTurnView,
  PendingInteractionView,
  ProviderId,
} from '../types.ts'
import { BridgeError, bridgeError } from './errors.ts'
import { searchFiles } from './file-search.ts'
import type {
  BridgeEventDraft,
  NativeProviderAdapter,
  ProviderInteractionRequest,
  ProviderInteractionResolution,
} from './provider.ts'
import type { BridgePersistence, PersistedBridgeSession } from './persistence.ts'
import { redactText, redactValue } from './redaction.ts'

const DEFAULT_EVENT_RETENTION = 2_000
const DEFAULT_LONG_POLL_MAX_MS = 25_000
const MAX_INPUT_LENGTH = 65_536

export interface ResolvedBridgeWorkspace {
  readonly id: string
  readonly title: string
  readonly cwd: string
  readonly status: 'ok' | 'missing-dir'
}

export interface SessionEngineOptions {
  readonly persistence: BridgePersistence
  readonly providers: ReadonlyMap<ProviderId, NativeProviderAdapter>
  readonly resolveWorkspace: (workspaceId: string) => Promise<ResolvedBridgeWorkspace | undefined>
  readonly eventRetention?: number
  readonly longPollMaxMs?: number
}

interface PendingResolution {
  readonly interactionId: string
  readonly kind: PendingInteractionView['kind']
  readonly resolve: (resolution: ProviderInteractionResolution) => void
  readonly reject: (error: Error) => void
}

interface RuntimeSession {
  readonly record: PersistedBridgeSession
  activeTurn: BridgeTurnView | null
  activeAbort: AbortController | null
  activeRun: Promise<void> | null
  pendingResolution: PendingResolution | null
  waiters: Set<() => void>
}

function sessionView(record: PersistedBridgeSession): BridgeSessionView {
  return {
    bridgeSessionId: record.bridgeSessionId,
    providerId: record.providerId,
    workspaceId: record.workspaceId,
    workspaceTitle: record.workspaceTitle,
    title: record.title,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastTurnId: record.lastTurnId,
    queuedInputCount: record.queuedInputs.length,
    archived: record.archived,
    persistenceVersion: record.persistenceVersion,
    contextUsage: record.contextUsage ?? null,
    // `auto` is the default both products ship with, and the mode a record
    // written before this field existed was effectively running under.
    permissionMode: record.permissionMode ?? 'auto',
    model: record.model ?? null,
    effort: record.effort ?? null,
    rateLimits: record.rateLimits ?? [],
  }
}

function terminalTurn(
  turn: BridgeTurnView,
  status: BridgeTurnStatus,
  stopReason: string | null,
): BridgeTurnView {
  return {
    ...turn,
    status,
    completedAt: Date.now(),
    stopReason,
  }
}

function normalizeInput(text: string): string {
  const normalized = text.trim()
  if (normalized.length === 0 || normalized.length > MAX_INPUT_LENGTH) {
    throw new BridgeError('INVALID_REQUEST')
  }
  return redactText(normalized, MAX_INPUT_LENGTH)
}

/**
 * Fold a freshly reported allowance into the ones already held.
 *
 * Keyed by window so a product reporting several allowances shows several rows
 * rather than one that flickers between them — a five-hour figure and a weekly
 * figure are different facts, and overwriting one with the other would make the
 * readout lie about whichever arrived first.
 * @param held - allowances currently recorded.
 * @param limit - what the product just reported.
 * @returns the merged list, newest value per window.
 */
function mergeRateLimit(held: readonly BridgeRateLimit[], limit: BridgeRateLimit): BridgeRateLimit[] {
  const clean: BridgeRateLimit = {
    window: limit.window === null ? null : redactText(limit.window, 64),
    utilization: limit.utilization === null ? null : Math.min(1, Math.max(0, limit.utilization)),
    status: limit.status,
    resetsAt: limit.resetsAt === null || !Number.isFinite(limit.resetsAt)
      ? null
      : Math.trunc(limit.resetsAt),
  }
  const kept = held.filter(entry => entry.window !== clean.window)
  return [...kept, clean].sort((left, right) => (left.window ?? '').localeCompare(right.window ?? ''))
}

function isRecoverableNativeSession(record: PersistedBridgeSession): boolean {
  return record.nativeSessionLocator !== null
}

/** Host-owned durable session state machine shared by every native provider. */
export class BridgeSessionEngine {
  private readonly persistence: BridgePersistence
  private readonly providers: ReadonlyMap<ProviderId, NativeProviderAdapter>
  private readonly resolveWorkspace: SessionEngineOptions['resolveWorkspace']
  private readonly eventRetention: number
  private readonly longPollMaxMs: number
  private readonly sessions = new Map<string, RuntimeSession>()
  private disposed = false

  private constructor(options: SessionEngineOptions) {
    this.persistence = options.persistence
    this.providers = options.providers
    this.resolveWorkspace = options.resolveWorkspace
    this.eventRetention = options.eventRetention ?? DEFAULT_EVENT_RETENTION
    this.longPollMaxMs = options.longPollMaxMs ?? DEFAULT_LONG_POLL_MAX_MS
  }

  static async create(options: SessionEngineOptions): Promise<BridgeSessionEngine> {
    const engine = new BridgeSessionEngine(options)
    for (const record of options.persistence.list()) {
      await engine.restore(record)
    }
    return engine
  }

  list(includeArchived = false): BridgeSessionView[] {
    this.assertActive()
    return [...this.sessions.values()]
      .map(runtime => runtime.record)
      .filter(record => includeArchived || !record.archived)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map(sessionView)
  }

  async createSession(request: BridgeSessionCreateRequest): Promise<BridgeSessionView> {
    this.assertActive()
    const provider = this.providers.get(request.providerId)
    if (provider === undefined || request.providerId === 'fake' && !this.providers.has('fake')) {
      throw new BridgeError('INVALID_REQUEST')
    }
    const workspace = await this.resolveWorkspace(request.workspaceId)
    if (workspace === undefined || workspace.status !== 'ok') {
      throw new BridgeError('WORKSPACE_NOT_AVAILABLE')
    }
    const now = Date.now()
    const bridgeSessionId = randomUUID()
    const title = redactText(request.title?.trim() || `${provider.id === 'claude' ? 'Claude Code' : provider.id === 'codex' ? 'Codex' : 'Fixture'} - ${workspace.title}`, 256)
    const record: PersistedBridgeSession = {
      bridgeSessionId,
      providerId: provider.id,
      workspaceId: workspace.id,
      workspaceTitle: redactText(workspace.title, 256),
      title,
      status: 'idle',
      createdAt: now,
      updatedAt: now,
      lastTurnId: null,
      // A resume request seeds the locator the providers already know how to
      // use: Claude's SDK `resume` and Codex's `thread/resume` both take it on
      // the first turn, so continuing an existing session needs no new path
      // through either adapter. The bridge never inspects it — an unknown or
      // expired locator ends up `orphaned`, the same as one that stopped
      // resolving across a Host restart.
      permissionMode: request.permissionMode ?? 'auto',
      // Null, not a bridge-chosen default: whichever model the operator has
      // configured the product to use is the right one until they say otherwise,
      // and this bridge has no business overriding a CLI's own setting.
      model: null,
      effort: null,
      rateLimits: [],
      nativeSessionLocator: request.resumeLocator === undefined
        ? null
        : redactText(request.resumeLocator, 512),
      queuedInputs: [],
      archived: false,
      persistenceVersion: 1,
      nextSequence: 1,
      events: [],
      pendingInteraction: null,
    }
    const runtime: RuntimeSession = {
      record,
      activeTurn: null,
      activeAbort: null,
      activeRun: null,
      pendingResolution: null,
      waiters: new Set(),
    }
    this.sessions.set(bridgeSessionId, runtime)
    await this.append(runtime, null, {
      type: 'bridge/session-created',
      data: { session: sessionView(record) },
    })
    return sessionView(record)
  }

  async archiveSession(bridgeSessionId: string, archived = true): Promise<BridgeSessionView> {
    const runtime = this.requireSession(bridgeSessionId)
    runtime.record.archived = archived
    await this.touch(runtime)
    return sessionView(runtime.record)
  }

  async read(request: BridgeSessionReadRequest, signal?: AbortSignal): Promise<BridgeSessionReadResult> {
    const runtime = this.requireSession(request.bridgeSessionId)
    const afterSequence = request.afterSequence ?? 0
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new BridgeError('INVALID_REQUEST')
    }
    const waitMs = Math.min(Math.max(request.waitMs ?? 0, 0), this.longPollMaxMs)
    if (waitMs > 0 && !this.hasEventsAfter(runtime, afterSequence)) {
      await this.waitForEvent(runtime, waitMs, signal)
    }
    const earliest = runtime.record.events[0]?.sequence ?? runtime.record.nextSequence
    const reset = afterSequence < earliest - 1
    const events = reset
      ? runtime.record.events
      : runtime.record.events.filter(event => event.sequence > afterSequence)
    return {
      session: sessionView(runtime.record),
      pendingInteraction: runtime.record.pendingInteraction,
      events,
      latestSequence: runtime.record.nextSequence - 1,
      reset,
    }
  }

  async send(bridgeSessionId: string, rawText: string): Promise<BridgeSendResult> {
    const runtime = this.requireSession(bridgeSessionId)
    const text = normalizeInput(rawText)
    const provider = this.requireProvider(runtime.record.providerId)
    if (runtime.activeRun === null) {
      const bridgeTurnId = randomUUID()
      await this.launchTurn(runtime, provider, bridgeTurnId, text)
      return { delivery: 'started', bridgeTurnId }
    }
    if (provider.supportsSteer && runtime.record.status === 'running' && runtime.activeTurn !== null) {
      await provider.steer(bridgeSessionId, text)
      await this.append(runtime, runtime.activeTurn.bridgeTurnId, {
        type: 'bridge/user-message',
        data: { text, delivery: 'steered' },
      })
      return { delivery: 'steered', bridgeTurnId: runtime.activeTurn.bridgeTurnId }
    }
    runtime.record.queuedInputs.push(text)
    const bridgeTurnId = runtime.activeTurn?.bridgeTurnId ?? runtime.record.lastTurnId ?? randomUUID()
    await this.append(runtime, bridgeTurnId, {
      type: 'bridge/user-message',
      data: { text, delivery: 'queued' },
    })
    return {
      delivery: 'queued',
      bridgeTurnId,
    }
  }

  async cancel(bridgeSessionId: string): Promise<void> {
    const runtime = this.requireSession(bridgeSessionId)
    if (runtime.activeRun === null || runtime.activeAbort === null) return
    await this.setStatus(runtime, 'cancelling', 'cancelling-turn')
    await this.cancelPendingInteraction(runtime, runtime.activeTurn?.bridgeTurnId ?? runtime.record.lastTurnId)
    runtime.activeAbort.abort(new BridgeError('USER_CANCELLED'))
    await this.requireProvider(runtime.record.providerId).cancel(bridgeSessionId).catch(() => {})
  }

  async respondInteraction(
    request: BridgeInteractionRespondRequest,
  ): Promise<BridgeInteractionRespondResult> {
    const runtime = this.requireSession(request.bridgeSessionId)
    const pending = runtime.record.pendingInteraction
    const resolution = runtime.pendingResolution
    if (
      pending === null
      || resolution === null
      || pending.interactionId !== request.interactionId
      || resolution.interactionId !== request.interactionId
      || request.resolution.kind !== pending.kind
    ) {
      throw new BridgeError('INTERACTION_EXPIRED')
    }
    runtime.record.pendingInteraction = null
    runtime.pendingResolution = null
    await this.append(runtime, pending.bridgeTurnId, {
      type: 'bridge/interaction-resolved',
      data: {
        interactionId: pending.interactionId,
        outcome: request.resolution.kind === 'question'
          ? 'answered'
          : request.resolution.action === 'allow'
            ? 'allowed'
            : request.resolution.action === 'deny'
              ? 'denied'
              : 'cancelled',
      },
    })
    await this.setStatus(runtime, 'running', null)
    resolution.resolve(request.resolution)
    return { accepted: true }
  }

  /**
   * The slash commands, skills and MCP servers the session's product reports.
   *
   * A provider that cannot enumerate them, or has not been asked yet, yields an
   * empty list marked pending — the browser then shows nothing rather than the
   * bridge inventing entries the product would not understand.
   * @param bridgeSessionId - the session to report for.
   * @returns the product's completions.
   */
  async listCompletions(bridgeSessionId: string): Promise<BridgeCompletionsResult> {
    const runtime = this.requireSession(bridgeSessionId)
    const provider = this.providers.get(runtime.record.providerId)
    if (provider?.listCompletions === undefined) return { completions: [], pending: false }
    try {
      const workspace = await this.requireWorkspace(runtime.record.workspaceId)
      return await provider.listCompletions(bridgeSessionId, workspace.cwd)
    } catch {
      // Enumeration is a convenience; a product that refuses must not turn a
      // panel refresh into an error banner.
      return { completions: [], pending: true }
    }
  }

  /**
   * Product-native sessions for a workspace that the operator could continue.
   * @param workspaceId - the workspace to scope the listing to.
   * @returns the product's sessions, or `unavailable` when it cannot enumerate.
   */
  async listNativeSessions(
    providerId: ProviderId,
    workspaceId: string,
  ): Promise<BridgeNativeSessionsResult> {
    this.assertActive()
    const provider = this.providers.get(providerId)
    if (provider?.listNativeSessions === undefined) return { sessions: [], unavailable: true }
    const workspace = await this.resolveWorkspace(workspaceId)
    if (workspace === undefined || workspace.status !== 'ok') {
      throw new BridgeError('WORKSPACE_NOT_AVAILABLE')
    }
    try {
      return await provider.listNativeSessions(workspace.cwd)
    } catch {
      return { sessions: [], unavailable: true }
    }
  }

  /**
   * Set the session's permission mode, effective from its next turn.
   *
   * Not applied to a turn already running: both products take the setting when a
   * turn starts, and pretending otherwise would show the operator a mode the
   * agent is not actually obeying.
   * @param bridgeSessionId - the session to change.
   * @param mode - the requested mode.
   * @returns the updated session view.
   */
  async setPermissionMode(
    bridgeSessionId: string,
    mode: BridgePermissionMode,
  ): Promise<BridgeSessionView> {
    this.assertActive()
    const runtime = this.requireSession(bridgeSessionId)
    runtime.record.permissionMode = mode
    await this.touch(runtime)
    return sessionView(runtime.record)
  }

  /**
   * Models the session's product will accept, as the product reports them.
   * @param bridgeSessionId - the session asking.
   * @returns the product's models, or `unavailable` when it cannot be asked.
   */
  async listModels(bridgeSessionId: string): Promise<BridgeModelsResult> {
    this.assertActive()
    const runtime = this.requireSession(bridgeSessionId)
    const provider = this.providers.get(runtime.record.providerId)
    if (provider?.listModels === undefined) return { models: [], unavailable: true }
    try {
      return await provider.listModels(bridgeSessionId)
    } catch {
      return { models: [], unavailable: true }
    }
  }

  /**
   * Set the model and reasoning effort the session asks for, from its next turn.
   *
   * Validated against the product's own list when that list can be read, so a
   * combination the product would silently ignore is refused here instead of
   * appearing to take effect. When the product cannot be asked — Claude Code
   * before any turn has run — the request is accepted as given: the panel only
   * offers what the product reported, so this path is reachable only by calling
   * the method directly, and second-guessing the caller with a stale list would
   * be worse than letting the product answer for itself.
   * @param bridgeSessionId - the session to change.
   * @param model - the model id, or null for the product's default.
   * @param effort - the reasoning effort, or null for the product's default.
   * @returns the updated session view.
   */
  async setModel(
    bridgeSessionId: string,
    model: string | null,
    effort: string | null,
  ): Promise<BridgeSessionView> {
    this.assertActive()
    const runtime = this.requireSession(bridgeSessionId)
    const available = await this.listModels(bridgeSessionId)
    if (!available.unavailable && model !== null) {
      const chosen = available.models.find(entry => entry.id === model)
      if (chosen === undefined) throw new BridgeError('INVALID_REQUEST')
      if (effort !== null && !chosen.efforts.includes(effort)) throw new BridgeError('INVALID_REQUEST')
    }
    // An effort without a model has nothing to be validated against and nothing
    // to apply to, since effort levels are per model in both products.
    if (model === null && effort !== null) throw new BridgeError('INVALID_REQUEST')
    runtime.record.model = model === null ? null : redactText(model, 128)
    runtime.record.effort = effort === null ? null : redactText(effort, 64)
    await this.touch(runtime)
    return sessionView(runtime.record)
  }

  /**
   * Files under the session's working directory matching a query.
   *
   * The root comes from the Host's own workspace resolution, never from the
   * browser, so `@` can only ever see inside the directory the session runs in.
   * @param bridgeSessionId - the session, which supplies the root.
   * @param query - what the operator typed after `@`.
   * @returns ranked matches.
   */
  async searchFiles(bridgeSessionId: string, query: string): Promise<BridgeFileSearchResult> {
    this.assertActive()
    const runtime = this.requireSession(bridgeSessionId)
    const workspace = await this.requireWorkspace(runtime.record.workspaceId)
    return await searchFiles(workspace.cwd, query)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const failures: Error[] = []
    for (const runtime of this.sessions.values()) {
      runtime.activeAbort?.abort(new BridgeError('USER_CANCELLED'))
      runtime.pendingResolution?.reject(new BridgeError('USER_CANCELLED'))
      this.wake(runtime)
    }
    for (const provider of new Set(this.providers.values())) {
      try {
        await provider.dispose()
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)))
      }
    }
    await this.persistence.close()
    if (failures.length > 0) throw new AggregateError(failures, 'local-agent-bridge: provider cleanup failed')
  }

  private async restore(record: PersistedBridgeSession): Promise<void> {
    const runtime: RuntimeSession = {
      record,
      activeTurn: null,
      activeAbort: null,
      activeRun: null,
      pendingResolution: null,
      waiters: new Set(),
    }
    this.sessions.set(record.bridgeSessionId, runtime)
    const interrupted = record.pendingInteraction !== null || [
      'creating', 'running', 'awaiting-approval', 'awaiting-answer', 'cancelling', 'disconnected',
    ].includes(record.status)
    if (!interrupted) return
    const pendingInteraction = record.pendingInteraction
    record.pendingInteraction = null
    record.status = isRecoverableNativeSession(record) ? 'idle' : 'orphaned'
    if (pendingInteraction !== null) {
      await this.append(runtime, pendingInteraction.bridgeTurnId, {
        type: 'bridge/interaction-resolved',
        data: { interactionId: pendingInteraction.interactionId, outcome: 'expired' },
      })
    }
    const interruptedTurn = this.interruptedTurn(record)
    if (interruptedTurn !== null) {
      await this.append(runtime, interruptedTurn.bridgeTurnId, {
        type: 'bridge/turn-completed',
        data: { turn: terminalTurn(interruptedTurn, 'cancelled', 'CONNECTION_LOST') },
      })
    }
    await this.append(runtime, record.lastTurnId, {
      type: 'bridge/session-status',
      data: {
        status: record.status,
        note: isRecoverableNativeSession(record)
          ? 'host-restarted-resumable'
          : 'host-restarted-orphaned',
      },
    })
  }

  private async launchTurn(
    runtime: RuntimeSession,
    provider: NativeProviderAdapter,
    bridgeTurnId: string,
    text: string,
  ): Promise<void> {
    const controller = new AbortController()
    const turn: BridgeTurnView = {
      bridgeTurnId,
      bridgeSessionId: runtime.record.bridgeSessionId,
      status: 'running',
      startedAt: Date.now(),
      completedAt: null,
      stopReason: null,
    }
    runtime.activeAbort = controller
    runtime.activeTurn = turn
    runtime.record.lastTurnId = bridgeTurnId
    await this.setStatus(runtime, 'running', null)
    await this.append(runtime, bridgeTurnId, {
      type: 'bridge/user-message',
      data: { text, delivery: 'started' },
    })
    await this.append(runtime, bridgeTurnId, {
      type: 'bridge/turn-started',
      data: { turn },
    })

    const active = this.executeTurn(runtime, provider, turn, text, controller)
    runtime.activeRun = active
    void active.catch(() => {})
  }

  private async executeTurn(
    runtime: RuntimeSession,
    provider: NativeProviderAdapter,
    turn: BridgeTurnView,
    text: string,
    controller: AbortController,
  ): Promise<void> {
    let completed: BridgeTurnView
    let terminalStatus: BridgeSessionStatus
    try {
      await provider.startTurn({
        text,
        hooks: {
          bridgeSessionId: runtime.record.bridgeSessionId,
          bridgeTurnId: turn.bridgeTurnId,
          cwd: (await this.requireWorkspace(runtime.record.workspaceId)).cwd,
          nativeSessionLocator: runtime.record.nativeSessionLocator,
          permissionMode: runtime.record.permissionMode ?? 'auto',
          model: runtime.record.model ?? null,
          effort: runtime.record.effort ?? null,
          signal: controller.signal,
          emit: event => this.append(runtime, turn.bridgeTurnId, event),
          reportContextUsage: async (usage) => {
            runtime.record.contextUsage = {
              usedTokens: Math.max(0, Math.trunc(usage.usedTokens)),
              maxTokens: usage.maxTokens === null ? null : Math.max(0, Math.trunc(usage.maxTokens)),
              model: usage.model === null ? null : redactText(usage.model, 128),
            }
            await this.touch(runtime)
          },
          reportRateLimit: async (limit) => {
            runtime.record.rateLimits = mergeRateLimit(runtime.record.rateLimits ?? [], limit)
            await this.touch(runtime)
          },
          setNativeSessionLocator: async (locator) => {
            if (locator.trim().length === 0) throw new BridgeError('PROVIDER_PROTOCOL_ERROR')
            runtime.record.nativeSessionLocator = redactText(locator, 512)
            await this.touch(runtime)
          },
          requestInteraction: request => this.requestInteraction(runtime, turn, request, controller.signal),
        },
      })
      completed = terminalTurn(turn, 'completed', 'completed')
      terminalStatus = 'idle'
    } catch (error) {
      const normalized = bridgeError(error, 'PROVIDER_START_FAILED')
      const cancelled = controller.signal.aborted || normalized.code === 'USER_CANCELLED'
      // An aborted turn is a cancellation whatever the vendor product reported.
      // bridgeError classifies by message pattern, and neither the Claude Agent
      // SDK nor the Codex App Server emits a stable cancellation marker when its
      // transport is torn down mid-turn, so the raw normalization lands on the
      // fallback code. Reporting that verbatim told the browser the product
      // could not be started, which is both wrong and alarming for what the
      // operator just requested. The abort signal is the authoritative witness.
      const reported = cancelled ? new BridgeError('USER_CANCELLED') : normalized
      completed = terminalTurn(turn, cancelled ? 'cancelled' : 'failed', reported.code)
      await this.append(runtime, turn.bridgeTurnId, {
        type: 'bridge/error',
        data: { code: reported.code, message: reported.message },
      })
      terminalStatus = cancelled ? 'idle' : reported.code === 'HOST_AUTH_REQUIRED'
        ? 'auth-required'
        : reported.code === 'NATIVE_SESSION_ORPHANED'
          ? 'orphaned'
          : 'failed'
    } finally {
      const pending = runtime.pendingResolution
      if (pending !== null) {
        await this.cancelPendingInteraction(runtime, turn.bridgeTurnId)
      }
      await this.append(runtime, turn.bridgeTurnId, {
        type: 'bridge/turn-completed',
        data: { turn: completed! },
      })
      runtime.activeAbort = null
      runtime.activeTurn = null
      runtime.activeRun = null
      await this.setStatus(runtime, terminalStatus!, null)
      if (terminalStatus! === 'idle' && runtime.record.queuedInputs.length > 0) {
        const next = runtime.record.queuedInputs.shift()
        if (next !== undefined) {
          await this.touch(runtime)
          await this.launchTurn(runtime, provider, randomUUID(), next)
        }
      }
    }
  }

  private async requestInteraction(
    runtime: RuntimeSession,
    turn: BridgeTurnView,
    request: ProviderInteractionRequest,
    signal: AbortSignal,
  ): Promise<ProviderInteractionResolution> {
    if (runtime.pendingResolution !== null || runtime.record.pendingInteraction !== null) {
      throw new BridgeError('TURN_CONFLICT')
    }
    const interactionId = randomUUID()
    const interaction: PendingInteractionView = redactValue({
      interactionId,
      bridgeSessionId: runtime.record.bridgeSessionId,
      bridgeTurnId: turn.bridgeTurnId,
      kind: request.kind,
      providerId: runtime.record.providerId,
      safeSummary: request.safeSummary,
      toolName: request.toolName,
      target: request.target,
      questions: request.questions,
      expiresAt: null,
    })
    const deferred = Promise.withResolvers<ProviderInteractionResolution>()
    runtime.pendingResolution = {
      interactionId,
      kind: request.kind,
      resolve: deferred.resolve,
      reject: deferred.reject,
    }
    runtime.record.pendingInteraction = interaction
    await this.setStatus(runtime, request.kind === 'approval' ? 'awaiting-approval' : 'awaiting-answer', null)
    await this.append(runtime, turn.bridgeTurnId, {
      type: 'bridge/interaction-requested',
      data: { interaction },
    })
    const onAbort = (): void => deferred.reject(new BridgeError('USER_CANCELLED'))
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      return await deferred.promise
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  private interruptedTurn(record: PersistedBridgeSession): BridgeTurnView | null {
    if (record.lastTurnId === null) return null
    for (let index = record.events.length - 1; index >= 0; index -= 1) {
      const event = record.events[index]
      if (event?.type === 'bridge/turn-completed' && event.bridgeTurnId === record.lastTurnId) return null
      if (event?.type === 'bridge/turn-started' && event.bridgeTurnId === record.lastTurnId) return event.data.turn
    }
    return null
  }

  private async cancelPendingInteraction(runtime: RuntimeSession, bridgeTurnId: string | null): Promise<void> {
    const pending = runtime.pendingResolution
    const interaction = runtime.record.pendingInteraction
    if (pending === null || interaction === null) return
    runtime.pendingResolution = null
    runtime.record.pendingInteraction = null
    pending.reject(new BridgeError('USER_CANCELLED'))
    await this.append(runtime, bridgeTurnId, {
      type: 'bridge/interaction-resolved',
      data: { interactionId: interaction.interactionId, outcome: 'cancelled' },
    })
  }

  /**
   * Record a status transition and publish it.
   * @param runtime - the live session.
   * @param status - the status being entered.
   * @param note - why, as a code the Client localizes; null when the reason is
   * already carried by an adjacent `bridge/error` event or needs no explaining.
   */
  private async setStatus(
    runtime: RuntimeSession,
    status: BridgeSessionStatus,
    note: BridgeStatusNote | null,
  ): Promise<void> {
    runtime.record.status = status
    await this.append(runtime, runtime.activeTurn?.bridgeTurnId ?? runtime.record.lastTurnId, {
      type: 'bridge/session-status',
      // A fixed code needs no redaction; there is no free text left to leak.
      data: { status, note },
    })
  }

  private async append(
    runtime: RuntimeSession,
    bridgeTurnId: string | null,
    draft: BridgeEventDraft,
  ): Promise<void> {
    const event = redactValue({
      ...draft,
      sequence: runtime.record.nextSequence,
      bridgeSessionId: runtime.record.bridgeSessionId,
      bridgeTurnId,
      timestamp: Date.now(),
    }) as BridgeEvent
    runtime.record.nextSequence += 1
    runtime.record.events.push(event)
    if (runtime.record.events.length > this.eventRetention) {
      runtime.record.events.splice(0, runtime.record.events.length - this.eventRetention)
    }
    await this.touch(runtime)
    this.wake(runtime)
  }

  private async touch(runtime: RuntimeSession): Promise<void> {
    runtime.record.updatedAt = Date.now()
    runtime.record.persistenceVersion += 1
    await this.persistence.put(runtime.record)
  }

  private hasEventsAfter(runtime: RuntimeSession, sequence: number): boolean {
    return runtime.record.nextSequence - 1 > sequence
  }

  private waitForEvent(runtime: RuntimeSession, waitMs: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      const done = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', aborted)
        runtime.waiters.delete(done)
        resolve()
      }
      const aborted = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        runtime.waiters.delete(done)
        reject(signal?.reason instanceof Error ? signal.reason : new BridgeError('CONNECTION_LOST'))
      }
      const timer = setTimeout(done, waitMs)
      runtime.waiters.add(done)
      if (signal?.aborted === true) aborted()
      else signal?.addEventListener('abort', aborted, { once: true })
    })
  }

  private wake(runtime: RuntimeSession): void {
    for (const waiter of runtime.waiters) waiter()
  }

  private requireSession(bridgeSessionId: string): RuntimeSession {
    this.assertActive()
    const runtime = this.sessions.get(bridgeSessionId)
    if (runtime === undefined) throw new BridgeError('SESSION_NOT_FOUND')
    return runtime
  }

  private requireProvider(providerId: ProviderId): NativeProviderAdapter {
    const provider = this.providers.get(providerId)
    if (provider === undefined) throw new BridgeError('PROVIDER_START_FAILED')
    return provider
  }

  private async requireWorkspace(workspaceId: string): Promise<ResolvedBridgeWorkspace> {
    const workspace = await this.resolveWorkspace(workspaceId)
    if (workspace === undefined || workspace.status !== 'ok') {
      throw new BridgeError('WORKSPACE_NOT_AVAILABLE')
    }
    return workspace
  }

  private assertActive(): void {
    if (this.disposed) throw new BridgeError('CONNECTION_LOST')
  }
}
