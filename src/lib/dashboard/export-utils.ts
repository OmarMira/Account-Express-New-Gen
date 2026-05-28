import { createHash } from 'crypto';

function generateHash(payload: any) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}

export function exportToCSV(kpi: any, trend: any[], companyId: string) {
  const header = 'Concepto,Valor\n';
  const rows = `Activos,${kpi.assets}\nPasivos,${kpi.liabilities}\nPatrimonio,${kpi.equity}\nIngresos,${kpi.revenue}\nGastos,${kpi.expenses}\n`;
  const hash = generateHash({ kpi, companyId, exportedAt: new Date().toISOString() });
  const content = `${header}${rows}Hash_Integridad,${hash}\n`;

  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dashboard-financiero-${companyId}-${Date.now()}.csv`;
  a.click();
}

export function exportToPDF(kpi: any, alerts: any, trend: any[], companyId: string) {
  const payload = { kpi, alerts, trend, companyId, exportedAt: new Date().toISOString() };
  const hash = generateHash(payload);
  console.log(
    `🖨️ Generando PDF. Payload firmable: ${JSON.stringify({ ...payload, integrityHash: hash })}`,
  );
  alert(`Exportación iniciada. Hash de integridad del reporte: ${hash}`);
}
