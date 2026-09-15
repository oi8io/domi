import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const text = readFileSync('config.yaml', 'utf8')
const c = Bun.YAML.parse(text)
assert.equal(c.server.port, 8080)
assert.equal(c.server.host, '0.0.0.0')
assert.equal(c.log.level, 'info')
assert.ok(text.includes('# 服务配置'), '注释要保留')
