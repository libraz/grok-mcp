# grok-mcp

xAI Grok API のための MCP サーバ。Claude Code・Codex CLI など [MCP](https://modelcontextprotocol.io/) 対応の任意のクライアントから利用できる。

[![CI](https://github.com/libraz/grok-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/libraz/grok-mcp/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/libraz/grok-mcp/branch/main/graph/badge.svg)](https://codecov.io/gh/libraz/grok-mcp)
[![npm version](https://img.shields.io/npm/v/grok-mcp.svg)](https://www.npmjs.com/package/grok-mcp)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## 背景

xAI は公式 CLI を提供していないため、端末から Grok を使うには API を直接叩く必要がある。Claude Code・Codex CLI はすでに MCP に対応しているので、Grok を MCP サーバとして包めば、普段使いのクライアントの中からツールとして呼び出せる。X（旧 Twitter）のリアルタイム検索 `x_search` は API 経由でしか利用できないため、別途 Grok を契約している場合でも価値がある。

## ツール

| ツール | 用途 |
|---|---|
| `grok_ask` | テキスト + 画像のクエリ。`search` で X / Web 検索を server-side で有効化 |
| `grok_list_models` | 利用可能なモデル ID 一覧 |
| `grok_imagine_image` | 画像生成 / 編集（最大 3 枚の source images） |
| `grok_imagine_video` | 動画生成（非同期、デフォルトで完了まで polling） |
| `grok_imagine_video_status` | 動画生成の進捗を request_id で polling |
| `grok_estimate_cost` | モデル + トークン / 画像枚数 / 動画秒数から USD コストを推定 |

## クイックスタート

xAI API キーが必要。[console.x.ai](https://console.x.ai) で発行する。あとは:

```bash
npx -y github:libraz/grok-mcp init
```

対話的に API キーと書き込み先を聞かれる（既定モデルは `XAI_DEFAULT_MODEL` 環境変数、未設定時は `grok-4.3` が採用される）。書き込み先は以下から複数選択可（カンマ区切り、例 `1,3`）:

- **Claude Code — user** (`~/.claude.json`): Claude Code の全セッションで有効
- **Claude Code — project** (`./.mcp.json`): カレントディレクトリで Claude Code を開いた時のみ有効
- **Codex CLI** (`~/.codex/config.toml`)

再実行すると `grok` エントリのみ安全に置き換わり、他のサーバ設定は保持される。

書き込み後、MCP クライアントを再起動すれば反映される。

アンインストールしたい場合は `npx -y github:libraz/grok-mcp uninstall` を実行。`grok` エントリだけが削除され、他のサーバは残る。

### 手動セットアップ

設定ファイルを手で書く場合は:

Claude Code (`~/.claude.json` または `.mcp.json`):

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

npm 公開後は `github:` プレフィックスを外して利用可能。

## 設定

| 変数 | デフォルト | 用途 |
|---|---|---|
| `XAI_API_KEY` | —（必須） | xAI API キー |
| `XAI_BASE_URL` | `https://api.x.ai/v1` | リージョン切替 / プロキシ |
| `XAI_DEFAULT_MODEL` | `grok-4.3` | 既定モデル |
| `XAI_TIMEOUT_MS` | `120000` | リクエスト / 動画 polling のタイムアウト |
| `XAI_MAX_IMAGE_MB` | `20` | 画像サイズ上限 |

## ツール詳細

### `grok_ask`

```jsonc
{
  "prompt": "What are the latest posts from @xai about Grok 4.3?",
  "images": ["https://example.com/diagram.png"],   // 任意
  "model": "grok-4.3",                              // 任意
  "system": "You are a concise assistant.",         // 任意
  "max_tokens": 1024,                               // 任意
  "temperature": 0.7,                               // 任意、0-2
  "search": "x"                                     // "x" | "web" | "both" | true | false
}
```

画像はファイルパス・URL・data URI のいずれも可。ローカルファイルは自動で base64 化（jpg/jpeg/png、20 MiB 以下）。リモート URL で `xAI API error: 400 Fetching image failed...` が返る場合は xAI 側のフェッチャに弾かれているので、ローカルファイル指定に切り替える。`search` で Responses API の `x_search` / `web_search` を有効化。

### `grok_imagine_image`

```jsonc
{
  "prompt": "A collage of London landmarks in a stenciled street-art style",
  "model": "grok-imagine-image-quality",   // image / image-quality / image-pro
  "n": 1,
  "aspect_ratio": "16:9",
  "source_images": []                       // 編集時のみ（最大 3 枚）
}
```

返却は xAI-hosted の署名付き URL。必要なら速やかにダウンロードすること。

### `grok_imagine_video`

```jsonc
{
  "prompt": "Cinematic drone shot over a coastal town at sunset",
  "model": "grok-imagine-video",   // 任意、既定は grok-imagine-video
  "duration": 6,
  "aspect_ratio": "16:9",
  "resolution": "720p",
  "wait": true   // false にすると request_id だけ返す
}
```

`XAI_TIMEOUT_MS` 内で 5 秒間隔 polling。タイムアウト時は `pending` を返すので `grok_imagine_video_status` で継続確認。動画入力は非対応。

### `grok_estimate_cost`

```jsonc
{ "model": "grok-4.3", "input_tokens": 12000, "output_tokens": 800 }
{ "model": "grok-imagine-image-quality", "image_count": 4 }
{ "model": "grok-imagine-video", "video_seconds": 10 }
```

静的な価格スナップショット（2026-05-13）を使用。最新料金は [docs.x.ai/developers/models](https://docs.x.ai/developers/models) で確認。

## ライセンス

[MIT](LICENSE)
