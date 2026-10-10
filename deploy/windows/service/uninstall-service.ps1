<#
.SYNOPSIS
  Stops Offset running in the background and removes the scheduled task.

.DESCRIPTION
  Removes only the registration. The database, backups, evidence and logs are
  left exactly where they are - an uninstaller that quietly deletes somebody's
  compliance records would be indefensible, and this is not even the
  uninstaller.

  The application can still be started by hand afterwards from its shortcut.

.PARAMETER TaskName
  Defaults to the display name in app\product.json, matching install-service.ps1.

.EXAMPLE
  # From an elevated PowerShell, inside the installed folder:
  .\service\uninstall-service.ps1
#>
[CmdletBinding()]
param(
  [string]$InstallDir = "",
  [string]$TaskName = ""
)

$ErrorActionPreference = "Stop"

# Where this script is, worked out after the parameters are bound.
#
# $PSScriptRoot is empty inside a param() default on Windows PowerShell 5.1,
# which is what the installer runs. The default silently became "", Split-Path
# threw, and the step failed behind `runhidden` where nobody saw it - so the
# updater task was never registered and Settings could not install anything.
if (-not $InstallDir) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
  $InstallDir = Split-Path -Parent $here
}

$admin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $admin) {
  Write-Host ""
  Write-Host "This needs to run as administrator." -ForegroundColor Yellow
  Write-Host ""
  exit 1
}

if (-not $TaskName) {
  $meta = Join-Path $InstallDir "app\product.json"
  if (Test-Path $meta) {
    try { $TaskName = (Get-Content $meta -Raw | ConvertFrom-Json).display } catch { }
  }
}
if (-not $TaskName) { $TaskName = "Offset" }

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
  Write-Host "No background service called '$TaskName' is registered. Nothing to do."
  exit 0
}

Write-Host "Stopping $TaskName..."

# Note the process ids before stopping the task.
#
# Measured on Windows 11: Stop-ScheduledTask takes the whole tree, launcher and
# both children, so the sweep below normally finds nothing. It stays because an
# orphaned worker holds the database open, which is a miserable thing to debug,
# and because that behaviour is not something Microsoft documents as a promise.
$node = Join-Path $InstallDir "node.exe"
$ours = @()
try {
  $ours = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.ExecutablePath -eq $node } |
  Select-Object -ExpandProperty ProcessId
}
catch { }

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

foreach ($processId in $ours) {
  try {
    # /T takes any children with it. A process that has already gone makes
    # taskkill exit 128, which is success as far as we are concerned.
    & taskkill /PID $processId /T /F | Out-Null
  }
  catch { }
}
# Do not let taskkill's exit code become this script's. The installer runs it
# during uninstall and a non-zero code there looks like a failure.
$global:LASTEXITCODE = 0

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "Removed. $TaskName no longer starts with Windows." -ForegroundColor Green
Write-Host ""
Write-Host "Your data has not been touched. It is still in:"
Write-Host "  $(Join-Path $env:ProgramData "Offset Security\$TaskName")"
Write-Host ""
Write-Host "You can still start it by hand from the Start Menu shortcut."

exit 0
