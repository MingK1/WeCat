import { useEffect, useState } from 'react'
import { CheckCircle2, CircleAlert, Database, FolderOpen, LoaderCircle, RefreshCw, TerminalSquare } from 'lucide-react'
import type { DependencyStatus, ImportProgress, SourceInspection } from '../../../shared/contracts'

interface Props { onImported: () => void }

export function ImportPage({ onImported }: Props): React.JSX.Element {
  const [sourcePath, setSourcePath] = useState(() => localStorage.getItem('wecat-source-path') ?? '')
  const [inspection, setInspection] = useState<SourceInspection>()
  const [dependencies, setDependencies] = useState<DependencyStatus>()
  const [progress, setProgress] = useState<ImportProgress>()
  const [busy, setBusy] = useState(false)
  const [pollingFor, setPollingFor] = useState<'database' | 'audio'>()
  const [message, setMessage] = useState('')

  const inspect = async (path: string): Promise<void> => {
    if (!path) return
    setBusy(true); setMessage('')
    try {
      const [nextInspection, nextDependencies] = await Promise.all([window.wecat.source.inspect(path), window.wecat.source.dependencies(path)])
      setInspection(nextInspection); setDependencies(nextDependencies)
      if (nextInspection.valid) localStorage.setItem('wecat-source-path', path)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法检查微信数据目录。')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => { if (sourcePath) void inspect(sourcePath) }, [])
  useEffect(() => window.wecat.importer.onProgress(setProgress), [])
  useEffect(() => {
    if (!pollingFor || !sourcePath) return
    let active = true
    const check = async (): Promise<void> => {
      try {
        const next = await window.wecat.source.dependencies(sourcePath)
        if (!active) return
        setDependencies(next)
        const ready = pollingFor === 'database'
          ? next.items.find((item) => item.id === 'weflow-config')?.status === 'ready'
          : next.items.find((item) => item.id === 'audio-assets')?.status === 'ready'
        if (ready) {
          setPollingFor(undefined)
          setMessage(pollingFor === 'database' ? '数据库访问已就绪，可以开始导入。' : '语音解码器已就绪，下次导入会把语音保存为标准 WAV。')
        }
      } catch {
        // 外部初始化终端运行时短暂不可用，下一轮继续检查。
      }
    }
    void check()
    const timer = setInterval(() => void check(), 3000)
    return () => { active = false; clearInterval(timer) }
  }, [pollingFor, sourcePath])

  const choose = async (): Promise<void> => { const selected = await window.wecat.app.chooseSource(); if (selected) { setSourcePath(selected); await inspect(selected) } }
  const initialize = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.wecat.source.initialize(sourcePath)
      setMessage(result.message)
      if (result.success) setPollingFor('database')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法打开初始化终端。')
    } finally {
      setBusy(false)
    }
  }
  const initializeAudio = async (): Promise<void> => {
    try {
      const result = await window.wecat.source.initializeAudioAssets()
      setMessage(result.message)
      if (result.success) setPollingFor('audio')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法打开语音资产准备终端。')
    }
  }
  const startImport = async (): Promise<void> => {
    setBusy(true); setMessage(''); setProgress(undefined)
    try {
      const result = await window.wecat.importer.start({ sourcePath, includeMedia: true })
      setMessage(result.message)
      if (result.success) {
        setBusy(false)
        setProgress(undefined)
        await inspect(sourcePath)
        onImported()
        return
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导入未完成，上一次完整档案未受影响。')
    } finally {
      setBusy(false)
    }
  }
  const percent = progress?.total ? Math.round((progress.completed / progress.total) * 100) : 0

  return (
    <div className="page-stack import-page">
      <header className="page-header"><div><span className="eyebrow">导入与更新</span><h1>从微信本地目录建立回忆档案</h1><p>微信原始数据库只读。WeCat 在独立目录中保存可重复更新的档案。</p></div></header>
      <section className="import-source panel">
        <div className="panel-heading"><div><h2>1. 微信数据目录</h2><p>可选择 xwechat_files 总目录、账号目录或 db_storage</p></div><Database size={20} /></div>
        <div className="path-picker"><input value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} placeholder="选择微信数据目录" /><button className="icon-button" onClick={() => void choose()} title="选择文件夹"><FolderOpen size={19} /></button><button className="button" disabled={!sourcePath || busy} onClick={() => void inspect(sourcePath)}><RefreshCw size={16} />检查</button></div>
        {inspection && <div className={inspection.valid ? 'source-result valid' : 'source-result invalid'}><span>{inspection.valid ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}</span><div><strong>{inspection.valid ? inspection.accountLabel : '目录不可用'}</strong><p>{inspection.valid ? `${inspection.databaseInventory.message} 个消息库 · ${inspection.databaseInventory.media} 个语音库 · ${inspection.mediaDirectories.length} 类媒体目录` : inspection.warnings.join(' ')}</p></div></div>}
      </section>
      <section className="panel">
        <div className="panel-heading"><div><h2>2. 解析环境</h2><p>WeFlow 负责读取微信 4.x 数据库和媒体索引</p></div><TerminalSquare size={20} /></div>
        <div className="dependency-list">
          {(dependencies?.items ?? []).map((item) => <div key={item.id}><span className={`dependency-dot status-${item.status}`}>{item.status === 'ready' ? <CheckCircle2 size={17} /> : <CircleAlert size={17} />}</span><span><strong>{item.label}</strong><small>{item.detail}{item.version ? ` · ${item.version}` : ''}</small></span></div>)}
          {!dependencies && <p className="muted">选择目录后检查环境。</p>}
        </div>
        {dependencies?.items.some((item) => item.id === 'weflow-config' && item.status !== 'ready') && <button className="button" disabled={!inspection?.valid || busy} onClick={() => void initialize()}><TerminalSquare size={17} />打开初始化终端</button>}
        {dependencies?.items.find((item) => item.id === 'weflow-config')?.status === 'ready' && dependencies.items.find((item) => item.id === 'audio-assets')?.status !== 'ready' && <button className="button" disabled={busy} onClick={() => void initializeAudio()}><TerminalSquare size={17} />准备语音明文资产</button>}
        {pollingFor && <p className="polling-note"><LoaderCircle className="spin" size={15} />正在等待外部终端完成，状态会自动刷新，无需手动点击检查。</p>}
      </section>
      <section className="panel">
        <div className="panel-heading"><div><h2>3. 建立或更新档案</h2><p>导入消息、文件索引与可用媒体，失败时保留上一次完整档案</p></div>{busy ? <LoaderCircle className="spin" size={20} /> : <Database size={20} />}</div>
        {progress && <div className="progress-block"><div><strong>{progress.detail}</strong><span>{percent}%</span></div><span className="progress-track"><i style={{ width: `${percent}%` }} /></span><small>{progress.completed.toLocaleString('zh-CN')} / {progress.total.toLocaleString('zh-CN')}</small></div>}
        <div className="import-actions"><button className="button primary" disabled={!inspection?.valid || !dependencies?.ready || busy} onClick={() => void startImport()}>{busy ? <LoaderCircle className="spin" size={17} /> : <Database size={17} />}{busy ? '正在导入' : '导入全部会话'}</button>{busy && <button className="button danger" onClick={() => void window.wecat.importer.cancel()}>取消导入</button>}</div>
        {message && <div className="inline-notice">{message}</div>}
      </section>
    </div>
  )
}
