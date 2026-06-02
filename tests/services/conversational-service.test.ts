import { describe, it, expect } from 'vitest';
import { localHeuristicParse } from '@/lib/services/conversational-service';

describe('ConversationalService Heuristics', () => {
  it('debe priorizar el rol SOCIO sobre el tipo GASTO según la prioridad configurada', () => {
    // GIVEN a classification request with userInput: "socio retiro gasto capital"
    // WHEN localHeuristicParse is called
    // THEN it MUST return role "SOCIO" and account "3010" because SOCIO has higher priority than GASTO_OPERATIVO/GASTO
    const result = localHeuristicParse('socio retiro gasto capital');
    expect(result.role).toBe('SOCIO');
    expect(result.glAccountCode).toBe('3010');
  });

  it('debe caer en el rol fallback por defecto si nada coincide', () => {
    // GIVEN a classification request with userInput: "unknown descriptor"
    // WHEN no keywords match any configuration rules
    // THEN it MUST fallback to the default role "PROVEEDOR" and account "6070"
    const result = localHeuristicParse('unknown descriptor');
    expect(result.role).toBe('PROVEEDOR');
    expect(result.glAccountCode).toBe('6070');
  });

  it('debe priorizar EMPLEADO sobre GASTO_OPERATIVO si la prioridad está definida', () => {
    const result = localHeuristicParse('gasto de salario del empleado');
    expect(result.role).toBe('EMPLEADO');
    expect(result.glAccountCode).toBe('6030');
  });
});
