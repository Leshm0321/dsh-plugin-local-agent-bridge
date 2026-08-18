# Codex App Server schema provenance

The JSON Schema files under `generated/codex/0.147.0/schema/` were generated from the Host-installed Codex CLI `0.147.0` with the experimental App Server generators:

```sh
codex app-server generate-ts --experimental --out generated/codex/0.147.0/ts
codex app-server generate-json-schema --experimental --out generated/codex/0.147.0/schema
```

The adapter imports the generated JSON Schema for the browser-visible allowlist of Codex notifications and requests. Ajv validates those payloads before projection. Unknown notifications are ignored; unknown Server Requests are rejected. Every `account/login/*` request is rejected before routing.

The generated TypeScript output is retained as development evidence but is not exposed through the plugin's public declaration surface. The generated schema is version-bound and must be regenerated and reviewed before widening the supported Codex range.

Codex source and generated protocol artifacts are associated with the OpenAI Codex project, distributed under Apache-2.0. This plugin does not distribute a Codex executable.
