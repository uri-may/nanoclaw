import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkKillSwitch, _resetForTesting } from './kill-switch.js';

describe('kill-switch', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns active when gist contains "active"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('active\n'),
      }),
    );

    const state = await checkKillSwitch('testuser', 'testgist');
    expect(state).toBe('active');
  });

  it('returns suspended when gist contains "suspended"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('suspended\n'),
      }),
    );

    const state = await checkKillSwitch('testuser', 'testgist');
    expect(state).toBe('suspended');
  });

  it('returns cached state within TTL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('active'),
    });
    vi.stubGlobal('fetch', fetchMock);

    await checkKillSwitch('testuser', 'testgist');
    await checkKillSwitch('testuser', 'testgist');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('defaults to active before first fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network error')),
    );

    const state = await checkKillSwitch('testuser', 'testgist');
    expect(state).toBe('active');
  });

  it('uses cached state on fetch failure (fail-open)', async () => {
    vi.useFakeTimers();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('suspended'),
      })
      .mockRejectedValueOnce(new Error('network error'));
    vi.stubGlobal('fetch', fetchMock);

    // First call: fetches successfully, caches 'suspended'
    await checkKillSwitch('testuser', 'testgist');

    // Advance past cache TTL (60s)
    vi.advanceTimersByTime(61_000);

    // Second call: fetch fails, falls back to cached 'suspended'
    const state = await checkKillSwitch('testuser', 'testgist');
    expect(state).toBe('suspended');

    vi.useRealTimers();
  });
});
