import { _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const ROOT = path.resolve(__dirname, '..');
export const SHOTS = path.join(ROOT, 'test-results', 'screens');

export interface Instance {
  app: ElectronApplication;
  page: Page;
}

/** Abre una instancia de la app con un perfil limpio y aislado. */
export async function launch(profile: string, backendUrl?: string): Promise<Instance> {
  const userData = path.join(process.env['APPDATA']!, `GameShare-${profile}`);
  fs.rmSync(userData, { recursive: true, force: true });

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  }
  env['GAMESHARE_PROFILE'] = profile;
  env['GAMESHARE_BACKEND_URL'] = backendUrl ?? process.env['E2E_BACKEND_URL']!;

  const app = await electron.launch({ args: ['.'], cwd: ROOT, env });
  const page = await app.firstWindow();
  await page.getByTestId('display-name').waitFor();
  return { app, page };
}

export async function shot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}
