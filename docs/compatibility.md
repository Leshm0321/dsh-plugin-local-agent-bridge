# Compatibility and upgrades

## Pinned matrix

| Surface | Version | Policy |
| --- | --- | --- |
| DeepSeek Harness | `0.1.0-rc.7` | External Host + Client plugin APIs validated against commit `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`. |
| Codex CLI/App Server | `0.147.x` | Supported. JSON Schema is pinned to generated `0.147.0` artifacts. |
| Claude Code CLI | `2.1.220` | Supported with SDK `0.3.220`. |
| Claude Agent SDK | `0.3.220` | Exact dependency pin. |
| Node.js | `^22.19.0` or `>=24.0.0` | Matches the target DSH baseline. |
| Windows | 10/11 x64 | Primary validated process model. |

An unparsable version is `unknown`. A parsed version outside the supported range is `unsupported`. Both are blocked unless `allowExperimentalVersions` is explicitly enabled; that option changes admission only and does not suppress protocol validation.

The Claude row is a technical compatibility claim, not an authentication or distribution authorization claim. The current private MVP launches the Host's installed `claude` executable and does not implement login. Anthropic's documented third-party Agent SDK authentication guidance must be reviewed independently before public, commercial, hosted, or multi-user use.

## Codex upgrade

1. Install the target Codex version on an isolated trusted Host.
2. Generate fresh artifacts:

```powershell
codex app-server generate-ts --experimental --out generated/codex/<version>/ts
codex app-server generate-json-schema --experimental --out generated/codex/<version>/schema
```

3. Update imports and the supported range only after reviewing schema differences.
4. Run initialize, thread start/resume, turn start/steer/interrupt, delta, item, approval, question, MCP, unknown notification, connection loss, and login-rejection tests.
5. Run a redacted real three-turn smoke and process-tree cleanup check.

## Claude upgrade

1. Review the Agent SDK release notes, package README license, Anthropic Commercial Terms, and Claude Code compatibility guidance.
2. Upgrade the SDK and CLI together only when their supported pairing is known.
3. Run session creation, `resume`, partial messages, tool projection, `canUseTool`, AskUserQuestion, form elicitation, URL elicitation decline, cancellation, query close, and Windows process cleanup tests.
4. Run a redacted real three-turn smoke before changing the supported version.

## DSH upgrade

Revalidate Cordis service injection, storage domains, workspace registry, Typert descriptors and Remote mounting, Client module loading, slot IDs, bundle/profile manifests, and web module-table externals. DeepSeek Harness is a developer preview and may introduce breaking extension changes.

## Rollback

Keep the previous built checkout or tarball. Disable the bridge row, replace the linked dependency with the previous artifact, run `--dump-config`, and restart the Profile. Bridge records use persistence versioning, but forward migrations are not yet promised across unreviewed plugin versions.
