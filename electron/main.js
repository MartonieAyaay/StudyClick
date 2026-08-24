const { app, BrowserWindow, ipcMain, Menu } = require('electron')
const path = require('path')
const fs = require('fs')

const configDir = app.getPath('userData')
const configPath = path.join(configDir, 'config.json')

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  } catch {
    return {}
  }
}

function saveConfig(config) {
  fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}

let mainWindow = null
let settingsWindow = null

function createSettingsWindow(existingKey) {
  settingsWindow = new BrowserWindow({
    width: 480,
    height: 340,
    resizable: false,
    title: 'StudyClick Setup',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  })
  settingsWindow.setMenuBarVisibility(false)
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'))
  settingsWindow.webContents.once('did-finish-load', () => {
    settingsWindow.webContents.send('existing-key', existingKey || '')
  })
}

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
      submenu: [
        {
          label: 'Change API Key...',
          click: () => {
            const config = loadConfig()
            createSettingsWindow(config.geminiApiKey)
          },
        },
        { role: 'quit' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function startBackend(apiKey) {
  process.env.GEMINI_API_KEY = apiKey
  // Requiring the server module starts it — it calls app.listen() internally.
  require(path.join(__dirname, '..', 'server', 'index.js'))
}

ipcMain.on('save-api-key', (event, apiKey) => {
  const trimmed = (apiKey || '').trim()
  if (!trimmed) return
  saveConfig({ geminiApiKey: trimmed })

  const alreadyRunning = Boolean(mainWindow)
  if (settingsWindow) {
    settingsWindow.close()
    settingsWindow = null
  }

  if (alreadyRunning) {
    // The backend already started with the old key — relaunch the whole
    // app so everything picks up the new key cleanly.
    app.relaunch()
    app.exit(0)
  } else {
    startBackend(trimmed)
    createMainWindow()
  }
})

app.whenReady().then(() => {
  const config = loadConfig()
  if (config.geminiApiKey) {
    startBackend(config.geminiApiKey)
    createMainWindow()
  } else {
    createSettingsWindow('')
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})