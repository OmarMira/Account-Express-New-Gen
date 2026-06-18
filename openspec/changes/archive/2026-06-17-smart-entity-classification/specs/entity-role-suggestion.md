# Spec: Entity Role Suggestion

## Purpose

Provide AI-powered role suggestions when the user selects OTRO and types a free-text description, reducing manual role selection.

## Requirement: AI Suggestion Endpoint

`POST /api/learning/suggest-role` — accepts `{ description: string }`. Returns `{ suggestedRole: string, confidence: number, explanation: string }`. Uses `parseWithAI()` with a lightweight prompt for entity role analysis. 10s timeout, JSON response format.

#### Scenario: Valid suggestion returned

- GIVEN `{ description: "cobra alquileres mensuales" }`
- WHEN POST /api/learning/suggest-role
- THEN response `{ suggestedRole: "INQUILINO", confidence: 0.92, explanation: "Cobro recurrente de alquiler" }`

## Requirement: Debounced Toast UI

On OTRO selection + free-text input: 1s debounce, min 5 chars before triggering.

| Scenario | UI Behavior |
|----------|-------------|
| confidence >= 0.7 | Toast: "💡 Esto parece {role} ({account}). [ASIGNAR]" → sets role, opens GL pre-filtered |
| confidence < 0.7 | Toast: "No pude determinarlo. ¿Podés describirlo con más detalle?" |
| 2 consecutive fails (low confidence or error) | Toast: "Todavía no puedo determinarlo. Elegí un rol manualmente del dropdown." Then hide suggestion UI for this session |
| AI timeout/network error | Toast: "No disponible ahora. Elegí manualmente." |

#### Scenario: Assign sets canonical role

- GIVEN user types "cobra alquiler" and toast suggests INQUILINO
- WHEN user clicks [ASIGNAR]
- THEN role is set to INQUILINO (NOT OTRO)
- AND GL account selector opens pre-filtered for INQUILINO accounts
