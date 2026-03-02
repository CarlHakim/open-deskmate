import Store from 'electron-store';
import crypto from 'crypto';

interface PairingRequest {
  userId: string;
  code: string;
  createdAt: string;
}

interface PairingStoreSchema {
  requests: Record<string, PairingRequest>;
}

const PAIRING_TTL_MS = 60 * 60 * 1000;
const PAIRING_CODE_LENGTH = 6;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const pairingStore = new Store<PairingStoreSchema>({
  name: 'discord-pairing',
  defaults: {
    requests: {},
  },
});

function generateCode(): string {
  let result = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
    const index = crypto.randomInt(0, CODE_ALPHABET.length);
    result += CODE_ALPHABET[index];
  }
  return result;
}

function pruneExpired(): void {
  const requests = pairingStore.get('requests') ?? {};
  const now = Date.now();
  let changed = false;
  for (const [key, value] of Object.entries(requests)) {
    const createdAt = Date.parse(value.createdAt);
    if (!Number.isFinite(createdAt) || now - createdAt > PAIRING_TTL_MS) {
      delete requests[key];
      changed = true;
    }
  }
  if (changed) {
    pairingStore.set('requests', requests);
  }
}

export function getOrCreateDiscordPairing(userId: string): { code: string; created: boolean } {
  pruneExpired();
  const requests = pairingStore.get('requests') ?? {};
  const existing = requests[userId];
  if (existing?.code) {
    return { code: existing.code, created: false };
  }
  const code = generateCode();
  requests[userId] = {
    userId,
    code,
    createdAt: new Date().toISOString(),
  };
  pairingStore.set('requests', requests);
  return { code, created: true };
}

export function approveDiscordPairing(userId: string, code: string): boolean {
  pruneExpired();
  const requests = pairingStore.get('requests') ?? {};
  const existing = requests[userId];
  if (!existing) {
    return false;
  }
  const normalized = code.trim().toUpperCase();
  if (!normalized || existing.code.toUpperCase() !== normalized) {
    return false;
  }
  delete requests[userId];
  pairingStore.set('requests', requests);
  return true;
}

export function listDiscordPairingRequests(): PairingRequest[] {
  pruneExpired();
  const requests = pairingStore.get('requests') ?? {};
  return Object.values(requests).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
