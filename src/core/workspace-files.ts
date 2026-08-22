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
import { mkdir, readFile, readdir, realpath, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
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
  /**
   * What the file looked like when it was read: modification time and size.
   *
   * Sent back on a write so the Host can refuse one that would overwrite a change
   * made since. The agent is editing the same tree, and losing its work to a
   * stale editor buffer is the failure this exists to prevent. Opaque to the
   * browser, which only has to hand it back.
   */
  readonly revision: string
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

/**
 * Largest file the panel may write.
 *
 * Smaller than the read ceiling on purpose: reading a big file is a look, writing one
 * is a change, and an editor buffer that large is not something anyone typed.
 */
const WRITE_LIMIT_BYTES = 2 * 1024 * 1024

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
  const revision = `${String(Math.trunc(info.mtimeMs))}-${String(info.size)}`
  // A NUL byte in the first few kilobytes is the standard, cheap test, and it is
  // right far more often than an extension list: a `.log` can be binary and a file
  // with no extension at all is usually text.
  const head = buffer.subarray(0, Math.min(buffer.byteLength, 8_192))
  if (head.includes(0)) {
    return { path: relativePath, revision, content: '', bytes: buffer.byteLength, truncated: false, binary: true }
  }
  const cut = buffer.byteLength > FILE_LIMIT_BYTES
  return {
    path: relativePath,
    revision,
    content: buffer.subarray(0, FILE_LIMIT_BYTES).toString('utf8'),
    bytes: buffer.byteLength,
    truncated: cut,
    binary: false,
  }
}

/**
 * Resolve a path whose target may not exist yet, by confining its parent.
 *
 * Creating and renaming both name something that is not there, so the existing-path
 * check cannot be used. The parent is what gets confined instead, and the final
 * segment is required to be a single name — which is what stops `a/../../b` reaching
 * out through a directory that is itself inside the workspace.
 * @param cwd - the session's working directory.
 * @param path - workspace-relative path to a file or directory that may not exist.
 * @returns the absolute target and the real working directory.
 * The parent must already exist. Creating intermediate directories from a browser
 * would let one mistyped path produce a tree nobody asked for, and the panel always
 * creates into a directory the operator has open.
 * @throws BridgeError INVALID_REQUEST for an unusable path, or
 * WORKSPACE_NOT_AVAILABLE when the parent directory does not exist.
 */
async function resolveTarget(cwd: string, path: string): Promise<{ absolute: string; root: string }> {
  const parts = path.replaceAll('\\', '/').split('/').filter(part => part.length > 0 && part !== '.')
  const name = parts.at(-1)
  if (name === undefined || parts.includes('..')) throw new BridgeError('INVALID_REQUEST')
  // Names that mean something to a filesystem rather than being one.
  if (name === '.' || name.includes('\0')) throw new BridgeError('INVALID_REQUEST')
  const parent = await resolveInside(cwd, parts.slice(0, -1).join('/'))
  const absolute = join(parent.absolute, name)
  // The parent is confined and the last segment is a single name, so this cannot
  // land outside — asserted anyway, because it is one comparison and it is the
  // property everything else here depends on.
  const inside = relative(parent.root, absolute)
  if (inside.length === 0 || inside.startsWith('..')) throw new BridgeError('INVALID_REQUEST')
  return { absolute, root: parent.root }
}

/**
 * Write a file, refusing to overwrite a change made since it was read.
 *
 * The revision check is the point. The agent is working in this same tree, and a
 * panel that wrote whatever its buffer held would silently discard whatever the agent
 * had just done. A mismatch is reported so the operator can re-read and decide.
 * @param cwd - the session's working directory.
 * @param path - workspace-relative file path; the file must already exist.
 * @param content - the new contents.
 * @param revision - the revision the editor was opened at.
 * @returns the file as it now stands, with a fresh revision.
 * @throws BridgeError INVALID_REQUEST when the content is too large or the revision
 * no longer matches.
 */
export async function writeWorkspaceFile(
  cwd: string,
  path: string,
  content: string,
  revision: string,
): Promise<WorkspaceFile> {
  if (Buffer.byteLength(content, 'utf8') > WRITE_LIMIT_BYTES) throw new BridgeError('INVALID_REQUEST')
  const { absolute } = await resolveInside(cwd, path)
  const info = await stat(absolute).catch(() => null)
  if (info === null || !info.isFile()) throw new BridgeError('WORKSPACE_NOT_AVAILABLE')
  const current = `${String(Math.trunc(info.mtimeMs))}-${String(info.size)}`
  if (current !== revision) throw new BridgeError('INVALID_REQUEST')
  await writeFile(absolute, content, 'utf8')
  return await readWorkspaceFile(cwd, path)
}

/**
 * Create an empty file or a directory.
 *
 * Never overwrites: an existing path is refused rather than emptied, because "new
 * file" and "erase that file" are different intentions and only one of them was
 * expressed.
 * @param cwd - the session's working directory.
 * @param path - workspace-relative path to create.
 * @param directory - true for a directory, false for an empty file.
 * @throws BridgeError INVALID_REQUEST when the path exists or cannot be used.
 */
export async function createWorkspaceEntry(cwd: string, path: string, directory: boolean): Promise<void> {
  const { absolute } = await resolveTarget(cwd, path)
  if (await stat(absolute).then(() => true).catch(() => false)) {
    throw new BridgeError('INVALID_REQUEST')
  }
  if (directory) {
    await mkdir(absolute)
    return
  }
  // `wx` rather than a plain write, so two panels racing cannot both believe they
  // created it.
  await writeFile(absolute, '', { flag: 'wx' })
}

/**
 * Rename or move an entry within the workspace.
 *
 * Both ends are confined, so this cannot move something out of the tree or pull
 * something in. The destination must not exist, for the same reason creating does not
 * overwrite.
 * @param cwd - the session's working directory.
 * @param from - existing workspace-relative path.
 * @param to - new workspace-relative path.
 * @throws BridgeError INVALID_REQUEST when the destination exists or a path is unusable.
 */
export async function renameWorkspaceEntry(cwd: string, from: string, to: string): Promise<void> {
  const source = await resolveInside(cwd, from)
  const target = await resolveTarget(cwd, to)
  if (source.absolute === source.root) throw new BridgeError('INVALID_REQUEST')
  if (await stat(target.absolute).then(() => true).catch(() => false)) {
    throw new BridgeError('INVALID_REQUEST')
  }
  await rename(source.absolute, target.absolute)
}

/**
 * Delete a file, or a directory that is empty.
 *
 * Deliberately not recursive. A recursive delete reachable from a browser is a way to
 * lose a repository to one mis-click, and "lightweight file management" does not need
 * it — a directory with contents can be emptied one visible item at a time.
 * @param cwd - the session's working directory.
 * @param path - workspace-relative path to remove.
 * @throws BridgeError INVALID_REQUEST for the workspace root or a non-empty directory.
 */
export async function deleteWorkspaceEntry(cwd: string, path: string): Promise<void> {
  const { absolute, root } = await resolveInside(cwd, path)
  // Deleting the workspace itself is never what was meant.
  if (absolute === root) throw new BridgeError('INVALID_REQUEST')
  const info = await stat(absolute).catch(() => null)
  if (info === null) throw new BridgeError('WORKSPACE_NOT_AVAILABLE')
  if (info.isDirectory()) {
    const entries = await readdir(absolute).catch(() => null)
    if (entries === null) throw new BridgeError('WORKSPACE_NOT_AVAILABLE')
    if (entries.length > 0) throw new BridgeError('INVALID_REQUEST')
    // `rmdir`, not `rm`: `rm` refuses a directory without `recursive: true`, and
    // passing that would be exactly the recursive delete this is avoiding. `rmdir`
    // fails on a non-empty directory by itself, so the check above is belt as well
    // as braces.
    await rmdir(absolute)
    return
  }
  await rm(absolute, { recursive: false, force: false })
}
