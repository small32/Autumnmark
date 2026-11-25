export const DOWNLOAD = {
  releases: 'https://github.com/small32/Autumnmark/releases',
  repo: 'https://github.com/small32/Autumnmark',
  contributing: 'https://github.com/small32/Autumnmark/blob/develop/.github/CONTRIBUTING.md',
  issues: 'https://github.com/small32/Autumnmark/issues',
  // Share intent only: no upstream account handle, campaign tag or hashtag.
  twitter: `https://twitter.com/intent/tweet?url=${encodeURIComponent('https://github.com/small32/Autumnmark')}&text=${encodeURIComponent('AutumnMark+ — a Markdown editor that gets out of your way')}`
}

export type Platform = 'mac' | 'windows' | 'linux'
export type Architecture = 'x64' | 'arm64'
export type DownloadFormat = 'dmg' | 'exe' | 'zip' | 'AppImage' | 'deb' | 'rpm' | 'tar.gz' | 'snap'
export type ReleaseDownload = {
  platform: Platform
  architecture: Architecture
  format: DownloadFormat
  url: string
}

export const DOWNLOAD_PLATFORMS: {
  id: Platform
  label: string
  description: string
  architectures: Architecture[]
  formats: DownloadFormat[]
}[] = [
  {
    id: 'mac',
    label: 'macOS',
    description: 'Apple Silicon and Intel Macs',
    architectures: ['arm64', 'x64'],
    formats: ['dmg', 'zip']
  },
  {
    id: 'windows',
    label: 'Windows',
    description: 'Intel, AMD, and Arm PCs',
    architectures: ['x64', 'arm64'],
    formats: ['exe', 'zip']
  },
  {
    id: 'linux',
    label: 'Linux',
    description: 'Debian, Ubuntu, Fedora, and more',
    architectures: ['x64', 'arm64'],
    formats: ['AppImage', 'deb', 'rpm', 'tar.gz', 'snap']
  }
]

export function architectureLabel(platform: Platform, architecture: Architecture): string {
  if (platform === 'mac') return architecture === 'arm64' ? 'Apple Silicon' : 'Intel'
  return architecture === 'arm64' ? 'Arm64' : 'x64'
}

// Only published assets are exposed; versioned URLs keep an older site build usable after a release.
export function getReleaseDownloads(tag: string, assetNames: string[]): ReleaseDownload[] {
  const version = tag.replace(/^v/, '')
  const names = new Set(assetNames)
  const downloads: ReleaseDownload[] = []
  for (const platform of DOWNLOAD_PLATFORMS) {
    for (const architecture of platform.architectures) {
      for (const format of platform.formats) {
        const prefix = platform.id === 'windows' ? 'win' : platform.id
        const arch = platform.id === 'linux' && architecture === 'x64' ? '' : `-${architecture}`
        const suffix = format === 'exe' ? '-setup.exe' : `.${format}`
        const name = `autumnmark-${prefix}${arch}-${version}${suffix}`
        if (names.has(name)) {
          downloads.push({
            platform: platform.id,
            architecture,
            format,
            url: `${DOWNLOAD.releases}/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`
          })
        }
      }
    }
  }
  return downloads
}
