// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BankRulesPage } from '@/components/spa/BankRulesPage';

afterEach(() => cleanup());

// jsdom DOM API shims for Radix UI Select
// @ts-expect-error incomplete jsdom impl
EventTarget.prototype.hasPointerCapture ??= () => false;
Element.prototype.scrollIntoView ??= () => {};

const tFn = (key: string) => key;
const mockLangState = { t: tFn, language: 'en' };
vi.mock('@/store/language-store', () => ({
  useLanguageStore: (selector: (s: any) => any) => selector(mockLangState),
}));

const mockAuthState = {
  user: { id: 'test-user', name: 'Test User' },
  activeCompany: { id: 'test-company', legalName: 'Test Co' },
  activeCompanyId: 'test-company',
};
vi.mock('@/store/auth-store', () => ({
  useAuthStore: (selector: (s: any) => any) => selector(mockAuthState),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/components/spa/journal/AccountSelector', () => ({
  AccountSelector: ({ value, onChange }: { value: string | null; onChange: (id: string) => void }) => (
    <select data-testid="account-selector" value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select account</option>
      <option value="acc-1">acc-1</option>
      <option value="acc-2">acc-2</option>
    </select>
  ),
}));

vi.mock('@/components/learning/EntityOnboardingModal', () => ({
  EntityOnboardingModal: () => null,
}));

vi.mock('@/components/spa/settings/AIRulesGeneratorTab', () => ({
  AIRulesGeneratorTab: () => null,
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockRules = [
  {
    id: 'r1',
    companyId: 'test-company',
    name: 'Walmart purchases',
    conditionType: 'contains',
    conditionValue: 'WALMART',
    transactionDirection: 'any',
    glAccountId: 'acc-1',
    priority: 5,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    glAccount: { id: 'acc-1', code: '5010', name: 'Cost of Goods', accountType: 'expense' },
    _matchCount: 42,
    conditions: [{ field: 'description', operator: 'contains', value: 'WALMART' }],
    debitGlAccountId: 'acc-1',
    creditGlAccountId: null,
  },
  {
    id: 'r2',
    companyId: 'test-company',
    name: 'Uber rides',
    conditionType: 'contains',
    conditionValue: 'UBER',
    transactionDirection: 'debit',
    glAccountId: 'acc-2',
    priority: 12,
    isActive: false,
    createdAt: '2026-01-15T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
    glAccount: { id: 'acc-2', code: '6100', name: 'Transport', accountType: 'expense' },
    _matchCount: 8,
    conditions: [{ field: 'description', operator: 'contains', value: 'UBER' }],
    debitGlAccountId: 'acc-2',
    creditGlAccountId: null,
  },
];

function setupFetchSuccess(rules = mockRules) {
  mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
    if (url.includes('/api/bank-rules') && opts?.method === 'PUT') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    if (url.includes('/api/bank-rules') && opts?.method === 'DELETE') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    if (url.includes('/api/bank-rules')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: rules }) });
    }
    if (url.includes('/api/journal/accounts')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

describe('BankRulesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page with rules table', async () => {
    setupFetchSuccess();
    render(<BankRulesPage />);

    expect(screen.getByText('bankRules.title')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Walmart purchases')).toBeInTheDocument();
      expect(screen.getByText('Uber rides')).toBeInTheDocument();
    });
  });

  it('displays rule details including condition and match count', async () => {
    setupFetchSuccess();
    render(<BankRulesPage />);

    await waitFor(() => {
      expect(screen.getByText('Walmart purchases')).toBeInTheDocument();
    });

    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('5010')).toBeInTheDocument();
  });

  it('renders edit and delete action buttons for each rule', async () => {
    setupFetchSuccess();
    render(<BankRulesPage />);

    await waitFor(() => {
      expect(screen.getByText('Walmart purchases')).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole('button');
    expect(deleteButtons.length).toBeGreaterThan(0);
  });

  it('shows empty state when no rules exist', async () => {
    setupFetchSuccess([]);
    render(<BankRulesPage />);

    await waitFor(() => {
      expect(screen.getByText('bankRules.noRules')).toBeInTheDocument();
    });
  });

  it('shows loading skeleton while fetching', () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    render(<BankRulesPage />);

    const skeletons = document.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('sends V2 fields (conditions, debitGlAccountId, creditGlAccountId) on create', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    setupFetchSuccess();
    render(<BankRulesPage />);

    await waitFor(() => {
      expect(screen.getByText('bankRules.newRule')).toBeInTheDocument();
    });

    // Click "New Rule" button
    await user.click(screen.getByText('bankRules.newRule'));

    // Fill name
    await user.type(screen.getByLabelText('bankRules.ruleName'), 'TestRule');

    // Fill condition value (V1 field, no htmlFor label — match by placeholder)
    await user.type(screen.getByPlaceholderText('WALMART'), 'TestRule');

    // Select GL account
    await user.selectOptions(screen.getByTestId('account-selector'), 'acc-1');

    // Submit
    await user.click(screen.getByText('common.save'));

    await waitFor(() => {
      // Find the POST fetch call
      const postCall = mockFetch.mock.calls.find(
        (call: any[]) =>
          call[0] === '/api/bank-rules' && call[1]?.method === 'POST',
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse((postCall as any[])[1].body);

      // Assert V2 shape
      expect(body).toHaveProperty('conditions');
      expect(Array.isArray(body.conditions)).toBe(true);
      expect(body.conditions[0]).toEqual({
        field: 'description',
        operator: 'contains',
        value: 'TestRule',
      });

      // Default transactionDirection is 'any' → both account IDs set
      expect(body).toHaveProperty('debitGlAccountId', 'acc-1');
      expect(body).toHaveProperty('creditGlAccountId', 'acc-1');
    });
  });

  it('maps direction=debit → debitGlAccountId set, creditGlAccountId=null', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    setupFetchSuccess();
    render(<BankRulesPage />);

    await waitFor(() => {
      expect(screen.getByText('bankRules.newRule')).toBeInTheDocument();
    });
    await user.click(screen.getByText('bankRules.newRule'));

    await user.type(screen.getByLabelText('bankRules.ruleName'), 'TestRule');
    await user.type(screen.getByPlaceholderText('WALMART'), 'TestRule');
    await user.selectOptions(screen.getByTestId('account-selector'), 'acc-1');

    // Open direction select (second combobox) and choose 'debit'
    const [, directionTrigger] = screen.getAllByRole('combobox');
    await user.click(directionTrigger);
    await user.click(screen.getByRole('option', { name: 'bankRules.debit' }));

    await user.click(screen.getByText('common.save'));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        (call: any[]) =>
          call[0] === '/api/bank-rules' && call[1]?.method === 'POST',
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse((postCall as any[])[1].body);
      expect(body).toHaveProperty('debitGlAccountId', 'acc-1');
      expect(body).toHaveProperty('creditGlAccountId', null);
    });
  });

  it('maps direction=credit → creditGlAccountId set, debitGlAccountId=null', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    setupFetchSuccess();
    render(<BankRulesPage />);

    await waitFor(() => {
      expect(screen.getByText('bankRules.newRule')).toBeInTheDocument();
    });
    await user.click(screen.getByText('bankRules.newRule'));

    await user.type(screen.getByLabelText('bankRules.ruleName'), 'TestRule');
    await user.type(screen.getByPlaceholderText('WALMART'), 'TestRule');
    await user.selectOptions(screen.getByTestId('account-selector'), 'acc-1');

    // Open direction select (second combobox) and choose 'credit'
    const [, directionTrigger2] = screen.getAllByRole('combobox');
    await user.click(directionTrigger2);
    await user.click(screen.getByRole('option', { name: 'bankRules.credit' }));

    await user.click(screen.getByText('common.save'));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        (call: any[]) =>
          call[0] === '/api/bank-rules' && call[1]?.method === 'POST',
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse((postCall as any[])[1].body);
      expect(body).toHaveProperty('creditGlAccountId', 'acc-1');
      expect(body).toHaveProperty('debitGlAccountId', null);
    });
  });

  it('maps direction=any → both debitGlAccountId and creditGlAccountId set', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    setupFetchSuccess();
    render(<BankRulesPage />);

    await waitFor(() => {
      expect(screen.getByText('bankRules.newRule')).toBeInTheDocument();
    });
    await user.click(screen.getByText('bankRules.newRule'));

    await user.type(screen.getByLabelText('bankRules.ruleName'), 'TestRule');
    await user.type(screen.getByPlaceholderText('WALMART'), 'TestRule');
    await user.selectOptions(screen.getByTestId('account-selector'), 'acc-1');

    // Direction stays 'any' (default)
    await user.click(screen.getByText('common.save'));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        (call: any[]) =>
          call[0] === '/api/bank-rules' && call[1]?.method === 'POST',
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse((postCall as any[])[1].body);
      expect(body).toHaveProperty('debitGlAccountId', 'acc-1');
      expect(body).toHaveProperty('creditGlAccountId', 'acc-1');
    });
  });
});
