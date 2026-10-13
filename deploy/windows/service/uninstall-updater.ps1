<#
.SYNOPSIS
  Removes the updater task and its folders. Run by the uninstaller.

.DESCRIPTION
  The data folder is left alone, as everywhere else in this product. The
  updater's own folders hold only progress messages, downloads and the copy of
  a previous version, none of which is anybody's data.
#>
[CmdletBinding()]
param(
  [string]$InstallDir = ""
)

$ErrorActionPreference = "Continue"

# Where this script is, worked out after the parameters are bound.
# $PSScriptRoot is empty inside a param() default on Windows PowerShell 5.1.
if (-not $InstallDir) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
  $InstallDir = Split-Path -Parent $here
}

$display = $null
try {
  $display = (Get-Content (Join-Path $InstallDir "app\product.json") -Raw | ConvertFrom-Json).display
} catch { }
if (-not $display -or $display -notmatch '^Offset [A-Za-z]+$') { exit 0 }

$taskName = "$display Updater"
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$root = Join-Path $env:ProgramData "Offset Security\$display updater"
if (Test-Path $root) { Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue }
