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
  AlertCircle
} from 'lucide-react';
import {
  ResponsiveContainer,
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
  ReferenceLine
} from 'recharts';
import { Button } from '@/components/ui/button';
import { useLanguageStore } from '@/store/language-store';
import { useAuthStore } from '@/store/auth-store';
import { formatCurrency } from '@/lib/format';

// --- TYPES & STRUCTURES ---
interface Transaction {
  id: string;
  fecha: string;
  descripcion: string;
  monto: number;
  tipo: 'credito' | 'debito';
  cuenta_contable: string;
  conciliado: boolean;
  categoria?: string;
}

// Color Palette Constants matching the original visual identity
const PALETTE = {
  verde: '#1D9E75',
  rojo: '#D85A30',
  morado: '#534AB7',
  azul: '#378ADD',
  ambar: '#BA7517',
  gris: '#888780',
  verdeClaro: 'rgba(29, 158, 117, 0.85)',
  rojoClaro: 'rgba(216, 90, 48, 0.85)',
};

const EXPENSE_CATEGORIES: string[] = [];
const INCOME_CATEGORIES: string[] = [];

const MONTHS_SPANISH = [
  { key: '01', name: 'Ene' },
  { key: '02', name: 'Feb' },
  { key: '03', name: 'Mar' },
  { key: '04', name: 'Abr' },
  { key: '05', name: 'May' },
  { key: '06', name: 'Jun' },
  { key: '07', name: 'Jul' },
  { key: '08', name: 'Ago' },
  { key: '09', name: 'Sep' },
  { key: '10', name: 'Oct' },
  { key: '11', name: 'Nov' },
  { key: '12', name: 'Dic' }
];

export function FinancialDashboardPage() {
  const t = useLanguageStore((s) => s.t);
  const activeCompany = useAuthStore((s) => s.activeCompany);

  // States
  const [loading, setLoading] = useState(true);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [dbTransactions, setDbTransactions] = useState<Transaction[]>([]);
  const [initialBalanceInput, setInitialBalanceInput] = useState<number>(32616);
  const [filtersOpen, setFiltersOpen] = useState(true);

  // Filter conditions
  const [filterReconciliation, setFilterReconciliation] = useState<'all' | 'reconciled' | 'unreconciled'>('all');
  const [filterStartDate, setFilterStartDate] = useState<string>('');
  const [filterEndDate, setFilterEndDate] = useState<string>('');
  const [filterYear, setFilterYear] = useState<string>('all');
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(new Set(MONTHS_SPANISH.map(m => m.key)));
  const [selectedIncomeCategories, setSelectedIncomeCategories] = useState<Set<string>>(new Set());
  const [selectedExpenseCategories, setSelectedExpenseCategories] = useState<Set<string>>(new Set());

  // Modal State
  const [helpOpen, setHelpOpen] = useState(false);

  // --- CLASSIFICATION ENGINE ---
  const classifyTransaction = useCallback((tx: Omit<Transaction, 'categoria'>): string => {
    const cta = (tx.cuenta_contable || '').trim();
    if (!cta) {
      return tx.tipo === 'credito' ? 'Otros ingresos' : 'Otros egresos';
    }
    // Clean account code or prefix (e.g., "6010 - Rent Expense" -> "Rent Expense")
    const cleaned = cta.replace(/^\d+[\s\-\:]+/, '').trim();
    return cleaned || (tx.tipo === 'credito' ? 'Otros ingresos' : 'Otros egresos');
  }, []);

  // --- DATA LOADING HUB ---
  const loadData = useCallback(async () => {
    if (!activeCompany?.id) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/dashboard/financial?companyId=${activeCompany.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.transactions && data.transactions.length > 0) {
          const parsed = data.transactions.map((tx: any) => ({
            ...tx,
            categoria: classifyTransaction(tx),
          }));
          setDbTransactions(parsed);
          setIsDemoMode(false);

          // Dynamically compute unique categories
          const uniqueIncome = new Set<string>();
          const uniqueExpense = new Set<string>();
          parsed.forEach((tx: any) => {
            if (tx.tipo === 'credito') {
              uniqueIncome.add(tx.categoria || 'Otros ingresos');
            } else {
              uniqueExpense.add(tx.categoria || 'Otros egresos');
            }
          });
          setSelectedIncomeCategories(uniqueIncome);
          setSelectedExpenseCategories(uniqueExpense);

          const dates = parsed.map((tx: any) => tx.fecha).sort();
          setFilterStartDate(dates[0]);
          setFilterEndDate(dates[dates.length - 1]);
        } else {
          setDbTransactions([]);
          setIsDemoMode(false);
        }
      }
    } catch (err) {
      console.error('Failed to load dashboard bank transactions:', err);
    } finally {
      setLoading(false);
    }
  }, [activeCompany?.id, classifyTransaction]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Unique categories derived dynamically
  const allIncomeCategories = useMemo(() => {
    const cats = new Set<string>();
    dbTransactions.forEach(tx => {
      if (tx.tipo === 'credito') cats.add(tx.categoria || 'Otros ingresos');
    });
    return Array.from(cats).sort();
  }, [dbTransactions]);

  const allExpenseCategories = useMemo(() => {
    const cats = new Set<string>();
    dbTransactions.forEach(tx => {
      if (tx.tipo === 'debito') cats.add(tx.categoria || 'Otros egresos');
    });
    return Array.from(cats).sort();
  }, [dbTransactions]);

  // Year Selection Options
  const yearOptions = useMemo(() => {
    const years = new Set(dbTransactions.map(tx => tx.fecha.substring(0, 4)));
    return Array.from(years).sort();
  }, [dbTransactions]);

  // --- MAIN CRITICAL FILTERING ENGINE ---
  const filteredTransactions = useMemo(() => {
    return dbTransactions.filter(t => {
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
    selectedExpenseCategories
  ]);

  // --- MONTHLY DATA AGGREGATION & SALDOS ---
  const monthlyAggregatedData = useMemo(() => {
    const map = new Map<string, { monthKey: string; ingresos: number; gastos: number; txs: Transaction[] }>();

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
    filteredTransactions.forEach(t => {
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

    const finalMonths = sortedYm.map(ym => {
      const b = map.get(ym)!;
      const net = b.ingresos - b.gastos;

      // Track daily averages
      const [year, month] = ym.split('-').map(Number);
      const daysInMonth = new Date(year, month, 0).getDate();
      const dailyBalances: number[] = [];
      let runningBal = currentBal;

      for (let d = 1; d <= daysInMonth; d++) {
        const dayStr = `${ym}-${String(d).padStart(2, '0')}`;
        const dayTxs = b.txs.filter(t => t.fecha === dayStr);
        dayTxs.forEach(t => {
          if (t.tipo === 'credito') runningBal += t.monto;
          else runningBal -= t.monto;
        });
        dailyBalances.push(runningBal);
      }

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
        txs: b.txs
      };
    });

    return finalMonths;
  }, [filteredTransactions, initialBalanceInput]);

  // --- STATS & KPI CALCULATIONS ---
  const stats = useMemo(() => {
    let revenue = 0;
    let expenses = 0;
    let commissions = 0;

    filteredTransactions.forEach(t => {
      if (t.tipo === 'credito') {
        revenue += t.monto;
      } else {
        expenses += t.monto;
        if (t.categoria === 'Comisión Bancaria') {
          commissions += t.monto;
        }
      }
    });

    const netFlow = revenue - expenses;
    const finalBalance = monthlyAggregatedData.length > 0
      ? monthlyAggregatedData[monthlyAggregatedData.length - 1].cierre
      : initialBalanceInput;

    return {
      revenue,
      expenses,
      netFlow,
      commissions,
      finalBalance
    };
  }, [filteredTransactions, monthlyAggregatedData, initialBalanceInput]);

  // --- CATEGORY CHART PREPARATION ---
  const expensesByCategoryData = useMemo(() => {
    const counts: Record<string, number> = {};
    allExpenseCategories.forEach(c => { counts[c] = 0; });

    filteredTransactions.forEach(t => {
      if (t.tipo === 'debito') {
        const cat = t.categoria || 'Otros egresos';
        counts[cat] = (counts[cat] || 0) + t.monto;
      }
    });

    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    return allExpenseCategories.map((cat, idx) => {
      const value = counts[cat] || 0;
      const percentage = total > 0 ? (value / total) * 100 : 0;
      return {
        name: cat,
        value,
        percentage,
        color: Object.values(PALETTE)[idx % Object.values(PALETTE).length]
      };
    });
  }, [filteredTransactions, allExpenseCategories]);

  const incomeByCategoryData = useMemo(() => {
    const counts: Record<string, number> = {};
    allIncomeCategories.forEach(c => { counts[c] = 0; });

    filteredTransactions.forEach(t => {
      if (t.tipo === 'credito') {
        const cat = t.categoria || 'Otros ingresos';
        counts[cat] = (counts[cat] || 0) + t.monto;
      }
    });

    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    return allIncomeCategories.map((cat, idx) => {
      const value = counts[cat] || 0;
      const percentage = total > 0 ? (value / total) * 100 : 0;
      return {
        name: cat,
        value,
        percentage,
        color: Object.values(PALETTE)[(idx + 3) % Object.values(PALETTE).length]
      };
    });
  }, [filteredTransactions, allIncomeCategories]);

  // Top 3 Income Categories dynamically computed
  const top3IncomeCategories = useMemo(() => {
    const valid = incomeByCategoryData.filter(d => d.name !== 'Otros créditos' && d.value > 0);
    const sorted = [...valid].sort((a, b) => b.value - a.value);
    return sorted.slice(0, 3).map(c => c.name);
  }, [incomeByCategoryData]);

  const top3IncomePlatformData = useMemo(() => {
    return monthlyAggregatedData.map(m => {
      const row: any = { month: m.monthLabel };
      top3IncomeCategories.forEach(cat => {
        row[cat] = m.txs.filter(t => t.categoria === cat).reduce((s, t) => s + t.monto, 0);
      });
      return row;
    });
  }, [monthlyAggregatedData, top3IncomeCategories]);

  // Top 3 Expense Categories dynamically computed
  const top3ExpenseCategories = useMemo(() => {
    const valid = expensesByCategoryData.filter(d => d.name !== 'Otros egresos' && d.value > 0);
    const sorted = [...valid].sort((a, b) => b.value - a.value);
    return sorted.slice(0, 3).map(c => c.name);
  }, [expensesByCategoryData]);

  const top3ExpenseCostsData = useMemo(() => {
    return monthlyAggregatedData.map(m => {
      const row: any = { month: m.monthLabel };
      top3ExpenseCategories.forEach(cat => {
        row[cat] = m.txs.filter(t => t.categoria === cat).reduce((s, t) => s + t.monto, 0);
      });
      return row;
    });
  }, [monthlyAggregatedData, top3ExpenseCategories]);

  // Top single expense category trend dynamically computed
  const topExpenseCategory = useMemo(() => {
    if (expensesByCategoryData.length === 0) return null;
    const sorted = [...expensesByCategoryData].sort((a, b) => b.value - a.value);
    return sorted[0]?.value > 0 ? sorted[0].name : null;
  }, [expensesByCategoryData]);

  const topExpenseCategoryData = useMemo(() => {
    return monthlyAggregatedData.map(m => {
      const val = topExpenseCategory
        ? m.txs.filter(t => t.categoria === topExpenseCategory).reduce((s, t) => s + t.monto, 0)
        : 0;
      return {
        month: m.monthLabel,
        Monto: val
      };
    });
  }, [monthlyAggregatedData, topExpenseCategory]);

  // Composition of Revenue (Top income category vs all others)
  const topIncomeCategory = useMemo(() => {
    if (incomeByCategoryData.length === 0) return null;
    const sorted = [...incomeByCategoryData].sort((a, b) => b.value - a.value);
    return sorted[0]?.value > 0 ? sorted[0].name : null;
  }, [incomeByCategoryData]);

  const topIncomeCompositionData = useMemo(() => {
    return monthlyAggregatedData.map(m => {
      const topVal = topIncomeCategory
        ? m.txs.filter(t => t.categoria === topIncomeCategory).reduce((s, t) => s + t.monto, 0)
        : 0;
      const otherVal = m.txs.filter(t => t.tipo === 'credito' && t.categoria !== topIncomeCategory).reduce((s, t) => s + t.monto, 0);
      return {
        month: m.monthLabel,
        Principal: topVal,
        Otros: otherVal
      };
    });
  }, [monthlyAggregatedData, topIncomeCategory]);

  // --- AUTOMATED CONCLUSIONS & ALERTS GENERATOR ---
  const automatedConclusions = useMemo(() => {
    const list: { icon: string; text: React.ReactNode; type: 'success' | 'warning' | 'alert' | 'info' }[] = [];
    if (monthlyAggregatedData.length === 0) return [];

    const finalBal = stats.finalBalance;
    const diffBal = finalBal - initialBalanceInput;
    const changePct = initialBalanceInput > 0 ? (diffBal / initialBalanceInput) * 100 : 100;

    // 1. Tendencia del saldo
    if (finalBal < initialBalanceInput) {
      list.push({
        icon: '⚠️',
        type: 'warning',
        text: (
          <span>
            El saldo cayó de <strong>{formatCurrency(initialBalanceInput)}</strong> a <strong>{formatCurrency(finalBal)}</strong> en el período, una reducción del <strong>{Math.abs(changePct).toFixed(1)}%</strong>.
          </span>
        )
      });
    } else {
      list.push({
        icon: '✅',
        type: 'success',
        text: (
          <span>
            El saldo creció de <strong>{formatCurrency(initialBalanceInput)}</strong> a <strong>{formatCurrency(finalBal)}</strong> en el período, un incremento del <strong>{changePct.toFixed(1)}%</strong>.
          </span>
        )
      });
    }

    // 2. Meses con flujo positivo vs negativo
    let posCount = 0;
    const negMonths: string[] = [];
    monthlyAggregatedData.forEach(m => {
      if (m.netFlow >= 0) posCount++;
      else negMonths.push(m.monthLabel);
    });

    list.push({
      icon: '📊',
      type: 'info',
      text: (
        <span>
          Flujo neto: <strong>{posCount} meses positivos</strong> vs <strong>{negMonths.length} meses con saldo deficitario</strong>. Meses negativos: <strong>{negMonths.join(', ') || 'Ninguno'}</strong>.
        </span>
      )
    });

    // 3. Mes más crítico
    let maxNegFlow = 0;
    let criticalMonthLabel = '';
    let critExpenses = 0, critRev = 0;

    monthlyAggregatedData.forEach(m => {
      if (m.netFlow < maxNegFlow) {
        maxNegFlow = m.netFlow;
        criticalMonthLabel = m.monthLabel;
        critExpenses = m.gastos;
        critRev = m.ingresos;
      }
    });

    if (criticalMonthLabel) {
      list.push({
        icon: '🚨',
        type: 'alert',
        text: (
          <span>
            <strong>{criticalMonthLabel}</strong> fue el mes más crítico: <strong>{formatCurrency(critExpenses)}</strong> en egresos contra <strong>{formatCurrency(critRev)}</strong> en ingresos.
          </span>
        )
      });
    }

    // 4. Mayor Categoría de egreso
    const validExpCats = expensesByCategoryData.filter(d => d.name !== 'Otros egresos');
    if (validExpCats.length > 0) {
      const topExp = [...validExpCats].sort((a, b) => b.value - a.value)[0];
      if (topExp && topExp.value > 0) {
        list.push({
          icon: '💰',
          type: 'warning',
          text: (
            <span>
              Las salidas hacia <strong>{topExp.name}</strong> representan el mayor egreso con <strong>{formatCurrency(topExp.value)}</strong> (<strong>{topExp.percentage.toFixed(1)}%</strong> del total). Es clave documentar estos movimientos.
            </span>
          )
        });

        // 5. Alerta de concentración de egresos
        if (topExp.percentage > 15) {
          list.push({
            icon: '💳',
            type: 'alert',
            text: (
              <span>
                La cuenta <strong>{topExp.name}</strong> consume <strong>{formatCurrency(topExp.value)}</strong> (<strong>{topExp.percentage.toFixed(1)}%</strong> de egresos) — se recomienda auditar conceptos recurrentes de esta categoría.
              </span>
            )
          });
        }
      }
    }

    // 6. Principales fuentes de ingresos
    const validIncomeCats = incomeByCategoryData.filter(d => d.name !== 'Otros créditos' && d.value > 0);
    if (validIncomeCats.length > 0) {
      const sortedIncomes = [...validIncomeCats].sort((a, b) => b.value - a.value);
      const mainIncome = sortedIncomes[0];
      if (mainIncome) {
        list.push({
          icon: '📈',
          type: 'success',
          text: (
            <span>
              La mayor fuente de ingresos es <strong>{mainIncome.name}</strong>, aportando un acumulado de <strong>{formatCurrency(mainIncome.value)}</strong> (<strong>{mainIncome.percentage.toFixed(1)}%</strong> del total).
            </span>
          )
        });
      }
    }

    // 7. Saldo Mínimo vs Umbral Prudencial
    let minBal = Infinity;
    let minBalMonth = '';
    monthlyAggregatedData.forEach(m => {
      if (m.cierre < minBal) {
        minBal = m.cierre;
        minBalMonth = m.monthLabel;
      }
    });

    if (minBalMonth && minBal !== Infinity) {
      const threshold = 15000;
      const below = minBal < threshold;
      list.push({
        icon: '📉',
        type: below ? 'alert' : 'success',
        text: (
          <span>
            Saldo mínimo registrado: <strong>{formatCurrency(minBal)}</strong> en <strong>{minBalMonth}</strong>, ubicándose <strong>{below ? 'POR DEBAJO' : 'por encima'}</strong> del umbral mínimo de seguridad de $15,000.
          </span>
        )
      });
    }

    return list;
  }, [monthlyAggregatedData, stats.finalBalance, initialBalanceInput, expensesByCategoryData, incomeByCategoryData]);

  // --- FILTERS TOGGLE HANDLERS ---
  const toggleAllMonths = (checked: boolean) => {
    if (checked) {
      setSelectedMonths(new Set(MONTHS_SPANISH.map(m => m.key)));
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
      const dates = dbTransactions.map(t => t.fecha).sort();
      setFilterStartDate(dates[0]);
      setFilterEndDate(dates[dates.length - 1]);
    }
    setFilterYear('all');
    setInitialBalanceInput(isDemoMode ? 32616 : 0);
    setSelectedMonths(new Set(MONTHS_SPANISH.map(m => m.key)));
    setSelectedIncomeCategories(new Set(allIncomeCategories));
    setSelectedExpenseCategories(new Set(allExpenseCategories));
  };

  // --- EXPORT TRIGGERS ---
  const handleExportClassified = () => {
    if (filteredTransactions.length === 0) return;
    let csv = '\uFEFFfecha,descripcion,monto,tipo,cuenta_contable,conciliado,categoria,mes\n';
    filteredTransactions.forEach(t => {
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
    monthlyAggregatedData.forEach(m => {
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

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[450px]">
        <RefreshCw className="w-10 h-10 animate-spin text-teal-600 dark:text-teal-400 mb-4" />
        <span className="text-sm font-bold text-slate-500 uppercase tracking-widest animate-pulse">
          Cargando métricas y conciliaciones...
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-16">
      {/* HEADER SECTION */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="bg-teal-500/10 text-teal-600 dark:text-teal-400 text-xs px-2.5 py-1 rounded-full font-bold uppercase tracking-wider">
              {isDemoMode ? 'Modo Demostración Activo' : 'Datos del Sistema'}
            </span>
            {isDemoMode && (
              <span className="bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs px-2.5 py-1 rounded-full font-bold uppercase tracking-wider flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> Ideal para Pruebas
              </span>
            )}
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white mt-2 tracking-tight">
            Dashboard financiero — {activeCompany?.legalName || 'LQ&OM LLC'}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-medium flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-teal-500" />
            Cuenta corriente BofA #3224 · período activo del reporte
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
            Formato Soportado
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setFiltersOpen(!filtersOpen)}
            className={`rounded-xl border-slate-200 dark:border-slate-800 gap-1.5 ${filtersOpen ? 'bg-teal-50 dark:bg-teal-950/20 text-teal-600 dark:text-teal-400' : 'text-slate-700 dark:text-slate-300'}`}
          >
            <Filter className="w-4 h-4" />
            {filtersOpen ? 'Ocultar Filtros' : 'Mostrar Filtros'}
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
                <h3 className="font-bold text-slate-950 dark:text-slate-50 text-sm uppercase tracking-wider">Filtros Dinámicos de Consulta</h3>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white flex items-center gap-1 rounded-xl"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Limpiar Filtros
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* Reconciliation Filter */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Estado Conciliación</label>
                <select
                  value={filterReconciliation}
                  onChange={(e: any) => setFilterReconciliation(e.target.value)}
                  className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:border-teal-500 font-medium"
                >
                  <option value="all">Todas las transacciones</option>
                  <option value="reconciled">Solo conciliadas</option>
                  <option value="unreconciled">Solo no conciliadas</option>
                </select>
              </div>

              {/* Start Date */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Fecha Inicio</label>
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
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Fecha Fin</label>
                <input
                  type="date"
                  value={filterEndDate}
                  onChange={(e) => setFilterEndDate(e.target.value)}
                  className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:border-teal-500 font-medium"
                />
              </div>

              {/* Initial Balance */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Saldo Inicial ($)</label>
                <input
                  type="number"
                  value={initialBalanceInput}
                  onChange={(e) => setInitialBalanceInput(Number(e.target.value) || 0)}
                  className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-mono font-bold text-slate-800 dark:text-slate-200 focus:outline-none focus:border-teal-500"
                />
              </div>
            </div>

            {/* Sub-Filters Checkboxes */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6 pt-6 border-t border-slate-200 dark:border-slate-800">
              {/* Months filter */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Meses Seleccionados</span>
                  <label className="flex items-center gap-1 text-[10px] font-bold text-teal-600 dark:text-teal-400 uppercase cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={selectedMonths.size === MONTHS_SPANISH.length}
                      onChange={(e) => toggleAllMonths(e.target.checked)}
                      className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 w-3 h-3"
                    />
                    Todos
                  </label>
                </div>
                <div className="grid grid-cols-4 gap-2 bg-white dark:bg-slate-950/60 p-3 rounded-2xl border border-slate-200 dark:border-slate-800/80">
                  {MONTHS_SPANISH.map(m => {
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
                        {m.name}
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Income Categories */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Categorías de Ingresos</span>
                  <label className="flex items-center gap-1 text-[10px] font-bold text-teal-600 dark:text-teal-400 uppercase cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={selectedIncomeCategories.size === allIncomeCategories.length}
                      onChange={(e) => toggleAllIncome(e.target.checked)}
                      className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 w-3 h-3"
                    />
                    Todas
                  </label>
                </div>
                <div className="max-h-[120px] overflow-y-auto space-y-1 bg-white dark:bg-slate-950/60 p-3 rounded-2xl border border-slate-200 dark:border-slate-800/80">
                  {allIncomeCategories.map(cat => (
                    <label key={cat} className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedIncomeCategories.has(cat)}
                        onChange={() => toggleIncome(cat)}
                        className="rounded border-slate-300 dark:border-slate-700 text-teal-600 focus:ring-teal-500 w-3.5 h-3.5 bg-transparent"
                      />
                      {cat}
                    </label>
                  ))}
                </div>
              </div>

              {/* Expense Categories */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Categorías de Egresos</span>
                  <label className="flex items-center gap-1 text-[10px] font-bold text-teal-600 dark:text-teal-400 uppercase cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={selectedExpenseCategories.size === allExpenseCategories.length}
                      onChange={(e) => toggleAllExpenses(e.target.checked)}
                      className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 w-3 h-3"
                    />
                    Todas
                  </label>
                </div>
                <div className="max-h-[120px] overflow-y-auto space-y-1 bg-white dark:bg-slate-950/60 p-3 rounded-2xl border border-slate-200 dark:border-slate-800/80">
                  {allExpenseCategories.map(cat => (
                    <label key={cat} className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedExpenseCategories.has(cat)}
                        onChange={() => toggleExpense(cat)}
                        className="rounded border-slate-300 dark:border-slate-700 text-teal-600 focus:ring-teal-500 w-3.5 h-3.5 bg-transparent"
                      />
                      {cat}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Quick Metrics Info */}
            <div className="flex flex-wrap items-center gap-4 mt-6 pt-4 border-t border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500">
              <span className="bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full">{dbTransactions.length} transacciones en total</span>
              <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-3 py-1 rounded-full font-bold">
                {filteredTransactions.length} transacciones filtradas
              </span>
              <span className="bg-teal-500/10 text-teal-600 dark:text-teal-400 px-3 py-1 rounded-full font-bold">
                {dbTransactions.filter(t => t.conciliado).length} conciliadas en el sistema
              </span>
              <span className="bg-rose-500/10 text-rose-600 dark:text-rose-400 px-3 py-1 rounded-full font-bold">
                {dbTransactions.filter(t => !t.conciliado).length} pendientes
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* KPI METRIC CARDS GRID (6 Cards) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-5">
        <PremiumCard title="Ingresos Totales" value={formatCurrency(stats.revenue)} trend="+10.4%" isUp={true} color="teal" />
        <PremiumCard title="Egresos Totales" value={formatCurrency(stats.expenses)} trend="+8.2%" isUp={false} color="rose" />
        <PremiumCard title="Flujo Neto" value={formatCurrency(stats.netFlow)} trend="" isUp={stats.netFlow >= 0} color="emerald" isSpecialColor={true} />
        <PremiumCard title="Saldo Inicial" value={formatCurrency(initialBalanceInput)} trend="" isUp={true} color="blue" />
        <PremiumCard title="Saldo Final" value={formatCurrency(stats.finalBalance)} trend="" isUp={stats.finalBalance >= initialBalanceInput} color="teal" isSpecialBalance={true} isDrop={stats.finalBalance < initialBalanceInput} />
        <PremiumCard title="Comisión Bancaria" value={formatCurrency(stats.commissions)} trend="" isUp={false} color="gray" />
      </div>

      {/* --- GRAPHICS GRID (10 Charts) --- */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        
        {/* Chart 1: Ingresos vs Egresos por Mes */}
        <ChartBox title="Ingresos vs. egresos por mes" subtitle="Comparativo mensual de flujos monetarios">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthlyAggregatedData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(128,128,128,0.12)" />
              <XAxis dataKey="monthLabel" stroke="#888780" fontSize={10} axisLine={false} tickLine={false} />
              <YAxis stroke="#888780" fontSize={10} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v/1000}k`} />
              <Tooltip formatter={(value: any) => formatCurrency(value)} contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '1rem', color: '#fff' }} />
              <Legend verticalAlign="top" height={36} iconType="circle" />
              <Bar dataKey="ingresos" fill={PALETTE.verde} name="Ingresos" radius={[4, 4, 0, 0]} barSize={16} />
              <Bar dataKey="gastos" fill={PALETTE.rojo} name="Egresos" radius={[4, 4, 0, 0]} barSize={16} />
            </BarChart>
          </ResponsiveContainer>
        </ChartBox>

        {/* Chart 2: Evolución del saldo al cierre */}
        <ChartBox title="Evolución del saldo al cierre mensual" subtitle="Dinámica del balance de tesorería consolidado">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={monthlyAggregatedData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="areaBal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={PALETTE.azul} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={PALETTE.azul} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(128,128,128,0.12)" />
              <XAxis dataKey="monthLabel" stroke="#888780" fontSize={10} axisLine={false} tickLine={false} />
              <YAxis stroke="#888780" fontSize={10} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v/1000}k`} />
              <Tooltip formatter={(value: any) => formatCurrency(value)} contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '1rem', color: '#fff' }} />
              <Area type="monotone" dataKey="cierre" stroke={PALETTE.azul} strokeWidth={2.5} fill="url(#areaBal)" name="Saldo Cierre" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartBox>

        {/* Chart 3: Distribución de egresos */}
        <ChartBox title="Distribución de egresos por categoría" subtitle="Composición relativa del egreso acumulado">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <ResponsiveContainer width="100%" height={200} className="max-w-[200px]">
              <PieChart>
                <Pie
                  data={expensesByCategoryData.filter(d => d.value > 0)}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {expensesByCategoryData.filter(d => d.value > 0).map((entry, idx) => (
                    <Cell key={`cell-${idx}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: any) => formatCurrency(value)} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-2">
              {expensesByCategoryData.map(c => (
                <div key={c.name} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300 truncate max-w-[140px]">{c.name}</span>
                  <span className="text-[10px] font-bold text-slate-400 ml-auto">{c.percentage.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        </ChartBox>

        {/* Chart 4: Distribución de ingresos */}
        <ChartBox title="Distribución de ingresos por fuente" subtitle="Origen y dispersión de créditos en cuenta">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <ResponsiveContainer width="100%" height={200} className="max-w-[200px]">
              <PieChart>
                <Pie
                  data={incomeByCategoryData.filter(d => d.value > 0)}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {incomeByCategoryData.filter(d => d.value > 0).map((entry, idx) => (
                    <Cell key={`cell-${idx}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: any) => formatCurrency(value)} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-2">
              {incomeByCategoryData.map(c => (
                <div key={c.name} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300 truncate max-w-[140px]">{c.name}</span>
                  <span className="text-[10px] font-bold text-slate-400 ml-auto">{c.percentage.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        </ChartBox>

        {/* Chart 5: Flujo Neto Mensual */}
        <ChartBox title="Flujo neto mensual (ingresos − egresos)" subtitle="Capacidad de retención de efectivo mes a mes">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthlyAggregatedData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(128,128,128,0.12)" />
              <XAxis dataKey="monthLabel" stroke="#888780" fontSize={10} axisLine={false} tickLine={false} />
              <YAxis stroke="#888780" fontSize={10} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v/1000}k`} />
              <Tooltip formatter={(value: any) => formatCurrency(value)} contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '1rem', color: '#fff' }} />
              <Bar dataKey="netFlow" radius={[4, 4, 0, 0]} barSize={20}>
                {monthlyAggregatedData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.netFlow >= 0 ? PALETTE.verdeClaro : PALETTE.rojoClaro} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartBox>

        {/* Chart 6: Principal egreso */}
        <ChartBox
          title={`Principal categoría de egreso: ${topExpenseCategory || 'Sin transacciones'}`}
          subtitle={`Salidas mensuales hacia ${topExpenseCategory || 'la categoría mayoritaria'}`}
        >
          {topExpenseCategory ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={topExpenseCategoryData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(128,128,128,0.12)" />
                <XAxis dataKey="month" stroke="#888780" fontSize={10} axisLine={false} tickLine={false} />
                <YAxis stroke="#888780" fontSize={10} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v/1000}k`} />
                <Tooltip formatter={(value: any) => formatCurrency(value)} />
                <Bar dataKey="Monto" fill={PALETTE.morado} name={topExpenseCategory} radius={[4, 4, 0, 0]} barSize={18} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[240px] text-xs font-bold text-slate-400 bg-slate-50 dark:bg-slate-950/20 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
              Sin transacciones registradas para este período
            </div>
          )}
        </ChartBox>

        {/* Chart 7: Top 3 Egresos */}
        <ChartBox title="Top 3 categorías principales de egreso" subtitle="Evolución mensual de egresos mayoritarios acumulados">
          {top3ExpenseCategories.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={top3ExpenseCostsData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(128,128,128,0.12)" />
                <XAxis dataKey="month" stroke="#888780" fontSize={10} axisLine={false} tickLine={false} />
                <YAxis stroke="#888780" fontSize={10} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v/1000}k`} />
                <Tooltip formatter={(value: any) => formatCurrency(value)} />
                <Legend verticalAlign="top" height={36} iconType="circle" />
                {top3ExpenseCategories.map((cat, idx) => (
                  <Bar
                    key={cat}
                    dataKey={cat}
                    stackId="a"
                    fill={Object.values(PALETTE)[(idx + 1) % Object.values(PALETTE).length]}
                    name={cat}
                    radius={idx === top3ExpenseCategories.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[240px] text-xs font-bold text-slate-400 bg-slate-50 dark:bg-slate-950/20 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
              Sin egresos registrados en el período
            </div>
          )}
        </ChartBox>

        {/* Chart 8: Top 3 Ingresos */}
        <ChartBox title="Top 3 fuentes principales de ingresos" subtitle="Evolución mensual de las categorías con mayores depósitos">
          {top3IncomeCategories.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={top3IncomePlatformData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(128,128,128,0.12)" />
                <XAxis dataKey="month" stroke="#888780" fontSize={10} axisLine={false} tickLine={false} />
                <YAxis stroke="#888780" fontSize={10} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v/1000}k`} />
                <Tooltip formatter={(value: any) => formatCurrency(value)} />
                <Legend verticalAlign="top" height={36} iconType="circle" />
                {top3IncomeCategories.map((cat, idx) => (
                  <Line
                    key={cat}
                    type="monotone"
                    dataKey={cat}
                    stroke={Object.values(PALETTE)[(idx + 2) % Object.values(PALETTE).length]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                    name={cat}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[240px] text-xs font-bold text-slate-400 bg-slate-50 dark:bg-slate-950/20 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
              Sin ingresos registrados en el período
            </div>
          )}
        </ChartBox>

        {/* Chart 9: Saldo Promedio Mensual */}
        <ChartBox title="Saldo promedio mensual" subtitle="Promedio del saldo diario con umbral de seguridad">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthlyAggregatedData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(128,128,128,0.12)" />
              <XAxis dataKey="monthLabel" stroke="#888780" fontSize={10} axisLine={false} tickLine={false} />
              <YAxis stroke="#888780" fontSize={10} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v/1000}k`} />
              <Tooltip formatter={(value: any) => formatCurrency(value)} />
              <ReferenceLine y={15000} stroke={PALETTE.rojo} strokeWidth={1.5} strokeDasharray="6 4" label={{ value: 'Umbral Mínimo $15,000', position: 'top', fill: PALETTE.rojo, fontSize: 10, fontWeight: 'bold' }} />
              <Bar dataKey="promedio" radius={[4, 4, 0, 0]} barSize={20}>
                {monthlyAggregatedData.map((entry, index) => {
                  const val = entry.promedio;
                  let color = PALETTE.rojo;
                  if (val >= 20000) color = PALETTE.verde;
                  else if (val >= 14000) color = PALETTE.ambar;
                  return <Cell key={`cell-${index}`} fill={color} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartBox>

        {/* Chart 10: Principal Ingreso vs Resto */}
        <ChartBox
          title={`Ingresos: ${topIncomeCategory || 'Principal'} vs. resto de créditos`}
          subtitle="Comparativo mensual de diversificación de fuentes de ingresos"
        >
          {topIncomeCategory ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={topIncomeCompositionData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(128,128,128,0.12)" />
                <XAxis dataKey="month" stroke="#888780" fontSize={10} axisLine={false} tickLine={false} />
                <YAxis stroke="#888780" fontSize={10} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v/1000}k`} />
                <Tooltip formatter={(value: any) => formatCurrency(value)} />
                <Legend verticalAlign="top" height={36} iconType="circle" />
                <Bar dataKey="Principal" stackId="a" fill={PALETTE.verde} name={topIncomeCategory} />
                <Bar dataKey="Otros" stackId="a" fill={PALETTE.morado} name="Otros ingresos" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[240px] text-xs font-bold text-slate-400 bg-slate-50 dark:bg-slate-950/20 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
              Sin ingresos registrados en el período
            </div>
          )}
        </ChartBox>

      </div>

      {/* AUTOMATED CONCLUSIONS & ALERTS */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 lg:p-8 shadow-sm">
        <div className="flex items-center gap-2 mb-6">
          <Zap className="w-5 h-5 text-teal-500" />
          <h2 className="text-lg font-bold text-slate-900 dark:text-white uppercase tracking-tight">
            Conclusiones y alertas del período
          </h2>
        </div>

        <ul className="space-y-4">
          {automatedConclusions.map((conclusion, idx) => {
            const types: any = {
              success: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-800 dark:text-emerald-300',
              warning: 'bg-amber-500/10 border-amber-500/20 text-amber-800 dark:text-amber-300',
              alert: 'bg-rose-500/10 border-rose-500/20 text-rose-800 dark:text-rose-300',
              info: 'bg-slate-100 dark:bg-slate-800/80 border-transparent text-slate-800 dark:text-slate-300'
            };

            return (
              <motion.li
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                key={idx}
                className={`flex gap-3 items-start p-4 rounded-2xl border ${types[conclusion.type] || types.info}`}
              >
                <span className="text-xl leading-none">{conclusion.icon}</span>
                <div className="text-sm font-medium">{conclusion.text}</div>
              </motion.li>
            );
          })}
        </ul>
      </div>

      {/* EXPORT ACTION FOOTER BAR */}
      <footer className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-teal-600" />
          <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
            Módulo de Exportación Legal & Tributaria
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
            Exportar CSV de transacciones clasificadas
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleExportSummary}
            className="rounded-xl border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 gap-1.5"
            disabled={monthlyAggregatedData.length === 0}
          >
            <Download className="w-4 h-4" />
            Exportar resumen mensual CSV
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
              Estructura del archivo requerida
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
              El motor de conciliación y el dashboard financiero importan archivos de extractos bancarios en formatos <strong>CSV</strong>, <strong>OFX</strong> y <strong>QFX</strong>. Al importar un archivo CSV, asegúrate de mapear o estructurar las siguientes columnas básicas:
            </p>

            <div className="overflow-hidden border border-slate-200 dark:border-slate-800 rounded-2xl mb-6">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950 font-bold text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-3">Columna</th>
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3">Descripción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-150 dark:divide-slate-850 font-medium text-slate-700 dark:text-slate-300">
                  <tr>
                    <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">fecha</td>
                    <td className="px-4 py-3">Texto</td>
                    <td className="px-4 py-3">Fecha de la transacción (YYYY-MM-DD, MM/DD/YYYY o DD/MM/YYYY).</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">descripcion</td>
                    <td className="px-4 py-3">Texto</td>
                    <td className="px-4 py-3">Concepto, beneficiario o descripción detallada de la transacción.</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">monto</td>
                    <td className="px-4 py-3">Número</td>
                    <td className="px-4 py-3">Valor numérico de la transacción (debitos negativos, creditos positivos).</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">tipo</td>
                    <td className="px-4 py-3">Texto</td>
                    <td className="px-4 py-3">Dirección del flujo ("credito" o "debito"). Opcional si el monto tiene signo.</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">cuenta_contable</td>
                    <td className="px-4 py-3">Texto</td>
                    <td className="px-4 py-3">Código contable o cuenta del catálogo asociada (opcional).</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">conciliado</td>
                    <td className="px-4 py-3">Booleano</td>
                    <td className="px-4 py-3">"si"/"no", "true"/"false" o "1"/"0" (opcional, por defecto "no").</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="text-xs text-slate-400 font-medium flex items-start gap-1.5">
              <Info className="w-4 h-4 shrink-0 text-teal-500" />
              El sistema cuenta con un motor de tolerancia inteligente para inferir campos incompletos, corregir formatos de fechas y deducir la clasificación contable en base a reglas dinámicas.
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
  isDrop = false
}: PremiumCardProps) {
  const isPositive = isUp;

  const themes: any = {
    teal: 'bg-teal-500/10 border-teal-500/20 text-teal-600 dark:text-teal-400',
    rose: 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400',
    emerald: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400',
    blue: 'bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400',
    gray: 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-350',
  };

  const getDynamicColor = () => {
    if (isSpecialColor) {
      return isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
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
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block truncate max-w-[120px]">{title}</span>
          {trend && (
            <div className={`flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider ${isPositive ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'}`}>
              {isPositive ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
              {trend}
            </div>
          )}
        </div>

        <div>
          <div className={`text-lg font-bold tracking-tight font-mono tabular-nums leading-none truncate ${getDynamicColor()}`}>
            {value}
          </div>
          <div className="w-full h-1 bg-slate-100 dark:bg-slate-950 rounded-full overflow-hidden border border-slate-200 dark:border-slate-850 mt-3">
            <div className={`h-full rounded-full ${isPositive ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ width: '65%' }}></div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ChartBoxProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}

function ChartBox({ title, subtitle, children }: ChartBoxProps) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm flex flex-col justify-between">
      <header className="mb-4">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">{title}</h3>
        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">{subtitle}</p>
      </header>
      <div className="relative z-10 w-full mt-2">
        {children}
      </div>
    </div>
  );
}
