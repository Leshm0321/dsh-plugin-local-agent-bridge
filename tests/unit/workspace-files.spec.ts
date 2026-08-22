/**
 * Reading the session's working directory.
 *
 * The confinement assertions are the point, and they are made against real symlinks
 * on disk. This reads file *contents*, which the host browser deliberately does not,
 * so a link committed into a repository must not become a way to read whatever it
 * points at.
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BridgeError } from '../../src/core/errors.ts'
import { listWorkspace, readWorkspaceFile } from '../../src/core/workspace-files.ts'

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

  it('reads a file as workspace-relative text', async () => {
    expect(await readWorkspaceFile(root, 'src/main.ts')).toEqual({
      path: 'src/main.ts',
      content: 'export const answer = 42\n',
      bytes: 25,
      truncated: false,
      binary: false,
    })
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
