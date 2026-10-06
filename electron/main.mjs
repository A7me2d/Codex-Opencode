import { app, BrowserWindow, dialog, shell, utilityProcess } from 'electron'
import path from 'node:path'

let backend
let serverUrl
let quitting = false
let quitAfterBackend = false

// Keep the existing session state folder stable across this product rename.
app.setPath('userData', path.join(app.getPath('appData'), 'Relay Room'))

function startBackend() {
  const serverPath = path.join(app.getAppPath(), 'server.mjs')
  const stateDirectory = path.join(app.getPath('userData'), 'relay-state')
  const workingDirectory = process.env.WATCH_ROOT || app.getPath('documents')
  backend = utilityProcess.fork(serverPath, [], {
    cwd: app.getAppPath(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      OPENCODE_OBSERVER_PORT: '0',
      RELAY_STATE_DIR: stateDirectory,
      WATCH_ROOT: workingDirectory,
    },
    stdio: 'pipe',
  })
  backend.stdout?.on('data', chunk => console.log(`[Relay Room] ${chunk}`))
  backend.stderr?.on('data', chunk => console.error(`[Relay Room] ${chunk}`))

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Relay Room server did not start in time.')), 30_000)
    backend.once('message', message => {
      if (message?.type !== 'ready' || !message.port) return
      clearTimeout(timeout)
      serverUrl = `http://127.0.0.1:${message.port}`
      resolve()
    })
    backend.once('exit', code => {
      clearTimeout(timeout)
      if (!serverUrl) reject(new Error(`Relay Room server exited during startup (code ${code}).`))
      else if (!quitting) void showBackendFailure(`Relay Room server stopped unexpectedly (code ${code}).`)
    })
  })
}

async function showBackendFailure(message) {
  await dialog.showMessageBox({ type: 'error', title: 'Coding Room', message })
  app.quit()
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: '#f4f6f8',
    icon: path.join(app.getAppPath(), 'build', 'app.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  const loadingPage = `<!doctype html><html lang="ar"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Coding Room</title><style>body{margin:0;height:100vh;display:grid;place-items:center;background:#211f3f;color:#f8f9ff;font:15px system-ui,sans-serif}.card{text-align:center}.mark{width:72px;height:72px;border-radius:22px;background:#71e3cf;color:#211f3f;display:grid;place-items:center;margin:auto auto 18px;font-size:28px;font-weight:800}.spinner{width:17px;height:17px;border:2px solid #ffffff40;border-top-color:#71e3cf;border-radius:50%;display:inline-block;vertical-align:middle;margin-inline-end:8px;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}</style><body><main class="card"><div class="mark">&lt;/&gt;</div><strong>Coding Room</strong><p><span class="spinner"></span>جاري تجهيز مساحة العمل…</p></main></body></html>`
  await window.loadURL(serverUrl ?? `data:text/html;charset=utf-8,${encodeURIComponent(loadingPage)}`)
  return window
}

app.whenReady().then(async () => {
  const window = await createWindow()
  try {
    await startBackend()
    await window.loadURL(serverUrl)
  } catch (error) {
    await showBackendFailure(error instanceof Error ? error.message : String(error))
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && serverUrl) void createWindow()
})

app.on('before-quit', event => {
  if (quitAfterBackend || !backend) return
  event.preventDefault()
  if (quitting) return
  quitting = true
  const service = backend
  const finish = () => {
    if (quitAfterBackend) return
    quitAfterBackend = true
    backend = undefined
    app.quit()
  }
  service.once('exit', finish)
  service.postMessage({ type: 'shutdown' })
  setTimeout(() => {
    service.kill()
    setTimeout(finish, 2_000)
  }, 5_000)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

