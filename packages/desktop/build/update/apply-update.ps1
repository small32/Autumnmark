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
$waitSeconds = 90

function Write-UpdateLog([string]$message) {
  if (-not $LogPath) { return }
  try {
    $line = '{0} [apply-update] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
  } catch {
    # Logging must never abort the swap.
  }
}

function Wait-ForOldProcess {
  $deadline = (Get-Date).AddSeconds($waitSeconds)
  while (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) {
    if ((Get-Date) -gt $deadline) {
      Write-UpdateLog "old process $ParentPid still alive after $waitSeconds s; terminating"
      try { Stop-Process -Id $ParentPid -Force -ErrorAction Stop } catch { }
      Start-Sleep -Seconds 2
      break
    }
    Start-Sleep -Milliseconds 400
  }
}

# The main process can be gone while its helper processes (GPU, renderer,
# crash handler) still hold files under the install directory. Rename-Item
# fails with "item is in use" until those handles are released, so wait for
# every process running from this directory before touching it.
function Wait-ForInstalledProcesses {
  $deadline = (Get-Date).AddSeconds(20)
  $prefix = $Target.TrimEnd('\') + '\'
  while ((Get-Date) -lt $deadline) {
    $running = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) })
    if ($running.Count -eq 0) { return }
    Start-Sleep -Milliseconds 400
  }
  Write-UpdateLog 'some processes under the install directory are still running; continuing'
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
Wait-ForOldProcess
Wait-ForInstalledProcesses

if (-not (Test-Path -LiteralPath $Source)) {
  Write-UpdateLog 'staged build is missing; aborting'
  if ($Cleanup) { try { Remove-Item -LiteralPath $Cleanup -Recurse -Force } catch { } }
  exit 2
}

$moved = $false

if (Test-Path -LiteralPath $Target) {
  # Antivirus, the shell or a dying helper can hold a handle for a moment
  # after the processes exit. A failed Move-Item may already have relocated
  # part of the directory, so each attempt uses a fresh backup name and drops
  # incomplete leftovers before retrying.
  $moveOk = $false
  for ($attempt = 1; $attempt -le 15; $attempt++) {
    $backup = '{0}.backup-{1}-{2}' -f $Target, (Get-Date -Format 'yyyyMMddHHmmss'), $attempt
    try {
      Move-Item -LiteralPath $Target -Destination $backup -Force -ErrorAction Stop
      $moveOk = $true
      $moved = $true
      Write-UpdateLog "current build moved to $backup (attempt $attempt)"
      break
    } catch {
      if (Test-Path -LiteralPath $backup) {
        try { Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction Stop } catch { }
      }
      if ($attempt -eq 15) {
        Write-UpdateLog "cannot move the current build aside after $attempt attempts (permission or lock): $_"
        exit 3
      }
      Start-Sleep -Milliseconds 800
    }
  }
  if (-not $moveOk) { exit 3 }
}

$copyOk = $false
try {
  New-Item -ItemType Directory -Path $Target -Force | Out-Null
  # /E keeps files that only exist in the old build; deleting user files on a
  # failed update is worse than leaving a few stale ones behind.
  $arguments = @($Source, $Target, '/E', '/R:2', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS')
  $copy = Start-Process -FilePath 'robocopy' -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
  if ($copy.ExitCode -ge 8) { throw "robocopy exited with $($copy.ExitCode)" }
  $copyOk = $true
  Write-UpdateLog 'staged build copied'
} catch {
  Write-UpdateLog "copy failed: $_"
}

if (-not $copyOk) {
  try { Remove-Item -LiteralPath $Target -Recurse -Force -ErrorAction SilentlyContinue } catch { }
  if ($moved -and (Test-Path -LiteralPath $backup)) {
    try {
      Move-Item -LiteralPath $backup -Destination $Target -Force
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
