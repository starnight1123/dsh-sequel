# Start DSH Web and open browser.
# Usage: double-click the desktop shortcut "Start DSH" or run this script directly.
$ErrorActionPreference = 'Stop'

$Port = 3080
$Url = "http://127.0.0.1:$Port"
$DshDir = 'C:\Users\admin\deepseek-harness'
$LogFile = Join-Path $env:USERPROFILE 'dsh-web.log'
$WaitSeconds = 180

function Test-DshPort {
  param([int]$PortNumber)
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $async = $client.BeginConnect('127.0.0.1', $PortNumber, $null, $null)
    if ($async.AsyncWaitHandle.WaitOne(1000)) {
      $client.EndConnect($async)
      return $true
    }
    return $false
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

if (-not (Test-DshPort -PortNumber $Port)) {
  Write-Host 'DSH is not running, starting...' -ForegroundColor Cyan
  $cmdLine = "cd /d `"$DshDir`" && pnpm dsh web >> `"$LogFile`" 2>&1"
  Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $cmdLine) -WindowStyle Minimized

  $deadline = (Get-Date).AddSeconds($WaitSeconds)
  $elapsed = 0
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 1
    $elapsed++
    if (Test-DshPort -PortNumber $Port) { break }
    if ($elapsed % 10 -eq 0) {
      Write-Host "Waiting for DSH... $elapsed seconds" -ForegroundColor DarkGray
    }
  }
}

if (-not (Test-DshPort -PortNumber $Port)) {
  Write-Host "DSH start timeout (${WaitSeconds}s), check log: $LogFile" -ForegroundColor Red
  if (Test-Path $LogFile) {
    Start-Process $LogFile
  }
  Write-Host 'Press Enter to exit...' -ForegroundColor DarkGray
  Read-Host | Out-Null
  exit 1
}

Write-Host "DSH is ready, opening $Url" -ForegroundColor Green
Start-Process $Url
Start-Sleep -Seconds 1
