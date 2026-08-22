/**
 * What is uncommitted in the working directory.
 *
 * Two views of the same hunks. Unified is the default because the side panel is
 * narrow and a single column of long lines beats two columns of wrapped ones;
 * side-by-side is a click away for the cases where seeing both versions at once is
 * the point.
 *
 * The difference between them is real work rather than a layout switch: unified is
 * git's own line order, while side-by-side has to pair each removal with the addition
 * that replaced it, and pad whichever side runs out. That pairing is what makes a
 * changed line read as one change rather than as a deletion followed by an unrelated
 * insertion.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { ReactNode } from 'react'
import type { BridgeDiffHunk, BridgeDiffLine } from '../types.ts'

type Translate = TranslateNS<'local-agent-bridge'>

/** How a diff is laid out. */
export type DiffLayout = 'unified' | 'split'

/** One row of the side-by-side view: what was there, and what is there now. */
interface SplitRow {
  readonly left: BridgeDiffLine | null
  readonly right: BridgeDiffLine | null
}

/**
 * Pair a hunk's lines into rows for the side-by-side view.
 *
 * Runs of removals and additions are collected and then matched by position, so an
 * edited line shows its old and new form on one row. Context lines occupy both sides.
 * Whichever run is longer leaves blank cells on the other side, which is the honest
 * rendering — three lines replaced by one is not three edits.
 * @param lines - the hunk's lines in git's order.
 * @returns rows for the split layout.
 */
export function pairLines(lines: readonly BridgeDiffLine[]): SplitRow[] {
  const rows: SplitRow[] = []
  let removed: BridgeDiffLine[] = []
  let added: BridgeDiffLine[] = []

  const flush = (): void => {
    for (let index = 0; index < Math.max(removed.length, added.length); index += 1) {
      rows.push({ left: removed[index] ?? null, right: added[index] ?? null })
    }
    removed = []
    added = []
  }

  for (const line of lines) {
    if (line.kind === 'removed') removed.push(line)
    else if (line.kind === 'added') added.push(line)
    else {
      flush()
      rows.push({ left: line, right: line })
    }
  }
  flush()
  return rows
}

/** Class per line kind, written out for the reason every other modifier table is. */
const LINE_CLASS: Record<BridgeDiffLine['kind'], string> = {
  context: 'lab-diff-line--context',
  added: 'lab-diff-line--added',
  removed: 'lab-diff-line--removed',
}

/**
 * A file's hunks, in one layout or the other.
 * @param hunks - the file's diff.
 * @param layout - which view to draw.
 * @param t - the panel's translator.
 */
export function DiffBody({
  hunks,
  layout,
  t,
}: {
  hunks: readonly BridgeDiffHunk[]
  layout: DiffLayout
  t: Translate
}): ReactNode {
  if (hunks.length === 0) return <p className="lab-browse-note">{t('diff.noHunks')}</p>
  return (
    <div className={layout === 'split' ? 'lab-diff lab-diff--split' : 'lab-diff'}>
      {hunks.map((hunk, hunkIndex) => (
        <div key={`h${String(hunkIndex)}`} className="lab-diff-hunk">
          <div className="lab-diff-header">{hunk.header}</div>
          {layout === 'unified'
            ? hunk.lines.map((line, index) => (
              <div key={`u${String(hunkIndex)}-${String(index)}`} className={`lab-diff-line ${LINE_CLASS[line.kind]}`}>
                <span className="lab-diff-num">{line.oldNumber ?? ''}</span>
                <span className="lab-diff-num">{line.newNumber ?? ''}</span>
                <span className="lab-diff-sign">
                  {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}
                </span>
                <span className="lab-diff-text">{line.text}</span>
              </div>
            ))
            : pairLines(hunk.lines).map((row, index) => (
              <div key={`s${String(hunkIndex)}-${String(index)}`} className="lab-diff-row">
                <span className={`lab-diff-side ${row.left === null ? 'lab-diff-side--empty' : LINE_CLASS[row.left.kind]}`}>
                  <span className="lab-diff-num">{row.left?.oldNumber ?? ''}</span>
                  <span className="lab-diff-text">{row.left?.text ?? ''}</span>
                </span>
                <span className={`lab-diff-side ${row.right === null ? 'lab-diff-side--empty' : LINE_CLASS[row.right.kind]}`}>
                  <span className="lab-diff-num">{row.right?.newNumber ?? ''}</span>
                  <span className="lab-diff-text">{row.right?.text ?? ''}</span>
                </span>
              </div>
            ))}
        </div>
      ))}
    </div>
  )
}
