import './chrome-mock';
import {
  sendTelegram,
  sendDiscord,
  sendNotification,
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationSettings,
} from '../background/notifier';
import { formatQueueCompleteMessage, formatTaskErrorMessage } from '../background/notifier';

// Global fetch mock
const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

beforeEach(() => {
  fetchMock.mockReset();
});

describe('sendTelegram', () => {
  it('calls the correct Telegram API URL with proper payload', async () => {
    fetchMock.mockResolvedValue({ ok: true });

    await sendTelegram('BOT_TOKEN_123', '999', 'Hello');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/botBOT_TOKEN_123/sendMessage');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(opts.body);
    expect(body.chat_id).toBe('999');
    expect(body.text).toBe('Hello');
    expect(body.parse_mode).toBe('HTML');
  });

  it('throws on non-ok response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Bad Request'),
    });

    await expect(sendTelegram('tok', 'cid', 'msg')).rejects.toThrow(
      'Telegram API error 400: Bad Request',
    );
  });
});

describe('sendDiscord', () => {
  it('calls the webhook URL with proper payload', async () => {
    fetchMock.mockResolvedValue({ ok: true });

    const webhookUrl = 'https://discord.com/api/webhooks/123/abc';
    await sendDiscord(webhookUrl, 'Test message');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(webhookUrl);
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(opts.body);
    expect(body.content).toBe('Test message');
  });

  it('throws on non-ok response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve('Rate limited'),
    });

    await expect(
      sendDiscord('https://discord.com/api/webhooks/x/y', 'msg'),
    ).rejects.toThrow('Discord webhook error 429: Rate limited');
  });
});

describe('sendNotification', () => {
  it('does nothing when provider is none', async () => {
    await sendNotification(DEFAULT_NOTIFICATION_SETTINGS, 'test');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('routes to Telegram when provider is telegram', async () => {
    fetchMock.mockResolvedValue({ ok: true });

    const settings: NotificationSettings = {
      provider: 'telegram',
      telegramBotToken: 'tok123',
      telegramChatId: 'chat456',
      notifyOnComplete: true,
      notifyOnError: true,
    };
    await sendNotification(settings, 'hello');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('api.telegram.org');
  });

  it('routes to Discord when provider is discord', async () => {
    fetchMock.mockResolvedValue({ ok: true });

    const settings: NotificationSettings = {
      provider: 'discord',
      discordWebhookUrl: 'https://discord.com/api/webhooks/1/abc',
      notifyOnComplete: true,
      notifyOnError: true,
    };
    await sendNotification(settings, 'hello');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('discord.com');
  });

  it('skips Telegram when token is missing', async () => {
    const settings: NotificationSettings = {
      provider: 'telegram',
      telegramChatId: 'chat456',
      notifyOnComplete: true,
      notifyOnError: true,
    };
    await sendNotification(settings, 'hello');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips Telegram when chatId is missing', async () => {
    const settings: NotificationSettings = {
      provider: 'telegram',
      telegramBotToken: 'tok123',
      notifyOnComplete: true,
      notifyOnError: true,
    };
    await sendNotification(settings, 'hello');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips Discord when webhookUrl is missing', async () => {
    const settings: NotificationSettings = {
      provider: 'discord',
      notifyOnComplete: true,
      notifyOnError: true,
    };
    await sendNotification(settings, 'hello');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('formatQueueCompleteMessage', () => {
  it('formats queue completion message', () => {
    const msg = formatQueueCompleteMessage('MyProject', 5, 2, 120_000);
    expect(msg).toContain('MyProject');
    expect(msg).toContain('5');
    expect(msg).toContain('2');
    expect(msg).toContain('2m 0s');
  });

  it('formats elapsed time in seconds when under a minute', () => {
    const msg = formatQueueCompleteMessage('P', 1, 0, 45_000);
    expect(msg).toContain('45s');
  });

  it('uses fallback project name when empty', () => {
    const msg = formatQueueCompleteMessage('', 1, 0, 1000);
    expect(msg).toContain('未命名项目');
  });
});

describe('formatTaskErrorMessage', () => {
  it('formats error notification with truncation', () => {
    const longPrompt = 'A'.repeat(80);
    const longError = 'E'.repeat(150);
    const msg = formatTaskErrorMessage(longPrompt, longError);

    // Prompt truncated to 50 chars
    expect(msg).toContain('A'.repeat(47) + '...');
    // Error truncated to 100 chars
    expect(msg).toContain('E'.repeat(97) + '...');
  });

  it('does not truncate short strings', () => {
    const msg = formatTaskErrorMessage('short prompt', 'short error');
    expect(msg).toContain('short prompt');
    expect(msg).toContain('short error');
  });
});
