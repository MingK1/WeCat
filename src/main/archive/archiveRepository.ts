import type {
  ArchiveSummary,
  Conversation,
  ConversationQuery,
  ImportRun,
  MediaQuery,
  MediaRecord,
  Message,
  MessageQuery,
  Moment,
  PagedResult,
  Person
} from '../../shared/contracts'

export interface ConversationDocument {
  conversation: Conversation
  messages: Message[]
}

export interface ArchiveIndex {
  schemaVersion: 1 | 2
  sourceFingerprint: string
  accountLabel: string
  accountAvatarDataUrl?: string
  firstMessageAt?: string
  lastMessageAt?: string
  years: number[]
  conversations: Array<Conversation & { file: string }>
  people?: Person[]
  moments?: Moment[]
  lastImport: ImportRun
}

export interface ArchiveAssetCopy {
  source: string
  destination: string
}

export interface ArchiveWriteRequest {
  index: ArchiveIndex
  documents: ConversationDocument[]
  assets: ArchiveAssetCopy[]
}

export interface ArchiveRepository {
  summary(): Promise<ArchiveSummary>
  listConversations(query?: ConversationQuery): Promise<PagedResult<Conversation>>
  listMessages(query?: MessageQuery): Promise<PagedResult<Message>>
  listMedia(query?: MediaQuery): Promise<PagedResult<MediaRecord>>
  listPeople(): Promise<Person[]>
  resolveMediaFile(mediaId: string): Promise<string | undefined>
  readAll(): Promise<{ index?: ArchiveIndex; documents: ConversationDocument[] }>
  replace(request: ArchiveWriteRequest): Promise<void>
}
