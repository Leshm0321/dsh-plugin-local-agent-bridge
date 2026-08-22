import { describe, expect, it } from 'vitest'
import { credentialLeakMarkers, redactText, redactValue } from '../../src/core/redaction.ts'
import {
  compatibilityFor,
  isAdmissible,
  parseProductVersion,
  publicProvider,
  supportedVersionRange,
} from '../../src/core/version.ts'
import type { NativeProviderView, ProviderCompatibility, ProviderHealth } from '../../src/types.ts'
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
    expect(supportedVersionRange('claude')).toBe('>=2.1.220 <2.2.0')
    expect(supportedVersionRange('fake')).toBeNull()
  })

  it('rejects unsupported versions unless experimental compatibility is enabled', () => {
    expect(compatibilityFor('codex', '0.147.9', false)).toBe('supported')
    expect(compatibilityFor('codex', '0.148.0', false)).toBe('unsupported')
    expect(compatibilityFor('codex', '0.148.0', true)).toBe('unknown')
    expect(compatibilityFor('claude', null, false)).toBe('unknown')
    expect(compatibilityFor('claude', '2.1.220', false)).toBe('supported')
    expect(compatibilityFor('claude', '2.1.234', false)).toBe('supported')
    expect(compatibilityFor('claude', '2.1.219', false)).toBe('unsupported')
    expect(compatibilityFor('claude', '2.2.0', false)).toBe('unsupported')
    expect(compatibilityFor('claude', '2.2.0', true)).toBe('unknown')
  })
})

describe('provider health projection', () => {
  const discovered = (
    overrides: Partial<NativeProviderView & { executablePath: string | null }>
      & { compatibility: ProviderCompatibility; health: ProviderHealth },
  ): NativeProviderView & { readonly executablePath: string | null } => ({
    id: 'codex',
    displayName: 'Codex',
    installed: true,
    selectableModels: true,
    version: '0.144.6',
    supportedRange: '0.147.x',
    permissionModes: [],
    message: null,
    executablePath: '/host/path/codex',
    ...overrides,
  })

  it('surfaces an installed-but-rejected product as unsupported so the browser can explain it', () => {
    const view = publicProvider(discovered({ compatibility: 'unsupported', health: 'installed' }), false)
    expect(view.health).toBe('unsupported')
    expect(view.version).toBe('0.144.6')
  })

  it('surfaces an unverifiable version as unsupported until experimental admission promotes it', () => {
    expect(publicProvider(discovered({ compatibility: 'unknown', health: 'installed' }), false).health)
      .toBe('unsupported')
    expect(publicProvider(discovered({ compatibility: 'unknown', health: 'installed' }), true).health)
      .toBe('ready')
  })

  it('never overwrites a health state that already names its own cause', () => {
    expect(publicProvider(discovered({
      compatibility: 'unknown',
      health: 'not-installed',
      installed: false,
      version: null,
      executablePath: null,
    }), false).health).toBe('not-installed')
    expect(publicProvider(discovered({
      compatibility: 'unknown',
      health: 'error',
      version: null,
    }), false).health).toBe('error')
  })

  it('drops the Host executable path from the browser-facing view', () => {
    const view = publicProvider(discovered({ compatibility: 'supported', health: 'installed' }), true)
    expect(view).not.toHaveProperty('executablePath')
    expect(JSON.stringify(view)).not.toContain('/host/path')
  })
})

describe('session admission', () => {
  const candidate = (overrides: {
    installed?: boolean
    compatibility?: ProviderCompatibility
    executablePath?: string | null
  }) => ({
    installed: true,
    compatibility: 'supported' as ProviderCompatibility,
    executablePath: '/host/path/codex',
    ...overrides,
  })

  it('admits an installed, located, supported product', () => {
    expect(isAdmissible(candidate({}), false)).toBe(true)
  })

  it('refuses a product that is absent or could not be located', () => {
    expect(isAdmissible(candidate({ installed: false }), false)).toBe(false)
    expect(isAdmissible(candidate({ executablePath: null }), false)).toBe(false)
    // Even the experimental override cannot conjure an executable.
    expect(isAdmissible(candidate({ executablePath: null }), true)).toBe(false)
  })

  it('refuses a rejected version regardless of the experimental override', () => {
    expect(isAdmissible(candidate({ compatibility: 'unsupported' }), false)).toBe(false)
    // A version that parsed and lost is a decision, not an uncertainty: the
    // override covers unverifiable versions only.
    expect(isAdmissible(candidate({ compatibility: 'unsupported' }), true)).toBe(false)
  })

  it('admits an unverifiable version only under the explicit override', () => {
    expect(isAdmissible(candidate({ compatibility: 'unknown' }), false)).toBe(false)
    expect(isAdmissible(candidate({ compatibility: 'unknown' }), true)).toBe(true)
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
      'sessionCompletions',
      'nativeSessions',
      'directoryAdd',
      'directoryRemove',
      'directoryPublish',
      'sessionPermissionMode',
      'sessionFiles',
      'sessionModels',
      'sessionModel',
      'sessionUpload',
      'sessionRepository',
      'hostList',
      'workspaceList',
      'workspaceFile',
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
