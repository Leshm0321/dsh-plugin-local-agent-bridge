# Validation

## Automated commands

Run from PowerShell in the project root:

```powershell
.\node_modules\.bin\tsc.CMD -p tsconfig.host.json --noEmit
.\node_modules\.bin\tsc.CMD -p tsconfig.client.json --noEmit
.\node_modules\.bin\tsc.CMD -p tsconfig.host.declarations.json
.\node_modules\.bin\tsc.CMD -p tsconfig.client.declarations.json
.\node_modules\.bin\tsdown.CMD --config tsdown.host.config.ts
.\node_modules\.bin\tsdown.CMD --config tsdown.client.config.ts
.\node_modules\.bin\oxlint.CMD src tests build scripts
.\node_modules\.bin\vitest.CMD run
pnpm pack --dry-run
```

The final automated run contains 6 test files and 30 tests. It covers redaction, opaque UUID stability, version admission, strict Typert schemas, Profile browse-picker composition, three-turn streaming, queueing, approvals, questions, cancellation, replay reset, persistence recovery, Codex App Server lifecycle and login rejection, Claude SDK resume/streaming/interactions/cancellation, and Client create/poll/respond/reconnect behavior.

## Real-product smoke checklist

Run only on a trusted Host already logged in to the vendor products. Use a disposable test workspace without confidential source.

For each provider:

1. Create one browser bridge session.
2. Complete three turns that can be reported only as generic success/failure facts.
3. Trigger one safe tool approval and exercise both allow and deny where practical.
4. Trigger one user question and answer it from the browser.
5. Cancel one running turn.
6. Refresh the page during activity and confirm state recovery within five seconds.
7. Interrupt the network path and confirm automatic reconnect without duplicate rendered events.
8. Archive the session and unload the plugin.
9. Verify the managed process tree is gone.

Do not record real account identity, tokens, private source, full prompts, command lines containing private data, or model output containing company information.

## Browser zero-login evidence

Capture a browser trace through the full fake-provider flow and assert:

- No request host matches Anthropic, Claude, OpenAI, ChatGPT, or vendor API domains.
- Local storage, session storage, IndexedDB, cookies, downloads, DOM text, and Remote frames contain no credential canary.
- No login button, token field, OAuth URL, or device code is present.
- DSH is reached only through the approved authenticated access path.

## Acceptance matrix

Validation below was run on Windows with DSH CLI `0.1.0-rc.7`, Codex `0.147.0`, Claude Code `2.1.220`, and Claude Agent SDK `0.3.220`. The DSH Web Profile remained bound to `127.0.0.1:3080`, telemetry was disabled, and all sessions used the disposable project-local validation workspace. Reports retain only generic success facts.

| # | PRD criterion | Status | Evidence |
|---:|---|---|---|
| 1 | No Anthropic/OpenAI login entry in the browser | Automated + manually verified | Client source/DOM control scans pass. The real `Local Agents` dialog contains no login, OAuth, device-code, API-key, or token control. A fresh DOM scan found 29 controls and zero login-like controls. The separate DSH core model-configuration dialog is not part of this plugin. |
| 2 | Browser E2E network record contains no vendor-domain request | Manually verified | A fresh CDP capture across reload, plugin boot, catalog, session replay, and a Fake Provider turn recorded 94 requests; every HTTP request targeted `127.0.0.1:3080`, including `dsh-plugin-local-agent-bridge/client.js` and `localAgentBridge/*`, with zero Anthropic, Claude, OpenAI, or ChatGPT URLs. |
| 3 | Browser and Remote Payload contain no vendor credential or auth-file content | Automated | Credential canaries are scanned across Remote events, persistence, rendered DOM, browser-request spies, browser storage fixtures, cookies, and downloads. All canaries and credential markers are absent. No real credential store was inspected. |
| 4 | Claude/Codex start from Host-installed executables | Automated + manually verified | Discovery/version tests pass. Real browser sessions successfully launched the installed `codex app-server --stdio` path and the official Claude Agent SDK configured with the installed Host `claude` executable. |
| 5 | Both providers create sessions and sustain at least three turns | Manually verified | Codex completed three continuous turns plus cancellation. Claude completed multiple continuous turns including resume after Host restart, tool use, AskUserQuestion, and cancellation. |
| 6 | Text is displayed incrementally | Automated + manually verified | Provider integration tests assert delta projection. Fake Provider and real Claude runs produced multiple text deltas; Claude deltas now share one stable turn-level item ID so one answer renders as one streaming row. |
| 7 | Browser can approve or reject at least one real tool request | Manually verified | A real Claude `Write` request in the disposable workspace entered `awaiting-approval`; `Allow once` completed the tool. Fake Provider and provider integration tests also cover allow, deny, and cancel resolutions. |
| 8 | Browser can answer Claude AskUserQuestion; Codex equivalent when supported | Automated + manually verified | A real Claude AskUserQuestion displayed Alpha/Beta options, accepted the browser answer, and completed the turn. Codex request-user-input and MCP form mappings are covered by protocol tests; the tested Codex model answered a requested choice in text instead of invoking the optional tool. |
| 9 | Running turns can be cancelled and managed work stops | Automated + manually verified | Fake, real Codex, and real Claude turns all moved through `cancelling` to `USER_CANCELLED` and returned to `idle`. |
| 10 | Refresh restores session and current state | Manually verified | Browser reload restored provider catalog, sessions, history, terminal state, and pending/recovered status. Host restart also restored native-locator-backed sessions. |
| 11 | Network interruption reconnects without duplicate terminal events | Automated; live network cut pending | Client reconnect/backoff and sequence-based replay tests pass, including deduplication/reset semantics. Browser refresh and Host restart were verified, but a real private-network interruption was not introduced in this run. |
| 12 | Expired vendor auth only prompts Host re-authentication | Automated | Provider tests map auth failures to `HOST_AUTH_REQUIRED`; login requests/URL elicitations are rejected. A real account-expiry event was not induced. |
| 13 | Plugin calls no vendor login method | Automated | Codex login RPC methods are rejected, Claude URL elicitations are declined, and there is no plugin login UI or login implementation. |
| 14 | DSH remains loopback-bound and docs reject bare public exposure | Manually verified | The real Web Profile printed `http://127.0.0.1:3080`. README and security operations require TLS plus authenticated private access and explicitly prohibit exposing the Harness port directly. |
| 15 | Unload/Host exit leaves no managed Claude/Codex process tree | Automated + manually verified | Provider cleanup tests pass. After real Host shutdown, a process scan found zero Claude/Codex/Node/CMD processes whose command line referenced the isolated DSH install or disposable workspace. |
| 16 | Windows fresh install passes build, tests, Profile loader, and browser E2E | Automated + manually verified | Isolated DSH CLI `0.1.0-rc.7` installed the linked plugin, composed the official bundles, booted the Web Profile, served the Client module, and completed desktop/mobile browser flows. The remote Profile patch disabled `directory-picker` and inserted `directory-picker-browse` plus `ui-directory-picker-browse`; `--dump-config` showed all three rows without a loader name-mismatch warning. |
| 17 | Unsupported versions are blocked explicitly | Automated | Version parsing and admission tests enforce Codex `0.147.x` and Claude Code `2.1.220`; unverified versions require explicit `allowExperimentalVersions`. |
| 18 | README records exact versions, terms, upgrade procedure, and secure deployment prerequisites | Manually verified | README lists the DSH/Codex/Claude/SDK versions, MIT/vendor terms, one-component-at-a-time upgrade validation, loopback binding, TLS, authenticated private access, Host/Origin handling, idle expiry, and access logging. |

## Real browser notes

- The official DSH Loader initially exposed three integration defects that automated component tests did not catch: raw Host decorators in the bundle, a Client Remote injection lifecycle cycle, and a question-schema failure caused by redacting the boolean `secret` field. All are fixed and covered by build or unit tests.
- A final repeated regression exposed a fourth boundary defect: a device-code pattern could redact numeric UUID segments, changing an interaction ID or native locator. UUIDs are now protected during text redaction while standalone device codes remain redacted; the focused core suite passed five consecutive runs before the final full run.
- Mobile layout at 390 x 844 initially overflowed to 612 CSS pixels and left the main panel 54 pixels wide. The responsive layout now remains within 374 CSS pixels and gives both the session pane and main pane the full available width.
- Real Codex and Claude sessions reused the Host's existing login state. No browser login was performed and no credential file, token, cookie, account identity, or OS credential store was read.
- The remote Web Profile's browse picker was exercised from the browser: the test workspace was selected by editing the path in DSH's directory dialog, then registered without opening a Host-native folder chooser. The composed loader used `@deepseek-ai/dsh-host-directory-picker-browse` and `@deepseek-ai/dsh-client-ui-directory-picker-browse`.
- Fake Provider browser flow completed streaming, approval allow, approval deny, question answer, cancellation, and page-refresh replay. Approval denial ended that fixture Turn in the expected provider-start-failed state; it did not persist an allow rule.
- Safe read-only tools may be allowed by the vendor product's existing Host permission policy without generating a prompt. The bridge never synthesizes approval; it displays a decision only when the native product requests one.

## Pending production evidence

- A real interruption of the intended private network or authenticated reverse-proxy path, including duplicate-event checks after reconnection.
- A production gateway deployment proving TLS, authentication, WebSocket forwarding, Host/Origin enforcement, idle expiry, and access logging. The local loopback smoke does not claim this criterion.
- Linux and macOS Host compatibility, multi-user isolation, and RBAC remain out of scope for this Windows single-user MVP.
