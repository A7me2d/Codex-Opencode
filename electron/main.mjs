import { hostname } from 'node:os'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, safeStorage, shell, utilityProcess } from 'electron'
import { spawn as spawnPty } from 'node-pty'
import electronUpdater from 'electron-updater'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'

Menu.setApplicationMenu(null)

let backend
let serverUrl
let quitting = false
let quitAfterBackend = false
const terminals = new Map()
let mainWindow
let mandatoryUpdatePending = false
const { autoUpdater } = electronUpdater

// Keep the existing session state folder stable across this product rename.
app.setPath('userData', path.join(app.getPath('appData'), 'Relay Room'))
const preferencesPath = path.join(app.getPath('userData'), 'ui-preferences.json')
const licensePath = path.join(app.getPath('userData'), 'license.bin')
const deviceIdPath = path.join(app.getPath('userData'), 'device-id')
const licenseApi = 'https://license-console-mauve.vercel.app/api/license'
const allowedPreferenceKeys = new Set([
  'coding-room-support-token',
  'coding-room-support-name',
  'relay-room.theme',
  'coding-room.locale',
  'relay-room.file-icon-theme',
  'relay-room.panel-sizes',
  'relay-room.handoff-visible',
])
let preferenceWriteQueue = Promise.resolve()
let licenseToken = ''
let licenseDeviceId = ''

async function readLicense() {
  try { licenseDeviceId = (await fs.promises.readFile(deviceIdPath, 'utf8')).trim() } catch { /* created on first activation */ }
  if (!licenseDeviceId) {
    licenseDeviceId = randomUUID()
    await fs.promises.mkdir(path.dirname(deviceIdPath), { recursive: true })
    await fs.promises.writeFile(deviceIdPath, licenseDeviceId, 'utf8')
  }
  try {
    if (safeStorage.isEncryptionAvailable()) licenseToken = JSON.parse(safeStorage.decryptString(await fs.promises.readFile(licensePath))).token ?? ''
  } catch { licenseToken = '' }
}

async function syncLicenseToken() {
  if (!backend) return
  const requestId = randomUUID()
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { backend?.removeListener('message', onMessage); reject(new Error('The local message service did not receive the license state.')) }, 5000)
    const onMessage = message => {
      if (message?.type !== 'license-token-applied' || message.requestId !== requestId) return
      clearTimeout(timeout)
      backend?.removeListener('message', onMessage)
      message.ok ? resolve() : reject(new Error('Could not secure the license state in the local message service.'))
    }
    backend.on('message', onMessage)
    backend.postMessage({ type: 'license-token', requestId, token: licenseToken, deviceId: licenseDeviceId })
  })
}

async function licenseRequest(endpoint, { token, ...options } = {}) {
  let response
  try {
    response = await fetch(`${licenseApi}${endpoint}`, {
      ...options,
      signal: options.signal ?? AbortSignal.timeout(12000),
      headers: { 'Content-Type': 'application/json', 'X-Device-Name': encodeURIComponent(hostname()), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers ?? {}) },
    })
  } catch { throw new Error('Could not reach the license service. Check your internet connection and try again.') }
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(body.error || (body.reason === 'quota' ? 'Daily message limit reached.' : 'License is invalid, expired, or disabled.')), { status: response.status, reason: body.reason })
  return body
}

ipcMain.handle('license:status', async () => {
  if (!licenseToken) return { active: false }
  try {
    const body = await licenseRequest('/entitlement', { token: licenseToken })
    return { active: true, entitlement: body.entitlement }
  } catch (error) {
    if (error.status !== 403) throw error
    return { active: false, licenseError: error.message }
  }
})
ipcMain.handle('license:activate', async (_event, key) => {
  if (typeof key !== 'string' || key.trim().length < 20 || key.length > 256) throw new Error('Enter a valid activation key.')
  const body = await licenseRequest('/activate', { method: 'POST', body: JSON.stringify({ key: key.trim(), deviceId: licenseDeviceId, deviceName: hostname() }) })
  if (!body.ok || typeof body.token !== 'string') throw new Error(body.reason === 'device_limit' ? 'This key has reached its device limit.' : 'This key is invalid, expired, or disabled.')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure license storage is unavailable on this device.')
  await fs.promises.mkdir(path.dirname(licensePath), { recursive: true })
  await fs.promises.writeFile(licensePath, safeStorage.encryptString(JSON.stringify({ token: body.token })))
  licenseToken = body.token
  await syncLicenseToken()
  const entitlement = await licenseRequest('/entitlement', { token: licenseToken })
  return { active: true, entitlement: entitlement.entitlement ?? body.license }
})

async function readPreferences() {
  try {
    const value = JSON.parse(await fs.promises.readFile(preferencesPath, 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

ipcMain.handle('preferences:get-all', readPreferences)
ipcMain.handle('preferences:set', async (_event, key, value) => {
  if (!allowedPreferenceKeys.has(key) || typeof value !== 'string' || value.length > 4096) {
    throw new Error('Invalid application preference.')
  }
  const write = preferenceWriteQueue.then(async () => {
    const preferences = await readPreferences()
    preferences[key] = value
    await fs.promises.mkdir(path.dirname(preferencesPath), { recursive: true })
    await fs.promises.writeFile(preferencesPath, JSON.stringify(preferences, null, 2), 'utf8')
  })
  preferenceWriteQueue = write.catch(() => undefined)
  await write
})

const titlebarColors = {
  'liquid-glass': ['#16191e', '#edf0f5'],
  default: ['#fcfcfd', '#1b2735'],
  'tokyo-night': ['#202230', '#c0caf5'],
  'tokyo-storm': ['#292e42', '#c0caf5'],
  laserwave: ['#302938', '#f1e9f4'],
  'sea-green': ['#253832', '#d0e7dc'],
  'pro-hacker': ['#101a13', '#c5f7d0'],
  'huacat-pink': ['#fff4fa', '#392334'],
  'cyberpunk-2077': ['#202020', '#f4f1e8'],
}

ipcMain.handle('window:minimize', event => BrowserWindow.fromWebContents(event.sender)?.minimize())
ipcMain.handle('window:toggle-maximize', event => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) return
  if (window.isMaximized()) window.unmaximize(); else window.maximize()
})
ipcMain.handle('window:close', event => BrowserWindow.fromWebContents(event.sender)?.close())
ipcMain.handle('window:state', event => ({ maximized: BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false }))

ipcMain.handle('window:set-theme', (event, theme) => {
  if (process.platform !== 'win32') return
  const [color] = titlebarColors[theme] ?? titlebarColors.default
  const window = BrowserWindow.fromWebContents(event.sender)
  if (window) window.setBackgroundColor(color)
})

function startBackend() {
  const serverPath = path.join(app.getAppPath(), 'server.mjs')
  const stateDirectory = path.join(app.getPath('userData'), 'relay-state')
  let workingDirectory = process.env.WATCH_ROOT
  if (!workingDirectory) {
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(stateDirectory, 'work-root.json'), 'utf8'))
      if (typeof saved?.directory === 'string' && fs.statSync(saved.directory).isDirectory()) workingDirectory = saved.directory
    } catch {
      workingDirectory = app.getPath('documents')
    }
  }
  backend = utilityProcess.fork(serverPath, [], {
    cwd: app.getAppPath(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      OPENCODE_OBSERVER_PORT: '0',
      RELAY_STATE_DIR: stateDirectory,
      WATCH_ROOT: workingDirectory,
      RELAY_LICENSE_REQUIRED: '1',
    },
    stdio: 'pipe',
  })
  backend.stdout?.on('data', chunk => console.log(`[Open Zero] ${chunk}`))
  backend.stderr?.on('data', chunk => console.error(`[Open Zero] ${chunk}`))

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Open Zero server did not start in time.')), 30_000)
    backend.on('message', message => {
      if (message?.type !== 'ready' || !message.port) return
      clearTimeout(timeout)
      serverUrl = `http://127.0.0.1:${message.port}`
      void syncLicenseToken().then(resolve, reject)
    })
    backend.once('exit', code => {
      clearTimeout(timeout)
      if (!serverUrl) reject(new Error(`Open Zero server exited during startup (code ${code}).`))
      else if (!quitting) void showBackendFailure(`Open Zero server stopped unexpectedly (code ${code}).`)
    })
  })
}

ipcMain.handle('terminal:start', (event, input) => {
  const channel = input?.channel === 'opencode' ? 'opencode' : 'shell'
  const key = `${event.sender.id}:${channel}`
  const requestedDirectory = input?.directory
  const sessionId = String(input?.sessionId ?? '').trim()
  if (channel === 'opencode' && !sessionId) throw new Error('أدخل معرّف جلسة OpenCode صالحًا.')
  if (sessionId && !/^ses_[A-Za-z0-9]+$/.test(sessionId)) throw new Error('أدخل معرّف جلسة OpenCode صالحًا.')
  const directory = typeof requestedDirectory === 'string' && requestedDirectory.trim()
    ? path.resolve(requestedDirectory)
    : app.getPath('documents')
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error('مجلد العمل غير موجود.')
  }

  terminals.get(key)?.kill()
  const powershell = process.env.WINDIR
    ? path.join(process.env.WINDIR, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe'
  const command = sessionId ? `opencode --session ${sessionId}` : ''
  const args = ['-NoLogo', '-NoProfile', '-NoExit']
  if (command) args.push('-Command', command)
  const terminal = spawnPty(fs.existsSync(powershell) ? powershell : 'powershell.exe', args, {
    name: 'xterm-256color',
    cols: 100,
    rows: 24,
    cwd: directory,
    env: { ...process.env, TERM: 'xterm-256color' },
  })
  terminals.set(key, terminal)
  terminal.onData(data => { if (terminals.get(key) === terminal) event.sender.send('terminal:data', data, channel) })
  terminal.onExit(({ exitCode }) => {
    if (terminals.get(key) === terminal) {
      terminals.delete(key)
      event.sender.send('terminal:exit', exitCode, channel)
    }
  })
  return { cwd: directory, command }
})

ipcMain.on('terminal:write', (event, data, channel) => {
  const terminal = terminals.get(`${event.sender.id}:${channel === 'opencode' ? 'opencode' : 'shell'}`)
  if (terminal && typeof data === 'string' && data.length <= 16_384) terminal.write(data)
})
ipcMain.on('terminal:resize', (event, size, channel) => {
  const terminal = terminals.get(`${event.sender.id}:${channel === 'opencode' ? 'opencode' : 'shell'}`)
  if (terminal && Number.isInteger(size?.cols) && Number.isInteger(size?.rows)) {
    terminal.resize(Math.min(400, Math.max(20, size.cols)), Math.min(120, Math.max(5, size.rows)))
  }
})
ipcMain.on('terminal:stop', (event, channel) => {
  const key = `${event.sender.id}:${channel === 'opencode' ? 'opencode' : 'shell'}`
  terminals.get(key)?.kill()
  terminals.delete(key)
})
ipcMain.handle('terminal:clipboard-read', () => clipboard.readText())
ipcMain.handle('terminal:clipboard-write', (_event, text) => {
  if (typeof text === 'string') clipboard.writeText(text)
})
ipcMain.handle('app:check-for-updates', async () => {
  if (!app.isPackaged) return { status: 'unsupported' }
  if (process.env.PORTABLE_EXECUTABLE_DIR) return { status: 'portable' }
  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result) return { status: 'unavailable' }
    return {
      status: result.isUpdateAvailable ? 'available' : 'current',
      version: result.updateInfo.version,
    }
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) }
  }
})
ipcMain.handle('app:retry-update', async () => {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return { status: 'unsupported' }
  try {
    const result = await autoUpdater.checkForUpdates()
    return { status: result?.isUpdateAvailable ? 'available' : 'current', version: result?.updateInfo.version }
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) }
  }
})
app.on('web-contents-created', (_event, contents) => {
  contents.once('destroyed', () => {
    for (const channel of ['shell', 'opencode']) {
      const key = `${contents.id}:${channel}`
      terminals.get(key)?.kill()
      terminals.delete(key)
    }
  })
})

async function showBackendFailure(message) {
  await dialog.showMessageBox({ type: 'error', title: 'Open Zero', message })
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
    ...(process.platform === 'win32' ? {
      titleBarStyle: 'hidden',
      frame: false,
    } : {}),
    webPreferences: {
      preload: path.join(app.getAppPath(), 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  const sendWindowState = () => { if (!window.isDestroyed()) window.webContents.send('window:state-changed', { maximized: window.isMaximized() }) }
  window.on('maximize', sendWindowState)
  window.on('unmaximize', sendWindowState)
  window.removeMenu()
  window.setMenuBarVisibility(false)
  window.autoHideMenuBar = true
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  const loadingLogo = fs.readFileSync(path.join(app.getAppPath(), 'dist', 'brand', 'openzero-wordmark-256.png')).toString('base64')
  const loadingPage = `<!doctype html><html lang="ar"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Open Zero</title><style>body{margin:0;height:100vh;display:grid;place-items:center;background:#211f3f;color:#f8f9ff;font:15px system-ui,sans-serif}.card{text-align:center}.mark{width:72px;height:72px;border-radius:22px;background:#71e3cf;color:#211f3f;display:grid;place-items:center;margin:auto auto 18px;font-size:28px;font-weight:800}.spinner{width:17px;height:17px;border:2px solid #ffffff40;border-top-color:#71e3cf;border-radius:50%;display:inline-block;vertical-align:middle;margin-inline-end:8px;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}</style><body><header style="position:fixed;inset:0 0 auto;height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 12px;-webkit-app-region:drag;font-size:12px"><span>Open Zero</span><div style="display:flex;gap:4px;-webkit-app-region:no-drag"><button aria-label="Minimize" onclick="window.codingRoomWindow.minimize()" style="border:0;background:transparent;color:inherit;width:40px;height:32px;cursor:pointer">&#8722;</button><button aria-label="Maximize" onclick="window.codingRoomWindow.toggleMaximize()" style="border:0;background:transparent;color:inherit;width:40px;height:32px;cursor:pointer">&#9633;</button><button aria-label="Close" onclick="window.codingRoomWindow.close()" style="border:0;background:transparent;color:inherit;width:40px;height:32px;cursor:pointer">&#215;</button></div></header><main class="card"><img src="data:image/png;base64,${loadingLogo}" alt="Open Zero" style="width:180px;height:180px;border-radius:20px"/><p><span class="spinner"></span>جاري تجهيز مساحة العمل…</p></main></body></html>`
  await window.loadURL(serverUrl ?? `data:text/html;charset=utf-8,${encodeURIComponent(loadingPage)}`)
  return window
}

function configureAutoUpdates() {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false
  autoUpdater.on('update-available', info => {
    console.log(`[Open Zero] Update ${info.version} is available.`)
    mandatoryUpdatePending = true
    if (!quitting && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:mandatory-update-required', { version: info.version })
    }
  })
  autoUpdater.on('download-progress', info => {
    if (mandatoryUpdatePending && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:mandatory-update-progress', { percent: Math.round(info.percent), transferred: info.transferred, total: info.total })
    }
  })
  autoUpdater.on('update-not-available', info => console.log(`[Open Zero] Up to date (${info.version}).`))
  autoUpdater.on('error', error => {
    console.error('[Open Zero] Update check failed:', error)
    if (mandatoryUpdatePending && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:mandatory-update-error', { message: error instanceof Error ? error.message : String(error) })
    }
  })
  autoUpdater.on('update-downloaded', info => {
    if (quitting) return
    mandatoryUpdatePending = true
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:mandatory-update-ready', { version: info.version })
    // Install updates silently and reopen the app when the installer finishes.
    autoUpdater.quitAndInstall(true, true)
  })

  const check = () => void autoUpdater.checkForUpdates().catch(error => console.error('[Open Zero] Update check failed:', error))
  setTimeout(check, 15_000)
  setInterval(check, 6 * 60 * 60 * 1000)
}

app.whenReady().then(async () => {
  const window = await createWindow()
  mainWindow = window
  try {
    await readLicense()
    await startBackend()
    configureAutoUpdates()
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

