import { describe, expect, it } from 'vitest'
import type { BridgePersistence, PersistedBridgeSession } from '../../src/core/persistence.ts'
import type { NativeProviderAdapter, ProviderTurnRequest } from '../../src/core/provider.ts'
import { credentialLeakMarkers } from '../../src/core/redaction.ts'
import { BridgeSessionEngine } from '../../src/core/session-engine.ts'
import { FakeProviderAdapter } from '../../src/providers/fake.ts'
import type { BridgeEvent, BridgeSessionReadResult, ProviderId } from '../../src/types.ts'

class MemoryPersistence {
  private readonly records = new Map<string, PersistedBridgeSession>()

  constructor(seed: readonly PersistedBridgeSession[] = []) {
    for (const record of seed) this.records.set(record.bridgeSessionId, structuredClone(record))
  }

  list(): PersistedBridgeSession[] {
    return [...this.records.values()].map(record => structuredClone(record))
  }

  async put(record: PersistedBridgeSession): Promise<void> {
    this.records.set(record.bridgeSessionId, structuredClone(record))
  }

  async close(): Promise<void> {}

  snapshot(bridgeSessionId: string): PersistedBridgeSession {
    const record = this.records.get(bridgeSessionId)
    if (record === undefined) throw new Error(`missing record ${bridgeSessionId}`)
    return structuredClone(record)
  }
}

const workspace = {
  id: 'workspace-1',
  title: 'Fixture workspace',
  cwd: process.cwd(),
  status: 'ok' as const,
}

function asPersistence(memory: MemoryPersistence): BridgePersistence {
  return memory as unknown as BridgePersistence
}

/**
 * A turn that reports its interruption the way the real vendor products do:
 * the transport dies and the surfaced error carries no cancellation marker.
 * The Claude Agent SDK and the Codex App Server both behave this way, so a
 * classifier that reads the error text alone cannot tell this apart from a
 * genuine startup failure. Only the abort signal can.
 */
class OpaqueCancellationAdapter implements NativeProviderAdapter {
  readonly id = 'fake' as const
  readonly supportsSteer = false
  private readonly active = new Map<string, AbortController>()

  async startTurn({ hooks }: ProviderTurnRequest): Promise<void> {
    const controller = new AbortController()
    this.active.set(hooks.bridgeSessionId, controller)
    hooks.signal.addEventListener('abort', () => { controller.abort() }, { once: true })
    await hooks.setNativeSessionLocator(`opaque-${hooks.bridgeSessionId}`)
    await hooks.emit({ type: 'bridge/text-delta', data: { text: 'working', itemId: 'answer' } })
    try {
      await new Promise<void>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new Error('Claude Code process exited with code 143'))
        }, { once: true })
      })
    } finally {
      this.active.delete(hooks.bridgeSessionId)
    }
  }

  async steer(): Promise<void> {
    throw new Error('not supported')
  }

  async cancel(bridgeSessionId: string): Promise<void> {
    this.active.get(bridgeSessionId)?.abort()
  }

  async disposeSession(bridgeSessionId: string): Promise<void> {
    await this.cancel(bridgeSessionId)
  }

  async dispose(): Promise<void> {}
}

async function createOpaqueEngine() {
  const memory = new MemoryPersistence()
  const providers = new Map<ProviderId, NativeProviderAdapter>([['fake', new OpaqueCancellationAdapter()]])
  const engine = await BridgeSessionEngine.create({
    persistence: asPersistence(memory),
    providers,
    resolveWorkspace: async id => id === workspace.id ? workspace : undefined,
    longPollMaxMs: 100,
  })
  return { engine, memory }
}

async function createEngine(memory = new MemoryPersistence(), eventRetention?: number) {
  const fake = new FakeProviderAdapter()
  const providers = new Map<ProviderId, FakeProviderAdapter>([['fake', fake]])
  const engine = await BridgeSessionEngine.create({
    persistence: asPersistence(memory),
    providers,
    resolveWorkspace: async id => id === workspace.id ? workspace : undefined,
    longPollMaxMs: 100,
    ...(eventRetention === undefined ? {} : { eventRetention }),
  })
  return { engine, fake, memory }
}

async function waitFor(
  engine: BridgeSessionEngine,
  bridgeSessionId: string,
  predicate: (result: BridgeSessionReadResult) => boolean,
  timeoutMs = 5_000,
): Promise<BridgeSessionReadResult> {
  const deadline = Date.now() + timeoutMs
  let last = await engine.read({ bridgeSessionId })
  while (!predicate(last)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for session ${bridgeSessionId}`)
    last = await engine.read({
      bridgeSessionId,
      afterSequence: last.latestSequence,
      waitMs: 50,
    })
    const full = await engine.read({ bridgeSessionId })
    last = full
  }
  return last
}

function eventsOf<Type extends BridgeEvent['type']>(
  result: BridgeSessionReadResult,
  type: Type,
): Extract<BridgeEvent, { readonly type: Type }>[] {
  return result.events.filter(
    (event): event is Extract<BridgeEvent, { readonly type: Type }> => event.type === type,
  )
}

describe('BridgeSessionEngine with FakeProviderAdapter', () => {
  it('runs three durable streaming turns and supports incremental reads and archive state', async () => {
    const { engine, memory } = await createEngine()
    const session = await engine.createSession({ providerId: 'fake', workspaceId: workspace.id })

    for (const text of ['first', 'second', 'third']) {
      const sent = await engine.send(session.bridgeSessionId, text)
      expect(sent.delivery).toBe('started')
      expect(sent.bridgeTurnId).toMatch(/^[0-9a-f-]{36}$/)
      await waitFor(engine, session.bridgeSessionId, result => result.session.status === 'idle')
    }

    const full = await engine.read({ bridgeSessionId: session.bridgeSessionId })
    expect(eventsOf(full, 'bridge/turn-started')).toHaveLength(3)
    expect(eventsOf(full, 'bridge/turn-completed')).toHaveLength(3)
    expect(eventsOf(full, 'bridge/text-delta').length).toBeGreaterThan(3)
    expect(full.events.map(event => event.sequence)).toEqual(
      Array.from({ length: full.events.length }, (_, index) => index + 1),
    )
    expect(memory.snapshot(session.bridgeSessionId).nativeSessionLocator).toBe(`fake-${session.bridgeSessionId}`)

    const pivot = full.events[Math.floor(full.events.length / 2)]?.sequence ?? 0
    const incremental = await engine.read({ bridgeSessionId: session.bridgeSessionId, afterSequence: pivot })
    expect(incremental.reset).toBe(false)
    expect(incremental.events.every(event => event.sequence > pivot)).toBe(true)

    expect((await engine.archiveSession(session.bridgeSessionId)).archived).toBe(true)
    expect(engine.list()).toEqual([])
    expect(engine.list(true)).toHaveLength(1)
    await engine.dispose()
  })

  it('names a session after its first ask, and leaves a given name alone', async () => {
    const { engine, memory } = await createEngine()
    const session = await engine.createSession({ providerId: 'fake', workspaceId: workspace.id })
    // Until something is said, every session in one directory shares one title.
    expect(session.title).toBe('Fixture - Fixture workspace')

    await engine.send(session.bridgeSessionId, 'explain the retry policy')
    await waitFor(engine, session.bridgeSessionId, result => result.session.status === 'idle')
    expect(memory.snapshot(session.bridgeSessionId).title).toBe('explain the retry policy')

    // Only the first ask names it; the second must not rename it under the operator.
    await engine.send(session.bridgeSessionId, 'now do the same for timeouts')
    await waitFor(engine, session.bridgeSessionId, result => result.session.status === 'idle')
    expect(memory.snapshot(session.bridgeSessionId).title).toBe('explain the retry policy')

    // A title given at creation is the operator's, and outranks the first ask.
    const named = await engine.createSession({ providerId: 'fake', workspaceId: workspace.id, title: 'Retry work' })
    await engine.send(named.bridgeSessionId, 'explain the retry policy')
    await waitFor(engine, named.bridgeSessionId, result => result.session.status === 'idle')
    expect(memory.snapshot(named.bridgeSessionId).title).toBe('Retry work')
    await engine.dispose()
  })

  it('takes a session title from prose, cut to a row, and never from a bare attachment', async () => {
    const { engine, memory } = await createEngine()

    const long = await engine.createSession({ providerId: 'fake', workspaceId: workspace.id })
    await engine.send(long.bridgeSessionId, 'a'.repeat(200))
    await waitFor(engine, long.bridgeSessionId, result => result.session.status === 'idle')
    const cut = memory.snapshot(long.bridgeSessionId).title
    expect(cut).toHaveLength(60)
    expect(cut.endsWith('…')).toBe(true)

    // An input that is nothing but appended image references has no ask in it, so the
    // placeholder is better than a path — and the next real ask still gets to name it.
    const attached = await engine.createSession({ providerId: 'fake', workspaceId: workspace.id })
    await engine.send(attached.bridgeSessionId, '@.dsh-bridge-uploads/shot.png')
    await waitFor(engine, attached.bridgeSessionId, result => result.session.status === 'idle')
    expect(memory.snapshot(attached.bridgeSessionId).title).toBe('Fixture - Fixture workspace')
    await engine.send(attached.bridgeSessionId, 'what is in that screenshot')
    await waitFor(engine, attached.bridgeSessionId, result => result.session.status === 'idle')
    expect(memory.snapshot(attached.bridgeSessionId).title).toBe('what is in that screenshot')
    await engine.dispose()
  })


  it('removes credential canaries before events or persisted records cross the Host boundary', async () => {
    const { engine, memory } = await createEngine()
    const session = await engine.createSession({ providerId: 'fake', workspaceId: workspace.id })
    const bearerCanary = 'bridgeBearerCanary987654321'
    const apiKeyCanary = 'bridgeApiKeyCanary987654321'
    const deviceCanary = 'WXYZ-9876-ABCD'
    const credentialFileCanary = 'bridge-auth-canary.json'
    const raw = [
      `Authorization: Bearer ${bearerCanary}`,
      `api_key=sk-${apiKeyCanary}`,
      `https://claude.ai/oauth/authorize?device=${deviceCanary}`,
      `C:\\Users\\fixture\\.codex\\${credentialFileCanary}`,
    ].join('\n')

    await engine.send(session.bridgeSessionId, raw)
    const result = await waitFor(engine, session.bridgeSessionId, value => value.session.status === 'idle')
    const eventPayload = JSON.stringify(result)
    const persistedPayload = JSON.stringify(memory.snapshot(session.bridgeSessionId))

    for (const canary of [bearerCanary, apiKeyCanary, deviceCanary, credentialFileCanary]) {
      expect(eventPayload).not.toContain(canary)
      expect(persistedPayload).not.toContain(canary)
    }
    expect(eventPayload).toContain('[REDACTED]')
    expect(persistedPayload).toContain('[REDACTED]')
    expect(credentialLeakMarkers(eventPayload)).toEqual([])
    expect(credentialLeakMarkers(persistedPayload)).toEqual([])
    await engine.dispose()
  })

  it('queues Claude-style input behind an active turn and drains it automatically', async () => {
    const { engine } = await createEngine()
    const session = await engine.createSession({ providerId: 'fake', workspaceId: workspace.id })
    const first = await engine.send(session.bridgeSessionId, 'a deliberately longer first message')
    const queued = await engine.send(session.bridgeSessionId, 'queued second message')

    expect(first.delivery).toBe('started')
    expect(queued.delivery).toBe('queued')
    expect(queued.bridgeTurnId).toMatch(/^[0-9a-f-]{36}$/)

    const result = await waitFor(
      engine,
      session.bridgeSessionId,
      value => value.session.status === 'idle' && eventsOf(value, 'bridge/turn-completed').length === 2,
    )
    expect(result.session.queuedInputCount).toBe(0)
    expect(eventsOf(result, 'bridge/user-message').filter(event => event.data.delivery === 'queued')).toHaveLength(1)
    expect(eventsOf(result, 'bridge/user-message').filter(event => event.data.delivery === 'started')).toHaveLength(2)
    await engine.dispose()
  })

  it('round-trips approvals and questions without persisting standing permission', async () => {
    const { engine } = await createEngine()
    const session = await engine.createSession({ providerId: 'fake', workspaceId: workspace.id })

    await engine.send(session.bridgeSessionId, 'approve this fixture')
    const approval = await waitFor(engine, session.bridgeSessionId, result => result.session.status === 'awaiting-approval')
    expect(approval.pendingInteraction?.kind).toBe('approval')
    await engine.respondInteraction({
      bridgeSessionId: session.bridgeSessionId,
      interactionId: approval.pendingInteraction?.interactionId ?? '',
      resolution: { kind: 'approval', action: 'allow' },
    })
    await waitFor(engine, session.bridgeSessionId, result => result.session.status === 'idle')

    await engine.send(session.bridgeSessionId, 'question for the fixture')
    const question = await waitFor(engine, session.bridgeSessionId, result => result.session.status === 'awaiting-answer')
    expect(question.pendingInteraction?.questions[0]?.id).toBe('mode')
    await engine.respondInteraction({
      bridgeSessionId: session.bridgeSessionId,
      interactionId: question.pendingInteraction?.interactionId ?? '',
      resolution: { kind: 'question', answers: { mode: ['fast'] } },
    })
    const done = await waitFor(engine, session.bridgeSessionId, result => result.session.status === 'idle')
    expect(eventsOf(done, 'bridge/interaction-resolved').map(event => event.data.outcome)).toEqual([
      'allowed',
      'answered',
    ])
    expect(done.pendingInteraction).toBeNull()
    await engine.dispose()
  })

  it('cancels an active interaction exactly once and expires later responses', async () => {
    const { engine } = await createEngine()
    const session = await engine.createSession({ providerId: 'fake', workspaceId: workspace.id })
    await engine.send(session.bridgeSessionId, 'approve then cancel')
    const waiting = await waitFor(engine, session.bridgeSessionId, result => result.session.status === 'awaiting-approval')
    const interactionId = waiting.pendingInteraction?.interactionId ?? ''

    await engine.cancel(session.bridgeSessionId)
    const result = await waitFor(engine, session.bridgeSessionId, value => value.session.status === 'idle')
    const resolutions = eventsOf(result, 'bridge/interaction-resolved')
      .filter(event => event.data.interactionId === interactionId)
    expect(resolutions).toHaveLength(1)
    expect(resolutions[0]?.data.outcome).toBe('cancelled')
    const completed = eventsOf(result, 'bridge/turn-completed').at(-1)
    expect(completed?.data.turn.status).toBe('cancelled')
    await expect(engine.respondInteraction({
      bridgeSessionId: session.bridgeSessionId,
      interactionId,
      resolution: { kind: 'approval', action: 'allow' },
    })).rejects.toMatchObject({ code: 'INTERACTION_EXPIRED' })
    await engine.dispose()
  })

  it('reports a cancelled turn as USER_CANCELLED even when the product hides the reason', async () => {
    const { engine } = await createOpaqueEngine()
    const session = await engine.createSession({ providerId: 'fake', workspaceId: workspace.id })
    await engine.send(session.bridgeSessionId, 'start a long turn')
    await waitFor(engine, session.bridgeSessionId, result => result.session.status === 'running')

    await engine.cancel(session.bridgeSessionId)
    const result = await waitFor(engine, session.bridgeSessionId, value => value.session.status === 'idle')

    const errors = eventsOf(result, 'bridge/error')
    expect(errors).toHaveLength(1)
    expect(errors[0]?.data.code).toBe('USER_CANCELLED')
    expect(errors[0]?.data.message).not.toMatch(/could not be started/i)

    // Status transitions carry a code, never Host-composed prose: the browser
    // phrases them in its own locale. `cancelling` explains itself with a note;
    // the terminal `idle` carries none, because the error row above already
    // named the cause and repeating it produced two rows saying one thing.
    const statuses = eventsOf(result, 'bridge/session-status')
    expect(statuses.map(item => [item.data.status, item.data.note])).toEqual(
      expect.arrayContaining([['cancelling', 'cancelling-turn'], ['idle', null]]),
    )
    for (const status of statuses) expect(status.data).not.toHaveProperty('message')
    expect(eventsOf(result, 'bridge/turn-completed').at(-1)?.data.turn).toMatchObject({
      status: 'cancelled',
      stopReason: 'USER_CANCELLED',
    })
    expect(result.session.status).toBe('idle')
    await engine.dispose()
  })

  it('seeds a resumed native locator so the product continues instead of starting fresh', async () => {
    const { engine, memory } = await createEngine()
    const session = await engine.createSession({
      providerId: 'fake',
      workspaceId: workspace.id,
      resumeLocator: 'native-session-from-a-terminal',
    })

    // Present from creation, before any turn: this is what the provider hands to
    // the product's own resume path on the first message.
    expect(memory.snapshot(session.bridgeSessionId).nativeSessionLocator)
      .toBe('native-session-from-a-terminal')

    await engine.send(session.bridgeSessionId, 'continue where we left off')
    await waitFor(engine, session.bridgeSessionId, result => result.session.status === 'idle')

    // The fake provider only assigns a locator when it finds none, so an
    // unchanged value proves the seeded one was the one used.
    expect(memory.snapshot(session.bridgeSessionId).nativeSessionLocator)
      .toBe('native-session-from-a-terminal')
    await engine.dispose()
  })

  it('starts a session with no locator when no resume was requested', async () => {
    const { engine, memory } = await createEngine()
    const session = await engine.createSession({ providerId: 'fake', workspaceId: workspace.id })
    expect(memory.snapshot(session.bridgeSessionId).nativeSessionLocator).toBeNull()

    await engine.send(session.bridgeSessionId, 'first message')
    await waitFor(engine, session.bridgeSessionId, result => result.session.status === 'idle')

    // The provider captured its own, which is the pre-existing behaviour.
    expect(memory.snapshot(session.bridgeSessionId).nativeSessionLocator)
      .toBe(`fake-${session.bridgeSessionId}`)
    await engine.dispose()
  })

  it('marks retained-history gaps as reset', async () => {
    const { engine } = await createEngine(new MemoryPersistence(), 5)
    const session = await engine.createSession({ providerId: 'fake', workspaceId: workspace.id })
    await engine.send(session.bridgeSessionId, 'produce enough stream chunks for retention')
    await waitFor(engine, session.bridgeSessionId, result => result.session.status === 'idle')
    const result = await engine.read({ bridgeSessionId: session.bridgeSessionId, afterSequence: 0 })
    expect(result.reset).toBe(true)
    expect(result.events).toHaveLength(5)
    await engine.dispose()
  })

  it('recovers interrupted turns after a host restart and expires browser interactions', async () => {
    const original = await createEngine()
    const session = await original.engine.createSession({ providerId: 'fake', workspaceId: workspace.id })
    await original.engine.send(session.bridgeSessionId, 'approve and hold for restart')
    const waiting = await waitFor(
      original.engine,
      session.bridgeSessionId,
      result => result.session.status === 'awaiting-approval',
    )
    const persistedDuringTurn = original.memory.snapshot(session.bridgeSessionId)

    await original.engine.cancel(session.bridgeSessionId)
    await waitFor(original.engine, session.bridgeSessionId, result => result.session.status === 'idle')
    await original.engine.dispose()

    const restartedMemory = new MemoryPersistence([persistedDuringTurn])
    const restarted = await createEngine(restartedMemory)
    const recovered = await restarted.engine.read({ bridgeSessionId: session.bridgeSessionId })
    expect(recovered.session.status).toBe('idle')
    expect(recovered.pendingInteraction).toBeNull()
    expect(eventsOf(recovered, 'bridge/interaction-resolved').at(-1)?.data.outcome).toBe('expired')
    expect(eventsOf(recovered, 'bridge/turn-completed').at(-1)?.data.turn).toMatchObject({
      status: 'cancelled',
      stopReason: 'CONNECTION_LOST',
    })
    expect(recovered.events.at(-1)).toMatchObject({
      type: 'bridge/session-status',
      // A locator was captured before the restart, so this session is resumable
      // and says so through a code rather than an English sentence.
      data: { status: 'idle', note: 'host-restarted-resumable' },
    })

    const restartedAgain = await createEngine(new MemoryPersistence([restartedMemory.snapshot(session.bridgeSessionId)]))
    const stable = await restartedAgain.engine.read({ bridgeSessionId: session.bridgeSessionId })
    expect(eventsOf(stable, 'bridge/turn-completed')).toHaveLength(1)
    await restarted.engine.dispose()
    await restartedAgain.engine.dispose()
    expect(waiting.pendingInteraction).not.toBeNull()
  })
})

describe('resumed history', () => {
  /**
   * A provider that reports a transcript, the way both real adapters do after
   * reading it back through their product's own API.
   */
  class HistoryAdapter implements NativeProviderAdapter {
    readonly id = 'fake' as const
    readonly supportsSteer = false
    readonly asked: { locator: string; cwd: string }[] = []

    constructor(private readonly entries: number, private readonly clipped = false) {}

    async readHistory(locator: string, cwd: string) {
      this.asked.push({ locator, cwd })
      return {
        events: Array.from({ length: this.entries }, (_unused, index) => ({
          type: 'bridge/user-message' as const,
          data: { text: `entry ${index}`, delivery: 'started' as const },
        })),
        truncated: this.clipped,
      }
    }

    async startTurn(): Promise<void> {}
    async steer(): Promise<void> {}
    async cancel(): Promise<void> {}
    async disposeSession(): Promise<void> {}
    async dispose(): Promise<void> {}
  }

  async function engineWith(adapter: NativeProviderAdapter, eventRetention?: number) {
    const memory = new MemoryPersistence()
    return await BridgeSessionEngine.create({
      persistence: asPersistence(memory),
      providers: new Map<ProviderId, NativeProviderAdapter>([['fake', adapter]]),
      resolveWorkspace: async id => id === workspace.id ? workspace : undefined,
      longPollMaxMs: 100,
      ...eventRetention === undefined ? {} : { eventRetention },
    })
  }

  it('replays the product’s transcript into a resumed session, and marks where it ends', async () => {
    const adapter = new HistoryAdapter(3)
    const engine = await engineWith(adapter)
    const created = await engine.createSession({
      providerId: 'fake',
      workspaceId: workspace.id,
      resumeLocator: 'native-42',
    })

    // The adapter is asked with the product's own locator and the Host-resolved
    // working directory; the browser supplies neither.
    expect(adapter.asked).toEqual([{ locator: 'native-42', cwd: workspace.cwd }])

    const result = await engine.read({ bridgeSessionId: created.bridgeSessionId })
    const texts = result.events
      .filter(entry => entry.type === 'bridge/user-message')
      .map(entry => (entry.data as { text: string }).text)
    expect(texts).toEqual(['entry 0', 'entry 1', 'entry 2'])

    // History events belong to no bridge turn, because the turns that produced
    // them were the product's.
    for (const entry of result.events.filter(item => item.type === 'bridge/user-message')) {
      expect(entry.bridgeTurnId).toBeNull()
    }

    const marker = result.events.find(entry => entry.type === 'bridge/history')
    expect(marker?.data).toEqual({ restored: 3, truncated: false })
    // And it comes last, so the line falls between the old conversation and
    // whatever this session does next.
    expect(result.events.at(-1)?.type).toBe('bridge/history')
    await engine.dispose()
  })

  it('keeps the end of a long transcript and says the rest was dropped', async () => {
    // Retention 10 leaves room for 5 history events, so the newest 5 of 8 survive:
    // the end of a conversation is what a reader needs in order to continue it.
    const engine = await engineWith(new HistoryAdapter(8), 10)
    const created = await engine.createSession({
      providerId: 'fake',
      workspaceId: workspace.id,
      resumeLocator: 'native-long',
    })

    const result = await engine.read({ bridgeSessionId: created.bridgeSessionId })
    const texts = result.events
      .filter(entry => entry.type === 'bridge/user-message')
      .map(entry => (entry.data as { text: string }).text)
    expect(texts).toEqual(['entry 3', 'entry 4', 'entry 5', 'entry 6', 'entry 7'])
    expect(result.events.find(entry => entry.type === 'bridge/history')?.data)
      .toEqual({ restored: 5, truncated: true })
    await engine.dispose()
  })

  it('keeps the newest events when the adapter itself returns more than fits', async () => {
    // Two ceilings apply — the adapter's and the engine's — and both must keep the
    // end. The engine's is exercised here; the adapters' is the same slice, and the
    // combination is what puts the *recent* conversation on screen rather than the
    // opening of a long one.
    const engine = await engineWith(new HistoryAdapter(6), 4)
    const created = await engine.createSession({
      providerId: 'fake',
      workspaceId: workspace.id,
      resumeLocator: 'native-tail',
    })
    const result = await engine.read({ bridgeSessionId: created.bridgeSessionId })
    const texts = result.events
      .filter(entry => entry.type === 'bridge/user-message')
      .map(entry => (entry.data as { text: string }).text)
    expect(texts).toEqual(['entry 4', 'entry 5'])
    await engine.dispose()
  })

  it('repeats the adapter’s own report that a transcript arrived clipped', async () => {
    // The engine cannot infer this: a transcript trimmed to exactly the adapter's
    // ceiling looks identical to one that happened to be that length. Six events
    // fit in a retention of 100, so only the adapter's report can be the reason
    // this says truncated.
    const engine = await engineWith(new HistoryAdapter(6, true), 100)
    const created = await engine.createSession({
      providerId: 'fake',
      workspaceId: workspace.id,
      resumeLocator: 'native-clipped',
    })
    const result = await engine.read({ bridgeSessionId: created.bridgeSessionId })
    expect(result.events.find(entry => entry.type === 'bridge/history')?.data)
      .toEqual({ restored: 6, truncated: true })
    await engine.dispose()
  })

  it('reads no history for a session that is not resuming anything', async () => {
    const adapter = new HistoryAdapter(3)
    const engine = await engineWith(adapter)
    const created = await engine.createSession({ providerId: 'fake', workspaceId: workspace.id })

    expect(adapter.asked).toEqual([])
    const result = await engine.read({ bridgeSessionId: created.bridgeSessionId })
    expect(result.events.some(entry => entry.type === 'bridge/history')).toBe(false)
    await engine.dispose()
  })

  it('still creates the session when the transcript cannot be read', async () => {
    class FailingHistory extends HistoryAdapter {
      override async readHistory(): Promise<never> {
        throw new Error('transcript gone')
      }
    }

    const engine = await engineWith(new FailingHistory(0))
    // A history that cannot be read is a cosmetic loss; the resume it belongs to
    // still works, and failing here would make a usable session look broken.
    const created = await engine.createSession({
      providerId: 'fake',
      workspaceId: workspace.id,
      resumeLocator: 'native-broken',
    })
    expect(created.bridgeSessionId).toBeTruthy()
    const result = await engine.read({ bridgeSessionId: created.bridgeSessionId })
    expect(result.events.some(entry => entry.type === 'bridge/history')).toBe(false)
    await engine.dispose()
  })

  it('creates a session against a provider that cannot read transcripts at all', async () => {
    // FakeProviderAdapter has no readHistory; an optional reader that is absent
    // must not be a reason to fail a resume.
    const engine = await engineWith(new FakeProviderAdapter())
    const created = await engine.createSession({
      providerId: 'fake',
      workspaceId: workspace.id,
      resumeLocator: 'native-none',
    })
    const result = await engine.read({ bridgeSessionId: created.bridgeSessionId })
    expect(result.events.some(entry => entry.type === 'bridge/history')).toBe(false)
    await engine.dispose()
  })
})
