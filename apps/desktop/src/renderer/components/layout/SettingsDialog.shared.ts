import { isValidElement, type ReactNode } from 'react';
import {
  Cpu,
  Smartphone,
  Tablet,
  Laptop,
  Camera,
  Mic,
  Compass,
  Globe,
  MapPin,
  Wifi,
  Bluetooth,
  Shield,
  Key,
  Lock,
  Unlock,
  Zap,
  Activity,
  Sparkles,
  Star,
  Heart,
  Bell,
  Folder,
  FileText,
  Image,
  Video,
  Headphones,
  Gamepad2,
  Server,
  Cloud,
  Monitor,
} from 'lucide-react';
import type { ProviderConfig, SelectedModel } from '@accomplish/shared';

export const KNOWN_API_KEY_FORMATS: Record<string, { prefix: string; placeholder: string }> = {
  anthropic: { prefix: 'sk-ant-', placeholder: 'sk-ant-...' },
  openai: { prefix: 'sk-', placeholder: 'sk-...' },
  google: { prefix: 'AIza', placeholder: 'AIza...' },
  xai: { prefix: 'xai-', placeholder: 'xai-...' },
};

export const API_KEY_PROVIDER_LABEL_OVERRIDES: Record<string, string> = {
  xai: 'xAI (Grok)',
};

export const CUSTOM_PROVIDER_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const CUSTOM_PROVIDER_MODELS_FORMAT_HELPER =
  'Format: id|name|context|max_output|vision(true/false)';

export const FIRST_PARTY_GATEWAY_CONNECTOR_IDS = new Set([
  'discord',
  'telegram',
  'slack',
  'matrix',
  'msteams',
  'mattermost',
  'googlechat',
  'signal',
  'whatsapp',
  'line',
  'bluebubbles',
  'imessage',
  'nextcloud-talk',
  'nostr',
  'tlon',
  'zalo',
  'zalouser',
]);

export const BRIDGE_GATEWAY_RUNTIME_CONNECTOR_IDS = new Set([
  'signal',
  'whatsapp',
  'line',
  'bluebubbles',
  'imessage',
  'nextcloud-talk',
  'nostr',
  'tlon',
  'zalo',
  'zalouser',
]);

export type ConnectorMetadataTemplate = {
  lines: Array<readonly [key: string, value: string]>;
  help: string;
};

export const CONNECTOR_METADATA_TEMPLATE_BY_ID: Record<string, ConnectorMetadataTemplate> = {
  slack: {
    lines: [
      ['channels', 'C1234567890,D1234567890'],
      ['command_prefix', '!desk'],
      ['poll_interval_ms', '5000'],
      ['require_mention', 'true'],
    ],
    help: 'channels overrides Allowed channel IDs for runtime polling.',
  },
  matrix: {
    lines: [
      ['rooms', '!abc123:matrix.org'],
      ['command_prefix', '!desk'],
      ['poll_interval_ms', '7000'],
      ['require_mention', 'false'],
    ],
    help: 'rooms overrides Allowed channel IDs for Matrix room polling.',
  },
  msteams: {
    lines: [
      ['chat_ids', '19:example@thread.v2'],
      ['bot_user_id', '00000000-0000-0000-0000-000000000000'],
      ['command_prefix', '!desk'],
      ['poll_interval_ms', '5000'],
      ['require_mention', 'false'],
    ],
    help: 'chat_ids overrides Allowed channel IDs. bot_user_id is optional fallback when /me cannot resolve.',
  },
  mattermost: {
    lines: [
      ['channels', 'channel_id_1,channel_id_2'],
      ['command_prefix', '!desk'],
      ['poll_interval_ms', '5000'],
      ['require_mention', 'false'],
    ],
    help: 'channels overrides Allowed channel IDs for Mattermost polling.',
  },
  googlechat: {
    lines: [
      ['spaces', 'spaces/AAAAexample'],
      ['command_prefix', '!desk'],
      ['poll_interval_ms', '5000'],
      ['require_mention', 'false'],
    ],
    help: 'spaces overrides Allowed channel IDs (space IDs).',
  },
  signal: {
    lines: [
      ['signal_sender', '+15551234567'],
      ['signal_provider_base_url', 'http://127.0.0.1:8080'],
      ['signal_send_endpoint', '/v2/send'],
      ['signal_provider_health_endpoint', '/v1/about'],
      ['signal_webhook_token', 'optional_webhook_token'],
      ['health_endpoint', '/connector/v1/health'],
      ['events_endpoint', '/connector/v1/events'],
      ['send_endpoint', '/connector/v1/send'],
      ['discover_endpoint', '/connector/v1/targets'],
      ['command_prefix', '!desk'],
      ['poll_interval_ms', '5000'],
      ['require_mention', 'false'],
    ],
    help: 'For built-in Signal bridge runtime, save provider auth token as connector secret, set signal_sender + signal_provider_base_url, and expose /connector/signal/webhook from this app via your public bridge host.',
  },
  whatsapp: {
    lines: [
      ['whatsapp_phone_number_id', '123456789012345'],
      ['whatsapp_verify_token', 'your_webhook_verify_token'],
      ['whatsapp_app_secret', 'your_meta_app_secret'],
      ['whatsapp_api_version', 'v22.0'],
      ['health_endpoint', '/connector/v1/health'],
      ['events_endpoint', '/connector/v1/events'],
      ['send_endpoint', '/connector/v1/send'],
      ['discover_endpoint', '/connector/v1/targets'],
      ['command_prefix', '!desk'],
      ['poll_interval_ms', '5000'],
      ['require_mention', 'false'],
    ],
    help: 'For built-in WhatsApp bridge runtime, save WhatsApp Cloud API access token as connector secret and set whatsapp_phone_number_id + whatsapp_verify_token. whatsapp_app_secret enables signature verification.',
  },
  line: {
    lines: [
      ['line_channel_secret', 'your_line_channel_secret'],
      ['health_endpoint', '/connector/v1/health'],
      ['events_endpoint', '/connector/v1/events'],
      ['send_endpoint', '/connector/v1/send'],
      ['discover_endpoint', '/connector/v1/targets'],
      ['command_prefix', '!desk'],
      ['poll_interval_ms', '5000'],
      ['require_mention', 'false'],
    ],
    help: 'For built-in LINE bridge runtime, set line_channel_secret to verify inbound webhooks. Save LINE Channel Access Token as connector secret.',
  },
  bluebubbles: {
    lines: [
      ['bluebubbles_api_base_url', 'http://127.0.0.1:1234'],
      ['bluebubbles_send_endpoint', '/api/v1/message/text'],
      ['bluebubbles_health_endpoint', '/api/v1/ping'],
      ['bluebubbles_auth_header', 'Authorization'],
      ['bluebubbles_auth_scheme', 'Bearer'],
      ['bluebubbles_sender', 'optional_sender_or_account'],
      ['bluebubbles_webhook_token', 'optional_webhook_token'],
      ['health_endpoint', '/connector/v1/health'],
      ['events_endpoint', '/connector/v1/events'],
      ['send_endpoint', '/connector/v1/send'],
      ['discover_endpoint', '/connector/v1/targets'],
      ['command_prefix', '!desk'],
      ['poll_interval_ms', '5000'],
      ['require_mention', 'false'],
    ],
    help: 'For built-in BlueBubbles bridge runtime, save BlueBubbles API token as connector secret, set bluebubbles_api_base_url, and configure webhook delivery to /connector/bluebubbles/webhook on your public bridge host.',
  },
  imessage: {
    lines: [
      ['imessage_api_base_url', 'http://127.0.0.1:1234'],
      ['imessage_send_endpoint', '/api/v1/message/text'],
      ['imessage_health_endpoint', '/api/v1/ping'],
      ['imessage_auth_header', 'Authorization'],
      ['imessage_auth_scheme', 'Bearer'],
      ['imessage_sender', 'optional_sender_or_account'],
      ['imessage_webhook_token', 'optional_webhook_token'],
      ['health_endpoint', '/connector/v1/health'],
      ['events_endpoint', '/connector/v1/events'],
      ['send_endpoint', '/connector/v1/send'],
      ['discover_endpoint', '/connector/v1/targets'],
      ['command_prefix', '!desk'],
      ['poll_interval_ms', '5000'],
      ['require_mention', 'false'],
    ],
    help: 'For built-in iMessage bridge runtime, save iMessage provider API token as connector secret, set imessage_api_base_url, and configure webhook delivery to /connector/imessage/webhook on your public bridge host.',
  },
  'nextcloud-talk': {
    lines: [
      ['nextcloud_api_base_url', 'https://cloud.example.com'],
      ['nextcloud_send_endpoint_template', '/ocs/v2.php/apps/spreed/api/v4/chat/{roomToken}'],
      ['nextcloud_health_endpoint', '/ocs/v2.php/cloud/capabilities'],
      ['nextcloud_auth_mode', 'basic'],
      ['nextcloud_username', 'your_nextcloud_user'],
      ['nextcloud_auth_header', 'Authorization'],
      ['nextcloud_auth_scheme', 'Bearer'],
      ['nextcloud_sender', 'optional_sender_or_account'],
      ['nextcloud_webhook_token', 'optional_webhook_token'],
      ['nextcloud_use_ocs_headers', 'true'],
      ['nextcloud_send_message_field', 'message'],
      ['nextcloud_send_as_form', 'false'],
      ['health_endpoint', '/connector/v1/health'],
      ['events_endpoint', '/connector/v1/events'],
      ['send_endpoint', '/connector/v1/send'],
      ['discover_endpoint', '/connector/v1/targets'],
      ['command_prefix', '!desk'],
      ['poll_interval_ms', '5000'],
      ['require_mention', 'false'],
    ],
    help: 'For built-in Nextcloud Talk bridge runtime, save app password/token as connector secret, set nextcloud_api_base_url + auth fields, and configure webhook delivery to /connector/nextcloud-talk/webhook on your public bridge host.',
  },
  nostr: {
    lines: [
      ['nostr_api_base_url', 'http://127.0.0.1:8090'],
      ['nostr_send_endpoint', '/api/v1/send'],
      ['nostr_health_endpoint', '/health'],
      ['nostr_auth_mode', 'bearer'],
      ['nostr_auth_header', 'Authorization'],
      ['nostr_auth_scheme', 'Bearer'],
      ['nostr_sender', 'optional_sender_or_account'],
      ['nostr_webhook_token', 'optional_webhook_token'],
      ['nostr_send_peer_field', 'peerId'],
      ['nostr_send_message_field', 'text'],
      ['nostr_send_as_form', 'false'],
      ['health_endpoint', '/connector/v1/health'],
      ['events_endpoint', '/connector/v1/events'],
      ['send_endpoint', '/connector/v1/send'],
      ['discover_endpoint', '/connector/v1/targets'],
      ['command_prefix', '!desk'],
      ['poll_interval_ms', '5000'],
      ['require_mention', 'false'],
    ],
    help: 'For built-in Nostr bridge runtime, save relay/worker auth token as connector secret, set nostr_api_base_url + send/auth fields, and configure webhook delivery to /connector/nostr/webhook on your public bridge host.',
  },
  tlon: {
    lines: [
      ['tlon_api_base_url', 'http://127.0.0.1:8091'],
      ['tlon_send_endpoint', '/api/v1/send'],
      ['tlon_health_endpoint', '/health'],
      ['tlon_auth_mode', 'bearer'],
      ['tlon_auth_header', 'Authorization'],
      ['tlon_auth_scheme', 'Bearer'],
      ['tlon_sender', 'optional_sender_or_account'],
      ['tlon_webhook_token', 'optional_webhook_token'],
      ['tlon_send_peer_field', 'peerId'],
      ['tlon_send_message_field', 'text'],
      ['tlon_send_as_form', 'false'],
      ['health_endpoint', '/connector/v1/health'],
      ['events_endpoint', '/connector/v1/events'],
      ['send_endpoint', '/connector/v1/send'],
      ['discover_endpoint', '/connector/v1/targets'],
      ['command_prefix', '!desk'],
      ['poll_interval_ms', '5000'],
      ['require_mention', 'false'],
    ],
    help: 'For built-in Tlon bridge runtime, save Tlon/Urbit worker auth token as connector secret, set tlon_api_base_url + send/auth fields, and configure webhook delivery to /connector/tlon/webhook on your public bridge host.',
  },
  zalo: {
    lines: [
      ['zalo_api_base_url', 'http://127.0.0.1:8092'],
      ['zalo_send_endpoint', '/api/v1/send'],
      ['zalo_health_endpoint', '/health'],
      ['zalo_auth_mode', 'bearer'],
      ['zalo_auth_header', 'Authorization'],
      ['zalo_auth_scheme', 'Bearer'],
      ['zalo_sender', 'optional_sender_or_account'],
      ['zalo_webhook_token', 'optional_webhook_token'],
      ['zalo_send_peer_field', 'peerId'],
      ['zalo_send_message_field', 'text'],
      ['zalo_send_as_form', 'false'],
      ['health_endpoint', '/connector/v1/health'],
      ['events_endpoint', '/connector/v1/events'],
      ['send_endpoint', '/connector/v1/send'],
      ['discover_endpoint', '/connector/v1/targets'],
      ['command_prefix', '!desk'],
      ['poll_interval_ms', '5000'],
      ['require_mention', 'false'],
    ],
    help: 'For built-in Zalo bridge runtime, save Zalo OA worker auth token as connector secret, set zalo_api_base_url + send/auth fields, and configure webhook delivery to /connector/zalo/webhook on your public bridge host.',
  },
  zalouser: {
    lines: [
      ['zalouser_api_base_url', 'http://127.0.0.1:8093'],
      ['zalouser_send_endpoint', '/api/v1/send'],
      ['zalouser_health_endpoint', '/health'],
      ['zalouser_auth_mode', 'bearer'],
      ['zalouser_auth_header', 'Authorization'],
      ['zalouser_auth_scheme', 'Bearer'],
      ['zalouser_sender', 'optional_sender_or_account'],
      ['zalouser_webhook_token', 'optional_webhook_token'],
      ['zalouser_send_peer_field', 'peerId'],
      ['zalouser_send_message_field', 'text'],
      ['zalouser_send_as_form', 'false'],
      ['health_endpoint', '/connector/v1/health'],
      ['events_endpoint', '/connector/v1/events'],
      ['send_endpoint', '/connector/v1/send'],
      ['discover_endpoint', '/connector/v1/targets'],
      ['command_prefix', '!desk'],
      ['poll_interval_ms', '5000'],
      ['require_mention', 'false'],
    ],
    help: 'For built-in Zalo user-message bridge runtime, save user-channel worker auth token as connector secret, set zalouser_api_base_url + send/auth fields, and configure webhook delivery to /connector/zalouser/webhook on your public bridge host.',
  },
};

export const AGENT_FALLBACK_MODEL: SelectedModel = {
  provider: 'anthropic',
  model: 'anthropic/claude-opus-4-5',
};

export const PROVIDER_NAME_BY_ID: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google AI',
  xai: 'xAI',
  ollama: 'Ollama',
  custom: 'Custom',
};

export const SETTINGS_SECTION_EXPANDED_STORAGE_KEY = 'opendeskmate.settings.expanded-sections.v1';

export const extractNodeText = (node: ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((entry) => extractNodeText(entry)).join(' ');
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return extractNodeText(node.props.children);
  }
  return '';
};

const toSettingsSectionSlug = (heading: string): string =>
  heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const getSettingsSectionKey = (heading: string): string =>
  `settings-section-${toSettingsSectionSlug(heading) || 'unknown'}`;

export interface SkillStatus {
  id: string;
  name: string;
  description?: string;
  installed: boolean;
  installable: boolean;
}

export interface UserSkillEntry {
  id: string;
  name: string;
  description?: string;
  source: 'managed' | 'workspace' | 'bundled' | 'extra';
  baseDir: string;
  filePath: string;
  metadata?: {
    opendeskmate?: {
      skillKey?: string;
      generatedBy?: string;
      generatedByAgentName?: string;
      createdBy?: string;
      origin?: string;
    };
    clawdbot?: {
      skillKey?: string;
      generatedBy?: string;
      generatedByAgentName?: string;
      createdBy?: string;
      origin?: string;
    };
  };
  manifest?: {
    version: string;
    createdAt: string;
    updatedAt: string;
    state?: 'active' | 'deprecated' | 'disabled';
  };
  generatedByUserInstruction?: boolean;
  generatedByAgentName?: string;
  originLabel?: string;
  visibilityScope?: 'private' | 'selected' | 'all';
  visibilityOwnerAgentId?: string;
  visibilitySharedWithAgentIds?: string[];
  bodyPreview?: string;
  editable: boolean;
}

export interface UserSkillsReport {
  managedSkillsDir: string;
  workspaceSkillsDir?: string | null;
  bundledSkillsDir?: string | null;
  version: number;
  skills: UserSkillEntry[];
}

export interface UserSkillInstallOption {
  id: string;
  kind: 'node' | 'brew' | 'go' | 'uv' | 'download';
  label: string;
  bins: string[];
}

export interface UserSkillDependencyStatusEntry extends UserSkillEntry {
  skillKey: string;
  always: boolean;
  disabled: boolean;
  eligible: boolean;
  requirements?: {
    bins: string[];
    anyBins: string[];
    env: string[];
    config: string[];
    os: string[];
  };
  missing: {
    bins: string[];
    anyBins: string[];
    env: string[];
    config: string[];
    os: string[];
  };
  configChecks?: Array<{
    path: string;
    value: unknown;
    satisfied: boolean;
  }>;
  install: UserSkillInstallOption[];
}

export interface UserSkillDependencyStatusReport extends Omit<UserSkillsReport, 'skills'> {
  skills: UserSkillDependencyStatusEntry[];
}

export interface UserSkillZipCandidate {
  skillId: string;
  name: string;
  description?: string;
  relPath: string;
}

export interface UserSkillZipInspectResponse {
  sessionId: string;
  candidates: UserSkillZipCandidate[];
  message?: string;
}

export interface UserSkillZipInstallResult {
  ok: boolean;
  message: string;
  installedSkillId?: string;
  destDir?: string;
}

export type DoctorStatus = 'ok' | 'warning' | 'error';

export interface DoctorCheck {
  id: string;
  title: string;
  status: DoctorStatus;
  message: string;
}

export const REQUIRED_SKILLS = ['dev-browser', 'file-permission'];

export const NODE_BADGE_COLORS = [
  '#1d4ed8',
  '#2563eb',
  '#0ea5e9',
  '#14b8a6',
  '#22c55e',
  '#84cc16',
  '#f59e0b',
  '#f97316',
  '#ef4444',
  '#ec4899',
  '#a855f7',
  '#6366f1',
  '#0f172a',
  '#475569',
];

export const NODE_BADGE_ICONS = [
  { id: 'cpu', label: 'CPU', Icon: Cpu },
  { id: 'smartphone', label: 'Phone', Icon: Smartphone },
  { id: 'tablet', label: 'Tablet', Icon: Tablet },
  { id: 'laptop', label: 'Laptop', Icon: Laptop },
  { id: 'monitor', label: 'Monitor', Icon: Monitor },
  { id: 'camera', label: 'Camera', Icon: Camera },
  { id: 'mic', label: 'Microphone', Icon: Mic },
  { id: 'compass', label: 'Compass', Icon: Compass },
  { id: 'globe', label: 'Globe', Icon: Globe },
  { id: 'map-pin', label: 'Location', Icon: MapPin },
  { id: 'wifi', label: 'WiFi', Icon: Wifi },
  { id: 'bluetooth', label: 'Bluetooth', Icon: Bluetooth },
  { id: 'shield', label: 'Shield', Icon: Shield },
  { id: 'key', label: 'Key', Icon: Key },
  { id: 'lock', label: 'Lock', Icon: Lock },
  { id: 'unlock', label: 'Unlock', Icon: Unlock },
  { id: 'zap', label: 'Zap', Icon: Zap },
  { id: 'activity', label: 'Activity', Icon: Activity },
  { id: 'sparkles', label: 'Sparkles', Icon: Sparkles },
  { id: 'star', label: 'Star', Icon: Star },
  { id: 'heart', label: 'Heart', Icon: Heart },
  { id: 'bell', label: 'Bell', Icon: Bell },
  { id: 'folder', label: 'Folder', Icon: Folder },
  { id: 'file-text', label: 'File', Icon: FileText },
  { id: 'image', label: 'Image', Icon: Image },
  { id: 'video', label: 'Video', Icon: Video },
  { id: 'headphones', label: 'Headphones', Icon: Headphones },
  { id: 'gamepad', label: 'Gamepad', Icon: Gamepad2 },
  { id: 'server', label: 'Server', Icon: Server },
  { id: 'cloud', label: 'Cloud', Icon: Cloud },
];

export const validateCustomProviderModels = (
  providerId: string,
  text: string
): { models: ProviderConfig['models']; issues: Array<{ line: number; message: string }> } => {
  const rawLines = text.split(/\r?\n/g);
  const issues: Array<{ line: number; message: string }> = [];
  const models: ProviderConfig['models'] = [];

  let hasAnyModelLine = false;
  for (let i = 0; i < rawLines.length; i += 1) {
    const lineNumber = i + 1;
    const line = rawLines[i].trim();
    if (!line) continue;
    hasAnyModelLine = true;

    const parts = line.split('|').map((part) => part.trim());
    if (parts.length !== 5) {
      issues.push({
        line: lineNumber,
        message: `Model line ${lineNumber}: expected exactly 5 fields (id|name|context|max_output|vision).`,
      });
      continue;
    }

    const [modelId, displayName, contextRaw, maxOutputRaw, visionRaw] = parts;

    if (!modelId) {
      issues.push({ line: lineNumber, message: `Model line ${lineNumber}: id is required.` });
      continue;
    }
    if (!displayName) {
      issues.push({ line: lineNumber, message: `Model line ${lineNumber}: name is required.` });
      continue;
    }

    const contextWindow = Number(contextRaw);
    if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
      issues.push({
        line: lineNumber,
        message: `Model line ${lineNumber}: context window must be a positive number.`,
      });
      continue;
    }

    const maxOutputTokens = Number(maxOutputRaw);
    if (!Number.isFinite(maxOutputTokens) || maxOutputTokens <= 0) {
      issues.push({
        line: lineNumber,
        message: `Model line ${lineNumber}: max output tokens must be a positive number.`,
      });
      continue;
    }

    const normalizedVision = visionRaw.toLowerCase();
    if (normalizedVision !== 'true' && normalizedVision !== 'false') {
      issues.push({
        line: lineNumber,
        message: `Model line ${lineNumber}: vision flag must be true/false.`,
      });
      continue;
    }

    models.push({
      id: modelId,
      displayName,
      provider: providerId,
      fullId: `${providerId}/${modelId}`,
      contextWindow: Math.floor(contextWindow),
      maxOutputTokens: Math.floor(maxOutputTokens),
      supportsVision: normalizedVision === 'true',
    });
  }

  if (!hasAnyModelLine) {
    issues.push({ line: 0, message: 'At least one model is required.' });
  }

  return { models, issues };
};

export const parseCustomProviderModels = (
  providerId: string,
  text: string
): ProviderConfig['models'] => {
  const validation = validateCustomProviderModels(providerId, text);
  if (validation.issues.length > 0) {
    throw new Error(validation.issues[0].message);
  }
  return validation.models;
};

export const formatAllowlist = (values: string[] | undefined): string =>
  (values || []).join(', ');

export const parseAllowlist = (value: string): string[] =>
  value
    .split(/[\s,]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);

export const parseGatewayConnectorMetadata = (value: string): Record<string, string> | undefined => {
  const result: Record<string, string> = {};
  const lines = value
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    if (!key || !rawValue) continue;
    result[key] = rawValue;
  }
  return Object.keys(result).length > 0 ? result : undefined;
};

export const getGatewayConnectorMetadataValue = (
  metadata: Record<string, string> | undefined,
  key: string
): string | undefined => {
  if (!metadata) return undefined;
  const target = key.toLowerCase();
  for (const [entryKey, entryValue] of Object.entries(metadata)) {
    if (entryKey.toLowerCase() === target) return entryValue;
  }
  return undefined;
};

export const parseTruthy = (value: string | undefined, fallback = false): boolean => {
  const normalized = (value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

export const formatIsoDateTime = (value?: string): string => {
  if (!value) return 'n/a';
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Date(timestamp).toLocaleString();
};
