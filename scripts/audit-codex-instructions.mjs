// Read-only evidence from Open Zero's outbound audit and Codex's saved rollout.
// Never starts/resumes a thread, sends a turn, or prints conversation contents.
import { createReadStream } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { codexPlannerInstructions, codexExecutorInstructions, codexToCodexExecutorInstructions } from '../server/workflow.mjs'

const root = path.resolve(import.meta.dirname, '..')
const stateRoot = process.env.RELAY_STATE_DIR ? path.resolve(process.env.RELAY_STATE_DIR) : path.join(root, '.relay-state')
const codexRoot = process.env.CODEX_HOME || path.join(homedir(), '.codex')
const state = JSON.parse(await readFile(path.join(stateRoot, 'codex.json'), 'utf8'))
const requestedId = process.argv[2]
if (requestedId && !/^[A-Za-z0-9_-]{6,200}$/.test(requestedId)) throw new Error('Invalid thread ID.')
const threads = Object.values(state.threads ?? {}).filter(thread => !requestedId || thread.id === requestedId)
if (requestedId && !threads.length) throw new Error('Thread is not registered in this Open Zero state directory.')
const lastRequests = new Map()
const digest = text => createHash('sha256').update(text).digest('hex')
const legacy = 'Do not write or edit implementation code in this thread.'
const known = { codexPlannerInstructions, codexExecutorInstructions, codexToCodexExecutorInstructions }

async function records(file, visit) {
  const stream = createReadStream(file, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      let record
      try { record = JSON.parse(line) } catch { continue } // incomplete live tail
      visit(record)
    }
  } finally { lines.close(); stream.destroy() }
}

try {
  await records(path.join(stateRoot, 'codex-instructions.jsonl'), record => {
    if (record.threadId) lastRequests.set(record.threadId, record)
  })
} catch (error) { if (error.code !== 'ENOENT') throw error }

async function rolloutFiles(directory) {
  let entries
  try { entries = await readdir(directory, { withFileTypes: true }) }
  catch (error) { if (error.code === 'ENOENT') return []; throw error }
  const files = []
  for (const entry of entries) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await rolloutFiles(file))
    else if (entry.name.endsWith('.jsonl')) files.push(file)
  }
  return files
}

const files = await rolloutFiles(path.join(codexRoot, 'sessions'))
const reports = []
for (const thread of threads) {
  const request = lastRequests.get(thread.id)
  const developerMessages = []
  let rolloutCount = 0
  for (const file of files.filter(file => path.basename(file).includes(thread.id))) {
    rolloutCount++
    await records(file, record => {
      const payload = record.payload
      if (record.type !== 'response_item' || payload?.role !== 'developer') return
      const text = (payload.content ?? []).map(part => part.text ?? '').join('\n')
      developerMessages.push({
        at: record.timestamp, sha256: digest(text),
        containsLegacyRestriction: text.includes(legacy),
        containsLastRequestedInstructions: request ? text.includes(request.developerInstructions) : null,
        knownRoleSources: Object.entries(known).filter(([, instructions]) => text.includes(instructions)).map(([source]) => source),
      })
    })
  }
  developerMessages.sort((a, b) => String(a.at).localeCompare(String(b.at)))
  reports.push({
    threadId: thread.id, workflow: thread.workflow ?? null, workflowRole: thread.workflowRole ?? null,
    lastRequest: request ? {
      method: request.method, requestedAt: request.requestedAt, completedAt: request.completedAt,
      status: request.status, sha256: digest(request.developerInstructions),
      permissionsOverridden: request.permissionsOverridden,
    } : null,
    rolloutCount, persistedDeveloperMessages: developerMessages.length,
    legacyMessages: developerMessages.filter(message => message.containsLegacyRestriction),
    requestedInstructionsFoundInRollout: request ? developerMessages.some(message => message.containsLastRequestedInstructions) : null,
    effectiveModelContext: 'unverified',
  })
}
console.log(JSON.stringify({
  note: 'Outbound RPC acceptance and historical rollout evidence do not prove the current model context. No turns were sent or sessions changed.',
  threads: reports,
}, null, 2))
