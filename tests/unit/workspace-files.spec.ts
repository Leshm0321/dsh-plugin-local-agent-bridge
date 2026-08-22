/**
 * Reading the session's working directory.
 *
 * The confinement assertions are the point, and they are made against real symlinks
 * on disk. This reads file *contents*, which the host browser deliberately does not,
 * so a link committed into a repository must not become a way to read whatever it
 * points at.
 */
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BridgeError } from '../../src/core/errors.ts'
import {
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  listWorkspace,
  readWorkspaceFile,
  renameWorkspaceEntry,
  writeWorkspaceFile,
} from '../../src/core/workspace-files.ts'

let root = ''
let outside = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lab-ws-'))
  outside = await mkdtemp(join(tmpdir(), 'lab-ws-outside-'))
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, '.git', 'objects'), { recursive: true })
  await mkdir(join(root, 'node_modules', 'left-pad'), { recursive: true })
  await writeFile(join(root, 'README.md'), '# readme\n')
  await writeFile(join(root, 'src', 'main.ts'), 'export const answer = 42\n')
  await writeFile(join(root, '.env.example'), 'KEY=\n')
  await writeFile(join(outside, 'secret.txt'), 'TOKEN=nope\n')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

describe('workspace files', () => {
  it('lists a level with directories first, and sizes for files', async () => {
    const listing = await listWorkspace(root)

    expect(listing.entries.map(entry => entry.name)).toEqual(['src', '.env.example', 'README.md'])
    const readme = listing.entries.find(entry => entry.name === 'README.md')
    expect(readme).toMatchObject({ path: 'README.md', directory: false, hidden: false, bytes: 9 })
    // A directory has no size to report, and zero would read as an empty one.
    expect(listing.entries.find(entry => entry.name === 'src')?.bytes).toBeNull()
  })

  it('skips the trees nobody browses, and marks dotfiles', async () => {
    const listing = await listWorkspace(root)
    const names = listing.entries.map(entry => entry.name)
    expect(names).not.toContain('.git')
    expect(names).not.toContain('node_modules')
    // A dotfile is listed but flagged, so the panel can hide it until asked.
    expect(listing.entries.find(entry => entry.name === '.env.example')?.hidden).toBe(true)
  })

  it('reads a file as workspace-relative text, with a revision to write back at', async () => {
    expect(await readWorkspaceFile(root, 'src/main.ts')).toMatchObject({
      path: 'src/main.ts',
      content: 'export const answer = 42\n',
      bytes: 25,
      truncated: false,
      binary: false,
    })
    // Opaque to the browser, which only hands it back — but it has to change when the
    // file does, or the write check it exists for would never fire.
    const before = (await readWorkspaceFile(root, 'src/main.ts')).revision
    await writeFile(join(root, 'src', 'main.ts'), 'export const answer = 43\n')
    expect((await readWorkspaceFile(root, 'src/main.ts')).revision).not.toBe(before)
  })

  it('refuses a path that climbs out, before touching the filesystem', async () => {
    // `..` is never a path within the workspace, whatever it would resolve to.
    await expect(listWorkspace(root, '../')).rejects.toBeInstanceOf(BridgeError)
    await expect(readWorkspaceFile(root, '../secret.txt')).rejects.toBeInstanceOf(BridgeError)
    await expect(readWorkspaceFile(root, 'src/../../secret.txt')).rejects.toBeInstanceOf(BridgeError)
  })

  it('refuses a symlink that points out of the workspace', async () => {
    await symlink(join(outside, 'secret.txt'), join(root, 'looks-local.txt'))
    await symlink(outside, join(root, 'elsewhere'))

    // The path looks fine and only the target gives it away, which is why the check
    // is against the resolved path rather than the requested one.
    await expect(readWorkspaceFile(root, 'looks-local.txt')).rejects.toBeInstanceOf(BridgeError)
    await expect(listWorkspace(root, 'elsewhere')).rejects.toBeInstanceOf(BridgeError)
  })

  it('follows a symlink that stays inside', async () => {
    await symlink(join(root, 'src', 'main.ts'), join(root, 'linked.ts'))
    // A link within the tree is a legitimate part of the tree.
    expect((await readWorkspaceFile(root, 'linked.ts')).content).toContain('answer = 42')
  })

  it('reports a binary file rather than rendering it', async () => {
    await writeFile(join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]))
    const file = await readWorkspaceFile(root, 'logo.png')
    // A NUL byte is the cheap, standard test, and it beats an extension list: a
    // `.log` can be binary and a file with no extension is usually text.
    expect(file).toMatchObject({ binary: true, content: '', bytes: 7 })
  })

  it('cuts a very large file and says so', async () => {
    await writeFile(join(root, 'huge.txt'), 'x'.repeat(600 * 1024))
    const file = await readWorkspaceFile(root, 'huge.txt')
    expect(file.content).toHaveLength(512 * 1024)
    expect(file.bytes).toBe(600 * 1024)
    // Stated rather than implied: a silently short file reads as a short file.
    expect(file.truncated).toBe(true)
  })

  it('refuses a directory where a file was asked for, and a missing path', async () => {
    await expect(readWorkspaceFile(root, 'src')).rejects.toBeInstanceOf(BridgeError)
    await expect(readWorkspaceFile(root, 'nope.txt')).rejects.toBeInstanceOf(BridgeError)
    await expect(readWorkspaceFile(root, '')).rejects.toBeInstanceOf(BridgeError)
  })
})

describe('workspace writes', () => {
  it('writes a file and hands back a fresh revision', async () => {
    const opened = await readWorkspaceFile(root, 'README.md')
    const written = await writeWorkspaceFile(root, 'README.md', '# changed\n', opened.revision)

    expect(written.content).toBe('# changed\n')
    expect(written.revision).not.toBe(opened.revision)
    expect(await readFile(join(root, 'README.md'), 'utf8')).toBe('# changed\n')
  })

  it('refuses a write that would discard a change made since it was read', async () => {
    const opened = await readWorkspaceFile(root, 'README.md')
    // The agent works in this same tree. A panel that wrote whatever its buffer held
    // would silently throw away what the agent had just done.
    await writeFile(join(root, 'README.md'), '# the agent got there first\n')

    await expect(writeWorkspaceFile(root, 'README.md', '# my version\n', opened.revision))
      .rejects.toBeInstanceOf(BridgeError)
    expect(await readFile(join(root, 'README.md'), 'utf8')).toBe('# the agent got there first\n')
  })

  it('creates a file and a directory, and never overwrites', async () => {
    // Into a directory that exists. The panel always creates into a directory the
    // operator has open, and building intermediate levels from a browser would let
    // one mistyped path produce a tree nobody asked for.
    await createWorkspaceEntry(root, 'notes', true)
    await createWorkspaceEntry(root, 'notes/todo.md', false)
    expect(await readFile(join(root, 'notes', 'todo.md'), 'utf8')).toBe('')

    await createWorkspaceEntry(root, 'docs', true)
    expect((await listWorkspace(root)).entries.some(entry => entry.name === 'docs')).toBe(true)

    // "New file" and "erase that file" are different intentions, and only one was
    // expressed.
    await expect(createWorkspaceEntry(root, 'README.md', false)).rejects.toBeInstanceOf(BridgeError)
    expect(await readFile(join(root, 'README.md'), 'utf8')).toBe('# readme\n')
  })

  it('renames within the workspace and refuses to cross its edge', async () => {
    await createWorkspaceEntry(root, 'docs', true)
    await renameWorkspaceEntry(root, 'README.md', 'docs/README.md')
    expect(await readFile(join(root, 'docs', 'README.md'), 'utf8')).toBe('# readme\n')

    // Both ends are confined, so nothing can be moved out of the tree or pulled in.
    await expect(renameWorkspaceEntry(root, 'src/main.ts', '../escaped.ts')).rejects.toBeInstanceOf(BridgeError)
    await expect(renameWorkspaceEntry(root, 'src/main.ts', 'src/../../escaped.ts')).rejects.toBeInstanceOf(BridgeError)
  })

  it('refuses creating into a directory that does not exist', async () => {
    await expect(createWorkspaceEntry(root, 'nope/deep/file.txt', false)).rejects.toBeInstanceOf(BridgeError)
  })

  it('refuses a rename onto something that already exists', async () => {
    await expect(renameWorkspaceEntry(root, 'README.md', 'src/main.ts')).rejects.toBeInstanceOf(BridgeError)
    expect(await readFile(join(root, 'src', 'main.ts'), 'utf8')).toContain('answer = 42')
  })

  it('deletes a file, and an empty directory, but never a full one', async () => {
    await deleteWorkspaceEntry(root, 'README.md')
    expect((await listWorkspace(root)).entries.some(entry => entry.name === 'README.md')).toBe(false)

    // Not recursive, deliberately: a recursive delete reachable from a browser is a
    // way to lose a repository to one mis-click.
    await expect(deleteWorkspaceEntry(root, 'src')).rejects.toBeInstanceOf(BridgeError)
    expect(await readFile(join(root, 'src', 'main.ts'), 'utf8')).toContain('answer = 42')

    await deleteWorkspaceEntry(root, 'src/main.ts')
    await deleteWorkspaceEntry(root, 'src')
    expect((await listWorkspace(root)).entries.some(entry => entry.name === 'src')).toBe(false)
  })

  it('refuses to delete the workspace itself', async () => {
    await expect(deleteWorkspaceEntry(root, '')).rejects.toBeInstanceOf(BridgeError)
    await expect(deleteWorkspaceEntry(root, '.')).rejects.toBeInstanceOf(BridgeError)
  })

  it('refuses to write through a symlink that leaves the workspace', async () => {
    await symlink(join(outside, 'secret.txt'), join(root, 'looks-local.txt'))
    // The read side refuses this too, but a write is the one that would do damage.
    await expect(writeWorkspaceFile(root, 'looks-local.txt', 'owned', '0-0'))
      .rejects.toBeInstanceOf(BridgeError)
    expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('TOKEN=nope\n')
  })

  it('refuses content over the write ceiling', async () => {
    const opened = await readWorkspaceFile(root, 'README.md')
    // Reading a big file is a look; writing one is a change, and an editor buffer
    // that large is not something anyone typed.
    await expect(writeWorkspaceFile(root, 'README.md', 'x'.repeat(3 * 1024 * 1024), opened.revision))
      .rejects.toBeInstanceOf(BridgeError)
  })
})
