<#
.SYNOPSIS
  Makes Offset start with Windows and keep running when nobody is signed in.

.DESCRIPTION
  Registers a scheduled task that starts at boot, runs whether or not anyone is
  logged on, and restarts itself if it stops unexpectedly. That is the same
  three things people actually want from "run it as a service".

  WHY A SCHEDULED TASK AND NOT A SERVICE ENTRY IN services.msc

  Windows has no built-in way to run an ordinary program as a service. A real
  service has to talk to the Service Control Manager itself, and node.exe does
  not, so `sc create node.exe` produces a service that fails to start with
  error 1053. The usual answer is to ship a third-party wrapper such as NSSM or
  WinSW.

  We do not, deliberately. This product is not code signed, and adding a second
  unsigned executable whose whole job is launching other processes is the
  fastest way to have the whole download quarantined by antivirus. A scheduled
  task needs no extra binary, is built into Windows, and survives a reboot the
  same way.

  The visible difference: it appears in Task Scheduler rather than in the
  Services console, and it is stopped with this script rather than `net stop`.

.PARAMETER InstallDir
  The folder holding node.exe and the app folder. Defaults to the parent of
  this script's own folder, which is correct for both the installer and the
  portable zip.

.PARAMETER DataDir
  Where the database, logs and backups live. Defaults to the ProgramData
  location the installer uses.

.PARAMETER Account
  Which account runs it.

    LocalService  the default. A built-in account with almost no privileges.
                  The data folder is granted write access explicitly.
    System        fully privileged. Use only if LocalService will not start,
                  and understand that the web application then runs with
                  complete access to the machine.
    <domain\user> a named account. You will be prompted for its password.

.PARAMETER TaskName
  Defaults to the display name, so three products can be installed side by side.

.EXAMPLE
  # From an elevated PowerShell, inside the installed folder:
  .\service\install-service.ps1

.EXAMPLE
  .\service\install-service.ps1 -Account System
#>
[CmdletBinding()]
param(
  [string]$InstallDir = "",
  [string]$DisplayName = "",
  [string]$DataDir = "",
  [string]$Account = "LocalService",
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

# -- must be elevated ---------------------------------------------------------
$admin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $admin) {
  Write-Host ""
  Write-Host "This needs to run as administrator." -ForegroundColor Yellow
  Write-Host "Right-click PowerShell, choose 'Run as administrator', then run this again."
  Write-Host ""
  exit 1
}

# -- work out what we are installing ------------------------------------------
if (-not $DisplayName) {
  # Written by build.ps1 next to the application.
  $meta = Join-Path $InstallDir "app\product.json"
  if (Test-Path $meta) {
    try { $DisplayName = (Get-Content $meta -Raw | ConvertFrom-Json).display } catch { }
  }
}
if (-not $DisplayName) { $DisplayName = "Offset" }
if (-not $TaskName) { $TaskName = $DisplayName }
if (-not $DataDir) { $DataDir = Join-Path $env:ProgramData "Offset Security\$DisplayName" }

$node = Join-Path $InstallDir "node.exe"
$entry = Join-Path $InstallDir "app\start.js"

foreach ($required in @($node, $entry)) {
  if (-not (Test-Path $required)) {
    throw "Not found: $required`nRun this from inside the installed folder."
  }
}

Write-Host ""
Write-Host "Installing $DisplayName as a background service" -ForegroundColor Cyan
Write-Host "  program : $node"
Write-Host "  data    : $DataDir"
Write-Host "  account : $Account"
Write-Host ""

# -- the data folder has to exist and be writable by whoever runs it ----------
foreach ($sub in @("", "data", "backups", "evidence", "logs")) {
  $path = if ($sub) { Join-Path $DataDir $sub } else { $DataDir }
  if (-not (Test-Path $path)) { New-Item -ItemType Directory -Path $path -Force | Out-Null }
}

# Resolve the account to the form Windows wants, and to the SID that needs
# write access. A built-in account has no password; a named one does.
$principalArgs = @{}
$grantTo = $null

switch -Regex ($Account) {
  '^(LocalService|NT AUTHORITY\\LOCAL SERVICE)$' {
    $principalArgs = @{ UserId = "NT AUTHORITY\LOCAL SERVICE"; LogonType = "ServiceAccount"; RunLevel = "Limited" }
    $grantTo = "NT AUTHORITY\LOCAL SERVICE"
  }
  '^(System|NT AUTHORITY\\SYSTEM)$' {
    # SYSTEM already has full access to ProgramData, so nothing to grant.
    $principalArgs = @{ UserId = "NT AUTHORITY\SYSTEM"; LogonType = "ServiceAccount"; RunLevel = "Highest" }
  }
  default {
    $principalArgs = @{ UserId = $Account; LogonType = "Password"; RunLevel = "Limited" }
    $grantTo = $Account
  }
}

if ($grantTo) {
  Write-Host "  granting $grantTo write access to the data folder..."
  # /T applies to everything already inside; the inheritance flags cover
  # anything created later, which is most of it.
  & icacls "$DataDir" /grant "${grantTo}:(OI)(CI)M" /T /C /Q | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  could not set permissions; the service may not be able to write." -ForegroundColor Yellow
  }
}

# The data folder holds the encryption keys (.env), the database, the evidence
# and the backups. Only the account the service runs as, SYSTEM and
# administrators may open it; an ordinary user signed in to this server may
# not read the keys, nor edit the database to make themselves an administrator.
# Older versions let every user change it, so existing installs are closed too.
# SIDs, not names, so this works on Windows in any language.
Write-Host "  closing the data folder to everyone but the service and administrators..."
# In this order: grant, then remove, then close the top folder last, so that
# nothing inside becomes unreachable half way through.
& icacls "$DataDir" /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" /T /C /Q | Out-Null
if ($grantTo) { & icacls "$DataDir" /grant "${grantTo}:(OI)(CI)M" /T /C /Q | Out-Null }
foreach ($sid in "*S-1-5-32-545", "*S-1-5-11", "*S-1-1-0", "*S-1-3-0") {
  # Users, Authenticated Users, Everyone, CREATOR OWNER
  & icacls "$DataDir" /remove:g $sid /T /C /Q | Out-Null
}
& icacls "$DataDir" /inheritance:r /C /Q | Out-Null

# -- replace any previous registration ----------------------------------------
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "  removing the previous registration..."
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# -- register -----------------------------------------------------------------
# --service suppresses the console banner; there is no console to write to.
$action = New-ScheduledTaskAction -Execute $node `
  -Argument "`"$entry`" --service --data-dir `"$DataDir`"" `
  -WorkingDirectory $InstallDir

$trigger = New-ScheduledTaskTrigger -AtStartup

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero)   # never time it out: it is meant to run for ever

$principal = New-ScheduledTaskPrincipal @principalArgs

$register = @{
  TaskName    = $TaskName
  Action      = $action
  Trigger     = $trigger
  Settings    = $settings
  Principal   = $principal
  Description = "$DisplayName. Starts with Windows and runs whether or not anyone is signed in."
  Force       = $true
}

if ($principalArgs.LogonType -eq "Password") {
  $cred = Get-Credential -UserName $Account -Message "Password for $Account"
  $register.User = $cred.UserName
  $register.Password = $cred.GetNetworkCredential().Password
}

Register-ScheduledTask @register | Out-Null
Write-Host "  registered." -ForegroundColor Green

# -- start it, and check that it actually came up -----------------------------
Write-Host "  starting..."
Start-ScheduledTask -TaskName $TaskName

$port = 8080
$envFile = Join-Path $DataDir ".env"
if (Test-Path $envFile) {
  # The last PORT line, which is the one dotenv gives the application.
  $line = Select-String -Path $envFile -Pattern '^PORT=(\d+)' -ErrorAction SilentlyContinue | Select-Object -Last 1
  if ($line) { $port = [int]$line.Matches[0].Groups[1].Value }
}

# With HTTPS on, http:// is answered with a redirect to https://, and the
# certificate is issued for the name people type, not 127.0.0.1. This only
# asks whether it is up, so the certificate is not checked here.
#
# The callback is set from C#: a PowerShell script block cannot run on the
# thread .NET checks certificates on, and fails with "no Runspace available".
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if (-not ("OffsetProbeTrust" -as [type])) {
  Add-Type -TypeDefinition @"
public static class OffsetProbeTrust {
  public static void On() { System.Net.ServicePointManager.ServerCertificateValidationCallback = delegate { return true; }; }
  public static void Off() { System.Net.ServicePointManager.ServerCertificateValidationCallback = null; }
}
"@
}
[OffsetProbeTrust]::On()
$scheme = "http"
$up = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $r = Invoke-WebRequest "http://127.0.0.1:$port/api/v1/health" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) {
      $up = $true
      if ($r.BaseResponse.ResponseUri.Scheme -eq "https") { $scheme = "https" }
      break
    }
  }
  catch { }
}
[OffsetProbeTrust]::Off()

Write-Host ""
if ($up) {
  Write-Host "$DisplayName is running." -ForegroundColor Green
  Write-Host "  open        ${scheme}://localhost:$port"
  Write-Host "  starts      automatically at boot, with nobody signed in"
  Write-Host "  logs        $DataDir\logs"
  Write-Host "  stop/remove run service\uninstall-service.ps1"
}
else {
  # Say what to look at rather than leaving a silent failure behind.
  Write-Host "It did not answer on port $port within 30 seconds." -ForegroundColor Yellow
  Write-Host ""
  Write-Host "Look at:  $DataDir\logs\launcher.log"
  Write-Host "          $DataDir\logs\app.log"
  Write-Host ""
  Write-Host "The usual cause is the account not being able to write to the data"
  Write-Host "folder. If the log says so, try again with:"
  Write-Host "  .\service\install-service.ps1 -Account System" -ForegroundColor Cyan
  Write-Host "which always has access, at the cost of running with full privileges."
  exit 1
}
