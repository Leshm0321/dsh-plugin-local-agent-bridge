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
import { IconCodeOutline16, IconFolderClose16, IconFolderOpen16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { useEffect, useMemo, useState } from 'react'
import { Code } from './code.tsx'
import type { LocalAgentRemote } from './index.tsx'
import type { BridgeWorkspaceEntry, BridgeWorkspaceFile } from '../types.ts'

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
  t,
}: {
  remote: LocalAgentRemote
  bridgeSessionId: string
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
          </div>
        )}
        <div className="lab-files-content">
          {error !== undefined && <p className="lab-browse-note">{t('files.error')}</p>}
          {loading && <p className="lab-browse-note">{t('browse.loading')}</p>}
          {!loading && error === undefined && file === undefined && (
            <div className="lab-files-empty">
              <IconCodeOutline16 />
              <p className="lab-files-empty-title">{t('files.pick')}</p>
              <p className="lab-browse-note">{t('files.pickHint')}</p>
            </div>
          )}
          {!loading && file?.binary === true && <p className="lab-browse-note">{t('files.binary')}</p>}
          {!loading && file !== undefined && !file.binary && (
            <>
              <Code text={file.content} path={file.path} />
              {file.truncated && <p className="lab-browse-note">{t('files.cut')}</p>}
            </>
          )}
        </div>
      </div>

      <div className="lab-files-tree">
        <input
          type="search"
          className="lab-input lab-files-filter"
          value={filter}
          placeholder={t('files.filter')}
          onChange={event => { setFilter(event.target.value) }}
        />
        <div className="lab-files-rows">
          {rows.length === 0 && <p className="lab-browse-note">{t('files.treeEmpty')}</p>}
          {rows.map(({ entry, depth }) => (
            <button
              key={entry.path}
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
