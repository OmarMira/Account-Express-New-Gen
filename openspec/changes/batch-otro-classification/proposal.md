# Propuesta: Batch OTRO Classification

## Intención

Eliminar la activación por tecla del AI sugeridor de roles OTRO y reemplazarlo con un flujo batch controlado por el usuario ("Pre clasificar entidades"). El sistema ya no auto-asigna roles ni muestra toasts; en su lugar recolecta sugerencias inline para que el usuario decida.

## Alcance

### In Scope
- Remover `fireSuggestion()` por keystroke y debounce de 1s
- Desactivar `autoAssignPendingSkipped()` (cascada sobre otras entidades)
- Agregar botón "Pre clasificar entidades" cuando existan OTRO con descripción
- Batch fire paralelo de todas las OTRO al hacer clic
- Banners inline por tarjeta: [✅ Asignar] [❌ Descartar] [✏️ Editar rol manual]
- Botón cambia a "Clasificar entidades" cuando no quedan OTRO pendientes
- Manejo de baja confianza: mostrar sugerencia igual, no ocultar textarea
- Manejo de error de API: banner de error sin bloquear, dropdown manual disponible

### Out of Scope
- Modal de revisión separado (enfoque B de exploration)
- Aceptación bulk de sugerencias de alta confianza
- Ordenamiento o filtros sobre sugerencias
- Mejoras al endpoint `/api/learning/suggest-role`
- Migración de datos existentes

## Capacidades

### Capacidades nuevas
Ninguna.

### Capacidades modificadas
- `entity-role-suggestion`: comportamiento del lado cliente cambia de auto-asignación por tecleo a pre-clasificación batch con revisión inline. El endpoint no cambia.

## Enfoque

Se adopta el **Enfoque A (Accordion Review)** de la exploration:

1. Usuario escribe descripciones en cada entidad OTRO (igual que hoy)
2. Botón de guardar muestra "Pre clasificar entidades" si hay OTRO con texto
3. Al hacer clic → `Promise.allSettled` sobre todas las OTRO con descripción
4. Cada resultado se muestra como banner inline dentro de la tarjeta de la entidad
5. Usuario acepta, descarta, o edita manualmente cada sugerencia
6. Cuando todas las entidades tienen rol definido (no OTRO), el botón pasa a "Clasificar entidades" y permite guardar

## Áreas afectadas

| Archivo | Impacto | Descripción |
|---------|---------|-------------|
| `src/components/learning/EntityOnboardingModal.tsx` | Modificado | Remover F4 auto-suggest, agregar batch state y banners inline |
| `src/lib/i18n.ts` | Modificado | Nuevas keys: `learning.preClassify`, banners de sugerencia |
| `tests/components/EntityOnboardingModal.test.tsx` | Modificado | Tests de F4 se reescriben; nuevos tests de batch y banners |

## Riesgos

| Riesgo | Prob. | Mitigación |
|--------|-------|------------|
| Race conditions en batch paralelo | Media | `Promise.allSettled` con resolución por entidad; ref `batchResults` |
| API caída bloquea al usuario | Baja | Dropdown manual siempre visible; banner de error no bloqueante |
| Regresión en handlers existentes | Media | Auditoría de `handleRoleChange`, `handleDescriptionChange`, `handleClassifyAll` |

## Plan de rollback

Revertir el commit que modifica `EntityOnboardingModal.tsx` y las keys de i18n. Los tests existentes (archivados en `archive/`) sirven como referencia del comportamiento anterior.

## Dependencias

Ninguna.

## Criterios de éxito

- [x] Usuario escribe en OTRO sin que se dispare ninguna llamada AI
- [x] Botón "Pre clasificar entidades" aparece cuando hay OTRO con descripción
- [x] Al hacer clic, todas las OTRO se clasifican en paralelo
- [x] Cada entidad OTRO muestra un banner inline con la sugerencia
- [x] Usuario puede aceptar, descartar o ignorar cada sugerencia
- [x] Botón cambia a "Clasificar entidades" solo cuando no quedan OTRO sin resolver
- [x] No hay toasts de sugerencia ni auto-asignación en ningún flujo
