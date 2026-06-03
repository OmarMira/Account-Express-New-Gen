# ✅ Checklist de Go-Live (V3.0 Hardened)
**Estado objetivo:** `PRODUCTION_READY` | **Validación:** Gates bloqueantes + auditoría inmutable

## 🌍 Entorno y Secrets
- [ ] `DATABASE_URL` apunta a archivo SQLite válido (`file:./prisma/prod.db`)
- [ ] `COMPANY_ID` configurado y coincide con scope de datos reales
- [x] `APP_VERSION` = `3.0.0` o superior
- [ ] Secrets de CI/CD (`DATABASE_URL`, `COMPANY_ID`, `APP_VERSION`) activos en GitHub Actions

## 🗄️ Base de Datos y Schema
- [ ] `schema.prisma` sin migraciones pendientes (`npx prisma migrate status` → `Schema is in sync`)
- [ ] Índices optimizados: `JournalLine(entryId, glAccountId) (date is on parent JournalEntry)`, `BankTransaction(statementId, isReconciled)`
- [x] `PRAGMA journal_mode=WAL` activo para concurrencia segura

## 🔐 Seguridad y RBAC
- [ ] `rules/rbac-config.json` cargado y versionado (`"version": "1.0"`)
- [ ] Roles probados: `super_admin` (acceso total), `admin` (operativo), `accountant` (clasificación/posteo), `viewer` (solo lectura)
- [ ] Endpoints críticos (`/api/admin/backup`, `/api/reports/export`) restringidos por rol y rate-limit
- [x] Headers de seguridad activos: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security`

## ⚡ Rendimiento y Rate Limiting
- [ ] `rules/security-config.json` con límites por endpoint (`/api/reports/export: 15 RPM`, `/api/admin/backup: 5 RPM`)
- [ ] Rate-limiter responde con `429` y headers `Retry-After`, `X-RateLimit-*` al exceder umbrales
- [x] Health endpoint (`/api/health`) retorna `200` con métricas coherentes (`database: connected`, `lastBackupAt` válido)

## 🔄 CI/CD y Gates Automáticos
- [ ] Workflow `.github/workflows/ci-cd.yml` activo y pasando en `main`
- [x] Gates validados: `TYPE_SAFETY`, `CYCLE_INTEGRITY`, `TENANT_ISOLATION`, `PREDICTIVE_ENGINE`, `ASSISTANT_LOGIC`, `LEARNING_LOOP`, `BUDGET_VARIANCE`
- [ ] Merge bloqueado si algún gate falla (`continue-on-error: false`)

## 💾 Backup y Recuperación
- [x] Backup inicial ejecutado: `bun run scripts/backup-system.ts` → genera `.db.gz` + `.meta.json`
- [x] Restore validado en entorno aislado: `bun run scripts/validate-restore.ts` → `PRAGMA integrity_check: ok` + 7/7 gates PASS
- [ ] Retención configurada: `rules/backup-config.json` → `retentionDays: 90`

## 📝 Auditoría y Trazabilidad
- [x] `AuditLog` registra acciones críticas: `IMPORTED`, `CLASSIFIED`, `POSTED`, `RECONCILED`, `BACKUP_CREATED`, `RATE_LIMIT_VIOLATION`
- [ ] Cero registros huérfanos o sin `companyId`
- [ ] Hash de integridad en reportes exportados coincide con header `X-Integrity-Hash`

## 🟢 Firma de Go-Live
- [ ] Ciclo contable cerrado (Ene-May 2025) con cuadre perfecto: `$13,395.11 = $13,395.11`
- [ ] Documentación operativa y mapa de configuración desplegados en `docs/`
- [ ] Responsable de despliegue: ___________________ | Fecha: __/__/____
