# Exploración: Dos Motores de Detección de Entidades

## Executive Summary

El proyecto tiene **dos pipelines paralelos** para detectar entidades (proveedores, clientes, socios, etc.) desde transacciones bancarias. Ambos comparten la misma **capa de extracción** (`extractName` + `sanitizeDescription` desde `entity-detector.ts`), pero divergen en la **capa de clustering/agrupación** y en los **formatos de salida**.

Esto produce resultados divergentes para las mismas transacciones: un engine puede agrupar variantes que el otro trata por separado, o viceversa. La consolidación es viable porque comparten ~70% del código base — la divergencia real está en ~3 funciones clave.

---

## Engine 1: `entity-detector.ts` — Jaro-Winkler Clustering

### Archivo
`src/lib/services/entity-detector.ts` (274 líneas)

### Algoritmo
1. **Sanitización**: `sanitizeDescription()` aplica regex del config (`rules/entity-detection.json`) para remover IDs, montos, fechas, memos, descriptores técnicos (DES:, ID:, INDN:, Conf#, etc.)
2. **Extracción**: `extractName()` prueba 3 estrategias de regex por prioridad (P1 > P2 > P3):
   - **P1**: Merchant posicional — nombres conocidos al inicio de la línea (RAISER, LYFT, AMEX, etc.)
   - **P2**: Nombre tras keyword (`from`, `to`, `payee`) — captura transferencias Zelle, cheques
   - **P3**: Nombre tras `INDN:` — ACH individual (fallback cuando no hay merchant ni keyword)
3. **Clustering Fuzzy**: `clusterCandidates()` itera transacciones, extrae nombre, y agrupa usando **Jaro-Winkler** con threshold `0.85` contra el canonical name en UPPERCASE
4. **Canonical selection**: `most_frequent` — el nombre que más aparece dentro del cluster gana
5. **Filtro**: minOccurrences = 2, stopWords, ignorePatterns

### Threshold Jaro-Winkler: 0.85
Esto significa que variantes como "7-ELEVEN" vs "7 ELEVEN" (~0.92) se agrupan, pero "MCDONALDS" vs "MCDONALD'S" podría no hacerlo (~0.82 dependiendo de longitud).

### Output: `EntityCandidate[]`
```typescript
{
  id: string;                    // sha256(canonicalName).slice(0, 12)
  canonicalName: string;         // nombre más frecuente del cluster
  occurrences: number;           // total de transacciones en el cluster
  directionProfile: { creditPct, debitPct };
  sampleDescriptions: string[];  // hasta 5 samples
  hasContext?: boolean;
  contextRole?: string;
  suggestedAccountCode?: string;
  suggestedAccountId?: string;
}
```

### Call Sites

| Caller | Archivo | Qué hace |
|--------|---------|----------|
| `getEntityCandidates()` | `src/lib/services/entity-classifier.ts:67` | Carga 2000 transacciones → clusterCandidates → filtra las que ya tienen EntityContext o BankRule |
| `GET /api/learning/pending-entities` | `src/app/api/learning/pending-entities/route.ts:37` | Carga transacciones no reconciliadas → clusterCandidates → filtra las que ya tienen BankRule |
| `entityFirstCheck()` | `src/lib/services/rule-matching-engine.ts:100-101` | Usa `extractComponents()` (no `clusterCandidates`) para detectar conflictos Merchant vs Socio |

### Tests
- `tests/services/entity-detector.test.ts` (114 líneas, 7 tests)
- Cubre: extracción de nombres con dígitos/guiones/apóstrofes, prioridad P1>P2>P3, fallback a INDN
- NO cubre: clustering fuzzy, Jaro-Winkler threshold, edge cases de threshold

### Config
`rules/entity-detection.json` (84 líneas) — estructura completa de sanitización, extracción, clustering, validación

---

## Engine 2: `ai-rules/scan/route.ts` — normalize+count exacto

### Archivo
`src/app/api/ai-rules/scan/route.ts` (317 líneas)

### Algoritmo
1. **Fetch**: Todas las transacciones de la compañía (sin filtrar por reconciliación)
2. **Pre-filter**: Salta transacciones que ya tienen `matchedRuleId` o `glAccountId`
3. **Normalización inline**: función `normalize()` que:
   - Remueve `Conf#` codes
   - Remueve números/montos con regex `\b\d[\d.,/-]*\b`
   - Collapse espacios, lowercase, trim
4. **Extracción**: Llama a `sanitizeDescription()` + `extractName()` del Engine 1
5. **Limpieza adicional**: Toma el extracted name y le remueve números nuevamente (doble sanitización numérica)
6. **Clustering exacto**: Usa `entityName.toLowerCase()` como **key exacta** en un Map — NO hay fuzzy matching
7. **Enriquecimiento**: Para cada entry:
   - Busca EntityContext existente (match por `normalizePattern` + includes)
   - Conflict detection Merchant vs Socio usando `entityFirstCheck()`
   - Role priority sorting si múltiples contexts
   - Smart frequency: si ya tiene context → min 1 ocurrencia, si no → min 2
   - **OPCIÓN A ESTRICTA**: Si NO tiene un rol asignado, lo ignora (línea 237)
   - Sugerencia de cuenta GL por heurística de keywords + fallback por tipo
   - Skip si ya existe una BankRule que cubre el patrón
8. **Output sorting**: Más frecuentes primero

### Output: `ScanPattern[]`
```typescript
{
  id: string;                    // base64(entityKey).replace(/=/g, '')
  description: string;           // entityName
  rawDescription: string;        // sample original
  occurrences: number;
  direction: string;             // 'debit' | 'credit'
  averageAmount: number;
  suggestedAccount: string;
  suggestedAccountCode: string;
  suggestedAccountId: string;
  hasContext: boolean;
  contextRole: string;
}
```

### Call Sites
- `ConversationalRuleBuilder.tsx:408` → `POST /api/ai-rules/scan?companyId=${companyId}`
- Solo un caller directo (frontend)

### Tests
- **NINGUNO** — no hay test para `ai-rules/scan/route.ts`

---

## Comparación Directa

| Aspecto | Engine 1 (Jaro-Winkler) | Engine 2 (normalize+count) |
|---------|------------------------|---------------------------|
| **Extracción** | `extractName()` con 3 prioridades | `extractName()` + limpieza extra de números |
| **Sanitización** | `sanitizeDescription()` del config | `sanitizeDescription()` + `normalize()` inline |
| **Clustering** | Jaro-Winkler threshold 0.85 | Exact key match (lowercase) |
| **Fuzzy merge** | Sí — "7-ELEVEN" ≈ "7 ELEVEN" | No — cada variante es separada |
| **Filtro de números** | Una pasada (en sanitización) | **Dos pasadas** (sanitize + clean extracted name) |
| **DataSource** | Transacciones no reconciliadas (pending) **o** últimas 2000 (classifier) | Todas las transacciones (excepto las ya matcheadas/clasificadas) |
| **Context check** | `patternLower === canonicalName` exacto | `normalize(sample).includes(ctx.pattern)` fuzzy-contains |
| **Min occurrences** | 2 (configurable en JSON) | 1 si tiene context, 2 si no, 3 global |
| **Role requirement** | No requiere rol | **Requiere rol** (línea 237: "OPCIÓN A ESTRICTA") |
| **Account suggestion** | No incluye | Sí — heurística por keywords + ROLE_ACCOUNT_MAP |
| **Test coverage** | 7 tests (114 lines) | 0 tests |
| **Output structure** | `EntityCandidate[]` | `{ patterns: ScanPattern[] }` |

---

## Pain Points y Comportamiento Divergente

### 1. Clustering diferente → distintos agrupamientos
Una transacción "7-ELEVEN #123" y "7-ELEVEN #456" post-extracción darían "7-ELEVEN" para ambas.
- **Engine 1**: Ambas se agrupan en el mismo cluster por Jaro-Winkler 0.85 → count=2
- **Engine 2**: Ambas se agrupan porque `extractName` produce el mismo nombre, y el key exacto es igual → count=2
- **Pero**: Si extractName produce variantes distintas (e.g., "SUPERMERCADO" vs "SUPER MRK"), Engine 1 las agrupa y Engine 2 no.

### 2. Diferente data source → diferentes entidades detectadas
- Engine 1 via `pending-entities`: solo transacciones **no reconciliadas Y sin glAccountId**
- Engine 1 via `getEntityCandidates`: últimas 2000 transacciones
- Engine 2: **todas** las transacciones excepto las ya matcheadas/clasificadas
- **Resultado**: El dashboard de "pending entities" puede mostrar entidades que el scan no ve, y viceversa.

### 3. Diferente inclusive/exclusive filtering
- Engine 2 excluye explícitamente transacciones con `matchedRuleId` o `glAccountId`
- Engine 1 (pending) excluye `isReconciled=true` y `glAccountId != null`
- Engine 1 (classifier) no filtra por reconciliación

### 4. Smart frequency, pero no idéntica
- Engine 1: minOccurrences = 2 **siempre** (config)
- Engine 2: min = 1 si tiene context, 2 si no, **3 global** (línea 109) pero luego se reduce condicionalmente

### 5. Role requirement es un game-changer
Engine 2 descarta **todas** las entidades sin rol asignado (línea 237). Engine 1 las muestra todas. Esto significa que:
- Engine 1 es **exploratorio** (muestra lo que encontró)
- Engine 2 es **productivo** (solo muestra lo que ya está clasificado)

### 6. `extractComponents` vs `extractName`
- Engine 1 usa `extractName()` que devuelve el primer match
- `rule-matching-engine.ts` usa `extractComponents()` que devuelve **todos** los componentes (merchant, transferName, indnName)
- Esto es para `entityFirstCheck`: detectar si hay un merchant en P1 **y** un SOCIO en INDN
- `extractName()` no puede hacer esto porque corta en el primer match

---

## Common Patterns (lo que comparten)

1. **Misma capa de extracción**: `sanitizeDescription()` → `extractName()` con las 3 prioridades
2. **Mismo config**: `rules/entity-detection.json`
3. **Direction profile**: ambos calculan credit/debit ratio
4. **Filter by existing contexts/rules**: ambos verifican `EntityContext` y `BankRule` existentes
5. **Ambos usan `normalizePattern()`** de `pattern-normalizer.ts` para matching de contextos

---

## Consolidación: Opciones y Tradeoffs

### Opción A: Unificar en `entity-detector.ts` + eliminar scan route (Recomendada)

**Qué hacer**:
1. Expandir `clusterCandidates()` para aceptar opciones: `{ useExactMatch?: boolean, requireRole?: boolean, minOccurrences?: number }`
2. Agregar `clusterCandidatesExact()` como wrapper que use exact match + el cluster por Jaro-Winkler como fallback
3. Refactorizar scan route para que llame a `clusterCandidates()` en lugar de su propio normalize+count
4. Mover la lógica de enriquecimiento (account suggestion, context matching, role priority) a un paso posterior compartido
5. Mantener la "doble sanitización numérica" del scan route como opción

**Pros**:
- Elimina código duplicado
- Un solo pipeline de detección
- La lógica de enriquecimiento se comparte
- Tests existentes para entity-detector se expanden

**Contras**:
- La normalización inline del scan (remover números del extracted name) es más agresiva — podría perderse nombres que contienen dígitos legítimos (ej: "7-ELEVEN" → "ELEVEN")
- El smart frequency (1 si context, 2 si no) está solo en scan
- El matching de context por `normalize(sample).includes(ctx.pattern)` es distinto al exacto de classifier

### Opción B: Unificar en scan route + eliminar entity-detector clustering

**Qué hacer**:
1. Agregar fuzzy matching al scan (Jaro-Winkler opcional)
2. Mover `clusterCandidates()` inline al scan
3. Eliminar `entity-detector.ts` y que pending-entities use el scan

**Pros**:
- El scan tiene mejor enriquecimiento (GL accounts, role priorities)
- El scan es el que realmente usa el frontend

**Contras**:
- El scan es una API route, no una función pura — difícil de testear
- Rompe `entity-first-check` en rule-matching-engine (necesita `extractComponents`)
- Pierde la flexibilidad de `clusterCandidates()` como función pura y testeable

### Opción C: Extraer la lógica común, mantener dos pipelines livianos

**Qué hacer**:
1. Extraer `normalize()` del scan a `pattern-normalizer.ts` como `normalizeForExactMatch()`
2. Extraer la lógica de enriquecimiento (account suggestion, role priority, context matching) a un servicio compartido
3. Ambos engines se reducen a: extract → cluster → enrich

**Pros**:
- Mínimo refactor, bajo riesgo
- Clarifica responsabilidades

**Contras**:
- Sigue habiendo dos pipelines
- Los resultados seguirán divergiendo

---

## Riesgos de Consolidación

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| **Doble sanitización numérica**: scan route limpia números dos veces (en normalize + en extracted name). Si se unifica y se pierde un paso, nombres como "7-ELEVEN" podrían no detectarse | Alto | Verificar que `extractName` preserve dígitos integrados en nombres reales |
| **Smart frequency**: scan usa min=1 si hay context, 2 si no, 3 global. Engine 1 usa 2 siempre. Si se unifica, cambiar el threshold puede sobrecargar al usuario con falsos positivos | Medio | Hacer configurable, mantener el smart frequency como feature |
| **Role requirement**: scan descarta entidades sin rol. Si se elimina esto, el frontend podría mostrar candidatos no clasificables que confundan al usuario | Medio | Hacer configurable por caller (exploratorio vs productivo) |
| **Context matching divergente**: scan usa `normalize(sample).includes(ctx.pattern)`, classifier usa `patternLower === canonicalName`. Unificarlos puede cambiar qué entidades existentes se detectan | Alto | Elegir un approach y documentar el cambio |
| **Perder `extractComponents()`**: rule-matching-engine necesita P1 y P3 separados para `entityFirstCheck`. Si `extractComponents` no se mantiene, el entity-first mode se rompe | Alto | Mantener `extractComponents()` como función independiente (ya vive en entity-detector.ts) |

---

## Recomendación

**Opción A con precauciones:**

1. **Mantener `extractComponents()`** como función independiente para `entityFirstCheck` en rule-matching-engine
2. **Expandir `clusterCandidates()`** con un parámetro `options`:
   ```typescript
   interface ClusterOptions {
     mode: 'fuzzy' | 'exact' | 'hybrid'; // hybrid = exact first, fuzzy fallback
     requireRole?: boolean;
     minOccurrences?: number | ((hasContext: boolean) => number);
     extraNumberStrip?: boolean; // doble sanitización del scan
   }
   ```
3. **Mover lógica de enriquecimiento** (account suggestion, role priority, context matching) a un nuevo servicio `src/lib/services/entity-enricher.ts`
4. **Refactorizar scan route** para que sea un thin orchestator: fetch transactions → `clusterCandidates(options)` → `enrichCandidates()` → return
5. **Refactorizar pending-entities** y **classify-entity** para usar el mismo pipeline con distintos options
6. **Eliminar el normalize inline del scan** y moverlo como opción de `clusterCandidates`

### Orden de Implementación Sugerido
1. Extraer `normalize()` del scan a pattern-normalizer
2. Crear `entity-enricher.ts` con account suggestion + role priority logic
3. Expandir `clusterCandidates()` con options
4. Refactorizar scan route como thin caller
5. Refactorizar pending-entities y classify-entity
6. Tests para todo el pipeline unificado
7. Eliminar código muerto

---

## Riesgos y Desconocidos

- **¿Hay datos históricos donde la divergencia causó bugs?** No se encontraron issues en el código, pero los tests no cubren escenarios de divergencia
- **¿Qué pasa con companyId vs multi-company?** Ambos engines usan companyId, pero el scan tiene `requireCompanyContext()` mientras que entity-detector no maneja autorización
- **Performance**: `clusterCandidates()` es O(n*m) donde n = transacciones, m = clusters actuales. Jaro-Winkler se ejecuta por cada par. Con 2000 transacciones puede ser lento. El scan es O(n) por usar exact match. La consolidación debe considerar esto
- **¿El scan recibe `companyId` por query param?** Sí, `POST /api/ai-rules/scan?companyId=X`. Esto es un posible leak de seguridad si se consolida sin verificar autorización
- **La función `normalize()` inline del scan remueve `Conf#` codes y números. `sanitizeDescription()` del config también remueve Conf#.** Hay overlap — la doble sanitización puede ser intencional o accidental

---

## Archivos Relevantes

| Archivo | Rol |
|---------|-----|
| `src/lib/services/entity-detector.ts` | Engine 1: extracción + Jaro-Winkler clustering |
| `src/app/api/ai-rules/scan/route.ts` | Engine 2: normalize+count exacto + enriquecimiento |
| `src/lib/services/entity-classifier.ts` | Orquestador: usa Engine 1 para candidates + clasificación |
| `src/lib/services/entity-context-service.ts` | CRUD de EntityContext (usado por ambos engines) |
| `src/lib/services/rule-matching-engine.ts` | Rule matching: usa `extractComponents()` del Engine 1 |
| `src/lib/services/pattern-normalizer.ts` | Normalización compartida: `normalizePattern()`, `sanitizeDescriptionForDetection()` |
| `src/lib/constants/entity-roles.ts` | Roles de entidad (INQUILINO, PROVEEDOR, SOCIO, etc.) |
| `rules/entity-detection.json` | Config del Engine 1 (sanitize patterns, extraction, clustering, validation) |
| `prisma/schema.prisma` | Modelos: `EntityContext`, `BankTransaction`, `BankRule` |
| `src/app/api/learning/classify-entity/route.ts` | API: clasifica entidad (usa Engine 1 via classifier) |
| `src/app/api/learning/pending-entities/route.ts` | API: entidades pendientes (usa Engine 1 directo) |
| `src/components/learning/ConversationalRuleBuilder.tsx` | Frontend: consume Engine 2 (scan) + clasifica via API |
| `tests/services/entity-detector.test.ts` | Tests del Engine 1 (NO del Engine 2) |
