#!/usr/bin/env bash
set -euo pipefail

# 🎨 Colores para salida legible
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}🚀 Account Express New Gen — Staging Deployment${NC}"
echo "=================================================="

# 🛡️ 1. Guard de seguridad: Bloquear ejecución accidental en producción
if [[ "${NODE_ENV:-}" == "production" ]]; then
  echo -e "${RED}❌ ERROR: Este script NO debe ejecutarse en producción. Usa tu pipeline de CI/CD.${NC}"
  exit 1
fi

# 🔍 2. Pre-flight checks
command -v bun >/dev/null 2>&1 || { echo -e "${RED}❌ bun requerido. Instálalo antes de continuar.${NC}"; exit 1; }
[ -f ".env.staging" ] || { echo -e "${RED}❌ .env.staging no encontrado. Cópialo desde .env.example y configúralo.${NC}"; exit 1; }

# 📥 3. Cargar variables de staging
set -a; source .env.staging; set +a
export NODE_ENV="${NODE_ENV:-staging}"
export DATABASE_URL="${DATABASE_URL:-file:./staging.db}"
export PORT="${PORT:-3001}"

echo -e "${YELLOW}🔧 Entorno: $NODE_ENV | DB: $DATABASE_URL | Puerto: $PORT${NC}"

# 🛑 4. Gates de Calidad Obligatorios
echo -e "${YELLOW}🛡️ Ejecutando gates de calidad (fallos = aborto seguro)...${NC}"
bun x tsc --noEmit || { echo -e "${RED}❌ Type check falló${NC}"; exit 1; }
bun run scripts/verify-stability.ts || { echo -e "${RED}❌ verify-stability falló${NC}"; exit 1; }
bun x vitest run || { echo -e "${RED}❌ Vitest falló${NC}"; exit 1; }
bun run scripts/run-full-cycle-check.ts || { echo -e "${RED}❌ Ciclo contable end-to-end falló${NC}"; exit 1; }
echo -e "${GREEN}✅ Todos los gates pasaron${NC}"

# 🗄️ 5. Sincronización de DB (Staging aislado)
echo -e "${YELLOW}📐 Sincronizando Prisma schema (staging isolated)...${NC}"
DATABASE_URL="$DATABASE_URL" bun x prisma db push --accept-data-loss
echo -e "${GREEN}✅ Schema sincronizado${NC}"

# 📦 6. Build Standalone
echo -e "${YELLOW}🏗️ Compilando build standalone...${NC}"
NODE_ENV="$NODE_ENV" DATABASE_URL="$DATABASE_URL" bun run build
echo -e "${GREEN}✅ Build completado${NC}"

# 🔹 Copiar reglas contables al bundle standalone para evitar ENOENT
echo -e "${YELLOW}📁 Copiando reglas contables (rules/) al bundle standalone...${NC}"
mkdir -p .next/standalone/rules/
cp -r rules/* .next/standalone/rules/
echo -e "${GREEN}✅ rules/ empaquetadas en standalone${NC}"

# 🌐 7. Inicio del servidor
echo -e "${GREEN}🌐 Iniciando servidor staging en http://localhost:$PORT${NC}"
echo -e "${YELLOW}⚠️  VALIDACIÓN SEMÁNTICA Y FORMULARIOS FISCALES: Responsabilidad EXCLUSIVA del CPA matriculado.${NC}"
echo -e "${YELLOW}💡 ROLLBACK RÁPIDO: git revert HEAD && bun run build && bun run start${NC}"
echo -e "${YELLOW}📋 HEALTH CHECK: curl -f http://localhost:$PORT/api/health${NC}"

# Ejecuta en primer plano para capturar logs y permitir Ctrl+C
exec NODE_ENV="$NODE_ENV" DATABASE_URL="$DATABASE_URL" PORT="$PORT" bun .next/standalone/server.js
