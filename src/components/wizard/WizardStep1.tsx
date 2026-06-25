'use client';

import React, { useEffect } from 'react';
import { useWizardStore } from '@/lib/stores/wizard-store';
import type { EntityRole } from '@/lib/constants/entity-roles';
import { UI_ROLES } from '@/lib/constants/entity-roles';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { WizardEmptyState } from './WizardEmptyState';

interface WizardStep1Props {
  companyId: string;
}

/** Roles shown in the dropdown (excludes IGNORADA and OTRO — handled separately). */
const DROPDOWN_ROLES = UI_ROLES.filter((r) => r !== 'OTRO' && r !== 'IGNORADA');

function formatAmount(amount: number | undefined): string {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function confidenceLabel(value: number): string {
  if (value >= 0.8) return 'high';
  if (value >= 0.5) return 'medium';
  return 'low';
}

function confidenceColor(label: string): string {
  switch (label) {
    case 'high':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
    case 'medium':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    default:
      return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
  }
}

export function WizardStep1({ companyId }: WizardStep1Props) {
  const entities = useWizardStore((s) => s.entities);
  const entitiesLoading = useWizardStore((s) => s.entitiesLoading);
  const setEntityRole = useWizardStore((s) => s.setEntityRole);
  const nextStep = useWizardStore((s) => s.nextStep);
  const suggestAllRoles = useWizardStore((s) => s.suggestAllRoles);
  const stepError = useWizardStore((s) => s.stepError);

  const hasAnyRole = entities.some((e) => e.assignedRole !== null);

  // Trigger AI suggestions when entities are loaded and no prior suggestion has been made
  useEffect(() => {
    if (!entitiesLoading && entities.length > 0 && entities.every((e) => e.suggestionStatus === 'pending')) {
      suggestAllRoles(companyId);
    }
  }, [entitiesLoading, entities.length, companyId, suggestAllRoles]);

  // Loading state
  if (entitiesLoading) {
    return (
      <div className="space-y-3 py-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </div>
    );
  }

  // Empty state
  if (entities.length === 0) {
    return <WizardEmptyState />;
  }

  return (
    <div className="space-y-4">
      {/* Error message for blocked step transition */}
      {stepError && (
        <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          {stepError}
        </div>
      )}

      {/* Entity classification table */}
      <div className="overflow-x-auto">
        <Table className="min-w-max">
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[180px]">Name</TableHead>
              <TableHead className="min-w-[90px]">Direction</TableHead>
              <TableHead className="min-w-[90px]">Pattern</TableHead>
              <TableHead className="min-w-[110px]">Frequency</TableHead>
              <TableHead className="min-w-[100px] text-right">Avg Amount</TableHead>
              <TableHead className="text-right min-w-[100px]">Occurrences</TableHead>
              <TableHead className="min-w-[150px]">Role</TableHead>
              <TableHead className="min-w-[100px]">AI Suggestion</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entities.map((entity) => (
              <TableRow key={entity.candidate.id}>
                <TableCell className="font-medium">
                  {entity.candidate.canonicalName}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={
                      entity.candidate.direction === 'credit'
                        ? 'border-emerald-300 text-emerald-700 dark:text-emerald-400'
                        : entity.candidate.direction === 'debit'
                          ? 'border-amber-300 text-amber-700 dark:text-amber-400'
                          : ''
                    }
                  >
                    {entity.candidate.direction}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">
                    {entity.candidate.amountCluster}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {entity.candidate.frequency}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {formatAmount(entity.candidate.avgAmount)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {entity.candidate.occurrences}
                </TableCell>
                <TableCell>
                  <Select
                    value={entity.assignedRole ?? ''}
                    onValueChange={(role) =>
                      setEntityRole(entity.candidate.id, role as EntityRole)
                    }
                  >
                    <SelectTrigger className="w-[150px]">
                      <SelectValue placeholder="Select role..." />
                    </SelectTrigger>
                    <SelectContent>
                      {DROPDOWN_ROLES.map((role) => (
                        <SelectItem key={role} value={role}>
                          {role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  {entity.suggestionStatus === 'loading' ? (
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" />
                      <span>Suggesting...</span>
                    </div>
                  ) : entity.suggestionStatus === 'success' && entity.suggestionConfidence != null ? (
                    <Badge
                      className={confidenceColor(confidenceLabel(entity.suggestionConfidence))}
                    >
                      {confidenceLabel(entity.suggestionConfidence)} ({Math.round(entity.suggestionConfidence * 100)}%)
                    </Badge>
                  ) : entity.suggestionStatus === 'error' ? (
                    <span className="text-xs text-red-500">Suggestion failed</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Navigation footer */}
      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-2">
          {/* Back is hidden on step 1 */}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={nextStep}
            className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4 transition-colors"
          >
            Saltar y continuar después
          </button>
          <Button onClick={nextStep} disabled={!hasAnyRole}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
