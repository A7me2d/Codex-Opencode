import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const require = createRequire(import.meta.url)
const files = Array.from({ length: 1961 }, (_, index) => ({
  file: `generated/file-${index}.css`, status: 'modified', additions: 1000, deletions: 0,
  patch: '@@ -0,0 +1,1000 @@\n' + '+large generated content\n'.repeat(1000),
}))
let parsedPatches = 0
const context = vm.createContext({ exports: {}, require(name) {
  if (name.endsWith('/usePolling')) return { usePolling: () => ({ data: files, status: 'ready', error: null }) }
  if (name.endsWith('/api')) return { api: {} }
  if (name.endsWith('/diff')) return { readDiffLines: () => { parsedPatches++; return [] } }
  if (name.endsWith('/cx')) return { cx: (...values) => values.filter(Boolean).join(' ') }
  return require(name)
} })
const source = readFileSync(new URL('../src/features/opencode/ChangedFiles.tsx', import.meta.url), 'utf8')
vm.runInContext(ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
} }).outputText, context)
const html = renderToStaticMarkup(React.createElement(context.exports.ChangedFiles, { sessionId: 'test', active: false }))
assert.equal((html.match(/<details\b/g) ?? []).length, 30)
assert.equal(parsedPatches, 0, 'closed files must not parse or mount patch lines')
assert.ok(html.includes('1931'))
assert.ok(html.length < 100_000, 'thousands of generated files must not produce an oversized page')
console.log('Passed: 1961 files render only 30 summaries, with no closed patches parsed and remaining files accessible through Show more.')
