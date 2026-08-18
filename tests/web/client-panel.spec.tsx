/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconArchiveOutline20: () => null,
  IconCloseOutline16: () => null,
  IconCodeOutline16: () => null,
  IconRefreshOutline16: () => null,
  IconSendOutline16: () => null,
  IconStopFill16: () => null,
}))

import { en, zh } from '../../src/client/locales.ts'
import {
  inject,
  LocalAgentPanel,
  type LocalAgentRemote,
} from '../../src/client/index.tsx'
import type {
  BridgeCatalogResult,
  BridgeEvent,
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
}

const catalog: BridgeCatalogResult = {
  providers: [{
    id: 'codex',
    displayName: 'Codex',
    installed: true,
    version: '0.147.0',
    supportedRange: '0.147.x',
    compatibility: 'supported',
    health: 'ready',
    message: null,
  }],
  workspaces: [{ id: 'workspace-1', title: 'Fixture workspace', status: 'ok' }],
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
  readonly sessionCreate = vi.fn(async () => ({ ok: true as const, value: session }))
  readonly sessionSend = vi.fn(async () => ({
    ok: true as const,
    value: { delivery: 'started' as const, bridgeTurnId: 'turn-1' },
  }))
  readonly sessionCancel = vi.fn(async () => ({ ok: true as const, value: undefined }))
  readonly sessionArchive = vi.fn(async () => ({ ok: true as const, value: { ...session, archived: true } }))
  readonly interactionRespond = vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } }))
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
  readonly createWorkspace?: (path: string) => Promise<void>
  readonly pickDirectory?: () => Promise<string | null>
}

function renderPanel(remote: LocalAgentRemote, options: RenderOptions = {}): void {
  const locale = options.locale ?? 'en'
  const t = translator(locale)
  const props = {
    wide: true,
    remote,
    t,
    workspaces: {
      create: options.createWorkspace ?? (async () => {}),
      ...options.pickDirectory === undefined ? {} : { pick: options.pickDirectory },
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
        providers: [
          {
            id: 'codex',
            displayName: 'Codex',
            installed: true,
            version: '0.144.6',
            supportedRange: '0.147.x',
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
      value: { providers: catalog.providers, workspaces: [] },
    })
    const created: string[] = []
    renderPanel(fixture.remote(), {
      createWorkspace: async (path) => { created.push(path) },
    })

    // An empty registry says so, and Create session stays unavailable.
    expect(await screen.findByText(en['workspace.empty'])).toBeTruthy()
    expect((screen.getByRole('button', { name: en['create.submit'] }) as HTMLButtonElement).disabled).toBe(true)

    // The next catalog read reflects the registration the Host just accepted.
    fixture.catalog.mockResolvedValue({
      ok: true,
      value: {
        providers: catalog.providers,
        workspaces: [{ id: 'workspace-1', title: 'Fixture workspace', status: 'ok' }],
      },
    })
    fireEvent.change(screen.getByPlaceholderText(en['workspace.path.placeholder']), {
      target: { value: '  /host/projects/Fixture workspace  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: en['workspace.add.submit'] }))

    // Surrounding whitespace is trimmed before the path reaches the Host.
    await waitFor(() => { expect(created).toEqual(['/host/projects/Fixture workspace']) })
    // The new workspace is selected, so the operator can create a session next.
    await waitFor(() => {
      expect((screen.getByRole('button', { name: en['create.submit'] }) as HTMLButtonElement).disabled).toBe(false)
    })
  })

  it('offers the directory chooser only when the Profile composed one', async () => {
    const withoutPicker = new RemoteFixture()
    renderPanel(withoutPicker.remote())
    expect(await screen.findByText(en['workspace.add'])).toBeTruthy()
    expect(screen.queryByRole('button', { name: en['workspace.browse'] })).toBeNull()
    cleanup()

    const withPicker = new RemoteFixture()
    const created: string[] = []
    renderPanel(withPicker.remote(), {
      pickDirectory: async () => '/host/picked',
      createWorkspace: async (path) => { created.push(path) },
    })
    fireEvent.click(await screen.findByRole('button', { name: en['workspace.browse'] }))
    await waitFor(() => { expect(created).toEqual(['/host/picked']) })
  })

  it('leaves the registry untouched when the chooser is cancelled', async () => {
    const fixture = new RemoteFixture()
    const created: string[] = []
    renderPanel(fixture.remote(), {
      pickDirectory: async () => null,
      createWorkspace: async (path) => { created.push(path) },
    })
    fireEvent.click(await screen.findByRole('button', { name: en['workspace.browse'] }))
    await waitFor(() => { expect(fixture.catalog.mock.calls.length).toBeGreaterThan(0) })
    expect(created).toEqual([])
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
})
