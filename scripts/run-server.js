const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const DIR = path.dirname(process.execPath);
const SERVER = path.join(DIR, 'standalone', 'server.js');
const PORT = process.env.PORT || 3000;

process.env.NODE_ENV = 'production';
process.env.PORT = String(PORT);

try { process.chdir(DIR); } catch {}

const child = spawn(process.execPath, [SERVER], {
  stdio: 'inherit',
  env: { ...process.env },
});

function openBrowser(retries) {
  const req = http.get(`http://localhost:${PORT}`, () => {
    try {
      const { execSync } = require('child_process');
      execSync(`start http://localhost:${PORT}`, { stdio: 'ignore' });
    } catch {}
  });
  req.on('error', () => { if (retries > 0) setTimeout(() => openBrowser(retries - 1), 1000); });
  req.end();
}
setTimeout(() => openBrowser(10), 3000);

child.on('exit', (code) => process.exit(code ?? 0));
