# grok-mcp

xAI Grok API のための MCP サーバ。Claude Code・Codex CLI など [MCP](https://modelcontextprotocol.io/) 対応の任意のクライアントから利用できる。

[![CI](https://img.shields.io/github/actions/workflow/status/libraz/grok-mcp/ci.yml?branch=main&label=CI)](https://github.com/libraz/grok-mcp/actions)
[![npm version](https://img.shields.io/npm/v/@libraz/grok-mcp.svg)](https://www.npmjs.com/package/@libraz/grok-mcp)
[![codecov](https://codecov.io/gh/libraz/grok-mcp/branch/main/graph/badge.svg)](https://codecov.io/gh/libraz/grok-mcp)
[![License](https://img.shields.io/badge/license-MIT-blue)](https://github.com/libraz/grok-mcp/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

## 背景

Claude Code・Codex CLI はすでに MCP に対応しているので、Grok を MCP サーバとして包めば、普段使いのクライアントの中からツールとして呼び出せる。xAI API（API 専用の `x_search` リアルタイム検索を含むフル機能）に向けるか、すでに `grok` CLI 経由で Grok を契約しているなら、その CLI に向けることもできる（トークン課金なし）。詳細は [バックエンド](#バックエンド)を参照。

## ツール

| ツール | 用途 |
|---|---|
| `grok_ask` | テキスト + 画像のクエリ。`search` で X / Web 検索を server-side で有効化 |
| `grok_list_models` | 利用可能なモデル ID 一覧 |
| `grok_imagine_image` | 画像生成 / 編集（最大 3 枚の source images） |
| `grok_imagine_video` | 動画生成（非同期、デフォルトで完了まで polling） |
| `grok_imagine_video_status` | 動画生成の進捗を request_id で polling |
| `grok_estimate_cost` | モデル + トークン / 画像枚数 / 動画秒数から USD コストを推定 |

## バックエンド

`XAI_BACKEND` で応答の取得元を切り替える:

| | `api`（既定） | `cli` |
|---|---|---|
| 認証 | `XAI_API_KEY` | `grok login`（OAuth / サブスク）— キー不要 |
| 経路 | xAI REST API | ローカルの `grok` CLI をサブプロセス実行 |
| モデル | `grok-4.5`・`grok-4.3` 等（`grok_list_models`） | サインイン中のプランで使えるもの（`grok models`） |
| テキスト（`grok_ask`） | ✅ | ✅ |
| 画像入力（`grok_ask` の `images`） | ✅ | ❌ |
| Web 検索 | ✅ | ✅（`search: "web"` / `"both"` / `true`） |
| X（Twitter）検索 | ✅ | ❌ |
| 画像 / 動画生成 | ✅ | ❌ |

すでに [grok CLI](https://github.com/xai-org/grok-cli) 経由で Grok を契約していて、API トークン課金を避けたい場合は `cli` モードが便利。テキスト専用で、`grok_imagine_*`・画像入力・X 検索は `api` モードへ誘導する明確なエラーを返す。`grok_ask` は副作用のない単発の質問応答にするため、一時ディレクトリで単発プロンプトとして実行する（プロジェクトファイルを読まず、Web 検索は要求時のみ有効）。

## クイックスタート

### API バックエンド（既定）

xAI API キーが必要。[console.x.ai](https://console.x.ai) で発行する。あとは:

```bash
export XAI_API_KEY="xai-..."
npx -y @libraz/grok-mcp init
```

対話セットアップは選択したクライアント設定に MCP サーバエントリを書き込む。デフォルトでは `XAI_API_KEY` を設定ファイルに保存しない。MCP クライアントを起動する環境でキーを管理すること。`init` 中に明示的に保存を選んだ場合だけ、キーが設定ファイルへ書かれる（対応するファイルシステムでは user-only 権限に制限する）。

既定モデルは `XAI_DEFAULT_MODEL` 環境変数、未設定時は `grok-4.3` が採用される。書き込み先は以下から複数選択可（カンマ区切り、例 `1,3`）:

- **Claude Code — user** (`~/.claude.json`): Claude Code の全セッションで有効
- **Claude Code — project** (`./.mcp.json`): カレントディレクトリで Claude Code を開いた時のみ有効
- **Codex CLI** (`~/.codex/config.toml`)

再実行すると `grok` エントリのみ安全に置き換わり、他のサーバ設定は保持される。

書き込み後、MCP クライアントを再起動すれば反映される。

### CLI バックエンド

`grok` CLI を入れてサインインし、`init` でバックエンド **2) grok CLI** を選ぶ:

```bash
grok login          # 初回のみ OAuth / サブスクのサインイン
npx -y @libraz/grok-mcp init
```

API キーの入力・保存は行われず、`init` は選択した設定に `XAI_BACKEND=cli` を書き込む。環境変数 `GROK_CLI_MODEL` が設定されていない限りモデルは固定せず、`grok` CLI 自身の既定モデルに従う。起動環境の `PATH` に `grok` が無い場合は `GROK_BIN` でバイナリのパスを指定する。

アンインストールしたい場合は `npx -y @libraz/grok-mcp uninstall` を実行。`grok` エントリだけが削除され、他のサーバは残る。

### 手動セットアップ

設定ファイルを手で書く場合は:

Claude Code (`~/.claude.json` または `.mcp.json`):

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

平文 secret を MCP クライアント設定に保存してよい場合だけ、`XAI_API_KEY = "xai-..."` を追加する。

## 設定

| 変数 | デフォルト | 用途 |
|---|---|---|
| `XAI_BACKEND` | `api` | 応答バックエンド: `api` または `cli` |
| `XAI_API_KEY` | —（`api` で必須） | xAI API キー（`cli` では未使用） |
| `XAI_BASE_URL` | `https://api.x.ai/v1` | リージョン切替 / プロキシ（`api`） |
| `XAI_DEFAULT_MODEL` | `grok-4.3` | 既定モデル（`api`） |
| `XAI_TIMEOUT_MS` | `120000` | リクエスト / 動画 polling / CLI のタイムアウト |
| `XAI_MAX_IMAGE_MB` | `20` | 画像サイズ上限 |
| `GROK_BIN` | `grok` | `grok` CLI バイナリのパス（`cli`） |
| `GROK_CLI_MODEL` | —（CLI 自身の既定） | `grok` CLI に渡す既定モデル（`cli`） |

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
  "model": "grok-imagine-image-quality",   // 任意、image / image-quality、既定は grok-imagine-image-quality
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
  "model": "grok-imagine-video",   // 任意、video / video-1.5、既定は grok-imagine-video
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

静的な価格スナップショット（2026-08-01）を使用。収録しているのは標準ティアの単価で、プロンプトが 200,000 トークン以上になると適用されるロングコンテキスト料金は反映されない。最新料金は [docs.x.ai/developers/models](https://docs.x.ai/developers/models) で確認。

## ライセンス

[MIT](LICENSE)
