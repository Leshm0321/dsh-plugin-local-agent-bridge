import { PassThrough } from 'node:stream'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import type {
  BridgeEventDraft,
  ProviderInteractionRequest,
  ProviderInteractionResolution,
  ProviderTurnHooks,
} from '../../src/core/provider.ts'
import type {
  SubprocessHandle,
  SubprocessRuntime,
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import type { BridgeContextUsage, BridgeRateLimit, BridgeTokenUsage } from '../../src/types.ts'
import { describe, expect, it } from 'vitest'
import { CodexProviderAdapter } from '../../src/providers/codex.ts'

type JsonObject = Record<string, unknown>

interface RecordedRequest {
  readonly method: string
  readonly params: JsonObject
}

class FakeCodexProcess {
  readonly clientInput = new PassThrough()
  readonly clientOutput = new PassThrough()
  readonly server = new JsonRpcLineTransport(this.clientInput, this.clientOutput)
  readonly requests: RecordedRequest[] = []
  readonly doneState = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
  readonly handle: SubprocessHandle
  activeThreadId: string | null = null
  activeTurnId: string | null = null
  terminated = false

  constructor(
    private readonly runtime: FakeCodexRuntime,
    readonly spec: SubprocessSpawnSpec,
  ) {
    this.server.onRequest(async (method, params) => {
      this.requests.push({ method, params })
      return await this.handleRequest(method, params)
    })
    this.server.start()
    this.handle = {
      stdin: this.clientInput,
      stdout: this.clientOutput,
      stderr: undefined,
      control: undefined,
      collected: {},
      done: this.doneState.promise,
      terminate: () => { this.exit('SIGTERM') },
      waitForExit: async () => {
        if (!this.terminated) this.exit('SIGTERM')
        await this.doneState.promise
        return true
      },
    }
  }

  complete(status: 'completed' | 'interrupted' = 'completed'): void {
    if (this.activeThreadId === null || this.activeTurnId === null) return
    this.server.notify('turn/completed', {
      threadId: this.activeThreadId,
      turn: turn(this.activeTurnId, status),
    })
  }

  exit(signal: NodeJS.Signals | null = null): void {
    if (this.terminated) return
    this.terminated = true
    this.server.close()
    this.clientInput.end()
    this.clientOutput.end()
    this.doneState.resolve({ exitCode: signal === null ? 0 : null, signal })
  }

  private async handleRequest(method: string, params: JsonObject): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return { userAgent: 'fake-codex-app-server' }
      case 'thread/start': {
        const threadId = `thread-${String(++this.runtime.threadCount)}`
        this.activeThreadId = threadId
        return { thread: { id: threadId } }
      }
      case 'thread/resume': {
        const threadId = String(params.threadId)
        this.activeThreadId = threadId
        return { thread: { id: threadId } }
      }
      case 'turn/start': {
        const threadId = String(params.threadId)
        const turnId = `turn-${String(++this.runtime.turnCount)}`
        const input = params.input as Array<{ text?: string }>
        const text = input[0]?.text ?? ''
        this.activeThreadId = threadId
        this.activeTurnId = turnId
        setTimeout(() => { void this.runTurn(threadId, turnId, text) }, 0)
        return { turn: turn(turnId, 'inProgress') }
      }
      case 'turn/steer':
        return { turnId: this.activeTurnId }
      case 'turn/interrupt':
        setTimeout(() => { this.complete('interrupted') }, 0)
        return {}
      default:
        throw new Error(`unexpected fake Codex request: ${method}`)
    }
  }

  private async runTurn(threadId: string, turnId: string, text: string): Promise<void> {
    this.server.notify('turn/started', { threadId, turn: turn(turnId, 'inProgress') })
    this.server.notify('future/unknown-notification', { threadId, turnId })

    if (/approval/i.test(text)) {
      const response = await this.server.request('item/commandExecution/requestApproval', {
        threadId,
        turnId,
        itemId: 'approval-command',
        startedAtMs: Date.now(),
        command: 'echo approved',
        cwd: process.cwd(),
        reason: 'Run the integration fixture.',
      })
      this.runtime.serverResponses.push({ method: 'approval', params: response as JsonObject })
    }

    if (/verification/i.test(text)) {
      // The mode 0.155.1 added: a device-authenticated approval, carrying a
      // challenge and a title and — unlike every other mode — no `message` and no
      // `requestedSchema`.
      const response = await this.server.request('mcpServer/elicitation/request', {
        threadId,
        turnId: null,
        serverName: 'fixture-mcp',
        mode: 'openai/userVerification',
        title: 'Verify this device',
        description: 'Sign the challenge to prove this device is yours.',
        challenge: 'fixture-challenge',
      })
      this.runtime.serverResponses.push({ method: 'verification', params: response as JsonObject })
    }

    if (/aliasform/i.test(text)) {
      // `openaiForm` is the alias 0.155.1 added beside `openai/form`.
      const response = await this.server.request('mcpServer/elicitation/request', {
        threadId,
        turnId: null,
        serverName: 'fixture-mcp',
        message: 'Alias mode still renders.',
        mode: 'openaiForm',
        requestedSchema: {
          type: 'object',
          properties: { colour: { type: 'string', title: 'Colour', enum: ['red'] } },
        },
      })
      this.runtime.serverResponses.push({ method: 'aliasform', params: response as JsonObject })
    }

    if (/yesno/i.test(text)) {
      // The shape Codex sends to gate an MCP tool call: nothing to fill in.
      const response = await this.server.request('mcpServer/elicitation/request', {
        threadId,
        turnId: null,
        serverName: 'fixture-mcp',
        message: 'Allow the fixture server to run a tool?',
        mode: 'form',
        requestedSchema: { type: 'object', properties: {} },
      })
      this.runtime.serverResponses.push({ method: 'yesno', params: response as JsonObject })
    }

    if (/elicitform/i.test(text)) {
      const response = await this.server.request('mcpServer/elicitation/request', {
        threadId,
        turnId: null,
        serverName: 'fixture-mcp',
        message: 'The fixture needs an answer.',
        mode: 'form',
        requestedSchema: {
          type: 'object',
          properties: { colour: { type: 'string', title: 'Colour', enum: ['red', 'blue'] } },
        },
      })
      this.runtime.serverResponses.push({ method: 'elicitform', params: response as JsonObject })
    }

    if (/question/i.test(text)) {
      const response = await this.server.request('item/tool/requestUserInput', {
        threadId,
        turnId,
        itemId: 'question-item',
        isBlocking: true,
        questions: [{
          id: 'mode',
          header: 'Mode',
          question: 'Which mode?',
          isOther: true,
          isSecret: false,
          options: [{ label: 'Fast', description: 'Short verification' }],
        }],
      })
      this.runtime.serverResponses.push({ method: 'question', params: response as JsonObject })
    }

    this.server.notify('item/reasoning/summaryTextDelta', {
      threadId,
      turnId,
      itemId: 'reasoning-1',
      summaryIndex: 0,
      delta: 'Considering the fixture. ',
    })
    this.server.notify('item/agentMessage/delta', {
      threadId,
      turnId,
      itemId: 'message-1',
      delta: 'Codex fixture response.',
    })
    this.server.notify('item/started', {
      threadId,
      turnId,
      startedAtMs: Date.now(),
      item: {
        id: 'command-1',
        type: 'commandExecution',
        command: 'echo fixture',
        commandActions: [],
        cwd: process.cwd(),
        status: 'inProgress',
      },
    })
    this.server.notify('item/completed', {
      threadId,
      turnId,
      completedAtMs: Date.now(),
      item: {
        id: 'command-1',
        type: 'commandExecution',
        command: 'echo fixture',
        commandActions: [],
        cwd: process.cwd(),
        status: 'completed',
      },
    })
    this.server.notify('item/completed', {
      threadId,
      turnId,
      completedAtMs: Date.now(),
      item: {
        id: 'file-1',
        type: 'fileChange',
        status: 'completed',
        changes: [{ path: 'fixture.txt', diff: '+fixture', kind: { type: 'update', move_path: null } }],
      },
    })
    if (!/hold/i.test(text)) this.complete()
  }
}

class FakeCodexRuntime {
  readonly processes: FakeCodexProcess[] = []
  readonly serverResponses: RecordedRequest[] = []
  threadCount = 0
  turnCount = 0

  readonly subprocess = {
    spawn: (spec: SubprocessSpawnSpec): SubprocessHandle => {
      const process = new FakeCodexProcess(this, spec)
      this.processes.push(process)
      return process.handle
    },
  } as unknown as SubprocessRuntime

  latest(): FakeCodexProcess {
    const process = this.processes.at(-1)
    if (process === undefined) throw new Error('Codex process was not spawned')
    return process
  }
}

function turn(id: string, status: 'completed' | 'interrupted' | 'failed' | 'inProgress') {
  return { id, items: [], status, error: null }
}

function createHooks(options: {
  readonly nativeSessionLocator?: string | null
  readonly resolveInteraction?: (request: ProviderInteractionRequest) => ProviderInteractionResolution
  readonly model?: string
  readonly effort?: string
} = {}) {
  const events: BridgeEventDraft[] = []
  const locators: string[] = []
  const usages: BridgeContextUsage[] = []
  const limits: BridgeRateLimit[] = []
  const tokens: BridgeTokenUsage[] = []
  const interactions: ProviderInteractionRequest[] = []
  const controller = new AbortController()
  const hooks: ProviderTurnHooks = {
    bridgeSessionId: 'bridge-session-1',
    bridgeTurnId: 'bridge-turn-1',
    cwd: process.cwd(),
    nativeSessionLocator: options.nativeSessionLocator ?? null,
    permissionMode: 'auto',
    model: options.model ?? null,
    effort: options.effort ?? null,
    signal: controller.signal,
    emit: async event => { events.push(event) },
    setNativeSessionLocator: async locator => { locators.push(locator) },
    reportContextUsage: async usage => { usages.push(usage) },
    reportRateLimit: async limit => { limits.push(limit) },
    reportTokenUsage: async usage => { tokens.push(usage) },
    requestInteraction: async request => {
      interactions.push(request)
      return options.resolveInteraction?.(request)
        ?? (request.kind === 'approval'
          ? { kind: 'approval', action: 'allow' }
          : { kind: 'question', answers: { mode: ['Fast'] } })
    },
  }
  return { controller, events, hooks, interactions, limits, locators, tokens, usages }
}

async function nextTask(): Promise<void> {
  await new Promise<void>(resolve => { setTimeout(resolve, 10) })
}

describe('CodexProviderAdapter', () => {
  it('runs the official App Server lifecycle and projects validated notifications', async () => {
    const runtime = new FakeCodexRuntime()
    const adapter = new CodexProviderAdapter(runtime.subprocess, 'codex')
    const harness = createHooks()

    await adapter.startTurn({ text: 'normal turn', images: [], hooks: harness.hooks })

    const process = runtime.latest()
    expect(process.spec.argv).toEqual(['codex', 'app-server', '--stdio'])
    expect(process.requests.map(request => request.method)).toEqual([
      'initialize',
      'thread/start',
      'turn/start',
    ])
    expect(harness.locators).toEqual(['thread-1'])
    expect(harness.events.map(event => event.type)).toEqual(expect.arrayContaining([
      'bridge/reasoning-delta',
      'bridge/text-delta',
      'bridge/tool-started',
      'bridge/tool-completed',
      'bridge/file-change',
    ]))
    await adapter.dispose()
    expect(process.terminated).toBe(true)
  })

  it('maps command approvals and user questions to one-turn browser interactions', async () => {
    const runtime = new FakeCodexRuntime()
    const adapter = new CodexProviderAdapter(runtime.subprocess, 'codex')
    const harness = createHooks()

    await adapter.startTurn({ text: 'approval and question', images: [], hooks: harness.hooks })

    expect(harness.interactions.map(item => item.kind)).toEqual(['approval', 'question'])
    expect(harness.interactions[0]).toMatchObject({ toolName: 'shell', target: 'echo approved' })
    expect(harness.interactions[1]?.questions[0]).toMatchObject({ id: 'mode', allowFreeText: true })
    expect(runtime.serverResponses).toEqual([
      { method: 'approval', params: { decision: 'accept' } },
      { method: 'question', params: { answers: { mode: { answers: ['Fast'] } } } },
    ])
    await adapter.dispose()
  })

  it('marks request-user-input as something no refusal can be sent for', async () => {
    const runtime = new FakeCodexRuntime()
    const adapter = new CodexProviderAdapter(runtime.subprocess, 'codex')
    const harness = createHooks()
    await adapter.startTurn({ text: 'question', images: [], hooks: harness.hooks })

    // The response schema is `{ answers }` with no field for a refusal, so the
    // panel must not offer one. Every other prompt can carry it.
    expect(harness.interactions[0]).toMatchObject({ toolName: 'request-user-input', refusable: false })
    await adapter.dispose()
  })

  it('declines an elicitation mode it cannot render rather than failing the turn', async () => {
    const runtime = new FakeCodexRuntime()
    const adapter = new CodexProviderAdapter(runtime.subprocess, 'codex')
    const harness = createHooks()
    await adapter.startTurn({ text: 'verification', images: [], hooks: harness.hooks })

    // A device-authenticated approval is the same category as a `url` elicitation —
    // an authentication flow this bridge does not forward to a browser. It also
    // carries no schema, so reaching for one turned an unknown mode into a protocol
    // error that failed the session.
    expect(harness.interactions).toEqual([])
    expect(runtime.serverResponses).toEqual([{ method: 'verification', params: { action: 'decline', content: null, _meta: null } }])
    await adapter.dispose()
  })

  it('renders the alias form mode the same as the one it aliases', async () => {
    const runtime = new FakeCodexRuntime()
    const adapter = new CodexProviderAdapter(runtime.subprocess, 'codex')
    const harness = createHooks({
      resolveInteraction: () => ({ kind: 'question', answers: { colour: ['red'] } }),
    })
    await adapter.startTurn({ text: 'aliasform', images: [], hooks: harness.hooks })

    expect(harness.interactions.map(item => item.kind)).toEqual(['question'])
    expect(harness.interactions[0]?.questions[0]?.options.map(o => o.value)).toEqual(['red'])
    expect(runtime.serverResponses[0]?.params).toMatchObject({ action: 'accept' })
    await adapter.dispose()
  })

  it('asks a fieldless elicitation as an approval, so it can be refused', async () => {
    // Codex sends this shape to gate every MCP tool call. Asked as a question it
    // drew a card with a message, no fields and a lone Submit — nothing to answer,
    // no way to say no, and the reply was `accept` whatever the operator did.
    for (const [action, expected] of [['allow', 'accept'], ['deny', 'decline'], ['cancel', 'cancel']] as const) {
      const runtime = new FakeCodexRuntime()
      const adapter = new CodexProviderAdapter(runtime.subprocess, 'codex')
      const harness = createHooks({
        resolveInteraction: () => ({ kind: 'approval', action }),
      })
      await adapter.startTurn({ text: 'yesno', images: [], hooks: harness.hooks })

      expect(harness.interactions.map(item => item.kind)).toEqual(['approval'])
      expect(harness.interactions[0]?.questions).toEqual([])
      expect(harness.interactions[0]).toMatchObject({ toolName: 'mcp:fixture-mcp', target: 'fixture-mcp' })
      expect(runtime.serverResponses).toEqual([{ method: 'yesno', params: { action: expected, content: null, _meta: null } }])
      await adapter.dispose()
    }
  })

  it('carries a refused form back as a decline, not an accept with blanks', async () => {
    const runtime = new FakeCodexRuntime()
    const adapter = new CodexProviderAdapter(runtime.subprocess, 'codex')
    const harness = createHooks({
      resolveInteraction: () => ({ kind: 'question', answers: {}, declined: true }),
    })
    await adapter.startTurn({ text: 'elicitform', images: [], hooks: harness.hooks })

    // A form with fields stays a question — but refusing it is a thing the server
    // is told, because an empty answer is a value it would act on.
    expect(harness.interactions.map(item => item.kind)).toEqual(['question'])
    expect(harness.interactions[0]?.questions[0]).toMatchObject({ id: 'colour', allowFreeText: false })
    expect(runtime.serverResponses).toEqual([{ method: 'elicitform', params: { action: 'decline', content: null, _meta: null } }])
    await adapter.dispose()
  })

  it('answers a form elicitation from the schema the server asked with', async () => {
    const runtime = new FakeCodexRuntime()
    const adapter = new CodexProviderAdapter(runtime.subprocess, 'codex')
    const harness = createHooks({
      resolveInteraction: () => ({ kind: 'question', answers: { colour: ['blue'] } }),
    })
    await adapter.startTurn({ text: 'elicitform', images: [], hooks: harness.hooks })

    // The enum became options rather than a free-text field, and the answer goes
    // back under the property id the server named.
    expect(harness.interactions[0]?.questions[0]?.options.map(o => o.value)).toEqual(['red', 'blue'])
    expect(runtime.serverResponses[0]?.params).toMatchObject({ action: 'accept' })
    await adapter.dispose()
  })


  it('steers and interrupts an active turn', async () => {
    const runtime = new FakeCodexRuntime()
    const adapter = new CodexProviderAdapter(runtime.subprocess, 'codex')
    const harness = createHooks()
    const active = adapter.startTurn({ text: 'hold this turn', images: [], hooks: harness.hooks })
    await nextTask()

    await adapter.steer(harness.hooks.bridgeSessionId, 'steered input')
    const steer = runtime.latest().requests.find(request => request.method === 'turn/steer')
    expect(steer?.params).toMatchObject({
      threadId: 'thread-1',
      expectedTurnId: 'turn-1',
    })

    await adapter.cancel(harness.hooks.bridgeSessionId)
    await expect(active).rejects.toMatchObject({ code: 'USER_CANCELLED' })
    expect(runtime.latest().requests.some(request => request.method === 'turn/interrupt')).toBe(true)
    await adapter.dispose()
  })

  it('resumes an existing thread and rejects every account login request', async () => {
    const runtime = new FakeCodexRuntime()
    const adapter = new CodexProviderAdapter(runtime.subprocess, 'codex')
    const harness = createHooks({ nativeSessionLocator: 'thread-existing' })
    const active = adapter.startTurn({ text: 'hold resumed turn', images: [], hooks: harness.hooks })
    await nextTask()

    const resume = runtime.latest().requests.find(request => request.method === 'thread/resume')
    expect(resume?.params).toMatchObject({ threadId: 'thread-existing', excludeTurns: true })
    expect(harness.locators).toEqual([])
    await expect(runtime.latest().server.request('account/login/start', {
      provider: 'openai',
    })).rejects.toThrow(/unsupported login flow/i)

    runtime.latest().complete()
    await active
    await adapter.dispose()
  })
})
