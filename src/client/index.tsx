import { useEffect, useMemo, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, CSSProperties, FormEvent, ReactNode } from 'react'
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
  BridgeSessionView,
  NativeProviderView,
  PendingInteractionView,
} from '../types.ts'
import { en, type LocalAgentBridgeKey, zh } from './locales.ts'

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

const palette = {
  bg: '#0b0d12',
  panel: '#11151d',
  raised: '#171c26',
  border: '#2a3140',
  text: '#eef2f8',
  muted: '#9aa6b7',
  accent: '#67d5b5',
  danger: '#ff7b86',
  warning: '#f1c56b',
} as const

const styles: Record<string, CSSProperties> = {
  trigger: {
    appearance: 'none', border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 8, minWidth: 36, minHeight: 36, padding: '6px 8px',
    borderRadius: 8, font: 'inherit',
  },
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(3, 5, 9, .76)',
    backdropFilter: 'blur(12px)', display: 'grid', placeItems: 'center', padding: 18,
  },
  shell: {
    width: 'min(1440px, 100%)', height: 'min(900px, 100%)', border: `1px solid ${palette.border}`,
    borderRadius: 8, overflow: 'hidden', background: palette.bg, color: palette.text,
    boxShadow: '0 28px 90px rgba(0,0,0,.55)', display: 'grid', gridTemplateRows: '64px 1fr',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
    padding: '0 20px', borderBottom: `1px solid ${palette.border}`, background: palette.panel,
  },
  body: { minHeight: 0, display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr)' },
  sidebar: {
    minHeight: 0, overflow: 'auto', padding: 14, borderRight: `1px solid ${palette.border}`,
    background: palette.panel,
  },
  main: { minWidth: 0, minHeight: 0, display: 'grid', gridTemplateRows: 'auto 1fr auto', background: palette.bg },
  toolbar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    padding: '12px 16px', borderBottom: `1px solid ${palette.border}`,
  },
  timeline: { minHeight: 0, overflow: 'auto', padding: '18px clamp(14px, 3vw, 36px)' },
  composer: { padding: 14, borderTop: `1px solid ${palette.border}`, background: palette.panel },
  card: { border: `1px solid ${palette.border}`, background: palette.raised, borderRadius: 8, padding: 12 },
  button: {
    appearance: 'none', border: `1px solid ${palette.border}`, background: palette.raised, color: palette.text,
    borderRadius: 8, padding: '8px 12px', cursor: 'pointer', font: 'inherit', display: 'inline-flex',
    alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  primary: { background: palette.accent, color: '#06261d', borderColor: palette.accent, fontWeight: 700 },
  danger: { color: palette.danger, borderColor: '#68343b' },
  input: {
    width: '100%', boxSizing: 'border-box', border: `1px solid ${palette.border}`, background: '#0d1118',
    color: palette.text, borderRadius: 8, padding: '9px 10px', font: 'inherit', outline: 'none',
  },
  label: { display: 'grid', gap: 6, color: palette.muted, fontSize: 12 },
  session: {
    width: '100%', textAlign: 'left', border: `1px solid ${palette.border}`, background: '#10141c', color: palette.text,
    borderRadius: 8, padding: 10, cursor: 'pointer', marginBottom: 8,
  },
  selected: { borderColor: palette.accent, boxShadow: '0 0 0 1px rgba(103,213,181,.3)' },
  row: { maxWidth: 920, margin: '0 auto 12px', borderRadius: 8, padding: '11px 13px', whiteSpace: 'pre-wrap' },
  muted: { color: palette.muted },
  badge: { display: 'inline-flex', borderRadius: 999, padding: '3px 8px', fontSize: 11, background: '#222a38' },
}

const responsiveStyles = `
@media (max-width: 720px) {
  .local-agent-overlay { padding: 8px !important; }
  .local-agent-shell {
    height: 100% !important;
    border-radius: 6px !important;
    grid-template-rows: 56px minmax(0, 1fr) !important;
  }
  .local-agent-header { padding: 0 12px !important; }
  .local-agent-body {
    grid-template-columns: minmax(0, 1fr) !important;
    grid-template-rows: minmax(210px, 42%) minmax(0, 1fr) !important;
  }
  .local-agent-sidebar {
    border-right: 0 !important;
    border-bottom: 1px solid ${palette.border} !important;
    padding: 10px !important;
  }
  .local-agent-toolbar {
    align-items: flex-start !important;
    flex-wrap: wrap !important;
    padding: 10px 12px !important;
  }
  .local-agent-timeline { padding: 12px !important; }
  .local-agent-composer { padding: 10px !important; }
}

@media (max-width: 480px) {
  .local-agent-body {
    grid-template-rows: minmax(240px, 46%) minmax(0, 1fr) !important;
  }
  .local-agent-composer-row { grid-template-columns: minmax(0, 1fr) !important; }
  .local-agent-composer-row > button { width: 100%; }
}
`

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
      rows.push({ key, kind: 'error', title: t(`status.failed`), text: errorText(t, event.data.code, event.data.message) })
    } else if (event.type === 'bridge/session-status') {
      rows.push({
        key,
        kind: 'status',
        title: t(`status.${event.data.status}`),
        // A note is present only when it adds something the status word does
        // not already say; an error-driven transition leaves it null because
        // the bridge/error row above already named the cause.
        text: event.data.note === null ? '' : t(`note.${event.data.note}`),
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

function ActionButton({ children, primary, danger, ...props }: {
  children: ReactNode
  primary?: boolean
  danger?: boolean
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      style={{ ...styles.button, ...(primary ? styles.primary : {}), ...(danger ? styles.danger : {}) }}
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
    <fieldset style={{ ...styles.card, margin: '0 0 10px' }}>
      <legend style={{ padding: '0 6px', fontWeight: 700 }}>{question.header}</legend>
      <p style={{ margin: '4px 0 10px', color: palette.muted }}>{question.prompt}</p>
      <div style={{ display: 'grid', gap: 7 }}>
        {question.options.map(option => (
          <label key={option.value} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
            <input
              type={question.multiSelect ? 'checkbox' : 'radio'}
              name={question.id}
              checked={value.includes(option.value)}
              onChange={() => { toggle(option.value) }}
            />
            <span>
              <span>{option.label}</span>
              {option.description !== null && <small style={{ display: 'block', color: palette.muted }}>{option.description}</small>}
            </span>
          </label>
        ))}
        {question.allowFreeText && (
          <input
            style={styles.input}
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
    <div style={{ ...styles.card, marginBottom: 12, borderColor: palette.warning }}>
      <div style={{ color: palette.warning, fontWeight: 800, marginBottom: 6 }}>
        {interaction.kind === 'approval' ? t('interaction.approval') : t('interaction.question')}
      </div>
      <div>{interaction.safeSummary}</div>
      {interaction.target !== null && <small style={styles.muted}>{interaction.target}</small>}
      {interaction.kind === 'question' && (
        <div style={{ marginTop: 12 }}>
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
      {error !== undefined && <div style={{ color: palette.danger, marginTop: 8 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
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
      <style>{responsiveStyles}</style>
      <button type="button" style={styles.trigger} title={t('panel.name')} onClick={() => { setOpen(true) }}>
        <IconCodeOutline16 />{wide && <span>{t('panel.name')}</span>}
      </button>
      {open && (
        <div className="local-agent-overlay" style={styles.overlay} role="dialog" aria-modal="true" aria-label={t('panel.name')}>
          <section className="local-agent-shell" style={styles.shell}>
            <header className="local-agent-header" style={styles.header}>
              <div>
                <strong style={{ fontSize: 18 }}>{t('panel.name')}</strong>
                <div style={{ ...styles.muted, fontSize: 12 }}>{t('panel.subtitle')}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <ActionButton aria-label={t('panel.refresh')} title={t('panel.refresh')} onClick={() => { void refresh() }}><IconRefreshOutline16 /></ActionButton>
                <ActionButton aria-label={t('panel.close')} title={t('panel.close')} onClick={() => { setOpen(false) }}><IconCloseOutline16 /></ActionButton>
              </div>
            </header>
            <div className="local-agent-body" style={styles.body}>
              <aside className="local-agent-sidebar" style={styles.sidebar}>
                <div style={{ ...styles.card, marginBottom: 14 }}>
                  <strong>{t('create.heading')}</strong>
                  <div style={{ display: 'grid', gap: 9, marginTop: 10 }}>
                    <label style={styles.label}>{t('create.provider')}
                      <select style={styles.input} value={providerId ?? ''} onChange={event => { setProviderId(event.target.value) }}>
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
                    <label style={styles.label}>{t('create.workspace')}
                      <select style={styles.input} value={workspaceId ?? ''} onChange={event => { setWorkspaceId(event.target.value) }}>
                        <option value="" disabled>{t('create.workspace.placeholder')}</option>
                        {allWorkspaces.map(workspace => (
                          <option key={workspace.id} value={workspace.id} disabled={workspace.status !== 'ok'}>
                            {workspace.status === 'ok' ? workspace.title : `${workspace.title} — ${t('workspace.missingDir')}`}
                          </option>
                        ))}
                      </select>
                    </label>
                    <ActionButton primary disabled={busy || providerId === undefined || workspaceId === undefined} onClick={() => { void createSession() }}>
                      {busy ? t('create.busy') : t('create.submit')}
                    </ActionButton>
                  </div>
                </div>

                <div style={{ ...styles.card, marginBottom: 14 }}>
                  <strong>{t('workspace.add')}</strong>
                  <small style={{ ...styles.muted, display: 'block', margin: '5px 0 9px' }}>
                    {readyWorkspaces.length === 0 ? t('workspace.empty') : t('workspace.add.hint')}
                  </small>
                  <form
                    style={{ display: 'grid', gap: 8 }}
                    onSubmit={event => { event.preventDefault(); void addWorkspace(workspacePath) }}
                  >
                    <input
                      style={styles.input}
                      value={workspacePath}
                      placeholder={t('workspace.path.placeholder')}
                      aria-label={t('workspace.path.placeholder')}
                      disabled={addingWorkspace}
                      onChange={event => { setWorkspacePath(event.target.value) }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="submit"
                        style={{ ...styles.button, ...styles.primary, flex: 1 }}
                        disabled={addingWorkspace || workspacePath.trim().length === 0}
                      >
                        {addingWorkspace ? t('workspace.add.busy') : t('workspace.add.submit')}
                      </button>
                      {workspaces.pick !== undefined && (
                        <ActionButton disabled={addingWorkspace} onClick={() => { void browseWorkspace() }}>
                          {t('workspace.browse')}
                        </ActionButton>
                      )}
                    </div>
                  </form>
                </div>

                {blockedProviders.length > 0 && (
                  <div style={{ ...styles.card, marginBottom: 14, borderColor: palette.warning }}>
                    <strong style={{ color: palette.warning }}>{t('diagnostics.heading')}</strong>
                    <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                      {blockedProviders.map(provider => (
                        <div key={provider.id}>
                          <div style={{ fontSize: 12 }}>
                            {provider.displayName} <span style={styles.badge}>{t(`health.${provider.health}`)}</span>
                          </div>
                          <small style={{ ...styles.muted, display: 'block', marginTop: 3 }}>{healthDetail(t, provider)}</small>
                          {provider.health === 'not-installed' && (
                            <small style={{ ...styles.muted, display: 'block', marginTop: 3, opacity: .8 }}>
                              {t('diagnostics.path.hint', { command: provider.id })}
                            </small>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ fontSize: 12, color: palette.muted, margin: '0 2px 8px', textTransform: 'uppercase', letterSpacing: '.06em' }}>{t('sessions.heading')}</div>
                {sessions.map(session => (
                  <button
                    key={session.bridgeSessionId}
                    type="button"
                    style={{ ...styles.session, ...(selectedId === session.bridgeSessionId ? styles.selected : {}) }}
                    onClick={() => { setSelectedId(session.bridgeSessionId) }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <strong>{session.title}</strong><span style={styles.badge}>{t(`status.${session.status}`)}</span>
                    </div>
                    <small style={styles.muted}>{session.workspaceTitle} - {session.providerId}</small>
                  </button>
                ))}
              </aside>
              <main className="local-agent-main" style={styles.main}>
                <div className="local-agent-toolbar" style={styles.toolbar}>
                  <div>
                    <strong>{snapshot?.session.title ?? t('sessions.empty')}</strong>
                    {snapshot !== undefined && <div style={{ ...styles.muted, fontSize: 12 }}>{snapshot.session.workspaceTitle} · {t(`status.${snapshot.session.status}`)}</div>}
                  </div>
                  {snapshot !== undefined && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <ActionButton danger disabled={!['running', 'awaiting-approval', 'awaiting-answer', 'cancelling'].includes(snapshot.session.status)} onClick={() => {
                        void remote.sessionCancel({ bridgeSessionId: snapshot.session.bridgeSessionId })
                      }}><IconStopFill16 /> {t('session.cancel')}</ActionButton>
                      <ActionButton onClick={() => {
                        void remote.sessionArchive({ bridgeSessionId: snapshot.session.bridgeSessionId, archived: true })
                          .then(unwrap).then(() => {
                            setSessions(current => current.filter(item => item.bridgeSessionId !== snapshot.session.bridgeSessionId))
                            setSelectedId(undefined)
                          })
                      }}><IconArchiveOutline20 size={16} /> {t('session.archive')}</ActionButton>
                    </div>
                  )}
                </div>
                <div className="local-agent-timeline" style={styles.timeline}>
                  {error !== undefined && <div style={{ ...styles.card, color: palette.danger, marginBottom: 12 }}>{error}</div>}
                  {snapshot?.pendingInteraction !== null && snapshot?.pendingInteraction !== undefined && (
                    <InteractionCard interaction={snapshot.pendingInteraction} remote={remote} onResolved={() => { setError(undefined) }} t={t} />
                  )}
                  {rows.map(row => (
                    <article
                      key={row.key}
                      style={{
                        ...styles.row,
                        background: row.kind === 'user' ? '#173028' : row.kind === 'error' ? '#35191e' : row.kind === 'reasoning' ? '#161a22' : palette.raised,
                        border: `1px solid ${row.kind === 'error' ? '#6d3038' : palette.border}`,
                        color: row.kind === 'reasoning' || row.kind === 'status' ? palette.muted : palette.text,
                      }}
                    >
                      <small style={{ display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.06em', opacity: .72 }}>{row.title}</small>
                      {row.text}
                    </article>
                  ))}
                </div>
                <form className="local-agent-composer" style={styles.composer} onSubmit={send}>
                  <div className="local-agent-composer-row" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10 }}>
                    <textarea
                      style={{ ...styles.input, minHeight: 58, resize: 'vertical' }}
                      value={draft}
                      placeholder={t('composer.placeholder')}
                      disabled={selectedId === undefined}
                      onChange={event => { setDraft(event.target.value) }}
                    />
                    <button type="submit" style={{ ...styles.button, ...styles.primary }} disabled={selectedId === undefined || draft.trim().length === 0}><IconSendOutline16 /> {t('composer.send')}</button>
                  </div>
                  <small style={styles.muted}>{t('composer.hint')}</small>
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
