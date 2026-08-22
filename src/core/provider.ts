import type {
  BridgeCompletionsResult,
  BridgeContextUsage,
  BridgeImageInput,
  BridgeModelsResult,
  BridgeRateLimit,
  BridgeTokenUsage,
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
  /**
   * The model to ask the product for, or null to leave it to the product.
   *
   * Per turn for the same reason as the permission mode, and by the same
   * mechanism in both products: Claude Code takes `Options.model` when a query
   * opens, Codex takes `model` on `turn/start`. Neither is settable mid-turn in
   * the way this bridge drives them, so a change lands on the next one.
   */
  readonly model: string | null
  /** The reasoning effort to ask for, or null for the product's default. */
  readonly effort: string | null
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
  /**
   * Record a usage allowance the product volunteered.
   *
   * A hook because it is pushed, not asked for: Claude Code emits it as a stream
   * event partway through a turn, whenever the account's figures move. Called
   * once per window, so a product reporting both a five-hour and a weekly
   * allowance produces two calls rather than one merged number.
   * @param limit - one allowance, as the product reported it.
   */
  reportRateLimit(limit: BridgeRateLimit): Promise<void>
  /**
   * Record the session's accumulated token spend.
   *
   * Separate from `reportContextUsage` because the two are different facts from
   * different places: Claude Code reports spend on the turn's result message and
   * context on a control request, while Codex pushes both in one notification but
   * distinguishes the window from the running total.
   * @param usage - totals as the product counts them.
   */
  reportTokenUsage(usage: BridgeTokenUsage): Promise<void>
  requestInteraction(request: ProviderInteractionRequest): Promise<ProviderInteractionResolution>
}

/** A transcript read back from a product, and whether it arrived whole. */
export interface ProviderHistory {
  /** Events in chronological order, oldest first. */
  readonly events: readonly BridgeEventDraft[]
  /**
   * True when the adapter dropped older events to stay within its ceiling. The
   * engine cannot infer this — a transcript trimmed to exactly the ceiling looks
   * the same as one that happened to be that length — and the panel says so, so a
   * reader does not assume the conversation began where the screen does.
   */
  readonly truncated: boolean
}

export interface ProviderTurnRequest {
  readonly text: string
  /**
   * Images to send with the message, already validated and size-checked on the Host.
   *
   * Passed as image input rather than as file paths, because both products accept
   * that and it is what "the agent can see the screenshot" means. Empty for the
   * ordinary case, and an adapter with no image support may ignore it — the text
   * still carries the paths the Host saved them to.
   */
  readonly images: readonly BridgeImageInput[]
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
  /**
   * Models this product will accept for a turn, as it reports them.
   *
   * Optional for the same reason as the other two readers: a product that cannot
   * be asked reports nothing rather than the bridge maintaining a list of model
   * names that would rot with every release.
   * @param bridgeSessionId - the session asking; a product whose list is
   * account-wide may ignore it.
   */
  listModels?(bridgeSessionId: string): Promise<BridgeModelsResult>
  /**
   * The transcript a product-native session already has, as bridge events.
   *
   * Resuming gives the *product* the earlier conversation — it is in that
   * product's own context — but the panel's timeline starts empty, because the
   * bridge only ever recorded its own turns. An operator who continued a session
   * from a terminal therefore saw a blank screen above a working agent, with no
   * way to tell what had been agreed.
   *
   * Read through each product's own API, the same way sessions are enumerated:
   * the Agent SDK's `getSessionMessages`, Codex's `thread/read`. The bridge does
   * not open transcript files, parse their format, or know where they live.
   *
   * Returns drafts rather than appending, so the engine keeps sole ownership of
   * sequence numbers and persistence. Bounded by the adapter, because only the
   * adapter knows how much of a product's transcript one event represents — and it
   * reports having trimmed, since the engine cannot tell a short transcript from a
   * long one that arrived clipped.
   * @param locator - the product's own session identifier, opaque to the bridge.
   * @param cwd - the session's working directory, for products that scope
   * transcripts by project.
   * @returns events in chronological order, oldest first.
   */
  readHistory?(locator: string, cwd: string): Promise<ProviderHistory>
  startTurn(request: ProviderTurnRequest): Promise<void>
  steer(bridgeSessionId: string, text: string): Promise<void>
  cancel(bridgeSessionId: string): Promise<void>
  disposeSession(bridgeSessionId: string): Promise<void>
  dispose(): Promise<void>
}

