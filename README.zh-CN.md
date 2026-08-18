# Local Agent Bridge

[English](README.md) | **简体中文**

通过 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的浏览器界面，控制已经安装在本机上的 **Claude Code** 和 **Codex**。

浏览器不会登录 Anthropic 或 OpenAI，也不会接收厂商 Cookie、OAuth 令牌、API 密钥、凭据文件或原生会话标识符。宿主机运行你已经在终端中完成认证的产品；浏览器只接收脱敏后的事件，并发送普通提示词。

本项目不是 LLM 适配器，也不会调用任何模型 HTTP API。Codex 通过 `codex app-server --stdio` 运行；Claude Code 通过官方 Agent SDK 运行，并启动宿主机 `PATH` 中解析到的 `claude` 可执行文件。

## 功能

- **一个面板，两种产品。** Harness 侧边栏中会增加 `Local Agents` 入口，并按工作目录管理会话。
- **沿用熟悉的键盘操作。** Enter 发送，Shift+Enter 换行，`↑` 浏览已发送消息，Esc 中断正在运行的轮次。输入 `/` 可列出产品自身的命令和技能，输入 `@` 可补全工作目录中的文件。
- **权限模式。** Auto、Manual、Accept edits、Plan、Bypass，与 Claude 桌面应用提供的模式一致，并映射到各产品真正支持的能力。
- **可展开的工具调用。** 展开工具调用行即可查看代理运行了什么以及返回了什么，而不是只看到一行摘要。
- **上下文用量。** 长会话会在上下文压缩前提醒你。
- **真实的工具审批。** 原本会在终端请求确认的原生 `Write` 或 `Bash` 操作，会在浏览器中请求一次确认；审批结果不会写入 Claude Code 或 Codex 的权限配置。
- **继续终端中的工作。** 可以在浏览器中接续已有的原生会话。
- **中英文界面。** 跟随 Harness 的语言偏好。
- **跟随 Harness 主题。** 支持浅色和深色模式。

## 环境要求

| 项目 | 版本 |
| --- | --- |
| DeepSeek Harness | `0.1.0-rc.7` |
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

1. 在**用于启动 Harness 的同一个 shell** 中确认 `claude --version` 和/或 `codex --version`。这一点非常重要，详见[产品未显示](#产品未显示)。
2. 启动 profile，然后打开 `Local Agents`。
3. 添加工作目录：输入宿主机上的绝对路径，或使用 `Browse…`。
4. 选择产品和目录，然后点击 `Create session`；也可以点击 `Browse existing sessions…`，继续此前在终端中创建的会话。

### 工作目录

面板维护**自己独立的**工作目录列表。添加到面板的目录默认仅对面板可见；只有为该目录启用 `Show in DeepSeek Harness` 后，它才会出现在 Harness 侧边栏中。关闭该开关会再次从侧边栏移除它。

之所以提供这个开关，是因为 Harness workspace 没有可见性维度：它的记录只包含路径、标题、会话和时间戳，所以注册到 Harness 的任何目录都会永久显示在侧边栏中。让代理能够访问某个目录不应自动意味着将其公开到 Harness，因此发布操作按目录选择加入，并且可撤销。

首次加载时，面板会导入你已经添加到 Harness 的 workspace，并将其标记为已发布，从而保持可用和可见。如果某个 Harness workspace 是由本插件发布的，那么从面板移除对应目录时也会移除该 workspace；磁盘上的目录永远不会被删除。

`Browse…` 会探测宿主机能力：提供 `browse` 能力的 profile 会显示浏览器内目录选择器，因此可从任意浏览器使用；提供 `native` 能力的 profile 会打开宿主机原生对话框，这只适合在宿主机本地操作，远程使用时并不实用。如果两种能力都没有，路径输入框仍然可用，面板也会明确提示当前情况。

## 输入框

| 按键 | 操作 |
| --- | --- |
| Enter | 发送 |
| Shift+Enter | 换行 |
| `↑` / `↓` | 在空输入框中浏览已经发送的消息 |
| Esc | 中断正在运行的轮次；否则清空草稿 |
| `/` | 显示产品报告的命令和技能 |
| `@` | 显示工作目录中的文件 |

输入法正在组词时会忽略 Enter，因此确认候选词不会误发尚未完成的内容。

`@` 可以出现在单词能够开始的任何位置，因为文件引用通常会出现在句子中间。选择文件时只会替换当前 token。搜索在宿主机上执行；解析符号链接后仍会限制在工作目录内，并受访问预算限制，同时跳过 `.git` 和依赖目录。如果搜索提前停止，界面会明确说明，而不会把不完整列表伪装成完整结果。

输入框周围的控件遵循各产品自身的布局：

| 位置 | 内容 |
| --- | --- |
| 上方左侧 | 工作目录、分支和变更行数 |
| 上方右侧 | 已消耗 token 和上下文占用比例 |
| 下方左侧 | 权限模式、文件按钮和听写 |
| 下方右侧 | 使用额度、模型和发送按钮 |

**输入框上方的状态行**提供终端中通常一眼可见的信息。分支和变更规模来自宿主机上执行的 `git status --porcelain=v2` 与 `git diff --numstat HEAD`。这些命令不会继承环境，并禁用终端提示和索引锁，因此状态读取既不会等待凭据，也不会干扰你自己的终端。非 Git 仓库或未安装 Git 的宿主机不会显示相关信息。处于 detached HEAD 时会显示提交并注明状态；分支没有上游时也会明确提示，避免直到推送时才发现。

已消耗 token 是会话的累计总数，悬停后可查看输入、输出、缓存读取和缓存写入。它与旁边的上下文用量回答的是不同问题：前者只会增加，后者会随着会话压缩而增减，因此两者都会显示。

**文件按钮**同时支持宿主机与浏览器所在设备，因为浏览器不一定运行在宿主机上：

- **Working directory** 相当于不需要输入语法的 `@`：使用同一个宿主机搜索，列出文件与文件夹，并将引用追加到草稿中。不会复制任何内容。文件夹会保留末尾的斜杠，以便两种产品区分文件和目录。它不是宿主机文件对话框：本桥接器不会让浏览器浏览宿主机的整个文件系统，而且代理本来也无法读取工作目录之外的路径。
- **This computer** 从浏览器所在设备发送文件。当 Harness 运行在另一台机器上时，这是将文件内容传到代理的唯一方式。文件会写入工作目录内的 `.dsh-bridge-uploads/`；建议将该目录加入 `.gitignore`。随后会以相同形式引用文件，供产品读取。

上传是桥接器中唯一会写入宿主机文件的路径，因此其范围受到严格限制：目标位置固定且浏览器无法指定；文件名根据允许列表重新构建，而不是直接信任输入；解析符号链接后会再次验证路径包含关系；绝不覆盖已有文件。每个文件上限 8 MB，每个请求上限 32 MB，最多 50 个文件。无法安全处理的文件名或超过限制的文件会被拒绝并计数，而不会静默丢弃。

**听写**只会在浏览器提供 Web Speech API 时出现，实际通常意味着 Chromium。转写结果会追加到现有文字后，因此语音可以继续已经输入的句子，而不是替换它。浏览器语音识别不一定在本地完成，详见[安全边界](#安全边界)。

## 权限模式

这些模式沿用 Claude 桌面应用的名称，因为用户通常已经熟悉这套术语：

| 模式 | 含义 |
| --- | --- |
| Auto | 由代理处理权限决定 |
| Manual | 进行更改前始终询问 |
| Accept edits | 自动接受所有文件编辑 |
| Plan | 更改前先制定计划 |
| Bypass permissions | 接受所有权限请求 |

每个产品只会报告自己真正支持的模式，因此界面上出现的模式始终是代理可以实际遵循的模式。Claude Code 原生支持全部五种模式。Codex 会报告三种：它没有仅接受编辑的策略；此外，它的计划模式只能通过同时覆盖宿主机模型和推理强度配置的 payload 使用。

**Accept edits 和 Bypass permissions 会使浏览器不再收到任何审批请求**，从而跳过本桥接器提供的保护。之所以仍提供它们，是因为两种产品都提供这些模式；面板会进行标记并显示警告。设置会从下一个轮次开始生效，因为两种产品都在新轮次开始时读取该设置。

## 模型、推理强度和额度

两种产品都会枚举自己的模型，并允许每轮选择一个模型。因此模型选择器只显示当前会话产品实际报告的内容，不会在本项目中维护一份容易过期的模型名称列表。推理强度归属于具体模型，因为两种产品都是这样定义的：不同模型支持的级别可能不同，不支持推理强度的模型则不会显示相关选项。

`Product default` 是实际选项，不是占位符。保持该选项会继续使用 CLI 自身的配置；如果你已经在 CLI 中设定模型，这通常是正确选择。与权限模式一样，更改会从下一轮开始生效。

| 产品 | 模型来源 | 应用方式 |
| --- | --- | --- |
| Claude Code | 实时 SDK 查询返回的 `supportedModels()` | `Options.model` 和 `Options.effort` |
| Codex | App Server 的 `model/list` | `turn/start` 中的 `model` 和 `effort` |

与命令列表一样，Claude Code 只有在某个轮次运行时才能被查询，因此在面板中发送第一条消息后模型列表才会出现；在此之前控件会说明尚未查询，而不会表现得像产品没有模型。Codex 可随时回答查询。

**只有产品主动提供额度信息时才会显示额度。** Claude Code 会为订阅账户通过流事件发送额度；Codex 虽然提供相应调用，但没有 ChatGPT 登录时会拒绝该调用。产品未报告额度时，界面不会显示零或破折号，以免被误解为真实数值。如果报告了多个额度窗口，界面会显示最紧张的一个，因为它最先限制使用，其余内容可在提示中查看。

## 命令、技能和 MCP

在输入框中键入 `/` 会列出当前产品报告的可用能力。列表会随输入过滤，并支持方向键导航。选择条目只会写入产品自己的调用文本；桥接器不会代替产品执行命令。因此 `/compact` 与终端中的含义相同，而产品重命名命令时也无需修改桥接器。

语法由产品决定，而不是由桥接器决定：

| 产品 | 报告方式 | 调用形式 |
| --- | --- | --- |
| Claude Code | 实时 SDK 查询返回的 `supportedCommands()` | `/name` |
| Codex | 当前工作目录对应的 `skills/list` | `namespace:skill` |

Claude Code 只有在轮次运行时才能被查询，所以发送会话的第一条消息后才会出现列表，并会在后续每一轮刷新。在此之前，面板会提示产品尚未报告，这与报告空列表并不相同。Codex 可随时回答查询。

两种产品的 MCP 服务器会连同各自报告的状态一起列出，仅作为清单展示，不能从输入框直接调用。

### 为什么没有 `/resume`、`/model` 和 `/clear`

它们并不是此环境中的命令。`/resume`、`/model`、`/help`、`/clear` 等属于 Claude Code 的终端界面，由终端 UI 自己绘制屏幕并读取按键。桥接器使用的 Agent SDK 没有这层终端界面，因此这些命令在 SDK 中不存在。`supportedCommands()` 返回的实际是技能，官方文档也是如此描述。因此输入 `/resume` 时，产品会如实返回 `/resume isn't available in this environment`，而不是由桥接器伪造错误。

相关能力都已经提供，只是以 SDK 支持的控件形式呈现，而不是文本命令：

| 终端中 | 本面板中 |
| --- | --- |
| `/resume` | `Browse existing sessions…` |
| `/model` | 输入框右下角的模型选择器 |
| `/status` | 输入框上方的上下文用量和下方的额度 |
| `/permissions` | 权限模式选择器 |

产品真正报告的任何命令或技能都会显示在 `/` 列表中，并使用产品自己的语法调用。

## 继续已有会话

`Browse existing sessions…` 会列出所选目录中已经存在的原生会话，包括从终端中启动的会话，并通过产品自身的恢复路径继续所选会话。

会话枚举完全使用各产品自己的 API：Claude Code 使用 Agent SDK 的 `listSessions`，Codex 使用 `thread/list`；插件不会读取 `~/.claude` 或 `~/.codex`。Claude Code 的列表会排除程序化入口，这符合 SDK 对会话选择器的定义，也避免桥接器再次列出自己创建的会话。

会话记录路径始终留在宿主机上。未知或过期的定位符会使会话变成 `orphaned`；宿主机重启后定位符不再有效时也会出现相同状态。

## 运行时行为

- Codex 通过一个托管的 App Server 进程处理多个已映射线程，使用 `thread/start`、`thread/resume`、`turn/start`、`turn/steer` 和 `turn/interrupt`。
- Claude Code 使用带有 `includePartialMessages`、`resume`、`canUseTool`、`AskUserQuestion` 和 SDK elicitation 回调的 `query()`。
- Codex 轮次运行期间发送的新消息会引导当前轮次；Claude Code 的新消息会排队，直到活动轮次结束。
- 审批只生效一次。浏览器中的决定不会写入产品的权限配置。
- 浏览器重连使用事件序列和有界重放窗口。宿主机重启后，如果此前已经获得原生定位符，会话将恢复；否则会被标记为 orphaned。
- 归档只会隐藏桥接器会话，不会删除原生历史记录。

## 配置

请在 profile 的 `cordis.patch.yml` 中覆盖配置。patch 会替换**完整的**配置块，因此即使只更改一个选项，也必须保留所有键。参见[已启用配置示例](examples/profile/local-agent-bridge.enabled.patch.yml)。

| 配置项 | 默认值 | 含义 |
| --- | ---: | --- |
| `allowExperimentalVersions` | `false` | 允许被分类为 `unknown` 的产品版本。 |
| `enableFakeProvider` | `false` | 暴露本地验证 fixture。通常应保持关闭，否则会显示在产品选择器中。 |
| `eventRetention` | `2000` | 每个会话最多保留的桥接事件数量。 |
| `longPollMaxMs` | `25000` | Client 长轮询的最长持续时间。 |
| `processGraceMs` | `3000` | 清理托管进程时的宽限时间。 |

## 安全边界

可信宿主机负责厂商认证、源代码访问、原生工具、MCP 服务器和进程执行。浏览器只接收脱敏后的桥接事件，并发送提示词、一次性审批、问题回答、取消操作和不透明的桥接 ID。

唯一反向传输的例外是输入框的上传功能，它使另一台设备上的浏览器能够把文件交给代理。上传只会写入宿主机上会话工作目录内的 `.dsh-bridge-uploads/`。浏览器提供文件内容和名称，但不能指定目标路径。文件名会根据允许列表重新构建；仅包含点号的路径段会被拒绝；解析符号链接后会再次验证包含关系；已有文件绝不会被替换。系统还限制单文件大小、单请求大小和文件数量。如果不希望使用这条写入路径，只使用工作目录选项即可，此时不会写入任何文件。

插件绝不会读取或复制 `.claude`、`.codex`、`auth.json`、操作系统凭据存储或厂商令牌。命令、技能、MCP 服务器和会话列表都通过产品自己的 API 获取，返回结果中的绝对文件系统路径会在解析时删除。认证失败会变成安全的 `HOST_AUTH_REQUIRED` 消息，提示你在宿主机终端中修复认证。

**听写是唯一另一项例外，而且它属于浏览器，而不是本插件。** 除此之外的所有处理都留在宿主机上；Chromium 的 Web Speech API 可能会将音频发送给厂商服务进行转写。按钮悬停说明中会提示这一点。如果无法接受，请不要使用听写；面板的其他功能完全不受影响，而不支持该 API 的浏览器也不会显示按钮。

**请保持 Harness 绑定到 `127.0.0.1`。** 远程访问必须额外使用私有网络，或使用经过认证的反向代理，并提供 TLS、用户或设备认证、WebSocket 支持、正确的 Host/Origin 处理、空闲过期和访问日志。`trustedHosts` 不是认证机制。不要把 Harness 端口直接暴露到互联网。

部署约束和威胁边界详见[安全文档](docs/security.md)。

## 远程浏览器使用

将 [remote-web.patch.yml](examples/profile/remote-web.patch.yml) 合并到 profile 的 `cordis.patch.yml`，使 Harness 自己的 workspace 选择器使用浏览器内目录选择器，而不是打开宿主机桌面的原生对话框。`Local Agents` 添加目录时并不依赖该选择器，因此此配置只影响 Harness 自己的流程。

重启 profile，并确认 `dsh --profile web --dump-config` 包含 `directory-picker-browse` 和 `ui-directory-picker-browse`，且没有 loader 名称不匹配警告。

## 故障排查

### 产品未显示

桥接器从**运行 Harness 的进程**所继承的 `PATH` 中解析 `codex` 和 `claude`，该 `PATH` 不一定与测试命令时使用的终端相同。如果使用 fnm、nvm、asdf 等按 shell 生效的版本管理器，为某个 Node 版本安装的产品可能对由另一个 Node 版本启动的 Harness 不可见。此时即使你可以手动运行产品，面板仍会正确报告 `not-installed`。

```sh
# macOS、Linux：读取正在运行的 Harness 进程的 PATH
ps eww -p "$(pgrep -f 'dsh web' | head -1)" | tr ' ' '\n' | grep '^PATH='

# 然后从能够解析产品的 shell 启动 Harness
PATH="$PATH:/path/to/product/bin" dsh --profile web
```

面板会在所有 `not-installed` 产品旁直接显示这条提示。

### 产品已安装但未就绪

在启动 Harness 的 shell 中运行产品的 `--version`，并与 [compatibility.md](docs/compatibility.md) 对照。面板会同时显示已安装版本和允许范围。除非你已经自行验证协议，否则请保持关闭 `allowExperimentalVersions`。

### 浏览器要求认证

按设计，界面中没有登录按钮。请在宿主机终端中使用产品的正常命令完成登录，然后点击 Refresh。刷新会重新探测两种产品，因此不需要重启 profile。

更多信息请参见[运维文档](docs/operations.md)。

## 禁用、启用和卸载

如果只想禁用而不删除软件包，请将 [local-agent-bridge.disabled.patch.yml](examples/profile/local-agent-bridge.disabled.patch.yml) 中的配置行添加到 profile 自己的 `cordis.patch.yml`，然后重启。删除 `disabled: true` 即可重新启用。

卸载前，先从 profile 自己的 `cordis.patch.yml` 中删除 `local-agent-bridge` 覆盖项，然后运行：

```sh
dsh plugin --profile web remove dsh-plugin-local-agent-bridge
```

卸载过程会释放活动会话、关闭协议传输，并等待托管进程树退出。

## 开发

```sh
pnpm install --frozen-lockfile
pnpm run check        # 构建 + 类型检查 + lint + 测试 + 打包检查
```

CI 应运行 `pnpm run check`。测试套件明确固定了三种宿主机平台的启动形式，因此在任意一种平台上构建，都可以验证另外两种平台的行为。

profile 会链接到当前检出的仓库，所以完整的编辑循环只需运行 `pnpm run build` 并重启 profile。Harness Web 应用禁用了 HMR，因此必须重启。

验收矩阵以及已经和尚未针对真实产品完成的测试见[验证文档](docs/validation.md)；升级流程见[兼容性文档](docs/compatibility.md)。

## 状态和限制

Windows 和 macOS 均已针对真实产品进行测试。Linux 与 macOS 共用启动路径，并已由自动化的跨平台测试覆盖，但尚未进行真实产品冒烟测试。

本项目面向单用户和自托管环境，不提供多租户隔离或 RBAC。附件、图片输入、会话 fork 和 PTY 模式不在范围内。生产网关部署所需的 TLS、认证、WebSocket 转发、Host/Origin 强制校验、空闲过期和访问日志尚未得到验证；回环地址上的冒烟测试不代表已验证这些能力。

## 许可证和条款

本项目使用 MIT 许可证。Codex App Server schema 由 Codex `0.147.0` 生成；Codex 使用 Apache-2.0 许可证分发。Claude Agent SDK 声明 `SEE LICENSE IN README.md`，Anthropic 则说明 Agent SDK 受其商业条款约束。本项目不分发任何厂商二进制文件，也不授予对厂商服务的任何权利。

Anthropic 的 Agent SDK 文档指出，第三方产品应使用受支持的 API 密钥认证方式，除非另行获准提供 `claude.ai` 登录或额度功能。本桥接器不提供 Claude 登录界面，但复用宿主机上已经认证的 Claude Code 安装并不等同于获得官方授权。**请将 Claude provider 视为私有、单用户、实验性集成**；在任何公开、商业、托管或多用户部署之前，请重新审查认证和分发条款。

公开、商业或多用户分发前，请阅读 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
