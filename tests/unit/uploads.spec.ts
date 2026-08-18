/**
 * Receiving browser-picked files onto the Host.
 *
 * This is the only path that writes Host files on the browser's behalf, so the
 * containment assertions are the point of the file and they are made against a
 * real directory rather than reasoned about. A traversal that "cannot happen"
 * because the segments were rebuilt is exactly the kind of claim that stops being
 * true after a refactor.
 */
import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BridgeError } from '../../src/core/errors.ts'
import { UPLOAD_DIRECTORY, receiveUploads, safeUploadPath } from '../../src/core/uploads.ts'

let root = ''
let outside = ''

const encode = (text: string): string => Buffer.from(text, 'utf8').toString('base64')

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lab-upload-'))
  outside = await mkdtemp(join(tmpdir(), 'lab-upload-outside-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

describe('uploads', () => {
  it('writes a file into the upload directory and reports its workspace-relative path', async () => {
    const result = await receiveUploads(root, [{ path: 'notes.md', contentBase64: encode('# hello') }])

    // The same shape `@` uses, so the composer inserts one form either way.
    expect(result).toEqual({ paths: [`${UPLOAD_DIRECTORY}/notes.md`], rejected: 0 })
    expect(await readFile(join(root, UPLOAD_DIRECTORY, 'notes.md'), 'utf8')).toBe('# hello')
  })

  it('keeps a folder upload\u2019s structure, so the result is still readable', async () => {
    const result = await receiveUploads(root, [
      { path: 'project/src/main.ts', contentBase64: encode('export const a = 1') },
      { path: 'project/README.md', contentBase64: encode('# project') },
    ])

    expect(result.paths).toEqual([
      `${UPLOAD_DIRECTORY}/project/src/main.ts`,
      `${UPLOAD_DIRECTORY}/project/README.md`,
    ])
    expect(await readFile(join(root, UPLOAD_DIRECTORY, 'project', 'src', 'main.ts'), 'utf8'))
      .toBe('export const a = 1')
  })

  it('refuses to escape the upload directory, however the name is spelled', async () => {
    const escapes = [
      '../../../../etc/passwd',
      '..\\..\\..\\windows\\system32\\config',
      '/etc/passwd',
      'C:\\Windows\\System32\\drivers\\etc\\hosts',
      './../outside.txt',
      'a/../../../../outside.txt',
    ]
    const result = await receiveUploads(
      root,
      escapes.map(path => ({ path, contentBase64: encode('nope') })),
    )

    // Every one of them either landed inside as a rebuilt name or was refused;
    // nothing reached a parent directory.
    for (const written of result.paths) {
      expect(written.startsWith(`${UPLOAD_DIRECTORY}/`)).toBe(true)
      expect(written).not.toContain('..')
    }
    expect(await readdir(outside)).toEqual([])
    // The tree that was created contains no stray parent-directory entry.
    expect(await readdir(root)).toEqual([UPLOAD_DIRECTORY])
  })

  it('refuses a segment that is only dots, but keeps a legitimate dotfile', async () => {
    expect(safeUploadPath('..')).toBeNull()
    expect(safeUploadPath('.')).toBeNull()
    expect(safeUploadPath('...')).toBeNull()
    // A dotfile is an ordinary thing to hand an agent, and stripping the dot
    // would silently change which file it is.
    expect(safeUploadPath('.env.example')).toBe('.env.example')
    expect(safeUploadPath('.github/workflows.yml')).toBe('.github/workflows.yml')
  })

  it('never replaces a file that is already there', async () => {
    await mkdir(join(root, UPLOAD_DIRECTORY), { recursive: true })
    await writeFile(join(root, UPLOAD_DIRECTORY, 'notes.md'), 'original')

    const result = await receiveUploads(root, [
      { path: 'notes.md', contentBase64: encode('second') },
      { path: 'notes.md', contentBase64: encode('third') },
    ])

    expect(result.paths).toEqual([
      `${UPLOAD_DIRECTORY}/notes-1.md`,
      `${UPLOAD_DIRECTORY}/notes-2.md`,
    ])
    // The operator's own file is untouched, which is the whole point of the rule.
    expect(await readFile(join(root, UPLOAD_DIRECTORY, 'notes.md'), 'utf8')).toBe('original')
  })

  it('refuses a payload that is not really base64, rather than writing what it parsed to', async () => {
    const result = await receiveUploads(root, [
      { path: 'broken.bin', contentBase64: 'not*valid*base64!!' },
      { path: 'fine.txt', contentBase64: encode('ok') },
    ])

    expect(result.rejected).toBe(1)
    expect(result.paths).toEqual([`${UPLOAD_DIRECTORY}/fine.txt`])
  })

  it('accepts base64 that arrived with line breaks', async () => {
    const wrapped = encode('a'.repeat(200)).replaceAll(/(.{16})/g, '$1\n')
    const result = await receiveUploads(root, [{ path: 'wrapped.txt', contentBase64: wrapped }])

    expect(result.rejected).toBe(0)
    expect(await readFile(join(root, UPLOAD_DIRECTORY, 'wrapped.txt'), 'utf8')).toBe('a'.repeat(200))
  })

  it('refuses a file over the per-file ceiling without failing the rest', async () => {
    const huge = Buffer.alloc(9 * 1024 * 1024, 0x61).toString('base64')
    const result = await receiveUploads(root, [
      { path: 'huge.bin', contentBase64: huge },
      { path: 'small.txt', contentBase64: encode('fine') },
    ])

    expect(result.rejected).toBe(1)
    expect(result.paths).toEqual([`${UPLOAD_DIRECTORY}/small.txt`])
  })

  it('refuses an empty or oversized request outright', async () => {
    await expect(receiveUploads(root, [])).rejects.toBeInstanceOf(BridgeError)
    const many = Array.from({ length: 51 }, (_unused, index) => ({
      path: `file-${index}.txt`,
      contentBase64: encode('x'),
    }))
    await expect(receiveUploads(root, many)).rejects.toBeInstanceOf(BridgeError)
  })

  it('resolves the working directory through a symlink before writing', async () => {
    const real = join(root, 'real')
    await mkdir(real, { recursive: true })
    const link = join(root, 'link')
    await symlink(real, link)

    const result = await receiveUploads(link, [{ path: 'via-link.txt', contentBase64: encode('ok') }])

    expect(result.paths).toEqual([`${UPLOAD_DIRECTORY}/via-link.txt`])
    // Written to the real location, so a later `@` search — which also resolves
    // symlinks — finds the same file rather than deciding it escaped.
    expect(await readFile(join(real, UPLOAD_DIRECTORY, 'via-link.txt'), 'utf8')).toBe('ok')
  })
})
