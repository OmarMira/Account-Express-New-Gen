'use client';

import { useState, useEffect, useCallback } from 'react';
import { useLanguageStore } from '@/store/language-store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Send, CheckCircle2, ArrowRight, AlertCircle } from 'lucide-react';
import { type EntityCandidate } from '@/lib/services/entity-detector';

interface RuleCondition {
  field: 'description' | 'amount';
  operator: 'contains' | 'starts_with' | 'ends_with' | 'equals' | 'amount_greater' | 'amount_less';
  value: string;
}

interface AISuggestion {
  role: string;
  account: { code: string; name: string };
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
        console.warn('[FAILED TO FETCH DIRECTION PROFILES]', err);
      }
    }
    fetchProfiles();
  }, []);

  const current = candidates[currentIndex];

  // Carga inicial de candidatos
  useEffect(() => {
    async function fetchCandidates() {
      try {
        setLoading(true);
        const res = await fetch(`/api/learning/pending-entities?companyId=${companyId}`);
        if (!res.ok) throw new Error(t('ruleBuilder.fetchError'));
        const data = await res.json();
        setCandidates(data.candidates || []);
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
          setSuggestion(resData.data);
        } else {
          throw new Error(t('ruleBuilder.interpretError'));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('ruleBuilder.unknownError'));
      } finally {
        setProcessingAnswer(false);
      }
    },
    [current, companyId, t],
  );

  // Paso 1: Interpretar respuesta libre con IA
  const handleInterpret = useCallback(async () => {
    await submitWithAnswer(answer);
  }, [answer, submitWithAnswer]);

  // Paso 2: Confirmar y generar regla
  const handleConfirm = useCallback(async () => {
    if (!suggestion || !current) return;
    setCreatingRule(true);
    try {
      const typeKey = suggestion.account.code.charAt(0);
      const profile = directionProfiles[typeKey];
      const threshold = profile?.deviationThreshold ?? 0.9;

      const res = await fetch('/api/learning/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          pattern: current.canonicalName,
          lockedDirection: current.directionProfile.creditPct >= threshold ? 'credit' : 'debit',
          glAccountCode: suggestion.account.code,
          role: suggestion.role,
          createSubAccount: suggestion.suggestSubAccount,
          subAccountName: suggestion.subAccountName,
          conditions: suggestion.conditions,
        }),
      });
      if (!res.ok) throw new Error(t('ruleBuilder.createError'));

      onComplete?.(await res.json());

      // Reset para siguiente entidad
      setAnswer('');
      setSuggestion(null);
      setCurrentIndex((prev) => prev + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ruleBuilder.unknownError'));
    } finally {
      setCreatingRule(false);
    }
  }, [suggestion, current, companyId, onComplete, t]);

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

  const suggestedAccountType = suggestion?.account.code.charAt(0) || '';
  const profile = directionProfiles[suggestedAccountType];
  const threshold = profile?.deviationThreshold ?? 0.9;

  const directionLabel =
    current.directionProfile.creditPct >= threshold
      ? t('ruleBuilder.directionCredit')
      : current.directionProfile.debitPct >= threshold
        ? t('ruleBuilder.directionDebit')
        : t('ruleBuilder.directionMixed');

  return (
    <div className="space-y-4 w-full max-w-2xl mx-auto">
      <Alert className="border-yellow-200/50 bg-yellow-500/5 dark:bg-yellow-500/10 dark:border-yellow-500/20 text-yellow-600 dark:text-yellow-400">
        <AlertDescription className="text-xs font-medium">
          {t('ruleBuilder.cpaDisclaimer') ||
            'Las sugerencias contables son borradores operacionales. La validación semántica final, ajustes de cierre y formularios fiscales son responsabilidad exclusiva de un CPA licenciado.'}
        </AlertDescription>
      </Alert>

      <Card className="w-full shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            {t('ruleBuilder.title')}
            <Badge variant="outline" className="font-normal">
              {currentIndex + 1} / {candidates.length}
            </Badge>
          </CardTitle>
          <CardDescription>{t('ruleBuilder.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Info de la Entidad */}
          <div className="rounded-lg bg-muted/50 p-4 space-y-3 border">
            <h3 className="font-semibold text-lg tracking-tight">{current.canonicalName}</h3>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">
                {current.occurrences} {t('ruleBuilder.occurrences')}
              </Badge>
              <Badge
                variant={
                  directionLabel === t('ruleBuilder.directionCredit')
                    ? 'default'
                    : directionLabel === t('ruleBuilder.directionDebit')
                      ? 'destructive'
                      : 'outline'
                }
              >
                {directionLabel}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground italic">
              "{current.sampleDescriptions[0]}"
            </p>
          </div>

          {/* Flujo Conversacional */}
          {!suggestion ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">
                  {t('ruleBuilder.question').replace('{entity}', current.canonicalName)}
                </label>

                {/* Smart Chips / Respuestas Rápidas */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {(directionLabel === t('ruleBuilder.directionCredit')
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
                        { label: '💼 Retiro de socio', value: 'Es un retiro de dinero del socio' },
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
                      className="text-xs h-7 px-2.5 rounded-full hover:bg-primary/10 hover:text-primary transition-all duration-200"
                    >
                      {chip.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <Input
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder={t('ruleBuilder.answerPlaceholder')}
                  onKeyDown={(e) => e.key === 'Enter' && !processingAnswer && handleInterpret()}
                  disabled={processingAnswer}
                  className="flex-1"
                />
                <Button
                  onClick={handleInterpret}
                  disabled={processingAnswer || !answer.trim()}
                  size="icon"
                >
                  {processingAnswer ? <Loader2 className="animate-spin" /> : <Send />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t('ruleBuilder.answerHint')}</p>
            </div>
          ) : (
            <div className="space-y-4 border-t pt-4 animate-in fade-in slide-in-from-bottom-2">
              <div className="flex items-start gap-2 text-green-600">
                <CheckCircle2 className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">{t('ruleBuilder.aiUnderstood')}</p>
                  <p className="text-sm text-muted-foreground">{suggestion.role}</p>
                </div>
              </div>

              <div className="rounded-md bg-primary/5 border border-primary/20 p-4">
                <p className="text-sm font-medium mb-1 text-foreground">
                  {t('ruleBuilder.suggestedAccount')}
                </p>
                <div className="flex items-center gap-2 text-xl font-bold text-primary">
                  {suggestion.account.code}{' '}
                  <span className="text-muted-foreground font-normal">—</span>{' '}
                  {suggestion.account.name}
                </div>
                {suggestion.suggestSubAccount && (
                  <p className="text-xs text-muted-foreground mt-2 border-t pt-2">
                    {t('ruleBuilder.subAccountHint').replace(
                      '{name}',
                      suggestion.subAccountName || current.canonicalName,
                    )}
                  </p>
                )}
                {suggestion.conditions && suggestion.conditions.length > 0 && (
                  <div className="text-xs text-muted-foreground mt-2 border-t pt-2 space-y-1">
                    <p className="font-semibold text-foreground">
                      {t('ruleBuilder.conditionsTitle') || 'Match Conditions (AND):'}
                    </p>
                    <ul className="list-disc pl-4 space-y-0.5">
                      {suggestion.conditions.map((cond, idx) => (
                        <li key={idx}>
                          <span className="capitalize">
                            {cond.field === 'description' ? 'description' : cond.field}
                          </span>{' '}
                          <span className="italic">{cond.operator.replace('_', ' ')}</span> "
                          {cond.value}"
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button
                  onDoubleClick={handleConfirm}
                  onClick={() => setClickCount((c) => c + 1)}
                  disabled={creatingRule}
                  className="flex-1 select-none transition-all duration-200"
                >
                  {creatingRule ? (
                    <Loader2 className="animate-spin mr-2" />
                  ) : (
                    <CheckCircle2 className="mr-2" />
                  )}
                  {clickCount === 1
                    ? t('ruleBuilder.doubleClickConfirm')
                    : t('ruleBuilder.confirmBtn')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setSuggestion(null)}
                  disabled={creatingRule}
                >
                  {t('ruleBuilder.editBtn')}
                </Button>
              </div>
            </div>
          )}

          {/* Navegación */}
          {currentIndex < candidates.length - 1 && (
            <div className="flex justify-end pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCurrentIndex((prev) => prev + 1)}
                disabled={processingAnswer || creatingRule}
              >
                {t('ruleBuilder.skipBtn')} <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
