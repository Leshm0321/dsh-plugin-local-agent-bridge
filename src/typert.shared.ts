import { z } from 'zod'
import type {
  BridgeCatalogRequest,
  BridgeCompletion,
  BridgeContextUsage,
  BridgeFileMatch,
  BridgeModel,
  BridgeNativeSession,
  BridgePermissionModeView,
  BridgePrivacyClearRequest,
  BridgePrivacyPasswordRequest,
  BridgePrivacyState,
  BridgePrivacyUnlockRequest,
  BridgePrivacyUnlockResult,
  BridgeSessionsListRequest,
  BridgeRateLimit,
  BridgeHostEntry,
  BridgeDiffEntry,
  BridgeDiffHunk,
  BridgeDiffLine,
  BridgeWorkspaceEntry,
  BridgeWorkspaceFile,
  BridgeWorkspaceListing,
  BridgeHostListing,
  BridgeRepository,
  BridgeTokenUsage,
  BridgeSessionView,
  BridgeWorkspaceView,
  NativeProviderView,
} from './types.ts'

/**
 * Compile-time proof that a wire schema and its TypeScript view describe the
 * same shape, in both directions.
 *
 * These schemas are `.strict()`, so the gateway rejects a payload carrying a
 * property the schema does not list. A field added to the view without being
 * added here therefore does not fail at build time — it fails at runtime, as
 * `business result failed boundary validation`, with the whole call dead and no
 * indication of which field is at fault. Asserting the shapes against each other
 * turns that into a type error at the point of the omission.
 */
type Exact<A, B> = [A] extends [B] ? [B] extends [A] ? true : never : never

const permissionModeSchema = z.enum(['auto', 'manual', 'acceptEdits', 'plan', 'bypass'])

const permissionModeViewSchema = z.object({
  mode: permissionModeSchema,
  skipsApproval: z.boolean(),
}).strict()

const _permissionModeViewIsExact: Exact<z.infer<typeof permissionModeViewSchema>, BridgePermissionModeView> = true

const providerSchema = z.object({
  id: z.enum(['codex', 'claude', 'fake']),
  displayName: z.string(),
  installed: z.boolean(),
  version: z.string().nullable(),
  supportedRange: z.string().nullable(),
  // `.readonly()` so the inferred type matches the view's readonly array and the
  // exact-shape assertion below stays a real check in both directions.
  permissionModes: z.array(permissionModeViewSchema).readonly(),
  selectableModels: z.boolean(),
  compatibility: z.enum(['supported', 'unsupported', 'unknown']),
  health: z.enum(['not-installed', 'installed', 'unsupported', 'ready', 'auth-required', 'error']),
  message: z.string().nullable(),
}).strict()

const _providerShapeIsExact: Exact<z.infer<typeof providerSchema>, NativeProviderView> = true

const workspaceSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['ok', 'missing-dir']),
  published: z.boolean(),
}).strict()

const directoryAddRequestSchema = z.object({ token: z.string(), path: z.string() }).strict()
const directoryRequestSchema = z.object({ token: z.string(), directoryId: z.string() }).strict()
const directoryPublishRequestSchema = z.object({
  token: z.string(),
  directoryId: z.string(),
  published: z.boolean(),
}).strict()

const _workspaceShapeIsExact: Exact<z.infer<typeof workspaceSchema>, BridgeWorkspaceView> = true

const contextUsageSchema = z.object({
  usedTokens: z.number(),
  maxTokens: z.number().nullable(),
  model: z.string().nullable(),
}).strict()

const _contextUsageShapeIsExact: Exact<z.infer<typeof contextUsageSchema>, BridgeContextUsage> = true

const modelSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  efforts: z.array(z.string()).readonly(),
  defaultEffort: z.string().nullable(),
}).strict()

const _modelShapeIsExact: Exact<z.infer<typeof modelSchema>, BridgeModel> = true

const modelsResultSchema = z.object({
  models: z.array(modelSchema).readonly(),
  unavailable: z.boolean(),
}).strict()

const rateLimitSchema = z.object({
  window: z.string().nullable(),
  utilization: z.number().nullable(),
  status: z.enum(['allowed', 'warning', 'rejected']),
  resetsAt: z.number().nullable(),
}).strict()

const _rateLimitShapeIsExact: Exact<z.infer<typeof rateLimitSchema>, BridgeRateLimit> = true

const tokenUsageSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  total: z.number(),
}).strict()

const _tokenUsageShapeIsExact: Exact<z.infer<typeof tokenUsageSchema>, BridgeTokenUsage> = true

const repositorySchema = z.object({
  branch: z.string().nullable(),
  detached: z.boolean(),
  upstream: z.string().nullable(),
  ahead: z.number(),
  behind: z.number(),
  added: z.number(),
  removed: z.number(),
}).strict()

const _repositoryShapeIsExact: Exact<z.infer<typeof repositorySchema>, BridgeRepository> = true

const sessionStatusSchema = z.enum([
  'creating', 'idle', 'running', 'awaiting-approval', 'awaiting-answer',
  'cancelling', 'disconnected', 'auth-required', 'failed', 'orphaned',
])

const sessionSchema = z.object({
  bridgeSessionId: z.string(),
  providerId: z.enum(['codex', 'claude', 'fake']),
  workspaceId: z.string(),
  workspaceTitle: z.string(),
  title: z.string(),
  status: sessionStatusSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  lastTurnId: z.string().nullable(),
  queuedInputCount: z.number(),
  archived: z.boolean(),
  persistenceVersion: z.number(),
  contextUsage: contextUsageSchema.nullable(),
  permissionMode: permissionModeSchema,
  model: z.string().nullable(),
  effort: z.string().nullable(),
  rateLimits: z.array(rateLimitSchema).readonly(),
  tokenUsage: tokenUsageSchema.nullable(),
}).strict()

const _sessionShapeIsExact: Exact<z.infer<typeof sessionSchema>, BridgeSessionView> = true

const optionSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().nullable(),
}).strict()

const questionSchema = z.object({
  id: z.string(),
  header: z.string(),
  prompt: z.string(),
  secret: z.boolean(),
  allowFreeText: z.boolean(),
  multiSelect: z.boolean(),
  options: z.array(optionSchema),
}).strict()

const interactionSchema = z.object({
  interactionId: z.string(),
  bridgeSessionId: z.string(),
  bridgeTurnId: z.string(),
  kind: z.enum(['approval', 'question']),
  providerId: z.enum(['codex', 'claude', 'fake']),
  safeSummary: z.string(),
  toolName: z.string().nullable(),
  target: z.string().nullable(),
  questions: z.array(questionSchema),
  expiresAt: z.number().nullable(),
}).strict()

const eventSchema = z.object({
  sequence: z.number(),
  bridgeSessionId: z.string(),
  bridgeTurnId: z.string().nullable(),
  timestamp: z.number(),
  type: z.string(),
  data: z.record(z.string(), z.unknown()),
}).strict()

const completionSchema = z.object({
  kind: z.enum(['command', 'mcp']),
  name: z.string(),
  insertText: z.string().nullable(),
  description: z.string().nullable(),
  argumentHint: z.string().nullable(),
  status: z.string().nullable(),
}).strict()

const _completionShapeIsExact: Exact<z.infer<typeof completionSchema>, BridgeCompletion> = true

const completionsResultSchema = z.object({
  completions: z.array(completionSchema),
  pending: z.boolean(),
}).strict()

const nativeSessionSchema = z.object({
  locator: z.string(),
  title: z.string(),
  updatedAt: z.number(),
  branch: z.string().nullable(),
}).strict()

const _nativeSessionShapeIsExact: Exact<z.infer<typeof nativeSessionSchema>, BridgeNativeSession> = true

const nativeSessionsResultSchema = z.object({
  sessions: z.array(nativeSessionSchema),
  unavailable: z.boolean(),
}).strict()

const permissionModeRequestSchema = z.object({
  token: z.string(),
  bridgeSessionId: z.string(),
  mode: permissionModeSchema,
}).strict()

const modelRequestSchema = z.object({
  token: z.string(),
  bridgeSessionId: z.string(),
  model: z.string().nullable(),
  effort: z.string().nullable(),
}).strict()

const fileMatchSchema = z.object({
  path: z.string(),
  name: z.string(),
  directory: z.boolean(),
}).strict()

const _fileMatchShapeIsExact: Exact<z.infer<typeof fileMatchSchema>, BridgeFileMatch> = true

const fileSearchResultSchema = z.object({
  matches: z.array(fileMatchSchema).readonly(),
  partial: z.boolean(),
}).strict()

const fileSearchRequestSchema = z.object({
  token: z.string(),
  bridgeSessionId: z.string(),
  query: z.string(),
}).strict()

const uploadRequestSchema = z.object({
  token: z.string(),
  bridgeSessionId: z.string(),
  files: z.array(z.object({
    path: z.string(),
    contentBase64: z.string(),
  }).strict()).readonly(),
}).strict()

const uploadResultSchema = z.object({
  paths: z.array(z.string()).readonly(),
  rejected: z.number(),
}).strict()

const nativeSessionsRequestSchema = z.object({
  token: z.string(),
  providerId: z.enum(['codex', 'claude', 'fake']),
  workspaceId: z.string(),
}).strict()

const hostEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  directory: z.boolean(),
  hidden: z.boolean(),
}).strict()

const _hostEntryShapeIsExact: Exact<z.infer<typeof hostEntrySchema>, BridgeHostEntry> = true

const hostListingSchema = z.object({
  path: z.string(),
  home: z.string(),
  crumbs: z.array(z.object({ name: z.string(), path: z.string() }).strict()).readonly(),
  entries: z.array(hostEntrySchema).readonly(),
  truncated: z.boolean(),
}).strict()

const _hostListingShapeIsExact: Exact<z.infer<typeof hostListingSchema>, BridgeHostListing> = true

const hostListRequestSchema = z.object({
  token: z.string(),
  path: z.string().optional(),
}).strict()

const workspaceEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  directory: z.boolean(),
  hidden: z.boolean(),
  bytes: z.number().nullable(),
}).strict()

const _workspaceEntryIsExact: Exact<z.infer<typeof workspaceEntrySchema>, BridgeWorkspaceEntry> = true

const workspaceListingSchema = z.object({
  path: z.string(),
  entries: z.array(workspaceEntrySchema).readonly(),
  truncated: z.boolean(),
}).strict()

const _workspaceListingIsExact: Exact<z.infer<typeof workspaceListingSchema>, BridgeWorkspaceListing> = true

const workspaceListRequestSchema = z.object({
  token: z.string(),
  bridgeSessionId: z.string(),
  path: z.string().optional(),
}).strict()

const workspaceFileSchema = z.object({
  path: z.string(),
  revision: z.string(),
  content: z.string(),
  bytes: z.number(),
  truncated: z.boolean(),
  binary: z.boolean(),
}).strict()

const _workspaceFileIsExact: Exact<z.infer<typeof workspaceFileSchema>, BridgeWorkspaceFile> = true

const workspaceFileRequestSchema = z.object({
  token: z.string(),
  bridgeSessionId: z.string(),
  path: z.string(),
}).strict()

const workspaceWriteRequestSchema = z.object({
  token: z.string(),
  bridgeSessionId: z.string(),
  path: z.string(),
  content: z.string(),
  revision: z.string(),
}).strict()

const workspaceCreateRequestSchema = z.object({
  token: z.string(),
  bridgeSessionId: z.string(),
  path: z.string(),
  directory: z.boolean(),
}).strict()

const workspaceRenameRequestSchema = z.object({
  token: z.string(),
  bridgeSessionId: z.string(),
  from: z.string(),
  to: z.string(),
}).strict()

const diffLineSchema = z.object({
  kind: z.enum(['context', 'added', 'removed']),
  text: z.string(),
  oldNumber: z.number().nullable(),
  newNumber: z.number().nullable(),
}).strict()

const _diffLineIsExact: Exact<z.infer<typeof diffLineSchema>, BridgeDiffLine> = true

const diffHunkSchema = z.object({
  header: z.string(),
  lines: z.array(diffLineSchema).readonly(),
}).strict()

const _diffHunkIsExact: Exact<z.infer<typeof diffHunkSchema>, BridgeDiffHunk> = true

const diffEntrySchema = z.object({
  path: z.string(),
  added: z.number(),
  removed: z.number(),
  binary: z.boolean(),
  untracked: z.boolean(),
}).strict()

const _diffEntryIsExact: Exact<z.infer<typeof diffEntrySchema>, BridgeDiffEntry> = true

const workspaceDiffSchema = z.object({
  entries: z.array(diffEntrySchema).readonly(),
  unavailable: z.boolean(),
}).strict()

const catalogSchema = z.object({
  providers: z.array(providerSchema),
  workspaces: z.array(workspaceSchema),
  hostBrowsing: z.boolean(),
  workspaceWrites: z.boolean(),
}).strict()

const createRequestSchema = z.object({
  token: z.string(),
  providerId: z.enum(['codex', 'claude', 'fake']),
  workspaceId: z.string(),
  title: z.string().optional(),
  resumeLocator: z.string().optional(),
  permissionMode: permissionModeSchema.optional(),
}).strict()

const sessionIdRequestSchema = z.object({ token: z.string(), bridgeSessionId: z.string() }).strict()
const readRequestSchema = sessionIdRequestSchema.extend({
  afterSequence: z.number().optional(),
  waitMs: z.number().optional(),
})
const sendRequestSchema = sessionIdRequestSchema.extend({
  text: z.string(),
  images: z.array(z.object({
    mediaType: z.string(),
    dataBase64: z.string(),
    name: z.string().optional(),
  }).strict()).readonly().optional(),
}).strict()
const archiveRequestSchema = sessionIdRequestSchema.extend({ archived: z.boolean().optional() }).strict()
const interactionResponseSchema = sessionIdRequestSchema.extend({
  interactionId: z.string(),
  resolution: z.union([
    z.object({ kind: z.literal('approval'), action: z.enum(['allow', 'deny', 'cancel']) }).strict(),
    z.object({ kind: z.literal('question'), answers: z.record(z.string(), z.array(z.string())) }).strict(),
  ]),
}).strict()

const readResultSchema = z.object({
  session: sessionSchema,
  pendingInteraction: interactionSchema.nullable(),
  events: z.array(eventSchema),
  latestSequence: z.number(),
  reset: z.boolean(),
}).strict()

const sendResultSchema = z.object({
  delivery: z.enum(['started', 'steered', 'queued']),
  bridgeTurnId: z.string(),
}).strict()

function codec(typeSymbol: string, schema: z.ZodType): {
  readonly mode: 'strict'
  readonly typeSymbol: string
  readonly schema: z.ZodType
} {
  return { mode: 'strict', typeSymbol, schema }
}

function parameter(name: string, schema: z.ZodType) {
  return {
    name,
    wire: name,
    source: 'json' as const,
    codec: codec(`dsh-plugin-local-agent-bridge#localAgentBridge/${name}`, schema),
  }
}

function invocation(
  method: string,
  parameters: readonly ReturnType<typeof parameter>[],
  result: z.ZodType,
  cancellation = false,
) {
  return {
    id: `dsh-plugin-local-agent-bridge#localAgentBridge/${method}`,
    service: 'localAgentBridge',
    namespace: 'localAgentBridge',
    method,
    invocation: { kind: 'direct' as const },
    parameters,
    ...cancellation ? { cancellation: { parameter: 'signal' as const } } : {},
    result: codec(`dsh-plugin-local-agent-bridge#localAgentBridge/${method}:result`, result),
    sourceLocation: { file: 'src/index.ts', line: 1, column: 1 },
  }
}

/**
 * The lock's own wire shapes.
 *
 * `privacyState` and `privacyUnlock` are the two methods a locked caller may
 * reach, so neither takes a token. Everything else here does, including
 * `privacyLock`: locking is only meaningful to someone already inside, and an
 * unauthenticated caller able to lock the panel is a denial of service with no
 * upside.
 */
const privacyStateSchema = z.object({
  configured: z.boolean(),
  unlocked: z.boolean(),
  lockedOutUntil: z.number().nullable(),
  absoluteTimeoutMs: z.number(),
  idleTimeoutMs: z.number(),
  minPasswordLength: z.number(),
}).strict()

const _privacyStateIsExact: Exact<z.infer<typeof privacyStateSchema>, BridgePrivacyState> = true

const privacyUnlockRequestSchema = z.object({ password: z.string() }).strict()
const privacyUnlockResultSchema = z.object({ token: z.string(), expiresAt: z.number() }).strict()
const privacyPasswordRequestSchema = z.object({
  current: z.string().nullable(),
  next: z.string(),
}).strict()
const privacyClearRequestSchema = z.object({ current: z.string() }).strict()

const _privacyUnlockRequestIsExact: Exact<z.infer<typeof privacyUnlockRequestSchema>, BridgePrivacyUnlockRequest> = true
const _privacyUnlockResultIsExact: Exact<z.infer<typeof privacyUnlockResultSchema>, BridgePrivacyUnlockResult> = true
const _privacyPasswordRequestIsExact: Exact<z.infer<typeof privacyPasswordRequestSchema>, BridgePrivacyPasswordRequest> = true
const _privacyClearRequestIsExact: Exact<z.infer<typeof privacyClearRequestSchema>, BridgePrivacyClearRequest> = true

/**
 * `catalog` and `sessionsList` took no request object before the lock existed.
 * They take one now for the single reason that the token has nowhere else to
 * travel — the Gateway passes named arguments and nothing about the caller.
 */
const catalogRequestSchema = z.object({ token: z.string() }).strict()
const sessionsListRequestSchema = z.object({
  token: z.string(),
  includeArchived: z.boolean(),
}).strict()

const _catalogRequestIsExact: Exact<z.infer<typeof catalogRequestSchema>, BridgeCatalogRequest> = true
const _sessionsListRequestIsExact: Exact<z.infer<typeof sessionsListRequestSchema>, BridgeSessionsListRequest> = true

/** Official Typert descriptor vocabulary, authored locally for a root-package workspace. */
export const LOCAL_AGENT_BRIDGE_INVOCATIONS = [
  invocation('catalog', [parameter('request', catalogRequestSchema)], catalogSchema),
  invocation('sessionsList', [parameter('request', sessionsListRequestSchema)], z.array(sessionSchema)),
  invocation('sessionCreate', [parameter('request', createRequestSchema)], sessionSchema),
  invocation('sessionRead', [parameter('request', readRequestSchema)], readResultSchema, true),
  invocation('sessionSend', [parameter('request', sendRequestSchema)], sendResultSchema),
  invocation('sessionCancel', [parameter('request', sessionIdRequestSchema)], z.undefined()),
  invocation('sessionArchive', [parameter('request', archiveRequestSchema)], sessionSchema),
  invocation('interactionRespond', [parameter('request', interactionResponseSchema)], z.object({ accepted: z.literal(true) }).strict()),
  invocation('sessionCompletions', [parameter('request', sessionIdRequestSchema)], completionsResultSchema),
  invocation('nativeSessions', [parameter('request', nativeSessionsRequestSchema)], nativeSessionsResultSchema),
  invocation('directoryAdd', [parameter('request', directoryAddRequestSchema)], workspaceSchema),
  invocation('directoryRemove', [parameter('request', directoryRequestSchema)], z.undefined()),
  invocation('directoryPublish', [parameter('request', directoryPublishRequestSchema)], workspaceSchema),
  invocation('sessionPermissionMode', [parameter('request', permissionModeRequestSchema)], sessionSchema),
  invocation('sessionFiles', [parameter('request', fileSearchRequestSchema)], fileSearchResultSchema),
  invocation('sessionModels', [parameter('request', sessionIdRequestSchema)], modelsResultSchema),
  invocation('sessionModel', [parameter('request', modelRequestSchema)], sessionSchema),
  invocation('sessionUpload', [parameter('request', uploadRequestSchema)], uploadResultSchema),
  invocation('sessionRepository', [parameter('request', sessionIdRequestSchema)], repositorySchema.nullable()),
  invocation('hostList', [parameter('request', hostListRequestSchema)], hostListingSchema),
  invocation('workspaceList', [parameter('request', workspaceListRequestSchema)], workspaceListingSchema),
  invocation('workspaceFile', [parameter('request', workspaceFileRequestSchema)], workspaceFileSchema),
  invocation('workspaceDiff', [parameter('request', sessionIdRequestSchema)], workspaceDiffSchema),
  invocation('workspaceFileDiff', [parameter('request', workspaceFileRequestSchema)], z.array(diffHunkSchema).readonly()),
  invocation('workspaceWrite', [parameter('request', workspaceWriteRequestSchema)], workspaceFileSchema),
  invocation('workspaceCreate', [parameter('request', workspaceCreateRequestSchema)], z.undefined()),
  invocation('workspaceRename', [parameter('request', workspaceRenameRequestSchema)], z.undefined()),
  invocation('workspaceDelete', [parameter('request', workspaceFileRequestSchema)], z.undefined()),
  invocation('privacyState', [parameter('request', catalogRequestSchema)], privacyStateSchema),
  invocation('privacyUnlock', [parameter('request', privacyUnlockRequestSchema)], privacyUnlockResultSchema),
  invocation('privacyPassword', [parameter('request', privacyPasswordRequestSchema)], privacyStateSchema),
  invocation('privacyClear', [parameter('request', privacyClearRequestSchema)], privacyStateSchema),
  invocation('privacyLock', [parameter('request', catalogRequestSchema)], z.undefined()),
] as const
