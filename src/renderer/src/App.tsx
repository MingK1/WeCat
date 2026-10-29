import { useCallback, useEffect, useState } from 'react'
import type { ArchiveSummary, NavigationPage } from '../../shared/contracts'
import { AppShell } from './components/AppShell'
import { FilesPage } from './pages/FilesPage'
import { ImportPage } from './pages/ImportPage'
import { OverviewPage } from './pages/OverviewPage'
import { PeoplePage } from './pages/PeoplePage'
import { ReportsPage } from './pages/ReportsPage'
import { TimelinePage } from './pages/TimelinePage'
import { RelationshipPage } from './pages/RelationshipPage'

interface ChatTarget {
  conversationId: string
  from?: string
  to?: string
  messageId?: string
}

export default function App(): React.JSX.Element {
  const [summary, setSummary] = useState<ArchiveSummary>()
  const [page, setPage] = useState<NavigationPage>('overview')
  const [chatTarget, setChatTarget] = useState<ChatTarget>()
  const [relationshipId, setRelationshipId] = useState<string>()

  const refresh = useCallback(() => window.wecat.archive.summary().then(setSummary), [])
  useEffect(() => { void refresh() }, [refresh])

  const openConversation = (conversationId: string, target: Omit<ChatTarget, 'conversationId'> = {}): void => { setChatTarget({ conversationId, ...target }); setPage('timeline') }
  const openRelationship = (id: string): void => { setRelationshipId(id); setPage('relationships') }

  if (!summary) return <div className="app-loading">正在打开 WeCat…</div>

  const content = (() => {
    switch (page) {
      case 'overview': return <OverviewPage summary={summary} onImport={() => setPage('import')} onOpenConversation={openConversation} onOpenRelationship={openRelationship} />
      case 'relationships': return <RelationshipPage initialRelationshipId={relationshipId} onOpenConversation={openConversation} onSelectRelationship={setRelationshipId} />
      case 'people': return <PeoplePage onOpenConversation={(id) => openConversation(id)} />
      case 'timeline': return <TimelinePage initialConversationId={chatTarget?.conversationId} initialFrom={chatTarget?.from} initialTo={chatTarget?.to} initialMessageId={chatTarget?.messageId} />
      case 'files': return <FilesPage />
      case 'reports': return <ReportsPage summary={summary} onImport={() => setPage('import')} />
      case 'import': return <ImportPage onImported={() => { void refresh() }} />
    }
  })()

  return (
    <AppShell page={page} onNavigate={(next) => { setPage(next); if (next !== 'timeline') setChatTarget(undefined); if (next !== 'relationships') setRelationshipId(undefined) }} archiveLabel={summary.accountLabel}>{content}</AppShell>
  )
}
