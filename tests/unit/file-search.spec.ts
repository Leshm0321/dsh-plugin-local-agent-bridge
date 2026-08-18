/**
 * File search for the composer's `@` completion.
 *
 * The confinement checks are the important ones. A repository can legitimately
 * contain a symlink pointing anywhere on the Host, and `@` must not become a way
 * to enumerate the filesystem from a browser — so escape is asserted against a
 * real symlink on disk rather than reasoned about.
 */
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { searchFiles } from '../../src/core/file-search.ts'

let root = ''
let outside = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lab-files-'))
  outside = await mkdtemp(join(tmpdir(), 'lab-outside-'))
  await mkdir(join(root, 'src', 'domain'), { recursive: true })
  await mkdir(join(root, 'node_modules', 'left-pad'), { recursive: true })
  await mkdir(join(root, '.git', 'objects'), { recursive: true })
  await mkdir(join(root, '.github'), { recursive: true })
  await writeFile(join(root, 'README.md'), '# readme')
  await writeFile(join(root, 'src', 'main.ts'), 'export const answer = 42')
  await writeFile(join(root, 'src', 'domain', 'mainframe-utils.ts'), '')
  await writeFile(join(root, 'node_modules', 'left-pad', 'main.js'), '')
  await writeFile(join(root, '.git', 'objects', 'mainpack'), '')
  await writeFile(join(root, '.github', 'workflows.yml'), '')
  await writeFile(join(outside, 'secrets.env'), 'TOKEN=nope')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

describe('file search', () => {
  it('ranks a base-name prefix above a substring, and that above a path hit', async () => {
    const { matches } = await searchFiles(root, 'main')
    const paths = matches.map(match => match.path)
    // src/main.ts is a base-name prefix; mainframe-utils.ts is also a prefix but
    // its path is longer, so the shallower file wins the tie.
    expect(paths[0]).toBe('src/main.ts')
    expect(paths).toContain('src/domain/mainframe-utils.ts')
    // Paths are forward-slashed regardless of the Host's separator.
    for (const path of paths) expect(path).not.toContain('\\')
  })

  it('does not spend its budget on version control or dependency trees', async () => {
    const { matches } = await searchFiles(root, 'main')
    const paths = matches.map(match => match.path)
    expect(paths).not.toContain('node_modules/left-pad/main.js')
    expect(paths).not.toContain('.git/objects/mainpack')
  })

  it('keeps dotted directories a person would actually reference', async () => {
    // `.git` is skipped by name; `.github` is not a dependency tree and holds
    // files people mean by `@`.
    const { matches } = await searchFiles(root, 'workflows')
    expect(matches.map(match => match.path)).toContain('.github/workflows.yml')
  })

  it('refuses a symlink that escapes the working directory', async () => {
    await symlink(join(outside, 'secrets.env'), join(root, 'linked-secrets.env'))
    const { matches } = await searchFiles(root, 'secrets')
    // The name matches and the path looks like it is inside the root, so only
    // resolving it catches the escape.
    expect(matches.map(match => match.path)).not.toContain('linked-secrets.env')
    expect(matches).toEqual([])
  })

  it('refuses a symlinked directory that escapes, without following it', async () => {
    await symlink(outside, join(root, 'elsewhere'))
    const { matches } = await searchFiles(root, 'secrets')
    expect(matches.map(match => match.path)).not.toContain('elsewhere/secrets.env')
  })

  it('lists the shallowest files for an empty query', async () => {
    const { matches } = await searchFiles(root, '')
    expect(matches.length).toBeGreaterThan(0)
    // Shortest paths first, so an empty `@` offers the top of the tree.
    expect(matches[0]?.path).toBe('README.md')
  })

  it('returns nothing for a directory it cannot read, rather than failing', async () => {
    const { matches, partial } = await searchFiles(join(root, 'does-not-exist'), 'main')
    expect(matches).toEqual([])
    expect(partial).toBe(false)
  })
})
