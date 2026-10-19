#!/usr/bin/env node
/**
 * docs/site 静态文档站渲染器
 * 把 docs/site/*.md 渲染为带导航的 HTML（micromark + GFM），
 * 输出到 docs/site/*.html，源 md 保留。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const PNPM = path.join('/Users/dymo/Develop/learn/ai/domi', 'node_modules', '.pnpm');

function resolvePkg(prefix) {
  const dir = fs.readdirSync(PNPM).find((d) => d.startsWith(prefix + '@'));
  if (!dir) throw new Error('missing pnpm package ' + prefix);
  return path.join(PNPM, dir, 'node_modules', prefix);
}

const { micromark } = require(resolvePkg('micromark'));
const { gfm, gfmHtml } = require(resolvePkg('micromark-extension-gfm'));

// ---------- 导航数据（与 index.md 分组一致） ----------
const NAV = [
  { group: '概览', items: [['index', '文档站首页'], ['intro', 'domi 是什么']] },
  { group: '快速开始', items: [['quickstart', '快速开始']] },
  {
    group: '架构与内幕', items: [
      ['architecture', '架构'], ['agent-loop', 'Agent Loop 内部机制'],
      ['protocol', 'Domi Protocol'], ['daemon-internals', 'daemon 内部机制'],
      ['session-storage', '会话存储与事件流'], ['trajectory-and-replay', '轨迹与回放'],
      ['prompt-assembly', '提示词分层与 cache'], ['context-compression', '压缩与 prompt cache'],
      ['memory-and-soul', '记忆分层与 Soul'], ['orchestration', '编排'],
      ['model-runtime', '模型运行时'], ['tools-runtime', '工具与权限运行时'],
      ['mcp-internals', 'MCP 接入'], ['plugins', '插件运行时'],
      ['scheduling', '定时任务'], ['config', '配置与厂商'],
      ['cli', 'CLI 与命令'], ['clients', '三端'], ['eval', '评估体系'],
    ],
  },
  {
    group: '扩展', items: [
      ['plugin-dev', '插件开发'], ['skill-writing', 'Skill 编写'],
      ['adding-tools', '添加工具'], ['adding-providers', '添加模型供应商'],
      ['programmatic-integration', '编程集成'],
    ],
  },
  { group: '参与', items: [['contributing', '贡献指南']] },
];

// 主站相对路径（docs/site/docs → docs/site/web）
const HOME = '../web/index.html';

const TPL_CSS = `
:root{
  --bg:#070B0F;--panel:#0D141B;--panel2:#111A23;--line:#1B2836;
  --ink:#E8EEF4;--muted:#8FA1B2;--cyan:#22D3EE;--green:#4ADE80;
  --violet:#A78BFA;--amber:#FBBF24;
  --mono:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --sans:'Noto Sans SC',-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:15.5px;line-height:1.75;-webkit-font-smoothing:antialiased}
a{color:var(--cyan);text-decoration:none}
a:hover{text-decoration:underline}
code,kbd,.mono{font-family:var(--mono)}
/* 顶栏 */
.top{position:sticky;top:0;z-index:50;background:rgba(7,11,15,.88);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.top-in{max-width:1240px;margin:0 auto;padding:0 20px;height:58px;display:flex;align-items:center;justify-content:space-between;gap:14px}
.brand{display:flex;align-items:center;gap:10px;font-weight:900;font-size:17px;color:var(--ink)}
.brand .mark{width:20px;height:20px;border:2px solid var(--cyan);border-radius:6px;position:relative;flex:none}
.brand .mark::before{content:"";position:absolute;left:4px;top:7px;width:7px;height:2px;border-radius:1px;background:var(--green)}
.brand .mark::after{content:"";position:absolute;left:4px;top:12px;width:4px;height:2px;border-radius:1px;background:var(--cyan)}
.brand small{font-weight:500;color:var(--muted);font-size:12px}
.top-links{display:flex;gap:18px;font-size:13.5px;font-weight:500}
.top-links a{color:var(--muted)}
.top-links a:hover{color:var(--ink);text-decoration:none}
/* 布局 */
.layout{max-width:1240px;margin:0 auto;padding:26px 20px 60px;display:grid;grid-template-columns:248px 1fr;gap:34px}
.side{position:sticky;top:84px;align-self:start;max-height:calc(100vh - 110px);overflow-y:auto;padding-right:6px}
.side::-webkit-scrollbar{width:5px}
.side::-webkit-scrollbar-thumb{background:var(--line);border-radius:3px}
.navgroup{margin-bottom:20px}
.navgroup h4{font-family:var(--mono);font-size:11.5px;letter-spacing:.12em;color:var(--muted);margin-bottom:8px;text-transform:uppercase}
.navgroup a{display:block;font-size:13.5px;color:var(--muted);padding:5px 10px;border-radius:6px;border-left:2px solid transparent;line-height:1.45}
.navgroup a:hover{color:var(--ink);background:var(--panel);text-decoration:none}
.navgroup a.active{color:var(--cyan);border-left-color:var(--cyan);background:rgba(34,211,238,.07)}
/* 正文 */
.content{min-width:0}
.content h1{font-size:clamp(25px,3vw,34px);font-weight:900;line-height:1.3;letter-spacing:-.01em;margin:6px 0 8px;padding-bottom:14px;border-bottom:1px solid var(--line)}
.content .crumb{font-family:var(--mono);font-size:12px;color:var(--green);margin-bottom:4px}
.content h2{font-size:21px;font-weight:800;margin:34px 0 12px;padding-bottom:8px;border-bottom:1px solid var(--line);line-height:1.4}
.content h3{font-size:17px;font-weight:700;margin:26px 0 10px}
.content h4{font-size:15.5px;font-weight:700;margin:20px 0 8px}
.content p{margin:10px 0}
.content ul,.content ol{margin:10px 0 10px 22px}
.content li{margin:5px 0}
.content blockquote{border-left:3px solid var(--violet);background:var(--panel);padding:12px 16px;margin:14px 0;border-radius:0 8px 8px 0;color:var(--muted)}
.content blockquote p{margin:4px 0}
.content a code{color:var(--cyan)}
.content code{background:rgba(34,211,238,.09);color:#9BE8F5;padding:1.5px 6px;border-radius:5px;font-size:13px;word-break:break-word}
.content pre{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:14px 0;overflow-x:auto;line-height:1.6}
.content pre code{background:none;color:var(--ink);padding:0;font-size:13px;white-space:pre;word-break:normal}
.content table{border-collapse:collapse;margin:16px 0;width:100%;font-size:13.5px;display:block;overflow-x:auto}
.content th,.content td{border:1px solid var(--line);padding:8px 12px;text-align:left;vertical-align:top}
.content th{background:var(--panel);font-weight:700;color:var(--ink);white-space:nowrap}
.content tr:nth-child(even) td{background:rgba(13,20,27,.45)}
.content hr{border:0;border-top:1px solid var(--line);margin:28px 0}
.content img{max-width:100%;border-radius:10px;border:1px solid var(--line)}
/* 页脚 */
.foot{border-top:1px solid var(--line);padding:22px 20px;font-family:var(--mono);font-size:12px;color:var(--muted);display:flex;gap:18px;flex-wrap:wrap;justify-content:space-between;max-width:1240px;margin:0 auto}
.foot a{color:var(--muted)}
.foot a:hover{color:var(--cyan)}
/* 移动端 */
@media (max-width:880px){
  .layout{grid-template-columns:1fr;padding-top:16px}
  .side{position:static;max-height:none;border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:12px 12px 4px;margin-bottom:20px}
  .navgroup{margin-bottom:12px}
  .navgroup a{padding:4px 8px}
  .content pre{-webkit-overflow-scrolling:touch}
}
`;

function renderNav(current) {
  let html = '';
  for (const g of NAV) {
    html += `<div class="navgroup"><h4>${g.group}</h4>`;
    for (const [slug, label] of g.items) {
      const cls = slug === current ? ' class="active"' : '';
      html += `<a${cls} href="${slug}.html">${label}</a>`;
    }
    html += `</div>`;
  }
  return html;
}

function rewriteLinks(html) {
  // 仅改写同目录纯文件名 .md 链接（含锚点），深层相对路径（../、../../、docs/）不动
  return html.replace(/href="([A-Za-z0-9._-]+)\.md(#([^"]*))?"/g, (m, name, hash) => {
    return `href="${name}.html${hash || ''}"`;
  });
}

function page(title, slug, bodyHtml, intro) {
  const crumb = intro ? 'DOMI · 开发者文档' : 'DOMI · DOCS';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — domi 文档</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='6' y='6' width='20' height='20' rx='5' fill='%23070B0F' stroke='%2322D3EE' stroke-width='2'/%3E%3Crect x='12' y='13' width='8' height='2' rx='1' fill='%234ADE80'/%3E%3Crect x='12' y='18' width='5' height='2' rx='1' fill='%2322D3EE'/%3E%3C/svg%3E">
<link rel="stylesheet" href="https://miaoda.feishu.cn/fonts/css2?family=Noto+Sans+SC:wght@400;500;700;900&family=JetBrains+Mono:wght@400;500;700&display=swap">
<style>${TPL_CSS}</style>
</head>
<body>
<div class="top"><div class="top-in">
  <a class="brand" href="index.html"><span class="mark"></span>domi<small>开发者文档</small></a>
  <div class="top-links">
    <a href="${HOME}">← 返回主站</a>
    <a href="index.html">文档首页</a>
  </div>
</div></div>
<div class="layout">
  <aside class="side">${renderNav(slug)}</aside>
  <main class="content">
    <div class="crumb">${crumb}</div>
    ${bodyHtml}
  </main>
</div>
<footer class="foot">
  <span>domi · 通用 AI Agent — 文档站</span>
  <a href="${HOME}">返回主站</a>
</footer>
</body>
</html>`;
}

// ---------- 构建 ----------
const files = fs.readdirSync(HERE).filter((f) => f.endsWith('.md'));
let count = 0;
for (const f of files) {
  const slug = f.slice(0, -3);
  const md = fs.readFileSync(path.join(HERE, f), 'utf8');
  let body = micromark(md, { extensions: [gfm()], htmlExtensions: [gfmHtml()] });
  body = rewriteLinks(body);
  const titleMatch = md.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : slug;
  const html = page(title, slug, body, slug === 'index');
  fs.writeFileSync(path.join(HERE, slug + '.html'), html, 'utf8');
  count++;
}
console.log(`rendered ${count} pages -> docs/site/docs/*.html`);
