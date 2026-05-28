# 📘 Manual de Operaciones Contables (V3.0)
**Empresa:** LQ&OM LLC | **Banco:** Bank of America Checking (****3224) | **Base:** SQLite/Prisma Inmutable  
**Uso:** Interno únicamente. No válido para presentación ante entidades gubernamentales o fiscales.

## 🔹 Flujo Diario Estándar
1. **Importar Extractos** → `POST /api/import` con PDFs/CSV. Validar cadena de saldos (`closingBalance[i] == openingBalance[i+1]`).
2. **Generar Borradores** → Conversión automática a `JournalEntry (status: 'draft', glAccount: '9999')`.
3. **Clasificación Automática** → Aplicar `rules/bank-mapping.json`. Revisar `rules/suspense-mappings.json` para excepciones.
4. **Revisión UI** → Validar asientos en `DraftReview`. Ajustar manualmente ítems sin regla o confianza <70%.
5. **Posteo Atómico** → Cambiar `status: 'draft' → 'posted'`. Registrar `AuditLog: DRAFTS_POSTED`.
6. **Conciliación** → Match automático `BankTransaction ↔ Posted JournalLine` (umbral ≥85%, monto ±$0.01). Marcar `isReconciled: true`.

## 🔹 Cierre de Período (Mensual)
1. Ejecutar `bun run scripts/run-full-cycle-check.ts`. Todos los gates deben retornar `PASS`.
2. Bloquear período fiscal: `PATCH /api/fiscal-periods/{id}` → `isLocked: true`.
3. Generar reportes: Trial Balance, P&L, Balance General vía `/api/reports/export`. Firmados con SHA-256.
4. Backup automático: `bun run scripts/backup-system.ts`. Verificar hash en `.meta.json`.

## 🔹 Manejo de Excepciones (Suspense 9999)
- Ítems no clasificados permanecen en `draft` con cuenta `9999`. **Nunca impactan Balanza ni P&L**.
- Clasificar vía UI o actualizar `rules/suspense-mappings.json` → `bun run scripts/classify-suspense-drafts.ts`.
- Validar cuadre final: `Saldo GL (1010) == Saldo PDF`. Tolerancia máxima: `$0.01`.

## 🔹 Procedimiento de Restore (Recuperación)
1. Identificar snapshot: `ls -lh backups/ | grep .db.gz`.
2. Validar integridad: `bun run scripts/validate-restore.ts <ruta-snapshot>`.
3. Aplicar restore atómico: `bun run scripts/restore-system.ts <ruta-snapshot>`.
4. Verificar gates: `bun run scripts/run-full-cycle-check.ts` debe retornar `PRODUCTION_READY`.
5. Registrar acción: `AuditLog` automáticamente crea `BACKUP_RESTORED`.

## 🔹 Monitoreo y Alertas
- Health endpoint: `GET /api/health` → Verificar `status: 'healthy'`, `database: 'connected'`.
- Asistente Contextual (V2.4): Alertas automáticas por varianza presupuestaria >15%, ítems no conciliados >5, o tendencia de flujo negativa.
- Rate Limiting: Headers `X-RateLimit-*` en respuestas. Violaciones registradas en `AuditLog`.

## 🔹 Cumplimiento y Seguridad
- Schema inmutable: Cero `prisma migrate` en producción.
- RBAC: Solo `super_admin` restaura backups o cierra ejercicios. `accountant` clasifica y postea. `viewer` solo lectura.
- Auditoría: Toda acción crítica registra `userId`, `timestamp`, `details`, `confidenceScore` (si aplica).
- Reportes: Uso interno exclusivo. Hash SHA-256 embebido para integridad.
