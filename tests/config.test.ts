import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('returns defaults when only XAI_API_KEY is set', () => {
    const config = loadConfig({ XAI_API_KEY: 'xai-test' });
    expect(config.apiKey).toBe('xai-test');
    expect(config.baseUrl).toBe('https://api.x.ai/v1');
    expect(config.defaultModel).toBe('grok-4.3');
    expect(config.timeoutMs).toBe(120_000);
    expect(config.maxImageBytes).toBe(20 * 1024 * 1024);
    expect(config.maxVideoBytes).toBe(50 * 1024 * 1024);
  });

  it('trims whitespace from values', () => {
    const config = loadConfig({
      XAI_API_KEY: '  xai-spaced  ',
      XAI_BASE_URL: '  https://custom.example/v1  ',
      XAI_DEFAULT_MODEL: '  grok-4-1-fast  ',
    });
    expect(config.apiKey).toBe('xai-spaced');
    expect(config.baseUrl).toBe('https://custom.example/v1');
    expect(config.defaultModel).toBe('grok-4-1-fast');
  });

  it('honors numeric overrides', () => {
    const config = loadConfig({
      XAI_API_KEY: 'xai-test',
      XAI_TIMEOUT_MS: '5000',
      XAI_MAX_IMAGE_MB: '10',
      XAI_MAX_VIDEO_MB: '100',
    });
    expect(config.timeoutMs).toBe(5000);
    expect(config.maxImageBytes).toBe(10 * 1024 * 1024);
    expect(config.maxVideoBytes).toBe(100 * 1024 * 1024);
  });

  it('falls back to defaults on invalid numeric input', () => {
    const config = loadConfig({
      XAI_API_KEY: 'xai-test',
      XAI_TIMEOUT_MS: 'not-a-number',
      XAI_MAX_IMAGE_MB: '-5',
      XAI_MAX_VIDEO_MB: '0',
    });
    expect(config.timeoutMs).toBe(120_000);
    expect(config.maxImageBytes).toBe(20 * 1024 * 1024);
    expect(config.maxVideoBytes).toBe(50 * 1024 * 1024);
  });

  it('throws a helpful error when XAI_API_KEY is missing', () => {
    expect(() => loadConfig({})).toThrow(/XAI_API_KEY is not set/);
  });

  it('throws when XAI_API_KEY is whitespace only', () => {
    expect(() => loadConfig({ XAI_API_KEY: '   ' })).toThrow(/XAI_API_KEY is not set/);
  });
});
