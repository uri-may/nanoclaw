import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

import { handleCredentialFill } from './credential-fill.js';

// Mock child_process.execFile
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

// Mock puppeteer-core
vi.mock('puppeteer-core', () => ({
  default: {
    connect: vi.fn(),
  },
}));

// Suppress logger output in tests
vi.mock('./logger.js', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { execFile } from 'child_process';
import puppeteer from 'puppeteer-core';

const DATA_DIR = '/tmp/test-credential-fill';

beforeEach(() => {
  vi.clearAllMocks();
  // Clean up results directory
  const resultsDir = path.join(DATA_DIR, 'ipc', 'main-group', 'cred_results');
  if (fs.existsSync(resultsDir)) {
    for (const f of fs.readdirSync(resultsDir)) {
      fs.unlinkSync(path.join(resultsDir, f));
    }
  }
});

describe('handleCredentialFill', () => {
  it('returns false for non-fill_credentials types', async () => {
    const handled = await handleCredentialFill(
      { type: 'schedule_task' },
      'main-group',
      true,
      DATA_DIR,
    );
    expect(handled).toBe(false);
  });

  it('rejects non-main group requests', async () => {
    const handled = await handleCredentialFill(
      { type: 'fill_credentials', requestId: 'req-1' },
      'other-group',
      false,
      DATA_DIR,
    );
    expect(handled).toBe(true);
  });

  it('rejects missing requestId', async () => {
    const handled = await handleCredentialFill(
      { type: 'fill_credentials' },
      'main-group',
      true,
      DATA_DIR,
    );
    expect(handled).toBe(true);
  });

  it('writes failure for missing itemRef', async () => {
    const handled = await handleCredentialFill(
      {
        type: 'fill_credentials',
        requestId: 'req-missing-item',
        fields: [{ selector: '#user', field: 'username' }],
      },
      'main-group',
      true,
      DATA_DIR,
    );
    expect(handled).toBe(true);

    const resultFile = path.join(
      DATA_DIR,
      'ipc',
      'main-group',
      'cred_results',
      'req-missing-item.json',
    );
    const result = JSON.parse(fs.readFileSync(resultFile, 'utf-8'));
    expect(result.success).toBe(false);
    expect(result.message).toContain('Missing');
  });

  it('writes failure for missing fields', async () => {
    const handled = await handleCredentialFill(
      {
        type: 'fill_credentials',
        requestId: 'req-missing-fields',
        itemRef: 'op://Vault/Item',
      },
      'main-group',
      true,
      DATA_DIR,
    );
    expect(handled).toBe(true);

    const resultFile = path.join(
      DATA_DIR,
      'ipc',
      'main-group',
      'cred_results',
      'req-missing-fields.json',
    );
    const result = JSON.parse(fs.readFileSync(resultFile, 'utf-8'));
    expect(result.success).toBe(false);
  });

  it('calls op read with correct vault reference', async () => {
    // Set BROWSER_CDP_URL for the test
    process.env.BROWSER_CDP_URL = 'http://localhost:9222';

    const mockExecFile = vi.mocked(execFile);
    mockExecFile.mockImplementation(
      (_cmd: any, _args: any, _opts: any, cb: any) => {
        cb(null, 'secret-value\n', '');
        return {} as any;
      },
    );

    const mockPage = {
      waitForSelector: vi.fn().mockResolvedValue(null),
      click: vi.fn().mockResolvedValue(null),
      type: vi.fn().mockResolvedValue(null),
    };
    const mockBrowser = {
      pages: vi.fn().mockResolvedValue([mockPage]),
      disconnect: vi.fn(),
    };
    vi.mocked(puppeteer.connect).mockResolvedValue(mockBrowser as any);

    const handled = await handleCredentialFill(
      {
        type: 'fill_credentials',
        requestId: 'req-op-read',
        itemRef: 'op://Personal/BankOfIsrael',
        fields: [{ selector: '#username', field: 'username' }],
      },
      'main-group',
      true,
      DATA_DIR,
    );
    expect(handled).toBe(true);

    // Verify op read was called with the correct reference
    expect(mockExecFile).toHaveBeenCalledWith(
      'op',
      ['read', 'op://Personal/BankOfIsrael/username'],
      expect.objectContaining({ timeout: 10000 }),
      expect.any(Function),
    );

    delete process.env.BROWSER_CDP_URL;
  });

  it('connects to browser and fills selectors', async () => {
    process.env.BROWSER_CDP_URL = 'http://localhost:9222';

    const mockExecFile = vi.mocked(execFile);
    mockExecFile.mockImplementation(
      (_cmd: any, _args: any, _opts: any, cb: any) => {
        cb(null, 'test-value\n', '');
        return {} as any;
      },
    );

    const mockPage = {
      waitForSelector: vi.fn().mockResolvedValue(null),
      click: vi.fn().mockResolvedValue(null),
      type: vi.fn().mockResolvedValue(null),
    };
    const mockBrowser = {
      pages: vi.fn().mockResolvedValue([mockPage]),
      disconnect: vi.fn(),
    };
    vi.mocked(puppeteer.connect).mockResolvedValue(mockBrowser as any);

    await handleCredentialFill(
      {
        type: 'fill_credentials',
        requestId: 'req-fill',
        itemRef: 'op://Vault/Item',
        fields: [
          { selector: '#user', field: 'username' },
          { selector: '#pass', field: 'password' },
        ],
      },
      'main-group',
      true,
      DATA_DIR,
    );

    expect(puppeteer.connect).toHaveBeenCalledWith({
      browserURL: 'http://localhost:9222',
    });
    expect(mockPage.waitForSelector).toHaveBeenCalledTimes(2);
    expect(mockPage.click).toHaveBeenCalledTimes(2);
    expect(mockPage.type).toHaveBeenCalledTimes(2);
    expect(mockBrowser.disconnect).toHaveBeenCalled();

    const resultFile = path.join(
      DATA_DIR,
      'ipc',
      'main-group',
      'cred_results',
      'req-fill.json',
    );
    const result = JSON.parse(fs.readFileSync(resultFile, 'utf-8'));
    expect(result.success).toBe(true);
    expect(result.message).toContain('2 field(s)');

    delete process.env.BROWSER_CDP_URL;
  });

  it('handles op read failures gracefully', async () => {
    process.env.BROWSER_CDP_URL = 'http://localhost:9222';

    const mockExecFile = vi.mocked(execFile);
    mockExecFile.mockImplementation(
      (_cmd: any, _args: any, _opts: any, cb: any) => {
        cb(new Error('op: item not found'), '', '');
        return {} as any;
      },
    );

    await handleCredentialFill(
      {
        type: 'fill_credentials',
        requestId: 'req-op-fail',
        itemRef: 'op://Vault/Missing',
        fields: [{ selector: '#user', field: 'username' }],
      },
      'main-group',
      true,
      DATA_DIR,
    );

    const resultFile = path.join(
      DATA_DIR,
      'ipc',
      'main-group',
      'cred_results',
      'req-op-fail.json',
    );
    const result = JSON.parse(fs.readFileSync(resultFile, 'utf-8'));
    expect(result.success).toBe(false);
    expect(result.message).toContain('op: item not found');

    delete process.env.BROWSER_CDP_URL;
  });

  it('handles CDP connection failures gracefully', async () => {
    process.env.BROWSER_CDP_URL = 'http://localhost:9222';

    const mockExecFile = vi.mocked(execFile);
    mockExecFile.mockImplementation(
      (_cmd: any, _args: any, _opts: any, cb: any) => {
        cb(null, 'value\n', '');
        return {} as any;
      },
    );

    vi.mocked(puppeteer.connect).mockRejectedValue(
      new Error('Failed to connect to browser'),
    );

    await handleCredentialFill(
      {
        type: 'fill_credentials',
        requestId: 'req-cdp-fail',
        itemRef: 'op://Vault/Item',
        fields: [{ selector: '#user', field: 'username' }],
      },
      'main-group',
      true,
      DATA_DIR,
    );

    const resultFile = path.join(
      DATA_DIR,
      'ipc',
      'main-group',
      'cred_results',
      'req-cdp-fail.json',
    );
    const result = JSON.parse(fs.readFileSync(resultFile, 'utf-8'));
    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to connect');

    delete process.env.BROWSER_CDP_URL;
  });
});
