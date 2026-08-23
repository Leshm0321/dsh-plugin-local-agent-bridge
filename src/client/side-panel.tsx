/**
 * The right-hand panel: what is in the project the agent is working on.
 *
 * A file tree and a viewer, side by side, because the two questions are "what is
 * here" and "what does that one say" and answering both at once is the whole value
 * of the layout. Reading a file the agent just changed should not mean leaving the
 * conversation.
 *
 * Everything is workspace-relative. The tree and the viewer both work in paths under
 * the session's working directory, resolved on the Host, so nothing here holds or
 * sends an absolute Host path — unlike the composer's host browser, which exists to
 * do exactly that and says so.
 */
import {
  IconCheckOutline16,
  IconCloseOutline16,
  IconCodeOutline16,
  IconEditOutline16,
  IconFolderClose16,
  IconFolderOpen16,
  IconPlusOutline16,
  IconTrashOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { useEffect, useMemo, useState } from 'react'
import { Code } from './code.tsx'
import type { GatedRemote } from './index.tsx'
import { DiffBody, type DiffLayout } from './diff-view.tsx'
import type {
  BridgeDiffEntry,
  BridgeDiffHunk,
  BridgeWorkspaceDiff,
  BridgeWorkspaceEntry,
  BridgeWorkspaceFile,
} from '../types.ts'

type Translate = TranslateNS<'local-agent-bridge'>

/**
 * A row in the flattened tree.
 *
 * Flattened rather than nested, so one map renders the whole thing and indentation
 * is a number rather than a nesting of components. Depth is carried because the
 * entry's path alone would have to be re-split to get it.
 */
interface TreeRow {
  readonly entry: BridgeWorkspaceEntry
  readonly depth: number
}

/**
 * Compact a byte count for the tree's right edge.
 * @param bytes - file size.
 * @returns a short label.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${String(bytes)}B`
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(bytes < 10 * 1_024 ? 1 : 0)}K`
  return `${(bytes / (1_024 * 1_024)).toFixed(1)}M`
}

/**
 * The project's files, with a viewer for the selected one.
 * @param remote - the bridge's Remote namespace.
 * @param bridgeSessionId - the session whose working directory this shows.
 * @param t - the panel's translator.
 */
export function FilesPane({
  remote,
  bridgeSessionId,
  writable,
  t,
}: {
  remote: GatedRemote
  bridgeSessionId: string
  /** Whether this Profile serves writes; false hides the controls entirely. */
  writable: boolean
  t: Translate
}) {
  // One entry per directory that has been read; absent means "not opened yet".
  const [levels, setLevels] = useState<ReadonlyMap<string, readonly BridgeWorkspaceEntry[]>>(new Map())
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [selected, setSelected] = useState<string>()
  const [file, setFile] = useState<BridgeWorkspaceFile>()
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string>()
  const [showHidden, setShowHidden] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [buffer, setBuffer] = useState('')
  const [saving, setSaving] = useState(false)
  // Where a name is being typed: creating into a directory, or renaming a path.
  const [naming, setNaming] = useState<{ kind: 'file' | 'directory' | 'rename'; at: string } | null>(null)
  const [name, setName] = useState('')

  /**
   * Read one directory level, once.
   * @param path - workspace-relative directory; empty is the root.
   */
  const load = async (path: string): Promise<void> => {
    setError(undefined)
    const result = await remote.workspaceList({ bridgeSessionId, path })
    if (!result.ok) {
      setError(result.error.code)
      return
    }
    setLevels(current => new Map(current).set(path, result.value.entries))
  }

  // The root, whenever the session changes. Deeper levels are read on demand,
  // because a tree that eagerly walked a monorepo would be Host work nobody asked
  // for.
  useEffect(() => {
    setLevels(new Map())
    setOpen(new Set())
    setSelected(undefined)
    setFile(undefined)
    setFilter('')
    void load('')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load is recreated each
    // render; this is keyed to the session, not to the function's identity.
  }, [bridgeSessionId])

  /**
   * Open or close a directory, reading it the first time.
   * @param path - the directory's workspace-relative path.
   */
  const toggle = (path: string): void => {
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else {
        next.add(path)
        if (!levels.has(path)) void load(path)
      }
      return next
    })
  }

  /**
   * Show a file.
   * @param path - the file's workspace-relative path.
   */
  const view = async (path: string): Promise<void> => {
    setSelected(path)
    setLoading(true)
    setError(undefined)
    const result = await remote.workspaceFile({ bridgeSessionId, path })
    setLoading(false)
    if (!result.ok) {
      setFile(undefined)
      setError(result.error.code)
      return
    }
    setFile(result.value)
  }

  /**
   * Re-read the directory an action changed, and the root if it was the root.
   * @param path - workspace-relative path of the affected directory.
   */
  const refresh = async (path: string): Promise<void> => {
    await load(path)
  }

  /**
   * Save the editor's buffer.
   *
   * A revision mismatch is reported rather than retried: the agent shares this tree,
   * and the operator has to decide whether their version or its version wins.
   */
  const save = async (): Promise<void> => {
    if (file === undefined || editing === null) return
    setSaving(true)
    const result = await remote.workspaceWrite({
      bridgeSessionId,
      path: editing,
      content: buffer,
      revision: file.revision,
    })
    if (!result.ok) {
      // Asked rather than inferred from the failure's code. The transport's code is
      // its own, not the Host's BridgeError code, so matching on it was guesswork —
      // and the real question is simply whether the file moved underneath us. One
      // extra read answers it definitively.
      const fresh = await remote.workspaceFile({ bridgeSessionId, path: editing })
      setSaving(false)
      if (fresh.ok && fresh.value.revision !== file.revision) {
        setError('stale')
        // The newer file is what the operator now has to reckon with, so it replaces
        // the viewer's copy while their own text stays in the editor.
        setFile(fresh.value)
        return
      }
      setError('write')
      return
    }
    setSaving(false)
    setFile(result.value)
    setEditing(null)
    setError(undefined)
  }

  /** Act on the name being typed, whichever action opened the field. */
  const commitName = async (): Promise<void> => {
    const trimmed = name.trim()
    if (naming === null || trimmed.length === 0) return
    setError(undefined)
    const parent = naming.kind === 'rename'
      ? naming.at.split('/').slice(0, -1).join('/')
      : naming.at
    const target = parent.length === 0 ? trimmed : `${parent}/${trimmed}`
    const result = naming.kind === 'rename'
      ? await remote.workspaceRename({ bridgeSessionId, from: naming.at, to: target })
      : await remote.workspaceCreate({ bridgeSessionId, path: target, directory: naming.kind === 'directory' })
    if (!result.ok) {
      setError(result.error.code)
      return
    }
    setNaming(null)
    setName('')
    await refresh(parent)
    // A renamed file that was open is no longer at the path the viewer holds.
    if (naming.kind === 'rename' && selected === naming.at) {
      setSelected(undefined)
      setFile(undefined)
      setEditing(null)
    }
  }

  /**
   * Delete an entry, then re-read the directory it was in.
   * @param path - workspace-relative path.
   * @param directory - what was asked about, so a refusal can be explained.
   */
  const remove = async (path: string, directory: boolean): Promise<void> => {
    setError(undefined)
    const result = await remote.workspaceDelete({ bridgeSessionId, path })
    if (!result.ok) {
      // The one business refusal here is a directory with contents, and the caller
      // already knows which it asked about — so the reason comes from what was
      // deleted rather than from decoding the transport's error code.
      setError(directory ? 'notEmpty' : 'write')
      return
    }
    await refresh(path.split('/').slice(0, -1).join(''))
    if (selected === path) {
      setSelected(undefined)
      setFile(undefined)
      setEditing(null)
    }
  }

  /**
   * The visible tree, flattened depth-first.
   *
   * A filter matches against the whole path and keeps only files, because filtering a
   * tree by name and still drawing the directory scaffolding shows mostly
   * scaffolding. With no filter the tree is its own shape.
   */
  const rows = useMemo<TreeRow[]>(() => {
    const needle = filter.trim().toLowerCase()
    if (needle.length > 0) {
      const matches: TreeRow[] = []
      for (const entries of levels.values()) {
        for (const entry of entries) {
          if (entry.directory || !entry.path.toLowerCase().includes(needle)) continue
          if (!showHidden && entry.hidden) continue
          matches.push({ entry, depth: 0 })
        }
      }
      return matches
        .sort((left, right) => left.entry.path.localeCompare(right.entry.path))
        .slice(0, 200)
    }
    const walk = (path: string, depth: number): TreeRow[] =>
      (levels.get(path) ?? [])
        .filter(entry => showHidden || !entry.hidden)
        .flatMap(entry => entry.directory && open.has(entry.path)
          ? [{ entry, depth }, ...walk(entry.path, depth + 1)]
          : [{ entry, depth }])
    return walk('', 0)
  }, [levels, open, filter, showHidden])

  return (
    <div className="lab-files">
      <div className="lab-files-viewer">
        {file !== undefined && (
          <div className="lab-files-crumbs">
            {file.path.split('/').map((part, index, all) => (
              <span key={`${part}-${String(index)}`}>
                {index > 0 && <span className="lab-crumb-sep">/</span>}
                <span className={index === all.length - 1 ? 'lab-files-crumb lab-files-crumb--last' : 'lab-files-crumb'}>
                  {part}
                </span>
              </span>
            ))}
            <span className="lab-files-meta">{formatBytes(file.bytes)}</span>
            {writable && !file.binary && (
              editing === null
                ? (
                  <button
                    type="button"
                    className="lab-files-action"
                    aria-label={t('files.edit')}
                    title={t('files.edit')}
                    // A truncated file must not be editable: saving would write the
                    // part that was shown over the whole file.
                    disabled={file.truncated}
                    onClick={() => { setEditing(file.path); setBuffer(file.content); setError(undefined) }}
                  >
                    <IconEditOutline16 />
                  </button>
                )
                : (
                  <>
                    <button
                      type="button"
                      className="lab-files-action"
                      aria-label={t('files.save')}
                      title={t('files.save')}
                      disabled={saving}
                      onClick={() => { void save() }}
                    >
                      <IconCheckOutline16 />
                    </button>
                    <button
                      type="button"
                      className="lab-files-action"
                      aria-label={t('files.cancel')}
                      title={t('files.cancel')}
                      onClick={() => { setEditing(null); setError(undefined) }}
                    >
                      <IconCloseOutline16 />
                    </button>
                  </>
                )
            )}
          </div>
        )}
        <div className="lab-files-content">
          {error === 'stale' && <p className="lab-files-warning">{t('files.stale')}</p>}
          {error === 'notEmpty' && <p className="lab-files-warning">{t('files.notEmpty')}</p>}
          {error === 'write' && <p className="lab-files-warning">{t('files.writeFailed')}</p>}
          {error !== undefined && error !== 'stale' && error !== 'notEmpty' && error !== 'write' && (
            <p className="lab-browse-note">{t('files.error')}</p>
          )}
          {loading && <p className="lab-browse-note">{t('browse.loading')}</p>}
          {!loading && error === undefined && file === undefined && (
            <div className="lab-files-empty">
              <IconCodeOutline16 />
              <p className="lab-files-empty-title">{t('files.pick')}</p>
              <p className="lab-browse-note">{t('files.pickHint')}</p>
            </div>
          )}
          {!loading && file?.binary === true && <p className="lab-browse-note">{t('files.binary')}</p>}
          {!loading && file !== undefined && !file.binary && editing === null && (
            <>
              <Code text={file.content} path={file.path} />
              {file.truncated && <p className="lab-browse-note">{t('files.cut')}</p>}
            </>
          )}
          {editing !== null && (
            /* A plain textarea, not the highlighted view made editable. Overlaying a
               caret on coloured spans is a rewrite of text editing, and getting it
               subtly wrong is worse than editing in monospace for a minute. */
            <textarea
              className="lab-files-editor"
              value={buffer}
              spellCheck={false}
              onChange={event => { setBuffer(event.target.value) }}
            />
          )}
        </div>
      </div>

      <div className="lab-files-tree">
        <div className="lab-files-toolbar">
          <input
            type="search"
            className="lab-input lab-files-filter"
            value={filter}
            placeholder={t('files.filter')}
            onChange={event => { setFilter(event.target.value) }}
          />
          {writable && (
            <>
              <button
                type="button"
                className="lab-files-action"
                aria-label={t('files.newFile')}
                title={t('files.newFile')}
                onClick={() => { setNaming({ kind: 'file', at: '' }); setName('') }}
              >
                <IconPlusOutline16 />
              </button>
              <button
                type="button"
                className="lab-files-action"
                aria-label={t('files.newDirectory')}
                title={t('files.newDirectory')}
                onClick={() => { setNaming({ kind: 'directory', at: '' }); setName('') }}
              >
                <IconFolderClose16 />
              </button>
            </>
          )}
        </div>
        {naming !== null && (
          <div className="lab-files-naming">
            <input
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the field exists
              // because a button was just pressed for it; focusing anything else would
              // be the surprise.
              autoFocus
              className="lab-input"
              value={name}
              placeholder={naming.kind === 'rename' ? t('files.renameTo') : t('files.nameIt')}
              onChange={event => { setName(event.target.value) }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { event.preventDefault(); void commitName() }
                if (event.key === 'Escape') { event.preventDefault(); setNaming(null) }
              }}
            />
            <button type="button" className="lab-files-action" aria-label={t('files.confirm')} onClick={() => { void commitName() }}>
              <IconCheckOutline16 />
            </button>
            <button type="button" className="lab-files-action" aria-label={t('files.cancel')} onClick={() => { setNaming(null) }}>
              <IconCloseOutline16 />
            </button>
          </div>
        )}
        <div className="lab-files-rows">
          {rows.length === 0 && <p className="lab-browse-note">{t('files.treeEmpty')}</p>}
          {rows.map(({ entry, depth }) => (
            <div key={entry.path} className="lab-files-line">
            <button
              type="button"
              className={entry.path === selected ? 'lab-files-row lab-files-row--on' : 'lab-files-row'}
              style={{ paddingLeft: `${String(8 + depth * 12)}px` }}
              title={entry.path}
              onClick={() => {
                if (entry.directory) toggle(entry.path)
                else void view(entry.path)
              }}
            >
              {entry.directory
                ? (open.has(entry.path) ? <IconFolderOpen16 /> : <IconFolderClose16 />)
                : <IconCodeOutline16 />}
              <span className="lab-files-name">{entry.name}</span>
              {entry.bytes !== null && <span className="lab-files-size">{formatBytes(entry.bytes)}</span>}
            </button>
            {writable && (
              <span className="lab-files-row-actions">
                {entry.directory && (
                  <button
                    type="button"
                    className="lab-files-action"
                    aria-label={t('files.newIn', { name: entry.name })}
                    title={t('files.newIn', { name: entry.name })}
                    onClick={() => { setNaming({ kind: 'file', at: entry.path }); setName('') }}
                  >
                    <IconPlusOutline16 />
                  </button>
                )}
                <button
                  type="button"
                  className="lab-files-action"
                  aria-label={t('files.rename', { name: entry.name })}
                  title={t('files.rename', { name: entry.name })}
                  onClick={() => { setNaming({ kind: 'rename', at: entry.path }); setName(entry.name) }}
                >
                  <IconEditOutline16 />
                </button>
                <button
                  type="button"
                  className="lab-files-action"
                  aria-label={t('files.delete', { name: entry.name })}
                  title={t('files.delete', { name: entry.name })}
                  onClick={() => { void remove(entry.path, entry.directory) }}
                >
                  <IconTrashOutline16 />
                </button>
              </span>
            )}
            </div>
          ))}
        </div>
        <label className="lab-browse-toggle">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={event => { setShowHidden(event.target.checked) }}
          />
          {t('browse.showHidden')}
        </label>
      </div>
    </div>
  )
}

/**
 * Uncommitted changes in the session's working directory.
 *
 * The list is read when the tab opens and re-read on demand, not on a timer: a diff
 * changes when the agent writes, and polling it would be Host work on every tick for
 * a view that is usually not open.
 */
export function DiffPane({
  remote,
  bridgeSessionId,
  t,
}: {
  remote: GatedRemote
  bridgeSessionId: string
  t: Translate
}) {
  const [diff, setDiff] = useState<BridgeWorkspaceDiff>()
  const [selected, setSelected] = useState<BridgeDiffEntry>()
  const [hunks, setHunks] = useState<readonly BridgeDiffHunk[]>([])
  const [layout, setLayout] = useState<DiffLayout>('unified')
  const [loading, setLoading] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    const result = await remote.workspaceDiff({ bridgeSessionId })
    setLoading(false)
    setDiff(result.ok ? result.value : { entries: [], unavailable: true })
  }

  useEffect(() => {
    setDiff(undefined)
    setSelected(undefined)
    setHunks([])
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed to the session,
    // not to the identity of a function rebuilt every render.
  }, [bridgeSessionId])

  /**
   * Show one file's changes.
   * @param entry - the file from the list.
   */
  const open = async (entry: BridgeDiffEntry): Promise<void> => {
    setSelected(entry)
    setHunks([])
    // An untracked or binary file has nothing to fetch, and asking anyway would be a
    // round trip whose answer is already known.
    if (entry.untracked || entry.binary) return
    setLoading(true)
    const result = await remote.workspaceFileDiff({ bridgeSessionId, path: entry.path })
    setLoading(false)
    if (result.ok) setHunks(result.value)
  }

  if (diff?.unavailable === true) {
    return <div className="lab-files-content"><p className="lab-browse-note">{t('diff.unavailable')}</p></div>
  }

  return (
    <div className="lab-files">
      <div className="lab-files-viewer">
        <div className="lab-files-crumbs">
          {selected !== undefined && <span className="lab-files-crumb--last">{selected.path}</span>}
          <span className="lab-files-meta">
            {selected !== undefined && !selected.untracked && !selected.binary && (
              t('diff.counts', { added: selected.added, removed: selected.removed })
            )}
          </span>
          {(['unified', 'split'] as const).map(candidate => (
            <button
              key={candidate}
              type="button"
              className={layout === candidate ? 'lab-diff-layout lab-diff-layout--on' : 'lab-diff-layout'}
              aria-pressed={layout === candidate}
              onClick={() => { setLayout(candidate) }}
            >
              {t(`diff.${candidate}`)}
            </button>
          ))}
        </div>
        <div className="lab-files-content">
          {loading && <p className="lab-browse-note">{t('browse.loading')}</p>}
          {!loading && selected === undefined && (
            <div className="lab-files-empty">
              <p className="lab-files-empty-title">{t('diff.pick')}</p>
            </div>
          )}
          {!loading && selected?.untracked === true && <p className="lab-browse-note">{t('diff.untracked')}</p>}
          {!loading && selected?.binary === true && <p className="lab-browse-note">{t('diff.binary')}</p>}
          {!loading && selected !== undefined && !selected.untracked && !selected.binary && (
            <DiffBody hunks={hunks} layout={layout} t={t} />
          )}
        </div>
      </div>

      <div className="lab-files-tree">
        <div className="lab-files-rows">
          {diff !== undefined && diff.entries.length === 0 && (
            <p className="lab-browse-note">{t('diff.clean')}</p>
          )}
          {(diff?.entries ?? []).map(entry => (
            <button
              key={entry.path}
              type="button"
              className={entry.path === selected?.path ? 'lab-files-row lab-files-row--on' : 'lab-files-row'}
              title={entry.path}
              onClick={() => { void open(entry) }}
            >
              <IconCodeOutline16 />
              <span className="lab-files-name">{entry.path}</span>
              <span className="lab-diff-counts">
                {entry.untracked
                  ? t('diff.untrackedTag')
                  : entry.binary
                    ? ''
                    : t('diff.counts', { added: entry.added, removed: entry.removed })}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
