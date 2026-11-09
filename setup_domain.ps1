# -*- coding: utf-8 -*-
$ErrorActionPreference = "SilentlyContinue"

# 1. Check Administrator privileges, auto-elevate if not admin
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

$hostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
$content = Get-Content -Path $hostsPath -Raw -Encoding UTF8

$entries = @(
    "127.0.0.1 yuanhe.com",
    "127.0.0.1 www.yuanhe.com",
    "127.0.0.1 admin.yuanhe.com"
)

$added = $false
foreach ($entry in $entries) {
    $domain = ($entry -split "\s+")[1]
    if ($content -notmatch "(?m)^\s*127\.0\.0\.1\s+$([regex]::Escape($domain))\b") {
        Add-Content -Path $hostsPath -Value "`r`n$entry" -Encoding ASCII
        $added = $true
    }
}

ipconfig /flushdns | Out-Null

Write-Host "=========================================================" -ForegroundColor Green
Write-Host "  [成功] 已将 http://yuanhe.com 绑定至河北元赫官网！" -ForegroundColor Green
Write-Host "  - 消费者官方网站: http://yuanhe.com" -ForegroundColor Cyan
Write-Host "  - 商家管理后台  : http://yuanhe.com/merchant.html" -ForegroundColor Yellow
Write-Host "=========================================================" -ForegroundColor Green

Start-Process "http://yuanhe.com"
Start-Sleep -Seconds 3
