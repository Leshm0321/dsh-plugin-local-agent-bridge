# Security

## Trust boundary

The company Host is trusted. It owns the installed Claude Code and Codex products, their existing login state, the selected workspaces, local tools, MCP access, and child processes. The remote browser and access network are less trusted.

The Client receives only:

- Opaque bridge session, turn, and interaction IDs.
- Provider name, product version, compatibility, and safe health state.
- Redacted text, reasoning, tool, file-change, status, and error events.
- One-time approval and question forms.

The Client must never receive vendor account identity, plan details, native session locators, credential paths, cookies, OAuth tokens, API keys, login URLs, or device codes.

## Required remote-access contract

Keep DeepSeek Harness bound to `127.0.0.1`. Place one of these in front of it:

- A private overlay network such as Tailscale, Headscale, or WireGuard.
- An authenticated reverse proxy using OIDC, Passkeys, mTLS, or company SSO.

The access layer must provide TLS, user or device authentication, WebSocket forwarding, safe Host and Origin handling, idle-session expiry, and access logs. Configure DSH `trustedHosts` as an additional host-rebinding fence, never as the only authentication control.

Do not use an unauthenticated FRP tunnel, direct router port forwarding, a public `0.0.0.0` bind, or a secret URL as the access control.

## Authentication isolation

The plugin starts only the Host executable resolved from `PATH`:

- `codex app-server --stdio`
- The Host `claude` path through the official Agent SDK

The plugin does not implement account login, does not call `account/login/*`, declines URL-mode MCP elicitation, and does not read `.claude`, `.codex`, `auth.json`, or OS credential stores. If vendor authentication expires, the browser receives `HOST_AUTH_REQUIRED`; reauthentication happens manually on the Host.

## Approval policy

Interactions use random UUIDs and are bound to one bridge session and turn. Responses are one-time. Late, duplicate, wrong-session, and wrong-kind responses are rejected. Cancellation or Host restart resolves an outstanding interaction as cancelled or expired. There is no automatic approval and no persistent allow rule.

Approval summaries include the tool name and a redacted target when the vendor protocol provides one. A browser approval authorizes only the current request; it does not imply that the underlying command is reversible.

## Redaction and storage

Every persisted record and browser event passes through the shared redactor. Text is bounded, secret-shaped object keys are replaced, and credential paths, bearer tokens, API keys, OAuth URLs, and device-code-shaped strings are removed. Standard opaque UUIDs used for bridge IDs are preserved so browser responses remain stable. Persistence refuses records that still match credential leak probes.

Native session locators are Host-only durable mappings. They are never part of the Remote schema. Full child-process environments are not logged or persisted.

## Security verification

Release validation must include:

- Browser request allowlisting with a failure on Anthropic, Claude, OpenAI, ChatGPT, or vendor API domains.
- Browser storage, cookies, downloads, Remote payloads, stdout, stderr, and UI scans for credential canaries.
- A check that no login action, OAuth URL, device code, or token input exists in the Client.
- Duplicate and late interaction-response tests.
- Process-tree cleanup evidence after cancel, unload, and Host shutdown.

Automated fixtures use synthetic values only. Never insert a real credential into a test report.

## Enumerating product state

The panel lists a product's slash commands, skills, MCP servers, and resumable
sessions. All of it comes from the product's own API — the Agent SDK's
`supportedCommands`, `mcpServerStatus` and `listSessions`, and Codex's
`skills/list`, `mcpServerStatus/list` and `thread/list`. The plugin does not read
`~/.claude`, `~/.codex`, or any file under them, so the prohibition on touching
vendor state directories is unchanged by these features.

Both products report absolute filesystem paths in these replies: a `SKILL.md`
path per skill, a transcript path per session. Those fields are dropped where the
reply is parsed rather than carried and redacted downstream, so no Host
filesystem layout reaches the browser. Every string that does cross — a session
title, a skill description — goes through the same redaction as any other vendor
text.

A native session locator is opaque to the bridge. It is passed to the product's
own resume path and is never parsed, joined onto a path, or used to open a file.

## The panel's own lock

Settings -> Privacy sets a password for the Local Agents panel. It is off until a
password is set; the password's presence *is* the switch, so there is no config flag
that could disagree with it.

**It is enforced on the Host.** Every one of the bridge's Remote methods calls the
gate before doing anything, and refuses without a valid token. A password screen
drawn only in the browser would be one `curl` away from nothing, which is worse
than no lock because it looks like protection. Verified by driving `/api` directly:
without a token, and with a made-up one, `catalog`, `sessionsList` and `hostList`
all come back refused.

| Rule | Why |
| --- | --- |
| The verifier is `scrypt` at 32 MB, ~0.15s per guess, with the cost parameters stored beside the hash | Over loopback a caller can try thousands of passwords a second, which turns any memorable password into none. Storing the parameters means raising them later still verifies an old password |
| Five failures, then a lockout doubling from 30s to a 15-minute ceiling | The hash bounds the *rate*; the lockout bounds the *total*. Neither alone is enough. Measured: the sixth attempt is refused in 0.06s, before the hash runs |
| Changing or removing the password requires the current one, even while unlocked | A live token is not proof of knowing the password. It outlives the moment it was issued, and an unattended tab is the case this feature exists for |
| Tokens live in memory only | A Host restart locks the panel again. The password survives; the unlock does not |
| Setting or changing the password drops every unlock, everywhere | Otherwise a password change would leave other browsers holding the old grant |
| One unlock lasts 8 hours, or 30 minutes idle | Both configurable — `panelLockAbsoluteMs`, `panelLockIdleMs`. Both enforced on the Host, so a browser cannot extend its own permission |
| The browser asks the Host whether its token still works, rather than reading an error code | A failure's `code` is the *carrier's*, not the bridge's — matching on it reads the wrong field. `privacyState` answers the actual question |

**What it defends against**, and the reason it exists: someone who can reach the
page. A housemate opening the URL, a colleague at an unattended desk, a tab left
open on a shared machine.

**What it does not defend against.** Two things, both stated on the screen itself
rather than only here:

- **A network attacker.** Over plain HTTP the password crosses the wire in
  cleartext. On a loopback address that is fine. Anywhere else, this is a
  convenience fence and the deployment still needs the TLS and authenticated access
  layer this document has always required.
- **The rest of the Harness.** The lock covers this plugin's surface, because that
  is the only surface this plugin owns. A plugin has no seat in front of DSH's own
  routes: `/api` belongs to `dsh-client-connection`, registering a duplicate path
  throws, the fallback seat is already claimed by the SPA, and there is no
  middleware hook. To password-gate the Harness itself, put a proxy in front of it —
  [`examples/proxy/Caddyfile`](../../examples/proxy/Caddyfile) is a working one, and
  it provides the TLS the point above needs.

**A forgotten password** is recovered by deleting the `secrets` record in the
plugin's storage domain on the Host (`local_agent_bridge.json`). Whoever can read
that file could always delete it — a lock kept by a process cannot outrank the
machine the process runs on — so this is a limit being stated, not a hole being
left. It is also why the verifier being a one-way hash matters: the file discloses
no password even though it can be removed.

## Browsing the Host filesystem

The composer's file button can list any directory on the machine the Harness runs
on, and returns absolute paths to the browser. It is the panel's widest read, and it
is on by default because three things hold:

- **The platform already does this.** `workspaces.listDirectory` — the Harness's own
  workspace picker — enumerates Host directories and returns absolute paths to the
  browser. This adds files to that view, because that picker returns directories
  only. It is implemented in `src/core/host-browse.ts` rather than delegated for the
  same reason, and because `listDirectory` depends on a `browse` capability a
  composed Profile may not serve.
- **The agent could already read those paths.** Both products take an absolute path
  and read it, under the session's permission mode. Browsing saves the operator
  typing a path they already know; it grants the agent nothing it lacked, and an
  agent reading a file outside the working directory still requests approval unless
  the mode says otherwise.
- **It is bounded.** One level per request, 500 entries, absolute path and kind only.
  It never returns file contents, never recurses, and refuses a relative path rather
  than resolving it against whatever directory the Host process happens to be in.

It remains a read the browser could not previously make. Set `allowHostBrowsing:
false` in the Profile config for any deployment where the browser is further away
than a loopback address: the panel then omits the route rather than offering one
that fails, and the Host refuses the call outright.

Note the distinction from the redaction rule elsewhere in this document. An absolute
path appearing inside a *product's reply* is still dropped where the reply is parsed
— that is the Host leaking its own layout into vendor text. A path the operator
navigated to and clicked is the opposite: it is what they chose, and it is the only
useful thing to return.

## Files the browser writes in the working directory

With `allowWorkspaceWrites` on — the default — the side panel can create, rename,
delete and edit files inside the session's working directory. It is the only place the
browser writes arbitrary paths, and the rules are in `src/core/workspace-files.ts`:

| Rule | Why |
| --- | --- |
| Confined to the working directory, checked after symlinks resolve | A link committed into a repository must not become a way to write outside the tree. The read side enforces this too, but a write is the one that does damage |
| Creating and renaming confine the *parent* and require the last segment to be a single name | The target does not exist yet, so the existing-path check cannot be used; confining the parent is what stops `a/../../b` reaching out through a directory that is itself inside |
| The parent must already exist | One mistyped path should not produce a directory tree nobody asked for |
| Creating and renaming never overwrite | "New file" and "erase that file" are different intentions, and only one was expressed |
| Deleting is never recursive; a non-empty directory is refused | A recursive delete reachable from a browser is a way to lose a repository to one mis-click |
| The workspace root itself cannot be deleted | Never what was meant |
| Writes carry the revision the file was read at, and a mismatch is refused | The agent works in this same tree. A panel that wrote whatever its buffer held would silently discard the agent's work |
| 2 MB per write | Smaller than the read ceiling on purpose: reading a large file is a look, writing one is a change, and a buffer that size is not something anyone typed |

Set `allowWorkspaceWrites: false` for a deployment serving clients across a network.
The panel then omits the controls and the Host refuses the calls.

## Files the browser sends to the Host

Every other path in this bridge carries data outward. The composer's upload
carries it in, and exists for one reason: when the Harness runs on another
machine, a file on the operator's own laptop has no other way to reach the agent.
Referencing a file already in the working directory remains the default and copies
nothing.

Because it inverts the direction, the rules are narrow and are all enforced on the
Host, in `src/core/uploads.ts`:

| Rule | Why |
| --- | --- |
| One destination: `.dsh-bridge-uploads/` under the session's working directory, resolved from the Host's own workspace registry | The browser never names a destination, so there is no path parameter for it to influence |
| Every path segment rebuilt against an allow-list of letters, digits, `.`, `_`, `@`, space and `-` | A deny-list has to enumerate separators, traversal, control characters and Windows-reserved punctuation, and can forget one |
| A segment that is only dots is refused; a leading dot is otherwise kept | `..` is traversal, `.env.example` is a file someone means to send |
| Containment re-asserted after the path is assembled, against the directory's real location | Catches a mistake in the rebuilding, and resolves a working directory reached through a symlink the same way `@` does |
| Written with `wx`, never replacing; a collision takes a numeric suffix | An upload can never destroy the operator's work, and the filesystem rather than a prior check decides what exists |
| 8 MB per file, 32 MB per request, 50 files, depth 8, 96 characters per segment | A browser cannot fill the Host's disk one request at a time |
| base64 decoded strictly, by round-tripping | Node's decoder ignores characters it does not recognise, so a malformed payload would otherwise be written as whatever it parsed to |

A refused file is counted and reported, so the panel says some did not arrive
rather than delivering fewer than were chosen.

The uploaded bytes are the operator's own file, sent deliberately. They are not
redacted: redaction exists to keep vendor credentials from reaching the browser,
and rewriting the contents of a file someone asked the agent to read would corrupt
it. Treat the upload directory as operator-supplied content, and note that the
agent reading it is subject to the same permission mode as any other tool call.

Uploads are exercised against a real directory in `tests/unit/uploads.spec.ts`,
including traversal spellings for both path separators, absolute POSIX and Windows
paths, a symlinked working directory, collision handling, and malformed base64.
