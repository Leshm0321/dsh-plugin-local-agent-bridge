# Local Agent Bridge

**English** | [简体中文](README.zh-CN.md)

Drive the **Claude Code** and **Codex** installations already on your machine from
the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) browser UI.

The browser never logs in to Anthropic or OpenAI. It never receives vendor
cookies, OAuth tokens, API keys, credential files, or native session
identifiers. The Host runs the products you have already authenticated in a
terminal, and the browser gets redacted events and sends ordinary prompts.

This is not an LLM adapter and it calls no model HTTP API. Codex runs through
`codex app-server --stdio`; Claude Code runs through the official Agent SDK,
launching the `claude` executable resolved from the Host `PATH`.

## What it gives you


- **Both products, one panel.** A `Local Agents` entry in the Harness sidebar,
  with sessions per working directory.
- **The keyboard you already use.** Enter sends, Shift+Enter is a newline, `↑`
  walks your sent messages, Esc interrupts a running turn. `/` lists the product's
  own commands and skills; `@` completes a file from the working directory.
- **Permission modes.** Auto, Manual, Accept edits, Plan, Bypass — the same modes
  the Claude desktop app offers, mapped to what each product can actually honour.
- **Tool calls you can open.** Expand a row to see what the agent ran and what came
  back, instead of a one-line summary.
- **Context usage**, so a long session warns you before it compacts.
- **Real tool approvals.** A native `Write` or `Bash` request that would prompt in
  a terminal prompts in the browser, once — no decision is written into Claude
  Code or Codex permission config.
- **Continue what you started in a terminal.** Pick up an existing native session
  from the browser.
- **Chinese and English**, following the Harness language preference.
- **Follows the Harness theme**, light and dark.

## Requirements


| | |
| --- | --- |
| DeepSeek Harness | `0.1.2-rc.1` |
| Node.js | `^22.19.0` or `>=24.0.0` |
| pnpm | `11.7.0` |
| Claude Code CLI (optional) | `>=2.1.220 <2.2.0` |
| Codex CLI (optional) | `0.147.x` |
| Host OS | Windows 10/11 x64, macOS 13+, Linux x64/arm64 |

At least one of Claude Code or Codex must be installed **and already logged in**
on the Host. The plugin has no login surface by design; authentication is
repaired in a terminal.

An unsupported or unreadable product version is refused by default, with the
installed version and the admitted range both named in the panel.
`allowExperimentalVersions` is a local override, not a compatibility claim.

## Install


Everything below runs the same on Windows (PowerShell or `cmd`), macOS, and Linux.

If `dsh` is not on your `PATH` — for instance you start the Harness with
`npx @deepseek-ai/dsh web` — replace `dsh` with `npx @deepseek-ai/dsh`
throughout, and keep using one CLI version for every command.

### From a clone (recommended)

```sh
git clone https://github.com/Leshm0321/dsh-plugin-local-agent-bridge.git
cd dsh-plugin-local-agent-bridge
pnpm install --frozen-lockfile

# Run from this directory. `dsh plugin` resolves a relative spec against the
# directory you invoke it from, not against the profile.
dsh plugin --profile web add .

dsh --profile web --dump-config   # optional: confirm the row composed
dsh web
```

`pnpm install` builds the plugin through its `prepare` script on a fresh clone, so
there is no separate build step the first time. It does **not** rebuild when
dependencies are already up to date, so after editing run `pnpm run build` and
restart the profile — the profile links your checkout, so edits are picked up
without reinstalling.

Open the loopback URL the Harness prints, normally `http://127.0.0.1:3080`. The
sidebar has a `Local Agents` entry.

### Straight from Git

One command, at the cost of a per-commit allowlist entry:

```sh
dsh plugin --profile web add github:Leshm0321/dsh-plugin-local-agent-bridge
```

pnpm refuses to run the plugin's build script until you allow it, and prints the
exact key to add — including the commit hash, so it has to be updated on every
upgrade. Add it under `allowBuilds` in the profile's `pnpm-workspace.yaml`
(`~/.dsh/profiles/web/pnpm-workspace.yaml`, or `%USERPROFILE%\.dsh\profiles\web\`
on Windows) and re-run the command. The clone route avoids this entirely.

### Which profile

The built-in `web` profile is required: it supplies the Harness web app, API
proxy, frontend assets, and Client runtime. A freshly created custom profile has
only the base bundle unless you explicitly add `@deepseek-ai/dsh-web-app`, and
installing this plugin there produces no browser UI.

## First run


1. Confirm `claude --version` and/or `codex --version` **in the shell that starts
   the Harness**. This matters more than it sounds — see
   [the product is not listed](docs/en/troubleshooting.md#the-product-is-not-listed).
2. Start the profile and open `Local Agents`.
3. Add a working directory: type an absolute Host path, or use `Browse…`.
4. Pick a product and a directory, then `Create session` — or
   `Browse existing sessions…` to continue one you started in a terminal.

### Working directories

The panel keeps **its own** list of working directories. A directory you add is
private to the panel: it does **not** appear in the Harness sidebar unless you
turn on `Show in DeepSeek Harness` for it, and turning that off removes it again.

That switch exists because a Harness workspace has no visibility dimension — its
record is path, title, sessions and timestamps — so anything registered there is
in the sidebar for good. Giving an agent somewhere to work should not imply that,
so publishing is opt-in, per directory, and reversible.

Workspaces you already added in the Harness are imported into the list on first
load and shown as published, so they stay usable and stay visible. Removing a
directory from the panel also removes the Harness workspace **if this plugin
published it**; the directory on disk is never touched.

`Browse…` probes the Host: a profile serving the `browse` capability gets an
in-panel directory sheet that works from any browser, while one serving `native`
opens the Host's own dialog — useful at the Host, useless remotely. If neither is
served, the path field still works and the panel says so.

## What's in the panel

| | |
| --- | --- |
| **Conversation** | The transcript, as question / work / answer. A finished turn's tool calls and thinking fold into one line, markdown renders, and text reveals as it streams |
| **Trace** | Where the time went and what each step did, derived from events the panel already holds |
| **Composer** | Working directory and context above; permission mode, a file button and dictation below-left; usage allowance, model and send below-right. `/` for commands and skills, `@` for files, paste for images |
| **Side panel** | The project's files with syntax colour, and what is uncommitted as a unified or side-by-side diff |

[Features](docs/en/features.md) covers all of it — including which parts each product can
actually honour, and what the panel does where the two differ.

## Configuration


Override in the profile's `cordis.patch.yml`. A patch replaces the **complete**
config block, so keep every key when changing one — see
[the enabled example](examples/profile/local-agent-bridge.enabled.patch.yml).

| Key | Default | Meaning |
| --- | ---: | --- |
| `allowExperimentalVersions` | `false` | Permit product versions classified `unknown`. |
| `allowHostBrowsing` | `true` | Let the composer's file button browse the Host beyond the working directory. Off omits the route entirely. |
| `allowWorkspaceWrites` | `true` | Let the side panel create, rename, delete and edit files in the working directory. Off hides those controls. |
| `panelLockAbsoluteMs` | `28800000` (8h) | How long one unlock of the panel lasts, regardless of use. |
| `panelLockIdleMs` | `1800000` (30 min) | How long one unlock survives with no call made through it. |
| `panelPasswordMinLength` | `8` | Shortest panel password the Host will accept. |
| `enableFakeProvider` | `false` | Expose the local verification fixture. Leave off; it shows up in the product picker. |
| `eventRetention` | `2000` | Maximum retained bridge events per session. |
| `longPollMaxMs` | `25000` | Maximum Client long-poll duration. |
| `processGraceMs` | `3000` | Managed process cleanup grace period. |

## Security boundary

The trusted Host owns vendor authentication, source access, native tools, MCP servers
and process execution. The browser receives redacted bridge events and sends prompts,
one-time approvals, answers, cancellations and opaque bridge IDs.

The plugin never reads or copies `.claude`, `.codex`, `auth.json`, OS credential
stores or vendor tokens. Listing commands, skills, MCP servers and sessions goes
through each product's own API, and the absolute filesystem paths those replies
contain are dropped where the reply is parsed. An authentication failure becomes a
safe `HOST_AUTH_REQUIRED` message to repair in a terminal on the Host.

Four things do cross that line, each deliberately and each switchable off:

| What | Reach | Turn off with |
| --- | --- | --- |
| Host filesystem browsing | Lists any directory on the Host; names and kinds only, never contents | `allowHostBrowsing: false` |
| Workspace writes | Creates, renames, deletes and edits inside the working directory | `allowWorkspaceWrites: false` |
| Uploads | Writes only into `.dsh-bridge-uploads/`, under a name the Host rebuilds | Use the working-directory tab instead |
| Dictation | Chromium sends the audio to a vendor service to transcribe — the browser's doing, not the plugin's | Do not use the button |

A fifth thing goes the other way: **Settings -> Privacy** puts a password in front of
this panel, enforced on the Host so it cannot be walked around with `curl`. It covers
this plugin's surface only — a plugin has no seat in front of DSH's own routes — and
over plain HTTP the password travels in cleartext. To gate the Harness itself, put a
proxy in front of it: [`examples/proxy/Caddyfile`](examples/proxy/Caddyfile) is a
working one.

**Keep the Harness bound to `127.0.0.1`.** Remote access requires a private network
or an authenticated reverse proxy providing TLS, user or device authentication,
WebSocket support, correct Host/Origin handling, idle expiry and access logs.
`trustedHosts` is not authentication. Do not expose the Harness port to the Internet.

[Security](docs/en/security.md) has the reasoning behind each of those, the deployment
contract, and the threat boundary.

## Documentation

In [`docs/en`](docs/en), with a Chinese translation of each in [`docs/zh`](docs/zh).

| | |
| --- | --- |
| [Features](docs/en/features.md) | Everything the panel does |
| [Security](docs/en/security.md) | Trust boundary, the deliberate widenings, deployment contract |
| [Operations](docs/en/operations.md) | Runtime behaviour, remote browser use, enable and uninstall |
| [Troubleshooting](docs/en/troubleshooting.md) | When it runs but something is not right |
| [Compatibility](docs/en/compatibility.md) | Supported product versions and the upgrade procedure |
| [Validation](docs/en/validation.md) | What was actually verified, and what was not |
| [Codex schema provenance](docs/en/codex-schema.md) | Where the generated App Server schema came from |

## Development


```sh
pnpm install --frozen-lockfile
pnpm run check        # build + typecheck + lint + test + pack check
```

`pnpm run check` is what CI should run. The suite pins the launch form for all
three Host platforms explicitly, so building on any one of them verifies the
behaviour of the other two.

The profile links your checkout, so `pnpm run build` plus a profile restart is the
full edit loop. The Harness web app disables HMR, so a restart is required.

See [Validation](docs/en/validation.md) for the acceptance matrix and what has and
has not been exercised against the real products, and
[Compatibility](docs/en/compatibility.md) for the upgrade procedure.

## Status and limitations


Windows and macOS have both been exercised against the real products. Linux
shares the macOS launch path and is covered by the automated per-platform tests
but has had no real-product smoke run.

Single-user and self-hosted: no multi-tenant isolation, no RBAC. Attachments,
image input, session fork, and PTY mode are out of scope. A production gateway
deployment (TLS, authentication, WebSocket forwarding, Host/Origin enforcement,
idle expiry, access logging) has not been validated — the loopback smoke does not
claim it.

## Licensing and terms


MIT. Codex App Server schemas were generated from Codex `0.147.0`; Codex is
distributed under Apache-2.0. The Claude Agent SDK declares
`SEE LICENSE IN README.md`, and Anthropic documents Agent SDK use under its
Commercial Terms. This project distributes no vendor binaries and grants no
rights to vendor services.

Anthropic's Agent SDK documentation says third-party products should use
supported API-key authentication unless separately approved to offer `claude.ai`
login or rate-limit functionality. This bridge provides no Claude login surface,
but its reuse of an already authenticated Host Claude Code installation is not an
official authorization statement. **Treat the Claude provider as a private,
single-user, experimental integration**, and re-review the authentication and
distribution terms before any public, commercial, hosted, or multi-user
deployment.

Review [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before public,
commercial, or multi-user distribution.
