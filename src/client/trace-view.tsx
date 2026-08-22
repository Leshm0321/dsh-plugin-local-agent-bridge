/**
 * The trace view: where a turn's time went, and what it actually did.
 *
 * A companion to the conversation rather than a replacement. The conversation
 * answers "what was said"; this answers "why did that take two minutes", which is a
 * different question and the one asked when something is slow or a tool did
 * something unexpected.
 *
 * Every figure here is derived from events the panel already holds — see
 * `buildTrace`. Nothing is fetched, and a number that cannot be measured is left out
 * rather than estimated: in a performance view, a made-up figure is worse than a
 * missing one because it will be believed.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { CSSProperties } from 'react'
import type { LocalAgentBridgeKey } from './locales.ts'
import type { Trace, TraceLaneKind, TraceStep } from './trace.ts'

type Translate = TranslateNS<'local-agent-bridge'>

/**
 * A duration at the precision a reader can act on: milliseconds while small,
 * seconds with one decimal, then minutes and seconds. The unit changes so the width
 * stays roughly constant.
 * @param ms - duration in milliseconds.
 * @returns a short label.
 */
export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${String(Math.round(ms))}ms`
  if (ms < 10_000) return `${(ms / 1_000).toFixed(1)}s`
  if (ms < 60_000) return `${String(Math.round(ms / 1_000))}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1_000)
  return `${String(minutes)}m${String(seconds).padStart(2, '0')}s`
}

/**
 * Compact a token count the way a status line should.
 * @param tokens - raw count.
 * @returns a short label.
 */
function formatCount(tokens: number): string {
  if (tokens < 1_000) return String(tokens)
  if (tokens < 1_000_000) return `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0)}k`
  return `${(tokens / 1_000_000).toFixed(1)}M`
}

/**
 * Modifier class per lane and per step kind, written out rather than interpolated.
 *
 * A `lab-trace-span--${kind}` template compiles fine and leaves no literal in the
 * source, so neither a reader nor the stylesheet guard can tell which modifiers
 * exist — and one whose rule was never written would simply render unstyled. Same
 * reasoning as the timeline's row modifiers.
 */
const LANE_CLASS: Record<TraceLaneKind, string> = {
  input: 'lab-trace-span--input',
  model: 'lab-trace-span--model',
  tools: 'lab-trace-span--tools',
}

const TAG_CLASS: Record<TraceStep['kind'], string> = {
  user: 'lab-trace-tag--user',
  assistant: 'lab-trace-tag--assistant',
  reasoning: 'lab-trace-tag--reasoning',
  tool: 'lab-trace-tag--tool',
  context: 'lab-trace-tag--context',
  error: 'lab-trace-tag--error',
}

/**
 * The tag shown against each step, keyed so the dictionary owns the wording.
 *
 * Typed to the dictionary's own key union rather than to `string`, so a renamed key
 * fails the build instead of rendering the key itself.
 */
const STEP_LABEL: Record<TraceStep['kind'], LocalAgentBridgeKey> = {
  user: 'trace.step.user',
  assistant: 'trace.step.assistant',
  reasoning: 'trace.step.reasoning',
  tool: 'trace.step.tool',
  context: 'trace.step.context',
  error: 'trace.step.error',
}

/**
 * Does this step match what the operator typed?
 *
 * Matches the tool name, the arguments and the result, because all three are things
 * someone searches a trace for — a file path appears in the arguments, an error
 * string in the result.
 * @param step - the step to test.
 * @param needle - lowercased query; empty matches everything.
 * @returns true when the step should be listed.
 */
function matches(step: TraceStep, needle: string): boolean {
  if (needle.length === 0) return true
  return `${step.name ?? ''} ${step.call} ${step.result ?? ''}`.toLowerCase().includes(needle)
}

/**
 * One lane of the timeline strip.
 *
 * Spans are positioned as percentages of the trace's own span, so the strip always
 * fills its width whatever the session's duration. A span shorter than a pixel is
 * still drawn at a minimum width — a 20ms tool call is a real event, and dropping it
 * would make the strip claim nothing happened.
 */
function Lane({ lane, totalMs, t }: { lane: Trace['lanes'][number]; totalMs: number; t: Translate }) {
  const scale = totalMs <= 0 ? 0 : 100 / totalMs
  return (
    <div className="lab-trace-lane">
      <span className="lab-trace-lane-label">{t(`trace.lane.${lane.kind}`)}</span>
      <div className="lab-trace-track">
        {lane.spans.map(span => (
          <span
            key={span.key}
            className={`lab-trace-span ${LANE_CLASS[lane.kind]}${span.failed ? ' lab-trace-span--failed' : ''}`}
            style={{
              left: `${String(Math.min(100, span.startMs * scale))}%`,
              width: `${String(Math.max(0.6, span.durationMs * scale))}%`,
            } as CSSProperties}
            // When, not how long: the strip's honest axis. A span's width is a
            // visual weight with a floor, not a measurement.
            title={`${span.label} · +${formatDuration(span.startMs)}`}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * The trace, as a strip over a list of steps with the totals beneath.
 * @param trace - derived from the session's events.
 * @param query - the operator's filter.
 * @param t - the panel's translator.
 * @param onQuery - receives filter changes.
 */
export function TraceView({
  trace,
  query,
  t,
  onQuery,
}: {
  trace: Trace
  query: string
  t: Translate
  onQuery: (next: string) => void
}) {
  const needle = query.trim().toLowerCase()
  const steps = trace.steps.filter(step => matches(step, needle))
  const { stats } = trace
  const percent = stats.cacheHitRate === null ? null : Math.round(stats.cacheHitRate * 100)

  return (
    <div className="lab-trace">
      <div className="lab-trace-head">
        <span className="lab-trace-summary">
          <span className="lab-trace-figure">{t('trace.duration', { value: formatDuration(stats.totalMs) })}</span>
          <span className="lab-trace-figure">{t('trace.turns', { count: stats.turns })}</span>
          <span className="lab-trace-figure">{t('trace.calls', { count: stats.steps })}</span>
        </span>
        <input
          type="search"
          className="lab-input lab-trace-search"
          value={query}
          placeholder={t('trace.search')}
          onChange={event => { onQuery(event.target.value) }}
        />
      </div>

      <div className="lab-trace-strip">
        {trace.lanes.map(lane => <Lane key={lane.kind} lane={lane} totalMs={stats.totalMs} t={t} />)}
      </div>

      <div className="lab-trace-steps">
        {steps.length === 0 && <p className="lab-browse-note">{t('trace.empty')}</p>}
        {steps.map(step => (
          <div
            key={step.key}
            className={step.failed ? 'lab-trace-step lab-trace-step--failed' : 'lab-trace-step'}
          >
            <span className={`lab-trace-tag ${TAG_CLASS[step.kind]}`}>{t(STEP_LABEL[step.kind])}</span>
            <span className="lab-trace-call" title={step.call}>
              {step.name !== null && step.kind === 'tool' && <b className="lab-trace-name">{step.name}</b>}
              {/* A restored transcript carries a count, not a sentence, so the
                  dictionary phrases it — a bare "3" in a trace means nothing. */}
              {step.kind === 'context' ? t('trace.restored', { count: Number(step.call) }) : step.call}
            </span>
            {step.result !== null && (
              <span className="lab-trace-result" title={step.result}>
                <span className="lab-trace-arrow">→</span>
                {step.result}
              </span>
            )}
            {/* When it was reported, not how long it took. A product stamps its own
                events when it chooses to — Codex was seen reporting a shell
                command's start and completion 1ms apart — so a duration column here
                would be a made-up number in the one view read for numbers. */}
            <span className="lab-trace-elapsed">+{formatDuration(step.atMs)}</span>
          </div>
        ))}
      </div>

      <p className="lab-trace-totals">
        {/* No model-time or tool-time split. It looks computable from the event
            timestamps and is not: those record when a product chose to report, not
            when it worked. See the note on tokensPerSecond. */}
        {stats.firstTokenMs !== null && (
          <span>{t('trace.firstToken', { value: formatDuration(stats.firstTokenMs) })}</span>
        )}
        {stats.tokensPerSecond !== null && (
          <span>{t('trace.rate', { count: stats.tokensPerSecond })}</span>
        )}
        {percent !== null && <span>{t('trace.cache', { percent })}</span>}
        {stats.tokens !== null && (
          <span>
            {t('trace.tokens', {
              input: formatCount(stats.tokens.input + stats.tokens.cacheRead + stats.tokens.cacheWrite),
              output: formatCount(stats.tokens.output),
            })}
          </span>
        )}
      </p>
    </div>
  )
}
