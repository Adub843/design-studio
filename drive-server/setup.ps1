# One-time setup of the E: drive library on this PC (Windows). Run it from "Set up design library.cmd".
# It installs Cloudflare's tunnel program, asks you to sign in to Cloudflare once in the browser, asks for
# the studio key in a hidden prompt (Windows encrypts it for your account only), connects
# library.epix3d.com to this PC, builds the search index and starts everything now and at every sign-in.
# Nothing on E: is moved, changed or deleted. Run it again any time: each step is skipped if it's done.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$data = Join-Path $env:LOCALAPPDATA "design-library"
$keyFile = Join-Path $data "studio-key.dpapi"
$cfDir = Join-Path $env:USERPROFILE ".cloudflared"
$tunnel = "design-library"
$hostname = "library.epix3d.com"
New-Item -ItemType Directory -Force $data | Out-Null

Write-Host "`n1. Cloudflare tunnel program" -ForegroundColor Cyan
$cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cf) {
  winget install --id Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements --silent
  $cf = @("$env:ProgramFiles\cloudflared\cloudflared.exe", "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $cf) { $cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source }
  if (-not $cf) { throw "cloudflared didn't install. Close this window and run the setup again." }
}
Write-Host "   $cf"

Write-Host "`n2. Studio key" -ForegroundColor Cyan
if (-not (Test-Path $keyFile)) {
  $k = Read-Host "   Type the studio key (the same CONSOLE_KEY as the console). It stays hidden" -AsSecureString
  if ($k.Length -lt 16) { throw "That key is shorter than 16 characters. Run the setup again." }
  $k | ConvertFrom-SecureString | Set-Content -LiteralPath $keyFile
  Write-Host "   Saved, encrypted for your Windows account only."
} else { Write-Host "   Already saved." }

Write-Host "`n3. Sign in to Cloudflare" -ForegroundColor Cyan
if (-not (Test-Path (Join-Path $cfDir "cert.pem"))) {
  Write-Host "   Your browser opens: sign in, then click epix3d.com and Authorize."
  & $cf tunnel login
}
$existing = & $cf tunnel list --output json | ConvertFrom-Json | Where-Object { $_.name -eq $tunnel } | Select-Object -First 1
if (-not $existing) { & $cf tunnel create $tunnel | Out-Host; $existing = & $cf tunnel list --output json | ConvertFrom-Json | Where-Object { $_.name -eq $tunnel } | Select-Object -First 1 }
$id = $existing.id
Write-Host "   Tunnel $tunnel ($id)"
& $cf tunnel route dns $tunnel $hostname | Out-Host
@"
tunnel: $id
credentials-file: $(Join-Path $cfDir "$id.json")
ingress:
  - hostname: $hostname
    service: http://127.0.0.1:8787
  - service: http_status:404
"@ | Set-Content -LiteralPath (Join-Path $data "tunnel.yml")

Write-Host "`n4. Search index (reads E: only; about 10 minutes the first time)" -ForegroundColor Cyan
if (-not (Test-Path (Join-Path $data "current-index.txt"))) { node (Join-Path $here "build-index.mjs") } else { Write-Host "   Already built. To refresh it later: node `"$here\build-index.mjs`"" }

Write-Host "`n5. Start now and at every sign-in" -ForegroundColor Cyan
$start = Join-Path $data "start-library.cmd"
@"
@echo off
rem Starts the E: drive library server and its Cloudflare Tunnel (made by drive-server\setup.ps1).
start "Design library server" /min node "$here\server.mjs"
start "Design library tunnel" /min "$cf" tunnel --config "$(Join-Path $data "tunnel.yml")" run
"@ | Set-Content -LiteralPath $start -Encoding ascii
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$start`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
Register-ScheduledTask -TaskName "Design Library" -Action $action -Trigger $trigger -Description "E: drive library for the Design Studio (read only)" -Force | Out-Null
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'drive-server\\server\.mjs|tunnel\.yml' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Process cmd.exe -ArgumentList "/c `"$start`"" -WindowStyle Hidden
Write-Host "`nDone. The library is at https://epix3d.com/#drive while this PC is on." -ForegroundColor Green
