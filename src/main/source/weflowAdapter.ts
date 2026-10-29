import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, sep } from 'node:path'
import type {
  CommandResult,
  DependencyItem,
  DependencyStatus,
  SourceInspection
} from '../../shared/contracts'
import { inspectSource } from './sourceDiscovery'
import { parseJsonOutput, runProcess, sanitizedProcessMessage } from './processRunner'

interface WeflowCheck {
  success?: boolean
  runtime?: {
    node?: { available?: boolean; version?: string }
    python?: { available?: boolean; version?: string }
  }
  dependencies?: { required?: Record<string, boolean> }
  configuration?: { initialized?: boolean; messageDatabase?: boolean }
}

export interface WeflowSession {
  username: string
  displayName?: string
  summary?: string
  lastTimestamp?: number
  [key: string]: unknown
}

export interface WeflowContact {
  username: string
  displayName?: string
  nickname?: string
  remark?: string
  alias?: string
  kind?: 'direct' | 'group' | 'official' | 'unknown'
  localType?: number
  [key: string]: unknown
}

interface SessionResult { success: boolean; sessions?: WeflowSession[]; error?: string }
interface ContactResult { success: boolean; contacts?: WeflowContact[]; error?: string }
interface ExportResult { success: boolean; path?: string; count?: number; media?: unknown; error?: string }
interface AvatarExportResult { success: boolean; written?: number; dir?: string; error?: string }
export interface WeflowMediaIndexRecord { md5?: string; kind?: string; file?: string; size?: number; path?: string; exists?: boolean }
interface MediaIndexResult { success?: boolean; rows?: WeflowMediaIndexRecord[] }
interface VoiceAssetResult { success?: boolean; items?: Array<{ localId: string; path: string; bytes: number }>; error?: string }
interface RichContactsResult { success?: boolean; contacts?: WeflowContact[]; error?: string }

function resolveCliPath(): string {
  const require = createRequire(import.meta.url)
  const packageRoot = dirname(require.resolve('weflow-cli/package.json'))
  const asarSegment = `${sep}app.asar${sep}`
  const unpackedRoot = packageRoot.includes(asarSegment)
    ? packageRoot.replace(asarSegment, `${sep}app.asar.unpacked${sep}`)
    : packageRoot
  const root = existsSync(join(unpackedRoot, 'cli.cjs')) ? unpackedRoot : packageRoot
  return join(root, 'cli.cjs')
}

function item(
  id: DependencyItem['id'],
  label: string,
  status: DependencyItem['status'],
  detail: string,
  version?: string
): DependencyItem {
  return { id, label, status, detail, version }
}

function escapeBatchValue(value: string): string {
  if (/[\r\n"]/.test(value)) throw new Error('路径包含终端脚本不支持的字符。')
  return value.replaceAll('%', '%%')
}

export class WeflowAdapter {
  readonly cliPath = resolveCliPath()
  private readonly nodeExecutable = process.env.WECAT_NODE_PATH || 'node'
  private readonly runtimeHome: string

  constructor(private readonly workingDirectory: string) {
    this.runtimeHome = join(workingDirectory, 'home')
    mkdirSync(this.runtimeHome, { recursive: true })
  }

  private runtimeEnvironment(): NodeJS.ProcessEnv {
    return {
      NODE_NO_WARNINGS: '1',
      USERPROFILE: this.runtimeHome,
      HOME: this.runtimeHome
    }
  }

  private pythonExecutable(): string {
    return join(this.runtimeHome, '.weflow-cli', 'venv', 'Scripts', 'python.exe')
  }

  private voiceScriptPath(): string {
    const packaged = join(process.resourcesPath || '', 'wecat-scripts', 'export_voice_assets.py')
    return existsSync(packaged) ? packaged : join(process.cwd(), 'resources', 'export_voice_assets.py')
  }

  private resourceScriptPath(fileName: string): string {
    const packaged = join(process.resourcesPath || '', 'wecat-scripts', fileName)
    return existsSync(packaged) ? packaged : join(process.cwd(), 'resources', fileName)
  }

  private async execute<T>(args: string[], signal?: AbortSignal, timeoutMs?: number): Promise<T> {
    const result = await runProcess(this.nodeExecutable, [this.cliPath, ...args], {
      cwd: this.workingDirectory,
      signal,
      timeoutMs,
      env: this.runtimeEnvironment()
    })
    let payload: T
    try {
      payload = parseJsonOutput<T>(result.stdout)
    } catch (error) {
      const detail = sanitizedProcessMessage(result.stderr) || (error instanceof Error ? error.message : '命令执行失败。')
      throw new Error(detail)
    }
    if (result.aborted) throw new Error('操作已取消或超时。')
    return payload
  }

  async version(): Promise<string> {
    const result = await runProcess(this.nodeExecutable, [this.cliPath, '--version'], {
      cwd: this.workingDirectory,
      env: this.runtimeEnvironment()
    })
    return result.stdout.trim() || 'unknown'
  }

  async check(): Promise<WeflowCheck> {
    return this.execute<WeflowCheck>(['check', '--json'], undefined, 30_000)
  }

  async dependencyStatus(sourcePath?: string): Promise<DependencyStatus> {
    let check: WeflowCheck | undefined
    let checkError = ''
    try {
      check = await this.check()
      if (check.success !== true) checkError = 'WeFlow 环境检查没有成功完成。'
    } catch (error) {
      checkError = error instanceof Error ? error.message : '无法执行 WeFlow 检查。'
    }

    const version = await this.version().catch(() => 'unknown')
    const source = sourcePath ? await inspectSource(sourcePath) : undefined
    const required = check?.dependencies?.required ?? {}
    const missingDependencies = Object.entries(required).filter(([, ready]) => !ready).map(([name]) => name)
    const nodeReady = check?.runtime?.node?.available === true
    const pythonReady = check?.runtime?.python?.available === true
    const initialized = check?.configuration?.initialized === true && check?.configuration?.messageDatabase === true
    const audioReady = existsSync(this.pythonExecutable()) && (await runProcess(this.pythonExecutable(), ['-c', 'import pilk'], { timeoutMs: 10_000 }).then((result) => result.code === 0).catch(() => false))
    const items: DependencyItem[] = [
      item('node', 'Node.js 运行时', nodeReady ? 'ready' : 'missing', nodeReady ? '系统 Node.js 可用。' : '未找到系统 Node.js 22.13 或更高版本。', check?.runtime?.node?.version),
      item(
        'python',
        'Python 与解析依赖',
        !pythonReady ? 'missing' : missingDependencies.length ? 'attention' : 'ready',
        !pythonReady ? '未找到 Python。' : missingDependencies.length ? `需要安装：${missingDependencies.join('、')}` : '微信数据库解析依赖已就绪。',
        check?.runtime?.python?.version
      ),
      item('weflow', 'WeFlow CLI', checkError ? 'missing' : 'ready', checkError || '本地解析适配器可用。', version),
      item('weflow-config', '微信数据库访问', initialized ? 'ready' : 'attention', initialized ? '已完成初始化。' : '需要在终端中完成微信登录与数据库取钥。'),
      item('audio-assets', '语音明文资产', audioReady ? 'ready' : 'attention', audioReady ? 'SILK 解码器已就绪，可保存为标准 WAV。' : '可选：准备轻量 SILK 解码器后保存语音资产。'),
      item('source', '微信数据目录', !sourcePath ? 'unknown' : source?.valid ? 'ready' : 'missing', !sourcePath ? '尚未选择数据目录。' : source?.valid ? '数据库结构完整。' : source?.warnings.join(' ') || '目录不可用。')
    ]
    return { ready: items.every((entry) => entry.id === 'audio-assets' || entry.status === 'ready'), items }
  }

  async launchInitialization(sourcePath: string): Promise<CommandResult> {
    const inspection = await inspectSource(sourcePath)
    if (!inspection.valid || !inspection.resolvedRoot) return { success: false, message: inspection.warnings.join(' ') }
    const status = await this.dependencyStatus(sourcePath)
    const needsSetup = status.items.find((entry) => entry.id === 'python')?.status !== 'ready'
    const scriptsDirectory = join(this.workingDirectory, 'setup')
    await mkdir(scriptsDirectory, { recursive: true })
    const scriptPath = join(scriptsDirectory, 'initialize-weflow.cmd')
    const cli = escapeBatchValue(this.cliPath)
    const root = escapeBatchValue(inspection.resolvedRoot)
    const runtimeHome = escapeBatchValue(this.runtimeHome)
    const lines = [
      '@echo off',
      'chcp 65001 >nul',
      'title WeCat - 初始化微信本地记录',
      'set NODE_NO_WARNINGS=1',
      `set "USERPROFILE=${runtimeHome}"`,
      `set "HOME=${runtimeHome}"`,
      'echo WeCat 正在准备 WeFlow 本地解析环境。',
      ...(needsSetup ? [`node "${cli}" setup`, 'if errorlevel 1 goto failed'] : []),
      ':wait_wechat_closed',
      'tasklist /FI "IMAGENAME eq Weixin.exe" /FO CSV /NH 2>nul | find /I "Weixin.exe" >nul',
      'if errorlevel 1 goto run_init',
      'echo.',
      'echo 微信当前正在运行。Hook 只能在登录瞬间取得数据库密钥。',
      'echo 请先从微信托盘菜单完全退出微信，然后回到这里按任意键继续。',
      'pause >nul',
      'goto wait_wechat_closed',
      ':run_init',
      'echo.',
      'echo 微信已经退出。接下来请等待终端提示，再启动微信并完成登录。',
      `node "${cli}" init --path "${root}"`,
      'if errorlevel 1 goto failed',
      `node "${cli}" sessions --limit 1 --json >nul 2>&1`,
      'if errorlevel 1 goto incomplete',
      'echo.',
      'echo 数据库访问验证通过。请回到 WeCat 点击检查。',
      'pause',
      'exit /b 0',
      ':incomplete',
      'echo.',
      'echo 初始化流程已结束，但数据库访问仍未就绪。',
      'echo 请关闭微信后重试，并且只在终端提示后再启动和登录微信。',
      'choice /C YN /N /M "现在重新尝试吗？[Y/N] "',
      'if errorlevel 2 exit /b 1',
      'goto wait_wechat_closed',
      ':failed',
      'echo.',
      'echo 初始化未完成，请保留本窗口中的错误信息。',
      'pause',
      'exit /b 1'
    ]
    await writeFile(scriptPath, `${lines.join('\r\n')}\r\n`, 'utf8')

    const terminal = spawn('cmd.exe', ['/d', '/c', 'start', '', scriptPath], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore'
    })
    terminal.unref()
    return { success: true, message: '初始化终端已打开。请先完全退出微信，并且只在终端提示后再启动和登录微信。' }
  }

  async launchAudioAssetsInitialization(): Promise<CommandResult> {
    if (!existsSync(this.pythonExecutable())) return { success: false, message: '请先完成 WeFlow Python 环境初始化。' }
    const scriptsDirectory = join(this.workingDirectory, 'setup')
    await mkdir(scriptsDirectory, { recursive: true })
    const scriptPath = join(scriptsDirectory, 'initialize-audio-assets.cmd')
    const python = escapeBatchValue(this.pythonExecutable())
    const lines = ['@echo off', 'chcp 65001 >nul', 'title WeCat - 准备语音明文资产', 'echo 正在安装微信 SILK 语音解码器 pilk...', `"${python}" -m pip install --disable-pip-version-check pilk`, 'if errorlevel 1 goto failed', 'echo.', 'echo 语音解码器准备完成。回到 WeCat 后状态会自动刷新。', 'pause', 'exit /b 0', ':failed', 'echo.', 'echo 安装失败，请保留本窗口输出。', 'pause', 'exit /b 1']
    await writeFile(scriptPath, `${lines.join('\r\n')}\r\n`, 'utf8')
    const terminal = spawn('cmd.exe', ['/d', '/c', 'start', '', scriptPath], { detached: true, windowsHide: true, stdio: 'ignore' })
    terminal.unref()
    return { success: true, message: '语音资产准备终端已打开，完成后会自动刷新状态。' }
  }

  async listSessions(signal?: AbortSignal): Promise<WeflowSession[]> {
    const result = await this.execute<SessionResult>(['sessions', '--limit', '1000', '--json'], signal)
    if (!result.success) throw new Error(sanitizedProcessMessage(result.error || '无法读取会话。'))
    return Array.isArray(result.sessions) ? result.sessions : []
  }

  async listContacts(signal?: AbortSignal): Promise<WeflowContact[]> {
    if (existsSync(this.pythonExecutable())) {
      const rich = await runProcess(this.pythonExecutable(), [this.resourceScriptPath('export_contacts.py')], {
        cwd: this.workingDirectory,
        signal,
        timeoutMs: 120_000,
        env: { ...this.runtimeEnvironment(), WECAT_WEFLOW_ROOT: dirname(this.cliPath), PYTHONIOENCODING: 'utf-8' }
      }).then((result) => result.code === 0 ? parseJsonOutput<RichContactsResult>(result.stdout) : undefined).catch(() => undefined)
      if (rich?.success && Array.isArray(rich.contacts) && rich.contacts.length) return rich.contacts
    }
    const result = await this.execute<ContactResult>(['contacts', '--limit', '5000', '--json'], signal)
    if (!result.success) throw new Error(sanitizedProcessMessage(result.error || '无法读取联系人。'))
    return Array.isArray(result.contacts) ? result.contacts : []
  }

  async exportConversation(
    talker: string,
    outputDirectory: string,
    includeMedia: boolean,
    signal?: AbortSignal
  ): Promise<ExportResult> {
    const args = ['export', talker, 'json', '--output', outputDirectory, '--limit', '0', '--contract', 'weflow-v1', '--json', '--non-interactive']
    if (includeMedia) args.push('--media')
    const result = await this.execute<ExportResult>(args, signal, 30 * 60_000)
    if (!result.success || !result.path) throw new Error(sanitizedProcessMessage(result.error || '会话导出失败。'))
    return result
  }

  async exportAvatars(outputDirectory: string, signal?: AbortSignal): Promise<Map<string, string>> {
    const result = await this.execute<AvatarExportResult>(['avatar', '--all', '--out', outputDirectory, '--json'], signal, 120_000)
    if (!result.success) return new Map()
    const files = await readdir(outputDirectory, { withFileTypes: true }).catch(() => [])
    const avatars = new Map<string, string>()
    for (const file of files) {
      if (!file.isFile() || !/\.(?:jpg|jpeg|png)$/i.test(file.name)) continue
      const bytes = await readFile(join(outputDirectory, file.name))
      const extension = file.name.toLowerCase().endsWith('.png') ? 'png' : 'jpeg'
      const username = file.name.replace(/\.(?:jpg|jpeg|png)$/i, '')
      avatars.set(username, `data:image/${extension};base64,${bytes.toString('base64')}`)
    }
    return avatars
  }

  async listMediaIndex(signal?: AbortSignal): Promise<WeflowMediaIndexRecord[]> {
    if (!existsSync(this.pythonExecutable())) return []
    const script = join(dirname(this.cliPath), 'scripts', 'media_index.py')
    const result = await runProcess(this.pythonExecutable(), [script, '--json', '--limit', '1000000'], { cwd: this.workingDirectory, signal, timeoutMs: 120_000, env: this.runtimeEnvironment() })
    if (result.code !== 0) return []
    return parseJsonOutput<MediaIndexResult>(result.stdout).rows ?? []
  }

  async exportVoiceAssets(talker: string, outputDirectory: string, signal?: AbortSignal): Promise<Map<string, { path: string; bytes: number }>> {
    if (!existsSync(this.pythonExecutable())) return new Map()
    const result = await runProcess(this.pythonExecutable(), [this.voiceScriptPath()], {
      cwd: this.workingDirectory,
      signal,
      timeoutMs: 120_000,
      env: { ...this.runtimeEnvironment(), WECAT_WEFLOW_ROOT: dirname(this.cliPath), WEFLOW_TALKER: talker, WECAT_VOICE_OUTPUT: outputDirectory, PYTHONIOENCODING: 'utf-8' }
    })
    if (result.code !== 0) return new Map()
    const payload = parseJsonOutput<VoiceAssetResult>(result.stdout)
    return new Map((payload.items ?? []).map((item) => [String(item.localId), { path: item.path, bytes: item.bytes }]))
  }
}
