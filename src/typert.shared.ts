import { z } from 'zod'

const providerSchema = z.object({
  id: z.enum(['codex', 'claude', 'fake']),
  displayName: z.string(),
  installed: z.boolean(),
  version: z.string().nullable(),
  compatibility: z.enum(['supported', 'unsupported', 'unknown']),
  health: z.enum(['not-installed', 'installed', 'ready', 'auth-required', 'error']),
  message: z.string().nullable(),
}).strict()

const workspaceSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['ok', 'missing-dir']),
}).strict()

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
}).strict()

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

const catalogSchema = z.object({
  providers: z.array(providerSchema),
  workspaces: z.array(workspaceSchema),
}).strict()

const createRequestSchema = z.object({
  providerId: z.enum(['codex', 'claude', 'fake']),
  workspaceId: z.string(),
  title: z.string().optional(),
}).strict()

const sessionIdRequestSchema = z.object({ bridgeSessionId: z.string() }).strict()
const readRequestSchema = sessionIdRequestSchema.extend({
  afterSequence: z.number().optional(),
  waitMs: z.number().optional(),
})
const sendRequestSchema = sessionIdRequestSchema.extend({ text: z.string() }).strict()
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

/** Official Typert descriptor vocabulary, authored locally for a root-package workspace. */
export const LOCAL_AGENT_BRIDGE_INVOCATIONS = [
  invocation('catalog', [], catalogSchema),
  invocation('sessionsList', [parameter('includeArchived', z.boolean())], z.array(sessionSchema)),
  invocation('sessionCreate', [parameter('request', createRequestSchema)], sessionSchema),
  invocation('sessionRead', [parameter('request', readRequestSchema)], readResultSchema, true),
  invocation('sessionSend', [parameter('request', sendRequestSchema)], sendResultSchema),
  invocation('sessionCancel', [parameter('request', sessionIdRequestSchema)], z.undefined()),
  invocation('sessionArchive', [parameter('request', archiveRequestSchema)], sessionSchema),
  invocation('interactionRespond', [parameter('request', interactionResponseSchema)], z.object({ accepted: z.literal(true) }).strict()),
] as const
