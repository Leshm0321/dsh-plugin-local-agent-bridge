/**
 * Guards for the documentation set.
 *
 * Two failure modes, both silent. A relative link breaks when a file moves — the
 * split into `docs/en` and `docs/zh` broke five at once, four of them same-page
 * anchors copied out of a README that still had the heading they pointed at. And a
 * bilingual set drifts: someone adds a page in one language, the other is simply
 * missing, and nothing says so until a reader follows the index and finds nothing.
 *
 * Both are checked here rather than by reading carefully, because reading carefully
 * is what produced the five broken links.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

/** Every markdown file this repository is responsible for. */
function markdownFiles(): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      // Dot directories hold vendored upstream copies and local research notes;
      // their links are not this repository's to keep working.
      if (name.startsWith('.') || ['node_modules', 'lib', 'coverage', 'generated'].includes(name)) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name.endsWith('.md')) found.push(full)
    }
  }
  walk(root)
  return found.sort()
}

/**
 * GitHub's heading slug: lowercased, punctuation dropped, spaces to hyphens. CJK
 * characters survive, which is why the Chinese pages can be linked by heading at all.
 */
function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N} -]/gu, '')
    .trim()
    .replaceAll(/\s+/g, '-')
}

describe('documentation', () => {
  it('has no relative link that does not resolve, anchors included', () => {
    const files = markdownFiles()
    const anchors = new Map(
      files.map(file => [
        file,
        new Set(
          readFileSync(file, 'utf8')
            .split('\n')
            .filter(line => /^#{1,6} /.test(line))
            .map(line => slug(line.replace(/^#+ /, ''))),
        ),
      ]),
    )

    const broken: string[] = []
    for (const file of files) {
      for (const match of readFileSync(file, 'utf8').matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const href = match[1]!
        if (/^(https?:|mailto:)/.test(href)) continue
        const here = relative(root, file)
        if (href.startsWith('#')) {
          if (!anchors.get(file)!.has(href.slice(1))) broken.push(`${here} -> ${href}`)
          continue
        }
        const [path, hash] = href.split('#')
        const target = resolve(dirname(file), path!)
        if (!existsSync(target)) { broken.push(`${here} -> ${href}`); continue }
        if (hash !== undefined && anchors.has(target) && !anchors.get(target)!.has(hash)) {
          broken.push(`${here} -> ${href}`)
        }
      }
    }
    expect(broken).toEqual([])
  })

  it('has the same pages in both languages', () => {
    const pages = (lang: string) => readdirSync(join(root, 'docs', lang)).filter(name => name.endsWith('.md')).sort()
    // Which language a page was written in first does not matter; that one exists
    // in the other is the whole point of the directory split.
    expect(pages('zh')).toEqual(pages('en'))
  })
})
