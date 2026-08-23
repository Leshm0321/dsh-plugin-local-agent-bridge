/**
 * The panel's lock.
 *
 * Two kinds of check here, and the second matters more than the first.
 *
 * The behavioural tests exercise the gate: a right password, a wrong one, the
 * rate limit, both expiries, and the rule that changing a password invalidates
 * every unlock. Those are the parts a reader would expect.
 *
 * The source-level checks are the ones that keep the lock a lock. A gate is only
 * as good as the number of methods that ask it, so one test reads `src/index.ts`
 * and asserts that every `@Remote` method either calls `authorize` or is on a
 * short, named allow-list. Without it, the way this feature breaks is that
 * someone adds method twenty-nine and it is simply not gated — no error, no
 * failing test, just a hole. The wire schemas get the same treatment, because a
 * request type that forgot its token field cannot carry one.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PrivacyGate } from '../../src/core/privacy.ts'
import { BridgeError } from '../../src/core/errors.ts'
import { LOCAL_AGENT_BRIDGE_INVOCATIONS } from '../../src/typert.shared.ts'

const LIMITS = { absoluteTimeoutMs: 60_000, idleTimeoutMs: 10_000, minPasswordLength: 8 }

/** A gate with nothing stored, collecting what it would have persisted. */
function freshGate() {
  const written: unknown[] = []
  const gate = new PrivacyGate(LIMITS, null, async next => { written.push(next) })
  return { gate, written }
}

/** A gate with `password` already enrolled. */
async function lockedGate(password = 'correct-horse') {
  const { gate, written } = freshGate()
  await gate.setPassword(null, password)
  return { gate, written }
}

describe('privacy gate', () => {
  it('lets everything through while no password is set', () => {
    const { gate } = freshGate()
    expect(gate.configured).toBe(false)
    expect(() => { gate.authorize('') }).not.toThrow()
  })

  it('refuses everything once a password is set and nothing has unlocked', async () => {
    const { gate } = await lockedGate()
    expect(gate.configured).toBe(true)
    expect(() => { gate.authorize('') }).toThrow(BridgeError)
    expect(() => { gate.authorize('not-a-token') }).toThrow(BridgeError)
  })

  it('trades the right password for a token that authorizes', async () => {
    const { gate } = await lockedGate()
    const token = await gate.unlock('correct-horse')
    expect(token.length).toBeGreaterThan(20)
    expect(() => { gate.authorize(token) }).not.toThrow()
  })

  it('reports a wrong password as a wrong password, not as a product login problem', async () => {
    const { gate } = await lockedGate()
    // The distinction is the point: HOST_AUTH_REQUIRED sends the operator to a
    // terminal to re-authenticate a product, which would be the wrong errand.
    await expect(gate.unlock('wrong-horse')).rejects.toMatchObject({ code: 'PASSWORD_REJECTED' })
  })

  it('stops accepting attempts after a run of failures', async () => {
    const { gate } = await lockedGate()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(gate.unlock('wrong')).rejects.toMatchObject({ code: 'PASSWORD_REJECTED' })
    }
    // The sixth is refused before the password is even considered, so even the
    // right one is turned away while the lockout stands.
    await expect(gate.unlock('correct-horse')).rejects.toMatchObject({ code: 'PASSWORD_ATTEMPTS_EXCEEDED' })
    expect(gate.state().lockedOutUntil).not.toBeNull()
  })

  it('forgets the failures once a password lands', async () => {
    const { gate } = await lockedGate()
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(gate.unlock('wrong')).rejects.toThrow()
    }
    await gate.unlock('correct-horse')
    expect(gate.state().lockedOutUntil).toBeNull()
    // And the next four failures start from zero rather than tipping into lockout.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(gate.unlock('wrong')).rejects.toMatchObject({ code: 'PASSWORD_REJECTED' })
    }
  })

  it('expires a token at its absolute lifetime even while in use', async () => {
    const { gate } = await lockedGate()
    const start = 1_000_000
    const token = await gate.unlock('correct-horse', start)
    // Kept warm right up to the ceiling, so only the absolute limit can end it.
    for (let elapsed = 5_000; elapsed < LIMITS.absoluteTimeoutMs; elapsed += 5_000) {
      expect(() => { gate.authorize(token, start + elapsed) }).not.toThrow()
    }
    expect(() => { gate.authorize(token, start + LIMITS.absoluteTimeoutMs) }).toThrow(BridgeError)
  })

  it('expires a token that goes unused, well before its absolute lifetime', async () => {
    const { gate } = await lockedGate()
    const start = 1_000_000
    const token = await gate.unlock('correct-horse', start)
    expect(() => { gate.authorize(token, start + LIMITS.idleTimeoutMs) }).toThrow(BridgeError)
  })

  it('will not change a password without the current one', async () => {
    const { gate } = await lockedGate()
    await expect(gate.setPassword(null, 'a-new-password')).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(gate.setPassword('wrong', 'a-new-password')).rejects.toMatchObject({ code: 'PASSWORD_REJECTED' })
    await gate.setPassword('correct-horse', 'a-new-password')
    await expect(gate.unlock('correct-horse')).rejects.toThrow()
    await gate.unlock('a-new-password')
  })

  it('drops every unlock when the password changes', async () => {
    const { gate } = await lockedGate()
    const token = await gate.unlock('correct-horse')
    await gate.setPassword('correct-horse', 'a-new-password')
    // Otherwise a password change would leave the browser it was changed from —
    // and any other — still holding the old grant.
    expect(() => { gate.authorize(token) }).toThrow(BridgeError)
  })

  it('drops every unlock when locked, without touching the password', async () => {
    const { gate } = await lockedGate()
    const token = await gate.unlock('correct-horse')
    gate.lock()
    expect(() => { gate.authorize(token) }).toThrow(BridgeError)
    expect(gate.configured).toBe(true)
    await gate.unlock('correct-horse')
  })

  it('refuses a password shorter than the floor', async () => {
    const { gate } = freshGate()
    await expect(gate.setPassword(null, 'short')).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })

  it('persists a verifier that is a hash, not the password', async () => {
    const { written } = await lockedGate()
    expect(written).toHaveLength(1)
    const record = JSON.stringify(written[0])
    expect(record).not.toContain('correct-horse')
    expect(record).toContain('scrypt')
  })

  it('opens again after the password is removed', async () => {
    const { gate, written } = await lockedGate()
    await expect(gate.clearPassword('wrong')).rejects.toMatchObject({ code: 'PASSWORD_REJECTED' })
    await gate.clearPassword('correct-horse')
    expect(gate.configured).toBe(false)
    expect(() => { gate.authorize('') }).not.toThrow()
    expect(written.at(-1)).toBeNull()
  })
})

/** Methods that must work while the panel is locked, and why each one must. */
const UNGATED = new Map([
  ['privacyState', 'the panel cannot choose between asking for a password and asking to set one without it'],
  ['privacyUnlock', 'this is the door'],
  ['privacyPassword', 'gated by the password itself, which is stronger than a token here'],
  ['privacyClear', 'same'],
])

describe('the gate is asked by everything', () => {
  const source = readFileSync(join(process.cwd(), 'src/index.ts'), 'utf8')

  it('has a gate call in every Remote method that is not deliberately ungated', () => {
    // Each block runs from one @Remote to the next, so a method's body is
    // searched without needing to parse TypeScript.
    const blocks = source.split(/@Remote\(/).slice(1)
    const ungatedFound: string[] = []
    for (const block of blocks) {
      const name = /^'([a-zA-Z]+)'/.exec(block)?.[1]
      expect(name, 'every @Remote carries its export name').toBeDefined()
      if (UNGATED.has(name!)) continue
      if (!block.includes('.authorize(')) ungatedFound.push(name!)
    }
    expect(ungatedFound, 'a Remote method with no gate call is not gated').toEqual([])
  })

  it('gates every method the descriptor exports, so the two lists cannot drift', () => {
    // The source scan above proves the calls exist. This proves the set of
    // methods it scanned is the set the wire actually exposes — a method removed
    // from the descriptor but left in the source, or the reverse, shows up here.
    const exported = LOCAL_AGENT_BRIDGE_INVOCATIONS.map(entry => entry.method).sort()
    const declared = [...source.matchAll(/@Remote\('([a-zA-Z]+)'\)/g)].map(match => match[1]!).sort()
    expect(declared).toEqual(exported)
  })

  it('gives every gated request schema a token field to carry', () => {
    const missing: string[] = []
    for (const entry of LOCAL_AGENT_BRIDGE_INVOCATIONS) {
      if (UNGATED.has(entry.method)) continue
      const parameter = entry.parameters[0]
      expect(parameter, `${entry.method} takes a request, so the token has somewhere to travel`).toBeDefined()
      // The schemas are `.strict()`, so a token the schema does not declare is not
      // ignored — it fails the whole call. The field has to be there.
      const shape = (parameter!.codec.schema as unknown as { shape?: Record<string, unknown> }).shape
      expect(shape, `${entry.method} takes an object request`).toBeDefined()
      if (!Object.hasOwn(shape!, 'token')) missing.push(entry.method)
    }
    expect(missing, 'a strict request schema with no token field rejects every gated call').toEqual([])
  })
})
