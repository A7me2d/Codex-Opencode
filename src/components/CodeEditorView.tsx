import { useEffect, useRef } from 'react'
import type { FileTab, CodeEditorHandle } from './ProjectEditor'
import { basicSetup, EditorView } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { python } from '@codemirror/lang-python'
function language(path: string) {
  if (/\.[cm]?[jt]sx?$/.test(path)) return javascript({ typescript: /\.[cm]?tsx?$/.test(path), jsx: /\.[jt]sx$/.test(path) })
  if (/\.jsonc?$/.test(path)) return json()
  if (/\.html?$/.test(path)) return html()
  if (/\.(css|scss|sass|less)$/.test(path)) return css()
  if (/\.(py|pyi)$/.test(path)) return python()
  return []
}
const editorTheme = EditorView.theme({
  '&': { height: '100%', color: 'var(--color-ink)', backgroundColor: 'var(--color-card)', fontSize: '12px' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'Consolas, monospace', lineHeight: '1.7' },
  '.cm-content': { caretColor: 'var(--color-ink)', padding: '12px 0' },
  '.cm-gutters': { backgroundColor: 'var(--color-paper)', color: 'var(--color-ink-soft)', borderColor: 'var(--color-line)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--color-relay-tint)' },
  '.cm-cursor': { borderLeftColor: 'var(--color-ink)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-panels, .cm-tooltip': { backgroundColor: 'var(--color-card)', color: 'var(--color-ink)', borderColor: 'var(--color-line)' },
})
export default function CodeEditor({ file, onChange, register, onSave, onPosition }: {
  file: FileTab; onChange: (text: string) => void; register: (view: CodeEditorHandle | null) => void; onSave: () => void; onPosition: (line: number, column: number) => void
}) {
  const host = useRef<HTMLDivElement>(null), view = useRef<EditorView | null>(null)
  const callbacks = useRef({ onChange, register, onSave, onPosition })
  callbacks.current = { onChange, register, onSave, onPosition }
  useEffect(() => {
    const editor = new EditorView({ parent: host.current!, state: EditorState.create({ doc: file.content, extensions: [basicSetup, language(file.path), editorTheme,
      EditorView.contentAttributes.of({ 'aria-label': `Code editor: ${file.path}`, spellcheck: 'false' }),
      keymap.of([{ key: 'Mod-s', run: () => { callbacks.current.onSave(); return true } }, indentWithTab]),
      EditorView.updateListener.of(update => {
        if (update.docChanged) callbacks.current.onChange(update.state.doc.toString())
        if (update.docChanged || update.selectionSet) {
          const pos = update.state.selection.main.head, line = update.state.doc.lineAt(pos)
          callbacks.current.onPosition(line.number, pos - line.from + 1)
        }
      }),
    ] }) })
    view.current = editor; callbacks.current.register({
      focus: () => editor.focus(),
      measure: () => editor.requestMeasure(),
      position: () => { const pos=editor.state.selection.main.head, line=editor.state.doc.lineAt(pos); return { line: line.number, column: pos-line.from+1 } },
      gotoLine: (n, column = 1, length = 0) => { const line=editor.state.doc.line(Math.max(1,Math.min(editor.state.doc.lines,n))); const anchor=Math.min(line.to,line.from+Math.max(0,column-1)); editor.dispatch({selection:{anchor,head:Math.min(line.to,anchor+Math.max(0,length))},effects:EditorView.scrollIntoView(anchor,{y:'center'})}); editor.focus() },
      selection: () => { const range=editor.state.selection.main; const from=range.empty?0:range.from, to=range.empty?editor.state.doc.length:range.to; return { text:editor.state.sliceDoc(from,to),startLine:editor.state.doc.lineAt(from).number,endLine:editor.state.doc.lineAt(Math.max(from,to-1)).number } },
    })
    return () => { callbacks.current.register(null); editor.destroy(); view.current = null }
  }, [file.path])
  useEffect(() => {
    const editor = view.current
    if (editor && editor.state.doc.toString() !== file.content) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: file.content } })
  }, [file.content])
  return <div ref={host} dir="ltr" className="h-full min-h-0" />
}

