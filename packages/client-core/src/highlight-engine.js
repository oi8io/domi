// 语法高亮引擎（ADR-028）。为什么是 .js：见 highlight.ts 顶部注释——不让 tsc 读到 highlight.js 的类型声明。
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import { createLowlight } from 'lowlight'

const LANGS = { bash, css, diff, go, ini, javascript, json, markdown, python, rust, shell, sql, typescript, xml, yaml }
const ALIASES = {
  typescript: ['ts', 'tsx', 'mts', 'cts'],
  javascript: ['js', 'jsx', 'mjs', 'cjs'],
  bash: ['sh', 'zsh'],
  shell: ['console', 'shellsession'],
  python: ['py'],
  rust: ['rs'],
  yaml: ['yml'],
  markdown: ['md'],
  xml: ['html', 'svg', 'vue'],
  ini: ['toml'],
  json: ['jsonc', 'json5'],
}

const low = createLowlight(LANGS)
low.registerAlias(ALIASES)

export const LANG_NAMES = [...Object.keys(LANGS), ...Object.values(ALIASES).flat()]

export function isRegistered(name) {
  return low.registered(name)
}

export function highlightHast(name, code) {
  return low.highlight(name, code)
}
