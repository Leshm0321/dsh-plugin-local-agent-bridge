# Compatibility and upgrades

## Pinned matrix

| Surface | Version | Policy |
| --- | --- | --- |
| DeepSeek Harness | `0.1.6-alpha.1` | External Host + Client plugin APIs targeted at commit `0a15e36e7f82b6ed45af6fa9759f29b40dcd965d`. Build, typecheck, lint, and the automated suite pass against it, and a booted Web Profile confirmed the panel loads, groups its sessions, and still resolves the directory browser. This is the `alpha` tag — a weaker claim than the `rc` line it replaces, taken deliberately. `latest` still points at `0.1.5-rc.1`, which does not resolve into a coherent graph at all: transitive ranges pull `rc.2` regardless. |
| Codex CLI/App Server | `>=0.147.0 <0.156.0` | Supported. JSON Schema is pinned to generated `0.155.1` artifacts. The range spans several minors because the schemas this bridge reads changed only additively across them: nothing removed, no union variant dropped, and no field newly required. Two fields did move, neither in a shape this bridge depends on — `Thread.projectId` became mandatory at `0.153.4`, on responses this bridge never validates, and an approval's `cwd` was retyped from `AbsolutePathBuf` to `LegacyAppPathString` at `0.155.1`, both plain strings. `0.155.1` also added MCP elicitation modes: `openaiForm` beside `openai/form`, and `openai/userVerification`, which the bridge declines the way it declines a `url` elicitation. `0.147.0`, `0.153.4` and `0.155.1` were each run against the real product; the minors between them rest on that comparison alone. |
| Claude Code CLI | `>=2.1.220 <2.2.0` | Patch releases inside 2.1 are admitted; `2.2` requires revalidation. Validated with SDK `0.3.220`. |
| Claude Agent SDK | `0.3.220` | Exact dependency pin. |
| Node.js | `^22.19.0` or `>=24.0.0` | Matches the target DSH baseline. |
| Windows | 10/11 x64 | Validated against the real products. A `.cmd`/`.bat` shim is launched through `cmd.exe`. |
| macOS | 13+ (Intel/Apple silicon) | Validated against the real products. The resolved executable is exec'd directly. |
| Linux | x64/arm64 | Shares the macOS launch path and is covered by the automated per-platform tests; no real-product smoke run yet. |

An unparsable version is `unknown`. A parsed version outside the supported range is `unsupported`. Both are blocked unless `allowExperimentalVersions` is explicitly enabled; that option changes admission only and does not suppress protocol validation.

The Claude row is a technical compatibility claim, not an authentication or distribution authorization claim. The current private MVP launches the Host's installed `claude` executable and does not implement login. Anthropic's documented third-party Agent SDK authentication guidance must be reviewed independently before public, commercial, hosted, or multi-user use.

## Codex upgrade

1. Install the target Codex version on an isolated trusted Host.
2. Generate fresh artifacts:

```sh
codex app-server generate-ts --experimental --out generated/codex/<version>/ts
codex app-server generate-json-schema --experimental --out generated/codex/<version>/schema
```

3. Update imports and the supported range only after reviewing schema differences.
4. Run initialize, thread start/resume, turn start/steer/interrupt, delta, item, approval, question, MCP, unknown notification, connection loss, and login-rejection tests.
5. Run a redacted real three-turn smoke and process-tree cleanup check.

## Claude upgrade

1. Review the Agent SDK release notes, package README license, Anthropic Commercial Terms, and Claude Code compatibility guidance.
2. Upgrade the SDK and CLI together only when their supported pairing is known.
3. Run session creation, `resume`, partial messages, tool projection, `canUseTool`, AskUserQuestion, form elicitation, URL elicitation decline, cancellation, query close, and process cleanup tests on each Host platform you support.
4. Run a redacted real three-turn smoke before changing the supported version.

## DSH upgrade

Revalidate Cordis service injection, storage domains, workspace registry, Typert descriptors and Remote mounting, Client module loading, slot IDs, bundle/profile manifests, and web module-table externals. DeepSeek Harness is a developer preview and may introduce breaking extension changes.

## Rollback

Keep the previous built checkout or tarball. Disable the bridge row, replace the linked dependency with the previous artifact, run `--dump-config`, and restart the Profile. Bridge records use persistence versioning, but forward migrations are not yet promised across unreviewed plugin versions.
