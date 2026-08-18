import { PassThrough } from 'node:stream'
import type {
  ElicitationRequest,
  Options,
  Query,
  SDKMessage,
  SpawnOptions,
} from '@anthropic-ai/claude-agent-sdk'
import type {
  SubprocessHandle,
  SubprocessRuntime,
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  BridgeEventDraft,
  ProviderInteractionRequest,
  ProviderInteractionResolution,
  ProviderTurnHooks,
} from '../../src/core/provider.ts'

const sdk = vi.hoisted(() => ({ query: vi.fn() }))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: sdk.query }))

import { ClaudeProviderAdapter } from '../../src/providers/claude.ts'

interface QueryInput {
  readonly prompt: string
  readonly options: Options
}

class FakeClaudeRuntime {
  readonly specs: SubprocessSpawnSpec[] = []
  readonly handles: Array<SubprocessHandle & { readonly terminateMock: ReturnType<typeof vi.fn> }> = []

  readonly subprocess = {
    spawn: (spec: SubprocessSpawnSpec): SubprocessHandle => {
      this.specs.push(spec)
      const stdin = new PassThrough()
      const stdout = new PassThrough()
      const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
      let settled = false
      const terminateMock = vi.fn(() => {
        if (settled) return
        settled = true
        stdin.end()
        stdout.end()
        done.resolve({ exitCode: null, signal: 'SIGTERM' })
      })
      const handle = {
        pid: 20_000 + this.handles.length,
        stdin,
        stdout,
        stderr: undefined,
        collected: {},
        done: done.promise,
        terminate: terminateMock,
        waitForExit: async () => {
          if (!settled) terminateMock()
          await done.promise
          return true
        },
        terminateMock,
      }
      this.handles.push(handle)
      return handle
    },
  } as unknown as SubprocessRuntime
}

function createHooks(options: {
  readonly nativeSessionLocator?: string | null
  readonly resolveInteraction?: (request: ProviderInteractionRequest) => ProviderInteractionResolution
} = {}) {
  const events: BridgeEventDraft[] = []
  const interactions: ProviderInteractionRequest[] = []
  const locators: string[] = []
  const controller = new AbortController()
  const hooks: ProviderTurnHooks = {
    bridgeSessionId: 'bridge-session-claude',
    bridgeTurnId: 'bridge-turn-claude',
    cwd: process.cwd(),
    nativeSessionLocator: options.nativeSessionLocator ?? null,
    signal: controller.signal,
    emit: async event => { events.push(event) },
    setNativeSessionLocator: async locator => { locators.push(locator) },
    requestInteraction: async request => {
      interactions.push(request)
      return options.resolveInteraction?.(request)
        ?? (request.kind === 'approval'
          ? { kind: 'approval', action: 'allow' }
          : { kind: 'question', answers: Object.fromEntries(request.questions.map(question => [question.id, ['Fast']])) })
    },
  }
  return { controller, events, hooks, interactions, locators }
}

function message(value: unknown): SDKMessage {
  return value as SDKMessage
}

function successMessages(sessionId = 'native-claude-session'): SDKMessage[] {
  return [
    message({
      type: 'stream_event',
      uuid: 'partial-text',
      session_id: sessionId,
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello from Claude. ' } },
    }),
    message({
      type: 'stream_event',
      uuid: 'partial-text-2',
      session_id: sessionId,
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Still streaming. ' } },
    }),
    message({
      type: 'stream_event',
      uuid: 'partial-thinking',
      session_id: sessionId,
      event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Checking the fixture. ' } },
    }),
    message({
      type: 'assistant',
      uuid: 'assistant-tool',
      session_id: sessionId,
      message: {
        content: [{ type: 'tool_use', id: 'tool-1', name: 'Write', input: { file_path: 'fixture.txt' } }],
      },
    }),
    message({
      type: 'tool_progress',
      uuid: 'tool-progress',
      session_id: sessionId,
      tool_use_id: 'tool-1',
      tool_name: 'Write',
      elapsed_time_seconds: 1.2,
    }),
    message({
      type: 'user',
      uuid: 'tool-result',
      session_id: sessionId,
      message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', is_error: false, content: 'ok' }] },
    }),
    message({
      type: 'result',
      subtype: 'success',
      uuid: 'result-1',
      session_id: sessionId,
      is_error: false,
      result: 'Hello from Claude.',
    }),
  ]
}

function spawnManagedProcess(options: Options): void {
  const spawn = options.spawnClaudeCodeProcess
  if (spawn === undefined) throw new Error('missing Claude custom spawn callback')
  if (options.cwd === undefined) throw new Error('missing Claude working directory')
  const spawnOptions: SpawnOptions = {
    command: options.pathToClaudeCodeExecutable ?? 'claude',
    args: ['--sdk-mode'],
    cwd: options.cwd,
    env: { PATH: process.env.PATH },
    signal: options.abortController?.signal ?? new AbortController().signal,
  }
  spawn(spawnOptions)
}

function queryFrom(
  input: QueryInput,
  messages: readonly SDKMessage[],
  lifecycle: { readonly interrupt: ReturnType<typeof vi.fn>; readonly close: ReturnType<typeof vi.fn> },
): Query {
  spawnManagedProcess(input.options)
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of messages) yield item
    },
    interrupt: lifecycle.interrupt,
    close: lifecycle.close,
  } as unknown as Query
}

beforeEach(() => {
  sdk.query.mockReset()
})

describe('ClaudeProviderAdapter', () => {
  it('uses the official SDK with host executable, streams events, captures one locator, and cleans the process tree', async () => {
    const runtime = new FakeClaudeRuntime()
    const lifecycle = { interrupt: vi.fn(async () => {}), close: vi.fn() }
    let captured: QueryInput | undefined
    sdk.query.mockImplementation((input: QueryInput) => {
      captured = input
      return queryFrom(input, successMessages(), lifecycle)
    })
    const adapter = new ClaudeProviderAdapter(runtime.subprocess, 'C:\\Tools\\claude.exe')
    const harness = createHooks()

    await adapter.startTurn({ text: 'stream a fixture', hooks: harness.hooks })

    expect(captured?.prompt).toBe('stream a fixture')
    expect(captured?.options).toMatchObject({
      cwd: process.cwd(),
      pathToClaudeCodeExecutable: 'C:\\Tools\\claude.exe',
      includePartialMessages: true,
    })
    expect(harness.locators).toEqual(['native-claude-session'])
    expect(harness.events.map(event => event.type)).toEqual(expect.arrayContaining([
      'bridge/text-delta',
      'bridge/reasoning-delta',
      'bridge/tool-started',
      'bridge/tool-updated',
      'bridge/tool-completed',
      'bridge/file-change',
    ]))
    expect(harness.events
      .filter(event => event.type === 'bridge/text-delta')
      .map(event => event.data.itemId))
      .toEqual(['claude-assistant-bridge-turn-claude', 'claude-assistant-bridge-turn-claude'])
    expect(runtime.specs[0]?.argv).toEqual(['C:\\Tools\\claude.exe', '--sdk-mode'])
    expect(runtime.handles[0]?.terminateMock).toHaveBeenCalledTimes(1)
    expect(lifecycle.close).toHaveBeenCalledTimes(1)
    await adapter.dispose()
  })

  it('passes resume to the SDK without rewriting the existing native locator', async () => {
    const runtime = new FakeClaudeRuntime()
    let captured: QueryInput | undefined
    sdk.query.mockImplementation((input: QueryInput) => {
      captured = input
      return queryFrom(input, successMessages('native-existing'), {
        interrupt: vi.fn(async () => {}),
        close: vi.fn(),
      })
    })
    const adapter = new ClaudeProviderAdapter(runtime.subprocess, 'claude')
    const harness = createHooks({ nativeSessionLocator: 'native-existing' })

    await adapter.startTurn({ text: 'resume fixture', hooks: harness.hooks })

    expect(captured?.options.resume).toBe('native-existing')
    expect(harness.locators).toEqual([])
    await adapter.dispose()
  })

  it('maps tool permission, AskUserQuestion, and MCP form elicitation while declining URL elicitation', async () => {
    const runtime = new FakeClaudeRuntime()
    const callbackResults: unknown[] = []
    sdk.query.mockImplementation((input: QueryInput) => {
      spawnManagedProcess(input.options)
      const lifecycle = { interrupt: vi.fn(async () => {}), close: vi.fn() }
      return {
        async *[Symbol.asyncIterator]() {
          const canUseTool = input.options.canUseTool
          if (canUseTool === undefined) throw new Error('missing canUseTool')
          callbackResults.push(await canUseTool('Bash', { command: 'echo fixture' }, {
            toolUseID: 'bash-1',
            requestId: 'request-bash-1',
            signal: new AbortController().signal,
            title: 'Run fixture command',
            description: 'Execute the integration fixture.',
          }))
          callbackResults.push(await canUseTool('AskUserQuestion', {
            questions: [{
              header: 'Mode',
              question: 'Which mode?',
              multiSelect: false,
              options: [{ label: 'Fast', description: 'Short verification' }],
            }],
          }, {
            toolUseID: 'question-1',
            requestId: 'request-question-1',
            signal: new AbortController().signal,
            title: 'Question',
            description: 'Needs input',
          }))
          const onElicitation = input.options.onElicitation
          if (onElicitation === undefined) throw new Error('missing onElicitation')
          callbackResults.push(await onElicitation({
            mode: 'url',
            serverName: 'auth-server',
            message: 'Authenticate',
            url: 'https://example.test/oauth/authorize',
            elicitationId: 'url-1',
          } as ElicitationRequest, { signal: new AbortController().signal }))
          callbackResults.push(await onElicitation({
            mode: 'form',
            serverName: 'fixture-server',
            message: 'Choose a mode',
            requestedSchema: {
              type: 'object',
              properties: { mode: { type: 'string', enum: ['Fast', 'Full'] } },
            },
          } as ElicitationRequest, { signal: new AbortController().signal }))
          yield message({
            type: 'result',
            subtype: 'success',
            uuid: 'result-interactions',
            session_id: 'native-interactions',
            is_error: false,
            result: 'done',
          })
        },
        interrupt: lifecycle.interrupt,
        close: lifecycle.close,
      } as unknown as Query
    })
    const adapter = new ClaudeProviderAdapter(runtime.subprocess, 'claude')
    const harness = createHooks()

    await adapter.startTurn({ text: 'interaction fixture', hooks: harness.hooks })

    expect(harness.interactions.map(request => request.kind)).toEqual(['approval', 'question', 'question'])
    expect(harness.interactions[0]).toMatchObject({ toolName: 'Bash', target: 'echo fixture' })
    expect(callbackResults[0]).toMatchObject({ behavior: 'allow', decisionClassification: 'user_temporary' })
    expect(callbackResults[1]).toMatchObject({ behavior: 'allow' })
    expect(callbackResults[2]).toEqual({ action: 'decline' })
    expect(callbackResults[3]).toMatchObject({ action: 'accept', content: { mode: 'Fast' } })
    await adapter.dispose()
  })

  it('interrupts the SDK query and terminates its managed process on cancellation', async () => {
    const runtime = new FakeClaudeRuntime()
    const lifecycle = { interrupt: vi.fn(async () => {}), close: vi.fn() }
    sdk.query.mockImplementation((input: QueryInput) => {
      spawnManagedProcess(input.options)
      return {
        async *[Symbol.asyncIterator]() {
          await new Promise<void>((resolve, reject) => {
            const signal = input.options.abortController?.signal
            if (signal === undefined) return reject(new Error('missing abort controller'))
            const abort = (): void => { reject(signal.reason) }
            if (signal.aborted) abort()
            else signal.addEventListener('abort', abort, { once: true })
          })
          yield message({})
        },
        interrupt: lifecycle.interrupt,
        close: lifecycle.close,
      } as unknown as Query
    })
    const adapter = new ClaudeProviderAdapter(runtime.subprocess, 'claude')
    const harness = createHooks()
    const active = adapter.startTurn({ text: 'hold for cancellation', hooks: harness.hooks })
    await new Promise<void>(resolve => { setTimeout(resolve, 10) })

    await adapter.cancel(harness.hooks.bridgeSessionId)

    await expect(active).rejects.toMatchObject({ code: 'USER_CANCELLED' })
    expect(lifecycle.interrupt).toHaveBeenCalledTimes(1)
    expect(lifecycle.close).toHaveBeenCalledTimes(1)
    expect(runtime.handles[0]?.terminateMock).toHaveBeenCalledTimes(1)
    await adapter.dispose()
  })
  it('reports completions from the SDK, and survives an SDK that has neither control request', async () => {
    const runtime = new FakeClaudeRuntime()
    const lifecycle = { interrupt: vi.fn(async () => {}), close: vi.fn() }

    // The default query double carries only interrupt/close — the shape of an
    // SDK build predating these control requests, where the call throws
    // synchronously rather than returning a promise to catch on. That used to
    // escape as an unhandled rejection during an unrelated test.
    sdk.query.mockImplementation((input: QueryInput) => queryFrom(input, successMessages(), lifecycle))

    const bare = new ClaudeProviderAdapter(runtime.subprocess as never, '/host/bin/claude')
    const sessionId = createHooks().hooks.bridgeSessionId
    expect(await bare.listCompletions(sessionId)).toEqual({ completions: [], pending: true })
    await bare.startTurn({ text: 'first turn', hooks: createHooks().hooks })
    // Still pending, not an error, and not a fabricated empty answer.
    expect(await bare.listCompletions(sessionId)).toEqual({ completions: [], pending: true })
    await bare.dispose()

    // A current SDK answers both, and the panel gets the product's own names.
    sdk.query.mockImplementation((input: QueryInput) => ({
      ...queryFrom(input, successMessages(), lifecycle),
      supportedCommands: async () => [
        { name: 'compact', description: 'Compact the context', argumentHint: '', aliases: [] },
        { name: 'review', description: '', argumentHint: '<path>', aliases: [] },
      ],
      mcpServerStatus: async () => [
        { name: 'playwright', status: 'connected', serverInfo: { name: 'playwright-mcp', version: '1.0.0' } },
        { name: 'broken', status: 'failed' },
      ],
    }) as unknown as Query)

    const current = new ClaudeProviderAdapter(runtime.subprocess as never, '/host/bin/claude')
    await current.startTurn({ text: 'first turn', hooks: createHooks().hooks })
    const reported = await current.listCompletions(sessionId)

    expect(reported.pending).toBe(false)
    expect(reported.completions).toEqual([
      // Claude Code resolves commands with a slash, so that is the insertion text.
      { kind: 'command', name: 'compact', insertText: '/compact', description: 'Compact the context', argumentHint: null, status: null },
      // An empty description or hint from the product becomes null, not ''.
      { kind: 'command', name: 'review', insertText: '/review', description: null, argumentHint: '<path>', status: null },
      // A server cannot be typed into the composer, and its state is carried.
      { kind: 'mcp', name: 'playwright', insertText: null, description: 'playwright-mcp', argumentHint: null, status: 'connected' },
      // serverInfo only arrives once connected; its absence is not an error.
      { kind: 'mcp', name: 'broken', insertText: null, description: null, argumentHint: null, status: 'failed' },
    ])
    await current.dispose()
  })
})
