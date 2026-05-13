import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from './config.js';
import { createGrokClient } from './grok.js';
import { estimateCost } from './pricing.js';
import {
  grokAskInputSchema,
  grokEstimateCostInputSchema,
  grokGenerateImageInputSchema,
  grokGenerateVideoInputSchema,
  grokListModelsInputSchema,
  grokVideoStatusInputSchema,
} from './schema.js';

const PACKAGE_VERSION = '0.1.0';

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

const text = (s: string): ToolResult => ({ content: [{ type: 'text', text: s }] });
const errorText = (s: string): ToolResult => ({
  content: [{ type: 'text', text: s }],
  isError: true,
});

const safe = async (fn: () => Promise<ToolResult>): Promise<ToolResult> => {
  try {
    return await fn();
  } catch (err) {
    return errorText(err instanceof Error ? err.message : String(err));
  }
};

/**
 * Build the MCP server with all Grok tools registered.
 *
 * The returned server is not yet connected to a transport — the caller is
 * responsible for wiring it up (typically through {@link StdioServerTransport}).
 * Every tool handler catches errors and surfaces them as `isError` results so
 * the MCP client sees a clean response instead of a transport-level failure.
 */
export const createServer = (config: Config): McpServer => {
  const grok = createGrokClient(config);
  const server = new McpServer({ name: 'grok-mcp', version: PACKAGE_VERSION });

  server.registerTool(
    'grok_ask',
    {
      title: 'Ask Grok',
      description:
        'Send a text + optional image prompt to xAI Grok. Supports server-side X (Twitter) ' +
        'and web search via the Responses API.',
      inputSchema: grokAskInputSchema,
    },
    async (args) =>
      safe(async () => {
        const out = await grok.ask(args);
        return text(out || '(empty response)');
      }),
  );

  server.registerTool(
    'grok_list_models',
    {
      title: 'List Grok models',
      description: 'List xAI model IDs available to your API key.',
      inputSchema: grokListModelsInputSchema,
    },
    async () =>
      safe(async () => {
        const out = await grok.listModels();
        return text(out);
      }),
  );

  server.registerTool(
    'grok_imagine_image',
    {
      title: 'Generate image with Grok Imagine',
      description:
        'Generate (or edit, when source_images is provided) images via Grok Imagine. ' +
        'Returns one or more image URLs (xAI-hosted; download promptly).',
      inputSchema: grokGenerateImageInputSchema,
    },
    async (args) =>
      safe(async () => {
        const urls = await grok.generateImage(args);
        if (urls.length === 0) {
          return errorText('No image URLs returned by xAI.');
        }
        return text(urls.join('\n'));
      }),
  );

  server.registerTool(
    'grok_imagine_video',
    {
      title: 'Generate video with Grok Imagine',
      description:
        'Generate a video via Grok Imagine. By default this blocks until the video is ready ' +
        '(polling every 5s up to XAI_TIMEOUT_MS). Set wait=false to return the request_id ' +
        'immediately and poll later with grok_imagine_video_status.',
      inputSchema: grokGenerateVideoInputSchema,
    },
    async (args) =>
      safe(async () => {
        const r = await grok.generateVideo(args);
        const lines = [`request_id: ${r.request_id}`, `status: ${r.status}`];
        if (r.videoUrl) {
          lines.push(`video_url: ${r.videoUrl}`);
        }
        if (r.duration !== undefined) {
          lines.push(`duration: ${r.duration}s`);
        }
        return text(lines.join('\n'));
      }),
  );

  server.registerTool(
    'grok_imagine_video_status',
    {
      title: 'Poll Grok Imagine video status',
      description: 'Check the status of an in-progress video generation by request_id.',
      inputSchema: grokVideoStatusInputSchema,
    },
    async (args) =>
      safe(async () => {
        const r = await grok.getVideoStatus(args);
        const lines = [`request_id: ${r.request_id}`, `status: ${r.status}`];
        if (r.videoUrl) {
          lines.push(`video_url: ${r.videoUrl}`);
        }
        if (r.duration !== undefined) {
          lines.push(`duration: ${r.duration}s`);
        }
        return text(lines.join('\n'));
      }),
  );

  server.registerTool(
    'grok_estimate_cost',
    {
      title: 'Estimate Grok API cost',
      description:
        'Estimate USD cost for a Grok API call given a model ID and token/image/video counts. ' +
        'Uses a static pricing table snapshot; verify rates at https://docs.x.ai/developers/models.',
      inputSchema: grokEstimateCostInputSchema,
    },
    async (args) =>
      safe(async () => {
        const r = estimateCost({
          model: args.model,
          ...(args.input_tokens !== undefined && { inputTokens: args.input_tokens }),
          ...(args.output_tokens !== undefined && { outputTokens: args.output_tokens }),
          ...(args.image_count !== undefined && { imageCount: args.image_count }),
          ...(args.video_seconds !== undefined && { videoSeconds: args.video_seconds }),
        });
        const lines = [
          `model: ${r.model}`,
          `pricing known: ${r.knownPricing ? 'yes' : 'no'}`,
          `estimated cost: $${r.costUsd}`,
        ];
        if (r.breakdown.length > 0) {
          lines.push('', 'breakdown:', ...r.breakdown.map((b) => `  - ${b}`));
        }
        if (r.notes.length > 0) {
          lines.push('', 'notes:', ...r.notes.map((n) => `  - ${n}`));
        }
        return text(lines.join('\n'));
      }),
  );

  return server;
};
