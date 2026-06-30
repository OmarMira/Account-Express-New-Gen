// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EntityOnboardingModal } from '@/components/learning/EntityOnboardingModal';

afterEach(() => cleanup());

vi.mock('@/components/ui/select', () => {
  const ALL_INTENTS = [
    'LOAN_PAYMENT',
    'RENT_PAYMENT',
    'OPERATING_EXPENSE',
    'OWNER_CONTRIBUTION',
    'CUSTOMER_PAYMENT',
    'TRANSFER',
    'TAX_PAYMENT',
    'OTHER',
  ];

  return {
    Select: ({ value, onValueChange, disabled }: any) => (
      <select
        aria-label="Transaction Intent"
        data-testid="mock-intent-select"
        value={value ?? 'none'}
        onChange={(event) => onValueChange?.(event.target.value)}
        disabled={disabled}
      >
        <option value="none">Select transaction intent</option>
        {ALL_INTENTS.map((intent) => (
          <option key={intent} value={intent}>
            {intent}
          </option>
        ))}
      </select>
    ),
    SelectTrigger: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
    SelectContent: ({ children }: any) => <>{children}</>,
    SelectItem: ({ children }: any) => <>{children}</>,
  };
});

const tFn = vi.hoisted(() => vi.fn((key: string, params?: Record<string, any>) => {
  const map: Record<string, string> = {
    'learning.transactions': '{count} transactions',
    'learning.directionCredit': 'Income / Credit',
    'learning.directionDebit': 'Expense / Debit',
    'learning.directionMixed': 'Mixed direction',
    'learning.classify': 'Classify entities',
    'learning.close': 'Close',
    'learning.saving': 'Saving...',
    'learning.fetchError': 'Error fetching candidates',
    'learning.loadError': 'Error loading data',
    'learning.intentLabel': 'Transaction Intent',
    'learning.intentPlaceholder': 'Select transaction intent',
    'learning.otroDescription': 'Explain in your own words what this entity represents...',
    'learning.actorTypeLabel': 'Actor Type',
    'learning.onboardingTitle': 'Entity onboarding',
    'learning.onboardingDesc': 'Classify entities by transaction intent.',
    'learning.allClassified': 'All entities classified',
    'learning.classifiedCount': '{count} entities classified',
    'learning.customRoleMissing': '{count} entities need more information',
    'transactionIntent.LOAN_PAYMENT': 'Loan Payment',
    'transactionIntent.RENT_PAYMENT': 'Rent Payment',
    'transactionIntent.OPERATING_EXPENSE': 'Operating Expense',
    'transactionIntent.OWNER_CONTRIBUTION': 'Owner Contribution',
    'transactionIntent.CUSTOMER_PAYMENT': 'Customer Payment',
    'transactionIntent.TRANSFER': 'Transfer',
    'transactionIntent.TAX_PAYMENT': 'Tax Payment',
    'transactionIntent.OTHER': 'Other',
    'common.cancel': 'Cancel',
  };
  let value = map[key] ?? key;
  for (const [k, v] of Object.entries(params ?? {})) {
    value = value.replace(`{${k}}`, String(v));
  }
  return value;
}));

vi.mock('@/store/language-store', () => ({
  useLanguageStore: (selector: (s: any) => any) => selector({ t: tFn, language: 'en' }),
}));

const mockToast = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  custom: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: mockToast }));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const debitCandidate = {
  id: 'can_1',
  canonicalName: 'DEBIT ENTITY',
  occurrences: 5,
  directionProfile: { creditPct: 0, debitPct: 1 },
  sampleDescriptions: ['Expense payment'],
};

const creditCandidate = {
  id: 'can_2',
  canonicalName: 'RODRIGO',
  occurrences: 12,
  directionProfile: { creditPct: 1, debitPct: 0 },
  sampleDescriptions: ['Customer payment'],
};

const mixedCandidate = {
  id: 'can_3',
  canonicalName: 'MIXED ENTITY',
  occurrences: 10,
  directionProfile: { creditPct: 0.45, debitPct: 0.55 },
  sampleDescriptions: ['Payment received', 'Invoice paid'],
};

const mockFetch = vi.fn();

function setupFetch(candidates: any[] = [debitCandidate]) {
  mockFetch.mockImplementation((url: string, req?: RequestInit) => {
    const u = typeof url === 'string' ? url : '';
    if (u.includes('/api/learning/smart-classify') && (!req || req.method === 'GET')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: candidates }) });
    }
    if (u.includes('/api/learning/classify-entity') && req?.method === 'POST') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

describe('EntityOnboardingModal intent-first flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders intent as the primary control and hides the role combobox', async () => {
    setupFetch([debitCandidate]);
    render(<EntityOnboardingModal isOpen onClose={vi.fn()} companyId="comp_1" />);

    await waitFor(() => expect(screen.getByText('DEBIT ENTITY')).toBeInTheDocument());

    expect(screen.getByText('Transaction Intent')).toBeInTheDocument();
    expect(screen.getByTestId('mock-intent-select')).toBeInTheDocument();
    expect(screen.queryByText('Select a role...')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mock-select')).not.toBeInTheDocument();
  });

  it('blocks saving until an intent is selected, then sends intent without a UI-derived role', async () => {
    const user = userEvent.setup();
    setupFetch([debitCandidate]);
    render(<EntityOnboardingModal isOpen onClose={vi.fn()} companyId="comp_1" />);

    await waitFor(() => expect(screen.getByText('DEBIT ENTITY')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Classify entities' })).toBeDisabled();

    await user.selectOptions(screen.getByTestId('mock-intent-select'), 'OPERATING_EXPENSE');
    const classifyButton = screen.getByRole('button', { name: 'Classify entities' });
    expect(classifyButton).not.toBeDisabled();
    await user.click(classifyButton);

    await waitFor(() => {
      const classifyCalls = mockFetch.mock.calls.filter(
        ([url]) => typeof url === 'string' && url.includes('/api/learning/classify-entity'),
      ) as [string, RequestInit][];
      expect(classifyCalls).toHaveLength(1);
      const body = JSON.parse(classifyCalls[0][1].body as string);
      expect(body).toMatchObject({
        companyId: 'comp_1',
        pattern: 'DEBIT ENTITY',
        intent: 'OPERATING_EXPENSE',
        source: 'user',
      });
      expect(body).not.toHaveProperty('role');
    });
  });

  it('shows and validates free-text explanation only for OTHER intent', async () => {
    const user = userEvent.setup();
    setupFetch([mixedCandidate]);
    render(<EntityOnboardingModal isOpen onClose={vi.fn()} companyId="comp_1" />);

    await waitFor(() => expect(screen.getByText('MIXED ENTITY')).toBeInTheDocument());
    expect(screen.queryByPlaceholderText(/Explain in your own words/)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByTestId('mock-intent-select'), 'OTHER');
    const textarea = screen.getByPlaceholderText(/Explain in your own words/);
    expect(textarea).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Classify entities' })).toBeDisabled();

    await user.type(textarea, '  one-off reimbursement explanation  ');
    const classifyButton = screen.getByRole('button', { name: 'Classify entities' });
    expect(classifyButton).not.toBeDisabled();
    await user.click(classifyButton);

    await waitFor(() => {
      const classifyCalls = mockFetch.mock.calls.filter(
        ([url]) => typeof url === 'string' && url.includes('/api/learning/classify-entity'),
      ) as [string, RequestInit][];
      expect(classifyCalls).toHaveLength(1);
      const body = JSON.parse(classifyCalls[0][1].body as string);
      expect(body.intent).toBe('OTHER');
      expect(body).not.toHaveProperty('role');
      expect(body.userDescription).toBe('one-off reimbursement explanation');
    });
  });

  it('uses normalized real direction stats for credit, debit, and mixed labels', async () => {
    setupFetch([creditCandidate, debitCandidate, mixedCandidate]);
    render(<EntityOnboardingModal isOpen onClose={vi.fn()} companyId="comp_1" />);

    await waitFor(() => expect(screen.getByText('RODRIGO')).toBeInTheDocument());

    expect(screen.getByText(/12 transactions · Income \/ Credit/)).toBeInTheDocument();
    expect(screen.getByText(/5 transactions · Expense \/ Debit/)).toBeInTheDocument();
    expect(screen.getByText(/10 transactions · Mixed direction/)).toBeInTheDocument();
  });
});
