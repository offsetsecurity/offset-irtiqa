<#
.SYNOPSIS
  Builds a self-contained Windows bundle for one product.

.DESCRIPTION
  Produces a folder that runs on a machine with nothing installed - no Node,
  no database, no Docker. Node is copied in, the database is a file the app
  creates on first run, and the secrets are generated the first time it starts.

  This is also the payload the Inno Setup installer wraps, so the two cannot
  drift: build this first, then compile offset.iss against its output.

.PARAMETER Product
  ascend. Kept as a parameter so the scripts stay the shape they had when
  every product came from one repository.

.PARAMETER NodeExe
  Node to bundle. Defaults to the Node running this script, and the build
  refuses to go on unless its version is the one pinned in .nvmrc. Point this
  at an extracted official node-v24.x.y-win-x64\node.exe when the machine has
  a different Node.

.EXAMPLE
  pwsh deploy/windows/build.ps1 -Product align
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [ValidateSet("ascend")]
  [string]$Product = "ascend",

  [string]$NodeExe = (Get-Command node).Source,

  [string]$OutDir = "",

  [switch]$SkipZip,

  # The release version. Without it the bundle takes the source's version.
  [ValidatePattern('^(\d+\.\d+\.\d+)?$')]
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")

# The customer gets exactly this node.exe, so it must be the pinned one. The
# default used to be whatever Node the build machine had, which is how an
# unsupported Node 20 came to be shipped long after its support ended.
$pinned = (Get-Content (Join-Path $repo ".nvmrc") -Raw).Trim()
$bundled = (& $NodeExe --version).Trim().TrimStart("v")
if ($bundled -ne $pinned) {
  throw "This would bundle Node $bundled, but .nvmrc pins $pinned. Pass -NodeExe with the path to an official node-v$pinned-win-x64\node.exe."
}

$names = @{ ascend = "Offset Irtiqa" }
$display = $names[$Product]
$folder = $display -replace " ", ""

if (-not $OutDir) { $OutDir = Join-Path $repo "dist\windows" }
$stage = Join-Path $OutDir $folder
$appDir = Join-Path $stage "app"

Write-Host "Building $display for Windows" -ForegroundColor Cyan
Write-Host "  output: $stage"

# -- 1. build -----------------------------------------------------------------
Push-Location $repo
try {
  # tsc never removes files it did not just write, so anything that has ever
  # been dropped into apps/api/dist ships in the bundle for ever. An early run
  # of this script left an empty dist/windows tree in there and it was faithfully
  # installed on to a customer machine. Clean first; the build regenerates it.
  $apiDist = Join-Path $repo "apps\api\dist"
  if (Test-Path $apiDist) { Remove-Item $apiDist -Recurse -Force }

  Write-Host "  building the API..."
  & pnpm --filter "@offset/api" build | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "API build failed." }

  Write-Host "  building the $Product web bundle..."
  $env:PRODUCT = $Product
  & pnpm --filter "@offset/web" build | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Web build failed." }

  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
  New-Item -ItemType Directory -Path $appDir -Force | Out-Null
}
finally {
  Remove-Item Env:\PRODUCT -ErrorAction SilentlyContinue
  Pop-Location
}

# -- 3. dependencies, as a tree that survives being copied --------------------
# Not `pnpm deploy`: it produces pnpm's symlinked layout, which collapses the
# moment the folder is copied to another machine - better-sqlite3 ends up
# without `bindings` and the app dies at start-up. npm gives a flat tree of
# real directories, which is what a bundle handed to someone else needs.
# (A hoisted pnpm layout would also work, but creating its .bin symlinks needs
# privileges an ordinary Windows build agent does not have.)
#
# npm does not read pnpm's lockfile, so the manifest pins every package to the
# version pnpm installed and the tests ran against; the script says why. The
# version written is the one the application reports and the updater compares
# against.
$manifestVersion = (Get-Content (Join-Path $repo "apps\api\package.json") -Raw | ConvertFrom-Json).version
$bundleVersion = $(if ($Version) { $Version } else { $manifestVersion })
& node (Join-Path $repo "deploy\runtime-manifest.mjs") --version $bundleVersion --out (Join-Path $appDir "package.json")
if ($LASTEXITCODE -ne 0) { throw "Could not write the bundle's package.json." }

Write-Host "  installing production dependencies..."
# With the bundled Node first on the PATH, so npm and every install script run
# on it. better-sqlite3 13 carries its ready-made drivers in the package and
# needs no install script; argon2 still picks its driver for the Node that runs
# the install.
$savedPath = $env:PATH
$env:PATH = "$(Split-Path -Parent (Resolve-Path $NodeExe));$env:PATH"
Push-Location $appDir
try {
  & npm install --omit=dev --no-audit --no-fund --loglevel=error 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
}
finally {
  Pop-Location
  $env:PATH = $savedPath
}

# better-sqlite3 13 ships a ready-made driver for every platform and loads the
# one for the machine it is on. This bundle is 64-bit Windows, so that is the
# one kept; the others would only add to the download.
$prebuilds = Join-Path $appDir "node_modules\better-sqlite3\prebuilds"
if (-not (Test-Path (Join-Path $prebuilds "win32-x64.node"))) {
  throw "node_modules looks wrong: better-sqlite3's Windows driver (prebuilds\win32-x64.node) is missing."
}
Get-ChildItem $prebuilds -Filter *.node | Where-Object { $_.Name -ne "win32-x64.node" } | Remove-Item -Force
if ((Get-ChildItem (Join-Path $appDir "node_modules") -Force | Where-Object { $_.LinkType }).Count -gt 0) {
  throw "node_modules contains links; this bundle would break when copied."
}

# -- 4. the compiled app and the parts it looks for at runtime ----------------
Copy-Item (Join-Path $repo "apps\api\dist") (Join-Path $appDir "dist") -Recurse -Force
# Layout matches the container exactly: app\dist, app\public, app\pack.
# Each product builds into its own folder, so name the one just built rather
# than whatever happens to be in dist\web.
Copy-Item (Join-Path $repo "dist\web\$Product") (Join-Path $appDir "public") -Recurse -Force
Copy-Item (Join-Path $repo "packs\$Product") (Join-Path $appDir "pack") -Recurse -Force
Copy-Item (Join-Path $PSScriptRoot "runtime\start.js") $appDir -Force
# What the shortcuts run: opens a browser, starting the product first if
# it is not already answering.
Copy-Item (Join-Path $PSScriptRoot "runtime\open.js") $appDir -Force
# The shortcuts run the .vbs, which runs open.js with no console window.
Copy-Item (Join-Path $PSScriptRoot "runtime\open.vbs") $appDir -Force
# Running at boot with nobody signed in is opt-in, so the scripts ship
# beside the app rather than doing anything on their own.
Copy-Item (Join-Path $PSScriptRoot "service") (Join-Path $stage "service") -Recurse -Force

# What this bundle is, for anything that needs to know without guessing. The
# service scripts read it; parsing the display name out of README.txt worked
# until an encoding turned the separator into mojibake.
[ordered]@{
  product = $Product
  display = $display
  # One edition, so it is not named. See apps/api/src/config.ts.
  edition = ""
} | ConvertTo-Json | Set-Content (Join-Path $appDir "product.json") -Encoding utf8

# Without the byte-order mark. Set-Content -Encoding utf8 writes one on Windows
# PowerShell 5.1, and JSON.parse refuses a file that starts with it: the
# launcher then could not read the product name, skipped its whole updates
# block, and every Windows install reported "this copy cannot update itself".
$productFile = Join-Path $appDir "product.json"
[System.IO.File]::WriteAllText(
  $productFile,
  (Get-Content $productFile -Raw),
  (New-Object System.Text.UTF8Encoding($false))
)

# The licence the installer shows, and the one a portable copy needs beside it.
# Named .txt so double-clicking it opens Notepad rather than a "choose an app"
# dialog, which is what an extensionless LICENSE does on Windows.
Copy-Item (Join-Path $repo "LICENSE") (Join-Path $stage "LICENSE.txt") -Force

# The product mark. The installer installs its own copy from deploy\windows,
# so this one is for the portable zip, where anyone making a shortcut by hand
# has nothing else to point at.
Copy-Item (Join-Path $PSScriptRoot "offset.ico") (Join-Path $stage "offset.ico") -Force

# The documents, in the box: the user guide, the install guide, the technology
# page, the troubleshooting guide, the README and the release notes. The same
# ones go in the Linux and Docker bundles, with their links fixed for a folder.
& node (Join-Path $repo "deploy\bundle-docs.mjs") (Join-Path $stage "docs")
if ($LASTEXITCODE -ne 0) { throw "Could not bundle the documents." }

if (-not (Test-Path $NodeExe)) { throw "Node not found at $NodeExe" }
Copy-Item $NodeExe (Join-Path $stage "node.exe") -Force
$nodeVersion = (& $NodeExe --version).Trim()

# Every runtime dependency loaded by the Node that ships, from inside the
# bundle. The Linux build starts the whole application; this is the cheaper
# half of that, and it is the half that once failed: a library that installs
# cleanly and then cannot be loaded by this Node version. Better here than on
# a customer's server.
Write-Host "  checking every dependency loads..."
Push-Location $appDir
try {
  # better-sqlite3 only loads its driver when a database is opened, so one is.
  & (Join-Path $stage "node.exe") --input-type=module -e "import { readFileSync } from 'node:fs'; const { dependencies } = JSON.parse(readFileSync('package.json', 'utf8')); for (const name of Object.keys(dependencies)) await import(name); const { default: Database } = await import('better-sqlite3'); new Database(':memory:').prepare('select 1').get();"
  if ($LASTEXITCODE -ne 0) { throw "A dependency does not load with Node $nodeVersion. The bundle would not start." }
}
finally { Pop-Location }

# -- 5. configuration template ------------------------------------------------
# The two secrets are left blank on purpose: start.js fills them with fresh
# random values on first run, so no two installs share a key.
@"
PRODUCT=$Product
NODE_ENV=production
PORT=8080
PUBLIC_URL=http://localhost:8080

# Which machines can reach this.
#
# 127.0.0.1 means this computer only, which is the safe default and right
# for a single-machine install. To let colleagues reach it, set HOST=0.0.0.0
# AND give it a certificate below. Without one it will refuse to start,
# because passwords would cross the network as readable text.
HOST=127.0.0.1

# Paths to a certificate and its private key, in PEM format. Set both to
# serve HTTPS. Leave blank for a localhost-only install.
TLS_CERT_FILE=
TLS_KEY_FILE=

# Set true only when something in front of this already terminates TLS,
# such as IIS or nginx. It permits answering the network without a
# certificate of our own.
ALLOW_INSECURE_NETWORK=false

DATABASE_URL=file:./data/offset.db

# Generated on first run. Keep them secret, and keep them if you move the data.
SESSION_SECRET=
FIELD_ENC_KEY=

SESSION_TTL_HOURS=12

# Nightly jobs run at this hour, on a 24-hour clock.
DAILY_JOB_HOUR=2
BACKUP_ENABLED=true
BACKUP_DIR=./backups
BACKUP_KEEP=3

# 0 keeps the audit log for ever, which is the safe default.
AUDIT_RETENTION_DAYS=0

# Logs. Files rotate at LOG_MAX_MB and LOG_KEEP generations are kept, so the
# log folder has a fixed ceiling: LOG_MAX_MB x (LOG_KEEP + 1) per file.
LOG_DIR=./logs
LOG_TO_FILE=true
LOG_MAX_MB=10
LOG_KEEP=5
# Raise to debug only while chasing a problem; it is noisy and it grows fast.
LOG_LEVEL=info
"@ | Set-Content (Join-Path $appDir "env.template") -Encoding utf8

# -- 6. how someone starts it -------------------------------------------------
@"
@echo off
title $display
cd /d "%~dp0"
node.exe app\start.js
if errorlevel 1 (
  echo.
  echo $display stopped with an error. The message above says why.
  pause
)
"@ | Set-Content (Join-Path $stage "Start $display.cmd") -Encoding ascii

# The installer points its shortcut at this one. Program Files is read-only for
# ordinary users, so an installed copy keeps its data under ProgramData.
@"
@echo off
title $display
cd /d "%~dp0.."
set "OFFSET_DATA_DIR=%ProgramData%\Offset Security\$display"
node.exe app\start.js
if errorlevel 1 (
  echo.
  echo $display stopped with an error. The message above says why.
  pause
)
"@ | Set-Content (Join-Path $appDir "launch-installed.cmd") -Encoding ascii

# For an administrator who cannot sign in and has no email to reset it with.
# It sits beside node.exe in Program Files, so it is found where the product is.
# It must run as administrator: it changes the database of an installed copy,
# and that is what keeps it from being a way in for anyone who walks past.
@"
@echo off
setlocal
title Reset an administrator password - $display
net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Please run this as administrator.
  echo   Right-click "Reset administrator password" and choose "Run as administrator".
  echo.
  pause
  exit /b 1
)
set "APP=%~dp0"
set "DATA=%ProgramData%\Offset Security\$display"
if not exist "%DATA%\.env" (
  echo.
  echo   $display has not been set up on this computer yet, so there is no password to reset.
  echo.
  pause
  exit /b 1
)
echo.
echo   Reset an administrator password for $display
echo   ---------------------------------------------
echo   This prints a temporary password. It works once, for 30 minutes,
echo   and only to choose a new password. Using it is recorded in the audit log.
echo.
set "WHO="
set /p "WHO=  Administrator username: "
if "%WHO%"=="" (
  echo   No username was given. Nothing was changed.
  echo.
  pause
  exit /b 1
)
cd /d "%DATA%"
"%APP%node.exe" "%APP%app\dist\admin\reset-password.js" "%WHO%"
echo.
pause
"@ | Set-Content (Join-Path $stage "Reset administrator password.cmd") -Encoding ascii

@"
$display
$("=" * ($display.Length + 20))

To start:  double-click "Start $display.cmd"
Then open: http://localhost:8080

The first person to open it creates the administrator account.

Everything lives in this folder:
  data\      the database.
  evidence\  documents attached to evidence records.

Back up data\ and evidence\ together. The nightly backup copies the
database only, so restoring from it alone leaves every evidence record
pointing at a document that is no longer there.
  backups\   nightly copies, the newest $([char]0x2014) older ones are pruned.
  logs\      what happened, and why it stopped if it did.
  .env       settings, including the secrets generated on first run.

If something goes wrong, the logs folder is what to send:
  launcher.log  start-up problems, and anything printed as it failed
  app.log       the application
  worker.log    backups and other nightly work
  crash.log     unexpected errors, if there have been any
They rotate at 10 MB and keep 5 older copies, so they cannot fill the disk.
Passwords, session cookies and keys are stripped before anything is written.

To move this to another machine, copy the whole folder. Keep .env with it:
without the same SESSION_SECRET everyone is signed out, and without the same
FIELD_ENC_KEY any stored secrets cannot be read back.

To stop it, close the window or press Ctrl+C.

To start it with Windows instead, so it runs with nobody signed in, open
PowerShell as administrator in this folder and run:
  .\service\install-service.ps1
and to undo that:
  .\service\uninstall-service.ps1

The docs folder has the user guide, the install guide, the datasheet, a page
on what the product is built with, the security overview, the privacy sheet,
the security questionnaire, a troubleshooting guide, how support and updates
work, and the release notes. The same
help and guides are inside the product too, under Help and Documentation.

Bundled Node $nodeVersion. No other software is required.

$([char]0x00a9) 2026 Offset Security. Free to use under the licence in LICENSE.txt:
install it anywhere, for any purpose, for as many people as you like. You may
not modify it, re-brand it, sell it, or run it as a service for others.
Questions: info@offsetsecurity.net
"@ | Set-Content (Join-Path $stage "README.txt") -Encoding utf8

# -- 7. report ----------------------------------------------------------------
$size = [math]::Round((Get-ChildItem $stage -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 1)
Write-Host "  bundle: $size MB, Node $nodeVersion" -ForegroundColor Green

if (-not $SkipZip) {
  $zip = Join-Path $OutDir "$folder-windows.zip"
  if (Test-Path $zip) { Remove-Item $zip -Force }
  # .NET's ZipFile, directly. Compress-Archive in Windows PowerShell 5.1 wraps
  # the same class but walks node_modules one file at a time through the
  # pipeline, and took longer than every other step of this build put together.
  # tar.exe was tried as well and crashed partway through with an access
  # violation, leaving a truncated zip behind.
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::CreateFromDirectory(
    $stage, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $true)
  $zipSize = [math]::Round((Get-Item $zip).Length / 1MB, 1)
  Write-Host "  zip:    $zip ($zipSize MB)" -ForegroundColor Green
}
