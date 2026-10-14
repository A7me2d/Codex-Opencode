import { snippet, type CompletionContext, type CompletionSource } from '@codemirror/autocomplete'
import { api } from './api'
import type { EditorExtensionConfig } from './types'

export function editorLanguage(file: string) {
  const extension = file.split('.').pop()?.toLowerCase()
  return ({ ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact', mjs: 'javascript', cjs: 'javascript', html: 'html', htm: 'html', css: 'css', scss: 'scss', json: 'json', py: 'python', vue: 'vue', svelte: 'svelte', astro: 'astro', php: 'php', md: 'markdown' } as Record<string, string>)[extension || ''] || 'plaintext'
}
export function snippetTemplate(body: string, file: string) {
  const filename = file.split(/[\\/]/).pop() || ''
  const variables: Record<string, string> = { TM_FILENAME: filename, TM_FILENAME_BASE: filename.replace(/\.[^.]+$/, ''), TM_FILEPATH: file }
  return body.replace(/\$\{(\d+)\|([^}]+)\|\}/g, (_match, index, choices) => '${' + index + ':' + choices.split(',')[0] + '}')
    .replace(/\$\{([A-Z_]+)(?::([^}]*))?\}|\$([A-Z_]+)/g, (_match, name, fallback, simple) => variables[name || simple] ?? fallback ?? '')
    .replace(/(?<!\\)\$(\d+)/g, (_match, index) => '${' + index + '}')
}
export function snippetSource(config: EditorExtensionConfig, file: string): CompletionSource {
  const language = editorLanguage(file)
  const entries = config.snippets.filter(item => !item.language || item.language.split(',').map(value => value.trim()).includes(language))
  const options = entries.map(item => ({ label: item.label, type: 'text', detail: item.extension,
    info: item.description, apply: snippet(snippetTemplate(item.body, file)) }))
  return context => {
    const word = context.matchBefore(/[\w!.-]+/)
    if (!word && !context.explicit) return null
    return { from: word?.from ?? context.pos, validFor: /^[\w!.-]*$/, options }
  }
}
export function tailwindSource(root: string, file: string): CompletionSource {
  return async (context: CompletionContext) => {
    const before = context.state.sliceDoc(Math.max(0, context.pos - 5000), context.pos)
    if (!/(?:class(?:Name|:list)?|ngClass)\]?\s*=\s*(?:\{\s*)?["'`][^"'`]*$/.test(before) && !context.explicit) return null
    const word = context.matchBefore(/[\w:/.[\]#!%-]+/)
    const line = context.state.doc.lineAt(context.pos)
    try {
      const result = await api.tailwindCompletions({ root, path: file, language: editorLanguage(file), text: context.state.doc.toString(), position: { line: line.number - 1, character: context.pos - line.from } })
      if (context.aborted || !result.length) return null
      const range = result[0].textEdit?.range
      const from = range && range.start.line === line.number - 1 ? line.from + range.start.character : word ? word.from + word.text.lastIndexOf(':') + 1 : context.pos
      const to = range && range.end.line === line.number - 1 ? line.from + range.end.character : context.pos
      if (from < line.from || from > context.pos || to < context.pos || to > line.to) return null
      return { from, to, options: result.map(item => {
        const text = item.textEdit?.newText || item.insertText || item.label
        return { label: item.label, detail: item.detail, type: 'property', apply: item.insertTextFormat === 2 ? snippet(snippetTemplate(text, file)) : text }
      }) }
    } catch { return null }
  }
}

let cached: Promise<EditorExtensionConfig> | null = null
let invalidating = false
export function loadEditorExtensions() {
  if (!cached) cached = api.editorExtensions().catch(error => { cached = null; throw error })
  return cached
}
export function invalidateEditorExtensions() {
  if (invalidating) return
  cached = null; invalidating = true
  queueMicrotask(() => { invalidating = false })
}
