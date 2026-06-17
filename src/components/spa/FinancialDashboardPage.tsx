'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  PieChart as PieChartIcon,
  Activity,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  Filter,
  Download,
  RefreshCw,
  Info,
  Calendar,
  Layers,
  HelpCircle,
  FileSpreadsheet,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { useLanguageStore } from '@/store/language-store';
import { useAuthStore } from '@/store/auth-store';
import { formatCurrency } from '@/lib/format';
import { logger } from '@/lib/logger';
import { Transaction, PALETTE, MONTHS_SPANISH } from '@/lib/constants/financial-dashboard-types';
import { LOCAL_TRANSLATIONS, getMonthName } from '@/lib/constants/financial-dashboard-translations';
import { LoadingState, EmptyState } from '@/components/dashboard/DashboardStates';
import { ChartsGrid } from '@/components/dashboard/ChartsGrid';

export function FinancialDashboardPage() {
  const t = useLanguageStore((s) => s.t);
  const language = useLanguageStore((s) => s.language) || 'es';
  const dt = LOCAL_TRANSLATIONS[language] || LOCAL_TRANSLATIONS.es;
  const activeCompany = useAuthStore((s) => s.activeCompany);
  const setCurrentView = useAuthStore((s) => s.setCurrentView);

  // States
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [dbTransactions, setDbTransactions] = useState<Transaction[]>([]);
  const [initialBalanceInput, setInitialBalanceInput] = useState<number>(0);

  useEffect(() => {
    setMounted(true);
  }, []);
  const [initialBalanceDisplay, setInitialBalanceDisplay] = useState<string>('0.00');
  const apiInitialBalance = React.useRef<number>(0);
  const [bankAccountInfo, setBankAccountInfo] = useState<{
    accountName: string;
    bankName: string;
    accountNo: string;
  } | null>(null);
  const [revenueTrend, setRevenueTrend] = useState<number>(0);
  const [expenseTrend, setExpenseTrend] = useState<number>(0);
  const [filtersOpen, setFiltersOpen] = useState(true);

  // Filter conditions
  const [filterReconciliation, setFilterReconciliation] = useState<
    'all' | 'reconciled' | 'unreconciled'
  >('all');
  const [filterStartDate, setFilterStartDate] = useState<string>('');
  const [filterEndDate, setFilterEndDate] = useState<string>('');
  const [filterYear, setFilterYear] = useState<string>('all');
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(
    new Set(MONTHS_SPANISH.map((m) => m.key)),
  );
  const [selectedIncomeCategories, setSelectedIncomeCategories] = useState<Set<string>>(
    new Set(['Sin asignar']),
  );
  const [selectedExpenseCategories, setSelectedExpenseCategories] = useState<Set<string>>(
    new Set(['Sin asignar']),
  );

  // Modal State
  const [helpOpen, setHelpOpen] = useState(false);
  const [recurrentMap, setRecurrentMap] = useState<Map<string, string>>(new Map());

  const recurrentMapRef = React.useRef(recurrentMap);
  React.useEffect(() => {
    recurrentMapRef.current = recurrentMap;
  }, [recurrentMap]);

  // --- Synchronize initialBalanceDisplay with initialBalanceInput ---
  React.useEffect(() => {
    const num = Number(initialBalanceInput);
    if (!isNaN(num)) {
      const fixed = num.toFixed(2);
      const parts = fixed.split('.');
      const formattedInteger = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      setInitialBalanceDisplay(formattedInteger + '.' + parts[1]);
    }
  }, [initialBalanceInput]);

  function formatNumberWithComas(val: string): string {
    const cleaned = val.replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    if (parts.length > 2) return val;
    const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (parts.length === 2) {
      return `${integerPart}.${parts[1].slice(0, 2)}`;
    }
    return integerPart;
  }

  const handleChangeInitialBalance = (val: string) => {
    const formatted = formatNumberWithComas(val);
    setInitialBalanceDisplay(formatted);

    const cleanNum = parseFloat(formatted.replace(/,/g, ''));
    if (!isNaN(cleanNum)) {
      setInitialBalanceInput(cleanNum);
    } else {
      setInitialBalanceInput(0);
    }
  };

  const handleBlurInitialBalance = () => {
    const num = Number(initialBalanceInput);
    if (isNaN(num) || num <= 0.005) {
      setInitialBalanceInput(0);
      setInitialBalanceDisplay('0.00');
    } else {
      const fixed = num.toFixed(2);
      const parts = fixed.split('.');
      const formattedInteger = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      setInitialBalanceDisplay(formattedInteger + '.' + parts[1]);
    }
  };

  // --- CLASSIFICATION ENGINE ---
  const classifyTransaction = useCallback((tx: Omit<Transaction, 'categoria'>): string => {
    if (tx.glAccountName) return tx.glAccountName;
    if (tx.matchedRuleGlAccountName) return tx.matchedRuleGlAccountName;
    if (tx.cuenta_contable) {
      const parts = tx.cuenta_contable.trim().split(' ');
      if (parts.length > 1 && /^\d+$/.test(parts[0])) return parts.slice(1).join(' ');
      return tx.cuenta_contable;
    }
    return '';
  }, []);

  // --- DATA LOADING HUB ---
  const loadData = useCallback(async () => {
    if (!activeCompany?.id) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/dashboard/financial?companyId=${activeCompany.id}`);
      if (res.ok) {
        const data = await res.json();
        setInitialBalanceInput(data.initialBalance || 0);
        apiInitialBalance.current = data.initialBalance || 0;
        setBankAccountInfo(data.bankAccountInfo || null);
        setRevenueTrend(data.revenueTrend || 0);
        setExpenseTrend(data.expenseTrend || 0);

        if (data.transactions && data.transactions.length > 0) {
          // 1. Identificar descripciones recurrentes (4 o más repeticiones similares)
          const cleanCounts = new Map<string, number>();
          const rawDescriptions = new Map<string, string>();

          data.transactions.forEach((tx: Transaction) => {
            const rawDesc = tx.descripcion || '';
            let clean = rawDesc.toUpperCase();
            clean = clean.replace(/\b\d{3,}\b/g, ''); // eliminar números de 3+ dígitos
            clean = clean.replace(/[^A-ZÁÉÍÓÚÑ\s]/g, ' ');
            clean = clean.replace(/\s+/g, ' ').trim();

            if (clean.length >= 3) {
              cleanCounts.set(clean, (cleanCounts.get(clean) || 0) + 1);
              if (
                !rawDescriptions.has(clean) ||
                rawDesc.length < rawDescriptions.get(clean)!.length
              ) {
                const pretty = clean
                  .split(' ')
                  .map((w: string) => w.charAt(0) + w.slice(1).toLowerCase())
                  .join(' ');
                rawDescriptions.set(clean, pretty);
              }
            }
          });

          const localRecurrent = new Map<string, string>();
          cleanCounts.forEach((count, clean) => {
            if (count >= 4) {
              localRecurrent.set(clean, rawDescriptions.get(clean) || clean);
            }
          });
          setRecurrentMap(localRecurrent);

          // 2. Clasificar las transacciones con las descripciones recurrentes identificadas
          const parsed = data.transactions.map((tx: Transaction) => ({
            ...tx,
            categoria: classifyTransaction(tx),
          }));
          setDbTransactions(parsed);
          setIsDemoMode(false);

          const incCats = new Set<string>();
          const expCats = new Set<string>();
          parsed.forEach((tx: Transaction) => {
            if (tx.tipo === 'credito') {
              incCats.add(tx.categoria || 'Sin asignar');
            } else {
              expCats.add(tx.categoria || 'Sin asignar');
            }
          });
          if (incCats.size === 0) incCats.add('Sin asignar');
          if (expCats.size === 0) expCats.add('Sin asignar');

          setSelectedIncomeCategories(incCats);
          setSelectedExpenseCategories(expCats);

          const dates = parsed.map((tx: Transaction) => tx.fecha).sort();
          setFilterStartDate(dates[0]);
          setFilterEndDate(dates[dates.length - 1]);
        } else {
          setDbTransactions([]);
          setIsDemoMode(false);
          setSelectedIncomeCategories(new Set(['Sin asignar']));
          setSelectedExpenseCategories(new Set(['Sin asignar']));
        }
      }
    } catch (err) {
      logger.error('Failed to load dashboard bank transactions:', { error: String(err) });
    } finally {
      setLoading(false);
    }
  }, [activeCompany, classifyTransaction]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Stable pre-defined categories derived dynamically
  const allIncomeCategories = useMemo(() => {
    const categories = new Set<string>();
    dbTransactions.forEach((tx) => {
      if (tx.tipo === 'credito') {
        categories.add(tx.categoria || 'Sin asignar');
      }
    });
    if (categories.size === 0) categories.add('Sin asignar');
    return Array.from(categories);
  }, [dbTransactions]);

  const allExpenseCategories = useMemo(() => {
    const categories = new Set<string>();
    dbTransactions.forEach((tx) => {
      if (tx.tipo === 'debito') {
        categories.add(tx.categoria || 'Sin asignar');
      }
    });
    if (categories.size === 0) categories.add('Sin asignar');
    return Array.from(categories);
  }, [dbTransactions]);

  // Year Selection Options
  const yearOptions = useMemo(() => {
    const years = new Set(dbTransactions.map((tx) => tx.fecha.substring(0, 4)));
    return Array.from(years).sort();
  }, [dbTransactions]);

  // --- MAIN CRITICAL FILTERING ENGINE ---
  const filteredTransactions = useMemo(() => {
    return dbTransactions.filter((t) => {
      // Reconciliation
      if (filterReconciliation === 'reconciled' && !t.conciliado) return false;
      if (filterReconciliation === 'unreconciled' && t.conciliado) return false;

      // Dates
      if (filterStartDate && t.fecha < filterStartDate) return false;
      if (filterEndDate && t.fecha > filterEndDate) return false;

      // Year
      const y = t.fecha.substring(0, 4);
      if (filterYear !== 'all' && y !== filterYear) return false;

      // Month
      const m = t.fecha.substring(5, 7);
      if (!selectedMonths.has(m)) return false;

      // Category
      const cat = t.categoria || 'Otros egresos';
      if (t.tipo === 'credito' && !selectedIncomeCategories.has(cat)) return false;
      if (t.tipo === 'debito' && !selectedExpenseCategories.has(cat)) return false;

      return true;
    });
  }, [
    dbTransactions,
    filterReconciliation,
    filterStartDate,
    filterEndDate,
    filterYear,
    selectedMonths,
    selectedIncomeCategories,
    selectedExpenseCategories,
  ]);

  // --- MONTHLY DATA AGGREGATION & SALDOS ---
  const monthlyAggregatedData = useMemo(() => {
    const map = new Map<
      string,
      { monthKey: string; ingresos: number; gastos: number; txs: Transaction[] }
    >();

    // Seed all chronological months within filter range to keep timelines solid
    if (filteredTransactions.length > 0) {
      const sorted = [...filteredTransactions].sort((a, b) => a.fecha.localeCompare(b.fecha));
      const first = new Date(sorted[0].fecha);
      const last = new Date(sorted[sorted.length - 1].fecha);

      const curr = new Date(first.getFullYear(), first.getMonth(), 1);
      while (curr <= last) {
        const ym = `${curr.getFullYear()}-${String(curr.getMonth() + 1).padStart(2, '0')}`;
        map.set(ym, { monthKey: ym, ingresos: 0, gastos: 0, txs: [] });
        curr.setMonth(curr.getMonth() + 1);
      }
    }

    // Populate actual figures
    filteredTransactions.forEach((t) => {
      const ym = t.fecha.substring(0, 7);
      if (!map.has(ym)) {
        map.set(ym, { monthKey: ym, ingresos: 0, gastos: 0, txs: [] });
      }
      const b = map.get(ym)!;
      if (t.tipo === 'credito') {
        b.ingresos += t.monto;
      } else {
        b.gastos += t.monto;
      }
      b.txs.push(t);
    });

    const sortedYm = Array.from(map.keys()).sort();
    let currentBal = initialBalanceInput;

    const finalMonths = sortedYm.map((ym) => {
      const b = map.get(ym)!;
      const net = b.ingresos - b.gastos;

      // Track daily averages
      const [year, month] = ym.split('-').map(Number);
      const daysInMonth = new Date(year, month, 0).getDate();
      const dailyBalances: number[] = [];
      let runningBal = currentBal;

      for (let d = 1; d <= daysInMonth; d++) {
        const dayStr = `${ym}-${String(d).padStart(2, '0')}`;
        const dayTxs = b.txs.filter((t) => t.fecha === dayStr);
        dayTxs.forEach((t) => {
          if (t.tipo === 'credito') runningBal += t.monto;
          else runningBal -= t.monto;
        });
        dailyBalances.push(runningBal);
      }

      // eslint-disable-next-line react-hooks/immutability
      currentBal = runningBal;
      const avg = dailyBalances.reduce((s, x) => s + x, 0) / daysInMonth;

      // Formatting label
      const monthIndex = month - 1;
      const label = MONTHS_SPANISH[monthIndex]?.name || ym;

      return {
        monthKey: ym,
        monthLabel: `${label} ${year}`,
        ingresos: b.ingresos,
        gastos: b.gastos,
        netFlow: net,
        cierre: currentBal,
        promedio: avg,
        txs: b.txs,
      };
    });

    return finalMonths;
  }, [filteredTransactions, initialBalanceInput]);

  // --- STATS & KPI CALCULATIONS ---
  const stats = useMemo(() => {
    let revenue = 0;
    let expenses = 0;
    let commissions = 0;

    filteredTransactions.forEach((t) => {
      if (t.tipo === 'credito') {
        revenue += t.monto;
      } else {
        expenses += t.monto;
        if (t.categoria === 'Comisiones Bancarias' || t.categoria === 'Comisión Bancaria') {
          commissions += t.monto;
        }
      }
    });

    const netFlow = revenue - expenses;
    const finalBalance =
      monthlyAggregatedData.length > 0
        ? monthlyAggregatedData[monthlyAggregatedData.length - 1].cierre
        : initialBalanceInput;

    return {
      revenue,
      expenses,
      netFlow,
      commissions,
      finalBalance,
    };
  }, [filteredTransactions, monthlyAggregatedData, initialBalanceInput]);

  // --- CATEGORY CHART PREPARATION ---
  const expensesByCategoryData = useMemo(() => {
    const counts: Record<string, number> = {};
    // Seed only the categories currently selected (active in filter)
    Array.from(selectedExpenseCategories).forEach((c) => {
      counts[c] = 0;
    });

    filteredTransactions.forEach((t) => {
      if (t.tipo === 'debito') {
        const cat = t.categoria || 'Otros egresos';
        if (selectedExpenseCategories.has(cat)) {
          counts[cat] = (counts[cat] || 0) + t.monto;
        }
      }
    });

    const activeCats = Array.from(selectedExpenseCategories);
    const total = activeCats.reduce((a, c) => a + (counts[c] || 0), 0);

    return activeCats.map((cat, idx) => {
      const value = counts[cat] || 0;
      const percentage = total > 0 ? (value / total) * 100 : 0;
      return {
        name: cat,
        value,
        percentage,
        color: Object.values(PALETTE)[idx % Object.values(PALETTE).length],
      };
    });
  }, [filteredTransactions, selectedExpenseCategories]);

  const incomeByCategoryData = useMemo(() => {
    const counts: Record<string, number> = {};
    // Seed only the categories currently selected (active in filter)
    Array.from(selectedIncomeCategories).forEach((c) => {
      counts[c] = 0;
    });

    filteredTransactions.forEach((t) => {
      if (t.tipo === 'credito') {
        const cat = t.categoria || 'Otros ingresos';
        if (selectedIncomeCategories.has(cat)) {
          counts[cat] = (counts[cat] || 0) + t.monto;
        }
      }
    });

    const activeCats = Array.from(selectedIncomeCategories);
    const total = activeCats.reduce((a, c) => a + (counts[c] || 0), 0);

    return activeCats.map((cat, idx) => {
      const value = counts[cat] || 0;
      const percentage = total > 0 ? (value / total) * 100 : 0;
      return {
        name: cat,
        value,
        percentage,
        color: Object.values(PALETTE)[(idx + 3) % Object.values(PALETTE).length],
      };
    });
  }, [filteredTransactions, selectedIncomeCategories]);

  // --- CUSTOM DATA DERIVATIONS FOR 10 CHARTS ---

  const minCierreMonth = useMemo(() => {
    if (monthlyAggregatedData.length === 0) return null;
    let minVal = Infinity;
    let minMonth = '';
    monthlyAggregatedData.forEach((m) => {
      if (m.cierre < minVal) {
        minVal = m.cierre;
        minMonth = m.monthKey;
      }
    });
    return minMonth;
  }, [monthlyAggregatedData]);

  const topExpenseCategory = useMemo(() => {
    const totals: Record<string, number> = {};
    dbTransactions
      .filter((t) => t.tipo === 'debito')
      .forEach((t) => {
        const cat = t.categoria || 'Otros egresos';
        if (cat !== 'Otros egresos') {
          totals[cat] = (totals[cat] || 0) + t.monto;
        }
      });
    const sorted = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
    return sorted[0] || 'Egresos Principales';
  }, [dbTransactions]);

  const topExpenseCategoryData = useMemo(() => {
    return monthlyAggregatedData.map((m) => {
      const val = m.txs
        .filter((t) => t.categoria === topExpenseCategory)
        .reduce((s, t) => s + t.monto, 0);
      return {
        month: m.monthLabel,
        Monto: val,
      };
    });
  }, [monthlyAggregatedData, topExpenseCategory]);

  const top3ExpenseCategories = useMemo(() => {
    const totals: Record<string, number> = {};
    dbTransactions
      .filter((t) => t.tipo === 'debito')
      .forEach((t) => {
        const cat = t.categoria || 'Otros egresos';
        if (cat !== 'Otros egresos') {
          totals[cat] = (totals[cat] || 0) + t.monto;
        }
      });
    return Object.keys(totals)
      .sort((a, b) => totals[b] - totals[a])
      .slice(0, 3);
  }, [dbTransactions]);

  const recurrentExpensesData = useMemo(() => {
    return monthlyAggregatedData.map((m) => {
      const data: Record<string, unknown> = { month: m.monthLabel };
      top3ExpenseCategories.forEach((cat) => {
        data[cat] = m.txs.filter((t) => t.categoria === cat).reduce((s, t) => s + t.monto, 0);
      });
      return data;
    });
  }, [monthlyAggregatedData, top3ExpenseCategories]);

  const top3IncomeCategories = useMemo(() => {
    const totals: Record<string, number> = {};
    dbTransactions
      .filter((t) => t.tipo === 'credito')
      .forEach((t) => {
        const cat = t.categoria || 'Otros ingresos';
        if (cat !== 'Otros ingresos') {
          totals[cat] = (totals[cat] || 0) + t.monto;
        }
      });
    return Object.keys(totals)
      .sort((a, b) => totals[b] - totals[a])
      .slice(0, 3);
  }, [dbTransactions]);

  const platformIncomeData = useMemo(() => {
    return monthlyAggregatedData.map((m) => {
      const data: Record<string, unknown> = { month: m.monthLabel };
      top3IncomeCategories.forEach((cat) => {
        data[cat] = m.txs.filter((t) => t.categoria === cat).reduce((s, t) => s + t.monto, 0);
      });
      return data;
    });
  }, [monthlyAggregatedData, top3IncomeCategories]);

  const topIncomeCategory = useMemo(() => {
    const totals: Record<string, number> = {};
    dbTransactions
      .filter((t) => t.tipo === 'credito')
      .forEach((t) => {
        const cat = t.categoria || 'Otros ingresos';
        if (cat !== 'Otros ingresos') {
          totals[cat] = (totals[cat] || 0) + t.monto;
        }
      });
    const sorted = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
    return sorted[0] || 'Ingreso Principal';
  }, [dbTransactions]);

  const rentasVsOperacionesData = useMemo(() => {
    return monthlyAggregatedData.map((m) => {
      const rentas = m.txs
        .filter((t) => t.categoria === topIncomeCategory)
        .reduce((s, t) => s + t.monto, 0);
      const operaciones = m.txs
        .filter((t) => t.tipo === 'credito' && t.categoria !== topIncomeCategory)
        .reduce((s, t) => s + t.monto, 0);
      return {
        month: m.monthLabel,
        Rentas: rentas,
        Operaciones: operaciones,
      };
    });
  }, [monthlyAggregatedData, topIncomeCategory]);

  // Recharts tooltip formatter helper
  const fmtTooltip = (value: string | number) => formatCurrency(Number(value));

  // --- AUTOMATED CONCLUSIONS & ALERTS GENERATOR (Grouped) ---
  const categorizedConclusions = useMemo(() => {
    const alerts: { icon: string; text: React.ReactNode; title: string }[] = [];
    const structure: { icon: string; text: React.ReactNode; title: string }[] = [];
    const opportunities: { icon: string; text: React.ReactNode; title: string }[] = [];

    if (monthlyAggregatedData.length === 0) return { alerts, structure, opportunities };

    const finalBal = stats.finalBalance;
    const diffBal = finalBal - initialBalanceInput;
    const changePct = initialBalanceInput > 0 ? (diffBal / initialBalanceInput) * 105 : 100;
    const isEn = language === 'en';

    // 1. Tendencia del saldo
    if (finalBal < initialBalanceInput) {
      alerts.push({
        icon: '⚠️',
        title: isEn ? 'Ending Balance Decreasing' : 'Saldo Final a la Baja',
        text: isEn ? (
          <span>
            The closing treasury balance decreased by{' '}
            <strong>{Math.abs(changePct).toFixed(1)}%</strong> compared to the starting balance.
          </span>
        ) : (
          <span>
            El saldo de cierre de tesorería disminuyó un{' '}
            <strong>{Math.abs(changePct).toFixed(1)}%</strong> con respecto al balance inicial.
          </span>
        ),
      });
    } else {
      structure.push({
        icon: '✅',
        title: isEn ? 'Treasury Growth' : 'Crecimiento de Tesorería',
        text: isEn ? (
          <span>
            The ending balance increased by <strong>{changePct.toFixed(1)}%</strong> compared to the
            starting balance of the period.
          </span>
        ) : (
          <span>
            El balance final se incrementó un <strong>{changePct.toFixed(1)}%</strong> en
            comparación con el saldo inicial del período.
          </span>
        ),
      });
    }

    // 2. Meses negativos y flujo
    let posCount = 0;
    const negMonths: string[] = [];
    monthlyAggregatedData.forEach((m) => {
      if (m.netFlow >= 0) posCount++;
      else negMonths.push(m.monthLabel);
    });

    if (negMonths.length > 0) {
      alerts.push({
        icon: '📉',
        title: isEn ? 'Monthly Deficit Detected' : 'Déficit Mensual Detectado',
        text: isEn ? (
          <span>
            There were <strong>{negMonths.length} deficit months</strong> recorded (
            {negMonths.join(', ')}), suggesting temporary cash flow pressures.
          </span>
        ) : (
          <span>
            Se registraron <strong>{negMonths.length} meses deficitarios</strong> (
            {negMonths.join(', ')}), lo que sugiere tensiones temporales de caja.
          </span>
        ),
      });
    } else {
      structure.push({
        icon: '📊',
        title: isEn ? 'Sustained Positive Cash Flow' : 'Flujo Positivo Sostenido',
        text: isEn ? (
          <span>100% positive cash flow: all months registered an accumulated net surplus.</span>
        ) : (
          <span>
            Flujo de caja 100% positivo: todos los meses registraron superávit neto acumulado.
          </span>
        ),
      });
    }

    // 3. Mayor Egreso
    const validExpCats = expensesByCategoryData.filter((d) => d.name !== 'Otros egresos');
    const topExp = [...validExpCats].sort((a, b) => b.value - a.value)[0];
    if (topExp && topExp.value > 0) {
      const displayCat =
        topExp.name === 'Sin asignar' ? (isEn ? 'Unassigned' : 'Sin asignar') : topExp.name;
      structure.push({
        icon: '💰',
        title: isEn ? 'Expense Concentration' : 'Concentración de Egresos',
        text: isEn ? (
          <span>
            Outflows to <strong>{displayCat}</strong> represent{' '}
            <strong>{topExp.percentage.toFixed(1)}%</strong> of total expenses (
            {formatCurrency(topExp.value)}).
          </span>
        ) : (
          <span>
            Las salidas hacia <strong>{displayCat}</strong> representan el{' '}
            <strong>{topExp.percentage.toFixed(1)}%</strong> del gasto total (
            {formatCurrency(topExp.value)}).
          </span>
        ),
      });

      if (topExp.percentage > 15) {
        alerts.push({
          icon: '💳',
          title: isEn ? 'Expense Dependency Alert' : 'Alerta de Dependencia de Gasto',
          text: isEn ? (
            <span>
              The account <strong>{displayCat}</strong> concentrates more than 15% of operational
              outflows. A review of recurring invoices is suggested.
            </span>
          ) : (
            <span>
              La cuenta <strong>{displayCat}</strong> concentra más del 15% de egresos
              operacionales. Se sugiere una revisión de facturas recurrentes.
            </span>
          ),
        });
      }
    }

    // 4. Mayor Ingreso
    const validIncomeCats = incomeByCategoryData.filter(
      (d) => d.name !== 'Otros ingresos' && d.value > 0,
    );
    const sortedIncomes = [...validIncomeCats].sort((a, b) => b.value - a.value);
    const mainIncome = sortedIncomes[0];
    if (mainIncome) {
      const displayCat =
        mainIncome.name === 'Sin asignar' ? (isEn ? 'Unassigned' : 'Sin asignar') : mainIncome.name;
      structure.push({
        icon: '📈',
        title: isEn ? 'Primary Source of Funds' : 'Principal Fuente de Recursos',
        text: isEn ? (
          <span>
            <strong>{displayCat}</strong> constitutes the primary source of funds, representing{' '}
            <strong>{mainIncome.percentage.toFixed(1)}%</strong> of credits.
          </span>
        ) : (
          <span>
            <strong>{displayCat}</strong> constituye la mayor vía de captación, representando el{' '}
            <strong>{mainIncome.percentage.toFixed(1)}%</strong> de créditos.
          </span>
        ),
      });

      if (mainIncome.percentage > 80) {
        alerts.push({
          icon: '⚠️',
          title: isEn ? 'Income Concentration Risk' : 'Riesgo de Concentración de Ingresos',
          text: isEn ? (
            <span>
              The company has a dependency of <strong>{mainIncome.percentage.toFixed(1)}%</strong>{' '}
              on a single category of income. Diversifying the portfolio is recommended.
            </span>
          ) : (
            <span>
              La empresa tiene una dependencia del{' '}
              <strong>{mainIncome.percentage.toFixed(1)}%</strong> de una sola categoría de
              ingresos. Se sugiere diversificar cartera.
            </span>
          ),
        });
      }
    }

    // 5. Saldo Mínimo vs Seguridad
    let minBal = Infinity;
    let minBalMonth = '';
    monthlyAggregatedData.forEach((m) => {
      if (m.cierre < minBal) {
        minBal = m.cierre;
        minBalMonth = m.monthLabel;
      }
    });

    if (minBalMonth && minBal !== Infinity) {
      const threshold = 15000;
      const below = minBal < threshold;
      if (below) {
        alerts.push({
          icon: '🚨',
          title: isEn ? 'Safety Reserve Violated' : 'Reserva de Seguridad Vulnerada',
          text: isEn ? (
            <span>
              In <strong>{minBalMonth}</strong> the balance fell to{' '}
              <strong>{formatCurrency(minBal)}</strong>, below the safety minimum of $15,000.
            </span>
          ) : (
            <span>
              En <strong>{minBalMonth}</strong> el saldo cayó a{' '}
              <strong>{formatCurrency(minBal)}</strong>, por debajo del mínimo prudencial de
              $15,000.
            </span>
          ),
        });
      } else {
        structure.push({
          icon: '🛡️',
          title: isEn ? 'Solid Safety Cushion' : 'Colchón de Seguridad Sólido',
          text: isEn ? (
            <span>
              The minimum balance remained at <strong>{formatCurrency(minBal)}</strong>, preserving
              the minimum safety cushion.
            </span>
          ) : (
            <span>
              El saldo mínimo se mantuvo en <strong>{formatCurrency(minBal)}</strong>, preservando
              el colchón mínimo de seguridad.
            </span>
          ),
        });
      }
    }

    // 6. Oportunidades y Recomendaciones
    if (stats.netFlow >= 0) {
      opportunities.push({
        icon: '🚀',
        title: isEn ? 'Surplus Optimization' : 'Optimización de Excedentes',
        text: isEn ? (
          <span>
            With a net positive flow of <strong>{formatCurrency(stats.netFlow)}</strong>, there is
            an opportunity to reinvest in expansion or settle high-interest debt.
          </span>
        ) : (
          <span>
            Con un flujo positivo neto de <strong>{formatCurrency(stats.netFlow)}</strong>, existe
            oportunidad para reinvertir en expansión o liquidar deudas costosas.
          </span>
        ),
      });
      opportunities.push({
        icon: '🏦',
        title: isEn ? 'Strategic Placement' : 'Colocaciones Estratégicas',
        text: isEn ? (
          <span>
            It is recommended to place temporary surplus in low-risk liquid funds to generate stable
            passive returns.
          </span>
        ) : (
          <span>
            Se recomienda colocar excedentes temporales en fondos líquidos de bajo riesgo para
            generar rendimientos pasivos estables.
          </span>
        ),
      });
    } else {
      opportunities.push({
        icon: '✂️',
        title: isEn ? 'Strict Expense Control' : 'Control Estricto de Gastos',
        text: isEn ? (
          <span>
            The net flow for the period is negative. Renegotiating fixed-expense contracts is urged
            to restore treasury balance.
          </span>
        ) : (
          <span>
            El flujo neto del periodo es negativo. Urge renegociar contratos de egresos fijos para
            restablecer el equilibrio de tesorería.
          </span>
        ),
      });
      opportunities.push({
        icon: '📈',
        title: isEn ? 'Active Outflow Strategy' : 'Estrategia de Captación Activa',
        text: isEn ? (
          <span>
            Prioritize short-term campaigns and accelerate billing of pending services to inject
            immediate liquidity.
          </span>
        ) : (
          <span>
            Priorizar campañas de captación a corto plazo y acelerar la facturación de servicios
            pendientes para inyectar liquidez inmediata.
          </span>
        ),
      });
    }

    const pendingCount = dbTransactions.filter((t) => !t.conciliado).length;
    if (pendingCount > 0) {
      opportunities.push({
        icon: '🎯',
        title: isEn ? 'Accounting Optimization' : 'Optimización Contable',
        text: isEn ? (
          <span>
            There are <strong>{pendingCount} pending transactions</strong> to reconcile. Completing
            reconciliation will improve fiscal balance precision.
          </span>
        ) : (
          <span>
            Hay <strong>{pendingCount} transacciones pendientes</strong> por conciliar. Completar la
            conciliación mejorará la precisión del balance fiscal.
          </span>
        ),
      });
    }

    return { alerts, structure, opportunities };
  }, [
    monthlyAggregatedData,
    stats.finalBalance,
    initialBalanceInput,
    expensesByCategoryData,
    incomeByCategoryData,
    stats.netFlow,
    dbTransactions,
    language,
  ]);

  // --- FILTERS TOGGLE HANDLERS ---
  const toggleAllMonths = (checked: boolean) => {
    if (checked) {
      setSelectedMonths(new Set(MONTHS_SPANISH.map((m) => m.key)));
    } else {
      setSelectedMonths(new Set());
    }
  };

  const toggleMonth = (key: string) => {
    const next = new Set(selectedMonths);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedMonths(next);
  };

  const toggleAllIncome = (checked: boolean) => {
    if (checked) setSelectedIncomeCategories(new Set(allIncomeCategories));
    else setSelectedIncomeCategories(new Set());
  };

  const toggleIncome = (cat: string) => {
    const next = new Set(selectedIncomeCategories);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    setSelectedIncomeCategories(next);
  };

  const toggleAllExpenses = (checked: boolean) => {
    if (checked) setSelectedExpenseCategories(new Set(allExpenseCategories));
    else setSelectedExpenseCategories(new Set());
  };

  const toggleExpense = (cat: string) => {
    const next = new Set(selectedExpenseCategories);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    setSelectedExpenseCategories(next);
  };

  const clearFilters = () => {
    setFilterReconciliation('all');
    if (dbTransactions.length > 0) {
      const dates = dbTransactions.map((t) => t.fecha).sort();
      setFilterStartDate(dates[0]);
      setFilterEndDate(dates[dates.length - 1]);
    }
    setFilterYear('all');
    setInitialBalanceInput(apiInitialBalance.current);
    setSelectedMonths(new Set(MONTHS_SPANISH.map((m) => m.key)));
    setSelectedIncomeCategories(new Set(allIncomeCategories));
    setSelectedExpenseCategories(new Set(allExpenseCategories));
  };

  // --- EXPORT TRIGGERS ---
  const handleExportClassified = () => {
    if (filteredTransactions.length === 0) return;
    let csv = '\uFEFFfecha,descripcion,monto,tipo,cuenta_contable,conciliado,categoria,mes\n';
    filteredTransactions.forEach((t) => {
      const month = t.fecha.substring(0, 7);
      const descEscaped = `"${(t.descripcion || '').replace(/"/g, '""')}"`;
      const ctaEscaped = `"${(t.cuenta_contable || '').replace(/"/g, '""')}"`;
      const catEscaped = `"${(t.categoria || 'Otros egresos').replace(/"/g, '""')}"`;
      csv += `${t.fecha},${descEscaped},${t.monto},${t.tipo},${ctaEscaped},${t.conciliado ? 'si' : 'no'},${catEscaped},${month}\n`;
    });

    triggerCSVDownload('transacciones_clasificadas.csv', csv);
  };

  const handleExportSummary = () => {
    if (monthlyAggregatedData.length === 0) return;
    let csv = '\uFEFFmes,ingresos,egresos,flujo_neto,saldo_cierre,saldo_promedio\n';
    monthlyAggregatedData.forEach((m) => {
      csv += `${m.monthKey},${m.ingresos.toFixed(2)},${m.gastos.toFixed(2)},${m.netFlow.toFixed(2)},${m.cierre.toFixed(2)},${m.promedio.toFixed(2)}\n`;
    });

    triggerCSVDownload('resumen_mensual_dashboard.csv', csv);
  };

  const triggerCSVDownload = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!mounted || loading) {
    return <LoadingState mounted={mounted} loadingText={dt.loadingMetrics} />;
  }

  if (!loading && dbTransactions.length === 0) {
    return (
      <EmptyState
        title={dt.noTransactionsTitle}
        description={dt.noTransactionsDesc}
        buttonLabel={dt.goImport}
        onGoImport={() => setCurrentView && setCurrentView('banks')}
      />
    );
  }

  return (
    <div className="space-y-8 pb-16">
      {/* HEADER SECTION */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="bg-teal-500/10 text-teal-600 dark:text-teal-400 text-xs px-2.5 py-1 rounded-full font-bold uppercase tracking-wider">
              {isDemoMode ? dt.demoMode : dt.systemData}
            </span>
            {isDemoMode && (
              <span className="bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs px-2.5 py-1 rounded-full font-bold uppercase tracking-wider flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> {dt.idealForTesting}
              </span>
            )}
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white mt-2 tracking-tight">
            {dt.financialDashboard} — {activeCompany?.legalName || dt.myCompany || 'Mi Empresa'}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-medium flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-teal-500" />
            {bankAccountInfo
              ? `${bankAccountInfo.bankName} — ${bankAccountInfo.accountName}${bankAccountInfo.accountNo ? ' #' + bankAccountInfo.accountNo : ''}`
              : dt.noBankAccount}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setHelpOpen(true)}
            className="rounded-xl border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-900"
          >
            <HelpCircle className="w-4 h-4 text-slate-400" />
            {dt.supportedFormat}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setFiltersOpen(!filtersOpen)}
            className={`rounded-xl border-slate-200 dark:border-slate-800 gap-1.5 ${filtersOpen ? 'bg-teal-50 dark:bg-teal-950/20 text-teal-600 dark:text-teal-400' : 'text-slate-700 dark:text-slate-300'}`}
          >
            <Filter className="w-4 h-4" />
            {filtersOpen ? dt.hideFilters : dt.showFilters}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            className="rounded-xl border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* FILTER DRAWER / PANEL */}
      <AnimatePresence>
        {filtersOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 overflow-hidden shadow-sm"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4 mb-6">
              <div className="flex items-center gap-2">
                <Filter className="w-4.5 h-4.5 text-teal-500" />
                <h3 className="font-bold text-slate-950 dark:text-slate-50 text-sm uppercase tracking-wider">
                  {dt.dynamicFilters}
                </h3>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white flex items-center gap-1 rounded-xl"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> {dt.clearFilters}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* Reconciliation Filter */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                  {dt.reconStatus}
                </label>
                <select
                  value={filterReconciliation}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterReconciliation(e.target.value as 'all' | 'reconciled' | 'unreconciled')}
                  className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:border-teal-500 font-medium"
                >
                  <option value="all">{dt.allTransactions}</option>
                  <option value="reconciled">{dt.onlyReconciled}</option>
                  <option value="unreconciled">{dt.onlyUnreconciled}</option>
                </select>
              </div>

              {/* Start Date */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                  {dt.startDate}
                </label>
                <div className="relative">
                  <input
                    type="date"
                    value={filterStartDate}
                    onChange={(e) => setFilterStartDate(e.target.value)}
                    className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:border-teal-500 font-medium"
                  />
                </div>
              </div>

              {/* End Date */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                  {dt.endDate}
                </label>
                <input
                  type="date"
                  value={filterEndDate}
                  onChange={(e) => setFilterEndDate(e.target.value)}
                  className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:border-teal-500 font-medium"
                />
              </div>

              {/* Initial Balance */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                  {dt.initialBalance}
                </label>
                <input
                  type="text"
                  value={initialBalanceDisplay}
                  onChange={(e) => handleChangeInitialBalance(e.target.value)}
                  onBlur={handleBlurInitialBalance}
                  className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-mono font-bold text-slate-800 dark:text-slate-200 focus:outline-none focus:border-teal-500"
                />
              </div>
            </div>

            {/* Sub-Filters Checkboxes */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6 pt-6 border-t border-slate-200 dark:border-slate-800">
              {/* Months filter */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                    {dt.selectedMonths}
                  </span>
                  <label className="flex items-center gap-1 text-[10px] font-bold text-teal-600 dark:text-teal-400 uppercase cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={selectedMonths.size === MONTHS_SPANISH.length}
                      onChange={(e) => toggleAllMonths(e.target.checked)}
                      className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 w-3 h-3"
                    />
                    {dt.all}
                  </label>
                </div>
                <div className="grid grid-cols-4 gap-2 bg-white dark:bg-slate-950/60 p-3 rounded-2xl border border-slate-200 dark:border-slate-800/80">
                  {MONTHS_SPANISH.map((m) => {
                    const isChecked = selectedMonths.has(m.key);
                    return (
                      <label
                        key={m.key}
                        className={`flex items-center gap-1.5 text-xs font-semibold px-2 py-1.5 rounded-lg cursor-pointer transition-colors border ${isChecked ? 'bg-teal-500/10 border-teal-500/20 text-teal-700 dark:text-teal-400' : 'bg-slate-50 dark:bg-slate-900 border-transparent text-slate-500 dark:text-slate-400'}`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleMonth(m.key)}
                          className="hidden"
                        />
                        {getMonthName(m.key, language)}
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Income Categories */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                    {dt.incomeCategories}
                  </span>
                  <label className="flex items-center gap-1 text-[10px] font-bold text-teal-600 dark:text-teal-400 uppercase cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={selectedIncomeCategories.size === allIncomeCategories.length}
                      onChange={(e) => toggleAllIncome(e.target.checked)}
                      className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 w-3 h-3"
                    />
                    {dt.allF}
                  </label>
                </div>
                <div className="max-h-[120px] overflow-y-auto space-y-1 bg-white dark:bg-slate-950/60 p-3 rounded-2xl border border-slate-200 dark:border-slate-800/80">
                  {allIncomeCategories.map((cat) => (
                    <label
                      key={cat}
                      className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIncomeCategories.has(cat)}
                        onChange={() => toggleIncome(cat)}
                        className="rounded border-slate-300 dark:border-slate-700 text-teal-600 focus:ring-teal-500 w-3.5 h-3.5 bg-transparent"
                      />
                      {cat === 'Sin asignar'
                        ? language === 'en'
                          ? 'Unassigned'
                          : 'Sin asignar'
                        : cat}
                    </label>
                  ))}
                </div>
              </div>

              {/* Expense Categories */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                    {dt.expenseCategories}
                  </span>
                  <label className="flex items-center gap-1 text-[10px] font-bold text-teal-600 dark:text-teal-400 uppercase cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={selectedExpenseCategories.size === allExpenseCategories.length}
                      onChange={(e) => toggleAllExpenses(e.target.checked)}
                      className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 w-3 h-3"
                    />
                    {dt.allF}
                  </label>
                </div>
                <div className="max-h-[120px] overflow-y-auto space-y-1 bg-white dark:bg-slate-950/60 p-3 rounded-2xl border border-slate-200 dark:border-slate-800/80">
                  {allExpenseCategories.map((cat) => (
                    <label
                      key={cat}
                      className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedExpenseCategories.has(cat)}
                        onChange={() => toggleExpense(cat)}
                        className="rounded border-slate-300 dark:border-slate-700 text-teal-600 focus:ring-teal-500 w-3.5 h-3.5 bg-transparent"
                      />
                      {cat === 'Sin asignar'
                        ? language === 'en'
                          ? 'Unassigned'
                          : 'Sin asignar'
                        : cat}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Quick Metrics Info */}
            <div className="flex flex-wrap items-center gap-4 mt-6 pt-4 border-t border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500">
              <span className="bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full">
                {dbTransactions.length} {dt.totalTxSuffix}
              </span>
              <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-3 py-1 rounded-full font-bold">
                {filteredTransactions.length} {dt.filteredTxSuffix}
              </span>
              <span className="bg-teal-500/10 text-teal-600 dark:text-teal-400 px-3 py-1 rounded-full font-bold">
                {dbTransactions.filter((t) => t.conciliado).length} {dt.reconciledSuffix}
              </span>
              <span className="bg-rose-500/10 text-rose-600 dark:text-rose-400 px-3 py-1 rounded-full font-bold">
                {dbTransactions.filter((t) => !t.conciliado).length} {dt.pendingSuffix}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* KPI METRIC CARDS GRID (6 Cards) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-5">
        <PremiumCard
          title={dt.totalIncome}
          value={formatCurrency(stats.revenue)}
          trend="+10.4%"
          isUp={true}
          color="teal"
        />
        <PremiumCard
          title={dt.totalExpenses}
          value={formatCurrency(stats.expenses)}
          trend="+8.2%"
          isUp={false}
          color="rose"
        />
        <PremiumCard
          title={dt.netFlow}
          value={formatCurrency(stats.netFlow)}
          trend=""
          isUp={stats.netFlow >= 0}
          color="emerald"
          isSpecialColor={true}
        />
        <PremiumCard
          title={dt.startingBalance}
          value={formatCurrency(initialBalanceInput)}
          trend=""
          isUp={true}
          color="blue"
        />
        <PremiumCard
          title={dt.endingBalance}
          value={formatCurrency(stats.finalBalance)}
          trend=""
          isUp={stats.finalBalance >= initialBalanceInput}
          color="teal"
          isSpecialBalance={true}
          isDrop={stats.finalBalance < initialBalanceInput}
        />
        <PremiumCard
          title={dt.commissions}
          value={formatCurrency(stats.commissions)}
          trend=""
          isUp={false}
          color="gray"
        />
      </div>

      {/* SECCIÓN DE CONCILIACIÓN OPERATIVA (KPIs & Progreso) */}
      {dbTransactions.length > 0 && (
        <div className="bg-gradient-to-br from-teal-500/5 to-indigo-500/5 dark:from-teal-500/10 dark:to-indigo-500/10 border border-teal-500/10 dark:border-teal-500/20 rounded-3xl p-6 shadow-sm">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
            <div className="space-y-2">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-teal-500" />
                {language === 'en'
                  ? 'Operational Reconciliation Status'
                  : 'Estado de Conciliación Operativa'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                {language === 'en'
                  ? 'Audit control of bank statement entries matched against GL Ledger.'
                  : 'Control de auditoría de partidas bancarias confrontadas contra el Libro Mayor.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-6 lg:gap-12 w-full lg:w-auto">
              {/* Progreso Visual */}
              <div className="flex items-center gap-4 flex-1 lg:flex-initial min-w-[200px]">
                <div className="relative w-16 h-16 shrink-0 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                    <path
                      className="text-slate-200 dark:text-slate-800"
                      strokeWidth="3.5"
                      stroke="currentColor"
                      fill="none"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                    <path
                      className="text-teal-500 transition-all duration-500"
                      strokeWidth="3.5"
                      strokeDasharray={`${((dbTransactions.filter((t) => t.conciliado).length / dbTransactions.length) * 100).toFixed(1)}, 100`}
                      strokeLinecap="round"
                      stroke="currentColor"
                      fill="none"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                  </svg>
                  <span className="absolute text-xs font-bold text-slate-900 dark:text-white">
                    {(
                      (dbTransactions.filter((t) => t.conciliado).length / dbTransactions.length) *
                      100
                    ).toFixed(0)}
                    %
                  </span>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    {language === 'en' ? 'Reconciliation Rate' : 'Tasa de Conciliación'}
                  </p>
                  <p className="text-xl font-extrabold text-teal-600 dark:text-teal-400">
                    {(
                      (dbTransactions.filter((t) => t.conciliado).length / dbTransactions.length) *
                      100
                    ).toFixed(1)}
                    %
                  </p>
                </div>
              </div>

              {/* Contadores */}
              <div className="grid grid-cols-3 gap-6 lg:gap-8 flex-1">
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    {language === 'en' ? 'Total Entries' : 'Total Movimientos'}
                  </p>
                  <p className="text-lg font-black text-slate-950 dark:text-slate-50">
                    {dbTransactions.length}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-teal-500" />
                    {language === 'en' ? 'Reconciled' : 'Conciliados'}
                  </p>
                  <p className="text-lg font-black text-teal-600 dark:text-teal-400">
                    {dbTransactions.filter((t) => t.conciliado).length}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-rose-500" />
                    {language === 'en' ? 'Pending' : 'Sin Conciliar'}
                  </p>
                  <p className="text-lg font-black text-rose-600 dark:text-rose-400">
                    {dbTransactions.filter((t) => !t.conciliado).length}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <ChartsGrid
        language={language}
        monthlyAggregatedData={monthlyAggregatedData}
        minCierreMonth={minCierreMonth}
        expensesByCategoryData={expensesByCategoryData}
        incomeByCategoryData={incomeByCategoryData}
        topExpenseCategory={topExpenseCategory}
        topExpenseCategoryData={topExpenseCategoryData}
        recurrentExpensesData={recurrentExpensesData}
        top3ExpenseCategories={top3ExpenseCategories}
        platformIncomeData={platformIncomeData}
        top3IncomeCategories={top3IncomeCategories}
        topIncomeCategory={topIncomeCategory}
        rentasVsOperacionesData={rentasVsOperacionesData}
      />


      {/* AUTOMATED CONCLUSIONS & ALERTS GROUPED */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Column 1: Señales de Alerta */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm flex flex-col">
          <div className="flex items-center gap-2 mb-6 pb-2 border-b border-slate-100 dark:border-slate-800/50">
            <span className="p-1.5 rounded-lg bg-rose-500/10 text-rose-600">
              <AlertCircle className="w-5 h-5" />
            </span>
            <h2 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider">
              {dt.alertSignals}
            </h2>
          </div>
          <div className="flex-1 space-y-4">
            {categorizedConclusions.alerts.length === 0 ? (
              <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 italic uppercase">
                {dt.noCriticalAlerts}
              </p>
            ) : (
              categorizedConclusions.alerts.map((conc, idx) => (
                <div
                  key={idx}
                  className="flex gap-3 items-start p-3 bg-rose-500/5 border border-rose-500/10 rounded-xl"
                >
                  <span className="text-lg leading-none shrink-0">{conc.icon}</span>
                  <div className="space-y-1">
                    <h4 className="text-xs font-extrabold text-rose-800 dark:text-rose-400 uppercase tracking-wider">
                      {conc.title}
                    </h4>
                    <p className="text-xs font-medium text-slate-600 dark:text-slate-300 leading-relaxed">
                      {conc.text}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Column 2: Estructura del Negocio */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm flex flex-col">
          <div className="flex items-center gap-2 mb-6 pb-2 border-b border-slate-100 dark:border-slate-800/50">
            <span className="p-1.5 rounded-lg bg-teal-500/10 text-teal-600">
              <Layers className="w-5 h-5" />
            </span>
            <h2 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider">
              {dt.businessStructure}
            </h2>
          </div>
          <div className="flex-1 space-y-4">
            {categorizedConclusions.structure.map((conc, idx) => (
              <div
                key={idx}
                className="flex gap-3 items-start p-3 bg-teal-500/5 border border-teal-500/10 rounded-xl"
              >
                <span className="text-lg leading-none shrink-0">{conc.icon}</span>
                <div className="space-y-1">
                  <h4 className="text-xs font-extrabold text-teal-800 dark:text-teal-400 uppercase tracking-wider">
                    {conc.title}
                  </h4>
                  <p className="text-xs font-medium text-slate-600 dark:text-slate-300 leading-relaxed">
                    {conc.text}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Column 3: Oportunidad */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm flex flex-col">
          <div className="flex items-center gap-2 mb-6 pb-2 border-b border-slate-100 dark:border-slate-800/50">
            <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600">
              <Zap className="w-5 h-5" />
            </span>
            <h2 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider">
              {dt.opportunities}
            </h2>
          </div>
          <div className="flex-1 space-y-4">
            {categorizedConclusions.opportunities.map((conc, idx) => (
              <div
                key={idx}
                className="flex gap-3 items-start p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-xl"
              >
                <span className="text-lg leading-none shrink-0">{conc.icon}</span>
                <div className="space-y-1">
                  <h4 className="text-xs font-extrabold text-emerald-800 dark:text-emerald-400 uppercase tracking-wider">
                    {conc.title}
                  </h4>
                  <p className="text-xs font-medium text-slate-600 dark:text-slate-300 leading-relaxed">
                    {conc.text}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* EXPORT ACTION FOOTER BAR */}
      <footer className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-teal-600" />
          <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
            {dt.legalTaxExportModule}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportClassified}
            className="rounded-xl border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 gap-1.5"
            disabled={filteredTransactions.length === 0}
          >
            <Download className="w-4 h-4" />
            {dt.exportClassifiedCSV}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleExportSummary}
            className="rounded-xl border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 gap-1.5"
            disabled={monthlyAggregatedData.length === 0}
          >
            <Download className="w-4 h-4" />
            {dt.exportMonthlySummaryCSV}
          </Button>
        </div>
      </footer>

      {/* SUPPORTED STRUCTURE HELP MODAL */}
      {helpOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-200 dark:border-slate-800 max-w-2xl w-full p-8 shadow-2xl relative overflow-hidden"
          >
            <button
              onClick={() => setHelpOpen(false)}
              className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 dark:hover:text-white text-2xl font-bold"
            >
              &times;
            </button>

            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
              {dt.requiredFileStructure}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
              {dt.supportedFormatHelpDesc}
            </p>

            <div className="overflow-hidden border border-slate-200 dark:border-slate-800 rounded-2xl mb-6">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950 font-bold text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-3">{dt.columnHeader}</th>
                    <th className="px-4 py-3">{dt.typeHeader}</th>
                    <th className="px-4 py-3">{dt.descriptionHeader}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-150 dark:divide-slate-850 font-medium text-slate-700 dark:text-slate-300">
                  <tr>
                    <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">fecha</td>
                    <td className="px-4 py-3">{language === 'en' ? 'Text' : 'Texto'}</td>
                    <td className="px-4 py-3">
                      {language === 'en'
                        ? 'Transaction date (YYYY-MM-DD, MM/DD/YYYY or DD/MM/YYYY).'
                        : 'Fecha de la transacción (YYYY-MM-DD, MM/DD/YYYY o DD/MM/YYYY).'}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">
                      descripcion
                    </td>
                    <td className="px-4 py-3">{language === 'en' ? 'Text' : 'Texto'}</td>
                    <td className="px-4 py-3">
                      {language === 'en'
                        ? 'Concept, beneficiary or detailed description of the transaction.'
                        : 'Concepto, beneficiario o descripción detallada de la transacción.'}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">monto</td>
                    <td className="px-4 py-3">{language === 'en' ? 'Number' : 'Número'}</td>
                    <td className="px-4 py-3">
                      {language === 'en'
                        ? 'Numeric value of the transaction (negative debits, positive credits).'
                        : 'Valor numérico de la transacción (debitos negativos, creditos positivos).'}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">tipo</td>
                    <td className="px-4 py-3">{language === 'en' ? 'Text' : 'Texto'}</td>
                    <td className="px-4 py-3">
                      {language === 'en'
                        ? 'Flow direction ("credit" or "debit"). Optional if amount has sign.'
                        : 'Dirección del flujo ("credito" o "debito"). Opcional si el monto tiene signo.'}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">
                      cuenta_contable
                    </td>
                    <td className="px-4 py-3">{language === 'en' ? 'Text' : 'Texto'}</td>
                    <td className="px-4 py-3">
                      {language === 'en'
                        ? 'Accounting code or associated catalog account (optional).'
                        : 'Código contable o cuenta del catálogo asociada (opcional).'}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">
                      conciliado
                    </td>
                    <td className="px-4 py-3">{language === 'en' ? 'Boolean' : 'Booleano'}</td>
                    <td className="px-4 py-3">
                      {language === 'en'
                        ? '"yes"/"no", "true"/"false" or "1"/"0" (optional, default "no").'
                        : '"si"/"no", "true"/"false" o "1"/"0" (opcional, por defecto "no").'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="text-xs text-slate-400 font-medium flex items-start gap-1.5">
              <Info className="w-4 h-4 shrink-0 text-teal-500" />
              {dt.supportedFormatHelpFootnote}
            </p>
          </motion.div>
        </div>
      )}
    </div>
  );
}

// --- PREMIUM REUSABLE COMPONENTS ---
interface PremiumCardProps {
  title: string;
  value: string;
  trend: string;
  isUp: boolean;
  color: string;
  isSpecialColor?: boolean;
  isSpecialBalance?: boolean;
  isDrop?: boolean;
}

function PremiumCard({
  title,
  value,
  trend,
  isUp,
  color,
  isSpecialColor = false,
  isSpecialBalance = false,
  isDrop = false,
}: PremiumCardProps) {
  const isPositive = isUp;

  const themes: Record<string, string> = {
    teal: 'bg-teal-500/10 border-teal-500/20 text-teal-600 dark:text-teal-400',
    rose: 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400',
    emerald: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400',
    blue: 'bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400',
    gray: 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-350',
  };

  const getDynamicColor = () => {
    if (isSpecialColor) {
      return isPositive
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-rose-600 dark:text-rose-400';
    }
    if (isSpecialBalance) {
      return isDrop ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white';
    }
    return 'text-slate-900 dark:text-white';
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-250 dark:border-slate-800/80 p-5 rounded-2xl shadow-sm hover:border-slate-300 dark:hover:border-slate-700 transition-all duration-300 relative group overflow-hidden">
      <div className="relative z-10 flex flex-col justify-between h-full space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block truncate max-w-[120px]">
            {title}
          </span>
          {trend && (
            <div
              className={`flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider ${isPositive ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'}`}
            >
              {isPositive ? (
                <ArrowUpRight className="w-2.5 h-2.5" />
              ) : (
                <ArrowDownRight className="w-2.5 h-2.5" />
              )}
              {trend}
            </div>
          )}
        </div>

        <div>
          <div
            className={`text-lg font-bold tracking-tight font-mono tabular-nums leading-none truncate ${getDynamicColor()}`}
          >
            {value}
          </div>
          <div className="w-full h-1 bg-slate-100 dark:bg-slate-950 rounded-full overflow-hidden border border-slate-200 dark:border-slate-850 mt-3">
            <div
              className={`h-full rounded-full ${isPositive ? 'bg-emerald-500' : 'bg-rose-500'}`}
              style={{ width: '65%' }}
            ></div>
          </div>
        </div>
      </div>
    </div>
  );
}
