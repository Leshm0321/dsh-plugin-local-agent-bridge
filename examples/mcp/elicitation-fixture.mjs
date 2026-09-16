#!/usr/bin/env node
/**
 * The smallest MCP server that can raise an elicitation.
 *
 * Exists to trigger one thing the real products would not raise on request:
 * `elicitation/create`, which Codex forwards to the bridge as
 * `mcpServer/elicitation/request`. Newline-delimited JSON-RPC over stdio, no
 * dependencies — the point is to be obviously correct, not reusable.
 *
 * Diagnostics go to stderr. Anything on stdout that is not a JSON-RPC message
 * corrupts the stream.
 */
const PROTOCOL_VERSION = '2025-06-18'

const log = (...parts) => { process.stderr.write(`[mcp-elicit] ${parts.join(' ')}\n`) }
const send = (message) => { process.stdout.write(`${JSON.stringify(message)}\n`) }

/** Outstanding server→client requests, by id. */
const pending = new Map()
let nextId = 1

/** Ask the client to collect input, and resolve with whatever it answers. */
function elicit(message, requestedSchema) {
  const id = `elicit-${nextId++}`
  return new Promise((resolve) => {
    pending.set(id, resolve)
    send({ jsonrpc: '2.0', id, method: 'elicitation/create', params: { message, requestedSchema } })
    log('sent elicitation/create', id)
  })
}

const TOOLS = [
  {
    name: 'ask_operator',
    description: 'Ask the operator to choose a colour and name a reason, through the client UI.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'ask_yes_no',
    description: 'Ask the operator to approve something, with no fields to fill in.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
]

/**
 * Two properties on purpose: one with `enum` so the bridge renders options, one
 * without so it renders a free-text field. Both branches of its mapping in one
 * request.
 */
const FORM_SCHEMA = {
  type: 'object',
  properties: {
    colour: {
      type: 'string',
      title: 'Colour',
      description: 'Pick one.',
      enum: ['red', 'blue'],
    },
    reason: {
      type: 'string',
      title: 'Reason',
      description: 'Say why, in your own words.',
    },
  },
  required: ['colour'],
}

/**
 * The shape that used to be unanswerable: an object with no properties, which is
 * how a client asks a plain yes/no. Codex sends exactly this to gate every MCP
 * tool call, and a bridge that renders it as a form draws a card with no fields.
 */
const YES_NO_SCHEMA = { type: 'object', properties: {} }

async function onRequest(id, method, params) {
  if (method === 'initialize') {
    const client = params?.capabilities ?? {}
    log('client capabilities:', JSON.stringify(client))
    log('client declares elicitation:', Object.prototype.hasOwnProperty.call(client, 'elicitation'))
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'mcp-elicit', version: '0.0.1' },
      },
    })
    return
  }
  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
    return
  }
  if (method === 'tools/call') {
    const tool = TOOLS.find(candidate => candidate.name === params?.name)
    if (tool === undefined) {
      send({ jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool ${params?.name}` } })
      return
    }
    const answer = tool.name === 'ask_yes_no'
      ? await elicit('The bridge fixture wants a plain yes or no.', YES_NO_SCHEMA)
      : await elicit('The bridge fixture needs two answers before it can continue.', FORM_SCHEMA)
    log('elicitation answered:', JSON.stringify(answer))
    send({
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: `operator answered: ${JSON.stringify(answer)}` }] },
    })
    return
  }
  // Anything else is answered rather than ignored, so a strict client does not stall.
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } })
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
    // A response to something this server asked.
    if (message.id !== undefined && message.method === undefined) {
      const resolve = pending.get(message.id)
      if (resolve === undefined) { log('response for unknown id', message.id); continue }
      pending.delete(message.id)
      resolve(message.result ?? { action: 'decline', error: message.error })
      continue
    }
    if (message.method === undefined) continue
    if (message.id === undefined) { log('notification:', message.method); continue }
    void onRequest(message.id, message.method, message.params).catch((cause) => {
      log('handler failed:', String(cause))
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: String(cause) } })
    })
  }
})
process.stdin.on('end', () => { log('stdin closed'); process.exit(0) })
log('ready')
