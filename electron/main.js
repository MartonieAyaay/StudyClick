const { app, BrowserWindow, Menu } = require('electron')
const path = require('path')

let mainWindow = null

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'StudyClick',
    webPreferences: {
      contextIsolation: true,
    },
  })
  setAppMenu()

  const indexPath = app.isPackaged
    ? path.join(process.resourcesPath, 'dist', 'index.html')
    : path.join(__dirname, '..', 'dist', 'index.html')

  mainWindow.loadFile(indexPath)
}

function setAppMenu() {
  const template = [
    {
      label: 'StudyClick',
      submenu: [{ role: 'quit' }],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function startBackend() {
  require(path.join(__dirname, '..', 'server', 'index.js'))
}

app.whenReady().then(() => {
  startBackend()
  createMainWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})