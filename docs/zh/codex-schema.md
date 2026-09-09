# Codex App Server schema 来源

`generated/codex/0.153.4/schema/` 下的 JSON Schema 文件，由主机上安装的 Codex CLI `0.153.4` 通过实验性的 App Server 生成器产出：

```sh
codex app-server generate-ts --experimental --out generated/codex/0.153.4/ts
codex app-server generate-json-schema --experimental --out generated/codex/0.153.4/schema
```

适配器导入这份生成的 JSON Schema，用作浏览器可见的 Codex 通知与请求白名单。投影之前先由 Ajv 校验载荷。未知通知被忽略，未知的 Server Request 被拒绝；所有 `account/login/*` 请求在路由之前就被拒掉。

生成的 TypeScript 产物作为开发依据保留，但不出现在插件对外的声明面上。生成的 schema 与版本绑定：放宽支持的 Codex 版本范围之前，必须重新生成并逐项审阅。

Codex 源码与生成的协议产物属于 OpenAI Codex 项目，以 Apache-2.0 分发。本插件不分发 Codex 可执行文件。
