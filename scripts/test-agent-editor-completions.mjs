import assert from 'node:assert/strict'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import ts from 'typescript'
import { EditorState } from '@codemirror/state'
import { CompletionContext } from '@codemirror/autocomplete'

const target = path.resolve('scripts', `.editor-completion-test-${randomBytes(8).toString('hex')}.mjs`)
let requested
globalThis.__syntheticEditorApi = { tailwindCompletions: async input => { requested = input; return [{ label: 'flex', insertText: 'flex', textEdit: { newText: 'flex', range: { start: { line: 0, character: input.text.indexOf('fl') }, end: { line: 0, character: input.position.character } } } }] } }
try {
  const source = (await readFile('src/lib/agent-editor-extensions.ts', 'utf8')).replace("import { api } from './api'", 'const api = globalThis.__syntheticEditorApi')
  await writeFile(target, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText)
  const module = await import(pathToFileURL(target).href)
  assert.equal(module.editorLanguage('example.tsx'), 'typescriptreact')
  assert.equal(module.snippetTemplate('$1 ${2|flex,grid|} $0 $TM_FILENAME_BASE', 'Card.tsx'), '${1} ${2:flex} ${0} Card')
  const state = EditorState.create({ doc: 'tw-card' })
  const context = new CompletionContext(state, 7, true)
  const config = { snippets: [{ label: 'tw-card', body: '<div class="${1:flex}">$0</div>', language: 'html', extension: 'example.snippets', description: 'Card' }, { label: 'js-only', body: 'const x = 1', language: 'javascript', extension: 'example.js', description: '' }], tailwind: false, revision: 1 }
  const result = module.snippetSource(config, 'demo.html')(context)
  assert.deepEqual(result.options.map(item => item.label), ['tw-card'], 'snippet languages are filtered')
  const fakeView = { state, dispatch(transaction) { this.state = transaction.state } }
  result.options[0].apply(fakeView, result.options[0], 0, 7)
  assert.equal(fakeView.state.doc.toString(), '<div class="flex"></div>')
  assert.equal(fakeView.state.sliceDoc(fakeView.state.selection.main.from, fakeView.state.selection.main.to), 'flex', 'first snippet placeholder is selected')
  const doc = '<div class="hover:fl">'
  const position = doc.indexOf('fl') + 2
  const tailwind = await module.tailwindSource('synthetic-root', 'demo.html')(new CompletionContext(EditorState.create({ doc }), position, false))
  assert.equal(tailwind.from, doc.indexOf('fl'), 'variant prefix is retained using LSP text edit range')
  assert.equal(tailwind.options[0].apply, 'flex')
  assert.equal(requested.text, doc, 'completions use the unsaved document')
  console.log('Passed: editor language mapping, snippet choices/variables/placeholders, language filtering, actual CodeMirror snippet application, Tailwind variant replacement and unsaved completion requests. No UI or real project was opened.')
} finally {
  delete globalThis.__syntheticEditorApi
  if (path.dirname(target) === path.resolve('scripts') && path.basename(target).startsWith('.editor-completion-test-')) await unlink(target).catch(() => {})
}
