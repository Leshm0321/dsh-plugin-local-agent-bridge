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

The controls around the box follow each product's own composer:

| Position | Shows |
| --- | --- |
| Above, left | Working directory, branch, and lines changed |
| Above, right | Tokens spent, and how full the context is |
| Below, left | Permission mode, a file button, and dictation |
| Below, right | Usage allowance, model, and send |

**The status line above the box** answers what a terminal answers at a glance.
Branch and change size come from `git status --porcelain=v2` and `git diff
--numstat HEAD`, run on the Host with no inherited environment and with terminal
prompts and index locks disabled, so a status read can neither block on a
credential nor fight your own terminal. A directory that is not a repository, or a
Host without git, simply shows nothing. A detached HEAD names its commit and says
so; a branch tracking nothing says that too, because finding out after a push is
the wrong time.

Tokens spent is the running total for the session, with input, output, cache reads
and cache writes on hover. It is a different question from the context meter beside
it — one only grows, the other moves both ways as the session compacts — which is
why both are there.

**The file button** offers three routes, because a file can be in three places:

- **Working directory** is `@` without the syntax — the same Host search, listing
  files and folders, appending the reference to the draft. Nothing is copied. A
  folder keeps its trailing slash, which is how both products tell one from a file.
- **This computer** sends files from the machine the browser is running on, which is
  the only way those bytes can arrive when the Harness is somewhere else. They land
  in `.dsh-bridge-uploads/` inside the working directory — add it to `.gitignore` —
  and are referenced identically, so the products read one shape either way.
- **Host filesystem** browses the machine the Harness runs on, beyond the working
  directory, and references what you pick by absolute path. Directories open on
  click; a directory is referenced through its own button, so one click never means
  two things. Dot-prefixed entries stay hidden until you ask.

Browsing the Host is the panel's widest read, and it can be turned off — see
[Security boundary](#security-boundary) for what it does and does not grant.

Uploads are the only path in the bridge that writes Host files, so they are narrow
by design: one destination the browser cannot name, file names rebuilt from an
allow-list rather than trusted, containment re-verified after symlinks resolve,
nothing ever overwritten, and ceilings of 8 MB per file, 32 MB per request, and 50
files. A name that cannot be made safe, or a file over the ceiling, is refused and
counted rather than silently dropped.

**Dictation** appears only where the browser has the Web Speech API, which in
practice means Chromium. Transcripts are appended, so speech extends a typed
sentence instead of replacing it. Note that a browser's recognition is not
necessarily local — see [Security boundary](#security-boundary).

## The sidebar

The toggle sits at the titlebar's left, on the same side as the sidebar it
controls. Collapsed, the sidebar becomes a 52px icon rail that still switches
sessions — a running turn shows as a dot — and the content area takes the width
back.

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

## Model, effort, and quota

Both products enumerate their own models and both accept one per turn, so the
picker offers exactly what the session's product reported — there is no list of
model names here to fall out of date. Reasoning effort nests under the model,
because that is how both products scope it: the levels one model accepts are not
the levels another does, and a model that takes none shows none.

`Product default` is a real choice, not a placeholder. Leaving it selected keeps
whatever you configured in the CLI itself, which is the right answer if you have
already set a model there. A change applies from the next turn, for the same reason
as the permission mode.

Effort is a slider rather than a row of buttons, because the levels are one ordered
axis of "think harder" and not five unrelated choices. It is a native range input,
so keyboard and screen readers work without being reimplemented, and it announces
the level's name rather than its index. Levels the panel has no word for — Codex
ships an `ultra` the Claude SDK does not — are shown exactly as the product spells
them.

| Product | Models from | Applied through |
| --- | --- | --- |
| Claude Code | `supportedModels()` on a live SDK query | `Options.model` and `Options.effort` |
| Codex | `model/list` on the App Server | `model` and `effort` on `turn/start` |

As with commands, Claude Code can only be asked while a turn is running, so the
list appears after a first message has been sent anywhere in the panel; until then
the control says so rather than looking like a product with no models. Codex
answers at any time.

**Quota is shown only when the product volunteers it.** Claude Code emits it as a
stream event for subscription accounts; Codex has the reciprocal call but refuses
it without a ChatGPT sign-in. An account the product said nothing about shows
nothing, because a zero or a dash would read as a figure. When several allowances
are reported the tightest one is shown — that is the one that will stop you — and
the rest are in the tooltip.

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

### Why `/resume`, `/model` and `/clear` are not there

They are not commands. `/resume`, `/model`, `/help`, `/clear` and the rest belong to
Claude Code's terminal interface, which draws its own screen and reads its own
keystrokes; the Agent SDK this bridge drives has no such layer, so those commands
do not exist in it. What `supportedCommands()` returns is skills — its own
documentation says so — which is why typing `/resume` gets you the product's honest
`/resume isn't available in this environment` rather than a bridge-invented error.

The capabilities themselves are all here, as controls rather than as typed
commands, because that is the shape the SDK exposes them in:

| In a terminal | In this panel |
| --- | --- |
| `/resume` | `Browse existing sessions…` |
| `/model` | The model picker at the composer's bottom-right |
| `/status` | Context usage above the box, quota below it |
| `/permissions` | The permission-mode picker |

Anything a product genuinely reports as a command or skill does appear in the `/`
list, and it is invoked with the product's own syntax.

## Continuing an existing session

`Browse existing sessions…` lists the native sessions that already exist for the
selected directory, including ones you started in a terminal, and hands the one
you choose to the product's own resume path.

**The earlier conversation is loaded into the timeline.** Resuming gives the
*product* its context back — that is what resuming means — but the panel only ever
recorded its own turns, so continuing a session started in a terminal used to show
a blank screen above a working agent. The transcript is now read back through each
product's own API and written as ordinary events, so it persists, replays after a
reload, and survives a Host restart like anything else. A rule across the
transcript marks where the existing conversation ends.

| Product | Transcript from | What it contains |
| --- | --- | --- |
| Claude Code | `getSessionMessages()` | Messages, thinking, and tool calls with their results |
| Codex | `thread/read` with turns | Messages only — the rollout history holds no tool calls |

The difference is the products', not the bridge's: Codex's stored history simply
does not carry tool calls, and inventing them would be worse than their absence.
`thread/items/list` would be the paginated equivalent, but this Codex answers it
with "not supported yet".

The newest part is kept, not the oldest. A long session's opening is rarely what
you need in order to continue it — in one real case it was a single message
followed by a hundred tool calls — so the tail survives and the panel says when
earlier entries were dropped.

Enumeration goes through each product's own API — the Agent SDK's `listSessions`,
Codex's `thread/list` — never by reading `~/.claude` or `~/.codex`. For Claude
Code the listing excludes programmatic entrypoints, which is what the SDK
documents for a session picker and also keeps the bridge from offering back the
sessions it created itself.

Session transcript paths stay on the Host. An unknown or expired locator makes the
session `orphaned`, the same as one that stopped resolving after a Host restart.

## Streaming

Both products stream token by token, and the Host relays each delta the moment it
arrives. The browser reads through a long poll, though, so what it receives is
everything that accumulated during one round trip — measured on a real Codex turn,
11 characters and then 346 at once. Correct, and it did not look like streaming.

Arrival and display are therefore separate: text is revealed on a frame timer whose
stride grows with the backlog, so a large batch catches up in a few frames instead
of appearing whole, and the reveal can never fall permanently behind a fast turn. A
finished answer and a transcript restored from a resumed session are shown complete
— animating those would misrepresent when they happened.

Timeline rows are memoized, which is the other half: without it every delta
repainted a resumed session's several hundred rows, which lengthened the round trip
and made the next batch bigger still.

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
| `allowHostBrowsing` | `true` | Let the composer's file button browse the Host beyond the working directory. Off omits the route entirely. |
| `enableFakeProvider` | `false` | Expose the local verification fixture. Leave off; it shows up in the product picker. |
| `eventRetention` | `2000` | Maximum retained bridge events per session. |
| `longPollMaxMs` | `25000` | Maximum Client long-poll duration. |
| `processGraceMs` | `3000` | Managed process cleanup grace period. |

## Security boundary

The trusted Host owns vendor authentication, source access, native tools, MCP
servers, and process execution. The browser receives redacted bridge events and
sends prompts, one-time approvals, question answers, cancellations, and opaque
bridge IDs.

Two deliberate widenings of that, both reachable only from the composer's file
button, both recorded here rather than left implied.

**Browsing the Host filesystem.** The `Host filesystem` route lists any directory on
the machine the Harness runs on and returns absolute paths to the browser. Three
things make that a reasonable default rather than a hole:

- The Harness's own workspace picker already enumerates Host directories and returns
  absolute paths to the browser. This adds *files* to that view — the Harness's
  picker returns directories only — rather than opening a door the platform had
  closed.
- The agent could already read those paths. Both products take an absolute path and
  read it, under the session's permission mode. Browsing saves the operator typing a
  path they already know; it grants the agent nothing new.
- It is bounded: one level per request, 500 entries, names and kinds only. It never
  returns file contents — reading a file is still the agent's act, and still subject
  to approval.

It is nevertheless a read the browser could not make before, so set
`allowHostBrowsing: false` in the Profile for a deployment where the browser is
further away than a loopback address. The panel then omits the route rather than
offering one that fails, and the Host refuses the call.

**Files the browser sends to the Host.** The composer's upload which exists so a
browser on another machine can hand the agent a file at all. It writes only into
`.dsh-bridge-uploads/` under the session's working directory, resolved on the Host;
the browser supplies bytes and a name, never a destination. Names are rebuilt from
an allow-list, segments that are only dots are refused, containment is re-verified
after symlinks resolve, and existing files are never replaced. Per-file, per-request
and file-count ceilings apply. If you would rather not have that path at all, use
the working-directory tab and nothing is written.

The plugin never reads or copies `.claude`, `.codex`, `auth.json`, OS credential
stores, or vendor tokens. Listing commands, skills, MCP servers and sessions goes
through each product's own API, and the absolute filesystem paths those replies
contain are dropped where the reply is parsed. Authentication failures become a
safe `HOST_AUTH_REQUIRED` message to be repaired in a terminal on the Host.

**Dictation is the one exception, and it is the browser's, not the plugin's.**
Everything else here stays on the Host, but Chromium's Web Speech API transcribes
by sending the audio to a vendor service. The button says so on hover; if that is
not acceptable, do not use it — the panel works identically without it, and a
browser without the API never shows it.

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
