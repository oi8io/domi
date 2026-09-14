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
