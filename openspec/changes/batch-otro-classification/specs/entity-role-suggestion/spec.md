# Delta para: Entity Role Suggestion

## REMOVED Requirements

### Requirement: Debounced Toast UI

Se elimina el comportamiento de sugerencia automática por tecleo con debounce de 1s, min 5 chars, cascade `autoAssignPendingSkipped`, y toasts de notificación.

(Reason: Reemplazado por flujo batch de pre-clasificación con banners inline. El usuario ya no recibe ni auto-asigna sugerencias al escribir.)
(Migration: Tests del toast anterior deben eliminarse o moverse a `archive/`. El endpoint `/api/learning/suggest-role` permanece sin cambios.)

## ADDED Requirements

### FR-1: Botón "Pre clasificar entidades"

Cuando existan entidades con rol OTRO y descripción no vacía, el botón DEBE mostrar **"Pre clasificar entidades"**. Sin OTRO o sin descripción, NO DEBE mostrar este texto.

#### Scenario: Botón visible con OTRO + descripción

- GIVEN hay entidades OTRO con descripción no vacía
- WHEN se renderiza el modal
- THEN el botón muestra "Pre clasificar entidades"

#### Scenario: Sin OTRO elegible

- GIVEN no hay entidades OTRO con descripción
- WHEN se renderiza el modal
- THEN el botón NO muestra "Pre clasificar entidades"

### FR-2: Ejecución batch paralela

Al hacer clic en "Pre clasificar entidades", el sistema DEBE invocar `POST /api/learning/suggest-role` para cada entidad OTRO con descripción usando `Promise.allSettled`.

#### Scenario: Batch completo

- GIVEN 3 entidades OTRO con descripción
- WHEN el usuario hace clic en "Pre clasificar entidades"
- THEN se disparan 3 llamadas en paralelo
- AND cada entidad recibe su resultado individual

#### Scenario: Solo entidades con descripción

- GIVEN 5 entidades OTRO, 3 con descripción
- WHEN el usuario hace clic en "Pre clasificar entidades"
- THEN solo se clasifican las 3 con descripción

### FR-3: Banner inline por tarjeta

Cada entidad clasificada DEBE mostrar un banner inline con: rol sugerido, nivel de confianza, y 3 acciones: [✅ Asignar] [❌ Descartar] [✏️ Editar rol manual].

#### Scenario: Banner post-clasificación

- GIVEN el batch completó la sugerencia para una entidad
- WHEN se renderiza su tarjeta
- THEN el banner muestra rol sugerido, confianza y los 3 botones de acción

### FR-4: Aceptar sugerencia

Al hacer clic en [✅ Asignar], el sistema DEBE cambiar el rol de OTRO al sugerido. La entidad DEJA de contar como OTRO pendiente.

#### Scenario: Asignación exitosa

- GIVEN el banner sugiere "INQUILINO" con 0.92
- WHEN el usuario hace clic en [✅ Asignar]
- THEN el rol se actualiza a INQUILINO
- AND el banner se reemplaza por "Rol asignado: INQUILINO"
- AND el contador de OTRO pendientes se reduce

### FR-5: Descartar sugerencia

Al hacer clic en [❌ Descartar], el sistema DEBE ocultar el banner. La entidad permanece como OTRO sin sugerencia activa.

#### Scenario: Descarte manual

- GIVEN el banner muestra una sugerencia
- WHEN el usuario hace clic en [❌ Descartar]
- THEN el banner se oculta
- AND la entidad sigue siendo OTRO

### FR-6: Edición manual de rol

Al hacer clic en [✏️ Editar rol manual], el sistema DEBE abrir el dropdown de selección de roles. El textarea de descripción DEBE permanecer visible y editable.

#### Scenario: Edición manual desde banner

- GIVEN el banner muestra una sugerencia
- WHEN el usuario hace clic en [✏️ Editar rol manual]
- THEN el dropdown de roles se despliega
- AND el textarea de descripción permanece visible y editable

### FR-7: Baja confianza

Cuando la confianza devuelta sea < 0.7, el sistema IGUAL DEBE mostrar el banner con la sugerencia e incluir un indicador visual de confianza baja. El textarea NO DEBE ocultarse.

#### Scenario: Sugerencia con confianza baja

- GIVEN la API devuelve `confidence: 0.45`
- WHEN se muestra el banner
- THEN el banner incluye indicador visual de confianza baja
- AND el textarea permanece visible y editable

### FR-8: Error de API no bloqueante

Si una llamada falla (timeout, 500, network error), la tarjeta DEBE mostrar un banner de error. El dropdown manual DEBE estar siempre disponible. Las demás entidades NO DEBEN verse afectadas.

#### Scenario: Timeout de API

- GIVEN la API no responde en 10s
- WHEN se completa el batch
- THEN la tarjeta muestra banner: "No disponible ahora. Elegí manualmente."
- AND el dropdown manual está accesible

#### Scenario: Error 500 en una entidad

- GIVEN la API responde con 500 para la entidad A
- WHEN se evalúa el resultado
- THEN la tarjeta A muestra banner de error no bloqueante
- AND las tarjetas B y C con respuesta exitosa muestran su banner normalmente

### FR-9: Transición del botón

Cuando NO queden entidades OTRO sin resolver, el botón DEBE cambiar a **"Clasificar entidades"** y permitir guardar el formulario.

#### Scenario: Todas las OTRO resueltas

- GIVEN habían 3 entidades OTRO pendientes
- WHEN todas tienen rol definido (asignado, editado o descartado + rol manual)
- THEN el botón muestra "Clasificar entidades"
- AND el formulario puede guardarse

### FR-10: Interrupción de batch

Si el usuario cierra el modal mientras el batch está en progreso, el sistema DEBE abortar peticiones pendientes via `AbortController` y NO persistir resultados parciales.

#### Scenario: Cierre durante ejecución

- GIVEN el batch está en progreso (3 de 5 llamadas completadas)
- WHEN el usuario cierra el modal
- THEN las peticiones pendientes se abortan
- AND no se persisten resultados parciales en estado global

### FR-11: Descripción modificada durante batch

SI el usuario escribe o modifica una descripción MIENTRAS el batch se ejecuta, esa entidad NO DEBE incluirse en el batch actual. Al finalizar, la entidad sin sugerencia permanece clasificable.

#### Scenario: Nueva descripción en medio del batch

- GIVEN el batch está ejecutándose
- WHEN el usuario escribe en una entidad OTRO aún no clasificada
- THEN esa entidad no se agrega al batch en curso
- AND al finalizar, la entidad puede clasificarse en un nuevo clic

### NFR-1: Performance de batch

El sistema DEBE completar el batch de clasificación para 50 entidades OTRO en menos de 15s bajo conexión de banda ancha promedio (latencia < 100ms por request).

#### Scenario: Carga de 50 entidades

- GIVEN 50 entidades OTRO con descripción no vacía
- WHEN se ejecuta el batch
- THEN todas las sugerencias se completan en < 15s
- AND ningún banner queda en estado "cargando"

### I18N: Claves de internacionalización

| Clave | Valor por defecto |
|-------|------------------|
| `learning.preClassify` | Pre clasificar entidades |
| `learning.classify` | Clasificar entidades |
| `learning.suggestionBanner.title` | Sugerencia: {role} |
| `learning.suggestionBanner.confidence` | Confianza: {percent}% |
| `learning.suggestionBanner.lowConfidence` | Confianza baja: {percent}% |
| `learning.suggestionBanner.accept` | Asignar |
| `learning.suggestionBanner.discard` | Descartar |
| `learning.suggestionBanner.edit` | Editar rol manual |
| `learning.suggestionBanner.error` | No disponible ahora. Elegí manualmente. |
| `learning.suggestionBanner.assigned` | Rol asignado: {role} |
| `learning.batch.loading` | Clasificando entidades... |
| `learning.batch.error` | Error al clasificar algunas entidades |
