import { useEffect, useMemo, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, CSSProperties, FormEvent, ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
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
} from '@deepseek-ai/dsh-client-ui-slots'
import type {
  RemoteResult,
  TypertRemoteNamespaceMap,
} from '@deepseek-ai/dsh-typert-protocol'
import remoteContribution from '../typert.remote-client.ts'
import type {
  BridgeCatalogResult,
  BridgeEvent,
  BridgeQuestion,
  BridgeSessionView,
  NativeProviderView,
  PendingInteractionView,
} from '../types.ts'

export type LocalAgentRemote = TypertRemoteNamespaceMap['localAgentBridge']

interface LocalAgentPanelFace {
  readonly remote: LocalAgentRemote
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

function timeline(events: readonly BridgeEvent[]): TimelineRow[] {
  const rows: TimelineRow[] = []
  for (const event of events) {
    const key = `${String(event.sequence)}-${event.type}`
    if (event.type === 'bridge/user-message') {
      rows.push({ key, kind: 'user', title: event.data.delivery, text: event.data.text })
    } else if (event.type === 'bridge/text-delta' || event.type === 'bridge/reasoning-delta') {
      const kind = event.type === 'bridge/text-delta' ? 'assistant' : 'reasoning'
      const previous = rows.at(-1)
      const group = `${event.bridgeTurnId ?? ''}:${event.data.itemId ?? ''}:${kind}`
      if (previous?.key.endsWith(group)) {
        rows[rows.length - 1] = { ...previous, text: previous.text + event.data.text }
      } else {
        rows.push({ key: `${key}:${group}`, kind, title: kind, text: event.data.text })
      }
    } else if (event.type === 'bridge/tool-started' || event.type === 'bridge/tool-updated' || event.type === 'bridge/tool-completed') {
      rows.push({ key, kind: 'tool', title: `${event.data.toolName} - ${event.data.status}`, text: event.data.summary })
    } else if (event.type === 'bridge/file-change') {
      rows.push({ key, kind: 'tool', title: 'File change', text: event.data.summary })
    } else if (event.type === 'bridge/error') {
      rows.push({ key, kind: 'error', title: event.data.code, text: event.data.message })
    } else if (event.type === 'bridge/session-status') {
      rows.push({ key, kind: 'status', title: event.data.status, text: event.data.message ?? '' })
    }
  }
  return rows
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
}: {
  question: BridgeQuestion
  value: readonly string[]
  onChange: (value: string[]) => void
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
            placeholder="Custom answer"
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
}: {
  interaction: PendingInteractionView
  remote: LocalAgentRemote
  onResolved: () => void
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
        {interaction.kind === 'approval' ? 'Approval required' : 'Input required'}
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
            />
          ))}
        </div>
      )}
      {error !== undefined && <div style={{ color: palette.danger, marginTop: 8 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {interaction.kind === 'approval' ? (
          <>
            <ActionButton primary disabled={busy} onClick={() => { void respond({ kind: 'approval', action: 'allow' }) }}>Allow once</ActionButton>
            <ActionButton disabled={busy} onClick={() => { void respond({ kind: 'approval', action: 'deny' }) }}>Deny</ActionButton>
            <ActionButton danger disabled={busy} onClick={() => { void respond({ kind: 'approval', action: 'cancel' }) }}>Cancel turn</ActionButton>
          </>
        ) : (
          <ActionButton primary disabled={busy} onClick={() => { void respond({ kind: 'question', answers }) }}>Submit answers</ActionButton>
        )}
      </div>
    </div>
  )
}

export function LocalAgentPanel({ wide, remote }: LocalAgentPanelProps) {
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

  const rows = useMemo(() => timeline(snapshot?.events ?? []), [snapshot?.events])
  const readyProviders = catalog?.providers.filter(provider => provider.health === 'ready') ?? []
  const readyWorkspaces = catalog?.workspaces.filter(workspace => workspace.status === 'ok') ?? []

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
      <button type="button" style={styles.trigger} title="Local Agents" onClick={() => { setOpen(true) }}>
        <IconCodeOutline16 />{wide && <span>Local Agents</span>}
      </button>
      {open && (
        <div className="local-agent-overlay" style={styles.overlay} role="dialog" aria-modal="true" aria-label="Local Agents">
          <section className="local-agent-shell" style={styles.shell}>
            <header className="local-agent-header" style={styles.header}>
              <div>
                <strong style={{ fontSize: 18 }}>Local Agents</strong>
                <div style={{ ...styles.muted, fontSize: 12 }}>Claude Code and Codex sessions on this host</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <ActionButton aria-label="Refresh" title="Refresh" onClick={() => { void refresh() }}><IconRefreshOutline16 /></ActionButton>
                <ActionButton aria-label="Close" title="Close" onClick={() => { setOpen(false) }}><IconCloseOutline16 /></ActionButton>
              </div>
            </header>
            <div className="local-agent-body" style={styles.body}>
              <aside className="local-agent-sidebar" style={styles.sidebar}>
                <div style={{ ...styles.card, marginBottom: 14 }}>
                  <strong>New native session</strong>
                  <div style={{ display: 'grid', gap: 9, marginTop: 10 }}>
                    <label style={styles.label}>Provider
                      <select style={styles.input} value={providerId ?? ''} onChange={event => { setProviderId(event.target.value) }}>
                        <option value="" disabled>Select provider</option>
                        {readyProviders.map(provider => <option key={provider.id} value={provider.id}>{provider.displayName} {provider.version ?? ''}</option>)}
                      </select>
                    </label>
                    <label style={styles.label}>Workspace
                      <select style={styles.input} value={workspaceId ?? ''} onChange={event => { setWorkspaceId(event.target.value) }}>
                        <option value="" disabled>Select workspace</option>
                        {readyWorkspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.title}</option>)}
                      </select>
                    </label>
                    <ActionButton primary disabled={busy || providerId === undefined || workspaceId === undefined} onClick={() => { void createSession() }}>
                      Create session
                    </ActionButton>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: palette.muted, margin: '0 2px 8px' }}>SESSIONS</div>
                {sessions.map(session => (
                  <button
                    key={session.bridgeSessionId}
                    type="button"
                    style={{ ...styles.session, ...(selectedId === session.bridgeSessionId ? styles.selected : {}) }}
                    onClick={() => { setSelectedId(session.bridgeSessionId) }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <strong>{session.title}</strong><span style={styles.badge}>{session.status}</span>
                    </div>
                    <small style={styles.muted}>{session.workspaceTitle} - {session.providerId}</small>
                  </button>
                ))}
              </aside>
              <main className="local-agent-main" style={styles.main}>
                <div className="local-agent-toolbar" style={styles.toolbar}>
                  <div>
                    <strong>{snapshot?.session.title ?? 'Select or create a session'}</strong>
                    {snapshot !== undefined && <div style={{ ...styles.muted, fontSize: 12 }}>{snapshot.session.workspaceTitle} - {snapshot.session.status}</div>}
                  </div>
                  {snapshot !== undefined && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <ActionButton danger disabled={!['running', 'awaiting-approval', 'awaiting-answer', 'cancelling'].includes(snapshot.session.status)} onClick={() => {
                        void remote.sessionCancel({ bridgeSessionId: snapshot.session.bridgeSessionId })
                      }}><IconStopFill16 /> Cancel turn</ActionButton>
                      <ActionButton onClick={() => {
                        void remote.sessionArchive({ bridgeSessionId: snapshot.session.bridgeSessionId, archived: true })
                          .then(unwrap).then(() => {
                            setSessions(current => current.filter(item => item.bridgeSessionId !== snapshot.session.bridgeSessionId))
                            setSelectedId(undefined)
                          })
                      }}><IconArchiveOutline20 size={16} /> Archive</ActionButton>
                    </div>
                  )}
                </div>
                <div className="local-agent-timeline" style={styles.timeline}>
                  {error !== undefined && <div style={{ ...styles.card, color: palette.danger, marginBottom: 12 }}>{error}</div>}
                  {snapshot?.pendingInteraction !== null && snapshot?.pendingInteraction !== undefined && (
                    <InteractionCard interaction={snapshot.pendingInteraction} remote={remote} onResolved={() => { setError(undefined) }} />
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
                      placeholder="Send to the native agent on the host..."
                      disabled={selectedId === undefined}
                      onChange={event => { setDraft(event.target.value) }}
                    />
                    <button type="submit" style={{ ...styles.button, ...styles.primary }} disabled={selectedId === undefined || draft.trim().length === 0}><IconSendOutline16 /> Send</button>
                  </div>
                  <small style={styles.muted}>Running Codex messages are steered; Claude messages queue until the active turn completes.</small>
                </form>
              </main>
            </div>
          </section>
        </div>
      )}
    </>
  )
}

export const inject = ['slots', 'remote']

export function apply(ctx: ClientContext): void {
  ctx.effect(async () => {
    return ctx.remote.$mount(remoteContribution)
  }, 'local-agent-bridge: mount Remote')
  ctx.inject(['slots', 'remote.localAgentBridge'], (scope) => {
    scope.slots.inject('sidebar.footer.action', () => scope.slots.register({
      name: 'sidebar.footer.action',
      id: 'local-agent-bridge',
      inject: (): LocalAgentPanelFace => ({ remote: scope.remote.localAgentBridge }),
    }, LocalAgentPanel))
  })
}
