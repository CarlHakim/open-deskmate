import aiWizard from '/assets/agent-characters/ai-wizard.png';
import algorithmAstronaut from '/assets/agent-characters/algorithm-astronaut.png';
import apiOctopus from '/assets/agent-characters/api-octopus.png';
import automationGremlin from '/assets/agent-characters/automation-gremlin.png';
import bugHunterBeetle from '/assets/agent-characters/bug-hunter-beetle.png';
import circuitSorcerer from '/assets/agent-characters/circuit sorcerer.png';
import coffeePoweredGenius from '/assets/agent-characters/coffee-powered-genius.png';
import cosmicInventor from '/assets/agent-characters/cosmic-inventor.png';
import cyberChameleon from '/assets/agent-characters/cyber-chameleon.png';
import cyberFox from '/assets/agent-characters/cyber-fox.png';
import dashboardDj from '/assets/agent-characters/dashboard-dj.png';
import dataDetective from '/assets/agent-characters/data-detective.png';
import dataPirate from '/assets/agent-characters/data-pirate.png';
import friendlyHackerGoblin from '/assets/agent-characters/friendly-hacker-goblin.png';
import ideaDragon from '/assets/agent-characters/idea-dragon.png';
import lightningLibrarian from '/assets/agent-characters/lightning-librarian.png';
import madScientist from '/assets/agent-characters/mad-scientist.png';
import memeMage from '/assets/agent-characters/meme-mage.png';
import neonAlchemist from '/assets/agent-characters/neon-alchemist.png';
import neuralNetworkGardener from '/assets/agent-characters/neural-network-gardener.png';
import pixelPaladin from '/assets/agent-characters/pixel-paladin.png';
import promptGoblin from '/assets/agent-characters/prompt-goblin.png';
import quantumCat from '/assets/agent-characters/quantum-cat.png';
import quantumPenguin from '/assets/agent-characters/quantum-penguin.png';
import robotSidekick from '/assets/agent-characters/robot-sidekick.png';
import rocketRaccoonEngineer from '/assets/agent-characters/rocket-raccoon-engineer.png';
import spreadsheetWizard from '/assets/agent-characters/spreadsheet-wizard.png';
import synthwaveOwl from '/assets/agent-characters/synthwave-owl.png';
import timeTravelMechanic from '/assets/agent-characters/time-travel-mechanic.png';
import tinyBotWrangler from '/assets/agent-characters/tiny-bot-wrangler.png';

const CHARACTER_PREFIX = 'character:v1:';
const ACRONYM_WORDS = new Set(['ai', 'api', 'dj']);

export type AgentCharacterAvatar = {
  id: string;
  slug: string;
  filename: string;
  label: string;
  src: string;
};

function toCharacterLabel(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, '');
  return stem
    .split(/[-\s]+/g)
    .filter(Boolean)
    .map((word) => (
      ACRONYM_WORDS.has(word.toLowerCase())
        ? word.toUpperCase()
        : `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`
    ))
    .join(' ');
}

function toCharacterSlug(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function character(filename: string, src: string): AgentCharacterAvatar {
  const slug = toCharacterSlug(filename);
  return {
    id: `${CHARACTER_PREFIX}${slug}`,
    slug,
    filename,
    label: toCharacterLabel(filename),
    src,
  };
}

export const AGENT_CHARACTER_AVATARS: AgentCharacterAvatar[] = [
  character('ai-wizard.png', aiWizard),
  character('algorithm-astronaut.png', algorithmAstronaut),
  character('api-octopus.png', apiOctopus),
  character('automation-gremlin.png', automationGremlin),
  character('bug-hunter-beetle.png', bugHunterBeetle),
  character('circuit sorcerer.png', circuitSorcerer),
  character('coffee-powered-genius.png', coffeePoweredGenius),
  character('cosmic-inventor.png', cosmicInventor),
  character('cyber-chameleon.png', cyberChameleon),
  character('cyber-fox.png', cyberFox),
  character('dashboard-dj.png', dashboardDj),
  character('data-detective.png', dataDetective),
  character('data-pirate.png', dataPirate),
  character('friendly-hacker-goblin.png', friendlyHackerGoblin),
  character('idea-dragon.png', ideaDragon),
  character('lightning-librarian.png', lightningLibrarian),
  character('mad-scientist.png', madScientist),
  character('meme-mage.png', memeMage),
  character('neon-alchemist.png', neonAlchemist),
  character('neural-network-gardener.png', neuralNetworkGardener),
  character('pixel-paladin.png', pixelPaladin),
  character('prompt-goblin.png', promptGoblin),
  character('quantum-cat.png', quantumCat),
  character('quantum-penguin.png', quantumPenguin),
  character('robot-sidekick.png', robotSidekick),
  character('rocket-raccoon-engineer.png', rocketRaccoonEngineer),
  character('spreadsheet-wizard.png', spreadsheetWizard),
  character('synthwave-owl.png', synthwaveOwl),
  character('time-travel-mechanic.png', timeTravelMechanic),
  character('tiny-bot-wrangler.png', tinyBotWrangler),
];

export function getAgentCharacterAvatar(avatar: string | undefined): AgentCharacterAvatar | undefined {
  if (!avatar?.startsWith(CHARACTER_PREFIX)) return undefined;
  return AGENT_CHARACTER_AVATARS.find((entry) => entry.id === avatar);
}

export function isAgentCharacterAvatar(avatar: string | undefined): boolean {
  return Boolean(getAgentCharacterAvatar(avatar));
}

