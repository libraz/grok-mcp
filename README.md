# grok-mcp

MCP server for the xAI Grok API. Works with Claude Code, Codex CLI, and any other [MCP](https://modelcontextprotocol.io/)-capable client.

[![CI](https://img.shields.io/github/actions/workflow/status/libraz/grok-mcp/ci.yml?branch=main&label=CI)](https://github.com/libraz/grok-mcp/actions)
[![npm version](https://img.shields.io/npm/v/@libraz/grok-mcp.svg)](https://www.npmjs.com/package/@libraz/grok-mcp)
[![codecov](https://codecov.io/gh/libraz/grok-mcp/branch/main/graph/badge.svg)](https://codecov.io/gh/libraz/grok-mcp)
[![License](https://img.shields.io/badge/license-MIT-blue)](https://github.com/libraz/grok-mcp/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

## Motivation

Claude Code and Codex CLI already speak MCP, so wrapping Grok as an MCP server lets you call it as a tool from inside the client you already use. Point it at the xAI API (full feature set, including the `x_search` realtime X / Twitter search that is API-only) or, if you already pay for Grok through the `grok` CLI, at that CLI instead — no per-token API billing. See [Backends](#backends).

## Tools

| Tool | Purpose |
|---|---|
| `grok_ask` | Text + image query. `search` enables X / web search server-side |
| `grok_list_models` | List available model IDs |
| `grok_imagine_image` | Image generation / editing (up to 3 source images) |
| `grok_imagine_video` | Video generation (async; polls until done by default) |
| `grok_imagine_video_status` | Poll an in-flight video generation by `request_id` |
| `grok_estimate_cost` | Estimate USD cost from model + tokens / images / video seconds |

## Backends

`XAI_BACKEND` selects where responses come from:

| | `api` (default) | `cli` |
|---|---|---|
| Auth | `XAI_API_KEY` | `grok login` (OAuth / subscription) — no key needed |
| Transport | xAI REST API | local `grok` CLI subprocess |
| Models | `grok-4.5`, `grok-4.3`, … (`grok_list_models`) | whatever the signed-in plan offers (`grok models`) |
| Text (`grok_ask`) | ✅ | ✅ |
| Image input (`grok_ask` `images`) | ✅ | ❌ |
| Web search | ✅ | ✅ (`search: "web"` / `"both"` / `true`) |
| X (Twitter) search | ✅ | ❌ |
| Image / video generation | ✅ | ❌ |

Use `cli` mode if you already have a Grok subscription via the [grok CLI](https://github.com/xai-org/grok-cli) and would rather not pay per API token. It is text-only: `grok_imagine_*`, image input and X search return a clear error pointing back to `api` mode. The CLI runs each `grok_ask` as a single-turn prompt in a temp directory (no project files, web search off unless requested) to keep it a side-effect-free question/answer call.

## Quick start

### API backend (default)

You need an xAI API key — get one at [console.x.ai](https://console.x.ai). Then run:

```bash
export XAI_API_KEY="xai-..."
npx -y @libraz/grok-mcp init
```

The interactive setup writes the MCP server entry into your selected client configs. By default it does **not** store `XAI_API_KEY` in those files; keep the key in the environment used to launch your MCP client. If you explicitly opt into storing the key during `init`, the generated config file is restricted to user-only permissions where the filesystem supports it.

The default model comes from `XAI_DEFAULT_MODEL` or falls back to `grok-4.3`. Pick one or more config targets (comma-separated, e.g. `1,3`):

- **Claude Code — user** (`~/.claude.json`): active across every Claude Code session
- **Claude Code — project** (`./.mcp.json`): active only when Claude Code is opened in the current directory
- **Codex CLI** (`~/.codex/config.toml`)

Re-running `init` replaces only the `grok` entry; other server definitions are kept.

Restart your MCP client to pick up the new server.

### CLI backend

Install the `grok` CLI and sign in, then run `init` and choose backend **2) grok CLI**:

```bash
grok login          # one-time OAuth / subscription sign-in
npx -y @libraz/grok-mcp init
```

No API key is requested or stored — `init` writes `XAI_BACKEND=cli` into the selected configs. No model is pinned unless `GROK_CLI_MODEL` is already set in the environment, so the `grok` CLI's own default model applies. Override the binary location with `GROK_BIN` if `grok` is not on the launch environment's `PATH`.

To remove the entry later, run `npx -y @libraz/grok-mcp uninstall` — it drops only the `grok` server, other entries are kept.

### Manual setup

If you prefer to edit configs by hand:

Claude Code (`~/.claude.json` or `.mcp.json`):

```json
{
  "mcpServers": {
    "grok": {
      "command": "npx",
      "args": ["-y", "@libraz/grok-mcp"],
      "env": {
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
args = ["-y", "@libraz/grok-mcp"]
env = { XAI_DEFAULT_MODEL = "grok-4.3" }
```

Only add `XAI_API_KEY = "xai-..."` to these files if you accept storing a plaintext secret in the MCP client config.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `XAI_BACKEND` | `api` | Response backend: `api` or `cli` |
| `XAI_API_KEY` | — (required for `api`) | xAI API key (not used by `cli`) |
| `XAI_BASE_URL` | `https://api.x.ai/v1` | Region override / proxy (`api`) |
| `XAI_DEFAULT_MODEL` | `grok-4.3` | Default model (`api`) |
| `XAI_TIMEOUT_MS` | `120000` | Request / video polling / CLI timeout |
| `XAI_MAX_IMAGE_MB` | `20` | Max image size accepted as base64 input |
| `GROK_BIN` | `grok` | Path to the `grok` CLI binary (`cli`) |
| `GROK_CLI_MODEL` | — (the CLI's own default) | Default model passed to the `grok` CLI (`cli`) |

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
  "model": "grok-imagine-image-quality",   // optional, image / image-quality, default grok-imagine-image-quality
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
  "model": "grok-imagine-video",   // optional, video / video-1.5, default grok-imagine-video
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

Uses a static pricing snapshot (2026-08-01) of xAI's standard-tier rates; prompts of 200,000 tokens or more bill at the higher long-context rates, which the estimate does not apply. Verify current rates at [docs.x.ai/developers/models](https://docs.x.ai/developers/models).

## License

[MIT](LICENSE)
