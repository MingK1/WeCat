import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import type { ImportRequest } from '../shared/contracts'
import { inspectSource, publicSourceInspection } from './source/sourceDiscovery'
import { WeflowAdapter } from './source/weflowAdapter'
import { ImportSourceService } from './source/importService'
import { JsonArchiveRepository } from './archive/jsonArchiveRepository'
import { ArchiveService } from './archive/archiveService'
import { AnalyticsService } from './analytics/analyticsService'
import { MemoryHighlightService } from './analytics/memoryHighlights'
import { RelationshipService } from './analytics/relationshipService'
import { ReportService } from './reports/reportService'
import type { ReportRequest } from '../shared/contracts'
import type { PreservationRequest } from '../shared/contracts'
import { PreservationService } from './preservation/preservationService'

function createWindow(): void {
  const iconPath = app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(process.cwd(), 'resources', 'icon.png')
  const window = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: '#f5f3ee',
    title: 'WeCat',
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  window.on('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerHandlers(
  adapter: WeflowAdapter,
  archive: ArchiveService,
  analytics: AnalyticsService,
  highlights: MemoryHighlightService,
  relationships: RelationshipService,
  reports: ReportService,
  preservation: PreservationService
): void {
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:choose-source', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择微信数据目录',
      properties: ['openDirectory', 'dontAddToRecent'],
      buttonLabel: '选择此目录'
    })
    return result.canceled ? undefined : result.filePaths[0]
  })
  ipcMain.handle('source:inspect', async (_event, path: string) => publicSourceInspection(await inspectSource(path)))
  ipcMain.handle('source:dependencies', (_event, path?: string) => adapter.dependencyStatus(path))
  ipcMain.handle('source:initialize', (_event, path: string) => adapter.launchInitialization(path))
  ipcMain.handle('source:initialize-audio-assets', () => adapter.launchAudioAssetsInitialization())
  ipcMain.handle('archive:summary', () => archive.summary())
  ipcMain.handle('archive:conversations', (_event, query) => archive.conversations(query))
  ipcMain.handle('archive:messages', (_event, query) => archive.messages(query))
  ipcMain.handle('archive:media', (_event, query) => archive.media(query))
  ipcMain.handle('archive:people', () => archive.people())
  ipcMain.handle('archive:open-media', async (_event, mediaId: string) => {
    const path = await archive.resolveMediaFile(mediaId)
    if (!path) return { success: false, message: '该文件在当前档案中不可用。' }
    const error = await shell.openPath(path)
    return error ? { success: false, message: '无法使用系统默认程序打开该文件。' } : { success: true, message: '已打开文件。' }
  })
  ipcMain.handle('analytics:get', (_event, filter) => analytics.get(filter))
  ipcMain.handle('analytics:highlights', (_event, filter) => highlights.get(filter))
  ipcMain.handle('analytics:relationships', () => relationships.get())
  ipcMain.handle('analytics:relationship-detail', (_event, conversationId: string) => relationships.detail(conversationId))
  ipcMain.handle('reports:preview', (_event, request: ReportRequest) => reports.preview(request))
  ipcMain.handle('reports:export', async (_event, request: ReportRequest) => {
    const preview = await reports.preview(request)
    const safeTitle = preview.title.replace(/[<>:"/\\|?*]+/g, '-').slice(0, 80)
    const result = await dialog.showSaveDialog({
      title: '保存 WeCat 回忆报告',
      defaultPath: `${safeTitle}.html`,
      filters: [{ name: 'HTML 回忆报告', extensions: ['html'] }]
    })
    if (result.canceled || !result.filePath) return { success: false, cancelled: true, message: '已取消保存。' }
    await reports.export(request, result.filePath)
    return { success: true, fileName: result.filePath.split(/[\\/]/).at(-1), message: '回忆报告已保存。' }
  })
  ipcMain.handle('preservation:export', async (_event, request: PreservationRequest) => {
    const selected = await dialog.showOpenDialog({ title: '选择长期档案保存位置', properties: ['openDirectory', 'createDirectory'], buttonLabel: '导出到这里' })
    if (selected.canceled || !selected.filePaths[0]) return { success: false, cancelled: true, message: '已取消导出。' }
    const result = await preservation.export(request, selected.filePaths[0])
    if (result.success && result.outputPath) await shell.openPath(result.outputPath)
    const { outputPath: _outputPath, ...publicResult } = result
    return publicResult
  })
  ipcMain.handle('importer:start', (event, request: ImportRequest) => archive.import(request, (progress) => {
    if (!event.sender.isDestroyed()) event.sender.send('importer:progress', progress)
  }))
  ipcMain.handle('importer:cancel', () => {
    const cancelled = archive.cancel()
    return {
      success: cancelled,
      message: cancelled ? '正在取消导入。' : '当前没有导入任务。'
    }
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.wecat.desktop')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  const weflowWorkingDirectory = join(app.getPath('userData'), 'weflow')
  mkdirSync(weflowWorkingDirectory, { recursive: true })
  const adapter = new WeflowAdapter(weflowWorkingDirectory)
  const archiveRoot = join(app.getPath('userData'), 'archive')
  const repository = new JsonArchiveRepository(archiveRoot)
  const sourceImporter = new ImportSourceService(adapter, join(app.getPath('userData'), 'staging'))
  const archive = new ArchiveService(repository, sourceImporter, adapter)
  const analytics = new AnalyticsService(repository)
  const highlights = new MemoryHighlightService(repository)
  const relationships = new RelationshipService(repository)
  const reports = new ReportService(repository, analytics, highlights)
  const preservation = new PreservationService(repository)
  registerHandlers(adapter, archive, analytics, highlights, relationships, reports, preservation)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
