/**
 * Listing a directory anywhere on the Host, for the composer's host browser.
 *
 * This is the panel's widest read of the Host, and it exists because the working
 * directory is not always where the file is. An operator asked for it in plain
 * terms: the agent runs on this machine, and they wanted to hand it something from
 * elsewhere on that machine without first copying it into the project.
 *
 * It is a deliberate widening, so the reasoning is recorded here rather than
 * implied:
 *
 * **The platform already does this.** DeepSeek Harness's own workspace picker
 * enumerates Host directories and returns absolute paths to the browser through
 * `workspaces.listDirectory`. This adds files to that view; it does not open a door
 * the Harness had closed. It is implemented here rather than delegated because
 * `listDirectory` returns directories only — being a directory picker — and because
 * it depends on a `browse` capability a composed Profile may not serve, while this
 * always works.
 *
 * **The agent can already read these paths.** Both products take an absolute path
 * and read it, subject to the session's permission mode. Browsing does not grant
 * the agent anything it lacked; it saves the operator from typing a path they
 * already know.
 *
 * **It is still a read the browser could not make before**, which is why it is
 * bounded to one level, never returns file contents, and can be switched off in the
 * Profile with `allowHostBrowsing: false` for a deployment where the browser is
 * further away than a loopback address.
 */
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, parse, resolve, sep } from 'node:path'
import { BridgeError } from './errors.ts'

/** One entry in a Host directory. */
export interface HostEntry {
  readonly name: string
  /** Absolute Host path, for the next level or for the reference. */
  readonly path: string
  readonly directory: boolean
  /** True for a dot-prefixed name, so the panel can hide them by default. */
  readonly hidden: boolean
}

/** One level of the Host filesystem, with its ancestry. */
export interface HostListing {
  /** The directory listed, absolute and resolved. */
  readonly path: string
  /** The Host's home directory, so the panel can label that crumb. */
  readonly home: string
  /** Ancestors from the filesystem root to this directory, inclusive. */
  readonly crumbs: readonly { readonly name: string; readonly path: string }[]
  readonly entries: readonly HostEntry[]
  /** True when the level held more entries than the ceiling. */
  readonly truncated: boolean
}

/**
 * Entries returned per level. High enough for a real directory, low enough that a
 * pathological one — a mail spool, a node_modules root — cannot produce a reply
 * measured in megabytes.
 */
const ENTRY_LIMIT = 500

/**
 * Build the breadcrumb trail for a directory.
 * @param path - absolute, resolved directory.
 * @returns ancestors from the root down to the directory itself.
 */
function crumbsFor(path: string): { name: string; path: string }[] {
  const trail: { name: string; path: string }[] = []
  let current = path
  for (;;) {
    trail.unshift({ name: basename(current) || current, path: current })
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  // The root's basename is empty on POSIX and a drive letter on Windows; both read
  // better as the path itself.
  const root = trail[0]
  if (root !== undefined && root.name.length === 0) trail[0] = { ...root, path: root.path, name: root.path }
  return trail
}

/**
 * List one level of the Host filesystem.
 *
 * @param path - absolute directory to list; omitted lists the Host home directory.
 * @returns the level, its ancestry, and whether it was cut at the ceiling.
 * @throws BridgeError INVALID_REQUEST for a relative path, and
 * WORKSPACE_NOT_AVAILABLE for one that is not a readable directory — the browser
 * gets "cannot show you this" rather than the reason, which would describe the Host.
 */
export async function listHostDirectory(path?: string): Promise<HostListing> {
  const home = homedir()
  const target = path === undefined || path.trim().length === 0 ? home : path
  // Absolute only. A relative path would resolve against whatever directory the
  // Host process happens to be in, which is not a location the operator chose.
  if (!isAbsolute(target)) throw new BridgeError('INVALID_REQUEST')
  const resolved = resolve(target)

  let entries
  try {
    entries = await readdir(resolved, { withFileTypes: true })
  } catch {
    throw new BridgeError('WORKSPACE_NOT_AVAILABLE')
  }

  const listed: HostEntry[] = []
  let truncated = false
  for (const entry of entries) {
    if (listed.length >= ENTRY_LIMIT) {
      truncated = true
      break
    }
    const child = resolved === parse(resolved).root ? `${resolved}${entry.name}` : `${resolved}${sep}${entry.name}`
    let directory = entry.isDirectory()
    if (entry.isSymbolicLink()) {
      // Resolve the link's target so a linked directory can be walked into and a
      // linked file can be referenced. A broken link is listed as a file rather
      // than hidden, because it exists and the operator may want to know.
      directory = await stat(child).then(info => info.isDirectory()).catch(() => false)
    } else if (!directory && !entry.isFile()) {
      // Sockets, devices, FIFOs: nothing an agent can be handed.
      continue
    }
    listed.push({
      name: entry.name,
      path: child,
      directory,
      hidden: entry.name.startsWith('.'),
    })
  }

  // Directories first, then files, each alphabetical — the order every file
  // browser uses, and the one that makes a deep tree navigable.
  listed.sort((left, right) =>
    left.directory === right.directory
      ? left.name.localeCompare(right.name)
      : left.directory ? -1 : 1)

  return { path: resolved, home, crumbs: crumbsFor(resolved), entries: listed, truncated }
}
