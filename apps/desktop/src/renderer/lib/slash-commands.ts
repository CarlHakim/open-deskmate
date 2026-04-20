export type SlashCommandIntent = 'navigate' | 'inspect' | 'mutate' | 'danger';

export type SlashCommandDefinition = {
  id: string;
  command: string;
  title: string;
  description: string;
  group?: string;
  intent?: SlashCommandIntent;
  previewText?: string;
  aliases?: string[];
  keywords?: string[];
  visible?: boolean;
  execute: () => void | Promise<void>;
};

export function getSlashCommandIntentLabel(intent?: SlashCommandIntent): string {
  switch (intent) {
    case 'navigate':
      return 'Navigate';
    case 'inspect':
      return 'Inspect';
    case 'mutate':
      return 'Change';
    case 'danger':
      return 'Destructive';
    default:
      return 'Action';
  }
}

export function getSlashCommandQuery(input: string): string | null {
  const value = String(input || '');
  if (!value.startsWith('/')) return null;
  return value.slice(1).trim().toLowerCase();
}

export function filterSlashCommands(
  input: string,
  commands: SlashCommandDefinition[]
): SlashCommandDefinition[] {
  const query = getSlashCommandQuery(input);
  if (query === null) return [];
  const visible = commands.filter((command) => command.visible !== false);
  if (!query) {
    return visible;
  }

  const scored = visible
    .map((command, index) => {
      const aliases = (command.aliases || []).map((entry) => entry.toLowerCase());
      const haystack = [
        command.command,
        ...(command.aliases || []),
        command.title,
        command.description,
        command.group || '',
        command.previewText || '',
        ...(command.keywords || []),
      ].join(' ').toLowerCase();

      let score: number | null = null;
      if (command.command.toLowerCase() === query || aliases.includes(query)) {
        score = 0;
      } else if (
        command.command.toLowerCase().startsWith(query)
        || aliases.some((alias) => alias.startsWith(query))
      ) {
        score = 1;
      } else if (
        command.title.toLowerCase().startsWith(query)
        || (command.group || '').toLowerCase().startsWith(query)
      ) {
        score = 2;
      } else if (haystack.includes(query)) {
        score = 3;
      }

      return score === null ? null : { command, index, score };
    })
    .filter((entry): entry is { command: SlashCommandDefinition; index: number; score: number } => Boolean(entry));

  scored.sort((left, right) => {
    if (left.score !== right.score) return left.score - right.score;
    return left.index - right.index;
  });

  return scored.map((entry) => entry.command);
}
