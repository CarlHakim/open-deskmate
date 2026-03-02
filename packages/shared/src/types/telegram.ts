export interface TelegramConnectorConfig {
  enabled: boolean;
  allowDms: boolean;
  dmPolicy?: 'pairing' | 'open' | 'disabled';
  requireMention: boolean;
  commandPrefix?: string;
  dmAllowlist: string[];
  channelAllowlist: string[];
  groupAllowlist: string[];
  agentId?: string;
}

export interface TelegramBotIdentity {
  id: string;
  username?: string;
  firstName?: string;
}

export interface TelegramConnectorStatus {
  configured: boolean;
  running: boolean;
  botUser?: TelegramBotIdentity;
  lastStartAt?: string;
  lastError?: string;
}

export interface TelegramPairingRequest {
  userId: string;
  code: string;
  createdAt: string;
}
