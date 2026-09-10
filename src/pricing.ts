/**
 * Static pricing table derived from xAI's public docs (https://docs.x.ai/developers/models).
 * Values are USD. Keep in sync with the docs page; treat as best-effort and surface a notice
 * in the response so callers can verify current pricing themselves.
 */

/** USD rates for one billing tier of a text/chat model. */
export type TokenRates = {
  /** USD per 1,000,000 input tokens that were not served from the prompt cache. */
  inputPerMillion: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMillion: number;
  /** USD per 1,000,000 input tokens served from the prompt cache. */
  cachedInputPerMillion: number;
};

/** USD pricing for a text/chat model, across both prompt-size tiers. */
export type TokenPricing = TokenRates & {
  /** Context window in tokens. Informational; not used in cost math. */
  contextTokens: number;
  /** Rates applied once the prompt reaches {@link LONG_CONTEXT_THRESHOLD_TOKENS}. */
  longContext: TokenRates;
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
export const PRICING_LAST_VERIFIED = '2026-09-10';

/**
 * Prompt size, in tokens, at which xAI switches a request to long-context rates.
 * Once the prompt reaches it, every token of the request bills at the higher tier.
 */
export const LONG_CONTEXT_THRESHOLD_TOKENS = 200_000;

/** Text-model rates, given as the standard tier plus its long-context counterpart. */
const textPricing = (
  contextTokens: number,
  input: number,
  output: number,
  cached: number,
  longInput: number,
  longOutput: number,
  longCached: number,
): { kind: 'text' } & TokenPricing => ({
  kind: 'text',
  contextTokens,
  inputPerMillion: input,
  outputPerMillion: output,
  cachedInputPerMillion: cached,
  longContext: {
    inputPerMillion: longInput,
    outputPerMillion: longOutput,
    cachedInputPerMillion: longCached,
  },
});

/**
 * Per-model rates. Text models bill at the standard tier until the prompt reaches
 * {@link LONG_CONTEXT_THRESHOLD_TOKENS}, from which point every token of the request
 * bills at that model's long-context rates.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'grok-4.6': textPricing(500_000, 2.0, 6.0, 0.5, 4.0, 12.0, 1.0),
  'grok-4.5': textPricing(500_000, 2.0, 6.0, 0.3, 4.0, 12.0, 0.6),
  'grok-4.3': textPricing(1_000_000, 1.25, 2.5, 0.2, 2.5, 5.0, 0.4),
  'grok-4.20-0309-reasoning': textPricing(1_000_000, 1.25, 2.5, 0.2, 2.5, 5.0, 0.4),
  'grok-4.20-0309-non-reasoning': textPricing(1_000_000, 1.25, 2.5, 0.2, 2.5, 5.0, 0.4),
  'grok-4.20-multi-agent-0309': textPricing(1_000_000, 1.25, 2.5, 0.2, 2.5, 5.0, 0.4),
  'grok-build-0.1': textPricing(256_000, 1.0, 2.0, 0.2, 2.0, 4.0, 0.4),
  'grok-imagine-image': { kind: 'image-gen', perImage: 0.02 },
  'grok-imagine-image-2.0': { kind: 'image-gen', perImage: 0.04 },
  'grok-imagine-image-quality': { kind: 'image-gen', perImage: 0.05 },
  'grok-imagine-video': { kind: 'video-gen', perSecond: 0.05 },
  'grok-imagine-video-1.5': { kind: 'video-gen', perSecond: 0.08 },
};

/** Input to {@link estimateCost}. Only the fields relevant to the model's kind are used. */
export type EstimateInput = {
  /** xAI model ID. */
  model: string;
  /** Total input tokens, for text models. Includes any cached portion. */
  inputTokens?: number;
  /** Portion of {@link inputTokens} served from the prompt cache, for text models. */
  cachedInputTokens?: number;
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
  /** Billing tier applied. Only set for text models. */
  tier?: 'standard' | 'long-context';
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
 * Text models bill per tier: a prompt of {@link LONG_CONTEXT_THRESHOLD_TOKENS} tokens or
 * more moves the whole request to the model's long-context rates, which this estimate
 * applies automatically. `cachedInputTokens` is treated as a subset of `inputTokens` —
 * pass xAI's reported usage figures straight through.
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
  let tier: EstimateResult['tier'];

  if (pricing.kind === 'text') {
    const inTok = input.inputTokens ?? 0;
    const outTok = input.outputTokens ?? 0;
    const cachedTok = Math.min(input.cachedInputTokens ?? 0, inTok);
    const uncachedTok = inTok - cachedTok;

    const isLong = inTok >= LONG_CONTEXT_THRESHOLD_TOKENS;
    tier = isLong ? 'long-context' : 'standard';
    const rates: TokenRates = isLong ? pricing.longContext : pricing;
    notes.push(
      isLong
        ? `Prompt is ${inTok.toLocaleString()} tokens, at or above the ${LONG_CONTEXT_THRESHOLD_TOKENS.toLocaleString()}-token threshold, so the whole request bills at long-context rates.`
        : `Standard-tier rates. Prompts of ${LONG_CONTEXT_THRESHOLD_TOKENS.toLocaleString()} tokens or more bill at this model's long-context rates instead.`,
    );
    if ((input.cachedInputTokens ?? 0) > inTok) {
      notes.push(
        `cachedInputTokens (${(input.cachedInputTokens ?? 0).toLocaleString()}) exceeds inputTokens; cached tokens are a subset of the input total, so it was capped at ${inTok.toLocaleString()}.`,
      );
    }

    const uncachedCost = (uncachedTok / 1_000_000) * rates.inputPerMillion;
    const cachedCost = (cachedTok / 1_000_000) * rates.cachedInputPerMillion;
    const outCost = (outTok / 1_000_000) * rates.outputPerMillion;
    total = uncachedCost + cachedCost + outCost;
    breakdown.push(
      `input: ${uncachedTok.toLocaleString()} tokens × $${rates.inputPerMillion}/M = $${round(uncachedCost)}`,
    );
    if (cachedTok > 0) {
      breakdown.push(
        `cached input: ${cachedTok.toLocaleString()} tokens × $${rates.cachedInputPerMillion}/M = $${round(cachedCost)}`,
      );
    }
    breakdown.push(
      `output: ${outTok.toLocaleString()} tokens × $${rates.outputPerMillion}/M = $${round(outCost)}`,
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
    notes.push(
      'Image edits bill per image on both sides: every source image passed in is charged alongside each generated image.',
    );
  } else {
    const secs = input.videoSeconds ?? 0;
    total = secs * pricing.perSecond;
    breakdown.push(`video: ${secs}s × $${pricing.perSecond}/s = $${round(total)}`);
  }

  return {
    model: input.model,
    knownPricing: true,
    ...(tier && { tier }),
    costUsd: round(total),
    breakdown,
    notes,
  };
};
