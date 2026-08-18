# DeepSeek Harness Local Agent Bridge

Local Agent Bridge is a self-hosted DeepSeek Harness Host + Client plugin for controlling the Claude Code and Codex installations already present on the Host machine. The browser never logs in to Anthropic or OpenAI and never receives vendor cookies, OAuth tokens, API keys, credential files, or native session identifiers.

The bridge is not an LLM adapter and does not call model HTTP APIs. Codex runs through `codex app-server --stdio`; Claude runs through the official Agent SDK while explicitly launching the `claude` executable resolved from the Host `PATH`.

The confirmed product scope and acceptance contract are recorded in [the development task brief](docs/plans/2026-08-18-local-agent-bridge-development-task.md).

The browser UI ships in Chinese and English, following the DeepSeek Harness
language preference.

## Supported baseline

| Component | Supported baseline |
| --- | --- |
| DeepSeek Harness | `0.1.0-rc.7`, upstream commit `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca` |
| Node.js | `^22.19.0` or `>=24.0.0` |
| pnpm | `11.7.0` |
| Codex CLI | `0.147.x` |
| Claude Code CLI | `>=2.1.220 <2.2.0` |
| Claude Agent SDK | `0.3.220` |
| Host platforms | Windows 10/11 x64, macOS 13+ (Intel/Apple silicon), Linux x64/arm64 |

Unknown or unsupported product versions are blocked by default. `allowExperimentalVersions: true` is a local operator override, not a compatibility guarantee.

## Security boundary

The trusted Host owns vendor authentication, source code access, native tools, MCP servers, and process execution. The browser receives only redacted bridge events and sends ordinary prompts, one-time approvals, question answers, cancellation requests, and opaque bridge IDs.

The plugin never reads or copies `.claude`, `.codex`, `auth.json`, OS credential stores, or vendor tokens. Authentication failures become a safe `HOST_AUTH_REQUIRED` message and must be repaired in a terminal on the Host.

DeepSeek Harness must continue listening on `127.0.0.1`. Remote access requires a separate private network or authenticated reverse proxy providing TLS, user or device authentication, WebSocket support, correct Host/Origin handling, idle expiry, and access logs. `trustedHosts` is not authentication. Do not expose the Harness port directly to the public Internet.

See [Security](docs/security.md) for the deployment contract and threat boundary.

## Build

Prerequisites:

- DeepSeek Harness CLI `0.1.0-rc.7`.
- Node.js and pnpm versions shown above.
- `codex` and/or `claude` installed on the Host `PATH` and already logged in on that Host.

The same commands run on Windows (PowerShell or `cmd`), macOS, and Linux:

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm run typecheck
pnpm run lint
pnpm test
```

`pnpm run check` runs all of the above plus `pnpm pack --dry-run` in one step.

The test suite pins the launch form for all three Host platforms explicitly, so
building on any one of them verifies the behaviour of the other two.

## Install into a remote-capable Web Profile

Build the checkout first, then install it as a local bundle. The package is intentionally private and is not published to npm.

```sh
# Run from this directory; `dsh plugin` resolves a relative spec against the
# directory you invoke it from, not against the Profile.
dsh plugin --profile web add .
dsh --profile web --dump-config
dsh --profile web
```

If `dsh` is not on your `PATH` because DSH was started through `npx`, call the
same CLI directly — for example `npx @deepseek-ai/dsh plugin --profile web add .`
— and keep using one CLI version for every command.

Open the loopback URL printed by DSH, normally `http://127.0.0.1:3080`, or reach that loopback service through the approved private network/authenticated gateway. The sidebar contains a `Local Agents` entry.

The built-in `web` Profile is required because it supplies the DSH Web App, API proxy, frontend assets, and Client runtime. A newly created custom Profile contains only the base bundle unless the operator explicitly adds `@deepseek-ai/dsh-web-app`; installing this plugin into such a base-only Profile does not create a browser UI.

### Workspace selection

`Local Agents` registers a Host directory itself: type an absolute path in
`Add workspace` and the Host resolves and validates it. That route works in
every Profile and from any browser, local or remote, so no picker configuration
is required to get started.

`Browse…` next to it opens a directory chooser inside the panel. DSH exposes
directory choosing as a capability with two kinds, and they are not
interchangeable, so the panel probes rather than assumes:

- A Profile serving `browse` returns listings, and the panel renders them itself
  as a breadcrumb and a directory list — this works from any browser, anywhere.
- A Profile serving `native` (DSH's default `directory-picker-auto` on a loopback
  desktop) opens the Host's own dialog: the Windows folder dialog, the macOS open
  panel, or a Linux desktop portal. Useful at the Host, useless remotely.

The probe is a listing read, which opens nothing. If the Host refuses both, the
panel says so and the path field remains — it never depends on a picker.

For remote use, merge [remote-web.patch.yml](examples/profile/remote-web.patch.yml)
into the built-in `web` Profile's `cordis.patch.yml` to swap that auto picker
for DSH's in-browser one, which keeps the selected path and all filesystem
access on the Host. The Profile file lives at:

| Host | Path |
| --- | --- |
| Windows | `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml` |
| macOS, Linux | `~/.dsh/profiles/web/cordis.patch.yml` |

Restart the Profile and confirm `dsh --profile web --dump-config` contains
`directory-picker-browse` and `ui-directory-picker-browse` without a loader
name-mismatch warning.

The bundle installs [cordis.patch.yml](cordis.patch.yml). To override its complete config block, use [the enabled example](examples/profile/local-agent-bridge.enabled.patch.yml) in the Profile `cordis.patch.yml`.

## Disable, enable, and uninstall

To disable without removing the linked package, add the row from [local-agent-bridge.disabled.patch.yml](examples/profile/local-agent-bridge.disabled.patch.yml) to the Profile's own `cordis.patch.yml`, then restart or let HMR reload the Profile. Remove `disabled: true` to enable it again.

To uninstall the dependency and bundle layer, first remove the `local-agent-bridge` override row from the Profile's own `cordis.patch.yml`. Then run:

```sh
dsh plugin --profile web remove dsh-plugin-local-agent-bridge
```

Plugin unload disposes active sessions, closes protocol transports, and waits for managed process trees to exit.

## Continuing an existing session

`Continue a session` lists the product-native sessions that already exist for the
selected workspace — including ones started in a terminal — and picks one up in
the browser. The chosen locator goes to the product's own resume path; the bridge
never reads or replays a transcript.

Enumeration goes through each product's own API (`listSessions` in the Agent SDK,
`thread/list` in Codex), so the promise never to read `~/.claude` or `~/.codex`
still holds. For Claude Code the listing excludes programmatic entrypoints, which
is what the SDK documents for a session picker and also keeps the bridge from
offering back the sessions it created itself.

Session transcript paths stay on the Host. An unknown or expired locator makes
the session `orphaned`, the same as a locator that stopped resolving after a Host
restart.

## Commands, skills, and MCP

Typing `/` in the composer lists what the session's product reports it can do,
filtered as you type and navigable with the arrow keys. Selecting an entry writes
the product's own invocation text and nothing else — the bridge never runs a
command on the product's behalf, so `/compact` means what it means in a terminal
and a product that renames a command needs no change here.

The invocation syntax is the product's, not the bridge's:

| Product | Reported through | Invoked as |
| --- | --- | --- |
| Claude Code | `supportedCommands()` on a live SDK query | `/name` |
| Codex | `skills/list` for the session's workspace directory | `namespace:skill` |

Claude Code can only be asked while a turn is running, so its list appears after
the session's first message and is refreshed on each later turn; until then the
panel says the product has not reported yet, which is not the same as reporting
none. Codex answers at any time.

MCP servers from both products are listed with the state each reports, as
inventory — they are not invocable from the composer. Skill filesystem paths stay
on the Host.

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
4. For Claude, rerun session, resume, partial streaming, approval, question, cancellation, and the per-platform spawn tests.
5. Run build, both typechecks, lint, all tests, Profile loader smoke, browser E2E, and redacted real-product smoke before enabling the new version.
6. Leave `allowExperimentalVersions` disabled unless the local operator accepts the unverified protocol risk.

See [Compatibility and upgrades](docs/compatibility.md) and [Codex schema provenance](docs/codex-schema.md).

## Validation and limitations

Automated fixtures do not require personal vendor credentials. Real-product validation must run only on a trusted Host that is already logged in, and reports must omit account data, private source, full prompts, and tokens.

Windows and macOS Hosts have both been exercised against the real products; Linux shares the macOS launch path and is covered by the automated per-platform tests but has not had a real-product smoke run. The MVP is single-user/self-hosted and provides no multi-tenant isolation or RBAC. Attachments, image input, session fork, PTY mode, and automatic vendor login are out of scope.

See [Validation](docs/validation.md) and [Operations](docs/operations.md).

## Licensing and terms

This project is MIT licensed. Codex App Server schemas were generated from Codex `0.147.0`; Codex is distributed under Apache-2.0. The Claude Agent SDK package declares `SEE LICENSE IN README.md`, and Anthropic documents Agent SDK use under its Commercial Terms. This project does not distribute Claude Code or Codex binaries and does not grant rights to vendor services.

Anthropic's Agent SDK documentation says third-party products should use supported API-key authentication unless separately approved to offer `claude.ai` login or rate-limit functionality. This bridge provides no Claude login surface, but its reuse of an already authenticated Host Claude Code installation is not an official authorization statement. Treat the Claude provider as a private, single-user experimental integration and re-review the authentication and distribution terms before any public, commercial, hosted, or multi-user deployment. The project reduces additional browser login surfaces; it cannot guarantee account enforcement outcomes.

Review [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before public, commercial, or multi-user distribution.
