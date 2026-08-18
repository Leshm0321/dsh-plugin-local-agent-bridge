import type {
  BridgeCompletionsResult,
  BridgeContextUsage,
  BridgePermissionMode,
  BridgeNativeSessionsResult,
  BridgeEvent,
  BridgeInteractionRespondRequest,
  PendingInteractionView,
  ProviderId,
} from '../types.ts'

export type BridgeEventDraft = BridgeEvent extends infer Event
  ? Event extends BridgeEvent
    ? Omit<Event, 'sequence' | 'bridgeSessionId' | 'bridgeTurnId' | 'timestamp'>
    : never
  : never

export interface ProviderInteractionRequest {
  readonly kind: PendingInteractionView['kind']
  readonly safeSummary: string
  readonly toolName: string | null
  readonly target: string | null
  readonly questions: PendingInteractionView['questions']
}

export type ProviderInteractionResolution = BridgeInteractionRespondRequest['resolution']

export interface ProviderTurnHooks {
  readonly bridgeSessionId: string
  readonly bridgeTurnId: string
  readonly cwd: string
  readonly nativeSessionLocator: string | null
  /**
   * How much the agent may do without asking, as the operator set it.
   *
   * Delivered per turn because both products take it when a turn starts: Claude
   * Code as `Options.permissionMode`, Codex as the turn's approval policy and
   * collaboration mode. That is also why a change applies from the next turn
   * rather than mid-flight.
   */
  readonly permissionMode: BridgePermissionMode
  readonly signal: AbortSignal
  emit(event: BridgeEventDraft): Promise<void>
  setNativeSessionLocator(locator: string): Promise<void>
  /**
   * Record how much context the product says the session has consumed.
   *
   * A hook rather than a return value because the two products deliver it
   * differently — Claude Code answers a control request during the turn, Codex
   * pushes a notification whenever it changes — and both want to report more than
   * once per turn.
   * @param usage - the product's latest figures.
   */
  reportContextUsage(usage: BridgeContextUsage): Promise<void>
  requestInteraction(request: ProviderInteractionRequest): Promise<ProviderInteractionResolution>
}

export interface ProviderTurnRequest {
  readonly text: string
  readonly hooks: ProviderTurnHooks
}

export interface NativeProviderAdapter {
  readonly id: ProviderId
  readonly supportsSteer: boolean
  /**
   * The slash commands, skills and MCP servers this session can use, as the
   * product reports them.
   *
   * Optional because it is a read-only convenience: a provider that cannot
   * enumerate them simply omits it, and the browser shows no completions rather
   * than the bridge inventing any. Never throws for a product that has nothing
   * to say yet — `pending` distinguishes "not asked" from "asked, none".
   * @param bridgeSessionId - the session whose product state to report.
   * @param cwd - the session's workspace directory. Skills are discovered per
   * directory, so passing it lets a product answer before the session has ever
   * run a turn; the path comes from the Host's own workspace registry, never
   * from the browser.
   */
  listCompletions?(bridgeSessionId: string, cwd: string): Promise<BridgeCompletionsResult>
  /**
   * Sessions the product already has for this directory, which the operator
   * could continue in the browser.
   *
   * Enumerated through the product's own API, never by reading its state
   * directory. Optional for the same reason as `listCompletions`: a provider
   * that cannot enumerate reports nothing rather than the bridge guessing.
   * @param cwd - the workspace directory to scope the listing to.
   */
  listNativeSessions?(cwd: string): Promise<BridgeNativeSessionsResult>
  startTurn(request: ProviderTurnRequest): Promise<void>
  steer(bridgeSessionId: string, text: string): Promise<void>
  cancel(bridgeSessionId: string): Promise<void>
  disposeSession(bridgeSessionId: string): Promise<void>
  dispose(): Promise<void>
}

