import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Database, History, Import, MessageCircleMore, TrendingUp, UserRoundSearch } from 'lucide-react'
import type { ArchiveAnalytics, ArchiveSummary, MemoryHighlight, RelationshipOverview } from '../../../shared/contracts'
import { Chart } from '../components/Chart'
import { EmptyState } from '../components/EmptyState'
import { Metric } from '../components/Metric'
import { Avatar } from '../components/Avatar'

interface Props {
  summary: ArchiveSummary
  onImport: () => void
  onOpenConversation: (id: string) => void
  onOpenRelationship: (id: string) => void
}

const number = (value?: number): string => (value ?? 0).toLocaleString('zh-CN')
const date = (value?: string): string => value ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value)) : '暂无'

export function OverviewPage({ summary, onImport, onOpenConversation, onOpenRelationship }: Props): React.JSX.Element {
  const [analytics, setAnalytics] = useState<ArchiveAnalytics>()
  const [highlights, setHighlights] = useState<MemoryHighlight[]>([])
  const [relationships, setRelationships] = useState<RelationshipOverview>()

  useEffect(() => {
    if (!summary.exists) return
    void Promise.all([
      window.wecat.analytics.get(),
      window.wecat.analytics.highlights(),
      window.wecat.analytics.relationships()
    ]).then(([nextAnalytics, nextHighlights, nextRelationships]) => {
      setAnalytics(nextAnalytics)
      setHighlights(nextHighlights)
      setRelationships(nextRelationships)
    })
  }, [summary])

  const activityOption = useMemo(() => ({
    grid: { left: 34, right: 12, top: 18, bottom: 32 },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: analytics?.monthly.map((point) => point.label) ?? [], axisLine: { lineStyle: { color: '#cfd3cc' } }, axisLabel: { color: '#6b736b' } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: '#e2e4df' } }, axisLabel: { color: '#828982' } },
    series: [{ type: 'line', data: analytics?.monthly.map((point) => point.value) ?? [], smooth: true, symbol: 'none', areaStyle: { color: 'rgba(94,126,92,.12)' }, lineStyle: { color: '#59775a', width: 2 } }]
  }), [analytics])

  if (!summary.exists) {
    return <div className="page-centered"><EmptyState icon={Database} title="还没有 WeCat 档案" description="从微信本地目录导入后，人物、聊天回忆、文件和关系分析会出现在这里。" action={{ label: '开始导入', onClick: onImport }} /></div>
  }

  const personal = relationships?.personal
  const observations = relationships?.observations.slice(0, 4) ?? []
  const currentContacts = relationships?.items.filter((item) => item.currentMessages > 0).slice(0, 8) ?? []

  return (
    <div className="page-stack">
      <header className="page-header">
        <div><span className="eyebrow">回忆总览</span><h1>{summary.accountLabel}</h1><p>{date(summary.firstMessageAt)} 至 {date(summary.lastMessageAt)}，上次导入 {date(summary.lastImport?.completedAt)}</p></div>
        <button className="button" onClick={onImport}><Import size={17} />更新档案</button>
      </header>
      <section className="metric-grid">
        <Metric label="最近发出" value={number(personal?.current.messages ?? 0)} detail={`此前 ${number(personal?.previous.messages ?? 0)} 条${personal?.historicalSufficient ? ` · 历史月均 ${number(personal.historicalAverage30 ?? 0)}` : ''}`} />
        <Metric label="最近联系" value={`${personal?.activeContacts.current ?? 0} 人`} detail={`较此前 ${personal?.activeContacts.delta && personal.activeContacts.delta > 0 ? '+' : ''}${personal?.activeContacts.delta ?? 0}`} tone="warm" />
        <Metric label="最近文字输出" value={number(personal?.current.textCharacters ?? 0)} detail={`约 ${number(Math.round((personal?.current.textCharacters ?? 0) / 500))} 页文字`} tone="cool" />
        <Metric label="输出集中度" value={`${personal?.topContactShare ?? 0}%`} detail="发给最近联系最多的人" />
      </section>

      <section>
        <div className="section-heading"><div><h2>最近值得注意的联系</h2><p>优先呈现持续增长、重新联系和排名变化</p></div></div>
        {observations.length ? <div className="observation-list">{observations.map((observation) => (
          <button key={observation.id} onClick={() => observation.conversationId && onOpenRelationship(observation.conversationId)}>
            <span className={`observation-mark trend-${observation.kind}`}><TrendingUp size={17} /></span>
            <span><strong>{observation.title}</strong><small>{observation.description}</small></span>
            <span className="observation-values"><b>{number(observation.currentValue)}</b><small>此前 {number(observation.previousValue)}</small></span>
            <ArrowRight size={16} />
          </button>
        ))}</div> : <div className="quiet-state">最近 30 天暂时没有达到展示条件的明显关系变化。</div>}
      </section>

      <section className="content-grid overview-grid">
        <div className="panel wide-panel">
          <div className="panel-heading"><div><h2>消息随时间的变化</h2><p>按月统计已归档消息</p></div><History size={20} /></div>
          <Chart option={activityOption} ariaLabel="按月消息数量折线图" />
        </div>
        <div className="panel">
          <div className="panel-heading"><div><h2>最近联系人排名</h2><p>{relationships?.currentWindow.label ?? '最近 30 天'}按消息量排列</p></div><UserRoundSearch size={20} /></div>
          <div className="compact-list ranked-contacts">
            {currentContacts.map((item) => (
              <button key={item.conversationId} onClick={() => onOpenRelationship(item.conversationId)}>
                <span className="rank-number">{item.currentRank}</span><Avatar name={item.displayName} dataUrl={item.avatarDataUrl} size={32} /><span><strong>{item.displayName}</strong><small>{number(item.currentMessages)} 条 · {item.rankChange === undefined || item.rankChange === 0 ? '排名不变' : item.rankChange > 0 ? `上升 ${item.rankChange} 位` : `下降 ${Math.abs(item.rankChange)} 位`}</small></span>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="section-heading"><div><h2>值得重看的片段</h2><p>由本地记录直接计算，并保留原消息引用</p></div><MessageCircleMore size={20} /></div>
        <div className="highlight-grid">
          {highlights.slice(0, 6).map((highlight) => (
            <button key={highlight.id} className="highlight-card" onClick={() => highlight.conversationId && onOpenConversation(highlight.conversationId)}>
              <time>{date(highlight.date)}</time><h3>{highlight.title}</h3><p>{highlight.description}</p>
            </button>
          ))}
        </div>
      </section>
      {summary.coverage.missingMediaCount + summary.coverage.unresolvedMediaCount > 0 && (
        <div className="coverage-note"><Database size={18} /><span>有 {number(summary.coverage.missingMediaCount)} 条媒体已从微信缓存中缺失，另有 {number(summary.coverage.unresolvedMediaCount)} 条未能可靠定位。文字与消息统计仍会保留。</span></div>
      )}
    </div>
  )
}
