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

  it('defaults the backend to api', () => {
    expect(loadConfig({ XAI_API_KEY: 'xai-test' }).backend).toBe('api');
  });

  it('does not require XAI_API_KEY when backend is cli', () => {
    const config = loadConfig({ XAI_BACKEND: 'cli' });
    expect(config.backend).toBe('cli');
    expect(config.apiKey).toBe('');
    expect(config.grokBin).toBe('grok');
  });

  it('honors GROK_BIN and GROK_CLI_MODEL', () => {
    const config = loadConfig({
      XAI_BACKEND: 'cli',
      GROK_BIN: '/opt/grok/bin/grok',
      GROK_CLI_MODEL: 'grok-4.5',
    });
    expect(config.grokBin).toBe('/opt/grok/bin/grok');
    expect(config.cliDefaultModel).toBe('grok-4.5');
  });

  it('accepts case-insensitive backend values', () => {
    expect(loadConfig({ XAI_BACKEND: '  CLI ' }).backend).toBe('cli');
    expect(loadConfig({ XAI_API_KEY: 'k', XAI_BACKEND: 'API' }).backend).toBe('api');
  });

  it('throws on an invalid backend', () => {
    expect(() => loadConfig({ XAI_BACKEND: 'local' })).toThrow(/Invalid XAI_BACKEND/);
  });

  it('omits cliDefaultModel when GROK_CLI_MODEL is unset', () => {
    expect(loadConfig({ XAI_BACKEND: 'cli' }).cliDefaultModel).toBeUndefined();
  });
});
