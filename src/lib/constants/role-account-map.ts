export const ROLE_ACCOUNT_MAP: Record<string, { debit: string; credit: string; fallback: string }> =
  {
    SOCIO: { debit: '3040', credit: '3010', fallback: '3010' },
    EMPLEADO: { debit: '6030', credit: '6030', fallback: '6030' },
    INQUILINO: { debit: '4020', credit: '4020', fallback: '4020' },
    CLIENTE: { debit: '4010', credit: '4010', fallback: '4010' },
    TARJETA_CREDITO: { debit: '2020', credit: '2020', fallback: '2020' },
    PRESTAMO: { debit: '2040', credit: '2040', fallback: '2040' },
    PROVEEDOR: { debit: '6070', credit: '6070', fallback: '6070' },
    GASTO_OPERATIVO: { debit: '5000', credit: '5000', fallback: '5000' },
    INGRESO: { debit: '4010', credit: '4010', fallback: '4010' },
  };
