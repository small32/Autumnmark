# Antumnmark+ in-place updater (Windows / portable ZIP).
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

if (-not (Test-Path -LiteralPath $Source)) {
  Write-UpdateLog 'staged build is missing; aborting'
  if ($Cleanup) { try { Remove-Item -LiteralPath $Cleanup -Recurse -Force } catch { } }
  exit 2
}

$stamp = Get-Date -Format 'yyyyMMddHHmmss'
$backup = "$Target.backup-$stamp"
$moved = $false

if (Test-Path -LiteralPath $Target) {
  try {
    Move-Item -LiteralPath $Target -Destination $backup -Force
    $moved = $true
    Write-UpdateLog "current build moved to $backup"
  } catch {
    Write-UpdateLog "cannot move the current build aside (permission or lock): $_"
    exit 3
  }
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
if (Test-Path -LiteralPath $Launch) {
  Start-Process -FilePath $Launch -WorkingDirectory (Split-Path -Parent $Launch)
  Write-UpdateLog 'restarted the application'
}
if ($Cleanup) { try { Remove-Item -LiteralPath $Cleanup -Recurse -Force } catch { } }
Write-UpdateLog 'done'
exit 0
