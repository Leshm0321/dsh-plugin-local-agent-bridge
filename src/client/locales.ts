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

  // Workspace registration, performed inside this panel.
  'workspace.add': '添加工作区',
  'workspace.add.hint': '注册主机上一个已存在的目录，Agent 将在其中运行。',
  'workspace.path.placeholder': '主机上的绝对路径',
  'workspace.add.submit': '添加',
  'workspace.add.busy': '正在添加…',
  'workspace.browse': '浏览…',
  'workspace.empty': '尚未注册任何工作区。添加一个即可创建会话。',
  'workspace.missingDir': '目录已不存在',

  // Session list and toolbar.
  'sessions.heading': '会话',
  'sessions.empty': '选择或新建一个会话',
  'session.cancel': '中止当前轮',
  'session.archive': '归档',

  // Composer.
  'composer.placeholder': '发送给本机上的原生 Agent…',
  'composer.send': '发送',
  'composer.hint': 'Codex 运行中的消息会即时插入当前轮；Claude 的消息排队等待当前轮结束。',

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

  'workspace.add': 'Add workspace',
  'workspace.add.hint': 'Register an existing directory on the Host for the agent to work in.',
  'workspace.path.placeholder': 'Absolute path on the Host',
  'workspace.add.submit': 'Add',
  'workspace.add.busy': 'Adding…',
  'workspace.browse': 'Browse…',
  'workspace.empty': 'No workspace registered yet. Add one to create a session.',
  'workspace.missingDir': 'Directory is gone',

  'sessions.heading': 'Sessions',
  'sessions.empty': 'Select or create a session',
  'session.cancel': 'Cancel turn',
  'session.archive': 'Archive',

  'composer.placeholder': 'Send to the native agent on the host…',
  'composer.send': 'Send',
  'composer.hint': 'Running Codex messages are steered; Claude messages queue until the active turn completes.',

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
