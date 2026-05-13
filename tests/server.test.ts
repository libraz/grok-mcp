import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config.js';

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};
type ToolCallback = (args: Record<string, unknown>) => Promise<ToolResult>;

const fakeClient = {
  ask: vi.fn(),
  listModels: vi.fn(),
  generateImage: vi.fn(),
  generateVideo: vi.fn(),
  getVideoStatus: vi.fn(),
};

vi.mock('../src/grok.js', () => ({
  createGrokClient: vi.fn(() => fakeClient),
}));

const { createServer } = await import('../src/server.js');

const config: Config = {
  apiKey: 'xai-test',
  baseUrl: 'https://api.example/v1',
  defaultModel: 'grok-4.3',
  timeoutMs: 60_000,
  maxImageBytes: 20 * 1024 * 1024,
  maxVideoBytes: 50 * 1024 * 1024,
};

const buildTools = (): Map<string, ToolCallback> => {
  const tools = new Map<string, ToolCallback>();
  const server = createServer(config);
  const registry = (
    server as unknown as {
      _registeredTools: Record<
        string,
        { handler: (args: Record<string, unknown>, extra: unknown) => Promise<ToolResult> }
      >;
    }
  )._registeredTools;
  for (const [name, def] of Object.entries(registry)) {
    tools.set(name, (args) => def.handler(args, {}));
  }
  return tools;
};

beforeEach(() => {
  for (const m of Object.values(fakeClient)) {
    m.mockReset();
  }
});

describe('createServer', () => {
  it('registers all six tools', () => {
    const tools = buildTools();
    expect([...tools.keys()].sort()).toEqual([
      'grok_ask',
      'grok_estimate_cost',
      'grok_imagine_image',
      'grok_imagine_video',
      'grok_imagine_video_status',
      'grok_list_models',
    ]);
  });
});

describe('grok_ask tool', () => {
  it('forwards args to grok.ask and returns text content', async () => {
    fakeClient.ask.mockResolvedValue('hello');
    const cb = buildTools().get('grok_ask');
    if (!cb) {
      throw new Error('missing tool');
    }

    const r = await cb({ prompt: 'hi' });

    expect(fakeClient.ask).toHaveBeenCalledWith({ prompt: 'hi' });
    expect(r.content[0]?.text).toBe('hello');
    expect(r.isError).toBeUndefined();
  });

  it('returns isError when grok.ask throws', async () => {
    fakeClient.ask.mockRejectedValue(new Error('boom'));
    const cb = buildTools().get('grok_ask');
    if (!cb) {
      throw new Error('missing tool');
    }

    const r = await cb({ prompt: 'hi' });

    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toBe('boom');
  });

  it('renders a placeholder when response is empty', async () => {
    fakeClient.ask.mockResolvedValue('');
    const cb = buildTools().get('grok_ask');
    if (!cb) {
      throw new Error('missing tool');
    }

    const r = await cb({ prompt: 'hi' });

    expect(r.content[0]?.text).toBe('(empty response)');
  });
});

describe('grok_list_models tool', () => {
  it('returns the model list as-is', async () => {
    fakeClient.listModels.mockResolvedValue('grok-4.3\ngrok-4-1-fast');
    const cb = buildTools().get('grok_list_models');
    if (!cb) {
      throw new Error('missing tool');
    }

    const r = await cb({});

    expect(r.content[0]?.text).toBe('grok-4.3\ngrok-4-1-fast');
  });
});

describe('grok_imagine_image tool', () => {
  it('formats returned URLs newline-separated', async () => {
    fakeClient.generateImage.mockResolvedValue([
      'https://a.example/1.png',
      'https://a.example/2.png',
    ]);
    const cb = buildTools().get('grok_imagine_image');
    if (!cb) {
      throw new Error('missing tool');
    }

    const r = await cb({ prompt: 'cat' });

    expect(r.content[0]?.text).toBe('https://a.example/1.png\nhttps://a.example/2.png');
  });

  it('reports an error when no images are returned', async () => {
    fakeClient.generateImage.mockResolvedValue([]);
    const cb = buildTools().get('grok_imagine_image');
    if (!cb) {
      throw new Error('missing tool');
    }

    const r = await cb({ prompt: 'cat' });

    expect(r.isError).toBe(true);
  });
});

describe('grok_imagine_video tool', () => {
  it('renders request_id, status, and url when done', async () => {
    fakeClient.generateVideo.mockResolvedValue({
      request_id: 'req-1',
      status: 'done',
      videoUrl: 'https://vidgen.x.ai/v.mp4',
      duration: 6,
      raw: {},
    });
    const cb = buildTools().get('grok_imagine_video');
    if (!cb) {
      throw new Error('missing tool');
    }

    const r = await cb({ prompt: 'a dog' });

    expect(r.content[0]?.text).toContain('request_id: req-1');
    expect(r.content[0]?.text).toContain('status: done');
    expect(r.content[0]?.text).toContain('video_url: https://vidgen.x.ai/v.mp4');
    expect(r.content[0]?.text).toContain('duration: 6s');
  });

  it('renders pending status without url', async () => {
    fakeClient.generateVideo.mockResolvedValue({
      request_id: 'req-2',
      status: 'pending',
      raw: {},
    });
    const cb = buildTools().get('grok_imagine_video');
    if (!cb) {
      throw new Error('missing tool');
    }

    const r = await cb({ prompt: 'wait', wait: false });

    expect(r.content[0]?.text).toContain('status: pending');
    expect(r.content[0]?.text).not.toContain('video_url');
  });
});

describe('grok_imagine_video_status tool', () => {
  it('delegates to getVideoStatus', async () => {
    fakeClient.getVideoStatus.mockResolvedValue({
      request_id: 'req-3',
      status: 'pending',
      raw: {},
    });
    const cb = buildTools().get('grok_imagine_video_status');
    if (!cb) {
      throw new Error('missing tool');
    }

    const r = await cb({ request_id: 'req-3' });

    expect(fakeClient.getVideoStatus).toHaveBeenCalledWith({ request_id: 'req-3' });
    expect(r.content[0]?.text).toContain('status: pending');
  });
});

describe('grok_estimate_cost tool', () => {
  it('returns a cost breakdown for a known model', async () => {
    const cb = buildTools().get('grok_estimate_cost');
    if (!cb) {
      throw new Error('missing tool');
    }

    const r = await cb({ model: 'grok-4.3', input_tokens: 1_000_000, output_tokens: 0 });

    expect(r.isError).toBeUndefined();
    expect(r.content[0]?.text).toContain('model: grok-4.3');
    expect(r.content[0]?.text).toContain('estimated cost: $1.25');
    expect(r.content[0]?.text).toContain('breakdown:');
  });

  it('flags unknown models without throwing', async () => {
    const cb = buildTools().get('grok_estimate_cost');
    if (!cb) {
      throw new Error('missing tool');
    }

    const r = await cb({ model: 'grok-bogus' });

    expect(r.isError).toBeUndefined();
    expect(r.content[0]?.text).toContain('pricing known: no');
  });
});
