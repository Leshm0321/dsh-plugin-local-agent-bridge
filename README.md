# Local Agent Bridge

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
| DeepSeek Harness | `0.1.0-rc.7` |
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
   [the product is not listed](#the-product-is-not-listed).
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

## The composer

| Key | Does |
| --- | --- |
| Enter | Send |
| Shift+Enter | Newline |
| `↑` / `↓` | Walk messages already sent (in an empty composer) |
| Esc | Interrupt a running turn, else clear the draft |
| `/` | Commands and skills the product reports |
| `@` | Files under the working directory |

Enter is ignored while an input method is composing, so accepting a candidate does
not send a half-written message.

`@` works anywhere a word can begin, because referencing a file happens
mid-sentence, and selecting one replaces just that token. The search runs on the
Host, confined to the working directory after symlinks are resolved, bounded by a
visit budget, and skipping `.git` and dependency trees. When it stops early it says
so rather than presenting a partial list as complete.

## Permission modes

The modes are named after the Claude desktop app, because that vocabulary is what
operators already know:

| Mode | Means |
| --- | --- |
| Auto | The agent handles permission decisions |
| Manual | Always ask before making changes |
| Accept edits | Automatically accept all file edits |
| Plan | Create a plan before making changes |
| Bypass permissions | Accepts all permissions |

Each product reports only the modes it can actually honour, so a mode on screen is
always the mode the agent obeys. Claude Code has a native equivalent for all five.
Codex reports three: it has no accept-edits policy, and its plan mode is reachable
only through a payload that would override the model and reasoning effort you
configured on the Host.

**Accept edits and Bypass permissions stop the browser being asked to approve
anything** — the protection this bridge exists to provide. They are offered because
both products offer them, and the panel marks and warns about them. A change
applies from the next turn, because that is when both products read the setting.

## Commands, skills, and MCP

Typing `/` in the composer lists what the session's product reports it can do,
filtered as you type and navigable with the arrow keys. Selecting an entry writes
the product's own invocation text and nothing else — the bridge never runs a
command on the product's behalf, so `/compact` means what it means in a terminal
and a product that renames a command needs no change here.

The syntax is the product's, not the bridge's:

| Product | Reported through | Invoked as |
| --- | --- | --- |
| Claude Code | `supportedCommands()` on a live SDK query | `/name` |
| Codex | `skills/list` for the session's working directory | `namespace:skill` |

Claude Code can only be asked while a turn is running, so its list appears after
the session's first message and refreshes on each later turn; until then the panel
says it has not reported yet, which is not the same as reporting none. Codex
answers at any time.

MCP servers from both products are listed with the state each reports, as
inventory — they are not invocable from the composer.

## Continuing an existing session

`Browse existing sessions…` lists the native sessions that already exist for the
selected directory, including ones you started in a terminal, and hands the one
you choose to the product's own resume path.

Enumeration goes through each product's own API — the Agent SDK's `listSessions`,
Codex's `thread/list` — never by reading `~/.claude` or `~/.codex`. For Claude
Code the listing excludes programmatic entrypoints, which is what the SDK
documents for a session picker and also keeps the bridge from offering back the
sessions it created itself.

Session transcript paths stay on the Host. An unknown or expired locator makes the
session `orphaned`, the same as one that stopped resolving after a Host restart.

## Runtime behavior

- Codex uses one managed App Server process for several mapped threads
  (`thread/start`, `thread/resume`, `turn/start`, `turn/steer`, `turn/interrupt`).
- Claude Code uses `query()` with `includePartialMessages`, `resume`,
  `canUseTool`, `AskUserQuestion`, and SDK elicitation callbacks.
- A message sent during a running Codex turn steers it; a Claude Code message
  queues until the active turn ends.
- Approvals are one-time. No browser decision is written into product permission
  configuration.
- Browser reconnect uses an event sequence and a bounded replay window. After a
  Host restart a session resumes when a native locator was already captured;
  otherwise it is marked orphaned.
- Archiving hides the bridge session and does not delete native history.

## Configuration

Override in the profile's `cordis.patch.yml`. A patch replaces the **complete**
config block, so keep every key when changing one — see
[the enabled example](examples/profile/local-agent-bridge.enabled.patch.yml).

| Key | Default | Meaning |
| --- | ---: | --- |
| `allowExperimentalVersions` | `false` | Permit product versions classified `unknown`. |
| `enableFakeProvider` | `false` | Expose the local verification fixture. Leave off; it shows up in the product picker. |
| `eventRetention` | `2000` | Maximum retained bridge events per session. |
| `longPollMaxMs` | `25000` | Maximum Client long-poll duration. |
| `processGraceMs` | `3000` | Managed process cleanup grace period. |

## Security boundary

The trusted Host owns vendor authentication, source access, native tools, MCP
servers, and process execution. The browser receives redacted bridge events and
sends prompts, one-time approvals, question answers, cancellations, and opaque
bridge IDs.

The plugin never reads or copies `.claude`, `.codex`, `auth.json`, OS credential
stores, or vendor tokens. Listing commands, skills, MCP servers and sessions goes
through each product's own API, and the absolute filesystem paths those replies
contain are dropped where the reply is parsed. Authentication failures become a
safe `HOST_AUTH_REQUIRED` message to be repaired in a terminal on the Host.

**Keep the Harness bound to `127.0.0.1`.** Remote access requires a separate
private network or an authenticated reverse proxy providing TLS, user or device
authentication, WebSocket support, correct Host/Origin handling, idle expiry, and
access logs. `trustedHosts` is not authentication. Do not expose the Harness port
directly to the Internet.

See [Security](docs/security.md) for the deployment contract and threat boundary.

## Remote browser use

Merge [remote-web.patch.yml](examples/profile/remote-web.patch.yml) into the
profile's `cordis.patch.yml` so the Harness's own workspace picker uses its
in-browser directory chooser instead of a dialog on the Host desktop. `Local
Agents` needs no picker to add a directory, so this is only about the Harness's
own flow.

Restart the profile and confirm `dsh --profile web --dump-config` contains
`directory-picker-browse` and `ui-directory-picker-browse` with no loader
name-mismatch warning.

## Troubleshooting

### The product is not listed

The bridge resolves `codex` and `claude` from the `PATH` of the **process running
the Harness**, which is not necessarily the `PATH` of the terminal you tested in.
Under a per-shell version manager (fnm, nvm, asdf) a product installed for one
Node version is invisible to a Harness started under another, and the panel
correctly reports `not-installed` for something you can run by hand.

```sh
# macOS, Linux — read the running Harness process's PATH
ps eww -p "$(pgrep -f 'dsh web' | head -1)" | tr ' ' '\n' | grep '^PATH='

# then start it from a shell that resolves the product
PATH="$PATH:/path/to/product/bin" dsh --profile web
```

The panel shows this hint inline next to any `not-installed` product.

### The product is installed but not ready

Run its `--version` in the shell that starts the Harness and compare with
[compatibility.md](docs/compatibility.md). The panel names both the installed
version and the admitted range. Keep `allowExperimentalVersions` off unless you
have validated the protocol yourself.

### The browser asks me to authenticate

There is no login button by design. Log in with the product's normal command in a
terminal on the Host, then press Refresh — which re-probes both products, so no
profile restart is needed.

More in [Operations](docs/operations.md).

## Disable, enable, uninstall

To disable without removing the package, add the row from
[local-agent-bridge.disabled.patch.yml](examples/profile/local-agent-bridge.disabled.patch.yml)
to the profile's `cordis.patch.yml` and restart. Remove `disabled: true` to
re-enable.

To uninstall, first remove the `local-agent-bridge` override row from the
profile's own `cordis.patch.yml`, then:

```sh
dsh plugin --profile web remove dsh-plugin-local-agent-bridge
```

Unload disposes active sessions, closes protocol transports, and waits for
managed process trees to exit.

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

See [Validation](docs/validation.md) for the acceptance matrix and what has and
has not been exercised against the real products, and
[Compatibility](docs/compatibility.md) for the upgrade procedure.

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
