/**
 * Listing a directory anywhere on the Host.
 *
 * The panel's widest read, so its shape is asserted against a real tree rather
 * than reasoned about: what it lists, what it refuses, and what it says about a
 * symlink — which decides whether the operator can walk into it.
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BridgeError } from '../../src/core/errors.ts'
import { listHostDirectory } from '../../src/core/host-browse.ts'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lab-host-'))
  await mkdir(join(root, 'beta'), { recursive: true })
  await mkdir(join(root, 'alpha'), { recursive: true })
  await mkdir(join(root, '.hidden-dir'), { recursive: true })
  await writeFile(join(root, 'notes.md'), '# notes')
  await writeFile(join(root, 'Archive.zip'), 'zip')
  await writeFile(join(root, '.env.example'), 'KEY=')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('host browse', () => {
  it('lists files as well as directories, folders first and then alphabetical', async () => {
    const listing = await listHostDirectory(root)

    // Files are the point: the Harness's own picker returns directories only,
    // which is why this exists rather than delegating to it.
    expect(listing.entries.map(entry => entry.name)).toEqual([
      '.hidden-dir', 'alpha', 'beta',
      '.env.example', 'Archive.zip', 'notes.md',
    ])
    expect(listing.entries.filter(entry => entry.directory).map(entry => entry.name))
      .toEqual(['.hidden-dir', 'alpha', 'beta'])
    // Absolute paths, so the next level and the reference need nothing rebuilt.
    for (const entry of listing.entries) {
      expect(entry.path).toBe(join(root, entry.name))
    }
  })

  it('marks dot-prefixed entries so the panel can hide them until asked', async () => {
    const listing = await listHostDirectory(root)
    const hidden = listing.entries.filter(entry => entry.hidden).map(entry => entry.name)
    expect(hidden.sort()).toEqual(['.env.example', '.hidden-dir'])
  })

  it('reports a symlinked directory as a directory, so it can be walked into', async () => {
    await symlink(join(root, 'alpha'), join(root, 'link-to-alpha'))
    await symlink(join(root, 'notes.md'), join(root, 'link-to-notes'))
    await symlink(join(root, 'does-not-exist'), join(root, 'broken-link'))

    const listing = await listHostDirectory(root)
    const byName = new Map(listing.entries.map(entry => [entry.name, entry.directory]))
    expect(byName.get('link-to-alpha')).toBe(true)
    expect(byName.get('link-to-notes')).toBe(false)
    // Listed rather than hidden: it exists, and the operator may want to know.
    expect(byName.has('broken-link')).toBe(true)
  })

  it('builds the breadcrumb trail from the filesystem root down', async () => {
    const nested = join(root, 'alpha')
    const listing = await listHostDirectory(nested)

    expect(listing.path).toBe(nested)
    // The trail ends at the directory being shown, and starts at the root, so the
    // operator can jump to any ancestor.
    expect(listing.crumbs.at(-1)).toEqual({ name: 'alpha', path: nested })
    expect(listing.crumbs[0]?.path).toBe(parse(nested).root)
    for (const crumb of listing.crumbs) {
      expect(crumb.name.length).toBeGreaterThan(0)
    }
  })

  it('lists the Host home directory when no path is given', async () => {
    const listing = await listHostDirectory()
    expect(listing.path).toBe(homedir())
    expect(listing.home).toBe(homedir())
  })

  it('refuses a relative path rather than resolving it against the Host process', async () => {
    // Whatever directory the Host happens to run in is not a location the operator
    // chose, so a relative path is a bug in the caller, not a shortcut.
    await expect(listHostDirectory('relative/path')).rejects.toBeInstanceOf(BridgeError)
    await expect(listHostDirectory('./somewhere')).rejects.toBeInstanceOf(BridgeError)
  })

  it('reports a path it cannot read as unavailable, without describing the Host', async () => {
    // The browser gets "cannot show you this" rather than a reason, because the
    // reason would describe the Host's filesystem.
    await expect(listHostDirectory(join(root, 'no-such-directory'))).rejects.toBeInstanceOf(BridgeError)
    // A file is not a level to list.
    await expect(listHostDirectory(join(root, 'notes.md'))).rejects.toBeInstanceOf(BridgeError)
  })

  it('cuts a very large directory at its ceiling and says so', async () => {
    const wide = join(root, 'wide')
    await mkdir(wide, { recursive: true })
    await Promise.all(Array.from({ length: 520 }, (_unused, index) =>
      writeFile(join(wide, `file-${String(index).padStart(4, '0')}.txt`), 'x')))

    const listing = await listHostDirectory(wide)
    expect(listing.entries).toHaveLength(500)
    // Said rather than implied: a silently short listing reads as a small directory.
    expect(listing.truncated).toBe(true)
  })

  it('never returns file contents, only names and kinds', async () => {
    const listing = await listHostDirectory(root)
    const keys = new Set(listing.entries.flatMap(entry => Object.keys(entry)))
    // Browsing is not reading. The agent reads a file, under the session's
    // permission mode; this only helps the operator name one.
    expect([...keys].sort()).toEqual(['directory', 'hidden', 'name', 'path'])
  })
})
