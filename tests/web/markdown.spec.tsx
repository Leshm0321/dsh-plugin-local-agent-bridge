/** @vitest-environment jsdom */

/**
 * Rendering the markdown agents write.
 *
 * Two properties matter more than coverage of the syntax, and both are asserted
 * first: nothing becomes HTML, and partial input degrades to its own characters
 * rather than failing. Everything else is the syntax the products actually emit.
 */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Markdown } from '../../src/client/markdown.tsx'

/**
 * Render and return the container, for structural assertions.
 * @param text - markdown source.
 * @returns the rendered container element.
 */
function draw(text: string): HTMLElement {
  const { container } = render(<Markdown text={text} />)
  return container
}

describe('markdown', () => {
  it('never produces HTML from the source, whatever the source contains', () => {
    const container = draw('<img src=x onerror="alert(1)"> and <b>bold</b> and <script>alert(2)</script>')

    // Not an element between them: React escaped every one, because this renders
    // elements rather than a string of HTML. An agent's output can be shaped by
    // whatever it just read, so this is the property the file exists to hold.
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">')
    expect(container.textContent).toContain('<script>alert(2)</script>')
  })

  it('leaves half-written markup as the characters that were typed', () => {
    // What the streaming reveal produces constantly: a token cut in half.
    const container = draw('this is **unclosed and `also this')
    expect(container.querySelector('strong')).toBeNull()
    expect(container.querySelector('code')).toBeNull()
    expect(container.textContent).toBe('this is **unclosed and `also this')
  })

  it('renders a fenced block that has not been closed yet', () => {
    // A fence with no terminator is the normal state of a streaming code block.
    const container = draw('here:\n```bash\nls -la\ncat README.md')
    const pre = container.querySelector('pre')
    expect(pre?.textContent).toBe('ls -la\ncat README.md')
  })

  it('renders the syntax the agents actually use', () => {
    const container = draw([
      '## 一、对外 API 接口',
      '',
      'This is **ChatGPT2API v1.7.0** with `inline code` and *emphasis*.',
      '',
      '- first item',
      '- second item',
      '',
      '1. step one',
      '2. step two',
    ].join('\n'))

    expect(container.querySelector('.lab-md-heading--2')?.textContent).toBe('一、对外 API 接口')
    expect(container.querySelector('strong')?.textContent).toBe('ChatGPT2API v1.7.0')
    expect(container.querySelector('code')?.textContent).toBe('inline code')
    expect(container.querySelector('em')?.textContent).toBe('emphasis')
    expect([...container.querySelectorAll('ul li')].map(li => li.textContent))
      .toEqual(['first item', 'second item'])
    expect([...container.querySelectorAll('ol li')].map(li => li.textContent))
      .toEqual(['step one', 'step two'])
  })

  it('renders a table, with its inline markup intact', () => {
    const container = draw([
      '| 接口 | 能力 |',
      '|:--|:--|',
      '| `GET /v1/models` | 动态返回模型列表 |',
      '| `POST /v1/messages` | **Anthropic 协议** |',
    ].join('\n'))

    expect([...container.querySelectorAll('th')].map(th => th.textContent)).toEqual(['接口', '能力'])
    const rows = [...container.querySelectorAll('tbody tr')].map(row =>
      [...row.querySelectorAll('td')].map(cell => cell.textContent))
    expect(rows).toEqual([
      ['GET /v1/models', '动态返回模型列表'],
      ['POST /v1/messages', 'Anthropic 协议'],
    ])
    // Cells keep their markup rather than being flattened to text.
    expect(container.querySelectorAll('td code')).toHaveLength(2)
    expect(container.querySelectorAll('td strong')).toHaveLength(1)
    // And it scrolls itself, so a wide table cannot make the transcript scroll.
    expect(container.querySelector('.lab-md-table-wrap')).not.toBeNull()
  })

  it('treats pipes without a divider as prose, not as a table', () => {
    const container = draw('use a | b to pipe, or | c | for something else')
    expect(container.querySelector('table')).toBeNull()
    expect(container.textContent).toContain('use a | b to pipe')
  })

  it('does not make a link clickable, but does show where it points', () => {
    const container = draw('see [the docs](https://example.com/evil) for details')
    // No anchor: a clickable target composed by a model that just read an untrusted
    // file is an attack surface this view does not need. The URL is still visible,
    // so the operator can copy it.
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('the docs')
    expect(container.textContent).toContain('https://example.com/evil')
  })

  it('suppresses markup inside a code span', () => {
    const container = draw('write `**not bold**` exactly')
    expect(container.querySelector('strong')).toBeNull()
    expect(container.querySelector('code')?.textContent).toBe('**not bold**')
  })

  it('keeps single newlines inside a paragraph as line breaks', () => {
    // An agent listing things on consecutive lines means them to stay that way,
    // whatever CommonMark says about soft wraps.
    const container = draw('first line\nsecond line')
    expect(container.querySelectorAll('br')).toHaveLength(1)
    expect(container.querySelectorAll('p')).toHaveLength(1)
  })

  it('renders nothing for empty input', () => {
    expect(draw('').textContent).toBe('')
    expect(draw('\n\n  \n').textContent).toBe('')
  })
})
