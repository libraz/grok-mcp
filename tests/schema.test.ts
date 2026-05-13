import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  grokAskInputSchema,
  grokEstimateCostInputSchema,
  grokGenerateImageInputSchema,
  grokGenerateVideoInputSchema,
  grokVideoStatusInputSchema,
} from '../src/schema.js';

const askObj = z.object(grokAskInputSchema);
const imageObj = z.object(grokGenerateImageInputSchema);
const videoObj = z.object(grokGenerateVideoInputSchema);
const statusObj = z.object(grokVideoStatusInputSchema);
const costObj = z.object(grokEstimateCostInputSchema);

describe('grok_ask schema', () => {
  it('accepts a minimal prompt', () => {
    expect(askObj.parse({ prompt: 'hi' })).toMatchObject({ prompt: 'hi' });
  });

  it('rejects empty prompt', () => {
    expect(() => askObj.parse({ prompt: '' })).toThrow();
  });

  it('accepts the four search values', () => {
    for (const search of [true, false, 'x', 'web', 'both'] as const) {
      expect(askObj.parse({ prompt: 'q', search }).search).toBe(search);
    }
  });

  it('rejects invalid search values', () => {
    expect(() => askObj.parse({ prompt: 'q', search: 'twitter' })).toThrow();
  });

  it('rejects temperature out of range', () => {
    expect(() => askObj.parse({ prompt: 'q', temperature: 3 })).toThrow();
    expect(() => askObj.parse({ prompt: 'q', temperature: -1 })).toThrow();
  });
});

describe('grok_imagine_image schema', () => {
  it('accepts a minimal prompt', () => {
    expect(imageObj.parse({ prompt: 'a cat' }).prompt).toBe('a cat');
  });

  it('rejects n out of range', () => {
    expect(() => imageObj.parse({ prompt: 'x', n: 0 })).toThrow();
    expect(() => imageObj.parse({ prompt: 'x', n: 11 })).toThrow();
  });

  it('rejects more than three source images', () => {
    expect(() =>
      imageObj.parse({
        prompt: 'edit',
        source_images: ['a', 'b', 'c', 'd'],
      }),
    ).toThrow();
  });

  it('accepts allowed aspect ratios only', () => {
    expect(imageObj.parse({ prompt: 'x', aspect_ratio: '16:9' }).aspect_ratio).toBe('16:9');
    expect(() => imageObj.parse({ prompt: 'x', aspect_ratio: '7:5' })).toThrow();
  });
});

describe('grok_imagine_video schema', () => {
  it('rejects duration outside 1-15', () => {
    expect(() => videoObj.parse({ prompt: 'x', duration: 0 })).toThrow();
    expect(() => videoObj.parse({ prompt: 'x', duration: 16 })).toThrow();
  });

  it('accepts known resolutions only', () => {
    expect(videoObj.parse({ prompt: 'x', resolution: '720p' }).resolution).toBe('720p');
    expect(() => videoObj.parse({ prompt: 'x', resolution: '1080p' })).toThrow();
  });
});

describe('grok_imagine_video_status schema', () => {
  it('requires a non-empty request_id', () => {
    expect(statusObj.parse({ request_id: 'abc' }).request_id).toBe('abc');
    expect(() => statusObj.parse({ request_id: '' })).toThrow();
  });
});

describe('grok_estimate_cost schema', () => {
  it('requires model', () => {
    expect(() => costObj.parse({})).toThrow();
  });

  it('rejects negative numbers', () => {
    expect(() => costObj.parse({ model: 'm', input_tokens: -1 })).toThrow();
    expect(() => costObj.parse({ model: 'm', video_seconds: -0.5 })).toThrow();
  });

  it('accepts all optional fields', () => {
    const parsed = costObj.parse({
      model: 'grok-4.3',
      input_tokens: 100,
      output_tokens: 50,
      image_count: 2,
      video_seconds: 3,
    });
    expect(parsed.model).toBe('grok-4.3');
    expect(parsed.input_tokens).toBe(100);
  });
});
