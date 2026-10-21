import { ChildProcess, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PORT = 18181;
const JAR = path.resolve(__dirname, '..', '..', 'backend', 'target', 'backend-0.0.1-SNAPSHOT.jar');

/** Arranca el backend real (JAR) en un puerto propio y lo detiene al terminar. */
export default async function globalSetup(): Promise<() => Promise<void>> {
  if (!fs.existsSync(JAR)) {
    throw new Error(`No existe ${JAR}. Compílalo antes con: cd backend && .\\mvnw.cmd package`);
  }
  const url = `http://localhost:${PORT}`;
  const proc: ChildProcess = spawn('java', ['-jar', JAR], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${url}/actuator/health`)).ok) break;
    } catch {
      /* aún arrancando */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  process.env['E2E_BACKEND_URL'] = url;
  return async () => {
    proc.kill();
    // Borra los perfiles temporales de las pruebas (%APPDATA%/GameShare-e2e-*).
    const appData = process.env['APPDATA'];
    if (appData) {
      for (const dir of fs.readdirSync(appData).filter((d) => d.startsWith('GameShare-e2e-'))) {
        fs.rmSync(path.join(appData, dir), { recursive: true, force: true });
      }
    }
  };
}
