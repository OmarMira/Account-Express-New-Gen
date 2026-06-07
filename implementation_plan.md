# Plan de Implementación: Onboarding Invisible, Self-Healing y Manejo de Edge-Cases de Perfiles Bancarios por IA (LLM) (v6.0)

Este plan describe la arquitectura y los pasos para implementar la detección automática, inferencia, auto-sanación (Self-Healing) y robustez frente a edge-cases complejos de perfiles bancarios de forma 100% invisible para el usuario final, utilizando el SDK de IA de la plataforma.

## User Review Required

> [!IMPORTANT]
> Se implementarán las siguientes especificaciones y cambios de diseño:
> 1. **Control del Bucle de Self-Healing (Máx. 1 Intento)**: Para evitar bucles infinitos durante un parseo, el Self-Healing se intentará a lo sumo una única vez por subida de PDF. Si falla o lanza un error, se aborta el reintento y se registra la advertencia.
> 2. **Cooldown de 24 Horas**: Si un perfil bancario fue regenerado por el LLM hace menos de 24 horas y continúa fallando la reconciliación, no se gatillará el Self-Healing. Esto evita llamadas redundantes y costos de API excesivos si el PDF del banco contiene un error de datos de origen irresoluble para el parser.
> 3. **Deduplicación Jaccard Clara**: El flujo de Jaccard comparará el perfil inferido por el LLM con el set de perfiles existentes de la base de datos (umbral $\ge 0.6$). Si coincide, actualiza la configuración existente; si no, genera un nuevo `bankId` mediante SHA-256 de fingerprints ordenados.
> 4. **Cero Hardcodeo de Parada (stopPatterns)**: Se eliminará completamente la lista de parada estática del parser (`stopPatterns` que incluía `'service fee'`, `'monthly fee'`, etc.). El parser ahora dependerá exclusivamente de la propiedad `stopSectionRegex` provista por el perfil bancario.
> 5. **Ajuste del Promp del LLM**: Se actualizará el prompt del LLM en `bank-profile-onboarding.ts` para asegurar que las secciones que contienen transacciones (como "Service fees" o "Monthly fee") nunca se incluyan en el `stopSectionRegex` y, en su lugar, se usen límites reales como `"Daily ledger balances"`.
> 6. **Advertencias para Experiencia de Usuario (UX)**: La interfaz `ParsedPDFResult` incluirá banderas informativas (`warnings`, `selfHealingAttempted`, `selfHealingSuccess`) para que el frontend pueda reportar de forma transparente al usuario o administrador si hubo una reparación automática exitosa o si se requiere asistencia del soporte.

---

## 📋 Respuestas a las Exigencias de Planificación Técnica

### 1. Lista de Archivos a Modificar
No se crearán ni eliminarán archivos para esta corrección, solo se modificará código existente de manera quirúrgica:
* **`src/lib/pdf-parser.ts`** (Modificación): Remover stop patterns harcodeados y depender solo de la regex del perfil.
* **`src/lib/bank-profiles/boa-standard.json`** (Modificación): Agregar regla de parada estática para Bank of America.
* **`src/lib/bank-profile-onboarding.ts`** (Modificación): Refinar el prompt del LLM para guiar la generación de `stopSectionRegex` dinámico.

---

### 2. Cambios Específicos por Archivo

#### A. [pdf-parser.ts](file:///c:/Users/PC%20Omar/Downloads/sistema/src/lib/pdf-parser.ts)
* **Eliminar** (líneas 259-266 aprox.):
  ```typescript
  const stopPatterns = [
    'daily ledger',
    'balance summary',
    'service fee',
    'service charge',
    'monthly fee',
    'important information'
  ];
  ```
* **Modificar** (líneas 267-270 aprox.):
  ```typescript
  const hasStopPattern = stopPatterns.some(p => lower.includes(p)) || (
    profile.config.rules.stopSectionRegex &&
    new RegExp(profile.config.rules.stopSectionRegex, 'i').test(lineText)
  );
  ```
  **Por:**
  ```typescript
  // Check stopSectionRegex only (zero-hardcoding principle)
  const hasStopPattern = !!(
    profile.config.rules.stopSectionRegex &&
    new RegExp(profile.config.rules.stopSectionRegex, 'i').test(lineText)
  );
  ```

#### B. [boa-standard.json](file:///c:/Users/PC%20Omar/Downloads/sistema/src/lib/bank-profiles/boa-standard.json)
* **Agregar** la propiedad `stopSectionRegex` dentro del bloque `rules`:
  ```json
  "rules": {
    "anchor": {
      "regex": "^\\d{1,2}/\\d{1,2}/\\d{2,4}$",
      "columnRange": [0.0, 0.18]
    },
    "columns": {
      "date": [0.0, 0.18],
      "description": [0.18, 0.80],
      "amount": [0.80, 1.00]
    },
    "metadata": { ... },
    "stopSectionRegex": "Daily ledger balances|Daily Ledger Balances|Daily Ledger"
  }
  ```

#### C. [bank-profile-onboarding.ts](file:///c:/Users/PC%20Omar/Downloads/sistema/src/lib/bank-profile-onboarding.ts)
* **Modificar** la regla número 4 en el system prompt de la IA:
  ```text
  4. stopSectionRegex:
     Identify text like 'Daily ledger balances' or 'Daily ledger' to stop parsing transactions. Do NOT include transaction headers or sections that may contain actual transactions (e.g., 'Service fees' or 'Monthly fee') in stopSectionRegex if they list transactions underneath.
  ```

---

### 3. Orden de Implementación
Para garantizar un flujo controlado y sin roturas parciales, seguiremos esta secuencia:
1. **Paso 1: Configuración**: Modificar `src/lib/bank-profiles/boa-standard.json`. Esto define la parada segura de forma declarativa para Bank of America.
2. **Paso 2: Prompting**: Modificar `src/lib/bank-profile-onboarding.ts`. Asegura que si el LLM se gatilla dinámicamente, genere la configuración bajo las nuevas reglas de diseño.
3. **Paso 3: Core Parser**: Modificar `src/lib/pdf-parser.ts`. Removemos el código hardcodeado, forzando al parser a confiar únicamente en la configuración.

---

### 4. Estrategia de Verificación

* **Verificación 1 (Tests de Integración)**: Correr la suite completa de tests automatizados para validar que no haya regresiones en los perfiles simulados:
  ```powershell
  bun test tests/integration/invisible-onboarding.test.ts
  ```
* **Verificación 2 (Pruebas con PDFs Reales)**: Ejecutar el script contra la base de datos de 12 PDFs reales:
  ```powershell
  bun run scripts/test-real-pdfs.ts
  ```
  **Criterio de Aceptación:**
  - Los 12 meses de Bank of America deben reportar `⚖️ Reconciliación matemática: ✅ VÁLIDA` con `Diferencia (mismatch): $0`.
  - El indicador `Self-Healing intentado` debe ser `No` para todos (ya que la reconciliación pasará en el primer intento al extraer los cargos correctos).

---

### 5. Análisis de Efectos Secundarios y Mitigación
* **Efecto secundario potencial**: Otros perfiles bancarios antiguos en base de datos que carezcan de `stopSectionRegex` podrían continuar parseando texto basura de ledgers.
* **Mitigación**:
  - El motor de parseo ya exige que la línea comience con una fecha válida (`lineAnchor`) en la columna correspondiente.
  - La mayoría de las secciones no transaccionales de bancos estándar no empiezan con fechas formateadas en la columna de inicio de transacción.
  - Si un banco desconocido tiene ledgers con fechas, el flujo matemático de reconciliación fallará y gatillará de inmediato el **Self-Healing** automático para re-onboardear el perfil con el `stopSectionRegex` dinámico correcto generado por el LLM.

---

### 6. Plan de Rollback
* El proceso se manejará utilizando Git con commits incrementales específicos por paso.
* En caso de fallo catastrófico en las pruebas de reconciliación, se revertirán los cambios a su estado baseline mediante:
  ```powershell
  git checkout -- src/lib/pdf-parser.ts src/lib/bank-profile-onboarding.ts src/lib/bank-profiles/boa-standard.json
  ```
