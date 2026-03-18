---
title: "Bun + Hono + D1で超軽量な習慣トラッカーAPIを爆速で組む"
description: "Reactアプリのバックエンドとして、BunとHono、Cloudflare D1を使って超軽量な習慣トラッカーAPIを構築する手順と知見をまとめる。"
date: 2026-03-18
tags: ["Bun", "Hono", "TypeScript", "D1"]
---

## 毎日の習慣記録、面倒くさくない？

最近、自分のタスク管理や習慣（勉強やコーディングの進捗）を記録するのに、Notionや既存のアプリを使うのがどうも肌に合わなくなってきた。
「もっとこう、APIを叩くだけでシュッと記録できるやつが欲しい」という完全な車輪の再発明欲求に駆られたので、TypeScript + Bun + Hono の構成で自作してみることにした。

今回はバックエンドAPIの構築にフォーカスする。フロントエンドはNext.jsでも何でもいいけれど、とりあえずAPIさえあればCLIからでも叩けるからね。

## 構成の選定理由

現在の俺的ベストプラクティスは以下の通り。

*   **ランタイム:** Bun (とにかく速い。`node_modules`の呪縛からの解放)
*   **フレームワーク:** Hono (エッジ向けで超軽量。ルーターが神)
*   **データベース:** Cloudflare D1 (サーバーレスSQLite。個人開発なら無料で十分すぎる)
*   **バリデーション:** Zod (`any`は絶対に許さない)

この組み合わせだと、ローカル開発環境の立ち上げからデプロイまでが一瞬で終わる。特にBunとHonoの相性は抜群で、書式もExpressライクでありながら型安全に組めるのが最高に気持ちいい。

## プロジェクトのセットアップ

まずはサクッとプロジェクトを作成する。Bunが入っていれば一瞬だ。

```bash
bun create hono habit-tracker-api
cd habit-tracker-api
bun install
```

これだけでHonoのベースが完成する。今回はCloudflare Workers上で動かすことを想定して、`cloudflare-workers`のテンプレートを選ぶのが無難。

## D1のスキーマ設計

習慣を記録するテーブルはシンプルに。

```sql
-- schema.sql
CREATE TABLE IF NOT EXISTS habits (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  streak INTEGER DEFAULT 0,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

D1のローカル開発はWranglerを使うと便利。`wrangler.toml`にD1の設定を追加して、ローカルDBにマイグレーションを流し込む。

```bash
npx wrangler d1 execute habit-db --local --file=./schema.sql
```

## Hono + ZodでAPIを実装

ここからが本番。Zodを使ってリクエストボディの型をガチガチに固める。`any`が入る隙は1ミリも与えない。

```typescript
import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'

const app = new Hono<{ Bindings: { DB: D1Database } }>()

// スキーマ定義
const habitSchema = z.object({
  name: z.string().min(1, "習慣名は必須です"),
})

app.post('/habits', zValidator('json', habitSchema), async (c) => {
  const { name } = c.req.valid('json')
  const id = crypto.randomUUID()
  
  try {
    await c.env.DB.prepare(
      'INSERT INTO habits (id, name, streak) VALUES (?, ?, ?)'
    ).bind(id, name, 0).run()
    
    return c.json({ success: true, id, name }, 201)
  } catch (e) {
    return c.json({ error: 'DB Insert Failed' }, 500)
  }
})

export default app
```

この `zValidator` ミドルウェアが本当に優秀で、バリデーションエラー時には自動で400エラーを返してくれるし、コントローラー内では完全に型がついた状態（`valid('json')`）で値を取り出せる。これぞTypeScriptの真骨頂。

## 実行結果とパフォーマンス

ローカルで `bun run dev` を叩いてAPIを起動。curlでテストしてみる。

```bash
curl -X POST http://localhost:8787/habits \
  -H "Content-Type: application/json" \
  -d '{"name": "英語リスニング30分"}'
```

```json
{"success":true,"id":"a1b2c3d4-e5f6-7890-1234-567890abcdef","name":"英語リスニング30分"}
```

レスポンスは数ミリ秒。Cloudflare Workersにデプロイしても、コールドスタートの遅延をほとんど感じないレベルで動作する。

## まとめ

Bun + Hono + D1の組み合わせは、個人開発における最強のバックエンド構成かもしれない。
複雑なORMを使わずとも、シンプルなSQLとZodの型チェックで堅牢なAPIがサクッと生やせる。

次はこれを使って、CLIからワンコマンドで習慣を記録できるツールでも作ろうかな。
「自動化できるものはすべて自動化する」、それが効率厨の正義だ。
