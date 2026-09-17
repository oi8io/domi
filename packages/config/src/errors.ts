/** 配置文件读不懂（语法或 schema）。单独一个文件，免得 load / secrets 互相引用 */
export class ConfigParseError extends Error {
  readonly messageKey = 'error.config_invalid'
  constructor(
    readonly path: string,
    detail: string,
  ) {
    super(`error.config_invalid: ${path} 解析失败 —— ${detail}`)
    this.name = 'ConfigParseError'
  }
}
