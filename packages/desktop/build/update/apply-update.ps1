# AutumnMark+ in-place updater (Windows / portable ZIP).
#
# Runs detached from the app so the program directory is no longer locked:
# waits for the old process to exit, moves the current install aside, copies
# the staged build over it, restarts, and rolls back when copying fails.
#
# Parameters are supplied by the app; nothing here downloads anything.

param(
  [Parameter(Mandatory = $true)][int]$ParentPid,
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Target,
  [Parameter(Mandatory = $true)][string]$Launch,
  [string]$LogPath = '',
  [string]$Cleanup = ''
)

$ErrorActionPreference = 'Stop'
# Process-exit checks: up to 5 checks, 3 seconds apart.
$processCheckIntervalSeconds = 3
$processCheckMax = 5

function Write-UpdateLog([string]$message) {
  if (-not $LogPath) { return }
  try {
    $line = '{0} [apply-update] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
  } catch {
    # Logging must never abort the swap.
  }
}

# The app owns shutdown and the user's save decisions. Do not modify the install
# while any process is still running from it.
function Get-InstalledProcesses {
  $prefix = $Target.TrimEnd('\') + '\'
  $found = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) })
  return $found
}

function Wait-ForProcessExit {
  for ($check = 1; $check -le $processCheckMax; $check++) {
    $stillRunning = @()
    if (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) { $stillRunning += $ParentPid }
    foreach ($proc in (Get-InstalledProcesses)) { $stillRunning += $proc.ProcessId }
    if ($stillRunning.Count -eq 0) {
      Write-UpdateLog ("all application processes exited (check {0}/{1})" -f $check, $processCheckMax)
      return $true
    }
    Write-UpdateLog ("check {0}/{1}: still running: {2}" -f $check, $processCheckMax, ($stillRunning -join ', '))
    if ($check -lt $processCheckMax) { Start-Sleep -Seconds $processCheckIntervalSeconds }
  }
  return $false
}

function Remove-OldBackups {
  $parent = Split-Path -Parent $Target
  $leaf = Split-Path -Leaf $Target
  Get-ChildItem -LiteralPath $parent -Directory -Filter "$leaf.backup-*" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 1 |
    ForEach-Object {
      try { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction Stop }
      catch { Write-UpdateLog "could not prune $($_.FullName): $_" }
    }
}

Write-UpdateLog "start (source=$Source, target=$Target, pid=$ParentPid)"
if (-not (Wait-ForProcessExit)) {
  Write-UpdateLog "application still running after $processCheckMax checks; aborting the update"
  if ($Cleanup) { try { Remove-Item -LiteralPath $Cleanup -Recurse -Force } catch { } }
  exit 5
}

if (-not (Test-Path -LiteralPath $Source)) {
  Write-UpdateLog 'staged build is missing; aborting'
  if ($Cleanup) { try { Remove-Item -LiteralPath $Cleanup -Recurse -Force } catch { } }
  exit 2
}

# Copy files with robocopy instead of renaming the whole install directory.
# Windows Explorer (and antivirus) can keep a handle on the directory for as
# long as it is open, which makes Move-Item fail with "item is in use" even
# after every application process has exited. Robocopy copies file by file:
# an open directory handle no longer blocks the update.
function Copy-Tree([string]$From, [string]$To) {
  $arguments = @($From, $To, '/E', '/R:2', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS')
  & robocopy.exe @arguments | Out-Null
  $copyCode = $LASTEXITCODE
  # robocopy exit codes 0-7 mean success (files copied / extra files present);
  # 8 and above are actual errors.
  if ($copyCode -ge 8) { throw "robocopy exited with $copyCode" }
  return $copyCode
}

$backup = '{0}.backup-{1}' -f $Target, (Get-Date -Format 'yyyyMMddHHmmss')
$backedUp = $false

if (Test-Path -LiteralPath $Target) {
  try {
    Copy-Tree $Target $backup | Out-Null
    $backedUp = $true
    Write-UpdateLog "current build copied to $backup"
  } catch {
    Write-UpdateLog "backup copy failed: $_"
    if (Test-Path -LiteralPath $Launch) {
      Start-Process -FilePath $Launch -WorkingDirectory (Split-Path -Parent $Launch)
    }
    exit 3
  }
}

$copyCode = -1
try {
  New-Item -ItemType Directory -Path $Target -Force | Out-Null
  # /E keeps files that only exist in the old build; deleting user files on a
  # failed update is worse than leaving a few stale ones behind.
  $copyCode = Copy-Tree $Source $Target
  Write-UpdateLog "staged build copied (robocopy exit $copyCode)"
} catch {
  Write-UpdateLog "copy failed: $_"
}

if ($copyCode -lt 0 -or $copyCode -ge 8) {
  if ($backedUp -and (Test-Path -LiteralPath $backup)) {
    try {
      Copy-Tree $backup $Target | Out-Null
      Write-UpdateLog 'rolled back to the previous build'
    } catch {
      Write-UpdateLog "rollback failed, backup kept at $backup : $_"
    }
  }
  if (Test-Path -LiteralPath $Launch) { Start-Process -FilePath $Launch -WorkingDirectory (Split-Path -Parent $Launch) }
  if ($Cleanup) { try { Remove-Item -LiteralPath $Cleanup -Recurse -Force } catch { } }
  exit 4
}

Remove-OldBackups

# The destination still contains files kept by /E. Choose the executable from
# the staged release so a legacy binary cannot win over its replacement.
function Resolve-LaunchPath {
  foreach ($name in @('AutumnMark+.exe', (Split-Path -Leaf $Launch))) {
    if (Test-Path -LiteralPath (Join-Path $Source $name) -PathType Leaf) {
      return (Join-Path $Target $name)
    }
  }
  $candidate = Get-ChildItem -LiteralPath $Source -Filter '*.exe' -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notlike 'Uninstall*' } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($candidate) {
    Write-UpdateLog "launch path missing; falling back to $($candidate.Name)"
    return (Join-Path $Target $candidate.Name)
  }
  Write-UpdateLog 'no executable found after the swap'
  return $null
}

$resolvedLaunch = Resolve-LaunchPath

# Keep one executable only, so a stale shortcut cannot start the previous build.
$legacy = Join-Path $Target 'autumnmark-editor.exe'
if ($resolvedLaunch -and (Split-Path -Leaf $resolvedLaunch) -ne 'autumnmark-editor.exe' -and (Test-Path -LiteralPath $legacy)) {
  try {
    Remove-Item -LiteralPath $legacy -Force -ErrorAction Stop
    Write-UpdateLog 'removed the pre-rename executable'
  } catch {
    Write-UpdateLog "could not remove the pre-rename executable: $_"
  }
}

if ($resolvedLaunch) {
  Start-Process -FilePath $resolvedLaunch -WorkingDirectory (Split-Path -Parent $resolvedLaunch)
  Write-UpdateLog 'restarted the application'
}
if ($Cleanup) { try { Remove-Item -LiteralPath $Cleanup -Recurse -Force } catch { } }
Write-UpdateLog 'done'
exit 0
