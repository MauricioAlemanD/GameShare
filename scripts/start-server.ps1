<#
.SYNOPSIS
  Arranca el backend de GameShare en este PC y lo publica en Internet con un túnel de Cloudflare.

.DESCRIPTION
  - Genera (la primera vez) una clave de anfitrión aleatoria y la guarda en %APPDATA%\GameShare-server\host-key.txt
    (fuera del repositorio). Sin esa clave nadie puede crear salas en tu servidor.
  - Arranca el backend (java -jar) en http://localhost:8080.
  - Abre un "quick tunnel" de Cloudflare (gratis, sin cuenta) y muestra la URL pública https://....trycloudflare.com.
  - Ctrl+C detiene todo.

  Limitaciones del quick tunnel: la URL cambia en cada arranque y no hay TURN (el vídeo necesita conexión directa).

  Túnel con nombre (URL fija, creado en el panel Zero Trust de Cloudflare):
    Guarda el token en %APPDATA%\GameShare-server\tunnel-token.txt y la URL pública
    (p. ej. https://gameshare.tudominio.com) en %APPDATA%\GameShare-server\public-url.txt.
    El túnel solo se abre mientras este script está en marcha (no se instala ningún servicio).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1
#>
param(
  [int]$Port = 8080,
  [switch]$NoTunnel
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$jar = Join-Path $root 'backend\target\backend-0.0.1-SNAPSHOT.jar'
$dataDir = Join-Path $env:APPDATA 'GameShare-server'
$keyFile = Join-Path $dataDir 'host-key.txt'
New-Item -ItemType Directory -Force $dataDir | Out-Null

# --- Clave de anfitrión (secreta, fuera del repo)
if (-not (Test-Path $keyFile)) {
  $bytes = New-Object byte[] 24
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $key = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  Set-Content -Path $keyFile -Value $key -NoNewline -Encoding ascii
}
$hostKey = (Get-Content $keyFile -Raw).Trim()

# Cierra un proceso y todos sus hijos (el lanzador de Java crea un proceso hijo que es el que usa el puerto).
function Stop-Tree([int]$id) {
  if (-not (Get-Process -Id $id -ErrorAction SilentlyContinue)) { return } # ya terminó
  # La redirección se hace dentro de cmd: en PowerShell 5.1, el stderr de taskkill sería un error fatal.
  cmd.exe /c "taskkill /PID $id /T /F >nul 2>&1"
}

# --- Limpieza de ejecuciones anteriores
# Si se cerró la ventana sin Ctrl+C, el backend y el túnel siguen vivos en segundo plano y ocupan el puerto.
$pidFile = Join-Path $dataDir 'pids.txt'
$stale = @()
if (Test-Path $pidFile) { $stale += Get-Content $pidFile | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ } }
# El lanzador de Java de Oracle (javapath\java.exe) arranca un proceso Java hijo con la ruta escrita con "\\":
# se normaliza antes de comparar.
$stale += Get-CimInstance Win32_Process |
  Where-Object {
    ($_.Name -eq 'java.exe' -and ($_.CommandLine -replace '\\\\', '\') -like "*$jar*") -or
    ($_.Name -eq 'cloudflared.exe' -and ($_.CommandLine -like "*--url http://localhost:$Port*" -or $_.CommandLine -like '*tunnel --no-autoupdate run*'))
  } |
  ForEach-Object { [int]$_.ProcessId }
foreach ($id in ($stale | Sort-Object -Unique)) {
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($p -and $p.ProcessName -in 'java', 'cloudflared') {
    Write-Host "Cerrando un servidor anterior que seguía abierto ($($p.ProcessName), PID $id)..."
    Stop-Tree $id
  }
}
Remove-Item $pidFile -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($busy) {
  $owner = Get-Process -Id $busy.OwningProcess -ErrorAction SilentlyContinue
  throw "El puerto $Port lo está usando otro programa ($($owner.ProcessName), PID $($busy.OwningProcess)). Ciérralo o usa -Port 8090."
}

# --- Compilar el backend si no existe o si el código cambió (después de cerrar el anterior, que bloqueaba el .jar)
$backendDir = Join-Path $root 'backend'
$newestSource = Get-ChildItem (Join-Path $backendDir 'src'), (Join-Path $backendDir 'pom.xml') -Recurse -File |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
# Un .jar ejecutable de Spring Boot ocupa ~24 MB; si es pequeño, quedó a medias (p. ej., una compilación interrumpida).
$jarBroken = (Test-Path $jar) -and (Get-Item $jar).Length -lt 5MB
if (-not (Test-Path $jar) -or $jarBroken -or $newestSource.LastWriteTime -gt (Get-Item $jar).LastWriteTime) {
  Write-Host 'Compilando el backend (hay cambios en el código)...'
  Push-Location $backendDir
  try {
    & .\mvnw.cmd -q -B package -DskipTests
    if ($LASTEXITCODE -ne 0) { throw 'La compilación del backend falló.' }
  } finally { Pop-Location }
}

$env:PORT = "$Port"
$env:GAMESHARE_HOST_KEY = $hostKey
$env:FORWARD_HEADERS_STRATEGY = 'native'   # respeta X-Forwarded-For del túnel (rate limit por IP real)
$backendLog = Join-Path $dataDir 'backend.log'
$backend = Start-Process java -ArgumentList '-jar', "`"$jar`"" -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput $backendLog -RedirectStandardError (Join-Path $dataDir 'backend.err.log')

Set-Content $pidFile $backend.Id

function Show-LogTail([string]$path) {
  if (Test-Path $path) {
    Get-Content $path -Tail 8 | Where-Object { $_.Trim() } | ForEach-Object { Write-Host "   $_" -ForegroundColor DarkGray }
  }
}

$tunnel = $null
try {
  Write-Host 'Arrancando el backend...'
  $deadline = (Get-Date).AddSeconds(60)
  do {
    Start-Sleep -Milliseconds 500
    if ($backend.HasExited) { Show-LogTail $backendLog; throw "El backend se cerró al arrancar. Registro completo: $backendLog" }
    try { $ok = (Invoke-WebRequest "http://localhost:$Port/actuator/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { $ok = $false }
  } until ($ok -or (Get-Date) -gt $deadline)
  if (-not $ok) { throw "El backend no respondió. Revisa $backendLog" }
  if ($backend.HasExited) { throw "El backend se cerró justo después de arrancar. Revisa $backendLog" }

  $publicUrl = "http://localhost:$Port"
  if (-not $NoTunnel) {
    $cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
    if (-not $cf) { $cf = 'C:\Program Files (x86)\cloudflared\cloudflared.exe' }
    if (-not (Test-Path $cf)) { throw 'No se encontró cloudflared. Instálalo con: winget install --id Cloudflare.cloudflared' }
    $tunnelLog = Join-Path $dataDir 'tunnel.log'
    Remove-Item $tunnelLog -ErrorAction SilentlyContinue
    $tokenFile = Join-Path $dataDir 'tunnel-token.txt'
    $urlFile = Join-Path $dataDir 'public-url.txt'
    if (Test-Path $tokenFile) {
      # Túnel con nombre: URL fija configurada en el panel de Cloudflare (Public Hostname → http://localhost:8080).
      if (-not (Test-Path $urlFile)) { throw "Falta $urlFile con la URL pública del túnel (p. ej. https://gameshare.tudominio.com)" }
      $publicUrl = (Get-Content $urlFile -Raw).Trim().TrimEnd('/')
      # El token se pasa por variable de entorno, no por la línea de comandos (no aparece en la lista de procesos).
      $env:TUNNEL_TOKEN = (Get-Content $tokenFile -Raw).Trim()
      $tunnel = Start-Process $cf -ArgumentList 'tunnel', '--no-autoupdate', 'run' -PassThru `
        -WindowStyle Hidden -RedirectStandardError $tunnelLog -RedirectStandardOutput (Join-Path $dataDir 'tunnel.out.log')
      Remove-Item Env:\TUNNEL_TOKEN
      Write-Host "Abriendo el túnel con nombre ($publicUrl)..."
    } else {
      $tunnel = Start-Process $cf -ArgumentList 'tunnel', '--no-autoupdate', '--url', "http://localhost:$Port" -PassThru `
        -WindowStyle Hidden -RedirectStandardError $tunnelLog -RedirectStandardOutput (Join-Path $dataDir 'tunnel.out.log')
      Write-Host 'Abriendo un túnel rápido de Cloudflare (URL temporal)...'
      $publicUrl = $null
      $deadline = (Get-Date).AddSeconds(60)
      do {
        Start-Sleep -Milliseconds 500
        if (Test-Path $tunnelLog) {
          $m = Select-String -Path $tunnelLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
          if ($m) { $publicUrl = $m.Matches[0].Value }
        }
      } until ($publicUrl -or (Get-Date) -gt $deadline)
      if (-not $publicUrl) { throw "No se obtuvo la URL del túnel. Revisa $tunnelLog" }
    }

    Add-Content $pidFile $tunnel.Id

    # El DNS del túnel tarda unos segundos en propagarse.
    $deadline = (Get-Date).AddSeconds(60)
    do {
      Start-Sleep -Seconds 2
      try { $ok = (Invoke-WebRequest "$publicUrl/actuator/health" -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch { $ok = $false }
    } until ($ok -or (Get-Date) -gt $deadline)
    if (-not $ok) { Write-Warning 'El túnel aún no responde; puede tardar un poco más.' }
  }

  Write-Host ''
  Write-Host '================ GameShare: servidor listo ================' -ForegroundColor Green
  Write-Host "Servidor:            $publicUrl"
  Write-Host "Clave de anfitrión:  $hostKey"
  Write-Host ''
  Write-Host 'En la app (anfitrión): Ajustes -> pega el Servidor y la Clave de anfitrión -> Guardar.'
  Write-Host 'La invitada NO necesita la clave: el enlace de invitación ya incluye el servidor.'
  Write-Host 'Ctrl+C para detener.'
  Write-Host '============================================================' -ForegroundColor Green
  while (-not $backend.HasExited -and ($NoTunnel -or -not $tunnel.HasExited)) { Start-Sleep -Seconds 2 }
  if ($backend.HasExited) {
    Write-Warning "El backend se detuvo (código $($backend.ExitCode)). Últimas líneas del registro:"
    Show-LogTail $backendLog
  } else {
    Write-Warning 'El túnel de Cloudflare se cortó. Últimas líneas:'
    Show-LogTail (Join-Path $dataDir 'tunnel.log')
  }
}
finally {
  foreach ($p in @($tunnel, $backend)) {
    if ($p) { Stop-Tree $p.Id } # árbol completo: también el Java hijo
  }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
  Write-Host 'Servidor detenido.'
}
