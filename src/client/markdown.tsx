/**
 * Rendering the markdown the agents actually write.
 *
 * Both products answer in markdown — headings, tables, bold, fenced code — and the
 * panel was showing it raw: literal asterisks and pipe characters where a table
 * should be.
 *
 * Written here rather than pulled in, for two reasons that matter more than the
 * hundred lines it costs.
 *
 * **It cannot inject.** Every node below is a React element, and React escapes text
 * children. There is no `dangerouslySetInnerHTML` anywhere in this file, so no
 * markdown-to-HTML step exists for a sanitizer to have to catch up with. That is
 * worth insisting on: an agent's output is not trusted input — it can be shaped by
 * whatever the agent just read — and this panel renders it inside a Harness that
 * holds the operator's session.
 *
 * **It degrades instead of failing.** Text arrives mid-token from the streaming
 * reveal, so a paragraph is routinely a half-written table or an unclosed bold run.
 * Anything unrecognised, unterminated or nested beyond what is handled renders as
 * the characters that were typed — which is exactly what the panel did before, so
 * the worst case is no worse than the status quo.
 *
 * Deliberately not supported: raw HTML, images, footnotes, blockquotes, nested
 * lists, and reference links. They appear as their source text. Links are rendered
 * as their label followed by the URL in parentheses rather than as anchors: a
 * clickable target composed by a model that just read an untrusted file is an
 * attack surface this view does not need.
 */
import type { ReactNode } from 'react'

/**
 * Heading class per level, written out rather than interpolated.
 *
 * A `lab-md-heading--${level}` template compiles fine and leaves no literal for a
 * reader or the stylesheet guard to check — the same reason the timeline's row
 * modifiers and the trace's lane classes are tables. Index is the level; slot zero
 * is unused so the numbering reads naturally.
 */
const HEADING_CLASS: readonly string[] = [
  '',
  'lab-md-heading--1',
  'lab-md-heading--2',
  'lab-md-heading--3',
  'lab-md-heading--4',
  'lab-md-heading--5',
  'lab-md-heading--6',
]

/** A run of inline markup found in a line. */
interface InlineRule {
  readonly pattern: RegExp
  readonly render: (match: RegExpExecArray, key: string) => ReactNode
}

/**
 * Inline rules, in precedence order.
 *
 * Code first, and it is not a style choice: backticks suppress everything inside
 * them, so `**not bold**` in a code span has to be claimed before the bold rule
 * sees it. Bold before italic for the same reason — `**` would otherwise match as
 * two nested italics.
 */
const INLINE_RULES: readonly InlineRule[] = [
  {
    pattern: /`([^`\n]+)`/,
    render: (match, key) => <code key={key} className="lab-md-code">{match[1]}</code>,
  },
  {
    pattern: /\*\*([^*\n]+)\*\*/,
    render: (match, key) => <strong key={key}>{match[1]}</strong>,
  },
  {
    pattern: /(?<![\w*])\*([^*\n]+)\*(?![\w*])/,
    render: (match, key) => <em key={key}>{match[1]}</em>,
  },
  {
    // The label keeps its own inline markup; the target is shown, not linked.
    pattern: /\[([^\]\n]*)\]\(([^)\s]+)\)/,
    render: (match, key) => (
      <span key={key}>
        {match[1]}
        <span className="lab-md-url">{` (${match[2] ?? ''})`}</span>
      </span>
    ),
  },
]

/**
 * Render one line's inline markup.
 *
 * Finds the earliest match across every rule rather than applying rules in turn, so
 * markup is claimed in the order it appears in the text. An unterminated run matches
 * nothing and survives as literal characters.
 * @param text - one line, or a table cell.
 * @param keyPrefix - unique within the parent block.
 * @returns React children.
 */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  let rest = text
  let index = 0
  while (rest.length > 0) {
    let earliest: { at: number; match: RegExpExecArray; rule: InlineRule } | null = null
    for (const rule of INLINE_RULES) {
      const match = rule.pattern.exec(rest)
      if (match === null) continue
      if (earliest === null || match.index < earliest.at) {
        earliest = { at: match.index, match, rule }
      }
    }
    if (earliest === null) {
      out.push(rest)
      break
    }
    if (earliest.at > 0) out.push(rest.slice(0, earliest.at))
    out.push(earliest.rule.render(earliest.match, `${keyPrefix}-i${String(index)}`))
    rest = rest.slice(earliest.at + earliest.match[0].length)
    index += 1
  }
  return out
}

/** Split a table row on unescaped pipes, dropping the leading and trailing ones. */
function cells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map(cell => cell.trim())
}

/** Is this the `|:--|--:|` line that turns the row above it into a header? */
function isDivider(line: string | undefined): boolean {
  if (line === undefined) return false
  const parts = cells(line)
  return parts.length > 0 && parts.every(part => /^:?-{1,}:?$/.test(part))
}

/**
 * Render markdown as React elements.
 *
 * @param text - the agent's message, possibly mid-sentence.
 * @returns block-level children.
 */
export function Markdown({ text }: { text: string }): ReactNode {
  const lines = text.split('\n')
  const blocks: ReactNode[] = []
  let index = 0
  let key = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''

    // Fenced code. An unclosed fence runs to the end of what has arrived, which is
    // the common case while a message is still streaming.
    const fence = /^\s*```(\w*)\s*$/.exec(line)
    if (fence !== null) {
      const body: string[] = []
      index += 1
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '')
        index += 1
      }
      index += 1
      key += 1
      blocks.push(<pre key={`b${String(key)}`} className="lab-md-pre">{body.join('\n')}</pre>)
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      key += 1
      // One element for every level: a message is a card in a transcript, not a
      // document, so its headings are weights rather than an outline the page
      // structure should claim.
      blocks.push(
        <p
          key={`b${String(key)}`}
          className={`lab-md-heading ${HEADING_CLASS[Math.min(6, (heading[1] ?? '#').length)] ?? ''}`}
        >
          {inline(heading[2] ?? '', `b${String(key)}`)}
        </p>,
      )
      index += 1
      continue
    }

    // A table: a row of pipes, then a divider. Without the divider it is prose that
    // happens to contain pipes, and is left alone.
    if (line.trim().startsWith('|') && isDivider(lines[index + 1])) {
      const header = cells(line)
      index += 2
      const rows: string[][] = []
      while (index < lines.length && (lines[index] ?? '').trim().startsWith('|')) {
        rows.push(cells(lines[index] ?? ''))
        index += 1
      }
      key += 1
      const tableKey = `b${String(key)}`
      blocks.push(
        <div key={tableKey} className="lab-md-table-wrap">
          <table className="lab-md-table">
            <thead>
              <tr>
                {header.map((cell, column) => (
                  <th key={`${tableKey}-h${String(column)}`}>{inline(cell, `${tableKey}-h${String(column)}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`${tableKey}-r${String(rowIndex)}`}>
                  {row.map((cell, column) => (
                    <td key={`${tableKey}-r${String(rowIndex)}c${String(column)}`}>
                      {inline(cell, `${tableKey}-r${String(rowIndex)}c${String(column)}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (bullet !== null || numbered !== null) {
      const ordered = bullet === null
      const items: string[] = []
      while (index < lines.length) {
        const candidate = lines[index] ?? ''
        const next = ordered
          ? /^\s*\d+[.)]\s+(.*)$/.exec(candidate)
          : /^\s*[-*+]\s+(.*)$/.exec(candidate)
        if (next === null) break
        items.push(next[1] ?? '')
        index += 1
      }
      key += 1
      const listKey = `b${String(key)}`
      const children = items.map((item, position) => (
        <li key={`${listKey}-${String(position)}`}>{inline(item, `${listKey}-${String(position)}`)}</li>
      ))
      blocks.push(ordered
        ? <ol key={listKey} className="lab-md-list">{children}</ol>
        : <ul key={listKey} className="lab-md-list">{children}</ul>)
      continue
    }

    // A paragraph runs to the next blank line. Single newlines inside it are kept as
    // line breaks: an agent listing steps on consecutive lines means them to stay on
    // consecutive lines, whatever CommonMark says about soft wraps.
    if (line.trim().length === 0) {
      index += 1
      continue
    }
    const paragraph: string[] = []
    while (index < lines.length) {
      const candidate = lines[index] ?? ''
      if (
        candidate.trim().length === 0
        || /^(#{1,6})\s+/.test(candidate)
        || /^\s*```/.test(candidate)
        || /^\s*[-*+]\s+/.test(candidate)
        || /^\s*\d+[.)]\s+/.test(candidate)
        || (candidate.trim().startsWith('|') && isDivider(lines[index + 1]))
      ) break
      paragraph.push(candidate)
      index += 1
    }
    key += 1
    const paragraphKey = `b${String(key)}`
    blocks.push(
      <p key={paragraphKey} className="lab-md-p">
        {paragraph.map((row, position) => (
          <span key={`${paragraphKey}-l${String(position)}`}>
            {position > 0 && <br />}
            {inline(row, `${paragraphKey}-l${String(position)}`)}
          </span>
        ))}
      </p>,
    )
  }

  return blocks
}
