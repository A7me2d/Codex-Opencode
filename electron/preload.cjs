const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('codingRoomTerminal', {
  start: (directory, sessionId) => ipcRenderer.invoke('terminal:start', { directory, sessionId }),
  write: data => ipcRenderer.send('terminal:write', data),
  resize: (cols, rows) => ipcRenderer.send('terminal:resize', { cols, rows }),
  stop: () => ipcRenderer.send('terminal:stop'),
  readClipboard: () => ipcRenderer.invoke('terminal:clipboard-read'),
  writeClipboard: text => ipcRenderer.invoke('terminal:clipboard-write', text),
  onData: callback => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('terminal:data', listener)
    return () => ipcRenderer.removeListener('terminal:data', listener)
  },
  onExit: callback => {
    const listener = (_event, code) => callback(code)
    ipcRenderer.on('terminal:exit', listener)
    return () => ipcRenderer.removeListener('terminal:exit', listener)
  },
})

contextBridge.exposeInMainWorld('codingRoomUpdates', {
  check: () => ipcRenderer.invoke('app:check-for-updates'),
})

contextBridge.exposeInMainWorld('codingRoomPreferences', {
  getAll: () => ipcRenderer.invoke('preferences:get-all'),
  set: (key, value) => ipcRenderer.invoke('preferences:set', key, value),
})

contextBridge.exposeInMainWorld('codingRoomWindow', {
  setTheme: theme => ipcRenderer.invoke('window:set-theme', theme),
})

contextBridge.exposeInMainWorld('codingRoomLicense', {
  status: () => ipcRenderer.invoke('license:status'),
  activate: key => ipcRenderer.invoke('license:activate', key),
})
