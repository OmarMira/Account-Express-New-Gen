// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useWizardStore } from '@/lib/stores/wizard-store';
import { WizardEmptyState } from '@/components/wizard/WizardEmptyState';

afterEach(() => cleanup());

describe('WizardEmptyState', () => {
  beforeEach(() => {
    useWizardStore.setState({
      open: true,
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

  it('should render the "Todo está al día" heading', () => {
    render(<WizardEmptyState />);
    expect(screen.getByText('Todo está al día')).toBeInTheDocument();
  });

  it('should render the description text', () => {
    render(<WizardEmptyState />);
    expect(
      screen.getByText('No hay nuevas entidades pendientes de clasificación'),
    ).toBeInTheDocument();
  });

  it('should render a Cerrar button that calls closeWizard', async () => {
    const closeSpy = vi.spyOn(useWizardStore.getState(), 'closeWizard');
    render(<WizardEmptyState />);

    const button = screen.getByRole('button', { name: /cerrar/i });
    expect(button).toBeInTheDocument();

    await userEvent.click(button);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    closeSpy.mockRestore();
  });
});
