/**
 * Process projection adapted from DeepSeek Harness' MIT-licensed Claude Code
 * subagent provider. The official SDK retains protocol ownership; DSH retains
 * process-tree ownership and cleanup.
 */
import { EventEmitter } from 'node:events'
import { extname } from 'node:path'
import type {
  SpawnedProcess,
  SpawnOptions,
} from '@anthropic-ai/claude-agent-sdk'
import {
  scrubbedParentEnv,
  type SubprocessHandle,
  type SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'

const WINDOWS_BATCH_EXECUTABLE_ENV = 'DSH_LOCAL_AGENT_CLAUDE_EXECUTABLE'

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function sdkEnvironmentOverlay(env: SpawnOptions['env']): NodeJS.ProcessEnv {
  const overlay: NodeJS.ProcessEnv = { ...env }
  for (const name of Object.keys(scrubbedParentEnv())) {
    if (!(name in env)) overlay[name] = undefined
  }
  return overlay
}

export function claudeSpawnSpec(
  options: SpawnOptions,
  graceMs: number,
  platform: NodeJS.Platform = process.platform,
): SubprocessSpawnSpec {
  if (options.cwd === undefined || options.cwd.length === 0) {
    throw new Error('local-agent-bridge: Claude SDK omitted its workspace')
  }
  const extension = extname(options.command).toLowerCase()
  const batchShim = platform === 'win32' && (extension === '.cmd' || extension === '.bat')
  const env = sdkEnvironmentOverlay(options.env)
  const argv = batchShim
    ? ['cmd.exe', '/d', '/v:off', '/s', '/c', `%${WINDOWS_BATCH_EXECUTABLE_ENV}%`, ...options.args]
    : [options.command, ...options.args]
  if (batchShim) env[WINDOWS_BATCH_EXECUTABLE_ENV] = `"${options.command}"`
  return {
    argv,
    cwd: options.cwd,
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' },
    graceMs,
    signal: options.signal,
    env,
  }
}

export class ManagedClaudeProcess implements SpawnedProcess {
  readonly stdin
  readonly stdout
  private readonly events = new EventEmitter()
  private exitCodeValue: number | null = null
  private signalCodeValue: NodeJS.Signals | null = null
  private killRequested = false

  constructor(readonly child: SubprocessHandle) {
    this.stdin = child.stdin as NonNullable<SubprocessHandle['stdin']>
    this.stdout = child.stdout as NonNullable<SubprocessHandle['stdout']>
    this.events.on('error', () => {})
    void child.done.then(
      (outcome) => {
        this.exitCodeValue = outcome.exitCode
        this.signalCodeValue = outcome.signal
        this.events.emit('exit', outcome.exitCode, outcome.signal)
      },
      (error: unknown) => { this.events.emit('error', asError(error)) },
    )
  }

  get killed(): boolean {
    return this.killRequested
  }

  get exitCode(): number | null {
    return this.exitCodeValue
  }

  get signalCode(): NodeJS.Signals | null {
    return this.signalCodeValue
  }

  kill(_signal: NodeJS.Signals): boolean {
    if (this.killRequested || this.exitCodeValue !== null || this.signalCodeValue !== null) return false
    this.killRequested = true
    this.child.terminate()
    return true
  }

  on(
    event: 'exit' | 'error',
    listener: ((code: number | null, signal: NodeJS.Signals | null) => void) | ((error: Error) => void),
  ): void {
    this.events.on(event, listener)
  }

  once(
    event: 'exit' | 'error',
    listener: ((code: number | null, signal: NodeJS.Signals | null) => void) | ((error: Error) => void),
  ): void {
    this.events.once(event, listener)
  }

  off(
    event: 'exit' | 'error',
    listener: ((code: number | null, signal: NodeJS.Signals | null) => void) | ((error: Error) => void),
  ): void {
    this.events.off(event, listener)
  }
}

