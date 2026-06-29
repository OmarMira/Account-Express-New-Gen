# Delta for Re-exports

## ADDED Requirements

### Requirement: REQ-REX-01 — `entity-detector.ts` re-exports `jaroWinkler`

The system MUST add a re-export in `entity-detector.ts` that re-exports `jaroWinkler` from `src/lib/utils/string-similarity.ts`.

#### Scenario: Re-export chains correctly

- GIVEN `entity-detector.ts` with `export { jaroWinkler } from './utils/string-similarity'`
- WHEN a module imports `jaroWinkler` from `entity-detector`
- THEN `jaroWinkler` resolves to the function defined in `string-similarity.ts`
- AND the function behaviour is identical to a direct import from `string-similarity`

### Requirement: REQ-REX-02 — All existing imports continue to work

Existing import statements `import { jaroWinkler } from 'src/lib/services/entity-detector'` MUST resolve without error. No existing caller SHALL be modified.

#### Scenario: Existing caller imports resolve

- GIVEN an existing file `src/lib/some-service.ts` with `import { jaroWinkler } from '../services/entity-detector'`
- WHEN the project is type-checked with `npx tsc --noEmit`
- THEN no module-resolution or type errors occur
- AND `jaroWinkler` is a callable function with the same signature

### Requirement: REQ-REX-03 — New code can import directly from string-similarity

New code SHOULD import `jaroWinkler` from `src/lib/utils/string-similarity` directly. The `entity-detector.ts` re-export exists for backward compatibility only.

#### Scenario: Direct import resolves

- GIVEN a new file `src/lib/new-feature.ts`
- WHEN it imports `{ jaroWinkler }` from `'../utils/string-similarity'`
- THEN the import resolves correctly
- AND all types and function signatures match the re-exported version
