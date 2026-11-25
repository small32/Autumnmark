// Release tags are `vX.Y.Z`. Prerelease and build metadata are ignored on
// purpose: `/releases/latest` only ever serves stable releases, so a local
// prerelease build still compares by its numeric core.
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)/

export const parseReleaseVersion = (value: string): [number, number, number] | null => {
  const match = VERSION_PATTERN.exec(value.trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** True only when `candidate` is strictly newer than `current`. */
export const isNewerRelease = (candidate: string, current: string): boolean => {
  const next = parseReleaseVersion(candidate)
  const installed = parseReleaseVersion(current)
  // An unparseable tag must never advertise an update: a false positive is
  // worse than a missed notice for builds whose version we cannot compare.
  if (!next || !installed) return false
  for (let index = 0; index < 3; index++) {
    if (next[index] !== installed[index]) return next[index] > installed[index]
  }
  return false
}
