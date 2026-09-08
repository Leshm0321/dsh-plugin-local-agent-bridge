/** @vitest-environment jsdom */

import { readFileSync, readdirSync } from 'node:fs'
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
  'IconAlarmClockOutline16',
  'IconArchiveOutline20',
  'IconBranchOutline16',
  'IconCloseOutline16',
  'IconCheckOutline16',
  'IconCodeOutline16',
  'IconEditOutline16',
  'IconEllipsisOutline16',
  'IconDataOutline16',
  'IconFolderClose16',
  'IconFolderOpen16',
  'IconFolderOpenOutline16',
  'IconPanelLeftOutline16',
  'IconPlusOutline16',
  'IconRefreshOutline16',
  'IconSendOutline16',
  'IconSparkle16',
  'IconTrashOutline16',
  'IconStopFill16',
])

/**
 * Non-icon primitives the panel uses, stubbed with real behaviour rather than a
 * no-op: dismiss-on-outside-pointer is the thing a test needs to exercise, and a
 * hook that does nothing would let the panel regress to popovers that never
 * close while the suite stayed green.
 */
const HOOK_STUBS = vi.hoisted(() => ['Menu', 'RiskConfirmation', 'useDismissOnOutsidePointer'])

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const react = await import('react')
  return {
    ...Object.fromEntries(ICON_STUBS.map(name => [name, () => null])),
    /**
     * Stands in for the anchored dropdown, keeping the part under test: the anchor
     * is always rendered, and the rows exist only while it is open.
     */
    Menu: ({ open, anchor, items, onSelect }: {
      open: boolean
      anchor: unknown
      items: readonly { id: string; label: unknown; type?: string }[]
      onSelect: (id: string) => void
    }) => react.createElement('span', {}, [
      react.createElement('span', { key: 'anchor' }, anchor as never),
      open
        ? react.createElement('span', { key: 'list', role: 'menu' }, items
          .filter(item => item.type !== 'separator')
          .map(item => react.createElement('button', {
            key: item.id, type: 'button', role: 'menuitem', onClick: () => { onSelect(item.id) },
          }, item.label as never)))
        : null,
    ]),
    /**
     * Stands in for the real confirmation, keeping only the part under test: the
     * primary action stays unavailable until the acknowledgement is ticked.
     */
    RiskConfirmation: ({
      open, title, description, acknowledgeLabel, cancelLabel, confirmLabel,
      acknowledged, onAcknowledgedChange, onCancel, onConfirm,
    }: {
      open: boolean
      title: string
      description: string
      acknowledgeLabel: string
      cancelLabel: string
      confirmLabel: string
      acknowledged: boolean
      onAcknowledgedChange: (next: boolean) => void
      onCancel: () => void
      onConfirm: () => void
    }) => open
      ? react.createElement('div', { role: 'dialog', 'aria-label': title }, [
        react.createElement('p', { key: 'title' }, title),
        react.createElement('p', { key: 'body' }, description),
        react.createElement('label', { key: 'ack' }, [
          react.createElement('input', {
            key: 'box',
            type: 'checkbox',
            'aria-label': acknowledgeLabel,
            checked: acknowledged,
            onChange: () => { onAcknowledgedChange(!acknowledged) },
          }),
          acknowledgeLabel,
        ]),
        react.createElement('button', { key: 'cancel', type: 'button', onClick: onCancel }, cancelLabel),
        react.createElement('button', {
          key: 'confirm', type: 'button', disabled: !acknowledged, onClick: onConfirm,
        }, confirmLabel),
      ])
      : null,
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
  pinned: false,
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
  workspaceWrites: true,
  dictation: true,
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
  readonly sessionRename = vi.fn(async (_request: { bridgeSessionId: string; title: string }) => ({
    ok: true as const,
    value: session,
  }))
  readonly sessionPin = vi.fn(async (_request: { bridgeSessionId: string; pinned: boolean }) => ({
    ok: true as const,
    value: session,
  }))
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
  readonly workspaceList = vi.fn(async (request: { bridgeSessionId: string; path?: string }) => ({
    ok: true as const,
    value: {
      path: request.path ?? '',
      entries: (request.path ?? '') === ''
        ? [
          { name: 'src', path: 'src', directory: true, hidden: false, bytes: null },
          { name: '.env.example', path: '.env.example', directory: false, hidden: true, bytes: 12 },
          { name: 'README.md', path: 'README.md', directory: false, hidden: false, bytes: 9 },
        ]
        : [{ name: 'main.ts', path: 'src/main.ts', directory: false, hidden: false, bytes: 25 }],
      truncated: false,
    },
  }))
  readonly workspaceFile = vi.fn(async (request: { bridgeSessionId: string; path: string }) => ({
    ok: true as const,
    value: request.path.endsWith('.png')
      ? { path: request.path, revision: 'r1', content: '', bytes: 2_048, truncated: false, binary: true }
      : { path: request.path, revision: 'r1', content: 'export const answer = 42\n', bytes: 25, truncated: false, binary: false },
  }))
  readonly workspaceDiff = vi.fn(async (_request: { bridgeSessionId: string }) => ({
    ok: true as const,
    value: {
      entries: [
        { path: 'src/main.ts', added: 2, removed: 1, binary: false, untracked: false },
        { path: 'logo.png', added: 0, removed: 0, binary: true, untracked: false },
        { path: 'notes.txt', added: 0, removed: 0, binary: false, untracked: true },
      ] as readonly { path: string; added: number; removed: number; binary: boolean; untracked: boolean }[],
      unavailable: false,
    },
  }))
  readonly workspaceFileDiff = vi.fn(async (_request: { bridgeSessionId: string; path: string }) => ({
    ok: true as const,
    value: [{
      header: '@@ -1,3 +1,4 @@',
      lines: [
        { kind: 'context' as const, text: 'const first = 1', oldNumber: 1, newNumber: 1 },
        { kind: 'removed' as const, text: 'const second = 2', oldNumber: 2, newNumber: null },
        { kind: 'added' as const, text: 'const second = 22', oldNumber: null, newNumber: 2 },
        { kind: 'added' as const, text: 'const third = 3', oldNumber: null, newNumber: 3 },
      ],
    }] as readonly { header: string; lines: readonly { kind: 'context' | 'added' | 'removed'; text: string; oldNumber: number | null; newNumber: number | null }[] }[],
  }))
  readonly workspaceWrite = vi.fn(async (request: { bridgeSessionId: string; path: string; content: string; revision: string }) => ({
    ok: true as const,
    value: { path: request.path, revision: 'r2', content: request.content, bytes: request.content.length, truncated: false, binary: false },
  }))
  readonly workspaceCreate = vi.fn(async (_request: { bridgeSessionId: string; path: string; directory: boolean }) => ({
    ok: true as const,
    value: undefined,
  }))
  readonly workspaceRename = vi.fn(async (_request: { bridgeSessionId: string; from: string; to: string }) => ({
    ok: true as const,
    value: undefined,
  }))
  readonly workspaceDelete = vi.fn(async (_request: { bridgeSessionId: string; path: string }) => ({
    ok: true as const,
    value: undefined,
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

  /**
   * No password set, so the panel is open. The lock's own behaviour is covered in
   * `tests/unit/privacy.spec.ts` against the gate itself; here it exists so the
   * panel has an answer and can get on with what these tests are about.
   */
  readonly privacyState = vi.fn(async (_request: { token: string }) => ({
    ok: true as const,
    value: {
      configured: false,
      unlocked: true,
      lockedOutUntil: null as number | null,
      absoluteTimeoutMs: 8 * 60 * 60_000,
      idleTimeoutMs: 30 * 60_000,
      minPasswordLength: 8,
    },
  }))

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
    // Every client JSX file, not just the panel: a component split into its own file
    // imports its own icons, and scanning one file let an unstubbed import through as
    // an "undefined is not a component" failure pointing somewhere else.
    const imported = readdirSync(join(process.cwd(), 'src/client'))
      .filter(name => name.endsWith('.tsx'))
      .flatMap((name) => {
        const source = readFileSync(join(process.cwd(), 'src/client', name), 'utf8')
        const block = source.match(/import \{([^}]*)\} from '@deepseek-ai\/dsh-client-ui-primitives'/)
        return (block?.[1] ?? '').split(',').map(part => part.trim()).filter(part => part.length > 0)
      })
      .filter((name, index, all) => all.indexOf(name) === index)

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
      expect(fixture.sessionCreate).toHaveBeenCalledWith({ token: '', providerId: 'codex', workspaceId: 'workspace-1' })
      expect(fixture.sessionSend).toHaveBeenCalledWith({ token: '', bridgeSessionId: 'session-1', text: 'next prompt' })
    })
  })

  it('watches the turns a shut panel left running, and badges what finished', async () => {
    const running = { ...session, status: 'running' as const }
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [running] })
    fixture.pushRead(snapshot({ session: running }))
    renderPanel(fixture.remote())

    // Open, with a turn in flight: the trigger carries no news, because the operator
    // is looking at the thing the news would be about.
    await screen.findByPlaceholderText(en['composer.placeholder'])
    expect(screen.queryByLabelText(/session\(s\) finished/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: en['panel.close'] }))
    // Shut, and the turn settles while nobody is watching.
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [{ ...session, status: 'idle' as const }] })

    const badge = await screen.findByLabelText(/1 session\(s\) finished/, {}, { timeout: 10_000 })
    expect(badge.textContent).toBe('1')

    // Reopening is reading the news, so it stops being news.
    fireEvent.click(badge.closest('button') as HTMLButtonElement)
    await screen.findByPlaceholderText(en['composer.placeholder'])
    await waitFor(() => { expect(screen.queryByLabelText(/session\(s\) finished/)).toBeNull() })
  }, 15_000)

  it('leaves a shut panel entirely idle when it had nothing running', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({}))
    renderPanel(fixture.remote())

    await screen.findByPlaceholderText(en['composer.placeholder'])
    fireEvent.click(screen.getByRole('button', { name: en['panel.close'] }))
    const asked = fixture.sessionsList.mock.calls.length

    // Nothing was in flight, so there is nothing to look in on: the watch must not
    // start, or a closed panel would poll the Host forever for no reason.
    await new Promise(resolve => setTimeout(resolve, 1_000))
    expect(fixture.sessionsList.mock.calls.length).toBe(asked)
  })


  it('gathers sessions under their directory and folds a group away', async () => {
    const other = { ...session, bridgeSessionId: 'session-2', workspaceId: 'workspace-2', workspaceTitle: 'Other repo', title: 'other work' }
    const sibling = { ...session, bridgeSessionId: 'session-3', title: 'sibling work' }
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session, sibling, other] })
    fixture.pushRead(snapshot({}))
    renderPanel(fixture.remote())

    await screen.findByPlaceholderText(en['composer.placeholder'])
    const list = within(document.querySelector('.lab-sessions') as HTMLElement)
    // The directory says itself once, at the head of its group.
    const head = list.getByRole('button', { name: /Fixture workspace/ })
    expect(head.getAttribute('aria-expanded')).toBe('true')
    expect(list.getByText('sibling work')).toBeTruthy()
    expect(list.getByRole('button', { name: /Other repo/ })).toBeTruthy()

    fireEvent.click(head)
    // Folded: its rows are gone, and the other directory is untouched.
    expect(head.getAttribute('aria-expanded')).toBe('false')
    expect(list.queryByText('sibling work')).toBeNull()
    expect(list.getByText('other work')).toBeTruthy()
  })

  it('renames a session from its row, and clears the name back to the placeholder', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({}))
    fixture.sessionRename.mockResolvedValue({ ok: true, value: { ...session, title: 'retry policy work' } })
    renderPanel(fixture.remote())

    await screen.findByPlaceholderText(en['composer.placeholder'])
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en['session.actions']) }))
    fireEvent.click(screen.getByRole('menuitem', { name: en['session.rename'] }))

    // Seeded with the current title, so a small correction is a small edit.
    const field = screen.getByLabelText(en['session.rename']) as HTMLInputElement
    expect(field.value).toBe(session.title)
    fireEvent.change(field, { target: { value: 'retry policy work' } })
    fireEvent.keyDown(field, { key: 'Enter' })

    await waitFor(() => {
      expect(fixture.sessionRename).toHaveBeenCalledWith({
        token: '',
        bridgeSessionId: 'session-1',
        title: 'retry policy work',
      })
    })
    const list = within(document.querySelector('.lab-sessions') as HTMLElement)
    await waitFor(() => { expect(list.getByText('retry policy work')).toBeTruthy() })
  })

  it('abandons a rename on Escape without asking the Host', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({}))
    renderPanel(fixture.remote())

    await screen.findByPlaceholderText(en['composer.placeholder'])
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en['session.actions']) }))
    fireEvent.click(screen.getByRole('menuitem', { name: en['session.rename'] }))
    const field = screen.getByLabelText(en['session.rename'])
    fireEvent.change(field, { target: { value: 'discard me' } })
    fireEvent.keyDown(field, { key: 'Escape' })

    // Escape closes the edit; the blur that follows must not then commit it.
    fireEvent.blur(field)
    await waitFor(() => { expect(screen.queryByLabelText(en['session.rename'])).toBeNull() })
    expect(fixture.sessionRename).not.toHaveBeenCalled()
    const list = within(document.querySelector('.lab-sessions') as HTMLElement)
    expect(list.getByText(session.title)).toBeTruthy()
  })

  it('pins a session to the head of its group and lets it fall back', async () => {
    const older = { ...session, bridgeSessionId: 'session-2', title: 'older work', updatedAt: 1 }
    const newer = { ...session, bridgeSessionId: 'session-3', title: 'newer work', updatedAt: 9 }
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [newer, older] })
    fixture.pushRead(snapshot({}))
    fixture.sessionPin.mockResolvedValue({ ok: true, value: { ...older, pinned: true } })
    renderPanel(fixture.remote())

    await screen.findByPlaceholderText(en['composer.placeholder'])
    const names = () => within(document.querySelector('.lab-sessions') as HTMLElement)
      .getAllByText(/work$/).map(node => node.textContent)
    expect(names()).toEqual(['newer work', 'older work'])

    fireEvent.click(screen.getByRole('button', { name: new RegExp(`${en['session.actions']} — older work`) }))
    fireEvent.click(screen.getByRole('menuitem', { name: en['session.pin'] }))

    await waitFor(() => {
      expect(fixture.sessionPin).toHaveBeenCalledWith({ token: '', bridgeSessionId: 'session-2', pinned: true })
    })
    // Moved without a refetch, by the Host's own rule: pinned first, then recency.
    await waitFor(() => { expect(names()).toEqual(['older work', 'newer work']) })
    // And the row menu now offers the way back.
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`${en['session.actions']} — older work`) }))
    expect(screen.getByRole('menuitem', { name: en['session.unpin'] })).toBeTruthy()
  })

  it('archives a row the reader is not looking at without emptying the pane they are', async () => {
    const other = { ...session, bridgeSessionId: 'session-2', title: 'not selected' }
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session, other] })
    fixture.pushRead(snapshot({}))
    renderPanel(fixture.remote())

    // session-1 is the selection; archiving the other row must leave it alone.
    await screen.findByPlaceholderText(en['composer.placeholder'])
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`${en['session.actions']} — not selected`) }))
    fireEvent.click(screen.getByRole('menuitem', { name: en['session.archive'] }))

    await waitFor(() => {
      expect(within(document.querySelector('.lab-sessions') as HTMLElement).queryByText('not selected')).toBeNull()
    })
    expect(screen.getByPlaceholderText(en['composer.placeholder'])).toBeTruthy()
  })


  it('filters a session list only once it is long enough to need it', async () => {
    const many = Array.from({ length: 6 }, (_, index) => ({
      ...session,
      bridgeSessionId: `session-${index + 1}`,
      title: index === 5 ? 'explain the retry policy' : `unrelated work ${index}`,
    }))

    const few = new RemoteFixture()
    few.sessionsList.mockResolvedValue({ ok: true, value: many.slice(0, 5) })
    few.pushRead(snapshot({}))
    renderPanel(few.remote())
    await screen.findByPlaceholderText(en['composer.placeholder'])
    // Five rows are scannable; the input would only cost a row of a narrow column.
    expect(screen.queryByPlaceholderText(en['sessions.filter'])).toBeNull()

    cleanup()
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: many })
    fixture.pushRead(snapshot({}))
    renderPanel(fixture.remote())

    const filter = await screen.findByPlaceholderText(en['sessions.filter'])
    expect(screen.getByText('unrelated work 3')).toBeTruthy()
    fireEvent.change(filter, { target: { value: 'retry' } })
    expect(screen.getByText('explain the retry policy')).toBeTruthy()
    expect(screen.queryByText('unrelated work 3')).toBeNull()

    // A filter that matches nothing says so, rather than showing an empty column.
    fireEvent.change(filter, { target: { value: 'nothing here' } })
    expect(screen.getByText(en['sessions.filterEmpty'])).toBeTruthy()
  })


  it('charges the time an approval sat unanswered to the wait, not to the work', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    const turn = (status: 'running' | 'completed', completedAt: number | null) => ({
      turn: {
        bridgeTurnId: 'turn-1',
        bridgeSessionId: 'session-1',
        status,
        startedAt: 1_000,
        completedAt,
        stopReason: null,
      },
    })
    fixture.pushRead(snapshot({
      events: [
        { ...event(1, { type: 'bridge/turn-started', data: turn('running', null) }), timestamp: 1_000 },
        // Raised two seconds in, answered four minutes later, the turn ending a
        // second after that: three seconds of work inside four minutes of wall clock.
        { ...event(2, { type: 'bridge/interaction-requested', data: { interaction: interaction('approval') } }), timestamp: 3_000 },
        { ...event(3, { type: 'bridge/interaction-resolved', data: { interactionId: 'approval-1', outcome: 'allowed' } }), timestamp: 243_000 },
        {
          ...event(4, {
            type: 'bridge/tool-completed',
            data: {
              itemId: 't1',
              toolName: 'write',
              summary: 'wrote probe.txt',
              status: 'completed',
              detail: { input: '{}', output: 'ok', truncated: false },
            },
          }),
          timestamp: 243_500,
        },
        { ...event(5, { type: 'bridge/turn-completed', data: turn('completed', 244_000) }), timestamp: 244_000 },
      ],
      latestSequence: 5,
    }))
    renderPanel(fixture.remote())

    await screen.findByPlaceholderText(en['composer.placeholder'])
    // 243s of wall clock, 240s of it waiting on a person: the fold reports the 3s it
    // actually worked, and names the wait rather than absorbing it.
    expect(await screen.findByText('processed in 3.0s')).toBeTruthy()
    expect(screen.getByText('4m00s of it waiting on you')).toBeTruthy()
    expect(screen.queryByText('processed in 4m03s')).toBeNull()
  })

  it('reports a turn stopped on an open approval as waiting rather than working', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({
      session: { ...session, status: 'awaiting-approval' },
      pendingInteraction: interaction('approval'),
      events: [
        {
          ...event(1, {
            type: 'bridge/turn-started',
            data: {
              turn: {
                bridgeTurnId: 'turn-1',
                bridgeSessionId: 'session-1',
                status: 'running' as const,
                startedAt: 1_000,
                completedAt: null,
                stopReason: null,
              },
            },
          }),
          timestamp: 1_000,
        },
        {
          ...event(2, {
            type: 'bridge/tool-completed',
            data: {
              itemId: 't1',
              toolName: 'write',
              summary: 'wants to write probe.txt',
              status: 'completed',
              detail: { input: '{}', output: '', truncated: false },
            },
          }),
          timestamp: 1_500,
        },
        { ...event(3, { type: 'bridge/interaction-requested', data: { interaction: interaction('approval') } }), timestamp: 2_000 },
      ],
      latestSequence: 3,
    }))
    renderPanel(fixture.remote())

    // The readout says who is being waited on. "working" would be a lie: nothing is.
    expect(await screen.findByText(/waiting on you/)).toBeTruthy()
    expect(screen.queryByText(/^working /)).toBeNull()
  })


  it('docks a pending interaction outside the transcript and outside the view switch', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({
      session: { ...session, status: 'awaiting-approval' },
      pendingInteraction: interaction('approval'),
      events: [event(1, { type: 'bridge/text-delta', data: { text: 'a long transcript', itemId: 'a' } })],
      latestSequence: 1,
    }))
    renderPanel(fixture.remote())

    const allow = await screen.findByRole('button', { name: 'Allow once' })
    // Not inside the scrolling transcript. It used to open the stream, which on a
    // long one put the card asking for a decision off-screen above the single line
    // saying one was due.
    expect(allow.closest('.lab-stream')).toBeNull()
    expect(allow.closest('.lab-timeline')).toBeNull()
    expect(allow.closest('.lab-interaction-dock')).not.toBeNull()

    // And reachable from the trace, where it previously could be neither seen nor
    // answered while the turn it blocks sat waiting.
    fireEvent.click(screen.getByRole('tab', { name: en['view.trace'] }))
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeTruthy()
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
        token: '',
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
        token: '',
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
      expect(fixture.directoryAdd).toHaveBeenCalledWith({ token: '', path: '/host/projects/Fixture workspace' })
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
    await waitFor(() => { expect(fixture.directoryAdd).toHaveBeenCalledWith({ token: '', path: '/host/projects/private' }) })
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
      expect(fixture.directoryPublish).toHaveBeenCalledWith({ token: '', directoryId: 'workspace-1', published: true })
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
      expect(fixture.directoryPublish).toHaveBeenLastCalledWith({ token: '', directoryId: 'workspace-1', published: false })
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
      expect(fixture.directoryRemove).toHaveBeenCalledWith({ token: '', directoryId: 'workspace-1' })
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
    await waitFor(() => { expect(fixture.directoryAdd).toHaveBeenCalledWith({ token: '', path: '/host/projects' }) })
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
    await waitFor(() => { expect(fixture.directoryAdd).toHaveBeenCalledWith({ token: '', path: '/host/picked' }) })
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
      expect(fixture.sessionFiles).toHaveBeenCalledWith({ token: '', bridgeSessionId: 'session-1', query: 'main' })
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
      expect(fixture.sessionPermissionMode).toHaveBeenCalledWith({ token: '', bridgeSessionId: 'session-1', mode: 'bypass' })
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

  it('names the model the product resolved to instead of calling it a default', async () => {
    // Claude Code cannot enumerate its models until some session has run a turn, so
    // the picker is dead exactly when the turn that ran already knows the answer.
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.sessionModels.mockResolvedValue({ ok: true, value: { models: [], unavailable: true } })
    fixture.pushRead(snapshot({
      session: {
        ...session,
        model: null,
        contextUsage: { usedTokens: 1_000, maxTokens: 200_000, model: 'claude-opus-5' },
      },
      events: [],
      latestSequence: 0,
    }))
    renderPanel(fixture.remote())

    await screen.findByPlaceholderText(en['composer.placeholder'])
    expect(screen.getByText('claude-opus-5')).toBeTruthy()
    expect(screen.queryByText(en['model.default'])).toBeNull()
    cleanup()

    // Before any turn there is nothing to resolve, and guessing would be worse than
    // the generic answer.
    const fresh = new RemoteFixture()
    fresh.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fresh.sessionModels.mockResolvedValue({ ok: true, value: { models: [], unavailable: true } })
    fresh.pushRead(snapshot({
      session: { ...session, model: null, contextUsage: null },
      events: [],
      latestSequence: 0,
    }))
    renderPanel(fresh.remote())
    await screen.findByPlaceholderText(en['composer.placeholder'])
    expect(screen.getByText(en['model.default'])).toBeTruthy()
  })

  it('hands a session to the other product carrying the last ask, without sending it', async () => {
    const claude = {
      ...catalog.providers[0]!,
      id: 'claude' as const,
      displayName: 'Claude Code',
      version: '2.1.261',
    }
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.catalog.mockResolvedValue({ ok: true, value: { ...catalog, providers: [...catalog.providers, claude] } })
    fixture.pushRead(snapshot({
      events: [
        event(1, { type: 'bridge/user-message', data: { text: 'first ask', delivery: 'started' } }),
        event(2, { type: 'bridge/user-message', data: { text: 'the ask that got stuck', delivery: 'started' } }),
      ],
      latestSequence: 2,
    }))
    const handed: BridgeSessionView = { ...session, bridgeSessionId: 'session-2', providerId: 'claude', title: 'Claude Code - Fixture workspace' }
    fixture.sessionCreate.mockResolvedValue({ ok: true, value: handed })
    renderPanel(fixture.remote())

    await screen.findByText('the ask that got stuck')
    fireEvent.click(screen.getByRole('button', { name: /Hand to Claude Code/ }))

    // Same directory, the other product. A native session cannot be moved between
    // two separate processes, so this is a fresh one alongside.
    await waitFor(() => {
      expect(fixture.sessionCreate).toHaveBeenCalledWith({
        token: '',
        providerId: 'claude',
        workspaceId: session.workspaceId,
      })
    })

    // Carried into the composer, not sent: one click must not spend the other
    // product's allowance, and the prompt that got stuck is the one worth editing.
    const composer = await screen.findByPlaceholderText(en['composer.placeholder']) as HTMLTextAreaElement
    await waitFor(() => { expect(composer.value).toBe('the ask that got stuck') })
    expect(fixture.sessionSend).not.toHaveBeenCalled()
  })

  it('offers no handoff where there is nowhere to hand a session to', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({}))
    renderPanel(fixture.remote())

    // One product installed is the common case, and there the move would be a dead
    // button on every session.
    await screen.findByPlaceholderText(en['composer.placeholder'])
    expect(screen.queryByRole('button', { name: /Hand to/ })).toBeNull()
  })


  it('explains the resume route without making the reader open it', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({}))
    renderPanel(fixture.remote())

    // The one thing here neither vendor's own app can do, and it used to explain
    // itself only inside the sheet you had to already trust enough to open.
    expect(await screen.findByText(en['resume.hint'])).toBeTruthy()
    const resume = screen.getByRole('button', { name: en['resume.open'] })
    const create = screen.getByRole('button', { name: en['create.submit'] })
    // Two ways to start, sharing a row: not one action and its footnote.
    expect(resume.parentElement).toBe(create.parentElement)
  })


  it('opens a session with the facts a first prompt depends on', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({
      session: { ...session, permissionMode: 'manual' },
      events: [],
      latestSequence: 0,
    }))
    renderPanel(fixture.remote())

    const lead = await screen.findByText(en['opening.lead'])
    // Scoped to the card: the product name also sits in the new-session form on the
    // left, and that form describes the *next* session rather than this one — which
    // is the whole reason this session states its own.
    const opening = within(lead.parentElement as HTMLElement)
    expect(opening.getByText('Codex 0.147.0')).toBeTruthy()
    // Whether a tool call stops to ask is the difference between watching and
    // walking away, so the mode in force is stated rather than left to the toolbar.
    expect(opening.getByText(en['mode.manual'])).toBeTruthy()
    expect(opening.getByText(new RegExp(en['opening.slash']))).toBeTruthy()

    // And it is scaffolding, not transcript: the first turn replaces it.
    fixture.pushRead(snapshot({
      events: [event(1, { type: 'bridge/text-delta', data: { text: 'working', itemId: 'a' } })],
      latestSequence: 1,
    }))
    await screen.findByText('working')
    await waitFor(() => { expect(screen.queryByText(en['opening.lead'])).toBeNull() })
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

    // Counts are compacted so the status line stops resizing on every delta, and
    // each of the two numbers in that line says which question it answers — bare,
    // side by side, they read as one soup.
    expect(await screen.findByText('context 43k / 200k (21%)')).toBeTruthy()
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
    expect(await screen.findByText('context 900')).toBeTruthy()
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
      expect(fixture.sessionSend).toHaveBeenCalledWith({ token: '', bridgeSessionId: 'session-1', text: 'run the tests' })
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
      expect(fixture.sessionCancel).toHaveBeenCalledWith({ token: '', bridgeSessionId: 'session-1' })
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
    expect(fixture.nativeSessions).toHaveBeenCalledWith({ token: '', providerId: 'codex', workspaceId: 'workspace-1' })
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

    // findAllByText, because the agent's message is rendered as markdown and a
    // multi-line one becomes several elements. The assertion is that the redaction
    // marker is present and the canary is not, which follows below.
    await screen.findAllByText(/\[REDACTED\]/)
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
        token: '',
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
        token: '',
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
      expect(fixture.sessionFiles).toHaveBeenCalledWith({ token: '', bridgeSessionId: 'session-1', query: '' })
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

  it('omits dictation entirely unless the Profile asked for it', async () => {
    class FakeRecognition {
      lang = ''
      interimResults = false
      continuous = false
      onresult: ((event: unknown) => void) | null = null
      onerror: (() => void) | null = null
      onend: (() => void) | null = null
      start(): void {}
      stop(): void {}
      abort(): void {}
    }
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)

    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.catalog.mockResolvedValue({ ok: true, value: { ...catalog, dictation: false } })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    await screen.findByPlaceholderText(en['composer.placeholder'])
    // The browser can dictate; this Profile did not ask for it. The one route whose
    // audio leaves the machine is not offered unasked, so there is no button to warn
    // about — and nothing to explain away in a tooltip.
    expect(screen.queryByLabelText(en['dictate.start'])).toBeNull()
    vi.unstubAllGlobals()
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

    // The first press warns instead of starting: the audio is about to leave the
    // machine, and nothing else in this panel does that.
    fireEvent.click(screen.getByLabelText(en['dictate.start']))
    expect(FakeRecognition.last).toBeUndefined()
    expect(screen.getByText(en['dictate.warn.title'])).toBeTruthy()
    // And the confirm stays shut until the acknowledgement is actually ticked.
    expect((screen.getByRole('button', { name: en['dictate.warn.confirm'] }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByLabelText(en['dictate.warn.ack']))
    fireEvent.click(screen.getByRole('button', { name: en['dictate.warn.confirm'] }))

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
        token: '',
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
    await waitFor(() => { expect(fixture.hostList).toHaveBeenCalledWith({ token: '' }) })

    // Dot-prefixed entries stay hidden until asked for. `.ssh` is exactly the kind
    // of directory that should not be one stray click away.
    expect(screen.queryByText('.ssh/')).toBeNull()
    fireEvent.click(screen.getByLabelText(en['browse.showHidden']))
    expect(await screen.findByText('.ssh/')).toBeTruthy()

    // A directory opens rather than being referenced, so one click never means two
    // things.
    fireEvent.click(screen.getByText('Documents/'))
    await waitFor(() => {
      expect(fixture.hostList).toHaveBeenLastCalledWith({ token: '', path: '/Users/operator/Documents' })
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

  it('folds a finished turn’s work away, leaving the question and the answer', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({
      events: [
        { ...event(1, { type: 'bridge/user-message', data: { text: 'summarise the project', delivery: 'started' } }), timestamp: 1_000 },
        {
          ...event(2, {
            type: 'bridge/turn-started',
            data: {
              turn: {
                bridgeTurnId: 'turn-1',
                bridgeSessionId: 'session-1',
                status: 'running' as const,
                startedAt: 1_000,
                completedAt: null,
                stopReason: null,
              },
            },
          }),
          timestamp: 1_000,
        },
        // An opening remark, two tool calls, some thinking, then the real answer.
        { ...event(3, { type: 'bridge/text-delta', data: { text: 'I will start by looking around.', itemId: 'a' } }), timestamp: 1_500 },
        { ...event(4, { type: 'bridge/tool-completed', data: { itemId: 't1', toolName: 'Bash', summary: 'Bash completed', status: 'completed' } }), timestamp: 2_000 },
        { ...event(5, { type: 'bridge/tool-completed', data: { itemId: 't2', toolName: 'Read', summary: 'Read completed', status: 'completed' } }), timestamp: 3_000 },
        { ...event(6, { type: 'bridge/reasoning-delta', data: { text: 'weighing it up', itemId: 'r' } }), timestamp: 4_000 },
        { ...event(7, { type: 'bridge/text-delta', data: { text: 'Here is the summary.', itemId: 'b' } }), timestamp: 5_000 },
        {
          ...event(8, {
            type: 'bridge/turn-completed',
            data: {
              turn: {
                bridgeTurnId: 'turn-1',
                bridgeSessionId: 'session-1',
                status: 'completed' as const,
                startedAt: 1_000,
                completedAt: 464_000,
                stopReason: 'completed',
              },
            },
          }),
          timestamp: 464_000,
        },
      ],
      latestSequence: 8,
    }))
    renderPanel(fixture.remote())

    // Three layers: the question, a summary of the work, the answer.
    expect(await screen.findByText('summarise the project')).toBeTruthy()
    expect(screen.getByText('Here is the summary.')).toBeTruthy()
    // 463 seconds between the turn's two events.
    const toggle = screen.getByRole('button', { name: /7m43s/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    // Four steps folded away: the opening remark, two tools, and the thinking.
    expect(screen.getByText(en['turn.steps'].replace('{count}', '4'))).toBeTruthy()
    expect(screen.queryByText('I will start by looking around.')).toBeNull()
    expect(screen.queryByText('Bash completed')).toBeNull()
    expect(screen.queryByText('weighing it up')).toBeNull()

    fireEvent.click(toggle)
    expect(await screen.findByText('I will start by looking around.')).toBeTruthy()
    expect(screen.getByText('Bash completed')).toBeTruthy()
    expect(screen.getByText('Read completed')).toBeTruthy()
    expect(screen.getByText('weighing it up')).toBeTruthy()
    // Order preserved: the remark came before the tools, and a row key sorts as a
    // string, so this would break if the work were reassembled by key.
    const shown = [...document.querySelectorAll('.lab-turn-work .lab-row-card')]
      .map(card => card.textContent ?? '')
    expect(shown[0]).toContain('I will start by looking around.')
    expect(shown.at(-1)).toContain('weighing it up')
  })

  it('keeps a running turn’s work open, and counts up while it runs', async () => {
    const fixture = new RemoteFixture()
    const running = { ...session, status: 'running' as const }
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [running] })
    fixture.pushRead(snapshot({
      session: running,
      events: [
        {
          ...event(1, {
            type: 'bridge/turn-started',
            data: {
              turn: {
                bridgeTurnId: 'turn-1',
                bridgeSessionId: 'session-1',
                status: 'running' as const,
                startedAt: Date.now(),
                completedAt: null,
                stopReason: null,
              },
            },
          }),
          timestamp: Date.now(),
        },
        event(2, { type: 'bridge/tool-completed', data: { itemId: 't1', toolName: 'Bash', summary: 'Bash completed', status: 'completed' } }),
      ],
      latestSequence: 2,
    }))
    renderPanel(fixture.remote())

    // Open while it runs, because that is when watching the work is the point.
    expect(await screen.findByText('Bash completed')).toBeTruthy()
    const toggle = screen.getByRole('button', { name: new RegExp(en['turn.working'].replace('{value}', '')) })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    // And a fold the operator sets themselves survives: having opened the work to
    // read it, they should not have it shut under them when the turn completes.
    fireEvent.click(toggle)
    await waitFor(() => { expect(screen.queryByText('Bash completed')).toBeNull() })
  })

  it('never folds an error away, even though it belongs to a turn', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({
      events: [
        event(1, { type: 'bridge/tool-completed', data: { itemId: 't1', toolName: 'Bash', summary: 'Bash completed', status: 'completed' } }),
        event(2, { type: 'bridge/error', data: { code: 'PROVIDER_PROTOCOL_ERROR', message: 'bad frame' } }),
        event(3, { type: 'bridge/text-delta', data: { text: 'recovered', itemId: 'a' } }),
      ],
      latestSequence: 3,
    }))
    renderPanel(fixture.remote())

    // A failure is an outcome, not part of the work that led to it. Folding it would
    // hide the one row the operator most needs.
    expect(await screen.findByText(en['error.PROVIDER_PROTOCOL_ERROR'])).toBeTruthy()
  })

  it('keeps status rows for what needs acting on, and drops the routine ones', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({
      events: [
        event(1, { type: 'bridge/session-status', data: { status: 'running', note: null } }),
        event(2, { type: 'bridge/session-status', data: { status: 'idle', note: null } }),
        event(3, { type: 'bridge/session-status', data: { status: 'orphaned', note: 'host-restarted-orphaned' } }),
        event(4, { type: 'bridge/session-status', data: { status: 'auth-required', note: null } }),
      ],
      latestSequence: 4,
    }))
    renderPanel(fixture.remote())

    // Scoped to the transcript: the sidebar's session row carries a status chip of
    // its own, and it is not what this is about. Awaited because the panel now
    // waits for the Host to say whether a password is set before rendering itself.
    await waitFor(() => { expect(document.querySelector('.lab-stream')).not.toBeNull() })
    const transcript = document.querySelector('.lab-stream') as HTMLElement
    // A state the operator has to do something about keeps its row.
    expect(await within(transcript).findByText(en['status.orphaned'])).toBeTruthy()
    expect(within(transcript).getByText(en['status.auth-required'])).toBeTruthy()
    // The ordinary rhythm of a turn does not: the toolbar shows it live, and two
    // rows between every question and its answer is the noise the grouping removes.
    expect(within(transcript).queryByText(en['status.running'])).toBeNull()
    expect(within(transcript).queryByText(en['status.idle'])).toBeNull()
  })

  it('still reports a routine status that carries a note', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({
      events: [event(1, {
        type: 'bridge/session-status',
        data: { status: 'idle', note: 'host-restarted-resumable' },
      })],
      latestSequence: 1,
    }))
    renderPanel(fixture.remote())

    // A note by definition says something the status word does not, so the row
    // survives even though the status itself is routine.
    expect(await screen.findByText(en['note.host-restarted-resumable'])).toBeTruthy()
  })

  it('takes an image from a paste and sends it with the message', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    const composer = await screen.findByPlaceholderText(en['composer.placeholder']) as HTMLTextAreaElement
    const png = new File([Uint8Array.from([137, 80, 78, 71])], 'shot.png', { type: 'image/png' })
    fireEvent.paste(composer, {
      clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => png }] },
    })

    // A thumbnail while it waits, so the operator can see what they attached.
    const thumb = await screen.findByAltText('shot.png')
    expect(thumb.getAttribute('src')).toContain('blob:')

    fireEvent.change(composer, { target: { value: 'what is this' } })
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en['composer.send']) }))

    await waitFor(() => {
      expect(fixture.sessionSend).toHaveBeenCalledWith({
        token: '',
        bridgeSessionId: 'session-1',
        text: 'what is this',
        images: [{
          mediaType: 'image/png',
          dataBase64: Buffer.from(Uint8Array.from([137, 80, 78, 71])).toString('base64'),
          name: 'shot.png',
        }],
      })
    })
    // Cleared after sending, so the next message does not carry it again.
    await waitFor(() => { expect(screen.queryByAltText('shot.png')).toBeNull() })
  })

  it('sends an image with no text at all', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    const composer = await screen.findByPlaceholderText(en['composer.placeholder']) as HTMLTextAreaElement
    const png = new File([Uint8Array.from([137, 80])], 'only.png', { type: 'image/png' })
    fireEvent.paste(composer, {
      clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => png }] },
    })
    await screen.findByAltText('only.png')

    // The picture is the question. Send must not be disabled just because the text
    // box is empty.
    const button = screen.getByRole('button', { name: new RegExp(en['composer.send']) }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    await waitFor(() => { expect(fixture.sessionSend).toHaveBeenCalled() })
  })

  it('lets a text paste through untouched', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    const composer = await screen.findByPlaceholderText(en['composer.placeholder']) as HTMLTextAreaElement
    const prevented = !fireEvent.paste(composer, {
      clipboardData: { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] },
    })
    // Not claimed: a paste of text that happens to come from an image editor still
    // has to land in the textarea.
    expect(prevented).toBe(false)
  })

  it('drops a pending image without sending it', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    const composer = await screen.findByPlaceholderText(en['composer.placeholder']) as HTMLTextAreaElement
    fireEvent.paste(composer, {
      clipboardData: {
        items: [{
          kind: 'file',
          type: 'image/png',
          getAsFile: () => new File([Uint8Array.from([1])], 'wrong.png', { type: 'image/png' }),
        }],
      },
    })
    await screen.findByAltText('wrong.png')

    fireEvent.click(screen.getByLabelText(en['image.remove']))
    await waitFor(() => { expect(screen.queryByAltText('wrong.png')).toBeNull() })
    expect(fixture.sessionSend).not.toHaveBeenCalled()
  })

  it('opens the side panel and shows the project’s files', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())

    await screen.findByPlaceholderText(en['composer.placeholder'])
    // Closed by default: the panel costs the conversation nothing until asked for.
    expect(screen.queryByPlaceholderText(en['files.filter'])).toBeNull()

    fireEvent.click(screen.getByLabelText(en['panel.showSide']))
    await waitFor(() => { expect(fixture.workspaceList).toHaveBeenCalledWith({ token: '', bridgeSessionId: 'session-1', path: '' }) })

    // Directories first, and a dotfile hidden until asked for.
    expect(await screen.findByText('src')).toBeTruthy()
    expect(screen.getByText('README.md')).toBeTruthy()
    expect(screen.queryByText('.env.example')).toBeNull()

    // Reading a file shows it with its size and path.
    fireEvent.click(screen.getByText('README.md'))
    await waitFor(() => {
      expect(fixture.workspaceFile).toHaveBeenCalledWith({ token: '', bridgeSessionId: 'session-1', path: 'README.md' })
    })
    expect(await screen.findByText(/answer = 42/)).toBeTruthy()
  })

  it('reads a directory only when it is opened', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())
    await screen.findByPlaceholderText(en['composer.placeholder'])
    fireEvent.click(screen.getByLabelText(en['panel.showSide']))
    await screen.findByText('src')

    // Lazily: a tree that eagerly walked a monorepo would be Host work nobody
    // asked for.
    expect(fixture.workspaceList).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('src'))
    await waitFor(() => {
      expect(fixture.workspaceList).toHaveBeenLastCalledWith({ token: '', bridgeSessionId: 'session-1', path: 'src' })
    })
    expect(await screen.findByText('main.ts')).toBeTruthy()
  })

  it('says a file is binary rather than rendering it', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.workspaceList.mockResolvedValue({
      ok: true,
      value: {
        path: '',
        entries: [{ name: 'logo.png', path: 'logo.png', directory: false, hidden: false, bytes: 2_048 }],
        truncated: false,
      },
    })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())
    await screen.findByPlaceholderText(en['composer.placeholder'])
    fireEvent.click(screen.getByLabelText(en['panel.showSide']))

    fireEvent.click(await screen.findByText('logo.png'))
    // Better than a screenful of replacement characters.
    expect(await screen.findByText(en['files.binary'])).toBeTruthy()
  })

  it('edits a file and writes it back at the revision it was opened at', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())
    await screen.findByPlaceholderText(en['composer.placeholder'])
    fireEvent.click(screen.getByLabelText(en['panel.showSide']))
    fireEvent.click(await screen.findByText('README.md'))
    await screen.findByText(/answer = 42/)

    fireEvent.click(screen.getByLabelText(en['files.edit']))
    const editor = screen.getByDisplayValue(/answer = 42/) as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: 'export const answer = 43\n' } })
    fireEvent.click(screen.getByLabelText(en['files.save']))

    // The revision goes back with the write, so the Host can refuse one that would
    // overwrite a change the agent made in the meantime.
    await waitFor(() => {
      expect(fixture.workspaceWrite).toHaveBeenCalledWith({
        token: '',
        bridgeSessionId: 'session-1',
        path: 'README.md',
        content: 'export const answer = 43\n',
        revision: 'r1',
      })
    })
    // Back to the highlighted view once saved.
    await waitFor(() => { expect(screen.queryByDisplayValue(/answer = 43/)).toBeNull() })
  })

  it('explains a stale write by checking whether the file moved, not by decoding a code', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.workspaceWrite.mockResolvedValue({
      ok: false,
      error: { code: 'whatever-the-transport-says', message: 'refused' },
    } as never)
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())
    await screen.findByPlaceholderText(en['composer.placeholder'])
    fireEvent.click(screen.getByLabelText(en['panel.showSide']))
    fireEvent.click(await screen.findByText('README.md'))
    await screen.findByText(/answer = 42/)
    fireEvent.click(screen.getByLabelText(en['files.edit']))

    // The agent got there first: the same path now reads at a different revision.
    fixture.workspaceFile.mockResolvedValue({
      ok: true,
      value: { path: 'README.md', revision: 'r2', content: 'the agent wrote this', bytes: 20, truncated: false, binary: false },
    })
    fireEvent.click(screen.getByLabelText(en['files.save']))

    // Deliberately not matched on the failure's code — that is the transport's, not
    // the Host's — so the conclusion comes from the revision having moved.
    expect(await screen.findByText(en['files.stale'])).toBeTruthy()
  })

  it('says a write simply failed when the file did not move', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.workspaceWrite.mockResolvedValue({
      ok: false,
      error: { code: 'whatever', message: 'no' },
    } as never)
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())
    await screen.findByPlaceholderText(en['composer.placeholder'])
    fireEvent.click(screen.getByLabelText(en['panel.showSide']))
    fireEvent.click(await screen.findByText('README.md'))
    await screen.findByText(/answer = 42/)
    fireEvent.click(screen.getByLabelText(en['files.edit']))
    fireEvent.click(screen.getByLabelText(en['files.save']))

    // Same revision, so this was not a conflict — a permission problem, or writes
    // turned off. Saying "the agent changed it" would be a guess.
    expect(await screen.findByText(en['files.writeFailed'])).toBeTruthy()
  })

  it('creates, renames and deletes through the tree', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())
    await screen.findByPlaceholderText(en['composer.placeholder'])
    fireEvent.click(screen.getByLabelText(en['panel.showSide']))
    await screen.findByText('src')

    // Into a directory the operator has open, named where they can see it.
    fireEvent.click(screen.getByLabelText(en['files.newIn'].replace('{name}', 'src')))
    fireEvent.change(screen.getByPlaceholderText(en['files.nameIt']), { target: { value: 'extra.ts' } })
    fireEvent.click(screen.getByLabelText(en['files.confirm']))
    await waitFor(() => {
      expect(fixture.workspaceCreate).toHaveBeenCalledWith({
        token: '',
        bridgeSessionId: 'session-1',
        path: 'src/extra.ts',
        directory: false,
      })
    })

    fireEvent.click(screen.getByLabelText(en['files.rename'].replace('{name}', 'README.md')))
    fireEvent.change(screen.getByPlaceholderText(en['files.renameTo']), { target: { value: 'READ.md' } })
    fireEvent.click(screen.getByLabelText(en['files.confirm']))
    await waitFor(() => {
      expect(fixture.workspaceRename).toHaveBeenCalledWith({
        token: '',
        bridgeSessionId: 'session-1',
        from: 'README.md',
        to: 'READ.md',
      })
    })

    fireEvent.click(screen.getByLabelText(en['files.delete'].replace('{name}', 'README.md')))
    await waitFor(() => {
      expect(fixture.workspaceDelete).toHaveBeenCalledWith({ token: '', bridgeSessionId: 'session-1', path: 'README.md' })
    })
  })

  it('offers no file controls when the Profile does not serve writes', async () => {
    const fixture = new RemoteFixture()
    fixture.catalog.mockResolvedValue({ ok: true, value: { ...catalog, workspaceWrites: false } })
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())
    await screen.findByPlaceholderText(en['composer.placeholder'])
    fireEvent.click(screen.getByLabelText(en['panel.showSide']))
    fireEvent.click(await screen.findByText('README.md'))
    await screen.findByText(/answer = 42/)

    // Absent rather than disabled: a control that cannot work should not be offered.
    expect(screen.queryByLabelText(en['files.edit'])).toBeNull()
    expect(screen.queryByLabelText(en['files.newFile'])).toBeNull()
    expect(screen.queryByLabelText(en['files.delete'].replace('{name}', 'README.md'))).toBeNull()
  })

  it('will not offer to edit a file it only partly read', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.workspaceFile.mockResolvedValue({
      ok: true,
      value: { path: 'huge.txt', revision: 'r1', content: 'first part', bytes: 900_000, truncated: true, binary: false },
    })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())
    await screen.findByPlaceholderText(en['composer.placeholder'])
    fireEvent.click(screen.getByLabelText(en['panel.showSide']))
    fireEvent.click(await screen.findByText('README.md'))
    await screen.findByText(en['files.cut'])

    // Saving would write the part that was shown over the whole file.
    expect((screen.getByLabelText(en['files.edit']) as HTMLButtonElement).disabled).toBe(true)
  })

  it('lists uncommitted changes and shows one file’s diff', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())
    await screen.findByPlaceholderText(en['composer.placeholder'])
    fireEvent.click(screen.getByLabelText(en['panel.showSide']))
    fireEvent.click(await screen.findByRole('tab', { name: en['side.diff'] }))

    await waitFor(() => { expect(fixture.workspaceDiff).toHaveBeenCalledWith({ token: '', bridgeSessionId: 'session-1' }) })
    expect(await screen.findByText('src/main.ts')).toBeTruthy()
    expect(screen.getByText(en['diff.counts'].replace('{added}', '2').replace('{removed}', '1'))).toBeTruthy()
    // Untracked files are listed but flagged: they have no older version to compare.
    expect(screen.getByText(en['diff.untrackedTag'])).toBeTruthy()

    fireEvent.click(screen.getByText('src/main.ts'))
    await waitFor(() => {
      expect(fixture.workspaceFileDiff).toHaveBeenCalledWith({ token: '', bridgeSessionId: 'session-1', path: 'src/main.ts' })
    })
    expect(await screen.findByText('@@ -1,3 +1,4 @@')).toBeTruthy()
    expect(screen.getByText('const second = 22')).toBeTruthy()
  })

  it('switches between unified and side-by-side', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())
    await screen.findByPlaceholderText(en['composer.placeholder'])
    fireEvent.click(screen.getByLabelText(en['panel.showSide']))
    fireEvent.click(await screen.findByRole('tab', { name: en['side.diff'] }))
    fireEvent.click(await screen.findByText('src/main.ts'))
    await screen.findByText('@@ -1,3 +1,4 @@')

    // Unified is git's own order: one line per line.
    expect(document.querySelectorAll('.lab-diff-line')).toHaveLength(4)
    expect(document.querySelectorAll('.lab-diff-row')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: en['diff.split'] }))
    // Paired: the removal and the addition that replaced it share a row, and the
    // second addition gets a row with an empty left side. Three rows, not four.
    await waitFor(() => { expect(document.querySelectorAll('.lab-diff-row')).toHaveLength(3) })
    expect(document.querySelectorAll('.lab-diff-side--empty')).toHaveLength(1)
  })

  it('explains an untracked or binary change instead of fetching a diff for it', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())
    await screen.findByPlaceholderText(en['composer.placeholder'])
    fireEvent.click(screen.getByLabelText(en['panel.showSide']))
    fireEvent.click(await screen.findByRole('tab', { name: en['side.diff'] }))

    fireEvent.click(await screen.findByText('notes.txt'))
    expect(await screen.findByText(en['diff.untracked'])).toBeTruthy()

    fireEvent.click(screen.getByText('logo.png'))
    expect(await screen.findByText(en['diff.binary'])).toBeTruthy()

    // Neither has anything to fetch, and asking would be a round trip whose answer is
    // already known.
    expect(fixture.workspaceFileDiff).not.toHaveBeenCalled()
  })

  it('says when there is no repository to diff', async () => {
    const fixture = new RemoteFixture()
    fixture.sessionsList.mockResolvedValue({ ok: true, value: [session] })
    fixture.workspaceDiff.mockResolvedValue({ ok: true, value: { entries: [], unavailable: true } })
    fixture.pushRead(snapshot({ events: [], latestSequence: 0 }))
    renderPanel(fixture.remote())
    await screen.findByPlaceholderText(en['composer.placeholder'])
    fireEvent.click(screen.getByLabelText(en['panel.showSide']))
    fireEvent.click(await screen.findByRole('tab', { name: en['side.diff'] }))

    expect(await screen.findByText(en['diff.unavailable'])).toBeTruthy()
  })
})
