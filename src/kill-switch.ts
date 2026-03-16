import { logger } from './logger.js';

export type KillSwitchState = 'active' | 'suspended';

const CACHE_TTL_MS = 60_000;

let cachedState: KillSwitchState = 'active';
let lastFetchTime = 0;

export function _resetForTesting(): void {
  cachedState = 'active';
  lastFetchTime = 0;
}

export async function checkKillSwitch(
  githubUsername: string,
  gistId: string,
): Promise<KillSwitchState> {
  const now = Date.now();
  if (now - lastFetchTime < CACHE_TTL_MS) {
    return cachedState;
  }

  const url =
    `https://gist.githubusercontent.com/` +
    `${githubUsername}/${gistId}/raw/wags-kill-switch.txt`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      logger.warn(
        { status: response.status },
        'Kill switch fetch failed, using cached state',
      );
      lastFetchTime = now;
      return cachedState;
    }

    const text = (await response.text()).trim().toLowerCase();
    if (text === 'suspended') {
      cachedState = 'suspended';
    } else {
      cachedState = 'active';
    }
    lastFetchTime = now;
  } catch (err) {
    logger.warn({ err }, 'Kill switch fetch error, using cached state');
    lastFetchTime = now;
  }

  return cachedState;
}
