// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useWizardStore } from '@/lib/stores/wizard-store';
import type { WizardEntity, ProposedRule } from '@/lib/stores/wizard-store';
import { WizardDialog } from '@/components/wizard/WizardDialog';

// ─── Mock shadcn Select as native <select> for jsdom ────────────────
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children, disabled }: any) => (
    <select
      data-testid="mock-select"
      value={value ?? ''}
      onChange={(e) => onValueChange?.(e.target.value)}
      disabled={disabled}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ className, children, ...props }: any) => (
    <div data-testid="mock-select-trigger" {...props}>{children}</div>
  ),
  SelectValue: ({ placeholder }: any) => (
    <span data-testid="mock-select-value">{placeholder}</span>
  ),
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
  SelectGroup: ({ children }: any) => <>{children}</>,
  SelectLabel: () => null,
  SelectSeparator: () => null,
}));

afterEach(() => cleanup());

// ─── Fixtures ───────────────────────────────────────────────────────
const creditEntity: WizardEntity = {
  candidate: {
    id: 'entity-1',
    canonicalName: 'MERCADO LIBRE',
    occurrences: 5,
    directionProfile: { creditPct: 1, debitPct: 0 },
    sampleDescriptions: ['MERCADO LIBRE pago'],
    totalAmount: 5000,
    direction: 'credit',
    amountCluster: 'variable',
    possibleRecurrence: false,
    avgAmount: 1000,
    frequency: 'irregular',
  },
  assignedRole: null,
  suggestionStatus: 'pending',
};

const testRules: ProposedRule[] = [
  {
    id: 'rule-entity-1',
    entityId: 'entity-1',
    entityName: 'MERCADO LIBRE',
    role: 'SOCIO',
    conditionType: 'contains',
    conditionValue: 'MERCADO LIBRE',
    transactionDirection: 'any',
    debitGlAccountId: '3040',
    creditGlAccountId: '3010',
    isConfirmed: true,
  },
];

describe('WizardDialog', () => {
  beforeEach(() => {
    useWizardStore.setState({
      open: true,
      step: 1,
      entities: [creditEntity],
      entitiesLoading: false,
      entitiesError: null,
      proposedRules: [],
      executionStatus: 'idle',
      executionError: null,
      affectedTransactions: 0,
      createdRules: 0,
    });
  });

  it('should not render anything when open is false', () => {
    useWizardStore.setState({ open: false });
    const { container } = render(<WizardDialog companyId="company-1" />);
    // Dialog should not be present when closed
    const dialog = container.querySelector('[data-slot="dialog"]');
    expect(dialog).toBeNull();
  });

  it('should render step 1 content when step is 1', () => {
    useWizardStore.setState({ step: 1, entities: [creditEntity] });
    render(<WizardDialog companyId="company-1" />);
    expect(screen.getByText('MERCADO LIBRE')).toBeInTheDocument();
  });

  it('should render step 2 content when step is 2', () => {
    useWizardStore.setState({
      step: 2,
      proposedRules: testRules,
    });
    render(<WizardDialog companyId="company-1" />);
    expect(screen.getByText('MERCADO LIBRE')).toBeInTheDocument();
    // Should show rule review title
    expect(screen.getByText(/revisar reglas/i)).toBeInTheDocument();
  });

  it('should render step 3 content when step is 3', () => {
    useWizardStore.setState({ step: 3 });
    render(<WizardDialog companyId="company-1" />);
    expect(screen.getByText(/aplicar reglas/i)).toBeInTheDocument();
  });

  it('should show step 1 title "Configuración Inteligente — Clasificar Entidades"', () => {
    useWizardStore.setState({ step: 1 });
    render(<WizardDialog companyId="company-1" />);
    expect(screen.getByText(/configuración inteligente/i)).toBeInTheDocument();
    expect(screen.getByText(/clasificar entidades/i)).toBeInTheDocument();
  });

  it('should show step 2 title "Revisar Reglas Propuestas"', () => {
    useWizardStore.setState({
      step: 2,
      proposedRules: testRules,
    });
    render(<WizardDialog companyId="company-1" />);
    expect(screen.getByText(/revisar reglas propuestas/i)).toBeInTheDocument();
  });

  it('should show step 3 title "Aplicar Reglas"', () => {
    useWizardStore.setState({ step: 3 });
    render(<WizardDialog companyId="company-1" />);
    expect(screen.getByText(/aplicar reglas/i)).toBeInTheDocument();
  });

  it('should call closeWizard when dialog close button is clicked', async () => {
    // Need to access the close button via the closeWizard spy
    const closeSpy = vi.spyOn(useWizardStore.getState(), 'closeWizard');
    render(<WizardDialog companyId="company-1" />);

    // The dialog has an X close button; click it
    const closeBtn = document.querySelector('[data-slot="dialog-close"]');
    expect(closeBtn).toBeInTheDocument();
    if (closeBtn) {
      await userEvent.click(closeBtn);
      expect(closeSpy).toHaveBeenCalledTimes(1);
    }
    closeSpy.mockRestore();
  });

  it('should show step indicator dots/numbers at the top', () => {
    render(<WizardDialog companyId="company-1" />);
    // Should show "1", "2", "3" step indicators
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
