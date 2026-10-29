import type {
  ArchiveSummary,
  ConversationQuery,
  ImportProgress,
  ImportRequest,
  ImportResult,
  MediaQuery,
  MessageQuery,
  Person
} from '../../shared/contracts'
import { emptyCoverage } from '../../shared/contracts'
import type { ArchiveIndex, ArchiveRepository, ConversationDocument } from './archiveRepository'
import { conversationFileName, normalizeWeflowExport, sourceFingerprint } from './normalizeWeflow'
import { inspectSource } from '../source/sourceDiscovery'
import { ImportSourceService } from '../source/importService'
import type { WeflowAdapter } from '../source/weflowAdapter'
import { rm } from 'node:fs/promises'
import { basename } from 'node:path'

export class ArchiveService {
  private controller?: AbortController

  constructor(
    private readonly repository: ArchiveRepository,
    private readonly sourceImporter: ImportSourceService,
    private readonly adapter: WeflowAdapter
  ) {}

  summary(): Promise<ArchiveSummary> { return this.repository.summary() }
  conversations(query?: ConversationQuery) { return this.repository.listConversations(query) }
  messages(query?: MessageQuery) { return this.repository.listMessages(query) }
  media(query?: MediaQuery) { return this.repository.listMedia(query) }
  people() { return this.repository.listPeople() }
  resolveMediaFile(mediaId: string) { return this.repository.resolveMediaFile(mediaId) }

  cancel(): boolean {
    if (!this.controller) return false
    this.controller.abort()
    return true
  }

  async import(
    request: ImportRequest,
    progress: (event: ImportProgress) => void
  ): Promise<ImportResult> {
    if (this.controller) return { success: false, message: '已有导入任务正在运行。' }
    this.controller = new AbortController()
    const startedAt = new Date().toISOString()
    let stagingDirectory: string | undefined
    try {
      const source = await inspectSource(request.sourcePath)
      if (!source.valid || !source.accountPath) return { success: false, message: source.warnings.join(' ') }
      const existing = await this.repository.readAll()
      const nextFingerprint = sourceFingerprint(source.accountPath)
      if (existing.index && existing.index.sourceFingerprint !== nextFingerprint) {
        return { success: false, message: '当前目录属于另一个微信账号。为避免混合两个人的记录，请为该账号使用新的 WeCat 档案。' }
      }
      const fullAccountId = basename(source.accountPath)
      const ownAccountId = fullAccountId.replace(/_[A-Za-z0-9]{4}$/, '')
      const bundle = await this.sourceImporter.collect(request, this.controller.signal, progress)
      stagingDirectory = bundle.stagingDirectory
      const contacts = new Map(bundle.contacts.map((contact) => [contact.username, contact]))
      const documents = new Map<string, ConversationDocument>(existing.documents.map((document) => [document.conversation.id, document]))
      const assets = []
      const warnings = [...source.warnings, ...bundle.warnings]
      if (bundle.sessions.length >= 1000) warnings.push('会话数量达到 WeFlow 单次列表上限 1000 条，可能仍有更早的非活跃会话未导入。')

      for (let index = 0; index < bundle.exports.length; index += 1) {
        const entry = bundle.exports[index]
        progress({ runId: bundle.runId, phase: 'archive', completed: index, total: bundle.exports.length, detail: '正在整理本地档案' })
        const session = bundle.sessions.find((candidate) => candidate.username === entry.conversationId)
        if (!session) continue
        const normalized = await normalizeWeflowExport(entry.path, session, contacts, bundle.avatars, entry.voices ?? new Map(), bundle.mediaIndex)
        documents.set(entry.conversationId, normalized.document)
        assets.push(...normalized.assets)
        warnings.push(...normalized.warnings)
      }

      const allDocuments = [...documents.values()].map((document) => {
        const contact = contacts.get(document.conversation.id)
        if (!contact) return document
        return {
          ...document,
          conversation: {
            ...document.conversation,
            displayName: contact.remark || contact.nickname || contact.alias || contact.displayName || document.conversation.displayName,
            avatarDataUrl: bundle.avatars.get(document.conversation.id) || document.conversation.avatarDataUrl
          }
        }
      }).sort((a, b) => a.conversation.displayName.localeCompare(b.conversation.displayName, 'zh-CN'))
      const conversationById = new Map(allDocuments.map((document) => [document.conversation.id, document.conversation]))
      const peopleById = new Map(bundle.contacts.map((contact) => [contact.username, contact]))
      const people: Person[] = bundle.contacts.map((contact) => {
        const conversation = conversationById.get(contact.username)
        return {
          id: contact.username,
          displayName: contact.remark || contact.nickname || contact.alias || contact.displayName || contact.username,
          remark: contact.remark,
          nickname: contact.nickname || contact.displayName,
          avatarDataUrl: bundle.avatars.get(contact.username),
          kind: contact.kind || conversation?.kind || (contact.username.endsWith('@chatroom') ? 'group' : contact.username.startsWith('gh_') ? 'official' : 'direct'),
          hasConversation: Boolean(conversation),
          messageCount: conversation?.messageCount ?? 0,
          firstMessageAt: conversation?.firstMessageAt,
          lastMessageAt: conversation?.lastMessageAt
        }
      })
      for (const document of allDocuments) {
        if (peopleById.has(document.conversation.id)) continue
        people.push({ id: document.conversation.id, displayName: document.conversation.displayName, avatarDataUrl: document.conversation.avatarDataUrl, kind: document.conversation.kind, hasConversation: true, messageCount: document.conversation.messageCount, firstMessageAt: document.conversation.firstMessageAt, lastMessageAt: document.conversation.lastMessageAt })
      }
      const allMessages = allDocuments.flatMap((document) => document.messages)
      const allMedia = allMessages.flatMap((message) => message.media ? [message.media] : [])
      const dates = allMessages.map((message) => message.timestamp).sort()
      const years = [...new Set(dates.map((date) => new Date(date).getFullYear()).filter((year) => year > 1970))].sort((a, b) => a - b)
      const coverage = {
        conversationCount: allDocuments.length,
        messageCount: allMessages.length,
        mediaCount: allMedia.length,
        availableMediaCount: allMedia.filter((media) => media.availability === 'available').length,
        missingMediaCount: allMedia.filter((media) => media.availability === 'missing').length,
        unresolvedMediaCount: allMedia.filter((media) => media.availability === 'unresolved').length
      }
      const run = {
        id: bundle.runId,
        startedAt,
        completedAt: new Date().toISOString(),
        status: 'complete' as const,
        adapterVersion: await this.adapter.version(),
        coverage,
        warnings
      }
      const index: ArchiveIndex = {
        schemaVersion: 2,
        sourceFingerprint: nextFingerprint,
        accountLabel: source.accountLabel || '微信账号',
        accountAvatarDataUrl: bundle.avatars.get(ownAccountId) || bundle.avatars.get(fullAccountId),
        firstMessageAt: dates.at(0),
        lastMessageAt: dates.at(-1),
        years,
        conversations: allDocuments.map((document) => ({ ...document.conversation, file: conversationFileName(document.conversation.id) })),
        people,
        moments: existing.index?.moments,
        lastImport: run
      }
      await this.repository.replace({ index, documents: allDocuments, assets })
      progress({ runId: bundle.runId, phase: 'complete', completed: 1, total: 1, detail: '档案已更新' })
      const skipped = bundle.skippedConversations ? `，跳过 ${bundle.skippedConversations} 个无法导出的会话` : ''
      return { success: true, run, message: `已归档 ${coverage.messageCount.toLocaleString('zh-CN')} 条消息${skipped}。` }
    } catch (error) {
      if (this.controller.signal.aborted) return { success: false, message: '导入已取消，上一次完整档案未受影响。' }
      return { success: false, message: error instanceof Error ? error.message : '导入失败，上一次完整档案未受影响。' }
    } finally {
      if (stagingDirectory) await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined)
      this.controller = undefined
    }
  }
}
