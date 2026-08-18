/**
 * Reading the working directory's version-control state, for the composer's
 * status line.
 *
 * Someone driving an agent from a browser has the same question a terminal answers
 * at a glance: which branch is this, and how much has changed since the last
 * commit. Without it the panel can show an agent rewriting a repository with no
 * indication of where those edits are landing.
 *
 * Read by running `git`, not by parsing `.git`. The porcelain formats are a
 * documented interface with stability guarantees; the on-disk layout is not, and a
 * partial reimplementation of it would be wrong in ways that are hard to notice —
 * worktrees, packed refs, a rebase in progress.
 *
 * Everything here is best-effort. A directory that is not a repository, a Host
 * without `git`, a command that takes too long: all report absence rather than an
 * error, because a missing status line is a cosmetic loss and a failed turn is not.
 */
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'

/** What the panel shows about the working directory's repository. */
export interface RepositoryStatus {
  /**
   * Branch name, or the short commit for a detached HEAD. Null when git reported
   * neither — a repository with no commits yet.
   */
  readonly branch: string | null
  /** True when HEAD is not on a branch, so `branch` is a commit. */
  readonly detached: boolean
  /** Upstream branch as git names it, or null when the branch tracks nothing. */
  readonly upstream: string | null
  /** Commits ahead of the upstream, zero when there is none. */
  readonly ahead: number
  /** Commits behind the upstream. */
  readonly behind: number
  /** Lines added since HEAD, staged and unstaged together. */
  readonly added: number
  /** Lines removed since HEAD. */
  readonly removed: number
}

/**
 * Ceiling for one git invocation. A status read is a status line, not work worth
 * waiting on: a repository large enough to exceed this is better served by no
 * status line than by a stalled panel.
 */
const TIMEOUT_MS = 3_000

/** Output ceiling per stream. A numstat over a huge change set is truncated, not read whole. */
const MAX_BYTES = 512 * 1024

/**
 * Run one git command in a directory and return its stdout.
 * @param subprocess - the Host's process runtime.
 * @param executable - resolved absolute path to git.
 * @param cwd - the directory to run in.
 * @param args - arguments after `git`.
 * @param signal - caller's cancellation.
 * @returns stdout on success, or null when git failed or was killed.
 */
async function run(
  subprocess: SubprocessRuntime,
  executable: string,
  cwd: string,
  args: readonly string[],
  signal?: AbortSignal,
): Promise<string | null> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const child = subprocess.spawn({
    argv: [executable, ...args],
    cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: MAX_BYTES },
      stderr: { maxBytes: 4_096 },
    },
    graceMs: 1_000,
    signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    // No inherited environment: a status read has no business seeing the Host's
    // variables, and git needs none of them to answer.
    env: {
      // Keeps output parseable whatever locale the Host runs in.
      LC_ALL: 'C',
      // Stops git from asking for anything. A status read must never block on a
      // credential prompt, and none of these commands touch a remote.
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
    },
  })
  const outcome = await child.done
  if (outcome.exitCode !== 0) return null
  return child.collected.stdout?.readFrom(0).text ?? ''
}

/**
 * Read the branch, upstream and divergence from `git status --porcelain=v2`.
 *
 * The v2 porcelain header is a documented, stable, machine-readable format — which
 * is why it is used rather than the human output, whose wording changes.
 * @param text - stdout from the status command.
 * @returns the header fields, with divergence defaulting to zero.
 */
function parseStatus(text: string): Pick<RepositoryStatus, 'branch' | 'detached' | 'upstream' | 'ahead' | 'behind'> {
  let head: string | null = null
  let oid: string | null = null
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  for (const line of text.split('\n')) {
    if (!line.startsWith('# branch.')) continue
    const [key, ...rest] = line.slice('# '.length).split(' ')
    const value = rest.join(' ').trim()
    if (key === 'branch.head') head = value
    else if (key === 'branch.oid') oid = value
    else if (key === 'branch.upstream') upstream = value
    else if (key === 'branch.ab') {
      // `+3 -1`, always both, always signed.
      for (const part of value.split(' ')) {
        const count = Number.parseInt(part.slice(1), 10)
        if (Number.isNaN(count)) continue
        if (part.startsWith('+')) ahead = count
        else if (part.startsWith('-')) behind = count
      }
    }
  }
  // git spells a detached HEAD as the literal `(detached)`, and an unborn branch's
  // oid as `(initial)`.
  const detached = head === '(detached)'
  const branch = detached
    ? oid === null || oid.startsWith('(') ? null : oid.slice(0, 8)
    : head === null || head.startsWith('(') ? null : head
  return { branch, detached, upstream, ahead, behind }
}

/**
 * Sum added and removed lines from `git diff --numstat`.
 *
 * Binary files report `-` for both counts and contribute nothing, which is the
 * honest answer: a changed image has no line count.
 * @param text - stdout from the diff command.
 * @returns the totals.
 */
function parseNumstat(text: string): Pick<RepositoryStatus, 'added' | 'removed'> {
  let added = 0
  let removed = 0
  for (const line of text.split('\n')) {
    const [plus, minus] = line.split('\t')
    if (plus === undefined || minus === undefined) continue
    const a = Number.parseInt(plus, 10)
    const b = Number.parseInt(minus, 10)
    if (!Number.isNaN(a)) added += a
    if (!Number.isNaN(b)) removed += b
  }
  return { added, removed }
}

/**
 * Read the repository state of a working directory.
 *
 * @param subprocess - the Host's process runtime.
 * @param cwd - the session's working directory, resolved on the Host.
 * @param signal - caller's cancellation.
 * @returns the status, or null when the directory is not a repository, git is not
 * installed, or the read did not finish in time.
 */
export async function readRepository(
  subprocess: SubprocessRuntime,
  cwd: string,
  signal?: AbortSignal,
): Promise<RepositoryStatus | null> {
  let executable: string
  try {
    executable = await subprocess.resolveExecutable('git', {}, signal)
  } catch {
    return null
  }
  // `--untracked-files=no` because the header is all this needs and counting
  // untracked files in a large tree is the slow part of a status read.
  const status = await run(
    subprocess,
    executable,
    cwd,
    ['status', '--porcelain=v2', '--branch', '--untracked-files=no'],
    signal,
  ).catch(() => null)
  // A non-repository fails here, which is the intended way to find that out: it
  // costs one command instead of a separate rev-parse.
  if (status === null) return null
  // Against HEAD rather than the index, so staged and unstaged changes are counted
  // once, together — which is what a person means by "how much have I changed".
  const numstat = await run(subprocess, executable, cwd, ['diff', '--numstat', 'HEAD'], signal)
    .catch(() => null)
  return {
    ...parseStatus(status),
    // An unborn branch has no HEAD to diff against; zero is correct there, not an
    // absence, because nothing is committed to have diverged from.
    ...numstat === null ? { added: 0, removed: 0 } : parseNumstat(numstat),
  }
}
