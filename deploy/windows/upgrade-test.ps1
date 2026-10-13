<#
  Installs one version, puts data in it, installs a newer version over it,
  and checks the data is still there and the newer version is running.

  It installs real software and a Windows service, so it is meant for a
  throwaway machine: the "Upgrade test" workflow runs it on a fresh GitHub
  Windows runner. Do not run it on a computer that has the product installed.

    upgrade-test.ps1 -Old OffsetAssure-0.2.36-setup.exe -New OffsetAssure-0.2.37-setup.exe -Version 0.2.37
#>
param(
  [Parameter(Mandatory)] [string]$Old,
  [Parameter(Mandatory)] [string]$New,
  [Parameter(Mandatory)] [string]$Version,
  [int]$Port = 8080
)
$ErrorActionPreference = "Stop"

function Install-Setup([string]$exe, [string]$log) {
  Write-Host "  installing $exe"
  $p = Start-Process -FilePath $exe -ArgumentList "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/LOG=$log" -Wait -PassThru
  if ($p.ExitCode -ne 0) { Get-Content $log -Tail 40; throw "$exe exited with $($p.ExitCode)" }
}

# The product answers on https with its own certificate, or on http.
function Call([string]$method, [string]$path, [string]$body = "") {
  foreach ($scheme in "https", "http") {
    $curlArgs = @("-sk", "-o", "-", "-w", "`n%{http_code}", "-X", $method, "-b", "jar.txt", "-c", "jar.txt",
              "-H", "content-type: application/json")
    if (Test-Path jar.txt) {
      $csrf = (Select-String -Path jar.txt -Pattern "offset_csrf\s+(\S+)$" | Select-Object -First 1)
      if ($csrf) { $curlArgs += @("-H", "x-csrf-token: $($csrf.Matches[0].Groups[1].Value)") }
    }
    if ($body) { $curlArgs += @("--data", $body) }
    $out = & curl.exe @curlArgs "${scheme}://localhost:$Port$path" 2>$null
    if ($LASTEXITCODE -eq 0 -and $out) {
      $lines = ($out -join "`n").Split("`n")
      return @{ code = [int]$lines[-1]; body = ($lines[0..($lines.Length - 2)] -join "`n") }
    }
  }
  return @{ code = 0; body = "" }
}

function Wait-Ready {
  for ($i = 0; $i -lt 90; $i++) {
    if ((Call "GET" "/api/v1/health/ready").code -eq 200) { return }
    Start-Sleep 2
  }
  throw "the product did not come up on port $Port"
}

function Expect($cond, [string]$what) {
  if (-not $cond) { throw "FAILED: $what" }
  Write-Host "  ok: $what"
}

Install-Setup $Old "old-install.log"
Wait-Ready

$password = "an-upgrade-test-passphrase"
Expect ((Call "POST" "/api/v1/auth/bootstrap" "{""username"":""upgrade"",""name"":""Upgrade Test"",""email"":""upgrade@example.test"",""password"":""$password""}").code -in 200, 201) "the first administrator is created on the old version"
Expect ((Call "POST" "/api/v1/auth/login" "{""username"":""upgrade"",""password"":""$password""}").code -eq 200) "the administrator signs in on the old version"
Expect ((Call "POST" "/api/v1/risks" "{""title"":""Kept across the upgrade"",""likelihood"":3,""impact"":4}").code -eq 201) "a risk is added on the old version"
Expect ((Call "POST" "/api/v1/evidence" "{""name"":""Evidence kept across the upgrade"",""collectedDate"":null}").code -eq 201) "evidence is added on the old version"

Install-Setup $New "new-install.log"
Wait-Ready
Remove-Item jar.txt -ErrorAction SilentlyContinue

$health = (Call "GET" "/api/v1/health").body | ConvertFrom-Json
Expect ($health.version -eq $Version) "the new version $Version is running (it says $($health.version))"
Expect ((Call "POST" "/api/v1/auth/login" "{""username"":""upgrade"",""password"":""$password""}").code -eq 200) "the same administrator signs in after the upgrade"
$risks = ((Call "GET" "/api/v1/risks").body | ConvertFrom-Json).risks
Expect (($risks | Where-Object { $_.title -eq "Kept across the upgrade" }).Count -eq 1) "the risk is still there"
$evidence = ((Call "GET" "/api/v1/evidence").body | ConvertFrom-Json).evidence
Expect (($evidence | Where-Object { $_.name -eq "Evidence kept across the upgrade" }).Count -eq 1) "the evidence is still there"
# The data folder holds the keys and the database: ordinary users get nothing.
$data = Get-ChildItem "$env:ProgramData\Offset Security" -Directory | Select-Object -First 1 -ExpandProperty FullName
foreach ($p in $data, (Join-Path $data ".env"), (Join-Path $data "data")) {
  $open = (Get-Acl $p).Access | Where-Object { $_.IdentityReference -match '\\Users$|Authenticated Users|Everyone' }
  Expect (-not $open) "ordinary users have no access to $p"
}
$task = Get-ScheduledTask | Where-Object { $_.TaskName -match '^Offset ' -and $_.TaskName -notmatch 'updater' } | Select-Object -First 1
Expect ($task.Principal.UserId -match 'LOCAL SERVICE') "the service runs as LOCAL SERVICE (it says $($task.Principal.UserId))"
$backups = Get-ChildItem "$env:ProgramData\Offset Security\*\backups" -ErrorAction SilentlyContinue
Write-Host "  backups folder: $($backups.Count) file(s)"

Write-Host ""
Write-Host "Upgrade from the old version to $Version kept everything."
