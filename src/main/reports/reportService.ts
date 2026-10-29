import { writeFile } from 'node:fs/promises'
import type { ReportPreview, ReportRequest } from '../../shared/contracts'
import type { ArchiveRepository } from '../archive/archiveRepository'
import { AnalyticsService } from '../analytics/analyticsService'
import { MemoryHighlightService } from '../analytics/memoryHighlights'
import { renderReportHtml } from './reportTemplate'

export class ReportService {
  constructor(
    private readonly repository: ArchiveRepository,
    private readonly analytics: AnalyticsService,
    private readonly highlights: MemoryHighlightService
  ) {}

  async preview(request: ReportRequest): Promise<ReportPreview> {
    const summary = await this.repository.summary()
    const conversations = await this.repository.listConversations({ limit: 500 })
    const year = request.kind === 'annual' ? request.year ?? summary.years.at(-1) : request.year
    const conversation = request.conversationId
      ? conversations.items.find((candidate) => candidate.id === request.conversationId)
      : undefined
    if (request.kind === 'conversation' && !conversation) throw new Error('请选择要生成回忆报告的会话。')
    const filter = { year, conversationId: conversation?.id }
    const [analytics, highlights] = await Promise.all([
      this.analytics.get(filter),
      this.highlights.get(filter)
    ])
    const generatedAt = new Date().toISOString()
    const title = request.kind === 'annual'
      ? `${year ?? '全部'} 年的微信记忆`
      : `与 ${conversation?.displayName ?? '这段会话'} 的记忆`
    const subtitle = analytics.empty
      ? '当前选择范围内没有已归档的聊天记录。'
      : `从 ${analytics.messageCount.toLocaleString('zh-CN')} 条本地记录中，重新看见时间、陪伴与那些值得留下的片段。`
    const model = { title, subtitle, analytics, highlights, generatedAt }
    return { ...model, html: renderReportHtml(model) }
  }

  async export(request: ReportRequest, path: string): Promise<void> {
    const preview = await this.preview(request)
    await writeFile(path, preview.html, 'utf8')
  }
}
