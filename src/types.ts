/** Public, browser-safe wire vocabulary for the Local Agent Bridge. */

export type ProviderId = 'codex' | 'claude' | 'fake'

export type ProviderCompatibility = 'supported' | 'unsupported' | 'unknown'

export type ProviderHealth =
  | 'not-installed'
  | 'installed'
  | 'ready'
  | 'auth-required'
  | 'error'

export interface NativeProviderView {
  readonly id: ProviderId
  readonly displayName: string
  readonly installed: boolean
  readonly version: string | null
  readonly compatibility: ProviderCompatibility
  readonly health: ProviderHealth
  readonly message: string | null
}

export interface BridgeWorkspaceView {
  readonly id: string
  readonly title: string
  readonly status: 'ok' | 'missing-dir'
}

export type BridgeSessionStatus =
  | 'creating'
  | 'idle'
  | 'running'
  | 'awaiting-approval'
  | 'awaiting-answer'
  | 'cancelling'
  | 'disconnected'
  | 'auth-required'
  | 'failed'
  | 'orphaned'

export type BridgeTurnStatus =
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'failed'

export type BridgeErrorCode =
  | 'EXECUTABLE_NOT_FOUND'
  | 'UNSUPPORTED_VERSION'
  | 'PROVIDER_START_FAILED'
  | 'HOST_AUTH_REQUIRED'
  | 'PROVIDER_PROTOCOL_ERROR'
  | 'WORKSPACE_NOT_AVAILABLE'
  | 'SESSION_NOT_FOUND'
  | 'NATIVE_SESSION_ORPHANED'
  | 'TURN_CONFLICT'
  | 'INTERACTION_EXPIRED'
  | 'USER_CANCELLED'
  | 'CONTEXT_LIMIT'
  | 'CONNECTION_LOST'
  | 'CLEANUP_FAILED'
  | 'INVALID_REQUEST'

export interface BridgeSessionView {
  readonly bridgeSessionId: string
  readonly providerId: ProviderId
  readonly workspaceId: string
  readonly workspaceTitle: string
  readonly title: string
  readonly status: BridgeSessionStatus
  readonly createdAt: number
  readonly updatedAt: number
  readonly lastTurnId: string | null
  readonly queuedInputCount: number
  readonly archived: boolean
  readonly persistenceVersion: number
}

export interface BridgeTurnView {
  readonly bridgeTurnId: string
  readonly bridgeSessionId: string
  readonly status: BridgeTurnStatus
  readonly startedAt: number
  readonly completedAt: number | null
  readonly stopReason: string | null
}

export interface BridgeInteractionOption {
  readonly value: string
  readonly label: string
  readonly description: string | null
}

export interface BridgeQuestion {
  readonly id: string
  readonly header: string
  readonly prompt: string
  readonly secret: boolean
  readonly allowFreeText: boolean
  readonly multiSelect: boolean
  readonly options: readonly BridgeInteractionOption[]
}

export interface PendingInteractionView {
  readonly interactionId: string
  readonly bridgeSessionId: string
  readonly bridgeTurnId: string
  readonly kind: 'approval' | 'question'
  readonly providerId: ProviderId
  readonly safeSummary: string
  readonly toolName: string | null
  readonly target: string | null
  readonly questions: readonly BridgeQuestion[]
  readonly expiresAt: number | null
}

interface BridgeEventBase {
  readonly sequence: number
  readonly bridgeSessionId: string
  readonly bridgeTurnId: string | null
  readonly timestamp: number
}

export type BridgeEvent =
  | BridgeEventBase & {
    readonly type: 'bridge/session-created'
    readonly data: { readonly session: BridgeSessionView }
  }
  | BridgeEventBase & {
    readonly type: 'bridge/session-status'
    readonly data: { readonly status: BridgeSessionStatus; readonly message: string | null }
  }
  | BridgeEventBase & {
    readonly type: 'bridge/user-message'
    readonly data: { readonly text: string; readonly delivery: 'started' | 'steered' | 'queued' }
  }
  | BridgeEventBase & {
    readonly type: 'bridge/turn-started'
    readonly data: { readonly turn: BridgeTurnView }
  }
  | BridgeEventBase & {
    readonly type: 'bridge/text-delta'
    readonly data: { readonly text: string; readonly itemId: string | null }
  }
  | BridgeEventBase & {
    readonly type: 'bridge/reasoning-delta'
    readonly data: { readonly text: string; readonly itemId: string | null }
  }
  | BridgeEventBase & {
    readonly type: 'bridge/tool-started' | 'bridge/tool-updated' | 'bridge/tool-completed'
    readonly data: {
      readonly itemId: string
      readonly toolName: string
      readonly summary: string
      readonly status: 'running' | 'completed' | 'failed'
    }
  }
  | BridgeEventBase & {
    readonly type: 'bridge/file-change'
    readonly data: { readonly itemId: string; readonly summary: string }
  }
  | BridgeEventBase & {
    readonly type: 'bridge/interaction-requested'
    readonly data: { readonly interaction: PendingInteractionView }
  }
  | BridgeEventBase & {
    readonly type: 'bridge/interaction-resolved'
    readonly data: { readonly interactionId: string; readonly outcome: 'allowed' | 'denied' | 'cancelled' | 'answered' | 'expired' }
  }
  | BridgeEventBase & {
    readonly type: 'bridge/turn-completed'
    readonly data: { readonly turn: BridgeTurnView }
  }
  | BridgeEventBase & {
    readonly type: 'bridge/provider-health'
    readonly data: { readonly provider: NativeProviderView }
  }
  | BridgeEventBase & {
    readonly type: 'bridge/error'
    readonly data: { readonly code: BridgeErrorCode; readonly message: string }
  }

export interface BridgeCatalogResult {
  readonly providers: readonly NativeProviderView[]
  readonly workspaces: readonly BridgeWorkspaceView[]
}

export interface BridgeSessionCreateRequest {
  readonly providerId: ProviderId
  readonly workspaceId: string
  readonly title?: string
}

export interface BridgeSessionIdRequest {
  readonly bridgeSessionId: string
}

export interface BridgeSessionArchiveRequest extends BridgeSessionIdRequest {
  readonly archived?: boolean
}

export interface BridgeSessionReadRequest extends BridgeSessionIdRequest {
  readonly afterSequence?: number
  readonly waitMs?: number
}

export interface BridgeSessionReadResult {
  readonly session: BridgeSessionView
  readonly pendingInteraction: PendingInteractionView | null
  readonly events: readonly BridgeEvent[]
  readonly latestSequence: number
  readonly reset: boolean
}

export interface BridgeSessionSendRequest extends BridgeSessionIdRequest {
  readonly text: string
}

export interface BridgeSendResult {
  readonly delivery: 'started' | 'steered' | 'queued'
  readonly bridgeTurnId: string
}

export interface BridgeInteractionRespondRequest extends BridgeSessionIdRequest {
  readonly interactionId: string
  readonly resolution:
    | { readonly kind: 'approval'; readonly action: 'allow' | 'deny' | 'cancel' }
    | { readonly kind: 'question'; readonly answers: Readonly<Record<string, readonly string[]>> }
}

export interface BridgeInteractionRespondResult {
  readonly accepted: true
}
