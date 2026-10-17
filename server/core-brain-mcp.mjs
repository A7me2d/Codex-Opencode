import { randomUUID } from 'node:crypto'
import { superAgentTools } from './super-agent-coordinator.mjs'

/** Stateless Streamable HTTP MCP, scoped by an in-memory credential per thread. */
export class CoreBrainMcp {
  constructor(coordinator, turn) { this.coordinator = coordinator; this.turn = turn; this.bindings = new Map(); this.threads = new Map() }
  config(threadId, role, baseUrl) {
    let token = threadId && this.threads.get(threadId)
    if (token && this.bindings.get(token)?.role !== role) { this.bindings.delete(token); token = null }
    if (!token) token = randomUUID() + randomUUID()
    this.bindings.set(token, { threadId, role })
    if (threadId) this.threads.set(threadId, token)
    return { token, config: { 'mcp_servers.openzero_core_brain': { url: `${baseUrl}/api/core-brain/mcp`, http_headers: { Authorization: `Bearer ${token}` }, required: true, default_tools_approval_mode: 'approve', tool_timeout_sec: 660 } } }
  }
  bind(token, threadId) { const binding = this.bindings.get(token); if (binding) { binding.threadId = threadId; this.threads.set(threadId, token) } }
  async handle(request, response, readJson, sendJson) {
    const token = String(request.headers.authorization || '').replace(/^Bearer /, '')
    const binding = this.bindings.get(token)
    if (!binding) { sendJson(response, 401, { error: 'Core-Brain authentication required.' }); return }
    if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); sendJson(response, 405, { error: 'Use MCP POST requests.' }); return }
    const message = await readJson(request)
    if (message.id === undefined && String(message.method).startsWith('notifications/')) { response.writeHead(202); response.end(); return }
    const result = data => sendJson(response, 200, { jsonrpc: '2.0', id: message.id, result: data })
    if (message.method === 'initialize') {
      result({ protocolVersion: ['2025-03-26', '2025-06-18', '2025-11-25'].includes(message.params?.protocolVersion) ? message.params.protocolVersion : '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'openzero-core-brain', version: '1.0.0' } }); return
    }
    if (message.method === 'ping') { result({}); return }
    if (message.method === 'tools/list') {
      result({ tools: superAgentTools[0].tools.filter(tool => binding.role === 'manager' || !['dispatch_tasks', 'get_dispatch_reports'].includes(tool.name)).map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }); return
    }
    if (message.method === 'tools/call') {
      try {
        if (!binding.threadId) throw new Error('The conversation is not ready.')
        const data = await this.coordinator.tool({ threadId: binding.threadId, turnId: this.turn(binding.threadId).turnId, tool: message.params?.name, arguments: message.params?.arguments, callId: String(message.id) })
        result({ content: [{ type: 'text', text: JSON.stringify(data) }], isError: false })
      } catch (error) { result({ content: [{ type: 'text', text: error.message }], isError: true }) }
      return
    }
    sendJson(response, 200, { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Unsupported Core-Brain method.' } })
  }
}
