/**
 * Runs the API and the Vite dev server together, from one command.
 *
 * Both halves are plain child processes, so no extra dependency is needed and
 * this behaves the same on Windows and POSIX.
 *
 * Children are spawned without a shell, and killed as a process tree. Spawning
 * the `.bin` shim with `shell: true` looks simpler, but it leaves the real
 * server (a grandchild of the shell) orphaned and still holding its port once
 * this script exits. Resolving the real entry point keeps Ctrl+C honest.
 */
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const projectDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)

/** The JavaScript entry point of an installed package's CLI, if it has one. */
function resolveBinEntry(packageName, binName) {
  try {
    const manifestPath = require.resolve(`${packageName}/package.json`)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const relative = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[binName]
    if (!relative) return null
    return path.join(path.dirname(manifestPath), relative)
  } catch {
    return null
  }
}

const children = []
let stopping = false

function stopAll(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (child.killed || child.exitCode !== null) continue
    if (process.platform === 'win32') {
      // A group leader killed on its own can leave the real server running with
      // its port still held, so take the whole tree.
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill() }
    }
  }
  process.exit(code)
}

function run(label, entry, args) {
  const child = spawn(entry.command, [...entry.args, ...args], {
    cwd: projectDirectory,
    env: process.env,
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const prefix = `[${label}] `
  const forward = (stream, sink) => {
    stream.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim()) sink.write(prefix + line + '\n')
      }
    })
  }
  forward(child.stdout, process.stdout)
  forward(child.stderr, process.stderr)

  child.on('error', (error) => {
    process.stderr.write(`${prefix}could not start: ${error.message}\n`)
    stopAll(1)
  })
  child.on('exit', (code) => {
    process.stdout.write(`${prefix}stopped (code ${code ?? 0})\n`)
    stopAll(code ?? 0)
  })

  children.push(child)
  return child
}

process.on('SIGINT', () => stopAll(0))
process.on('SIGTERM', () => stopAll(0))

const viteEntry = resolveBinEntry('vite', 'vite')
if (!viteEntry) {
  process.stderr.write('dev:all could not locate vite. Run npm install first.\n')
  process.exit(1)
}

run('api', { command: process.execPath, args: ['--watch', 'server.mjs'] }, [])
run('web', { command: process.execPath, args: [viteEntry] }, [])
