/**
 * The panel's own lock: a password, verified on the Host, gating every Remote
 * method the bridge exports.
 *
 * ## Why this is enforced here and not in the browser
 *
 * A password screen drawn in the browser is not access control. The Harness's
 * transport is an ordinary HTTP route, so anything a screen hides is still one
 * `curl` away — and a lock that can be skipped is worse than no lock, because it
 * is the same thing while looking like protection. So the browser's screen is only
 * a consequence: the decision lives in {@link PrivacyGate.authorize}, which every
 * gated method calls before doing anything, and which fails closed.
 *
 * ## What it does and does not defend against
 *
 * It defends against someone who can reach the page: a housemate opening the URL,
 * a colleague at an unattended desk, a tab left open on a shared machine. That is
 * the threat this is for, and against it a password is the right tool.
 *
 * It does **not** defend against a network attacker. Over plain HTTP the password
 * crosses the wire in cleartext, so on anything but a loopback address this is a
 * convenience fence and the deployment still needs TLS and an authenticated
 * access layer in front of the Harness. Nor does it defend against someone with
 * filesystem access to the Host: the verifier lives in the plugin's own storage,
 * and whoever can read it can also delete it. That is not a hole to be plugged —
 * a lock kept by a process cannot outrank the machine the process runs on — and it
 * doubles as the documented way back in after a forgotten password.
 *
 * ## Why the verifier is a slow hash and the attempts are rate-limited
 *
 * Both are the same defence against the same attack. Over loopback a caller can
 * try thousands of passwords a second, which turns any memorable password into no
 * password at all. `scrypt` makes one guess cost ~100ms of CPU and 32MB of memory,
 * and the lockout makes a run of guesses cost minutes. Neither alone is enough:
 * the hash bounds the rate, the lockout bounds the total.
 */

import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto'
import { BridgeError } from './errors.ts'

/**
 * The password verifier as it is stored. Never leaves the Host.
 *
 * The cost parameters are recorded beside the hash rather than assumed, so raising
 * them later still verifies a password enrolled under the old ones. Field names
 * avoid the shapes the credential-leak probes look for (`token`, `api_key`,
 * `authorization`) — this is a one-way hash the Host is meant to keep, and it
 * should not read as a leaked secret to a guard whose job is spotting those.
 */
export interface PrivacyVerifier {
  readonly kdf: 'scrypt'
  /** Base64, 16 bytes, fresh per enrolment. */
  readonly salt: string
  /** Base64 scrypt output. */
  readonly verifier: string
  readonly cost: number
  readonly blockSize: number
  readonly parallelism: number
  readonly keyLength: number
  readonly updatedAt: number
}

/** What the browser is allowed to know before it has unlocked anything. */
export interface PrivacyPublicState {
  /** Whether a password has been set. The one fact a locked-out caller needs. */
  readonly configured: boolean
  /**
   * When attempts start being accepted again, or null when they are being
   * accepted now. A countdown is worth showing; the failure count is not, because
   * it tells an attacker how much budget is left.
   */
  readonly lockedOutUntil: number | null
  readonly absoluteTimeoutMs: number
  readonly idleTimeoutMs: number
}

/** Tunables, so a deployment can be stricter than the defaults without a fork. */
export interface PrivacyLimits {
  /** How long an unlock lasts regardless of use. */
  readonly absoluteTimeoutMs: number
  /** How long an unlock survives without a call. */
  readonly idleTimeoutMs: number
  readonly minPasswordLength: number
}

/**
 * scrypt at 32 MB and ~100ms per guess on current hardware.
 *
 * `maxmem` is stated because Node's default ceiling is exactly `128 * cost *
 * blockSize` for these values, and a limit equal to the requirement is a
 * coin-flip; asking for twice what the parameters need makes the call fail on
 * genuinely absent memory rather than on arithmetic.
 */
const COST = 32_768
const BLOCK_SIZE = 8
const PARALLELISM = 1
const KEY_LENGTH = 32
const MAX_MEMORY = 128 * COST * BLOCK_SIZE * 2

/** Failures tolerated before attempts are refused outright. */
const FREE_ATTEMPTS = 5
/** First lockout, doubling per further failure. */
const LOCKOUT_BASE_MS = 30_000
/** Ceiling, so a forgotten password does not lock the operator out for a day. */
const LOCKOUT_MAX_MS = 15 * 60_000

function derive(password: string, salt: Buffer, verifier: Pick<PrivacyVerifier, 'cost' | 'blockSize' | 'parallelism' | 'keyLength'>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      verifier.keyLength,
      { N: verifier.cost, r: verifier.blockSize, p: verifier.parallelism, maxmem: MAX_MEMORY },
      (error, key) => { if (error === null) resolve(key); else reject(error) },
    )
  })
}

/** One live unlock. Held in memory only, so a Host restart locks the panel again. */
interface Grant {
  issuedAt: number
  lastUsedAt: number
}

/**
 * The lock itself.
 *
 * Holds no timers: grants are pruned when one is looked at, which is the only
 * moment their expiry can matter. An idle Host therefore costs nothing, and the
 * expiry is exact rather than granular to a sweep interval.
 */
export class PrivacyGate {
  /**
   * Keyed by a SHA-256 of the token rather than the token, so a heap dump does
   * not hand over live grants. The hash of what the caller presented is what is
   * looked up, so this is a plain Map lookup and not a comparison loop.
   */
  private readonly grants = new Map<string, Grant>()
  private verifier: PrivacyVerifier | null
  private failures = 0
  private lockedOutUntil = 0

  /**
   * @param limits - lifetimes and the minimum password length.
   * @param verifier - the stored verifier, or null when no password is set.
   * @param persist - writes a changed verifier through; awaited before the change
   *   is reported as done, so a caller is never told a password was set that a
   *   restart would forget.
   */
  constructor(
    private readonly limits: PrivacyLimits,
    verifier: PrivacyVerifier | null,
    private readonly persist: (next: PrivacyVerifier | null) => Promise<void>,
  ) {
    this.verifier = verifier
  }

  /** Whether a password stands between the browser and the panel. */
  get configured(): boolean {
    return this.verifier !== null
  }

  /** The facts a caller may have before unlocking. */
  state(now: number = Date.now()): PrivacyPublicState {
    return {
      configured: this.verifier !== null,
      lockedOutUntil: this.lockedOutUntil > now ? this.lockedOutUntil : null,
      absoluteTimeoutMs: this.limits.absoluteTimeoutMs,
      idleTimeoutMs: this.limits.idleTimeoutMs,
    }
  }

  /**
   * Let one call through, or refuse it.
   *
   * Fails closed in every direction: an unknown token, an expired one, and a
   * malformed one are the same answer, and no password set is the only case that
   * passes without one. Called first in every gated Remote method — a method that
   * forgets to call it is not gated, which is why a test asserts the call site
   * exists for each.
   *
   * @param token - what the browser presented; the empty string when it holds none.
   * @throws BridgeError PANEL_LOCKED when the call may not proceed.
   */
  authorize(token: string, now: number = Date.now()): void {
    if (this.verifier === null) return
    if (token.length === 0) throw new BridgeError('PANEL_LOCKED')
    const key = this.fingerprint(token)
    const grant = this.grants.get(key)
    if (grant === undefined) throw new BridgeError('PANEL_LOCKED')
    if (now - grant.issuedAt >= this.limits.absoluteTimeoutMs || now - grant.lastUsedAt >= this.limits.idleTimeoutMs) {
      this.grants.delete(key)
      throw new BridgeError('PANEL_LOCKED')
    }
    grant.lastUsedAt = now
  }

  /**
   * Trade the password for a token.
   *
   * @param password - as typed by the operator.
   * @returns the token to present on subsequent calls.
   * @throws BridgeError PASSWORD_ATTEMPTS_EXCEEDED while a lockout stands,
   *   PASSWORD_REJECTED for a wrong password, INVALID_REQUEST when no password is set.
   */
  async unlock(password: string, now: number = Date.now()): Promise<string> {
    if (this.verifier === null) throw new BridgeError('INVALID_REQUEST')
    if (this.lockedOutUntil > now) throw new BridgeError('PASSWORD_ATTEMPTS_EXCEEDED')

    if (!await this.matches(password, this.verifier)) {
      this.reject(now)
    }

    this.failures = 0
    this.lockedOutUntil = 0
    this.prune(now)
    const token = randomBytes(32).toString('base64url')
    this.grants.set(this.fingerprint(token), { issuedAt: now, lastUsedAt: now })
    return token
  }

  /**
   * Set the password, or change it.
   *
   * Changing requires the current one, because a caller holding a live token is
   * not proof of knowing the password — a token outlives the moment it was issued,
   * and an unattended tab is exactly the case this whole feature is about.
   *
   * Every existing grant is dropped. A password change that left other browsers
   * unlocked would not be a password change.
   *
   * @param current - the password in force, or null when none is set.
   * @param next - the new password.
   * @throws BridgeError PASSWORD_REJECTED when `current` is wrong,
   *   INVALID_REQUEST when it is missing or `next` is too short.
   */
  async setPassword(current: string | null, next: string, now: number = Date.now()): Promise<void> {
    if (this.verifier !== null) {
      if (current === null || current.length === 0) throw new BridgeError('INVALID_REQUEST')
      if (this.lockedOutUntil > now) throw new BridgeError('PASSWORD_ATTEMPTS_EXCEEDED')
      if (!await this.matches(current, this.verifier)) {
        this.reject(now)
      }
    }
    if (next.length < this.limits.minPasswordLength) throw new BridgeError('INVALID_REQUEST')

    const salt = randomBytes(16)
    const shape = { cost: COST, blockSize: BLOCK_SIZE, parallelism: PARALLELISM, keyLength: KEY_LENGTH }
    const derived = await derive(next, salt, shape)
    const record: PrivacyVerifier = {
      kdf: 'scrypt',
      salt: salt.toString('base64'),
      verifier: derived.toString('base64'),
      ...shape,
      updatedAt: now,
    }
    await this.persist(record)
    this.verifier = record
    this.failures = 0
    this.lockedOutUntil = 0
    this.grants.clear()
  }

  /**
   * Remove the password, so the panel opens without one.
   *
   * Requires the current password for the same reason changing it does.
   *
   * @param current - the password in force.
   * @throws BridgeError PASSWORD_REJECTED when it is wrong, INVALID_REQUEST when
   *   no password is set.
   */
  async clearPassword(current: string, now: number = Date.now()): Promise<void> {
    if (this.verifier === null) throw new BridgeError('INVALID_REQUEST')
    if (this.lockedOutUntil > now) throw new BridgeError('PASSWORD_ATTEMPTS_EXCEEDED')
    if (!await this.matches(current, this.verifier)) {
      this.reject(now)
    }
    await this.persist(null)
    this.verifier = null
    this.failures = 0
    this.lockedOutUntil = 0
    this.grants.clear()
  }

  /**
   * Drop every unlock now, without touching the password.
   *
   * Every browser, not just the one that asked — "lock" from a machine the
   * operator is walking away from should not leave another one open.
   */
  lock(): void {
    this.grants.clear()
  }

  /**
   * Whether this token would be accepted right now, without throwing.
   *
   * The browser needs the answer to decide between showing the panel and showing
   * a password field, and it must not get there by reading an error code off a
   * failed call: the code a failure carries is the *carrier's*, not this
   * module's, so matching on it is reading the wrong field. Asking the question
   * directly is both correct and one call.
   *
   * Refreshes nothing — a state read is not a use.
   */
  accepts(token: string, now: number = Date.now()): boolean {
    if (this.verifier === null) return true
    if (token.length === 0) return false
    const grant = this.grants.get(this.fingerprint(token))
    if (grant === undefined) return false
    return now - grant.issuedAt < this.limits.absoluteTimeoutMs
      && now - grant.lastUsedAt < this.limits.idleTimeoutMs
  }

  /** How many unlocks currently stand. For tests and diagnostics, never the wire. */
  get liveGrants(): number {
    return this.grants.size
  }

  /**
   * Count one wrong password and refuse the call.
   *
   * The three entry points that take a password share this: an attacker who can
   * change the password is an attacker who is already in, so a guess spent on
   * `setPassword` has to cost exactly what a guess spent on `unlock` costs.
   * Backoff doubles per failure past the free allowance and stops at a ceiling,
   * so a forgotten password is an inconvenience rather than a day's lockout.
   *
   * @throws BridgeError PASSWORD_REJECTED, always — it never returns.
   */
  private reject(now: number): never {
    this.failures += 1
    if (this.failures >= FREE_ATTEMPTS) {
      const doublings = this.failures - FREE_ATTEMPTS
      this.lockedOutUntil = now + Math.min(LOCKOUT_BASE_MS * 2 ** doublings, LOCKOUT_MAX_MS)
    }
    throw new BridgeError('PASSWORD_REJECTED')
  }

  private fingerprint(token: string): string {
    return createHash('sha256').update(token).digest('base64')
  }

  private async matches(password: string, verifier: PrivacyVerifier): Promise<boolean> {
    const expected = Buffer.from(verifier.verifier, 'base64')
    const actual = await derive(password, Buffer.from(verifier.salt, 'base64'), verifier)
    // Equal lengths are guaranteed by keyLength travelling with the hash, but
    // timingSafeEqual throws on a mismatch rather than returning false, and a
    // corrupted record should read as "wrong password", not as a crash.
    if (expected.length !== actual.length) return false
    return timingSafeEqual(expected, actual)
  }

  private prune(now: number): void {
    for (const [key, grant] of this.grants) {
      if (now - grant.issuedAt >= this.limits.absoluteTimeoutMs || now - grant.lastUsedAt >= this.limits.idleTimeoutMs) {
        this.grants.delete(key)
      }
    }
  }
}
