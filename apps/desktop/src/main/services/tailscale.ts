import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const TAILSCALE_CANDIDATES = [
  'tailscale',
  'tailscale.exe',
  'C:\\\\Program Files\\\\Tailscale\\\\tailscale.exe',
  'C:\\\\Program Files (x86)\\\\Tailscale\\\\tailscale.exe',
];

function parsePossiblyNoisyJsonObject(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
  }
  return JSON.parse(trimmed) as Record<string, unknown>;
}

async function runTailscale(args: string[], options?: { timeoutMs?: number; maxBuffer?: number }) {
  let lastError: unknown = null;
  for (const candidate of TAILSCALE_CANDIDATES) {
    try {
      return await execFileAsync(candidate, args, {
        timeout: options?.timeoutMs ?? 15_000,
        maxBuffer: options?.maxBuffer ?? 200_000,
      });
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new Error('Tailscale binary not found');
}

export async function getTailnetHostname(): Promise<string | null> {
  try {
    const { stdout } = await runTailscale(['status', '--json'], { timeoutMs: 5000, maxBuffer: 400_000 });
    const parsed = stdout ? parsePossiblyNoisyJsonObject(stdout) : {};
    const self =
      typeof parsed.Self === 'object' && parsed.Self !== null ? (parsed.Self as Record<string, unknown>) : undefined;
    const dns = typeof self?.DNSName === 'string' ? (self.DNSName as string) : undefined;
    const ips = Array.isArray(self?.TailscaleIPs)
      ? ((self as { TailscaleIPs?: string[] }).TailscaleIPs ?? [])
      : [];
    if (dns && dns.length > 0) return dns.replace(/\.$/, '');
    if (ips.length > 0) return ips[0];
    return null;
  } catch {
    return null;
  }
}

export async function enableTailscaleServe(port: number): Promise<void> {
  await runTailscale(['serve', '--bg', '--yes', `${port}`], { timeoutMs: 15_000 });
}

export async function disableTailscaleServe(): Promise<void> {
  await runTailscale(['serve', 'reset'], { timeoutMs: 15_000 });
}

export async function enableTailscaleFunnel(port: number): Promise<void> {
  await runTailscale(['funnel', '--bg', '--yes', `${port}`], { timeoutMs: 15_000 });
}

export async function disableTailscaleFunnel(): Promise<void> {
  await runTailscale(['funnel', 'reset'], { timeoutMs: 15_000 });
}
