import { execSync, spawnSync } from 'child_process';
import { existsSync, cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const STANDALONE = join(ROOT, '.next', 'standalone');

function run(cmd, cwd = ROOT) {
  console.log(`→ ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function getVersion() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  return pkg.version || '1.0.0';
}

function getDirSize(dir) {
  let size = 0;
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else size += statSync(p).size;
    }
  };
  walk(dir);
  return size;
}

function findBun() {
  const candidates = [
    join(ROOT, 'node_modules', '.bun', 'bin', 'bun.exe'),
    join(ROOT, '..', '.bun', 'bin', 'bun.exe'),
    'C:\\Program Files\\Bun\\bun.exe',
    'bun.exe',
  ];
  for (const c of candidates) {
    try { execSync(`${c} --version`, { stdio: 'ignore' }); return c; } catch {}
  }
  return null;
}

console.log('=== Account Express — Package Script ===\n');

// Step 1: Build Next.js
console.log('▶ Step 1/4: Building Next.js...');
run('npm run build');

// Step 2: Verify standalone output
console.log('▶ Step 2/4: Verifying standalone output...');
if (!existsSync(join(STANDALONE, 'server.js'))) {
  console.error('ERROR: standalone/server.js not found.');
  console.error('Fix outputFileTracingRoot in next.config.ts if needed.');
  process.exit(1);
}
console.log('  ✓ server.js found');

// Step 3: Copy to dist/
console.log('▶ Step 3/4: Copying to dist/...');
if (existsSync(DIST)) rmSync(DIST, { recursive: true });
mkdirSync(DIST, { recursive: true });

cpSync(STANDALONE, join(DIST, 'standalone'), { recursive: true });
cpSync(join(ROOT, 'public'), join(DIST, 'standalone', 'public'), { recursive: true });

for (const dir of ['data', 'db', 'rules']) {
  if (existsSync(join(ROOT, dir))) {
    cpSync(join(ROOT, dir), join(DIST, dir), { recursive: true });
  }
}

if (existsSync(join(ROOT, '.env.staging'))) {
  cpSync(join(ROOT, '.env.staging'), join(DIST, '.env'));
} else if (existsSync(join(ROOT, '.env'))) {
  cpSync(join(ROOT, '.env'), join(DIST, '.env'));
}

// Step 4: Compile launcher with bun
console.log('▶ Step 4/4: Compiling launcher executable...');
const bun = findBun();
if (bun) {
  const launcherSrc = join(ROOT, 'scripts', 'run-server.js');
  const launcherOut = join(DIST, 'AccountExpress.exe');
  const result = spawnSync(bun, ['build', '--compile', launcherSrc, '--outfile', launcherOut], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (result.status === 0) {
    console.log('  ✓ AccountExpress.exe compiled');
  } else {
    console.log('  ⚠ bun compile failed, creating .bat launcher as fallback');
    createBatLauncher();
  }
} else {
  console.log('  ⚠ bun not found, creating .bat launcher');
  createBatLauncher();
}

// Always create .bat as well (for development/testing)
function createBatLauncher() {
  const bat = `@echo off
title Account Express
cd /d "%~dp0standalone"
echo Starting Account Express...
echo.
start /B "" "%~dp0bun\\bun.exe" server.js
echo Waiting for server...
timeout /t 4 /nobreak >nul
start http://localhost:3000
echo Server running at http://localhost:3000
echo Close this window to stop the server.
:wait
timeout /t 1 /nobreak >nul
tasklist /FI "IMAGENAME eq bun.exe" 2>nul | find /I "bun.exe" >nul
if errorlevel 1 goto end
goto wait
:end
echo Server stopped.
pause
`;
  writeFileSync(join(DIST, 'Iniciar Account Express.bat'), bat);
}

console.log(`\n✅ Package complete: ${DIST}/`);
console.log(`   Version: ${getVersion()}`);
console.log(`   Size: ~${(getDirSize(DIST) / 1024 / 1024).toFixed(0)} MB`);
