import { z } from 'zod'
import {
  defineDomain,
  domainTable,
  type Domain,
  type DomainFacility,
  type KvTable,
} from '@deepseek-ai/dsh-storage-domain'
import type {
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
  nextSequence: number
  events: BridgeEvent[]
  pendingInteraction: PendingInteractionView | null
}

const envelopeSchema = z.object({ payload: z.string() })
type Envelope = z.infer<typeof envelopeSchema>

export const bridgeDomainSpec = defineDomain({
  name: 'local_agent_bridge',
  version: 1,
  tables: {
    sessions: domainTable<string, Envelope>(envelopeSchema),
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

export class BridgePersistence {
  private constructor(
    private readonly domain: Domain<typeof bridgeDomainSpec>,
    private readonly sessions: KvTable<string, Envelope>,
  ) {}

  static async open(storageDomain: DomainFacility): Promise<BridgePersistence> {
    const domain = await storageDomain.open(bridgeDomainSpec)
    return new BridgePersistence(domain, domain.table('sessions'))
  }

  list(): PersistedBridgeSession[] {
    return [...this.sessions.entries()].map(([, envelope]) => parseRecord(envelope.payload))
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

