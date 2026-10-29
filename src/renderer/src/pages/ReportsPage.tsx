import { useEffect, useState } from 'react'
import { Download, Eye, ScrollText } from 'lucide-react'
import type { ArchiveSummary, Conversation, ReportPreview, ReportRequest } from '../../../shared/contracts'
import { EmptyState } from '../components/EmptyState'

interface Props { summary: ArchiveSummary; onImport: () => void }

export function ReportsPage({ summary, onImport }: Props): React.JSX.Element {
  const [kind, setKind] = useState<ReportRequest['kind']>('annual')
  const [year, setYear] = useState<number | undefined>(summary.years.at(-1))
  const [conversationId, setConversationId] = useState('')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [preview, setPreview] = useState<ReportPreview>()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => { if (summary.exists) void window.wecat.archive.conversations({ limit: 500 }).then((result) => { setConversations(result.items); setConversationId((current) => current || result.items[0]?.id || '') }) }, [summary.exists])
  if (!summary.exists) return <div className="page-centered"><EmptyState icon={ScrollText} title="建立档案后才能生成报告" description="回忆报告只使用已经导入到本机 WeCat 档案的数据。" action={{ label: '开始导入', onClick: onImport }} /></div>

  const request = (): ReportRequest => kind === 'annual' ? { kind, year } : { kind, conversationId, year }
  const generate = async (): Promise<void> => { setBusy(true); setNotice(''); try { setPreview(await window.wecat.reports.preview(request())) } catch (error) { setNotice(error instanceof Error ? error.message : '无法生成报告。') } finally { setBusy(false) } }
  const exportReport = async (): Promise<void> => {
    setBusy(true); setNotice('')
    try {
      const result = await window.wecat.reports.export(request())
      setNotice(result.message)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法保存报告。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-stack report-page">
      <header className="page-header"><div><span className="eyebrow">回忆报告</span><h1>把一段时间整理成可以留下的作品</h1><p>报告完全离线生成，导出后可独立打开。</p></div></header>
      <div className="report-controls panel">
        <div className="segmented"><button className={kind === 'annual' ? 'active' : ''} onClick={() => setKind('annual')}>年度报告</button><button className={kind === 'conversation' ? 'active' : ''} onClick={() => setKind('conversation')}>单段关系</button></div>
        <label><span>年份</span><select value={year ?? ''} onChange={(event) => setYear(event.target.value ? Number(event.target.value) : undefined)}><option value="">全部年份</option>{summary.years.map((value) => <option key={value}>{value}</option>)}</select></label>
        {kind === 'conversation' && <label className="grow"><span>会话</span><select value={conversationId} onChange={(event) => setConversationId(event.target.value)}>{conversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.displayName}</option>)}</select></label>}
        <button className="button primary" disabled={busy} onClick={() => void generate()}><Eye size={17} />{busy ? '正在生成' : '生成预览'}</button>
        <button className="button" disabled={busy} onClick={() => void exportReport()}><Download size={17} />保存 HTML</button>
      </div>
      {notice && <div className="inline-notice">{notice}</div>}
      {preview ? <div className="report-preview"><iframe title="回忆报告预览" srcDoc={preview.html} sandbox="allow-same-origin" /></div> : <EmptyState icon={ScrollText} title="选择范围并生成预览" description="年度报告适合回顾整体变化，单段关系适合留下一位朋友或一个群的共同经历。" />}
    </div>
  )
}
