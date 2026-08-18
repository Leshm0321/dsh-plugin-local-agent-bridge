/** Public, browser-safe wire vocabulary for the Local Agent Bridge. */

export type ProviderId = 'codex' | 'claude' | 'fake'

export type ProviderCompatibility = 'supported' | 'unsupported' | 'unknown'

export type ProviderHealth =
  | 'not-installed'
  | 'installed'
  | 'unsupported'
  | 'ready'
  | 'auth-required'
  | 'error'

export interface NativeProviderView {
  readonly id: ProviderId
  readonly displayName: string
  readonly installed: boolean
  readonly version: string | null
  /**
   * The semver range this bridge admits for the product, so the browser can
   * phrase a version rejection in the reader's own language instead of
   * rendering a Host-composed English sentence. Null for the fixture provider,
   * which has no external range.
   */
  readonly supportedRange: string | null
  readonly compatibility: ProviderCompatibility
  readonly health: ProviderHealth
  /**
   * Redacted Host diagnostic text for states the browser cannot phrase on its
   * own — currently only `error`, where the product's own stderr is the only
   * useful explanation. Every predictable state leaves this null and is
   * described from `health`, `version`, and `supportedRange` in the Client's
   * active locale. Never localized on the Host: the Host has no business
   * knowing which language a browser reads.
   */
  readonly message: string | null
  /**
   * Permission modes this product can actually honour, in display order. Empty
   * for a product that exposes no such control.
   */
  readonly permissionModes: readonly BridgePermissionModeView[]
}

export interface BridgeWorkspaceView {
  readonly id: string
  readonly title: string
  readonly status: 'ok' | 'missing-dir'
  /**
   * Whether this directory is also registered as a DeepSeek Harness workspace,
   * and therefore visible in the Harness sidebar.
   *
   * The bridge owns its own directory list because a Harness workspace has no
   * visibility dimension — once registered it is in the sidebar permanently — so
   * adding a directory for an agent to work in must not imply putting it there.
   * Publishing is opt-in per directory and reversible.
   */
  readonly published: boolean
}

export interface BridgeDirectoryAddRequest {
  /** Absolute Host path; resolved and validated on the Host. */
  readonly path: string
}

export interface BridgeDirectoryRequest {
  readonly directoryId: string
}

export interface BridgeDirectoryPublishRequest extends BridgeDirectoryRequest {
  readonly published: boolean
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

/**
 * Why a session changed status, as a code the Client phrases in its own locale.
 *
 * An error-driven transition carries no note: the `bridge/error` event appended
 * immediately before it already names the cause with its own code, and repeating
 * it here produced two rows saying the same thing — one of them in whatever
 * language the Host happened to compose.
 */
export type BridgeStatusNote =
  | 'cancelling-turn'
  | 'host-restarted-resumable'
  | 'host-restarted-orphaned'

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

/**
 * How much of the model's context the session has consumed.
 *
 * Both products report this, in different shapes and through different
 * mechanisms — Claude Code answers a control request on a live query, Codex
 * pushes a notification — so the bridge reduces both to the two numbers a reader
 * acts on. The per-category breakdown each product offers is deliberately not
 * carried: Claude Code's includes memory-file paths, which are Host filesystem
 * detail with no business in a browser.
 */
/**
 * How much the agent may do without asking, named after the modes the Claude
 * desktop app presents so the vocabulary matches what operators already know.
 *
 * The two products express this with different primitives, and neither can
 * express all five: the Host maps each mode onto the product's own settings and
 * reports only what that product can actually honour, rather than offering a mode
 * that would silently do something else.
 *
 * `bypass` genuinely disables the browser approval prompt — the protection this
 * bridge exists to provide. It is offered because the products offer it, and it
 * is marked so the panel can say what it costs.
 */
export type BridgePermissionMode = 'auto' | 'manual' | 'acceptEdits' | 'plan' | 'bypass'

export interface BridgePermissionModeView {
  readonly mode: BridgePermissionMode
  /**
   * True when this mode stops the browser from being asked to approve tools.
   * The panel warns before selecting one; the bridge does not refuse it, because
   * the products themselves offer it.
   */
  readonly skipsApproval: boolean
}

export interface BridgeContextUsage {
  readonly usedTokens: number
  /** The model's context window, or null when the product did not report one. */
  readonly maxTokens: number | null
  /** Model name as the product reports it, or null. */
  readonly model: string | null
}

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
  /**
   * Latest context usage the product reported, or null before it has said
   * anything. Carried on the session rather than fetched separately so it
   * arrives with every read the browser already makes.
   */
  readonly contextUsage: BridgeContextUsage | null
  /**
   * The session's permission mode. Applies from the next turn, because both
   * products take it when a turn starts.
   */
  readonly permissionMode: BridgePermissionMode
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
    readonly data: { readonly status: BridgeSessionStatus; readonly note: BridgeStatusNote | null }
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

/**
 * Where a completion came from, so the browser can group and label the list.
 *
 * `command` is a native slash command or skill the product itself resolves;
 * `mcp` is a configured MCP server, listed so the operator can see what the
 * product has available without leaving the browser.
 */
export type BridgeCompletionKind = 'command' | 'mcp'

/** One entry in a session's completion list, exactly as the product reported it. */
export interface BridgeCompletion {
  readonly kind: BridgeCompletionKind
  /** Display name, as the product spells it. Vendor text; never translated. */
  readonly name: string
  /**
   * The text to place in the composer, or null for an entry that is information
   * only.
   *
   * Composed on the Host because only the Host knows the product's syntax, and
   * the two products do not share one: a Claude Code command is invoked as
   * `/name`, while a Codex skill is named `namespace:skill` and is not a slash
   * command at all. An MCP server is not invocable from the composer, so it
   * carries null and the browser shows it as inventory.
   */
  readonly insertText: string | null
  /** The product's own one-line description, or null when it gave none. */
  readonly description: string | null
  /** The product's argument hint, e.g. `<file>`, or null. */
  readonly argumentHint: string | null
  /**
   * For `mcp`, the connection or auth state the product reports, so a server
   * that is configured but unreachable is visibly different from a live one.
   * Null for a command.
   */
  readonly status: string | null
}

export interface BridgeCompletionsResult {
  readonly completions: readonly BridgeCompletion[]
  /**
   * True when the product has not yet been asked. Claude Code exposes its
   * command list only through a live SDK query, so a session that has never run
   * a turn has nothing to report yet — which is a different thing from a product
   * that reported an empty list.
   */
  readonly pending: boolean
}

/**
 * A product-native session the operator could pick up in the browser.
 *
 * Enumerated through each product's own API — the Agent SDK's `listSessions`,
 * Codex's `thread/list` — and never by reading `~/.claude` or `~/.codex`. That
 * distinction is the whole point: the bridge asks the product what it has, the
 * same way it asks the product to run a turn, so the promise never to touch
 * vendor state directories still holds.
 *
 * Deliberately narrow. The products report an absolute transcript path for every
 * session; it is dropped on the Host rather than carried and redacted, so there
 * is nothing here that could leak a Host filesystem layout.
 */
export interface BridgeNativeSession {
  /**
   * The product's own session identifier — the same opaque locator the bridge
   * already passes to `resume`.
   */
  readonly locator: string
  /**
   * What the product calls this session: a title the operator set, else the
   * product's own summary, else its first prompt. Redacted and truncated,
   * because it is the operator's own text coming back out of the product.
   */
  readonly title: string
  /** Last activity, epoch milliseconds, for ordering and for showing recency. */
  readonly updatedAt: number
  /** Git branch the session ended on, when the product reports one. */
  readonly branch: string | null
}

export interface BridgeNativeSessionsRequest {
  readonly providerId: ProviderId
  readonly workspaceId: string
}

export interface BridgeNativeSessionsResult {
  readonly sessions: readonly BridgeNativeSession[]
  /**
   * True when the product cannot enumerate its sessions at all — an older
   * build, or a Codex App Server that would not start. Distinct from a product
   * that enumerated and found none.
   */
  readonly unavailable: boolean
}

export interface BridgeCatalogResult {
  readonly providers: readonly NativeProviderView[]
  readonly workspaces: readonly BridgeWorkspaceView[]
}

export interface BridgeSessionCreateRequest {
  readonly providerId: ProviderId
  readonly workspaceId: string
  readonly title?: string
  /**
   * A product-native session to continue instead of starting fresh, as reported
   * by `nativeSessions`.
   *
   * The bridge treats it as an opaque locator: it is handed straight to the
   * product's own resume path and is never parsed, joined onto a path, or used
   * to read a file. An unknown or expired locator surfaces as the session
   * becoming `orphaned`, exactly like a locator that stopped resolving after a
   * Host restart.
   */
  readonly resumeLocator?: string
  /** Initial permission mode; defaults to `auto`. */
  readonly permissionMode?: BridgePermissionMode
}

export interface BridgeSessionIdRequest {
  readonly bridgeSessionId: string
}

export interface BridgePermissionModeRequest extends BridgeSessionIdRequest {
  readonly mode: BridgePermissionMode
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
