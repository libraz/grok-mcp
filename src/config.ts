const DEFAULT_BASE_URL = 'https://api.x.ai/v1';
const DEFAULT_MODEL = 'grok-4.3';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_IMAGE_MB = 20;
const DEFAULT_MAX_VIDEO_MB = 50;

/**
 * Resolved runtime configuration for the MCP server.
 *
 * Values originate from environment variables (see {@link loadConfig}). Byte limits
 * are stored as bytes; the user-facing env vars are expressed in megabytes.
 */
export type Config = {
  /** xAI API key. */
  apiKey: string;
  /** Base URL for the xAI REST API (no trailing slash). */
  baseUrl: string;
  /** Model ID used when a tool call does not specify one explicitly. */
  defaultModel: string;
  /** Timeout in milliseconds for individual HTTP requests and total video polling. */
  timeoutMs: number;
  /** Max accepted size, in bytes, for an image passed to `grok_ask` / `grok_imagine_image`. */
  maxImageBytes: number;
  /** Reserved cap for video input. xAI does not yet expose a video-understanding endpoint. */
  maxVideoBytes: number;
};

const parsePositiveInt = (raw: string | undefined, fallback: number): number => {
  if (!raw) {
    return fallback;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return n;
};

/**
 * Build a {@link Config} from a process-env-like map.
 *
 * Required: `XAI_API_KEY`. Throws when missing or whitespace-only.
 *
 * Optional, with sensible defaults: `XAI_BASE_URL`, `XAI_DEFAULT_MODEL`,
 * `XAI_TIMEOUT_MS`, `XAI_MAX_IMAGE_MB`, `XAI_MAX_VIDEO_MB`. Non-numeric or
 * non-positive values fall back to defaults rather than failing the boot.
 *
 * @param env Environment map. Defaults to `process.env`; pass a stub in tests.
 * @returns Fully resolved configuration.
 * @throws {Error} When `XAI_API_KEY` is not set.
 */
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const apiKey = env.XAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "XAI_API_KEY is not set. Configure it via your MCP client's `env` block. " +
        'See: https://github.com/libraz/grok-mcp#configuration',
    );
  }

  return {
    apiKey,
    baseUrl: env.XAI_BASE_URL?.trim() || DEFAULT_BASE_URL,
    defaultModel: env.XAI_DEFAULT_MODEL?.trim() || DEFAULT_MODEL,
    timeoutMs: parsePositiveInt(env.XAI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    maxImageBytes: parsePositiveInt(env.XAI_MAX_IMAGE_MB, DEFAULT_MAX_IMAGE_MB) * 1024 * 1024,
    maxVideoBytes: parsePositiveInt(env.XAI_MAX_VIDEO_MB, DEFAULT_MAX_VIDEO_MB) * 1024 * 1024,
  };
};
