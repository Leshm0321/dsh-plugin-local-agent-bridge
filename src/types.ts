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
  /**
   * Whether this product lets a session choose its model at all.
   *
   * Separate from whether a list is currently readable, because the two answers
   * differ: Claude Code can only enumerate its models off a live query, so a
   * session that has not run a turn gets an empty list from a product that does
   * support selection. Without this the panel could not tell that state apart from
   * a product with no model control, and would either hide a real capability or
   * promise one that will never arrive.
   */
  readonly selectableModels: boolean
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
 * A tool call's arguments and result, as far as they are safe and useful to show.
 *
 * Deliberately strings rather than structured data: the products describe tool
 * arguments in their own shapes, and the browser's job here is to let a reader
 * see what happened, not to interpret it.
 */
export interface BridgeToolDetail {
  /** The tool's arguments, formatted for reading. Null when it took none. */
  readonly input: string | null
  /** What the tool returned. Null while it is still running. */
  readonly output: string | null
  /** True when the Host cut either field at its length budget. */
  readonly truncated: boolean
}

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
export interface BridgeContextUsage {
  readonly usedTokens: number
  /** The model's context window, or null when the product did not report one. */
  readonly maxTokens: number | null
  /** Model name as the product reports it, or null. */
  readonly model: string | null
}

/**
 * One model a session can be told to use, as the product describes it.
 *
 * Both products enumerate their own models and both accept one per turn, so the
 * bridge relays rather than curates: the identifier goes back to the product
 * untouched, and the display text is the product's own. There is no bridge-side
 * list of "good" models to fall out of date.
 */
export interface BridgeModel {
  /**
   * The identifier to hand back to the product. Opaque here — an alias like
   * `sonnet` and a full wire id are both legitimate, and which is which is the
   * product's business.
   */
  readonly id: string
  /** The product's own display name. Vendor text; never translated. */
  readonly displayName: string
  readonly description: string | null
  /**
   * Reasoning-effort levels this model accepts, in the product's order. Empty
   * for a model that takes no effort setting, which is the honest answer for
   * most of them.
   */
  readonly efforts: readonly string[]
  /** The effort the product would use if none is chosen, when it says. */
  readonly defaultEffort: string | null
}

export interface BridgeModelsResult {
  readonly models: readonly BridgeModel[]
  /**
   * True when the product cannot be asked at all. Claude Code exposes its model
   * list only through a live SDK query, so it is unknown until some session has
   * run a turn; Codex answers from its App Server at any time. Distinct from a
   * product that answered with an empty list.
   */
  readonly unavailable: boolean
}

/**
 * How much of a usage allowance the account has spent, when the product says.
 *
 * Only Claude Code reports this, and only for subscription accounts: it arrives
 * as a stream event during a turn. Codex has the reciprocal call but refuses it
 * without a ChatGPT sign-in, so an operator on an API key sees no quota — which
 * is reported as absence rather than as a zero.
 *
 * The fields are deliberately the ones a reader acts on. The vendor payload also
 * carries overage provisioning and payment-method flags, which are account
 * billing detail with no business in this panel.
 */
export interface BridgeRateLimit {
  /**
   * Which allowance this is, as the product names it (`five_hour`, `seven_day`,
   * …). Vendor text, kept verbatim so two windows never collapse into one row.
   * Null when the product did not say which.
   */
  readonly window: string | null
  /** Fraction spent, 0–1, or null when the product reported only a status. */
  readonly utilization: number | null
  /** Whether the product is still serving requests against this allowance. */
  readonly status: 'allowed' | 'warning' | 'rejected'
  /** When the allowance refills, epoch milliseconds, when the product says. */
  readonly resetsAt: number | null
}

/**
 * Accumulated token spend the product has reported for the session.
 *
 * Distinct from `BridgeContextUsage`, which is how full the current window is.
 * This is what the session has cost since it started, and it only goes up — the
 * two answer different questions and a reader wants both.
 *
 * Cache reads and writes are kept apart because they price differently in both
 * products, and folding them into one number would hide the thing that makes a
 * long session affordable.
 */
export interface BridgeTokenUsage {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  /**
   * The product's own total where it reports one, else the sum of the parts. Kept
   * as a field rather than computed in the browser so a product that counts
   * differently — Codex tracks reasoning output separately — is reported as it
   * counts rather than re-added incorrectly.
   */
  readonly total: number
}

/**
 * Version-control state of the session's working directory.
 *
 * The question a terminal answers at a glance and a browser panel otherwise
 * cannot: which branch this is, and how much has changed. Read by running `git`,
 * so a directory that is not a repository or a Host without git simply reports
 * nothing.
 */
export interface BridgeRepository {
  /** Branch name, or the short commit for a detached HEAD, or null for an unborn branch. */
  readonly branch: string | null
  /** True when HEAD is not on a branch. */
  readonly detached: boolean
  /** Upstream branch as git names it, or null when the branch tracks nothing. */
  readonly upstream: string | null
  readonly ahead: number
  readonly behind: number
  /** Lines added since HEAD, staged and unstaged together. */
  readonly added: number
  readonly removed: number
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
  /**
   * The model this session asks for, or null to leave the choice to the product.
   * Applies from the next turn, for the same reason as the permission mode.
   */
  readonly model: string | null
  /** The reasoning effort asked for, or null for the product's own default. */
  readonly effort: string | null
  /**
   * Usage allowances the product has reported for the account, one row per
   * window, most recently reported value per window. Empty when the product
   * reports none — which is the normal case for anything but a Claude
   * subscription.
   */
  readonly rateLimits: readonly BridgeRateLimit[]
  /**
   * Tokens the session has consumed in total, or null before the product has
   * reported any. Carried on the session for the same reason as the context
   * figure: it arrives with every read the browser already makes.
   */
  readonly tokenUsage: BridgeTokenUsage | null
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
    readonly data: {
      readonly text: string
      readonly delivery: 'started' | 'steered' | 'queued'
      /**
       * Where any images were saved, relative to the working directory.
       *
       * Paths rather than the images themselves: a base64 screenshot is hundreds of
       * kilobytes, and the event log keeps two thousand entries. Storing the bytes
       * here would trade the whole transcript for a few pictures.
       */
      readonly attachments?: readonly string[]
    }
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
      /**
       * What the agent asked the tool to do, and what came back — the detail a
       * terminal shows inline and the panel used to discard entirely, leaving
       * only a one-line summary.
       *
       * Both are vendor text passed through the same redaction as any other, and
       * both are truncated on the Host: a file read can return a whole file, and
       * the browser has no use for more than an excerpt of it. Absent when the
       * product reported nothing, or reported only what the summary already says.
       */
      readonly detail?: BridgeToolDetail
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
    /**
     * Marks the end of a resumed session's existing transcript.
     *
     * Everything before it happened in the product before this bridge session
     * existed — read back through the product's own API, not replayed by it — and
     * everything after it is this session's own work. The panel draws the line so
     * a reader is never left wondering which turns they are looking at.
     */
    readonly type: 'bridge/history'
    readonly data: {
      /** Events restored from the product's transcript. */
      readonly restored: number
      /** True when the transcript was longer than the Host's ceiling. */
      readonly truncated: boolean
    }
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

/** One file or directory the composer can reference with `@`. */
export interface BridgeFileMatch {
  /** Path relative to the session's working directory, forward-slashed. */
  readonly path: string
  readonly name: string
  /**
   * True for a directory. Both products accept one as context, and the panel
   * shows and inserts it differently — with a trailing slash — so the distinction
   * is carried rather than folded into the path.
   */
  readonly directory: boolean
}

export interface BridgeFileSearchResult {
  readonly matches: readonly BridgeFileMatch[]
  /**
   * True when the Host stopped before exhausting the tree. A completion list is
   * read while typing, so a bounded partial answer is preferred to a complete one
   * that arrives late — and the panel says so rather than implying the list is
   * everything.
   */
  readonly partial: boolean
}

/** One file the operator picked in their own browser, for the Host to receive. */
export interface BridgeUploadInput {
  /**
   * The file name, or its folder-relative path for a directory upload, exactly as
   * the browser reported it. Untrusted: the Host rebuilds it rather than using it.
   */
  readonly path: string
  /** The bytes, base64. */
  readonly contentBase64: string
}

export interface BridgeUploadRequest extends BridgeSessionIdRequest {
  readonly files: readonly BridgeUploadInput[]
}

export interface BridgeUploadResult {
  /**
   * Where each file landed, relative to the working directory — the same form `@`
   * uses, so the composer inserts one shape whichever route was taken.
   */
  readonly paths: readonly string[]
  /**
   * How many files the Host refused, for a name it could not make safe or a size
   * over its ceiling. Reported so the panel can say some did not arrive rather
   * than quietly delivering fewer than were chosen.
   */
  readonly rejected: number
}

export interface BridgeFileSearchRequest extends BridgeSessionIdRequest {
  /** What the operator typed after `@`; empty lists the shallowest files. */
  readonly query: string
}

/** One entry in a Host directory the composer's host browser is showing. */
export interface BridgeHostEntry {
  readonly name: string
  /**
   * Absolute Host path.
   *
   * The one place this bridge sends Host paths to the browser, and it is the point:
   * the operator is navigating their own machine to pick a file, and the path is
   * what they picked. Distinct from a path appearing inside a product's reply, which
   * is still dropped where it is parsed — that would be the Host leaking its layout,
   * while this is the operator reading it deliberately.
   */
  readonly path: string
  readonly directory: boolean
  /** Dot-prefixed, so the panel can hide these until asked. */
  readonly hidden: boolean
}

export interface BridgeHostListing {
  readonly path: string
  readonly home: string
  readonly crumbs: readonly { readonly name: string; readonly path: string }[]
  readonly entries: readonly BridgeHostEntry[]
  readonly truncated: boolean
}

export interface BridgeHostListRequest {
  /** Absolute directory to list; omitted lists the Host home directory. */
  readonly path?: string
}

/** One entry in the session's working directory. */
export interface BridgeWorkspaceEntry {
  readonly name: string
  /** Path relative to the working directory, forward-slashed. Never absolute. */
  readonly path: string
  readonly directory: boolean
  readonly hidden: boolean
  /** File size in bytes, or null for a directory. */
  readonly bytes: number | null
}

export interface BridgeWorkspaceListing {
  /** The directory listed, relative to the working directory; empty for the root. */
  readonly path: string
  readonly entries: readonly BridgeWorkspaceEntry[]
  readonly truncated: boolean
}

export interface BridgeWorkspaceListRequest extends BridgeSessionIdRequest {
  /** Workspace-relative directory; omitted lists the root. */
  readonly path?: string
}

export interface BridgeWorkspaceFile {
  readonly path: string
  /**
   * What the file looked like when read, handed back on a write so the Host can
   * refuse one that would overwrite a change made since. Opaque to the browser.
   */
  readonly revision: string
  /** The text, cut at the Host's ceiling. Empty for a binary file. */
  readonly content: string
  readonly bytes: number
  readonly truncated: boolean
  /** True when the file is not text, so the panel says so instead of rendering noise. */
  readonly binary: boolean
}

export interface BridgeWorkspaceFileRequest extends BridgeSessionIdRequest {
  readonly path: string
}

export interface BridgeWorkspaceWriteRequest extends BridgeSessionIdRequest {
  readonly path: string
  readonly content: string
  /** The revision the editor was opened at; a mismatch is refused. */
  readonly revision: string
}

export interface BridgeWorkspaceCreateRequest extends BridgeSessionIdRequest {
  readonly path: string
  /** True for a directory, false for an empty file. */
  readonly directory: boolean
}

export interface BridgeWorkspaceRenameRequest extends BridgeSessionIdRequest {
  readonly from: string
  readonly to: string
}

export interface BridgeCatalogResult {
  readonly providers: readonly NativeProviderView[]
  readonly workspaces: readonly BridgeWorkspaceView[]
  /**
   * Whether this Profile lets the panel browse the Host beyond the working
   * directory. Off makes the composer omit that route entirely rather than offering
   * one that fails — see `allowHostBrowsing` in the Profile config.
   */
  readonly hostBrowsing: boolean
  /**
   * Whether this Profile lets the panel create, rename, delete or edit files in the
   * working directory. Off hides those controls rather than offering ones that fail —
   * see `allowWorkspaceWrites` in the Profile config.
   */
  readonly workspaceWrites: boolean
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

export interface BridgeModelRequest extends BridgeSessionIdRequest {
  /** The model to use, or null to hand the choice back to the product. */
  readonly model: string | null
  /**
   * The reasoning effort to use, or null for the product's default. Rejected
   * when the chosen model does not list it, so the panel can never ask for a
   * combination the product would silently ignore.
   */
  readonly effort: string | null
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

/**
 * An image the operator pasted into the composer.
 *
 * Both products take images natively — Codex as an `image` input item, Claude Code
 * as a base64 image block — so a pasted screenshot is something the agent sees
 * rather than a file it has to be told to go and read.
 */
export interface BridgeImageInput {
  /** IANA type, restricted on the Host to the formats the products accept. */
  readonly mediaType: string
  /** The image, base64, without a data-URL prefix. */
  readonly dataBase64: string
  /**
   * The clipboard's name for it, when it had one. Used for the file it is saved as;
   * a paste usually has none, and the Host names it by time in that case.
   */
  readonly name?: string
}

export interface BridgeSessionSendRequest extends BridgeSessionIdRequest {
  readonly text: string
  /**
   * Images to send with the message. Saved into the working directory's upload
   * directory so the conversation survives a reload, and passed to the product as
   * image input for the turn itself.
   */
  readonly images?: readonly BridgeImageInput[]
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
