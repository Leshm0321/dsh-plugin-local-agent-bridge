#!/usr/bin/env node
/**
 * A stand-in for `codex app-server`, so the panel can be driven through the real
 * Codex adapter without the real product.
 *
 * It exists for one prompt. `item/tool/requestUserInput` is Codex's own built-in
 * tool — an MCP server cannot raise it, and the model will not invoke it on
 * request — so it is the one interaction the bridge handles that could not be seen
 * in a browser. This speaks enough of the App Server protocol for the adapter to
 * start a thread, run a turn, and raise that request mid-turn.
 *
 * Put it on PATH as `codex`, ahead of the real one, and the bridge will spawn it.
 * `--version` answers inside the admitted range so version admission passes.
 *
 * Newline-delimited JSON-RPC over stdio. Diagnostics go to stderr; anything on
 * stdout that is not a JSON-RPC message corrupts the stream.
 */
const VERSION = '0.153.4'

// `codex --version` is how the bridge decides whether to admit the product at all.
if (process.argv.includes('--version')) {
  process.stdout.write(`codex-cli ${VERSION}\n`)
  process.exit(0)
}

const log = (...parts) => { process.stderr.write(`[codex-fixture] ${parts.join(' ')}\n`) }
const send = (message) => { process.stdout.write(`${JSON.stringify(message)}\n`) }

const pending = new Map()
let nextId = 1
let threads = 0
let turns = 0

/** Ask the bridge something and resolve with its answer. */
function ask(method, params) {
  const id = `fixture-${nextId++}`
  return new Promise((resolve) => {
    pending.set(id, resolve)
    send({ jsonrpc: '2.0', id, method, params })
    log('asked', method, id)
  })
}

/**
 * The questions Codex's own `request_user_input` sends: an id, a header, the
 * question, whether free text is allowed, whether it is secret, and options.
 */
const QUESTIONS = [
  {
    id: 'mode',
    header: 'Mode',
    question: 'Which mode should the fixture run in?',
    isOther: false,
    isSecret: false,
    options: [
      { label: 'Fast', description: 'Short verification' },
      { label: 'Thorough', description: 'Every branch' },
    ],
  },
  {
    id: 'note',
    header: 'Note',
    question: 'Anything to record with this run?',
    isOther: true,
    isSecret: false,
    options: null,
  },
]

async function runTurn(threadId, turnId, text) {
  send({ jsonrpc: '2.0', method: 'turn/started', params: { threadId, turn: { id: turnId, status: 'inProgress', items: [], error: null } } })

  if (/userinput|ask me|question/i.test(text)) {
    const answer = await ask('item/tool/requestUserInput', {
      threadId,
      turnId,
      itemId: 'user-input-1',
      isBlocking: true,
      questions: QUESTIONS,
    })
    log('answered:', JSON.stringify(answer))
    send({
      jsonrpc: '2.0',
      method: 'item/agentMessage/delta',
      params: { threadId, turnId, itemId: 'message-1', delta: `operator answered: ${JSON.stringify(answer)}` },
    })
  } else {
    send({
      jsonrpc: '2.0',
      method: 'item/agentMessage/delta',
      params: { threadId, turnId, itemId: 'message-1', delta: 'Ask me a question to see the user-input prompt.' },
    })
  }

  send({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed', items: [], error: null } } })
}

function onRequest(id, method, params) {
  switch (method) {
    case 'initialize':
      send({ jsonrpc: '2.0', id, result: { userAgent: `codex-app-server-fixture/${VERSION}` } })
      return
    case 'thread/start': {
      const threadId = `fixture-thread-${++threads}`
      send({ jsonrpc: '2.0', id, result: { thread: { id: threadId } } })
      return
    }
    case 'thread/resume':
      send({ jsonrpc: '2.0', id, result: { thread: { id: String(params?.threadId) } } })
      return
    case 'turn/start': {
      const turnId = `fixture-turn-${++turns}`
      const threadId = String(params?.threadId)
      const text = (params?.input ?? []).find(part => typeof part?.text === 'string')?.text ?? ''
      send({ jsonrpc: '2.0', id, result: { turn: { id: turnId, status: 'inProgress', items: [], error: null } } })
      setTimeout(() => { void runTurn(threadId, turnId, text) }, 0)
      return
    }
    // Answered empty rather than refused: the adapter asks for these when a session
    // opens, and an error would surface as a broken session instead of a bare one.
    case 'skills/list':
      send({ jsonrpc: '2.0', id, result: { skills: [] } })
      return
    case 'mcpServerStatus/list':
      send({ jsonrpc: '2.0', id, result: { servers: [] } })
      return
    case 'turn/steer':
      send({ jsonrpc: '2.0', id, result: { turnId: `fixture-turn-${turns}` } })
      return
    case 'turn/interrupt':
      send({ jsonrpc: '2.0', id, result: {} })
      return
    default:
      log('unhandled request:', method)
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } })
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  for (let cut = buffer.indexOf('\n'); cut !== -1; cut = buffer.indexOf('\n')) {
    const line = buffer.slice(0, cut).trim()
    buffer = buffer.slice(cut + 1)
    if (line === '') continue
    let message
    try { message = JSON.parse(line) } catch { log('unparsable line:', line.slice(0, 200)); continue }
    if (message.id !== undefined && message.method === undefined) {
      const resolve = pending.get(message.id)
      if (resolve === undefined) { log('response for unknown id', message.id); continue }
      pending.delete(message.id)
      resolve(message.result ?? { error: message.error })
      continue
    }
    if (message.method === undefined) continue
    if (message.id === undefined) { log('notification:', message.method); continue }
    onRequest(message.id, message.method, message.params)
  }
})
process.stdin.on('end', () => { log('stdin closed'); process.exit(0) })
log('ready')
