import type {
  AnalyticsFilter,
  ArchiveAnalytics,
  ArchiveCoverage,
  Message,
  RankedItem,
  TimeSeriesPoint
} from '../../shared/contracts'
import { emptyCoverage } from '../../shared/contracts'
import type { ArchiveRepository, ConversationDocument } from '../archive/archiveRepository'

const weekdayLabels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function localDateKey(iso: string): string {
  const date = new Date(iso)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function selectedDocuments(documents: ConversationDocument[], filter: AnalyticsFilter): ConversationDocument[] {
  return documents.filter((document) => !filter.conversationId || document.conversation.id === filter.conversationId)
}

export function selectedMessages(documents: ConversationDocument[], filter: AnalyticsFilter): Message[] {
  return selectedDocuments(documents, filter)
    .flatMap((document) => document.messages)
    .filter((message) => !filter.year || new Date(message.timestamp).getFullYear() === filter.year)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id))
}

function countSeries<T extends string | number>(
  values: Iterable<T>,
  labels?: Iterable<{ key: T; label: string }>
): TimeSeriesPoint[] {
  const counts = new Map<T, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  if (labels) return [...labels].map(({ key, label }) => ({ key: String(key), label, value: counts.get(key) ?? 0 }))
  return [...counts.entries()]
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([key, value]) => ({ key: String(key), label: String(key), value }))
}

function longestStreak(dateKeys: string[]): number {
  const days = [...new Set(dateKeys)].sort()
  let longest = 0
  let current = 0
  let previous: number | undefined
  for (const day of days) {
    const timestamp = new Date(`${day}T00:00:00`).getTime()
    current = previous !== undefined && timestamp - previous === 86_400_000 ? current + 1 : 1
    longest = Math.max(longest, current)
    previous = timestamp
  }
  return longest
}

function coverage(messages: Message[], conversationCount: number): ArchiveCoverage {
  const media = messages.flatMap((message) => message.media ? [message.media] : [])
  return {
    conversationCount,
    messageCount: messages.length,
    mediaCount: media.length,
    availableMediaCount: media.filter((item) => item.availability === 'available').length,
    missingMediaCount: media.filter((item) => item.availability === 'missing').length,
    unresolvedMediaCount: media.filter((item) => item.availability === 'unresolved').length
  }
}

export class AnalyticsService {
  constructor(private readonly repository: ArchiveRepository) {}

  async get(filter: AnalyticsFilter = {}): Promise<ArchiveAnalytics> {
    const { documents } = await this.repository.readAll()
    const selected = selectedDocuments(documents, filter)
    const messages = selectedMessages(documents, filter)
    if (!messages.length) {
      return {
        empty: true,
        filter,
        messageCount: 0,
        sentCount: 0,
        receivedCount: 0,
        activeDays: 0,
        averagePerActiveDay: 0,
        longestActiveStreak: 0,
        hourly: Array.from({ length: 24 }, (_, hour) => ({ key: String(hour), label: `${String(hour).padStart(2, '0')}:00`, value: 0 })),
        weekdays: weekdayLabels.map((label, day) => ({ key: String(day), label, value: 0 })),
        monthly: [],
        yearly: [],
        messageKinds: [],
        busiestDays: [],
        topConversations: [],
        coverage: emptyCoverage()
      }
    }

    const dateKeys = messages.map((message) => localDateKey(message.timestamp))
    const activeDays = new Set(dateKeys).size
    const conversationNames = new Map(documents.map((document) => [document.conversation.id, document.conversation.displayName]))
    const conversationCounts = new Map<string, number>()
    for (const message of messages) conversationCounts.set(message.conversationId, (conversationCounts.get(message.conversationId) ?? 0) + 1)
    const topConversations: RankedItem[] = [...conversationCounts.entries()]
      .map(([id, value]) => ({ id, label: conversationNames.get(id) || '未命名会话', value }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'zh-CN'))
      .slice(0, 12)
    const busiestDays = countSeries(dateKeys)
      .map((point) => ({ id: point.key, label: point.label, value: point.value }))
      .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
      .slice(0, 10)

    return {
      empty: false,
      filter,
      messageCount: messages.length,
      sentCount: messages.filter((message) => message.direction === 'sent').length,
      receivedCount: messages.filter((message) => message.direction === 'received').length,
      activeDays,
      averagePerActiveDay: activeDays ? Math.round((messages.length / activeDays) * 10) / 10 : 0,
      firstMessageAt: messages.at(0)?.timestamp,
      lastMessageAt: messages.at(-1)?.timestamp,
      longestActiveStreak: longestStreak(dateKeys),
      hourly: countSeries(
        messages.map((message) => new Date(message.timestamp).getHours()),
        Array.from({ length: 24 }, (_, hour) => ({ key: hour, label: `${String(hour).padStart(2, '0')}:00` }))
      ),
      weekdays: countSeries(
        messages.map((message) => new Date(message.timestamp).getDay()),
        weekdayLabels.map((label, day) => ({ key: day, label }))
      ),
      monthly: countSeries(messages.map((message) => {
        const date = new Date(message.timestamp)
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      })),
      yearly: countSeries(messages.map((message) => new Date(message.timestamp).getFullYear())),
      messageKinds: countSeries(messages.map((message) => message.kind)),
      busiestDays,
      topConversations,
      coverage: coverage(messages, selected.length)
    }
  }
}
