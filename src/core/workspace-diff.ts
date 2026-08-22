/**
 * Reading what is uncommitted in the working directory.
 *
 * Against HEAD, so staged and unstaged changes are one view — which is what a person
 * means by "what have I changed". The diff comes from git's own unified output rather
 * than from comparing files here: git knows about rename detection, whitespace
 * options, text conversion filters and binary files, and a reimplementation would be
 * wrong about all four.
 *
 * Untracked files are listed but carry no hunks. They have no side to diff against,
 * and rendering a whole new file as one enormous addition would bury the actual
 * changes it sits beside. The panel says what they are and offers the file viewer.
 */
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { resolveGit, runGit } from './repository.ts'

/** One line of a hunk, with the numbers it has on each side. */
export interface DiffLine {
  readonly kind: 'context' | 'added' | 'removed'
  readonly text: string
  /** Line number on the old side, or null for an addition. */
  readonly oldNumber: number | null
  /** Line number on the new side, or null for a removal. */
  readonly newNumber: number | null
}

export interface DiffHunk {
  /** git's own `@@` header, which names the ranges and sometimes the enclosing function. */
  readonly header: string
  readonly lines: readonly DiffLine[]
}

/** One changed file, as the list shows it. */
export interface DiffEntry {
  /** Path relative to the working directory. */
  readonly path: string
  readonly added: number
  readonly removed: number
  /** True when git reports no line counts, which is how it describes a binary change. */
  readonly binary: boolean
  /** True when the file is not in the index at all, so there is nothing to diff. */
  readonly untracked: boolean
}

export interface WorkspaceDiff {
  readonly entries: readonly DiffEntry[]
  /** True when the directory is not a git repository, or git is not installed. */
  readonly unavailable: boolean
}

/** Hunks returned for one file. A change larger than this is read in the file viewer. */
const HUNK_LIMIT = 400

/**
 * List the files that differ from HEAD, plus anything untracked.
 *
 * @param subprocess - the Host's process runtime.
 * @param cwd - the session's working directory.
 * @returns changed files, or `unavailable` when there is no repository to ask.
 */
export async function listWorkspaceDiff(
  subprocess: SubprocessRuntime,
  cwd: string,
): Promise<WorkspaceDiff> {
  const git = await resolveGit(subprocess)
  if (git === null) return { entries: [], unavailable: true }

  const numstat = await runGit(subprocess, git, cwd, ['diff', '--numstat', 'HEAD']).catch(() => null)
  // A non-repository fails this, which is how that is detected — one command rather
  // than a separate rev-parse.
  if (numstat === null) return { entries: [], unavailable: true }

  const entries: DiffEntry[] = []
  for (const line of numstat.split('\n')) {
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const [plus, minus, ...rest] = parts
    const path = rest.join('\t')
    if (path.length === 0) continue
    const added = Number.parseInt(plus ?? '', 10)
    const removed = Number.parseInt(minus ?? '', 10)
    // git writes `-` for both counts on a binary file, which is also how it says
    // "there are no lines to count here".
    const binary = Number.isNaN(added) || Number.isNaN(removed)
    entries.push({
      path,
      added: binary ? 0 : added,
      removed: binary ? 0 : removed,
      binary,
      untracked: false,
    })
  }

  // Untracked files come from status, because a diff against HEAD cannot mention a
  // file HEAD has never heard of.
  const status = await runGit(
    subprocess,
    git,
    cwd,
    ['status', '--porcelain', '--untracked-files=normal'],
  ).catch(() => null)
  for (const line of (status ?? '').split('\n')) {
    if (!line.startsWith('?? ')) continue
    const path = line.slice(3).trim()
    if (path.length === 0 || path.endsWith('/')) continue
    entries.push({ path, added: 0, removed: 0, binary: false, untracked: true })
  }

  entries.sort((left, right) => left.path.localeCompare(right.path))
  return { entries, unavailable: false }
}

/**
 * Parse git's unified diff for one file into hunks with line numbers on both sides.
 *
 * Numbers are tracked rather than displayed from the header alone, because that is
 * what a side-by-side view needs: every line has to know which row it occupies on
 * each side, and only walking the hunk gives that.
 * @param text - git's output for a single file.
 * @returns the hunks, in order.
 */
export function parseUnifiedDiff(text: string): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let current: { header: string; lines: DiffLine[] } | null = null
  let oldLine = 0
  let newLine = 0

  for (const line of text.split('\n')) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (header !== null) {
      if (current !== null) hunks.push(current)
      oldLine = Number.parseInt(header[1] ?? '1', 10)
      newLine = Number.parseInt(header[2] ?? '1', 10)
      current = { header: line, lines: [] }
      continue
    }
    if (current === null) continue
    if (current.lines.length >= HUNK_LIMIT) continue
    // `\ No newline at end of file` is a note about the line above, not a line.
    if (line.startsWith('\\')) continue
    if (line.startsWith('+')) {
      current.lines.push({ kind: 'added', text: line.slice(1), oldNumber: null, newNumber: newLine })
      newLine += 1
    } else if (line.startsWith('-')) {
      current.lines.push({ kind: 'removed', text: line.slice(1), oldNumber: oldLine, newNumber: null })
      oldLine += 1
    } else if (line.startsWith(' ')) {
      current.lines.push({ kind: 'context', text: line.slice(1), oldNumber: oldLine, newNumber: newLine })
      oldLine += 1
      newLine += 1
    }
  }
  if (current !== null) hunks.push(current)
  return hunks
}

/**
 * Read one file's diff against HEAD.
 *
 * @param subprocess - the Host's process runtime.
 * @param cwd - the session's working directory.
 * @param path - the file's path as the listing reported it.
 * @returns the hunks, empty when there is nothing to show.
 */
export async function readFileDiff(
  subprocess: SubprocessRuntime,
  cwd: string,
  path: string,
): Promise<DiffHunk[]> {
  const git = await resolveGit(subprocess)
  if (git === null) return []
  // `--` separates the path from anything git might read as a revision, which matters
  // because the path came from a listing rather than from the operator.
  const text = await runGit(
    subprocess,
    git,
    cwd,
    ['diff', '--no-color', 'HEAD', '--', path],
  ).catch(() => null)
  return text === null ? [] : parseUnifiedDiff(text)
}
