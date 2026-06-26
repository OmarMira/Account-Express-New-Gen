# Design: Batch OTRO Classification

## Enfoque Técnico

Se reemplaza el flujo F4 de auto-asignación por keystroke por un sistema de pre-clasificación batch controlado por el usuario. El componente `EntityOnboardingModal` cambia de "fire on type + auto-assign + toast" a "batch on click + inline banners + review manual". No hay cambios en el endpoint `/api/learning/suggest-role`.

## Architecture Decisions

### Decisión: Batch state como `Record<string, BatchEntry | null>`

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| `batchResults` record único | Fácil merge con UI por tarjeta | ✅ Elegido |
| Array separado + índice | Más overhead de lookup | ❌ Rechazado |

Se almacena por `canonicalName` con `{ suggestedRole, confidence, explanation, status }`. Un solo estado reemplaza `suggestionResults`, `suggestionLoading`, `suggestionFailures`, `suggestionHidden`.

### Decisión: Snapshot de descriptions al iniciar batch

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| Snapshot en ref al click | Previene race condition (FR-11) | ✅ Elegido |
| Leer descriptions en cada Promise | Descripción cambiada durante batch contamina resultados | ❌ Rechazado |

### Decisión: Banner inline sin componente separado

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| JSX condicional dentro del map de candidates | Un solo archivo, sin nuevos imports | ✅ Elegido |
| Componente `SuggestionBanner` separado | Más archivos, más tests | ❌ Rechazado (diferir si el banner crece) |

## Data Flow

```
Usuario escribe descripción
       │
       ▼
handleDescriptionChange() ──→ solo setDescriptions()
       │                      NO fireSuggestion()
       │                      NO autoAssignPendingSkipped()
       ▼
Botón "Pre clasificar entidades" (derived: OTRO + descripciones ≥5 chars)
       │
       ▼
handlePreClassify()
       │
       ├─ 1. Snapshot descriptionsRef.current = {...descriptions}
       ├─ 2. setBatchInProgress(true)
       ├─ 3. Promise.allSettled(
       │       entities.map((name) => fireSuggestion(name, snapshot[name]))
       │    )
       │
       ▼ por cada settlement
       │
       ├─ fulfilled + ≥0.7  → batchResults[name] = {status:'success', suggestedRole, confidence, explanation}
       ├─ fulfilled + <0.7  → batchResults[name] = {status:'success', suggestedRole, confidence, explanation, lowConfidence: true}
       └─ rejected           → batchResults[name] = {status:'error'}
       │
       ▼
UI: banner inline por tarjeta
       │
       ├─ [✅ Asignar]  → handleAcceptSuggestion(name, role) → updateSelection → batchResults[name].status = 'accepted'
       ├─ [❌ Descartar] → handleDiscardSuggestion(name)     → batchResults[name].status = 'discarded'
       └─ [✏️ Editar]   → handleRoleChange(name, newRole)    → dropdown + batchResults[name].status = 'edited'
```

## State Machine: Botón de guardar

```
Estado inicial (sin OTRO):
  → "Clasificar entidades" (enabled)

Hay OTRO + descripciones ≥5 chars:
  → "Pre clasificar entidades" (enabled)

Hay OTRO + sin descripciones suficientes:
  → "Pre clasificar entidades" (disabled)

Batch en progreso:
  → "Clasificando..." (disabled, spinner)

Batch completado + algún OTRO sin resolver:
  → "Pre clasificar entidades" (disabled)

Batch completado + sin OTRO pendientes:
  → "Clasificar entidades" (enabled)
```

## UI Component Design: Suggestion Banner

```typescript
interface BannerProps {
  status: 'pending' | 'success' | 'error' | 'accepted' | 'discarded';
  suggestedRole?: string;
  confidence?: number;
  explanation?: string;
  onAccept: () => void;
  onDiscard: () => void;
  onEdit: () => void;
}
```

| Estado | UI |
|--------|----|
| `pending` | Spinner + "Clasificando..." |
| `success` (≥0.7) | "Sugerencia: {role} — Confianza: {percent}% — [✅ Asignar] [❌ Descartar] [✏️ Editar]" |
| `success` (<0.7) | Igual + indicador visual "Confianza baja: {percent}%" + textarea editable |
| `error` | "No disponible ahora. Elegí manualmente." + dropdown visible |
| `accepted` | "Rol asignado: {role}" (banner informativo) |
| `discarded` | Banner oculto |

## File Changes

| File | Acción | Descripción |
|------|--------|-------------|
| `src/components/learning/EntityOnboardingModal.tsx` | Modificar | Remover F4 handlers, agregar batch state + handlers + banner inline |
| `src/lib/i18n.ts` | Modificar | Sin cambios estructurales (i18n.ts es el loader; las keys van en locales) |
| `src/i18n/locales/en.ts` | Modificar | 13 nuevas keys en sección `learning` |
| `src/i18n/locales/es.ts` | Modificar | 13 nuevas keys en sección `learning` |

## State Changes: Antes vs Después

| Estado/Ref | Antes (F4) | Después (Batch) |
|------------|------------|-----------------|
| `suggestionLoading` | `Record<string, boolean>` | Eliminado. Reemplazado por `batchResults[name].status === 'pending'` |
| `suggestionResults` | `Record<string, {suggestedRole, confidence, explanation} \| null>` | Reemplazado por `batchResults` |
| `suggestionFailures` | `Record<string, number>` | Eliminado |
| `suggestionHidden` | `Record<string, boolean>` | Eliminado |
| `firedTexts` ref | `Record<string, string>` | Eliminado |
| `batchResults` | — | **Nuevo**: `Record<string, {suggestedRole, confidence, explanation, status} \| null>` |
| `batchInProgress` | — | **Nuevo**: `boolean` |
| `descriptionsSnapshot` ref | — | **Nuevo**: captura al iniciar batch (FR-11) |
| `abortControllers` ref | Se usa por entidad | Se reusa para batch + modal close abort |
| `loadingRef` | Mirror de suggestionLoading | Se reusa para batchInProgress |
| `selectionsRef` | Snapshot de selections | Se conserva sin cambios |

## Handler Changes

| Handler | Antes | Después |
|---------|-------|---------|
| `handleDescriptionChange` | `autoAssignPendingSkipped()` + `fireSuggestion()` | Solo `setDescriptions()` |
| `handleRoleChange` | `autoAssignPendingSkipped()` + fire si OTRO | Solo `updateSelection()` + limpiar `batchResults` si cambia de OTRO |
| `handleSplitChange` | `autoAssignPendingSkipped()` | Solo `setSplitSelections()` |
| `handleClassifyAll` | Fire pendientes + auto-assign + save | Solo save (sin pre-fire ni auto-assign) |
| `handlePreClassify` | — | **Nuevo**: snapshot + `Promise.allSettled` |
| `handleAcceptSuggestion` | — | **Nuevo**: `updateSelection(name, 'role', suggestedRole)` + marca `accepted` |
| `handleDiscardSuggestion` | — | **Nuevo**: marca `discarded`, entidad sigue OTRO |
| `showAssignableToast` | Toast + auto-assign | **Eliminado** |
| `autoAssignPendingSkipped` | Cascade suggestions | **Eliminado** |
| `fireSuggestion` | Por keystroke, con dedup | Solo desde `handlePreClassify` (batch) |

## i18n Keys (13 nuevas)

| Clave | EN | ES |
|-------|----|-----|
| `learning.preClassify` | Pre classify entities | Pre clasificar entidades |
| `learning.classify` | Classify entities | Clasificar entidades |
| `learning.suggestionBanner.title` | Suggestion: {role} | Sugerencia: {role} |
| `learning.suggestionBanner.confidence` | Confidence: {percent}% | Confianza: {percent}% |
| `learning.suggestionBanner.lowConfidence` | Low confidence: {percent}% | Confianza baja: {percent}% |
| `learning.suggestionBanner.accept` | Assign | Asignar |
| `learning.suggestionBanner.discard` | Discard | Descartar |
| `learning.suggestionBanner.edit` | Edit role manually | Editar rol manual |
| `learning.suggestionBanner.error` | Not available now. Pick manually. | No disponible ahora. Elegí manualmente. |
| `learning.suggestionBanner.assigned` | Role assigned: {role} | Rol asignado: {role} |
| `learning.batch.loading` | Classifying entities... | Clasificando entidades... |
| `learning.batch.error` | Error classifying some entities | Error al clasificar algunas entidades |
| `learning.suggestionBanner.pending` | Classifying... | Clasificando... |

## Testing Strategy

| Capa | Qué testear | Enfoque |
|------|-------------|---------|
| Unit | `handlePreClassify` snapshot + `Promise.allSettled` | Mock fetch, verificar que descriptions no mutantes afecten batch |
| Unit | `handleAcceptSuggestion` / `handleDiscardSuggestion` | Verificar estado de selections y batchResults |
| Unit | Button text derivation | Test cada estado del state machine |
| Unit | Descripción modificada durante batch (FR-11) | Mock timing, verificar exclusión |
| Integration | Batch + render de banners | Cypress: click "Pre clasificar", verificar banner por tarjeta |
| Integration | Modal close abort (FR-10) | Cypress: abrir modal, iniciar batch, cerrar, verificar no hay calls pendientes |

## Migración

- Tests existentes de F4 se mueven a `openspec/changes/archive/` como referencia del comportamiento anterior.
- No se requiere migración de datos: el cambio es 100% frontend.
- El endpoint `/api/learning/suggest-role` permanece sin cambios.

## Open Questions

- [x] Ninguno — el diseño cubre todos los FRs y NFRs del spec.
