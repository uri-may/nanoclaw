import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

import puppeteer from 'puppeteer-core';

import { logger } from './logger.js';

interface CredentialFillResult {
  success: boolean;
  message: string;
}

interface FieldMapping {
  selector: string;
  field: string;
}

function writeResult(
  dataDir: string,
  sourceGroup: string,
  requestId: string,
  result: CredentialFillResult,
): void {
  const resultsDir = path.join(
    dataDir,
    'ipc',
    sourceGroup,
    'cred_results',
  );
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(
    path.join(resultsDir, `${requestId}.json`),
    JSON.stringify(result),
  );
}

function opRead(itemRef: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'op',
      ['read', itemRef],
      { env: { ...process.env }, timeout: 10000 },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

export async function handleCredentialFill(
  data: Record<string, unknown>,
  sourceGroup: string,
  isMain: boolean,
  dataDir: string,
): Promise<boolean> {
  const type = data.type as string;
  if (type !== 'fill_credentials') return false;

  if (!isMain) {
    logger.warn({ sourceGroup }, 'fill_credentials blocked: not main');
    return true;
  }

  const requestId = data.requestId as string;
  if (!requestId) {
    logger.warn('fill_credentials: missing requestId');
    return true;
  }

  const itemRef = data.itemRef as string;
  const fields = data.fields as FieldMapping[] | undefined;
  const cdpUrl = process.env.BROWSER_CDP_URL;

  if (!itemRef || !fields?.length || !cdpUrl) {
    writeResult(dataDir, sourceGroup, requestId, {
      success: false,
      message: 'Missing itemRef, fields, or BROWSER_CDP_URL',
    });
    return true;
  }

  try {
    // Fetch each field value from 1Password
    const values: Record<string, string> = {};
    for (const f of fields) {
      values[f.selector] = await opRead(`${itemRef}/${f.field}`);
    }

    // Connect to browser and fill fields
    const browser = await puppeteer.connect({ browserURL: cdpUrl });
    const pages = await browser.pages();
    const page = pages[0];

    for (const [selector, value] of Object.entries(values)) {
      await page.waitForSelector(selector, { timeout: 5000 });
      await page.click(selector);
      await page.type(selector, value, { delay: 50 });
    }

    browser.disconnect();

    writeResult(dataDir, sourceGroup, requestId, {
      success: true,
      message: `Filled ${fields.length} field(s)`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, requestId }, 'fill_credentials failed');
    writeResult(dataDir, sourceGroup, requestId, {
      success: false,
      message: msg,
    });
  }

  return true;
}
