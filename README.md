# AccountExpress — Next-Gen

Plataforma de contabilidad y conciliación bancaria para SMEs. Automatiza clasificación de transacciones, manejo del plan de cuentas, y cierres contables con asistencia de IA.

---

## Stack

| Capa | Tecnología |
|------|-----------|
| **Framework** | Next.js 16 (App Router) |
| **Lenguaje** | TypeScript 5 |
| **UI** | Tailwind CSS 4 + shadcn/ui + Framer Motion |
| **Estado** | Zustand |
| **ORM** | Prisma 6 |
| **Base de datos** | PostgreSQL |
| **Testing** | Vitest + Testing Library + jsdom |
| **AI** | OpenAI-compatible API (asistente conversacional, clasificación de entidades) |
| **Monitoréo** | Sentry |

## Estructura del proyecto

```
src/
├── app/                    # App Router (API routes + layouts)
│   └── api/                # Backend endpoints (accounts, journal, rules, etc.)
├── components/
│   ├── app/                # AppShell, SidebarNav, DesktopSidebar
│   ├── assistant/          # ChatView, RuleView (AI Assistant modal)
│   ├── accounts/           # AccountTreeRow, AccountTypeSection
│   ├── backup/             # BackupItem, RestoreDropZone
│   ├── import/             # ImportDropZone, ImportResultDialog, MismatchWarningDialog
│   ├── landing/            # LandingComponents (StatCounter, features data)
│   ├── learning/           # ConversationalRuleBuilder, EntityOnboardingModal
│   ├── reconciliation/     # ReconciliationDialogs (split, auto-match, etc.)
│   ├── reports/            # TrialBalanceTab, ReconciliationTab, MovementSummaryCards...
│   ├── spa/                # Main page components (DashboardPage, AccountsPage, etc.)
│   ├── ui/                 # shadcn/ui primitives
│   └── workflow/           # WorkflowPanel
├── hooks/                  # Custom hooks (useCounter, etc.)
├── i18n/                   # Traducciones (es, en)
├── lib/
│   ├── constants/          # Constantes compartidas (account-tree, app-navigation, etc.)
│   ├── services/           # Servicios: signal-collector, decision-engine, reasoning
│   └── types/              # Tipos compartidos (backup, reconciliation, ai-assistant, etc.)
├── providers/              # React context providers
└── store/                  # Zustand stores (auth, language, etc.)
prisma/
├── schema.prisma           # Modelo de datos
└── seed.ts                 # Datos de inicialización
tests/                      # Tests unitarios, de integración, y E2E
```

## Modelo de datos (principales)

```
User ── CompanyMember ── Company
                            ├── GlAccount (plan de cuentas)
                            ├── BankAccount ── BankStatement ── BankTransaction
                            ├── BankRule (reglas de clasificación)
                            ├── JournalEntry ── JournalLine
                            ├── FiscalPeriod
                            ├── ReconciliationPeriod
                            └── EntityContext (entidades: proveedores, clientes, etc.)
```

## Vistas de la aplicación

| Vista | Ruta | Descripción |
|-------|------|-------------|
| `landing` | `/` | Página de aterrizaje |
| `dashboard` | — | Dashboard principal con KPIs |
| `financial-dashboard` | — | Dashboard financiero detallado |
| `accounts` | — | Plan de cuentas (árbol contable) |
| `journal` | — | Diario contable (asientos) |
| `banks` | — | Cuentas bancarias |
| `bank-rules` | — | Reglas de clasificación automática |
| `import` | — | Importación de extractos bancarios |
| `reconciliation` | — | Conciliación bancaria |
| `reports` | — | Reportes (balance, movimientos) |
| `movement-summary` | — | Resumen de movimientos |
| `settings` | — | Configuración de compañía |
| `users` | — | Usuarios de la compañía |
| `backup` | — | Respaldos y restauración |
| `entity-management` | — | Gestión de entidades |
| `admin-users` | — | [Admin] Usuarios del sistema |
| `admin-companies` | — | [Admin] Compañías del sistema |

## Scripts disponibles

```bash
npm run dev       # Desarrollo (puerto 3000, webpack)
npm run build     # Build de producción
npm run start     # Producción (puerto 3000)
npx prisma db push            # Sincronizar schema con DB
npx prisma generate           # Generar cliente Prisma
npx prisma studio             # UI de administración de DB
npx vitest run                # Tests
npx vitest                    # Tests en modo watch
npx tsx prisma/seed.ts        # Poblar DB con datos iniciales
```

## Setup local

1. **Requisitos:** Node.js 20+, npm/bun
2. **Instalar dependencias:**
   ```bash
   npm install
   ```
3. **Configurar variables de entorno:**
   ```bash
   # .env
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/account-express"
   SESSION_SECRET="<generá una clave de 256 bits con: openssl rand --hex 32>"
   # Opcionales — la config de IA se puede setear desde la UI:
   # AI_API_KEY="sk-..."
   # AI_MODEL="gpt-4o"
   ```
   > ⚠️ **`SESSION_SECRET` es obligatorio en producción.** Sin ella, la encriptación de sesiones y claves de IA no tiene una clave determinista. Generala con `openssl rand --hex 32` y nunca la compartas en el repo.
4. **Inicializar base de datos:**
   ```bash
   npx prisma db push
   npx tsx prisma/seed.ts
   ```
5. **Iniciar desarrollo:**
   ```bash
   npm run dev
   ```

## Arquitectura (notas)

- **Server Components + Client Components:** Las páginas SPA en `src/components/spa/` son `'use client'`. La lógica de negocio pesada vive en API routes (`src/app/api/`).
- **Extracción de componentes:** Los archivos de página grandes (>500 líneas) se refactorizan extrayendo secciones inline en componentes dedicados bajo `src/components/<domain>/`.
- **i18n:** Todo texto visible al usuario usa `t()` desde `useLanguageStore`. Archivos de traducción en `src/i18n/locales/`.
- **Strict TDD:** Para cambios en reglas de clasificación y entidades, se escribe la prueba antes del código.
- **Reasoning Layer:** El clasificador de entidades usa un pipeline Signal → Decision → Explanation (ver `src/lib/services/`).

## Testing

```bash
npx vitest run              # Todos los tests
npx vitest run --reporter=verbose  # Con nombres de tests
npx vitest src/lib/services/signal-collector.test.ts  # Test específico
```
