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

### Monitoreo de Salud (Health Check)

**Endpoint:** `GET /api/health` (Público, sin autenticación)

Retorna el estado de salud del sistema, incluyendo:
- Latencia y estado de la base de datos SQLite
- Uptime del proceso
- Uso de memoria (Heap Used y Heap Total)
- Timestamp actual e información de versión

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

### Monitoreo de Errores con Sentry (Producción)

El sistema integra Sentry APM para capturar excepciones críticas y problemas de rendimiento en tiempo real (por ejemplo, descuadres contables o fallas en el bloqueo de períodos).

Para configurarlo, añade en tu archivo de entorno local:
```env
NEXT_PUBLIC_SENTRY_DSN=https://your-key@sentry.io/your-project-id
SENTRY_DSN=https://your-key@sentry.io/your-project-id
SENTRY_AUTH_TOKEN=sntrys_your_auth_token_here
```

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

---

## 💾 Backups

El script crea copias comprimidas de la base de datos SQLite con retención automática de 30 backups.

### Ejecución manual

```bash
bun run scripts/backup-db.ts
```

Output esperado:
```
✅ Backup creado: backups/backup-2025-01-27T14-30-00-000Z.tar.gz
📦 Total backups almacenados: 1
```

### Automatizar con cron (Linux/Mac)

```bash
# Editar crontab
crontab -e

# Agregar línea (backup diario a las 2 AM)
0 2 * * * cd /ruta/al/proyecto && bun run scripts/backup-db.ts >> /var/log/db-backup.log 2>&1
```

### Automatizar con Task Scheduler (Windows)

```powershell
# Crear tarea programada diaria a las 2 AM
schtasks /create /tn "AccountExpressBackup" /tr "bun run scripts/backup-db.ts" /sc daily /st 02:00 /sd 01/01/2025
```

### Restaurar un backup

```bash
# Extraer backup
tar -xzf backups/backup-TIMESTAMP.tar.gz

# Detener el servidor primero, luego copiar
cp backup-TIMESTAMP.db prisma/dev.db
```

**Nota:** Los backups se guardan en la carpeta `backups/`. Esta carpeta está en `.gitignore` para evitar subir datos sensibles al repositorio.

---

## ⚡ Pruebas de Carga (k6)

El sistema incluye scripts para realizar pruebas de carga bajo escenarios de alta concurrencia contable (Health Check, autenticación y consulta de reportes).

### Requisitos
*   [k6](https://k6.io) instalado en el sistema.

### Ejecución de Pruebas
1. Inicie el servidor en modo producción local:
   ```bash
   bun run build
   $env:NODE_ENV="production"; bun .next/standalone/server.js
   ```
2. Ejecute el test de carga con k6:
   ```bash
   k6 run scripts/load-test.js
   ```

### Umbrales de Aceptación (Thresholds)
*   **http_req_duration (p95):** < 500ms
*   **http_req_failed (Tasa de error):** < 5%

