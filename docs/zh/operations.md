# 运维

## 启动

1. **在启动 DSH 的那个 shell 里**、用同一个操作系统账号，确认 `codex --version` 和 `claude --version` 都能跑通。在别的终端里能用不算——见[产品装了但没出现在列表里](#产品装了但没出现在列表里)。
2. 确认每个产品在本地终端里已经可用，不需要走新的登录流程。
3. 若要远程使用，把 [`remote-web.patch.yml`](../../examples/profile/remote-web.patch.yml) 合进内置的 `web` Profile，让 DSH 自己的工作区选择改用浏览器内的选择器，而不是弹在主机桌面上的原生对话框。不做这一步，`Local Agents` 在任何 Profile 下都仍然可以按绝对路径登记工作目录。
4. 跑 `dsh --profile web --dump-config`，确认两行 browse-picker 都加载成功、没有 name 不匹配的告警。
5. 在 DSH 仍绑定在回环地址的前提下启动 `web` Profile。
6. 使用远程浏览器之前，先把带认证的访问层验证好。
7. 打开 `Local Agents`，确认产品与工作区都已就绪。

加载插件只做版本探测。在某一轮对话真正需要之前，它不会启动任何长期运行的产品进程。

## 健康状态

| 状态 | 该怎么办 |
| --- | --- |
| `not-installed` | 产品不在 DSH 进程的 `PATH` 上。装上它，或者修那个进程的 `PATH`——见[产品装了但没出现在列表里](#产品装了但没出现在列表里)。 |
| `unsupported` | 版本读到了，但被拒。面板会同时给出已安装版本和准许范围。装一个受支持的版本，或者自己验证后显式打开实验性兼容。 |
| `ready` | 该产品可以创建桥接会话。 |
| `auth-required` | 在主机的终端里重新认证，然后刷新目录。 |
| `error` | 查看脱敏后的主机诊断信息，核对可执行文件与版本输出。 |
| `orphaned` | 新建一个桥接会话；原来的原生定位符不可用，或者无法恢复。 |

## 会话恢复

刷新浏览器和短暂断网都不会取消主机上那一轮对话。客户端会从它最后一个事件序号接着走。如果有界的回放窗口已经往前移过，主机会带 `reset: true` 返回它保留的快照。

主机重启之后，抓到过原生定位符的会话回到 `idle`，并在下一条消息时恢复；没有定位符的会话变成 `orphaned`。任何跨重启还悬着的交互都会变成 `expired`——它永远不会被自动批准。

## 关停与清理

只有在重要的外部工作都保存好之后，才去禁用或卸载插件。卸载之前，先把 Profile 自己的 `cordis.patch.yml` 里那行 `local-agent-bridge` 覆盖删掉，然后执行 `dsh plugin --profile <name> remove dsh-plugin-local-agent-bridge`。卸载时会中止进行中的对话、关闭 SDK / App Server 传输、关掉 stdin、终止 dsh-subprocess 进程树、等它退出，最后关闭桥接的持久化。

关停之后，确认没有意外遗留的 `codex app-server` 或由 SDK 持有的 `claude` 子进程。你自己另开终端跑着的 Claude 或 Codex 不属于本插件，桥接不得去终止它。

## 故障排查

### 产品装了但没出现在列表里

桥接从**运行 DSH 那个进程**的 `PATH` 里解析 `codex` 和 `claude`，而这未必是你测试时所用终端的 `PATH`。这是 macOS 和 Linux 上最常见的误报：版本管理器给每个 shell 各自的 `PATH`，于是在某个 Node 版本下装的产品，对以另一个版本启动的 DSH 是不可见的——面板对一个你手工能跑起来的产品报 `not-installed`，这个判断是对的。

先确认 DSH 实际拿到的是哪个 `PATH`，然后从一个能解析到该产品的 shell 里启动它：

```sh
# macOS、Linux —— 查看正在运行的 DSH 进程
ps eww -p "$(pgrep -f 'dsh web' | head -1)" | tr ' ' '\n' | grep '^PATH='

# Windows PowerShell —— 在启动 DSH 之前查看当前 shell
$env:PATH -split ';'
```

在启动 DSH 之前把产品所在目录前置进去就够了：

```sh
# macOS、Linux
PATH="$PATH:/path/to/product/bin" dsh --profile web
```

```powershell
# Windows PowerShell
$env:PATH += ';C:\path\to\product'; dsh --profile web
```

`Local Agents` 面板会在任何 `not-installed` 的产品旁边就地显示这条提示，省得操作者来翻这份文档。

### 产品装了，但没就绪

- 在启动 DSH 的那个 shell 里跑产品的 `--version`。
- 把结果和[兼容性文档](compatibility.md)对照；面板也会在被拒的版本旁边给出准许范围。
- 除非协议测试已经通过，否则保持 `allowExperimentalVersions` 关闭。

### 浏览器提示需要认证

- 不要在浏览器里找登录按钮，这里刻意没有。
- 在主机上用产品本身的本地登录命令。
- 回到 DSH，点刷新。

### 工作区选择弹在主机桌面上

- `Local Agents` 有自己的工作目录列表，可以按绝对路径添加，完全不需要选择器。它的 `浏览…` 按钮会向主机发一次列目录的探测：`browse` 类型的 Profile 得到面板内的目录抽屉，`native` 类型得到主机自己的对话框；两者都没提供时，面板会直说，并把路径输入框留着。
- 在面板里添加的目录，只有为它打开 `在 DeepSeek Harness 中显示` 之后，才成为 Harness 的工作区。要控制它是否出现在那里，用这个开关，而不是 Harness 的侧边栏——取消发布只会删掉本插件创建的那个工作区，不会碰别的东西。
- 关于 DSH 自己的侧边栏流程：内置 Web Profile 之所以选了自动/原生目录选择器，是因为 DSH 绑在回环地址上。在 Windows 上那是文件夹对话框，在 macOS 上是打开面板，在 Linux 上是桌面 portal——它们都开在主机上。
- 应用 [`remote-web.patch.yml`](../../examples/profile/remote-web.patch.yml)、重启 Profile，然后确认合成后的配置里含有 `directory-picker-browse` 和 `ui-directory-picker-browse`。
- 不要改已有 `directory-picker` 那一行的 `name`；Cordis 把这个值当断言看，对不上就整块跳过。应该先禁用那一行，再按示例里的写法用不同的 ID 插入这对 browse 项。

### 会话变成 orphaned

- 主机从未抓到可恢复的原生定位符，或者原生产品拒绝了它。
- 归档这个桥接会话，新建一个。不要通过浏览器搬运原生 ID。

### 反复重连

- 确认访问层转发了 WebSocket 和长连接 HTTP。
- 检查 TLS、Origin、Host、空闲超时和代理缓冲。
- 确认从网关进程仍能通过回环地址访问到 DSH。

### 清理失败

- 停掉 DSH，在主机上查看进程树。
- 只记录进程名、PID 和退出状态；不要记录含有私密提示词的命令行。
- 可复现的托管子进程泄漏，应当视作发布阻塞项。

## 运行时行为


- Codex 用一个受管的 App Server 进程承载多个映射的线程（`thread/start`、`thread/resume`、`turn/start`、`turn/steer`、`turn/interrupt`）。
- Claude Code 用 `query()`，配合 `includePartialMessages`、`resume`、`canUseTool`、`AskUserQuestion` 以及 SDK 的征询回调。
- 在 Codex 一轮进行中发消息是**引导**这一轮；对 Claude Code 则是排队，等当前这轮结束。
- 审批是一次性的。浏览器上的任何决定都不会写进产品的权限配置。
- 浏览器重连依赖事件序号和一个有界的回放窗口。主机重启之后，若此前已抓到原生定位符则会话恢复，否则标记为 orphaned。
- 归档只是把桥接会话藏起来，不会删掉原生历史。

## 通过远程浏览器使用


把 [remote-web.patch.yml](../../examples/profile/remote-web.patch.yml) 合进 Profile 的 `cordis.patch.yml`，让 Harness 自己的工作区选择器改用浏览器内的目录选择，而不是弹在主机桌面上的对话框。`Local Agents` 添加目录本来就不需要选择器，所以这一步只关乎 Harness 自己的流程。

重启 Profile，确认 `dsh --profile web --dump-config` 的输出里含有 `directory-picker-browse` 和 `ui-directory-picker-browse`，且没有加载器的 name 不匹配告警。

## 禁用、启用、卸载


想禁用但不删包，把 [local-agent-bridge.disabled.patch.yml](../../examples/profile/local-agent-bridge.disabled.patch.yml) 里那一行加到 Profile 的 `cordis.patch.yml` 再重启。去掉 `disabled: true` 就重新启用。

要卸载，先删掉 Profile 自己的 `cordis.patch.yml` 里那行 `local-agent-bridge` 覆盖，然后：

```sh
dsh plugin --profile web remove dsh-plugin-local-agent-bridge
```

卸载会释放进行中的会话、关闭协议传输，并等待受管进程树退出。
