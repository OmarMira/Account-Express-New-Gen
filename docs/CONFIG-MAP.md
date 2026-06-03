# 🗺️ Mapa de Configuración Externa (Config-Driven)
**Principio:** Cero hardcode en lógica. Toda regla, umbral o layout se controla vía JSON versionado.  
**Ubicación:** `rules/*.json` | **Respaldo:** Incluido automáticamente en snapshots V1.3

| Archivo | Módulo | Parámetros Clave | Impacto en Negocio | Procedimiento de Actualización |
|---------|--------|------------------|-------------------|-------------------------------|
| `bank-mapping.json` | Clasificación Automática | `rules[].pattern`, `glAccountCode`, `type` | Asigna ingresos/gastos/pagos a cuentas reales. Define % de automatización. | Editar patrón regex → Incrementar `version` → Ejecutar `classify-drafts.ts` |
| `suspense-mappings.json` | Excepciones (9999) | `{pattern}: {glAccountCode, description}` | Resuelve ítems no clasificados. Evita distorsión en Balanza. | Agregar patrón faltante → `classify-suspense-drafts.ts` → Validar cuadre |
| `dashboard-config.json` | KPIs y Tendencias | `alertThresholds.balanceMismatchTolerance`, `refreshIntervalMs` | Controla tolerancia de descuadre y frecuencia de polling. | Ajustar umbral → Recargar UI. Sin impacto en DB. |
| `backup-config.json` | Respaldo/Restore | `retentionDays`, `compression`, `preBackupCheckpoints` | Define política de retención, compresión y consistencia WAL. | Modificar → `backup-system.ts` aplica automáticamente. |
| `reconciliation-ui.json` | Conciliación Visual | `layout.splitViewRatio`, `matching.fuzzyThreshold`, `actions.blockActionsOnLockedPeriods` | Controla UX, umbrales de auto-match y bloqueo en períodos cerrados. | Editar → UI se adapta en caliente. Cero redeploy. |
| `budget-config.json` | Presupuestos vs Real | `alertThresholds.variancePercent`, `fiscalStartMonth` | Activa alertas cuando gasto real supera presupuesto X%. | Ajustar % → `assistant-engine.ts` recalcula varianza. |
| `rbac-config.json` | Control de Acceso | `permissions.{resource}.{action}`, `security.blockCrossTenantAccess` | Define qué rol puede crear, postear, exportar o restaurar. | Modificar permisos → Reiniciar servicio o invalidar cache. |
| `predictive-recon.json` | Sugerencias Locales | `confidenceThreshold`, `weights.{amount,date,description}`, `autoSuggestEnabled` | Afecta precisión y frecuencia de sugerencias de conciliación. | Ajustar pesos → `predictive-engine.ts` recalcula scores. |
| `assistant-config.json` | Asistente Contextual | `healthChecks.*`, `templates.executiveSummary`, `queryLimits.maxHistoryMonths` | Controla alertas proactivas, plantillas de resumen y límites de consulta. | Editar plantillas/umbrales → Insights se regeneran en 5 min. |
| `security-config.json` | Hardening V3.0 | `rateLimit.criticalEndpoints`, `ipAllowlist.enabled`, `securityHeaders` | Define límites de petición, headers de seguridad y políticas de IP. | Ajustar RPM → Rate-limiter aplica en caliente. |
| `learning-engine.json` | Motor Adaptativo | `minOccurrencesToGenerateRule`, `autoApplyRules`, `patternGeneration.safeRegexCharsOnly` | Controla cuándo el sistema genera reglas candidatas desde feedback humano. | Cambiar umbral → `regenerate-rules.ts` ajusta salida. |
| `import-config.json` | Importaciones Bancarias | `accountHolderValidation.{enabled,threshold,strictMode}` | Controla validación difusa de titular de cuenta, umbral y modo de bloqueo estricto en importación. | Incrementar `version` → La validación y UI se adaptan instantáneamente. |

## 🔒 Reglas de Gobierno de Configuración
1. **Versionado Obligatorio:** Cada archivo debe incrementar `"version"` al modificar parámetros críticos.
2. **Backup Pre-Cambio:** Ejecutar `bun run scripts/backup-system.ts` antes de editar reglas de clasificación o seguridad.
3. **Validación Post-Cambio:** Ejecutar `bun run scripts/run-full-cycle-check.ts` tras modificar `bank-mapping.json` o `rbac-config.json`.
4. **Prohibido:** Hardcodear patrones, umbrales o rutas en `.ts`/`.tsx`. Todo debe referenciar `rules/*.json`.
5. **Auditoría:** Cada lectura de configuración registra `configVersion` en `AuditLog` para trazabilidad forense.

## 📦 Integración con CI/CD
- Workflow valida que todos los JSON sean parseables y contengan `"version"`.
- Merge bloqueado si algún archivo tiene sintaxis inválida o versión duplicada.
- Despliegue seguro: Configuración se carga en runtime, nunca se compila en bundle.

---

## 📊 Sentry APM Configuration

### Architecture
- `src/instrumentation-client.ts`: Client-side Sentry initialization (native client entry point)
- `src/instrumentation.ts`: Inlined Node.js & Edge Sentry initialization (runtime conditional check) + `onRequestError` hook

### Critical: onRequestError Hook
The `onRequestError` export in `instrumentation.ts` is **mandatory** for capturing API route errors. Without it, errors in `/api/*` routes will not be reported to Sentry.

### Environment Variables
```env
NEXT_PUBLIC_SENTRY_DSN=https://your-key@sentry.io/your-project-id
SENTRY_DSN=https://your-key@sentry.io/your-project-id
SENTRY_AUTH_TOKEN=sntrys_your_auth_token_here
```
