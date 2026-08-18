# DeepSeek Harness Local Agent Bridge

Local Agent Bridge is a self-hosted DeepSeek Harness Host + Client plugin for controlling the Claude Code and Codex installations already present on the Host machine. The browser never logs in to Anthropic or OpenAI and never receives vendor cookies, OAuth tokens, API keys, credential files, or native session identifiers.

The bridge is not an LLM adapter and does not call model HTTP APIs. Codex runs through `codex app-server --stdio`; Claude runs through the official Agent SDK while explicitly launching the `claude` executable resolved from the Host `PATH`.

The confirmed product scope and acceptance contract are recorded in [the development task brief](docs/plans/2026-08-18-local-agent-bridge-development-task.md).

## Supported baseline

| Component | Supported baseline |
| --- | --- |
| DeepSeek Harness | `0.1.0-rc.7`, upstream commit `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca` |
| Node.js | `^22.19.0` or `>=24.0.0` |
| pnpm | `11.7.0` |
| Codex CLI | `0.147.x` |
| Claude Code CLI | `>=2.1.220 <2.2.0` |
| Claude Agent SDK | `0.3.220` |
| Primary Host | Windows 10/11 x64 |

Unknown or unsupported product versions are blocked by default. `allowExperimentalVersions: true` is a local operator override, not a compatibility guarantee.

## Security boundary

The trusted Host owns vendor authentication, source code access, native tools, MCP servers, and process execution. The browser receives only redacted bridge events and sends ordinary prompts, one-time approvals, question answers, cancellation requests, and opaque bridge IDs.

The plugin never reads or copies `.claude`, `.codex`, `auth.json`, OS credential stores, or vendor tokens. Authentication failures become a safe `HOST_AUTH_REQUIRED` message and must be repaired in a terminal on the Host.

DeepSeek Harness must continue listening on `127.0.0.1`. Remote access requires a separate private network or authenticated reverse proxy providing TLS, user or device authentication, WebSocket support, correct Host/Origin handling, idle expiry, and access logs. `trustedHosts` is not authentication. Do not expose the Harness port directly to the public Internet.

See [Security](docs/security.md) for the deployment contract and threat boundary.

## Build on Windows

Prerequisites:

- DeepSeek Harness CLI `0.1.0-rc.7`.
- Node.js and pnpm versions shown above.
- `codex` and/or `claude` installed on the Host `PATH` and already logged in on that Host.

From PowerShell in this directory:

```powershell
pnpm install --frozen-lockfile
.\node_modules\.bin\tsc.CMD -p tsconfig.host.json --noEmit
.\node_modules\.bin\tsc.CMD -p tsconfig.client.json --noEmit
.\node_modules\.bin\tsdown.CMD --config tsdown.host.config.ts
.\node_modules\.bin\tsc.CMD -p tsconfig.host.declarations.json
.\node_modules\.bin\tsc.CMD -p tsconfig.client.declarations.json
.\node_modules\.bin\tsdown.CMD --config tsdown.client.config.ts
.\node_modules\.bin\vitest.CMD run
```

## Install into a remote-capable Web Profile

Build the checkout first, then install it as a local bundle. The package is intentionally private and is not published to npm.

```powershell
dsh plugin --profile web add "D:\Development\Workspace\dsh-plugin-local-agent-bridge"
dsh --profile web --dump-config
dsh --profile web
```

Open the loopback URL printed by DSH, normally `http://127.0.0.1:3080`, or reach that loopback service through the approved private network/authenticated gateway. The sidebar contains a `Local Agents` entry.

The built-in `web` Profile is required because it supplies the DSH Web App, API proxy, frontend assets, and Client runtime. A newly created custom Profile contains only the base bundle unless the operator explicitly adds `@deepseek-ai/dsh-web-app`; installing this plugin into such a base-only Profile does not create a browser UI.

Before remote use, merge [remote-web.patch.yml](examples/profile/remote-web.patch.yml) into the built-in `web` Profile's `cordis.patch.yml` (normally `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`). The shipped automatic directory picker opens the native Windows folder dialog on the Host when DSH is loopback-bound; a browser at home cannot operate that dialog. The example replaces it with DSH's in-browser directory picker while leaving the selected path and all filesystem access on the Host. Restart the Profile and confirm `dsh --profile web --dump-config` contains `directory-picker-browse` and `ui-directory-picker-browse` without a loader name-mismatch warning.

The bundle installs [cordis.patch.yml](cordis.patch.yml). To override its complete config block, use [the enabled example](examples/profile/local-agent-bridge.enabled.patch.yml) in the Profile `cordis.patch.yml`.

## Disable, enable, and uninstall

To disable without removing the linked package, add the row from [local-agent-bridge.disabled.patch.yml](examples/profile/local-agent-bridge.disabled.patch.yml) to the Profile's own `cordis.patch.yml`, then restart or let HMR reload the Profile. Remove `disabled: true` to enable it again.

To uninstall the dependency and bundle layer, first remove the `local-agent-bridge` override row from the Profile's own `cordis.patch.yml`. Then run:

```powershell
dsh plugin --profile web remove dsh-plugin-local-agent-bridge
```

Plugin unload disposes active sessions, closes protocol transports, and waits for managed process trees to exit.

## Runtime behavior

- Codex uses one managed App Server process for multiple mapped threads, with `thread/start`, `thread/resume`, `turn/start`, `turn/steer`, and `turn/interrupt`.
- Claude uses `query()`, `includePartialMessages: true`, `resume`, `canUseTool`, `AskUserQuestion`, and SDK elicitation callbacks.
- Codex messages steer an active compatible turn. Claude messages queue until its active turn ends.
- Approvals are one-time only. No browser decision is written into Claude or Codex permission configuration.
- Browser reconnect uses an event sequence and bounded replay window. Host restart resumes only when a native locator was already captured; otherwise the bridge marks the session orphaned.
- Archiving hides the bridge session and does not delete vendor-native history.

## Configuration

| Key | Default | Meaning |
| --- | ---: | --- |
| `allowExperimentalVersions` | `false` | Permit installed versions classified as `unknown`. |
| `enableFakeProvider` | `false` | Expose the local verification provider. Never enable for normal use. |
| `eventRetention` | `2000` | Maximum retained bridge events per session. |
| `longPollMaxMs` | `25000` | Maximum Client long-poll duration. |
| `processGraceMs` | `3000` | Managed process cleanup grace period. |

## Upgrade procedure

1. Keep the current working build available for rollback.
2. Upgrade DeepSeek Harness, Codex, Claude Code, or the Claude Agent SDK one component at a time.
3. For Codex, regenerate TypeScript and JSON Schema with the target `codex app-server generate-* --experimental` commands and review the diff.
4. For Claude, rerun session, resume, partial streaming, approval, question, cancellation, and Windows spawn tests.
5. Run build, both typechecks, lint, all tests, Profile loader smoke, browser E2E, and redacted real-product smoke before enabling the new version.
6. Leave `allowExperimentalVersions` disabled unless the local operator accepts the unverified protocol risk.

See [Compatibility and upgrades](docs/compatibility.md) and [Codex schema provenance](docs/codex-schema.md).

## Validation and limitations

Automated fixtures do not require personal vendor credentials. Real-product validation must run only on a trusted Host that is already logged in, and reports must omit account data, private source, full prompts, and tokens.

Linux and macOS Hosts are not yet claimed as validated. The MVP is single-user/self-hosted and provides no multi-tenant isolation or RBAC. Attachments, image input, session fork, PTY mode, and automatic vendor login are out of scope.

See [Validation](docs/validation.md) and [Operations](docs/operations.md).

## Licensing and terms

This project is MIT licensed. Codex App Server schemas were generated from Codex `0.147.0`; Codex is distributed under Apache-2.0. The Claude Agent SDK package declares `SEE LICENSE IN README.md`, and Anthropic documents Agent SDK use under its Commercial Terms. This project does not distribute Claude Code or Codex binaries and does not grant rights to vendor services.

Anthropic's Agent SDK documentation says third-party products should use supported API-key authentication unless separately approved to offer `claude.ai` login or rate-limit functionality. This bridge provides no Claude login surface, but its reuse of an already authenticated Host Claude Code installation is not an official authorization statement. Treat the Claude provider as a private, single-user experimental integration and re-review the authentication and distribution terms before any public, commercial, hosted, or multi-user deployment. The project reduces additional browser login surfaces; it cannot guarantee account enforcement outcomes.

Review [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before public, commercial, or multi-user distribution.
