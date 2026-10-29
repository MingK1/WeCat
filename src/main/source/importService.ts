import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { ImportProgress, ImportRequest } from '../../shared/contracts'
import type { WeflowContact, WeflowSession } from './weflowAdapter'
import type { WeflowMediaIndexRecord } from './weflowAdapter'
import { WeflowAdapter } from './weflowAdapter'

export interface RawConversationExport {
  conversationId: string
  path: string
  count?: number
  media?: unknown
  voices?: Map<string, { path: string; bytes: number }>
}

export interface RawImportBundle {
  runId: string
  stagingDirectory: string
  sessions: WeflowSession[]
  contacts: WeflowContact[]
  exports: RawConversationExport[]
  warnings: string[]
  skippedConversations: number
  avatars: Map<string, string>
  mediaIndex: WeflowMediaIndexRecord[]
}

export class ImportSourceService {
  constructor(
    private readonly adapter: WeflowAdapter,
    private readonly stagingRoot: string
  ) {}

  async collect(
    request: ImportRequest,
    signal: AbortSignal,
    progress: (event: ImportProgress) => void
  ): Promise<RawImportBundle> {
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const stagingDirectory = join(this.stagingRoot, runId)
    const exportDirectory = join(stagingDirectory, 'exports')
    await mkdir(exportDirectory, { recursive: true })

    try {
      progress({ runId, phase: 'sessions', completed: 0, total: 1, detail: '正在读取会话列表' })
      const [sessions, contacts] = await Promise.all([
        this.adapter.listSessions(signal),
        this.adapter.listContacts(signal)
      ])
      const selected = request.conversationIds?.length
        ? sessions.filter((session) => request.conversationIds?.includes(session.username))
        : sessions
      if (selected.length === 0) throw new Error('没有找到可导入的微信会话。')
      progress({ runId, phase: 'sessions', completed: 1, total: 1, detail: `找到 ${selected.length} 个会话` })

      const exports: RawConversationExport[] = []
      const warnings: string[] = []
      let skippedConversations = 0
      const mediaIndex = request.includeMedia ? await this.adapter.listMediaIndex(signal).catch(() => []) : []
      for (let index = 0; index < selected.length; index += 1) {
        if (signal.aborted) throw new Error('导入已取消。')
        const session = selected[index]
        progress({
          runId,
          phase: 'messages',
          completed: index,
          total: selected.length,
          detail: `正在导入 ${session.displayName || `会话 ${index + 1}`}`
        })
        try {
          const result = await this.adapter.exportConversation(session.username, exportDirectory, request.includeMedia, signal)
          const hasVoice = request.includeMedia && await readFile(result.path!, 'utf8').then((text) => /"messageType"\s*:\s*"voice"/.test(text)).catch(() => false)
          const voices = hasVoice ? await this.adapter.exportVoiceAssets(session.username, join(stagingDirectory, 'voices', session.username.replace(/[^A-Za-z0-9@._-]/g, '_')), signal).catch(() => new Map()) : new Map()
          exports.push({ conversationId: session.username, path: result.path!, count: result.count, media: result.media, voices })
        } catch (error) {
          if (signal.aborted) throw error
          const name = session.displayName || `会话 ${index + 1}`
          warnings.push(`${name} 未导入：${error instanceof Error ? error.message : '导出失败。'}`)
          skippedConversations += 1
        }
      }
      if (exports.length === 0) throw new Error('没有会话成功导出，请先运行 WeFlow 环境检查。')
      progress({ runId, phase: 'media', completed: 0, total: 1, detail: '正在导入联系人头像' })
      const avatars = await this.adapter.exportAvatars(join(stagingDirectory, 'avatars'), signal).catch(() => new Map<string, string>())
      progress({ runId, phase: 'media', completed: 1, total: 1, detail: '联系人头像导入完成' })
      progress({ runId, phase: 'messages', completed: selected.length, total: selected.length, detail: '会话导出完成' })
      return { runId, stagingDirectory, sessions: selected, contacts, exports, warnings, skippedConversations, avatars, mediaIndex }
    } catch (error) {
      await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }
}
