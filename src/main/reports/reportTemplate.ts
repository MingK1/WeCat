import type { ArchiveAnalytics, MemoryHighlight, ReportPreview, TimeSeriesPoint } from '../../shared/contracts'

function escapeHtml(value: string | number | undefined): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatDate(value?: string): string {
  if (!value) return '尚无记录'
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(value))
}

function barRows(points: TimeSeriesPoint[], color = '#668a65'): string {
  const maximum = Math.max(1, ...points.map((point) => point.value))
  return points.map((point) => `
    <div class="bar-row">
      <span class="bar-label">${escapeHtml(point.label)}</span>
      <span class="bar-track"><i style="width:${Math.max(2, (point.value / maximum) * 100)}%;background:${color}"></i></span>
      <strong>${point.value.toLocaleString('zh-CN')}</strong>
    </div>`).join('')
}

function highlightCards(highlights: MemoryHighlight[]): string {
  if (!highlights.length) return '<p class="muted">这个范围内还没有可生成的回忆片段。</p>'
  return highlights.slice(0, 12).map((highlight) => `
    <article class="memory">
      <time>${escapeHtml(highlight.date ? formatDate(highlight.date) : '')}</time>
      <h3>${escapeHtml(highlight.title)}</h3>
      <p>${escapeHtml(highlight.description)}</p>
    </article>`).join('')
}

export function renderReportHtml(preview: Omit<ReportPreview, 'html'>): string {
  const { analytics, highlights } = preview
  const mediaCoverage = analytics.coverage.mediaCount
    ? Math.round((analytics.coverage.availableMediaCount / analytics.coverage.mediaCount) * 100)
    : 100
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(preview.title)}</title>
<style>
:root{font-family:"Segoe UI","Microsoft YaHei UI",sans-serif;color:#252923;background:#f2f0e9;letter-spacing:0}
*{box-sizing:border-box}body{margin:0}main{max-width:1040px;margin:auto;padding:64px 34px 96px}
header{padding:46px 0 54px;border-bottom:1px solid #c9ccc4}header small{color:#7e6548;font-weight:700;text-transform:uppercase}h1{max-width:800px;margin:16px 0 12px;font-size:clamp(40px,8vw,78px);line-height:1.02;font-weight:680;letter-spacing:0}header p{max-width:720px;color:#646b64;font-size:18px;line-height:1.7}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;margin:38px 0;background:#c9ccc4;border:1px solid #c9ccc4}.metric{background:#f7f6f2;padding:24px}.metric span{display:block;color:#737a72;font-size:13px}.metric strong{display:block;margin-top:8px;font-size:30px;font-weight:650}
section{padding:46px 0;border-bottom:1px solid #d4d6cf}h2{margin:0 0 24px;font-size:28px;font-weight:640}.split{display:grid;grid-template-columns:1fr 1fr;gap:52px}.bar-row{display:grid;grid-template-columns:72px minmax(0,1fr) 56px;gap:10px;align-items:center;margin:10px 0;font-size:13px}.bar-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#646b64}.bar-track{height:8px;background:#dedfd9}.bar-track i{display:block;height:100%;min-width:2px}.bar-row strong{text-align:right;font-size:12px}
.memories{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.memory{min-height:170px;padding:24px;border:1px solid #d0d2cb;background:#faf9f5}.memory time{color:#8a6c4e;font-size:12px}.memory h3{margin:13px 0 10px;font-size:19px}.memory p{margin:0;color:#606860;line-height:1.7}
.rank{counter-reset:rank;list-style:none;padding:0;margin:0}.rank li{counter-increment:rank;display:grid;grid-template-columns:32px minmax(0,1fr) auto;padding:13px 0;border-bottom:1px solid #dedfd9}.rank li:before{content:counter(rank);color:#8a6c4e}.rank span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rank strong{font-variant-numeric:tabular-nums}.note{padding:18px;border-left:3px solid #ba7a54;background:#f8eee6;color:#685746;line-height:1.65}.muted{color:#777f77}footer{padding-top:34px;color:#747a74;font-size:12px;line-height:1.7}
@media(max-width:760px){main{padding:40px 20px 72px}.metrics{grid-template-columns:1fr 1fr}.split,.memories{grid-template-columns:1fr}header{padding-top:18px}.bar-row{grid-template-columns:62px minmax(0,1fr) 46px}}
@media print{body{background:#fff}main{max-width:none}.memory,.metric{break-inside:avoid}}
</style>
</head>
<body><main>
<header><small>WeCat · 本地回忆档案</small><h1>${escapeHtml(preview.title)}</h1><p>${escapeHtml(preview.subtitle)}</p></header>
<div class="metrics">
  <div class="metric"><span>消息记录</span><strong>${analytics.messageCount.toLocaleString('zh-CN')}</strong></div>
  <div class="metric"><span>活跃天数</span><strong>${analytics.activeDays.toLocaleString('zh-CN')}</strong></div>
  <div class="metric"><span>连续记录</span><strong>${analytics.longestActiveStreak} 天</strong></div>
  <div class="metric"><span>本地媒体覆盖</span><strong>${mediaCoverage}%</strong></div>
</div>
<section><h2>时间留下的轮廓</h2><div class="split"><div><h3>月份</h3>${barRows(analytics.monthly, '#668a65')}</div><div><h3>一天中的时刻</h3>${barRows(analytics.hourly, '#b77c52')}</div></div></section>
<section><h2>值得重看的片段</h2><div class="memories">${highlightCards(highlights)}</div></section>
<section><div class="split"><div><h2>记录类型</h2>${barRows(analytics.messageKinds, '#5d7f91')}</div><div><h2>最常出现的会话</h2><ol class="rank">${analytics.topConversations.slice(0,10).map((item) => `<li><span>${escapeHtml(item.label)}</span><strong>${item.value.toLocaleString('zh-CN')}</strong></li>`).join('')}</ol></div></div></section>
<section><h2>档案范围</h2><p class="note">这份报告覆盖 ${escapeHtml(formatDate(analytics.firstMessageAt))} 至 ${escapeHtml(formatDate(analytics.lastMessageAt))}，包含 ${analytics.coverage.conversationCount.toLocaleString('zh-CN')} 个会话、${analytics.coverage.messageCount.toLocaleString('zh-CN')} 条消息和 ${analytics.coverage.mediaCount.toLocaleString('zh-CN')} 条媒体记录。其中 ${analytics.coverage.missingMediaCount.toLocaleString('zh-CN')} 条本地媒体已经缺失，${analytics.coverage.unresolvedMediaCount.toLocaleString('zh-CN')} 条尚未能可靠匹配。</p></section>
<footer>生成时间：${escapeHtml(new Date(preview.generatedAt).toLocaleString('zh-CN'))}<br>所有统计由 WeCat 在本机根据已导入档案计算。本页不依赖网络资源。</footer>
</main></body></html>`
}
