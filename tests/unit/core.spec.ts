import { describe, expect, it } from 'vitest'
import { credentialLeakMarkers, redactText, redactValue } from '../../src/core/redaction.ts'
import {
  compatibilityFor,
  parseProductVersion,
  supportedVersionRange,
} from '../../src/core/version.ts'
import { LOCAL_AGENT_BRIDGE_INVOCATIONS } from '../../src/typert.shared.ts'

describe('redaction', () => {
  it('removes credentials, credential paths, and authentication URLs', () => {
    const source = [
      'Authorization: Bearer abcdefghijklmnop',
      'api_key=sk-abcdefghijklmnop',
      'C:\\Users\\worker\\.claude\\credentials.json',
      'https://example.test/oauth/authorize?device=ABCD-EFGH',
    ].join('\n')

    const redacted = redactText(source)

    expect(redacted).not.toContain('abcdefghijklmnop')
    expect(redacted).not.toContain('.claude')
    expect(redacted).not.toContain('/oauth/')
    expect(redacted).toContain('[REDACTED]')
    expect(credentialLeakMarkers(redacted)).toEqual([])
  })

  it('redacts nested secret-shaped fields and truncates text', () => {
    const value = redactValue({
      token: 'plain-secret',
      nested: { password: 'another-secret', secret: false, note: 'safe' },
      secret: 'must-not-pass',
    })

    expect(value).toEqual({
      token: '[REDACTED]',
      nested: { password: '[REDACTED]', secret: false, note: 'safe' },
      secret: '[REDACTED]',
    })
    expect(redactText('abcdef', 3)).toBe('abc\n[TRUNCATED]')
  })

  it('preserves opaque UUIDs while redacting standalone device codes', () => {
    const uuid = '12345678-1234-4234-8234-123456789abc'
    const redacted = redactText(`native=${uuid} device=ABCD-EFGH`)

    expect(redacted).toContain(uuid)
    expect(redacted).not.toContain('ABCD-EFGH')
  })
})

describe('version compatibility', () => {
  it('parses product output and pins the verified versions', () => {
    expect(parseProductVersion('codex-cli 0.147.0')).toBe('0.147.0')
    expect(parseProductVersion('Claude Code v2.1.220')).toBe('2.1.220')
    expect(parseProductVersion('unknown')).toBeNull()
    expect(supportedVersionRange('codex')).toBe('0.147.x')
    expect(supportedVersionRange('claude')).toBe('2.1.220')
    expect(supportedVersionRange('fake')).toBeNull()
  })

  it('rejects unsupported versions unless experimental compatibility is enabled', () => {
    expect(compatibilityFor('codex', '0.147.9', false)).toBe('supported')
    expect(compatibilityFor('codex', '0.148.0', false)).toBe('unsupported')
    expect(compatibilityFor('codex', '0.148.0', true)).toBe('unknown')
    expect(compatibilityFor('claude', null, false)).toBe('unknown')
  })
})

describe('Typert descriptors', () => {
  it('defines the complete direct remote surface with cancellation only on long poll', () => {
    expect(LOCAL_AGENT_BRIDGE_INVOCATIONS.map(item => item.method)).toEqual([
      'catalog',
      'sessionsList',
      'sessionCreate',
      'sessionRead',
      'sessionSend',
      'sessionCancel',
      'sessionArchive',
      'interactionRespond',
    ])
    expect(LOCAL_AGENT_BRIDGE_INVOCATIONS.every(item => item.invocation.kind === 'direct')).toBe(true)
    expect(LOCAL_AGENT_BRIDGE_INVOCATIONS.filter(item => 'cancellation' in item).map(item => item.method)).toEqual([
      'sessionRead',
    ])
  })

  it('rejects unknown fields and invalid provider ids at the wire boundary', () => {
    const create = LOCAL_AGENT_BRIDGE_INVOCATIONS.find(item => item.method === 'sessionCreate')
    const request = create?.parameters[0]
    expect(request).toBeDefined()
    expect(request?.codec.schema.safeParse({ providerId: 'codex', workspaceId: 'workspace-1' }).success).toBe(true)
    expect(request?.codec.schema.safeParse({ providerId: 'other', workspaceId: 'workspace-1' }).success).toBe(false)
    expect(request?.codec.schema.safeParse({
      providerId: 'codex',
      workspaceId: 'workspace-1',
      credential: 'must-not-pass',
    }).success).toBe(false)
  })
})
