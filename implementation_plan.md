# Plan de Implementación: Refinamiento de Simulación, Respuestas Rápidas y Condiciones por Defecto

Este plan describe las correcciones técnicas para:
1. Filtrar las "Respuestas Rápidas" (Smart Chips) para que no muestren subcuentas de clientes específicos.
2. Permitir que la simulación de transacciones se actualice y muestre correctamente "Coincide con 0 transacciones" cuando el usuario edita o borra el texto de búsqueda de condiciones (evitando el error de validación 400).
3. Asegurar que si la IA falla (activando la heurística local) o devuelve condiciones vacías, se genere automáticamente una condición de coincidencia por defecto con el nombre de la entidad (`description contains pattern`).

## User Review Required

> [!NOTE]
> Se agregará una regla de salvaguarda en el backend: si el objeto devuelto por la IA o el fallback local carece de condiciones, se inyectará una condición por defecto para buscar el nombre de la entidad en la descripción de las transacciones bancarias.

## Proposed Changes

### Componente 1: API de Respuestas Rápidas (Smart Chips)

#### [MODIFY] [route.ts (top-accounts)](file:///c:/Users/PC%20Omar/Downloads/sistema/src/app/api/bank-rules/top-accounts/route.ts)
* Modificar la consulta a base de datos de `GlAccount` para que solo obtenga cuentas principales (`parentId: null`), evitando así sugerir subcuentas de terceros (ej: Rodrigo Ochoa o Laura Quijano) como clasificaciones genéricas para otros clientes. (COMPLETADO)

### Componente 2: API de Simulación de Reglas

#### [MODIFY] [route.ts (simulate)](file:///c:/Users/PC%20Omar/Downloads/sistema/src/app/api/learning/rules/simulate/route.ts)
* Modificar la validación Zod de las condiciones (`conditionSchema`) de:
  ```typescript
  value: z.string().min(1)
  ```
  a:
  ```typescript
  value: z.string()
  ```
  Esto permite valores vacíos durante la edición de las condiciones en el cliente, respondiendo exitosamente (200) con `matchCount: 0` y evitando el error `400 Bad Request`. (COMPLETADO)

### Componente 3: Lógica Contable Conversacional

#### [MODIFY] [conversational-service.ts](file:///c:/Users/PC%20Omar/Downloads/sistema/src/lib/services/conversational-service.ts)
* En la función `parseConversationalContext`, agregar un control para la propiedad `conditions`:
  ```typescript
  let conditions = parsed.conditions;
  if (!conditions || !Array.isArray(conditions) || conditions.length === 0) {
    conditions = [{ field: 'description', operator: 'contains', value: pattern }];
  }
  ```
  Esto garantiza que siempre haya al menos una condición que filtre las transacciones que contengan el nombre de la entidad (ej: `"omar mira"`).

## Verification Plan

### Automated Tests
- Ejecutar el set de pruebas TypeScript y Vitest para validar que no haya roturas en la simulación:
  ```powershell
  npx tsc --noEmit
  npm test
  ```

### Manual Verification
1. Abrir el constructor conversacional de reglas.
2. Comprobar que al recibir una respuesta de clasificación para "omar mira" se autogenera la condición de coincidencia `Descripción contiene omar mira`.
