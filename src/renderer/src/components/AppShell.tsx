import type { LucideIcon } from 'lucide-react'
import { CalendarDays, CircleUserRound, FileArchive, Import, LayoutDashboard, ScrollText, Users } from 'lucide-react'
import type { NavigationPage } from '../../../shared/contracts'
import wecatIcon from '../../../../resources/icon.svg?url'

interface Props {
  page: NavigationPage
  onNavigate: (page: NavigationPage) => void
  archiveLabel?: string
  children: React.ReactNode
}

const items: Array<{ id: NavigationPage; label: string; icon: LucideIcon }> = [
  { id: 'overview', label: '总览', icon: LayoutDashboard },
  { id: 'relationships', label: '关系回顾', icon: CircleUserRound },
  { id: 'people', label: '人物与群聊', icon: Users },
  { id: 'timeline', label: '聊天回忆', icon: CalendarDays },
  { id: 'files', label: '文件与媒体', icon: FileArchive },
  { id: 'reports', label: '回忆报告', icon: ScrollText },
  { id: 'import', label: '导入与更新', icon: Import }
]

export function AppShell({ page, onNavigate, archiveLabel, children }: Props): React.JSX.Element {
  return (
    <div className={page === 'timeline' ? 'app-shell chat-mode' : 'app-shell'}>
      <aside className="sidebar app-rail">
        <button className="brand" onClick={() => onNavigate('overview')} aria-label="返回总览">
          <span className="brand-icon"><img src={wecatIcon} alt="" /></span>
        </button>
        <nav aria-label="主导航">
          {items.map((item) => {
            const Icon = item.icon
            return (
              <button key={item.id} className={page === item.id ? 'nav-item active' : 'nav-item'} onClick={() => onNavigate(item.id)} title={item.label} aria-label={item.label}>
                <Icon size={18} strokeWidth={1.8} />
              </button>
            )
          })}
        </nav>
        <div className="sidebar-foot">
          <span className="rail-status" title={archiveLabel || '尚未建立'}>{archiveLabel ? archiveLabel.slice(-2) : '未'}</span>
        </div>
      </aside>
      <div className="main-column">
        <div className="mobile-bar">
          <img className="mobile-brand-icon" src={wecatIcon} alt="" />
          <strong>WeCat</strong>
          <select value={page} onChange={(event) => onNavigate(event.target.value as NavigationPage)} aria-label="选择页面">
            {items.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </div>
        <main className="page-content">{children}</main>
      </div>
    </div>
  )
}
