import assert from 'node:assert/strict'
import { MochiClineText, loadClineTextSdk } from '../server/mochi/cline-text.mjs'
import { MochiClineModel } from '../server/mochi/cline-model.mjs'

const checks = []
const check = (name, run) => checks.push([name, run])
const input = { provider: 'cline', model: 'test/model', prompt: 'Synthetic JSON request' }
function fixture({ chunks = [{ type: 'text', text: '{"decision":"escalate","reason":"need operator"}' }, { type: 'done', success: true }], body = {}, twice = false, pending = false } = {}) {
  const state = { factories: [], calls: [], aborted: 0 }
  const transport = new MochiClineText({
    credentials: () => ({ key: 'synthetic-only' }), timeoutMs: 30,
    loadSdk: async () => ({ createHandlerAsync: async config => {
      state.factories.push(config)
      return { abort: () => { state.aborted++ }, createMessage: async function* (system, messages, tools) {
        assert.deepEqual(tools, []); assert.equal(messages.length, 1); assert.equal(messages[0].role, 'user')
        assert.equal(config.modelCatalog.loadLatestOnInit, false)
        const init = { method: 'POST', body: JSON.stringify({ model: config.modelId, messages, ...body }) }
        await config.fetch('https://synthetic.invalid/generate', init)
        if (twice) await config.fetch('https://synthetic.invalid/generate', init)
        yield* chunks
      } }
    } }),
    fetchImpl: async (url, init) => {
      state.calls.push({ url, init })
      if (pending) return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
      return new Response('{}')
    },
  })
  return { state, transport }
}
check('text-only request uses the selected account/model without tool definitions', async () => {
  const { state, transport } = fixture(); assert.equal((await transport.availability()).available, true)
  assert.equal(state.calls.length, 0); assert.match((await transport.generate(input)).text, /escalate/)
  assert.equal(state.calls.length, 1); assert.equal(state.factories[0].providerId, 'cline'); assert.equal(state.aborted, 1)
})
check('another account is routed only through its selected Cline SDK handler', async () => {
  const f = fixture(); await f.transport.generate({ ...input, provider: 'openrouter' }); assert.equal(f.state.factories[0].providerId, 'openrouter')
})
check('SDK tools and functions are rejected before network', async () => {
  for (const body of [{ tools: [{ type: 'function' }] }, { functions: [] }, { tool_choice: 'auto' }]) {
    const f = fixture({ body }); await assert.rejects(f.transport.generate(input)); assert.equal(f.state.calls.length, 0)
  }
})
check('SDK cannot retry a request or start a tool roundtrip', async () => {
  const f = fixture({ twice: true }); await assert.rejects(f.transport.generate(input)); assert.equal(f.state.calls.length, 1)
})
check('non-text, incomplete, unconfirmed and oversized outputs cannot become success', async () => {
  for (const chunks of [[{ type: 'tool_calls' }], [{ type: 'done', success: false }], [{ type: 'done', success: true, incompleteReason: 'max_tokens' }], [{ type: 'text', text: 'partial' }], [{ type: 'text', text: 'x'.repeat(8001) }]]) {
    const f = fixture({ chunks }); await assert.rejects(f.transport.generate(input)); assert.equal(f.state.aborted, 1)
  }
})
check('timeout aborts the underlying fetch', async () => {
  const f = fixture({ pending: true }); await assert.rejects(f.transport.generate(input), /timed out/); assert.equal(f.state.calls[0].init.signal.aborted, true)
})
check('unsupported account and missing credentials cannot use implicit SDK fallbacks', async () => {
  const f = fixture(); await assert.rejects(f.transport.generate({ ...input, provider: 'opencode' })); assert.equal(f.state.factories.length, 0)
  const missing = new MochiClineText({ credentials: () => ({ key: '' }), loadSdk: async () => { throw new Error('must not load') } })
  assert.equal((await missing.availability()).available, false); await assert.rejects(missing.generate(input))
})
check('Cline adapter requires proven stateless capabilities and validates JSON output', async () => {
  let calls = 0
  const deps = { requireEnabled: async () => {}, invokeModel: async () => { calls++; return { text: '{"decision":"escalate","reason":"need operator"}' } } }
  const event = { id: 'event', teamId: 'team', slotId: 'worker-1', threadId: 'thread', taskId: '', sourceId: 'form', kind: 'question', context: {} }
  await new MochiClineModel(deps).decide(event, { enabled: true, model: 'test/model' }); assert.equal(calls, 0)
  const adapter = new MochiClineModel({ ...deps, capabilities: () => ({ toolFree: true, stateless: true, dedicatedContext: true }) })
  assert.equal((await adapter.decide(event, { enabled: true, model: 'test/model' })).decision, 'escalate'); assert.equal(calls, 1)
})
check('installed SDK serializes a real Cline request through synthetic fetch only', async () => {
  const original = globalThis.fetch; let calls = 0
  globalThis.fetch = async () => { throw new Error('Uninjected network forbidden') }
  try {
    let sdk
    try { sdk = await loadClineTextSdk() } catch { console.log('SKIP installed SDK: absent on this test host'); return }
    const catalog = await sdk.getModelsForProvider('cline', { filter: 'chat' })
    const model = Object.keys(catalog)[0]; assert(model)
    const payload = { decision: 'escalate', reason: 'synthetic check' }
    const transport = new MochiClineText({ loadSdk: async () => sdk, credentials: () => ({ key: 'synthetic-only' }), fetchImpl: async (_, init) => {
      calls++; const body = JSON.parse(init.body); assert(!body.tools?.length); assert(!body.functions); assert.equal(body.model, model)
      const chunk = JSON.stringify({ id: 'synthetic', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: JSON.stringify(payload) }, finish_reason: null }] })
      const end = JSON.stringify({ id: 'synthetic', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
      return new Response('data: ' + chunk + '\n\ndata: ' + end + '\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
    } })
    assert.deepEqual(JSON.parse((await transport.generate({ ...input, model })).text), payload); assert.equal(calls, 1)
  } finally { globalThis.fetch = original }
})
for (const [name, run] of checks) { await run(); console.log('PASS ' + name) }
console.log('Cline text: ' + checks.length + '/' + checks.length + ' passed. No real credentials or external requests.')
