/**
 * Platform launch behaviour, asserted for every supported Host from any Host.
 *
 * The bridge's only platform-dependent decision is how a Host-installed CLI is
 * launched. These tests pin all three supported platforms explicitly, so the
 * macOS and Linux forms are verified when the suite runs on Windows and the
 * Windows form is verified when it runs on macOS — the original validation only
 * ever exercised whichever platform the developer happened to be on.
 */
import { describe, expect, it } from 'vitest'
import { nativeCommand, needsBatchShim } from '../../src/core/platform.ts'
import { claudeSpawnSpec } from '../../src/providers/claude-process.ts'
import { executableArgv } from '../../src/providers/codex.ts'
import { versionArgv } from '../../src/core/version.ts'

const POSIX_PLATFORMS: readonly NodeJS.Platform[] = ['darwin', 'linux']

describe('native launch form', () => {
  it('execs the resolved file directly on macOS and Linux', () => {
    for (const platform of POSIX_PLATFORMS) {
      expect(nativeCommand('/usr/local/bin/codex', ['app-server'], 'IGNORED', platform)).toEqual({
        argv: ['/usr/local/bin/codex', 'app-server'],
      })
      // No shell, and therefore no environment variable to carry a path.
      expect(nativeCommand('/usr/local/bin/codex', [], 'IGNORED', platform).env).toBeUndefined()
    }
  })

  it('treats a POSIX path that merely ends in .cmd as an ordinary executable', () => {
    // A Unix file may legally be named `run.cmd`; only Windows needs cmd.exe.
    for (const platform of POSIX_PLATFORMS) {
      expect(needsBatchShim('/opt/tools/run.cmd', platform)).toBe(false)
      expect(nativeCommand('/opt/tools/run.cmd', ['--version'], 'IGNORED', platform).argv)
        .toEqual(['/opt/tools/run.cmd', '--version'])
    }
  })

  it('execs a Windows-resolved binary directly when it is not a batch shim', () => {
    expect(nativeCommand('C:\\Program Files\\codex\\codex.exe', ['--version'], 'IGNORED', 'win32')).toEqual({
      argv: ['C:\\Program Files\\codex\\codex.exe', '--version'],
    })
  })

  it('wraps a Windows batch shim in cmd.exe and keeps the path out of the command line', () => {
    const command = nativeCommand('C:\\npm\\codex.CMD', ['app-server', '--stdio'], 'CODEX_EXE', 'win32')
    expect(command.argv).toEqual([
      'cmd.exe', '/d', '/v:off', '/s', '/c', '%CODEX_EXE%', 'app-server', '--stdio',
    ])
    // The path travels in the environment, quoted, so spaces and shell
    // metacharacters in it cannot become a second command.
    expect(command.env).toEqual({ CODEX_EXE: '"C:\\npm\\codex.CMD"' })
    expect(command.argv.join(' ')).not.toContain('codex.CMD')
  })

  it('recognises a batch shim regardless of extension case', () => {
    for (const executable of ['C:\\npm\\claude.cmd', 'C:\\npm\\claude.CMD', 'C:\\npm\\claude.Bat']) {
      expect(needsBatchShim(executable, 'win32')).toBe(true)
    }
    expect(needsBatchShim('C:\\npm\\claude.exe', 'win32')).toBe(false)
  })
})

describe('per-call-site launch forms', () => {
  it('probes the version directly on POSIX and through cmd.exe on Windows', () => {
    for (const platform of POSIX_PLATFORMS) {
      expect(versionArgv('/Users/dev/.local/bin/claude', platform).argv)
        .toEqual(['/Users/dev/.local/bin/claude', '--version'])
    }
    expect(versionArgv('C:\\npm\\claude.cmd', 'win32').argv)
      .toEqual(['cmd.exe', '/d', '/v:off', '/s', '/c', '%DSH_LOCAL_AGENT_EXECUTABLE%', '--version'])
  })

  it('starts the Codex App Server over stdio on every platform', () => {
    for (const platform of POSIX_PLATFORMS) {
      expect(executableArgv('/opt/homebrew/bin/codex', platform).argv)
        .toEqual(['/opt/homebrew/bin/codex', 'app-server', '--stdio'])
    }
    const windows = executableArgv('C:\\npm\\codex.cmd', 'win32')
    expect(windows.argv.slice(-2)).toEqual(['app-server', '--stdio'])
    expect(windows.env).toEqual({ DSH_LOCAL_AGENT_CODEX_EXECUTABLE: '"C:\\npm\\codex.cmd"' })
  })

  it('spawns the Claude SDK child directly on POSIX, preserving the SDK environment', () => {
    for (const platform of POSIX_PLATFORMS) {
      const spec = claudeSpawnSpec({
        command: '/Users/dev/.local/bin/claude',
        args: ['--output-format', 'stream-json'],
        cwd: '/Users/dev/project',
        env: { CLAUDE_FIXTURE: 'kept' },
      } as unknown as Parameters<typeof claudeSpawnSpec>[0], 3_000, platform)

      expect(spec.argv).toEqual(['/Users/dev/.local/bin/claude', '--output-format', 'stream-json'])
      expect(spec.cwd).toBe('/Users/dev/project')
      expect(spec.env?.CLAUDE_FIXTURE).toBe('kept')
      // No Windows shim variable leaks into a POSIX spawn.
      expect(spec.env).not.toHaveProperty('DSH_LOCAL_AGENT_CLAUDE_EXECUTABLE')
    }
  })

  it('spawns the Claude SDK child through cmd.exe for a Windows shim', () => {
    const spec = claudeSpawnSpec({
      command: 'C:\\npm\\claude.cmd',
      args: ['--output-format', 'stream-json'],
      cwd: 'C:\\dev\\project',
      env: { CLAUDE_FIXTURE: 'kept' },
    } as unknown as Parameters<typeof claudeSpawnSpec>[0], 3_000, 'win32')

    expect(spec.argv[0]).toBe('cmd.exe')
    expect(spec.argv.slice(-2)).toEqual(['--output-format', 'stream-json'])
    expect(spec.env?.DSH_LOCAL_AGENT_CLAUDE_EXECUTABLE).toBe('"C:\\npm\\claude.cmd"')
    // The SDK's own variables survive alongside the shim variable.
    expect(spec.env?.CLAUDE_FIXTURE).toBe('kept')
  })

  it('refuses a Claude spawn with no workspace on every platform', () => {
    for (const platform of [...POSIX_PLATFORMS, 'win32'] as NodeJS.Platform[]) {
      expect(() => claudeSpawnSpec({
        command: '/usr/bin/claude',
        args: [],
        cwd: '',
        env: {},
      } as unknown as Parameters<typeof claudeSpawnSpec>[0], 3_000, platform)).toThrow(/workspace/)
    }
  })
})
