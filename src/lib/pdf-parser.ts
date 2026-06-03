import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import path from 'path';
import { pathToFileURL } from 'url';

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

// ========== MAIN PARSER ==========
export async function parsePDF(buffer: Buffer): Promise<ParsedPDFResult> {
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

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const items = textContent.items as any[];
    const linesMap = new Map<number, any[]>();

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

  // 2. Extract Opening and Closing Balances
  let openingBalance = 0;
  let closingBalance = 0;

  const startMatchWithDate = fullText.match(
    new RegExp(
      `(?:Beginning|Starting|Opening|Previous|Saldo inicial|Saldo anterior)\\s+balance\\s+on\\s+(${datePatternStr})\\s+\\$?([0-9,.-]+)`,
      'i',
    ),
  );
  if (startMatchWithDate) {
    openingBalance = parseAmountString(startMatchWithDate[2]);
  } else {
    const startMatchSimple = fullText.match(
      /(?:Beginning|Starting|Opening|Previous|Saldo inicial|Saldo anterior)\s+balance\s+\$?([0-9,.-]+)/i,
    );
    if (startMatchSimple) {
      openingBalance = parseAmountString(startMatchSimple[1]);
    }
  }

  const endMatchWithDate = fullText.match(
    new RegExp(
      `(?:Ending|Closing|New|Saldo final)\\s+balance\\s+on\\s+(${datePatternStr})\\s+\\$?([0-9,.-]+)`,
      'i',
    ),
  );
  if (endMatchWithDate) {
    closingBalance = parseAmountString(endMatchWithDate[2]);
  } else {
    const endMatchSimple = fullText.match(
      /(?:Ending|Closing|New|Saldo final)\s+balance\s+\$?([0-9,.-]+)/i,
    );
    if (endMatchSimple) {
      closingBalance = parseAmountString(endMatchSimple[1]);
    }
  }

  // 3. Amount & Date Columns Coordinate Clustering (Row-constrained)
  const candidateDates: PdfElement[] = [];
  const candidateAmounts: PdfElement[] = [];

  for (const line of linesOfElements) {
    const text = line.text.trim();
    if (!text) continue;

    // Ignore lines with more than one date to filter out summaries and ranges
    const textMatches = line.text.match(new RegExp(DATE_REGEX.source, 'gi'));
    if (textMatches && textMatches.length > 1) {
      continue;
    }

    if (
      /balance/i.test(text) &&
      /(?:beginning|ending|starting|opening|closing|previous|new|saldo)/i.test(text)
    ) {
      continue;
    }
    const isDate = DATE_REGEX.test(text);
    const isAmount = CURRENCY_REGEX.test(text);
    if (isDate && isAmount) {
      const dateEl = line.elements.find((el) => DATE_REGEX.test(el.text.trim()));
      const amountEl = line.elements.find((el) => {
        const clean = el.text.trim();
        return CURRENCY_REGEX.test(clean) && !DATE_REGEX.test(clean);
      });
      if (dateEl && amountEl) {
        candidateDates.push(dateEl);
        candidateAmounts.push(amountEl);
      }
    }
  }

  // Find primary Date Column (the cluster with the absolute majority of candidate transaction dates)
  const dateClusters = clusterDatesByXCoordinate(candidateDates);
  const primaryDateCluster = dateClusters.sort((a, b) => b.elements.length - a.elements.length)[0];

  // Find transaction Amount columns
  const amountClusters = clusterByXCoordinate(candidateAmounts);
  const topology = detectLayoutTopology(amountClusters);

  // 4. Extract Transactions
  const rawTransactions: Array<{
    dateStr: string;
    description: string;
    amount: number;
    reference?: string;
  }> = [];
  let currentSection: 'deposits' | 'withdrawals' | null = null;

  for (const line of linesOfElements) {
    const text = line.text.trim();
    if (!text) continue;

    // Ignore lines with more than one date to filter out summaries and ranges
    const textMatches = line.text.match(new RegExp(DATE_REGEX.source, 'gi'));
    if (textMatches && textMatches.length > 1) {
      continue;
    }

    // Detect section headers
    const isDate = DATE_REGEX.test(text);
    if (!isDate) {
      const lower = text.toLowerCase();
      const isDepositSection = COLUMN_KEYWORDS.credit.some((kw) => lower.includes(kw));
      const isWithdrawalSection = COLUMN_KEYWORDS.debit.some((kw) => lower.includes(kw));

      if (isDepositSection && !isWithdrawalSection) {
        currentSection = 'deposits';
      } else if (isWithdrawalSection && !isDepositSection) {
        currentSection = 'withdrawals';
      }

      if (lower.includes('- continued') || lower.includes('– continued')) {
        continue;
      }
    }

    // Skip summary lines
    if (
      /balance/i.test(text) &&
      /(?:beginning|ending|starting|opening|closing|previous|new|saldo)/i.test(text)
    ) {
      continue;
    }

    const dateMatch = text.match(DATE_REGEX);
    const amountMatch = text.match(CURRENCY_REGEX);

    if (dateMatch && amountMatch) {
      const matchedDateStr = dateMatch[1];
      const matchedAmountStr = amountMatch[1];

      // Find actual transaction elements
      const dateEl = line.elements.find((el) => DATE_REGEX.test(el.text.trim()));
      const amountEl = line.elements.find((el) => {
        const clean = el.text.trim();
        return CURRENCY_REGEX.test(clean) && !DATE_REGEX.test(clean);
      });

      if (dateEl && amountEl && primaryDateCluster) {
        // Strict double-geometric validation: Date must align, Amount must align
        const dateAligns = Math.abs(dateEl.x - primaryDateCluster.centerX) <= CLUSTER_TOLERANCE_PX;
        let amountAligns = false;

        if (topology.type === 'DUAL_AMOUNT_COLUMN') {
          const rightX = amountEl.x + amountEl.width;
          const distToDebit = topology.debitCluster
            ? Math.abs(rightX - topology.debitCluster.rightX)
            : Infinity;
          const distToCredit = topology.creditCluster
            ? Math.abs(rightX - topology.creditCluster.rightX)
            : Infinity;
          amountAligns =
            distToDebit <= CLUSTER_TOLERANCE_PX || distToCredit <= CLUSTER_TOLERANCE_PX;
        } else if (topology.type === 'SINGLE_AMOUNT_COLUMN' && topology.amountCluster) {
          const rightX = amountEl.x + amountEl.width;
          amountAligns = Math.abs(rightX - topology.amountCluster.rightX) <= CLUSTER_TOLERANCE_PX;
        }

        if (!dateAligns || !amountAligns) {
          // Reject elements that don't belong to the visual transaction table
          continue;
        }

        const dateIndex = text.indexOf(matchedDateStr);
        const amountIndex = text.lastIndexOf(matchedAmountStr);

        if (
          dateIndex !== -1 &&
          amountIndex !== -1 &&
          amountIndex > dateIndex + matchedDateStr.length
        ) {
          const descRaw = text.substring(dateIndex + matchedDateStr.length, amountIndex).trim();
          const description = descRaw.replace(/^[-_\s\:\.\,]+|[-_\s\:\.\,]+$/g, '').trim();

          if (description.length > 1) {
            let amount = parseAmountString(matchedAmountStr);

            // Apply direction based on layout topology or section keywords
            if (topology.type === 'DUAL_AMOUNT_COLUMN') {
              const rightX = amountEl.x + amountEl.width;
              const distToDebit = topology.debitCluster
                ? Math.abs(rightX - topology.debitCluster.rightX)
                : Infinity;
              const distToCredit = topology.creditCluster
                ? Math.abs(rightX - topology.creditCluster.rightX)
                : Infinity;

              if (distToDebit < distToCredit) {
                amount = -Math.abs(amount);
              } else {
                amount = Math.abs(amount);
              }
            } else {
              if (currentSection === 'withdrawals' && amount > 0) {
                amount = -amount;
              } else if (currentSection === 'deposits' && amount < 0) {
                amount = Math.abs(amount);
              }
            }

            let reference: string | undefined;
            const zelleMatch = description.match(/Conf#\s*([a-zA-Z0-9]+)/i);
            const achMatch = description.match(/ID:\s*([a-zA-Z0-9]+)/i);
            if (zelleMatch) {
              reference = zelleMatch[1];
            } else if (achMatch) {
              reference = achMatch[1];
            }

            rawTransactions.push({
              dateStr: matchedDateStr,
              description,
              amount,
              reference,
            });
          }
        }
      }
    }
  }

  // 5. Reconstruct Dates with Year
  const transactions = reconstructTransactionDates(rawTransactions, startDate, endDate);

  // 6. Mathematical validation
  const mathValidation = validateMathematicalConsistency(
    openingBalance,
    closingBalance,
    transactions,
  );
  if (!mathValidation.valid) {
    console.warn(
      `⚠️ Mathematical mismatch detected: difference $${mathValidation.difference.toFixed(2)}`,
    );
  }

  // Detect bank name agnostically
  let bankName: string | undefined;
  const bankMatch = fullText.match(/^([A-Za-z0-9\s]+?),\s*N\.A\./m);
  if (bankMatch) {
    bankName = bankMatch[1].trim();
  }

  // Extract account number agnostically
  let accountNo: string | undefined;
  const accMatch = fullText.match(
    /(?:Account number|Account\s*#|Account\s*no\.?|Account\s*Number|Numero de cuenta):\s*([0-9\s\-]+)/i,
  );
  if (accMatch) {
    accountNo = accMatch[1].trim().replace(/\s+/g, ' ');
  }

  // Extract account holder agnostically
  let accountHolder: string | undefined;
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
    if (bankName && l.toLowerCase().includes(bankName.toLowerCase())) return true;
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

  if (!accountHolder) {
    const lines = fullText.split('\n');
    const potentialLines = lines
      .map((l) => l.trim())
      .filter((l) => {
        if (l.length <= 3) return false;
        if (/Page|Statement|Date|Balance|Amount|Description/i.test(l)) return false;
        if (isAddressLine(l)) return false;
        if (isHeaderOrServiceLine(l)) return false;
        return true;
      });
    if (potentialLines.length > 0) {
      accountHolder = potentialLines[0];
    }
  }

  return {
    transactions,
    bankName,
    accountNo,
    openingBalance,
    closingBalance,
    startDate,
    endDate,
    accountHolder,
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
