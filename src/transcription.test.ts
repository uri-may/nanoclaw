import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./env.js', () => ({
  readEnvFile: vi.fn(() => ({ OPENAI_API_KEY: 'test-key' })),
}));

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock OpenAI SDK
const mockCreate = vi.fn();
vi.mock('openai', () => ({
  default: class MockOpenAI {
    audio = { transcriptions: { create: mockCreate } };
    constructor() {}
  },
}));

import { transcribeAudio } from './transcription.js';

describe('transcribeAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns transcribed text on success', async () => {
    mockCreate.mockResolvedValueOnce({ text: 'Hello world' });

    const result = await transcribeAudio(
      Buffer.from('fake-audio'),
      'voice.ogg',
    );

    expect(result).toBe('Hello world');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o-transcribe' }),
    );
  });

  it('passes filename to OpenAI for format detection', async () => {
    mockCreate.mockResolvedValueOnce({ text: 'test' });

    await transcribeAudio(Buffer.from('data'), 'message.ogg');

    const call = mockCreate.mock.calls[0][0];
    expect(call.file).toBeDefined();
  });

  it('returns null on API error', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Rate limited'));

    const result = await transcribeAudio(
      Buffer.from('fake-audio'),
      'voice.ogg',
    );

    expect(result).toBeNull();
  });

  it('returns null for empty transcription', async () => {
    mockCreate.mockResolvedValueOnce({ text: '' });

    const result = await transcribeAudio(
      Buffer.from('fake-audio'),
      'voice.ogg',
    );

    expect(result).toBeNull();
  });

  it('trims whitespace from transcription', async () => {
    mockCreate.mockResolvedValueOnce({ text: '  Hello  ' });

    const result = await transcribeAudio(
      Buffer.from('fake-audio'),
      'voice.ogg',
    );

    expect(result).toBe('Hello');
  });
});
