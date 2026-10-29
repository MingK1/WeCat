import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, FileText, Search, X } from 'lucide-react'
import type { ArchiveSummary, Conversation, Message, MessageKind, Person } from '../../../shared/contracts'
import { Avatar } from '../components/Avatar'
import { EmptyState } from '../components/EmptyState'

interface Props {
  initialConversationId?: string
  initialFrom?: string
  initialTo?: string
  initialMessageId?: string
}
const kindLabels: Record<MessageKind, string> = { text: '文字', image: '图片', video: '视频', voice: '语音', sticker: '表情', file: '文件', link: '链接', location: '位置', payment: '支付', call: '通话', system: '系统', unknown: '其他' }
const day = (value?: string): string => value ? new Date(value).toLocaleDateString('zh-CN') : ''

export function TimelinePage({ initialConversationId, initialFrom, initialTo, initialMessageId }: Props): React.JSX.Element {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [summary, setSummary] = useState<ArchiveSummary>()
  const [conversationId, setConversationId] = useState(initialConversationId ?? '')
  const [conversationSearch, setConversationSearch] = useState('')
  const [messageSearch, setMessageSearch] = useState('')
  const [year, setYear] = useState<number | undefined>()
  const [kind, setKind] = useState<MessageKind | 'all'>('all')
  const [items, setItems] = useState<Message[]>([])
  const [total, setTotal] = useState(0)
  const [loadedCount, setLoadedCount] = useState(0)
  const [offset, setOffset] = useState(0)
  const [evidence, setEvidence] = useState({ from: initialFrom, to: initialTo, messageId: initialMessageId })
  const chatListRef = useRef<HTMLDivElement>(null)
  const previousHeightRef = useRef(0)
  const limit = 160

  useEffect(() => { void Promise.all([window.wecat.archive.conversations({ limit: 500 }), window.wecat.archive.people(), window.wecat.archive.summary()]).then(([result, nextPeople, nextSummary]) => { setConversations(result.items); setPeople(nextPeople); setSummary(nextSummary); setConversationId((current) => current || initialConversationId || result.items[0]?.id || '') }) }, [initialConversationId])
  useEffect(() => { if (initialConversationId) setConversationId(initialConversationId) }, [initialConversationId])
  useEffect(() => { setEvidence({ from: initialFrom, to: initialTo, messageId: initialMessageId }); setOffset(0) }, [initialFrom, initialTo, initialMessageId])
  useEffect(() => {
    if (!conversationId) { setItems([]); return }
    const timer = setTimeout(() => { void (async () => {
      const result = await window.wecat.archive.messages({ conversationId, search: messageSearch, year, kinds: kind === 'all' ? undefined : [kind], from: evidence.from, to: evidence.to, limit, offset })
      let ordered = result.items.reverse()
      if (evidence.messageId && !ordered.some((message) => message.id === evidence.messageId)) {
        const exact = await window.wecat.archive.messages({ conversationId, messageId: evidence.messageId, limit: 1 })
        if (exact.items[0]) ordered = [...ordered, exact.items[0]].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id))
      }
      setItems((current) => {
        const existing = new Set(current.map((message) => message.id))
        const fresh = ordered.filter((message) => !existing.has(message.id))
        return offset === 0 ? ordered : [...fresh, ...current]
      })
      setTotal(result.total)
      setLoadedCount(offset + result.items.length)
    })() }, 100)
    return () => clearTimeout(timer)
  }, [conversationId, messageSearch, year, kind, offset, evidence])
  useLayoutEffect(() => {
    const element = chatListRef.current
    if (!element || !items.length) return
    if (offset === 0) element.scrollTop = element.scrollHeight
    else if (previousHeightRef.current) element.scrollTop = element.scrollHeight - previousHeightRef.current
    previousHeightRef.current = 0
  }, [items, offset])
  useLayoutEffect(() => {
    if (!evidence.messageId || !items.some((message) => message.id === evidence.messageId)) return
    requestAnimationFrame(() => document.querySelector(`[data-message-id="${CSS.escape(evidence.messageId!)}"]`)?.scrollIntoView({ block: 'center' }))
  }, [evidence.messageId, items])

  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people])
  const filteredConversations = conversations.filter((conversation) => conversation.displayName.toLocaleLowerCase('zh-CN').includes(conversationSearch.toLocaleLowerCase('zh-CN')))
  const selected = conversations.find((conversation) => conversation.id === conversationId)
  const years = [...new Set(conversations.flatMap((conversation) => [conversation.firstMessageAt, conversation.lastMessageAt]).filter(Boolean).map((value) => new Date(value!).getFullYear()))].sort((a, b) => b - a)

  return <div className="chat-workspace">
    <aside className="conversation-pane">
      <label className="wechat-search"><Search size={16} /><input value={conversationSearch} onChange={(event) => setConversationSearch(event.target.value)} placeholder="搜索会话" /></label>
      <div className="wechat-conversation-list">{filteredConversations.map((conversation) => <button key={conversation.id} className={conversation.id === conversationId ? 'active' : ''} onClick={() => { setConversationId(conversation.id); setEvidence({ from: undefined, to: undefined, messageId: undefined }); setOffset(0) }}><Avatar name={conversation.displayName} dataUrl={conversation.avatarDataUrl} size={42} /><span><strong>{conversation.displayName}</strong><small>{conversation.messageCount.toLocaleString('zh-CN')} 条记录</small></span><time>{day(conversation.lastMessageAt)}</time></button>)}</div>
    </aside>
    <section className="chat-pane">
      {selected ? <>
        <header className="chat-header"><div><strong>{selected.displayName}</strong><small>{selected.kind === 'group' ? '群聊' : '联系人'} · {selected.messageCount.toLocaleString('zh-CN')} 条{evidence.from ? ` · 正在查看 ${day(evidence.from)}` : ''}</small></div><div className="chat-filters">{evidence.from && <button className="evidence-clear" onClick={() => { setEvidence({ from: undefined, to: undefined, messageId: undefined }); setOffset(0) }} title="返回完整聊天"><X size={14} />清除定位</button>}<select value={year ?? ''} onChange={(event) => { setYear(event.target.value ? Number(event.target.value) : undefined); setOffset(0) }}><option value="">全部年份</option>{years.map((value) => <option key={value}>{value}</option>)}</select><select value={kind} onChange={(event) => { setKind(event.target.value as MessageKind | 'all'); setOffset(0) }}><option value="all">全部类型</option>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><label><Search size={15} /><input value={messageSearch} onChange={(event) => { setMessageSearch(event.target.value); setOffset(0) }} placeholder="搜索聊天" /></label></div></header>
        <div className="wechat-chat-list" ref={chatListRef}>{!items.length ? <EmptyState icon={CalendarDays} title="这个范围内没有记录" description="调整年份、类型或搜索条件。" /> : <>
        {loadedCount < total && <button className="load-older" onClick={() => { previousHeightRef.current = chatListRef.current?.scrollHeight ?? 0; setOffset(loadedCount) }}>查看更早聊天 · 已加载 {loadedCount} / {total} 条</button>}
        {items.map((message, index) => {
          const currentDay = new Date(message.timestamp).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
          const previousDay = index ? new Date(items[index - 1].timestamp).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }) : ''
          const own = message.direction === 'sent'
          const speaker = own ? undefined : peopleById.get(message.senderId || '')
          const avatar = own ? undefined : speaker?.avatarDataUrl || selected.avatarDataUrl
          return <div key={message.id} data-message-id={message.id} className={message.id === evidence.messageId ? 'target-message' : ''}>{currentDay !== previousDay && <div className="wechat-day"><span>{currentDay}</span></div>}<article className={`wechat-message ${own ? 'own' : 'other'}`}><Avatar name={own ? '我' : message.senderName || selected.displayName} dataUrl={own ? summary?.accountAvatarDataUrl : avatar} size={38} /><div className="bubble-wrap">{!own && selected.kind === 'group' && <small className="speaker">{message.senderName || '群成员'}</small>}<div className="wechat-bubble">{message.media ? <><FileText size={16} /><span>{message.media.originalName || kindLabels[message.kind]}</span><small className={`status-${message.media.availability}`}>{message.media.availability === 'available' ? '已保存为本地资产' : message.media.availability === 'missing' ? '原文件已缺失' : '未能定位原文件'}</small></> : message.content}</div><time>{new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></div></article></div>
        })}
      </>}</div>
      </> : <EmptyState icon={CalendarDays} title="选择一段对话" description="从左侧选择联系人或群聊。" />}
    </section>
  </div>
}
