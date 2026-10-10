<#
.SYNOPSIS
  Lets administrators install updates from Settings.

.DESCRIPTION
  Registers "<Product> Updater", a scheduled task that runs as SYSTEM once a
  minute, looks for an update request from Settings, and exits. Most runs take
  well under a second and do nothing.

  Creates the updater's own folders beside the data folder:

    <Product> updater\status   SYSTEM and administrators write; users read.
                               The application reads progress from here.
    <Product> updater\work     SYSTEM and administrators only. Downloads and
                               the copy of the previous version live here.

  Inheritance is switched off on both, deliberately. The data folder above
  them lets every local user write, and a folder SYSTEM installs software from
  must not inherit that.

  Run by the installer. Safe to run again: it replaces the task and resets the
  permissions.

.PARAMETER InstallDir
  The folder holding node.exe and the app folder. Defaults to the parent of
  this script's folder.
#>
[CmdletBinding()]
param(
  [string]$InstallDir = ""
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
if (-not $admin) { Write-Host "This needs to run as administrator."; exit 1 }

$meta = Get-Content (Join-Path $InstallDir "app\product.json") -Raw | ConvertFrom-Json
$display = $meta.display
if ($display -notmatch '^Offset [A-Za-z]+$') { throw "Unrecognised product in app\product.json: $display" }

$security = Join-Path $env:ProgramData "Offset Security"
$dataDir = Join-Path $security $display
$root = Join-Path $security "$display updater"
$status = Join-Path $root "status"
$work = Join-Path $root "work"
$node = Join-Path $InstallDir "node.exe"
$script = Join-Path $InstallDir "app\dist\updater\windows.js"
$taskName = "$display Updater"

foreach ($required in @($node, $script)) {
  if (-not (Test-Path $required)) { throw "Not found: $required" }
}

# -- folders ------------------------------------------------------------------
foreach ($dir in @($root, $status, $work, (Join-Path $dataDir "updates\request"))) {
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
}

# Well-known SIDs, not names, so this works on a Windows installed in any language.
$system = "*S-1-5-18"
$admins = "*S-1-5-32-544"
$users = "*S-1-5-32-545"

& icacls $root /inheritance:r /grant:r "${system}:(OI)(CI)F" "${admins}:(OI)(CI)F" /Q | Out-Null
& icacls $status /inheritance:r /grant:r "${system}:(OI)(CI)F" "${admins}:(OI)(CI)F" "${users}:(OI)(CI)RX" /Q | Out-Null
& icacls $work /inheritance:r /grant:r "${system}:(OI)(CI)F" "${admins}:(OI)(CI)F" /Q | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not set permissions on $root" }

# Proof for Settings that an updater exists for this install.
@{ kind = "windows"; installedAt = (Get-Date).ToUniversalTime().ToString("o") } |
  ConvertTo-Json | Set-Content (Join-Path $status "updater.json") -Encoding ascii

# -- the task -----------------------------------------------------------------
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }

$action = New-ScheduledTaskAction -Execute $node `
  -Argument "`"$script`" --poll --install-dir `"$InstallDir`" --data-dir `"$dataDir`"" `
  -WorkingDirectory $work

# Every minute, for ever, starting now; and again at boot, since a repetition
# on a one-off trigger does not survive a restart on every Windows version.
$every = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1)
$boot = New-ScheduledTaskTrigger -AtStartup

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 45) `
  -Hidden

$principal = New-ScheduledTaskPrincipal -UserId "NT AUTHORITY\SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($every, $boot) `
  -Settings $settings -Principal $principal `
  -Description "Installs $display updates that an administrator asks for in Settings. Checks for a request once a minute; does nothing otherwise." |
  Out-Null

Write-Host "Registered $taskName."
