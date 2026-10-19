# Compatibility and upgrades

## Pinned matrix

| Surface | Version | Policy |
| --- | --- | --- |
| DeepSeek Harness | `0.2.1-rc.2` | External Host + Client plugin APIs targeted at commit `687f282e8625c6b8d11ff58211a90524be2e4317`. Build, typecheck, lint, and the automated suite pass against it, and a booted Web Profile confirmed the panel opens, draws every icon, admits both products, and streams and refuses on Claude Code. One break, in the build rather than the plugin: `dsh-typert-generator`'s tsdown plugin now locates its workspace root by requiring both `tsconfig.host.json` and a `packages/` directory — the Harness monorepo's own layout — and throws in a standalone repository like this one, with no option to name the root. Its `writeBundle` step never emitted anything here (it stops at the root while looking for a package below `lib/`), so `tsdown.host.config.ts` keeps the plugin's decorator-lowering transform and drops that step; the output was compared file for file against a `0.2.0` build with the full plugin and is identical, 45 files. The release requires the cordis foundation set it was built against, now stable releases rather than the alphas `0.2.1` first shipped with: `cordis` `4.0.5`, `schemastery` `3.18.5`, `cordis-plugin-include` `1.0.10`, which bring `cordis-plugin-loader` `1.0.6` and `cordis-plugin-group` `1.0.5` with them. |
| Codex CLI/App Server | `>=0.147.0 <0.164.0` | Supported. JSON Schema is pinned to generated `0.163.0` artifacts. The range spans several minors because the schemas this bridge reads changed only additively across them: nothing removed, no union variant dropped, and no field newly required. Three shapes moved, none of them under this bridge — `Thread.projectId` became mandatory at `0.153.4`, on responses this bridge never validates; an approval's `cwd` was retyped from `AbsolutePathBuf` to `LegacyAppPathString` at `0.155.1`, both plain strings; and at `0.158.0` an image input stopped requiring `url` outright and became `url` or `fileId`, a widening that leaves the data URL this bridge sends valid. At `0.161.0` the turn error union went from `oneOf` to `anyOf` with a branch accepting any string or object, so an error code this bridge does not know now arrives intact rather than failing validation. The comparison covers what this bridge sends as well as what it reads, and nothing it sends has gained a required field; `0.163.0` added `parentTurnId` and `rootTurnId` to `turn/start`, both optional, and gave a listed skill's `path` the same string retype as `cwd`, on a field this bridge does not keep. `0.155.1` also added MCP elicitation modes: `openaiForm` beside `openai/form`, and `openai/userVerification`, which the bridge declines the way it declines a `url` elicitation. `0.147.0`, `0.153.4`, `0.155.1` and `0.158.0` were each run against the real product. `0.161.0` was run only as far as its model service allowed — the real App Server accepted initialize, thread start and turn start, returned a failed turn's completion that validated, and honoured interruption, but the configured upstream stopped answering, so no turn streamed and no approval round-tripped on it. `0.163.0` got less: the same upstream neither answered nor failed, so the real App Server accepted initialize, thread start and turn start and honoured interruption, and no turn reached completion on it at all. The minors between rest on the comparison alone. |
| Claude Code CLI | `>=2.1.220 <2.2.0` | Patch releases inside 2.1 are admitted; `2.2` requires revalidation. Validated with SDK `0.3.303` against CLI `2.1.303`. |
| Claude Agent SDK | `0.3.303` | Exact dependency pin, kept level with the CLI: the SDK's patch number tracks the CLI's, so `0.3.N` is the build that pairs with `2.1.N`. Letting it drift is what the pairing rule below exists to prevent. Taking a release within a day of its publication means pnpm's minimum-release-age gate has to be told to let it through — nine entries, the SDK and its eight per-platform binaries — which pnpm adds itself when the version is asked for. |
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
