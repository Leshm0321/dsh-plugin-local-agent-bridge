/**
 * Showing a source file with line numbers and syntax colour.
 *
 * Highlighting comes from lowlight rather than highlight.js directly, and that is
 * the whole reason it is here: highlight.js returns a string of HTML, which would
 * mean `dangerouslySetInnerHTML`. lowlight returns the same analysis as a tree, so
 * this renders React elements and the panel keeps the property the markdown renderer
 * established — nothing in it can become markup.
 *
 * The language comes from the file extension, checked against what is actually
 * registered. An unknown extension renders as plain text rather than being guessed
 * at, because mis-highlighting a file is worse than not highlighting it: the colours
 * assert a structure that is not there.
 */
import { common, createLowlight } from 'lowlight'
import type { ReactNode } from 'react'

const lowlight = createLowlight(common)

/**
 * File extension to highlight.js language.
 *
 * Written out rather than inferred, so what is supported is readable, and every
 * value is checked against the registry below — a typo here degrades to plain text
 * rather than throwing while rendering a file.
 */
const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', pyi: 'python',
  json: 'json', jsonc: 'json',
  yml: 'yaml', yaml: 'yaml',
  // highlight.js reads TOML with its INI grammar, which is close enough to be
  // right about keys, strings and numbers.
  toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini', properties: 'ini',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
  go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin',
  rb: 'ruby', php: 'php', swift: 'swift', lua: 'lua', pl: 'perl', r: 'r',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  cs: 'csharp', vb: 'vbnet', m: 'objectivec', mm: 'objectivec',
  css: 'css', scss: 'scss', sass: 'scss', less: 'less',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  sql: 'sql', graphql: 'graphql', gql: 'graphql',
  diff: 'diff', patch: 'diff', wat: 'wasm',
}

/** Files whose whole name, not extension, decides the grammar. */
const LANGUAGE_BY_NAME: Readonly<Record<string, string>> = {
  dockerfile: 'bash',
  makefile: 'makefile',
  '.gitignore': 'plaintext',
  '.env': 'ini',
}

/**
 * Which grammar to use for a path, if any.
 * @param path - the file's path or name.
 * @returns a registered language name, or null for plain text.
 */
export function languageFor(path: string): string | null {
  const name = (path.split('/').at(-1) ?? '').toLowerCase()
  const byName = LANGUAGE_BY_NAME[name]
  if (byName !== undefined) return lowlight.registered(byName) ? byName : null
  const dot = name.lastIndexOf('.')
  if (dot < 0) return null
  const candidate = LANGUAGE_BY_EXTENSION[name.slice(dot + 1)]
  // Checked against the registry rather than trusted: a typo in the table above
  // should show a file uncoloured, not throw while rendering it.
  return candidate !== undefined && lowlight.registered(candidate) ? candidate : null
}

/** A hast node, as much of it as this renders. */
interface HastNode {
  readonly type: string
  readonly value?: string
  readonly tagName?: string
  readonly properties?: { readonly className?: readonly string[] | string }
  readonly children?: readonly HastNode[]
}

/**
 * Turn lowlight's tree into React elements.
 *
 * Text nodes become strings, which React escapes; element nodes become spans
 * carrying highlight.js's own class names. Nothing else is possible from this
 * function's output, which is the point of using the tree form.
 * @param node - one hast node.
 * @param key - unique among siblings.
 * @returns the rendered child.
 */
function render(node: HastNode, key: string): ReactNode {
  if (node.type === 'text') return node.value ?? ''
  if (node.type !== 'element') return null
  const raw = node.properties?.className
  const className = Array.isArray(raw) ? raw.join(' ') : typeof raw === 'string' ? raw : undefined
  return (
    <span key={key} className={className}>
      {(node.children ?? []).map((child, index) => render(child, `${key}-${String(index)}`))}
    </span>
  )
}

/**
 * A file's text, numbered and coloured.
 *
 * Line numbers are a separate column rather than woven into the highlighted output:
 * a highlighted region can span lines — a block comment, a template literal — and
 * splitting the tree to interleave numbers would break exactly those constructs. Two
 * columns with one line-height keep them aligned without touching the analysis.
 * @param text - the file's contents.
 * @param path - used to choose the grammar.
 */
export function Code({ text, path }: { text: string; path: string }): ReactNode {
  const language = languageFor(path)
  const lines = text.split('\n')
  let body: ReactNode
  if (language === null) {
    body = text
  } else {
    try {
      const tree = lowlight.highlight(language, text) as unknown as HastNode
      body = (tree.children ?? []).map((child, index) => render(child, `h${String(index)}`))
    } catch {
      // A grammar that throws on some input is highlight.js's problem, not a reason
      // to fail to show the file.
      body = text
    }
  }
  return (
    <div className="lab-code">
      <div className="lab-code-gutter" aria-hidden="true">
        {lines.map((_line, index) => (
          <span key={`n${String(index)}`} className="lab-code-line">{index + 1}</span>
        ))}
      </div>
      <pre className="lab-code-body"><code>{body}</code></pre>
    </div>
  )
}
