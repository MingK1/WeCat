import { readdir, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, normalize, resolve } from 'node:path'
import type { DatabaseInventory, SourceInspection } from '../../shared/contracts'

export interface ResolvedSourceInspection extends SourceInspection {
  resolvedRoot?: string
  accountPath?: string
  dbStoragePath?: string
}

const emptyInventory = (): DatabaseInventory => ({
  session: 0,
  contact: 0,
  message: 0,
  media: 0,
  hardlink: 0,
  other: 0
})

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function findAccountDirectories(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const candidates: Array<{ path: string; modified: number }> = []

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'all_users' || entry.name === 'Backup') continue
    const accountPath = join(root, entry.name)
    const databasePath = join(accountPath, 'db_storage')
    if (!(await isDirectory(databasePath))) continue
    const metadata = await stat(databasePath)
    candidates.push({ path: accountPath, modified: metadata.mtimeMs })
  }

  return candidates.sort((a, b) => b.modified - a.modified).map((candidate) => candidate.path)
}

async function resolveSource(inputPath: string): Promise<{
  accountPath?: string
  rootPath?: string
  warnings: string[]
}> {
  const warnings: string[] = []
  const absolute = normalize(isAbsolute(inputPath) ? inputPath : resolve(inputPath))
  if (!(await isDirectory(absolute))) return { warnings: ['所选路径不存在或不是文件夹。'] }

  if (basename(absolute).toLowerCase() === 'db_storage') {
    const accountPath = dirname(absolute)
    return { accountPath, rootPath: dirname(accountPath), warnings }
  }

  if (await isDirectory(join(absolute, 'db_storage'))) {
    return { accountPath: absolute, rootPath: dirname(absolute), warnings }
  }

  const accounts = await findAccountDirectories(absolute)
  if (accounts.length === 0) return { warnings: ['没有找到包含 db_storage 的微信账号目录。'] }
  if (accounts.length > 1) warnings.push(`检测到 ${accounts.length} 个账号，当前选择最近更新的账号。`)
  return { accountPath: accounts[0], rootPath: absolute, warnings }
}

function classifyDatabase(fileName: string): keyof DatabaseInventory {
  const name = fileName.toLowerCase()
  if (name === 'session.db') return 'session'
  if (name.startsWith('contact') && name.endsWith('.db')) return 'contact'
  if (/^(?:message|biz_message)_\d+\.db$/.test(name)) return 'message'
  if (name.startsWith('media_') && name.endsWith('.db')) return 'media'
  if (name === 'hardlink.db') return 'hardlink'
  return 'other'
}

async function inventoryDatabases(dbStoragePath: string): Promise<DatabaseInventory> {
  const inventory = emptyInventory()
  const sections = await readdir(dbStoragePath, { withFileTypes: true }).catch(() => [])

  for (const section of sections) {
    if (!section.isDirectory()) continue
    const files = await readdir(join(dbStoragePath, section.name), { withFileTypes: true }).catch(() => [])
    for (const file of files) {
      if (!file.isFile() || !file.name.toLowerCase().endsWith('.db')) continue
      inventory[classifyDatabase(file.name)] += 1
    }
  }

  return inventory
}

function maskedAccountLabel(accountPath: string): string {
  const raw = basename(accountPath).replace(/_\w{4}$/, '')
  const tail = raw.slice(-4)
  return tail ? `微信账号 · ${tail}` : '微信账号'
}

export async function inspectSource(inputPath: string): Promise<ResolvedSourceInspection> {
  const input = inputPath.trim()
  if (!input) {
    return {
      inputPath: '',
      valid: false,
      databaseInventory: emptyInventory(),
      mediaDirectories: [],
      warnings: ['请选择微信数据目录。']
    }
  }

  const resolvedSource = await resolveSource(input)
  if (!resolvedSource.accountPath) {
    return {
      inputPath: input,
      valid: false,
      databaseInventory: emptyInventory(),
      mediaDirectories: [],
      warnings: resolvedSource.warnings
    }
  }

  const dbStoragePath = join(resolvedSource.accountPath, 'db_storage')
  const databaseInventory = await inventoryDatabases(dbStoragePath)
  const mediaDirectories: SourceInspection['mediaDirectories'] = []
  for (const name of ['attach', 'file', 'video'] as const) {
    if (await isDirectory(join(resolvedSource.accountPath, 'msg', name))) mediaDirectories.push(name)
  }

  const warnings = [...resolvedSource.warnings]
  if (databaseInventory.hardlink === 0) warnings.push('缺少 hardlink.db，文件和媒体的本地路径匹配会受限。')
  if (databaseInventory.media === 0) warnings.push('没有检测到语音媒体数据库。')
  const valid = databaseInventory.session > 0 && databaseInventory.contact > 0 && databaseInventory.message > 0
  if (!valid) warnings.push('会话、联系人或消息数据库不完整。')

  return {
    inputPath: input,
    resolvedRoot: resolvedSource.rootPath,
    accountPath: resolvedSource.accountPath,
    dbStoragePath,
    accountLabel: maskedAccountLabel(resolvedSource.accountPath),
    valid,
    databaseInventory,
    mediaDirectories,
    warnings
  }
}

export function publicSourceInspection(source: ResolvedSourceInspection): SourceInspection {
  return {
    inputPath: source.inputPath,
    accountLabel: source.accountLabel,
    valid: source.valid,
    databaseInventory: source.databaseInventory,
    mediaDirectories: source.mediaDirectories,
    warnings: source.warnings
  }
}
