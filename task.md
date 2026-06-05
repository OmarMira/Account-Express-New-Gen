# Lista de Tareas: Sistema de Memoria Persistente (SystemMemory)

- [x] 1. Crear configuración externa (`rules/memory-config.json`)
- [x] 2. Actualizar esquema Prisma (`prisma/schema.prisma`)
- [x] 3. Ejecutar migración de Prisma
- [x] 4. Crear extractor de keywords bilingüe (`src/lib/memory/keyword-extractor.ts`)
- [x] 5. Actualizar AI Assistant Backend (`src/app/api/ai-assistant/route.ts`)
  - [x] Pasar `userId` de la sesión a `executeTool`
  - [x] Implementar la función `retrieveMemories` con scoring de relevancia
  - [x] Agregar la definición del tool `save_system_memory`
  - [x] Implementar el caso del tool `save_system_memory` con deduplicación y logs de auditoría
- [x] 6. Verificar y validar (compilación TypeScript y pruebas funcionales)
