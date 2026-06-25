// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useWizardStore } from '@/lib/stores/wizard-store';
import type { ProposedRule } from '@/lib/stores/wizard-store';
import { WizardStep2 } from '@/components/wizard/WizardStep2';

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
    isConfirmed: false,
  },
  {
    id: 'rule-entity-2',
    entityId: 'entity-2',
    entityName: 'AMERICAN EXPRESS',
    role: 'TARJETA_CREDITO',
    conditionType: 'contains',
    conditionValue: 'AMERICAN EXPRESS',
    transactionDirection: 'debit',
    debitGlAccountId: '2020',
    creditGlAccountId: '2020',
    isConfirmed: false,
  },
];

describe('WizardStep2', () => {
  beforeEach(() => {
    useWizardStore.setState({
      open: true,
      step: 2,
      entities: [],
      entitiesLoading: false,
      entitiesError: null,
      proposedRules: testRules,
      executionStatus: 'idle',
      executionError: null,
      affectedTransactions: 0,
      createdRules: 0,
    });
  });

  it('should render entity names from proposed rules', () => {
    render(<WizardStep2 />);
    expect(screen.getByText('MERCADO LIBRE')).toBeInTheDocument();
    expect(screen.getByText('AMERICAN EXPRESS')).toBeInTheDocument();
  });

  it('should render transaction direction for each rule', () => {
    render(<WizardStep2 />);
    expect(screen.getByText('any')).toBeInTheDocument();
    expect(screen.getByText('debit')).toBeInTheDocument();
  });

  it('should render condition value for each rule', () => {
    render(<WizardStep2 />);
    // The condition cell shows "contains 'MERCADO LIBRE'"
    const conditionTexts = screen.getAllByText(/^contains/);
    expect(conditionTexts.length).toBe(2);
    expect(conditionTexts[0]).toBeInTheDocument();
  });

  it('should render GL account code for each rule', () => {
    render(<WizardStep2 />);
    expect(screen.getAllByText(/3040/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/2020/).length).toBeGreaterThanOrEqual(1);
  });

  it('should render a toggle/confirm checkbox per rule', () => {
    render(<WizardStep2 />);
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBe(2);
  });

  it('should have Next button', () => {
    render(<WizardStep2 />);
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
  });

  it('should have Back button', () => {
    render(<WizardStep2 />);
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
  });

  it('should call prevStep when Back is clicked', async () => {
    const prevSpy = vi.spyOn(useWizardStore.getState(), 'prevStep');
    render(<WizardStep2 />);

    const backBtn = screen.getByRole('button', { name: /back/i });
    await userEvent.click(backBtn);

    expect(prevSpy).toHaveBeenCalledTimes(1);
    prevSpy.mockRestore();
  });

  it('should call nextStep when Next is clicked and at least one rule is confirmed', async () => {
    // Confirm one rule
    useWizardStore.setState({
      proposedRules: testRules.map((r, i) => (i === 0 ? { ...r, isConfirmed: true } : r)),
    });
    const nextSpy = vi.spyOn(useWizardStore.getState(), 'nextStep');
    render(<WizardStep2 />);

    const nextBtn = screen.getByRole('button', { name: /next/i });
    expect(nextBtn).not.toBeDisabled();

    await userEvent.click(nextBtn);
    expect(nextSpy).toHaveBeenCalledTimes(1);
    nextSpy.mockRestore();
  });

  it('should disable Next when no rule is confirmed', () => {
    render(<WizardStep2 />);
    const nextBtn = screen.getByRole('button', { name: /next/i });
    expect(nextBtn).toBeDisabled();
  });
});
