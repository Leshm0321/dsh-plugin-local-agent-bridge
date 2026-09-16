# Validation fixtures

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

---

# Codex App Server fixture

`codex-app-server-fixture.mjs` stands in for `codex app-server`, so the panel can
be driven through the real Codex adapter without the real product.

It exists for one prompt. `item/tool/requestUserInput` is Codex's own built-in tool
— an MCP server cannot raise it, and the model will not invoke it on request — so it
was the one interaction the bridge handles that could not be seen in a browser.

`--version` answers inside the admitted range, so version admission passes and the
product appears selectable as an ordinary `Codex 0.153.4`.

## Using it

Put it on `PATH` as `codex`, ahead of the real one, and start the profile from that
shell:

```sh
mkdir -p /tmp/fakebin
printf '#!/bin/sh\nexec node %s/examples/mcp/codex-app-server-fixture.mjs "$@"\n' "$PWD" > /tmp/fakebin/codex
chmod +x /tmp/fakebin/codex
PATH="/tmp/fakebin:$PATH" npx @deepseek-ai/dsh web
```

Then create a Codex session and send a prompt containing `userinput` — anything else
gets a plain reply. The panel should show two questions, one with options and one
free-text, and **no refusal**: `request_user_input` is the one prompt whose response
schema has no field for a declining operator, so the bridge reports
`refusable: false` and the button is withheld.

Remember to start the profile from a shell where the shim is on `PATH`, and to use
an ordinary shell for real work — every Codex session in that profile talks to the
fixture, not to Codex.
