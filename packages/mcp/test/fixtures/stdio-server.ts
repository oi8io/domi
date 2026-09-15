// stdio 版的测试 server：`bun stdio-server.ts`
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { buildServer } from './servers.ts'

await buildServer({ name: 'stdio-fixture' }).connect(new StdioServerTransport())
