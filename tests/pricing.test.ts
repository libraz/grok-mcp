import { describe, expect, it } from 'vitest';
import { estimateCost, MODEL_PRICING } from '../src/pricing.js';

describe('estimateCost', () => {
  it('computes text-model cost for grok-4.3', () => {
    const r = estimateCost({
      model: 'grok-4.3',
      inputTokens: 1_000_000,
      outputTokens: 500_000,
    });
    expect(r.knownPricing).toBe(true);
    expect(r.costUsd).toBeCloseTo(1.25 + 0.5 * 2.5, 6);
    expect(r.breakdown).toHaveLength(2);
    expect(r.notes[0]).toMatch(/Pricing snapshot/);
  });

  it('computes text-model cost for the cheaper grok-4-1-fast tier', () => {
    const r = estimateCost({
      model: 'grok-4-1-fast-non-reasoning',
      inputTokens: 10_000,
      outputTokens: 2_000,
    });
    expect(r.knownPricing).toBe(true);
    expect(r.costUsd).toBeCloseTo((10_000 / 1_000_000) * 0.2 + (2_000 / 1_000_000) * 0.5, 8);
  });

  it('treats missing token counts as zero', () => {
    const r = estimateCost({ model: 'grok-4.3' });
    expect(r.costUsd).toBe(0);
    expect(r.breakdown[0]).toMatch(/input: 0 tokens/);
  });

  it('computes image-gen cost with default n=1', () => {
    const r = estimateCost({ model: 'grok-imagine-image-quality' });
    expect(r.knownPricing).toBe(true);
    expect(r.costUsd).toBeCloseTo(0.05, 6);
  });

  it('computes image-gen cost for multiple images', () => {
    const r = estimateCost({ model: 'grok-imagine-image-pro', imageCount: 4 });
    expect(r.costUsd).toBeCloseTo(0.07 * 4, 6);
  });

  it('computes video-gen cost by seconds', () => {
    const r = estimateCost({ model: 'grok-imagine-video', videoSeconds: 10 });
    expect(r.costUsd).toBeCloseTo(0.05 * 10, 6);
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
});
