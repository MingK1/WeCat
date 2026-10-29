import { copyFile, cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, resolve, sep } from 'node:path'
import type {
  ArchiveSummary,
  Conversation,
  ConversationQuery,
  MediaQuery,
  MediaRecord,
  Message,
  MessageQuery,
  Person,
  PagedResult
} from '../../shared/contracts'
import { emptyCoverage } from '../../shared/contracts'
import type { ArchiveIndex, ArchiveRepository, ArchiveWriteRequest, ConversationDocument } from './archiveRepository'

const INDEX_FILE = 'index.json'

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

function page<T>(items: T[], limit = 100, offset = 0): PagedResult<T> {
  const boundedLimit = Math.max(1, Math.min(limit, 500))
  const boundedOffset = Math.max(0, offset)
  return { items: items.slice(boundedOffset, boundedOffset + boundedLimit), total: items.length, limit: boundedLimit, offset: boundedOffset }
}

function contains(root: string, candidate: string): boolean {
  const relative = normalize(candidate).slice(resolve(root).length)
  return relative === '' || relative.startsWith(sep)
}

export class JsonArchiveRepository implements ArchiveRepository {
  private readonly currentPath: string
  private cache?: { index: ArchiveIndex; documents: ConversationDocument[] }

  constructor(private readonly rootPath: string) {
    this.currentPath = join(rootPath, 'current')
  }

  private async recoverInterruptedPromotion(): Promise<void> {
    const backupPath = join(this.rootPath, '.previous')
    if (await exists(this.currentPath) || !(await exists(backupPath))) return
    try {
      await rename(backupPath, this.currentPath)
    } catch {
      if (!(await exists(this.currentPath))) throw new Error('无法恢复上一次完整档案。')
    }
  }

  private async readIndex(): Promise<ArchiveIndex | undefined> {
    if (this.cache) return this.cache.index
    await this.recoverInterruptedPromotion()
    try {
      const index = await readJson<ArchiveIndex>(join(this.currentPath, INDEX_FILE))
      return index.schemaVersion === 1 || index.schemaVersion === 2 ? index : undefined
    } catch {
      return undefined
    }
  }

  private async readDocument(file: string): Promise<ConversationDocument | undefined> {
    const target = resolve(this.currentPath, file)
    if (!contains(this.currentPath, target)) return undefined
    try {
      return await readJson<ConversationDocument>(target)
    } catch {
      return undefined
    }
  }

  async readAll(): Promise<{ index?: ArchiveIndex; documents: ConversationDocument[] }> {
    if (this.cache) return this.cache
    const index = await this.readIndex()
    if (!index) return { documents: [] }
    const documents = (await Promise.all(index.conversations.map((conversation) => this.readDocument(conversation.file))))
      .filter((document): document is ConversationDocument => document !== undefined)
    this.cache = { index, documents }
    return this.cache
  }

  async summary(): Promise<ArchiveSummary> {
    const index = await this.readIndex()
    if (!index) return { exists: false, schemaVersion: 1, years: [], coverage: emptyCoverage() }
    return {
      exists: true,
      schemaVersion: index.schemaVersion,
      accountLabel: index.accountLabel,
      accountAvatarDataUrl: index.accountAvatarDataUrl,
      firstMessageAt: index.firstMessageAt,
      lastMessageAt: index.lastMessageAt,
      years: index.years,
      coverage: index.lastImport.coverage,
      lastImport: index.lastImport,
      peopleCount: index.people?.length ?? 0
    }
  }

  async listConversations(query: ConversationQuery = {}): Promise<PagedResult<Conversation>> {
    const index = await this.readIndex()
    const search = query.search?.trim().toLocaleLowerCase('zh-CN') ?? ''
    const conversations = (index?.conversations ?? [])
      .filter((conversation) => query.kind === undefined || query.kind === 'all' || conversation.kind === query.kind)
      .filter((conversation) => !search || conversation.displayName.toLocaleLowerCase('zh-CN').includes(search))
      .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))
      .map(({ file: _file, ...conversation }) => conversation)
    return page(conversations, query.limit ?? 100, query.offset ?? 0)
  }

  async listMessages(query: MessageQuery = {}): Promise<PagedResult<Message>> {
    const { documents } = await this.readAll()
    const search = query.search?.trim().toLocaleLowerCase('zh-CN') ?? ''
    const messages = documents
      .filter((document) => !query.conversationId || document.conversation.id === query.conversationId)
      .flatMap((document) => document.messages)
      .filter((message) => !query.messageId || message.id === query.messageId)
      .filter((message) => !query.kinds?.length || query.kinds.includes(message.kind))
      .filter((message) => !query.direction || query.direction === 'all' || message.direction === query.direction)
      .filter((message) => !query.year || new Date(message.timestamp).getFullYear() === query.year)
      .filter((message) => !query.from || message.timestamp >= query.from)
      .filter((message) => !query.to || message.timestamp <= query.to)
      .filter((message) => !search || `${message.senderName ?? ''} ${message.content}`.toLocaleLowerCase('zh-CN').includes(search))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id))
    return page(messages, query.limit ?? 100, query.offset ?? 0)
  }

  async listMedia(query: MediaQuery = {}): Promise<PagedResult<MediaRecord>> {
    const { documents } = await this.readAll()
    const search = query.search?.trim().toLocaleLowerCase('zh-CN') ?? ''
    const media = documents
      .filter((document) => !query.conversationId || document.conversation.id === query.conversationId)
      .flatMap((document) => document.messages.flatMap((message) => message.media ? [message.media] : []))
      .filter((record) => !query.kinds?.length || query.kinds.includes(record.kind))
      .filter((record) => !query.availability || query.availability === 'all' || record.availability === query.availability)
      .filter((record) => !query.year || new Date(record.createdAt).getFullYear() === query.year)
      .filter((record) => !search || (record.originalName ?? '').toLocaleLowerCase('zh-CN').includes(search))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    return page(media, query.limit ?? 100, query.offset ?? 0)
  }

  async listPeople(): Promise<Person[]> {
    const index = await this.readIndex()
    return index?.people ?? []
  }

  async resolveMediaFile(mediaId: string): Promise<string | undefined> {
    const { documents } = await this.readAll()
    const record = documents
      .flatMap((document) => document.messages)
      .map((message) => message.media)
      .find((media) => media?.id === mediaId)
    if (!record?.pathToken || record.availability !== 'available') return undefined
    const target = resolve(this.currentPath, record.pathToken)
    if (!contains(this.currentPath, target)) return undefined
    try {
      return (await stat(target)).isFile() ? target : undefined
    } catch {
      return undefined
    }
  }

  async replace(request: ArchiveWriteRequest): Promise<void> {
    await mkdir(this.rootPath, { recursive: true })
    await this.recoverInterruptedPromotion()
    const stagingPath = join(this.rootPath, `.staging-${request.index.lastImport.id}`)
    const backupPath = join(this.rootPath, '.previous')
    await rm(stagingPath, { recursive: true, force: true })

    if (!(await exists(this.currentPath)) && await exists(backupPath)) {
      await rename(backupPath, this.currentPath)
    } else if (await exists(this.currentPath)) {
      await rm(backupPath, { recursive: true, force: true })
    }

    if (await exists(this.currentPath)) await cp(this.currentPath, stagingPath, { recursive: true })
    else await mkdir(stagingPath, { recursive: true })

    await mkdir(join(stagingPath, 'conversations'), { recursive: true })
    for (const document of request.documents) {
      const file = request.index.conversations.find((entry) => entry.id === document.conversation.id)?.file
      if (!file) continue
      const target = resolve(stagingPath, file)
      if (!contains(stagingPath, target)) throw new Error('档案文件路径越界。')
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, JSON.stringify(document), 'utf8')
    }

    for (const asset of request.assets) {
      const target = resolve(stagingPath, asset.destination)
      if (!contains(stagingPath, target)) throw new Error('媒体文件路径越界。')
      await mkdir(dirname(target), { recursive: true })
      await copyFile(asset.source, target)
    }

    await writeFile(join(stagingPath, INDEX_FILE), JSON.stringify(request.index), 'utf8')
    try {
      if (await exists(this.currentPath)) await rename(this.currentPath, backupPath)
      await rename(stagingPath, this.currentPath)
      await rm(backupPath, { recursive: true, force: true }).catch(() => undefined)
      this.cache = { index: request.index, documents: request.documents }
    } catch (error) {
      if (!(await exists(this.currentPath)) && await exists(backupPath)) await rename(backupPath, this.currentPath)
      await rm(stagingPath, { recursive: true, force: true })
      throw error
    }
  }
}
