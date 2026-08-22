/**
 * Deriving a trace view from the events the panel already has.
 *
 * The conversation view answers "what was said". A trace answers "where did the
 * time go, and what did it actually do" — which is a different question, and the one
 * asked when a turn took two minutes and it is not obvious why.
 *
 * Everything here is derived. No Host call, no new event, no extra retention: every
 * bridge event already carries a timestamp and a turn id, and that is enough for
 * spans, ordering and totals. Anything that cannot be computed from them is reported
 * as absent rather than estimated — a made-up figure in a performance view is worse
 * than a missing one, because it will be believed.
 */
import type { BridgeEvent, BridgeTokenUsage } from '../types.ts'

/** Which lane of the timeline strip a span belongs to. */
export type TraceLaneKind = 'input' | 'model' | 'tools'

/** One span on the timeline strip. */
export interface TraceSpan {
  readonly key: string
  /** Milliseconds from the start of the trace. */
  readonly startMs: number
  /** Span length in milliseconds; zero for an instant. */
  readonly durationMs: number
  /** Vendor text for the tooltip — a tool name, or the turn's ordinal. */
  readonly label: string
  readonly failed: boolean
}

export interface TraceLane {
  readonly kind: TraceLaneKind
  readonly spans: readonly TraceSpan[]
}

/** What one step of the trace did. */
export type TraceStepKind = 'user' | 'assistant' | 'reasoning' | 'tool' | 'context' | 'error'

export interface TraceStep {
  readonly key: string
  readonly kind: TraceStepKind
  /** The tool's name, or null for a step that is not a tool call. */
  readonly name: string | null
  /** What was asked: the tool's arguments, or the message. */
  readonly call: string
  /** What came back, or null when the step produced no separate result. */
  readonly result: string | null
  /**
   * Milliseconds from the start of the trace — when the product reported this.
   *
   * The reliable axis. What a step's *duration* was is not knowable from here: a
   * product stamps its start and completion when it chooses to, and Codex was
   * observed reporting both ends of a shell command 1ms apart. So the trace says
   * when things happened and does not claim how long each took.
   */
  readonly atMs: number
  readonly failed: boolean
  /** 1-based turn ordinal, or null for an event outside any turn. */
  readonly turn: number | null
}

export interface TraceStats {
  readonly turns: number
  readonly steps: number
  /**
   * Time the session was actually working, with idle gaps removed.
   *
   * Not wall-clock from first event to last. A session left open overnight and
   * resumed the next morning has a first-to-last span of hours, and reporting that
   * as its duration is worse than useless — the first real session measured this way
   * read "4262m40s". Idle time is the operator's, and it is neither interesting nor
   * theirs to account for.
   */
  readonly totalMs: number
  /**
   * Mean turn-start to first output, or null when no turn produced any.
   *
   * The one latency figure here that is trustworthy, because both ends are the
   * bridge's own: the Host stamps the turn's start, and the first event the product
   * sends back is by definition the first thing it had to say.
   */
  readonly firstTokenMs: number | null
  /**
   * Output tokens per second over the turns' duration, or null without both figures.
   *
   * Against turn duration, deliberately, and not against "time the model spent
   * generating" — which cannot be measured from here. A product reports its work
   * when it chooses to: measured on a real Codex turn, every event for a 2m18s turn
   * arrived in its final three seconds, and a shell command's start and completion
   * were stamped 1ms apart. Dividing 84 output tokens by that produced 7636 tok/s.
   * Turn duration is a real denominator, and the rate it gives is the one an
   * operator can act on.
   */
  readonly tokensPerSecond: number | null
  /** Cache reads as a fraction of all input, or null when nothing was reported. */
  readonly cacheHitRate: number | null
  readonly tokens: BridgeTokenUsage | null
}

export interface Trace {
  readonly lanes: readonly TraceLane[]
  readonly steps: readonly TraceStep[]
  readonly stats: TraceStats
}

/** A tool call being assembled from its started and completed events. */
interface OpenTool {
  readonly key: string
  readonly name: string
  readonly startedAt: number
  readonly turn: number | null
  call: string
  result: string | null
  endedAt: number | null
  failed: boolean
}

/** One line of a tool's arguments or result, for the trace's single-line cells. */
function condense(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null
  const flat = text.replaceAll(/\s+/g, ' ').trim()
  return flat.length === 0 ? null : flat
}

/** A stretch of time the session was working, in absolute milliseconds. */
interface ActivityWindow {
  readonly start: number
  readonly end: number
  /** Milliseconds of activity before this window, for projecting into the strip. */
  readonly offset: number
}

/**
 * Find the stretches during which the session was working.
 *
 * A turn, from its start to its completion — not "events close together in time".
 * That was the first attempt, and it was wrong in a way worth recording: a model
 * reasoning for ten seconds emits nothing, so any gap-based rule counts deep
 * thinking as idleness, which is the opposite of the truth. Waiting on an approval
 * *is* inside the turn and stays counted, because the turn genuinely had not
 * finished.
 *
 * Outside a turn there is nothing to measure. A session left open overnight and
 * picked up the next morning contributes only the two turns, not the night — which
 * is what stops a duration reading "4262m40s".
 * @param events - the session's events in sequence order.
 * @returns windows in chronological order, each carrying its cumulative offset.
 */
function activityWindows(events: readonly BridgeEvent[]): ActivityWindow[] {
  const last = events.at(-1)?.timestamp ?? 0
  const open = new Map<string, number>()
  const spans: { start: number; end: number }[] = []
  for (const event of events) {
    const turn = event.bridgeTurnId
    if (turn === null) continue
    if (event.type === 'bridge/turn-started') {
      open.set(turn, event.timestamp)
    } else if (event.type === 'bridge/turn-completed') {
      const start = open.get(turn)
      if (start !== undefined) {
        spans.push({ start, end: event.timestamp })
        open.delete(turn)
      }
    }
  }
  // A turn still running reaches the newest event, so it is measured as far as it
  // has got rather than not at all.
  for (const start of open.values()) spans.push({ start, end: Math.max(start, last) })

  spans.sort((left, right) => left.start - right.start)
  let offset = 0
  return spans.map((span) => {
    const window = { start: span.start, end: span.end, offset }
    offset += span.end - span.start
    return window
  })
}

/**
 * Map an absolute timestamp onto the strip's idle-free timeline.
 * @param windows - activity windows from `activityWindows`.
 * @param timestamp - absolute time to place.
 * @returns milliseconds from the start of the strip.
 */
function project(windows: readonly ActivityWindow[], timestamp: number): number {
  for (const window of windows) {
    // Before the first turn — a restored transcript, a session-created event — there
    // is no measured time to sit in, so it lands at the start of the strip.
    if (timestamp <= window.end) {
      return window.offset + Math.max(0, timestamp - window.start)
    }
  }
  const tail = windows.at(-1)
  return tail === undefined ? 0 : tail.offset + (tail.end - tail.start)
}

/**
 * Build the trace for a session's events.
 *
 * @param events - the session's events, in sequence order.
 * @param tokens - the session's accumulated token spend, when the product reported any.
 * @returns lanes for the strip, steps for the list, and the totals.
 */
export function buildTrace(
  events: readonly BridgeEvent[],
  tokens: BridgeTokenUsage | null,
): Trace {
  const last = events.at(-1)?.timestamp ?? 0
  const windows = activityWindows(events)
  const at = (timestamp: number): number => project(windows, timestamp)

  const inputSpans: TraceSpan[] = []
  const modelSpans: TraceSpan[] = []
  const toolSpans: TraceSpan[] = []
  const steps: TraceStep[] = []

  // Turn ordinals are assigned as turns start, so a step can name the turn it
  // belongs to without the Host having to number them.
  const turnOrdinals = new Map<string, number>()
  const turnStartedAt = new Map<string, number>()
  const firstTokenPerTurn = new Map<string, number>()
  // One entry per streaming item, extended as its deltas arrive: the model's own
  // output is the honest measure of model time.
  const openModel = new Map<string, { start: number; end: number; turn: string | null }>()
  const openTools = new Map<string, OpenTool>()

  for (const event of events) {
    const turnKey = event.bridgeTurnId
    const turn = turnKey === null ? null : turnOrdinals.get(turnKey) ?? null

    if (event.type === 'bridge/turn-started') {
      if (turnKey !== null && !turnOrdinals.has(turnKey)) {
        turnOrdinals.set(turnKey, turnOrdinals.size + 1)
        turnStartedAt.set(turnKey, event.timestamp)
      }
      continue
    }

    if (event.type === 'bridge/user-message') {
      // An instant, not a span: the operator's typing is not part of the trace.
      inputSpans.push({
        key: `input-${String(event.sequence)}`,
        startMs: at(event.timestamp),
        durationMs: 0,
        label: event.data.delivery,
        failed: false,
      })
      steps.push({
        key: `step-${String(event.sequence)}`,
        kind: 'user',
        name: null,
        call: condense(event.data.text) ?? '',
        result: null,
        atMs: at(event.timestamp),
        failed: false,
        turn,
      })
      continue
    }

    if (event.type === 'bridge/text-delta' || event.type === 'bridge/reasoning-delta') {
      const kind = event.type === 'bridge/text-delta' ? 'assistant' : 'reasoning'
      const id = `${turnKey ?? ''}:${event.data.itemId ?? ''}:${kind}`
      const held = openModel.get(id)
      if (held === undefined) {
        openModel.set(id, { start: event.timestamp, end: event.timestamp, turn: turnKey })
        steps.push({
          key: `step-${String(event.sequence)}`,
          kind,
          name: null,
          call: condense(event.data.text) ?? '',
          result: null,
          atMs: at(event.timestamp),
          failed: false,
          turn,
        })
      } else {
        held.end = event.timestamp
        // Deltas belong to one step, so the text accumulates onto the step the
        // first one opened rather than adding a row per token.
        const index = steps.findLastIndex(step => step.kind === kind && step.turn === turn)
        const previous = steps[index]
        if (previous !== undefined) {
          steps[index] = { ...previous, call: condense(`${previous.call} ${event.data.text}`) ?? previous.call }
        }
      }
      if (turnKey !== null && !firstTokenPerTurn.has(turnKey)) {
        firstTokenPerTurn.set(turnKey, event.timestamp)
      }
      continue
    }

    if (
      event.type === 'bridge/tool-started'
      || event.type === 'bridge/tool-updated'
      || event.type === 'bridge/tool-completed'
    ) {
      const id = event.data.itemId
      const held = openTools.get(id)
      if (held === undefined) {
        openTools.set(id, {
          key: `tool-${id}`,
          name: event.data.toolName,
          startedAt: event.timestamp,
          turn,
          call: condense(event.data.detail?.input) ?? condense(event.data.summary) ?? '',
          result: condense(event.data.detail?.output),
          endedAt: event.type === 'bridge/tool-completed' ? event.timestamp : null,
          failed: event.data.status === 'failed',
        })
      } else {
        held.call = condense(event.data.detail?.input) ?? held.call
        held.result = condense(event.data.detail?.output) ?? held.result
        held.failed = event.data.status === 'failed'
        if (event.type === 'bridge/tool-completed') held.endedAt = event.timestamp
      }
      continue
    }

    if (event.type === 'bridge/error') {
      steps.push({
        key: `step-${String(event.sequence)}`,
        kind: 'error',
        name: event.data.code,
        call: condense(event.data.message) ?? event.data.code,
        result: null,
        atMs: at(event.timestamp),
        failed: true,
        turn,
      })
      continue
    }

    if (event.type === 'bridge/history') {
      steps.push({
        key: `step-${String(event.sequence)}`,
        kind: 'context',
        name: null,
        call: String(event.data.restored),
        result: null,
        atMs: at(event.timestamp),
        failed: false,
        turn,
      })
    }
  }

  for (const [id, span] of openModel) {
    modelSpans.push({
      key: `model-${id}`,
      startMs: at(span.start),
      durationMs: Math.max(0, span.end - span.start),
      label: span.turn === null ? '' : String(turnOrdinals.get(span.turn) ?? ''),
      failed: false,
    })
  }

  for (const tool of openTools.values()) {
    // An unfinished call runs to the end of what is known, so a tool still running
    // shows as running rather than as an instant.
    const end = tool.endedAt ?? last
    toolSpans.push({
      key: tool.key,
      startMs: at(tool.startedAt),
      durationMs: Math.max(0, end - tool.startedAt),
      label: tool.name,
      failed: tool.failed,
    })
    steps.push({
      key: `step-${tool.key}`,
      kind: 'tool',
      name: tool.name,
      call: tool.call,
      result: tool.result,
      atMs: at(tool.startedAt),
      failed: tool.failed,
      turn: tool.turn,
    })
  }

  steps.sort((left, right) => left.atMs - right.atMs)

  const totalMs = windows.reduce((total, window) => total + (window.end - window.start), 0)

  const latencies = [...firstTokenPerTurn].flatMap(([turnKey, first]) => {
    const started = turnStartedAt.get(turnKey)
    return started === undefined ? [] : [first - started]
  })
  const cacheInput = tokens === null ? 0 : tokens.input + tokens.cacheRead + tokens.cacheWrite

  return {
    lanes: [
      { kind: 'input', spans: inputSpans },
      { kind: 'model', spans: modelSpans.sort((left, right) => left.startMs - right.startMs) },
      { kind: 'tools', spans: toolSpans.sort((left, right) => left.startMs - right.startMs) },
    ],
    steps,
    stats: {
      turns: turnOrdinals.size,
      steps: steps.length,
      totalMs,
      firstTokenMs: latencies.length === 0
        ? null
        : Math.round(latencies.reduce((total, value) => total + value, 0) / latencies.length),
      // Needs both a token count and a duration to divide it by; either missing
      // makes the rate noise presented as a measurement.
      tokensPerSecond: tokens === null || totalMs <= 0 || tokens.output <= 0
        ? null
        : Math.round(tokens.output / (totalMs / 1_000)),
      cacheHitRate: tokens === null || cacheInput <= 0 ? null : tokens.cacheRead / cacheInput,
      tokens,
    },
  }
}
