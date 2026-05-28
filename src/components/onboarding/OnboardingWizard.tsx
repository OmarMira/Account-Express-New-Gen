'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calendar,
  DollarSign,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Building,
  CheckCircle,
  Loader2,
  HelpCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLanguageStore } from '@/store/language-store';
import { useAuthStore } from '@/store/auth-store';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const MONTHS = [
  { value: '1', name: 'Enero' },
  { value: '2', name: 'Febrero' },
  { value: '3', name: 'Marzo' },
  { value: '4', name: 'Abril' },
  { value: '5', name: 'Mayo' },
  { value: '6', name: 'Junio' },
  { value: '7', name: 'Julio' },
  { value: '8', name: 'Agosto' },
  { value: '9', name: 'Septiembre' },
  { value: '10', name: 'Octubre' },
  { value: '11', name: 'Noviembre' },
  { value: '12', name: 'Diciembre' },
];

const LOCAL_TRANSLATIONS: Record<string, Record<string, string>> = {
  en: {
    welcome: 'Welcome to Account Express!',
    ready: 'All ready to take off!',
    step1Label: 'Fiscal Year',
    step2Label: 'Confirmation',
    questionMonth: 'In what month does your business year begin?',
    descMonth:
      'For most self-employed and small businesses, the accounting year matches the calendar year (starts in January).',
    selectMonthPlaceholder: 'Select a month',
    questionYear: 'In what year do you want to start registering data?',
    descYear:
      'If you have bank statements from prior years that you want to reconcile, select the corresponding year.',
    selectYearPlaceholder: 'Select a year',
    year2024: 'Year 2024',
    year2025: 'Year 2025 (Recommended)',
    year2026: 'Year 2026',
    step2Title: 'Everything ready to configure!',
    step2Desc:
      'By continuing, we will automatically configure your chart of accounts and fiscal periods from {month} to December {year}.',
    loadingTitle: 'Setting up your educational accounting...',
    backBtn: 'Back',
    nextBtn: 'Next',
    startBtn: 'Start!',
    errorOnboarding: 'An error occurred during onboarding.',
    errorConnection: 'Connection error when completing onboarding.',
    loadingChartOfAccounts: 'Creating your standard Chart of Accounts...',
    loadingFiscalPeriods: 'Configuring your fiscal periods...',
    loadingFinalizing: 'Finalizing the accounting setup...',
    month1: 'January',
    month2: 'February',
    month3: 'March',
    month4: 'April',
    month5: 'May',
    month6: 'June',
    month7: 'July',
    month8: 'August',
    month9: 'September',
    month10: 'October',
    month11: 'November',
    month12: 'December',
  },
  es: {
    welcome: '¡Bienvenido a Account Express!',
    ready: '¡Todo listo para despegar!',
    step1Label: 'Año Contable',
    step2Label: 'Confirmación',
    questionMonth: '¿En qué mes comienza tu año de negocios?',
    descMonth:
      'Para la mayoría de los autónomos y pequeñas empresas, el año contable coincide con el año natural (empieza en Enero).',
    selectMonthPlaceholder: 'Selecciona un mes',
    questionYear: '¿En qué año deseas comenzar a registrar datos?',
    descYear:
      'Si tienes extractos bancarios de años anteriores que deseas conciliar, selecciona el año correspondiente.',
    selectYearPlaceholder: 'Selecciona un año',
    year2024: 'Año 2024',
    year2025: 'Año 2025 (Recomendado)',
    year2026: 'Año 2026',
    step2Title: '¡Todo listo para configurar!',
    step2Desc:
      'Al continuar, configuraremos automáticamente tu plan contable y tus periodos fiscales de {month} a Diciembre del {year}.',
    loadingTitle: 'Configurando tu contabilidad didáctica...',
    backBtn: 'Volver',
    nextBtn: 'Siguiente',
    startBtn: '¡Comenzar!',
    errorOnboarding: 'Ocurrió un error en el onboarding.',
    errorConnection: 'Error de conexión al completar el onboarding.',
    loadingChartOfAccounts: 'Creando tu Plan de Cuentas estándar...',
    loadingFiscalPeriods: 'Configurando tus periodos fiscales...',
    loadingFinalizing: 'Finalizando la puesta a punto contable...',
    month1: 'Enero',
    month2: 'Febrero',
    month3: 'Marzo',
    month4: 'Abril',
    month5: 'Mayo',
    month6: 'Junio',
    month7: 'Julio',
    month8: 'Agosto',
    month9: 'Septiembre',
    month10: 'Octubre',
    month11: 'Noviembre',
    month12: 'Diciembre',
  },
};

import { useEffect } from 'react';

export function OnboardingWizard() {
  const t = useLanguageStore((s) => s.t);
  const language = useLanguageStore((s) => s.language) || 'es';
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const activeLang = mounted ? language : 'es';
  const dt = LOCAL_TRANSLATIONS[activeLang] || LOCAL_TRANSLATIONS.es;
  const { activeCompany, hydrate } = useAuthStore();

  const [step, setStep] = useState(1);
  const [fiscalMonth, setFiscalMonth] = useState('1');
  const [fiscalYear, setFiscalYear] = useState('2025');
  const [loading, setLoading] = useState(false);
  const [progressStatus, setProgressStatus] = useState('');

  const nextStep = () => setStep((s) => s + 1);
  const prevStep = () => setStep((s) => s - 1);

  async function handleComplete() {
    if (!activeCompany?.id) return;
    setLoading(true);

    // Simular progreso didáctico visual para reducir la fricción técnica
    setProgressStatus(dt.loadingChartOfAccounts);
    await new Promise((resolve) => setTimeout(resolve, 1200));

    setProgressStatus(dt.loadingFiscalPeriods);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    setProgressStatus(dt.loadingFinalizing);
    await new Promise((resolve) => setTimeout(resolve, 800));

    try {
      const response = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: activeCompany.id,
          fiscalYearStartMonth: fiscalMonth,
          fiscalYearStartYear: fiscalYear,
        }),
      });

      if (response.ok) {
        // Recargar el authStore para actualizar activeCompany y su isOnboardingComplete
        await hydrate();
        window.location.reload();
      } else {
        const err = await response.json();
        alert(err.error || dt.errorOnboarding);
        setLoading(false);
      }
    } catch {
      alert(dt.errorConnection);
      setLoading(false);
    }
  }

  // Animation variants
  const slideVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 100 : -100,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
      transition: { duration: 0.3 },
    },
    exit: (direction: number) => ({
      x: direction < 0 ? 100 : -100,
      opacity: 0,
      transition: { duration: 0.2 },
    }),
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-teal-50/50 via-background to-indigo-50/30 p-4 dark:from-teal-950/10 dark:to-indigo-950/5">
      <Card className="w-full max-w-lg border-teal-100/50 shadow-2xl backdrop-blur-sm dark:border-teal-950/20">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-teal-500/10 text-teal-600 dark:bg-teal-500/20 dark:text-teal-400 mb-3">
            <Sparkles className="size-6 animate-pulse" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">
            {step < 2 ? dt.welcome : dt.ready}
          </CardTitle>
          <CardDescription>
            {activeCompany && (
              <span className="flex items-center justify-center gap-1 text-xs text-muted-foreground font-medium uppercase tracking-wider mt-1">
                <Building className="size-3.5" />
                {activeCompany.legalName}
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {/* Progress Indicators */}
          {step <= 2 && (
            <div className="flex items-center justify-between mb-8 px-4">
              <div className="flex items-center gap-2">
                <div
                  className={`flex size-6 items-center justify-center rounded-full text-xs font-bold transition-colors ${step >= 1 ? 'bg-teal-500 text-white' : 'bg-muted text-muted-foreground'}`}
                >
                  1
                </div>
                <span
                  className={`text-xs font-medium ${step === 1 ? 'text-teal-600 dark:text-teal-400 font-bold' : 'text-muted-foreground'}`}
                >
                  {dt.step1Label}
                </span>
              </div>
              <div className="h-[1px] flex-1 bg-muted mx-3" />
              <div className="flex items-center gap-2">
                <div
                  className={`flex size-6 items-center justify-center rounded-full text-xs font-bold transition-colors ${step >= 2 ? 'bg-teal-500 text-white' : 'bg-muted text-muted-foreground'}`}
                >
                  2
                </div>
                <span
                  className={`text-xs font-medium ${step === 2 ? 'text-teal-600 dark:text-teal-400 font-bold' : 'text-muted-foreground'}`}
                >
                  {dt.step2Label}
                </span>
              </div>
            </div>
          )}

          <AnimatePresence mode="wait" custom={step}>
            {!loading ? (
              <motion.div
                key={step}
                custom={step}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                className="space-y-6 min-h-[160px] flex flex-col justify-center"
              >
                {/* STEP 1: Fiscal Year Start Month and Year */}
                {step === 1 && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label
                        htmlFor="fiscalMonth"
                        className="text-sm font-semibold flex items-center gap-1.5"
                      >
                        <Calendar className="size-4 text-teal-500" />
                        {dt.questionMonth}
                      </Label>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {dt.descMonth}
                      </p>
                      <Select value={fiscalMonth} onValueChange={setFiscalMonth}>
                        <SelectTrigger className="w-full mt-2 border-teal-100 dark:border-teal-950 focus:ring-teal-500">
                          <SelectValue placeholder={dt.selectMonthPlaceholder} />
                        </SelectTrigger>
                        <SelectContent>
                          {MONTHS.map((m) => (
                            <SelectItem key={m.value} value={m.value}>
                              {dt['month' + m.value] || m.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2 mt-4">
                      <Label
                        htmlFor="fiscalYear"
                        className="text-sm font-semibold flex items-center gap-1.5"
                      >
                        <Calendar className="size-4 text-teal-500" />
                        {dt.questionYear}
                      </Label>
                      <p className="text-xs text-muted-foreground leading-relaxed">{dt.descYear}</p>
                      <Select value={fiscalYear} onValueChange={setFiscalYear}>
                        <SelectTrigger className="w-full mt-2 border-teal-100 dark:border-teal-950 focus:ring-teal-500">
                          <SelectValue placeholder={dt.selectYearPlaceholder} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="2024">{dt.year2024}</SelectItem>
                          <SelectItem value="2025">{dt.year2025}</SelectItem>
                          <SelectItem value="2026">{dt.year2026}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {/* STEP 2: Setup Confirmation */}
                {step === 2 && (
                  <div className="space-y-4 text-center">
                    <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500 mb-2">
                      <CheckCircle className="size-8" />
                    </div>
                    <h3 className="text-lg font-bold text-foreground">{dt.step2Title}</h3>
                    <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
                      {dt.step2Desc
                        .replace('{month}', dt['month' + fiscalMonth] || '')
                        .replace('{year}', fiscalYear)}
                    </p>
                  </div>
                )}
              </motion.div>
            ) : (
              // Loading Progress Panel (Highly Didactic Visual Feedback)
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center py-10 space-y-4"
              >
                <div className="relative flex items-center justify-center size-20">
                  <div className="absolute inset-0 rounded-full border-t-2 border-r-2 border-teal-500 animate-spin" />
                  <div className="absolute inset-2 rounded-full border-b-2 border-l-2 border-indigo-500 animate-spin [animation-direction:reverse]" />
                  <Loader2 className="size-6 animate-spin text-teal-500" />
                </div>
                <div className="text-center space-y-1">
                  <h4 className="font-semibold text-sm text-foreground">{dt.loadingTitle}</h4>
                  <p className="text-xs text-muted-foreground animate-pulse">{progressStatus}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Action Buttons */}
          {!loading && (
            <div className="flex items-center justify-between mt-8 pt-4 border-t border-muted/50">
              {step > 1 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={prevStep}
                  className="gap-1 text-muted-foreground"
                >
                  <ArrowLeft className="size-4" />
                  {dt.backBtn}
                </Button>
              ) : (
                <div />
              )}

              {step < 2 ? (
                <Button
                  size="sm"
                  onClick={nextStep}
                  className="gap-1 bg-teal-600 hover:bg-teal-500 text-white"
                >
                  {dt.nextBtn}
                  <ArrowRight className="size-4" />
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={handleComplete}
                  className="gap-1 bg-teal-600 hover:bg-teal-500 text-white"
                >
                  {dt.startBtn}
                  <Sparkles className="size-4" />
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
