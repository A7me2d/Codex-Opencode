const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('codingRoomTerminal', {
  start: (directory, sessionId) => ipcRenderer.invoke('terminal:start', { directory, sessionId }),
  write: data => ipcRenderer.send('terminal:write', data),
  resize: (cols, rows) => ipcRenderer.send('terminal:resize', { cols, rows }),
  stop: () => ipcRenderer.send('terminal:stop'),
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
