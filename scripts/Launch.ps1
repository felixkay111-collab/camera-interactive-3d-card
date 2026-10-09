param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$birthdayNode = Join-Path $projectRoot 'runtime/node.exe'
if (-not (Test-Path -LiteralPath $birthdayNode)) {
    Write-Host '运行工具缺失，请重新下载 Windows 免安装版，并完整解压后再启动。'
    Write-Host '请保留 runtime 文件夹，不要把“启动.bat”单独移走。'
    exit 1
}
try {
    $nodeVersion = & $birthdayNode --version
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 20) {
        throw '随包运行工具无法运行，请重新下载 Windows 64 位免安装版。'
    }
    Write-Host '正在打开贺卡，请保留此窗口。关闭窗口会停止网页服务。'
    if ($NoBrowser) { & $birthdayNode (Join-Path $projectRoot 'app/server.mjs') }
    else { & $birthdayNode (Join-Path $projectRoot 'app/server.mjs') --open }
    exit $LASTEXITCODE
} catch {
    Write-Host ('启动失败：' + $_.Exception.Message)
    Write-Host '请查看 README.md 中的说明，或 docs 文件夹里的常见问题。'
    exit 1
}
