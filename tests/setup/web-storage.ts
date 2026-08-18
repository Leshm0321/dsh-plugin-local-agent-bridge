/**
 * Web Storage shim for the jsdom suites.
 *
 * jsdom 29 running on Node 24+ exposes no `localStorage`/`sessionStorage`: the
 * document origin is fine (`http://localhost:3000`), but neither `window` nor
 * `globalThis` carries the accessors, and Node's own experimental Web Storage
 * stays inert without `--localstorage-file`. The Client under test never reads
 * storage — the panel keeps no browser state by design — yet the credential
 * canary assertions must still scan it, and a scan of a missing API throws
 * before it can assert anything.
 *
 * A same-process in-memory implementation keeps those assertions meaningful:
 * whatever the panel would have written is visible here, so an accidental
 * future write still fails the residue scan instead of silently passing.
 * Installed only when the environment supplies a document but no storage, so
 * the node-environment suites and any future jsdom that ships its own
 * implementation are untouched.
 */

class MemoryStorage implements Storage {
  private readonly entries = new Map<string, string>()

  get length(): number {
    return this.entries.size
  }

  clear(): void {
    this.entries.clear()
  }

  getItem(key: string): string | null {
    return this.entries.get(String(key)) ?? null
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.entries.delete(String(key))
  }

  setItem(key: string, value: string): void {
    this.entries.set(String(key), String(value))
  }
}

function install(name: 'localStorage' | 'sessionStorage'): void {
  const storage = new MemoryStorage()
  for (const target of new Set<object>([globalThis, globalThis.window])) {
    Object.defineProperty(target, name, {
      configurable: true,
      enumerable: true,
      get: () => storage,
    })
  }
}

if (typeof globalThis.document !== 'undefined') {
  if (globalThis.localStorage === undefined) install('localStorage')
  if (globalThis.sessionStorage === undefined) install('sessionStorage')
}
