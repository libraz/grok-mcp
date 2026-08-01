import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import type { Config } from './config.js';
import type { GrokClient } from './grok.js';
import type { GrokAskInput } from './schema.js';

const execFileAsync = promisify(execFile);

/** Generous cap for the CLI's JSON payload; the default 1 MiB can truncate long answers. */
const CLI_MAX_BUFFER = 16 * 1024 * 1024;

/** Shape of `grok --single --output-format json` stdout. Only `text` is required by us. */
type GrokCliJson = {
  text?: unknown;
};

type ExecFailure = {
  code?: string | number;
  killed?: boolean;
  signal?: string;
  stdout?: string;
  stderr?: string;
  message?: string;
};

/**
 * Extract the assistant answer from the CLI's stdout.
 *
 * Prefers the `text` field of the JSON envelope emitted by `--output-format json`;
 * falls back to the raw trimmed output so `--output-format plain` (or an unexpected
 * format) still yields something usable.
 */
const parseAskOutput = (stdout: string): string => {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return '';
  }
  try {
    const parsed = JSON.parse(trimmed) as GrokCliJson;
    if (typeof parsed.text === 'string') {
      return parsed.text;
    }
  } catch {
    /* not JSON — fall through to the raw output */
  }
  return trimmed;
};

/**
 * Parse the `grok models` listing into sorted model IDs.
 *
 * The CLI prints one model per line prefixed with `*` (default) or `-`, e.g.
 * `  * grok-4.5 (default)`. Header lines ("Available models:", login status)
 * have no such prefix and are ignored.
 */
const parseModelsOutput = (stdout: string): string[] => {
  const models: string[] = [];
  for (const line of stdout.split('\n')) {
    const match = line.match(/^\s*[*-]\s+(\S+)/);
    if (match?.[1]) {
      models.push(match[1]);
    }
  }
  return models.sort();
};

const formatCliError = (err: unknown, bin: string): Error => {
  const e = err as ExecFailure;
  if (e.code === 'ENOENT') {
    return new Error(
      `grok CLI not found (tried "${bin}"). Install it and run "grok login", or point GROK_BIN ` +
        'at the binary. Alternatively set XAI_BACKEND=api with XAI_API_KEY.',
    );
  }
  if (e.killed) {
    return new Error('grok CLI timed out (exceeded XAI_TIMEOUT_MS).');
  }
  const detail = (e.stderr ?? '').trim() || e.message || 'unknown error';
  return new Error(`grok CLI error: ${detail}`);
};

const unsupported = (feature: string): never => {
  throw new Error(
    `${feature} is not available with the grok CLI backend (XAI_BACKEND=cli). ` +
      'Switch to XAI_BACKEND=api and set XAI_API_KEY to use it.',
  );
};

/**
 * Build a {@link GrokClient} that sources responses from the locally installed
 * `grok` CLI instead of the xAI REST API.
 *
 * Authentication is handled by the CLI itself (`grok login`), so no API key is
 * required. The CLI is an agentic tool that, by default, picks up project
 * instructions and can run filesystem tools in its working directory; to keep
 * `grok_ask` a side-effect-free question/answer call, the subprocess runs in the
 * OS temp directory and web search is disabled unless the caller opts in.
 *
 * Only text generation and model listing are supported. Image / video generation
 * and X (Twitter) search are API-only and throw a clear error here.
 */
export const createGrokCliClient = (config: Config): GrokClient => {
  const runCli = async (args: string[]): Promise<string> => {
    try {
      const { stdout } = await execFileAsync(config.grokBin, args, {
        timeout: config.timeoutMs,
        maxBuffer: CLI_MAX_BUFFER,
        cwd: tmpdir(),
      });
      return stdout;
    } catch (err) {
      // The CLI can exit non-zero while still having printed a usable answer
      // (e.g. a non-fatal auth warning on stderr); salvage stdout when present.
      const salvaged = (err as ExecFailure).stdout;
      if (salvaged && salvaged.trim().length > 0) {
        return salvaged;
      }
      throw formatCliError(err, config.grokBin);
    }
  };

  const ask = async (input: GrokAskInput): Promise<string> => {
    if (input.images && input.images.length > 0) {
      throw new Error(
        'Image input is not supported by the grok CLI backend. ' +
          'Set XAI_BACKEND=api for image understanding.',
      );
    }
    if (input.search === 'x') {
      throw new Error(
        'X (Twitter) search is only available via the API backend. ' +
          'Set XAI_BACKEND=api, or use search="web".',
      );
    }

    const model = input.model ?? config.cliDefaultModel;
    // "both" and `true` ask for X search too, which the CLI cannot do; they run as
    // web-search-only rather than failing, unlike an explicit "x" (rejected above).
    const webSearch = input.search === 'web' || input.search === 'both' || input.search === true;

    // Option values are passed in `--flag=value` form: the CLI rejects a separate
    // value that starts with "-", which would otherwise break every prompt
    // beginning with a hyphen.
    const args = [`--single=${input.prompt}`, '--output-format', 'json'];
    if (model) {
      args.push(`--model=${model}`);
    }
    if (input.system) {
      args.push(`--system-prompt-override=${input.system}`);
    }
    if (!webSearch) {
      args.push('--disable-web-search');
    }

    return parseAskOutput(await runCli(args));
  };

  const listModels = async (): Promise<string> => {
    const models = parseModelsOutput(await runCli(['models']));
    return models.length > 0 ? models.join('\n') : '(no models returned)';
  };

  return {
    ask,
    listModels,
    generateImage: () => unsupported('Image generation'),
    generateVideo: () => unsupported('Video generation'),
    getVideoStatus: () => unsupported('Video status polling'),
  };
};
