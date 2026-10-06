import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8')
const calls = []
let openCodeEnabled = true
let pluginEnabled = true
const context = vm.createContext({
  watchRoot: 'D:/project',
  HttpError: class extends Error { constructor(status, message) { super(message); this.status = status } },
  codexBridge: { runningTurns: new Map(), async call(method, params) {
    calls.push({ method, params })
    if (method === 'config/read') return { config: { plugins: { 'plugin@market': { mcp_servers: { 'plugin-server': { enabled: pluginEnabled } } } }, mcp_servers: { local: { enabled: true, env: { TOKEN: 'secret' } }, off: { enabled: false } } } }
    if (method === 'config/value/write') pluginEnabled = params.value
    if (method === 'mcpServerStatus/list') return { data: [{ name: 'local', tools: { one: {} }, runtimeStatus: 'ready' }, { name: 'plugin-server', pluginId: 'plugin@market', tools: {} }] }
    return {}
  } },
  async openCodeApi(method, route) {
    calls.push({ method, route })
    if (method === 'GET') return { data: [{ name: 'remote', status: { status: openCodeEnabled ? 'connected' : 'disabled' }, environment: { TOKEN: 'secret' } }] }
    openCodeEnabled = route.includes('/connect?')
    return null // Successful OpenCode mutations return HTTP 204.
  },
})
vm.runInContext(source.slice(source.indexOf('function mcpConfigKey('), source.indexOf('const server = createServer(')), context)
const codex = await context.listCodexMcp()
assert.equal(codex.find((server) => server.name === 'off').enabled, false)
assert.ok(!JSON.stringify(codex).includes('secret'))
assert.equal(context.mcpConfigKey('server.with.dots', 'plugin@market'), 'plugins."plugin@market".mcp_servers."server.with.dots".enabled')
await context.setMcpEnabled('codex', 'plugin-server', false)
assert.ok(calls.some((call) => call.method === 'config/value/write' && call.params.keyPath === 'plugins."plugin@market".mcp_servers."plugin-server".enabled' && call.params.value === false))
assert.ok(calls.some((call) => call.method === 'config/mcpServer/reload'))
assert.ok(!calls.some((call) => call.method === 'config/value/write' && call.params.keyPath.endsWith('market".enabled')))
calls.length = 0
await context.setMcpEnabled('opencode', 'remote', false)
assert.equal(openCodeEnabled, false)
assert.ok(!calls.some((call) => call.method === 'config/value/write'))
assert.ok(calls.some((call) => call.route?.includes('/api/experimental/mcp/remote/disconnect?')))
await context.setMcpEnabled('opencode', 'remote', true)
assert.equal(openCodeEnabled, true)
await assert.rejects(context.setMcpEnabled('codex', 'unknown', false), (error) => error.status === 404)
await assert.rejects(context.setMcpEnabled('codex', 'local', 'false'), (error) => error.status === 400)
context.codexBridge.runningTurns.set('busy', {})
await assert.rejects(context.setMcpEnabled('codex', 'local', false), (error) => error.status === 409)
console.log('Passed: separate agent controls, disabled discovery, per-server plugin keys, Codex reload, OpenCode disconnect/reconnect, secret-free inventory, invalid input and busy protection.')
