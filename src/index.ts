import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { NativeProviderAdapter } from './core/provider.ts'
import { BridgePersistence } from './core/persistence.ts'
import { BridgeSessionEngine } from './core/session-engine.ts'
import { BridgeError } from './core/errors.ts'
import { discoverProvider, publicProvider } from './core/version.ts'
import { ClaudeProviderAdapter } from './providers/claude.ts'
import { CodexProviderAdapter } from './providers/codex.ts'
import { FakeProviderAdapter } from './providers/fake.ts'
import type {
  BridgeCatalogResult,
  BridgeInteractionRespondRequest,
  BridgeInteractionRespondResult,
  BridgeSendResult,
  BridgeSessionArchiveRequest,
  BridgeSessionCreateRequest,
  BridgeSessionIdRequest,
  BridgeSessionReadRequest,
  BridgeSessionReadResult,
  BridgeSessionSendRequest,
  BridgeSessionView,
  NativeProviderView,
  ProviderId,
} from './types.ts'

export type * from './types.ts'

export interface Config {
  allowExperimentalVersions?: boolean
  enableFakeProvider?: boolean
  eventRetention?: number
  longPollMaxMs?: number
  processGraceMs?: number
}

interface ResolvedConfig {
  readonly allowExperimentalVersions: boolean
  readonly enableFakeProvider: boolean
  readonly eventRetention: number
  readonly longPollMaxMs: number
  readonly processGraceMs: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    localAgentBridge: LocalAgentBridgeService
  }
}

export class LocalAgentBridgeService extends TypertRemoteService {
  static inject = ['subprocess', 'storageDomain', 'workspaceRegistry']

  static Config: z<Config> = z.object({
    allowExperimentalVersions: z.boolean().default(false),
    enableFakeProvider: z.boolean().default(false),
    eventRetention: z.number().min(100).max(10_000).default(2_000),
    longPollMaxMs: z.number().min(1_000).max(30_000).default(25_000),
    processGraceMs: z.number().min(500).max(30_000).default(3_000),
  }).default({
    allowExperimentalVersions: false,
    enableFakeProvider: false,
    eventRetention: 2_000,
    longPollMaxMs: 25_000,
    processGraceMs: 3_000,
  })

  private readonly config: ResolvedConfig
  private engine: BridgeSessionEngine | null = null
  private providerViews: NativeProviderView[] = []

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'localAgentBridge')
    this.config = {
      allowExperimentalVersions: config.allowExperimentalVersions ?? false,
      enableFakeProvider: config.enableFakeProvider ?? false,
      eventRetention: config.eventRetention ?? 2_000,
      longPollMaxMs: config.longPollMaxMs ?? 25_000,
      processGraceMs: config.processGraceMs ?? 3_000,
    }
  }

  protected async *[Service.init](): AsyncGenerator<() => Promise<void>, void, void> {
    const discovered = await Promise.all([
      discoverProvider(this.ctx.subprocess, 'codex', {
        allowExperimentalVersions: this.config.allowExperimentalVersions,
      }),
      discoverProvider(this.ctx.subprocess, 'claude', {
        allowExperimentalVersions: this.config.allowExperimentalVersions,
      }),
    ])
    const adapters = new Map<ProviderId, NativeProviderAdapter>()
    for (const provider of discovered) {
      const compatible = provider.compatibility === 'supported'
        || this.config.allowExperimentalVersions && provider.compatibility === 'unknown'
      if (!provider.installed || provider.executablePath === null || !compatible) continue
      adapters.set(provider.id, provider.id === 'codex'
        ? new CodexProviderAdapter(this.ctx.subprocess, provider.executablePath, this.config.processGraceMs)
        : new ClaudeProviderAdapter(this.ctx.subprocess, provider.executablePath, this.config.processGraceMs))
    }
    this.providerViews = discovered.map(provider => publicProvider(provider, adapters.has(provider.id)))
    if (this.config.enableFakeProvider) {
      adapters.set('fake', new FakeProviderAdapter())
      this.providerViews.push({
        id: 'fake',
        displayName: 'Verification Fixture',
        installed: true,
        version: '1.0.0',
        compatibility: 'supported',
        health: 'ready',
        message: 'Enabled only for local verification.',
      })
    }
    const persistence = await BridgePersistence.open(this.ctx.storageDomain)
    this.engine = await BridgeSessionEngine.create({
      persistence,
      providers: adapters,
      eventRetention: this.config.eventRetention,
      longPollMaxMs: this.config.longPollMaxMs,
      resolveWorkspace: async (workspaceId) => {
        const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(workspaceId))
        if (workspace === undefined) return undefined
        return {
          id: String(workspace.id),
          title: workspace.title,
          cwd: workspace.path,
          status: await workspace.status(),
        }
      },
    })
    yield async () => {
      const engine = this.engine
      this.engine = null
      await engine?.dispose()
    }
  }

  @Remote('catalog')
  async catalog(): Promise<BridgeCatalogResult> {
    const workspaces = await Promise.all(this.ctx.workspaceRegistry.list().map(async workspace => ({
      id: String(workspace.id),
      title: workspace.title,
      status: await workspace.status(),
    })))
    return { providers: this.providerViews, workspaces }
  }

  @Remote('sessionsList')
  sessionsList(includeArchived: boolean): BridgeSessionView[] {
    return this.requireEngine().list(includeArchived)
  }

  @Remote('sessionCreate')
  async sessionCreate(request: BridgeSessionCreateRequest): Promise<BridgeSessionView> {
    const provider = this.providerViews.find(candidate => candidate.id === request.providerId)
    if (provider === undefined || !provider.installed) throw new BridgeError('EXECUTABLE_NOT_FOUND')
    if (provider.health !== 'ready') throw new BridgeError('UNSUPPORTED_VERSION')
    return await this.requireEngine().createSession(request)
  }

  @Remote('sessionRead')
  async sessionRead(request: BridgeSessionReadRequest, signal?: AbortSignal): Promise<BridgeSessionReadResult> {
    return await this.requireEngine().read(request, signal)
  }

  @Remote('sessionSend')
  async sessionSend(request: BridgeSessionSendRequest): Promise<BridgeSendResult> {
    return await this.requireEngine().send(request.bridgeSessionId, request.text)
  }

  @Remote('sessionCancel')
  async sessionCancel(request: BridgeSessionIdRequest): Promise<void> {
    await this.requireEngine().cancel(request.bridgeSessionId)
  }

  @Remote('sessionArchive')
  async sessionArchive(request: BridgeSessionArchiveRequest): Promise<BridgeSessionView> {
    return await this.requireEngine().archiveSession(request.bridgeSessionId, request.archived ?? true)
  }

  @Remote('interactionRespond')
  async interactionRespond(
    request: BridgeInteractionRespondRequest,
  ): Promise<BridgeInteractionRespondResult> {
    return await this.requireEngine().respondInteraction(request)
  }

  private requireEngine(): BridgeSessionEngine {
    if (this.engine === null) throw new BridgeError('CONNECTION_LOST')
    return this.engine
  }
}

export default LocalAgentBridgeService
