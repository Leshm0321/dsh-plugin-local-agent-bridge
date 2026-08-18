/**
 * Reading the working directory's version-control state.
 *
 * Driven with the exact bytes real `git` produced on this repository, rather than
 * against a live git: the parsing is the part that can be wrong, and pinning it to
 * recorded output means the suite says the same thing on a machine without git and
 * fails when a format assumption stops holding.
 *
 * The formats are the documented porcelain ones for that reason — `--porcelain=v2`
 * carries a stability guarantee that the human-readable output does not.
 */
import type { SubprocessHandle, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it } from 'vitest'
import { readRepository } from '../../src/core/repository.ts'

/** One recorded git invocation: what it was asked, and what it answered. */
interface Reply {
  readonly exitCode: number
  readonly stdout: string
}

/**
 * A runtime that answers from a script keyed by the git subcommand.
 *
 * Only the two members `readRepository` touches are implemented; anything else
 * being called is a change worth failing on rather than absorbing.
 * @param replies - stdout per subcommand, or a missing key for a command that fails.
 * @param resolves - whether git is found on the Host at all.
 * @returns the fake runtime, the commands it was asked to run, and their environments.
 */
function runtime(replies: Readonly<Record<string, Reply>>, resolves = true): {
  readonly subprocess: SubprocessRuntime
  readonly commands: string[][]
  readonly envs: (Readonly<Record<string, string>> | undefined)[]
} {
  const commands: string[][] = []
  const envs: (Readonly<Record<string, string>> | undefined)[] = []
  const subprocess = {
    resolveExecutable: async (command: string) => {
      if (!resolves) throw new Error(`${command} not found`)
      return `/usr/bin/${command}`
    },
    spawn: (spec: SubprocessSpawnSpec): SubprocessHandle => {
      const argv = [...spec.argv]
      commands.push(argv)
      envs.push(spec.env as Readonly<Record<string, string>> | undefined)
      const key = argv[1] ?? ''
      const reply = replies[key] ?? { exitCode: 128, stdout: '' }
      return {
        pid: 1,
        stdin: undefined,
        stdout: undefined,
        stderr: undefined,
        collected: {
          stdout: { readFrom: () => ({ text: reply.stdout, bytes: 0, truncated: false }) },
        },
        done: Promise.resolve({ exitCode: reply.exitCode, signal: null }),
        terminate: () => {},
        waitForExit: async () => true,
      } as unknown as SubprocessHandle
    },
  } as unknown as SubprocessRuntime
  return { subprocess, commands, envs }
}

/** Recorded from this repository, with a remote-tracking branch added. */
const TRACKING_STATUS = [
  '# branch.oid e290aa4a31d36a596671091b70309bd0f388b2eb',
  '# branch.head master',
  '# branch.upstream origin/master',
  '# branch.ab +3 -1',
  '1 .M N... 100644 100644 100644 31965d3 31965d3 src/core/persistence.ts',
  '',
].join('\n')

/** Recorded from this repository as it actually is: a branch with no remote. */
const UNTRACKED_STATUS = [
  '# branch.oid e290aa4a31d36a596671091b70309bd0f388b2eb',
  '# branch.head master',
  '1 .M N... 100644 100644 100644 31965d3 31965d3 src/core/persistence.ts',
  '',
].join('\n')

const DETACHED_STATUS = [
  '# branch.oid e290aa4a31d36a596671091b70309bd0f388b2eb',
  '# branch.head (detached)',
  '',
].join('\n')

const NUMSTAT = ['3\t0\tsrc/core/persistence.ts', '11\t2\tsrc/core/provider.ts', ''].join('\n')

describe('repository status', () => {
  it('reads the branch, its upstream, and how far each has moved', async () => {
    const { subprocess, commands } = runtime({
      status: { exitCode: 0, stdout: TRACKING_STATUS },
      diff: { exitCode: 0, stdout: NUMSTAT },
    })

    expect(await readRepository(subprocess, '/repo')).toEqual({
      branch: 'master',
      detached: false,
      upstream: 'origin/master',
      ahead: 3,
      behind: 1,
      added: 14,
      removed: 2,
    })
    // Untracked files are deliberately not counted: the header is all this needs,
    // and walking a large tree for them is the slow part of a status read.
    expect(commands[0]).toContain('--untracked-files=no')
    // Against HEAD, so staged and unstaged changes are counted once, together.
    expect(commands[1]).toEqual(['/usr/bin/git', 'diff', '--numstat', 'HEAD'])
  })

  it('reports no upstream for a branch that tracks nothing', async () => {
    const { subprocess } = runtime({
      status: { exitCode: 0, stdout: UNTRACKED_STATUS },
      diff: { exitCode: 0, stdout: NUMSTAT },
    })

    const status = await readRepository(subprocess, '/repo')
    // git omits the line entirely rather than reporting an empty one, which is
    // what this repository actually looks like.
    expect(status?.upstream).toBeNull()
    expect(status?.ahead).toBe(0)
    expect(status?.behind).toBe(0)
  })

  it('names a detached HEAD by its commit rather than pretending it is a branch', async () => {
    const { subprocess } = runtime({
      status: { exitCode: 0, stdout: DETACHED_STATUS },
      diff: { exitCode: 0, stdout: '' },
    })

    expect(await readRepository(subprocess, '/repo')).toEqual({
      branch: 'e290aa4a',
      detached: true,
      upstream: null,
      ahead: 0,
      behind: 0,
      added: 0,
      removed: 0,
    })
  })

  it('counts nothing for a binary change instead of guessing a line count', async () => {
    const { subprocess } = runtime({
      status: { exitCode: 0, stdout: UNTRACKED_STATUS },
      diff: { exitCode: 0, stdout: ['-\t-\tlogo.png', '5\t1\tREADME.md', ''].join('\n') },
    })

    const status = await readRepository(subprocess, '/repo')
    expect(status?.added).toBe(5)
    expect(status?.removed).toBe(1)
  })

  it('reports nothing at all when the directory is not a repository', async () => {
    // git exits 128 outside a work tree, which is how this finds out — one command
    // rather than a separate rev-parse.
    const { subprocess } = runtime({ diff: { exitCode: 0, stdout: NUMSTAT } })
    expect(await readRepository(subprocess, '/tmp')).toBeNull()
  })

  it('reports nothing when the Host has no git, without failing', async () => {
    const { subprocess, commands } = runtime({}, false)
    expect(await readRepository(subprocess, '/repo')).toBeNull()
    expect(commands).toEqual([])
  })

  it('still reports the branch when the diff cannot be taken', async () => {
    // An unborn branch has no HEAD to diff against. Zero changed lines is correct
    // there — nothing is committed to have diverged from — and losing the branch
    // name over it would be worse.
    const { subprocess } = runtime({ status: { exitCode: 0, stdout: UNTRACKED_STATUS } })
    const status = await readRepository(subprocess, '/repo')
    expect(status?.branch).toBe('master')
    expect(status?.added).toBe(0)
  })

  it('asks git for nothing that could block on a prompt or a lock', async () => {
    const { subprocess, envs } = runtime({
      status: { exitCode: 0, stdout: UNTRACKED_STATUS },
      diff: { exitCode: 0, stdout: NUMSTAT },
    })
    await readRepository(subprocess, '/repo')

    // Asserted rather than assumed: a status read that waits on a credential
    // prompt would hang the panel, and taking the index lock would fight the
    // operator's own terminal.
    for (const env of envs) {
      expect(env).toMatchObject({
        GIT_TERMINAL_PROMPT: '0',
        GIT_OPTIONAL_LOCKS: '0',
        LC_ALL: 'C',
      })
      // And nothing inherited: a status read has no business seeing the Host's
      // environment, and git needs none of it to answer.
      expect(Object.keys(env ?? {}).sort()).toEqual(['GIT_OPTIONAL_LOCKS', 'GIT_TERMINAL_PROMPT', 'LC_ALL'])
    }
  })
})
