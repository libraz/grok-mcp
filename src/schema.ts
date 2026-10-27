import { z } from 'zod';
import {
  IMAGE_QUALITIES,
  IMAGE_RESOLUTIONS,
  type ImageQuality,
  type ImageResolution,
  VIDEO_RESOLUTIONS,
  type VideoResolution,
} from './pricing.js';

/** Zod input schema for the `grok_ask` tool. Pass to `McpServer.registerTool`. */
export const grokAskInputSchema = {
  prompt: z.string().min(1).describe('User prompt sent to Grok.'),
  images: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Optional images. Each item is a local file path, an http(s) URL, or a data URI. ' +
        'Formats: jpg/jpeg or png. Local files are capped by XAI_MAX_IMAGE_MB (default 20MiB).',
    ),
  model: z
    .string()
    .optional()
    .describe(
      'xAI model ID. Use `grok_list_models` to discover live model IDs. ' +
        'Falls back to env XAI_DEFAULT_MODEL or grok-4.7.',
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
        '`true` or `"both"` enables both. With the cli backend X search is unavailable: ' +
        '`"x"` is rejected and `true` / `"both"` run web search only.',
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

/** Aspect ratios accepted by the image generation / edit endpoints. */
const IMAGE_ASPECT_RATIOS = [
  '1:1',
  '3:4',
  '4:3',
  '9:16',
  '16:9',
  '2:3',
  '3:2',
  '9:19.5',
  '19.5:9',
  '9:20',
  '20:9',
  '1:2',
  '2:1',
  '21:9',
  '5:2',
  'auto',
] as const;

/** Zod input schema for the `grok_imagine_image` tool. */
export const grokGenerateImageInputSchema = {
  prompt: z
    .string()
    .min(1)
    .describe(
      'Text description of the image to generate. When editing, refer to individual source ' +
        'images as <IMAGE_0>, <IMAGE_1>, … in the order they were passed.',
    ),
  model: z
    .string()
    .optional()
    .describe(
      'Image generation model. One of: grok-imagine-image ($0.02/img), ' +
        'grok-imagine-image-2.0 ($0.04-$0.08/img by resolution and quality), ' +
        'grok-imagine-image-quality ($0.05-$0.07/img; retired on 2026-11-02, after which ' +
        'xAI serves it with grok-imagine-image-2.0 at low quality). ' +
        'Defaults to grok-imagine-image-2.0.',
    ),
  n: z.number().int().min(1).max(10).optional().describe('Number of images (1-10). Defaults to 1.'),
  aspect_ratio: z
    .enum(IMAGE_ASPECT_RATIOS)
    .optional()
    .describe(
      'Aspect ratio of the generated image. Defaults to `auto`, which lets the model pick; ' +
        'when editing, the output follows the first source image unless this is set.',
    ),
  resolution: z
    .enum(IMAGE_RESOLUTIONS)
    .optional()
    .describe('Output resolution of the generated image. Defaults to 1k.'),
  quality: z
    .enum(IMAGE_QUALITIES)
    .optional()
    .describe(
      'Rendering quality. Only supported by grok-imagine-image-2.0. Defaults to `auto`, ' +
        'which renders at low quality for generation and medium for editing.',
    ),
  source_images: z
    .array(z.string().min(1))
    .max(5)
    .optional()
    .describe(
      'Optional source images for editing (up to 5), each a local file path, an http(s) URL, ' +
        'or a data URI (jpg/jpeg, png or webp). When provided, the /v1/images/edits endpoint ' +
        'is used instead of /v1/images/generations, and each source image is billed at the ' +
        "model's per-input-image rate.",
    ),
};

/** Parsed input type for the `grok_imagine_image` tool. */
export type GrokGenerateImageInput = {
  prompt: string;
  model?: string;
  n?: number;
  aspect_ratio?: (typeof IMAGE_ASPECT_RATIOS)[number];
  resolution?: ImageResolution;
  quality?: ImageQuality;
  source_images?: string[];
};

/** Aspect ratios accepted by the video generation endpoint. */
const VIDEO_ASPECT_RATIOS = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '21:9',
  '5:2',
] as const;

/** Zod input schema for the `grok_imagine_video` tool. */
export const grokGenerateVideoInputSchema = {
  prompt: z
    .string()
    .min(1)
    .describe(
      'Text description of the video to generate. With `image` set, describe how the still ' +
        'should be animated.',
    ),
  model: z
    .string()
    .optional()
    .describe(
      'Video generation model. One of: grok-imagine-video ($0.05-$0.07/sec, up to 720p), ' +
        'grok-imagine-video-1.5 ($0.08-$0.25/sec), grok-imagine-video-1.5-lite ' +
        '($0.02-$0.14/sec, 1080p upscaled from 720p). Rates rise with resolution. ' +
        'Defaults to grok-imagine-video-1.5.',
    ),
  image: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Optional source still to animate (image-to-video): a local file path, an http(s) URL, ' +
        'or a data URI (jpg/jpeg, png or webp). A local file is capped by XAI_MAX_IMAGE_MB. ' +
        'Omit for text-to-video.',
    ),
  duration: z
    .number()
    .int()
    .min(1)
    .max(15)
    .optional()
    .describe('Duration in seconds (1-15). Defaults to 8.'),
  aspect_ratio: z
    .enum(VIDEO_ASPECT_RATIOS)
    .optional()
    .describe(
      'Aspect ratio. Defaults to 16:9. Ignored for image-to-video, whose output follows the still.',
    ),
  resolution: z
    .enum(VIDEO_RESOLUTIONS)
    .optional()
    .describe('Output resolution. Defaults to 480p; grok-imagine-video supports up to 720p.'),
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
  image?: string;
  duration?: number;
  aspect_ratio?: (typeof VIDEO_ASPECT_RATIOS)[number];
  resolution?: VideoResolution;
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
  input_tokens: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      'Estimated input tokens, cached ones included. At 200,000 or more the whole request ' +
        "bills at the model's long-context rates, which the estimate applies.",
    ),
  output_tokens: z.number().int().nonnegative().optional().describe('Estimated output tokens.'),
  cached_input_tokens: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      'Portion of input_tokens served from the prompt cache, billed at the cheaper cached rate.',
    ),
  image_count: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Number of images to generate (for image generation models). Defaults to 1.'),
  source_image_count: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      'Number of source images passed in: the sources of an image edit, or the still of an ' +
        'image-to-video request. They bill at the per-input-image rate, so include them here.',
    ),
  video_seconds: z
    .number()
    .nonnegative()
    .optional()
    .describe('Video length in seconds (for video generation models). Defaults to 8.'),
  resolution: z
    .enum([...IMAGE_RESOLUTIONS, ...VIDEO_RESOLUTIONS])
    .optional()
    .describe(
      'Output resolution: 1k / 2k for image models (default 1k), 480p / 720p / 1080p for ' +
        'video models (default 480p). Rates rise with resolution.',
    ),
  quality: z
    .enum(IMAGE_QUALITIES)
    .optional()
    .describe(
      'Rendering quality, for grok-imagine-image-2.0. Defaults to `auto`: low for generation, ' +
        'medium for editing.',
    ),
};

/** Parsed input type for the `grok_estimate_cost` tool. */
export type GrokEstimateCostInput = {
  model: string;
  input_tokens?: number;
  output_tokens?: number;
  cached_input_tokens?: number;
  image_count?: number;
  source_image_count?: number;
  video_seconds?: number;
  resolution?: ImageResolution | VideoResolution;
  quality?: ImageQuality;
};
