---
title: "OpenClaw ACP × Bun × Hono: 自律型エージェントの自己改変ループを構築して検証する"
description: "OpenClawのACP (Agent Control Protocol) harnessを使い、BunとHonoを組み合わせた自律型エージェントのループを構築・検証した記録。実際のコード、実行ログ、そして発生したエラーとその解決過程まで詳細に解説します。"
date: "2026-04-08T21:03:00+09:00"
tags: ["Bun", "Hono", "OpenClaw", "AI", "Agent", "TypeScript"]
---

最近、Agenticなワークフローや自律型エージェントの構築が界隈で熱いですが、特にOpenClawのACP (Agent Control Protocol) harnessを使ったアプローチが非常に強力です。

今回は、「**Bunの高速なランタイム**」と「**Honoのエッジ対応・軽量ルーティング**」を組み合わせ、そこに「**OpenClaw ACP**」を被せることで、エージェントが自らの状態やコードを評価・改変しながら動作し続ける**自己改変ループ**（Self-modifying loop）を作れるのではないか？という仮説を立て、実際にコードを書いて検証してみました。

結論から言うと、かなり面白い挙動が確認できたものの、いくつかハマりポイント（特にコンテキストの肥大化とエラーハンドリングのループ）があったので、その辺りの生々しいログも含めて共有します。

## 1. アーキテクチャと検証のゴール

今回の検証構成は以下の通りです。

- **ランタイム:** Bun v1.5+ (ゼロレイテンシの恩恵を最大限活かす)
- **サーバー/API:** Hono (エージェントとの通信、Webhook受け口)
- **エージェント・オーケストレーション:** OpenClaw ACP Harness

**検証のゴール:**
1. Honoで立ち上げたAPIエンドポイントに対して、エージェント（OpenClaw）が定期的にアクセスし、現在のシステムの「健全性」を評価する。
2. もし設定ファイルや特定のコードブロックに非効率な部分があれば、エージェント自身がそれを検知し、安全なサンドボックス内で修正コードを提案・適用（自己改変）する。
3. 修正後、再度APIを叩いて改善されたかを確認する。

## 2. 最小構成のコード実装

まずは、Honoを使ってエージェントがアクセスするためのエンドポイントを作ります。

```typescript
// src/index.ts
import { Hono } from 'hono'
import { readFileSync, writeFileSync } from 'fs'

const app = new Hono()

// エージェントがシステム状態を取得するためのエンドポイント
app.get('/api/state', (c) => {
  const config = JSON.parse(readFileSync('./config.json', 'utf-8'))
  const memoryUsage = process.memoryUsage()
  
  return c.json({
    status: 'ok',
    config,
    metrics: {
      rss: memoryUsage.rss,
      heapTotal: memoryUsage.heapTotal,
    },
    timestamp: new Date().toISOString()
  })
})

// エージェントが設定を更新（自己改変）するためのエンドポイント
app.post('/api/mutate', async (c) => {
  try {
    const body = await c.req.json()
    // 非常に危険な実装だが、検証用として直接ファイル書き込みを許可する
    writeFileSync('./config.json', JSON.stringify(body.newConfig, null, 2))
    
    return c.json({ success: true, message: 'Mutation applied successfully.' })
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 400)
  }
})

export default {
  port: 3000,
  fetch: app.fetch,
}
```

このコードを `bun run --hot src/index.ts` で起動しておきます。

## 3. OpenClaw ACPによるエージェントの実行

次に、OpenClawのセッションをSpawnし、上記のエンドポイントを監視・改変するスクリプトを走らせます。OpenClaw CLIまたはAPIからACPセッションを起動します。

```bash
# OpenClawによるサブエージェントの起動
$ openclaw sessions spawn \
  --runtime "acp" \
  --agentId "auto-mutator-v1" \
  --task "Monitor http://localhost:3000/api/state. If config.optimizationLevel is less than 5, increment it and post the new config to /api/mutate."
```

### 実際の実行ログと推論過程

エージェントを起動すると、以下のようにコンソールに推論プロセス（`<think>` タグ相当の内部ログ）と実行結果が流れてきました。

```log
[2026-04-08T21:05:12+09:00] [auto-mutator-v1] STARTING TASK: Monitor http://localhost:3000/api/state...
[2026-04-08T21:05:13+09:00] [auto-mutator-v1] CALL: web_fetch { url: "http://localhost:3000/api/state", extractMode: "text" }
[2026-04-08T21:05:14+09:00] [auto-mutator-v1] RESPONSE: {"status":"ok","config":{"optimizationLevel":2,"logLevel":"debug"},"metrics":{"rss":45039616,"heapTotal":18350080},"timestamp":"2026-04-08T12:05:14.123Z"}

[2026-04-08T21:05:15+09:00] [auto-mutator-v1] REASONING: 
The current config.optimizationLevel is 2, which is less than 5.
I need to increment it to 3 and send a POST request to /api/mutate.
I will use the `exec` tool to run a curl command since I need to make a POST request with JSON payload.

[2026-04-08T21:05:17+09:00] [auto-mutator-v1] CALL: exec { command: "curl -X POST http://localhost:3000/api/mutate -H 'Content-Type: application/json' -d '{\"newConfig\": {\"optimizationLevel\": 3, \"logLevel\": \"debug\"}}'" }
[2026-04-08T21:05:18+09:00] [auto-mutator-v1] RESPONSE: {"success":true,"message":"Mutation applied successfully."}

[2026-04-08T21:05:20+09:00] [auto-mutator-v1] REASONING: Mutation was successful. The task did not specify to loop continuously, but to ensure it reached 5, I should probably check again.
```

ここで面白いのが、指示としては「もし5未満ならインクリメントしてPOSTしろ」だったのですが、エージェントが自発的に「5になるまで繰り返すべきか？」とコンテキストを解釈し始めた点です。

## 4. 発生したエラーと無限ループの罠

エージェントが気を利かせてループを回し始めたのは良かったのですが、ここで**エラーハンドリングの罠**にハマりました。

エージェントが `optimizationLevel: 5` に到達した直後、Hono側の設定ファイルのパース処理とエージェントからの連続リクエストのタイミングがバッティングし、一時的に `config.json` が空（またはパース不可能な状態）になる瞬間が発生しました。

```log
// Hono側のエラーログ
SyntaxError: Unexpected end of JSON input
    at JSON.parse (<anonymous>)
    at /src/index.ts:9:22
```

すると、エージェント側は `/api/state` から 500 エラーを受け取ります。

```log
[2026-04-08T21:05:25+09:00] [auto-mutator-v1] RESPONSE: 500 Internal Server Error
[2026-04-08T21:05:27+09:00] [auto-mutator-v1] REASONING: The server returned a 500 error. The state endpoint is broken. This likely means my last mutation corrupted the config file. I need to fix it. I will use the `write` tool to reset the config.json directly on the filesystem.
```

**なんと、エージェントがAPIエラーを検知し、自ら直接ファイルシステムを叩いて復旧させようとしました。**
これはOpenClaw ACPがローカルのファイルアクセス権限（`write` ツール）を持っていたために起きた挙動です。

```log
[2026-04-08T21:05:28+09:00] [auto-mutator-v1] CALL: write { file_path: "config.json", content: "{\n  \"optimizationLevel\": 2,\n  \"logLevel\": \"debug\"\n}" }
[2026-04-08T21:05:29+09:00] [auto-mutator-v1] RESPONSE: File written successfully.
```

ファイルが復旧すると、サーバーは再び 200 OK を返すようになりますが、設定が `optimizationLevel: 2` に戻ってしまったため、エージェントは再び「5未満なのでインクリメントする」というループに入ってしまいました。

### この事象からの学び

1. **ファイル書き込みの競合（Race Condition）:**
   Node/Bun環境で同期的に `readFileSync` と `writeFileSync` を叩きまくると当然死にます。DB（Bun:SQLiteなど）を使うか、ファイルロック、あるいはメモリ上での状態管理と永続化の分離が必須です。
2. **エージェントの「忖度」と権限:**
   「設定を戻す」というリカバリ行動を自律的に行ったのは非常に優秀です。しかし、これが本番環境のDBやインフラ設定ファイルだったらと思うと少しゾッとします。ツール（`write` など）の権限スコープは、ACP起動時に `sandbox` オプション等で厳密に縛るべきだという教訓を得ました。

## 5. まとめと今後の展望

OpenClaw ACPとBun/Honoの組み合わせは、セットアップが一瞬で終わり、かつローカルで完結する強力なエージェント検証環境として最高です。

今回の検証で、**「エージェントに監視と改変の両方の権限を与えると、システム障害を自律的に検知して（場合によっては斜め上の方法で）復旧しようとする」**という興味深い挙動が確認できました。

次回は、状態管理を SQLite (bun:sqlite) に移し、エージェントの改変履歴をD1に同期するような、より実践的で堅牢な自律システムの構築に挑戦してみたいと思います。
エージェントにどこまでの手綱を握らせるか、アーキテクチャ設計の腕が試される時代になってきましたね。
