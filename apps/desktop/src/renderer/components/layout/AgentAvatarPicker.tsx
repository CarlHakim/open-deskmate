'use client';

import { memo, useEffect, useMemo, useState, type FC, type SVGProps } from 'react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

type AvatarSvgComponent = FC<SVGProps<SVGSVGElement>>;

type Hair = 'none' | 'short' | 'long' | 'buzz';
type Facial = 'none' | 'mustache' | 'beard' | 'goatee';
type Hat = 'none' | 'cap' | 'fedora' | 'beanie' | 'hardhat' | 'chef' | 'helmet' | 'wizard' | 'crown';
type Outfit = 'none' | 'tie' | 'labcoat' | 'hoodie' | 'armor';
type Accessory = 'none' | 'glasses' | 'goggles' | 'headset';
type Special = 'Robot' | 'Android' | 'Cyborg';

interface BuilderConfig {
  hair: Hair;
  facial: Facial;
  hat: Hat;
  outfit: Outfit;
  accessory: Accessory;
}

interface Preset {
  name: string;
  label: string;
  kind: 'human' | 'special';
  special?: Special;
  config?: BuilderConfig;
}

const BUILDER_PREFIX = 'builder:v1:';
const DEFAULT_CONFIG: BuilderConfig = {
  hair: 'short',
  facial: 'none',
  hat: 'none',
  outfit: 'none',
  accessory: 'none',
};

const HAIR_OPTIONS: Array<{ value: Hair; label: string }> = [
  { value: 'none', label: 'No Hair' },
  { value: 'short', label: 'Short Hair' },
  { value: 'long', label: 'Long Hair' },
  { value: 'buzz', label: 'Buzz Cut' },
];
const FACIAL_OPTIONS: Array<{ value: Facial; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'mustache', label: 'Mustache' },
  { value: 'beard', label: 'Beard' },
  { value: 'goatee', label: 'Goatee' },
];
const HAT_OPTIONS: Array<{ value: Hat; label: string }> = [
  { value: 'none', label: 'No Hat' },
  { value: 'cap', label: 'Cap' },
  { value: 'fedora', label: 'Fedora' },
  { value: 'beanie', label: 'Beanie' },
  { value: 'hardhat', label: 'Construction Helmet' },
  { value: 'chef', label: 'Chef Hat' },
  { value: 'helmet', label: 'Helmet' },
  { value: 'wizard', label: 'Wizard Hat' },
  { value: 'crown', label: 'Crown' },
];
const OUTFIT_OPTIONS: Array<{ value: Outfit; label: string }> = [
  { value: 'none', label: 'Basic Outfit' },
  { value: 'tie', label: 'Tie' },
  { value: 'labcoat', label: 'Lab Coat' },
  { value: 'hoodie', label: 'Hoodie' },
  { value: 'armor', label: 'Armor/Suit' },
];
const ACCESSORY_OPTIONS: Array<{ value: Accessory; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'glasses', label: 'Glasses' },
  { value: 'goggles', label: 'Goggles' },
  { value: 'headset', label: 'Headset' },
];

const PRESETS: Preset[] = [
  { name: 'Person', label: 'Person', kind: 'human', config: { ...DEFAULT_CONFIG } },
  { name: 'Robot', label: 'Robot', kind: 'special', special: 'Robot' },
  { name: 'Android', label: 'Android', kind: 'special', special: 'Android' },
  { name: 'Cyborg', label: 'Cyborg', kind: 'special', special: 'Cyborg' },
  { name: 'Worker', label: 'Construction', kind: 'human', config: { hair: 'short', facial: 'none', hat: 'hardhat', outfit: 'none', accessory: 'none' } },
  { name: 'Business', label: 'Business', kind: 'human', config: { hair: 'short', facial: 'none', hat: 'none', outfit: 'tie', accessory: 'none' } },
  { name: 'Doctor', label: 'Doctor', kind: 'human', config: { hair: 'short', facial: 'none', hat: 'none', outfit: 'labcoat', accessory: 'none' } },
  { name: 'Scientist', label: 'Scientist', kind: 'human', config: { hair: 'short', facial: 'none', hat: 'none', outfit: 'labcoat', accessory: 'goggles' } },
  { name: 'Chef', label: 'Chef', kind: 'human', config: { hair: 'none', facial: 'none', hat: 'chef', outfit: 'none', accessory: 'none' } },
  { name: 'Detective', label: 'Detective', kind: 'human', config: { hair: 'short', facial: 'mustache', hat: 'fedora', outfit: 'tie', accessory: 'glasses' } },
  { name: 'Support', label: 'Support', kind: 'human', config: { hair: 'short', facial: 'none', hat: 'none', outfit: 'none', accessory: 'headset' } },
  { name: 'Astronaut', label: 'Astronaut', kind: 'human', config: { hair: 'none', facial: 'none', hat: 'helmet', outfit: 'armor', accessory: 'none' } },
  { name: 'Wizard', label: 'Wizard', kind: 'human', config: { hair: 'long', facial: 'goatee', hat: 'wizard', outfit: 'none', accessory: 'none' } },
  { name: 'Royal', label: 'Royal', kind: 'human', config: { hair: 'short', facial: 'none', hat: 'crown', outfit: 'tie', accessory: 'none' } },
];

const PRESET_MAP: Record<string, Preset> = Object.fromEntries(PRESETS.map((preset) => [preset.name, preset]));

function safeColor(color: string | undefined, fallback = 'currentColor'): string {
  const value = (color ?? '').trim();
  if (!value) return fallback;
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) return value;
  if (/^rgba?\([0-9.,%\s-]+\)$/.test(value)) return value;
  if (/^hsla?\([0-9.,%\s-]+\)$/.test(value)) return value;
  if (/^var\(--[a-zA-Z0-9_-]+\)$/.test(value)) return value;
  if (value === 'currentColor') return value;
  return fallback;
}

function tintedBackground(color: string | undefined): string {
  const safe = safeColor(color, '');
  if (/^#[0-9a-fA-F]{6}$/.test(safe)) return `${safe}22`;
  if (/^#[0-9a-fA-F]{8}$/.test(safe)) return safe;
  return 'hsl(var(--muted))';
}

function normalizeConfig(partial: Partial<BuilderConfig> | undefined): BuilderConfig {
  const hairCandidate = partial?.hair;
  const facialCandidate = partial?.facial;
  const hatCandidate = partial?.hat;
  const outfitCandidate = partial?.outfit;
  const accessoryCandidate = partial?.accessory;
  const hair: Hair = HAIR_OPTIONS.some((item) => item.value === hairCandidate) ? (hairCandidate as Hair) : DEFAULT_CONFIG.hair;
  const facial: Facial = FACIAL_OPTIONS.some((item) => item.value === facialCandidate) ? (facialCandidate as Facial) : DEFAULT_CONFIG.facial;
  const hat: Hat = HAT_OPTIONS.some((item) => item.value === hatCandidate) ? (hatCandidate as Hat) : DEFAULT_CONFIG.hat;
  const outfit: Outfit = OUTFIT_OPTIONS.some((item) => item.value === outfitCandidate) ? (outfitCandidate as Outfit) : DEFAULT_CONFIG.outfit;
  const accessory: Accessory = ACCESSORY_OPTIONS.some((item) => item.value === accessoryCandidate) ? (accessoryCandidate as Accessory) : DEFAULT_CONFIG.accessory;
  return { hair, facial, hat, outfit, accessory };
}

function parseBuilderAvatar(avatar: string | undefined): BuilderConfig | null {
  if (!avatar || !avatar.startsWith(BUILDER_PREFIX)) return null;
  const parts = avatar.slice(BUILDER_PREFIX.length).split(':');
  if (parts.length !== 5) return null;
  return normalizeConfig({
    hair: parts[0] as Hair,
    facial: parts[1] as Facial,
    hat: parts[2] as Hat,
    outfit: parts[3] as Outfit,
    accessory: parts[4] as Accessory,
  });
}

function encodeBuilderAvatar(config: BuilderConfig): string {
  const next = normalizeConfig(config);
  return `${BUILDER_PREFIX}${next.hair}:${next.facial}:${next.hat}:${next.outfit}:${next.accessory}`;
}

function resolveAvatar(avatar: string | undefined): { kind: 'special'; special: Special } | { kind: 'human'; config: BuilderConfig } {
  const parsed = parseBuilderAvatar(avatar);
  if (parsed) return { kind: 'human', config: parsed };

  const preset = avatar ? PRESET_MAP[avatar] : PRESET_MAP.Person;
  if (preset?.kind === 'special' && preset.special) {
    return { kind: 'special', special: preset.special };
  }
  if (preset?.kind === 'human' && preset.config) {
    return { kind: 'human', config: normalizeConfig(preset.config) };
  }
  return { kind: 'human', config: { ...DEFAULT_CONFIG } };
}

function avatarAmbient(c: string): string {
  return [
    `<circle cx="12" cy="12" r="10.2" fill="${c}" opacity="0.04"/>`,
    `<ellipse cx="12" cy="21.25" rx="5.6" ry="1.2" fill="${c}" opacity="0.08"/>`,
  ].join('');
}

function faceBase(c: string): string {
  return [
    `<path d="M5.4 22v-1.4a6.6 6.6 0 0 1 13.2 0V22" fill="${c}" opacity="0.14" stroke="${c}" stroke-width="1.35" stroke-linecap="round"/>`,
    `<path d="M9.1 16.2 12 19.5l2.9-3.3" stroke="${c}" opacity="0.38" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<circle cx="12" cy="9" r="4.6" fill="${c}" opacity="0.22" stroke="${c}" stroke-width="1.35"/>`,
    `<ellipse cx="12" cy="9.8" rx="3.75" ry="3.2" fill="${c}" opacity="0.08"/>`,
    `<circle cx="7.35" cy="9.1" r="0.68" fill="${c}" opacity="0.18"/>`,
    `<circle cx="16.65" cy="9.1" r="0.68" fill="${c}" opacity="0.18"/>`,
    `<path d="M9.55 7.85h1.45" stroke="${c}" stroke-width="0.8" stroke-linecap="round" opacity="0.55"/>`,
    `<path d="M13 7.85h1.45" stroke="${c}" stroke-width="0.8" stroke-linecap="round" opacity="0.55"/>`,
    `<circle cx="10.2" cy="8.9" r="0.62" fill="${c}" opacity="0.82"/>`,
    `<circle cx="13.8" cy="8.9" r="0.62" fill="${c}" opacity="0.82"/>`,
    `<path d="M12 9.6v1.25" stroke="${c}" stroke-width="0.75" stroke-linecap="round" opacity="0.48"/>`,
    `<circle cx="12" cy="10.95" r="0.32" fill="${c}" opacity="0.55"/>`,
    `<path d="M10.35 11.6c.48.5 1.05.78 1.65.78s1.17-.28 1.65-.78" stroke="${c}" stroke-width="0.95" stroke-linecap="round" fill="none"/>`,
  ].join('');
}

function hairPaths(cfg: BuilderConfig, c: string): string {
  if (cfg.hair === 'none') return '';
  if (cfg.hair === 'buzz') return `<path d="M8.3 5.4h7.4" stroke="${c}" stroke-width="1.4" stroke-linecap="round" opacity="0.7"/>`;
  if (cfg.hair === 'short') return `<path d="M7.5 8.1c.25-2.95 2.3-4.9 4.5-4.9 2.6 0 4.65 1.9 4.95 4.9" stroke="${c}" stroke-width="1.45" stroke-linecap="round" fill="none"/>`;
  return [
    `<path d="M7.2 8.2c.3-3.15 2.3-5.15 4.8-5.15 2.7 0 4.7 2.05 5 5.15" stroke="${c}" stroke-width="1.35" stroke-linecap="round" fill="none"/>`,
    `<path d="M8.4 8.4v4" stroke="${c}" stroke-width="1.05" stroke-linecap="round" opacity="0.7"/>`,
    `<path d="M15.6 8.4v4" stroke="${c}" stroke-width="1.05" stroke-linecap="round" opacity="0.7"/>`,
  ].join('');
}

function facialPaths(cfg: BuilderConfig, c: string): string {
  if (cfg.facial === 'none') return '';
  if (cfg.facial === 'mustache') return `<path d="M9.6 10.6c.3.45.9.8 1.5.8.4 0 .7-.1.9-.35.2.25.5.35.9.35.6 0 1.2-.35 1.5-.8" stroke="${c}" stroke-width="1" stroke-linecap="round" fill="none"/>`;
  if (cfg.facial === 'goatee') return `<path d="M11.25 12.2c.2.7.45 1.35.75 1.85.3-.5.55-1.15.75-1.85" stroke="${c}" stroke-width="1" stroke-linecap="round" fill="none"/>`;
  return `<path d="M9.1 11.9c.2 1.55 1.35 2.7 2.9 2.7s2.7-1.15 2.9-2.7" stroke="${c}" stroke-width="1.1" stroke-linecap="round" fill="none"/>`;
}

function hatPaths(cfg: BuilderConfig, c: string): string {
  switch (cfg.hat) {
    case 'cap':
      return `<path d="M7.2 8c0-2.45 2-4.2 4.8-4.2s4.8 1.75 4.8 4.2" fill="${c}" opacity="0.28" stroke="${c}" stroke-width="1.2"/><path d="M7 8.2h10.6" stroke="${c}" stroke-width="1.25" stroke-linecap="round"/>`;
    case 'fedora':
      return `<path d="M8.2 7.8h7.6l-.8-2.5c-.25-.8-.95-1.3-2-1.3h-2c-1.05 0-1.75.5-2 1.3z" fill="${c}" opacity="0.3" stroke="${c}" stroke-width="1.05"/><path d="M6 8h12" stroke="${c}" stroke-width="1.35" stroke-linecap="round"/>`;
    case 'beanie':
      return `<path d="M7.5 8.1c0-3.05 1.8-5 4.5-5s4.5 1.95 4.5 5" fill="${c}" opacity="0.22" stroke="${c}" stroke-width="1.1"/><rect x="7" y="7.7" width="10" height="1.9" rx="0.95" fill="${c}" opacity="0.35"/>`;
    case 'hardhat':
      return `<path d="M6.6 8.1c0-3 2.3-5.1 5.4-5.1s5.4 2.1 5.4 5.1" fill="${c}" opacity="0.3" stroke="${c}" stroke-width="1.2"/><path d="M6.1 8.2h11.8" stroke="${c}" stroke-width="1.45" stroke-linecap="round"/>`;
    case 'chef':
      return `<path d="M8.1 8.1C8.1 4 9.2 2.1 12 2.1s3.9 1.9 3.9 6" fill="${c}" opacity="0.2" stroke="${c}" stroke-width="1.15"/><ellipse cx="12" cy="2.6" rx="3.15" ry="1.85" fill="${c}" opacity="0.26" stroke="${c}" stroke-width="0.9"/><path d="M7.5 8.1h9" stroke="${c}" stroke-width="1.3" stroke-linecap="round"/>`;
    case 'helmet':
      return `<path d="M6.9 8.2c0-3.2 2-5.35 5.1-5.35s5.1 2.15 5.1 5.35" fill="${c}" opacity="0.22" stroke="${c}" stroke-width="1.2"/><path d="M6.4 8.3h11.2" stroke="${c}" stroke-width="1.45" stroke-linecap="round"/>`;
    case 'wizard':
      return `<path d="M12 1 7 8.3h10L12 1z" fill="${c}" opacity="0.28" stroke="${c}" stroke-width="1.1" stroke-linejoin="round"/><path d="M6.5 8.3h11" stroke="${c}" stroke-width="1.3" stroke-linecap="round"/>`;
    case 'crown':
      return `<path d="M7 7.7l1-3.9 2.1 2.5L12 3.1l1.9 3.2L16 3.8l1 3.9H7z" fill="${c}" opacity="0.3" stroke="${c}" stroke-width="1" stroke-linejoin="round"/><path d="M7 7.8h10" stroke="${c}" stroke-width="1.2" stroke-linecap="round"/>`;
    default:
      return '';
  }
}

function outfitPaths(cfg: BuilderConfig, c: string): string {
  switch (cfg.outfit) {
    case 'tie':
      return `<path d="M9.6 14.4 12 15.7l2.4-1.3" stroke="${c}" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 15.6 10.8 18l1.2 3.2 1.2-3.2z" fill="${c}" opacity="0.45" stroke="${c}" stroke-width="0.9"/>`;
    case 'labcoat':
      return `<path d="M7.2 22v-3.1c0-1.7 1.3-3 3-3h3.6c1.7 0 3 1.3 3 3V22" fill="${c}" opacity="0.08" stroke="${c}" stroke-width="1.15"/><path d="M9.8 16.1 12 18.2l2.2-2.1" stroke="${c}" stroke-width="1" stroke-linejoin="round"/>`;
    case 'hoodie':
      return `<path d="M8.2 15.8c.4-1.3 1.8-2.1 3.8-2.1s3.4.8 3.8 2.1" stroke="${c}" stroke-width="1.2" stroke-linecap="round" fill="none"/>`;
    case 'armor':
      return `<path d="M8 22v-3c0-2.1 1.6-3.8 4-3.8s4 1.7 4 3.8v3" fill="${c}" opacity="0.12" stroke="${c}" stroke-width="1.25"/><path d="M9.2 17.6h5.6" stroke="${c}" stroke-width="1.05" stroke-linecap="round"/>`;
    default:
      return '';
  }
}

function accessoryPaths(cfg: BuilderConfig, c: string): string {
  switch (cfg.accessory) {
    case 'glasses':
      return `<rect x="7.5" y="7.7" width="3.8" height="2.6" rx="1.1" fill="${c}" opacity="0.12" stroke="${c}" stroke-width="0.95"/><rect x="12.7" y="7.7" width="3.8" height="2.6" rx="1.1" fill="${c}" opacity="0.12" stroke="${c}" stroke-width="0.95"/><path d="M11.3 9h1.4" stroke="${c}" stroke-width="0.85" stroke-linecap="round"/>`;
    case 'goggles':
      return `<rect x="7" y="7.4" width="4.4" height="3" rx="1.2" fill="${c}" opacity="0.16" stroke="${c}" stroke-width="1.05"/><rect x="12.6" y="7.4" width="4.4" height="3" rx="1.2" fill="${c}" opacity="0.16" stroke="${c}" stroke-width="1.05"/>`;
    case 'headset':
      return `<path d="M6.4 9.2a5.6 5.6 0 0 1 11.2 0" stroke="${c}" stroke-width="1.2" stroke-linecap="round" fill="none"/><rect x="4.2" y="8.2" width="2.1" height="3.8" rx="0.85" fill="${c}" opacity="0.34"/><rect x="17.7" y="8.2" width="2.1" height="3.8" rx="0.85" fill="${c}" opacity="0.34"/>`;
    default:
      return '';
  }
}

function specialPaths(kind: Special, c: string): string {
  if (kind === 'Robot') {
    return `<line x1="12" y1="2" x2="12" y2="4.3" stroke="${c}" stroke-width="1.35" stroke-linecap="round"/><circle cx="12" cy="1.65" r="0.95" fill="${c}" opacity="0.58"/><rect x="6.2" y="4.35" width="11.6" height="9.2" rx="2.5" fill="${c}" opacity="0.2" stroke="${c}" stroke-width="1.35"/><rect x="7.5" y="5.6" width="9" height="1.1" rx="0.55" fill="${c}" opacity="0.22"/><rect x="8.25" y="7.5" width="2.75" height="2.1" rx="0.55" fill="${c}" opacity="0.72"/><rect x="13" y="7.5" width="2.75" height="2.1" rx="0.55" fill="${c}" opacity="0.72"/><circle cx="7.3" cy="8.95" r="0.34" fill="${c}" opacity="0.5"/><circle cx="16.7" cy="8.95" r="0.34" fill="${c}" opacity="0.5"/><path d="M9.35 11.55h5.3" stroke="${c}" stroke-width="1.05" stroke-linecap="round"/><rect x="7.45" y="14.45" width="9.1" height="6.1" rx="2" fill="${c}" opacity="0.13" stroke="${c}" stroke-width="1.2"/><path d="M10 16.9h4" stroke="${c}" stroke-width="0.9" stroke-linecap="round" opacity="0.52"/>`;
  }
  if (kind === 'Android') {
    return `<line x1="7.05" y1="3" x2="9.2" y2="5.35" stroke="${c}" stroke-width="1.1" stroke-linecap="round"/><line x1="16.95" y1="3" x2="14.8" y2="5.35" stroke="${c}" stroke-width="1.1" stroke-linecap="round"/><rect x="6.25" y="4.75" width="11.5" height="8.6" rx="3.1" fill="${c}" opacity="0.2" stroke="${c}" stroke-width="1.3"/><path d="M7.6 6.6h8.8" stroke="${c}" stroke-width="0.8" opacity="0.28"/><circle cx="9.45" cy="8.8" r="1.08" fill="${c}" opacity="0.72"/><circle cx="14.55" cy="8.8" r="1.08" fill="${c}" opacity="0.72"/><path d="M10 11.35c.5.43 1.16.68 2 .68s1.5-.25 2-.68" stroke="${c}" stroke-width="0.95" stroke-linecap="round" fill="none"/><rect x="7.9" y="13.95" width="8.2" height="6.25" rx="2.05" fill="${c}" opacity="0.13" stroke="${c}" stroke-width="1.15"/><path d="M9.9 16.75h4.2" stroke="${c}" stroke-width="0.85" stroke-linecap="round" opacity="0.5"/>`;
  }
  return `<circle cx="12" cy="9" r="5.05" fill="${c}" opacity="0.2" stroke="${c}" stroke-width="1.35"/><path d="M12 3.95v10.1" stroke="${c}" stroke-width="0.68" opacity="0.48"/><path d="M9.55 6.8c.35-.5.95-.9 1.55-.9" stroke="${c}" stroke-width="0.72" opacity="0.58" stroke-linecap="round"/><circle cx="10" cy="8.6" r="0.68" fill="${c}" opacity="0.74"/><rect x="12.9" y="7.05" width="2.65" height="2.1" rx="0.4" fill="${c}" opacity="0.6"/><path d="M14.05 10.45h2.1" stroke="${c}" stroke-width="0.86" opacity="0.56" stroke-linecap="round"/><path d="M14.05 11.6h1.7" stroke="${c}" stroke-width="0.86" opacity="0.56" stroke-linecap="round"/><path d="M5.2 22v-1.3a6.8 6.8 0 0 1 13.6 0V22" fill="${c}" opacity="0.13" stroke="${c}" stroke-width="1.35" stroke-linecap="round"/>`;
}

function presetEnhancements(name: string | null, c: string): string {
  if (!name) return '';
  switch (name) {
    case 'Worker':
      return `<rect x="8.9" y="4.35" width="6.2" height="1.25" rx="0.55" fill="#f8fafc" opacity="0.65"/><path d="M9.15 16.9h5.7" stroke="#f8fafc" stroke-width="1.05" stroke-linecap="round" opacity="0.62"/>`;
    case 'Business':
      return `<path d="M9.1 14.55h5.8" stroke="#f8fafc" stroke-width="0.95" stroke-linecap="round" opacity="0.7"/><path d="M10.2 15.3 12 16.35l1.8-1.05" stroke="${c}" stroke-width="0.8" opacity="0.65" stroke-linecap="round"/>`;
    case 'Doctor':
      return `<circle cx="12" cy="18.55" r="0.95" fill="#f8fafc" stroke="${c}" stroke-width="0.75"/><path d="M9.25 17.05c.1.95 1.2 1.8 2.75 1.8s2.65-.85 2.75-1.8" stroke="#f8fafc" stroke-width="0.95" stroke-linecap="round" fill="none"/>`;
    case 'Scientist':
      return `<path d="M7.95 8.1h3.1" stroke="#f8fafc" stroke-width="0.7" opacity="0.85"/><path d="M13 8.1h3.1" stroke="#f8fafc" stroke-width="0.7" opacity="0.85"/><path d="M11.45 16.65h1.1l.45 1.2h-2z" fill="#f8fafc" opacity="0.58"/>`;
    case 'Chef':
      return `<path d="M8.7 4.1c.6-.8 1.5-1.2 2.4-1.2" stroke="#f8fafc" stroke-width="0.75" opacity="0.8" stroke-linecap="round"/><path d="M13.1 2.95c.95.15 1.7.6 2.2 1.45" stroke="#f8fafc" stroke-width="0.75" opacity="0.8" stroke-linecap="round"/>`;
    case 'Detective':
      return `<circle cx="9.9" cy="9.1" r="1.55" fill="none" stroke="#f8fafc" stroke-width="0.8" opacity="0.7"/><path d="M11.45 9.1h1.2" stroke="#f8fafc" stroke-width="0.7" opacity="0.7"/>`;
    case 'Support':
      return `<path d="M9.1 15.75h5.8" stroke="#f8fafc" stroke-width="0.8" opacity="0.68" stroke-linecap="round"/><path d="M9.1 16.8h4.2" stroke="#f8fafc" stroke-width="0.8" opacity="0.55" stroke-linecap="round"/>`;
    case 'Astronaut':
      return `<path d="M9.05 8.25c.45-.65 1.05-1.15 1.8-1.45" stroke="#f8fafc" stroke-width="0.75" opacity="0.72" stroke-linecap="round"/><circle cx="16.85" cy="17.05" r="0.72" fill="#f8fafc" opacity="0.65"/>`;
    case 'Wizard':
      return `<circle cx="11.25" cy="4.6" r="0.42" fill="#fef9c3" opacity="0.9"/><circle cx="13.95" cy="5.4" r="0.32" fill="#fef9c3" opacity="0.78"/>`;
    case 'Royal':
      return `<circle cx="10.5" cy="6.15" r="0.38" fill="#fef08a" opacity="0.88"/><circle cx="12" cy="5.65" r="0.38" fill="#fef08a" opacity="0.88"/><circle cx="13.5" cy="6.15" r="0.38" fill="#fef08a" opacity="0.88"/>`;
    case 'Person':
      return `<path d="M9.55 15.65h4.9" stroke="${c}" stroke-width="0.72" opacity="0.42" stroke-linecap="round"/>`;
    default:
      return '';
  }
}

function getAvatarPaths(avatar: string | undefined, color: string): string {
  const isBuilderAvatar = Boolean(parseBuilderAvatar(avatar));
  const presetName = !isBuilderAvatar && avatar && PRESET_MAP[avatar]
    ? avatar
    : (!isBuilderAvatar ? 'Person' : null);
  const resolved = resolveAvatar(avatar);
  if (resolved.kind === 'special') {
    return [avatarAmbient(color), specialPaths(resolved.special, color)].join('');
  }
  return [
    avatarAmbient(color),
    faceBase(color),
    hairPaths(resolved.config, color),
    hatPaths(resolved.config, color),
    facialPaths(resolved.config, color),
    outfitPaths(resolved.config, color),
    accessoryPaths(resolved.config, color),
    presetEnhancements(presetName, color),
  ].join('');
}

function buildSvgMarkup(avatar: string | undefined, color: string | undefined, size = 24): string {
  const c = safeColor(color, 'currentColor');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" width="${size}" height="${size}">${getAvatarPaths(avatar, c)}</svg>`;
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function exportPng(avatar: string | undefined, color: string | undefined, filename: string): Promise<void> {
  const svgMarkup = buildSvgMarkup(avatar, color, 512);
  const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Unable to load avatar image for PNG export.'));
    image.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    URL.revokeObjectURL(url);
    throw new Error('Unable to create PNG canvas.');
  }
  ctx.clearRect(0, 0, 512, 512);
  ctx.drawImage(image, 0, 0, 512, 512);
  URL.revokeObjectURL(url);

  const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
  if (!pngBlob) {
    throw new Error('Unable to export PNG file.');
  }
  const pngUrl = URL.createObjectURL(pngBlob);
  const anchor = document.createElement('a');
  anchor.href = pngUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(pngUrl);
}

function buildPresetComponent(name: string): AvatarSvgComponent {
  const PresetComponent: AvatarSvgComponent = ({ className, color, ...rest }) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      {...rest}
      dangerouslySetInnerHTML={{ __html: getAvatarPaths(name, safeColor(color?.toString(), 'currentColor')) }}
    />
  );
  return PresetComponent;
}

export const AGENT_AVATARS: { name: string; label: string; component: AvatarSvgComponent }[] = PRESETS.map((preset) => ({
  name: preset.name,
  label: preset.label,
  component: buildPresetComponent(preset.name),
}));

export const AGENT_AVATAR_COLORS = [
  { name: 'Default', value: undefined },
  { name: 'Teal', value: '#4db6ac' },
  { name: 'Blue', value: '#5c9eff' },
  { name: 'Purple', value: '#a78bfa' },
  { name: 'Pink', value: '#f472b6' },
  { name: 'Orange', value: '#fb923c' },
  { name: 'Yellow', value: '#fbbf24' },
  { name: 'Green', value: '#4ade80' },
  { name: 'Red', value: '#f87171' },
  { name: 'Indigo', value: '#818cf8' },
  { name: 'Cyan', value: '#22d3ee' },
  { name: 'Lime', value: '#a3e635' },
  { name: 'Slate', value: '#64748b' },
  { name: 'Rose', value: '#f43f5e' },
];

interface AgentAvatarPickerProps {
  selectedAvatar: string | undefined;
  selectedColor: string | undefined;
  onAvatarChange: (avatar: string | undefined) => void;
  onColorChange: (color: string | undefined) => void;
}

function AgentAvatarPicker({
  selectedAvatar,
  selectedColor,
  onAvatarChange,
  onColorChange,
}: AgentAvatarPickerProps) {
  const [activeTab, setActiveTab] = useState<'preset' | 'builder' | 'color'>('preset');
  const [builderConfig, setBuilderConfig] = useState<BuilderConfig>(() => {
    const resolved = resolveAvatar(selectedAvatar);
    return resolved.kind === 'human' ? resolved.config : { ...DEFAULT_CONFIG };
  });
  const [avatarCodeInput, setAvatarCodeInput] = useState(selectedAvatar || 'Person');
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  useEffect(() => {
    const resolved = resolveAvatar(selectedAvatar);
    if (resolved.kind === 'human') {
      setBuilderConfig(resolved.config);
    }
    setAvatarCodeInput(selectedAvatar || 'Person');
  }, [selectedAvatar]);

  const previewColor = safeColor(selectedColor, 'hsl(var(--foreground))');
  const presetIconColor = safeColor(selectedColor, 'hsl(var(--foreground))');
  const selectedPreset = useMemo(() => AGENT_AVATARS.find((entry) => entry.name === selectedAvatar), [selectedAvatar]);
  const SelectedComponent = selectedPreset?.component;

  const handleBuilderChange = <K extends keyof BuilderConfig>(key: K, value: BuilderConfig[K]) => {
    const next = normalizeConfig({ ...builderConfig, [key]: value });
    setBuilderConfig(next);
    const encoded = encodeBuilderAvatar(next);
    onAvatarChange(encoded);
    setAvatarCodeInput(encoded);
  };

  const effectiveAvatar = selectedAvatar || 'Person';

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(effectiveAvatar);
      setExportStatus('Avatar code copied.');
    } catch {
      setExportStatus('Unable to copy avatar code.');
    }
  };

  const handleApplyCode = () => {
    const value = avatarCodeInput.trim();
    if (!value) {
      onAvatarChange(undefined);
      setExportStatus('Avatar reset to default.');
      return;
    }
    if (value.startsWith(BUILDER_PREFIX) || PRESET_MAP[value]) {
      onAvatarChange(value);
      setExportStatus('Avatar code applied.');
      return;
    }
    setExportStatus('Invalid avatar code. Use a preset name or builder code.');
  };

  const handleExportSvg = () => {
    const filename = `agent-avatar-${Date.now()}.svg`;
    downloadTextFile(filename, buildSvgMarkup(effectiveAvatar, selectedColor, 512), 'image/svg+xml;charset=utf-8');
    setExportStatus(`Exported ${filename}`);
  };

  const handleExportPng = async () => {
    const filename = `agent-avatar-${Date.now()}.png`;
    try {
      await exportPng(effectiveAvatar, selectedColor, filename);
      setExportStatus(`Exported ${filename}`);
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : 'Unable to export PNG avatar.');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-center">
        <div
          className={cn(
            'flex items-center justify-center w-16 h-16 rounded-xl',
            'border-2 border-border/50 transition-all duration-200'
          )}
          style={{ backgroundColor: tintedBackground(selectedColor) }}
        >
          {SelectedComponent ? (
            <SelectedComponent className="h-10 w-10" color={previewColor} />
          ) : (
            <svg viewBox="0 0 24 24" fill="none" className="h-10 w-10" dangerouslySetInnerHTML={{ __html: getAvatarPaths(selectedAvatar, previewColor) }} />
          )}
        </div>
      </div>

      <div className="flex border-b border-border/50">
        <button type="button" onClick={() => setActiveTab('preset')} className={cn('flex-1 py-2 text-sm font-medium transition-colors', activeTab === 'preset' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground')}>Presets</button>
        <button type="button" onClick={() => setActiveTab('builder')} className={cn('flex-1 py-2 text-sm font-medium transition-colors', activeTab === 'builder' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground')}>Builder</button>
        <button type="button" onClick={() => setActiveTab('color')} className={cn('flex-1 py-2 text-sm font-medium transition-colors', activeTab === 'color' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground')}>Color</button>
      </div>

      {activeTab === 'preset' ? (
        <ScrollArea className="h-[260px]">
          <div className="grid grid-cols-4 gap-2 p-1">
            {AGENT_AVATARS.map(({ name, label, component: AvatarComp }) => (
              <button
                key={name}
                type="button"
                onClick={() => { onAvatarChange(name); setAvatarCodeInput(name); setExportStatus(null); }}
                className={cn(
                  'flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-all duration-200',
                  'hover:scale-[1.02] hover:border-primary/40 hover:bg-accent/40',
                  selectedAvatar === name
                    ? 'bg-primary/10 border-primary/50 ring-2 ring-primary/25'
                    : 'bg-card border-border/70'
                )}
                title={label}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-md border border-border/70 bg-background shadow-sm">
                  <AvatarComp className="h-10 w-10" color={presetIconColor} />
                </div>
                <span className="text-[10px] font-medium text-foreground truncate w-full text-center">{label}</span>
              </button>
            ))}
          </div>
        </ScrollArea>
      ) : activeTab === 'builder' ? (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1"><label className="text-xs text-muted-foreground">Hair</label><select value={builderConfig.hair} onChange={(e) => handleBuilderChange('hair', e.target.value as Hair)} className="rounded-md border border-input bg-background px-2 py-2 text-sm">{HAIR_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
            <div className="grid gap-1"><label className="text-xs text-muted-foreground">Facial Hair</label><select value={builderConfig.facial} onChange={(e) => handleBuilderChange('facial', e.target.value as Facial)} className="rounded-md border border-input bg-background px-2 py-2 text-sm">{FACIAL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
            <div className="grid gap-1"><label className="text-xs text-muted-foreground">Hat</label><select value={builderConfig.hat} onChange={(e) => handleBuilderChange('hat', e.target.value as Hat)} className="rounded-md border border-input bg-background px-2 py-2 text-sm">{HAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
            <div className="grid gap-1"><label className="text-xs text-muted-foreground">Outfit</label><select value={builderConfig.outfit} onChange={(e) => handleBuilderChange('outfit', e.target.value as Outfit)} className="rounded-md border border-input bg-background px-2 py-2 text-sm">{OUTFIT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
            <div className="grid gap-1 sm:col-span-2"><label className="text-xs text-muted-foreground">Accessory</label><select value={builderConfig.accessory} onChange={(e) => handleBuilderChange('accessory', e.target.value as Accessory)} className="rounded-md border border-input bg-background px-2 py-2 text-sm">{ACCESSORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
          </div>

          <div className="grid gap-1">
            <label className="text-xs text-muted-foreground">Avatar code</label>
            <div className="flex gap-2">
              <input value={avatarCodeInput} onChange={(e) => setAvatarCodeInput(e.target.value)} className="flex-1 rounded-md border border-input bg-background px-2 py-2 text-xs font-mono" placeholder="builder:v1:short:none:none:none:none" />
              <button type="button" onClick={handleApplyCode} className="rounded-md border border-input bg-background px-3 py-2 text-xs hover:bg-accent">Apply</button>
            </div>
            <p className="text-[11px] text-muted-foreground">Share this code to reuse the same avatar configuration.</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void handleCopyCode()} className="rounded-md border border-input bg-background px-3 py-2 text-xs hover:bg-accent">Copy code</button>
            <button type="button" onClick={handleExportSvg} className="rounded-md border border-input bg-background px-3 py-2 text-xs hover:bg-accent">Export SVG</button>
            <button type="button" onClick={() => void handleExportPng()} className="rounded-md border border-input bg-background px-3 py-2 text-xs hover:bg-accent">Export PNG</button>
          </div>
          {exportStatus && <p className="text-[11px] text-muted-foreground">{exportStatus}</p>}
        </div>
      ) : (
        <div className="grid grid-cols-6 gap-2 p-1">
          {AGENT_AVATAR_COLORS.map((color) => (
            <button key={color.name} type="button" onClick={() => onColorChange(color.value)} className={cn('w-10 h-10 rounded-lg border-2 transition-all duration-200 hover:scale-110', selectedColor === color.value ? 'border-primary ring-2 ring-primary/20' : 'border-border/50 hover:border-border')} style={{ backgroundColor: color.value || 'hsl(var(--muted))' }} title={color.name} />
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(AgentAvatarPicker);

export function AgentAvatarIcon({ avatar, color, className }: { avatar: string | undefined; color: string | undefined; className?: string }) {
  const c = safeColor(color, 'currentColor');
  return <svg viewBox="0 0 24 24" fill="none" className={className} dangerouslySetInnerHTML={{ __html: getAvatarPaths(avatar, c) }} />;
}
