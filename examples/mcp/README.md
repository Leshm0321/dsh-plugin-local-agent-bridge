# MCP elicitation fixture

`elicitation-fixture.mjs` is the smallest MCP server that can make a product raise
an elicitation. It exists because neither Codex nor Claude Code will raise one on
request — the model decides — so the bridge's handling of
`mcpServer/elicitation/request` could not be exercised end to end without a server
that always does.

Newline-delimited JSON-RPC over stdio, no dependencies. Diagnostics go to stderr;
anything on stdout that is not a JSON-RPC message corrupts the stream.

## Two tools, because there are two shapes

| Tool | `requestedSchema` | What the panel should draw |
| --- | --- | --- |
| `ask_operator` | two properties, one with `enum` | a question card: options for the enum, a free-text field for the other |
| `ask_yes_no` | `properties: {}` | an **approval** card — allow, deny, abort |

The second is the one worth keeping. A schema with no properties is how a client
asks a plain yes/no, and Codex sends exactly that to gate every MCP tool call.
Rendered as a form it produced a card with a message, no fields and a lone Submit:
nothing to answer, no way to refuse, and the bridge replied `accept` whatever the
operator did. `tests/integration/mcp-elicitation.spec.ts` pins both shapes.

## Wiring it into Codex

Add to `~/.codex/config.toml`, with an absolute path to your Node and to this file:

```toml
[mcp_servers.bridge_elicit]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/examples/mcp/elicitation-fixture.mjs"]
startup_timeout_sec = 30
```

Then start the profile, open a Codex session, and ask it to call
`ask_yes_no` or `ask_operator` from the `bridge_elicit` server. **Remove the block
afterwards** — it is a validation fixture, not something to leave configured.

Codex gates the call itself first, so the yes/no card appears twice for
`ask_operator`: once for Codex's own tool gate, once for the fixture's own request.
