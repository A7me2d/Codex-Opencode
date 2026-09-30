/*
 * Relay Room — an Arabic-first task desk for Codex → OpenCode handoffs.
 *
 * The page answers three questions in order:
 *   1. What am I looking at?   → the three-step handoff receipt, in plain Arabic.
 *   2. What do I click first?   → "مهمة جديدة", then the composer.
 *   3. Where will I see the answer? → the conversation, then "ملخص النتيجة".
 *
 * Everything technical (ids, paths, token counts, reasoning, tool calls, diffs)
 * still exists, but it lives behind one clearly named switch: "التفاصيل التقنية".
 *
 * Data still reaches the browser only through the same-origin relay server
 * (`server.mjs`); every request is a relative `/api/...` call.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react'
import {
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cpu,
  FileCode,
  FileDiff,
  FileText,
  Inbox,
  ListChecks,
  LoaderCircle,
  MessageSquare,
  Minus,
  NotebookPen,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Terminal,
  TriangleAlert,
  UserPlus,
  Wifi,
  WifiOff,
} from 'lucide-react'

/* -------------------------------------------------------------------------- */
/* Data shapes                                                                */
/* -------------------------------------------------------------------------- */

interface Session {
  id: string
  title?: string
  directory?: string
  model?: { providerID?: string; id?: string; variant?: string }
  tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } }
  location?: { directory?: string; worktree?: string }
  time?: { created?: number; updated?: number }
}

interface HealthPayload {
  online: boolean
  root?: string
  sessionCount?: number
  error?: string
}

interface RelayEvent {
  id: string
  timestamp: number
  role: string
  kind: string
  message: string
  sessionId?: string
}

interface DiffLine {
  kind: 'add' | 'del' | 'context'
  text: string
}

interface DiffHunk {
  header?: string
  oldStart?: number
  newStart?: number
  lines: DiffLine[]
}

interface FileDiff {
  file: string
  additions: number
  deletions: number
  hunks: DiffHunk[]
}

type ToolCategory = 'write' | 'read' | 'exec' | 'other'

type Block =
  | { kind: 'text'; id: string; text: string; technical?: boolean }
  | { kind: 'reasoning'; id: string; text: string }
  | {
      kind: 'tool'
      id: string
      tool: string
      category: ToolCategory
      status: string
      command: string
      path: string
      output: string
      error: string
    }
  | { kind: 'step'; id: string; label: string }
  | { kind: 'patch'; id: string; text: string }

interface NormalMessage {
  id: string
  role: string
  created: number
  completed: number | null
  blocks: Block[]
  finish: string
  idle: boolean
  /** A raw shell/process record from OpenCode — never part of the human chat. */
  synthetic: boolean
  error: string
}

type FormValue = string | number | boolean | string[]

interface OpenCodeFormOption {
  value: string
  label: string
  description?: string
}

interface OpenCodeFormField {
  key: string
  title?: string
  description?: string
  type: 'string' | 'number' | 'integer' | 'boolean' | 'multiselect' | 'external'
  required?: boolean
  placeholder?: string
  url?: string
  options?: OpenCodeFormOption[]
  custom?: boolean
}

interface OpenCodeForm {
  id: string
  sessionID: string
  title: string
  fields: OpenCodeFormField[]
}

interface InboxItem {
  id: string
  type: string
  delivery?: string
  time?: { created?: number }
  payload?: { text?: string }
}

interface SessionControl {
  forms: OpenCodeForm[]
  inbox: InboxItem[]
  active: boolean
}

/* -------------------------------------------------------------------------- */
/* Defensive readers — OpenCode payloads are treated as untrusted              */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** Unwraps `{ data }`, `{ items }`, `{ messages }`, `{ results }` or a bare array. */
function unwrapList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (isRecord(payload)) {
    for (const key of ['data', 'items', 'messages', 'results', 'sessions']) {
      if (Array.isArray(payload[key])) return payload[key] as T[]
    }
  }
  return []
}

function firstString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = asString(source[key])
    if (value) return value
  }
  return undefined
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return 'حدث خطأ غير متوقع داخل Relay Room.'
}

class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      cache: 'no-store',
    })
  } catch {
    throw new ApiError('تعذّر الوصول إلى خادم Relay Room المحلي. تأكد أن الخادم يعمل ثم أعد المحاولة.', 0)
  }

  const raw = await response.text()
  let payload: unknown = null
  if (raw) {
    try {
      payload = JSON.parse(raw)
    } catch {
      payload = null
    }
  }

  if (!response.ok) {
    const message = isRecord(payload) ? asString(payload.error) : undefined
    throw new ApiError(message ?? `أجاب خادم Relay Room بالرمز ${response.status}.`, response.status)
  }

  return (payload ?? {}) as T
}

/* -------------------------------------------------------------------------- */
/* Polling                                                                     */
/* -------------------------------------------------------------------------- */

type PollStatus = 'loading' | 'ready' | 'stale' | 'idle'

interface PollState<T> {
  key: string
  data: T | null
  error: string | null
  status: PollStatus
  updatedAt: number | null
}

/**
 * Polls `loader` on an interval, keyed so a changed key restarts immediately.
 * Stale data is intentionally preserved when a refresh fails.
 */
function usePoller<T>(key: string, loader: () => Promise<T>, intervalMs: number, enabled: boolean) {
  const loaderRef = useRef(loader)
  const runningRef = useRef(false)

  useEffect(() => {
    loaderRef.current = loader
  })

  const [state, setState] = useState<PollState<T>>({
    key,
    data: null,
    error: null,
    status: enabled ? 'loading' : 'idle',
    updatedAt: null,
  })

  useEffect(() => {
    if (!enabled) {
      setState({ key, data: null, error: null, status: 'idle', updatedAt: null })
      return
    }

    let active = true
    setState((previous) => ({ ...previous, key, status: previous.data ? previous.status : 'loading' }))

    const run = async () => {
      if (runningRef.current) return
      runningRef.current = true
      try {
        const data = await loaderRef.current()
        if (!active) return
        setState({ key, data, error: null, status: 'ready', updatedAt: Date.now() })
      } catch (error) {
        if (!active) return
        const message = errorMessage(error)
        setState((previous) =>
          previous.key === key
            ? { ...previous, error: message, status: 'stale' }
            : { key, data: null, error: message, status: 'stale', updatedAt: null },
        )
      } finally {
        runningRef.current = false
      }
    }

    void run()
    const timer = window.setInterval(run, intervalMs)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [key, intervalMs, enabled])

  // A key change means the previous payload belongs to a different subject.
  const view: PollState<T> =
    state.key === key ? state : { key, data: null, error: null, status: enabled ? 'loading' : 'idle', updatedAt: null }

  return view
}

/* -------------------------------------------------------------------------- */
/* Message normalization                                                      */
/* -------------------------------------------------------------------------- */

const WRITE_TOOLS = new Set([
  'write',
  'edit',
  'multiedit',
  'multiedit_file',
  'patch',
  'apply_patch',
  'applypatch',
  'notebookedit',
  'create_file',
  'write_file',
  'str_replace_editor',
])

function toolCategory(tool: string): ToolCategory {
  const name = tool.toLowerCase()
  if (WRITE_TOOLS.has(name)) return 'write'
  if (name.includes('write') || name.includes('edit') || name.includes('patch')) return 'write'
  if (
    name === 'bash' ||
    name === 'shell' ||
    name === 'run' ||
    name === 'exec' ||
    name === 'powershell' ||
    name.includes('bash') ||
    name.includes('shell') ||
    name.includes('exec') ||
    name.includes('command')
  ) {
    return 'exec'
  }
  if (name.includes('read') || name.includes('grep') || name.includes('glob') || name.includes('search') || name.includes('list')) {
    return 'read'
  }
  return 'other'
}

const COMMAND_KEYS = ['command', 'cmd', 'script', 'args', 'pattern', 'query', 'url', 'description', 'prompt']
const PATH_KEYS = ['filePath', 'file_path', 'path', 'file', 'target', 'notebook_path', 'filename']

function summarizeInput(input: unknown): { command: string; path: string } {
  if (!isRecord(input)) return { command: '', path: '' }
  const path = firstString(input, PATH_KEYS)
  const command = firstString(input, COMMAND_KEYS)
  return { command: command ?? (path ?? ''), path: path ?? '' }
}

function stringifyOutput(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value, null, 2) ?? ''
  } catch {
    return String(value)
  }
}

/**
 * Tool results land in several shapes: a plain `output`/`stdout` string, a `content`
 * array of `{ type: 'text', text }` blocks, or a raw object. Read all of them.
 */
function collectToolOutput(state: Record<string, unknown>): string {
  const direct = stringifyOutput(state.output ?? state.stdout ?? state.result ?? state.text)
  if (direct) return direct

  const content = state.content
  if (Array.isArray(content)) {
    const texts = content
      .map((entry) => {
        if (typeof entry === 'string') return entry
        if (isRecord(entry)) return asString(entry.text) ?? asString(entry.content) ?? ''
        return ''
      })
      .filter((value) => value.length > 0)
    if (texts.length > 0) return texts.join('\n')
  }
  return ''
}

/**
 * OpenCode emits raw execution records alongside its human answers. They arrive
 * either as a message whose `type` is one of the synthetic roles, or as a text
 * part whose body is a shell-style transcript. Both are kept — never discarded —
 * but they are withheld from the default conversation and only surfaced under
 * "التفاصيل التقنية".
 */
const SYNTHETIC_ROLES = new Set([
  'synthetic',
  'shell',
  'process',
  'command',
  'terminal',
  'bash',
  'exec',
  'patch',
])

const SHELL_MARKER =
  /^\s*<\s*(?:shell|process|bash|sh|command|terminal|exec|tool|tool-call|tool_use|tool-result|output|stdin|stdout|stderr|env|patch|snapshot|agent|file)\b/i

/** `$ cmd`. The space is required so ordinary text like "$100" is not a shell line. */
const SHELL_PROMPT_DOLLAR = /^\$\s+\S/

/** `PS C:\dir>` and `C:\dir>` prompts — no space is expected after the caret. */
const SHELL_PROMPT_CARET = /^(?:PS\s+)?[A-Za-z]:\\[^>]*>\s*\S/

/** True when a text body opens with a synthetic wrapper tag or a shell prompt. */
function isShellRecord(text: string): boolean {
  const first = text.split('\n').find((line) => line.trim().length > 0)?.trim() ?? ''
  if (!first) return false
  return SHELL_MARKER.test(first) || SHELL_PROMPT_DOLLAR.test(first) || SHELL_PROMPT_CARET.test(first)
}

function normalizeBlock(part: unknown, index: number, messageIndex: number, role: string): Block | null {
  // A user pasting a transcript into the composer is a human message, not a
  // synthetic record, so the content test is skipped for their own turns.
  const technical = role !== 'user'
  if (typeof part === 'string') {
    const text = part.trim()
    return text ? { kind: 'text', id: `m${messageIndex}b${index}`, text, technical: technical && isShellRecord(text) } : null
  }
  if (!isRecord(part)) return null

  const id = `${messageIndex}:${index}`
  const type = (asString(part.type) ?? asString(part.role) ?? 'text').toLowerCase()

  if (type === 'tool' || asString(part.tool) || asString(part.toolName) || asString(part.name) || isRecord(part.state)) {
    const tool = asString(part.tool) ?? asString(part.toolName) ?? asString(part.name) ?? 'tool'
    const state = isRecord(part.state) ? part.state : part
    const status = (asString(state.status) ?? asString(part.status) ?? 'completed').toLowerCase()
    const { command, path } = summarizeInput(state.input)
    const title = asString(state.title)
    const output = collectToolOutput(state)
    const error = asString(state.error) ?? (isRecord(state.error) ? asString(state.error.message) : undefined)
    const metadata = isRecord(state.metadata) ? state.metadata : {}
    const exit = asNumber(metadata.exit)
    return {
      kind: 'tool',
      id,
      tool,
      category: toolCategory(tool),
      status,
      command: command || title || '',
      path,
      output: exit !== undefined && exit !== 0 ? `exit ${exit}\n${output}` : output,
      error: error ?? '',
    }
  }

  if (type === 'reasoning' || type === 'thinking') {
    const text = asString(part.text) ?? asString(part.reasoning) ?? ''
    return text ? { kind: 'reasoning', id, text } : null
  }

  if (type === 'step-finish' || type === 'step-finished' || type === 'step' || type === 'step-start') {
    const label = type === 'step-finish' || type === 'step-finished' ? 'step finished' : 'step started'
    return { kind: 'step', id, label }
  }

  if (type === 'patch' || type === 'diff') {
    const text = asString(part.text) ?? asString(part.patch) ?? asString(part.diff) ?? ''
    return text ? { kind: 'patch', id, text } : null
  }

  if (type === 'file' || type === 'snapshot' || type === 'agent') return null

  const text = asString(part.text) ?? asString(part.content) ?? (typeof part.content === 'string' ? part.content : undefined)
  if (text) {
    const trimmed = text.trim()
    return { kind: 'text', id, text: trimmed, technical: technical && isShellRecord(trimmed) }
  }
  return null
}

function normalizeMessage(raw: unknown, index: number): NormalMessage | null {
  if (!isRecord(raw)) return null

  const id = asString(raw.id) ?? `message-${index}`
  // OpenCode sends the role on `type`; older builds use `role`.
  const role = (asString(raw.role) ?? asString(raw.type) ?? 'assistant').toLowerCase()
  // Both fields are checked so a synthetic record is recognised regardless of
  // which one the payload used.
  const synthetic =
    SYNTHETIC_ROLES.has(role) || SYNTHETIC_ROLES.has((asString(raw.type) ?? '').toLowerCase())
  const time = isRecord(raw.time) ? raw.time : {}
  const created = asNumber(time.created) ?? asNumber(time.updated) ?? asNumber(raw.created) ?? 0
  const completed = asNumber(time.completed) ?? null
  const finish = (asString(raw.finish) ?? asString(raw.rawFinish) ?? '').toLowerCase()

  const sourceParts = Array.isArray(raw.parts) ? raw.parts : Array.isArray(raw.content) ? raw.content : []
  const blocks = sourceParts
    .map((part, partIndex) => normalizeBlock(part, partIndex, index, role))
    .filter((block): block is Block => block !== null)

  if (blocks.length === 0) {
    const fallback = asString(raw.text) ?? asString(raw.content)
    if (fallback) {
      blocks.push({ kind: 'text', id: `${id}:text`, text: fallback, technical: role !== 'user' && isShellRecord(fallback) })
    }
  }

  const rawError = raw.error
  const error = asString(rawError) ?? (isRecord(rawError) ? (asString(rawError.message) ?? asString(rawError.name)) : undefined) ?? ''

  // An assistant turn that finished without saying anything is an idle marker.
  const spoke = blocks.some((block) => block.kind === 'text' && block.text.length > 0)
  const idle = role === 'assistant' && !spoke && (completed !== null || blocks.length === 0)

  return { id, role, created, completed, blocks, finish, idle, synthetic, error }
}

function normalizeMessages(payload: unknown): NormalMessage[] {
  return unwrapList<unknown>(payload)
    .map((message, index) => normalizeMessage(message, index))
    .filter((message): message is NormalMessage => message !== null)
    // OpenCode's HTTP API returns newest-first by default. The dashboard is a
    // conversation, so all state and rendering must work oldest-to-newest.
    .sort((left, right) => left.created - right.created || left.id.localeCompare(right.id))
}

function normalizeFormOption(raw: unknown): OpenCodeFormOption | null {
  if (!isRecord(raw)) return null
  const value = asString(raw.value)
  const label = asString(raw.label)
  if (!value || !label) return null
  return { value, label, description: asString(raw.description) }
}

function normalizeFormField(raw: unknown): OpenCodeFormField | null {
  if (!isRecord(raw)) return null
  const key = asString(raw.key)
  const type = asString(raw.type)
  if (!key || !type || !['string', 'number', 'integer', 'boolean', 'multiselect', 'external'].includes(type)) return null
  return {
    key,
    type: type as OpenCodeFormField['type'],
    title: asString(raw.title),
    description: asString(raw.description),
    required: raw.required === true,
    placeholder: asString(raw.placeholder),
    url: asString(raw.url),
    options: asArray(raw.options)
      .map(normalizeFormOption)
      .filter((option): option is OpenCodeFormOption => option !== null),
    custom: raw.custom === true,
  }
}

function normalizeForm(raw: unknown): OpenCodeForm | null {
  if (!isRecord(raw)) return null
  const id = asString(raw.id)
  const sessionID = asString(raw.sessionID)
  if (!id || !sessionID) return null
  const fields = asArray(raw.fields)
    .map(normalizeFormField)
    .filter((field): field is OpenCodeFormField => field !== null)
  if (fields.length === 0) return null
  return { id, sessionID, title: asString(raw.title) ?? 'OpenCode needs an answer', fields }
}

function normalizeInboxItem(raw: unknown): InboxItem | null {
  if (!isRecord(raw)) return null
  const id = asString(raw.id)
  const type = asString(raw.type)
  if (!id || !type) return null
  const time = isRecord(raw.time) ? raw.time : undefined
  const payload = isRecord(raw.payload) ? raw.payload : undefined
  return {
    id,
    type,
    delivery: asString(raw.delivery),
    time: time ? { created: asNumber(time.created) } : undefined,
    payload: payload ? { text: asString(payload.text) } : undefined,
  }
}

function normalizeControl(payload: unknown): SessionControl {
  const outer = isRecord(payload) ? payload : {}
  const data = isRecord(outer.data) ? outer.data : outer
  return {
    forms: asArray(data.forms)
      .map(normalizeForm)
      .filter((form): form is OpenCodeForm => form !== null),
    inbox: asArray(data.inbox)
      .map(normalizeInboxItem)
      .filter((item): item is InboxItem => item !== null),
    active: data.active === true,
  }
}

function normalizeDiffs(payload: unknown): FileDiff[] {
  return unwrapList<unknown>(payload)
    .map((entry, index): FileDiff | null => {
      if (typeof entry === 'string') return { file: entry, additions: 0, deletions: 0, hunks: [] }
      if (!isRecord(entry)) return null
      const file = asString(entry.file) ?? asString(entry.path) ?? asString(entry.filename) ?? `change-${index + 1}`
      const hunks = asArray(entry.hunks).map((hunk): DiffHunk => {
        const record = isRecord(hunk) ? hunk : {}
        return {
          header: asString(record.header),
          oldStart: asNumber(record.oldStart),
          newStart: asNumber(record.newStart),
          lines: asArray(record.lines).map((line): DiffLine => {
            if (typeof line === 'string') return { kind: 'context', text: line }
            const record2 = isRecord(line) ? line : {}
            const rawKind = (asString(record2.type) ?? asString(record2.kind) ?? 'context').toLowerCase()
            const kind: DiffLine['kind'] = rawKind.startsWith('add') ? 'add' : rawKind.startsWith('del') || rawKind.startsWith('rem') ? 'del' : 'context'
            return { kind, text: asString(record2.text) ?? asString(record2.line) ?? '' }
          }),
        }
      })
      return {
        file,
        additions: asNumber(entry.additions) ?? 0,
        deletions: asNumber(entry.deletions) ?? 0,
        hunks,
      }
    })
    .filter((diff): diff is FileDiff => diff !== null)
}

/** Falls back to paths seen in tool traffic when the session exposes no diff. */
function inferWrittenPaths(messages: NormalMessage[]): string[] {
  const found: string[] = []
  const push = (value: string) => {
    const trimmed = value.trim().replace(/^["']|["']$/g, '')
    if (trimmed && !found.includes(trimmed)) found.push(trimmed)
  }

  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.kind !== 'tool') continue
      if (block.category === 'write') {
        if (block.path) push(block.path)
        continue
      }
      if (block.category !== 'exec' || !block.command) continue
      const redirect = /(?:^|\s)(?:2>|>|>>)\s*([^\s>|;&]+)/g
      let match = redirect.exec(block.command)
      while (match) {
        push(match[1])
        match = redirect.exec(block.command)
      }
      const cmdlet = /\b(?:set-content|add-content|out-file|copy-item|move-item|new-item)\b[^\n]*?["']?([\w./\\-]+\.\w{1,8})/gi
      let cmdletMatch = cmdlet.exec(block.command)
      while (cmdletMatch) {
        push(cmdletMatch[1])
        cmdletMatch = cmdlet.exec(block.command)
      }
    }
  }

  return found
}

/* -------------------------------------------------------------------------- */
/* Formatting — Arabic for people, monospace for machines                      */
/* -------------------------------------------------------------------------- */

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

/**
 * Arabic noun form governed by the numeral rendered in front of it. Because the
 * numeral is always present, the dual ("طلبان") must never be used — that would
 * read as "2 طلبان". So: 0 takes the plural, 1 and 2 the singular, 3–10 the
 * plural, 11–99 the accusative singular, and 100+ the plain singular again.
 */
function arNoun(value: number, one: string, few: string, many: string): string {
  if (value === 0) return few
  if (value === 1 || value === 2) return one
  if (value <= 10) return few
  if (value <= 99) return many
  return one
}

function arCountOf(value: number): string {
  return String(value)
}

const AR_MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
]

/** Machine time: always Latin digits, always monospace in the UI. */
function formatClock(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '--:--:--'
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '--:--:--'
  return date.toLocaleTimeString([], { hour12: false })
}

function formatDate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'غير معروف'
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return 'غير معروف'
  return `${date.getDate()} ${AR_MONTHS[date.getMonth()]}`
}

/** Human time: friendly Arabic, used for every "when did this happen" label. */
function formatRelative(timestamp: number | null | undefined, now: number): string {
  if (!timestamp || !Number.isFinite(timestamp) || timestamp <= 0) return 'لا يوجد وقت مسجّل'
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 15) return 'الآن'
  if (seconds < 60) return `قبل ${arCountOf(seconds)} ${arNoun(seconds, 'ثانية', 'ثوانٍ', 'ثانية')}`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `قبل ${arCountOf(minutes)} ${arNoun(minutes, 'دقيقة', 'دقائق', 'دقيقة')}`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `قبل ${arCountOf(hours)} ${arNoun(hours, 'ساعة', 'ساعات', 'ساعة')}`
  const days = Math.floor(hours / 24)
  if (days < 7) return `قبل ${arCountOf(days)} ${arNoun(days, 'يوم', 'أيام', 'يومًا')}`
  return `في ${formatDate(timestamp)}`
}

function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value
}

function compactTokens(value: number | undefined): string {
  if (!value || !Number.isFinite(value) || value <= 0) return '0'
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`
  return `${(value / 1_000_000).toFixed(1)}M`
}

const MAX_VISIBLE_LINES = 6
const MAX_OUTPUT_CHARS = 1200
const MAX_RAW_RECORD_CHARS = 4000

function snippet(value: string, limit = MAX_OUTPUT_CHARS): string {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n… تم اختصار باقي الناتج (${value.length - limit} حرفًا)`
}

function splitLines(value: string): string[] {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

function clamp(value: string, limit: number): string {
  const trimmed = value.trim()
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit).trimEnd()}…`
}

/* -------------------------------------------------------------------------- */
/* Task state — the one label the user reads first                             */
/* -------------------------------------------------------------------------- */

type Tone = 'ready' | 'relay' | 'review' | 'muted'

const TONE_PILL: Record<Tone, string> = {
  ready: 'border-ready/35 bg-ready-tint text-ready-ink',
  relay: 'border-relay/35 bg-relay-tint text-relay-ink',
  review: 'border-review/40 bg-review-tint text-review-ink',
  muted: 'border-line bg-paper text-ink-soft',
}

const TONE_DOT: Record<Tone, string> = {
  ready: 'bg-ready',
  relay: 'bg-relay',
  review: 'bg-review',
  muted: 'bg-line-strong',
}

function taskStateOf(input: {
  hasSession: boolean
  replies: number
  busy: boolean
  waiting: boolean
  needsInput: boolean
  queued: boolean
  failed: boolean
}): { tone: Tone; label: string; advice: string } {
  if (!input.hasSession) {
    return { tone: 'muted', label: 'لم تختر مهمة بعد', advice: 'اختر مهمة من القائمة على اليسار، أو ابدأ مهمة جديدة منها.' }
  }
  if (input.failed) {
    return { tone: 'review', label: 'حدث خطأ في الرد', advice: 'اقرأ نص الخطأ بالأسفل، ثم أعد إرسال طلبك.' }
  }
  if (input.needsInput) {
    return {
      tone: 'review',
      label: 'OpenCode يحتاج توضيحًا منك',
      advice: 'أجب عن الأسئلة الظاهرة أسفل الحالة. لن يبدأ التنفيذ قبل أن يستلم إجابتك.',
    }
  }
  if (input.busy) {
    return { tone: 'relay', label: 'OpenCode يعمل الآن', advice: 'لا تكتب طلبًا جديدًا حتى ينتهي الرد، أو تابع الرد أسفل المحادثة.' }
  }
  if (input.queued) {
    return {
      tone: 'relay',
      label: 'الطلب محفوظ في طابور OpenCode',
      advice: 'OpenCode أكد استلام الطلب. سيبدأ التنفيذ تلقائيًا عندما يصبح الدور متاحًا.',
    }
  }
  if (input.replies === 0) {
    return { tone: 'ready', label: 'جاهز للطلب', advice: 'اكتب طلبك في المربع بالأسفل، ثم اضغط «إرسال إلى OpenCode».' }
  }
  if (input.waiting) {
    return { tone: 'muted', label: 'الطلب محفوظ ولم يبدأ الرد بعد', advice: 'سيظهر التنفيذ هنا عند بدء OpenCode في المهمة.' }
  }
  return { tone: 'review', label: 'تم الرد', advice: 'اقرأ الرد، ثم افتح «ملاحظات Codex» لتسجيل تقييمك.' }
}

/* -------------------------------------------------------------------------- */
/* Small presentational atoms                                                  */
/* -------------------------------------------------------------------------- */

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold',
        TONE_PILL[tone],
      )}
    >
      {children}
    </span>
  )
}

function Spinner({ className }: { className?: string }) {
  return <LoaderCircle aria-hidden="true" className={cx('motion-safe:animate-spin', className)} />
}

function EmptyNote({ icon, title, hint }: { icon: ReactNode; title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span aria-hidden="true" className="text-line-strong">
        {icon}
      </span>
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="max-w-[40ch] text-xs leading-relaxed text-ink-soft">{hint}</p>
    </div>
  )
}

function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 border-b border-review/30 bg-review-tint px-4 py-2.5 text-xs text-review-ink"
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <p className="min-w-0 flex-1 leading-relaxed">
        <span className="font-semibold">تعذّر إتمام الطلب: </span>
        <span dir="auto" className="break-words">
          {message}
        </span>
      </p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-md border border-review/40 bg-card px-2.5 py-1 text-xs font-semibold text-review-ink transition-colors hover:bg-review/10"
        >
          أعد المحاولة
        </button>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Signature element — the three-step handoff receipt                          */
/* -------------------------------------------------------------------------- */

const STEPS = [
  { key: 'choose', title: 'اختر مهمة', hint: 'ابدأ مهمة جديدة، أو اختر واحدة من قائمة «المهام».' },
  { key: 'write', title: 'اكتب طلبك', hint: 'اكتب ما تريده بلغة بسيطة، ثم اضغط «إرسال إلى OpenCode».' },
  { key: 'watch', title: 'راقب النتيجة', hint: 'اقرأ رد OpenCode، ثم دوّن تقييمك في «ملاحظات Codex».' },
] as const

function StepReceipt({ current }: { current: number }) {
  return (
    <section aria-label="خطوات التسليم الثلاث" className="shrink-0 border-b border-line bg-card">
      <ol className="grid gap-3 px-4 py-4 sm:grid-cols-3 sm:gap-6 sm:px-6">
        {STEPS.map((step, index) => {
          const done = index < current
          const active = index === current
          return (
            <li
              key={step.key}
              aria-current={active ? 'step' : undefined}
              className="relative flex items-start gap-3"
            >
              <span
                aria-hidden="true"
                className={cx(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition-colors',
                  done
                    ? 'border-ready bg-ready text-card'
                    : active
                      ? 'border-relay bg-relay text-card'
                      : 'border-line-strong bg-card text-ink-soft',
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <span className="min-w-0">
                <span className={cx('block text-sm font-bold', done || active ? 'text-ink' : 'text-ink-soft')}>
                  {index + 1} {step.title}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-ink-soft">{step.hint}</span>
              </span>
              {index > 0 ? (
                <ChevronLeft
                  aria-hidden="true"
                  className="absolute -end-4 top-1.5 hidden h-4 w-4 translate-x-1/2 text-line-strong sm:block"
                />
              ) : null}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Sidebar — المهام                                                            */
/* -------------------------------------------------------------------------- */

function TaskSidebar({
  sessions,
  selectedId,
  onSelect,
  status,
  error,
  onRetry,
  onCreate,
  creating,
  createError,
}: {
  sessions: Session[]
  selectedId: string | null
  onSelect: (id: string) => void
  status: PollStatus
  error: string | null
  onRetry: () => void
  onCreate: (title: string) => void
  creating: boolean
  createError: string | null
}) {
  const [query, setQuery] = useState('')
  const [composing, setComposing] = useState(false)
  const [title, setTitle] = useState('')
  const nameRef = useRef<HTMLInputElement | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (composing) nameRef.current?.focus()
  }, [composing])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return sessions
    return sessions.filter((session) => {
      const name = (session.title ?? '').toLowerCase()
      return name.includes(needle) || session.id.toLowerCase().includes(needle)
    })
  }, [sessions, query])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onCreate(title.trim() || 'مهمة جديدة')
    setTitle('')
  }

  return (
    <aside
      aria-label="المهام"
      className="flex min-h-0 flex-col border-b border-line bg-card lg:order-2 lg:border-b-0 lg:border-s"
    >
      <div className="border-b border-line px-4 py-4">
        <h2 className="flex items-center gap-2 text-base font-bold text-ink">
          <ListChecks aria-hidden="true" className="h-4 w-4 text-relay" />
          المهام
        </h2>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
          كل مهمة محادثة منفصلة مع OpenCode. ابدأ مهمة، اكتب طلبك، ثم اقرأ الرد.
        </p>
        <button
          type="button"
          onClick={() => setComposing((open) => !open)}
          aria-expanded={composing}
          aria-controls="new-task-form"
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-relay px-3 py-2.5 text-sm font-bold text-white shadow-xs transition-colors hover:bg-relay-ink disabled:cursor-not-allowed disabled:opacity-60"
          disabled={creating}
        >
          {creating ? <Spinner className="h-4 w-4" /> : <Plus aria-hidden="true" className="h-4 w-4" />}
          مهمة جديدة
        </button>
      </div>

      {composing ? (
        <form id="new-task-form" onSubmit={submit} className="space-y-2 border-b border-line bg-paper px-4 py-3">
          <label htmlFor="new-task-name" className="block text-xs font-bold text-ink">
            اسم المهمة <span className="font-normal text-ink-soft">(اختياري)</span>
          </label>
          <input
            id="new-task-name"
            ref={nameRef}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="مثال: إصلاح خطأ تسجيل الدخول"
            maxLength={120}
            disabled={creating}
            className="w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-soft/70"
          />
          <p className="text-[11px] leading-relaxed text-ink-soft">
            بعد الإنشاء ستفتح لك مهمة فارغة جاهزة، ترسل إليها طلبك مباشرة.
          </p>
          {createError ? (
            <p role="alert" className="text-xs leading-relaxed text-review-ink">
              {createError}
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={creating}
              aria-busy={creating}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-ink/90 disabled:opacity-60"
            >
              {creating ? <Spinner className="h-3.5 w-3.5" /> : <UserPlus aria-hidden="true" className="h-3.5 w-3.5" />}
              {creating ? 'جارٍ الفتح…' : 'ابدأ المهمة'}
            </button>
            <button
              type="button"
              onClick={() => setComposing(false)}
              className="rounded-lg border border-line-strong bg-card px-3 py-2 text-xs font-semibold text-ink-soft transition-colors hover:border-relay/50 hover:text-relay"
            >
              إلغاء
            </button>
          </div>
        </form>
      ) : null}

      <div className="border-b border-line px-4 py-3">
        <label htmlFor="task-search" className="sr-only">
          ابحث في المهام
        </label>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-soft/70"
          />
          <input
            id="task-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ابحث في المهام"
            className="w-full rounded-lg border border-line-strong bg-card py-2 pe-3 ps-9 text-sm text-ink placeholder:text-ink-soft/70"
          />
        </div>
        <p className="mt-1.5 text-[11px] text-ink-soft">
          {status === 'loading' && sessions.length === 0
            ? 'جارٍ تحميل المهام…'
            : `${arCountOf(sessions.length)} ${arNoun(sessions.length, 'مهمة', 'مهام', 'مهمة')} في القائمة`}
        </p>
      </div>

      {error ? <ErrorNote message={error} onRetry={onRetry} /> : null}

      {sessions.length === 0 && !error ? (
        <EmptyNote
          icon={<Inbox className="h-7 w-7" />}
          title="لا توجد مهام بعد"
          hint="اضغط «مهمة جديدة» بالأعلى لتبدأ أول مهمة، أو ابدأ جلسة OpenCode داخل نفس المشروع."
        />
      ) : filtered.length === 0 ? (
        <EmptyNote
          icon={<Search className="h-7 w-7" />}
          title="لا توجد نتائج"
          hint="امسح البحث لترى كل المهام، أو ابحث باسم مختلف."
        />
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
          {filtered.map((session) => {
            const selected = session.id === selectedId
            const updated = session.time?.updated ?? session.time?.created ?? 0
            return (
              <li key={session.id}>
                <button
                  type="button"
                  onClick={() => onSelect(session.id)}
                  aria-current={selected ? 'true' : undefined}
                  className={cx(
                    'flex w-full items-start gap-2.5 border-s-[3px] px-4 py-3 text-start transition-colors',
                    selected ? 'border-s-relay bg-relay-tint' : 'border-s-transparent hover:bg-paper',
                  )}
                >
                  <MessageSquare
                    aria-hidden="true"
                    className={cx('mt-0.5 h-4 w-4 shrink-0', selected ? 'text-relay' : 'text-ink-soft/60')}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cx(
                        'block truncate text-sm font-semibold',
                        selected ? 'text-ink' : 'text-ink/85',
                      )}
                    >
                      {session.title?.trim() || 'مهمة بلا عنوان'}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-soft">{formatRelative(updated, now)}</span>
                  </span>
                  {selected ? (
                    <span className="shrink-0 rounded-full bg-relay px-2 py-0.5 text-[10px] font-bold text-white">
                      الحالية
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}

/* -------------------------------------------------------------------------- */
/* Task header — title, state, and the single technical switch                 */
/* -------------------------------------------------------------------------- */

function TaskHeader({
  title,
  state,
  updatedLabel,
  showTechnical,
  onToggleTechnical,
  session,
  root,
  messageCount,
  requestCount,
}: {
  title: string
  state: { tone: Tone; label: string; advice: string }
  updatedLabel: string
  showTechnical: boolean
  onToggleTechnical: () => void
  session: Session | null
  root: string | undefined
  messageCount: number
  requestCount: number
}) {
  const tokens = session?.tokens
  const directory = session?.location?.directory ?? session?.directory ?? ''

  return (
    <div className="shrink-0 border-b border-line bg-card px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-ink">{title}</h1>
        <Pill tone={state.tone}>
          <span aria-hidden="true" className={cx('h-1.5 w-1.5 rounded-full', TONE_DOT[state.tone])} />
          {state.label}
        </Pill>
        <span className="text-xs text-ink-soft">{updatedLabel}</span>
        <button
          type="button"
          onClick={onToggleTechnical}
          aria-expanded={showTechnical}
          aria-controls="technical-metadata"
          className={cx(
            'flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors',
            showTechnical
              ? 'border-relay/50 bg-relay-tint text-relay-ink'
              : 'border-line-strong bg-card text-ink-soft hover:border-relay/50 hover:text-relay',
          )}
        >
          <Cpu aria-hidden="true" className="h-3.5 w-3.5" />
          التفاصيل التقنية
          <ChevronDown
            aria-hidden="true"
            className={cx('h-3.5 w-3.5 transition-transform', showTechnical && 'rotate-180')}
          />
        </button>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-ink-soft">{state.advice}</p>

      {showTechnical ? (
        <div
          id="technical-metadata"
          className="mt-3 grid gap-2 rounded-lg border border-line bg-paper px-3 py-2.5 text-xs sm:grid-cols-2"
        >
          <MetaRow label="معرّف المهمة" value={session?.id ?? '—'} latin />
          <MetaRow label="المجلد" value={root || directory || '—'} latin />
          <MetaRow
            label="النموذج"
            value={session?.model?.id ? `OpenCode / ${session.model.id}` : 'OpenCode / Big Pickle'}
            latin
          />
          <MetaRow
            label="الرموز"
            value={`إدخال ${compactTokens(tokens?.input)} · إخراج ${compactTokens(tokens?.output)} · تفكير ${compactTokens(tokens?.reasoning)} · ذاكرة ${compactTokens(tokens?.cache?.read)}`}
          />
          <MetaRow
            label="التوقيت"
            value={`فُتحت ${formatClock(session?.time?.created ?? 0)} · حُدّثت ${formatClock(session?.time?.updated ?? 0)}`}
          />
          <MetaRow
            label="الرسائل"
            value={`${arCountOf(messageCount)} ${arNoun(messageCount, 'رسالة', 'رسائل', 'رسالة')} · ${arCountOf(requestCount)} طلب`}
          />
        </div>
      ) : null}
    </div>
  )
}

function MetaRow({ label, value, latin }: { label: string; value: string; latin?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[11px] font-semibold text-ink-soft">{label}</span>
      <span
        dir={latin ? 'ltr' : 'auto'}
        className={cx('min-w-0 truncate font-mono text-[11px] text-ink', latin && 'ltr')}
      >
        {value}
      </span>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Composer — the one obvious way to start work                                */
/* -------------------------------------------------------------------------- */

function Composer({
  value,
  onChange,
  onSubmit,
  disabled,
  disabledHint,
  sending,
  error,
  receipt,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  disabled: boolean
  disabledHint?: string
  sending: boolean
  error: string | null
  receipt: string | null
}) {
  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      if (!disabled && !sending && value.trim()) onSubmit()
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
      className="shrink-0 border-b border-line bg-card px-4 py-4 sm:px-6"
    >
      <label htmlFor="relay-prompt" className="block text-sm font-bold text-ink">
        ما الذي تريد أن يفعله OpenCode؟
      </label>
      <p className="mt-1 text-xs leading-relaxed text-ink-soft">
        اكتب المهمة كما تشرحها لصديق: ما النتيجة التي تريدها، وأي ملف أو صفحة تتصرّف عليها.
      </p>

      <textarea
        id="relay-prompt"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
        disabled={disabled || sending}
        aria-describedby={error ? 'relay-prompt-error' : 'relay-prompt-hint'}
        aria-invalid={error ? true : undefined}
        placeholder={
          disabled
            ? disabledHint ?? 'اختر مهمة من قائمة «المهام» أولًا، ثم اكتب طلبك هنا.'
            : 'مثال: أصلح خطأ «Cannot read properties of undefined» في src/auth/session.ts، وأضف اختبارًا يغطي الحالة الفارغة.'
        }
        className="mt-2.5 w-full resize-y rounded-lg border border-line-strong bg-card px-3 py-2.5 text-sm leading-relaxed text-ink placeholder:text-ink-soft/60 disabled:cursor-not-allowed disabled:bg-paper"
      />

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="submit"
          disabled={disabled || sending || !value.trim()}
          aria-busy={sending}
          className="flex items-center justify-center gap-2 rounded-lg bg-relay px-4 py-2.5 text-sm font-bold text-white shadow-xs transition-colors hover:bg-relay-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? <Spinner className="h-4 w-4" /> : <Sparkles aria-hidden="true" className="h-4 w-4" />}
          {sending ? 'جارٍ الإرسال…' : 'إرسال إلى OpenCode'}
        </button>
        <span id="relay-prompt-hint" className="text-xs text-ink-soft">
          {disabled && disabledHint ? (
            disabledHint
          ) : (
            <>
              أو اضغط <kbd className="ltr rounded border border-line bg-paper px-1 py-0.5 font-mono text-[10px]">Ctrl</kbd>{' '}
              + <kbd className="ltr rounded border border-line bg-paper px-1 py-0.5 font-mono text-[10px]">Enter</kbd> للإرسال
            </>
          )}
        </span>
      </div>

      {error ? (
        <p id="relay-prompt-error" role="alert" className="mt-2 text-xs leading-relaxed text-review-ink">
          لم يصل الطلب إلى OpenCode: {error}
        </p>
      ) : null}
      {receipt ? (
        <p role="status" className="mt-2 text-xs leading-relaxed text-ready-ink">
          {receipt}
        </p>
      ) : null}
    </form>
  )
}

function isMissingFormValue(value: FormValue | undefined): boolean {
  return value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
}

function PendingForms({
  forms,
  answers,
  onAnswerChange,
  onSubmit,
  submittingForm,
  error,
}: {
  forms: OpenCodeForm[]
  answers: Record<string, Record<string, FormValue>>
  onAnswerChange: (formId: string, field: string, value: FormValue) => void
  onSubmit: (form: OpenCodeForm) => void
  submittingForm: string | null
  error: string | null
}) {
  if (forms.length === 0) return null

  return (
    <section aria-label="أسئلة معلقة من OpenCode" className="shrink-0 border-b border-review/30 bg-review-tint px-4 py-4 sm:px-6">
      <div className="flex items-start gap-2">
        <ListChecks aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-review-ink" />
        <div>
          <h2 className="text-sm font-bold text-review-ink">OpenCode يحتاج منك توضيحًا</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-review-ink/85">
            أجب هنا مباشرةً؛ هذه الإجابة تُرسل إلى السؤال الحقيقي المعلّق داخل OpenCode، وليست رسالة دردشة جديدة.
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {error ? (
          <p role="alert" className="rounded-md border border-review/30 bg-card px-3 py-2 text-xs leading-relaxed text-review-ink">
            لم تصل الإجابة إلى OpenCode: {error}
          </p>
        ) : null}
        {forms.map((form) => {
          const answer = answers[form.id] ?? {}
          const missingRequired = form.fields.some((field) => field.required && isMissingFormValue(answer[field.key]))
          const submitting = submittingForm === form.id
          return (
            <form
              key={form.id}
              onSubmit={(event) => {
                event.preventDefault()
                onSubmit(form)
              }}
              className="rounded-lg border border-review/35 bg-card p-3"
            >
              <h3 className="text-sm font-bold text-ink">{form.title}</h3>
              <div className="mt-3 space-y-3">
                {form.fields.map((field) => {
                  const fieldId = `${form.id}-${field.key}`
                  const value = answer[field.key]
                  const title = field.title ?? field.key
                  const description = field.description

                  if (field.type === 'external') {
                    return (
                      <div key={field.key} className="rounded-md border border-line bg-paper px-3 py-2 text-xs text-ink-soft">
                        <p className="font-semibold text-ink">{title}</p>
                        {description ? <p className="mt-1 leading-relaxed">{description}</p> : null}
                        {field.url ? (
                          <a href={field.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-relay underline">
                            افتح الرابط المطلوب
                          </a>
                        ) : null}
                      </div>
                    )
                  }

                  if (field.type === 'boolean') {
                    return (
                      <label key={field.key} htmlFor={fieldId} className="flex cursor-pointer items-start gap-2 rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink">
                        <input
                          id={fieldId}
                          type="checkbox"
                          checked={value === true}
                          onChange={(event) => onAnswerChange(form.id, field.key, event.target.checked)}
                          className="mt-0.5 h-4 w-4 accent-relay"
                        />
                        <span>
                          <span className="font-semibold">{title}</span>
                          {field.required ? <span className="me-1 text-review-ink">*</span> : null}
                          {description ? <span className="mt-0.5 block text-xs leading-relaxed text-ink-soft">{description}</span> : null}
                        </span>
                      </label>
                    )
                  }

                  if (field.type === 'multiselect') {
                    const selected = Array.isArray(value) ? value : []
                    return (
                      <fieldset key={field.key} className="rounded-md border border-line bg-paper px-3 py-2">
                        <legend className="px-1 text-sm font-semibold text-ink">
                          {title}
                          {field.required ? <span className="me-1 text-review-ink">*</span> : null}
                        </legend>
                        {description ? <p className="mb-2 text-xs leading-relaxed text-ink-soft">{description}</p> : null}
                        <div className="space-y-1.5">
                          {(field.options ?? []).map((option) => {
                            const checked = selected.includes(option.value)
                            return (
                              <label key={option.value} className="flex cursor-pointer items-start gap-2 text-sm text-ink">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(event) => {
                                    const next = event.target.checked
                                      ? [...selected, option.value]
                                      : selected.filter((entry) => entry !== option.value)
                                    onAnswerChange(form.id, field.key, next)
                                  }}
                                  className="mt-0.5 h-4 w-4 accent-relay"
                                />
                                <span>
                                  {option.label}
                                  {option.description ? <span className="mt-0.5 block text-xs text-ink-soft">{option.description}</span> : null}
                                </span>
                              </label>
                            )
                          })}
                        </div>
                      </fieldset>
                    )
                  }

                  const isNumeric = field.type === 'number' || field.type === 'integer'
                  const optionsId = `${fieldId}-options`
                  const stringValue = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
                  const control = field.options && field.options.length > 0 && !field.custom ? (
                    <select
                      id={fieldId}
                      value={stringValue}
                      required={field.required}
                      onChange={(event) => onAnswerChange(form.id, field.key, event.target.value)}
                      className="mt-1.5 w-full rounded-md border border-line-strong bg-card px-3 py-2 text-sm text-ink"
                    >
                      <option value="">اختر إجابة…</option>
                      {field.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <>
                      <input
                        id={fieldId}
                        type={isNumeric ? 'number' : 'text'}
                        step={field.type === 'integer' ? '1' : undefined}
                        value={stringValue}
                        required={field.required}
                        list={!isNumeric && field.options && field.options.length > 0 ? optionsId : undefined}
                        placeholder={field.placeholder}
                        onChange={(event) => {
                          const next = event.target.value
                          onAnswerChange(form.id, field.key, isNumeric && next !== '' ? Number(next) : next)
                        }}
                        className="mt-1.5 w-full rounded-md border border-line-strong bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-soft/60"
                      />
                      {!isNumeric && field.options && field.options.length > 0 ? (
                        <datalist id={optionsId}>
                          {field.options.map((option) => (
                            <option key={option.value} value={option.value} label={option.label} />
                          ))}
                        </datalist>
                      ) : null}
                    </>
                  )

                  return (
                    <div key={field.key}>
                      <label htmlFor={fieldId} className="text-sm font-semibold text-ink">
                        {title}
                        {field.required ? <span className="me-1 text-review-ink">*</span> : null}
                      </label>
                      {description ? <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">{description}</p> : null}
                      {control}
                    </div>
                  )
                })}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={submitting || missingRequired}
                  aria-busy={submitting}
                  className="flex items-center justify-center gap-2 rounded-lg bg-review px-3.5 py-2 text-sm font-bold text-white transition-colors hover:bg-review-ink disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? <Spinner className="h-4 w-4" /> : <Check aria-hidden="true" className="h-4 w-4" />}
                  {submitting ? 'جارٍ إرسال التوضيح…' : 'أرسل الإجابة إلى OpenCode'}
                </button>
                {missingRequired ? <p className="text-xs text-review-ink">أكمل الحقول المطلوبة أولًا.</p> : null}
              </div>
            </form>
          )
        })}
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Conversation — human chat first, raw data behind the technical switch        */
/* -------------------------------------------------------------------------- */

const CATEGORY_LABEL: Record<ToolCategory, string> = {
  write: 'تعديل ملف',
  read: 'قراءة ملف',
  exec: 'تشغيل أمر',
  other: 'أداة',
}

function ToolBlock({ block }: { block: Extract<Block, { kind: 'tool' }> }) {
  const lines = splitLines(block.output)
  const visible = lines.slice(0, MAX_VISIBLE_LINES)
  const hidden = lines.slice(MAX_VISIBLE_LINES)
  const failed = block.status === 'error' || block.error.length > 0
  const running = block.status === 'running' || block.status === 'pending'

  const tone = failed ? 'text-review-ink' : running ? 'text-relay-ink' : 'text-ink-soft'

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-paper">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-3 py-1.5">
        <span className={cx('flex items-center gap-1.5 text-xs font-bold', tone)}>
          {block.category === 'exec' ? (
            <Terminal aria-hidden="true" className="h-3.5 w-3.5" />
          ) : block.category === 'write' ? (
            <FileCode aria-hidden="true" className="h-3.5 w-3.5" />
          ) : (
            <Cpu aria-hidden="true" className="h-3.5 w-3.5" />
          )}
          {CATEGORY_LABEL[block.category]}
        </span>
        <span className="ltr font-mono text-[11px] text-ink-soft">{block.tool}</span>
        <span className="text-[11px] text-ink-soft">
          {failed ? '· فشل' : running ? '· قيد التنفيذ' : '· اكتملت'}
        </span>
        {running ? <Spinner className="h-3 w-3 text-relay" /> : null}
      </div>

      {block.command ? (
        <p dir="ltr" className="ltr border-b border-line px-3 py-2 font-mono text-[11px] leading-relaxed break-words text-ink">
          <span aria-hidden="true" className="me-1.5 text-ready-ink">
            $
          </span>
          {block.command}
        </p>
      ) : null}

      {block.path && block.path !== block.command ? (
        <p className="flex items-center gap-1.5 border-b border-line px-3 py-1.5 text-[11px] text-ink-soft">
          <span className="font-semibold">المسار</span>
          <span className="ltr min-w-0 break-all font-mono text-ink">{block.path}</span>
        </p>
      ) : null}

      {block.error ? (
        <p className="border-b border-line px-3 py-2 text-[11px] leading-relaxed text-review-ink">{block.error}</p>
      ) : null}

      {visible.length > 0 && !(visible.length === 1 && visible[0] === '') ? (
        <pre dir="ltr" className="ltr overflow-x-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-soft">
          {snippet(visible.join('\n'))}
        </pre>
      ) : null}

      {hidden.length > 0 ? (
        <details className="group border-t border-line">
          <summary className="flex cursor-pointer list-none items-center gap-1 px-3 py-1.5 text-[11px] font-semibold text-relay">
            <ChevronDown aria-hidden="true" className="h-3 w-3 transition-transform group-open:rotate-180" />
            أظهر {arCountOf(hidden.length)} سطرًا إضافيًا من الناتج
          </summary>
          <pre dir="ltr" className="ltr overflow-x-auto border-t border-line px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-soft">
            {snippet(hidden.join('\n'))}
          </pre>
        </details>
      ) : null}
    </div>
  )
}

function TechnicalBlock({ message }: { message: NormalMessage }) {
  // Text withheld from the chat (shell transcripts) belongs here alongside the
  // reasoning/tool/step blocks, otherwise enabling the switch would lose it.
  const parts = message.blocks.filter((block) => block.kind !== 'text' || block.technical)
  const duration =
    message.completed !== null
      ? Math.max(0, Math.round((message.completed - message.created) / 1000))
      : null

  return (
    <details className="mt-2 rounded-lg border border-dashed border-line-strong bg-paper">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-ink-soft">
        <ChevronDown aria-hidden="true" className="h-3 w-3 transition-transform group-open:rotate-180" />
        تفاصيل هذه الرسالة
        <span className="ltr font-mono text-[10px] font-normal text-ink-soft/80">
          {message.id} · role={message.role} · {formatClock(message.created)}
          {duration !== null ? ` · ${duration}s` : ''}
          {message.finish ? ` · ${message.finish}` : ''}
        </span>
      </summary>

      <div className="space-y-2 border-t border-line px-3 py-2">
        {message.idle ? (
          <p className="ltr font-mono text-[11px] text-ink-soft">idle marker · {message.finish || 'no finish'}</p>
        ) : null}

        {parts.map((block) => {
          if (block.kind === 'reasoning') {
            return (
              <details key={block.id} className="group rounded-lg border border-line bg-card">
                <summary className="flex cursor-pointer list-none items-center gap-1 px-3 py-1.5 text-[11px] font-semibold text-ink-soft">
                  <ChevronDown aria-hidden="true" className="h-3 w-3 transition-transform group-open:rotate-180" />
                  تفكير OpenCode
                </summary>
                <p dir="auto" className="border-t border-line px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap text-ink-soft">
                  {block.text}
                </p>
              </details>
            )
          }
          if (block.kind === 'tool') return <ToolBlock key={block.id} block={block} />
          if (block.kind === 'patch') {
            return (
              <pre
                key={block.id}
                dir="ltr"
                className="ltr overflow-x-auto rounded-lg border border-line bg-card px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-soft"
              >
                {snippet(block.text)}
              </pre>
            )
          }
          if (block.kind === 'text') {
            return (
              <pre
                key={block.id}
                dir="ltr"
                className="ltr overflow-x-auto whitespace-pre-wrap rounded-lg border border-line bg-card px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-soft"
              >
                {snippet(block.text, MAX_RAW_RECORD_CHARS)}
              </pre>
            )
          }
          return (
            <p key={block.id} className="ltr font-mono text-[11px] text-ink-soft/80">
              — {block.label}
            </p>
          )
        })}

        {parts.length === 0 && !message.idle ? (
          <p className="text-[11px] text-ink-soft">لا توجد أجزاء تقنية في هذه الرسالة.</p>
        ) : null}
      </div>
    </details>
  )
}

function MessageRow({
  message,
  text,
  showTechnical,
  registerNode,
  highlighted,
}: {
  message: NormalMessage
  text: string
  showTechnical: boolean
  registerNode: (id: string, node: HTMLLIElement | null) => void
  highlighted: boolean
}) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  const label = isUser ? 'طلبك' : isSystem ? 'رسالة من النظام' : 'رد OpenCode'
  const accent = isUser ? 'border-s-ready' : isSystem ? 'border-s-line-strong' : 'border-s-relay'
  const labelTone = isUser ? 'text-ready-ink' : isSystem ? 'text-ink-soft' : 'text-relay-ink'

  return (
    <li
      ref={(node) => registerNode(message.id, node)}
      className={cx('scroll-mt-4 rounded-lg border border-line bg-card shadow-xs', accent, 'border-s-[3px]')}
    >
      <div className={cx('px-4 py-3', highlighted && 'bg-relay-tint/60')}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cx('flex items-center gap-1.5 text-sm font-bold', labelTone)}>
            {isUser ? (
              <Send aria-hidden="true" className="h-3.5 w-3.5" />
            ) : isSystem ? (
              <MessageSquare aria-hidden="true" className="h-3.5 w-3.5" />
            ) : (
              <Bot aria-hidden="true" className="h-3.5 w-3.5" />
            )}
            {label}
          </span>
          {message.created > 0 ? (
            <span className="flex items-center gap-1 text-[11px] text-ink-soft">
              <Clock aria-hidden="true" className="h-3 w-3" />
              <span className="ltr font-mono">{formatClock(message.created)}</span>
            </span>
          ) : null}
        </div>

        {message.error ? (
          <p role="alert" className="mt-2 rounded-lg border border-review/30 bg-review-tint px-3 py-2 text-xs leading-relaxed text-review-ink">
            فشل هذا الرد: <span dir="auto">{message.error}</span>
          </p>
        ) : null}

        {text ? (
          <p dir="auto" className="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap text-ink">
            {text}
          </p>
        ) : null}

        {showTechnical ? <TechnicalBlock message={message} /> : null}
      </div>
    </li>
  )
}

function Conversation({
  messages,
  human,
  suppressed,
  showTechnical,
  busy,
  loading,
  hasSession,
  hasAnyTask,
  registerNode,
  highlightedId,
  onScrollToLatest,
  scrollRef,
  onScroll,
}: {
  messages: NormalMessage[]
  human: Array<{ message: NormalMessage; text: string }>
  suppressed: Array<{ id: string; role: string; created: number; text: string }>
  showTechnical: boolean
  busy: boolean
  loading: boolean
  hasSession: boolean
  hasAnyTask: boolean
  registerNode: (id: string, node: HTMLLIElement | null) => void
  highlightedId: string | null
  onScrollToLatest: () => void
  scrollRef: RefObject<HTMLDivElement | null>
  onScroll: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2 sm:px-6">
        <MessageSquare aria-hidden="true" className="h-3.5 w-3.5 text-relay" />
        <h2 className="text-sm font-bold text-ink">المحادثة</h2>
        <span className="text-xs text-ink-soft">
          {arCountOf(human.length)} {arNoun(human.length, 'رسالة ظاهرة', 'رسائل ظاهرة', 'رسالة ظاهرة')}
        </span>
        <button
          type="button"
          onClick={onScrollToLatest}
          className="ms-auto flex items-center gap-1.5 rounded-lg border border-line-strong bg-card px-2.5 py-1 text-xs font-semibold text-ink-soft transition-colors hover:border-relay/50 hover:text-relay"
        >
          <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
          إلى آخر رد
        </button>
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {!hasSession ? (
          <EmptyNote
            icon={<MessageSquare className="h-7 w-7" />}
            title="لم تختر مهمة بعد"
            hint={
              hasAnyTask
                ? 'اضغط على إحدى المهام في القائمة على اليسار لتبدأ، أو ابدأ مهمة جديدة منها.'
                : 'اضغط «مهمة جديدة» في القائمة على اليسار لإنشاء أول مهمة، ثم اكتب طلبك.'
            }
          />
        ) : loading && messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-ink-soft" aria-live="polite">
            <Spinner className="h-5 w-5 text-relay" />
            <p className="text-xs">جارٍ تحميل المحادثة…</p>
          </div>
        ) : human.length === 0 ? (
          <EmptyNote
            icon={<Sparkles className="h-7 w-7" />}
            title="لم تكتب طلبًا في هذه المهمة بعد"
            hint="اكتب طلبك في المربع بالأعلى واضغط «إرسال إلى OpenCode». سيظهر ردّه هنا."
          />
        ) : (
          <ul className="space-y-3">
            {human.map(({ message, text }) => (
              <MessageRow
                key={message.id}
                message={message}
                text={text}
                showTechnical={showTechnical}
                registerNode={registerNode}
                highlighted={highlightedId === message.id}
              />
            ))}
          </ul>
        )}

        {busy ? (
          <p
            aria-live="polite"
            className="mt-3 flex items-center gap-2 rounded-lg border border-relay/30 bg-relay-tint px-3 py-2 text-xs font-semibold text-relay-ink"
          >
            <Spinner className="h-3.5 w-3.5" />
            OpenCode يعمل الآن… سيظهر الرد هنا فور جاهزيته.
          </p>
        ) : null}

        {showTechnical && suppressed.length > 0 ? (
          <details className="mt-4 rounded-lg border border-dashed border-line-strong bg-card">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2.5 text-[11px] font-bold text-ink-soft">
              <Terminal aria-hidden="true" className="h-3.5 w-3.5" />
              سجلات تنفيذ خام
              <span className="font-normal text-ink-soft/80">
                {arCountOf(suppressed.length)} {arNoun(suppressed.length, 'سجل', 'سجلات', 'سجلًا')} لا تظهر في المحادثة
              </span>
            </summary>

            <ul className="border-t border-line">
              {suppressed.map((record) => (
                <li key={record.id} className="border-b border-line px-4 py-2.5 last:border-b-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-soft">
                    <span className="ltr font-mono">{formatClock(record.created)}</span>
                    <span className="ltr font-mono text-ink-soft/80">type={record.role}</span>
                    <span className="ltr font-mono text-ink-soft/60">{record.id}</span>
                  </div>
                  <pre
                    dir="ltr"
                    className="ltr mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-paper px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-soft"
                  >
                    {snippet(record.text, MAX_RAW_RECORD_CHARS)}
                  </pre>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Panels — ملخص النتيجة · الملفات التي تغيرت · ملاحظات Codex                  */
/* -------------------------------------------------------------------------- */

type PanelKey = 'summary' | 'files' | 'notes'

const PANELS: Array<{ key: PanelKey; label: string; icon: ReactNode }> = [
  { key: 'summary', label: 'ملخص النتيجة', icon: <FileText className="h-3.5 w-3.5" /> },
  { key: 'files', label: 'الملفات التي تغيرت', icon: <FileDiff className="h-3.5 w-3.5" /> },
  { key: 'notes', label: 'ملاحظات Codex', icon: <NotebookPen className="h-3.5 w-3.5" /> },
]

function PanelTabs({
  active,
  onChange,
  counts,
}: {
  active: PanelKey
  onChange: (key: PanelKey) => void
  counts: Record<PanelKey, number | null>
}) {
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const index = PANELS.findIndex((panel) => panel.key === active)
    let next = -1
    if (event.key === 'ArrowLeft') next = (index + 1) % PANELS.length
    else if (event.key === 'ArrowRight') next = (index - 1 + PANELS.length) % PANELS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = PANELS.length - 1
    if (next < 0) return
    event.preventDefault()
    onChange(PANELS[next].key)
    const nodes = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    nodes[next]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label="تفاصيل النتيجة والمراجعة"
      onKeyDown={onKeyDown}
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-card px-2 pt-2 sm:px-4"
    >
      {PANELS.map((panel) => {
        const selected = panel.key === active
        const count = counts[panel.key]
        return (
          <button
            key={panel.key}
            type="button"
            role="tab"
            id={`tab-${panel.key}`}
            aria-selected={selected}
            aria-controls={`panel-${panel.key}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(panel.key)}
            className={cx(
              'flex shrink-0 items-center gap-1.5 rounded-t-lg border border-b-0 px-3 py-2 text-xs font-bold transition-colors',
              selected
                ? 'border-line bg-paper text-ink'
                : 'border-transparent text-ink-soft hover:bg-paper/70 hover:text-ink',
            )}
          >
            {panel.icon}
            {panel.label}
            {count !== null && count > 0 ? (
              <span
                className={cx(
                  'rounded-full px-1.5 py-px text-[10px] font-bold',
                  selected ? 'bg-relay text-white' : 'bg-line text-ink-soft',
                )}
              >
                {arCountOf(count)}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

function ResultSummary({
  hasSession,
  state,
  requests,
  replies,
  lastReply,
  changedCount,
  updatedLabel,
  onJump,
}: {
  hasSession: boolean
  state: { label: string; tone: Tone }
  requests: number
  replies: number
  lastReply: { id: string; text: string } | null
  changedCount: number
  updatedLabel: string
  onJump: (id: string) => void
}) {
  if (!hasSession) {
    return (
      <EmptyNote
        icon={<FileText className="h-7 w-7" />}
        title="لا توجد مهمة بعد"
        hint="اختر مهمة من القائمة على اليسار، وستظهر هنا خلاصة ما حدث فيها."
      />
    )
  }

  return (
    <div className="space-y-4 p-4 sm:p-5">
      <p className="text-xs leading-relaxed text-ink-soft">
        هذه اللوحة تجمع النتيجة في نقاط قصيرة: أين الحالة الآن، كم طلبًا أرسلت، وما إذا تغيّرت ملفات في المشروع.
      </p>
      <dl className="grid gap-2 sm:grid-cols-2">
        <SummaryTile label="الحالة الآن" value={state.label} tone={state.tone} />
        <SummaryTile label="آخر تحديث" value={updatedLabel} />
        <SummaryTile
          label="طلبات أرسلتها"
          value={`${arCountOf(requests)} ${arNoun(requests, 'طلب', 'طلبات', 'طلبًا')}`}
        />
        <SummaryTile
          label="ردود OpenCode"
          value={`${arCountOf(replies)} ${arNoun(replies, 'رد', 'ردود', 'ردًا')}`}
        />
        <SummaryTile
          label="ملفات تغيّرت"
          value={`${arCountOf(changedCount)} ${arNoun(changedCount, 'ملف', 'ملفات', 'ملفًا')}`}
        />
      </dl>

      {lastReply ? (
        <div className="rounded-lg border border-line bg-card px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-ink">آخر رد من OpenCode</h3>
            <button
              type="button"
              onClick={() => onJump(lastReply.id)}
              className="ms-auto rounded-lg border border-line-strong px-2.5 py-1 text-xs font-semibold text-relay transition-colors hover:bg-relay-tint"
            >
              اذهب إلى الرد في المحادثة
            </button>
          </div>
          <p dir="auto" className="mt-2 text-xs leading-relaxed whitespace-pre-wrap text-ink-soft">
            {clamp(lastReply.text, 420)}
          </p>
        </div>
      ) : (
        <EmptyNote
          icon={<Sparkles className="h-7 w-7" />}
          title="لا يوجد رد بعد"
          hint="اكتب طلبك في المربع بالأعلى واضغط «إرسال إلى OpenCode». سيظهر ملخّص الرد هنا فور وصوله."
        />
      )}
    </div>
  )
}

function SummaryTile({ label, value, tone }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="rounded-lg border border-line bg-card px-3 py-2">
      <dt className="text-[11px] font-semibold text-ink-soft">{label}</dt>
      <dd className={cx('mt-0.5 text-sm font-bold', tone === 'ready' ? 'text-ready-ink' : tone === 'relay' ? 'text-relay-ink' : tone === 'review' ? 'text-review-ink' : 'text-ink')}>
        {value}
      </dd>
    </div>
  )
}

function DiffRow({ line }: { line: DiffLine }) {
  const marker = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '
  const tone =
    line.kind === 'add' ? 'bg-ready-tint text-ready-ink' : line.kind === 'del' ? 'bg-review-tint text-review-ink' : 'text-ink-soft'
  return (
    <div dir="ltr" className={cx('flex gap-1.5 px-3 py-px font-mono text-[11px] leading-relaxed', tone)}>
      <span aria-hidden="true" className="select-none opacity-70">
        {marker}
      </span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">{line.text || ' '}</span>
    </div>
  )
}

function ChangedFiles({
  diffs,
  inferred,
  loading,
  hasSession,
  showTechnical,
}: {
  diffs: FileDiff[]
  inferred: string[]
  loading: boolean
  hasSession: boolean
  showTechnical: boolean
}) {
  const [openFile, setOpenFile] = useState<string | null>(null)

  if (!hasSession) {
    return (
      <EmptyNote
        icon={<FileDiff className="h-7 w-7" />}
        title="لم تختر مهمة بعد"
        hint="اختر مهمة لتظهر هنا الملفات التي عدّلها OpenCode داخلها."
      />
    )
  }

  if (loading && diffs.length === 0 && inferred.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-ink-soft" aria-live="polite">
        <Spinner className="h-5 w-5 text-relay" />
        <p className="text-xs">جارٍ البحث عن الملفات المتأثرة…</p>
      </div>
    )
  }

  if (diffs.length === 0 && inferred.length === 0) {
    return (
      <EmptyNote
        icon={<FileDiff className="h-7 w-7" />}
        title="لم تتغيّر أي ملفات بعد"
        hint="بعد أن يرسل OpenCode طلبًا ينفّذ تعديلات، ستظهر الملفات المتأثرة هنا كدليل."
      />
    )
  }

  return (
    <div className="min-h-0 overflow-y-auto">
      <p className="border-b border-line px-4 py-2 text-xs leading-relaxed text-ink-soft sm:px-5">
        هذه قائمة الملفات التي لمسها OpenCode. كبّر أي ملف لترى التفاصيل؛ ولرؤية أسطر التغيير فعّل «التفاصيل التقنية».
      </p>

      {diffs.map((diff) => {
        const open = openFile === diff.file
        return (
          <section key={diff.file} className="border-b border-line last:border-b-0">
            <h3 className="flex items-center gap-2 px-4 py-2 sm:px-5">
              <button
                type="button"
                onClick={() => setOpenFile(open ? null : diff.file)}
                aria-expanded={open}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-start"
              >
                <ChevronRight
                  aria-hidden="true"
                  className={cx('h-3.5 w-3.5 shrink-0 text-ink-soft transition-transform', open && 'rotate-90')}
                />
                <FileCode aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-relay" />
                <span className="ltr min-w-0 flex-1 truncate font-mono text-[11px] text-ink" title={diff.file}>
                  {diff.file}
                </span>
              </button>
              <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-mono">
                <span className="flex items-center gap-0.5 text-ready-ink">
                  <Plus aria-hidden="true" className="h-2.5 w-2.5" />
                  {diff.additions}
                </span>
                <span className="flex items-center gap-0.5 text-review-ink">
                  <Minus aria-hidden="true" className="h-2.5 w-2.5" />
                  {diff.deletions}
                </span>
              </span>
            </h3>

            {open ? (
              diff.hunks.length === 0 ? (
                <p className="px-4 pb-2 text-[11px] text-ink-soft sm:px-5">
                  لا توجد أسطر تفاصيل لهذا الملف. فعّل «التفاصيل التقنية» لعرض البيانات الخام.
                </p>
              ) : showTechnical ? (
                <div className="space-y-2 border-t border-line bg-paper px-4 py-2 sm:px-5">
                  {diff.hunks.map((hunk, index) => (
                    <div key={`${diff.file}:${index}`} className="overflow-hidden rounded-lg border border-line bg-card">
                      <p dir="ltr" className="ltr border-b border-line px-3 py-1 font-mono text-[10px] text-ink-soft">
                        {hunk.header ?? `@@ -${hunk.oldStart ?? 0} +${hunk.newStart ?? 0} @@`}
                      </p>
                      {hunk.lines.map((line, lineIndex) => (
                        <DiffRow key={lineIndex} line={line} />
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-4 pb-2 text-[11px] text-ink-soft sm:px-5">
                  أخفى «التفاصيل التقنية» أسطر التغيير. فعّلها لعرض المقارنة كاملة.
                </p>
              )
            ) : null}
          </section>
        )
      })}

      {diffs.length === 0 && inferred.length > 0 ? (
        <div>
          <p className="border-b border-line px-4 py-2 text-[11px] leading-relaxed text-review-ink sm:px-5">
            لم يوفّر OpenCode مقارنة رسمية للملفات، لذا استُنتجت هذه المسارات أثناء التنفيذ وهي أدلة أقل دقة.
          </p>
          <ul className="divide-y divide-line">
            {inferred.slice(0, 60).map((file) => (
              <li key={file} className="flex items-center gap-2 px-4 py-2 sm:px-5">
                <FileCode aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-review" />
                <span className="ltr min-w-0 flex-1 truncate font-mono text-[11px] text-ink" title={file}>
                  {file}
                </span>
              </li>
            ))}
          </ul>
          {inferred.length > 60 ? (
            <p className="px-4 py-2 text-[11px] text-ink-soft sm:px-5">و{arCountOf(inferred.length - 60)} مسارًا آخر.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

const EVENT_ROLE_LABEL: Record<string, string> = {
  codex: 'Codex',
  opencode: 'OpenCode',
  operator: 'أنت',
  system: 'النظام',
}

const EVENT_KIND_LABEL: Record<string, string> = {
  'review-note': 'ملاحظة مراجعة',
  delegated: 'تفويض مهمة',
  'session-opened': 'فتح مهمة',
  note: 'ملاحظة',
}

function CodexNotes({
  events,
  note,
  onNoteChange,
  onSubmit,
  submitting,
  error,
  selectedId,
  hasSession,
}: {
  events: RelayEvent[]
  note: string
  onNoteChange: (value: string) => void
  onSubmit: () => void
  submitting: boolean
  error: string | null
  selectedId: string | null
  hasSession: boolean
}) {
  const ordered = useMemo(
    () => [...events].sort((a, b) => (asNumber(b.timestamp) ?? 0) - (asNumber(a.timestamp) ?? 0)),
    [events],
  )

  return (
    <div className="grid min-h-0 gap-0 lg:grid-cols-2">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
        className="space-y-2 border-b border-line p-4 sm:p-5 lg:border-b-0 lg:border-e"
      >
        <div>
          <h3 className="text-sm font-bold text-ink">سجّل ملاحظتك</h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            اكتب هنا حكمك على النتيجة: هل الحل كافٍ؟ وما الخطوة التالية؟ هذه الملاحظات تبقى محفوظة مع المهمة.
          </p>
        </div>
        <label htmlFor="reviewer-note" className="sr-only">
          ملاحظتك
        </label>
        <textarea
          id="reviewer-note"
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          rows={4}
          maxLength={5000}
          disabled={submitting}
          aria-describedby={error ? 'reviewer-note-error' : undefined}
          aria-invalid={error ? true : undefined}
          placeholder="مثال: الحل صحيح، لكنه يحتاج اختبارًا للحالة الفارغة. الخطوة التالية: تحديث التوثيق."
          className="w-full resize-y rounded-lg border border-line-strong bg-card px-3 py-2 text-sm leading-relaxed text-ink placeholder:text-ink-soft/60"
        />
        {error ? (
          <p id="reviewer-note-error" role="alert" className="text-xs leading-relaxed text-review-ink">
            لم تُحفظ الملاحظة: {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={submitting || !note.trim()}
          aria-busy={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-3 py-2.5 text-sm font-bold text-white transition-colors hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? <Spinner className="h-4 w-4" /> : <Check aria-hidden="true" className="h-4 w-4" />}
          {submitting ? 'جارٍ الحفظ…' : 'احفظ الملاحظة'}
        </button>
        {!hasSession ? (
          <p className="text-[11px] leading-relaxed text-ink-soft">
            لم تختر مهمة بعد؛ ستُحفظ الملاحظة كملاحظة عامة بدل ربطها بمهمة.
          </p>
        ) : null}
      </form>

      <div>
        <h3 className="border-b border-line px-4 py-2 text-xs font-bold text-ink-soft sm:px-5">
          سجلّ ما جرى في هذه المهمة
        </h3>
        {ordered.length === 0 ? (
          <EmptyNote
            icon={<NotebookPen className="h-7 w-7" />}
            title="لا يوجد سجل بعد"
            hint="ستظهر هنا ملاحظات Codex وطلباتك التي أرسلتها، الأحدث أولًا."
          />
        ) : (
          <ol>
            {ordered.map((event) => {
              const forSelection = !event.sessionId || event.sessionId === selectedId
              const roleLabel = EVENT_ROLE_LABEL[event.role] ?? 'النظام'
              const kindLabel = EVENT_KIND_LABEL[event.kind]
              return (
                <li key={event.id} className="border-b border-line px-4 py-2.5 last:border-b-0 sm:px-5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="rounded-full bg-line px-2 py-0.5 text-[10px] font-bold text-ink">{roleLabel}</span>
                    <span className={cx('text-[11px] text-ink-soft', !kindLabel && 'ltr')}>{kindLabel ?? event.kind}</span>
                    <span className="ltr ms-auto shrink-0 font-mono text-[11px] text-ink-soft">
                      {formatClock(asNumber(event.timestamp) ?? 0)}
                    </span>
                  </div>
                  <p dir="auto" className={cx('mt-1 text-xs leading-relaxed', forSelection ? 'text-ink' : 'text-ink-soft/80')}>
                    {event.message}
                  </p>
                  {event.sessionId && !forSelection ? (
                    <p className="ltr mt-1 font-mono text-[10px] text-ink-soft/70">{shortId(event.sessionId)}</p>
                  ) : null}
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* App                                                                        */
/* -------------------------------------------------------------------------- */

export default function App() {
  /* Selection + manual retry ---------------------------------------------- */
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedOverride, setSelectedOverride] = useState<Session | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const [showTechnical, setShowTechnical] = useState(false)
  const [panel, setPanel] = useState<PanelKey>('summary')
  const [highlightedId, setHighlightedId] = useState<string | null>(null)

  /* Pollers --------------------------------------------------------------- */
  const health = usePoller<HealthPayload>(`health:${refreshTick}`, () => api<HealthPayload>('/api/health'), 2500, true)

  const sessionsPoll = usePoller<Session[]>(
    `sessions:${refreshTick}`,
    async () => unwrapList<Session>(await api<unknown>('/api/sessions')),
    2500,
    true,
  )

  const eventsPoll = usePoller<RelayEvent[]>(
    `events:${refreshTick}`,
    async () => unwrapList<RelayEvent>(await api<unknown>('/api/relay-events')),
    2500,
    true,
  )

  const messagesPoll = usePoller<NormalMessage[]>(
    `messages:${selectedId ?? 'none'}:${refreshTick}`,
    async () => (selectedId ? normalizeMessages(await api<unknown>(`/api/sessions/${selectedId}/messages`)) : []),
    2000,
    Boolean(selectedId),
  )

  const diffPoll = usePoller<FileDiff[]>(
    `diff:${selectedId ?? 'none'}:${refreshTick}`,
    async () => (selectedId ? normalizeDiffs(await api<unknown>(`/api/sessions/${selectedId}/diff`)) : []),
    2000,
    Boolean(selectedId),
  )

  const controlPoll = usePoller<SessionControl>(
    `control:${selectedId ?? 'none'}:${refreshTick}`,
    async () =>
      selectedId
        ? normalizeControl(await api<unknown>(`/api/sessions/${selectedId}/control`))
        : { forms: [], inbox: [], active: false },
    2000,
    Boolean(selectedId),
  )

  /* Action state ---------------------------------------------------------- */
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [sending, setSending] = useState(false)
  const [promptError, setPromptError] = useState<string | null>(null)
  const [promptReceipt, setPromptReceipt] = useState<string | null>(null)
  const [formAnswers, setFormAnswers] = useState<Record<string, Record<string, FormValue>>>({})
  const [replyingForm, setReplyingForm] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [noting, setNoting] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const sessions = sessionsPoll.data ?? []
  const events = eventsPoll.data ?? []
  const messages = messagesPoll.data ?? []
  const diffs = diffPoll.data ?? []
  const control = controlPoll.data ?? { forms: [], inbox: [], active: false }

  /* Keep a clock for the "updated" labels ---------------------------------- */
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  /* Selection bookkeeping ------------------------------------------------- */
  useEffect(() => {
    if (selectedId && sessions.some((session) => session.id === selectedId)) {
      setSelectedOverride(null)
      return
    }
    if (sessions.length > 0) {
      setSelectedId(sessions[0].id)
    } else if (selectedId) {
      setSelectedId(null)
    }
  }, [sessions, selectedId])

  const selectedSession = useMemo(() => {
    const found = sessions.find((session) => session.id === selectedId)
    if (found) return found
    if (selectedOverride?.id === selectedId) return selectedOverride
    return null
  }, [sessions, selectedId, selectedOverride])

  const hasSession = Boolean(selectedId)
  const title = selectedSession?.title?.trim() || (selectedId ? 'مهمة بلا عنوان' : 'لا توجد مهمة مفتوحة')

  /* Derived evidence ------------------------------------------------------ */
  const inferredPaths = useMemo(() => inferWrittenPaths(messages), [messages])
  const changedCount = diffs.length > 0 ? diffs.length : inferredPaths.length

  // The default conversation is human-level only: real requests and real
  // OpenCode answers. Synthetic shell/process records and shell transcripts are
  // withheld here and surfaced under "التفاصيل التقنية" instead.
  const human = useMemo(() => {
    const out: Array<{ message: NormalMessage; text: string }> = []
    for (const message of messages) {
      if (message.idle || message.synthetic || (message.role !== 'user' && message.role !== 'assistant')) continue
      const pieces: string[] = []
      for (const block of message.blocks) {
        if (block.kind === 'text' && !block.technical && block.text.trim()) pieces.push(block.text)
      }
      const text = pieces.join('\n\n')
      if (!text && !message.error) continue
      out.push({ message, text })
    }
    return out
  }, [messages])

  // Nothing is thrown away: the withheld records are collected here so the
  // technical area can show them.
  const suppressed = useMemo(() => {
    const out: Array<{ id: string; role: string; created: number; text: string }> = []
    for (const message of messages) {
      if (message.idle || !message.synthetic) continue
      const pieces: string[] = []
      for (const block of message.blocks) {
        if (block.kind === 'text' && block.text.trim()) pieces.push(block.text)
      }
      out.push({ id: message.id, role: message.role, created: message.created, text: pieces.join('\n\n') })
    }
    return out
  }, [messages])

  const requests = human.filter((entry) => entry.message.role === 'user').length
  const replies = human.filter((entry) => entry.message.role === 'assistant').length
  const lastReply = useMemo(() => {
    for (let index = human.length - 1; index >= 0; index -= 1) {
      const entry = human[index]
      if (entry.message.role === 'assistant' && entry.text) {
        return { id: entry.message.id, text: entry.text }
      }
    }
    return null
  }, [human])

  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : undefined
  const needsInput = control.forms.length > 0
  const queued = control.inbox.length > 0
  const busy = !needsInput && Boolean(
    control.active || (lastMessage && lastMessage.role === 'assistant' && lastMessage.blocks.length > 0 && lastMessage.completed === null),
  )
  const waiting = Boolean(lastMessage && lastMessage.role === 'user' && !queued)
  const failed = Boolean(human.length > 0 && human[human.length - 1].message.error)

  const state = useMemo(
    () => taskStateOf({ hasSession, replies, busy, waiting, needsInput, queued, failed }),
    [hasSession, replies, busy, waiting, needsInput, queued, failed],
  )

  const stepIndex = !hasSession ? 0 : replies > 0 ? 2 : 1
  const updatedAt = controlPoll.updatedAt ?? messagesPoll.updatedAt ?? sessionsPoll.updatedAt

  /* Transcript scroll pinning -------------------------------------------- */
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stickRef = useRef(true)
  const nodesRef = useRef(new Map<string, HTMLLIElement>())
  const signature = useMemo(
    () => `${selectedId ?? 'none'}|${messages.length}|${lastMessage?.id ?? ''}|${lastMessage?.blocks.length ?? 0}`,
    [selectedId, messages, lastMessage],
  )

  const registerNode = useCallback((id: string, node: HTMLLIElement | null) => {
    if (node) nodesRef.current.set(id, node)
    else nodesRef.current.delete(id)
  }, [])

  const scrollToLatest = useCallback(() => {
    const node = scrollRef.current
    if (!node) return
    stickRef.current = true
    node.scrollTop = node.scrollHeight
  }, [])

  const jumpToMessage = useCallback((id: string) => {
    const node = nodesRef.current.get(id)
    if (!node) return
    stickRef.current = false
    node.scrollIntoView({ block: 'center' })
    setHighlightedId(id)
    window.setTimeout(() => setHighlightedId(null), 2400)
  }, [])

  useEffect(() => {
    if (selectedId) {
      stickRef.current = true
      setHighlightedId(null)
    }
    setPromptError(null)
    setPromptReceipt(null)
    setFormError(null)
    setFormAnswers({})
  }, [selectedId])

  useEffect(() => {
    const node = scrollRef.current
    if (!node || !stickRef.current) return
    node.scrollTop = node.scrollHeight
  }, [signature])

  const onTranscriptScroll = useCallback(() => {
    const node = scrollRef.current
    if (!node) return
    stickRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 96
  }, [])

  /* Actions --------------------------------------------------------------- */
  const retryAll = useCallback(() => setRefreshTick((tick) => tick + 1), [])

  const createSession = useCallback(async (taskTitle: string) => {
    setCreating(true)
    setCreateError(null)
    try {
      const created = await api<{ data?: Session }>('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ title: taskTitle }),
      })
      const session = created.data
      if (session?.id) {
        setSelectedOverride(session)
        setSelectedId(session.id)
      }
    } catch (error) {
      setCreateError(errorMessage(error))
    } finally {
      setCreating(false)
    }
  }, [])

  const sendPrompt = useCallback(async () => {
    const text = prompt.trim()
    if (!selectedId || !text || sending) return
    setSending(true)
    setPromptError(null)
    setPromptReceipt(null)
    try {
      const receipt = await api<{ acknowledged?: boolean; delivery?: string }>(`/api/sessions/${selectedId}/prompt`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      })
      if (receipt.acknowledged !== true || receipt.delivery !== 'queue') {
        throw new Error('OpenCode did not confirm that it queued the task.')
      }
      setPrompt('')
      stickRef.current = true
      setPromptReceipt('OpenCode أكد حفظ الطلب في طابوره. ستتغير الحالة هنا عند بدء التنفيذ.')
      setRefreshTick((tick) => tick + 1)
    } catch (error) {
      setPromptError(errorMessage(error))
    } finally {
      setSending(false)
    }
  }, [prompt, selectedId, sending])

  const updateFormAnswer = useCallback((formId: string, field: string, value: FormValue) => {
    setFormAnswers((previous) => ({
      ...previous,
      [formId]: { ...(previous[formId] ?? {}), [field]: value },
    }))
  }, [])

  const submitForm = useCallback(
    async (form: OpenCodeForm) => {
      if (!selectedId || replyingForm) return
      const answer = formAnswers[form.id] ?? {}
      setReplyingForm(form.id)
      setFormError(null)
      try {
        await api<unknown>(`/api/sessions/${selectedId}/forms/${form.id}/reply`, {
          method: 'POST',
          body: JSON.stringify({ answer }),
        })
        setFormAnswers((previous) => {
          const next = { ...previous }
          delete next[form.id]
          return next
        })
        stickRef.current = true
        setRefreshTick((tick) => tick + 1)
      } catch (error) {
        setFormError(errorMessage(error))
      } finally {
        setReplyingForm(null)
      }
    },
    [formAnswers, replyingForm, selectedId],
  )

  const submitNote = useCallback(async () => {
    const message = note.trim()
    if (!message || noting) return
    setNoting(true)
    setNoteError(null)
    try {
      await api<unknown>('/api/relay-events', {
        method: 'POST',
        body: JSON.stringify({ role: 'codex', kind: 'review-note', message, sessionId: selectedId ?? undefined }),
      })
      setNote('')
    } catch (error) {
      setNoteError(errorMessage(error))
    } finally {
      setNoting(false)
    }
  }, [note, noting, selectedId])

  /* Live announcements ---------------------------------------------------- */
  const announcement =
    messagesPoll.error ?? diffPoll.error ?? controlPoll.error ?? sessionsPoll.error ?? eventsPoll.error ?? health.data?.error ?? null

  const offline = health.data?.online === false
  const selectionNotes = events.filter((event) => !event.sessionId || event.sessionId === selectedId).length

  return (
    <div
      dir="rtl"
      lang="ar"
      className="flex min-h-dvh flex-col bg-paper text-ink lg:h-dvh lg:overflow-hidden"
    >
      {/* Header ------------------------------------------------------------ */}
      <header className="shrink-0 border-b border-line bg-card">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-relay/30 bg-relay-tint text-relay"
          >
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-base font-bold leading-tight text-ink">غرفة التسليم</p>
            <p className="text-xs leading-tight text-ink-soft">أنت تكتب المهمة، OpenCode ينفّذها، وCodex يراجع النتيجة.</p>
          </div>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <Pill tone={offline ? 'review' : health.status === 'loading' ? 'muted' : 'ready'}>
              {offline ? (
                <WifiOff aria-hidden="true" className="h-3.5 w-3.5" />
              ) : (
                <Wifi aria-hidden="true" className="h-3.5 w-3.5" />
              )}
              {offline ? 'غير متصل بـ OpenCode' : health.status === 'loading' ? 'جارٍ الاتصال…' : 'OpenCode متصل'}
            </Pill>
            <Pill tone="muted">
              <RefreshCw aria-hidden="true" className="h-3 w-3" />
              آخر تحديث {formatRelative(updatedAt, now)}
            </Pill>
          </div>
        </div>

        <p className="sr-only" aria-live="polite">
          {announcement ? `تعذّر التحديث: ${announcement}` : `آخر تحديث ${formatRelative(updatedAt, now)}.`}
        </p>

        {announcement ? <ErrorNote message={announcement} onRetry={retryAll} /> : null}
      </header>

      <StepReceipt current={stepIndex} />

      {/* Body: one narrow «المهام» sidebar (left) plus the primary work area (right). */}
      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,17rem)]">
        <TaskSidebar
          sessions={sessions}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedOverride(null)
            setSelectedId(id)
            stickRef.current = true
          }}
          status={sessionsPoll.status}
          error={sessionsPoll.error}
          onRetry={retryAll}
          onCreate={(value) => void createSession(value)}
          creating={creating}
          createError={createError}
        />

        <section aria-label="مساحة العمل" className="flex min-h-0 min-w-0 flex-col lg:order-1">
          <TaskHeader
            title={title}
            state={state}
            updatedLabel={hasSession ? `آخر نشاط ${formatRelative(updatedAt, now)}` : 'لم تبدأ أي مهمة'}
            showTechnical={showTechnical}
            onToggleTechnical={() => setShowTechnical((value) => !value)}
            session={selectedSession}
            root={health.data?.root}
            messageCount={messages.length}
            requestCount={requests}
          />

          {messagesPoll.error ? <ErrorNote message={messagesPoll.error} onRetry={retryAll} /> : null}
          {diffPoll.error ? <ErrorNote message={diffPoll.error} onRetry={retryAll} /> : null}
          {controlPoll.error ? <ErrorNote message={controlPoll.error} onRetry={retryAll} /> : null}

          <PendingForms
            forms={control.forms}
            answers={formAnswers}
            onAnswerChange={updateFormAnswer}
            onSubmit={(form) => void submitForm(form)}
            submittingForm={replyingForm}
            error={formError}
          />

          <Composer
            value={prompt}
            onChange={setPrompt}
            onSubmit={() => void sendPrompt()}
            disabled={!hasSession || needsInput}
            disabledHint={
              !hasSession
                ? 'اختر مهمة من قائمة «المهام» أولًا، ثم اكتب طلبك هنا.'
                : 'أجب عن أسئلة OpenCode بالأعلى أولًا؛ لا ترسل رسالة جديدة بدل الإجابة المطلوبة.'
            }
            sending={sending}
            error={promptError}
            receipt={promptReceipt}
          />

          <Conversation
            messages={messages}
            human={human}
            suppressed={suppressed}
            showTechnical={showTechnical}
            busy={busy}
            loading={messagesPoll.status === 'loading'}
            hasSession={hasSession}
            hasAnyTask={sessions.length > 0}
            registerNode={registerNode}
            highlightedId={highlightedId}
            onScrollToLatest={scrollToLatest}
            scrollRef={scrollRef}
            onScroll={onTranscriptScroll}
          />

          {/* Result & review panels ---------------------------------------- */}
          <div className="flex max-h-[46vh] min-h-0 shrink-0 flex-col border-t border-line bg-card lg:max-h-[42vh]">
            <PanelTabs
              active={panel}
              onChange={setPanel}
              counts={{ summary: null, files: changedCount, notes: selectionNotes }}
            />
            <div
              role="tabpanel"
              id={`panel-${panel}`}
              aria-labelledby={`tab-${panel}`}
              tabIndex={0}
              className="min-h-0 flex-1 overflow-y-auto bg-paper"
            >
              {panel === 'summary' ? (
                <ResultSummary
                  hasSession={hasSession}
                  state={state}
                  requests={requests}
                  replies={replies}
                  lastReply={lastReply}
                  changedCount={changedCount}
                  updatedLabel={formatRelative(updatedAt, now)}
                  onJump={jumpToMessage}
                />
              ) : null}

              {panel === 'files' ? (
                <ChangedFiles
                  diffs={diffs}
                  inferred={inferredPaths}
                  loading={diffPoll.status === 'loading' && messagesPoll.status === 'loading'}
                  hasSession={hasSession}
                  showTechnical={showTechnical}
                />
              ) : null}

              {panel === 'notes' ? (
                <CodexNotes
                  events={events}
                  note={note}
                  onNoteChange={setNote}
                  onSubmit={() => void submitNote()}
                  submitting={noting}
                  error={noteError}
                  selectedId={selectedId}
                  hasSession={hasSession}
                />
              ) : null}
            </div>
          </div>
        </section>
      </main>

      {/* Status bar --------------------------------------------------------- */}
      <footer className="shrink-0 border-t border-line bg-card px-4 py-2 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-soft">
          <span>
            {arCountOf(sessions.length)} {arNoun(sessions.length, 'مهمة', 'مهام', 'مهمة')} في القائمة
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className={cx('h-1.5 w-1.5 rounded-full', offline ? 'bg-review' : 'bg-ready')} />
            {offline ? 'الخادم يعمل لكن OpenCode لا يرد' : 'الاتصال بـ OpenCode يعمل'}
          </span>
          <span>الصفحة تتحدّث نفسها تلقائيًا</span>
          <button
            type="button"
            onClick={retryAll}
            className="ms-auto flex items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1 font-semibold text-ink-soft transition-colors hover:border-relay/50 hover:text-relay"
          >
            <RefreshCw aria-hidden="true" className="h-3 w-3" />
            حدّث الآن
          </button>
        </div>
      </footer>
    </div>
  )
}
