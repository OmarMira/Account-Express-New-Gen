export function exportToCSVContent(
  data: any,
  companyId: string,
  type: string,
  hash: string,
): string {
  let content = '\uFEFF'; // BOM UTF-8
  content += `LQ&OM LLC - REPORTE FINANCIERO INTERNO (${type.toUpperCase()})\n`;
  content += `Empresa ID,${companyId}\n`;
  content += `Generado el,${new Date().toISOString()}\n`;
  content += `ADVERTENCIA,DOCUMENTO PARA USO INTERNO. NO VÁLIDO PARA PRESENTACIÓN ANTE ENTIDADES GUBERNAMENTALES O FISCALES.\n\n`;

  if (type === 'trial_balance') {
    content += 'Código,Cuenta,Tipo,Débito,Crédito,Saldo Neto\n';
    for (const acc of data.accounts) {
      content += `"${acc.code}","${acc.name}","${acc.accountType}",${acc.debit},${acc.credit},${acc.balance}\n`;
    }
    content += `,,,${data.totalDebits},${data.totalCredits},\n`;
    content += `Cuadrado,${data.balanced ? 'SÍ' : 'NO'}\n`;
  } else if (type === 'income_statement') {
    content += 'INGRESOS\n';
    content += 'Código,Cuenta,Saldo\n';
    for (const r of data.revenues) {
      content += `"${r.code}","${r.name}",${r.balance}\n`;
    }
    content += `TOTAL INGRESOS,,${data.totalRevenue}\n\n`;

    content += 'EGRESOS / GASTOS\n';
    content += 'Código,Cuenta,Saldo\n';
    for (const e of data.expenses) {
      content += `"${e.code}","${e.name}",${e.balance}\n`;
    }
    content += `TOTAL GASTOS,,${data.totalExpense}\n\n`;
    content += `UTILIDAD NETO DEL EJERCICIO,,${data.netIncome}\n`;
  } else if (type === 'balance_sheet') {
    content += 'ACTIVOS (ASSETS)\n';
    content += 'Código,Cuenta,Saldo\n';
    for (const a of data.assets) {
      content += `"${a.code}","${a.name}",${a.balance}\n`;
    }
    content += `TOTAL ACTIVOS,,${data.totalAssets}\n\n`;

    content += 'PASIVOS (LIABILITIES)\n';
    content += 'Código,Cuenta,Saldo\n';
    for (const l of data.liabilities) {
      content += `"${l.code}","${l.name}",${l.balance}\n`;
    }
    content += `TOTAL PASIVOS,,${data.totalLiabilities}\n\n`;

    content += 'PATRIMONIO (EQUITY)\n';
    content += 'Código,Cuenta,Saldo\n';
    for (const eq of data.equities) {
      content += `"${eq.code}","${eq.name}",${eq.balance}\n`;
    }
    content += `TOTAL PATRIMONIO,,${data.totalEquity}\n\n`;
    content += `TOTAL PASIVO + PATRIMONIO,,${data.totalLiabilities + data.totalEquity}\n`;
    content += `Cuadrado,${data.balanced ? 'SÍ' : 'NO'}\n`;
  }

  content += `\nHash_Integridad_SHA256,${hash}\n`;
  return content;
}
