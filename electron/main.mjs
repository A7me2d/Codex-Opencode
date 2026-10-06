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
  await window.loadURL(serverUrl)
  return window
}

app.whenReady().then(async () => {
  try {
    await startBackend()
    await createWindow()
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

