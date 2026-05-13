#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { runInit, runUninstall } from './init.js';
import { createServer } from './server.js';

const PACKAGE_VERSION = '0.1.0';

const HELP = `grok-mcp ${PACKAGE_VERSION}
MCP server exposing xAI Grok API.

Usage:
  grok-mcp           Start the stdio MCP server.
  grok-mcp init      Interactive setup: write the grok MCP entry into
                     Claude Code and/or Codex CLI config files.
  grok-mcp uninstall Interactive removal: drop the grok MCP entry from
                     Claude Code and/or Codex CLI config files.
  grok-mcp --help    Show this help.
  grok-mcp --version Show version.

Required environment:
  XAI_API_KEY              xAI API key (get one at https://console.x.ai)

Optional environment:
  XAI_BASE_URL             Override API endpoint (default: https://api.x.ai/v1)
  XAI_DEFAULT_MODEL        Default model id (default: grok-4.3)
  XAI_TIMEOUT_MS           Request timeout in ms (default: 120000)
  XAI_MAX_IMAGE_MB         Max image size for base64 encoding (default: 20)
  XAI_MAX_VIDEO_MB         (Reserved, no video input is documented by xAI yet)

Docs: https://github.com/libraz/grok-mcp
`;

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`${PACKAGE_VERSION}\n`);
    return;
  }
  if (argv[0] === 'init') {
    await runInit();
    return;
  }
  if (argv[0] === 'uninstall') {
    await runUninstall();
    return;
  }

  const config = loadConfig();
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
};

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[grok-mcp] ${message}\n`);
  process.exit(1);
});
