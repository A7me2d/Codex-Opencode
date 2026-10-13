const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('codingRoomTerminal', {
  start: (directory, sessionId, channel) => ipcRenderer.invoke('terminal:start', { directory, sessionId, channel }),
  write: (data, channel) => ipcRenderer.send('terminal:write', data, channel),
  resize: (cols, rows, channel) => ipcRenderer.send('terminal:resize', { cols, rows }, channel),
  stop: channel => ipcRenderer.send('terminal:stop', channel),
  readClipboard: () => ipcRenderer.invoke('terminal:clipboard-read'),
  writeClipboard: text => ipcRenderer.invoke('terminal:clipboard-write', text),
  onData: (callback, channel) => {
    const listener = (_event, data, source) => { if (source === channel) callback(data) }
    ipcRenderer.on('terminal:data', listener)
    return () => ipcRenderer.removeListener('terminal:data', listener)
  },
  onExit: (callback, channel) => {
    const listener = (_event, code, source) => { if (source === channel) callback(code) }
    ipcRenderer.on('terminal:exit', listener)
    return () => ipcRenderer.removeListener('terminal:exit', listener)
  },
})

contextBridge.exposeInMainWorld('codingRoomUpdates', {
  check: () => ipcRenderer.invoke('app:check-for-updates'),
  retry: () => ipcRenderer.invoke('app:retry-update'),
  onMandatoryUpdate: callback => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('app:mandatory-update-required', listener)
    return () => ipcRenderer.removeListener('app:mandatory-update-required', listener)
  },
  onMandatoryUpdateProgress: callback => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('app:mandatory-update-progress', listener)
    return () => ipcRenderer.removeListener('app:mandatory-update-progress', listener)
  },
  onMandatoryUpdateError: callback => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('app:mandatory-update-error', listener)
    return () => ipcRenderer.removeListener('app:mandatory-update-error', listener)
  },
})

contextBridge.exposeInMainWorld('codingRoomPreferences', {
  getAll: () => ipcRenderer.invoke('preferences:get-all'),
  set: (key, value) => ipcRenderer.invoke('preferences:set', key, value),
})

contextBridge.exposeInMainWorld('codingRoomWindow', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  getState: () => ipcRenderer.invoke('window:state'),
  onState: callback => { const listener = (_event, state) => callback(state); ipcRenderer.on('window:state-changed', listener); return () => ipcRenderer.removeListener('window:state-changed', listener) },
  setTheme: theme => ipcRenderer.invoke('window:set-theme', theme),
})

contextBridge.exposeInMainWorld('codingRoomLicense', {
  status: () => ipcRenderer.invoke('license:status'),
  activate: key => ipcRenderer.invoke('license:activate', key),
})
