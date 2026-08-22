import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { NativeProviderAdapter } from './core/provider.ts'
import { BridgePersistence, type PersistedBridgeDirectory } from './core/persistence.ts'
import { BridgeSessionEngine } from './core/session-engine.ts'
import { BridgeError } from './core/errors.ts'
import { discoverProvider, isAdmissible, permissionModesFor, publicProvider } from './core/version.ts'
import { redactText } from './core/redaction.ts'
import { listHostDirectory } from './core/host-browse.ts'
import { readRepository } from './core/repository.ts'
import { ClaudeProviderAdapter } from './providers/claude.ts'
import { CodexProviderAdapter } from './providers/codex.ts'
import { FakeProviderAdapter } from './providers/fake.ts'
import type {
  BridgeCatalogResult,
  BridgeDirectoryAddRequest,
  BridgeDirectoryPublishRequest,
  BridgeDirectoryRequest,
  BridgeFileSearchRequest,
  BridgeFileSearchResult,
  BridgeWorkspaceView,
  BridgeCompletionsResult,
  BridgeModelRequest,
  BridgeModelsResult,
  BridgeNativeSessionsRequest,
  BridgeNativeSessionsResult,
  BridgePermissionModeRequest,
  BridgeInteractionRespondRequest,
  BridgeInteractionRespondResult,
  BridgeSendResult,
  BridgeSessionArchiveRequest,
  BridgeSessionCreateRequest,
  BridgeSessionIdRequest,
  BridgeHostListRequest,
  BridgeHostListing,
  BridgeRepository,
  BridgeUploadRequest,
  BridgeUploadResult,
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
  /**
   * Whether the composer may browse the Host outside the session's working
   * directory.
   *
   * On by default, because the Harness is a loopback tool on the operator's own
   * machine and this is a read they asked for. Turn it off for a deployment where
   * the browser reaches the Host across a network: it is the panel's widest read,
   * and a Profile serving remote clients should decide about it explicitly.
   */
  allowHostBrowsing?: boolean
  enableFakeProvider?: boolean
  eventRetention?: number
  longPollMaxMs?: number
  processGraceMs?: number
}

interface ResolvedConfig {
  readonly allowExperimentalVersions: boolean
  readonly allowHostBrowsing: boolean
  readonly enableFakeProvider: boolean
  readonly eventRetention: number
  readonly longPollMaxMs: number
  readonly processGraceMs: number
}

/**
 * Whether a Host path is a directory that exists right now.
 * @param path - absolute Host path.
 * @returns true only for an existing directory.
 */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    localAgentBridge: LocalAgentBridgeService
  }
}

/**
 * How long a repository read is reused. Long enough that polling costs nothing,
 * short enough that a commit made in a terminal shows up while the operator is
 * still looking at the panel.
 */
const REPOSITORY_CACHE_MS = 2_000

export class LocalAgentBridgeService extends TypertRemoteService {
  static inject = ['subprocess', 'storageDomain', 'workspaceRegistry']

  static Config: z<Config> = z.object({
    allowExperimentalVersions: z.boolean().default(false),
    allowHostBrowsing: z.boolean().default(true),
    enableFakeProvider: z.boolean().default(false),
    eventRetention: z.number().min(100).max(10_000).default(2_000),
    longPollMaxMs: z.number().min(1_000).max(30_000).default(25_000),
    processGraceMs: z.number().min(500).max(30_000).default(3_000),
  }).default({
    allowExperimentalVersions: false,
    allowHostBrowsing: true,
    enableFakeProvider: false,
    eventRetention: 2_000,
    longPollMaxMs: 25_000,
    processGraceMs: 3_000,
  })

  private readonly config: ResolvedConfig
  private engine: BridgeSessionEngine | null = null
  /**
   * Recently read repository state per working directory.
   *
   * Held on the service rather than in the engine because it is a property of the
   * Host's filesystem, shared by every session pointed at the same directory.
   */
  private readonly repositories = new Map<string, { at: number; status: BridgeRepository | null }>()
  private providerViews: NativeProviderView[] = []
  /**
   * Adapters handed to the engine, by the same Map reference the engine holds:
   * adding to it here makes a newly usable product usable for the next session,
   * and the engine's dispose still owns tearing every one of them down.
   *
   * Entries are only ever added. A product that stops being admissible — the
   * operator downgraded it — keeps its adapter, because a session may be running
   * on it right now; `sessionCreate` gates on the freshly computed health
   * instead, so no *new* session starts on it.
   */
  private readonly adapters = new Map<ProviderId, NativeProviderAdapter>()
  private persistence: BridgePersistence | null = null

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'localAgentBridge')
    this.config = {
      allowExperimentalVersions: config.allowExperimentalVersions ?? false,
      allowHostBrowsing: config.allowHostBrowsing ?? true,
      enableFakeProvider: config.enableFakeProvider ?? false,
      eventRetention: config.eventRetention ?? 2_000,
      longPollMaxMs: config.longPollMaxMs ?? 25_000,
      processGraceMs: config.processGraceMs ?? 3_000,
    }
  }

  /**
   * Probe both products and refresh what the browser is told about them.
   *
   * Called on load and again on every catalog read, because the operator's fix
   * for an unusable product happens on the Host — installing it, logging in,
   * upgrading it, or starting DSH from a shell whose PATH resolves it — and the
   * documented recovery is to press Refresh in the browser, not to restart the
   * Profile. Probing is two `--version` reads and does not touch a running
   * session; a product that became admissible gains its adapter here.
   */
  private async discoverProviders(): Promise<void> {
    const discovered = await Promise.all([
      discoverProvider(this.ctx.subprocess, 'codex', {
        allowExperimentalVersions: this.config.allowExperimentalVersions,
      }),
      discoverProvider(this.ctx.subprocess, 'claude', {
        allowExperimentalVersions: this.config.allowExperimentalVersions,
      }),
    ])
    const admissible = new Set<ProviderId>()
    for (const provider of discovered) {
      if (!isAdmissible(provider, this.config.allowExperimentalVersions)) continue
      admissible.add(provider.id)
      if (this.adapters.has(provider.id)) continue
      this.adapters.set(provider.id, provider.id === 'codex'
        ? new CodexProviderAdapter(this.ctx.subprocess, provider.executablePath, this.config.processGraceMs)
        : new ClaudeProviderAdapter(this.ctx.subprocess, provider.executablePath, this.config.processGraceMs))
    }
    // Readiness follows this probe, not the presence of an adapter: an adapter
    // retained for a running session must not advertise a product the operator
    // has since downgraded.
    this.providerViews = discovered.map(provider => publicProvider(provider, admissible.has(provider.id)))
    if (this.config.enableFakeProvider) {
      if (!this.adapters.has('fake')) this.adapters.set('fake', new FakeProviderAdapter())
      this.providerViews.push({
        id: 'fake',
        displayName: 'Verification Fixture',
        installed: true,
        version: '1.0.0',
        supportedRange: null,
        permissionModes: permissionModesFor('fake'),
        // The fixture has no model to choose, so the composer offers none.
        selectableModels: false,
        compatibility: 'supported',
        health: 'ready',
        // The Client labels the fixture from its id; no Host sentence needed.
        message: null,
      })
    }
  }

  protected async *[Service.init](): AsyncGenerator<() => Promise<void>, void, void> {
    await this.discoverProviders()
    const persistence = await BridgePersistence.open(this.ctx.storageDomain)
    this.persistence = persistence
    await this.adoptExistingWorkspaces(persistence)
    await this.repointSessionsAtDirectories(persistence)
    this.engine = await BridgeSessionEngine.create({
      persistence,
      providers: this.adapters,
      eventRetention: this.config.eventRetention,
      longPollMaxMs: this.config.longPollMaxMs,
      resolveWorkspace: async (workspaceId) => {
        // The bridge's own directory list is authoritative. A session persisted
        // before directories existed holds a Harness workspace id, so that is
        // tried second — no migration, and an old session keeps working.
        const directory = persistence.listDirectories().find(entry => entry.directoryId === workspaceId)
        if (directory !== undefined) {
          return {
            id: directory.directoryId,
            title: directory.title,
            cwd: directory.path,
            status: await isDirectory(directory.path) ? 'ok' : 'missing-dir',
          }
        }
        const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(workspaceId))
        if (workspace === undefined) return undefined
        return {
          id: String(workspace.id),
          title: workspace.title,
          cwd: workspace.path,
          status: await workspace.status(),
        }
      },
      // Cached briefly, because the panel polls it and running two git commands
      // per poll on a large repository is real Host work for a status line that
      // cannot change meaningfully in that window.
      readRepository: async (cwd) => {
        const held = this.repositories.get(cwd)
        const now = Date.now()
        if (held !== undefined && now - held.at < REPOSITORY_CACHE_MS) return held.status
        const status = await readRepository(this.ctx.subprocess, cwd)
        this.repositories.set(cwd, { at: now, status })
        return status
      },
    })
    yield async () => {
      const engine = this.engine
      this.engine = null
      this.persistence = null
      await engine?.dispose()
    }
  }

  @Remote('catalog')
  async catalog(): Promise<BridgeCatalogResult> {
    await this.discoverProviders()
    return {
      providers: this.providerViews,
      workspaces: await this.listDirectories(),
      hostBrowsing: this.config.allowHostBrowsing,
    }
  }

  @Remote('directoryAdd')
  async directoryAdd(request: BridgeDirectoryAddRequest): Promise<BridgeWorkspaceView> {
    const path = resolve(request.path.trim())
    if (path.length === 0) throw new BridgeError('INVALID_REQUEST')
    if (!await isDirectory(path)) throw new BridgeError('WORKSPACE_NOT_AVAILABLE')
    const persistence = this.requirePersistence()
    // Idempotent by path: adding the same directory twice is the operator
    // repeating themselves, not a request for a second entry pointing at one
    // place — which would then need two publish flags for one sidebar row.
    const existing = persistence.listDirectories().find(entry => entry.path === path)
    if (existing !== undefined) return await this.directoryView(existing)
    const now = Date.now()
    const record: PersistedBridgeDirectory = {
      directoryId: randomUUID(),
      path,
      title: redactText(basename(path) || path, 256),
      publishedWorkspaceId: null,
      createdAt: now,
      updatedAt: now,
    }
    await persistence.putDirectory(record)
    return await this.directoryView(record)
  }

  @Remote('directoryRemove')
  async directoryRemove(request: BridgeDirectoryRequest): Promise<void> {
    const persistence = this.requirePersistence()
    const record = persistence.listDirectories().find(entry => entry.directoryId === request.directoryId)
    if (record === undefined) return
    // Removing a published directory also removes the Harness workspace this
    // plugin created for it. Nothing else the operator did in the Harness is
    // touched, because only a publish could have created it.
    if (record.publishedWorkspaceId !== null) {
      await this.ctx.workspaceRegistry.delete(WorkspaceId(record.publishedWorkspaceId)).catch(() => false)
    }
    await persistence.deleteDirectory(request.directoryId)
  }

  @Remote('directoryPublish')
  async directoryPublish(request: BridgeDirectoryPublishRequest): Promise<BridgeWorkspaceView> {
    const persistence = this.requirePersistence()
    const record = persistence.listDirectories().find(entry => entry.directoryId === request.directoryId)
    if (record === undefined) throw new BridgeError('WORKSPACE_NOT_AVAILABLE')
    const live = record.publishedWorkspaceId === null
      ? undefined
      : this.ctx.workspaceRegistry.get(WorkspaceId(record.publishedWorkspaceId))
    let publishedWorkspaceId = live === undefined ? null : record.publishedWorkspaceId
    if (request.published && publishedWorkspaceId === null) {
      const created = await this.ctx.workspaceRegistry.create(record.path, record.title)
      publishedWorkspaceId = String(created.id)
    } else if (!request.published && publishedWorkspaceId !== null) {
      await this.ctx.workspaceRegistry.delete(WorkspaceId(publishedWorkspaceId)).catch(() => false)
      publishedWorkspaceId = null
    }
    const updated: PersistedBridgeDirectory = { ...record, publishedWorkspaceId, updatedAt: Date.now() }
    await persistence.putDirectory(updated)
    return await this.directoryView(updated)
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
    if (
      request.permissionMode !== undefined
      && !permissionModesFor(request.providerId).some(entry => entry.mode === request.permissionMode)
    ) {
      throw new BridgeError('INVALID_REQUEST')
    }
    return await this.requireEngine().createSession(request)
  }

  @Remote('sessionRead')
  async sessionRead(request: BridgeSessionReadRequest, signal?: AbortSignal): Promise<BridgeSessionReadResult> {
    return await this.requireEngine().read(request, signal)
  }

  @Remote('sessionSend')
  async sessionSend(request: BridgeSessionSendRequest): Promise<BridgeSendResult> {
    return await this.requireEngine().send(
      request.bridgeSessionId,
      request.text,
      request.images ?? [],
    )
  }

  @Remote('sessionCancel')
  async sessionCancel(request: BridgeSessionIdRequest): Promise<void> {
    await this.requireEngine().cancel(request.bridgeSessionId)
  }

  @Remote('sessionArchive')
  async sessionArchive(request: BridgeSessionArchiveRequest): Promise<BridgeSessionView> {
    return await this.requireEngine().archiveSession(request.bridgeSessionId, request.archived ?? true)
  }

  @Remote('sessionCompletions')
  async sessionCompletions(request: BridgeSessionIdRequest): Promise<BridgeCompletionsResult> {
    return await this.requireEngine().listCompletions(request.bridgeSessionId)
  }

  @Remote('nativeSessions')
  async nativeSessions(request: BridgeNativeSessionsRequest): Promise<BridgeNativeSessionsResult> {
    const provider = this.providerViews.find(candidate => candidate.id === request.providerId)
    if (provider === undefined || provider.health !== 'ready') {
      // Nothing to enumerate for a product that cannot back a session anyway,
      // and asking would start an App Server for no reason.
      return { sessions: [], unavailable: true }
    }
    return await this.requireEngine().listNativeSessions(request.providerId, request.workspaceId)
  }

  @Remote('sessionPermissionMode')
  async sessionPermissionMode(request: BridgePermissionModeRequest): Promise<BridgeSessionView> {
    const engine = this.requireEngine()
    const session = engine.list(true).find(item => item.bridgeSessionId === request.bridgeSessionId)
    if (session === undefined) throw new BridgeError('SESSION_NOT_FOUND')
    // Refused rather than approximated: the panel only offers modes the product
    // can honour, so a request for another one means something is out of step,
    // and quietly storing it would show a mode the agent is not obeying.
    if (!permissionModesFor(session.providerId).some(entry => entry.mode === request.mode)) {
      throw new BridgeError('INVALID_REQUEST')
    }
    return await engine.setPermissionMode(request.bridgeSessionId, request.mode)
  }

  @Remote('sessionModels')
  async sessionModels(request: BridgeSessionIdRequest): Promise<BridgeModelsResult> {
    return await this.requireEngine().listModels(request.bridgeSessionId)
  }

  @Remote('sessionModel')
  async sessionModel(request: BridgeModelRequest): Promise<BridgeSessionView> {
    // Validation against the product's own list lives in the engine, which is
    // where the list is read — unlike permission modes, whose set is static per
    // product and can be checked here without asking anything.
    return await this.requireEngine().setModel(
      request.bridgeSessionId,
      request.model,
      request.effort,
    )
  }

  @Remote('sessionFiles')
  async sessionFiles(request: BridgeFileSearchRequest): Promise<BridgeFileSearchResult> {
    return await this.requireEngine().searchFiles(request.bridgeSessionId, request.query)
  }

  @Remote('sessionRepository')
  async sessionRepository(request: BridgeSessionIdRequest): Promise<BridgeRepository | null> {
    return await this.requireEngine().describeRepository(request.bridgeSessionId)
  }

  @Remote('hostList')
  async hostList(request: BridgeHostListRequest): Promise<BridgeHostListing> {
    // Refused rather than answered emptily: the panel hides the route when the
    // catalog says the Profile does not serve it, so reaching here means something
    // is out of step and an empty listing would look like an empty disk.
    if (!this.config.allowHostBrowsing) throw new BridgeError('INVALID_REQUEST')
    return await listHostDirectory(request.path)
  }

  @Remote('sessionUpload')
  async sessionUpload(request: BridgeUploadRequest): Promise<BridgeUploadResult> {
    return await this.requireEngine().receiveUploads(request.bridgeSessionId, request.files)
  }

  @Remote('interactionRespond')
  async interactionRespond(
    request: BridgeInteractionRespondRequest,
  ): Promise<BridgeInteractionRespondResult> {
    return await this.requireEngine().respondInteraction(request)
  }

  /**
   * Import the Harness's existing workspaces as published directories, once.
   *
   * Without this, a workspace the operator added in the Harness before this
   * plugin — or with an earlier build of it — would be invisible in the panel,
   * and re-adding it by path would produce a second sidebar row for one
   * directory. Matching on path makes the import idempotent, and they arrive
   * already marked published because they genuinely are.
   * @param persistence - the bridge's own store.
   */
  private async adoptExistingWorkspaces(persistence: BridgePersistence): Promise<void> {
    const known = new Set(persistence.listDirectories().map(entry => entry.path))
    for (const workspace of this.ctx.workspaceRegistry.list()) {
      if (known.has(workspace.path)) continue
      const now = Date.now()
      await persistence.putDirectory({
        directoryId: randomUUID(),
        path: workspace.path,
        title: redactText(workspace.title, 256),
        publishedWorkspaceId: String(workspace.id),
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  /**
   * Point sessions written before directories existed at a directory record.
   *
   * Such a session holds a Harness workspace id. That used to be stable, but a
   * directory can now be unpublished — which deletes the Harness workspace — and
   * the session would then resolve to nothing and report its workspace as
   * unavailable, with no way back from the panel.
   *
   * Rewritten to the bridge's own directory id, matched on the path the Harness
   * workspace points at. When that workspace is already gone the title is used
   * instead, and only when exactly one directory matches: a title is a base name,
   * so two directories can share one, and pointing a session at the wrong
   * directory would run an agent somewhere the operator did not choose. A session
   * that matches nothing is left alone to report unavailable honestly.
   * @param persistence - the bridge's own store.
   */
  private async repointSessionsAtDirectories(persistence: BridgePersistence): Promise<void> {
    const directories = persistence.listDirectories()
    if (directories.length === 0) return
    const byId = new Set(directories.map(entry => entry.directoryId))
    const byPath = new Map(directories.map(entry => [entry.path, entry.directoryId]))
    for (const record of persistence.list()) {
      if (byId.has(record.workspaceId)) continue
      const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(record.workspaceId))
      let directoryId = workspace === undefined ? undefined : byPath.get(workspace.path)
      if (directoryId === undefined) {
        const sameTitle = directories.filter(entry => entry.title === record.workspaceTitle)
        directoryId = sameTitle.length === 1 ? sameTitle[0]?.directoryId : undefined
      }
      if (directoryId === undefined) continue
      await persistence.put({ ...record, workspaceId: directoryId })
    }
  }

  /**
   * Every directory the bridge knows, with its publish flag reconciled against
   * the Harness registry — a workspace the operator deleted there must not leave
   * the panel claiming the directory is still published.
   * @returns the browser-facing directory list, newest first.
   */
  private async listDirectories(): Promise<BridgeWorkspaceView[]> {
    const persistence = this.persistence
    if (persistence === null) return []
    const records = persistence.listDirectories().sort((left, right) => right.createdAt - left.createdAt)
    const views: BridgeWorkspaceView[] = []
    for (const record of records) {
      // Reconciled for display only, never written back. An earlier version
      // persisted `publishedWorkspaceId: null` whenever this lookup missed,
      // which turns one unlucky read into permanent state loss — and the write
      // bought nothing: `directoryPublish` already treats a link that no longer
      // resolves as unpublished and creates a fresh workspace. Read-only means a
      // transient miss self-heals on the next catalog.
      const live = record.publishedWorkspaceId !== null
        && this.ctx.workspaceRegistry.get(WorkspaceId(record.publishedWorkspaceId)) !== undefined
      views.push({
        id: record.directoryId,
        title: record.title,
        status: await isDirectory(record.path) ? 'ok' : 'missing-dir',
        published: live,
      })
    }
    return views
  }

  /**
   * Project one directory record for the browser.
   * @param record - the stored directory.
   * @returns its view, with the publish flag as stored.
   */
  private async directoryView(record: PersistedBridgeDirectory): Promise<BridgeWorkspaceView> {
    return {
      id: record.directoryId,
      title: record.title,
      status: await isDirectory(record.path) ? 'ok' : 'missing-dir',
      published: record.publishedWorkspaceId !== null,
    }
  }

  private requirePersistence(): BridgePersistence {
    if (this.persistence === null) throw new BridgeError('CONNECTION_LOST')
    return this.persistence
  }

  private requireEngine(): BridgeSessionEngine {
    if (this.engine === null) throw new BridgeError('CONNECTION_LOST')
    return this.engine
  }
}

export default LocalAgentBridgeService
