'use client';

import {
  useState,
  useEffect,
  useMemo,
  useDeferredValue,
  useRef,
  Children,
  Fragment,
  isValidElement,
  cloneElement,
  type ReactNode,
  type ReactElement,
} from 'react';
import { getAccomplish } from '@/lib/accomplish';
import { analytics } from '@/lib/analytics';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Trash2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Cloud,
  Mail,
  MessageCircle,
  MessagesSquare,
  Orbit,
  Radio,
} from 'lucide-react';
import {
  SiCanva,
  SiDiscord,
  SiDropbox,
  SiFigma,
  SiGithub,
  SiGmail,
  SiGooglecalendar,
  SiGooglechat,
  SiGoogledocs,
  SiGoogledrive,
  SiGooglemaps,
  SiGooglephotos,
  SiGooglesheets,
  SiGoogleslides,
  SiGoogletasks,
  SiImessage,
  SiLine,
  SiMatrix,
  SiMattermost,
  SiMiro,
  SiNextcloud,
  SiNotion,
  SiObsidian,
  SiSignal,
  SiSlack,
  SiSupabase,
  SiTelegram,
  SiTrello,
  SiWhatsapp,
  SiYoutube,
  SiZalo,
} from 'react-icons/si';
import type {
  ApiKeyConfig,
  BuildDiffEnforcementMode,
  ProviderConfig,
  ProviderType,
  SelectedModel,
  ScheduledTask,
  ScheduleConfig,
  AgentProfile,
  AppConnectorExtensionState,
  AppConnectorRuntimeStatus,
  AppConnectorRuntimeTestResult,
  DiscordConnectorConfig,
  DiscordConnectorStatus,
  DiscordPairingRequest,
  GatewayPeerKind,
  TelegramConnectorConfig,
  TelegramConnectorStatus,
  TelegramPairingRequest,
  VoiceWakeConfig,
  NodePairingList,
  GatewayConfig,
  GatewayConnectorRuntimeDiscoveryItem,
  GatewayConnectorDiscoverySnapshot,
  GatewayConnectorExtensionState,
  GatewayConnectorRuntimeStatus,
  GatewayConnectorRuntimeTestResult,
  GatewayRouteBinding,
  GatewayRunRecord,
  GatewayRuntimeStatus,
  GatewaySessionRecord,
  UsagePricingSettings,
  UsagePricingAutofillResult,
  UserSkillAssistantAskResponse,
} from '@accomplish/shared';
import { DEFAULT_PROVIDERS } from '@accomplish/shared';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import appIcon from '../../../../resources/icon.png';
import { useAgentStore } from '@/stores/agentStore';
import { useAttachmentStore } from '@/stores/attachmentStore';
import AgentAvatarPicker, { AgentAvatarIcon } from './AgentAvatarPicker';
import {
  AGENT_FALLBACK_MODEL,
  API_KEY_PROVIDER_LABEL_OVERRIDES,
  BRIDGE_GATEWAY_RUNTIME_CONNECTOR_IDS,
  CONNECTOR_METADATA_TEMPLATE_BY_ID,
  CUSTOM_PROVIDER_ID_RE,
  CUSTOM_PROVIDER_MODELS_FORMAT_HELPER,
  extractNodeText,
  FIRST_PARTY_GATEWAY_CONNECTOR_IDS,
  formatAllowlist,
  formatIsoDateTime,
  getSettingsSectionKey,
  getGatewayConnectorMetadataValue,
  KNOWN_API_KEY_FORMATS,
  NODE_BADGE_COLORS,
  NODE_BADGE_ICONS,
  parseAllowlist,
  parseCustomProviderModels,
  parseGatewayConnectorMetadata,
  parseTruthy,
  PROVIDER_NAME_BY_ID,
  REQUIRED_SKILLS,
  SETTINGS_SECTION_EXPANDED_STORAGE_KEY,
  type DoctorCheck,
  type SkillStatus,
  type UserSkillDependencyStatusEntry,
  type UserSkillDependencyStatusReport,
  type UserSkillEntry,
  type UserSkillInstallOption,
  type UserSkillsReport,
  type UserSkillZipCandidate,
  type UserSkillZipInspectResponse,
  type UserSkillZipInstallResult,
  validateCustomProviderModels,
} from './SettingsDialog.shared';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApiKeySaved?: () => void;
}

const AGENT_LOOP_DEFAULT_MAX_ITERATIONS = 4;
const AGENT_LOOP_DEFAULT_TIMEOUT_SECONDS = 5 * 60;
const AGENT_HEARTBEAT_DEFAULT_INTERVAL_MINUTES = 5;
const AGENT_HEARTBEAT_DEFAULT_DAILY_TIME = '09:00';
const AGENT_HEARTBEAT_DEFAULT_TIME_ZONE = 'system';
const AGENT_HEARTBEAT_DEFAULT_WINDOW_START_TIME = '09:00';
const AGENT_HEARTBEAT_DEFAULT_WINDOW_END_TIME = '17:00';
const AGENT_HEARTBEAT_DEFAULT_PROMPT = [
  'Heartbeat check-in:',
  '- Review your current context and memory.',
  '- If there is actionable follow-up work, do it.',
  '- If nothing is needed, briefly report that systems are stable.',
].join('\n');

function json5ishToJson(text: string): string {
  let s = text.trim();
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s.replace(/(^|[^:])\/\/.*$/gm, '$1');
  s = s.replace(/,\s*([}\]])/g, '$1');

  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch !== '\'') {
      out += ch;
      continue;
    }
    let j = i + 1;
    let str = '';
    while (j < s.length) {
      const c = s[j];
      if (c === '\\' && j + 1 < s.length) {
        const next = s[j + 1];
        str += next;
        j += 2;
        continue;
      }
      if (c === '\'') break;
      str += c;
      j += 1;
    }
    out += `"${str.replace(/"/g, '\\"')}"`;
    i = j;
  }
  s = out;
  s = s.replace(/([,{]\s*)([A-Za-z_$][A-Za-z0-9_$-]*)(\s*:)/g, '$1"$2"$3');
  return s;
}

function parseJson5ishObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  const parseOnce = (value: string): unknown => JSON.parse(value);
  let parsed: unknown;
  try {
    parsed = parseOnce(trimmed);
  } catch {
    try {
      parsed = parseOnce(json5ishToJson(trimmed));
    } catch {
      throw new Error('Config must be a valid JSON object.');
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Config must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

function parseLocalConfigPath(pathStr: string): string[] {
  return String(pathStr || '')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);
}

function getLocalConfigPathValue(obj: unknown, pathStr: string): unknown {
  const parts = parseLocalConfigPath(pathStr);
  if (parts.length === 0) return undefined;
  let cur: unknown = obj;
  for (const part of parts) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function setLocalConfigPathValue(obj: Record<string, unknown>, pathStr: string, value: unknown): void {
  const parts = parseLocalConfigPath(pathStr);
  if (parts.length === 0) return;
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    const next = cur[key];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      const branch: Record<string, unknown> = {};
      cur[key] = branch;
      cur = branch;
      continue;
    }
    cur = next as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

function requiredConfigPlaceholder(pathStr: string): unknown {
  const lower = String(pathStr || '').toLowerCase();
  if (lower.endsWith('.nodes') || lower.endsWith('.ids') || lower.endsWith('.list')) return [];
  if (lower.endsWith('.enabled') || lower.endsWith('.allow') || lower.endsWith('.required')) return true;
  return '';
}

function renderMessagingConnectorIcon(connectorId: string): ReactNode {
  const iconClass = 'h-4 w-4 shrink-0';
  switch (connectorId) {
    case 'discord':
      return <SiDiscord className={`${iconClass} text-[#5865F2]`} aria-hidden="true" />;
    case 'telegram':
      return <SiTelegram className={`${iconClass} text-[#26A5E4]`} aria-hidden="true" />;
    case 'slack':
      return <SiSlack className={`${iconClass} text-[#4A154B]`} aria-hidden="true" />;
    case 'matrix':
      return <SiMatrix className={iconClass} aria-hidden="true" />;
    case 'mattermost':
      return <SiMattermost className={`${iconClass} text-[#0058CC]`} aria-hidden="true" />;
    case 'googlechat':
      return <SiGooglechat className={`${iconClass} text-[#34A853]`} aria-hidden="true" />;
    case 'signal':
      return <SiSignal className={`${iconClass} text-[#3A76F0]`} aria-hidden="true" />;
    case 'whatsapp':
      return <SiWhatsapp className={`${iconClass} text-[#25D366]`} aria-hidden="true" />;
    case 'line':
      return <SiLine className={`${iconClass} text-[#06C755]`} aria-hidden="true" />;
    case 'imessage':
      return <SiImessage className={`${iconClass} text-[#0A84FF]`} aria-hidden="true" />;
    case 'nextcloud-talk':
      return <SiNextcloud className={`${iconClass} text-[#0082C9]`} aria-hidden="true" />;
    case 'zalo':
    case 'zalouser':
      return <SiZalo className={`${iconClass} text-[#0068FF]`} aria-hidden="true" />;
    case 'bluebubbles':
      return <MessageCircle className={`${iconClass} text-[#3C7CFF]`} aria-hidden="true" />;
    case 'msteams':
      return <MessagesSquare className={`${iconClass} text-[#5B5FC7]`} aria-hidden="true" />;
    case 'nostr':
      return <Radio className={`${iconClass} text-[#8B5CF6]`} aria-hidden="true" />;
    case 'tlon':
      return <Orbit className={`${iconClass} text-[#0EA5E9]`} aria-hidden="true" />;
    default:
      return <MessageCircle className={iconClass} aria-hidden="true" />;
  }
}

function resolveGatewayConnectorRuntimeMode(
  connectorId: string,
  runtimeStatus?: GatewayConnectorRuntimeStatus | null
): GatewayConnectorRuntimeStatus['mode'] {
  const explicitMode = runtimeStatus?.mode;
  if (explicitMode === 'native' || explicitMode === 'first-party' || explicitMode === 'external-bridge') {
    return explicitMode;
  }
  if (connectorId === 'discord' || connectorId === 'telegram') {
    return 'native';
  }
  if (BRIDGE_GATEWAY_RUNTIME_CONNECTOR_IDS.has(connectorId)) {
    return 'external-bridge';
  }
  return 'first-party';
}

function formatGatewayConnectorRuntimeLabel(
  connectorId: string,
  runtimeStatus?: GatewayConnectorRuntimeStatus | null
): string {
  const mode = resolveGatewayConnectorRuntimeMode(connectorId, runtimeStatus);
  if (runtimeStatus) {
    if (mode === 'native') return runtimeStatus.running ? 'Native runtime on' : 'Native runtime off';
    if (mode === 'external-bridge') return runtimeStatus.running ? 'External bridge on' : 'External bridge off';
    return runtimeStatus.running ? 'First-party runtime on' : 'First-party runtime off';
  }
  if (mode === 'native') return 'Native runtime';
  if (mode === 'external-bridge') return 'External bridge';
  return 'First-party runtime';
}

function renderAppConnectorIcon(connectorId: string): ReactNode {
  const iconClass = 'h-4 w-4 shrink-0';
  switch (connectorId) {
    case 'notion':
      return <SiNotion className={iconClass} aria-hidden="true" />;
    case 'trello':
      return <SiTrello className={`${iconClass} text-[#026AA7]`} aria-hidden="true" />;
    case 'obsidian':
      return <SiObsidian className={`${iconClass} text-[#7C3AED]`} aria-hidden="true" />;
    case 'github':
      return <SiGithub className={iconClass} aria-hidden="true" />;
    case 'slack':
      return <SiSlack className={`${iconClass} text-[#4A154B]`} aria-hidden="true" />;
    case 'dropbox':
      return <SiDropbox className={`${iconClass} text-[#0061FF]`} aria-hidden="true" />;
    case 'canva':
      return <SiCanva className={`${iconClass} text-[#00C4CC]`} aria-hidden="true" />;
    case 'onedrive':
      return <Cloud className={`${iconClass} text-[#0078D4]`} aria-hidden="true" />;
    case 'supabase':
      return <SiSupabase className={`${iconClass} text-[#3ECF8E]`} aria-hidden="true" />;
    case 'google-slides':
      return <SiGoogleslides className={`${iconClass} text-[#FBBC05]`} aria-hidden="true" />;
    case 'google-tasks':
      return <SiGoogletasks className={`${iconClass} text-[#FF7043]`} aria-hidden="true" />;
    case 'google-sheets':
      return <SiGooglesheets className={`${iconClass} text-[#34A853]`} aria-hidden="true" />;
    case 'google-docs':
      return <SiGoogledocs className={`${iconClass} text-[#4285F4]`} aria-hidden="true" />;
    case 'google-drive':
      return <SiGoogledrive className={`${iconClass} text-[#34A853]`} aria-hidden="true" />;
    case 'google-photos':
      return <SiGooglephotos className={`${iconClass} text-[#EA4335]`} aria-hidden="true" />;
    case 'google-maps':
      return <SiGooglemaps className={`${iconClass} text-[#34A853]`} aria-hidden="true" />;
    case 'youtube':
      return <SiYoutube className={`${iconClass} text-[#FF0000]`} aria-hidden="true" />;
    case 'figma':
      return <SiFigma className={iconClass} aria-hidden="true" />;
    case 'miro':
      return <SiMiro className={`${iconClass} text-[#FFD02F]`} aria-hidden="true" />;
    case 'gmail':
      return <SiGmail className={`${iconClass} text-[#EA4335]`} aria-hidden="true" />;
    case 'email-triggers':
      return <Mail className={`${iconClass} text-[#EA4335]`} aria-hidden="true" />;
    case 'google-calendar':
      return <SiGooglecalendar className={`${iconClass} text-[#4285F4]`} aria-hidden="true" />;
    case 'microsoft-outlook':
      return <Mail className={`${iconClass} text-[#0078D4]`} aria-hidden="true" />;
    default:
      return <MessageCircle className={iconClass} aria-hidden="true" />;
  }
}

export default function SettingsDialog({ open, onOpenChange, onApiKeySaved }: SettingsDialogProps) {
  const {
    agents,
    activeAgentId,
    defaultAgentId,
    loadAgents,
    setActiveAgent,
    setDefaultAgent,
    upsertAgent,
    deleteAgent,
  } = useAgentStore();
  const activeAgent = agents.find((agent) => agent.id === activeAgentId);
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState('anthropic');
  const [modelProviders, setModelProviders] = useState<ProviderConfig[]>(DEFAULT_PROVIDERS);
  const [customModelProviders, setCustomModelProviders] = useState<ProviderConfig[]>([]);
  const [customProviderId, setCustomProviderId] = useState('');
  const [customProviderName, setCustomProviderName] = useState('');
  const [customProviderBaseUrl, setCustomProviderBaseUrl] = useState('');
  const [customProviderRequiresApiKey, setCustomProviderRequiresApiKey] = useState(true);
  const [customProviderModelsText, setCustomProviderModelsText] = useState('');
  const [customProviderSaving, setCustomProviderSaving] = useState(false);
  const [customProviderError, setCustomProviderError] = useState<string | null>(null);
  const [customProviderStatus, setCustomProviderStatus] = useState<string | null>(null);
  const [editingCustomProviderId, setEditingCustomProviderId] = useState<string | null>(null);
  const [deletingCustomProviderId, setDeletingCustomProviderId] = useState<string | null>(null);
  const apiKeyInputRef = useRef<HTMLInputElement | null>(null);
  const customProviderIdInputRef = useRef<HTMLInputElement | null>(null);
  const customProviderNameInputRef = useRef<HTMLInputElement | null>(null);
  const customProviderBaseUrlInputRef = useRef<HTMLInputElement | null>(null);
  const customProviderModelsTextRef = useRef<HTMLTextAreaElement | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedKeys, setSavedKeys] = useState<ApiKeyConfig[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [apiKeyStatus, setApiKeyStatus] = useState<Record<string, { exists: boolean; prefix?: string }> | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [loadingDebug, setLoadingDebug] = useState(true);
  const [appVersion, setAppVersion] = useState('');
  const [appPlatform, setAppPlatform] = useState('');
  const [selectedModel, setSelectedModel] = useState<SelectedModel | null>(null);
  const [agentSpeedMode, setAgentSpeedMode] = useState<'fast' | 'balanced' | 'deep'>('fast');
  const [agentSpeedModeSaving, setAgentSpeedModeSaving] = useState(false);
  const [buildDiffEnforcementMode, setBuildDiffEnforcementMode] = useState<BuildDiffEnforcementMode>('preview-only');
  const [buildDiffEnforcementSaving, setBuildDiffEnforcementSaving] = useState(false);
  const [loadingModel, setLoadingModel] = useState(true);
  const [modelStatusMessage, setModelStatusMessage] = useState<string | null>(null);
  const [modelLimitOverrides, setModelLimitOverrides] = useState<Record<string, { contextWindowTokens?: number }>>({});
  const [modelLimitsLoading, setModelLimitsLoading] = useState(false);
  const [modelLimitsError, setModelLimitsError] = useState<string | null>(null);
  const [modelLimitsOpen, setModelLimitsOpen] = useState(false);
  const [modelLimitsEdits, setModelLimitsEdits] = useState<Record<string, string>>({});
  const [modelLimitsSaving, setModelLimitsSaving] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<'cloud' | 'local'>('cloud');
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [ollamaModels, setOllamaModels] = useState<Array<{ id: string; displayName: string; size: number }>>([]);
  const [ollamaConnected, setOllamaConnected] = useState(false);
  const [ollamaError, setOllamaError] = useState<string | null>(null);
  const [testingOllama, setTestingOllama] = useState(false);
  const [selectedOllamaModel, setSelectedOllamaModel] = useState<string>('');
  const [savingOllama, setSavingOllama] = useState(false);
  const [keyToDelete, setKeyToDelete] = useState<string | null>(null);
  const [skillsStatus, setSkillsStatus] = useState<SkillStatus[]>([]);
  const [loadingSkills, setLoadingSkills] = useState(true);
  const [skillsError, setSkillsError] = useState<string | null>(null);

  const [userSkillsReport, setUserSkillsReport] = useState<UserSkillsReport | null>(null);
  const [loadingUserSkills, setLoadingUserSkills] = useState(true);
  const [userSkillsError, setUserSkillsError] = useState<string | null>(null);
  const [userSkillsDepsReport, setUserSkillsDepsReport] = useState<UserSkillDependencyStatusReport | null>(null);
  const [loadingUserSkillsDeps, setLoadingUserSkillsDeps] = useState(true);
  const [userSkillsDepsError, setUserSkillsDepsError] = useState<string | null>(null);
  const [installingUserSkillDep, setInstallingUserSkillDep] = useState<{ skillId: string; installId: string } | null>(null);
  const [configuringUserSkill, setConfiguringUserSkill] = useState<UserSkillDependencyStatusEntry | null>(null);
  const [configuringUserSkillJson, setConfiguringUserSkillJson] = useState('');
  const [configuringUserSkillError, setConfiguringUserSkillError] = useState<string | null>(null);
  const [savingUserSkillConfig, setSavingUserSkillConfig] = useState(false);
  const [skillAssistantOpen, setSkillAssistantOpen] = useState(false);
  const [skillAssistantMode, setSkillAssistantMode] = useState<'general' | 'configure' | 'edit'>('general');
  const [skillAssistantTargetValue, setSkillAssistantTargetValue] = useState('');
  const [skillAssistantQuestion, setSkillAssistantQuestion] = useState('');
  const [skillAssistantDraftContent, setSkillAssistantDraftContent] = useState('');
  const [skillAssistantFormVersion, setSkillAssistantFormVersion] = useState(0);
  const [skillAssistantAnswer, setSkillAssistantAnswer] = useState('');
  const [skillAssistantError, setSkillAssistantError] = useState<string | null>(null);
  const [skillAssistantLoading, setSkillAssistantLoading] = useState(false);
  const [skillAssistantModelOverrideEnabled, setSkillAssistantModelOverrideEnabled] = useState(false);
  const [skillAssistantModelProvider, setSkillAssistantModelProvider] = useState<ProviderType>('anthropic');
  const [skillAssistantModelId, setSkillAssistantModelId] = useState(AGENT_FALLBACK_MODEL.model);
  const [skillAssistantModelBaseUrl, setSkillAssistantModelBaseUrl] = useState('');
  const [skillAssistantModelSaving, setSkillAssistantModelSaving] = useState(false);
  const [skillAssistantModelError, setSkillAssistantModelError] = useState<string | null>(null);
  const [skillAssistantModelStatus, setSkillAssistantModelStatus] = useState<string | null>(null);
  const skillAssistantModeInputRef = useRef<HTMLSelectElement | null>(null);
  const skillAssistantTargetInputRef = useRef<HTMLSelectElement | null>(null);
  const skillAssistantQuestionInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [creatingUserSkill, setCreatingUserSkill] = useState(false);
  const [newUserSkillId, setNewUserSkillId] = useState('');
  const [newUserSkillName, setNewUserSkillName] = useState('');
  const [newUserSkillDesc, setNewUserSkillDesc] = useState('');
  const [editingUserSkill, setEditingUserSkill] = useState<UserSkillEntry | null>(null);
  const [editingUserSkillContent, setEditingUserSkillContent] = useState('');
  const [savingUserSkill, setSavingUserSkill] = useState(false);
  const [sharingUserSkill, setSharingUserSkill] = useState<UserSkillEntry | null>(null);
  const [shareUserSkillScope, setShareUserSkillScope] = useState<'private' | 'selected' | 'all'>('private');
  const [shareUserSkillAgentIds, setShareUserSkillAgentIds] = useState<string[]>([]);
  const [savingShareUserSkill, setSavingShareUserSkill] = useState(false);
  const [shareUserSkillError, setShareUserSkillError] = useState<string | null>(null);
  const [importingUserSkillZip, setImportingUserSkillZip] = useState(false);
  const [importZipMode, setImportZipMode] = useState<'github' | 'local'>('github');
  const [importZipUrl, setImportZipUrl] = useState('');
  const [importZipLocalPath, setImportZipLocalPath] = useState<string | null>(null);
  const [importZipInspecting, setImportZipInspecting] = useState(false);
  const [importZipInstalling, setImportZipInstalling] = useState(false);
  const [importZipSession, setImportZipSession] = useState<string | null>(null);
  const [importZipCandidates, setImportZipCandidates] = useState<UserSkillZipCandidate[]>([]);
  const [importZipSelected, setImportZipSelected] = useState<UserSkillZipCandidate | null>(null);
  const [importZipDestId, setImportZipDestId] = useState('');
  const [importZipOverwrite, setImportZipOverwrite] = useState(false);
  const [importZipError, setImportZipError] = useState<string | null>(null);
  const [installingSkill, setInstallingSkill] = useState<string | null>(null);
  const [uninstallingSkill, setUninstallingSkill] = useState<string | null>(null);
  const [uninstallConfirmSkillId, setUninstallConfirmSkillId] = useState<string | null>(null);
  const [deleteConfirmUserSkill, setDeleteConfirmUserSkill] = useState<{ skillId: string; name: string; source: 'managed' | 'workspace' | 'bundled' | 'extra' } | null>(null);
  const [deletingUserSkill, setDeletingUserSkill] = useState(false);
  const [installingAll, setInstallingAll] = useState(false);
  const [runInBackground, setRunInBackgroundState] = useState(false);
  const [launchAtLogin, setLaunchAtLoginState] = useState(false);
  const [mobileNodesEnabled, setMobileNodesEnabledState] = useState(true);
  const [mobileNodesMaxLivePreviews, setMobileNodesMaxLivePreviewsState] = useState(3);
  const [mobileNodesDisplayName, setMobileNodesDisplayNameState] = useState('');
  const [webhookBindMode, setWebhookBindModeState] = useState<'localhost' | 'all'>('localhost');
  const [webhookBindNeedsRestart, setWebhookBindNeedsRestart] = useState(false);
  const [startupSaving, setStartupSaving] = useState(false);
  const [browserProfile, setBrowserProfileState] = useState('default');
  const [browserProfileSaving, setBrowserProfileSaving] = useState(false);
  const [workspaceRoot, setWorkspaceRootState] = useState<string | null>(null);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [memoryLongTerm, setMemoryLongTerm] = useState('');
  const [memoryDaily, setMemoryDaily] = useState('');
  const [memoryDailyDate, setMemoryDailyDate] = useState('');
  const [memoryDailyFiles, setMemoryDailyFiles] = useState<string[]>([]);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memorySaving, setMemorySaving] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const memoryLongTermRef = useRef<HTMLTextAreaElement | null>(null);
  const memoryDailyRef = useRef<HTMLTextAreaElement | null>(null);
  const [agentFormId, setAgentFormId] = useState<string | null>(null);
  const [agentName, setAgentName] = useState('');
  const [agentRoleName, setAgentRoleName] = useState('');
  const [agentDescription, setAgentDescription] = useState('');
  const [agentWorkspaceRoot, setAgentWorkspaceRoot] = useState('');
  const [agentSystemPrompt, setAgentSystemPrompt] = useState('');
  const [agentAvatar, setAgentAvatar] = useState<string | undefined>(undefined);
  const [agentAvatarColor, setAgentAvatarColor] = useState<string | undefined>(undefined);
  const [agentModelOverrideEnabled, setAgentModelOverrideEnabled] = useState(false);
  const [agentModelProvider, setAgentModelProvider] = useState<ProviderType>('anthropic');
  const [agentModelId, setAgentModelId] = useState(AGENT_FALLBACK_MODEL.model);
  const [agentModelBaseUrl, setAgentModelBaseUrl] = useState('');
  const [agentLoopEnabled, setAgentLoopEnabled] = useState(false);
  const [agentLoopMaxIterations, setAgentLoopMaxIterations] = useState(String(AGENT_LOOP_DEFAULT_MAX_ITERATIONS));
  const [agentLoopTimeoutSeconds, setAgentLoopTimeoutSeconds] = useState(String(AGENT_LOOP_DEFAULT_TIMEOUT_SECONDS));
  const [agentHeartbeatEnabled, setAgentHeartbeatEnabled] = useState(false);
  const [agentHeartbeatScheduleMode, setAgentHeartbeatScheduleMode] = useState<'interval' | 'daily'>('interval');
  const [agentHeartbeatIntervalMinutes, setAgentHeartbeatIntervalMinutes] = useState(String(AGENT_HEARTBEAT_DEFAULT_INTERVAL_MINUTES));
  const [agentHeartbeatDailyTime, setAgentHeartbeatDailyTime] = useState(AGENT_HEARTBEAT_DEFAULT_DAILY_TIME);
  const [agentHeartbeatTimeZone, setAgentHeartbeatTimeZone] = useState(AGENT_HEARTBEAT_DEFAULT_TIME_ZONE);
  const [agentHeartbeatWindowEnabled, setAgentHeartbeatWindowEnabled] = useState(false);
  const [agentHeartbeatWindowStartTime, setAgentHeartbeatWindowStartTime] = useState(AGENT_HEARTBEAT_DEFAULT_WINDOW_START_TIME);
  const [agentHeartbeatWindowEndTime, setAgentHeartbeatWindowEndTime] = useState(AGENT_HEARTBEAT_DEFAULT_WINDOW_END_TIME);
  const [agentHeartbeatPrompt, setAgentHeartbeatPrompt] = useState(AGENT_HEARTBEAT_DEFAULT_PROMPT);
  const [agentAutoSkillEnabled, setAgentAutoSkillEnabled] = useState(false);
  const [agentAutoSkillAutoPromoteLowRisk, setAgentAutoSkillAutoPromoteLowRisk] = useState(false);
  const [showHeartbeatAutomationModeDialog, setShowHeartbeatAutomationModeDialog] = useState(false);
  const [agentSaving, setAgentSaving] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [agentFormVersion, setAgentFormVersion] = useState(0);
  const agentNameInputRef = useRef<HTMLInputElement | null>(null);
  const agentRoleNameInputRef = useRef<HTMLInputElement | null>(null);
  const agentDescriptionInputRef = useRef<HTMLInputElement | null>(null);
  const agentWorkspaceInputRef = useRef<HTMLInputElement | null>(null);
  const agentSystemPromptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const agentLoopMaxIterationsInputRef = useRef<HTMLInputElement | null>(null);
  const agentLoopTimeoutInputRef = useRef<HTMLInputElement | null>(null);
  const agentHeartbeatIntervalInputRef = useRef<HTMLSelectElement | null>(null);
  const agentHeartbeatDailyTimeInputRef = useRef<HTMLInputElement | null>(null);
  const agentHeartbeatTimeZoneInputRef = useRef<HTMLInputElement | null>(null);
  const agentHeartbeatWindowStartInputRef = useRef<HTMLInputElement | null>(null);
  const agentHeartbeatWindowEndInputRef = useRef<HTMLInputElement | null>(null);
  const agentHeartbeatPromptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const mobileNodesMaxLivePreviewsInputRef = useRef<HTMLInputElement | null>(null);
  const mobileNodesDisplayNameInputRef = useRef<HTMLInputElement | null>(null);
  const [doctorChecks, setDoctorChecks] = useState<DoctorCheck[]>([]);
  const [doctorRunning, setDoctorRunning] = useState(false);
  const [automationInfo, setAutomationInfo] = useState<{
    webhookUrl: string;
    localUrl: string;
    lanUrls: string[];
    publicUrl: string | null;
    bindMode: 'localhost' | 'all';
    port: number;
  } | null>(null);
  const [schedules, setSchedules] = useState<ScheduledTask[]>([]);
  const [loadingSchedules, setLoadingSchedules] = useState(true);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleName, setScheduleName] = useState('');
  const [scheduleCron, setScheduleCron] = useState('0 9 * * 1-5');
  const [schedulePrompt, setSchedulePrompt] = useState('');
  const [scheduleTimezone, setScheduleTimezone] = useState('');
  const [scheduleWorkingDirectory, setScheduleWorkingDirectory] = useState('');
  const [scheduleReuseSession, setScheduleReuseSession] = useState(false);
  const [scheduleSessionId, setScheduleSessionId] = useState('');
  const [savingSchedule, setSavingSchedule] = useState(false);

  // API usage estimate: pricing
  const [usagePricing, setUsagePricing] = useState<UsagePricingSettings | null>(null);
  const [usagePricingLoading, setUsagePricingLoading] = useState(false);
  const [usagePricingSaving, setUsagePricingSaving] = useState(false);
  const [usagePricingError, setUsagePricingError] = useState<string | null>(null);
  const [usageModelsUsed, setUsageModelsUsed] = useState<Record<string, string[]>>({});
  const [usageAutofillOpen, setUsageAutofillOpen] = useState(false);
  const [usageAutofillStep, setUsageAutofillStep] = useState<'pick' | 'preview'>('pick');
  const [usageAutofillLoading, setUsageAutofillLoading] = useState(false);
  const [usageAutofillResult, setUsageAutofillResult] = useState<UsagePricingAutofillResult | null>(null);
  const [usageAutofillOverwrite, setUsageAutofillOverwrite] = useState(false);
  const [usageAutofillTargets, setUsageAutofillTargets] = useState<Set<string>>(new Set());
  const [expandedSettingsSections, setExpandedSettingsSections] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = window.localStorage.getItem(SETTINGS_SECTION_EXPANDED_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') return {};
      return Object.fromEntries(
        Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
      );
    } catch {
      return {};
    }
  });
  const [settingsSectionQuery, setSettingsSectionQuery] = useState('');
  const [settingsSectionJumpTarget, setSettingsSectionJumpTarget] = useState('');
  const deferredSettingsSectionQuery = useDeferredValue(settingsSectionQuery);
  const settingsSectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const [discordStatus, setDiscordStatus] = useState<DiscordConnectorStatus | null>(null);
  const [discordTokenSet, setDiscordTokenSet] = useState(false);
  const [discordTokenInput, setDiscordTokenInput] = useState('');
  const [discordEnabled, setDiscordEnabled] = useState(false);
  const [discordDmPolicy, setDiscordDmPolicy] = useState<'pairing' | 'open' | 'disabled'>('pairing');
  const [discordRequireMention, setDiscordRequireMention] = useState(true);
  const [discordCommandPrefix, setDiscordCommandPrefix] = useState('!desk');
  const [discordChannelAllowlist, setDiscordChannelAllowlist] = useState('');
  const [discordGuildAllowlist, setDiscordGuildAllowlist] = useState('');
  const [discordDmAllowlist, setDiscordDmAllowlist] = useState('');
  const [discordAgentId, setDiscordAgentId] = useState('');
  const [discordSaving, setDiscordSaving] = useState(false);
  const [discordTokenSaving, setDiscordTokenSaving] = useState(false);
  const [discordError, setDiscordError] = useState<string | null>(null);
  const [discordPairingRequests, setDiscordPairingRequests] = useState<DiscordPairingRequest[]>([]);
  const [discordPairingLoading, setDiscordPairingLoading] = useState(false);
  const [discordPairingApproving, setDiscordPairingApproving] = useState<string | null>(null);
  const [discordPairingCopied, setDiscordPairingCopied] = useState<string | null>(null);
  const discordTokenInputRef = useRef<HTMLInputElement | null>(null);
  const discordCommandPrefixRef = useRef<HTMLInputElement | null>(null);
  const discordChannelAllowlistRef = useRef<HTMLTextAreaElement | null>(null);
  const discordGuildAllowlistRef = useRef<HTMLTextAreaElement | null>(null);
  const discordDmAllowlistRef = useRef<HTMLTextAreaElement | null>(null);

  const [telegramStatus, setTelegramStatus] = useState<TelegramConnectorStatus | null>(null);
  const [telegramTokenSet, setTelegramTokenSet] = useState(false);
  const [telegramTokenInput, setTelegramTokenInput] = useState('');
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramDmPolicy, setTelegramDmPolicy] = useState<'pairing' | 'open' | 'disabled'>('pairing');
  const [telegramRequireMention, setTelegramRequireMention] = useState(true);
  const [telegramCommandPrefix, setTelegramCommandPrefix] = useState('/desk');
  const [telegramChannelAllowlist, setTelegramChannelAllowlist] = useState('');
  const [telegramGroupAllowlist, setTelegramGroupAllowlist] = useState('');
  const [telegramDmAllowlist, setTelegramDmAllowlist] = useState('');
  const [telegramAgentId, setTelegramAgentId] = useState('');
  const [telegramSaving, setTelegramSaving] = useState(false);
  const [telegramTokenSaving, setTelegramTokenSaving] = useState(false);
  const [telegramError, setTelegramError] = useState<string | null>(null);
  const [telegramPairingRequests, setTelegramPairingRequests] = useState<TelegramPairingRequest[]>([]);
  const [telegramPairingLoading, setTelegramPairingLoading] = useState(false);
  const [telegramPairingApproving, setTelegramPairingApproving] = useState<string | null>(null);
  const [telegramPairingCopied, setTelegramPairingCopied] = useState<string | null>(null);
  const telegramTokenInputRef = useRef<HTMLInputElement | null>(null);
  const telegramCommandPrefixRef = useRef<HTMLInputElement | null>(null);
  const telegramChannelAllowlistRef = useRef<HTMLTextAreaElement | null>(null);
  const telegramGroupAllowlistRef = useRef<HTMLTextAreaElement | null>(null);
  const telegramDmAllowlistRef = useRef<HTMLTextAreaElement | null>(null);

  const [voiceWakeConfig, setVoiceWakeConfigState] = useState<VoiceWakeConfig | null>(null);
  const [voiceWakeEnabled, setVoiceWakeEnabled] = useState(false);
  const [voiceWakeAutoStart, setVoiceWakeAutoStart] = useState(false);
  const [voiceWakeTriggers, setVoiceWakeTriggers] = useState('');
  const [voiceWakeSaving, setVoiceWakeSaving] = useState(false);
  const [voiceWakeError, setVoiceWakeError] = useState<string | null>(null);
  const [voiceWakeAccessKeySet, setVoiceWakeAccessKeySet] = useState(false);
  const [voiceWakeAccessKeyInput, setVoiceWakeAccessKeyInput] = useState('');
  const [voiceWakeAccessKeySaving, setVoiceWakeAccessKeySaving] = useState(false);
  const [voiceWakeTalkModeEnabled, setVoiceWakeTalkModeEnabled] = useState(true);
  const [voiceWakeAutoSubmit, setVoiceWakeAutoSubmit] = useState(false);
  const [voiceWakeInsertMode, setVoiceWakeInsertMode] = useState<'append' | 'replace'>('append');
  const [voiceWakeStopPhrases, setVoiceWakeStopPhrases] = useState('');
  const [voiceWakeSilenceMs, setVoiceWakeSilenceMs] = useState('900');
  const [voiceWakeEarconEnabled, setVoiceWakeEarconEnabled] = useState(true);
  const [voiceWakeSttEngine, setVoiceWakeSttEngine] = useState<'web-speech' | 'whisper'>('whisper');
  const [voiceWakeWhisperBinPath, setVoiceWakeWhisperBinPath] = useState('');
  const [voiceWakeWhisperModelPath, setVoiceWakeWhisperModelPath] = useState('');
  const [voiceWakeWhisperLanguage, setVoiceWakeWhisperLanguage] = useState('en');
  const [voiceWakeFormVersion, setVoiceWakeFormVersion] = useState(0);
  const voiceWakeAccessKeyInputRef = useRef<HTMLInputElement | null>(null);
  const voiceWakeTriggersRef = useRef<HTMLTextAreaElement | null>(null);
  const voiceWakeStopPhrasesRef = useRef<HTMLTextAreaElement | null>(null);
  const voiceWakeSilenceMsRef = useRef<HTMLInputElement | null>(null);
  const voiceWakeWhisperBinPathRef = useRef<HTMLInputElement | null>(null);
  const voiceWakeWhisperModelPathRef = useRef<HTMLInputElement | null>(null);
  const voiceWakeWhisperLanguageRef = useRef<HTMLInputElement | null>(null);

  const [nodePairing, setNodePairing] = useState<NodePairingList | null>(null);
  const [nodePairingLoading, setNodePairingLoading] = useState(false);
  const [nodePairingApproving, setNodePairingApproving] = useState<string | null>(null);
  const [nodePairingRejecting, setNodePairingRejecting] = useState<string | null>(null);
  const [nodePairingCopied, setNodePairingCopied] = useState<string | null>(null);
  const [nodePairingError, setNodePairingError] = useState<string | null>(null);
  const [nodeNameEdits, setNodeNameEdits] = useState<Record<string, string>>({});
  const nodeNameInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [nodeBadgeColorEdits, setNodeBadgeColorEdits] = useState<Record<string, string>>({});
  const [nodeBadgeIconEdits, setNodeBadgeIconEdits] = useState<Record<string, string>>({});
  const [nodeNameSaving, setNodeNameSaving] = useState<string | null>(null);
  const [nodeBadgeChooserOpen, setNodeBadgeChooserOpen] = useState<Record<string, boolean>>({});
  const [nodeSnapshots, setNodeSnapshots] = useState<Record<string, string>>({});
  const [nodeLiveFrames, setNodeLiveFrames] = useState<Record<string, string>>({});
  const [nodeMicStreams, setNodeMicStreams] = useState<Record<string, string>>({});
  const [nodeScreenStreams, setNodeScreenStreams] = useState<Record<string, string>>({});
  const [nodeMicChunks, setNodeMicChunks] = useState<Record<string, { dataUrl: string; receivedAtMs: number }>>({});
  const [nodeScreenChunks, setNodeScreenChunks] = useState<Record<string, { dataUrl: string; receivedAtMs: number }>>({});
  const [nodeMicBufferUrls, setNodeMicBufferUrls] = useState<Record<string, string>>({});
  const [nodeScreenBufferUrls, setNodeScreenBufferUrls] = useState<Record<string, string>>({});
  const [nodeScreenStreamUrls, setNodeScreenStreamUrls] = useState<Record<string, string>>({});

  const refreshMemoryState = async () => {
    const accomplish = getAccomplish();
    setMemoryLoading(true);
    setMemoryError(null);
    try {
      const state = (await accomplish.getMemoryState({ agentId: activeAgentId })) as
        | {
            longTerm?: { content?: string };
            daily?: { content?: string; date?: string };
            dailyFiles?: unknown;
          }
        | null
        | undefined;
      setMemoryLongTerm(state?.longTerm?.content || '');
      setMemoryDaily(state?.daily?.content || '');
      const dailyDate = state?.daily?.date || '';
      const files = Array.isArray(state?.dailyFiles) ? (state?.dailyFiles as string[]) : [];
      const normalizedFiles = dailyDate && !files.includes(dailyDate) ? [dailyDate, ...files] : files;
      setMemoryDailyDate(dailyDate);
      setMemoryDailyFiles(normalizedFiles);
      if (memoryLongTermRef.current) {
        memoryLongTermRef.current.value = state?.longTerm?.content || '';
      }
      if (memoryDailyRef.current) {
        memoryDailyRef.current.value = state?.daily?.content || '';
      }
    } catch (err) {
      console.error('Failed to fetch memory state:', err);
      setMemoryError('Unable to load memory files.');
    } finally {
      setMemoryLoading(false);
    }
  };
  const nodeMicBuffersRef = useRef<Record<string, Array<{ mime: string; dataBase64: string }>>>({});
  const nodeScreenBuffersRef = useRef<Record<string, Array<{ mime: string; dataBase64: string }>>>({});
  const nodeBufferedUpdateRef = useRef<Record<string, number>>({});
  const nodeScreenMediaRef = useRef<
    Record<
      string,
      {
        mediaSource: MediaSource;
        sourceBuffer: SourceBuffer | null;
        queue: Uint8Array[];
        mime: string;
        lastPrunedAt: number;
        prunePending: boolean;
      }
    >
  >({});
  const nodeScreenLastReceivedRef = useRef<Record<string, number>>({});
  const [nodeSnapshotLoading, setNodeSnapshotLoading] = useState<string | null>(null);
  const [audioSavingNode, setAudioSavingNode] = useState<string | null>(null);
  const [livePreviewNodes, setLivePreviewNodes] = useState<Set<string>>(new Set());
  const livePreviewTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const livePreviewFailureCountsRef = useRef<Record<string, number>>({});
  const streamPollTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const addAttachedFiles = useAttachmentStore((state) => state.addFiles);

  const [gatewayStatus, setGatewayStatus] = useState<GatewayRuntimeStatus | null>(null);
  const [gatewayAuthMode, setGatewayAuthMode] = useState<'none' | 'token' | 'password'>('none');
  const [gatewayAllowTailscale, setGatewayAllowTailscale] = useState(true);
  const [gatewayTailscaleMode, setGatewayTailscaleMode] = useState<'off' | 'serve' | 'funnel'>('off');
  const [gatewayTailscaleResetOnExit, setGatewayTailscaleResetOnExit] = useState(false);
  const [gatewayRecordConnectorDiscovery, setGatewayRecordConnectorDiscovery] = useState(true);
  const [gatewayTokenInput, setGatewayTokenInput] = useState('');
  const [gatewayPasswordInput, setGatewayPasswordInput] = useState('');
  const [gatewayTokenSet, setGatewayTokenSet] = useState(false);
  const [gatewayPasswordSet, setGatewayPasswordSet] = useState(false);
  const [gatewaySaving, setGatewaySaving] = useState(false);
  const [gatewayTokenSaving, setGatewayTokenSaving] = useState(false);
  const [gatewayPasswordSaving, setGatewayPasswordSaving] = useState(false);
  const [gatewayStatusLoading, setGatewayStatusLoading] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [gatewayCopied, setGatewayCopied] = useState<string | null>(null);
  const [gatewayBindings, setGatewayBindings] = useState<GatewayRouteBinding[]>([]);
  const [gatewayBindingsLoading, setGatewayBindingsLoading] = useState(false);
  const [gatewayBindingsSaving, setGatewayBindingsSaving] = useState(false);
  const [gatewayBindingsError, setGatewayBindingsError] = useState<string | null>(null);
  const [gatewayBindingEditorId, setGatewayBindingEditorId] = useState<string | null>(null);
  const [gatewayBindingChannel, setGatewayBindingChannel] = useState('discord');
  const [gatewayBindingAgentId, setGatewayBindingAgentId] = useState('');
  const [gatewayBindingAccountId, setGatewayBindingAccountId] = useState('');
  const [gatewayBindingPeerKind, setGatewayBindingPeerKind] = useState<GatewayPeerKind>('dm');
  const [gatewayBindingPeerId, setGatewayBindingPeerId] = useState('');
  const [gatewayBindingGuildId, setGatewayBindingGuildId] = useState('');
  const [gatewayBindingTeamId, setGatewayBindingTeamId] = useState('');
  const [gatewaySessions, setGatewaySessions] = useState<GatewaySessionRecord[]>([]);
  const [gatewaySessionsLoading, setGatewaySessionsLoading] = useState(false);
  const [gatewaySessionsError, setGatewaySessionsError] = useState<string | null>(null);
  const [gatewaySessionFilterAgentId, setGatewaySessionFilterAgentId] = useState('');
  const [gatewaySessionDeletingKey, setGatewaySessionDeletingKey] = useState<string | null>(null);
  const [gatewayRuns, setGatewayRuns] = useState<GatewayRunRecord[]>([]);
  const [gatewayRunsLoading, setGatewayRunsLoading] = useState(false);
  const [gatewayRunsError, setGatewayRunsError] = useState<string | null>(null);
  const [gatewayRunFilterAgentId, setGatewayRunFilterAgentId] = useState('');
  const [gatewayRunLookupId, setGatewayRunLookupId] = useState('');
  const [gatewayRunLookup, setGatewayRunLookup] = useState<GatewayRunRecord | null>(null);
  const [gatewayRunLookupLoading, setGatewayRunLookupLoading] = useState(false);
  const [gatewayRpcMethod, setGatewayRpcMethod] = useState('agents.list');
  const [gatewayRpcParams, setGatewayRpcParams] = useState('{}');
  const [gatewayRpcAuthMode, setGatewayRpcAuthMode] = useState<'none' | 'token' | 'password'>('none');
  const [gatewayRpcToken, setGatewayRpcToken] = useState('');
  const [gatewayRpcPassword, setGatewayRpcPassword] = useState('');
  const [gatewayRpcLoading, setGatewayRpcLoading] = useState(false);
  const [gatewayRpcError, setGatewayRpcError] = useState<string | null>(null);
  const [gatewayRpcResponse, setGatewayRpcResponse] = useState('');
  const [gatewayConnectorExtensions, setGatewayConnectorExtensions] = useState<GatewayConnectorExtensionState[]>([]);
  const [gatewayConnectorDiscovery, setGatewayConnectorDiscovery] = useState<GatewayConnectorDiscoverySnapshot[]>([]);
  const [gatewayConnectorRuntimeStatuses, setGatewayConnectorRuntimeStatuses] = useState<GatewayConnectorRuntimeStatus[]>([]);
  const [gatewayConnectorRuntimeTestResult, setGatewayConnectorRuntimeTestResult] = useState<GatewayConnectorRuntimeTestResult | null>(null);
  const [gatewayConnectorRuntimeDiscoveryItems, setGatewayConnectorRuntimeDiscoveryItems] = useState<GatewayConnectorRuntimeDiscoveryItem[]>([]);
  const [gatewayConnectorLoading, setGatewayConnectorLoading] = useState(false);
  const [gatewayConnectorSaving, setGatewayConnectorSaving] = useState(false);
  const [gatewayConnectorSecretSaving, setGatewayConnectorSecretSaving] = useState(false);
  const [gatewayConnectorDiscoveryClearing, setGatewayConnectorDiscoveryClearing] = useState(false);
  const [gatewayConnectorRuntimeRestarting, setGatewayConnectorRuntimeRestarting] = useState(false);
  const [gatewayConnectorRuntimeTesting, setGatewayConnectorRuntimeTesting] = useState(false);
  const [gatewayConnectorRuntimeDiscovering, setGatewayConnectorRuntimeDiscovering] = useState(false);
  const [gatewayConnectorInstanceCreating, setGatewayConnectorInstanceCreating] = useState(false);
  const [gatewayConnectorInstanceDeleting, setGatewayConnectorInstanceDeleting] = useState(false);
  const [gatewayConnectorError, setGatewayConnectorError] = useState<string | null>(null);
  const [gatewayConnectorStatus, setGatewayConnectorStatus] = useState<string | null>(null);
  const [gatewayConnectorSelectedId, setGatewayConnectorSelectedId] = useState('');
  const [gatewayConnectorCreateType, setGatewayConnectorCreateType] = useState('');
  const [gatewayConnectorCreateName, setGatewayConnectorCreateName] = useState('');
  const [gatewayConnectorEnabled, setGatewayConnectorEnabled] = useState(false);
  const [gatewayConnectorAutoBindRouting, setGatewayConnectorAutoBindRouting] = useState(true);
  const [gatewayConnectorRecordObservedIds, setGatewayConnectorRecordObservedIds] = useState(true);
  const [gatewayConnectorAgentId, setGatewayConnectorAgentId] = useState('');
  const [gatewayConnectorAccountId, setGatewayConnectorAccountId] = useState('');
  const [gatewayConnectorBridgeUrl, setGatewayConnectorBridgeUrl] = useState('');
  const [gatewayConnectorNotes, setGatewayConnectorNotes] = useState('');
  const [gatewayConnectorMetadataText, setGatewayConnectorMetadataText] = useState('');
  const [gatewayConnectorSecretInput, setGatewayConnectorSecretInput] = useState('');
  const [gatewayConnectorAccessPolicyMode, setGatewayConnectorAccessPolicyMode] = useState<'open' | 'allowlist' | 'disabled'>('open');
  const [gatewayConnectorAllowedUserIds, setGatewayConnectorAllowedUserIds] = useState('');
  const [gatewayConnectorAllowedGroupIds, setGatewayConnectorAllowedGroupIds] = useState('');
  const [gatewayConnectorAllowedChannelIds, setGatewayConnectorAllowedChannelIds] = useState('');
  const [gatewayConnectorAllowedAccountIds, setGatewayConnectorAllowedAccountIds] = useState('');
  const [gatewayConnectorRuntimeCommandPrefix, setGatewayConnectorRuntimeCommandPrefix] = useState('!desk');
  const [gatewayConnectorRuntimePollIntervalMs, setGatewayConnectorRuntimePollIntervalMs] = useState('');
  const [gatewayConnectorRuntimeRequireMention, setGatewayConnectorRuntimeRequireMention] = useState(false);
  const [gatewayConnectorRuntimeBotUserId, setGatewayConnectorRuntimeBotUserId] = useState('');
  const [appConnectorExtensions, setAppConnectorExtensions] = useState<AppConnectorExtensionState[]>([]);
  const [appConnectorRuntimeStatuses, setAppConnectorRuntimeStatuses] = useState<AppConnectorRuntimeStatus[]>([]);
  const [appConnectorRuntimeTestResult, setAppConnectorRuntimeTestResult] = useState<AppConnectorRuntimeTestResult | null>(null);
  const [appConnectorLoading, setAppConnectorLoading] = useState(false);
  const [appConnectorSaving, setAppConnectorSaving] = useState(false);
  const [appConnectorSecretSaving, setAppConnectorSecretSaving] = useState(false);
  const [appConnectorRuntimeTesting, setAppConnectorRuntimeTesting] = useState(false);
  const [appConnectorInstanceCreating, setAppConnectorInstanceCreating] = useState(false);
  const [appConnectorInstanceDeleting, setAppConnectorInstanceDeleting] = useState(false);
  const [appConnectorError, setAppConnectorError] = useState<string | null>(null);
  const [appConnectorStatus, setAppConnectorStatus] = useState<string | null>(null);
  const [appConnectorSelectedId, setAppConnectorSelectedId] = useState('');
  const [appConnectorCreateType, setAppConnectorCreateType] = useState('');
  const [appConnectorCreateName, setAppConnectorCreateName] = useState('');
  const [appConnectorEnabled, setAppConnectorEnabled] = useState(false);
  const [appConnectorAutoBindTools, setAppConnectorAutoBindTools] = useState(true);
  const [appConnectorAgentId, setAppConnectorAgentId] = useState('');
  const [appConnectorAccountId, setAppConnectorAccountId] = useState('');
  const [appConnectorBaseUrl, setAppConnectorBaseUrl] = useState('');
  const [appConnectorNotes, setAppConnectorNotes] = useState('');
  const [appConnectorMetadataText, setAppConnectorMetadataText] = useState('');
  const [appConnectorSecretInput, setAppConnectorSecretInput] = useState('');
  const [appConnectorOauthClientId, setAppConnectorOauthClientId] = useState('');
  const [appConnectorOauthClientSecret, setAppConnectorOauthClientSecret] = useState('');
  const [appConnectorOauthClientSecretStored, setAppConnectorOauthClientSecretStored] = useState(false);
  const [appConnectorOauthClientSecretSaving, setAppConnectorOauthClientSecretSaving] = useState(false);
  const [appConnectorOauthScopes, setAppConnectorOauthScopes] = useState('');
  const [appConnectorOauthRedirectMode, setAppConnectorOauthRedirectMode] = useState<'auto' | 'desktop' | 'loopback' | 'public'>('auto');
  const [appConnectorOauthFlowId, setAppConnectorOauthFlowId] = useState('');
  const [appConnectorOauthAuthorizeUrl, setAppConnectorOauthAuthorizeUrl] = useState('');
  const [appConnectorOauthPending, setAppConnectorOauthPending] = useState(false);
  const [appConnectorOauthDisconnecting, setAppConnectorOauthDisconnecting] = useState(false);
  const [appConnectorObsidianSelecting, setAppConnectorObsidianSelecting] = useState(false);
  const [appConnectorWebhookUrl, setAppConnectorWebhookUrl] = useState('');
  const [appConnectorWebhookTesting, setAppConnectorWebhookTesting] = useState(false);
  const gatewayTokenInputRef = useRef<HTMLInputElement | null>(null);
  const gatewayPasswordInputRef = useRef<HTMLInputElement | null>(null);
  const appConnectorOauthPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appConnectorFormRuntimeKeyRef = useRef<string>('');
  const appConnectorFormHydratedRef = useRef(false);
  const gatewayConfigRef = useRef<{
    authMode: 'none' | 'token' | 'password';
    allowTailscale: boolean;
    tailscaleMode: 'off' | 'serve' | 'funnel';
    tailscaleResetOnExit: boolean;
    recordConnectorDiscovery: boolean;
  }>({
    authMode: 'none',
    allowTailscale: true,
    tailscaleMode: 'off',
    tailscaleResetOnExit: false,
    recordConnectorDiscovery: true,
  });
  const gatewayAutoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gatewayLastSavedRef = useRef<string>('');

  const scheduleGatewayAutoSave = () => {
    if (gatewayAutoSaveTimerRef.current) {
      clearTimeout(gatewayAutoSaveTimerRef.current);
      gatewayAutoSaveTimerRef.current = null;
    }
    gatewayAutoSaveTimerRef.current = setTimeout(() => {
      gatewayAutoSaveTimerRef.current = null;
      void handleSaveGatewayConfig(true);
    }, 350);
  };

  const setGatewayAuthModeInstant = (mode: 'none' | 'token' | 'password') => {
    gatewayConfigRef.current.authMode = mode;
    setGatewayAuthMode(mode);
  };
  const setGatewayAllowTailscaleInstant = (allow: boolean) => {
    gatewayConfigRef.current.allowTailscale = allow;
    setGatewayAllowTailscale(allow);
  };
  const setGatewayTailscaleModeInstant = (mode: 'off' | 'serve' | 'funnel') => {
    gatewayConfigRef.current.tailscaleMode = mode;
    setGatewayTailscaleMode(mode);
  };
  const setGatewayTailscaleResetOnExitInstant = (enabled: boolean) => {
    gatewayConfigRef.current.tailscaleResetOnExit = enabled;
    setGatewayTailscaleResetOnExit(enabled);
  };
  const setGatewayRecordConnectorDiscoveryInstant = (enabled: boolean) => {
    gatewayConfigRef.current.recordConnectorDiscovery = enabled;
    setGatewayRecordConnectorDiscovery(enabled);
  };

  const selectedGatewayConnector = useMemo(() => {
    if (gatewayConnectorExtensions.length === 0) return null;
    return (
      gatewayConnectorExtensions.find((entry) => entry.runtimeKey === gatewayConnectorSelectedId) ||
      gatewayConnectorExtensions[0]
    );
  }, [gatewayConnectorExtensions, gatewayConnectorSelectedId]);

  const gatewayConnectorEnabledCount = useMemo(
    () => gatewayConnectorExtensions.filter((entry) => entry.config.enabled).length,
    [gatewayConnectorExtensions]
  );
  const selectedGatewayConnectorId = selectedGatewayConnector?.definition.id || '';
  const selectedGatewayConnectorRuntimeStatus = useMemo(() => {
    if (!selectedGatewayConnector) return null;
    return gatewayConnectorRuntimeStatuses.find((entry) => {
      if (entry.runtimeKey && selectedGatewayConnector.runtimeKey) {
        return entry.runtimeKey === selectedGatewayConnector.runtimeKey;
      }
      return entry.connectorId === selectedGatewayConnector.definition.id
        && (entry.instanceId ?? 'default') === (selectedGatewayConnector.config.instanceId ?? 'default');
    }) ?? null;
  }, [gatewayConnectorRuntimeStatuses, selectedGatewayConnector]);
  const gatewayConnectorRuntimeStatusById = useMemo(
    () => new Map(
      gatewayConnectorRuntimeStatuses.map((entry) => [
        entry.runtimeKey || `${entry.connectorId}:${entry.instanceId ?? 'default'}`,
        entry,
      ] as const)
    ),
    [gatewayConnectorRuntimeStatuses]
  );
  const isNativeConnectorSelected =
    selectedGatewayConnectorId === 'discord' || selectedGatewayConnectorId === 'telegram';
  const selectedGatewayConnectorHasFirstPartyRuntime =
    FIRST_PARTY_GATEWAY_CONNECTOR_IDS.has(selectedGatewayConnectorId);
  const selectedGatewayConnectorRuntimeMode = resolveGatewayConnectorRuntimeMode(
    selectedGatewayConnectorId,
    selectedGatewayConnectorRuntimeStatus
  );
  const selectedGatewayConnectorHasRuntimeControls =
    selectedGatewayConnectorHasFirstPartyRuntime;
  const selectedGatewayConnectorDiscovery = useMemo(() => {
    if (!selectedGatewayConnector) return null;
    const runtimeKey = selectedGatewayConnector.runtimeKey;
    return (
      gatewayConnectorDiscovery.find((entry) =>
        (runtimeKey && entry.runtimeKey ? entry.runtimeKey === runtimeKey : false)
        || (
          entry.connectorId === selectedGatewayConnector.definition.id
          && (entry.instanceId ?? 'default') === (selectedGatewayConnector.config.instanceId ?? 'default')
        )
      )
      || null
    );
  }, [gatewayConnectorDiscovery, selectedGatewayConnector]);
  const connectorDiscoveryHasAny = useMemo(() => {
    if (!selectedGatewayConnectorDiscovery) return false;
    return selectedGatewayConnectorDiscovery.accountIds.length > 0
      || selectedGatewayConnectorDiscovery.userIds.length > 0
      || selectedGatewayConnectorDiscovery.groupIds.length > 0
      || selectedGatewayConnectorDiscovery.channelIds.length > 0;
  }, [selectedGatewayConnectorDiscovery]);
  const gatewayConnectorDiscoveryHasAny = useMemo(
    () => gatewayConnectorDiscovery.some((entry) =>
      entry.accountIds.length > 0
      || entry.userIds.length > 0
      || entry.groupIds.length > 0
      || entry.channelIds.length > 0
    ),
    [gatewayConnectorDiscovery]
  );
  const selectedGatewayConnectorObservedGroups = useMemo(
    () => [
      {
        key: 'account',
        label: 'Account IDs',
        hint: 'accountId',
        values: selectedGatewayConnectorDiscovery?.accountIds ?? [],
      },
      {
        key: 'user',
        label: 'User IDs',
        hint: 'userId',
        values: selectedGatewayConnectorDiscovery?.userIds ?? [],
      },
      {
        key: 'group',
        label: 'Group IDs',
        hint: 'groupId',
        values: selectedGatewayConnectorDiscovery?.groupIds ?? [],
      },
      {
        key: 'channel',
        label: 'Channel IDs',
        hint: 'channelId',
        values: selectedGatewayConnectorDiscovery?.channelIds ?? [],
      },
    ],
    [selectedGatewayConnectorDiscovery]
  );
  const selectedGatewayConnectorUsesBridgeRuntime =
    BRIDGE_GATEWAY_RUNTIME_CONNECTOR_IDS.has(selectedGatewayConnectorId);
  const selectedGatewayConnectorMetadataTemplate = useMemo(
    () => CONNECTOR_METADATA_TEMPLATE_BY_ID[selectedGatewayConnectorId] ?? null,
    [selectedGatewayConnectorId]
  );
  const selectedGatewayConnectorMetadataTemplateText = useMemo(() => {
    if (!selectedGatewayConnectorMetadataTemplate) return '';
    return selectedGatewayConnectorMetadataTemplate.lines
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
  }, [selectedGatewayConnectorMetadataTemplate]);
  const connectorMetadataPlaceholder = selectedGatewayConnectorMetadataTemplateText || 'webhook_path=/events\nworkspace=primary';
  const connectorBridgeUrlLabel = useMemo(() => {
    if (selectedGatewayConnectorId === 'matrix') return 'Matrix base URL';
    if (selectedGatewayConnectorId === 'mattermost') return 'Mattermost base URL';
    if (selectedGatewayConnectorUsesBridgeRuntime) {
      return 'Bridge URL (required)';
    }
    return 'Bridge URL (optional)';
  }, [selectedGatewayConnectorId, selectedGatewayConnectorUsesBridgeRuntime]);
  const connectorBridgeUrlPlaceholder = useMemo(() => {
    if (selectedGatewayConnectorId === 'matrix') return 'https://matrix-client.matrix.org';
    if (selectedGatewayConnectorId === 'mattermost') return 'https://chat.example.com';
    if (selectedGatewayConnectorUsesBridgeRuntime) {
      return 'https://connector-bridge.example.com';
    }
    return 'https://your-bridge-host/connector';
  }, [selectedGatewayConnectorId, selectedGatewayConnectorUsesBridgeRuntime]);

  const selectedAppConnector = useMemo(() => {
    if (appConnectorExtensions.length === 0) return null;
    return (
      appConnectorExtensions.find((entry) => entry.runtimeKey === appConnectorSelectedId)
      || appConnectorExtensions[0]
    );
  }, [appConnectorExtensions, appConnectorSelectedId]);
  const isSelectedAppConnectorObsidian = selectedAppConnector?.definition.id === 'obsidian';
  const isSelectedAppConnectorEmailTriggers = selectedAppConnector?.definition.id === 'email-triggers';

  const appConnectorEnabledCount = useMemo(
    () => appConnectorExtensions.filter((entry) => entry.config.enabled).length,
    [appConnectorExtensions]
  );

  const selectedAppConnectorRuntimeStatus = useMemo(() => {
    if (!selectedAppConnector) return null;
    return appConnectorRuntimeStatuses.find((entry) => {
      if (entry.runtimeKey && selectedAppConnector.runtimeKey) {
        return entry.runtimeKey === selectedAppConnector.runtimeKey;
      }
      return entry.connectorId === selectedAppConnector.definition.id
        && (entry.instanceId ?? 'default') === (selectedAppConnector.config.instanceId ?? 'default');
    }) ?? null;
  }, [appConnectorRuntimeStatuses, selectedAppConnector]);

  const appConnectorRuntimeStatusById = useMemo(
    () => new Map(
      appConnectorRuntimeStatuses.map((entry) => [
        entry.runtimeKey || `${entry.connectorId}:${entry.instanceId ?? 'default'}`,
        entry,
      ] as const)
    ),
    [appConnectorRuntimeStatuses]
  );

  const InfoTip = ({ text }: { text: string }) => (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="ml-2 inline-flex h-4 w-4 items-center justify-center rounded-full border border-border text-[10px] font-semibold text-muted-foreground hover:text-foreground"
          aria-label="More info"
        >
          i
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-w-xs text-xs leading-relaxed text-foreground" align="start">
        {text}
      </PopoverContent>
    </Popover>
  );

  const ButtonTip = ({ text, children }: { text: string; children: ReactNode }) => (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="max-w-xs text-xs leading-relaxed text-foreground" align="start">
        {text}
      </PopoverContent>
    </Popover>
  );

  const isWindows = appPlatform === 'win32';
  const nodeBaseUrl =
    automationInfo?.lanUrls?.[0] || automationInfo?.localUrl || automationInfo?.webhookUrl || '';
  const nodePairingEndpoint = nodeBaseUrl ? `${nodeBaseUrl}/nodes/pair` : '';
  const nodeCompanionEndpoint = nodeBaseUrl ? `${nodeBaseUrl}/nodes/companion` : '';

  const providerNameById = useMemo(() => {
    const map: Record<string, string> = { ...PROVIDER_NAME_BY_ID };
    for (const entry of modelProviders) {
      map[String(entry.id)] = entry.name || String(entry.id);
    }
    return map;
  }, [modelProviders]);

  const remoteModelProviders = useMemo(
    () => modelProviders.filter((entry) => entry.id !== 'ollama'),
    [modelProviders]
  );
  const apiKeyProviders = useMemo(
    () => remoteModelProviders.filter((entry) => entry.requiresApiKey),
    [remoteModelProviders]
  );
  const getProviderDisplayName = (providerId: string): string =>
    providerNameById[providerId] || providerId;
  const getApiKeyProviderLabel = (providerId: string, fallbackName: string): string =>
    API_KEY_PROVIDER_LABEL_OVERRIDES[providerId] || fallbackName;

  useEffect(() => {
    if (!open) return;

    const accomplish = getAccomplish();

    const fetchKeys = async () => {
      try {
        const keys = await accomplish.getApiKeys();
        setSavedKeys(keys);
      } catch (err) {
        console.error('Failed to fetch API keys:', err);
      } finally {
        setLoadingKeys(false);
      }
    };

    const fetchDebugSetting = async () => {
      try {
        const enabled = await accomplish.getDebugMode();
        setDebugMode(enabled);
      } catch (err) {
        console.error('Failed to fetch debug setting:', err);
      } finally {
        setLoadingDebug(false);
      }
    };

    const fetchVersion = async () => {
      try {
        const version = await accomplish.getVersion();
        setAppVersion(version);
      } catch (err) {
        console.error('Failed to fetch version:', err);
      }
    };

    const fetchPlatform = async () => {
      try {
        const platform = await accomplish.getPlatform();
        setAppPlatform(platform);
      } catch (err) {
        console.error('Failed to fetch platform:', err);
      }
    };

    const fetchSelectedModel = async () => {
      try {
        const model = await accomplish.getSelectedModel();
        setSelectedModel(model as SelectedModel | null);
      } catch (err) {
        console.error('Failed to fetch selected model:', err);
      } finally {
        setLoadingModel(false);
      }
    };

    const fetchSkillAssistantModel = async () => {
      try {
        const model = await accomplish.getUserSkillAssistantModel();
        const selected = (model as SelectedModel | null) ?? null;
        setSkillAssistantModelOverrideEnabled(Boolean(selected));
        applySkillAssistantModelForm(selected ?? AGENT_FALLBACK_MODEL);
      } catch (err) {
        console.error('Failed to fetch Skill Assistant model:', err);
      }
    };

    const fetchModelProviders = async () => {
      try {
        const [providers, customProviders] = await Promise.all([
          accomplish.listModelProviders(),
          accomplish.listCustomModelProviders(),
        ]);
        const providerList = Array.isArray(providers) && providers.length > 0 ? providers : DEFAULT_PROVIDERS;
        const customProviderList = Array.isArray(customProviders) ? customProviders : [];
        setModelProviders(providerList);
        setCustomModelProviders(customProviderList);
        setProvider((prev) => {
          const existing = providerList.find((entry) => entry.id === prev && entry.requiresApiKey && entry.id !== 'ollama');
          if (existing) return prev;
          const firstCloud = providerList.find((entry) => entry.requiresApiKey && entry.id !== 'ollama');
          return firstCloud?.id || prev;
        });
      } catch (err) {
        console.error('Failed to fetch model providers:', err);
      }
    };

    const fetchApiKeyStatus = async () => {
      try {
        const status = await accomplish.getAllApiKeys();
        setApiKeyStatus(status);
      } catch (err) {
        console.error('Failed to fetch API key status:', err);
      }
    };

    const fetchAppSettings = async () => {
      try {
        const settings = await accomplish.getAppSettings();
        setRunInBackgroundState(!!settings?.runInBackground);
        setLaunchAtLoginState(!!settings?.launchAtLogin);
        setMobileNodesEnabledState(settings?.mobileNodesEnabled !== false);
        setMobileNodesMaxLivePreviewsState(
          typeof settings?.mobileNodesMaxLivePreviews === 'number'
            ? settings?.mobileNodesMaxLivePreviews
            : 3
        );
        setMobileNodesDisplayNameState(settings?.mobileNodesDisplayName || '');
        setWebhookBindModeState(settings?.webhookBindMode === 'all' ? 'all' : 'localhost');
        setWebhookBindNeedsRestart(false);
        setBrowserProfileState(settings?.browserProfile || 'default');
        setWorkspaceRootState(settings?.workspaceRoot || null);
        setAgentSpeedMode(
          settings?.agentSpeedMode === 'deep'
            ? 'deep'
            : settings?.agentSpeedMode === 'balanced'
              ? 'balanced'
              : 'fast'
        );
        setBuildDiffEnforcementMode(
          settings?.buildDiffEnforcementMode === 'auto-apply'
            ? 'auto-apply'
            : settings?.buildDiffEnforcementMode === 'approval'
              ? 'approval'
              : 'preview-only'
        );
      } catch (err) {
        console.error('Failed to fetch app settings:', err);
      }
    };

    const fetchUsagePricing = async () => {
      setUsagePricingLoading(true);
      try {
        const pricing = await accomplish.getUsagePricing();
        setUsagePricing(pricing);
        const modelsUsed = await accomplish.listUsageModelsUsed();
        setUsageModelsUsed(modelsUsed || {});
      } catch (err) {
        console.error('Failed to fetch usage pricing:', err);
      } finally {
        setUsagePricingLoading(false);
      }
    };


    const fetchAgents = async () => {
      try {
        await loadAgents();
      } catch (err) {
        console.error('Failed to load agents:', err);
      }
    };

    const fetchSkills = async () => {
      setLoadingSkills(true);
      try {
        const status = await accomplish.getSkillsStatus();
        setSkillsStatus(Array.isArray(status) ? (status as SkillStatus[]) : []);
      } catch (err) {
        console.error('Failed to fetch skills:', err);
        setSkillsError('Unable to load skills status.');
      } finally {
        setLoadingSkills(false);
      }
    };

    const fetchUserSkills = async () => {
      setLoadingUserSkills(true);
      try {
        const report = await accomplish.listUserSkills(activeAgentId);
        setUserSkillsReport(report as unknown as UserSkillsReport);
        setUserSkillsError(null);
      } catch (err) {
        console.error('Failed to fetch user skills:', err);
        setUserSkillsError('Unable to load user skills.');
      } finally {
        setLoadingUserSkills(false);
      }
    };

    const fetchUserSkillsDeps = async () => {
      setLoadingUserSkillsDeps(true);
      try {
        const report = await accomplish.getUserSkillsDependencyStatus(activeAgentId);
        setUserSkillsDepsReport(report as unknown as UserSkillDependencyStatusReport);
        setUserSkillsDepsError(null);
      } catch (err) {
        console.error('Failed to fetch user skill dependencies:', err);
        setUserSkillsDepsError('Unable to load user skill dependency status.');
      } finally {
        setLoadingUserSkillsDeps(false);
      }
    };

    const fetchDiscord = async () => {
      try {
        const info = (await accomplish.getDiscordConfig()) as
          | { status?: unknown; tokenSet?: unknown; config?: unknown }
          | null
          | undefined;
        setDiscordStatus((info?.status as DiscordConnectorStatus) || null);
        setDiscordTokenSet(Boolean(info?.tokenSet));
        const config = (info?.config as DiscordConnectorConfig) || null;
        if (config) {
          setDiscordEnabled(Boolean(config.enabled));
          const policy = config.dmPolicy ?? (config.allowDms ? 'pairing' : 'disabled');
          setDiscordDmPolicy(policy);
          setDiscordRequireMention(config.requireMention !== false);
          setDiscordCommandPrefix(config.commandPrefix ?? '');
          setDiscordChannelAllowlist(formatAllowlist(config.channelAllowlist));
          setDiscordGuildAllowlist(formatAllowlist(config.guildAllowlist));
          setDiscordDmAllowlist(formatAllowlist(config.dmAllowlist));
          setDiscordAgentId(config.agentId || '');
        }
        setDiscordPairingLoading(true);
        const pending = await accomplish.listDiscordPairingRequests();
        setDiscordPairingRequests(pending || []);
      } catch (err) {
        console.error('Failed to fetch Discord config:', err);
      } finally {
        setDiscordPairingLoading(false);
      }
    };

    const fetchTelegram = async () => {
      try {
        const info = (await accomplish.getTelegramConfig()) as
          | { status?: unknown; tokenSet?: unknown; config?: unknown }
          | null
          | undefined;
        setTelegramStatus((info?.status as TelegramConnectorStatus) || null);
        setTelegramTokenSet(Boolean(info?.tokenSet));
        const config = (info?.config as TelegramConnectorConfig) || null;
        if (config) {
          setTelegramEnabled(Boolean(config.enabled));
          const policy = config.dmPolicy ?? (config.allowDms ? 'pairing' : 'disabled');
          setTelegramDmPolicy(policy);
          setTelegramRequireMention(config.requireMention !== false);
          setTelegramCommandPrefix(config.commandPrefix ?? '');
          setTelegramChannelAllowlist(formatAllowlist(config.channelAllowlist));
          setTelegramGroupAllowlist(formatAllowlist(config.groupAllowlist));
          setTelegramDmAllowlist(formatAllowlist(config.dmAllowlist));
          setTelegramAgentId(config.agentId || '');
        }
        setTelegramPairingLoading(true);
        const pending = await accomplish.listTelegramPairingRequests();
        setTelegramPairingRequests(pending || []);
      } catch (err) {
        console.error('Failed to fetch Telegram config:', err);
      } finally {
        setTelegramPairingLoading(false);
      }
    };

    const fetchGateway = async () => {
      setGatewayBindingsLoading(true);
      setGatewaySessionsLoading(true);
      setGatewayRunsLoading(true);
      setGatewayBindingsError(null);
      setGatewaySessionsError(null);
      setGatewayRunsError(null);
      try {
        const info = (await accomplish.getGatewayConfig()) as
          | { status?: unknown; config?: unknown }
          | null
          | undefined;
        const config = (info?.config as GatewayConfig) || null;
        setGatewayStatus((info?.status as GatewayRuntimeStatus) || null);
        if (config) {
          setGatewayAuthMode(config.authMode);
          setGatewayAllowTailscale(config.allowTailscale);
          setGatewayTailscaleMode(config.tailscaleMode);
          setGatewayTailscaleResetOnExit(Boolean(config.tailscaleResetOnExit));
          setGatewayRecordConnectorDiscovery(config.recordConnectorDiscovery !== false);
          gatewayConfigRef.current.recordConnectorDiscovery = config.recordConnectorDiscovery !== false;
          setGatewayRpcAuthMode(config.authMode);
        }
        const status = info?.status as GatewayRuntimeStatus | undefined;
        setGatewayTokenSet(Boolean(status?.tokenSet));
        setGatewayPasswordSet(Boolean(status?.passwordSet));

        const [bindingsResult, sessionsResult, runsResult] = await Promise.allSettled([
          accomplish.listGatewayBindings(),
          accomplish.listGatewaySessions(),
          accomplish.listGatewayRuns(),
        ]);

        if (bindingsResult.status === 'fulfilled') {
          setGatewayBindings(Array.isArray(bindingsResult.value) ? (bindingsResult.value as GatewayRouteBinding[]) : []);
        } else {
          console.error('Failed to fetch gateway bindings:', bindingsResult.reason);
          setGatewayBindingsError('Unable to load route bindings.');
        }

        if (sessionsResult.status === 'fulfilled') {
          setGatewaySessions(Array.isArray(sessionsResult.value) ? (sessionsResult.value as GatewaySessionRecord[]) : []);
        } else {
          console.error('Failed to fetch gateway sessions:', sessionsResult.reason);
          setGatewaySessionsError('Unable to load gateway sessions.');
        }

        if (runsResult.status === 'fulfilled') {
          setGatewayRuns(Array.isArray(runsResult.value) ? (runsResult.value as GatewayRunRecord[]) : []);
        } else {
          console.error('Failed to fetch gateway runs:', runsResult.reason);
          setGatewayRunsError('Unable to load gateway runs.');
        }
      } catch (err) {
        console.error('Failed to fetch gateway config:', err);
        setGatewayError('Unable to load gateway settings.');
      } finally {
        setGatewayBindingsLoading(false);
        setGatewaySessionsLoading(false);
        setGatewayRunsLoading(false);
      }
    };

    const fetchGatewayConnectors = async () => {
      setGatewayConnectorLoading(true);
      setGatewayConnectorError(null);
      try {
        const [states, discovery, runtimes] = await Promise.all([
          accomplish.listGatewayConnectorExtensions(),
          accomplish.listGatewayConnectorDiscovery(),
          accomplish.listGatewayConnectorRuntimeStatuses(),
        ]);
        const list = Array.isArray(states) ? (states as GatewayConnectorExtensionState[]) : [];
        const observed = Array.isArray(discovery) ? (discovery as GatewayConnectorDiscoverySnapshot[]) : [];
        const runtimeStatuses = Array.isArray(runtimes) ? (runtimes as GatewayConnectorRuntimeStatus[]) : [];
        setGatewayConnectorExtensions(list);
        setGatewayConnectorDiscovery(observed);
        setGatewayConnectorRuntimeStatuses(runtimeStatuses);
        setGatewayConnectorSelectedId((prev) => {
          if (prev && list.some((entry) => entry.runtimeKey === prev)) {
            return prev;
          }
          return list[0]?.runtimeKey || '';
        });
        setGatewayConnectorCreateType((prev) => prev || list[0]?.definition.id || 'discord');
      } catch (err) {
        console.error('Failed to fetch gateway connector extensions:', err);
        setGatewayConnectorError('Unable to load messaging connector extensions.');
      } finally {
        setGatewayConnectorLoading(false);
      }
    };

    const fetchAppConnectors = async () => {
      setAppConnectorLoading(true);
      setAppConnectorError(null);
      try {
        const [states, runtimes] = await Promise.all([
          accomplish.listAppConnectorExtensions(),
          accomplish.listAppConnectorRuntimeStatuses(),
        ]);
        const list = Array.isArray(states) ? (states as AppConnectorExtensionState[]) : [];
        const runtimeStatuses = Array.isArray(runtimes) ? (runtimes as AppConnectorRuntimeStatus[]) : [];
        setAppConnectorExtensions(list);
        setAppConnectorRuntimeStatuses(runtimeStatuses);
        setAppConnectorSelectedId((prev) => {
          if (prev && list.some((entry) => entry.runtimeKey === prev)) {
            return prev;
          }
          return list[0]?.runtimeKey || '';
        });
        setAppConnectorCreateType((prev) => prev || list[0]?.definition.id || 'notion');
      } catch (err) {
        console.error('Failed to fetch app connector extensions:', err);
        setAppConnectorError('Unable to load app connector extensions.');
      } finally {
        setAppConnectorLoading(false);
      }
    };

    const fetchVoiceWake = async () => {
      try {
        const [config, keyStatus] = await Promise.all([
          accomplish.getVoiceWakeConfig(),
          accomplish.getVoiceWakeAccessKeyStatus(),
        ]);
        const safeConfig = (config as Partial<VoiceWakeConfig> | null | undefined) ?? {};
        setVoiceWakeConfigState(safeConfig as VoiceWakeConfig);
        setVoiceWakeEnabled(Boolean(safeConfig.enabled));
        setVoiceWakeAutoStart(Boolean(safeConfig.autoStart));
        setVoiceWakeTriggers(formatAllowlist((safeConfig.triggers as string[]) ?? []));
        setVoiceWakeTalkModeEnabled(safeConfig.talkModeEnabled !== false);
        setVoiceWakeAutoSubmit(Boolean(safeConfig.autoSubmit));
        setVoiceWakeInsertMode(safeConfig.insertMode === 'replace' ? 'replace' : 'append');
        setVoiceWakeStopPhrases(formatAllowlist((safeConfig.stopPhrases as string[]) ?? []));
        setVoiceWakeSilenceMs(String((safeConfig.silenceTimeoutMs as number) ?? 900));
        setVoiceWakeEarconEnabled(safeConfig.earconEnabled !== false);
        setVoiceWakeSttEngine(safeConfig.sttEngine === 'web-speech' ? 'web-speech' : 'whisper');
        setVoiceWakeWhisperBinPath((safeConfig.whisperBinPath as string) ?? '');
        setVoiceWakeWhisperModelPath((safeConfig.whisperModelPath as string) ?? '');
        setVoiceWakeWhisperLanguage((safeConfig.whisperLanguage as string) ?? 'en');
        setVoiceWakeAccessKeySet(Boolean((keyStatus as { accessKeySet?: boolean })?.accessKeySet));
      } catch (err) {
        console.error('Failed to fetch voice wake config:', err);
      }
    };

    const fetchNodePairing = async () => {
      setNodePairingLoading(true);
      try {
        const list = await accomplish.listNodePairing();
        setNodePairing(list as NodePairingList);
      } catch (err) {
        console.error('Failed to fetch node pairing state:', err);
        setNodePairingError('Unable to load node pairing requests.');
      } finally {
        setNodePairingLoading(false);
      }
    };

    const fetchAutomations = async () => {
      setLoadingSchedules(true);
      try {
        const info = await accomplish.getAutomationInfo();
        setAutomationInfo(info);
        const scheduleList = await accomplish.listSchedules();
        setSchedules(Array.isArray(scheduleList) ? (scheduleList as ScheduledTask[]) : []);
      } catch (err) {
        console.error('Failed to fetch automations:', err);
        setScheduleError('Unable to load schedules.');
      } finally {
        setLoadingSchedules(false);
      }
    };

    const fetchOllamaConfig = async () => {
      try {
        const config = await accomplish.getOllamaConfig();
        if (config) {
          setOllamaUrl(config.baseUrl);
          // Auto-test connection if previously configured
          if (config.enabled) {
            const result = await accomplish.testOllamaConnection(config.baseUrl);
            if (result.success && result.models) {
              setOllamaConnected(true);
              setOllamaModels(result.models);
            }
          }
        }
      } catch (err) {
        console.error('Failed to fetch Ollama config:', err);
      }
    };

    const fetchModelLimits = async () => {
      setModelLimitsLoading(true);
      setModelLimitsError(null);
      try {
        const res = await accomplish.getModelLimitOverrides();
        const overrides = (res && typeof res === 'object' && 'overrides' in res)
          ? ((res as { overrides: Record<string, { contextWindowTokens?: number }> }).overrides ?? {})
          : {};
        setModelLimitOverrides(overrides);
      } catch (err) {
        console.error('Failed to fetch model limits:', err);
        setModelLimitsError('Unable to load model context limits.');
      } finally {
        setModelLimitsLoading(false);
      }
    };

    fetchKeys();
    fetchDebugSetting();
    fetchVersion();
    fetchPlatform();
    fetchModelProviders();
    fetchSelectedModel();
    fetchSkillAssistantModel();
    fetchApiKeyStatus();
    fetchAppSettings();
    fetchUsagePricing();
    fetchModelLimits();
    refreshMemoryState();
    fetchAgents();
    fetchDiscord();
    fetchTelegram();
    fetchVoiceWake();
    fetchNodePairing();
    fetchSkills();
    fetchUserSkills();
    fetchUserSkillsDeps();
    fetchOllamaConfig();
    fetchAutomations();
    fetchGateway();
    fetchGatewayConnectors();
    fetchAppConnectors();
  }, [open, loadAgents, activeAgentId]);

  useEffect(() => {
    if (gatewayBindingAgentId) return;
    setGatewayBindingAgentId(activeAgentId || defaultAgentId || 'main');
  }, [gatewayBindingAgentId, activeAgentId, defaultAgentId]);

  useEffect(() => {
    if (skillAssistantModelOverrideEnabled) return;
    applySkillAssistantModelForm(selectedModel ?? AGENT_FALLBACK_MODEL);
  }, [skillAssistantModelOverrideEnabled, selectedModel, modelProviders, ollamaModels]);

  useEffect(() => {
    if (!open) {
      appConnectorFormRuntimeKeyRef.current = '';
      appConnectorFormHydratedRef.current = false;
      return;
    }
    appConnectorFormRuntimeKeyRef.current = '';
    appConnectorFormHydratedRef.current = false;
  }, [open]);

  useEffect(() => {
    if (!selectedGatewayConnector) return;
    setGatewayConnectorSelectedId(selectedGatewayConnector.runtimeKey || selectedGatewayConnector.definition.id);
    setGatewayConnectorEnabled(Boolean(selectedGatewayConnector.config.enabled));
    setGatewayConnectorAutoBindRouting(selectedGatewayConnector.config.autoBindRouting !== false);
    setGatewayConnectorRecordObservedIds(selectedGatewayConnector.config.recordObservedIds !== false);
    setGatewayConnectorAgentId(selectedGatewayConnector.config.agentId || '');
    setGatewayConnectorAccountId(selectedGatewayConnector.config.accountId || '');
    setGatewayConnectorBridgeUrl(selectedGatewayConnector.config.bridgeUrl || '');
    setGatewayConnectorNotes(selectedGatewayConnector.config.notes || '');
    const metadataText = Object.entries(selectedGatewayConnector.config.metadata || {})
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    setGatewayConnectorMetadataText(metadataText);
    const metadata = selectedGatewayConnector.config.metadata || {};
    setGatewayConnectorRuntimeCommandPrefix(getGatewayConnectorMetadataValue(metadata, 'command_prefix') || '!desk');
    setGatewayConnectorRuntimePollIntervalMs(getGatewayConnectorMetadataValue(metadata, 'poll_interval_ms') || '');
    setGatewayConnectorRuntimeRequireMention(parseTruthy(getGatewayConnectorMetadataValue(metadata, 'require_mention'), false));
    setGatewayConnectorRuntimeBotUserId(getGatewayConnectorMetadataValue(metadata, 'bot_user_id') || '');
    setGatewayConnectorAccessPolicyMode(
      selectedGatewayConnector.config.accessPolicyMode === 'allowlist'
        ? 'allowlist'
        : selectedGatewayConnector.config.accessPolicyMode === 'disabled'
          ? 'disabled'
          : 'open'
    );
    setGatewayConnectorAllowedUserIds(formatAllowlist(selectedGatewayConnector.config.allowedUserIds));
    setGatewayConnectorAllowedGroupIds(formatAllowlist(selectedGatewayConnector.config.allowedGroupIds));
    setGatewayConnectorAllowedChannelIds(formatAllowlist(selectedGatewayConnector.config.allowedChannelIds));
    setGatewayConnectorAllowedAccountIds(formatAllowlist(selectedGatewayConnector.config.allowedAccountIds));
    setGatewayConnectorSecretInput('');
    setGatewayConnectorStatus(null);
    setGatewayConnectorError(null);
    setGatewayConnectorRuntimeTestResult(null);
    setGatewayConnectorRuntimeDiscoveryItems([]);
  }, [selectedGatewayConnector]);

  useEffect(() => {
    if (!selectedAppConnector) {
      appConnectorFormRuntimeKeyRef.current = '';
      appConnectorFormHydratedRef.current = false;
      return;
    }
    const currentRuntimeKey = selectedAppConnector.runtimeKey
      || `${selectedAppConnector.definition.id}:${selectedAppConnector.config.instanceId || 'default'}`;
    if (appConnectorFormRuntimeKeyRef.current === currentRuntimeKey) {
      return;
    }
    appConnectorFormRuntimeKeyRef.current = currentRuntimeKey;
    appConnectorFormHydratedRef.current = true;
    let cancelled = false;
    if (appConnectorOauthPollTimerRef.current) {
      clearInterval(appConnectorOauthPollTimerRef.current);
      appConnectorOauthPollTimerRef.current = null;
    }
    const metadata = selectedAppConnector.config.metadata || {};
    setAppConnectorSelectedId(selectedAppConnector.runtimeKey || selectedAppConnector.definition.id);
    setAppConnectorEnabled(Boolean(selectedAppConnector.config.enabled));
    setAppConnectorAutoBindTools(selectedAppConnector.config.autoBindTools !== false);
    setAppConnectorAgentId(selectedAppConnector.config.agentId || '');
    setAppConnectorAccountId(selectedAppConnector.config.accountId || '');
    setAppConnectorBaseUrl(selectedAppConnector.config.baseUrl || '');
    setAppConnectorNotes(selectedAppConnector.config.notes || '');
    setAppConnectorMetadataText(
      Object.entries(metadata)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n')
    );
    setAppConnectorOauthClientId(getGatewayConnectorMetadataValue(metadata, 'oauth_client_id') || '');
    setAppConnectorOauthScopes(getGatewayConnectorMetadataValue(metadata, 'oauth_scopes') || '');
    const redirectModeRaw = (getGatewayConnectorMetadataValue(metadata, 'oauth_redirect_mode') || '').toLowerCase();
    setAppConnectorOauthRedirectMode(
      redirectModeRaw === 'desktop'
        ? 'desktop'
        : redirectModeRaw === 'loopback'
          ? 'loopback'
          : redirectModeRaw === 'public'
            ? 'public'
            : 'auto'
    );
    setAppConnectorOauthClientSecret('');
    setAppConnectorOauthClientSecretStored(false);
    setAppConnectorOauthClientSecretSaving(false);
    setAppConnectorOauthFlowId('');
    setAppConnectorOauthAuthorizeUrl('');
    setAppConnectorOauthPending(false);
    setAppConnectorOauthDisconnecting(false);
    setAppConnectorObsidianSelecting(false);
    setAppConnectorWebhookUrl(getGatewayConnectorMetadataValue(metadata, 'webhook_url') || '');
    setAppConnectorWebhookTesting(false);
    setAppConnectorSecretInput('');
    setAppConnectorStatus(null);
    setAppConnectorError(null);
    setAppConnectorRuntimeTestResult(null);
    if (selectedAppConnector.definition.authMethod === 'oauth2') {
      void (async () => {
        try {
          const status = await getAccomplish().getAppConnectorOAuthClientSecretStatus(
            selectedAppConnector.definition.id,
            selectedAppConnector.config.instanceId
          );
          if (!cancelled) {
            setAppConnectorOauthClientSecretStored(Boolean(status?.secretSet));
          }
        } catch (err) {
          console.error('Failed to read app connector OAuth client secret status:', err);
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [selectedAppConnector]);

  useEffect(() => () => {
    if (appConnectorOauthPollTimerRef.current) {
      clearInterval(appConnectorOauthPollTimerRef.current);
      appConnectorOauthPollTimerRef.current = null;
    }
  }, []);

  const handleDebugToggle = async () => {
    const accomplish = getAccomplish();
    const newValue = !debugMode;
    setDebugMode(newValue);
    analytics.trackToggleDebugMode(newValue);
    try {
      await accomplish.setDebugMode(newValue);
    } catch (err) {
      console.error('Failed to save debug setting:', err);
      setDebugMode(!newValue);
    }
  };

  const handleModelChange = async (fullId: string) => {
    const accomplish = getAccomplish();
    const allModels = modelProviders.flatMap((p) => p.models);
    const model = allModels.find((m) => m.fullId === fullId);
    if (model) {
      analytics.trackSelectModel(model.displayName);
      const newSelection: SelectedModel = {
        provider: model.provider,
        model: model.fullId,
      };
      setModelStatusMessage(null);
      try {
        await accomplish.setSelectedModel(newSelection);
        setSelectedModel(newSelection);
        setModelStatusMessage(`Model updated to ${model.displayName}`);
      } catch (err) {
        console.error('Failed to save model selection:', err);
      }
    }
  };

  const handleSpeedModeChange = async (mode: 'fast' | 'balanced' | 'deep') => {
    const accomplish = getAccomplish();
    setAgentSpeedMode(mode);
    setAgentSpeedModeSaving(true);
    try {
      await accomplish.setAgentSpeedMode(mode);
      setModelStatusMessage(`Speed mode updated to ${mode}`);
    } catch (err) {
      console.error('Failed to save speed mode:', err);
      // Revert from persisted app settings
      try {
        const settings = await accomplish.getAppSettings();
        setAgentSpeedMode(
          settings?.agentSpeedMode === 'deep'
            ? 'deep'
            : settings?.agentSpeedMode === 'balanced'
              ? 'balanced'
              : 'fast'
        );
      } catch {
        // ignore revert failure
      }
    } finally {
      setAgentSpeedModeSaving(false);
    }
  };

  const openModelLimits = () => {
    const edits: Record<string, string> = {};
    for (const provider of modelProviders) {
      if (provider.id === 'ollama') continue;
      for (const model of provider.models) {
        const override = modelLimitOverrides[model.fullId]?.contextWindowTokens;
        edits[model.fullId] = typeof override === 'number' ? String(override) : '';
      }
    }
    setModelLimitsEdits(edits);
    setModelLimitsOpen(true);
  };

  const saveModelLimit = async (fullId: string) => {
    const accomplish = getAccomplish();
    setModelLimitsSaving((prev) => ({ ...prev, [fullId]: true }));
    setModelLimitsError(null);
    try {
      const raw = (modelLimitsEdits[fullId] ?? '').trim();
      const contextWindowTokens = raw ? Number(raw) : null;
      await accomplish.setModelContextLimitOverride({ fullId, contextWindowTokens: raw ? contextWindowTokens : null });
      const res = await accomplish.getModelLimitOverrides();
      const overrides = (res && typeof res === 'object' && 'overrides' in res)
        ? ((res as { overrides: Record<string, { contextWindowTokens?: number }> }).overrides ?? {})
        : {};
      setModelLimitOverrides(overrides);
    } catch (err) {
      console.error('Failed to save model limit:', err);
      setModelLimitsError(err instanceof Error ? err.message : 'Failed to save model context limit.');
    } finally {
      setModelLimitsSaving((prev) => ({ ...prev, [fullId]: false }));
    }
  };

  const resetModelLimit = async (fullId: string) => {
    const accomplish = getAccomplish();
    setModelLimitsSaving((prev) => ({ ...prev, [fullId]: true }));
    setModelLimitsError(null);
    try {
      await accomplish.setModelContextLimitOverride({ fullId, contextWindowTokens: null });
      setModelLimitsEdits((prev) => ({ ...prev, [fullId]: '' }));
      const res = await accomplish.getModelLimitOverrides();
      const overrides = (res && typeof res === 'object' && 'overrides' in res)
        ? ((res as { overrides: Record<string, { contextWindowTokens?: number }> }).overrides ?? {})
        : {};
      setModelLimitOverrides(overrides);
    } catch (err) {
      console.error('Failed to reset model limit:', err);
      setModelLimitsError(err instanceof Error ? err.message : 'Failed to reset model context limit.');
    } finally {
      setModelLimitsSaving((prev) => ({ ...prev, [fullId]: false }));
    }
  };

  const handleSaveApiKey = async () => {
    const accomplish = getAccomplish();
    const keyInput = apiKeyInputRef.current?.value ?? apiKey;
    const trimmedKey = keyInput.trim();
    const currentProvider = apiKeyProviders.find((entry) => entry.id === provider);

    if (!currentProvider) {
      setError('Select a provider first.');
      return;
    }

    if (!trimmedKey) {
      setError('Please enter an API key.');
      return;
    }

    const keyFormat = KNOWN_API_KEY_FORMATS[provider];
    if (keyFormat && !trimmedKey.startsWith(keyFormat.prefix)) {
      setError(`Invalid API key format. Key should start with ${keyFormat.prefix}`);
      return;
    }

    setIsSaving(true);
    setError(null);
    setStatusMessage(null);

    try {
      // Validate first
      const validation = await accomplish.validateApiKeyForProvider(provider, trimmedKey);
      if (!validation.valid) {
        setError(validation.error || 'Invalid API key');
        setIsSaving(false);
        return;
      }

      const savedKey = await accomplish.addApiKey(provider, trimmedKey);
      analytics.trackSaveApiKey(currentProvider.name || provider);
      setApiKey('');
      if (apiKeyInputRef.current) {
        apiKeyInputRef.current.value = '';
      }
      setStatusMessage(`${currentProvider.name || provider} API key saved securely.`);
      setSavedKeys((prev) => {
        const filtered = prev.filter((k) => k.provider !== savedKey.provider);
        return [...filtered, savedKey];
      });
      setApiKeyStatus((prev) => ({
        ...(prev || {}),
        [savedKey.provider]: { exists: true, prefix: savedKey.keyPrefix },
      }));
      onApiKeySaved?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save API key.';
      setError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteApiKey = async (id: string, providerName: string) => {
    const accomplish = getAccomplish();
    const providerLabel = getProviderDisplayName(providerName);
    try {
      await accomplish.removeApiKey(id);
      setSavedKeys((prev) => prev.filter((k) => k.id !== id));
      setApiKeyStatus((prev) => ({
        ...(prev || {}),
        [providerName]: { exists: false },
      }));
      setStatusMessage(`${providerLabel} API key removed.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove API key.';
      setError(message);
    }
  };

  const refreshProviderCatalog = async () => {
    const accomplish = getAccomplish();
    const [providers, customProviders] = await Promise.all([
      accomplish.listModelProviders(),
      accomplish.listCustomModelProviders(),
    ]);
    const providerList = Array.isArray(providers) && providers.length > 0 ? providers : DEFAULT_PROVIDERS;
    const customProviderList = Array.isArray(customProviders) ? customProviders : [];
    setModelProviders(providerList);
    setCustomModelProviders(customProviderList);
    setProvider((prev) => {
      const existing = providerList.find((entry) => entry.id === prev && entry.requiresApiKey && entry.id !== 'ollama');
      if (existing) return prev;
      const firstCloud = providerList.find((entry) => entry.requiresApiKey && entry.id !== 'ollama');
      return firstCloud?.id || prev;
    });
  };

  const resetCustomProviderForm = () => {
    setEditingCustomProviderId(null);
    setCustomProviderId('');
    setCustomProviderName('');
    setCustomProviderBaseUrl('');
    setCustomProviderRequiresApiKey(true);
    setCustomProviderModelsText('');
    setCustomProviderError(null);
    setCustomProviderStatus(null);
    if (customProviderIdInputRef.current) customProviderIdInputRef.current.value = '';
    if (customProviderNameInputRef.current) customProviderNameInputRef.current.value = '';
    if (customProviderBaseUrlInputRef.current) customProviderBaseUrlInputRef.current.value = '';
    if (customProviderModelsTextRef.current) customProviderModelsTextRef.current.value = '';
  };

  const customProviderModelValidation = useMemo(() => {
    const providerId = customProviderId.trim().toLowerCase() || 'custom';
    return validateCustomProviderModels(providerId, customProviderModelsText);
  }, [customProviderId, customProviderModelsText]);
  const hasCustomProviderModelInput = customProviderModelsText.trim().length > 0;

  const customProviderVisionRows = useMemo(
    () =>
      customProviderModelsText
        .split(/\r?\n/g)
        .map((rawLine, lineIndex) => {
          const trimmed = rawLine.trim();
          if (!trimmed) return null;
          const parts = trimmed.split('|').map((part) => part.trim());
          const modelId = parts[0] || `line-${lineIndex + 1}`;
          const displayName = parts[1] || modelId;
          return {
            lineIndex,
            lineNumber: lineIndex + 1,
            modelLabel: `${displayName} (${modelId})`,
            supportsVision: parts[4]?.toLowerCase() === 'true',
          };
        })
        .filter(
          (
            row
          ): row is {
            lineIndex: number;
            lineNumber: number;
            modelLabel: string;
            supportsVision: boolean;
          } => row !== null
        ),
    [customProviderModelsText]
  );

  const toggleCustomProviderModelVision = (lineIndex: number, enabled: boolean) => {
    setCustomProviderModelsText((prev) => {
      const lines = prev.split(/\r?\n/g);
      if (lineIndex < 0 || lineIndex >= lines.length) return prev;
      const parts = lines[lineIndex].split('|').map((part) => part.trim());
      if (!parts[0]) return prev;
      while (parts.length < 5) parts.push('');
      if (parts.length > 5) parts.length = 5;
      if (!parts[1]) parts[1] = parts[0];
      if (!parts[2]) parts[2] = '128000';
      if (!parts[3]) parts[3] = '4096';
      parts[4] = enabled ? 'true' : 'false';
      lines[lineIndex] = parts.join('|');
      const next = lines.join('\n');
      if (customProviderModelsTextRef.current) {
        customProviderModelsTextRef.current.value = next;
      }
      return next;
    });
  };

  const handleSaveCustomProvider = async () => {
    const accomplish = getAccomplish();
    const idInput = customProviderIdInputRef.current?.value ?? customProviderId;
    const nameInput = customProviderNameInputRef.current?.value ?? customProviderName;
    const baseUrlInput = customProviderBaseUrlInputRef.current?.value ?? customProviderBaseUrl;
    const modelsInput = customProviderModelsTextRef.current?.value ?? customProviderModelsText;
    const id = idInput.trim().toLowerCase();
    const name = nameInput.trim();
    const baseUrl = baseUrlInput.trim();
    setCustomProviderId(idInput);
    setCustomProviderName(nameInput);
    setCustomProviderBaseUrl(baseUrlInput);
    setCustomProviderModelsText(modelsInput);

    setCustomProviderError(null);
    setCustomProviderStatus(null);

    if (!id) {
      setCustomProviderError('Provider id is required.');
      return;
    }
    if (!CUSTOM_PROVIDER_ID_RE.test(id)) {
      setCustomProviderError('Provider id must be 1-64 chars and contain only letters, numbers, _ or -.');
      return;
    }
    if (editingCustomProviderId && editingCustomProviderId !== id) {
      setCustomProviderError('Provider id cannot be changed while editing.');
      return;
    }
    if (!baseUrl) {
      setCustomProviderError('Base URL is required.');
      return;
    }

    let models: ProviderConfig['models'];
    try {
      models = parseCustomProviderModels(id, modelsInput);
    } catch (err) {
      setCustomProviderError(err instanceof Error ? err.message : 'Invalid model list.');
      return;
    }

    setCustomProviderSaving(true);
    try {
      await accomplish.upsertCustomModelProvider({
        id,
        name: name || id,
        requiresApiKey: customProviderRequiresApiKey,
        baseUrl,
        models,
      });
      await refreshProviderCatalog();
      setCustomProviderStatus(`${name || id} provider saved.`);
      setProvider((prev) => {
        if (prev === id) return prev;
        return customProviderRequiresApiKey ? id : prev;
      });
      if (!editingCustomProviderId) {
        setCustomProviderId('');
        setCustomProviderName('');
        setCustomProviderBaseUrl('');
        setCustomProviderRequiresApiKey(true);
        setCustomProviderModelsText('');
        if (customProviderIdInputRef.current) customProviderIdInputRef.current.value = '';
        if (customProviderNameInputRef.current) customProviderNameInputRef.current.value = '';
        if (customProviderBaseUrlInputRef.current) customProviderBaseUrlInputRef.current.value = '';
        if (customProviderModelsTextRef.current) customProviderModelsTextRef.current.value = '';
      }
    } catch (err) {
      setCustomProviderError(err instanceof Error ? err.message : 'Failed to save provider.');
    } finally {
      setCustomProviderSaving(false);
    }
  };

  const handleEditCustomProvider = (providerConfig: ProviderConfig) => {
    setEditingCustomProviderId(providerConfig.id);
    setCustomProviderId(providerConfig.id);
    setCustomProviderName(providerConfig.name || providerConfig.id);
    setCustomProviderBaseUrl(providerConfig.baseUrl || '');
    setCustomProviderRequiresApiKey(providerConfig.requiresApiKey !== false);
    setCustomProviderModelsText(
      (providerConfig.models || [])
        .map((model) => {
          const contextWindow =
            typeof model.contextWindow === 'number' && Number.isFinite(model.contextWindow) && model.contextWindow > 0
              ? Math.floor(model.contextWindow)
              : 128000;
          const maxOutputTokens =
            typeof model.maxOutputTokens === 'number' &&
            Number.isFinite(model.maxOutputTokens) &&
            model.maxOutputTokens > 0
              ? Math.floor(model.maxOutputTokens)
              : 4096;
          const parts = [
            model.id,
            model.displayName || model.id,
            String(contextWindow),
            String(maxOutputTokens),
            model.supportsVision === true ? 'true' : 'false',
          ];
          return parts.join('|');
        })
        .join('\n')
    );
    const modelText = (providerConfig.models || [])
      .map((model) => {
        const contextWindow =
          typeof model.contextWindow === 'number' && Number.isFinite(model.contextWindow) && model.contextWindow > 0
            ? Math.floor(model.contextWindow)
            : 128000;
        const maxOutputTokens =
          typeof model.maxOutputTokens === 'number' &&
          Number.isFinite(model.maxOutputTokens) &&
          model.maxOutputTokens > 0
            ? Math.floor(model.maxOutputTokens)
            : 4096;
        const parts = [
          model.id,
          model.displayName || model.id,
          String(contextWindow),
          String(maxOutputTokens),
          model.supportsVision === true ? 'true' : 'false',
        ];
        return parts.join('|');
      })
      .join('\n');
    if (customProviderIdInputRef.current) customProviderIdInputRef.current.value = providerConfig.id;
    if (customProviderNameInputRef.current) customProviderNameInputRef.current.value = providerConfig.name || providerConfig.id;
    if (customProviderBaseUrlInputRef.current) customProviderBaseUrlInputRef.current.value = providerConfig.baseUrl || '';
    if (customProviderModelsTextRef.current) customProviderModelsTextRef.current.value = modelText;
    setCustomProviderError(null);
    setCustomProviderStatus(null);
  };

  const handleDeleteCustomProvider = async (providerId: string) => {
    const accomplish = getAccomplish();
    setDeletingCustomProviderId(providerId);
    setCustomProviderError(null);
    setCustomProviderStatus(null);
    try {
      await accomplish.deleteCustomModelProvider(providerId);
      await refreshProviderCatalog();
      if (editingCustomProviderId === providerId) {
        resetCustomProviderForm();
      }
      setCustomProviderStatus(`${getProviderDisplayName(providerId)} provider removed.`);
    } catch (err) {
      setCustomProviderError(err instanceof Error ? err.message : 'Failed to remove provider.');
    } finally {
      setDeletingCustomProviderId(null);
    }
  };

  const handleTestOllama = async () => {
    const accomplish = getAccomplish();
    setTestingOllama(true);
    setOllamaError(null);
    setOllamaConnected(false);
    setOllamaModels([]);

    try {
      const result = await accomplish.testOllamaConnection(ollamaUrl);
      if (result.success && result.models) {
        setOllamaConnected(true);
        setOllamaModels(result.models);
        if (result.models.length > 0) {
          setSelectedOllamaModel(result.models[0].id);
        }
      } else {
        setOllamaError(result.error || 'Connection failed');
      }
    } catch (err) {
      setOllamaError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setTestingOllama(false);
    }
  };

  const handleSaveOllama = async () => {
    const accomplish = getAccomplish();
    setSavingOllama(true);

    try {
      // Save the Ollama config
      await accomplish.setOllamaConfig({
        baseUrl: ollamaUrl,
        enabled: true,
        lastValidated: Date.now(),
        models: ollamaModels,  // Include discovered models
      });

      // Set as selected model
      await accomplish.setSelectedModel({
        provider: 'ollama',
        model: `ollama/${selectedOllamaModel}`,
        baseUrl: ollamaUrl,
      });

      setSelectedModel({
        provider: 'ollama',
        model: `ollama/${selectedOllamaModel}`,
        baseUrl: ollamaUrl,
      });

      setModelStatusMessage(`Model updated to ${selectedOllamaModel}`);
    } catch (err) {
      setOllamaError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSavingOllama(false);
    }
  };

  const refreshSkills = async () => {
    const accomplish = getAccomplish();
    setLoadingSkills(true);
    try {
      const status = await accomplish.getSkillsStatus();
      setSkillsStatus(status);
      setSkillsError(null);
    } catch (err) {
      console.error('Failed to fetch skills:', err);
      setSkillsError('Unable to load skills status.');
    } finally {
      setLoadingSkills(false);
    }
  };

  const refreshUserSkills = async () => {
    const accomplish = getAccomplish();
    setLoadingUserSkills(true);
    try {
      const report = await accomplish.listUserSkills(activeAgentId);
      setUserSkillsReport(report as unknown as UserSkillsReport);
      setUserSkillsError(null);
    } catch (err) {
      console.error('Failed to fetch user skills:', err);
      setUserSkillsError('Unable to load user skills.');
    } finally {
      setLoadingUserSkills(false);
    }
  };

  const refreshUserSkillsDeps = async () => {
    const accomplish = getAccomplish();
    setLoadingUserSkillsDeps(true);
    try {
      const report = await accomplish.getUserSkillsDependencyStatus(activeAgentId);
      setUserSkillsDepsReport(report as unknown as UserSkillDependencyStatusReport);
      setUserSkillsDepsError(null);
    } catch (err) {
      console.error('Failed to fetch user skill dependencies:', err);
      setUserSkillsDepsError('Unable to load user skill dependency status.');
    } finally {
      setLoadingUserSkillsDeps(false);
    }
  };

  const getUserSkillKey = (skill: UserSkillEntry): string => {
    const envelope = skill.metadata?.opendeskmate || skill.metadata?.clawdbot;
    const key = String(envelope?.skillKey || '').trim();
    return key || skill.id;
  };

  const toConfigurableUserSkill = (skill: UserSkillEntry): UserSkillDependencyStatusEntry => ({
    ...skill,
    skillKey: getUserSkillKey(skill),
    always: false,
    disabled: false,
    eligible: true,
    missing: {
      bins: [],
      anyBins: [],
      env: [],
      config: [],
      os: [],
    },
    install: [],
  });

  const skillAssistantTargets = useMemo<Array<{
    value: string;
    id: string;
    name: string;
    source: 'managed' | 'workspace' | 'bundled' | 'extra';
    skillKey?: string;
  }>>(() => {
    const byKey = new Map<string, {
      value: string;
      id: string;
      name: string;
      source: 'managed' | 'workspace' | 'bundled' | 'extra';
      skillKey?: string;
    }>();
    const depSkills = userSkillsDepsReport?.skills || [];
    for (const skill of depSkills) {
      const value = `${skill.source}:${skill.id}`;
      byKey.set(value, {
        value,
        id: skill.id,
        name: skill.name,
        source: skill.source,
        skillKey: skill.skillKey,
      });
    }
    const plainSkills = userSkillsReport?.skills || [];
    for (const skill of plainSkills) {
      const value = `${skill.source}:${skill.id}`;
      if (byKey.has(value)) continue;
      byKey.set(value, {
        value,
        id: skill.id,
        name: skill.name,
        source: skill.source,
        skillKey: getUserSkillKey(skill),
      });
    }
    return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [userSkillsDepsReport, userSkillsReport]);

  const getSkillVisibilityLabel = (skill: UserSkillEntry): string => {
    const scope = skill.visibilityScope || 'all';
    if (scope === 'all') {
      return 'Shared with all agents';
    }
    if (scope === 'selected') {
      const count = skill.visibilitySharedWithAgentIds?.length || 0;
      return count > 0 ? `Shared with ${count} selected agent${count === 1 ? '' : 's'}` : 'Shared with selected agents';
    }
    const ownerAgentId = skill.visibilityOwnerAgentId || '';
    const ownerName = ownerAgentId
      ? (agents.find((agent) => agent.id === ownerAgentId)?.name || ownerAgentId)
      : 'Owner agent';
    return `Private to ${ownerName}`;
  };

  const getSkillAccessAgentNames = (skill: UserSkillEntry): string[] => {
    const resolveAgentName = (agentId: string): string =>
      agents.find((agent) => agent.id === agentId)?.name || agentId;

    const scope = skill.visibilityScope || 'all';
    if (scope === 'all') {
      return agents.map((agent) => agent.name);
    }

    const ownerAgentId = (skill.visibilityOwnerAgentId || '').trim();
    const ownerName = ownerAgentId ? resolveAgentName(ownerAgentId) : '';

    if (scope === 'private') {
      return ownerName ? [ownerName] : [];
    }

    const shared = (skill.visibilitySharedWithAgentIds || [])
      .map((agentId) => resolveAgentName(agentId))
      .filter(Boolean);

    return ownerName ? [ownerName, ...shared] : shared;
  };

  const getSkillAccessLabel = (skill: UserSkillEntry): string => {
    const names = getSkillAccessAgentNames(skill);
    if (!names.length) {
      return 'Agents with access: none';
    }
    return `Agents with access: ${names.join(', ')}`;
  };

  const openShareUserSkill = (skill: UserSkillEntry) => {
    const scope = skill.visibilityScope || 'all';
    setSharingUserSkill(skill);
    setShareUserSkillScope(scope);
    setShareUserSkillAgentIds([...(skill.visibilitySharedWithAgentIds || [])]);
    setShareUserSkillError(null);
  };

  const toggleShareAgentId = (agentId: string, checked: boolean) => {
    setShareUserSkillAgentIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(agentId);
      } else {
        next.delete(agentId);
      }
      return Array.from(next);
    });
  };

  const handleSaveShareUserSkill = async () => {
    if (!sharingUserSkill) return;
    const accomplish = getAccomplish();
    setSavingShareUserSkill(true);
    setShareUserSkillError(null);
    try {
      await accomplish.setUserSkillSharing({
        skillId: sharingUserSkill.id,
        source: sharingUserSkill.source,
        agentId: activeAgentId,
        scope: shareUserSkillScope,
        sharedWithAgentIds: shareUserSkillScope === 'selected' ? shareUserSkillAgentIds : [],
      });
      setSharingUserSkill(null);
      setShareUserSkillAgentIds([]);
      setShareUserSkillScope('private');
      await refreshUserSkills();
      await refreshUserSkillsDeps();
    } catch (err) {
      console.error('Failed to save user skill sharing:', err);
      setShareUserSkillError(err instanceof Error ? err.message : 'Failed to save sharing settings.');
    } finally {
      setSavingShareUserSkill(false);
    }
  };

  const openEditUserSkill = async (skill: UserSkillEntry) => {
    const accomplish = getAccomplish();
    setUserSkillsError(null);
    try {
      const res = await accomplish.readUserSkillFile({
        skillId: skill.id,
        relPath: 'SKILL.md',
        source: skill.source,
        agentId: activeAgentId,
      });
      setEditingUserSkill(skill);
      setEditingUserSkillContent(res.content || '');
    } catch (err) {
      console.error('Failed to open skill:', err);
      setUserSkillsError('Failed to open skill file.');
    }
  };

  const openConfigureUserSkill = async (skill: UserSkillDependencyStatusEntry) => {
    const accomplish = getAccomplish();
    setUserSkillsDepsError(null);
    setConfiguringUserSkillError(null);
    try {
      const res = await accomplish.getUserSkillConfig({ skillKey: skill.skillKey });
      setConfiguringUserSkill(skill);
      setConfiguringUserSkillJson(JSON.stringify(res.config || {}, null, 2));
    } catch (err) {
      console.error('Failed to load user skill config:', err);
      setUserSkillsDepsError('Failed to load skill config.');
    }
  };

  const handleSaveUserSkillConfig = async () => {
    if (!configuringUserSkill) return;
    const accomplish = getAccomplish();
    setSavingUserSkillConfig(true);
    setConfiguringUserSkillError(null);
    try {
      const parsed = parseJson5ishObject(configuringUserSkillJson);
      await accomplish.setUserSkillConfig({ skillKey: configuringUserSkill.skillKey, config: parsed });
      setConfiguringUserSkill(null);
      setConfiguringUserSkillJson('');
      await refreshUserSkillsDeps();
    } catch (err) {
      console.error('Failed to save user skill config:', err);
      setConfiguringUserSkillError(err instanceof Error ? err.message : 'Failed to save skill config.');
    } finally {
      setSavingUserSkillConfig(false);
    }
  };

  const handleInsertRequiredSkillConfig = () => {
    if (!configuringUserSkill) return;
    const requiredPaths = configuringUserSkill.requirements?.config || [];
    if (requiredPaths.length === 0) return;
    try {
      const parsed = parseJson5ishObject(configuringUserSkillJson);
      for (const path of requiredPaths) {
        if (!path || path.startsWith('skills.')) continue;
        const existing = getLocalConfigPathValue(parsed, path);
        if (existing === undefined) {
          setLocalConfigPathValue(parsed, path, requiredConfigPlaceholder(path));
        }
      }
      setConfiguringUserSkillJson(JSON.stringify(parsed, null, 2));
      setConfiguringUserSkillError(null);
    } catch (err) {
      setConfiguringUserSkillError(err instanceof Error ? err.message : 'Invalid config JSON.');
    }
  };

  const configuringRequiredConfigPaths = useMemo<string[]>(
    () => configuringUserSkill?.requirements?.config || [],
    [configuringUserSkill]
  );

  const configuringRequiredConfigStatus = useMemo<Array<{ path: string; satisfied: boolean; localPath: boolean }>>(() => {
    if (!configuringUserSkill) return [];
    let parsed: Record<string, unknown> = {};
    try {
      parsed = parseJson5ishObject(configuringUserSkillJson);
    } catch {
      parsed = {};
    }
    return configuringRequiredConfigPaths.map((path: string) => {
      const raw = String(path || '').trim();
      const localPath = raw.length > 0 && !raw.startsWith('skills.');
      const value = localPath ? getLocalConfigPathValue(parsed, raw) : undefined;
      const satisfied = Boolean(value);
      return { path: raw, satisfied, localPath };
    });
  }, [configuringUserSkill, configuringRequiredConfigPaths, configuringUserSkillJson]);

  const openSkillAssistantDialog = (params?: {
    mode?: 'general' | 'configure' | 'edit';
    skill?: UserSkillEntry | UserSkillDependencyStatusEntry | null;
    draftContent?: string;
    question?: string;
  }) => {
    const mode = params?.mode || 'general';
    const skill = params?.skill || null;
    const targetValue = skill ? `${skill.source}:${skill.id}` : '';
    if (targetValue) {
      setSkillAssistantTargetValue(targetValue);
    } else if (!skillAssistantTargetValue && skillAssistantTargets.length > 0) {
      setSkillAssistantTargetValue(skillAssistantTargets[0].value);
    }
    setSkillAssistantMode(mode);
    setSkillAssistantDraftContent(params?.draftContent || '');
    setSkillAssistantQuestion(params?.question || '');
    setSkillAssistantAnswer('');
    setSkillAssistantError(null);
    setSkillAssistantFormVersion((prev) => prev + 1);
    setSkillAssistantOpen(true);
  };

  const handleAskSkillAssistant = async () => {
    const accomplish = getAccomplish();
    const modeRaw = (skillAssistantModeInputRef.current?.value || skillAssistantMode || 'general').trim().toLowerCase();
    const mode = (modeRaw === 'configure' || modeRaw === 'edit' ? modeRaw : 'general') as 'general' | 'configure' | 'edit';
    const targetValue = skillAssistantTargetInputRef.current?.value ?? skillAssistantTargetValue;
    const target = targetValue
      ? (skillAssistantTargets.find((entry) => entry.value === targetValue) || null)
      : null;
    const rawQuestion = skillAssistantQuestionInputRef.current?.value ?? skillAssistantQuestion;
    const question = rawQuestion.trim();
    if (!question) {
      setSkillAssistantError('Enter a question for Skill Assistant.');
      return;
    }
    setSkillAssistantLoading(true);
    setSkillAssistantError(null);
    try {
      setSkillAssistantMode(mode);
      setSkillAssistantTargetValue(targetValue);
      setSkillAssistantQuestion(rawQuestion);
      const res = await accomplish.askUserSkillAssistant({
        question,
        skillId: target?.id,
        source: target?.source,
        skillKey: target?.skillKey,
        mode,
        agentId: activeAgentId,
        draftContent: skillAssistantDraftContent || undefined,
      }) as UserSkillAssistantAskResponse;
      setSkillAssistantAnswer((res?.answer || '').trim() || 'No response returned.');
    } catch (err) {
      console.error('Failed to ask skill assistant:', err);
      setSkillAssistantError(err instanceof Error ? err.message : 'Failed to ask Skill Assistant.');
    } finally {
      setSkillAssistantLoading(false);
    }
  };

  const handleInstallUserSkillDep = async (skill: UserSkillDependencyStatusEntry, option: UserSkillInstallOption) => {
    const accomplish = getAccomplish();
    setInstallingUserSkillDep({ skillId: skill.id, installId: option.id });
    setUserSkillsDepsError(null);
    try {
      const result = await accomplish.installUserSkillDependency({
        skillId: skill.id,
        installId: option.id,
        source: skill.source,
        agentId: activeAgentId,
      });
      if (!result.ok) {
        setUserSkillsDepsError(result.message || 'Install failed.');
      } else {
        setStatusMessage(result.message || 'Installed.');
      }
      await refreshUserSkillsDeps();
    } catch (err) {
      console.error('Failed to install skill dependency:', err);
      setUserSkillsDepsError('Failed to run installer.');
    } finally {
      setInstallingUserSkillDep(null);
    }
  };

  const handleDeleteUserSkill = async () => {
    if (!deleteConfirmUserSkill) return;
    const accomplish = getAccomplish();
    setDeletingUserSkill(true);
    setUserSkillsError(null);
    setUserSkillsDepsError(null);
    try {
      const res = await accomplish.deleteUserSkill({
        skillId: deleteConfirmUserSkill.skillId,
        source: deleteConfirmUserSkill.source,
        agentId: activeAgentId,
      });
      if (!res.ok) {
        setUserSkillsError(res.message || 'Failed to delete skill.');
      } else {
        setStatusMessage(res.message || 'Deleted skill.');
      }
      setDeleteConfirmUserSkill(null);
      await refreshUserSkills();
      await refreshUserSkillsDeps();
    } catch (err) {
      console.error('Failed to delete user skill:', err);
      setUserSkillsError(err instanceof Error ? err.message : 'Failed to delete skill.');
    } finally {
      setDeletingUserSkill(false);
    }
  };

  const handleCreateUserSkill = async () => {
    const accomplish = getAccomplish();
    setUserSkillsError(null);
    const skillId = newUserSkillId.trim();
    if (!skillId) {
      setUserSkillsError('Skill ID is required.');
      return;
    }
    try {
      setSavingUserSkill(true);
      await accomplish.createUserSkill({
        skillId,
        name: newUserSkillName.trim() || undefined,
        description: newUserSkillDesc.trim() || undefined,
      });
      setCreatingUserSkill(false);
      setNewUserSkillId('');
      setNewUserSkillName('');
      setNewUserSkillDesc('');
      await refreshUserSkills();
      await refreshUserSkillsDeps();
      const created = (userSkillsReport?.skills || []).find((s) => s.id === skillId) || null;
      if (created) {
        await openEditUserSkill(created);
      }
    } catch (err) {
      console.error('Failed to create user skill:', err);
      setUserSkillsError(err instanceof Error ? err.message : 'Failed to create skill.');
    } finally {
      setSavingUserSkill(false);
    }
  };

  const handleSaveUserSkill = async () => {
    if (!editingUserSkill) return;
    const accomplish = getAccomplish();
    setUserSkillsError(null);
    setSavingUserSkill(true);
    try {
      await accomplish.writeUserSkillFile({
        skillId: editingUserSkill.id,
        relPath: 'SKILL.md',
        content: editingUserSkillContent,
        source: editingUserSkill.source,
        agentId: activeAgentId,
      });
      await refreshUserSkills();
      await refreshUserSkillsDeps();
    } catch (err) {
      console.error('Failed to save user skill:', err);
      setUserSkillsError('Failed to save skill.');
    } finally {
      setSavingUserSkill(false);
    }
  };

  const resetImportZipState = async () => {
    const accomplish = getAccomplish();
    if (importZipSession) {
      try {
        await accomplish.cleanupUserSkillZipSession({ sessionId: importZipSession });
      } catch {
        // ignore
      }
    }
    setImportZipSession(null);
    setImportZipCandidates([]);
    setImportZipSelected(null);
    setImportZipDestId('');
    setImportZipOverwrite(false);
    setImportZipError(null);
    setImportZipInspecting(false);
    setImportZipInstalling(false);
    setImportZipUrl('');
    setImportZipLocalPath(null);
    setImportZipMode('github');
  };

  const handlePickImportZipLocal = async () => {
    const accomplish = getAccomplish();
    setImportZipError(null);
    try {
      const files = await accomplish.selectFiles();
      const zip = files.find((p) => p.toLowerCase().endsWith('.zip')) || files[0] || null;
      if (!zip) return;
      setImportZipLocalPath(zip);
    } catch (err) {
      console.error('Failed to pick ZIP file:', err);
      setImportZipError('Failed to open file picker.');
    }
  };

  const handleInspectImportZip = async () => {
    const accomplish = getAccomplish();
    setImportZipError(null);
    setImportZipInspecting(true);
    try {
      const payload =
        importZipMode === 'local'
          ? (importZipLocalPath ? { source: 'local', filePath: importZipLocalPath, agentId: activeAgentId } : null)
          : (importZipUrl.trim() ? { source: 'github', url: importZipUrl.trim(), agentId: activeAgentId } : null);

      if (!payload) {
        setImportZipError(importZipMode === 'local' ? 'Pick a .zip file.' : 'Enter a GitHub ZIP URL.');
        return;
      }

      const res = (await accomplish.inspectUserSkillZip(payload as any)) as UserSkillZipInspectResponse;
      setImportZipSession(res.sessionId);
      setImportZipCandidates(res.candidates || []);
      const first = (res.candidates || [])[0] || null;
      setImportZipSelected(first);
      setImportZipDestId(first?.skillId || '');
      if (res.message && (!res.candidates || res.candidates.length === 0)) {
        setImportZipError(res.message);
      } else if (res.message) {
        setStatusMessage(res.message);
      }
    } catch (err) {
      console.error('Failed to inspect ZIP:', err);
      setImportZipError(err instanceof Error ? err.message : 'Failed to inspect ZIP.');
    } finally {
      setImportZipInspecting(false);
    }
  };

  const handleInstallImportZip = async () => {
    const accomplish = getAccomplish();
    setImportZipError(null);
    if (!importZipSession || !importZipSelected) {
      setImportZipError('Inspect a ZIP and select a skill first.');
      return;
    }
    const dest = importZipDestId.trim();
    if (!dest) {
      setImportZipError('Destination skill ID is required.');
      return;
    }
    setImportZipInstalling(true);
    try {
      const res = (await accomplish.installUserSkillFromZip({
        sessionId: importZipSession,
        relPath: importZipSelected.relPath,
        destSkillId: dest,
        overwrite: importZipOverwrite,
        agentId: activeAgentId,
      } as any)) as UserSkillZipInstallResult;

      if (!res.ok) {
        setImportZipError(res.message || 'Install failed.');
        return;
      }

      setStatusMessage(res.message || 'Installed.');
      await refreshUserSkills();
      await refreshUserSkillsDeps();
      setImportingUserSkillZip(false);
      await resetImportZipState();
    } catch (err) {
      console.error('Failed to install ZIP skill:', err);
      setImportZipError(err instanceof Error ? err.message : 'Install failed.');
    } finally {
      setImportZipInstalling(false);
    }
  };

  const handleInstallSkill = async (skillId: string) => {
    const accomplish = getAccomplish();
    setInstallingSkill(skillId);
    setSkillsError(null);
    try {
      await accomplish.installSkill(skillId);
      await refreshSkills();
    } catch (err) {
      console.error('Failed to install skill:', err);
      setSkillsError('Failed to install skill dependencies.');
    } finally {
      setInstallingSkill(null);
    }
  };

  const handleUninstallSkill = async (skillId: string) => {
    const accomplish = getAccomplish();
    setUninstallingSkill(skillId);
    setSkillsError(null);
    try {
      await accomplish.uninstallSkill(skillId);
      await refreshSkills();
    } catch (err) {
      console.error('Failed to uninstall skill:', err);
      setSkillsError('Failed to uninstall skill dependencies.');
    } finally {
      setUninstallingSkill(null);
    }
  };

  const handleInstallAllSkills = async () => {
    const accomplish = getAccomplish();
    setInstallingAll(true);
    setSkillsError(null);
    try {
      await accomplish.installAllSkills();
      await refreshSkills();
    } catch (err) {
      console.error('Failed to install all skills:', err);
      setSkillsError('Failed to install skill dependencies.');
    } finally {
      setInstallingAll(false);
    }
  };

  const handleRunInBackgroundToggle = async () => {
    const accomplish = getAccomplish();
    const nextValue = !runInBackground;
    setRunInBackgroundState(nextValue);
    setStartupSaving(true);
    try {
      await accomplish.setRunInBackground(nextValue);
    } catch (err) {
      console.error('Failed to save run-in-background setting:', err);
      setRunInBackgroundState(!nextValue);
    } finally {
      setStartupSaving(false);
    }
  };

  const handleLaunchAtLoginToggle = async () => {
    const accomplish = getAccomplish();
    const nextValue = !launchAtLogin;
    setLaunchAtLoginState(nextValue);
    setStartupSaving(true);
    try {
      await accomplish.setLaunchAtLogin(nextValue);
    } catch (err) {
      console.error('Failed to save launch-at-login setting:', err);
      setLaunchAtLoginState(!nextValue);
    } finally {
      setStartupSaving(false);
    }
  };

  const handleMobileNodesToggle = async () => {
    const accomplish = getAccomplish();
    const nextValue = !mobileNodesEnabled;
    setMobileNodesEnabledState(nextValue);
    setNodePairingError(null);
    try {
      await accomplish.setMobileNodesEnabled(nextValue);
      if (nextValue) {
        await refreshNodePairing();
      }
    } catch (err) {
      console.error('Failed to save mobile nodes setting:', err);
      setMobileNodesEnabledState(!nextValue);
      setNodePairingError('Unable to update mobile node setting.');
    }
  };

  const handleMobileNodesMaxPreviewChange = async (value: string) => {
    const accomplish = getAccomplish();
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return;
    const normalized = Math.max(1, Math.min(10, parsed));
    setMobileNodesMaxLivePreviewsState(normalized);
    try {
      const saved = await accomplish.setMobileNodesMaxLivePreviews(normalized);
      setMobileNodesMaxLivePreviewsState(saved);
    } catch (err) {
      console.error('Failed to save max live previews setting:', err);
      setNodePairingError('Unable to update live preview limit.');
    }
  };

  const handleMobileNodesNameBlur = async () => {
    const accomplish = getAccomplish();
    const nextDisplayName = mobileNodesDisplayNameInputRef.current?.value ?? mobileNodesDisplayName;
    setMobileNodesDisplayNameState(nextDisplayName);
    try {
      const saved = await accomplish.setMobileNodesDisplayName(nextDisplayName);
      setMobileNodesDisplayNameState(saved);
      if (mobileNodesDisplayNameInputRef.current) {
        mobileNodesDisplayNameInputRef.current.value = saved;
      }
    } catch (err) {
      console.error('Failed to save mobile nodes name:', err);
      setNodePairingError('Unable to save mobile node name.');
    }
  };

  const handleWebhookBindModeChange = async (mode: 'localhost' | 'all') => {
    const accomplish = getAccomplish();
    const nextMode = mode === 'all' ? 'all' : 'localhost';
    setWebhookBindModeState(nextMode);
    setWebhookBindNeedsRestart(true);
    try {
      await accomplish.setWebhookBindMode(nextMode);
    } catch (err) {
      console.error('Failed to save webhook bind mode:', err);
      setWebhookBindModeState(webhookBindMode);
      setNodePairingError('Unable to save webhook bind setting.');
    }
  };

  const handleSaveBrowserProfile = async () => {
    const accomplish = getAccomplish();
    const trimmed = browserProfile.trim() || 'default';
    setBrowserProfileSaving(true);
    try {
      const saved = await accomplish.setBrowserProfile(trimmed);
      setBrowserProfileState(saved);
    } catch (err) {
      console.error('Failed to save browser profile:', err);
    } finally {
      setBrowserProfileSaving(false);
    }
  };

  const handleSelectWorkspace = async () => {
    const accomplish = getAccomplish();
    setWorkspaceSaving(true);
    try {
      const folder = await accomplish.selectFolder();
      if (!folder) return;
      const saved = await accomplish.setWorkspaceRoot(folder);
      setWorkspaceRootState(saved);
      await refreshMemoryState();
    } catch (err) {
      console.error('Failed to set workspace root:', err);
    } finally {
      setWorkspaceSaving(false);
    }
  };

  const handleClearWorkspace = async () => {
    const accomplish = getAccomplish();
    setWorkspaceSaving(true);
    try {
      const saved = await accomplish.setWorkspaceRoot(null);
      setWorkspaceRootState(saved);
      await refreshMemoryState();
    } catch (err) {
      console.error('Failed to clear workspace root:', err);
    } finally {
      setWorkspaceSaving(false);
    }
  };

  const handleSaveLongTermMemory = async () => {
    const accomplish = getAccomplish();
    const nextLongTerm = memoryLongTermRef.current?.value ?? memoryLongTerm;
    setMemoryLongTerm(nextLongTerm);
    setMemorySaving(true);
    setMemoryError(null);
    try {
      await accomplish.saveMemoryFile({ kind: 'long-term', content: nextLongTerm, agentId: activeAgentId });
    } catch (err) {
      console.error('Failed to save long-term memory:', err);
      setMemoryError('Unable to save MEMORY.md');
    } finally {
      setMemorySaving(false);
    }
  };

  const handleSaveDailyMemory = async () => {
    const accomplish = getAccomplish();
    const nextDaily = memoryDailyRef.current?.value ?? memoryDaily;
    setMemoryDaily(nextDaily);
    setMemorySaving(true);
    setMemoryError(null);
    try {
      await accomplish.saveMemoryFile({ kind: 'daily', date: memoryDailyDate, content: nextDaily, agentId: activeAgentId });
      if (!memoryDailyFiles.includes(memoryDailyDate)) {
        setMemoryDailyFiles((prev) => [memoryDailyDate, ...prev]);
      }
    } catch (err) {
      console.error('Failed to save daily memory:', err);
      setMemoryError('Unable to save daily memory');
    } finally {
      setMemorySaving(false);
    }
  };

  const handleDailyDateChange = async (nextDate: string) => {
    const accomplish = getAccomplish();
    setMemoryDailyDate(nextDate);
    setMemoryLoading(true);
    setMemoryError(null);
    try {
      const file = await accomplish.readMemoryFile({ kind: 'daily', date: nextDate, agentId: activeAgentId });
      setMemoryDaily(file.content || '');
      if (memoryDailyRef.current) {
        memoryDailyRef.current.value = file.content || '';
      }
    } catch (err) {
      console.error('Failed to load daily memory:', err);
      setMemoryError('Unable to load daily memory');
    } finally {
      setMemoryLoading(false);
    }
  };

  const normalizeGatewayChannel = (value: string): string => {
    const next = value.trim().toLowerCase();
    return next || 'webhook';
  };

  const resetGatewayBindingEditor = () => {
    setGatewayBindingEditorId(null);
    setGatewayBindingChannel('discord');
    setGatewayBindingAccountId('');
    setGatewayBindingPeerKind('dm');
    setGatewayBindingPeerId('');
    setGatewayBindingGuildId('');
    setGatewayBindingTeamId('');
  };

  const getFirstModelForProvider = (providerId: ProviderType): string => {
    if (providerId === 'ollama') {
      const firstOllama = ollamaModels[0]?.id || selectedOllamaModel || '';
      if (!firstOllama) return 'ollama/llama3.1:8b';
      return firstOllama.startsWith('ollama/') ? firstOllama : `ollama/${firstOllama}`;
    }
    const providerConfig = modelProviders.find((entry) => entry.id === providerId);
    if (providerConfig?.models?.[0]?.fullId) {
      return providerConfig.models[0].fullId;
    }
    return '';
  };

  const applyAgentModelForm = (model: SelectedModel | null | undefined) => {
    const baseModel = model ?? selectedModel ?? AGENT_FALLBACK_MODEL;
    const providerId = (baseModel.provider || AGENT_FALLBACK_MODEL.provider) as ProviderType;
    const fallbackModelId = getFirstModelForProvider(providerId);
    const providerConfig = modelProviders.find((entry) => entry.id === providerId);
    const modelId = (
      baseModel.model
      || fallbackModelId
      || (providerId === 'custom' ? '' : AGENT_FALLBACK_MODEL.model)
    ).trim();
    setAgentModelProvider(providerId);
    setAgentModelId(modelId);
    setAgentModelBaseUrl(baseModel.baseUrl || providerConfig?.baseUrl || '');
  };

  const normalizeAgentSelectedModel = (): SelectedModel | null => {
    if (!agentModelOverrideEnabled) return null;
    let modelId = agentModelId.trim();
    if (!modelId) return null;

    if (agentModelProvider === 'ollama' && !modelId.startsWith('ollama/')) {
      modelId = `ollama/${modelId}`;
    }

    const selected: SelectedModel = {
      provider: agentModelProvider,
      model: modelId,
    };

    const trimmedBaseUrl = agentModelBaseUrl.trim();
    const providerConfig = modelProviders.find((entry) => entry.id === agentModelProvider);
    if (trimmedBaseUrl && (agentModelProvider === 'ollama' || agentModelProvider === 'custom' || Boolean(providerConfig?.baseUrl))) {
      selected.baseUrl = trimmedBaseUrl;
    }

    return selected;
  };

  const formatSelectedModelLabel = (model: SelectedModel | null | undefined): string => {
    if (!model?.model) {
      return 'Global default';
    }
    if (model.provider === 'ollama') {
      return `Ollama: ${model.model.replace(/^ollama\//, '')}`;
    }
    const knownModel = modelProviders.flatMap((entry) => entry.models).find((entry) => entry.fullId === model.model);
    const providerLabel = getProviderDisplayName(model.provider);
    return knownModel ? `${providerLabel}: ${knownModel.displayName}` : `${providerLabel}: ${model.model}`;
  };

  const handleAgentModelProviderChange = (providerId: ProviderType) => {
    setAgentModelProvider(providerId);
    const currentModel = agentModelId.trim();
    if (providerId === 'ollama') {
      if (!currentModel || !currentModel.startsWith('ollama/')) {
        setAgentModelId(getFirstModelForProvider('ollama'));
      }
      if (!agentModelBaseUrl.trim()) {
        setAgentModelBaseUrl((selectedModel?.provider === 'ollama' ? selectedModel.baseUrl : '') || ollamaUrl || '');
      }
      return;
    }
    const providerConfig = modelProviders.find((entry) => entry.id === providerId);
    const available = providerConfig?.models ?? [];
    if (providerId === 'custom') {
      if (!currentModel) {
        setAgentModelId('');
      }
      return;
    }
    setAgentModelBaseUrl(providerConfig?.baseUrl || '');
    const hasCurrent = available.some((entry) => entry.fullId === currentModel);
    setAgentModelId(hasCurrent ? currentModel : getFirstModelForProvider(providerId));
  };

  const applySkillAssistantModelForm = (model: SelectedModel | null | undefined) => {
    const baseModel = model ?? selectedModel ?? AGENT_FALLBACK_MODEL;
    const providerId = (baseModel.provider || AGENT_FALLBACK_MODEL.provider) as ProviderType;
    const fallbackModelId = getFirstModelForProvider(providerId);
    const providerConfig = modelProviders.find((entry) => entry.id === providerId);
    const modelId = (
      baseModel.model
      || fallbackModelId
      || (providerId === 'custom' ? '' : AGENT_FALLBACK_MODEL.model)
    ).trim();
    setSkillAssistantModelProvider(providerId);
    setSkillAssistantModelId(modelId);
    setSkillAssistantModelBaseUrl(baseModel.baseUrl || providerConfig?.baseUrl || '');
  };

  const normalizeSkillAssistantSelectedModel = (): SelectedModel | null => {
    if (!skillAssistantModelOverrideEnabled) return null;
    let modelId = skillAssistantModelId.trim();
    if (!modelId) return null;

    if (skillAssistantModelProvider === 'ollama' && !modelId.startsWith('ollama/')) {
      modelId = `ollama/${modelId}`;
    }

    const selected: SelectedModel = {
      provider: skillAssistantModelProvider,
      model: modelId,
    };

    const trimmedBaseUrl = skillAssistantModelBaseUrl.trim();
    const providerConfig = modelProviders.find((entry) => entry.id === skillAssistantModelProvider);
    if (
      trimmedBaseUrl &&
      (skillAssistantModelProvider === 'ollama' || skillAssistantModelProvider === 'custom' || Boolean(providerConfig?.baseUrl))
    ) {
      selected.baseUrl = trimmedBaseUrl;
    }

    return selected;
  };

  const handleSkillAssistantModelProviderChange = (providerId: ProviderType) => {
    setSkillAssistantModelProvider(providerId);
    const currentModel = skillAssistantModelId.trim();
    if (providerId === 'ollama') {
      if (!currentModel || !currentModel.startsWith('ollama/')) {
        setSkillAssistantModelId(getFirstModelForProvider('ollama'));
      }
      if (!skillAssistantModelBaseUrl.trim()) {
        setSkillAssistantModelBaseUrl((selectedModel?.provider === 'ollama' ? selectedModel.baseUrl : '') || ollamaUrl || '');
      }
      return;
    }
    const providerConfig = modelProviders.find((entry) => entry.id === providerId);
    const available = providerConfig?.models ?? [];
    if (providerId === 'custom') {
      if (!currentModel) setSkillAssistantModelId('');
      return;
    }
    setSkillAssistantModelBaseUrl(providerConfig?.baseUrl || '');
    const hasCurrent = available.some((entry) => entry.fullId === currentModel);
    setSkillAssistantModelId(hasCurrent ? currentModel : getFirstModelForProvider(providerId));
  };

  const handleSaveSkillAssistantModel = async () => {
    const accomplish = getAccomplish();
    setSkillAssistantModelSaving(true);
    setSkillAssistantModelError(null);
    setSkillAssistantModelStatus(null);
    try {
      const nextModel = normalizeSkillAssistantSelectedModel();
      if (skillAssistantModelOverrideEnabled && !nextModel) {
        throw new Error('Select a model for Skill Assistant override.');
      }
      await accomplish.setUserSkillAssistantModel(skillAssistantModelOverrideEnabled ? nextModel : null);
      setSkillAssistantModelStatus(skillAssistantModelOverrideEnabled ? 'Skill Assistant model override saved.' : 'Skill Assistant now uses global model.');
    } catch (err) {
      console.error('Failed to save skill assistant model:', err);
      setSkillAssistantModelError(err instanceof Error ? err.message : 'Failed to save Skill Assistant model.');
    } finally {
      setSkillAssistantModelSaving(false);
    }
  };

  const parseIntegerSetting = (
    rawValue: string,
    fallback: number,
    min: number,
    max: number,
    fieldLabel: string
  ): number => {
    const normalized = rawValue.trim();
    if (!normalized) return fallback;
    const parsed = Number.parseInt(normalized, 10);
    if (!Number.isFinite(parsed)) {
      throw new Error(`${fieldLabel} must be a number.`);
    }
    if (parsed < min || parsed > max) {
      throw new Error(`${fieldLabel} must be between ${min} and ${max}.`);
    }
    return parsed;
  };

  const parseTimeOfDaySetting = (rawValue: string, fieldLabel: string, fallback: string): string => {
    const normalized = rawValue.trim() || fallback;
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(normalized)) {
      throw new Error(`${fieldLabel} must be in HH:MM format.`);
    }
    return normalized;
  };

  const parseTimeZoneSetting = (rawValue: string, fieldLabel: string, fallback: string): string => {
    const normalized = rawValue.trim() || fallback;
    if (normalized.toLowerCase() === 'system') {
      return AGENT_HEARTBEAT_DEFAULT_TIME_ZONE;
    }
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(new Date());
      return normalized;
    } catch {
      throw new Error(`${fieldLabel} must be "system" or a valid IANA timezone.`);
    }
  };

  const resetAgentForm = () => {
    setAgentFormId(null);
    setAgentName('');
    setAgentRoleName('');
    setAgentDescription('');
    setAgentAvatar(undefined);
    setAgentAvatarColor(undefined);
    setAgentWorkspaceRoot('');
    setAgentSystemPrompt('');
    setAgentModelOverrideEnabled(false);
    applyAgentModelForm(selectedModel ?? AGENT_FALLBACK_MODEL);
    setAgentLoopEnabled(false);
    setAgentLoopMaxIterations(String(AGENT_LOOP_DEFAULT_MAX_ITERATIONS));
    setAgentLoopTimeoutSeconds(String(AGENT_LOOP_DEFAULT_TIMEOUT_SECONDS));
    setAgentHeartbeatEnabled(false);
    setAgentHeartbeatScheduleMode('interval');
    setAgentHeartbeatIntervalMinutes(String(AGENT_HEARTBEAT_DEFAULT_INTERVAL_MINUTES));
    setAgentHeartbeatDailyTime(AGENT_HEARTBEAT_DEFAULT_DAILY_TIME);
    setAgentHeartbeatTimeZone(AGENT_HEARTBEAT_DEFAULT_TIME_ZONE);
    setAgentHeartbeatWindowEnabled(false);
    setAgentHeartbeatWindowStartTime(AGENT_HEARTBEAT_DEFAULT_WINDOW_START_TIME);
    setAgentHeartbeatWindowEndTime(AGENT_HEARTBEAT_DEFAULT_WINDOW_END_TIME);
    setAgentHeartbeatPrompt(AGENT_HEARTBEAT_DEFAULT_PROMPT);
    setAgentAutoSkillEnabled(false);
    setAgentAutoSkillAutoPromoteLowRisk(false);
    setAgentError(null);
    setAgentFormVersion((prev) => prev + 1);
  };

  const handleEditAgent = (agent: AgentProfile) => {
    setAgentFormId(agent.id);
    setAgentName(agent.name);
    setAgentRoleName(agent.roleName || '');
    setAgentDescription(agent.description || '');
    setAgentAvatar(agent.avatar);
    setAgentAvatarColor(agent.avatarColor);
    setAgentWorkspaceRoot(agent.workspaceRoot || '');
    setAgentSystemPrompt(agent.systemPromptAppend || '');
    setAgentModelOverrideEnabled(Boolean(agent.selectedModel));
    applyAgentModelForm(agent.selectedModel ?? selectedModel ?? AGENT_FALLBACK_MODEL);
    setAgentLoopEnabled(Boolean(agent.agenticLoopEnabled));
    setAgentLoopMaxIterations(String(agent.agenticLoopMaxIterations ?? AGENT_LOOP_DEFAULT_MAX_ITERATIONS));
    setAgentLoopTimeoutSeconds(String(Math.max(15, Math.round((agent.agenticLoopTimeoutMs ?? (AGENT_LOOP_DEFAULT_TIMEOUT_SECONDS * 1000)) / 1000))));
    setAgentHeartbeatEnabled(Boolean(agent.heartbeatEnabled));
    setAgentHeartbeatScheduleMode(agent.heartbeatScheduleMode === 'daily' ? 'daily' : 'interval');
    setAgentHeartbeatIntervalMinutes(String(
      agent.heartbeatIntervalMinutes
      ?? Math.max(1, Math.round((agent.heartbeatIntervalSeconds ?? (AGENT_HEARTBEAT_DEFAULT_INTERVAL_MINUTES * 60)) / 60))
    ));
    setAgentHeartbeatDailyTime(agent.heartbeatDailyTime || AGENT_HEARTBEAT_DEFAULT_DAILY_TIME);
    setAgentHeartbeatTimeZone(agent.heartbeatTimeZone || AGENT_HEARTBEAT_DEFAULT_TIME_ZONE);
    setAgentHeartbeatWindowEnabled(Boolean(agent.heartbeatWindowEnabled));
    setAgentHeartbeatWindowStartTime(agent.heartbeatWindowStartTime || AGENT_HEARTBEAT_DEFAULT_WINDOW_START_TIME);
    setAgentHeartbeatWindowEndTime(agent.heartbeatWindowEndTime || AGENT_HEARTBEAT_DEFAULT_WINDOW_END_TIME);
    setAgentHeartbeatPrompt(agent.heartbeatPrompt || AGENT_HEARTBEAT_DEFAULT_PROMPT);
    setAgentAutoSkillEnabled(Boolean(agent.autoSkillEnabled));
    setAgentAutoSkillAutoPromoteLowRisk(Boolean(agent.autoSkillAutoPromoteLowRisk));
    setAgentError(null);
    setAgentFormVersion((prev) => prev + 1);
  };

  const handleSelectAgentWorkspace = async () => {
    const accomplish = getAccomplish();
    try {
      const folder = await accomplish.selectFolder();
      if (folder) {
        setAgentWorkspaceRoot(folder);
        if (agentWorkspaceInputRef.current) {
          agentWorkspaceInputRef.current.value = folder;
        }
      }
    } catch (err) {
      console.error('Failed to select agent workspace:', err);
    }
  };

  const handleSaveAgent = async () => {
    const trimmedName = (agentNameInputRef.current?.value ?? agentName).trim();
    if (!trimmedName) {
      setAgentError('Agent name is required.');
      return;
    }
    setAgentName(trimmedName);
    const roleNameValue = (agentRoleNameInputRef.current?.value ?? agentRoleName).trim();
    const descriptionValue = (agentDescriptionInputRef.current?.value ?? agentDescription).trim();
    const workspaceValue = (agentWorkspaceInputRef.current?.value ?? agentWorkspaceRoot).trim();
    const systemPromptValue = (agentSystemPromptInputRef.current?.value ?? agentSystemPrompt).trim();
    let loopMaxIterationsValue = AGENT_LOOP_DEFAULT_MAX_ITERATIONS;
    let loopTimeoutSecondsValue = AGENT_LOOP_DEFAULT_TIMEOUT_SECONDS;
    let heartbeatIntervalMinutesValue = AGENT_HEARTBEAT_DEFAULT_INTERVAL_MINUTES;
    let heartbeatDailyTimeValue = AGENT_HEARTBEAT_DEFAULT_DAILY_TIME;
    let heartbeatTimeZoneValue = AGENT_HEARTBEAT_DEFAULT_TIME_ZONE;
    let heartbeatWindowStartValue = AGENT_HEARTBEAT_DEFAULT_WINDOW_START_TIME;
    let heartbeatWindowEndValue = AGENT_HEARTBEAT_DEFAULT_WINDOW_END_TIME;
    try {
      loopMaxIterationsValue = parseIntegerSetting(
        agentLoopMaxIterationsInputRef.current?.value ?? agentLoopMaxIterations,
        AGENT_LOOP_DEFAULT_MAX_ITERATIONS,
        1,
        20,
        'Loop max iterations'
      );
      loopTimeoutSecondsValue = parseIntegerSetting(
        agentLoopTimeoutInputRef.current?.value ?? agentLoopTimeoutSeconds,
        AGENT_LOOP_DEFAULT_TIMEOUT_SECONDS,
        15,
        3600,
        'Loop timeout (seconds)'
      );
      heartbeatIntervalMinutesValue = parseIntegerSetting(
        agentHeartbeatIntervalInputRef.current?.value ?? agentHeartbeatIntervalMinutes,
        AGENT_HEARTBEAT_DEFAULT_INTERVAL_MINUTES,
        1,
        1_440,
        'Heartbeat interval (minutes)'
      );
      heartbeatDailyTimeValue = parseTimeOfDaySetting(
        agentHeartbeatDailyTimeInputRef.current?.value ?? agentHeartbeatDailyTime,
        'Heartbeat daily time',
        AGENT_HEARTBEAT_DEFAULT_DAILY_TIME
      );
      heartbeatTimeZoneValue = parseTimeZoneSetting(
        agentHeartbeatTimeZoneInputRef.current?.value ?? agentHeartbeatTimeZone,
        'Heartbeat time zone',
        AGENT_HEARTBEAT_DEFAULT_TIME_ZONE
      );
      heartbeatWindowStartValue = parseTimeOfDaySetting(
        agentHeartbeatWindowStartInputRef.current?.value ?? agentHeartbeatWindowStartTime,
        'Heartbeat window start',
        AGENT_HEARTBEAT_DEFAULT_WINDOW_START_TIME
      );
      heartbeatWindowEndValue = parseTimeOfDaySetting(
        agentHeartbeatWindowEndInputRef.current?.value ?? agentHeartbeatWindowEndTime,
        'Heartbeat window end',
        AGENT_HEARTBEAT_DEFAULT_WINDOW_END_TIME
      );
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : 'Invalid numeric agent settings.');
      return;
    }
    const heartbeatPromptValue = (agentHeartbeatPromptInputRef.current?.value ?? agentHeartbeatPrompt).trim();
    setAgentRoleName(roleNameValue);
    setAgentDescription(descriptionValue);
    setAgentWorkspaceRoot(workspaceValue);
    setAgentSystemPrompt(systemPromptValue);
    setAgentLoopMaxIterations(String(loopMaxIterationsValue));
    setAgentLoopTimeoutSeconds(String(loopTimeoutSecondsValue));
    setAgentHeartbeatIntervalMinutes(String(heartbeatIntervalMinutesValue));
    setAgentHeartbeatDailyTime(heartbeatDailyTimeValue);
    setAgentHeartbeatTimeZone(heartbeatTimeZoneValue);
    setAgentHeartbeatWindowStartTime(heartbeatWindowStartValue);
    setAgentHeartbeatWindowEndTime(heartbeatWindowEndValue);
    setAgentHeartbeatPrompt(heartbeatPromptValue || AGENT_HEARTBEAT_DEFAULT_PROMPT);
    const heartbeatEnabledForSave = agentLoopEnabled ? agentHeartbeatEnabled : false;
    if (!agentLoopEnabled && agentHeartbeatEnabled) {
      setAgentHeartbeatEnabled(false);
    }
    const selectedModelOverride = normalizeAgentSelectedModel();
    if (agentModelOverrideEnabled && !selectedModelOverride) {
      setAgentError('Model is required when agent override is enabled.');
      return;
    }
    setAgentSaving(true);
    setAgentError(null);
    try {
      await upsertAgent({
        id: agentFormId || undefined,
        name: trimmedName,
        roleName: roleNameValue || undefined,
        description: descriptionValue || undefined,
        avatar: agentAvatar || undefined,
        avatarColor: agentAvatarColor || undefined,
        workspaceRoot: workspaceValue || undefined,
        systemPromptAppend: systemPromptValue || undefined,
        selectedModel: selectedModelOverride,
        agenticLoopEnabled: agentLoopEnabled,
        agenticLoopMaxIterations: loopMaxIterationsValue,
        agenticLoopTimeoutMs: loopTimeoutSecondsValue * 1000,
        heartbeatEnabled: heartbeatEnabledForSave,
        heartbeatScheduleMode: agentHeartbeatScheduleMode,
        heartbeatIntervalMinutes: heartbeatIntervalMinutesValue,
        heartbeatIntervalSeconds: heartbeatIntervalMinutesValue * 60,
        heartbeatDailyTime: heartbeatDailyTimeValue,
        heartbeatTimeZone: heartbeatTimeZoneValue,
        heartbeatWindowEnabled: agentHeartbeatWindowEnabled,
        heartbeatWindowStartTime: heartbeatWindowStartValue,
        heartbeatWindowEndTime: heartbeatWindowEndValue,
        heartbeatPrompt: (heartbeatPromptValue || AGENT_HEARTBEAT_DEFAULT_PROMPT),
        autoSkillEnabled: agentAutoSkillEnabled,
        autoSkillAutoPromoteLowRisk: agentAutoSkillEnabled ? agentAutoSkillAutoPromoteLowRisk : false,
      });
      resetAgentForm();
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : 'Unable to save agent.');
    } finally {
      setAgentSaving(false);
    }
  };

  const handleDeleteAgent = async (agentId: string) => {
    setAgentError(null);
    try {
      await deleteAgent(agentId);
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : 'Unable to delete agent.');
    }
  };

  const handleSetActiveAgent = async (agentId: string) => {
    setAgentError(null);
    try {
      await setActiveAgent(agentId);
      await refreshSchedules();
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : 'Unable to set active agent.');
    }
  };

  const handleSetDefaultAgent = async (agentId: string) => {
    setAgentError(null);
    try {
      await setDefaultAgent(agentId);
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : 'Unable to set default agent.');
    }
  };

  const refreshSchedules = async () => {
    const accomplish = getAccomplish();
    setLoadingSchedules(true);
    try {
      const scheduleList = await accomplish.listSchedules();
      setSchedules(Array.isArray(scheduleList) ? (scheduleList as ScheduledTask[]) : []);
      setScheduleError(null);
    } catch (err) {
      console.error('Failed to load schedules:', err);
      setScheduleError('Unable to load schedules.');
    } finally {
      setLoadingSchedules(false);
    }
  };

  const handleCreateSchedule = async () => {
    const accomplish = getAccomplish();
    if (!schedulePrompt.trim()) {
      setScheduleError('Schedule prompt is required.');
      return;
    }
    if (!scheduleCron.trim()) {
      setScheduleError('Cron expression is required.');
      return;
    }
    setSavingSchedule(true);
    setScheduleError(null);
    const payload: ScheduleConfig = {
      name: scheduleName.trim() || 'Scheduled task',
      prompt: schedulePrompt.trim(),
      cron: scheduleCron.trim(),
      timezone: scheduleTimezone.trim() || undefined,
      workingDirectory: scheduleWorkingDirectory.trim() || undefined,
      agentId: activeAgentId || undefined,
      reuseSession: scheduleReuseSession,
      sessionId: scheduleSessionId.trim() || undefined,
      enabled: true,
    };
    try {
      await accomplish.upsertSchedule(payload);
      setScheduleName('');
      setSchedulePrompt('');
      setScheduleWorkingDirectory('');
      setScheduleReuseSession(false);
      setScheduleSessionId('');
      await refreshSchedules();
    } catch (err) {
      console.error('Failed to create schedule:', err);
      setScheduleError('Unable to save schedule.');
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleSelectScheduleFolder = async () => {
    const accomplish = getAccomplish();
    try {
      const folder = await accomplish.selectFolder();
      if (folder) {
        setScheduleWorkingDirectory(folder);
      }
    } catch (err) {
      console.error('Failed to select schedule folder:', err);
    }
  };

  const handleToggleSchedule = async (scheduleId: string, enabled: boolean) => {
    const accomplish = getAccomplish();
    try {
      await accomplish.toggleSchedule(scheduleId, enabled);
      await refreshSchedules();
    } catch (err) {
      console.error('Failed to toggle schedule:', err);
      setScheduleError('Unable to update schedule.');
    }
  };

  const handleDeleteSchedule = async (scheduleId: string) => {
    const accomplish = getAccomplish();
    try {
      await accomplish.deleteSchedule(scheduleId);
      await refreshSchedules();
    } catch (err) {
      console.error('Failed to delete schedule:', err);
      setScheduleError('Unable to delete schedule.');
    }
  };

  const handleRunScheduleNow = async (scheduleId: string) => {
    const accomplish = getAccomplish();
    try {
      await accomplish.runScheduleNow(scheduleId);
    } catch (err) {
      console.error('Failed to run schedule:', err);
      setScheduleError('Unable to run schedule.');
    }
  };

  const refreshDiscordStatus = async () => {
    const accomplish = getAccomplish();
    try {
      const info = await accomplish.getDiscordConfig();
      setDiscordStatus(info.status || null);
      setDiscordTokenSet(Boolean(info.tokenSet));
    } catch (err) {
      console.error('Failed to refresh Discord status:', err);
    }
  };

  const refreshDiscordPairing = async () => {
    const accomplish = getAccomplish();
    setDiscordPairingLoading(true);
    try {
      const pending = await accomplish.listDiscordPairingRequests();
      setDiscordPairingRequests(pending || []);
    } catch (err) {
      console.error('Failed to refresh Discord pairing requests:', err);
    } finally {
      setDiscordPairingLoading(false);
    }
  };

  const handleCopyDiscordPairingCode = async (code: string, userId: string, suffix?: string) => {
    try {
      await navigator.clipboard.writeText(code);
      const key = suffix ? `${userId}-${suffix}` : userId;
      setDiscordPairingCopied(key);
      setTimeout(() => setDiscordPairingCopied(null), 1500);
    } catch (err) {
      console.warn('Failed to copy pairing code:', err);
    }
  };

  const handleApproveDiscordPairing = async (userId: string, code: string) => {
    const accomplish = getAccomplish();
    setDiscordPairingApproving(userId);
    setDiscordError(null);
    try {
      const result = await accomplish.approveDiscordPairing(userId, code);
      if (result?.approved) {
        setDiscordDmAllowlist((prev) => {
          const entries = parseAllowlist(prev);
          if (!entries.includes(userId)) {
            entries.push(userId);
          }
          return entries.join(', ');
        });
        await refreshDiscordPairing();
      } else {
        setDiscordError('Pairing code did not match or expired.');
      }
    } catch (err) {
      setDiscordError(err instanceof Error ? err.message : 'Unable to approve pairing request.');
    } finally {
      setDiscordPairingApproving(null);
    }
  };

  const handleSaveDiscordConfig = async () => {
    const accomplish = getAccomplish();
    setDiscordSaving(true);
    setDiscordError(null);
    try {
      const commandPrefixInput = discordCommandPrefixRef.current?.value ?? discordCommandPrefix;
      const channelAllowlistInput = discordChannelAllowlistRef.current?.value ?? discordChannelAllowlist;
      const guildAllowlistInput = discordGuildAllowlistRef.current?.value ?? discordGuildAllowlist;
      const dmAllowlistInput = discordDmAllowlistRef.current?.value ?? discordDmAllowlist;
      const commandPrefix = commandPrefixInput.trim();
      const payload: DiscordConnectorConfig = {
        enabled: discordEnabled,
        allowDms: discordDmPolicy !== 'disabled',
        dmPolicy: discordDmPolicy,
        requireMention: discordRequireMention,
        commandPrefix: commandPrefix || undefined,
        channelAllowlist: parseAllowlist(channelAllowlistInput),
        guildAllowlist: parseAllowlist(guildAllowlistInput),
        dmAllowlist: parseAllowlist(dmAllowlistInput),
        agentId: discordAgentId || undefined,
      };
      await accomplish.setDiscordConfig(payload);
      setDiscordCommandPrefix(commandPrefixInput);
      setDiscordChannelAllowlist(channelAllowlistInput);
      setDiscordGuildAllowlist(guildAllowlistInput);
      setDiscordDmAllowlist(dmAllowlistInput);
      await refreshDiscordStatus();
      await refreshGatewayConnectorExtensions();
    } catch (err) {
      setDiscordError(err instanceof Error ? err.message : 'Unable to save Discord config.');
    } finally {
      setDiscordSaving(false);
    }
  };

  const handleSaveDiscordToken = async () => {
    const accomplish = getAccomplish();
    const tokenInput = discordTokenInputRef.current?.value ?? discordTokenInput;
    const token = tokenInput.trim();
    if (!token) {
      setDiscordError('Discord bot token is required.');
      return;
    }
    setDiscordTokenSaving(true);
    setDiscordError(null);
    try {
      await accomplish.setDiscordToken(token);
      setDiscordTokenInput('');
      if (discordTokenInputRef.current) {
        discordTokenInputRef.current.value = '';
      }
      await refreshDiscordStatus();
      await refreshGatewayConnectorExtensions();
    } catch (err) {
      setDiscordError(err instanceof Error ? err.message : 'Unable to save Discord token.');
    } finally {
      setDiscordTokenSaving(false);
    }
  };

  const handleClearDiscordToken = async () => {
    const accomplish = getAccomplish();
    setDiscordTokenSaving(true);
    setDiscordError(null);
    try {
      await accomplish.clearDiscordToken();
      setDiscordTokenInput('');
      if (discordTokenInputRef.current) {
        discordTokenInputRef.current.value = '';
      }
      await refreshDiscordStatus();
      await refreshGatewayConnectorExtensions();
    } catch (err) {
      setDiscordError(err instanceof Error ? err.message : 'Unable to clear Discord token.');
    } finally {
      setDiscordTokenSaving(false);
    }
  };

  const refreshTelegramStatus = async () => {
    const accomplish = getAccomplish();
    try {
      const info = await accomplish.getTelegramConfig();
      setTelegramStatus(info.status || null);
      setTelegramTokenSet(Boolean(info.tokenSet));
    } catch (err) {
      console.error('Failed to refresh Telegram status:', err);
    }
  };

  const refreshTelegramPairing = async () => {
    const accomplish = getAccomplish();
    setTelegramPairingLoading(true);
    try {
      const pending = await accomplish.listTelegramPairingRequests();
      setTelegramPairingRequests(pending || []);
    } catch (err) {
      console.error('Failed to refresh Telegram pairing requests:', err);
    } finally {
      setTelegramPairingLoading(false);
    }
  };

  const handleCopyTelegramPairingCode = async (code: string, userId: string, suffix?: string) => {
    try {
      await navigator.clipboard.writeText(code);
      const key = suffix ? `${userId}-${suffix}` : userId;
      setTelegramPairingCopied(key);
      setTimeout(() => setTelegramPairingCopied(null), 1500);
    } catch (err) {
      console.warn('Failed to copy pairing code:', err);
    }
  };

  const handleApproveTelegramPairing = async (userId: string, code: string) => {
    const accomplish = getAccomplish();
    setTelegramPairingApproving(userId);
    setTelegramError(null);
    try {
      const result = await accomplish.approveTelegramPairing(userId, code);
      if (result?.approved) {
        const previous = telegramDmAllowlistRef.current?.value ?? telegramDmAllowlist;
        const entries = parseAllowlist(previous);
        if (!entries.includes(userId)) {
          entries.push(userId);
        }
        const nextAllowlist = entries.join(', ');
        setTelegramDmAllowlist(nextAllowlist);
        if (telegramDmAllowlistRef.current) {
          telegramDmAllowlistRef.current.value = nextAllowlist;
        }
        await refreshTelegramPairing();
      } else {
        setTelegramError('Pairing code did not match or expired.');
      }
    } catch (err) {
      setTelegramError(err instanceof Error ? err.message : 'Unable to approve pairing request.');
    } finally {
      setTelegramPairingApproving(null);
    }
  };

  const handleSaveTelegramConfig = async () => {
    const accomplish = getAccomplish();
    setTelegramSaving(true);
    setTelegramError(null);
    try {
      const commandPrefixInput = telegramCommandPrefixRef.current?.value ?? telegramCommandPrefix;
      const channelAllowlistInput = telegramChannelAllowlistRef.current?.value ?? telegramChannelAllowlist;
      const groupAllowlistInput = telegramGroupAllowlistRef.current?.value ?? telegramGroupAllowlist;
      const dmAllowlistInput = telegramDmAllowlistRef.current?.value ?? telegramDmAllowlist;
      const payload: TelegramConnectorConfig = {
        enabled: telegramEnabled,
        allowDms: telegramDmPolicy !== 'disabled',
        dmPolicy: telegramDmPolicy,
        requireMention: telegramRequireMention,
        commandPrefix: commandPrefixInput.trim() || undefined,
        channelAllowlist: parseAllowlist(channelAllowlistInput),
        groupAllowlist: parseAllowlist(groupAllowlistInput),
        dmAllowlist: parseAllowlist(dmAllowlistInput),
        agentId: telegramAgentId || undefined,
      };
      await accomplish.setTelegramConfig(payload);
      setTelegramCommandPrefix(commandPrefixInput);
      setTelegramChannelAllowlist(channelAllowlistInput);
      setTelegramGroupAllowlist(groupAllowlistInput);
      setTelegramDmAllowlist(dmAllowlistInput);
      await refreshTelegramStatus();
      await refreshGatewayConnectorExtensions();
    } catch (err) {
      setTelegramError(err instanceof Error ? err.message : 'Unable to save Telegram config.');
    } finally {
      setTelegramSaving(false);
    }
  };

  const handleSaveTelegramAccessPolicy = async () => {
    const accomplish = getAccomplish();
    setTelegramSaving(true);
    setTelegramError(null);
    try {
      const commandPrefixInput = telegramCommandPrefixRef.current?.value ?? telegramCommandPrefix;
      const channelAllowlistInput = telegramChannelAllowlistRef.current?.value ?? telegramChannelAllowlist;
      const groupAllowlistInput = telegramGroupAllowlistRef.current?.value ?? telegramGroupAllowlist;
      const dmAllowlistInput = telegramDmAllowlistRef.current?.value ?? telegramDmAllowlist;
      const payload: TelegramConnectorConfig = {
        enabled: gatewayConnectorEnabled,
        allowDms: telegramDmPolicy !== 'disabled',
        dmPolicy: telegramDmPolicy,
        requireMention: telegramRequireMention,
        commandPrefix: commandPrefixInput.trim() || undefined,
        channelAllowlist: parseAllowlist(channelAllowlistInput),
        groupAllowlist: parseAllowlist(groupAllowlistInput),
        dmAllowlist: parseAllowlist(dmAllowlistInput),
        agentId: gatewayConnectorAgentId.trim() || telegramAgentId || undefined,
      };
      await accomplish.setTelegramConfig(payload);
      setTelegramEnabled(payload.enabled);
      setTelegramAgentId(payload.agentId || '');
      setTelegramChannelAllowlist(channelAllowlistInput);
      setTelegramGroupAllowlist(groupAllowlistInput);
      setTelegramDmAllowlist(dmAllowlistInput);
      setGatewayConnectorEnabled(payload.enabled);
      await Promise.all([
        refreshTelegramStatus(),
        refreshGatewayConnectorExtensions(),
        refreshGatewayBindings(),
      ]);
    } catch (err) {
      setTelegramError(err instanceof Error ? err.message : 'Unable to save Telegram access policy.');
    } finally {
      setTelegramSaving(false);
    }
  };

  const handleSaveTelegramToken = async () => {
    const accomplish = getAccomplish();
    const tokenInput = telegramTokenInputRef.current?.value ?? telegramTokenInput;
    const token = tokenInput.trim();
    if (!token) {
      setTelegramError('Telegram bot token is required.');
      return;
    }
    setTelegramTokenSaving(true);
    setTelegramError(null);
    try {
      await accomplish.setTelegramToken(token);
      setTelegramTokenInput('');
      if (telegramTokenInputRef.current) {
        telegramTokenInputRef.current.value = '';
      }
      await refreshTelegramStatus();
      await refreshGatewayConnectorExtensions();
    } catch (err) {
      setTelegramError(err instanceof Error ? err.message : 'Unable to save Telegram token.');
    } finally {
      setTelegramTokenSaving(false);
    }
  };

  const handleClearTelegramToken = async () => {
    const accomplish = getAccomplish();
    setTelegramTokenSaving(true);
    setTelegramError(null);
    try {
      await accomplish.clearTelegramToken();
      setTelegramTokenInput('');
      if (telegramTokenInputRef.current) {
        telegramTokenInputRef.current.value = '';
      }
      await refreshTelegramStatus();
      await refreshGatewayConnectorExtensions();
    } catch (err) {
      setTelegramError(err instanceof Error ? err.message : 'Unable to clear Telegram token.');
    } finally {
      setTelegramTokenSaving(false);
    }
  };

  const refreshVoiceWake = async () => {
    const accomplish = getAccomplish();
    try {
      const [config, keyStatus] = await Promise.all([
        accomplish.getVoiceWakeConfig(),
        accomplish.getVoiceWakeAccessKeyStatus(),
      ]);
      setVoiceWakeConfigState(config as VoiceWakeConfig);
      setVoiceWakeEnabled(Boolean(config.enabled));
      setVoiceWakeAutoStart(Boolean(config.autoStart));
      setVoiceWakeTriggers(formatAllowlist(config.triggers));
      setVoiceWakeTalkModeEnabled(config.talkModeEnabled !== false);
      setVoiceWakeAutoSubmit(Boolean(config.autoSubmit));
      setVoiceWakeInsertMode(config.insertMode === 'replace' ? 'replace' : 'append');
      setVoiceWakeStopPhrases(formatAllowlist(config.stopPhrases));
      setVoiceWakeSilenceMs(String(config.silenceTimeoutMs ?? 900));
      setVoiceWakeEarconEnabled(config.earconEnabled !== false);
      setVoiceWakeSttEngine(config.sttEngine === 'web-speech' ? 'web-speech' : 'whisper');
      setVoiceWakeWhisperBinPath(config.whisperBinPath ?? '');
      setVoiceWakeWhisperModelPath(config.whisperModelPath ?? '');
      setVoiceWakeWhisperLanguage(config.whisperLanguage ?? 'en');
      setVoiceWakeAccessKeySet(Boolean((keyStatus as { accessKeySet?: boolean })?.accessKeySet));
      setVoiceWakeFormVersion((prev) => prev + 1);
    } catch (err) {
      console.error('Failed to refresh voice wake config:', err);
    }
  };

  const handleSaveVoiceWake = async () => {
    const accomplish = getAccomplish();
    setVoiceWakeSaving(true);
    setVoiceWakeError(null);
    try {
      const triggersInput = voiceWakeTriggersRef.current?.value ?? voiceWakeTriggers;
      const stopPhrasesInput = voiceWakeStopPhrasesRef.current?.value ?? voiceWakeStopPhrases;
      const silenceMsInput = voiceWakeSilenceMsRef.current?.value ?? voiceWakeSilenceMs;
      const whisperBinPathInput = voiceWakeWhisperBinPathRef.current?.value ?? voiceWakeWhisperBinPath;
      const whisperModelPathInput = voiceWakeWhisperModelPathRef.current?.value ?? voiceWakeWhisperModelPath;
      const whisperLanguageInput = voiceWakeWhisperLanguageRef.current?.value ?? voiceWakeWhisperLanguage;
      setVoiceWakeTriggers(triggersInput);
      setVoiceWakeStopPhrases(stopPhrasesInput);
      setVoiceWakeSilenceMs(silenceMsInput);
      setVoiceWakeWhisperBinPath(whisperBinPathInput);
      setVoiceWakeWhisperModelPath(whisperModelPathInput);
      setVoiceWakeWhisperLanguage(whisperLanguageInput);
      const parsedSilenceMs = Number.parseInt(silenceMsInput, 10);
      const payload: VoiceWakeConfig = {
        enabled: voiceWakeEnabled,
        autoStart: voiceWakeAutoStart,
        triggers: parseAllowlist(triggersInput),
        updatedAtMs: voiceWakeConfig?.updatedAtMs ?? 0,
        talkModeEnabled: voiceWakeTalkModeEnabled,
        autoSubmit: voiceWakeAutoSubmit,
        insertMode: voiceWakeInsertMode,
        stopPhrases: parseAllowlist(stopPhrasesInput),
        silenceTimeoutMs: Number.isFinite(parsedSilenceMs) ? parsedSilenceMs : undefined,
        earconEnabled: voiceWakeEarconEnabled,
        sttEngine: voiceWakeSttEngine,
        whisperBinPath: whisperBinPathInput.trim(),
        whisperModelPath: whisperModelPathInput.trim(),
        whisperLanguage: whisperLanguageInput.trim() || 'en',
      };
      const saved = await accomplish.setVoiceWakeConfig(payload);
      setVoiceWakeConfigState(saved as VoiceWakeConfig);
      setVoiceWakeEnabled(Boolean(saved.enabled));
      setVoiceWakeAutoStart(Boolean(saved.autoStart));
      setVoiceWakeTriggers(formatAllowlist(saved.triggers));
      setVoiceWakeTalkModeEnabled(saved.talkModeEnabled !== false);
      setVoiceWakeAutoSubmit(Boolean(saved.autoSubmit));
      setVoiceWakeInsertMode(saved.insertMode === 'replace' ? 'replace' : 'append');
      setVoiceWakeStopPhrases(formatAllowlist(saved.stopPhrases));
      setVoiceWakeSilenceMs(String(saved.silenceTimeoutMs ?? 900));
      setVoiceWakeEarconEnabled(saved.earconEnabled !== false);
      setVoiceWakeSttEngine(saved.sttEngine === 'web-speech' ? 'web-speech' : 'whisper');
      setVoiceWakeWhisperBinPath(saved.whisperBinPath ?? '');
      setVoiceWakeWhisperModelPath(saved.whisperModelPath ?? '');
      setVoiceWakeWhisperLanguage(saved.whisperLanguage ?? 'en');
      setVoiceWakeFormVersion((prev) => prev + 1);
    } catch (err) {
      setVoiceWakeError(err instanceof Error ? err.message : 'Unable to save voice wake settings.');
    } finally {
      setVoiceWakeSaving(false);
    }
  };

  const handleSaveVoiceWakeAccessKey = async () => {
    const accomplish = getAccomplish();
    const accessKeyInput = voiceWakeAccessKeyInputRef.current?.value ?? voiceWakeAccessKeyInput;
    const key = accessKeyInput.trim();
    if (!key) {
      setVoiceWakeError('Access key is required.');
      return;
    }
    setVoiceWakeAccessKeySaving(true);
    setVoiceWakeError(null);
    try {
      await accomplish.setVoiceWakeAccessKey(key);
      setVoiceWakeAccessKeyInput('');
      if (voiceWakeAccessKeyInputRef.current) {
        voiceWakeAccessKeyInputRef.current.value = '';
      }
      setVoiceWakeAccessKeySet(true);
    } catch (err) {
      setVoiceWakeError(err instanceof Error ? err.message : 'Unable to save access key.');
    } finally {
      setVoiceWakeAccessKeySaving(false);
    }
  };

  const handleClearVoiceWakeAccessKey = async () => {
    const accomplish = getAccomplish();
    setVoiceWakeAccessKeySaving(true);
    setVoiceWakeError(null);
    try {
      await accomplish.clearVoiceWakeAccessKey();
      setVoiceWakeAccessKeyInput('');
      if (voiceWakeAccessKeyInputRef.current) {
        voiceWakeAccessKeyInputRef.current.value = '';
      }
      setVoiceWakeAccessKeySet(false);
    } catch (err) {
      setVoiceWakeError(err instanceof Error ? err.message : 'Unable to clear access key.');
    } finally {
      setVoiceWakeAccessKeySaving(false);
    }
  };

  const refreshNodePairing = async () => {
    const accomplish = getAccomplish();
    if (!mobileNodesEnabled) {
      setNodePairing({ pending: [], paired: [] });
      setNodePairingError(null);
      return;
    }
    setNodePairingLoading(true);
    setNodePairingError(null);
    try {
      const list = await accomplish.listNodePairing();
      setNodePairing(list as NodePairingList);
    } catch (err) {
      setNodePairingError(err instanceof Error ? err.message : 'Unable to load node pairing requests.');
    } finally {
      setNodePairingLoading(false);
    }
  };

  const handleCopyNodePairingValue = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNodePairingCopied(key);
      setTimeout(() => setNodePairingCopied(null), 1500);
    } catch (err) {
      console.warn('Failed to copy node value:', err);
    }
  };

  const handleApproveNodePairing = async (requestId: string) => {
    const accomplish = getAccomplish();
    setNodePairingApproving(requestId);
    setNodePairingError(null);
    try {
      const result = await accomplish.approveNodePairing(requestId);
      if (!result?.node) {
        setNodePairingError('Unable to approve pairing request.');
      }
      await refreshNodePairing();
    } catch (err) {
      setNodePairingError(err instanceof Error ? err.message : 'Unable to approve pairing request.');
    } finally {
      setNodePairingApproving(null);
    }
  };

  const handleRejectNodePairing = async (requestId: string) => {
    const accomplish = getAccomplish();
    setNodePairingRejecting(requestId);
    setNodePairingError(null);
    try {
      await accomplish.rejectNodePairing(requestId);
      await refreshNodePairing();
    } catch (err) {
      setNodePairingError(err instanceof Error ? err.message : 'Unable to reject pairing request.');
    } finally {
      setNodePairingRejecting(null);
    }
  };

  const requestSnapshotInternal = async (
    nodeId: string,
    options: { silent?: boolean; target?: 'snapshot' | 'live' } = {}
  ) => {
    const accomplish = getAccomplish();
    const silent = Boolean(options.silent);
    const target = options.target ?? 'snapshot';
    if (!silent) {
      setNodeSnapshotLoading(nodeId);
      setNodePairingError(null);
    }
    try {
      const result = await accomplish.requestNodeCameraSnapshot(nodeId, target);
      if (!result?.ok) {
        if (!silent) {
          const errorText = result?.error ? String(result.error) : 'Unable to fetch snapshot.';
          setNodePairingError(errorText);
        }
        if (target === 'live') {
          const current = livePreviewFailureCountsRef.current[nodeId] ?? 0;
          const next = current + 1;
          livePreviewFailureCountsRef.current[nodeId] = next;
          if (next >= 3) {
            stopLivePreview(nodeId);
            setNodePairingError('Camera stopped on companion. Live preview paused.');
          }
        }
        return;
      }
      const payload = result?.payload as { mime?: string; dataBase64?: string } | undefined;
      if (!payload?.mime || !payload?.dataBase64) {
        if (!silent) {
          setNodePairingError('Snapshot payload was missing image data.');
        }
        if (target === 'live') {
          const current = livePreviewFailureCountsRef.current[nodeId] ?? 0;
          const next = current + 1;
          livePreviewFailureCountsRef.current[nodeId] = next;
          if (next >= 3) {
            stopLivePreview(nodeId);
            setNodePairingError('Camera stopped on companion. Live preview paused.');
          }
        }
        return;
      }
      const dataUrl = `data:${payload.mime};base64,${payload.dataBase64}`;
      if (target === 'live') {
        livePreviewFailureCountsRef.current[nodeId] = 0;
        setNodeLiveFrames((prev) => ({ ...prev, [nodeId]: dataUrl }));
      } else {
        setNodeSnapshots((prev) => ({ ...prev, [nodeId]: dataUrl }));
      }
    } catch (err) {
      if (!silent) {
        setNodePairingError(err instanceof Error ? err.message : 'Unable to fetch snapshot.');
      }
    } finally {
      if (!silent) {
        setNodeSnapshotLoading(null);
      }
    }
  };

  const handleRequestNodeSnapshot = async (nodeId: string) => {
    await requestSnapshotInternal(nodeId, { target: 'snapshot' });
  };

  const startLivePreview = async (nodeId: string) => {
    if (!mobileNodesEnabled) return;
    if (livePreviewNodes.size >= mobileNodesMaxLivePreviews && !livePreviewNodes.has(nodeId)) {
      setNodePairingError(`Max is ${mobileNodesMaxLivePreviews} live previews. Increase the limit in settings.`);
      return;
    }
    if (livePreviewTimersRef.current.has(nodeId)) return;
    setLivePreviewNodes((prev) => {
      const next = new Set(prev);
      next.add(nodeId);
      return next;
    });
    livePreviewFailureCountsRef.current[nodeId] = 0;
    await requestSnapshotInternal(nodeId, { target: 'live' });
    const timer = setInterval(() => {
      void requestSnapshotInternal(nodeId, { silent: true, target: 'live' });
    }, 2000);
    livePreviewTimersRef.current.set(nodeId, timer);
  };

  const stopLivePreview = (nodeId: string) => {
    const timer = livePreviewTimersRef.current.get(nodeId);
    if (timer) {
      clearInterval(timer);
      livePreviewTimersRef.current.delete(nodeId);
    }
    delete livePreviewFailureCountsRef.current[nodeId];
    setLivePreviewNodes((prev) => {
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });
  };

  const buildBufferedUrl = (nodeId: string, kind: 'mic' | 'screen') => {
    const buffersRef = kind === 'mic' ? nodeMicBuffersRef : nodeScreenBuffersRef;
    const urlStateSetter = kind === 'mic' ? setNodeMicBufferUrls : setNodeScreenBufferUrls;
    const buffer = buffersRef.current[nodeId] ?? [];
    if (buffer.length === 0) return;
    const chunks = buffer.map((entry) => Uint8Array.from(atob(entry.dataBase64), (c) => c.charCodeAt(0)));
    const mime = buffer[buffer.length - 1]?.mime || (kind === 'mic' ? 'audio/webm' : 'video/webm');
    const blob = new Blob(chunks, { type: mime });
    const nextUrl = URL.createObjectURL(blob);
    urlStateSetter((prev) => {
      const current = prev[nodeId];
      if (current) {
        URL.revokeObjectURL(current);
      }
      return { ...prev, [nodeId]: nextUrl };
    });
  };

  const resetScreenMedia = (nodeId: string) => {
    const existing = nodeScreenMediaRef.current[nodeId];
    if (existing) {
      try {
        if (existing.mediaSource.readyState === 'open') {
          existing.mediaSource.endOfStream();
        }
      } catch {
        // ignore
      }
    }
    setNodeScreenStreamUrls((prev) => {
      const current = prev[nodeId];
      if (current) {
        URL.revokeObjectURL(current);
      }
      const next = { ...prev };
      delete next[nodeId];
      return next;
    });
    delete nodeScreenMediaRef.current[nodeId];
    delete nodeScreenLastReceivedRef.current[nodeId];
  };

  const ensureScreenMedia = (nodeId: string, mime: string) => {
    const existing = nodeScreenMediaRef.current[nodeId];
    if (existing && existing.mime === mime) return existing;
    if (existing) resetScreenMedia(nodeId);
    if (typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported(mime)) {
      return null;
    }
    const mediaSource = new MediaSource();
    const entry: (typeof nodeScreenMediaRef.current)[string] = {
      mediaSource,
      sourceBuffer: null,
      queue: [] as Uint8Array[],
      mime,
      lastPrunedAt: 0,
      prunePending: false,
    };
    nodeScreenMediaRef.current[nodeId] = entry;
    const url = URL.createObjectURL(mediaSource);
    setNodeScreenStreamUrls((prev) => ({ ...prev, [nodeId]: url }));
    mediaSource.addEventListener('sourceopen', () => {
      try {
        const sourceBuffer = mediaSource.addSourceBuffer(mime);
        sourceBuffer.mode = 'segments';
        entry.sourceBuffer = sourceBuffer;
        const flush = () => {
          const buffer = entry.sourceBuffer;
          if (!buffer || buffer.updating) return;
          const chunk = entry.queue.shift();
          if (!chunk) return;
          try {
            const copy = new Uint8Array(chunk.byteLength);
            copy.set(chunk);
            entry.sourceBuffer?.appendBuffer(copy.buffer);
          } catch (err) {
            console.warn('Screen stream append failed', err);
          }
        };
        sourceBuffer.addEventListener('updateend', () => {
          if (entry.prunePending) {
            entry.prunePending = false;
            tryPruneScreenBuffer(entry);
          }
          flush();
        });
        flush();
      } catch (err) {
        console.warn('Unable to create screen SourceBuffer', err);
      }
    });
    return entry;
  };

  const appendScreenChunk = (nodeId: string, latest: { mime: string; dataBase64: string; receivedAtMs: number }) => {
    const last = nodeScreenLastReceivedRef.current[nodeId] ?? 0;
    if (latest.receivedAtMs <= last) return;
    nodeScreenLastReceivedRef.current[nodeId] = latest.receivedAtMs;
    const mime = latest.mime || 'video/webm';
    const entry = ensureScreenMedia(nodeId, mime);
    if (!entry) return;
    if (entry.mediaSource.readyState === 'closed') {
      resetScreenMedia(nodeId);
      return;
    }
    const chunk = Uint8Array.from(atob(latest.dataBase64), (c) => c.charCodeAt(0));
    entry.queue.push(chunk);
    if (entry.sourceBuffer && !entry.sourceBuffer.updating) {
      const nextChunk = entry.queue.shift();
      if (nextChunk) {
        try {
          const copy = new Uint8Array(nextChunk.byteLength);
          copy.set(nextChunk);
          entry.sourceBuffer.appendBuffer(copy.buffer);
        } catch (err) {
          console.warn('Screen stream append failed', err);
        }
      }
    }
    if (entry.sourceBuffer && entry.mediaSource.readyState === 'open') {
      const now = Date.now();
      if (now - entry.lastPrunedAt > 5000) {
        entry.lastPrunedAt = now;
        if (entry.sourceBuffer.updating) {
          entry.prunePending = true;
        } else {
          tryPruneScreenBuffer(entry);
        }
      }
    }
  };

  const tryPruneScreenBuffer = (entry: {
    sourceBuffer: SourceBuffer | null;
    lastPrunedAt: number;
  }) => {
    if (!entry.sourceBuffer || entry.sourceBuffer.updating) return;
    try {
      const buffered = entry.sourceBuffer.buffered;
      if (buffered.length > 0) {
        const keepFrom = Math.max(0, buffered.end(buffered.length - 1) - 25);
        for (let i = 0; i < buffered.length; i += 1) {
          const start = buffered.start(i);
          const end = buffered.end(i);
          if (end <= keepFrom) {
            entry.sourceBuffer.remove(start, end);
          } else if (start < keepFrom) {
            entry.sourceBuffer.remove(start, keepFrom);
          }
        }
      }
    } catch (err) {
      console.warn('Screen stream prune failed', err);
    }
  };

  const pollNodeStream = async (nodeId: string, kind: 'mic' | 'screen') => {
    const accomplish = getAccomplish();
    try {
      const result = await accomplish.getLatestNodeStreamChunk(nodeId, kind);
      const latest = result?.latest as { mime: string; dataBase64: string; receivedAtMs: number } | null;
      if (!latest?.mime || !latest.dataBase64) {
        if (kind === 'screen' && nodeScreenStreams[nodeId]) {
          const last = nodeScreenLastReceivedRef.current[nodeId] ?? 0;
          if (last && Date.now() - last > 12000) {
            setNodeScreenStreams((prev) => {
              const next = { ...prev };
              delete next[nodeId];
              return next;
            });
            resetScreenMedia(nodeId);
            stopStreamPolling(nodeId, 'screen');
          }
        }
        return;
      }
      const dataUrl = `data:${latest.mime};base64,${latest.dataBase64}`;
      if (kind === 'mic') {
        setNodeMicChunks((prev) => ({ ...prev, [nodeId]: { dataUrl, receivedAtMs: latest.receivedAtMs } }));
        const buffer = nodeMicBuffersRef.current[nodeId] ?? [];
        buffer.push({ mime: latest.mime, dataBase64: latest.dataBase64 });
        if (buffer.length > 8 && buffer.length > 1) {
          buffer.splice(1, buffer.length - 8);
        }
        nodeMicBuffersRef.current[nodeId] = buffer;
        const key = `mic:${nodeId}`;
        const last = nodeBufferedUpdateRef.current[key] ?? 0;
        if (Date.now() - last > 3000) {
          nodeBufferedUpdateRef.current[key] = Date.now();
          buildBufferedUrl(nodeId, 'mic');
        }
      } else {
        setNodeScreenChunks((prev) => ({ ...prev, [nodeId]: { dataUrl, receivedAtMs: latest.receivedAtMs } }));
        appendScreenChunk(nodeId, latest);
        const buffer = nodeScreenBuffersRef.current[nodeId] ?? [];
        buffer.push({ mime: latest.mime, dataBase64: latest.dataBase64 });
        if (buffer.length > 6 && buffer.length > 1) {
          buffer.splice(1, buffer.length - 6);
        }
        nodeScreenBuffersRef.current[nodeId] = buffer;
        const key = `screen:${nodeId}`;
        const last = nodeBufferedUpdateRef.current[key] ?? 0;
        if (Date.now() - last > 5000) {
          nodeBufferedUpdateRef.current[key] = Date.now();
          buildBufferedUrl(nodeId, 'screen');
        }
      }
    } catch (err) {
      console.warn('Failed to poll node stream', err);
    }
  };

  const startStreamPolling = (nodeId: string, kind: 'mic' | 'screen') => {
    const key = `${kind}:${nodeId}`;
    if (streamPollTimersRef.current.has(key)) return;
    void pollNodeStream(nodeId, kind);
    const timer = setInterval(() => {
      void pollNodeStream(nodeId, kind);
    }, 2000);
    streamPollTimersRef.current.set(key, timer);
  };

  const stopStreamPolling = (nodeId: string, kind: 'mic' | 'screen') => {
    const key = `${kind}:${nodeId}`;
    const timer = streamPollTimersRef.current.get(key);
    if (timer) {
      clearInterval(timer);
      streamPollTimersRef.current.delete(key);
    }
  };

  const handleStartMicStream = async (nodeId: string) => {
    const accomplish = getAccomplish();
    setNodePairingError(null);
    try {
      const result = await accomplish.startNodeMicStream(nodeId, 1500);
      if (result?.result && !result.result.ok) {
        throw new Error(result.result.error || 'Mic stream failed.');
      }
      if (result?.streamId) {
        setNodeMicStreams((prev) => ({ ...prev, [nodeId]: result.streamId }));
        startStreamPolling(nodeId, 'mic');
      }
    } catch (err) {
      setNodePairingError(formatNodeCommandError(err, 'start mic stream'));
    }
  };

  const handleStopMicStream = async (nodeId: string) => {
    const accomplish = getAccomplish();
    setNodePairingError(null);
    try {
      await accomplish.stopNodeMicStream(nodeId, nodeMicStreams[nodeId]);
    } catch (err) {
      setNodePairingError(formatNodeCommandError(err, 'stop mic stream'));
    } finally {
      setNodeMicStreams((prev) => {
        const next = { ...prev };
        delete next[nodeId];
        return next;
      });
      stopStreamPolling(nodeId, 'mic');
    }
  };

  const handleStartScreenStream = async (nodeId: string) => {
    const accomplish = getAccomplish();
    setNodePairingError(null);
    try {
      const result = await accomplish.startNodeScreenStream(nodeId, 1500);
      if (result?.result && !result.result.ok) {
        throw new Error(result.result.error || 'Screen stream failed.');
      }
      if (result?.streamId) {
        setNodeScreenStreams((prev) => ({ ...prev, [nodeId]: result.streamId }));
        startStreamPolling(nodeId, 'screen');
      }
    } catch (err) {
      setNodePairingError(formatNodeCommandError(err, 'start screen stream'));
    }
  };

  const handleStopScreenStream = async (nodeId: string) => {
    const accomplish = getAccomplish();
    setNodePairingError(null);
    try {
      await accomplish.stopNodeScreenStream(nodeId, nodeScreenStreams[nodeId]);
    } catch (err) {
      setNodePairingError(formatNodeCommandError(err, 'stop screen stream'));
    } finally {
      setNodeScreenStreams((prev) => {
        const next = { ...prev };
        delete next[nodeId];
        return next;
      });
      resetScreenMedia(nodeId);
      stopStreamPolling(nodeId, 'screen');
    }
  };

  const handleRemovePairedNode = async (nodeId: string) => {
    const accomplish = getAccomplish();
    setNodePairingError(null);
    try {
      await accomplish.removePairedNode(nodeId);
      setNodeSnapshots((prev) => {
        const next = { ...prev };
        delete next[nodeId];
        return next;
      });
      setNodeLiveFrames((prev) => {
        const next = { ...prev };
        delete next[nodeId];
        return next;
      });
      setNodeMicChunks((prev) => {
        const next = { ...prev };
        delete next[nodeId];
        return next;
      });
      setNodeScreenChunks((prev) => {
        const next = { ...prev };
        delete next[nodeId];
        return next;
      });
      setNodeMicStreams((prev) => {
        const next = { ...prev };
        delete next[nodeId];
        return next;
      });
      setNodeScreenStreams((prev) => {
        const next = { ...prev };
        delete next[nodeId];
        return next;
      });
      setNodeMicBufferUrls((prev) => {
        const next = { ...prev };
        const url = next[nodeId];
        if (url) URL.revokeObjectURL(url);
        delete next[nodeId];
        return next;
      });
      setNodeScreenBufferUrls((prev) => {
        const next = { ...prev };
        const url = next[nodeId];
        if (url) URL.revokeObjectURL(url);
        delete next[nodeId];
        return next;
      });
      delete nodeMicBuffersRef.current[nodeId];
      delete nodeScreenBuffersRef.current[nodeId];
      resetScreenMedia(nodeId);
      stopLivePreview(nodeId);
      stopStreamPolling(nodeId, 'mic');
      stopStreamPolling(nodeId, 'screen');
      await refreshNodePairing();
    } catch (err) {
      setNodePairingError(err instanceof Error ? err.message : 'Unable to remove paired node.');
    }
  };

  const handleUpdatePairedNodeName = async (
    nodeId: string,
    overrides?: { displayName?: string | null; badgeColor?: string | null; badgeIcon?: string | null }
  ) => {
    const accomplish = getAccomplish();
    setNodePairingError(null);
    const existingNode = nodePairing?.paired?.find((node) => node.nodeId === nodeId);
    const hasNameEdit = Object.prototype.hasOwnProperty.call(nodeNameEdits, nodeId);
    const refDisplayName = nodeNameInputRefs.current[nodeId]?.value;
    const hasColorEdit = Object.prototype.hasOwnProperty.call(nodeBadgeColorEdits, nodeId);
    const hasIconEdit = Object.prototype.hasOwnProperty.call(nodeBadgeIconEdits, nodeId);
    const displayNameSource =
      overrides?.displayName ??
      (typeof refDisplayName === 'string'
        ? refDisplayName
        : null) ??
      (hasNameEdit ? nodeNameEdits[nodeId] : existingNode?.displayName ?? '');
    const badgeColorSource =
      overrides?.badgeColor ??
      (hasColorEdit ? nodeBadgeColorEdits[nodeId] : existingNode?.badgeColor ?? '');
    const badgeIconSource =
      overrides?.badgeIcon ??
      (hasIconEdit ? nodeBadgeIconEdits[nodeId] : existingNode?.badgeIcon ?? '');
    const displayName = (displayNameSource ?? '').toString().trim();
    const badgeColor = (badgeColorSource ?? '').toString().trim();
    const badgeIcon = (badgeIconSource ?? '').toString().trim();
    setNodeNameSaving(nodeId);
    try {
      await accomplish.updatePairedNodeName(
        nodeId,
        displayName || null,
        badgeColor || null,
        badgeIcon || null
      );
      await refreshNodePairing();
    } catch (err) {
      setNodePairingError(err instanceof Error ? err.message : 'Unable to update node name.');
    } finally {
      setNodeNameSaving(null);
    }
  };

  const handleUpdatePairedNodeAiAccess = async (nodeId: string, allowed: boolean) => {
    const accomplish = getAccomplish();
    setNodePairingError(null);
    setNodeNameSaving(nodeId);
    try {
      await accomplish.updatePairedNodeAiAccess(nodeId, allowed);
      await refreshNodePairing();
    } catch (err) {
      setNodePairingError(err instanceof Error ? err.message : 'Unable to update AI access.');
    } finally {
      setNodeNameSaving(null);
    }
  };

  const handleSaveSnapshot = (nodeId: string) => {
    const dataUrl = nodeSnapshots[nodeId];
    if (!dataUrl) return;
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `opendeskmate-snapshot-${nodeId}-${Date.now()}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSaveAudio = async (nodeId: string) => {
    const bufferUrl = nodeMicBufferUrls[nodeId];
    if (!bufferUrl) return;

    setAudioSavingNode(nodeId);
    try {
      const response = await fetch(bufferUrl);
      const webmBlob = await response.blob();

      const { convertWebmToMp3 } = await import('@/lib/audio-convert');
      const mp3Blob = await convertWebmToMp3(webmBlob);

      const url = URL.createObjectURL(mp3Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `opendeskmate-mic-${nodeId}-${Date.now()}.mp3`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.warn('Failed to save audio as MP3:', err);
      const link = document.createElement('a');
      link.href = bufferUrl;
      link.download = `opendeskmate-mic-${nodeId}-${Date.now()}.webm`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      setAudioSavingNode(null);
    }
  };

  const handleCopySnapshot = async (nodeId: string) => {
    const dataUrl = nodeSnapshots[nodeId];
    if (!dataUrl) return;
    try {
      await navigator.clipboard.writeText(dataUrl);
      setNodePairingCopied(`${nodeId}-snapshot`);
      setTimeout(() => setNodePairingCopied(null), 1500);
    } catch (err) {
      console.warn('Failed to copy snapshot:', err);
    }
  };

  const handleAttachSnapshot = async (nodeId: string) => {
    const dataUrl = nodeSnapshots[nodeId];
    if (!dataUrl) return;
    const accomplish = getAccomplish();
    try {
      const result = await accomplish.saveDataUrlToFile(dataUrl, `snapshot-${nodeId}`);
      if (result?.filePath) {
        addAttachedFiles([result.filePath]);
        setNodePairingCopied(`${nodeId}-attached`);
        setTimeout(() => setNodePairingCopied(null), 1500);
      }
    } catch (err) {
      console.warn('Failed to attach snapshot:', err);
      setNodePairingError('Unable to attach snapshot to prompt.');
    }
  };

  const handleClearSnapshot = (nodeId: string) => {
    setNodeSnapshots((prev) => {
      const next = { ...prev };
      delete next[nodeId];
      return next;
    });
  };

  useEffect(() => {
    if (!open || !mobileNodesEnabled) {
      livePreviewTimersRef.current.forEach((timer) => clearInterval(timer));
      livePreviewTimersRef.current.clear();
      setLivePreviewNodes(new Set());
      setNodeLiveFrames({});
    }
    return () => {
      livePreviewTimersRef.current.forEach((timer) => clearInterval(timer));
      livePreviewTimersRef.current.clear();
      setLivePreviewNodes(new Set());
    };
  }, [open, mobileNodesEnabled]);

  const refreshGatewayStatus = async () => {
    const accomplish = getAccomplish();
    setGatewayStatusLoading(true);
    setGatewayError(null);
    try {
      const info = await accomplish.getGatewayConfig();
      const config = info.config as GatewayConfig;
      setGatewayStatus((info.status as GatewayRuntimeStatus) || null);
      if (config) {
        setGatewayAuthModeInstant(config.authMode);
        setGatewayAllowTailscaleInstant(config.allowTailscale);
        setGatewayTailscaleModeInstant(config.tailscaleMode);
        setGatewayTailscaleResetOnExitInstant(Boolean(config.tailscaleResetOnExit));
        setGatewayRecordConnectorDiscoveryInstant(config.recordConnectorDiscovery !== false);
        setGatewayRpcAuthMode(config.authMode);
        gatewayLastSavedRef.current = JSON.stringify({
          authMode: config.authMode,
          allowTailscale: config.allowTailscale,
          tailscaleMode: config.tailscaleMode,
          tailscaleResetOnExit: Boolean(config.tailscaleResetOnExit),
          recordConnectorDiscovery: config.recordConnectorDiscovery !== false,
        });
      }
      const status = info.status as GatewayRuntimeStatus | undefined;
      setGatewayTokenSet(Boolean(status?.tokenSet));
      setGatewayPasswordSet(Boolean(status?.passwordSet));
    } catch (err) {
      setGatewayError(err instanceof Error ? err.message : 'Unable to load gateway settings.');
    } finally {
      setGatewayStatusLoading(false);
    }
  };

  const handleSaveGatewayConfig = async (silent = false) => {
    const accomplish = getAccomplish();
    if (!silent) {
      setGatewaySaving(true);
      setGatewayError(null);
    }
    try {
      const payload: GatewayConfig = {
        authMode: gatewayConfigRef.current.authMode,
        allowTailscale: gatewayConfigRef.current.allowTailscale,
        tailscaleMode: gatewayConfigRef.current.tailscaleMode,
        tailscaleResetOnExit: gatewayConfigRef.current.tailscaleResetOnExit,
        recordConnectorDiscovery: gatewayConfigRef.current.recordConnectorDiscovery,
      };

      const nextKey = JSON.stringify(payload);
      if (nextKey === gatewayLastSavedRef.current) {
        return;
      }
      await accomplish.setGatewayConfig(payload);
      gatewayLastSavedRef.current = nextKey;
      await refreshGatewayStatus();
    } catch (err) {
      if (!silent) {
        setGatewayError(err instanceof Error ? err.message : 'Unable to save gateway settings.');
      }
    } finally {
      if (!silent) {
        setGatewaySaving(false);
      }
    }
  };

  const handleSaveGatewayToken = async () => {
    const accomplish = getAccomplish();
    const tokenInput = gatewayTokenInputRef.current?.value ?? gatewayTokenInput;
    const token = tokenInput.trim();
    if (!token) {
      setGatewayError('Enter a token before saving.');
      return;
    }
    setGatewayTokenSaving(true);
    setGatewayError(null);
    try {
      await accomplish.setGatewayToken(token);
      setGatewayTokenInput(tokenInput);
      setGatewayTokenSet(true);
      await refreshGatewayStatus();
    } catch (err) {
      setGatewayError(err instanceof Error ? err.message : 'Unable to save gateway token.');
    } finally {
      setGatewayTokenSaving(false);
    }
  };

  const handleGenerateGatewayToken = async () => {
    const accomplish = getAccomplish();
    setGatewayTokenSaving(true);
    setGatewayError(null);
    try {
      const result = await accomplish.generateGatewayToken();
      if (result?.token) {
        setGatewayTokenInput(result.token);
        if (gatewayTokenInputRef.current) {
          gatewayTokenInputRef.current.value = result.token;
        }
        setGatewayTokenSet(true);
        await navigator.clipboard.writeText(result.token);
        setGatewayCopied('token');
        setTimeout(() => setGatewayCopied(null), 1500);
      }
      await refreshGatewayStatus();
    } catch (err) {
      setGatewayError(err instanceof Error ? err.message : 'Unable to generate gateway token.');
    } finally {
      setGatewayTokenSaving(false);
    }
  };

  const handleClearGatewayToken = async () => {
    const accomplish = getAccomplish();
    setGatewayTokenSaving(true);
    setGatewayError(null);
    try {
      await accomplish.clearGatewayToken();
      setGatewayTokenInput('');
      if (gatewayTokenInputRef.current) {
        gatewayTokenInputRef.current.value = '';
      }
      setGatewayTokenSet(false);
      await refreshGatewayStatus();
    } catch (err) {
      setGatewayError(err instanceof Error ? err.message : 'Unable to clear gateway token.');
    } finally {
      setGatewayTokenSaving(false);
    }
  };

  const handleSaveGatewayPassword = async () => {
    const accomplish = getAccomplish();
    const passwordInput = gatewayPasswordInputRef.current?.value ?? gatewayPasswordInput;
    const password = passwordInput.trim();
    if (!password) {
      setGatewayError('Enter a password before saving.');
      return;
    }
    setGatewayPasswordSaving(true);
    setGatewayError(null);
    try {
      await accomplish.setGatewayPassword(password);
      setGatewayPasswordInput(passwordInput);
      setGatewayPasswordSet(true);
      await refreshGatewayStatus();
    } catch (err) {
      setGatewayError(err instanceof Error ? err.message : 'Unable to save gateway password.');
    } finally {
      setGatewayPasswordSaving(false);
    }
  };

  const handleGenerateGatewayPassword = async () => {
    const accomplish = getAccomplish();
    setGatewayPasswordSaving(true);
    setGatewayError(null);
    try {
      const result = await accomplish.generateGatewayPassword();
      if (result?.password) {
        setGatewayPasswordInput(result.password);
        if (gatewayPasswordInputRef.current) {
          gatewayPasswordInputRef.current.value = result.password;
        }
        setGatewayPasswordSet(true);
        await navigator.clipboard.writeText(result.password);
        setGatewayCopied('password');
        setTimeout(() => setGatewayCopied(null), 1500);
      }
      await refreshGatewayStatus();
    } catch (err) {
      setGatewayError(err instanceof Error ? err.message : 'Unable to generate gateway password.');
    } finally {
      setGatewayPasswordSaving(false);
    }
  };

  const handleClearGatewayPassword = async () => {
    const accomplish = getAccomplish();
    setGatewayPasswordSaving(true);
    setGatewayError(null);
    try {
      await accomplish.clearGatewayPassword();
      setGatewayPasswordInput('');
      if (gatewayPasswordInputRef.current) {
        gatewayPasswordInputRef.current.value = '';
      }
      setGatewayPasswordSet(false);
      await refreshGatewayStatus();
    } catch (err) {
      setGatewayError(err instanceof Error ? err.message : 'Unable to clear gateway password.');
    } finally {
      setGatewayPasswordSaving(false);
    }
  };

  const handleCopyGatewayValue = async (value?: string | null, key?: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      if (key) {
        setGatewayCopied(key);
        setTimeout(() => setGatewayCopied(null), 1500);
      }
    } catch (err) {
      console.warn('Failed to copy gateway value', err);
    }
  };

  const handleCopyGatewayToken = async () => {
    const token = (gatewayTokenInputRef.current?.value ?? gatewayTokenInput).trim();
    if (!token) {
      setGatewayError('No token in the field to copy. Stored tokens cannot be read back automatically.');
      return;
    }
    setGatewayError(null);
    await handleCopyGatewayValue(token, 'token-copy');
  };

  const handleOpenGatewayUrl = async (url?: string | null) => {
    if (!url) return;
    const accomplish = getAccomplish();
    try {
      await accomplish.openExternal(url);
    } catch (err) {
      console.warn('Failed to open gateway URL', err);
    }
  };

  const refreshGatewayBindings = async () => {
    const accomplish = getAccomplish();
    setGatewayBindingsLoading(true);
    setGatewayBindingsError(null);
    try {
      const list = await accomplish.listGatewayBindings();
      setGatewayBindings(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('Failed to refresh gateway bindings:', err);
      setGatewayBindingsError('Unable to refresh route bindings.');
    } finally {
      setGatewayBindingsLoading(false);
    }
  };

  const refreshGatewaySessions = async (agentId?: string) => {
    const accomplish = getAccomplish();
    setGatewaySessionsLoading(true);
    setGatewaySessionsError(null);
    try {
      const nextAgentId = (agentId ?? gatewaySessionFilterAgentId).trim() || undefined;
      const list = await accomplish.listGatewaySessions(nextAgentId);
      setGatewaySessions(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('Failed to refresh gateway sessions:', err);
      setGatewaySessionsError('Unable to refresh gateway sessions.');
    } finally {
      setGatewaySessionsLoading(false);
    }
  };

  const refreshGatewayRuns = async (agentId?: string) => {
    const accomplish = getAccomplish();
    setGatewayRunsLoading(true);
    setGatewayRunsError(null);
    try {
      const nextAgentId = (agentId ?? gatewayRunFilterAgentId).trim() || undefined;
      const list = await accomplish.listGatewayRuns(nextAgentId);
      setGatewayRuns(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('Failed to refresh gateway runs:', err);
      setGatewayRunsError('Unable to refresh gateway runs.');
    } finally {
      setGatewayRunsLoading(false);
    }
  };

  const handleEditGatewayBinding = (binding: GatewayRouteBinding) => {
    setGatewayBindingEditorId(binding.id);
    setGatewayBindingAgentId(binding.agentId || activeAgentId || defaultAgentId || 'main');
    setGatewayBindingChannel(binding.match.channel || 'discord');
    setGatewayBindingAccountId(binding.match.accountId || '');
    setGatewayBindingPeerKind(binding.match.peer?.kind || 'dm');
    setGatewayBindingPeerId(binding.match.peer?.id || '');
    setGatewayBindingGuildId(binding.match.guildId || '');
    setGatewayBindingTeamId(binding.match.teamId || '');
  };

  const handleSaveGatewayBinding = async () => {
    const accomplish = getAccomplish();
    setGatewayBindingsSaving(true);
    setGatewayBindingsError(null);
    try {
      const channel = normalizeGatewayChannel(gatewayBindingChannel);
      const agentId = gatewayBindingAgentId.trim() || activeAgentId || defaultAgentId || 'main';
      if (!agentId) {
        throw new Error('Agent is required.');
      }
      const binding: GatewayRouteBinding = {
        id: gatewayBindingEditorId || '',
        agentId,
        match: {
          channel,
        },
      };
      const accountId = gatewayBindingAccountId.trim();
      if (accountId) {
        binding.match.accountId = accountId;
      }
      const peerId = gatewayBindingPeerId.trim();
      if (peerId) {
        binding.match.peer = {
          kind: gatewayBindingPeerKind,
          id: peerId,
        };
      }
      const guildId = gatewayBindingGuildId.trim();
      if (guildId) {
        binding.match.guildId = guildId;
      }
      const teamId = gatewayBindingTeamId.trim();
      if (teamId) {
        binding.match.teamId = teamId;
      }
      await accomplish.upsertGatewayBinding(binding);
      await refreshGatewayBindings();
      resetGatewayBindingEditor();
    } catch (err) {
      console.error('Failed to save gateway binding:', err);
      setGatewayBindingsError(err instanceof Error ? err.message : 'Unable to save binding.');
    } finally {
      setGatewayBindingsSaving(false);
    }
  };

  const handleDeleteGatewayBinding = async (bindingId: string) => {
    const accomplish = getAccomplish();
    setGatewayBindingsSaving(true);
    setGatewayBindingsError(null);
    try {
      await accomplish.removeGatewayBinding(bindingId);
      if (gatewayBindingEditorId === bindingId) {
        resetGatewayBindingEditor();
      }
      await refreshGatewayBindings();
    } catch (err) {
      console.error('Failed to delete gateway binding:', err);
      setGatewayBindingsError('Unable to delete binding.');
    } finally {
      setGatewayBindingsSaving(false);
    }
  };

  const handleDeleteGatewaySession = async (sessionKey: string) => {
    const accomplish = getAccomplish();
    setGatewaySessionDeletingKey(sessionKey);
    setGatewaySessionsError(null);
    try {
      await accomplish.deleteGatewaySession(sessionKey);
      await refreshGatewaySessions();
    } catch (err) {
      console.error('Failed to delete gateway session:', err);
      setGatewaySessionsError('Unable to delete session.');
    } finally {
      setGatewaySessionDeletingKey(null);
    }
  };

  const handleLookupGatewayRun = async () => {
    const accomplish = getAccomplish();
    const runId = gatewayRunLookupId.trim();
    if (!runId) {
      setGatewayRunLookup(null);
      return;
    }
    setGatewayRunLookupLoading(true);
    setGatewayRunsError(null);
    try {
      const run = await accomplish.getGatewayRun(runId);
      setGatewayRunLookup(run || null);
    } catch (err) {
      console.error('Failed to get gateway run:', err);
      setGatewayRunsError('Unable to fetch run.');
    } finally {
      setGatewayRunLookupLoading(false);
    }
  };

  const applyGatewayRpcPreset = (method: string, params: Record<string, unknown>) => {
    setGatewayRpcMethod(method);
    setGatewayRpcParams(JSON.stringify(params, null, 2));
  };

  const handleRunGatewayRpc = async () => {
    const method = gatewayRpcMethod.trim();
    if (!method) {
      setGatewayRpcError('Method is required.');
      return;
    }

    let params: Record<string, unknown>;
    try {
      const raw = gatewayRpcParams.trim();
      if (!raw) {
        params = {};
      } else {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Params must be a JSON object.');
        }
        params = parsed as Record<string, unknown>;
      }
    } catch (err) {
      setGatewayRpcError(err instanceof Error ? err.message : 'Invalid JSON params.');
      return;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (gatewayRpcAuthMode === 'token') {
      const token = gatewayRpcToken.trim() || (gatewayTokenInputRef.current?.value ?? gatewayTokenInput).trim();
      if (!token) {
        setGatewayRpcError('Token auth selected but no token provided.');
        return;
      }
      headers.Authorization = `Bearer ${token}`;
    } else if (gatewayRpcAuthMode === 'password') {
      const password = gatewayRpcPassword.trim() || (gatewayPasswordInputRef.current?.value ?? gatewayPasswordInput).trim();
      if (!password) {
        setGatewayRpcError('Password auth selected but no password provided.');
        return;
      }
      headers.Authorization = `Basic ${btoa(`gateway:${password}`)}`;
    }

    setGatewayRpcLoading(true);
    setGatewayRpcError(null);
    try {
      const response = await fetch(`${localGatewayUrl}/gateway/rpc`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `settings-${Date.now()}`,
          method,
          params,
        }),
      });
      const rawText = await response.text();
      try {
        const parsed = rawText ? JSON.parse(rawText) : {};
        setGatewayRpcResponse(JSON.stringify(parsed, null, 2));
      } catch {
        setGatewayRpcResponse(rawText);
      }
      if (!response.ok) {
        setGatewayRpcError(`HTTP ${response.status}`);
      }
    } catch (err) {
      console.error('Failed to run gateway rpc:', err);
      setGatewayRpcError(err instanceof Error ? err.message : 'Gateway RPC call failed.');
    } finally {
      setGatewayRpcLoading(false);
    }
  };

  const refreshGatewayConnectorExtensions = async () => {
    const accomplish = getAccomplish();
    setGatewayConnectorLoading(true);
    setGatewayConnectorError(null);
    try {
      const [states, discovery, runtimes] = await Promise.all([
        accomplish.listGatewayConnectorExtensions(),
        accomplish.listGatewayConnectorDiscovery(),
        accomplish.listGatewayConnectorRuntimeStatuses(),
      ]);
      const list = Array.isArray(states) ? (states as GatewayConnectorExtensionState[]) : [];
      const observed = Array.isArray(discovery) ? (discovery as GatewayConnectorDiscoverySnapshot[]) : [];
      const runtimeStatuses = Array.isArray(runtimes) ? (runtimes as GatewayConnectorRuntimeStatus[]) : [];
      setGatewayConnectorExtensions(list);
      setGatewayConnectorDiscovery(observed);
      setGatewayConnectorRuntimeStatuses(runtimeStatuses);
      setGatewayConnectorSelectedId((prev) => {
        if (prev && list.some((entry) => entry.runtimeKey === prev)) {
          return prev;
        }
        return list[0]?.runtimeKey || '';
      });
      setGatewayConnectorCreateType((prev) => prev || list[0]?.definition.id || 'discord');
    } catch (err) {
      console.error('Failed to refresh gateway connector extensions:', err);
      setGatewayConnectorError('Unable to refresh messaging connector extensions.');
    } finally {
      setGatewayConnectorLoading(false);
    }
  };

  const formatGatewayConnectorMetadataText = (
    metadata: Record<string, string>,
    preferredKeyOrder: string[]
  ): string => {
    const orderedLines: string[] = [];
    const seen = new Set<string>();
    for (const key of preferredKeyOrder) {
      const value = metadata[key];
      if (!value) continue;
      orderedLines.push(`${key}=${value}`);
      seen.add(key);
    }
    for (const [key, value] of Object.entries(metadata)) {
      if (!key || !value || seen.has(key)) continue;
      orderedLines.push(`${key}=${value}`);
    }
    return orderedLines.join('\n');
  };

  const handleMergeGatewayConnectorMetadataTemplate = () => {
    if (!selectedGatewayConnectorMetadataTemplate) return;
    const existing = parseGatewayConnectorMetadata(gatewayConnectorMetadataText) ?? {};
    const next = { ...existing };
    let added = 0;
    for (const [key, value] of selectedGatewayConnectorMetadataTemplate.lines) {
      if (!next[key]) {
        next[key] = value;
        added += 1;
      }
    }
    const preferredKeyOrder = selectedGatewayConnectorMetadataTemplate.lines.map(([key]) => key);
    setGatewayConnectorMetadataText(formatGatewayConnectorMetadataText(next, preferredKeyOrder));
    setGatewayConnectorError(null);
    setGatewayConnectorStatus(
      added > 0
        ? `Added ${added} template key${added === 1 ? '' : 's'} to metadata.`
        : 'Template keys are already present.'
    );
  };

  const handleReplaceGatewayConnectorMetadataTemplate = () => {
    if (!selectedGatewayConnectorMetadataTemplate) return;
    setGatewayConnectorMetadataText(selectedGatewayConnectorMetadataTemplateText);
    setGatewayConnectorError(null);
    setGatewayConnectorStatus('Replaced metadata with connector template.');
  };

  const handleSaveGatewayConnectorConfig = async () => {
    const accomplish = getAccomplish();
    if (!selectedGatewayConnector) return;
    setGatewayConnectorSaving(true);
    setGatewayConnectorError(null);
    setGatewayConnectorStatus(null);
    try {
      const metadataObject = parseGatewayConnectorMetadata(gatewayConnectorMetadataText) ?? {};
      if (selectedGatewayConnectorHasRuntimeControls) {
        const commandPrefix = gatewayConnectorRuntimeCommandPrefix.trim();
        if (commandPrefix) {
          metadataObject.command_prefix = commandPrefix;
        } else {
          delete metadataObject.command_prefix;
        }
        const pollIntervalMs = gatewayConnectorRuntimePollIntervalMs.trim();
        if (pollIntervalMs) {
          metadataObject.poll_interval_ms = pollIntervalMs;
        } else {
          delete metadataObject.poll_interval_ms;
        }
        metadataObject.require_mention = gatewayConnectorRuntimeRequireMention ? 'true' : 'false';
        if (selectedGatewayConnector.definition.id === 'msteams') {
          const botUserId = gatewayConnectorRuntimeBotUserId.trim();
          if (botUserId) {
            metadataObject.bot_user_id = botUserId;
          } else {
            delete metadataObject.bot_user_id;
          }
        }
      }
      const metadata = Object.keys(metadataObject).length > 0 ? metadataObject : undefined;
      const result = await accomplish.setGatewayConnectorExtensionConfig({
        id: selectedGatewayConnector.definition.id,
        instanceId: selectedGatewayConnector.config.instanceId,
        name: selectedGatewayConnector.config.name,
        enabled: gatewayConnectorEnabled,
        autoBindRouting: gatewayConnectorAutoBindRouting,
        recordObservedIds: gatewayConnectorRecordObservedIds,
        accessPolicyMode: gatewayConnectorAccessPolicyMode,
        allowedUserIds: parseAllowlist(gatewayConnectorAllowedUserIds),
        allowedGroupIds: parseAllowlist(gatewayConnectorAllowedGroupIds),
        allowedChannelIds: parseAllowlist(gatewayConnectorAllowedChannelIds),
        allowedAccountIds: parseAllowlist(gatewayConnectorAllowedAccountIds),
        agentId: gatewayConnectorAgentId.trim() || undefined,
        accountId: gatewayConnectorAccountId.trim() || undefined,
        bridgeUrl: gatewayConnectorBridgeUrl.trim() || undefined,
        notes: gatewayConnectorNotes.trim() || undefined,
        metadata,
      });
      setGatewayConnectorStatus(
        `Saved ${selectedGatewayConnector.definition.name} connector${result.bindingId ? ` (binding: ${result.bindingId})` : ''}.`
      );
      if (selectedGatewayConnector.definition.id === 'discord') {
        await refreshDiscordStatus();
      } else if (selectedGatewayConnector.definition.id === 'telegram') {
        await refreshTelegramStatus();
      }
      await Promise.all([refreshGatewayConnectorExtensions(), refreshGatewayBindings()]);
    } catch (err) {
      setGatewayConnectorError(err instanceof Error ? err.message : 'Unable to save connector settings.');
    } finally {
      setGatewayConnectorSaving(false);
    }
  };

  const handleSaveGatewayConnectorSecret = async () => {
    const accomplish = getAccomplish();
    if (!selectedGatewayConnector) return;
    const secret = gatewayConnectorSecretInput.trim();
    if (!secret) {
      setGatewayConnectorError('Enter a shared secret before saving.');
      return;
    }
    setGatewayConnectorSecretSaving(true);
    setGatewayConnectorError(null);
    setGatewayConnectorStatus(null);
    try {
      await accomplish.setGatewayConnectorExtensionSecret(
        selectedGatewayConnector.definition.id,
        secret,
        selectedGatewayConnector.config.instanceId
      );
      setGatewayConnectorSecretInput('');
      setGatewayConnectorStatus(`Secret saved for ${selectedGatewayConnector.definition.name}.`);
      await refreshGatewayConnectorExtensions();
    } catch (err) {
      setGatewayConnectorError(err instanceof Error ? err.message : 'Unable to save connector secret.');
    } finally {
      setGatewayConnectorSecretSaving(false);
    }
  };

  const handleGenerateGatewayConnectorSecret = async () => {
    const accomplish = getAccomplish();
    if (!selectedGatewayConnector) return;
    setGatewayConnectorSecretSaving(true);
    setGatewayConnectorError(null);
    setGatewayConnectorStatus(null);
    try {
      const result = await accomplish.generateGatewayConnectorExtensionSecret(
        selectedGatewayConnector.definition.id,
        selectedGatewayConnector.config.instanceId
      );
      if (result?.secret) {
        setGatewayConnectorSecretInput(result.secret);
        await navigator.clipboard.writeText(result.secret);
      }
      setGatewayConnectorStatus(`Secret generated for ${selectedGatewayConnector.definition.name} and copied.`);
      await refreshGatewayConnectorExtensions();
    } catch (err) {
      setGatewayConnectorError(err instanceof Error ? err.message : 'Unable to generate connector secret.');
    } finally {
      setGatewayConnectorSecretSaving(false);
    }
  };

  const handleClearGatewayConnectorSecret = async () => {
    const accomplish = getAccomplish();
    if (!selectedGatewayConnector) return;
    setGatewayConnectorSecretSaving(true);
    setGatewayConnectorError(null);
    setGatewayConnectorStatus(null);
    try {
      await accomplish.clearGatewayConnectorExtensionSecret(
        selectedGatewayConnector.definition.id,
        selectedGatewayConnector.config.instanceId
      );
      setGatewayConnectorSecretInput('');
      setGatewayConnectorStatus(`Secret cleared for ${selectedGatewayConnector.definition.name}.`);
      await refreshGatewayConnectorExtensions();
    } catch (err) {
      setGatewayConnectorError(err instanceof Error ? err.message : 'Unable to clear connector secret.');
    } finally {
      setGatewayConnectorSecretSaving(false);
    }
  };

  const handleClearGatewayConnectorDiscovery = async (scope: 'selected' | 'all' = 'selected') => {
    const accomplish = getAccomplish();
    setGatewayConnectorDiscoveryClearing(true);
    setGatewayConnectorError(null);
    setGatewayConnectorStatus(null);
    try {
      const connectorId = scope === 'selected' ? selectedGatewayConnector?.definition.id : undefined;
      const connectorInstanceId = scope === 'selected' ? selectedGatewayConnector?.config.instanceId : undefined;
      if (scope === 'selected' && !connectorId) return;
      await accomplish.clearGatewayConnectorDiscovery(connectorId, connectorInstanceId);
      await refreshGatewayConnectorExtensions();
      setGatewayConnectorStatus(
        scope === 'selected'
          ? `Cleared observed IDs for ${selectedGatewayConnector?.definition.name ?? 'connector'}.`
          : 'Cleared observed IDs for all connectors.'
      );
    } catch (err) {
      setGatewayConnectorError(err instanceof Error ? err.message : 'Unable to clear observed connector IDs.');
    } finally {
      setGatewayConnectorDiscoveryClearing(false);
    }
  };

  const handleRestartGatewayConnectorRuntime = async () => {
    const accomplish = getAccomplish();
    if (!selectedGatewayConnector) return;
    setGatewayConnectorRuntimeRestarting(true);
    setGatewayConnectorError(null);
    setGatewayConnectorStatus(null);
    try {
      await accomplish.restartGatewayConnectorRuntime(
        selectedGatewayConnector.definition.id,
        selectedGatewayConnector.config.instanceId
      );
      await refreshGatewayConnectorExtensions();
      setGatewayConnectorStatus(`Restarted ${selectedGatewayConnector.definition.name} runtime.`);
    } catch (err) {
      setGatewayConnectorError(err instanceof Error ? err.message : 'Unable to restart connector runtime.');
    } finally {
      setGatewayConnectorRuntimeRestarting(false);
    }
  };

  const handleTestGatewayConnectorRuntime = async () => {
    const accomplish = getAccomplish();
    if (!selectedGatewayConnector) return;
    setGatewayConnectorRuntimeTesting(true);
    setGatewayConnectorError(null);
    setGatewayConnectorStatus(null);
    try {
      const result = await accomplish.testGatewayConnectorRuntime(
        selectedGatewayConnector.definition.id,
        selectedGatewayConnector.config.instanceId
      );
      setGatewayConnectorRuntimeTestResult(result);
      setGatewayConnectorStatus(result.ok ? `${selectedGatewayConnector.definition.name} runtime test passed.` : null);
      if (!result.ok) {
        setGatewayConnectorError(result.detail);
      }
      await refreshGatewayConnectorExtensions();
    } catch (err) {
      setGatewayConnectorError(err instanceof Error ? err.message : 'Unable to test connector runtime.');
    } finally {
      setGatewayConnectorRuntimeTesting(false);
    }
  };

  const handleDiscoverGatewayConnectorRuntimeTargets = async () => {
    const accomplish = getAccomplish();
    if (!selectedGatewayConnector) return;
    setGatewayConnectorRuntimeDiscovering(true);
    setGatewayConnectorError(null);
    setGatewayConnectorStatus(null);
    try {
      const targets = await accomplish.discoverGatewayConnectorRuntimeTargets(
        selectedGatewayConnector.definition.id,
        selectedGatewayConnector.config.instanceId
      );
      const list = Array.isArray(targets) ? targets : [];
      setGatewayConnectorRuntimeDiscoveryItems(list);
      setGatewayConnectorStatus(`Discovered ${list.length} targets for ${selectedGatewayConnector.definition.name}.`);
    } catch (err) {
      setGatewayConnectorError(err instanceof Error ? err.message : 'Unable to discover connector targets.');
    } finally {
      setGatewayConnectorRuntimeDiscovering(false);
    }
  };

  const handleCreateGatewayConnectorInstance = async () => {
    const accomplish = getAccomplish();
    const connectorId = gatewayConnectorCreateType.trim();
    if (!connectorId) return;
    setGatewayConnectorInstanceCreating(true);
    setGatewayConnectorError(null);
    setGatewayConnectorStatus(null);
    try {
      const result = await accomplish.createGatewayConnectorExtensionInstance(
        connectorId,
        gatewayConnectorCreateName.trim() || undefined
      );
      const runtimeKey = result?.state?.runtimeKey || '';
      await refreshGatewayConnectorExtensions();
      if (runtimeKey) {
        setGatewayConnectorSelectedId(runtimeKey);
      }
      setGatewayConnectorCreateName('');
      setGatewayConnectorStatus(`Created ${result?.state?.definition?.name ?? connectorId} instance.`);
    } catch (err) {
      setGatewayConnectorError(err instanceof Error ? err.message : 'Unable to create connector instance.');
    } finally {
      setGatewayConnectorInstanceCreating(false);
    }
  };

  const handleDeleteGatewayConnectorInstance = async () => {
    const accomplish = getAccomplish();
    if (!selectedGatewayConnector) return;
    setGatewayConnectorInstanceDeleting(true);
    setGatewayConnectorError(null);
    setGatewayConnectorStatus(null);
    try {
      await accomplish.deleteGatewayConnectorExtensionInstance(
        selectedGatewayConnector.definition.id,
        selectedGatewayConnector.config.instanceId
      );
      const removedRuntimeKey = selectedGatewayConnector.runtimeKey;
      await refreshGatewayConnectorExtensions();
      setGatewayConnectorSelectedId((prev) => (prev === removedRuntimeKey ? '' : prev));
      setGatewayConnectorStatus(`Deleted instance for ${selectedGatewayConnector.definition.name}.`);
    } catch (err) {
      setGatewayConnectorError(err instanceof Error ? err.message : 'Unable to delete connector instance.');
    } finally {
      setGatewayConnectorInstanceDeleting(false);
    }
  };

  const handleApplyDiscoveredTargetsToAllowlist = () => {
    const ids = gatewayConnectorRuntimeDiscoveryItems
      .map((item) => item.id?.trim())
      .filter((value): value is string => Boolean(value));
    if (ids.length === 0) return;
    setGatewayConnectorAllowedChannelIds(ids.join(', '));
    setGatewayConnectorStatus(`Applied ${ids.length} discovered target IDs to Allowed channel IDs.`);
  };

  const refreshAppConnectorExtensions = async () => {
    const accomplish = getAccomplish();
    setAppConnectorLoading(true);
    setAppConnectorError(null);
    try {
      const [states, runtimes] = await Promise.all([
        accomplish.listAppConnectorExtensions(),
        accomplish.listAppConnectorRuntimeStatuses(),
      ]);
      const list = Array.isArray(states) ? (states as AppConnectorExtensionState[]) : [];
      const runtimeStatuses = Array.isArray(runtimes) ? (runtimes as AppConnectorRuntimeStatus[]) : [];
      setAppConnectorExtensions(list);
      setAppConnectorRuntimeStatuses(runtimeStatuses);
      setAppConnectorSelectedId((prev) => {
        if (prev && list.some((entry) => entry.runtimeKey === prev)) {
          return prev;
        }
        return list[0]?.runtimeKey || '';
      });
      setAppConnectorCreateType((prev) => prev || list[0]?.definition.id || 'notion');
    } catch (err) {
      console.error('Failed to refresh app connector extensions:', err);
      setAppConnectorError('Unable to refresh app connector extensions.');
    } finally {
      setAppConnectorLoading(false);
    }
  };

  const stopAppConnectorOAuthPolling = () => {
    if (appConnectorOauthPollTimerRef.current) {
      clearInterval(appConnectorOauthPollTimerRef.current);
      appConnectorOauthPollTimerRef.current = null;
    }
  };

  const beginAppConnectorOAuthPolling = (flowId: string) => {
    const accomplish = getAccomplish();
    stopAppConnectorOAuthPolling();
    setAppConnectorOauthPending(true);
    setAppConnectorOauthFlowId(flowId);
    appConnectorOauthPollTimerRef.current = setInterval(async () => {
      try {
        const status = await accomplish.getAppConnectorOAuthFlowStatus(flowId);
        if (!status) {
          stopAppConnectorOAuthPolling();
          setAppConnectorOauthPending(false);
          setAppConnectorError('OAuth flow not found. Please start again.');
          return;
        }
        if (status.status === 'pending') {
          return;
        }
        stopAppConnectorOAuthPolling();
        setAppConnectorOauthPending(false);
        if (status.status === 'completed') {
          setAppConnectorStatus('OAuth connection complete and token stored.');
          setAppConnectorError(null);
          setAppConnectorSecretInput('');
          await refreshAppConnectorExtensions();
          return;
        }
        setAppConnectorError(status.detail || 'OAuth connection failed.');
      } catch (err) {
        stopAppConnectorOAuthPolling();
        setAppConnectorOauthPending(false);
        setAppConnectorError(err instanceof Error ? err.message : 'Failed to check OAuth flow status.');
      }
    }, 2000);
  };

  const handleBuildDiffEnforcementModeChange = async (mode: BuildDiffEnforcementMode) => {
    const accomplish = getAccomplish();
    const previous = buildDiffEnforcementMode;
    setBuildDiffEnforcementMode(mode);
    setBuildDiffEnforcementSaving(true);
    try {
      await accomplish.setBuildDiffEnforcementMode(mode);
    } catch (err) {
      console.error('Failed to save Build Mode diff enforcement mode:', err);
      setBuildDiffEnforcementMode(previous);
    } finally {
      setBuildDiffEnforcementSaving(false);
    }
  };

  const handleSaveAppConnectorOAuthClientSecret = async () => {
    const accomplish = getAccomplish();
    if (!selectedAppConnector || selectedAppConnector.definition.authMethod !== 'oauth2') return;
    const clientSecret = appConnectorOauthClientSecret.trim();
    if (!clientSecret) {
      setAppConnectorError('Enter OAuth client secret before saving.');
      return;
    }
    setAppConnectorOauthClientSecretSaving(true);
    setAppConnectorError(null);
    setAppConnectorStatus(null);
    try {
      await accomplish.setAppConnectorOAuthClientSecret(
        selectedAppConnector.definition.id,
        clientSecret,
        selectedAppConnector.config.instanceId
      );
      setAppConnectorOauthClientSecret('');
      setAppConnectorOauthClientSecretStored(true);
      setAppConnectorStatus('OAuth client secret stored securely.');
    } catch (err) {
      setAppConnectorError(err instanceof Error ? err.message : 'Unable to save OAuth client secret.');
    } finally {
      setAppConnectorOauthClientSecretSaving(false);
    }
  };

  const handleClearAppConnectorOAuthClientSecret = async () => {
    const accomplish = getAccomplish();
    if (!selectedAppConnector || selectedAppConnector.definition.authMethod !== 'oauth2') return;
    setAppConnectorOauthClientSecretSaving(true);
    setAppConnectorError(null);
    setAppConnectorStatus(null);
    try {
      await accomplish.clearAppConnectorOAuthClientSecret(
        selectedAppConnector.definition.id,
        selectedAppConnector.config.instanceId
      );
      setAppConnectorOauthClientSecret('');
      setAppConnectorOauthClientSecretStored(false);
      setAppConnectorStatus('OAuth client secret cleared.');
    } catch (err) {
      setAppConnectorError(err instanceof Error ? err.message : 'Unable to clear OAuth client secret.');
    } finally {
      setAppConnectorOauthClientSecretSaving(false);
    }
  };

  const handleStartAppConnectorOAuth = async () => {
    const accomplish = getAccomplish();
    if (!selectedAppConnector || selectedAppConnector.definition.authMethod !== 'oauth2') return;
    const connectorId = selectedAppConnector.definition.id;
    const clientId = appConnectorOauthClientId.trim()
      || getGatewayConnectorMetadataValue(selectedAppConnector.config.metadata, 'oauth_client_id')
      || '';
    if (!clientId) {
      setAppConnectorError('OAuth client ID is required.');
      return;
    }
    const typedClientSecret = appConnectorOauthClientSecret.trim();
    const providerRequiresClientSecret = connectorId === 'notion' || connectorId === 'slack';
    if (providerRequiresClientSecret && !typedClientSecret && !appConnectorOauthClientSecretStored) {
      setAppConnectorError('This provider requires OAuth client secret. Save it first.');
      return;
    }
    const redirectMode: 'auto' | 'desktop' | 'loopback' | 'public' = appConnectorOauthRedirectMode;
    if (redirectMode === 'public' && !oauthPublicCallbackUrl) {
      setAppConnectorError('Public callback URL is not available. Configure Gateway public URL/Tailscale or use loopback mode.');
      return;
    }
    const redirectUriOverride = redirectMode === 'public' ? oauthPublicCallbackUrl : undefined;
    setAppConnectorError(null);
    setAppConnectorStatus(null);
    setAppConnectorOauthAuthorizeUrl('');
    setAppConnectorOauthPending(true);
    try {
      if (typedClientSecret) {
        await accomplish.setAppConnectorOAuthClientSecret(
          connectorId,
          typedClientSecret,
          selectedAppConnector.config.instanceId
        );
        setAppConnectorOauthClientSecretStored(true);
        setAppConnectorOauthClientSecret('');
      }
      const flow = await accomplish.startAppConnectorOAuthFlow({
        connectorId,
        connectorInstanceId: selectedAppConnector.config.instanceId,
        clientId,
        clientSecret: typedClientSecret || undefined,
        scopes: appConnectorOauthScopes.trim() || undefined,
        redirectMode,
        redirectUri: redirectUriOverride,
      });
      setAppConnectorOauthAuthorizeUrl(flow.authorizeUrl || '');
      setAppConnectorStatus('OAuth browser flow started. If browser did not open, use Open OAuth URL.');
      beginAppConnectorOAuthPolling(flow.flowId);
    } catch (err) {
      setAppConnectorOauthPending(false);
      setAppConnectorOauthAuthorizeUrl('');
      setAppConnectorError(err instanceof Error ? err.message : 'Unable to start OAuth flow.');
    }
  };

  const handleDisconnectAppConnectorOAuth = async () => {
    const accomplish = getAccomplish();
    if (!selectedAppConnector || selectedAppConnector.definition.authMethod !== 'oauth2') return;
    setAppConnectorOauthDisconnecting(true);
    setAppConnectorError(null);
    setAppConnectorStatus(null);
    stopAppConnectorOAuthPolling();
    setAppConnectorOauthPending(false);
    try {
      const result = await accomplish.disconnectAppConnectorOAuth({
        connectorId: selectedAppConnector.definition.id,
        connectorInstanceId: selectedAppConnector.config.instanceId,
        remoteRevoke: true,
      });
      setAppConnectorOauthFlowId('');
      setAppConnectorOauthAuthorizeUrl('');
      setAppConnectorSecretInput('');
      setAppConnectorStatus(result?.detail || 'OAuth token disconnected.');
      await refreshAppConnectorExtensions();
    } catch (err) {
      setAppConnectorError(err instanceof Error ? err.message : 'Unable to disconnect OAuth token.');
    } finally {
      setAppConnectorOauthDisconnecting(false);
    }
  };

  const handleSelectObsidianVaultFolder = async () => {
    const accomplish = getAccomplish();
    if (!selectedAppConnector || selectedAppConnector.definition.id !== 'obsidian') return;
    setAppConnectorObsidianSelecting(true);
    setAppConnectorError(null);
    try {
      const folder = await accomplish.selectFolder();
      if (!folder) return;
      setAppConnectorBaseUrl(folder);
      setAppConnectorStatus('Selected Obsidian vault path. Save connector settings to apply.');
    } catch (err) {
      setAppConnectorError(err instanceof Error ? err.message : 'Unable to select vault folder.');
    } finally {
      setAppConnectorObsidianSelecting(false);
    }
  };

  const handleSendEmailTriggerTestEvent = async () => {
    const accomplish = getAccomplish();
    if (!selectedAppConnector || selectedAppConnector.definition.id !== 'email-triggers') return;
    const webhookUrl = appConnectorWebhookUrl.trim();
    if (!webhookUrl) {
      setAppConnectorError('Webhook URL is required before sending a test event.');
      return;
    }
    setAppConnectorWebhookTesting(true);
    setAppConnectorError(null);
    setAppConnectorStatus(null);
    try {
      const result = await accomplish.executeAppConnector({
        connectorId: selectedAppConnector.definition.id,
        connectorInstanceId: selectedAppConnector.config.instanceId,
        action: 'send_test_event',
        args: {
          webhookUrl,
          subject: 'Settings test event',
        },
      }) as { detail?: string } | null;
      setAppConnectorStatus(result?.detail || `Sent test event to ${webhookUrl}.`);
    } catch (err) {
      setAppConnectorError(err instanceof Error ? err.message : 'Unable to send webhook test event.');
    } finally {
      setAppConnectorWebhookTesting(false);
    }
  };

  const handleSaveAppConnectorConfig = async () => {
    const accomplish = getAccomplish();
    if (!selectedAppConnector) return;
    const isHydrated = appConnectorFormHydratedRef.current;
    setAppConnectorSaving(true);
    setAppConnectorError(null);
    setAppConnectorStatus(null);
    try {
      const existingMetadata = selectedAppConnector.config.metadata || {};
      const metadataObject = parseGatewayConnectorMetadata(appConnectorMetadataText) ?? {};
      if (selectedAppConnector.definition.authMethod === 'oauth2') {
        const oauthClientId = appConnectorOauthClientId.trim();
        const oauthClientSecret = appConnectorOauthClientSecret.trim();
        const oauthScopes = appConnectorOauthScopes.trim();
        const oauthRedirectMode = appConnectorOauthRedirectMode;
        const existingOauthClientId = getGatewayConnectorMetadataValue(existingMetadata, 'oauth_client_id') || '';
        const existingOauthScopes = getGatewayConnectorMetadataValue(existingMetadata, 'oauth_scopes') || '';
        const existingOauthRedirectMode = getGatewayConnectorMetadataValue(existingMetadata, 'oauth_redirect_mode') || '';
        if (oauthClientId) {
          metadataObject.oauth_client_id = oauthClientId;
        } else if (!isHydrated && existingOauthClientId) {
          metadataObject.oauth_client_id = existingOauthClientId;
        } else {
          delete metadataObject.oauth_client_id;
        }
        if (oauthScopes) {
          metadataObject.oauth_scopes = oauthScopes;
        } else if (!isHydrated && existingOauthScopes) {
          metadataObject.oauth_scopes = existingOauthScopes;
        } else {
          delete metadataObject.oauth_scopes;
        }
        if (oauthRedirectMode !== 'auto') {
          metadataObject.oauth_redirect_mode = oauthRedirectMode;
        } else if (!isHydrated && existingOauthRedirectMode) {
          metadataObject.oauth_redirect_mode = existingOauthRedirectMode;
        } else {
          delete metadataObject.oauth_redirect_mode;
        }
        if (oauthClientSecret) {
          await accomplish.setAppConnectorOAuthClientSecret(
            selectedAppConnector.definition.id,
            oauthClientSecret,
            selectedAppConnector.config.instanceId
          );
          setAppConnectorOauthClientSecret('');
          setAppConnectorOauthClientSecretStored(true);
        }
      }
      if (selectedAppConnector.definition.id === 'email-triggers') {
        const webhookUrl = appConnectorWebhookUrl.trim();
        if (webhookUrl) {
          metadataObject.webhook_url = webhookUrl;
        } else {
          delete metadataObject.webhook_url;
        }
      }
      const metadata = Object.keys(metadataObject).length > 0 ? metadataObject : undefined;
      await accomplish.setAppConnectorExtensionConfig({
        id: selectedAppConnector.definition.id,
        instanceId: selectedAppConnector.config.instanceId,
        name: selectedAppConnector.config.name,
        enabled: isHydrated ? appConnectorEnabled : Boolean(selectedAppConnector.config.enabled),
        autoBindTools: isHydrated ? appConnectorAutoBindTools : selectedAppConnector.config.autoBindTools !== false,
        agentId: appConnectorAgentId.trim() || undefined,
        accountId: appConnectorAccountId.trim() || undefined,
        baseUrl: appConnectorBaseUrl.trim() || undefined,
        notes: appConnectorNotes.trim() || undefined,
        metadata,
      });
      setAppConnectorStatus(`Saved ${selectedAppConnector.definition.name} connector.`);
      await refreshAppConnectorExtensions();
    } catch (err) {
      setAppConnectorError(err instanceof Error ? err.message : 'Unable to save app connector settings.');
    } finally {
      setAppConnectorSaving(false);
    }
  };

  const handleSaveAppConnectorSecret = async () => {
    const accomplish = getAccomplish();
    if (!selectedAppConnector) return;
    const secret = appConnectorSecretInput.trim();
    if (!secret) {
      setAppConnectorError('Enter a token/secret before saving.');
      return;
    }
    setAppConnectorSecretSaving(true);
    setAppConnectorError(null);
    setAppConnectorStatus(null);
    try {
      await accomplish.setAppConnectorExtensionSecret(
        selectedAppConnector.definition.id,
        secret,
        selectedAppConnector.config.instanceId
      );
      setAppConnectorSecretInput('');
      setAppConnectorStatus(`Secret saved for ${selectedAppConnector.definition.name}.`);
      await refreshAppConnectorExtensions();
    } catch (err) {
      setAppConnectorError(err instanceof Error ? err.message : 'Unable to save app connector secret.');
    } finally {
      setAppConnectorSecretSaving(false);
    }
  };

  const handleGenerateAppConnectorSecret = async () => {
    const accomplish = getAccomplish();
    if (!selectedAppConnector) return;
    setAppConnectorSecretSaving(true);
    setAppConnectorError(null);
    setAppConnectorStatus(null);
    try {
      const result = await accomplish.generateAppConnectorExtensionSecret(
        selectedAppConnector.definition.id,
        selectedAppConnector.config.instanceId
      );
      if (result?.secret) {
        setAppConnectorSecretInput(result.secret);
        await navigator.clipboard.writeText(result.secret);
      }
      setAppConnectorStatus(`Generated secret for ${selectedAppConnector.definition.name}.`);
      await refreshAppConnectorExtensions();
    } catch (err) {
      setAppConnectorError(err instanceof Error ? err.message : 'Unable to generate app connector secret.');
    } finally {
      setAppConnectorSecretSaving(false);
    }
  };

  const handleClearAppConnectorSecret = async () => {
    const accomplish = getAccomplish();
    if (!selectedAppConnector) return;
    setAppConnectorSecretSaving(true);
    setAppConnectorError(null);
    setAppConnectorStatus(null);
    try {
      await accomplish.clearAppConnectorExtensionSecret(
        selectedAppConnector.definition.id,
        selectedAppConnector.config.instanceId
      );
      setAppConnectorSecretInput('');
      setAppConnectorStatus(`Secret cleared for ${selectedAppConnector.definition.name}.`);
      await refreshAppConnectorExtensions();
    } catch (err) {
      setAppConnectorError(err instanceof Error ? err.message : 'Unable to clear app connector secret.');
    } finally {
      setAppConnectorSecretSaving(false);
    }
  };

  const handleTestAppConnectorRuntime = async () => {
    const accomplish = getAccomplish();
    if (!selectedAppConnector) return;
    setAppConnectorRuntimeTesting(true);
    setAppConnectorError(null);
    setAppConnectorStatus(null);
    try {
      const result = await accomplish.testAppConnectorRuntime(
        selectedAppConnector.definition.id,
        selectedAppConnector.config.instanceId
      );
      setAppConnectorRuntimeTestResult(result);
      setAppConnectorStatus(result.ok ? `${selectedAppConnector.definition.name} test passed.` : null);
      if (!result.ok) {
        setAppConnectorError(result.detail);
      }
      await refreshAppConnectorExtensions();
    } catch (err) {
      setAppConnectorError(err instanceof Error ? err.message : 'Unable to test app connector runtime.');
    } finally {
      setAppConnectorRuntimeTesting(false);
    }
  };

  const handleCreateAppConnectorInstance = async () => {
    const accomplish = getAccomplish();
    const connectorId = appConnectorCreateType.trim();
    if (!connectorId) return;
    setAppConnectorInstanceCreating(true);
    setAppConnectorError(null);
    setAppConnectorStatus(null);
    try {
      const result = await accomplish.createAppConnectorExtensionInstance(
        connectorId,
        appConnectorCreateName.trim() || undefined
      );
      const runtimeKey = result?.state?.runtimeKey || '';
      await refreshAppConnectorExtensions();
      if (runtimeKey) {
        setAppConnectorSelectedId(runtimeKey);
      }
      setAppConnectorCreateName('');
      setAppConnectorStatus(`Created ${result?.state?.definition?.name ?? connectorId} instance.`);
    } catch (err) {
      setAppConnectorError(err instanceof Error ? err.message : 'Unable to create app connector instance.');
    } finally {
      setAppConnectorInstanceCreating(false);
    }
  };

  const handleDeleteAppConnectorInstance = async () => {
    const accomplish = getAccomplish();
    if (!selectedAppConnector) return;
    setAppConnectorInstanceDeleting(true);
    setAppConnectorError(null);
    setAppConnectorStatus(null);
    try {
      await accomplish.deleteAppConnectorExtensionInstance(
        selectedAppConnector.definition.id,
        selectedAppConnector.config.instanceId
      );
      const removedRuntimeKey = selectedAppConnector.runtimeKey;
      await refreshAppConnectorExtensions();
      setAppConnectorSelectedId((prev) => (prev === removedRuntimeKey ? '' : prev));
      setAppConnectorStatus(`Deleted instance for ${selectedAppConnector.definition.name}.`);
    } catch (err) {
      setAppConnectorError(err instanceof Error ? err.message : 'Unable to delete app connector instance.');
    } finally {
      setAppConnectorInstanceDeleting(false);
    }
  };

  const allowTailscaleToggleDisabled = gatewayTailscaleMode !== 'serve' || gatewayAuthMode === 'password';
  const localGatewayUrl =
    gatewayStatus?.localUrl || automationInfo?.localUrl || automationInfo?.webhookUrl || 'http://127.0.0.1:18888';
  const localWebhookUrl = automationInfo?.localUrl || automationInfo?.webhookUrl || '';
  const lanWebhookUrls = automationInfo?.lanUrls ?? [];
  const publicWebhookUrl = automationInfo?.publicUrl ?? null;
  const publicOAuthBaseUrl = publicWebhookUrl || gatewayStatus?.tailscaleUrl || null;
  const oauthCallbackPath = '/api/opendeskmate/callback';
  const oauthDesktopCallbackUrl = 'accomplish://callback';
  const oauthLoopbackBaseUrl = localWebhookUrl || 'http://127.0.0.1:18888';
  const oauthLoopbackCallbackUrl = `${oauthLoopbackBaseUrl.replace(/\/+$/, '')}${oauthCallbackPath}`;
  const oauthPublicCallbackUrl = publicOAuthBaseUrl
    ? `${publicOAuthBaseUrl.replace(/\/+$/, '')}${oauthCallbackPath}`
    : '';

  const handleCopyWebhook = async () => {
    const url = automationInfo?.localUrl || automationInfo?.webhookUrl;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch (err) {
      console.warn('Failed to copy webhook URL', err);
    }
  };

  const handleCopyAppConnectorOAuthRedirectUris = async () => {
    const redirectUris = [
      oauthDesktopCallbackUrl,
      oauthLoopbackCallbackUrl,
      ...(oauthPublicCallbackUrl ? [oauthPublicCallbackUrl] : []),
      'https://your-host/api/opendeskmate/callback',
      'https://your-tailnet-host/api/opendeskmate/callback',
      'https://203.0.113.10/api/opendeskmate/callback',
    ];
    try {
      await navigator.clipboard.writeText(redirectUris.join('\n'));
      setAppConnectorError(null);
      setAppConnectorStatus('Copied OAuth redirect URIs to clipboard.');
    } catch (err) {
      setAppConnectorError(err instanceof Error ? err.message : 'Failed to copy OAuth redirect URIs.');
    }
  };

  const handleOpenAppConnectorOAuthAuthorizeUrl = async () => {
    const url = appConnectorOauthAuthorizeUrl.trim();
    if (!url) return;
    try {
      await getAccomplish().openExternal(url);
    } catch (err) {
      setAppConnectorError(err instanceof Error ? err.message : 'Unable to open OAuth authorize URL.');
    }
  };

  const handleCopyAppConnectorOAuthAuthorizeUrl = async () => {
    const url = appConnectorOauthAuthorizeUrl.trim();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setAppConnectorError(null);
      setAppConnectorStatus('Copied OAuth authorize URL.');
    } catch (err) {
      setAppConnectorError(err instanceof Error ? err.message : 'Unable to copy OAuth authorize URL.');
    }
  };

  const handleOpenWebchat = async () => {
    const url = automationInfo?.localUrl || automationInfo?.webhookUrl;
    if (!url) return;
    const accomplish = getAccomplish();
    try {
      await accomplish.openExternal(url);
    } catch (err) {
      console.warn('Failed to open webchat', err);
    }
  };

  const runDoctorChecks = async () => {
    const accomplish = getAccomplish();
    setDoctorRunning(true);

    try {
      const [model, apiKeys, ollamaConfig, skills] = await Promise.all([
        accomplish.getSelectedModel(),
        accomplish.getAllApiKeys(),
        accomplish.getOllamaConfig(),
        accomplish.getSkillsStatus(),
      ]);

      const hasApiKey = Object.values(apiKeys).some((entry) => entry.exists);
      const usingOllama = model?.provider === 'ollama' || !!ollamaConfig?.enabled;

      const checks: DoctorCheck[] = [];

      if (model?.model) {
        checks.push({
          id: 'model',
          title: 'Model selection',
          status: 'ok',
          message: `${model.model} is selected.`,
        });
      } else {
        checks.push({
          id: 'model',
          title: 'Model selection',
          status: 'error',
          message: 'No model selected yet.',
        });
      }

      if (usingOllama) {
        if (ollamaConfig?.baseUrl) {
          const result = await accomplish.testOllamaConnection(ollamaConfig.baseUrl);
          checks.push({
            id: 'ollama',
            title: 'Ollama connection',
            status: result.success ? 'ok' : 'warning',
            message: result.success
              ? `Connected to ${ollamaConfig.baseUrl}`
              : result.error || 'Unable to connect to Ollama.',
          });
        } else {
          checks.push({
            id: 'ollama',
            title: 'Ollama connection',
            status: 'warning',
            message: 'Ollama is selected but no server URL is configured.',
          });
        }
      } else {
        checks.push({
          id: 'api-keys',
          title: 'API keys',
          status: hasApiKey ? 'ok' : 'warning',
          message: hasApiKey ? 'At least one API key is configured.' : 'No API keys saved yet.',
        });
      }

      const requiredMissing = REQUIRED_SKILLS.filter((skillId) => {
        const entry = skills.find((skill) => skill.id === skillId);
        return !entry?.installed;
      });

      checks.push({
        id: 'skills',
        title: 'Core skills',
        status: requiredMissing.length === 0 ? 'ok' : 'warning',
        message: requiredMissing.length === 0
          ? 'Core skills are installed.'
          : `Missing: ${requiredMissing.join(', ')}`,
      });

      setDoctorChecks(checks);
    } catch (err) {
      console.error('Doctor checks failed:', err);
      setDoctorChecks([
        {
          id: 'doctor-error',
          title: 'Diagnostics',
          status: 'error',
          message: 'Unable to run diagnostics.',
        },
      ]);
    } finally {
      setDoctorRunning(false);
    }
  };

  const formatBytes = (bytes: number): string => {
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(1)} GB`;
  };

  const scheduleFallbackWorkspace = activeAgent?.workspaceRoot || workspaceRoot || null;

  const badgeIconMap = NODE_BADGE_ICONS.reduce<Record<string, (typeof NODE_BADGE_ICONS)[number]['Icon']>>(
    (acc, item) => {
      acc[item.id] = item.Icon;
      return acc;
    },
    {}
  );

  const resolveBadgeColor = (nodeId: string, fallback?: string) =>
    nodeBadgeColorEdits[nodeId] ?? fallback ?? '';

  const resolveBadgeIcon = (nodeId: string, fallback?: string) =>
    nodeBadgeIconEdits[nodeId] ?? fallback ?? 'monitor';

  const getReadableTextColor = (hex: string) => {
    const normalized = hex.replace('#', '');
    if (normalized.length !== 6) return '#0f172a';
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return luminance > 0.5 ? '#0f172a' : '#ffffff';
  };

  const describeNodeLastSeen = (lastConnectedAtMs?: number | null) => {
    if (!lastConnectedAtMs) return 'Never connected';
    const deltaMs = Date.now() - lastConnectedAtMs;
    if (deltaMs < 20_000) return 'Online now';
    if (deltaMs < 60_000) return `Seen ${Math.round(deltaMs / 1000)}s ago`;
    if (deltaMs < 60 * 60 * 1000) return `Seen ${Math.round(deltaMs / 60000)}m ago`;
    return `Seen ${Math.round(deltaMs / (60 * 60 * 1000))}h ago`;
  };

  const formatNodeCommandError = (err: unknown, action: string) => {
    if (err instanceof Error && err.message.includes('timed out')) {
      return `Timed out waiting for ${action}. Make sure the companion page is open and authorized (Access token required if enabled).`;
    }
    return err instanceof Error ? err.message : `Unable to ${action}.`;
  };

  const usageProviders = remoteModelProviders.map((entry) => ({ id: entry.id, name: entry.name }));
  const usageCurrencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'] as const;

  const updateUsagePricing = (updater: (prev: UsagePricingSettings) => UsagePricingSettings) => {
    setUsagePricingError(null);
    setUsagePricing((prev) => {
      const base: UsagePricingSettings =
        prev ?? { currency: 'USD', updatedAt: new Date().toISOString(), providers: [] };
      return updater(base);
    });
  };

  const handleSaveUsagePricing = async () => {
    if (!usagePricing) return;
    setUsagePricingSaving(true);
    setUsagePricingError(null);
    try {
      const saved = await getAccomplish().setUsagePricing({
        ...usagePricing,
        updatedAt: new Date().toISOString(),
      });
      setUsagePricing(saved);
    } catch (err) {
      console.error('Failed to save usage pricing:', err);
      setUsagePricingError('Unable to save pricing settings.');
    } finally {
      setUsagePricingSaving(false);
    }
  };

  const openAutoFillPicker = () => {
    // Default selections: provider defaults + models used
    const next = new Set<string>();
    for (const p of usageProviders) {
      next.add(`${p.id}:default`);
      const models = usageModelsUsed?.[p.id] ?? [];
      for (const m of models) next.add(`${p.id}:${m}`);
    }
    setUsageAutofillTargets(next);
    setUsageAutofillResult(null);
    setUsageAutofillOverwrite(false);
    setUsageAutofillStep('pick');
    setUsageAutofillOpen(true);
  };

  const handleAutoFillUsagePricing = async () => {
    setUsageAutofillLoading(true);
    setUsagePricingError(null);
    try {
      const targets = usageAutofillTargets.size > 0
        ? Array.from(usageAutofillTargets.values()).map((t) => {
          const [provider, model] = t.split(':', 2);
          return { provider, model: model === 'default' ? null : model };
        })
        : [];
      const result = await getAccomplish().autoFillUsagePricingWithAI({
        currency: (usagePricing?.currency ?? 'USD') as any,
        targets: targets as any,
      });
      setUsageAutofillResult(result);
      setUsageAutofillStep('preview');
    } catch (err) {
      console.error('Failed to auto-fill pricing:', err);
      setUsagePricingError('Unable to auto-fill pricing.');
    } finally {
      setUsageAutofillLoading(false);
    }
  };

  const applyUsageAutofill = () => {
    if (!usageAutofillResult) return;
    updateUsagePricing((prev) => {
      // Do not change currency unless the user already set it (we send current currency in request).
      const nextCurrency = prev.currency;

      const suggestions = usageAutofillResult.providers ?? [];
      const nextProviders = prev.providers.slice();

      for (const s of suggestions) {
        const provider = s.provider;
        const model = s.model ?? null;
        const effectiveFrom = s.effectiveFrom ?? null;
        const idx = nextProviders.findIndex((r) =>
          r.provider === provider &&
          (r.model ?? null) === model &&
          (r.effectiveFrom ?? null) === effectiveFrom
        );

        if (idx === -1) {
          nextProviders.push(s);
          continue;
        }

        if (usageAutofillOverwrite) {
          nextProviders[idx] = s;
          continue;
        }

        const existing = nextProviders[idx];
        nextProviders[idx] = {
          ...existing,
          inputCostPer1m: existing.inputCostPer1m ?? s.inputCostPer1m,
          outputCostPer1m: existing.outputCostPer1m ?? s.outputCostPer1m,
          // keep existing effectiveFrom (same key), and preserve manual source if present
          pricingSource: existing.pricingSource,
          pricingUpdatedAt: existing.pricingUpdatedAt,
          createdAt: existing.createdAt,
          model: existing.model ?? s.model ?? null,
        };
      }

      return {
        ...prev,
        currency: nextCurrency,
        providers: nextProviders,
        updatedAt: new Date().toISOString(),
      };
    });
    setUsageAutofillOpen(false);
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        SETTINGS_SECTION_EXPANDED_STORAGE_KEY,
        JSON.stringify(expandedSettingsSections)
      );
    } catch {
      // Ignore storage failures; settings still work for the current session.
    }
  }, [expandedSettingsSections]);

  const getSettingsSectionSummary = (heading: string): string | null => {
    switch (heading) {
      case 'Model & API settings':
      case 'Model': {
        const modelLabel = selectedModel
          ? `${getProviderDisplayName(selectedModel.provider)} / ${selectedModel.model}`
          : 'No default model selected';
        return `${modelLabel} • ${agentSpeedMode} mode • ${savedKeys.length} API key${savedKeys.length === 1 ? '' : 's'} • ${customModelProviders.length} custom provider${customModelProviders.length === 1 ? '' : 's'}`;
      }
      case 'Bring Your Own Model/API Key':
        return `${savedKeys.length} API key${savedKeys.length === 1 ? '' : 's'} • ${customModelProviders.length} custom provider${customModelProviders.length === 1 ? '' : 's'}`;
      case 'Skills': {
        const installedCount = skillsStatus.filter((skill) => skill.installed).length;
        const totalCount = skillsStatus.length;
        const userSkillCount = userSkillsReport?.skills?.length ?? 0;
        return `${installedCount}/${totalCount} bundled skills installed • ${userSkillCount} user skill${userSkillCount === 1 ? '' : 's'}`;
      }
      case 'Automations': {
        const bindLabel = webhookBindMode === 'all' ? 'all interfaces' : 'localhost only';
        return `${schedules.length} schedule${schedules.length === 1 ? '' : 's'} • ${gatewayAuthMode} auth • ${bindLabel}`;
      }
      case 'Discord (pilot)':
        return `${discordEnabled ? 'Enabled' : 'Disabled'} • Token ${discordTokenSet ? 'set' : 'missing'}`;
      case 'Telegram (pilot)':
        return `${telegramEnabled ? 'Enabled' : 'Disabled'} • Token ${telegramTokenSet ? 'set' : 'missing'}`;
      case 'Messaging Connector Extensions': {
        const secretCount = gatewayConnectorExtensions.filter((entry) => entry.secretSet).length;
        return `${gatewayConnectorEnabledCount}/${gatewayConnectorExtensions.length} enabled • ${secretCount} secret${secretCount === 1 ? '' : 's'} set`;
      }
      case 'App Connector Extensions': {
        const secretCount = appConnectorExtensions.filter((entry) => entry.secretSet).length;
        return `${appConnectorEnabledCount}/${appConnectorExtensions.length} enabled • ${secretCount} secret${secretCount === 1 ? '' : 's'} set`;
      }
      case 'Voice Wake + Talk Mode': {
        const enabledToggles = [voiceWakeEnabled, voiceWakeTalkModeEnabled, voiceWakeAutoStart].filter(Boolean).length;
        return `${enabledToggles} wake/talk toggle${enabledToggles === 1 ? '' : 's'} on • ${voiceWakeSttEngine} STT`;
      }
      case 'Mobile node companions (pilot)': {
        const pairedCount = nodePairing?.paired?.length ?? 0;
        const pendingCount = nodePairing?.pending?.length ?? 0;
        return `${mobileNodesEnabled ? 'Enabled' : 'Disabled'} • ${pairedCount} paired • ${pendingCount} pending`;
      }
      case 'Agents': {
        const defaultAgentName = agents.find((agent) => agent.id === defaultAgentId)?.name ?? 'None';
        return `${agents.length} agent${agents.length === 1 ? '' : 's'} • Active: ${activeAgent?.name || 'None'} • Default: ${defaultAgentName}`;
      }
      case 'Startup': {
        const enabledToggles = [runInBackground, launchAtLogin].filter(Boolean).length;
        return `${enabledToggles} startup toggle${enabledToggles === 1 ? '' : 's'} enabled`;
      }
      case 'Build Mode Safety':
        return buildDiffEnforcementMode === 'auto-apply'
          ? 'Full Auto-Apply (no approval)'
          : buildDiffEnforcementMode === 'preview-only'
            ? 'Preview Only (no approval)'
            : 'Approval Mode (safe)';
      case 'Workspace Defaults':
        return workspaceRoot || 'No global workspace default set';
      case 'Memory (User Context)': {
        const longTermChars = memoryLongTerm.trim().length;
        const dailyChars = memoryDaily.trim().length;
        return `${longTermChars} long-term chars • ${dailyChars} daily chars`;
      }
      case 'API usage estimate':
      case 'Usage estimate': {
        const rowCount = usagePricing?.providers?.length ?? 0;
        return `${rowCount} pricing row${rowCount === 1 ? '' : 's'} • ${(usagePricing?.currency || 'USD').toUpperCase()}`;
      }
      case 'Browser Profile':
        return browserProfile === 'default' ? 'Using default profile' : `Profile: ${browserProfile}`;
      case 'Developer':
        return debugMode ? 'Debug mode enabled' : 'Debug mode disabled';
      case 'Doctor': {
        const okCount = doctorChecks.filter((check) => check.status === 'ok').length;
        const warningCount = doctorChecks.filter((check) => check.status === 'warning').length;
        const errorCount = doctorChecks.filter((check) => check.status === 'error').length;
        if (doctorChecks.length === 0) return 'No checks run yet';
        return `${okCount} ok • ${warningCount} warning${warningCount === 1 ? '' : 's'} • ${errorCount} error${errorCount === 1 ? '' : 's'}`;
      }
      case 'About':
        return `Version ${appVersion || '0.1.0'} • ${appPlatform || 'platform unknown'}`;
      default:
        return null;
    }
  };

  const keepCollapsedContentMountedForTests =
    typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';
  const isSettingsSectionExpandedByHeading = (heading: string): boolean =>
    keepCollapsedContentMountedForTests || Boolean(expandedSettingsSections[getSettingsSectionKey(heading)]);

  const renderCollapsibleSettingsSections = (children: ReactNode): ReactNode => {
    const items = Children.toArray(children).flatMap((child) => {
      if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) {
        return Children.toArray(child.props.children);
      }
      return [child];
    });

    const sections: Array<{
      key: string;
      sectionId: string;
      heading: ReactElement;
      headingText: string;
      sectionClass: string;
      content: ReactNode[];
      summary: string | null;
    }> = [];

    for (const [index, child] of items.entries()) {
      if (!isValidElement<{ children?: ReactNode; className?: string }>(child)) {
        continue;
      }

      const sectionChildren = Children.toArray(child.props.children);
      const headingIndex = sectionChildren.findIndex(
        (entry) => isValidElement(entry) && entry.type === 'h2'
      );
      if (headingIndex < 0) {
        continue;
      }

      const headingNode = sectionChildren[headingIndex];
      if (!isValidElement<{ className?: string; children?: ReactNode }>(headingNode)) {
        continue;
      }

      const headingText = extractNodeText(headingNode.props.children).replace(/\s+/g, ' ').trim();
      if (!headingText) {
        continue;
      }

      const sectionId = getSettingsSectionKey(headingText);
      const originalHeadingClass =
        typeof headingNode.props.className === 'string' ? headingNode.props.className : '';
      const normalizedHeadingClass = originalHeadingClass
        .replace(/\bmb-\d+\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const headingClass = [normalizedHeadingClass, 'm-0 text-base font-medium text-foreground']
        .filter(Boolean)
        .join(' ');
      const heading = cloneElement(headingNode as ReactElement<{ className?: string }>, {
        className: headingClass,
      });
      const sectionClass =
        typeof child.props.className === 'string' && child.props.className.trim().length > 0
          ? child.props.className
          : '';
      const summary = getSettingsSectionSummary(headingText);

      sections.push({
        key: String(child.key ?? sectionId),
        sectionId,
        heading,
        headingText,
        sectionClass,
        content: sectionChildren.filter((_, childIndex) => childIndex !== headingIndex),
        summary,
      });
    }

    const allSectionIds = sections.map((section) => section.sectionId);
    const isNonCollapsibleSection = (section: { headingText: string }) => section.headingText === 'About';
    const normalizedQuery = deferredSettingsSectionQuery.trim().toLowerCase();
    const filteredSections = normalizedQuery
      ? sections.filter((section) => {
          const haystack = `${section.headingText} ${section.summary || ''}`.toLowerCase();
          return haystack.includes(normalizedQuery);
        })
      : sections;
    const allExpanded =
      sections.length > 0
      && sections.every((section) => (
        isNonCollapsibleSection(section) || Boolean(expandedSettingsSections[section.sectionId])
      ));

    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-border/70 bg-background/30 px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setExpandedSettingsSections(
                    Object.fromEntries(allSectionIds.map((sectionId) => [sectionId, true]))
                  )
                }
                disabled={allSectionIds.length === 0 || allExpanded}
              >
                Expand all
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setExpandedSettingsSections({})}
                disabled={allSectionIds.length === 0 || !Object.values(expandedSettingsSections).some(Boolean)}
              >
                Collapse all
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              Showing {filteredSections.length} of {sections.length} section{sections.length === 1 ? '' : 's'}
            </div>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px]">
            <input
              type="text"
              value={settingsSectionQuery}
              onChange={(e) => setSettingsSectionQuery(e.target.value)}
              placeholder="Search sections..."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <select
              value={settingsSectionJumpTarget}
              onChange={(e) => {
                const nextSectionId = e.target.value;
                setSettingsSectionJumpTarget(nextSectionId);
                if (!nextSectionId) return;
                setExpandedSettingsSections((prev) => ({
                  ...prev,
                  [nextSectionId]: true,
                }));
                requestAnimationFrame(() => {
                  settingsSectionRefs.current[nextSectionId]?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start',
                  });
                  setSettingsSectionJumpTarget('');
                });
              }}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Jump to section...</option>
              {filteredSections.map((section) => (
                <option key={section.sectionId} value={section.sectionId}>
                  Go to: {section.headingText}
                </option>
              ))}
            </select>
          </div>
        </div>

        {filteredSections.length === 0 && (
          <div className="rounded-xl border border-dashed border-border/70 px-4 py-5 text-sm text-muted-foreground">
            No settings sections match &quot;{settingsSectionQuery.trim()}&quot;.
          </div>
        )}

        {filteredSections.map((section) => {
          const isForcedExpanded = isNonCollapsibleSection(section);
          const isExpanded = isForcedExpanded || Boolean(expandedSettingsSections[section.sectionId]);
          const shouldRenderContent = keepCollapsedContentMountedForTests || isExpanded;

          return (
            <section
              id={section.sectionId}
              ref={(element) => {
                settingsSectionRefs.current[section.sectionId] = element;
              }}
              key={section.key}
              className={['rounded-xl border border-border/70 bg-background/40 px-4 py-3', section.sectionClass]
                .filter(Boolean)
                .join(' ')}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {section.heading}
                  {!isExpanded && section.summary && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">{section.summary}</p>
                  )}
                </div>
                {!isForcedExpanded && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setExpandedSettingsSections((prev) => ({
                        ...prev,
                        [section.sectionId]: !prev[section.sectionId],
                      }))
                    }
                    className="shrink-0"
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <span className="ml-1">{isExpanded ? 'Collapse' : 'Expand'}</span>
                  </Button>
                )}
              </div>
              {shouldRenderContent && <div className="mt-4">{section.content}</div>}
            </section>
          );
        })}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[92vw] max-w-2xl max-h-[85vh] overflow-hidden overflow-x-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-4 flex-1 min-h-0 overflow-y-auto pr-1">
          {renderCollapsibleSettingsSections(
            <>
          <section>
            <h2 className="mb-4 text-base font-medium text-foreground">
              Model & API settings
              <InfoTip text="Select the default model used for new tasks. Requires a valid API key (or local provider like Ollama). If you choose Ollama, install Ollama and run it locally first." />
            </h2>
            {isSettingsSectionExpandedByHeading('Model & API settings') && (
            <>
            <div className="rounded-lg border border-border bg-card p-5">
              <div className="flex gap-2 mb-5">
                <ButtonTip text="Use cloud providers (requires API keys).">
                  <button
                    onClick={() => setActiveTab('cloud')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      activeTab === 'cloud'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Cloud Providers
                  </button>
                </ButtonTip>
                <ButtonTip text="Use local models (requires Ollama running).">
                  <button
                    onClick={() => setActiveTab('local')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      activeTab === 'local'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Local Models
                  </button>
                </ButtonTip>
              </div>

              {activeTab === 'cloud' ? (
                <>
                  <p className="mb-4 text-sm text-muted-foreground leading-relaxed">
                    Select a cloud AI model. Requires an API key for the provider.
                  </p>
                  {loadingModel ? (
                    <div className="h-10 animate-pulse rounded-md bg-muted" />
                  ) : (
                    <div className="grid gap-1">
                      <label className="text-xs text-muted-foreground">
                        Cloud model
                        <InfoTip text="Choose the default cloud model. Ensure its provider API key is configured." />
                      </label>
                      <select
                        data-testid="settings-model-select"
                        value={selectedModel?.provider !== 'ollama' ? selectedModel?.model || '' : ''}
                        onChange={(e) => handleModelChange(e.target.value)}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="" disabled>Select a model...</option>
                        {remoteModelProviders.map((provider) => {
                          const hasApiKey =
                            apiKeyStatus?.[provider.id]?.exists ||
                            savedKeys.some((k) => k.provider === provider.id);
                          return (
                            <optgroup key={provider.id} label={`${provider.name} models`}>
                              {provider.models.map((model) => (
                                <option
                                  key={model.fullId}
                                  value={model.fullId}
                                >
                                  {model.displayName}{!hasApiKey ? ' (No API key)' : ''}
                                </option>
                              ))}
                            </optgroup>
                          );
                        })}
                      </select>
                    </div>
                  )}
                  {modelStatusMessage && (
                    <p className="mt-3 text-sm text-success">{modelStatusMessage}</p>
                  )}
                  <div className="mt-4 grid gap-1">
                    <label className="text-xs text-muted-foreground">
                      Speed mode
                      <InfoTip text="Fast prioritizes overall task completion time. Balanced uses stronger models for complex prompts. Deep prefers strongest model quality." />
                    </label>
                    <select
                      value={agentSpeedMode}
                      onChange={(e) => void handleSpeedModeChange(e.target.value as 'fast' | 'balanced' | 'deep')}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      disabled={agentSpeedModeSaving}
                    >
                      <option value="fast">Fast (lowest latency)</option>
                      <option value="balanced">Balanced</option>
                      <option value="deep">Deep (best quality)</option>
                    </select>
                  </div>
                  {selectedModel
                    && selectedModel.provider !== 'ollama'
                    && remoteModelProviders.find((entry) => entry.id === selectedModel.provider)?.requiresApiKey
                    && !(
                      apiKeyStatus?.[selectedModel.provider]?.exists ||
                      savedKeys.some((k) => k.provider === selectedModel.provider)
                    ) && (
                    <p className="mt-3 text-sm text-warning">
                      No API key configured for {getProviderDisplayName(selectedModel.provider)}. Add one below.
                    </p>
                  )}

                  <div className="mt-4 flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2">
                    <div className="text-xs text-muted-foreground">
                      Context limits are editable per model (defaults are conservative).
                    </div>
                    <button
                      type="button"
                      onClick={openModelLimits}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Edit limits
                    </button>
                  </div>
                  {modelLimitsError && (
                    <p className="mt-2 text-xs text-destructive">{modelLimitsError}</p>
                  )}
                </>
              ) : (
                <>
                  <p className="mb-4 text-sm text-muted-foreground leading-relaxed">
                    Connect to a local Ollama server to use models running on your machine.
                  </p>

                  <div className="mb-4">
                    <label className="mb-2 block text-sm font-medium text-foreground">
                      Ollama Server URL
                      <InfoTip text="Install Ollama, start the service, then enter its base URL (default http://localhost:11434)." />
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={ollamaUrl}
                        onChange={(e) => {
                          setOllamaUrl(e.target.value);
                          setOllamaConnected(false);
                          setOllamaModels([]);
                        }}
                        placeholder="http://localhost:11434"
                        className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                      />
                      <ButtonTip text="Test connection and fetch available local models.">
                        <button
                          onClick={handleTestOllama}
                          disabled={testingOllama}
                          className="rounded-md bg-muted px-4 py-2 text-sm font-medium hover:bg-muted/80 disabled:opacity-50"
                        >
                          {testingOllama ? 'Testing...' : 'Test'}
                        </button>
                      </ButtonTip>
                    </div>
                  </div>

                  {ollamaConnected && (
                    <div className="mb-4 flex items-center gap-2 text-sm text-success">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Connected - {ollamaModels.length} model{ollamaModels.length !== 1 ? 's' : ''} available
                    </div>
                  )}

                  {ollamaError && (
                    <div className="mb-4 flex items-center gap-2 text-sm text-destructive">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      {ollamaError}
                    </div>
                  )}

                  {ollamaConnected && ollamaModels.length > 0 && (
                    <div className="mb-4">
                    <label className="mb-2 block text-sm font-medium text-foreground">
                      Select Model
                      <InfoTip text="Choose which local Ollama model to use for new tasks." />
                    </label>
                      <select
                        value={selectedOllamaModel}
                        onChange={(e) => setSelectedOllamaModel(e.target.value)}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        {ollamaModels.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.displayName} ({formatBytes(model.size)})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {ollamaConnected && selectedOllamaModel && (
                    <ButtonTip text="Save and set this local model as the default.">
                      <button
                        onClick={handleSaveOllama}
                        disabled={savingOllama}
                        className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        {savingOllama ? 'Saving...' : 'Use This Model'}
                      </button>
                    </ButtonTip>
                  )}

                  {!ollamaConnected && !ollamaError && (
                    <p className="text-sm text-muted-foreground">
                      Make sure{' '}
                      <a
                        href="https://ollama.ai"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Ollama
                      </a>{' '}
                      is installed and running, then click Test to connect.
                    </p>
                  )}

                  {selectedModel?.provider === 'ollama' && (
                    <div className="mt-4 rounded-lg bg-muted p-3">
                      <p className="text-sm text-foreground">
                        <span className="font-medium">Currently using:</span>{' '}
                        {selectedModel.model.replace('ollama/', '')}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>

          {modelLimitsOpen && (
          <Dialog open={modelLimitsOpen} onOpenChange={setModelLimitsOpen}>
            <DialogContent className="w-[92vw] max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
              <DialogHeader>
                <DialogTitle>Model context limits</DialogTitle>
              </DialogHeader>

              <div className="flex-1 overflow-auto space-y-4">
                <p className="text-sm text-muted-foreground">
                  These limits drive the context window indicator and trimming logic. Defaults are conservative; you can raise them if you know a model supports more.
                </p>

                {modelLimitsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading model limits...
                  </div>
                ) : (
                  <div className="space-y-4">
                    {modelProviders.filter((provider) => provider.id !== 'ollama').map((provider) => (
                      <div key={provider.id} className="rounded-lg border border-border bg-card p-4">
                        <div className="font-medium text-foreground">Provider: {provider.name}</div>
                        <div className="mt-3 space-y-3">
                          {provider.models.map((model) => {
                            const defaultLimit = model.contextWindow ?? 128000;
                            const effective = modelLimitOverrides[model.fullId]?.contextWindowTokens ?? defaultLimit;
                            const override = modelLimitOverrides[model.fullId]?.contextWindowTokens;
                            const saving = Boolean(modelLimitsSaving[model.fullId]);
                            return (
                              <div key={model.fullId} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-md border border-border/60 p-3">
                                <div className="min-w-0">
                                  <div className="text-sm font-medium text-foreground">{model.displayName}</div>
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    Default: <code className="rounded bg-muted px-1 py-0.5">{defaultLimit.toLocaleString()}</code>
                                    {' '}• Effective: <code className="rounded bg-muted px-1 py-0.5">{effective.toLocaleString()}</code>
                                    {typeof override === 'number' ? ' • Overridden' : ''}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <input
                                    inputMode="numeric"
                                    value={modelLimitsEdits[model.fullId] ?? ''}
                                    onChange={(e) => setModelLimitsEdits((prev) => ({ ...prev, [model.fullId]: e.target.value }))}
                                    placeholder="Override (tokens)"
                                    className="w-40 rounded-md border border-input bg-background px-3 py-2 text-sm"
                                  />
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={saving}
                                    onClick={() => void saveModelLimit(model.fullId)}
                                  >
                                    {saving ? 'Saving…' : 'Save'}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={saving}
                                    onClick={() => void resetModelLimit(model.fullId)}
                                  >
                                    Reset
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {modelLimitsError && (
                  <div className="text-xs text-destructive">{modelLimitsError}</div>
                )}
              </div>

              <div className="mt-4 flex items-center justify-end gap-2">
                <Button variant="outline" onClick={() => setModelLimitsOpen(false)}>
                  Close
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          )}

          <div className="mt-4">
              <h3 className="mb-3 text-sm font-medium text-foreground">
                Bring Your Own Model/API Key
                <InfoTip text="Add API keys for providers (OpenAI/Anthropic/Google/etc.). Required for cloud models. Keys are stored locally on this machine." />
              </h3>
            {activeTab === 'cloud' ? (
            <div className="rounded-lg border border-border bg-card p-5">
              <p className="mb-5 text-sm text-muted-foreground leading-relaxed">
                Setup the API key and model for your own AI coworker.
              </p>

              <div className="mb-5">
                <label className="mb-2.5 block text-sm font-medium text-foreground">
                  Provider
                  <InfoTip text="Select which provider this API key belongs to." />
                </label>
                {apiKeyProviders.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No cloud providers available. Add one in the custom providers section below.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {apiKeyProviders.map((p) => (
                      <ButtonTip key={p.id} text={`Choose ${p.name} as the provider for this key.`}>
                        <button
                          onClick={() => {
                            analytics.trackSelectProvider(getApiKeyProviderLabel(String(p.id), p.name || String(p.id)));
                            setProvider(String(p.id));
                          }}
                          className={`rounded-xl border p-4 text-center transition-all duration-200 ease-accomplish ${
                            provider === p.id
                              ? 'border-primary bg-muted'
                              : 'border-border hover:border-ring'
                          }`}
                        >
                          <div className="font-medium text-foreground">
                            {getApiKeyProviderLabel(String(p.id), p.name)}
                          </div>
                        </button>
                      </ButtonTip>
                    ))}
                  </div>
                )}
              </div>

              <div className="mb-5">
                <label className="mb-2.5 block text-sm font-medium text-foreground">
                  {getProviderDisplayName(provider)} API Key
                  <InfoTip text="Paste the provider API key. Required for cloud models." />
                </label>
                <input
                  data-testid="settings-api-key-input"
                  type="password"
                  key={`api-key-${provider}`}
                  ref={apiKeyInputRef}
                  defaultValue={apiKey}
                  onBlur={(e) => setApiKey(e.target.value)}
                  placeholder={KNOWN_API_KEY_FORMATS[provider]?.placeholder || 'Paste API key'}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>

              {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
              {statusMessage && (
                <p className="mb-4 text-sm text-success">{statusMessage}</p>
              )}

              <ButtonTip text="Save this API key locally.">
                <button
                  className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  onClick={handleSaveApiKey}
                  disabled={isSaving || apiKeyProviders.length === 0}
                >
                  {isSaving ? 'Saving...' : 'Save API Key'}
                </button>
              </ButtonTip>

              {loadingKeys ? (
                <div className="mt-6 animate-pulse">
                  <div className="h-4 w-24 rounded bg-muted mb-3" />
                  <div className="h-14 rounded-xl bg-muted" />
                </div>
              ) : savedKeys.length > 0 && (
                <div className="mt-6">
                  <h3 className="mb-3 text-sm font-medium text-foreground">Saved Keys</h3>
                  <div className="space-y-2">
                    {savedKeys.map((key) => {
                      const providerConfig = modelProviders.find((p) => p.id === key.provider);
                      return (
                        <div
                          key={key.id}
                          className="flex items-center justify-between rounded-xl border border-border bg-muted p-3.5"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                              <span className="text-xs font-bold text-primary">
                                {providerConfig?.name.charAt(0) || key.provider.charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <div>
                              <div className="text-sm font-medium text-foreground">
                                {providerConfig?.name || key.provider}
                              </div>
                              <div className="text-xs text-muted-foreground font-mono">
                                {key.keyPrefix}
                              </div>
                            </div>
                          </div>
                          {keyToDelete === key.id ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">Are you sure?</span>
                              <button
                                onClick={() => {
                                  handleDeleteApiKey(key.id, key.provider);
                                  setKeyToDelete(null);
                                }}
                                className="rounded px-2 py-1 text-xs font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                              >
                                Yes
                              </button>
                              <button
                                onClick={() => setKeyToDelete(null)}
                                className="rounded px-2 py-1 text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <ButtonTip text="Remove API key.">
                              <button
                                onClick={() => setKeyToDelete(key.id)}
                                aria-label="Remove API key"
                                title="Remove API key"
                                className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors duration-200 ease-accomplish"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </ButtonTip>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="mt-6 rounded-xl border border-border bg-background/50 p-4 space-y-3">
                <div>
                  <h3 className="text-sm font-medium text-foreground">Custom providers</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Add OpenAI-compatible providers and models. Model format: one per line as
                    <code className="mx-1 rounded bg-muted px-1 py-0.5">id|display name|context window|max output|vision(true/false)</code>
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <label className="text-xs text-muted-foreground">
                      Provider id
                      <InfoTip text="Unique provider key (lowercase letters, numbers, hyphen/underscore). Used internally and in model IDs, for example: deepseek." />
                    </label>
                    <input
                      type="text"
                      key={`custom-provider-id-${editingCustomProviderId ?? 'new'}`}
                      ref={customProviderIdInputRef}
                      defaultValue={customProviderId}
                      onBlur={(e) => setCustomProviderId(e.target.value)}
                      placeholder="deepseek"
                      disabled={Boolean(editingCustomProviderId)}
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-70"
                    />
                  </div>
                  <div className="grid gap-1">
                    <label className="text-xs text-muted-foreground">
                      Display name
                      <InfoTip text="Friendly provider name shown in the UI, for example: DeepSeek." />
                    </label>
                    <input
                      type="text"
                      key={`custom-provider-name-${editingCustomProviderId ?? 'new'}`}
                      ref={customProviderNameInputRef}
                      defaultValue={customProviderName}
                      onBlur={(e) => setCustomProviderName(e.target.value)}
                      placeholder="DeepSeek"
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <div className="grid gap-1">
                    <label className="text-xs text-muted-foreground">
                      Base URL
                      <InfoTip text="OpenAI-compatible API base endpoint for this provider, usually ending in /v1 (for example: https://api.example.com/v1)." />
                    </label>
                    <input
                      type="text"
                      key={`custom-provider-base-url-${editingCustomProviderId ?? 'new'}`}
                      ref={customProviderBaseUrlInputRef}
                      defaultValue={customProviderBaseUrl}
                      onBlur={(e) => setCustomProviderBaseUrl(e.target.value)}
                      placeholder="https://api.example.com/v1"
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Use the OpenAI-compatible base endpoint (usually ending in <code>/v1</code>).
                    </p>
                    {customProviderBaseUrl.trim().match(/\/v\/?$/i) && (
                      <p className="text-[11px] text-amber-600">
                        This URL ends in <code>/v</code>. Most providers expect <code>/v1</code>.
                      </p>
                    )}
                  </div>
                  <label className="flex items-center gap-2 text-xs text-foreground pb-2">
                    <input
                      type="checkbox"
                      checked={customProviderRequiresApiKey}
                      onChange={(e) => setCustomProviderRequiresApiKey(e.target.checked)}
                    />
                    Requires API key
                    <InfoTip text="Enable for providers that require bearer/API-key auth. Disable only for local/open endpoints that do not require a key." />
                  </label>
                </div>

                <div className="grid gap-1">
                  <label className="text-xs text-muted-foreground">
                    Models
                    <InfoTip text="One model per line using: id|display name|context window|max output|vision(true/false). These are the models users can select for this provider." />
                  </label>
                  <p className="text-[11px] text-muted-foreground">
                    {CUSTOM_PROVIDER_MODELS_FORMAT_HELPER}
                  </p>
                  <textarea
                    key={`custom-provider-models-${editingCustomProviderId ?? 'new'}`}
                    ref={customProviderModelsTextRef}
                    defaultValue={customProviderModelsText}
                    onBlur={(e) => setCustomProviderModelsText(e.target.value)}
                    rows={5}
                    placeholder={'chat-model|Chat Model|128000|4096|true\nreasoner|Reasoner|64000|4096|false'}
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                  />
                  {hasCustomProviderModelInput && customProviderModelValidation.issues.length === 0 && (
                    <p className="text-[11px] text-success">
                      {customProviderModelValidation.models.length} model line
                      {customProviderModelValidation.models.length === 1 ? '' : 's'} valid.
                    </p>
                  )}
                  {hasCustomProviderModelInput && customProviderModelValidation.issues.length > 0 && (
                    <div className="rounded-md border border-destructive/25 bg-destructive/5 px-2.5 py-2">
                      <p className="text-[11px] font-medium text-destructive">Model validation issues:</p>
                      <div className="mt-1 space-y-1">
                        {customProviderModelValidation.issues.slice(0, 6).map((issue) => (
                          <p key={`${issue.line}-${issue.message}`} className="text-[11px] text-destructive">
                            {issue.message}
                          </p>
                        ))}
                        {customProviderModelValidation.issues.length > 6 && (
                          <p className="text-[11px] text-destructive">
                            +{customProviderModelValidation.issues.length - 6} more issue(s)
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  {customProviderVisionRows.length > 0 && (
                    <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
                      <p className="text-[11px] font-medium text-foreground">
                        Vision toggles
                        <InfoTip text="Marks whether each model supports image input (vision/multimodal). Enable only for models that can process images; leave off for text-only models." />
                      </p>
                      <div className="mt-1 space-y-1">
                        {customProviderVisionRows.map((row) => (
                          <label
                            key={`vision-toggle-${row.lineIndex}`}
                            className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground"
                          >
                            <span className="truncate">
                              Line {row.lineNumber}: {row.modelLabel}
                            </span>
                            <span className="inline-flex items-center gap-1.5 shrink-0">
                              <input
                                type="checkbox"
                                checked={row.supportsVision}
                                onChange={(e) =>
                                  toggleCustomProviderModelVision(row.lineIndex, e.target.checked)
                                }
                              />
                              <span className="font-mono text-foreground">
                                {row.supportsVision ? 'true' : 'false'}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {customProviderError && (
                  <p className="text-xs text-destructive">{customProviderError}</p>
                )}
                {customProviderStatus && (
                  <p className="text-xs text-success">{customProviderStatus}</p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => void handleSaveCustomProvider()}
                    disabled={customProviderSaving}
                  >
                    {customProviderSaving ? 'Saving...' : editingCustomProviderId ? 'Update provider' : 'Add provider'}
                  </Button>
                  {editingCustomProviderId && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={resetCustomProviderForm}
                      disabled={customProviderSaving}
                    >
                      Cancel edit
                    </Button>
                  )}
                </div>

                <div className="space-y-2">
                  {customModelProviders.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No custom providers configured.</p>
                  ) : (
                    customModelProviders.map((entry) => (
                      <div
                        key={entry.id}
                        className="rounded-lg border border-border/60 bg-card p-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="text-sm font-medium text-foreground">{entry.name}</div>
                            <div className="text-xs text-muted-foreground">
                              <code className="rounded bg-muted px-1 py-0.5">{entry.id}</code>
                              {' '}• {entry.baseUrl || 'No base URL'}
                              {' '}• {entry.requiresApiKey ? 'API key required' : 'No API key required'}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button size="sm" variant="outline" onClick={() => handleEditCustomProvider(entry)}>
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={deletingCustomProviderId === entry.id}
                              onClick={() => void handleDeleteCustomProvider(entry.id)}
                            >
                              {deletingCustomProviderId === entry.id ? 'Removing...' : 'Remove'}
                            </Button>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {entry.models.map((model) => (
                            <span
                              key={model.fullId}
                              className="rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground"
                            >
                              {model.displayName}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
            ) : (
            <div className="rounded-md border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
              Switch to Cloud Providers in the model tab to manage API keys and custom providers.
            </div>
            )}
          </div>
            </>
            )}
          </section>

          <section>
            <h2 className="mb-4 text-base font-medium text-foreground">
              API usage estimate
              <InfoTip text="Optional: configure token prices to estimate cost across all chats. This is informational only." />
            </h2>
            {isSettingsSectionExpandedByHeading('API usage estimate') && (
            <div className="rounded-lg border border-border bg-card p-5 space-y-5">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium text-foreground">Pricing</div>
                  <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                    Set input/output price per 1,000,000 tokens for each provider. Cost is hidden until pricing is set.
                  </p>
                </div>
                <div className="shrink-0">
                  <label className="text-xs text-muted-foreground">Currency</label>
                  <select
                    value={usagePricing?.currency ?? 'USD'}
                    onChange={(e) =>
                      updateUsagePricing((prev) => ({
                        ...prev,
                        currency: e.target.value as UsagePricingSettings['currency'],
                        updatedAt: new Date().toISOString(),
                      }))
                    }
                    className="mt-1 w-28 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    disabled={usagePricingLoading || usagePricingSaving}
                  >
                    {usageCurrencies.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {usagePricingLoading && !usagePricing ? (
                <div className="h-10 animate-pulse rounded-md bg-muted" />
              ) : (
                <div className="space-y-3">
                  {usageProviders.map((p) => {
                    const allRows = usagePricing?.providers ?? [];
                    const getLatestRow = (model: string | null) => {
                      return allRows
                        .filter((r) => r.provider === p.id && (r.model ?? null) === model)
                        .slice()
                        .sort((a, b) => {
                          const aMs = a.effectiveFrom ? Date.parse(a.effectiveFrom) : 0;
                          const bMs = b.effectiveFrom ? Date.parse(b.effectiveFrom) : 0;
                          return bMs - aMs;
                        })[0];
                    };

                    const upsertRow = (model: string | null, patch: Partial<UsagePricingSettings['providers'][number]>) => {
                      updateUsagePricing((prev) => {
                        const existing = prev.providers.filter((r) => r.provider === p.id && (r.model ?? null) === model).slice().sort((a, b) => {
                          const aMs = a.effectiveFrom ? Date.parse(a.effectiveFrom) : 0;
                          const bMs = b.effectiveFrom ? Date.parse(b.effectiveFrom) : 0;
                          return bMs - aMs;
                        })[0];

                        const nextRow: UsagePricingSettings['providers'][number] = {
                          provider: p.id,
                          model,
                          inputCostPer1m: existing?.inputCostPer1m ?? null,
                          outputCostPer1m: existing?.outputCostPer1m ?? null,
                          effectiveFrom: existing?.effectiveFrom ?? null,
                          pricingSource: existing?.pricingSource ?? 'manual',
                          pricingUpdatedAt: new Date().toISOString(),
                          createdAt: existing?.createdAt ?? new Date().toISOString(),
                          ...patch,
                        };

                        // Remove only the exact provider+model+effectiveFrom row we are replacing.
                        const nextProviders = prev.providers.filter((r) => !(
                          r.provider === p.id &&
                          (r.model ?? null) === model &&
                          (r.effectiveFrom ?? null) === (nextRow.effectiveFrom ?? null)
                        ));
                        nextProviders.push(nextRow);
                        return { ...prev, providers: nextProviders, updatedAt: new Date().toISOString() };
                      });
                    };

                    const providerDefaultRow = getLatestRow(null);
                    const modelsUsed = usageModelsUsed?.[p.id] ?? [];

                    return (
                      <div key={p.id} className="rounded-lg border border-border bg-background p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium text-foreground">Pricing: {p.name}</div>
                          <div className="text-xs text-muted-foreground">{p.id}</div>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Provider default (fallback)
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div className="grid gap-1">
                            <label className="text-xs leading-5 text-muted-foreground whitespace-nowrap">Input / 1M</label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              key={`pricing-${p.id}-default-input-${providerDefaultRow?.inputCostPer1m ?? ''}`}
                              defaultValue={providerDefaultRow?.inputCostPer1m ?? ''}
                              onBlur={(e) => {
                                const raw = e.target.value.trim();
                                if (!raw) {
                                  upsertRow(null, { inputCostPer1m: null });
                                  return;
                                }
                                const next = Number(raw);
                                if (!Number.isFinite(next) || next < 0) return;
                                upsertRow(null, { inputCostPer1m: next });
                              }}
                              className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                              placeholder="e.g. 3.00"
                              disabled={usagePricingSaving}
                            />
                            <div className="text-[11px] text-muted-foreground">
                              per 1k:{' '}
                              {typeof providerDefaultRow?.inputCostPer1m === 'number'
                                ? (providerDefaultRow.inputCostPer1m / 1000).toFixed(4)
                                : '—'}
                            </div>
                          </div>
                          <div className="grid gap-1">
                            <label className="text-xs leading-5 text-muted-foreground whitespace-nowrap">Output / 1M</label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              key={`pricing-${p.id}-default-output-${providerDefaultRow?.outputCostPer1m ?? ''}`}
                              defaultValue={providerDefaultRow?.outputCostPer1m ?? ''}
                              onBlur={(e) => {
                                const raw = e.target.value.trim();
                                if (!raw) {
                                  upsertRow(null, { outputCostPer1m: null });
                                  return;
                                }
                                const next = Number(raw);
                                if (!Number.isFinite(next) || next < 0) return;
                                upsertRow(null, { outputCostPer1m: next });
                              }}
                              className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                              placeholder="e.g. 15.00"
                              disabled={usagePricingSaving}
                            />
                            <div className="text-[11px] text-muted-foreground">
                              per 1k:{' '}
                              {typeof providerDefaultRow?.outputCostPer1m === 'number'
                                ? (providerDefaultRow.outputCostPer1m / 1000).toFixed(4)
                                : '—'}
                            </div>
                          </div>
                          <div className="grid gap-1">
                            <label className="text-xs leading-5 text-muted-foreground whitespace-nowrap">Effective from (optional)</label>
                            <input
                              type="date"
                              key={`pricing-${p.id}-default-date-${providerDefaultRow?.effectiveFrom ?? ''}`}
                              defaultValue={providerDefaultRow?.effectiveFrom ?? ''}
                              onBlur={(e) => {
                                const next = e.target.value.trim();
                                upsertRow(null, { effectiveFrom: next || null });
                              }}
                              className="mt-0.5 h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                              disabled={usagePricingSaving}
                            />
                            <div className="text-[11px] text-muted-foreground">
                              Used for historical pricing changes.
                            </div>
                          </div>
                        </div>

                        {modelsUsed.length > 0 && (
                          <div className="pt-2 space-y-2">
                            <div className="text-xs text-muted-foreground">Per-model overrides (used models)</div>
                            <div className="space-y-2">
                              {modelsUsed.map((modelId) => {
                                const row = getLatestRow(modelId);
                                return (
                                  <div key={modelId} className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                                    <div className="text-xs font-medium text-foreground break-words">{modelId}</div>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                      <div className="grid gap-1">
                                        <label className="text-xs leading-5 text-muted-foreground whitespace-nowrap">Input / 1M</label>
                                        <input
                                          type="number"
                                          min="0"
                                          step="0.01"
                                          key={`pricing-${p.id}-${modelId}-input-${row?.inputCostPer1m ?? ''}`}
                                          defaultValue={row?.inputCostPer1m ?? ''}
                                          onBlur={(e) => {
                                            const raw = e.target.value.trim();
                                            if (!raw) {
                                              upsertRow(modelId, { inputCostPer1m: null });
                                              return;
                                            }
                                            const next = Number(raw);
                                            if (!Number.isFinite(next) || next < 0) return;
                                            upsertRow(modelId, { inputCostPer1m: next });
                                          }}
                                          className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                          placeholder="(inherit)"
                                          disabled={usagePricingSaving}
                                        />
                                        <div className="text-[11px] text-muted-foreground">
                                          per 1k:{' '}
                                          {typeof row?.inputCostPer1m === 'number'
                                            ? (row.inputCostPer1m / 1000).toFixed(4)
                                            : '—'}
                                        </div>
                                      </div>
                                      <div className="grid gap-1">
                                        <label className="text-xs leading-5 text-muted-foreground whitespace-nowrap">Output / 1M</label>
                                        <input
                                          type="number"
                                          min="0"
                                          step="0.01"
                                          key={`pricing-${p.id}-${modelId}-output-${row?.outputCostPer1m ?? ''}`}
                                          defaultValue={row?.outputCostPer1m ?? ''}
                                          onBlur={(e) => {
                                            const raw = e.target.value.trim();
                                            if (!raw) {
                                              upsertRow(modelId, { outputCostPer1m: null });
                                              return;
                                            }
                                            const next = Number(raw);
                                            if (!Number.isFinite(next) || next < 0) return;
                                            upsertRow(modelId, { outputCostPer1m: next });
                                          }}
                                          className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                          placeholder="(inherit)"
                                          disabled={usagePricingSaving}
                                        />
                                        <div className="text-[11px] text-muted-foreground">
                                          per 1k:{' '}
                                          {typeof row?.outputCostPer1m === 'number'
                                            ? (row.outputCostPer1m / 1000).toFixed(4)
                                            : '—'}
                                        </div>
                                      </div>
                                      <div className="grid gap-1">
                                        <label className="text-xs leading-5 text-muted-foreground whitespace-nowrap">Effective from (optional)</label>
                                        <input
                                          type="date"
                                          key={`pricing-${p.id}-${modelId}-date-${row?.effectiveFrom ?? ''}`}
                                          defaultValue={row?.effectiveFrom ?? ''}
                                          onBlur={(e) => {
                                            const next = e.target.value.trim();
                                            upsertRow(modelId, { effectiveFrom: next || null });
                                          }}
                                          className="mt-0.5 h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                          disabled={usagePricingSaving}
                                        />
                                        <div className="text-[11px] text-muted-foreground">
                                          Used for historical pricing changes.
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground">
                  Auto-fill provides estimates based on publicly available pricing. Please review before saving.
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={openAutoFillPicker} disabled={usagePricingSaving}>
                    Auto-fill pricing with AI
                  </Button>
                  <Button onClick={handleSaveUsagePricing} disabled={usagePricingSaving || usagePricingLoading || !usagePricing}>
                    {usagePricingSaving ? 'Saving…' : 'Save pricing'}
                  </Button>
                </div>
              </div>
              {usagePricingError && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {usagePricingError}
                </div>
              )}
            </div>
            )}
          </section>

          {usageAutofillOpen && (
          <Dialog open={usageAutofillOpen} onOpenChange={setUsageAutofillOpen}>
            <DialogContent className="w-[92vw] max-w-lg">
              <DialogHeader>
                <DialogTitle>Auto-fill pricing with AI</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                {usageAutofillStep === 'pick' ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Choose which provider/models to fetch pricing for. We only use publicly available pricing and never apply changes automatically.
                    </p>

                    <div className="max-h-64 overflow-auto rounded-lg border border-border bg-background p-3 space-y-3">
                      {usageProviders.map((p) => {
                        const models = usageModelsUsed?.[p.id] ?? [];
                        const defaultKey = `${p.id}:default`;
                        const defaultChecked = usageAutofillTargets.has(defaultKey);
                        return (
                          <div key={p.id} className="space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="text-sm font-medium text-foreground">{p.name}</div>
                              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                <input
                                  type="checkbox"
                                  checked={defaultChecked}
                                  onChange={(e) => {
                                    setUsageAutofillTargets((prev) => {
                                      const next = new Set(prev);
                                      if (e.target.checked) next.add(defaultKey);
                                      else next.delete(defaultKey);
                                      return next;
                                    });
                                  }}
                                />
                                Provider default
                              </label>
                            </div>
                            {models.length > 0 ? (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {models.map((m) => {
                                  const k = `${p.id}:${m}`;
                                  const checked = usageAutofillTargets.has(k);
                                  return (
                                    <label key={k} className="flex items-center gap-2 text-xs text-muted-foreground">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(e) => {
                                          setUsageAutofillTargets((prev) => {
                                            const next = new Set(prev);
                                            if (e.target.checked) next.add(k);
                                            else next.delete(k);
                                            return next;
                                          });
                                        }}
                                      />
                                      <span className="break-words">{m}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="text-xs text-muted-foreground">No models used yet.</div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      <Button variant="outline" onClick={() => setUsageAutofillOpen(false)}>
                        Cancel
                      </Button>
                      <Button onClick={handleAutoFillUsagePricing} disabled={usageAutofillLoading || usageAutofillTargets.size === 0}>
                        {usageAutofillLoading ? 'Fetching…' : 'Fetch pricing'}
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      {usageAutofillResult?.message ?? 'No suggestions available.'}
                    </p>
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3">
                      <div className="text-sm text-foreground">Overwrite existing values</div>
                      <button
                        onClick={() => setUsageAutofillOverwrite((v) => !v)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-accomplish ${
                          usageAutofillOverwrite ? 'bg-primary' : 'bg-muted'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-accomplish ${
                            usageAutofillOverwrite ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                    <div className="max-h-60 overflow-auto rounded-lg border border-border bg-background p-3 text-xs space-y-2">
                      {(usageAutofillResult?.providers ?? []).length === 0 ? (
                        <div className="text-muted-foreground">No suggestions.</div>
                      ) : (
                        (usageAutofillResult?.providers ?? []).map((row) => {
                          const metaKey = `${row.provider}:${row.model ?? 'default'}`;
                          const meta = usageAutofillResult?.meta?.[metaKey];
                          return (
                            <div key={metaKey} className="rounded-md border border-border p-2">
                              <div className="font-medium text-foreground">
                                {row.provider} {row.model ? `• ${row.model}` : '• provider default'}
                              </div>
                              <div className="text-muted-foreground">
                                input/1M: {row.inputCostPer1m ?? '—'} • output/1M: {row.outputCostPer1m ?? '—'} • confidence: {meta?.confidence ?? 'low'}
                              </div>
                              {meta?.note && <div className="text-muted-foreground mt-1">{meta.note}</div>}
                              {meta?.sourceUrl && <div className="text-muted-foreground mt-1">source: {meta.sourceUrl}</div>}
                            </div>
                          );
                        })
                      )}
                    </div>
                    <div className="flex justify-between gap-2 pt-2">
                      <Button variant="outline" onClick={() => setUsageAutofillStep('pick')}>
                        Back
                      </Button>
                      <div className="flex gap-2">
                        <Button variant="outline" onClick={() => setUsageAutofillOpen(false)}>
                          Cancel
                        </Button>
                        <Button onClick={applyUsageAutofill} disabled={!usageAutofillResult}>
                          Apply suggestions
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </DialogContent>
          </Dialog>
          )}


          <section>
            <h2 className="mb-4 text-base font-medium text-foreground">
              Skills
              <InfoTip text="Skills add tool integrations. Click Install to download missing skills (requires internet). If install fails, check your network and try again." />
            </h2>
            {isSettingsSectionExpandedByHeading('Skills') && (
            <>
            <div className="rounded-lg border border-border bg-card p-5">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-foreground">Skill dependencies</div>
                  <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                    Install or repair the skills Open Deskmate uses for browser automation and permissions.
                  </p>
                </div>
                <ButtonTip text="Download and install all missing skills.">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleInstallAllSkills}
                    disabled={installingAll || loadingSkills}
                  >
                    {installingAll ? 'Installing...' : 'Install all'}
                  </Button>
                </ButtonTip>
              </div>

              {loadingSkills ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking skills...
                </div>
              ) : (
                <div className="space-y-3">
                  {skillsStatus.map((skill) => (
                    <div key={skill.id} className="flex items-center justify-between rounded-xl border border-border/60 p-4">
                      <div>
                        <div className="text-sm font-medium text-foreground">{skill.name}</div>
                        <p className="text-xs text-muted-foreground">
                          {skill.description || 'Skill dependency bundle.'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {skill.installed ? (
                          <span className="inline-flex items-center gap-1 text-xs text-success">
                            <CheckCircle2 className="h-4 w-4" />
                            Installed
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-warning">
                            <AlertCircle className="h-4 w-4" />
                            Needs install
                          </span>
                        )}
                        {skill.installable && !skill.installed && (
                          <ButtonTip text="Download and install this skill.">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={installingSkill === skill.id || uninstallingSkill === skill.id}
                              onClick={() => handleInstallSkill(skill.id)}
                            >
                              {installingSkill === skill.id ? 'Installing...' : 'Install'}
                            </Button>
                          </ButtonTip>
                        )}
                        {skill.installable && skill.installed && (
                          <ButtonTip text="Remove this skill's dependencies (deletes node_modules).">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={installingSkill === skill.id || uninstallingSkill === skill.id}
                              onClick={() => setUninstallConfirmSkillId(skill.id)}
                            >
                              {uninstallingSkill === skill.id ? 'Uninstalling...' : 'Uninstall'}
                            </Button>
                          </ButtonTip>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {skillsError && <p className="mt-3 text-xs text-destructive">{skillsError}</p>}
            </div>

            {Boolean(uninstallConfirmSkillId) && (
            <Dialog open={!!uninstallConfirmSkillId} onOpenChange={(open) => { if (!open) setUninstallConfirmSkillId(null); }}>
              <DialogContent className="sm:max-w-[420px]">
                <DialogHeader>
                  <DialogTitle>Uninstall skill dependencies</DialogTitle>
                </DialogHeader>
                <div className="py-2">
                  <p className="text-sm text-muted-foreground">
                    This will delete <code className="rounded bg-muted px-1 py-0.5">node_modules</code> for
                    {' '}
                    <span className="font-medium text-foreground">
                      {skillsStatus.find((s) => s.id === uninstallConfirmSkillId)?.name || uninstallConfirmSkillId}
                    </span>
                    . You can reinstall later.
                  </p>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setUninstallConfirmSkillId(null)}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={async () => {
                      const skillId = uninstallConfirmSkillId;
                      setUninstallConfirmSkillId(null);
                      if (!skillId) return;
                      await handleUninstallSkill(skillId);
                    }}
                  >
                    Uninstall
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            )}

            {Boolean(deleteConfirmUserSkill) && (
            <Dialog open={!!deleteConfirmUserSkill} onOpenChange={(open) => { if (!open) setDeleteConfirmUserSkill(null); }}>
              <DialogContent className="sm:max-w-[460px]">
                <DialogHeader>
                  <DialogTitle>Delete user skill</DialogTitle>
                </DialogHeader>
                <div className="py-2">
                  <p className="text-sm text-muted-foreground">
                    This will permanently delete the playbook folder for{' '}
                    <span className="font-medium text-foreground">
                      {deleteConfirmUserSkill?.name || deleteConfirmUserSkill?.skillId}
                    </span>
                    .
                  </p>
                  {deleteConfirmUserSkill?.source === 'workspace' && (
                    <p className="mt-2 text-xs text-warning">
                      Note: This skill is in your workspace <code className="rounded bg-muted px-1 py-0.5">skills/</code> folder.
                    </p>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDeleteConfirmUserSkill(null)} disabled={deletingUserSkill}>
                    Cancel
                  </Button>
                  <Button variant="destructive" onClick={() => void handleDeleteUserSkill()} disabled={deletingUserSkill}>
                    {deletingUserSkill ? 'Deleting...' : 'Delete'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            )}

            <div className="mt-6 rounded-lg border border-border bg-card p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="font-medium text-foreground">User skills (playbooks)</div>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border text-[10px] font-semibold text-muted-foreground hover:text-foreground"
                          aria-label="About user skills"
                        >
                          i
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="max-w-sm text-xs leading-relaxed text-foreground" align="start">
                        <div className="font-medium">What these buttons do</div>
                        <div className="mt-2 space-y-2 text-muted-foreground">
                          <div>
                            <span className="font-medium text-foreground">Configure</span>: edit per-skill JSON config (stored by skillKey). Use this for API keys, toggles, or any skill-specific settings referenced by the playbook.
                          </div>
                          <div>
                            <span className="font-medium text-foreground">Edit</span>: opens <code className="rounded bg-muted px-1 py-0.5">SKILL.md</code> so you can change the playbook text and metadata. Saving writes it back to disk.
                          </div>
                          <div>
                            <span className="font-medium text-foreground">Install</span> / <span className="font-medium text-foreground">Run installer</span>: runs an install action declared in the playbook metadata (<code className="rounded bg-muted px-1 py-0.5">metadata.opendeskmate.install</code>) to set up missing dependencies (older playbooks are still supported).
                          </div>
                        </div>
                        <div className="mt-3 border-t border-border pt-3 text-muted-foreground">
                          <div className="font-medium text-foreground">Do I need to run installer?</div>
                          <div className="mt-1">
                            Only if the skill shows <span className="font-medium text-foreground">Needs setup</span> and offers installer buttons. If it’s <span className="font-medium text-foreground">Ready</span>, nothing to do.
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                    Add and edit markdown skills. These are injected into the assistant on every run.
                  </p>
                  {userSkillsReport?.managedSkillsDir && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Stored in: <code className="rounded bg-muted px-1 py-0.5">{userSkillsReport.managedSkillsDir}</code>
                    </p>
                  )}
                </div>
                <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openSkillAssistantDialog({ mode: 'general' })}
                  >
                    Skill Assistant
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setImportingUserSkillZip(true)}
                  >
                    Import ZIP
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCreatingUserSkill(true)}
                  >
                    New skill
                  </Button>
                </div>
              </div>

              {loadingUserSkills || loadingUserSkillsDeps ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading user skills...
                </div>
              ) : (
                <div className="space-y-3">
                  {(userSkillsDepsReport?.skills || userSkillsReport?.skills || []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No user skills yet. Create one to teach the assistant a repeatable workflow.
                    </p>
                  ) : (
                    (userSkillsDepsReport?.skills
                      ? userSkillsDepsReport.skills.map((skill) => {
                          const missingCount =
                            skill.missing.bins.length +
                            skill.missing.anyBins.length +
                            skill.missing.env.length +
                            skill.missing.config.length +
                            skill.missing.os.length;
                          const statusLabel = skill.disabled
                            ? 'Disabled'
                            : skill.eligible
                              ? 'Ready'
                              : 'Needs setup';
                          const statusColor = skill.disabled
                            ? 'text-muted-foreground'
                            : skill.eligible
                              ? 'text-success'
                              : 'text-warning';
                          const canManageSkill = !skill.visibilityOwnerAgentId || skill.visibilityOwnerAgentId === activeAgentId;

                          return (
                            <div
                              key={`${skill.source}:${skill.id}`}
                              className="rounded-xl border border-border/60 p-4"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="text-sm font-medium text-foreground truncate">
                                      {skill.name}
                                    </div>
                                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground rounded-full border border-border px-2 py-0.5">
                                      {skill.source}
                                    </span>
                                    {skill.originLabel && (
                                      <span className="text-[10px] tracking-wide text-sky-700 dark:text-sky-300 rounded-full border border-sky-300/60 px-2 py-0.5">
                                        {skill.originLabel}
                                      </span>
                                    )}
                                    <span className={`inline-flex items-center gap-1 text-xs ${statusColor}`}>
                                      {skill.eligible ? (
                                        <CheckCircle2 className="h-4 w-4" />
                                      ) : (
                                        <AlertCircle className="h-4 w-4" />
                                      )}
                                      {statusLabel}
                                      {!skill.eligible && !skill.disabled && missingCount > 0 ? ` (${missingCount})` : ''}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {skill.description || skill.bodyPreview || 'Skill playbook.'}
                                  </p>
                                  {skill.generatedByAgentName && (
                                    <p className="mt-1 text-[11px] text-muted-foreground">
                                      Created by agent:{' '}
                                      <span className="font-medium text-foreground">
                                        {skill.generatedByAgentName || 'Unknown'}
                                      </span>
                                    </p>
                                  )}
                                  <p className="mt-1 text-[11px] text-muted-foreground">
                                    {getSkillVisibilityLabel(skill)}
                                  </p>
                                  <p className="mt-1 text-[11px] text-muted-foreground">
                                    {getSkillAccessLabel(skill)}
                                  </p>
                                  {skill.manifest && (
                                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                      <span className="rounded border border-border px-1.5 py-0.5 text-foreground">
                                        v{skill.manifest.version}
                                      </span>
                                      <span>Created: {formatIsoDateTime(skill.manifest.createdAt)}</span>
                                      <span>Updated: {formatIsoDateTime(skill.manifest.updatedAt)}</span>
                                    </div>
                                  )}
                                  {!skill.eligible && !skill.disabled && missingCount > 0 && (
                                    <div className="mt-2 text-[11px] text-muted-foreground space-y-1">
                                      {skill.missing.bins.length > 0 && (
                                        <div>Missing binaries: <code className="rounded bg-muted px-1">{skill.missing.bins.join(', ')}</code></div>
                                      )}
                                      {skill.missing.anyBins.length > 0 && (
                                        <div>Missing one of: <code className="rounded bg-muted px-1">{skill.missing.anyBins.join(', ')}</code></div>
                                      )}
                                      {skill.missing.env.length > 0 && (
                                        <div>Missing env: <code className="rounded bg-muted px-1">{skill.missing.env.join(', ')}</code></div>
                                      )}
                                      {skill.missing.config.length > 0 && (
                                        <div>Missing config: <code className="rounded bg-muted px-1">{skill.missing.config.join(', ')}</code></div>
                                      )}
                                      {skill.missing.os.length > 0 && (
                                        <div>Unsupported OS: <code className="rounded bg-muted px-1">{skill.missing.os.join(', ')}</code></div>
                                      )}
                                    </div>
                                  )}
                                  {skill.install.length > 0 && (
                                    <div className="mt-3 flex flex-wrap items-center gap-2">
                                      {skill.install.map((opt) => (
                                        <Button
                                          key={opt.id}
                                          size="sm"
                                          variant="outline"
                                          disabled={(installingUserSkillDep?.skillId === skill.id && installingUserSkillDep?.installId === opt.id) || false}
                                          onClick={() => void handleInstallUserSkillDep(skill, opt)}
                                        >
                                          {(installingUserSkillDep?.skillId === skill.id && installingUserSkillDep?.installId === opt.id)
                                            ? 'Installing...'
                                            : opt.label}
                                        </Button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={!canManageSkill}
                                    onClick={() => openShareUserSkill(skill)}
                                  >
                                    Share
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void openConfigureUserSkill(skill)}
                                  >
                                    Configure
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={!skill.editable || !canManageSkill}
                                    onClick={() => void openEditUserSkill(skill)}
                                  >
                                    {skill.editable ? 'Edit' : 'View'}
                                  </Button>
                                  {skill.editable && canManageSkill && skill.source !== 'bundled' && (
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      onClick={() => setDeleteConfirmUserSkill({ skillId: skill.id, name: skill.name, source: skill.source })}
                                    >
                                      Delete
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      : (userSkillsReport?.skills || []).map((skill) => {
                          const canManageSkill = !skill.visibilityOwnerAgentId || skill.visibilityOwnerAgentId === activeAgentId;
                          return (
                          <div key={`${skill.source}:${skill.id}`} className="flex items-center justify-between rounded-xl border border-border/60 p-4">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-sm font-medium text-foreground truncate">{skill.name}</div>
                                <span className="text-[10px] uppercase tracking-wide text-muted-foreground rounded-full border border-border px-2 py-0.5">
                                  {skill.source}
                                </span>
                                {skill.originLabel && (
                                  <span className="text-[10px] tracking-wide text-sky-700 dark:text-sky-300 rounded-full border border-sky-300/60 px-2 py-0.5">
                                    {skill.originLabel}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground truncate">
                                {skill.description || skill.bodyPreview || 'Skill playbook.'}
                              </p>
                              {skill.generatedByAgentName && (
                                <p className="mt-1 text-[11px] text-muted-foreground truncate">
                                  Created by agent:{' '}
                                  <span className="font-medium text-foreground">
                                    {skill.generatedByAgentName || 'Unknown'}
                                  </span>
                                </p>
                              )}
                              <p className="mt-1 text-[11px] text-muted-foreground truncate">
                                {getSkillVisibilityLabel(skill)}
                              </p>
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                {getSkillAccessLabel(skill)}
                              </p>
                              {skill.manifest && (
                                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                  <span className="rounded border border-border px-1.5 py-0.5 text-foreground">
                                    v{skill.manifest.version}
                                  </span>
                                  <span>Created: {formatIsoDateTime(skill.manifest.createdAt)}</span>
                                  <span>Updated: {formatIsoDateTime(skill.manifest.updatedAt)}</span>
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!canManageSkill}
                                onClick={() => openShareUserSkill(skill)}
                              >
                                Share
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void openConfigureUserSkill(toConfigurableUserSkill(skill))}
                              >
                                Configure
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!skill.editable || !canManageSkill}
                                onClick={() => void openEditUserSkill(skill)}
                              >
                                {skill.editable ? 'Edit' : 'View'}
                              </Button>
                              {skill.editable && canManageSkill && skill.source !== 'bundled' && (
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => setDeleteConfirmUserSkill({ skillId: skill.id, name: skill.name, source: skill.source })}
                                >
                                  Delete
                                </Button>
                              )}
                            </div>
                          </div>
                          );
                        }))
                  )}
                </div>
              )}
              {(userSkillsError || userSkillsDepsError) && (
                <p className="mt-3 text-xs text-destructive">{userSkillsDepsError || userSkillsError}</p>
              )}
            </div>
            </>
            )}
          </section>

          <section>
            <h2 className="mb-4 text-base font-medium text-foreground">
              Automations
              <InfoTip text="Use webhooks, remote WebChat, and schedules. LAN/public access may require binding to 0.0.0.0 or Tailscale. For public access, install Tailscale and enable Funnel." />
            </h2>
            {isSettingsSectionExpandedByHeading('Automations') && (
            <div className="rounded-lg border border-border bg-card p-5 space-y-6">
              <div>
                <div className="font-medium text-foreground">
                  Webhook endpoints
                  <InfoTip text="Use these URLs to trigger tasks or open WebChat. Local works only on this computer. LAN requires binding to 0.0.0.0 and a restart. Public shows when Tailscale Serve/Funnel is enabled." />
                </div>
                <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                  Trigger tasks from other apps by POSTing JSON to the webhook. LAN access requires binding to all
                  interfaces.
                </p>
                <div className="mt-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Local
                      <InfoTip text="Only works on this machine. Use for local automations or testing." />
                    </span>
                    <code className="rounded-md bg-muted px-2 py-1 text-xs text-foreground">
                      {localWebhookUrl || 'Loading...'}
                    </code>
                    <ButtonTip text="Copy the local webhook URL.">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleCopyWebhook}
                        disabled={!localWebhookUrl}
                      >
                        Copy
                      </Button>
                    </ButtonTip>
                    <ButtonTip text="Open the local WebChat URL in a browser.">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleOpenWebchat}
                        disabled={!localWebhookUrl}
                      >
                        Open
                      </Button>
                    </ButtonTip>
                  </div>
                  {lanWebhookUrls.length > 0 ? (
                    lanWebhookUrls.map((url) => (
                      <div key={url} className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          LAN
                          <InfoTip text="Use this on phones or devices on the same Wi‑Fi. Requires bind mode = All interfaces and app restart." />
                        </span>
                        <code className="rounded-md bg-muted px-2 py-1 text-xs text-foreground">{url}</code>
                        <ButtonTip text="Copy the LAN URL.">
                          <Button size="sm" variant="outline" onClick={() => handleCopyGatewayValue(url)}>
                            Copy
                          </Button>
                        </ButtonTip>
                        <ButtonTip text="Open the LAN URL in a browser.">
                          <Button size="sm" variant="outline" onClick={() => handleOpenGatewayUrl(url)}>
                            Open
                          </Button>
                        </ButtonTip>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      LAN URLs appear when bind mode is set to “All interfaces (0.0.0.0)”.
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Public
                      <InfoTip text="Provided by Tailscale Serve/Funnel. Use for remote access outside your LAN. Requires Tailscale installed and logged in." />
                    </span>
                    <code className="rounded-md bg-muted px-2 py-1 text-xs text-foreground">
                      {publicWebhookUrl || 'Not exposed'}
                    </code>
                    <ButtonTip text="Copy the public URL (Tailscale).">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCopyGatewayValue(publicWebhookUrl)}
                        disabled={!publicWebhookUrl}
                      >
                        Copy
                      </Button>
                    </ButtonTip>
                    <ButtonTip text="Open the public URL in a browser.">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenGatewayUrl(publicWebhookUrl)}
                        disabled={!publicWebhookUrl}
                      >
                        Open
                      </Button>
                    </ButtonTip>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <label className="text-xs text-muted-foreground">
                    Bind address
                    <InfoTip text="Localhost = only this computer. All interfaces = accessible from your LAN/public reverse proxy. Changing requires restart." />
                  </label>
                  <select
                    value={webhookBindMode}
                    onChange={(event) => handleWebhookBindModeChange(event.target.value as 'localhost' | 'all')}
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="localhost">Localhost only (127.0.0.1)</option>
                    <option value="all">All interfaces (0.0.0.0)</option>
                  </select>
                  {webhookBindNeedsRestart && (
                    <span className="text-xs text-amber-500">Restart app to apply bind changes.</span>
                  )}
                </div>
              </div>

              <div className="border-t border-border pt-5 space-y-4">
                <div>
                  <div className="font-medium text-foreground">
                    Remote WebChat (Tailscale)
                    <InfoTip text="Steps: install + sign in to Tailscale on this computer, choose Serve (tailnet only) or Funnel (public), set auth, click Save, then use the generated URL." />
                  </div>
                  <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                    Expose the local WebChat and webhook endpoints over Tailscale Serve (tailnet-only) or Funnel (public).
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="grid gap-1">
                    <label className="text-xs text-muted-foreground">
                      Tailscale mode
                      <InfoTip text="Serve = private tailnet URL. Funnel = public URL. Off disables exposure." />
                    </label>
                    <select
                      value={gatewayTailscaleMode}
                      onChange={(e) => {
                        const mode = e.target.value as 'off' | 'serve' | 'funnel';
                        setGatewayTailscaleModeInstant(mode);
                        if (mode === 'funnel') {
                          setGatewayAuthModeInstant('password');
                          setGatewayAllowTailscaleInstant(false);
                        }
                        if (mode !== 'serve') {
                          setGatewayAllowTailscaleInstant(false);
                        }
                        scheduleGatewayAutoSave();
                      }}
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="off">Tailscale: Off</option>
                      <option value="serve">Tailscale: Serve (tailnet)</option>
                      <option value="funnel">Tailscale: Funnel (public)</option>
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <label className="text-xs text-muted-foreground">
                      Auth mode
                      <InfoTip text="Choose how remote users authenticate. Funnel requires Password." />
                    </label>
                    <select
                      value={gatewayAuthMode}
                      onChange={(e) => {
                        setGatewayAuthModeInstant(e.target.value as 'none' | 'token' | 'password');
                        scheduleGatewayAutoSave();
                      }}
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                      disabled={gatewayTailscaleMode === 'funnel'}
                    >
                      <option value="none">Auth: None</option>
                      <option value="token">Auth: Token</option>
                      <option value="password">Auth: Password</option>
                    </select>
                  </div>
                </div>

                  <div className="flex items-center justify-between rounded-xl border border-border/60 p-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      Allow Tailscale identity
                      <InfoTip text="When Serve is enabled, requests with tailnet identity headers can bypass token auth. Not needed for public Funnel." />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      When Serve is enabled, allow tailnet identity headers to bypass token auth.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      if (allowTailscaleToggleDisabled) return;
                      setGatewayAllowTailscaleInstant(!gatewayConfigRef.current.allowTailscale);
                      scheduleGatewayAutoSave();
                    }}
                    disabled={allowTailscaleToggleDisabled}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-accomplish ${
                      gatewayAllowTailscale ? 'bg-primary' : 'bg-muted'
                    } ${allowTailscaleToggleDisabled ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-accomplish ${
                        gatewayAllowTailscale ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-border/60 p-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      Reset exposure on exit
                      <InfoTip text="If enabled, Open Deskmate will disable Serve/Funnel when it quits. Use this if you only want temporary exposure." />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Reset Tailscale Serve/Funnel when Open Deskmate exits.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setGatewayTailscaleResetOnExitInstant(!gatewayConfigRef.current.tailscaleResetOnExit);
                      scheduleGatewayAutoSave();
                    }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-accomplish ${
                      gatewayTailscaleResetOnExit ? 'bg-primary' : 'bg-muted'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-accomplish ${
                        gatewayTailscaleResetOnExit ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-border/60 p-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      Record connector observed IDs
                      <InfoTip text="Global switch for collecting account/user/group/channel IDs from connector traffic into Last seen IDs. Disable to stop new discovery entries." />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Controls connector discovery recording globally.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setGatewayRecordConnectorDiscoveryInstant(!gatewayConfigRef.current.recordConnectorDiscovery);
                      scheduleGatewayAutoSave();
                    }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-accomplish ${
                      gatewayRecordConnectorDiscovery ? 'bg-primary' : 'bg-muted'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-accomplish ${
                        gatewayRecordConnectorDiscovery ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {gatewayAuthMode === 'token' && (
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">
                      Access token
                      <InfoTip text="Token users must provide in the Authorization header (Bearer). Optional but recommended for LAN/public." />
                    </label>
                    <input
                      type="password"
                      key={`gateway-token-${gatewayTokenSet ? 'set' : 'unset'}-${gatewayAuthMode}`}
                      ref={gatewayTokenInputRef}
                      defaultValue={gatewayTokenInput}
                      onBlur={(e) => setGatewayTokenInput(e.target.value)}
                      placeholder="Gateway access token"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <ButtonTip text="Store token securely on this machine.">
                        <Button onClick={handleSaveGatewayToken} disabled={gatewayTokenSaving}>
                          {gatewayTokenSaving ? 'Saving...' : 'Save token'}
                        </Button>
                      </ButtonTip>
                      <ButtonTip text="Generate a strong random token.">
                        <Button variant="outline" onClick={handleGenerateGatewayToken} disabled={gatewayTokenSaving}>
                          {gatewayCopied === 'token' ? 'Copied' : 'Generate'}
                        </Button>
                      </ButtonTip>
                      <ButtonTip text="Copy the token currently entered in the field.">
                        <Button variant="outline" onClick={() => void handleCopyGatewayToken()} disabled={gatewayTokenSaving}>
                          {gatewayCopied === 'token-copy' ? 'Copied' : 'Copy token'}
                        </Button>
                      </ButtonTip>
                      <ButtonTip text="Remove the stored token.">
                        <Button variant="outline" onClick={handleClearGatewayToken} disabled={gatewayTokenSaving || !gatewayTokenSet}>
                          Clear
                        </Button>
                      </ButtonTip>
                      <p className="text-xs text-muted-foreground">
                        {gatewayTokenSet ? 'Token stored securely.' : 'No token stored yet.'}
                      </p>
                    </div>
                  </div>
                )}

                {gatewayAuthMode === 'password' && (
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">
                      Access password
                      <InfoTip text="Password users must provide via Basic auth. Required for Funnel (public)." />
                    </label>
                    <input
                      type="password"
                      key={`gateway-password-${gatewayPasswordSet ? 'set' : 'unset'}-${gatewayAuthMode}`}
                      ref={gatewayPasswordInputRef}
                      defaultValue={gatewayPasswordInput}
                      onBlur={(e) => setGatewayPasswordInput(e.target.value)}
                      placeholder="Gateway password"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <ButtonTip text="Store password securely on this machine.">
                        <Button onClick={handleSaveGatewayPassword} disabled={gatewayPasswordSaving}>
                          {gatewayPasswordSaving ? 'Saving...' : 'Save password'}
                        </Button>
                      </ButtonTip>
                      <ButtonTip text="Generate a strong random password.">
                        <Button variant="outline" onClick={handleGenerateGatewayPassword} disabled={gatewayPasswordSaving}>
                          {gatewayCopied === 'password' ? 'Copied' : 'Generate'}
                        </Button>
                      </ButtonTip>
                      <ButtonTip text="Remove the stored password.">
                        <Button variant="outline" onClick={handleClearGatewayPassword} disabled={gatewayPasswordSaving || !gatewayPasswordSet}>
                          Clear
                        </Button>
                      </ButtonTip>
                      <p className="text-xs text-muted-foreground">
                        {gatewayPasswordSet ? 'Password stored securely.' : 'No password stored yet.'}
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <ButtonTip text="Apply Tailscale/auth settings.">
                    <Button onClick={() => handleSaveGatewayConfig(false)} disabled={gatewaySaving}>
                      {gatewaySaving ? 'Saving...' : 'Save remote settings'}
                    </Button>
                  </ButtonTip>
                  <ButtonTip text="Refresh gateway status and URLs.">
                    <Button variant="outline" onClick={refreshGatewayStatus} disabled={gatewayStatusLoading}>
                      {gatewayStatusLoading ? 'Refreshing...' : 'Refresh'}
                    </Button>
                  </ButtonTip>
                </div>

                <div className="rounded-xl border border-border/60 p-3 space-y-2">
                  <div className="text-sm font-medium text-foreground">
                    Gateway URLs
                    <InfoTip text="Local URL works on this computer. Tailscale URL appears when Serve/Funnel is enabled. Use these to open WebChat or send tasks remotely." />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Local</span>
                    <code className="rounded-md bg-muted px-2 py-1 text-xs text-foreground">
                      {localGatewayUrl}
                    </code>
                    <ButtonTip text="Copy the local gateway URL.">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCopyGatewayValue(localGatewayUrl, 'local')}
                      >
                        {gatewayCopied === 'local' ? 'Copied' : 'Copy'}
                      </Button>
                    </ButtonTip>
                    <ButtonTip text="Open the local gateway URL in a browser.">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenGatewayUrl(localGatewayUrl)}
                      >
                        Open
                      </Button>
                    </ButtonTip>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Tailscale</span>
                    <code className="rounded-md bg-muted px-2 py-1 text-xs text-foreground">
                      {gatewayStatus?.tailscaleUrl || 'Not available'}
                    </code>
                    <ButtonTip text="Copy the Tailscale URL.">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCopyGatewayValue(gatewayStatus?.tailscaleUrl, 'tailscale')}
                        disabled={!gatewayStatus?.tailscaleUrl}
                      >
                        {gatewayCopied === 'tailscale' ? 'Copied' : 'Copy'}
                      </Button>
                    </ButtonTip>
                    <ButtonTip text="Open the Tailscale URL in a browser.">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenGatewayUrl(gatewayStatus?.tailscaleUrl)}
                        disabled={!gatewayStatus?.tailscaleUrl}
                      >
                        Open
                      </Button>
                    </ButtonTip>
                  </div>
                  {gatewayStatus?.tailscaleError && (
                    <p className="text-xs text-destructive">{gatewayStatus.tailscaleError}</p>
                  )}
                </div>

                {gatewayError && <p className="text-xs text-destructive">{gatewayError}</p>}
              </div>

              <div className="border-t border-border pt-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-foreground">
                      Dynamic route bindings
                      <InfoTip text="Route channel/account/peer traffic to specific agents before dispatch. This is session-key-centric routing." />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Match by channel and optional account/peer/guild/team hints.
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => void refreshGatewayBindings()} disabled={gatewayBindingsLoading}>
                    {gatewayBindingsLoading ? 'Refreshing...' : 'Refresh'}
                  </Button>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="grid min-w-0 gap-1">
                    <label className="text-xs text-muted-foreground">Channel</label>
                    <input
                      type="text"
                      value={gatewayBindingChannel}
                      onChange={(e) => setGatewayBindingChannel(e.target.value)}
                      placeholder="discord / telegram / webhook"
                      className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="grid min-w-0 gap-1">
                    <label className="text-xs text-muted-foreground">Agent</label>
                    <select
                      value={gatewayBindingAgentId}
                      onChange={(e) => setGatewayBindingAgentId(e.target.value)}
                      className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      {[...agents].map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name} ({agent.id})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid min-w-0 gap-1">
                    <label className="text-xs text-muted-foreground">Account ID (optional)</label>
                    <input
                      type="text"
                      value={gatewayBindingAccountId}
                      onChange={(e) => setGatewayBindingAccountId(e.target.value)}
                      placeholder="Platform account/bot id"
                      className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="grid min-w-0 gap-1">
                    <label className="text-xs text-muted-foreground">Peer kind + peer id (optional)</label>
                    <div className="flex min-w-0 gap-2">
                      <select
                        value={gatewayBindingPeerKind}
                        onChange={(e) => setGatewayBindingPeerKind(e.target.value as GatewayPeerKind)}
                        className="w-28 shrink-0 rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="dm">dm</option>
                        <option value="group">group</option>
                        <option value="channel">channel</option>
                      </select>
                      <input
                        type="text"
                        value={gatewayBindingPeerId}
                        onChange={(e) => setGatewayBindingPeerId(e.target.value)}
                        placeholder="peer id"
                        className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                  <div className="grid min-w-0 gap-1">
                    <label className="text-xs text-muted-foreground">Guild ID (optional)</label>
                    <input
                      type="text"
                      value={gatewayBindingGuildId}
                      onChange={(e) => setGatewayBindingGuildId(e.target.value)}
                      className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="grid min-w-0 gap-1">
                    <label className="text-xs text-muted-foreground">Team ID (optional)</label>
                    <input
                      type="text"
                      value={gatewayBindingTeamId}
                      onChange={(e) => setGatewayBindingTeamId(e.target.value)}
                      className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => void handleSaveGatewayBinding()} disabled={gatewayBindingsSaving}>
                    {gatewayBindingsSaving
                      ? 'Saving...'
                      : gatewayBindingEditorId
                        ? 'Update binding'
                        : 'Add binding'}
                  </Button>
                  <Button variant="outline" onClick={resetGatewayBindingEditor} disabled={gatewayBindingsSaving}>
                    Clear editor
                  </Button>
                </div>

                {gatewayBindingsError && <p className="text-xs text-destructive">{gatewayBindingsError}</p>}

                <div className="space-y-2 max-h-56 overflow-auto">
                  {gatewayBindingsLoading ? (
                    <p className="text-xs text-muted-foreground">Loading bindings...</p>
                  ) : gatewayBindings.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No custom bindings yet.</p>
                  ) : (
                    gatewayBindings.map((binding) => (
                      <div key={binding.id} className="rounded-xl border border-border/60 p-3 space-y-2">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-foreground">
                              {binding.id}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              channel={binding.match.channel} | agent={binding.agentId}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {[
                                binding.match.accountId ? `account=${binding.match.accountId}` : null,
                                binding.match.peer ? `peer=${binding.match.peer.kind}:${binding.match.peer.id}` : null,
                                binding.match.guildId ? `guild=${binding.match.guildId}` : null,
                                binding.match.teamId ? `team=${binding.match.teamId}` : null,
                              ].filter(Boolean).join(' | ') || 'No optional match constraints'}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button size="sm" variant="outline" onClick={() => handleEditGatewayBinding(binding)}>
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => void handleDeleteGatewayBinding(binding.id)}
                              disabled={gatewayBindingsSaving}
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="border-t border-border pt-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-foreground">
                      Session registry
                      <InfoTip text="Inspect active session-key mappings across clients and channels." />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Useful for debugging cross-client continuity.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={gatewaySessionFilterAgentId}
                      onChange={(e) => setGatewaySessionFilterAgentId(e.target.value)}
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="">All agents</option>
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name} ({agent.id})
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void refreshGatewaySessions()}
                      disabled={gatewaySessionsLoading}
                    >
                      {gatewaySessionsLoading ? 'Refreshing...' : 'Refresh'}
                    </Button>
                  </div>
                </div>

                {gatewaySessionsError && <p className="text-xs text-destructive">{gatewaySessionsError}</p>}

                <div className="space-y-2 max-h-56 overflow-auto">
                  {gatewaySessionsLoading ? (
                    <p className="text-xs text-muted-foreground">Loading sessions...</p>
                  ) : gatewaySessions.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No gateway sessions found.</p>
                  ) : (
                    gatewaySessions.map((session) => (
                      <div key={session.key} className="rounded-xl border border-border/60 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 space-y-1">
                            <div className="text-xs text-foreground break-all">
                              <span className="font-medium">key:</span> {session.key}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              agent={session.agentId} | task={session.taskId || 'n/a'} | session={session.sessionId || 'n/a'}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              route={session.channel || 'n/a'} / {session.accountId || 'n/a'} / {session.peerKind || 'n/a'}:{session.peerId || 'n/a'}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              updated={formatIsoDateTime(session.updatedAt)}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => void handleDeleteGatewaySession(session.key)}
                            disabled={gatewaySessionDeletingKey === session.key}
                          >
                            {gatewaySessionDeletingKey === session.key ? 'Deleting...' : 'Delete'}
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="border-t border-border pt-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-foreground">
                      Agent runs
                      <InfoTip text="Track gateway-dispatched run lifecycles and outcomes." />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Includes accepted/running/done/error run records.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={gatewayRunFilterAgentId}
                      onChange={(e) => setGatewayRunFilterAgentId(e.target.value)}
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="">All agents</option>
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name} ({agent.id})
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void refreshGatewayRuns()}
                      disabled={gatewayRunsLoading}
                    >
                      {gatewayRunsLoading ? 'Refreshing...' : 'Refresh'}
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={gatewayRunLookupId}
                    onChange={(e) => setGatewayRunLookupId(e.target.value)}
                    placeholder="Lookup run by runId"
                    className="min-w-[240px] flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                  <Button size="sm" variant="outline" onClick={() => void handleLookupGatewayRun()} disabled={gatewayRunLookupLoading}>
                    {gatewayRunLookupLoading ? 'Loading...' : 'Lookup'}
                  </Button>
                </div>

                {gatewayRunLookup && (
                  <div className="rounded-xl border border-border/60 p-3 text-xs text-muted-foreground">
                    <div className="font-medium text-foreground">{gatewayRunLookup.runId}</div>
                    <div>status={gatewayRunLookup.status} | result={gatewayRunLookup.resultStatus || 'n/a'}</div>
                    <div>agent={gatewayRunLookup.agentId} | task={gatewayRunLookup.taskId}</div>
                    <div>session={gatewayRunLookup.sessionKey} | matchedBy={gatewayRunLookup.matchedBy}</div>
                    <div>updated={formatIsoDateTime(gatewayRunLookup.updatedAt)}</div>
                    {gatewayRunLookup.error && <div className="text-destructive">error={gatewayRunLookup.error}</div>}
                  </div>
                )}

                {gatewayRunsError && <p className="text-xs text-destructive">{gatewayRunsError}</p>}

                <div className="space-y-2 max-h-56 overflow-auto">
                  {gatewayRunsLoading ? (
                    <p className="text-xs text-muted-foreground">Loading runs...</p>
                  ) : gatewayRuns.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No runs recorded yet.</p>
                  ) : (
                    gatewayRuns.map((run) => (
                      <div key={run.runId} className="rounded-xl border border-border/60 p-3 text-xs">
                        <div className="font-medium text-foreground break-all">{run.runId}</div>
                        <div className="text-muted-foreground">
                          status={run.status} | result={run.resultStatus || 'n/a'} | task={run.taskId}
                        </div>
                        <div className="text-muted-foreground">
                          agent={run.agentId} | matchedBy={run.matchedBy}
                        </div>
                        <div className="text-muted-foreground">
                          updated={formatIsoDateTime(run.updatedAt)}
                        </div>
                        {run.error && <div className="text-destructive">error={run.error}</div>}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="border-t border-border pt-5 space-y-4">
                <div>
                  <div className="font-medium text-foreground">
                    Gateway RPC console
                    <InfoTip text="Send JSON-RPC calls to /gateway/rpc to test protocol methods from the UI." />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Quick methods: agents.list, sessions.list, chat.send, agent.spawn, agent.wait.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => applyGatewayRpcPreset('agents.list', {})}>agents.list</Button>
                  <Button size="sm" variant="outline" onClick={() => applyGatewayRpcPreset('sessions.list', {})}>sessions.list</Button>
                  <Button size="sm" variant="outline" onClick={() => applyGatewayRpcPreset('chat.send', { message: 'Hello from Settings', channel: 'webhook' })}>chat.send</Button>
                  <Button size="sm" variant="outline" onClick={() => applyGatewayRpcPreset('agent.spawn', { prompt: 'Say hello', channel: 'webhook' })}>agent.spawn</Button>
                  <Button size="sm" variant="outline" onClick={() => applyGatewayRpcPreset('agent.wait', { runId: 'replace-me' })}>agent.wait</Button>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="grid gap-1">
                    <label className="text-xs text-muted-foreground">Method</label>
                    <input
                      type="text"
                      value={gatewayRpcMethod}
                      onChange={(e) => setGatewayRpcMethod(e.target.value)}
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="grid gap-1">
                    <label className="text-xs text-muted-foreground">Auth</label>
                    <select
                      value={gatewayRpcAuthMode}
                      onChange={(e) => setGatewayRpcAuthMode(e.target.value as 'none' | 'token' | 'password')}
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="none">none</option>
                      <option value="token">token</option>
                      <option value="password">password</option>
                    </select>
                  </div>
                  {gatewayRpcAuthMode === 'token' && (
                    <div className="grid gap-1 md:col-span-2">
                      <label className="text-xs text-muted-foreground">Token (optional if token field above is filled)</label>
                      <input
                        type="password"
                        value={gatewayRpcToken}
                        onChange={(e) => setGatewayRpcToken(e.target.value)}
                        className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                  )}
                  {gatewayRpcAuthMode === 'password' && (
                    <div className="grid gap-1 md:col-span-2">
                      <label className="text-xs text-muted-foreground">Password (optional if password field above is filled)</label>
                      <input
                        type="password"
                        value={gatewayRpcPassword}
                        onChange={(e) => setGatewayRpcPassword(e.target.value)}
                        className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                  )}
                  <div className="grid gap-1 md:col-span-2">
                    <label className="text-xs text-muted-foreground">Params (JSON object)</label>
                    <textarea
                      value={gatewayRpcParams}
                      onChange={(e) => setGatewayRpcParams(e.target.value)}
                      className="min-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                      spellCheck={false}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button onClick={() => void handleRunGatewayRpc()} disabled={gatewayRpcLoading}>
                    {gatewayRpcLoading ? 'Running...' : 'Run RPC'}
                  </Button>
                </div>
                {gatewayRpcError && <p className="text-xs text-destructive">{gatewayRpcError}</p>}
                {gatewayRpcResponse && (
                  <pre className="max-h-64 overflow-auto rounded-xl border border-border/60 bg-muted/40 p-3 text-xs">
                    {gatewayRpcResponse}
                  </pre>
                )}
              </div>

              <div className="border-t border-border pt-5 space-y-4">
                <div>
                  <div className="font-medium text-foreground">Scheduled tasks</div>
                  <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                    Run prompts on a cron schedule (e.g., “0 9 * * 1-5” for weekdays at 9am).
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Runs as agent: {activeAgent?.name || activeAgentId || 'main'}. Switch agents in the sidebar to schedule for another persona.
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="grid gap-1">
                    <label className="text-xs text-muted-foreground">
                      Schedule name
                      <InfoTip text="Human-friendly name for this schedule." />
                    </label>
                    <input
                      type="text"
                      value={scheduleName}
                      onChange={(e) => setScheduleName(e.target.value)}
                      placeholder="Schedule name"
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="grid gap-1">
                    <label className="text-xs text-muted-foreground">
                      Cron expression
                      <InfoTip text="Cron expression for when to run (e.g., 0 9 * * 1-5)." />
                    </label>
                    <input
                      type="text"
                      value={scheduleCron}
                      onChange={(e) => setScheduleCron(e.target.value)}
                      placeholder="Cron expression"
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="grid gap-1 md:col-span-2">
                    <label className="text-xs text-muted-foreground">
                      Working folder
                      <InfoTip text="Optional working directory for the scheduled task." />
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={scheduleWorkingDirectory}
                        onChange={(e) => setScheduleWorkingDirectory(e.target.value)}
                        placeholder="Working folder (optional)"
                        className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                      />
                    <ButtonTip text="Choose a working folder for this schedule.">
                      <Button size="sm" variant="outline" type="button" onClick={handleSelectScheduleFolder}>
                        Browse
                      </Button>
                    </ButtonTip>
                    </div>
                  </div>
                  <div className="grid gap-1 md:col-span-2">
                    <label className="text-xs text-muted-foreground">
                      Timezone
                      <InfoTip text="Optional timezone for the cron schedule (defaults to system timezone)." />
                    </label>
                    <input
                      type="text"
                      value={scheduleTimezone}
                      onChange={(e) => setScheduleTimezone(e.target.value)}
                      placeholder="Timezone (optional, e.g. America/New_York)"
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="grid gap-1 md:col-span-2">
                    <label className="text-xs text-muted-foreground">
                      Session ID
                      <InfoTip text="Optional session ID to reuse a specific session." />
                    </label>
                    <input
                      type="text"
                      value={scheduleSessionId}
                      onChange={(e) => setScheduleSessionId(e.target.value)}
                      placeholder="Session ID (optional)"
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <textarea
                  value={schedulePrompt}
                  onChange={(e) => setSchedulePrompt(e.target.value)}
                  placeholder="Prompt to run on schedule"
                  className="w-full min-h-[90px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                />
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  Prompt
                  <InfoTip text="Prompt that will be run at the scheduled times." />
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border/60 p-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      Reuse session context
                      <InfoTip text="Keeps one continuous session across runs (useful for follow-up tasks). Requires a session ID if you want a fixed thread." />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Keep one continuous session across scheduled runs.
                    </p>
                  </div>
                  <button
                    onClick={() => setScheduleReuseSession((prev) => !prev)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-accomplish ${
                      scheduleReuseSession ? 'bg-primary' : 'bg-muted'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-accomplish ${
                        scheduleReuseSession ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <ButtonTip text="Create or update this schedule.">
                    <Button onClick={handleCreateSchedule} disabled={savingSchedule}>
                      {savingSchedule ? 'Saving...' : 'Add schedule'}
                    </Button>
                  </ButtonTip>
                  <ButtonTip text="Reload saved schedules.">
                    <Button variant="outline" onClick={refreshSchedules} disabled={loadingSchedules}>
                      Refresh
                    </Button>
                  </ButtonTip>
                </div>
                {scheduleError && <p className="text-xs text-destructive">{scheduleError}</p>}
              </div>

              <div className="space-y-3">
                {loadingSchedules ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading schedules...
                  </div>
                ) : schedules.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No schedules yet.</p>
                ) : (
                  schedules.map((schedule) => (
                    <div key={schedule.id} className="flex flex-col gap-3 rounded-xl border border-border/60 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-sm font-medium text-foreground">{schedule.name}</div>
                          <p className="text-xs text-muted-foreground">{schedule.prompt}</p>
                          <p className="mt-2 text-xs text-muted-foreground">
                            Cron: {schedule.cron}{schedule.timezone ? ` • ${schedule.timezone}` : ''}
                          </p>
                          {schedule.workingDirectory ? (
                            <p className="text-xs text-muted-foreground">Folder: {schedule.workingDirectory}</p>
                          ) : scheduleFallbackWorkspace ? (
                            <p className="text-xs text-muted-foreground">Folder: {scheduleFallbackWorkspace} (default)</p>
                          ) : null}
                          {schedule.reuseSession && (
                            <p className="text-xs text-muted-foreground">Session reuse enabled</p>
                          )}
                          {schedule.nextRunAt && (
                            <p className="text-xs text-muted-foreground">Next run: {new Date(schedule.nextRunAt).toLocaleString()}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <ButtonTip text={schedule.enabled ? 'Disable this schedule.' : 'Enable this schedule.'}>
                            <button
                              onClick={() => handleToggleSchedule(schedule.id, !schedule.enabled)}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-accomplish ${
                                schedule.enabled ? 'bg-primary' : 'bg-muted'
                              }`}
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-accomplish ${
                                  schedule.enabled ? 'translate-x-6' : 'translate-x-1'
                                }`}
                              />
                            </button>
                          </ButtonTip>
                          <ButtonTip text="Run this schedule immediately.">
                            <Button size="sm" variant="outline" onClick={() => handleRunScheduleNow(schedule.id)}>
                              Run
                            </Button>
                          </ButtonTip>
                          <ButtonTip text="Delete this schedule.">
                            <Button size="sm" variant="destructive" onClick={() => handleDeleteSchedule(schedule.id)}>
                              Delete
                            </Button>
                          </ButtonTip>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            )}
          </section>

          <section>
            <h2 className="mb-4 text-base font-medium text-foreground">
              Messaging Connector Extensions
              <InfoTip text="Configure Clawdbot-style gateway channels for additional chat platforms. Some connectors are first-party runtimes, while bridge connectors use worker endpoints and then route through gateway sessions." />
            </h2>
            {isSettingsSectionExpandedByHeading('Messaging Connector Extensions') && (
              <div className="rounded-lg border border-border bg-card p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">
                    Added channels: Discord, Telegram, BlueBubbles, Google Chat, iMessage, LINE, Matrix, Mattermost,
                    Microsoft Teams, Nextcloud Talk, Nostr, Signal, Slack, Tlon, WhatsApp, Zalo OA, Zalo User.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={gatewayConnectorCreateType}
                      onChange={(e) => setGatewayConnectorCreateType(e.target.value)}
                      className="min-w-[140px] rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                    >
                      {Array.from(
                        new Map(
                          gatewayConnectorExtensions.map((entry) => [entry.definition.id, entry.definition] as const)
                        ).values()
                      ).map((definition) => (
                        <option key={definition.id} value={definition.id}>
                          {definition.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={gatewayConnectorCreateName}
                      onChange={(e) => setGatewayConnectorCreateName(e.target.value)}
                      placeholder="New instance name (optional)"
                      className="w-[180px] min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleCreateGatewayConnectorInstance()}
                      disabled={gatewayConnectorInstanceCreating || !gatewayConnectorCreateType}
                    >
                      {gatewayConnectorInstanceCreating ? 'Adding...' : 'Add instance'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void refreshGatewayConnectorExtensions()} disabled={gatewayConnectorLoading}>
                      {gatewayConnectorLoading ? 'Refreshing...' : 'Refresh'}
                    </Button>
                  </div>
                </div>

                {gatewayConnectorLoading ? (
                  <p className="text-xs text-muted-foreground">Loading messaging connector extensions…</p>
                ) : gatewayConnectorExtensions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No messaging connector extensions found.</p>
                ) : (
                  <div className="grid gap-4 lg:grid-cols-[190px_minmax(0,1fr)]">
                    <div className="space-y-2">
                      {gatewayConnectorExtensions.map((entry) => {
                        const isActive = selectedGatewayConnector?.runtimeKey === entry.runtimeKey;
                        const runtimeStatus = gatewayConnectorRuntimeStatusById.get(
                          entry.runtimeKey || `${entry.definition.id}:${entry.config.instanceId ?? 'default'}`
                        );
                        const runtimeLabel = formatGatewayConnectorRuntimeLabel(entry.definition.id, runtimeStatus);
                        const requiresPublicWebUrl = BRIDGE_GATEWAY_RUNTIME_CONNECTOR_IDS.has(entry.definition.id);
                        return (
                          <button
                            type="button"
                            key={entry.runtimeKey || `${entry.definition.id}:${entry.config.instanceId ?? 'default'}`}
                            onClick={() => setGatewayConnectorSelectedId(entry.runtimeKey || entry.definition.id)}
                            className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                              isActive ? 'border-primary bg-primary/5' : 'border-border/70 bg-background/60 hover:bg-muted/40'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                                {renderMessagingConnectorIcon(entry.definition.id)}
                                <span>{entry.definition.name}</span>
                              </div>
                              <span className="text-[10px] text-muted-foreground">{entry.config.enabled ? 'ON' : 'OFF'}</span>
                            </div>
                            <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                              <span className="min-w-0 truncate">{entry.config.name || entry.config.instanceId || 'default'}</span>
                              {requiresPublicWebUrl && (
                                <span
                                  title="This messaging channel only works when your app is deployed with a public HTTPS URL."
                                  className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0 text-[9px] font-medium leading-4 text-amber-700"
                                >
                                  Public Web URL Required
                                </span>
                              )}
                            </div>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              {entry.secretSet ? 'Secret set' : 'No secret'}
                            </div>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              {runtimeLabel}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {selectedGatewayConnector && (
                      <div className="min-w-0 space-y-4 rounded-xl border border-border/70 bg-background/40 p-4">
                        <div>
                          <div className="text-sm font-medium text-foreground">{selectedGatewayConnector.definition.name}</div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Instance: <span className="font-mono">{selectedGatewayConnector.config.name || selectedGatewayConnector.config.instanceId || 'default'}</span>
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">{selectedGatewayConnector.definition.description}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Channel ID: <span className="font-mono">{selectedGatewayConnector.definition.channel}</span> • Binding ID:{' '}
                            <span className="font-mono">{selectedGatewayConnector.bindingId}</span>
                          </p>
                          {selectedGatewayConnectorRuntimeMode === 'native' && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Native runtime enabled: this connector is handled directly by Open Deskmate.
                            </p>
                          )}
                          {selectedGatewayConnectorRuntimeMode === 'first-party' && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              First-party runtime enabled: this connector is handled directly by Open Deskmate (no external bridge worker required).
                            </p>
                          )}
                          {selectedGatewayConnectorRuntimeMode === 'external-bridge' && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              External bridge runtime: configure Bridge URL plus bridge endpoints/credentials for this connector.
                            </p>
                          )}
                        </div>

                        {selectedGatewayConnectorHasRuntimeControls && (
                          <div className="space-y-3 rounded-xl border border-border/60 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-sm font-medium text-foreground">
                                Connector runtime status
                                <InfoTip text="Shows whether this connector runtime is configured and running. Use Test, Discover, and Restart to validate credentials and connectivity." />
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void handleTestGatewayConnectorRuntime()}
                                  disabled={gatewayConnectorRuntimeTesting}
                                >
                                  {gatewayConnectorRuntimeTesting ? 'Testing...' : 'Test connection'}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void handleDiscoverGatewayConnectorRuntimeTargets()}
                                  disabled={gatewayConnectorRuntimeDiscovering}
                                >
                                  {gatewayConnectorRuntimeDiscovering ? 'Discovering...' : 'Discover targets'}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void handleRestartGatewayConnectorRuntime()}
                                  disabled={gatewayConnectorRuntimeRestarting}
                                >
                                  {gatewayConnectorRuntimeRestarting ? 'Restarting...' : 'Restart runtime'}
                                </Button>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Running: {selectedGatewayConnectorRuntimeStatus?.running ? 'Yes' : 'No'} • Configured:{' '}
                              {selectedGatewayConnectorRuntimeStatus?.configured ? 'Yes' : 'No'}
                              {selectedGatewayConnectorRuntimeStatus?.accountId
                                ? ` • Account: ${selectedGatewayConnectorRuntimeStatus.accountId}`
                                : ''}
                              {selectedGatewayConnectorRuntimeStatus?.botUserId
                                ? ` • Bot/User: ${selectedGatewayConnectorRuntimeStatus.botUserId}`
                                : ''}
                            </p>
                            {selectedGatewayConnectorRuntimeStatus?.lastPollAt && (
                              <p className="text-[11px] text-muted-foreground">
                                Last poll: {formatIsoDateTime(selectedGatewayConnectorRuntimeStatus.lastPollAt)}
                              </p>
                            )}
                            {selectedGatewayConnectorRuntimeStatus?.lastError && (
                              <p className="text-[11px] text-destructive">
                                Last error: {selectedGatewayConnectorRuntimeStatus.lastError}
                              </p>
                            )}
                            {selectedGatewayConnectorRuntimeStatus?.detail && (
                              <p className="text-[11px] text-muted-foreground">
                                {selectedGatewayConnectorRuntimeStatus.detail}
                              </p>
                            )}
                            {gatewayConnectorRuntimeTestResult && (
                              <p className={`text-[11px] ${gatewayConnectorRuntimeTestResult.ok ? 'text-emerald-600' : 'text-destructive'}`}>
                                Test result: {gatewayConnectorRuntimeTestResult.detail}
                              </p>
                            )}
                            {gatewayConnectorRuntimeDiscoveryItems.length > 0 && (
                              <div className="rounded-md border border-border/50 p-2 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-[11px] font-medium text-foreground">
                                    Discovered targets: {gatewayConnectorRuntimeDiscoveryItems.length}
                                  </p>
                                  <Button size="sm" variant="outline" onClick={handleApplyDiscoveredTargetsToAllowlist}>
                                    Use as allowlist
                                  </Button>
                                </div>
                                <div className="max-h-40 overflow-auto space-y-1">
                                  {gatewayConnectorRuntimeDiscoveryItems.slice(0, 30).map((item) => (
                                    <div key={item.id} className="text-[11px] text-foreground">
                                      <span className="font-mono">{item.id}</span>
                                      <span className="ml-2 text-muted-foreground">{item.name} • {item.kind}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            <div className="grid gap-3 md:grid-cols-2">
                              <div className="grid gap-1">
                                <label className="text-xs text-muted-foreground">
                                  Command prefix
                                  <InfoTip text="Prefix used to invoke bot commands in non-DM chats (for example !desk)." />
                                </label>
                                <input
                                  type="text"
                                  value={gatewayConnectorRuntimeCommandPrefix}
                                  onChange={(e) => setGatewayConnectorRuntimeCommandPrefix(e.target.value)}
                                  placeholder="!desk"
                                  className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm"
                                />
                              </div>
                              <div className="grid gap-1">
                                <label className="text-xs text-muted-foreground">
                                  Poll interval (ms)
                                  <InfoTip text="How often this runtime polls the provider API for new events. Lower values respond faster but increase API usage and rate-limit pressure." />
                                </label>
                                <input
                                  type="text"
                                  value={gatewayConnectorRuntimePollIntervalMs}
                                  onChange={(e) => setGatewayConnectorRuntimePollIntervalMs(e.target.value)}
                                  placeholder="5000"
                                  className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm"
                                />
                              </div>
                            </div>
                            <div className="flex items-center justify-between rounded-md border border-border/50 px-3 py-2">
                              <p className="text-xs text-muted-foreground">
                                Require mention (non-DM)
                                <InfoTip text="When enabled, non-DM messages must mention the bot to be dispatched." />
                              </p>
                              <button
                                onClick={() => setGatewayConnectorRuntimeRequireMention((prev) => !prev)}
                                className={`relative inline-flex h-6 w-11 shrink-0 items-center overflow-hidden rounded-full transition-colors duration-200 ease-accomplish ${
                                  gatewayConnectorRuntimeRequireMention ? 'bg-primary' : 'bg-muted'
                                }`}
                              >
                                <span
                                  className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-accomplish ${
                                    gatewayConnectorRuntimeRequireMention ? 'translate-x-6' : 'translate-x-1'
                                  }`}
                                />
                              </button>
                            </div>
                            {selectedGatewayConnectorId === 'msteams' && (
                              <div className="grid gap-1">
                                <label className="text-xs text-muted-foreground">
                                  Bot user ID (optional fallback)
                                  <InfoTip text="Optional explicit bot account ID used for mention detection if provider metadata does not include it." />
                                </label>
                                <input
                                  type="text"
                                  value={gatewayConnectorRuntimeBotUserId}
                                  onChange={(e) => setGatewayConnectorRuntimeBotUserId(e.target.value)}
                                  placeholder="Graph user id"
                                  className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm"
                                />
                              </div>
                            )}
                            {selectedGatewayConnectorId === 'slack' && (
                              <p className="text-[11px] text-muted-foreground">
                                Setup: save Slack bot token as secret, set Allowed channel IDs to channel IDs, invite bot to those channels.
                              </p>
                            )}
                            {selectedGatewayConnectorId === 'matrix' && (
                              <p className="text-[11px] text-muted-foreground">
                                Setup: save Matrix access token as secret, set Bridge URL to client API base, set room IDs in Allowed channel IDs.
                              </p>
                            )}
                            {selectedGatewayConnectorId === 'msteams' && (
                              <p className="text-[11px] text-muted-foreground">
                                Setup: save Microsoft Graph bearer token as secret, set chat IDs in Allowed channel IDs.
                              </p>
                            )}
                            {selectedGatewayConnectorId === 'mattermost' && (
                              <p className="text-[11px] text-muted-foreground">
                                Setup: set Bridge URL to Mattermost server base URL, save personal access token as secret, set channel IDs in Allowed channel IDs.
                              </p>
                            )}
                            {selectedGatewayConnectorId === 'googlechat' && (
                              <p className="text-[11px] text-muted-foreground">
                                Setup: save Google OAuth bearer token as secret, set space IDs (e.g. spaces/AAA...) in Allowed channel IDs.
                              </p>
                            )}
                            {selectedGatewayConnectorId === 'line' && (
                              <p className="text-[11px] text-muted-foreground">
                                Setup: save LINE Channel Access Token as secret, add metadata <code className="rounded bg-muted px-1 py-0.5">line_channel_secret</code>, and set Bridge URL to local runtime <code className="rounded bg-muted px-1 py-0.5">http://127.0.0.1:9231</code> (default). Configure LINE webhook URL as <code className="rounded bg-muted px-1 py-0.5">https://your-public-host/connector/line/webhook</code> on the bridge host.
                              </p>
                            )}
                            {selectedGatewayConnectorId === 'whatsapp' && (
                              <p className="text-[11px] text-muted-foreground">
                                Setup: save WhatsApp Cloud API access token as secret, add metadata <code className="rounded bg-muted px-1 py-0.5">whatsapp_phone_number_id</code> + <code className="rounded bg-muted px-1 py-0.5">whatsapp_verify_token</code>, and set Bridge URL to <code className="rounded bg-muted px-1 py-0.5">http://127.0.0.1:9231</code> (default). Configure webhook URL as <code className="rounded bg-muted px-1 py-0.5">https://your-public-host/connector/whatsapp/webhook</code> in Meta.
                              </p>
                            )}
                            {selectedGatewayConnectorId === 'signal' && (
                              <p className="text-[11px] text-muted-foreground">
                                Setup: save your Signal provider auth token as secret, set metadata <code className="rounded bg-muted px-1 py-0.5">signal_sender</code> + <code className="rounded bg-muted px-1 py-0.5">signal_provider_base_url</code>, and set Bridge URL to <code className="rounded bg-muted px-1 py-0.5">http://127.0.0.1:9231</code> (default). Configure Signal provider webhook URL as <code className="rounded bg-muted px-1 py-0.5">https://your-public-host/connector/signal/webhook</code> on the bridge host.
                              </p>
                            )}
                            {selectedGatewayConnectorId === 'bluebubbles' && (
                              <p className="text-[11px] text-muted-foreground">
                                Setup: save your BlueBubbles API token as secret, set metadata <code className="rounded bg-muted px-1 py-0.5">bluebubbles_api_base_url</code>, and set Bridge URL to <code className="rounded bg-muted px-1 py-0.5">http://127.0.0.1:9231</code> (default). Configure BlueBubbles webhook delivery to <code className="rounded bg-muted px-1 py-0.5">https://your-public-host/connector/bluebubbles/webhook</code> on the bridge host.
                              </p>
                            )}
                            {selectedGatewayConnectorId === 'imessage' && (
                              <p className="text-[11px] text-muted-foreground">
                                Setup: save your iMessage provider API token as secret, set metadata <code className="rounded bg-muted px-1 py-0.5">imessage_api_base_url</code>, and set Bridge URL to <code className="rounded bg-muted px-1 py-0.5">http://127.0.0.1:9231</code> (default). Configure iMessage webhook delivery to <code className="rounded bg-muted px-1 py-0.5">https://your-public-host/connector/imessage/webhook</code> on the bridge host.
                              </p>
                            )}
                            {selectedGatewayConnectorId === 'nextcloud-talk' && (
                              <p className="text-[11px] text-muted-foreground">
                                Setup: save your Nextcloud app password/token as secret, set metadata <code className="rounded bg-muted px-1 py-0.5">nextcloud_api_base_url</code> plus auth fields (for app-password use <code className="rounded bg-muted px-1 py-0.5">nextcloud_auth_mode=basic</code> + <code className="rounded bg-muted px-1 py-0.5">nextcloud_username</code>), and set Bridge URL to <code className="rounded bg-muted px-1 py-0.5">http://127.0.0.1:9231</code> (default). Configure webhook delivery to <code className="rounded bg-muted px-1 py-0.5">https://your-public-host/connector/nextcloud-talk/webhook</code>.
                              </p>
                            )}
                            {selectedGatewayConnectorId === 'nostr' && (
                              <p className="text-[11px] text-muted-foreground">
                                Setup: save your Nostr relay/worker auth token as secret, set metadata <code className="rounded bg-muted px-1 py-0.5">nostr_api_base_url</code>, and set Bridge URL to <code className="rounded bg-muted px-1 py-0.5">http://127.0.0.1:9231</code> (default). Configure webhook delivery to <code className="rounded bg-muted px-1 py-0.5">https://your-public-host/connector/nostr/webhook</code> and tune send/auth fields in metadata.
                              </p>
                            )}
                            {selectedGatewayConnectorId === 'tlon' && (
                              <p className="text-[11px] text-muted-foreground">
                                Setup: save your Tlon/Urbit worker auth token as secret, set metadata <code className="rounded bg-muted px-1 py-0.5">tlon_api_base_url</code>, and set Bridge URL to <code className="rounded bg-muted px-1 py-0.5">http://127.0.0.1:9231</code> (default). Configure webhook delivery to <code className="rounded bg-muted px-1 py-0.5">https://your-public-host/connector/tlon/webhook</code> and tune send/auth fields in metadata.
                              </p>
                            )}
                            {selectedGatewayConnectorId === 'zalo' && (
                              <p className="text-[11px] text-muted-foreground">
                                Setup: save your Zalo OA worker auth token as secret, set metadata <code className="rounded bg-muted px-1 py-0.5">zalo_api_base_url</code>, and set Bridge URL to <code className="rounded bg-muted px-1 py-0.5">http://127.0.0.1:9231</code> (default). Configure webhook delivery to <code className="rounded bg-muted px-1 py-0.5">https://your-public-host/connector/zalo/webhook</code> and tune send/auth fields in metadata.
                              </p>
                            )}
                            {selectedGatewayConnectorId === 'zalouser' && (
                              <p className="text-[11px] text-muted-foreground">
                                Setup: save your Zalo user-channel worker auth token as secret, set metadata <code className="rounded bg-muted px-1 py-0.5">zalouser_api_base_url</code>, and set Bridge URL to <code className="rounded bg-muted px-1 py-0.5">http://127.0.0.1:9231</code> (default). Configure webhook delivery to <code className="rounded bg-muted px-1 py-0.5">https://your-public-host/connector/zalouser/webhook</code> and tune send/auth fields in metadata.
                              </p>
                            )}
                            {selectedGatewayConnectorUsesBridgeRuntime && (
                              <p className="text-[11px] text-muted-foreground">
                                Setup: set Bridge URL, save bridge auth token as secret, and ensure bridge exposes `/connector/v1/health`, `/connector/v1/events`, `/connector/v1/send`, `/connector/v1/targets`. Optional metadata: `mention_tokens`, `events_endpoint`, `send_endpoint`, `discover_endpoint`.
                              </p>
                            )}
                          </div>
                        )}

                        <div className="space-y-3 rounded-xl border border-border/60 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <div className="text-sm font-medium text-foreground">
                                Last seen IDs from incoming traffic
                                <InfoTip text="Observed user/group/channel/account IDs from recent messages. Use this to populate allowlists safely." />
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Use these discovered IDs to fill allowlists. Last seen:{' '}
                                <span className="font-mono">{formatIsoDateTime(selectedGatewayConnectorDiscovery?.lastSeenAt)}</span>
                              </p>
                            </div>
                            <div className="flex flex-col items-stretch gap-2 sm:items-end">
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] text-muted-foreground">
                                  Record IDs
                                  <InfoTip text="Per-connector switch for storing observed IDs from incoming traffic. Turn off to stop collecting new IDs for this connector." />
                                </span>
                                <button
                                  onClick={() => setGatewayConnectorRecordObservedIds((prev) => !prev)}
                                  className={`relative inline-flex h-6 w-11 shrink-0 items-center overflow-hidden rounded-full transition-colors duration-200 ease-accomplish ${
                                    gatewayConnectorRecordObservedIds ? 'bg-primary' : 'bg-muted'
                                  }`}
                                >
                                  <span
                                    className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-accomplish ${
                                      gatewayConnectorRecordObservedIds ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                                  />
                                </button>
                              </div>
                              <p className="text-[11px] text-muted-foreground">Applies on Save connector settings.</p>
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void handleClearGatewayConnectorDiscovery('selected')}
                                  disabled={gatewayConnectorDiscoveryClearing || !connectorDiscoveryHasAny}
                                >
                                  Clear this connector
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void handleClearGatewayConnectorDiscovery('all')}
                                  disabled={gatewayConnectorDiscoveryClearing || !gatewayConnectorDiscoveryHasAny}
                                >
                                  Clear all
                                </Button>
                              </div>
                            </div>
                          </div>

                          {!gatewayRecordConnectorDiscovery ? (
                            <p className="text-xs text-muted-foreground">
                              Global discovery recording is disabled in Gateway settings.
                            </p>
                          ) : !gatewayConnectorRecordObservedIds ? (
                            <p className="text-xs text-muted-foreground">
                              Discovery recording is disabled for this connector.
                            </p>
                          ) : !connectorDiscoveryHasAny ? (
                            <p className="text-xs text-muted-foreground">
                              No IDs observed yet. Send a message through this connector to populate discovery.
                            </p>
                          ) : (
                            <div className="grid gap-3 md:grid-cols-2">
                              {selectedGatewayConnectorObservedGroups.map((group) => (
                                <div key={group.key} className="rounded-md border border-border/50 p-2">
                                  <p className="text-[11px] font-medium text-foreground">
                                    {group.label}
                                    <span className="ml-1 font-normal text-muted-foreground">({group.hint})</span>
                                  </p>
                                  {group.values.length === 0 ? (
                                    <p className="mt-1 text-[11px] text-muted-foreground">None seen</p>
                                  ) : (
                                    <div className="mt-1 space-y-1">
                                      {group.values.slice(0, 8).map((value) => (
                                        <div key={value.id} className="text-[11px] text-foreground">
                                          <span className="font-mono">{value.id}</span>
                                          <span className="ml-2 text-muted-foreground">
                                            seen {value.count}x • {formatIsoDateTime(value.lastSeenAt)}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between rounded-xl border border-border/60 p-3">
                          <div>
                            <div className="text-sm font-medium text-foreground">
                              Enable connector
                              <InfoTip text="Master switch for this connector. Disabled connectors do not accept or route traffic." />
                            </div>
                            <p className="text-xs text-muted-foreground">Allows this extension channel in your gateway routing.</p>
                          </div>
                          <button
                            onClick={() => setGatewayConnectorEnabled((prev) => !prev)}
                            className={`relative inline-flex h-6 w-11 shrink-0 items-center overflow-hidden rounded-full transition-colors duration-200 ease-accomplish ${
                              gatewayConnectorEnabled ? 'bg-primary' : 'bg-muted'
                            }`}
                          >
                            <span
                              className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-accomplish ${
                                gatewayConnectorEnabled ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </div>

                        <div className="flex items-center justify-between rounded-xl border border-border/60 p-3">
                          <div>
                            <div className="text-sm font-medium text-foreground">
                              Auto-bind gateway routing
                              <InfoTip text="Automatically maintains channel binding so this connector routes to the selected agent/account scope." />
                            </div>
                            <p className="text-xs text-muted-foreground">Maintains a channel binding that routes this connector to one agent.</p>
                          </div>
                          <button
                            onClick={() => setGatewayConnectorAutoBindRouting((prev) => !prev)}
                            className={`relative inline-flex h-6 w-11 shrink-0 items-center overflow-hidden rounded-full transition-colors duration-200 ease-accomplish ${
                              gatewayConnectorAutoBindRouting ? 'bg-primary' : 'bg-muted'
                            }`}
                          >
                            <span
                              className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-accomplish ${
                                gatewayConnectorAutoBindRouting ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </div>

                        {selectedGatewayConnectorId === 'discord' && selectedGatewayConnector.config.instanceId === 'default' && (
                          <div className="space-y-3 rounded-xl border border-border/60 p-3">
                            <div className="text-sm font-medium text-foreground">
                              Discord connector runtime
                              <InfoTip text="First-party Discord runtime settings. Requires a Discord bot token and proper server/channel permissions." />
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Configured: {discordTokenSet ? 'Yes' : 'No'} • Running: {discordStatus?.running ? 'Yes' : 'No'}
                              {discordStatus?.botUser?.tag ? ` • Bot: ${discordStatus?.botUser?.tag}` : ''}
                            </p>
                            {discordStatus?.lastError && (
                              <p className="text-xs text-destructive">Last error: {discordStatus?.lastError}</p>
                            )}
                            <label className="text-xs text-muted-foreground">
                              Discord bot token
                              <InfoTip text="Create a Discord bot app, copy its bot token, and store it here. Regenerate in Discord Developer Portal if compromised." />
                            </label>
                            <input
                              type="password"
                              key={`discord-token-ext-${discordTokenSet ? 'set' : 'unset'}-${discordTokenInput.length}`}
                              ref={discordTokenInputRef}
                              defaultValue={discordTokenInput}
                              onBlur={(e) => setDiscordTokenInput(e.target.value)}
                              placeholder="Discord bot token"
                              className="rounded-md border border-input bg-background px-3 py-2 text-sm w-full"
                            />
                            <div className="flex flex-wrap items-center gap-2">
                              <Button onClick={handleSaveDiscordToken} disabled={discordTokenSaving}>
                                {discordTokenSaving ? 'Saving...' : 'Save token'}
                              </Button>
                              <Button variant="outline" onClick={handleClearDiscordToken} disabled={!discordTokenSet || discordTokenSaving}>
                                Clear token
                              </Button>
                              <Button variant="outline" onClick={refreshDiscordStatus} disabled={discordSaving}>
                                Refresh runtime
                              </Button>
                            </div>
                          </div>
                        )}

                        {selectedGatewayConnectorId === 'telegram' && selectedGatewayConnector.config.instanceId === 'default' && (
                          <div className="space-y-3 rounded-xl border border-border/60 p-3">
                            <div className="text-sm font-medium text-foreground">
                              Telegram connector runtime
                              <InfoTip text="First-party Telegram runtime settings. Requires a BotFather token and webhook/polling access from this app." />
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Configured: {telegramTokenSet ? 'Yes' : 'No'} • Running: {telegramStatus?.running ? 'Yes' : 'No'}
                              {telegramStatus?.botUser?.username ? ` • Bot: @${telegramStatus?.botUser?.username}` : ''}
                            </p>
                            {telegramStatus?.lastError && (
                              <p className="text-xs text-destructive">Last error: {telegramStatus?.lastError}</p>
                            )}
                            <label className="text-xs text-muted-foreground">
                              Telegram bot token
                              <InfoTip text="Get the token from @BotFather and store it here. Use a dedicated bot token for production." />
                            </label>
                            <input
                              type="password"
                              key={`telegram-token-ext-${telegramTokenSet ? 'set' : 'unset'}-${telegramTokenInput.length}`}
                              ref={telegramTokenInputRef}
                              defaultValue={telegramTokenInput}
                              onBlur={(e) => setTelegramTokenInput(e.target.value)}
                              placeholder="Telegram bot token"
                              className="rounded-md border border-input bg-background px-3 py-2 text-sm w-full"
                            />
                            <div className="flex flex-wrap items-center gap-2">
                              <Button onClick={handleSaveTelegramToken} disabled={telegramTokenSaving}>
                                {telegramTokenSaving ? 'Saving...' : 'Save token'}
                              </Button>
                              <Button variant="outline" onClick={handleClearTelegramToken} disabled={!telegramTokenSet || telegramTokenSaving}>
                                Clear token
                              </Button>
                              <Button variant="outline" onClick={refreshTelegramStatus} disabled={telegramSaving}>
                                Refresh runtime
                              </Button>
                            </div>

                            <div className="grid gap-2 rounded-lg border border-border/60 p-3">
                              <label className="text-xs font-medium text-foreground">
                                DM policy
                                <InfoTip text="Pairing = users must pair first. Open = any DM user unless allowlist is set. Disabled = ignore DMs." />
                              </label>
                              <select
                                value={telegramDmPolicy}
                                onChange={(e) => setTelegramDmPolicy(e.target.value as 'pairing' | 'open' | 'disabled')}
                                className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm"
                              >
                                <option value="pairing">Pairing (recommended)</option>
                                <option value="open">Open</option>
                                <option value="disabled">Disabled</option>
                              </select>

                              <label className="text-xs font-medium text-foreground">
                                Allowed Telegram group IDs (optional)
                                <InfoTip text="Restrict bot interactions in groups/supergroups to these Telegram chat IDs." />
                              </label>
                              <textarea
                                key={`telegram-group-ext-${telegramGroupAllowlist}`}
                                ref={telegramGroupAllowlistRef}
                                defaultValue={telegramGroupAllowlist}
                                onBlur={(e) => setTelegramGroupAllowlist(e.target.value)}
                                placeholder="e.g. -1001234567890"
                                className="w-full min-w-0 min-h-[72px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                              />
                              <p className="text-[11px] text-muted-foreground">
                                Leave empty to allow all groups that satisfy DM/pairing policy and connector checks.
                              </p>

                              <label className="text-xs font-medium text-foreground">
                                Allowed Telegram channel IDs (optional)
                                <InfoTip text="Restrict channel traffic to these Telegram channel chat IDs." />
                              </label>
                              <textarea
                                key={`telegram-channel-ext-${telegramChannelAllowlist}`}
                                ref={telegramChannelAllowlistRef}
                                defaultValue={telegramChannelAllowlist}
                                onBlur={(e) => setTelegramChannelAllowlist(e.target.value)}
                                placeholder="e.g. -1002223334445"
                                className="w-full min-w-0 min-h-[72px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                              />
                              <p className="text-[11px] text-muted-foreground">
                                Leave empty to allow all channels that satisfy connector policy.
                              </p>

                              <label className="text-xs font-medium text-foreground">
                                Allowed Telegram user IDs
                                <InfoTip text="Only these Telegram user IDs can message the bot in DMs when policy permits DMs." />
                              </label>
                              <textarea
                                key={`telegram-dm-ext-${telegramDmAllowlist}`}
                                ref={telegramDmAllowlistRef}
                                defaultValue={telegramDmAllowlist}
                                onBlur={(e) => setTelegramDmAllowlist(e.target.value)}
                                placeholder="e.g. 123456789, 987654321"
                                className="w-full min-w-0 min-h-[72px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                              />
                              <p className="text-[11px] text-muted-foreground">
                                Enter one or more Telegram user IDs (comma or space separated). Only these users are allowed.
                              </p>

                              <div className="flex flex-wrap items-center gap-2">
                                <Button onClick={() => void handleSaveTelegramAccessPolicy()} disabled={telegramSaving}>
                                  {telegramSaving ? 'Saving...' : 'Save Telegram access rules'}
                                </Button>
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="grid items-start gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                          <div className="grid min-w-0 gap-1">
                            <label className="flex items-center gap-1 text-xs text-muted-foreground">
                              <span className="whitespace-nowrap">Agent routing</span>
                              <InfoTip text="Select which agent handles traffic from this connector. Leave empty to use the global default agent." />
                            </label>
                            <select
                              value={gatewayConnectorAgentId}
                              onChange={(e) => setGatewayConnectorAgentId(e.target.value)}
                              className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm"
                            >
                              <option value="">Use default agent</option>
                              {agents.map((agent) => (
                                <option key={agent.id} value={agent.id}>
                                  {agent.name} ({agent.id})
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="grid min-w-0 gap-1">
                            <label className="flex items-center gap-1 text-xs text-muted-foreground">
                              <span className="whitespace-nowrap">Account match</span>
                              <InfoTip text="Optional account scope used for routing/session key matching. Leave empty to match all accounts." />
                            </label>
                            <input
                              type="text"
                              value={gatewayConnectorAccountId}
                              onChange={(e) => setGatewayConnectorAccountId(e.target.value)}
                              placeholder="Leave empty for *"
                              className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm"
                            />
                            {selectedGatewayConnectorId === 'telegram' && (
                              <p className="text-[11px] text-muted-foreground">
                                This is not a Telegram user ID. Use the Telegram user allowlist above.
                              </p>
                            )}
                          </div>
                        </div>

                        {!isNativeConnectorSelected && (
                          <>
                            <div className="grid gap-2 rounded-lg border border-border/60 p-3">
                              <label className="text-xs font-medium text-foreground">
                                Access policy
                                <InfoTip text="Controls who can talk to this connector. Use allowlist for strict per-user control." />
                              </label>
                              <select
                                value={gatewayConnectorAccessPolicyMode}
                                onChange={(e) =>
                                  setGatewayConnectorAccessPolicyMode(
                                    e.target.value === 'allowlist'
                                      ? 'allowlist'
                                      : e.target.value === 'disabled'
                                        ? 'disabled'
                                        : 'open'
                                  )
                                }
                                className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm"
                              >
                                <option value="open">Open</option>
                                <option value="allowlist">Allowlist only</option>
                                <option value="disabled">DM disabled</option>
                              </select>
                              <div className="grid gap-1">
                                <label className="text-xs text-muted-foreground">
                                  Allowed user IDs
                                  <InfoTip text="Comma, space, or newline-separated user IDs allowed to interact when using allowlist mode." />
                                </label>
                                <textarea
                                  value={gatewayConnectorAllowedUserIds}
                                  onChange={(e) => setGatewayConnectorAllowedUserIds(e.target.value)}
                                  placeholder="user_123, user_abc"
                                  className="w-full min-w-0 min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                                />
                              </div>
                              <div className="grid gap-1">
                                <label className="text-xs text-muted-foreground">
                                  Allowed group IDs (optional)
                                  <InfoTip text="Optional group/team/thread IDs allowed for this connector when applicable to the provider." />
                                </label>
                                <textarea
                                  value={gatewayConnectorAllowedGroupIds}
                                  onChange={(e) => setGatewayConnectorAllowedGroupIds(e.target.value)}
                                  placeholder="group_1, group_2"
                                  className="w-full min-w-0 min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                                />
                              </div>
                              <div className="grid gap-1">
                                <label className="text-xs text-muted-foreground">
                                  Allowed channel IDs (optional)
                                  <InfoTip text="Optional channel/room IDs allowed for traffic. Commonly used for Slack/Discord/Matrix/Teams." />
                                </label>
                                <textarea
                                  value={gatewayConnectorAllowedChannelIds}
                                  onChange={(e) => setGatewayConnectorAllowedChannelIds(e.target.value)}
                                  placeholder="channel_1, channel_2"
                                  className="w-full min-w-0 min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                                />
                              </div>
                              <div className="grid gap-1">
                                <label className="text-xs text-muted-foreground">
                                  Allowed account IDs (optional)
                                  <InfoTip text="Optional provider account IDs permitted for this connector. Useful for multi-account bridge deployments." />
                                </label>
                                <textarea
                                  value={gatewayConnectorAllowedAccountIds}
                                  onChange={(e) => setGatewayConnectorAllowedAccountIds(e.target.value)}
                                  placeholder="account_1, account_2"
                                  className="w-full min-w-0 min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                                />
                              </div>
                              <p className="text-[11px] text-muted-foreground">
                                These checks are enforced for both gateway `chat.send` and first-party connector runtime polling.
                              </p>
                            </div>

                            <div className="grid gap-1">
                              <label className="text-xs text-muted-foreground">
                                {connectorBridgeUrlLabel}
                                <InfoTip text="Base URL for this connector bridge endpoint. Must be reachable by Open Deskmate and expose required connector APIs." />
                              </label>
                              <input
                                type="text"
                                value={gatewayConnectorBridgeUrl}
                                onChange={(e) => setGatewayConnectorBridgeUrl(e.target.value)}
                                placeholder={connectorBridgeUrlPlaceholder}
                                className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm"
                              />
                            </div>

                            <div className="grid gap-1 min-w-0">
                              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <label className="text-xs text-muted-foreground">
                                  Metadata (key=value per line)
                                  <InfoTip text="Advanced connector-specific overrides. One key=value pair per line. Leave empty unless you need to override runtime defaults." />
                                </label>
                                {selectedGatewayConnectorMetadataTemplate && (
                                  <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="w-full sm:w-auto"
                                      onClick={handleMergeGatewayConnectorMetadataTemplate}
                                      disabled={gatewayConnectorSaving}
                                    >
                                      Merge template
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="w-full sm:w-auto"
                                      onClick={handleReplaceGatewayConnectorMetadataTemplate}
                                      disabled={gatewayConnectorSaving}
                                    >
                                      Replace template
                                    </Button>
                                  </div>
                                )}
                              </div>
                              <textarea
                                value={gatewayConnectorMetadataText}
                                onChange={(e) => setGatewayConnectorMetadataText(e.target.value)}
                                placeholder={connectorMetadataPlaceholder}
                                className="w-full min-w-0 min-h-[72px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                              />
                              {selectedGatewayConnectorMetadataTemplate && (
                                <>
                                  <p className="text-[11px] text-muted-foreground">
                                    {selectedGatewayConnectorMetadataTemplate.help}
                                  </p>
                                  <p className="text-[11px] text-muted-foreground">
                                    Template keys:{' '}
                                    <span className="font-mono">
                                      {selectedGatewayConnectorMetadataTemplate.lines.map(([key]) => key).join(', ')}
                                    </span>
                                  </p>
                                </>
                              )}
                            </div>

                            <div className="grid gap-1">
                              <label className="text-xs text-muted-foreground">
                                Notes
                                <InfoTip text="Internal setup notes for this connector. Stored locally for operators and not sent to providers." />
                              </label>
                              <textarea
                                value={gatewayConnectorNotes}
                                onChange={(e) => setGatewayConnectorNotes(e.target.value)}
                                placeholder="Internal setup notes for this connector."
                                className="w-full min-w-0 min-h-[72px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                              />
                            </div>
                          </>
                        )}

                        <div className="flex flex-wrap items-center gap-2">
                          <Button onClick={() => void handleSaveGatewayConnectorConfig()} disabled={gatewayConnectorSaving}>
                            {gatewayConnectorSaving ? 'Saving...' : 'Save connector settings'}
                          </Button>
                          <Button variant="outline" onClick={() => void refreshGatewayBindings()} disabled={gatewayBindingsLoading}>
                            Refresh bindings
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => void handleDeleteGatewayConnectorInstance()}
                            disabled={gatewayConnectorInstanceDeleting}
                          >
                            {gatewayConnectorInstanceDeleting ? 'Deleting...' : 'Delete instance'}
                          </Button>
                        </div>

                        <>
                            <div className="space-y-2 rounded-xl border border-border/60 p-3">
                              <div className="text-sm font-medium text-foreground">
                                Connector token / shared secret
                                <InfoTip text="For Discord/Telegram this is the bot token. For other connectors this is the API token/secret used by the connector runtime or external bridge." />
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Current status:{' '}
                                {selectedGatewayConnector.secretSet ? 'stored' : 'not set'}.
                              </p>
                              <label className="text-xs text-muted-foreground">
                                Token / secret
                                <InfoTip text="Paste your connector token here. For bridge connectors, this should match the bridge-side shared secret." />
                              </label>
                              <input
                                type="password"
                                value={gatewayConnectorSecretInput}
                                onChange={(e) => setGatewayConnectorSecretInput(e.target.value)}
                                placeholder="Connector token / shared secret"
                                className="rounded-md border border-input bg-background px-3 py-2 text-sm w-full"
                              />
                              <div className="flex flex-wrap items-center gap-2">
                                <Button onClick={() => void handleSaveGatewayConnectorSecret()} disabled={gatewayConnectorSecretSaving}>
                                  {gatewayConnectorSecretSaving ? 'Saving...' : 'Save secret'}
                                </Button>
                                <Button
                                  variant="outline"
                                  onClick={() => void handleGenerateGatewayConnectorSecret()}
                                  disabled={gatewayConnectorSecretSaving || isNativeConnectorSelected}
                                >
                                  Generate
                                </Button>
                                <Button variant="outline" onClick={() => void handleClearGatewayConnectorSecret()} disabled={gatewayConnectorSecretSaving || !selectedGatewayConnector.secretSet}>
                                  Clear secret
                                </Button>
                              </div>
                            </div>

                            {!isNativeConnectorSelected && (
                              <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                                <p className="text-xs text-muted-foreground">
                                  Bridge workers should call <span className="font-mono">{localGatewayUrl}/gateway/rpc</span> using
                                  method <span className="font-mono">chat.send</span> and set{' '}
                                  <span className="font-mono">channel={selectedGatewayConnector.definition.channel}</span>.
                                </p>
                              </div>
                            )}
                        </>
                      </div>
                    )}
                  </div>
                )}

                {gatewayConnectorStatus && <p className="text-xs text-emerald-600">{gatewayConnectorStatus}</p>}
                {gatewayConnectorError && <p className="text-xs text-destructive">{gatewayConnectorError}</p>}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-4 text-base font-medium text-foreground">
              App Connector Extensions
              <InfoTip text="Connect agents to app APIs (Notion, Trello, GitHub, Slack, Dropbox, Google Workspace, Microsoft Outlook, and more). Configure credentials per connector instance and route each instance to an agent." />
            </h2>
            {isSettingsSectionExpandedByHeading('App Connector Extensions') && (
              <div className="rounded-lg border border-border bg-card p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">
                    Add multiple instances per app (for example separate workspaces/accounts) and assign each one to a different agent.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={appConnectorCreateType}
                      onChange={(e) => setAppConnectorCreateType(e.target.value)}
                      className="min-w-[180px] rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                    >
                      {Array.from(
                        new Map(
                          appConnectorExtensions.map((entry) => [entry.definition.id, entry.definition] as const)
                        ).values()
                      ).map((definition) => (
                        <option key={definition.id} value={definition.id}>
                          {definition.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={appConnectorCreateName}
                      onChange={(e) => setAppConnectorCreateName(e.target.value)}
                      placeholder="New instance name (optional)"
                      className="w-[190px] min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleCreateAppConnectorInstance()}
                      disabled={appConnectorInstanceCreating || !appConnectorCreateType}
                    >
                      {appConnectorInstanceCreating ? 'Adding...' : 'Add instance'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void refreshAppConnectorExtensions()} disabled={appConnectorLoading}>
                      {appConnectorLoading ? 'Refreshing...' : 'Refresh'}
                    </Button>
                  </div>
                </div>

                {appConnectorLoading ? (
                  <p className="text-xs text-muted-foreground">Loading app connector extensions…</p>
                ) : appConnectorExtensions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No app connector extensions found.</p>
                ) : (
                  <div className="grid gap-4 lg:grid-cols-[190px_minmax(0,1fr)]">
                    <div className="space-y-2">
                      {appConnectorExtensions.map((entry) => {
                        const isActive = selectedAppConnector?.runtimeKey === entry.runtimeKey;
                        const runtimeStatus = appConnectorRuntimeStatusById.get(
                          entry.runtimeKey || `${entry.definition.id}:${entry.config.instanceId ?? 'default'}`
                        );
                        return (
                          <button
                            type="button"
                            key={entry.runtimeKey || `${entry.definition.id}:${entry.config.instanceId ?? 'default'}`}
                            onClick={() => setAppConnectorSelectedId(entry.runtimeKey || entry.definition.id)}
                            className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                              isActive ? 'border-primary bg-primary/5' : 'border-border/70 bg-background/60 hover:bg-muted/40'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                                {renderAppConnectorIcon(entry.definition.id)}
                                <span>{entry.definition.name}</span>
                              </div>
                              <span className="text-[10px] text-muted-foreground">{entry.config.enabled ? 'ON' : 'OFF'}</span>
                            </div>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              {entry.config.name || entry.config.instanceId || 'default'}
                            </div>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              {entry.secretSet ? 'Secret set' : 'No secret'}
                            </div>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              {runtimeStatus?.running ? 'Runtime on' : 'Runtime off'}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {selectedAppConnector && (
                      <div className="min-w-0 space-y-4 rounded-xl border border-border/70 bg-background/40 p-4">
                        <div>
                          <div className="text-sm font-medium text-foreground">{selectedAppConnector.definition.name}</div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Instance: <span className="font-mono">{selectedAppConnector.config.name || selectedAppConnector.config.instanceId || 'default'}</span>
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">{selectedAppConnector.definition.description}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Auth: <span className="font-mono">{selectedAppConnector.definition.authMethod}</span>
                            {selectedAppConnectorRuntimeStatus?.mode
                              ? ` • Runtime mode: ${selectedAppConnectorRuntimeStatus.mode}`
                              : ''}
                          </p>
                          {selectedAppConnector.definition.oauthScopesHint && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Suggested scopes: <span className="font-mono">{selectedAppConnector.definition.oauthScopesHint}</span>
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {selectedAppConnector.definition.docsUrl && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void getAccomplish().openExternal(selectedAppConnector.definition.docsUrl)}
                              >
                                Open provider docs
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleTestAppConnectorRuntime()}
                              disabled={appConnectorRuntimeTesting}
                            >
                              {appConnectorRuntimeTesting ? 'Testing...' : 'Test connection'}
                            </Button>
                          </div>
                          {selectedAppConnectorRuntimeStatus?.detail && (
                            <p className="mt-2 text-[11px] text-muted-foreground">
                              {selectedAppConnectorRuntimeStatus.detail}
                            </p>
                          )}
                          {selectedAppConnectorRuntimeStatus?.lastError && (
                            <p className="mt-1 text-[11px] text-destructive">
                              Last error: {selectedAppConnectorRuntimeStatus.lastError}
                            </p>
                          )}
                          {appConnectorRuntimeTestResult && (
                            <p className={`mt-1 text-[11px] ${appConnectorRuntimeTestResult.ok ? 'text-emerald-600' : 'text-destructive'}`}>
                              Test result: {appConnectorRuntimeTestResult.detail}
                            </p>
                          )}
                          {selectedAppConnector.definition.authMethod === 'oauth2' && (
                            <div className="mt-3 space-y-2 rounded-xl border border-border/60 p-3">
                              <div className="text-sm font-medium text-foreground">
                                OAuth connect
                                <InfoTip text="Use OAuth to authorize this connector. Tokens are stored securely after callback." />
                              </div>
                              <div className="rounded-md border border-amber-300/60 bg-amber-50/60 p-2 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100">
                                <div className="font-medium">
                                  Provider setup required
                                  <InfoTip text="Register one or more callback URLs in the provider console. OpenDeskmate can use desktop protocol, local loopback, or public HTTPS callback modes." />
                                </div>
                                <p className="mt-1">Add these redirect URIs in your provider app registration:</p>
                                <p className="mt-1 font-mono">{oauthDesktopCallbackUrl}</p>
                                <p className="mt-1 font-mono">{oauthLoopbackCallbackUrl}</p>
                                {oauthPublicCallbackUrl ? (
                                  <p className="mt-1 font-mono">{oauthPublicCallbackUrl}</p>
                                ) : (
                                  <p className="mt-1">
                                    Public URL not detected. Enable Gateway public URL (for example Tailscale) to use public callback mode.
                                  </p>
                                )}
                                <p className="mt-1 text-[11px]">
                                  Public callback format: <span className="font-mono">https://your-host/api/opendeskmate/callback</span>
                                </p>
                                <p className="mt-1 text-[11px]">
                                  If you only have an IP, use <span className="font-mono">https://203.0.113.10/api/opendeskmate/callback</span> (or include your port). Some providers reject raw IP callbacks and require a domain.
                                </p>
                                <p className="mt-1 text-[11px]">
                                  Public callbacks should use HTTPS. If HTTPS public callback is unavailable, use loopback mode.
                                </p>
                                <p className="mt-1 text-[11px]">
                                  Over Tailscale/public URL, use <span className="font-mono">https://your-tailnet-host/api/opendeskmate/callback</span> as your public redirect URI.
                                </p>
                                <p className="mt-1 text-[11px]">
                                  App connectors run inside this desktop app instance. Remote users can use them through agent tasks/webchat, but there is no direct public <span className="font-mono">/app-connectors/*</span> HTTP API.
                                </p>
                                <div className="mt-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void handleCopyAppConnectorOAuthRedirectUris()}
                                  >
                                    Copy redirect URIs
                                  </Button>
                                </div>
                              </div>
                              <div className="grid gap-1">
                                <label className="text-xs text-muted-foreground">
                                  OAuth redirect mode
                                  <InfoTip text="Auto prefers public callback when available, then local loopback. Use desktop to force accomplish://callback." />
                                </label>
                                <select
                                  value={appConnectorOauthRedirectMode}
                                  onChange={(e) => setAppConnectorOauthRedirectMode(e.target.value as 'auto' | 'desktop' | 'loopback' | 'public')}
                                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                                >
                                  <option value="auto">Auto (public if available, else loopback)</option>
                                  <option value="loopback">Local loopback HTTP callback</option>
                                  <option value="public">Public HTTPS callback</option>
                                  <option value="desktop">Desktop protocol (accomplish://callback)</option>
                                </select>
                                <p className="text-[11px] text-muted-foreground">
                                  Optional override: set <span className="font-mono">oauth_redirect_uri</span> in metadata for a fully custom callback URL.
                                </p>
                              </div>
                              <div className="grid gap-3">
                                <div className="grid gap-1">
                                  <label className="text-xs text-muted-foreground">
                                    OAuth client ID
                                    <InfoTip text="Client ID from your app registration in the provider developer console." />
                                  </label>
                                  <input
                                    type="text"
                                    value={appConnectorOauthClientId}
                                    onChange={(e) => setAppConnectorOauthClientId(e.target.value)}
                                    placeholder="Client ID"
                                    className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                                  />
                                </div>
                              </div>
                              <div className="grid gap-1">
                                  <label className="text-xs text-muted-foreground">
                                    OAuth client secret (if required)
                                    <InfoTip text="Required for providers like Notion. Save once to keep it in local secure storage for future OAuth reconnects." />
                                  </label>
                                  <input
                                    type="password"
                                    value={appConnectorOauthClientSecret}
                                    onChange={(e) => setAppConnectorOauthClientSecret(e.target.value)}
                                    placeholder="Client secret"
                                    className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                                  />
                                  <p className="text-[11px] text-muted-foreground">
                                    Stored status: {appConnectorOauthClientSecretStored ? 'saved in secure storage' : 'not saved'}.
                                  </p>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => void handleSaveAppConnectorOAuthClientSecret()}
                                      disabled={appConnectorOauthClientSecretSaving || !appConnectorOauthClientSecret.trim()}
                                    >
                                      {appConnectorOauthClientSecretSaving ? 'Saving...' : 'Save client secret'}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => void handleClearAppConnectorOAuthClientSecret()}
                                      disabled={appConnectorOauthClientSecretSaving || !appConnectorOauthClientSecretStored}
                                    >
                                      Clear saved secret
                                    </Button>
                                  </div>
                              </div>
                              <div className="grid gap-1">
                                <label className="text-xs text-muted-foreground">
                                  OAuth scopes (optional override)
                                  <InfoTip text="Space or comma separated scopes. Leave blank to use connector defaults/hints." />
                                </label>
                                <input
                                  type="text"
                                  value={appConnectorOauthScopes}
                                  onChange={(e) => setAppConnectorOauthScopes(e.target.value)}
                                  placeholder="openid email profile"
                                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                                />
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => void handleStartAppConnectorOAuth()}
                                  disabled={
                                    appConnectorOauthPending
                                    || appConnectorOauthDisconnecting
                                    || appConnectorOauthClientSecretSaving
                                    || (appConnectorOauthRedirectMode === 'public' && !oauthPublicCallbackUrl)
                                  }
                                >
                                  {appConnectorOauthPending ? 'Waiting for callback...' : 'Connect OAuth'}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void handleDisconnectAppConnectorOAuth()}
                                  disabled={appConnectorOauthPending || appConnectorOauthDisconnecting}
                                >
                                  {appConnectorOauthDisconnecting ? 'Disconnecting...' : 'Disconnect OAuth'}
                                </Button>
                              {appConnectorOauthFlowId && (
                                  <span className="text-[11px] text-muted-foreground">
                                    Flow ID: <span className="font-mono">{appConnectorOauthFlowId}</span>
                                  </span>
                                )}
                              </div>
                              {appConnectorOauthAuthorizeUrl && (
                                <div className="flex flex-wrap items-center gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void handleOpenAppConnectorOAuthAuthorizeUrl()}
                                  >
                                    Open OAuth URL
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void handleCopyAppConnectorOAuthAuthorizeUrl()}
                                  >
                                    Copy OAuth URL
                                  </Button>
                                </div>
                              )}
                              {appConnectorOauthRedirectMode === 'public' && !oauthPublicCallbackUrl && (
                                <p className="text-[11px] text-amber-700 dark:text-amber-300">
                                  Public callback URL was not detected. Configure Gateway public URL/Tailscale or switch redirect mode to loopback.
                                </p>
                              )}
                              {(selectedAppConnector.definition.id === 'slack' || selectedAppConnector.definition.id === 'notion') && (
                                <p className="text-[11px] text-muted-foreground">
                                  This provider requires OAuth client secret for token refresh.
                                </p>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="space-y-3">
                          <div className="flex items-center justify-between rounded-xl border border-border/60 p-3">
                            <div>
                              <div className="text-sm font-medium text-foreground">
                                Enable connector
                                <InfoTip text="Master switch for this app connector instance. Disabled instances cannot be used by agents." />
                              </div>
                              <p className="text-[11px] text-muted-foreground">
                                After changing this toggle, click Save connector settings.
                              </p>
                            </div>
                            <button
                              onClick={() => setAppConnectorEnabled((prev) => !prev)}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-accomplish ${
                                appConnectorEnabled ? 'bg-primary' : 'bg-muted'
                              }`}
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-accomplish ${
                                  appConnectorEnabled ? 'translate-x-6' : 'translate-x-1'
                                }`}
                              />
                            </button>
                          </div>

                          <div className="flex items-center justify-between rounded-xl border border-border/60 p-3">
                            <div>
                              <div className="text-sm font-medium text-foreground">
                                Auto-bind tools
                                <InfoTip text="When enabled, agents can use this connector through app connector tools without manual runtime selection logic." />
                              </div>
                            </div>
                            <button
                              onClick={() => setAppConnectorAutoBindTools((prev) => !prev)}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-accomplish ${
                                appConnectorAutoBindTools ? 'bg-primary' : 'bg-muted'
                              }`}
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-accomplish ${
                                  appConnectorAutoBindTools ? 'translate-x-6' : 'translate-x-1'
                                }`}
                              />
                            </button>
                          </div>

                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="grid gap-1">
                              <label className="text-xs text-muted-foreground">
                                Route to agent (optional)
                                <InfoTip text="Select which agent should own this connector instance. Leave empty to use default routing." />
                              </label>
                              <select
                                value={appConnectorAgentId}
                                onChange={(e) => setAppConnectorAgentId(e.target.value)}
                                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                              >
                                <option value="">Default agent</option>
                                {agents.map((agent) => (
                                  <option key={agent.id} value={agent.id}>
                                    {agent.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="grid gap-1">
                              <label className="text-xs text-muted-foreground">
                                Account match (optional)
                                <InfoTip text="Optional account identifier for multi-tenant API setups." />
                              </label>
                              <input
                                type="text"
                                value={appConnectorAccountId}
                                onChange={(e) => setAppConnectorAccountId(e.target.value)}
                                placeholder="workspace_1"
                                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                              />
                            </div>
                          </div>

                          <div className="grid gap-1">
                            <label className="text-xs text-muted-foreground">
                              {isSelectedAppConnectorObsidian ? 'Vault path (required)' : 'Base URL (optional override)'}
                              <InfoTip text={
                                isSelectedAppConnectorObsidian
                                  ? 'Set the local Obsidian vault folder path. Agents read and write notes in this folder.'
                                  : 'Override API base URL for custom hosts, self-hosted endpoints, or regional variants.'
                              }
                              />
                            </label>
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="text"
                                value={appConnectorBaseUrl}
                                onChange={(e) => setAppConnectorBaseUrl(e.target.value)}
                                placeholder={
                                  isSelectedAppConnectorObsidian
                                    ? 'C:\\Users\\you\\Documents\\ObsidianVault'
                                    : (selectedAppConnector.definition.defaultBaseUrl || 'https://api.example.com')
                                }
                                className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                              />
                              {isSelectedAppConnectorObsidian && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => void handleSelectObsidianVaultFolder()}
                                  disabled={appConnectorObsidianSelecting}
                                >
                                  {appConnectorObsidianSelecting ? 'Selecting...' : 'Select folder'}
                                </Button>
                              )}
                            </div>
                            {isSelectedAppConnectorObsidian && (
                              <p className="text-[11px] text-muted-foreground">
                                Choose the vault root folder. Save connector settings after selecting.
                              </p>
                            )}
                          </div>

                          {isSelectedAppConnectorEmailTriggers && (
                            <div className="space-y-2 rounded-xl border border-border/60 p-3">
                              <div className="text-sm font-medium text-foreground">
                                Webhook endpoint
                                <InfoTip text="URL that will receive email trigger events. This writes metadata.webhook_url for you." />
                              </div>
                              <input
                                type="url"
                                value={appConnectorWebhookUrl}
                                onChange={(e) => setAppConnectorWebhookUrl(e.target.value)}
                                placeholder="https://example.com/webhooks/email-triggers"
                                className="rounded-md border border-input bg-background px-3 py-2 text-sm w-full"
                              />
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  type="button"
                                  onClick={() => void handleSaveAppConnectorConfig()}
                                  disabled={appConnectorSaving}
                                >
                                  {appConnectorSaving ? 'Saving...' : 'Save webhook URL'}
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => void handleSendEmailTriggerTestEvent()}
                                  disabled={appConnectorWebhookTesting || appConnectorSaving || !appConnectorWebhookUrl.trim()}
                                >
                                  {appConnectorWebhookTesting ? 'Sending test...' : 'Send test event'}
                                </Button>
                              </div>
                            </div>
                          )}

                          <div className="grid gap-1 min-w-0">
                            <label className="text-xs text-muted-foreground">
                              Metadata (key=value per line, advanced)
                              <InfoTip text="Optional advanced overrides (for example oauth scopes, provider-specific headers, or custom endpoints). Most users can leave this empty." />
                            </label>
                            <textarea
                              value={appConnectorMetadataText}
                              onChange={(e) => setAppConnectorMetadataText(e.target.value)}
                              placeholder="api_key_location=header&#10;api_key_name=x-api-key"
                              className="w-full min-w-0 min-h-[72px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                            />
                          </div>

                          <div className="grid gap-1">
                            <label className="text-xs text-muted-foreground">
                              Notes
                              <InfoTip text="Internal operator notes for this connector instance." />
                            </label>
                            <textarea
                              value={appConnectorNotes}
                              onChange={(e) => setAppConnectorNotes(e.target.value)}
                              placeholder="Internal notes"
                              className="w-full min-w-0 min-h-[72px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                            />
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <Button onClick={() => void handleSaveAppConnectorConfig()} disabled={appConnectorSaving}>
                              {appConnectorSaving ? 'Saving...' : 'Save connector settings'}
                            </Button>
                            <Button variant="outline" onClick={() => void handleDeleteAppConnectorInstance()} disabled={appConnectorInstanceDeleting}>
                              {appConnectorInstanceDeleting ? 'Deleting...' : 'Delete instance'}
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-2 rounded-xl border border-border/60 p-3">
                          <div className="text-sm font-medium text-foreground">
                            Connector token / secret
                            <InfoTip text="Store OAuth access token, API key, personal access token, or shared secret used by this connector." />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Current status: {selectedAppConnector.secretSet ? 'stored' : 'not set'}.
                          </p>
                          <input
                            type="password"
                            value={appConnectorSecretInput}
                            onChange={(e) => setAppConnectorSecretInput(e.target.value)}
                            placeholder="Token / API key / secret"
                            className="rounded-md border border-input bg-background px-3 py-2 text-sm w-full"
                          />
                          <div className="flex flex-wrap items-center gap-2">
                            <Button onClick={() => void handleSaveAppConnectorSecret()} disabled={appConnectorSecretSaving}>
                              {appConnectorSecretSaving ? 'Saving...' : 'Save secret'}
                            </Button>
                            <Button variant="outline" onClick={() => void handleGenerateAppConnectorSecret()} disabled={appConnectorSecretSaving}>
                              Generate
                            </Button>
                            <Button variant="outline" onClick={() => void handleClearAppConnectorSecret()} disabled={appConnectorSecretSaving || !selectedAppConnector.secretSet}>
                              Clear secret
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {appConnectorStatus && <p className="text-xs text-emerald-600">{appConnectorStatus}</p>}
                {appConnectorError && <p className="text-xs text-destructive">{appConnectorError}</p>}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-4 text-base font-medium text-foreground">
              Voice Wake + Talk Mode
              <InfoTip text="Windows only. Requires a Picovoice access key for wake word detection. For transcription, install whisper.cpp and set binary + model paths, or use Web Speech if supported." />
            </h2>
            {isSettingsSectionExpandedByHeading('Voice Wake + Talk Mode') && (
            <div className="rounded-lg border border-border bg-card p-5 space-y-4">
              <div>
                <div className="font-medium text-foreground">Always listening trigger phrases</div>
                <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                  Configure wake words that mobile or desktop companions can listen for. Windows-only mic capture.
                </p>
              </div>

              <div className="grid gap-3">
                <label className="text-xs text-muted-foreground">
                  Picovoice access key
                  <InfoTip text="Get a Picovoice access key from the Picovoice Console. Required for wake word detection." />
                </label>
                <input
                  type="password"
                  key={`voice-access-key-${voiceWakeFormVersion}-${voiceWakeAccessKeySet ? 'set' : 'unset'}`}
                  ref={voiceWakeAccessKeyInputRef}
                  defaultValue={voiceWakeAccessKeyInput}
                  onBlur={(e) => setVoiceWakeAccessKeyInput(e.target.value)}
                  placeholder="Picovoice access key"
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  disabled={!isWindows}
                />
                <div className="flex flex-wrap gap-2 items-center">
                  <ButtonTip text="Save the Picovoice access key.">
                    <Button onClick={handleSaveVoiceWakeAccessKey} disabled={voiceWakeAccessKeySaving || !isWindows}>
                      {voiceWakeAccessKeySaving ? 'Saving...' : 'Save access key'}
                    </Button>
                  </ButtonTip>
                  <ButtonTip text="Remove the stored Picovoice access key.">
                    <Button
                      variant="outline"
                      onClick={handleClearVoiceWakeAccessKey}
                      disabled={!voiceWakeAccessKeySet || voiceWakeAccessKeySaving}
                    >
                      Clear key
                    </Button>
                  </ButtonTip>
                  {voiceWakeAccessKeySet && (
                    <span className="text-xs text-muted-foreground">Access key saved</span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-border/60 p-3">
                <div>
                  <div className="text-sm font-medium text-foreground">
                    Enable voice wake
                    <InfoTip text="Turns on wake word listening. Requires Windows mic permission and a Picovoice access key." />
                  </div>
                  <p className="text-xs text-muted-foreground">Requires Windows and mic permission.</p>
                </div>
                <button
                  onClick={() => setVoiceWakeEnabled((prev) => !prev)}
                  disabled={!isWindows}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-accomplish ${
                    voiceWakeEnabled ? 'bg-primary' : 'bg-muted'
                  } ${!isWindows ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-accomplish ${
                      voiceWakeEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-border/60 p-3">
                <div>
                  <div className="text-sm font-medium text-foreground">
                    Start mic on startup
                    <InfoTip text="When enabled, the mic starts listening as soon as the app opens." />
                  </div>
                  <p className="text-xs text-muted-foreground">When off, click the mic icon to enable each session.</p>
                </div>
                <button
                  onClick={() => setVoiceWakeAutoStart((prev) => !prev)}
                  disabled={!isWindows}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-accomplish ${
                    voiceWakeAutoStart ? 'bg-primary' : 'bg-muted'
                  } ${!isWindows ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-accomplish ${
                      voiceWakeAutoStart ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="grid gap-3">
                <label className="text-xs text-muted-foreground">
                  Wake words
                  <InfoTip text="Comma/space-separated wake words. Leave empty to use defaults." />
                </label>
                <textarea
                  key={`voice-triggers-${voiceWakeFormVersion}`}
                  ref={voiceWakeTriggersRef}
                  defaultValue={voiceWakeTriggers}
                  onBlur={(e) => setVoiceWakeTriggers(e.target.value)}
                  placeholder="Wake words (comma or space separated)"
                  className="w-full min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                  disabled={!isWindows}
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty to fall back to default triggers: clawd, claude, computer.
                </p>
              </div>

              <div className="rounded-xl border border-border/60 p-4 space-y-3">
                <div>
                  <div className="text-sm font-medium text-foreground">Talk mode behavior</div>
                  <p className="text-xs text-muted-foreground">
                    Wake word starts listening, converts speech to text, and inserts it into the prompt.
                  </p>
                </div>

                <div className="grid gap-2">
                  <label className="text-xs font-medium text-foreground">
                    Speech-to-text engine
                    <InfoTip text="Whisper = local transcription (install whisper.cpp). Web Speech = network-based transcription." />
                  </label>
                  <select
                    value={voiceWakeSttEngine}
                    onChange={(e) =>
                      setVoiceWakeSttEngine(e.target.value === 'web-speech' ? 'web-speech' : 'whisper')
                    }
                    disabled={!isWindows}
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="whisper">Local Whisper (whisper.cpp)</option>
                    <option value="web-speech">Web Speech (network)</option>
                  </select>
                </div>

                {voiceWakeSttEngine === 'whisper' && (
                  <div className="grid gap-2">
                    <label className="text-xs font-medium text-foreground">
                      Whisper binary path
                      <InfoTip text="Path to whisper.cpp CLI binary (whisper-cli.exe). Build from whisper.cpp or use a prebuilt binary." />
                    </label>
                    <input
                      type="text"
                      key={`voice-whisper-bin-${voiceWakeFormVersion}`}
                      ref={voiceWakeWhisperBinPathRef}
                      defaultValue={voiceWakeWhisperBinPath}
                      onBlur={(e) => setVoiceWakeWhisperBinPath(e.target.value)}
                      placeholder="C:\\path\\to\\whisper.cpp\\build\\bin\\Release\\whisper-cli.exe"
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                      disabled={!isWindows}
                    />
                    <label className="text-xs font-medium text-foreground">
                      Whisper model path
                      <InfoTip text="Path to a Whisper model file (ggml/gguf). Download from whisper.cpp model releases." />
                    </label>
                    <input
                      type="text"
                      key={`voice-whisper-model-${voiceWakeFormVersion}`}
                      ref={voiceWakeWhisperModelPathRef}
                      defaultValue={voiceWakeWhisperModelPath}
                      onBlur={(e) => setVoiceWakeWhisperModelPath(e.target.value)}
                      placeholder="C:\\path\\to\\models\\ggml-base.en.bin"
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                      disabled={!isWindows}
                    />
                    <label className="text-xs font-medium text-foreground">
                      Language
                      <InfoTip text="Language code for Whisper transcription (e.g., en)." />
                    </label>
                    <input
                      type="text"
                      key={`voice-whisper-language-${voiceWakeFormVersion}`}
                      ref={voiceWakeWhisperLanguageRef}
                      defaultValue={voiceWakeWhisperLanguage}
                      onBlur={(e) => setVoiceWakeWhisperLanguage(e.target.value)}
                      placeholder="en"
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                      disabled={!isWindows}
                    />
                  </div>
                )}

                <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
                  <div>
                    <div className="text-xs font-medium text-foreground">
                      Enable talk mode on wake
                      <InfoTip text="If on, a wake word immediately starts listening for speech." />
                    </div>
                    <p className="text-[11px] text-muted-foreground">Start listening when a wake word is detected.</p>
                  </div>
                  <button
                    onClick={() => setVoiceWakeTalkModeEnabled((prev) => !prev)}
                    disabled={!isWindows}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-accomplish ${
                      voiceWakeTalkModeEnabled ? 'bg-primary' : 'bg-muted'
                    } ${!isWindows ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-accomplish ${
                        voiceWakeTalkModeEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
                  <div>
                    <div className="text-xs font-medium text-foreground">
                      Auto-submit after transcription
                      <InfoTip text="If on, the prompt is automatically submitted when speech ends." />
                    </div>
                    <p className="text-[11px] text-muted-foreground">Submit the prompt automatically when speech ends.</p>
                  </div>
                  <button
                    onClick={() => setVoiceWakeAutoSubmit((prev) => !prev)}
                    disabled={!isWindows}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-accomplish ${
                      voiceWakeAutoSubmit ? 'bg-primary' : 'bg-muted'
                    } ${!isWindows ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-accomplish ${
                        voiceWakeAutoSubmit ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="grid gap-2">
                  <label className="text-xs font-medium text-foreground">
                    Insert mode
                    <InfoTip text="Append adds text to the existing prompt. Replace overwrites the prompt." />
                  </label>
                  <select
                    value={voiceWakeInsertMode}
                    onChange={(e) => setVoiceWakeInsertMode(e.target.value === 'replace' ? 'replace' : 'append')}
                    disabled={!isWindows}
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="append">Append to prompt</option>
                    <option value="replace">Replace prompt</option>
                  </select>
                </div>

                <div className="grid gap-2">
                  <label className="text-xs font-medium text-foreground">
                    Stop phrases
                    <InfoTip text="If detected, listening stops and the phrases are removed from the transcript." />
                  </label>
                  <textarea
                    key={`voice-stop-phrases-${voiceWakeFormVersion}`}
                    ref={voiceWakeStopPhrasesRef}
                    defaultValue={voiceWakeStopPhrases}
                    onBlur={(e) => setVoiceWakeStopPhrases(e.target.value)}
                    placeholder="stop listening, cancel, never mind"
                    className="w-full min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                    disabled={!isWindows}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    When detected, these phrases are removed from the transcript.
                  </p>
                </div>

                <div className="grid gap-2">
                  <label className="text-xs font-medium text-foreground">
                    Silence timeout (ms)
                    <InfoTip text="How long of silence before transcription stops and text is inserted." />
                  </label>
                  <input
                    type="number"
                    min={400}
                    max={5000}
                    key={`voice-silence-${voiceWakeFormVersion}`}
                    ref={voiceWakeSilenceMsRef}
                    defaultValue={voiceWakeSilenceMs}
                    onBlur={(e) => setVoiceWakeSilenceMs(e.target.value)}
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                    disabled={!isWindows}
                  />
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
                  <div>
                    <div className="text-xs font-medium text-foreground">
                      Play wake earcon
                      <InfoTip text="Plays a short sound when talk mode starts." />
                    </div>
                    <p className="text-[11px] text-muted-foreground">Audible cue when talk mode starts.</p>
                  </div>
                  <button
                    onClick={() => setVoiceWakeEarconEnabled((prev) => !prev)}
                    disabled={!isWindows}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-accomplish ${
                      voiceWakeEarconEnabled ? 'bg-primary' : 'bg-muted'
                    } ${!isWindows ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-accomplish ${
                        voiceWakeEarconEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <ButtonTip text="Save voice wake settings.">
                  <Button onClick={handleSaveVoiceWake} disabled={voiceWakeSaving || !isWindows}>
                    {voiceWakeSaving ? 'Saving...' : 'Save voice wake settings'}
                  </Button>
                </ButtonTip>
                <ButtonTip text="Reload voice wake configuration.">
                  <Button variant="outline" onClick={refreshVoiceWake} disabled={voiceWakeSaving}>
                    Refresh
                  </Button>
                </ButtonTip>
              </div>

              {!isWindows && (
                <p className="text-xs text-muted-foreground">
                  Voice wake is currently supported on Windows only.
                </p>
              )}

              {voiceWakeError && <p className="text-xs text-destructive">{voiceWakeError}</p>}
            </div>
            )}
          </section>

          <section>
            <h2 className="mb-4 text-base font-medium text-foreground">
              Mobile node companions (pilot)
              <InfoTip text="Use a phone as a companion device for camera snapshots. Steps: enable here, open the Companion link on your phone, request pairing, approve in this panel. For LAN access, set bind mode to All interfaces and restart." />
            </h2>
            {isSettingsSectionExpandedByHeading('Mobile node companions (pilot)') && (
            <div className="rounded-lg border border-border bg-card p-5 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium text-foreground">
                    Enable mobile node companions
                    <InfoTip text="Required to allow pairing and snapshot commands. Turn off to disable all companion access." />
                  </div>
                  <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                    Turn off to disable pairing and snapshot access for companion devices.
                  </p>
                </div>
                <ButtonTip text={mobileNodesEnabled ? 'Disable mobile nodes' : 'Enable mobile nodes'}>
                  <button
                    type="button"
                    onClick={handleMobileNodesToggle}
                    className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                      mobileNodesEnabled ? 'bg-primary' : 'bg-muted'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                        mobileNodesEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </ButtonTip>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium text-foreground">
                    Max live previews
                    <InfoTip text="Limits how many live preview streams can run at once. Increase if your network/device can handle it." />
                  </div>
                  <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                    Limit how many live previews can run at once (1–10).
                  </p>
                </div>
                <input
                  type="number"
                  min={1}
                  max={10}
                  key={`mobile-max-previews-${mobileNodesMaxLivePreviews}`}
                  ref={mobileNodesMaxLivePreviewsInputRef}
                  defaultValue={mobileNodesMaxLivePreviews}
                  onBlur={(e) => void handleMobileNodesMaxPreviewChange(e.target.value)}
                  className="h-9 w-20 rounded-md border border-border bg-background px-2 text-sm"
                  disabled={!mobileNodesEnabled}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium text-foreground">
                    Companion badge name
                    <InfoTip text="Optional label shown on the companion page (useful to identify which app instance the phone is pairing to)." />
                  </div>
                  <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                    Shows at the top of the companion page.
                  </p>
                </div>
                <input
                  type="text"
                  maxLength={64}
                  key={`mobile-display-name-${mobileNodesDisplayName}`}
                  ref={mobileNodesDisplayNameInputRef}
                  defaultValue={mobileNodesDisplayName}
                  onBlur={(e) => {
                    setMobileNodesDisplayNameState(e.target.value);
                    void handleMobileNodesNameBlur();
                  }}
                  className="h-9 w-52 rounded-md border border-border bg-background px-3 text-sm"
                  placeholder="e.g. Studio cam"
                  disabled={!mobileNodesEnabled}
                />
              </div>
              <div>
                <div className="font-medium text-foreground">
                  Pair companion devices
                  <InfoTip text="Steps: open the Companion link on the phone, tap Request pairing, then approve here. Copy endpoint only if integrating a custom companion client." />
                </div>
                <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                  Mobile nodes can provide camera, mic, and screen capture tools once paired.
                </p>
                {nodePairingEndpoint && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <ButtonTip text="POST /nodes/pair is used by the companion to request pairing.">
                      <span className="rounded-md bg-muted px-2 py-1">{nodePairingEndpoint}</span>
                    </ButtonTip>
                    <ButtonTip text="Copy the pairing endpoint URL.">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCopyNodePairingValue(nodePairingEndpoint, 'endpoint')}
                        disabled={!mobileNodesEnabled}
                      >
                        {nodePairingCopied === 'endpoint' ? 'Copied' : 'Copy endpoint'}
                      </Button>
                    </ButtonTip>
                  </div>
                )}
                {nodeCompanionEndpoint && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <ButtonTip text="Open this link on your phone to pair and provide snapshots.">
                      <span className="rounded-md bg-muted px-2 py-1">{nodeCompanionEndpoint}</span>
                    </ButtonTip>
                    <ButtonTip text="Copy the companion page URL.">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCopyNodePairingValue(nodeCompanionEndpoint, 'companion')}
                        disabled={!mobileNodesEnabled}
                      >
                        {nodePairingCopied === 'companion' ? 'Copied' : 'Copy companion link'}
                      </Button>
                    </ButtonTip>
                  </div>
                )}
              </div>

              <div className={`rounded-xl border border-border/60 p-3 space-y-2 ${!mobileNodesEnabled ? 'opacity-60' : ''}`}>
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-foreground">
                    Pending pairing requests
                    <InfoTip text="Requests from companion devices waiting for your approval. Approving generates a token and enables snapshots." />
                  </div>
                  <ButtonTip text="Reload pending and paired nodes.">
                    <Button size="sm" variant="outline" onClick={refreshNodePairing} disabled={nodePairingLoading || !mobileNodesEnabled}>
                      Refresh
                    </Button>
                  </ButtonTip>
                </div>
                {!mobileNodesEnabled ? (
                  <p className="text-xs text-muted-foreground">Mobile nodes are disabled.</p>
                ) : nodePairingLoading ? (
                  <p className="text-xs text-muted-foreground">Loading pairing requests…</p>
                ) : (nodePairing?.pending?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground">No pending pairing requests.</p>
                ) : (
                  <div className="space-y-2">
                    {nodePairing?.pending?.map((request) => (
                      <div key={request.requestId} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                            {request.displayName || request.nodeId}
                          </span>
                          <span className="text-muted-foreground">Node:</span>
                          <span className="font-medium text-foreground">{request.nodeId}</span>
                          {request.platform && (
                            <span className="text-muted-foreground">· {request.platform}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <ButtonTip text="Copy the node ID to share or verify.">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleCopyNodePairingValue(request.nodeId, `${request.nodeId}-id`)}
                              disabled={!mobileNodesEnabled}
                            >
                              {nodePairingCopied === `${request.nodeId}-id` ? 'Copied' : 'Copy node id'}
                            </Button>
                          </ButtonTip>
                          <ButtonTip text="Approve this pairing request and generate a token.">
                            <Button
                              size="sm"
                              onClick={() => handleApproveNodePairing(request.requestId)}
                              disabled={nodePairingApproving === request.requestId || !mobileNodesEnabled}
                            >
                              {nodePairingApproving === request.requestId ? 'Approving...' : 'Approve'}
                            </Button>
                          </ButtonTip>
                          <ButtonTip text="Cancel this pairing request.">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRejectNodePairing(request.requestId)}
                              disabled={nodePairingRejecting === request.requestId || !mobileNodesEnabled}
                            >
                              {nodePairingRejecting === request.requestId ? 'Canceling...' : 'Cancel pairing'}
                            </Button>
                          </ButtonTip>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className={`rounded-xl border border-border/60 p-3 space-y-2 ${!mobileNodesEnabled ? 'opacity-60' : ''}`}>
                <div className="text-sm font-medium text-foreground">
                  Paired nodes
                  <InfoTip text="Manage connected companions. Use Snapshot for one-off captures, Start Live for repeated camera previews, Start Mic for microphone audio, and Start Screen for screen sharing. Remove revokes access." />
                </div>
                <p className="text-xs text-muted-foreground">
                  Live preview refreshes every few seconds using repeated snapshots.
                </p>
                {!mobileNodesEnabled ? (
                  <p className="text-xs text-muted-foreground">Mobile nodes are disabled.</p>
                ) : (nodePairing?.paired?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground">No paired nodes yet.</p>
                ) : (
                  <div className="space-y-2">
                    {nodePairing?.paired?.map((node) => {
                      const badgeColor = resolveBadgeColor(node.nodeId, node.badgeColor);
                      const badgeIconId = resolveBadgeIcon(node.nodeId, node.badgeIcon);
                      const BadgeIcon = badgeIconMap[badgeIconId];
                      const badgeStyle = badgeColor
                        ? { backgroundColor: badgeColor, color: getReadableTextColor(badgeColor) }
                        : undefined;
                      const isBadgeChooserOpen = Boolean(nodeBadgeChooserOpen[node.nodeId]);

                      return (
                        <div
                          key={node.nodeId}
                          className="flex flex-col gap-3 rounded-lg border border-border/60 bg-background/50 p-3 text-xs"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className="inline-flex items-center gap-1 rounded-full bg-muted/80 px-2 py-0.5 text-muted-foreground"
                              style={badgeStyle}
                            >
                              {BadgeIcon ? <BadgeIcon className="h-3.5 w-3.5" /> : null}
                              <span>{node.displayName || node.nodeId}</span>
                            </span>
                            <span className="text-muted-foreground">Node:</span>
                            <span className="font-medium text-foreground">{node.nodeId}</span>
                            {node.platform && (
                              <span className="text-muted-foreground">· {node.platform}</span>
                            )}
                            <span className="text-muted-foreground">· {describeNodeLastSeen(node.lastConnectedAtMs)}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[11px] text-muted-foreground">Name</span>
                            <input
                              key={`node-name-${node.nodeId}-${node.displayName ?? ''}`}
                              ref={(el) => {
                                nodeNameInputRefs.current[node.nodeId] = el;
                              }}
                              defaultValue={nodeNameEdits[node.nodeId] ?? node.displayName ?? ''}
                              onBlur={(event) =>
                                setNodeNameEdits((prev) => ({ ...prev, [node.nodeId]: event.target.value }))
                              }
                              placeholder="Set display name"
                              className="h-8 w-44 rounded-md border border-border/60 bg-background px-2 text-xs text-foreground"
                              disabled={!mobileNodesEnabled}
                            />
                            <ButtonTip text="Save the display name for this node.">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleUpdatePairedNodeName(node.nodeId)}
                                disabled={!mobileNodesEnabled || nodeNameSaving === node.nodeId}
                                className="border-primary/40 text-primary hover:text-primary hover:bg-primary/10"
                              >
                                {nodeNameSaving === node.nodeId ? 'Saving...' : 'Save badge'}
                              </Button>
                            </ButtonTip>
                            <ButtonTip text="Expand icon & color chooser section for node display name badge">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setNodeBadgeChooserOpen((prev) => ({
                                    ...prev,
                                    [node.nodeId]: !prev[node.nodeId],
                                  }))
                                }
                                disabled={!mobileNodesEnabled}
                                className="border-primary/40 text-primary hover:text-primary hover:bg-primary/10"
                              >
                                Select Color & Icon
                              </Button>
                            </ButtonTip>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[11px] text-muted-foreground">AI access</span>
                            <ButtonTip text="Allow the AI to request camera, mic, and screen tools for this node.">
                              <button
                                type="button"
                                onClick={() => handleUpdatePairedNodeAiAccess(node.nodeId, !node.aiAccessAllowed)}
                                disabled={!mobileNodesEnabled || nodeNameSaving === node.nodeId}
                                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${
                                  node.aiAccessAllowed ? 'bg-emerald-500' : 'bg-muted'
                                }`}
                              >
                                <span
                                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                                    node.aiAccessAllowed ? 'translate-x-4' : 'translate-x-1'
                                  }`}
                                />
                              </button>
                            </ButtonTip>
                            <span className="text-[11px] text-muted-foreground">
                              {node.aiAccessAllowed ? 'Enabled' : 'Off'}
                            </span>
                          </div>
                          {isBadgeChooserOpen && (
                            <>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[11px] text-muted-foreground">Icon</span>
                                <div className="flex flex-wrap items-center gap-1">
                                  {NODE_BADGE_ICONS.map((iconOption) => {
                                    const IconComponent = iconOption.Icon;
                                    const selected =
                                      (nodeBadgeIconEdits[node.nodeId] ?? node.badgeIcon ?? 'monitor') ===
                                      iconOption.id;
                                    return (
                                      <button
                                        key={iconOption.id}
                                        type="button"
                                        onClick={() => {
                                          setNodeBadgeIconEdits((prev) => ({
                                            ...prev,
                                            [node.nodeId]: iconOption.id,
                                          }));
                                          void handleUpdatePairedNodeName(node.nodeId, { badgeIcon: iconOption.id });
                                        }}
                                        className={`h-7 w-7 rounded-md border ${
                                          selected ? 'border-primary bg-primary/10' : 'border-border/60 bg-background'
                                        } flex items-center justify-center`}
                                        title={iconOption.label}
                                      >
                                        <IconComponent className="h-3.5 w-3.5" />
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[11px] text-muted-foreground">Color</span>
                                <div className="flex flex-wrap items-center gap-1">
                                  {NODE_BADGE_COLORS.map((color) => {
                                    const selected =
                                      (nodeBadgeColorEdits[node.nodeId] ?? node.badgeColor ?? '') === color;
                                    return (
                                      <button
                                        key={color}
                                        type="button"
                                        onClick={() => {
                                          setNodeBadgeColorEdits((prev) => ({ ...prev, [node.nodeId]: color }));
                                          void handleUpdatePairedNodeName(node.nodeId, { badgeColor: color });
                                        }}
                                        className={`h-6 w-6 rounded-full border ${
                                          selected ? 'border-foreground' : 'border-border/60'
                                        }`}
                                        style={{ backgroundColor: color }}
                                        title={color}
                                      />
                                    );
                                  })}
                                </div>
                              </div>
                            </>
                          )}
                          <div className="flex flex-wrap items-center gap-2">
                            <ButtonTip text="Request a one-time snapshot from this node.">
                              <Button
                                size="sm"
                                onClick={() => handleRequestNodeSnapshot(node.nodeId)}
                                disabled={nodeSnapshotLoading === node.nodeId || !mobileNodesEnabled}
                              >
                                {nodeSnapshotLoading === node.nodeId ? 'Requesting...' : 'Snapshot'}
                              </Button>
                            </ButtonTip>
                            {livePreviewNodes.has(node.nodeId) ? (
                              <ButtonTip text="Stop live preview for this node.">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => stopLivePreview(node.nodeId)}
                                  disabled={!mobileNodesEnabled}
                                >
                                  Stop Live
                                </Button>
                              </ButtonTip>
                            ) : (
                              <ButtonTip text="Start live preview (repeated snapshots).">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => startLivePreview(node.nodeId)}
                                  disabled={!mobileNodesEnabled}
                                >
                                  Start Live
                                </Button>
                              </ButtonTip>
                            )}
                            {nodeMicStreams[node.nodeId] ? (
                              <ButtonTip text="Stop mic stream for this node.">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleStopMicStream(node.nodeId)}
                                  disabled={!mobileNodesEnabled}
                                >
                                  Stop Mic
                                </Button>
                              </ButtonTip>
                            ) : (
                              <ButtonTip text="Start mic stream (sends audio chunks).">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleStartMicStream(node.nodeId)}
                                  disabled={!mobileNodesEnabled}
                                >
                                  Start Mic
                                </Button>
                              </ButtonTip>
                            )}
                            {nodeScreenStreams[node.nodeId] ? (
                              <ButtonTip text="Stop screen stream for this node.">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleStopScreenStream(node.nodeId)}
                                  disabled={!mobileNodesEnabled}
                                >
                                  Stop Screen
                                </Button>
                              </ButtonTip>
                            ) : (
                              <ButtonTip text="Start screen stream (sends video chunks).">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleStartScreenStream(node.nodeId)}
                                  disabled={!mobileNodesEnabled}
                                >
                                  Start Screen
                                </Button>
                              </ButtonTip>
                            )}
                            <ButtonTip text="Remove this node and revoke its access.">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleRemovePairedNode(node.nodeId)}
                                disabled={!mobileNodesEnabled}
                              >
                                Remove
                              </Button>
                            </ButtonTip>
                            <ButtonTip text="Copy the node's auth token.">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleCopyNodePairingValue(node.token, `${node.nodeId}-token`)}
                                disabled={!mobileNodesEnabled}
                              >
                                {nodePairingCopied === `${node.nodeId}-token` ? 'Copied' : 'Copy token'}
                              </Button>
                            </ButtonTip>
                            <ButtonTip text="Copy the node ID.">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleCopyNodePairingValue(node.nodeId, `${node.nodeId}-paired`)}
                                disabled={!mobileNodesEnabled}
                              >
                                {nodePairingCopied === `${node.nodeId}-paired` ? 'Copied' : 'Copy node id'}
                              </Button>
                            </ButtonTip>
                          </div>
                          {(nodeLiveFrames[node.nodeId] ||
                            nodeSnapshots[node.nodeId] ||
                            nodeScreenChunks[node.nodeId] ||
                            nodeMicChunks[node.nodeId]) && (
                            <div className="w-full space-y-2">
                              {nodeLiveFrames[node.nodeId] && (
                                <div>
                                  <div className="text-[11px] text-muted-foreground mb-1">Live preview</div>
                                  <img
                                    src={nodeLiveFrames[node.nodeId]}
                                    alt={`Live preview from ${node.nodeId}`}
                                    className="max-h-48 rounded-md border border-border/60 object-contain"
                                  />
                                </div>
                              )}
                              {nodeSnapshots[node.nodeId] && (
                                <div>
                                  <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                                    <span>Snapshot</span>
                                    <ButtonTip text="Close the snapshot preview.">
                                      <button
                                        type="button"
                                        onClick={() => handleClearSnapshot(node.nodeId)}
                                        className="rounded-md px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent/60"
                                      >
                                        Close
                                      </button>
                                    </ButtonTip>
                                  </div>
                                  <img
                                    src={nodeSnapshots[node.nodeId]}
                                    alt={`Snapshot from ${node.nodeId}`}
                                    className="max-h-48 rounded-md border border-border/60 object-contain"
                                  />
                                </div>
                              )}
                              {nodeScreenStreamUrls[node.nodeId] && (
                                <div>
                                  <div className="text-[11px] text-muted-foreground mb-1">
                                    Screen stream (live)
                                  </div>
                                  <video
                                    src={nodeScreenStreamUrls[node.nodeId]}
                                    controls
                                    autoPlay
                                    onError={() => resetScreenMedia(node.nodeId)}
                                    className="max-h-48 rounded-md border border-border/60 object-contain w-full"
                                  />
                                </div>
                              )}
                              {!nodeScreenStreamUrls[node.nodeId] && nodeScreenBufferUrls[node.nodeId] && (
                                <div>
                                  <div className="text-[11px] text-muted-foreground mb-1">
                                    Screen stream (buffered)
                                  </div>
                                  <video
                                    src={nodeScreenBufferUrls[node.nodeId]}
                                    controls
                                    autoPlay
                                    className="max-h-48 rounded-md border border-border/60 object-contain w-full"
                                  />
                                </div>
                              )}
                              {nodeMicBufferUrls[node.nodeId] && (
                                <div>
                                  <div className="text-[11px] text-muted-foreground mb-1">Mic stream (buffered)</div>
                                  <audio src={nodeMicBufferUrls[node.nodeId]} controls autoPlay className="w-full" />
                                  <div className="flex flex-wrap items-center gap-2 text-xs mt-2">
                                    <ButtonTip text="Download the mic audio as MP3.">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleSaveAudio(node.nodeId)}
                                        disabled={!mobileNodesEnabled || audioSavingNode === node.nodeId}
                                      >
                                        {audioSavingNode === node.nodeId ? (
                                          <>
                                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                            Converting...
                                          </>
                                        ) : (
                                          'Save audio'
                                        )}
                                      </Button>
                                    </ButtonTip>
                                  </div>
                                </div>
                              )}
                              {nodeSnapshots[node.nodeId] && (
                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                  <ButtonTip text="Download the snapshot image.">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleSaveSnapshot(node.nodeId)}
                                      disabled={!mobileNodesEnabled}
                                    >
                                      Save image
                                    </Button>
                                  </ButtonTip>
                                  <ButtonTip text="Attach this snapshot to the next prompt.">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleAttachSnapshot(node.nodeId)}
                                      disabled={!mobileNodesEnabled}
                                    >
                                      {nodePairingCopied === `${node.nodeId}-attached` ? 'Attached' : 'Attach to prompt'}
                                    </Button>
                                  </ButtonTip>
                                  <ButtonTip text="Copy the snapshot data URL to clipboard.">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleCopySnapshot(node.nodeId)}
                                      disabled={!mobileNodesEnabled}
                                    >
                                      {nodePairingCopied === `${node.nodeId}-snapshot` ? 'Copied' : 'Copy data URL'}
                                    </Button>
                                  </ButtonTip>
                                  <span className="text-muted-foreground">
                                    Attach adds it to the next prompt’s file list.
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {nodePairingError && <p className="text-xs text-destructive">{nodePairingError}</p>}
            </div>
            )}
          </section>

          <section>
            <h2 className="mb-4 text-base font-medium text-foreground">
              Agents
              <InfoTip text="Create personas with different system prompts, tools, and workspace roots. No installs needed." />
            </h2>
            {isSettingsSectionExpandedByHeading('Agents') && (
            <>
            <div className="rounded-lg border border-border bg-card p-5 space-y-4">
              <div>
                <div className="font-medium text-foreground">Personas and workspaces</div>
                <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                  Agents keep separate task histories and default workspaces. Switch agents in the sidebar to change context.
                </p>
              </div>

              <div className="space-y-3">
                {agents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No agents yet.</p>
                ) : (
                  agents.map((agent) => {
                    return (
                    <div key={agent.id} className="flex flex-col gap-3 rounded-xl border border-border/60 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <div
                            className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg"
                            style={{
                              backgroundColor: agent.avatarColor ? `${agent.avatarColor}15` : 'hsl(var(--muted))',
                            }}
                          >
                            <AgentAvatarIcon
                              avatar={agent.avatar}
                              color={agent.avatarColor || 'hsl(var(--muted-foreground))'}
                              className="h-8 w-8"
                            />
                          </div>
                          <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-medium text-foreground">{agent.name}</div>
                            {agent.id === activeAgentId && (
                              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                                Active
                              </span>
                            )}
                            {agent.id === defaultAgentId && (
                              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                Default
                              </span>
                            )}
                          </div>
                          {agent.roleName && (
                            <div className="mt-1">
                              <span className="rounded-full bg-accent/60 px-2 py-0.5 text-[10px] font-medium text-foreground">
                                Role: {agent.roleName}
                              </span>
                            </div>
                          )}
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                              Model: {agent.selectedModel ? formatSelectedModelLabel(agent.selectedModel) : `Global (${formatSelectedModelLabel(selectedModel)})`}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                agent.agenticLoopEnabled
                                  ? 'bg-primary/10 text-primary'
                                  : 'bg-muted text-muted-foreground'
                              }`}
                            >
                              Active Automation Mode: {agent.agenticLoopEnabled ? 'Enabled' : 'Disabled'}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                agent.heartbeatEnabled
                                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-muted text-muted-foreground'
                              }`}
                            >
                              Heartbeat: {agent.heartbeatEnabled
                                ? (
                                  agent.heartbeatScheduleMode === 'daily'
                                    ? `Enabled (daily ${agent.heartbeatDailyTime || AGENT_HEARTBEAT_DEFAULT_DAILY_TIME})`
                                    : `Enabled (every ${agent.heartbeatIntervalMinutes ?? Math.max(1, Math.round((agent.heartbeatIntervalSeconds ?? (AGENT_HEARTBEAT_DEFAULT_INTERVAL_MINUTES * 60)) / 60))}m)`
                                )
                                : 'Disabled'}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                agent.autoSkillEnabled
                                  ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300'
                                  : 'bg-muted text-muted-foreground'
                              }`}
                            >
                              Auto skill creation: {agent.autoSkillEnabled ? 'Enabled' : 'Disabled'}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                agent.autoSkillAutoPromoteLowRisk
                                  ? 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                                  : 'bg-muted text-muted-foreground'
                              }`}
                            >
                              Auto-promote low risk: {agent.autoSkillAutoPromoteLowRisk ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{agent.description || 'No description'}</p>
                          {agent.workspaceRoot && (
                            <p className="text-xs text-muted-foreground mt-1">Workspace: {agent.workspaceRoot}</p>
                          )}
                          {agent.systemPromptAppend && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Persona: {agent.systemPromptAppend}
                            </p>
                          )}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {agent.id !== activeAgentId && (
                            <ButtonTip text="Set this agent as active for new tasks.">
                              <Button size="sm" variant="outline" onClick={() => handleSetActiveAgent(agent.id)}>
                                Set active
                              </Button>
                            </ButtonTip>
                          )}
                          {agent.id !== defaultAgentId && (
                            <ButtonTip text="Set this agent as the default on startup.">
                              <Button size="sm" variant="outline" onClick={() => handleSetDefaultAgent(agent.id)}>
                                Set default
                              </Button>
                            </ButtonTip>
                          )}
                          <ButtonTip text="Edit this agent.">
                            <Button size="sm" variant="outline" onClick={() => handleEditAgent(agent)}>
                              Edit
                            </Button>
                          </ButtonTip>
                          <ButtonTip text="Delete this agent (cannot delete the default agent).">
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleDeleteAgent(agent.id)}
                              disabled={agents.length <= 1 || agent.id === defaultAgentId}
                            >
                              Delete
                            </Button>
                          </ButtonTip>
                        </div>
                      </div>
                    </div>
                  );})
                )}
              </div>
              {agentError && <p className="text-xs text-destructive">{agentError}</p>}
            </div>

            <div className="mt-4 rounded-lg border border-border bg-card p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-foreground">Settings Assistants</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Configure model routing for in-settings assistants. Currently used by Skill Assistant and reused by future assistants.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openSkillAssistantDialog({ mode: 'general' })}
                >
                  Open Skill Assistant
                </Button>
              </div>

              <div className="rounded-lg border border-border/70 bg-background/70 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground">
                    Assistant model routing
                    <InfoTip text="Choose which model settings assistants use. Disable override to use the global model." />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-foreground">
                    <input
                      type="checkbox"
                      checked={skillAssistantModelOverrideEnabled}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        setSkillAssistantModelOverrideEnabled(enabled);
                        if (enabled && !skillAssistantModelId.trim()) {
                          applySkillAssistantModelForm(selectedModel ?? AGENT_FALLBACK_MODEL);
                        }
                      }}
                    />
                    Override global model
                  </label>
                </div>
                {!skillAssistantModelOverrideEnabled && (
                  <p className="text-xs text-muted-foreground">
                    Using global default: {formatSelectedModelLabel(selectedModel)}
                  </p>
                )}
                {skillAssistantModelOverrideEnabled && (
                  <div className="grid gap-3">
                    <div className="grid gap-1">
                      <label className="text-xs text-muted-foreground">Provider</label>
                      <select
                        value={skillAssistantModelProvider}
                        onChange={(e) => handleSkillAssistantModelProviderChange(e.target.value as ProviderType)}
                        className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        {modelProviders
                          .filter((entry) => entry.id !== 'ollama')
                          .map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.name}
                            </option>
                          ))}
                        <option value="ollama">Ollama</option>
                        <option value="custom">Custom (manual)</option>
                      </select>
                    </div>
                    {skillAssistantModelProvider !== 'ollama'
                      && (modelProviders.find((entry) => entry.id === skillAssistantModelProvider)?.models?.length ?? 0) > 0 && (
                      <div className="grid gap-1">
                        <label className="text-xs text-muted-foreground">Model</label>
                        <select
                          value={skillAssistantModelId}
                          onChange={(e) => setSkillAssistantModelId(e.target.value)}
                          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                        >
                          {(modelProviders.find((entry) => entry.id === skillAssistantModelProvider)?.models ?? []).map((model) => (
                            <option key={model.fullId} value={model.fullId}>
                              {model.displayName}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    {(skillAssistantModelProvider === 'custom'
                      || (skillAssistantModelProvider !== 'ollama'
                        && (modelProviders.find((entry) => entry.id === skillAssistantModelProvider)?.models?.length ?? 0) === 0)) && (
                      <div className="grid gap-1">
                        <label className="text-xs text-muted-foreground">Model ID</label>
                        <input
                          type="text"
                          value={skillAssistantModelId}
                          onChange={(e) => setSkillAssistantModelId(e.target.value)}
                          placeholder="provider/model-name"
                          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                        />
                      </div>
                    )}
                    {skillAssistantModelProvider === 'ollama' && (
                      <div className="grid gap-1">
                        <label className="text-xs text-muted-foreground">Ollama model</label>
                        {ollamaModels.length > 0 ? (
                          <select
                            value={skillAssistantModelId.replace(/^ollama\//, '')}
                            onChange={(e) => setSkillAssistantModelId(`ollama/${e.target.value}`)}
                            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                          >
                            {ollamaModels.map((model) => (
                              <option key={model.id} value={model.id}>
                                {model.displayName}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={skillAssistantModelId.replace(/^ollama\//, '')}
                            onChange={(e) => setSkillAssistantModelId(e.target.value)}
                            placeholder="llama3.1:8b"
                            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                          />
                        )}
                      </div>
                    )}
                    {(skillAssistantModelProvider === 'custom'
                      || skillAssistantModelProvider === 'ollama'
                      || Boolean(modelProviders.find((entry) => entry.id === skillAssistantModelProvider)?.baseUrl)) && (
                      <div className="grid gap-1">
                        <label className="text-xs text-muted-foreground">Base URL (optional)</label>
                        <input
                          type="text"
                          value={skillAssistantModelBaseUrl}
                          onChange={(e) => setSkillAssistantModelBaseUrl(e.target.value)}
                          placeholder={skillAssistantModelProvider === 'ollama' ? (ollamaUrl || 'http://localhost:11434') : 'https://api.example.com/v1'}
                          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                        />
                      </div>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => void handleSaveSkillAssistantModel()} disabled={skillAssistantModelSaving}>
                    {skillAssistantModelSaving ? 'Saving...' : 'Save assistant model'}
                  </Button>
                  {skillAssistantModelStatus && (
                    <span className="text-xs text-success">{skillAssistantModelStatus}</span>
                  )}
                </div>
                {skillAssistantModelError && (
                  <p className="text-xs text-destructive">{skillAssistantModelError}</p>
                )}
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-border bg-card p-5 space-y-4">
              <div className="font-medium text-foreground">
                {agentFormId ? 'Edit agent' : 'Create a new agent'}
              </div>
              <div className="grid gap-3">
                <div className="grid gap-1">
                  <label className="text-xs text-muted-foreground">
                    Agent name
                    <InfoTip text="Display name for this agent." />
                  </label>
                  <input
                    type="text"
                    key={`agent-name-${agentFormId ?? 'new'}-${agentFormVersion}`}
                    ref={agentNameInputRef}
                    defaultValue={agentName}
                    onBlur={(e) => setAgentName(e.target.value)}
                    placeholder="Agent name"
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div className="grid gap-1">
                  <label className="text-xs text-muted-foreground">
                    Role name
                    <InfoTip text="Optional role label shown beneath the agent name in switchers and settings." />
                  </label>
                  <input
                    type="text"
                    key={`agent-role-${agentFormId ?? 'new'}-${agentFormVersion}`}
                    ref={agentRoleNameInputRef}
                    defaultValue={agentRoleName}
                    onBlur={(e) => setAgentRoleName(e.target.value)}
                    placeholder="e.g. Planner, Researcher, Developer"
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div className="grid gap-1">
                  <label className="text-xs text-muted-foreground">
                    Avatar
                    <InfoTip text="Choose an icon and color for this agent." />
                  </label>
                  <AgentAvatarPicker
                    selectedAvatar={agentAvatar}
                    selectedColor={agentAvatarColor}
                    onAvatarChange={setAgentAvatar}
                    onColorChange={setAgentAvatarColor}
                  />
                </div>
                <div className="grid gap-1">
                  <label className="text-xs text-muted-foreground">
                    Description
                    <InfoTip text="Optional description shown in settings." />
                  </label>
                  <input
                    type="text"
                    key={`agent-description-${agentFormId ?? 'new'}-${agentFormVersion}`}
                    ref={agentDescriptionInputRef}
                    defaultValue={agentDescription}
                    onBlur={(e) => setAgentDescription(e.target.value)}
                    placeholder="Short description (optional)"
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div className="rounded-lg border border-border bg-background/60 p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-muted-foreground">
                      Model routing
                      <InfoTip text="Override provider/model for this agent, or inherit the global model." />
                    </label>
                    <label className="flex items-center gap-2 text-xs text-foreground">
                      <input
                        type="checkbox"
                        checked={agentModelOverrideEnabled}
                        onChange={(e) => {
                          const enabled = e.target.checked;
                          setAgentModelOverrideEnabled(enabled);
                          if (enabled && !agentModelId.trim()) {
                            applyAgentModelForm(selectedModel ?? AGENT_FALLBACK_MODEL);
                          }
                        }}
                      />
                      Override global model
                    </label>
                  </div>
                  {!agentModelOverrideEnabled && (
                    <p className="text-xs text-muted-foreground">
                      Using global default: {formatSelectedModelLabel(selectedModel)}
                    </p>
                  )}
                  {agentModelOverrideEnabled && (
                    <div className="grid gap-3">
                      <div className="grid gap-1">
                        <label className="text-xs text-muted-foreground">Provider</label>
                        <select
                          value={agentModelProvider}
                          onChange={(e) => handleAgentModelProviderChange(e.target.value as ProviderType)}
                          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                        >
                          {modelProviders
                            .filter((entry) => entry.id !== 'ollama')
                            .map((entry) => (
                              <option key={entry.id} value={entry.id}>
                                {entry.name} (Agent)
                              </option>
                            ))}
                          {!modelProviders.some((entry) => entry.id === agentModelProvider)
                            && agentModelProvider !== 'ollama'
                            && agentModelProvider !== 'custom' && (
                              <option value={agentModelProvider}>{agentModelProvider}</option>
                            )}
                          <option value="ollama">Ollama</option>
                          <option value="custom">Custom (manual)</option>
                        </select>
                      </div>
                      {agentModelProvider !== 'ollama'
                        && (modelProviders.find((entry) => entry.id === agentModelProvider)?.models?.length ?? 0) > 0 && (
                        <div className="grid gap-1">
                          <label className="text-xs text-muted-foreground">Model</label>
                          <select
                            value={agentModelId}
                            onChange={(e) => setAgentModelId(e.target.value)}
                            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                          >
                            {(modelProviders.find((entry) => entry.id === agentModelProvider)?.models ?? []).map((model) => (
                              <option key={model.fullId} value={model.fullId}>
                                {model.displayName}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      {(agentModelProvider === 'custom'
                        || (agentModelProvider !== 'ollama'
                          && (modelProviders.find((entry) => entry.id === agentModelProvider)?.models?.length ?? 0) === 0)) && (
                        <>
                          <div className="grid gap-1">
                            <label className="text-xs text-muted-foreground">Model ID</label>
                            <input
                              type="text"
                              value={agentModelId}
                              onChange={(e) => setAgentModelId(e.target.value)}
                              placeholder="provider/model-name"
                              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                            />
                          </div>
                        </>
                      )}
                      {agentModelProvider === 'ollama' && (
                        <>
                          <div className="grid gap-1">
                            <label className="text-xs text-muted-foreground">Ollama model</label>
                            {ollamaModels.length > 0 ? (
                              <select
                                value={agentModelId.replace(/^ollama\//, '')}
                                onChange={(e) => setAgentModelId(`ollama/${e.target.value}`)}
                                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                              >
                                {ollamaModels.map((model) => (
                                  <option key={model.id} value={model.id}>
                                    {model.displayName}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type="text"
                                value={agentModelId.replace(/^ollama\//, '')}
                                onChange={(e) => setAgentModelId(e.target.value)}
                                placeholder="llama3.1:8b"
                                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                              />
                            )}
                          </div>
                          <div className="grid gap-1">
                            <label className="text-xs text-muted-foreground">Ollama base URL (optional)</label>
                            <input
                              type="text"
                              value={agentModelBaseUrl}
                              onChange={(e) => setAgentModelBaseUrl(e.target.value)}
                              placeholder={ollamaUrl || 'http://localhost:11434'}
                              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                            />
                          </div>
                        </>
                      )}
                      {(agentModelProvider === 'custom'
                        || (agentModelProvider !== 'ollama'
                          && Boolean(modelProviders.find((entry) => entry.id === agentModelProvider)?.baseUrl))) && (
                        <div className="grid gap-1">
                          <label className="text-xs text-muted-foreground">Base URL (optional)</label>
                          <input
                            type="text"
                            value={agentModelBaseUrl}
                            onChange={(e) => setAgentModelBaseUrl(e.target.value)}
                            placeholder="https://api.example.com"
                            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="rounded-lg border border-border bg-background/60 p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-muted-foreground">
                      Active Automation Mode
                      <InfoTip text="Auto-continue work in think/plan/act/observe cycles until complete, max iterations, or timeout." />
                    </label>
                    <label className="flex items-center gap-2 text-xs text-foreground">
                      <input
                        type="checkbox"
                        checked={agentLoopEnabled}
                        onChange={(e) => {
                          const enabled = e.target.checked;
                          setAgentLoopEnabled(enabled);
                          if (!enabled && agentHeartbeatEnabled) {
                            setAgentHeartbeatEnabled(false);
                          }
                        }}
                      />
                      Enable mode
                    </label>
                  </div>
                  {agentLoopEnabled ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="grid gap-1">
                        <label className="text-xs text-muted-foreground">Max iterations (1-20)</label>
                        <input
                          type="number"
                          min={1}
                          max={20}
                          key={`agent-loop-max-${agentFormId ?? 'new'}-${agentFormVersion}`}
                          ref={agentLoopMaxIterationsInputRef}
                          defaultValue={agentLoopMaxIterations}
                          onBlur={(e) => setAgentLoopMaxIterations(e.target.value)}
                          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                        />
                      </div>
                      <div className="grid gap-1">
                        <label className="text-xs text-muted-foreground">Timeout seconds (15-3600)</label>
                        <input
                          type="number"
                          min={15}
                          max={3600}
                          key={`agent-loop-timeout-${agentFormId ?? 'new'}-${agentFormVersion}`}
                          ref={agentLoopTimeoutInputRef}
                          defaultValue={agentLoopTimeoutSeconds}
                          onBlur={(e) => setAgentLoopTimeoutSeconds(e.target.value)}
                          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Loop disabled. Agent runs one pass per request.
                    </p>
                  )}
                </div>
                <div className="rounded-lg border border-border bg-background/60 p-3 space-y-2">
                  <div className="text-xs text-muted-foreground">
                    Skill autonomy controls
                    <InfoTip text="Auto skill creation lets the agent draft reusable skills on its own. Auto-promote low risk allows those drafted skills to be promoted automatically only when risk is low." />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-muted-foreground">
                      Agent auto skill creation
                      <InfoTip text="Allow this agent to draft reusable skills when it detects repeatable workflows. You can disable this per agent." />
                    </label>
                    <label className="flex items-center gap-2 text-xs text-foreground">
                      <input
                        type="checkbox"
                        checked={agentAutoSkillEnabled}
                        onChange={(e) => {
                          const enabled = e.target.checked;
                          setAgentAutoSkillEnabled(enabled);
                          if (!enabled) {
                            setAgentAutoSkillAutoPromoteLowRisk(false);
                          }
                        }}
                      />
                      Enable auto skills
                    </label>
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-muted-foreground">
                      Auto-promote low-risk skills
                      <InfoTip text="When enabled, low-risk drafted skills can be promoted automatically. High-risk skills still require manual review." />
                    </label>
                    <label className="flex items-center gap-2 text-xs text-foreground">
                      <input
                        type="checkbox"
                        checked={agentAutoSkillAutoPromoteLowRisk}
                        disabled={!agentAutoSkillEnabled}
                        onChange={(e) => setAgentAutoSkillAutoPromoteLowRisk(e.target.checked)}
                      />
                      Enable auto-promotion
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {!agentAutoSkillEnabled
                      ? 'Auto skill creation is disabled. This agent will not auto-create new skills.'
                      : agentAutoSkillAutoPromoteLowRisk
                        ? 'Auto skill creation and low-risk auto-promotion are enabled.'
                        : 'Auto skill creation is enabled, but promotion still requires confirmation.'}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-background/60 p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-muted-foreground">
                      Heartbeat
                      <InfoTip text="Run periodic autonomous check-ins for this agent on an interval or at a daily time." />
                    </label>
                    <label className="flex items-center gap-2 text-xs text-foreground">
                      <input
                        type="checkbox"
                        checked={agentHeartbeatEnabled}
                        onChange={(e) => {
                          if (e.target.checked && !agentLoopEnabled) {
                            setShowHeartbeatAutomationModeDialog(true);
                            return;
                          }
                          setAgentHeartbeatEnabled(e.target.checked);
                        }}
                      />
                      Enable heartbeat
                    </label>
                  </div>
                  {agentHeartbeatEnabled ? (
                    <div className="grid gap-3">
                      <div className="grid gap-1">
                        <label className="text-xs text-muted-foreground">Schedule mode</label>
                        <select
                          value={agentHeartbeatScheduleMode}
                          onChange={(e) => setAgentHeartbeatScheduleMode(e.target.value === 'daily' ? 'daily' : 'interval')}
                          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                        >
                          <option value="interval">Every N minutes</option>
                          <option value="daily">Daily at specific time</option>
                        </select>
                      </div>
                      <div className="grid gap-1">
                        <label className="text-xs text-muted-foreground">
                          Time zone
                          <InfoTip text='Use "system" for your device timezone, or an IANA timezone like Europe/London.' />
                        </label>
                        <input
                          type="text"
                          list="agent-heartbeat-timezone-options"
                          key={`agent-heartbeat-timezone-${agentFormId ?? 'new'}-${agentFormVersion}`}
                          ref={agentHeartbeatTimeZoneInputRef}
                          defaultValue={agentHeartbeatTimeZone}
                          onBlur={(e) => setAgentHeartbeatTimeZone(e.target.value)}
                          placeholder="system"
                          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                        />
                        <datalist id="agent-heartbeat-timezone-options">
                          <option value="system" />
                          <option value="UTC" />
                          <option value="Europe/London" />
                          <option value="Europe/Paris" />
                          <option value="America/New_York" />
                          <option value="America/Chicago" />
                          <option value="America/Los_Angeles" />
                          <option value="Asia/Tokyo" />
                          <option value="Asia/Singapore" />
                          <option value="Australia/Sydney" />
                        </datalist>
                      </div>
                      {agentHeartbeatScheduleMode === 'interval' ? (
                        <>
                          <div className="grid gap-1">
                            <label className="text-xs text-muted-foreground">Interval</label>
                            <select
                              key={`agent-heartbeat-interval-${agentFormId ?? 'new'}-${agentFormVersion}`}
                              ref={agentHeartbeatIntervalInputRef}
                              defaultValue={agentHeartbeatIntervalMinutes}
                              onBlur={(e) => setAgentHeartbeatIntervalMinutes(e.target.value)}
                              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                            >
                              <option value="5">Every 5 minutes</option>
                              <option value="10">Every 10 minutes</option>
                              <option value="30">Every 30 minutes</option>
                              <option value="60">Every hour</option>
                            </select>
                          </div>
                          <div className="flex items-center justify-between rounded-md border border-border/50 bg-muted/20 px-3 py-2">
                            <label className="text-xs text-muted-foreground">
                              Restrict to active hours
                              <InfoTip text="When enabled, heartbeats only run inside this local-time window." />
                            </label>
                            <label className="flex items-center gap-2 text-xs text-foreground">
                              <input
                                type="checkbox"
                                checked={agentHeartbeatWindowEnabled}
                                onChange={(e) => setAgentHeartbeatWindowEnabled(e.target.checked)}
                              />
                              Enable window
                            </label>
                          </div>
                          {agentHeartbeatWindowEnabled && (
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="grid gap-1">
                                <label className="text-xs text-muted-foreground">Start time</label>
                                <input
                                  type="time"
                                  key={`agent-heartbeat-window-start-${agentFormId ?? 'new'}-${agentFormVersion}`}
                                  ref={agentHeartbeatWindowStartInputRef}
                                  defaultValue={agentHeartbeatWindowStartTime}
                                  onBlur={(e) => setAgentHeartbeatWindowStartTime(e.target.value)}
                                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                                />
                              </div>
                              <div className="grid gap-1">
                                <label className="text-xs text-muted-foreground">End time</label>
                                <input
                                  type="time"
                                  key={`agent-heartbeat-window-end-${agentFormId ?? 'new'}-${agentFormVersion}`}
                                  ref={agentHeartbeatWindowEndInputRef}
                                  defaultValue={agentHeartbeatWindowEndTime}
                                  onBlur={(e) => setAgentHeartbeatWindowEndTime(e.target.value)}
                                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                                />
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="grid gap-1">
                          <label className="text-xs text-muted-foreground">Daily time</label>
                          <input
                            type="time"
                            key={`agent-heartbeat-daily-${agentFormId ?? 'new'}-${agentFormVersion}`}
                            ref={agentHeartbeatDailyTimeInputRef}
                            defaultValue={agentHeartbeatDailyTime}
                            onBlur={(e) => setAgentHeartbeatDailyTime(e.target.value)}
                            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                          />
                        </div>
                      )}
                      <div className="grid gap-1">
                        <label className="text-xs text-muted-foreground">Heartbeat prompt</label>
                        <textarea
                          key={`agent-heartbeat-prompt-${agentFormId ?? 'new'}-${agentFormVersion}`}
                          ref={agentHeartbeatPromptInputRef}
                          defaultValue={agentHeartbeatPrompt}
                          onBlur={(e) => setAgentHeartbeatPrompt(e.target.value)}
                          className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Heartbeat disabled.
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <div className="flex-1 grid gap-1">
                    <label className="text-xs text-muted-foreground">
                      Workspace folder
                      <InfoTip text="Optional default workspace folder for this agent." />
                    </label>
                    <input
                      type="text"
                      key={`agent-workspace-${agentFormId ?? 'new'}-${agentFormVersion}`}
                      ref={agentWorkspaceInputRef}
                      defaultValue={agentWorkspaceRoot}
                      onBlur={(e) => setAgentWorkspaceRoot(e.target.value)}
                      placeholder="Workspace folder (optional)"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <ButtonTip text="Choose a workspace folder for this agent.">
                    <Button size="sm" variant="outline" type="button" onClick={handleSelectAgentWorkspace}>
                      Browse
                    </Button>
                  </ButtonTip>
                  {agentWorkspaceRoot && (
                    <ButtonTip text="Clear the agent workspace folder.">
                      <Button
                        size="sm"
                        variant="outline"
                        type="button"
                        onClick={() => {
                          setAgentWorkspaceRoot('');
                          if (agentWorkspaceInputRef.current) {
                            agentWorkspaceInputRef.current.value = '';
                          }
                        }}
                      >
                        Clear
                      </Button>
                    </ButtonTip>
                  )}
                </div>
                <div className="grid gap-1">
                  <label className="text-xs text-muted-foreground">
                    Persona / system prompt
                    <InfoTip text="Optional system prompt additions for this agent." />
                  </label>
                  <textarea
                    key={`agent-system-prompt-${agentFormId ?? 'new'}-${agentFormVersion}`}
                    ref={agentSystemPromptInputRef}
                    defaultValue={agentSystemPrompt}
                    onBlur={(e) => setAgentSystemPrompt(e.target.value)}
                    placeholder="Persona / system prompt addendum (optional)"
                    className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <ButtonTip text={agentFormId ? 'Save agent changes.' : 'Create this agent.'}>
                  <Button onClick={handleSaveAgent} disabled={agentSaving}>
                    {agentSaving ? 'Saving...' : agentFormId ? 'Save agent' : 'Create agent'}
                  </Button>
                </ButtonTip>
                {agentFormId && (
                  <ButtonTip text="Cancel editing.">
                    <Button variant="outline" onClick={resetAgentForm} disabled={agentSaving}>
                      Cancel
                    </Button>
                  </ButtonTip>
                )}
              </div>
            </div>
            </>
            )}
          </section>

          <section>
            <h2 className="mb-4 text-base font-medium text-foreground">
              Startup
              <InfoTip text="Control whether Open Deskmate launches on login or keeps running in the background. No extra installs required." />
            </h2>
            {isSettingsSectionExpandedByHeading('Startup') && (
            <div className="rounded-lg border border-border bg-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="font-medium text-foreground">Run in background</div>
                  <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                    Close the window but keep tasks running in the system tray.
                  </p>
                </div>
                <div className="ml-4">
                  <ButtonTip text="Keep the app running after closing the window.">
                    <button
                      onClick={handleRunInBackgroundToggle}
                      disabled={startupSaving}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-accomplish ${
                        runInBackground ? 'bg-primary' : 'bg-muted'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-accomplish ${
                          runInBackground ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </ButtonTip>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="font-medium text-foreground">Launch at login</div>
                  <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                    Start Open Deskmate automatically when you sign in.
                  </p>
                </div>
                <div className="ml-4">
                  <ButtonTip text="Start Open Deskmate automatically when you sign in.">
                    <button
                      onClick={handleLaunchAtLoginToggle}
                      disabled={startupSaving}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-accomplish ${
                        launchAtLogin ? 'bg-primary' : 'bg-muted'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-accomplish ${
                          launchAtLogin ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </ButtonTip>
                </div>
              </div>
              {startupSaving && (
                <p className="text-xs text-muted-foreground">Saving startup settings…</p>
              )}
            </div>
            )}
          </section>

          <section>
            <h2 className="mb-4 text-base font-medium text-foreground">
              Build Mode Safety
              <InfoTip text="Choose how Build Mode handles proposed code changes after AI runs." />
            </h2>
            {isSettingsSectionExpandedByHeading('Build Mode Safety') && (
            <div className="rounded-lg border border-border bg-card p-5 space-y-3">
              <label className="flex items-start gap-2 rounded-md border border-border/60 bg-background/70 p-3">
                <input
                  type="radio"
                  className="mt-0.5"
                  checked={buildDiffEnforcementMode === 'auto-apply'}
                  onChange={() => void handleBuildDiffEnforcementModeChange('auto-apply')}
                  disabled={buildDiffEnforcementSaving}
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">Full Auto-Apply (No Approval Needed)</div>
                  <div className="text-xs text-muted-foreground">Accept everything automatically. Fastest workflow, lowest safety.</div>
                </div>
              </label>

              <label className="flex items-start gap-2 rounded-md border border-border/60 bg-background/70 p-3">
                <input
                  type="radio"
                  className="mt-0.5"
                  checked={buildDiffEnforcementMode === 'preview-only'}
                  onChange={() => void handleBuildDiffEnforcementModeChange('preview-only')}
                  disabled={buildDiffEnforcementSaving}
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">Preview Only (No Approval Needed)</div>
                  <div className="text-xs text-muted-foreground">Show synthetic before/after diff, but do not block changes.</div>
                </div>
              </label>

              <label className="flex items-start gap-2 rounded-md border border-border/60 bg-background/70 p-3">
                <input
                  type="radio"
                  className="mt-0.5"
                  checked={buildDiffEnforcementMode === 'approval'}
                  onChange={() => void handleBuildDiffEnforcementModeChange('approval')}
                  disabled={buildDiffEnforcementSaving}
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">Approval Mode (Safe Mode)</div>
                  <div className="text-xs text-muted-foreground">Changes stay pending until you approve or reject them.</div>
                </div>
              </label>

              {buildDiffEnforcementSaving ? (
                <p className="text-xs text-muted-foreground">Saving Build Mode safety mode…</p>
              ) : null}
            </div>
            )}
          </section>

          <section>
            <h2 className="mb-4 text-base font-medium text-foreground">
              Workspace Defaults
              <InfoTip text="Sets the default working folder for new tasks. No installs required." />
            </h2>
            {isSettingsSectionExpandedByHeading('Workspace Defaults') && (
            <div className="rounded-lg border border-border bg-card p-5 space-y-4">
              <div>
                <div className="font-medium text-foreground">Global fallback workspace</div>
                <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                  Used when the active agent does not have its own workspace folder.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded-md bg-muted px-2 py-1 text-xs text-foreground">
                  {workspaceRoot || 'Not set'}
                </code>
                <ButtonTip text="Choose the default workspace folder.">
                  <Button size="sm" variant="outline" onClick={handleSelectWorkspace} disabled={workspaceSaving}>
                    Choose folder
                  </Button>
                </ButtonTip>
                {workspaceRoot && (
                  <ButtonTip text="Clear the default workspace folder.">
                    <Button size="sm" variant="outline" onClick={handleClearWorkspace} disabled={workspaceSaving}>
                      Clear
                    </Button>
                  </ButtonTip>
                )}
              </div>
              {workspaceSaving && (
                <p className="text-xs text-muted-foreground">Saving workspace…</p>
              )}
            </div>
            )}
          </section>

          <section>
            <h2 className="mb-4 text-base font-medium text-foreground">
              Memory (User Context)
              <InfoTip text="Stored as Markdown in your workspace. The assistant reads this as durable context." />
            </h2>
            {isSettingsSectionExpandedByHeading('Memory (User Context)') && (
            <div className="rounded-lg border border-border bg-card p-5 space-y-6">
              {workspaceRoot ? (
                <>
                  <div className="space-y-3">
                    <div>
                      <div className="font-medium text-foreground">Long-term memory (MEMORY.md)</div>
                      <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                        Stable preferences and facts the assistant should remember.
                      </p>
                    </div>
                    <textarea
                      key={`memory-long-term-${activeAgentId || 'none'}-${workspaceRoot || 'none'}`}
                      ref={memoryLongTermRef}
                      defaultValue={memoryLongTerm}
                      onBlur={(e) => setMemoryLongTerm(e.target.value)}
                      className="w-full min-h-[140px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                      placeholder="Add durable notes here..."
                    />
                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={handleSaveLongTermMemory} disabled={memorySaving || memoryLoading}>
                        {memorySaving ? 'Saving…' : 'Save MEMORY.md'}
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {`${workspaceRoot}\\MEMORY.md`}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <div className="font-medium text-foreground">Daily memory</div>
                      <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                        Short-term notes and running context. Stored under <code>memory/YYYY-MM-DD.md</code>.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="text-xs text-muted-foreground">Date</label>
                      <input
                        type="date"
                        value={memoryDailyDate}
                        onChange={(e) => handleDailyDateChange(e.target.value)}
                        className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                      />
                      {memoryDailyFiles.length > 0 && (
                        <select
                          value={memoryDailyDate}
                          onChange={(e) => handleDailyDateChange(e.target.value)}
                          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                        >
                          {memoryDailyFiles.map((date) => (
                            <option key={date} value={date}>{date}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    <textarea
                      key={`memory-daily-${activeAgentId || 'none'}-${memoryDailyDate || 'none'}`}
                      ref={memoryDailyRef}
                      defaultValue={memoryDaily}
                      onBlur={(e) => setMemoryDaily(e.target.value)}
                      className="w-full min-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                      placeholder="Add daily notes here..."
                    />
                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={handleSaveDailyMemory} disabled={memorySaving || memoryLoading || !memoryDailyDate}>
                        {memorySaving ? 'Saving…' : 'Save daily memory'}
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {`${workspaceRoot}\\memory\\${memoryDailyDate || 'YYYY-MM-DD'}.md`}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Set a workspace folder first to enable memory editing.
                </div>
              )}
              {memoryError && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {memoryError}
                </div>
              )}
            </div>
            )}
          </section>

          <section>
            <h2 className="mb-4 text-base font-medium text-foreground">
              Browser Profile
              <InfoTip text="Select the browser automation profile for tasks. Useful if you want separate cookies/sessions. No installs required." />
            </h2>
            {isSettingsSectionExpandedByHeading('Browser Profile') && (
            <div className="rounded-lg border border-border bg-card p-5 space-y-4">
              <div>
                <div className="font-medium text-foreground">Active profile</div>
                <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                  Use separate browser profiles for different automations. Changing this requires restarting the app.
                </p>
              </div>
              <div className="flex gap-3">
                <div className="flex-1 grid gap-1">
                  <label className="text-xs text-muted-foreground">
                    Profile name
                    <InfoTip text="Profile name for browser automation. Changing requires restart." />
                  </label>
                  <input
                    type="text"
                    value={browserProfile}
                    onChange={(e) => setBrowserProfileState(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    placeholder="default"
                  />
                </div>
                <ButtonTip text="Save the browser profile name (restart required).">
                  <Button onClick={handleSaveBrowserProfile} disabled={browserProfileSaving}>
                    {browserProfileSaving ? 'Saving...' : 'Save'}
                  </Button>
                </ButtonTip>
              </div>
            </div>
            )}
          </section>

          <section>
            <h2 className="mb-4 text-base font-medium text-foreground">
              Developer
              <InfoTip text="Debug and diagnostics for local development. No installs required unless a specific tool is mentioned." />
            </h2>
            {isSettingsSectionExpandedByHeading('Developer') && (
            <div className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="font-medium text-foreground">Debug Mode</div>
                  <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                    Show detailed backend logs including Claude CLI commands, flags,
                    and stdout/stderr output in the task view.
                  </p>
                </div>
                <div className="ml-4">
                  {loadingDebug ? (
                    <div className="h-6 w-11 animate-pulse rounded-full bg-muted" />
                  ) : (
                    <ButtonTip text="Show detailed backend logs in the UI.">
                      <button
                        data-testid="settings-debug-toggle"
                        onClick={handleDebugToggle}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-accomplish ${
                          debugMode ? 'bg-primary' : 'bg-muted'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-accomplish ${
                            debugMode ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </ButtonTip>
                  )}
                </div>
              </div>
              {debugMode && (
                <div className="mt-4 rounded-xl bg-warning/10 p-3.5">
                  <p className="text-sm text-warning">
                    Debug mode is enabled. Backend logs will appear in the task view
                    when running tasks.
                  </p>
                </div>
              )}
            </div>
            )}
          </section>

          <section>
            <h2 className="mb-4 text-base font-medium text-foreground">
              Doctor
              <InfoTip text="Runs checks for model selection, API keys, and local services. Use this to verify setup." />
            </h2>
            {isSettingsSectionExpandedByHeading('Doctor') && (
            <div className="rounded-lg border border-border bg-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-foreground">Diagnostics</div>
                  <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                    Run a quick health check for models and core skills.
                  </p>
                </div>
                <ButtonTip text="Run diagnostics for models, keys, and local services.">
                  <Button onClick={runDoctorChecks} disabled={doctorRunning} size="sm">
                    {doctorRunning ? 'Running…' : 'Run checks'}
                  </Button>
                </ButtonTip>
              </div>
              {doctorChecks.length > 0 && (
                <div className="space-y-3">
                  {doctorChecks.map((check) => (
                    <div key={check.id} className="flex items-start gap-3 rounded-xl border border-border/60 p-4">
                      {check.status === 'ok' && <CheckCircle2 className="h-5 w-5 text-success" />}
                      {check.status === 'warning' && <AlertCircle className="h-5 w-5 text-warning" />}
                      {check.status === 'error' && <AlertCircle className="h-5 w-5 text-destructive" />}
                      <div>
                        <div className="text-sm font-medium text-foreground">{check.title}</div>
                        <p className="text-xs text-muted-foreground">{check.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}
          </section>

          <section>
            <h2 className="mb-4 text-base font-medium text-foreground">
              About
              <InfoTip text="App version, platform, and links. No installs required." />
            </h2>
            {isSettingsSectionExpandedByHeading('About') && (
            <div className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-center gap-4">
                <img
                  src={appIcon}
                  alt="Open Deskmate"
                  className="h-12 w-12 rounded-xl"
                />
                <div>
                  <div className="font-medium text-foreground">Open Deskmate</div>
                  <div className="text-sm text-muted-foreground">Version {appVersion || '0.1.0'}</div>
                </div>
              </div>
              <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
              Open Deskmate is a local computer-use AI agent platform for Windows with multi-agent workspaces, per-agent model/provider overrides, Active Automation Mode, heartbeat scheduling, and private/shared skill creation (including agent-generated skills). It integrates with channels like WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, iMessage, Microsoft Teams, and WebChat, with an optional always-on assistant experience you control locally.
              </p>
            </div>
            )}
          </section>
            </>
          )}
        </div>

        {creatingUserSkill && (
        <Dialog
          open={creatingUserSkill}
          onOpenChange={(next) => {
            setCreatingUserSkill(next);
            if (!next) {
              setNewUserSkillId('');
              setNewUserSkillName('');
              setNewUserSkillDesc('');
            }
          }}
        >
          <DialogContent className="w-[92vw] max-w-lg">
            <DialogHeader>
              <DialogTitle>New skill</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid gap-1.5">
                <label className="text-xs text-muted-foreground">Skill ID (folder name)</label>
                <input
                  value={newUserSkillId}
                  onChange={(e) => setNewUserSkillId(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="e.g. camsnap"
                />
                <div className="text-[11px] text-muted-foreground">
                  Letters, numbers, dash, underscore. Stored under your managed skills directory.
                </div>
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs text-muted-foreground">Name (optional)</label>
                <input
                  value={newUserSkillName}
                  onChange={(e) => setNewUserSkillName(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="Human-friendly name"
                />
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs text-muted-foreground">Description (optional)</label>
                <input
                  value={newUserSkillDesc}
                  onChange={(e) => setNewUserSkillDesc(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="One-liner: what this skill is for"
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setCreatingUserSkill(false)}
                  disabled={savingUserSkill}
                >
                  Cancel
                </Button>
                <Button onClick={handleCreateUserSkill} disabled={savingUserSkill}>
                  {savingUserSkill ? 'Creating…' : 'Create'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        )}

        {importingUserSkillZip && (
        <Dialog
          open={importingUserSkillZip}
          onOpenChange={(next) => {
            setImportingUserSkillZip(next);
            if (!next) {
              void resetImportZipState();
            }
          }}
        >
          <DialogContent className="w-[92vw] max-w-2xl">
            <DialogHeader>
              <DialogTitle>Import skill from ZIP</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={importZipMode === 'github' ? 'default' : 'outline'}
                  onClick={() => setImportZipMode('github')}
                  disabled={importZipInspecting || importZipInstalling}
                >
                  GitHub ZIP
                </Button>
                <Button
                  size="sm"
                  variant={importZipMode === 'local' ? 'default' : 'outline'}
                  onClick={() => setImportZipMode('local')}
                  disabled={importZipInspecting || importZipInstalling}
                >
                  Local ZIP
                </Button>
              </div>

              {importZipMode === 'github' ? (
                <div className="grid gap-1.5">
                  <label className="text-xs text-muted-foreground">GitHub URL (repo or .zip)</label>
                  <input
                    value={importZipUrl}
                    onChange={(e) => setImportZipUrl(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    placeholder="https://github.com/owner/repo or https://.../archive/refs/heads/main.zip"
                    disabled={importZipInspecting || importZipInstalling}
                  />
                  <div className="text-[11px] text-muted-foreground">
                    We download and scan for <code className="rounded bg-muted px-1 py-0.5">SKILL.md</code> files. Nothing is installed until you confirm.
                  </div>
                </div>
              ) : (
                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground">Local .zip</div>
                      <div className="text-xs text-foreground truncate">
                        {importZipLocalPath || 'No file selected'}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handlePickImportZipLocal()}
                      disabled={importZipInspecting || importZipInstalling}
                    >
                      Choose file
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleInspectImportZip()}
                  disabled={importZipInspecting || importZipInstalling}
                >
                  {importZipInspecting ? 'Inspecting…' : 'Inspect ZIP'}
                </Button>
                {importZipSession && (
                  <span className="text-xs text-muted-foreground">
                    Found {importZipCandidates.length} skill{importZipCandidates.length === 1 ? '' : 's'}
                  </span>
                )}
              </div>

              {importZipCandidates.length > 0 && (
                <div className="space-y-3">
                  <div className="grid gap-1.5">
                    <label className="text-xs text-muted-foreground">Skill in ZIP</label>
                    <select
                      value={importZipSelected?.relPath || ''}
                      onChange={(e) => {
                        const selected = importZipCandidates.find((c) => c.relPath === e.target.value) || null;
                        setImportZipSelected(selected);
                        setImportZipDestId(selected?.skillId || '');
                      }}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      disabled={importZipInspecting || importZipInstalling}
                    >
                      {importZipCandidates.map((c) => (
                        <option key={c.relPath} value={c.relPath}>
                          {c.name} ({c.relPath})
                        </option>
                      ))}
                    </select>
                    {importZipSelected?.description && (
                      <div className="text-[11px] text-muted-foreground">{importZipSelected.description}</div>
                    )}
                  </div>

                  <div className="grid gap-1.5">
                    <label className="text-xs text-muted-foreground">Destination skill ID (folder name)</label>
                    <input
                      value={importZipDestId}
                      onChange={(e) => setImportZipDestId(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      placeholder="e.g. my-skill"
                      disabled={importZipInspecting || importZipInstalling}
                    />
                  </div>

                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={importZipOverwrite}
                      onChange={(e) => setImportZipOverwrite(e.target.checked)}
                      disabled={importZipInspecting || importZipInstalling}
                    />
                    Overwrite if a skill with this ID already exists
                  </label>

                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setImportingUserSkillZip(false)}
                      disabled={importZipInspecting || importZipInstalling}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={() => void handleInstallImportZip()}
                      disabled={importZipInspecting || importZipInstalling}
                    >
                      {importZipInstalling ? 'Installing…' : 'Install'}
                    </Button>
                  </div>
                </div>
              )}

              {importZipError && (
                <div className="text-xs text-destructive">{importZipError}</div>
              )}
            </div>
          </DialogContent>
        </Dialog>
        )}

        {showHeartbeatAutomationModeDialog && (
        <Dialog
          open={showHeartbeatAutomationModeDialog}
          onOpenChange={(next) => {
            if (!next) {
              setShowHeartbeatAutomationModeDialog(false);
            }
          }}
        >
          <DialogContent className="w-[92vw] max-w-md">
            <DialogHeader>
              <DialogTitle>Enable Active Automation Mode</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Heartbeat requires Active Automation Mode to be enabled for this agent.
              </p>
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowHeartbeatAutomationModeDialog(false);
                    setAgentHeartbeatEnabled(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    setAgentLoopEnabled(true);
                    setAgentHeartbeatEnabled(true);
                    setShowHeartbeatAutomationModeDialog(false);
                  }}
                >
                  Enable mode
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        )}

        {Boolean(sharingUserSkill) && (
        <Dialog
          open={Boolean(sharingUserSkill)}
          onOpenChange={(next) => {
            if (!next) {
              setSharingUserSkill(null);
              setShareUserSkillScope('private');
              setShareUserSkillAgentIds([]);
              setShareUserSkillError(null);
            }
          }}
        >
          <DialogContent className="w-[92vw] max-w-xl">
            <DialogHeader>
              <DialogTitle>
                {sharingUserSkill ? `Share skill: ${sharingUserSkill.name}` : 'Share skill'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="text-xs text-muted-foreground">
                Agent-created skills default to private. You can keep it private, share with selected agents, or share with all agents.
              </div>
              <div className="grid gap-1">
                <label className="text-xs text-muted-foreground">Sharing scope</label>
                <select
                  value={shareUserSkillScope}
                  onChange={(e) => setShareUserSkillScope((e.target.value as 'private' | 'selected' | 'all') || 'private')}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="private">Private to owner agent</option>
                  <option value="selected">Share with selected agents</option>
                  <option value="all">Share with all agents</option>
                </select>
              </div>
              {shareUserSkillScope === 'selected' && (
                <div className="grid gap-2">
                  <div className="text-xs text-muted-foreground">Selected agents</div>
                  <div className="max-h-56 overflow-auto rounded-md border border-border p-2 space-y-2">
                    {agents
                      .filter((agent) => agent.id !== (sharingUserSkill?.visibilityOwnerAgentId || ''))
                      .map((agent) => {
                        const checked = shareUserSkillAgentIds.includes(agent.id);
                        return (
                          <label key={agent.id} className="flex items-center justify-between gap-2 text-sm">
                            <span>{agent.name}</span>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => toggleShareAgentId(agent.id, e.target.checked)}
                            />
                          </label>
                        );
                      })}
                  </div>
                </div>
              )}
              {shareUserSkillError && <p className="text-xs text-destructive">{shareUserSkillError}</p>}
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setSharingUserSkill(null);
                    setShareUserSkillScope('private');
                    setShareUserSkillAgentIds([]);
                    setShareUserSkillError(null);
                  }}
                  disabled={savingShareUserSkill}
                >
                  Cancel
                </Button>
                <Button onClick={handleSaveShareUserSkill} disabled={savingShareUserSkill}>
                  {savingShareUserSkill ? 'Saving…' : 'Save sharing'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        )}

        {skillAssistantOpen && (
        <Dialog
          open={skillAssistantOpen}
          onOpenChange={(next) => {
            setSkillAssistantOpen(next);
            if (!next) {
              setSkillAssistantError(null);
              setSkillAssistantAnswer('');
              setSkillAssistantDraftContent('');
            }
          }}
        >
          <DialogContent className="w-[92vw] max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle>Skill Assistant</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-auto space-y-3">
              <div className="text-xs text-muted-foreground">
                Ask how to configure or edit a skill using your current app setup.
                {' '}
                Model:
                {' '}
                <span className="font-medium text-foreground">
                  {skillAssistantModelOverrideEnabled
                    ? formatSelectedModelLabel(normalizeSkillAssistantSelectedModel())
                    : `Global (${formatSelectedModelLabel(selectedModel)})`}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid min-w-0 gap-1">
                  <label className="text-xs text-muted-foreground">Mode</label>
                  <select
                    key={`skill-assistant-mode-${skillAssistantFormVersion}`}
                    ref={skillAssistantModeInputRef}
                    defaultValue={skillAssistantMode}
                    className="w-full min-w-0 max-w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="general">General</option>
                    <option value="configure">Configure</option>
                    <option value="edit">Edit</option>
                  </select>
                </div>
                <div className="grid min-w-0 gap-1">
                  <label className="text-xs text-muted-foreground">Skill (optional)</label>
                  <select
                    key={`skill-assistant-target-${skillAssistantFormVersion}`}
                    ref={skillAssistantTargetInputRef}
                    defaultValue={skillAssistantTargetValue}
                    className="w-full min-w-0 max-w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Auto-detect from your message</option>
                    {skillAssistantTargets.map((entry) => {
                      const fullLabel = `${entry.name} (${entry.source}/${entry.id})`;
                      const shortLabel = fullLabel.length > 72 ? `${fullLabel.slice(0, 69)}...` : fullLabel;
                      return (
                        <option key={entry.value} value={entry.value} title={fullLabel}>
                          {shortLabel}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              <div className="grid gap-1">
                <label className="text-xs text-muted-foreground">Question</label>
                <textarea
                  key={`skill-assistant-question-${skillAssistantFormVersion}`}
                  ref={skillAssistantQuestionInputRef}
                  defaultValue={skillAssistantQuestion}
                  rows={4}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="Example: For camera-snapshot-analysis, exactly what config keys should I set and with what values?"
                />
              </div>

              {skillAssistantAnswer && (
                <div className="grid gap-1">
                  <label className="text-xs text-muted-foreground">Assistant response</label>
                  <textarea
                    readOnly
                    value={skillAssistantAnswer}
                    rows={10}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                  />
                </div>
              )}
              {skillAssistantError && <p className="text-xs text-destructive">{skillAssistantError}</p>}
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => setSkillAssistantOpen(false)} disabled={skillAssistantLoading}>
                Close
              </Button>
              <Button onClick={() => void handleAskSkillAssistant()} disabled={skillAssistantLoading}>
                {skillAssistantLoading ? 'Asking...' : 'Ask Assistant'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        )}

        {Boolean(editingUserSkill) && (
        <Dialog
          open={Boolean(editingUserSkill)}
          onOpenChange={(next) => {
            if (!next) {
              setEditingUserSkill(null);
              setEditingUserSkillContent('');
            }
          }}
        >
          <DialogContent className="w-[92vw] max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle>{editingUserSkill ? `Edit skill: ${editingUserSkill.name}` : 'Edit skill'}</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-auto space-y-3">
              {editingUserSkill && (
                <div className="text-xs text-muted-foreground">
                  <div>
                    Source: <span className="font-medium text-foreground">{editingUserSkill.source}</span>
                  </div>
                  <div className="mt-1">
                    File: <code className="rounded bg-muted px-1 py-0.5">{editingUserSkill.filePath}</code>
                  </div>
                </div>
              )}
              <textarea
                value={editingUserSkillContent}
                onChange={(e) => setEditingUserSkillContent(e.target.value)}
                className="w-full min-h-[360px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                spellCheck={false}
              />
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => openSkillAssistantDialog({
                  mode: 'edit',
                  skill: editingUserSkill,
                  draftContent: editingUserSkillContent,
                  question: 'What should I change in this skill and why?',
                })}
                disabled={savingUserSkill}
              >
                Ask Assistant
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setEditingUserSkill(null);
                  setEditingUserSkillContent('');
                }}
                disabled={savingUserSkill}
              >
                Close
              </Button>
              <Button onClick={handleSaveUserSkill} disabled={savingUserSkill || !editingUserSkill?.editable}>
                {savingUserSkill ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        )}

        {Boolean(configuringUserSkill) && (
        <Dialog
          open={Boolean(configuringUserSkill)}
          onOpenChange={(next) => {
            if (!next) {
              setConfiguringUserSkill(null);
              setConfiguringUserSkillJson('');
              setConfiguringUserSkillError(null);
            }
          }}
        >
          <DialogContent className="w-[92vw] max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle>
                {configuringUserSkill ? `Configure skill: ${configuringUserSkill.name}` : 'Configure skill'}
              </DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-auto space-y-3">
              {configuringUserSkill && (
                <div className="text-xs text-muted-foreground">
                  <div>
                    Skill key:{' '}
                    <code className="rounded bg-muted px-1 py-0.5">{configuringUserSkill.skillKey}</code>
                  </div>
                  <div className="mt-1">
                    Required config keys come from <code className="rounded bg-muted px-1 py-0.5">metadata.opendeskmate.requires.config</code>.
                  </div>
                  <div className="mt-1">
                    Paths without <code className="rounded bg-muted px-1 py-0.5">skills.</code> are treated as local to this skill config (for example <code className="rounded bg-muted px-1 py-0.5">camera.nodes</code>).
                  </div>
                </div>
              )}
              {configuringRequiredConfigPaths.length > 0 && (
                <div className="rounded-md border border-border/70 bg-muted/20 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-medium text-foreground">Required fields</div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleInsertRequiredSkillConfig}
                      disabled={
                        configuringRequiredConfigStatus.filter((entry) => entry.localPath && !entry.satisfied).length === 0
                      }
                    >
                      Add missing fields
                    </Button>
                  </div>
                  <div className="mt-2 space-y-1">
                    {configuringRequiredConfigStatus.map((entry) => (
                      <div key={entry.path} className="flex items-center justify-between gap-2 text-xs">
                        <code className="rounded bg-muted px-1 py-0.5 text-foreground">{entry.path}</code>
                        <span className={entry.satisfied ? 'text-success' : 'text-warning'}>
                          {entry.satisfied ? 'Set' : 'Missing'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <textarea
                value={configuringUserSkillJson}
                onChange={(e) => setConfiguringUserSkillJson(e.target.value)}
                className="w-full min-h-[320px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                spellCheck={false}
              />
              {configuringUserSkillError && (
                <p className="text-xs text-destructive">{configuringUserSkillError}</p>
              )}
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => openSkillAssistantDialog({
                  mode: 'configure',
                  skill: configuringUserSkill,
                  draftContent: configuringUserSkillJson,
                  question: 'What config do I need to set for this skill?',
                })}
                disabled={savingUserSkillConfig}
              >
                Ask Assistant
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setConfiguringUserSkill(null);
                  setConfiguringUserSkillJson('');
                  setConfiguringUserSkillError(null);
                }}
                disabled={savingUserSkillConfig}
              >
                Close
              </Button>
              <Button onClick={handleSaveUserSkillConfig} disabled={savingUserSkillConfig}>
                {savingUserSkillConfig ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}

