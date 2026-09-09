# Compatibility and upgrades

## Pinned matrix

| Surface | Version | Policy |
| --- | --- | --- |
| DeepSeek Harness | `0.1.2-rc.1` | External Host + Client plugin APIs targeted at commit `a66e4702047846cdaa10c66c9d3df3951f5ea70d`. Build, typecheck, lint, and the automated suite pass against it; the browser and real-product runs recorded in `validation.md` still date from `0.1.0-rc.7`. |
| Codex CLI/App Server | `>=0.147.0 <0.154.0` | Supported. JSON Schema is pinned to generated `0.153.4` artifacts. The range spans two minors because the schemas this bridge reads changed only additively between them: nothing removed, no union variant dropped, and no field newly required. `0.147.0` and `0.153.4` were each run against the real product; the minors between them rest on that comparison alone. |
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
