/**
 * `local-agent-bridge` namespace dictionaries.
 *
 * Every string the panel renders lives here, including the reader-facing
 * phrasing of Host enumerations — provider health, session status, turn
 * delivery, tool status, and bridge error codes. The Host deliberately sends
 * codes rather than sentences: it must not know which language a browser
 * reads, and a code survives a locale switch mid-session while a baked
 * sentence would not.
 *
 * Text that originates outside this bridge passes through untranslated: a
 * vendor tool name, a workspace title, a model's own answer, an
 * AskUserQuestion prompt, and the redacted Host diagnostic attached to an
 * `error` health state. Translating any of those would misrepresent what the
 * native product actually said.
 *
 * The zh dictionary is the key-set source of truth; en is checked against it,
 * so an asymmetric edit fails the build rather than silently falling back.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  // Panel frame.
  'panel.name': '本地 Agent',
  'panel.subtitle': '本机上的 Claude Code 与 Codex 会话',
  'panel.refresh': '刷新',
  'panel.close': '关闭',

  // New-session form.
  'create.heading': '新建本机会话',
  'create.provider': 'Agent 产品',
  'create.provider.placeholder': '选择产品',
  'create.workspace': '工作区',
  'create.workspace.placeholder': '选择工作区',
  'create.submit': '创建会话',
  'create.busy': '正在创建…',

  // Working directories, owned by this panel rather than by the Harness.
  'workspace.add': '添加工作目录',
  'workspace.add.hint': '注册主机上一个已存在的目录，Agent 将在其中运行。默认只在本面板可见。',
  'workspace.list': '工作目录',
  'workspace.publish': '在 DeepSeek Harness 中显示',
  'workspace.publish.hint': '打开后这个目录会成为 Harness 的工作区，出现在左侧工作区列表里；关闭即移除。',
  'workspace.published': '已在 Harness 显示',
  'workspace.remove': '移除',
  'workspace.remove.confirm': '从本面板移除「{title}」？目录本身不会被删除。',
  'workspace.path.placeholder': '主机上的绝对路径',
  'workspace.add.submit': '添加',
  'workspace.add.busy': '正在添加…',
  'workspace.browse': '浏览…',
  'workspace.empty': '尚未注册任何工作区。添加一个即可创建会话。',
  'workspace.missingDir': '目录已不存在',

  // Continuing a session the product already has on this Host.
  'resume.heading': '继续已有会话',
  'resume.hint': '接管这个工作区里已经存在的原生会话，包括你在终端里跑过的。',
  'resume.open': '浏览已有会话…',
  'resume.title': '选择要继续的会话',
  'resume.loading': '正在向本机 Agent 询问…',
  'resume.empty': '这个工作区还没有可继续的会话。',
  'resume.unavailable': '这个 Agent 无法列出它的历史会话。',
  'resume.submit': '继续这个会话',
  'resume.cancel': '取消',
  'resume.branch': '分支 {branch}',
  'resume.badge': '已接管',

  // Inline directory browser, driven by the Host's browse capability.
  'browse.title': '选择目录',
  'browse.home': '主目录',
  'browse.up': '上一级',
  'browse.loading': '正在读取…',
  'browse.empty': '这个目录下没有子目录。',
  'browse.truncated': '子目录过多，仅显示开头部分。',
  'browse.showHidden': '显示隐藏目录',
  'browse.useThis': '使用此目录',
  'browse.cancel': '取消',
  'browse.unavailable': '当前 Profile 没有提供目录浏览能力，请直接输入绝对路径。',

  // Context window usage, as each product reports it.
  'usage.tokens': '{used} tokens',
  'usage.ofWindow': '{used} / {max}（{percent}%）',
  'usage.title': '上下文用量',

  // Permission modes, worded after the Claude desktop app so the vocabulary
  // matches what operators already know.
  'mode.label': '模式',
  'mode.auto': '自动',
  'mode.auto.hint': 'Agent 自行决定权限',
  'mode.manual': '手动',
  'mode.manual.hint': '每次改动前都询问',
  'mode.acceptEdits': '接受编辑',
  'mode.acceptEdits.hint': '自动接受所有文件编辑',
  'mode.plan': '计划',
  'mode.plan.hint': '先制定计划再改动',
  'mode.bypass': '跳过权限',
  'mode.bypass.hint': '接受所有权限请求',
  'mode.skipsApproval': '此模式下浏览器不会再收到授权请求',
  'mode.nextTurn': '下一轮生效',

  // Model, reasoning effort and the account's usage allowance, at the composer's
  // bottom-right — the capabilities Claude Code's TUI reaches through /model.
  'model.label': '模型',
  'model.default': '产品默认',
  'model.defaultHint': '沿用你在 CLI 里配置的模型',
  'model.unavailable': '发送一条消息后，Claude Code 才会报告可选模型；Codex 随时可选。',
  'effort.label': '推理强度',
  'effort.unset': '产品默认',
  'effort.low': '低',
  'effort.medium': '中',
  'effort.high': '高',
  'effort.xhigh': '极高',
  'effort.max': '最高',
  'quota.title': '额度用量',
  'quota.used': '已用 {percent}%',
  'quota.allowed': '额度正常',
  'quota.warning': '额度将满',
  'quota.rejected': '额度已用尽',
  'quota.resets': '{when} 重置',

  // Working directory above the composer, and the file button below it.
  'cwd.label': '工作目录',
  'attach.title': '引用文件或目录',
  'attach.open': '添加文件或目录',
  'attach.search': '搜索工作目录内的文件与目录',
  'attach.empty': '没有匹配的文件或目录。',
  'attach.source': '文件来源',
  'attach.fromWorkspace': '工作目录',
  'attach.fromBrowser': '这台电脑',
  'attach.fromHost': '主机目录',
  'attach.useDirectory': '引用当前目录',
  'attach.uploadHint': '从你打开这个页面的电脑上选择。文件会上传到工作目录下的 .dsh-bridge-uploads/，Agent 从那里读取。',
  'attach.pickFiles': '选择文件…',
  'attach.pickFolder': '选择文件夹…',
  'attach.uploading': '正在上传…',
  'attach.rejected': '有 {count} 个文件未能上传（超出大小上限，或文件名无法安全使用）。',
  'dictate.start': '语音输入',
  'dictate.stop': '停止语音输入',
  'dictate.note': '由浏览器完成识别；Chrome 会将音频上传到它自己的服务转写。',

  // Working directory's repository, and what the session has spent — the two
  // facts a terminal status line shows without being asked.
  'repo.noUpstream': '无上游分支',
  'repo.detached': '游离 HEAD（不在任何分支上）',
  'repo.tracking': '跟踪 {upstream}',
  'spend.title': '本会话累计消耗',
  'spend.total': '合计 {count}',
  'spend.input': '输入 {count}',
  'spend.output': '输出 {count}',
  'spend.cacheRead': '缓存读取 {count}',
  'spend.cacheWrite': '缓存写入 {count}',

  // The trace view: where a turn's time went, and what it did.
  'view.chat': '对话',
  'view.trace': '轨迹',
  'trace.duration': '耗时 {value}',
  'trace.turns': '{count} 轮',
  'trace.calls': '{count} 步',
  'trace.search': '搜索工具、参数或结果',
  'trace.empty': '没有匹配的步骤。',
  'trace.lane.input': '输入',
  'trace.lane.model': '模型',
  'trace.lane.tools': '工具',
  'trace.step.user': '输入',
  'trace.step.assistant': '回复',
  'trace.step.reasoning': '思考',
  'trace.step.tool': '工具',
  'trace.step.context': '上下文',
  'trace.step.error': '错误',
  'trace.firstToken': '首字平均 {value}',
  'trace.rate': '{count} tok/s',
  'trace.cache': '缓存命中 {percent}%',
  'trace.tokens': '输入 {input} · 输出 {output}',
  'trace.restored': '载入了 {count} 条已有记录',

  // A turn's work, folded away once it has an answer.
  'turn.working': '处理中 {value}',
  'turn.processed': '已处理 {value}',
  'turn.steps': '{count} 步',

  // Collapsible sidebar.
  'panel.collapseSidebar': '收起侧栏',
  'panel.expandSidebar': '展开侧栏',

  // Session list and toolbar.
  'sessions.heading': '会话',
  'sessions.empty': '选择或新建一个会话',
  'session.cancel': '中止当前轮',
  'session.archive': '归档',

  // Composer.
  'composer.placeholder': '发送给本机上的原生 Agent…',
  'composer.send': '发送',
  'composer.hint': 'Codex 运行中的消息会即时插入当前轮；Claude 的消息排队等待当前轮结束。',
  'composer.keys': 'Enter 发送 · Shift+Enter 换行 · ↑ 上一条 · Esc 中止',

  // Slash-command / skill / MCP palette, opened by typing "/".
  'palette.hint': '输入 / 唤起本机 Agent 的命令与 Skill',
  'palette.commands': '命令与 Skill',
  'palette.mcp': 'MCP 服务器',
  'palette.empty': '没有匹配的命令。',
  'palette.pending': '发送一条消息后，本机 Agent 才会报告它可用的命令与 Skill。',
  'palette.none': '这个 Agent 没有报告任何命令或 Skill。',
  'palette.mcpNotInvocable': '仅供参考，不能直接调用',

  // The line between a resumed session's existing transcript and this session's
  // own work.
  'history.restored': '以上 {count} 条来自这个会话已有的记录',
  'history.truncated': '以上 {count} 条来自这个会话已有的记录（更早的内容未载入）',

  // Approval and question cards.
  'interaction.approval': '需要授权',
  'interaction.question': '需要输入',
  'interaction.allowOnce': '仅本次允许',
  'interaction.deny': '拒绝',
  'interaction.cancelTurn': '中止当前轮',
  'interaction.submit': '提交回答',
  'interaction.freeText': '自定义回答',

  // Provider health, as the operator must act on it.
  'health.not-installed': '未安装',
  'health.installed': '已安装',
  'health.unsupported': '版本不受支持',
  'health.ready': '就绪',
  'health.auth-required': '需在主机登录',
  'health.error': '异常',

  // Why a product is unusable, and what to do about it.
  'health.detail.not-installed': '在运行 DeepSeek Harness 的进程的 PATH 中找不到 {name}。',
  'health.detail.unsupported': '主机上安装的是 {name} {version}，本插件支持的版本范围是 {range}。',
  'health.detail.unverified': '无法读取 {name} 的版本号，需要显式开启 allowExperimentalVersions 才能使用。',
  'health.detail.auth-required': '{name} 在主机上的登录状态已失效。请在主机的终端里重新登录，然后点击刷新。',
  'health.detail.error': '读取 {name} 版本时出错。',
  'diagnostics.heading': '不可用的产品',
  'diagnostics.path.hint': '提示：即使产品在你自己的终端里可用，运行 DeepSeek Harness 的进程也可能看不到它 —— 两者的 PATH 可能不同（例如产品装在另一个 Node 版本管理器的环境下）。请在启动 Harness 的那个 shell 里确认 `{command} --version` 可执行。',

  // Session status.
  'status.creating': '正在创建',
  'status.idle': '空闲',
  'status.running': '运行中',
  'status.awaiting-approval': '等待授权',
  'status.awaiting-answer': '等待回答',
  'status.cancelling': '正在中止',
  'status.disconnected': '连接已断开',
  'status.auth-required': '需在主机登录',
  'status.failed': '已失败',
  'status.orphaned': '会话已失联',

  // Why a status changed, when the status word alone does not say it.
  'note.cancelling-turn': '正在中止本机上正在进行的轮次。',
  'note.host-restarted-resumable': '主机已重启。下一条消息会恢复原生会话。',
  'note.host-restarted-orphaned': '主机在原生会话建立标识之前就重启了，该会话无法恢复。',

  // File references, opened by typing "@".
  'files.heading': '工作区文件',
  'files.hint': '输入 @ 引用工作区里的文件',
  'files.empty': '没有匹配的文件。',
  'files.partial': '匹配项过多，仅显示一部分。',

  // Expandable tool rows.
  'tool.expand': '展开详情',
  'tool.collapse': '收起详情',
  'tool.input': '调用参数',
  'tool.output': '返回结果',
  'tool.truncated': '内容过长，仅显示开头部分。',

  // Timeline row labels.
  'row.delivery.started': '已发送',
  'row.delivery.steered': '已插入当前轮',
  'row.delivery.queued': '已排队',
  'row.assistant': '回复',
  'row.error': '错误',
  'row.cancelled': '已中止',
  'row.reasoning': '思考',
  'row.fileChange': '文件变更',
  'row.tool': '{tool} · {status}',
  'row.toolStatus.running': '运行中',
  'row.toolStatus.completed': '已完成',
  'row.toolStatus.failed': '已失败',

  // Bridge error codes.
  'error.EXECUTABLE_NOT_FOUND': '主机的 PATH 中没有这个产品。',
  'error.UNSUPPORTED_VERSION': '主机上安装的产品版本不受本插件支持。',
  'error.PROVIDER_START_FAILED': '产品无法在主机上启动。',
  'error.HOST_AUTH_REQUIRED': '产品在主机上的登录状态已失效。请在主机上重新登录，然后刷新。',
  'error.PROVIDER_PROTOCOL_ERROR': '原生产品返回了不兼容的协议响应。',
  'error.WORKSPACE_NOT_AVAILABLE': '所选的 DeepSeek Harness 工作区不可用。',
  'error.SESSION_NOT_FOUND': '该桥接会话不存在。',
  'error.NATIVE_SESSION_ORPHANED': '原生产品的会话已无法恢复。',
  'error.TURN_CONFLICT': '该会话已有一个正在进行的轮次。',
  'error.INTERACTION_EXPIRED': '该授权或提问已失效。',
  'error.USER_CANCELLED': '该轮次已被中止。',
  'error.CONTEXT_LIMIT': '原生产品已达到上下文长度上限。',
  'error.CONNECTION_LOST': '与原生产品的连接已断开。',
  'error.CLEANUP_FAILED': '原生产品的进程没有正常退出。',
  'error.INVALID_REQUEST': '请求无效。',
} satisfies Record<string, string>

/** The namespace's key union — the compile-time contract both locales meet. */
export type LocalAgentBridgeKey = keyof typeof zh

/** English dictionary; key-checked against zh so the pair cannot drift. */
export const en = {
  'panel.name': 'Local Agents',
  'panel.subtitle': 'Claude Code and Codex sessions on this host',
  'panel.refresh': 'Refresh',
  'panel.close': 'Close',

  'create.heading': 'New native session',
  'create.provider': 'Provider',
  'create.provider.placeholder': 'Select provider',
  'create.workspace': 'Workspace',
  'create.workspace.placeholder': 'Select workspace',
  'create.submit': 'Create session',
  'create.busy': 'Creating…',

  'workspace.add': 'Add working directory',
  'workspace.add.hint': 'Register an existing directory on the Host for the agent to work in. Visible only in this panel by default.',
  'workspace.list': 'Working directories',
  'workspace.publish': 'Show in DeepSeek Harness',
  'workspace.publish.hint': 'When on, this directory becomes a Harness workspace and appears in the sidebar list; turning it off removes it again.',
  'workspace.published': 'Shown in Harness',
  'workspace.remove': 'Remove',
  'workspace.remove.confirm': 'Remove “{title}” from this panel? The directory itself is not deleted.',
  'workspace.path.placeholder': 'Absolute path on the Host',
  'workspace.add.submit': 'Add',
  'workspace.add.busy': 'Adding…',
  'workspace.browse': 'Browse…',
  'workspace.empty': 'No workspace registered yet. Add one to create a session.',
  'workspace.missingDir': 'Directory is gone',

  'resume.heading': 'Continue a session',
  'resume.hint': 'Pick up a native session that already exists in this workspace, including ones you ran in a terminal.',
  'resume.open': 'Browse existing sessions…',
  'resume.title': 'Choose a session to continue',
  'resume.loading': 'Asking the agent on this host…',
  'resume.empty': 'No session to continue in this workspace yet.',
  'resume.unavailable': 'This agent cannot list its past sessions.',
  'resume.submit': 'Continue this session',
  'resume.cancel': 'Cancel',
  'resume.branch': 'on {branch}',
  'resume.badge': 'Resumed',

  'browse.title': 'Choose a directory',
  'browse.home': 'Home',
  'browse.up': 'Up',
  'browse.loading': 'Reading…',
  'browse.empty': 'This directory has no subdirectories.',
  'browse.truncated': 'Too many subdirectories to list; only the beginning is shown.',
  'browse.showHidden': 'Show hidden directories',
  'browse.useThis': 'Use this directory',
  'browse.cancel': 'Cancel',
  'browse.unavailable': 'This Profile provides no directory browsing; type an absolute path instead.',

  'usage.tokens': '{used} tokens',
  'usage.ofWindow': '{used} / {max} ({percent}%)',
  'usage.title': 'Context used',

  'mode.label': 'Mode',
  'mode.auto': 'Auto',
  'mode.auto.hint': 'The agent handles permission decisions',
  'mode.manual': 'Manual',
  'mode.manual.hint': 'Always ask before making changes',
  'mode.acceptEdits': 'Accept edits',
  'mode.acceptEdits.hint': 'Automatically accept all file edits',
  'mode.plan': 'Plan',
  'mode.plan.hint': 'Create a plan before making changes',
  'mode.bypass': 'Bypass permissions',
  'mode.bypass.hint': 'Accepts all permissions',
  'mode.skipsApproval': 'The browser is no longer asked to approve anything in this mode',
  'mode.nextTurn': 'Applies from the next turn',

  'model.label': 'Model',
  'model.default': 'Product default',
  'model.defaultHint': 'Keep whatever you configured in the CLI',
  'model.unavailable': 'Claude Code reports its models once a message has been sent; Codex answers at any time.',
  'effort.label': 'Reasoning effort',
  'effort.unset': 'Product default',
  'effort.low': 'Low',
  'effort.medium': 'Medium',
  'effort.high': 'High',
  'effort.xhigh': 'Extra high',
  'effort.max': 'Max',
  'quota.title': 'Usage allowance',
  'quota.used': '{percent}% used',
  'quota.allowed': 'Allowance fine',
  'quota.warning': 'Allowance nearly spent',
  'quota.rejected': 'Allowance spent',
  'quota.resets': 'resets {when}',

  'cwd.label': 'Working directory',
  'attach.title': 'Reference a file or folder',
  'attach.open': 'Add a file or folder',
  'attach.search': 'Search files and folders in the working directory',
  'attach.empty': 'No matching file or folder.',
  'attach.source': 'File source',
  'attach.fromWorkspace': 'Working directory',
  'attach.fromBrowser': 'This computer',
  'attach.fromHost': 'Host filesystem',
  'attach.useDirectory': 'Reference this directory',
  'attach.uploadHint': 'Choose from the computer you opened this page on. Files are uploaded to .dsh-bridge-uploads/ inside the working directory, where the agent reads them.',
  'attach.pickFiles': 'Choose files…',
  'attach.pickFolder': 'Choose a folder…',
  'attach.uploading': 'Uploading…',
  'attach.rejected': '{count} file(s) could not be uploaded — over the size ceiling, or the name could not be made safe.',
  'dictate.start': 'Dictate',
  'dictate.stop': 'Stop dictating',
  'dictate.note': 'Transcribed by the browser; Chrome uploads the audio to its own service.',

  'repo.noUpstream': 'no upstream',
  'repo.detached': 'Detached HEAD — not on a branch',
  'repo.tracking': 'tracking {upstream}',
  'spend.title': 'Spent in this session',
  'spend.total': '{count} total',
  'spend.input': '{count} input',
  'spend.output': '{count} output',
  'spend.cacheRead': '{count} cache read',
  'spend.cacheWrite': '{count} cache write',

  'view.chat': 'Conversation',
  'view.trace': 'Trace',
  'trace.duration': '{value} elapsed',
  'trace.turns': '{count} turns',
  'trace.calls': '{count} steps',
  'trace.search': 'Search tools, arguments, or results',
  'trace.empty': 'No matching step.',
  'trace.lane.input': 'Input',
  'trace.lane.model': 'Model',
  'trace.lane.tools': 'Tools',
  'trace.step.user': 'INPUT',
  'trace.step.assistant': 'ASSISTANT',
  'trace.step.reasoning': 'THINKING',
  'trace.step.tool': 'TOOL',
  'trace.step.context': 'CONTEXT',
  'trace.step.error': 'ERROR',
  'trace.firstToken': 'first token {value} avg',
  'trace.rate': '{count} tok/s',
  'trace.cache': '{percent}% cache hit',
  'trace.tokens': '{input} in · {output} out',
  'trace.restored': '{count} entries restored from the transcript',

  'turn.working': 'working {value}',
  'turn.processed': 'processed in {value}',
  'turn.steps': '{count} steps',

  'panel.collapseSidebar': 'Collapse sidebar',
  'panel.expandSidebar': 'Expand sidebar',

  'sessions.heading': 'Sessions',
  'sessions.empty': 'Select or create a session',
  'session.cancel': 'Cancel turn',
  'session.archive': 'Archive',

  'composer.placeholder': 'Send to the native agent on the host…',
  'composer.send': 'Send',
  'composer.hint': 'Running Codex messages are steered; Claude messages queue until the active turn completes.',
  'composer.keys': 'Enter to send · Shift+Enter for a newline · ↑ for the last message · Esc to interrupt',

  'palette.hint': 'Type / for this agent\u2019s commands and skills',
  'palette.commands': 'Commands and skills',
  'palette.mcp': 'MCP servers',
  'palette.empty': 'No matching command.',
  'palette.pending': 'Send a message first — the agent reports its commands and skills once a turn has run.',
  'palette.none': 'This agent reported no commands or skills.',
  'palette.mcpNotInvocable': 'Reference only; not invocable here',

  'history.restored': 'The {count} entries above come from this session’s existing transcript',
  'history.truncated': 'The {count} entries above come from this session’s existing transcript; earlier ones were not loaded',

  'interaction.approval': 'Approval required',
  'interaction.question': 'Input required',
  'interaction.allowOnce': 'Allow once',
  'interaction.deny': 'Deny',
  'interaction.cancelTurn': 'Cancel turn',
  'interaction.submit': 'Submit answers',
  'interaction.freeText': 'Custom answer',

  'health.not-installed': 'Not installed',
  'health.installed': 'Installed',
  'health.unsupported': 'Unsupported version',
  'health.ready': 'Ready',
  'health.auth-required': 'Host login required',
  'health.error': 'Error',

  'health.detail.not-installed': '{name} was not found on the PATH of the process running DeepSeek Harness.',
  'health.detail.unsupported': 'The Host has {name} {version} installed; this bridge admits {range}.',
  'health.detail.unverified': 'The {name} version could not be read. Using it requires allowExperimentalVersions.',
  'health.detail.auth-required': 'The {name} login on the Host has expired. Re-authenticate in a terminal on the Host, then refresh.',
  'health.detail.error': 'Reading the {name} version failed.',
  'diagnostics.heading': 'Unavailable products',
  'diagnostics.path.hint': 'Note: a product that works in your own terminal can still be invisible to the process running DeepSeek Harness — the two PATHs may differ, for instance when the product is installed under a different Node version manager. Confirm `{command} --version` runs in the shell that starts the Harness.',

  'status.creating': 'Creating',
  'status.idle': 'Idle',
  'status.running': 'Running',
  'status.awaiting-approval': 'Awaiting approval',
  'status.awaiting-answer': 'Awaiting answer',
  'status.cancelling': 'Cancelling',
  'status.disconnected': 'Disconnected',
  'status.auth-required': 'Host login required',
  'status.failed': 'Failed',
  'status.orphaned': 'Orphaned',

  'note.cancelling-turn': 'Cancelling the active native turn.',
  'note.host-restarted-resumable': 'The Host restarted. The next message will resume the native session.',
  'note.host-restarted-orphaned': 'The Host restarted before the native session identity was established, so it cannot be resumed.',

  'files.heading': 'Workspace files',
  'files.hint': 'Type @ to reference a file',
  'files.empty': 'No matching file.',
  'files.partial': 'Too many matches to list; showing some of them.',

  'tool.expand': 'Show detail',
  'tool.collapse': 'Hide detail',
  'tool.input': 'Arguments',
  'tool.output': 'Result',
  'tool.truncated': 'Too long to show in full; only the beginning is shown.',

  'row.delivery.started': 'Sent',
  'row.delivery.steered': 'Steered',
  'row.delivery.queued': 'Queued',
  'row.assistant': 'Assistant',
  'row.error': 'Error',
  'row.cancelled': 'Cancelled',
  'row.reasoning': 'Reasoning',
  'row.fileChange': 'File change',
  'row.tool': '{tool} · {status}',
  'row.toolStatus.running': 'Running',
  'row.toolStatus.completed': 'Completed',
  'row.toolStatus.failed': 'Failed',

  'error.EXECUTABLE_NOT_FOUND': 'The product is not installed on the Host PATH.',
  'error.UNSUPPORTED_VERSION': 'The installed product version is not supported by this bridge.',
  'error.PROVIDER_START_FAILED': 'The product could not be started on the Host.',
  'error.HOST_AUTH_REQUIRED': 'The product login on the Host has expired. Re-authenticate on the Host, then refresh.',
  'error.PROVIDER_PROTOCOL_ERROR': 'The native product returned an incompatible protocol response.',
  'error.WORKSPACE_NOT_AVAILABLE': 'The selected DeepSeek Harness workspace is not available.',
  'error.SESSION_NOT_FOUND': 'The bridge session does not exist.',
  'error.NATIVE_SESSION_ORPHANED': 'The native product session can no longer be resumed.',
  'error.TURN_CONFLICT': 'This session already has an active turn.',
  'error.INTERACTION_EXPIRED': 'This approval or question is no longer active.',
  'error.USER_CANCELLED': 'The turn was cancelled.',
  'error.CONTEXT_LIMIT': 'The native product reached its context limit.',
  'error.CONNECTION_LOST': 'The connection to the native product was lost.',
  'error.CLEANUP_FAILED': 'The native product process did not shut down cleanly.',
  'error.INVALID_REQUEST': 'The request is invalid.',
} satisfies Record<LocalAgentBridgeKey, string>
