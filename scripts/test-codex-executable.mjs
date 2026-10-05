import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8')
const bin = path.join('local', 'OpenAI', 'Codex', 'bin')
const files = new Map([
  [path.join(bin, 'old', 'codex.exe'), 1],
  [path.join(bin, 'current', 'codex.exe'), 2],
  [path.join(bin, 'current', 'codex-code-mode-host.exe'), 2],
])
const context = vm.createContext({
  path,
  process: { env: { LOCALAPPDATA: 'local' } },
  readdirSync: () => ['old', 'current', 'rg-only'].map((name) => ({ name, isDirectory: () => true })),
  statSync: (file) => {
    if (!files.has(file)) throw new Error('missing')
    return { mtimeMs: files.get(file), isFile: () => true }
  },
})
vm.runInContext(source.slice(source.indexOf('function codexExecutableCandidates('), source.indexOf('const relayCodexInstructions')), context)
assert.equal(context.resolveCodexExecutable(), path.join(bin, 'current', 'codex.exe'))
context.process.env.CODEX_EXE = path.join(bin, 'old', 'codex.exe')
assert.equal(context.codexExecutableCandidates()[0], context.process.env.CODEX_EXE)
console.log('Passed: complete Codex installation beats an older incomplete copy; explicit override retains priority.')
