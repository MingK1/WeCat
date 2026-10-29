import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Clock3, ExternalLink, MessageCircleMore, Network, Search, TrendingUp, UserRoundSearch } from 'lucide-react'
import type { ParticipationBreakdown, RelationshipDetail, RelationshipInsight, RelationshipOverview } from '../../../shared/contracts'
import { Avatar } from '../components/Avatar'
import { Chart } from '../components/Chart'
import { EmptyState } from '../components/EmptyState'

interface ChatTarget { from?: string; to?: string; messageId?: string }
interface Props {
  initialRelationshipId?: string
  onSelectRelationship: (id: string | undefined) => void
  onOpenConversation: (id: string, target?: ChatTarget) => void
}

type SortKey = 'current' | 'growth' | 'total' | 'active' | 'sentShare' | 'starts' | 'silence' | 'stickers' | 'characters'

const number = (value?: number): string => (value ?? 0).toLocaleString('zh-CN')
const date = (value?: string): string => value ? new Date(value).toLocaleDateString('zh-CN') : '暂无'
const duration = (minutes?: number): string => minutes === undefined ? '样本不足' : minutes < 60 ? `${Math.round(minutes)} 分钟` : `${(minutes / 60).toFixed(1)} 小时`
const trendLabels = { rising: '联系增多', reconnected: '重新联系', stable: '相对稳定', cooling: '联系减少', inactive: '近期未联系' }
const kindLabels: Record<string, string> = { text: '文字', image: '图片', video: '视频', voice: '语音', sticker: '表情', file: '文件', link: '链接', location: '位置', payment: '支付', call: '通话', system: '系统', unknown: '其他' }

function dayTarget(timestamp: string): ChatTarget {
  const value = new Date(timestamp)
  const from = new Date(value.getFullYear(), value.getMonth(), value.getDate())
  const to = new Date(value.getFullYear(), value.getMonth(), value.getDate() + 1)
  return { from: from.toISOString(), to: to.toISOString() }
}

function participationRows(sent: ParticipationBreakdown, received: ParticipationBreakdown): Array<{ label: string; sent: string; received: string }> {
  return [
    { label: '消息', sent: number(sent.messages), received: number(received.messages) },
    { label: '文字字数', sent: number(sent.textCharacters), received: number(received.textCharacters) },
    { label: '表情', sent: number(sent.stickers), received: number(received.stickers) },
    { label: '语音', sent: number(sent.voices), received: number(received.voices) },
    { label: '图片', sent: number(sent.images), received: number(received.images) },
    { label: '视频', sent: number(sent.videos), received: number(received.videos) },
    { label: '文件', sent: number(sent.files), received: number(received.files) },
    { label: '开启对话', sent: number(sent.conversationStarts), received: number(received.conversationStarts) },
    { label: '活跃日', sent: number(sent.activeDays), received: number(received.activeDays) }
  ]
}

function RelationshipDetailView({ detail, onBack, onOpenConversation }: { detail: RelationshipDetail; onBack: () => void; onOpenConversation: (id: string, target?: ChatTarget) => void }): React.JSX.Element {
  const dailyOption = useMemo(() => {
    const days = detail.daily.map((point) => point.date)
    return {
      grid: { left: 36, right: 12, top: 24, bottom: 34 }, tooltip: { trigger: 'axis' },
      legend: { data: ['我发出', '对方发出'], top: 0, textStyle: { color: '#6b736b', fontSize: 10 } },
      xAxis: { type: 'category', data: days, axisLabel: { color: '#7d857d', fontSize: 9, hideOverlap: true }, axisLine: { lineStyle: { color: '#d6dad5' } } },
      yAxis: { type: 'value', axisLabel: { color: '#7d857d' }, splitLine: { lineStyle: { color: '#eceeeb' } } },
      series: [
        { name: '我发出', type: 'line', data: detail.daily.map((point) => point.sent), symbol: 'none', lineStyle: { color: '#3d7752', width: 2 } },
        { name: '对方发出', type: 'line', data: detail.daily.map((point) => point.received), symbol: 'none', lineStyle: { color: '#b0704f', width: 2 } }
      ]
    }
  }, [detail])
  const hourlyOption = useMemo(() => ({
    grid: { left: 36, right: 12, top: 24, bottom: 32 }, tooltip: { trigger: 'axis' },
    legend: { data: ['我发出', '对方发出'], top: 0, textStyle: { color: '#6b736b', fontSize: 10 } },
    xAxis: { type: 'category', data: detail.hourly.map((point) => point.label), axisLabel: { color: '#7d857d', fontSize: 9, interval: 2 }, axisLine: { lineStyle: { color: '#d6dad5' } } },
    yAxis: { type: 'value', axisLabel: { color: '#7d857d' }, splitLine: { lineStyle: { color: '#eceeeb' } } },
    series: [
      { name: '我发出', type: 'bar', stack: 'total', data: detail.hourly.map((point) => point.sent), itemStyle: { color: '#64836b' } },
      { name: '对方发出', type: 'bar', stack: 'total', data: detail.hourly.map((point) => point.received), itemStyle: { color: '#bd8263' } }
    ]
  }), [detail])
  const currentTotal = detail.current.sent.messages + detail.current.received.messages

  return <div className="relationship-detail page-stack">
    <header className="detail-header">
      <button className="icon-button" onClick={onBack} title="返回关系列表"><ArrowLeft size={18} /></button>
      <Avatar name={detail.insight.displayName} dataUrl={detail.insight.avatarDataUrl} size={46} />
      <div><span className={`trend-label trend-${detail.insight.trend}`}>{trendLabels[detail.insight.trend]}</span><h1>{detail.insight.displayName}</h1><p>{detail.currentWindow.label}与{detail.previousWindow.label}的可复核对比</p></div>
      <button className="button" onClick={() => onOpenConversation(detail.insight.conversationId)}><MessageCircleMore size={17} />查看完整聊天</button>
    </header>

    <section className="metric-grid detail-metrics">
      <div className="metric"><span>最近消息</span><strong>{number(detail.insight.currentMessages)}</strong><small>此前 {number(detail.insight.previousMessages)} 条{detail.insight.historicalSufficient ? ` · 历史月均 ${number(detail.insight.historicalAverage30 ?? 0)}` : ' · 历史不足'}</small></div>
      <div className="metric metric-warm"><span>联系人排名</span><strong>第 {detail.insight.currentRank}</strong><small>此前第 {detail.insight.previousRank ?? '-'} 位</small></div>
      <div className="metric metric-cool"><span>双方消息占比</span><strong>{detail.insight.sentShare}% / {Math.round((100 - detail.insight.sentShare) * 10) / 10}%</strong><small>我发出 / 对方发出</small></div>
      <div className="metric"><span>活跃天数</span><strong>{detail.insight.currentActiveDays} 天</strong><small>此前 {detail.insight.previousActiveDays} 天</small></div>
    </section>

    <section className="content-grid detail-summary-grid">
      <div className="panel participation-panel">
        <div className="panel-heading"><div><h2>双方参与</h2><p>最近 30 天，共 {number(currentTotal)} 条</p></div></div>
        <div className="participation-table"><div className="participation-head"><span>项目</span><span>我发出</span><span>对方发出</span></div>{participationRows(detail.current.sent, detail.current.received).map((row) => <div key={row.label}><span>{row.label}</span><b>{row.sent}</b><b>{row.received}</b></div>)}</div>
      </div>
      <div className="panel records-panel">
        <div className="panel-heading"><div><h2>这段关系的纪录</h2><p>从全部已归档聊天中计算</p></div></div>
        <dl><div><dt>第一次聊天</dt><dd>{date(detail.records.firstMessageAt)}</dd></div><div><dt>最近一次聊天</dt><dd>{date(detail.records.lastMessageAt)}</dd></div><div><dt>过去 12 个月月均</dt><dd>{detail.insight.historicalSufficient ? `${number(detail.insight.historicalAverage30 ?? 0)} 条` : '历史不足'}</dd></div><div><dt>去年同期</dt><dd>{detail.insight.yearAgoAvailable ? `${number(detail.insight.yearAgoMessages)} 条` : '无同期记录'}</dd></div><div><dt>消息最多的一天</dt><dd>{detail.records.busiestDay ? `${date(detail.records.busiestDay.date)} · ${number(detail.records.busiestDay.messages)} 条` : '暂无'}</dd></div><div><dt>最长沉默</dt><dd>{detail.records.longestSilenceDays} 天</dd></div><div><dt>最长连续活跃</dt><dd>{detail.records.longestActiveStreak} 天</dd></div><div><dt>典型回复</dt><dd>我 {duration(detail.insight.medianReplyToThemMinutes)} · 对方 {duration(detail.insight.medianReplyToMeMinutes)}</dd></div></dl>
      </div>
    </section>

    <section className="panel">
      <div className="panel-heading"><div><h2>聊得最多的话题线索</h2><p>关键词来自文字消息，并展示共现词和原文依据</p></div></div>
      {detail.topics.length ? <div className="topic-list">{detail.topics.map((topic) => <article key={topic.keyword}>
        <div className="topic-summary"><strong>{topic.keyword}</strong><span>{number(topic.messageCount)} 条 · 占文字消息 {topic.shareOfText}%</span><small>{topic.relatedTerms.length ? `常与 ${topic.relatedTerms.join('、')} 一起出现` : '暂无稳定共现词'}</small></div>
        <div className="topic-balance"><span>我 {number(topic.sentCount)}</span><span>对方 {number(topic.receivedCount)}</span><span>{date(topic.firstAt)} 至 {date(topic.lastAt)}</span></div>
        <div className="topic-excerpts">{topic.excerpts.map((excerpt) => <button key={excerpt.messageId} onClick={() => onOpenConversation(detail.insight.conversationId, { ...dayTarget(excerpt.timestamp), messageId: excerpt.messageId })}><span>{excerpt.direction === 'sent' ? '我' : '对方'} · {new Date(excerpt.timestamp).toLocaleString('zh-CN')}</span><p>{excerpt.content}</p><ExternalLink size={14} /></button>)}</div>
      </article>)}</div> : <div className="quiet-state">这个时间范围内的文字消息不足以形成重复话题线索。</div>}
    </section>

    <section className="content-grid">
      <div className="panel"><div className="panel-heading"><div><h2>联系变化时间线</h2><p>此前 30 天到最近 30 天</p></div></div><Chart option={dailyOption} ariaLabel={`${detail.insight.displayName}每日消息数量变化`} height={280} /></div>
      <div className="panel"><div className="panel-heading"><div><h2>聊天时段</h2><p>最近 30 天双方消息分布</p></div></div><Chart option={hourlyOption} ariaLabel={`${detail.insight.displayName}聊天时段分布`} height={280} /></div>
    </section>
  </div>
}

export function RelationshipPage({ initialRelationshipId, onSelectRelationship, onOpenConversation }: Props): React.JSX.Element {
  const [data, setData] = useState<RelationshipOverview>()
  const [selectedId, setSelectedId] = useState(initialRelationshipId)
  const [detail, setDetail] = useState<RelationshipDetail>()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('current')

  useEffect(() => { void window.wecat.analytics.relationships().then(setData) }, [])
  useEffect(() => { if (initialRelationshipId) setSelectedId(initialRelationshipId) }, [initialRelationshipId])
  useEffect(() => {
    setDetail(undefined)
    if (selectedId) void window.wecat.analytics.relationshipDetail(selectedId).then(setDetail)
  }, [selectedId])

  const filtered = useMemo(() => {
    const items = data?.items.filter((item) => item.displayName.toLocaleLowerCase('zh-CN').includes(search.toLocaleLowerCase('zh-CN'))) ?? []
    const sortValue = (item: RelationshipInsight): number => ({ current: item.currentMessages, growth: item.messageDelta, total: item.messageCount, active: item.activeDays, sentShare: item.sentShare, starts: item.currentInitiatedByMe, silence: item.daysSinceLastContact, stickers: item.currentSentStickers + item.currentReceivedStickers, characters: item.currentSentCharacters + item.currentReceivedCharacters })[sort]
    return [...items].sort((a, b) => sortValue(b) - sortValue(a) || a.displayName.localeCompare(b.displayName, 'zh-CN'))
  }, [data, search, sort])

  const networkOption = useMemo(() => {
    if (!data) return {}
    const colors = { rising: '#3d8357', reconnected: '#2e7684', stable: '#8c948c', cooling: '#b27655', inactive: '#c5c9c4' }
    const maximum = Math.max(1, ...data.network.nodes.map((node) => node.totalMessages))
    const positioned = data.network.nodes.map((node, index) => {
      const innerCount = Math.min(14, data.network.nodes.length)
      const inner = index < innerCount
      const ringIndex = inner ? index : index - innerCount
      const ringCount = inner ? innerCount : Math.max(1, data.network.nodes.length - innerCount)
      const radius = inner ? 150 : 265
      const angle = -Math.PI / 2 + (ringIndex / ringCount) * Math.PI * 2 + (inner ? 0 : Math.PI / ringCount)
      return { node, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
    })
    return {
      tooltip: { formatter: (params: { data?: { name?: string; currentMessages?: number; totalMessages?: number } }) => params.data?.currentMessages === undefined ? params.data?.name : `${params.data.name}<br/>最近 ${number(params.data.currentMessages)} 条<br/>累计 ${number(params.data.totalMessages ?? 0)} 条` },
      series: [{
        type: 'graph', layout: 'none', roam: true, label: { show: true, position: 'right', color: '#394139', fontSize: 10 },
        emphasis: { focus: 'adjacency' },
        data: [
          { id: '__self__', name: '我', symbolSize: 50, fixed: true, x: 0, y: 0, itemStyle: { color: '#243d2e' }, label: { position: 'inside', color: '#fff', fontWeight: 700 } },
          ...positioned.map(({ node, x, y }) => ({ id: node.id, name: node.name, x, y, currentMessages: node.currentMessages, totalMessages: node.totalMessages, symbolSize: 14 + 18 * Math.sqrt(node.totalMessages / maximum), itemStyle: { color: colors[node.trend] } }))
        ],
        links: data.network.nodes.map((node) => ({ source: '__self__', target: node.id, lineStyle: { width: .8 + Math.min(1.6, Math.log10(node.currentMessages + 1) * .7), color: colors[node.trend], opacity: .38 } })),
        lineStyle: { curveness: 0 }
      }]
    }
  }, [data])

  const personalHourlyOption = useMemo(() => ({
    grid: { left: 34, right: 10, top: 12, bottom: 30 }, tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: data?.personal.hourly.map((point) => point.label) ?? [], axisLabel: { color: '#7d857d', fontSize: 9, interval: 2 }, axisLine: { lineStyle: { color: '#d6dad5' } } },
    yAxis: { type: 'value', axisLabel: { color: '#7d857d' }, splitLine: { lineStyle: { color: '#eceeeb' } } },
    series: [{ type: 'bar', data: data?.personal.hourly.map((point) => point.value) ?? [], itemStyle: { color: '#64836b' } }]
  }), [data])
  const personalWeekdayOption = useMemo(() => ({
    grid: { left: 34, right: 10, top: 12, bottom: 30 }, tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: data?.personal.weekdays.map((point) => point.label) ?? [], axisLabel: { color: '#7d857d', fontSize: 9 }, axisLine: { lineStyle: { color: '#d6dad5' } } },
    yAxis: { type: 'value', axisLabel: { color: '#7d857d' }, splitLine: { lineStyle: { color: '#eceeeb' } } },
    series: [{ type: 'bar', data: data?.personal.weekdays.map((point) => point.value) ?? [], itemStyle: { color: '#b47758' } }]
  }), [data])
  const personalMonthlyOption = useMemo(() => ({
    grid: { left: 40, right: 12, top: 16, bottom: 38 }, tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: data?.personal.monthly.map((point) => point.label) ?? [], axisLabel: { color: '#7d857d', fontSize: 9, hideOverlap: true }, axisLine: { lineStyle: { color: '#d6dad5' } } },
    yAxis: { type: 'value', axisLabel: { color: '#7d857d' }, splitLine: { lineStyle: { color: '#eceeeb' } } },
    series: [{ type: 'line', data: data?.personal.monthly.map((point) => point.value) ?? [], smooth: true, symbol: 'none', areaStyle: { color: 'rgba(100,131,107,.12)' }, lineStyle: { color: '#55745e', width: 2 } }]
  }), [data])
  const personalYearlyOption = useMemo(() => ({
    grid: { left: 40, right: 12, top: 16, bottom: 34 }, tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: data?.personal.yearly.map((point) => point.label) ?? [], axisLabel: { color: '#7d857d', fontSize: 10 }, axisLine: { lineStyle: { color: '#d6dad5' } } },
    yAxis: { type: 'value', axisLabel: { color: '#7d857d' }, splitLine: { lineStyle: { color: '#eceeeb' } } },
    series: [{ type: 'bar', data: data?.personal.yearly.map((point) => point.value) ?? [], itemStyle: { color: '#b47758' }, barMaxWidth: 44 }]
  }), [data])

  const select = (id: string): void => { setSelectedId(id); onSelectRelationship(id) }
  if (!data) return <div className="app-loading">正在计算关系与个人统计…</div>
  if (!data.items.length) return <EmptyState icon={MessageCircleMore} title="还没有可分析的单聊" description="关系分析只使用联系人单聊，导入记录后会自动生成。" />
  if (selectedId) return detail ? <RelationshipDetailView detail={detail} onBack={() => { setSelectedId(undefined); onSelectRelationship(undefined) }} onOpenConversation={onOpenConversation} /> : <div className="app-loading">正在整理这段关系…</div>

  const personal = data.personal
  return <div className="page-stack">
    <header className="page-header"><div><span className="eyebrow">关系与个人分析</span><h1>最近和谁联系得更多</h1><p>{data.currentWindow.label}对比{data.previousWindow.label}；只描述消息、时间与参与，不判断关系好坏。</p></div></header>

    {data.observations.length > 0 && <section><div className="section-heading"><div><h2>最近的变化</h2><p>联系增多和重新联系优先</p></div><TrendingUp size={20} /></div><div className="observation-list compact-observations">{data.observations.slice(0, 6).map((observation) => <button key={observation.id} onClick={() => observation.conversationId && select(observation.conversationId)}><span className={`observation-mark trend-${observation.kind}`}><TrendingUp size={16} /></span><span><strong>{observation.title}</strong><small>{observation.description}</small></span><ArrowRight size={16} /></button>)}</div></section>}

    <section className="metric-grid">
      <div className="metric"><span>我最近发出</span><strong>{number(personal.current.messages)}</strong><small>此前 {number(personal.previous.messages)} 条</small></div>
      <div className="metric metric-warm"><span>联系人数</span><strong>{personal.activeContacts.current}</strong><small>较此前 {personal.activeContacts.delta >= 0 ? '+' : ''}{personal.activeContacts.delta}</small></div>
      <div className="metric metric-cool"><span>文字输出</span><strong>{number(personal.current.textCharacters)}</strong><small>约 {number(Math.round(personal.current.textCharacters / 500))} 页文字</small></div>
      <div className="metric"><span>前 5 人占比</span><strong>{personal.topFiveShare}%</strong><small>第一位占 {personal.topContactShare}%</small></div>
    </section>

    <section className="content-grid relationship-map-grid">
      <div className="panel"><div className="panel-heading"><div><h2>个人关系图</h2><p>节点大小为累计消息，连线为最近活跃度；最多展示 40 人</p></div><Network size={20} /></div><Chart option={networkOption} ariaLabel="个人关系活动图" height={430} onSelect={(id) => { if (id !== '__self__') select(id) }} /><div className="network-legend"><span className="trend-rising">联系增多</span><span className="trend-reconnected">重新联系</span><span className="trend-stable">相对稳定</span><span className="trend-cooling">联系减少</span><span className="trend-inactive">近期未联系</span>{data.network.hiddenCount > 0 && <small>另有 {data.network.hiddenCount} 位未显示</small>}</div></div>
      <div className="panel personal-patterns"><div className="panel-heading"><div><h2>我的聊天节奏</h2><p>只统计我发出的消息</p></div><UserRoundSearch size={20} /></div><dl><div><dt>平均文字长度</dt><dd>{personal.averageSentLength.current} 字 / 条</dd></div><div><dt>主动开启对话</dt><dd>{number(personal.current.conversationStarts)} 次</dd></div><div><dt>活跃聊天日</dt><dd>{number(personal.current.activeDays)} 天</dd></div><div><dt>过去 12 个月月均</dt><dd>{personal.historicalSufficient ? `${number(personal.historicalAverage30 ?? 0)} 条` : '历史不足'}</dd></div><div><dt>去年同期发出</dt><dd>{personal.yearAgoAvailable ? `${number(personal.yearAgoSent)} 条` : '无同期记录'}</dd></div><div><dt>前 10 人占输出</dt><dd>{personal.topTenShare}%</dd></div></dl><h3>最近输出类型</h3><div className="kind-breakdown">{personal.outgoingKinds.slice(0, 8).map((item) => <span key={item.key}><b>{kindLabels[item.key] ?? item.label}</b>{number(item.value)}</span>)}</div><h3>我最近常聊的话题线索</h3><div className="topic-chips">{personal.topics.slice(0, 10).map((topic) => <span key={topic.keyword}>{topic.keyword}<small>{topic.messageCount}</small></span>)}</div></div>
    </section>

    <section className="content-grid"><div className="panel"><div className="panel-heading"><div><h2>我的活跃时段</h2><p>最近 30 天发出消息的小时分布</p></div></div><Chart option={personalHourlyOption} ariaLabel="我的聊天小时分布" height={250} /></div><div className="panel"><div className="panel-heading"><div><h2>我的星期节奏</h2><p>最近 30 天发出消息的星期分布</p></div></div><Chart option={personalWeekdayOption} ariaLabel="我的聊天星期分布" height={250} /></div></section>

    <section className="content-grid"><div className="panel"><div className="panel-heading"><div><h2>我的月度输出</h2><p>按月回看自己发出的全部消息</p></div></div><Chart option={personalMonthlyOption} ariaLabel="我的月度消息输出" height={260} /></div><div className="panel"><div className="panel-heading"><div><h2>我的年度输出</h2><p>按年比较自己的聊天阶段</p></div></div><Chart option={personalYearlyOption} ariaLabel="我的年度消息输出" height={260} /></div></section>

    <section className="panel"><div className="panel-heading"><div><h2>我的投入对象变化</h2><p>比较最近 30 天与此前 30 天，我发给各联系人的消息和占比</p></div></div><div className="output-change-list">{personal.contactChanges.map((item) => <button key={item.conversationId} onClick={() => select(item.conversationId)}><span><strong>{item.displayName}</strong><small>最近占 {item.currentShare}% · 此前占 {item.previousShare}%</small></span><span><b>{number(item.currentSent)}</b><small>{item.delta >= 0 ? '+' : ''}{number(item.delta)} 条</small></span><ArrowRight size={15} /></button>)}</div></section>

    <section className="panel"><div className="panel-heading"><div><h2>所有联系人排名</h2><p>每项都可以按同一口径比较</p></div><div className="relationship-tools"><label className="search-field compact"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索联系人" /></label><select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}><option value="current">最近消息</option><option value="growth">增长数量</option><option value="total">累计消息</option><option value="active">累计活跃日</option><option value="sentShare">我的发送占比</option><option value="starts">我主动开启</option><option value="silence">未联系天数</option><option value="stickers">双方表情</option><option value="characters">双方文字量</option></select></div></div><div className="relationship-table analysis-table"><div className="relationship-head"><span>联系人</span><span>最近排名</span><span>消息变化</span><span>双方占比</span><span>文字量</span><span>表情</span><span>未联系</span></div>{filtered.map((item) => <button key={item.conversationId} onClick={() => select(item.conversationId)}><span className="relationship-person"><Avatar name={item.displayName} dataUrl={item.avatarDataUrl} size={34} /><span><strong>{item.displayName}</strong><small className={`trend-label trend-${item.trend}`}>{trendLabels[item.trend]}</small></span></span><span>第 {item.currentRank} 位<small>{item.rankChange ? `${item.rankChange > 0 ? '↑' : '↓'} ${Math.abs(item.rankChange)}` : '持平'}</small></span><span>{number(item.currentMessages)}<small>{item.messageDelta >= 0 ? '+' : ''}{number(item.messageDelta)}</small></span><span>{item.currentSentCount} / {item.currentReceivedCount}<small>我 {item.sentShare}%</small></span><span>{number(item.currentSentCharacters)} / {number(item.currentReceivedCharacters)}</span><span>{item.currentSentStickers} / {item.currentReceivedStickers}</span><span>{item.daysSinceLastContact} 天</span></button>)}</div></section>
    <div className="coverage-note"><Clock3 size={18} /><span>对话开启按连续 12 小时沉默后的第一条消息计算；回复速度排除超过 7 天的间隔；联系人排名只比较单聊。</span></div>
  </div>
}
