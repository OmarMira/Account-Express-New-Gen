'use client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle, Info, TrendingUp } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useRBAC } from '@/hooks/useRBAC';

export function FinancialAssistantPanel({ companyId }: { companyId: string }) {
  const { user } = useAuth();

  // Mapear el rol global 'company_admin' al rol 'admin' de la compañía para la validación RBAC
  const authCtx = user
    ? {
        userId: user.id,
        companyId,
        role: user.role === 'company_admin' ? 'admin' : user.role,
      }
    : null;

  const canView = useRBAC(authCtx, 'reports', 'read');

  const { data, isLoading } = useQuery({
    queryKey: ['assistant-insights', companyId],
    queryFn: () => fetch(`/api/assistant/insights?companyId=${companyId}`).then((r) => r.json()),
    enabled: !!canView && !!companyId,
    refetchInterval: 300000, // 5 min
  });

  if (!canView) return null;
  if (isLoading)
    return <div className="p-6 text-muted-foreground animate-pulse">Cargando asistente...</div>;
  if (!data?.insights?.length)
    return (
      <div className="p-6 text-muted-foreground flex items-center gap-2">
        <CheckCircle className="text-green-500 size-5" /> Sin alertas activas. Sistema estable.
      </div>
    );

  const severityConfig = {
    info: { icon: <Info className="text-blue-500 size-4 mt-0.5" />, badge: 'outline' },
    warning: {
      icon: <AlertCircle className="text-yellow-500 size-4 mt-0.5" />,
      badge: 'secondary',
    },
    critical: {
      icon: <AlertCircle className="text-red-500 size-4 mt-0.5" />,
      badge: 'destructive',
    },
  } as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg font-bold">
          <TrendingUp className="size-5 text-primary" /> Asistente Financiero
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.insights.map((insight: any) => {
          const cfg =
            severityConfig[insight.severity as keyof typeof severityConfig] || severityConfig.info;
          return (
            <div
              key={insight.id}
              className="flex items-start gap-3 p-3 rounded-md border bg-card hover:bg-muted/50 transition-colors"
            >
              {cfg.icon}
              <div className="flex-1 min-w-0">
                <p className="text-sm leading-snug">{insight.message}</p>
                {insight.context && (
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    Ref: {JSON.stringify(insight.context).slice(0, 80)}...
                  </p>
                )}
              </div>
              <Badge variant={cfg.badge} className="shrink-0 font-semibold">
                {insight.severity.toUpperCase()}
              </Badge>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
