// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useWizardStore } from '@/lib/stores/wizard-store';
import { WizardStep3 } from '@/components/wizard/WizardStep3';

afterEach(() => cleanup());

describe('WizardStep3', () => {
  beforeEach(() => {
    useWizardStore.setState({
      open: true,
      step: 3,
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

  it('should render the Ejecutar button when executionStatus is idle', () => {
    render(<WizardStep3 companyId="company-1" />);
    expect(screen.getByRole('button', { name: /ejecutar/i })).toBeInTheDocument();
  });

  it('should call executeApply when Ejecutar is clicked', async () => {
    const executeSpy = vi.spyOn(useWizardStore.getState(), 'executeApply');
    render(<WizardStep3 companyId="company-1" />);

    const ejecutarBtn = screen.getByRole('button', { name: /ejecutar/i });
    await userEvent.click(ejecutarBtn);

    expect(executeSpy).toHaveBeenCalledWith('company-1');
    executeSpy.mockRestore();
  });

  it('should show loading state when executionStatus is loading', () => {
    useWizardStore.setState({ executionStatus: 'loading' });
    render(<WizardStep3 companyId="company-1" />);
    // Should not show the Ejecutar button during loading
    expect(screen.queryByRole('button', { name: /ejecutar/i })).not.toBeInTheDocument();
    // Should show a loading indicator (progress, spinner, etc.)
    expect(screen.getByText(/aplicando/i)).toBeInTheDocument();
  });

  it('should show success summary when executionStatus is done', () => {
    useWizardStore.setState({
      executionStatus: 'done',
      affectedTransactions: 15,
      createdRules: 3,
    });
    render(<WizardStep3 companyId="company-1" />);

    expect(screen.getByText(/completado/i)).toBeInTheDocument();
    expect(screen.getByText(/15/)).toBeInTheDocument();
    expect(screen.getByText(/3/)).toBeInTheDocument();
  });

  it('should show error message with retry when executionStatus is error', () => {
    useWizardStore.setState({
      executionStatus: 'error',
      executionError: 'API connection failed',
    });
    render(<WizardStep3 companyId="company-1" />);

    expect(screen.getByText(/API connection failed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reintentar|retry/i })).toBeInTheDocument();
  });

  it('should call executeApply again on retry after error', async () => {
    useWizardStore.setState({
      executionStatus: 'error',
      executionError: 'Failed',
    });
    const executeSpy = vi.spyOn(useWizardStore.getState(), 'executeApply');
    render(<WizardStep3 companyId="company-1" />);

    const retryBtn = screen.getByRole('button', { name: /reintentar|retry/i });
    await userEvent.click(retryBtn);

    expect(executeSpy).toHaveBeenCalledWith('company-1');
    executeSpy.mockRestore();
  });

  it('should disable Back button during execution', () => {
    useWizardStore.setState({ executionStatus: 'loading' });
    render(<WizardStep3 companyId="company-1" />);

    const backBtn = screen.getByRole('button', { name: /back|atrás/i });
    expect(backBtn).toBeDisabled();
  });

  it('should show Close button after execution completes', () => {
    useWizardStore.setState({
      executionStatus: 'done',
      affectedTransactions: 5,
      createdRules: 2,
    });
    render(<WizardStep3 companyId="company-1" />);

    expect(screen.getByRole('button', { name: /cerrar|close/i })).toBeInTheDocument();
  });
});
