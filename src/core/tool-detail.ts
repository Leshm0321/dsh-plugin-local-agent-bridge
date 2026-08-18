/**
 * Formatting a tool call's arguments and result for the browser.
 *
 * Shared by both adapters so the redaction and length rules are decided once. The
 * two products describe tool calls in their own shapes, but what has to happen to
 * that data before it leaves the Host is identical: run it through the credential
 * redaction every other vendor string goes through, and cut it to something a
 * panel can render.
 *
 * The cut matters. A `Read` can return an entire file and a `Bash` can return
 * megabytes of log; sending that to a browser to display in a collapsed row wastes
 * the wire and the event-retention budget for no benefit. Truncation is reported
 * rather than hidden, so a reader knows the excerpt is an excerpt.
 */
import type { BridgeToolDetail } from '../types.ts'
import { redactText, redactValue } from './redaction.ts'

/**
 * Per-field budget. Generous enough for a diff or a stack trace, small enough
 * that a runaway tool result cannot dominate a session's retained events.
 */
const FIELD_LIMIT = 4_000

/**
 * Render a tool's arguments for reading.
 *
 * An object is pretty-printed because tool arguments are read as structure — a
 * file path, a pattern, a command — and a single line of JSON hides exactly that.
 * A lone string argument is shown as itself rather than quoted.
 * @param input - the product's arguments, any shape.
 * @returns readable text, or null when there is nothing to show.
 */
function formatInput(input: unknown): string | null {
  if (input === null || input === undefined) return null
  if (typeof input === 'string') return input.trim().length === 0 ? null : input
  if (typeof input !== 'object') return String(input)
  const entries = Object.entries(input as Record<string, unknown>)
  if (entries.length === 0) return null
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    // A cyclic or otherwise unserializable payload is the product's business, not
    // something to fail a turn over.
    return null
  }
}

/**
 * Render a tool's result for reading.
 *
 * Products return results as a string, or as content blocks, or as an object. All
 * three reduce to text here; a block list is joined so a multi-part result reads
 * as one body rather than as JSON scaffolding.
 * @param output - the product's result, any shape.
 * @returns readable text, or null when there is nothing to show.
 */
function formatOutput(output: unknown): string | null {
  if (output === null || output === undefined) return null
  if (typeof output === 'string') return output.trim().length === 0 ? null : output
  if (Array.isArray(output)) {
    const parts = output
      .map((block) => {
        if (typeof block === 'string') return block
        const text = (block as { text?: unknown } | null)?.text
        return typeof text === 'string' ? text : null
      })
      .filter((part): part is string => part !== null && part.trim().length > 0)
    return parts.length === 0 ? null : parts.join('\n')
  }
  return formatInput(output)
}

/**
 * Build the browser-facing detail for one tool call.
 *
 * Returns undefined when there is nothing worth carrying, so the wire stays empty
 * rather than gaining a detail object of two nulls. Redaction runs on the parsed
 * value, before formatting, so a credential nested in an argument object is caught
 * by key as well as by pattern.
 * @param input - the product's tool arguments.
 * @param output - the product's tool result; omit while the call is running.
 * @returns the detail, or undefined when both fields are empty.
 */
export function toolDetail(input: unknown, output?: unknown): BridgeToolDetail | undefined {
  const inputText = formatInput(redactValue(input))
  const outputText = formatOutput(redactValue(output))
  if (inputText === null && outputText === null) return undefined
  const cutInput = inputText !== null && inputText.length > FIELD_LIMIT
  const cutOutput = outputText !== null && outputText.length > FIELD_LIMIT
  return {
    // redactText also enforces its own ceiling; passing the budget keeps the two
    // limits from disagreeing about where the cut happened.
    input: inputText === null ? null : redactText(inputText, FIELD_LIMIT),
    output: outputText === null ? null : redactText(outputText, FIELD_LIMIT),
    truncated: cutInput || cutOutput,
  }
}
