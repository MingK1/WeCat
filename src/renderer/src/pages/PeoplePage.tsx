import { useEffect, useState } from 'react'
import { MessageSquareText, Search, Users } from 'lucide-react'
import type { ConversationKind, Person } from '../../../shared/contracts'
import { EmptyState } from '../components/EmptyState'
import { Avatar } from '../components/Avatar'

interface Props { onOpenConversation: (id: string) => void }
const date = (value?: string): string => value ? new Date(value).toLocaleDateString('zh-CN') : '暂无日期'

export function PeoplePage({ onOpenConversation }: Props): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<'all' | ConversationKind>('all')
  const [items, setItems] = useState<Person[]>([])
  const [total, setTotal] = useState(0)

  useEffect(() => {
    const timer = setTimeout(() => {
      void window.wecat.archive.people().then((people) => {
        const filtered = people.filter((person) => (kind === 'all' || person.kind === kind) && `${person.displayName} ${person.remark ?? ''} ${person.nickname ?? ''} ${person.id}`.toLocaleLowerCase('zh-CN').includes(search.toLocaleLowerCase('zh-CN')))
        setItems(filtered)
        setTotal(filtered.length)
      })
    }, 120)
    return () => clearTimeout(timer)
  }, [search, kind])

  return (
    <div className="page-stack">
      <header className="page-header"><div><span className="eyebrow">人物与群聊</span><h1>那些一起留下记录的人</h1><p>共 {total.toLocaleString('zh-CN')} 个会话，点击进入完整时间线。</p></div></header>
      <div className="toolbar">
        <label className="search-field"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索备注、昵称或群名" /></label>
        <div className="segmented" aria-label="联系人类型">
          {([['all', '全部'], ['direct', '联系人'], ['group', '群聊'], ['official', '公众号']] as const).map(([value, label]) => <button key={value} className={kind === value ? 'active' : ''} onClick={() => setKind(value)}>{label}</button>)}
        </div>
      </div>
      {!items.length ? <EmptyState icon={Users} title="没有找到会话" description="调整搜索条件，或先在导入页面建立档案。" /> : (
        <div className="conversation-table">
          {items.map((conversation) => (
            <button key={conversation.id} disabled={!conversation.hasConversation} onClick={() => conversation.hasConversation && onOpenConversation(conversation.id)}>
              <Avatar name={conversation.displayName} dataUrl={conversation.avatarDataUrl} size={38} />
              <span className="conversation-main"><strong>{conversation.remark || conversation.nickname || conversation.displayName}</strong><small>{conversation.hasConversation ? `${conversation.kind === 'group' ? '群聊' : conversation.kind === 'official' ? '公众号' : '联系人'} · 始于 ${date(conversation.firstMessageAt)}` : `${conversation.kind === 'group' ? '群聊' : conversation.kind === 'official' ? '公众号' : '联系人'} · 暂无聊天记录`}</small></span>
              {conversation.hasConversation ? <><span className="conversation-count"><MessageSquareText size={15} />{conversation.messageCount.toLocaleString('zh-CN')}</span><time>{date(conversation.lastMessageAt)}</time></> : <span className="conversation-count no-messages">未聊天</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
