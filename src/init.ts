import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { stdin, stdout } from 'node:process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline/promises';

/**
 * Package specifier written into generated config snippets.
 * Update to `grok-mcp` once the package is published to npm.
 */
const PACKAGE_SPEC = 'github:libraz/grok-mcp';

/** Default model id used when the user accepts the suggested value. */
const DEFAULT_MODEL = 'grok-4.3';

/** Shape of the `mcpServers.<name>` entry shared by Claude Code and Codex CLI. */
type McpServerEntry = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

/** Subset of Claude Code's `~/.claude.json` we touch. Other keys are preserved verbatim. */
type ClaudeConfig = {
  mcpServers?: Record<string, McpServerEntry>;
  [key: string]: unknown;
};

const buildEntry = (apiKey: string, model: string): McpServerEntry => ({
  command: 'npx',
  args: ['-y', PACKAGE_SPEC],
  env: { XAI_API_KEY: apiKey, XAI_DEFAULT_MODEL: model },
});

/**
 * Merge a `grok` MCP entry into the Claude Code JSON config, preserving every other key.
 * Creates the file (and parent dirs) when missing.
 */
export const writeClaudeConfig = async (
  path: string,
  apiKey: string,
  model: string,
): Promise<void> => {
  let data: ClaudeConfig = {};
  if (existsSync(path)) {
    const raw = await readFile(path, 'utf8');
    if (raw.trim().length > 0) {
      try {
        data = JSON.parse(raw) as ClaudeConfig;
      } catch {
        throw new Error(
          `Failed to parse existing JSON at ${path}. Fix or move it before re-running init.`,
        );
      }
    }
  }
  data.mcpServers = data.mcpServers ?? {};
  data.mcpServers.grok = buildEntry(apiKey, model);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
};

const escapeTomlString = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

/**
 * Remove an existing `[mcp_servers.grok]` block from a TOML document.
 * Stops skipping at the next `[section]` header. Lines after the block are kept as-is.
 */
const stripCodexGrokSection = (content: string): string => {
  const lines = content.split('\n');
  const out: string[] = [];
  let inGrok = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '[mcp_servers.grok]') {
      inGrok = true;
      continue;
    }
    if (inGrok) {
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        inGrok = false;
        out.push(line);
      }
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
};

/**
 * Append or replace the `[mcp_servers.grok]` block in the Codex CLI TOML config.
 * Other sections in the file are kept verbatim.
 */
export const writeCodexConfig = async (
  path: string,
  apiKey: string,
  model: string,
): Promise<void> => {
  let existing = '';
  if (existsSync(path)) {
    existing = await readFile(path, 'utf8');
  }
  const stripped = stripCodexGrokSection(existing).replace(/\n*$/, '');
  const prefix = stripped.length > 0 ? `${stripped}\n\n` : '';
  const block = [
    '[mcp_servers.grok]',
    'command = "npx"',
    `args = ["-y", "${PACKAGE_SPEC}"]`,
    `env = { XAI_API_KEY = "${escapeTomlString(apiKey)}", XAI_DEFAULT_MODEL = "${escapeTomlString(model)}" }`,
  ].join('\n');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${prefix}${block}\n`);
};

/**
 * Render a filesystem path with `~` substituted for the user's home directory.
 * Display-only helper; the actual writes always use the absolute path.
 */
export const displayPath = (path: string): string => {
  const home = homedir();
  if (path === home) {
    return '~';
  }
  if (path.startsWith(`${home}/`)) {
    return `~/${path.slice(home.length + 1)}`;
  }
  return path;
};

/**
 * One-word status describing what `init` will do to a config file. Used in the
 * confirmation list so a first-time user can see at a glance whether they are
 * creating a fresh file or modifying an existing one.
 */
export const previewWriteImpact = async (path: string): Promise<string> => {
  if (!existsSync(path)) {
    return '(new)';
  }
  const raw = await readFile(path, 'utf8').catch(() => '');
  if (raw.trim().length === 0) {
    return '(new)';
  }
  try {
    const data = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
    return data.mcpServers && 'grok' in data.mcpServers ? '(replace grok)' : '(merge)';
  } catch {
    /* fall through to TOML heuristic */
  }
  return /^\[mcp_servers\.grok\]\s*$/m.test(raw) ? '(replace grok)' : '(merge)';
};

/**
 * One-word status describing what `uninstall` will do to a config file.
 */
export const previewRemoveImpact = async (path: string): Promise<string> => {
  if (!existsSync(path)) {
    return '(no file; skip)';
  }
  const raw = await readFile(path, 'utf8').catch(() => '');
  if (raw.trim().length === 0) {
    return '(no grok; skip)';
  }
  try {
    const data = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
    return data.mcpServers && 'grok' in data.mcpServers ? '(remove grok)' : '(no grok; skip)';
  } catch {
    /* fall through to TOML heuristic */
  }
  return /^\[mcp_servers\.grok\]\s*$/m.test(raw) ? '(remove grok)' : '(no grok; skip)';
};

/** Outcome of attempting to remove the grok entry from a config file. */
export type RemoveOutcome = 'removed' | 'absent' | 'no-file';

/**
 * Remove the `grok` MCP entry from a Claude Code JSON config. Preserves every
 * other top-level key and every other server entry. Returns whether anything
 * was actually changed.
 */
export const removeFromClaudeConfig = async (path: string): Promise<RemoveOutcome> => {
  if (!existsSync(path)) {
    return 'no-file';
  }
  const raw = await readFile(path, 'utf8');
  if (raw.trim().length === 0) {
    return 'absent';
  }
  let data: ClaudeConfig;
  try {
    data = JSON.parse(raw) as ClaudeConfig;
  } catch {
    throw new Error(
      `Failed to parse existing JSON at ${path}. Fix or move it before re-running uninstall.`,
    );
  }
  if (!data.mcpServers?.grok) {
    return 'absent';
  }
  delete data.mcpServers.grok;
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
  return 'removed';
};

/**
 * Remove the `[mcp_servers.grok]` block from a Codex CLI TOML config. Other
 * sections are kept verbatim. Returns whether anything was actually changed.
 */
export const removeFromCodexConfig = async (path: string): Promise<RemoveOutcome> => {
  if (!existsSync(path)) {
    return 'no-file';
  }
  const existing = await readFile(path, 'utf8');
  if (!/^\[mcp_servers\.grok\]\s*$/m.test(existing)) {
    return 'absent';
  }
  const stripped = stripCodexGrokSection(existing).replace(/\n*$/, '');
  await writeFile(path, stripped.length > 0 ? `${stripped}\n` : '');
  return 'removed';
};

const promptYesNo = async (
  rl: ReadlineInterface,
  question: string,
  defaultYes: boolean,
): Promise<boolean> => {
  const def = defaultYes ? 'Y/n' : 'y/N';
  const ans = (await rl.question(`${question} [${def}] `)).trim().toLowerCase();
  if (ans === '') {
    return defaultYes;
  }
  return ans === 'y' || ans === 'yes';
};

const promptApiKey = async (rl: ReadlineInterface): Promise<string> => {
  const envKey = process.env.XAI_API_KEY?.trim();
  if (envKey) {
    const masked = `${envKey.slice(0, 6)}…${envKey.slice(-4)}`;
    const override = (await rl.question(`xAI API key [Enter to use env ${masked}]: `)).trim();
    return override || envKey;
  }
  const key = (await rl.question('xAI API key (xai-...): ')).trim();
  if (!key) {
    throw new Error('API key is required.');
  }
  return key;
};

/**
 * Where to install / uninstall the grok MCP entry.
 *
 * - `claude-user`: Claude Code user-level config at `~/.claude.json`.
 *   Active across every Claude Code session for the current user.
 * - `claude-project`: Claude Code project-level config at `<cwd>/.mcp.json`.
 *   Active only when Claude Code is opened in that directory.
 * - `codex`: Codex CLI user-level config at `~/.codex/config.toml`.
 */
export type TargetKind = 'claude-user' | 'claude-project' | 'codex';

const TARGET_OPTIONS: {
  key: string;
  kind: TargetKind;
  label: string;
  resolvePath: () => string;
}[] = [
  {
    key: '1',
    kind: 'claude-user',
    label: 'Claude Code — user',
    resolvePath: () => join(homedir(), '.claude.json'),
  },
  {
    key: '2',
    kind: 'claude-project',
    label: 'Claude Code — project',
    resolvePath: () => join(process.cwd(), '.mcp.json'),
  },
  {
    key: '3',
    kind: 'codex',
    label: 'Codex CLI',
    resolvePath: () => join(homedir(), '.codex', 'config.toml'),
  },
];

/**
 * Parse a comma-separated target selector like `"1,3"` into a deduplicated list
 * of {@link TargetKind} values. Falls back to `defaultRaw` when the input is
 * blank. Throws on unrecognized tokens.
 */
export const parseTargetChoice = (raw: string, defaultRaw: string): TargetKind[] => {
  const input = raw.trim() === '' ? defaultRaw : raw;
  const parts = input
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) {
    throw new Error('No targets selected.');
  }
  const selected = new Set<TargetKind>();
  for (const p of parts) {
    const opt = TARGET_OPTIONS.find((o) => o.key === p);
    if (!opt) {
      throw new Error(`Invalid choice: ${p}`);
    }
    selected.add(opt.kind);
  }
  return [...selected];
};

const writeForKind = (
  kind: TargetKind,
  path: string,
  apiKey: string,
  model: string,
): (() => Promise<void>) => {
  if (kind === 'codex') {
    return () => writeCodexConfig(path, apiKey, model);
  }
  return () => writeClaudeConfig(path, apiKey, model);
};

const removeForKind = (kind: TargetKind, path: string): (() => Promise<RemoveOutcome>) => {
  if (kind === 'codex') {
    return () => removeFromCodexConfig(path);
  }
  return () => removeFromClaudeConfig(path);
};

type Target = { label: string; path: string; write: () => Promise<void> };

const pickTargets = (kinds: TargetKind[], apiKey: string, model: string): Target[] => {
  const targets: Target[] = [];
  for (const opt of TARGET_OPTIONS) {
    if (!kinds.includes(opt.kind)) {
      continue;
    }
    const path = opt.resolvePath();
    targets.push({ label: opt.label, path, write: writeForKind(opt.kind, path, apiKey, model) });
  }
  return targets;
};

const renderTargetMenu = (): string =>
  [
    `  1) Claude Code              ${displayPath(join(homedir(), '.claude.json'))}`,
    `  2) Claude Code (project)    ${displayPath(join(process.cwd(), '.mcp.json'))}`,
    `  3) Codex CLI                ${displayPath(join(homedir(), '.codex', 'config.toml'))}`,
  ].join('\n');

/**
 * Run the interactive setup. Prompts for an xAI API key, default model, and which
 * MCP client config files to update, then writes the `grok` entry into each.
 */
export const runInit = async (): Promise<void> => {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    stdout.write('grok-mcp setup\n\n');

    const apiKey = await promptApiKey(rl);
    const model = process.env.XAI_DEFAULT_MODEL?.trim() || DEFAULT_MODEL;

    stdout.write('\nWhere to install? (pick one or more, comma-separated)\n');
    stdout.write(`${renderTargetMenu()}\n`);
    const choice = (await rl.question('Choice [1,3]: ')).trim();
    const kinds = parseTargetChoice(choice, '1,3');
    const targets = pickTargets(kinds, apiKey, model);

    stdout.write('\nWill update:\n');
    for (const t of targets) {
      const summary = await previewWriteImpact(t.path);
      stdout.write(`  - ${displayPath(t.path)} ${summary}\n`);
    }
    stdout.write('\n');

    const confirmed = await promptYesNo(rl, 'Proceed?', true);
    if (!confirmed) {
      stdout.write('Aborted.\n');
      return;
    }

    for (const t of targets) {
      await t.write();
      stdout.write(`Wrote ${displayPath(t.path)}\n`);
    }

    stdout.write('\nDone. Restart your MCP client to pick up the new server.\n');
  } finally {
    rl.close();
  }
};

type RemoveTarget = {
  label: string;
  path: string;
  remove: () => Promise<RemoveOutcome>;
};

const pickRemoveTargets = (kinds: TargetKind[]): RemoveTarget[] => {
  const targets: RemoveTarget[] = [];
  for (const opt of TARGET_OPTIONS) {
    if (!kinds.includes(opt.kind)) {
      continue;
    }
    const path = opt.resolvePath();
    targets.push({ label: opt.label, path, remove: removeForKind(opt.kind, path) });
  }
  return targets;
};

/**
 * Interactive companion to {@link runInit}: removes the `grok` MCP entry from
 * Claude Code and/or Codex CLI config files. Leaves other servers/sections alone.
 */
export const runUninstall = async (): Promise<void> => {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    stdout.write('grok-mcp uninstall\n\n');

    stdout.write('Where to remove from? (pick one or more, comma-separated)\n');
    stdout.write(`${renderTargetMenu()}\n`);
    const choice = (await rl.question('Choice [1,2,3]: ')).trim();
    const kinds = parseTargetChoice(choice, '1,2,3');
    const targets = pickRemoveTargets(kinds);

    stdout.write('\nWill update:\n');
    for (const t of targets) {
      const summary = await previewRemoveImpact(t.path);
      stdout.write(`  - ${displayPath(t.path)} ${summary}\n`);
    }
    stdout.write('\n');

    const confirmed = await promptYesNo(rl, 'Proceed?', true);
    if (!confirmed) {
      stdout.write('Aborted.\n');
      return;
    }

    for (const t of targets) {
      const outcome = await t.remove();
      const p = displayPath(t.path);
      if (outcome === 'removed') {
        stdout.write(`Removed grok from ${p}\n`);
      } else if (outcome === 'absent') {
        stdout.write(`No grok in ${p}; skipped.\n`);
      } else {
        stdout.write(`${p} does not exist; skipped.\n`);
      }
    }

    stdout.write('\nDone. Restart your MCP client for the change to take effect.\n');
  } finally {
    rl.close();
  }
};
