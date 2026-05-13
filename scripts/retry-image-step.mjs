#!/usr/bin/env node
// Focused retry of grok_ask with image input, exercising the local-file → base64 path.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEST_IMAGE_PATH = '/tmp/grok-test-image.jpg';

const loadKey = () => {
  if (process.env.XAI_API_KEY?.trim()) {
    return process.env.XAI_API_KEY.trim();
  }
  try {
    const data = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8'));
    const k = data?.mcpServers?.grok?.env?.XAI_API_KEY;
    if (typeof k === 'string' && k.length > 0) return k;
  } catch {
    /* ignore */
  }
  try {
    const toml = readFileSync(join(homedir(), '.codex', 'config.toml'), 'utf8');
    const m = toml.match(/\[mcp_servers\.grok\][\s\S]*?XAI_API_KEY\s*=\s*"([^"]+)"/);
    if (m) return m[1];
  } catch {
    /* ignore */
  }
  throw new Error('XAI_API_KEY not found.');
};

const main = async () => {
  const key = loadKey();
  console.log(`Using XAI_API_KEY ${key.slice(0, 6)}…${key.slice(-4)}`);
  console.log(`Image: ${TEST_IMAGE_PATH}`);

  const transport = new StdioClientTransport({
    command: 'node',
    args: [join(repoRoot, 'dist', 'index.js')],
    env: { ...process.env, XAI_API_KEY: key },
  });
  const client = new Client(
    { name: 'grok-mcp-retry-image', version: '1.0.0' },
    { capabilities: {} },
  );
  await client.connect(transport);

  console.log('\n--- grok_ask with local image (base64) ---');
  const res = await client.callTool({
    name: 'grok_ask',
    arguments: {
      prompt: 'In one short sentence, describe what is in this image.',
      images: [TEST_IMAGE_PATH],
      max_tokens: 100,
    },
  });
  if (res.isError) {
    console.log('ERROR:');
  }
  for (const item of res.content ?? []) {
    if (item.type === 'text') console.log(item.text);
  }

  await client.close();
};

main().catch((err) => {
  console.error('Failed:', err?.message ?? err);
  process.exitCode = 1;
});
