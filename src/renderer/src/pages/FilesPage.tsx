import { useEffect, useState } from 'react'
import { Archive, ExternalLink, FileArchive, FileText, Image, Search, Video, Volume2 } from 'lucide-react'
import type { Availability, MediaKind, MediaRecord } from '../../../shared/contracts'
import { EmptyState } from '../components/EmptyState'

const icons = { image: Image, video: Video, voice: Volume2, sticker: Image, file: FileText }
const kindLabels = { image: '图片', video: '视频', voice: '语音', sticker: '表情', file: '文件' }
const size = (value?: number): string => value === undefined ? '大小未知' : value < 1024 * 1024 ? `${Math.round(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`

export function FilesPage(): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<MediaKind | 'all'>('all')
  const [availability, setAvailability] = useState<Availability | 'all'>('all')
  const [items, setItems] = useState<MediaRecord[]>([])
  const [total, setTotal] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => {
      void window.wecat.archive.media({ search, kinds: kind === 'all' ? undefined : [kind], availability, limit: 500 }).then((result) => { setItems(result.items); setTotal(result.total) })
    }, 120)
    return () => clearTimeout(timer)
  }, [search, kind, availability])

  return (
    <div className="page-stack">
      <header className="page-header"><div><span className="eyebrow">长期存储</span><h1>导出个人 WeCat Library</h1><p>当前档案包含 {total.toLocaleString('zh-CN')} 条媒体记录；聊天由 HTML 阅读，媒体保持普通文件格式。</p></div><button className="button primary" disabled={exporting} onClick={() => { setExporting(true); setNotice(''); void window.wecat.preservation.export({}).then((result) => setNotice(result.message)).catch((error) => setNotice(error instanceof Error ? error.message : 'Library 导出失败。')).finally(() => setExporting(false)) }}><Archive size={17} />{exporting ? '正在生成' : '导出 Library'}</button></header>
      <div className="asset-explain"><div><strong>chat</strong><span>按会话保存可读 HTML</span></div><div><strong>image / video / voice</strong><span>按媒体类型分类</span></div><div><strong>file / sticker / avatar</strong><span>保留普通文件</span></div><div><strong>manifest.json</strong><span>校验值与缺失清单</span></div></div>
      {notice && <div className="inline-notice">{notice}</div>}
      <div className="toolbar">
        <label className="search-field"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索文件名" /></label>
        <select value={kind} onChange={(event) => setKind(event.target.value as MediaKind | 'all')}><option value="all">全部类型</option>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select value={availability} onChange={(event) => setAvailability(event.target.value as Availability | 'all')}><option value="all">全部状态</option><option value="available">本地可用</option><option value="missing">已缺失</option><option value="unresolved">未定位</option></select>
      </div>
      {!items.length ? <EmptyState icon={FileArchive} title="没有匹配的文件或媒体" description="调整筛选条件，或在导入时开启媒体匹配。" /> : (
        <div className="file-table">
          <div className="file-table-head"><span>名称</span><span>类型</span><span>日期</span><span>大小</span><span>状态</span><span>操作</span></div>
          {items.map((record) => {
            const Icon = icons[record.kind]
            return <div className="file-row" key={record.id}><span className="file-name"><i><Icon size={17} /></i><strong>{record.originalName || `${kindLabels[record.kind]}记录`}</strong></span><span>{kindLabels[record.kind]}</span><time>{new Date(record.createdAt).toLocaleDateString('zh-CN')}</time><span>{size(record.size)}</span><span className={`availability availability-${record.availability}`}>{record.availability === 'available' ? '本地可用' : record.availability === 'missing' ? '已缺失' : '未定位'}</span><button className="table-action" disabled={record.availability !== 'available'} onClick={() => void window.wecat.archive.openMedia(record.id)} title="使用系统默认程序打开"><ExternalLink size={15} /></button></div>
          })}
        </div>
      )}
    </div>
  )
}
