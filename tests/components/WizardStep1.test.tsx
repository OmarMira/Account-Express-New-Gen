// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useWizardStore } from '@/lib/stores/wizard-store';
import type { WizardEntity } from '@/lib/stores/wizard-store';
import { WizardStep1 } from '@/components/wizard/WizardStep1';

// ─── Mock wizardService to prevent real API calls ───────────────────
vi.mock('@/lib/services/wizard-service', () => ({
  wizardService: {
    fetchEntities: vi.fn(),
    fetchExistingEntityNames: vi.fn(),
    suggestRoleForEntity: vi.fn(),
    createRules: vi.fn(),
    applyAll: vi.fn(),
  },
}));

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
  suggestionStatus: 'success',
  suggestedRole: 'SOCIO',
  suggestionConfidence: 0.85,
};

const debitEntity: WizardEntity = {
  candidate: {
    id: 'entity-2',
    canonicalName: 'AMERICAN EXPRESS',
    occurrences: 3,
    directionProfile: { creditPct: 0, debitPct: 1 },
    sampleDescriptions: ['AMERICAN EXPRESS pago'],
    totalAmount: 3000,
    direction: 'debit',
    amountCluster: 'fixed',
    possibleRecurrence: true,
    avgAmount: 1000,
    frequency: 'monthly',
  },
  assignedRole: null,
  suggestionStatus: 'success',
  suggestedRole: 'TARJETA_CREDITO',
  suggestionConfidence: 0.92,
};

const pendingEntity: WizardEntity = {
  candidate: {
    id: 'entity-3',
    canonicalName: 'PENDING ENTITY',
    occurrences: 2,
    directionProfile: { creditPct: 0.5, debitPct: 0.5 },
    sampleDescriptions: ['PENDING ENTITY ref'],
    totalAmount: 2000,
    direction: 'credit',
    amountCluster: 'variable',
    possibleRecurrence: false,
    avgAmount: 1000,
    frequency: 'irregular',
  },
  assignedRole: null,
  suggestionStatus: 'pending',
};

describe('WizardStep1', () => {
  beforeEach(() => {
    useWizardStore.setState({
      open: true,
      step: 1,
      entities: [creditEntity, debitEntity],
      entitiesLoading: false,
      entitiesError: null,
      proposedRules: [],
      executionStatus: 'idle',
      executionError: null,
      affectedTransactions: 0,
      createdRules: 0,
      stepError: null,
    });
  });

  it('should render entity names in the table', () => {
    render(<WizardStep1 companyId="company-1" />);
    expect(screen.getByText('MERCADO LIBRE')).toBeInTheDocument();
    expect(screen.getByText('AMERICAN EXPRESS')).toBeInTheDocument();
  });

  it('should show credit badge for credit-direction entities', () => {
    render(<WizardStep1 companyId="company-1" />);
    const creditBadges = screen.getAllByText('credit');
    expect(creditBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('should show debit badge for debit-direction entities', () => {
    render(<WizardStep1 companyId="company-1" />);
    const debitBadges = screen.getAllByText('debit');
    expect(debitBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('should show pattern badge for amountCluster', () => {
    render(<WizardStep1 companyId="company-1" />);
    expect(screen.getByText('variable')).toBeInTheDocument();
    expect(screen.getByText('fixed')).toBeInTheDocument();
  });

  it('should show frequency for each entity', () => {
    render(<WizardStep1 companyId="company-1" />);
    expect(screen.getByText('irregular')).toBeInTheDocument();
    expect(screen.getByText('monthly')).toBeInTheDocument();
  });

  it('should show avg amount for each entity', () => {
    render(<WizardStep1 companyId="company-1" />);
    const amounts = screen.getAllByText('$1,000');
    expect(amounts.length).toBe(2); // Both entities have avgAmount 1000
    amounts.forEach((el) => expect(el).toBeInTheDocument());
  });

  it('should show occurrences count', () => {
    render(<WizardStep1 companyId="company-1" />);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('should show role dropdown for each entity', () => {
    render(<WizardStep1 companyId="company-1" />);
    const selects = screen.getAllByTestId('mock-select');
    expect(selects.length).toBe(2);
  });

  it('should call setEntityRole when a role is selected', async () => {
    const setRoleSpy = vi.spyOn(useWizardStore.getState(), 'setEntityRole');
    render(<WizardStep1 companyId="company-1" />);

    const selects = screen.getAllByTestId('mock-select');
    await userEvent.selectOptions(selects[0], 'SOCIO');

    expect(setRoleSpy).toHaveBeenCalledWith('entity-1', 'SOCIO');
    setRoleSpy.mockRestore();
  });

  it('should show the Next button', () => {
    render(<WizardStep1 companyId="company-1" />);
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
  });

  it('should show the Skip link text', () => {
    render(<WizardStep1 companyId="company-1" />);
    expect(screen.getByText(/saltar y continuar después/i)).toBeInTheDocument();
  });

  it('should render WizardEmptyState when no entities are present', () => {
    useWizardStore.setState({ entities: [] });
    render(<WizardStep1 companyId="company-1" />);
    expect(screen.getByText('Todo está al día')).toBeInTheDocument();
  });

  it('should show loading skeleton when entitiesLoading is true', () => {
    useWizardStore.setState({ entitiesLoading: true, entities: [] });
    render(<WizardStep1 companyId="company-1" />);
    const skeleton = document.querySelector('[data-slot="skeleton"]');
    expect(skeleton).toBeInTheDocument();
  });

  it('should call nextStep when Next button is clicked', async () => {
    // Assign at least one role so Next is enabled
    useWizardStore.setState({
      entities: [
        { ...creditEntity, assignedRole: 'SOCIO' as const },
        debitEntity,
      ],
    });
    const nextSpy = vi.spyOn(useWizardStore.getState(), 'nextStep');
    render(<WizardStep1 companyId="company-1" />);

    const nextBtn = screen.getByRole('button', { name: /next/i });
    expect(nextBtn).not.toBeDisabled();

    await userEvent.click(nextBtn);
    expect(nextSpy).toHaveBeenCalledTimes(1);
    nextSpy.mockRestore();
  });

  it('should disable Next button when no entity has an assigned role', () => {
    render(<WizardStep1 companyId="company-1" />);
    const nextBtn = screen.getByRole('button', { name: /next/i });
    expect(nextBtn).toBeDisabled();
  });

  // ─── AI Suggestion features (Fix 1C) ──────────────────────────────

  it('should show confidence badge for entities with successful suggestion', () => {
    render(<WizardStep1 companyId="company-1" />);
    // Both entities have high confidence — use getAllByText
    const badges = screen.getAllByText(/high/);
    expect(badges.length).toBeGreaterThanOrEqual(2);
    // Entity with 0.92 confidence should show "92%"
    expect(screen.getByText(/92%/)).toBeInTheDocument();
  });

  it('should show loading indicator for entities with pending suggestion', () => {
    useWizardStore.setState({
      entities: [pendingEntity],
    });
    render(<WizardStep1 companyId="company-1" />);
    expect(screen.getByText(/Suggesting/)).toBeInTheDocument();
  });

  it('should show error text for entities where suggestion failed', () => {
    useWizardStore.setState({
      entities: [{ ...pendingEntity, suggestionStatus: 'error' as const }],
    });
    render(<WizardStep1 companyId="company-1" />);
    expect(screen.getByText('Suggestion failed')).toBeInTheDocument();
  });

  it('should show dash for entities without suggestion (effect does not fire when mixed statuses)', () => {
    // Mix of success + pending — effect won't fire since not all are pending
    useWizardStore.setState({
      entities: [
        { ...creditEntity, suggestionStatus: 'success' as const },
        { ...pendingEntity, suggestionStatus: 'pending' as const },
      ],
    });
    render(<WizardStep1 companyId="company-1" />);
    // Pending entity without suggestion should show dash
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  // ─── stepError display (Fix 3B) ───────────────────────────────────

  it('should show stepError message when set in store', () => {
    useWizardStore.setState({ stepError: 'Asigná al menos un rol a una entidad antes de continuar.' });
    render(<WizardStep1 companyId="company-1" />);
    expect(screen.getByText(/asigná al menos un rol/i)).toBeInTheDocument();
  });

  it('should not show stepError when no error is set', () => {
    render(<WizardStep1 companyId="company-1" />);
    expect(screen.queryByText(/asigná al menos un rol/i)).not.toBeInTheDocument();
  });

  it('should trigger suggestAllRoles when entities are loaded with pending status', async () => {
    const suggestAllRolesSpy = vi.spyOn(useWizardStore.getState(), 'suggestAllRoles');
    useWizardStore.setState({
      entities: [pendingEntity],
      entitiesLoading: false,
    });

    render(<WizardStep1 companyId="test-company" />);

    await waitFor(() => {
      expect(suggestAllRolesSpy).toHaveBeenCalledWith('test-company');
    });
    suggestAllRolesSpy.mockRestore();
  });

  it('should not trigger suggestAllRoles when entities already have suggestions', () => {
    const suggestAllRolesSpy = vi.spyOn(useWizardStore.getState(), 'suggestAllRoles');
    render(<WizardStep1 companyId="company-1" />);

    // Entities already have success status, so suggestAllRoles should not be called
    expect(suggestAllRolesSpy).not.toHaveBeenCalled();
    suggestAllRolesSpy.mockRestore();
  });
});
