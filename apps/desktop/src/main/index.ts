import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app, BrowserWindow, Menu, Tray, dialog, nativeImage, nativeTheme, session } from 'electron'
import { createMainLogger } from './logger.js'
import { ProviderConfigStore } from './provider-config.js'
import { ConnectionSecretStore } from './connection-secrets.js'
import { RuntimeSupervisor } from './runtime-supervisor.js'
import { registerIpc } from './ipc.js'
import { applyContentSecurityPolicy, hardenWebContents } from './security.js'

const isDev = !app.isPackaged
const isDevServer = Boolean(process.env.ELECTRON_RENDERER_URL)
const rendererWidth = Number(process.env.PROJECTOS_WINDOW_WIDTH ?? 1440)
const rendererHeight = Number(process.env.PROJECTOS_WINDOW_HEIGHT ?? 900)

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

function broadcast(channel: string, payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(channel, payload)
}

function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const window = new BrowserWindow({
    width: Math.max(1024, Math.min(rendererWidth, 2560)),
    height: Math.max(700, Math.min(rendererHeight, 1600)),
    minWidth: 1024,
    minHeight: 700,
    show: false,
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
  window.setMenuBarVisibility(false)
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
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
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
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示 ProjectOS', click: showMainWindow },
      { type: 'separator' },
      {
        label: '退出 ProjectOS',
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ]),
  )
  tray.on('click', showMainWindow)
  tray.on('double-click', showMainWindow)
}

async function bootstrap(): Promise<void> {
  await app.whenReady()
  dataDir = resolve(process.env.PROJECTOS_DATA_DIR ?? join(app.getPath('userData'), 'data'))
  mkdirSync(dataDir, { recursive: true })
  logger = createMainLogger(dataDir)
  providerConfig = new ProviderConfigStore(dataDir, logger)
  connectionSecrets = new ConnectionSecretStore(dataDir, logger)
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
    dataDir,
    window: mainWindow,
    logger,
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  supervisor.start()
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  void app.whenReady().then(() => {
    dialog.showErrorBox(
      'ProjectOS 已在运行',
      'ProjectOS 已经在后台运行。请从系统托盘打开，或先在托盘中退出旧实例后再启动。',
    )
    app.quit()
  })
} else {
  app.on('second-instance', () => {
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
