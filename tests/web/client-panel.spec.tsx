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

function renderPanel(remote: LocalAgentRemote): void {
  const props = { wide: true, remote } as unknown as Parameters<typeof LocalAgentPanel>[0]
  render(<LocalAgentPanel {...props} />)
  fireEvent.click(screen.getByTitle('Local Agents'))
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
    fireEvent.change(screen.getByPlaceholderText('Send to the native agent on the host...'), {
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
