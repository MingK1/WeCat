import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, relative } from 'node:path'
import type { MediaKind, PreservationRequest, PreservationResult } from '../../shared/contracts'
import type { ArchiveRepository, ConversationDocument } from '../archive/archiveRepository'
import { runProcess } from '../source/processRunner'

interface ManifestAsset {
  path?: string
  sha256?: string
  bytes?: number
  state: 'preserved' | 'missing' | 'unresolved'
  kind: string
  name?: string
  conversationId: string
  messageId: string
  timestamp: string
}

function safeName(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-').replace(/[. ]+$/g, '').trim().slice(0, 72) || '未命名会话'
}

function escapeHtml(value: string | number | undefined): string {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

async function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    let digest: string | undefined
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => { digest = hash.digest('hex') })
    stream.on('close', () => {
      if (digest) resolve(digest)
    })
  })
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(() => true).catch(() => false)
}

async function availableRoot(parentDirectory: string, baseName: string): Promise<string> {
  for (let suffix = 1; suffix < 100; suffix += 1) {
    const candidate = join(parentDirectory, suffix === 1 ? baseName : `${baseName}-${suffix}`)
    if (!(await pathExists(candidate)) && !(await pathExists(`${candidate}.partial`))) return candidate
  }
  throw new Error('导出目录中已有过多同名 Library，请稍后再试。')
}

async function promoteDirectory(source: string, target: string): Promise<void> {
  const delays = [0, 100, 250, 500, 1_000]
  for (let index = 0; index < delays.length; index += 1) {
    if (delays[index]) await new Promise((resolve) => setTimeout(resolve, delays[index]))
    try {
      await rename(source, target)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if ((code !== 'EPERM' && code !== 'EBUSY') || index === delays.length - 1) throw error
    }
  }
}

function chatHtml(document: ConversationDocument, assetPaths: Map<string, string>): string {
  const messages = document.messages.map((message) => {
    const asset = message.media ? assetPaths.get(message.media.id) : undefined
    const body = asset
      ? `<a class="asset" href="${escapeHtml(asset)}">${escapeHtml(message.media?.originalName || message.kind)}</a>`
      : message.media
        ? `<span class="missing">${escapeHtml(message.media.originalName || message.kind)} · ${message.media.availability === 'missing' ? '本地已缺失' : '未能定位'}</span>`
        : `<span>${escapeHtml(message.content)}</span>`
    const own = message.direction === 'sent'
    return `<article class="msg ${own ? 'own' : 'other'}"><div class="meta">${escapeHtml(own ? '我' : message.senderName || document.conversation.displayName)} · ${escapeHtml(new Date(message.timestamp).toLocaleString('zh-CN'))}</div><div class="bubble">${body}</div></article>`
  }).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(document.conversation.displayName)}</title><style>
  :root{font-family:"Segoe UI","Microsoft YaHei UI",sans-serif;color:#1f2321;background:#f5f5f5}*{box-sizing:border-box}body{margin:0}main{max-width:920px;margin:auto;padding:28px}header{position:sticky;top:0;z-index:2;padding:18px 0;border-bottom:1px solid #ddd;background:rgba(245,245,245,.96)}h1{margin:0;font-size:20px}.sub{margin-top:5px;color:#8b8f8c;font-size:12px}.msg{display:flex;flex-direction:column;margin:18px 0}.msg.own{align-items:flex-end}.msg.other{align-items:flex-start}.meta{margin:0 8px 5px;color:#929793;font-size:11px}.bubble{max-width:min(72%,680px);padding:10px 13px;border-radius:5px;background:#fff;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere;box-shadow:0 1px 1px rgba(0,0,0,.04)}.own .bubble{background:#95ec69}.asset{color:#20563c;text-decoration:none}.missing{color:#9a5c45}</style></head><body><main><header><h1>${escapeHtml(document.conversation.displayName)}</h1><div class="sub">${document.messages.length.toLocaleString('zh-CN')} 条消息 · WeCat Library</div></header>${messages}</main></body></html>`
}

function indexHtml(rows: Array<{ name: string; file: string; messages: number }>, createdAt: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WeCat Library</title><style>:root{font-family:"Segoe UI","Microsoft YaHei UI",sans-serif;color:#1f2822;background:#f3f5f2}body{margin:0}main{max-width:980px;margin:auto;padding:48px 28px}h1{font-size:34px;margin:0 0 8px}.sub{color:#737b75;margin-bottom:34px}.list{border-top:1px solid #d6dbd6}.list a{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;padding:16px 8px;border-bottom:1px solid #d6dbd6;color:inherit;text-decoration:none}.list a:hover{background:#e9efe9}.list strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.list span{color:#788078;font-size:12px}</style></head><body><main><h1>WeCat Library</h1><div class="sub">生成于 ${escapeHtml(new Date(createdAt).toLocaleString('zh-CN'))} · 聊天记录与普通媒体文件，可脱离微信和 WeCat 使用</div><div class="list">${rows.map((row) => `<a href="${escapeHtml(row.file)}"><strong>${escapeHtml(row.name)}</strong><span>${row.messages.toLocaleString('zh-CN')} 条</span></a>`).join('')}</div></main></body></html>`
}

function kindDirectory(kind: MediaKind): string {
  return kind === 'image' ? 'image' : kind === 'video' ? 'video' : kind === 'voice' ? 'voice' : kind === 'sticker' ? 'sticker' : 'file'
}

export class PreservationService {
  constructor(private readonly repository: ArchiveRepository) {}

  async export(request: PreservationRequest, parentDirectory: string): Promise<PreservationResult & { outputPath?: string }> {
    const { index, documents } = await this.repository.readAll()
    if (!index || !documents.length) return { success: false, message: '当前没有可导出的 WeCat 档案。' }
    const selected = request.conversationIds?.length
      ? documents.filter((document) => request.conversationIds?.includes(document.conversation.id))
      : documents
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-')
    const root = await availableRoot(parentDirectory, `WeCat-Library-${stamp}`)
    const partialRoot = `${root}.partial`
    await rm(partialRoot, { recursive: true, force: true })
    try {
    const chatRoot = join(partialRoot, 'chat')
    const directories = ['chat', 'image', 'video', 'voice', 'sticker', 'file', 'avatar']
    await Promise.all(directories.map((directory) => mkdir(join(partialRoot, directory), { recursive: true })))
    const assets: ManifestAsset[] = []
    const rows: Array<{ name: string; file: string; messages: number }> = []

    for (const document of selected) {
      const folderName = `${safeName(document.conversation.displayName)}-${createHash('sha256').update(document.conversation.id).digest('hex').slice(0, 8)}`
      const conversationDirectory = join(chatRoot, folderName)
      await mkdir(conversationDirectory, { recursive: true })
      const assetPaths = new Map<string, string>()
      for (const message of document.messages) {
        if (!message.media) continue
        const source = await this.repository.resolveMediaFile(message.media.id)
        if (!source) {
          assets.push({ state: message.media.availability === 'missing' ? 'missing' : 'unresolved', kind: message.media.kind, name: message.media.originalName, conversationId: document.conversation.id, messageId: message.id, timestamp: message.timestamp })
          continue
        }
        let extension = extname(source) || (message.media.extension ? `.${message.media.extension}` : '')
        const directory = kindDirectory(message.media.kind)
        let relativeAsset = `${directory}/${message.media.id}${extension}`
        let target = join(partialRoot, ...relativeAsset.split('/'))
        let converted = false
        if (message.media.kind === 'voice' && extension.toLocaleLowerCase('en-US') === '.wav') {
          const mp3Relative = `voice/${message.media.id}.mp3`
          const mp3Target = join(partialRoot, ...mp3Relative.split('/'))
          const result = await runProcess('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', source, '-codec:a', 'libmp3lame', '-qscale:a', '4', mp3Target], { timeoutMs: 120_000 }).catch(() => undefined)
          if (result?.code === 0) {
            relativeAsset = mp3Relative
            target = mp3Target
            converted = true
          } else await rm(mp3Target, { force: true }).catch(() => undefined)
        }
        if (!converted) await copyFile(source, target)
        const sha256 = await hashFile(target)
        const bytes = (await stat(target)).size
        assetPaths.set(message.media.id, relative(conversationDirectory, target).replaceAll('\\', '/'))
        assets.push({ path: relativeAsset, sha256, bytes, state: 'preserved', kind: message.media.kind, name: message.media.originalName || basename(source), conversationId: document.conversation.id, messageId: message.id, timestamp: message.timestamp })
      }
      const chatPath = join(conversationDirectory, 'chat.html')
      await writeFile(chatPath, chatHtml(document, assetPaths), 'utf8')
      rows.push({ name: document.conversation.displayName, file: relative(partialRoot, chatPath).replaceAll('\\', '/'), messages: document.messages.length })
    }

    const createdAt = new Date().toISOString()
    const peopleWithAvatars = []
    for (const person of index.people ?? []) {
      const match = person.avatarDataUrl?.match(/^data:image\/(png|jpeg);base64,(.+)$/)
      if (!match) continue
      const extension = match[1] === 'png' ? 'png' : 'jpg'
      const relativeAvatar = `avatar/${createHash('sha256').update(person.id).digest('hex').slice(0, 16)}.${extension}`
      const target = join(partialRoot, ...relativeAvatar.split('/'))
      const bytes = Buffer.from(match[2], 'base64')
      await writeFile(target, bytes)
      peopleWithAvatars.push({ id: person.id, name: person.displayName, avatar: relativeAvatar, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
    }
    const manifest = {
      schema: 'wecat-library/v2',
      createdAt,
      accountLabel: index.accountLabel,
      coverage: index.lastImport.coverage,
      conversations: selected.map((document) => ({ id: document.conversation.id, name: document.conversation.displayName, messages: document.messages.length })),
      people: peopleWithAvatars,
      assets
    }
    await writeFile(join(partialRoot, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
    await writeFile(join(partialRoot, 'index.html'), indexHtml(rows, createdAt), 'utf8')
    await promoteDirectory(partialRoot, root)
    return {
      success: true,
      outputPath: root,
      directoryName: basename(root),
      message: `Library 已生成：${selected.length} 个会话，${assets.filter((asset) => asset.state === 'preserved').length} 个可用文件。`,
      conversations: selected.length,
      messages: selected.reduce((sum, document) => sum + document.messages.length, 0),
      assets: assets.filter((asset) => asset.state === 'preserved').length,
      missingAssets: assets.filter((asset) => asset.state !== 'preserved').length
    }
    } catch (error) {
      await rm(partialRoot, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }
}
