# Operations

## Startup

1. Verify `codex --version` and `claude --version` in the same Windows account that starts DSH.
2. Confirm each product already works from a local terminal without a new login flow.
3. For remote operation, merge [`remote-web.patch.yml`](../examples/profile/remote-web.patch.yml) into the built-in `web` Profile so workspace selection uses DSH's in-browser picker instead of a native dialog on the Host desktop.
4. Run `dsh --profile web --dump-config` and confirm both browse-picker rows load without a name-mismatch warning.
5. Start the `web` Profile while DSH remains loopback-bound.
6. Verify the authenticated access layer before using a remote browser.
7. Open `Local Agents` and confirm provider and workspace readiness.

Loading the plugin performs version discovery only. It does not start a long-lived vendor agent process until a turn needs one.

## Health states

| State | Operator action |
| --- | --- |
| `not-installed` | Install the product on the Host `PATH`. |
| `unsupported` | Install a supported version or validate and explicitly enable experimental compatibility. |
| `ready` | The provider can create bridge sessions. |
| `auth-required` | Reauthenticate in a terminal on the Host, then refresh the catalog. |
| `error` | Inspect redacted Host diagnostics and verify executable/version output. |
| `orphaned` | Create a new bridge session; the original native locator was unavailable or cannot resume. |

## Session recovery

Browser refresh and short network interruption do not cancel the Host turn. The Client resumes from its last event sequence. If the bounded replay window has moved forward, the Host returns the retained snapshot with `reset: true`.

After Host restart, sessions with a captured native locator return to `idle` and resume on the next message. Sessions without a locator become `orphaned`. Any interaction that was pending across restart becomes `expired`; it is never approved automatically.

## Shutdown and cleanup

Disable or uninstall the plugin only after saving any important external work. Before uninstalling, remove the `local-agent-bridge` override row from the Profile's own `cordis.patch.yml`, then run the `dsh plugin --profile <name> remove dsh-plugin-local-agent-bridge` command. Unload aborts active turns, closes SDK/App Server transports, closes stdin, terminates the dsh-subprocess process tree, waits for exit, and closes bridge persistence.

After shutdown, verify no unexpected `codex app-server` or SDK-owned `claude` child remains. A separately opened user terminal running Claude or Codex is outside this plugin's ownership and must not be terminated by the bridge.

## Troubleshooting

### Provider is installed but not ready

- Run the product's `--version` command locally.
- Compare the result with [compatibility.md](compatibility.md).
- Keep `allowExperimentalVersions` disabled unless protocol testing has passed.

### Browser shows authentication required

- Do not look for a login button in the browser; none exists by design.
- On the Host, use the product's normal local login command.
- Return to DSH and use Refresh.

### Workspace selection opens on the Host desktop

- The built-in Web Profile selected the automatic/native directory picker because DSH is loopback-bound.
- Apply [`remote-web.patch.yml`](../examples/profile/remote-web.patch.yml), restart the Profile, and verify the composed config contains `directory-picker-browse` and `ui-directory-picker-browse`.
- Do not change the existing `directory-picker` row's `name`; Cordis treats that value as an assertion and skips a mismatched patch. Disable the row, then insert the browse pair under distinct IDs as shown in the example.

### Session is orphaned

- The Host never captured a resumable native locator, or the native product rejected it.
- Archive the bridge session and create a new one. Do not copy native IDs through the browser.

### Reconnect loops

- Confirm WebSocket and long-lived HTTP forwarding at the access layer.
- Check TLS, Origin, Host, idle timeout, and proxy buffering.
- Verify DSH is still reachable through loopback from the gateway process.

### Cleanup fails

- Stop DSH and inspect the process tree on the Host.
- Capture only process names, PIDs, and exit state; do not capture command lines containing private prompts.
- Treat a repeatable managed-child leak as a release blocker.
