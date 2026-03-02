export type AppConnectorExtensionId =
  | 'notion'
  | 'trello'
  | 'obsidian'
  | 'github'
  | 'slack'
  | 'dropbox'
  | 'canva'
  | 'onedrive'
  | 'supabase'
  | 'google-slides'
  | 'google-tasks'
  | 'google-sheets'
  | 'google-docs'
  | 'google-drive'
  | 'google-photos'
  | 'google-maps'
  | 'youtube'
  | 'figma'
  | 'miro'
  | 'gmail'
  | 'email-triggers'
  | 'google-calendar'
  | 'microsoft-outlook';

export type AppConnectorAuthMethod =
  | 'oauth2'
  | 'api-key'
  | 'pat'
  | 'service-account'
  | 'token'
  | 'local'
  | 'webhook';

export interface AppConnectorExtensionDefinition {
  id: AppConnectorExtensionId;
  name: string;
  description: string;
  authMethod: AppConnectorAuthMethod;
  docsUrl: string;
  defaultBaseUrl?: string;
  oauthScopesHint?: string;
}

export interface AppConnectorExtensionConfig {
  id: AppConnectorExtensionId;
  instanceId: string;
  name?: string;
  enabled: boolean;
  autoBindTools: boolean;
  agentId?: string;
  accountId?: string;
  baseUrl?: string;
  notes?: string;
  metadata?: Record<string, string>;
  updatedAt: string;
}

export interface AppConnectorExtensionConfigInput {
  id: AppConnectorExtensionId;
  instanceId?: string;
  name?: string;
  enabled?: boolean;
  autoBindTools?: boolean;
  agentId?: string;
  accountId?: string;
  baseUrl?: string;
  notes?: string;
  metadata?: Record<string, string>;
}

export interface AppConnectorExtensionState {
  definition: AppConnectorExtensionDefinition;
  config: AppConnectorExtensionConfig;
  secretSet: boolean;
  runtimeKey: string;
}

export interface AppConnectorRuntimeStatus {
  connectorId: AppConnectorExtensionId;
  instanceId?: string;
  runtimeKey?: string;
  instanceName?: string;
  configured: boolean;
  running: boolean;
  mode: 'oauth2' | 'token' | 'local' | 'webhook';
  lastCheckAt?: string;
  lastError?: string;
  detail?: string;
}

export interface AppConnectorRuntimeTestResult {
  connectorId: AppConnectorExtensionId;
  instanceId?: string;
  runtimeKey?: string;
  ok: boolean;
  detail: string;
  metadata?: Record<string, string>;
}

export const APP_CONNECTOR_EXTENSION_CATALOG: AppConnectorExtensionDefinition[] = [
  {
    id: 'notion',
    name: 'Notion',
    description: 'Read and update Notion pages and databases.',
    authMethod: 'oauth2',
    docsUrl: 'https://developers.notion.com/docs/authorization',
    defaultBaseUrl: 'https://api.notion.com/v1',
    oauthScopesHint: 'read_content, update_content, insert_content',
  },
  {
    id: 'trello',
    name: 'Trello',
    description: 'Work with Trello boards, lists, and cards.',
    authMethod: 'pat',
    docsUrl: 'https://developer.atlassian.com/cloud/trello/guides/rest-api/authorization/',
    defaultBaseUrl: 'https://api.trello.com/1',
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    description: 'Read and write notes in a local Obsidian vault path.',
    authMethod: 'local',
    docsUrl: 'https://help.obsidian.md',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Use GitHub REST APIs for repos, issues, and pull requests.',
    authMethod: 'pat',
    docsUrl: 'https://docs.github.com/en/rest',
    defaultBaseUrl: 'https://api.github.com',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Call Slack APIs for channels, messages, and workspace data.',
    authMethod: 'oauth2',
    docsUrl: 'https://api.slack.com/authentication/oauth-v2',
    defaultBaseUrl: 'https://slack.com/api',
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    description: 'Access Dropbox files and folders via HTTP API.',
    authMethod: 'oauth2',
    docsUrl: 'https://developers.dropbox.com/oauth-guide',
    defaultBaseUrl: 'https://api.dropboxapi.com/2',
    oauthScopesHint: 'account_info.read files.metadata.read files.content.read files.content.write',
  },
  {
    id: 'canva',
    name: 'Canva',
    description: 'Connect to Canva developer APIs and app workflows.',
    authMethod: 'oauth2',
    docsUrl: 'https://www.canva.dev/docs/connect/',
    defaultBaseUrl: 'https://api.canva.com/rest/v1',
    oauthScopesHint: 'design:meta:read design:content:read design:content:write',
  },
  {
    id: 'onedrive',
    name: 'OneDrive',
    description: 'Access OneDrive files through Microsoft Graph.',
    authMethod: 'oauth2',
    docsUrl: 'https://learn.microsoft.com/graph/onedrive-concept-overview',
    defaultBaseUrl: 'https://graph.microsoft.com/v1.0',
  },
  {
    id: 'supabase',
    name: 'Supabase',
    description: 'Run table/data operations using Supabase REST endpoints.',
    authMethod: 'api-key',
    docsUrl: 'https://supabase.com/docs/reference/javascript/introduction',
  },
  {
    id: 'google-slides',
    name: 'Google Slides',
    description: 'Create and update Google Slides presentations.',
    authMethod: 'oauth2',
    docsUrl: 'https://developers.google.com/slides/api/guides/authorizing',
    defaultBaseUrl: 'https://slides.googleapis.com/v1',
    oauthScopesHint: 'https://www.googleapis.com/auth/presentations',
  },
  {
    id: 'google-tasks',
    name: 'Google Tasks',
    description: 'Read and update Google Tasks tasklists and tasks.',
    authMethod: 'oauth2',
    docsUrl: 'https://developers.google.com/tasks/reference/rest',
    defaultBaseUrl: 'https://tasks.googleapis.com/tasks/v1',
    oauthScopesHint: 'https://www.googleapis.com/auth/tasks',
  },
  {
    id: 'google-sheets',
    name: 'Google Sheets',
    description: 'Read and write Google Sheets ranges and values.',
    authMethod: 'oauth2',
    docsUrl: 'https://developers.google.com/sheets/api/guides/authorizing',
    defaultBaseUrl: 'https://sheets.googleapis.com/v4',
    oauthScopesHint: 'https://www.googleapis.com/auth/spreadsheets',
  },
  {
    id: 'google-docs',
    name: 'Google Docs',
    description: 'Create and edit Google Docs documents.',
    authMethod: 'oauth2',
    docsUrl: 'https://developers.google.com/docs/api/how-tos/authorizing',
    defaultBaseUrl: 'https://docs.googleapis.com/v1',
    oauthScopesHint: 'https://www.googleapis.com/auth/documents',
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: 'Browse and manage Google Drive files and folders.',
    authMethod: 'oauth2',
    docsUrl: 'https://developers.google.com/drive/api/guides/api-specific-auth',
    defaultBaseUrl: 'https://www.googleapis.com/drive/v3',
    oauthScopesHint: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/drive.file',
  },
  {
    id: 'google-photos',
    name: 'Google Photos',
    description: 'Access Google Photos library and media items.',
    authMethod: 'oauth2',
    docsUrl: 'https://developers.google.com/photos/library/guides/authorization',
    defaultBaseUrl: 'https://photoslibrary.googleapis.com/v1',
    oauthScopesHint: 'https://www.googleapis.com/auth/photoslibrary.readonly',
  },
  {
    id: 'google-maps',
    name: 'Google Maps',
    description: 'Use Maps platform APIs for geocoding and places.',
    authMethod: 'api-key',
    docsUrl: 'https://developers.google.com/maps/documentation',
    defaultBaseUrl: 'https://maps.googleapis.com/maps/api',
  },
  {
    id: 'youtube',
    name: 'YouTube',
    description: 'Access YouTube Data API resources.',
    authMethod: 'oauth2',
    docsUrl: 'https://developers.google.com/youtube/v3/guides/authentication',
    defaultBaseUrl: 'https://www.googleapis.com/youtube/v3',
    oauthScopesHint: 'https://www.googleapis.com/auth/youtube.readonly',
  },
  {
    id: 'figma',
    name: 'Figma',
    description: 'Read Figma files and comments via API.',
    authMethod: 'pat',
    docsUrl: 'https://www.figma.com/developers/api',
    defaultBaseUrl: 'https://api.figma.com/v1',
  },
  {
    id: 'miro',
    name: 'Miro',
    description: 'Work with Miro boards and widgets.',
    authMethod: 'oauth2',
    docsUrl: 'https://developers.miro.com/docs/rest-api-reference-guide',
    defaultBaseUrl: 'https://api.miro.com/v2',
    oauthScopesHint: 'boards:read boards:write',
  },
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Read and send emails through Gmail API.',
    authMethod: 'oauth2',
    docsUrl: 'https://developers.google.com/gmail/api/auth/web-server',
    defaultBaseUrl: 'https://gmail.googleapis.com/gmail/v1',
    oauthScopesHint: 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send',
  },
  {
    id: 'email-triggers',
    name: 'Email Triggers',
    description: 'Webhook/polling connector for email-trigger automations.',
    authMethod: 'webhook',
    docsUrl: 'https://www.rfc-editor.org/rfc/rfc5322',
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'Manage Google Calendar events and calendars.',
    authMethod: 'oauth2',
    docsUrl: 'https://developers.google.com/calendar/api/guides/auth',
    defaultBaseUrl: 'https://www.googleapis.com/calendar/v3',
    oauthScopesHint: 'https://www.googleapis.com/auth/calendar',
  },
  {
    id: 'microsoft-outlook',
    name: 'Microsoft Outlook',
    description: 'Mail and calendar access through Microsoft Graph.',
    authMethod: 'oauth2',
    docsUrl: 'https://learn.microsoft.com/graph/auth-v2-user',
    defaultBaseUrl: 'https://graph.microsoft.com/v1.0',
  },
];
