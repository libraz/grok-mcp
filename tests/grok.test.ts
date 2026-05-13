import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config.js';

const responsesCreate = vi.fn();
const imagesGenerate = vi.fn();
const modelsList = vi.fn();

vi.mock('openai', () => {
  function MockOpenAI(this: unknown) {
    Object.assign(this as object, {
      responses: { create: responsesCreate },
      images: { generate: imagesGenerate },
      models: { list: modelsList },
    });
  }
  return { default: MockOpenAI };
});

const { createGrokClient } = await import('../src/grok.js');

const config: Config = {
  apiKey: 'xai-test',
  baseUrl: 'https://api.example/v1',
  defaultModel: 'grok-4.3',
  timeoutMs: 60_000,
  maxImageBytes: 20 * 1024 * 1024,
  maxVideoBytes: 50 * 1024 * 1024,
};

const originalFetch = globalThis.fetch;
const fetchMock = vi.fn();

beforeEach(() => {
  responsesCreate.mockReset();
  imagesGenerate.mockReset();
  modelsList.mockReset();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const makeResp = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('grok.ask', () => {
  it('sends a text prompt via the Responses API and returns output_text', async () => {
    responsesCreate.mockResolvedValue({ output_text: 'pong' });
    const client = createGrokClient(config);

    const out = await client.ask({ prompt: 'ping' });

    expect(out).toBe('pong');
    expect(responsesCreate).toHaveBeenCalledTimes(1);
    const call = responsesCreate.mock.calls[0]?.[0] as {
      model: string;
      input: { role: string; content: { type: string; text?: string }[] }[];
    };
    expect(call.model).toBe('grok-4.3');
    expect(call.input[0]?.role).toBe('user');
    expect(call.input[0]?.content?.[0]).toEqual({ type: 'input_text', text: 'ping' });
  });

  it('honors model override and system prompt', async () => {
    responsesCreate.mockResolvedValue({ output_text: 'ok' });
    const client = createGrokClient(config);

    await client.ask({
      prompt: 'p',
      model: 'grok-4-1-fast-non-reasoning',
      system: 'you are helpful',
    });

    const call = responsesCreate.mock.calls[0]?.[0] as {
      model: string;
      input: { role: string }[];
    };
    expect(call.model).toBe('grok-4-1-fast-non-reasoning');
    expect(call.input[0]?.role).toBe('system');
    expect(call.input[1]?.role).toBe('user');
  });

  it('reconstructs output from message chunks when output_text is missing', async () => {
    responsesCreate.mockResolvedValue({
      output: [
        {
          type: 'message',
          content: [
            { type: 'output_text', text: 'hello ' },
            { type: 'output_text', text: 'world' },
          ],
        },
      ],
    });
    const client = createGrokClient(config);

    const out = await client.ask({ prompt: 'p' });

    expect(out).toBe('hello \nworld');
  });

  it('adds x_search tool when search="x"', async () => {
    responsesCreate.mockResolvedValue({ output_text: 'ok' });
    const client = createGrokClient(config);

    await client.ask({ prompt: 'p', search: 'x' });

    const call = responsesCreate.mock.calls[0]?.[0] as { tools?: { type: string }[] };
    expect(call.tools).toEqual([{ type: 'x_search' }]);
  });

  it('adds both x_search and web_search when search=true', async () => {
    responsesCreate.mockResolvedValue({ output_text: 'ok' });
    const client = createGrokClient(config);

    await client.ask({ prompt: 'p', search: true });

    const call = responsesCreate.mock.calls[0]?.[0] as { tools?: { type: string }[] };
    expect(call.tools).toEqual([{ type: 'x_search' }, { type: 'web_search' }]);
  });

  it('attaches image content parts as input_image', async () => {
    responsesCreate.mockResolvedValue({ output_text: 'ok' });
    const client = createGrokClient(config);

    await client.ask({ prompt: 'p', images: ['https://example.com/c.png'] });

    const call = responsesCreate.mock.calls[0]?.[0] as {
      input: { content: { type: string; image_url?: string }[] }[];
    };
    const userContent = call.input[0]?.content ?? [];
    expect(userContent[0]).toEqual({ type: 'input_image', image_url: 'https://example.com/c.png' });
  });

  it('formats API errors with status', async () => {
    responsesCreate.mockRejectedValue({ status: 401, message: 'Unauthorized' });
    const client = createGrokClient(config);

    await expect(client.ask({ prompt: 'p' })).rejects.toThrow(/xAI API error: 401 Unauthorized/);
  });
});

describe('grok.listModels', () => {
  it('returns sorted model IDs', async () => {
    const items = [{ id: 'grok-4.3' }, { id: 'grok-4-1-fast' }];
    modelsList.mockResolvedValue({
      [Symbol.asyncIterator]: () => {
        let i = 0;
        return {
          next: () =>
            Promise.resolve(
              i < items.length
                ? { value: items[i++], done: false }
                : { value: undefined, done: true },
            ),
        };
      },
    });

    const client = createGrokClient(config);
    const out = await client.listModels();

    expect(out.split('\n')).toEqual(['grok-4-1-fast', 'grok-4.3']);
  });

  it('returns a placeholder when no models come back', async () => {
    modelsList.mockResolvedValue({
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.resolve({ value: undefined, done: true }),
      }),
    });

    const client = createGrokClient(config);
    expect(await client.listModels()).toBe('(no models returned)');
  });
});

describe('grok.generateImage', () => {
  it('calls images.generate when no source_images provided', async () => {
    imagesGenerate.mockResolvedValue({ data: [{ url: 'https://x.ai/img1.png' }] });
    const client = createGrokClient(config);

    const urls = await client.generateImage({ prompt: 'a cat', n: 2, aspect_ratio: '1:1' });

    expect(urls).toEqual(['https://x.ai/img1.png']);
    const args = imagesGenerate.mock.calls[0]?.[0] as {
      model: string;
      prompt: string;
      n?: number;
      aspect_ratio?: string;
    };
    expect(args.model).toBe('grok-imagine-image-quality');
    expect(args.prompt).toBe('a cat');
    expect(args.n).toBe(2);
    expect(args.aspect_ratio).toBe('1:1');
  });

  it('uses the edits endpoint when source_images is provided', async () => {
    fetchMock.mockResolvedValue(makeResp(200, { data: [{ url: 'https://x.ai/edit.png' }] }));
    const client = createGrokClient(config);

    const urls = await client.generateImage({
      prompt: 'tweak',
      source_images: ['https://example.com/in.png'],
    });

    expect(urls).toEqual(['https://x.ai/edit.png']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.example/v1/images/edits');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse((init as RequestInit).body as string) as {
      images: string[];
      prompt: string;
    };
    expect(body.images).toEqual(['https://example.com/in.png']);
    expect(body.prompt).toBe('tweak');
  });
});

describe('grok.generateVideo', () => {
  it('returns immediately when wait=false', async () => {
    fetchMock.mockResolvedValueOnce(makeResp(200, { request_id: 'req-1' }));
    const client = createGrokClient(config);

    const r = await client.generateVideo({ prompt: 'cinematic city', wait: false });

    expect(r.request_id).toBe('req-1');
    expect(r.status).toBe('pending');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('polls until the video is done', async () => {
    vi.useFakeTimers();
    try {
      fetchMock
        .mockResolvedValueOnce(makeResp(200, { request_id: 'req-2' }))
        .mockResolvedValueOnce(makeResp(200, { status: 'pending' }))
        .mockResolvedValueOnce(
          makeResp(200, {
            status: 'done',
            video: { url: 'https://vidgen.x.ai/v.mp4', duration: 6 },
          }),
        );

      const client = createGrokClient({ ...config, timeoutMs: 60_000 });
      const promise = client.generateVideo({ prompt: 'a dog' });

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(2);
      });
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.advanceTimersByTimeAsync(5_000);

      const r = await promise;
      expect(r.status).toBe('done');
      expect(r.videoUrl).toBe('https://vidgen.x.ai/v.mp4');
      expect(r.duration).toBe(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces failures', async () => {
    fetchMock.mockResolvedValueOnce(makeResp(400, { error: { message: 'Invalid prompt' } }));
    const client = createGrokClient(config);

    await expect(client.generateVideo({ prompt: '' })).rejects.toThrow(
      /xAI API error: 400 Invalid prompt/,
    );
  });
});

describe('grok.getVideoStatus', () => {
  it('parses the polling response', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResp(200, {
        status: 'done',
        video: { url: 'https://vidgen.x.ai/v.mp4', duration: 8 },
      }),
    );
    const client = createGrokClient(config);

    const r = await client.getVideoStatus({ request_id: 'req-x' });

    expect(r.status).toBe('done');
    expect(r.videoUrl).toBe('https://vidgen.x.ai/v.mp4');
    expect(r.duration).toBe(8);
    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.example/v1/videos/req-x');
  });
});
