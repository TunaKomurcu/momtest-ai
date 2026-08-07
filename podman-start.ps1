# =============================================================================
# MomTest AI — Podman başlatma scripti (Windows PowerShell)
# =============================================================================
param(
    [ValidateSet("up","down","logs","rebuild")]
    [string]$Action = "up"
)

$ErrorActionPreference = "Stop"

Write-Host "==> MomTest AI — Podman Baslatiyor" -ForegroundColor Green

# WSL/Podman makinesi IP'sini al ve Windows port proxy kur
function Set-PodmanPortProxy {
    param([int]$Port)
    try {
        $wslIp = (podman machine ssh "ip -4 addr show eth0 | grep -oP '(?<=inet\s)\d+(\.\d+){3}'" 2>$null).Trim()
        if (-not $wslIp) { return }
        Write-Host "   WSL IP: $wslIp — port proxy kuruluyor..." -ForegroundColor Cyan
        $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        if ($isAdmin) {
            netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$Port 2>$null | Out-Null
            netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=$Port connectaddress=$wslIp connectport=$Port | Out-Null
            Write-Host "   Port proxy hazir: localhost:$Port -> $wslIp:$Port" -ForegroundColor Green
        } else {
            Write-Host "   NOT: Port proxy icin scripti Admin olarak calistirin veya su komutu admin PS'de calistirin:" -ForegroundColor Yellow
            Write-Host "   netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=$Port connectaddress=$wslIp connectport=$Port" -ForegroundColor Cyan
        }
    } catch { <# sessizce devam #> }
}

# .env.local kontrolü
if (-not (Test-Path ".env.local")) {
    Write-Host "⚠  .env.local bulunamadi. .env.example'dan kopyalaniyor..." -ForegroundColor Yellow
    Copy-Item ".env.example" ".env.local"
    Write-Host "✖  Lutfen .env.local dosyasini duzenleyin (LLM_API_KEY, vs.) ve tekrar calistirin." -ForegroundColor Red
    exit 1
}

# podman-compose veya podman compose tespiti
$ComposeCmd = $null

if (Get-Command "podman-compose" -ErrorAction SilentlyContinue) {
    $ComposeCmd = "podman-compose"
} elseif (Get-Command "podman" -ErrorAction SilentlyContinue) {
    # podman compose eklentisi var mı?
    $result = & podman compose version 2>&1
    if ($LASTEXITCODE -eq 0) {
        $ComposeCmd = "podman compose"
    }
}

if (-not $ComposeCmd) {
    # docker compose fallback
    if (Get-Command "docker" -ErrorAction SilentlyContinue) {
        Write-Host "ℹ  podman bulunamadi, docker compose kullaniliyor..." -ForegroundColor Yellow
        $ComposeCmd = "docker compose"
    } else {
        Write-Host "✖  Ne podman ne de docker bulunamadi. Lutfen Podman Desktop kurun:" -ForegroundColor Red
        Write-Host "   https://podman-desktop.io/" -ForegroundColor Cyan
        exit 1
    }
}

Write-Host "==> Kullanilan komut: $ComposeCmd" -ForegroundColor Green

switch ($Action) {
    "up" {
        Write-Host "==> Container'lar baslatiliyor (build dahil)..." -ForegroundColor Green
        Invoke-Expression "$ComposeCmd up --build -d"
        Set-PodmanPortProxy -Port 3000
        Write-Host "✔  Uygulama calistirildi: http://localhost:3000" -ForegroundColor Green
        Write-Host "   Loglar icin: .\podman-start.ps1 logs" -ForegroundColor Cyan
    }
    "down" {
        Write-Host "==> Container'lar durduruluyor..." -ForegroundColor Yellow
        Invoke-Expression "$ComposeCmd down"
    }
    "logs" {
        Invoke-Expression "$ComposeCmd logs -f app"
    }
    "rebuild" {
        Write-Host "==> Sifirdan build aliniyor..." -ForegroundColor Yellow
        Invoke-Expression "$ComposeCmd down"
        Invoke-Expression "$ComposeCmd build --no-cache"
        Invoke-Expression "$ComposeCmd up -d"
        Set-PodmanPortProxy -Port 3000
        Write-Host "✔  Uygulama calistirildi: http://localhost:3000" -ForegroundColor Green
    }
}
