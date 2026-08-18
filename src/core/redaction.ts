const MAX_TEXT = 16_384
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi

const SECRET_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /\b(?:sk|sess|oauth|access|refresh)[-_][A-Za-z0-9._~+/=-]{8,}\b/gi,
  /("?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie)"?\s*[:=]\s*)[^\s,;}]+/gi,
  /\.(?:claude|codex)(?:[\\/][^\s,;}"']*)?/gi,
  /\b(?:auth\.json|credentials\.json|\.claude(?:\\|\/)|\.codex(?:\\|\/))\b/gi,
  /https?:\/\/[^\s]*(?:oauth|authorize|device)[^\s]*/gi,
  /\b[A-Z0-9]{4}(?:-[A-Z0-9]{4}){1,3}\b/g,
]

export function redactText(value: string, maxLength = MAX_TEXT): string {
  const protectedUuids: string[] = []
  let text = value.replace(UUID_PATTERN, match => {
    const index = protectedUuids.push(match) - 1
    return `__BRIDGE_UUID_${index}__`
  })
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, '[REDACTED]')
  }
  text = text.replace(/__BRIDGE_UUID_(\d+)__/g, (_match, index: string) => protectedUuids[Number(index)] ?? '[REDACTED]')
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}\n[TRUNCATED]`
}

export function redactValue<T>(value: T): T {
  if (typeof value === 'string') return redactText(value) as T
  if (Array.isArray(value)) return value.map(item => redactValue(item)) as T
  if (value === null || typeof value !== 'object') return value
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === 'secret' && typeof item === 'boolean') {
      output[key] = item
    } else if (/token|secret|password|cookie|authorization|credential/i.test(key)) {
      output[key] = '[REDACTED]'
    } else {
      output[key] = redactValue(item)
    }
  }
  return output as T
}

export function credentialLeakMarkers(value: unknown): string[] {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const probes: readonly [string, RegExp][] = [
    ['authorization', /\bauthorization\s*[:=]/i],
    ['bearer', /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/i],
    ['api_key', /\bapi[_-]?key\s*[:=]/i],
    ['access_token', /\baccess[_-]?token\s*[:=]/i],
    ['refresh_token', /\brefresh[_-]?token\s*[:=]/i],
    ['auth.json', /(?:^|[\\/])auth\.json\b/i],
    ['oauth-url', /https?:\/\/[^\s]*(?:oauth|authorize|device)[^\s]*/i],
    ['claude-credential-path', /\.claude[\\/].*(?:credential|auth|token)/i],
    ['codex-credential-path', /\.codex[\\/].*(?:credential|auth|token)/i],
  ]
  return probes.filter(([, pattern]) => pattern.test(text)).map(([name]) => name)
}
