'use client';

import React from 'react';
import { useWizardStore } from '@/lib/stores/wizard-store';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, CheckCircle2, AlertCircle, ChevronLeft, X } from 'lucide-react';

interface WizardStep3Props {
  companyId: string;
}

export function WizardStep3({ companyId }: WizardStep3Props) {
  const executionStatus = useWizardStore((s) => s.executionStatus);
  const executionError = useWizardStore((s) => s.executionError);
  const affectedTransactions = useWizardStore((s) => s.affectedTransactions);
  const createdRules = useWizardStore((s) => s.createdRules);
  const executeApply = useWizardStore((s) => s.executeApply);
  const prevStep = useWizardStore((s) => s.prevStep);
  const closeWizard = useWizardStore((s) => s.closeWizard);

  // Idle state — show execute button
  if (executionStatus === 'idle') {
    return (
      <div className="space-y-6 py-4">
        <p className="text-sm text-muted-foreground">
          Se crearán {useWizardStore.getState().proposedRules.length} reglas y se aplicarán
          a transacciones históricas pendientes de categorización.
        </p>
        <div className="flex items-center justify-between pt-2">
          <Button variant="outline" onClick={prevStep} className="gap-2">
            <ChevronLeft className="size-4" />
            Back
          </Button>
          <Button onClick={() => executeApply(companyId)}>
            Ejecutar
          </Button>
        </div>
      </div>
    );
  }

  // Loading state
  if (executionStatus === 'loading') {
    return (
      <div className="space-y-6 py-8 text-center">
        <Loader2 className="size-10 animate-spin mx-auto text-primary" />
        <p className="text-sm font-medium">Aplicando reglas...</p>
        <Progress value={50} className="max-w-xs mx-auto" />
        <div className="flex items-center justify-center pt-4">
          <Button variant="outline" disabled className="gap-2">
            <ChevronLeft className="size-4" />
            Back
          </Button>
        </div>
      </div>
    );
  }

  // Error state
  if (executionStatus === 'error') {
    return (
      <div className="space-y-6 py-4">
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="size-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive">Error</p>
              <p className="text-sm text-muted-foreground mt-1">
                {executionError ?? 'Ocurrió un error al aplicar las reglas.'}
              </p>
            </div>
          </CardContent>
        </Card>
        <div className="flex items-center justify-between pt-2">
          <Button variant="outline" onClick={prevStep} className="gap-2">
            <ChevronLeft className="size-4" />
            Back
          </Button>
          <Button variant="destructive" onClick={() => executeApply(companyId)}>
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  // Done state
  return (
    <div className="space-y-6 py-4">
      <Card className="border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800">
        <CardContent className="flex items-start gap-3 p-4">
          <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
              Completado
            </p>
            <div className="mt-2 space-y-1">
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold">{createdRules}</span>{' '}
                reglas creadas exitosamente
              </p>
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold">{affectedTransactions}</span>{' '}
                transacciones afectadas
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="flex items-center justify-end pt-2">
        <Button onClick={closeWizard} className="gap-2">
          <X className="size-4" />
          Cerrar
        </Button>
      </div>
    </div>
  );
}
