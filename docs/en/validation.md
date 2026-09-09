# Validation

## Automated commands

Run from the project root on Windows, macOS, or Linux:

```sh
pnpm run build       # host + client bundles and declarations
pnpm run typecheck   # host and client projects
pnpm run lint
pnpm test
pnpm pack --dry-run
```

`pnpm run check` runs all five in order.

The automated run covers redaction, opaque UUID stability, version admission,
provider health projection, the launch form for all three Host platforms, strict
Typert schemas, Profile browse-picker composition, three-turn streaming,
queueing, approvals, questions, cancellation (including a product that reports
its interruption without a cancellation marker), replay reset, persistence
recovery, Codex App Server lifecycle and login rejection, Claude SDK
resume/streaming/interactions/cancellation, Client create/poll/respond/reconnect
behavior, bilingual rendering against the shipped dictionaries, unavailable-product
diagnostics, in-panel working-directory
ownership and its opt-in Harness publishing, directory-capability probing and its two
fallbacks, the stylesheet's theme-token and scoping guarantees, the command palette across both
products' invocation syntaxes, resuming a product-native session, the
composer's keyboard including input-method composition, permission-mode mapping
per product, expandable tool detail, context usage, and file-search confinement
against real symlinks.

## Real-product smoke checklist

Run only on a trusted Host already logged in to the vendor products, from the
same shell environment that will start DSH. Use a disposable test workspace
without confidential source.

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

On macOS and Linux the managed child is the resolved executable itself, so step 9
is a check that DSH has no surviving children:

```sh
pgrep -P "$(pgrep -f 'dsh web' | head -1)"
```

On Windows the child is `cmd.exe` wrapping the shim, so inspect the tree rather
than a single process name.

Do not record real account identity, tokens, private source, full prompts, command lines containing private data, or model output containing company information.

## Browser zero-login evidence

Capture a browser trace through the full fake-provider flow and assert:

- No request host matches Anthropic, Claude, OpenAI, ChatGPT, or vendor API domains.
- Local storage, session storage, IndexedDB, cookies, downloads, DOM text, and Remote frames contain no credential canary.
- No login button, token field, OAuth URL, or device code is present.
- DSH is reached only through the approved authenticated access path.

## Acceptance matrix

Validation below was first run on Windows with DSH CLI `0.1.0-rc.7`, Codex
`0.147.0`, Claude Code `2.1.220`, and Claude Agent SDK `0.3.220`.

It was then re-run on macOS (Apple silicon, Node 26) with DSH CLI `0.1.0-rc.7`,
Claude Code `2.1.234`, and Codex `0.147.0`, covering plugin install into the
built-in `web` Profile, loader composition, Client module delivery, provider
discovery, the Fake Provider flow end to end, real Claude Code sessions through
streaming, a real `Write` approval, cancellation and page-refresh recovery, and a
real Codex session over `codex app-server --stdio`.

That run began with Codex `0.144.6` installed, which was correctly refused as
`unsupported` with both the installed version and the admitted range named in the
panel. After upgrading to `0.147.0` on the Host, the browser's Refresh button
alone moved it to `ready` and a session started on it — no Profile restart, which
is what the Startup section has always told the operator to expect.

In both runs the DSH Web Profile remained bound to `127.0.0.1:3080`, telemetry
was disabled, and all sessions used a disposable validation workspace holding no
confidential source. Reports retain only generic success facts.

| # | PRD criterion | Status | Evidence |
|---:|---|---|---|
| 1 | No Anthropic/OpenAI login entry in the browser | Automated + manually verified | Client source/DOM control scans pass. The real `Local Agents` dialog contains no login, OAuth, device-code, API-key, or token control. A fresh DOM scan found 29 controls and zero login-like controls. The separate DSH core model-configuration dialog is not part of this plugin. |
| 2 | Browser E2E network record contains no vendor-domain request | Manually verified | A fresh CDP capture across reload, plugin boot, catalog, session replay, and a Fake Provider turn recorded 94 requests; every HTTP request targeted `127.0.0.1:3080`, including `dsh-plugin-local-agent-bridge/client.js` and `localAgentBridge/*`, with zero Anthropic, Claude, OpenAI, or ChatGPT URLs. |
| 3 | Browser and Remote Payload contain no vendor credential or auth-file content | Automated | Credential canaries are scanned across Remote events, persistence, rendered DOM, browser-request spies, browser storage fixtures, cookies, and downloads. All canaries and credential markers are absent. No real credential store was inspected. |
| 4 | Claude/Codex start from Host-installed executables | Automated + manually verified | Discovery/version tests pass, and the launch form is pinned for Windows, macOS, and Linux from any host. Real browser sessions on both Windows and macOS launched the installed `codex app-server --stdio` path and the official Claude Agent SDK configured with the installed Host `claude` executable. On macOS the managed child was observed as the resolved executable itself — `/Users/…/.local/bin/claude --output-format stream-json … --permission-prompt-tool stdio --resume=…` — confirming the Host PATH resolution, the captured native locator, and the stdio approval channel. |
| 5 | Both providers create sessions and sustain at least three turns | Manually verified | Codex completed three continuous turns plus cancellation. Claude completed multiple continuous turns including resume after Host restart, tool use, AskUserQuestion, and cancellation. |
| 6 | Text is displayed incrementally | Automated + manually verified | Provider integration tests assert delta projection. Fake Provider and real Claude runs produced multiple text deltas; Claude deltas now share one stable turn-level item ID so one answer renders as one streaming row. |
| 7 | Browser can approve or reject at least one real tool request | Manually verified | A real Claude `Write` request in the disposable workspace entered `awaiting-approval`; `Allow once` completed the tool. Fake Provider and provider integration tests also cover allow, deny, and cancel resolutions. |
| 8b | Browser can continue a session the product already has | Automated + manually verified | The picker lists what the product enumerates for the workspace; the real Claude Code listing showed a session started in a terminal, with no transcript path in the rendered panel. Resume was proven end to end: a session told to remember a token through one bridge session was continued through a second one that had never been told, and answered with the token. `includeProgrammatic: false` was confirmed to hide bridge-created sessions — 1 session with the flag on, 0 with it off, in a directory holding only those. |
| 8a | Browser can invoke each product's own commands and skills | Automated + manually verified | Typing `/` lists what the product reports: 57 entries from real Claude Code (after its first turn, since the SDK exposes them only on a live query) and 44 from real Codex `0.147.0` (immediately, using the session's workspace directory). Insertion uses each product's own syntax — `/name` for Claude Code, `namespace:skill` for Codex — and the bridge executes nothing itself. MCP servers are listed as non-invocable inventory. Codex reports an absolute `SKILL.md` path per skill; it is dropped on the Host and confirmed absent from the rendered panel. |
| 8 | Browser can answer Claude AskUserQuestion; Codex equivalent when supported | Automated + manually verified | A real Claude AskUserQuestion displayed Alpha/Beta options, accepted the browser answer, and completed the turn. Codex request-user-input and MCP form mappings are covered by protocol tests; the tested Codex model answered a requested choice in text instead of invoking the optional tool. |
| 9 | Running turns can be cancelled and managed work stops | Automated + manually verified | Fake, real Codex, and real Claude turns all move through `cancelling` to `USER_CANCELLED` and return to `idle`, and the managed child is gone afterwards. The macOS run initially surfaced `PROVIDER_START_FAILED` here: the abort signal was authoritative but the reported code came from pattern-matching an SDK message that carries no cancellation marker. Fixed, and pinned by a provider double whose interruption is deliberately opaque. |
| 10 | Refresh restores session and current state | Manually verified | Browser reload restored provider catalog, sessions, history, terminal state, and pending/recovered status. Host restart also restored native-locator-backed sessions. |
| 11 | Network interruption reconnects without duplicate terminal events | Automated; live network cut pending | Client reconnect/backoff and sequence-based replay tests pass, including deduplication/reset semantics. Browser refresh and Host restart were verified, but a real private-network interruption was not introduced in this run. |
| 12 | Expired vendor auth only prompts Host re-authentication | Automated | Provider tests map auth failures to `HOST_AUTH_REQUIRED`; login requests/URL elicitations are rejected. A real account-expiry event was not induced. |
| 13 | Plugin calls no vendor login method | Automated | Codex login RPC methods are rejected, Claude URL elicitations are declined, and there is no plugin login UI or login implementation. |
| 14 | DSH remains loopback-bound and docs reject bare public exposure | Manually verified | The real Web Profile printed `http://127.0.0.1:3080`. README and security operations require TLS plus authenticated private access and explicitly prohibit exposing the Harness port directly. |
| 15 | Unload/Host exit leaves no managed Claude/Codex process tree | Automated + manually verified | Provider cleanup tests pass. After real Host shutdown, a process scan found zero Claude/Codex/Node/CMD processes whose command line referenced the isolated DSH install or disposable workspace. |
| 16 | A fresh install passes build, tests, Profile loader, and browser E2E | Automated + manually verified | Verified on Windows and on macOS. On both, DSH CLI `0.1.0-rc.7` installed the linked plugin, composed the official bundles, booted the Web Profile, served the Client module, and completed browser flows; Windows also covered mobile layout. The remote Profile patch disabled `directory-picker` and inserted `directory-picker-browse` plus `ui-directory-picker-browse` on both, with `--dump-config` showing all three rows and no loader name-mismatch warning. The launch form for Windows, macOS, and Linux is additionally pinned by unit tests that run on any host. |
| 17 | Unsupported versions are blocked explicitly | Automated + manually verified | Version parsing and admission tests enforce Codex `>=0.147.0 <0.154.0` and Claude Code `>=2.1.220 <2.2.0`; unverified versions require explicit `allowExperimentalVersions`. The macOS run confirmed a real Codex `0.144.6` being refused. A rejected product is also *shown* as rejected: it stays listed but unselectable, and the panel names both the installed version and the admitted range. Previously the Client dropped every non-ready product, so the operator watched it vanish with no explanation. |
| 18 | README records exact versions, terms, upgrade procedure, and secure deployment prerequisites | Manually verified | README lists the DSH/Codex/Claude/SDK versions, MIT/vendor terms, one-component-at-a-time upgrade validation, loopback binding, TLS, authenticated private access, Host/Origin handling, idle expiry, and access logging. |

## Codex 0.153.4 and Claude Code 2.1.266

The Host was upgraded to Codex `0.153.4` and Claude Code `2.1.266`, and the Codex
schema pin moved to `0.153.4`. What was checked on those versions, against the real
products through a booted Web Profile:

- Codex: session create, a streamed reply, a `shell` tool call with its arguments
  rendered, and image input — a solid-red raster pasted into the composer came back
  named, so the model reads the data URL rather than merely tolerating the field.
- Claude Code: session create and a `Bash` tool call, on the pinned Agent SDK
  `0.3.220`. The SDK's own latest was `0.3.266` at the time and was not adopted.
- The schemas were compared rather than assumed: no message removed, no union
  variant dropped, and — matching unions by discriminator rather than by position —
  no field newly required anywhere this bridge reads. `Thread.projectId` did become
  mandatory, on responses this bridge never validates.

Not re-run on these versions: Codex-side approval and question prompts, steer,
interrupt, MCP, connection loss, and login rejection. The minors between `0.147.0`
and `0.153.4` were not run at all and are admitted on the schema comparison alone.

## Real browser notes

- The official DSH Loader initially exposed three integration defects that automated component tests did not catch: raw Host decorators in the bundle, a Client Remote injection lifecycle cycle, and a question-schema failure caused by redacting the boolean `secret` field. All are fixed and covered by build or unit tests.
- A final repeated regression exposed a fourth boundary defect: a device-code pattern could redact numeric UUID segments, changing an interaction ID or native locator. UUIDs are now protected during text redaction while standalone device codes remain redacted; the focused core suite passed five consecutive runs before the final full run.
- Mobile layout at 390 x 844 initially overflowed to 612 CSS pixels and left the main panel 54 pixels wide. The responsive layout now remains within 374 CSS pixels and gives both the session pane and main pane the full available width.
- Real Codex and Claude sessions reused the Host's existing login state. No browser login was performed and no credential file, token, cookie, account identity, or OS credential store was read.
- The remote Web Profile's browse picker was exercised from the browser: the test workspace was selected by editing the path in DSH's directory dialog, then registered without opening a Host-native folder chooser. The composed loader used `@deepseek-ai/dsh-host-directory-picker-browse` and `@deepseek-ai/dsh-client-ui-directory-picker-browse`.
- Fake Provider browser flow completed streaming, approval allow, approval deny, question answer, cancellation, and page-refresh replay. Approval denial ended that fixture Turn in the expected provider-start-failed state; it did not persist an allow rule.
- Model selection was proven end to end against both real products. In Codex the picker listed five real models from `model/list`; selecting `GPT-5.6-Sol` and effort `high` made the product answer `gpt-5.6-sol` and the context window change from 1.0M to 258k. In Claude Code the picker was correctly inert before the session's first turn — a product that supports selection but cannot yet be asked — then listed Default/Opus/Fable/Sonnet/Haiku; selecting Haiku made the product report `claude-haiku-4-5-20251001` with a 200k window. The selection survived a Host restart. Effort levels follow each product: `GPT-5.6-Sol` offers six including Codex's own `ultra`, which the panel shows verbatim because it has no word for it, while Haiku 4.5 offers none and the panel shows none.
- Quota shows nothing on this Host, which is the correct rendering: the account is API-key based, so Claude Code emits no `rate_limit_event`, and Codex's `account/rateLimits/read` answers `chatgpt authentication required to read rate limits`. Both paths are exercised by unit tests with reported figures.
- The composer's file button listed the working directory's files and folders, inserted `@notes/` with its trailing slash for a directory and `@README.md` for a file, and accumulated both in one draft.
- Dictation appeared in Chrome, with the audio-upload caveat on hover, and is absent under jsdom — the feature detection is a real gate, not a stub.
- A real defect surfaced only in a browser measurement: the context meter's fill is a `<span>` inside a non-flex parent, so it was an inline box, and an inline box ignores the inline width the percentage arrives as. The bar had rendered permanently empty in every theme and session since it was written; text-only verification had missed it, and jsdom computes no layout. Fixed, and pinned by a stylesheet guard that requires a display declaration on any class sized inline.
- Uploading from the browser was proven end to end in Chrome against real Codex. Two files were sent, one deliberately named `../../../../escaped.txt`; both landed inside `.dsh-bridge-uploads/` with the traversal rebuilt away, and the parent directories were confirmed empty. The agent then ran `cat .dsh-bridge-uploads/from-browser.txt` of its own accord and quoted the contents back exactly.
- A browser check caught a defect the unit tests had stepped around: `webkitdirectory` was being set in a mount-time effect, but the input only exists while the upload tab is open, so the folder button opened a plain file chooser. The test had selected the plain input by `:not([webkitdirectory])`, which passed either way. Both are fixed — the attribute is keyed to the visible tab, and the test now asserts that exactly one of the two inputs carries it.
- The panel's popovers were not dismissible by clicking away, which the permission-mode menu had shared since it was written. All three now use the Harness's own `useDismissOnOutsidePointer` and close on Escape, asserted for each.
- The composer's status line was checked against the repository it was reading. The panel showed `master +473 −14 no upstream`; `git diff --numstat HEAD` summed to exactly `+473 −14`, and this repository genuinely has no remote, so git omits the `branch.upstream` header rather than reporting an empty one. Token spend after a real Claude turn read `24k total`, with `10 input / 29 output / 24k cache read / 415 cache write` on hover — figures consistent with a short exchange against a warm cache.
- Loading a resumed session's transcript was verified against both products in Chrome. Codex returned 7 entries for a validation thread — 3 user messages and 4 agent messages, exactly what `thread/read` reports, since its rollout history carries no tool calls. Claude Code returned 240 entries including 154 expandable tool rows, with the rule reading "earlier entries were not loaded". Three defects surfaced only here and only against a real, long transcript: the first version truncated from the front, so a 977-message session showed its opening — one user message followed by a hundred tool calls — instead of the recent conversation; the adapter's own trimming was invisible to the engine, so the panel said "240 entries" rather than "earlier ones were not loaded"; and a user message sent with an image arrives as content blocks rather than a string, so every illustrated message was silently dropped. All three are fixed, and each is pinned by a test.
- A methodology note worth recording: two verification passes read a *previous* bridge session, whose history had already been written by the older code, and appeared to show the fix not working. History events persist like any other, so a resumed session must be created fresh to test a change to the projection. The third pass archived every session first.
- The reasoning-effort slider was checked against a model with six levels: `min=0 max=5 step=1`, `aria-valuetext` reading the level's name rather than its index, six stops drawn, and the rightmost position selecting Codex's own `ultra`. Its stops were invisible at first — an overlay blend disappears on this theme's near-black accent — and now use a difference blend, which reads on both halves of the track.
- The sidebar toggle moved to the titlebar's left, on the side it acts on. Collapsed, the rail switches sessions rather than offering a second button that reopened the panel it sat in: 52px aside, 1108px main, and a session switched without expanding.
- Browsing the Host filesystem was proven end to end against real Codex. The composer's third route listed `/Users/mac` (13 directories), then `dsh-bridge-validation`, where it showed the three *files* the Harness's own picker reports as "no subdirectories" — which is why this is implemented here rather than delegated to `workspaces.listDirectory`. Picking one inserted `@/Users/mac/dsh-bridge-validation/bridge-check.txt`, and the agent ran `cat -- /Users/mac/dsh-bridge-validation/bridge-check.txt` of its own accord and quoted the contents.
- Message contrast: the operator's message was a 5% tint at 92% width against a white card, which is a difference you have to look for. It is now 10% at 78%, the label takes the stronger ink, and the agent's card carries a visible edge — three signals where one was not enough.
- The font stack was corrected for Windows readers, and the correction is reasoned rather than verified: this run is macOS-only, so no Windows rendering was observed. Two objective faults were fixed. `Helvetica Neue` sat ahead of `Segoe UI`, and it is present on many Windows machines because Adobe installers put it there — so Latin text rendered in a print face under ClearType while the Chinese in the same sentence fell through to YaHei. And the newer faces were absent: Windows 11 ships `Segoe UI Variable`, `Microsoft YaHei UI` is the interface cut, and the mono stack had no `Cascadia Mono` or `Consolas`, falling through to Courier New. Confirmed on macOS that the stack still resolves to `-apple-system` first and that `Helvetica Neue` is gone.
- Streaming was measured rather than assumed. Sampling the DOM every 80ms during a real Codex turn showed four distinct updates, one of them 346 characters at once: the Host relays every delta immediately, but a long poll delivers whatever accumulated during a round trip, and each delta was repainting the whole timeline. After separating arrival from display and memoizing the rows, the same prompt produced ten updates of 20–100 characters each, with a visible catch-up when a batch landed.
- The trace view was checked against a real Codex turn, and the first version of it was wrong in a way only real data showed. It reported "model 11ms · tools 1ms · 7636 tok/s" for a turn that took 2m18s and produced 84 output tokens. The events had all arrived in the turn's final three seconds, and the shell command's start and completion were stamped 1ms apart — so the timestamps record when the product chose to report, not when it worked. The model/tool split and the per-step duration were removed rather than kept with a caveat; the view now states when each step was reported, and rates output tokens over turn duration, which the bridge stamps itself. Duration also excludes idle time, bounded by turn start and completion rather than by gaps between events: a gap-based rule scored a model reasoning silently as idle, and a first-to-last measurement of a session left open overnight read `4262m40s`.
- Markdown rendering was verified against a real Codex answer: a level-2 heading, a two-column table with inline code in its cells, and a bullet list with bold text all became real elements, with no literal asterisks or pipes left in the card. The renderer produces React elements only, which the tests assert by feeding it `<img onerror>`, `<script>` and `<b>` and confirming none becomes an element.
- A layout defect was found by measuring, not by looking: the view tabs overlapped the transcript because `.lab-main` is a three-row grid — toolbar, body, composer — and the tabs plus a second view were added as extra grid children, so two landed in the same row. They are now nested in one flex column child, and the tab's own centre point was confirmed to hit the tab rather than something drawn over it.
- Turn grouping was verified across a real Codex turn's whole life. While running, the summary read `processed 31s · 1 step`, expanded, counting up to `1m52s`; on completion it became `processed in 2m19s · 4 steps`, folded, leaving exactly three things in the transcript — the question, the summary chip, and the answer. Expanding restored the opening remark and three shell calls in the order they happened, and folding again removed them. A defect surfaced on the way: a turn with no answer yet had `foldable` gated on the answer existing, so its work was both collapsed and un-expandable — visible as tool rows that had vanished with no way to get them back.
- Pasting an image was proven end to end against real Codex, with the picture as the evidence rather than the plumbing: a canvas-drawn PNG reading `BRIDGE-IMG-7431` was pasted into the composer, and the agent answered `BRIDGE-IMG-7431`. It reached the model as image input, not as a file reference. The thumbnail appeared while pending and cleared on send, the message row read `sent · 1 image`, and the PNG landed in `.dsh-bridge-uploads/` at its real dimensions. Codex's acceptance of a data URL was verified against 0.147.0 before relying on it, since the schema only types the field as a string.
- The side panel was verified against this repository as the workspace: the body became three columns (288px / 452px / 420px), the tree listed directories before files with sizes, `src` was read only when opened, and `src/types.ts` rendered with 824 line numbers and seven token kinds — keywords at #cf222e and comments at #6e7781, confirming the palette resolves rather than falling through. Confinement is asserted against real symlinks in `tests/unit/workspace-files.spec.ts`, including one pointing outside the workspace, since this reads file contents where the host browser does not.
- Two guards were found to be scoped to `index.tsx` alone, which a split-out component silently defeats: the primitives stub check let `IconFolderOpen16` through as an "undefined is not a component" failure, and the stylesheet check had the same blind spot. Both now scan every client JSX file. Separately, an unscoped `.hljs-keyword` rule would have recoloured every highlighted block in the surrounding Harness — the selector guard caught it, and the rules are now scoped under the viewer.
- File writes were verified end to end in a disposable workspace, including the case that matters most. A file was created, opened, edited and saved — the bytes landing on disk correctly — then modified from outside while the editor still held it. The save was refused, the operator's text stayed in the editor, the viewer switched to the newer file, and **the external change survived untouched**. Create, rename and delete were each driven through the tree and left no residue. A defect surfaced on the way: `rm` refuses a directory without `recursive: true`, and passing that would have been exactly the recursive delete being avoided — `rmdir` is correct and fails on a non-empty directory by itself.
- The stale-write detection was rewritten during verification. It matched on the failure's error code, which is the *transport's* code and not the Host's `BridgeError` code, so the explanation never appeared. It now re-reads the file and compares revisions, which answers the actual question — did this move underneath us — without depending on how the carrier names its errors.
- The diff tab was verified against a real git repository created for the purpose. `sample.js +2 −1` and an untracked file were listed from git's own numstat and status. Unified showed the removal at old line 3 and the two additions at new lines 3 and 4, with context numbered correctly on both sides. Side by side paired the removal with the addition that replaced it on one row and left exactly one empty cell for the surplus addition — the rendering that says "one line changed, one line added" rather than "two unrelated edits".
- The two animations that are not CSS were measured, not eyeballed. Toggling a fold on a real Claude transcript whose work rows are 12,800px tall held a 8.4ms median frame against an 8.3ms idle baseline on a 120Hz display, with two frames over 24ms — both at the start, and both the React mount of the rows rather than the tween, so no height ceiling was needed. The side panel's open tween walked `--lab-side-width` from 0 to 419px and cleared it; its collapse jumped straight to 0. That was a real defect with a real cause: a custom property set only inline has no computed value left to animate *from* once the opening tween cleared it, so GSAP found nothing to parse. The collapse now states its own start, except when it interrupts an opening tween. Fold and panel both land in the state the stylesheet describes, with every inline style cleared.
- Scroll anchoring was checked and deliberately not changed. Expanding a 12,800px fold moves everything below the toggle, which is correct: you cannot click a toggle you cannot see, so nothing above the viewport ever moves.
- - The panel's lock was proven against `/api` directly, because that is the only proof that matters: a password screen the transport does not enforce is one `curl` away from nothing. With a password set, `catalog`, `sessionsList` and `hostList` were each refused both with an empty token and with a fabricated one — no provider list, no session list, no Host directory listing. Rate limiting was measured the same way: five wrong guesses each cost ~0.15s of scrypt, and the sixth was refused in 0.06s, before the hash ran, with `lockedOutUntil` 30s out; the correct password was refused too while that stood. A Host restart then showed the designed split — `configured: true`, `unlocked: false`, lockout cleared — after which the right password returned a 43-character token that carried `catalog` (2 products), `sessionsList` (6 sessions) and `hostList` (65 entries).
- Three defects surfaced only in a real browser, and one of them was a fail-open. The lock's first state read ran during plugin boot, before the Remote face was mounted, and threw; unhandled, the rejection escaped into the boot chain and stopped the mount from finishing, so every later call reported "no longer mounted". Worse, `locked` had treated an unknown state as unlocked, so the panel rendered itself while the Host was refusing everything — protection that looked absent to the operator and present to nobody. The read now cannot throw, "unknown" is its own state that renders neither the panel nor a password field, and a retry covers the boot race. Second: the token-injecting proxy forwarded `receiver` to `Reflect.get`, and the face it wraps is itself a Proxy that resolves methods against its own mount table — so every proxied call looked the method up on the wrong object while the raw face worked. Third: the panel's catalog load and its long poll both ran while locked, failed, and left a sticky error with nothing to retry them; both are now keyed to the token, which makes unlocking the retry.
- The Harness-wide half of the request was established as impossible for a plugin rather than merely hard, by reading `dsh-host-webserver`: it offers `register` (duplicate path throws, and "registration order does not affect requests"), `registerUpgrade` (duplicate throws), `registerFallback` (single owner, already the SPA's, second registration throws) and `tapIndex`. There is no middleware seat, and the browser transport is a `prefix` route at `/api` owned by `dsh-client-connection` plus two WebSocket upgrades. Shadowing it with a longer prefix would work mechanically and was rejected: there is no reference to the original handler to forward to, and it would break on any DSH version. A reverse-proxy recipe was shipped instead.
- Safe read-only tools may be allowed by the vendor product's existing Host permission policy without generating a prompt. The bridge never synthesizes approval; it displays a decision only when the native product requests one.

## Pending production evidence

- A real interruption of the intended private network or authenticated reverse-proxy path, including duplicate-event checks after reconnection.
- A production gateway deployment proving TLS, authentication, WebSocket forwarding, Host/Origin enforcement, idle expiry, and access logging. The local loopback smoke does not claim this criterion.
- A real-product smoke run on a Linux Host. Linux shares the macOS launch path
  and is covered by the automated per-platform tests, but no session has been
  driven against the real products there.
- Multi-user isolation and RBAC remain out of scope for this single-user MVP.
