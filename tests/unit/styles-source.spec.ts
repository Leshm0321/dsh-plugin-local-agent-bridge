/**
 * Text-only checks on the stylesheet's source.
 *
 * Separate from `styles.spec.ts` on purpose: that file imports the module, so any
 * defect that stops the module parsing takes the whole suite down and reports a
 * transform error pointing at a line of CSS. This file reads the source as text
 * and never imports it, so it survives the broken state and says what is wrong.
 *
 * The specific hazard is a backtick inside a CSS comment. The sheet is a template
 * literal, so a backtick ends it early and the rest of the file becomes
 * JavaScript — which has broken the client build three times, once per author
 * reflex to quote a CSS property the way one quotes code in prose.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/client/styles.ts'), 'utf8')

describe('stylesheet source', () => {
  it('has no backtick inside the CSS, where it would end the template early', () => {
    // The sheet's own delimiters are the first backtick after the export and the
    // last one in the file; anything between them belongs to the CSS.
    const start = source.indexOf('`', source.indexOf('export const PANEL_STYLES'))
    const end = source.lastIndexOf('`')
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)

    const css = source.slice(start + 1, end)
    const offending = [...css.matchAll(/`/g)].map((match) => {
      const line = css.slice(0, match.index).split('\n').length
      return `line ${line + source.slice(0, start).split('\n').length - 1}`
    })
    expect(offending, 'quote CSS in prose without backticks').toEqual([])
  })

  it('interpolates nothing, so the sheet is a constant the guards can read whole', () => {
    const start = source.indexOf('`', source.indexOf('export const PANEL_STYLES'))
    const css = source.slice(start + 1, source.lastIndexOf('`'))
    // A `${…}` would make the emitted CSS depend on runtime values, which the
    // completeness and token guards could no longer verify by reading the source.
    expect(css).not.toContain('${')
  })
})
