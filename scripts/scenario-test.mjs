#!/usr/bin/env node
// Live end-to-end scenario test against the real xAI API.
// Reads XAI_API_KEY from env. Keep live-test credentials out of MCP config files.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const loadKey = () => {
  if (process.env.XAI_API_KEY?.trim()) {
    return { key: process.env.XAI_API_KEY.trim(), source: 'env' };
  }
  throw new Error('XAI_API_KEY not found. Set it in the environment before running live tests.');
};

const banner = (title) => {
  process.stdout.write(`\n${'='.repeat(60)}\n${title}\n${'='.repeat(60)}\n`);
};

const printResult = (res) => {
  if (!res) {
    console.log('(no result)');
    return;
  }
  if (res.isError) {
    console.log('ERROR:');
    for (const item of res.content ?? []) {
      if (item.type === 'text') console.log(item.text);
    }
    return;
  }
  for (const item of res.content ?? []) {
    if (item.type === 'text') console.log(item.text);
  }
};

const TEST_IMAGE_URL =
  'https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Gull_portrait_ca_usa.jpg/640px-Gull_portrait_ca_usa.jpg';

const main = async () => {
  const { key, source } = loadKey();
  const masked = `${key.slice(0, 6)}…${key.slice(-4)}`;
  console.log(`Using XAI_API_KEY ${masked} (from ${source})`);

  const transport = new StdioClientTransport({
    command: 'node',
    args: [join(repoRoot, 'dist', 'index.js')],
    env: { ...process.env, XAI_API_KEY: key },
  });
  const client = new Client(
    { name: 'grok-mcp-scenario-test', version: '1.0.0' },
    { capabilities: {} },
  );
  await client.connect(transport);

  banner('Step 0: listTools (MCP handshake)');
  const tools = await client.listTools();
  console.log(
    'Registered tools:',
    tools.tools.map((t) => t.name).join(', '),
  );

  banner('Step 1: grok_list_models');
  printResult(await client.callTool({ name: 'grok_list_models', arguments: {} }));

  banner('Step 2: grok_ask — text only');
  printResult(
    await client.callTool({
      name: 'grok_ask',
      arguments: {
        prompt: 'In one short sentence, greet a tool called grok-mcp.',
        max_tokens: 60,
      },
    }),
  );

  banner('Step 3: grok_ask — search="x" (X realtime)');
  printResult(
    await client.callTool({
      name: 'grok_ask',
      arguments: {
        prompt:
          'In one short sentence, summarize the single most recent public post by @xai on X.',
        search: 'x',
        max_tokens: 200,
      },
    }),
  );

  banner('Step 4: grok_ask — image input (URL)');
  printResult(
    await client.callTool({
      name: 'grok_ask',
      arguments: {
        prompt: 'In one sentence, describe what is in this image.',
        images: [TEST_IMAGE_URL],
        max_tokens: 80,
      },
    }),
  );

  banner('Step 5: grok_estimate_cost — local pricing table');
  printResult(
    await client.callTool({
      name: 'grok_estimate_cost',
      arguments: { model: 'grok-4.3', input_tokens: 12_000, output_tokens: 800 },
    }),
  );

  banner('Step 6: grok_imagine_image — 1 image, 1:1, quality model');
  printResult(
    await client.callTool({
      name: 'grok_imagine_image',
      arguments: {
        prompt:
          'A minimalist flat logo: the letters G M C P in indigo, centered on a soft cream background.',
        model: 'grok-imagine-image-quality',
        n: 1,
        aspect_ratio: '1:1',
      },
    }),
  );

  await client.close();
  console.log('\nDone.');
};

main().catch((err) => {
  console.error('\nScenario test failed:', err?.message ?? err);
  process.exitCode = 1;
});
