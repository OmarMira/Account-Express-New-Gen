'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  TrendingUp,
  BookOpen,
  FileText,
  Landmark,
  Scale,
  ArrowLeftRight,
  BarChart3,
  Download,
  Settings,
  Menu,
  LogOut,
  ChevronLeft,
  Building2,
  Activity,
  Sparkles,
  ShieldCheck,
  Loader2,
  Workflow,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ThemeToggle } from '@/components/spa/ThemeToggle';
import { LanguageSelector } from '@/components/spa/LanguageSelector';
import { DashboardPage } from '@/components/spa/DashboardPage';
import { AccountsPage } from '@/components/spa/AccountsPage';
import { JournalPage } from '@/components/spa/JournalPage';
import { BanksPage } from '@/components/spa/BanksPage';
import { ImportPage } from '@/components/spa/ImportPage';
import { BankRulesPage } from '@/components/spa/BankRulesPage';
import { ReconciliationPage } from '@/components/spa/ReconciliationPage';
import { ReportsPage } from '@/components/spa/ReportsPage';
import { ExportPage } from '@/components/spa/ExportPage';
import { MovementSummaryPage } from '@/components/spa/MovementSummaryPage';
import { SettingsPage } from '@/components/spa/SettingsPage';
import { UsersPage } from '@/components/spa/UsersPage';
import { SelectCompanyPage } from '@/components/spa/SelectCompanyPage';
import { AIAssistantModal } from '@/components/spa/AIAssistantModal';
import { FinancialDashboardPage } from '@/components/spa/FinancialDashboardPage';
import { EntityManagementPage } from '@/components/spa/EntityManagementPage';
import { useLanguageStore } from '@/store/language-store';
import { useAuthStore, type ViewName } from '@/store/auth-store';
import { WorkflowPanel } from '@/components/workflow/WorkflowPanel';

/* ─── Navigation Items ─── */
interface NavItem {
  view: ViewName;
  icon: React.ComponentType<{ className?: string }>;
  labelKey: string;
  tooltipKey: string;
}

const navItems: NavItem[] = [
  {
    view: 'dashboard',
    icon: LayoutDashboard,
    labelKey: 'dashboard.title',
    tooltipKey: 'sidebar.dashboard',
  },
  {
    view: 'financial-dashboard',
    icon: TrendingUp,
    labelKey: 'financialDashboard.title',
    tooltipKey: 'sidebar.financialDashboard',
  },
  {
    view: 'accounts',
    icon: BookOpen,
    labelKey: 'accounts.title',
    tooltipKey: 'sidebar.accounts',
  },
  {
    view: 'journal',
    icon: FileText,
    labelKey: 'journal.title',
    tooltipKey: 'sidebar.journal',
  },
  {
    view: 'banks',
    icon: Landmark,
    labelKey: 'banks.title',
    tooltipKey: 'sidebar.banks',
  },
  {
    view: 'bank-rules',
    icon: Scale,
    labelKey: 'bankRules.title',
    tooltipKey: 'sidebar.bankRules',
  },
  {
    view: 'reconciliation',
    icon: ArrowLeftRight,
    labelKey: 'reconciliation.title',
    tooltipKey: 'sidebar.reconciliation',
  },
  {
    view: 'movement-summary',
    icon: Activity,
    labelKey: 'movementSummary.title',
    tooltipKey: 'sidebar.movementSummary',
  },
  {
    view: 'reports',
    icon: BarChart3,
    labelKey: 'reports.title',
    tooltipKey: 'sidebar.reports',
  },
  {
    view: 'export',
    icon: Download,
    labelKey: 'exportData.title',
    tooltipKey: 'sidebar.export',
  },
  {
    view: 'entity-management',
    icon: Sparkles,
    labelKey: 'entityManagement.title',
    tooltipKey: 'sidebar.entityManagement',
  },
];

const settingsItem: NavItem = {
  view: 'settings',
  icon: Settings,
  labelKey: 'settings.title',
  tooltipKey: 'sidebar.settings',
};

/* ─── Sidebar Content (shared between desktop + mobile) ─── */
function SidebarNav({
  onNavigate,
  onOpenWorkflow,
}: {
  onNavigate?: () => void;
  onOpenWorkflow?: () => void;
}) {
  const t = useLanguageStore((s) => s.t);
  const router = useRouter();
  const pathname = usePathname();
  const currentView = useAuthStore((s) => s.currentView);
  const setCurrentView = useAuthStore((s) => s.setCurrentView);

  function handleNav(view: ViewName) {
    if (view === 'accounts') {
      router.push('/accounts');
    } else {
      if (pathname !== '/') {
        router.push('/');
      }
      setCurrentView(view);
    }
    onNavigate?.();
  }

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onOpenWorkflow}
              className="flex h-14 w-full items-center gap-2 px-4 hover:bg-accent/50 transition-colors text-left focus:outline-hidden cursor-pointer"
            >
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
                AE
              </div>
              <span className="text-lg font-semibold tracking-tight">{t('common.appName')}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>{t('sidebar.logoTooltip')}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Separator />

      {/* Nav links */}
      <TooltipProvider delayDuration={400}>
        <ScrollArea className="flex-1 py-2">
          <nav className="space-y-1 px-3">
            {navItems.map((item) => {
              const isActive =
                item.view === 'accounts'
                  ? pathname === '/accounts'
                  : pathname === '/' && currentView === item.view;
              return (
                <Tooltip key={item.view}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => handleNav(item.view)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                      )}
                    >
                      <item.icon className="size-4 shrink-0" />
                      {t(item.labelKey)}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <p>{t(item.tooltipKey)}</p>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </nav>
        </ScrollArea>

        <Separator />

        {/* AI Assistant + Settings + Logout */}
        <div className="p-3 space-y-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => useAuthStore.getState().setAiAssistantOpen(true)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-purple-500/10 hover:text-purple-500 transition-colors"
              >
                <Sparkles className="size-4 shrink-0" />
                {t('aiAssistant.title')}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>{t('sidebar.aiAssistantTooltip')}</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => handleNav('settings')}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  pathname === '/' && currentView === 'settings'
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <settingsItem.icon className="size-4 shrink-0" />
                {t(settingsItem.labelKey)}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>{t(settingsItem.tooltipKey)}</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => {
                  fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
                  useAuthStore.getState().logout();
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500 transition-colors"
              >
                <LogOut className="size-4 shrink-0" />
                {t('auth.logout')}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>{t('sidebar.logoutTooltip')}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>
  );
}

/* ─── Desktop Sidebar ─── */
function DesktopSidebar({
  collapsed,
  onToggle,
  onOpenWorkflow,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onOpenWorkflow?: () => void;
}) {
  const t = useLanguageStore((s) => s.t);
  return (
    <aside
      className={cn(
        'hidden lg:flex flex-col border-r bg-card transition-all duration-300 shrink-0',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onOpenWorkflow}
              className={cn(
                'flex h-14 items-center hover:bg-accent/50 transition-colors text-left focus:outline-hidden cursor-pointer',
                collapsed ? 'justify-center px-2' : 'gap-2 px-4 w-full',
              )}
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
                AE
              </div>
              {!collapsed && (
                <span className="text-lg font-semibold tracking-tight truncate">
                  AccountExpress
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>{t('sidebar.logoTooltip')}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Separator />

      <ScrollArea className="flex-1 py-2">
        <nav className="space-y-1 px-2">
          <DesktopNavItems collapsed={collapsed} />
        </nav>
      </ScrollArea>

      <Separator />

      <div className="p-2">
        <button
          onClick={onToggle}
          className="flex w-full items-center justify-center rounded-lg py-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <ChevronLeft className={cn('size-4 transition-transform', collapsed && 'rotate-180')} />
        </button>
      </div>
    </aside>
  );
}

function DesktopNavItems({ collapsed }: { collapsed: boolean }) {
  const t = useLanguageStore((s) => s.t);
  const router = useRouter();
  const pathname = usePathname();
  const currentView = useAuthStore((s) => s.currentView);
  const setCurrentView = useAuthStore((s) => s.setCurrentView);

  const setAiAssistantOpen = useAuthStore((s) => s.setAiAssistantOpen);
  const allItems = [...navItems, settingsItem];

  function handleNav(view: ViewName) {
    if (view === 'accounts') {
      router.push('/accounts');
    } else {
      if (pathname !== '/') {
        router.push('/');
      }
      setCurrentView(view);
    }
  }

  return (
    <TooltipProvider delayDuration={400}>
      {allItems.map((item) => {
        const isActive =
          item.view === 'accounts'
            ? pathname === '/accounts'
            : pathname === '/' && currentView === item.view;
        return (
          <Tooltip key={item.view}>
            <TooltipTrigger asChild>
              <button
                onClick={() => handleNav(item.view)}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  collapsed ? 'justify-center' : 'w-full',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <item.icon className="size-4 shrink-0" />
                {!collapsed && t(item.labelKey)}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>{t(item.tooltipKey)}</p>
            </TooltipContent>
          </Tooltip>
        );
      })}
      {/* AI Assistant Button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setAiAssistantOpen(true)}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-purple-500/10 hover:text-purple-500 transition-colors',
              collapsed ? 'justify-center' : 'w-full',
            )}
          >
            <Sparkles className="size-4 shrink-0" />
            {!collapsed && t('aiAssistant.title')}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>{t('sidebar.aiAssistantTooltip')}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/* ─── Main AppShell ─── */
export function AppShell({ children }: { children?: React.ReactNode }) {
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const t = useLanguageStore((s) => s.t);
  const pathname = usePathname();
  const { user, activeCompany, logout, sidebarOpen, setSidebarOpen, setCurrentView } =
    useAuthStore();
  const currentView = useAuthStore((s) => s.currentView);

  const initials = user
    ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase()
    : '??';

  const handleLogout = useCallback(() => {
    fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    logout();
  }, [logout]);

  const handleChangeCompany = useCallback(() => {
    useAuthStore.getState().setActiveCompany(null);
    useAuthStore.getState().setCurrentView('select-company');
    router.push('/');
  }, [router]);

  const isProcessing = useAuthStore((s) => s.isProcessing);
  const processingMessage = useAuthStore((s) => s.processingMessage);

  // Close mobile sidebar on nav change
  useEffect(() => {
    if (window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
  }, [currentView, setSidebarOpen]);

  const pageTitle = t(
    `${navItems.find((i) => i.view === currentView)?.labelKey ?? settingsItem.labelKey}`,
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Global Processing Loader Overlay */}
      {isProcessing && (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background/40 backdrop-blur-sm transition-all duration-300 animate-in fade-in">
          <div className="flex flex-col items-center gap-5 rounded-2xl border bg-card/85 p-8 shadow-2xl backdrop-blur-xl border-border/50 max-w-sm text-center">
            <div className="relative flex items-center justify-center size-20">
              {/* Outer glow ring */}
              <div className="absolute inset-0 rounded-full border-t-2 border-r-2 border-primary animate-spin" />
              {/* Inner glow ring running counter-clockwise */}
              <div className="absolute inset-2 rounded-full border-b-2 border-l-2 border-indigo-500 animate-spin [animation-direction:reverse]" />
              {/* Inner core spinner icon */}
              <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
                <Loader2 className="size-5 animate-spin text-primary" />
              </div>
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold text-sm tracking-tight text-foreground">
                {processingMessage === 'Procesando...' ? t('common.processing') : processingMessage}
              </h3>
              <p className="text-xs text-muted-foreground">{t('common.pleaseWait')}</p>
            </div>
          </div>
        </div>
      )}

      {/* AI Assistant Modal */}
      <AIAssistantModal />

      {/* Desktop sidebar */}
      <DesktopSidebar
        collapsed={!sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        onOpenWorkflow={() => {
          if (pathname !== '/') {
            router.push('/');
          }
          setCurrentView('workflow');
        }}
      />

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* ── Top Header ── */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4 lg:px-6">
          {/* Mobile hamburger */}
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden">
                <Menu className="size-5" />
                <span className="sr-only">Menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>Navigation</SheetTitle>
              </SheetHeader>
              <SidebarNav
                onNavigate={() => setMobileNavOpen(false)}
                onOpenWorkflow={() => {
                  if (pathname !== '/') {
                    router.push('/');
                  }
                  setCurrentView('workflow');
                  setMobileNavOpen(false);
                }}
              />
            </SheetContent>
          </Sheet>

          {/* Company badge */}
          {activeCompany && (
            <div className="hidden md:flex items-center gap-2 rounded-md border px-2.5 py-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                {t('common.companyActive')}
              </span>
              <span className="text-sm font-medium truncate max-w-[140px]">
                {activeCompany.legalName}
              </span>
              <button
                onClick={handleChangeCompany}
                className="text-xs text-primary hover:underline font-medium"
              >
                {t('common.change')}
              </button>
            </div>
          )}

          <div className="flex-1" />

          {/* AES Encryption Badge */}
          <div className="hidden lg:flex items-center gap-1.5 rounded-md border px-2.5 py-1">
            <ShieldCheck className="size-3.5 text-emerald-600" />
            <span className="text-[11px] font-medium text-muted-foreground">AES</span>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-1">
            <LanguageSelector />
            <ThemeToggle />

            {/* User menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full">
                  <Avatar className="size-7">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium">
                      {user?.firstName} {user?.lastName}
                    </p>
                    <p className="text-xs text-muted-foreground">{user?.email}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={() => useAuthStore.getState().setCurrentView('settings')}
                  className="gap-2"
                >
                  <Settings className="size-4" />
                  {t('settings.title')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} variant="destructive" className="gap-2">
                  <LogOut className="size-4" />
                  {t('auth.logout')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* ── Main Content Area ── */}
        <main className="flex-1 overflow-auto p-4 lg:p-6">
          <div className="mx-auto max-w-7xl">
            {children ? children : <PlaceholderView view={currentView} />}
          </div>
        </main>
      </div>
    </div>
  );
}

/* ─── Placeholder for sub-views ─── */
function PlaceholderView({ view }: { view: ViewName }) {
  const t = useLanguageStore((s) => s.t);

  // Real pages
  if (view === 'dashboard') {
    return <DashboardPage />;
  }
  if (view === 'accounts') {
    return <AccountsPage />;
  }
  if (view === 'journal') {
    return <JournalPage />;
  }
  if (view === 'banks') {
    return <BanksPage />;
  }
  if (view === 'import') {
    return <ImportPage />;
  }
  if (view === 'bank-rules') {
    return <BankRulesPage />;
  }
  if (view === 'reconciliation') {
    return <ReconciliationPage />;
  }
  if (view === 'reports') {
    return <ReportsPage />;
  }
  if (view === 'export') {
    return <ExportPage />;
  }
  if (view === 'movement-summary') {
    return <MovementSummaryPage />;
  }
  if (view === 'settings') {
    return <SettingsPage />;
  }
  if (view === 'users') {
    return <UsersPage />;
  }
  if (view === 'select-company') {
    return <SelectCompanyPage />;
  }
  if (view === 'financial-dashboard') {
    return <FinancialDashboardPage />;
  }
  if (view === 'workflow') {
    return <WorkflowPanel />;
  }
  if (view === 'entity-management') {
    return <EntityManagementPage />;
  }

  // Map views to their title keys
  const viewKeyMap: Partial<Record<ViewName, string>> = {
    dashboard: 'dashboard.title',
    'financial-dashboard': 'financialDashboard.title',
    accounts: 'accounts.title',
    journal: 'journal.title',
    banks: 'banks.title',
    'bank-rules': 'bankRules.title',
    import: 'banks.uploadStatement',
    reconciliation: 'reconciliation.title',
    reports: 'reports.title',
    export: 'exportData.title',
    'movement-summary': 'movementSummary.title',
    settings: 'settings.title',
    users: 'users.title',
    onboarding: 'onboarding.title',
    'entity-management': 'entityManagement.title',
  };

  const title = t(viewKeyMap[view] ?? 'dashboard.title');

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
        <LayoutDashboard className="size-8 text-primary" />
      </div>
      <div>
        <h2 className="text-2xl font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t('landing.comingSoon')}</p>
      </div>
    </div>
  );
}
