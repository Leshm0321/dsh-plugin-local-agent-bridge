# 兼容性与升级

## 锁定矩阵

| 面 | 版本 | 策略 |
| --- | --- | --- |
| DeepSeek Harness | `0.1.6-alpha.2` | 对外的 Host 与 Client 插件 API 面向提交 `ddefc45fbc7f8e46dd73185e68295696d1297887`。构建、类型检查、lint 与自动化测试套件在其上全部通过，并且真实启动过一个 Web Profile 确认面板加载、会话分组、目录浏览仍能解析。这是 `alpha` 标签 —— 比它下面那条 `rc` 线是更弱的保证，属于有意选择：`latest` 与 `next` 都停在 `0.1.5-rc.2`，落后一个 minor。这一版在本插件用到的面上只带来一处破坏性改动：`TypertCodec` 的 `schema` 字段变成了 `create()` 工厂。 |
| Codex CLI / App Server | `>=0.147.0 <0.156.0` | 支持。JSON Schema 锁定在生成自 `0.155.1` 的产物上。范围跨了好几个 minor，因为本桥读取的那些 schema 在其间只有加法：没有删除、没有丢弃联合分支、没有新增必填字段。确实动了两个字段，但都不在本桥依赖的形状上 —— `Thread.projectId` 在 `0.153.4` 变为必填，位于本桥从不校验的响应上；审批里的 `cwd` 在 `0.155.1` 从 `AbsolutePathBuf` 改写为 `LegacyAppPathString`，两者都是普通字符串。`0.155.1` 还新增了 MCP 征询模式：`openai/form` 旁边多了 `openaiForm`，以及 `openai/userVerification` —— 后者本桥按拒绝 `url` 征询的同一套办法拒绝。`0.147.0`、`0.153.4`、`0.155.1` 各自对真实产品跑过；它们之间的 minor 仅凭这份对比准入。 |
| Claude Code CLI | `>=2.1.220 <2.2.0` | 准许 2.1 之内的补丁版本；`2.2` 需要重新验证。以 SDK `0.3.220` 验证。 |
| Claude Agent SDK | `0.3.220` | 精确锁定的依赖。 |
| Node.js | `^22.19.0` 或 `>=24.0.0` | 与目标 DSH 基线一致。 |
| Windows | 10/11 x64 | 已针对真实产品验证。`.cmd`/`.bat` 垫片经 `cmd.exe` 启动。 |
| macOS | 13+（Intel / Apple silicon） | 已针对真实产品验证。解析出的可执行文件直接 exec。 |
| Linux | x64/arm64 | 与 macOS 共用启动路径，被各平台的自动化测试覆盖；尚未做过真实产品的冒烟。 |

解析不出的版本记作 `unknown`。能解析但落在支持范围之外的记作 `unsupported`。除非显式打开 `allowExperimentalVersions`，两者都被拦下；这个选项只改变准入，不会关掉协议校验。

Claude 那一行是技术兼容性声明，不是关于认证或分发授权的声明。当前这个私用 MVP 启动的是主机上已安装的 `claude` 可执行文件，本身不实现登录。在公开、商用、托管或多用户使用之前，必须独立审阅 Anthropic 关于第三方 Agent SDK 认证的书面指引。

## 升级 Codex

1. 在一台隔离的可信主机上安装目标 Codex 版本。
2. 重新生成产物：

```sh
codex app-server generate-ts --experimental --out generated/codex/<version>/ts
codex app-server generate-json-schema --experimental --out generated/codex/<version>/schema
```

3. 只有在审阅过 schema 差异之后，才更新导入和支持范围。
4. 跑一遍这些测试：initialize、thread 启动与恢复、turn 的 start/steer/interrupt、delta、item、审批、提问、MCP、未知通知、连接断开、登录拒绝。
5. 跑一次脱敏后的真实三轮对话冒烟，并检查进程树是否清理干净。

## 升级 Claude

1. 审阅 Agent SDK 的发布说明、包 README 里的许可、Anthropic 商业条款，以及 Claude Code 的兼容性指引。
2. 只有在已知 SDK 与 CLI 的配对关系时，才把两者一起升级。
3. 在你支持的每个主机平台上，跑一遍会话创建、`resume`、部分消息、工具投影、`canUseTool`、AskUserQuestion、表单征询、URL 征询被拒、取消、query 关闭、进程清理这些测试。
4. 在改动支持版本之前，跑一次脱敏后的真实三轮对话冒烟。

## 升级 DSH

重新验证 Cordis 服务注入、存储域、工作区注册表、Typert 描述符与 Remote 挂载、Client 模块加载、slot ID、bundle 与 profile 清单，以及 web 模块表的 externals。DeepSeek Harness 处于开发者预览阶段，可能引入破坏性的扩展变更。

## 回滚

保留上一次构建好的 checkout 或 tarball。禁用桥接那一行、把链接的依赖换回上一份产物、跑 `--dump-config`，然后重启 Profile。桥接记录带持久化版本号，但跨未经审阅的插件版本，暂不承诺向前迁移。
