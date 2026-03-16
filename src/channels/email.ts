import { logger } from '../logger.js';

const AGENTMAIL_BASE = 'https://api.agentmail.to/v0';
const FETCH_TIMEOUT_MS = 30_000;
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
    `${AGENTMAIL_BASE}/inboxes/${inboxId}` +
    `/messages?labels=unread`;

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
  const url =
    `${AGENTMAIL_BASE}/inboxes/${inboxId}` +
    `/messages/${messageId}`;

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
  const url =
    `${AGENTMAIL_BASE}/inboxes/${inboxId}` +
    `/messages/${messageId}`;

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
    `${AGENTMAIL_BASE}/inboxes/${inboxId}` +
    `/messages/${messageId}/reply`;

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
