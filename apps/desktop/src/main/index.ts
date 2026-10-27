import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app, BrowserWindow, Menu, Tray, dialog, nativeImage, nativeTheme, session } from 'electron'
import { createMainLogger } from './logger.js'
import { ProviderConfigStore } from './provider-config.js'
import { ConnectionSecretStore } from './connection-secrets.js'
import { ResourceCredentialVault } from './resource-credentials.js'
import { RuntimeSupervisor } from './runtime-supervisor.js'
import { registerIpc } from './ipc.js'
import { applyContentSecurityPolicy, hardenWebContents } from './security.js'

const isDev = !app.isPackaged
const isDevServer = Boolean(process.env.ELECTRON_RENDERER_URL)
const rendererWidth = Number(process.env.PROJECTOS_WINDOW_WIDTH ?? 1440)
const rendererHeight = Number(process.env.PROJECTOS_WINDOW_HEIGHT ?? 900)
const startRoute = process.env.PROJECTOS_START_ROUTE?.replace(/^#?\/?/, '') ?? ''

app.setName('ProjectOS')
app.setAppUserModelId('ai.projectos.desktop')

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let supervisor: RuntimeSupervisor | null = null
let disposeIpc: (() => void) | null = null
let quitting = false
let dataDir = ''
let logger: ReturnType<typeof createMainLogger>
let providerConfig: ProviderConfigStore
let connectionSecrets: ConnectionSecretStore
let resourceSecrets: ResourceCredentialVault

function broadcast(channel: string, payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(channel, payload)
}

function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const windowIcon = isMac
    ? undefined
    : process.platform === 'win32'
      ? app.isPackaged
        ? join(process.resourcesPath, 'icon.ico')
        : join(__dirname, '../../resources/icon.ico')
      : app.isPackaged
        ? join(process.resourcesPath, 'icon.png')
        : join(__dirname, '../../resources/icon.png')
  const window = new BrowserWindow({
    width: Math.max(1024, Math.min(rendererWidth, 2560)),
    height: Math.max(700, Math.min(rendererHeight, 1600)),
    minWidth: 1024,
    minHeight: 700,
    show: false,
    icon: windowIcon,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0A0C11' : '#F4F5F7',
    title: 'ProjectOS',
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    trafficLightPosition: isMac ? { x: 16, y: 15 } : undefined,
    roundedCorners: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
      devTools: isDev || process.env.PROJECTOS_ENABLE_DEVTOOLS === '1',
    },
  })
  if (windowIcon && process.platform !== 'darwin') window.setIcon(windowIcon)
  window.setMenuBarVisibility(false)
  window.webContents.on('before-input-event', (event, input) => {
    if ((input.control || input.meta) && input.key.toLowerCase() === 'q') {
      event.preventDefault()
      quitting = true
      app.quit()
    }
  })
  hardenWebContents(window.webContents, isDev, process.env.ELECTRON_RENDERER_URL)
  window.once('ready-to-show', () => window.show())
  window.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    window.hide()
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}${startRoute ? `#/${startRoute}` : ''}`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), startRoute ? { hash: startRoute } : undefined)
  }
  window.webContents.on('did-finish-load', () => {
    if (supervisor) broadcast('projectos:runtime-status', supervisor.getStatus())
  })
  if (isDev && process.env.PROJECTOS_DEVTOOLS === '1') {
    window.webContents.openDevTools({ mode: 'detach' })
  }
  return window
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createTray(): void {
  if (tray) return
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'tray.png')
    : join(__dirname, '../../resources/tray.png')
  const image = nativeImage.createFromPath(iconPath)
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
  tray.setToolTip('ProjectOS')
  const menu = Menu.buildFromTemplate([
    { label: '显示 ProjectOS', click: showMainWindow },
    { type: 'separator' },
    {
      label: '退出 ProjectOS',
      click: () => {
        quitting = true
        app.quit()
      },
    },
  ])
  tray.setContextMenu(menu)
  // Windows 11's hidden-icon flyout does not always dispatch setContextMenu on
  // the first right click; explicitly pop the same menu as a fallback.
  if (process.platform === 'win32') {
    tray.on('right-click', () => tray?.popUpContextMenu(menu))
  }
  tray.on('click', showMainWindow)
  tray.on('double-click', showMainWindow)
}

async function bootstrap(): Promise<void> {
  await app.whenReady()
  if (process.platform === 'win32') {
    // The taskbar jump list is an OS-level escape hatch even when the tray
    // flyout is hidden or a window is hidden to tray.
    app.setUserTasks([
      {
        program: process.execPath,
        arguments: '--quit',
        iconPath: process.execPath,
        iconIndex: 0,
        title: '退出 ProjectOS',
        description: '退出当前 ProjectOS 实例',
      },
    ])
  }
  dataDir = resolve(process.env.PROJECTOS_DATA_DIR ?? join(app.getPath('userData'), 'data'))
  mkdirSync(dataDir, { recursive: true })
  logger = createMainLogger(dataDir)
  providerConfig = new ProviderConfigStore(dataDir, logger)
  connectionSecrets = new ConnectionSecretStore(dataDir, logger)
  resourceSecrets = new ResourceCredentialVault(dataDir, logger)
  Menu.setApplicationMenu(null)
  applyContentSecurityPolicy(session.defaultSession, isDevServer)
  nativeTheme.themeSource = 'system'

  mainWindow = createWindow()
  createTray()

  const runtimeEntry = app.isPackaged
    ? join(process.resourcesPath, 'runtime', 'index.mjs')
    : resolve(app.getAppPath(), '../runtime/dist/index.mjs')

  supervisor = new RuntimeSupervisor({
    entryPath: runtimeEntry,
    dataDir,
    providerConfig: () => providerConfig.runtimeConfig(),
    logger,
    onEvent: (seq, event) => broadcast('projectos:event', { seq, event }),
    onStatus: (status) => broadcast('projectos:runtime-status', status),
  })

  disposeIpc = registerIpc({
    supervisor,
    providerConfig,
    connectionSecrets,
    resourceSecrets,
    dataDir,
    window: mainWindow,
    logger,
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  supervisor.start()
}

const quitRequested = process.argv.includes('--quit')
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // The primary instance receives the original argv via second-instance and
  // handles --quit there.
  app.quit()
} else if (quitRequested) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    if (argv.includes('--quit')) {
      quitting = true
      app.quit()
      return
    }
    showMainWindow()
  })

  void bootstrap().catch((error) => {
    logger?.error('failed to bootstrap desktop app', { error: String(error) })
    const message = error instanceof Error ? error.message : String(error)
    try {
      dialog.showErrorBox(
        'ProjectOS 启动失败',
        `${message}\n\n数据目录：${dataDir || '未知'}\n日志：${dataDir ? `${dataDir}/main.log` : '未知'}`,
      )
    } catch {
      // ignore dialog failures during early shutdown
    }
    app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })

  app.on('window-all-closed', () => {
    // Keep the runtime and tray resident so closing the window does not interrupt work.
  })

  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    const finish = (): void => {
      disposeIpc?.()
      tray?.destroy()
      tray = null
      app.quit()
    }
    if (supervisor) {
      void supervisor.stop().finally(finish)
    } else {
      finish()
    }
  })
}
