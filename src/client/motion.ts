/**
 * Motion for the two things this panel needs that CSS cannot express.
 *
 * Nearly all of the panel's movement is already CSS — hovers, presses, the caret
 * rotation, the entrance of a popover, the context meter filling. Those stay CSS:
 * they run on the compositor, they cost nothing, and a transition is the clearest
 * way to say "this property changes over time".
 *
 * Two things resist that, and both are the same shape of problem — a layout size
 * that has no second keyframe to transition *to*:
 *
 *   - A fold. `height: 0` to `height: auto` is not an animatable pair; the
 *     computed value of `auto` is not a length until it is laid out. So a fold
 *     either snaps or something measures it.
 *   - The side panel. The body grows a third grid column when the panel opens, and
 *     a track list cannot be interpolated against a track list of a different
 *     length. So the panel pops into place, and the conversation jumps sideways
 *     to make room for it.
 *
 * Both need a number measured at run time and driven frame by frame, which is what
 * a tween engine is. GSAP handles the measurement (`height: 'auto'`), the
 * overwrite semantics when a fold is toggled mid-animation, and the frame loop —
 * all of which is where a hand-rolled `requestAnimationFrame` version goes wrong.
 *
 * Everything here is a no-op under `prefers-reduced-motion`, and every animation
 * clears its own inline styles when it lands, so an animated element ends up in
 * exactly the state the stylesheet describes. That last part matters more than it
 * sounds: a fold whose height stays pinned at a measured pixel value would clip
 * the rows that stream in after it opened.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'

/**
 * Matches `--lab-slow`, so a fold and the CSS transitions around it agree about how
 * fast this panel moves. GSAP counts in seconds.
 */
const DURATION = 0.28

/**
 * Matches `--lab-ease`: fast out of the gate, long settle. Expressed as the same
 * four control points rather than a named GSAP ease so the two never drift.
 */
const EASE = 'cubic-bezier(.32, .72, 0, 1)'

/**
 * Whether the operator has asked their system to stop animating things.
 *
 * Read at the moment of animating rather than watched, because the answer only
 * matters when something is about to move, and a `matchMedia` listener per folded
 * turn in a long transcript is a lot of listeners for a setting that changes once
 * a year. Guarded for the non-browser case so the module stays importable in tests.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * A fold that animates its own height, keeping its children mounted long enough to
 * collapse.
 *
 * The mount is the reason this is a hook rather than a CSS class. Content that is
 * unmounted cannot be animated out, and content that is left mounted forever costs
 * a long transcript real DOM — so `mounted` runs one step behind `open` on the way
 * closed, and exactly with it on the way open.
 *
 * Never animates on first paint. A transcript that has just loaded, or a session
 * that has just been resumed, would otherwise play back every fold it contains as
 * though it had been opened by hand.
 *
 * @param open - whether the fold should be showing its children.
 * @returns a ref for the element that holds the children, and whether to render them.
 */
export function useFoldHeight<E extends HTMLElement>(open: boolean) {
  const ref = useRef<E | null>(null)
  const [mounted, setMounted] = useState(open)
  /**
   * The state the element has already been animated to. Without it, any re-render
   * that happens to re-run the layout effect — a streamed row landing, a timer
   * tick — would replay the tween the fold already finished.
   */
  const settled = useRef(open)

  useEffect(() => {
    if (open) setMounted(true)
  }, [open])

  useLayoutEffect(() => {
    if (settled.current === open) return
    const element = ref.current
    if (element === null) {
      // Opening: the children have not been committed yet, so wait for the render
      // that `mounted` triggers. Closing: there was nothing mounted to collapse.
      if (!open) settled.current = false
      return
    }
    settled.current = open

    if (prefersReducedMotion()) {
      gsap.set(element, { clearProps: 'height,opacity,overflow' })
      if (!open) setMounted(false)
      return
    }

    if (open) {
      // A fold reopened mid-collapse is already at some height, and starting it over
      // from zero would be a visible snap backwards. Only a fold that was fully shut
      // needs its starting height stated.
      const resuming = gsap.isTweening(element)
      const landed = () => { gsap.set(element, { clearProps: 'height,opacity,overflow' }) }
      const to = { height: 'auto', opacity: 1, duration: DURATION, ease: EASE, overwrite: 'auto' as const, onComplete: landed }
      if (resuming) gsap.to(element, to)
      else gsap.fromTo(element, { height: 0, opacity: 0, overflow: 'hidden' }, to)
      return
    }

    gsap.to(element, {
      height: 0,
      opacity: 0,
      overflow: 'hidden',
      duration: DURATION,
      ease: EASE,
      overwrite: 'auto',
      // Only once the collapse has actually finished, and only if it finished — a
      // tween that GSAP overwrites because the fold was reopened never runs this.
      onComplete: () => { setMounted(false) },
    })
  }, [open, mounted])

  return { ref, mounted }
}

/**
 * A grid track that animates open and shut, for a panel that occupies one.
 *
 * The track is driven through a custom property on the container rather than by
 * animating the panel itself, because the point is the *layout*: the conversation
 * beside it should give up its room over the same interval, not reflow in one frame
 * behind a panel that slides. Tweening the variable moves both together.
 *
 * The open width is read off the container instead of being passed in as a number.
 * The stylesheet already states that width, and a copy of it here is a copy that
 * goes stale the first time someone widens the panel in CSS.
 *
 * Same mount discipline as {@link useFoldHeight}, and the same silence on first
 * paint — a panel that was already open when the panel mounted is simply open.
 *
 * @param open - whether the panel should be showing.
 * @param property - the custom property the track's width reads from.
 * @param openProperty - the custom property holding that track's open width.
 * @returns a ref for the grid container, and whether to render the panel.
 */
export function useTrackWidth<E extends HTMLElement>(open: boolean, property: string, openProperty: string) {
  const ref = useRef<E | null>(null)
  const [mounted, setMounted] = useState(open)
  const settled = useRef(open)

  useEffect(() => {
    if (open) setMounted(true)
  }, [open])

  useLayoutEffect(() => {
    if (settled.current === open) return
    const element = ref.current
    if (element === null) {
      if (!open) settled.current = false
      return
    }
    settled.current = open

    if (prefersReducedMotion()) {
      gsap.set(element, { clearProps: property })
      if (!open) setMounted(false)
      return
    }

    if (open) {
      // Clearing first, so the width read back is the stylesheet's and not the
      // inline zero a previous collapse may have left behind.
      gsap.set(element, { clearProps: property })
      const width = getComputedStyle(element).getPropertyValue(openProperty).trim()
      if (width.length === 0) { setMounted(true); return }
      const resuming = gsap.isTweening(element)
      const landed = () => { gsap.set(element, { clearProps: property }) }
      const to = { [property]: width, duration: DURATION, ease: EASE, overwrite: 'auto' as const, onComplete: landed }
      if (resuming) gsap.to(element, to)
      else gsap.fromTo(element, { [property]: '0px' }, to)
      return
    }

    // A custom property that is only ever set inline has no computed value to
    // animate *from* once the opening tween cleared it — GSAP would find nothing to
    // parse and jump straight to zero. So the collapse states its own start, except
    // when it is interrupting an opening tween, where the inline value is mid-flight
    // and is the only correct place to continue from.
    const shut = {
      [property]: '0px',
      duration: DURATION,
      ease: EASE,
      overwrite: 'auto' as const,
      onComplete: () => {
        setMounted(false)
        gsap.set(element, { clearProps: property })
      },
    }
    if (gsap.isTweening(element)) gsap.to(element, shut)
    else gsap.fromTo(element, { [property]: getComputedStyle(element).getPropertyValue(openProperty).trim() }, shut)
  }, [open, mounted, property, openProperty])

  return { ref, mounted }
}
