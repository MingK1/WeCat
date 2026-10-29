import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, normalize, relative, resolve, sep } from 'node:path'
import type { Conversation, MediaKind, MediaRecord, Message, MessageDirection, MessageKind } from '../../shared/contracts'
import type { ArchiveAssetCopy, ConversationDocument } from './archiveRepository'
import type { WeflowContact, WeflowSession } from '../source/weflowAdapter'
import type { WeflowMediaIndexRecord } from '../source/weflowAdapter'

interface RawMessage {
  localId?: number | string
  serverId?: number | string
  localType?: number | string
  createTime?: number | string
  isSend?: number | boolean | null
  senderUsername?: string | null
  senderDisplay?: string | null
  content?: string
  parsedContent?: string
  rawContent?: string
  messageType?: string
  media?: string
  mediaKind?: string
  mediaName?: string
  mediaFileName?: string
  imageFileName?: string
  transcript?: string
  voiceTranscript?: string
  [key: string]: unknown
}

interface Envelope {
  schema?: string
  messages?: RawMessage[]
}

export interface NormalizedConversationExport {
  document: ConversationDocument
  assets: ArchiveAssetCopy[]
  warnings: string[]
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24)
}

function messageKind(raw: RawMessage): MessageKind {
  if (raw.mediaKind === 'file' || raw.mediaName || /^\s*\[文件(?:\]|:)/.test(raw.parsedContent || '')) return 'file'
  const value = String(raw.messageType ?? raw.localType ?? '').toLowerCase()
  const named: Record<string, MessageKind> = {
    text: 'text', image: 'image', voice: 'voice', video: 'video', emoji: 'sticker', sticker: 'sticker',
    file: 'file', card: 'link', link: 'link', location: 'location', call: 'call', system: 'system', quote: 'link', other: 'unknown'
  }
  if (named[value]) return named[value]
  const numeric: Record<string, MessageKind> = {
    '1': 'text', '3': 'image', '34': 'voice', '43': 'video', '47': 'sticker', '48': 'location',
    '49': 'link', '50': 'call', '10000': 'system', '10002': 'link'
  }
  return numeric[value] ?? 'unknown'
}

function mediaKind(kind: MessageKind): MediaKind | undefined {
  return ['image', 'video', 'voice', 'sticker', 'file'].includes(kind) ? kind as MediaKind : undefined
}

function direction(raw: RawMessage, kind: MessageKind): MessageDirection {
  if (kind === 'system') return 'system'
  if (raw.isSend === true || raw.isSend === 1) return 'sent'
  if (raw.isSend === false || raw.isSend === 0) return 'received'
  return 'unknown'
}

function timestamp(raw: RawMessage): string {
  const numeric = Number(raw.createTime)
  if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric * (numeric > 10_000_000_000 ? 1 : 1000)).toISOString()
  return new Date(0).toISOString()
}

function stableMessageId(conversationId: string, raw: RawMessage, time: string, content: string): string {
  const serverId = String(raw.serverId ?? '').trim()
  if (serverId && serverId !== '0') return shortHash(`${conversationId}|server:${serverId}`)
  const localId = String(raw.localId ?? '').trim()
  if (localId) return shortHash(`${conversationId}|local:${localId}|${time}`)
  return shortHash(`${conversationId}|fallback:${time}|${content}`)
}

function kindForSession(session: WeflowSession): Conversation['kind'] {
  if (session.username.endsWith('@chatroom')) return 'group'
  if (session.username.startsWith('gh_')) return 'official'
  return session.username ? 'direct' : 'unknown'
}

function contentFor(raw: RawMessage, kind: MessageKind): string {
  const transcript = raw.transcript || raw.voiceTranscript
  const content = raw.parsedContent || raw.content || raw.rawContent || ''
  if (kind === 'voice' && transcript) return `${content || '[语音]'}\n${transcript}`.trim()
  return content || `[${kind === 'unknown' ? '未知消息' : kind}]`
}

function safeRelativeMediaPath(exportFile: string, mediaPath: string): { source: string; relative: string } | undefined {
  const outputDir = dirname(exportFile)
  const source = isAbsolute(mediaPath) ? normalize(mediaPath) : resolve(outputDir, mediaPath)
  const rel = relative(outputDir, source)
  if (!rel || rel.startsWith('..') || rel.includes(`..${sep}`)) return undefined
  const parts = rel.split(/[\\/]+/).filter(Boolean)
  const trimmed = parts.length > 1 && parts[0].endsWith('_assets') ? parts.slice(1) : parts
  return { source, relative: trimmed.join('/') }
}

export async function normalizeWeflowExport(
  exportFile: string,
  session: WeflowSession,
  contacts: Map<string, WeflowContact>,
  avatars: Map<string, string>,
  voices: Map<string, { path: string; bytes: number }>,
  mediaIndex: WeflowMediaIndexRecord[]
): Promise<NormalizedConversationExport> {
  const rawPayload = JSON.parse(await readFile(exportFile, 'utf8')) as Envelope | RawMessage[]
  const rawMessages = Array.isArray(rawPayload) ? rawPayload : Array.isArray(rawPayload.messages) ? rawPayload.messages : []
  const conversationKey = shortHash(session.username)
  const assets: ArchiveAssetCopy[] = []
  const warnings: string[] = []
  const seenAssets = new Set<string>()
  const messages: Message[] = []

  for (const raw of rawMessages) {
    const kind = messageKind(raw)
    const time = timestamp(raw)
    const content = contentFor(raw, kind)
    const id = stableMessageId(session.username, raw, time, content)
    const senderContact = raw.senderUsername ? contacts.get(raw.senderUsername) : undefined
    const message: Message = {
      id,
      conversationId: session.username,
      senderId: raw.senderUsername ?? undefined,
      senderName: senderContact?.remark || senderContact?.nickname || raw.senderDisplay || senderContact?.displayName || undefined,
      direction: direction(raw, kind),
      timestamp: time,
      kind,
      content,
      rawType: String(raw.localType ?? raw.messageType ?? ''),
      sourceLocalId: raw.localId === undefined ? undefined : String(raw.localId),
      sourceServerId: raw.serverId === undefined ? undefined : String(raw.serverId)
    }

    const mediaType = raw.mediaKind === 'file' ? 'file' : mediaKind(kind)
    if (mediaType) {
      const rawText = `${raw.content || ''} ${raw.rawContent || ''} ${raw.parsedContent || ''}`
      const md5s = [...rawText.matchAll(/\b[a-fA-F0-9]{32}\b/g)].map((match) => match[0].toLowerCase())
      const exactVideo = mediaType === 'video'
        ? mediaIndex.filter((record) => record.kind === 'video' && record.exists && record.path && md5s.includes(String(record.md5 || '').toLowerCase()))
        : []
      const voice = mediaType === 'voice' ? voices.get(String(raw.localId ?? '')) : undefined
      const located = voice
        ? { source: voice.path, relative: `${raw.localId}.wav` }
        : exactVideo.length === 1
          ? { source: exactVideo[0].path!, relative: basename(exactVideo[0].path!) }
          : raw.media ? safeRelativeMediaPath(exportFile, raw.media) : undefined
      let availability: MediaRecord['availability'] = located ? 'available' : 'unresolved'
      let size: number | undefined
      let pathToken: string | undefined
      if (located) {
        try {
          const metadata = await stat(located.source)
          if (!metadata.isFile()) availability = 'missing'
          else {
            size = metadata.size
            const assetClass = mediaType === 'voice' ? 'audio' : mediaType === 'video' ? 'video' : 'media'
            pathToken = `assets/${conversationKey}/${assetClass}/${located.relative}`
            if (!seenAssets.has(pathToken)) {
              assets.push({ source: located.source, destination: pathToken })
              seenAssets.add(pathToken)
            }
          }
        } catch {
          availability = 'missing'
        }
      }
      const originalName = raw.mediaName || raw.mediaFileName || raw.imageFileName || (voice ? `${raw.localId}.wav` : exactVideo.length === 1 ? exactVideo[0].file : raw.media ? basename(raw.media) : undefined)
      message.media = {
        id: shortHash(`${id}|${mediaType}`),
        messageId: id,
        conversationId: session.username,
        kind: mediaType,
        originalName,
        extension: originalName ? extname(originalName).replace(/^\./, '').toLowerCase() || undefined : undefined,
        size: size ?? voice?.bytes ?? (exactVideo.length === 1 ? exactVideo[0].size : undefined),
        pathToken,
        availability,
        confidence: located ? 'exact' : 'unknown',
        createdAt: time,
        direction: message.direction
      }
    }
    messages.push(message)
  }

  messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id))
  const uniqueMessages = [...new Map(messages.map((message) => [message.id, message])).values()]
  if (uniqueMessages.length !== messages.length) warnings.push(`${session.displayName || '会话'} 有 ${messages.length - uniqueMessages.length} 条重复记录已合并。`)
  const conversation: Conversation = {
    id: session.username,
    displayName: contacts.get(session.username)?.remark || contacts.get(session.username)?.nickname || session.displayName || contacts.get(session.username)?.displayName || session.username,
    kind: kindForSession(session),
    avatarDataUrl: avatars.get(session.username),
    messageCount: uniqueMessages.length,
    firstMessageAt: uniqueMessages.at(0)?.timestamp,
    lastMessageAt: uniqueMessages.at(-1)?.timestamp
  }
  return { document: { conversation, messages: uniqueMessages }, assets, warnings }
}

export function conversationFileName(conversationId: string): string {
  return `conversations/${shortHash(conversationId)}.json`
}

export function sourceFingerprint(accountPath: string): string {
  return shortHash(basename(normalize(accountPath)).toLocaleLowerCase('en-US'))
}
