/** 架构守卫 —— 守 INV-02（架构边界）。见 docs/spec/M0.md §5 */
module.exports = {
  forbidden: [
    {
      name: 'no-io-in-kernel',
      comment: 'INV-02：kernel 零 IO 依赖——不得 import node 的 IO 模块、AI SDK、或 store 的具体实现',
      severity: 'error',
      from: { path: '^packages/kernel/src' },
      // 注意：dependency-cruiser 会把 `node:fs` 归一成 `fs`，所以两种写法都要匹配。
      // 这条规则只管 src/，test/ 里用 node:fs 造违规 fixture 是合法的。
      to: {
        path: [
          '^(node:)?(fs|fs/promises|net|child_process|http|https|dgram|tls|worker_threads)$',
          '^(bun:sqlite)$',
          '^(ai|@ai-sdk/)',
          '^@domi/store/src/sqlite',
        ].join('|'),
      },
    },
    {
      name: 'no-model-sdk-outside-model',
      comment: 'ADR-004：provider SDK 只允许出现在 packages/model',
      severity: 'error',
      from: { pathNot: '^packages/model/src' },
      to: { path: '^(ai|@ai-sdk/)' },
    },
    {
      name: 'no-logic-in-apps',
      comment: 'INV-02：三端零业务逻辑，只经 Domi Protocol / client-core 通信',
      severity: 'error',
      // 允许的只有 runtime / client-core / config / protocol：
      // 前两个是门面与投影，后两个是配置与契约。业务实现一律不许直接 import。
      from: { path: '^apps/(tui|web|desktop)/' },
      to: { path: '^packages/(kernel|store|capability|model|mcp|memory|orchestrator)/' },
    },
    {
      name: 'no-react-in-client-core',
      comment:
        'ADR-009：client-core 的消费方有四类，其中 Telegram 桥接与 L1 回放评估不是 React。' +
        '共享层一旦依赖 react，这两类就用不了它——这是 INV-02 的形状问题，不是洁癖。',
      severity: 'error',
      from: { path: '^packages/client-core/src' },
      to: { path: '^(react|react-dom|ink|@nanostores/react)' },
    },
    {
      name: 'no-node-in-browser-packages',
      comment:
        'PRD-M3-003 AC-2：client-core 与 protocol 要在浏览器里跑，依赖闭包中不得出现 node 核心模块。' +
        '这条在 M0 就守起来，是因为它**只会越来越难守**——等 M3 才发现被污染，' +
        '要往回扒的是几个月的代码。现在守成本为零。',
      severity: 'error',
      from: { path: '^packages/(client-core|protocol)/src' },
      to: { path: '^(node:)?(fs|fs/promises|path|os|net|http|https|crypto|child_process|stream|url|util|worker_threads|bun:sqlite)$' },
    },
    {
      name: 'client-core-no-store',
      comment:
        'PRD-M3-004 AC-1 · INV-01：daemon 是事件流的唯一写入者，客户端只提交意图。' +
        '按包名 import 已被 pnpm 隔离挡住，这条挡的是相对路径摸进 store。',
      severity: 'error',
      from: { path: '^packages/client-core/src' },
      to: { path: '^packages/store/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
  },
}
