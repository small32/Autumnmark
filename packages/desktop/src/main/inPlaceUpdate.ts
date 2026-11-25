import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app, net } from 'electron'
import { APP_NAME, GITHUB_REPO_SLUG } from '@shared/brand'

// In-place updates: download the release archive, verify it, unpack it into a
// temporary directory, then hand the swap to the script bundled in that same
// archive. The app only orchestrates; the script owns replace-and-restart so
// the running executable is never written while it is locked.

const PROGRESS_INTERVAL_MS = 200
const ASSET_ROOT = `https://github.com/${GITHUB_REPO_SLUG}/releases/download`
const CHECKSUM_ASSET = 'SHA256SUMS.txt'

export interface DownloadProgress {
  transferred: number
  total: number
  bytesPerSecond: number
}

export type ApplyMode = 'dir' | 'app' | 'file'

export interface InstallTarget {
  target: string
  launch: string
  mode: ApplyMode
}

export interface ReleaseAsset {
  name: string
  url: string
}

export const releaseAssetName = (version: string): string | null => {
  if (process.platform === 'win32')
    return process.arch === 'x64' ? `autumnmark-win-x64-${version}.zip` : null
  if (process.platform === 'darwin')
    return process.arch === 'arm64' ? `autumnmark-mac-arm64-${version}.zip` : null
  if (process.platform === 'linux')
    return process.arch === 'x64' ? `autumnmark-linux-${version}.AppImage` : null
  return null
}

export const resolveReleaseAssets = (version: string): ReleaseAsset[] => {
  const name = releaseAssetName(version)
  if (!name) return []
  return [
    { name, url: `${ASSET_ROOT}/v${version}/${encodeURIComponent(name)}` },
    { name: CHECKSUM_ASSET, url: `${ASSET_ROOT}/v${version}/${CHECKSUM_ASSET}` }
  ]
}

export const parseChecksums = (text: string): Map<string, string> => {
  const sums = new Map<string, string>()
  for (const line of text.split('\n')) {
    const match = /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line.trim())
    if (match) sums.set(match[2].trim(), match[1].toLowerCase())
  }
  return sums
}

const hashFile = (file: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const input = createReadStream(file)
    input.on('error', reject)
    input.on('data', chunk => hash.update(chunk))
    input.on('end', () => resolve(hash.digest('hex')))
  })

export const verifyChecksum = async(file: string, expected: string): Promise<void> => {
  const actual = await hashFile(file)
  if (actual !== expected.toLowerCase())
    throw new Error('Downloaded archive does not match its checksum')
}

export const downloadFile = async(
  url: string,
  destination: string,
  onProgress: (progress: DownloadProgress) => void,
  signal: AbortSignal
): Promise<void> => {
  // Downloads must follow the same proxy configuration as the check.
  const response = await net.fetch(url, {
    signal,
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': `${APP_NAME}/${app.getVersion()}`
    }
  })
  if (!response.ok || !response.body)
    throw new Error(`Download failed with status ${response.status}`)

  const total = Number(response.headers.get('content-length') ?? 0)
  const startedAt = Date.now()
  let transferred = 0
  let lastEmit = 0
  const source = Readable.fromWeb(response.body as never)
  source.on('data', (chunk: Buffer) => {
    transferred += chunk.length
    const now = Date.now()
    if (now - lastEmit < PROGRESS_INTERVAL_MS) return
    lastEmit = now
    const seconds = Math.max((now - startedAt) / 1000, 0.001)
    onProgress({ transferred, total, bytesPerSecond: Math.round(transferred / seconds) })
  })
  await pipeline(source, createWriteStream(destination))
  onProgress({ transferred, total: total || transferred, bytesPerSecond: 0 })
}

const run = (command: string, args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: 'ignore' })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)))
  })

const quoteForPowerShell = (value: string): string => value.replace(/'/g, "''")

export const extractArchive = async(archive: string, destination: string): Promise<void> => {
  await fs.mkdir(destination, { recursive: true })
  if (process.platform === 'darwin') {
    await run('ditto', ['-x', '-k', archive, destination])
    return
  }
  if (process.platform === 'win32') {
    const script = `Expand-Archive -LiteralPath '${quoteForPowerShell(archive)}' -DestinationPath '${quoteForPowerShell(destination)}' -Force`
    await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script])
    return
  }
  throw new Error('No archive to extract on this platform')
}

export const resolveInstallTarget = (): InstallTarget => {
  if (process.platform === 'win32') {
    const launch = app.getPath('exe')
    return { target: path.dirname(launch), launch, mode: 'dir' }
  }
  if (process.platform === 'darwin') {
    // …/AutumnMark+.app/Contents/Resources/app.asar → …/AutumnMark+.app
    const bundle = path.resolve(app.getAppPath(), '../../..')
    return { target: bundle, launch: bundle, mode: 'app' }
  }
  const image = process.env.APPIMAGE
  if (!image) throw new Error('This Linux build does not run from an AppImage')
  return { target: image, launch: image, mode: 'file' }
}

export const stagedBundlePath = async(staging: string): Promise<string> => {
  const entries = await fs.readdir(staging, { withFileTypes: true })
  const bundle = entries.find(entry => entry.isDirectory() && entry.name.endsWith('.app'))
  if (!bundle) throw new Error('The update archive has no application bundle')
  return path.join(staging, bundle.name)
}

// The swap script travels with the archive, so the version being installed
// decides how it replaces the previous one. AppImages cannot expose files
// before the swap, so they fall back to the script of the running version.
export const resolveApplyScript = async(staging: string, bundle: string | null): Promise<string> => {
  const name = process.platform === 'win32' ? 'apply-update.ps1' : 'apply-update.sh'
  const staged = bundle
    ? path.join(bundle, 'Contents', 'Resources', 'update', name)
    : path.join(staging, 'resources', 'update', name)
  try {
    await fs.access(staged)
    return staged
  } catch {
    const installed = path.join(process.resourcesPath, 'update', name)
    await fs.access(installed)
    return installed
  }
}

const needsElevation = async(directory: string): Promise<boolean> => {
  try {
    await fs.access(directory, fs.constants.W_OK)
    return false
  } catch {
    return true
  }
}

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

export interface ApplyRequest {
  script: string
  source: string
  target: string
  launch: string
  mode: ApplyMode
  cleanup: string
  logPath: string
}

export const launchApplyScript = async(request: ApplyRequest): Promise<{ elevated: boolean }> => {
  const elevated = await needsElevation(path.dirname(request.target))

  if (process.platform === 'win32') {
    const inner = [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', `"${request.script}"`,
      '-ParentPid', String(process.pid),
      '-Source', `"${request.source}"`,
      '-Target', `"${request.target}"`,
      '-Launch', `"${request.launch}"`,
      '-LogPath', `"${request.logPath}"`,
      '-Cleanup', `"${request.cleanup}"`
    ].join(' ')
    const child = elevated
      ? spawn('powershell', ['-NoProfile', '-Command',
        `Start-Process -FilePath 'powershell.exe' -ArgumentList '${quoteForPowerShell(inner)}' -Verb RunAs`],
      { detached: true, stdio: 'ignore', windowsHide: true })
      : spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', request.script,
        '-ParentPid', String(process.pid),
        '-Source', request.source,
        '-Target', request.target,
        '-Launch', request.launch,
        '-LogPath', request.logPath,
        '-Cleanup', request.cleanup], { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
    return { elevated }
  }

  const args = [
    '--pid', String(process.pid),
    '--source', request.source,
    '--target', request.target,
    '--launch', request.launch,
    '--mode', request.mode,
    '--log', request.logPath,
    '--cleanup', request.cleanup
  ]
  if (elevated) {
    const command = `/bin/bash ${[request.script, ...args].map(shellQuote).join(' ')}`
    const child = spawn('osascript', ['-e', `do shell script ${JSON.stringify(command)} with administrator privileges`],
      { detached: true, stdio: 'ignore' })
    child.unref()
    return { elevated }
  }
  const child = spawn('/bin/bash', [request.script, ...args], { detached: true, stdio: 'ignore' })
  child.unref()
  return { elevated }
}
