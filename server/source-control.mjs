import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpath, readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const execute = promisify(execFile)
const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
const cleanError = text => String(text).replace(/https?:\/\/\S+/g, '[remote]').replace(/(token|password|authorization)[=:]\s*\S+/gi, '$1=[redacted]').slice(0, 1200)
export async function runGit(root, args, timeout = 20_000) {
  try {
    return (await execute('git', ['--literal-pathspecs', ...args], { cwd: root, windowsHide: true, shell: false,
      encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never', GIT_OPTIONAL_LOCKS: '0' } })).stdout
  } catch (error) {
    if (error.code === 'ENOENT') fail(503, 'Git is not installed or is not on PATH.')
    fail(409, cleanError(error.stderr || 'Git could not complete the operation. Check Git access and configuration.'))
  }
}

export function parseGitStatus(output) {
  const fields = output.split('\0'), entries = []
  for (let i = 0; i < fields.length; i++) {
    const record = fields[i]
    if (!record) continue
    const x = record[0], y = record[1], filePath = record.slice(3)
    const originalPath = /[RC]/.test(x + y) ? fields[++i] : undefined
    const conflict = x === 'U' || y === 'U' || x + y === 'AA' || x + y === 'DD'
    entries.push({ path: filePath, originalPath, index: x, worktree: y, conflict,
      staged: !conflict && x !== ' ' && x !== '?', changed: conflict || y !== ' ' || x === '?' })
  }
  return entries
}

export class SourceControl {
  constructor(run = runGit) { this.run = run; this.locks = new Set() }
  async repository(workRoot, requestedRoot) {
    if (requestedRoot && path.resolve(requestedRoot) !== path.resolve(workRoot)) fail(409, 'The project changed. Refresh Source Control.')
    const root = await realpath(workRoot)
    const repository = await realpath((await this.run(root, ['rev-parse', '--show-toplevel'])).trim())
    if (root !== repository) fail(409, 'Open the repository root folder to use Source Control.')
    return root
  }
  async snapshot(root) {
    const [status, branch, remotes, raw] = await Promise.all([
      this.run(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
      this.run(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => ''),
      this.run(root, ['remote']), this.run(root, ['diff', '--cached', '--raw', '-z', '--no-renames']),
    ])
    const head = (await this.run(root, ['rev-parse', '--verify', 'HEAD']).catch(() => '')).trim()
    const upstream = (await this.run(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).catch(() => '')).trim()
    let ahead = 0, behind = 0
    if (upstream) {
      const counts = (await this.run(root, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])).trim().split(/\s+/)
      ahead = Number(counts[0]) || 0; behind = Number(counts[1]) || 0
    }
    return { repository: true, root, branch: branch.trim(), head, upstream, ahead, behind,
      remotes: remotes.trim().split(/\r?\n/).filter(Boolean), entries: parseGitStatus(status),
      stagedVersion: createHash('sha256').update(head + '\0' + branch + '\0' + raw).digest('hex') }
  }
  async status(workRoot, requestedRoot) {
    try { return await this.snapshot(await this.repository(workRoot, requestedRoot)) }
    catch (error) { return { repository: false, root: workRoot, error: cleanError(error.message) } }
  }
  async action(workRoot, input) {
    if (!['stage', 'unstage', 'commit', 'push', 'publish'].includes(input?.action)) fail(400, 'Unknown Source Control action.')
    if (typeof input.root !== 'string') fail(400, 'The current project is required.')
    const root = await this.repository(workRoot, input.root)
    if (this.locks.has(root)) fail(409, 'A Source Control operation is already running.')
    this.locks.add(root)
    try {
      const current = await this.snapshot(root)
      if (input.action === 'stage' || input.action === 'unstage') {
        const available = current.entries.filter(entry => input.action === 'stage' ? entry.changed : entry.staged)
        if (!Array.isArray(input.paths) || !input.paths.length || input.paths.length > 10000) fail(400, 'Select files to stage or unstage.')
        const selected = input.paths.map(filePath => available.find(entry => entry.path === filePath))
        if (selected.some(entry => !entry)) fail(409, 'The changed files moved. Refresh Source Control.')
        const paths = [...new Set(selected.flatMap(entry => [entry.path, ...(entry.originalPath ? [entry.originalPath] : [])]))]
        if (input.action === 'stage') await this.run(root, ['add', '-A', '--', ...paths])
        else if (current.head) await this.run(root, ['restore', '--staged', '--', ...paths])
        else await this.run(root, ['rm', '--cached', '--ignore-unmatch', '--', ...paths])
      } else if (input.action === 'commit') {
        if (typeof input.message !== 'string' || !input.message.trim() || input.message.length > 10000 || input.message.includes('\0')) fail(400, 'Enter a commit message.')
        if (current.entries.some(entry => entry.conflict)) fail(409, 'Resolve Merge Changes before committing.')
        if (!current.entries.some(entry => entry.staged)) fail(409, 'Stage Changes before committing.')
        if (input.stagedVersion !== current.stagedVersion) fail(409, 'Staged Changes changed. Refresh and review them before Commit.')
        await this.run(root, ['commit', '-m', input.message.trim()], 120_000)
      } else {
        if (!current.branch || !current.head) fail(409, 'Create a commit on a branch before Push.')
        if (input.head !== current.head || input.branch !== current.branch) fail(409, 'The branch changed. Refresh Source Control before Push.')
        let remote, ref
        if (input.action === 'publish') {
          if (!current.remotes.includes(input.remote)) fail(400, 'Choose a configured remote before Publish Branch.')
          if (current.upstream) fail(409, 'This branch is already published. Use Push.')
          remote = input.remote; ref = `refs/heads/${current.branch}`
        } else {
          if (!current.upstream) fail(409, 'Use Publish Branch to set an upstream first.')
          remote = (await this.run(root, ['config', '--get', `branch.${current.branch}.remote`])).trim()
          ref = (await this.run(root, ['config', '--get', `branch.${current.branch}.merge`])).trim()
          if (!current.remotes.includes(remote) || !ref.startsWith('refs/heads/')) fail(409, 'The upstream remote is not configured for Push.')
        }
        await this.run(root, ['push', ...(input.action === 'publish' ? ['--set-upstream'] : []), '--', remote, `HEAD:${ref}`], 120_000)
      }
      return await this.snapshot(root)
    } finally { this.locks.delete(root) }
  }
  async diff(workRoot, input) {
    const root = await this.repository(workRoot, input.root)
    const current = await this.snapshot(root)
    const entry = current.entries.find(entry => entry.path === input.path)
    if (!entry || (input.staged ? !entry.staged : !entry.changed)) fail(404, 'This change is no longer available. Refresh Source Control.')
    let text
    if (entry.index === '?' && !input.staged) {
      const target = await realpath(path.resolve(root, entry.path))
      const relative = path.relative(root, target)
      if (relative.startsWith('..') || path.isAbsolute(relative)) fail(403, 'The file points outside the repository.')
      if ((await stat(target)).size > 512 * 1024) fail(413, 'This file is too large to preview.')
      const bytes = await readFile(target)
      if (bytes.includes(0)) text = 'Binary file.'
      else text = `--- /dev/null\n+++ ${entry.path}\n` + bytes.toString('utf8').split(/\r?\n/).map(line => `+${line}`).join('\n')
    } else text = await this.run(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', ...(input.staged ? ['--cached'] : []), '--', entry.path, ...(entry.originalPath ? [entry.originalPath] : [])])
    return { path: entry.path, staged: Boolean(input.staged), text: text.slice(0, 512 * 1024), truncated: text.length > 512 * 1024,
      deleted: (input.staged ? entry.index : entry.worktree) === 'D' }
  }
  async commitContext(workRoot, input) {
    const root = await this.repository(workRoot, input.root)
    const current = await this.snapshot(root)
    if (current.entries.some(entry => entry.conflict)) fail(409, 'Resolve Merge Changes before generating a commit message.')
    if (!current.entries.some(entry => entry.staged)) fail(409, 'Stage Changes before generating a commit message.')
    if (input.stagedVersion !== current.stagedVersion) fail(409, 'Staged Changes changed. Refresh Source Control.')
    const diff = await this.run(root, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-color'])
    if (diff.length > 120000) fail(413, 'Staged Changes are too large for AI generation. Stage a smaller commit.')
    if ((await this.snapshot(root)).stagedVersion !== current.stagedVersion) fail(409, 'Staged Changes changed. Refresh Source Control.')
    return { root, diff, stagedVersion: current.stagedVersion }
  }
}
