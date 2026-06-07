import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import path from 'path';
import { pathToFileURL } from 'url';
import { db } from './db';
import {
  getAllActiveProfiles,
  updateRequiresReviewStatus,
  BankProfileTyped,
} from './bank-profile-service';
import { createProfileFromPdf, PdfAnalysisData } from './bank-profile-onboarding';

// Force pdfjs-dist to use standard in-thread fake worker mode in Node/Bun to prevent worker thread loader crashes
if (typeof window === 'undefined') {
  try {
    const workerPath = pathToFileURL(
      path.join(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'),
    ).href;
    pdfjs.GlobalWorkerOptions.workerSrc = workerPath;
  } catch (err) {
    pdfjs.GlobalWorkerOptions.workerSrc = '';
  }
} else {
  pdfjs.GlobalWorkerOptions.workerSrc = '';
}

// ========== TYPES ==========
export interface ParsedTransaction {
  date: Date;
  description: string;
  amount: number;
  reference?: string;
  originalDateStr?: string;
}

export interface ParseOptions {
  fileName?: string;
  companyId?: string;
  userId?: string;
}

export interface ParsedPDFResult {
  transactions: ParsedTransaction[];
  bankName?: string;
  accountNo?: string;
  openingBalance?: number;
  closingBalance?: number;
  startDate?: Date;
  endDate?: Date;
  accountHolder?: string;
  mathValid?: boolean;
  mismatch?: number;
  selfHealingAttempted?: boolean;
  selfHealingSuccess?: boolean;
  warnings: string[];
}

interface PdfElement {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LineOfElements {
  y: number;
  text: string;
  elements: PdfElement[];
}

interface ColumnCluster {
  centerX: number;
  rightX: number;
  elements: PdfElement[];
}

// ========== CONFIGURATION ==========
const CLUSTER_TOLERANCE_PX = 15; // Grouping horizontal coordinate deviation
const CURRENCY_REGEX = /(?:^|\s)(-?\$?\s*\(?\d+(?:,\d{3})*(?:\.\d{2})?\)?-?)\s*$/;
const DATE_REGEX =
  /\b(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}|\d{1,2}[/\-]\d{1,2})\b/i;

// Agnostic keywords to detect transaction sections
const COLUMN_KEYWORDS = {
  date: ['date', 'fecha', 'datum', 'data'],
  description: ['description', 'descripcion', 'desc', 'detail', 'detalle', 'memo'],
  amount: ['amount', 'monto', 'importe', 'balance'],
  debit: ['debit', 'debito', 'withdrawal', 'retiro', 'cargo', 'charge', 'checks', 'cheques'],
  credit: ['credit', 'credito', 'deposit', 'deposito', 'abono', 'payment', 'pagos'],
};

// ========== CLUSTERING ==========
function clusterByXCoordinate(elements: PdfElement[]): ColumnCluster[] {
  const clusters: ColumnCluster[] = [];

  for (const element of elements) {
    let foundCluster = false;

    for (const cluster of clusters) {
      // Cluster right X edge to align right-aligned amount columns
      const distance = Math.abs(element.x + element.width - cluster.rightX);
      if (distance <= CLUSTER_TOLERANCE_PX) {
        cluster.elements.push(element);
        cluster.centerX =
          cluster.elements.reduce((sum, el) => sum + el.x, 0) / cluster.elements.length;
        cluster.rightX =
          cluster.elements.reduce((sum, el) => sum + (el.x + el.width), 0) /
          cluster.elements.length;
        foundCluster = true;
        break;
      }
    }

    if (!foundCluster) {
      clusters.push({
        centerX: element.x,
        rightX: element.x + element.width,
        elements: [element],
      });
    }
  }

  return clusters.sort((a, b) => a.centerX - b.centerX);
}

function clusterDatesByXCoordinate(elements: PdfElement[]): ColumnCluster[] {
  const clusters: ColumnCluster[] = [];

  for (const element of elements) {
    let foundCluster = false;

    for (const cluster of clusters) {
      const distance = Math.abs(element.x - cluster.centerX);
      if (distance <= CLUSTER_TOLERANCE_PX) {
        cluster.elements.push(element);
        cluster.centerX =
          cluster.elements.reduce((sum, el) => sum + el.x, 0) / cluster.elements.length;
        cluster.rightX =
          cluster.elements.reduce((sum, el) => sum + (el.x + el.width), 0) /
          cluster.elements.length;
        foundCluster = true;
        break;
      }
    }

    if (!foundCluster) {
      clusters.push({
        centerX: element.x,
        rightX: element.x + element.width,
        elements: [element],
      });
    }
  }

  return clusters.sort((a, b) => a.centerX - b.centerX);
}

// ========== TOPOLOGY DETECTION ==========
function detectLayoutTopology(clusters: ColumnCluster[]): {
  type: 'SINGLE_AMOUNT_COLUMN' | 'DUAL_AMOUNT_COLUMN';
  debitCluster?: ColumnCluster;
  creditCluster?: ColumnCluster;
  amountCluster?: ColumnCluster;
} {
  const validClusters = clusters.filter((c) => c.elements.length >= 2);

  if (validClusters.length >= 2) {
    return {
      type: 'DUAL_AMOUNT_COLUMN',
      debitCluster: validClusters[0],
      creditCluster: validClusters[1],
    };
  }

  return {
    type: 'SINGLE_AMOUNT_COLUMN',
    amountCluster: validClusters[0] || (clusters.length > 0 ? clusters[0] : undefined),
  };
}

// ========== YEAR RECONSTRUCTION ==========
function reconstructTransactionDates(
  rawTransactions: Array<{
    dateStr: string;
    description: string;
    amount: number;
    reference?: string;
  }>,
  startDate: Date,
  endDate: Date,
): ParsedTransaction[] {
  const result: ParsedTransaction[] = [];
  let currentYear = startDate.getFullYear();
  let lastMonth = startDate.getMonth();

  for (const raw of rawTransactions) {
    const parsedDate = parseDateString(raw.dateStr);
    if (!parsedDate) continue;

    let transactionDate: Date;
    const dateParts = raw.dateStr.split(/[/\-.]/);
    const hasYear = dateParts.length === 3 || /[A-Za-z]+\s+\d{1,2},?\s+\d{4}/.test(raw.dateStr);

    if (hasYear) {
      transactionDate = parsedDate;
    } else {
      const month = parsedDate.getMonth();
      const day = parsedDate.getDate();

      // Rollover detection (Dec -> Jan transition)
      if (month < lastMonth && lastMonth === 11 && month === 0) {
        currentYear++;
      }
      lastMonth = month;
      transactionDate = new Date(currentYear, month, day);
    }

    result.push({
      date: transactionDate,
      description: raw.description,
      amount: raw.amount,
      reference: raw.reference,
    });
  }

  return result;
}

// ========== MATHEMATICAL VALIDATION ==========
function validateMathematicalConsistency(
  openingBalance: number,
  closingBalance: number,
  transactions: ParsedTransaction[],
): { valid: boolean; difference: number } {
  const credits = transactions.filter((t) => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
  const debits = Math.abs(
    transactions.filter((t) => t.amount < 0).reduce((sum, t) => sum + t.amount, 0),
  );

  const calculatedClosing = openingBalance + credits - debits;
  const difference = Math.abs(calculatedClosing - closingBalance);

  return {
    valid: difference < 0.01,
    difference,
  };
}

// ========== PROFILE-GUIDED PARSER SUPPORT ==========
function parseAmountWithProfileFormat(val: string, format: any): number {
  let cleaned = val.replace(/[^0-9.,()+\\-]/g, '');

  let isNegative = false;
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    isNegative = true;
    cleaned = cleaned.slice(1, -1);
  } else if (cleaned.startsWith('-') || cleaned.endsWith('-')) {
    isNegative = true;
    cleaned = cleaned.replace(/-/g, '');
  }

  const { decimalSeparator, thousandsSeparator } = format;
  if (thousandsSeparator) {
    const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned.replace(new RegExp(escapeRegExp(thousandsSeparator), 'g'), '');
  }
  if (decimalSeparator && decimalSeparator !== '.') {
    cleaned = cleaned.replace(new RegExp(decimalSeparator, 'g'), '.');
  }

  let num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  return isNegative ? -num : num;
}

function parsePDFWithProfile(
  linesOfElements: LineOfElements[],
  pageWidth: number,
  profile: BankProfileTyped,
): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = [];
  const rules = profile.config.rules;
  const anchorRegex = new RegExp(rules.anchor.regex);
  const anchorRange = rules.anchor.columnRange;
  const descRange = rules.columns.description;
  const layoutType = profile.config.layoutType;
  const PROFILE_CURRENCY_REGEX = /^-?\$?\s*\(?\d+(?:[.,]\d+)*\)?-?$/;

  const continuationRegexes = (rules.continuationMarkers || []).map((m) => new RegExp(m, 'i'));
  const sectionContRegex = rules.sectionContinuationRegex
    ? new RegExp(rules.sectionContinuationRegex, 'i')
    : null;
  const totalRegexes = (rules.totalLinePatterns || []).map((p) => new RegExp(p, 'i'));

  for (const line of linesOfElements) {
    const lineText = line.text.trim();
    if (!lineText) continue;

    console.log('  Line text:', lineText);

    // Check stopSectionRegex
    if (rules.stopSectionRegex) {
      if (new RegExp(rules.stopSectionRegex, 'i').test(line.text)) {
        console.log('  STOPPED by stopSectionRegex:', rules.stopSectionRegex);
        break; // Detener parsing
      }
    }

    // Ignore continuation markers & headers
    const isContinuation =
      continuationRegexes.some((r) => r.test(lineText)) ||
      (sectionContRegex && sectionContRegex.test(lineText));
    if (isContinuation) {
      console.log('  Skipped: isContinuation');
      continue;
    }

    // Ignore total lines
    const isTotal = totalRegexes.some((r) => r.test(lineText));
    if (isTotal) {
      console.log('  Skipped: isTotal');
      continue;
    }

    // Find anchor date element
    const dateEl = line.elements.find((el) => {
      const relX = el.x / pageWidth;
      const textClean = el.text.trim();
      const match = relX >= anchorRange[0] && relX <= anchorRange[1] && anchorRegex.test(textClean);
      if (textClean.includes('/') || textClean.includes('-')) {
        console.log(
          `    Date Candidate: '${textClean}' relX: ${relX.toFixed(3)} range: [${anchorRange[0]}, ${anchorRange[1]}] regex: ${rules.anchor.regex} match: ${match}`,
        );
      }
      return match;
    });

    if (!dateEl) {
      console.log('    Failed: No dateEl anchor');
      continue;
    }

    // Find amount element
    let amount = 0;
    let amountEl: PdfElement | undefined;

    if (layoutType === 'SINGLE_AMOUNT_COLUMN' && rules.columns.amount) {
      const amountRange = rules.columns.amount;
      amountEl = line.elements.find((el) => {
        const relX = (el.x + el.width) / pageWidth;
        const textClean = el.text.trim();
        const match =
          relX >= amountRange[0] &&
          relX <= amountRange[1] &&
          PROFILE_CURRENCY_REGEX.test(textClean) &&
          !anchorRegex.test(textClean);
        console.log(
          `    Amount Candidate: '${textClean}' relX: ${relX.toFixed(3)} range: [${amountRange[0]}, ${amountRange[1]}] match: ${match}`,
        );
        return match;
      });

      if (amountEl) {
        amount = parseAmountWithProfileFormat(amountEl.text.trim(), profile.config.numberFormat);
      }
    } else if (layoutType === 'DUAL_AMOUNT_COLUMN') {
      const debitRange = rules.columns.debit;
      const creditRange = rules.columns.credit;

      const debitEl = debitRange
        ? line.elements.find((el) => {
            const relX = (el.x + el.width) / pageWidth;
            const textClean = el.text.trim();
            const match =
              relX >= debitRange[0] &&
              relX <= debitRange[1] &&
              PROFILE_CURRENCY_REGEX.test(textClean) &&
              !anchorRegex.test(textClean);
            console.log(
              `    Debit Candidate: '${textClean}' relX: ${relX.toFixed(3)} range: [${debitRange[0]}, ${debitRange[1]}] match: ${match}`,
            );
            return match;
          })
        : null;

      const creditEl = creditRange
        ? line.elements.find((el) => {
            const relX = (el.x + el.width) / pageWidth;
            const textClean = el.text.trim();
            const match =
              relX >= creditRange[0] &&
              relX <= creditRange[1] &&
              PROFILE_CURRENCY_REGEX.test(textClean) &&
              !anchorRegex.test(textClean);
            console.log(
              `    Credit Candidate: '${textClean}' relX: ${relX.toFixed(3)} range: [${creditRange[0]}, ${creditRange[1]}] match: ${match}`,
            );
            return match;
          })
        : null;

      if (debitEl) {
        amount = -Math.abs(
          parseAmountWithProfileFormat(debitEl.text.trim(), profile.config.numberFormat),
        );
        amountEl = debitEl;
      } else if (creditEl) {
        amount = Math.abs(
          parseAmountWithProfileFormat(creditEl.text.trim(), profile.config.numberFormat),
        );
        amountEl = creditEl;
      }
    }

    if (!amountEl) {
      console.log('    Failed: No amountEl');
      continue;
    }

    // Extract description elements (between date and amount or in the description column)
    const descElements = line.elements.filter((el) => {
      const relX = el.x / pageWidth;
      const textClean = el.text.trim();
      if (textClean === dateEl.text.trim() || textClean === amountEl!.text.trim()) return false;
      return relX >= descRange[0] && relX <= descRange[1];
    });

    const description = descElements
      .sort((a, b) => a.x - b.x)
      .map((el) => el.text)
      .join(' ')
      .trim()
      .replace(/^[-_\s\:\.\,]+|[-_\s\:\.\,]+$/g, '')
      .trim();

    if (description.length > 1) {
      let reference: string | undefined;
      const zelleMatch = description.match(/Conf#\s*([a-zA-Z0-9]+)/i);
      const achMatch = description.match(/ID:\s*([a-zA-Z0-9]+)/i);
      if (zelleMatch) {
        reference = zelleMatch[1];
      } else if (achMatch) {
        reference = achMatch[1];
      }

      const rawDateStr = dateEl.text.trim();
      const dateVal = parseDateString(rawDateStr);
      if (dateVal) {
        transactions.push({
          date: dateVal,
          description,
          amount,
          reference,
          originalDateStr: rawDateStr,
        });
      }
    }
  }

  return transactions;
}

function extractMetadataWithProfile(fullText: string, profile: BankProfileTyped) {
  let accountNo: string | undefined;
  let openingBalance = 0;
  let closingBalance = 0;

  const meta = profile.config.rules.metadata;

  for (const rule of meta.accountNumber || []) {
    const match = fullText.match(new RegExp(rule.regex, 'i'));
    if (match && match[rule.captureGroup]) {
      accountNo = match[rule.captureGroup].trim().replace(/\s+/g, ' ');
      break;
    }
  }

  for (const rule of meta.initialBalance || []) {
    const match = fullText.match(new RegExp(rule.regex, 'i'));
    if (match && match[rule.captureGroup]) {
      openingBalance = parseAmountWithProfileFormat(
        match[rule.captureGroup].trim(),
        profile.config.numberFormat,
      );
      break;
    }
  }

  for (const rule of meta.finalBalance || []) {
    const match = fullText.match(new RegExp(rule.regex, 'i'));
    if (match && match[rule.captureGroup]) {
      closingBalance = parseAmountWithProfileFormat(
        match[rule.captureGroup].trim(),
        profile.config.numberFormat,
      );
      break;
    }
  }

  return { accountNo, openingBalance, closingBalance };
}

interface ProfileParseResult {
  transactions: ParsedTransaction[];
  accountNo?: string;
  openingBalance: number;
  closingBalance: number;
  mathValid: boolean;
  mismatch: number;
  warnings: string[];
}

function runParseWithProfile(
  linesOfElements: LineOfElements[],
  pageWidth: number,
  fullText: string,
  profile: BankProfileTyped,
): ProfileParseResult {
  const warnings: string[] = [];
  const transactions = parsePDFWithProfile(linesOfElements, pageWidth, profile);
  const { accountNo, openingBalance, closingBalance } = extractMetadataWithProfile(
    fullText,
    profile,
  );

  const meta = profile.config.rules.metadata;
  let initialMatch = false;
  let finalMatch = false;

  for (const rule of meta.initialBalance || []) {
    if (new RegExp(rule.regex, 'i').test(fullText)) {
      initialMatch = true;
      break;
    }
  }
  for (const rule of meta.finalBalance || []) {
    if (new RegExp(rule.regex, 'i').test(fullText)) {
      finalMatch = true;
      break;
    }
  }

  console.log('--- DEBUG RUN PARSE WITH PROFILE ---');
  console.log('Bank Profile:', profile.bankName);
  console.log('Fulltext Sample:', fullText.slice(0, 500));
  console.log('Transactions parsed:', transactions);
  console.log(
    'Metadata Extracted: AccountNo:',
    accountNo,
    'Initial:',
    openingBalance,
    'Final:',
    closingBalance,
  );
  console.log('Initial Match:', initialMatch, 'Final Match:', finalMatch);

  if (!initialMatch || !finalMatch) {
    warnings.push('No se pudo extraer el saldo inicial o final de la configuración del perfil.');
  }

  const mathValidation = validateMathematicalConsistency(
    openingBalance,
    closingBalance,
    transactions,
  );
  console.log('Math Validation:', mathValidation);
  const mathValid =
    !warnings.some((w) => w.includes('No se pudo extraer el saldo')) && mathValidation.valid;
  if (!mathValid && !warnings.some((w) => w.includes('No se pudo extraer el saldo'))) {
    warnings.push(
      `Mathematical mismatch detected: difference $${mathValidation.difference.toFixed(2)}`,
    );
  }
  console.log('Final MathValid:', mathValid, 'Warnings:', warnings);

  return {
    transactions,
    accountNo,
    openingBalance,
    closingBalance,
    mathValid,
    mismatch: mathValidation.difference,
    warnings,
  };
}

// ========== MAIN PARSER ==========
export async function parsePDF(buffer: Buffer, options?: ParseOptions): Promise<ParsedPDFResult> {
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  });

  const pdf = await loadingTask.promise;

  let allElements: PdfElement[] = [];
  const linesOfElements: LineOfElements[] = [];
  let fullText = '';
  let pageWidth = 612;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const items = textContent.items as any[];
    const linesMap = new Map<number, any[]>();

    const viewport = page.getViewport ? page.getViewport({ scale: 1.0 }) : null;
    if (viewport && viewport.width) {
      pageWidth = viewport.width;
    } else if (page.view && page.view[2]) {
      pageWidth = page.view[2];
    }

    for (const item of items) {
      if (!item.str || item.str.trim() === '') continue;
      const y = Math.round(item.transform[5] * 2) / 2;
      if (!linesMap.has(y)) {
        linesMap.set(y, []);
      }
      linesMap.get(y)!.push({
        text: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width || 0,
        height: item.height || 0,
      });
    }

    const sortedY = Array.from(linesMap.keys()).sort((a, b) => b - a);
    let pageText = '';

    for (const y of sortedY) {
      const lineItems = linesMap.get(y)!;
      lineItems.sort((a, b) => a.x - b.x);
      const lineStr = lineItems.map((item) => item.text).join(' ');
      pageText += lineStr + '\n';

      allElements = allElements.concat(lineItems);
      linesOfElements.push({
        y,
        text: lineStr,
        elements: lineItems,
      });
    }

    fullText += pageText + '\n';
  }

  // 1. Extract Period and Base Year
  let startDate = new Date();
  let endDate = new Date();

  const datePatternStr =
    '(?:[A-Za-z]+\\s+\\d{1,2},\\s+\\d{4}|\\d{1,2}[/\\.-]\\d{1,2}[/\\.-]\\d{2,4})';
  const rangeRegex = new RegExp(
    `(${datePatternStr})\\s*(?:to|through|through\\s+the|a|\\-|\\–)\\s*(${datePatternStr})`,
    'i',
  );
  const rangeMatch = fullText.match(rangeRegex);

  if (rangeMatch) {
    const s = parseDateString(rangeMatch[1]);
    const e = parseDateString(rangeMatch[2]);
    if (s) startDate = s;
    if (e) endDate = e;
  } else {
    // Fallback statement boundary matching
    const startBalMatch = fullText.match(
      /(?:Beginning|Starting|Opening|Previous|Saldo inicial|Saldo anterior)\s+balance\s+on\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
    );
    const endBalMatch = fullText.match(
      /(?:Ending|Closing|New|Saldo final)\s+balance\s+on\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
    );
    if (startBalMatch) {
      const s = parseDateString(startBalMatch[1]);
      if (s) startDate = s;
    }
    if (endBalMatch) {
      const e = parseDateString(endBalMatch[1]);
      if (e) endDate = e;
    }
  }

  const firstPageSample = fullText.slice(0, 1000);
  const blocksWithCoordinates = allElements.map((el) => ({
    text: el.text,
    x: el.x,
    y: el.y,
    width: el.width,
    page: 1,
  }));

  const analysisData: PdfAnalysisData = {
    fullText,
    pageWidth,
    blocksWithCoordinates,
    firstPageSample,
  };

  // 2. Try to match active profile by fingerprints (using some to support partial/test statement fingerprints)
  let matchedProfile: BankProfileTyped | null = null;
  try {
    const activeProfiles = await getAllActiveProfiles();
    for (const p of activeProfiles) {
      const anyMatch = p.fingerprints.some((fp) =>
        fullText.toLowerCase().includes(fp.toLowerCase().trim()),
      );
      if (anyMatch) {
        matchedProfile = p;
        break;
      }
    }
  } catch (err) {
    console.error('Error fetching active profiles:', err);
  }

  let transactions: ParsedTransaction[] = [];
  let accountNo: string | undefined;
  let openingBalance = 0;
  let closingBalance = 0;
  let mathValid = false;
  let mismatch = 0;
  let selfHealingAttempted = false;
  let selfHealingSuccess = false;
  const warnings: string[] = [];
  let accountHolder: string | undefined;

  if (matchedProfile) {
    const parseResult = runParseWithProfile(linesOfElements, pageWidth, fullText, matchedProfile);
    transactions = parseResult.transactions;
    accountNo = parseResult.accountNo;
    openingBalance = parseResult.openingBalance;
    closingBalance = parseResult.closingBalance;
    mathValid = parseResult.mathValid;
    mismatch = parseResult.mismatch;
    warnings.push(...parseResult.warnings);

    transactions = reconstructTransactionDates(
      transactions.map((t) => ({
        dateStr: t.originalDateStr || t.date.toISOString(),
        description: t.description,
        amount: t.amount,
        reference: t.reference,
      })),
      startDate,
      endDate,
    );

    const hasBalanceError = warnings.some((w) => w.includes('No se pudo extraer el saldo'));
    if (!mathValid && !hasBalanceError) {
      const cooldownHours = 24;
      const timeSinceLastUpdate = Date.now() - new Date(matchedProfile.updatedAt).getTime();
      const isInCooldown =
        matchedProfile.requiresReview && timeSinceLastUpdate < cooldownHours * 60 * 60 * 1000;

      if (isInCooldown) {
        warnings.push(
          'La reconciliación falló. Esto puede ser un error de origen del PDF o el perfil ya fue re-onboardeado recientemente.',
        );
      } else {
        selfHealingAttempted = true;
        console.log(`🔧 Self-Healing triggered for bank profile ${matchedProfile.bankId}`);

        // No catch: if LLM fails, let it propagate and crash explicitly as requested
        const healedProfile = await createProfileFromPdf(analysisData);
        const healedResult = runParseWithProfile(
          linesOfElements,
          pageWidth,
          fullText,
          healedProfile,
        );

        if (healedResult.mathValid) {
          selfHealingSuccess = true;
          mathValid = true;
          mismatch = healedResult.mismatch;
          transactions = reconstructTransactionDates(
            healedResult.transactions.map((t) => ({
              dateStr: t.originalDateStr || t.date.toISOString(),
              description: t.description,
              amount: t.amount,
              reference: t.reference,
            })),
            startDate,
            endDate,
          );
          accountNo = healedResult.accountNo;
          openingBalance = healedResult.openingBalance;
          closingBalance = healedResult.closingBalance;

          await updateRequiresReviewStatus(healedProfile.bankId, false);
        } else {
          selfHealingSuccess = false;
          // Preserve original mismatch — don't overwrite with failed heal result
          await updateRequiresReviewStatus(healedProfile.bankId, true);
          warnings.push('El Self-Healing no pudo corregir la inconsistencia matemática.');
        }
      }
    }
  } else {
    // Unknown Bank: Invisible Onboarding (propagates error if LLM fails)
    console.log('✨ Unknown bank statement. Triggering invisible onboarding...');
    const inferredProfile = await createProfileFromPdf(analysisData);
    const inferredResult = runParseWithProfile(
      linesOfElements,
      pageWidth,
      fullText,
      inferredProfile,
    );

    transactions = reconstructTransactionDates(
      inferredResult.transactions.map((t) => ({
        dateStr: t.originalDateStr || t.date.toISOString(),
        description: t.description,
        amount: t.amount,
        reference: t.reference,
      })),
      startDate,
      endDate,
    );
    accountNo = inferredResult.accountNo;
    openingBalance = inferredResult.openingBalance;
    closingBalance = inferredResult.closingBalance;
    mathValid = inferredResult.mathValid;
    mismatch = inferredResult.mismatch;
    warnings.push(...inferredResult.warnings);

    if (mathValid) {
      await updateRequiresReviewStatus(inferredProfile.bankId, false);
    } else {
      await updateRequiresReviewStatus(inferredProfile.bankId, true);
      warnings.push('El onboarding inicial resultó en inconsistencia matemática.');
    }
  }

  if (!accountHolder) {
    const isAddressLine = (l: string): boolean => {
      if (!l) return false;
      if (/p\.?o\.?\s*box/i.test(l)) return true;
      if (/\b\d{5}(?:-\d{4})?\b/.test(l)) return true;
      return /\b(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd|highway|hwy|suite|ste|apt|apartment|unit|zip|fl)\b/i.test(
        l,
      );
    };

    const isHeaderOrServiceLine = (l: string): boolean => {
      if (!l) return false;
      if (/\b(?:LLC|INC|CORP|L\.L\.C\.|I\.N\.C\.|CO|CO\.)\b/i.test(l)) return false;
      if (
        /(?:service|information|info\b|phone|hours|contact|support|online|website|mobile|app\b|email|call\b|help\b|customer|client|member)/i.test(
          l,
        )
      )
        return true;
      if (
        /(?:statement|summary|activity|period|date|balance|page\b|checks\b|deposits|withdrawals|fees|interest|ref\b|id\b|transaction)/i.test(
          l,
        )
      )
        return true;
      if (/\b[a-zA-Z0-9.-]+\.(?:com|org|net|edu|gov|us|info|biz)\b/i.test(l)) return true;
      const matchedBank = matchedProfile ? matchedProfile.bankName : 'Bank';
      if (l.toLowerCase().includes(matchedBank.toLowerCase())) return true;
      return /\b(?:\+?1[-. ]?)?\(?[0-9]{3}\)?[-. ]?[0-9]{3}[-. ]?[0-9]{4}\b/.test(l);
    };

    const holderMatch = fullText.match(
      /(?:Account Holder|Account statement for|Name|Client|Titular|Customer Name|Customer\b(?! Service| Support| Info| Phone)|Para|Titular de la cuenta):\s*([^\n\r]+)/i,
    );
    if (holderMatch) {
      const val = holderMatch[1].trim();
      if (!isAddressLine(val) && !isHeaderOrServiceLine(val)) {
        accountHolder = val;
      }
    }
  }

  // Create db audit log if mismatch is detected
  if (!mathValid && options?.companyId && options?.userId) {
    try {
      await db.auditLog.create({
        data: {
          companyId: options.companyId,
          userId: options.userId,
          action: 'PDF_PARSE_MATH_MISMATCH',
          entity: 'BankStatement',
          details: JSON.stringify({
            mismatch,
            fileName: options.fileName || 'unknown.pdf',
            parsedData: {
              openingBalance,
              closingBalance,
            },
          }),
        },
      });
      console.log(`📝 AuditLog created for math mismatch (difference: $${mismatch.toFixed(2)})`);
    } catch (auditErr) {
      console.error('Failed to create audit log for math mismatch:', auditErr);
    }
  }

  return {
    transactions,
    bankName: matchedProfile ? matchedProfile.bankName : undefined,
    accountNo,
    openingBalance,
    closingBalance,
    startDate,
    endDate,
    accountHolder,
    mathValid,
    mismatch,
    selfHealingAttempted,
    selfHealingSuccess,
    warnings,
  };
}

// ========== HELPER PARSERS ==========
function parseDateString(val: string): Date | null {
  const dateStr = val.split(/[T\s]/)[0].trim();

  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(dateStr)) {
    const parts = dateStr.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  const slashMatch = dateStr.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (slashMatch) {
    const a = Number(slashMatch[1]);
    const b = Number(slashMatch[2]);
    let year = Number(slashMatch[3]);
    if (year < 100) {
      year += 2000;
    }

    if (a > 12) return new Date(year, b - 1, a);
    if (b > 12) return new Date(year, a - 1, b);
    return new Date(year, a - 1, b);
  }

  const monthNames = [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec',
  ];
  const textMatch = dateStr.match(/^([a-zA-Z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (textMatch) {
    const monthIdx = monthNames.indexOf(textMatch[1].toLowerCase().slice(0, 3));
    if (monthIdx !== -1) {
      return new Date(Number(textMatch[3]), monthIdx, Number(textMatch[2]));
    }
  }

  const reverseTextMatch = dateStr.match(/^(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})$/);
  if (reverseTextMatch) {
    const monthIdx = monthNames.indexOf(reverseTextMatch[2].toLowerCase().slice(0, 3));
    if (monthIdx !== -1) {
      return new Date(Number(reverseTextMatch[3]), monthIdx, Number(reverseTextMatch[1]));
    }
  }

  const fallback = new Date(val);
  return isNaN(fallback.getTime()) ? null : fallback;
}

function parseAmountString(val: string): number {
  let cleaned = val.replace(/[^0-9.,()+\\-]/g, '');

  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    cleaned = '-' + cleaned.slice(1, -1);
  }

  if (cleaned.includes(',') && cleaned.includes('.')) {
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    if (lastComma > lastDot) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (cleaned.endsWith(',')) {
    cleaned = cleaned.slice(0, -1);
  } else if (cleaned.includes(',') && !cleaned.includes('.')) {
    cleaned = cleaned.replace(',', '.');
  }

  cleaned = cleaned.replace(/(?<!^)-/g, '');

  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}
