'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Landmark,
  FileText,
  Upload,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Activity,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  Area,
  AreaChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { useLanguageStore } from '@/store/language-store';
import { useAuthStore } from '@/store/auth-store';
import { formatCurrency, formatDate } from '@/lib/format';
import { useAccountingFlow } from '@/hooks/useAccountingFlow';
import { FlowKpiCards } from '@/components/accounting-flow/FlowKpiCards';
import { FlowErrorBoundary } from '@/components/accounting-flow/FlowErrorBoundary';
import { AuditSection } from '@/components/audit/AuditSection';
import { FinancialAssistantPanel } from '@/components/assistant/FinancialAssistantPanel';

/* ─── Types ─── */
interface DashboardData {
  totalBankBalance: number;
  bankAccountCount: number;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  totalRevenue: number;
  totalExpenses: number;
  postedEntries: number;
  reconciledCount: number;
  unreconciledCount: number;
  recentTransactions: {
    id: string;
    date: string;
    description: string;
    amount: number;
    reference: string | null;
    isReconciled: boolean;
    glAccount: { name: string } | null;
  }[];
  accountBalances: {
    accountType: string;
    balance: number;
  }[];
  bankAccounts: {
    id: string;
    accountName: string;
    bankName: string;
    balance: number;
    currency: string;
  }[];
  upcomingPeriodEnds: {
    id: string;
    name: string;
    endDate: string;
  }[];
  monthlyTrend?: { month: string; income: number; expenses: number }[];
}

/* ─── Empty fallback data ─── */
const EMPTY_DATA: DashboardData = {
  totalBankBalance: 0,
  bankAccountCount: 0,
  totalAssets: 0,
  totalLiabilities: 0,
  totalEquity: 0,
  totalRevenue: 0,
  totalExpenses: 0,
  postedEntries: 0,
  reconciledCount: 0,
  unreconciledCount: 0,
  recentTransactions: [],
  accountBalances: [],
  bankAccounts: [],
  upcomingPeriodEnds: [],
};

/* ─── Animation variants ─── */
const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } },
} as const;

/* ─── Chart configs ─── */
const balanceChartConfig: ChartConfig = {
  asset: { label: 'Assets', color: 'hsl(160, 60%, 45%)' },
  liability: { label: 'Liabilities', color: 'hsl(38, 92%, 50%)' },
  equity: { label: 'Equity', color: 'hsl(170, 60%, 41%)' },
  revenue: { label: 'Revenue', color: 'hsl(152, 69%, 38%)' },
  expense: { label: 'Expenses', color: 'hsl(350, 80%, 55%)' },
};

const cashFlowChartConfig: ChartConfig = {
  income: { label: 'Ingresos', color: 'hsl(217, 91%, 60%)' },
  expenses: { label: 'Gastos', color: 'hsl(350, 80%, 55%)' },
};

/* ─── Stat Card ─── */
interface StatCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  iconBg: string;
  trend?: 'up' | 'down';
  loading?: boolean;
}

function StatCard({ title, value, icon, iconBg, trend, loading }: StatCardProps) {
  return (
    <motion.div variants={itemVariants}>
      <Card className="relative overflow-hidden">
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">{title}</p>
              {loading ? (
                <Skeleton className="h-8 w-28" />
              ) : (
                <p className="text-2xl font-bold tracking-tight">{value}</p>
              )}
            </div>
            <div className={`flex size-10 items-center justify-center rounded-lg ${iconBg}`}>
              {icon}
            </div>
          </div>
          {trend && (
            <div className="mt-3 flex items-center gap-1 text-xs">
              {trend === 'up' ? (
                <ArrowUpRight className="size-3.5 text-emerald-600" />
              ) : (
                <ArrowDownRight className="size-3.5 text-rose-600" />
              )}
              <span className={trend === 'up' ? 'text-emerald-600' : 'text-rose-600'}>
                {trend === 'up' ? '+' : '-'}12.5%
              </span>
              <span className="text-muted-foreground">vs last period</span>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ─── Main DashboardPage ─── */
export function DashboardPage() {
  const t = useLanguageStore((s) => s.t);
  const activeCompany = useAuthStore((s) => s.activeCompany);
  const setCurrentView = useAuthStore((s) => s.setCurrentView);

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Hook de Accounting Flow (Fase 2)
  const {
    data: flowData,
    isLoading: flowLoading,
    refetch: refetchFlow,
  } = useAccountingFlow({
    companyId: activeCompany?.id,
    startDate: '2025-01-01',
    endDate: '2025-05-31',
  });

  const fetchDashboard = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/dashboard?companyId=${activeCompany.id}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const json = await res.json();
        setData(json);
      } else {
        throw new Error('API error');
      }
    } catch {
      setError(true);
      setData(EMPTY_DATA);
    } finally {
      setLoading(false);
    }
  }, [activeCompany]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const d = data ?? EMPTY_DATA;

  // Transform account balances for the bar chart
  const balanceChartData = d.accountBalances.map((ab) => ({
    type: ab.accountType.charAt(0).toUpperCase() + ab.accountType.slice(1),
    ...Object.fromEntries([[ab.accountType, Math.abs(ab.balance)]]),
  }));

  const handleNewEntry = () => setCurrentView('journal');
  const handleImportStatement = () => setCurrentView('banks');
  const handleRunReports = () => setCurrentView('reports');

  return (
    <motion.div className="space-y-6" variants={containerVariants} initial="hidden" animate="show">
      {/* ── Header ── */}
      <motion.div
        variants={itemVariants}
        className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t('dashboard.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('dashboard.overview')}</p>
        </div>
        {error && !loading && (
          <Badge variant="secondary" className="w-fit gap-1 text-amber-600 border-amber-300">
            <AlertTriangle className="size-3" />
            {t('common.warning')} — Demo data
          </Badge>
        )}
      </motion.div>

      {/* ── Top Cards Row ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t('dashboard.totalAssets')}
          value={formatCurrency(d.totalAssets)}
          icon={<TrendingUp className="size-5 text-emerald-700" />}
          iconBg="bg-emerald-100 dark:bg-emerald-950"
          trend="up"
          loading={loading}
        />
        <StatCard
          title={t('dashboard.totalLiabilities')}
          value={formatCurrency(Math.abs(d.totalLiabilities))}
          icon={<TrendingDown className="size-5 text-amber-700" />}
          iconBg="bg-amber-100 dark:bg-amber-950"
          trend="down"
          loading={loading}
        />
        <StatCard
          title={t('dashboard.currentRevenue')}
          value={formatCurrency(d.totalRevenue)}
          icon={<ArrowUpRight className="size-5 text-teal-700" />}
          iconBg="bg-teal-100 dark:bg-teal-950"
          trend="up"
          loading={loading}
        />
        <StatCard
          title={t('dashboard.currentExpenses')}
          value={formatCurrency(Math.abs(d.totalExpenses))}
          icon={<ArrowDownRight className="size-5 text-rose-700" />}
          iconBg="bg-rose-100 dark:bg-rose-950"
          loading={loading}
        />
      </div>

      {/* ── Asistente Financiero Contextual (V2.4) ── */}
      {activeCompany && (
        <motion.div variants={itemVariants}>
          <FinancialAssistantPanel companyId={activeCompany.id} />
        </motion.div>
      )}

      {/* ── Accounting Flow KPIs (Fase 2) ── */}
      <motion.div variants={itemVariants}>
        <FlowErrorBoundary>
          {flowData && (
            <FlowKpiCards
              summary={flowData.summary}
              companyId={activeCompany?.id}
              startDate="2025-01-01"
              endDate="2025-05-31"
              isLoading={flowLoading}
              onRefresh={refetchFlow}
            />
          )}
        </FlowErrorBoundary>
      </motion.div>

      {/* ── Módulo de Auditoría de Flujo (Fase 3) ── */}
      {flowData && (
        <motion.div variants={itemVariants}>
          <AuditSection
            transactions={flowData.transactions}
            companyId={activeCompany?.id}
            isLoading={flowLoading}
            onRefresh={refetchFlow}
          />
        </motion.div>
      )}

      {/* ── Summary Mini-Cards ── */}
      <motion.div variants={itemVariants} className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
              <Wallet className="size-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('dashboard.cashBalance')}</p>
              {loading ? (
                <Skeleton className="h-4 w-20 mt-1" />
              ) : (
                <p className="text-sm font-semibold">{formatCurrency(d.totalBankBalance)}</p>
              )}
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-950">
              <CheckCircle2 className="size-4 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('reconciliation.reconciled')}</p>
              {loading ? (
                <Skeleton className="h-4 w-12 mt-1" />
              ) : (
                <p className="text-sm font-semibold">{d.reconciledCount}</p>
              )}
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-rose-100 dark:bg-rose-950">
              <XCircle className="size-4 text-rose-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('reconciliation.unreconciled')}</p>
              {loading ? (
                <Skeleton className="h-4 w-12 mt-1" />
              ) : (
                <p className="text-sm font-semibold">{d.unreconciledCount}</p>
              )}
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-950">
              <FileText className="size-4 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('journal.posted')}</p>
              {loading ? (
                <Skeleton className="h-4 w-12 mt-1" />
              ) : (
                <p className="text-sm font-semibold">{d.postedEntries}</p>
              )}
            </div>
          </div>
        </Card>
      </motion.div>

      {/* ── Charts Section ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Balance Overview */}
        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader>
              <CardTitle>{t('dashboard.accountBalance')}</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-[280px] w-full" />
              ) : (
                <ChartContainer config={balanceChartConfig} className="h-[280px] w-full">
                  <BarChart
                    data={balanceChartData}
                    margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="type" tickLine={false} axisLine={false} fontSize={12} />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      fontSize={12}
                      tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="asset" fill="hsl(160, 60%, 45%)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="liability" fill="hsl(38, 92%, 50%)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="equity" fill="hsl(170, 60%, 41%)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="revenue" fill="hsl(152, 69%, 38%)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expense" fill="hsl(350, 80%, 55%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Monthly Trend */}
        <motion.div variants={itemVariants}>
          <Card className="border-primary/10 shadow-xl">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-7">
              <CardTitle className="text-base font-bold">{t('dashboard.monthlyTrend')}</CardTitle>
              <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <div className="size-2 rounded-full bg-[#0071c5]" /> Ingresos
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="size-2 rounded-full bg-[#f43f5e]" /> Gastos
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-[280px] w-full" />
              ) : d.monthlyTrend && d.monthlyTrend.length > 0 ? (
                <ChartContainer config={cashFlowChartConfig} className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={d.monthlyTrend}
                      margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0071c5" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#0071c5" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="hsl(var(--muted-foreground))"
                        strokeOpacity={0.1}
                      />
                      <XAxis
                        dataKey="month"
                        tickLine={false}
                        axisLine={false}
                        fontSize={10}
                        fontWeight={600}
                        tick={{ fill: 'hsl(var(--muted-foreground))' }}
                        dy={10}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        fontSize={10}
                        fontWeight={600}
                        tick={{ fill: 'hsl(var(--muted-foreground))' }}
                        tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area
                        type="monotone"
                        dataKey="income"
                        stroke="#0071c5"
                        strokeWidth={3}
                        fillOpacity={1}
                        fill="url(#colorIncome)"
                      />
                      <Area
                        type="monotone"
                        dataKey="expenses"
                        stroke="#f43f5e"
                        strokeWidth={3}
                        fillOpacity={1}
                        fill="url(#colorExpenses)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartContainer>
              ) : (
                <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
                  {t('common.noData') ?? 'Sin datos disponibles para el período'}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* ── Period Alerts ── */}
      {d.upcomingPeriodEnds.length > 0 && (
        <motion.div variants={itemVariants}>
          <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
            <AlertTriangle className="size-5 shrink-0 text-amber-600" />
            <div className="flex-1 text-sm">
              <span className="font-medium text-amber-800 dark:text-amber-300">
                {d.upcomingPeriodEnds
                  .map((p) => `${p.name} — ends ${formatDate(p.endDate)}`)
                  .join(', ')}
              </span>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── Bottom Section ── */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Recent Transactions Table */}
        <motion.div variants={itemVariants} className="xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('dashboard.recentEntries')}</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {loading ? (
                <div className="space-y-3 px-6">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('common.date')}</TableHead>
                      <TableHead>{t('common.description')}</TableHead>
                      <TableHead className="text-right">{t('common.amount')}</TableHead>
                      <TableHead className="text-center">{t('common.status')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.recentTransactions.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell className="text-muted-foreground">
                          {formatDate(tx.date)}
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">{tx.description}</p>
                            {tx.glAccount && (
                              <p className="text-xs text-muted-foreground">{tx.glAccount.name}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          <span className={tx.amount >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                            {formatCurrency(tx.amount)}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          {tx.isReconciled ? (
                            <Badge
                              variant="secondary"
                              className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                            >
                              <CheckCircle2 className="size-3 mr-1" />
                              {t('reconciliation.reconciled')}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-amber-600 border-amber-300">
                              {t('reconciliation.unreconciled')}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Right Column */}
        <motion.div variants={itemVariants} className="space-y-6">
          {/* Bank Accounts */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Landmark className="size-4" />
                {t('banks.title')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))
                : d.bankAccounts.map((account) => (
                    <div
                      key={account.id}
                      className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50"
                    >
                      <div className="space-y-0.5">
                        <p className="text-sm font-medium">{account.accountName}</p>
                        <p className="text-xs text-muted-foreground">{account.bankName}</p>
                      </div>
                      <p className="text-sm font-semibold font-mono">
                        {formatCurrency(account.balance)}
                      </p>
                    </div>
                  ))}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>{t('dashboard.quickActions')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button className="w-full justify-start gap-2" onClick={handleNewEntry}>
                <FileText className="size-4" />
                {t('journal.newEntry')}
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={handleImportStatement}
              >
                <Upload className="size-4" />
                {t('banks.uploadStatement')}
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={handleRunReports}
              >
                <BarChart3 className="size-4" />
                {t('reports.title')}
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}
