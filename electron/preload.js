const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('studyclick', {
  saveApiKey: (key) => ipcRenderer.send('save-api-key', key),
  onExistingKey: (callback) => ipcRenderer.on('existing-key', (event, key) => callback(key)),
})