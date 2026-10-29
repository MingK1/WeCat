import { contextBridge, ipcRenderer } from 'electron'
import type { ImportProgress, WeCatApi } from '../shared/contracts'

const api: WeCatApi = {
  app: {
    getVersion: () => ipcRenderer.invoke('app:version'),
    chooseSource: () => ipcRenderer.invoke('app:choose-source')
  },
  source: {
    inspect: (path) => ipcRenderer.invoke('source:inspect', path),
    dependencies: (path) => ipcRenderer.invoke('source:dependencies', path),
    initialize: (path) => ipcRenderer.invoke('source:initialize', path),
    initializeAudioAssets: () => ipcRenderer.invoke('source:initialize-audio-assets')
  },
  archive: {
    summary: () => ipcRenderer.invoke('archive:summary'),
    conversations: (query) => ipcRenderer.invoke('archive:conversations', query),
    messages: (query) => ipcRenderer.invoke('archive:messages', query),
    media: (query) => ipcRenderer.invoke('archive:media', query),
    people: () => ipcRenderer.invoke('archive:people'),
    openMedia: (mediaId) => ipcRenderer.invoke('archive:open-media', mediaId)
  },
  analytics: {
    get: (filter) => ipcRenderer.invoke('analytics:get', filter),
    highlights: (filter) => ipcRenderer.invoke('analytics:highlights', filter),
    relationships: () => ipcRenderer.invoke('analytics:relationships'),
    relationshipDetail: (conversationId) => ipcRenderer.invoke('analytics:relationship-detail', conversationId)
  },
  reports: {
    preview: (request) => ipcRenderer.invoke('reports:preview', request),
    export: (request) => ipcRenderer.invoke('reports:export', request)
  },
  preservation: {
    export: (request) => ipcRenderer.invoke('preservation:export', request)
  },
  importer: {
    start: (request) => ipcRenderer.invoke('importer:start', request),
    cancel: () => ipcRenderer.invoke('importer:cancel'),
    onProgress: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: ImportProgress): void => callback(progress)
      ipcRenderer.on('importer:progress', listener)
      return () => ipcRenderer.removeListener('importer:progress', listener)
    }
  }
}

contextBridge.exposeInMainWorld('wecat', api)
