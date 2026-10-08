# Compatibility and upgrades

## Pinned matrix

| Surface | Version | Policy |
| --- | --- | --- |
| DeepSeek Harness | `0.2.0-rc.2` | External Host + Client plugin APIs targeted at commit `639ed015397290b3745d163aafe02ffee4aa3f84`. Build, typecheck, lint, and the automated suite pass against it, and a booted Web Profile confirmed the panel loads, admits both products, raises and answers an approval, and streams a real turn on each. The first minor step this plugin has followed, and the quietest upgrade of any so far: nothing broke. All 21 dependencies exist at the new version, the cordis foundation set it requires is unchanged from `0.1.7` (`cordis` `4.0.4`, `schemastery` `3.18.4`, `cordis-plugin-include` `1.0.9`), the package set the lockfile reaches is identical, and both typecheck projects report zero errors. `0.2.0` does add a one-time preview notice that opens over the Harness on first load; it is modal, so the first click at the panel's trigger lands on the notice rather than the panel. |
| Codex CLI/App Server | `>=0.147.0 <0.162.0` | Supported. JSON Schema is pinned to generated `0.161.0` artifacts. The range spans several minors because the schemas this bridge reads changed only additively across them: nothing removed, no union variant dropped, and no field newly required. Three shapes moved, none of them under this bridge — `Thread.projectId` became mandatory at `0.153.4`, on responses this bridge never validates; an approval's `cwd` was retyped from `AbsolutePathBuf` to `LegacyAppPathString` at `0.155.1`, both plain strings; and at `0.158.0` an image input stopped requiring `url` outright and became `url` or `fileId`, a widening that leaves the data URL this bridge sends valid. At `0.161.0` the turn error union went from `oneOf` to `anyOf` with a branch accepting any string or object, so an error code this bridge does not know now arrives intact rather than failing validation. The comparison covers what this bridge sends as well as what it reads, and nothing it sends has gained a required field. `0.155.1` also added MCP elicitation modes: `openaiForm` beside `openai/form`, and `openai/userVerification`, which the bridge declines the way it declines a `url` elicitation. `0.147.0`, `0.153.4`, `0.155.1` and `0.158.0` were each run against the real product. `0.161.0` was run only as far as its model service allowed — the real App Server accepted initialize, thread start and turn start, returned a failed turn's completion that validated, and honoured interruption, but the configured upstream stopped answering, so no turn streamed and no approval round-tripped on it. The minors between rest on the comparison alone. |
| Claude Code CLI | `>=2.1.220 <2.2.0` | Patch releases inside 2.1 are admitted; `2.2` requires revalidation. Validated with SDK `0.3.293` against CLI `2.1.293`. |
| Claude Agent SDK | `0.3.293` | Exact dependency pin, kept level with the CLI: the SDK's patch number tracks the CLI's, so `0.3.N` is the build that pairs with `2.1.N`. Letting it drift is what the pairing rule below exists to prevent. Taking a release within a day of its publication means pnpm's minimum-release-age gate has to be told to let it through — nine entries, the SDK and its eight per-platform binaries — which pnpm adds itself when the version is asked for. |
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
