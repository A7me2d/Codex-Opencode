import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell, utilityProcess } from 'electron'
import { spawn as spawnPty } from 'node-pty'
import electronUpdater from 'electron-updater'
import path from 'node:path'
import fs from 'node:fs'

Menu.setApplicationMenu(null)

let backend
let serverUrl
let quitting = false
let quitAfterBackend = false
let manualUpdateCheck = false
const terminals = new Map()
let mainWindow
const { autoUpdater } = electronUpdater

// Keep the existing session state folder stable across this product rename.
app.setPath('userData', path.join(app.getPath('appData'), 'Relay Room'))
const preferencesPath = path.join(app.getPath('userData'), 'ui-preferences.json')
const allowedPreferenceKeys = new Set([
  'relay-room.theme',
  'coding-room.locale',
  'relay-room.file-icon-theme',
  'relay-room.panel-sizes',
  'relay-room.handoff-visible',
])
let preferenceWriteQueue = Promise.resolve()

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
  default: ['#fcfcfd', '#1b2735'],
  'tokyo-night': ['#202230', '#c0caf5'],
  'tokyo-storm': ['#292e42', '#c0caf5'],
  laserwave: ['#302938', '#f1e9f4'],
  'sea-green': ['#253832', '#d0e7dc'],
  'pro-hacker': ['#101a13', '#c5f7d0'],
  'huacat-pink': ['#fff4fa', '#392334'],
  'cyberpunk-2077': ['#202020', '#f4f1e8'],
}

ipcMain.handle('window:set-theme', (event, theme) => {
  if (process.platform !== 'win32') return
  const [color, symbolColor] = titlebarColors[theme] ?? titlebarColors.default
  BrowserWindow.fromWebContents(event.sender)?.setTitleBarOverlay({ color, symbolColor })
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

ipcMain.handle('terminal:start', (event, input) => {
  const requestedDirectory = input?.directory
  const sessionId = String(input?.sessionId ?? '').trim()
  if (!/^ses_[A-Za-z0-9]+$/.test(sessionId)) throw new Error('أدخل معرّف جلسة OpenCode صالحًا.')
  const directory = typeof requestedDirectory === 'string' && requestedDirectory.trim()
    ? path.resolve(requestedDirectory)
    : app.getPath('documents')
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error('مجلد العمل غير موجود.')
  }

  terminals.get(event.sender.id)?.kill()
  const powershell = process.env.WINDIR
    ? path.join(process.env.WINDIR, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe'
  const terminal = spawnPty(fs.existsSync(powershell) ? powershell : 'powershell.exe', ['-NoLogo', '-NoProfile', '-NoExit', '-Command', `opencode --session ${sessionId}`], {
    name: 'xterm-256color',
    cols: 100,
    rows: 24,
    cwd: directory,
    env: { ...process.env, TERM: 'xterm-256color' },
  })
  terminals.set(event.sender.id, terminal)
  terminal.onData(data => event.sender.send('terminal:data', data))
  terminal.onExit(({ exitCode }) => {
    if (terminals.get(event.sender.id) === terminal) {
      terminals.delete(event.sender.id)
      event.sender.send('terminal:exit', exitCode)
    }
  })
  return { cwd: directory, command: `opencode --session ${sessionId}` }
})

ipcMain.on('terminal:write', (event, data) => {
  const terminal = terminals.get(event.sender.id)
  if (terminal && typeof data === 'string' && data.length <= 16_384) terminal.write(data)
})
ipcMain.on('terminal:resize', (event, size) => {
  const terminal = terminals.get(event.sender.id)
  if (terminal && Number.isInteger(size?.cols) && Number.isInteger(size?.rows)) {
    terminal.resize(Math.min(400, Math.max(20, size.cols)), Math.min(120, Math.max(5, size.rows)))
  }
})
ipcMain.on('terminal:stop', event => {
  terminals.get(event.sender.id)?.kill()
  terminals.delete(event.sender.id)
})
ipcMain.handle('terminal:clipboard-read', () => clipboard.readText())
ipcMain.handle('terminal:clipboard-write', (_event, text) => {
  if (typeof text === 'string') clipboard.writeText(text)
})
ipcMain.handle('app:check-for-updates', async () => {
  if (!app.isPackaged) return { status: 'unsupported' }
  if (process.env.PORTABLE_EXECUTABLE_DIR) return { status: 'portable' }
  manualUpdateCheck = true
  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result) return { status: 'unavailable' }
    return {
      status: result.isUpdateAvailable ? 'available' : 'current',
      version: result.updateInfo.version,
    }
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) }
  } finally {
    manualUpdateCheck = false
  }
})
app.on('web-contents-created', (_event, contents) => {
  contents.once('destroyed', () => {
    terminals.get(contents.id)?.kill()
    terminals.delete(contents.id)
  })
})

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
    ...(process.platform === 'win32' ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#fcfcfd', symbolColor: '#1b2735', height: 38 },
    } : {}),
    webPreferences: {
      preload: path.join(app.getAppPath(), 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.removeMenu()
  window.setMenuBarVisibility(false)
  window.autoHideMenuBar = true
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  const loadingPage = `<!doctype html><html lang="ar"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Coding Room</title><style>body{margin:0;height:100vh;display:grid;place-items:center;background:#211f3f;color:#f8f9ff;font:15px system-ui,sans-serif}.card{text-align:center}.mark{width:72px;height:72px;border-radius:22px;background:#71e3cf;color:#211f3f;display:grid;place-items:center;margin:auto auto 18px;font-size:28px;font-weight:800}.spinner{width:17px;height:17px;border:2px solid #ffffff40;border-top-color:#71e3cf;border-radius:50%;display:inline-block;vertical-align:middle;margin-inline-end:8px;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}</style><body><main class="card"><div class="mark">&lt;/&gt;</div><strong>Coding Room</strong><p><span class="spinner"></span>جاري تجهيز مساحة العمل…</p></main></body></html>`
  await window.loadURL(serverUrl ?? `data:text/html;charset=utf-8,${encodeURIComponent(loadingPage)}`)
  return window
}

function configureAutoUpdates() {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false
  autoUpdater.on('update-available', info => {
    console.log(`[Coding Room] Update ${info.version} is available.`)
    if (manualUpdateCheck) return
    if (quitting || !mainWindow || mainWindow.isDestroyed()) return
    void dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'تحديث جديد متاح',
      message: `يتوفر الإصدار ${info.version} من Coding Room. يجري تنزيله في الخلفية، وسيُثبت عند إغلاق التطبيق.`,
      buttons: ['حسنًا'],
    })
  })
  autoUpdater.on('update-not-available', info => console.log(`[Coding Room] Up to date (${info.version}).`))
  autoUpdater.on('error', error => console.error('[Coding Room] Update check failed:', error))
  autoUpdater.on('update-downloaded', info => {
    if (quitting) return
    void dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'تحديث Coding Room جاهز',
      message: `تم تنزيل الإصدار ${info.version}. سيُثبت عند إغلاق التطبيق.`,
      buttons: ['أعد التشغيل الآن', 'لاحقًا'],
      defaultId: 1,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall()
    })
  })

  const check = () => void autoUpdater.checkForUpdates().catch(error => console.error('[Coding Room] Update check failed:', error))
  setTimeout(check, 15_000)
  setInterval(check, 6 * 60 * 60 * 1000)
}

app.whenReady().then(async () => {
  const window = await createWindow()
  mainWindow = window
  try {
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

