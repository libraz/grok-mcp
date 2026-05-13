import { z } from 'zod';

/** Zod input schema for the `grok_ask` tool. Pass to `McpServer.registerTool`. */
export const grokAskInputSchema = {
  prompt: z.string().min(1).describe('User prompt sent to Grok.'),
  images: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Optional images. Each item is a local file path, an http(s) URL, or a data URI. ' +
        'Formats: jpg/jpeg or png. Max 20MiB per image.',
    ),
  model: z
    .string()
    .optional()
    .describe(
      'xAI model ID. Use `grok_list_models` to discover live model IDs. ' +
        'Falls back to env XAI_DEFAULT_MODEL or grok-4.3.',
    ),
  system: z.string().optional().describe('Optional system prompt.'),
  max_tokens: z.number().int().positive().optional().describe('Maximum output tokens.'),
  temperature: z.number().min(0).max(2).optional().describe('Sampling temperature (0-2).'),
  search: z
    .union([z.boolean(), z.enum(['web', 'x', 'both'])])
    .optional()
    .describe(
      'Enable xAI server-side search via the Responses API. ' +
        '`"x"` enables X (Twitter) realtime search, `"web"` enables web search, ' +
        '`true` or `"both"` enables both.',
    ),
};

/** Parsed input type for the `grok_ask` tool. */
export type GrokAskInput = {
  prompt: string;
  images?: string[];
  model?: string;
  system?: string;
  max_tokens?: number;
  temperature?: number;
  search?: boolean | 'web' | 'x' | 'both';
};

/** Zod input schema for `grok_list_models`. No parameters. */
export const grokListModelsInputSchema = {} as const;

/** Zod input schema for the `grok_imagine_image` tool. */
export const grokGenerateImageInputSchema = {
  prompt: z.string().min(1).describe('Text description of the image to generate.'),
  model: z
    .string()
    .optional()
    .describe(
      'Image generation model. One of: grok-imagine-image ($0.02/img), ' +
        'grok-imagine-image-quality ($0.05/img), grok-imagine-image-pro ($0.07/img). ' +
        'Defaults to grok-imagine-image-quality.',
    ),
  n: z.number().int().min(1).max(10).optional().describe('Number of images (1-10).'),
  aspect_ratio: z
    .enum(['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3'])
    .optional()
    .describe('Aspect ratio of the generated image.'),
  source_images: z
    .array(z.string().min(1))
    .max(3)
    .optional()
    .describe(
      'Optional source images for editing (up to 3). When provided, the /v1/images/edits ' +
        'endpoint is used instead of /v1/images/generations.',
    ),
};

/** Parsed input type for the `grok_imagine_image` tool. */
export type GrokGenerateImageInput = {
  prompt: string;
  model?: string;
  n?: number;
  aspect_ratio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '3:2' | '2:3';
  source_images?: string[];
};

/** Zod input schema for the `grok_imagine_video` tool. */
export const grokGenerateVideoInputSchema = {
  prompt: z.string().min(1).describe('Text description of the video to generate.'),
  model: z
    .string()
    .optional()
    .describe('Video generation model. Defaults to grok-imagine-video ($0.050/sec).'),
  duration: z
    .number()
    .int()
    .min(1)
    .max(15)
    .optional()
    .describe('Duration in seconds (1-15). Defaults vary by use case.'),
  aspect_ratio: z
    .enum(['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3'])
    .optional()
    .describe('Aspect ratio. Defaults to 16:9 if omitted.'),
  resolution: z.enum(['480p', '720p']).optional().describe('Output resolution. Defaults to 480p.'),
  wait: z
    .boolean()
    .optional()
    .describe(
      'If true (default), block until the video is ready or until timeout (XAI_TIMEOUT_MS). ' +
        'If false, return the request_id immediately for later polling.',
    ),
};

/** Parsed input type for the `grok_imagine_video` tool. */
export type GrokGenerateVideoInput = {
  prompt: string;
  model?: string;
  duration?: number;
  aspect_ratio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '3:2' | '2:3';
  resolution?: '480p' | '720p';
  wait?: boolean;
};

/** Zod input schema for the `grok_imagine_video_status` tool. */
export const grokVideoStatusInputSchema = {
  request_id: z
    .string()
    .min(1)
    .describe('Video generation request ID returned by grok_imagine_video.'),
};

/** Parsed input type for the `grok_imagine_video_status` tool. */
export type GrokVideoStatusInput = {
  request_id: string;
};

/** Zod input schema for the `grok_estimate_cost` tool. */
export const grokEstimateCostInputSchema = {
  model: z.string().min(1).describe('xAI model ID to estimate cost for.'),
  input_tokens: z.number().int().nonnegative().optional().describe('Estimated input tokens.'),
  output_tokens: z.number().int().nonnegative().optional().describe('Estimated output tokens.'),
  image_count: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Number of images (for image generation models).'),
  video_seconds: z
    .number()
    .nonnegative()
    .optional()
    .describe('Video length in seconds (for video generation models).'),
};

/** Parsed input type for the `grok_estimate_cost` tool. */
export type GrokEstimateCostInput = {
  model: string;
  input_tokens?: number;
  output_tokens?: number;
  image_count?: number;
  video_seconds?: number;
};
