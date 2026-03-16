import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  fetchUnreadMessages,
  fetchMessageBody,
  markMessageRead,
  replyToMessage,
} from './email.js';

describe('email channel — AgentMail API helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchUnreadMessages', () => {
    it('returns messages from list endpoint filtered by unread label', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              messages: [
                {
                  message_id: 'msg-1',
                  thread_id: 'thread-1',
                  from: 'uri@example.com',
                  subject: 'Hello',
                  preview: 'Test message',
                  timestamp: '2026-03-13T10:00:00Z',
                  labels: ['unread'],
                },
              ],
              count: 1,
            }),
        }),
      );

      const messages = await fetchUnreadMessages(
        'am_test',
        'wags@agentmail.to',
      );
      expect(messages).toHaveLength(1);
      expect(messages[0].message_id).toBe('msg-1');
    });

    it('returns empty array on API error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Internal Server Error'),
        }),
      );

      const messages = await fetchUnreadMessages(
        'am_test',
        'wags@agentmail.to',
      );
      expect(messages).toEqual([]);
    });
  });

  describe('fetchMessageBody', () => {
    it('returns text body from message detail', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              message_id: 'msg-1',
              thread_id: 'thread-1',
              from: 'uri@example.com',
              text: 'Full message body here',
              subject: 'Hello',
              timestamp: '2026-03-13T10:00:00Z',
            }),
        }),
      );

      const detail = await fetchMessageBody(
        'am_test',
        'wags@agentmail.to',
        'msg-1',
      );
      expect(detail?.text).toBe('Full message body here');
    });
  });

  describe('markMessageRead', () => {
    it('calls PATCH with correct labels', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });
      vi.stubGlobal('fetch', fetchMock);

      await markMessageRead('am_test', 'wags@agentmail.to', 'msg-1');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.agentmail.to/v0/inboxes/wags@agentmail.to/messages/msg-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            add_labels: ['read'],
            remove_labels: ['unread'],
          }),
        }),
      );
    });
  });

  describe('replyToMessage', () => {
    it('sends reply with signature appended', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ message_id: 'reply-1', thread_id: 'thread-1' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await replyToMessage(
        'am_test',
        'wags@agentmail.to',
        'msg-1',
        'Here is my response',
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.agentmail.to/v0/inboxes/wags@agentmail.to/messages/msg-1/reply',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            text: "Here is my response\n\n— Wags, Uri's Personal Assistant",
          }),
        }),
      );
    });
  });
});

describe('email channel — channel adapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when AGENTMAIL_API_KEY is missing', async () => {
    const { _createEmailChannelForTesting } = await import('./email.js');

    const channel = _createEmailChannelForTesting(
      {
        onMessage: vi.fn(),
        onChatMetadata: vi.fn(),
        registeredGroups: () => ({}),
      },
      '', // empty API key
      'wags@agentmail.to',
      'uri@example.com',
    );

    expect(channel).toBeNull();
  });

  it('creates a channel with name "email"', async () => {
    const { _createEmailChannelForTesting } = await import('./email.js');

    const channel = _createEmailChannelForTesting(
      {
        onMessage: vi.fn(),
        onChatMetadata: vi.fn(),
        registeredGroups: () => ({}),
      },
      'am_test',
      'wags@agentmail.to',
      'uri@example.com',
    );

    expect(channel).not.toBeNull();
    expect(channel!.name).toBe('email');
  });

  it('ownsJid returns true for email: prefixed JIDs', async () => {
    const { _createEmailChannelForTesting } = await import('./email.js');

    const channel = _createEmailChannelForTesting(
      {
        onMessage: vi.fn(),
        onChatMetadata: vi.fn(),
        registeredGroups: () => ({}),
      },
      'am_test',
      'wags@agentmail.to',
      'uri@example.com',
    );

    expect(channel!.ownsJid('email:thread-123')).toBe(true);
    expect(channel!.ownsJid('whatsapp:12345')).toBe(false);
  });

  it('poll drops messages from non-owner and marks them read', async () => {
    const { _createEmailChannelForTesting } = await import('./email.js');

    const onMessage = vi.fn();
    const fetchMock = vi.fn()
      // fetchUnreadMessages call
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            messages: [
              {
                message_id: 'msg-1',
                thread_id: 'thread-1',
                from: 'stranger@evil.com',
                subject: 'Hello',
                preview: 'Spam',
                timestamp: '2026-03-13T10:00:00Z',
                labels: ['unread'],
              },
            ],
            count: 1,
          }),
      })
      // markMessageRead call (for the dropped message)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);

    const channel = _createEmailChannelForTesting(
      {
        onMessage,
        onChatMetadata: vi.fn(),
        registeredGroups: () => ({}),
      },
      'am_test',
      'wags@agentmail.to',
      'uri@example.com',
    );

    // connect() triggers initial poll
    await channel!.connect();

    // onMessage should NOT have been called (message was dropped)
    expect(onMessage).not.toHaveBeenCalled();
    // But markMessageRead should have been called
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/messages/msg-1'),
      expect.objectContaining({ method: 'PATCH' }),
    );

    await channel!.disconnect();
  });

  it('poll delivers messages from owner (case-insensitive)', async () => {
    const { _createEmailChannelForTesting } = await import('./email.js');

    const onMessage = vi.fn();
    const fetchMock = vi.fn()
      // fetchUnreadMessages
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            messages: [
              {
                message_id: 'msg-1',
                thread_id: 'thread-1',
                from: 'Uri@Example.COM',
                subject: 'Task',
                preview: 'Do this',
                timestamp: '2026-03-13T10:00:00Z',
                labels: ['unread'],
              },
            ],
            count: 1,
          }),
      })
      // fetchMessageBody
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            message_id: 'msg-1',
            thread_id: 'thread-1',
            from: 'Uri@Example.COM',
            text: 'Full body here',
            subject: 'Task',
            timestamp: '2026-03-13T10:00:00Z',
          }),
      })
      // markMessageRead
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);

    const channel = _createEmailChannelForTesting(
      {
        onMessage,
        onChatMetadata: vi.fn(),
        registeredGroups: () => ({}),
      },
      'am_test',
      'wags@agentmail.to',
      'uri@example.com',
    );

    await channel!.connect();

    // onMessage SHOULD have been called with the owner's message
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(
      expect.stringContaining('email:'),
      expect.objectContaining({
        sender: 'Uri@Example.COM',
        content: expect.stringContaining('Full body here'),
      }),
    );

    await channel!.disconnect();
  });

  it('sendMessage calls replyToMessage with message ID extracted from JID', async () => {
    const { _createEmailChannelForTesting } = await import('./email.js');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ message_id: 'reply-1', thread_id: 'thread-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const channel = _createEmailChannelForTesting(
      {
        onMessage: vi.fn(),
        onChatMetadata: vi.fn(),
        registeredGroups: () => ({}),
      },
      'am_test',
      'wags@agentmail.to',
      'uri@example.com',
    );

    // JID format: email:<thread_id>:<last_message_id>
    await channel!.sendMessage(
      'email:thread-1:msg-1',
      'Response text',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/messages/msg-1/reply'),
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
