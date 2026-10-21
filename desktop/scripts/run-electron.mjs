// Lanza Electron eliminando ELECTRON_RUN_AS_NODE (VS Code lo define, y haría que Electron arrancase como Node).
// Uso: node scripts/run-electron.mjs [--dev]
//   --dev  arranca además `ng serve` y carga la interfaz desde http://localhost:4200
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dev = process.argv.includes('--dev');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

let ngServe;
if (dev) {
  env.GAMESHARE_DEV_URL = 'http://localhost:4200';
  ngServe = spawn('npx', ['ng', 'serve', '--port', '4200'], { cwd: root, stdio: 'inherit', shell: true });
  await waitFor('http://localhost:4200', 120_000);
}

const child = spawn(electronPath, ['.'], { cwd: root, env, stdio: 'inherit' });
child.on('exit', (code) => {
  ngServe?.kill();
  process.exit(code ?? 0);
});

async function waitFor(url, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // aún no está listo
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No respondió ${url}`);
}
