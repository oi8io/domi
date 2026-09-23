/** highlight-engine.js 的类型（手写：见 highlight.ts 顶部注释） */
export declare const LANG_NAMES: readonly string[]
export declare function isRegistered(name: string): boolean
/** hast 根节点（lowlight 的输出） */
export declare function highlightHast(name: string, code: string): unknown
