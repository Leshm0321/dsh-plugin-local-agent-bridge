import type {
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
  startTurn(request: ProviderTurnRequest): Promise<void>
  steer(bridgeSessionId: string, text: string): Promise<void>
  cancel(bridgeSessionId: string): Promise<void>
  disposeSession(bridgeSessionId: string): Promise<void>
  dispose(): Promise<void>
}

