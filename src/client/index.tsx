import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, CSSProperties, FormEvent, KeyboardEvent, ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
// Type-only: merges `locale` onto Context and declares the LocaleNamespaceMap
// this module extends below.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import {
  IconArchiveOutline20,
  IconBranchOutline16,
  IconCloseOutline16,
  IconCodeOutline16,
  IconDataOutline16,
  IconFolderClose16,
  IconFolderOpenOutline16,
  IconPanelLeftOutline16,
  IconPlusOutline16,
  IconRefreshOutline16,
  IconSendOutline16,
  IconSparkle16,
  IconStopFill16,
  useDismissOnOutsidePointer,
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
  BridgeContextUsage,
  BridgeErrorCode,
  BridgeEvent,
  BridgeFileMatch,
  BridgeFileSearchResult,
  BridgeHostListing,
  BridgeModelsResult,
  BridgeNativeSessionsResult,
  BridgePermissionMode,
  BridgePermissionModeView,
  BridgeQuestion,
  BridgeRateLimit,
  BridgeRepository,
  BridgeTokenUsage,
  BridgeSessionStatus,
  BridgeSessionView,
  BridgeStatusNote,
  BridgeToolDetail,
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
 * Largest file offered to the Host, matching the ceiling it enforces.
 *
 * Checked here as well so an oversized file is skipped before it is read and
 * encoded, rather than after a wasted trip through the wire. The Host remains the
 * authority — this is a courtesy, not a control.
 */
const UPLOAD_FILE_LIMIT = 8 * 1024 * 1024

/**
 * How often the repository status is re-read.
 *
 * Slow enough that it is invisible work, fast enough that a commit made in a
 * terminal shows up while the operator is still looking at the panel.
 */
const REPOSITORY_POLL_MS = 10_000


/**
 * Modifier class per timeline row kind, written out rather than interpolated
 * from the kind. A `lab-row-card--${kind}` template compiles fine but leaves no
 * literal in the source, so neither a reader nor the stylesheet test can tell
 * which modifiers exist — and a kind whose rule was never written would simply
 * render unstyled. This table makes the set exhaustive at compile time.
 */
const ROW_MODIFIER: Record<TimelineRow['kind'], string> = {
  // The agent's answer is the plain card, but it carries a modifier so its edge can
  // be told from the operator's tinted message. It used to be the unmarked default,
  // which left the two nearly identical.
  assistant: 'lab-row-card--assistant',
  user: 'lab-row-card--user',
  reasoning: 'lab-row-card--reasoning',
  tool: 'lab-row-card--tool',
  status: 'lab-row-card--status',
  error: 'lab-row-card--error',
  // Empty because a history row never reaches this table: it is a rule across the
  // transcript rather than a card, and TimelineEntry returns before consulting the
  // modifier. The key stays so the record covers every kind and a new one cannot be
  // added without a decision here.
  history: '',
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
  /**
   * The panel's active language as a BCP 47 tag, for speech recognition.
   *
   * A function rather than a value so the answer is read when dictation starts:
   * the operator can change language while the panel is mounted, and a captured
   * string would keep transcribing in the language it was built with.
   */
  readonly speechLocale: () => string
}

type LocalAgentPanelProps = PropsRuntime<'sidebar.footer.action'> & InjectFace<LocalAgentPanelFace>

interface SessionSnapshot {
  readonly session: BridgeSessionView
  readonly pendingInteraction: PendingInteractionView | null
  readonly events: readonly BridgeEvent[]
}

interface TimelineRow {
  readonly key: string
  readonly kind: 'user' | 'assistant' | 'reasoning' | 'tool' | 'status' | 'error' | 'history'
  readonly title: string
  readonly text: string
  /** Present on a tool row the product described beyond its summary. */
  readonly detail?: BridgeToolDetail
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
      // One row per tool call, updated in place. A call emits started and then
      // completed for the same itemId; two rows would show the same call twice
      // and hide the result behind the row that no longer applies.
      const existing = rows.findIndex(row => row.kind === 'tool' && row.key === `tool:${event.data.itemId}`)
      const row: TimelineRow = {
        key: `tool:${event.data.itemId}`,
        kind: 'tool',
        // The tool name is the vendor's; only the status word is ours.
        title: t('row.tool', { tool: event.data.toolName, status: t(`row.toolStatus.${event.data.status}`) }),
        text: event.data.summary,
        // A completed event carries the call and its result; a started event only
        // the call. Keeping the newer one means the row gains the result.
        ...event.data.detail === undefined ? {} : { detail: event.data.detail },
      }
      if (existing >= 0) rows[existing] = row
      else rows.push(row)
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
    } else if (event.type === 'bridge/history') {
      rows.push({
        key,
        kind: 'history',
        title: event.data.truncated
          ? t('history.truncated', { count: event.data.restored })
          : t('history.restored', { count: event.data.restored }),
        text: '',
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
 * Reveal streamed text at a steady rate, whatever rate it arrived at.
 *
 * Both products stream token by token, and the Host relays each delta the moment it
 * lands — but the browser reads through a long poll, so what it actually receives is
 * "everything that accumulated during one round trip". Measured on a real Codex
 * turn, that was 11 characters, then 346 at once. Correct, and it does not look like
 * streaming.
 *
 * So arrival and display are separated: text is revealed on a frame timer, and the
 * stride grows with the backlog. A big batch is caught up in a few frames rather
 * than appearing whole, and the reveal can never fall permanently behind — which a
 * fixed rate would, on a fast turn.
 *
 * Only for text still being written. A finished answer, or a row from a resumed
 * transcript, is shown complete: animating history would be a lie about when it
 * happened.
 * @param text - the full text known so far.
 * @param streaming - whether more is still expected.
 * @returns the prefix to render this frame.
 */
function useTypewriter(text: string, streaming: boolean): string {
  const [shown, setShown] = useState(streaming ? 0 : text.length)
  // Read inside the frame callback rather than captured, so the loop always sees
  // the latest text without being torn down and rebuilt for every delta.
  const target = useRef(text)
  target.current = text

  useEffect(() => {
    if (!streaming) {
      setShown(text.length)
      return
    }
    let frame = 0
    const step = (): void => {
      let running = true
      setShown((current) => {
        const total = target.current.length
        if (current >= total) {
          running = false
          return current
        }
        // A twelfth of the backlog per frame, at least two characters: fast enough
        // that a 346-character batch resolves in well under a second, slow enough
        // to read as typing rather than as a paste.
        return Math.min(total, current + Math.max(2, Math.ceil((total - current) / 12)))
      })
      if (running) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => { cancelAnimationFrame(frame) }
  }, [streaming, text.length])

  // Clamped, because a session switch can shorten the text under a stale count.
  return streaming ? text.slice(0, Math.min(shown, text.length)) : text
}

/**
 * One timeline row.
 *
 * A tool row the product described beyond its summary becomes expandable — the
 * detail a terminal prints inline. Collapsed by default because a transcript is
 * read for its shape first: a wall of tool output would bury the conversation the
 * operator is actually following.
 *
 * Memoized because every delta re-renders the panel, and a resumed session's
 * timeline is hundreds of rows: without this, one token of output repainted the
 * entire transcript, which lengthened the round trip and made the next batch bigger
 * still. The rows are rebuilt as fresh objects each time but their contents are
 * equal, so a shallow comparison keeps all but the changed row from re-rendering.
 */
const TimelineEntry = memo(function TimelineEntry({
  row,
  streaming,
  t,
}: {
  row: TimelineRow
  streaming: boolean
  t: PanelTranslate
}) {
  const [open, setOpen] = useState(false)
  const detail = row.detail
  const text = useTypewriter(row.text, streaming)
  if (row.kind === 'history') {
    // A rule with a caption, not a card: it describes the transcript rather than
    // being part of it, and a card would read as one more thing that was said.
    return (
      <p className="lab-history-rule">
        <span className="lab-history-label">{row.title}</span>
      </p>
    )
  }
  if (detail === undefined) {
    return (
      <article className={`lab-row-card ${ROW_MODIFIER[row.kind]}`}>
        <small className="lab-row-label">{row.title}</small>
        {text}
      </article>
    )
  }
  return (
    <article className={`lab-row-card ${ROW_MODIFIER[row.kind]}`}>
      <button
        type="button"
        className="lab-tool-toggle"
        aria-expanded={open}
        onClick={() => { setOpen(current => !current) }}
      >
        <span className="lab-row-label" style={{ margin: 0 }}>{row.title}</span>
        <span className="lab-tool-toggle-hint">{open ? t('tool.collapse') : t('tool.expand')}</span>
      </button>
      {text}
      {open && (
        <div className="lab-tool-detail">
          {detail.input !== null && (
            <div className="lab-tool-field">
              <span className="lab-tool-field-label">{t('tool.input')}</span>
              <pre className="lab-tool-pre">{detail.input}</pre>
            </div>
          )}
          {detail.output !== null && (
            <div className="lab-tool-field">
              <span className="lab-tool-field-label">{t('tool.output')}</span>
              <pre className="lab-tool-pre">{detail.output}</pre>
            </div>
          )}
          {detail.truncated && <span className="lab-tool-truncated">{t('tool.truncated')}</span>}
        </div>
      )}
    </article>
  )
})

/**
 * Permission-mode picker.
 *
 * The wording follows the Claude desktop app so the vocabulary matches what
 * operators already know. Only the modes the session's product can actually
 * honour are listed — the Host reports that per product, so a mode on screen is
 * always one the agent will obey rather than an approximation of it.
 *
 * A mode that stops the browser being asked to approve anything is marked on the
 * trigger and warned about in the menu. It is still offered, because both
 * products offer it; the panel's job is to say what it costs, not to overrule.
 */
function PermissionModePicker({
  modes,
  current,
  disabled,
  t,
  onSelect,
}: {
  modes: readonly BridgePermissionModeView[]
  current: BridgePermissionMode
  disabled: boolean
  t: PanelTranslate
  onSelect: (mode: BridgePermissionMode) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  // The Harness's own primitive, so every popover in this panel dismisses the way
  // the surrounding application's do.
  useDismissOnOutsidePointer(root, open, setOpen)
  const active = modes.find(entry => entry.mode === current)
  if (modes.length === 0) return null
  return (
    <span className="lab-mode" ref={root} onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}>
      <button
        type="button"
        className={`lab-mode-trigger${active?.skipsApproval === true ? ' lab-mode-trigger--unguarded' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => { setOpen(current_ => !current_) }}
      >
        {t(`mode.${current}`)}
      </button>
      {open && (
        <div className="lab-mode-menu" role="menu" aria-label={t('mode.label')}>
          {modes.map(entry => (
            <button
              key={entry.mode}
              type="button"
              role="menuitemradio"
              aria-checked={entry.mode === current}
              className="lab-mode-option"
              onClick={() => { setOpen(false); onSelect(entry.mode) }}
            >
              <span className="lab-mode-name">{t(`mode.${entry.mode}`)}</span>
              {entry.mode === current && <span className="lab-mode-check">✓</span>}
              <span className="lab-mode-hint">{t(`mode.${entry.mode}.hint`)}</span>
            </button>
          ))}
          {active?.skipsApproval === true && (
            <p className="lab-mode-warning">{t('mode.skipsApproval')}</p>
          )}
          <p className="lab-mode-footnote">{t('mode.nextTurn')}</p>
        </div>
      )}
    </span>
  )
}

/**
 * Context usage as a quiet meter beside the session title.
 *
 * Both products report the numbers differently and one of them may report no
 * window at all, so a missing maximum degrades to the raw count rather than
 * inventing a percentage. Rendered small and grey until it is nearly full,
 * because it only matters when it is.
 */
function ContextUsage({ usage, t }: { usage: BridgeContextUsage; t: PanelTranslate }) {
  const percent = usage.maxTokens === null || usage.maxTokens === 0
    ? null
    : Math.min(100, Math.round((usage.usedTokens / usage.maxTokens) * 100))
  const label = percent === null
    ? t('usage.tokens', { used: formatTokens(usage.usedTokens) })
    : t('usage.ofWindow', {
      used: formatTokens(usage.usedTokens),
      max: formatTokens(usage.maxTokens ?? 0),
      percent,
    })
  return (
    <span className="lab-usage" title={usage.model === null ? t('usage.title') : `${t('usage.title')} · ${usage.model}`}>
      <span className="lab-usage-text">{label}</span>
      {percent !== null && (
        <span className="lab-usage-bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={t('usage.title')}>
          <span
            className={`lab-usage-fill${percent >= 90 ? ' lab-usage-fill--full' : percent >= 70 ? ' lab-usage-fill--warn' : ''}`}
            style={{ width: `${percent}%` }}
          />
        </span>
      )}
    </span>
  )
}

/**
 * The working directory's branch and how much has changed in it.
 *
 * The thing a terminal shows without being asked, and the thing a browser panel
 * otherwise cannot: an agent editing a repository, with no indication of where
 * those edits are landing. Absent entirely when the directory is not a repository,
 * because inventing a branch would be worse than showing none.
 *
 * A detached HEAD says so rather than displaying a commit as though it were a
 * branch, and a branch tracking nothing says that too — pushing from a detached
 * HEAD or an untracked branch is a different act, and finding out afterwards is
 * the wrong time.
 */
function Repository({ repository, t }: { repository: BridgeRepository; t: PanelTranslate }) {
  const { branch, detached, upstream, ahead, behind, added, removed } = repository
  if (branch === null) return null
  const divergence = upstream === null
    ? t('repo.noUpstream')
    : [
      ahead > 0 ? `↑${ahead}` : null,
      behind > 0 ? `↓${behind}` : null,
    ].filter(part => part !== null).join(' ')
  return (
    <span
      className={`lab-repo${detached ? ' lab-repo--detached' : ''}`}
      title={[
        detached ? t('repo.detached') : branch,
        upstream === null ? t('repo.noUpstream') : t('repo.tracking', { upstream }),
      ].join(' · ')}
    >
      <IconBranchOutline16 size={13} />
      <span className="lab-repo-branch">{branch}</span>
      {(added > 0 || removed > 0) && (
        <span className="lab-repo-diff">
          <span className="lab-repo-added">+{formatTokens(added)}</span>
          <span className="lab-repo-removed">−{formatTokens(removed)}</span>
        </span>
      )}
      {divergence.length > 0 && <span className="lab-repo-track">{divergence}</span>}
    </span>
  )
}

/**
 * What the session has spent, as a total with the breakdown on hover.
 *
 * One number on screen because that is the one an operator watches; the split
 * between fresh input, output, and cache is what explains it, and it earns a
 * tooltip rather than four more figures competing with the context meter beside it.
 *
 * Cache reads are kept separate from cache writes because they price differently in
 * both products — folding them together would hide the thing that makes a long
 * session affordable.
 */
function TokenSpend({ usage, t }: { usage: BridgeTokenUsage; t: PanelTranslate }) {
  if (usage.total === 0) return null
  return (
    <span
      className="lab-spend"
      title={[
        t('spend.title'),
        t('spend.input', { count: formatTokens(usage.input) }),
        t('spend.output', { count: formatTokens(usage.output) }),
        t('spend.cacheRead', { count: formatTokens(usage.cacheRead) }),
        t('spend.cacheWrite', { count: formatTokens(usage.cacheWrite) }),
      ].join('\n')}
    >
      {t('spend.total', { count: formatTokens(usage.total) })}
    </span>
  )
}

/**
 * Compact a token count the way a status line should: exact while small, then
 * thousands, so the width stops changing on every delta.
 * @param tokens - raw count.
 * @returns a short label.
 */
function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens)
  if (tokens < 1_000_000) return `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0)}k`
  return `${(tokens / 1_000_000).toFixed(1)}M`
}

/**
 * A microphone, drawn here because the primitive set has none.
 *
 * A dictation button is unrecognisable without one, and the nearest icons in the
 * library mean other things — offering "play" or "enhance" for speech would be
 * worse than a shape drawn to match their weight.
 */
function MicIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      className="lab-mic-glyph"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="6" y="1.75" width="4" height="7.5" rx="2" />
      <path d="M3.75 7.25v.75a4.25 4.25 0 0 0 8.5 0v-.75" />
      <path d="M8 12.25v2" />
    </svg>
  )
}

/**
 * The Web Speech API, as much of it as dictation needs.
 *
 * Declared here rather than pulled from the DOM lib: the constructor is still
 * vendor-prefixed in the browsers that have it, and the ambient typings vary by
 * TypeScript release. A local shape that names only what is called keeps this
 * compiling wherever it is built, and documents exactly how much of the API this
 * panel depends on.
 */
interface SpeechRecognitionAlternativeLike {
  readonly transcript: string
}

interface SpeechRecognitionResultLike {
  readonly length: number
  [index: number]: SpeechRecognitionAlternativeLike | undefined
}

interface SpeechRecognitionEventLike {
  readonly resultIndex: number
  readonly results: {
    readonly length: number
    [index: number]: SpeechRecognitionResultLike | undefined
  }
}

interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

/**
 * Dictation, when the browser can do it.
 *
 * Feature-detected rather than sniffed, and absent rather than disabled when
 * missing: a permanently dead button teaches nothing.
 *
 * Worth being plain about, because this bridge otherwise keeps everything on the
 * Host: a browser's speech recognition is not necessarily local — Chromium sends
 * the audio to a vendor service to transcribe it. That is the browser's doing
 * rather than this plugin's, and it is the one thing in the panel that leaves the
 * machine, so the button says so on hover instead of presenting itself as free.
 * @param resolveLocale - reads the BCP 47 tag matching the panel's language, so
 * recognition expects what is actually being spoken. Called at start rather than
 * captured, so changing language mid-session takes effect.
 * @param onText - receives each final transcript.
 * @returns whether the browser offers dictation, whether it is running, and a toggle.
 */
function useDictation(resolveLocale: () => string, onText: (text: string) => void): {
  readonly supported: boolean
  readonly listening: boolean
  toggle: () => void
} {
  const [listening, setListening] = useState(false)
  const active = useRef<SpeechRecognitionLike | null>(null)
  // Read once: the constructor's presence cannot change during a page's life.
  const [factory] = useState<SpeechRecognitionConstructor | undefined>(() => {
    if (typeof window === 'undefined') return undefined
    const scope = window as unknown as {
      SpeechRecognition?: SpeechRecognitionConstructor
      webkitSpeechRecognition?: SpeechRecognitionConstructor
    }
    return scope.SpeechRecognition ?? scope.webkitSpeechRecognition
  })
  // Transcripts arrive long after the handler was installed, so the sink is held
  // in a ref rather than captured — otherwise the text would be appended to
  // whatever the draft happened to be when dictation started.
  const sink = useRef(onText)
  sink.current = onText

  useEffect(() => () => {
    active.current?.abort()
    active.current = null
  }, [])

  const toggle = (): void => {
    if (factory === undefined) return
    if (active.current !== null) {
      active.current.stop()
      return
    }
    const recognition = new factory()
    recognition.lang = resolveLocale()
    // Interim results are deliberately off: a composer is editable text, and
    // rewriting it on every partial guess fights the operator's own typing.
    recognition.interimResults = false
    recognition.continuous = false
    recognition.onresult = (event) => {
      let text = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const alternative = event.results[index]?.[0]
        if (alternative !== undefined) text += alternative.transcript
      }
      if (text.trim().length > 0) sink.current(text.trim())
    }
    const finish = (): void => {
      active.current = null
      setListening(false)
    }
    recognition.onerror = finish
    recognition.onend = finish
    active.current = recognition
    setListening(true)
    try {
      recognition.start()
    } catch {
      // Already running, or the microphone was refused. Either way no session
      // opened, so the button must not stay lit.
      finish()
    }
  }

  return { supported: factory !== undefined, listening, toggle }
}

/**
 * The model picker, and the reasoning effort that belongs to it.
 *
 * Offers exactly what the session's product reported and nothing else, so there
 * is no bridge-side list of model names to fall out of date. Effort nests under
 * the model because that is how both products scope it — a level one model
 * accepts is not necessarily one another does.
 *
 * "Default" is a real choice rather than a placeholder: leaving it selected keeps
 * whatever the operator configured in the CLI itself.
 *
 * A product that supports selection but cannot yet be asked gets an inert chip
 * saying so, rather than nothing. Claude Code enumerates its models only off a
 * live query, and an empty corner of the composer would read as "this product has
 * no models to choose" — which is a different and wrong statement.
 */
function ModelPicker({
  result,
  supported,
  model,
  effort,
  disabled,
  t,
  onSelect,
}: {
  result: BridgeModelsResult
  supported: boolean
  model: string | null
  effort: string | null
  disabled: boolean
  t: PanelTranslate
  onSelect: (model: string | null, effort: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  useDismissOnOutsidePointer(root, open, setOpen)
  if (!supported) return null
  if (result.unavailable || result.models.length === 0) {
    return (
      <span className="lab-model" ref={root}>
        <button type="button" className="lab-model-trigger" disabled title={t('model.unavailable')}>
          <IconSparkle16 size={14} />
          <span className="lab-model-name">{t('model.default')}</span>
        </button>
      </span>
    )
  }
  const active = result.models.find(entry => entry.id === model)
  const label = active === undefined
    ? t('model.default')
    : effort === null ? active.displayName : `${active.displayName} · ${effortLabel(t, effort)}`
  return (
    <span className="lab-model" ref={root} onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}>
      <button
        type="button"
        className="lab-model-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        title={t('model.label')}
        onClick={() => { setOpen(current => !current) }}
      >
        <IconSparkle16 size={14} />
        <span className="lab-model-name">{label}</span>
      </button>
      {open && (
        <div className="lab-model-menu" role="menu" aria-label={t('model.label')}>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={model === null}
            className="lab-model-option"
            onClick={() => { setOpen(false); onSelect(null, null) }}
          >
            <span className="lab-model-option-name">{t('model.default')}</span>
            {model === null && <span className="lab-model-check">✓</span>}
            <span className="lab-model-option-hint">{t('model.defaultHint')}</span>
          </button>
          {result.models.map(entry => (
            <div key={entry.id} className="lab-model-group">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={entry.id === model}
                className="lab-model-option"
                onClick={() => {
                  setOpen(false)
                  // Seeded with the product's own default effort rather than
                  // null: Codex reports one per model, and dropping it would run
                  // at whatever the product silently falls back to.
                  onSelect(entry.id, entry.defaultEffort)
                }}
              >
                <span className="lab-model-option-name">{entry.displayName}</span>
                {entry.id === model && <span className="lab-model-check">✓</span>}
                {entry.description !== null && (
                  <span className="lab-model-option-hint">{entry.description}</span>
                )}
              </button>
              {entry.id === model && entry.efforts.length > 0 && (
                <EffortSlider
                  efforts={entry.efforts}
                  effort={effort}
                  t={t}
                  onSelect={level => { onSelect(entry.id, level) }}
                />
              )}
            </div>
          ))}
          <p className="lab-mode-footnote">{t('mode.nextTurn')}</p>
        </div>
      )}
    </span>
  )
}

/**
 * Reasoning effort as one continuous control rather than a row of buttons.
 *
 * The levels are ordered — low through max is a single axis of "think harder" —
 * and a slider says that where separate buttons made five unrelated choices out of
 * one. It is a native `range` for the same reason the rest of this panel uses
 * native controls: keyboard, touch, and screen readers work without being
 * reimplemented.
 *
 * Discrete, not continuous: `step` is one level, and `aria-valuetext` reads the
 * level's name so the control announces "high" rather than "3".
 */
function EffortSlider({
  efforts,
  effort,
  t,
  onSelect,
}: {
  efforts: readonly string[]
  effort: string | null
  t: PanelTranslate
  onSelect: (level: string) => void
}) {
  const last = efforts.length - 1
  const found = effort === null ? -1 : efforts.indexOf(effort)
  const index = found < 0 ? 0 : found
  // Nothing chosen leaves the track unfilled rather than claiming the lowest
  // level: the product's own setting is in force until the operator moves this.
  const progress = found < 0 || last === 0 ? 0 : (index / last) * 100
  const current = efforts[index]
  return (
    <div className="lab-effort">
      <div className="lab-effort-head">
        <span className="lab-effort-label">{t('effort.label')}</span>
        <span className="lab-effort-value">
          {found < 0 ? t('effort.unset') : effortLabel(t, current ?? '')}
        </span>
      </div>
      <div className="lab-effort-track">
        <input
          type="range"
          className="lab-effort-input"
          min={0}
          max={last}
          step={1}
          value={index}
          // The filled portion has no cross-browser native equivalent, so the
          // track paints it from this custom property.
          style={{ '--lab-effort-progress': `${progress}%` } as CSSProperties}
          aria-label={t('effort.label')}
          aria-valuetext={found < 0 ? t('effort.unset') : effortLabel(t, current ?? '')}
          onChange={(event) => {
            const level = efforts[Number(event.target.value)]
            if (level !== undefined) onSelect(level)
          }}
        />
        {/* Decoration: the stops the thumb can land on. Inset by half a thumb so
            each dot sits under the position that selects it. */}
        <span className="lab-effort-stops" aria-hidden="true">
          {efforts.map(level => <span key={level} className="lab-effort-stop" />)}
        </span>
      </div>
    </div>
  )
}

/**
 * Name a reasoning effort, falling back to the product's own word.
 *
 * The five levels both products share are translated; anything else — Codex ships
 * an `ultra` the Claude SDK does not — is shown verbatim rather than dropped or
 * mislabelled, because the product accepting it is what makes it real.
 * @param t - the panel's translator.
 * @param level - the effort as the product named it.
 * @returns a display label.
 */
function effortLabel(t: PanelTranslate, level: string): string {
  return KNOWN_EFFORTS.includes(level) ? t(`effort.${level}` as LocalAgentBridgeKey) : level
}

/** Effort levels the panel has words for; others are shown as the product spells them. */
const KNOWN_EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max']

/**
 * The account's usage allowances, when the product volunteers them.
 *
 * Absent for most operators, and deliberately so: only a Claude subscription
 * reports this, and Codex refuses the equivalent call without a ChatGPT sign-in.
 * Showing nothing is the honest rendering of "the product did not say" — a zero
 * or a dash would read as a figure.
 *
 * Only the allowance closest to exhaustion is shown, because that is the one that
 * will stop the operator; the rest are in the tooltip.
 */
function RateLimits({ limits, t }: { limits: readonly BridgeRateLimit[]; t: PanelTranslate }) {
  const measured = limits.filter(limit => limit.utilization !== null)
  const tightest = measured.length === 0
    ? limits.find(limit => limit.status !== 'allowed')
    : measured.reduce((worst, limit) => (limit.utilization ?? 0) > (worst.utilization ?? 0) ? limit : worst)
  if (tightest === undefined) return null
  const percent = tightest.utilization === null ? null : Math.round(tightest.utilization * 100)
  const detail = limits
    .map(limit => [
      limit.window ?? t('quota.title'),
      limit.utilization === null ? t(`quota.${limit.status}`) : `${Math.round(limit.utilization * 100)}%`,
      limit.resetsAt === null ? null : t('quota.resets', { when: formatWhen(limit.resetsAt) }),
    ].filter(part => part !== null).join(' '))
    .join('\n')
  return (
    <span
      className={`lab-quota${tightest.status === 'rejected' ? ' lab-quota--out' : tightest.status === 'warning' ? ' lab-quota--warn' : ''}`}
      title={`${t('quota.title')}\n${detail}`}
    >
      <IconDataOutline16 size={14} />
      {percent === null ? t(`quota.${tightest.status}`) : t('quota.used', { percent })}
    </span>
  )
}

/** Where the plus button is looking. */
type AttachSource = 'workspace' | 'local' | 'host'

/**
 * Give the agent a file, from either machine.
 *
 * Two routes, because the browser is not always on the Host. Referencing a file
 * already in the working directory copies nothing and is the common case; sending
 * one from the machine the browser is running on is what a laptop driving a remote
 * Harness needs, and there is no other way for those bytes to arrive.
 *
 * Both produce the same `@path` in the draft, so there is one thing for the
 * operator to learn and one thing for the products to read.
 *
 * The workspace route is deliberately not a Host file dialog. Browsing the Host's
 * whole filesystem from a browser is what this bridge does not do, and a path
 * outside the working directory is not something the agent could read anyway.
 */
function AttachPicker({
  result,
  query,
  busy,
  source,
  uploading,
  rejected,
  hostBrowsing,
  hostListing,
  hostBusy,
  hostHidden,
  t,
  onSource,
  onQuery,
  onPick,
  onUpload,
  onHostNavigate,
  onHostPick,
  onHostHidden,
}: {
  result: BridgeFileSearchResult
  query: string
  busy: boolean
  source: AttachSource
  uploading: boolean
  rejected: number
  hostBrowsing: boolean
  hostListing: BridgeHostListing | undefined
  hostBusy: boolean
  hostHidden: boolean
  t: PanelTranslate
  onSource: (next: AttachSource) => void
  onQuery: (next: string) => void
  onPick: (match: BridgeFileMatch) => void
  onUpload: (files: FileList | null) => void
  onHostNavigate: (path: string) => void
  onHostPick: (path: string, directory: boolean) => void
  onHostHidden: (next: boolean) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const filePick = useRef<HTMLInputElement>(null)
  const folderPick = useRef<HTMLInputElement>(null)
  useEffect(() => { if (source === 'workspace') input.current?.focus() }, [source])
  // `webkitdirectory` is how every browser that offers folder selection spells
  // it, and React's typings do not carry it — so it goes on through the DOM node
  // rather than being cast onto the JSX props.
  //
  // Keyed to the source, not to mount: the input only exists while the upload tab
  // is showing, so a mount-time effect found no node and left the folder button
  // opening a plain file chooser.
  useEffect(() => { folderPick.current?.setAttribute('webkitdirectory', '') }, [source])
  return (
    <div className="lab-attach-menu" role="dialog" aria-label={t('attach.title')}>
      <div className="lab-attach-tabs" role="tablist" aria-label={t('attach.source')}>
        <button
          type="button"
          role="tab"
          aria-selected={source === 'workspace'}
          className={source === 'workspace' ? 'lab-attach-tab lab-attach-tab--on' : 'lab-attach-tab'}
          onClick={() => { onSource('workspace') }}
        >
          {t('attach.fromWorkspace')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={source === 'local'}
          className={source === 'local' ? 'lab-attach-tab lab-attach-tab--on' : 'lab-attach-tab'}
          onClick={() => { onSource('local') }}
        >
          {t('attach.fromBrowser')}
        </button>
        {/* Absent, not disabled, when the Profile does not serve it: a route that
            cannot work should not be offered. */}
        {hostBrowsing && (
          <button
            type="button"
            role="tab"
            aria-selected={source === 'host'}
            className={source === 'host' ? 'lab-attach-tab lab-attach-tab--on' : 'lab-attach-tab'}
            onClick={() => { onSource('host') }}
          >
            {t('attach.fromHost')}
          </button>
        )}
      </div>

      {source === 'workspace' && (
        <>
          <input
            ref={input}
            type="search"
            className="lab-input lab-attach-search"
            value={query}
            placeholder={t('attach.search')}
            onChange={event => { onQuery(event.target.value) }}
          />
          <div className="lab-attach-list">
            {busy && result.matches.length === 0 && <p className="lab-browse-note">{t('browse.loading')}</p>}
            {!busy && result.matches.length === 0 && <p className="lab-browse-note">{t('attach.empty')}</p>}
            {result.matches.map(match => (
              <button
                key={match.path}
                type="button"
                className="lab-attach-row"
                title={match.path}
                onClick={() => { onPick(match) }}
              >
                {match.directory ? <IconFolderClose16 /> : <IconCodeOutline16 />}
                <span className="lab-attach-name">{match.name}{match.directory ? '/' : ''}</span>
                <span className="lab-attach-path">{match.path}</span>
              </button>
            ))}
            {result.partial && <p className="lab-browse-note">{t('files.partial')}</p>}
          </div>
        </>
      )}

      {source === 'local' && (
        <div className="lab-attach-upload">
          <p className="lab-browse-note">{t('attach.uploadHint')}</p>
          <div className="lab-row">
            <ActionButton
              className="lab-grow"
              disabled={uploading}
              onClick={() => { filePick.current?.click() }}
            >
              {t('attach.pickFiles')}
            </ActionButton>
            <ActionButton
              className="lab-grow"
              disabled={uploading}
              onClick={() => { folderPick.current?.click() }}
            >
              {t('attach.pickFolder')}
            </ActionButton>
          </div>
          {uploading && <p className="lab-browse-note">{t('attach.uploading')}</p>}
          {rejected > 0 && <p className="lab-attach-warning">{t('attach.rejected', { count: rejected })}</p>}
          {/* Kept out of the layout rather than out of the tree: a file input has
              to be a real input for the browser to open its chooser at all. */}
          <input
            ref={filePick}
            type="file"
            multiple
            className="lab-offscreen"
            onChange={event => { onUpload(event.target.files); event.target.value = '' }}
          />
          <input
            ref={folderPick}
            type="file"
            multiple
            className="lab-offscreen"
            onChange={event => { onUpload(event.target.files); event.target.value = '' }}
          />
        </div>
      )}

      {source === 'host' && (
        <div className="lab-attach-host">
          <nav className="lab-crumbs" aria-label={t('attach.fromHost')}>
            {(hostListing?.crumbs ?? []).map((crumb, index) => (
              <span key={crumb.path}>
                {index > 0 && <span className="lab-crumb-sep">/</span>}
                <button
                  type="button"
                  className="lab-crumb"
                  title={crumb.path}
                  onClick={() => { onHostNavigate(crumb.path) }}
                >
                  {crumb.path === hostListing?.home ? t('browse.home') : crumb.name}
                </button>
              </span>
            ))}
          </nav>
          <div className="lab-attach-list">
            {hostBusy && <p className="lab-browse-note">{t('browse.loading')}</p>}
            {!hostBusy && (hostListing?.entries ?? []).filter(entry => hostHidden || !entry.hidden).length === 0 && (
              <p className="lab-browse-note">{t('attach.empty')}</p>
            )}
            {(hostListing?.entries ?? [])
              .filter(entry => hostHidden || !entry.hidden)
              .map(entry => (
                <button
                  key={entry.path}
                  type="button"
                  className={entry.hidden ? 'lab-attach-row lab-browse-row--hidden' : 'lab-attach-row'}
                  title={entry.path}
                  // A directory opens; a file is what you came for. Referencing a
                  // directory is the explicit button below, so one click never has
                  // to mean two things.
                  onClick={() => {
                    if (entry.directory) onHostNavigate(entry.path)
                    else onHostPick(entry.path, false)
                  }}
                >
                  {entry.directory ? <IconFolderClose16 /> : <IconCodeOutline16 />}
                  <span className="lab-attach-name">{entry.name}{entry.directory ? '/' : ''}</span>
                </button>
              ))}
            {hostListing?.truncated === true && <p className="lab-browse-note">{t('browse.truncated')}</p>}
          </div>
          <label className="lab-browse-toggle">
            <input
              type="checkbox"
              checked={hostHidden}
              onChange={event => { onHostHidden(event.target.checked) }}
            />
            {t('browse.showHidden')}
          </label>
          {hostListing !== undefined && (
            <ActionButton
              className="lab-grow"
              onClick={() => { onHostPick(hostListing.path, true) }}
            >
              {t('attach.useDirectory')}
            </ActionButton>
          )}
        </div>
      )}
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
 * What the composer is currently completing.
 *
 * Two gestures, both taken from the products' own terminals: `/` picks a command
 * or skill, `@` picks a file from the working directory. They differ in where
 * they may appear, which is what this distinguishes.
 */
interface CompletionTrigger {
  readonly kind: 'command' | 'file'
  readonly query: string
  /** Index in the draft where the trigger character sits. */
  readonly start: number
}

/**
 * Read what the composer is completing, if anything.
 *
 * `/` only counts at the very start of the draft — that is the gesture meaning "I
 * am picking a command", and a slash later in a sentence is a path or a date.
 *
 * `@` counts anywhere a word can begin, because referencing a file is something
 * done mid-sentence: "compare @src/main.ts with @src/old.ts". It is therefore
 * required to follow whitespace or start the draft, so an email address or a
 * decorator does not open a file list.
 *
 * A space after either token ends the completion: the operator has moved on.
 * @param draft - the composer's current contents.
 * @returns what is being completed, or null.
 */
function completionTrigger(draft: string): CompletionTrigger | null {
  if (draft.startsWith('/')) {
    const rest = draft.slice(1)
    return /\s/.test(rest) ? null : { kind: 'command', query: rest, start: 0 }
  }
  // Scan back from the end for the last `@` that begins a word.
  const at = draft.lastIndexOf('@')
  if (at < 0) return null
  const before = at === 0 ? '' : draft[at - 1] ?? ''
  if (before.length > 0 && !/\s/.test(before)) return null
  const rest = draft.slice(at + 1)
  return /\s/.test(rest) ? null : { kind: 'file', query: rest, start: at }
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
 * The composer's completion list, for either gesture.
 *
 * `/` lists what the product itself says it can do; `@` lists files from the
 * session's working directory. Both are rendered here so the arrow keys, Enter and
 * the selection highlight behave identically — the operator learns one interaction,
 * not two.
 *
 * Selecting a command writes the product's own invocation text; the bridge never
 * executes anything on the product's behalf. MCP servers are listed but not
 * selectable: they are inventory, not something the composer can invoke.
 */
function CompletionPalette({
  kind,
  entries,
  servers,
  pending,
  partial,
  activeIndex,
  t,
  onPick,
}: {
  kind: CompletionTrigger['kind']
  entries: readonly BridgeCompletion[]
  servers: readonly BridgeCompletion[]
  pending: boolean
  partial: boolean
  activeIndex: number
  t: PanelTranslate
  onPick: (completion: BridgeCompletion) => void
}) {
  if (kind === 'command' && pending) {
    return <div className="lab-palette"><p className="lab-palette-note">{t('palette.pending')}</p></div>
  }
  if (entries.length === 0 && servers.length === 0) {
    return (
      <div className="lab-palette">
        <p className="lab-palette-note">{kind === 'file' ? t('files.empty') : t('palette.empty')}</p>
      </div>
    )
  }
  return (
    <div className="lab-palette" role="listbox" aria-label={kind === 'file' ? t('files.heading') : t('palette.commands')}>
      {entries.length > 0 && (
        <p className="lab-palette-group">{kind === 'file' ? t('files.heading') : t('palette.commands')}</p>
      )}
      {entries.map((entry, index) => (
        <button
          key={`${kind}:${entry.insertText ?? entry.name}`}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          className="lab-palette-item"
          // The composer keeps focus: the operator is still typing the filter.
          onMouseDown={event => { event.preventDefault() }}
          onClick={() => { onPick(entry) }}
        >
          <span className="lab-palette-name">{kind === 'file' ? entry.name : entry.insertText ?? entry.name}</span>
          {entry.argumentHint !== null && <span className="lab-palette-arg">{entry.argumentHint}</span>}
          {entry.description !== null && (
            <span className={kind === 'file' ? 'lab-palette-path' : 'lab-palette-desc'}>{entry.description}</span>
          )}
        </button>
      ))}
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
      {partial && <p className="lab-palette-note">{t('files.partial')}</p>}
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

export function LocalAgentPanel({ wide, remote, speechLocale, t, workspaces }: LocalAgentPanelProps) {
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [files, setFiles] = useState<BridgeFileSearchResult>({ matches: [], partial: false })
  const [models, setModels] = useState<BridgeModelsResult>({ models: [], unavailable: true })
  const [attachOpen, setAttachOpen] = useState(false)
  const [attachQuery, setAttachQuery] = useState('')
  const [attachBusy, setAttachBusy] = useState(false)
  const [attachFiles, setAttachFiles] = useState<BridgeFileSearchResult>({ matches: [], partial: false })
  const [hostListing, setHostListing] = useState<BridgeHostListing>()
  const [hostBusy, setHostBusy] = useState(false)
  const [hostHidden, setHostHidden] = useState(false)
  const attachRoot = useRef<HTMLSpanElement>(null)
  const [repository, setRepository] = useState<BridgeRepository | null>(null)
  const [attachSource, setAttachSource] = useState<AttachSource>('workspace')
  const [uploading, setUploading] = useState(false)
  const [uploadRejected, setUploadRejected] = useState(0)
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

  /**
   * Read the session's models.
   *
   * Retried when the status settles rather than once per session: Claude Code can
   * only answer off a live query, so the list is unavailable until some turn has
   * run — and the operator should not have to reselect the session to see it
   * appear. Codex answers immediately and simply returns the same list again.
   */
  useEffect(() => {
    if (!open || selectedId === undefined) {
      setModels({ models: [], unavailable: true })
      return
    }
    let cancelled = false
    void remote.sessionModels({ bridgeSessionId: selectedId })
      .then(unwrap)
      .then(next => { if (!cancelled) setModels(next) })
      .catch(() => { if (!cancelled) setModels({ models: [], unavailable: true }) })
    return () => { cancelled = true }
  }, [open, remote, selectedId, sessionStatus])

  /**
   * Search for the plus button, kept separate from the `@` trigger.
   *
   * Two states rather than one, because the two gestures are independent: the
   * button opens with an empty query while the draft may already contain an `@`
   * halfway through a different word, and sharing one result set would make each
   * overwrite the other's list.
   */
  useEffect(() => {
    if (!attachOpen || attachSource !== 'workspace' || selectedId === undefined) return
    let cancelled = false
    setAttachBusy(true)
    const timer = setTimeout(() => {
      void remote.sessionFiles({ bridgeSessionId: selectedId, query: attachQuery })
        .then(unwrap)
        .then(next => { if (!cancelled) setAttachFiles(next) })
        .catch(() => { if (!cancelled) setAttachFiles({ matches: [], partial: false }) })
        .finally(() => { if (!cancelled) setAttachBusy(false) })
    }, 120)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [attachOpen, attachQuery, attachSource, remote, selectedId])

  // Read the first level when the host tab opens, and not before: this is the
  // widest read the panel makes, and it should not happen for an operator who never
  // asks for it.
  useEffect(() => {
    if (!attachOpen || attachSource !== 'host' || hostListing !== undefined) return
    void browseHost()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- browseHost is recreated
  // every render; the effect is keyed to the tab opening, not to its identity.
  }, [attachOpen, attachSource, hostListing])

  // The picker belongs to the session it searched, so switching sessions closes
  // it rather than leaving another directory's files on screen.
  useEffect(() => {
    setAttachOpen(false)
    setAttachQuery('')
    setAttachFiles({ matches: [], partial: false })
    setAttachSource('workspace')
    setUploadRejected(0)
  }, [selectedId])

  /**
   * Poll the working directory's repository state.
   *
   * On a timer rather than with the transcript, because it changes for reasons the
   * bridge never sees — a commit made in a terminal, a branch switched by hand —
   * and folding it into the long-poll would tie a filesystem read to a request
   * that deliberately waits. The Host caches briefly, so the interval costs little.
   */
  useEffect(() => {
    if (!open || selectedId === undefined) {
      setRepository(null)
      return
    }
    let cancelled = false
    const read = (): void => {
      void remote.sessionRepository({ bridgeSessionId: selectedId })
        .then(unwrap)
        .then(next => { if (!cancelled) setRepository(next) })
        .catch(() => { if (!cancelled) setRepository(null) })
    }
    read()
    const timer = setInterval(read, REPOSITORY_POLL_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [open, remote, selectedId])

  const draftTrigger = completionTrigger(draft)

  /**
   * Fetch file matches while `@` is being typed.
   *
   * Debounced because every keystroke would otherwise walk the working directory
   * again, and the walk is deliberate work on the Host. The timer is cleared on
   * each change, so only the pause after typing costs anything.
   */
  const fileQuery = draftTrigger?.kind === 'file' ? draftTrigger.query : null
  useEffect(() => {
    if (fileQuery === null || selectedId === undefined) {
      setFiles({ matches: [], partial: false })
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void remote.sessionFiles({ bridgeSessionId: selectedId, query: fileQuery })
        .then(unwrap)
        .then(next => { if (!cancelled) setFiles(next) })
        .catch(() => { if (!cancelled) setFiles({ matches: [], partial: false }) })
    }, 120)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [fileQuery, remote, selectedId])

  const rows = useMemo(() => timeline(snapshot?.events ?? [], t), [snapshot?.events, t])
  /**
   * Whether the newest row may still grow. Drives the typewriter reveal, which must
   * not animate a finished answer or a row restored from a transcript.
   */
  const streamingRow = snapshot !== undefined && BUSY_STATUSES.includes(snapshot.session.status)

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
  const paletteOpen = draftTrigger !== null && selectedId !== undefined
  /**
   * The selectable entries behind whichever trigger is active, in one list so the
   * arrow keys and Enter do not need to know which gesture opened it. A file's
   * insertion text is its workspace-relative path prefixed with `@`, which is how
   * both products read a file reference in a prompt.
   */
  const paletteMatches = useMemo<BridgeCompletion[]>(() => {
    if (draftTrigger === null) return []
    if (draftTrigger.kind === 'command') {
      return rankCompletions(completions.completions, draftTrigger.query).filter(entry => entry.insertText !== null)
    }
    return files.matches.map(match => ({
      kind: 'command' as const,
      name: match.name,
      insertText: `@${match.path}`,
      description: match.path,
      argumentHint: null,
      status: null,
    }))
  }, [completions.completions, draftTrigger, files.matches])

  /** MCP servers, shown as inventory beneath the commands. */
  const paletteServers = useMemo(
    () => draftTrigger?.kind === 'command'
      ? rankCompletions(completions.completions, draftTrigger.query).filter(entry => entry.kind === 'mcp')
      : [],
    [completions.completions, draftTrigger],
  )
  const allProviders = catalog?.providers ?? []
  // Every product the Host could not offer, with the reason it could not. The
  // Host already computed an exact diagnosis; dropping these rows from the UI
  // left the operator watching a product vanish with no explanation.
  const blockedProviders = allProviders.filter(provider => provider.health !== 'ready')
  const allWorkspaces = catalog?.workspaces ?? []
  const sessionProvider = snapshot === undefined
    ? undefined
    : allProviders.find(provider => provider.id === snapshot.session.providerId)
  const sessionModes = sessionProvider?.permissionModes ?? []
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
    if (completion.insertText === null || draftTrigger === null) return
    // Replaces only the token being completed, so a file picked mid-sentence
    // leaves the rest of the draft alone — "compare @src/main.ts with @…".
    const head = draft.slice(0, draftTrigger.start)
    // A trailing space when more is expected: an argument for a command, another
    // word after a file reference.
    const tail = draftTrigger.kind === 'file' || completion.argumentHint !== null ? ' ' : ''
    setDraft(`${head}${completion.insertText}${tail}`)
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
   * Change the selected session's permission mode.
   *
   * Applied by the Host from the next turn, so the session view is replaced with
   * what the Host confirms rather than an optimistic guess.
   * @param mode - the requested mode.
   */
  /**
   * Choose the model and effort for the session's next turn.
   * @param model - the model id, or null to hand the choice back to the product.
   * @param effort - the reasoning effort, or null for the product's own default.
   */
  const changeModel = async (model: string | null, effort: string | null): Promise<void> => {
    if (selectedId === undefined) return
    setError(undefined)
    try {
      const updated = unwrap(await remote.sessionModel({ bridgeSessionId: selectedId, model, effort }))
      setSessions(current => current.map(item =>
        item.bridgeSessionId === updated.bridgeSessionId ? updated : item))
      setSnapshot(current => current === undefined ? current : { ...current, session: updated })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  /**
   * Put a chosen file or folder into the draft as an `@` reference.
   *
   * Appended rather than inserted at the caret: the plus button is a deliberate
   * gesture away from the text, and there is no reliable caret to return to once
   * focus has moved to a popover. A folder keeps its trailing slash, which is how
   * both products tell one from a file.
   * @param match - the entry the operator picked.
   */
  const insertReference = (match: BridgeFileMatch): void => {
    const reference = `@${match.path}${match.directory ? '/' : ''}`
    setDraft(current => current.length === 0 || current.endsWith(' ')
      ? `${current}${reference} `
      : `${current} ${reference} `)
    setAttachOpen(false)
    setAttachQuery('')
  }

  /**
   * Send files the operator picked in their browser to the Host, and reference
   * them in the draft.
   *
   * Read as data URLs rather than assembled by hand: `btoa` over a large array
   * overflows the argument stack, and the platform already has an encoder that
   * does not. A file the browser cannot read is skipped rather than failing the
   * batch, since one unreadable file among twenty should not lose the other
   * nineteen.
   * @param picked - what the browser's chooser returned.
   */
  const uploadFiles = async (picked: FileList | null): Promise<void> => {
    if (picked === null || picked.length === 0 || selectedId === undefined) return
    setError(undefined)
    setUploadRejected(0)
    setUploading(true)
    try {
      const files: { path: string; contentBase64: string }[] = []
      for (const file of picked) {
        if (file.size > UPLOAD_FILE_LIMIT) continue
        const encoded = await new Promise<string | null>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => {
            const value = typeof reader.result === 'string' ? reader.result : ''
            // A data URL is `data:<type>;base64,<payload>`; only the payload
            // crosses, and the type is the Host's business to infer if it cares.
            const comma = value.indexOf(',')
            resolve(comma < 0 ? null : value.slice(comma + 1))
          }
          reader.onerror = () => { resolve(null) }
          reader.readAsDataURL(file)
        })
        if (encoded === null) continue
        // A folder upload reports the path within the chosen folder; a plain file
        // upload reports only a name. The Host rebuilds either one.
        const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath
        files.push({
          path: relative !== undefined && relative.length > 0 ? relative : file.name,
          contentBase64: encoded,
        })
      }
      if (files.length === 0) {
        setUploadRejected(picked.length)
        return
      }
      const result = unwrap(await remote.sessionUpload({ bridgeSessionId: selectedId, files }))
      setUploadRejected(result.rejected + (picked.length - files.length))
      if (result.paths.length > 0) {
        const references = result.paths.map(path => `@${path}`).join(' ')
        setDraft(current => current.length === 0 || current.endsWith(' ')
          ? `${current}${references} `
          : `${current} ${references} `)
        setAttachOpen(false)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setUploading(false)
    }
  }

  /**
   * Read one level of the Host filesystem for the composer's host browser.
   *
   * The panel's widest read, so it happens only while that tab is open and only
   * when the Profile serves it. Failure leaves the previous level on screen rather
   * than emptying it, because a directory that cannot be read says nothing about the
   * one already shown.
   * @param path - absolute directory; omitted starts at the Host home directory.
   */
  const browseHost = async (path?: string): Promise<void> => {
    setHostBusy(true)
    setError(undefined)
    try {
      setHostListing(unwrap(await remote.hostList(path === undefined ? {} : { path })))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setHostBusy(false)
    }
  }

  /**
   * Reference a Host path the operator picked outside the working directory.
   *
   * Absolute, because that is what it is — there is no working directory to be
   * relative to. Both products read an absolute path, subject to the session's
   * permission mode, so the agent still asks before touching it unless the operator
   * has said otherwise.
   * @param path - absolute Host path.
   * @param directory - whether to mark it as a directory with a trailing slash.
   */
  const referenceHostPath = (path: string, directory: boolean): void => {
    const reference = `@${path}${directory && !path.endsWith('/') ? '/' : ''}`
    setDraft(current => current.length === 0 || current.endsWith(' ')
      ? `${current}${reference} `
      : `${current} ${reference} `)
    setAttachOpen(false)
  }

  /**
   * Add a transcript to the draft.
   *
   * Appended with a space rather than replacing, so dictation can extend a typed
   * sentence and several utterances accumulate the way they would in a notes app.
   * @param text - what the browser heard.
   */
  const appendDictation = (text: string): void => {
    setDraft(current => current.trim().length === 0 ? text : `${current.trimEnd()} ${text}`)
  }

  const dictation = useDictation(speechLocale, appendDictation)
  // The file popover's open state lives here rather than inside the picker,
  // because the plus button that opens it sits outside the picker's own markup.
  useDismissOnOutsidePointer(attachRoot, attachOpen, setAttachOpen)

  const changePermissionMode = async (mode: BridgePermissionMode): Promise<void> => {
    if (selectedId === undefined) return
    setError(undefined)
    try {
      const updated = unwrap(await remote.sessionPermissionMode({ bridgeSessionId: selectedId, mode }))
      setSessions(current => current.map(item =>
        item.bridgeSessionId === updated.bridgeSessionId ? updated : item))
      setSnapshot(current => current === undefined ? current : { ...current, session: updated })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
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
              {/* The sidebar toggle sits on the same side as the sidebar it
                  controls. It used to live with refresh and close on the right,
                  which read as "collapse something over here". */}
              <div className="lab-titlebar-lead">
                <ActionButton
                  icon
                  aria-label={sidebarCollapsed ? t('panel.expandSidebar') : t('panel.collapseSidebar')}
                  title={sidebarCollapsed ? t('panel.expandSidebar') : t('panel.collapseSidebar')}
                  aria-expanded={!sidebarCollapsed}
                  onClick={() => { setSidebarCollapsed(current => !current) }}
                >
                  <IconPanelLeftOutline16 />
                </ActionButton>
                <div>
                  <h2 className="lab-title">{t('panel.name')}</h2>
                  <p className="lab-subtitle">{t('panel.subtitle')}</p>
                </div>
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

            <div className={sidebarCollapsed ? 'lab-body lab-body--collapsed' : 'lab-body'}>
              <aside className="lab-aside">
                {/* Shown only when collapsed. Sessions rather than a second
                    expand button: the toggle already lives in the titlebar, and a
                    rail whose only control reopened the thing it sits in was a
                    dead end. Switching sessions is what the sidebar is for, so
                    that is what survives at 52px. */}
                <div className="lab-rail" role="tablist" aria-label={t('sessions.heading')}>
                  {sessions.map(session => (
                    <button
                      key={session.bridgeSessionId}
                      type="button"
                      role="tab"
                      aria-selected={selectedId === session.bridgeSessionId}
                      className={selectedId === session.bridgeSessionId ? 'lab-rail-session lab-rail-session--on' : 'lab-rail-session'}
                      title={`${session.title} · ${session.workspaceTitle} · ${t(`status.${session.status}`)}`}
                      onClick={() => { setSelectedId(session.bridgeSessionId) }}
                    >
                      {session.providerId === 'claude' ? <IconSparkle16 size={14} /> : <IconCodeOutline16 />}
                      {/* A busy session is the one thing worth seeing without
                          expanding, so it gets a dot rather than a word. */}
                      {BUSY_STATUSES.includes(session.status) && <span className="lab-rail-busy" />}
                    </button>
                  ))}
                </div>
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
                    {rows.map((row, index) => (
                      <TimelineEntry
                        key={row.key}
                        row={row}
                        // Only the row still being written: the last one, while the
                        // session has a turn in flight, and only for text the model
                        // is producing.
                        streaming={
                          streamingRow
                          && index === rows.length - 1
                          && (row.kind === 'assistant' || row.kind === 'reasoning')
                        }
                        t={t}
                      />
                    ))}
                  </div>
                </div>

                <form className="lab-composer" onSubmit={send}>
                  {paletteOpen && draftTrigger !== null && (
                    <CompletionPalette
                      kind={draftTrigger.kind}
                      entries={paletteMatches}
                      servers={paletteServers}
                      pending={completions.pending}
                      partial={draftTrigger.kind === 'file' && files.partial}
                      activeIndex={paletteIndex}
                      t={t}
                      onPick={pickCompletion}
                    />
                  )}
                  {/* Above the box: where the agent is working, and how much of
                      its context is gone — the two facts that frame everything
                      typed below them. */}
                  <div className="lab-composer-head">
                    <span className="lab-composer-where">
                      {snapshot !== undefined && (
                        <span className="lab-cwd" title={t('cwd.label')}>
                          <IconFolderOpenOutline16 size={14} />
                          <span className="lab-cwd-name">{snapshot.session.workspaceTitle}</span>
                        </span>
                      )}
                      {repository !== null && <Repository repository={repository} t={t} />}
                    </span>
                    <span className="lab-composer-cost">
                      {snapshot?.session.tokenUsage !== null && snapshot !== undefined && (
                        <TokenSpend usage={snapshot.session.tokenUsage} t={t} />
                      )}
                      {snapshot?.session.contextUsage !== null && snapshot !== undefined && (
                        <ContextUsage usage={snapshot.session.contextUsage} t={t} />
                      )}
                    </span>
                  </div>
                  <textarea
                    className="lab-textarea"
                    value={draft}
                    placeholder={t('composer.placeholder')}
                    disabled={selectedId === undefined}
                    onChange={event => { setDraft(event.target.value); setPaletteIndex(0); setHistoryIndex(-1) }}
                    onKeyDown={onComposerKeyDown}
                  />
                  {/* Below the box, split the way the products' own composers do:
                      what the agent is allowed to do and what it is being given on
                      the left, what it costs and what answers on the right. */}
                  <div className="lab-composer-foot">
                    <div className="lab-composer-tools">
                      {snapshot !== undefined && (
                        <PermissionModePicker
                          modes={sessionModes}
                          current={snapshot.session.permissionMode}
                          disabled={BUSY_STATUSES.includes(snapshot.session.status)}
                          t={t}
                          onSelect={mode => { void changePermissionMode(mode) }}
                        />
                      )}
                      <span
                        className="lab-attach"
                        ref={attachRoot}
                        onKeyDown={event => { if (event.key === 'Escape') setAttachOpen(false) }}
                      >
                        <button
                          type="button"
                          className="lab-icon-button"
                          aria-haspopup="dialog"
                          aria-expanded={attachOpen}
                          aria-label={t('attach.open')}
                          title={t('attach.open')}
                          disabled={selectedId === undefined}
                          onClick={() => { setAttachOpen(current => !current) }}
                        >
                          <IconPlusOutline16 size={14} />
                        </button>
                        {attachOpen && (
                          <AttachPicker
                            result={attachFiles}
                            query={attachQuery}
                            busy={attachBusy}
                            source={attachSource}
                            uploading={uploading}
                            rejected={uploadRejected}
                            hostBrowsing={catalog?.hostBrowsing === true}
                            hostListing={hostListing}
                            hostBusy={hostBusy}
                            hostHidden={hostHidden}
                            t={t}
                            onSource={setAttachSource}
                            onQuery={setAttachQuery}
                            onPick={insertReference}
                            onUpload={files => { void uploadFiles(files) }}
                            onHostNavigate={path => { void browseHost(path) }}
                            onHostPick={referenceHostPath}
                            onHostHidden={setHostHidden}
                          />
                        )}
                      </span>
                      {/* Only where the browser has the API. A dead button would
                          teach nothing, and the note says where the audio goes. */}
                      {dictation.supported && (
                        <button
                          type="button"
                          className={dictation.listening ? 'lab-icon-button lab-icon-button--live' : 'lab-icon-button'}
                          aria-pressed={dictation.listening}
                          aria-label={dictation.listening ? t('dictate.stop') : t('dictate.start')}
                          title={`${dictation.listening ? t('dictate.stop') : t('dictate.start')} — ${t('dictate.note')}`}
                          disabled={selectedId === undefined}
                          onClick={dictation.toggle}
                        >
                          <MicIcon />
                        </button>
                      )}
                    </div>
                    <div className="lab-composer-tools">
                      {snapshot !== undefined && <RateLimits limits={snapshot.session.rateLimits} t={t} />}
                      {snapshot !== undefined && (
                        <ModelPicker
                          result={models}
                          supported={sessionProvider?.selectableModels === true}
                          model={snapshot.session.model}
                          effort={snapshot.session.effort}
                          disabled={BUSY_STATUSES.includes(snapshot.session.status)}
                          t={t}
                          onSelect={(model, effort) => { void changeModel(model, effort) }}
                        />
                      )}
                      <ActionButton primary type="submit" disabled={selectedId === undefined || draft.trim().length === 0}>
                        <IconSendOutline16 /> {t('composer.send')}
                      </ActionButton>
                    </div>
                  </div>
                  <small className="lab-composer-hint">
                    {t('composer.keys')}
                    {completions.completions.length > 0 && ` · ${t('palette.hint')}`}
                  </small>
                  <small className="lab-composer-hint lab-composer-hint--second">{t('composer.hint')}</small>
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
        // Mapped to a region the speech engines actually accept: a bare `zh`
        // is not a recognition language, and `zh-CN` is what the panel's
        // Simplified Chinese copy corresponds to.
        speechLocale: () => scope.locale.getLocale().active === 'zh' ? 'zh-CN' : 'en-US',
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
