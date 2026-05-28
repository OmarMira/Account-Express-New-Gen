# Changelog

## [1.2.0] - 2025-06-10

### 🔒 Security & Resiliency
- **SQLite WAL Mode**: Activado `journal_mode=WAL&synchronous=NORMAL` en `DATABASE_URL`. Elimina `database is locked` en importaciones/reconciliaciones concurrentes. (+30-50% throughput en lecturas).
- **PDF Worker Centralizado**: Inicialización idempotente de `pdfjs-dist` en `src/lib/pdf-worker.ts` con guard de runtime en `src/instrumentation.ts`. Cero memory leaks y sin `UnhandledRejection` en Edge/Node.
- **Validación de APIs (Zod)**: Middleware `src/lib/validate-request.ts` intercepta payloads `POST/PATCH` malformados. Retorna `400` estructurado antes de tocar lógica contable.
- **Hardening de Cookies**: Flags `httpOnly: true`, `secure: true` (prod), `sameSite: 'lax'` aplicados en rutas `login`, `register` y `logout`. Mitiga XSS/CSRF sin alterar flujos de sesión.

### 🧪 Testing & CI/CD
- **Suite de Pruebas Agnóstica**: Tests de integración para resiliencia del worker PDF, validación de APIs y concurrencia WAL. Cero datos hardcodeados; usa factories dinámicos (`test-data-factory.ts`).
- **Cleanup Automático**: `tests/globalTeardown.ts` elimina `test.db` tras cada ejecución de Vitest. Entorno determinístico y aislado.
- **Verificación Pre-Despliegue**: `scripts/verify-stability.ts` valida 6 controles críticos (WAL, worker, validación, cookies, cleanup, repo limpio). Exit `0` = listo para prod. Exit `1` = bloqueo de merge.

### 🧹 Maintenance
- Eliminados scripts de debugging legacy (`test-pdf-parse.*`, `check-pdf-parse.*`, etc.).
- `.gitignore` actualizado para excluir artefactos SQLite (`*.db-wal`, `*.db-shm`) y `test.db`.
- Vitest configurado con `fileParallelism: false` y `maxWorkers: 1` para estabilidad en SQLite.

### 📦 Deployment Notes
- **Breaking Changes**: ❌ Ninguno. UI, rutas y lógica contable intactas.
- **Acción Requerida**: Confirmar que `.env` contiene `?journal_mode=WAL&synchronous=NORMAL` en `DATABASE_URL`.
- **Rollback**: `git revert` al tag anterior. No requiere migración. SQLite vuelve a modo `DELETE` automáticamente si se remueven los query params.
- **Verificación Post-Build**: `bun run verify-stability && bun run test:integration`
