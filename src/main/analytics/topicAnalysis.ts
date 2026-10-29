import type { Message, TopicClue, TopicExcerpt } from '../../shared/contracts'
import { share, validMessageTime } from './analysisPrimitives'

const STOP_WORDS = new Set([
  '的', '了', '是', '我', '你', '他', '她', '它', '啊', '呀', '吗', '呢', '吧', '和', '与', '也', '都', '就', '在', '有', '没',
  '没有', '一个', '这个', '那个', '什么', '怎么', '为什么', '可以', '不是', '就是', '然后', '但是', '因为', '所以', '还是',
  '已经', '现在', '今天', '明天', '昨天', '我们', '你们', '他们', '自己', '这样', '那样', '一下', '一些', '哈哈', '哈哈哈',
  'there', 'that', 'this', 'with', 'have', 'just', 'from', 'your', 'you', 'the', 'and', 'for'
])

interface TopicAccumulator {
  count: number
  sent: number
  received: number
  firstAt: string
  lastAt: string
  related: Map<string, number>
  excerpts: TopicExcerpt[]
}

const MAX_MESSAGES = 20_000
const MAX_TERMS = 2_000
const MAX_RELATED_TERMS = 32

function messageTokens(segmenter: Intl.Segmenter, content: string): string[] {
  const values = new Set<string>()
  for (const part of segmenter.segment(content)) {
    if (!part.isWordLike) continue
    const token = part.segment.trim().toLocaleLowerCase('zh-CN')
    const latin = /^[a-z0-9]+$/i.test(token)
    if (STOP_WORDS.has(token) || /^\d+$/.test(token) || (latin ? token.length < 3 : [...token].length < 2)) continue
    values.add(token)
    if (values.size === 16) break
  }
  return [...values]
}

function addExcerpt(excerpts: TopicExcerpt[], message: Message): void {
  const excerpt: TopicExcerpt = {
    messageId: message.id,
    timestamp: message.timestamp,
    direction: message.direction,
    content: [...message.content.trim()].slice(0, 100).join('')
  }
  excerpts.push(excerpt)
  excerpts.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  if (excerpts.length > 3) excerpts.length = 3
}

export function topicClues(messages: Message[], limit = 10): TopicClue[] {
  const textMessages = messages.filter((message) =>
    message.kind === 'text' &&
    (message.direction === 'sent' || message.direction === 'received') &&
    message.content.trim() &&
    validMessageTime(message) !== undefined
  ).sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id)).slice(0, MAX_MESSAGES)
  if (!textMessages.length) return []
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })
  const topics = new Map<string, TopicAccumulator>()
  for (const message of textMessages) {
    const tokens = messageTokens(segmenter, message.content)
    for (const token of tokens) {
      if (!topics.has(token) && topics.size >= MAX_TERMS) continue
      const existing = topics.get(token) ?? {
        count: 0,
        sent: 0,
        received: 0,
        firstAt: message.timestamp,
        lastAt: message.timestamp,
        related: new Map<string, number>(),
        excerpts: []
      }
      existing.count += 1
      if (message.direction === 'sent') existing.sent += 1
      else existing.received += 1
      if (message.timestamp < existing.firstAt) existing.firstAt = message.timestamp
      if (message.timestamp > existing.lastAt) existing.lastAt = message.timestamp
      for (const related of tokens) {
        if (related !== token && (existing.related.has(related) || existing.related.size < MAX_RELATED_TERMS)) existing.related.set(related, (existing.related.get(related) ?? 0) + 1)
      }
      addExcerpt(existing.excerpts, message)
      topics.set(token, existing)
    }
  }
  return [...topics.entries()]
    .filter(([, value]) => value.count >= 2)
    .sort(([aToken, a], [bToken, b]) => b.count - a.count || aToken.localeCompare(bToken, 'zh-CN'))
    .slice(0, limit)
    .map(([keyword, value]) => ({
      keyword,
      relatedTerms: [...value.related.entries()]
        .sort(([aToken, a], [bToken, b]) => b - a || aToken.localeCompare(bToken, 'zh-CN'))
        .slice(0, 4)
        .map(([token]) => token),
      messageCount: value.count,
      shareOfText: share(value.count, textMessages.length),
      sentCount: value.sent,
      receivedCount: value.received,
      firstAt: value.firstAt,
      lastAt: value.lastAt,
      excerpts: value.excerpts
    }))
}
