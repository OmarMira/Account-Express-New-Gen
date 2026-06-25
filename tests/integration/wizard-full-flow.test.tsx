// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WizardDialog } from '@/components/wizard/WizardDialog';
import { useWizardStore } from '@/lib/stores/wizard-store';
import type { EntityCandidate } from '@/lib/services/entity-detector';

// ─── Mock wizardService API layer ─────────────────────────────────────
vi.mock('@/lib/services/wizard-service', () => ({
  wizardService: {
    fetchEntities: vi.fn(),
    fetchExistingEntityNames: vi.fn(),
    suggestRoleForEntity: vi.fn(),
    createRules: vi.fn(),
    applyAll: vi.fn(),
  },
}));

// ─── Mock shadcn Select as native <select> for jsdom compatibility ────
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

// ─── Mock Progress (simplified for jsdom) ─────────────────────────────
vi.mock('@/components/ui/progress', () => ({
  Progress: () => <div data-testid="mock-progress" />,
}));

afterEach(() => cleanup());

// ─── Fixtures ─────────────────────────────────────────────────────────
const creditCandidate: EntityCandidate = {
  id: 'entity-1',
  canonicalName: 'MERCADO LIBRE',
  occurrences: 5,
  directionProfile: { creditPct: 1, debitPct: 0 },
  sampleDescriptions: ['MERCADO LIBRE pago', 'MERCADO LIBRE compra'],
  totalAmount: 5000,
  direction: 'credit',
  amountCluster: 'variable',
  possibleRecurrence: false,
  avgAmount: 1000,
  frequency: 'irregular',
};

const debitCandidate: EntityCandidate = {
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
};

describe('Wizard Full Flow Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWizardStore.setState({
      open: false,
      step: 1,
      entities: [],
      entitiesLoading: false,
      entitiesError: null,
      proposedRules: [],
      executionStatus: 'idle',
      executionError: null,
      affectedTransactions: 0,
      createdRules: 0,
    });
  });

  it('full flow: open → step 1 with entities → assign role → next → step 2 → confirm → next → step 3 → execute → done', async () => {
    // ── Arrange: mock API responses ────────────────────────────────
    const { wizardService } = await import('@/lib/services/wizard-service');
    (wizardService.fetchEntities as ReturnType<typeof vi.fn>).mockResolvedValue([
      creditCandidate,
      debitCandidate,
    ]);
    (wizardService.fetchExistingEntityNames as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (wizardService.createRules as ReturnType<typeof vi.fn>).mockResolvedValue([
      { status: 'fulfilled', value: { data: { id: 'r1' } } },
      { status: 'fulfilled', value: { data: { id: 'r2' } } },
    ]);
    (wizardService.applyAll as ReturnType<typeof vi.fn>).mockResolvedValue({
      matched: 15,
      total: 20,
    });

    // ── Step 1: Open wizard ────────────────────────────────────────
    useWizardStore.getState().openWizard();
    expect(useWizardStore.getState().open).toBe(true);
    expect(useWizardStore.getState().step).toBe(1);

    // Fetch entities (simulates the caller calling fetchEntities after openWizard)
    await useWizardStore.getState().fetchEntities('company-1');

    // ── Act: Render dialog ──────────────────────────────────────────
    render(<WizardDialog companyId="company-1" />);

    // ── Verify step 1 shows entities ────────────────────────────────
    expect(screen.getByText('MERCADO LIBRE')).toBeInTheDocument();
    expect(screen.getByText('AMERICAN EXPRESS')).toBeInTheDocument();
    expect(screen.getByText(/configuración inteligente — clasificar entidades/i)).toBeInTheDocument();

    // ── Assign roles to entities ─────────────────────────────────────
    const selects = screen.getAllByTestId('mock-select');
    expect(selects).toHaveLength(2);

    // Assign SOCIO role to MERCADO LIBRE (first select)
    await userEvent.selectOptions(selects[0], 'SOCIO');
    const stateAfterRole = useWizardStore.getState();
    expect(stateAfterRole.entities[0].assignedRole).toBe('SOCIO');

    // Assign CLIENTE role to AMERICAN EXPRESS (second select)
    await userEvent.selectOptions(selects[1], 'CLIENTE');
    expect(useWizardStore.getState().entities[1].assignedRole).toBe('CLIENTE');

    // ── Click Next → navigate to step 2 ──────────────────────────────
    const nextButtons = screen.getAllByRole('button', { name: /next/i });
    await userEvent.click(nextButtons[0]);

    // ── Step 2: Verify proposed rules are shown ──────────────────────
    await waitFor(() => {
      expect(useWizardStore.getState().step).toBe(2);
    });
    // After nextStep, buildProposedRules should have created rules
    expect(useWizardStore.getState().proposedRules).toHaveLength(2);
    expect(screen.getByText(/revisar reglas propuestas/i)).toBeInTheDocument();
    // Entity names should still be visible
    expect(screen.getByText('MERCADO LIBRE')).toBeInTheDocument();
    expect(screen.getByText('AMERICAN EXPRESS')).toBeInTheDocument();

    // ── Confirm rules ────────────────────────────────────────────────
    // Toggle confirmation for the first rule (MERCADO LIBRE)
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);
    await userEvent.click(checkboxes[0]);

    await waitFor(() => {
      expect(useWizardStore.getState().proposedRules[0].isConfirmed).toBe(true);
    });

    // Also confirm second rule
    await userEvent.click(checkboxes[1]);

    await waitFor(() => {
      expect(useWizardStore.getState().proposedRules[1].isConfirmed).toBe(true);
    });

    // ── Click Next → step 3 ──────────────────────────────────────────
    const step2NextButtons = screen.getAllByRole('button', { name: /next/i });
    await userEvent.click(step2NextButtons[0]);

    await waitFor(() => {
      expect(useWizardStore.getState().step).toBe(3);
    });
    expect(screen.getByText(/aplicar reglas/i)).toBeInTheDocument();

    // ── Click Ejecutar → execution ───────────────────────────────────
    const ejecutarButton = screen.getByRole('button', { name: /ejecutar/i });
    await userEvent.click(ejecutarButton);

    // ── Step 3 done: Verify completion state ─────────────────────────
    await waitFor(() => {
      expect(useWizardStore.getState().executionStatus).toBe('done');
    });

    // Should show created rules summary (text is split across elements)
    expect(screen.getByText(/reglas creadas exitosamente/i)).toBeInTheDocument();
    expect(screen.getByText(/transacciones afectadas/i)).toBeInTheDocument();
    expect(screen.getByText('Completado')).toBeInTheDocument();

    // Verify store values
    const finalState = useWizardStore.getState();
    expect(finalState.createdRules).toBe(2);
    expect(finalState.affectedTransactions).toBe(15);

    // Verify service was called correctly (rules will have isConfirmed=true at execution time)
    expect(wizardService.createRules).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ entityName: 'MERCADO LIBRE', isConfirmed: true }),
        expect.objectContaining({ entityName: 'AMERICAN EXPRESS', isConfirmed: true }),
      ]),
      'company-1',
    );
    expect(wizardService.applyAll).toHaveBeenCalledWith('company-1');
  });

  it('delta filter: excludes entities that already have a bank rule', async () => {
    const { wizardService } = await import('@/lib/services/wizard-service');

    // Mock: MERCADO LIBRE has an existing rule
    (wizardService.fetchExistingEntityNames as ReturnType<typeof vi.fn>).mockResolvedValue([
      'mercado libre',
    ]);

    // Both candidates returned by API
    (wizardService.fetchEntities as ReturnType<typeof vi.fn>).mockResolvedValue([
      creditCandidate,
      debitCandidate,
    ]);

    // Open wizard and fetch entities
    useWizardStore.getState().openWizard();
    await useWizardStore.getState().fetchEntities('company-1');

    render(<WizardDialog companyId="company-1" />);

    // MERCADO LIBRE should be filtered out; only AMERICAN EXPRESS should show
    expect(screen.queryByText('MERCADO LIBRE')).not.toBeInTheDocument();
    expect(screen.getByText('AMERICAN EXPRESS')).toBeInTheDocument();

    // Verify store has only 1 entity (the filtered result)
    const state = useWizardStore.getState();
    expect(state.entities).toHaveLength(1);
    expect(state.entities[0].candidate.canonicalName).toBe('AMERICAN EXPRESS');
  });

  it('handles empty state when all entities are filtered out', async () => {
    const { wizardService } = await import('@/lib/services/wizard-service');

    // Both entities have existing rules
    (wizardService.fetchExistingEntityNames as ReturnType<typeof vi.fn>).mockResolvedValue([
      'mercado libre',
      'american express',
    ]);

    (wizardService.fetchEntities as ReturnType<typeof vi.fn>).mockResolvedValue([
      creditCandidate,
      debitCandidate,
    ]);

    useWizardStore.getState().openWizard();
    await useWizardStore.getState().fetchEntities('company-1');

    render(<WizardDialog companyId="company-1" />);

    // Should show empty state
    expect(useWizardStore.getState().entities).toHaveLength(0);
    expect(screen.getByText(/todo está al día/i)).toBeInTheDocument();
  });

  it('shows loading state during API fetch', () => {
    useWizardStore.setState({
      open: true,
      step: 1,
      entitiesLoading: true,
      entities: [],
    });

    render(<WizardDialog companyId="company-1" />);
    // Skeleton elements are rendered during loading state
    const skeletons = document.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });
});
