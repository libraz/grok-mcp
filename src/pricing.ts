/**
 * Static pricing table derived from xAI's public docs (https://docs.x.ai/developers/models).
 * Values are USD. Keep in sync with the docs page; treat as best-effort and surface a notice
 * in the response so callers can verify current pricing themselves.
 */

/** USD pricing for a text/chat model. */
export type TokenPricing = {
  /** USD per 1,000,000 input tokens. */
  inputPerMillion: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMillion: number;
  /** Context window in tokens. Informational; not used in cost math. */
  contextTokens: number;
};

/** USD pricing for an image-generation model. */
export type ImageGenPricing = {
  /** USD per generated image. */
  perImage: number;
};

/** USD pricing for a video-generation model. */
export type VideoGenPricing = {
  /** USD per second of generated video. */
  perSecond: number;
};

/** Discriminated union of all supported pricing shapes. */
export type ModelPricing =
  | ({ kind: 'text' } & TokenPricing)
  | ({ kind: 'image-gen' } & ImageGenPricing)
  | ({ kind: 'video-gen' } & VideoGenPricing);

/** ISO date on which the embedded pricing table was last reconciled with xAI docs. */
export const PRICING_LAST_VERIFIED = '2026-08-01';

/**
 * Prompt size, in tokens, at which xAI switches a request to long-context rates.
 * Once the prompt reaches it, every token of the request bills at the higher tier.
 */
export const LONG_CONTEXT_THRESHOLD_TOKENS = 200_000;

/**
 * Standard-tier rates. Text models also have a long-context tier (see
 * {@link LONG_CONTEXT_THRESHOLD_TOKENS}) that is roughly double these numbers;
 * estimates always use the standard tier and say so in their notes.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'grok-4.5': {
    kind: 'text',
    inputPerMillion: 2.0,
    outputPerMillion: 6.0,
    contextTokens: 500_000,
  },
  'grok-4.3': {
    kind: 'text',
    inputPerMillion: 1.25,
    outputPerMillion: 2.5,
    contextTokens: 1_000_000,
  },
  'grok-4.20-0309-reasoning': {
    kind: 'text',
    inputPerMillion: 1.25,
    outputPerMillion: 2.5,
    contextTokens: 1_000_000,
  },
  'grok-4.20-0309-non-reasoning': {
    kind: 'text',
    inputPerMillion: 1.25,
    outputPerMillion: 2.5,
    contextTokens: 1_000_000,
  },
  'grok-4.20-multi-agent-0309': {
    kind: 'text',
    inputPerMillion: 1.25,
    outputPerMillion: 2.5,
    contextTokens: 1_000_000,
  },
  'grok-build-0.1': {
    kind: 'text',
    inputPerMillion: 1.0,
    outputPerMillion: 2.0,
    contextTokens: 256_000,
  },
  'grok-imagine-image': { kind: 'image-gen', perImage: 0.02 },
  'grok-imagine-image-quality': { kind: 'image-gen', perImage: 0.05 },
  'grok-imagine-video': { kind: 'video-gen', perSecond: 0.05 },
  'grok-imagine-video-1.5': { kind: 'video-gen', perSecond: 0.08 },
};

/** Input to {@link estimateCost}. Only the fields relevant to the model's kind are used. */
export type EstimateInput = {
  /** xAI model ID. */
  model: string;
  /** Input tokens, for text models. */
  inputTokens?: number;
  /** Output tokens, for text models. */
  outputTokens?: number;
  /** Number of images, for image-generation models. */
  imageCount?: number;
  /** Video length in seconds, for video-generation models. */
  videoSeconds?: number;
};

/** Output of {@link estimateCost}. */
export type EstimateResult = {
  /** Echoes the requested model ID. */
  model: string;
  /** True when the static pricing table covers `model`. */
  knownPricing: boolean;
  /** Estimated total cost in USD, rounded to 6 decimal places. */
  costUsd: number;
  /** Human-readable per-line breakdown of the calculation. */
  breakdown: string[];
  /** Caveats and reminders to surface to the caller. */
  notes: string[];
};

const round = (n: number, digits = 6): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/**
 * Estimate the USD cost of an xAI API call against the embedded static pricing table.
 *
 * Always succeeds: unknown models return `knownPricing: false` with a `costUsd` of 0
 * and a note pointing to `grok_list_models`. The result includes a "verify pricing at
 * docs.x.ai" note in every case — the table is a snapshot and may drift.
 */
export const estimateCost = (input: EstimateInput): EstimateResult => {
  const pricing = MODEL_PRICING[input.model];
  const notes: string[] = [
    `Pricing snapshot last verified ${PRICING_LAST_VERIFIED}. Verify current rates at https://docs.x.ai/developers/models before relying on this estimate.`,
  ];

  if (!pricing) {
    return {
      model: input.model,
      knownPricing: false,
      costUsd: 0,
      breakdown: [],
      notes: [
        `Unknown model "${input.model}". No pricing on file. Use grok_list_models to see live model IDs.`,
        ...notes,
      ],
    };
  }

  const breakdown: string[] = [];
  let total = 0;

  if (pricing.kind === 'text') {
    const inTok = input.inputTokens ?? 0;
    const outTok = input.outputTokens ?? 0;
    notes.push(
      `Standard-tier rates. Prompts of ${LONG_CONTEXT_THRESHOLD_TOKENS.toLocaleString()} tokens or more bill at xAI's long-context rates (about double), which this estimate does not apply.`,
    );
    const inCost = (inTok / 1_000_000) * pricing.inputPerMillion;
    const outCost = (outTok / 1_000_000) * pricing.outputPerMillion;
    total = inCost + outCost;
    breakdown.push(
      `input: ${inTok.toLocaleString()} tokens × $${pricing.inputPerMillion}/M = $${round(inCost)}`,
      `output: ${outTok.toLocaleString()} tokens × $${pricing.outputPerMillion}/M = $${round(outCost)}`,
    );
    if (input.imageCount !== undefined && input.imageCount > 0) {
      notes.push(
        `imageCount=${input.imageCount} provided but ${input.model} is a chat model; image input tokens are counted as part of inputTokens by xAI.`,
      );
    }
    if (input.videoSeconds !== undefined && input.videoSeconds > 0) {
      notes.push(
        `videoSeconds=${input.videoSeconds} provided but ${input.model} is a chat model; ignored.`,
      );
    }
  } else if (pricing.kind === 'image-gen') {
    const n = input.imageCount ?? 1;
    total = n * pricing.perImage;
    breakdown.push(`images: ${n} × $${pricing.perImage}/image = $${round(total)}`);
  } else {
    const secs = input.videoSeconds ?? 0;
    total = secs * pricing.perSecond;
    breakdown.push(`video: ${secs}s × $${pricing.perSecond}/s = $${round(total)}`);
  }

  return {
    model: input.model,
    knownPricing: true,
    costUsd: round(total),
    breakdown,
    notes,
  };
};
