'use client';

import React from 'react';
import { useWizardStore } from '@/lib/stores/wizard-store';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { WizardStep1 } from './WizardStep1';
import { WizardStep2 } from './WizardStep2';
import { WizardStep3 } from './WizardStep3';

interface WizardDialogProps {
  companyId: string;
}

const STEP_TITLES: Record<number, { title: string; description: string }> = {
  1: {
    title: 'Configuración Inteligente — Clasificar Entidades',
    description:
      'Asigna un rol contable a cada entidad detectada. Las reglas se generarán automáticamente.',
  },
  2: {
    title: 'Revisar Reglas Propuestas',
    description:
      'Confirma o ajusta las reglas propuestas antes de aplicarlas a tus transacciones.',
  },
  3: {
    title: 'Aplicar Reglas',
    description:
      'Ejecuta la creación de reglas y la clasificación de transacciones históricas.',
  },
};

export function WizardDialog({ companyId }: WizardDialogProps) {
  const open = useWizardStore((s) => s.open);
  const step = useWizardStore((s) => s.step);
  const closeWizard = useWizardStore((s) => s.closeWizard);

  const { title, description } = STEP_TITLES[step] ?? STEP_TITLES[1];

  function handleOpenChange(open: boolean) {
    if (!open) closeWizard();
  }

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
        {/* Step indicator */}
        <div className="flex items-center justify-center gap-1.5 mb-2">
          {[1, 2, 3].map((s) => (
            <React.Fragment key={s}>
              <div
                className={cn(
                  'flex size-7 items-center justify-center rounded-full text-xs font-medium transition-colors',
                  s === step
                    ? 'bg-primary text-primary-foreground'
                    : s < step
                      ? 'bg-primary/20 text-primary'
                      : 'bg-muted text-muted-foreground',
                )}
              >
                {s}
              </div>
              {s < 3 && (
                <div
                  className={cn(
                    'h-px w-6 transition-colors',
                    s < step ? 'bg-primary' : 'bg-border',
                  )}
                />
              )}
            </React.Fragment>
          ))}
        </div>

        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {/* Step content */}
        {step === 1 && <WizardStep1 companyId={companyId} />}
        {step === 2 && <WizardStep2 />}
        {step === 3 && <WizardStep3 companyId={companyId} />}
      </DialogContent>
    </Dialog>
  );
}
