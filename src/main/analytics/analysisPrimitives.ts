import type {
  AnalysisWindow,
  ComparisonValue,
  Message,
  MessageDirection,
  ParticipationBreakdown
} from '../../shared/contracts'

export const DAY_MS = 86_400_000
export const CONVERSATION_START_MS = 12 * 60 * 60 * 1000

function localStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function shiftDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function window(from: Date, to: Date, label: string, days: number): AnalysisWindow {
  return { from: from.toISOString(), to: to.toISOString(), label, days }
}

export function analysisWindows(now = new Date()): {
  current: AnalysisWindow
  previous: AnalysisWindow
  historical: AnalysisWindow
  yearAgo: AnalysisWindow
} {
  const today = localStart(now)
  const currentFrom = shiftDays(today, -29)
  const currentTo = shiftDays(today, 1)
  const previousFrom = shiftDays(currentFrom, -30)
  const historicalFrom = shiftDays(currentFrom, -365)
  const yearAgoFrom = new Date(currentFrom.getFullYear() - 1, currentFrom.getMonth(), currentFrom.getDate())
  const yearAgoTo = new Date(currentTo.getFullYear() - 1, currentTo.getMonth(), currentTo.getDate())
  return {
    current: window(currentFrom, currentTo, '最近 30 天', 30),
    previous: window(previousFrom, currentFrom, '此前 30 天', 30),
    historical: window(historicalFrom, currentFrom, '此前 12 个月', 365),
    yearAgo: window(yearAgoFrom, yearAgoTo, '去年同期', 30)
  }
}

export function validMessageTime(message: Message): number | undefined {
  const value = new Date(message.timestamp).getTime()
  return Number.isFinite(value) ? value : undefined
}

export function messagesInWindow(messages: Message[], range: AnalysisWindow): Message[] {
  const from = new Date(range.from).getTime()
  const to = new Date(range.to).getTime()
  return messages.filter((message) => {
    const value = validMessageTime(message)
    return value !== undefined && value >= from && value < to
  })
}

export function localDateKey(iso: string): string | undefined {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return undefined
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function countCharacters(messages: Message[]): number {
  return messages.reduce((sum, message) => sum + (message.kind === 'text' ? [...message.content].length : 0), 0)
}

export function conversationStarts(messages: Message[], contextMessages: Message[] = messages): { sent: number; received: number } {
  const selectedIds = new Set(messages.map((message) => message.id))
  const ordered = contextMessages
    .filter((message) => message.direction === 'sent' || message.direction === 'received')
    .map((message) => ({ message, time: validMessageTime(message) }))
    .filter((entry): entry is { message: Message; time: number } => entry.time !== undefined)
    .sort((a, b) => a.time - b.time || a.message.id.localeCompare(b.message.id))
  let sent = 0
  let received = 0
  for (let index = 0; index < ordered.length; index += 1) {
    if (!selectedIds.has(ordered[index].message.id)) continue
    if (index > 0 && ordered[index].time - ordered[index - 1].time < CONVERSATION_START_MS) continue
    if (ordered[index].message.direction === 'sent') sent += 1
    else received += 1
  }
  return { sent, received }
}

export function directionBreakdown(messages: Message[], direction: MessageDirection, contextMessages: Message[] = messages): ParticipationBreakdown {
  const selected = messages.filter((message) => message.direction === direction)
  const starts = conversationStarts(messages, contextMessages)
  const knownKinds = new Set(['text', 'image', 'video', 'voice', 'sticker', 'file'])
  return {
    messages: selected.length,
    textMessages: selected.filter((message) => message.kind === 'text').length,
    textCharacters: countCharacters(selected),
    images: selected.filter((message) => message.kind === 'image').length,
    videos: selected.filter((message) => message.kind === 'video').length,
    voices: selected.filter((message) => message.kind === 'voice').length,
    stickers: selected.filter((message) => message.kind === 'sticker').length,
    files: selected.filter((message) => message.kind === 'file').length,
    other: selected.filter((message) => !knownKinds.has(message.kind)).length,
    conversationStarts: direction === 'sent' ? starts.sent : direction === 'received' ? starts.received : 0,
    activeDays: new Set(selected.map((message) => localDateKey(message.timestamp)).filter(Boolean)).size
  }
}

export function compare(current: number, previous: number): ComparisonValue {
  return {
    current,
    previous,
    delta: current - previous,
    changePercent: previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : undefined
  }
}

export function share(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 1000) / 10 : 0
}
