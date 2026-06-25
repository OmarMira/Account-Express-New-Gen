'use client';

import React from 'react';
import { useWizardStore } from '@/lib/stores/wizard-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Sparkles } from 'lucide-react';

export function WizardEmptyState() {
  const closeWizard = useWizardStore((s) => s.closeWizard);

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-muted mb-4">
        <Sparkles className="size-7 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-1">Todo está al día</h3>
      <p className="text-sm text-muted-foreground mb-6 max-w-xs">
        No hay nuevas entidades pendientes de clasificación
      </p>
      <Button variant="outline" onClick={closeWizard}>
        Cerrar
      </Button>
    </div>
  );
}
