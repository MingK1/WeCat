import { spawn } from 'node:child_process'

const MAX_OUTPUT_BYTES = 32 * 1024 * 1024

export interface ProcessRunOptions {
  cwd?: string
  timeoutMs?: number
  signal?: AbortSignal
  env?: NodeJS.ProcessEnv
}

export interface ProcessRunResult {
  code: number
  stdout: string
  stderr: string
  aborted: boolean
}

export async function runProcess(
  executable: string,
  args: string[],
  options: ProcessRunOptions = {}
): Promise<ProcessRunResult> {
  if (options.signal?.aborted) {
    return { code: 1, stdout: '', stderr: '', aborted: true }
  }
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let outputBytes = 0
    let aborted = false

    const append = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
      outputBytes += chunk.length
      if (outputBytes > MAX_OUTPUT_BYTES) {
        child.kill()
        rejectRun(new Error('子进程输出超过安全上限。'))
        return
      }
      if (target === 'stdout') stdout += chunk.toString('utf8')
      else stderr += chunk.toString('utf8')
    }

    child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk))
    child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk))
    child.on('error', rejectRun)

    const timeout = setTimeout(() => {
      aborted = true
      child.kill()
    }, options.timeoutMs ?? 120_000)
    const abort = (): void => {
      aborted = true
      child.kill()
    }
    options.signal?.addEventListener('abort', abort, { once: true })

    child.on('close', (code) => {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abort)
      resolveRun({ code: code ?? 1, stdout, stderr, aborted })
    })
  })
}

export function parseJsonOutput<T>(output: string): T {
  const clean = output.trim()
  if (!clean) throw new Error('命令没有返回结构化结果。')

  try {
    return JSON.parse(clean) as T
  } catch {
    const candidates = [clean.indexOf('{'), clean.indexOf('[')]
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)
    for (const start of candidates) {
      const end = clean[start] === '{' ? clean.lastIndexOf('}') : clean.lastIndexOf(']')
      if (end <= start) continue
      try {
        return JSON.parse(clean.slice(start, end + 1)) as T
      } catch {
        continue
      }
    }
    throw new Error('命令返回了无法识别的结构化结果。')
  }
}

export function sanitizedProcessMessage(message: string): string {
  return message
    .replace(/[a-fA-F0-9]{64}/g, '<redacted-key>')
    .replace(/[A-Za-z]:\\[^\r\n"']+/g, '<local-path>')
    .replace(/wxid_[A-Za-z0-9_-]+/g, '<account>')
    .trim()
    .slice(0, 500)
}
