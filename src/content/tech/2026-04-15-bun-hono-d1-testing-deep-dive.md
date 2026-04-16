---
title: "Bun + Hono + D1のローカルテスト環境構築：Bun Test vs Vitest徹底比較"
date: "2026-04-15T13:00:00+09:00"
category: "tech"
tags: ["Bun", "Hono", "Cloudflare D1", "Testing", "TypeScript"]
---

最近、バックエンドの開発で **Bun + Hono + Cloudflare D1** の組み合わせを採用することが増えてきた。エッジでの実行を前提とした軽量で高速なスタックだが、いざCI/CDやローカルでのテスト環境を構築しようとすると、意外とハマるポイントが多い。

特に、D1のローカルモックをどのようにテストランナーに統合するかが鍵となる。今回は、Bun標準の `bun:test` と、フロントエンド界隈でデファクトスタンダードになりつつある `Vitest` の両方でテスト環境を構築し、それぞれの実行速度やDX（開発体験）を比較検証してみた。

## テスト対象のHonoアプリケーション

まずは、テスト対象となるシンプルなHonoアプリケーションを用意する。D1データベースからユーザー情報を取得するエンドポイントだ。

```typescript
// src/index.ts
import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

app.get('/users', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM users').all()
  return c.json(results)
})

export default app
```

このエンドポイントをテストするには、リクエストのモックだけでなく、`c.env.DB` にD1互換のモックオブジェクトを注入する必要がある。

## アプローチ1: Bun Test + `miniflare`

Bunの組み込みテストランナーである `bun:test` を使う場合、Cloudflareのローカルシミュレーターである `miniflare` を直接呼び出してD1モックを構築するのが確実だ。

```typescript
// test/bun.test.ts
import { describe, it, expect, beforeAll } from 'bun:test'
import { Miniflare } from 'miniflare'
import app from '../src/index'

let miniflare: Miniflare

beforeAll(async () => {
  miniflare = new Miniflare({
    modules: true,
    script: 'export default { fetch: () => new Response("ok") }',
    d1Databases: { DB: "xxx" } // インメモリDB
  })
  
  const d1 = await miniflare.getD1Database('DB')
  await d1.prepare('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)').run()
  await d1.prepare('INSERT INTO users (name) VALUES ("Alice")').run()
})

it('GET /users returns users', async () => {
  const d1 = await miniflare.getD1Database('DB')
  const req = new Request('http://localhost/users')
  const res = await app.fetch(req, { DB: d1 })
  
  expect(res.status).toBe(200)
  const json = await res.json()
  expect(json[0].name).toBe("Alice")
})
```

**検証結果:** 
実行速度は圧倒的。Bunの起動の速さも相まって、ファイル保存からテスト完了まで数ミリ秒レベルで終わる。ただし、Miniflareのセットアップコードが少し煩雑になりがちなのが難点だ。

## アプローチ2: Vitest + `@cloudflare/vitest-pool-workers`

次にVitestを使う場合だが、Cloudflare公式から提供されている `@cloudflare/vitest-pool-workers` を利用することで、Workerd環境でのテストが非常にスマートに書ける。

```typescript
// test/vitest.test.ts
import { env } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
import app from '../src/index'

beforeAll(async () => {
  await env.DB.prepare('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)').run()
  await env.DB.prepare('INSERT INTO users (name) VALUES ("Bob")').run()
})

describe('User API', () => {
  it('GET /users returns users', async () => {
    const req = new Request('http://localhost/users')
    const res = await app.fetch(req, env)
    
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json[0].name).toBe("Bob")
  })
})
```

**検証結果:**
`cloudflare:test` モジュールから環境変数を直接インポートできるため、セットアップが劇的にクリーンになる。実行速度はBunに比べると一歩劣るが（Vitestのオーバーヘッドがあるため）、実体としてのWorkerdランタイム上でテストが動くため、本番環境との挙動の差異が少ないという大きなメリットがある。

## 結論：どちらを採用すべきか？

今回の検証を経て、個人的な結論は以下のようになった。

1. **スピードとシンプルさを求めるなら Bun Test**。特にモックを多用する単体テストや、外部依存のないロジックのテストではBun Testの爆速体験が光る。
2. **本番環境への忠実さを求めるなら Vitest + Workers Pool**。D1のトランザクション挙動や、HonoのCloudflare依存のミドルウェアの挙動まで正確にテストしたい場合は、公式ツールが提供されているVitestに軍配が上がる。

最近は「とりあえずBunで全部済ませる」方針で進めることが多いが、Cloudflare Workers/D1のような特殊なランタイム依存が強い部分に関しては、Vitestのエコシステムを頼るのが今のところ最も手堅い選択肢になりそうだ。引き続き、実プロジェクトで両方を使い分けながら知見を溜めていきたい。
