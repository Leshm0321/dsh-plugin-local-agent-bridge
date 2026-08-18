import type { NativeProviderAdapter, ProviderTurnRequest } from '../core/provider.ts'

const wait = (milliseconds: number, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, milliseconds)
  const abort = (): void => {
    clearTimeout(timer)
    reject(signal.reason instanceof Error ? signal.reason : new Error('fake provider cancelled'))
  }
  if (signal.aborted) abort()
  else signal.addEventListener('abort', abort, { once: true })
})

export class FakeProviderAdapter implements NativeProviderAdapter {
  readonly id = 'fake' as const
  readonly supportsSteer = false
  private readonly active = new Map<string, AbortController>()

  async startTurn({ text, hooks }: ProviderTurnRequest): Promise<void> {
    const controller = new AbortController()
    this.active.set(hooks.bridgeSessionId, controller)
    const onAbort = (): void => controller.abort(hooks.signal.reason)
    hooks.signal.addEventListener('abort', onAbort, { once: true })
    try {
      if (hooks.nativeSessionLocator === null) {
        await hooks.setNativeSessionLocator(`fake-${hooks.bridgeSessionId}`)
      }
      if (/approve/i.test(text)) {
        const resolution = await hooks.requestInteraction({
          kind: 'approval',
          safeSummary: 'Run the fake verification tool.',
          toolName: 'fake.verify',
          target: 'test fixture',
          questions: [],
        })
        if (resolution.kind !== 'approval' || resolution.action !== 'allow') {
          throw new Error('fake provider approval denied')
        }
      }
      if (/question/i.test(text)) {
        await hooks.requestInteraction({
          kind: 'question',
          safeSummary: 'Choose a verification mode.',
          toolName: 'AskUserQuestion',
          target: null,
          questions: [{
            id: 'mode',
            header: 'Mode',
            prompt: 'Which verification mode should be used?',
            secret: false,
            allowFreeText: true,
            multiSelect: false,
            options: [
              { value: 'fast', label: 'Fast', description: 'Run the short fixture.' },
              { value: 'full', label: 'Full', description: 'Run the complete fixture.' },
            ],
          }],
        })
      }
      await hooks.emit({
        type: 'bridge/tool-started',
        data: { itemId: 'fake-tool', toolName: 'fake.stream', summary: 'Streaming fixture response', status: 'running' },
      })
      const answer = `Fake provider received: ${text}`
      for (const chunk of answer.match(/.{1,7}/g) ?? []) {
        await wait(15, controller.signal)
        await hooks.emit({ type: 'bridge/text-delta', data: { text: chunk, itemId: 'fake-answer' } })
      }
      await hooks.emit({
        type: 'bridge/tool-completed',
        data: { itemId: 'fake-tool', toolName: 'fake.stream', summary: 'Fixture response streamed', status: 'completed' },
      })
    } finally {
      hooks.signal.removeEventListener('abort', onAbort)
      this.active.delete(hooks.bridgeSessionId)
    }
  }

  async steer(): Promise<void> {
    throw new Error('fake provider does not support steering')
  }

  async cancel(bridgeSessionId: string): Promise<void> {
    this.active.get(bridgeSessionId)?.abort(new Error('fake provider cancelled'))
  }

  async disposeSession(bridgeSessionId: string): Promise<void> {
    await this.cancel(bridgeSessionId)
  }

  async dispose(): Promise<void> {
    for (const controller of this.active.values()) controller.abort(new Error('fake provider disposed'))
    this.active.clear()
  }
}
