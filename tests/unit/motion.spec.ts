/**
 * Guards for the two animations that are not CSS.
 *
 * `motion.ts` restates two things the stylesheet already says — how long this panel
 * takes to move, and with what easing — because GSAP counts in seconds and cannot
 * read a CSS custom property as a tween duration. A restatement drifts silently:
 * nothing breaks, the fold just moves at a different speed from every transition
 * beside it, which is the kind of wrongness nobody files a bug about.
 *
 * The third guard is a coupling in the other direction. The side panel's open width
 * is read off the element at run time, so the tween's target lives in the sheet. Delete
 * that declaration and the panel stops animating and starts snapping, with no error.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PANEL_STYLES } from '../../src/client/styles.ts'

const source = readFileSync(join(process.cwd(), 'src/client/motion.ts'), 'utf8')

/** The value of a custom property declared in the sheet's token block. */
function token(name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(PANEL_STYLES)
  return match?.[1]?.trim() ?? ''
}

describe('motion', () => {
  it('tweens for exactly as long as the transitions beside it', () => {
    const declared = token('--lab-slow')
    expect(declared).not.toBe('')
    const seconds = Number(/DURATION = ([\d.]+)/.exec(source)?.[1])
    // The sheet writes .28s, GSAP wants 0.28 — same number, different units.
    expect(seconds).toBeCloseTo(Number.parseFloat(declared), 5)
  })

  it('tweens on the same curve as the transitions beside it', () => {
    const declared = token('--lab-ease')
    expect(declared).not.toBe('')
    const used = /EASE = '([^']+)'/.exec(source)?.[1]
    // Compared without whitespace: the sheet and the tween may space the control
    // points differently and still describe one curve.
    expect(used?.replaceAll(' ', '')).toBe(declared.replaceAll(' ', ''))
  })

  it('has a width in the sheet for the side panel to open to', () => {
    expect(token('--lab-side-open')).toMatch(/^\d+px$/)
    // And the track has to actually read it, through the property the tween drives.
    expect(PANEL_STYLES).toContain('var(--lab-side-width, var(--lab-side-open))')
  })

  it('does nothing when the operator has asked for less motion', () => {
    // Every branch that animates is preceded by this check. Asserting the call exists
    // is weak; asserting it is checked once per animated hook is what catches a third
    // hook being added without it.
    const hooks = [...source.matchAll(/^export function (use\w+)/gm)].map(match => match[1])
    expect(hooks.length).toBeGreaterThan(0)
    // Matched in its guard form, so the function's own declaration is not counted.
    expect([...source.matchAll(/if \(prefersReducedMotion\(\)\)/g)]).toHaveLength(hooks.length)
  })
})
