import OpenAI from 'openai';
import type { Config } from './config.js';
import type { ResolvedMedia } from './media.js';
import { resolveAllMedia } from './media.js';
import type {
  GrokAskInput,
  GrokGenerateImageInput,
  GrokGenerateVideoInput,
  GrokVideoStatusInput,
} from './schema.js';

/**
 * Parsed status of a video generation request, normalized across the
 * `POST /videos/generations` and `GET /videos/{request_id}` responses.
 */
export type VideoStatusResult = {
  /** Server-issued request ID used to poll for completion. */
  request_id: string;
  /** Lifecycle state. The four documented values are kept open as `string` for forward compat. */
  status: 'pending' | 'done' | 'expired' | 'failed' | string;
  /** Signed URL of the finished video, when `status === 'done'`. */
  videoUrl?: string;
  /** Length of the finished video in seconds, when reported by the API. */
  duration?: number;
  /** The raw response body, retained so callers can inspect undocumented fields. */
  raw: unknown;
};

/** Thin facade over the xAI HTTP API used by the MCP tool handlers. */
export type GrokClient = {
  /** Send a text + optional image prompt and return the assembled output text. */
  ask: (input: GrokAskInput) => Promise<string>;
  /** Return a newline-joined sorted list of model IDs available to the API key. */
  listModels: () => Promise<string>;
  /** Generate or edit images. Returns the URLs of the produced assets. */
  generateImage: (input: GrokGenerateImageInput) => Promise<string[]>;
  /**
   * Kick off a video generation. With `wait` unset or `true` this polls until
   * completion or `XAI_TIMEOUT_MS`, returning a terminal {@link VideoStatusResult}.
   */
  generateVideo: (input: GrokGenerateVideoInput) => Promise<VideoStatusResult>;
  /** Poll a previously issued video generation by request ID. */
  getVideoStatus: (input: GrokVideoStatusInput) => Promise<VideoStatusResult>;
};

const DEFAULT_IMAGE_MODEL = 'grok-imagine-image-quality';
const DEFAULT_VIDEO_MODEL = 'grok-imagine-video';
const VIDEO_POLL_INTERVAL_MS = 5_000;

const buildResponsesInput = (
  prompt: string,
  system: string | undefined,
  images: ResolvedMedia[],
): unknown[] => {
  const messages: unknown[] = [];
  if (system) {
    messages.push({
      role: 'system',
      content: [{ type: 'input_text', text: system }],
    });
  }
  const content: unknown[] = [];
  for (const img of images) {
    content.push({ type: 'input_image', image_url: img.url });
  }
  content.push({ type: 'input_text', text: prompt });
  messages.push({ role: 'user', content });
  return messages;
};

const resolveSearchTools = (
  search: GrokAskInput['search'],
): { type: 'x_search' | 'web_search' }[] => {
  if (search === undefined || search === false) {
    return [];
  }
  if (search === 'x') {
    return [{ type: 'x_search' }];
  }
  if (search === 'web') {
    return [{ type: 'web_search' }];
  }
  return [{ type: 'x_search' }, { type: 'web_search' }];
};

const extractTextFromResponse = (resp: unknown): string => {
  const r = resp as { output_text?: string; output?: unknown[] };
  if (typeof r.output_text === 'string' && r.output_text.length > 0) {
    return r.output_text;
  }
  if (!Array.isArray(r.output)) {
    return '';
  }
  const chunks: string[] = [];
  for (const item of r.output) {
    const it = item as { type?: string; content?: unknown[] };
    if (it.type !== 'message' || !Array.isArray(it.content)) {
      continue;
    }
    for (const c of it.content) {
      const cc = c as { type?: string; text?: string };
      if (cc.type === 'output_text' && typeof cc.text === 'string') {
        chunks.push(cc.text);
      }
    }
  }
  return chunks.join('\n');
};

const formatApiError = (err: unknown): Error => {
  const e = err as { status?: number; message?: string; error?: { message?: string } };
  const status = e.status ? `${e.status} ` : '';
  const message = e.error?.message ?? e.message ?? 'Unknown xAI API error';
  return new Error(`xAI API error: ${status}${message}`);
};

const sleep = (ms: number): Promise<void> =>
  new Promise((res) => {
    setTimeout(res, ms);
  });

const parseVideoStatus = (raw: unknown, requestId: string): VideoStatusResult => {
  const r = raw as {
    status?: string;
    video?: { url?: string; duration?: number };
    request_id?: string;
  };
  return {
    request_id: r.request_id ?? requestId,
    status: r.status ?? 'pending',
    ...(r.video?.url !== undefined && { videoUrl: r.video.url }),
    ...(r.video?.duration !== undefined && { duration: r.video.duration }),
    raw,
  };
};

/**
 * Construct a {@link GrokClient} bound to the given configuration.
 *
 * Uses the OpenAI SDK for endpoints that match the OpenAI shape
 * (Responses API, models list, basic images.generate), and a small `fetch`-based
 * helper for endpoints that don't (image edits with multiple sources, video
 * generation and status polling).
 */
export const createGrokClient = (config: Config): GrokClient => {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: config.timeoutMs,
  });

  const rawRequest = async <T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> => {
    const url = `${config.baseUrl.replace(/\/$/, '')}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string };
        detail = parsed.error?.message ?? parsed.message ?? text;
      } catch {
        /* keep raw text */
      }
      throw new Error(`xAI API error: ${res.status} ${detail}`);
    }
    return JSON.parse(text) as T;
  };

  const ask = async (input: GrokAskInput): Promise<string> => {
    const model = input.model ?? config.defaultModel;
    const images = await resolveAllMedia(input.images, 'image', config.maxImageBytes);
    const searchTools = resolveSearchTools(input.search);
    const inputMessages = buildResponsesInput(input.prompt, input.system, images);

    try {
      const resp = await client.responses.create({
        model,
        input: inputMessages as never,
        ...(searchTools.length > 0 && { tools: searchTools as never }),
        ...(input.max_tokens !== undefined && { max_output_tokens: input.max_tokens }),
        ...(input.temperature !== undefined && { temperature: input.temperature }),
      } as never);
      return extractTextFromResponse(resp);
    } catch (err) {
      throw formatApiError(err);
    }
  };

  const listModels = async (): Promise<string> => {
    try {
      const page = await client.models.list();
      const ids: string[] = [];
      for await (const m of page) {
        ids.push(m.id);
      }
      return ids.length > 0 ? ids.sort().join('\n') : '(no models returned)';
    } catch (err) {
      throw formatApiError(err);
    }
  };

  const generateImage = async (input: GrokGenerateImageInput): Promise<string[]> => {
    const model = input.model ?? DEFAULT_IMAGE_MODEL;
    if (input.source_images && input.source_images.length > 0) {
      const sources = await resolveAllMedia(input.source_images, 'image', config.maxImageBytes);
      const body = {
        model,
        prompt: input.prompt,
        ...(input.n !== undefined && { n: input.n }),
        ...(input.aspect_ratio && { aspect_ratio: input.aspect_ratio }),
        images: sources.map((s) => s.url),
      };
      const resp = await rawRequest<{ data?: { url?: string }[] }>('POST', '/images/edits', body);
      return (resp.data ?? []).map((d) => d.url ?? '').filter(Boolean);
    }

    try {
      const resp = await client.images.generate({
        model,
        prompt: input.prompt,
        ...(input.n !== undefined && { n: input.n }),
        ...(input.aspect_ratio && { aspect_ratio: input.aspect_ratio }),
      } as never);
      return ((resp.data ?? []) as { url?: string }[]).map((d) => d.url ?? '').filter(Boolean);
    } catch (err) {
      throw formatApiError(err);
    }
  };

  const getVideoStatus = async (input: GrokVideoStatusInput): Promise<VideoStatusResult> => {
    const raw = await rawRequest<unknown>('GET', `/videos/${encodeURIComponent(input.request_id)}`);
    return parseVideoStatus(raw, input.request_id);
  };

  const generateVideo = async (input: GrokGenerateVideoInput): Promise<VideoStatusResult> => {
    const model = input.model ?? DEFAULT_VIDEO_MODEL;
    const body = {
      model,
      prompt: input.prompt,
      ...(input.duration !== undefined && { duration: input.duration }),
      ...(input.aspect_ratio && { aspect_ratio: input.aspect_ratio }),
      ...(input.resolution && { resolution: input.resolution }),
    };
    const created = await rawRequest<{ request_id: string }>('POST', '/videos/generations', body);
    const requestId = created.request_id;

    if (input.wait === false) {
      return { request_id: requestId, status: 'pending', raw: created };
    }

    const deadline = Date.now() + config.timeoutMs;
    while (Date.now() < deadline) {
      const status = await getVideoStatus({ request_id: requestId });
      if (status.status === 'done' || status.status === 'failed' || status.status === 'expired') {
        return status;
      }
      await sleep(VIDEO_POLL_INTERVAL_MS);
    }
    return {
      request_id: requestId,
      status: 'pending',
      raw: { note: 'Local polling timed out; use grok_imagine_video_status to keep checking.' },
    };
  };

  return { ask, listModels, generateImage, generateVideo, getVideoStatus };
};
