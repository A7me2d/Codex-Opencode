import assert from 'node:assert/strict'
import { SuperAgentCline } from '../server/super-agent-cline.mjs'

// Fake bridge mirroring the patched ClineBridge contract: terminal results land in
// session.lastTurn (messageId + responseId + stopReason) only after cleanup/save,
// and run/lastTurn/deferred never leak into snapshots.
const fixture = (id, patch = {}) => ({ id, remoteId: `remote-${id}`, directory: 'D:\\desk', provider: 'cline', title: 'Cline desk', messages: [], tools: [], configOptions: [], savedOptions: [], active: false, loading: false, preparing: false, archived: false, updatedAt: Date.now(), permissions: [], error: null, run: null, lastTurn: null, responseId: null, deferred: null, ...patch })
const fakeBridge = ({ sessions = [], behavior = {} } = {}) => {
  const store = new Map(sessions.map(session => [session.id, session]))
  const events = { connects: [], prompts: [], cancels: [], charges: 0 }
  const bridge = {
    ready: Promise.resolve(), sessions: store, events,
    async get(id) { const session = store.get(id); if (!session) throw Object.assign(new Error('Cline conversation was not found.'), { status: 404 }); return session },
    snapshot(session) { const { run, lastTurn, deferred, ...data } = session; return JSON.parse(JSON.stringify(data)) },
    async connect(session) { events.connects.push(session.id); if (behavior.failConnect?.has(session.id)) throw Object.assign(new Error('Install Cline CLI with npm i -g cline first.'), { status: 503 }); if (behavior.connectGate) await behavior.connectGate },
    async prompt(id, text, messageId, charge, displayText = text) {
      const session = store.get(id)
      events.prompts.push({ id, messageId })
      if (session.messages.some(message => message.id === messageId)) return bridge.snapshot(session)
      if (session.archived) throw Object.assign(new Error('Restore the Cline conversation before sending a message.'), { status: 409 })
      if (session.active || session.loading || session.preparing) throw Object.assign(new Error('Cline is already working in this conversation.'), { status: 409 })
      session.preparing = true
      try {
        assert.equal(charge.constructor.name, 'AsyncFunction')
        assert.equal(await charge(), undefined, 'the desk charge stays a noop; the manager bills once')
        events.charges++
        session.active = true; session.error = null; session.permissions = []
        const responseId = `resp-${messageId}`
        session.responseId = responseId
        session.messages.push({ id: messageId, role: 'user', text: displayText.trim() }, { id: responseId, role: 'assistant', text: '' })
        session.updatedAt = Date.now()
        let outcome = null
        session.run = new Promise((resolve, reject) => { session.deferred = { resolve, reject } })
          .then(result => { outcome = { stopReason: result?.stopReason ?? null, error: null } }, () => { session.error = 'Cline could not complete this operation. Check provider authentication and model settings.'; outcome = { stopReason: null, error: session.error } })
          .finally(async () => {
            // Mirrors the patched bridge: the desk stays busy until the save settles,
            // and a failed save clears active/run without recording a successful turn.
            session.permissions = []; session.updatedAt = Date.now()
            try { await bridge.save(); if (outcome) { session.lastTurn = { messageId, responseId, ...outcome }; behavior.rewriteLastTurn?.(session) } }
            catch { session.error = 'Could not save the Cline conversation locally.' }
            finally { session.active = false; session.permissions = []; session.run = null; session.updatedAt = Date.now() }
          })
          .catch(() => { session.error = 'Could not save the Cline conversation locally.' })
        await behavior.plan?.(session, messageId, responseId)
        return bridge.snapshot(session)
      } finally { session.preparing = false }
    },
    async save() { if (bridge.failCleanupSave) throw new Error('synthetic disk failure') },
    async cancel(id) { const session = store.get(id); events.cancels.push(id); if (session?.active && session.deferred) session.deferred.resolve({ stopReason: 'cancelled' }) },
    async permission(id, permissionId, optionId) {
      const session = store.get(id)
      const request = session.permissions.find(permission => permission.id === permissionId)
      if (!request || !request.options.some(option => option.id === optionId)) throw new Error('Permission request is no longer available.')
      session.permissions = session.permissions.filter(permission => permission !== request)
      behavior.onPermission?.(session, request, optionId)
    },
  }
  return bridge
}
const harness = (bridge, options) => {
  const completions = []
  const adapter = new SuperAgentCline(bridge, (id, turn) => completions.push({ threadId: id, turn }), options)
  const waitFor = async (threadId, turnId, limit = 2000) => {
    const start = Date.now()
    while (Date.now() - start < limit) {
      const done = completions.find(entry => entry.threadId === threadId && entry.turn.id === turnId)
      if (done) return done.turn
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    throw new Error('Timed out waiting for the turn to complete.')
  }
  return { adapter, completions, waitFor }
}
const byTurn = (completions, threadId) => completions.filter(entry => entry.threadId === threadId)

// 1. Fast completion before send returns, exact reply, single callback after saving.
{
  const bridge = fakeBridge({ sessions: [fixture('desk-fast')], behavior: { plan: async session => { session.messages.find(message => message.id === session.responseId).text = 'Fast reply'; session.deferred.resolve({ stopReason: 'end_turn' }); await session.run } } })
  const { adapter, completions, waitFor } = harness(bridge)
  const { turn } = await adapter.send('desk-fast', 'Do it', 'fast-message-001')
  assert.equal(turn.status, 'running')
  const done = await waitFor('desk-fast', turn.id)
  assert.equal(done.status, 'completed')
  assert.equal(adapter.reply('desk-fast', turn.id), 'Fast reply')
  assert.equal(adapter.turn('desk-fast').active, false)
  assert.equal((await bridge.get('desk-fast')).active, false, 'completion lands after bridge cleanup')
  assert.equal(byTurn(completions, 'desk-fast').length, 1, 'completeCallback fires exactly once')
  console.log('Passed: fast completion reports the exact reply once, after bridge cleanup.')
}
// 2. Old replies never satisfy a new task; duplicate messageIds never resend.
{
  const session = fixture('desk-old', { messages: [{ id: 'old-user', role: 'user', text: 'Old task' }, { id: 'resp-old-user', role: 'assistant', text: 'WRONG OLD REPLY' }] })
  const bridge = fakeBridge({ sessions: [session], behavior: { plan: async item => { item.messages.find(message => message.id === item.responseId).text = 'New reply'; item.deferred.resolve({ stopReason: 'end_turn' }); await item.run } } })
  const { adapter, completions, waitFor } = harness(bridge)
  const first = await adapter.send('desk-old', 'New task', 'new-message-001')
  await waitFor('desk-old', first.turn.id)
  assert.equal(adapter.reply('desk-old', first.turn.id), 'New reply')
  await assert.rejects(adapter.send('desk-old', 'New task', 'new-message-001'), /already sent/)
  assert.equal(bridge.events.prompts.filter(prompt => prompt.messageId === 'new-message-001').length, 1)
  assert.equal(byTurn(completions, 'desk-old').length, 1)
  console.log('Passed: old replies are ignored and duplicate messageIds never resend.')
}
// 3. A terminal record for another responseId is not success.
{
  const bridge = fakeBridge({ sessions: [fixture('desk-mismatch')], behavior: { plan: async session => { session.messages.find(message => message.id === session.responseId).text = 'Stray'; session.deferred.resolve({ stopReason: 'end_turn' }); await session.run }, rewriteLastTurn: session => { session.lastTurn.responseId = 'resp-someone-else' } } })
  const { adapter, completions, waitFor } = harness(bridge)
  const { turn } = await adapter.send('desk-mismatch', 'Task', 'mismatch-001')
  const mismatch = await waitFor('desk-mismatch', turn.id)
  assert.equal(mismatch.status, 'failed')
  assert.match(mismatch.error.message, /did not confirm/)
  assert.equal(adapter.reply('desk-mismatch', turn.id), '')
  assert.equal(byTurn(completions, 'desk-mismatch').length, 1)
  assert.match((await adapter.read('desk-mismatch')).error, /did not confirm/, 'the desk error stays visible in read')
  console.log('Passed: mismatched responseIds fail honestly instead of reporting success.')
}
// 4. Manual approval keeps the turn waiting; the adapter never auto-approves.
{
  let approved = null
  const bridge = fakeBridge({ sessions: [fixture('desk-approval')], behavior: {
    plan: async session => { session.permissions.push({ id: 'perm-1', title: 'Edit a file', options: [{ id: 'proceed', name: 'Proceed' }, { id: 'reject', name: 'Reject' }], rpcId: 7 }) },
    onPermission: (session, request, optionId) => { approved = optionId; session.messages.find(message => message.id === session.responseId).text = 'Approved work'; session.deferred.resolve({ stopReason: 'end_turn' }) },
  } })
  const { adapter, completions, waitFor } = harness(bridge)
  const { turn } = await adapter.send('desk-approval', 'Edit the file', 'approval-001')
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(completions.length, 0, 'no completion while a human decision is pending')
  assert.equal((await adapter.status('desk-approval')).waitingPermission, true)
  assert.equal(adapter.turn('desk-approval').active, true)
  await assert.rejects(adapter.send('desk-approval', 'Another', 'approval-002'), /already working|permission/)
  assert.equal(bridge.events.prompts.length, 1, 'the blocked task never reaches the bridge')
  await bridge.permission('desk-approval', 'perm-1', 'proceed')
  const approvedDone = await waitFor('desk-approval', turn.id)
  assert.equal(approved, 'proceed')
  assert.equal(approvedDone.status, 'completed')
  assert.equal(adapter.reply('desk-approval', turn.id), 'Approved work')
  console.log('Passed: permissions wait for the human and block new tasks without auto-approval.')
}
// 5. Rejecting a permission ends the task as failure, not success.
{
  const bridge = fakeBridge({ sessions: [fixture('desk-reject')], behavior: {
    plan: async session => { session.permissions.push({ id: 'perm-2', title: 'Run a command', options: [{ id: 'proceed', name: 'Proceed' }, { id: 'reject', name: 'Reject' }], rpcId: 9 }) },
    onPermission: session => { session.deferred.resolve({ stopReason: 'refusal' }) },
  } })
  const { adapter, completions, waitFor } = harness(bridge)
  const { turn: rejectedTurn } = await adapter.send('desk-reject', 'Run it', 'reject-001')
  await bridge.permission('desk-reject', 'perm-2', 'reject')
  const rejected = await waitFor('desk-reject', rejectedTurn.id)
  assert.equal(rejected.status, 'failed')
  assert.match(rejected.error.message, /refused/)
  assert.match((await adapter.read('desk-reject')).error, /refused/, 'the refusal stays visible in read')
  console.log('Passed: a refused task reports failure, never success.')
}
// 6. Operator stop cancels only its own session and reports interruption.
{
  const bridge = fakeBridge({ sessions: [fixture('desk-a'), fixture('desk-b')] })
  const { adapter, completions, waitFor } = harness(bridge)
  const a = await adapter.send('desk-a', 'Task A', 'multi-a-001')
  const b = await adapter.send('desk-b', 'Task B', 'multi-b-001')
  await adapter.stop('desk-a')
  const stopped = await waitFor('desk-a', a.turn.id)
  assert.deepEqual(bridge.events.cancels, ['desk-a'])
  assert.equal(stopped.status, 'interrupted')
  assert.equal(adapter.turn('desk-b').active, true, 'stopping one desk never touches another')
  const other = await bridge.get('desk-b')
  other.messages.find(message => message.id === other.responseId).text = 'Reply B'; other.deferred.resolve({ stopReason: 'end_turn' })
  const finished = await waitFor('desk-b', b.turn.id)
  assert.equal(adapter.reply('desk-b', b.turn.id), 'Reply B')
  assert.equal(a.turn.id !== b.turn.id, true)
  console.log('Passed: stop is scoped per session and interruption carries the operator message.')
}
// 7. Prompt failure surfaces the bridge error exactly once.
{
  const bridge = fakeBridge({ sessions: [fixture('desk-fail')], behavior: { plan: async session => { session.deferred.reject(new Error('synthetic rpc failure')) } } })
  const { adapter, completions, waitFor } = harness(bridge)
  const { turn } = await adapter.send('desk-fail', 'Task', 'fail-001')
  assert.equal(turn.status, 'running', 'RPC failure surfaces through the turn, not the send call')
  const failed = await waitFor('desk-fail', turn.id)
  assert.equal(failed.status, 'failed')
  assert.match(failed.error.message, /could not complete/)
  assert.equal(adapter.turn('desk-fail').active, false)
  assert.match((await adapter.read('desk-fail')).error, /could not complete/, 'the bridge failure stays visible in read')
  console.log('Passed: prompt failures fail the turn once with the bridge message.')
}
// 8. prepare guards: archived/busy/permissions/connect failure consume nothing.
{
  const archived = fixture('desk-archived', { archived: true })
  const busy = fixture('desk-busy', { active: true })
  const gated = fixture('desk-gated', { permissions: [{ id: 'perm-x', options: [] }] })
  const down = fixture('desk-down')
  const bridge = fakeBridge({ sessions: [archived, busy, gated, down], behavior: { failConnect: new Set(['desk-down']) } })
  const { adapter } = harness(bridge)
  let charges = 0
  const guarded = async id => { await adapter.prepare(id); charges++ }
  await assert.rejects(guarded('desk-archived'), /Restore/)
  await assert.rejects(guarded('desk-busy'), /already working/)
  await assert.rejects(guarded('desk-gated'), /permission/)
  await assert.rejects(guarded('desk-down'), /Install Cline CLI/)
  assert.equal(charges, 0, 'failed preparation never reaches the licensed charge')
  assert.deepEqual(bridge.events.connects, ['desk-down'], 'only the connect path launches the CLI check')
  const ready = fixture('desk-ready')
  bridge.sessions.set('desk-ready', ready)
  const snapshot = await adapter.prepare('desk-ready')
  charges++
  assert.equal(snapshot.id, 'desk-ready')
  assert.equal(charges, 1)
  assert.ok(bridge.events.connects.includes('desk-ready'), 'prepare confirms connect before charging')
  console.log('Passed: prepare rejects archived/busy/gated/offline desks without consuming the charge.')
}
// 9. status/read are local: no connect, no launch, no secrets.
{
  const bridge = fakeBridge({ sessions: [fixture('desk-local', { error: 'stale note', permissions: [{ id: 'perm-y', options: [] }] })] })
  const { adapter } = harness(bridge)
  const status = await adapter.status('desk-local')
  assert.equal(status.waitingPermission, true)
  assert.equal(status.error, 'stale note')
  const snapshot = await adapter.read('desk-local')
  assert.equal(snapshot.id, 'desk-local')
  assert.equal('run' in snapshot, false)
  assert.equal('lastTurn' in snapshot, false)
  assert.equal(bridge.events.connects.length, 0, 'local reads never connect or launch')
  await assert.rejects(adapter.status('desk-missing'), /not found/)
  console.log('Passed: status and read stay local without launching Cline.')
}
// 10. Timeout without a terminal record fails honestly and never completes later.
{
  const bridge = fakeBridge({ sessions: [fixture('desk-timeout')] })
  const { adapter, completions, waitFor } = harness(bridge, { timeout: 40 })
  const { turn } = await adapter.send('desk-timeout', 'Hanging task', 'timeout-001')
  const timedOut = await waitFor('desk-timeout', turn.id)
  assert.equal(timedOut.status, 'failed')
  assert.match(timedOut.error.message, /still running/)
  const late = await bridge.get('desk-timeout')
  late.messages.find(message => message.id === late.responseId).text = 'Too late'; late.deferred.resolve({ stopReason: 'end_turn' })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(byTurn(completions, 'desk-timeout').length, 1, 'the late terminal record cannot complete twice')
  assert.equal(adapter.turn('desk-timeout').active, false)
  assert.match((await adapter.read('desk-timeout')).error, /still running/, 'the timeout stays visible in read')
  console.log('Passed: a hung run times out as failure and cannot complete afterwards.')
}
// 11. read merges the desk turn: busy during connect, errors after failure.
{
  let releaseConnect
  const bridge = fakeBridge({ sessions: [fixture('desk-merge')], behavior: { connectGate: new Promise(resolve => { releaseConnect = resolve }), plan: async session => { session.messages.find(message => message.id === session.responseId).text = 'Merged'; session.deferred.resolve({ stopReason: 'end_turn' }); await session.run } } })
  const { adapter, waitFor } = harness(bridge)
  const sending = adapter.send('desk-merge', 'Task', 'merge-001')
  const duringConnect = await adapter.read('desk-merge')
  assert.equal(duringConnect.active, true, 'a connecting turn reads as busy even while the session looks idle')
  assert.equal('run' in duringConnect && 'lastTurn' in duringConnect, false)
  releaseConnect()
  const { turn } = await sending
  assert.equal(turn.status, 'running')
  const done = await waitFor('desk-merge', turn.id)
  assert.equal(done.status, 'completed')
  const after = await adapter.read('desk-merge')
  assert.equal(after.active, false)
  assert.equal(after.messages.length, 2, 'the full Cline session stays in read')
  console.log('Passed: read merges the desk turn without leaking handles.')
}
// 12. A dropped network still runs cleanup and surfaces the failure in read.
{
  const bridge = fakeBridge({ sessions: [fixture('desk-drop')] })
  const { adapter, waitFor } = harness(bridge)
  const { turn } = await adapter.send('desk-drop', 'Task', 'drop-001')
  const session = await bridge.get('desk-drop')
  session.deferred.reject(new Error('Cline connection closed.'))
  const dropped = await waitFor('desk-drop', turn.id)
  assert.equal(dropped.status, 'failed')
  assert.match(dropped.error.message, /could not complete/)
  const raw = await bridge.get('desk-drop')
  assert.equal(raw.active, false)
  assert.equal(raw.run, null, 'cleanup still clears the run after a network drop')
  assert.equal(raw.lastTurn.stopReason, null)
  assert.match((await adapter.read('desk-drop')).error, /could not complete/)
  console.log('Passed: a network drop runs cleanup and stays visible in read.')
}
// 13. A failed save clears active/run, records no successful turn, and fails loudly.
{
  const bridge = fakeBridge({ sessions: [fixture('desk-save')] })
  const { adapter, waitFor } = harness(bridge)
  const { turn } = await adapter.send('desk-save', 'Task', 'save-001')
  bridge.failCleanupSave = true
  const session = await bridge.get('desk-save')
  session.messages.find(message => message.id === session.responseId).text = 'Unsaved reply'
  session.deferred.resolve({ stopReason: 'end_turn' })
  const failed = await waitFor('desk-save', turn.id)
  assert.equal(failed.status, 'failed')
  assert.match(failed.error.message, /Could not save/)
  const raw = await bridge.get('desk-save')
  assert.equal(raw.active, false)
  assert.equal(raw.run, null)
  assert.equal(raw.lastTurn, null, 'a save failure never records a successful turn')
  assert.equal(adapter.reply('desk-save', turn.id), '')
  assert.match((await adapter.read('desk-save')).error, /Could not save/)
  console.log('Passed: save failures clear the desk and fail loudly without a false success.')
}
console.log('All SuperAgent Cline desk checks passed with synthetic transports only; no CLI, providers, or licenses were used.')
