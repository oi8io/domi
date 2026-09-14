/**
 * `react-devtools-core` 的空桩 —— PRD-M1-008 AC-2
 *
 * ink 里 `devtools.js` 静态 import 了它，但只有 `DEV=true` 时才会真正连上去。
 * 为了一个开发期才用的调试通道，把 devtools（连带 ws）打进用户的单二进制里不值当。
 * 打包时把它指到这个空桩，`DEV=true` 的路径在二进制里不可用——这是**刻意的取舍**，
 * 开发时用 `bun apps/tui/src/main.tsx` 跑源码，devtools 照常可用。
 */
export function connectToDevTools(): void {}
export default { connectToDevTools }
