import { useEffect, useMemo, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, FormEvent, KeyboardEvent, ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
// Type-only: merges `locale` onto Context and declares the LocaleNamespaceMap
// this module extends below.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import {
  IconArchiveOutline20,
  IconCloseOutline16,
  IconCodeOutline16,
  IconFolderClose16,
  IconRefreshOutline16,
  IconSendOutline16,
  IconStopFill16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  InjectFace,
  PropsRuntime,
  TranslateNS,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {
  RemoteResult,
  TypertRemoteNamespaceMap,
} from '@deepseek-ai/dsh-typert-protocol'
import remoteContribution from '../typert.remote-client.ts'
import type {
  BridgeCatalogResult,
  BridgeCompletion,
  BridgeCompletionsResult,
  BridgeErrorCode,
  BridgeEvent,
  BridgeNativeSessionsResult,
  BridgeQuestion,
  BridgeSessionStatus,
  BridgeSessionView,
  BridgeStatusNote,
  NativeProviderView,
  PendingInteractionView,
} from '../types.ts'
import { en, type LocalAgentBridgeKey, zh } from './locales.ts'
import { PANEL_STYLES } from './styles.ts'

export type { LocalAgentBridgeKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Every string this panel renders, plus the reader-facing phrasing of the Host's enumerations. */
    'local-agent-bridge': LocalAgentBridgeKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'local-agent-bridge'

/**
 * Statuses in which the Host has work in flight for this session, so the turn
 * can be cancelled and the session badge should read as active.
 */
const BUSY_STATUSES: readonly BridgeSessionStatus[] = [
  'running',
  'awaiting-approval',
  'awaiting-answer',
  'cancelling',
]

/**
 * Modifier class per timeline row kind, written out rather than interpolated
 * from the kind. A `lab-row-card--${kind}` template compiles fine but leaves no
 * literal in the source, so neither a reader nor the stylesheet test can tell
 * which modifiers exist — and a kind whose rule was never written would simply
 * render unstyled. This table makes the set exhaustive at compile time.
 */
const ROW_MODIFIER: Record<TimelineRow['kind'], string> = {
  // The plain card is the assistant's own answer; it needs no modifier.
  assistant: '',
  user: 'lab-row-card--user',
  reasoning: 'lab-row-card--reasoning',
  tool: 'lab-row-card--tool',
  status: 'lab-row-card--status',
  error: 'lab-row-card--error',
}

/**
 * This panel's translate function, typed to its own key union. Named in full
 * because `unwrap<T>` right below uses `T` as a generic parameter.
 */
type PanelTranslate = TranslateNS<'local-agent-bridge'>

export type LocalAgentRemote = TypertRemoteNamespaceMap['localAgentBridge']

/**
 * Registering a Workspace is a DSH-core capability, not a bridge one: the
 * bridge only ever consumes the registry the Host already owns. The panel
 * reaches it through this seam so it can offer the step in place, instead of
 * sending the operator to the sidebar and back.
 */
interface WorkspaceRegistrar {
  /** Register an existing Host path; resolves once the registry has it. */
  create(path: string): Promise<void>
  /**
   * List one directory level on the Host. Backed by the `browse` capability;
   * rejects when the composed picker serves a different one.
   * @param path - absolute directory, or absent for the Host home directory.
   */
  list(path?: string): Promise<DirectoryListing>
  /**
   * Open the Host's own directory chooser. Backed by the `native` capability;
   * rejects when the composed picker serves a different one. Resolves to null
   * when the operator cancelled.
   */
  pick(): Promise<string | null>
}

/**
 * One directory level as the Host reports it, derived from the workspaces
 * service rather than imported. `@deepseek-ai/dsh-api-remotes` would be a new
 * peer dependency for one data shape, and deriving it means the panel cannot
 * drift from what the Host actually returns.
 */
type DirectoryListing = Awaited<ReturnType<ClientContext['workspaces']['listDirectory']>>

/** Which directory-choosing route this Profile actually supports. */
type BrowseSupport = 'unknown' | 'browse' | 'native' | 'none'

interface LocalAgentPanelFace {
  readonly remote: LocalAgentRemote
  readonly t: PanelTranslate
  readonly workspaces: WorkspaceRegistrar
}

type LocalAgentPanelProps = PropsRuntime<'sidebar.footer.action'> & InjectFace<LocalAgentPanelFace>

interface SessionSnapshot {
  readonly session: BridgeSessionView
  readonly pendingInteraction: PendingInteractionView | null
  readonly events: readonly BridgeEvent[]
}

interface TimelineRow {
  readonly key: string
  readonly kind: 'user' | 'assistant' | 'reasoning' | 'tool' | 'status' | 'error'
  readonly title: string
  readonly text: string
}


function unwrap<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    const abort = (): void => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}

/**
 * Status notes this Client build knows how to phrase.
 *
 * Events are persisted, so the timeline mixes events written by this build with
 * events written by older or newer ones. An older event has no `note` property
 * at all; a newer Host may send a note this dictionary has never heard of.
 * `t()` deliberately returns the key itself on a miss — right for a developer
 * typo, wrong here, where it filled the timeline with `note.undefined`. An
 * unrecognized note therefore renders as nothing: the status word above it
 * already carries the meaning.
 */
const STATUS_NOTES: readonly BridgeStatusNote[] = [
  'cancelling-turn',
  'host-restarted-resumable',
  'host-restarted-orphaned',
]

/**
 * Phrase a status note, or return empty for one this build does not know.
 * @param t - the panel's translate function.
 * @param note - the event's note property, from persisted data of any vintage.
 * @returns reader-facing text, or '' when there is nothing safe to say.
 */
function statusNoteText(t: PanelTranslate, note: unknown): string {
  return STATUS_NOTES.includes(note as BridgeStatusNote) ? t(`note.${note as BridgeStatusNote}`) : ''
}

/**
 * Localize one bridge error code, falling back to the Host's own sentence for
 * a code this Client build does not know — a newer Host must still be able to
 * say something, and an untranslated sentence beats a bare identifier.
 * @param t - the panel's translate function.
 * @param code - the code carried by the event.
 * @param hostMessage - the Host's redacted sentence for the same failure.
 * @returns reader-facing text.
 */
function errorText(t: PanelTranslate, code: BridgeErrorCode, hostMessage: string): string {
  const key = `error.${code}` as LocalAgentBridgeKey
  const translated = t(key)
  return translated === key ? hostMessage : translated
}

/**
 * Project the retained event stream into rendered rows, localizing every
 * label the bridge itself produced while passing vendor text (tool names,
 * summaries, model output) through untouched.
 * @param events - retained events in sequence order.
 * @param t - the panel's translate function.
 * @returns rows in render order, streaming deltas already coalesced.
 */
function timeline(events: readonly BridgeEvent[], t: PanelTranslate): TimelineRow[] {
  const rows: TimelineRow[] = []
  for (const event of events) {
    const key = `${String(event.sequence)}-${event.type}`
    if (event.type === 'bridge/user-message') {
      rows.push({ key, kind: 'user', title: t(`row.delivery.${event.data.delivery}`), text: event.data.text })
    } else if (event.type === 'bridge/text-delta' || event.type === 'bridge/reasoning-delta') {
      const kind = event.type === 'bridge/text-delta' ? 'assistant' : 'reasoning'
      const previous = rows.at(-1)
      const group = `${event.bridgeTurnId ?? ''}:${event.data.itemId ?? ''}:${kind}`
      if (previous?.key.endsWith(group)) {
        rows[rows.length - 1] = { ...previous, text: previous.text + event.data.text }
      } else {
        rows.push({ key: `${key}:${group}`, kind, title: t(`row.${kind}`), text: event.data.text })
      }
    } else if (event.type === 'bridge/tool-started' || event.type === 'bridge/tool-updated' || event.type === 'bridge/tool-completed') {
      rows.push({
        key,
        kind: 'tool',
        // The tool name is the vendor's; only the status word is ours.
        title: t('row.tool', { tool: event.data.toolName, status: t(`row.toolStatus.${event.data.status}`) }),
        text: event.data.summary,
      })
    } else if (event.type === 'bridge/file-change') {
      rows.push({ key, kind: 'tool', title: t('row.fileChange'), text: event.data.summary })
    } else if (event.type === 'bridge/error') {
      rows.push({
        key,
        kind: 'error',
        // A turn the operator stopped is not a failure. Labelling it "Error"
        // reads as something having gone wrong with what they just asked for.
        title: event.data.code === 'USER_CANCELLED' ? t('row.cancelled') : t('row.error'),
        text: errorText(t, event.data.code, event.data.message),
      })
    } else if (event.type === 'bridge/session-status') {
      rows.push({
        key,
        kind: 'status',
        title: t(`status.${event.data.status}`),
        // A note is present only when it adds something the status word does
        // not already say; an error-driven transition leaves it null because
        // the bridge/error row above already named the cause.
        text: statusNoteText(t, event.data.note),
      })
    }
  }
  return rows
}

/**
 * Explain an unusable product in the reader's language, from the structured
 * fields alone. `error` is the one state that keeps the Host's own redacted
 * diagnostic, because the product's stderr is the only real explanation and
 * the Client cannot reconstruct it.
 * @param t - the panel's translate function.
 * @param provider - the catalog entry to explain.
 * @returns one sentence, or null when the product is usable.
 */
function healthDetail(t: PanelTranslate, provider: NativeProviderView): string | null {
  const name = provider.displayName
  if (provider.health === 'ready') return null
  if (provider.health === 'not-installed') return t('health.detail.not-installed', { name })
  if (provider.health === 'auth-required') return t('health.detail.auth-required', { name })
  if (provider.health === 'error') {
    const base = t('health.detail.error', { name })
    return provider.message === null ? base : `${base} ${provider.message}`
  }
  if (provider.compatibility === 'unknown' || provider.version === null) {
    return t('health.detail.unverified', { name })
  }
  return t('health.detail.unsupported', {
    name,
    version: provider.version,
    range: provider.supportedRange ?? '',
  })
}

function ActionButton({ children, primary, danger, icon, className, ...props }: {
  children: ReactNode
  primary?: boolean
  danger?: boolean
  /** Square, label-less button (a titlebar action). */
  icon?: boolean
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={[
        'lab-btn',
        primary === true ? 'lab-btn--primary' : '',
        danger === true ? 'lab-btn--danger' : '',
        icon === true ? 'lab-btn--icon' : '',
        className ?? '',
      ].filter(part => part !== '').join(' ')}
      {...props}
    >
      {children}
    </button>
  )
}

function QuestionInput({
  question,
  value,
  onChange,
  t,
}: {
  question: BridgeQuestion
  value: readonly string[]
  onChange: (value: string[]) => void
  t: PanelTranslate
}) {
  const toggle = (candidate: string): void => {
    if (!question.multiSelect) {
      onChange([candidate])
      return
    }
    onChange(value.includes(candidate) ? value.filter(item => item !== candidate) : [...value, candidate])
  }
  return (
    <fieldset className="lab-question">
      <legend className="lab-question-legend">{question.header}</legend>
      <p className="lab-question-prompt">{question.prompt}</p>
      <div className="lab-choices">
        {question.options.map(option => (
          <label key={option.value} className="lab-choice">
            <input
              type={question.multiSelect ? 'checkbox' : 'radio'}
              name={question.id}
              checked={value.includes(option.value)}
              onChange={() => { toggle(option.value) }}
            />
            <span>
              <span className="lab-choice-label">{option.label}</span>
              {option.description !== null && <small className="lab-choice-desc">{option.description}</small>}
            </span>
          </label>
        ))}
        {question.allowFreeText && (
          <input
            className="lab-input"
            type={question.secret ? 'password' : 'text'}
            placeholder={t('interaction.freeText')}
            value={question.options.some(option => value.includes(option.value)) ? '' : value[0] ?? ''}
            onChange={event => { onChange(event.target.value.length === 0 ? [] : [event.target.value]) }}
          />
        )}
      </div>
    </fieldset>
  )
}

/**
 * Inline directory browser, one Host level at a time.
 *
 * The Host exposes directory choosing as a discriminated capability, and the two
 * kinds are not interchangeable: `native` opens a chooser on the Host's own
 * desktop (fine at a loopback desktop, useless from a browser anywhere else),
 * while `browse` returns listings the client renders itself. `host.pickDirectory`
 * rejects outright under a browse Profile — which is exactly what the panel's
 * first Browse button did — so the panel probes with a listing read, which has
 * no side effect and no dialog, and renders accordingly.
 */
function DirectoryBrowser({
  listing,
  loading,
  showHidden,
  t,
  onNavigate,
  onToggleHidden,
  onChoose,
  onCancel,
}: {
  listing: DirectoryListing | undefined
  loading: boolean
  showHidden: boolean
  t: PanelTranslate
  onNavigate: (path: string) => void
  onToggleHidden: (next: boolean) => void
  onChoose: (path: string) => void
  onCancel: () => void
}) {
  const entries = (listing?.entries ?? []).filter(entry => showHidden || !entry.hidden)
  return (
    <div className="lab-browse">
      <nav className="lab-crumbs" aria-label={t('browse.title')}>
        {(listing?.crumbs ?? []).map((crumb, index) => (
          <span key={crumb.path}>
            {index > 0 && <span className="lab-crumb-sep">/</span>}
            <button
              type="button"
              className="lab-crumb"
              title={crumb.path}
              onClick={() => { onNavigate(crumb.path) }}
            >
              {/* The Host marks its own home directory, so the first crumb can
                  read as Home instead of an absolute path. */}
              {crumb.path === listing?.home ? t('browse.home') : crumb.name}
            </button>
          </span>
        ))}
      </nav>

      <div className="lab-browse-list">
        {loading && <p className="lab-browse-note">{t('browse.loading')}</p>}
        {!loading && entries.length === 0 && <p className="lab-browse-note">{t('browse.empty')}</p>}
        {!loading && entries.map(entry => (
          <button
            key={entry.path}
            type="button"
            className={entry.hidden ? 'lab-browse-row lab-browse-row--hidden' : 'lab-browse-row'}
            title={entry.path}
            onClick={() => { onNavigate(entry.path) }}
          >
            <IconFolderClose16 />
            <span className="lab-browse-name">{entry.name}</span>
          </button>
        ))}
        {listing?.truncated === true && <p className="lab-browse-note">{t('browse.truncated')}</p>}
      </div>

      <label className="lab-browse-toggle">
        <input
          type="checkbox"
          checked={showHidden}
          onChange={event => { onToggleHidden(event.target.checked) }}
        />
        {t('browse.showHidden')}
      </label>

      {listing !== undefined && <p className="lab-browse-path">{listing.path}</p>}

      <div className="lab-row">
        <ActionButton
          primary
          className="lab-grow"
          disabled={listing === undefined}
          onClick={() => { if (listing !== undefined) onChoose(listing.path) }}
        >
          {t('browse.useThis')}
        </ActionButton>
        <ActionButton onClick={onCancel}>{t('browse.cancel')}</ActionButton>
      </div>
    </div>
  )
}

/**
 * Picker for a product-native session to continue.
 *
 * Everything here comes from the product's own enumeration API, so the list is
 * whatever the product itself would offer — including sessions the operator ran
 * in a terminal, which is the point. Selecting one seeds the new bridge session's
 * native locator; the bridge does not read or replay the transcript, it hands the
 * locator to the product's own resume path on the first turn.
 */
function NativeSessionPicker({
  result,
  loading,
  selected,
  t,
  onSelect,
  onConfirm,
  onCancel,
}: {
  result: BridgeNativeSessionsResult | undefined
  loading: boolean
  selected: string | undefined
  t: PanelTranslate
  onSelect: (locator: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  const sessions = result?.sessions ?? []
  return (
    <div className="lab-resume">
      <div className="lab-resume-list" role="listbox" aria-label={t('resume.title')}>
        {loading && <p className="lab-browse-note">{t('resume.loading')}</p>}
        {!loading && result?.unavailable === true && <p className="lab-browse-note">{t('resume.unavailable')}</p>}
        {!loading && result?.unavailable === false && sessions.length === 0 && (
          <p className="lab-browse-note">{t('resume.empty')}</p>
        )}
        {!loading && sessions.map(session => (
          <button
            key={session.locator}
            type="button"
            role="option"
            aria-selected={selected === session.locator}
            className="lab-resume-row"
            onClick={() => { onSelect(session.locator) }}
            onDoubleClick={() => { onSelect(session.locator); onConfirm() }}
          >
            <span className="lab-resume-title">{session.title}</span>
            <span className="lab-resume-meta">
              <span>{formatWhen(session.updatedAt)}</span>
              {session.branch !== null && <span>{t('resume.branch', { branch: session.branch })}</span>}
            </span>
          </button>
        ))}
      </div>
      <div className="lab-row">
        <ActionButton primary className="lab-grow" disabled={selected === undefined} onClick={onConfirm}>
          {t('resume.submit')}
        </ActionButton>
        <ActionButton onClick={onCancel}>{t('resume.cancel')}</ActionButton>
      </div>
    </div>
  )
}

/**
 * Render a timestamp the way a picker needs it: precise enough to tell two of
 * today's sessions apart, and locale-aware because the panel is bilingual.
 * @param epochMs - the product's reported last-activity time.
 * @returns a short local date-time, or an em dash when the product gave none.
 */
function formatWhen(epochMs: number): string {
  if (epochMs <= 0) return '—'
  return new Date(epochMs).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * The slash prefix the operator types to open the palette. Not localized: it is
 * the syntax Claude Code itself uses, and Codex skills are filtered by the same
 * gesture even though their names carry no slash.
 */
const PALETTE_TRIGGER = '/'

/**
 * Read the palette query out of the composer.
 *
 * The palette opens only while the draft is a single leading-slash token — the
 * gesture that means "I am picking a command", the same as in the products' own
 * terminals. A slash later in a sentence is a path or a date, and a space after
 * the token means the operator has moved on to arguments, so both close it.
 * @param draft - the composer's current contents.
 * @returns the query after the slash, or null when the palette should stay shut.
 */
function paletteQuery(draft: string): string | null {
  if (!draft.startsWith(PALETTE_TRIGGER)) return null
  const rest = draft.slice(PALETTE_TRIGGER.length)
  return /\s/.test(rest) ? null : rest
}

/**
 * Rank completions against the query.
 *
 * A prefix match outranks a substring match, which outranks a description hit,
 * so typing `co` puts `/compact` above a skill that merely mentions compaction.
 * Matching is case-insensitive and touches only vendor-provided text.
 * @param completions - everything the product reported.
 * @param query - the text after the slash; empty lists everything.
 * @returns the matches, best first.
 */
function rankCompletions(
  completions: readonly BridgeCompletion[],
  query: string,
): BridgeCompletion[] {
  const needle = query.toLowerCase()
  if (needle.length === 0) return [...completions]
  const scored: { completion: BridgeCompletion; score: number }[] = []
  for (const completion of completions) {
    const name = completion.name.toLowerCase()
    const score = name.startsWith(needle)
      ? 0
      : name.includes(needle)
        ? 1
        : (completion.description ?? '').toLowerCase().includes(needle)
          ? 2
          : -1
    if (score >= 0) scored.push({ completion, score })
  }
  return scored
    .sort((left, right) => left.score - right.score || left.completion.name.localeCompare(right.completion.name))
    .map(entry => entry.completion)
}

/**
 * The command palette: what the product itself says it can do.
 *
 * Selecting an entry writes the product's own invocation text into the composer
 * and nothing more — the bridge never executes a command on the product's
 * behalf. That keeps `/compact` meaning exactly what it means in a terminal, and
 * means a product that gains, renames or drops a command needs no change here.
 * MCP servers are listed but not selectable: they are inventory, not something
 * the composer can invoke.
 */
function CommandPalette({
  completions,
  pending,
  query,
  activeIndex,
  t,
  onPick,
}: {
  completions: readonly BridgeCompletion[]
  pending: boolean
  query: string
  activeIndex: number
  t: PanelTranslate
  onPick: (completion: BridgeCompletion) => void
}) {
  const matches = rankCompletions(completions, query)
  const commands = matches.filter(entry => entry.kind === 'command')
  const servers = matches.filter(entry => entry.kind === 'mcp')

  if (pending) return <div className="lab-palette"><p className="lab-palette-note">{t('palette.pending')}</p></div>
  if (completions.length === 0) return <div className="lab-palette"><p className="lab-palette-note">{t('palette.none')}</p></div>
  if (matches.length === 0) return <div className="lab-palette"><p className="lab-palette-note">{t('palette.empty')}</p></div>

  let cursor = -1
  return (
    <div className="lab-palette" role="listbox" aria-label={t('palette.commands')}>
      {commands.length > 0 && <p className="lab-palette-group">{t('palette.commands')}</p>}
      {commands.map((entry) => {
        cursor += 1
        const selected = cursor === activeIndex
        return (
          <button
            key={`command:${entry.name}`}
            type="button"
            role="option"
            aria-selected={selected}
            className="lab-palette-item"
            // The composer keeps focus: the operator is still typing the filter.
            onMouseDown={event => { event.preventDefault() }}
            onClick={() => { onPick(entry) }}
          >
            <span className="lab-palette-name">{entry.insertText ?? entry.name}</span>
            {entry.argumentHint !== null && <span className="lab-palette-arg">{entry.argumentHint}</span>}
            {entry.description !== null && <span className="lab-palette-desc">{entry.description}</span>}
          </button>
        )
      })}
      {servers.length > 0 && <p className="lab-palette-group">{t('palette.mcp')}</p>}
      {servers.map(entry => (
        <button
          key={`mcp:${entry.name}`}
          type="button"
          className="lab-palette-item"
          disabled
          title={t('palette.mcpNotInvocable')}
        >
          <span className="lab-palette-name">{entry.name}</span>
          {entry.status !== null && <span className="lab-palette-arg">{entry.status}</span>}
          {entry.description !== null && <span className="lab-palette-desc">{entry.description}</span>}
        </button>
      ))}
    </div>
  )
}

function InteractionCard({
  interaction,
  remote,
  onResolved,
  t,
}: {
  interaction: PendingInteractionView
  remote: LocalAgentRemote
  onResolved: () => void
  t: PanelTranslate
}) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => { setAnswers({}); setError(undefined) }, [interaction.interactionId])

  const respond = async (resolution: Parameters<LocalAgentRemote['interactionRespond']>[0]['resolution']) => {
    setBusy(true)
    setError(undefined)
    try {
      unwrap(await remote.interactionRespond({
        bridgeSessionId: interaction.bridgeSessionId,
        interactionId: interaction.interactionId,
        resolution,
      }))
      onResolved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lab-interaction">
      <p className="lab-interaction-kind">
        {interaction.kind === 'approval' ? t('interaction.approval') : t('interaction.question')}
      </p>
      <p className="lab-interaction-summary">{interaction.safeSummary}</p>
      {interaction.target !== null && <small className="lab-interaction-target">{interaction.target}</small>}
      {interaction.kind === 'question' && (
        <div>
          {interaction.questions.map(question => (
            <QuestionInput
              key={question.id}
              question={question}
              value={answers[question.id] ?? []}
              onChange={value => { setAnswers(current => ({ ...current, [question.id]: value })) }}
              t={t}
            />
          ))}
        </div>
      )}
      {error !== undefined && <p className="lab-interaction-error">{error}</p>}
      <div className="lab-interaction-actions">
        {interaction.kind === 'approval' ? (
          <>
            <ActionButton primary disabled={busy} onClick={() => { void respond({ kind: 'approval', action: 'allow' }) }}>{t('interaction.allowOnce')}</ActionButton>
            <ActionButton disabled={busy} onClick={() => { void respond({ kind: 'approval', action: 'deny' }) }}>{t('interaction.deny')}</ActionButton>
            <ActionButton danger disabled={busy} onClick={() => { void respond({ kind: 'approval', action: 'cancel' }) }}>{t('interaction.cancelTurn')}</ActionButton>
          </>
        ) : (
          <ActionButton primary disabled={busy} onClick={() => { void respond({ kind: 'question', answers }) }}>{t('interaction.submit')}</ActionButton>
        )}
      </div>
    </div>
  )
}

export function LocalAgentPanel({ wide, remote, t, workspaces }: LocalAgentPanelProps) {
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<BridgeCatalogResult>()
  const [sessions, setSessions] = useState<BridgeSessionView[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [snapshot, setSnapshot] = useState<SessionSnapshot>()
  const [providerId, setProviderId] = useState<string>()
  const [workspaceId, setWorkspaceId] = useState<string>()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [workspacePath, setWorkspacePath] = useState('')
  const [addingWorkspace, setAddingWorkspace] = useState(false)
  const [completions, setCompletions] = useState<BridgeCompletionsResult>({ completions: [], pending: true })
  const [paletteIndex, setPaletteIndex] = useState(0)
  const [historyIndex, setHistoryIndex] = useState(-1)
  const timelineRef = useRef<HTMLDivElement>(null)
  const [nativeSessions, setNativeSessions] = useState<BridgeNativeSessionsResult>()
  const [nativeSessionsOpen, setNativeSessionsOpen] = useState(false)
  const [nativeSessionsBusy, setNativeSessionsBusy] = useState(false)
  const [resumeLocator, setResumeLocator] = useState<string>()
  const [browseSupport, setBrowseSupport] = useState<BrowseSupport>('unknown')
  const [listing, setListing] = useState<DirectoryListing>()
  const [listingBusy, setListingBusy] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const sequence = useRef(0)

  const refresh = async (): Promise<void> => {
    const [nextCatalog, nextSessions] = await Promise.all([
      remote.catalog().then(unwrap),
      remote.sessionsList(false).then(unwrap),
    ])
    setCatalog(nextCatalog)
    setSessions(nextSessions)
    setProviderId(current => current ?? nextCatalog.providers.find(provider => provider.health === 'ready')?.id)
    setWorkspaceId(current => current ?? nextCatalog.workspaces.find(workspace => workspace.status === 'ok')?.id)
    setSelectedId(current => current ?? nextSessions[0]?.bridgeSessionId)
  }

  useEffect(() => {
    if (!open) return
    setError(undefined)
    void refresh().catch(cause => { setError(cause instanceof Error ? cause.message : String(cause)) })
  }, [open])

  useEffect(() => {
    if (!open || selectedId === undefined) {
      setSnapshot(undefined)
      return
    }
    const controller = new AbortController()
    sequence.current = 0
    setSnapshot(undefined)
    const poll = async (): Promise<void> => {
      let retryMs = 500
      while (!controller.signal.aborted) {
        try {
          const result = unwrap(await remote.sessionRead({
            bridgeSessionId: selectedId,
            afterSequence: sequence.current,
            waitMs: 25_000,
          }, controller.signal))
          setError(undefined)
          sequence.current = result.latestSequence
          setSnapshot(current => ({
            session: result.session,
            pendingInteraction: result.pendingInteraction,
            events: result.reset || current === undefined ? result.events : [...current.events, ...result.events],
          }))
          setSessions(current => current.map(item => item.bridgeSessionId === result.session.bridgeSessionId ? result.session : item))
          retryMs = 500
        } catch (cause) {
          if (controller.signal.aborted) return
          setError(cause instanceof Error ? cause.message : String(cause))
          await delay(retryMs, controller.signal).catch(() => {})
          retryMs = Math.min(retryMs * 2, 5_000)
        }
      }
    }
    void poll()
    return () => { controller.abort() }
  }, [open, remote, selectedId])

  // Re-read when the session changes and whenever it returns to idle: a turn is
  // what makes Claude Code able to report its commands at all, and the operator
  // may have added a skill or MCP server on the Host between turns.
  const sessionStatus = snapshot?.session.status
  useEffect(() => {
    if (!open || selectedId === undefined) {
      setCompletions({ completions: [], pending: true })
      return
    }
    if (sessionStatus !== undefined && BUSY_STATUSES.includes(sessionStatus)) return
    let cancelled = false
    void remote.sessionCompletions({ bridgeSessionId: selectedId })
      .then(unwrap)
      .then(next => { if (!cancelled) setCompletions(next) })
      .catch(() => { if (!cancelled) setCompletions({ completions: [], pending: true }) })
    return () => { cancelled = true }
  }, [open, remote, selectedId, sessionStatus])

  const rows = useMemo(() => timeline(snapshot?.events ?? [], t), [snapshot?.events, t])

  /**
   * What the operator has sent in this session, newest first — the list `↑`
   * walks. Taken from the timeline rather than tracked separately, so it survives
   * a page reload and a session switch the same way the transcript does.
   */
  const sentHistory = useMemo(
    () => rows.filter(row => row.kind === 'user').map(row => row.text).reverse(),
    [rows],
  )

  /**
   * Follow the stream, but only from the bottom.
   *
   * A terminal always scrolls, because there is nowhere else to be. Here the
   * operator can be reading earlier output while a turn streams, and yanking them
   * back would make the panel unusable during a long answer — so this follows
   * only when they were already at the end.
   */
  useEffect(() => {
    const element = timelineRef.current
    if (element === null) return
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight
    if (distanceFromBottom < 140) element.scrollTop = element.scrollHeight
  }, [rows, snapshot?.pendingInteraction])
  const query = paletteQuery(draft)
  const paletteOpen = query !== null && selectedId !== undefined
  const paletteMatches = useMemo(
    () => query === null ? [] : rankCompletions(completions.completions, query).filter(entry => entry.insertText !== null),
    [completions.completions, query],
  )
  const allProviders = catalog?.providers ?? []
  // Every product the Host could not offer, with the reason it could not. The
  // Host already computed an exact diagnosis; dropping these rows from the UI
  // left the operator watching a product vanish with no explanation.
  const blockedProviders = allProviders.filter(provider => provider.health !== 'ready')
  const allWorkspaces = catalog?.workspaces ?? []
  const readyWorkspaces = allWorkspaces.filter(workspace => workspace.status === 'ok')

  /**
   * Register a Host directory as a Workspace and select it, so the operator can
   * go from an empty registry to a running session without leaving the panel.
   * The path is resolved and validated on the Host; the browser only carries
   * the string the operator typed or the picker returned.
   * @param path - absolute Host path; blank input is ignored.
   */
  const addWorkspace = async (path: string): Promise<void> => {
    const target = path.trim()
    if (target.length === 0) return
    setAddingWorkspace(true)
    setError(undefined)
    try {
      // The bridge's own store, not the Harness registry: adding a directory for
      // an agent to work in must not put it in the Harness sidebar, which has no
      // way to hide a workspace once registered.
      const added = unwrap(await remote.directoryAdd({ path: target }))
      setCatalog(unwrap(await remote.catalog()))
      if (added.status === 'ok') setWorkspaceId(added.id)
      setWorkspacePath('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setAddingWorkspace(false)
    }
  }

  /**
   * Read one directory level, remembering that browsing works at all.
   * @param path - absolute directory, or absent for the Host home directory.
   * @returns true when the Host served the listing.
   */
  const readDirectory = async (path?: string): Promise<boolean> => {
    setListingBusy(true)
    try {
      const next = await workspaces.list(path)
      setListing(next)
      setBrowseSupport('browse')
      return true
    } catch {
      // A rejection here is the Profile serving a different capability, not a
      // broken Host, so it is not surfaced as an error banner.
      return false
    } finally {
      setListingBusy(false)
    }
  }

  /**
   * Start choosing a directory by whichever route this Profile serves.
   *
   * The listing read is the probe: it has no side effect and opens nothing, so
   * it is safe to attempt first. Only if the Host refuses it does the panel try
   * the native chooser, which is the route that pops a dialog on the Host
   * desktop. If neither works the path field remains, and says so.
   */
  const startBrowsing = async (): Promise<void> => {
    setError(undefined)
    if (await readDirectory(listing?.path)) return
    try {
      const picked = await workspaces.pick()
      setBrowseSupport('native')
      if (picked !== null) await addWorkspace(picked)
    } catch {
      setBrowseSupport('none')
    }
  }

  /**
   * Turn a directory's Harness visibility on or off.
   *
   * The Harness has no hidden workspace, so this genuinely registers and
   * unregisters one — which is why it is off by default and why the panel keeps
   * its own list rather than putting every directory there.
   * @param directoryId - the directory to publish or unpublish.
   * @param published - the desired state.
   */
  const setPublished = async (directoryId: string, published: boolean): Promise<void> => {
    setError(undefined)
    try {
      unwrap(await remote.directoryPublish({ directoryId, published }))
      setCatalog(unwrap(await remote.catalog()))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  /**
   * Drop a directory from the panel, and from the Harness if it was published.
   * The directory on disk is untouched.
   * @param directoryId - the directory to forget.
   */
  const removeDirectory = async (directoryId: string): Promise<void> => {
    setError(undefined)
    try {
      unwrap(await remote.directoryRemove({ directoryId }))
      const next = unwrap(await remote.catalog())
      setCatalog(next)
      // A session cannot be created against a directory that is gone.
      setWorkspaceId(current => current === directoryId
        ? next.workspaces.find(entry => entry.status === 'ok')?.id
        : current)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  /** Register the browsed directory and close the browser. */
  const chooseBrowsed = async (path: string): Promise<void> => {
    setListing(undefined)
    await addWorkspace(path)
  }

  /**
   * Create a bridge session, fresh or continuing a native one.
   * @param options - a native locator to continue, and a title to give it.
   */
  const createSession = async (options: { resumeLocator?: string; title?: string } = {}): Promise<void> => {
    if (providerId === undefined || workspaceId === undefined) return
    setBusy(true)
    try {
      const created = unwrap(await remote.sessionCreate({
        providerId: providerId as NativeProviderView['id'],
        workspaceId,
        ...options,
      }))
      setSessions(current => [created, ...current])
      setSelectedId(created.bridgeSessionId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Hide a bridge session from the panel. The vendor-native history is
   * untouched; only this bridge's view of it is archived.
   * @param bridgeSessionId - the session to archive.
   */
  const archiveSelected = async (bridgeSessionId: string): Promise<void> => {
    try {
      unwrap(await remote.sessionArchive({ bridgeSessionId, archived: true }))
      setSessions(current => current.filter(item => item.bridgeSessionId !== bridgeSessionId))
      setSelectedId(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  /**
   * Ask the selected product which of its sessions this workspace already has.
   *
   * Deferred to the moment the operator asks, not fetched with the catalog: for
   * Codex it means starting the App Server, and neither product should be woken
   * up just because the panel opened.
   */
  const openNativeSessions = async (): Promise<void> => {
    if (providerId === undefined || workspaceId === undefined) return
    setNativeSessionsOpen(true)
    setNativeSessionsBusy(true)
    setResumeLocator(undefined)
    setError(undefined)
    try {
      setNativeSessions(unwrap(await remote.nativeSessions({
        providerId: providerId as NativeProviderView['id'],
        workspaceId,
      })))
    } catch (cause) {
      setNativeSessions({ sessions: [], unavailable: true })
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setNativeSessionsBusy(false)
    }
  }

  /** Create a bridge session that continues the chosen native one. */
  const confirmResume = async (): Promise<void> => {
    if (resumeLocator === undefined) return
    setNativeSessionsOpen(false)
    const chosen = nativeSessions?.sessions.find(entry => entry.locator === resumeLocator)
    await createSession({
      resumeLocator,
      // The product's own name for the session, so the bridge list reads the same
      // as the terminal the operator started it in.
      ...chosen === undefined ? {} : { title: `${chosen.title} · ${t('resume.badge')}` },
    })
    setResumeLocator(undefined)
  }

  /**
   * Put a completion's own invocation text in the composer.
   *
   * A trailing space when the command takes arguments, so the operator can keep
   * typing; otherwise the draft is ready to send as it stands.
   * @param completion - the entry the operator chose.
   */
  const pickCompletion = (completion: BridgeCompletion): void => {
    if (completion.insertText === null) return
    setDraft(completion.argumentHint === null ? completion.insertText : `${completion.insertText} `)
    setPaletteIndex(0)
  }

  /**
   * Composer keys, matching what the two products' own terminals do.
   *
   * Enter sends and Shift+Enter inserts a newline. A textarea does the opposite
   * by default, which meant every message needed a trip to the mouse — the single
   * biggest departure from using either product in a shell.
   *
   * `↑` walks back through what has been sent, `Esc` interrupts a running turn,
   * and while the palette is open the arrows and Enter belong to it instead.
   * @param event - the keydown on the composer.
   */
  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // An IME is mid-composition: Enter is accepting a candidate, not sending.
    // Without this a Chinese or Japanese operator cannot type a single word
    // without firing the message off half-written.
    if (event.nativeEvent.isComposing) return

    if (paletteOpen && paletteMatches.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        setPaletteIndex(current => (current + step + paletteMatches.length) % paletteMatches.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const chosen = paletteMatches[paletteIndex]
        if (chosen === undefined) return
        event.preventDefault()
        pickCompletion(chosen)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setDraft('')
        return
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submitDraft()
      return
    }

    if (event.key === 'Escape') {
      // Esc means "stop what you are doing" in both terminals. With nothing
      // running there is nothing to stop, so it clears the draft instead.
      event.preventDefault()
      if (snapshot !== undefined && BUSY_STATUSES.includes(snapshot.session.status)) {
        void remote.sessionCancel({ bridgeSessionId: snapshot.session.bridgeSessionId })
      } else {
        setDraft('')
        setHistoryIndex(-1)
      }
      return
    }

    // History only takes over an empty composer, or one already being walked —
    // otherwise `↑` is ordinary cursor movement inside a multi-line draft.
    if (event.key === 'ArrowUp' && sentHistory.length > 0 && (draft.length === 0 || historyIndex >= 0)) {
      event.preventDefault()
      const next = Math.min(historyIndex + 1, sentHistory.length - 1)
      setHistoryIndex(next)
      setDraft(sentHistory[next] ?? '')
      return
    }
    if (event.key === 'ArrowDown' && historyIndex >= 0) {
      event.preventDefault()
      const next = historyIndex - 1
      setHistoryIndex(next)
      setDraft(next < 0 ? '' : sentHistory[next] ?? '')
    }
  }

  /**
   * Send the draft, restoring it if the Host refused.
   *
   * Separate from the form handler so the Enter key and the button share one
   * path; the draft is cleared optimistically because the round-trip is fast and
   * a cleared box is what a terminal does.
   */
  const submitDraft = async (): Promise<void> => {
    if (selectedId === undefined || draft.trim().length === 0) return
    const text = draft
    setDraft('')
    setHistoryIndex(-1)
    try {
      unwrap(await remote.sessionSend({ bridgeSessionId: selectedId, text }))
    } catch (cause) {
      setDraft(text)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const send = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    await submitDraft()
  }

  return (
    <>
      <style>{PANEL_STYLES}</style>
      <button
        type="button"
        className="lab-root lab-trigger"
        title={t('panel.name')}
        onClick={() => { setOpen(true) }}
      >
        <IconCodeOutline16 />{wide && <span>{t('panel.name')}</span>}
      </button>
      {open && (
        <div className="lab-root lab-scrim" role="dialog" aria-modal="true" aria-label={t('panel.name')}>
          <section className="lab-window">
            <header className="lab-titlebar">
              <div>
                <h2 className="lab-title">{t('panel.name')}</h2>
                <p className="lab-subtitle">{t('panel.subtitle')}</p>
              </div>
              <div className="lab-titlebar-actions">
                <ActionButton icon aria-label={t('panel.refresh')} title={t('panel.refresh')} onClick={() => { void refresh() }}>
                  <IconRefreshOutline16 />
                </ActionButton>
                <ActionButton icon aria-label={t('panel.close')} title={t('panel.close')} onClick={() => { setOpen(false) }}>
                  <IconCloseOutline16 />
                </ActionButton>
              </div>
            </header>

            <div className="lab-body">
              <aside className="lab-aside">
                <div className="lab-card">
                  <h3 className="lab-card-title">{t('create.heading')}</h3>
                  <div className="lab-stack" style={{ marginTop: 10 }}>
                    <label className="lab-field">
                      <span className="lab-field-label">{t('create.provider')}</span>
                      <select
                        className="lab-select"
                        value={providerId ?? ''}
                        onChange={event => { setProviderId(event.target.value) }}
                      >
                        <option value="" disabled>{t('create.provider.placeholder')}</option>
                        {/* Unusable products stay listed but unselectable: seeing
                            "Codex — unsupported version" explains the absence
                            that an omitted row silently created. */}
                        {allProviders.map(provider => (
                          <option key={provider.id} value={provider.id} disabled={provider.health !== 'ready'}>
                            {[provider.displayName, provider.version, provider.health === 'ready' ? null : `— ${t(`health.${provider.health}`)}`]
                              .filter(part => part !== null && part !== '')
                              .join(' ')}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="lab-field">
                      <span className="lab-field-label">{t('create.workspace')}</span>
                      <select
                        className="lab-select"
                        value={workspaceId ?? ''}
                        onChange={event => { setWorkspaceId(event.target.value) }}
                      >
                        <option value="" disabled>{t('create.workspace.placeholder')}</option>
                        {allWorkspaces.map(workspace => (
                          <option key={workspace.id} value={workspace.id} disabled={workspace.status !== 'ok'}>
                            {workspace.status === 'ok' ? workspace.title : `${workspace.title} — ${t('workspace.missingDir')}`}
                          </option>
                        ))}
                      </select>
                    </label>
                    <ActionButton
                      primary
                      disabled={busy || providerId === undefined || workspaceId === undefined}
                      onClick={() => { void createSession() }}
                    >
                      {busy ? t('create.busy') : t('create.submit')}
                    </ActionButton>
                    {/* Listing costs a product round-trip — for Codex, starting
                        the App Server — so it happens on request, not on open. */}
                    <ActionButton
                      disabled={busy || providerId === undefined || workspaceId === undefined}
                      onClick={() => { void openNativeSessions() }}
                    >
                      {t('resume.open')}
                    </ActionButton>
                  </div>
                </div>

                <div className="lab-card">
                  <h3 className="lab-card-title">{t('workspace.add')}</h3>
                  <p className="lab-card-hint">
                    {readyWorkspaces.length === 0 ? t('workspace.empty') : t('workspace.add.hint')}
                  </p>
                  <form
                    className="lab-stack"
                    onSubmit={event => { event.preventDefault(); void addWorkspace(workspacePath) }}
                  >
                    <input
                      className="lab-input"
                      value={workspacePath}
                      placeholder={t('workspace.path.placeholder')}
                      aria-label={t('workspace.path.placeholder')}
                      disabled={addingWorkspace}
                      onChange={event => { setWorkspacePath(event.target.value) }}
                    />
                    <div className="lab-row">
                      <ActionButton
                        primary
                        type="submit"
                        className="lab-grow"
                        disabled={addingWorkspace || workspacePath.trim().length === 0}
                      >
                        {addingWorkspace ? t('workspace.add.busy') : t('workspace.add.submit')}
                      </ActionButton>
                      {/* Hidden only once the Host has refused both routes; until
                          then it is offered, because which capability the Profile
                          serves is not knowable without asking. */}
                      {browseSupport !== 'none' && listing === undefined && (
                        <ActionButton disabled={addingWorkspace} onClick={() => { void startBrowsing() }}>
                          {t('workspace.browse')}
                        </ActionButton>
                      )}
                    </div>
                  </form>

                  {browseSupport === 'none' && <p className="lab-card-hint" style={{ margin: '9px 0 0' }}>{t('browse.unavailable')}</p>}

                  {allWorkspaces.length > 0 && (
                    <>
                      <p className="lab-section-label" style={{ margin: '12px 2px 0' }}>{t('workspace.list')}</p>
                      <p className="lab-card-hint" style={{ margin: '5px 0 0' }}>{t('workspace.publish.hint')}</p>
                      <div className="lab-dirs">
                        {allWorkspaces.map(workspace => (
                          <div className="lab-dir" key={workspace.id}>
                            <span className="lab-dir-label">
                              <span className="lab-dir-name" title={workspace.title}>{workspace.title}</span>
                              {workspace.status !== 'ok' && (
                                <span className="lab-dir-gone">{t('workspace.missingDir')}</span>
                              )}
                            </span>
                            <span className="lab-dir-actions">
                              <button
                                type="button"
                                role="switch"
                                className="lab-switch"
                                aria-checked={workspace.published}
                                aria-label={`${t('workspace.publish')} — ${workspace.title}`}
                                title={workspace.published ? t('workspace.published') : t('workspace.publish')}
                                onClick={() => { void setPublished(workspace.id, !workspace.published) }}
                              />
                              <button
                                type="button"
                                className="lab-icon-btn"
                                aria-label={`${t('workspace.remove')} — ${workspace.title}`}
                                title={t('workspace.remove')}
                                onClick={() => { void removeDirectory(workspace.id) }}
                              >
                                <IconCloseOutline16 />
                              </button>
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {blockedProviders.length > 0 && (
                  <div className="lab-card lab-card--attention">
                    <h3 className="lab-card-title">{t('diagnostics.heading')}</h3>
                    <div style={{ marginTop: 8 }}>
                      {blockedProviders.map(provider => (
                        <div className="lab-diagnostic" key={provider.id}>
                          <div className="lab-diagnostic-head">
                            {provider.displayName}
                            <span className="lab-chip lab-chip--attention">{t(`health.${provider.health}`)}</span>
                          </div>
                          <div className="lab-diagnostic-body">{healthDetail(t, provider)}</div>
                          {provider.health === 'not-installed' && (
                            <div className="lab-diagnostic-hint">{t('diagnostics.path.hint', { command: provider.id })}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <p className="lab-section-label">{t('sessions.heading')}</p>
                <div className="lab-sessions">
                  {sessions.map(session => (
                    <button
                      key={session.bridgeSessionId}
                      type="button"
                      className="lab-session"
                      aria-current={selectedId === session.bridgeSessionId}
                      onClick={() => { setSelectedId(session.bridgeSessionId) }}
                    >
                      <span className="lab-session-head">
                        <span className="lab-session-name">{session.title}</span>
                        <span className={BUSY_STATUSES.includes(session.status) ? 'lab-chip lab-chip--busy' : 'lab-chip'}>
                          {t(`status.${session.status}`)}
                        </span>
                      </span>
                      <span className="lab-session-meta">{session.workspaceTitle} · {session.providerId}</span>
                    </button>
                  ))}
                </div>
              </aside>

              <main className="lab-main">
                <div className="lab-toolbar">
                  <div>
                    <h3 className="lab-toolbar-title">{snapshot?.session.title ?? t('sessions.empty')}</h3>
                    {snapshot !== undefined && (
                      <p className="lab-toolbar-meta">
                        {snapshot.session.workspaceTitle} · {t(`status.${snapshot.session.status}`)}
                      </p>
                    )}
                  </div>
                  {snapshot !== undefined && (
                    <div className="lab-toolbar-actions">
                      <ActionButton
                        danger
                        disabled={!BUSY_STATUSES.includes(snapshot.session.status)}
                        onClick={() => { void remote.sessionCancel({ bridgeSessionId: snapshot.session.bridgeSessionId }) }}
                      >
                        <IconStopFill16 /> {t('session.cancel')}
                      </ActionButton>
                      <ActionButton onClick={() => { void archiveSelected(snapshot.session.bridgeSessionId) }}>
                        <IconArchiveOutline20 size={16} /> {t('session.archive')}
                      </ActionButton>
                    </div>
                  )}
                </div>

                <div className="lab-timeline" ref={timelineRef}>
                  {error !== undefined && <div className="lab-error-banner">{error}</div>}
                  {snapshot?.pendingInteraction !== null && snapshot?.pendingInteraction !== undefined && (
                    <InteractionCard
                      interaction={snapshot.pendingInteraction}
                      remote={remote}
                      onResolved={() => { setError(undefined) }}
                      t={t}
                    />
                  )}
                  <div className="lab-stream">
                    {rows.map(row => (
                      <article key={row.key} className={`lab-row-card ${ROW_MODIFIER[row.kind]}`}>
                        <small className="lab-row-label">{row.title}</small>
                        {row.text}
                      </article>
                    ))}
                  </div>
                </div>

                <form className="lab-composer" onSubmit={send}>
                  {paletteOpen && (
                    <CommandPalette
                      completions={completions.completions}
                      pending={completions.pending}
                      query={query}
                      activeIndex={paletteIndex}
                      t={t}
                      onPick={pickCompletion}
                    />
                  )}
                  <div className="lab-composer-row">
                    <textarea
                      className="lab-textarea"
                      value={draft}
                      placeholder={t('composer.placeholder')}
                      disabled={selectedId === undefined}
                      onChange={event => { setDraft(event.target.value); setPaletteIndex(0); setHistoryIndex(-1) }}
                      onKeyDown={onComposerKeyDown}
                    />
                    <ActionButton primary type="submit" disabled={selectedId === undefined || draft.trim().length === 0}>
                      <IconSendOutline16 /> {t('composer.send')}
                    </ActionButton>
                  </div>
                  <small className="lab-composer-hint">
                    {t('composer.keys')}
                    {completions.completions.length > 0 && ` · ${t('palette.hint')}`}
                  </small>
                  <small className="lab-composer-hint" style={{ marginTop: 3 }}>{t('composer.hint')}</small>
                </form>
              </main>
            </div>

            {nativeSessionsOpen && (
              <div className="lab-sheet-scrim" role="dialog" aria-modal="true" aria-label={t('resume.title')}>
                <section className="lab-sheet">
                  <header className="lab-sheet-head">
                    <h3 className="lab-sheet-title">{t('resume.title')}</h3>
                    <p className="lab-card-hint" style={{ margin: '4px 0 0' }}>{t('resume.hint')}</p>
                  </header>
                  <div className="lab-sheet-body">
                    <NativeSessionPicker
                      result={nativeSessions}
                      loading={nativeSessionsBusy}
                      selected={resumeLocator}
                      t={t}
                      onSelect={setResumeLocator}
                      onConfirm={() => { void confirmResume() }}
                      onCancel={() => { setNativeSessionsOpen(false); setResumeLocator(undefined) }}
                    />
                  </div>
                </section>
              </div>
            )}

            {listing !== undefined && (
              <div className="lab-sheet-scrim" role="dialog" aria-modal="true" aria-label={t('browse.title')}>
                <section className="lab-sheet">
                  <header className="lab-sheet-head">
                    <h3 className="lab-sheet-title">{t('browse.title')}</h3>
                  </header>
                  <div className="lab-sheet-body">
                    <DirectoryBrowser
                      listing={listing}
                      loading={listingBusy}
                      showHidden={showHidden}
                      t={t}
                      onNavigate={path => { void readDirectory(path) }}
                      onToggleHidden={setShowHidden}
                      onChoose={path => { void chooseBrowsed(path) }}
                      onCancel={() => { setListing(undefined) }}
                    />
                  </div>
                </section>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  )
}

/**
 * Required services (cordis fiber inject). `locale` carries the dictionaries,
 * and `workspaces` is DSH core's registry service — the panel registers a
 * directory through it rather than reimplementing a Host capability.
 */
export const inject = ['slots', 'remote', 'locale', 'workspaces']

export function apply(ctx: ClientContext): void {
  ctx.effect(async () => {
    return ctx.remote.$mount(remoteContribution)
  }, 'local-agent-bridge: mount Remote')
  // Both locales land in one typed call, so a dictionary that drifted out of
  // key parity fails the build rather than falling back at runtime. The
  // disposer releases the namespace on unload, leaving it free for a reload.
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'local-agent-bridge: dictionaries')
  ctx.inject(['slots', 'remote.localAgentBridge'], (scope) => {
    scope.slots.inject('sidebar.footer.action', () => scope.slots.register({
      name: 'sidebar.footer.action',
      id: 'local-agent-bridge',
      inject: (): LocalAgentPanelFace => ({
        remote: scope.remote.localAgentBridge,
        t: scope.locale.bind(NS),
        workspaces: {
          create: async (path) => { await scope.workspaces.create({ path }) },
          // Both routes are wired unconditionally. Which one the composed
          // Profile actually serves cannot be read from the client — the
          // capability kind is not in host.describe, and both methods exist on
          // the service regardless — so the panel probes with a listing read,
          // which has no side effect, and falls back to the native chooser.
          list: path => scope.workspaces.listDirectory(path),
          pick: () => scope.workspaces.pickDirectory(),
        },
      }),
    }, LocalAgentPanel))
  })
}
