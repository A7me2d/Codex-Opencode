import { direction, tr } from '../lib/i18n'
import { useEffect, useRef, useState, type FormEvent, type MutableRefObject } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XTerminal } from '@xterm/xterm'
import { ChevronDown, ChevronUp, Eraser, TerminalSquare, X } from 'lucide-react'
import '@xterm/xterm/css/xterm.css'

declare global {
  interface Window {
    codingRoomTerminal?: {
      start: (directory: string, sessionId: string) => Promise<{ cwd: string; command: string }>
      write: (data: string) => void
      resize: (cols: number, rows: number) => void
      stop: () => void
      readClipboard: () => Promise<string>
      writeClipboard: (text: string) => Promise<void>
      onData: (callback: (data: string) => void) => () => void
      onExit: (callback: (code: number) => void) => () => void
    }
  }
}

function TerminalViewport({ cwd, sessionId, terminalRef }: { cwd: string; sessionId: string; terminalRef: MutableRefObject<XTerminal | null> }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState(tr("جارٍ الاتصال"))

  useEffect(() => {
    const host = hostRef.current
    const bridge = window.codingRoomTerminal
    if (!host) return

    const terminal = new XTerminal({
      allowProposedApi: true,
      convertEol: false,
      cursorBlink: true,
      fontFamily: 'Cascadia Mono, Cascadia Code, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.35,
      scrollback: 3000,
      theme: {
        background: '#11151d',
        foreground: '#d6deeb',
        cursor: '#73daca',
        selectionBackground: '#3d59a180',
        black: '#151821', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68',
        blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#c0caf5',
        brightBlack: '#414868', brightRed: '#f7768e', brightGreen: '#9ece6a', brightYellow: '#e0af68',
        brightBlue: '#7aa2f7', brightMagenta: '#bb9af7', brightCyan: '#7dcfff', brightWhite: '#c0caf5',
      },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host)
    terminalRef.current = terminal

    terminal.attachCustomKeyEventHandler(event => {
      if (event.type !== 'keydown' || !event.ctrlKey || event.altKey) return true

      const key = event.key.toLowerCase()
      if (key === 'v') {
        event.preventDefault()
        void bridge?.readClipboard().then(text => terminal.paste(text))
        return false
      }

      if (key === 'c' && (event.shiftKey || terminal.hasSelection())) {
        event.preventDefault()
        const selection = terminal.getSelection()
        if (selection) void bridge?.writeClipboard(selection).then(() => terminal.clearSelection())
        return false
      }

      return true
    })

    if (!bridge) {
      terminal.writeln(tr("الطرفية التفاعلية متاحة داخل نسخة سطح المكتب فقط."))
      setState(tr("غير متاحة في المتصفح"))
      return () => { terminal.dispose(); terminalRef.current = null }
    }

    const fitAndResize = () => {
      if (!host.clientWidth || !host.clientHeight) return
      fit.fit()
      bridge.resize(terminal.cols, terminal.rows)
    }
    const removeDataListener = bridge.onData(data => terminal.write(data))
    const removeExitListener = bridge.onExit(code => setState(tr("انتهت الجلسة ({{0}})", [code])))
    const input = terminal.onData(data => bridge.write(data))
    let resizeFrame = requestAnimationFrame(fitAndResize)
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame)
      resizeFrame = requestAnimationFrame(fitAndResize)
    })
    observer.observe(host)

    terminal.writeln(`PS> opencode --session ${sessionId}`)
    void bridge.start(cwd, sessionId).then(({ cwd: actualCwd }) => {
      setState(tr("متصلة"))
      terminal.writeln(`Coding Room Terminal  ·  ${actualCwd}`)
    }).catch(error => {
      setState(tr("تعذر بدء الطرفية"))
      terminal.writeln(`\r\n${tr("تعذر بدء الطرفية: {{0}}", [error instanceof Error ? error.message : String(error)])}`)
    })

    return () => {
      cancelAnimationFrame(resizeFrame)
      observer.disconnect()
      input.dispose()
      removeDataListener()
      removeExitListener()
      bridge.stop()
      terminal.dispose()
      terminalRef.current = null
    }
  }, [cwd, sessionId])

  return <div className="relative min-h-0 flex-1 bg-[#11151d] px-3 py-2" dir="ltr">
    <div ref={hostRef} className="h-full w-full" />
    <span className="absolute bottom-2 right-3 rounded bg-[#1b2230] px-2 py-0.5 font-mono text-[10px] text-[#a9b1d6]" dir={direction()}>{tr(state)}</span>
    <span className="sr-only" ref={element => { if (element) element.textContent = tr("مجلد الطرفية: {{0}}", [cwd]) }} />
  </div>
}

export function TerminalDock({ cwd }: { cwd?: string }) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [sessionId, setSessionId] = useState('')
  const [sessionDraft, setSessionDraft] = useState('')
  const [sessionError, setSessionError] = useState('')
  const terminalRef = useRef<XTerminal | null>(null)
  const activeCwd = cwd || 'Documents'

  useEffect(() => {
    setSessionId('')
    setSessionDraft('')
    setSessionError('')
  }, [cwd])

  function connectToSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const id = sessionDraft.trim()
    if (!/^ses_[A-Za-z0-9]+$/.test(id)) {
      setSessionError(tr("اكتب معرّفًا يبدأ بـ ses_ ثم حروفًا أو أرقامًا."))
      return
    }
    setSessionError('')
    setSessionId(id)
  }

  return <section className="z-30 w-full border-t border-line bg-card shadow-[0_-5px_24px_rgba(27,39,53,0.08)]" aria-label={tr("الطرفية")}>
    <div className="flex h-11 items-center justify-between gap-3 px-4" dir={direction()}>
      <div className="flex min-w-0 items-center gap-2">
        <TerminalSquare className="h-4 w-4 text-relay" aria-hidden="true" />
        <span className="text-xs font-bold text-ink">{tr("الطرفية")}</span>
        {open ? <code className="hidden max-w-[48vw] truncate rounded bg-paper px-2 py-1 text-[10px] text-ink-soft sm:block" dir="ltr" title={activeCwd}>{activeCwd}</code> : null}
      </div>
      <div className="flex items-center gap-1">
        {open ? <button type="button" onClick={() => terminalRef.current?.clear()} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[11px] text-ink-soft hover:bg-paper hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40" title={tr("مسح مخرجات الطرفية")}><Eraser className="h-3.5 w-3.5" />{tr("مسح")}</button> : null}
        <button type="button" onClick={() => { setOpen(value => !value); setMounted(true) }} aria-expanded={open} aria-controls="coding-room-terminal" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-relay-tint px-3 text-xs font-bold text-relay-ink hover:bg-relay/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40">
          {open ? <><ChevronDown className="h-3.5 w-3.5" />{tr("إخفاء")}</> : <><ChevronUp className="h-3.5 w-3.5" />{tr("إظهار Terminal")}</>}
        </button>
        {open ? <button type="button" onClick={() => setOpen(false)} aria-label={tr("إغلاق الطرفية")} title={tr("إغلاق الطرفية")} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-soft hover:bg-paper hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-relay/40"><X className="h-4 w-4" /></button> : null}
      </div>
    </div>
    {mounted ? <div id="coding-room-terminal" aria-hidden={!open} className={`${open ? 'flex' : 'hidden'} h-[min(280px,45vh)] flex-col border-t border-[#303849] bg-[#11151d]`} dir="ltr">
      {sessionId && window.codingRoomTerminal
        ? <TerminalViewport key={`${cwd ?? ''}:${sessionId}`} cwd={cwd ?? ''} sessionId={sessionId} terminalRef={terminalRef} />
        : <form onSubmit={connectToSession} className="m-auto w-full max-w-xl space-y-3 px-5 py-6 text-center text-[#d6deeb]" dir={direction()}>
          <label htmlFor="opencode-terminal-session" className="block text-sm font-bold">{tr("أدخل معرّف جلسة OpenCode")}</label>
          <p className="text-xs text-[#a9b1d6]">{tr("سيبدأ الأمر تلقائيًا:")}{' '}<code dir="ltr" className="rounded bg-[#1b2230] px-1.5 py-1">opencode --session ses_…</code></p>
          <div className="flex gap-2" dir="ltr">
            <input id="opencode-terminal-session" autoFocus value={sessionDraft} onChange={event => setSessionDraft(event.target.value)} placeholder="ses_eeff3f313ffeIwPV8psAkFSy7G" pattern="ses_[A-Za-z0-9]+" required className="min-w-0 flex-1 rounded-lg border border-[#3b4261] bg-[#151821] px-3 py-2 font-mono text-xs text-[#c0caf5] outline-none placeholder:text-[#737caa] focus:border-[#7aa2f7]" />
            <button type="submit" className="rounded-lg bg-[#7aa2f7] px-4 py-2 text-xs font-bold text-[#1a1b26] hover:bg-[#a6c0ff]">{tr("اتصال")}</button>
          </div>
          {sessionError ? <p role="alert" className="text-xs text-[#f7768e]">{sessionError}</p> : null}
        </form>}
    </div> : null}
  </section>
}
