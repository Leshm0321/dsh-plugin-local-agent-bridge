import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { satisfies, valid } from 'semver'
import type { NativeProviderView, ProviderCompatibility, ProviderId } from '../types.ts'
import { BridgeError } from './errors.ts'
import { redactText } from './redaction.ts'

const VERSION_RANGES: Record<'codex' | 'claude', string> = {
  codex: '0.147.x',
  claude: '>=2.1.220 <2.2.0',
}

export interface DiscoveryOptions {
  readonly allowExperimentalVersions: boolean
  readonly signal?: AbortSignal
}

function versionArgv(executable: string): { argv: string[]; env?: NodeJS.ProcessEnv } {
  if (process.platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(executable)) {
    return { argv: [executable, '--version'] }
  }
  return {
    argv: ['cmd.exe', '/d', '/v:off', '/s', '/c', '%DSH_LOCAL_AGENT_EXECUTABLE%', '--version'],
    env: { DSH_LOCAL_AGENT_EXECUTABLE: `"${executable}"` },
  }
}

export function parseProductVersion(output: string): string | null {
  const match = output.match(/\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/i)
  return match?.[1] ?? null
}

export function compatibilityFor(
  id: 'codex' | 'claude',
  version: string | null,
  allowExperimentalVersions: boolean,
): ProviderCompatibility {
  if (version === null || valid(version) === null) return 'unknown'
  if (satisfies(version, VERSION_RANGES[id])) return 'supported'
  return allowExperimentalVersions ? 'unknown' : 'unsupported'
}

export async function discoverProvider(
  subprocess: SubprocessRuntime,
  id: 'codex' | 'claude',
  options: DiscoveryOptions,
): Promise<NativeProviderView & { readonly executablePath: string | null }> {
  const displayName = id === 'codex' ? 'Codex' : 'Claude Code'
  let executablePath: string
  try {
    executablePath = await subprocess.resolveExecutable(id, {}, options.signal)
  } catch {
    return {
      id,
      displayName,
      executablePath: null,
      installed: false,
      version: null,
      supportedRange: VERSION_RANGES[id],
      compatibility: 'unknown',
      health: 'not-installed',
      // Phrased by the Client: the browser knows which language to say
      // "not on the Host PATH" in, and the Host does not.
      message: null,
    }
  }

  const command = versionArgv(executablePath)
  const child = subprocess.spawn({
    argv: command.argv,
    cwd: process.cwd(),
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 16_384 },
      stderr: { maxBytes: 16_384 },
    },
    graceMs: 3_000,
    signal: options.signal,
    env: command.env,
  })
  const outcome = await child.done
  const stdout = child.collected.stdout?.readFrom(0).text ?? ''
  const stderr = child.collected.stderr?.readFrom(0).text ?? ''
  if (outcome.exitCode !== 0) {
    return {
      id,
      displayName,
      executablePath,
      installed: true,
      version: null,
      supportedRange: VERSION_RANGES[id],
      compatibility: 'unknown',
      health: 'error',
      // The product's own stderr is the only useful explanation here and the
      // Client cannot reconstruct it, so this one state keeps Host text.
      message: stderr.trim().length === 0 ? null : redactText(stderr, 512),
    }
  }
  const version = parseProductVersion(`${stdout}\n${stderr}`)
  const compatibility = compatibilityFor(id, version, options.allowExperimentalVersions)
  return {
    id,
    displayName,
    executablePath,
    installed: true,
    version,
    supportedRange: VERSION_RANGES[id],
    compatibility,
    health: 'installed',
    // A rejected or unverifiable version is fully described by `compatibility`,
    // `version`, and `supportedRange`; the Client renders that in its locale.
    message: null,
  }
}

/**
 * Project one discovered product into the browser-facing view, dropping the
 * Host filesystem path and resolving the health the operator must act on.
 *
 * A product whose version was read but rejected reports `unsupported` rather
 * than the raw `installed`: that is the state the operations Health table
 * documents, and the Client needs it to explain why the product is present
 * yet unusable. `not-installed` and `error` already describe themselves and
 * are never overwritten.
 * @param provider - discovery result including its resolved executable path.
 * @param ready - whether a usable adapter was constructed for this product.
 * @returns the redacted provider view.
 */
export function publicProvider(
  provider: NativeProviderView & { readonly executablePath: string | null },
  ready: boolean,
): NativeProviderView {
  return {
    id: provider.id,
    displayName: provider.displayName,
    installed: provider.installed,
    version: provider.version,
    supportedRange: provider.supportedRange,
    compatibility: provider.compatibility,
    health: ready
      ? 'ready'
      : provider.health === 'installed' && provider.compatibility !== 'supported'
        ? 'unsupported'
        : provider.health,
    message: provider.message,
  }
}

export function assertProviderSupported(provider: NativeProviderView): void {
  if (!provider.installed) throw new BridgeError('EXECUTABLE_NOT_FOUND')
  if (provider.compatibility !== 'supported') throw new BridgeError('UNSUPPORTED_VERSION')
}

export function supportedVersionRange(id: ProviderId): string | null {
  return id === 'fake' ? null : VERSION_RANGES[id]
}
