import { z } from 'zod'
import {
  defineDomain,
  domainTable,
  type Domain,
  type DomainFacility,
  type KvTable,
} from '@deepseek-ai/dsh-storage-domain'
import type {
  BridgeContextUsage,
  BridgeEvent,
  BridgePermissionMode,
  BridgeRateLimit,
  BridgeSessionStatus,
  BridgeTokenUsage,
  PendingInteractionView,
  ProviderId,
} from '../types.ts'
import { credentialLeakMarkers } from './redaction.ts'
import type { PrivacyVerifier } from './privacy.ts'

export interface PersistedBridgeSession {
  bridgeSessionId: string
  providerId: ProviderId
  workspaceId: string
  workspaceTitle: string
  title: string
  status: BridgeSessionStatus
  createdAt: number
  updatedAt: number
  lastTurnId: string | null
  nativeSessionLocator: string | null
  queuedInputs: string[]
  archived: boolean
  persistenceVersion: number
  /**
   * Latest context usage the product reported. Optional so a record written
   * before this existed parses unchanged — the field is additive and the domain
   * version deliberately does not move for that.
   */
  contextUsage?: BridgeContextUsage | null
  /**
   * Whether this session is held at the top of its group. Absent on records
   * written before it existed, which is the same as not pinned.
   */
  pinned?: boolean
  /** Permission mode; absent on records written before it existed. */
  permissionMode?: BridgePermissionMode
  /** Requested model, or absent/null for the product's own default. */
  model?: string | null
  /** Requested reasoning effort, or absent/null for the product's default. */
  effort?: string | null
  /**
   * Usage allowances last reported, one per window.
   *
   * Persisted so the figure survives a Host restart the way context usage does:
   * it only arrives during a turn, and losing it would blank the readout until
   * the operator happened to run another one. Stale by nature — the panel shows
   * it as the last thing the product said, not as live truth.
   */
  rateLimits?: BridgeRateLimit[]
  /** Accumulated token spend; absent on records written before it existed. */
  tokenUsage?: BridgeTokenUsage | null
  nextSequence: number
  events: BridgeEvent[]
  pendingInteraction: PendingInteractionView | null
}

/**
 * A working directory the bridge owns.
 *
 * The bridge keeps its own list rather than registering every directory with
 * DeepSeek Harness, because a Harness workspace has no visibility dimension —
 * `WorkspaceRecord` is path, title, sessions and timestamps — so anything
 * registered there appears in the Harness sidebar for good. Adding a directory
 * here is therefore private to the panel, and publishing it is a separate,
 * reversible act.
 */
export interface PersistedBridgeDirectory {
  directoryId: string
  /** Absolute Host path the agent runs in. */
  path: string
  title: string
  /**
   * The Harness workspace this directory is published as, or null when it is
   * private to the panel.
   *
   * Held as the Harness's own id so unpublishing can delete exactly that
   * record, and so a workspace the operator removed in the Harness can be
   * detected and the flag reconciled rather than left claiming otherwise.
   */
  publishedWorkspaceId: string | null
  createdAt: number
  updatedAt: number
}

const envelopeSchema = z.object({ payload: z.string() })
type Envelope = z.infer<typeof envelopeSchema>

/**
 * The bridge's storage declaration.
 *
 * `version` must not be bumped for an additive change. The domain facility has
 * no migration step — a medium stamped with a different version is rejected at
 * open, which fails the plugin's init and takes the whole Profile down with it.
 * Adding a table is backward compatible on its own: an existing medium simply
 * has no rows for it and reads as empty. Raising this number is therefore only
 * correct alongside a deliberate, documented plan for existing data, not as a
 * reflex when the shape changes.
 */
export const bridgeDomainSpec = defineDomain({
  name: 'local_agent_bridge',
  version: 1,
  tables: {
    sessions: domainTable<string, Envelope>(envelopeSchema),
    directories: domainTable<string, Envelope>(envelopeSchema),
    // The panel's password verifier, at one fixed key. A table rather than a
    // field on something else because it is the only record here that is not
    // about a session or a directory, and because adding a table is the
    // backward-compatible move the note above describes.
    secrets: domainTable<string, Envelope>(envelopeSchema),
  },
})

/** The single key the verifier lives at; there is only ever one password. */
const PANEL_PASSWORD_KEY = 'panel-password'

function parseRecord(payload: string): PersistedBridgeSession {
  const value = JSON.parse(payload) as PersistedBridgeSession
  if (
    value === null
    || typeof value !== 'object'
    || typeof value.bridgeSessionId !== 'string'
    || !Array.isArray(value.events)
    || !Array.isArray(value.queuedInputs)
    || typeof value.nextSequence !== 'number'
  ) {
    throw new Error('local-agent-bridge: invalid persisted session record')
  }
  return value
}

function parseDirectory(payload: string): PersistedBridgeDirectory {
  const value = JSON.parse(payload) as PersistedBridgeDirectory
  if (
    value === null
    || typeof value !== 'object'
    || typeof value.directoryId !== 'string'
    || typeof value.path !== 'string'
  ) {
    throw new Error('local-agent-bridge: invalid persisted directory record')
  }
  return value
}

export class BridgePersistence {
  private constructor(
    private readonly domain: Domain<typeof bridgeDomainSpec>,
    private readonly sessions: KvTable<string, Envelope>,
    private readonly directories: KvTable<string, Envelope>,
    private readonly secrets: KvTable<string, Envelope>,
  ) {}

  static async open(storageDomain: DomainFacility): Promise<BridgePersistence> {
    const domain = await storageDomain.open(bridgeDomainSpec)
    return new BridgePersistence(
      domain,
      domain.table('sessions'),
      domain.table('directories'),
      domain.table('secrets'),
    )
  }

  /**
   * The stored password verifier, or null when no password is set.
   *
   * A record that will not parse reads as "no password", not as an error: a
   * corrupted verifier that failed the plugin's init would take the whole Profile
   * down, and an operator locked out of the Harness by a damaged lock file has no
   * way in at all. Failing open here is the lesser harm, and it is visible — the
   * panel says no password is set.
   */
  readPanelPassword(): PrivacyVerifier | null {
    const envelope = this.secrets.get(PANEL_PASSWORD_KEY)
    if (envelope === undefined) return null
    try {
      const value = JSON.parse(envelope.payload) as PrivacyVerifier
      if (
        value === null
        || typeof value !== 'object'
        || value.kdf !== 'scrypt'
        || typeof value.salt !== 'string'
        || typeof value.verifier !== 'string'
        || typeof value.cost !== 'number'
        || typeof value.blockSize !== 'number'
        || typeof value.parallelism !== 'number'
        || typeof value.keyLength !== 'number'
      ) return null
      return value
    } catch {
      return null
    }
  }

  /**
   * Write or remove the password verifier.
   *
   * Runs the same credential-leak probes the session writer does. The verifier is
   * a one-way hash the Host is meant to keep, so this should never fire — which is
   * exactly why it is worth having: it fires only if someone later puts something
   * here that is not a hash.
   *
   * @param verifier - the record to store, or null to remove the password.
   */
  async writePanelPassword(verifier: PrivacyVerifier | null): Promise<void> {
    if (verifier === null) {
      await this.secrets.delete(PANEL_PASSWORD_KEY)
      return
    }
    const payload = JSON.stringify(verifier)
    const markers = credentialLeakMarkers(payload)
    if (markers.length > 0) {
      throw new Error(`local-agent-bridge: refused to persist credential-shaped data (${markers.join(', ')})`)
    }
    await this.secrets.put(PANEL_PASSWORD_KEY, { payload })
  }

  list(): PersistedBridgeSession[] {
    return [...this.sessions.entries()].map(([, envelope]) => parseRecord(envelope.payload))
  }

  listDirectories(): PersistedBridgeDirectory[] {
    return [...this.directories.entries()].map(([, envelope]) => parseDirectory(envelope.payload))
  }

  async putDirectory(record: PersistedBridgeDirectory): Promise<void> {
    await this.directories.put(record.directoryId, { payload: JSON.stringify(record) })
  }

  async deleteDirectory(directoryId: string): Promise<boolean> {
    return await this.directories.delete(directoryId)
  }

  async put(record: PersistedBridgeSession): Promise<void> {
    const payload = JSON.stringify(record)
    const markers = credentialLeakMarkers(payload)
    if (markers.length > 0) {
      throw new Error(`local-agent-bridge: refused to persist credential-shaped data (${markers.join(', ')})`)
    }
    await this.sessions.put(record.bridgeSessionId, { payload })
  }

  async delete(bridgeSessionId: string): Promise<boolean> {
    return await this.sessions.delete(bridgeSessionId)
  }

  async close(): Promise<void> {
    await this.domain.close()
  }
}

