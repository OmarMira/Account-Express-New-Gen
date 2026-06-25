'use client';

import React from 'react';
import { useWizardStore } from '@/lib/stores/wizard-store';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ROLE_ACCOUNT_MAP } from '@/lib/constants/role-account-map';
import { ChevronLeft } from 'lucide-react';

export function WizardStep2() {
  const proposedRules = useWizardStore((s) => s.proposedRules);
  const updateRuleGlAccount = useWizardStore((s) => s.updateRuleGlAccount);
  const toggleRuleConfirmation = useWizardStore((s) => s.toggleRuleConfirmation);
  const nextStep = useWizardStore((s) => s.nextStep);
  const prevStep = useWizardStore((s) => s.prevStep);

  const hasConfirmed = proposedRules.some((r) => r.isConfirmed);

  function toggleConfirm(ruleId: string) {
    toggleRuleConfirmation(ruleId);
  }

  return (
    <div className="space-y-4">
      {/* Rule review table */}
      <div className="overflow-x-auto">
        <Table className="min-w-max">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">✓</TableHead>
              <TableHead className="min-w-[160px]">Entity</TableHead>
              <TableHead className="min-w-[80px]">Direction</TableHead>
              <TableHead className="min-w-[180px]">Condition</TableHead>
              <TableHead className="min-w-[160px]">GL Account</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {proposedRules.map((rule) => {
              const mapping = ROLE_ACCOUNT_MAP[rule.role];
              return (
                <TableRow key={rule.id}>
                  <TableCell>
                    <Checkbox
                      checked={rule.isConfirmed}
                      onCheckedChange={() => toggleConfirm(rule.id)}
                      aria-label={`Confirm rule for ${rule.entityName}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{rule.entityName}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{rule.transactionDirection}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    contains &apos;{rule.conditionValue}&apos;
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm">
                      {rule.debitGlAccountId && (
                        <span className="font-mono text-teal-600 dark:text-teal-400">
                          {rule.debitGlAccountId}
                        </span>
                      )}
                      {rule.creditGlAccountId && rule.creditGlAccountId !== rule.debitGlAccountId && (
                        <>
                          <span className="text-muted-foreground">/</span>
                          <span className="font-mono text-teal-600 dark:text-teal-400">
                            {rule.creditGlAccountId}
                          </span>
                        </>
                      )}
                      {mapping && (
                        <span className="text-xs text-muted-foreground ml-1">
                          ({mapping.fallback})
                        </span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Navigation footer */}
      <div className="flex items-center justify-between pt-2">
        <Button variant="outline" onClick={prevStep} className="gap-2">
          <ChevronLeft className="size-4" />
          Back
        </Button>
        <Button onClick={nextStep} disabled={!hasConfirmed}>
          Next
        </Button>
      </div>
    </div>
  );
}
