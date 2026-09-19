/** English。key 集合必须与 zh.ts 完全一致（类型保证），参数名一致由 guard:i18n 保证 */
import type { zh } from './zh.ts'

export const en: Record<keyof typeof zh, string> = {
  'common.save': 'Save',
  'web.confirm.empty': '(empty)',
  'web.confirm.awaitingApproval': 'Awaiting your approval',
  'web.confirm.needsInput': 'Needs your input',
  'web.confirm.reject': 'Reject',
  'common.deny': 'Deny',
  'web.confirm.approve': 'Approve',
  'common.submit': 'Submit',
  'web.confirm.permissionRequest': 'Permission request ·',
  'web.confirm.alwaysAllowHint': "Don't ask again for the same kind of action (in the same directory) in this session",
  'web.confirm.alwaysAllow': 'Always allow in this session',
  'common.allow': 'Allow',
  'web.app.openingSession': 'Opening session…',
  'web.app.connectToOpen': 'Connect to the daemon to open sessions.',
  'web.main.missingRoot': 'index.html is missing #root',
  'web.transcript.branchFrom': 'Branch a new session from event {seq}',
  'web.transcript.branch': 'Branch',
  'common.running': 'Running',
  'common.succeeded': 'Succeeded',
  'common.failed': 'Failed',
  'web.transcript.you': 'You',
  'web.transcript.thinking': 'Thinking',
  'web.transcript.permission': 'Permission',
  'web.transcript.noEvents': 'No events yet.',
  'web.transcript.quoteTurnHint': 'Quote this turn in another session',
  'web.transcript.quoteTurn': 'Quote this turn',
  'web.conn.offline': 'Not connected',
  'web.conn.connecting': 'Connecting…',
  'web.conn.connected': 'Connected',
  'web.conn.reconnecting': 'Disconnected, reconnecting…',
  'web.conn.incompatible': 'Incompatible protocol version',
  'web.conn.closed': 'Disconnected',
  'web.sidebar.projectDetails': 'Project details',
  'web.sidebar.projectDetailsOf': '{name} project details',
  'web.sidebar.newTaskHere': 'New task in this project',
  'web.sidebar.newTaskIn': 'New task in {name}',
  'web.sidebar.noTasks': 'No tasks yet',
  'web.sidebar.viewAllTasks': 'View all ({taskCount})',
  'web.sidebar.newChat': 'New chat',
  'common.newTask': 'New task',
  'web.sidebar.schedules': 'Scheduled tasks',
  'web.sidebar.projects': 'Projects',
  'web.sidebar.addProject': 'Add project',
  'web.sidebar.createTask': 'Create task',
  'web.sidebar.allProjects': 'All projects',
  'web.sidebar.noProjects': 'No projects yet',
  'web.sidebar.projectsSoon': 'Projects are coming soon',
  'web.sidebar.chats': 'Chats',
  'web.sidebar.allChats': 'All chats',
  'web.sidebar.chatMeta': '{model} · {eventCount, plural, one {# event} other {# events}}{v}',
  'web.sidebar.noChats': 'No chats yet',
  'web.sidebar.viewAllChats': 'View all ({length})',
  'web.sidebar.settings': 'Settings',
  'common.unread': 'Unread',
  'web.status.toLight': 'Switch to light',
  'web.status.toDark': 'Switch to dark',
  'web.status.toggleTheme': 'Toggle theme',
  'web.status.toolCalls': '{toolCalls, plural, one {# tool call} other {# tool calls}}',
  'web.status.turnElapsed': 'this turn {formatElapsed} ·',
  'common.planMode': 'Plan mode',
  'common.severity.high': 'High',
  'common.severity.medium': 'Medium',
  'common.severity.low': 'Low',
  'web.review.title': 'Review findings',
  'web.review.none': 'No issues found',
  'web.review.count': '{length, plural, one {# issue} other {# issues}}',
  'web.review.basis': 'Basis: {basis}',
  'web.trajectory.total': 'Total {formatElapsed}',
  'web.trajectory.noTimestamps': 'Events in this session have no timestamps',
  'web.trajectory.toggleTimeline': 'Show / hide timeline',
  'common.searchEllipsis': 'Search…',
  'web.trajectory.search': 'Search trajectory',
  'web.trajectory.noMatch': 'No matching steps.',
  'web.credential.missing': 'No API key configured for {v} yet.',
  'web.credential.goSettings': 'Add it in Settings › Model providers',
  'web.credential.noRestart': '; it takes effect as soon as you save, no restart needed.',
  'web.composer.cannotRead': "Can't read this file",
  'common.remove': 'Remove',
  'web.composer.quoteSession': 'Quote {sessionId}',
  'web.composer.searchFiles': 'Search files…',
  'web.composer.searchSkills': 'Search skills…',
  'web.composer.upload': 'Upload attachment…',
  'web.composer.uploadHint': '(you can also paste or drop it into the input)',
  'web.composer.noFiles': 'No matching files',
  'web.composer.noSkills': 'No matching skills',
  'web.composer.pickerKeys': '↑↓ select · Enter confirm · Esc close',
  'web.composer.send': 'Send',
  'web.composer.uploadFailed': 'An attachment failed to upload; remove it before sending',
  'web.composer.startFirst': 'Once started you can quote files and upload attachments',
  'web.composer.file': 'File',
  'web.composer.uploading': 'Uploading',
  'web.composer.attachment': 'Attachment',
  'web.composer.skill': 'Skill',
  'web.composer.input': 'Input',
  'web.composer.fileHint': 'Quote files from the working directory, or upload attachments (you can also type @)',
  'web.composer.skillHint': 'Pick a skill for this turn (you can also type /)',
  'web.composer.planHint':
    'In plan mode domi only reads code, drafts a plan for your approval, and acts only after you approve',
  'common.actMode': 'Act mode',
  'web.composer.switchedLost': "Switched. The new model doesn't support: {join}",
  'web.composer.modelName': 'Model name',
  'web.composer.switchModel': 'Switch model',
  'web.composer.switchModelHint': 'Search or type a model name, then Enter',
  'common.cancel': 'Cancel',
  'web.composer.model': 'Model',
  'web.composer.noImages': ' · no images',
  'web.composer.searchOrType': 'Search / type…',
  'web.changes.added': 'Added',
  'web.changes.modified': 'Modified',
  'web.changes.deleted': 'Deleted',
  'web.changes.renamed': 'Renamed',
  'web.changes.squash': 'Squash into one commit',
  'web.changes.squashHint': 'Recommended: one extra commit in the original repo',
  'web.changes.merge': 'Merge back',
  'web.changes.mergeHint': 'Keep every commit made here',
  'web.changes.branchOnly': 'Keep the branch only',
  'web.changes.branchOnlyHint': "Don't touch the original repo's current branch",
  'web.changes.basedOn': ', based on ',
  'web.changes.branch': 'Branch',
  'web.changes.repo': '; original repo',
  'web.changes.none': 'No changes yet',
  'web.changes.discard': 'Discard',
  'web.changes.binary': '(binary or empty file)',
  'web.changes.truncated': '\n… (too long, truncated)',
  'web.changes.filesChanged': 'files changed',
  'common.collapse': 'Collapse',
  'common.view': 'View',
  'web.changes.apply': 'Bring back',
  'web.changes.undoDiscard': 'Undo discard:',
  'web.changes.applyTo': 'Bring back to the original repo:',
  'web.changes.confirmAgain': "You'll be asked to confirm once more",
  'web.session.answeredElsewhere': 'This request was already answered elsewhere',
  'web.session.toTask': 'Convert to task',
  'web.session.busy': 'Working on the previous message…',
  'web.session.placeholder':
    'Say something…  (Enter to send, Shift+Enter for a new line, @ to quote files, / to pick a skill)',
  'web.session.chat': 'Chat',
  'web.session.title': 'Session title',
  'web.session.clickRename': 'Click to rename',
  'common.untitled': 'Untitled',
  'web.session.reviewHint':
    "Send a read-only reviewer to check this session's uncommitted changes against the requirements (it can't see the chat history)",
  'web.session.review': 'Review changes',
  'web.session.deleteHint': 'Delete session (recoverable from All chats)',
  'common.confirmDelete': 'Confirm delete',
  'web.session.delete': 'Delete session',
  'common.noProject': 'No project',
  'web.sessions.sub': 'Every chat and task across projects, grouped by project.',
  'web.sessions.filter': 'Filter chats…',
  'web.sessions.showDeleted': 'Show deleted (trash)',
  'web.sessions.noMatch': 'No matching chats.',
  'common.task': 'Task',
  'web.sessions.meta': '{model} · {eventCount, plural, one {# event} other {# events}}{v}{v2}',
  'common.restore': 'Restore',
  'web.runs.pending': 'Waiting',
  'common.inProgress': 'In progress',
  'web.runs.done': 'Done',
  'web.runs.blocked': 'Blocked',
  'web.runs.cancelled': 'Cancelled',
  'web.runs.waitingDaemon': 'Waiting for domid to recover',
  'web.runs.cancel': 'Cancel this run',
  'web.runs.needs': ' · depends on {join}',
  'web.runs.attempt': ' · attempt {attempt}',
  'web.runs.viewProcess': 'View process',
  'common.retry': 'Retry',
  'web.runs.none': 'No multi-node runs yet. Plans split into several steps show up here automatically.',
  'web.runs.yamlAdvanced': 'Advanced: paste YAML to start a run',
  'web.runs.yamlDocs': 'See docs/tasks-example.yaml for the format',
  'common.start': 'Start',
  'web.projects.sub': 'Every workspace / repository. Click one to open its details.',
  'web.projects.filter': 'Filter projects…',
  'web.projects.showArchived': 'Show archived',
  'web.projects.none': 'No projects.',
  'common.archived': 'Archived',
  'web.projects.meta': '{path} · {taskCount, plural, one {# task} other {# tasks}}',
  'common.unarchive': 'Unarchive',
  'common.auto': 'Auto',
  'common.always': 'Always',
  'common.never': 'Never',
  'web.project.notFound': 'Project not found.',
  'web.common.connectFirst': 'Shown once connected to the daemon.',
  'web.project.name': 'Project name',
  'common.rename': 'Rename',
  'web.project.archivedNoTask': 'This project is archived; unarchive it to start new tasks',
  'web.project.startPlaceholder': 'Start a new task in this project…',
  'common.startTask': 'Start task',
  'web.project.history': 'Past tasks',
  'web.project.noTasks': 'No tasks yet.',
  'web.project.settings': 'Project settings',
  'web.project.isolate': 'Work in a separate workspace',
  'web.project.isolateHint':
    'Auto = when your workspace has uncommitted changes, or the task was triggered on a schedule, it works in a separate workspace; review and bring the changes back at the top of the task',
  'web.project.reviewPlan': 'Let me review the plan first',
  'web.project.reviewPlanHint':
    'Auto = review first only for multi-step tasks or ones touching many files; applies only to plans the system makes for new tasks',
  'web.project.archive': 'Archive project',
  'web.settings.general': 'General',
  'web.settings.models': 'Model providers',
  'web.settings.messaging': 'Messaging',
  'web.settings.memory': 'Memory',
  'web.settings.soul': 'Soul & persona',
  'web.settings.plugins': 'Plugins',
  'web.settings.usage': 'Usage',
  'web.settings.runtime': 'Runtime',
  'web.settings.maxToolCalls': 'Max tool calls per turn',
  'web.settings.maxToolCallsHint': 'How many tool calls one turn may make (1-1000, default 100)',
  'web.settings.maxArgParseRetries': 'Max arg-parse retries',
  'web.settings.maxArgParseRetriesHint': 'Retries when tool-arg parsing fails (1-100, default 3)',
  'web.settings.maxWallClockMs': 'Max wall-clock per turn (ms)',
  'web.settings.maxWallClockMsHint': 'Wall-clock budget for one turn (1000-86400000, default 600000)',
  'web.settings.language': 'Interface language',
  'web.settings.languageHint':
    "Language domi's interface is shown in; shared by Web and TUI. The page reloads after switching",
  'web.settings.theme': 'Theme',
  'web.settings.themeHint': 'Light/dark follows this device; the accent color is shared between Web and TUI',
  'common.followSystem': 'Follow system',
  'web.settings.dark': 'Dark',
  'web.settings.light': 'Light',
  'web.settings.accent': 'Accent color',
  'web.settings.messagingSoon': 'Messaging apps are coming soon.',
  'web.settings.telegram': 'Telegram bridge',
  'web.settings.telegramHint': 'Read-only trajectory + remote approvals (coming soon)',
  'web.settings.wechat': 'WeChat bridge',
  'web.settings.wechatHint': 'Read-only notifications (coming soon)',
  'web.settings.strategyFull': 'Leave as is (send the whole history to the model)',
  'web.settings.strategyClean': 'Structured cleanup (dedupe tool results, drop errors, trim stack traces)',
  'web.settings.strategyCompact': 'Cleanup + auto-compaction (summarize old turns at the threshold)',
  'web.settings.strategy': 'Context strategy',
  'web.settings.strategyHint': 'How history is processed before it goes to the model',
  'web.settings.keepTurns': 'Keep the last N turns verbatim',
  'web.settings.keepTurnsHint':
    'The last N turns are never summarized when compacting; 6-10 recommended (auto-compaction only)',
  'web.settings.compactAt': 'Context compaction threshold',
  'web.settings.compactAtHint':
    'Compact automatically once context usage passes this percentage; 70-75 recommended (auto-compaction only)',
  'web.settings.extractEvery': 'Memory extraction interval',
  'web.settings.extractEveryHint':
    'Extract L3 semantic memory every N turns; 0 = never automatically (takes effect after restarting domid)',
  'web.settings.sub': 'Configure how domi behaves, looks and connects.',
  'web.settings.nav': 'Settings sections',
  'web.common.connectFirstDot': 'Shown once connected to the daemon.',
  'web.schedule.cron': 'Cron expression',
  'web.schedule.tz': 'Time zone',
  'web.schedule.cronHint': 'minute hour day month weekday, e.g. 0 9 * * 1-5 = weekdays at 9 am',
  'web.schedule.next': 'Next: {join}',
  'web.schedule.ran': 'Ran',
  'web.schedule.skipped': 'Skipped',
  'web.schedule.notCreated': 'Not created',
  'web.schedule.neverRan': "Hasn't run yet.",
  'web.schedule.catchUp': 'Run missed',
  'web.schedule.openTask': 'Open task',
  'common.goal': 'Goal',
  'web.schedule.paused': 'Paused',
  'web.schedule.noMore': "Won't run again",
  'web.schedule.nextAt': 'Next {formatWhen}',
  'web.schedule.runNowHint': 'Run once now',
  'web.schedule.run': 'Run',
  'common.resume': 'Resume',
  'common.pause': 'Pause',
  'web.schedule.history': 'Past runs',
  'common.edit': 'Edit',
  'web.schedule.deleteHint': 'Delete the schedule (tasks it already ran are kept)',
  'common.new': 'New',
  'common.loading': 'Loading…',
  'web.schedule.none': 'No scheduled tasks yet. Hand daily or weekly chores to it and they run on time.',
  'web.addProject.dir': 'Directory',
  'web.addProject.dirHint': "An existing directory on the daemon's machine; each directory is registered once",
  'web.addProject.name': 'Name',
  'web.addProject.nameHint': 'Blank = directory name',
  'common.add': 'Add',
  'web.toTask.pickProject': 'Choose a project…',
  'web.toTask.hint': 'Creates a new task in the project with this whole chat quoted; the chat itself stays as it is.',
  'web.toTask.goalHint': 'What this task should achieve and deliver',
  'web.toTask.noProjects': 'No projects yet; add one under Projects in the sidebar first.',
  'web.home.sub': 'A free-form chat not tied to any project. To work inside a repository, use New task.',
  'web.home.placeholder': "What's on your mind?  (Enter to send, Shift+Enter for a new line)",
  'web.home.start': 'Start chat',
  'web.home.attachLater': 'Attachments and file quotes are available once the chat starts',
  'web.home.recent': 'Recent chats',
  'web.home.meta': '{model} · {eventCount, plural, one {# event} other {# events}}',
  'web.tasks.newSchedule': 'New scheduled task',
  'web.tasks.projectHint':
    "Every task belongs to a project; if you don't have one, add it under Projects in the sidebar first",
  'web.tasks.when': 'Schedule',
  'web.tasks.whenHint': 'Cron expression and time zone; when it fires, a new task is created with the goal below',
  'web.tasks.schedulePlaceholder': 'What should each run achieve?  (Enter to create)',
  'web.tasks.taskPlaceholder': 'What should this task achieve?  (Enter to start)',
  'web.tasks.createSchedule': 'Create scheduled task',
  'web.tasks.meta': '{v}{model} · {eventCount, plural, one {# event} other {# events}}',
  'web.tasks.title': 'Tasks',
  'web.tasks.sub': 'Work with a clear goal and deliverable. Runs in the background and resumes after a restart.',
  'web.tasks.recent': 'Recent tasks',
  'web.tasks.runs': 'Orchestrated runs',
  'web.tasks.connectFirst': 'Scheduled tasks and orchestrated runs appear once connected to the daemon.',
  'web.soul.pending': 'Pending changes ({length})',
  'web.soul.pendingHint':
    "Changes domi proposes from memory. Rejecting one reverts that spot in the file, and it won't be proposed again",
  'common.accept': 'Accept',
  'common.reject': 'Reject',
  'web.soul.recent': 'Recently learned memories',
  'web.soul.keywordOnly': 'Keyword matching only (the daemon has no memory.embedding configured)',
  'web.soul.noItems': 'No entries.',
  'web.soul.kept': 'Kept',
  'web.soul.keep': 'Keep',
  'web.soul.exportRejected':
    'Export refused: these lines contain credentials, local paths or email addresses; fix them and export again — {join}',
  'web.soul.nothingToImport': 'Nothing new to import',
  'web.soul.markdown': 'Persona (Soul Markdown)',
  'web.soul.markdownHint':
    'Human-readable, diffable, hand-editable. Changes apply from the next chat; lines you edited are never touched by domi again',
  'web.soul.empty': "Nothing here yet. It's generated after a few turns of conversation, or you can write it yourself.",
  'common.saved': 'Saved',
  'web.soul.revert': 'Discard edits',
  'web.soul.refreshed': 'Went through all memories',
  'web.soul.refresh': 'Update from all memories',
  'common.export': 'Export',
  'web.soul.import': 'Import…',
  'web.soul.importing': 'Import {name}',
  'web.soul.importHint':
    'Content written by others is only reference material and is never treated as instructions. Tick the sections to import; you can still reject them one by one under pending changes',
  'web.soul.importSelected': 'Import {size, plural, one {# selected section} other {# selected sections}}',
  'web.soul.imported': 'Imported {imported, plural, one {# entry} other {# entries}}',
  'web.soul.search': 'Search memory',
  'web.soul.searchPlaceholder': 'Search memory…',
  'web.soul.searchButton': 'Search',
  'web.soul.rejected': 'Rejected (no longer searchable; the events remain)',
  'web.providers.cap.toolCall': 'Tool calls',
  'web.providers.cap.toolCallHint':
    "Can read and write files and run commands; when off, this provider's models can only chat",
  'web.providers.cap.vision': 'Images',
  'web.providers.cap.visionHint': 'Images in attachments are sent to the model as images',
  'web.providers.cap.reasoning': 'Reasoning',
  'web.providers.cap.reasoningHint': "The model's thinking is shown separately",
  'web.providers.cap.promptCache': 'Prompt caching',
  'web.providers.cap.promptCacheHint': 'Stable prefixes are cached to save money',
  'web.providers.cap.structured': 'Structured output',
  'web.providers.cap.structuredHint': 'Titles, summaries and the like use native JSON mode',
  'web.providers.compatible': '{label} compatible',
  'common.envVar': 'environment variable',
  'web.providers.noKeyEnv': 'No key yet (you can also set the environment variable {join})',
  'web.providers.noKey': 'No key yet',
  'web.providers.keyFrom': ' (from {v})',
  'web.providers.envWins': '; the environment variable takes precedence, so changing it here has no effect',
  'web.providers.keyCurrent': 'Current {v}{where}{env}. Leave blank to keep it',
  'web.providers.defaultModel': 'Default model',
  'web.providers.defaultModelHint': 'Used for new chats; click "Set as default" in any provider\'s model list below',
  'web.providers.add': 'Add provider',
  'web.providers.probing': 'Probing…',
  'web.providers.reprobe': 'Probe again',
  'web.providers.hasDefault': 'Default model is here',
  'web.providers.cannotDelete':
    'The default model is from this provider; switch the default model to another provider first',
  'common.delete': 'Delete',
  'web.providers.inferred': '. Vendor inferred from the old config format; save once to pin it',
  'web.providers.disabled': "Disabled: not probed and not shown in the chat's model picker",
  'web.providers.probeFailed': 'Probing failed ({v}); below are the manually listed models',
  'web.providers.modelsOf': 'Models of {name}',
  'web.providers.setDefault': 'Set as default',
  'web.providers.manualTag': ' · manual',
  'web.providers.noModels': 'No models available: add a key and probe again, or list models manually',
  'web.providers.keyOnlyIn': 'Keys are written only to',
  'web.providers.keyNotIn': '(mode 0600), never to',
  'web.providers.keyNoEcho': ', and are never shown here.',
  'web.providers.tooOpen': "This file's permissions are wider than 0600; chmod 600 is recommended.",
  'web.providers.editing': 'Edit {name}',
  'web.providers.name': 'Name',
  'web.providers.nameHint': 'Name shown in the interface',
  'web.providers.idHint': "The key in the config file; can't be changed once created",
  'web.providers.idFixed': "Can't be changed once created",
  'web.providers.vendor': 'Vendor',
  'web.providers.vendorHint': 'Determines the default URL, protocol and capabilities',
  'web.providers.protocol': 'Protocol',
  'web.providers.protocolHint': "Which vendor's API the gateway speaks",
  'web.providers.protocolFixed': 'Set by the vendor',
  'web.providers.baseUrlHint': "Leave blank to use the vendor's default URL",
  'web.providers.keyNew': 'Written only to secrets.yaml',
  'web.providers.models': 'Manual models',
  'web.providers.modelsHint': 'Used when probing finds nothing, and added to probe results; comma separated',
  'common.enabled': 'Enabled',
  'web.providers.enabledHint': "When disabled it's not probed and not shown in the chat's model picker",
  'web.providers.caps': 'Capabilities',
  'web.providers.capsHint':
    "Defaults come from the vendor template; custom gateways start with everything off, so turn things on once you've confirmed support",
  'web.usage.thisMonth': 'This month',
  'web.usage.lastMonth': 'Last month',
  'common.all': 'All',
  'web.usage.none': 'No usage in this period.',
  'web.usage.modelSpend': '{model} spend {fmtCost}',
  'web.usage.modelRow': '{model}: {fmtCost} · {fmtTokens} tokens',
  'web.usage.spend': 'Spend · {label}',
  'web.usage.sessions': 'Sessions',
  'web.usage.cacheHit': 'Cache hit rate',
  'web.usage.permissions': 'Permission requests',
  'web.usage.unpriced':
    'These models aren\'t in the price table; their spend shows as "—" and isn\'t included in the total: {join}',
  'web.usage.byModel': 'By model',
  'web.usage.total': 'All time',
  'web.settings.savedRestart': 'Saved. {join} require restarting domid to take effect',
  'web.settings.savedNextTurn': 'Saved; takes effect from the next turn',
  'web.plugins.tools': '{length, plural, one {# tool} other {# tools}}',
  'web.plugins.skills': '{skills, plural, one {# skill} other {# skills}}',
  'common.listSep': ', ',
  'web.plugins.sandbox': 'Sandbox: {v}',
  'web.plugins.none': 'No plugins installed yet. In a terminal:',
  'web.plugins.installCmd': 'domi plugin install <dir>',
  'common.disable': 'Disable',
  'common.enable': 'Enable',
  'web.plugins.clickDisable': 'Click to disable',
  'web.plugins.clickEnable': 'Click to enable',
  'common.notEnabled': 'Not enabled',
  'common.branchSuffix': ' · branch',
  'web.soul.lineKind': 'line {line} ({kind})',
  'common.unknownReason': 'unknown reason',
  'web.plugins.noSandbox': "none (plugins with code won't run)",
  'common.deletedSuffix': ' · deleted',
  'web.credential.theModel': 'the model',
  'web.plugins.enabledRestart': 'Enabled {name}. Its MCP server connects after restarting domid',
  'web.plugins.enabledOne': 'Enabled {name}',
  'web.plugins.disabledOne': 'Disabled {name}',
  'web.settings.langZh': '简体中文',
  'web.settings.langEn': 'English',
  'core.timeline.thinking': 'Thinking',
  'core.timeline.answer': 'Answer',
  'core.client.notConnected': "Not connected to the daemon; can't call {method}",
  'core.client.closed': 'Connection closed',
  'core.client.unreachable': "Can't reach the daemon",
  'core.client.dropped': 'Connection lost',
  'core.ev.cleanup': 'Context cleanup {tokensBefore} → {tokensAfter} tokens',
  'core.ev.cleanupDetail':
    'dedupe {dedupe} · truncated {verbose} · resolved errors {resolvedError} · stack traces {stack}',
  'core.ev.compact': 'Context compacted {tokensBefore} → {tokensAfter} tokens (kept the last {keptTurns} turns)',
  'core.ev.spawn': 'Spawned a sub-agent: {goal}',
  'core.ev.runStart': 'Task started: {name}',
  'core.ev.nodeStart': 'started',
  'core.ev.nodeDone': 'done',
  'core.ev.nodeFailed': 'failed',
  'core.ev.elapsed': ' ({formatElapsed})',
  'core.ev.node': 'Node {nodeId} {label}{v}{ms}',
  'core.ev.resume': 'Task resumed: {length, plural, one {# node} other {# nodes}} already done{v}',
  'core.ev.hook': 'Hook {name}{v}',
  'core.ev.trust': 'Trusted this repository: {root}',
  'core.ev.untrusted': "Didn't load this repository's rule files (not trusted): {root}",
  'core.ev.unverifiedEnd': 'Finished without passing verification',
  'core.ev.verifyNudge': 'Reminded the model to verify before finishing',
  'core.ev.planMode': 'Entered plan mode (read-only)',
  'core.ev.actMode': 'Entered act mode',
  'core.ev.planProposed': 'Submitted a plan for your approval',
  'core.ev.planApproved': 'Plan approved{v}',
  'core.ev.planRejected': 'Plan rejected',
  'core.ev.worktree': 'Working in an isolated workspace: {branch}',
  'core.ev.applied': 'Changes {v} brought back to the original repo ({mode})',
  'core.ev.budgetWarn': 'Usage reached 80% of the limit ({kind}: {used} / {limit})',
  'core.ev.budgetDecided': 'Usage limit reached; you chose: {v}',
  'core.ev.findings': 'Review found {length, plural, one {# issue} other {# issues}}',
  'core.listSepStrong': '; ',
  'core.ev.pluginError': 'Plugin {plugin}{v} failed: {message}',
  'core.ev.retry': 'Retrying node {nodeId}',
  'core.ev.runDone': 'done',
  'core.ev.runFailed': 'failed',
  'core.ev.runCancelled': 'cancelled',
  'core.ev.runEnd': 'Task {label}',
  'core.ev.ref': 'Quoted events {fromSeq}–{toSeq} of session {sessionId}',
  'core.ev.modelSwitch': 'Model switched {from} → {to}{v}',
  'core.ev.lost': "The new model doesn't support: {join}",
  'core.ev.discard': 'Discarded the changes to {path}',
  'core.ev.undoHint': 'Undo: trash {trash}',
  'core.ev.undone': 'Restored the changes to {path}',
  'core.ev.attempt': ' (attempt {attempt})',
  'core.ev.rerun': ', rerunning {join}',
  'core.ev.hookTimeout': ' timed out',
  'core.ev.hookBlocked': ' blocked the call',
  'core.ev.hookExit': ' ({on}, exit code {exitCode})',
  'core.ev.toRun': ', turned into long task {runId}',
  'core.ev.appliedOk': 'were',
  'core.ev.appliedFail': 'could not be',
  'core.ev.continue': 'continue',
  'core.ev.stop': 'stop',
  'core.ev.raise': 'raise the limit',
  'core.ev.pluginTool': ' tool {tool}',
  'core.ev.provider': ' ({provider})',
  'core.palette.blue': 'Blue',
  'core.palette.green': 'Green',
  'core.palette.orange': 'Orange',
  'core.palette.purple': 'Purple',
  'core.palette.pink': 'Pink',
  'core.verify.unverified': 'Changed, not verified',
  'core.verify.verified': 'Verified',
  'core.verify.failed': 'Verification failed',
  'tui.review.usage':
    'Usage:\n  domi review [--base <commit>] [--spec <requirements doc>]...\n    Reviews the diff of the current directory against base (default HEAD, including uncommitted and untracked changes).\n    The reviewer is a fresh read-only session: it sees the requirements docs and the diff, never any chat history.',
  'tui.review.none': 'No issues found.',
  'tui.review.found': 'Found {length, plural, one {# issue} other {# issues}}:',
  'tui.review.line': 'line {line}:',
  'tui.review.basis': '      Basis: {basis}',
  'tui.review.started': 'Review session {id} started (read-only; you can watch it in Web / TUI)…',
  'tui.review.noFindings': 'The reviewer finished without handing in structured findings.{v}',
  'tui.tag.branch': 'branch',
  'tui.tag.deleted': 'deleted',
  'tui.sessions.row': '{v} {id}  {v2}  {model} · {eventCount, plural, one {# event} other {# events}}{v3}',
  'tui.budget.set': "Limit set: you'll be warned at 80% and asked when it's reached",
  'tui.changes.noneFor': '{path} has no changes',
  'tui.changes.none': 'No changes in the isolated workspace ({branch}) yet',
  'tui.changes.header':
    'Changes on {branch} relative to {slice} (/changes <file> shows the diff, /apply brings them back):',
  'tui.changes.discarded': 'Discarded the changes to {path} (/undo {trash} to undo)',
  'tui.changes.restored': 'Restored the changes to {path}',
  'tui.mode.alreadyPlan': 'Already in plan mode',
  'tui.mode.alreadyAct': 'Already in act mode',
  'tui.branch.switched': 'Switched to branch {id} (branched at event {atSeq})',
  'tui.ref.pending':
    'Your next message will carry {length, plural, one {# quote} other {# quotes}} (latest: session {sessionId})',
  'tui.session.switched': 'Switched to session {id}',
  'tui.session.deleted': 'Deleted session {sessionId} (all events are kept; /restore {sessionId2} brings it back)',
  'tui.session.restored': 'Restored session {sessionId} (/open {sessionId2} to open it)',
  'tui.soul.noPending': 'No pending changes. Soul lives at {path}; you can edit it directly',
  'tui.soul.pending': '{length, plural, one {# pending change} other {# pending changes}} (/soul accept|reject <id>):',
  'tui.memory.none': 'No matching entries',
  'tui.memory.extracted':
    'Recorded {length, plural, one {# new entry} other {# new entries}} from this session; Soul changed in {length2, plural, one {# place} other {# places}}',
  'tui.cmd.new': 'New chat',
  'tui.cmd.sessions': 'List chats',
  'tui.cmd.argSession': '<session id>',
  'tui.cmd.open': 'Open a chat',
  'tui.cmd.delete': 'Delete a chat (recoverable)',
  'tui.cmd.restore': 'Restore a deleted chat',
  'tui.cmd.branch': 'Branch from here',
  'tui.cmd.argRef': '<session id> [from-to]',
  'tui.cmd.ref': 'Quote another session in your next message',
  'tui.cmd.plan': 'Switch to plan mode',
  'tui.cmd.act': 'Switch back to act mode',
  'tui.cmd.argModel': '[model]',
  'tui.cmd.model': 'Switch model (no argument opens the model list)',
  'tui.cmd.compact': 'Compact the context',
  'tui.cmd.argBudget': 'tokens|cost|calls <n>',
  'tui.cmd.budget': 'Set a usage limit',
  'tui.cmd.argFileOpt': '[file]',
  'tui.cmd.changes': 'See changes in the separate workspace',
  'tui.cmd.argFile': '<file>',
  'tui.cmd.discard': "Discard one file's changes",
  'tui.cmd.argTrash': '<number>',
  'tui.cmd.undo': 'Undo a discard',
  'tui.cmd.apply': 'Bring the changes back to the original repo',
  'tui.cmd.soul': 'Soul changes pending review',
  'tui.cmd.argQuery': '[keywords]',
  'tui.cmd.memory': 'Search memory',
  'tui.cmd.extract': 'Extract memories from this session',
  'tui.usage.model': 'Usage: /model [model name] — model name only; the provider comes from settings',
  'tui.usage.branchEmpty': "The conversation is empty; there's nowhere to branch from",
  'tui.usage.branch': 'Usage: /branch [seq]',
  'tui.usage.ref': 'Usage: /ref <session id> [from-to]; your next message will carry this quote',
  'tui.usage.sessions': 'Usage: /sessions [--all]',
  'tui.usage.sessionArg': 'Usage: {cmd} <session id> (/sessions shows ids)',
  'tui.usage.soul': 'Usage: /soul shows pending changes; /soul accept|reject <change id>',
  'tui.usage.budget': 'Usage: /budget tokens <count> | /budget cost <USD> | /budget calls <count>',
  'tui.usage.discard': 'Usage: /discard <file>',
  'tui.usage.undo': 'Usage: /undo <trash number> (shown by /discard)',
  'tui.usage.apply': 'Usage: /apply [squash|merge|branch]',
  'tui.week.0': 'Sunday',
  'tui.week.1': 'Monday',
  'tui.week.2': 'Tuesday',
  'tui.week.3': 'Wednesday',
  'tui.week.4': 'Thursday',
  'tui.week.5': 'Friday',
  'tui.week.6': 'Saturday',
  'tui.cron.daily': 'Daily {at}',
  'tui.cron.weekdays': 'Weekdays {at}',
  'tui.cron.weekly': 'Every {v} {at}',
  'tui.cron.monthly': 'Monthly on day {dom} {at}',
  'tui.ago.now': 'just now',
  'tui.ago.minutes': '{m, plural, one {# minute} other {# minutes}} ago',
  'tui.ago.hours': '{h, plural, one {# hour} other {# hours}} ago',
  'tui.ago.yesterday': 'yesterday',
  'tui.ago.days': '{d, plural, one {# day} other {# days}} ago',
  'tui.projects.meta': '{path} · {taskCount, plural, one {# task} other {# tasks}}',
  'tui.sessions.otherProject': 'Other projects',
  'tui.sessions.unread': 'Unread · {ago}',
  'tui.tasks.scheduled': 'Scheduled',
  'tui.tasks.pausedCron': '{describeCron} · paused',
  'tui.models.default': 'default',
  'tui.models.manual': 'manual',
  'tui.models.notProbed': 'not probed',
  'tui.models.noTools': 'no tools',
  'tui.models.noImages': 'no images',
  'tui.models.search': 'Search models or providers…',
  'tui.models.none': 'No models available: add them in Web under Settings › Model providers',
  'tui.key.select': 'select',
  'tui.key.switch': 'switch',
  'tui.key.close': 'close',
  'tui.models.probeFailed': 'Probing failed: {join}',
  'tui.help.projects': 'Projects',
  'tui.help.sessions': 'Chats',
  'tui.help.tasks': 'Tasks',
  'tui.help.send': 'Send',
  'tui.help.newline': 'New line',
  'tui.help.commands': 'Commands (Tab completes)',
  'tui.help.permission': 'Allow / deny / always allow in this session',
  'tui.help.quit': 'Quit (tasks keep running in domid)',
  'tui.help.title': 'Help',
  'tui.help.singleKeys': 'Single-key shortcuts only work when the input is empty',
  'tui.help.commandsHeader': 'Commands',
  'tui.projects.title': 'Choose a project',
  'tui.projects.search': 'Search projects…',
  'tui.key.newTask': 'new task',
  'tui.sessions.title': 'Chat history',
  'tui.sessions.search': 'Search chats…',
  'tui.key.open': 'open',
  'tui.tasks.scheduleCreated': 'Scheduled task created',
  'tui.tasks.title': 'Planned tasks',
  'tui.tasks.none': 'No tasks in progress and no scheduled tasks. Press n to create one',
  'tui.key.nextField': 'next field',
  'tui.key.pickProject': 'pick project',
  'tui.key.create': 'create',
  'tui.key.back': 'back',
  'tui.key.new': 'new',
  'tui.key.openRun': 'open / run',
  'tui.key.pauseResume': 'pause / resume',
  'tui.form.cronOk': 'Schedule OK',
  'tui.form.noProjects': 'No projects yet; add one in Web or with domi -p',
  'tui.form.goalPlaceholder': 'What should this task achieve?',
  'tui.form.schedule': 'Schedule',
  'tui.form.cronPlaceholder': 'Optional: 0 9 * * 1-5',
  'tui.form.creating': 'Creating…',
  'tui.task.usage':
    "Usage:\n  domi task run <file.yaml> [--follow]   start a run (it runs in domid, so closing the terminal doesn't stop it); --follow tails it to the end\n  domi task list                          recent runs\n  domi task status <runId>                status of each node\n  domi task retry <runId> <node>          rerun just one failed node (finished ones are kept)\n  domi task cancel <runId>                cancel\n\nSee docs/tasks-example.yaml for the YAML format. Run sessions also show up in the session lists of Web and TUI.",
  'tui.task.waitingDaemon': '(waiting for domid to recover)',
  'tui.task.attempt': ' attempt {attempt}',
  'tui.task.started': 'Started {name} ({runId}), {length, plural, one {# node} other {# nodes}}: {join}',
  'tui.task.progress': 'Progress: domi task status {runId}',
  'tui.task.waitingAsk': '  ⏸ Waiting for approval: {capabilityId} (answer in TUI / Web / Telegram)',
  'tui.task.none': 'No runs yet.',
  'tui.task.retrying': 'Started rerunning {v}',
  'tui.task.alreadyEnded': 'This run has already finished',
  'tui.revert.warning':
    'Note: reverting only restores files. Shell commands already run, network requests already sent and commits already pushed are not undone.',
  'tui.confirm.permission': 'Permission request',
  'tui.confirm.title': '🔑 {title}: {capabilityId}',
  'tui.confirm.formInWeb': 'This request needs a form: answer it in Web (pnpm web); n to reject',
  'tui.confirm.keyReject': ' n reject ',
  'tui.confirm.keyApprove': ' y approve ',
  'tui.confirm.keyAllow': ' y allow ',
  'tui.confirm.keyAlways': '  a always allow in this session ',
  'tui.confirm.enterRejects': '   Enter = reject',
  'tui.revert.files': 'Restore files only',
  'tui.revert.chat': 'Void the conversation only',
  'tui.revert.both': 'Restore files and void the conversation',
  'tui.revert.to': 'Revert to step {toSeq}',
  'tui.revert.scope': '{scopeText} · affects {fileCount, plural, one {# file} other {# files}}',
  'tui.revert.keys': 'y confirm revert / n cancel (default: cancel)',
  'tui.prompt.placeholder': 'Say something…  (Enter to send, Ctrl+J for a new line)',
  'tui.conn.connecting': 'Connecting',
  'tui.conn.reconnecting': 'Reconnecting',
  'tui.conn.incompatible': 'Incompatible version',
  'tui.status.turn': 'this turn {formatElapsed} · ',
  'tui.status.running': '⏵ Running',
  'tui.context.chat': '▸ Chat',
  'tui.hint.projects': 'projects',
  'tui.hint.sessions': 'chats',
  'tui.hint.tasks': 'tasks',
  'tui.hint.commands': 'commands',
  'tui.hint.help': 'help',
  'tui.hint.quit': 'quit',
  'tui.spinner.thinking': 'Thinking',
  'tui.overlay.empty': 'Nothing here',
  'tui.overlay.more': '… {length} in total',
  'tui.slash.hints': 'tab completes · ↑↓ select{v}',
  'tui.connect.badToken':
    "{url} refused the connection: the token is wrong or missing.\nSet the server's token in DOMI_TOKEN and try again; if the server has no token configured, it's in ~/.domi/daemon.token on that machine.",
  'tui.connect.unreachable':
    "Can't reach {url}{v}. Make sure domid is running on the other side and listening on this address and port.",
  'tui.connect.ambiguous': '{length} projects are named "{arg}"; use a path instead: {join}',
  'tui.connect.noProject': 'No project named "{arg}". {v}You can also pass a path: domi -p ./path',
  'tui.bridge.usage':
    "Usage:\n  domi bridge pair        generate a pairing code (valid for 5 minutes), then send /pair <code> to your bot in Telegram\n  domi bridge telegram    start the bridge (put the token in DOMI_TELEGRAM_TOKEN or bridge.telegram.token in config.yaml)\n\nThe bridge only pushes long-task progress and approvals; it can't start or change tasks from Telegram, and it never sends file contents.",
  'tui.bridge.code':
    'Pairing code: {code} (valid for {v} minutes, single use)\nSend this to your bot in Telegram: /pair {code2}',
  'tui.bridge.noToken': 'No Telegram bot token. Create a bot with @BotFather first, then set DOMI_TELEGRAM_TOKEN.',
  'tui.bridge.started': 'Bridge started; Ctrl-C to quit.',
  'tui.review.lastPart': '\nLast part: {slice}',
  'common.untitledParen': '(untitled)',
  'tui.models.failedItem': '{name} ({v})',
  'tui.slash.total': ' · {length} in total',
  'tui.connect.detail': ' ({detail})',
  'tui.connect.didYouMean': 'Did you mean: {join}? ',
  'common.unknown': 'unknown',
  'cli.data.exportHeader':
    '# Exported from {path} (secrets removed; comments in the original file were not carried over)',
  'cli.data.willDelete': 'About to delete permanently:',
  'cli.data.total': '{length, plural, one {# item} other {# items}}, {mb}. **This cannot be undone.**',
  'cli.data.confirm': "If you're sure, type {confirmWord} to confirm; to keep a copy, run domi data export first.",
  'cli.ping.ok': '{provider}/{model} responded',
  'cli.ping.empty': 'The endpoint accepted the request but returned nothing — most likely the model name is wrong',
  'cli.ping.badKey': 'The endpoint is reachable, but the key was rejected: {msg}',
  'cli.ping.badModel': 'The endpoint is reachable and the key works, but model "{model}" wasn\'t found: {msg}',
  'cli.ping.unreachable': "Can't reach {v}: {msg}",
  'cli.ping.timeout': 'Timed out (15 s): {msg}',
  'cli.doctor.sandbox': 'Plugin sandbox',
  'cli.doctor.unsandboxed': 'Plugin code runs without a sandbox',
  'cli.doctor.unsandboxedDetail':
    'You turned on plugins.allowUnsandboxed: plugins can read and write any file and reach any network. Only do this if you fully trust the installed plugins',
  'cli.doctor.noSandbox': 'No plugin sandbox',
  'cli.doctor.noSandboxDetail':
    'This machine has no bwrap / sandbox-exec; {withCode, plural, one {# plugin} other {# plugins}} with code were not loaded (docs/adr/023)',
  'cli.doctor.inferred': 'Providers inferred from the old config format',
  'cli.doctor.inferredItem': '{id} → {vendor} ({protocol} protocol)',
  'cli.doctor.inferredHint':
    '. They work as is; to pin them, open each one in Web under Settings › Model providers and save once, or write vendor in config.yaml',
  'cli.doctor.config': 'Config file',
  'cli.doctor.noConfig': 'Config file not found',
  'cli.doctor.noConfigDetail':
    '{configPath} not found. domi runs without it (everything via environment variables), but creating one is recommended.',
  'cli.doctor.tomlIgnored': 'The old TOML config is ignored',
  'cli.doctor.tomlIgnoredDetail':
    "A YAML config already exists, so {path} is ignored (docs/adr/014). Once you've confirmed the YAML has everything it needs, you can delete it.",
  'cli.doctor.tomlInUse': 'Still using the old TOML config',
  'cli.doctor.tomlInUseDetail':
    '{path} can still be read, but the config format is now YAML (docs/adr/014); TOML support will be removed.',
  'cli.doctor.credential': 'Model credentials',
  'cli.doctor.credentialSet': 'Set ({provider})',
  'cli.doctor.noCredential': 'No model credentials',
  'cli.doctor.needs': '{provider} needs {join}.',
  'cli.doctor.exportKey': '$ export {v}=your-key',
  'cli.doctor.snapshots': 'Step snapshots',
  'cli.doctor.snapshotsOk': 'Available (shadow repository)',
  'cli.doctor.snapshotsOff': 'Step snapshots unavailable',
  'cli.doctor.noGit':
    "git not found, so there's no one-step rollback when the agent breaks a file. domi still runs, just without a safety net.",
  'cli.doctor.gitFix': '$ git --version   # restart domi after installing git',
  'cli.doctor.search': 'Code search',
  'cli.doctor.builtinSearch':
    'Built-in implementation (ripgrep not found; slow in large repositories, and used automatically once installed: brew install ripgrep / apt install ripgrep)',
  'cli.doctor.ripgrep': 'ripgrep ({ripgrep})',
  'cli.doctor.gateway': 'Custom gateway',
  'cli.doctor.endpoint': 'Model endpoint',
  'cli.doctor.official': '{provider} official endpoint',
  'cli.doctor.connectivity': 'Connectivity',
  'cli.doctor.pingDetail': '{detail} ({ms}ms)',
  'cli.doctor.unreachable': "Can't reach the model endpoint",
  'cli.doctor.loop': 'Runtime guards',
  'cli.doctor.loopDetail':
    'Per turn: maxToolCalls={maxToolCalls} · maxArgParseRetries={maxArgParseRetries} · maxWallClockMs={maxWallClockMs}',
  'cli.doctor.dataOk': 'Data directory is writable',
  'cli.doctor.dataBad': 'Data directory is not writable',
  'cli.doctor.dataBadDetail': "Can't write to {dataDir}, so sessions can't be saved.",
  'cli.doctor.allGood': 'All good.',
  'cli.doctor.problems':
    '{bad, plural, one {# item needs} other {# items need}} attention; each one above comes with a command you can paste and run.',
  'cli.args.unknown': 'Unknown command: {given}\nAvailable commands: {join}\n$ domi --help',
  'cli.plugin.usage':
    'Usage:\n  domi plugin list                        installed plugins, sandbox status, and why any failed to load\n  domi plugin install <dir>               install (lists every permission and installs only after you confirm; restart domid afterwards)\n  domi plugin remove <name>               uninstall\n  domi plugin scaffold <tool|skill|mcp> <dir> [name]\n                                          generate a plugin skeleton (with bun test)\n\nSee docs/site/plugin-dev.md for how to write one.',
  'cli.plugin.none': 'No plugins installed yet.',
  'cli.plugin.counts': '    tools {length} · skills {length2} · MCP {length3} · panels {length4}',
  'cli.plugin.needs': '\nPlugin {name} {version}: {description}\nIt needs:',
  'cli.plugin.confirm': '\nInstall it? [y/N] ',
  'cli.plugin.installed':
    'Installed {name} {version}. Takes effect after restarting domid (close every domi window, or kill the domid process)',
  'cli.plugin.removed': 'Uninstalled {v}. Takes effect after restarting domid',
  'cli.plugin.notInstalled': '{v} is not installed',
  'cli.plugin.scaffolded':
    'Generated {name} ({kind} type):\n{join}\n\n$ cd {dir} && bun test\n$ domi plugin install {dir2}',
  'cli.memory.usage':
    'Usage:\n  domi memory list [--all]          list recorded entries (--all includes deleted ones)\n  domi memory search <keywords>     search\n  domi memory delete <id>           delete one (no longer searchable; the events remain)\n  domi memory extract <session id>  extract from a session right now',
  'cli.memory.none':
    'Nothing recorded yet. Entries are extracted automatically after a few turns (memory.extractEvery).',
  'cli.memory.item': '{id}  [{kind}] {text}{v}\n    source {refs}',
  'cli.memory.keywordOnly': '(keyword matching only: memory.embedding is not configured)',
  'tui.memory.noneDot': 'No matching entries.',
  'cli.memory.deleted': 'Deleted {v}',
  'cli.memory.notFound': 'No {v} (or it was already deleted)',
  'cli.memory.extracted':
    'Added {length, plural, one {# entry} other {# entries}}; Soul changed in {length2, plural, one {# place} other {# places}}',
  'cli.soul.usage':
    "Usage:\n  domi soul show                    print the Soul (the file is ~/.domi/soul/soul.md; you can edit it directly)\n  domi soul review                  review changes since last time one by one: a accept / r reject / s skip\n  domi soul update                  go through all memories again (at most 10 changes at a time)\n  domi soul export [file]           export as a single Markdown file (no source comments; refuses if it contains credentials or local paths)\n  domi soul import <file>           import someone else's Soul, confirming section by section",
  'cli.soul.none': "No Soul yet. It's generated automatically after a few turns of conversation.",
  'cli.soul.path': '({soulPath})',
  'cli.soul.nothing': 'Nothing to change.',
  'cli.soul.noPending': 'No pending changes.',
  'cli.soul.needsTty': 'Reviewing has to happen interactively in a terminal.',
  'cli.soul.reviewPrompt': '[a]ccept / [r]eject / [s]kip / [q]uit > ',
  'cli.soul.exportRefused':
    'Export refused: the lines below contain credentials, local paths or email addresses. Fix (or delete) them and export again — nothing is replaced silently for you:',
  'cli.soul.exportLine': '  line {line} [{kind}] {text}',
  'cli.soul.exported': 'Exported to {v}',
  'cli.soul.fileNotFound': '{file} not found',
  'cli.soul.importNeedsTty':
    'Importing has to be confirmed section by section in a terminal; nothing is merged in a non-interactive environment.',
  'cli.soul.nothingToImport': 'Nothing new to import.',
  'cli.soul.importNotice':
    'Imported content was written by someone else: it goes into your prompt, but only as reference material, never as instructions.',
  'cli.soul.importSection': 'Import this section? [y/N] ',
  'cli.soul.imported':
    'Imported {length, plural, one {# entry} other {# entries}} ({length2, plural, one {# section} other {# sections}}). You can take them back later with domi soul review.',
  'cli.hook.commitMsg':
    'The commit message contains something that isn\'t allowed: "{trim}". Remove that line and commit again (the rule comes from your commit-msg hook).',
  'cli.hook.secretHit': '{file}: {slice}…',
  'cli.hook.secrets':
    'Suspected credentials in the staging area; commit refused:\n{join}\nUnstage them (git restore --staged <file>) and use environment variables instead.',
  'cli.hook.usage':
    'Usage: domi hook commit-msg [extra regexes...] | domi hook secrets (referenced from hooks in config.yaml)',
  'cli.onboard.step1': 'Step 1 of 4: pick a model provider',
  'cli.onboard.step1Hint':
    'Anthropic · OpenAI · DeepSeek · Gemini · custom gateway (local models go through the last one)',
  'cli.onboard.step2': 'Step 2 of 4: enter the API key',
  'cli.onboard.step2Hint':
    'You can also set the environment variable and restart; the key is never written to the event stream or logs',
  'cli.onboard.step3': 'Step 3 of 4: check connectivity',
  'cli.onboard.step3Hint':
    'Sends a minimal request to confirm the key and the network work; if it fails, it tells you which part',
  'cli.onboard.step4': 'Step 4 of 4: start chatting',
  'cli.onboard.step4Hint': 'Try "read the README and summarize it in three sentences"',
  'cli.run.noEval':
    "The eval layer isn't available (packages/eval isn't in this install). Other commands are unaffected.",
  'cli.run.noTrace':
    "The trace layer isn't available (packages/trace isn't in this install). Other commands are unaffected.",
  'cli.init.alreadyProject': '{root} already has .domi/ and a rules file; nothing changed.',
  'cli.init.created': 'Created in {root}:\n{join}\n',
  'cli.init.projectHint':
    'Rules go in AGENT.md, project-level Skills in .domi/skills/<name>/SKILL.md. The first time you open a session here, domi asks whether you trust this repository.',
  'cli.init.noLegacy': '{legacy} not found; nothing to migrate.\n$ domi init > {join}   # start from the template',
  'cli.init.convertedHeader':
    "# Converted from {legacy} (domi init --from-toml). Comments in the original file couldn't be carried over; add them back by hand if you need them.",
  'cli.trust.none': "You haven't answered for any repository yet.",
  'cli.trust.trusted': 'trusted  ',
  'cli.trust.untrusted': 'untrusted',
  'cli.trust.revoked':
    "No longer trusting {root}: its AGENT.md and .domi/skills won't go into the prompt (from the next session).",
  'cli.trust.granted': 'Trusting {root}: its AGENT.md and .domi/skills go into the prompt (from the next session).',
  'cli.session.restoreUsage': 'Usage: $ domi session restore <id>',
  'cli.session.notFound':
    'No such session: {restoreId}\n$ domi session all   # list every session, including deleted ones',
  'cli.session.restored': 'Restored {restoreId}',
  'cli.session.none': 'No sessions yet. $ domi   # start your first chat',
  'cli.session.row': '{id}  {when}  {v}  {messageCount, plural, one {# message} other {# messages}}  {v2}',
  'cli.data.exportUsage': 'Usage: $ domi data export <dir>',
  'cli.data.exported':
    'Exported {sessions, plural, one {# session} other {# sessions}} and {events, plural, one {# event} other {# events}} to {dir}',
  'cli.data.typeConfirm': "\nType {PURGE_CONFIRM_WORD} by hand to confirm (--yes doesn't apply to purge).",
  'cli.data.usage': 'Usage: $ domi data export <dir>   or   $ domi data purge',
  'common.or': ' or ',
  'cli.memory.deletedTag': '  (deleted)',
  'common.untitledParenAscii': '(untitled)',
  'cli.help': `domi — a local-first agent runtime

Usage:
  domi                      start chatting (the usual way; no subcommand needed)
  domi --chat               open a free-form chat (no project context, lives in ~/.domi/scratch); without it you get a task inside a repository and a chat elsewhere
  domi -p <project or path> start a task in this project
  domi --isolate            open a session in an isolated workspace (git worktree; your workspace is untouched; review and bring the changes back afterwards)
  domi --connect ws://host:port
                            connect to domid on another machine (put the token in DOMI_TOKEN)
  domi doctor               health check; every problem comes with a command you can paste and run
  domi doctor --ping        also send one real request, to tell "wrong key / gateway down / wrong model name" apart
  domi init                 print a config.yaml template
  domi init --from-toml     print the old config.toml converted to YAML (comments can't be carried over)
  domi init --project       create .domi/ (project-level Skills) and an AGENT.md template in this repository
  domi trust [path] [--revoke]  trust / stop trusting a repository (its AGENT.md and .domi/skills are read only once trusted)
  domi trust list           list repositories you've answered for
  domi session list         list sessions
  domi session restore <id> restore a soft-deleted session
  domi data export <dir>    export every event stream and the config (JSONL + YAML, no proprietary format)
  domi data purge           wipe ~/.domi (asks you to type a confirmation word)
  domi prompt dump          print the final assembled prompt and the stable-prefix boundary
  domi report-bug           bundle the logs (lists the contents for you to confirm first)
  domi eval record <id>     export a real session as a replay fixture
  domi eval run             replay every fixture (offline, costs nothing)
  domi trace <id>           print a session's trajectory tree
  domi trace <id> --html f  export a single-file HTML (opens offline)
  domi migrate              upgrade the event store schema; **backs up first**, rolls back on failure
  domi memory list|search|delete|extract   entries recorded about you (L3)
  domi soul show|review|update|export|import   Soul: review changes, export to share, import someone else's
  domi task run|list|status|retry|cancel      long-task orchestration (DAG, runs in domid)
  domi bridge pair|telegram                   Telegram bridge: generate a pairing code / start the bridge
  domi plugin list|install|remove|scaffold    plugins: confirm each permission on install; code runs in a sandbox
  domi review [--base commit] [--spec doc]...  send a read-only reviewer to check changes against the requirements (it can't see the chat history)
  domi hook commit-msg|secrets                example hooks (referenced from hooks in config.yaml)

In a chat:
  /compact                  compact the context by hand
  /model [name]             switch models mid-session (no name opens the model list; the provider comes from settings)
  /branch [seq]             branch a new session from an event (default: the last one) and switch to it
  /ref <session id> [from-to]  quote part of another session in your next message (no range = the whole session)
  /plan  /act               plan mode (read-only; drafts a plan for your approval) / back to act mode
  /budget tokens|cost|calls <n>  usage limit for this session (warns at 80%, pauses and asks when reached)
  /changes [file]           changes in an isolated session (with a file name, shows its diff)
  /discard <file>           discard one file's changes (/undo <number> to undo)
  /apply [squash|merge|branch]  bring the changes back to the original repository (asks you first)
  /sessions [--all]         list sessions (--all includes deleted ones)
  /open <id>  /new          switch to a session / start a new one
  /delete <id>  /restore <id>  soft-delete / restore a session
  /soul                     see Soul changes pending review; /soul accept|reject <id>
  /memory [keywords]        see the entries recorded about you; /extract pulls them from this session right now

Options:
  -h, --help      show this
  -v, --version   version
      --json      machine-readable output
  -y, --yes       skip confirmations (purge ignores it)`,
  'cli.configTemplate': `# domi config (YAML, docs/adr/014). Environment variables take precedence over this file.
# Lives at ~/.domi/config.yaml
# Default model: provider is one of the ids under providers below, name is a model of that provider
model:
  provider: anthropic
  name: claude-sonnet-4-5

# Model providers (docs/prd/M9.md). The key is the id; Web Settings › Model providers edits this same section.
# Don't put keys in this file: the settings page writes them to ~/.domi/secrets.yaml, or use environment variables
# (DOMI_<ID>_API_KEY, plus each vendor's usual ANTHROPIC_API_KEY / OPENAI_API_KEY and so on)
providers:
  anthropic:
    vendor: anthropic           # openai / anthropic / deepseek / gemini / custom: sets the default URL, protocol and capabilities
  # my-gateway:
  #   name: Company gateway
  #   vendor: custom
  #   protocol: openai          # custom only: openai or anthropic
  #   base_url: http://localhost:4000/v1
  #   models: [qwen3-coder]     # list models by hand when probing finds none
  #   capabilities:             # custom starts with everything off; turn on what the gateway supports
  #     toolCall: true

# Interface: language auto / zh / en (auto follows the system); the accent color is shared by Web and TUI
# ui:
#   locale: auto
#   accent: blue

context:
  maxTokens: 150000
  includeReasoning: false
  strategy: full                # full / clean (deterministic cleanup) / compact (cleanup + auto-compaction at the threshold); see docs/adr/005

# Permissions are deny-by-default. Any capability not listed here is not allowed.
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

    # Cross-session search (PRD-M2-004). It's a read, but **the history contains your own words**,
    # so whether domi may dig through old conversations is decided by this rule, not by "it's only a read".
    # Delete this rule = deny by default, and domi won't search history
    - name: allow-memory-search
      capability: memory.search
      decision: allow

    # Spawning sub-agents: a sub-agent's permissions can only be narrower than the current session's (docs/adr/020)
    - name: ask-task-spawn
      capability: task.spawn
      decision: ask

    # A Skill's body is text; reading it executes nothing (docs/adr/019)
    - name: allow-skill-load
      capability: skill.load
      decision: allow

    # Plugin tools show up as plugin.<plugin>.<tool> (docs/adr/022). Which files a plugin may read or write and which hosts it may reach
    # is fixed by the snapshot you confirmed on install; calls themselves still go through these rules
    - name: confirm-plugins
      capability: plugin.*
      decision: ask

    # Browsing web pages and clicking around: every step asks you (ADR-016). To loosen it, allow exact tool names,
    # e.g. capability: mcp.computer.screenshot — don't allow the whole group
    - name: confirm-browser
      capability: mcp.browser.*
      decision: ask
    - name: confirm-computer
      capability: mcp.computer.*
      decision: ask

# MCP servers (docs/adr/015, 016). Tools show up as mcp.<name>.<tool> and go through the permission rules above.
mcp:
  # Hosts HTTP servers may reach; anything unlisted is denied (localhost must be listed too). *.example.com is supported
  allowedHosts: []
  servers:
    # Browser (Playwright MCP, official from Microsoft). Set enabled to true to use it
    - name: browser
      command: npx
      args: [-y, "@playwright/mcp@0.0.81", --headless, --isolated]
      enabled: false
    # Desktop: screenshots, mouse, keyboard, apps (on macOS, grant the terminal Accessibility permission)
    - name: computer
      command: npx
      args: [-y, --prefer-offline, "@zavora-ai/computer-use-mcp@7.4.0"]
      enabled: false
    # Other servers follow the same pattern: command/args for stdio, url for HTTP
    # - name: docs
    #   url: https://mcp.example.com/mcp

# Memory and Soul (docs/adr/018, 019). The Soul is ~/.domi/soul/soul.md; you can edit it by hand
# memory:
#   extractEvery: 5        # extract every N turns; 0 = manual only (domi memory extract <session>)
#   soul: true             # false = don't update the Soul or put it in the prompt
#   embedding:             # semantic search only when configured; anthropic has no embedding API
#     provider: openai
#     model: text-embedding-3-small

# Long-task notifications (domi task …, docs/adr/021). Only status is sent, never any content
# notify:
#   system: true                         # macOS / Linux system notifications
#   webhook:
#     url: https://example.com/hook      # POST JSON; failures don't affect the task

# Telegram bridge: pair with domi bridge pair, start with domi bridge telegram. The token is better kept in DOMI_TELEGRAM_TOKEN
# bridge:
#   telegram:
#     token: "123456:ABC..."

# Plugins (docs/adr/022, 023). Install with domi plugin install <dir>, list with domi plugin list
# plugins:
#   enabled: true            # false = load no plugins at all
#   allowUnsandboxed: false  # whether to load plugins with code when there's no bwrap / sandbox-exec (not recommended)

# Hooks (docs/adr/025): run your commands before a tool call (pre; a non-zero exit blocks it), after it (post), and after a turn (stop).
# **Only this file counts**; no file in a repository can register hooks. The environment has DOMI_TOOL / DOMI_CMD / DOMI_PATH and more
# hooks:
#   - name: commit-msg          # no attribution lines like Co-Authored-By in commit messages
#     on: pre
#     match: shell.exec
#     run: domi hook commit-msg
#   - name: secrets             # refuse commits when the staging area has suspected credentials
#     on: pre
#     match: shell.exec
#     run: domi hook secrets
#   - name: format              # format files after they're written; the output is attached to the tool result
#     on: post
#     match: fs.write
#     run: npx biome format --write "$DOMI_PATH"
#     timeoutMs: 20000

# Verify before finishing (PRD-M7-004): when files changed but nothing was verified and the model wants to stop, domi reminds it to verify
# verify:
#   command: pnpm check      # if unset, common commands like test / check / tsc / lint are recognized
#   maxNudges: 2

# Usage limit per session (PRD-M7-009): warns at 80%, pauses and asks when reached
# budget:
#   costUsd: 2
#   toolCalls: 200

# Custom prompt layers (domi prompt dump shows the assembled result). The same id overrides a built-in layer, e.g. builtin.conventions
# prompt:
#   layers:
#     - id: my.style
#       text: Keep answers short, conclusion first.

# Where domid listens (docs/adr/017). By default only this machine can connect; no need to change it.
# To connect from another machine (domi --connect ws://this-machine:7437), set host to 0.0.0.0:
# a token is then required — if you don't set one, domid generates it into ~/.domi/daemon.token
server:
  host: 127.0.0.1
  port: 7437
  # token: at least 24 characters (letters, digits, . _ ~ -); the DOMI_TOKEN environment variable is preferred
`,
  'trace.cumulative': 'cumulative {fmtCost}',
  'trace.folded': '{preview}\n(folded, {bytes} bytes in total; expand to see everything)',
  'trace.truncated': '{join}\n({v} more lines, {bytes} bytes in total; export HTML to see everything)',
  'trace.title': 'Trajectory · {sessionId}',
  'trace.totalCost': 'Total cost: {fmtCost}',
  'trace.unpriced': '(not in the price table: {join}; not included in the total)',
  'trace.help':
    "domi trace — see what every step was thinking\n\n  domi trace <sessionId>              print the trajectory tree in the terminal\n  domi trace <sessionId> --html <path>  export a single-file HTML (no external requests, opens offline)\n\nFind session ids with `domi session list`. Trajectories are rendered entirely from the event stream; there's no separate instrumentation.",
  'trace.noEvents': 'Session {sessionId} has no events. Check the id with `domi session list`.',
  'trace.htmlNeedsPath': '--html must be followed by a file path',
  'trace.exported':
    'Exported {htmlOut} ({length, plural, one {# event} other {# events}}; the file makes no network requests and can be opened by double-clicking)',
  'trace.unknownEvent': 'Unknown event {t}',
  'trace.youSaid': 'You said',
  'trace.permission': '{capabilityId} → {decision} (source: {source}{v})',
  'trace.result': 'Result',
  'trace.usage': 'Usage',
  'trace.errorRecoverable': 'Error (recoverable)',
  'trace.error': 'Error',
  'trace.preserved': '\nKept for references: {join}',
  'trace.subAgent': 'Sub-agent: {goal}',
  'trace.childSession': 'Session {childSessionId}{v}',
  'trace.task': 'Task: {name}',
  'trace.nodeStart': 'Node {nodeId} started (attempt {attempt})',
  'trace.nodeEnd': 'Node {nodeId} {v}',
  'trace.resume': 'Resumed',
  'trace.resumeDetail': 'Done: {v}\nRerun: {v2}',
  'trace.pluginError': 'Plugin {plugin} failed',
  'trace.timeout': 'Timed out',
  'trace.blocked': 'Blocked',
  'trace.exitCode': 'Exit code {exitCode}',
  'trace.hook': 'Hook {name} ({on})',
  'trace.trusted': 'Trusted this repository',
  'trace.untrusted': "Didn't trust this repository",
  'trace.rootSource': '{root} ({source})',
  'trace.verifyNudge': 'Reminded to verify (attempt {attempt})',
  'trace.planMode': 'Entered plan mode',
  'trace.actMode': 'Entered act mode',
  'trace.planProposed': 'Submitted a plan',
  'trace.planApproved': 'Plan approved',
  'trace.longRun': ' (long task {runId})',
  'trace.worktree': 'Isolated workspace',
  'trace.worktreeDetail': '{path} (branch {branch}, based on {slice})',
  'trace.discard': 'Discarded changes: {path}',
  'trace.undo': 'Restored changes: {path}',
  'trace.apply': 'Brought back to the original repo ({mode}){v}',
  'trace.budgetWarn': 'Usage at 80%: {kind}',
  'trace.budgetDecided': 'Usage limit reached: {action}',
  'trace.newLimit': 'New limit {limit}',
  'trace.findings': 'Review found {length}',
  'trace.retry': 'Retry {nodeId}',
  'trace.runEnd': 'Task ended: {status}',
  'trace.htmlFolded': '<div class="note">{bytes} bytes in total, folded by default</div>',
  'trace.htmlUnpriced': '<span class="note">(not in the price table: {escapeHtml}; not included in the total)</span>',
  'trace.htmlPage':
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>domi trajectory · {escapeHtml}</title>\n<style>{CSS}</style>\n</head>\n<body>\n<h1>domi trajectory</h1>\n<div class="meta">Session {escapeHtml2} · {length, plural, one {# top-level node} other {# top-level nodes}} · this file makes no network requests</div>\n{body}\n<div class="total">Total cost: {fmtCost} {note}</div>\n</body>\n</html>\n',
  'eval.help':
    'domi eval — L1 deterministic trajectory replay (offline, costs nothing)\n\n  domi eval record <sessionId>   export a real session as a fixture\n  domi eval run [fixture...]     replay fixtures and assert the tool-call sequence matches the recording\n  domi eval l2 [task id...] [--rounds N] [--tasks <dir>]\n                                 L2: run the eval/l2 task set with a real model (costs money, not in CI); 3 rounds by default\n  domi eval mine <repo> [--since 2026-01-01] [--limit 50] [--test-cmd "bun test {files}"] [--setup "..."] [--out eval/mined/<name>]\n                                 mine tasks from git history: kept only if the tests fail on the parent commit and pass with this commit\'s changes (free, but runs the tests)\n\nFixtures are read and written under {FIXTURE_DIR}/ by default. Replay makes no network requests at all.',
  'eval.recordUsage': 'Usage: domi eval record <sessionId>\n(find session ids with `domi session list`)',
  'eval.recorded': 'Recorded {out}\n',
  'eval.recordedDetail':
    '  {length, plural, one {# event} other {# events}} → {length2, plural, one {# turn} other {# turns}}, {length3, plural, one {# tool call} other {# tool calls}}',
  'eval.skip': 'Skipped {p}: {v}',
  'eval.noFixtures': 'No fixtures under {FIXTURE_DIR}/. Run `domi eval record <sessionId>` first.',
  'eval.passed': '\n{v}/{length} passed',
  'eval.noTasks': 'No tasks under eval/l2/tasks (or none of the given task ids exist)',
  'eval.l2Start':
    'L2: {length, plural, one {# task} other {# tasks}} × {rounds} rounds, model {provider}/{name}. This costs real money.',
  'eval.l2Attempt': '  {v} {taskId} round {round} ({toFixed}s)',
  'eval.l2Done': '\n{join}\n\nReport: {join2}',
  'eval.mineUsage':
    'Usage: domi eval mine <repo path> [--since date] [--limit N] [--test-cmd "..."] [--setup "..."] [--out dir]',
  'eval.mined': '\nKept {kept} / {length} tasks → {join}\nReport: {join2}',
  'eval.unknownSub': 'Unknown subcommand: eval {sub}\n{EVAL_HELP}',
  'eval.replayOk':
    '✓ {fixture} — {actualCalls, plural, one {# tool call} other {# tool calls}}, matching the recording',
  'eval.replayUnknown': '✗ {fixture} — unknown difference',
  'eval.replayDiverged': '✗ {fixture} — diverged at tool call {v} (event seq {v2})',
  'eval.expected': '  expected: {v}',
  'eval.actual': '  actual: {v}',
  'eval.jump': '  jump to: trajectory panel seq {v}',
  'bridge.paired': 'Paired. Long-task progress and approvals will be pushed here.',
  'bridge.alreadyPaired': 'This chat is already paired.',
  'bridge.codeExpired': 'The pairing code has expired; run domi bridge pair on your computer again.',
  'bridge.codeWrong': 'Wrong pairing code.',
  'bridge.noCode': 'No pairing code yet: run domi bridge pair on your computer.',
  'bridge.readOnly': "Only progress and approvals are pushed here; you can't start or change tasks.",
  'bridge.ask': '⏸ Needs confirmation: {capabilityId}',
  'bridge.file': 'File: {basename}',
  'bridge.writeLines': 'Writes {length, plural, one {# line} other {# lines}}',
  'bridge.program': 'Program: {v}',
  'bridge.formAsk': '(This request needs a form; in Telegram you can only reject it. To fill it in, go to TUI / Web)',
  'bridge.seeFull': 'See the full content in TUI or Web',
  'bridge.notPaired': "This chat isn't paired",
  'bridge.badButton': "Didn't understand that button",
  'bridge.expired': 'This request has expired',
  'bridge.allowed': 'Allowed',
  'bridge.denied': 'Denied',
  'bridge.answeredElsewhere': 'Already answered elsewhere',
  'trace.rule': ', rule: {matchedRule}',
  'trace.tools': '\nCapabilities: {join}',
  'common.none': 'none',
  'trace.failedSuffix': ' failed',
  'eval.notProduced': 'not produced',
  'eval.noMoreCalls': '(no more calls)',
  'error.unknown_method': 'No such method: {method}\nAvailable: {available}',
  'error.not_handshaked': 'The first request must be handshake',
  'error.unsupported': "This domid doesn't support {feature}",
  'error.feature.rename': 'renaming',
  'error.feature.createTask': 'creating tasks from a goal',
  'error.feature.config': 'changing settings from here',
  'error.feature.resolveModel': 'resolving models by name',
  'error.feature.usage': 'usage statistics',
  'error.feature.composer': 'attachments and file references',
  'error.feature.projects': 'projects',
  'error.feature.review': 'reviews',
  'error.feature.budget': 'usage limits',
  'error.feature.planMode': 'plan mode',
  'error.feature.worktrees': 'isolated workspaces',
  'error.feature.schedules': 'scheduled tasks',
  'error.feature.refs': 'cross-session references',
  'error.session_not_found': 'No such session: {sessionId}',
  'error.busy.delete': 'This session is busy; wait for it to stop before deleting it',
  'error.busy.switch': 'This session is busy; wait for this turn to finish before switching',
  'error.busy.operate': 'This session is busy; wait for this turn to finish',
  'error.busy.submit': 'This session is still working on the previous input; try again shortly',
  'error.busy': 'This session is busy',
  'error.no_panel': 'No plugin panel {plugin}/{id}',
  'error.not_implemented': 'Not implemented: {method}',
  'error.scheduler_off': "The scheduler isn't running",
  'error.project_archived': 'Project "{name}" is archived; unarchive it first',
  'error.schedule_not_found': 'No such scheduled task: {id}',
  'error.not_isolated': '{sessionId} is not an isolated session',
  'error.missing_credential':
    'No API key configured for {provider} yet. Add it under Settings › Model providers (takes effect as soon as you save), or set the environment variable {envNames} and restart domid.',
  'error.project.dirMissing': "Directory doesn't exist: {path}",
  'error.project.notDir': 'Not a directory: {path}',
  'error.project.notFound': 'No such project: {id}',
  'error.soul_conflict':
    'The Soul changed after you opened it (domi may have just updated it, or you edited it elsewhere). Refresh and save again',
  'error.worktree.gitFailed': '{what} failed: {detail}',
  'error.worktree.notGit':
    "{cwd} isn't inside a git repository, so it can't be isolated. You can open the session without isolation (step snapshots still cover your changes)",
  'error.worktree.noCommit':
    "{repo} has no commits yet, so an isolated workspace can't be created from HEAD. Commit once and try again",
  'error.worktree.outside': 'Path is not inside the isolated workspace: {file}',
  'error.worktree.badTrash': 'Invalid trash number: {trash}',
  'error.worktree.noTrash': 'Nothing numbered {trash} in the trash',
  'error.worktree.dirty':
    'The isolated workspace {path} still has uncommitted changes. Bring them back to the original repo (or keep just the branch), or discard them one by one, before deleting the session',
  'error.attachment.tooLarge': '"{name}" is {sizeMB}MB, over the {maxMB}MB limit for a single attachment',
  'error.attachment.badId': 'Invalid attachment id: {id}',
  'error.attachment.notFound': 'No attachment {id} in this session (upload it before submitting)',
  'error.attachment.noVision':
    "The current model {model} doesn't accept images ({names}). Switch to a model that supports images and send again",
  'error.attachment.fileOutside': "The referenced file isn't inside the working directory: {path}",
  'error.attachment.fileMissing': "The referenced file doesn't exist: {path}",
  'error.attachment.noSkill': 'No such skill: {name}',
  'error.review.notGit': "{cwd} isn't inside a git repository; there's no diff to review",
  'error.review.diffFailed': 'git diff {base} failed: {detail}',
  'error.review.noChanges': 'No changes relative to {base}; nothing to review',
  'error.review.noSpec': "Requirements doc doesn't exist: {path}",
  'error.ref.noSession': "The referenced session doesn't exist: {sessionId}",
  'error.ref.outOfRange': 'Reference out of range: session {sessionId} has only {head} events, not event {fromSeq}',
  'error.ref.reversed': 'The reference range is reversed: {fromSeq}–{toSeq}',
  'error.config.denied': "These settings can't be changed from here: {keys}",
  'error.config.legacyToml':
    'The config is still in the old TOML format ({path}); migrate it to YAML first: domi init --from-toml',
  'error.config.notString': '{key} must be a string',
  'error.config.defaultProvider':
    '"{provider}" hosts the default model, so it can\'t be disabled or deleted. Switch the default model to another provider first.',
  'error.model.ambiguous': '"{name}" is offered by several providers: {providers}. Pick the exact one from the list.',
  'error.model.unresolved':
    'No enabled provider offers "{name}". Add it under Settings › Model providers (list it manually or probe again).',
  'error.model.providerUnavailable': 'Provider "{provider}" doesn\'t exist or is disabled',
  'error.cron.field': 'Field {index} ({label}) "{text}" {why}',
  'error.cron.count': 'Needs 5 fields (minute hour day month weekday); got {count}',
  'error.cron.tz': 'Unknown time zone "{tz}"; e.g. Asia/Shanghai, UTC',
  'error.cron.never': 'This schedule never fires (e.g. February 30)',
  'error.branch_out_of_range':
    'Branch point out of range: session {sessionId} has only {head} events, not event {atSeq}',
  'error.cron.label.minute': 'minute',
  'error.cron.label.hour': 'hour',
  'error.cron.label.day': 'day',
  'error.cron.label.month': 'month',
  'error.cron.label.weekday': 'weekday',
  'error.cron.why.notNumber': 'contains "{s}", which isn\'t a number',
  'error.cron.why.outOfRange': 'is out of range {min}-{max}',
  'error.cron.why.empty': 'has an empty item',
  'error.cron.why.multiSlash': 'has more than one /',
  'error.cron.why.step': 'has step "{step}", which must be a positive integer',
  'error.cron.why.badRange': 'has a malformed range',
  'error.cron.why.reversed': 'has the range {lo}-{hi} reversed',
  'error.no_credential':
    'No model credentials found. Set {envNames}, or put the key in ~/.domi/secrets.yaml (the settings page writes it there).',
  'error.worktree.op.create': 'Creating the isolated workspace',
  'error.worktree.op.reattach': 'Re-attaching the isolated workspace',
  'error.worktree.op.readChanges': 'Reading changes',
  'error.worktree.op.restoreFile': 'Restoring the file',
  'error.worktree.op.stage': 'Staging changes',
  'error.worktree.op.commit': "Committing the isolated workspace's changes",
  'error.worktree.op.readCommit': 'Reading the commit',
  'error.worktree.op.readBranch': 'Reading the branch',
  'error.worktree.op.readChangeList': 'Reading the change list',
  'error.worktree.op.remove': 'Removing the isolated workspace',
  'daemon.notify.done': 'Task done: {name}',
  'daemon.notify.failed': 'Task failed: {name}',
  'daemon.notify.allDone': 'All {count, plural, one {# node} other {# nodes}} done',
  'daemon.notify.failedNodes': 'Failed nodes: {nodes}',
  'tui.scroll.newItems': '{n, plural, one {# new message} other {# new messages}} · Ctrl+End to jump back',
  'tui.scroll.dumpHint':
    "— The full conversation is above (written to your terminal's scrollback; use its own search and copy). Press any key to return to domi —",
  'tui.renderer.fellBack':
    'The fullscreen renderer failed to start last time, so the classic renderer is used (set tui.renderer: fullscreen or DOMI_TUI_RENDERER=fullscreen to try again)',
  'tui.hint.scroll': 'scroll',
  'tui.hint.dump': 'scrollback',
  'tui.hint.send': 'send',
  'tui.hint.newline': 'newline',
}
