# grok-mcp

MCP server for the xAI Grok API. Works with Claude Code, Codex CLI, and any other [MCP](https://modelcontextprotocol.io/)-capable client.

[![CI](https://github.com/libraz/grok-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/libraz/grok-mcp/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/libraz/grok-mcp/branch/main/graph/badge.svg)](https://codecov.io/gh/libraz/grok-mcp)
[![npm version](https://img.shields.io/npm/v/grok-mcp.svg)](https://www.npmjs.com/package/grok-mcp)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Motivation

xAI does not ship an official CLI, so terminal access to Grok means calling the API directly. Claude Code and Codex CLI already speak MCP, so wrapping Grok as an MCP server lets you call it as a tool from inside the client you already use. The X (formerly Twitter) realtime search exposed via `x_search` is only reachable through the API, which makes this useful even if you already pay for Grok elsewhere.

## Tools

| Tool | Purpose |
|---|---|
| `grok_ask` | Text + image query. `search` enables X / web search server-side |
| `grok_list_models` | List available model IDs |
| `grok_imagine_image` | Image generation / editing (up to 3 source images) |
| `grok_imagine_video` | Video generation (async; polls until done by default) |
| `grok_imagine_video_status` | Poll an in-flight video generation by `request_id` |
| `grok_estimate_cost` | Estimate USD cost from model + tokens / images / video seconds |

## Quick start

You need an xAI API key — get one at [console.x.ai](https://console.x.ai). Then run:

```bash
npx -y github:libraz/grok-mcp init
```

The interactive setup prompts for the API key and which configs to write into (the default model comes from `XAI_DEFAULT_MODEL` or falls back to `grok-4.3`):

- **Claude Code — user** (`~/.claude.json`): active across every Claude Code session
- **Claude Code — project** (`./.mcp.json`): active only when Claude Code is opened in the current directory
- **Codex CLI** (`~/.codex/config.toml`)

Pick one or more (comma-separated, e.g. `1,3`). Re-running `init` safely replaces the existing `grok` entry without touching other servers.

Restart your MCP client to pick up the new server.

To remove the entry later, run `npx -y github:libraz/grok-mcp uninstall` — it drops only the `grok` server, other entries are kept.

### Manual setup

If you prefer to edit configs by hand:

Claude Code (`~/.claude.json` or `.mcp.json`):

```json
{
  "mcpServers": {
    "grok": {
      "command": "npx",
      "args": ["-y", "github:libraz/grok-mcp"],
      "env": {
        "XAI_API_KEY": "xai-...",
        "XAI_DEFAULT_MODEL": "grok-4.3"
      }
    }
  }
}
```

Codex CLI (`~/.codex/config.toml`):

```toml
[mcp_servers.grok]
command = "npx"
args = ["-y", "github:libraz/grok-mcp"]
env = { XAI_API_KEY = "xai-...", XAI_DEFAULT_MODEL = "grok-4.3" }
```

Once published to npm you can drop the `github:` prefix.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `XAI_API_KEY` | — (required) | xAI API key |
| `XAI_BASE_URL` | `https://api.x.ai/v1` | Region override / proxy |
| `XAI_DEFAULT_MODEL` | `grok-4.3` | Default model |
| `XAI_TIMEOUT_MS` | `120000` | Request / video polling timeout |
| `XAI_MAX_IMAGE_MB` | `20` | Max image size accepted as base64 input |

## Tool reference

### `grok_ask`

```jsonc
{
  "prompt": "What are the latest posts from @xai about Grok 4.3?",
  "images": ["https://example.com/diagram.png"],   // optional
  "model": "grok-4.3",                              // optional
  "system": "You are a concise assistant.",         // optional
  "max_tokens": 1024,                               // optional
  "temperature": 0.7,                               // optional, 0-2
  "search": "x"                                     // "x" | "web" | "both" | true | false
}
```

Images may be local file paths, http(s) URLs, or data URIs. Local files are base64-encoded automatically (jpg/jpeg/png, ≤ 20 MiB). If a remote URL returns `xAI API error: 400 Fetching image failed...`, switch to a local file path — xAI's fetcher rejects some hosts. `search` toggles the server-side `x_search` / `web_search` tools via the Responses API.

### `grok_imagine_image`

```jsonc
{
  "prompt": "A collage of London landmarks in a stenciled street-art style",
  "model": "grok-imagine-image-quality",   // image / image-quality / image-pro
  "n": 1,
  "aspect_ratio": "16:9",
  "source_images": []                       // only when editing (max 3)
}
```

Returns xAI-hosted signed URLs — download them if you need to keep them.

### `grok_imagine_video`

```jsonc
{
  "prompt": "Cinematic drone shot over a coastal town at sunset",
  "model": "grok-imagine-video",   // optional, default grok-imagine-video
  "duration": 6,
  "aspect_ratio": "16:9",
  "resolution": "720p",
  "wait": true   // false to return only the request_id
}
```

Polls every 5 seconds within `XAI_TIMEOUT_MS`. On timeout returns `pending` — continue with `grok_imagine_video_status`. Video input is not supported.

### `grok_estimate_cost`

```jsonc
{ "model": "grok-4.3", "input_tokens": 12000, "output_tokens": 800 }
{ "model": "grok-imagine-image-quality", "image_count": 4 }
{ "model": "grok-imagine-video", "video_seconds": 10 }
```

Uses a static pricing snapshot (2026-05-13). Verify current rates at [docs.x.ai/developers/models](https://docs.x.ai/developers/models).

## License

[MIT](LICENSE)
