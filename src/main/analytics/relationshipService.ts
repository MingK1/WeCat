import type {
  AnalysisWindow,
  DirectionSeriesPoint,
  Message,
  ParticipationBreakdown,
  PersonalAnalysis,
  RelationshipDayPoint,
  RelationshipDetail,
  RelationshipInsight,
  RelationshipObservation,
  RelationshipOverview,
  TimeSeriesPoint,
  WordFrequency
} from '../../shared/contracts'
import type { ArchiveRepository, ConversationDocument } from '../archive/archiveRepository'
import {
  analysisWindows,
  compare,
  CONVERSATION_START_MS,
  countCharacters,
  directionBreakdown,
  localDateKey,
  messagesInWindow,
  share,
  validMessageTime
} from './analysisPrimitives'
import { topicClues } from './topicAnalysis'

const DAY_MS = 86_400_000
const MAX_REPLY_MS = 7 * DAY_MS
const NON_RELATIONSHIP_IDS = new Set(['filehelper', 'weixin', 'fmessage', 'newsapp', 'medianote', 'floatbottle', 'brandsessionholder', 'notification_messages', 'notifymessage'])
const STOP_WORDS = new Set([
  '的', '了', '是', '我', '你', '他', '她', '它', '啊', '呀', '吗', '呢', '吧', '和', '与', '也', '都', '就', '在', '有', '没',
  '没有', '一个', '这个', '那个', '什么', '怎么', '为什么', '可以', '不是', '就是', '然后', '但是', '因为', '所以', '还是',
  '已经', '现在', '今天', '明天', '昨天', '我们', '你们', '他们', '自己', '这样', '那样', '一下', '一些', '哈哈', '哈哈哈'
])

interface BuiltRelationship {
  document: ConversationDocument
  insight: RelationshipInsight
  allMessages: Message[]
  currentMessages: Message[]
  previousMessages: Message[]
  historicalMessages: Message[]
  yearAgoMessages: Message[]
  resumed: boolean
}

function relationshipMessages(document: ConversationDocument): Message[] {
  return document.messages
    .filter((message) => (message.direction === 'sent' || message.direction === 'received') && validMessageTime(message) !== undefined)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id))
}

function directDocuments(documents: ConversationDocument[]): ConversationDocument[] {
  return documents.filter((document) =>
    document.conversation.kind === 'direct' &&
    document.messages.length > 0 &&
    !NON_RELATIONSHIP_IDS.has(document.conversation.id.toLocaleLowerCase('en-US'))
  )
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function gapDays(messages: Message[]): number {
  let longest = 0
  for (let index = 1; index < messages.length; index += 1) {
    const previous = validMessageTime(messages[index - 1])
    const current = validMessageTime(messages[index])
    if (previous === undefined || current === undefined) continue
    longest = Math.max(longest, (current - previous) / DAY_MS)
  }
  return Math.round(longest)
}

function activeStreak(messages: Message[]): number {
  const days = [...new Set(messages.map((message) => localDateKey(message.timestamp)).filter((value): value is string => Boolean(value)))].sort()
  let current = 0
  let longest = 0
  let previous: number | undefined
  for (const day of days) {
    const value = new Date(`${day}T00:00:00`).getTime()
    current = previous !== undefined && value - previous === DAY_MS ? current + 1 : 1
    longest = Math.max(longest, current)
    previous = value
  }
  return longest
}

function typicalGapDays(messages: Message[]): number | undefined {
  const days = [...new Set(messages.map((message) => localDateKey(message.timestamp)).filter((value): value is string => Boolean(value)))].sort()
  const gaps = days.slice(1).map((day, index) => (new Date(`${day}T00:00:00`).getTime() - new Date(`${days[index]}T00:00:00`).getTime()) / DAY_MS)
  return median(gaps)
}

function replyMedians(messages: Message[]): { toThem?: number; toMe?: number } {
  const toThem: number[] = []
  const toMe: number[] = []
  for (let index = 1; index < messages.length; index += 1) {
    const previous = messages[index - 1]
    const current = messages[index]
    if (current.direction === previous.direction) continue
    const currentTime = validMessageTime(current)
    const previousTime = validMessageTime(previous)
    if (currentTime === undefined || previousTime === undefined) continue
    const gap = currentTime - previousTime
    if (gap < 0 || gap > MAX_REPLY_MS) continue
    if (current.direction === 'sent') toThem.push(gap / 60_000)
    else toMe.push(gap / 60_000)
  }
  return { toThem: median(toThem), toMe: median(toMe) }
}

function conversationStartCounts(messages: Message[], contextMessages: Message[] = messages): { sent: number; received: number } {
  const selectedIds = new Set(messages.map((message) => message.id))
  let sent = 0
  let received = 0
  for (let index = 0; index < contextMessages.length; index += 1) {
    const message = contextMessages[index]
    if (!selectedIds.has(message.id)) continue
    const currentTime = validMessageTime(message)
    const previousTime = index ? validMessageTime(contextMessages[index - 1]) : undefined
    if (currentTime === undefined || (previousTime !== undefined && currentTime - previousTime < CONVERSATION_START_MS)) continue
    if (message.direction === 'sent') sent += 1
    else if (message.direction === 'received') received += 1
  }
  return { sent, received }
}

function resumedRelationship(messages: Message[], current: Message[], window: AnalysisWindow): boolean {
  if (current.length < 5) return false
  const currentFrom = new Date(window.from).getTime()
  const before = messages.filter((message) => (validMessageTime(message) ?? currentFrom) < currentFrom).at(-1)
  const firstCurrent = current.at(0)
  if (!before || !firstCurrent) return false
  return (validMessageTime(firstCurrent)! - validMessageTime(before)!) / DAY_MS >= 90
}

function buildBase(
  document: ConversationDocument,
  now: Date,
  currentWindow: AnalysisWindow,
  previousWindow: AnalysisWindow,
  historicalWindow: AnalysisWindow,
  yearAgoWindow: AnalysisWindow
): BuiltRelationship {
  const messages = relationshipMessages(document)
  const currentMessages = messagesInWindow(messages, currentWindow)
  const previousMessages = messagesInWindow(messages, previousWindow)
  const historicalMessages = messagesInWindow(messages, historicalWindow)
  const yearAgoMessages = messagesInWindow(messages, yearAgoWindow)
  const allStarts = conversationStartCounts(messages)
  const currentStarts = conversationStartCounts(currentMessages, messages)
  const currentDays = new Set(currentMessages.map((message) => localDateKey(message.timestamp)).filter(Boolean)).size
  const previousDays = new Set(previousMessages.map((message) => localDateKey(message.timestamp)).filter(Boolean)).size
  const sentCount = messages.filter((message) => message.direction === 'sent').length
  const receivedCount = messages.filter((message) => message.direction === 'received').length
  const currentSentCount = currentMessages.filter((message) => message.direction === 'sent').length
  const currentReceivedCount = currentMessages.filter((message) => message.direction === 'received').length
  const activeDays = new Set(messages.map((message) => localDateKey(message.timestamp)).filter(Boolean)).size
  const reply = replyMedians(messages)
  const last = messages.at(-1)?.timestamp
  const lastTime = last ? new Date(last).getTime() : now.getTime()
  const daysSinceLastContact = Math.max(0, Math.floor((now.getTime() - lastTime) / DAY_MS))
  const recent = (days: number): number => messages.filter((message) => {
    const value = validMessageTime(message)
    return value !== undefined && value <= now.getTime() && now.getTime() - value <= days * DAY_MS
  }).length
  const volumeScore = Math.min(40, Math.log10(messages.length + 1) / 5 * 40)
  const dayScore = Math.min(35, Math.log10(activeDays + 1) / 3 * 35)
  const recencyScore = Math.max(0, 25 * Math.exp(-daysSinceLastContact / 180))
  const messageDelta = currentMessages.length - previousMessages.length
  const firstTime = messages.at(0) ? validMessageTime(messages[0]) : undefined
  const currentFrom = new Date(currentWindow.from).getTime()
  const historyDays = firstTime === undefined ? 0 : Math.min(365, Math.max(0, Math.floor((currentFrom - firstTime) / DAY_MS)))
  const historicalSufficient = historyDays >= 90
  const resumed = resumedRelationship(messages, currentMessages, currentWindow)
  const rising = currentMessages.length >= 20 && currentDays >= 3 && messageDelta >= 10 && (previousMessages.length === 0 || currentMessages.length >= previousMessages.length * 1.5)
  const cooling = previousMessages.length >= 20 && currentMessages.length <= previousMessages.length * 0.5 && messageDelta <= -10
  const trend = rising ? 'rising' : resumed ? 'reconnected' : currentMessages.length === 0 ? 'inactive' : cooling ? 'cooling' : 'stable'
  return {
    document,
    allMessages: messages,
    currentMessages,
    previousMessages,
    historicalMessages,
    yearAgoMessages,
    resumed,
    insight: {
      conversationId: document.conversation.id,
      displayName: document.conversation.displayName,
      avatarDataUrl: document.conversation.avatarDataUrl,
      messageCount: messages.length,
      activeDays,
      activeMonths: new Set(messages.map((message) => message.timestamp.slice(0, 7))).size,
      firstMessageAt: messages.at(0)?.timestamp,
      lastMessageAt: last,
      daysSinceLastContact,
      sentCount,
      receivedCount,
      initiatedByMe: allStarts.sent,
      initiatedByThem: allStarts.received,
      medianReplyToThemMinutes: reply.toThem,
      medianReplyToMeMinutes: reply.toMe,
      lateNightCount: messages.filter((message) => new Date(message.timestamp).getHours() < 5).length,
      recent30Days: recent(30),
      recent90Days: recent(90),
      recent365Days: recent(365),
      longestSilenceDays: gapDays(messages),
      longestActiveStreak: activeStreak(messages),
      relationshipScore: Math.round(volumeScore + dayScore + recencyScore),
      trend,
      currentMessages: currentMessages.length,
      previousMessages: previousMessages.length,
      messageDelta,
      growthPercent: previousMessages.length ? Math.round((messageDelta / previousMessages.length) * 1000) / 10 : undefined,
      currentRank: 0,
      previousRank: undefined,
      rankChange: undefined,
      currentActiveDays: currentDays,
      previousActiveDays: previousDays,
      currentSentCount,
      currentReceivedCount,
      currentSentCharacters: countCharacters(currentMessages.filter((message) => message.direction === 'sent')),
      currentReceivedCharacters: countCharacters(currentMessages.filter((message) => message.direction === 'received')),
      currentSentStickers: currentMessages.filter((message) => message.direction === 'sent' && message.kind === 'sticker').length,
      currentReceivedStickers: currentMessages.filter((message) => message.direction === 'received' && message.kind === 'sticker').length,
      currentInitiatedByMe: currentStarts.sent,
      currentInitiatedByThem: currentStarts.received,
      sentShare: share(currentSentCount, currentSentCount + currentReceivedCount),
      growthScore: 0,
      historicalAverage30: historicalSufficient ? Math.round((historicalMessages.length / historyDays) * 300) / 10 : undefined,
      yearAgoMessages: yearAgoMessages.length,
      yearAgoAvailable: firstTime !== undefined && firstTime < new Date(yearAgoWindow.to).getTime(),
      historicalSufficient,
      typicalGapDays: typicalGapDays(messages)
    }
  }
}

function assignRanks(items: BuiltRelationship[]): void {
  const rank = (field: 'currentMessages' | 'previousMessages'): Map<string, number> => new Map(
    [...items]
      .sort((a, b) => b.insight[field] - a.insight[field] || a.insight.displayName.localeCompare(b.insight.displayName, 'zh-CN') || a.insight.conversationId.localeCompare(b.insight.conversationId))
      .map((item, index) => [item.insight.conversationId, index + 1])
  )
  const currentRanks = rank('currentMessages')
  const previousRanks = rank('previousMessages')
  for (const item of items) {
    const currentRank = currentRanks.get(item.insight.conversationId) ?? items.length
    const previousRank = previousRanks.get(item.insight.conversationId) ?? items.length
    const rankChange = previousRank - currentRank
    const activeDayDelta = item.insight.currentActiveDays - item.insight.previousActiveDays
    const previousStarts = conversationStartCounts(item.previousMessages, item.allMessages)
    const startDelta = item.insight.currentInitiatedByMe + item.insight.currentInitiatedByThem - previousStarts.sent - previousStarts.received
    item.insight.currentRank = currentRank
    item.insight.previousRank = previousRank
    item.insight.rankChange = rankChange
    item.insight.growthScore = Math.min(200, item.insight.messageDelta) + 12 * activeDayDelta + 8 * rankChange + 4 * startDelta + (item.resumed ? 60 : 0)
  }
}

function ownWords(documents: ConversationDocument[]): WordFrequency[] {
  const counts = new Map<string, number>()
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })
  for (const message of documents.flatMap((document) => document.messages)) {
    if (message.direction !== 'sent' || message.kind !== 'text') continue
    for (const part of segmenter.segment(message.content.toLocaleLowerCase('zh-CN'))) {
      const word = part.segment.trim()
      if (!part.isWordLike || word.length < 2 || word.length > 12 || STOP_WORDS.has(word) || /^\d+$/.test(word)) continue
      counts.set(word, (counts.get(word) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, 'zh-CN'))
    .slice(0, 100)
}

function countSeries(values: number[], labels: string[]): TimeSeriesPoint[] {
  const counts = new Map<number, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return labels.map((label, index) => ({ key: String(index), label, value: counts.get(index) ?? 0 }))
}

function textSeries(values: string[]): TimeSeriesPoint[] {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({ key, label: key, value }))
}

function mergeBreakdowns(values: ParticipationBreakdown[], messages: Message[]): ParticipationBreakdown {
  const sum = (key: keyof ParticipationBreakdown): number => values.reduce((total, value) => total + value[key], 0)
  return {
    messages: sum('messages'),
    textMessages: sum('textMessages'),
    textCharacters: sum('textCharacters'),
    images: sum('images'),
    videos: sum('videos'),
    voices: sum('voices'),
    stickers: sum('stickers'),
    files: sum('files'),
    other: sum('other'),
    conversationStarts: sum('conversationStarts'),
    activeDays: new Set(messages.map((message) => localDateKey(message.timestamp)).filter(Boolean)).size
  }
}

function personalAnalysis(items: BuiltRelationship[], currentWindow: AnalysisWindow, previousWindow: AnalysisWindow): PersonalAnalysis {
  const currentMessages = items.flatMap((item) => item.currentMessages)
  const previousMessages = items.flatMap((item) => item.previousMessages)
  const historicalMessages = items.flatMap((item) => item.historicalMessages)
  const yearAgoMessages = items.flatMap((item) => item.yearAgoMessages)
  const allSent = items.flatMap((item) => item.allMessages).filter((message) => message.direction === 'sent')
  const currentSent = currentMessages.filter((message) => message.direction === 'sent')
  const previousSent = previousMessages.filter((message) => message.direction === 'sent')
  const historicalSent = historicalMessages.filter((message) => message.direction === 'sent')
  const yearAgoSent = yearAgoMessages.filter((message) => message.direction === 'sent')
  const sentByContact = items.map((item) => ({
    conversationId: item.insight.conversationId,
    displayName: item.insight.displayName,
    currentSent: item.insight.currentSentCount,
    previousSent: item.previousMessages.filter((message) => message.direction === 'sent').length
  }))
  const currentSentTotal = currentSent.length
  const previousSentTotal = previousSent.length
  const ordered = [...sentByContact].sort((a, b) => b.currentSent - a.currentSent || a.displayName.localeCompare(b.displayName, 'zh-CN'))
  const topShare = (limit: number): number => share(ordered.slice(0, limit).reduce((sum, item) => sum + item.currentSent, 0), currentSentTotal)
  const averageLength = (messages: Message[]): number => {
    const texts = messages.filter((message) => message.kind === 'text')
    return texts.length ? Math.round((countCharacters(texts) / texts.length) * 10) / 10 : 0
  }
  const kindCounts = new Map<string, number>()
  for (const message of currentSent) kindCounts.set(message.kind, (kindCounts.get(message.kind) ?? 0) + 1)
  const earliest = items.flatMap((item) => item.allMessages.slice(0, 1)).map((message) => validMessageTime(message)).filter((value): value is number => value !== undefined).sort((a, b) => a - b)[0]
  const currentFrom = new Date(currentWindow.from).getTime()
  const yearAgoTo = new Date(currentWindow.to)
  yearAgoTo.setFullYear(yearAgoTo.getFullYear() - 1)
  const historyDays = earliest === undefined ? 0 : Math.min(365, Math.max(0, Math.floor((currentFrom - earliest) / DAY_MS)))
  const currentBreakdowns = items.map((item) => directionBreakdown(item.currentMessages, 'sent', item.allMessages))
  const previousBreakdowns = items.map((item) => directionBreakdown(item.previousMessages, 'sent', item.allMessages))
  return {
    currentWindow,
    previousWindow,
    current: mergeBreakdowns(currentBreakdowns, currentSent),
    previous: mergeBreakdowns(previousBreakdowns, previousSent),
    activeContacts: compare(items.filter((item) => item.currentMessages.length > 0).length, items.filter((item) => item.previousMessages.length > 0).length),
    topContactShare: topShare(1),
    topFiveShare: topShare(5),
    topTenShare: topShare(10),
    averageSentLength: compare(averageLength(currentSent), averageLength(previousSent)),
    historicalAverage30: historyDays >= 90 ? Math.round((historicalSent.length / historyDays) * 300) / 10 : undefined,
    yearAgoSent: yearAgoSent.length,
    yearAgoAvailable: earliest !== undefined && earliest < yearAgoTo.getTime(),
    historicalSufficient: historyDays >= 90,
    hourly: countSeries(currentSent.map((message) => new Date(message.timestamp).getHours()), Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`)),
    weekdays: countSeries(currentSent.map((message) => new Date(message.timestamp).getDay()), ['周日', '周一', '周二', '周三', '周四', '周五', '周六']),
    monthly: textSeries(allSent.map((message) => message.timestamp.slice(0, 7))),
    yearly: textSeries(allSent.map((message) => message.timestamp.slice(0, 4))),
    outgoingKinds: [...kindCounts.entries()].map(([key, value]) => ({ key, label: key, value })).sort((a, b) => b.value - a.value),
    topics: topicClues(currentSent, 10),
    contactChanges: sentByContact.map((item) => ({
      ...item,
      delta: item.currentSent - item.previousSent,
      currentShare: share(item.currentSent, currentSentTotal),
      previousShare: share(item.previousSent, previousSentTotal)
    })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.currentSent - a.currentSent).slice(0, 12)
  }
}

function observations(items: BuiltRelationship[], personal: PersonalAnalysis, currentWindow: AnalysisWindow): RelationshipObservation[] {
  const result: RelationshipObservation[] = []
  const rankDescription = (insight: RelationshipInsight): string => {
    if (insight.previousRank === undefined || insight.rankChange === undefined) return `当前排名第 ${insight.currentRank}`
    if (insight.rankChange > 0) return `排名从第 ${insight.previousRank} 升至第 ${insight.currentRank}`
    if (insight.rankChange < 0) return `排名从第 ${insight.previousRank} 降至第 ${insight.currentRank}`
    return `排名保持第 ${insight.currentRank}`
  }
  for (const item of [...items].sort((a, b) => b.insight.growthScore - a.insight.growthScore)) {
    const insight = item.insight
    if (insight.trend === 'rising') {
      const baseline = insight.historicalSufficient && insight.historicalAverage30 !== undefined ? `，过去 12 个月月均 ${insight.historicalAverage30.toLocaleString('zh-CN')} 条` : ''
      result.push({ id: `rising:${insight.conversationId}`, kind: 'rising', title: `最近和 ${insight.displayName} 联系明显增多`, description: `最近 30 天 ${insight.currentMessages.toLocaleString('zh-CN')} 条，比此前增加 ${insight.messageDelta.toLocaleString('zh-CN')} 条${baseline}；${rankDescription(insight)}。`, priority: 600 + insight.growthScore, conversationId: insight.conversationId, currentValue: insight.currentMessages, previousValue: insight.previousMessages, currentRank: insight.currentRank, previousRank: insight.previousRank, window: currentWindow })
    } else if (item.resumed) {
      result.push({ id: `reconnected:${insight.conversationId}`, kind: 'reconnected', title: `你和 ${insight.displayName} 又聊了起来`, description: `沉默至少 90 天后，最近 30 天新增 ${insight.currentMessages.toLocaleString('zh-CN')} 条消息。`, priority: 500 + insight.growthScore, conversationId: insight.conversationId, currentValue: insight.currentMessages, previousValue: insight.previousMessages, currentRank: insight.currentRank, previousRank: insight.previousRank, window: currentWindow })
    } else if ((insight.rankChange ?? 0) >= 5 && insight.currentMessages >= 10) {
      result.push({ id: `ranking:${insight.conversationId}`, kind: 'ranking', title: `${insight.displayName} 的联系排名上升了`, description: `从第 ${insight.previousRank} 位升至第 ${insight.currentRank} 位，最近 30 天共有 ${insight.currentMessages.toLocaleString('zh-CN')} 条消息。`, priority: 300 + (insight.rankChange ?? 0), conversationId: insight.conversationId, currentValue: insight.currentMessages, previousValue: insight.previousMessages, currentRank: insight.currentRank, previousRank: insight.previousRank, window: currentWindow })
    }
  }
  const top = personal.contactChanges.slice().sort((a, b) => b.currentSent - a.currentSent)[0]
  if (top && personal.current.messages >= 20 && personal.topContactShare >= 50) {
    result.push({ id: 'concentration:top-contact', kind: 'concentration', title: `你最近的聊天主要集中在 ${top.displayName}`, description: `发出的 ${personal.current.messages.toLocaleString('zh-CN')} 条消息中，${personal.topContactShare}% 发给了这位联系人。`, priority: 250, conversationId: top.conversationId, currentValue: top.currentSent, previousValue: top.previousSent, window: currentWindow })
  }
  for (const item of items.filter((entry) => entry.insight.trend === 'cooling').sort((a, b) => a.insight.messageDelta - b.insight.messageDelta).slice(0, 3)) {
    result.push({ id: `cooling:${item.insight.conversationId}`, kind: 'cooling', title: `和 ${item.insight.displayName} 的聊天变少了`, description: `最近 30 天 ${item.insight.currentMessages} 条，此前 30 天 ${item.insight.previousMessages} 条。`, priority: 100 + Math.abs(item.insight.messageDelta), conversationId: item.insight.conversationId, currentValue: item.insight.currentMessages, previousValue: item.insight.previousMessages, currentRank: item.insight.currentRank, previousRank: item.insight.previousRank, window: currentWindow })
  }
  for (const item of items.filter((entry) => {
    const cycle = entry.insight.typicalGapDays
    return cycle !== undefined && entry.insight.daysSinceLastContact >= Math.max(30, cycle * 3) && entry.insight.recent365Days >= 10
  }).sort((a, b) => b.insight.daysSinceLastContact - a.insight.daysSinceLastContact).slice(0, 3)) {
    const cycle = Math.max(1, Math.round(item.insight.typicalGapDays ?? 0))
    result.push({ id: `silent:${item.insight.conversationId}`, kind: 'silent', title: `你已经 ${item.insight.daysSinceLastContact} 天没有和 ${item.insight.displayName} 联系`, description: `过去通常每 ${cycle} 天会聊一次，最近发生了什么变化吗？`, priority: 80 + Math.min(100, item.insight.daysSinceLastContact), conversationId: item.insight.conversationId, currentValue: item.insight.daysSinceLastContact, previousValue: cycle, currentRank: item.insight.currentRank, previousRank: item.insight.previousRank, window: currentWindow })
  }
  return result.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)).slice(0, 12)
}

function directionSeries(messages: Message[], mode: 'hour' | 'weekday'): DirectionSeriesPoint[] {
  const labels = mode === 'hour' ? Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`) : ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return labels.map((label, index) => {
    const selected = messages.filter((message) => mode === 'hour' ? new Date(message.timestamp).getHours() === index : new Date(message.timestamp).getDay() === index)
    return { key: String(index), label, sent: selected.filter((message) => message.direction === 'sent').length, received: selected.filter((message) => message.direction === 'received').length }
  })
}

function dailySeries(current: Message[], previous: Message[], currentWindow: AnalysisWindow, previousWindow: AnalysisWindow): RelationshipDayPoint[] {
  const make = (messages: Message[], period: 'current' | 'previous', range: AnalysisWindow): RelationshipDayPoint[] => {
    const counts = new Map<string, { sent: number; received: number }>()
    for (const message of messages) {
      const date = localDateKey(message.timestamp)
      if (!date) continue
      const value = counts.get(date) ?? { sent: 0, received: 0 }
      if (message.direction === 'sent') value.sent += 1
      else if (message.direction === 'received') value.received += 1
      counts.set(date, value)
    }
    const result: RelationshipDayPoint[] = []
    const cursor = new Date(range.from)
    const end = new Date(range.to).getTime()
    while (cursor.getTime() < end) {
      const date = localDateKey(cursor.toISOString())
      if (date) result.push({ date, ...(counts.get(date) ?? { sent: 0, received: 0 }), period })
      cursor.setDate(cursor.getDate() + 1)
    }
    return result
  }
  return [...make(previous, 'previous', previousWindow), ...make(current, 'current', currentWindow)]
}

export class RelationshipService {
  constructor(private readonly repository: ArchiveRepository) {}

  private async build(now: Date): Promise<{ items: BuiltRelationship[]; currentWindow: AnalysisWindow; previousWindow: AnalysisWindow; historicalWindow: AnalysisWindow; yearAgoWindow: AnalysisWindow; documents: ConversationDocument[] }> {
    const { documents } = await this.repository.readAll()
    const windows = analysisWindows(now)
    const items = directDocuments(documents).map((document) => buildBase(document, now, windows.current, windows.previous, windows.historical, windows.yearAgo))
    assignRanks(items)
    return { items, currentWindow: windows.current, previousWindow: windows.previous, historicalWindow: windows.historical, yearAgoWindow: windows.yearAgo, documents }
  }

  async get(now = new Date()): Promise<RelationshipOverview> {
    const { items, currentWindow, previousWindow, historicalWindow, yearAgoWindow, documents } = await this.build(now)
    const insights = items.map((item) => item.insight).sort((a, b) => b.currentMessages - a.currentMessages || a.currentRank - b.currentRank)
    const personal = personalAnalysis(items, currentWindow, previousWindow)
    const networkItems = [...insights].sort((a, b) => b.currentMessages - a.currentMessages || b.messageCount - a.messageCount).slice(0, 40)
    return {
      items: insights,
      mostActive: [...insights].sort((a, b) => b.messageCount - a.messageCount).slice(0, 10),
      leastActive: [...insights].filter((item) => item.messageCount > 0).sort((a, b) => a.messageCount - b.messageCount).slice(0, 10),
      longestSilent: [...insights].sort((a, b) => b.daysSinceLastContact - a.daysSinceLastContact).slice(0, 10),
      cooling: [...insights].filter((item) => item.trend === 'cooling' || (item.recent365Days > 0 && item.recent30Days === 0)).sort((a, b) => a.messageDelta - b.messageDelta).slice(0, 10),
      myWords: ownWords(documents.filter((document) => document.conversation.kind === 'direct' || document.conversation.kind === 'group')),
      observations: observations(items, personal, currentWindow),
      personal,
      network: { nodes: networkItems.map((item) => ({ id: item.conversationId, name: item.displayName, totalMessages: item.messageCount, currentMessages: item.currentMessages, trend: item.trend, avatarDataUrl: item.avatarDataUrl })), hiddenCount: Math.max(0, insights.length - networkItems.length) },
      currentWindow,
      previousWindow,
      historicalWindow,
      yearAgoWindow,
      generatedAt: now.toISOString()
    }
  }

  async detail(conversationId: string, now = new Date()): Promise<RelationshipDetail | undefined> {
    const { items, currentWindow, previousWindow, historicalWindow, yearAgoWindow } = await this.build(now)
    const item = items.find((entry) => entry.insight.conversationId === conversationId)
    if (!item) return undefined
    const allMessages = relationshipMessages(item.document)
    const dayCounts = new Map<string, number>()
    for (const message of allMessages) {
      const key = localDateKey(message.timestamp)
      if (key) dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1)
    }
    const busiestDay = [...dayCounts.entries()].sort(([aDate, a], [bDate, b]) => b - a || aDate.localeCompare(bDate))[0]
    const currentTopics = topicClues(item.currentMessages, 12)
    return {
      insight: item.insight,
      currentWindow,
      previousWindow,
      historicalWindow,
      yearAgoWindow,
      current: { sent: directionBreakdown(item.currentMessages, 'sent', item.allMessages), received: directionBreakdown(item.currentMessages, 'received', item.allMessages) },
      previous: { sent: directionBreakdown(item.previousMessages, 'sent', item.allMessages), received: directionBreakdown(item.previousMessages, 'received', item.allMessages) },
      topics: currentTopics.length ? currentTopics : topicClues(allMessages, 12),
      hourly: directionSeries(item.currentMessages, 'hour'),
      weekdays: directionSeries(item.currentMessages, 'weekday'),
      daily: dailySeries(item.currentMessages, item.previousMessages, currentWindow, previousWindow),
      records: { busiestDay: busiestDay ? { date: busiestDay[0], messages: busiestDay[1] } : undefined, firstMessageAt: item.insight.firstMessageAt, lastMessageAt: item.insight.lastMessageAt, longestSilenceDays: item.insight.longestSilenceDays, longestActiveStreak: item.insight.longestActiveStreak }
    }
  }
}
