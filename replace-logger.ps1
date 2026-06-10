$src = "C:\Users\PC Omar\Downloads\sistema\src"

function Add-Import($content, $importLine) {
    if ($content -match "import \{ logger \} from") { return $content }
    $lines = $content -split "`n"
    $lastImportEndIdx = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $t = $lines[$i].Trim()
        # Find end of any import statement: line contains `from` and ends with `;`
        if ($t -match "from `'") { $lastImportEndIdx = $i }
        if ($t -match 'from "')   { $lastImportEndIdx = $i }
    }
    if ($lastImportEndIdx -ge 0) {
        $before = $lines[0..$lastImportEndIdx] -join "`n"
        $after = $lines[($lastImportEndIdx+1)..($lines.Count-1)] -join "`n"
        $content = $before + "`n" + $importLine + "`n" + $after
    } else {
        $content = $importLine + "`n" + $content
    }
    return $content
}

function Replace-ConsoleCalls($content) {
    # 3-arg: console.error('msg', var1, var2) -> logger.error('msg', { error: String(var1), componentStack: String(var2) })
    $content = $content -replace "console\.error\(`'([^`']+)`',\s*([\w.]+),\s*([\w.]+)\)", 'logger.error(''$1'', { error: String($2), componentStack: String($3) })'
    
    # 2-arg: console.error('TAG', var) -> logger.error('TAG', { error: String(var) })
    $content = $content -replace "console\.error\(`'([^`']+)`',\s*([\w.]+)\)", 'logger.error(''$1'', { error: String($2) })'
    $content = $content -replace 'console\.error\("([^"]+)",\s*([\w.]+)\)', 'logger.error("$1", { error: String($2) })'
    
    # 1-arg: console.error(`template`) -> logger.error(`template`)
    $content = $content -replace '(?s)console\.error\((`[^`]*`)\s*,?\s*\)', 'logger.error($1)'
    
    # 1-arg: console.error(var) -> logger.error(String(var))
    $content = $content -replace "console\.error\(([\w.]+)\)", 'logger.error(String($1))'
    
    # 2-arg: console.warn('TAG', var) -> logger.warn('TAG', { error: String(var) })
    $content = $content -replace "console\.warn\(`'([^`']+)`',\s*([\w.]+)\)", 'logger.warn(''$1'', { error: String($2) })'
    $content = $content -replace 'console\.warn\("([^"]+)",\s*([\w.]+)\)', 'logger.warn("$1", { error: String($2) })'
    
    # 1-arg: console.warn(`template`) -> logger.warn(`template`)
    $content = $content -replace '(?s)console\.warn\((`[^`]*`)\s*,?\s*\)', 'logger.warn($1)'
    
    # 1-arg: console.warn('text') -> logger.warn('text')
    $content = $content -replace "console\.warn\(`'([^`']+)`'\)", 'logger.warn(''$1'')'
    $content = $content -replace 'console\.warn\("([^"]+)"\)', 'logger.warn("$1")'
    
    # 2-arg: console.log('TAG', var) -> logger.info('TAG', { data: var })
    $content = $content -replace "console\.log\(`'([^`']+)`',\s*([\w.]+)\)", 'logger.info(''$1'', { data: $2 })'
    
    # 1-arg: console.log(`template literal`) -> logger.info(`template literal`)
    $content = $content -replace '(?s)console\.log\((`[^`]*`)\s*,?\s*\)', 'logger.info($1)'
    
    # 1-arg: console.log('text') -> logger.info('text')
    $content = $content -replace "console\.log\(`'([^`']+)`'\)", 'logger.info(''$1'')'
    
    return $content
}

$apiImport = "import { logger } from '@/lib/logger';"
$compImport = "import { logger } from '@/lib/logger';"

$jobs = @()

foreach ($rel in @(
    "app\api\users\route.ts",
    "app\api\settings\route.ts",
    "app\api\import\history\route.ts",
    "app\api\learning\rules\route.ts",
    "app\api\onboarding\complete\route.ts",
    "app\api\learning\context\route.ts",
    "app\api\learning\rules\simulate\route.ts",
    "app\api\fiscal-periods\close\route.ts"
)) { $jobs += @{ path = "$src\$rel"; imp = $apiImport } }

foreach ($rel in @(
    "components\spa\admin\AdminCompaniesPage.tsx",
    "components\spa\admin\AdminCompanyDetailPage.tsx",
    "components\spa\admin\AdminUsersPage.tsx",
    "components\spa\BanksPage.tsx",
    "components\spa\JournalPage.tsx",
    "components\spa\ImportPage.tsx",
    "components\spa\settings\CompanyDataTab.tsx",
    "components\spa\settings\UserProfileTab.tsx",
    "components\spa\settings\AIRulesGeneratorTab.tsx",
    "components\spa\ReconciliationPage.tsx",
    "components\spa\FinancialDashboardPage.tsx",
    "components\spa\admin\SuperAdminDashboardPage.tsx",
    "components\spa\admin\AdminAuditLogsPage.tsx",
    "components\spa\AccountsPage.tsx",
    "components\spa\AccountsClient.tsx",
    "components\onboarding\OnboardingWizard.tsx",
    "components\learning\ConversationalRuleBuilder.tsx",
    "components\learning\ContextClarificationModal.tsx",
    "components\audit\LinkJournalModal.tsx",
    "components\audit\FuzzyReviewTable.tsx",
    "components\accounting-flow\FlowErrorBoundary.tsx",
    "components\workflow\WorkflowPanel.tsx"
)) { $jobs += @{ path = "$src\$rel"; imp = $compImport } }

foreach ($entry in @(
    @{ r = "lib\dashboard\export-utils.ts"; i = "import { logger } from '../logger';" }
    @{ r = "lib\backup.ts"; i = "import { logger } from './logger';" }
    @{ r = "lib\api-handler.ts"; i = "import { logger } from './logger';" }
    @{ r = "lib\security\rate-limiter.ts"; i = "import { logger } from '../logger';" }
    @{ r = "lib\memory\keyword-extractor.ts"; i = "import { logger } from '../logger';" }
    @{ r = "lib\audit.ts"; i = "import { logger } from './logger';" }
    @{ r = "lib\services\audit-service.ts"; i = "import { logger } from '../logger';" }
    @{ r = "lib\services\conversational-service.ts"; i = "SKIP" }
    @{ r = "lib\pdf-worker.ts"; i = "import { logger } from './logger';" }
    @{ r = "lib\metrics.ts"; i = "import { logger } from './logger';" }
    @{ r = "lib\accounting\flow-aggregator.ts"; i = "import { logger } from '../logger';" }
    @{ r = "lib\db.ts"; i = "SKIP" }
)) { $jobs += @{ path = "$src\$($entry.r)"; imp = $entry.i } }

$processed = 0; $errors = @()
foreach ($job in $jobs) {
    $processed++
    try {
        $content = Get-Content -Path $job.path -Raw -ErrorAction Stop
        $newContent = Replace-ConsoleCalls $content
        if ($job.imp -ne "SKIP") { $newContent = Add-Import $newContent $job.imp }
        if ($newContent -ne $content) {
            Set-Content -Path $job.path -Value $newContent -NoNewline -Force
            Write-Host "[$processed] $($job.path) [UPDATED]"
        } else {
            Write-Host "[$processed] $($job.path) [no change]"
        }
    } catch { Write-Host "[$processed] $($job.path) [ERROR: $_]"; $errors += "$($job.path): $_" }
}

if ($errors.Count -gt 0) { Write-Host "`nERRORS:"; $errors | % { Write-Host "  $_" } }
Write-Host "`nChecking for remaining console calls..."
$remaining = Select-String -Path "$src\**\*.ts", "$src\**\*.tsx" -Pattern 'console\.(error|warn|log)\(' -SimpleMatch |
    Where-Object { $_.Path -notmatch 'node_modules' -and $_.Path -notmatch '\.next' -and $_.Path -notmatch 'logger\.ts' }
if ($remaining) { $remaining | % { Write-Host "  $($_.Path):$($_.LineNumber) $($_.Line.Trim())" } }
else { Write-Host "[OK] All clear!" }
