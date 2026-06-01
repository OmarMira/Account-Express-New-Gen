'use client';

import { useState, useEffect, useCallback } from 'react';
import { useLanguageStore } from '@/store/language-store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Send, CheckCircle2, ArrowRight, AlertCircle } from 'lucide-react';
import { type EntityCandidate } from '@/lib/services/entity-detector';

interface AISuggestion {
  role: string;
  account: { code: string; name: string };
  suggestSubAccount: boolean;
  subAccountName?: string;
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

  // Paso 1: Interpretar respuesta libre con IA
  const handleInterpret = useCallback(async () => {
    if (!answer.trim() || !current) return;
    setProcessingAnswer(true);
    try {
      const res = await fetch('/api/learning/conversational-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          pattern: current.canonicalName,
          userInput: answer.trim(),
          userAnswer: answer.trim(),
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
  }, [answer, current, companyId, t]);

  // Paso 2: Confirmar y generar regla
  const handleConfirm = useCallback(async () => {
    if (!suggestion || !current) return;
    setCreatingRule(true);
    try {
      const res = await fetch('/api/learning/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          pattern: current.canonicalName,
          lockedDirection: current.directionProfile.creditPct >= 0.9 ? 'credit' : 'debit',
          glAccountCode: suggestion.account.code,
          role: suggestion.role,
          createSubAccount: suggestion.suggestSubAccount,
          subAccountName: suggestion.subAccountName,
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

  const directionLabel =
    current.directionProfile.creditPct >= 0.9
      ? t('ruleBuilder.directionCredit')
      : current.directionProfile.debitPct >= 0.9
        ? t('ruleBuilder.directionDebit')
        : t('ruleBuilder.directionMixed');

  return (
    <Card className="w-full max-w-2xl mx-auto shadow-sm">
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
          <p className="text-xs text-muted-foreground italic">"{current.sampleDescriptions[0]}"</p>
        </div>

        {/* Flujo Conversacional */}
        {!suggestion ? (
          <div className="space-y-3">
            <label className="text-sm font-medium leading-none">
              {t('ruleBuilder.question').replace('{entity}', current.canonicalName)}
            </label>
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
            </div>

            <div className="flex gap-2">
              <Button onClick={handleConfirm} disabled={creatingRule} className="flex-1">
                {creatingRule ? (
                  <Loader2 className="animate-spin mr-2" />
                ) : (
                  <CheckCircle2 className="mr-2" />
                )}
                {t('ruleBuilder.confirmBtn')}
              </Button>
              <Button variant="outline" onClick={() => setSuggestion(null)} disabled={creatingRule}>
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
  );
}
