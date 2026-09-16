import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The fixture MCP server, driven the way a product drives it.
 *
 * Two things are pinned here. That the fixture still speaks the protocol — it is
 * shipped for operators to wire into Codex, so a silent break in it would be found
 * by hand or not at all. And that it raises both elicitation shapes, because the
 * one with no fields is the case the bridge used to render unanswerable.
 */
const FIXTURE = join(process.cwd(), 'examples/mcp/elicitation-fixture.mjs')

interface Message {
  readonly id?: string | number
  readonly method?: string
  readonly result?: Record<string, unknown>
  readonly params?: Record<string, unknown>
}

/**
 * Run one tool call against the fixture, answering its elicitation.
 * @param tool - which tool to call.
 * @param answer - what to reply to the elicitation the call raises.
 * @returns the schema the fixture asked with, and the tool's own result text.
 */
async function callTool(
  tool: string,
  answer: Record<string, unknown>,
): Promise<{ requestedSchema: Record<string, unknown>; message: string; text: string }> {
  const child = spawn(process.execPath, [FIXTURE], { stdio: ['pipe', 'pipe', 'ignore'] })
  const send = (message: unknown): void => { child.stdin.write(`${JSON.stringify(message)}\n`) }
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('fixture did not answer in time')) }, 15_000)
    let captured: { requestedSchema: Record<string, unknown>; message: string } | undefined
    let buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      for (let cut = buffer.indexOf('\n'); cut !== -1; cut = buffer.indexOf('\n')) {
        const line = buffer.slice(0, cut).trim()
        buffer = buffer.slice(cut + 1)
        if (line === '') continue
        const message = JSON.parse(line) as Message
        if (message.id === 1) send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: {} } })
        else if (message.method === 'elicitation/create') {
          captured = {
            requestedSchema: message.params?.requestedSchema as Record<string, unknown>,
            message: message.params?.message as string,
          }
          send({ jsonrpc: '2.0', id: message.id, result: answer })
        } else if (message.id === 2) {
          clearTimeout(timer)
          child.kill()
          const content = (message.result?.content ?? []) as { text: string }[]
          if (captured === undefined) { reject(new Error('no elicitation was raised')); return }
          resolve({ ...captured, text: content[0]?.text ?? '' })
        }
      }
    })
    child.on('error', reject)
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: { elicitation: {} },
        clientInfo: { name: 'bridge-fixture-test', version: '0' },
      },
    })
  })
}

describe('MCP elicitation fixture', () => {
  it('raises a form whose schema drives options and free text', async () => {
    const { requestedSchema, text } = await callTool('ask_operator', {
      action: 'accept',
      content: { colour: 'blue', reason: 'because' },
    })
    const properties = requestedSchema.properties as Record<string, Record<string, unknown>>
    // The enum is what makes the bridge draw options rather than a text field, and
    // the property without one is what makes it draw the text field.
    expect(properties.colour?.enum).toEqual(['red', 'blue'])
    expect(properties.reason?.enum).toBeUndefined()
    expect(text).toContain('blue')
  })

  it('raises a yes/no as an object with no properties', async () => {
    const { requestedSchema, text } = await callTool('ask_yes_no', { action: 'accept' })
    // This is the shape Codex sends to gate every MCP tool call, and the shape the
    // bridge used to render as a form with nothing in it.
    expect(requestedSchema).toEqual({ type: 'object', properties: {} })
    expect(text).toContain('accept')
  })

  it('carries a refusal back to the server rather than an empty answer', async () => {
    const { text } = await callTool('ask_yes_no', { action: 'decline' })
    // A server that asked is entitled to know it was refused; `accept` with nothing
    // filled in would read as an answer.
    expect(text).toContain('decline')
    expect(text).not.toContain('accept')
  })
})

/**
 * The App Server fixture, checked against the schemas the adapter validates with.
 *
 * It is shipped for operators to put on PATH as `codex`, and it already shipped one
 * payload the bridge refused — a `Turn` without `items` — which surfaced only as a
 * failed session in a browser. Validating it here is how that is caught instead.
 */
describe('Codex App Server fixture', () => {
  const APP_SERVER = join(process.cwd(), 'examples/mcp/codex-app-server-fixture.mjs')

  it('reports a version the bridge admits', async () => {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const { stdout } = await promisify(execFile)(process.execPath, [APP_SERVER, '--version'])
    expect(stdout.trim()).toMatch(/^codex-cli \d+\.\d+\.\d+$/)
  })

  it('raises request-user-input and takes the answer shape the schema requires', async () => {
    const child = spawn(process.execPath, [APP_SERVER], { stdio: ['pipe', 'pipe', 'ignore'] })
    const send = (message: unknown): void => { child.stdin.write(`${JSON.stringify(message)}\n`) }
    const seen: { method: string; params: Record<string, unknown> }[] = []

    const outcome = await new Promise<{ questions: unknown[]; reply: string }>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('fixture did not finish in time')) }, 15_000)
      let questions: unknown[] = []
      let reply = ''
      let buffer = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk
        for (let cut = buffer.indexOf('\n'); cut !== -1; cut = buffer.indexOf('\n')) {
          const line = buffer.slice(0, cut).trim()
          buffer = buffer.slice(cut + 1)
          if (line === '') continue
          const message = JSON.parse(line) as Message & { params?: Record<string, unknown> }
          if (message.method !== undefined) seen.push({ method: message.method, params: message.params ?? {} })
          if (message.id === 1) send({ jsonrpc: '2.0', id: 2, method: 'thread/start', params: {} })
          else if (message.id === 2) {
            const thread = (message.result?.thread ?? {}) as { id: string }
            send({
              jsonrpc: '2.0',
              id: 3,
              method: 'turn/start',
              params: { threadId: thread.id, input: [{ type: 'text', text: 'userinput please' }] },
            })
          } else if (message.method === 'item/tool/requestUserInput') {
            questions = message.params?.questions as unknown[]
            // Exactly what `ToolRequestUserInputResponse` requires: ids to answers.
            send({ jsonrpc: '2.0', id: message.id, result: { answers: { mode: { answers: ['Fast'] }, note: { answers: ['fixture'] } } } })
          } else if (message.method === 'item/agentMessage/delta') {
            reply += String(message.params?.delta ?? '')
          } else if (message.method === 'turn/completed') {
            clearTimeout(timer)
            child.kill()
            resolve({ questions, reply })
          }
        }
      })
      child.on('error', reject)
      send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    })

    // Two questions: one with options, one free-text, so both render paths are driven.
    expect(outcome.questions).toHaveLength(2)
    expect(outcome.reply).toContain('Fast')

    // Every Turn the bridge validates carries `items`; a fixture missing it fails a
    // real session with a protocol error and nothing else to go on.
    for (const { method, params } of seen.filter(entry => entry.method.startsWith('turn/'))) {
      const turn = params.turn as Record<string, unknown> | undefined
      expect(turn, method).toBeDefined()
      expect(Object.keys(turn ?? {}), method).toContain('items')
    }
  })
})
