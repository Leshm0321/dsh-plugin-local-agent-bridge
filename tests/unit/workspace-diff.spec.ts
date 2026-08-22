/**
 * Reading uncommitted changes.
 *
 * The parser is what has to be right: a side-by-side view needs every line to know
 * which row it occupies on each side, and those numbers come from walking the hunk
 * rather than from the header. Driven with git's own output rather than invented
 * diffs, so the format assumptions are the real ones.
 */
import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from '../../src/core/workspace-diff.ts'

/** Recorded from `git diff HEAD` on a real edit. */
const DIFF = [
  'diff --git a/src/main.ts b/src/main.ts',
  'index 83db48f..bf269f4 100644',
  '--- a/src/main.ts',
  '+++ b/src/main.ts',
  '@@ -1,6 +1,7 @@ export function main() {',
  ' const first = 1',
  ' const second = 2',
  '-const third = 3',
  '+const third = 30',
  '+const fourth = 4',
  ' const fifth = 5',
  ' ',
  ' export {}',
  '@@ -20,3 +21,3 @@',
  ' tail one',
  '-tail two',
  '+tail 2',
  ' tail three',
  '',
].join('\n')

describe('unified diff', () => {
  it('splits hunks and keeps git’s own header', () => {
    const hunks = parseUnifiedDiff(DIFF)
    expect(hunks).toHaveLength(2)
    // The header sometimes names the enclosing function, which is worth keeping
    // rather than reformatting into ranges of our own.
    expect(hunks[0]?.header).toBe('@@ -1,6 +1,7 @@ export function main() {')
    expect(hunks[1]?.header).toBe('@@ -20,3 +21,3 @@')
  })

  it('numbers every line on the side it exists on', () => {
    const [first] = parseUnifiedDiff(DIFF)
    expect(first?.lines.map(line => [line.kind, line.oldNumber, line.newNumber, line.text])).toEqual([
      ['context', 1, 1, 'const first = 1'],
      ['context', 2, 2, 'const second = 2'],
      // A removal has no row on the new side, and an addition none on the old.
      ['removed', 3, null, 'const third = 3'],
      ['added', null, 3, 'const third = 30'],
      ['added', null, 4, 'const fourth = 4'],
      ['context', 4, 5, 'const fifth = 5'],
      ['context', 5, 6, ''],
      ['context', 6, 7, 'export {}'],
    ])
  })

  it('restarts numbering from each hunk’s header', () => {
    const hunks = parseUnifiedDiff(DIFF)
    const second = hunks[1]?.lines ?? []
    expect(second[0]).toMatchObject({ kind: 'context', oldNumber: 20, newNumber: 21 })
    expect(second[1]).toMatchObject({ kind: 'removed', oldNumber: 21, newNumber: null })
    expect(second[2]).toMatchObject({ kind: 'added', oldNumber: null, newNumber: 22 })
  })

  it('ignores the file headers and the no-newline note', () => {
    const withNote = parseUnifiedDiff([
      '--- a/x',
      '+++ b/x',
      '@@ -1 +1 @@',
      '-old',
      '\\ No newline at end of file',
      '+new',
      '\\ No newline at end of file',
    ].join('\n'))
    // The backslash line is a remark about the line above it, not a line of the file.
    expect(withNote[0]?.lines.map(line => line.text)).toEqual(['old', 'new'])
  })

  it('returns nothing for output with no hunks', () => {
    expect(parseUnifiedDiff('')).toEqual([])
    // A binary change: git says so and offers no hunks.
    expect(parseUnifiedDiff([
      'diff --git a/logo.png b/logo.png',
      'Binary files a/logo.png and b/logo.png differ',
    ].join('\n'))).toEqual([])
  })

  it('keeps a line that begins with a marker character', () => {
    // A diff of a diff, or of markdown with a leading dash. The first character is
    // the marker and the rest is content, however it reads.
    const hunks = parseUnifiedDiff([
      '@@ -1,2 +1,2 @@',
      '--- removed a header line',
      '+++ added a header line',
    ].join('\n'))
    expect(hunks[0]?.lines).toEqual([
      { kind: 'removed', text: '-- removed a header line', oldNumber: 1, newNumber: null },
      { kind: 'added', text: '++ added a header line', oldNumber: null, newNumber: 1 },
    ])
  })
})
