export type NavigationPage = 'overview' | 'relationships' | 'people' | 'timeline' | 'files' | 'reports' | 'import'

export type ConversationKind = 'direct' | 'group' | 'official' | 'unknown'
export type MessageDirection = 'sent' | 'received' | 'system' | 'unknown'
export type MessageKind =
  | 'text'
  | 'image'
  | 'video'
  | 'voice'
  | 'sticker'
  | 'file'
  | 'link'
  | 'location'
  | 'payment'
  | 'call'
  | 'system'
  | 'unknown'
export type MediaKind = 'image' | 'video' | 'voice' | 'sticker' | 'file'
export type Availability = 'available' | 'missing' | 'unresolved'
export type MatchConfidence = 'exact' | 'probable' | 'unknown'

export interface DatabaseInventory {
  session: number
  contact: number
  message: number
  media: number
  hardlink: number
  other: number
}

export interface SourceInspection {
  inputPath: string
  accountLabel?: string
  valid: boolean
  databaseInventory: DatabaseInventory
  mediaDirectories: Array<'attach' | 'file' | 'video'>
  warnings: string[]
}

export interface DependencyItem {
  id: 'node' | 'python' | 'weflow' | 'source' | 'weflow-config' | 'audio-assets'
  label: string
  status: 'ready' | 'missing' | 'attention' | 'unknown'
  detail: string
  version?: string
}

export interface DependencyStatus {
  ready: boolean
  items: DependencyItem[]
}

export interface CommandResult {
  success: boolean
  message: string
  code?: number
}

export interface Conversation {
  id: string
  displayName: string
  kind: ConversationKind
  avatarDataUrl?: string
  participantCount?: number
  messageCount: number
  firstMessageAt?: string
  lastMessageAt?: string
}

export interface Person {
  id: string
  displayName: string
  remark?: string
  nickname?: string
  avatarDataUrl?: string
  kind: ConversationKind
  hasConversation: boolean
  messageCount: number
  firstMessageAt?: string
  lastMessageAt?: string
}

export interface Moment {
  id: string
  authorId: string
  authorName: string
  content: string
  createdAt: string
  mediaCount: number
  isOwn: boolean
}

export interface MediaRecord {
  id: string
  messageId: string
  conversationId: string
  kind: MediaKind
  originalName?: string
  extension?: string
  size?: number
  pathToken?: string
  availability: Availability
  confidence: MatchConfidence
  contentHash?: string
  createdAt: string
  direction: MessageDirection
}

export interface Message {
  id: string
  conversationId: string
  senderId?: string
  senderName?: string
  direction: MessageDirection
  timestamp: string
  kind: MessageKind
  content: string
  rawType?: string
  media?: MediaRecord
  sourceLocalId?: string
  sourceServerId?: string
}

export interface ArchiveCoverage {
  conversationCount: number
  messageCount: number
  mediaCount: number
  availableMediaCount: number
  missingMediaCount: number
  unresolvedMediaCount: number
}

export interface ImportRun {
  id: string
  startedAt: string
  completedAt?: string
  status: 'running' | 'complete' | 'failed' | 'cancelled'
  adapterVersion?: string
  coverage: ArchiveCoverage
  warnings: string[]
}

export interface ArchiveSummary {
  exists: boolean
  schemaVersion: number
  accountLabel?: string
  firstMessageAt?: string
  lastMessageAt?: string
  years: number[]
  coverage: ArchiveCoverage
  lastImport?: ImportRun
  peopleCount?: number
  accountAvatarDataUrl?: string
}

export interface ConversationQuery {
  search?: string
  kind?: ConversationKind | 'all'
  limit?: number
  offset?: number
}

export interface MessageQuery {
  conversationId?: string
  messageId?: string
  search?: string
  kinds?: MessageKind[]
  direction?: MessageDirection | 'all'
  year?: number
  from?: string
  to?: string
  limit?: number
  offset?: number
}

export interface MediaQuery {
  conversationId?: string
  search?: string
  kinds?: MediaKind[]
  availability?: Availability | 'all'
  year?: number
  limit?: number
  offset?: number
}

export interface PagedResult<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

export interface ImportRequest {
  sourcePath: string
  conversationIds?: string[]
  includeMedia: boolean
}

export interface ImportProgress {
  runId: string
  phase: 'inspect' | 'dependencies' | 'sessions' | 'contacts' | 'messages' | 'media' | 'archive' | 'complete'
  completed: number
  total: number
  detail: string
}

export interface ImportResult {
  success: boolean
  run?: ImportRun
  message: string
}

export interface AnalyticsFilter {
  conversationId?: string
  year?: number
}

export interface TimeSeriesPoint {
  key: string
  label: string
  value: number
}

export interface RankedItem {
  id: string
  label: string
  value: number
}

export interface WordFrequency {
  word: string
  count: number
}

export interface AnalysisWindow {
  from: string
  to: string
  label: string
  days: number
}

export interface ComparisonValue {
  current: number
  previous: number
  delta: number
  changePercent?: number
}

export interface ParticipationBreakdown {
  messages: number
  textMessages: number
  textCharacters: number
  images: number
  videos: number
  voices: number
  stickers: number
  files: number
  other: number
  conversationStarts: number
  activeDays: number
}

export interface TopicExcerpt {
  messageId: string
  timestamp: string
  direction: MessageDirection
  content: string
}

export interface TopicClue {
  keyword: string
  relatedTerms: string[]
  messageCount: number
  shareOfText: number
  sentCount: number
  receivedCount: number
  firstAt: string
  lastAt: string
  excerpts: TopicExcerpt[]
}

export type RelationshipTrend = 'rising' | 'reconnected' | 'stable' | 'cooling' | 'inactive'

export interface RelationshipObservation {
  id: string
  kind: 'rising' | 'reconnected' | 'ranking' | 'concentration' | 'cooling' | 'silent'
  title: string
  description: string
  priority: number
  conversationId?: string
  currentValue: number
  previousValue: number
  currentRank?: number
  previousRank?: number
  window: AnalysisWindow
}

export interface RelationshipNetworkNode {
  id: string
  name: string
  totalMessages: number
  currentMessages: number
  trend: RelationshipTrend
  avatarDataUrl?: string
}

export interface RelationshipNetwork {
  nodes: RelationshipNetworkNode[]
  hiddenCount: number
}

export interface ContactOutputChange {
  conversationId: string
  displayName: string
  currentSent: number
  previousSent: number
  delta: number
  currentShare: number
  previousShare: number
}

export interface PersonalAnalysis {
  currentWindow: AnalysisWindow
  previousWindow: AnalysisWindow
  current: ParticipationBreakdown
  previous: ParticipationBreakdown
  activeContacts: ComparisonValue
  topContactShare: number
  topFiveShare: number
  topTenShare: number
  averageSentLength: ComparisonValue
  historicalAverage30?: number
  yearAgoSent: number
  yearAgoAvailable: boolean
  historicalSufficient: boolean
  hourly: TimeSeriesPoint[]
  weekdays: TimeSeriesPoint[]
  monthly: TimeSeriesPoint[]
  yearly: TimeSeriesPoint[]
  outgoingKinds: TimeSeriesPoint[]
  topics: TopicClue[]
  contactChanges: ContactOutputChange[]
}

export interface ParticipationComparison {
  sent: ParticipationBreakdown
  received: ParticipationBreakdown
}

export interface DirectionSeriesPoint {
  key: string
  label: string
  sent: number
  received: number
}

export interface RelationshipDayPoint {
  date: string
  sent: number
  received: number
  period: 'current' | 'previous'
}

export interface RelationshipRecord {
  busiestDay?: { date: string; messages: number }
  firstMessageAt?: string
  lastMessageAt?: string
  longestSilenceDays: number
  longestActiveStreak: number
}

export interface RelationshipInsight {
  conversationId: string
  displayName: string
  avatarDataUrl?: string
  messageCount: number
  activeDays: number
  activeMonths: number
  firstMessageAt?: string
  lastMessageAt?: string
  daysSinceLastContact: number
  sentCount: number
  receivedCount: number
  initiatedByMe: number
  initiatedByThem: number
  medianReplyToThemMinutes?: number
  medianReplyToMeMinutes?: number
  lateNightCount: number
  recent30Days: number
  recent90Days: number
  recent365Days: number
  longestSilenceDays: number
  longestActiveStreak: number
  relationshipScore: number
  trend: RelationshipTrend
  currentMessages: number
  previousMessages: number
  messageDelta: number
  growthPercent?: number
  currentRank: number
  previousRank?: number
  rankChange?: number
  currentActiveDays: number
  previousActiveDays: number
  currentSentCount: number
  currentReceivedCount: number
  currentSentCharacters: number
  currentReceivedCharacters: number
  currentSentStickers: number
  currentReceivedStickers: number
  currentInitiatedByMe: number
  currentInitiatedByThem: number
  sentShare: number
  growthScore: number
  historicalAverage30?: number
  yearAgoMessages: number
  yearAgoAvailable: boolean
  historicalSufficient: boolean
  typicalGapDays?: number
}

export interface RelationshipOverview {
  items: RelationshipInsight[]
  mostActive: RelationshipInsight[]
  leastActive: RelationshipInsight[]
  longestSilent: RelationshipInsight[]
  cooling: RelationshipInsight[]
  myWords: WordFrequency[]
  observations: RelationshipObservation[]
  personal: PersonalAnalysis
  network: RelationshipNetwork
  currentWindow: AnalysisWindow
  previousWindow: AnalysisWindow
  historicalWindow: AnalysisWindow
  yearAgoWindow: AnalysisWindow
  generatedAt: string
}

export interface RelationshipDetail {
  insight: RelationshipInsight
  currentWindow: AnalysisWindow
  previousWindow: AnalysisWindow
  historicalWindow: AnalysisWindow
  yearAgoWindow: AnalysisWindow
  current: ParticipationComparison
  previous: ParticipationComparison
  topics: TopicClue[]
  hourly: DirectionSeriesPoint[]
  weekdays: DirectionSeriesPoint[]
  daily: RelationshipDayPoint[]
  records: RelationshipRecord
}

export interface ArchiveAnalytics {
  empty: boolean
  filter: AnalyticsFilter
  messageCount: number
  sentCount: number
  receivedCount: number
  activeDays: number
  averagePerActiveDay: number
  firstMessageAt?: string
  lastMessageAt?: string
  longestActiveStreak: number
  hourly: TimeSeriesPoint[]
  weekdays: TimeSeriesPoint[]
  monthly: TimeSeriesPoint[]
  yearly: TimeSeriesPoint[]
  messageKinds: TimeSeriesPoint[]
  busiestDays: RankedItem[]
  topConversations: RankedItem[]
  coverage: ArchiveCoverage
}

export interface MemoryHighlight {
  id: string
  kind: 'first-message' | 'busiest-day' | 'streak' | 'anniversary' | 'on-this-day'
  title: string
  description: string
  date?: string
  conversationId?: string
  messageId?: string
}

export interface ReportRequest {
  kind: 'annual' | 'conversation'
  year?: number
  conversationId?: string
}

export interface ReportPreview {
  title: string
  subtitle: string
  html: string
  analytics: ArchiveAnalytics
  highlights: MemoryHighlight[]
  generatedAt: string
}

export interface ReportExportResult {
  success: boolean
  cancelled?: boolean
  fileName?: string
  message: string
}

export interface PreservationRequest {
  conversationIds?: string[]
}

export interface PreservationResult {
  success: boolean
  cancelled?: boolean
  directoryName?: string
  message: string
  conversations?: number
  messages?: number
  assets?: number
  missingAssets?: number
}

export interface WeCatApi {
  app: {
    getVersion(): Promise<string>
    chooseSource(): Promise<string | undefined>
  }
  source: {
    inspect(path: string): Promise<SourceInspection>
    dependencies(path?: string): Promise<DependencyStatus>
    initialize(path: string): Promise<CommandResult>
    initializeAudioAssets(): Promise<CommandResult>
  }
  archive: {
    summary(): Promise<ArchiveSummary>
    conversations(query?: ConversationQuery): Promise<PagedResult<Conversation>>
    messages(query?: MessageQuery): Promise<PagedResult<Message>>
    media(query?: MediaQuery): Promise<PagedResult<MediaRecord>>
    people(): Promise<Person[]>
    openMedia(mediaId: string): Promise<CommandResult>
  }
  analytics: {
    get(filter?: AnalyticsFilter): Promise<ArchiveAnalytics>
    highlights(filter?: AnalyticsFilter): Promise<MemoryHighlight[]>
    relationships(): Promise<RelationshipOverview>
    relationshipDetail(conversationId: string): Promise<RelationshipDetail | undefined>
  }
  reports: {
    preview(request: ReportRequest): Promise<ReportPreview>
    export(request: ReportRequest): Promise<ReportExportResult>
  }
  preservation: {
    export(request: PreservationRequest): Promise<PreservationResult>
  }
  importer: {
    start(request: ImportRequest): Promise<ImportResult>
    cancel(): Promise<CommandResult>
    onProgress(callback: (progress: ImportProgress) => void): () => void
  }
}

export const emptyCoverage = (): ArchiveCoverage => ({
  conversationCount: 0,
  messageCount: 0,
  mediaCount: 0,
  availableMediaCount: 0,
  missingMediaCount: 0,
  unresolvedMediaCount: 0
})
