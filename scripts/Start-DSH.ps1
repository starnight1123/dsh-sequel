# 启动 DSH Web 并打开浏览器
# 用法：双击桌面“启动DSH”快捷方式，或直接运行本脚本
$ErrorActionPreference = 'Stop'

$Port = 3080
$Url = "http://127.0.0.1:$Port"
$DshDir = 'C:\Users\admin\deepseek-harness'
$LogFile = Join-Path $env:USERPROFILE 'dsh-web.log'

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
  Write-Host 'DSH 未运行，正在启动...' -ForegroundColor Cyan
  $cmdArgs = "/c cd /d `"$DshDir`" && pnpm dsh web >> `"$LogFile`" 2>&1"
  Start-Process -FilePath 'cmd.exe' -ArgumentList $cmdArgs -WindowStyle Minimized

  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 1000
    if (Test-DshPort -PortNumber $Port) { break }
  }
}

if (-not (Test-DshPort -PortNumber $Port)) {
  Write-Host "DSH 启动超时，请查看日志：$LogFile" -ForegroundColor Red
  if (Test-Path $LogFile) {
    Start-Process $LogFile
  }
  exit 1
}

Write-Host "DSH 已就绪，正在打开 $Url" -ForegroundColor Green
Start-Process $Url
