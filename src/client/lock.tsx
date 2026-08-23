/**
 * The panel's lock, on the browser's side of it.
 *
 * Everything that matters is enforced on the Host — see `src/core/privacy.ts`.
 * What lives here is the consequence: hold the token, put it on every call, show
 * a password field when there is no valid one, and stop pretending to be unlocked
 * the moment the Host says otherwise.
 *
 * That last part is why this is a state machine and not a boolean. A token
 * expires while the panel is open, mid-poll, with nothing having happened in the
 * UI to prompt a re-check — so the lock is driven by what the Host answers, not
 * by what the browser last believed.
 *
 * ## What this screen is not
 *
 * It is not what keeps anyone out; the Host is. A screen that were the only
 * barrier would be worse than none, because it would look like protection while
 * being one `curl` away. So nothing here is load-bearing: removing this file
 * would make the panel unusable, not open.
 */

import { useCallback, useEffect, useState } from 'react'
import type { GatedRemote, LocalAgentRemote } from './index.tsx'
import type { BridgePrivacyState } from '../types.ts'
import type { LocalAgentTranslate } from './locales.ts'

/**
 * Where the token is kept between page loads.
 *
 * `localStorage`, not `sessionStorage`, because the operator asked for an unlock
 * that lasts a fixed period rather than one that dies with the tab — and the
 * period is the Host's to enforce, so a token surviving a reload is not the
 * browser extending its own permission. Any script on this origin can read it,
 * which changes nothing: a script running here is already inside.
 */
const TOKEN_KEY = 'dsh-plugin-local-agent-bridge:panel-token'

function readStoredToken(): string {
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    // Private-mode and disabled-storage browsers throw rather than return null.
    // An unlock that cannot be remembered still works; it just does not persist.
    return ''
  }
}

function writeStoredToken(token: string): void {
  try {
    if (token.length === 0) window.localStorage.removeItem(TOKEN_KEY)
    else window.localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // As above: losing persistence is not losing the unlock.
  }
}

/**
 * The remote face with the unlock token put on every call.
 *
 * A proxy rather than thirty wrappers, for the reason a guard on the Host is a
 * single call rather than thirty checks: the failure mode to avoid is one method
 * being forgotten. A method added later is covered without being edited.
 *
 * The lock's own methods must not come through here — `privacyUnlock` takes a
 * password and a strict schema, so an injected token would be an unknown property
 * and the call would be rejected. The panel keeps the raw face for those instead
 * of this proxy carrying a list of exceptions that could drift.
 *
 * @param remote - the raw namespace face.
 * @param token - the current token, or the empty string when none is held.
 * @returns the same face, with `token` merged into each call's request.
 */
export function withToken(remote: LocalAgentRemote, token: string): GatedRemote {
  return new Proxy(remote, {
    // The receiver is deliberately not forwarded to `Reflect.get`. The face this
    // wraps is itself a Proxy that resolves a method against its own mount table,
    // and handing it this proxy as the receiver made it look the method up on the
    // wrong object — which surfaced as "Remote method … is no longer mounted" for
    // every call that went through here, while the raw face worked.
    get(target, key) {
      const value = Reflect.get(target, key) as unknown
      if (typeof value !== 'function') return value
      return (request?: object, ...rest: readonly unknown[]) => (value as (...args: unknown[]) => unknown).call(
        target,
        request === undefined ? { token } : { ...request, token },
        ...rest,
      )
    },
  }) as unknown as GatedRemote
}

export interface PanelLock {
  /** What the Host says about the lock, or undefined until it has been asked. */
  readonly state: BridgePrivacyState | undefined
  /**
   * Whether the answer is still unknown.
   *
   * Its own state, because the alternative was a two-valued `locked` that had to
   * guess during the gap — and either guess is wrong. Guessing unlocked shows the
   * panel to someone who set a password; guessing locked shows a password field to
   * someone who never did.
   */
  readonly pending: boolean
  /** Whether the panel should show its password screen instead of itself. */
  readonly locked: boolean
  /** The token to put on gated calls; empty when none is held. */
  readonly token: string
  /**
   * Ask the Host for the password state again.
   *
   * Takes the token to ask about, because the freshly issued one has to be
   * checked before the state that closes over the old one would report it.
   */
  readonly refresh: (candidate?: string) => Promise<void>
  /** Trade a password for a token. Returns an error code, or null on success. */
  readonly unlock: (password: string) => Promise<string | null>
  /** Set or change the password. Returns an error code, or null on success. */
  readonly setPassword: (current: string | null, next: string) => Promise<string | null>
  /** Remove the password. Returns an error code, or null on success. */
  readonly clearPassword: (current: string) => Promise<string | null>
  /** Lock now, everywhere. */
  readonly lock: () => Promise<void>
  /**
   * Called by the panel when a gated call came back `PANEL_LOCKED`, so the token
   * it was holding is dropped and the screen comes up.
   */
  readonly onRejected: () => void
}

/**
 * Hold the lock's state for the panel.
 *
 * @param remote - the **raw** face; the lock's own methods take no token.
 * @returns the lock, including the token every other call should carry.
 */
export function usePanelLock(remote: LocalAgentRemote): PanelLock {
  const [state, setState] = useState<BridgePrivacyState>()
  const [token, setToken] = useState(() => readStoredToken())

  /**
   * Read the lock's state, and never throw doing it.
   *
   * The Remote face is mounted by an effect during plugin boot, and this hook runs
   * as its panel first renders — so the very first read can land before the mount
   * and reject with "no longer mounted". Unhandled, that rejection escaped into the
   * boot chain and stopped the mount from finishing at all, which turned a race
   * into a panel with no working Remote. A failed read now means "not known yet",
   * which is a state this hook already has to represent.
   */
  const refresh = useCallback(async (candidate: string = token) => {
    try {
      const result = await remote.privacyState({ token: candidate })
      if (result.ok) setState(result.value)
    } catch {
      // Left undefined on purpose. The retry below covers the boot race, and the
      // panel shows neither itself nor a password field while the answer is unknown.
    }
  }, [remote, token])

  useEffect(() => { void refresh() }, [refresh])

  /**
   * Keep asking until there is an answer.
   *
   * Only while the state is unknown, so a settled panel schedules nothing. The
   * interval is short because the thing being waited for is a mount that happens
   * in the same tick as boot, not a network round trip.
   */
  useEffect(() => {
    if (state !== undefined) return
    const timer = setInterval(() => { void refresh() }, 500)
    return () => { clearInterval(timer) }
  }, [state, refresh])

  const onRejected = useCallback(() => {
    // Asks rather than assumes. A call can fail for reasons that have nothing to
    // do with the lock, and throwing away a good token on any failure would log
    // the operator out every time a product hiccupped.
    void refresh()
  }, [refresh])

  const unlock = useCallback(async (password: string) => {
    const result = await remote.privacyUnlock({ password })
    if (!result.ok) {
      // The lockout countdown lives in the state, so a refused attempt has to
      // re-read it or the screen would keep offering a field that cannot work.
      await refresh()
      return 'PASSWORD_REJECTED'
    }
    writeStoredToken(result.value.token)
    setToken(result.value.token)
    // Passed the fresh token explicitly: `refresh` closes over the old one, and
    // the state would come back saying still-locked.
    await refresh(result.value.token)
    return null
  }, [remote, refresh])

  const setPassword = useCallback(async (current: string | null, next: string) => {
    const result = await remote.privacyPassword({ current, next })
    if (!result.ok) {
      await refresh()
      return 'PASSWORD_REJECTED'
    }
    setState(result.value)
    // Setting a password drops every grant, including the one this browser holds,
    // so it has to unlock again — with the password it just chose.
    writeStoredToken('')
    setToken('')
    return null
  }, [remote, refresh])

  const clearPassword = useCallback(async (current: string) => {
    const result = await remote.privacyClear({ current })
    if (!result.ok) {
      await refresh()
      return 'PASSWORD_REJECTED'
    }
    setState(result.value)
    writeStoredToken('')
    setToken('')
    return null
  }, [remote, refresh])

  const lock = useCallback(async () => {
    await remote.privacyLock({ token })
    writeStoredToken('')
    setToken('')
    await refresh()
  }, [remote, token, refresh])

  return {
    state,
    pending: state === undefined,
    // Reported by the Host, not decided here: `unlocked` is its answer about the
    // very token this browser holds, so an expiry that happened server-side shows
    // up without the client having to read an error code to find out.
    locked: state !== undefined && state.configured && !state.unlocked,
    token,
    refresh,
    unlock,
    setPassword,
    clearPassword,
    lock,
    onRejected,
  }
}

/** How long until a lockout lifts, in whole seconds, or null when none stands. */
function secondsUntil(until: number | null, now: number): number | null {
  if (until === null) return null
  const remaining = Math.ceil((until - now) / 1000)
  return remaining > 0 ? remaining : null
}

/**
 * The password screen.
 *
 * Shown in place of the panel's body, not over it: there is nothing behind it to
 * see, and a modal over a rendered panel would be exactly the "looks protected"
 * shape this is not.
 */
export function LockScreen({ lock, t }: { lock: PanelLock; t: LocalAgentTranslate }) {
  const [password, setPassword] = useState('')
  const [failure, setFailure] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const lockedFor = secondsUntil(lock.state?.lockedOutUntil ?? null, now)
  // Ticks only while a lockout is actually counting down, so an idle screen costs
  // nothing.
  useEffect(() => {
    if (lockedFor === null) return
    const timer = setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { clearInterval(timer) }
  }, [lockedFor === null])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy || password.length === 0) return
    setBusy(true)
    setFailure(undefined)
    const code = await lock.unlock(password)
    setBusy(false)
    if (code === null) { setPassword(''); return }
    setFailure(code)
    setPassword('')
  }

  return (
    <div className="lab-lock">
      <form className="lab-lock-card" onSubmit={submit}>
        <h2 className="lab-lock-title">{t('lock.title')}</h2>
        <p className="lab-lock-note">{t('lock.note')}</p>
        <input
          className="lab-lock-input"
          type="password"
          autoComplete="current-password"
          aria-label={t('lock.password')}
          placeholder={t('lock.password')}
          value={password}
          disabled={busy || lockedFor !== null}
          onChange={event => { setPassword(event.target.value) }}
        />
        {lockedFor !== null && (
          <p className="lab-lock-error" role="alert">{t('lock.lockedOut', { count: lockedFor })}</p>
        )}
        {lockedFor === null && failure !== undefined && (
          <p className="lab-lock-error" role="alert">
            {t('lock.wrong')}
          </p>
        )}
        <button
          className="lab-lock-submit"
          type="submit"
          disabled={busy || lockedFor !== null || password.length === 0}
        >
          {busy ? t('lock.unlocking') : t('lock.unlock')}
        </button>
        {/* Said here rather than only in the docs, because this screen is the
            moment someone forms a belief about what it protects. */}
        <p className="lab-lock-scope">{t('lock.scope')}</p>
      </form>
    </div>
  )
}

/**
 * The Privacy page in the Harness's own Settings panel.
 *
 * Set a password, change it, remove it, or drop every unlock now. The one place
 * the feature is turned on and off — there is no config flag beside it, because
 * two answers to "is the panel locked" would eventually disagree.
 */
export function PrivacySection({ lock, t }: { lock: PanelLock; t: LocalAgentTranslate }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [failure, setFailure] = useState<string>()
  const [done, setDone] = useState<string>()
  const [busy, setBusy] = useState(false)

  const configured = lock.state?.configured === true
  const minimum = lock.state?.minPasswordLength ?? 8
  const tooShort = next.length > 0 && next.length < minimum
  const mismatched = confirm.length > 0 && confirm !== next

  const reset = () => { setCurrent(''); setNext(''); setConfirm('') }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy || tooShort || mismatched || next.length === 0) return
    setBusy(true)
    setFailure(undefined)
    setDone(undefined)
    const code = await lock.setPassword(configured ? current : null, next)
    setBusy(false)
    if (code !== null) { setFailure(code); return }
    reset()
    setDone('saved')
  }

  const remove = async () => {
    if (busy || current.length === 0) return
    setBusy(true)
    setFailure(undefined)
    setDone(undefined)
    const code = await lock.clearPassword(current)
    setBusy(false)
    if (code !== null) { setFailure(code); return }
    reset()
    setDone('cleared')
  }

  return (
    <div className="lab-privacy">
      <h3 className="lab-privacy-title">{t('privacy.title')}</h3>
      <p className="lab-privacy-note">{t('privacy.note')}</p>
      {/* The limit stated where the feature is turned on, not buried in a doc.
          Someone enabling a password is entitled to know what it does not cover. */}
      <p className="lab-privacy-limit">{t('privacy.limit')}</p>

      <form className="lab-privacy-form" onSubmit={save}>
        {configured && (
          <label className="lab-privacy-field">
            <span>{t('privacy.current')}</span>
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={event => { setCurrent(event.target.value) }}
            />
          </label>
        )}
        <label className="lab-privacy-field">
          <span>{configured ? t('privacy.next') : t('privacy.create')}</span>
          <input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={event => { setNext(event.target.value) }}
          />
        </label>
        <label className="lab-privacy-field">
          <span>{t('privacy.confirm')}</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={event => { setConfirm(event.target.value) }}
          />
        </label>

        {tooShort && <p className="lab-privacy-error">{t('privacy.tooShort', { count: minimum })}</p>}
        {mismatched && <p className="lab-privacy-error">{t('privacy.mismatch')}</p>}
        {failure !== undefined && (
          <p className="lab-privacy-error" role="alert">
            {t('privacy.wrong')}
          </p>
        )}
        {done !== undefined && (
          <p className="lab-privacy-done" role="status">
            {done === 'saved' ? t('privacy.saved') : t('privacy.cleared')}
          </p>
        )}

        <div className="lab-privacy-actions">
          <button type="submit" disabled={busy || next.length === 0 || tooShort || mismatched}>
            {configured ? t('privacy.change') : t('privacy.enable')}
          </button>
          {configured && (
            <>
              <button type="button" disabled={busy || current.length === 0} onClick={() => { void remove() }}>
                {t('privacy.disable')}
              </button>
              <button type="button" disabled={busy} onClick={() => { void lock.lock() }}>
                {t('privacy.lockNow')}
              </button>
            </>
          )}
        </div>
      </form>

      {configured && lock.state !== undefined && (
        <p className="lab-privacy-timeouts">
          {t('privacy.timeouts', {
            hours: Math.round(lock.state.absoluteTimeoutMs / 3_600_000),
            minutes: Math.round(lock.state.idleTimeoutMs / 60_000),
          })}
        </p>
      )}
    </div>
  )
}
