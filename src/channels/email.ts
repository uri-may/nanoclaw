import { logger } from '../logger.js';
import { registerChannel } from './registry.js';
import { readEnvFile } from '../env.js';
import { setRegisteredGroup } from '../db.js';
import { resolveGroupFolderPath } from '../group-folder.js';
import type { Channel, NewMessage } from '../types.js';
import type { ChannelOpts } from './registry.js';
import fs from 'fs';
import path from 'path';

const AGENTMAIL_BASE = 'https://api.agentmail.to/v0';
const FETCH_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 120_000;
const SIGNATURE = "\n\n— Wags, Uri's Personal Assistant";

export interface AgentMailMessage {
  message_id: string;
  thread_id: string;
  from: string;
  to?: string[];
  subject?: string;
  preview?: string;
  text?: string;
  timestamp: string;
  labels?: string[];
}

function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

export async function fetchUnreadMessages(
  apiKey: string,
  inboxId: string,
): Promise<AgentMailMessage[]> {
  const url =
    `${AGENTMAIL_BASE}/inboxes/${inboxId}` + `/messages?labels=unread`;

  try {
    const res = await fetch(url, {
      headers: headers(apiKey),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text();
      logger.warn(
        { status: res.status, body: body.slice(0, 200) },
        'AgentMail list-unread failed',
      );
      return [];
    }
    const data = (await res.json()) as {
      messages: AgentMailMessage[];
    };
    return data.messages ?? [];
  } catch (err) {
    logger.error({ err }, 'AgentMail list-unread error');
    return [];
  }
}

export async function fetchMessageBody(
  apiKey: string,
  inboxId: string,
  messageId: string,
): Promise<AgentMailMessage | null> {
  const url = `${AGENTMAIL_BASE}/inboxes/${inboxId}` + `/messages/${messageId}`;

  try {
    const res = await fetch(url, {
      headers: headers(apiKey),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn(
        { status: res.status, messageId },
        'AgentMail get-message failed',
      );
      return null;
    }
    return (await res.json()) as AgentMailMessage;
  } catch (err) {
    logger.error({ err, messageId }, 'AgentMail get-message error');
    return null;
  }
}

export async function markMessageRead(
  apiKey: string,
  inboxId: string,
  messageId: string,
): Promise<void> {
  const url = `${AGENTMAIL_BASE}/inboxes/${inboxId}` + `/messages/${messageId}`;

  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: headers(apiKey),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      body: JSON.stringify({
        add_labels: ['read'],
        remove_labels: ['unread'],
      }),
    });
    if (!res.ok) {
      logger.warn(
        { status: res.status, messageId },
        'AgentMail mark-read failed',
      );
    }
  } catch (err) {
    logger.error({ err, messageId }, 'AgentMail mark-read error');
  }
}

export async function replyToMessage(
  apiKey: string,
  inboxId: string,
  messageId: string,
  text: string,
): Promise<void> {
  const url =
    `${AGENTMAIL_BASE}/inboxes/${inboxId}` + `/messages/${messageId}/reply`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: headers(apiKey),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      body: JSON.stringify({ text: text + SIGNATURE }),
    });
    if (!res.ok) {
      const body = await res.text();
      logger.error(
        { status: res.status, body: body.slice(0, 200), messageId },
        'AgentMail reply failed',
      );
    }
  } catch (err) {
    logger.error({ err, messageId }, 'AgentMail reply error');
  }
}

const EMAIL_GROUP_FOLDER = 'email_main';

// --- Channel factory ---

function createEmailChannel(
  opts: ChannelOpts,
  apiKey: string,
  inboxId: string,
  ownerEmail: string,
): Channel | null {
  if (!apiKey || !inboxId || !ownerEmail) return null;

  const jid = `email:${inboxId}`;
  let lastMessageId: string | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let connected = false;

  let polling = false;

  async function poll(): Promise<void> {
    if (polling) {
      logger.debug('Poll already in progress, skipping');
      return;
    }
    polling = true;
    try {
      const messages = await fetchUnreadMessages(apiKey, inboxId);

      for (const msg of messages) {
        const rawFrom = msg.from ?? '';
        const emailMatch = rawFrom.match(/<([^>]+)>/);
        const sender = (emailMatch ? emailMatch[1] : rawFrom)
          .toLowerCase()
          .trim();
        if (sender !== ownerEmail.toLowerCase()) {
          logger.debug(
            { from: msg.from, ownerEmail },
            'Email from non-owner, dropping',
          );
          await markMessageRead(apiKey, inboxId, msg.message_id);
          continue;
        }

        const detail = await fetchMessageBody(apiKey, inboxId, msg.message_id);
        const body = detail?.text ?? msg.preview ?? '';
        const subject = detail?.subject ?? msg.subject ?? '';
        const content = subject ? `Subject: ${subject}\n\n${body}` : body;

        lastMessageId = msg.message_id;

        opts.onChatMetadata(
          jid,
          msg.timestamp,
          `Email: ${subject || msg.from}`,
          'email',
          false,
        );

        const newMsg: NewMessage = {
          id: msg.message_id,
          chat_jid: jid,
          sender: msg.from,
          sender_name: msg.from,
          content,
          timestamp: msg.timestamp,
        };
        opts.onMessage(jid, newMsg);

        await markMessageRead(apiKey, inboxId, msg.message_id);
      }
    } finally {
      polling = false;
    }
  }

  const channel: Channel = {
    name: 'email',

    async connect(): Promise<void> {
      logger.info('Email channel connecting');

      const existing = opts.registeredGroups();
      if (!existing[jid]) {
        const group = {
          name: 'Email',
          folder: EMAIL_GROUP_FOLDER,
          trigger: '@Wags',
          added_at: new Date().toISOString(),
          requiresTrigger: false,
        };
        setRegisteredGroup(jid, group);
        const groupDir = resolveGroupFolderPath(group.folder);
        fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });
        logger.info({ jid }, 'Auto-registered email group');
      }

      await poll();
      pollTimer = setInterval(() => {
        poll().catch((err) => logger.error({ err }, 'Email poll error'));
      }, POLL_INTERVAL_MS);
      connected = true;
      logger.info('Email channel connected');
    },

    async sendMessage(_jid: string, text: string): Promise<void> {
      if (!lastMessageId) {
        logger.error({ jid }, 'No message to reply to');
        return;
      }
      await replyToMessage(apiKey, inboxId, lastMessageId, text);
    },

    isConnected(): boolean {
      return connected;
    },

    ownsJid(jid: string): boolean {
      return jid.startsWith('email:');
    },

    async disconnect(): Promise<void> {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      connected = false;
      logger.info('Email channel disconnected');
    },
  };

  return channel;
}

// Exposed for testing only
export function _createEmailChannelForTesting(
  opts: ChannelOpts,
  apiKey: string,
  inboxId: string,
  ownerEmail: string,
): Channel | null {
  return createEmailChannel(opts, apiKey, inboxId, ownerEmail);
}

// Self-register with NanoClaw's channel registry
registerChannel('email', (opts) => {
  const env = readEnvFile([
    'AGENTMAIL_API_KEY',
    'AGENTMAIL_ADDRESS',
    'OWNER_EMAIL',
  ]);
  return createEmailChannel(
    opts,
    env.AGENTMAIL_API_KEY ?? '',
    env.AGENTMAIL_ADDRESS ?? '',
    env.OWNER_EMAIL ?? '',
  );
});
