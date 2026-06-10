'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { ACCOUNT_TYPES } from '@/lib/constants/account-types';
import {
  Plus,
  Search,
  ChevronRight,
  ChevronDown,
  Lock,
  Pencil,
  Trash2,
  FolderOpen,
  Folder,
  Loader2,
  Landmark,
  Shield,
  Wallet,
  TrendingUp,
  Receipt,
  Power,
  PowerOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguageStore } from '@/store/language-store';
import { useAuthStore } from '@/store/auth-store';
import { BalanceBadge } from '@/components/spa/accounts/BalanceBadge';
import type {
  GlAccount as GlAccountType,
  AccountFormData,
} from '@/components/spa/accounts/AccountFormClientDialog';
import { logger } from '@/lib/logger';

// ── Lazy-loaded modals — not included in the initial bundle ──────────
const AccountFormDialog = dynamic(
  () =>
    import('@/components/spa/accounts/AccountFormClientDialog').then((m) => ({
      default: m.AccountFormClientDialog,
    })),
  { ssr: false, loading: () => null },
);
const AccountDeleteDialog = dynamic(
  () =>
    import('@/components/spa/accounts/AccountDeleteClientDialog').then((m) => ({
      default: m.AccountDeleteClientDialog,
    })),
  { ssr: false, loading: () => null },
);

/* ─── Types (re-exported from AccountFormDialog) ─── */
type GlAccount = GlAccountType;

const DEFAULT_FORM: AccountFormData = {
  code: '',
  name: '',
  accountType: '',
  normalBalance: '',
  parentId: 'none',
};

/* ─── Type section config ─── */
interface TypeSectionConfig {
  key: string;
  i18nKey: string;
  accent: string;
  accentBg: string;
  accentText: string;
  accentBorder: string;
  accentBorderLight: string;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
}

const TYPE_SECTION_CONFIG: TypeSectionConfig[] = [
  {
    key: 'asset',
    i18nKey: 'accounts.asset',
    accent: 'teal',
    accentBg: 'bg-teal-600 dark:bg-teal-500',
    accentText: 'text-white',
    accentBorder: 'border-teal-200 dark:border-teal-800',
    accentBorderLight: 'border-teal-100 dark:border-teal-900/50',
    icon: Landmark,
    iconBg: 'bg-teal-50 dark:bg-teal-950/40',
    iconColor: 'text-teal-600 dark:text-teal-400',
  },
  {
    key: 'liability',
    i18nKey: 'accounts.liability',
    accent: 'amber',
    accentBg: 'bg-amber-500 dark:bg-amber-600',
    accentText: 'text-white',
    accentBorder: 'border-amber-200 dark:border-amber-800',
    accentBorderLight: 'border-amber-100 dark:border-amber-900/50',
    icon: Shield,
    iconBg: 'bg-amber-50 dark:bg-amber-950/40',
    iconColor: 'text-amber-600 dark:text-amber-400',
  },
  {
    key: 'equity',
    i18nKey: 'accounts.equity',
    accent: 'violet',
    accentBg: 'bg-violet-600 dark:bg-violet-500',
    accentText: 'text-white',
    accentBorder: 'border-violet-200 dark:border-violet-800',
    accentBorderLight: 'border-violet-100 dark:border-violet-900/50',
    icon: Wallet,
    iconBg: 'bg-violet-50 dark:bg-violet-950/40',
    iconColor: 'text-violet-600 dark:text-violet-400',
  },
  {
    key: 'revenue',
    i18nKey: 'accounts.revenue',
    accent: 'emerald',
    accentBg: 'bg-emerald-600 dark:bg-emerald-500',
    accentText: 'text-white',
    accentBorder: 'border-emerald-200 dark:border-emerald-800',
    accentBorderLight: 'border-emerald-100 dark:border-emerald-900/50',
    icon: TrendingUp,
    iconBg: 'bg-emerald-50 dark:bg-emerald-950/40',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    key: 'expense',
    i18nKey: 'accounts.expense',
    accent: 'rose',
    accentBg: 'bg-rose-600 dark:bg-rose-500',
    accentText: 'text-white',
    accentBorder: 'border-rose-200 dark:border-rose-800',
    accentBorderLight: 'border-rose-100 dark:border-rose-900/50',
    icon: Receipt,
    iconBg: 'bg-rose-50 dark:bg-rose-950/40',
    iconColor: 'text-rose-600 dark:text-rose-400',
  },
];

/* ─── Code color per type ─── */
const CODE_COLORS: Record<string, string> = {
  asset: 'text-teal-700 dark:text-teal-400',
  liability: 'text-amber-700 dark:text-amber-400',
  equity: 'text-violet-700 dark:text-violet-400',
  revenue: 'text-emerald-700 dark:text-emerald-400',
  expense: 'text-rose-700 dark:text-rose-400',
};

/* ─── Connection line color per type ─── */
const LINE_COLORS: Record<string, string> = {
  asset: 'border-teal-300 dark:border-teal-700',
  liability: 'border-amber-300 dark:border-amber-700',
  equity: 'border-violet-300 dark:border-violet-700',
  revenue: 'border-emerald-300 dark:border-emerald-700',
  expense: 'border-rose-300 dark:border-rose-700',
};

function fmtCurrency(amount: number): string {
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount));
  return amount < 0 ? `-$${formatted}` : `$${formatted}`;
}

/* ─── Animation Variants ─── */
const sectionVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.4, ease: 'easeOut' as const },
  }),
};

const rowVariants = {
  hidden: { opacity: 0, x: -8 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: { delay: i * 0.025, duration: 0.25, ease: 'easeOut' as const },
  }),
  exit: { opacity: 0, x: -8, transition: { duration: 0.15 } },
};

/* ─── AccountsPage ─── */
export function AccountsClient({ initialAccounts }: { initialAccounts?: GlAccount[] }) {
  const t = useLanguageStore((s) => s.t);
  const activeCompany = useAuthStore((s) => s.activeCompany);

  // ── State ──
  const [accounts, setAccounts] = useState<GlAccount[]>(initialAccounts || []);
  const [loading, setLoading] = useState(!initialAccounts);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set());

  // ── Modal state ──
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<GlAccount | null>(null);
  const [formData, setFormData] = useState<AccountFormData>(DEFAULT_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // ── Delete dialog ──
  const [deleteTarget, setDeleteTarget] = useState<GlAccount | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  /* ── Fetch accounts ── */
  const fetchAccounts = useCallback(async () => {
    if (!activeCompany?.id) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ companyId: activeCompany.id });
      if (filterType !== 'all') params.set('accountType', filterType);
      if (search.trim()) params.set('search', search.trim());

      const res = await fetch(`/api/accounts?${params}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setAccounts((data.accounts || []).filter(Boolean));
    } catch (err) {
      logger.error('[ACCOUNTS PAGE FETCH]', { error: String(err) });
    } finally {
      setLoading(false);
    }
  }, [activeCompany?.id, filterType, search]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  /* ── Build tree structures grouped by type ── */
  const accountsByType = useMemo(() => {
    const groups = new Map<string, GlAccount[]>();
    for (const account of accounts) {
      const existing = groups.get(account.accountType) ?? [];
      existing.push(account);
      groups.set(account.accountType, existing);
    }
    return groups;
  }, [accounts]);

  const childrenMap = useMemo(() => {
    const map = new Map<string, GlAccount[]>();
    for (const account of accounts) {
      if (account.parentId) {
        const existing = map.get(account.parentId) ?? [];
        existing.push(account);
        map.set(
          account.parentId,
          existing.sort((a, b) => a.code.localeCompare(b.code)),
        );
      }
    }
    return map;
  }, [accounts]);

  const allAccountsForSelect = useMemo(() => {
    return accounts.filter((a) => (a._count?.children ?? 0) === 0 || !a.parentId);
  }, [accounts]);

  /* ── Toggle expand for tree node ── */
  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function expandAll() {
    const ids = new Set<string>();
    for (const account of accounts) {
      if ((account._count?.children ?? 0) > 0) {
        ids.add(account.id);
      }
    }
    setExpandedIds(ids);
    setCollapsedTypes(new Set());
  }

  function collapseAll() {
    setExpandedIds(new Set());
    setCollapsedTypes(new Set(ACCOUNT_TYPES));
  }

  /* ── Toggle type section collapse ── */
  function toggleTypeSection(typeKey: string) {
    setCollapsedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(typeKey)) {
        next.delete(typeKey);
      } else {
        next.add(typeKey);
      }
      return next;
    });
  }

  /* ── Open create modal ── */
  function openCreateModal() {
    setEditingAccount(null);
    setFormData(DEFAULT_FORM);
    setFormErrors({});
    setModalOpen(true);
  }

  /* ── Open edit modal ── */
  function openEditModal(account: GlAccount) {
    setEditingAccount(account);
    setFormData({
      code: account.code,
      name: account.name,
      accountType: account.accountType,
      normalBalance: account.normalBalance,
      parentId: account.parentId ?? 'none',
    });
    setFormErrors({});
    setModalOpen(true);
  }

  /* ── Validate form ── */
  function validateForm(): boolean {
    const errors: Record<string, string> = {};
    if (!formData.code.trim()) {
      errors.code = t('accounts.accountCode') + ' is required';
    }
    if (!formData.name.trim()) {
      errors.name = t('accounts.accountName') + ' is required';
    }
    if (!formData.accountType) {
      errors.accountType = t('accounts.accountType') + ' is required';
    }
    if (!formData.normalBalance) {
      errors.normalBalance = t('accounts.normalBalance') + ' is required';
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }

  /* ── Submit form ── */
  async function handleSubmit() {
    if (!validateForm() || !activeCompany?.id) return;
    setSubmitting(true);
    setFormErrors({});

    try {
      const body = {
        companyId: activeCompany.id,
        code: formData.code.trim(),
        name: formData.name.trim(),
        accountType: formData.accountType,
        normalBalance: formData.normalBalance,
        parentId: formData.parentId === 'none' || !formData.parentId ? null : formData.parentId,
      };

      console.log('[ACCOUNTS CLIENT] handleSubmit', { method: editingAccount ? 'PUT' : 'POST', body });

      let res: Response;
      if (editingAccount) {
        res = await fetch(`/api/accounts/${editingAccount.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch('/api/accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }

      if (!res.ok) {
        const data = await res.json();
        setFormErrors({ general: data.error || t('common.error') });
        return;
      }

      setModalOpen(false);
      fetchAccounts();
    } catch {
      setFormErrors({ general: t('common.error') });
    } finally {
      setSubmitting(false);
    }
  }

  function handleDeleteClick(account: GlAccount) {
    setDeleteError('');
    setDeleteTarget(account);

    if (account.isSystem) {
      setDeleteError(t('accounts.systemAccountCannotBeDeleted'));
      return;
    }

    if (account.balance && account.balance !== 0) {
      setDeleteError(t('accounts.accountHasBalanceCannotBeDeleted'));
      return;
    }
  }

  /* ── Delete account ── */
  async function handleDelete() {
    if (!deleteTarget || !activeCompany?.id) return;
    setDeleting(true);
    setDeleteError('');

    try {
      const res = await fetch(`/api/accounts/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: activeCompany.id }),
      });
      if (!res.ok) {
        const data = await res.json();
        setDeleteError(data.error || t('common.error'));
        return;
      }
      setDeleteTarget(null);
      fetchAccounts();
    } catch {
      setDeleteError(t('common.error'));
    } finally {
      setDeleting(false);
    }
  }

  async function handleToggleActive(account: GlAccount) {
    if (!activeCompany?.id) return;
    try {
      const res = await fetch(`/api/accounts/${account.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !account.isActive, companyId: activeCompany.id }),
      });
      if (res.ok) {
        fetchAccounts();
      }
    } catch (err) {
      logger.error('[TOGGLE ACTIVE ERROR]', { error: String(err) });
    }
  }

  /* ── Render account row within a type section ── */
  function renderAccountRow(
    account: GlAccount,
    depth: number,
    index: number,
    config: TypeSectionConfig,
  ) {
    const hasChildren = (account._count?.children ?? 0) > 0;
    const isExpanded = expandedIds.has(account.id);
    const children = childrenMap.get(account.id) ?? [];
    const isRoot = depth === 0;

    return (
      <motion.div
        key={account.id}
        custom={index}
        variants={rowVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        layout
      >
        <Collapsible open={isExpanded} onOpenChange={() => toggleExpand(account.id)}>
          <div
            className={cn(
              'group flex items-center gap-2 rounded-md px-3 py-2 transition-colors cursor-pointer select-none',
              'hover:bg-muted/60',
              !account.isActive && 'opacity-50',
              depth > 0 && 'ml-1',
            )}
            onDoubleClick={(e) => {
              e.stopPropagation();
              openEditModal(account);
            }}
          >
            {/* Tree indentation + connection line */}
            {depth > 0 && (
              <div className="shrink-0 flex items-center">
                <div
                  className={cn(
                    'border-l-2 rounded-l',
                    LINE_COLORS[config.key] ?? 'border-muted-foreground/30',
                  )}
                  style={{ height: '20px', marginLeft: `${(depth - 1) * 24}px` }}
                />
              </div>
            )}

            {/* Expand arrow or spacer */}
            <div className="shrink-0 w-6">
              {hasChildren ? (
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-6 p-0">
                    {isExpanded ? (
                      <ChevronDown className="size-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-3.5 text-muted-foreground" />
                    )}
                  </Button>
                </CollapsibleTrigger>
              ) : (
                <div className="w-6" />
              )}
            </div>

            {/* Folder icon for parent accounts */}
            <div className="shrink-0 w-4">
              {hasChildren ? (
                isExpanded ? (
                  <FolderOpen className="size-4 text-muted-foreground" />
                ) : (
                  <Folder className="size-4 text-muted-foreground" />
                )
              ) : null}
            </div>

            {/* Code */}
            <span
              className={cn(
                'font-mono text-sm font-semibold min-w-[60px] shrink-0',
                CODE_COLORS[config.key] ?? 'text-muted-foreground',
              )}
            >
              {account.code}
            </span>

            {/* Name */}
            <span
              className={cn('flex-1 truncate', isRoot ? 'font-semibold' : 'font-medium text-sm')}
            >
              {account.isSystem && (
                <Lock className="inline size-3 mr-1 text-amber-500" aria-label="System account" />
              )}
              {account.name}
            </span>

            {/* Balance / Importe */}
            <span className="font-mono text-sm text-right min-w-[90px] hidden sm:inline mr-2 text-muted-foreground">
              {fmtCurrency(account.balance ?? 0)}
            </span>

            {/* Account Type */}
            <span className="hidden md:inline mr-2">
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px] px-1.5 py-0 capitalize font-medium',
                  config.iconColor,
                  config.iconBg,
                  config.accentBorder,
                )}
              >
                {t(`accounts.${account.accountType}`)}
              </Badge>
            </span>

            {/* Status badge */}
            {!account.isActive && (
              <div className="shrink-0 hidden sm:block mr-2">
                <Badge
                  variant="secondary"
                  className="text-[10px] px-1.5 py-0 bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                >
                  {t('common.inactive')}
                </Badge>
              </div>
            )}

            {/* Actions */}
            <div className="shrink-0 flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'size-7 transition-colors',
                  account.isActive
                    ? 'text-emerald-500 hover:text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30'
                    : 'text-amber-500 hover:text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30',
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleActive(account);
                }}
                title={account.isActive ? t('accounts.deactivate') : t('accounts.activate')}
              >
                {account.isActive ? (
                  <Power className="size-3.5" />
                ) : (
                  <PowerOff className="size-3.5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={(e) => {
                  e.stopPropagation();
                  openEditModal(account);
                }}
              >
                <Pencil className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'size-7 transition-colors',
                  account.isSystem
                    ? 'text-zinc-500/60 dark:text-zinc-400/50 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                    : 'text-red-500 hover:text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30',
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteClick(account);
                }}
                title={account.isSystem ? 'System account' : t('common.delete')}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>

          {/* Children */}
          {hasChildren && (
            <CollapsibleContent>
              {children.map((child, childIndex) =>
                renderAccountRow(child, depth + 1, index + childIndex + 1, config),
              )}
            </CollapsibleContent>
          )}
        </Collapsible>
      </motion.div>
    );
  }

  /* ── Render a type section ── */
  function renderTypeSection(
    config: TypeSectionConfig,
    typeAccounts: GlAccount[],
    sectionIndex: number,
  ) {
    const typeLabel = t(config.i18nKey);
    const isCollapsed = collapsedTypes.has(config.key);
    const Icon = config.icon;
    const rootAccounts = typeAccounts
      .filter((a) => !a.parentId)
      .sort((a, b) => a.code.localeCompare(b.code));
    const accountCount = typeAccounts.length;

    return (
      <motion.div
        key={config.key}
        custom={sectionIndex}
        variants={sectionVariants}
        initial="hidden"
        animate="visible"
        layout
      >
        <Collapsible open={!isCollapsed} onOpenChange={() => toggleTypeSection(config.key)}>
          <div className={cn('rounded-xl border overflow-hidden', config.accentBorder)}>
            {/* Section header */}
            <CollapsibleTrigger asChild>
              <button
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3 transition-colors',
                  'hover:opacity-90 cursor-pointer',
                  config.accentBg,
                  config.accentText,
                )}
              >
                <div className={cn('rounded-lg p-1.5 bg-white/20')}>
                  <Icon className="size-4" />
                </div>
                <div className="flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm tracking-wide uppercase">{typeLabel}</span>
                    <Badge className="bg-white/25 text-white border-0 text-[11px] font-medium">
                      {accountCount}
                    </Badge>
                  </div>
                </div>
                <motion.div
                  animate={{ rotate: isCollapsed ? 0 : 180 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronDown className="size-5" />
                </motion.div>
              </button>
            </CollapsibleTrigger>

            {/* Section content */}
            <CollapsibleContent>
              <div className="p-2 space-y-0.5 bg-muted/20">
                {rootAccounts.map((account, i) => renderAccountRow(account, 0, i, config))}
                {rootAccounts.length === 0 && typeAccounts.length === 0 && (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    {t('common.noData')}
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      </motion.div>
    );
  }

  /* ── Count ── */
  const totalAccounts = accounts.length;

  /* ── Determine visible type sections ── */
  const visibleTypeConfigs = useMemo(() => {
    if (filterType !== 'all') {
      return TYPE_SECTION_CONFIG.filter((c) => c.key === filterType);
    }
    return TYPE_SECTION_CONFIG;
  }, [filterType]);

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t('accounts.title')}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {totalAccounts} {totalAccounts === 1 ? 'account' : 'accounts'}
          </p>
        </div>
        <Button
          onClick={openCreateModal}
          className="bg-teal-600 hover:bg-teal-700 text-white shrink-0"
        >
          <Plus className="size-4 mr-2" />
          {t('accounts.newAccount')}
        </Button>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder={t('accounts.searchAccounts')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder={t('accounts.accountType')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('common.all')}</SelectItem>
            {ACCOUNT_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`accounts.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={expandAll}>
            {t('accounts.expandedView')}
          </Button>
          <Button variant="outline" size="sm" onClick={collapseAll}>
            {t('accounts.collapsedView')}
          </Button>
        </div>
      </div>

      {/* ── Summary badges row ── */}
      {!loading && accounts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {TYPE_SECTION_CONFIG.map((config) => {
            const count = accountsByType.get(config.key)?.length ?? 0;
            if (count === 0) return null;
            const Icon = config.icon;
            return (
              <button
                key={config.key}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors hover:bg-muted/60',
                  filterType === config.key
                    ? cn(config.iconBg, config.iconColor, config.accentBorder)
                    : 'bg-background text-muted-foreground border-border',
                )}
                onClick={() => setFilterType(filterType === config.key ? 'all' : config.key)}
              >
                <Icon className="size-3" />
                {t(config.i18nKey)}
                <Badge
                  variant="secondary"
                  className="ml-0.5 text-[10px] px-1.5 py-0 h-4 min-w-[18px] flex items-center justify-center"
                >
                  {count}
                </Badge>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Type Sections ── */}
      <div className="space-y-4">
        {loading ? (
          // Skeleton sections
          TYPE_SECTION_CONFIG.map((config, idx) => (
            <div key={`skel-${idx}`} className="rounded-xl border border-border">
              <div className={cn('h-12 rounded-t-xl', config.accentBg, 'opacity-40')} />
              <div className="p-4 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-5 w-5 shrink-0" />
                    <Skeleton className="h-5 w-16 shrink-0" />
                    <Skeleton className="h-5 flex-1 max-w-[200px]" />
                    <Skeleton className="h-5 w-14 shrink-0 hidden sm:block" />
                    <Skeleton className="h-5 w-12 shrink-0 hidden sm:block" />
                  </div>
                ))}
              </div>
            </div>
          ))
        ) : accounts.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-muted/20 py-16 text-center">
            <Landmark className="size-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground">{t('common.noData')}</p>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {visibleTypeConfigs.map((config, idx) => {
              const typeAccounts = accountsByType.get(config.key);
              if (!typeAccounts || typeAccounts.length === 0) return null;
              return renderTypeSection(config, typeAccounts, idx);
            })}
          </AnimatePresence>
        )}
      </div>

      {/* ── Create / Edit Dialog — lazy loaded ── */}
      {modalOpen && (
        <AccountFormDialog
          open={modalOpen}
          onOpenChange={setModalOpen}
          editingAccount={editingAccount}
          formData={formData}
          formErrors={formErrors}
          submitting={submitting}
          allAccountsForSelect={allAccountsForSelect}
          onFormChange={(patch) => setFormData((f) => ({ ...f, ...patch }))}
          onSubmit={handleSubmit}
        />
      )}

      {/* ── Delete Confirmation — lazy loaded ── */}
      {deleteTarget && (
        <AccountDeleteDialog
          target={deleteTarget}
          deleteError={deleteError}
          deleting={deleting}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
