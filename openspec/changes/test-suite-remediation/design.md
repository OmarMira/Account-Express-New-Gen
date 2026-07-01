# Design Note: Test Suite Remediation

This design document outlines the constraints, strategy, and implementation specifications for the test suite remediation.

---

## 1. Architectural Constraints

- **No Public API Contract Modifications**: Public API payloads, fields, and options remain unchanged except for the bug resolutions (specifically casting Decimal to number types for book balance serialization).
- **No DB Schema Changes or Migrations**: No changes are to be made to the Prisma schema (`prisma/schema.prisma`) or the database structure.
- **No Configuration Mutations**: Configuration files (such as `tsconfig.json`, `package.json`, environment variables, Sentry, Svelte/Next configs) must remain untouched.
- **No Faking Test Expectations**: All tests must be resolved by fixing correct mock definitions, aligning tests with active logic, or fixing actual application bugs. Mocks must not fake outcomes of tested units.

---

## 2. Technical Specifications

### A. Validate Request Body Inspection Constraint
In `src/lib/validate-request.ts`, reading the body of the request using `req.text()` or `req.json()` directly consumes the readable stream, setting `bodyUsed = true`. This prevents any subsequent route handler from reading the request body, causing runtime crashes.
- **Solution**: Use `req.clone()` to create a clone of the request object before calling `text()`. The clone's stream will be consumed, leaving the main request stream intact for any downstream route handlers:
  ```typescript
  const clone = req.clone();
  const text = await clone.text();
  ```

### B. Decimal to JS Number Cast in Reconciliation
Prisma's `Decimal` types are serialized to strings by Next.js responses. The reconciliation book balance endpoint in `src/app/api/reconciliation/route.ts` must explicitly cast values to JavaScript numbers using standard `.toNumber()` or `Number()` to align serialization formats with expectations of numeric assertions in tests.

### C. Atomic Duplicate Check Placement in Statement Import
In `src/lib/services/import.service.ts`, the check for existing bank statements must precede the early return for empty unique transactions. This ensures that uploading a duplicate statement file is rejected immediately with a `ConflictError` even if all of its transaction items are already present in the database.
