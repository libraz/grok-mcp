import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config.js';

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));

vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  return {
    // Only the promisified form is exercised; the callback base just needs to exist.
    execFile: Object.assign(
      () => {
        throw new Error('callback execFile is not used in these tests');
      },
      {
        [promisify.custom]: (file: string, args: string[], options: unknown) =>
          execFileMock(file, args, options),
      },
    ),
  };
});

const { createGrokCliClient } = await import('../src/grok-cli.js');

const config: Config = {
  backend: 'cli',
  apiKey: '',
  baseUrl: 'https://api.x.ai/v1',
  defaultModel: 'grok-4.3',
  timeoutMs: 60_000,
  maxImageBytes: 20 * 1024 * 1024,
  maxVideoBytes: 50 * 1024 * 1024,
  grokBin: 'grok',
  cliDefaultModel: 'grok-4.5',
};

const ok = (stdout: string): { stdout: string; stderr: string } => ({ stdout, stderr: '' });

const argsOf = (): string[] => (execFileMock.mock.calls[0]?.[1] as string[]) ?? [];

beforeEach(() => {
  execFileMock.mockReset();
});

describe('grok-cli ask', () => {
  it('runs --single with json output and returns the text field', async () => {
    execFileMock.mockResolvedValue(
      ok(JSON.stringify({ text: 'hello', stopReason: 'EndTurn', sessionId: 's1' })),
    );
    const client = createGrokCliClient(config);

    const out = await client.ask({ prompt: 'ping' });

    expect(out).toBe('hello');
    const [bin, , opts] = execFileMock.mock.calls[0] ?? [];
    expect(bin).toBe('grok');
    const args = argsOf();
    expect(args.slice(0, 3)).toEqual(['--single=ping', '--output-format', 'json']);
    expect(args).toContain('--model=grok-4.5');
    // Search is off by default, so web search is disabled for a clean answer.
    expect(args).toContain('--disable-web-search');
    expect((opts as { cwd?: string }).cwd).toBeDefined();
  });

  it('honors model override, system prompt, and enables web search', async () => {
    execFileMock.mockResolvedValue(ok(JSON.stringify({ text: 'ok' })));
    const client = createGrokCliClient(config);

    await client.ask({ prompt: 'p', model: 'grok-x', system: 'be terse', search: 'web' });

    const args = argsOf();
    expect(args).toContain('--model=grok-x');
    expect(args).toContain('--system-prompt-override=be terse');
    expect(args).not.toContain('--disable-web-search');
  });

  it('keeps a hyphen-leading prompt as the value of --single', async () => {
    execFileMock.mockResolvedValue(ok(JSON.stringify({ text: 'ok' })));
    const client = createGrokCliClient(config);

    await client.ask({ prompt: '--version' });

    expect(argsOf()[0]).toBe('--single=--version');
  });

  it('falls back to raw stdout when the output is not JSON', async () => {
    execFileMock.mockResolvedValue(ok('plain text answer\n'));
    const client = createGrokCliClient(config);

    expect(await client.ask({ prompt: 'p' })).toBe('plain text answer');
  });

  it('salvages stdout when the CLI exits non-zero but still printed an answer', async () => {
    execFileMock.mockRejectedValue({
      code: 1,
      stdout: JSON.stringify({ text: 'partial' }),
      stderr: 'non-fatal warning',
    });
    const client = createGrokCliClient(config);

    expect(await client.ask({ prompt: 'p' })).toBe('partial');
  });

  it('rejects image input', async () => {
    const client = createGrokCliClient(config);
    await expect(
      client.ask({ prompt: 'p', images: ['https://example.com/a.png'] }),
    ).rejects.toThrow(/Image input is not supported/);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('rejects X-only search', async () => {
    const client = createGrokCliClient(config);
    await expect(client.ask({ prompt: 'p', search: 'x' })).rejects.toThrow(
      /X \(Twitter\) search is only available via the API backend/,
    );
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('omits --model when no model is configured or requested', async () => {
    execFileMock.mockResolvedValue(ok(JSON.stringify({ text: 'ok' })));
    const { cliDefaultModel: _omit, ...noModel } = config;
    const client = createGrokCliClient(noModel as Config);

    await client.ask({ prompt: 'p' });

    expect(argsOf()).not.toContain('--model');
  });

  it('surfaces a friendly error when the binary is missing', async () => {
    execFileMock.mockRejectedValue(
      Object.assign(new Error('spawn grok ENOENT'), { code: 'ENOENT' }),
    );
    const client = createGrokCliClient(config);

    await expect(client.ask({ prompt: 'p' })).rejects.toThrow(/grok CLI not found/);
  });

  it('reports a timeout when the process is killed', async () => {
    execFileMock.mockRejectedValue({ killed: true, signal: 'SIGTERM', stdout: '', stderr: '' });
    const client = createGrokCliClient(config);

    await expect(client.ask({ prompt: 'p' })).rejects.toThrow(/timed out/);
  });

  it('surfaces stderr for other failures', async () => {
    execFileMock.mockRejectedValue({ code: 2, stdout: '', stderr: 'boom' });
    const client = createGrokCliClient(config);

    await expect(client.ask({ prompt: 'p' })).rejects.toThrow(/grok CLI error: boom/);
  });
});

describe('grok-cli listModels', () => {
  it('parses the model listing into sorted IDs', async () => {
    execFileMock.mockResolvedValue(
      ok(
        [
          'You are logged in with grok.com.',
          '',
          'Default model: grok-4.5',
          '',
          'Available models:',
          '  - grok-4.3',
          '  * grok-4.5 (default)',
        ].join('\n'),
      ),
    );
    const client = createGrokCliClient(config);

    expect((await client.listModels()).split('\n')).toEqual(['grok-4.3', 'grok-4.5']);
    expect(argsOf()).toEqual(['models']);
  });

  it('returns a placeholder when no models are listed', async () => {
    execFileMock.mockResolvedValue(ok('You are not authenticated.\n'));
    const client = createGrokCliClient(config);

    expect(await client.listModels()).toBe('(no models returned)');
  });
});

describe('grok-cli unsupported features', () => {
  it('throws for image generation, video generation, and status polling', async () => {
    const client = createGrokCliClient(config);

    expect(() => client.generateImage({ prompt: 'x' })).toThrow(/not available with the grok CLI/);
    expect(() => client.generateVideo({ prompt: 'x' })).toThrow(/not available with the grok CLI/);
    expect(() => client.getVideoStatus({ request_id: 'r' })).toThrow(
      /not available with the grok CLI/,
    );
  });
});
