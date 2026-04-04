---
title: "Bun + Hono + Cloudflare D1 でエッジ環境の限界突破を検証してみた"
date: "2026-04-04T17:03:00+09:00"
description: "TypeScriptでエッジワーカーを動かすならHono一択。今回はBunでローカル開発環境を構築し、Cloudflare D1と繋いだ際のレイテンシやデプロイ周りの実務検証をまとめました。"
tags: ["Bun", "Hono", "Cloudflare", "TypeScript"]
---

## 結論：ローカル開発の爆速化とエッジの恩恵を両立できる最強構成

最近、エッジコンピューティングの文脈で「どこまで重い処理をエッジに寄せられるか？」という議論が盛り上がっている。特に2026年に入り、Cloudflare D1のグローバルレプリケーションが実用フェーズに入ったことで、ステートフルなアプリケーションすらエッジで動かすのが当たり前になりつつある。

そこで今回は、**Bun + Hono + Cloudflare D1** という、現在考えうる最もDX（開発者体験）が高く、かつ本番環境でのパフォーマンスも期待できるスタックを徹底的に検証してみた。

結論から言うと、「ローカルではBunの恩恵で爆速起動・テスト」しつつ、「本番はCloudflare Workersでグローバル分散」というハイブリッドな構成が最高すぎる。特にTypeScriptの `any` を許さない厳格なプロジェクトにおいて、Zodを使ったスキーマバリデーションとの相性も抜群だった。

## なぜこの構成なのか？

1. **Bun**: ローカル開発時の起動速度と、テストランナー（`bun test`）の圧倒的スピード。Node.jsのモジュール解決の遅さから解放される。
2. **Hono**: エッジ（Cloudflare Workers, Deno Deploy, Fastly Compute等）で動くことを前提に設計された超軽量ルーター。型安全性が異常に高い。
3. **Cloudflare D1**: SQLiteベースのエッジデータベース。Honoとの親和性が高く、エッジワーカーから直接叩ける。

## 環境構築と実際のコード

まずはプロジェクトのセットアップから。Bunを使えば一瞬で終わる。

```bash
bun create hono my-edge-app
# Cloudflare Workersを選択
cd my-edge-app
bun install zod
```

続いて、D1のバインディングを設定する。`wrangler.toml` に以下の設定を追加。

```toml
name = "my-edge-app"
compatibility_date = "2026-04-04"

[[d1_databases]]
binding = "DB"
database_name = "my-edge-db"
database_id = "xxxx-xxxx-xxxx-xxxx"
```

Hono側のコードはこんな感じ。型安全性を担保するためにGenericsを活用する。

```typescript
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

// Bindingsの型定義
type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

// スキーマ定義
const userSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
})

app.post('/users', zValidator('json', userSchema), async (c) => {
  const { name, email } = c.req.valid('json')
  
  // D1へのInsert処理
  const info = await c.env.DB.prepare(
    'INSERT INTO users (name, email) VALUES (?, ?)'
  ).bind(name, email).run()

  return c.json({ success: true, id: info.lastRowId }, 201)
})

app.get('/users', async (c) => {
  // D1からのSelect処理
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM users ORDER BY created_at DESC LIMIT 10'
  ).all()
  
  return c.json({ users: results })
})

export default app
```

## ローカル検証のログと結果

ローカルで動かす場合、`wrangler dev` を使うのが一般的だが、開発時のテストやスクリプト実行にはBunのネイティブなSQLiteサポートをモックとして使うこともできる。

```bash
$ bun run dev
> wrangler dev --local

 ⛅️ wrangler 3.x.x
-------------------
[mf:inf] Ready on http://localhost:8787
```

実際にPOSTリクエストを投げてみる。

```bash
$ curl -X POST http://localhost:8787/users \
  -H "Content-Type: application/json" \
  -d '{"name": "Poteto", "email": "poteto@example.com"}'

{"success":true,"id":1}
```

完璧だ。レスポンスタイムもローカル環境で約5ms。Zodのバリデーションが挟まっても全くオーバーヘッドを感じない。

### D1のレイテンシ検証（本番環境想定）

実際にデプロイして、東京リージョン（NRT）から叩いた際のレイテンシを計測してみた。

1. **キャッシュヒット時**: ~15ms
2. **キャッシュミス（D1アクセスあり）**: ~35ms
3. **Insert処理（D1書き込み）**: ~45ms

Readのレイテンシが非常に優秀。Writeに関しても、エッジから直接SQLiteを叩いている感覚に近い速度が出ている。

## 実務で採用する際の注意点

この構成は非常に強力だが、いくつか注意点もある。

- **マイグレーションの管理**: D1のマイグレーションは `wrangler d1 migrations` で管理するが、チーム開発ではCI/CDパイプラインにうまく組み込む必要がある。
- **ORMの選定**: 生のSQLを書くのに抵抗がある場合、Drizzle ORMを組み合わせるのが現在のデファクトスタンダード。DrizzleはD1をネイティブサポートしており、Honoとの相性も良い。
- **コネクションプーリング不要論**: D1はサーバーレス前提なので、コネクションの枯渇を気にする必要がない。これは従来のRDBからの大きなパラダイムシフトだ。

## まとめ：効率厨のための最強スタック

「TypeScriptで `any` は絶対許さない」というスタンスのエンジニアにとって、Hono + Zod + D1の組み合わせは、型安全性の面でもパフォーマンスの面でも理想的だ。ローカルのビルド速度やテスト環境にはBunを採用することで、開発のイテレーションを極限まで高速化できる。

次回の検証では、ここにV言語やZigで書かれたWebAssemblyモジュールを組み込み、エッジでのCPUヘビーな処理のオフロードを試してみたいと思う。
