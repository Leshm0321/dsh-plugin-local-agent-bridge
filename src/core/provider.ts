import type {
  BridgeCompletionsResult,
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
  readonly signal: AbortSignal
  emit(event: BridgeEventDraft): Promise<void>
  setNativeSessionLocator(locator: string): Promise<void>
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
  startTurn(request: ProviderTurnRequest): Promise<void>
  steer(bridgeSessionId: string, text: string): Promise<void>
  cancel(bridgeSessionId: string): Promise<void>
  disposeSession(bridgeSessionId: string): Promise<void>
  dispose(): Promise<void>
}

