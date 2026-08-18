/**
 * Finding files under a session's working directory, for the composer's `@`
 * completion.
 *
 * Implemented here rather than delegated to the products. Codex exposes
 * `fuzzyFileSearch`, but Claude Code has no equivalent, and maintaining one
 * behaviour per product would mean `@` ranking and ignore rules differing between
 * two panels that look identical. One implementation is also the only way to keep
 * the traversal bounded on the Host's terms rather than a vendor's.
 *
 * Three constraints shape it:
 *
 * **Confinement.** Every result is verified to sit under the session's working
 * directory after symlinks are resolved. A repository can legitimately contain a
 * link pointing anywhere on the Host, and `@` must not become a way to enumerate
 * the filesystem from a browser.
 *
 * **Budget, not completeness.** The walk stops at a fixed number of visited
 * entries. A completion list is read while typing, so a bounded partial answer
 * beats a complete one that arrives late — and an unbounded walk of a large
 * monorepo would block the Host's event loop.
 *
 * **Ignoring the obvious.** Skipping `.git` and dependency directories is what
 * makes the budget go to files a person might reference. This is a fixed list
 * rather than `.gitignore` parsing: a partial gitignore implementation would be
 * wrong in ways that are hard to see, and the fixed list is honest about what it
 * does.
 */
import { readdir, realpath } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

/** One match, as the browser needs it. */
export interface FileMatch {
  /** Path relative to the working directory, with forward slashes. */
  readonly path: string
  /** Base name, for ranking and display. */
  readonly name: string
  /**
   * True for a directory.
   *
   * Directories are listed because both products accept one as context — `@src/`
   * is a normal thing to write — and because the composer's file button offers
   * "file or folder". The panel appends the trailing slash rather than the Host
   * baking it into the path, so the same match can be displayed and inserted
   * differently.
   */
  readonly directory: boolean
}

export interface FileSearchResult {
  readonly matches: readonly FileMatch[]
  /** True when the walk hit its budget before exhausting the tree. */
  readonly partial: boolean
}

/**
 * Directory names never worth spending budget on.
 *
 * Version-control internals and dependency trees: enormous, and nothing inside
 * them is what someone means by `@`.
 */
const SKIPPED_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', '.jj',
  'node_modules', '.pnpm-store', 'vendor', 'target', 'dist', 'build', 'out',
  '.next', '.nuxt', '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache',
  '.gradle', '.idea', '.vscode', 'coverage', '.turbo', '.cache', 'DerivedData',
])

/** Entries visited before the walk gives up. Enough for a large repo's source tree. */
const VISIT_BUDGET = 12_000

/** Matches returned at most; a completion list is scanned, not paged. */
const MATCH_LIMIT = 40

/** Directory depth ceiling, so one pathological tree cannot consume the budget. */
const MAX_DEPTH = 12

/**
 * Rank a candidate against the query. Lower is better; null means no match.
 *
 * A base-name prefix beats a base-name substring, which beats a path substring —
 * typing `main` should offer `src/main.ts` before `src/domain/utils.ts`. Shorter
 * paths win ties, because the shallower file is usually the intended one.
 * @param match - candidate file.
 * @param needle - lowercased query; empty matches everything.
 * @returns a sort key, or null when the candidate does not match.
 */
function score(match: FileMatch, needle: string): number | null {
  if (needle.length === 0) return match.path.length
  const name = match.name.toLowerCase()
  const path = match.path.toLowerCase()
  if (name.startsWith(needle)) return match.path.length
  if (name.includes(needle)) return 10_000 + match.path.length
  if (path.includes(needle)) return 20_000 + match.path.length
  return null
}

/**
 * Find files and directories under a working directory matching a query.
 *
 * @param root - the session's working directory, already resolved on the Host.
 * @param query - what the operator typed after `@`; empty lists the shallowest files.
 * @returns ranked matches, flagged partial when the budget ran out.
 */
export async function searchFiles(root: string, query: string): Promise<FileSearchResult> {
  let realRoot: string
  try {
    realRoot = await realpath(root)
  } catch {
    return { matches: [], partial: false }
  }
  const needle = query.trim().toLowerCase()
  const found: { match: FileMatch; rank: number }[] = []
  const queue: { dir: string; depth: number }[] = [{ dir: realRoot, depth: 0 }]
  let visited = 0
  let partial = false

  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined) break
    if (visited >= VISIT_BUDGET) {
      partial = true
      break
    }
    let entries
    try {
      entries = await readdir(current.dir, { withFileTypes: true })
    } catch {
      // An unreadable directory is not an error worth surfacing: the operator
      // sees the files they can reach.
      continue
    }
    for (const entry of entries) {
      visited += 1
      if (visited >= VISIT_BUDGET) {
        partial = true
        break
      }
      // Dotfiles other than the skipped directories stay visible — `.github` and
      // `.env.example` are things people reference.
      const directory = entry.isDirectory()
      if (directory) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue
        if (current.depth + 1 <= MAX_DEPTH) {
          queue.push({ dir: join(current.dir, entry.name), depth: current.depth + 1 })
        }
        // Falls through rather than continuing: a directory is both somewhere to
        // walk into and something the operator can reference.
      } else if (!entry.isFile() && !entry.isSymbolicLink()) {
        continue
      }
      const absolute = join(current.dir, entry.name)
      const relativePath = relative(realRoot, absolute)
      // Confinement: a `..` prefix means the entry escaped the root, which a
      // symlink inside the tree can legitimately do.
      if (relativePath.length === 0 || relativePath.startsWith('..')) continue
      const match: FileMatch = { path: relativePath.split(sep).join('/'), name: entry.name, directory }
      const rank = score(match, needle)
      if (rank === null) continue
      found.push({ match, rank })
    }
  }

  // A symlinked entry can still point outside the root even when its path inside
  // the tree looks fine, so the survivors are resolved before being returned.
  const ranked = found.sort((left, right) => left.rank - right.rank).slice(0, MATCH_LIMIT * 2)
  const confined: FileMatch[] = []
  for (const entry of ranked) {
    if (confined.length >= MATCH_LIMIT) break
    try {
      const real = await realpath(join(realRoot, entry.match.path))
      if (real !== realRoot && !real.startsWith(realRoot + sep)) continue
    } catch {
      continue
    }
    confined.push(entry.match)
  }
  return { matches: confined, partial: partial || found.length > confined.length }
}
