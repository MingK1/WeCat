import type { AnalyticsFilter, MemoryHighlight, Message } from '../../shared/contracts'
import type { ArchiveRepository } from '../archive/archiveRepository'
import { localDateKey, selectedMessages } from './analyticsService'

function clip(text: string, limit = 72): string {
  const plain = text.replace(/\s+/g, ' ').trim()
  return plain.length > limit ? `${plain.slice(0, limit)}…` : plain
}

function busiestDate(messages: Message[]): { date: string; count: number; sample?: Message } | undefined {
  const byDay = new Map<string, Message[]>()
  for (const message of messages) {
    const key = localDateKey(message.timestamp)
    const current = byDay.get(key) ?? []
    current.push(message)
    byDay.set(key, current)
  }
  return [...byDay.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([date, entries]) => ({ date, count: entries.length, sample: entries.find((entry) => entry.kind === 'text') ?? entries[0] }))
    .at(0)
}

export class MemoryHighlightService {
  constructor(private readonly repository: ArchiveRepository) {}

  async get(filter: AnalyticsFilter = {}): Promise<MemoryHighlight[]> {
    const { documents } = await this.repository.readAll()
    const messages = selectedMessages(documents, filter)
    if (!messages.length) return []
    const conversationNames = new Map(documents.map((document) => [document.conversation.id, document.conversation.displayName]))
    const result: MemoryHighlight[] = []
    const first = messages[0]
    result.push({
      id: `first-${first.id}`,
      kind: 'first-message',
      title: '故事从这里开始',
      description: `${conversationNames.get(first.conversationId) || '这段对话'} · ${clip(first.content)}`,
      date: first.timestamp,
      conversationId: first.conversationId,
      messageId: first.id
    })

    const busiest = busiestDate(messages)
    if (busiest?.sample) {
      result.push({
        id: `busy-${busiest.date}`,
        kind: 'busiest-day',
        title: '最热闹的一天',
        description: `${busiest.date} 共留下 ${busiest.count.toLocaleString('zh-CN')} 条记录 · ${clip(busiest.sample.content)}`,
        date: busiest.sample.timestamp,
        conversationId: busiest.sample.conversationId,
        messageId: busiest.sample.id
      })
    }

    const now = new Date()
    const monthDay = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const todayMemories = messages
      .filter((message) => localDateKey(message.timestamp).slice(5) === monthDay && new Date(message.timestamp).getFullYear() < now.getFullYear())
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 8)
    for (const message of todayMemories) {
      const yearsAgo = now.getFullYear() - new Date(message.timestamp).getFullYear()
      result.push({
        id: `today-${message.id}`,
        kind: 'on-this-day',
        title: `${yearsAgo} 年前的今天`,
        description: `${conversationNames.get(message.conversationId) || '一段对话'} · ${clip(message.content)}`,
        date: message.timestamp,
        conversationId: message.conversationId,
        messageId: message.id
      })
    }

    const firstYear = new Date(first.timestamp).getFullYear()
    if (now.getFullYear() > firstYear) {
      result.push({
        id: `anniversary-${first.id}`,
        kind: 'anniversary',
        title: `这份档案已经跨过 ${now.getFullYear() - firstYear} 年`,
        description: `从 ${localDateKey(first.timestamp)} 到今天，仍可回到最初那条记录。`,
        date: first.timestamp,
        conversationId: first.conversationId,
        messageId: first.id
      })
    }
    return result
  }
}
