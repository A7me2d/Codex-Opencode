import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { ClineBridge, clineCredentials } from '../server/cline-bridge.mjs'

const root = await mkdtemp(path.join(tmpdir(), 'openzero-cline-test-'))
const launches = []
const peers = []
const options = [
  { id: 'model', type: 'select', name: 'Model', currentValue: 'model-a', options: [{ value: 'model-a', name: 'A' }, { value: 'model-b', name: 'B' }] },
  { id: 'mode', type: 'select', name: 'Mode', currentValue: 'act', options: [{ value: 'act', name: 'Act' }, { value: 'plan', name: 'Plan' }] },
  { id: 'auto_approve', type: 'boolean', name: 'Auto approve', currentValue: false },
]
const cloneOptions = () => JSON.parse(JSON.stringify(options))
const launch = (executable, args, config) => {
  launches.push({ executable, args, config })
  assert.equal(config.shell, false); assert.equal(config.windowsHide, true); assert.equal(config.stdio[2], 'ignore')
  assert.deepEqual(args, ['--acp', '--auto-approve', 'false'])
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough()
  child.kill = () => child.emit('exit', 0)
  const peer = { child, messages: [], configOptions: cloneOptions(), prompt: null, remoteId: `remote-${peers.length}` }
  peers.push(peer)
  peer.send = message => { const line = JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n'; child.stdout.write(line.slice(0, 7)); child.stdout.write(line.slice(7)) }
  let buffer = ''
  child.stdin.on('data', data => {
    buffer += data.toString()
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); peer.messages.push(message)
      if (!message.method) continue
      let result = {}
      if (message.method === 'initialize') result = { protocolVersion: 1, agentCapabilities: { loadSession: true } }
      if (message.method === 'session/new') result = { sessionId: peer.remoteId, configOptions: peer.configOptions }
      if (message.method === 'session/load') {
        peer.remoteId = message.params.sessionId
        peer.send({ method: 'session/update', params: { sessionId: peer.remoteId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'REPLAY DUPLICATE' } } } })
        result = { configOptions: peer.configOptions }
      }
      if (message.method === 'session/set_config_option') { peer.configOptions.find(option => option.id === message.params.configId).currentValue = message.params.value; result = { configOptions: peer.configOptions } }
      if (message.method === 'session/prompt') { peer.prompt = message; continue }
      if (message.method === 'session/cancel') { if (peer.prompt) peer.send({ id: peer.prompt.id, result: { stopReason: 'cancelled' } }); continue }
      queueMicrotask(() => peer.send({ id: message.id, result }))
    }
  })
  return child
}
const credentials = provider => ({ key: `synthetic-secret-${provider}`, model: 'model-a' })
const bridge = new ClineBridge(root, { launch, resolveExecutable: () => 'synthetic-cline.exe', credentials })
try {
  const first = await bridge.create(root, 'cline')
  assert.equal(launches[0].config.env.CLINE_PROVIDER, 'cline')
  assert.equal(bridge.status().providers.find(item => item.id === 'anthropic').configured, true)
  assert.equal(JSON.stringify(first).includes('synthetic-secret'), false)
  await bridge.configure(first.id, 'model', 'model-b')
  await bridge.configure(first.id, 'auto_approve', true)
  await assert.rejects(bridge.configure(first.id, 'model', 'not-available'), /available/)
  let charged = 0
  await bridge.prompt(first.id, 'Implement this task', 'message-12345678', async () => { charged++ })
  await bridge.prompt(first.id, 'Implement this task', 'message-12345678', async () => { charged++ })
  assert.equal(charged, 1, 'duplicate user message is charged/sent only once')
  assert.equal(peers[0].messages.filter(message => message.method === 'session/prompt').length, 1)
  await assert.rejects(bridge.prompt(first.id, 'Another task', 'message-other-1234', async () => {}), /already working/)
  peers[0].send({ method: 'session/update', params: { sessionId: first.remoteId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Streaming reply' } } } })
  peers[0].send({ id: 900, method: 'session/request_permission', params: { sessionId: first.remoteId, toolCall: { title: 'Edit a file' }, options: [{ optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' }] } })
  const state = await bridge.get(first.id)
  assert.equal(state.messages[1].text, 'Streaming reply')
  assert.equal(state.permissions.length, 1)
  await assert.rejects(bridge.permission(first.id, '900', 'bad-option'), /no longer available/)
  await bridge.permission(first.id, '900', 'allow_once')
  assert.equal(peers[0].messages.find(message => message.id === 900).result.outcome.optionId, 'allow_once')
  peers[0].send({ id: peers[0].prompt.id, result: { stopReason: 'end_turn' } })
  await state.run
  assert.equal(state.active, false)
  const before = peers[0].messages.length
  await assert.rejects(bridge.prompt(first.id, 'Blocked by license', 'message-license-1234', async () => { throw new Error('license blocked') }), /license blocked/)
  assert.equal(peers[0].messages.length, before, 'license rejection happens before the prompt is sent')
  const second = await bridge.create(root, 'openrouter')
  assert.equal(launches[1].config.env.CLINE_PROVIDER, 'openrouter')
  await bridge.prompt(second.id, 'Second conversation', 'message-second-1234', async () => {})
  await bridge.cancel(second.id)
  const cancelling = await bridge.get(second.id)
  assert.doesNotThrow(() => JSON.stringify(bridge.snapshot(cancelling)), 'cancellation timers are not exposed in JSON')
  await (await bridge.get(second.id)).run
  assert.equal(peers[0].messages.filter(message => message.method === 'session/cancel').length, 0, 'cancel only targets the selected Cline conversation')
  await bridge.metadata(first.id, { title: 'Saved title', archived: true })
  await assert.rejects(bridge.prompt(first.id, 'Archived', 'message-archived-1234', async () => {}), /Restore/)
  await bridge.metadata(first.id, { archived: false })
  await bridge.stop()
  const saved = await readFile(bridge.file, 'utf8')
  assert.equal(saved.includes('synthetic-secret'), false, 'credentials are never stored in app metadata')
  const restored = new ClineBridge(root, { launch, resolveExecutable: () => 'synthetic-cline.exe', credentials })
  await restored.ready
  const resumed = await restored.get(first.id)
  assert.equal(resumed.title, 'Saved title'); assert.equal(resumed.preparing, false)
  await restored.connect(resumed)
  assert.equal(resumed.remoteId, first.remoteId)
  assert.equal(resumed.messages[1].text, 'Streaming reply', 'ACP history replay does not duplicate persisted text')
  assert.equal(resumed.configOptions.find(option => option.id === 'model').currentValue, 'model-b')
  assert.equal(resumed.configOptions.find(option => option.id === 'auto_approve').currentValue, true)
  await restored.reconnect(first.id)
  assert.equal(resumed.remoteId, first.remoteId, 'explicit reconnect keeps the conversation identifier and history')
  await restored.stop()
  const settings = path.join(root, 'synthetic-provider-settings.json')
  await writeFile(settings, JSON.stringify({ providers: { anthropic: { settings: { auth: { apiKey: 'synthetic-api-key' }, modelId: 'model-a' } } } }))
  assert.equal(clineCredentials('anthropic', settings).model, 'model-a')
  const missing = new ClineBridge(path.join(root, 'missing'), { launch, resolveExecutable: () => 'synthetic-cline.exe', credentials: () => ({ key: '' }) })
  const count = launches.length
  await assert.rejects(missing.create(root, 'anthropic'), /cline auth/)
  assert.equal(launches.length, count, 'missing authentication does not launch a task')
  const seeded = new ClineBridge(path.join(root, 'seeded'), { launch, resolveExecutable: () => 'synthetic-cline.exe', credentials })
  try {
    const seededSession = await seeded.create(root, 'cline', [{ id: 'model', value: 'model-b' }, { id: 'mode', value: 'plan' }])
    assert.equal(launches.at(-1).config.env.CLINE_MODEL, 'model-b', 'explicit role model is supplied before connection')
    assert.equal(seededSession.configOptions.find(option => option.id === 'model').currentValue, 'model-b')
    assert.equal(seededSession.configOptions.find(option => option.id === 'mode').currentValue, 'plan')
    await assert.rejects(seeded.create(root, 'cline', [{ id: 'model', value: 'removed-model' }]), /no longer available/)
    assert.equal(peers.at(-1).messages.some(message => message.method === 'session/prompt'), false, 'unavailable models cannot silently fall back and start a task')
    await seeded.prompt(seededSession.id, '[Role instructions]\nSynthetic task', 'display-message-01', async () => {}, 'Synthetic task')
    assert.equal((await seeded.get(seededSession.id)).messages[0].text, 'Synthetic task')
    assert.equal(peers.at(-2).prompt.params.prompt[0].text, '[Role instructions]\nSynthetic task')
  } finally { await seeded.stop() }
  console.log('Passed: Cline ACP streaming/fragmentation, provider isolation, model/permission settings, local session persistence/resume, replay deduplication, license gate and message deduplication, tool approval, scoped cancellation, rename/archive and secret-free app metadata. All processes, credentials and tasks were synthetic.')
} finally {
  await bridge.stop()
  if (path.dirname(path.resolve(root)) === path.resolve(tmpdir()) && path.basename(root).startsWith('openzero-cline-test-')) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

// Terminal records are verified against the production bridge with a fake ACP peer.
// A fake ACP child whose prompt response is driven by the test, so cleanup can be
// suspended exactly while the bridge is saving the finished turn.
const terminalHarness = () => {
  const peers = []
  const launch = (executable, args, config) => {
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.kill = () => child.emit('exit', 0)
    const peer = { child, prompt: null, remoteId: `remote-terminal-${peers.length}` }
    peers.push(peer)
    peer.send = message => child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
    let buffer = ''
    child.stdin.on('data', data => {
      buffer += data.toString()
      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const message = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1)
        if (!message.method) continue
        if (message.method === 'session/prompt') { peer.prompt = message; continue }
        let result = {}
        if (message.method === 'initialize') result = { protocolVersion: 1, agentCapabilities: { loadSession: true } }
        if (message.method === 'session/new') result = { sessionId: peer.remoteId, configOptions: [{ id: 'mode', type: 'select', currentValue: 'act', options: [{ value: 'act', name: 'Act' }, { value: 'plan', name: 'Plan' }] }] }
        if (message.method === 'session/set_config_option') result = { configOptions: [{ id: 'mode', type: 'select', currentValue: message.params.value, options: [{ value: 'act', name: 'Act' }, { value: 'plan', name: 'Plan' }] }] }
        queueMicrotask(() => peer.send({ id: message.id, result }))
      }
    })
    return child
  }
  return { launch, peers }
}
{
  const PatchedBridge = ClineBridge
  const root = await mkdtemp(path.join(tmpdir(), 'openzero-cline-terminal-'))
  const { launch, peers } = terminalHarness()
  const options = () => new PatchedBridge(root, { launch, resolveExecutable: () => 'synthetic-cline.exe', credentials: () => ({ key: 'synthetic-key', model: 'model-a' }) })
  const within = (promise, ms = 5000) => Promise.race([promise, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('timed out waiting for the bridge')), ms); timer.unref?.() })])
  let suspended, failed, releaseSave
  try {
    // End turn 1: the terminal record names this exact task, stays out of snapshots
    // and out of local persistence, and does not survive a restore.
    const bridge = options()
    const first = await bridge.create(root, 'cline')
    await bridge.prompt(first.id, 'First task', 'terminal-001', async () => {})
    const live = await bridge.get(first.id)
    assert.equal(live.active, true)
    const run = live.run
    peers[0].send({ id: peers[0].prompt.id, result: { stopReason: 'end_turn' } })
    await within(run)
    assert.equal(live.active, false)
    assert.equal(live.run, null)
    assert.deepEqual({ ...live.lastTurn }, { messageId: 'terminal-001', responseId: live.responseId, stopReason: 'end_turn', error: null })
    assert.equal('lastTurn' in bridge.snapshot(live), false, 'terminal records stay out of snapshots')
    assert.equal(JSON.stringify(bridge.snapshot(live)).includes('synthetic-key'), false)
    await bridge.save()
    const saved = JSON.parse(await readFile(bridge.file, 'utf8'))
    assert.equal(saved.sessions.some(session => 'lastTurn' in session), false, 'terminal records are never persisted')

    // Main-chat parity under the patch: settings, tool approval and rename still work.
    await bridge.configure(first.id, 'mode', 'plan')
    assert.equal((await bridge.get(first.id)).configOptions.find(option => option.id === 'mode').currentValue, 'plan')
    await bridge.prompt(first.id, 'Second task', 'terminal-005', async () => {})
    const secondRun = (await bridge.get(first.id)).run
    peers[0].send({ id: 900, method: 'session/request_permission', params: { sessionId: first.remoteId, toolCall: { title: 'Edit a file' }, options: [{ optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' }] } })
    assert.equal((await bridge.get(first.id)).permissions.length, 1)
    assert.equal((await bridge.get(first.id)).active, true)
    await bridge.permission(first.id, '900', 'allow_once')
    assert.equal((await bridge.get(first.id)).permissions.length, 0)
    peers[0].send({ id: peers[0].prompt.id, result: { stopReason: 'end_turn' } })
    await within(secondRun)
    assert.equal((await bridge.get(first.id)).lastTurn.messageId, 'terminal-005')
    await bridge.metadata(first.id, { title: 'Renamed' })
    assert.equal((await bridge.get(first.id)).title, 'Renamed')
    assert.equal('lastTurn' in bridge.snapshot(await bridge.get(first.id)), false)
    await bridge.stop()
    const restored = options()
    await restored.ready
    assert.equal((await restored.get(first.id)).lastTurn, null, 'a restart never resumes an old task')
    await restored.stop()

    // While the finished turn is still saving, the desk stays busy: a second prompt,
    // a config change and a reconnect are all refused, and the run settles once.
    suspended = options()
    const second = await suspended.create(root, 'cline')
    await suspended.prompt(second.id, 'Held task', 'terminal-002', async () => {})
    const held = await suspended.get(second.id)
    const heldRun = held.run
    let saveStarted
    const started = new Promise(resolve => { saveStarted = resolve })
    const gate = new Promise(resolve => { releaseSave = resolve })
    const realSave = PatchedBridge.prototype.save
    suspended.save = () => { saveStarted(); return gate.then(() => realSave.call(suspended)) }
    peers.at(-1).send({ id: peers.at(-1).prompt.id, result: { stopReason: 'end_turn' } })
    await within(started)
    assert.equal(held.active, true, 'the desk stays busy until the save settles')
    assert.equal(held.run !== null, true)
    const before = held.messages.length
    await assert.rejects(suspended.prompt(second.id, 'Second', 'terminal-003', async () => {}), /already working/)
    await assert.rejects(suspended.configure(second.id, 'mode', 'plan'), /Wait for Cline/)
    await assert.rejects(suspended.reconnect(second.id), /Wait for Cline/)
    assert.equal(held.messages.length, before, 'a refused second prompt never enters the transcript')
    releaseSave()
    await within(heldRun)
    assert.equal(held.active, false)
    assert.equal(held.run, null)
    assert.equal(held.lastTurn.messageId, 'terminal-002')
    assert.equal(held.lastTurn.stopReason, 'end_turn')
    assert.equal(held.messages.filter(message => message.id === 'terminal-003').length, 0)
    await suspended.stop()

    // A failed save still ends the turn: active and run are cleared and no successful
    // terminal record is written, so nobody reports a false success.
    failed = options()
    const third = await failed.create(root, 'cline')
    await failed.prompt(third.id, 'Unsaved task', 'terminal-004', async () => {})
    const unsaved = await failed.get(third.id)
    const unsavedRun = unsaved.run
    failed.save = () => Promise.reject(new Error('synthetic disk failure'))
    peers.at(-1).send({ id: peers.at(-1).prompt.id, result: { stopReason: 'end_turn' } })
    await within(unsavedRun)
    assert.equal(unsaved.active, false)
    assert.equal(unsaved.run, null)
    assert.equal(unsaved.lastTurn, null, 'a failed save never records success')
    assert.match(unsaved.error, /Could not save/)
    await failed.stop()
    console.log('Passed: terminal turn records link messageId/responseId/stopReason, stay local and secret-free, keep the desk busy through saving, and never fake success on a failed save. All ACP peers were synthetic.')
  } finally {
    releaseSave?.()
    await suspended?.stop().catch(() => {})
    await failed?.stop().catch(() => {})
    if (path.dirname(path.resolve(root)) === path.resolve(tmpdir()) && path.basename(root).startsWith('openzero-cline-terminal-')) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}
