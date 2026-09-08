# Local Agent Bridge

[English](README.md) | **简体中文**

通过 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的浏览器界面，控制已经安装在本机上的 **Claude Code** 和 **Codex**。

浏览器不会登录 Anthropic 或 OpenAI，也不会接收厂商 Cookie、OAuth 令牌、API 密钥、凭据文件或原生会话标识符。宿主机运行你已经在终端中完成认证的产品；浏览器只接收脱敏后的事件，并发送普通提示词。

本项目不是 LLM 适配器，也不会调用任何模型 HTTP API。Codex 通过 `codex app-server --stdio` 运行；Claude Code 通过官方 Agent SDK 运行，并启动宿主机 `PATH` 中解析到的 `claude` 可执行文件。

## 功能

- **一个面板，两种产品。** Harness 侧边栏中会增加 `Local Agents` 入口，并按工作目录管理会话。
- **对话按轮次分层。** 你的问题、折叠起来的过程、最终回答。运行中过程展开，结束后收起，并显示耗时。
- **轨迹视图。** 时间花在哪里、每一步做了什么 —— 全部从面板已有的事件派生，不额外请求宿主机。
- **Markdown 与流式输出。** 产品的回答按 markdown 渲染（含表格与代码块），文字按帧显示而不是整块弹出。
- **粘贴图片。** 截图直接粘进输入框，Agent 真的能看见它 —— 两个产品都是原生图片输入。
- **侧栏文件与差异。** 带语法高亮的文件查看、轻量的新建/重命名/删除/编辑，以及未提交改动的统一或并排 diff。
- **权限模式。** Auto、Manual、Accept edits、Plan、Bypass，与 Claude 桌面应用一致，并只提供各产品真正能遵守的那些。
- **模型与推理强度。** 由产品自己报告可选项，滑动条选择强度，改动从下一轮生效。
- **真实的工具审批。** 原本会在终端请求确认的原生 `Write` 或 `Bash` 操作，会在浏览器中请求一次确认；审批结果不会写入产品的权限配置。
- **继续终端中的工作。** 接续已有的原生会话，并把它已有的记录载入时间线。
- **把手上的活交给另一个产品。** 一键在同一个工作目录里、用另一个已安装的产品开一个会话，并把你上一条提问带进输入框 —— 不会自动发送。同一台机器、同一个仓库、两个 Agent。
- **中英文界面，跟随 Harness 主题。**

## 环境要求


| 项目 | 版本 |
| --- | --- |
| DeepSeek Harness | `0.1.2-rc.1` |
| Node.js | `^22.19.0` 或 `>=24.0.0` |
| pnpm | `11.7.0` |
| Claude Code CLI（可选） | `>=2.1.220 <2.2.0` |
| Codex CLI（可选） | `0.147.x` |
| 宿主机系统 | Windows 10/11 x64、macOS 13+、Linux x64/arm64 |

宿主机上必须至少安装 Claude Code 或 Codex 之一，且必须**已经完成登录**。本插件特意不提供登录界面；认证问题需要在终端中修复。

默认情况下，版本不受支持或无法读取的产品会被拒绝，面板会同时显示已安装版本和允许的版本范围。`allowExperimentalVersions` 只是本地覆盖选项，不代表兼容性承诺。

## 安装


以下步骤在 Windows（PowerShell 或 `cmd`）、macOS 和 Linux 上相同。

如果 `dsh` 不在 `PATH` 中——例如你使用 `npx @deepseek-ai/dsh web` 启动 Harness——请将下文中的 `dsh` 全部替换为 `npx @deepseek-ai/dsh`，并确保所有命令使用同一 CLI 版本。

### 从克隆仓库安装（推荐）

```sh
git clone https://github.com/Leshm0321/dsh-plugin-local-agent-bridge.git
cd dsh-plugin-local-agent-bridge
pnpm install --frozen-lockfile

# 请在当前目录中运行。`dsh plugin` 会相对于执行命令的目录解析相对路径，
# 而不是相对于 profile 解析。
dsh plugin --profile web add .

dsh --profile web --dump-config   # 可选：确认配置行已合并
dsh web
```

在全新克隆的仓库中，`pnpm install` 会通过 `prepare` 脚本构建插件，因此首次安装无需单独执行构建。如果依赖已经是最新状态，它不会再次构建；修改代码后请运行 `pnpm run build` 并重启 profile。profile 会链接到当前检出的仓库，所以不需要重新安装即可使用修改后的代码。

打开 Harness 输出的回环地址，通常是 `http://127.0.0.1:3080`。侧边栏中会出现 `Local Agents` 入口。

### 直接从 Git 安装

只需一条命令，但每个提交都需要加入一次构建允许列表：

```sh
dsh plugin --profile web add github:Leshm0321/dsh-plugin-local-agent-bridge
```

在允许插件的构建脚本之前，pnpm 会拒绝执行，并输出需要添加的精确键值，其中包含提交哈希，因此每次升级后都必须更新。请将该键添加到 profile 的 `pnpm-workspace.yaml` 中的 `allowBuilds` 下；该文件位于 `~/.dsh/profiles/web/pnpm-workspace.yaml`，Windows 上位于 `%USERPROFILE%\.dsh\profiles\web\pnpm-workspace.yaml`。完成后重新运行安装命令。从克隆仓库安装则不受此限制。

### 应使用哪个 profile

必须使用内置的 `web` profile。它提供 Harness Web 应用、API 代理、前端资源和 Client 运行时。新建的自定义 profile 默认只有基础 bundle；除非明确添加 `@deepseek-ai/dsh-web-app`，否则在其中安装本插件不会出现浏览器界面。

## 首次运行


1. 在**用于启动 Harness 的同一个 shell** 中确认 `claude --version` 和/或 `codex --version`。这一点非常重要，详见[列表里没有这个产品](docs/zh/troubleshooting.md#列表里没有这个产品)。
2. 启动 profile，然后打开 `Local Agents`。
3. 添加工作目录：输入宿主机上的绝对路径，或使用 `Browse…`。
4. 选择产品和目录，然后点击 `Create session`；也可以点击 `Browse existing sessions…`，继续此前在终端中创建的会话。

### 工作目录

面板维护**自己独立的**工作目录列表。添加到面板的目录默认仅对面板可见；只有为该目录启用 `Show in DeepSeek Harness` 后，它才会出现在 Harness 侧边栏中。关闭该开关会再次从侧边栏移除它。

之所以提供这个开关，是因为 Harness workspace 没有可见性维度：它的记录只包含路径、标题、会话和时间戳，所以注册到 Harness 的任何目录都会永久显示在侧边栏中。让代理能够访问某个目录不应自动意味着将其公开到 Harness，因此发布操作按目录选择加入，并且可撤销。

首次加载时，面板会导入你已经添加到 Harness 的 workspace，并将其标记为已发布，从而保持可用和可见。如果某个 Harness workspace 是由本插件发布的，那么从面板移除对应目录时也会移除该 workspace；磁盘上的目录永远不会被删除。

`Browse…` 会探测宿主机能力：提供 `browse` 能力的 profile 会显示浏览器内目录选择器，因此可从任意浏览器使用；提供 `native` 能力的 profile 会打开宿主机原生对话框，这只适合在宿主机本地操作，远程使用时并不实用。如果两种能力都没有，路径输入框仍然可用，面板也会明确提示当前情况。

## 面板里有什么

| | |
| --- | --- |
| **对话** | 时间线，按「问题 / 过程 / 回答」三层呈现；markdown 渲染；文字流式显示。还没提问的会话会先说明它将以什么身份运行 —— 产品、工作目录、权限模式 —— 以及输入框的三个按键 |
| **轨迹** | 时间去哪了、每步做了什么，从已有事件派生 |
| **输入框** | 上方是工作目录、消耗与上下文，各自带标签；左下是权限模式、文件按钮、语音；右下是额度、实际生效的模型、发送。`/` 命令与技能，`@` 引用文件，粘贴图片 |
| **侧栏** | 带语法高亮的项目文件，以及未提交改动的统一 / 并排 diff |
| **会话** | 以首次提问命名；列表变长后可筛选；面板关闭期间某轮结束会在侧边栏入口打上角标 |

详细说明见[功能文档](docs/zh/features.md)。



请在 profile 的 `cordis.patch.yml` 中覆盖配置。patch 会替换**完整的**配置块，因此即使只更改一个选项，也必须保留所有键。参见[已启用配置示例](examples/profile/local-agent-bridge.enabled.patch.yml)。

| 配置项 | 默认值 | 含义 |
| --- | ---: | --- |
| `allowExperimentalVersions` | `false` | 允许被分类为 `unknown` 的产品版本。 |
| `allowHostBrowsing` | `true` | 允许输入框的文件按钮浏览工作目录之外的宿主机目录。关闭则不显示该入口。 |
| `allowWorkspaceWrites` | `true` | 允许侧栏在工作目录内新建、重命名、删除和编辑文件。关闭则不显示这些控件。 |
| `enableDictation` | `false` | 在输入框提供语音输入。关闭则不显示该按钮。这是此处唯一会让音频离开本机的路径（由浏览器所为），所以除非 Profile 明确要求，默认不提供。 |
| `panelLockAbsoluteMs` | `28800000`（8 小时） | 面板一次解锁的最长有效期，与是否使用无关。 |
| `panelLockIdleMs` | `1800000`（30 分钟） | 一次解锁在没有任何调用的情况下能存活多久。 |
| `panelPasswordMinLength` | `8` | 主机接受的面板密码最短长度。 |
| `enableFakeProvider` | `false` | 暴露本地验证 fixture。通常应保持关闭，否则会显示在产品选择器中。 |
| `eventRetention` | `2000` | 每个会话最多保留的桥接事件数量。 |
| `longPollMaxMs` | `25000` | Client 长轮询的最长持续时间。 |
| `processGraceMs` | `3000` | 清理托管进程时的宽限时间。 |

## 安全边界

可信宿主机负责厂商认证、源代码访问、原生工具、MCP 服务器和进程执行。浏览器只接收脱敏后的桥接事件，并发送提示词、一次性审批、问题回答、取消操作和不透明的桥接 ID。

插件绝不会读取或复制 `.claude`、`.codex`、`auth.json`、操作系统凭据存储或厂商令牌。命令、技能、MCP 服务器和会话列表都通过产品自己的 API 获取，返回结果中的绝对文件系统路径会在解析时删除。认证失败会变成安全的 `HOST_AUTH_REQUIRED` 消息，提示你在宿主机终端中修复认证。

有四处确实跨过了这条线，每一处都是有意的，也都可以关掉：

| 是什么 | 触及范围 | 如何关闭 |
| --- | --- | --- |
| 浏览宿主机目录 | 列出宿主机任意目录；只有名称和类型，绝不返回文件内容 | `allowHostBrowsing: false` |
| 工作目录写入 | 在工作目录内新建、重命名、删除、编辑 | `allowWorkspaceWrites: false` |
| 上传 | 只写入 `.dsh-bridge-uploads/`，文件名由宿主机重新构建 | 改用「工作目录」页签，不写入任何文件 |
| 语音识别 | Chromium 会把音频发给厂商服务转写 —— 这是浏览器的行为，不是本插件的 | `enableDictation: false`，也就是默认值 |

还有第五件事是往反方向的：**设置 → 隐私**可以给这个面板加一道密码，由主机侧强制，`curl` 绕不过。它只覆盖本插件的接口面——插件在 DSH 自己的路由前面没有座位——而且在明文 HTTP 上密码是明文传输的。要给 Harness 本身加密码，在它前面放一层代理：[`examples/proxy/Caddyfile`](examples/proxy/Caddyfile) 是一份能直接用的。

**请保持 Harness 绑定到 `127.0.0.1`。** 远程访问必须额外使用私有网络，或使用经过认证的反向代理，并提供 TLS、用户或设备认证、WebSocket 支持、正确的 Host/Origin 处理、空闲过期和访问日志。`trustedHosts` 不是认证手段。不要把 Harness 端口直接暴露到互联网。

每一处的具体理由、部署契约和威胁边界见 [Security](docs/zh/security.md)。

## 文档

在 [`docs/zh`](docs/zh) 下，每篇都有对应的英文原文，在 [`docs/en`](docs/en)。

| | |
| --- | --- |
| [功能](docs/zh/features.md) | 面板的全部功能 |
| [安全](docs/zh/security.md) | 信任边界、几处有意的放宽、部署契约 |
| [运维](docs/zh/operations.md) | 运行时行为、远程浏览器使用、启用与卸载 |
| [故障排查](docs/zh/troubleshooting.md) | 跑起来了但不对劲的时候 |
| [兼容性](docs/zh/compatibility.md) | 支持的产品版本与升级流程 |
| [验证](docs/zh/validation.md) | 实际验证过什么、没验证什么 |
| [Codex schema 来源](docs/zh/codex-schema.md) | 生成的 App Server schema 从哪来 |

## 开发


```sh
pnpm install --frozen-lockfile
pnpm run check        # 构建 + 类型检查 + lint + 测试 + 打包检查
```

CI 应运行 `pnpm run check`。测试套件明确固定了三种宿主机平台的启动形式，因此在任意一种平台上构建，都可以验证另外两种平台的行为。

profile 会链接到当前检出的仓库，所以完整的编辑循环只需运行 `pnpm run build` 并重启 profile。Harness Web 应用禁用了 HMR，因此必须重启。

验收矩阵以及已经和尚未针对真实产品完成的测试见[验证文档](docs/zh/validation.md)；升级流程见[兼容性文档](docs/zh/compatibility.md)。

## 状态和限制


Windows 和 macOS 均已针对真实产品进行测试。Linux 与 macOS 共用启动路径，并已由自动化的跨平台测试覆盖，但尚未进行真实产品冒烟测试。

本项目面向单用户和自托管环境，不提供多租户隔离或 RBAC。附件、图片输入、会话 fork 和 PTY 模式不在范围内。生产网关部署所需的 TLS、认证、WebSocket 转发、Host/Origin 强制校验、空闲过期和访问日志尚未得到验证；回环地址上的冒烟测试不代表已验证这些能力。

## 许可证和条款


本项目使用 MIT 许可证。Codex App Server schema 由 Codex `0.147.0` 生成；Codex 使用 Apache-2.0 许可证分发。Claude Agent SDK 声明 `SEE LICENSE IN README.md`，Anthropic 则说明 Agent SDK 受其商业条款约束。本项目不分发任何厂商二进制文件，也不授予对厂商服务的任何权利。

Anthropic 的 Agent SDK 文档指出，第三方产品应使用受支持的 API 密钥认证方式，除非另行获准提供 `claude.ai` 登录或额度功能。本桥接器不提供 Claude 登录界面，但复用宿主机上已经认证的 Claude Code 安装并不等同于获得官方授权。**请将 Claude provider 视为私有、单用户、实验性集成**；在任何公开、商业、托管或多用户部署之前，请重新审查认证和分发条款。

公开、商业或多用户分发前，请阅读 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
