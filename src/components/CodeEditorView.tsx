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
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
function language(path: string) {
  if (/\.[cm]?[jt]sx?$/.test(path)) return javascript({ typescript: /\.[cm]?tsx?$/.test(path), jsx: /\.[jt]sx$/.test(path) })
  if (/\.jsonc?$/.test(path)) return json()
  if (/\.html?$/.test(path)) return html()
  if (/\.(css|scss|sass|less)$/.test(path)) return css()
  if (/\.(py|pyi)$/.test(path)) return python()
  return []
}
const editorTheme = EditorView.theme({
  '&': { height: '100%', color: '#d4d4d4', backgroundColor: '#1e1e1e', fontSize: '13px', colorScheme: 'dark' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'Cascadia Code, Consolas, monospace', lineHeight: '1.6' },
  '.cm-content': { caretColor: '#aeafad', padding: '12px 0' },
  '.cm-gutters': { backgroundColor: '#1e1e1e', color: '#858585', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '3em', padding: '0 12px 0 8px' },
  '.cm-activeLine': { backgroundColor: '#282828' },
  '.cm-activeLineGutter': { backgroundColor: '#282828', color: '#c6c6c6' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#aeafad' },
  '.cm-selectionBackground': { backgroundColor: '#3a3d41' },
  '&.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: '#264f78' },
  '.cm-selectionMatch': { backgroundColor: '#add6ff26' },
  '.cm-matchingBracket': { backgroundColor: '#3a3d41', outline: '1px solid #888888' },
  '.cm-searchMatch': { backgroundColor: '#515c6a', outline: '1px solid #a0a0a0' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#613214', outline: '1px solid #f0a060' },
  '&.cm-focused': { outline: 'none' },
  '.cm-panels, .cm-tooltip': { backgroundColor: '#252526', color: '#cccccc', borderColor: '#454545' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: '#04395e', color: '#d4d4d4' },
  '.cm-textfield': { backgroundColor: '#3c3c3c', color: '#cccccc', border: '1px solid #616161' },
  '.cm-button': { backgroundImage: 'none', backgroundColor: '#3c3c3c', color: '#cccccc', border: '1px solid #616161' },
}, { dark: true })
// Dark+ palette mapped to the syntax tags supported by the file's parser.
const editorHighlighting = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.keyword, color: '#569cd6' },
  { tag: [tags.controlKeyword, tags.moduleKeyword], color: '#c586c0' },
  { tag: [tags.variableName, tags.propertyName, tags.attributeName], color: '#9cdcfe' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#dcdcaa' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: '#4ec9b0' },
  { tag: [tags.string, tags.attributeValue], color: '#ce9178' },
  { tag: [tags.number, tags.integer, tags.float], color: '#b5cea8' },
  { tag: [tags.bool, tags.null], color: '#569cd6' },
  { tag: tags.comment, color: '#6a9955' },
  { tag: [tags.operator, tags.punctuation], color: '#d4d4d4' },
  { tag: tags.tagName, color: '#569cd6' },
  { tag: [tags.regexp, tags.escape], color: '#d7ba7d' },
  { tag: tags.invalid, color: '#f44747' },
]))
export default function CodeEditor({ file, onChange, register, onSave, onPosition }: {
  file: FileTab; onChange: (text: string) => void; register: (view: CodeEditorHandle | null) => void; onSave: () => void; onPosition: (line: number, column: number) => void
}) {
  const host = useRef<HTMLDivElement>(null), view = useRef<EditorView | null>(null)
  const callbacks = useRef({ onChange, register, onSave, onPosition })
  callbacks.current = { onChange, register, onSave, onPosition }
  useEffect(() => {
    const editor = new EditorView({ parent: host.current!, state: EditorState.create({ doc: file.content, extensions: [basicSetup, language(file.path), editorTheme, editorHighlighting,
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
  return <div ref={host} dir="ltr" className="vscode-code-editor h-full min-h-0" />
}

