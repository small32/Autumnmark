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

# Close the running application, then poll until it is really gone before
# replacing any file. The app also calls app.quit() itself; stopping it here
# makes the swap independent of that timing. Poll every 3 seconds, at most 5
# times; only start the swap once nothing is still running from this folder.
function Get-InstalledProcesses {
  $prefix = $Target.TrimEnd('\') + '\'
  $found = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) })
  return $found
}

function Stop-RunningApp {
  # 1. Ask the main process to exit first, then force it if needed.
  $main = Get-Process -Id $ParentPid -ErrorAction SilentlyContinue
  if ($main) {
    try { $main.CloseMainWindow() | Out-Null } catch { }
    Start-Sleep -Milliseconds 800
    if (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) {
      try { Stop-Process -Id $ParentPid -Force -ErrorAction Stop; Write-UpdateLog "force stopped parent process $ParentPid" } catch { }
    }
  }
  # 2. Stop helper processes (GPU, renderer, crash handler) still running from
  #    this install folder.
  foreach ($proc in (Get-InstalledProcesses)) {
    try {
      Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
      Write-UpdateLog "stopped install process $($proc.ProcessId) ($($proc.Name))"
    } catch { }
  }
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
Stop-RunningApp
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
  $copy = Start-Process -FilePath 'robocopy' -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
  # robocopy exit codes 0-7 mean success (files copied / extra files present);
  # 8 and above are actual errors.
  if ($copy.ExitCode -ge 8) { throw "robocopy exited with $($copy.ExitCode)" }
  return $copy.ExitCode
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

# The executable was renamed from autumnmark-editor.exe to AutumnMark+.exe, so
# the recorded launch path can be gone after the swap. Fall back to the
# newest executable in the folder instead of leaving the user with nothing.
function Resolve-LaunchPath {
  if (Test-Path -LiteralPath $Launch) { return $Launch }
  $candidate = Get-ChildItem -LiteralPath $Target -Filter '*.exe' -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notlike 'Uninstall*' } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($candidate) {
    Write-UpdateLog "launch path missing; falling back to $($candidate.Name)"
    return $candidate.FullName
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
