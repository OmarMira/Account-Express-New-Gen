'use client';

import { useState } from 'react';
import { Zap, Search, CheckCircle2, Loader2, Brain, ArrowRight, Eye, X, Save } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguageStore } from '@/store/language-store';
import { useAuthStore } from '@/store/auth-store';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

/* ─── Animation Variants ──────────────────────────────────────── */

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

/* ─── Types ───────────────────────────────────────────────────── */

interface DetectedPattern {
  id: string;
  description: string;
  occurrences: number;
  direction: 'debit' | 'credit';
  averageAmount: number;
  suggestedAccount: string;
  suggestedAccountCode: string;
  suggestedAccountId: string;
}

/* ─── EditableRule (state inside modal) ───────────────────────── */

interface EditableRule {
  name: string;
  conditionType: 'contains' | 'starts_with' | 'ends_with' | 'equals';
  conditionValue: string;
  transactionDirection: 'debit' | 'credit' | 'any';
  glAccountName: string;
  glAccountCode: string;
  glAccountId?: string;
  priority: number;
}

/* ─── RuleModal ───────────────────────────────────────────────── */

function RuleModal({
  pattern,
  onClose,
  onSave,
}: {
  pattern: DetectedPattern;
  onClose: () => void;
  onSave: (rule: EditableRule) => Promise<void>;
}) {
  const language = useLanguageStore((s) => s.language) || 'es';
  const isEn = language === 'en';

  const dt = {
    viewEditRule: isEn ? 'View / Edit Rule' : 'Ver / Editar Regla',
    occurrencesDetected: isEn ? 'occurrences detected' : 'ocurrencias detectadas',
    ruleName: isEn ? 'Rule Name' : 'Nombre de la Regla',
    conditionType: isEn ? 'Condition Type' : 'Tipo de Condición',
    contains: isEn ? 'Contains' : 'Contiene',
    startsWith: isEn ? 'Starts with' : 'Empieza con',
    endsWith: isEn ? 'Ends with' : 'Termina con',
    equals: isEn ? 'Equals' : 'Igual a',
    value: isEn ? 'Value' : 'Valor',
    direction: isEn ? 'Direction' : 'Dirección',
    debit: isEn ? 'Debit (outflow)' : 'Débito (egreso)',
    credit: isEn ? 'Credit (inflow)' : 'Crédito (ingreso)',
    any: isEn ? 'Both' : 'Ambos',
    glCode: isEn ? 'GL Code' : 'Código GL',
    glAccount: isEn ? 'GL Account' : 'Cuenta GL',
    priority: isEn ? 'Priority' : 'Prioridad',
    lowest: isEn ? 'lowest' : 'menor',
    highest: isEn ? 'highest' : 'mayor',
    cancel: isEn ? 'Cancel' : 'Cancelar',
    saveRule: isEn ? 'Save Rule' : 'Guardar Regla',
  };

  const [saving, setSaving] = useState(false);
  const [rule, setRule] = useState<EditableRule>({
    name: pattern.description,
    conditionType: 'contains',
    conditionValue: pattern.description,
    transactionDirection: pattern.direction ?? 'any',
    glAccountName: pattern.suggestedAccount,
    glAccountCode: pattern.suggestedAccountCode,
    priority: 10,
  });

  function field(key: keyof EditableRule, value: string | number) {
    setRule((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    await onSave(rule);
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ duration: 0.18 }}
        className="bg-background border rounded-xl shadow-2xl w-full max-w-lg"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h3 className="font-semibold text-base flex items-center gap-2">
              <Eye className="size-4 text-violet-500" />
              {dt.viewEditRule}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {pattern.occurrences} {dt.occurrencesDetected}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Fields */}
        <div className="px-6 py-5 space-y-4">
          {/* Name */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {dt.ruleName}
            </label>
            <input
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              value={rule.name}
              onChange={(e) => field('name', e.target.value)}
            />
          </div>

          {/* Condition */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                {dt.conditionType}
              </label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                value={rule.conditionType}
                onChange={(e) => field('conditionType', e.target.value)}
              >
                <option value="contains">{dt.contains}</option>
                <option value="starts_with">{dt.startsWith}</option>
                <option value="ends_with">{dt.endsWith}</option>
                <option value="equals">{dt.equals}</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                {dt.value}
              </label>
              <input
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                value={rule.conditionValue}
                onChange={(e) => field('conditionValue', e.target.value)}
              />
            </div>
          </div>

          {/* Direction */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {dt.direction}
            </label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              value={rule.transactionDirection}
              onChange={(e) => field('transactionDirection', e.target.value)}
            >
              <option value="debit">{dt.debit}</option>
              <option value="credit">{dt.credit}</option>
              <option value="any">{dt.any}</option>
            </select>
          </div>

          {/* GL Account */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                {dt.glCode}
              </label>
              <input
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                value={rule.glAccountCode}
                onChange={(e) => field('glAccountCode', e.target.value)}
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                {dt.glAccount}
              </label>
              <input
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                value={rule.glAccountName}
                onChange={(e) => field('glAccountName', e.target.value)}
              />
            </div>
          </div>

          {/* Priority */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {dt.priority}: <span className="text-foreground font-semibold">{rule.priority}</span>
            </label>
            <input
              type="range"
              min={0}
              max={20}
              value={rule.priority}
              onChange={(e) => field('priority', Number(e.target.value))}
              className="w-full accent-violet-500"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-0.5">
              <span>0 ({dt.lowest})</span>
              <span>20 ({dt.highest})</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            {dt.cancel}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            {dt.saveRule}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

/* ─── AIRulesGeneratorTab ─────────────────────────────────────── */

export function AIRulesGeneratorTab() {
  const t = useLanguageStore((s) => s.t);
  const activeCompany = useAuthStore((s) => s.activeCompany);
  const language = useLanguageStore((s) => s.language) || 'es';
  const isEn = language === 'en';

  const dt = {
    ruleSaved: isEn ? 'Rule saved' : 'Regla guardada',
    saveFailed: isEn
      ? 'Could not save the rule. Verify that the GL account exists.'
      : 'No se pudo guardar la regla. Verifique que la cuenta GL exista.',
    selectAccountBeforeSaving: isEn
      ? 'Must select a GL account before saving.'
      : 'Debe seleccionar una cuenta GL antes de guardar.',
    viewRule: isEn ? 'View Rule' : 'Ver Regla',
  };

  const [patterns, setPatterns] = useState<DetectedPattern[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [savingRules, setSavingRules] = useState<string[]>([]);
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [viewingPattern, setViewingPattern] = useState<DetectedPattern | null>(null);

  async function handleScan() {
    if (!activeCompany?.id) return;
    setScanning(true);
    setPatterns([]);
    setScanned(false);

    try {
      const res = await fetch('/api/ai-rules/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: activeCompany.id }),
      });

      if (res.ok) {
        const data = (await res.json()) as { patterns?: DetectedPattern[] };
        setPatterns(data.patterns || []);
        setScanned(true);
        if ((data.patterns || []).length > 0) {
          toast?.success?.(t('settings.aiRules.scanComplete'));
        }
      } else {
        setPatterns([]);
        setScanned(true);
      }
    } catch {
      setPatterns([]);
      setScanned(true);
    }

    setScanning(false);
  }

  async function saveRule(patternId: string, rule: EditableRule) {
    if (!activeCompany?.id) return;
    setSavingRules((prev) => [...prev, patternId]);
    try {
      const res = await fetch('/api/bank-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: activeCompany.id,
          name: rule.name,
          conditionType: rule.conditionType,
          conditionValue: rule.conditionValue,
          transactionDirection: rule.transactionDirection,
          glAccountCode: rule.glAccountCode,
          glAccountId: rule.glAccountId,
          priority: rule.priority,
        }),
      });
      if (!res.ok) throw new Error();
      toast?.success?.(`${dt.ruleSaved}: ${rule.name}`);
      setPatterns((prev) => prev.filter((p) => p.id !== patternId));
    } catch {
      toast?.error?.(dt.saveFailed);
      throw new Error('Save failed');
    } finally {
      setSavingRules((prev) => prev.filter((id) => id !== patternId));
    }
  }

  async function handleSaveRule(pattern: DetectedPattern) {
    if (!pattern.suggestedAccountCode && !pattern.suggestedAccountId) {
      setViewingPattern(pattern);
      toast?.error?.(dt.selectAccountBeforeSaving);
      return;
    }
    try {
      await saveRule(pattern.id, {
        name: pattern.description,
        conditionType: 'contains',
        conditionValue: pattern.description,
        transactionDirection: pattern.direction ?? 'any',
        glAccountName: pattern.suggestedAccount,
        glAccountCode: pattern.suggestedAccountCode,
        glAccountId: pattern.suggestedAccountId,
        priority: 10,
      });
    } catch {
      // error handled in saveRule
    }
  }

  async function handleSaveAll() {
    setIsSavingAll(true);
    const list = [...patterns];
    for (const pattern of list) {
      if (!pattern.suggestedAccountCode && !pattern.suggestedAccountId) {
        continue; // Skip rules without an account
      }
      try {
        await handleSaveRule(pattern);
      } catch (err) {
        console.error('Error saving pattern rule:', pattern.description, err);
      }
    }
    setIsSavingAll(false);
  }

  async function handleModalSave(rule: EditableRule) {
    if (!viewingPattern) return;
    await saveRule(viewingPattern.id, rule);
    setViewingPattern(null);
  }

  return (
    <>
      {/* Modal */}
      <AnimatePresence>
        {viewingPattern && (
          <RuleModal
            pattern={viewingPattern}
            onClose={() => setViewingPattern(null)}
            onSave={handleModalSave}
          />
        )}
      </AnimatePresence>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="space-y-6"
      >
        {/* Header */}
        <motion.div variants={itemVariants}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Brain className="size-5 text-violet-500" />
                {t('settings.aiRules.title')}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">{t('settings.aiRules.subtitle')}</p>
            </div>
            {scanned && patterns.length > 0 && (
              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 self-start">
                <CheckCircle2 className="size-3 mr-1" />
                {patterns.length} {t('settings.aiRules.created')}
              </Badge>
            )}
          </div>
        </motion.div>

        {/* Scan Button */}
        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('settings.aiRules.title')}</CardTitle>
              <CardDescription>{t('settings.aiRules.subtitle')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={handleScan} disabled={scanning} className="gap-2">
                {scanning ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t('settings.aiRules.scanning')}
                  </>
                ) : (
                  <>
                    <Search className="size-4" />
                    {t('settings.aiRules.scanTransactions')}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </motion.div>

        {/* Empty State */}
        {scanned && patterns.length === 0 && !scanning && (
          <motion.div variants={itemVariants} className="text-center py-16">
            <div className="flex flex-col items-center gap-3">
              <div className="flex items-center justify-center size-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30">
                <CheckCircle2 className="size-8 text-emerald-500" />
              </div>
              <p className="text-sm text-muted-foreground max-w-md">
                {t('settings.aiRules.noPatterns')}
              </p>
            </div>
          </motion.div>
        )}

        {/* Detected Patterns */}
        {patterns.length > 0 && (
          <motion.div variants={itemVariants}>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Zap className="size-4 text-amber-500" />
                    {t('settings.aiRules.patternFound')}
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSaveAll}
                    disabled={isSavingAll || patterns.length === 0}
                  >
                    {isSavingAll ? (
                      <Loader2 className="size-3.5 mr-1 animate-spin" />
                    ) : (
                      <CheckCircle2 className="size-3.5 mr-1" />
                    )}
                    {t('settings.aiRules.saveAllRules')}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {patterns.map((pattern) => (
                  <motion.div
                    key={pattern.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="rounded-lg border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{pattern.description}</p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>
                          {pattern.occurrences} {t('settings.aiRules.occurrences')}
                        </span>
                        <span className="flex items-center gap-1">
                          <ArrowRight className="size-3" />
                          {t('settings.aiRules.suggestedAccount')}: {pattern.suggestedAccountCode} -{' '}
                          {pattern.suggestedAccount}
                        </span>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Ver Regla */}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setViewingPattern(pattern)}
                        className="gap-1.5"
                      >
                        <Eye className="size-3.5" />
                        {dt.viewRule}
                      </Button>

                      {/* Guardar Regla */}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSaveRule(pattern)}
                        disabled={savingRules.includes(pattern.id)}
                        className="gap-1.5"
                      >
                        {savingRules.includes(pattern.id) ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="size-3.5" />
                        )}
                        {t('settings.aiRules.saveRule')}
                      </Button>
                    </div>
                  </motion.div>
                ))}
              </CardContent>
            </Card>
          </motion.div>
        )}
      </motion.div>
    </>
  );
}
