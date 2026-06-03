# Account Express — Handover & Post-Launch Guide

## 🎯 Arquitectura Actual
| Capa | Tecnología | Estado |
|------|------------|--------|
| Frontend | Next.js 16 + React 19 + Tailwind v4 + shadcn/ui | ✅ SPA, i18n, Dark/Light |
| Backend | App Router API + Prisma + SQLite (WAL) | ✅ Serverless/Node compatible |
| Parseo | `pdfjs-dist` (worker dinámico) + `pdf-parse` | ✅ Agnóstico a banco/formato |
| Estado | Zustand + TanStack Query | ✅ Client/Server sync |
| Observabilidad | Sentry APM + `/api/health` + `/api/metrics` | ✅ Logs estructurados |

---

## 🚀 Checklist de Despliegue
1. ✅ `.env` configurado (`DATABASE_URL` con WAL, `SESSION_SECRET`, `AUDIT_HMAC_SECRET`)
2. ✅ `bun run verify-stability` → Exit `0`
3. ✅ `bun run build` → Standalone output en `.next/standalone`
4. ✅ Iniciar: `NODE_ENV=production bun .next/standalone/server.js`
5. ✅ Validar: `curl http://localhost:3000/api/health` → `{"status":"healthy"}`

---

## 📊 Monitoreo Post-Lanzamiento (24-48h)
| Métrica | Umbral Aceptable | Dónde Verificar |
|---------|------------------|-----------------|
| `database is locked` | 0 ocurrencias | Logs Prisma / Sentry |
| Workers PDF huérfanos | 0 procesos | Output `bun run dev` / `ps aux` |
| Errores 400 validación | < 1% tráfico | `/api/metrics` o Sentry |
| Latencia `parsePDF` (p95) | < 800ms | APM / Sentry Traces |
| Cookie flags | `HttpOnly`, `SameSite=Lax` | DevTools > Application > Cookies |

---

## 🔧 Troubleshooting Rápido
| Síntoma | Causa Probable | Solución |
|---------|----------------|----------|
| `Worker not found` al importar PDF | `initPdfWorker()` no se ejecutó | Verificar `instrumentation.ts` + `NEXT_RUNTIME === 'nodejs'` |
| `database is locked` en conciliación | WAL no activo o múltiples writers sin retry | Confirmar `DATABASE_URL` contiene `?journal_mode=WAL` y que las escrituras usen `createAuditLogWithRetry` |
| `400 Validation failed` en API | Payload malformado o schema desactualizado | Revisar `src/lib/validations/` vs payload real |
| Sesión expira prematuramente | `maxAge` bajo o `secure: true` en HTTP local | Ajustar `login/route.ts` → `maxAge: 604800` |
| Build falla por `module not found` | `serverExternalPackages` incompleto | Añadir `pdf-parse`, `pdfjs-dist`, `bcryptjs` en `next.config.ts` |
| Sentry no captura errores de API | Falta exportar `onRequestError` | Confirmar `export const onRequestError = Sentry.captureRequestError` en `instrumentation.ts` |
| Build falla en Windows (`copyfile EINVAL`) | Bug de Turbopack con rutas `node:inspector` | Ejecutar build con Webpack (`next build --webpack`), configurado por defecto en `package.json` |

---

## 📈 Escalabilidad (Roadmap Técnico)
| Umbral Actual | Señal de Escalado | Acción Recomendada |
|---------------|-------------------|-------------------|
| SQLite WAL (≤50 req/s) | Latencia p95 > 800ms sostenida | Migrar a PostgreSQL + connection pooling |
| Caché LRUCache en memoria | Múltiples instancias (K8s/pm2 cluster) | Reemplazar `src/lib/cache.ts` con Redis |
| Parseo síncrono | >10 PDFs concurrentes | Mover a cola (BullMQ) + workers dedicados |
| Auth personalizado | >10k usuarios activos | Integrar NextAuth v5 + JWT rotation |

---

## 🔐 Seguridad & Cumplimiento
- ✅ Cookies hardening (XSS/CSRF mitigado)
- ✅ Validación Zod en todas las rutas `POST/PATCH` críticas
- ✅ Hash SHA-256 para idempotencia de importaciones (`importHash`)
- ✅ Backups automáticos con retención de 30 días
- ✅ Logs estructurados (JSON) compatibles con CloudWatch/Datadog
- ✅ Resiliencia contra bloqueos de SQLite: reintentos con backoff exponencial (`createAuditLogWithRetry`) en escrituras críticas de auditoría
- ✅ Listener de queries de Prisma optimizado como Singleton global en `db.ts` para evitar duplicaciones en HMR
- ⚠️ **No subir `prisma/dev.db` ni `.env` al repositorio**

---
*Documento generado post-hardening v1.2.0. Mantener actualizado tras cada release.*
