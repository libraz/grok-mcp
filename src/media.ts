import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import mime from 'mime-types';

/** Kind of media a caller is resolving. Only `image` is supported today. */
export type MediaKind = 'image';

/** Result of resolving a media reference into a form xAI's Responses API accepts. */
export type ResolvedMedia = {
  /**
   * Value suitable for the `image_url` field of an xAI `input_image` content part.
   * Either an http(s) URL, an opaque data URI passed through verbatim, or a freshly
   * base64-encoded data URI built from a local file.
   */
  url: string;
  /** MIME type when the input was a local file, undefined for URLs / opaque data URIs. */
  mimeType?: string;
};

const SUPPORTED_IMAGE_MIME = new Set(['image/jpeg', 'image/png']);

const isHttpUrl = (s: string): boolean => /^https?:\/\//i.test(s);
const isDataUri = (s: string): boolean => /^data:/i.test(s);

const toDataUri = (mimeType: string, buf: Buffer): string =>
  `data:${mimeType};base64,${buf.toString('base64')}`;

/**
 * Resolve a single media reference into something the xAI Responses API can ingest.
 *
 * - http(s) URLs and `data:` URIs are returned unchanged.
 * - Anything else is treated as a local filesystem path: validated for existence,
 *   size (≤ `maxBytes`), and MIME type (jpg/jpeg/png only), then base64-encoded
 *   into a data URI.
 *
 * @param input The reference to resolve.
 * @param kind  Media kind, used only for error messages today.
 * @param maxBytes Maximum file size in bytes.
 * @returns A {@link ResolvedMedia} ready to attach to an `input_image` content part.
 * @throws {Error} When the local file is missing, too large, or has an unsupported MIME type.
 */
export const resolveMedia = async (
  input: string,
  kind: MediaKind,
  maxBytes: number,
): Promise<ResolvedMedia> => {
  if (isHttpUrl(input) || isDataUri(input)) {
    return { url: input };
  }

  const path = resolve(input);
  const stats = await stat(path).catch(() => null);
  if (!stats?.isFile()) {
    throw new Error(`File not found: ${input}`);
  }
  if (stats.size > maxBytes) {
    const mb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
    throw new Error(
      `${kind} too large: ${input} (${stats.size} bytes > ${mb}MB limit). ` +
        `Pass an http(s) URL instead, or raise XAI_MAX_${kind.toUpperCase()}_MB.`,
    );
  }

  const mimeType = mime.lookup(path) || 'image/png';
  if (!SUPPORTED_IMAGE_MIME.has(mimeType)) {
    throw new Error(
      `Unsupported image MIME type: ${mimeType} (${input}). xAI accepts jpg/jpeg or png.`,
    );
  }

  const buf = await readFile(path);
  return { url: toDataUri(mimeType, buf), mimeType };
};

/**
 * Resolve an array of media references in parallel.
 *
 * Returns an empty array when `inputs` is undefined or empty. Any individual
 * resolution failure rejects the whole batch.
 */
export const resolveAllMedia = async (
  inputs: string[] | undefined,
  kind: MediaKind,
  maxBytes: number,
): Promise<ResolvedMedia[]> => {
  if (!inputs || inputs.length === 0) {
    return [];
  }
  return Promise.all(inputs.map((i) => resolveMedia(i, kind, maxBytes)));
};
