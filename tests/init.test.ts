import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:readline/promises', () => ({
  createInterface: vi.fn(),
}));

import { createInterface } from 'node:readline/promises';
import {
  displayPath,
  parseTargetChoice,
  previewRemoveImpact,
  previewWriteImpact,
  removeFromClaudeConfig,
  removeFromCodexConfig,
  runInit,
  runUninstall,
  writeClaudeConfig,
  writeCodexConfig,
} from '../src/init.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'grok-mcp-init-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('writeClaudeConfig', () => {
  it('creates a fresh config when the file is missing', async () => {
    const path = join(dir, 'nested', '.claude.json');
    await writeClaudeConfig(path, 'xai-test', 'grok-4.3');

    const parsed = JSON.parse(await readFile(path, 'utf8')) as {
      mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
    };
    expect(parsed.mcpServers.grok?.command).toBe('npx');
    expect(parsed.mcpServers.grok?.env.XAI_API_KEY).toBe('xai-test');
    expect(parsed.mcpServers.grok?.env.XAI_DEFAULT_MODEL).toBe('grok-4.3');
  });

  it('preserves other servers and unrelated top-level keys', async () => {
    const path = join(dir, '.claude.json');
    await writeFile(
      path,
      JSON.stringify({
        otherTopLevel: { keep: true },
        mcpServers: {
          notgrok: { command: 'foo', args: ['bar'], env: { X: '1' } },
        },
      }),
    );

    await writeClaudeConfig(path, 'xai-new', 'grok-4.3');

    const parsed = JSON.parse(await readFile(path, 'utf8')) as {
      otherTopLevel: { keep: boolean };
      mcpServers: Record<string, { command: string; env?: Record<string, string> }>;
    };
    expect(parsed.otherTopLevel).toEqual({ keep: true });
    expect(parsed.mcpServers.notgrok?.command).toBe('foo');
    expect(parsed.mcpServers.grok?.env?.XAI_API_KEY).toBe('xai-new');
  });

  it('replaces a previous grok entry instead of duplicating it', async () => {
    const path = join(dir, '.claude.json');
    await writeFile(
      path,
      JSON.stringify({
        mcpServers: {
          grok: { command: 'old', args: [], env: { XAI_API_KEY: 'xai-old' } },
        },
      }),
    );

    await writeClaudeConfig(path, 'xai-fresh', 'grok-4-1-fast-non-reasoning');

    const parsed = JSON.parse(await readFile(path, 'utf8')) as {
      mcpServers: Record<string, { command: string; env: Record<string, string> }>;
    };
    expect(parsed.mcpServers.grok?.command).toBe('npx');
    expect(parsed.mcpServers.grok?.env.XAI_API_KEY).toBe('xai-fresh');
    expect(parsed.mcpServers.grok?.env.XAI_DEFAULT_MODEL).toBe('grok-4-1-fast-non-reasoning');
  });

  it('throws a clear error when the existing file is malformed JSON', async () => {
    const path = join(dir, '.claude.json');
    await writeFile(path, '{ not valid json');
    await expect(writeClaudeConfig(path, 'xai-x', 'grok-4.3')).rejects.toThrow(
      /Failed to parse existing JSON/,
    );
  });
});

describe('writeCodexConfig', () => {
  it('creates a fresh config when the file is missing', async () => {
    const path = join(dir, 'nested', 'config.toml');
    await writeCodexConfig(path, 'xai-test', 'grok-4.3');

    const text = await readFile(path, 'utf8');
    expect(text).toContain('[mcp_servers.grok]');
    expect(text).toContain('command = "npx"');
    expect(text).toContain('XAI_API_KEY = "xai-test"');
    expect(text).toContain('XAI_DEFAULT_MODEL = "grok-4.3"');
  });

  it('preserves unrelated sections', async () => {
    const path = join(dir, 'config.toml');
    await writeFile(
      path,
      ['[other]', 'key = "value"', '', '[another]', 'thing = 1', ''].join('\n'),
    );

    await writeCodexConfig(path, 'xai-test', 'grok-4.3');

    const text = await readFile(path, 'utf8');
    expect(text).toContain('[other]');
    expect(text).toContain('key = "value"');
    expect(text).toContain('[another]');
    expect(text).toContain('thing = 1');
    expect(text).toContain('[mcp_servers.grok]');
  });

  it('replaces an existing grok block in place', async () => {
    const path = join(dir, 'config.toml');
    await writeFile(
      path,
      [
        '[mcp_servers.grok]',
        'command = "old"',
        'args = []',
        '',
        '[mcp_servers.other]',
        'command = "keep"',
        '',
      ].join('\n'),
    );

    await writeCodexConfig(path, 'xai-new', 'grok-4.3');

    const text = await readFile(path, 'utf8');
    const grokBlocks = text.match(/\[mcp_servers\.grok\]/g) ?? [];
    expect(grokBlocks).toHaveLength(1);
    expect(text).not.toContain('command = "old"');
    expect(text).toContain('XAI_API_KEY = "xai-new"');
    expect(text).toContain('[mcp_servers.other]');
    expect(text).toContain('command = "keep"');
  });

  it('escapes double quotes and backslashes in values', async () => {
    const path = join(dir, 'config.toml');
    await writeCodexConfig(path, 'xai-"weird"\\value', 'grok-4.3');

    const text = await readFile(path, 'utf8');
    expect(text).toContain('XAI_API_KEY = "xai-\\"weird\\"\\\\value"');
  });

  it('handles an empty existing file', async () => {
    const path = join(dir, 'config.toml');
    await writeFile(path, '');

    await writeCodexConfig(path, 'xai-test', 'grok-4.3');

    const text = await readFile(path, 'utf8');
    expect(text.startsWith('[mcp_servers.grok]')).toBe(true);
  });
});

describe('displayPath', () => {
  it('replaces the home directory prefix with ~', () => {
    const home = process.env.HOME ?? '';
    expect(displayPath(`${home}/.claude.json`)).toBe('~/.claude.json');
    expect(displayPath(`${home}/.codex/config.toml`)).toBe('~/.codex/config.toml');
  });

  it('returns paths outside the home directory unchanged', () => {
    expect(displayPath('/tmp/elsewhere.json')).toBe('/tmp/elsewhere.json');
  });
});

describe('previewWriteImpact', () => {
  it('returns "(new)" when the path does not exist', async () => {
    expect(await previewWriteImpact(join(dir, 'missing.json'))).toBe('(new)');
  });

  it('returns "(replace grok)" when grok is already in a JSON file', async () => {
    const path = join(dir, '.mcp.json');
    await writeFile(path, JSON.stringify({ mcpServers: { a: {}, grok: {} } }));
    expect(await previewWriteImpact(path)).toBe('(replace grok)');
  });

  it('returns "(merge)" when the JSON file has no grok entry', async () => {
    const path = join(dir, '.mcp.json');
    await writeFile(path, JSON.stringify({ mcpServers: { other: {} } }));
    expect(await previewWriteImpact(path)).toBe('(merge)');
  });

  it('returns "(replace grok)" when grok is already in a TOML file', async () => {
    const path = join(dir, 'config.toml');
    await writeFile(path, ['[features]', 'k = 1', '', '[mcp_servers.grok]', ''].join('\n'));
    expect(await previewWriteImpact(path)).toBe('(replace grok)');
  });
});

describe('previewRemoveImpact', () => {
  it('returns "(no file; skip)" when missing', async () => {
    expect(await previewRemoveImpact(join(dir, 'missing.json'))).toBe('(no file; skip)');
  });

  it('returns "(no grok; skip)" when JSON has no grok entry', async () => {
    const path = join(dir, '.mcp.json');
    await writeFile(path, JSON.stringify({ mcpServers: { other: {} } }));
    expect(await previewRemoveImpact(path)).toBe('(no grok; skip)');
  });

  it('returns "(remove grok)" when JSON has a grok entry', async () => {
    const path = join(dir, '.mcp.json');
    await writeFile(path, JSON.stringify({ mcpServers: { grok: {}, other: {} } }));
    expect(await previewRemoveImpact(path)).toBe('(remove grok)');
  });

  it('returns "(remove grok)" when TOML has a grok block', async () => {
    const path = join(dir, 'config.toml');
    await writeFile(path, ['[features]', 'k = 1', '', '[mcp_servers.grok]', ''].join('\n'));
    expect(await previewRemoveImpact(path)).toBe('(remove grok)');
  });

  it('returns "(no grok; skip)" when TOML has no grok block', async () => {
    const path = join(dir, 'config.toml');
    await writeFile(path, '[features]\nk = 1\n');
    expect(await previewRemoveImpact(path)).toBe('(no grok; skip)');
  });
});

describe('parseTargetChoice', () => {
  it('falls back to the default when the input is blank', () => {
    expect(parseTargetChoice('', '1,3')).toEqual(['claude-user', 'codex']);
  });

  it('parses a single token', () => {
    expect(parseTargetChoice('2', '1,3')).toEqual(['claude-project']);
  });

  it('parses comma-separated tokens with whitespace', () => {
    expect(parseTargetChoice('1, 2 , 3', '1,3')).toEqual([
      'claude-user',
      'claude-project',
      'codex',
    ]);
  });

  it('deduplicates repeated tokens', () => {
    expect(parseTargetChoice('1,1,3', '1,3')).toEqual(['claude-user', 'codex']);
  });

  it('throws on unknown tokens', () => {
    expect(() => parseTargetChoice('1,99', '1,3')).toThrow(/Invalid choice: 99/);
  });
});

describe('removeFromClaudeConfig', () => {
  it('returns no-file when the config does not exist', async () => {
    const path = join(dir, 'nope', '.claude.json');
    expect(await removeFromClaudeConfig(path)).toBe('no-file');
  });

  it('returns absent when no grok entry is present', async () => {
    const path = join(dir, '.claude.json');
    await writeFile(
      path,
      JSON.stringify({
        mcpServers: { other: { command: 'x', args: [], env: {} } },
      }),
    );
    expect(await removeFromClaudeConfig(path)).toBe('absent');
    const after = JSON.parse(await readFile(path, 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(after.mcpServers.other).toBeDefined();
  });

  it('removes grok while preserving other servers and unrelated keys', async () => {
    const path = join(dir, '.claude.json');
    await writeFile(
      path,
      JSON.stringify({
        otherTopLevel: { keep: true },
        mcpServers: {
          grok: { command: 'npx', args: [], env: { XAI_API_KEY: 'xai-x' } },
          other: { command: 'foo', args: [], env: {} },
        },
      }),
    );

    expect(await removeFromClaudeConfig(path)).toBe('removed');

    const after = JSON.parse(await readFile(path, 'utf8')) as {
      otherTopLevel: { keep: boolean };
      mcpServers: Record<string, unknown>;
    };
    expect(after.otherTopLevel).toEqual({ keep: true });
    expect(after.mcpServers.grok).toBeUndefined();
    expect(after.mcpServers.other).toBeDefined();
  });

  it('returns absent for an empty file', async () => {
    const path = join(dir, '.claude.json');
    await writeFile(path, '');
    expect(await removeFromClaudeConfig(path)).toBe('absent');
  });
});

describe('removeFromCodexConfig', () => {
  it('returns no-file when the config does not exist', async () => {
    const path = join(dir, 'nope', 'config.toml');
    expect(await removeFromCodexConfig(path)).toBe('no-file');
  });

  it('returns absent when there is no grok block', async () => {
    const path = join(dir, 'config.toml');
    await writeFile(path, '[other]\nkey = "value"\n');
    expect(await removeFromCodexConfig(path)).toBe('absent');
    const after = await readFile(path, 'utf8');
    expect(after).toContain('[other]');
  });

  it('removes the grok block while preserving other sections', async () => {
    const path = join(dir, 'config.toml');
    await writeFile(
      path,
      [
        '[other]',
        'key = "value"',
        '',
        '[mcp_servers.grok]',
        'command = "npx"',
        'args = ["-y", "github:libraz/grok-mcp"]',
        '',
        '[mcp_servers.another]',
        'command = "keep"',
        '',
      ].join('\n'),
    );

    expect(await removeFromCodexConfig(path)).toBe('removed');

    const after = await readFile(path, 'utf8');
    expect(after).not.toContain('[mcp_servers.grok]');
    expect(after).toContain('[other]');
    expect(after).toContain('key = "value"');
    expect(after).toContain('[mcp_servers.another]');
    expect(after).toContain('command = "keep"');
  });

  it('writes an empty file when the only section was grok', async () => {
    const path = join(dir, 'config.toml');
    const block = ['[mcp_servers.grok]', 'command = "npx"', 'args = ["-y", "x"]', ''].join('\n');
    await writeFile(path, block);

    expect(await removeFromCodexConfig(path)).toBe('removed');

    const after = await readFile(path, 'utf8');
    expect(after).toBe('');
  });
});

type EnvSnapshot = {
  HOME: string | undefined;
  XAI_API_KEY: string | undefined;
  XAI_DEFAULT_MODEL: string | undefined;
};

const snapshotEnv = (): EnvSnapshot => ({
  HOME: process.env.HOME,
  XAI_API_KEY: process.env.XAI_API_KEY,
  XAI_DEFAULT_MODEL: process.env.XAI_DEFAULT_MODEL,
});

const restoreEnv = (snap: EnvSnapshot): void => {
  for (const key of Object.keys(snap) as (keyof EnvSnapshot)[]) {
    const value = snap[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

const queueReadline = (answers: string[]): void => {
  const queue = [...answers];
  vi.mocked(createInterface).mockReturnValue({
    question: vi.fn(async () => queue.shift() ?? ''),
    close: vi.fn(),
  } as never);
};

const captureStdout = (): string[] => {
  const writes: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
    writes.push(typeof chunk === 'string' ? chunk : String(chunk));
    return true;
  }) as never);
  return writes;
};

describe('runInit', () => {
  let envSnap: EnvSnapshot;
  let prevCwd: string;

  beforeEach(() => {
    envSnap = snapshotEnv();
    prevCwd = process.cwd();
    process.env.HOME = dir;
    delete process.env.XAI_API_KEY;
    delete process.env.XAI_DEFAULT_MODEL;
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    restoreEnv(envSnap);
  });

  it('writes user and codex configs by default, prompting for the API key', async () => {
    queueReadline(['xai-from-prompt', '', 'y']);
    captureStdout();
    await runInit();

    const claude = JSON.parse(await readFile(join(dir, '.claude.json'), 'utf8')) as {
      mcpServers: Record<string, { env: Record<string, string> }>;
    };
    expect(claude.mcpServers.grok?.env.XAI_API_KEY).toBe('xai-from-prompt');
    expect(claude.mcpServers.grok?.env.XAI_DEFAULT_MODEL).toBe('grok-4.3');

    const codex = await readFile(join(dir, '.codex', 'config.toml'), 'utf8');
    expect(codex).toContain('XAI_API_KEY = "xai-from-prompt"');
  });

  it('reuses XAI_API_KEY from env when the user presses Enter', async () => {
    process.env.XAI_API_KEY = 'xai-from-env';
    queueReadline(['', '', 'y']);
    captureStdout();
    await runInit();

    const claude = JSON.parse(await readFile(join(dir, '.claude.json'), 'utf8')) as {
      mcpServers: Record<string, { env: Record<string, string> }>;
    };
    expect(claude.mcpServers.grok?.env.XAI_API_KEY).toBe('xai-from-env');
  });

  it('honours an explicit override even when XAI_API_KEY is set', async () => {
    process.env.XAI_API_KEY = 'xai-from-env';
    queueReadline(['xai-override', '', 'y']);
    captureStdout();
    await runInit();

    const claude = JSON.parse(await readFile(join(dir, '.claude.json'), 'utf8')) as {
      mcpServers: Record<string, { env: Record<string, string> }>;
    };
    expect(claude.mcpServers.grok?.env.XAI_API_KEY).toBe('xai-override');
  });

  it('picks up XAI_DEFAULT_MODEL from env for the written entries', async () => {
    process.env.XAI_DEFAULT_MODEL = 'grok-3-mini';
    queueReadline(['xai-x', '', 'y']);
    captureStdout();
    await runInit();

    const claude = JSON.parse(await readFile(join(dir, '.claude.json'), 'utf8')) as {
      mcpServers: Record<string, { env: Record<string, string> }>;
    };
    expect(claude.mcpServers.grok?.env.XAI_DEFAULT_MODEL).toBe('grok-3-mini');
  });

  it('writes the project .mcp.json when target 2 is selected', async () => {
    queueReadline(['xai-proj', '2', 'y']);
    captureStdout();
    await runInit();

    const proj = JSON.parse(await readFile(join(dir, '.mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { env: Record<string, string> }>;
    };
    expect(proj.mcpServers.grok?.env.XAI_API_KEY).toBe('xai-proj');
  });

  it('aborts without writing when the user declines the confirmation', async () => {
    queueReadline(['xai-x', '', 'n']);
    const writes = captureStdout();
    await runInit();

    expect(writes.join('')).toContain('Aborted');
    await expect(readFile(join(dir, '.claude.json'), 'utf8')).rejects.toThrow();
  });

  it('throws when the API key is blank and no env is set', async () => {
    queueReadline(['', '', 'y']);
    captureStdout();
    await expect(runInit()).rejects.toThrow(/API key is required/);
  });
});

describe('runUninstall', () => {
  let envSnap: EnvSnapshot;
  let prevCwd: string;

  beforeEach(async () => {
    envSnap = snapshotEnv();
    prevCwd = process.cwd();
    process.env.HOME = dir;
    process.chdir(dir);

    await writeClaudeConfig(join(dir, '.claude.json'), 'xai-x', 'grok-4.3');
    await writeClaudeConfig(join(dir, '.mcp.json'), 'xai-x', 'grok-4.3');
    await writeCodexConfig(join(dir, '.codex', 'config.toml'), 'xai-x', 'grok-4.3');
  });

  afterEach(() => {
    process.chdir(prevCwd);
    restoreEnv(envSnap);
  });

  it('removes grok from all three default targets', async () => {
    queueReadline(['', 'y']);
    captureStdout();
    await runUninstall();

    const claude = JSON.parse(await readFile(join(dir, '.claude.json'), 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(claude.mcpServers.grok).toBeUndefined();

    const proj = JSON.parse(await readFile(join(dir, '.mcp.json'), 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(proj.mcpServers.grok).toBeUndefined();

    const codex = await readFile(join(dir, '.codex', 'config.toml'), 'utf8');
    expect(codex).not.toContain('[mcp_servers.grok]');
  });

  it('leaves files untouched when the user declines the confirmation', async () => {
    queueReadline(['1', 'n']);
    const writes = captureStdout();
    await runUninstall();

    expect(writes.join('')).toContain('Aborted');
    const claude = JSON.parse(await readFile(join(dir, '.claude.json'), 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(claude.mcpServers.grok).toBeDefined();
  });

  it('reports missing files and absent grok entries instead of failing', async () => {
    await rm(join(dir, '.claude.json'));
    await writeFile(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { other: {} } }));
    queueReadline(['1,2', 'y']);
    const writes = captureStdout();
    await runUninstall();

    const out = writes.join('');
    expect(out).toMatch(/does not exist/);
    expect(out).toMatch(/No grok/);
  });
});
