# Módulo de Flujo Contable Neto (Accounting Flow)

Este módulo consolida el flujo de caja real unificando asientos contables publicados y transacciones bancarias conciliadas pendientes de vinculación.

## Arquitectura

El módulo se compone de cuatro pilares de integridad contable y deduplicación:

1. **Idempotencia de Importación (`importHash`)**: Evita la importación duplicada de extractos en la base de datos aplicando un hash SHA-256 sobre los datos normalizados.
2. **Deduplicación de Movimientos (`journalLineId`)**: Una transacción bancaria conciliada se considera flujo de caja solo si no está ya vinculada a una línea de asiento contable (`journalLineId IS NULL`).
3. **Fuzzy Matching Inteligente (Fuse.js)**: Busca correspondencias funcionales entre extractos y asientos para sugerir auto-vinculaciones con badges de confianza (Zelle ±10% de tolerancia de importe, ACH ±2%).
4. **Agregación Pura y Segura**: Procesamiento rápido en memoria a través de `flow-aggregator.ts`, aislando la lógica de consulta y previniendo mutaciones accidentales.

## Endpoints de la API

* `GET /api/accounting-flow` - Obtiene las métricas acumuladas, por periodo, por cuenta y los movimientos consolidados de la compañía.
* `POST /api/accounting-flow/audit/fuzzy-match` - Evalúa candidatos contables difusos para una transacción del extracto bancario.
* `PATCH /api/accounting-flow/audit/link` - Vincula atómicamente una transacción bancaria a una línea de asiento publicada.
* `GET /api/accounting-flow/export` - Descarga el flujo de caja neto en formato CSV con rate limiting y logs estructurados de auditoría.

## Guía de Despliegue

### 1. Variables de Entorno Recomendadas

```bash
# Nivel de logs estructurados (info, warn, error)
LOG_LEVEL=info

# Límites de rate limiting para exportación
RATE_LIMIT_EXPORT=15
```

### 2. Base de Datos (Migración)

Asegúrate de ejecutar las migraciones o actualizar el esquema para soportar los nuevos campos en `BankTransaction`:

```bash
bunx prisma db push
bunx prisma generate
```

### 3. Ejecución del Servidor en Producción

El módulo ya está completamente integrado en el dashboard contable (`DashboardPage.tsx`) y compila limpiamente sin errores de TypeScript.

Para iniciar en modo producción:
```bash
bun run build
bun run start
```
