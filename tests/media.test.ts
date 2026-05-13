import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveAllMedia, resolveMedia } from '../src/media.js';

const MAX = 20 * 1024 * 1024;

describe('resolveMedia', () => {
  let dir: string;
  let pngPath: string;
  let jpgPath: string;
  let txtPath: string;
  let bigPath: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'grok-mcp-test-'));
    pngPath = join(dir, 'sample.png');
    jpgPath = join(dir, 'sample.jpg');
    txtPath = join(dir, 'sample.txt');
    bigPath = join(dir, 'too-big.png');
    await writeFile(pngPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(jpgPath, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    await writeFile(txtPath, 'hello');
    await writeFile(bigPath, Buffer.alloc(1024));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('passes http URLs through untouched', async () => {
    const r = await resolveMedia('https://example.com/cat.png', 'image', MAX);
    expect(r.url).toBe('https://example.com/cat.png');
    expect(r.mimeType).toBeUndefined();
  });

  it('passes data URIs through untouched', async () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgo=';
    const r = await resolveMedia(dataUri, 'image', MAX);
    expect(r.url).toBe(dataUri);
  });

  it('encodes a local PNG as a data URI', async () => {
    const r = await resolveMedia(pngPath, 'image', MAX);
    expect(r.mimeType).toBe('image/png');
    expect(r.url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('encodes a local JPEG as a data URI', async () => {
    const r = await resolveMedia(jpgPath, 'image', MAX);
    expect(r.mimeType).toBe('image/jpeg');
    expect(r.url.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('rejects unsupported MIME types', async () => {
    await expect(resolveMedia(txtPath, 'image', MAX)).rejects.toThrow(/Unsupported image MIME/);
  });

  it('rejects files that exceed the size limit', async () => {
    await expect(resolveMedia(bigPath, 'image', 100)).rejects.toThrow(/too large/);
  });

  it('rejects missing files', async () => {
    await expect(resolveMedia('/no/such/path.png', 'image', MAX)).rejects.toThrow(/File not found/);
  });
});

describe('resolveAllMedia', () => {
  it('returns an empty array for undefined input', async () => {
    expect(await resolveAllMedia(undefined, 'image', MAX)).toEqual([]);
  });

  it('returns an empty array for empty input', async () => {
    expect(await resolveAllMedia([], 'image', MAX)).toEqual([]);
  });

  it('resolves multiple inputs in parallel', async () => {
    const r = await resolveAllMedia(
      ['https://a.example/1.png', 'https://b.example/2.png'],
      'image',
      MAX,
    );
    expect(r).toHaveLength(2);
    expect(r[0]?.url).toBe('https://a.example/1.png');
    expect(r[1]?.url).toBe('https://b.example/2.png');
  });
});
