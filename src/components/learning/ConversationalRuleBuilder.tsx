'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useLanguageStore } from '@/store/language-store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Loader2,
  Send,
  CheckCircle2,
  ArrowRight,
  AlertCircle,
  Plus,
  Trash2,
  Eye,
  ChevronRight,
} from 'lucide-react';
import { type EntityCandidate } from '@/lib/services/entity-detector';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import { AccountSelector, type GlAccountOption } from '@/components/spa/journal/AccountSelector';
import { logger } from '@/lib/logger';

function formatValidationError(errData: any, t: (key: string) => string): string {
  if (errData.details) {
    const fieldErrors = errData.details.fieldErrors || {};
    const fields = Object.keys(fieldErrors);
    if (fields.length > 0) {
      const msgs = fields.map((f) => `${f}: ${fieldErrors[f].join(', ')}`);
      return `Error de validación: ${msgs.join('; ')}`;
    }
  }
  // Traduce el error base si es el mensaje hardcodeado en inglés
  const msg = errData.error || '';
  if (msg === 'Validation failed') return 'Error de validación. Revisá los datos ingresados.';
  if (msg === 'pattern or conditions are required') return 'Se requiere un patrón o al menos una condición.';
  return msg || t('ruleBuilder.createError');
}

function getNextCode(baseCode: string, existingAccounts: GlAccountOption[]): string {
  const existing = new Set(existingAccounts.filter(Boolean).map((a) => a.code));
  let code = baseCode;
  for (let i = 0; i < 100; i++) {
    if (!existing.has(code)) return code;
    const num = parseInt(code, 10);
    if (isNaN(num)) break;
    code = String(num + 1);
  }
  return baseCode;
}

function accountTypeLabel(type?: string): string {
  const labels: Record<string, string> = {
    equity: 'Equity (Capital)',
    revenue: 'Revenue (Ingresos)',
    asset: 'Asset (Activo)',
    liability: 'Liability (Pasivo)',
    expense: 'Expense (Gasto)',
  };
  return type ? labels[type] || 'Expense (Gasto)' : 'Expense (Gasto)';
}

function getIndividualCode(parentCode: string, accounts: GlAccountOption[]): string {
  const num = parseInt(parentCode, 10);
  if (isNaN(num)) return parentCode;
  return getNextCode(String(num + 1), accounts);
}

function buildAccountChain(
  accounts: GlAccountOption[],
  code: string,
): { id: string; code: string; name: string }[] {
  const byCode = new Map(accounts.filter(Boolean).map((a) => [a.code, a]));
  const byId = new Map(accounts.filter(Boolean).map((a) => [a.id, a]));
  const chain: { id: string; code: string; name: string }[] = [];
  let current = byCode.get(code) ?? null;
  while (current) {
    chain.unshift({ id: current.id, code: current.code, name: current.name });
    if (!current.parentId) break;
    current = byId.get(current.parentId) ?? null;
  }
  return chain;
}

interface RuleCondition {
  field: 'description' | 'amount' | 'reference';
  operator:
    | 'contains'
    | 'starts_with'
    | 'ends_with'
    | 'equals'
    | 'greater_than'
    | 'less_than'
    | 'amount_greater'
    | 'amount_less';
  value: string;
}

interface AISuggestion {
  role: string;
  account: { code: string; name: string; accountType?: string; normalBalance?: string };
  suggestSubAccount: boolean;
  subAccountName?: string;
  conditions?: RuleCondition[];
}

interface ConversationalRuleBuilderProps {
  companyId: string;
  onComplete?: (ruleData: any) => void;
}

export function ConversationalRuleBuilder({
  companyId,
  onComplete,
}: ConversationalRuleBuilderProps) {
  const { t } = useLanguageStore();
  const [candidates, setCandidates] = useState<EntityCandidate[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Estados del flujo conversacional
  const [answer, setAnswer] = useState('');
  const [processingAnswer, setProcessingAnswer] = useState(false);
  const [suggestion, setSuggestion] = useState<AISuggestion | null>(null);
  const [creatingRule, setCreatingRule] = useState(false);
  const [clickCount, setClickCount] = useState(0);
  const creatingRuleRef = useRef(false);
  const suggestionCache = useRef<Record<string, AISuggestion>>({});

  // GL account creation/link modal (like bank import flow)
  const [glAccountModalOpen, setGlAccountModalOpen] = useState(false);
  const [glAccountMode, setGlAccountMode] = useState<'create' | 'link'>('create');
  const [glAccountCodeInput, setGlAccountCodeInput] = useState('');
  const [glAccountNameInput, setGlAccountNameInput] = useState('');
  const [glAccountId, setGlAccountId] = useState<string | null>(null);
  const [savingGlAccount, setSavingGlAccount] = useState(false);
  const [allGlAccounts, setAllGlAccounts] = useState<GlAccountOption[]>([]);

  // Live simulation & condition editor states
  const [editableConditions, setEditableConditions] = useState<RuleCondition[]>([]);
  const [localSuggestSubAccount, setLocalSuggestSubAccount] = useState(false);
  const [showConditions, setShowConditions] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationResult, setSimulationResult] = useState<{
    matchCount: number;
    samples: any[];
  } | null>(null);
  const [showSamplesModal, setShowSamplesModal] = useState(false);

  // Dynamic smart chips — top GL accounts used across rules for this company
  const [topAccounts, setTopAccounts] = useState<
    { code: string; name: string; accountType: string }[]
  >([]);

  // Sync suggestion conditions + sub-account flag when suggestion changes
  useEffect(() => {
    if (suggestion) {
      setEditableConditions(suggestion.conditions || []);
      setLocalSuggestSubAccount(suggestion.suggestSubAccount);
    } else {
      setEditableConditions([]);
      setLocalSuggestSubAccount(false);
    }
  }, [suggestion]);

  // Fetch top GL accounts for dynamic smart chips + all accounts for linking
  const fetchAccounts = useCallback(async () => {
    try {
      const [topRes, allRes] = await Promise.all([
        fetch(`/api/bank-rules/top-accounts?companyId=${companyId}`),
        fetch(`/api/accounts?companyId=${companyId}`),
      ]);
      if (topRes.ok) {
        const topData = await topRes.json();
        if (Array.isArray(topData.data)) {
          setTopAccounts(topData.data);
        }
      }
      if (allRes.ok) {
        const allData = await allRes.json();
        const accounts = (allData.accounts ?? allData.data ?? []).filter(Boolean);
        setAllGlAccounts(
          accounts.map((a: any) => ({
            id: a.id,
            code: a.code,
            name: a.name,
            accountType: a.accountType,
            normalBalance: a.normalBalance,
            parentId: a.parentId ?? null,
          })),
        );
      }
    } catch (err) {
      logger.warn('[FAILED TO FETCH ACCOUNTS]', { error: String(err) });
    }
  }, [companyId]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  // Debounced Simulation Effect
  useEffect(() => {
    if (editableConditions.length === 0) {
      setSimulationResult(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSimulating(true);
      try {
        const res = await fetch('/api/learning/rules/simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId,
          conditions: editableConditions.filter((c) => c.value.trim().length > 0),
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setSimulationResult({
              matchCount: data.matchCount,
              samples: data.samples,
            });
          }
        }
      } catch (err) {
        logger.error('[SIMULATION ERROR]', { error: String(err) });
      } finally {
        setIsSimulating(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [editableConditions, companyId]);

  useEffect(() => {
    if (clickCount > 0) {
      const timer = setTimeout(() => setClickCount(0), 1200);
      return () => clearTimeout(timer);
    }
  }, [clickCount]);

  // Perfiles de dirección cargados dinámicamente
  const [directionProfiles, setDirectionProfiles] = useState<
    Record<string, { normalBalance: 'credit' | 'debit'; deviationThreshold: number }>
  >({});

  useEffect(() => {
    async function fetchProfiles() {
      try {
        const res = await fetch('/api/config/direction-profiles');
        if (res.ok) {
          const resData = await res.json();
          if (resData.success && resData.data) {
            setDirectionProfiles(resData.data);
          }
        }
      } catch (err) {
        logger.warn('[FAILED TO FETCH DIRECTION PROFILES]', { error: String(err) });
      }
    }
    fetchProfiles();
  }, []);

  const current = candidates[currentIndex];

  // Carga inicial de candidatos desde scan (sin clustering)
  useEffect(() => {
    async function fetchCandidates() {
      try {
        setLoading(true);
        const res = await fetch(`/api/ai-rules/scan?companyId=${companyId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) throw new Error(t('ruleBuilder.fetchError'));
        const data = await res.json();
        const raw = data.patterns || [];
        // Map scan patterns to EntityCandidate format
        const mapped: EntityCandidate[] = raw.map((p: any) => ({
          id: p.id,
          canonicalName: p.description,
          occurrences: p.occurrences,
          directionProfile: {
            creditPct: p.direction === 'credit' ? 1 : 0,
            debitPct: p.direction === 'debit' ? 1 : 0,
          },
          sampleDescriptions: [p.rawDescription],
          hasContext: p.hasContext ?? false,
          contextRole: p.contextRole ?? undefined,
        }));
        setCandidates(mapped);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('ruleBuilder.unknownError'));
      } finally {
        setLoading(false);
      }
    }
    fetchCandidates();
  }, [companyId, t]);

  // Helper para procesar respuesta libre o Smart Chips
  const submitWithAnswer = useCallback(
    async (value: string) => {
      if (!value.trim() || !current) return;

      // Check session cache first
      const cacheKey = `${current.canonicalName}::${value.trim()}`;
      const cached = suggestionCache.current[cacheKey];
      if (cached) {
        setAnswer(value);
        setSuggestion(cached);
        return;
      }

      setAnswer(value);
      setProcessingAnswer(true);
      setError(null);
      try {
        const res = await fetch('/api/learning/conversational-parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId,
            pattern: current.canonicalName,
            userInput: value.trim(),
            userAnswer: value.trim(),
            directionProfile: current.directionProfile,
          }),
        });
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(errorData.error || t('ruleBuilder.interpretError'));
        }
        const resData = await res.json();
        if (resData.success && resData.data) {
          const sug = resData.data;
          setGlAccountMode('create');
          if (sug.suggestSubAccount) {
            // Preserve parent code — server will create sub-account under it
            setGlAccountCodeInput(sug.account.code);
          } else {
            // Standalone account: find next available code
            const nextCode = getNextCode(sug.account.code, allGlAccounts);
            sug.account.code = nextCode;
            setGlAccountCodeInput(nextCode);
          }
          setGlAccountNameInput(sug.account.name);
          setSuggestion(sug);
          // Cache suggestion per session for consistent re-edits
          suggestionCache.current[`${current.canonicalName}::${value.trim()}`] = sug;
        } else {
          throw new Error(t('ruleBuilder.interpretError'));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('ruleBuilder.unknownError'));
      } finally {
        setProcessingAnswer(false);
      }
    },
    [current, companyId, t, allGlAccounts],
  );

  // Paso 1: Interpretar respuesta libre con IA
  const handleInterpret = useCallback(async () => {
    await submitWithAnswer(answer);
  }, [answer, submitWithAnswer]);

  // Paso 2: Confirmar y generar regla
  const handleConfirm = useCallback(async () => {
    if (!suggestion || !current || creatingRuleRef.current) return;
    creatingRuleRef.current = true;
    setCreatingRule(true);
    try {
      const typeKey = suggestion.account.accountType;
      const profile = typeKey ? directionProfiles[typeKey] : undefined;
      const threshold = profile?.deviationThreshold ?? 0.9;
      const code = glAccountCodeInput || suggestion.account.code;
      const name = glAccountNameInput || suggestion.account.name;

        const res = await fetch('/api/learning/rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId,
            pattern: current.canonicalName,
            lockedDirection: current.directionProfile.creditPct >= threshold ? 'credit' : 'debit',
            glAccountCode: code,
            role: suggestion.role,
            createSubAccount: localSuggestSubAccount,
            subAccountName: suggestion.subAccountName || undefined,
            conditions: editableConditions.filter((c) => c.value.trim().length > 0),
          }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        if (errData.code === 'GL_ACCOUNT_NOT_FOUND') {
          setGlAccountCodeInput(code);
          setGlAccountNameInput(name);
          setGlAccountId(null);
          setGlAccountMode('create');
          setGlAccountModalOpen(true);
          creatingRuleRef.current = false;
          setCreatingRule(false);
          return;
        }
        throw new Error(formatValidationError(errData, t));
      }

      onComplete?.(await res.json());

      // Reset para siguiente entidad
      setAnswer('');
      setSuggestion(null);
      setEditableConditions([]);
      setSimulationResult(null);
      suggestionCache.current = {};
      setCurrentIndex((prev) => prev + 1);

      // Refresh accounts so next entity sees newly created sub-accounts or parent
      fetchAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ruleBuilder.unknownError'));
    } finally {
      setCreatingRule(false);
      creatingRuleRef.current = false;
    }
  }, [suggestion, current, companyId, onComplete, t, glAccountCodeInput, glAccountNameInput, editableConditions, fetchAccounts, localSuggestSubAccount]);

  const handleToggleGrouping = useCallback(
    (value: boolean) => {
      if (!suggestion) return;
      setLocalSuggestSubAccount(value);
      if (value) {
        // Agrupar: only restore parent code if the original AI suggestion intended a sub-account
        if (suggestion.suggestSubAccount) {
          setGlAccountCodeInput(suggestion.account.code);
          setGlAccountNameInput(suggestion.account.name);
        }
      } else {
        // Individual: compute standalone code starting after the parent
        const individualCode = getIndividualCode(suggestion.account.code, allGlAccounts);
        setGlAccountCodeInput(individualCode);
        setGlAccountNameInput(suggestion.subAccountName || suggestion.account.name);
      }
    },
    [suggestion, allGlAccounts],
  );

  const handleSkip = useCallback(() => {
    setAnswer('');
    setSuggestion(null);
    setEditableConditions([]);
    setSimulationResult(null);
    setCurrentIndex((prev) => prev + 1);
  }, []);

  const handleSaveGlAccount = useCallback(async () => {
    if (!suggestion || !current) return;
    setSavingGlAccount(true);
    try {
      let finalCode = glAccountCodeInput;
      let createdAccountType: string | undefined;
      if (glAccountMode === 'create') {
        createdAccountType = suggestion.account.accountType || 'equity';
        const res = await fetch('/api/accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId,
            code: glAccountCodeInput,
            name: glAccountNameInput,
            accountType: createdAccountType,
            normalBalance: suggestion.account.normalBalance || 'debit',
            isActive: true,
          }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(
            errData.error ||
              `No se pudo crear la cuenta ${glAccountCodeInput}. Creala manualmente e intentá de nuevo.`,
          );
        }
      } else {
        const selected = allGlAccounts.find((a) => a.id === glAccountId);
        if (!selected) throw new Error('Seleccioná una cuenta contable existente');
        finalCode = selected.code;
        createdAccountType = selected.accountType;
      }

      const typeKey = createdAccountType;
      const profile = typeKey ? directionProfiles[typeKey] : undefined;
      const th = profile?.deviationThreshold ?? 0.9;

      const retryRes = await fetch('/api/learning/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          pattern: current.canonicalName,
          lockedDirection: current.directionProfile.creditPct >= th ? 'credit' : 'debit',
          glAccountCode: finalCode,
          role: suggestion.role,
          createSubAccount: localSuggestSubAccount,
          subAccountName: suggestion.subAccountName || undefined,
          conditions: editableConditions.filter((c) => c.value.trim().length > 0),
        }),
      });
      if (!retryRes.ok) {
        const retryErrData = await retryRes.json().catch(() => ({}));
        throw new Error(formatValidationError(retryErrData, t));
      }

      setGlAccountModalOpen(false);
      onComplete?.(await retryRes.json());

      setAnswer('');
      setSuggestion(null);
      setEditableConditions([]);
      setSimulationResult(null);
      suggestionCache.current = {};
      setCurrentIndex((prev) => prev + 1);

      // Refresh accounts list so next entity sees newly created account
      if (glAccountMode === 'create') {
        fetchAccounts();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear la cuenta contable');
    } finally {
      setSavingGlAccount(false);
    }
  }, [
    suggestion,
    current,
    companyId,
    onComplete,
    t,
    glAccountCodeInput,
    glAccountNameInput,
    glAccountMode,
    glAccountId,
    allGlAccounts,
    editableConditions,
    fetchAccounts,
    localSuggestSubAccount,
  ]);

  // Renderizado de estados
  if (loading)
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="animate-spin mr-2" /> {t('ruleBuilder.loadingCandidates')}
      </div>
    );
  if (error)
    return (
      <div className="p-4 text-red-500 flex items-center gap-2 bg-red-500/10 rounded-md">
        <AlertCircle /> {error}
      </div>
    );
  if (candidates.length === 0)
    return (
      <div className="p-6 text-center text-muted-foreground">{t('ruleBuilder.noCandidates')}</div>
    );
  if (currentIndex >= candidates.length)
    return (
      <div className="p-6 text-center text-green-600 flex items-center justify-center gap-2">
        <CheckCircle2 /> {t('ruleBuilder.allProcessed')}
      </div>
    );

  const suggestedAccountType = suggestion?.account.accountType || '';
  const profile = suggestedAccountType ? directionProfiles[suggestedAccountType] : undefined;
  const threshold = profile?.deviationThreshold ?? 0.9;

  const directionLabel =
    current.directionProfile.creditPct >= threshold
      ? t('ruleBuilder.directionCredit')
      : current.directionProfile.debitPct >= threshold
        ? t('ruleBuilder.directionDebit')
        : t('ruleBuilder.directionMixed');

  return (
    <div className="space-y-1 w-full max-w-2xl mx-auto">
      <Alert className="border-yellow-200/50 bg-yellow-500/5 dark:bg-yellow-500/10 dark:border-yellow-500/20 text-yellow-600 dark:text-yellow-400 py-2">
        <AlertDescription className="text-[10px] font-medium leading-tight">
          {t('ruleBuilder.cpaDisclaimer') ||
            'Las sugerencias contables son borradores operacionales. La validación semántica final, ajustes de cierre y formularios fiscales son responsabilidad exclusiva de un CPA licenciado.'}
        </AlertDescription>
      </Alert>

      <Card className="w-full shadow-sm">
        <CardHeader className="py-2">
          <CardTitle className="flex items-center justify-between text-sm">
            {t('ruleBuilder.title')}
            <Badge variant="outline" className="font-normal text-[10px]">
              {currentIndex + 1} / {candidates.length}
            </Badge>
          </CardTitle>
          <CardDescription className="text-[11px]">{t('ruleBuilder.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {/* Info de la Entidad */}
          <div className="rounded-lg bg-muted/50 p-2 space-y-0.5 border">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm tracking-tight truncate">{current.canonicalName}</h3>
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5 shrink-0">
                {current.occurrences}x
              </Badge>
              <Badge
                variant={
                  directionLabel === t('ruleBuilder.directionCredit')
                    ? 'default'
                    : directionLabel === t('ruleBuilder.directionDebit')
                      ? 'destructive'
                      : 'outline'
                }
                className="text-[10px] h-4 px-1.5 shrink-0"
              >
                {directionLabel}
              </Badge>
            </div>
            <p className="text-[10px] text-muted-foreground italic truncate">
              "{current.sampleDescriptions[0]}"
            </p>
          </div>

          {/* Flujo Conversacional */}
          {!suggestion ? (
            <div className="space-y-1">
              <label className="text-xs font-medium leading-tight">
                {current.hasContext
                  ? t('ruleBuilder.questionContext')
                      .replace('{entity}', current.canonicalName)
                      .replace('{role}', current.contextRole || '')
                  : t('ruleBuilder.question').replace('{entity}', current.canonicalName)}
              </label>

              {/* Smart Chips / Respuestas Rápidas */}
              <div className="flex flex-wrap gap-1">
                  {(topAccounts.length > 0
                    ? topAccounts.map((account) => {
                        const emojiMap: Record<string, string> = {
                          EXPENSE: '💸',
                          REVENUE: '💰',
                          ASSET: '🏦',
                          LIABILITY: '🔗',
                          EQUITY: '💼',
                        };
                        const emoji = emojiMap[account.accountType] ?? '📊';
                        return {
                          label: `${emoji} ${account.name} (${account.code})`,
                          value: `Transaction for ${account.name} (${account.code})`,
                        };
                      })
                    : directionLabel === t('ruleBuilder.directionCredit')
                      ? [
                          {
                            label: '💰 Cobro a cliente',
                            value: 'Es un cobro a cliente por servicios',
                          },
                          {
                            label: '🏠 Renta / Alquiler',
                            value: 'Es el cobro de un alquiler / renta',
                          },
                          { label: '🤝 Aporte de socio', value: 'Aporte de capital de un socio' },
                          {
                            label: '🔄 Transf. Interna',
                            value: 'Es una transferencia de otra cuenta nuestra o afiliada',
                          },
                        ]
                      : [
                          { label: '🛒 Gasto general', value: 'Es un gasto general del negocio' },
                          {
                            label: '🚗 Préstamo de auto',
                            value: 'Es el pago del préstamo de un vehículo',
                          },
                          {
                            label: '💼 Retiro de socio',
                            value: 'Es un retiro de dinero del socio',
                          },
                          {
                            label: '🏢 Renta de oficina',
                            value: 'Es el pago del alquiler de oficina o local',
                          },
                          {
                            label: '💵 Sueldo',
                            value: 'Es el pago de sueldo de un empleado o nómina',
                          },
                          {
                            label: '💳 Tarjeta de crédito',
                            value: 'Es un pago o gasto de tarjeta de crédito',
                          },
                        ]
                  ).map((chip, idx) => (
                    <Button
                      key={idx}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => submitWithAnswer(chip.value)}
                      disabled={processingAnswer}
                      className="text-[10px] h-6 px-2 rounded-full hover:bg-primary/10 hover:text-primary transition-all duration-200"
                    >
                      {chip.label}
                    </Button>
                  ))}
                </div>

              <div className="flex gap-1">
                <Input
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder={t('ruleBuilder.answerPlaceholder')}
                  onKeyDown={(e) => e.key === 'Enter' && !processingAnswer && handleInterpret()}
                  disabled={processingAnswer}
                  className="flex-1 h-7 text-xs"
                />
                <Button
                  onClick={handleInterpret}
                  disabled={processingAnswer || !answer.trim()}
                  size="sm"
                  className="h-7 w-7 p-0"
                >
                  {processingAnswer ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-1 animate-in fade-in slide-in-from-bottom-2">
              <div className="flex items-start gap-1 text-green-600 text-xs">
                <CheckCircle2 className="mt-0.5 shrink-0 h-3 w-3" />
                <div>
                  <p className="font-medium text-xs">{t('ruleBuilder.aiUnderstood')}</p>
                  <p className="text-[11px] text-muted-foreground">{suggestion.role}</p>
                </div>
              </div>

              <div className="rounded-md bg-primary/5 border border-primary/20 p-2 space-y-1">
                <p className="text-xs font-medium text-foreground">
                  {t('ruleBuilder.suggestedAccount')}
                </p>

                {/* Ancestor chain tree view */}
                {(() => {
                  const currentCode = glAccountCodeInput || suggestion.account.code;
                  const chain = buildAccountChain(allGlAccounts, currentCode);
                  if (chain.length > 1 || localSuggestSubAccount) {
                    return (
                      <div className="flex items-center gap-1.5 text-xs flex-wrap bg-background/50 rounded px-3 py-2 border">
                        {chain.map((acc, i) => (
                          <span key={acc.id} className="flex items-center gap-1">
                            <span className="text-muted-foreground font-mono">{acc.code}</span>
                            <span className="text-foreground">{acc.name}</span>
                            {i < chain.length - 1 && (
                              <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                            )}
                          </span>
                        ))}
                        {localSuggestSubAccount && (
                          <>
                            <ChevronRight className="h-3 w-3 text-primary shrink-0" />
                            <span className="text-primary font-semibold">
                              🔽 {suggestion.subAccountName || current.canonicalName}
                              <span className="text-primary/70 font-mono ml-1">
                                ({chain.length > 0 ? `${chain[chain.length - 1].code}-01` : `${currentCode}-01`})
                              </span>
                            </span>
                          </>
                        )}
                      </div>
                    );
                  }
                  return (
                    <div className="text-xs font-mono text-primary bg-background/50 rounded px-3 py-2 border">
                      🔽 {glAccountNameInput || suggestion.account.name} ({currentCode})
                    </div>
                  );
                })()}

                {/* Agrupar / Individual toggle */}
                <div className="grid grid-cols-2 gap-1">
                  <div className="flex items-center gap-1 bg-slate-900/50 dark:bg-slate-900/80 p-0.5 rounded-lg border">
                    <button
                      type="button"
                      onClick={() => handleToggleGrouping(true)}
                      className={`flex-1 py-1 text-[10px] font-semibold rounded-md transition-all ${
                        localSuggestSubAccount
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Agrupar
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleGrouping(false)}
                      className={`flex-1 py-1 text-[10px] font-semibold rounded-md transition-all ${
                        !localSuggestSubAccount
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Individual
                    </button>
                  </div>
                  <div className="flex items-center gap-1 bg-slate-900/50 dark:bg-slate-900/80 p-0.5 rounded-lg border">
                    <button
                      type="button"
                      onClick={() => setGlAccountMode('create')}
                      className={`flex-1 py-1 text-[10px] font-semibold rounded-md transition-all ${
                        glAccountMode === 'create'
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Crear
                    </button>
                    <button
                      type="button"
                      onClick={() => setGlAccountMode('link')}
                      className={`flex-1 py-1 text-[10px] font-semibold rounded-md transition-all ${
                        glAccountMode === 'link'
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Vincular
                    </button>
                  </div>
                </div>

                {glAccountMode === 'create' ? (
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <label className="text-[10px] font-medium text-muted-foreground">Código</label>
                      <Input
                        value={glAccountCodeInput}
                        onChange={(e) => setGlAccountCodeInput(e.target.value)}
                        className="h-6 text-[11px] font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-muted-foreground">Nombre</label>
                      <Input
                        value={glAccountNameInput}
                        onChange={(e) => setGlAccountNameInput(e.target.value)}
                        className="h-6 text-[11px]"
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <AccountSelector
                      accounts={allGlAccounts.filter(
                        (a) => !suggestion.account.accountType || a.accountType === suggestion.account.accountType,
                      )}
                      value={glAccountId}
                      onChange={(id) => {
                        setGlAccountId(id);
                        const selected = allGlAccounts.find((a) => a.id === id);
                        if (selected) {
                          setGlAccountCodeInput(selected.code);
                          setGlAccountNameInput(selected.name);
                        }
                      }}
                      placeholder="Seleccioná una cuenta contable"
                    />
                  </div>
                )}

                {localSuggestSubAccount && (
                  <p className="text-[10px] text-muted-foreground leading-tight">
                    {t('ruleBuilder.subAccountHint').replace(
                      '{name}',
                      suggestion.subAccountName || current.canonicalName,
                    )}
                  </p>
                )}
                {/* Condition Editor — collapsible */}
                <div className="pt-1 border-t border-muted/30">
                  <button
                    type="button"
                    onClick={() => setShowConditions((v) => !v)}
                    className="flex items-center gap-1 w-full py-1"
                  >
                    <ChevronRight
                      className={`h-3 w-3 text-muted-foreground transition-transform ${showConditions ? 'rotate-90' : ''}`}
                    />
                    <span className="text-[10px] font-semibold text-foreground">
                      {t('ruleBuilder.conditionsTitle')}
                      {editableConditions.length > 0 && ` (${editableConditions.length})`}
                    </span>
                    {editableConditions.length > 0 && simulationResult && !isSimulating && (
                      <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-auto">
                        {simulationResult.matchCount === 1
                          ? t('ruleBuilder.matchesSingle')
                          : t('ruleBuilder.matchesPlural').replace(
                              '{count}',
                              String(simulationResult.matchCount),
                            )}
                      </Badge>
                    )}
                    {isSimulating && (
                      <div className="ml-auto flex items-center gap-1 text-[9px] text-muted-foreground">
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        <span>{t('ruleBuilder.evaluating')}</span>
                      </div>
                    )}
                  </button>

                  {showConditions && (
                    <div className="space-y-1 pt-1">
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditableConditions((prev) => [
                              ...prev,
                              { field: 'description', operator: 'contains', value: '' },
                            ]);
                          }}
                          className="h-5 px-1.5 text-[9px]"
                        >
                          <Plus className="h-2.5 w-2.5 mr-0.5" /> {t('ruleBuilder.addCondition')}
                        </Button>
                      </div>

                      {editableConditions.length === 0 ? (
                        <p className="text-[10px] italic text-muted-foreground text-center py-1">
                          {t('ruleBuilder.noConditions')}
                        </p>
                      ) : (
                        <div className="space-y-1">
                          {editableConditions.map((cond, idx) => (
                            <div key={idx} className="flex gap-1 items-center">
                              <select
                                value={cond.field}
                                onChange={(e) => {
                                  const newField = e.target.value as
                                    | 'description'
                                    | 'amount'
                                    | 'reference';
                                  setEditableConditions((prev) => {
                                    const copy = [...prev];
                                    copy[idx] = {
                                      ...copy[idx],
                                      field: newField,
                                      operator: newField === 'amount' ? 'greater_than' : 'contains',
                                    };
                                    return copy;
                                  });
                                }}
                                className="h-6 rounded-md border border-input bg-transparent px-1 text-[10px] shadow-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                              >
                                <option value="description">{t('ruleBuilder.fieldDescription')}</option>
                                <option value="amount">{t('ruleBuilder.fieldAmount')}</option>
                                <option value="reference">{t('ruleBuilder.fieldReference')}</option>
                              </select>

                              <select
                                value={cond.operator}
                                onChange={(e) => {
                                  const op = e.target.value as RuleCondition['operator'];
                                  setEditableConditions((prev) => {
                                    const copy = [...prev];
                                    copy[idx] = { ...copy[idx], operator: op };
                                    return copy;
                                  });
                                }}
                                className="h-6 rounded-md border border-input bg-transparent px-1 text-[10px] shadow-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                              >
                                {cond.field === 'amount' ? (
                                  <>
                                    <option value="equals">{t('ruleBuilder.opEquals')}</option>
                                    <option value="greater_than">{t('ruleBuilder.opGreaterThan')}</option>
                                    <option value="less_than">{t('ruleBuilder.opLessThan')}</option>
                                  </>
                                ) : (
                                  <>
                                    <option value="contains">{t('ruleBuilder.opContains')}</option>
                                    <option value="equals">{t('ruleBuilder.opEquals')}</option>
                                    <option value="starts_with">{t('ruleBuilder.opStartsWith')}</option>
                                    <option value="ends_with">{t('ruleBuilder.opEndsWith')}</option>
                                  </>
                                )}
                              </select>

                              <Input
                                value={cond.value}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setEditableConditions((prev) => {
                                    const copy = [...prev];
                                    copy[idx] = { ...copy[idx], value: val };
                                    return copy;
                                  });
                                }}
                                placeholder={t('ruleBuilder.valuePlaceholder')}
                                className="h-6 text-[10px] flex-1 min-w-[60px]"
                              />

                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  setEditableConditions((prev) => prev.filter((_, i) => i !== idx));
                                }}
                                className="h-6 w-6 text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Simulation badge inline (no modal preview inside collapsed section — it's already accessible via the badge in the header) */}
                      {editableConditions.length > 0 && simulationResult && (
                        <p className="text-[9px] text-muted-foreground text-center pt-0.5">
                          {simulationResult.matchCount === 1
                            ? '1 transacción coincide'
                            : `${simulationResult.matchCount} transacciones coinciden`}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-1">
                <Button
                  onDoubleClick={handleConfirm}
                  onClick={() => setClickCount((c) => c + 1)}
                  disabled={creatingRule}
                  className="flex-1 h-7 text-xs select-none transition-all duration-200"
                >
                  {creatingRule ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                  )}
                  {clickCount === 1
                    ? t('ruleBuilder.doubleClickConfirm')
                    : t('ruleBuilder.confirmBtn')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setSuggestion(null)}
                  disabled={creatingRule}
                  className="h-7 text-xs"
                >
                  {t('ruleBuilder.editBtn')}
                </Button>
              </div>
            </div>
          )}

          {/* Navegación */}
          {currentIndex < candidates.length - 1 && (
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSkip}
                disabled={processingAnswer || creatingRule}
                className="h-6 text-[10px]"
              >
                {t('ruleBuilder.skipBtn')} <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* GL Account creation/link modal */}
      <Dialog open={glAccountModalOpen} onOpenChange={setGlAccountModalOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Cuenta contable no encontrada</DialogTitle>
            <DialogDescription>
              La cuenta <code className="font-mono bg-muted px-1 rounded">{glAccountCodeInput}</code>{' '}
              no existe en esta compañía. Crealá o vinculá una existente.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Toggle Crear / Vincular */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Cuenta Contable (Plan de Cuentas)</label>
              <div className="grid grid-cols-2 gap-2 bg-slate-900/50 dark:bg-slate-900/80 p-1 rounded-lg border">
                <button
                  type="button"
                  onClick={() => setGlAccountMode('create')}
                  className={`py-1.5 text-xs font-semibold rounded-md transition-all ${
                    glAccountMode === 'create'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Crear Nueva (Automático)
                </button>
                <button
                  type="button"
                  onClick={() => setGlAccountMode('link')}
                  className={`py-1.5 text-xs font-semibold rounded-md transition-all ${
                    glAccountMode === 'link'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Vincular Existente
                </button>
              </div>
            </div>

            {glAccountMode === 'create' ? (
              <>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    Código <span className="text-red-500">*</span>
                  </label>
                  <Input
                    placeholder="3040"
                    value={glAccountCodeInput}
                    onChange={(e) => setGlAccountCodeInput(e.target.value)}
                    className="font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    Nombre <span className="text-red-500">*</span>
                  </label>
                  <Input
                    placeholder="Owner's Draw / Retiros de Socio"
                    value={glAccountNameInput}
                    onChange={(e) => setGlAccountNameInput(e.target.value)}
                  />
                </div>
                <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3 text-xs leading-relaxed text-blue-300 space-y-2">
                  <p className="font-semibold text-blue-400">✨ Autoconfiguración Contable:</p>
                  <p>Se creará la cuenta contable con tipo:</p>
                  <div className="mt-1 bg-slate-950/80 p-2.5 rounded border border-white/5 font-mono text-[11px] text-white space-y-1">
                    <div>
                      <span className="text-slate-400">Código GL:</span>{' '}
                      <span className="text-blue-400 font-bold">{glAccountCodeInput || '---'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Nombre GL:</span>{' '}
                      <span className="text-emerald-400 font-bold">
                        {glAccountNameInput || '---'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400">Tipo:</span>{' '}
                      <span className="text-amber-400 font-bold">
                        {accountTypeLabel(suggestion?.account.accountType)}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Cuenta existente <span className="text-red-500">*</span>
                </label>
                <AccountSelector
                  accounts={allGlAccounts.filter(
                    (a) => !suggestion?.account.accountType || a.accountType === suggestion.account.accountType,
                  )}
                  value={glAccountId}
                  onChange={setGlAccountId}
                  placeholder="Seleccioná una cuenta contable"
                />
                <p className="text-xs text-muted-foreground">
                  Solo se muestran cuentas del mismo tipo ({accountTypeLabel(suggestion?.account.accountType)}).
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setGlAccountModalOpen(false)}
              disabled={savingGlAccount}
            >
              Cancelar
            </Button>
            <Button onClick={handleSaveGlAccount} disabled={savingGlAccount}>
              {savingGlAccount && <Loader2 className="size-4 mr-1 animate-spin" />}
              Guardar y continuar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
