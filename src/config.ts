const DEFAULT_BASE_URL = 'https://api.x.ai/v1';
const DEFAULT_MODEL = 'grok-4.3';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_IMAGE_MB = 20;
const DEFAULT_MAX_VIDEO_MB = 50;
const DEFAULT_GROK_BIN = 'grok';

/**
 * Where Grok responses are sourced from.
 *
 * - `api`: call the xAI REST API directly (requires `XAI_API_KEY`). Full feature set.
 * - `cli`: shell out to the locally installed `grok` CLI, which authenticates via
 *   `grok login` (OAuth / subscription) rather than an API key. Text-only: image /
 *   video generation and X search are not available through the CLI.
 */
export type Backend = 'api' | 'cli';

/**
 * Resolved runtime configuration for the MCP server.
 *
 * Values originate from environment variables (see {@link loadConfig}). Byte limits
 * are stored as bytes; the user-facing env vars are expressed in megabytes.
 */
export type Config = {
  /** Response backend selected by `XAI_BACKEND`. */
  backend: Backend;
  /** xAI API key. Empty string when {@link backend} is `cli` (the CLI handles auth). */
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
  /** Path or command name of the `grok` CLI binary (used only when {@link backend} is `cli`). */
  grokBin: string;
  /** Default model id passed to the `grok` CLI when a tool call does not specify one. */
  cliDefaultModel?: string;
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

const parseBackend = (raw: string | undefined): Backend => {
  const value = raw?.trim().toLowerCase();
  if (value === undefined || value === '') {
    return 'api';
  }
  if (value === 'api' || value === 'cli') {
    return value;
  }
  throw new Error(`Invalid XAI_BACKEND: "${raw}". Expected "api" or "cli".`);
};

/**
 * Build a {@link Config} from a process-env-like map.
 *
 * `XAI_BACKEND` selects the response backend (`api`, the default, or `cli`).
 * In `api` mode `XAI_API_KEY` is required and the call throws when it is missing
 * or whitespace-only. In `cli` mode no API key is needed — the local `grok` CLI
 * authenticates via `grok login` — and `apiKey` is left as an empty string.
 *
 * Optional, with sensible defaults: `XAI_BASE_URL`, `XAI_DEFAULT_MODEL`,
 * `XAI_TIMEOUT_MS`, `XAI_MAX_IMAGE_MB`, `XAI_MAX_VIDEO_MB`, `GROK_BIN`,
 * `GROK_CLI_MODEL`. Non-numeric or non-positive numeric values fall back to
 * defaults rather than failing the boot.
 *
 * @param env Environment map. Defaults to `process.env`; pass a stub in tests.
 * @returns Fully resolved configuration.
 * @throws {Error} When `XAI_BACKEND` is invalid, or when `XAI_API_KEY` is unset in `api` mode.
 */
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const backend = parseBackend(env.XAI_BACKEND);
  const apiKey = env.XAI_API_KEY?.trim();
  if (backend === 'api' && !apiKey) {
    throw new Error(
      'XAI_API_KEY is not set. Export it in the environment used by your MCP client, ' +
        'or set XAI_BACKEND=cli to use the local grok CLI instead. ' +
        'See: https://github.com/libraz/grok-mcp#configuration',
    );
  }

  const cliDefaultModel = env.GROK_CLI_MODEL?.trim();

  return {
    backend,
    apiKey: apiKey ?? '',
    baseUrl: env.XAI_BASE_URL?.trim() || DEFAULT_BASE_URL,
    defaultModel: env.XAI_DEFAULT_MODEL?.trim() || DEFAULT_MODEL,
    timeoutMs: parsePositiveInt(env.XAI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    maxImageBytes: parsePositiveInt(env.XAI_MAX_IMAGE_MB, DEFAULT_MAX_IMAGE_MB) * 1024 * 1024,
    maxVideoBytes: parsePositiveInt(env.XAI_MAX_VIDEO_MB, DEFAULT_MAX_VIDEO_MB) * 1024 * 1024,
    grokBin: env.GROK_BIN?.trim() || DEFAULT_GROK_BIN,
    ...(cliDefaultModel && { cliDefaultModel }),
  };
};
