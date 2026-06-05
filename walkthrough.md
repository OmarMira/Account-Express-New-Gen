# Walkthrough: Implementación de Memoria Persistente (SystemMemory - Tipo Engram)

Este documento detalla los cambios realizados y validados para el nuevo sistema de memoria persistente del Asistente de IA en AccountExpress.

---

## 🛠️ Cambios Realizados

### 1. Configuración Externa (`rules/memory-config.json`)
* Creado el archivo de configuración con stop-words bilingües (ES/EN) y límites del motor de inyección (`maxMemoriesToInject`, `minKeywordLength`, etc.) garantizando zero hardcoding.

### 2. Base de Datos (`prisma/schema.prisma`)
* Agregado el modelo `SystemMemory` y su relación en `Company`:
```prisma
model SystemMemory {
  id             String    @id @default(cuid())
  companyId      String
  type           String    // 'preference' | 'decision' | 'fact' | 'rule_context'
  title          String
  content        String
  keywords       String    // CSV: "omar,mira,socio"
  importance     Int       @default(5) // Prioridad: escala 1 a 10 (10 = crítico)
  accessCount    Int       @default(0) // Contador de lecturas
  lastAccessedAt DateTime? // Fecha de última lectura para frescura
  embedding      String?   // Reservado para Level 2 (JSON String de float[])
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  company        Company   @relation(fields: [companyId], references: [id], onDelete: Cascade)
  ...
}
```
* Sincronizado el esquema de la base de datos usando `npx prisma db push`.
* Regenerado el Prisma Client (`npx prisma generate`).

### 3. Extractor de Keywords Bilingüe (`src/lib/memory/keyword-extractor.ts`)
* Creado el extractor de términos clave agnóstico que lee la configuración de stop-words en español e inglés y descarta puntuación y números.

### 4. Recuperación con Scoring de Relevancia (`src/app/api/ai-assistant/route.ts`)
* Implementada la función `retrieveMemories` que busca mediante cláusulas `OR` en SQLite, ordena los resultados combinando **importancia** y **frescura** (fecha de actualización), limita los registros a inyectar (máximo 5), y registra de forma asíncrona la fecha de acceso y cantidad de lecturas de la memoria.
* Modificado `handleChat` y `handleCreateRule` para inyectar este contexto en el prompt del sistema.

### 5. Escritura Autónoma con Deduplicación y Auditoría (`src/app/api/ai-assistant/route.ts`)
* Registrado el tool `save_system_memory` en OpenAI.
* Implementado el handler de `save_system_memory` en `executeTool` que:
  * Busca si existe una memoria similar (deduplicación por similitud de keywords o título).
  * Si existe, la actualiza, une las palabras clave únicas e incrementa su importancia (refuerzo de memoria).
  * Si no existe, crea una nueva memoria con importancia inicial 5.
  * Registra la acción `SYSTEM_MEMORY_CREATED` o `SYSTEM_MEMORY_UPDATED` en la tabla de auditoría `AuditLog` utilizando la utilidad robusta del sistema `createAuditLogWithRetry`.

---

## 🧪 Validación y Pruebas Realizadas

1. **Compilación de Código:**
   * La verificación de tipos TypeScript con `npx tsc --noEmit` completó exitosamente sin errores de compilación.
2. **Suite de Pruebas Unitarias e Integración:**
   * Se ejecutó el set completo de pruebas `npx vitest run`.
   * **Resultado:** **78 de 78 pruebas pasadas** exitosamente en 23 archivos de test.

---

## 🛠️ Seguimiento: Correcciones en Asistente de Clasificación Inteligente y Localización

### 1. Corrección de Estado en Botón "Omitir por ahora" (`ConversationalRuleBuilder.tsx`)
* Se solucionó el bug donde al pulsar "Omitir por ahora" (`skipBtn`) se avanzaba al siguiente candidato pero se mantenía la regla/sugerencia anterior en pantalla.
* Se implementó `handleSkip` para reiniciar correctamente los estados (`answer`, `suggestion`, `editableConditions`, `simulationResult`) al saltar candidatos.

### 2. Localización Completa
* Eliminados todos los textos y placeholders hardcodeados en inglés en el editor de condiciones y simulación de transacciones.
* Agregadas y vinculadas correctamente las traducciones bilingües para campos (`Descripción`, `Monto`, `Referencia`), operadores (`Igual a`, `Contiene`, etc.), estados de simulación y el preview modal.

---

## 🛠️ Seguimiento: Refinamiento de Simulación y Respuestas Rápidas (Smart Chips)

### 1. Filtro de Subcuentas en Cuentas Más Usadas (`top-accounts`)
* Se modificó [route.ts (top-accounts)](file:///c:/Users/PC%20Omar/Downloads/sistema/src/app/api/bank-rules/top-accounts/route.ts) para agregar `parentId: null` a la consulta de `GlAccount`.
* Esto previene que subcuentas específicas de clientes/socios (como Rodrigo Ochoa o Laura Quijano) aparezcan como chips de respuestas rápidas para otros candidatos.

### 2. Soporte de Cadenas Vacías en Simulación
* Se modificó [route.ts (simulate)](file:///c:/Users/PC%20Omar/Downloads/sistema/src/app/api/learning/rules/simulate/route.ts) cambiando `value: z.string().min(1)` a `value: z.string()` en `conditionSchema`.
* Esto evita errores `400 Bad Request` al vaciar o editar el texto del buscador de condiciones en tiempo real, permitiendo que la simulación recalcule dinámicamente y devuelva exitosamente `0` coincidencias en lugar de mantener el contador previo.

### 3. Condiciones por Defecto en Fallbacks (`conversational-service.ts`)
* Se modificó [conversational-service.ts](file:///c:/Users/PC%20Omar/Downloads/sistema/src/lib/services/conversational-service.ts) para validar si la lista de condiciones devuelta está vacía o es nula.
* En ese caso, inyecta automáticamente una condición por defecto: `[{ field: 'description', operator: 'contains', value: pattern }]`.
* Esto asegura que el usuario siempre vea una condición editable basada en el nombre de la entidad (ej. `Descripción contiene omar mira`) en lugar de *"Sin condiciones definidas..."* cuando falla la IA externa.


