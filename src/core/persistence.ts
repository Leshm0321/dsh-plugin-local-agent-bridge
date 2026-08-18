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
  BridgeSessionStatus,
  PendingInteractionView,
  ProviderId,
} from '../types.ts'
import { credentialLeakMarkers } from './redaction.ts'

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
  },
})

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
  ) {}

  static async open(storageDomain: DomainFacility): Promise<BridgePersistence> {
    const domain = await storageDomain.open(bridgeDomainSpec)
    return new BridgePersistence(domain, domain.table('sessions'), domain.table('directories'))
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

