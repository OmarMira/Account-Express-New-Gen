'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Upload,
  FileSpreadsheet,
  FileText,
  File,
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
  Clock,
  BarChart3,
  Landmark,
  ArrowLeftRight,
  RefreshCcw,
  FileUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Check } from 'lucide-react';
import { useAuthStore } from '@/store/auth-store';
import { useLanguageStore } from '@/store/language-store';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AccountSelector, type GlAccountOption } from './journal/AccountSelector';

// ─── Types ────────────────────────────────────────────────────────────

interface BankAccountOption {
  id: string;
  accountName: string;
  bankName: string;
  accountNo: string | null;
}

interface ImportStatement {
  id: string;
  bankAccountId: string;
  bankAccount: { id: string; accountName: string; bankName: string };
  startDate: string;
  endDate: string;
  openingBalance: number;
  closingBalance: number;
  format: string;
  fileName: string | null;
  createdAt: string;
  transactionCount: number;
  autoCategorizedCount: number;
  autoCategorizedPercent: number;
}

interface ImportResult {
  statementId: string;
  transactionCount: number;
  autoCategorizedCount: number;
  duplicatesSkipped: number;
  newAccountCreated: boolean;
  bankAccountName: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'csv':
    case 'tsv':
      return <FileSpreadsheet className="size-8 text-emerald-500" />;
    case 'ofx':
    case 'qfx':
      return <FileText className="size-8 text-teal-500" />;
    case 'pdf':
      return <File className="size-8 text-red-500" />;
    default:
      return <File className="size-8 text-muted-foreground" />;
  }
}

function getFormatBadge(format: string) {
  const config: Record<string, { className: string; label: string }> = {
    csv: {
      className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
      label: 'CSV',
    },
    ofx: {
      className: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
      label: 'OFX',
    },
    qfx: {
      className: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
      label: 'QFX',
    },
    pdf: {
      className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
      label: 'PDF',
    },
  };
  const c = config[format] || config.csv;
  return (
    <Badge variant="outline" className={cn('text-[10px] font-semibold uppercase', c.className)}>
      {c.label}
    </Badge>
  );
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

const ACCEPTED_TYPES = ['.csv', '.tsv', '.txt', '.ofx', '.qfx', '.pdf'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const CURRENCIES = [
  { value: 'USD', label: 'USD ($)' },
  { value: 'EUR', label: 'EUR (€)' },
  { value: 'GBP', label: 'GBP (£)' },
  { value: 'MXN', label: 'MXN ($)' },
  { value: 'CAD', label: 'CAD ($)' },
];

const FORMAT_BADGES: { label: string; className: string }[] = [
  {
    label: 'CSV',
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
  {
    label: 'OFX',
    className: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  },
  {
    label: 'QFX',
    className: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  },
  {
    label: 'PDF',
    className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  },
];

// ─── Main Component ───────────────────────────────────────────────────

export function ImportPage() {
  const t = useLanguageStore((s) => s.t);
  const activeCompany = useAuthStore((s) => s.activeCompany);
  const setCurrentView = useAuthStore((s) => s.setCurrentView);

  const startProcessing = useAuthStore((s) => s.startProcessing);
  const stopProcessing = useAuthStore((s) => s.stopProcessing);

  // State
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);
  const [selectedBankAccountId, setSelectedBankAccountId] = useState<string>('');
  const [history, setHistory] = useState<ImportStatement[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Bank Account Creation Modal State (when required by the import)
  const [bankModalOpen, setBankModalOpen] = useState(false);
  const [formAccountName, setFormAccountName] = useState('');
  const [formBankName, setFormBankName] = useState('');
  const [formAccountNo, setFormAccountNo] = useState('');
  const [formRoutingNo, setFormRoutingNo] = useState('');
  const [formGlAccountId, setFormGlAccountId] = useState<string | null>(null);
  const [formBalance, setFormBalance] = useState('');
  const [formCurrency, setFormCurrency] = useState('USD');
  const [formError, setFormError] = useState('');
  const [savingBank, setSavingBank] = useState(false);
  const [assetAccounts, setAssetAccounts] = useState<GlAccountOption[]>([]);

  // Upload state
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState('');

  // Result dialog
  const [resultOpen, setResultOpen] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Helpers ────────────────────────────────────────────────────────
  function formatNumberWithComas(val: string): string {
    const cleaned = val.replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    if (parts.length > 2) return val;
    const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (parts.length === 2) {
      return `${integerPart}.${parts[1].slice(0, 2)}`;
    }
    return integerPart;
  }

  // ─── Fetch data ───────────────────────────────────────────────────

  async function fetchBankAccounts() {
    if (!activeCompany) return;
    try {
      const res = await fetch(`/api/banks?companyId=${activeCompany.id}`);
      if (res.ok) {
        const data = await res.json();
        const active = (data.accounts || []).filter((a: { isActive: boolean }) => a.isActive);
        setBankAccounts(
          active.map((a: BankAccountOption) => ({
            id: a.id,
            accountName: a.accountName,
            bankName: a.bankName,
            accountNo: a.accountNo,
          })),
        );
      }
    } catch (err) {
      console.error('Failed to fetch bank accounts:', err);
    }
  }

  async function fetchAssetAccounts() {
    if (!activeCompany) return;
    try {
      const res = await fetch(`/api/journal/accounts?companyId=${activeCompany.id}`);
      if (res.ok) {
        const data = await res.json();
        setAssetAccounts(
          (data.data || data.accounts || []).filter(
            (a: GlAccountOption) => a.accountType === 'asset',
          ),
        );
      }
    } catch (err) {
      console.error('Failed to fetch GL accounts:', err);
    }
  }

  async function fetchHistory() {
    if (!activeCompany) return;
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/import/history?companyId=${activeCompany.id}`);
      if (res.ok) {
        const data = await res.json();
        setHistory(data.statements || []);
      }
    } catch (err) {
      console.error('Failed to fetch import history:', err);
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => {
    fetchBankAccounts();
    fetchHistory();
    fetchAssetAccounts();
  }, [activeCompany]);

  // ─── Drag & Drop ─────────────────────────────────────────────────

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    setUploadError('');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      validateAndAddFiles(Array.from(files));
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files && files.length > 0) {
      validateAndAddFiles(Array.from(files));
    }
  }

  function validateAndAddFiles(files: File[]) {
    const validFiles: File[] = [];
    let errorMsg = '';

    for (const file of files) {
      const ext = '.' + (file.name.split('.').pop()?.toLowerCase() || '');
      if (!ACCEPTED_TYPES.includes(ext)) {
        errorMsg = `${t('common.type')}: "${ext}" — ${t('banks.supportedFormats')}`;
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        errorMsg = `${t('common.type')}: ${formatFileSize(file.size)} — ${t('banks.supportedFormats')}`;
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length > 0) {
      setSelectedFiles((prev) => [...prev, ...validFiles]);
    }
    if (errorMsg) {
      setUploadError(errorMsg);
    }
  }

  function removeFile(index: number) {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  function clearFiles() {
    setSelectedFiles([]);
    setUploadError('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  // ─── Upload ───────────────────────────────────────────────────────

  async function handleUpload() {
    if (selectedFiles.length === 0 || !activeCompany) return;

    setUploading(true);
    setUploadProgress(5);
    setUploadError('');
    startProcessing('Importando y procesando estado de cuenta...');

    try {
      let totalTransactions = 0;
      let totalAutoCategorized = 0;
      let totalDuplicatesSkipped = 0;
      let newAccountCreated = false;
      let bankAccountName = '';
      let statementId = '';

      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];

        // Progress weight for each file
        const startProgress = (i / selectedFiles.length) * 100;
        const endProgress = ((i + 1) / selectedFiles.length) * 100;
        setUploadProgress(startProgress + 5);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('companyId', activeCompany.id);
        if (selectedBankAccountId) {
          formData.append('bankAccountId', selectedBankAccountId);
        }

        const res = await fetch('/api/import', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const contentType = res.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const err = await res.json();

            // Check if bank account creation is required!
            if (err.code === 'BANK_CREATION_REQUIRED') {
              const meta = err.details;
              setFormAccountName(meta.bankName || 'Business Checking');
              setFormBankName(meta.bankName || '');
              setFormAccountNo(meta.accountNo || '');
              setFormRoutingNo('');
              setFormGlAccountId(null);
              setFormBalance(
                meta.openingBalance !== undefined
                  ? formatNumberWithComas(Number(meta.openingBalance.toFixed(2)).toString())
                  : '0.00',
              );
              setFormCurrency(meta.currency || 'USD');
              setFormError('');
              setBankModalOpen(true);

              setUploading(false);
              setUploadProgress(0);
              stopProcessing();
              return;
            }

            throw new Error(err.error || `${file.name}: ${t('banks.importFailed')}`);
          } else {
            throw new Error(`${file.name}: Error del servidor (${res.status})`);
          }
        }

        const data: ImportResult = await res.json();
        statementId = data.statementId;
        totalTransactions += data.transactionCount;
        totalAutoCategorized += data.autoCategorizedCount;
        totalDuplicatesSkipped += data.duplicatesSkipped;
        if (data.newAccountCreated) newAccountCreated = true;
        bankAccountName = data.bankAccountName;

        setUploadProgress(endProgress);
      }

      setImportResult({
        statementId,
        transactionCount: totalTransactions,
        autoCategorizedCount: totalAutoCategorized,
        duplicatesSkipped: totalDuplicatesSkipped,
        newAccountCreated,
        bankAccountName,
      });
      setResultOpen(true);
      clearFiles();
      fetchBankAccounts();
      fetchHistory();
    } catch (err: any) {
      setUploadError(err.message || t('banks.importFailed'));
    } finally {
      setUploading(false);
      setUploadProgress(0);
      stopProcessing();
    }
  }

  async function handleSaveBank() {
    if (!formAccountName.trim()) {
      setFormError('El nombre de la cuenta es requerido');
      return;
    }
    if (!formBankName.trim()) {
      setFormError('El nombre del banco es requerido');
      return;
    }
    if (!formGlAccountId) {
      setFormError('La cuenta contable vinculada es requerida');
      return;
    }

    setSavingBank(true);
    setFormError('');
    try {
      const body = {
        companyId: activeCompany!.id,
        accountName: formAccountName,
        bankName: formBankName,
        accountNo: formAccountNo || null,
        routingNo: formRoutingNo || null,
        glAccountId: formGlAccountId,
        balance: parseFloat(formBalance.replace(/,/g, '')) || 0,
        currency: formCurrency,
      };

      const res = await fetch('/api/banks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setBankModalOpen(false);
        await fetchBankAccounts();

        // Auto-resume import process!
        setTimeout(() => {
          handleUpload();
        }, 100);
      } else {
        const err = await res.json();
        setFormError(err.error || 'No se pudo guardar la cuenta bancaria');
      }
    } catch (err) {
      console.error('Failed to save bank account:', err);
      setFormError('Ocurrió un error inesperado');
    } finally {
      setSavingBank(false);
    }
  }

  // ─── Render ──────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{t('banks.importStatement')}</h2>
        <p className="text-sm text-muted-foreground">{t('banks.importStatement')}</p>
      </div>

      {/* Upload Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-5">
            {/* Drop zone */}
            <div
              className={cn(
                'relative rounded-xl border-2 border-dashed p-8 text-center transition-all cursor-pointer',
                isDragging
                  ? 'border-primary bg-primary/5 scale-[1.01]'
                  : selectedFiles.length > 0
                    ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-950/20'
                    : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50',
                uploading && 'pointer-events-none opacity-60',
              )}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={(e) => {
                if (uploading) return;
                // Only click if we clicked the dropzone itself, not children buttons
                if (
                  (e.target as HTMLElement).tagName === 'BUTTON' ||
                  (e.target as HTMLElement).closest('button')
                ) {
                  return;
                }
                fileInputRef.current?.click();
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".csv,.tsv,.txt,.ofx,.qfx,.pdf"
                multiple
                onChange={handleFileInput}
              />

              {selectedFiles.length > 0 ? (
                /* Selected files preview */
                <div className="flex flex-col items-center gap-4 w-full max-w-md mx-auto">
                  <div className="w-full space-y-2 max-h-[200px] overflow-y-auto pr-1">
                    {selectedFiles.map((file, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2 rounded-lg border bg-background text-left"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {getFileIcon(file.name)}
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate max-w-[200px]">
                              {file.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatFileSize(file.size)}
                            </p>
                          </div>
                        </div>
                        {!uploading && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground hover:text-red-600 shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeFile(idx);
                            }}
                          >
                            <X className="size-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                  {!uploading && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-red-600"
                      onClick={(e) => {
                        e.stopPropagation();
                        clearFiles();
                      }}
                    >
                      <X className="size-3.5 mr-1" />
                      {t('common.delete')} Todo
                    </Button>
                  )}
                </div>
              ) : (
                /* Empty drop zone */
                <div className="flex flex-col items-center gap-3">
                  <div
                    className={cn(
                      'flex size-14 items-center justify-center rounded-full transition-colors',
                      isDragging ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    <Upload className="size-6" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      {isDragging ? t('banks.dragDrop') : t('banks.dragDrop')}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('banks.supportedFormats')}
                    </p>
                  </div>
                  {/* Prominent format badges */}
                  <div className="flex items-center gap-2 mt-2">
                    {FORMAT_BADGES.map((fmt) => (
                      <Badge
                        key={fmt.label}
                        variant="outline"
                        className={cn('text-xs font-bold px-3 py-1', fmt.className)}
                      >
                        {fmt.label}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Upload progress */}
            {uploading && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Loader2 className="size-3 animate-spin" />
                    {t('banks.processing')}
                  </span>
                  <span>{Math.round(uploadProgress)}%</span>
                </div>
                <Progress value={uploadProgress} className="h-1.5" />
              </div>
            )}

            {/* Upload error */}
            {uploadError && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-3">
                <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-sm text-red-700 dark:text-red-400">{uploadError}</p>
              </div>
            )}

            {/* Import button */}
            <div className="flex items-center gap-3">
              <Button
                onClick={handleUpload}
                disabled={selectedFiles.length === 0 || uploading}
                className="w-full sm:w-auto h-10 px-6 text-sm font-semibold"
                size="lg"
              >
                {uploading ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    {t('banks.processing')}
                  </>
                ) : (
                  <>
                    <FileUp className="size-4 mr-2" />
                    {t('banks.importStatement')}
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground">{t('banks.autoDetect')}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Import History */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">{t('banks.importHistory')}</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchHistory}
              className="text-muted-foreground"
            >
              <RefreshCcw className="size-3.5 mr-1" />
              {t('common.refresh')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadingHistory ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Clock className="size-10 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">{t('banks.noImportHistory')}</p>
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('common.date')}</TableHead>
                    <TableHead>{t('common.name')}</TableHead>
                    <TableHead>{t('common.type')}</TableHead>
                    <TableHead className="hidden sm:table-cell">{t('banks.title')}</TableHead>
                    <TableHead className="text-center">{t('banks.transactionsImported')}</TableHead>
                    <TableHead className="text-center hidden md:table-cell">
                      {t('banks.autoCategorized')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((stmt) => (
                    <TableRow key={stmt.id}>
                      <TableCell className="font-medium text-sm whitespace-nowrap">
                        {formatDateShort(stmt.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getFileIcon(stmt.fileName || 'file.csv')}
                          <span className="text-sm truncate max-w-[150px]">
                            {stmt.fileName || '—'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>{getFormatBadge(stmt.format)}</TableCell>
                      <TableCell className="hidden sm:table-cell text-sm">
                        <span className="flex items-center gap-1">
                          <Landmark className="size-3 text-muted-foreground" />
                          {stmt.bankAccount.accountName}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="font-mono text-xs">
                          {stmt.transactionCount}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center hidden md:table-cell">
                        <div className="flex items-center justify-center gap-1">
                          <BarChart3 className="size-3 text-muted-foreground" />
                          <span
                            className={cn(
                              'text-xs font-medium',
                              stmt.autoCategorizedPercent >= 70
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : stmt.autoCategorizedPercent >= 40
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-muted-foreground',
                            )}
                          >
                            {stmt.autoCategorizedPercent}%
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Import Result Dialog ───────────────────────────────────── */}
      <Dialog open={resultOpen} onOpenChange={setResultOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40">
                <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              {t('banks.importSuccess')}
            </DialogTitle>
            <DialogDescription>{t('banks.importSuccessMessage')}</DialogDescription>
          </DialogHeader>

          {importResult && (
            <div className="space-y-4 py-2">
              {/* Summary cards */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold font-mono text-teal-600 dark:text-teal-400">
                    {importResult.transactionCount}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('banks.transactionsImported')}
                  </p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
                    {importResult.transactionCount > 0
                      ? Math.round(
                          (importResult.autoCategorizedCount / importResult.transactionCount) * 100,
                        )
                      : 0}
                    %
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{t('banks.autoCategorized')}</p>
                </div>
              </div>

              {/* Details */}
              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t('banks.autoCategorized')}</span>
                  <span className="font-medium">
                    {importResult.autoCategorizedCount} / {importResult.transactionCount}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t('banks.title')}</span>
                  <span className="font-medium">{importResult.bankAccountName}</span>
                </div>
                {importResult.newAccountCreated && (
                  <div className="flex items-center gap-2 rounded-md bg-teal-50 dark:bg-teal-950/30 p-2 text-sm">
                    <Landmark className="size-4 text-teal-600 dark:text-teal-400" />
                    <span className="text-teal-700 dark:text-teal-300">
                      {t('banks.newAccountCreated')}
                    </span>
                  </div>
                )}
                {importResult.duplicatesSkipped > 0 && (
                  <div className="flex items-center gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 p-2 text-sm">
                    <AlertCircle className="size-4 text-amber-600 dark:text-amber-400" />
                    <span className="text-amber-700 dark:text-amber-300">
                      {importResult.duplicatesSkipped} {t('reconciliation.duplicatesSkipped')}
                    </span>
                  </div>
                )}
              </div>

              {/* Categorization bar */}
              {importResult.transactionCount > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">
                    {t('banks.categorizationProgress')}
                  </p>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                      style={{
                        width: `${
                          importResult.transactionCount > 0
                            ? (importResult.autoCategorizedCount / importResult.transactionCount) *
                              100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                  {importResult.autoCategorizedCount < importResult.transactionCount && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      {importResult.transactionCount - importResult.autoCategorizedCount}{' '}
                      {t('banks.transactions').toLowerCase()} {t('banks.uncategorizedNote')}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setResultOpen(false)}
              className="w-full sm:w-auto"
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => {
                setResultOpen(false);
                setCurrentView('reconciliation');
              }}
              className="w-full sm:w-auto"
            >
              <ArrowLeftRight className="size-4 mr-1" />
              {t('banks.goToReconciliation')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Pre-filled Bank Account Creation Dialog ───────────────── */}
      <Dialog
        open={bankModalOpen}
        onOpenChange={(open) => {
          setBankModalOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{t('banks.newBankAccount')}</DialogTitle>
            <DialogDescription>
              Se detectó una cuenta bancaria en el extracto. Por favor, confírmela y vincúlela a una
              cuenta contable antes de importar.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Account Name */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                {t('common.name')} <span className="text-red-500">*</span>
              </label>
              <Input
                placeholder="e.g. Business Checking"
                value={formAccountName}
                onChange={(e) => setFormAccountName(e.target.value)}
              />
            </div>

            {/* Bank Name */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                {t('banks.bankName')} <span className="text-red-500">*</span>
              </label>
              <Input
                placeholder="e.g. Chase Bank"
                value={formBankName}
                onChange={(e) => setFormBankName(e.target.value)}
              />
            </div>

            {/* Account Number + Routing */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('banks.accountNumber')}</label>
                <Input
                  placeholder="e.g. 123456789"
                  value={formAccountNo}
                  onChange={(e) => setFormAccountNo(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('banks.routingNumber')}</label>
                <Input
                  placeholder="e.g. 021000021"
                  value={formRoutingNo}
                  onChange={(e) => setFormRoutingNo(e.target.value)}
                />
              </div>
            </div>

            {/* GL Account */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                {t('banks.linkedAccount')} <span className="text-red-500">*</span>
              </label>
              <AccountSelector
                accounts={assetAccounts}
                value={formGlAccountId}
                onChange={setFormGlAccountId}
                placeholder="Select asset account"
              />
              <p className="text-xs text-muted-foreground">{t('banks.linkedAccountHelp')}</p>
            </div>

            {/* Starting Balance + Currency */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('banks.startingBalance')}</label>
                <Input
                  type="text"
                  placeholder="0.00"
                  value={formBalance}
                  onChange={(e) => setFormBalance(formatNumberWithComas(e.target.value))}
                  className="font-mono text-right"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('banks.currency')}</label>
                <Select value={formCurrency} onValueChange={setFormCurrency}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Error */}
            {formError && <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBankModalOpen(false)} disabled={savingBank}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSaveBank} disabled={savingBank}>
              {savingBank && <Loader2 className="size-4 mr-1 animate-spin" />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
