# Rebuilds deploy\windows\offset.ico from the brand mark.
#
#   powershell -ExecutionPolicy Bypass -File deploy\windows\make-icon.ps1
#
# Run it only when the mark changes. The .ico is committed, so a normal build
# does not need this, a browser, or anything else installed.
#
# How it works: a headless Chromium renders apps\web\src\assets\brand\mark.svg
# at each size on a transparent background, and the PNGs are packed into one
# .ico here.
#
# Sizes up to 128 are written the old way - a DIB: 32-bit BGRA rows, bottom
# up, with an empty AND mask - and 256 is kept as PNG, which is how icon files
# have always carried that size. PNG entries at the small sizes were tried
# first and GDI+ could not read them back, and GDI+ is still what parts of
# Windows use to draw a small icon.
param(
  [string]$Browser
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$here = $PSScriptRoot
$repo = Resolve-Path (Join-Path $here "..\..")
$svg = Join-Path $repo "apps\web\src\assets\brand\mark.svg"
$out = Join-Path $here "offset.ico"
if (-not (Test-Path $svg)) { throw "The mark is missing: $svg" }

if (-not $Browser) {
  $candidates = @(
    "$env:ProgramFiles (x86)\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
  )
  $Browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $Browser) { throw "No Edge or Chrome found. Pass -Browser <path to msedge.exe>." }

$work = Join-Path ([IO.Path]::GetTempPath()) ("offset-icon-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $work | Out-Null
$svgUrl = "file:///" + ($svg -replace '\\', '/')

$dibSizes = 16, 24, 32, 48, 64, 128
$allSizes = $dibSizes + 256
foreach ($n in $allSizes) {
  $page = Join-Path $work "m$n.html"
  Set-Content -Path $page -Encoding utf8 -Value @"
<!doctype html><meta charset="utf-8"><body style="margin:0;padding:0">
<img src="$svgUrl" width="$n" height="$n"></body>
"@
  $pageUrl = "file:///" + ($page -replace '\\', '/')
  & $Browser --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 `
    --window-size="$n,$n" --screenshot="$work\m$n.png" --allow-file-access-from-files $pageUrl | Out-Null
  if (-not (Test-Path "$work\m$n.png")) { throw "The browser did not render the ${n}px icon." }
}

$entries = @()
foreach ($n in $dibSizes) {
  $bmp = [System.Drawing.Bitmap]::FromFile((Join-Path $work "m$n.png"))
  if ($bmp.Width -ne $n -or $bmp.Height -ne $n) { throw "m$n.png came out $($bmp.Width)x$($bmp.Height)" }
  $rect = New-Object System.Drawing.Rectangle 0, 0, $n, $n
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $pixels = New-Object byte[] ($data.Stride * $n)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $pixels, 0, $pixels.Length)
  $stride = $data.Stride
  $bmp.UnlockBits($data)
  $bmp.Dispose()

  $rowBytes = $n * 4
  $xor = New-Object byte[] ($rowBytes * $n)
  for ($y = 0; $y -lt $n; $y++) {
    [Array]::Copy($pixels, ($n - 1 - $y) * $stride, $xor, $y * $rowBytes, $rowBytes)
  }
  $and = New-Object byte[] (([math]::Ceiling($n / 32) * 4) * $n)

  $header = New-Object byte[] 40
  [BitConverter]::GetBytes([int]40).CopyTo($header, 0)
  [BitConverter]::GetBytes([int]$n).CopyTo($header, 4)
  [BitConverter]::GetBytes([int]($n * 2)).CopyTo($header, 8)
  [BitConverter]::GetBytes([int16]1).CopyTo($header, 12)
  [BitConverter]::GetBytes([int16]32).CopyTo($header, 14)
  [BitConverter]::GetBytes([int]0).CopyTo($header, 16)
  [BitConverter]::GetBytes([int]($xor.Length + $and.Length)).CopyTo($header, 20)

  $blob = New-Object byte[] ($header.Length + $xor.Length + $and.Length)
  $header.CopyTo($blob, 0)
  $xor.CopyTo($blob, $header.Length)
  $and.CopyTo($blob, $header.Length + $xor.Length)
  $entries += , @{ size = $n; bytes = $blob }
}
$entries += , @{ size = 256; bytes = [IO.File]::ReadAllBytes((Join-Path $work "m256.png")) }

$count = $entries.Count
$dir6 = New-Object byte[] 6
[BitConverter]::GetBytes([int16]1).CopyTo($dir6, 2)
[BitConverter]::GetBytes([int16]$count).CopyTo($dir6, 4)

$table = New-Object byte[] (16 * $count)
$offset = 6 + $table.Length
for ($i = 0; $i -lt $count; $i++) {
  $e = $entries[$i]
  $at = $i * 16
  $dim = if ($e.size -eq 256) { 0 } else { $e.size }   # 0 means 256
  $table[$at] = [byte]$dim
  $table[$at + 1] = [byte]$dim
  [BitConverter]::GetBytes([int16]1).CopyTo($table, $at + 4)
  [BitConverter]::GetBytes([int16]32).CopyTo($table, $at + 6)
  [BitConverter]::GetBytes([int]$e.bytes.Length).CopyTo($table, $at + 8)
  [BitConverter]::GetBytes([int]$offset).CopyTo($table, $at + 12)
  $offset += $e.bytes.Length
}

$stream = [IO.File]::Create($out)
$stream.Write($dir6, 0, $dir6.Length)
$stream.Write($table, 0, $table.Length)
foreach ($e in $entries) { $stream.Write($e.bytes, 0, $e.bytes.Length) }
$stream.Close()
Remove-Item $work -Recurse -Force

"{0}: {1} sizes ({2}), {3} bytes" -f $out, $count, ($allSizes -join ", "), (Get-Item $out).Length
