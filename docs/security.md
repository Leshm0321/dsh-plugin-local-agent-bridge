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
