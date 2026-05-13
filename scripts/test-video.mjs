#!/usr/bin/env node
// Live test of grok_imagine_video. Uses wait=false to avoid hitting the MCP
// client's per-request timeout, then polls grok_imagine_video_status manually.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const POLL_INTERVAL_MS = 10_000;
const POLL_MAX_ATTEMPTS = 30; // 30 × 10s = 5 minutes max

const loadKey = () => {
  if (process.env.XAI_API_KEY?.trim()) return process.env.XAI_API_KEY.trim();
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

const extractText = (res) => {
  const out = [];
  for (const item of res?.content ?? []) {
    if (item.type === 'text') out.push(item.text);
  }
  return out.join('\n');
};

const parseStatus = (text) => {
  const status = text.match(/status:\s*(\S+)/)?.[1];
  const url = text.match(/video_url:\s*(\S+)/)?.[1];
  const duration = text.match(/duration:\s*(\S+)/)?.[1];
  return { status, url, duration };
};

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const main = async () => {
  const key = loadKey();
  console.log(`Using XAI_API_KEY ${key.slice(0, 6)}…${key.slice(-4)}`);

  const transport = new StdioClientTransport({
    command: 'node',
    args: [join(repoRoot, 'dist', 'index.js')],
    env: { ...process.env, XAI_API_KEY: key },
  });
  const client = new Client(
    { name: 'grok-mcp-video-test', version: '1.0.0' },
    { capabilities: {} },
  );
  await client.connect(transport);

  console.log('\n--- Step A: grok_imagine_video (wait=false) ---');
  const t0 = Date.now();
  const kickoff = await client.callTool({
    name: 'grok_imagine_video',
    arguments: {
      prompt:
        'A short cinematic drone shot rising above a calm coastal town at sunset, golden hour, soft pastels.',
      duration: 6,
      aspect_ratio: '16:9',
      resolution: '720p',
      wait: false,
    },
  });
  const kickoffText = extractText(kickoff);
  console.log(kickoffText);
  const requestId = kickoffText.match(/request_id:\s*(\S+)/)?.[1];
  if (!requestId) {
    throw new Error('No request_id in kickoff response.');
  }

  console.log('\n--- Step B: poll grok_imagine_video_status ---');
  for (let i = 1; i <= POLL_MAX_ATTEMPTS; i += 1) {
    await sleep(POLL_INTERVAL_MS);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    const res = await client.callTool({
      name: 'grok_imagine_video_status',
      arguments: { request_id: requestId },
    });
    const text = extractText(res);
    const { status, url, duration } = parseStatus(text);
    console.log(`poll #${i} (${elapsed}s elapsed): status=${status}`);
    if (status === 'done') {
      console.log(`\nDone after ${elapsed}s`);
      console.log(`video_url: ${url}`);
      if (duration) console.log(`duration: ${duration}`);
      await client.close();
      return;
    }
    if (status === 'failed' || status === 'expired') {
      console.log(`\nTerminal status: ${status}`);
      console.log(text);
      await client.close();
      process.exitCode = 1;
      return;
    }
  }

  console.log(`\nGave up after ${POLL_MAX_ATTEMPTS} polls (~${(POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s).`);
  console.log(`Re-check later via grok_imagine_video_status with request_id=${requestId}`);
  await client.close();
};

main().catch((err) => {
  console.error('Failed:', err?.message ?? err);
  process.exitCode = 1;
});
