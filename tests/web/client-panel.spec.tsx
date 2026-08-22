/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Stub every icon the panel imports, present and future.
 *
 * This was a hand-written list of the six icons in use, which meant adding a
 * seventh made it `undefined` at the import site. React then threw on the
 * invalid element type and unmounted the whole panel, so the failure surfaced
 * as "cannot find the directory row" — nowhere near the actual cause. A proxy
 * answers any icon name with a render-nothing component, so the mock cannot
 * fall behind the imports again.
 */
/**
 * Icon stubs. The real package cannot be imported here — it pulls in katex's
 * stylesheet, which the node loader rejects — so the list is written out.
 *
 * A hoisted array rather than an inline object literal, so a test below can
 * check it against the panel's actual imports. When it fell behind, the missing
 * name arrived at the import site as `undefined`, React threw on the invalid
 * element type and unmounted the entire panel, and the failure read as "cannot
 * find the directory row" — several layers away from the cause.
 */
const ICON_STUBS = vi.hoisted(() => [
  'IconArchiveOutline20',
  'IconBranchOutline16',
  'IconCloseOutline16',
  'IconCodeOutline16',
  'IconDataOutline16',
  'IconFolderClose16',
  'IconFolderOpenOutline16',
  'IconPanelLeftOutline16',
  'IconPlusOutline16',
  'IconRefreshOutline16',
  'IconSendOutline16',
  'IconSparkle16',
  'IconStopFill16',
])

/**
 * Non-icon primitives the panel uses, stubbed with real behaviour rather than a
 * no-op: dismiss-on-outside-pointer is the thing a test needs to exercise, and a
 * hook that does nothing would let the panel regress to popovers that never
 * close while the suite stayed green.
 */
const HOOK_STUBS = vi.hoisted(() => ['useDismissOnOutsidePointer'])

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const react = await import('react')
  return {
    ...Object.fromEntries(ICON_STUBS.map(name => [name, () => null])),
    useDismissOnOutsidePointer: (
      root: { current: HTMLElement | null },
      open: boolean,
      setOpen: (open: boolean) => void,
    ) => {
      react.useEffect(() => {
        if (!open) return
        const onPointerDown = (event: PointerEvent): void => {
          const node = root.current
          if (node !== null && !node.contains(event.target as Node)) setOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown)
        return () => { document.removeEventListener('pointerdown', onPointerDown) }
      }, [open, root, setOpen])
    },
  }
})

import { en, zh } from '../../src/client/locales.ts'
import {
  inject,
  LocalAgentPanel,
  type LocalAgentRemote,
} from '../../src/client/index.tsx'
import type {
  BridgeCatalogResult,
  BridgeCompletion,
  BridgeEvent,
  BridgeNativeSession,
  BridgeSessionCreateRequest,
  BridgeSessionReadResult,
  BridgeSessionView,
  PendingInteractionView,
} from '../../src/types.ts'
import { credentialLeakMarkers, redactText } from '../../src/core/redaction.ts'

const session: BridgeSessionView = {
  bridgeSessionId: 'session-1',
  providerId: 'codex',
  workspaceId: 'workspace-1',
  workspaceTitle: 'Fixture workspace',
  title: 'Codex fixture',
  status: 'idle',
  createdAt: 1,
  updatedAt: 1,
  lastTurnId: null,
  queuedInputCount: 0,
  archived: false,
  persistenceVersion: 1,
  contextUsage: null,
  permissionMode: 'auto',
  model: null,
  effort: null,
  rateLimits: [],
  tokenUsage: null,
}

const catalog: BridgeCatalogResult = {
  providers: [{
    id: 'codex',
    displayName: 'Codex',
    installed: true,
    version: '0.147.0',
    supportedRange: '0.147.x',
    permissionModes: [],
    selectableModels: true,
    compatibility: 'supported',
    health: 'ready',
    message: null,
  }],
  workspaces: [{ id: 'workspace-1', title: 'Fixture workspace', status: 'ok', published: false }],
  hostBrowsing: true,
}

function event(
  sequence: number,
  draft: { readonly type: BridgeEvent['type']; readonly data: unknown },
): BridgeEvent {
  return {
    ...draft,
    sequence,
    bridgeSessionId: session.bridgeSessionId,
    bridgeTurnId: 'turn-1',
    timestamp: sequence,
  } as unknown as BridgeEvent
}

function snapshot(
  overrides: Partial<BridgeSessionReadResult> = {},
): BridgeSessionReadResult {
  return {
    session,
    pendingInteraction: null,
    events: [],
    latestSequence: 0,
    reset: false,
    ...overrides,
  }
}

function interaction(kind: 'approval' | 'question'): PendingInteractionView {
  return {
    interactionId: `${kind}-1`,
    bridgeSessionId: session.bridgeSessionId,
    bridgeTurnId: 'turn-1',
    kind,
    providerId: 'codex',
    safeSummary: kind === 'approval' ? 'Run fixture command.' : 'Choose a fixture mode.',
    toolName: kind === 'approval' ? 'shell' : 'request-user-input',
    target: kind === 'approval' ? 'echo fixture' : null,
    questions: kind === 'question' ? [{
      id: 'mode',
      header: 'Mode',
      prompt: 'Which mode?',
      secret: false,
      allowFreeText: true,
      multiSelect: false,
      options: [{ value: 'Fast', label: 'Fast', description: 'Short verification' }],
    }] : [],
    expiresAt: null,
  }
}

class RemoteFixture {
  readonly catalog = vi.fn(async () => ({ ok: true as const, value: catalog }))
  readonly sessionsList = vi.fn(async () => ({ ok: true as const, value: [] as BridgeSessionView[] }))
  // Typed parameter so the assertions below can read what the panel actually
  // requested; an untyped vi.fn gives mock.calls the empty-tuple type.
  readonly sessionCreate = vi.fn(async (_request: BridgeSessionCreateRequest) => ({
    ok: true as const,
    value: session,
  }))
  readonly sessionSend = vi.fn(async () => ({
    ok: true as const,
    value: { delivery: 'started' as const, bridgeTurnId: 'turn-1' },
  }))
  readonly sessionCancel = vi.fn(async () => ({ ok: true as const, value: undefined }))
  readonly sessionArchive = vi.fn(async () => ({ ok: true as const, value: { ...session, archived: true } }))
  readonly interactionRespond = vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } }))
  readonly sessionCompletions = vi.fn(async () => ({
    ok: true as const,
    value: { completions: [] as BridgeCompletion[], pending: false },
  }))
  readonly nativeSessions = vi.fn(async () => ({
    ok: true as const,
    value: { sessions: [] as BridgeNativeSession[], unavailable: false },
  }))
  readonly directoryAdd = vi.fn(async (_request: { path: string }) => ({
    ok: true as const,
    value: { id: 'workspace-1', title: 'Fixture workspace', status: 'ok' as const, published: false },
  }))
  readonly directoryRemove = vi.fn(async (_request: { directoryId: string }) => ({
    ok: true as const,
    value: undefined,
  }))
  readonly sessionFiles = vi.fn(async (_request: { bridgeSessionId: string; query: string }) => ({
    ok: true as const,
    value: { matches: [] as { path: string; name: string; directory: boolean }[], partial: false },
  }))
  readonly hostList = vi.fn(async (request: { path?: string }) => ({
    ok: true as const,
    value: {
      path: request.path ?? '/Users/operator',
      home: '/Users/operator',
      crumbs: [
        { name: '/', path: '/' },
        { name: 'Users', path: '/Users' },
        { name: 'operator', path: '/Users/operator' },
      ] as readonly { name: string; path: string }[],
      entries: [
        { name: 'Documents', path: '/Users/operator/Documents', directory: true, hidden: false },
        { name: '.ssh', path: '/Users/operator/.ssh', directory: true, hidden: true },
        { name: 'diagram.png', path: '/Users/operator/diagram.png', directory: false, hidden: false },
      ] as readonly { name: string; path: string; directory: boolean; hidden: boolean }[],
      truncated: false,
    },
  }))
  readonly sessionRepository = vi.fn(async (_request: { bridgeSessionId: string }) => ({
    ok: true as const,
    value: null as { branch: string | null; detached: boolean; upstream: string | null; ahead: number; behind: number; added: number; removed: number } | null,
  }))
  readonly sessionUpload = vi.fn(async (_request: {
    bridgeSessionId: string
    files: readonly { path: string; contentBase64: string }[]
  }) => ({
    ok: true as const,
    value: { paths: ['.dsh-bridge-uploads/notes.md'] as readonly string[], rejected: 0 },
  }))
  readonly sessionModels = vi.fn(async (_request: { bridgeSessionId: string }) => ({
    ok: true as const,
    value: {
      models: [
        {
          id: 'fixture-fast',
          displayName: 'Fixture Fast',
          description: 'Fixture model with effort levels',
          efforts: ['low', 'high'] as readonly string[],
          defaultEffort: 'low',
        },
      ],
      unavailable: false,
    },
  }))
  readonly sessionModel = vi.fn(async (request: { bridgeSessionId: string; model: string | null; effort: string | null }) => ({
    ok: true as const,
    value: { ...session, model: request.model, effort: request.effort },
  }))
  readonly sessionPermissionMode = vi.fn(async (request: { bridgeSessionId: string; mode: string }) => ({
    ok: true as const,
    value: { ...session, permissionMode: request.mode as BridgeSessionView['permissionMode'] },
  }))
  readonly directoryPublish = vi.fn(async (request: { directoryId: string; published: boolean }) => ({
    ok: true as const,
    value: {
      id: request.directoryId,
      title: 'Fixture workspace',
      status: 'ok' as const,
      published: request.published,
    },
  }))
  readonly sessionRead = vi.fn((request: { bridgeSessionId: string }, signal?: AbortSignal) => {
    const next = this.reads.shift()
    if (next !== undefined) return Promise.resolve({ ok: true as const, value: next })
    return new Promise<Awaited<ReturnType<LocalAgentRemote['sessionRead']>>>((resolve, reject) => {
      const waiter = { resolve, reject }
      this.waiters.push(waiter)
      const abort = (): void => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1)
        reject(signal?.reason ?? new Error('aborted'))
      }
      if (signal?.aborted === true) abort()
      else signal?.addEventListener('abort', abort, { once: true })
    })
  })
  private readonly reads: BridgeSessionReadResult[] = []
  private readonly waiters: Array<{
    resolve: (value: Awaited<ReturnType<LocalAgentRemote['sessionRead']>>) => void
    reject: (reason?: unknown) => void
  }> = []

  pushRead(value: BridgeSessionReadResult): void {
    const waiter = this.waiters.shift()
    if (waiter === undefined) this.reads.push(value)
    else waiter.resolve({ ok: true, value })
  }

  remote(): LocalAgentRemote {
    return this as unknown as LocalAgentRemote
  }
}

/**
 * A translate function with the same semantics as LocaleRuntime.bind: look the
 * key up in the requested dictionary, substitute `{name}` placeholders, and
 * return the key itself on a miss. Driving the panel with the real shipped
 * dictionaries — rather than an identity stub — is what makes the assertions
 * below evidence that the copy is wired up, and lets the same flow be replayed
 * in Chinese.
 * @param locale - which shipped dictionary to read.
 * @returns the translate function the panel receives.
 */
function translator(locale: 'zh' | 'en') {
  const dict: Record<string, string> = locale === 'zh' ? zh : en
  return (key: string, params?: Record<string, unknown>): string => {
    const template = dict[key] ?? key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match)
  }
}

interface RenderOptions {
  readonly locale?: 'zh' | 'en'
  /** Observes the Harness registry seam, to prove the panel does not write it. */
  readonly createWorkspace?: (path: string) => Promise<void>
  readonly pickDirectory?: () => Promise<string | null>
  readonly listDirectory?: (path?: string) => Promise<unknown>
}

/**
 * Click a palette entry by its displayed invocation text.
 *
 * Scoped to the listbox: the same text can appear in the composer's own hint,
 * and a bare text query then matches both.
 * @param text - the invocation text shown on the entry.
 */
async function pickFromPalette(text: string): Promise<void> {
  const listbox = await screen.findByRole('listbox')
  fireEvent.click(await within(listbox).findByText(text))
}

/**
 * The palette's own options.
 *
 * `getAllByRole('option')` would also return the provider and workspace
 * `<select>` children, which carry the same role — scoping to the listbox is
 * what makes these assertions about the palette rather than the whole form.
 * @returns the palette entries in render order.
 */
function paletteOptions(): HTMLElement[] {
  return within(screen.getByRole('listbox')).getAllByRole('option')
}

/** A directory level shaped the way the Host's browse capability reports one. */
function level(path: string, children: readonly string[], extra: { home?: string; truncated?: boolean } = {}) {
  const home = extra.home ?? '/host'
  const segments = path.split('/').filter(Boolean)
  return {
    path,
    home,
    crumbs: segments.map((name, index) => ({
      name,
      path: `/${segments.slice(0, index + 1).join('/')}`,
      hidden: false,
    })),
    entries: children.map(name => ({ name, path: `${path}/${name}`, hidden: name.startsWith('.') })),
    truncated: extra.truncated ?? false,
  }
}

function renderPanel(remote: LocalAgentRemote, options: RenderOptions = {}): void {
  const locale = options.locale ?? 'en'
  const t = translator(locale)
  const props = {
    wide: true,
    remote,
    t,
    speechLocale: () => locale === 'zh' ? 'zh-CN' : 'en-US',
    workspaces: {
      // `create` is no longer used by the panel — a directory goes to the
      // bridge's own store — but the seam stays so a test can prove nothing
      // writes the Harness registry from here.
      create: options.createWorkspace ?? (async () => {}),
      // Both routes always exist on the real service; a Profile that does not
      // serve one makes it reject, which is what these defaults reproduce.
      list: options.listDirectory ?? (async () => { throw new Error('host.listDirectory needs the browse capability') }),
      pick: options.pickDirectory ?? (async () => { throw new Error('host.pickDirectory needs the native capability') }),
    },
  } as unknown as Parameters<typeof LocalAgentPanel>[0]
  render(<LocalAgentPanel {...props} />)
  fireEvent.click(screen.getByTitle(t('panel.name')))
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('LocalAgentPanel', () => {
  it('stubs every primitive the panel imports', () => {
    const block = readFileSync(join(process.cwd(), 'src/client/index.tsx'), 'utf8')
      .match(/import \{([^}]*)\} from '@deepseek-ai\/dsh-client-ui-primitives'/)
    const imported = (block?.[1] ?? '').split(',').map(part => part.trim()).filter(part => part.length > 0)

    expect(imported.length).toBeGreaterThan(0)
    // A name imported but not stubbed is `undefined` at render time, which
    // unmounts the panel with an error pointing somewhere else entirely.
    const stubbed = [...ICON_STUBS, ...HOOK_STUBS]
    expect(imported.filter(name => !stubbed.includes(name))).toEqual([])
    // And the reverse, so the list does not accumulate stubs for primitives the
    // panel stopped using.
    expect(stubbed.filter(name => !imported.includes(name))).toEqual([])
  })

  it('mounts its Remote namespace before dynamically injecting the panel', () => {
    expect(inject).toEqual(expect.arrayContaining(['slots', 'remote']))
    expect(inject).not.toContain('remote.localAgentBridge')
  })

  it('creates a native session, polls its timeline, and sends input', async () => {
    const fixture = new RemoteFixture()
    fixture.pushRead(snapshot({
      session: { ...session, status: 'running', lastTurnId: 'turn-1' },
      events: [
        event(1, { type: 'bridge/user-message', data: { text: 'fixture prompt', delivery: 'started' } }),
        event(2, { type: 'bridge/text-delta', data: { text: 'fixture response', itemId: 'message-1' } }),
      ],
      latestSequence: 2,
    }))
    renderPanel(fixture.remote())

    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Create session' }) as HTMLButtonElement).disabled).toBe(false)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create session' }))

    await screen.findByText('fixture response')
    fireEvent.change(screen.getByPlaceholderText(en['composer.placeholder']), {
      target: { value: 'next prompt' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(fixture.sessionCreate).toHaveBeenCalledWith({ providerId: 'codex', workspaceId: 'workspace-1' })
      expect(fixture.sessionSend).toHaveBeenCalledWith({ bridgeSessionId: 'session-1', text: 'next prompt' })
    })
  })

  it('submits one-turn approval and question responses', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({
      session: { ...session, status: 'awaiting-approval' },
      pendingInteraction: interaction('approval'),
    }))
    renderPanel(fixture.remote())

    fireEvent.click(await screen.findByRole('button', { name: 'Allow once' }))
    await waitFor(() => {
      expect(fixture.interactionRespond).toHaveBeenCalledWith({
        bridgeSessionId: 'session-1',
        interactionId: 'approval-1',
        resolution: { kind: 'approval', action: 'allow' },
      })
    })

    cleanup()
    const questionFixture = new RemoteFixture()
    questionFixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    questionFixture.pushRead(snapshot({
      session: { ...session, status: 'awaiting-answer' },
      pendingInteraction: interaction('question'),
    }))
    renderPanel(questionFixture.remote())
    fireEvent.click(await screen.findByRole('radio', { name: /Fast/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit answers' }))

    await waitFor(() => {
      expect(questionFixture.interactionRespond).toHaveBeenLastCalledWith({
        bridgeSessionId: 'session-1',
        interactionId: 'question-1',
        resolution: { kind: 'question', answers: { mode: ['Fast'] } },
      })
    })
  })

  it('retries long polling after a transient disconnect', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.sessionRead.mockRejectedValueOnce(new Error('temporary disconnect'))
    fixture.pushRead(snapshot({
      events: [event(1, { type: 'bridge/text-delta', data: { text: 'reconnected', itemId: 'message-1' } })],
      latestSequence: 1,
    }))
    renderPanel(fixture.remote())

    expect(await screen.findByText('temporary disconnect')).toBeTruthy()
    expect(await screen.findByText('reconnected', {}, { timeout: 2_000 })).toBeTruthy()
    await waitFor(() => { expect(screen.queryByText('temporary disconnect')).toBeNull() })
    expect(fixture.sessionRead.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('renders the whole panel in Chinese without leaving English copy behind', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({
      session: { ...session, status: 'running' },
      events: [
        event(1, { type: 'bridge/user-message', data: { text: 'fixture prompt', delivery: 'queued' } }),
        event(2, { type: 'bridge/tool-started', data: { itemId: 'tool-1', toolName: 'Write', summary: 'writing', status: 'running' } }),
        event(3, { type: 'bridge/error', data: { code: 'USER_CANCELLED', message: 'The turn was cancelled.' } }),
      ],
      latestSequence: 3,
    }))
    renderPanel(fixture.remote(), { locale: 'zh' })

    // Panel frame, form, and session status all read from the zh dictionary.
    expect(await screen.findByText(zh['create.heading'])).toBeTruthy()
    expect(screen.getByText(zh['panel.subtitle'])).toBeTruthy()
    expect(screen.getByPlaceholderText(zh['composer.placeholder'])).toBeTruthy()
    expect(screen.getByRole('button', { name: zh['create.submit'] })).toBeTruthy()

    // Host enumerations are phrased by the Client, not shipped as English.
    expect(await screen.findByText(zh['row.delivery.queued'])).toBeTruthy()
    expect(screen.getByText(zh['error.USER_CANCELLED'])).toBeTruthy()
    // A cancellation the operator asked for is labelled as such, not as a failure.
    expect(screen.getByText(zh['row.cancelled'])).toBeTruthy()
    expect(document.documentElement.textContent).not.toContain(zh['row.error'])
    // The vendor's own tool name survives translation; only the status word turns.
    expect(screen.getByText(`Write · ${zh['row.toolStatus.running']}`)).toBeTruthy()

    // No English label leaked through from a hardcoded string.
    const rendered = document.documentElement.textContent ?? ''
    for (const key of ['create.heading', 'create.submit', 'composer.send', 'sessions.heading'] as const) {
      expect(rendered).not.toContain(en[key])
    }
  })

  it('renders persisted status events from any build without leaking a dictionary key', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({
      events: [
        // Written by this build.
        event(1, { type: 'bridge/session-status', data: { status: 'cancelling', note: 'cancelling-turn' } }),
        // Written before `note` existed: the property is absent entirely, and
        // `undefined` is not `null`, which is what put `note.undefined` on screen.
        event(2, { type: 'bridge/session-status', data: { status: 'running' } } as unknown as Parameters<typeof event>[1]),
        // Written by a newer Host with a note this build has never heard of.
        event(3, { type: 'bridge/session-status', data: { status: 'idle', note: 'some-future-note' } } as unknown as Parameters<typeof event>[1]),
      ],
      latestSequence: 3,
    }))
    renderPanel(fixture.remote())

    // The known note is phrased; the other two say nothing rather than exposing
    // a key. Every status word still renders, so no row is lost. `Idle` also
    // labels the session in the toolbar, hence getAllByText.
    expect(await screen.findByText(en['note.cancelling-turn'])).toBeTruthy()
    for (const status of ['cancelling', 'running', 'idle'] as const) {
      expect(screen.getAllByText(en[`status.${status}`]).length).toBeGreaterThan(0)
    }
    const rendered = document.documentElement.textContent ?? ''
    expect(rendered).not.toContain('note.undefined')
    expect(rendered).not.toContain('note.some-future-note')
    expect(rendered).not.toContain('some-future-note')
  })

  it('explains an unusable product instead of silently omitting it', async () => {
    const fixture = new RemoteFixture()
    fixture.catalog.mockResolvedValue({
      ok: true,
      value: {
        ...catalog,
        providers: [
          {
            id: 'codex',
            displayName: 'Codex',
            installed: true,
            version: '0.144.6',
            supportedRange: '0.147.x',
            permissionModes: [],
            selectableModels: true,
            compatibility: 'unsupported',
            health: 'unsupported',
            message: null,
          },
          {
            id: 'claude',
            displayName: 'Claude Code',
            installed: false,
            version: null,
            supportedRange: '>=2.1.220 <2.2.0',
            permissionModes: [],
            selectableModels: true,
            compatibility: 'unknown',
            health: 'not-installed',
            message: null,
          },
        ],
        workspaces: catalog.workspaces,
      },
    })
    renderPanel(fixture.remote())

    expect(await screen.findByText(en['diagnostics.heading'])).toBeTruthy()
    // The rejected version and the admitted range are both named.
    expect(screen.getByText(/Codex 0\.144\.6 installed; this bridge admits 0\.147\.x/)).toBeTruthy()
    // A missing product points at the PATH of the process that runs DSH, which
    // is the actual cause when the product works in the operator's own shell.
    expect(screen.getByText(/PATH of the process running DeepSeek Harness/)).toBeTruthy()
    expect(screen.getByText(/Confirm `claude --version` runs in the shell/)).toBeTruthy()

    // Both are listed in the picker but neither can be chosen.
    const options = screen.getAllByRole('option') as HTMLOptionElement[]
    const codex = options.find(option => option.value === 'codex')
    expect(codex?.disabled).toBe(true)
    expect(codex?.textContent).toContain(en['health.unsupported'])
    expect((screen.getByRole('button', { name: en['create.submit'] }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('registers a Host directory as a workspace from inside the panel', async () => {
    const fixture = new RemoteFixture()
    fixture.catalog.mockResolvedValueOnce({
      ok: true,
      value: { ...catalog, providers: catalog.providers, workspaces: [] },
    })
    renderPanel(fixture.remote())

    // An empty registry says so, and Create session stays unavailable.
    expect(await screen.findByText(en['workspace.empty'])).toBeTruthy()
    expect((screen.getByRole('button', { name: en['create.submit'] }) as HTMLButtonElement).disabled).toBe(true)

    // The next catalog read reflects the registration the Host just accepted.
    fixture.catalog.mockResolvedValue({
      ok: true,
      value: {
        ...catalog,
        providers: catalog.providers,
        workspaces: [{ id: 'workspace-1', title: 'Fixture workspace', status: 'ok', published: false }],
      },
    })
    fireEvent.change(screen.getByPlaceholderText(en['workspace.path.placeholder']), {
      target: { value: '  /host/projects/Fixture workspace  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: en['workspace.add.submit'] }))

    // Surrounding whitespace is trimmed before the path reaches the Host, and it
    // goes to the bridge's own store rather than the Harness registry.
    await waitFor(() => {
      expect(fixture.directoryAdd).toHaveBeenCalledWith({ path: '/host/projects/Fixture workspace' })
    })
    // The new workspace is selected, so the operator can create a session next.
    await waitFor(() => {
      expect((screen.getByRole('button', { name: en['create.submit'] }) as HTMLButtonElement).disabled).toBe(false)
    })
  })

  it('keeps a new directory out of the Harness sidebar until it is published', async () => {
    const fixture = new RemoteFixture()
    const harnessRegistrations: string[] = []
    renderPanel(fixture.remote(), {
      createWorkspace: async (path) => { harnessRegistrations.push(path) },
    })

    fireEvent.change(await screen.findByPlaceholderText(en['workspace.path.placeholder']), {
      target: { value: '/host/projects/private' },
    })
    fireEvent.click(screen.getByRole('button', { name: en['workspace.add.submit'] }))

    // It reaches the bridge's own store...
    await waitFor(() => { expect(fixture.directoryAdd).toHaveBeenCalledWith({ path: '/host/projects/private' }) })
    // ...and nothing reaches the Harness registry, which is the whole point: a
    // Harness workspace cannot be hidden once it exists.
    expect(harnessRegistrations).toEqual([])
    expect(fixture.directoryPublish).not.toHaveBeenCalled()

    // The switch reports the directory as not shown in the Harness.
    const toggle = screen.getByRole('switch', { name: new RegExp(en['workspace.publish']) })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('publishes and unpublishes a directory through the switch', async () => {
    const fixture = new RemoteFixture()
    renderPanel(fixture.remote())

    const toggle = await screen.findByRole('switch', { name: new RegExp(en['workspace.publish']) })
    expect(toggle.getAttribute('aria-checked')).toBe('false')

    // Turning it on asks the Host to register the workspace.
    fixture.catalog.mockResolvedValue({
      ok: true,
      value: {
        ...catalog,
        providers: catalog.providers,
        workspaces: [{ id: 'workspace-1', title: 'Fixture workspace', status: 'ok', published: true }],
      },
    })
    fireEvent.click(toggle)
    await waitFor(() => {
      expect(fixture.directoryPublish).toHaveBeenCalledWith({ directoryId: 'workspace-1', published: true })
    })
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: new RegExp(en['workspace.publish']) }).getAttribute('aria-checked')).toBe('true')
    })

    // And off again — reversible, unlike registering directly.
    fixture.catalog.mockResolvedValue({
      ok: true,
      value: {
        ...catalog,
        providers: catalog.providers,
        workspaces: [{ id: 'workspace-1', title: 'Fixture workspace', status: 'ok', published: false }],
      },
    })
    fireEvent.click(screen.getByRole('switch', { name: new RegExp(en['workspace.publish']) }))
    await waitFor(() => {
      expect(fixture.directoryPublish).toHaveBeenLastCalledWith({ directoryId: 'workspace-1', published: false })
    })
  })

  it('removes a directory from the panel and drops it as a session target', async () => {
    const fixture = new RemoteFixture()
    renderPanel(fixture.remote())

    await screen.findByRole('button', { name: en['create.submit'] })
    // A usable directory means a session can be created.
    expect((screen.getByRole('button', { name: en['create.submit'] }) as HTMLButtonElement).disabled).toBe(false)

    fixture.catalog.mockResolvedValue({
      ok: true,
      value: { ...catalog, providers: catalog.providers, workspaces: [] },
    })
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en['workspace.remove']) }))

    await waitFor(() => {
      expect(fixture.directoryRemove).toHaveBeenCalledWith({ directoryId: 'workspace-1' })
    })
    // The selection cannot survive the directory it pointed at.
    await waitFor(() => {
      expect((screen.getByRole('button', { name: en['create.submit'] }) as HTMLButtonElement).disabled).toBe(true)
    })
    expect(await screen.findByText(en['workspace.empty'])).toBeTruthy()
  })

  it('browses the Host directory tree when the Profile serves the browse capability', async () => {
    const fixture = new RemoteFixture()
    const visited: (string | undefined)[] = []
    renderPanel(fixture.remote(), {
      listDirectory: async (path) => {
        visited.push(path)
        if (path === undefined || path === '/host') return level('/host', ['projects', '.cache'])
        return level('/host/projects', ['alpha'])
      },
    })

    fireEvent.click(await screen.findByRole('button', { name: en['workspace.browse'] }))

    // The first read has no path: the Host answers with its own home directory,
    // so the panel never has to guess where to start.
    await waitFor(() => { expect(visited).toEqual([undefined]) })
    expect(await screen.findByRole('button', { name: /projects/ })).toBeTruthy()
    // Hidden directories are withheld until asked for.
    expect(screen.queryByRole('button', { name: /\.cache/ })).toBeNull()
    fireEvent.click(screen.getByLabelText(en['browse.showHidden']))
    expect(await screen.findByRole('button', { name: /\.cache/ })).toBeTruthy()

    // Descending reads the next level and the crumbs follow.
    fireEvent.click(screen.getByRole('button', { name: /projects/ }))
    await waitFor(() => { expect(visited).toEqual([undefined, '/host/projects']) })
    expect(await screen.findByRole('button', { name: 'alpha' })).toBeTruthy()

    // Choosing registers the directory the browser is currently showing.
    fireEvent.click(screen.getByRole('button', { name: en['browse.useThis'] }))
    await waitFor(() => { expect(fixture.directoryAdd).toHaveBeenCalledWith({ path: '/host/projects' }) })
  })

  it('falls back to the Host chooser when browsing is not the composed capability', async () => {
    const fixture = new RemoteFixture()
    let pickCalls = 0
    renderPanel(fixture.remote(), {
      // A browse Profile is the one that rejects pickDirectory; a native
      // Profile is the one that rejects listDirectory. This is the latter.
      listDirectory: async () => { throw new Error('host.listDirectory needs the browse capability') },
      pickDirectory: async () => { pickCalls += 1; return '/host/picked' },
    })

    fireEvent.click(await screen.findByRole('button', { name: en['workspace.browse'] }))
    await waitFor(() => { expect(fixture.directoryAdd).toHaveBeenCalledWith({ path: '/host/picked' }) })
    expect(pickCalls).toBe(1)
    // The probe failing must not surface as an error to the operator.
    expect(screen.queryByText(/needs the browse capability/)).toBeNull()
  })

  it('keeps the path field and explains itself when the Profile serves no picker', async () => {
    const fixture = new RemoteFixture()
    renderPanel(fixture.remote())

    fireEvent.click(await screen.findByRole('button', { name: en['workspace.browse'] }))

    // Both routes refused: say so once, hide the button, and leave the field.
    expect(await screen.findByText(en['browse.unavailable'])).toBeTruthy()
    await waitFor(() => { expect(screen.queryByRole('button', { name: en['workspace.browse'] })).toBeNull() })
    expect(screen.getByPlaceholderText(en['workspace.path.placeholder'])).toBeTruthy()
    // The raw capability error is a composition fact, not something to alarm
    // the operator with.
    expect(screen.queryByText(/needs the native capability/)).toBeNull()
  })

  it('leaves the registry untouched when the browser is dismissed', async () => {
    const fixture = new RemoteFixture()
    renderPanel(fixture.remote(), {
      listDirectory: async () => level('/host', ['projects']),
    })

    fireEvent.click(await screen.findByRole('button', { name: en['workspace.browse'] }))
    fireEvent.click(await screen.findByRole('button', { name: en['browse.cancel'] }))

    await waitFor(() => { expect(screen.queryByRole('button', { name: en['browse.useThis'] })).toBeNull() })
    expect(fixture.directoryAdd).not.toHaveBeenCalled()
    // Dismissing returns to the offer rather than hiding it.
    expect(screen.getByRole('button', { name: en['workspace.browse'] })).toBeTruthy()
  })

  it('completes a workspace file from an @ anywhere a word can start', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.sessionFiles.mockResolvedValue({
      ok: true,
      value: {
        matches: [
          { path: 'src/main.ts', name: 'main.ts', directory: false },
          { path: 'src/domain/mainframe.ts', name: 'mainframe.ts', directory: false },
        ],
        partial: false,
      },
    })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    const composer = await screen.findByPlaceholderText(en['composer.placeholder']) as HTMLTextAreaElement

    // Mid-sentence, because referencing a file is something done while writing.
    fireEvent.change(composer, { target: { value: 'please read @main' } })
    const listbox = await screen.findByRole('listbox', { name: en['files.heading'] })
    await waitFor(() => {
      expect(fixture.sessionFiles).toHaveBeenCalledWith({ bridgeSessionId: 'session-1', query: 'main' })
    })
    // Name first with the path beneath, since two files often share a name.
    expect(within(listbox).getByText('main.ts')).toBeTruthy()
    expect(within(listbox).getByText('src/main.ts')).toBeTruthy()

    fireEvent.click(within(listbox).getByText('main.ts'))
    // Only the @token is replaced; the rest of the draft survives, and a trailing
    // space lets the sentence continue.
    await waitFor(() => { expect(composer.value).toBe('please read @src/main.ts ') })
  })

  it('does not treat an @ inside a word as a file reference', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    const composer = await screen.findByPlaceholderText(en['composer.placeholder']) as HTMLTextAreaElement
    // An email address, a decorator, a handle: none of them are asking for a file.
    fireEvent.change(composer, { target: { value: 'mail me at someone@example.com' } })
    await waitFor(() => { expect(screen.queryByRole('listbox')).toBeNull() })
    expect(fixture.sessionFiles).not.toHaveBeenCalled()
  })

  it('says when the file list was cut short rather than implying it is complete', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.sessionFiles.mockResolvedValue({
      ok: true,
      value: { matches: [{ path: 'a.ts', name: 'a.ts', directory: false }], partial: true },
    })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    fireEvent.change(await screen.findByPlaceholderText(en['composer.placeholder']), { target: { value: '@a' } })
    expect(await screen.findByText(en['files.partial'])).toBeTruthy()
  })

  it('expands a tool row to show the call and its result', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({
      events: [
        // A call emits started then completed for the same itemId. Two rows would
        // show one call twice, with the result behind the stale one.
        event(1, {
          type: 'bridge/tool-started',
          data: {
            itemId: 'tool-1',
            toolName: 'Read',
            summary: 'Read: src/main.ts',
            status: 'running',
            detail: { input: '{\n  "file_path": "src/main.ts"\n}', output: null, truncated: false },
          },
        }),
        event(2, {
          type: 'bridge/tool-completed',
          data: {
            itemId: 'tool-1',
            toolName: 'Read',
            summary: 'Read completed',
            status: 'completed',
            detail: {
              input: '{\n  "file_path": "src/main.ts"\n}',
              output: 'export const answer = 42',
              truncated: true,
            },
          },
        }),
      ],
      latestSequence: 2,
    }))
    renderPanel(fixture.remote())

    // One row, showing the completed state.
    const toggle = await screen.findByRole('button', { name: new RegExp(en['tool.expand']) })
    expect(screen.queryByText('Read: src/main.ts')).toBeNull()
    expect(screen.getByText('Read completed')).toBeTruthy()

    // Collapsed by default: a transcript is read for its shape first.
    expect(screen.queryByText('export const answer = 42')).toBeNull()

    fireEvent.click(toggle)
    // Arguments and result both appear, so the row explains itself.
    expect(await screen.findByText(/"file_path": "src\/main\.ts"/)).toBeTruthy()
    expect(screen.getByText('export const answer = 42')).toBeTruthy()
    // Truncation is stated rather than left to look like the whole output.
    expect(screen.getByText(en['tool.truncated'])).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: new RegExp(en['tool.collapse']) }))
    await waitFor(() => { expect(screen.queryByText('export const answer = 42')).toBeNull() })
  })

  it('leaves a tool row unexpandable when the product described nothing beyond the summary', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({
      events: [event(1, {
        type: 'bridge/tool-completed',
        data: { itemId: 'tool-2', toolName: 'Glob', summary: 'Glob completed', status: 'completed' },
      })],
      latestSequence: 1,
    }))
    renderPanel(fixture.remote())

    expect(await screen.findByText('Glob completed')).toBeTruthy()
    // No affordance offered for detail that does not exist.
    expect(screen.queryByRole('button', { name: new RegExp(en['tool.expand']) })).toBeNull()
  })

  it('offers only the permission modes the session\u2019s product can honour', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.catalog.mockResolvedValue({
      ok: true,
      value: {
        ...catalog,
        workspaces: catalog.workspaces,
        providers: [{
          ...catalog.providers[0]!,
          // Codex reports three, not five: it has no accept-edits policy and its
          // plan mode would override the operator's model configuration.
          permissionModes: [
            { mode: 'auto', skipsApproval: false },
            { mode: 'manual', skipsApproval: false },
            { mode: 'bypass', skipsApproval: true },
          ],
        }],
      },
    })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    fireEvent.click(await screen.findByRole('button', { name: en['mode.auto'] }))
    const menu = await screen.findByRole('menu', { name: en['mode.label'] })
    const offered = within(menu).getAllByRole('menuitemradio').map(item => item.textContent)
    expect(offered.some(text => text?.includes(en['mode.manual']))).toBe(true)
    expect(offered.some(text => text?.includes(en['mode.bypass']))).toBe(true)
    // Absent because this product cannot obey them.
    expect(offered.some(text => text?.includes(en['mode.acceptEdits']))).toBe(false)
    expect(offered.some(text => text?.includes(en['mode.plan']))).toBe(false)
    // And the change is honest about when it takes effect.
    expect(within(menu).getByText(en['mode.nextTurn'])).toBeTruthy()
  })

  it('warns when a mode stops the browser being asked to approve anything', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.catalog.mockResolvedValue({
      ok: true,
      value: {
        ...catalog,
        workspaces: catalog.workspaces,
        providers: [{
          ...catalog.providers[0]!,
          permissionModes: [
            { mode: 'auto', skipsApproval: false },
            { mode: 'bypass', skipsApproval: true },
          ],
        }],
      },
    })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    fireEvent.click(await screen.findByRole('button', { name: en['mode.auto'] }))
    // No warning while the guarded mode is active.
    expect(screen.queryByText(en['mode.skipsApproval'])).toBeNull()

    fireEvent.click(within(await screen.findByRole('menu')).getByText(en['mode.bypass']))
    await waitFor(() => {
      expect(fixture.sessionPermissionMode).toHaveBeenCalledWith({ bridgeSessionId: 'session-1', mode: 'bypass' })
    })
    // The trigger now reads as the unguarded mode, and says so when reopened.
    fireEvent.click(await screen.findByRole('button', { name: en['mode.bypass'] }))
    expect(await screen.findByText(en['mode.skipsApproval'])).toBeTruthy()
  })

  it('collapses the sidebar to a rail and gives the width back to the transcript', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    await screen.findByText(en['create.heading'])
    const body = document.querySelector('.lab-body') as HTMLElement
    expect(body.classList.contains('lab-body--collapsed')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: en['panel.collapseSidebar'] }))

    // The layout is driven by one class, so the main column takes back exactly
    // what the sidebar gave up.
    await waitFor(() => { expect(body.classList.contains('lab-body--collapsed')).toBe(true) })
    // The rail keeps a way back, so collapsing is never a dead end.
    expect(screen.getAllByRole('button', { name: en['panel.expandSidebar'] }).length).toBeGreaterThan(0)

    fireEvent.click(screen.getAllByRole('button', { name: en['panel.expandSidebar'] })[0]!)
    await waitFor(() => { expect(body.classList.contains('lab-body--collapsed')).toBe(false) })
    expect(screen.getByText(en['create.heading'])).toBeTruthy()
  })

  it('shows context usage, and degrades to a raw count without a window', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({
      session: {
        ...session,
        contextUsage: { usedTokens: 42_500, maxTokens: 200_000, model: 'claude-opus-5' },
      },
      events: [],
      latestSequence: 0,
    }))
    renderPanel(fixture.remote())

    // Counts are compacted so the status line stops resizing on every delta.
    expect(await screen.findByText('43k / 200k (21%)')).toBeTruthy()
    const meter = screen.getByRole('progressbar', { name: en['usage.title'] })
    expect(meter.getAttribute('aria-valuenow')).toBe('21')
    cleanup()

    // A product that reports no window gets no invented percentage.
    const noWindow = new RemoteFixture()
    noWindow.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    noWindow.pushRead(snapshot({
      session: { ...session, contextUsage: { usedTokens: 900, maxTokens: null, model: null } },
      events: [],
      latestSequence: 0,
    }))
    renderPanel(noWindow.remote())
    expect(await screen.findByText('900 tokens')).toBeTruthy()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('sends on Enter and inserts a newline on Shift+Enter', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    const composer = await screen.findByPlaceholderText(en['composer.placeholder']) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'run the tests' } })

    // Shift+Enter is a newline, so the textarea keeps its default behaviour.
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true })
    expect(fixture.sessionSend).not.toHaveBeenCalled()

    fireEvent.keyDown(composer, { key: 'Enter' })
    await waitFor(() => {
      expect(fixture.sessionSend).toHaveBeenCalledWith({ bridgeSessionId: 'session-1', text: 'run the tests' })
    })
    // Cleared optimistically, the way a shell prompt does.
    await waitFor(() => { expect(composer.value).toBe('') })
  })

  it('does not send while an input method is composing', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    const composer = await screen.findByPlaceholderText(en['composer.placeholder']) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: '中文' } })

    // Enter during composition accepts a candidate. Sending here would fire the
    // message off half-written on every word a Chinese or Japanese operator types.
    fireEvent.keyDown(composer, { key: 'Enter', isComposing: true })
    expect(fixture.sessionSend).not.toHaveBeenCalled()
    expect(composer.value).toBe('中文')

    // Composition finished: Enter sends.
    fireEvent.keyDown(composer, { key: 'Enter' })
    await waitFor(() => { expect(fixture.sessionSend).toHaveBeenCalledTimes(1) })
  })

  it('interrupts a running turn with Escape, and clears the draft when idle', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({
      session: { ...session, status: 'running' },
      events: [],
      latestSequence: 0,
    }))
    renderPanel(fixture.remote())

    const composer = await screen.findByPlaceholderText(en['composer.placeholder']) as HTMLTextAreaElement
    await waitFor(() => { expect(screen.getByText(en['status.running'])).toBeTruthy() })

    fireEvent.keyDown(composer, { key: 'Escape' })
    await waitFor(() => {
      expect(fixture.sessionCancel).toHaveBeenCalledWith({ bridgeSessionId: 'session-1' })
    })

    // Idle: nothing to interrupt, so Escape clears instead of cancelling again.
    cleanup()
    const idle = new RemoteFixture()
    idle.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    idle.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(idle.remote())
    const idleComposer = await screen.findByPlaceholderText(en['composer.placeholder']) as HTMLTextAreaElement
    fireEvent.change(idleComposer, { target: { value: 'abandon this' } })
    fireEvent.keyDown(idleComposer, { key: 'Escape' })
    await waitFor(() => { expect(idleComposer.value).toBe('') })
    expect(idle.sessionCancel).not.toHaveBeenCalled()
  })

  it('walks back through sent messages with the arrow keys', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({
      events: [
        event(1, { type: 'bridge/user-message', data: { text: 'first thing', delivery: 'started' } }),
        event(2, { type: 'bridge/user-message', data: { text: 'second thing', delivery: 'started' } }),
      ],
      latestSequence: 2,
    }))
    renderPanel(fixture.remote())

    const composer = await screen.findByPlaceholderText(en['composer.placeholder']) as HTMLTextAreaElement
    await screen.findByText('second thing')

    // Newest first, like a shell.
    fireEvent.keyDown(composer, { key: 'ArrowUp' })
    await waitFor(() => { expect(composer.value).toBe('second thing') })
    fireEvent.keyDown(composer, { key: 'ArrowUp' })
    await waitFor(() => { expect(composer.value).toBe('first thing') })
    // Clamped at the oldest rather than wrapping.
    fireEvent.keyDown(composer, { key: 'ArrowUp' })
    expect(composer.value).toBe('first thing')

    fireEvent.keyDown(composer, { key: 'ArrowDown' })
    await waitFor(() => { expect(composer.value).toBe('second thing') })
    // Coming back past the newest leaves an empty composer, not the last entry.
    fireEvent.keyDown(composer, { key: 'ArrowDown' })
    await waitFor(() => { expect(composer.value).toBe('') })
  })

  it('leaves ArrowUp alone inside a draft the operator is editing', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({
      events: [event(1, { type: 'bridge/user-message', data: { text: 'earlier', delivery: 'started' } })],
      latestSequence: 1,
    }))
    renderPanel(fixture.remote())

    const composer = await screen.findByPlaceholderText(en['composer.placeholder']) as HTMLTextAreaElement
    await screen.findByText('earlier')
    fireEvent.change(composer, { target: { value: 'a draft\nspanning lines' } })

    // In a non-empty draft, ArrowUp is cursor movement — replacing the text
    // would destroy work in progress.
    fireEvent.keyDown(composer, { key: 'ArrowUp' })
    expect(composer.value).toBe('a draft\nspanning lines')
  })

  it('opens the command palette on a leading slash and keeps it shut otherwise', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.sessionCompletions.mockResolvedValue({
      ok: true,
      value: {
        pending: false,
        completions: [
          { kind: 'command', name: 'compact', insertText: '/compact', description: 'Compact the context', argumentHint: null, status: null },
          { kind: 'command', name: 'review', insertText: '/review', description: null, argumentHint: '<path>', status: null },
        ],
      },
    })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    const composer = await screen.findByPlaceholderText(en['composer.placeholder'])
    expect(screen.queryByRole('listbox')).toBeNull()

    fireEvent.change(composer, { target: { value: '/' } })
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).getByText('/compact')).toBeTruthy()
    expect(within(listbox).getByText('/review')).toBeTruthy()

    // A slash mid-sentence is a path or a date, not a command gesture.
    fireEvent.change(composer, { target: { value: 'look at src/main.ts' } })
    await waitFor(() => { expect(screen.queryByRole('listbox')).toBeNull() })

    // A space after the token means the operator moved on to arguments.
    fireEvent.change(composer, { target: { value: '/compact now' } })
    await waitFor(() => { expect(screen.queryByRole('listbox')).toBeNull() })
  })

  it('ranks a prefix match above a description match', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.sessionCompletions.mockResolvedValue({
      ok: true,
      value: {
        pending: false,
        completions: [
          { kind: 'command', name: 'review', insertText: '/review', description: 'Also compacts first', argumentHint: null, status: null },
          { kind: 'command', name: 'compact', insertText: '/compact', description: null, argumentHint: null, status: null },
        ],
      },
    })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    fireEvent.change(await screen.findByPlaceholderText(en['composer.placeholder']), { target: { value: '/comp' } })
    await screen.findByRole('listbox')
    const names = paletteOptions().map(item => item.querySelector('.lab-palette-name')?.textContent)
    expect(names).toEqual(['/compact', '/review'])
  })

  it('inserts the product\u2019s own invocation text, which differs per product', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.sessionCompletions.mockResolvedValue({
      ok: true,
      value: {
        pending: false,
        completions: [
          // Claude Code: a slash command, no arguments.
          { kind: 'command', name: 'compact', insertText: '/compact', description: null, argumentHint: null, status: null },
          // Claude Code: takes an argument, so the draft needs room for it.
          { kind: 'command', name: 'review', insertText: '/review', description: null, argumentHint: '<path>', status: null },
          // Codex: a skill, named without a slash — the Host decided this text.
          { kind: 'command', name: 'browser:control', insertText: 'browser:control', description: null, argumentHint: null, status: null },
        ],
      },
    })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    const composer = await screen.findByPlaceholderText(en['composer.placeholder']) as HTMLTextAreaElement

    fireEvent.change(composer, { target: { value: '/compact' } })
    await pickFromPalette('/compact')
    // No argument hint: ready to send exactly as it stands.
    await waitFor(() => { expect(composer.value).toBe('/compact') })

    fireEvent.change(composer, { target: { value: '/review' } })
    await pickFromPalette('/review')
    // An argument hint earns a trailing space so typing can continue.
    await waitFor(() => { expect(composer.value).toBe('/review ') })

    fireEvent.change(composer, { target: { value: '/browser' } })
    await pickFromPalette('browser:control')
    // The Codex form carries no slash, because that is not how Codex resolves it.
    await waitFor(() => { expect(composer.value).toBe('browser:control') })
  })

  it('drives the palette from the keyboard without stealing focus from the composer', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.sessionCompletions.mockResolvedValue({
      ok: true,
      value: {
        pending: false,
        completions: [
          { kind: 'command', name: 'alpha', insertText: '/alpha', description: null, argumentHint: null, status: null },
          { kind: 'command', name: 'beta', insertText: '/beta', description: null, argumentHint: null, status: null },
        ],
      },
    })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    const composer = await screen.findByPlaceholderText(en['composer.placeholder']) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: '/' } })
    await screen.findByRole('listbox')

    // The first entry is selected, so Enter picks something immediately.
    expect(paletteOptions()[0]?.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(composer, { key: 'ArrowDown' })
    expect(paletteOptions()[1]?.getAttribute('aria-selected')).toBe('true')
    // Wrapping, so arrowing past the end returns to the top.
    fireEvent.keyDown(composer, { key: 'ArrowDown' })
    expect(paletteOptions()[0]?.getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(composer, { key: 'ArrowUp' })
    fireEvent.keyDown(composer, { key: 'Enter' })
    await waitFor(() => { expect(composer.value).toBe('/beta') })

    // Escape clears the trigger rather than leaving a stray slash behind.
    fireEvent.change(composer, { target: { value: '/' } })
    await screen.findByRole('listbox')
    fireEvent.keyDown(composer, { key: 'Escape' })
    await waitFor(() => { expect(composer.value).toBe('') })
  })

  it('lists MCP servers as inventory that the composer cannot invoke', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.sessionCompletions.mockResolvedValue({
      ok: true,
      value: {
        pending: false,
        completions: [
          { kind: 'command', name: 'compact', insertText: '/compact', description: null, argumentHint: null, status: null },
          { kind: 'mcp', name: 'node_repl', insertText: null, description: 'v1.5.0 · js_reset', argumentHint: null, status: 'unsupported' },
        ],
      },
    })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    fireEvent.change(await screen.findByPlaceholderText(en['composer.placeholder']), { target: { value: '/' } })
    await screen.findByRole('listbox')

    expect(screen.getByText(en['palette.mcp'])).toBeTruthy()
    expect(screen.getByText('node_repl')).toBeTruthy()
    // Reported state is visible, so a configured-but-unreachable server reads
    // differently from a live one.
    expect(screen.getByText('unsupported')).toBeTruthy()
    // Not an option, and not clickable: it has no invocation text.
    const server = screen.getByText('node_repl').closest('button') as HTMLButtonElement
    expect(server.disabled).toBe(true)
    expect(server.getAttribute('role')).not.toBe('option')
    // Only the command counts as a keyboard-selectable match.
    expect(paletteOptions()).toHaveLength(1)
  })

  it('explains that Claude Code reports its commands only after a turn has run', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.sessionCompletions.mockResolvedValue({ ok: true, value: { completions: [], pending: true } })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    fireEvent.change(await screen.findByPlaceholderText(en['composer.placeholder']), { target: { value: '/' } })
    // Pending is not the same as "this agent has no commands", and the panel says
    // which one it is.
    expect(await screen.findByText(en['palette.pending'])).toBeTruthy()
    expect(screen.queryByText(en['palette.none'])).toBeNull()
  })

  it('continues a native session by seeding its locator into a new bridge session', async () => {
    const fixture = new RemoteFixture()
    fixture.nativeSessions.mockResolvedValue({
      ok: true,
      value: {
        unavailable: false,
        sessions: [
          { locator: 'native-newer', title: 'Refactor the parser', updatedAt: 1_787_000_000_000, branch: 'main' },
          { locator: 'native-older', title: 'Investigate the flake', updatedAt: 1_786_000_000_000, branch: null },
        ],
      },
    })
    renderPanel(fixture.remote())

    // Not fetched on open: listing costs a product round-trip, and for Codex it
    // means starting the App Server.
    await screen.findByRole('button', { name: en['create.submit'] })
    expect(fixture.nativeSessions).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: en['resume.open'] }))
    expect(await screen.findByText('Refactor the parser')).toBeTruthy()
    expect(screen.getByText('Investigate the flake')).toBeTruthy()
    // Scoped to the selected provider and workspace, not a global listing.
    expect(fixture.nativeSessions).toHaveBeenCalledWith({ providerId: 'codex', workspaceId: 'workspace-1' })
    // A branch is shown when the product reports one.
    expect(screen.getByText(/main/)).toBeTruthy()

    // Nothing is created until a session is actually chosen.
    const confirm = screen.getByRole('button', { name: en['resume.submit'] }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)

    fireEvent.click(screen.getByText('Investigate the flake'))
    fireEvent.click(screen.getByRole('button', { name: en['resume.submit'] }))

    await waitFor(() => { expect(fixture.sessionCreate).toHaveBeenCalledTimes(1) })
    const request = fixture.sessionCreate.mock.calls[0]?.[0]
    // The locator is passed through untouched — the bridge never parses it.
    expect(request).toMatchObject({ providerId: 'codex', workspaceId: 'workspace-1', resumeLocator: 'native-older' })
    // And the bridge session is named after the product's own session, so the
    // list reads the same as the terminal it was started in.
    expect(request?.title).toContain('Investigate the flake')
    expect(request?.title).toContain(en['resume.badge'])
  })

  it('creates a fresh session with no locator when resume is not used', async () => {
    const fixture = new RemoteFixture()
    renderPanel(fixture.remote())

    fireEvent.click(await screen.findByRole('button', { name: en['create.submit'] }))
    await waitFor(() => { expect(fixture.sessionCreate).toHaveBeenCalledTimes(1) })
    // Absent, not null or empty: the Host treats any present value as a resume.
    expect(fixture.sessionCreate.mock.calls[0]?.[0]).not.toHaveProperty('resumeLocator')
  })

  it('distinguishes an agent with no past sessions from one that cannot list them', async () => {
    const fixture = new RemoteFixture()
    fixture.nativeSessions.mockResolvedValue({ ok: true, value: { sessions: [], unavailable: false } })
    renderPanel(fixture.remote())
    fireEvent.click(await screen.findByRole('button', { name: en['resume.open'] }))
    expect(await screen.findByText(en['resume.empty'])).toBeTruthy()
    expect(screen.queryByText(en['resume.unavailable'])).toBeNull()
    cleanup()

    const cannot = new RemoteFixture()
    cannot.nativeSessions.mockResolvedValue({ ok: true, value: { sessions: [], unavailable: true } })
    renderPanel(cannot.remote())
    fireEvent.click(await screen.findByRole('button', { name: en['resume.open'] }))
    expect(await screen.findByText(en['resume.unavailable'])).toBeTruthy()
    expect(screen.queryByText(en['resume.empty'])).toBeNull()
  })

  it('abandons a resume without creating anything', async () => {
    const fixture = new RemoteFixture()
    fixture.nativeSessions.mockResolvedValue({
      ok: true,
      value: { unavailable: false, sessions: [{ locator: 'native-1', title: 'Some work', updatedAt: 1_787_000_000_000, branch: null }] },
    })
    renderPanel(fixture.remote())

    fireEvent.click(await screen.findByRole('button', { name: en['resume.open'] }))
    fireEvent.click(await screen.findByText('Some work'))
    fireEvent.click(screen.getByRole('button', { name: en['resume.cancel'] }))

    await waitFor(() => { expect(screen.queryByRole('button', { name: en['resume.submit'] })).toBeNull() })
    expect(fixture.sessionCreate).not.toHaveBeenCalled()
    // Reopening starts from no selection, so a stale pick cannot be confirmed.
    fireEvent.click(screen.getByRole('button', { name: en['resume.open'] }))
    await screen.findByText('Some work')
    expect((screen.getByRole('button', { name: en['resume.submit'] }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('has no vendor login surface, vendor request, storage residue, or credential canary', async () => {
    const clientSource = readFileSync(join(process.cwd(), 'src/client/index.tsx'), 'utf8')
    expect(clientSource).not.toMatch(/anthropic\.com|claude\.ai|openai\.com|chatgpt\.com/i)
    expect(clientSource).not.toMatch(/account\/login|auth\/login|oauth\/authorize|device\s*code|api[_ -]?key/i)
    expect(clientSource).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|new\s+WebSocket/i)

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected browser request'))
    const xhrSpy = vi.spyOn(XMLHttpRequest.prototype, 'open')
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    const bearerCanary = 'browserBearerCanary987654321'
    const apiKeyCanary = 'browserApiKeyCanary987654321'
    const deviceCanary = 'ZXCV-2468-QWER'
    const rawCanary = [
      `Authorization: Bearer ${bearerCanary}`,
      `api_key=sk-${apiKeyCanary}`,
      `https://openai.com/oauth/authorize?device=${deviceCanary}`,
    ].join('\n')
    fixture.pushRead(snapshot({
      events: [event(1, {
        type: 'bridge/text-delta',
        data: { text: redactText(rawCanary), itemId: 'redacted-canary' },
      })],
      latestSequence: 1,
    }))
    renderPanel(fixture.remote())

    await screen.findByText(/\[REDACTED\]/)
    const storageSnapshot = JSON.stringify({
      local: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => {
        const key = localStorage.key(index) ?? ''
        return [key, localStorage.getItem(key)]
      })),
      session: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => {
        const key = sessionStorage.key(index) ?? ''
        return [key, sessionStorage.getItem(key)]
      })),
      cookie: document.cookie,
    })
    const browserSurface = [
      document.documentElement.outerHTML,
      storageSnapshot,
      JSON.stringify({
        catalogCalls: fixture.catalog.mock.calls,
        sessionReadCalls: fixture.sessionRead.mock.calls.map(call => call[0]),
      }),
    ].join('\n')

    for (const canary of [bearerCanary, apiKeyCanary, deviceCanary]) {
      expect(browserSurface).not.toContain(canary)
    }
    expect(credentialLeakMarkers(browserSurface)).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(xhrSpy).not.toHaveBeenCalled()
    expect(document.querySelectorAll('[download]')).toHaveLength(0)
    const authControls = [...document.querySelectorAll('button, a, input, textarea')]
      .map(element => [
        element.textContent,
        element.getAttribute('aria-label'),
        element.getAttribute('placeholder'),
        element.getAttribute('name'),
        element.getAttribute('href'),
      ].filter(Boolean).join(' '))
      .filter(value => /log\s*in|sign\s*in|oauth|device\s*code|api[_ -]?key|access[_ -]?token/i.test(value))
    expect(authControls).toEqual([])
  })

  it('sends the chosen model and its effort to the Host, and shows them together', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    const trigger = await screen.findByTitle(en['model.label'])
    // Nothing chosen yet reads as the product's own setting, not as "no model".
    expect(trigger.textContent).toContain(en['model.default'])

    fireEvent.click(trigger)
    fireEvent.click(await screen.findByText('Fixture Fast'))
    // The product's own default effort rides along, rather than being dropped and
    // silently replaced by whatever the product falls back to.
    await waitFor(() => {
      expect(fixture.sessionModel).toHaveBeenCalledWith({
        bridgeSessionId: 'session-1',
        model: 'fixture-fast',
        effort: 'low',
      })
    })
    await waitFor(() => {
      expect(screen.getByTitle(en['model.label']).textContent)
        .toContain(`Fixture Fast · ${en['effort.low']}`)
    })

    fireEvent.click(screen.getByTitle(en['model.label']))
    // One slider rather than a button per level: the levels are an ordered axis,
    // and it announces the level's name rather than its index.
    const slider = await screen.findByRole('slider', { name: en['effort.label'] })
    expect(slider.getAttribute('aria-valuetext')).toBe(en['effort.low'])
    // The fixture model offers ['low', 'high'], so index 1 is `high`.
    fireEvent.change(slider, { target: { value: '1' } })
    await waitFor(() => {
      expect(fixture.sessionModel).toHaveBeenLastCalledWith({
        bridgeSessionId: 'session-1',
        model: 'fixture-fast',
        effort: 'high',
      })
    })
  })

  it('says the model list is not readable yet, rather than showing an empty corner', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    // Claude Code before its first turn: the product does support choosing a
    // model, it just cannot be asked yet.
    fixture.sessionModels.mockResolvedValue({ ok: true, value: { models: [], unavailable: true } })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    const placeholder = await screen.findByTitle(en['model.unavailable'])
    expect((placeholder as HTMLButtonElement).disabled).toBe(true)
  })

  it('offers no model control for a product that has none', async () => {
    const fixture = new RemoteFixture()
    fixture.catalog.mockResolvedValue({
      ok: true,
      value: {
        ...catalog,
        providers: [{ ...catalog.providers[0]!, selectableModels: false }],
      },
    })
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.sessionModels.mockResolvedValue({ ok: true, value: { models: [], unavailable: true } })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    await screen.findByPlaceholderText(en['composer.placeholder'])
    // Neither a picker nor the "ask again later" placeholder: this product will
    // never have one, and saying otherwise would promise a control that is coming.
    expect(screen.queryByTitle(en['model.label'])).toBeNull()
    expect(screen.queryByTitle(en['model.unavailable'])).toBeNull()
  })

  it('references a file or a folder from the plus button, without the @ syntax', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.sessionFiles.mockResolvedValue({
      ok: true,
      value: {
        matches: [
          { path: 'src', name: 'src', directory: true },
          { path: 'src/main.ts', name: 'main.ts', directory: false },
        ],
        partial: false,
      },
    })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    const composer = await screen.findByPlaceholderText(en['composer.placeholder']) as HTMLTextAreaElement
    fireEvent.click(screen.getByLabelText(en['attach.open']))
    // The button opens with everything, so the operator can browse rather than
    // having to know what to search for.
    await waitFor(() => {
      expect(fixture.sessionFiles).toHaveBeenCalledWith({ bridgeSessionId: 'session-1', query: '' })
    })

    // A folder keeps its trailing slash, which is how both products tell one
    // from a file.
    fireEvent.click(await screen.findByText('src/'))
    await waitFor(() => { expect(composer.value).toBe('@src/ ') })

    fireEvent.click(screen.getByLabelText(en['attach.open']))
    fireEvent.click(await screen.findByText('main.ts'))
    // Accumulates rather than replacing: several references in one prompt is the
    // normal case.
    await waitFor(() => { expect(composer.value).toBe('@src/ @src/main.ts ') })
  })

  it('shows the tightest usage allowance, and nothing at all when none was reported', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())
    await screen.findByPlaceholderText(en['composer.placeholder'])
    // An account the product said nothing about must not be rendered as 0%.
    expect(screen.queryByTitle(new RegExp(en['quota.title']))).toBeNull()

    cleanup()

    const withQuota: BridgeSessionView = {
      ...session,
      rateLimits: [
        { window: 'five_hour', utilization: 0.12, status: 'allowed', resetsAt: null },
        { window: 'seven_day', utilization: 0.87, status: 'warning', resetsAt: null },
      ],
    }
    const reported = new RemoteFixture()
    reported.sessionsList.mockResolvedValue({ ok: true, value: [withQuota] })
    reported.pushRead(snapshot({ session: withQuota, events: [], latestSequence: 0 }))
    renderPanel(reported.remote())
    // The weekly window is the one that will stop them, so that is the figure
    // shown; the other is in the tooltip.
    expect(await screen.findByText(en['quota.used'].replace('{percent}', '87'))).toBeTruthy()
  })

  it('offers dictation only where the browser has the API', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())
    await screen.findByPlaceholderText(en['composer.placeholder'])
    // jsdom has no Web Speech API, which is exactly the browser this must not
    // show a permanently dead button in.
    expect(screen.queryByLabelText(en['dictate.start'])).toBeNull()

    cleanup()

    class FakeRecognition {
      lang = ''
      interimResults = false
      continuous = false
      onresult: ((event: unknown) => void) | null = null
      onerror: (() => void) | null = null
      onend: (() => void) | null = null
      static last: FakeRecognition | undefined
      constructor() { FakeRecognition.last = this }
      start(): void {}
      stop(): void { this.onend?.() }
      abort(): void {}
    }
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)

    const speaking = new RemoteFixture()
    speaking.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    speaking.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(speaking.remote())
    const composer = await screen.findByPlaceholderText(en['composer.placeholder']) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'read this' } })

    fireEvent.click(screen.getByLabelText(en['dictate.start']))
    // The panel's own language, so recognition expects what is being spoken.
    expect(FakeRecognition.last?.lang).toBe('en-US')

    FakeRecognition.last?.onresult?.({
      resultIndex: 0,
      results: { length: 1, 0: { length: 1, 0: { transcript: 'and then stop' } } },
    })
    // Appended to what was typed rather than replacing it, so dictation extends
    // a sentence instead of discarding it.
    await waitFor(() => { expect(composer.value).toBe('read this and then stop') })
  })

  it('closes every composer popover on an outside click and on Escape', async () => {
    const fixture = new RemoteFixture()
    // The default fixture product reports no permission modes, which correctly
    // hides that picker; this case needs all three popovers present.
    fixture.catalog.mockResolvedValue({
      ok: true,
      value: {
        ...catalog,
        providers: [{
          ...catalog.providers[0]!,
          permissionModes: [
            { mode: 'auto', skipsApproval: false },
            { mode: 'manual', skipsApproval: false },
          ],
        }],
      },
    })
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    const timeline = await screen.findByPlaceholderText(en['composer.placeholder'])

    // Each of the three is opened by a click, so each has to be closable the way
    // every other menu in the application is — an operator who opened one to look
    // at it should not have to reopen it to get rid of it.
    const cases: readonly { readonly open: () => HTMLElement; readonly surface: string }[] = [
      { open: () => screen.getByRole('button', { name: en['mode.auto'] }), surface: en['mode.label'] },
      { open: () => screen.getByTitle(en['model.label']), surface: en['model.label'] },
      { open: () => screen.getByLabelText(en['attach.open']), surface: en['attach.title'] },
    ]

    for (const { open, surface } of cases) {
      fireEvent.click(open())
      await waitFor(() => { expect(screen.getByLabelText(surface)).toBeTruthy() })
      // Anywhere that is not the popover: the transcript above it will do.
      fireEvent.pointerDown(timeline)
      await waitFor(() => { expect(screen.queryByLabelText(surface)).toBeNull() })

      fireEvent.click(open())
      await waitFor(() => { expect(screen.getByLabelText(surface)).toBeTruthy() })
      fireEvent.keyDown(screen.getByLabelText(surface), { key: 'Escape' })
      await waitFor(() => { expect(screen.queryByLabelText(surface)).toBeNull() })
    }
  })

  it('uploads files from the browser’s own machine and references what landed', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    const composer = await screen.findByPlaceholderText(en['composer.placeholder']) as HTMLTextAreaElement
    fireEvent.click(screen.getByLabelText(en['attach.open']))
    // The working directory is the default, because it copies nothing.
    fireEvent.click(await screen.findByRole('tab', { name: en['attach.fromWorkspace'] }))
    fireEvent.click(screen.getByRole('tab', { name: en['attach.fromBrowser'] }))

    const picker = screen.getByLabelText(en['attach.title'])
    const inputs = [...picker.querySelectorAll('input[type="file"]')] as HTMLInputElement[]
    // One plain chooser and one folder chooser. The attribute is set on the DOM
    // node because React's typings have no name for it, which is exactly the kind
    // of wiring that can silently not happen — it did, and the folder button then
    // opened a file chooser.
    expect(inputs).toHaveLength(2)
    expect(inputs.filter(node => node.hasAttribute('webkitdirectory'))).toHaveLength(1)

    const input = inputs.find(node => !node.hasAttribute('webkitdirectory'))!
    Object.defineProperty(input, 'files', {
      value: [new File(['hello from the laptop'], 'notes.md', { type: 'text/markdown' })],
    })
    fireEvent.change(input)

    // Only the base64 payload crosses; the data-URL prefix the reader produces is
    // stripped on this side.
    await waitFor(() => {
      expect(fixture.sessionUpload).toHaveBeenCalledWith({
        bridgeSessionId: 'session-1',
        files: [{
          path: 'notes.md',
          contentBase64: Buffer.from('hello from the laptop', 'utf8').toString('base64'),
        }],
      })
    })
    // Referenced exactly like a workspace file, so the products read one shape.
    await waitFor(() => { expect(composer.value).toBe('@.dsh-bridge-uploads/notes.md ') })
  })

  it('says how many uploads the Host refused instead of quietly delivering fewer', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.sessionUpload.mockResolvedValue({ ok: true, value: { paths: [], rejected: 2 } })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    await screen.findByPlaceholderText(en['composer.placeholder'])
    fireEvent.click(screen.getByLabelText(en['attach.open']))
    fireEvent.click(await screen.findByRole('tab', { name: en['attach.fromBrowser'] }))

    const picker = screen.getByLabelText(en['attach.title'])
    const input = picker.querySelector('input[type="file"]:not([webkitdirectory])') as HTMLInputElement
    Object.defineProperty(input, 'files', {
      value: [new File(['a'], 'one.bin'), new File(['b'], 'two.bin')],
    })
    fireEvent.change(input)

    expect(await screen.findByText(en['attach.rejected'].replace('{count}', '2'))).toBeTruthy()
  })

  it('shows the branch, the change size, and that a branch tracks nothing', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.sessionRepository.mockResolvedValue({
      ok: true,
      value: { branch: 'master', detached: false, upstream: null, ahead: 0, behind: 0, added: 1754, removed: 87 },
    })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    expect(await screen.findByText('master')).toBeTruthy()
    // Compacted the way a status line has to be, so the width stops moving.
    expect(screen.getByText('+1.8k')).toBeTruthy()
    expect(screen.getByText('−87')).toBeTruthy()
    // Said out loud rather than left blank: pushing from an untracked branch is a
    // different act, and finding out afterwards is the wrong time.
    expect(screen.getByText(en['repo.noUpstream'])).toBeTruthy()
  })

  it('shows nothing about a directory that is not a repository', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    await screen.findByPlaceholderText(en['composer.placeholder'])
    await waitFor(() => { expect(fixture.sessionRepository).toHaveBeenCalled() })
    // No invented branch, and no empty chrome where one would go.
    expect(screen.queryByText(en['repo.noUpstream'])).toBeNull()
  })

  it('shows the session’s token total, with the breakdown on hover', async () => {
    const spent: BridgeSessionView = {
      ...session,
      tokenUsage: { input: 3_300, output: 1_600_000, cacheRead: 758_700_000, cacheWrite: 12_000, total: 760_300_000 },
    }
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [spent] })
    fixture.pushRead(snapshot({ session: spent, events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    const total = await screen.findByText(en['spend.total'].replace('{count}', '760.3M'))
    // One figure on screen, because that is the one an operator watches; the split
    // is what explains it and belongs in the tooltip rather than competing with the
    // context meter beside it.
    const title = total.getAttribute('title') ?? ''
    expect(title).toContain(en['spend.input'].replace('{count}', '3.3k'))
    expect(title).toContain(en['spend.cacheRead'].replace('{count}', '758.7M'))
    // Cache reads and writes stay apart: they price differently in both products.
    expect(title).toContain(en['spend.cacheWrite'].replace('{count}', '12k'))
  })

  it('marks where a resumed session’s existing transcript ends', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({
      events: [
        event(1, { type: 'bridge/user-message', data: { text: 'from the terminal', delivery: 'started' } }),
        event(2, { type: 'bridge/text-delta', data: { text: 'answered earlier', itemId: 'old' } }),
        event(3, { type: 'bridge/history', data: { restored: 2, truncated: false } }),
        event(4, { type: 'bridge/user-message', data: { text: 'and now from the browser', delivery: 'started' } }),
      ],
      latestSequence: 4,
    }))
    renderPanel(fixture.remote())

    // The earlier conversation is there to read, rather than a blank screen above
    // a working agent.
    expect(await screen.findByText('from the terminal')).toBeTruthy()
    expect(screen.getByText('answered earlier')).toBeTruthy()
    // And the line saying which is which.
    expect(screen.getByText(en['history.restored'].replace('{count}', '2'))).toBeTruthy()
    expect(screen.getByText('and now from the browser')).toBeTruthy()
  })

  it('says when a transcript was too long to load whole', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({
      events: [event(1, { type: 'bridge/history', data: { restored: 240, truncated: true } })],
      latestSequence: 1,
    }))
    renderPanel(fixture.remote())

    // Truncation is stated rather than leaving the reader to assume the beginning
    // of the conversation simply did not exist.
    expect(await screen.findByText(en['history.truncated'].replace('{count}', '240'))).toBeTruthy()
  })

  it('references a file from anywhere on the Host, by browsing it', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    const composer = await screen.findByPlaceholderText(en['composer.placeholder']) as HTMLTextAreaElement
    fireEvent.click(screen.getByLabelText(en['attach.open']))
    fireEvent.click(await screen.findByRole('tab', { name: en['attach.fromHost'] }))

    // The first level is read only once the tab is opened — this is the panel's
    // widest read of the Host, and an operator who never asks should not trigger it.
    await waitFor(() => { expect(fixture.hostList).toHaveBeenCalledWith({}) })

    // Dot-prefixed entries stay hidden until asked for. `.ssh` is exactly the kind
    // of directory that should not be one stray click away.
    expect(screen.queryByText('.ssh/')).toBeNull()
    fireEvent.click(screen.getByLabelText(en['browse.showHidden']))
    expect(await screen.findByText('.ssh/')).toBeTruthy()

    // A directory opens rather than being referenced, so one click never means two
    // things.
    fireEvent.click(screen.getByText('Documents/'))
    await waitFor(() => {
      expect(fixture.hostList).toHaveBeenLastCalledWith({ path: '/Users/operator/Documents' })
    })

    // A file is what the operator came for, and it is referenced absolutely —
    // there is no working directory for it to be relative to.
    fireEvent.click(screen.getByText('diagram.png'))
    await waitFor(() => { expect(composer.value).toBe('@/Users/operator/diagram.png ') })
  })

  it('references a whole Host directory through its own button', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    const composer = await screen.findByPlaceholderText(en['composer.placeholder']) as HTMLTextAreaElement
    fireEvent.click(screen.getByLabelText(en['attach.open']))
    fireEvent.click(await screen.findByRole('tab', { name: en['attach.fromHost'] }))
    await waitFor(() => { expect(fixture.hostList).toHaveBeenCalled() })

    fireEvent.click(screen.getByRole('button', { name: en['attach.useDirectory'] }))
    // The trailing slash is how both products tell a directory from a file.
    await waitFor(() => { expect(composer.value).toBe('@/Users/operator/ ') })
  })

  it('omits the Host route entirely when the Profile does not serve it', async () => {
    const fixture = new RemoteFixture()
    fixture.catalog.mockResolvedValue({ ok: true, value: { ...catalog, hostBrowsing: false } })
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    await screen.findByPlaceholderText(en['composer.placeholder'])
    fireEvent.click(screen.getByLabelText(en['attach.open']))
    // Absent rather than disabled, and never read: a route that cannot work should
    // not be offered, and the widest read must not happen behind a dead tab.
    expect(await screen.findByRole('tab', { name: en['attach.fromWorkspace'] })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: en['attach.fromHost'] })).toBeNull()
    expect(fixture.hostList).not.toHaveBeenCalled()
  })

  it('reveals streamed text gradually, and shows a finished answer whole', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] })
    try {
      const answer = 'A'.repeat(400)
      const fixture = new RemoteFixture()
      fixture.sessionsList.mockResolvedValue({ ok: true, value: [{ ...session, status: 'running' }] })
      fixture.pushRead(snapshot({
        session: { ...session, status: 'running' },
        // One batch carrying 400 characters: what a long poll actually delivers,
        // measured at 346 on a real Codex turn.
        events: [event(1, { type: 'bridge/text-delta', data: { text: answer, itemId: 'x' } })],
        latestSequence: 1,
      }))
      renderPanel(fixture.remote())

      // Measured by subtracting the row label rather than by matching characters:
      // the label is "Assistant", which starts with a capital A, so a /A+/ match
      // finds that one letter and reports the row as barely revealed.
      const revealed = (): number => {
        const card = document.querySelector('.lab-row-card--assistant')
        return (card?.textContent?.length ?? 0) - en['row.assistant'].length
      }

      await vi.advanceTimersByTimeAsync(50)
      // Arrived whole, revealed progressively: the point of separating the two.
      expect(revealed()).toBeGreaterThan(0)
      expect(revealed()).toBeLessThan(answer.length)

      // And it catches up rather than falling permanently behind a fast turn.
      await vi.advanceTimersByTimeAsync(2_000)
      expect(revealed()).toBe(answer.length)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not animate a transcript restored from a resumed session', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({
      events: [
        event(1, { type: 'bridge/text-delta', data: { text: 'said earlier', itemId: 'old' } }),
        event(2, { type: 'bridge/history', data: { restored: 1, truncated: false } }),
      ],
      latestSequence: 2,
    }))
    renderPanel(fixture.remote())

    // The session is idle, so nothing is still being written. Typing out history
    // would be a lie about when it happened.
    expect(await screen.findByText('said earlier')).toBeTruthy()
  })

  it('shows a trace of where the time went, alongside the conversation', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({
      ok: true,
      value: [{
        ...session,
        tokenUsage: { input: 1_000, output: 500, cacheRead: 3_000, cacheWrite: 0, total: 4_500 },
      }],
    })
    fixture.pushRead(snapshot({
      session: {
        ...session,
        tokenUsage: { input: 1_000, output: 500, cacheRead: 3_000, cacheWrite: 0, total: 4_500 },
      },
      events: [
        { ...event(1, { type: 'bridge/user-message', data: { text: 'summarise this', delivery: 'started' } }), timestamp: 1_000 },
        {
          ...event(2, {
            type: 'bridge/turn-started',
            data: {
              turn: {
                bridgeTurnId: 'turn-1',
                bridgeSessionId: 'session-1',
                status: 'running' as const,
                startedAt: 1_100,
                completedAt: null,
                stopReason: null,
              },
            },
          }),
          timestamp: 1_100,
        },
        { ...event(3, { type: 'bridge/text-delta', data: { text: 'reading', itemId: 'a' } }), timestamp: 1_600 },
        {
          ...event(4, {
            type: 'bridge/tool-completed',
            data: {
              itemId: 't1',
              toolName: 'read',
              summary: 'read docs',
              status: 'completed',
              detail: { input: '{"file_path":"docs/feature.md"}', output: '<type>file</type>', truncated: false },
            },
          }),
          timestamp: 4_100,
        },
      ],
      latestSequence: 4,
    }))
    renderPanel(fixture.remote())

    // The conversation is the default; the trace answers a different question and
    // is a tab away rather than replacing it.
    await screen.findByPlaceholderText(en['composer.placeholder'])
    fireEvent.click(screen.getByRole('tab', { name: en['view.trace'] }))

    // The tool call, with its arguments and its result on one line.
    expect(await screen.findByText(/feature\.md/)).toBeTruthy()
    expect(screen.getByText(/<type>file<\/type>/)).toBeTruthy()
    // Totals derived from the timestamps, not fetched.
    expect(screen.getByText(en['trace.turns'].replace('{count}', '1'))).toBeTruthy()
    expect(screen.getByText(en['trace.cache'].replace('{percent}', '75'))).toBeTruthy()

    // Search narrows the steps.
    fireEvent.change(screen.getByPlaceholderText(en['trace.search']), { target: { value: 'nothing-matches' } })
    expect(await screen.findByText(en['trace.empty'])).toBeTruthy()

    // And the conversation is still there, with its scroll position and any expanded
    // rows intact, because it was hidden rather than unmounted.
    fireEvent.click(screen.getByRole('tab', { name: en['view.chat'] }))
    expect(screen.getByText('summarise this')).toBeTruthy()
  })

  it('leaves out a trace figure the products never reported', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({
      events: [event(1, { type: 'bridge/user-message', data: { text: 'hello', delivery: 'started' } })],
      latestSequence: 1,
    }))
    renderPanel(fixture.remote())

    await screen.findByPlaceholderText(en['composer.placeholder'])
    fireEvent.click(screen.getByRole('tab', { name: en['view.trace'] }))
    await screen.findByPlaceholderText(en['trace.search'])

    // No token report means no rate and no cache ratio. A zero in a performance view
    // gets believed, so absence is rendered as absence.
    expect(screen.queryByText(/tok\/s/)).toBeNull()
    expect(screen.queryByText(new RegExp(en['trace.cache'].replace('{percent}', '\\d+')))).toBeNull()
  })
})
