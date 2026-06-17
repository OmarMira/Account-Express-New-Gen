'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Send,
  Bot,
  Sparkles,
  MessageSquare,
  FilePlus2,
  Loader2,
  Save,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuthStore } from '@/store/auth-store';
import { useLanguageStore } from '@/store/language-store';
import { cn } from '@/lib/utils';

/* ─── Types ───────────────────────────────────────────────────────── */
type AssistantMode = 'chat' | 'create-rule';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ConditionV2 {
  field: 'description' | 'amount';
  operator: 'contains' | 'starts_with' | 'ends_with' | 'equals' | 'amount_greater' | 'amount_less';
  value: string | number;
}

interface ParsedRule {
  name: string;
  conditions: ConditionV2[];
  transactionDirection: string;
  glAccountName?: string | null;
  debitGlAccountName?: string | null;
  creditGlAccountName?: string | null;
  priority: number;
  // Legacy V1 fields (kept for backwards compat)
  conditionType?: string;
  conditionValue?: string;
  // Confidence/reasoning fields (from PR 2)
  confidence?: number;
  confidenceLabel?: 'high' | 'medium' | 'low';
  explanation?: string;
  uncertaintyReasons?: string[];
}

interface HistoryEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/* ─── Animation Variants ──────────────────────────────────────────── */
const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
} as const;

const modalVariants = {
  hidden: { opacity: 0, scale: 0.92, y: 20 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 300, damping: 30 },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 10,
    transition: { duration: 0.15 },
  },
} as const;

const messageVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2 } },
} as const;

/* ─── Component ───────────────────────────────────────────────────── */
export function AIAssistantModal() {
  const t = useLanguageStore((s) => s.t);
  const activeCompany = useAuthStore((s) => s.activeCompany);
  const aiAssistantOpen = useAuthStore((s) => s.aiAssistantOpen);
  const setAiAssistantOpen = useAuthStore((s) => s.setAiAssistantOpen);

  const [mode, setMode] = useState<AssistantMode>('chat');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [ruleInput, setRuleInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [parsedRule, setParsedRule] = useState<ParsedRule | null>(null);
  const [ruleReply, setRuleReply] = useState('');
  const [error, setError] = useState('');

  // Conversational rule builder state
  const [ruleMessages, setRuleMessages] = useState<ChatMessage[]>([]);
  const [ruleHistory, setRuleHistory] = useState<HistoryEntry[]>([]);
  const [ruleIsComplete, setRuleIsComplete] = useState(false);

  // Interactive Account Creation Wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardCode, setWizardCode] = useState('');
  const [wizardName, setWizardName] = useState('');
  const [wizardParentId, setWizardParentId] = useState('');

  // List of accounts for form selectors
  const [accounts, setAccounts] = useState<{ id: string; name: string; code: string }[]>([]);

  // Fetch accounts on assistant mount / open
  useEffect(() => {
    if (aiAssistantOpen && activeCompany) {
      fetch(`/api/accounts?companyId=${activeCompany.id}`)
        .then((res) => {
          if (!res.ok) throw new Error();
          return res.json();
        })
        .then((data) => {
          const accs = data.accounts ?? data.data ?? data ?? [];
          setAccounts(accs);
        })
        .catch(() => {});
    }
  }, [aiAssistantOpen, activeCompany]);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const ruleInputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll chat messages
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, wizardOpen]);

  // Reset to chat mode and clear history when opening
  useEffect(() => {
    if (aiAssistantOpen) {
      setMode('chat');
      setError('');
      setChatMessages([]);
      setChatInput('');
      setRuleInput('');
      setRuleReply('');
      setParsedRule(null);
      setRuleMessages([]);
      setRuleHistory([]);
      setRuleIsComplete(false);
      setWizardOpen(false);
      setWizardCode('');
      setWizardName('');
      setWizardParentId('');

      // Background LLM warmup call to wake up the serverless/API connection
      if (activeCompany) {
        fetch('/api/ai-assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: 'Hola',
            mode: 'chat',
            companyId: activeCompany.id,
            isWarmup: true,
          }),
        }).catch(() => {});
      }

      setTimeout(() => {
        chatInputRef.current?.focus();
      }, 300);
    }
  }, [aiAssistantOpen, activeCompany]);

  const handleStartWizard = async () => {
    if (!activeCompany) return;
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/accounts?companyId=${activeCompany.id}`);
      if (!res.ok) throw new Error('Error al obtener el plan de cuentas');
      const data = await res.json();
      const accounts = data.accounts ?? [];

      // Find cash & cash equivalents (parent account "1010")
      const parentAcc = accounts.find((a: { code: string; id: string }) => a.code === '1010');
      if (!parentAcc) {
        throw new Error('No se encontró la cuenta base "1010 - Cash & Cash Equivalents"');
      }
      setWizardParentId(parentAcc.id);

      // Find sub-accounts of 1010 or starting with 101
      const subAccounts = accounts.filter(
        (a: { parentId: string; code: string }) => a.parentId === parentAcc.id || (a.code.startsWith('101') && a.code !== '1010'),
      );
      let nextCode = 1011;
      const codes = subAccounts.map((a: { code: string }) => parseInt(a.code, 10)).filter((c: number) => !isNaN(c));
      if (codes.length > 0) {
        nextCode = Math.max(...codes) + 1;
      }
      setWizardCode(String(nextCode));
      setWizardName('Banco Chase - Corriente 1234');
      setWizardOpen(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveWizardAccount = async () => {
    if (!wizardCode || !wizardName || !activeCompany) return;
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: activeCompany.id,
          code: wizardCode.trim(),
          name: wizardName.trim(),
          accountType: 'asset',
          normalBalance: 'debit',
          parentId: wizardParentId || null,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'No se pudo crear la cuenta contable');
      }

      setWizardOpen(false);

      const successMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `✅ ¡Listo! He creado la cuenta contable **"${wizardCode} - ${wizardName}"** de tipo Activo (Deudor) bajo **"1010 - Cash & Cash Equivalents"** en tu Plan de Cuentas.`,
        timestamp: new Date(),
      };
      setChatMessages((prev) => [...prev, successMsg]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && aiAssistantOpen) {
        setAiAssistantOpen(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [aiAssistantOpen, setAiAssistantOpen]);

  /* ─── Chat Submit ─────────────────────────────────────────────── */
  const handleChatSubmit = useCallback(async () => {
    const trimmed = chatInput.trim();
    if (!trimmed || isLoading) return;

    setError('');
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/ai-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, mode: 'chat', companyId: activeCompany?.id }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || t('aiAssistant.error'));
        return;
      }

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.reply || '...',
        timestamp: new Date(),
      };
      setChatMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setError(t('aiAssistant.error'));
    } finally {
      setIsLoading(false);
      chatInputRef.current?.focus();
    }
  }, [chatInput, isLoading, t, activeCompany]);

  /* ─── Rule Submit (conversational) ───────────────────────────── */
  const handleRuleSubmit = useCallback(async () => {
    const trimmed = ruleInput.trim();
    if (!trimmed || isLoading) return;

    setError('');
    setIsLoading(true);

    // Add user message to conversation
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    };
    setRuleMessages((prev) => [...prev, userMsg]);
    setRuleInput('');

    // Build updated history
    const updatedHistory: HistoryEntry[] = [...ruleHistory, { role: 'user', content: trimmed }];

    try {
      const res = await fetch('/api/ai-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          mode: 'create-rule',
          companyId: activeCompany?.id,
          history: ruleHistory, // send previous history (not including this message, backend appends it)
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || t('aiAssistant.error'));
        setIsLoading(false);
        return;
      }

      const assistantContent = data.reply || '...';
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: assistantContent,
        timestamp: new Date(),
      };
      setRuleMessages((prev) => [...prev, assistantMsg]);

      // Update history with both turns
      const assistantContentForHistory = data.rawJson || assistantContent;
      const newHistory: HistoryEntry[] = [
        ...updatedHistory,
        { role: 'assistant', content: assistantContentForHistory },
      ];
      setRuleHistory(newHistory);

      // Handle isComplete
      if (data.isComplete && data.parsedRule) {
        setParsedRule(data.parsedRule);
        setRuleIsComplete(true);
      } else {
        setParsedRule(null);
        setRuleIsComplete(false);
      }
    } catch {
      setError(t('aiAssistant.error'));
    } finally {
      setIsLoading(false);
    }
  }, [ruleInput, isLoading, t, activeCompany, ruleHistory]);

  /* ─── Save Rule (V2) ──────────────────────────────────────────── */
  const handleSaveRule = useCallback(async () => {
    if (!parsedRule || !activeCompany) return;

    setIsLoading(true);
    setError('');

    try {
      const accountsRes = await fetch(`/api/accounts?companyId=${activeCompany.id}`);
      if (!accountsRes.ok) {
        setError(t('aiAssistant.error'));
        setIsLoading(false);
        return;
      }

      const accountsData = await accountsRes.json();
      const accounts: { id: string; name: string }[] =
        accountsData.accounts ?? accountsData.data ?? accountsData ?? [];

      const findAccount = (name: string) =>
        accounts.find((a) => a.name.toLowerCase() === name.toLowerCase());

      // Resolve GL account IDs
      let glAccountId: string | undefined;
      let debitGlAccountId: string | undefined;
      let creditGlAccountId: string | undefined;

      if (parsedRule.glAccountName) {
        const acc = findAccount(parsedRule.glAccountName);
        if (!acc) {
          setError(`No se encontró la cuenta "${parsedRule.glAccountName}".`);
          setIsLoading(false);
          return;
        }
        glAccountId = acc.id;
      }

      if (parsedRule.debitGlAccountName) {
        const acc = findAccount(parsedRule.debitGlAccountName);
        if (!acc) {
          setError(`No se encontró la cuenta de débito "${parsedRule.debitGlAccountName}".`);
          setIsLoading(false);
          return;
        }
        debitGlAccountId = acc.id;
      }

      if (parsedRule.creditGlAccountName) {
        const acc = findAccount(parsedRule.creditGlAccountName);
        if (!acc) {
          setError(`No se encontró la cuenta de crédito "${parsedRule.creditGlAccountName}".`);
          setIsLoading(false);
          return;
        }
        creditGlAccountId = acc.id;
      }

      // Build conditions for V2 (use first condition for legacy fields as fallback)
      const firstCondition = parsedRule.conditions?.[0];

      const ruleRes = await fetch('/api/bank-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: activeCompany.id,
          name: parsedRule.name,
          // V2 fields
          conditions: parsedRule.conditions,
          debitGlAccountId,
          creditGlAccountId,
          // Legacy / fallback
          conditionType: parsedRule.conditionType ?? firstCondition?.operator ?? 'contains',
          conditionValue: parsedRule.conditionValue ?? String(firstCondition?.value ?? ''),
          transactionDirection: parsedRule.transactionDirection,
          glAccountId: glAccountId ?? debitGlAccountId ?? creditGlAccountId,
          priority: parsedRule.priority,
          isActive: true,
        }),
      });

      if (ruleRes.ok || ruleRes.status === 201) {
        const successMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `✅ ¡Regla "${parsedRule.name}" creada exitosamente! Ya está activa y clasificará transacciones automáticamente.`,
          timestamp: new Date(),
        };
        setRuleMessages((prev) => [...prev, successMsg]);
        setParsedRule(null);
        setRuleIsComplete(false);
        setRuleHistory([]);
      } else {
        const errData = await ruleRes.json();
        let errorMsg = errData.error || t('aiAssistant.error');
        if (errorMsg === 'A rule with identical conditions and direction already exists.') {
          errorMsg = t('bankRules.duplicateRuleError');
        }
        setError(errorMsg);
      }
    } catch {
      setError(t('aiAssistant.error'));
    } finally {
      setIsLoading(false);
    }
  }, [parsedRule, activeCompany, t]);

  /* ─── Key Handlers ────────────────────────────────────────────── */
  const handleChatKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleChatSubmit();
    }
  };

  const handleRuleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleRuleSubmit();
    }
  };

  /* ─── Render ──────────────────────────────────────────────────── */
  return (
    <AnimatePresence>
      {aiAssistantOpen && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          variants={overlayVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setAiAssistantOpen(false)}
          />

          {/* Modal */}
          <motion.div
            className="relative z-10 flex w-[90%] max-w-4xl max-h-[90vh] h-[800px] flex-col overflow-hidden rounded-2xl shadow-2xl"
            style={{ backgroundColor: '#1a2332' }}
            variants={modalVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ── Header ── */}
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-purple-600/20">
                  <Sparkles className="size-5 text-purple-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">{t('aiAssistant.title')}</h2>
                  <p className="text-xs text-slate-400">
                    {activeCompany?.legalName ?? 'AccountExpress'}{' '}
                    <span className="text-slate-500">·</span>{' '}
                    <span className="text-slate-500">{activeCompany?.taxId ?? ''}</span>
                  </p>
                </div>
              </div>

              {/* Mode Tabs */}
              <div className="flex items-center gap-2">
                <div className="flex rounded-lg bg-white/5 p-1">
                  <button
                    onClick={() => {
                      setMode('chat');
                      setError('');
                    }}
                    onDoubleClick={() => {
                      setMode('chat');
                      setError('');
                      setChatMessages([]);
                      setChatInput('');
                    }}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      mode === 'chat'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white',
                    )}
                  >
                    <MessageSquare className="size-3.5" />
                    <span className="hidden sm:inline">{t('aiAssistant.chat')}</span>
                  </button>
                  <button
                    onClick={() => {
                      setMode('create-rule');
                      setError('');
                      setTimeout(() => ruleInputRef.current?.focus(), 100);
                    }}
                    onDoubleClick={() => {
                      setMode('create-rule');
                      setError('');
                      setRuleInput('');
                      setRuleReply('');
                      setParsedRule(null);
                      setRuleMessages([]);
                      setRuleHistory([]);
                      setRuleIsComplete(false);
                      setTimeout(() => ruleInputRef.current?.focus(), 100);
                    }}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      mode === 'create-rule'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white',
                    )}
                  >
                    <FilePlus2 className="size-3.5" />
                    <span className="hidden sm:inline">{t('aiAssistant.createRule')}</span>
                  </button>
                </div>

                <button
                  onClick={() => setAiAssistantOpen(false)}
                  className="ml-2 flex size-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X className="size-5" />
                </button>
              </div>
            </div>

            {/* ── Content ── */}
            <div className="flex flex-1 flex-col overflow-hidden">
              {mode === 'chat' ? (
                <ChatView
                  messages={chatMessages}
                  isLoading={isLoading}
                  error={error}
                  chatInput={chatInput}
                  setChatInput={setChatInput}
                  handleChatSubmit={handleChatSubmit}
                  handleChatKeyDown={handleChatKeyDown}
                  chatScrollRef={chatScrollRef}
                  chatInputRef={chatInputRef}
                  t={t}
                  handleStartWizard={handleStartWizard}
                  wizardOpen={wizardOpen}
                  setWizardOpen={setWizardOpen}
                  wizardCode={wizardCode}
                  setWizardCode={setWizardCode}
                  wizardName={wizardName}
                  setWizardName={setWizardName}
                  handleSaveWizardAccount={handleSaveWizardAccount}
                />
              ) : (
                <RuleView
                  isLoading={isLoading}
                  error={error}
                  ruleInput={ruleInput}
                  setRuleInput={setRuleInput}
                  handleRuleSubmit={handleRuleSubmit}
                  handleRuleKeyDown={handleRuleKeyDown}
                  ruleInputRef={ruleInputRef}
                  parsedRule={parsedRule}
                  setParsedRule={setParsedRule}
                  accounts={accounts}
                  ruleMessages={ruleMessages}
                  ruleIsComplete={ruleIsComplete}
                  handleSaveRule={handleSaveRule}
                  t={t}
                />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ─── Chat View ───────────────────────────────────────────────────── */
function ChatView({
  messages,
  isLoading,
  error,
  chatInput,
  setChatInput,
  handleChatSubmit,
  handleChatKeyDown,
  chatScrollRef,
  chatInputRef,
  t,
  handleStartWizard,
  wizardOpen,
  setWizardOpen,
  wizardCode,
  setWizardCode,
  wizardName,
  setWizardName,
  handleSaveWizardAccount,
}: {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string;
  chatInput: string;
  setChatInput: (v: string) => void;
  handleChatSubmit: () => void;
  handleChatKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  chatScrollRef: React.RefObject<HTMLDivElement | null>;
  chatInputRef: React.RefObject<HTMLTextAreaElement | null>;
  t: (key: string) => string;
  handleStartWizard: () => Promise<void>;
  wizardOpen: boolean;
  setWizardOpen: (v: boolean) => void;
  wizardCode: string;
  setWizardCode: (v: string) => void;
  wizardName: string;
  setWizardName: (v: string) => void;
  handleSaveWizardAccount: () => Promise<void>;
}) {
  const hasMessages = messages.length > 0;
  const setCurrentView = useAuthStore((s) => s.setCurrentView);
  const setAiAssistantOpen = useAuthStore((s) => s.setAiAssistantOpen);

  function parseMessageContent(text: string) {
    let parsed = text.replace('[Te ayudo a crearla](action:create-account)', '').trim();
    const parts = [];
    const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(parsed)) !== null) {
      if (match.index > lastIndex) {
        parts.push(parsed.substring(lastIndex, match.index));
      }
      const label = match[1];
      const url = match[2];
      
      if (url.startsWith('/')) {
          let viewPath = url.split('?')[0].replace('/', '');
          if (viewPath === 'bank-transactions') viewPath = 'reconciliation';
          if (viewPath === 'transactions') viewPath = 'reconciliation';
          
          parts.push(
            <a key={match.index} onClick={(e) => { 
                e.preventDefault(); 
                window.history.pushState({}, '', url); 
                setCurrentView(viewPath as any); 
                setAiAssistantOpen(false); 
              }} 
              className="underline text-blue-300 hover:text-blue-100 font-medium transition-colors cursor-pointer">
              {label}
            </a>
          );
      } else {
          parts.push(
            <a href={url} key={match.index} className="underline text-blue-300 hover:text-blue-100 font-medium transition-colors cursor-pointer" target="_blank" rel="noopener noreferrer">
              {label}
            </a>
          );
      }
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < parsed.length) {
      parts.push(parsed.substring(lastIndex));
    }
    return parts.length > 0 ? parts : parsed;
  }

  return (
    <>
      {/* Chat Messages or Welcome */}
      <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-6 py-4">
        {hasMessages ? (
          <div className="space-y-4">
            <AnimatePresence>
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  variants={messageVariants}
                  initial="hidden"
                  animate="visible"
                  className={cn(
                    'flex gap-3',
                    msg.role === 'user' ? 'justify-end' : 'justify-start',
                  )}
                >
                  {msg.role === 'assistant' && (
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-600/20 mt-0.5">
                      <Bot className="size-4 text-blue-400" />
                    </div>
                  )}
                  <div className="flex flex-col gap-2 max-w-[80%]">
                    <div
                      className={cn(
                        'rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap',
                        msg.role === 'user'
                          ? 'bg-blue-600 text-white rounded-br-md'
                          : 'bg-white/10 text-slate-200 rounded-bl-md',
                      )}
                    >
                      {parseMessageContent(msg.content)}
                    </div>
                    {msg.role === 'assistant' && msg.content.includes('action:create-account') && (
                      <Button
                        size="sm"
                        onClick={handleStartWizard}
                        className="self-start mt-1 bg-blue-600 hover:bg-blue-500 text-white gap-1 text-xs px-3 py-1.5 rounded-lg shadow-md font-semibold border border-blue-500/30"
                      >
                        <Sparkles className="size-3.5" />
                        Te ayudo a crearla
                      </Button>
                    )}
                  </div>
                  {msg.role === 'user' && (
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-purple-600/20 mt-0.5">
                      <Sparkles className="size-4 text-purple-400" />
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Inline Bank Account Creation Wizard */}
            {wizardOpen && (
              <motion.div
                initial={{ opacity: 0, y: 12, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className="p-4 rounded-xl bg-slate-800/90 border border-blue-500/40 shadow-xl space-y-4 max-w-sm ml-11 backdrop-blur-sm"
              >
                <div className="flex items-center gap-2 text-blue-400 font-semibold text-xs">
                  <Sparkles className="size-4 animate-pulse text-blue-300" />
                  <span>Asistente de Cuenta Contable</span>
                </div>

                <div className="space-y-3 text-xs">
                  <div className="space-y-1">
                    <label className="text-slate-400 font-medium">Código de Cuenta:</label>
                    <Input
                      value={wizardCode}
                      onChange={(e) => setWizardCode(e.target.value)}
                      placeholder="Ej. 1011"
                      className="bg-slate-900 border-white/10 text-white text-xs h-8 focus:ring-blue-500/50"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-slate-400 font-medium">Nombre de Cuenta:</label>
                    <Input
                      value={wizardName}
                      onChange={(e) => setWizardName(e.target.value)}
                      placeholder="Ej. Banco Chase - Corriente 1234"
                      className="bg-slate-900 border-white/10 text-white text-xs h-8 focus:ring-blue-500/50"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-400 bg-white/5 p-2 rounded-lg border border-white/5">
                    <div>
                      <span className="font-semibold block text-slate-500">TIPO:</span> Activo
                      (Asset)
                    </div>
                    <div>
                      <span className="font-semibold block text-slate-500">SALDO NORMAL:</span>{' '}
                      Débito
                    </div>
                    <div className="col-span-2">
                      <span className="font-semibold block text-slate-500">CUENTA PADRE:</span> 1010
                      - Cash & Cash Equivalents
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setWizardOpen(false)}
                    className="flex-1 text-xs border-white/10 hover:bg-white/5 text-slate-300 h-8"
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveWizardAccount}
                    disabled={!wizardCode.trim() || !wizardName.trim()}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-xs h-8"
                  >
                    Crear Cuenta
                  </Button>
                </div>
              </motion.div>
            )}

            {isLoading && !wizardOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-3"
              >
                <div className="flex size-8 items-center justify-center rounded-lg bg-blue-600/20">
                  <Bot className="size-4 text-blue-400" />
                </div>
                <div className="flex items-center gap-1 rounded-2xl bg-white/10 px-4 py-3 rounded-bl-md">
                  <span className="size-2 rounded-full bg-blue-400 animate-bounce [animation-delay:-0.3s]" />
                  <span className="size-2 rounded-full bg-blue-400 animate-bounce [animation-delay:-0.15s]" />
                  <span className="size-2 rounded-full bg-blue-400 animate-bounce" />
                </div>
              </motion.div>
            )}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 py-12">
            <div className="flex size-20 items-center justify-center rounded-2xl bg-blue-600/15 shadow-lg shadow-blue-500/10">
              <Bot className="size-10 text-blue-400" />
            </div>
            <div className="text-center">
              <p className="text-lg font-medium text-white">{t('aiAssistant.greeting')}</p>
              <p className="mt-1 text-sm text-slate-400">{t('aiAssistant.subtitle')}</p>
            </div>
          </div>
        )}
      </div>

      {/* Error Banner */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="px-6"
          >
            <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-300">
              <AlertCircle className="size-4 shrink-0" />
              {error}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input Area */}
      <div className="border-t border-white/10 px-4 py-3 sm:px-6">
        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              ref={chatInputRef}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={handleChatKeyDown}
              placeholder={t('aiAssistant.inputPlaceholder')}
              rows={1}
              className="w-full resize-none rounded-xl bg-white/5 border border-white/10 px-4 py-3 pr-12 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
              style={{ maxHeight: '120px' }}
              onInput={(e) => {
                const el = e.target as HTMLTextAreaElement;
                el.style.height = 'auto';
                el.style.height = Math.min(el.scrollHeight, 120) + 'px';
              }}
            />
            <Button
              size="icon"
              onClick={handleChatSubmit}
              disabled={!chatInput.trim() || isLoading}
              className="absolute right-2 bottom-2 size-8 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-30 text-white"
            >
              <Send className="size-4" />
            </Button>
          </div>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-slate-500">
          {t('aiAssistant.shiftEnterHint')}
        </p>
      </div>
    </>
  );
}

/* ─── Rule View ───────────────────────────────────────────────────── */
function RuleView({
  isLoading,
  error,
  ruleInput,
  setRuleInput,
  handleRuleSubmit,
  handleRuleKeyDown,
  ruleInputRef,
  parsedRule,
  setParsedRule,
  accounts,
  ruleMessages,
  ruleIsComplete,
  handleSaveRule,
  t,
}: {
  isLoading: boolean;
  error: string;
  ruleInput: string;
  setRuleInput: (v: string) => void;
  handleRuleSubmit: () => void;
  handleRuleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  ruleInputRef: React.RefObject<HTMLTextAreaElement | null>;
  parsedRule: ParsedRule | null;
  setParsedRule: React.Dispatch<React.SetStateAction<ParsedRule | null>>;
  accounts: { id: string; name: string; code: string }[];
  ruleMessages: ChatMessage[];
  ruleIsComplete: boolean;
  handleSaveRule: () => void;
  t: (key: string) => string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [ruleMessages, parsedRule, isLoading]);

  const hasMessages = ruleMessages.length > 0;

  return (
    <>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
        {hasMessages ? (
          <div className="space-y-4">
            <AnimatePresence>
              {ruleMessages.map((msg) => (
                <motion.div
                  key={msg.id}
                  variants={messageVariants}
                  initial="hidden"
                  animate="visible"
                  className={cn(
                    'flex gap-3',
                    msg.role === 'user' ? 'justify-end' : 'justify-start',
                  )}
                >
                  {msg.role === 'assistant' && (
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-600/20 mt-0.5">
                      <Bot className="size-4 text-blue-400" />
                    </div>
                  )}
                  <div
                    className={cn(
                      'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap',
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white rounded-br-md'
                        : 'bg-white/10 text-slate-200 rounded-bl-md',
                    )}
                  >
                    {msg.content}
                  </div>
                  {msg.role === 'user' && (
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-purple-600/20 mt-0.5">
                      <Sparkles className="size-4 text-purple-400" />
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Loading indicator */}
            {isLoading && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-3"
              >
                <div className="flex size-8 items-center justify-center rounded-lg bg-blue-600/20">
                  <Bot className="size-4 text-blue-400" />
                </div>
                <div className="flex items-center gap-1 rounded-2xl bg-white/10 px-4 py-3 rounded-bl-md">
                  <span className="size-2 rounded-full bg-blue-400 animate-bounce [animation-delay:-0.3s]" />
                  <span className="size-2 rounded-full bg-blue-400 animate-bounce [animation-delay:-0.15s]" />
                  <span className="size-2 rounded-full bg-blue-400 animate-bounce" />
                </div>
              </motion.div>
            )}

            {/* Parsed Rule Card — only when complete */}
            {ruleIsComplete && parsedRule && !isLoading && (
              <motion.div
                initial={{ opacity: 0, y: 12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: 'spring', stiffness: 250, damping: 25 }}
                className="rounded-xl bg-white/5 border border-emerald-500/30 overflow-hidden ml-11"
              >
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                  <h4 className="text-sm font-semibold text-emerald-400 flex items-center gap-2">
                    <Sparkles className="size-4" />
                    {t('aiAssistant.parsedRule')}
                  </h4>
                  <div className="flex items-center gap-2">
                    {parsedRule.confidence !== undefined && (
                      <Badge
                        variant={
                          parsedRule.confidence >= 0.8 ? 'default' :
                          parsedRule.confidence >= 0.5 ? 'secondary' :
                          'destructive'
                        }
                        className="text-[10px]"
                      >
                        {parsedRule.confidence >= 0.8
                          ? t('ruleBuilder.highConfidence')
                          : parsedRule.confidence >= 0.5
                            ? t('ruleBuilder.mediumConfidence')
                            : t('ruleBuilder.lowConfidence')}
                      </Badge>
                    )}
                    <Badge className="bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border-emerald-500/30">
                      Listo
                    </Badge>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 p-4">
                  {/* Name */}
                  <div className="space-y-1">
                    <Label
                      htmlFor="parsed-rule-name"
                      className="text-[11px] font-medium uppercase tracking-wider text-slate-400"
                    >
                      Nombre
                    </Label>
                    <Input
                      id="parsed-rule-name"
                      value={parsedRule.name}
                      onChange={(e) => setParsedRule({ ...parsedRule, name: e.target.value })}
                      className="bg-slate-900/40 border-white/10 text-white text-xs h-8 focus:ring-emerald-500/50"
                    />
                  </div>

                  {/* Direction */}
                  <div className="space-y-1">
                    <Label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                      Dirección
                    </Label>
                    <Select
                      value={parsedRule.transactionDirection}
                      onValueChange={(val) =>
                        setParsedRule({ ...parsedRule, transactionDirection: val })
                      }
                    >
                      <SelectTrigger className="bg-slate-900/40 border-white/10 text-white text-xs h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-white/10 text-white text-xs">
                        <SelectItem value="any">Cualquiera</SelectItem>
                        <SelectItem value="debit">Débito</SelectItem>
                        <SelectItem value="credit">Crédito</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Conditions */}
                  {parsedRule.conditions?.map((c, i) => (
                    <div
                      key={i}
                      className="col-span-2 grid grid-cols-2 gap-3 border-t border-white/5 pt-3 mt-1"
                    >
                      <div className="space-y-1">
                        <Label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                          Condición {parsedRule.conditions.length > 1 ? i + 1 : ''} (Tipo)
                        </Label>
                        <Select
                          value={c.operator}
                          onValueChange={(val: string) => {
                            const updated = [...parsedRule.conditions];
                            updated[i] = { ...updated[i], operator: val as ConditionV2['operator'] };
                            setParsedRule({ ...parsedRule, conditions: updated });
                          }}
                        >
                          <SelectTrigger className="bg-slate-900/40 border-white/10 text-white text-xs h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-slate-900 border-white/10 text-white text-xs">
                            <SelectItem value="contains">Contiene</SelectItem>
                            <SelectItem value="starts_with">Empieza con</SelectItem>
                            <SelectItem value="ends_with">Termina con</SelectItem>
                            <SelectItem value="equals">Igual a</SelectItem>
                            <SelectItem value="amount_greater">Monto mayor que</SelectItem>
                            <SelectItem value="amount_less">Monto menor que</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                          Condición {parsedRule.conditions.length > 1 ? i + 1 : ''} (Valor)
                        </Label>
                        <Input
                          value={c.value}
                          onChange={(e) => {
                            const updated = [...parsedRule.conditions];
                            updated[i] = { ...updated[i], value: e.target.value };
                            setParsedRule({ ...parsedRule, conditions: updated });
                          }}
                          className="bg-slate-900/40 border-white/10 text-white text-xs h-8 focus:ring-emerald-500/50"
                        />
                      </div>
                    </div>
                  ))}

                  {/* GL Account selectors */}
                  {(() => {
                    const showGlAccount =
                      parsedRule.glAccountName !== undefined && parsedRule.glAccountName !== null;
                    const showDebitGlAccount =
                      parsedRule.debitGlAccountName !== undefined &&
                      parsedRule.debitGlAccountName !== null;
                    const showCreditGlAccount =
                      parsedRule.creditGlAccountName !== undefined &&
                      parsedRule.creditGlAccountName !== null;
                    const hasAnyAccountField =
                      showGlAccount || showDebitGlAccount || showCreditGlAccount;
                    const renderGlAccount = showGlAccount || !hasAnyAccountField;

                    return (
                      <>
                        {renderGlAccount && (
                          <div className="space-y-1">
                            <Label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                              Cuenta
                            </Label>
                            <Select
                              value={parsedRule.glAccountName || ''}
                              onValueChange={(val) =>
                                setParsedRule({ ...parsedRule, glAccountName: val })
                              }
                            >
                              <SelectTrigger className="bg-slate-900/40 border-white/10 text-white text-xs h-8">
                                <SelectValue placeholder="Seleccionar cuenta..." />
                              </SelectTrigger>
                              <SelectContent className="bg-slate-900 border-white/10 text-white text-xs max-h-60 overflow-y-auto">
                                {accounts.map((acc) => (
                                  <SelectItem key={acc.id} value={acc.name}>
                                    <span className="font-mono text-slate-500 mr-2">
                                      {acc.code}
                                    </span>
                                    {acc.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        {showDebitGlAccount && (
                          <div className="space-y-1">
                            <Label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                              Cuenta (salidas)
                            </Label>
                            <Select
                              value={parsedRule.debitGlAccountName || ''}
                              onValueChange={(val) =>
                                setParsedRule({ ...parsedRule, debitGlAccountName: val })
                              }
                            >
                              <SelectTrigger className="bg-slate-900/40 border-white/10 text-white text-xs h-8">
                                <SelectValue placeholder="Seleccionar cuenta de débito..." />
                              </SelectTrigger>
                              <SelectContent className="bg-slate-900 border-white/10 text-white text-xs max-h-60 overflow-y-auto">
                                {accounts.map((acc) => (
                                  <SelectItem key={acc.id} value={acc.name}>
                                    <span className="font-mono text-slate-500 mr-2">
                                      {acc.code}
                                    </span>
                                    {acc.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        {showCreditGlAccount && (
                          <div className="space-y-1">
                            <Label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                              Cuenta (entradas)
                            </Label>
                            <Select
                              value={parsedRule.creditGlAccountName || ''}
                              onValueChange={(val) =>
                                setParsedRule({ ...parsedRule, creditGlAccountName: val })
                              }
                            >
                              <SelectTrigger className="bg-slate-900/40 border-white/10 text-white text-xs h-8">
                                <SelectValue placeholder="Seleccionar cuenta de crédito..." />
                              </SelectTrigger>
                              <SelectContent className="bg-slate-900 border-white/10 text-white text-xs max-h-60 overflow-y-auto">
                                {accounts.map((acc) => (
                                  <SelectItem key={acc.id} value={acc.name}>
                                    <span className="font-mono text-slate-500 mr-2">
                                      {acc.code}
                                    </span>
                                    {acc.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </>
                    );
                  })()}

                  {/* Priority */}
                  <div className="space-y-1">
                    <Label
                      htmlFor="parsed-rule-priority"
                      className="text-[11px] font-medium uppercase tracking-wider text-slate-400"
                    >
                      Prioridad
                    </Label>
                    <Input
                      id="parsed-rule-priority"
                      type="number"
                      min={0}
                      max={20}
                      value={parsedRule.priority}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (!isNaN(val)) {
                          setParsedRule({ ...parsedRule, priority: val });
                        }
                      }}
                      className="bg-slate-900/40 border-white/10 text-white text-xs h-8 focus:ring-emerald-500/50"
                    />
                  </div>
                </div>

                {parsedRule.explanation && (
                  <div className="border-t border-white/10 px-4 py-3">
                    <div className={`rounded-lg p-3 border ${
                      (parsedRule.confidence ?? 0.85) >= 0.8
                        ? 'bg-green-500/5 border-green-500/20'
                        : (parsedRule.confidence ?? 0.85) >= 0.5
                          ? 'bg-amber-500/5 border-amber-500/20'
                          : 'bg-red-500/5 border-red-500/20'
                    }`}>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        {parsedRule.explanation}
                      </p>
                      {parsedRule.uncertaintyReasons && parsedRule.uncertaintyReasons.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {parsedRule.uncertaintyReasons.map((reason, idx) => (
                            <li key={idx} className="text-xs text-slate-400 flex items-start gap-1">
                              <span className="text-red-400 mt-0.5">•</span>
                              {reason}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}

                <div className="border-t border-white/10 px-4 py-3">
                  <Button
                    onClick={handleSaveRule}
                    disabled={isLoading}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white"
                  >
                    {isLoading ? (
                      <Loader2 className="size-4 animate-spin mr-2" />
                    ) : (
                      <Save className="size-4 mr-2" />
                    )}
                    {t('aiAssistant.saveRuleButton')}
                  </Button>
                </div>
              </motion.div>
            )}
          </div>
        ) : (
          /* Welcome screen when no messages yet */
          <div className="mx-auto max-w-lg space-y-6">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-600/15">
                <Sparkles className="size-5 text-blue-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">{t('aiAssistant.ruleTitle')}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-400">
                  {t('aiAssistant.ruleInstructions')}
                </p>
                <div className="mt-3 rounded-lg bg-white/5 border border-white/10 px-3 py-2">
                  <p className="text-sm text-blue-300 font-mono">{t('aiAssistant.ruleExample')}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Error Banner */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="px-6"
          >
            <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-300">
              <AlertCircle className="size-4 shrink-0" />
              {error}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input Area */}
      <div className="border-t border-white/10 px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-lg items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              ref={ruleInputRef}
              value={ruleInput}
              onChange={(e) => setRuleInput(e.target.value)}
              onKeyDown={handleRuleKeyDown}
              placeholder={
                hasMessages ? 'Responde la pregunta de la IA...' : t('aiAssistant.inputPlaceholder')
              }
              rows={hasMessages ? 1 : 2}
              className="w-full resize-none rounded-xl bg-white/5 border border-white/10 px-4 py-3 pr-12 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
              style={{ maxHeight: '120px' }}
              onInput={(e) => {
                const el = e.target as HTMLTextAreaElement;
                el.style.height = 'auto';
                el.style.height = Math.min(el.scrollHeight, 120) + 'px';
              }}
            />
            <Button
              size="icon"
              onClick={handleRuleSubmit}
              disabled={!ruleInput.trim() || isLoading}
              className="absolute right-2 bottom-2 size-8 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-30 text-white"
            >
              {isLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </Button>
          </div>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-slate-500">
          {t('aiAssistant.shiftEnterHint')}
        </p>
      </div>
    </>
  );
}

/* ─── Rule Field Sub-component ────────────────────────────────────── */
function RuleField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-sm text-white font-medium truncate">{value}</p>
    </div>
  );
}
