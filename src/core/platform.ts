/**
 * The bridge's single platform decision.
 *
 * Launching a Host-installed CLI differs between platforms in exactly one way.
 * On macOS and Linux the resolved path is an executable file — a real binary, or
 * a script whose shebang the kernel honours — so it is exec'd directly with its
 * arguments, no shell in between. On Windows an npm-installed CLI resolves to a
 * `.cmd`/`.bat` shim, which is not executable on its own and must be
 * interpreted by `cmd.exe`.
 *
 * The Windows form passes the executable path through an environment variable
 * rather than inlining it into the command line, so a path containing spaces,
 * quotes, or `&` cannot break out of the command and become another command.
 * `/v:off` disables delayed expansion, keeping a `!` in the path literal.
 *
 * Three call sites need this (version probe, Claude SDK spawn, Codex App Server
 * spawn) and each used to carry its own copy of the branch. One definition with
 * an injectable platform means the POSIX path is asserted by tests on any host
 * rather than merely believed, so a future Windows-only edit cannot silently
 * regress macOS and Linux.
 */

/** A spawn description: argv plus any environment the argv form requires. */
export interface NativeCommand {
  readonly argv: string[]
  readonly env?: NodeJS.ProcessEnv
}

/** Windows shim extensions that cannot be exec'd directly. */
const BATCH_EXTENSIONS: readonly string[] = ['.cmd', '.bat']

/**
 * Whether this platform needs a `cmd.exe` wrapper for this executable.
 * @param executable - resolved absolute path to the product.
 * @param platform - target platform; defaults to the running one.
 * @returns true only for a Windows batch shim.
 */
export function needsBatchShim(executable: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'win32') return false
  const lower = executable.toLowerCase()
  return BATCH_EXTENSIONS.some(extension => lower.endsWith(extension))
}

/**
 * Build the argv (and any required environment) that runs a Host-installed
 * product with the given arguments.
 * @param executable - resolved absolute path to the product.
 * @param args - arguments passed to the product itself.
 * @param executableEnvVar - environment variable carrying the quoted path on
 * Windows; each call site uses its own name so a diagnostic points at the right
 * spawn.
 * @param platform - target platform; defaults to the running one.
 * @returns the spawn description.
 */
export function nativeCommand(
  executable: string,
  args: readonly string[],
  executableEnvVar: string,
  platform: NodeJS.Platform = process.platform,
): NativeCommand {
  if (!needsBatchShim(executable, platform)) {
    return { argv: [executable, ...args] }
  }
  return {
    argv: ['cmd.exe', '/d', '/v:off', '/s', '/c', `%${executableEnvVar}%`, ...args],
    env: { [executableEnvVar]: `"${executable}"` },
  }
}
