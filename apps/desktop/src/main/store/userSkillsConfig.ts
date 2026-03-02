import Store from 'electron-store';
import type { UserSkillConfig, UserSkillsConfigStore } from '@accomplish/shared';

interface UserSkillsConfigSchema {
  skills: Record<string, UserSkillConfig>;
}

const userSkillsConfigStore = new Store<UserSkillsConfigSchema>({
  name: 'user-skills-config',
  defaults: {
    skills: {},
  },
});

export function getUserSkillsConfigStore(): UserSkillsConfigStore {
  return { skills: userSkillsConfigStore.get('skills') || {} };
}

export function getUserSkillConfig(skillKey: string): UserSkillConfig {
  const skills = userSkillsConfigStore.get('skills') || {};
  return skills[skillKey] || {};
}

export function setUserSkillConfig(skillKey: string, config: UserSkillConfig): UserSkillConfig {
  const normalizedKey = String(skillKey || '').trim();
  if (!normalizedKey) throw new Error('skillKey is required');
  const skills = userSkillsConfigStore.get('skills') || {};
  skills[normalizedKey] = config || {};
  userSkillsConfigStore.set('skills', skills);
  return skills[normalizedKey] || {};
}

export function deleteUserSkillConfig(skillKey: string): boolean {
  const normalizedKey = String(skillKey || '').trim();
  if (!normalizedKey) return false;
  const skills = userSkillsConfigStore.get('skills') || {};
  if (!Object.prototype.hasOwnProperty.call(skills, normalizedKey)) return false;
  delete (skills as Record<string, UserSkillConfig>)[normalizedKey];
  userSkillsConfigStore.set('skills', skills);
  return true;
}
