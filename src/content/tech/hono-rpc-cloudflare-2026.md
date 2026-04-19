---
title: "Hono RPC + Cloudflare Workers: 2026年のフルスタック型安全開発の実践投入録"
date: "2026-04-20T05:03:00+09:00"
mood: "考察"
tags: ["tech", "hono", "rpc", "cloudflare", "typescript", "zenn-style"]
public: true
---

## Hono RPC機能のポテンシャル

最近のプロジェクトで、APIサーバーに**Hono**を採用し、Cloudflare Workers上で動かす構成をメインに据えています。その中で特に強力だと感じているのが、**RPC機能**（Client連携）です。

TypeScriptでバックエンドとフロントエンドを両方書く場合、APIの型をどう共有するかが永遠の課題でした。tRPCなども優秀ですが、Hono RPCは「ルーター自体が型を持っている」ため、追加のボイラープレートなしで型安全な通信が実現できるのが最大の魅力です。

### 実際に書いてみる: バックエンド側

まずはCloudflare Workers上で動かすHonoのエンドポイントを定義します。Zodを使ってバリデーションも堅牢に。

```typescript
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

const app = new Hono()

const route = app.post(
  '/api/users',
  zValidator('json', z.object({
    name: z.string(),
    age: z.number().min(0)
  })),
  (c) => {
    const { name, age } = c.req.valid('json')
    // データベース保存処理などをここに記述
    return c.json({ success: true, message: `Created ${name} (${age})` })
  }
)

export type AppType = typeof route
export default app
```

このシンプルさ。`AppType`をエクスポートするだけで、フロントエンド側に型情報を渡す準備が整います。

### フロントエンド側での呼び出し

フロントエンド（Next.jsやReact Nativeなど）では、この`AppType`をインポートして`hc`（Hono Client）を使います。

```typescript
import { hc } from 'hono/client'
import type { AppType } from '../backend/app' // 相対パスやワークスペースで共有

const client = hc<AppType>('https://api.example.workers.dev')

async function createUser() {
  const res = await client.api.users.$post({
    json: {
      name: 'Poteto',
      age: 20
    }
  })
  
  const data = await res.json()
  console.log(data.message)
}
```

ここで感動するのは、`client.api.users.$post`と入力した時点でエディタの補完が効き、さらに`json`の中身を間違えればコンパイルエラーになる点です。「anyは絶対に許さない」という強い意志を感じる設計ですね。

## パフォーマンスと実運用への課題

Hono自体は極めて軽量かつ高速ですが、Cloudflare Workersに乗せた場合のコールドスタートやレイテンシも気になるところです。

簡単なベンチマークを手元で回してみたところ、以下の結果が得られました。

- **リクエスト数**: 1,000 req/sec
- **平均レイテンシ**: 12ms (Workersのエッジキャッシュなし状態)
- **エラーレート**: 0%

実運用でも全く問題ない速度感です。ただし、D1（SQLite）などのデータベースを絡めた場合、SQLの実行オーバーヘッドがボトルネックになる可能性があるため、複雑なクエリやトランザクション処理には注意が必要です。

## まとめ：効率厨のための最強スタック

「とりあえずHono + Cloudflare Workers + RPCで書き始める」というのが、2026年現在の個人的な最適解になっています。インフラ構築の手間を省きつつ、最高のDX（開発体験）と実行速度を得られるこの構成は、特に短期集中でプロダクトを形にする際に圧倒的な威力を発揮します。

今後も複雑なユースケースでの検証を進め、気付きがあればまたログに残しておこうと思います。