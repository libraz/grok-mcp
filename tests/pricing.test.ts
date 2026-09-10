import { describe, expect, it } from 'vitest';
import { estimateCost, MODEL_PRICING } from '../src/pricing.js';

describe('estimateCost', () => {
  it('computes text-model cost for grok-4.3', () => {
    const r = estimateCost({
      model: 'grok-4.3',
      inputTokens: 100_000,
      outputTokens: 50_000,
    });
    expect(r.knownPricing).toBe(true);
    expect(r.tier).toBe('standard');
    expect(r.costUsd).toBeCloseTo(0.1 * 1.25 + 0.05 * 2.5, 6);
    expect(r.breakdown).toHaveLength(2);
    expect(r.notes[0]).toMatch(/Pricing snapshot/);
  });

  it('computes text-model cost for grok-4.6', () => {
    const r = estimateCost({
      model: 'grok-4.6',
      inputTokens: 10_000,
      outputTokens: 2_000,
    });
    expect(r.knownPricing).toBe(true);
    expect(r.costUsd).toBeCloseTo((10_000 / 1_000_000) * 2.0 + (2_000 / 1_000_000) * 6.0, 8);
  });

  it('computes text-model cost for grok-4.5', () => {
    const r = estimateCost({
      model: 'grok-4.5',
      inputTokens: 10_000,
      outputTokens: 2_000,
    });
    expect(r.knownPricing).toBe(true);
    expect(r.costUsd).toBeCloseTo((10_000 / 1_000_000) * 2.0 + (2_000 / 1_000_000) * 6.0, 8);
  });

  it('bills the whole request at long-context rates past the threshold', () => {
    const r = estimateCost({ model: 'grok-4.5', inputTokens: 300_000, outputTokens: 1_000 });
    expect(r.tier).toBe('long-context');
    expect(r.costUsd).toBeCloseTo(0.3 * 4.0 + 0.001 * 12.0, 6);
    expect(r.notes.some((n) => n.includes('long-context'))).toBe(true);
  });

  it('bills cached input tokens at the cached rate', () => {
    const r = estimateCost({
      model: 'grok-4.6',
      inputTokens: 100_000,
      cachedInputTokens: 80_000,
      outputTokens: 1_000,
    });
    expect(r.costUsd).toBeCloseTo(0.02 * 2.0 + 0.08 * 0.5 + 0.001 * 6.0, 6);
    expect(r.breakdown.some((b) => b.startsWith('cached input:'))).toBe(true);
  });

  it('caps cached input tokens at the input total', () => {
    const r = estimateCost({
      model: 'grok-4.6',
      inputTokens: 1_000,
      cachedInputTokens: 5_000,
    });
    expect(r.costUsd).toBeCloseTo(0.001 * 0.5, 6);
    expect(r.notes.some((n) => n.includes('exceeds inputTokens'))).toBe(true);
  });

  it('treats missing token counts as zero', () => {
    const r = estimateCost({ model: 'grok-4.3' });
    expect(r.costUsd).toBe(0);
    expect(r.breakdown[0]).toMatch(/input: 0 tokens/);
  });

  it('computes image-gen cost with default n=1', () => {
    const r = estimateCost({ model: 'grok-imagine-image-quality' });
    expect(r.knownPricing).toBe(true);
    expect(r.tier).toBeUndefined();
    expect(r.costUsd).toBeCloseTo(0.05, 6);
  });

  it('computes image-gen cost for the 2.0 model', () => {
    const r = estimateCost({ model: 'grok-imagine-image-2.0', imageCount: 3 });
    expect(r.costUsd).toBeCloseTo(0.04 * 3, 6);
  });

  it('computes image-gen cost for multiple images', () => {
    const r = estimateCost({ model: 'grok-imagine-image', imageCount: 4 });
    expect(r.costUsd).toBeCloseTo(0.02 * 4, 6);
  });

  it('bills source images alongside the generated ones', () => {
    const r = estimateCost({
      model: 'grok-imagine-image-2.0',
      imageCount: 2,
      sourceImageCount: 3,
    });
    expect(r.costUsd).toBeCloseTo(0.04 * 5, 6);
    expect(r.breakdown).toEqual([
      'generated images: 2 × $0.04/image = $0.08',
      'source images: 3 × $0.04/image = $0.12',
    ]);
    expect(r.notes.some((n) => n.includes('both sides'))).toBe(true);
  });

  it('prompts for sourceImageCount when it is omitted', () => {
    const r = estimateCost({ model: 'grok-imagine-image-2.0', imageCount: 1 });
    expect(r.costUsd).toBeCloseTo(0.04, 6);
    expect(r.breakdown).toHaveLength(1);
    expect(r.notes.some((n) => n.includes('pass sourceImageCount'))).toBe(true);
  });

  it('treats sourceImageCount=0 as a plain generation', () => {
    const r = estimateCost({
      model: 'grok-imagine-image-2.0',
      imageCount: 1,
      sourceImageCount: 0,
    });
    expect(r.costUsd).toBeCloseTo(0.04, 6);
    expect(r.breakdown).toHaveLength(1);
  });

  it('computes video-gen cost for the 1.5 model', () => {
    const r = estimateCost({ model: 'grok-imagine-video-1.5', videoSeconds: 10 });
    expect(r.costUsd).toBeCloseTo(0.08 * 10, 6);
    expect(r.notes.some((n) => n.includes('videoSeconds was not provided'))).toBe(false);
  });

  it('computes video-gen cost by seconds', () => {
    const r = estimateCost({ model: 'grok-imagine-video', videoSeconds: 10 });
    expect(r.costUsd).toBeCloseTo(0.05 * 10, 6);
  });

  it('warns instead of silently estimating $0 when videoSeconds is missing', () => {
    const r = estimateCost({ model: 'grok-imagine-video-1.5' });
    expect(r.costUsd).toBe(0);
    expect(r.notes.some((n) => n.includes('videoSeconds was not provided'))).toBe(true);
  });

  it('flags unknown models without throwing', () => {
    const r = estimateCost({ model: 'grok-unknown-vNext', inputTokens: 1000 });
    expect(r.knownPricing).toBe(false);
    expect(r.costUsd).toBe(0);
    expect(r.notes.some((n) => n.includes('Unknown model'))).toBe(true);
  });

  it('notes that imageCount/videoSeconds are ignored on chat models', () => {
    const r = estimateCost({
      model: 'grok-4.3',
      inputTokens: 100,
      outputTokens: 50,
      imageCount: 3,
      videoSeconds: 7,
    });
    expect(r.notes.some((n) => n.includes('image input tokens are counted'))).toBe(true);
    expect(r.notes.some((n) => n.includes('videoSeconds=7'))).toBe(true);
  });

  it('exposes a non-empty static pricing table', () => {
    expect(Object.keys(MODEL_PRICING).length).toBeGreaterThanOrEqual(8);
  });

  it('carries the published rates for grok-4.6', () => {
    const p = MODEL_PRICING['grok-4.6'];
    expect(p).toMatchObject({
      kind: 'text',
      contextTokens: 500_000,
      inputPerMillion: 2.0,
      cachedInputPerMillion: 0.5,
      outputPerMillion: 6.0,
      longContext: { inputPerMillion: 4.0, cachedInputPerMillion: 1.0, outputPerMillion: 12.0 },
    });
  });

  it('never prices a long-context tier below its standard tier', () => {
    for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
      if (pricing.kind !== 'text') {
        continue;
      }
      expect(pricing.longContext.inputPerMillion, model).toBeGreaterThanOrEqual(
        pricing.inputPerMillion,
      );
      expect(pricing.longContext.outputPerMillion, model).toBeGreaterThanOrEqual(
        pricing.outputPerMillion,
      );
      expect(pricing.longContext.cachedInputPerMillion, model).toBeGreaterThanOrEqual(
        pricing.cachedInputPerMillion,
      );
      expect(pricing.cachedInputPerMillion, model).toBeLessThan(pricing.inputPerMillion);
    }
  });
});
