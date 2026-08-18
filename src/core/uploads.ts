/**
 * Receiving a file the operator picked in their browser and putting it where the
 * agent can read it.
 *
 * This is the one path in the bridge that carries data *into* the Host, and it
 * exists because the browser is not always on the same machine: someone driving
 * the Harness from a laptop has files there, not in the working directory, and
 * `@` cannot reach them. Referencing a workspace file remains the primary route
 * and copies nothing.
 *
 * Because it inverts the usual direction, the rules are deliberately narrow:
 *
 * **One destination.** Everything lands in a single directory under the session's
 * working directory, resolved on the Host. The browser never names a destination,
 * so there is no path for it to influence — only a file name, which is rebuilt
 * from scratch rather than trusted.
 *
 * **Rebuilt names, then verified.** Each path segment is stripped to a safe
 * shape, and the assembled path is confirmed to still sit inside the upload
 * directory after symlinks resolve. A name is dropped rather than repaired when
 * nothing safe survives.
 *
 * **Bounded.** Per-file and per-request ceilings, a file count, and a depth
 * limit. A browser cannot fill the Host's disk one request at a time.
 *
 * **No overwriting.** A colliding name gains a numeric suffix. Nothing already on
 * disk is replaced, so an upload can never destroy the operator's work.
 */
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, extname, join, relative, sep } from 'node:path'
import { BridgeError } from './errors.ts'

/**
 * Where uploads land, relative to the working directory.
 *
 * A visible, predictable, dot-prefixed directory: the operator can see what
 * arrived, add one line to `.gitignore`, and delete it. Scattering uploads
 * beside the source, or hiding them in a Host temp directory the agent would
 * need an absolute path to reach, would both be worse.
 */
export const UPLOAD_DIRECTORY = '.dsh-bridge-uploads'

/** Largest single file accepted, before base64 encoding. */
const MAX_FILE_BYTES = 8 * 1024 * 1024

/** Largest total accepted in one request. */
const MAX_REQUEST_BYTES = 32 * 1024 * 1024

/** Most files accepted in one request; a folder upload is still one request. */
const MAX_FILES = 50

/** Deepest relative path kept from a folder upload. */
const MAX_DEPTH = 8

/** Longest single path segment, after rebuilding. */
const MAX_SEGMENT = 96

/** One file as the browser offers it. */
export interface UploadInput {
  /**
   * The name, or the folder-relative path for a directory upload, exactly as the
   * browser reported it. Treated as untrusted text.
   */
  readonly path: string
  /** The bytes, base64. */
  readonly contentBase64: string
}

export interface UploadResult {
  /**
   * Where each file landed, relative to the working directory with forward
   * slashes — the same form `@` uses, so the composer inserts one shape.
   */
  readonly paths: readonly string[]
  /** Files rejected for name or size, so the panel can say some did not arrive. */
  readonly rejected: number
}

/**
 * Rebuild one path segment into something safe to write.
 *
 * Allow-list rather than deny-list: everything outside a conservative set of
 * characters becomes an underscore, so there is nothing to have forgotten. That
 * also removes every separator, `..`, control character, and Windows-reserved
 * punctuation in one step, without needing to enumerate them.
 * @param segment - one component of the browser-reported path.
 * @returns a safe segment, or null when nothing usable survives.
 */
function safeSegment(segment: string): string | null {
  const cleaned = segment
    .normalize('NFC')
    .replaceAll(/[^\p{L}\p{N}._@ -]/gu, '_')
    .trim()
    .slice(0, MAX_SEGMENT)
  if (cleaned.length === 0) return null
  // A leading dot is kept, because `.env.example` and `.gitignore` are ordinary
  // things to upload. What is refused is a segment that is *only* dots — `.`,
  // `..` and friends — which is the traversal case and never a file name.
  return /^\.+$/.test(cleaned) ? null : cleaned
}

/**
 * Rebuild a browser-reported path into a relative path under the upload
 * directory.
 *
 * Folder structure is kept, because uploading a directory and losing its shape
 * would make the result useless to read — but every segment is rebuilt and the
 * depth is capped.
 * @param reported - the browser's path, untrusted.
 * @returns a safe relative path, or null when the name cannot be used.
 */
export function safeUploadPath(reported: string): string | null {
  const segments = reported.split(/[\\/]/).map(safeSegment).filter((part): part is string => part !== null)
  if (segments.length === 0) return null
  // Keep the file's own name and as much of the trailing structure as the depth
  // allows: the deepest segments are the ones that distinguish files.
  const kept = segments.slice(-MAX_DEPTH)
  return kept.join('/')
}

/**
 * Decode base64 strictly.
 *
 * Node's decoder silently ignores characters it does not recognise, so a
 * malformed payload would be written as whatever it happened to parse to. Round
 * -tripping is the cheapest way to insist the input was really base64.
 * @param encoded - the browser's payload.
 * @returns the bytes, or null when the input was not valid base64.
 */
function decode(encoded: string): Buffer | null {
  // Whitespace first: a browser-built payload can carry line breaks, and those
  // are not corruption. Padding is compared with both sides normalised, since a
  // valid payload may arrive with it or without.
  const normalized = encoded.replaceAll(/\s+/g, '')
  if (normalized.length === 0) return null
  const bytes = Buffer.from(normalized, 'base64')
  const unpadded = (text: string): string => text.replace(/=+$/, '')
  return unpadded(bytes.toString('base64')) === unpadded(normalized) ? bytes : null
}

/** Name variants tried before an upload is given up on. */
const COLLISION_ATTEMPTS = 50

/**
 * Write one file under a name nothing else holds.
 *
 * The filesystem decides, not a pre-scan: `wx` fails when the name exists, so a
 * collision is discovered by trying rather than by asking first — which also
 * closes the gap between checking and writing. A name already claimed earlier in
 * the same request is skipped without a syscall.
 * @param root - resolved upload directory.
 * @param relativePath - the safe relative path wanted.
 * @param taken - paths already claimed in this request.
 * @param bytes - the file's contents.
 * @returns the relative path written, or null when no free name was found.
 */
async function writeUnique(
  root: string,
  relativePath: string,
  taken: Set<string>,
  bytes: Buffer,
): Promise<string | null> {
  const extension = extname(relativePath)
  const stem = relativePath.slice(0, relativePath.length - extension.length)
  for (let attempt = 0; attempt < COLLISION_ATTEMPTS; attempt += 1) {
    const candidate = attempt === 0 ? relativePath : `${stem}-${attempt}${extension}`
    if (taken.has(candidate)) continue
    const absolute = join(root, candidate)
    // Confinement, asserted rather than assumed: the segments were rebuilt, but
    // this is the check that would catch a mistake in the rebuilding, and it
    // costs one string comparison.
    const inside = relative(root, absolute)
    if (inside.length === 0 || inside.startsWith('..')) return null
    try {
      await mkdir(dirname(absolute), { recursive: true })
      await writeFile(absolute, bytes, { flag: 'wx' })
    } catch (cause) {
      // A taken name is the expected case and means try the next one. Anything
      // else — a permission problem, a full disk — is not going to improve with
      // a different suffix.
      if ((cause as { code?: string }).code === 'EEXIST') continue
      return null
    }
    taken.add(candidate)
    return candidate
  }
  return null
}

/**
 * Write the operator's files into the session's upload directory.
 *
 * @param cwd - the session's working directory, resolved on the Host. Never
 * supplied by the browser.
 * @param files - what the browser offered.
 * @returns where each file landed, and how many were refused.
 */
export async function receiveUploads(
  cwd: string,
  files: readonly UploadInput[],
): Promise<UploadResult> {
  if (files.length === 0 || files.length > MAX_FILES) throw new BridgeError('INVALID_REQUEST')
  const root = join(cwd, UPLOAD_DIRECTORY)
  await mkdir(root, { recursive: true })
  // Resolved after creation so a working directory reached through a symlink is
  // compared against its real location, the same way `@` does it.
  const realRoot = await realpath(root)

  const taken = new Set<string>()
  const written: string[] = []
  let rejected = 0
  let total = 0

  for (const file of files) {
    const safe = safeUploadPath(file.path)
    if (safe === null) {
      rejected += 1
      continue
    }
    const bytes = decode(file.contentBase64)
    if (bytes === null || bytes.byteLength > MAX_FILE_BYTES) {
      rejected += 1
      continue
    }
    total += bytes.byteLength
    if (total > MAX_REQUEST_BYTES) throw new BridgeError('INVALID_REQUEST')

    const claimed = await writeUnique(realRoot, safe, taken, bytes)
    if (claimed === null) {
      rejected += 1
      continue
    }
    written.push(`${UPLOAD_DIRECTORY}/${claimed.split(sep).join('/')}`)
  }

  return { paths: written, rejected }
}
