/**
 * 中文（源 locale）。key 命名：`<端或域>.<位置>.<名>`，错误统一 `error.<名>`（沿用 daemon 已有的 messageKey）；
 * 多处共用的放 `common.*`。新增文案先加在这里，再补 en.ts——缺了 typecheck 会提醒
 */
export const zh = {
  'common.save': '保存',
  'web.chat.newItems': '↓ {count} 条新消息',
  'web.confirm.empty': '（不填）',
  'web.confirm.awaitingApproval': '等你审批',
  'web.confirm.needsInput': '需要你提供信息',
  'web.confirm.reject': '驳回',
  'common.deny': '拒绝',
  'web.confirm.approve': '批准',
  'common.submit': '提交',
  'web.confirm.permissionRequest': '权限请求 ·',
  'web.confirm.alwaysAllowHint': '这个会话里同类操作（同一目录下）不再询问',
  'web.confirm.alwaysAllow': '本会话始终允许',
  'common.allow': '允许',
  'web.app.openingSession': '正在打开会话…',
  'web.app.connectToOpen': '连上 daemon 后打开会话。',
  'web.main.missingRoot': 'index.html 里缺 #root',
  'web.transcript.branchFrom': '从第 {seq} 条分支出一个新会话',
  'web.transcript.branch': '分支',
  'common.running': '运行中',
  'common.succeeded': '成功',
  'common.failed': '失败',
  'web.transcript.you': '你',
  'web.transcript.thinking': '思考',
  'web.transcript.permission': '权限',
  'web.transcript.noEvents': '还没有事件。',
  'web.transcript.quoteTurnHint': '在别的会话里引用这一轮',
  'web.transcript.quoteTurn': '引用这一轮',
  'web.conn.offline': '未连接',
  'web.conn.connecting': '连接中…',
  'web.conn.connected': '已连接',
  'web.conn.reconnecting': '断线，重连中…',
  'web.conn.incompatible': '协议版本不兼容',
  'web.conn.closed': '已断开',
  'web.sidebar.projectDetails': '项目详情',
  'web.sidebar.projectDetailsOf': '{name} 项目详情',
  'web.sidebar.newTaskHere': '在这个项目下新建任务',
  'web.sidebar.newTaskIn': '在 {name} 下新建任务',
  'web.sidebar.noTasks': '还没有任务',
  'web.sidebar.viewAllTasks': '查看全部 ({taskCount})',
  'web.sidebar.newChat': '新对话',
  'common.newTask': '新任务',
  'web.sidebar.schedules': '定时任务',
  'web.sidebar.projects': '项目',
  'web.sidebar.addProject': '添加项目',
  'web.sidebar.createTask': '新建任务',
  'web.sidebar.allProjects': '全部项目',
  'web.sidebar.noProjects': '还没有项目',
  'web.sidebar.projectsSoon': '项目功能即将可用',
  'web.sidebar.chats': '会话',
  'web.sidebar.allChats': '全部会话',
  'web.sidebar.chatMeta': '{model} · {eventCount} 事件{v}',
  'web.sidebar.noChats': '还没有会话',
  'web.sidebar.viewAllChats': '查看全部 ({length})',
  'web.sidebar.settings': '设置',
  'common.unread': '未读',
  'web.status.toLight': '切换到浅色',
  'web.status.toDark': '切换到深色',
  'web.status.toggleTheme': '切换主题',
  'web.status.toolCalls': '{toolCalls} 次工具',
  'web.status.turnElapsed': '本轮 {formatElapsed} ·',
  'common.planMode': '计划模式',
  'common.severity.high': '高',
  'common.severity.medium': '中',
  'common.severity.low': '低',
  'web.review.title': '审阅发现',
  'web.review.none': '没有发现问题',
  'web.review.count': '{length} 个问题',
  'web.review.basis': '依据：{basis}',
  'web.trajectory.total': '共 {formatElapsed}',
  'web.trajectory.noTimestamps': '这个会话的事件没有时间戳',
  'web.trajectory.toggleTimeline': '显示 / 收起时间线',
  'common.searchEllipsis': '搜索…',
  'web.trajectory.search': '搜索轨迹',
  'web.trajectory.noMatch': '没有匹配的步骤。',
  'web.credential.missing': '还没有配置{v}的 API key。',
  'web.credential.goSettings': '去「设置 › 模型供应商」填写',
  'web.credential.noRestart': '，保存后立即生效，不用重启。',
  'web.composer.cannotRead': '读不了这个文件',
  'common.remove': '去掉',
  'web.composer.quoteSession': '引用 {sessionId}',
  'web.composer.searchFiles': '搜索文件…',
  'web.composer.searchSkills': '搜索技能…',
  'web.composer.upload': '上传附件…',
  'web.composer.uploadHint': '（也可以直接粘贴或拖进输入框）',
  'web.composer.noFiles': '没有匹配的文件',
  'web.composer.noSkills': '没有匹配的技能',
  'web.composer.pickerKeys': '↑↓ 选择 · Enter 确定 · Esc 关闭',
  'web.composer.send': '发送',
  'web.composer.uploadFailed': '有附件没传上去，去掉它再发',
  'web.composer.startFirst': '开始之后可以引用文件、上传附件',
  'web.composer.file': '文件',
  'web.composer.uploading': '上传中',
  'web.composer.attachment': '附件',
  'web.composer.skill': '技能',
  'web.composer.input': '输入',
  'web.composer.fileHint': '引用工作目录里的文件，或上传附件（也可以输入 @）',
  'web.composer.skillHint': '这一轮指定一个技能（也可以输入 /）',
  'web.composer.planHint': '计划模式下 domi 只读代码，想好方案后提交给你审批，批准后才动手',
  'common.actMode': '执行模式',
  'web.composer.switchedLost': '已切换。新模型不支持：{join}',
  'web.composer.modelName': '模型名',
  'web.composer.switchModel': '切换模型',
  'web.composer.switchModelHint': '搜索或填模型名，回车',
  'common.cancel': '取消',
  'web.composer.model': '模型',
  'web.composer.noImages': ' · 不支持图片',
  'web.composer.searchOrType': '搜索 / 手填…',
  'web.changes.added': '新增',
  'web.changes.modified': '修改',
  'web.changes.deleted': '删除',
  'web.changes.renamed': '改名',
  'web.changes.squash': '压成一个提交',
  'web.changes.squashHint': '推荐：原仓库多一个提交',
  'web.changes.merge': '合并带回',
  'web.changes.mergeHint': '保留这里的每个提交',
  'web.changes.branchOnly': '只留分支',
  'web.changes.branchOnlyHint': '不动原仓库的当前分支',
  'web.changes.basedOn': '，基于 ',
  'web.changes.branch': '分支',
  'web.changes.repo': '；原仓库',
  'web.changes.none': '还没有改动',
  'web.changes.discard': '丢弃',
  'web.changes.binary': '（二进制或空文件）',
  'web.changes.truncated': '\n…（太长，已截断）',
  'web.changes.filesChanged': '个文件改动',
  'common.collapse': '收起',
  'common.view': '查看',
  'web.changes.apply': '带回',
  'web.changes.undoDiscard': '撤销丢弃：',
  'web.changes.applyTo': '带回原仓库：',
  'web.changes.confirmAgain': '会再请你确认一次',
  'web.session.answeredElsewhere': '这个询问已经在别处回答过了',
  'web.session.toTask': '转为任务',
  'web.session.busy': '正在处理上一条…',
  'web.session.placeholder': '说点什么…  (Enter 发送，Shift+Enter 换行，@ 引用文件，/ 指定技能)',
  'web.session.chat': '会话',
  'web.session.title': '会话标题',
  'web.session.clickRename': '点击改名',
  'common.untitled': '未命名',
  'web.session.reviewHint': '派一个只读的审阅者，对照需求审这个会话目录里的未提交改动（看不到对话历史）',
  'web.session.review': '审阅改动',
  'web.session.deleteHint': '删除会话（可在全部会话里恢复）',
  'common.confirmDelete': '确认删除',
  'web.session.delete': '删除会话',
  'common.noProject': '无项目',
  'web.sessions.sub': '跨项目的所有会话和任务。按项目分组。',
  'web.sessions.filter': '筛选会话…',
  'web.sessions.showDeleted': '显示已删除（回收站）',
  'web.sessions.noMatch': '没有匹配的会话。',
  'common.task': '任务',
  'web.sessions.meta': '{model} · {eventCount} 事件{v}{v2}',
  'common.restore': '恢复',
  'web.runs.pending': '等待',
  'common.inProgress': '进行中',
  'web.runs.done': '完成',
  'web.runs.blocked': '被挡住',
  'web.runs.cancelled': '已取消',
  'web.runs.waitingDaemon': '等待 domid 恢复',
  'web.runs.cancel': '取消这次运行',
  'web.runs.needs': ' · 依赖 {join}',
  'web.runs.attempt': ' · 第 {attempt} 次',
  'web.runs.viewProcess': '看过程',
  'common.retry': '重试',
  'web.runs.none': '还没有多节点运行。计划拆成多步时会自动出现在这里。',
  'web.runs.yamlAdvanced': '高级：粘贴 YAML 开始一次运行',
  'web.runs.yamlDocs': '写法见 docs/tasks-example.yaml',
  'common.start': '开始',
  'web.projects.sub': '所有 workspace / 仓库。点击进入项目详情。',
  'web.projects.filter': '筛选项目…',
  'web.projects.showArchived': '显示已归档',
  'web.projects.none': '没有项目。',
  'common.archived': '已归档',
  'web.projects.meta': '{path} · {taskCount} 个任务',
  'common.unarchive': '取消归档',
  'common.auto': '自动',
  'common.always': '总是',
  'common.never': '从不',
  'web.project.notFound': '找不到这个项目。',
  'web.common.connectFirst': '连上 daemon 后显示。',
  'web.project.name': '项目名',
  'common.rename': '改名',
  'web.project.archivedNoTask': '项目已归档，取消归档后才能开始新任务',
  'web.project.startPlaceholder': '在这个项目里开始新任务…',
  'common.startTask': '开始任务',
  'web.project.history': '历史任务',
  'web.project.noTasks': '还没有任务。',
  'web.project.settings': '项目设置',
  'web.project.isolate': '在单独的工作区里改',
  'web.project.isolateHint':
    '自动 = 你的工作区有未提交改动、或由定时触发时，任务在单独的工作区里改，改完在任务顶部审阅、带回',
  'web.project.reviewPlan': '计划先给我审',
  'web.project.reviewPlanHint': '自动 = 多步任务或要改的文件较多时才先审；只作用于新建任务时系统开的规划',
  'web.project.archive': '归档项目',
  'web.settings.general': '通用',
  'web.settings.models': '模型供应商',
  'web.settings.messaging': '通讯工具',
  'web.settings.memory': '记忆管理',
  'web.settings.soul': 'Soul 与人格',
  'web.settings.plugins': '插件',
  'web.settings.usage': '用量统计',
  'web.settings.runtime': '运行时',
  'web.settings.maxToolCalls': '单轮最大工具调用',
  'web.settings.maxToolCallsHint': '一轮里最多调用多少次工具（1-1000，默认 100）',
  'web.settings.maxArgParseRetries': '参数解析重试上限',
  'web.settings.maxArgParseRetriesHint': '工具参数解析失败时最多重试几次（1-100，默认 3）',
  'web.settings.maxWallClockMs': '单轮最长耗时（毫秒）',
  'web.settings.maxWallClockMsHint': '一轮从开始到结束最多跑多久（1000-86400000，默认 600000）',
  'web.settings.review': '危险能力审核档位',
  'web.settings.reviewHint': '危险操作（写文件、跑命令、调外部服务）何时问人；任何档位都不会悄悄执行',
  'web.settings.reviewOnDemand': '按需（推荐）：有规则放就放行，没规则才问',
  'web.settings.reviewAlways': '每次都问：危险操作无论规则如何都要本人确认',
  'web.settings.reviewAllowAll': '全部放行：非危险操作不问；危险操作仍问（不可关闭）',
  'web.settings.language': '界面语言',
  'web.settings.languageHint': '选择 domi 界面显示语言；Web 与 TUI 共用，切换后页面会重新载入',
  'web.settings.theme': '主题',
  'web.settings.themeHint': '深浅跟随这台设备；主题色在 Web 与 TUI 之间共用',
  'common.followSystem': '跟随系统',
  'web.settings.dark': '深色',
  'web.settings.light': '浅色',
  'web.settings.accent': '主题色',
  'web.settings.messagingSoon': '通讯工具即将支持。',
  'web.settings.telegram': 'Telegram 桥接',
  'web.settings.telegramHint': '只读轨迹 + 远程审批（即将支持）',
  'web.settings.wechat': '微信桥接',
  'web.settings.wechatHint': '仅只读通知（即将支持）',
  'web.settings.strategyFull': '不处理（整段历史原样发给模型）',
  'web.settings.strategyClean': '结构化清理（去重工具结果、清错误、截断堆栈）',
  'web.settings.strategyCompact': '清理 + 自动压缩（到阈值时摘要旧的轮次）',
  'web.settings.strategy': '上下文策略',
  'web.settings.strategyHint': '发给模型之前怎么处理历史',
  'web.settings.keepTurns': '最近 N 轮逐字保留',
  'web.settings.keepTurnsHint': '压缩时最近 N 轮不摘要，建议 6-10（自动压缩时才用）',
  'web.settings.compactAt': 'Context 压缩触发阈值',
  'web.settings.compactAtHint': '上下文占用超此百分比自动压缩，建议 70-75（自动压缩时才用）',
  'web.settings.extractEvery': '记忆抽取间隔',
  'web.settings.extractEveryHint': '每多少轮自动抽取 L3 语义记忆，0 = 不自动抽（重启 domid 后生效）',
  'web.settings.sub': '配置 domi 的行为、外观和连接。',
  'web.settings.nav': '设置分类',
  'web.common.connectFirstDot': '连上 daemon 后显示。',
  'web.schedule.cron': 'cron 表达式',
  'web.schedule.tz': '时区',
  'web.schedule.cronHint': '分 时 日 月 周，例如 0 9 * * 1-5 = 工作日早上 9 点',
  'web.schedule.next': '接下来：{join}',
  'web.schedule.ran': '已运行',
  'web.schedule.skipped': '跳过',
  'web.schedule.notCreated': '没建成',
  'web.schedule.neverRan': '还没有运行过。',
  'web.schedule.catchUp': '补跑',
  'web.schedule.openTask': '打开任务',
  'common.goal': '目标',
  'web.schedule.paused': '已暂停',
  'web.schedule.noMore': '不会再运行',
  'web.schedule.nextAt': '下次 {formatWhen}',
  'web.schedule.runNowHint': '立即运行一次',
  'web.schedule.run': '运行',
  'common.resume': '恢复',
  'common.pause': '暂停',
  'web.schedule.history': '历史运行',
  'common.edit': '编辑',
  'web.schedule.deleteHint': '删除定时任务（已经运行过的任务不动）',
  'common.new': '新建',
  'common.loading': '加载中…',
  'web.schedule.none': '还没有定时任务。每天或每周要做的事，可以交给它按时跑。',
  'web.addProject.dir': '目录',
  'web.addProject.dirHint': 'daemon 那台机器上的已有目录；同一目录只登记一次',
  'web.addProject.name': '名字',
  'web.addProject.nameHint': '留空 = 目录名',
  'common.add': '添加',
  'web.toTask.pickProject': '选择项目…',
  'web.toTask.hint': '在项目里新建一个任务，这个会话的全文作为引用带过去；这个会话本身不变。',
  'web.toTask.goalHint': '这个任务要达成什么、交付什么',
  'web.toTask.noProjects': '还没有项目，先在侧栏「项目」里添加一个。',
  'web.home.sub': '不关联项目的自由讨论。要在某个仓库里动手，用「新任务」。',
  'web.home.placeholder': '有什么想聊的？  (Enter 发送，Shift+Enter 换行)',
  'web.home.start': '开始对话',
  'web.home.attachLater': '附件与文件引用在对话开始之后可用',
  'web.home.recent': '最近会话',
  'web.home.meta': '{model} · {eventCount} 事件',
  'web.tasks.newSchedule': '新建定时任务',
  'web.tasks.projectHint': '任务一定属于某个项目；没有的话先在侧栏「项目」里添加',
  'web.tasks.when': '计划时间',
  'web.tasks.whenHint': 'cron 表达式与时区；到点时按下面的目标新建一个任务',
  'web.tasks.schedulePlaceholder': '每次运行要达成什么？  (Enter 创建)',
  'web.tasks.taskPlaceholder': '这个任务要达成什么？  (Enter 开始)',
  'web.tasks.createSchedule': '创建定时任务',
  'web.tasks.meta': '{v}{model} · {eventCount} 事件',
  'web.tasks.title': '任务',
  'web.tasks.sub': '有明确目标与产出的工作。后台执行，进程重启后自动恢复。',
  'web.tasks.recent': '最近任务',
  'web.tasks.runs': '编排运行',
  'web.tasks.connectFirst': '连上 daemon 后显示定时任务与编排运行。',
  'web.soul.pending': '待审阅的改动（{length}）',
  'web.soul.pendingHint': 'domi 根据记忆提议的修改。否决会撤回文件里的那一处，之后不再提',
  'common.accept': '接受',
  'common.reject': '否决',
  'web.soul.recent': '最近学到的记忆',
  'web.soul.keywordOnly': '只按关键词匹配（daemon 没有配置 memory.embedding）',
  'web.soul.noItems': '没有条目。',
  'web.soul.kept': '已保留',
  'web.soul.keep': '保留',
  'web.soul.exportRejected': '导出被拒绝：这些行里有凭据、本机路径或邮箱，改掉再导出——{join}',
  'web.soul.nothingToImport': '没有新内容可导入',
  'web.soul.markdown': '人格描述（Soul Markdown）',
  'web.soul.markdownHint': '人类可读、可 diff、可手改。修改后下次对话生效；你改过的行 domi 不会再动',
  'web.soul.empty': '还没有内容。对话攒够几轮之后会自动生成，也可以直接写。',
  'common.saved': '已保存',
  'web.soul.revert': '撤销修改',
  'web.soul.refreshed': '已用全部记忆过了一遍',
  'web.soul.refresh': '用全部记忆更新',
  'common.export': '导出',
  'web.soul.import': '导入…',
  'web.soul.importing': '导入 {name}',
  'web.soul.importHint': '别人写的内容只作参考资料，不会被当成指令。勾选要导入的区，导入后仍可在待审阅里逐条否决',
  'web.soul.importSelected': '导入选中的 {size} 个区',
  'web.soul.imported': '导入了 {imported} 条',
  'web.soul.search': '检索记忆',
  'web.soul.searchPlaceholder': '检索记忆…',
  'web.soul.searchButton': '检索',
  'web.soul.rejected': '已否决（之后检索不到，事件仍在）',
  'web.providers.cap.toolCall': '工具调用',
  'web.providers.cap.toolCallHint': '能读写文件、跑命令；关掉时这家的模型只能聊天',
  'web.providers.cap.vision': '看图',
  'web.providers.cap.visionHint': '附件里的图片作为图片发给模型',
  'web.providers.cap.reasoning': '思考过程',
  'web.providers.cap.reasoningHint': '模型的思考段单独显示',
  'web.providers.cap.promptCache': '提示缓存',
  'web.providers.cap.promptCacheHint': '稳定前缀走缓存，省钱',
  'web.providers.cap.structured': '结构化输出',
  'web.providers.cap.structuredHint': '标题、摘要等用原生 JSON 模式',
  'web.providers.compatible': '{label} 兼容',
  'common.envVar': '环境变量',
  'web.providers.noKeyEnv': '还没有 key（也可以设环境变量 {join}）',
  'web.providers.noKey': '还没有 key',
  'web.providers.keyFrom': '（来自{v}）',
  'web.providers.envWins': '，环境变量优先，这里改了不会生效',
  'web.providers.keyCurrent': '当前 {v}{where}{env}。留空不改',
  'web.providers.defaultModel': '默认模型',
  'web.providers.defaultModelHint': '新建会话时使用；在下面任意一家的模型列表里点「设为默认」',
  'web.providers.add': '新增供应商',
  'web.providers.probing': '探测中…',
  'web.providers.reprobe': '重新探测',
  'web.providers.hasDefault': '默认模型在这一家',
  'web.providers.cannotDelete': '默认模型在这一家，先把默认模型换到别家',
  'common.delete': '删除',
  'web.providers.inferred': '。按旧写法推断的厂商，保存一次就固定下来',
  'web.providers.disabled': '已停用：不探测，也不出现在对话的模型下拉里',
  'web.providers.probeFailed': '探测失败（{v}），下面是手填的模型',
  'web.providers.modelsOf': '{name} 的模型',
  'web.providers.setDefault': '设为默认',
  'web.providers.manualTag': '·手填',
  'web.providers.noModels': '没有可用的模型：填上 key 后重新探测，或手填模型',
  'web.providers.keyOnlyIn': 'key 只写进',
  'web.providers.keyNotIn': '（权限 0600），不写进',
  'web.providers.keyNoEcho': '，也不会回显到这里。',
  'web.providers.tooOpen': '这个文件的权限比 0600 宽，建议 chmod 600。',
  'web.providers.editing': '编辑 {name}',
  'web.providers.name': '名称',
  'web.providers.nameHint': '界面上显示的名字',
  'web.providers.idHint': '配置里的键；建好后不能改',
  'web.providers.idFixed': '建好后不能改',
  'web.providers.vendor': '厂商',
  'web.providers.vendorHint': '决定默认地址、协议与能力',
  'web.providers.protocol': '协议',
  'web.providers.protocolHint': '网关说的是哪家的接口',
  'web.providers.protocolFixed': '由厂商决定',
  'web.providers.baseUrlHint': '留空用厂商默认地址',
  'web.providers.keyNew': '只写进 secrets.yaml',
  'web.providers.models': '手填模型',
  'web.providers.modelsHint': '探测不到时用它们，也会补进探测结果；逗号分隔',
  'common.enabled': '启用',
  'web.providers.enabledHint': '停用后不探测，也不出现在对话的模型下拉里',
  'web.providers.caps': '能力',
  'web.providers.capsHint': '默认值来自厂商模板；自定义网关全关，确认它支持再打开',
  'web.usage.thisMonth': '本月',
  'web.usage.lastMonth': '上月',
  'common.all': '全部',
  'web.usage.none': '这段时间没有用量。',
  'web.usage.modelSpend': '{model} 花费 {fmtCost}',
  'web.usage.modelRow': '{model}：{fmtCost} · {fmtTokens} tokens',
  'web.usage.spend': '{label}花费',
  'web.usage.sessions': '会话数',
  'web.usage.cacheHit': 'Cache 命中率',
  'web.usage.permissions': '权限请求',
  'web.usage.unpriced': '价目表里没有这些模型，它们的花费显示为「—」且不计入合计：{join}',
  'web.usage.byModel': '按模型',
  'web.usage.total': '累计 ',
  'web.settings.savedRestart': '已保存。{join} 要重启 domid 才生效',
  'web.settings.savedNextTurn': '已保存，下一轮生效',
  'web.plugins.tools': '{length} 个工具',
  'web.plugins.skills': '{skills} 个 skill',
  'common.listSep': '、',
  'web.plugins.sandbox': '沙箱：{v}',
  'web.plugins.none': '还没有安装插件。终端里：',
  'web.plugins.installCmd': 'domi plugin install <目录>',
  'common.disable': '停用',
  'common.enable': '启用',
  'web.plugins.clickDisable': '点一下停用',
  'web.plugins.clickEnable': '点一下启用',
  'common.notEnabled': '未启用',
  'common.branchSuffix': ' · 分支',
  'web.soul.lineKind': '第 {line} 行（{kind}）',
  'common.unknownReason': '未知原因',
  'web.plugins.noSandbox': '没有（带代码的插件不会运行）',
  'common.deletedSuffix': ' · 已删除',
  'web.credential.theModel': '模型',
  'web.plugins.enabledRestart': '已启用 {name}。它带的 MCP server 要重启 domid 才会连上',
  'web.plugins.enabledOne': '已启用 {name}',
  'web.plugins.disabledOne': '已停用 {name}',
  'web.settings.langZh': '简体中文',
  'web.settings.langEn': 'English',
  'core.timeline.thinking': '思考',
  'core.timeline.answer': '回答',
  'core.client.notConnected': '未连接到 daemon，无法调用 {method}',
  'core.client.closed': '连接已关闭',
  'core.client.unreachable': '连不上 daemon',
  'core.client.startDaemonHint': '在终端跑 `pnpm domid` 启动后台进程',
  'core.client.dropped': '连接已断开',
  'core.ev.cleanup': '上下文清理 {tokensBefore} → {tokensAfter} tokens',
  'core.ev.cleanupDetail': '去重 {dedupe} · 截断 {verbose} · 已解决错误 {resolvedError} · 堆栈 {stack}',
  'core.ev.compact': '上下文已压缩 {tokensBefore} → {tokensAfter} tokens（保留最近 {keptTurns} 轮）',
  'core.ev.spawn': '派出子 agent：{goal}',
  'core.ev.runStart': '任务开始：{name}',
  'core.ev.nodeStart': '开始',
  'core.ev.nodeDone': '完成',
  'core.ev.nodeFailed': '失败',
  'core.ev.elapsed': '（{formatElapsed}）',
  'core.ev.node': '节点 {nodeId} {label}{v}{ms}',
  'core.ev.resume': '任务恢复：已完成 {length} 个节点{v}',
  'core.ev.hook': '钩子 {name}{v}',
  'core.ev.trust': '信任这个仓库：{root}',
  'core.ev.untrusted': '没有加载这个仓库的规矩文件（未信任）：{root}',
  'core.ev.unverifiedEnd': '没有通过验证就结束了',
  'core.ev.verifyNudge': '提醒模型先验证再结束',
  'core.ev.planMode': '进入计划模式（只读）',
  'core.ev.actMode': '进入执行模式',
  'core.ev.planProposed': '提交了计划，等你审批',
  'core.ev.planApproved': '计划已批准{v}',
  'core.ev.planRejected': '计划被驳回',
  'core.ev.worktree': '在隔离工作区里干活：{branch}',
  'core.ev.applied': '改动{v}带回原仓库（{mode}）',
  'core.ev.budgetWarn': '用量到了上限的 80%（{kind}：{used} / {limit}）',
  'core.ev.budgetDecided': '用量到顶，你选择了：{v}',
  'core.ev.findings': '审阅发现 {length} 条问题',
  'core.listSepStrong': '；',
  'core.ev.pluginError': '插件 {plugin}{v} 出错：{message}',
  'core.ev.retry': '重试节点 {nodeId}',
  'core.ev.runDone': '完成',
  'core.ev.runFailed': '失败',
  'core.ev.runCancelled': '已取消',
  'core.ev.runEnd': '任务{label}',
  'core.ev.ref': '引用了会话 {sessionId} 的第 {fromSeq}–{toSeq} 条',
  'core.ev.modelSwitch': '模型切换 {from} → {to}{v}',
  'core.ev.lost': '新模型不支持：{join}',
  'core.ev.discard': '丢弃了 {path} 的改动',
  'core.ev.undoHint': '撤销：回收站 {trash}',
  'core.ev.undone': '恢复了 {path} 的改动',
  'core.ev.attempt': '（第 {attempt} 次）',
  'core.ev.rerun': '，重跑 {join}',
  'core.ev.hookTimeout': ' 超时',
  'core.ev.hookBlocked': ' 拦下了调用',
  'core.ev.hookExit': '（{on}，退出码 {exitCode}）',
  'core.ev.toRun': '，转成长任务 {runId}',
  'core.ev.appliedOk': '已',
  'core.ev.appliedFail': '没能',
  'core.ev.continue': '继续',
  'core.ev.stop': '停止',
  'core.ev.raise': '提高上限',
  'core.ev.pluginTool': ' 的 {tool}',
  'core.ev.provider': '（{provider}）',
  'core.palette.blue': '蓝',
  'core.palette.green': '绿',
  'core.palette.orange': '橙',
  'core.palette.purple': '紫',
  'core.palette.pink': '粉',
  'core.verify.unverified': '已改未验',
  'core.verify.verified': '已验证',
  'core.verify.failed': '验证失败',
  'tui.review.usage':
    '用法：\n  domi review [--base <提交>] [--spec <需求文档>]...\n    审阅当前目录相对 base（默认 HEAD，含未提交与未跟踪的改动）的 diff。\n    审阅者是一个只读的新会话：看得到需求文档与 diff，看不到任何对话历史。',
  'tui.review.none': '没有发现问题。',
  'tui.review.found': '发现 {length} 个问题：',
  'tui.review.line': '第 {line} 行：',
  'tui.review.basis': '      依据：{basis}',
  'tui.review.started': '审阅会话 {id} 开始了（只读，Web / TUI 里都能看过程）……',
  'tui.review.noFindings': '审阅者没有交出结构化发现就结束了。{v}',
  'tui.tag.branch': '分支',
  'tui.tag.deleted': '已删除',
  'tui.sessions.row': '{v} {id}  {v2}  {model} · {eventCount} 条{v3}',
  'tui.budget.set': '已设上限：到 80% 会提醒，到顶暂停问你',
  'tui.changes.noneFor': '{path} 没有改动',
  'tui.changes.none': '隔离工作区（{branch}）里还没有改动',
  'tui.changes.header': '{branch} 相对 {slice} 的改动（/changes <文件> 看 diff，/apply 带回）：',
  'tui.changes.discarded': '已丢弃 {path} 的改动（/undo {trash} 撤销）',
  'tui.changes.restored': '已恢复 {path} 的改动',
  'tui.mode.alreadyPlan': '已经是计划模式了',
  'tui.mode.alreadyAct': '已经是执行模式了',
  'tui.branch.switched': '已切到分支 {id}（从第 {atSeq} 条分出）',
  'tui.ref.pending': '下一句话会带上 {length} 段引用（最近一段：会话 {sessionId}）',
  'tui.session.switched': '已切到会话 {id}',
  'tui.session.deleted': '已删除会话 {sessionId}（事件都还在，/restore {sessionId2} 可以恢复）',
  'tui.session.restored': '已恢复会话 {sessionId}（/open {sessionId2} 打开）',
  'tui.soul.noPending': '没有待审阅的改动。Soul 在 {path}，可以直接编辑',
  'tui.soul.pending': '待审阅 {length} 处（/soul accept|reject <id>）：',
  'tui.memory.none': '没有相关的条目',
  'tui.memory.extracted': '从这个会话新记下 {length} 条，Soul 改了 {length2} 处',
  'tui.cmd.new': '新会话',
  'tui.cmd.sessions': '列出会话',
  'tui.cmd.argSession': '<会话 id>',
  'tui.cmd.open': '打开会话',
  'tui.cmd.delete': '删除会话（可恢复）',
  'tui.cmd.restore': '恢复删除的会话',
  'tui.cmd.branch': '从这里分支',
  'tui.cmd.argRef': '<会话 id> [起-止]',
  'tui.cmd.ref': '下一句话引用另一个会话',
  'tui.cmd.plan': '切到计划模式',
  'tui.cmd.act': '切回执行模式',
  'tui.cmd.argModel': '[模型]',
  'tui.cmd.model': '换模型（不带参数打开模型列表）',
  'tui.cmd.compact': '压缩上下文',
  'tui.cmd.argBudget': 'tokens|cost|calls <数>',
  'tui.cmd.budget': '设用量上限',
  'tui.cmd.argFileOpt': '[文件]',
  'tui.cmd.changes': '看单独工作区里的改动',
  'tui.cmd.argFile': '<文件>',
  'tui.cmd.discard': '丢弃一个文件的改动',
  'tui.cmd.argTrash': '<编号>',
  'tui.cmd.undo': '撤销丢弃',
  'tui.cmd.apply': '把改动带回原仓库',
  'tui.cmd.soul': 'Soul 待审阅的改动',
  'tui.cmd.argQuery': '[关键词]',
  'tui.cmd.memory': '查记忆',
  'tui.cmd.extract': '从这个会话提取记忆',
  'tui.cmd.settings': '设置（语言）',
  'tui.settings.title': '设置 · 语言',
  'tui.settings.appliesOnRestart': '语言已保存，重启后生效',
  'tui.usage.model': '用法：/model [模型名]——只填模型名，供应商由设置决定',
  'tui.usage.branchEmpty': '对话还是空的，没有可以分支的地方',
  'tui.usage.branch': '用法：/branch [seq]',
  'tui.usage.ref': '用法：/ref <会话 id> [起-止]，下一句话会带上这段引用',
  'tui.usage.sessions': '用法：/sessions [--all]',
  'tui.usage.sessionArg': '用法：{cmd} <会话 id>（/sessions 可以看到 id）',
  'tui.usage.soul': '用法：/soul 看待审阅的改动；/soul accept|reject <改动 id>',
  'tui.usage.budget': '用法：/budget tokens <数量> | /budget cost <美元> | /budget calls <次数>',
  'tui.usage.discard': '用法：/discard <文件>',
  'tui.usage.undo': '用法：/undo <回收站编号>（/discard 时给出的）',
  'tui.usage.apply': '用法：/apply [squash|merge|branch]',
  'tui.week.0': '周日',
  'tui.week.1': '周一',
  'tui.week.2': '周二',
  'tui.week.3': '周三',
  'tui.week.4': '周四',
  'tui.week.5': '周五',
  'tui.week.6': '周六',
  'tui.cron.daily': '每天 {at}',
  'tui.cron.weekdays': '工作日 {at}',
  'tui.cron.weekly': '每{v} {at}',
  'tui.cron.monthly': '每月 {dom} 日 {at}',
  'tui.ago.now': '刚刚',
  'tui.ago.minutes': '{m} 分钟前',
  'tui.ago.hours': '{h} 小时前',
  'tui.ago.yesterday': '昨天',
  'tui.ago.days': '{d} 天前',
  'tui.projects.meta': '{path} · {taskCount} 任务',
  'tui.sessions.otherProject': '其他项目',
  'tui.sessions.unread': '未读 · {ago}',
  'tui.tasks.scheduled': '定时',
  'tui.tasks.pausedCron': '{describeCron} · 已暂停',
  'tui.models.default': '默认',
  'tui.models.manual': '手填',
  'tui.models.notProbed': '未探测到',
  'tui.models.noTools': '不能用工具',
  'tui.models.noImages': '不支持图片',
  'tui.models.search': '搜索模型或供应商…',
  'tui.models.none': '没有可用的模型：到 Web「设置 › 模型供应商」添加',
  'tui.key.select': '选择',
  'tui.key.switch': '切换',
  'tui.key.close': '关闭',
  'tui.models.probeFailed': '探测失败：{join}',
  'tui.help.projects': '项目',
  'tui.help.sessions': '会话',
  'tui.help.tasks': '任务',
  'tui.help.send': '发送',
  'tui.help.newline': '换行',
  'tui.help.commands': '命令（Tab 补全）',
  'tui.help.permission': '允许 / 拒绝 / 本会话始终允许',
  'tui.help.quit': '退出（任务在 domid 里继续）',
  'tui.help.title': '帮助',
  'tui.help.singleKeys': '单键只在输入框为空时生效',
  'tui.help.commandsHeader': '命令',
  'tui.projects.title': '项目选择',
  'tui.projects.search': '搜索项目…',
  'tui.key.newTask': '新任务',
  'tui.sessions.title': '会话历史',
  'tui.sessions.search': '搜索会话…',
  'tui.key.open': '打开',
  'tui.tasks.scheduleCreated': '定时任务已创建',
  'tui.tasks.title': '计划任务',
  'tui.tasks.none': '没有进行中的任务，也没有定时任务。按 n 新建',
  'tui.key.nextField': '换字段',
  'tui.key.pickProject': '选项目',
  'tui.key.create': '创建',
  'tui.key.back': '返回',
  'tui.key.new': '新建',
  'tui.key.openRun': '打开 / 运行',
  'tui.key.pauseResume': '暂停 / 恢复',
  'tui.form.cronOk': '时间表可用',
  'tui.form.noProjects': '还没有项目，先在 Web 端或用 domi -p 添加',
  'tui.form.goalPlaceholder': '这个任务要达成什么？',
  'tui.form.schedule': '定时',
  'tui.form.cronPlaceholder': '可选：0 9 * * 1-5',
  'tui.form.creating': '正在创建…',
  'tui.task.usage':
    '用法：\n  domi task run <文件.yaml> [--follow]   开始一次运行（在 domid 里跑，关掉终端也继续）；--follow 跟到结束\n  domi task list                          最近的运行\n  domi task status <runId>                各节点状态\n  domi task retry <runId> <节点>          只重跑一个失败节点（已完成的不动）\n  domi task cancel <runId>                取消\n\nYAML 的写法见 docs/tasks-example.yaml。运行会话在 Web 与 TUI 的会话列表里也能看到。',
  'tui.task.waitingDaemon': '（等待 domid 恢复）',
  'tui.task.attempt': ' 第 {attempt} 次',
  'tui.task.started': '已开始 {name}（{runId}），{length} 个节点：{join}',
  'tui.task.progress': '看进度：domi task status {runId}',
  'tui.task.waitingAsk': '  ⏸ 在等确认：{capabilityId}（去 TUI / Web / Telegram 回答）',
  'tui.task.none': '还没有运行过任务。',
  'tui.task.retrying': '已开始重跑 {v}',
  'tui.task.alreadyEnded': '这次运行已经结束了',
  'tui.revert.warning': '注意：回滚只还原文件。已执行的 shell 命令、已发出的网络请求、已 push 的 commit 都不会被撤销。',
  'tui.confirm.permission': '权限请求',
  'tui.confirm.title': '🔑 {title}：{capabilityId}',
  'tui.confirm.formInWeb': '这个请求要填表：请在 Web 端（pnpm web）回答；n 拒绝',
  'tui.confirm.keyReject': ' n 拒绝 ',
  'tui.confirm.keyApprove': ' y 批准 ',
  'tui.confirm.keyAllow': ' y 允许 ',
  'tui.confirm.keyAlways': '  a 本会话始终允许 ',
  'tui.confirm.enterRejects': '   Enter = 拒绝',
  'tui.revert.files': '只还原文件',
  'tui.revert.chat': '只作废对话',
  'tui.revert.both': '还原文件并作废对话',
  'tui.revert.to': '回滚到第 {toSeq} 步',
  'tui.revert.scope': '{scopeText} · 影响 {fileCount} 个文件',
  'tui.revert.keys': 'y 确认回滚 / n 取消（默认取消）',
  'tui.prompt.placeholder': '说点什么…  (Enter 发送，Ctrl+J 换行)',
  'tui.conn.connecting': '连接中',
  'tui.conn.reconnecting': '重连中',
  'tui.conn.incompatible': '版本不兼容',
  'tui.status.turn': '本轮 {formatElapsed} · ',
  'tui.status.running': '⏵ 运行中',
  'tui.context.chat': '▸ 会话',
  'tui.hint.projects': '项目',
  'tui.hint.sessions': '会话',
  'tui.hint.tasks': '任务',
  'tui.hint.commands': '命令',
  'tui.hint.help': '帮助',
  'tui.hint.quit': '退出',
  'tui.spinner.thinking': '思考中',
  'tui.overlay.empty': '没有内容',
  'tui.overlay.more': '… 共 {length} 项',
  'tui.slash.hints': 'tab 补全 · ↑↓ 选择{v}',
  'tui.connect.badToken':
    '{url} 拒绝了连接：token 不对或没带。\n把服务端的 token 设进 DOMI_TOKEN 再试；服务端没配 token 的话，它在那台机器的 ~/.domi/daemon.token 里。',
  'tui.connect.unreachable': '连不上 {url}{v}。确认对面的 domid 在跑、监听的是这个地址和端口。',
  'tui.connect.ambiguous': '有 {length} 个项目都叫「{arg}」，请改用路径：{join}',
  'tui.connect.noProject': '没有叫「{arg}」的项目。{v}也可以直接给路径：domi -p ./路径',
  'tui.bridge.usage':
    '用法：\n  domi bridge pair        生成配对码（5 分钟有效），然后在 Telegram 里给你的 bot 发 /pair <码>\n  domi bridge telegram    启动桥接（token 放 DOMI_TELEGRAM_TOKEN 或 config.yaml 的 bridge.telegram.token）\n\n桥接只推送长任务的进展与审批，不能从 Telegram 发起或修改任务；不发送任何文件内容。',
  'tui.bridge.code': '配对码：{code}（{v} 分钟内有效，用一次作废）\n在 Telegram 里给你的 bot 发：/pair {code2}',
  'tui.bridge.noToken': '没有 Telegram bot token。先找 @BotFather 建一个 bot，再设 DOMI_TELEGRAM_TOKEN。',
  'tui.bridge.started': '桥接已启动，Ctrl-C 退出。',
  'tui.review.lastPart': '\n最后一段：{slice}',
  'common.untitledParen': '（无标题）',
  'tui.models.failedItem': '{name}（{v}）',
  'tui.slash.total': ' · 共 {length} 个',
  'tui.connect.detail': '（{detail}）',
  'tui.connect.didYouMean': '是不是：{join}？',
  'common.unknown': '未知',
  'cli.data.exportHeader': '# 导出自 {path}（已去掉密钥；原文件的注释没有带过来）',
  'cli.data.willDelete': '将要永久删除：',
  'cli.data.total': '共 {length} 项，{mb}。**不可恢复。**',
  'cli.data.confirm': '想清楚了就输入 {confirmWord} 确认；想留一份先跑 domi data export。',
  'cli.ping.ok': '{provider}/{model} 有响应',
  'cli.ping.empty': '端点接受了请求但什么都没返回——多半是模型名不对',
  'cli.ping.badKey': '端点通了，但 key 不被接受：{msg}',
  'cli.ping.badModel': '端点通了、key 也过了，但模型名 "{model}" 找不到：{msg}',
  'cli.ping.unreachable': '连不上 {v}：{msg}',
  'cli.ping.timeout': '超时（15 秒）：{msg}',
  'cli.doctor.sandbox': '插件沙箱',
  'cli.doctor.unsandboxed': '插件代码在没有沙箱的情况下运行',
  'cli.doctor.unsandboxedDetail':
    '你打开了 plugins.allowUnsandboxed：插件能读写任何文件、访问任何网络。只在完全信任已装插件时这样做',
  'cli.doctor.noSandbox': '没有插件沙箱',
  'cli.doctor.noSandboxDetail': '这台机器没有 bwrap / sandbox-exec，{withCode} 个带代码的插件没有加载（docs/adr/023）',
  'cli.doctor.inferred': '按旧写法推断的 provider',
  'cli.doctor.inferredItem': '{id} → {vendor}（{protocol} 协议）',
  'cli.doctor.inferredHint':
    '。照常可用；想固定下来，在 Web「设置 › 模型供应商」里打开它保存一次，或在 config.yaml 里写上 vendor',
  'cli.doctor.config': '配置文件',
  'cli.doctor.noConfig': '配置文件不存在',
  'cli.doctor.noConfigDetail': '{configPath} 没找到。没有它也能跑（全部走环境变量），但建议建一个。',
  'cli.doctor.tomlIgnored': '旧的 TOML 配置被忽略了',
  'cli.doctor.tomlIgnoredDetail':
    '已经有 YAML 配置，{path} 已被忽略（docs/adr/014）。确认 YAML 里该有的都有了，就可以删掉它。',
  'cli.doctor.tomlInUse': '还在用旧的 TOML 配置',
  'cli.doctor.tomlInUseDetail': '{path} 现在还能读，但配置格式已改为 YAML（docs/adr/014），TOML 的支持会在 M4 去掉。',
  'cli.doctor.credential': '模型凭据',
  'cli.doctor.credentialSet': '已设置（{provider}）',
  'cli.doctor.noCredential': '没有模型凭据',
  'cli.doctor.needs': '{provider} 需要 {join}。',
  'cli.doctor.exportKey': '$ export {v}=你的key',
  'cli.doctor.snapshots': '步级快照',
  'cli.doctor.snapshotsOk': '可用（影子仓库）',
  'cli.doctor.snapshotsOff': '步级快照不可用',
  'cli.doctor.noGit': '没找到 git，agent 改坏文件时无法一键回滚。domi 仍能跑，但没有安全网。',
  'cli.doctor.gitFix': '$ git --version   # 装上 git 后重启 domi',
  'cli.doctor.search': '代码搜索',
  'cli.doctor.builtinSearch':
    '内置实现（没找到 ripgrep；大仓库里会慢，装上后自动改用：brew install ripgrep / apt install ripgrep）',
  'cli.doctor.ripgrep': 'ripgrep（{ripgrep}）',
  'cli.doctor.gateway': '自定义网关',
  'cli.doctor.endpoint': '模型端点',
  'cli.doctor.official': '{provider} 官方端点',
  'cli.doctor.connectivity': '连通性',
  'cli.doctor.pingDetail': '{detail}（{ms}ms）',
  'cli.doctor.unreachable': '连不上模型端点',
  'cli.doctor.loop': '运行时护栏',
  'cli.doctor.loopDetail':
    '单轮 maxToolCalls={maxToolCalls} · maxArgParseRetries={maxArgParseRetries} · maxWallClockMs={maxWallClockMs}',
  'cli.doctor.dataOk': '数据目录可写',
  'cli.doctor.dataBad': '数据目录不可写',
  'cli.doctor.dataBadDetail': '{dataDir} 写不进去，会话没法落盘。',
  'cli.doctor.allGood': '一切正常。',
  'cli.doctor.problems': '{bad} 项需要处理，上面每条都给了可以直接粘贴执行的命令。',
  'cli.args.unknown': '未知命令：{given}\n可用命令：{join}\n$ domi --help',
  'cli.plugin.usage':
    '用法：\n  domi plugin list                        已安装的插件、沙箱状态、没加载上的原因\n  domi plugin install <目录>              安装（逐条列出权限，确认后才装；装好后重启 domid 生效）\n  domi plugin remove <名字>               卸载\n  domi plugin scaffold <tool|skill|mcp> <目录> [名字]\n                                          生成插件骨架（自带 bun test）\n\n写法见 docs/site/plugin-dev.md。',
  'cli.plugin.none': '还没有安装插件。',
  'cli.plugin.counts': '    工具 {length} · skill {length2} · MCP {length3} · 面板 {length4}',
  'cli.plugin.needs': '\n插件 {name} {version}：{description}\n它需要：',
  'cli.plugin.confirm': '\n确认安装？[y/N] ',
  'cli.plugin.installed': '已安装 {name} {version}。重启 domid 后生效（关掉所有 domi 窗口，或 kill domid 进程）',
  'cli.plugin.removed': '已卸载 {v}。重启 domid 后生效',
  'cli.plugin.notInstalled': '没有安装 {v}',
  'cli.plugin.scaffolded':
    '已生成 {name}（{kind} 型）：\n{join}\n\n$ cd {dir} && bun test\n$ domi plugin install {dir2}',
  'cli.memory.usage':
    '用法：\n  domi memory list [--all]          列出记下的条目（--all 含已删除）\n  domi memory search <关键词>        检索\n  domi memory delete <id>            删除一条（之后检索不到，事件仍在）\n  domi memory extract <会话 id>      立刻从某个会话抽取',
  'cli.memory.none': '还没有记下任何东西。对话攒够几轮之后会自动抽取（memory.extractEvery）。',
  'cli.memory.item': '{id}  [{kind}] {text}{v}\n    来源 {refs}',
  'cli.memory.keywordOnly': '（只按关键词匹配：没有配置 memory.embedding）',
  'tui.memory.noneDot': '没有相关的条目。',
  'cli.memory.deleted': '已删除 {v}',
  'cli.memory.notFound': '没有 {v}（或者已经删过了）',
  'cli.memory.extracted': '新增 {length} 条，Soul 改了 {length2} 处',
  'cli.soul.usage':
    '用法：\n  domi soul show                    打印 Soul（文件在 ~/.domi/soul/soul.md，可以直接改）\n  domi soul review                  逐条审阅上次以来的改动：a 接受 / r 否决 / s 跳过\n  domi soul update                  用全部记忆重新过一遍（一次最多改 10 处）\n  domi soul export [文件]            导出成单个 Markdown（不含来源注释；有凭据或本机路径会拒绝）\n  domi soul import <文件>            导入别人的 Soul，逐区确认',
  'cli.soul.none': '还没有 Soul。对话攒够几轮之后会自动生成。',
  'cli.soul.path': '（{soulPath}）',
  'cli.soul.nothing': '没有要改的。',
  'cli.soul.noPending': '没有待审阅的改动。',
  'cli.soul.needsTty': '审阅需要在终端里交互进行。',
  'cli.soul.reviewPrompt': '[a]接受 / [r]否决 / [s]跳过 / [q]退出 > ',
  'cli.soul.exportRefused': '导出被拒绝：下面这些行里有凭据、本机路径或邮箱。改掉（或删掉）再导出——不替你静默替换：',
  'cli.soul.exportLine': '  第 {line} 行 [{kind}] {text}',
  'cli.soul.exported': '已导出到 {v}',
  'cli.soul.fileNotFound': '找不到 {file}',
  'cli.soul.importNeedsTty': '导入必须在终端里逐区确认；非交互环境不会合并任何内容。',
  'cli.soul.nothingToImport': '没有新内容可导入。',
  'cli.soul.importNotice': '导入的内容是别人写的：它会进你的提示词，但只作为参考资料，不会被当成指令。',
  'cli.soul.importSection': '导入这一区？[y/N] ',
  'cli.soul.imported': '导入了 {length} 条（{length2} 个区）。之后可以用 domi soul review 撤回。',
  'cli.hook.commitMsg': '提交信息里有不允许的内容：「{trim}」。去掉这一行再提交（规则来自用户的 commit-msg 钩子）。',
  'cli.hook.secretHit': '{file}：{slice}…',
  'cli.hook.secrets':
    '暂存区里有疑似凭据，拒绝提交：\n{join}\n把它们移出暂存区（git restore --staged <文件>）并改用环境变量。',
  'cli.hook.usage': '用法：domi hook commit-msg [额外的正则...] | domi hook secrets（在 config.yaml 的 hooks 里引用）',
  'cli.onboard.step1': '第 1 步 / 共 4 步：选一个模型供应商',
  'cli.onboard.step1Hint': 'anthropic · openai · google · openai-compatible（本地模型走最后一个）',
  'cli.onboard.step2': '第 2 步 / 共 4 步：填入 API Key',
  'cli.onboard.step2Hint': '也可以直接设环境变量后重启，key 不会被写进事件流或日志',
  'cli.onboard.step3': '第 3 步 / 共 4 步：校验连通性',
  'cli.onboard.step3Hint': '发一个最小请求确认 key 和网络都通，失败会告诉你是哪一环',
  'cli.onboard.step4': '第 4 步 / 共 4 步：开始对话',
  'cli.onboard.step4Hint': '试试「读一下 README 并总结三句话」',
  'cli.run.noEval': '评估层不可用（packages/eval 不在这份安装里）。其它命令不受影响。',
  'cli.run.noTrace': '轨迹层不可用（packages/trace 不在这份安装里）。其它命令不受影响。',
  'cli.init.alreadyProject': '{root} 里已经有 .domi/ 和规矩文件了，什么都没改。',
  'cli.init.created': '在 {root} 里新建了：\n{join}\n',
  'cli.init.projectHint':
    '规矩写进 AGENT.md，项目级 Skill 放 .domi/skills/<名字>/SKILL.md。第一次在这里打开会话时 domi 会问你是否信任这个仓库。',
  'cli.init.noLegacy': '没有找到 {legacy}，不需要迁移。\n$ domi init > {join}   # 从模板开始',
  'cli.init.convertedHeader':
    '# 由 {legacy} 转换而来（domi init --from-toml）。原文件的注释没法带过来，需要的话对照着补。',
  'cli.trust.none': '还没有答过任何仓库。',
  'cli.trust.trusted': '信任  ',
  'cli.trust.untrusted': '不信任',
  'cli.trust.revoked': '不再信任 {root}：它的 AGENT.md 与 .domi/skills 不会进提示词（下一个会话起生效）。',
  'cli.trust.granted': '已信任 {root}：它的 AGENT.md 与 .domi/skills 会进提示词（下一个会话起生效）。',
  'cli.session.restoreUsage': '用法：$ domi session restore <id>',
  'cli.session.notFound': '没有这个会话：{restoreId}\n$ domi session all   # 列出包括已删除在内的全部会话',
  'cli.session.restored': '已恢复 {restoreId}',
  'cli.session.none': '还没有会话。$ domi   # 开始第一次对话',
  'cli.session.row': '{id}  {when}  {v}  {messageCount} 条  {v2}',
  'cli.data.exportUsage': '用法：$ domi data export <目录>',
  'cli.data.exported': '导出了 {sessions} 个会话、{events} 条事件到 {dir}',
  'cli.data.typeConfirm': '\n请手动输入 {PURGE_CONFIRM_WORD} 确认（--yes 对 purge 无效）。',
  'cli.data.usage': '用法：$ domi data export <目录>   或   $ domi data purge',
  'common.or': ' 或 ',
  'cli.memory.deletedTag': '  （已删除）',
  'common.untitledParenAscii': '(未命名)',
  'cli.help': `domi —— 本地优先的 agent 运行时

用法：
  domi                      进入对话（最常用，不需要子命令）
  domi --chat               开自由会话（不带项目上下文，在 ~/.domi/scratch 里）；不加时在仓库里是任务、在别处是会话
  domi -p <项目名或路径>    在这个项目下开任务
  domi --isolate            在隔离工作区里开会话（git worktree，不碰你的工作区；改完审阅后再带回）
  domi --connect ws://主机:端口
                            连另一台机器上的 domid（token 放在环境变量 DOMI_TOKEN）
  domi doctor               体检；每条问题都给一条可直接粘贴执行的命令
  domi doctor --ping        额外发一次真实请求，区分「key 不对 / 网关没通 / 模型名错」
  domi init                 打印一份 config.yaml 模板
  domi init --from-toml     把旧的 config.toml 换成 YAML 打印出来（注释带不过来）
  domi init --project       在当前仓库建 .domi/（项目级 Skill）与 AGENT.md 模板
  domi trust [路径] [--revoke]  信任 / 取消信任一个仓库（信任后它的 AGENT.md 与 .domi/skills 才会被读）
  domi trust list           列出答过的仓库
  domi session list         列出会话
  domi session restore <id> 恢复软删除的会话
  domi data export <目录>    导出全部事件流与配置（JSONL + YAML，无私有格式）
  domi data purge           清空 ~/.domi（需要输入确认词）
  domi prompt dump          打印最终拼装的提示词与稳定前缀边界
  domi report-bug           打包日志（打包前会列出清单让你确认）
  domi eval record <id>     把一条真实会话导出成回放 fixture
  domi eval run             回放全部 fixture（不联网、不花钱）
  domi trace <id>           打印一条会话的轨迹树
  domi trace <id> --html f  导出单文件 HTML（离线可开）
  domi migrate              升级事件库结构；**先自动备份**，失败自动回滚
  domi memory list|search|delete|extract   记下的关于你的条目（L3）
  domi soul show|review|update|export|import   Soul：审阅改动、导出分享、导入别人的
  domi task run|list|status|retry|cancel      长任务编排（DAG，跑在 domid 里）
  domi bridge pair|telegram                   Telegram 桥接：生成配对码 / 启动桥接
  domi plugin list|install|remove|scaffold    插件：安装时逐条确认权限，代码跑在沙箱里
  domi review [--base 提交] [--spec 需求文档]...  派一个只读的审阅者对照需求审改动（看不到对话历史）
  domi hook commit-msg|secrets                示例钩子（在 config.yaml 的 hooks 里引用）

对话里：
  /compact                  手动压缩上下文
  /model [名字]             会话中途切换模型（不带名字打开模型列表；供应商由设置决定）
  /branch [seq]             从某一条（默认最后一条）分出一个新会话并切过去
  /ref <会话 id> [起-止]    引用另一个会话的一段，下一句话带上（不给区间就是整个会话）
  /plan  /act               计划模式（只读，想好方案提交审批）/ 回到执行模式
  /budget tokens|cost|calls <数>  这个会话的用量上限（到 80% 提醒，到顶暂停问你）
  /changes [文件]           隔离会话的改动清单（给文件名就显示它的 diff）
  /discard <文件>           丢弃一个文件的改动（/undo <编号> 撤销）
  /apply [squash|merge|branch]  把改动带回原仓库（会先问你）
  /sessions [--all]         列出会话（--all 含已删除的）
  /open <id>  /new          切到某个会话 / 新建一个
  /delete <id>  /restore <id>  软删除 / 恢复会话
  /soul                     看 Soul 待审阅的改动；/soul accept|reject <id>
  /memory [关键词]          看记下的关于你的条目；/extract 立刻从当前会话抽取

选项：
  -h, --help      看这个
  -v, --version   版本
      --json      机器可读输出
  -y, --yes       跳过确认（purge 不吃这一套）`,
  'cli.configTemplate': `# domi 配置（YAML，docs/adr/014）。环境变量优先于本文件。
# 放在 ~/.domi/config.yaml
# 默认模型：provider 是下面 providers 里的一个 id，name 是那一家的模型名
model:
  provider: anthropic
  name: claude-sonnet-4-5

# 模型供应商（docs/prd/M9.md）。键就是 id；Web「设置 › 模型供应商」里增删改的也是这里。
# key 不要写在这个文件里：设置页会写进 ~/.domi/secrets.yaml，或者用环境变量
# （DOMI_<ID>_API_KEY，以及各家惯用的 ANTHROPIC_API_KEY / OPENAI_API_KEY 等）
providers:
  anthropic:
    vendor: anthropic           # openai / anthropic / deepseek / gemini / custom：决定默认地址、协议与能力
  # my-gateway:
  #   name: 公司网关
  #   vendor: custom
  #   protocol: openai          # 只有 custom 要写：openai 或 anthropic
  #   base_url: http://localhost:4000/v1
  #   models: [qwen3-coder]     # 探测不到模型时手填
  #   capabilities:             # custom 默认全关；网关支持的话在这里打开
  #     toolCall: true

# 界面：语言 auto / zh / en（auto 跟随系统），主题色在 Web 与 TUI 之间共用
# ui:
#   locale: auto
#   accent: blue

context:
  maxTokens: 150000
  includeReasoning: false
  strategy: full                # full / clean（确定性清理）/ compact（清理 + 到阈值自动压缩）；见 docs/adr/005

# 权限默认拒绝。没在这里出现的能力一律不放行。
permissions:
  rules:
    - name: allow-read
      capability: fs.read
      decision: allow

    - name: confirm-write
      capability: fs.write
      decision: ask

    - name: confirm-shell
      capability: shell.exec
      decision: ask

    # 跨会话检索（PRD-M2-004）。它是读操作，但**历史里有你的原话**，
    # 所以「能不能翻旧账」由这条规则说了算，而不是由「它是读操作」说了算。
    # 删掉这条 = 默认拒绝，domi 就不会去翻历史了
    - name: allow-memory-search
      capability: memory.search
      decision: allow

    # 派子 agent：子 agent 的权限只会比当前会话小（docs/adr/020）
    - name: ask-task-spawn
      capability: task.spawn
      decision: ask

    # Skill 的正文是文字说明，读它不执行任何东西（docs/adr/019）
    - name: allow-skill-load
      capability: skill.load
      decision: allow

    # 插件工具以 plugin.<插件名>.<工具名> 出现（docs/adr/022）。插件能读写哪些文件、连哪些主机
    # 由安装时你确认的快照决定；调用本身仍按这里的规则问你
    - name: confirm-plugins
      capability: plugin.*
      decision: ask

    # 看网页、点界面：每一步都问你（ADR-016）。想放宽的话按工具名精确放行，
    # 比如 capability: mcp.computer.screenshot，别整组 allow
    - name: confirm-browser
      capability: mcp.browser.*
      decision: ask
    - name: confirm-computer
      capability: mcp.computer.*
      decision: ask

# MCP server（docs/adr/015、016）。工具以 mcp.<name>.<工具名> 出现，走上面的权限规则。
mcp:
  # HTTP server 允许访问的主机；没列出的一律拒绝（localhost 也要写）。支持 *.example.com
  allowedHosts: []
  servers:
    # 浏览器（Playwright MCP，微软官方）。把 enabled 改成 true 即可
    - name: browser
      command: npx
      args: [-y, "@playwright/mcp@0.0.81", --headless, --isolated]
      enabled: false
    # 桌面：截屏、鼠标、键盘、应用（macOS 需要给终端开「辅助功能」权限）
    - name: computer
      command: npx
      args: [-y, --prefer-offline, "@zavora-ai/computer-use-mcp@7.4.0"]
      enabled: false
    # 其它 server 照着写：stdio 用 command/args，HTTP 用 url
    # - name: docs
    #   url: https://mcp.example.com/mcp

# 记忆与 Soul（docs/adr/018、019）。Soul 在 ~/.domi/soul/soul.md，可以直接手改
# memory:
#   extractEvery: 5        # 每几轮抽取一次，0 = 只手动（domi memory extract <会话>）
#   soul: true             # false = 不更新 Soul、也不放进提示词
#   embedding:             # 配了才有语义检索；anthropic 没有 embedding 接口
#     provider: openai
#     model: text-embedding-3-small

# 长任务通知（domi task …，docs/adr/021）。只发状态，不发任何内容
# notify:
#   system: true                         # macOS / Linux 系统通知
#   webhook:
#     url: https://example.com/hook      # POST JSON；失败不影响任务

# Telegram 桥接：domi bridge pair 配对，domi bridge telegram 启动。token 更推荐放 DOMI_TELEGRAM_TOKEN
# bridge:
#   telegram:
#     token: "123456:ABC..."

# 插件（docs/adr/022、023）。domi plugin install <目录> 安装，domi plugin list 查看
# plugins:
#   enabled: true            # false = 一个插件都不加载
#   allowUnsandboxed: false  # 没有 bwrap / sandbox-exec 时是否仍加载带代码的插件（不建议）

# 钩子（docs/adr/025）：工具调用前（pre，非 0 退出 = 拦下）、后（post）、一轮结束后（stop）跑你的命令。
# **只认这个文件**，仓库里的任何文件都注册不了钩子。环境变量里有 DOMI_TOOL / DOMI_CMD / DOMI_PATH 等
# hooks:
#   - name: commit-msg          # 提交信息里不许有 Co-Authored-By 之类的署名行
#     on: pre
#     match: shell.exec
#     run: domi hook commit-msg
#   - name: secrets             # 暂存区里有疑似凭据就不许提交
#     on: pre
#     match: shell.exec
#     run: domi hook secrets
#   - name: format              # 改完文件自动格式化，输出附在工具结果上
#     on: post
#     match: fs.write
#     run: npx biome format --write "$DOMI_PATH"
#     timeoutMs: 20000

# 完成前验证（PRD-M7-004）：改了文件却没跑过验证就想结束时，domi 会提醒模型去验证
# verify:
#   command: pnpm check      # 不写就按 test / check / tsc / lint 等常见命令识别
#   maxNudges: 2

# 每个会话的用量上限（PRD-M7-009）：到 80% 提醒，到顶暂停问你
# budget:
#   costUsd: 2
#   toolCalls: 200

# 自定义提示词层（domi prompt dump 可以看拼装结果）。同 id 覆盖内置层，比如 builtin.conventions
# prompt:
#   layers:
#     - id: my.style
#       text: 回答要短，先给结论。

# domid 监听在哪（docs/adr/017）。默认只有本机能连，不用改。
# 要从别的机器连（domi --connect ws://这台机器:7437），把 host 改成 0.0.0.0：
# 这时必须有 token——不写的话 domid 会生成一个放进 ~/.domi/daemon.token
server:
  host: 127.0.0.1
  port: 7437
  # token: 至少 24 个字符（字母、数字、. _ ~ -）；更推荐用环境变量 DOMI_TOKEN
`,
  'trace.cumulative': '累计 {fmtCost}',
  'trace.folded': '{preview}\n（已折叠，共 {bytes} 字节；展开看全文）',
  'trace.truncated': '{join}\n（还有 {v} 行，共 {bytes} 字节；导出 HTML 看全文）',
  'trace.title': '轨迹 · {sessionId}',
  'trace.totalCost': '总花费：{fmtCost}',
  'trace.unpriced': '（价目表里没有：{join}，这部分不参与累计）',
  'trace.help':
    'domi trace —— 看清每一步在想什么\n\n  domi trace <sessionId>              在终端打印轨迹树\n  domi trace <sessionId> --html <路径>  导出单文件 HTML（无外部请求，可离线打开）\n\n会话 id 用 `domi session list` 看。轨迹完全由事件流渲染，没有独立埋点。',
  'trace.noEvents': '会话 {sessionId} 没有任何事件。用 `domi session list` 确认 id。',
  'trace.htmlNeedsPath': '--html 后面要跟一个文件路径',
  'trace.exported': '已导出 {htmlOut}（{length} 条事件；这个文件不发出任何网络请求，可以直接双击打开）',
  'trace.unknownEvent': '未知事件 {t}',
  'trace.youSaid': '你说',
  'trace.permission': '{capabilityId} → {decision}（来源：{source}{v}）',
  'trace.result': '结果',
  'trace.usage': '用量',
  'trace.errorRecoverable': '错误（可恢复）',
  'trace.error': '错误',
  'trace.preserved': '\n引用保留：{join}',
  'trace.subAgent': '子 agent：{goal}',
  'trace.childSession': '会话 {childSessionId}{v}',
  'trace.task': '任务：{name}',
  'trace.nodeStart': '节点 {nodeId} 开始（第 {attempt} 次）',
  'trace.nodeEnd': '节点 {nodeId} {v}',
  'trace.resume': '恢复',
  'trace.resumeDetail': '已完成：{v}\n重跑：{v2}',
  'trace.pluginError': '插件 {plugin} 出错',
  'trace.timeout': '超时',
  'trace.blocked': '拦下',
  'trace.exitCode': '退出码 {exitCode}',
  'trace.hook': '钩子 {name}（{on}）',
  'trace.trusted': '信任这个仓库',
  'trace.untrusted': '不信任这个仓库',
  'trace.rootSource': '{root}（{source}）',
  'trace.verifyNudge': '提醒验证（第 {attempt} 次）',
  'trace.planMode': '进入计划模式',
  'trace.actMode': '进入执行模式',
  'trace.planProposed': '提交计划',
  'trace.planApproved': '计划已批准',
  'trace.longRun': '（长任务 {runId}）',
  'trace.worktree': '隔离工作区',
  'trace.worktreeDetail': '{path}（分支 {branch}，基于 {slice}）',
  'trace.discard': '丢弃改动：{path}',
  'trace.undo': '恢复改动：{path}',
  'trace.apply': '带回原仓库（{mode}）{v}',
  'trace.budgetWarn': '用量到 80%：{kind}',
  'trace.budgetDecided': '用量到顶：{action}',
  'trace.newLimit': '新上限 {limit}',
  'trace.findings': '审阅发现 {length} 条',
  'trace.retry': '重试 {nodeId}',
  'trace.runEnd': '任务结束：{status}',
  'trace.htmlFolded': '<div class="note">共 {bytes} 字节，默认折叠</div>',
  'trace.htmlUnpriced': '<span class="note">（价目表里没有：{escapeHtml}，这部分不参与累计）</span>',
  'trace.htmlPage':
    '<!doctype html>\n<html lang="zh">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>domi 轨迹 · {escapeHtml}</title>\n<style>{CSS}</style>\n</head>\n<body>\n<h1>domi 轨迹</h1>\n<div class="meta">会话 {escapeHtml2} · {length} 个顶层节点 · 本文件不发出任何网络请求</div>\n{body}\n<div class="total">总花费：{fmtCost} {note}</div>\n</body>\n</html>\n',
  'eval.help':
    'domi eval —— L1 确定性轨迹回放（不联网、不花钱）\n\n  domi eval record <sessionId>   把一条真实会话导出成 fixture\n  domi eval run [fixture...]     回放 fixture，断言工具调用序列与录制一致\n  domi eval l2 [题 id...] [--rounds N] [--tasks <目录>]\n                                 L2：用真实模型跑 eval/l2 的题集（花钱、不进 CI），默认 3 轮\n  domi eval mine <仓库> [--since 2026-01-01] [--limit 50] [--test-cmd "bun test {files}"] [--setup "..."] [--out eval/mined/<名字>]\n                                 从 git 历史出题：父提交上测试失败、放入该提交的改动后通过的才收（不花钱，但要跑测试）\n\nfixture 默认读写 {FIXTURE_DIR}/ 。回放全程不发出任何网络请求。',
  'eval.recordUsage': '用法：domi eval record <sessionId>\n（会话 id 用 `domi session list` 看）',
  'eval.recorded': '已录制 {out}\n',
  'eval.recordedDetail': '  {length} 条事件 → {length2} 轮、{length3} 次工具调用',
  'eval.skip': '跳过 {p}：{v}',
  'eval.noFixtures': '{FIXTURE_DIR}/ 下没有 fixture。先跑一次 `domi eval record <sessionId>`。',
  'eval.passed': '\n{v}/{length} 通过',
  'eval.noTasks': 'eval/l2/tasks 下没有题（或者给的题 id 都不存在）',
  'eval.l2Start': 'L2：{length} 题 × {rounds} 轮，模型 {provider}/{name}。这会产生真实费用。',
  'eval.l2Attempt': '  {v} {taskId} 第 {round} 轮（{toFixed}s）',
  'eval.l2Done': '\n{join}\n\n报告：{join2}',
  'eval.mineUsage':
    '用法：domi eval mine <仓库路径> [--since 日期] [--limit N] [--test-cmd "..."] [--setup "..."] [--out 目录]',
  'eval.mined': '\n收下 {kept} / {length} 题 → {join}\n报告：{join2}',
  'eval.unknownSub': '未知子命令：eval {sub}\n{EVAL_HELP}',
  'eval.replayOk': '✓ {fixture} —— {actualCalls} 次工具调用，与录制一致',
  'eval.replayUnknown': '✗ {fixture} —— 未知差异',
  'eval.replayDiverged': '✗ {fixture} —— 第 {v} 次工具调用开始分叉（事件 seq {v2}）',
  'eval.expected': '  期望：{v}',
  'eval.actual': '  实际：{v}',
  'eval.jump': '  跳转：轨迹面板 seq {v}',
  'bridge.paired': '绑定好了。长任务的进展与审批会推到这里。',
  'bridge.alreadyPaired': '这个聊天已经绑定过了。',
  'bridge.codeExpired': '配对码过期了，在电脑上重新运行 domi bridge pair。',
  'bridge.codeWrong': '配对码不对。',
  'bridge.noCode': '还没有配对码：在电脑上运行 domi bridge pair。',
  'bridge.readOnly': '这里只推送进展和审批，不能发起或修改任务。',
  'bridge.ask': '⏸ 需要确认：{capabilityId}',
  'bridge.file': '文件：{basename}',
  'bridge.writeLines': '写入 {length} 行',
  'bridge.program': '程序：{v}',
  'bridge.formAsk': '（这是一个要填表的询问，Telegram 里只能拒绝；要填请去 TUI / Web）',
  'bridge.seeFull': '完整内容请在 TUI 或 Web 里看',
  'bridge.notPaired': '这个聊天没有绑定',
  'bridge.badButton': '看不懂这个按钮',
  'bridge.expired': '这个询问已经过期了',
  'bridge.allowed': '已允许',
  'bridge.denied': '已拒绝',
  'bridge.answeredElsewhere': '已经在别处回答过了',
  'trace.rule': '，规则：{matchedRule}',
  'trace.tools': '\n能力：{join}',
  'common.none': '无',
  'trace.failedSuffix': '失败',
  'eval.notProduced': '未产生',
  'eval.noMoreCalls': '（没有更多调用）',
  'error.unknown_method': '没有这个方法：{method}\n可用：{available}',
  'error.not_handshaked': '第一个请求必须是 handshake',
  'error.unsupported': '这个 domid 不支持{feature}',
  'error.feature.rename': '改标题',
  'error.feature.createTask': '按目标建任务',
  'error.feature.config': '从这里改配置',
  'error.feature.resolveModel': '按名字归属模型',
  'error.feature.usage': '用量统计',
  'error.feature.composer': '附件与文件引用',
  'error.feature.projects': '项目',
  'error.feature.review': '审阅',
  'error.feature.budget': '用量上限',
  'error.feature.planMode': '计划模式',
  'error.feature.worktrees': '隔离工作区',
  'error.feature.schedules': '定时任务',
  'error.feature.refs': '跨会话引用',
  'error.session_not_found': '没有这个会话：{sessionId}',
  'error.busy.delete': '这个会话正在处理，等它停下来再删',
  'error.busy.switch': '这个会话正在处理，等这一轮结束再切',
  'error.busy.operate': '这个会话正在处理，等这一轮结束再操作',
  'error.busy.submit': '这个会话正在处理上一条输入，稍后再试',
  'error.busy': '这个会话正忙',
  'error.no_panel': '没有插件面板 {plugin}/{id}',
  'error.not_implemented': '未实现：{method}',
  'error.scheduler_off': '调度器没有启动',
  'error.project_archived': '项目「{name}」已归档，先取消归档',
  'error.schedule_not_found': '没有这个定时任务：{id}',
  'error.not_isolated': '{sessionId} 不是隔离会话',
  'error.missing_credential':
    '还没有配置 {provider} 的 API key。到「设置 › 模型供应商」填写（保存后立即生效），或设置环境变量 {envNames} 后重启 domid。',
  'error.project.dirMissing': '目录不存在：{path}',
  'error.project.notDir': '不是目录：{path}',
  'error.project.notFound': '项目不存在：{id}',
  'error.soul_conflict': 'Soul 在你打开之后被改过（可能是 domi 刚更新，或者你在别处改了）。刷新看看再保存',
  'error.worktree.gitFailed': '{what}失败：{detail}',
  'error.worktree.notGit': '{cwd} 不在 git 仓库里，没法隔离。可以不隔离直接开会话（改动仍有步级快照兜底）',
  'error.worktree.noCommit': '{repo} 还没有任何提交，没法从 HEAD 建隔离工作区。先提交一次再试',
  'error.worktree.outside': '路径不在隔离工作区里：{file}',
  'error.worktree.badTrash': '回收站编号不对：{trash}',
  'error.worktree.noTrash': '回收站里没有 {trash}',
  'error.worktree.dirty': '隔离工作区 {path} 里还有没提交的改动。先带回原仓库（或只留分支）、或者逐个丢弃，再删会话',
  'error.attachment.tooLarge': '「{name}」有 {sizeMB}MB，超过单个附件上限 {maxMB}MB',
  'error.attachment.badId': '附件编号不对：{id}',
  'error.attachment.notFound': '这个会话里没有附件 {id}（先上传再提交）',
  'error.attachment.noVision': '当前模型 {model} 不支持图片输入（{names}）。换一个支持图片的模型再发',
  'error.attachment.fileOutside': '引用的文件不在工作目录里：{path}',
  'error.attachment.fileMissing': '引用的文件不存在：{path}',
  'error.attachment.noSkill': '没有这个技能：{name}',
  'error.review.notGit': '{cwd} 不在 git 仓库里，没有 diff 可审',
  'error.review.diffFailed': 'git diff {base} 失败：{detail}',
  'error.review.noChanges': '相对 {base} 没有任何改动，没什么可审的',
  'error.review.noSpec': '需求文档不存在：{path}',
  'error.ref.noSession': '引用的会话不存在：{sessionId}',
  'error.ref.outOfRange': '引用越界：会话 {sessionId} 只有 {head} 条，没有第 {fromSeq} 条',
  'error.ref.reversed': '引用的区间反了：{fromSeq}–{toSeq}',
  'error.config.denied': '这些设置不能从这里改：{keys}',
  'error.config.legacyToml': '配置还是旧的 TOML 格式（{path}），先迁移成 YAML：domi init --from-toml',
  'error.config.notString': '{key} 必须是字符串',
  'error.config.defaultProvider': '「{provider}」是默认模型所在的供应商，不能停用或删除。先把默认模型换到别家。',
  'error.model.ambiguous': '「{name}」在好几家供应商下都有：{providers}。从下拉里选具体哪一个。',
  'error.model.unresolved':
    '没有哪家启用的供应商提供「{name}」。到「设置 › 模型供应商」里添加它（手填模型或重新探测）。',
  'error.model.providerUnavailable': '供应商「{provider}」不存在或已停用',
  'error.cron.field': '第 {index} 段（{label}）「{text}」{why}',
  'error.cron.count': '要 5 段（分 时 日 月 周），这里是 {count} 段',
  'error.cron.tz': '不认识的时区「{tz}」，例如 Asia/Shanghai、UTC',
  'error.cron.never': '这个时间表永远不会触发（比如 2 月 30 日）',
  'error.branch_out_of_range': '分叉点越界：会话 {sessionId} 只有 {head} 条，没有第 {atSeq} 条',
  'error.cron.label.minute': '分',
  'error.cron.label.hour': '时',
  'error.cron.label.day': '日',
  'error.cron.label.month': '月',
  'error.cron.label.weekday': '周',
  'error.cron.why.notNumber': '里的「{s}」不是数字',
  'error.cron.why.outOfRange': '超出范围 {min}-{max}',
  'error.cron.why.empty': '有空的一项',
  'error.cron.why.multiSlash': '里有多个 /',
  'error.cron.why.step': '的步长「{step}」要是正整数',
  'error.cron.why.badRange': '的范围写法不对',
  'error.cron.why.reversed': '的范围 {lo}-{hi} 反了',
  'error.no_credential': '没有找到模型凭据。设置 {envNames}，或写进 ~/.domi/secrets.yaml（设置页会写那里）。',
  'error.worktree.op.create': '建隔离工作区',
  'error.worktree.op.reattach': '重新挂上隔离工作区',
  'error.worktree.op.readChanges': '读改动',
  'error.worktree.op.restoreFile': '恢复文件',
  'error.worktree.op.stage': '暂存改动',
  'error.worktree.op.commit': '提交隔离工作区的改动',
  'error.worktree.op.readCommit': '读提交',
  'error.worktree.op.readBranch': '读分支',
  'error.worktree.op.readChangeList': '读改动清单',
  'error.worktree.op.remove': '清理隔离工作区',
  'daemon.sessions.untitled': '新会话',
  'daemon.notify.done': '任务完成：{name}',
  'daemon.notify.failed': '任务失败：{name}',
  'daemon.notify.allDone': '{count} 个节点全部完成',
  'daemon.notify.failedNodes': '失败的节点：{nodes}',
  'tui.scroll.newItems': '{n} 条新消息 · Ctrl+End 回到底部',
  'tui.scroll.dumpHint': '—— 以上是完整对话（已写进终端回滚区，可以用终端自己的搜索与复制）。按任意键回到 domi ——',
  'tui.renderer.fellBack':
    '全屏渲染上次没能启动，这次用经典渲染（tui.renderer: fullscreen 或 DOMI_TUI_RENDERER=fullscreen 可以再试）',
  'tui.hint.scroll': '翻页',
  'tui.hint.dump': '回滚区',
  'tui.hint.send': '发送',
  'tui.hint.newline': '换行',
}
