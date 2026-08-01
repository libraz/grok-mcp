import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Package version, read from `package.json` at runtime so the CLI's `--version`
 * output and the MCP `serverInfo.version` can never drift from the published
 * version. Resolves to `<package root>/package.json` both from `dist/` and from
 * `src/` (tests), since both live one level below the package root.
 */
export const PACKAGE_VERSION: string = (require('../package.json') as { version: string }).version;
