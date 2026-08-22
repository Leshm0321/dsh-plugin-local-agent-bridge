/**
 * Deriving the trace view.
 *
 * The derivation is where a performance view earns or loses its credibility, so the
 * arithmetic is pinned here: what counts as model time, what a still-running call
 * looks like, and which figures are refused rather than estimated.
 */
import { describe, expect, it } from 'vitest'
import { buildTrace } from '../../src/client/trace.ts'
import type { BridgeEvent, BridgeTokenUsage } from '../../src/types.ts'

let sequence = 0

/**
 * One event at an absolute millisecond offset.
 * @param ms - timestamp; the first event's value becomes the trace origin.
 * @param draft - the event's type and data.
 * @param turn - the turn it belongs to.
 * @returns a complete bridge event.
 */
function at(
  ms: number,
  draft: { type: BridgeEvent['type']; data: unknown },
  turn: string | null = 'turn-1',
): BridgeEvent {
  sequence += 1
  return {
    sequence,
    bridgeSessionId: 'session-1',
    bridgeTurnId: turn,
    timestamp: ms,
    ...draft,
  } as BridgeEvent
}

const tokens: BridgeTokenUsage = {
  input: 1_000,
  output: 500,
  cacheRead: 3_000,
  cacheWrite: 1_000,
  total: 5_500,
}

describe('trace', () => {
  it('places every kind of event on its lane, relative to the first one', () => {
    sequence = 0
    const trace = buildTrace([
      at(1_000, { type: 'bridge/user-message', data: { text: 'do it', delivery: 'started' } }),
      at(1_100, { type: 'bridge/turn-started', data: { turn: {} } }),
      at(1_600, { type: 'bridge/text-delta', data: { text: 'working', itemId: 'a' } }),
      at(2_000, { type: 'bridge/tool-started', data: { itemId: 't1', toolName: 'read', summary: 'read a', status: 'running' } }),
      at(3_500, { type: 'bridge/tool-completed', data: { itemId: 't1', toolName: 'read', summary: 'read a', status: 'completed', detail: { input: '{"path":"a"}', output: 'contents', truncated: false } } }),
      at(3_600, { type: 'bridge/text-delta', data: { text: ' done', itemId: 'a' } }),
    ], tokens)

    const lanes = new Map(trace.lanes.map(lane => [lane.kind, lane.spans]))
    // Offsets from the turn's start, not from the first event and not wall-clock:
    // the strip measures the work, and the operator's message at 1000ms happened
    // before there was any. It lands at the start rather than pushing everything
    // else along.
    expect(lanes.get('input')?.[0]).toMatchObject({ startMs: 0, durationMs: 0 })
    expect(lanes.get('tools')?.[0]).toMatchObject({ startMs: 900, durationMs: 1_500, label: 'read' })
    // The model lane runs from its first delta to its last, which is the model's
    // own output rather than everything that was not a tool.
    expect(lanes.get('model')?.[0]).toMatchObject({ startMs: 500, durationMs: 2_000 })
  })

  it('reports the turn’s duration, and claims no split within it', () => {
    sequence = 0
    const trace = buildTrace([
      at(0, { type: 'bridge/turn-started', data: { turn: {} } }),
      at(100, { type: 'bridge/text-delta', data: { text: 'a', itemId: 'a' } }),
      at(300, { type: 'bridge/text-delta', data: { text: 'b', itemId: 'a' } }),
      at(60_000, { type: 'bridge/turn-completed', data: { turn: {} } }),
    ], null)

    // The turn's own bounds are the bridge's own stamps, so this is measured.
    expect(trace.stats.totalMs).toBe(60_000)
    // And there is deliberately no "model time" or "tool time" to read. It looks
    // derivable from the event timestamps and is not: those record when a product
    // chose to report, not when it worked. A real Codex turn of 2m18s delivered
    // every event in its last three seconds, and stamped a shell command's start
    // and completion 1ms apart.
    expect('modelMs' in trace.stats).toBe(false)
    expect('toolMs' in trace.stats).toBe(false)
  })

  it('collapses a stream of deltas into one step rather than one per token', () => {
    sequence = 0
    const trace = buildTrace([
      at(0, { type: 'bridge/turn-started', data: { turn: {} } }),
      at(10, { type: 'bridge/text-delta', data: { text: 'one', itemId: 'a' } }),
      at(20, { type: 'bridge/text-delta', data: { text: ' two', itemId: 'a' } }),
      at(30, { type: 'bridge/text-delta', data: { text: ' three', itemId: 'a' } }),
    ], null)

    const assistant = trace.steps.filter(step => step.kind === 'assistant')
    expect(assistant).toHaveLength(1)
    expect(assistant[0]?.call).toBe('one two three')
  })

  it('shows a tool that has not finished as still running', () => {
    sequence = 0
    const trace = buildTrace([
      at(0, { type: 'bridge/turn-started', data: { turn: {} } }),
      at(500, { type: 'bridge/tool-started', data: { itemId: 't1', toolName: 'bash', summary: 'sleep', status: 'running' } }),
      at(4_000, { type: 'bridge/text-delta', data: { text: 'meanwhile', itemId: 'a' } }),
    ], null)

    const tool = trace.steps.find(step => step.kind === 'tool')
    // A step says when it was reported and nothing about how long it took.
    expect(tool?.atMs).toBe(500)
    expect('durationMs' in (tool ?? {})).toBe(false)
    // The span still stretches to the end of what is known, so a running call is
    // visible on the strip rather than being an invisible zero-width mark. That
    // width is a visual weight, which is why the tooltip gives the time it started
    // rather than a duration.
    const spans = trace.lanes.find(lane => lane.kind === 'tools')?.spans ?? []
    expect(spans[0]?.durationMs).toBe(3_500)
  })

  it('carries a tool’s arguments and its result onto one step', () => {
    sequence = 0
    const trace = buildTrace([
      at(0, { type: 'bridge/tool-started', data: { itemId: 't1', toolName: 'grep', summary: 'grep', status: 'running', detail: { input: '{"pattern":"router"}', output: null, truncated: false } } }),
      at(900, { type: 'bridge/tool-completed', data: { itemId: 't1', toolName: 'grep', summary: 'grep', status: 'completed', detail: { input: '{"pattern":"router"}', output: 'Found 78 matches', truncated: false } } }),
    ], null)

    const tool = trace.steps.find(step => step.kind === 'tool')
    expect(tool).toMatchObject({
      name: 'grep',
      call: '{"pattern":"router"}',
      result: 'Found 78 matches',
      failed: false,
    })
    // One row per call, updated in place — the same rule the conversation view uses.
    expect(trace.steps.filter(step => step.kind === 'tool')).toHaveLength(1)
  })

  it('averages first-token latency across turns that produced one', () => {
    sequence = 0
    const trace = buildTrace([
      at(0, { type: 'bridge/turn-started', data: { turn: {} } }, 'turn-1'),
      at(400, { type: 'bridge/text-delta', data: { text: 'a', itemId: 'a' } }, 'turn-1'),
      at(1_000, { type: 'bridge/turn-started', data: { turn: {} } }, 'turn-2'),
      at(1_800, { type: 'bridge/text-delta', data: { text: 'b', itemId: 'b' } }, 'turn-2'),
      // A third turn that never produced a token must not drag the mean toward zero.
      at(2_000, { type: 'bridge/turn-started', data: { turn: {} } }, 'turn-3'),
    ], null)

    expect(trace.stats.turns).toBe(3)
    expect(trace.stats.firstTokenMs).toBe(600)
  })

  it('refuses a rate it cannot measure rather than reporting zero', () => {
    sequence = 0
    const noTokens = buildTrace([
      at(0, { type: 'bridge/turn-started', data: { turn: {} } }),
      at(500, { type: 'bridge/text-delta', data: { text: 'a', itemId: 'a' } }),
      at(1_500, { type: 'bridge/text-delta', data: { text: 'b', itemId: 'a' } }),
    ], null)
    // A figure nobody reported is absent, not zero: a zero in a performance view
    // will be believed.
    expect(noTokens.stats.tokensPerSecond).toBeNull()
    expect(noTokens.stats.cacheHitRate).toBeNull()

    sequence = 0
    const noTurn = buildTrace([
      at(0, { type: 'bridge/user-message', data: { text: 'hi', delivery: 'started' } }),
    ], tokens)
    // Tokens but no turn to measure against: dividing by zero time is not a rate.
    expect(noTurn.stats.tokensPerSecond).toBeNull()
    // Cache ratio needs only the counts, so it survives.
    expect(noTurn.stats.cacheHitRate).toBeCloseTo(3_000 / 5_000, 5)
  })

  it('computes tokens per second against the turn’s duration', () => {
    sequence = 0
    const trace = buildTrace([
      at(0, { type: 'bridge/turn-started', data: { turn: {} } }),
      at(1_000, { type: 'bridge/text-delta', data: { text: 'a', itemId: 'a' } }),
      // Everything else lands in the last moment, as a real Codex turn does.
      at(9_900, { type: 'bridge/tool-started', data: { itemId: 't', toolName: 'bash', summary: 'x', status: 'running' } }),
      at(9_901, { type: 'bridge/tool-completed', data: { itemId: 't', toolName: 'bash', summary: 'x', status: 'completed' } }),
      at(10_000, { type: 'bridge/turn-completed', data: { turn: {} } }),
    ], tokens)

    // 500 output tokens over a 10s turn. Dividing instead by the 1ms between the
    // tool's two stamps — which an earlier version did — gave 7636 tok/s.
    expect(trace.stats.totalMs).toBe(10_000)
    expect(trace.stats.tokensPerSecond).toBe(50)
  })

  it('removes idle time from the duration, rather than reporting wall-clock', () => {
    sequence = 0
    // A turn, then the session sits untouched overnight, then another turn. The
    // first real session measured by first-to-last timestamps read "4262m40s".
    const overnight = 12 * 60 * 60 * 1_000
    const trace = buildTrace([
      at(0, { type: 'bridge/turn-started', data: { turn: {} } }, 'turn-1'),
      at(500, { type: 'bridge/text-delta', data: { text: 'a', itemId: 'a' } }, 'turn-1'),
      at(1_200, { type: 'bridge/turn-completed', data: { turn: {} } }, 'turn-1'),
      at(overnight, { type: 'bridge/turn-started', data: { turn: {} } }, 'turn-2'),
      at(overnight + 800, { type: 'bridge/text-delta', data: { text: 'b', itemId: 'b' } }, 'turn-2'),
    ], null)

    // Two stretches of work: 1.2s and 0.8s. The night in between is the operator's
    // time, not the session's.
    expect(trace.stats.totalMs).toBe(2_000)

    // And the strip places the second turn right after the first, so both are
    // visible instead of one being a hairline at the far edge.
    const modelSpans = trace.lanes.find(lane => lane.kind === 'model')?.spans ?? []
    expect(modelSpans).toHaveLength(2)
    expect(modelSpans[0]?.startMs).toBe(500)
    expect(modelSpans[1]?.startMs).toBe(2_000)
  })

  it('produces an empty trace for a session with no events', () => {
    expect(buildTrace([], null)).toMatchObject({
      steps: [],
      stats: { turns: 0, steps: 0, totalMs: 0, firstTokenMs: null, tokensPerSecond: null },
    })
  })
})
