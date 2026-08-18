import { useEffect, useMemo, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, FormEvent, ReactNode } from 'react'
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
  BridgeErrorCode,
  BridgeEvent,
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
   * Open whichever directory chooser the active Profile composed, or return
   * null when the operator cancelled. Absent when the Profile composed no
   * picker at all, in which case the panel offers only the path field.
   */
  pick?: () => Promise<string | null>
}

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

  const rows = useMemo(() => timeline(snapshot?.events ?? [], t), [snapshot?.events, t])
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
      await workspaces.create(target)
      // The bridge reads the registry through its own catalog, so the new
      // Workspace only exists for this panel once the catalog is re-read.
      const nextCatalog = unwrap(await remote.catalog())
      setCatalog(nextCatalog)
      const added = nextCatalog.workspaces.find(workspace => workspace.title === target.split(/[\\/]/).filter(Boolean).at(-1))
        ?? nextCatalog.workspaces.at(-1)
      if (added !== undefined && added.status === 'ok') setWorkspaceId(added.id)
      setWorkspacePath('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setAddingWorkspace(false)
    }
  }

  /** Open the Profile's directory chooser, then register whatever it returned. */
  const browseWorkspace = async (): Promise<void> => {
    if (workspaces.pick === undefined) return
    setError(undefined)
    try {
      const picked = await workspaces.pick()
      if (picked !== null) await addWorkspace(picked)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const createSession = async (): Promise<void> => {
    if (providerId === undefined || workspaceId === undefined) return
    setBusy(true)
    try {
      const created = unwrap(await remote.sessionCreate({ providerId: providerId as NativeProviderView['id'], workspaceId }))
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

  const send = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (selectedId === undefined || draft.trim().length === 0) return
    const text = draft
    setDraft('')
    try {
      unwrap(await remote.sessionSend({ bridgeSessionId: selectedId, text }))
    } catch (cause) {
      setDraft(text)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
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
                      {workspaces.pick !== undefined && (
                        <ActionButton disabled={addingWorkspace} onClick={() => { void browseWorkspace() }}>
                          {t('workspace.browse')}
                        </ActionButton>
                      )}
                    </div>
                  </form>
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

                <div className="lab-timeline">
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
                  <div className="lab-composer-row">
                    <textarea
                      className="lab-textarea"
                      value={draft}
                      placeholder={t('composer.placeholder')}
                      disabled={selectedId === undefined}
                      onChange={event => { setDraft(event.target.value) }}
                    />
                    <ActionButton primary type="submit" disabled={selectedId === undefined || draft.trim().length === 0}>
                      <IconSendOutline16 /> {t('composer.send')}
                    </ActionButton>
                  </div>
                  <small className="lab-composer-hint">{t('composer.hint')}</small>
                </form>
              </main>
            </div>
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
          // Only offered when the composed Profile actually has a chooser: the
          // auto backend resolves to a Host-native dialog nobody can operate
          // from a remote browser, and a Profile may compose none at all. The
          // path field alone always works, so the button is the extra.
          ...typeof scope.workspaces.pickDirectory === 'function'
            ? { pick: () => scope.workspaces.pickDirectory() }
            : {},
        },
      }),
    }, LocalAgentPanel))
  })
}
