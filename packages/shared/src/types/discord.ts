export interface DiscordConnectorConfig {
  enabled: boolean;
  allowDms: boolean;
  dmPolicy?: 'pairing' | 'open' | 'disabled';
  requireMention: boolean;
  commandPrefix?: string;
  dmAllowlist: string[];
  channelAllowlist: string[];
  guildAllowlist: string[];
  agentId?: string;
}

export interface DiscordBotIdentity {
  id: string;
  tag?: string;
  username?: string;
}

export interface DiscordConnectorStatus {
  configured: boolean;
  running: boolean;
  botUser?: DiscordBotIdentity;
  lastStartAt?: string;
  lastError?: string;
}

export interface DiscordPairingRequest {
  userId: string;
  code: string;
  createdAt: string;
}
