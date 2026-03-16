import { updateGroupConfig } from './db.js';
import { logger } from './logger.js';
import { RegisteredGroup } from './types.js';

const MODEL_ALIASES: Record<string, string> = {
  sonnet: 'claude-sonnet-4-20250514',
  opus: 'claude-opus-4-20250514',
  haiku: 'claude-haiku-4-20250514',
};

const VALID_PREFIXES = ['claude-sonnet', 'claude-opus', 'claude-haiku'];

function resolveModel(input: string): string | null {
  const lower = input.toLowerCase();
  if (MODEL_ALIASES[lower]) return MODEL_ALIASES[lower];
  if (VALID_PREFIXES.some((p) => lower.startsWith(p))) return lower;
  return null;
}

export interface ModelCommandResult {
  reply: string;
  updatedGroup?: RegisteredGroup;
}

export function handleModelCommand(
  args: string,
  chatJid: string,
  group: RegisteredGroup,
): ModelCommandResult {
  const trimmed = args.trim();

  if (!trimmed) {
    const current = group.containerConfig?.model || 'default (opus)';
    return { reply: `Current model: ${current}` };
  }

  const model = resolveModel(trimmed);
  if (!model) {
    const aliases = Object.keys(MODEL_ALIASES).join(', ');
    return {
      reply: `Unknown model "${trimmed}". Use: ${aliases} or a full model ID.`,
    };
  }

  const config = { ...group.containerConfig, model };
  updateGroupConfig(chatJid, config);

  const updatedGroup = { ...group, containerConfig: config };

  logger.info({ chatJid, model }, 'Model switched');
  return {
    reply: `Model switched to ${model}. Takes effect on next message.`,
    updatedGroup,
  };
}
