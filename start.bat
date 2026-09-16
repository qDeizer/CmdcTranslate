@echo off
setlocal
cd /d "%~dp0"
title Astra1 Native Bridge

where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 veya ustu gerekli. Kurulumdan sonra tekrar deneyin.
  pause
  exit /b 1
)

set "ASTRA_PORT="
for /f "delims=" %%P in ('powershell.exe -NoProfile -Command "$p = 'config.local.json'; if (!(Test-Path $p)) { $p = 'config.example.json' }; (Get-Content -Raw $p | ConvertFrom-Json).listen.port"') do set "ASTRA_PORT=%%P"
if not defined ASTRA_PORT (
  echo Astra1 port ayari okunamadi. config.local.json dosyasini kontrol edin.
  pause
  exit /b 1
)
set "ASTRA_URL=http://127.0.0.1:%ASTRA_PORT%"

powershell.exe -NoProfile -Command "try { $h = Invoke-RestMethod '%ASTRA_URL%/healthz' -TimeoutSec 2; if ($h.status -eq 'ok' -and $h.contractVersion -eq 'astra1-v1') { exit 0 } } catch {}; exit 1"
if not errorlevel 1 (
  start "" "%ASTRA_URL%/"
  exit /b 0
)

start "" /min powershell.exe -NoProfile -WindowStyle Hidden -Command "for ($i = 0; $i -lt 30; $i++) { try { $h = Invoke-RestMethod '%ASTRA_URL%/healthz' -TimeoutSec 1; if ($h.status -eq 'ok' -and $h.contractVersion -eq 'astra1-v1') { Start-Process '%ASTRA_URL%/'; exit } } catch {}; Start-Sleep -Seconds 1 }"
echo Astra1 baslatiliyor: %ASTRA_URL%
echo Servis calisirken bu pencereyi acik tutun. Durdurmak icin Ctrl+C.
node.exe scripts\run.mjs
if errorlevel 1 pause
