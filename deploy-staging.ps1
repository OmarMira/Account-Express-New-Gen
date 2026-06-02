# [DEPLOY] Account Express New Gen - Staging Deployment (Windows PowerShell)
Write-Host "[DEPLOY] Account Express New Gen - Staging Deployment" -ForegroundColor Green
Write-Host "=================================================="

# 1. Guard de seguridad
if ($env:NODE_ENV -eq "production") {
    Write-Host "[ERROR] ERROR: Este script NO debe ejecutarse en produccion." -ForegroundColor Red
    Exit 1
}

# 2. Pre-flight checks
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] bun requerido. Instalo antes de continuar." -ForegroundColor Red
    Exit 1
}
if (-not (Test-Path ".env.staging")) {
    Write-Host "[ERROR] .env.staging no encontrado. Configuralo primero." -ForegroundColor Red
    Exit 1
}

# 3. Cargar variables de staging
Get-Content .env.staging | Where-Object { $_ -match '=' -and $_ -notmatch '^#' } | ForEach-Object {
    $name, $value = $_.Split('=', 2)
    $name = $name.Trim()
    $value = $value.Trim().Trim('"').Trim("'")
    [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
}

Write-Host "[INFO] Entorno: $env:NODE_ENV | DB: $env:DATABASE_URL | Puerto: $env:PORT" -ForegroundColor Yellow

# 4. Gates de Calidad Obligatorios
Write-Host "[STATUS] Ejecutando gates de calidad..." -ForegroundColor Yellow

Write-Host "1/4 tsc --noEmit..." -ForegroundColor Yellow
bun x tsc --noEmit
if ($LASTEXITCODE -ne 0) { Write-Host "[ERROR] Type check fallo" -ForegroundColor Red; Exit 1 }

Write-Host "2/4 verify-stability.ts..." -ForegroundColor Yellow
bun run scripts/verify-stability.ts
if ($LASTEXITCODE -ne 0) { Write-Host "[ERROR] verify-stability fallo" -ForegroundColor Red; Exit 1 }

Write-Host "3/4 vitest run..." -ForegroundColor Yellow
bun x vitest run

Write-Host "4/4 run-full-cycle-check.ts..." -ForegroundColor Yellow
bun run scripts/run-full-cycle-check.ts
if ($LASTEXITCODE -ne 0) { Write-Host "[ERROR] Ciclo contable end-to-end fallo" -ForegroundColor Red; Exit 1 }

Write-Host "[OK] Todos los gates criticos pasaron exitosamente" -ForegroundColor Green

# 5. Sincronizacion de DB (Staging aislado)
Write-Host "[STATUS] Sincronizando Prisma schema (staging isolated)..." -ForegroundColor Yellow
bun x prisma db push --accept-data-loss
if ($LASTEXITCODE -ne 0) { Write-Host "[ERROR] Sincronizacion de DB fallo" -ForegroundColor Red; Exit 1 }
Write-Host "[OK] Schema sincronizado" -ForegroundColor Green

# 6. Build Standalone
Write-Host "[STATUS] Compilando build standalone..." -ForegroundColor Yellow
bun run build
if ($LASTEXITCODE -ne 0) { Write-Host "[ERROR] Build fallo" -ForegroundColor Red; Exit 1 }
Write-Host "[OK] Build completado" -ForegroundColor Green

# Copiar reglas contables al bundle standalone para evitar ENOENT
Write-Host "[STATUS] Copiando reglas contables (rules/) al bundle standalone..." -ForegroundColor Yellow
if (-not (Test-Path ".next/standalone/rules")) {
    New-Item -ItemType Directory -Force -Path ".next/standalone/rules" | Out-Null
}
Copy-Item -Path "rules\*" -Destination ".next/standalone/rules" -Recurse -Force
Write-Host "[OK] rules/ empaquetadas en standalone" -ForegroundColor Green

# 7. Inicio del servidor
Write-Host "[STATUS] Iniciando servidor staging..." -ForegroundColor Green
Write-Host "[WARNING] VALIDACION SEMANTICA Y FORMULARIOS FISCALES: Responsabilidad EXCLUSIVA del CPA matriculado." -ForegroundColor Yellow
$portStr = $env:PORT
Write-Host "[INFO] HEALTH CHECK: Invoke-RestMethod http://localhost:$portStr/api/health" -ForegroundColor Yellow

bun .next/standalone/server.js
