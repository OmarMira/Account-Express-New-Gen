# SDD Project Context: Account-Express-New-Gen

This document serves as the persistent context for Spec-Driven Development (SDD) in the `Account-Express-New-Gen` project, initialized in `engram` mode.

## 🛠️ Stack & Architecture

- **Framework**: Next.js 16 (v16.1.1) & React 19 (v19.0.0)
- **Language**: TypeScript (v5)
- **Styling**: Tailwind CSS v4 & shadcn/ui (Radix Primitives, class-variance-authority, clsx)
- **Database/ORM**: Prisma ORM (v6.11.1) with SQLite (`dev.db` / `test.db`)
- **Package Manager**: Bun (using `bun.lock` / `package-lock.json`)
- **Telemetry & Monitoring**: Sentry (`@sentry/nextjs`)
- **Internationalization**: `next-intl`
- **Authentication**: `next-auth`

## 🧪 Testing & Verification Capabilities

- **Test Runner**: Vitest (v4.1.7)
  - Configured in `vitest.config.ts`
  - Uses `tests/setup.ts` and `tests/globalTeardown.ts`
  - Automated test db isolated to `test.db`
- **Linting**: ESLint (v9) via `bun run lint`
- **Formatting**: Prettier (v3.8.3) via `bun run format`
- **Type Checking**: TypeScript Compiler (`bun x tsc --noEmit`)
- **CI/CD Validation Pipeline**: Configured in `.github/workflows/ci-cd.yml`
  - Runs strict type checks: `bun x tsc --noEmit`
  - Runs custom validation gates:
    - Accounting full-cycle check: `bun run scripts/run-full-cycle-check.ts`
    - RBAC isolation tests: `bun run scripts/test-rbac-isolation.ts`
    - Assistant engine tests: `bun run scripts/test-assistant-engine.ts`
    - Predictive engine tests: `bun run scripts/test-predictive-engine.ts`
    - Learning loop tests: `bun run scripts/test-learning-loop.ts`
    - Budget engine tests: `bun run scripts/test-budget-engine.ts`

## ⚙️ Strict TDD Mode

- **Status**: **Enabled (`strict_tdd: true`)**
- **Reasoning**: The project contains a fully-configured test runner (Vitest) and comprehensive validation gates in the CI/CD pipeline, making strict test-driven workflows highly supported and recommended.
