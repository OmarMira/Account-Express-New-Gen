# Account Express New Gen

Sistema contable con importación de estados bancarios, conciliación y reportes financieros.

## 📊 Observabilidad y Profiling

El sistema incluye observabilidad integrada para detectar cuellos de botella y queries lentas.

### Métricas en Tiempo Real

**Endpoint:** `GET /api/metrics` (requiere rol `super_admin`)

Retorna:
- p50, p95, p99 de response times (API requests)
- Queries lentas (>100ms) con conteo y ejemplos
- Métricas de parseo de PDFs
- Ventana deslizante de últimas 1000 requests

### Uso en Desarrollo

```bash
# 1. Iniciar servidor
bun run dev

# 2. Ejercitar flujos críticos (login, subir PDF, conciliar)
# 3. Consultar métricas
curl http://localhost:3000/api/metrics -H "Authorization: Bearer YOUR_TOKEN"
```

**Nota:** Las métricas se resetean al reiniciar el servidor. Para sesiones de profiling, ejecute los flujos críticos y consulte `/api/metrics` antes del siguiente hot-reload.

### Logging Estructurado (Producción)

El sistema emite logs en formato JSON estructurado compatible con CloudWatch, Datadog, Sentry:

```json
{
  "timestamp": "2025-01-15T10:30:00.000Z",
  "level": "warn",
  "message": "SLOW_QUERY",
  "query": "SELECT * FROM BankTransaction WHERE...",
  "durationMs": 245
}
```

### Alertas Automáticas

Queries que exceden 500ms generan alertas batch cada 60 segundos via webhook (configurar `ALERT_WEBHOOK_URL` en `.env`).

### Graceful Shutdown

El sistema maneja SIGTERM correctamente:
- Flush de alertas pendientes antes de terminar
- Re-emite SIGTERM para que Next.js complete su graceful shutdown
- Compatible con Docker/Kubernetes

---

## 🏗️ Arquitectura y Limitaciones

### Caché en Memoria (Sprint 2)

El sistema utilizará caché LRU en memoria del proceso para datos estáticos (plan de cuentas, configuración de compañía).

**Alcance:**
- ✅ Funciona correctamente en despliegues de instancia única (Vercel, Railway, Docker standalone)
- ✅ Invalidación automática cross-worker via `BroadcastChannel` dentro del mismo proceso
- ⚠️ No compartido entre múltiples instancias de servidor (pm2 cluster, Kubernetes)

**Justificación:**
SQLite (base de datos actual) es inherentemente single-instance. El caché en memoria es coherente con esta arquitectura.

**Migración futura:**
Si escalas a PostgreSQL + múltiples instancias, reemplazar `src/lib/cache.ts` con Redis:
```bash
bun add ioredis
# Modificar cache.ts para usar Redis en lugar de LRUCache
```
