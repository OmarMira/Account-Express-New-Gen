'use client';

import { useState, useEffect } from 'react';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLanguageStore } from '@/store/language-store';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import entityRoles from '../../../rules/entity-roles.json';

interface EntityCandidate {
  id: string;
  canonicalName: string;
  occurrences: number;
  directionProfile: {
    creditPct: number;
    debitPct: number;
  };
  sampleDescriptions: string[];
}

interface EntityOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  companyId: string;
  onComplete?: () => void;
}

export function EntityOnboardingModal({
  isOpen,
  onClose,
  companyId,
  onComplete,
}: EntityOnboardingModalProps) {
  const t = useLanguageStore((s) => s.t);

  const [candidates, setCandidates] = useState<EntityCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [selections, setSelections] = useState<Record<string, { role: string; userInput: string }>>(
    {},
  );

  useEffect(() => {
    if (!companyId || !isOpen) return;

    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const candidatesRes = await fetch(`/api/learning/classify-entity?companyId=${companyId}`);

        if (candidatesRes.ok) {
          const data = await candidatesRes.json();
          setCandidates(data.data ?? []);
        } else {
          setError(t('learning.fetchError'));
        }
      } catch (err) {
        logger.error('Error loading entity onboarding data', { error: String(err) });
        setError(t('learning.loadError'));
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [companyId, isOpen, t]);

  function getDefaultRole(name: string): string {
    const lower = name.toLowerCase();
    if (lower.includes('inquilino') || lower.includes('rent') || lower.includes('alquiler'))
      return 'INQUILINO';
    if (lower.includes('proveedor') || lower.includes('supplier') || lower.includes('vendor'))
      return 'PROVEEDOR';
    if (lower.includes('socio') || lower.includes('partner') || lower.includes('member'))
      return 'SOCIO';
    if (lower.includes('cliente') || lower.includes('customer') || lower.includes('client'))
      return 'CLIENTE';
    if (lower.includes('empleado') || lower.includes('employee') || lower.includes('salary'))
      return 'EMPLEADO';
    if (selections[name]?.role) return selections[name].role;
    return '';
  }

  async function handleClassifyAll() {
    const entries = Object.entries(selections);
    if (entries.length === 0) return;

    setSaving(true);
    let count = 0;

    for (const [pattern, sel] of entries) {
      const finalRole = sel.role === 'OTRO' ? (sel.userInput || '').trim().toUpperCase() : sel.role;
      if (!finalRole) continue;
      try {
        const res = await fetch('/api/learning/classify-entity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId,
            pattern,
            userInput: sel.userInput || pattern,
            role: finalRole,
          }),
        });

        if (res.ok) {
          count++;
        }
      } catch (err) {
        logger.error('Error classifying entity', { pattern, error: String(err) });
      }
    }

    setSavedCount(count);
    toast.success(t('learning.classifiedCount').replace('{count}', String(count)));
    setSaving(false);

    if (onComplete) onComplete();
    onClose();
  }

  function updateSelection(name: string, field: 'role' | 'userInput', value: string | null) {
    setSelections((prev) => {
      const existing = prev[name];
      const base = existing || {
        role: getDefaultRole(name),
        userInput: '',
      };
      return {
        ...prev,
        [name]: {
          ...base,
          [field]: value,
        },
      };
    });
  }

  if (!isOpen) return null;

  const hasSelections = Object.keys(selections).length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t('learning.onboardingTitle')}
            {candidates.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {candidates.length}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>{t('learning.onboardingDesc')}</DialogDescription>
        </DialogHeader>

        {error && (
          <div className="flex items-center gap-2 p-3 text-sm bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 rounded-md">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : candidates.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
            <p>{t('learning.allClassified')}</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {candidates.map((candidate) => {
              const sel = selections[candidate.canonicalName];
              const role = sel?.role || getDefaultRole(candidate.canonicalName);
              const directionLabel =
                candidate.directionProfile.creditPct > 70
                  ? t('learning.directionCredit')
                  : candidate.directionProfile.debitPct > 70
                    ? t('learning.directionDebit')
                    : t('learning.directionMixed');

              return (
                <div key={candidate.id} className="border rounded-lg p-3 space-y-2 bg-card">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-sm truncate">
                      {candidate.canonicalName}
                      <span className="text-muted-foreground font-normal">
                        {' · '}
                        {t('learning.transactions').replace(
                          '{count}',
                          String(candidate.occurrences),
                        )}
                        {' · '}
                        {directionLabel}
                      </span>
                    </h4>
                  </div>

                  <div className="w-full">
                    <Select
                      value={role}
                      onValueChange={(v) => updateSelection(candidate.canonicalName, 'role', v)}
                      disabled={saving}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder={t('learning.rolePlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {entityRoles.map((r) => (
                          <SelectItem key={r} value={r}>
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {role === 'OTRO' && (
                      <Input
                        className="h-8 text-sm mt-1"
                        placeholder={t('learning.customRoleName')}
                        value={sel?.userInput || ''}
                        onChange={(e) =>
                          updateSelection(candidate.canonicalName, 'userInput', e.target.value)
                        }
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter className="gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {savedCount > 0 ? t('learning.close') : t('common.cancel')}
          </Button>
          {candidates.length > 0 && (
            <Button onClick={handleClassifyAll} disabled={saving || !hasSelections}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('learning.saving')}
                </>
              ) : (
                t('learning.classifyCount').replace(
                  '{count}',
                  String(Object.keys(selections).length),
                )
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
