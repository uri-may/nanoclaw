import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleModelCommand } from './model-command.js';
import { RegisteredGroup } from './types.js';

// Mock db module
vi.mock('./db.js', () => ({
  updateGroupConfig: vi.fn(),
}));

function makeGroup(model?: string): RegisteredGroup {
  return {
    name: 'Test Group',
    folder: 'test',
    trigger: '@bot',
    added_at: '2024-01-01',
    containerConfig: model ? { model } : undefined,
  };
}

describe('handleModelCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns current model when no argument given (default shows "default (opus)")', () => {
    const group = makeGroup();
    const result = handleModelCommand('', 'test@g.us', group);
    expect(result.reply).toBe('Current model: default (opus)');
    expect(result.updatedGroup).toBeUndefined();
  });

  it('returns current model when no argument given and model IS set', () => {
    const group = makeGroup('claude-sonnet-4-20250514');
    const result = handleModelCommand('', 'test@g.us', group);
    expect(result.reply).toBe('Current model: claude-sonnet-4-20250514');
    expect(result.updatedGroup).toBeUndefined();
  });

  it('resolves alias "sonnet" to full model ID', () => {
    const group = makeGroup();
    const result = handleModelCommand('sonnet', 'test@g.us', group);
    expect(result.reply).toBe(
      'Model switched to claude-sonnet-4-20250514. Takes effect on next message.',
    );
    expect(result.updatedGroup?.containerConfig?.model).toBe(
      'claude-sonnet-4-20250514',
    );
  });

  it('resolves alias "opus" to full model ID', () => {
    const group = makeGroup();
    const result = handleModelCommand('opus', 'test@g.us', group);
    expect(result.reply).toBe(
      'Model switched to claude-opus-4-20250514. Takes effect on next message.',
    );
    expect(result.updatedGroup?.containerConfig?.model).toBe(
      'claude-opus-4-20250514',
    );
  });

  it('resolves alias "haiku" to full model ID', () => {
    const group = makeGroup();
    const result = handleModelCommand('haiku', 'test@g.us', group);
    expect(result.reply).toBe(
      'Model switched to claude-haiku-4-20250514. Takes effect on next message.',
    );
    expect(result.updatedGroup?.containerConfig?.model).toBe(
      'claude-haiku-4-20250514',
    );
  });

  it('accepts full model IDs starting with "claude-sonnet"', () => {
    const group = makeGroup();
    const result = handleModelCommand(
      'claude-sonnet-4-20250514',
      'test@g.us',
      group,
    );
    expect(result.reply).toBe(
      'Model switched to claude-sonnet-4-20250514. Takes effect on next message.',
    );
    expect(result.updatedGroup?.containerConfig?.model).toBe(
      'claude-sonnet-4-20250514',
    );
  });

  it('accepts full model IDs starting with "claude-opus"', () => {
    const group = makeGroup();
    const result = handleModelCommand(
      'claude-opus-4-20250514',
      'test@g.us',
      group,
    );
    expect(result.reply).toBe(
      'Model switched to claude-opus-4-20250514. Takes effect on next message.',
    );
    expect(result.updatedGroup?.containerConfig?.model).toBe(
      'claude-opus-4-20250514',
    );
  });

  it('accepts full model IDs starting with "claude-haiku"', () => {
    const group = makeGroup();
    const result = handleModelCommand(
      'claude-haiku-4-20250514',
      'test@g.us',
      group,
    );
    expect(result.reply).toBe(
      'Model switched to claude-haiku-4-20250514. Takes effect on next message.',
    );
    expect(result.updatedGroup?.containerConfig?.model).toBe(
      'claude-haiku-4-20250514',
    );
  });

  it('rejects unknown aliases/model names', () => {
    const group = makeGroup();
    const result = handleModelCommand('gpt4', 'test@g.us', group);
    expect(result.reply).toBe(
      'Unknown model "gpt4". Use: sonnet, opus, haiku or a full model ID.',
    );
    expect(result.updatedGroup).toBeUndefined();
  });

  it('returns confirmation message with model name', () => {
    const group = makeGroup();
    const result = handleModelCommand('sonnet', 'test@g.us', group);
    expect(result.reply).toContain('Model switched to');
    expect(result.reply).toContain('claude-sonnet-4-20250514');
  });

  it('returns updatedGroup in result when model changes', () => {
    const group = makeGroup();
    const result = handleModelCommand('sonnet', 'test@g.us', group);
    expect(result.updatedGroup).toBeDefined();
    expect(result.updatedGroup?.containerConfig?.model).toBe(
      'claude-sonnet-4-20250514',
    );
  });

  it('does NOT call updateGroupConfig when just querying current model (no args)', async () => {
    const { updateGroupConfig } = await import('./db.js');
    const group = makeGroup();
    handleModelCommand('', 'test@g.us', group);
    expect(updateGroupConfig).not.toHaveBeenCalled();
  });

  it('calls updateGroupConfig when model changes', async () => {
    const { updateGroupConfig } = await import('./db.js');
    const group = makeGroup();
    handleModelCommand('sonnet', 'test@g.us', group);
    expect(updateGroupConfig).toHaveBeenCalledWith('test@g.us', {
      model: 'claude-sonnet-4-20250514',
    });
  });
});
