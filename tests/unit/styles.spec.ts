/**
 * Guards for the panel stylesheet.
 *
 * The sheet lives in a TypeScript template literal. That buys theme tokens,
 * pseudo-classes and media queries, at the cost of failure modes that produce
 * no error at all:
 *
 *  - A class renamed in the JSX but not in the sheet, or the reverse, renders an
 *    unstyled element and reports nothing.
 *  - A colour written as a literal instead of a theme token looks correct in
 *    whichever theme the author had open and wrong in the other.
 *  - A selector that forgot the prefix restyles the Harness around the panel.
 *
 * A stray backtick in a CSS comment is a fourth hazard — it happened once and
 * broke the client build — but it is already fatal to typecheck and even to
 * loading this file, so it needs no assertion here; the completeness check below
 * covers the milder version where a whole section goes missing.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLASS_PREFIX, PANEL_STYLES } from '../../src/client/styles.ts'

/**
 * The client's JSX sources with comments removed. Comments are stripped first because
 * they legitimately discuss class names — the note explaining why the row
 * modifier is a lookup table quotes the interpolated form it replaced — and a
 * scan that counted those would report a class that is only ever mentioned.
 */
const clientSource = readdirSync(join(process.cwd(), 'src/client'))
  // Every JSX file, not just the panel: class names live wherever a component does,
  // and scanning one file meant splitting a component out silently turned its rules
  // into "dead" ones and its classes into "missing" ones at the same time.
  .filter(name => name.endsWith('.tsx'))
  .sort()
  .map(name => readFileSync(join(process.cwd(), 'src/client', name), 'utf8'))
  .join('\n')
  .replaceAll(/\/\*[\s\S]*?\*\//g, '')
  .replaceAll(/^\s*\/\/.*$/gm, '')

/** Class names the stylesheet defines a rule for. */
function definedClasses(): Set<string> {
  const found = new Set<string>()
  for (const match of PANEL_STYLES.matchAll(/\.(lab-[a-z0-9-]+)/g)) found.add(match[1]!)
  return found
}

/**
 * Class names the JSX actually puts on an element.
 *
 * Every `lab-` token left in the comment-free source is a class name: the
 * prefix contains a hyphen, so it cannot be part of a JavaScript identifier,
 * and the panel has no other reason to spell it. Scanning tokens directly is
 * therefore both simpler and stricter than trying to match the quoting form —
 * an attempt at that missed `lab-row-card` because it sits in a template
 * literal alongside an interpolation.
 */
function usedClasses(): Set<string> {
  const found = new Set<string>()
  // The lookbehind excludes CSS custom properties: `--lab-effort-progress` is a
  // variable the stylesheet reads, not a class anything wears, and counting it
  // demanded a rule that should never exist.
  for (const token of clientSource.matchAll(/(?<!-)\blab-[a-z0-9-]+/g)) found.add(token[0])
  return found
}

describe('panel stylesheet', () => {
  it('carries every region of the panel from the scope root to the responsive tail', () => {
    // One assertion per region, in source order, so a section deleted or left
    // unmerged fails here and names itself rather than showing up as an
    // unstyled area in the browser.
    for (const marker of [
      '.lab-root {',
      '.lab-trigger',
      '.lab-scrim',
      '.lab-window',
      '.lab-titlebar',
      '.lab-aside',
      '.lab-card',
      '.lab-input',
      '.lab-btn',
      '.lab-session',
      '.lab-toolbar',
      '.lab-timeline',
      '.lab-row-card',
      '.lab-interaction',
      '.lab-composer',
      '@media (max-width: 860px)',
      '@media (max-width: 480px)',
    ]) {
      expect(PANEL_STYLES, `missing region: ${marker}`).toContain(marker)
    }
  })

  it('has balanced braces and no empty rule bodies', () => {
    const open = (PANEL_STYLES.match(/\{/g) ?? []).length
    const close = (PANEL_STYLES.match(/\}/g) ?? []).length
    expect(open).toBe(close)
    expect(PANEL_STYLES).not.toMatch(/\{\s*\}/)
  })

  it('styles every class the panel renders', () => {
    const defined = definedClasses()
    const missing = [...usedClasses()].filter(name => !defined.has(name)).sort()
    expect(missing).toEqual([])
  })

  it('renders every class it styles, so dead rules do not accumulate', () => {
    const used = usedClasses()
    const unused = [...definedClasses()].filter(name => !used.has(name)).sort()
    expect(unused).toEqual([])
  })

  it('scopes every selector under the plugin prefix', () => {
    // Selectors are the sheet's only reach into the Harness document; an
    // unprefixed one would restyle the app around the panel.
    const selectors = PANEL_STYLES
      .replaceAll(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .flatMap(block => block.split('{').slice(0, -1))
      .flatMap(part => part.split(','))
      .map(part => part.trim())
      .filter(part => part.length > 0 && !part.startsWith('@') && !part.startsWith('from') && !part.startsWith('to') && !/^\d+%$/.test(part))

    expect(selectors.length).toBeGreaterThan(30)
    for (const selector of selectors) {
      expect(selector, `unscoped selector: ${selector}`).toMatch(new RegExp(`\\.${CLASS_PREFIX}-`))
    }
  })

  it('reads its colours from Harness theme tokens rather than fixed values', () => {
    // The token bridge is what makes the panel follow light/dark. A hex literal
    // outside the fallback position would pin one theme.
    const tokenRefs = (PANEL_STYLES.match(/var\(--dsw-alias-/g) ?? []).length
    expect(tokenRefs).toBeGreaterThan(15)

    const hexOutsideFallback = [...PANEL_STYLES.matchAll(/#[0-9a-f]{3,8}\b/gi)]
      .filter(match => {
        const line = PANEL_STYLES.slice(0, match.index).split('\n').at(-1) ?? ''
        // A hex is legitimate as the last-resort fallback of a var(), and in the
        // syntax palette. The palette is the one place with nothing to read: the
        // Harness exposes label, state and button aliases, and there is no honest way
        // to derive eight distinguishable hues for code from four semantic ones. It
        // carries two full sets instead, one per theme, so neither is an inversion of
        // the other.
        return !line.includes('var(--dsw-alias-') && !line.includes('--lab-syn-')
      })
      .map(match => match[0])
    expect(hexOutsideFallback).toEqual([])
  })

  it('gives every inline-sized element a display, so the size is not ignored', () => {
    // A `<span>` whose parent is not a flex or grid container stays an inline box,
    // and an inline box ignores width and height entirely. The context meter was
    // built exactly that way: the fill received its percentage as an inline style
    // and rendered at zero width in every theme and every session, which nothing
    // else here could catch — the class existed, the rule existed, the colour was
    // a token, and jsdom computes no layout.
    // Read backwards from each inline size to the className that precedes it,
    // because the className may be a template literal rather than a plain string —
    // which is exactly the form the meter uses.
    const sized = [...clientSource.matchAll(/style=\{\{\s*(?:width|height):/g)]
      .flatMap((match) => {
        const before = clientSource.slice(Math.max(0, match.index - 400), match.index)
        const attribute = before.lastIndexOf('className=')
        if (attribute < 0) return []
        // Base classes only: a `--modifier` exists to shift one property, and the
        // display belongs on the class that defines the box.
        return [...before.slice(attribute).matchAll(/\blab-[a-z0-9-]+/g)]
          .map(token => token[0])
          .filter(name => !name.includes('--'))
      })
    // A guard that asserts nothing would pass forever; if the meter is ever
    // rewritten without an inline size this needs deleting, not silently skipping.
    expect(sized).toContain('lab-usage-fill')
    for (const name of new Set(sized)) {
      const rule = PANEL_STYLES.match(new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`))
      expect(rule, `${name} is sized inline but has no rule`).not.toBeNull()
      expect(rule![1], `${name} is sized inline, so it must declare a display`).toContain('display:')
    }
  })
})
