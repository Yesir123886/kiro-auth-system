<#
.SYNOPSIS
  ANGEL 云参数一键同步部署脚本
.DESCRIPTION
  从 Gitee 仓库拉取最新 公益.json / 皇参.json 并部署到 Cloudflare Pages
.NOTES
  仓库: gitee.com/yesirsadad/cloud-parameter-update
  部署: Cloudflare Pages (pd) → pd-but.pages.dev
#>

param(
    [switch]$SkipDeploy  # 仅拉取参数，不触发部署
)

$ErrorActionPreference = "Stop"
$ProjectRoot  = "F:\McaroPD\kiro-auth-system"
$GiteeRepo    = "https://gitee.com/yesirsadad/cloud-parameter-update.git"
$TempClone    = "$env:TEMP\cloud-parameter-update-sync"
$PagesProject = "pd"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  ANGEL 云参数一键同步部署" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. 拉取最新参数 ──
Write-Host "[1/3] 从 Gitee 拉取最新参数..." -ForegroundColor Yellow

if (Test-Path $TempClone) {
    Remove-Item -Recurse -Force $TempClone
}

git clone --depth 1 $GiteeRepo $TempClone 2>&1 | Out-Null

if (-not $?) {
    Write-Host "✗ Git clone 失败！请检查网络连接" -ForegroundColor Red
    exit 1
}

$pubSize  = (Get-Item "$TempClone\公益.json").Length
$paidSize = (Get-Item "$TempClone\皇参.json").Length

Write-Host "  ✓ 公益.json  $pubSize bytes" -ForegroundColor Green
Write-Host "  ✓ 皇参.json  $paidSize bytes" -ForegroundColor Green

# ── 2. 复制到项目 ──
Write-Host "[2/3] 复制参数文件到项目..." -ForegroundColor Yellow

Copy-Item -Force "$TempClone\公益.json" "$ProjectRoot\公益.json"
Copy-Item -Force "$TempClone\皇参.json" "$ProjectRoot\皇参.json"

Write-Host "  ✓ 参数文件已更新" -ForegroundColor Green

# ── 清理临时文件 ──
Remove-Item -Recurse -Force $TempClone

# ── 3. 部署 ──
if ($SkipDeploy) {
    Write-Host "[3/3] 跳过部署（--SkipDeploy）" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "参数文件已同步到本地，手动部署：" -ForegroundColor White
    Write-Host "  cd F:\McaroPD\kiro-auth-system" -ForegroundColor Gray
    Write-Host "  npx wrangler pages deploy . --project-name=pd --branch=master" -ForegroundColor Gray
    exit 0
}

Write-Host "[3/3] 部署到 Cloudflare Pages..." -ForegroundColor Yellow

Push-Location $ProjectRoot
try {
    npx wrangler pages deploy . --project-name=$PagesProject --branch=master 2>&1
    if ($?) {
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "  ✓ 部署成功！" -ForegroundColor Green
        Write-Host "  🔗 https://pd-but.pages.dev" -ForegroundColor Cyan
        Write-Host "========================================" -ForegroundColor Green
    } else {
        throw "wrangler deploy failed"
    }
} catch {
    Write-Host ""
    Write-Host "✗ 部署失败: $_" -ForegroundColor Red
    Write-Host "  参数文件已在本地更新，请手动部署或检查 wrangler 登录状态" -ForegroundColor Yellow
} finally {
    Pop-Location
}

Write-Host ""
