/**
 * Reading the session's working directory: its tree, and one file at a time.
 *
 * The composer's host browser can already list any directory on the machine. This is
 * narrower and answers a different question — what is in *this project* — and it is
 * separate for two reasons. Paths are relative to the working directory, so nothing
 * the browser holds or sends is an absolute Host path. And it reads file contents,
 * which the host browser deliberately does not.
 *
 * Everything is confined after symlinks resolve. A repository can legitimately
 * contain a link pointing anywhere, and a file panel must not become a way to read
 * `~/.ssh/id_rsa` by way of a symlink someone committed.
 */
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { BridgeError } from './errors.ts'

/** One entry in the workspace tree. */
export interface WorkspaceEntry {
  readonly name: string
  /** Path relative to the working directory, forward-slashed. */
  readonly path: string
  readonly directory: boolean
  readonly hidden: boolean
  /** Size in bytes for a file, null for a directory. */
  readonly bytes: number | null
}

export interface WorkspaceListing {
  /** The directory listed, relative to the working directory; empty for the root. */
  readonly path: string
  readonly entries: readonly WorkspaceEntry[]
  readonly truncated: boolean
}

export interface WorkspaceFile {
  readonly path: string
  /** The text, cut at the ceiling. Empty when the file is binary. */
  readonly content: string
  readonly bytes: number
  /** True when the text was cut. */
  readonly truncated: boolean
  /**
   * True when the file is not text. Reported rather than guessed at by extension:
   * the panel says "binary" instead of rendering a screenful of replacement
   * characters.
   */
  readonly binary: boolean
}

/** Entries per directory level. A real directory fits; a pathological one is cut. */
const ENTRY_LIMIT = 1_000

/**
 * Text returned per file.
 *
 * Generous enough for any source file, small enough that a stray 200MB log cannot
 * be pulled through the wire into a browser tab.
 */
const FILE_LIMIT_BYTES = 512 * 1024

/** Directory names never listed, for the reason the file search skips them. */
const SKIPPED = new Set(['.git', 'node_modules', '.pnpm-store'])

/**
 * Resolve a workspace-relative path to an absolute one, refusing anything outside.
 *
 * The check is against the real path on both sides, so a symlink inside the tree
 * pointing out of it is caught. A relative path with `..` in it never gets that far —
 * `relative` reports the escape directly.
 * @param cwd - the session's working directory, resolved on the Host.
 * @param path - workspace-relative path; empty means the root.
 * @returns the resolved absolute path and the real working directory.
 * @throws BridgeError WORKSPACE_NOT_AVAILABLE when the target is outside or missing.
 */
async function resolveInside(cwd: string, path: string): Promise<{ absolute: string; root: string }> {
  let root: string
  try {
    root = await realpath(cwd)
  } catch {
    throw new BridgeError('WORKSPACE_NOT_AVAILABLE')
  }
  const cleaned = path.replaceAll('\\', '/').split('/').filter(part => part.length > 0 && part !== '.')
  // Refused before touching the filesystem: a `..` is never a path within the
  // workspace, whatever it would resolve to.
  if (cleaned.includes('..')) throw new BridgeError('INVALID_REQUEST')
  const absolute = cleaned.length === 0 ? root : join(root, ...cleaned)
  let real: string
  try {
    real = await realpath(absolute)
  } catch {
    throw new BridgeError('WORKSPACE_NOT_AVAILABLE')
  }
  // Confinement after resolution, which is the check a committed symlink has to
  // fail: the path above looks fine, and only the target gives it away.
  if (real !== root && !real.startsWith(root + sep)) throw new BridgeError('WORKSPACE_NOT_AVAILABLE')
  return { absolute: real, root }
}

/**
 * List one level of the working directory.
 *
 * @param cwd - the session's working directory.
 * @param path - workspace-relative directory; empty lists the root.
 * @returns the level, directories first.
 */
export async function listWorkspace(cwd: string, path = ''): Promise<WorkspaceListing> {
  const { absolute, root } = await resolveInside(cwd, path)
  let raw
  try {
    raw = await readdir(absolute, { withFileTypes: true })
  } catch {
    throw new BridgeError('WORKSPACE_NOT_AVAILABLE')
  }

  const entries: WorkspaceEntry[] = []
  let truncated = false
  for (const entry of raw) {
    if (entries.length >= ENTRY_LIMIT) {
      truncated = true
      break
    }
    if (SKIPPED.has(entry.name)) continue
    const child = join(absolute, entry.name)
    let directory = entry.isDirectory()
    let bytes: number | null = null
    if (entry.isSymbolicLink()) {
      const info = await stat(child).catch(() => null)
      if (info === null) continue
      directory = info.isDirectory()
      bytes = directory ? null : info.size
    } else if (directory) {
      bytes = null
    } else if (entry.isFile()) {
      bytes = await stat(child).then(info => info.size).catch(() => null)
    } else {
      continue
    }
    entries.push({
      name: entry.name,
      path: relative(root, child).split(sep).join('/'),
      directory,
      hidden: entry.name.startsWith('.'),
      bytes,
    })
  }

  entries.sort((left, right) => left.directory === right.directory
    ? left.name.localeCompare(right.name)
    : left.directory ? -1 : 1)

  return { path: path.replaceAll('\\', '/'), entries, truncated }
}

/**
 * Read one file from the working directory.
 *
 * @param cwd - the session's working directory.
 * @param path - workspace-relative file path.
 * @returns the text, or a binary marker.
 */
export async function readWorkspaceFile(cwd: string, path: string): Promise<WorkspaceFile> {
  if (path.trim().length === 0) throw new BridgeError('INVALID_REQUEST')
  const { absolute, root } = await resolveInside(cwd, path)
  const info = await stat(absolute).catch(() => null)
  if (info === null || !info.isFile()) throw new BridgeError('WORKSPACE_NOT_AVAILABLE')

  let buffer: Buffer
  try {
    buffer = await readFile(absolute)
  } catch {
    throw new BridgeError('WORKSPACE_NOT_AVAILABLE')
  }

  const relativePath = relative(root, absolute).split(sep).join('/')
  // A NUL byte in the first few kilobytes is the standard, cheap test, and it is
  // right far more often than an extension list: a `.log` can be binary and a file
  // with no extension at all is usually text.
  const head = buffer.subarray(0, Math.min(buffer.byteLength, 8_192))
  if (head.includes(0)) {
    return { path: relativePath, content: '', bytes: buffer.byteLength, truncated: false, binary: true }
  }
  const cut = buffer.byteLength > FILE_LIMIT_BYTES
  return {
    path: relativePath,
    content: buffer.subarray(0, FILE_LIMIT_BYTES).toString('utf8'),
    bytes: buffer.byteLength,
    truncated: cut,
    binary: false,
  }
}
