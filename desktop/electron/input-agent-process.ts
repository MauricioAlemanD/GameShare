import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as readline from 'node:readline';

/**
 * Lanza y supervisa InputAgent.exe (proceso aislado que maneja ViGEmBus).
 * Comunicación solo por stdin/stdout. Si Electron muere, el agente recibe EOF, desconecta los mandos y termina.
 */
export class InputAgentProcess {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private stopping = false;
  private restarts = 0;

  constructor(
    private readonly exePath: string,
    private readonly onLine: (line: string) => void,
    private readonly onUnavailable: (message: string) => void,
  ) {}

  start(): void {
    if (this.proc) return;
    if (!fs.existsSync(this.exePath)) {
      this.onUnavailable(`No se encontró el agente de mandos (${this.exePath}). Compílalo con: cd input-agent; dotnet publish src/InputAgent -c Release -o dist`);
      return;
    }
    const proc = spawn(this.exePath, [], { stdio: 'pipe', windowsHide: true });
    this.proc = proc;
    readline.createInterface({ input: proc.stdout }).on('line', (l) => this.onLine(l));
    proc.stderr.on('data', () => undefined);
    proc.on('error', (e) => this.onUnavailable(`No se pudo iniciar el agente de mandos: ${e.message}`));
    proc.on('exit', (code) => {
      this.proc = null;
      if (this.stopping) return;
      if (code === 2) {
        this.onUnavailable('El driver ViGEmBus no está instalado en este PC.');
        return;
      }
      // Reinicio limitado si se cae de forma inesperada.
      if (this.restarts++ < 3) {
        setTimeout(() => this.start(), 1000);
      } else {
        this.onUnavailable('El agente de mandos se cerró varias veces seguidas.');
      }
    });
  }

  send(line: string): void {
    if (this.proc?.stdin.writable) this.proc.stdin.write(line + '\n');
  }

  stop(): void {
    this.stopping = true;
    if (!this.proc) return;
    this.send('Q');
    this.proc.stdin.end();
    const p = this.proc;
    setTimeout(() => p.exitCode === null && p.kill(), 2000);
  }
}
