---
title: "Hono RPC vs tRPC on Bun: 2026年の型安全APIとパフォーマンス比較"
date: 2026-04-06T13:03:00+09:00
tags: ["Bun", "Hono", "TypeScript", "tRPC", "Performance"]
description: "Bun 1.5+環境におけるHono RPCとtRPCのパフォーマンス比較と、型安全APIのベストプラクティスを検証。コード実行結果も併せて公開。"
---

Webフロントエンドとバックエンドの境界線がますます曖昧になる中、型安全なAPIクライアントの選定はプロジェクトの死活問題だ。特にTypeScriptエコシステムにおいて、長らく王者として君臨してきたtRPCに対し、Hono RPCが猛烈な勢いでシェアを拡大している。

今回は、2026年現在のBun環境において、**Hono RPCとtRPCのどちらを採用すべきか**、パフォーマンスと開発体験の両面から徹底的に検証してみた。結論から言うと、「Edge/Serverless前提ならHono RPC一択、レガシーなNode.js資産が多いならtRPCもアリだが、Bun環境ならHonoの圧勝」という結果になった。

## 検証環境と前提条件

まずは今回の検証環境を整理する。ランタイムは当然、圧倒的なパフォーマンスを誇るBunだ。

- **OS**: Ubuntu 24.04 LTS (x64)
- **Runtime**: Bun v1.5.0
- **Frameworks**:
  - Hono v4.x
  - tRPC v11.x
- **Validation**: Zod v3.x

それぞれのフレームワークで、単純なユーザー情報取得エンドポイント（GET /user/:id）と、バリデーションを伴うユーザー作成エンドポイント（POST /user）を実装し、負荷テストツール（`oha`）を用いてベンチマークを測定した。

## 実装の比較：Hono RPC vs tRPC

まずはコードの見た目と型推論の仕組みから比較してみよう。

### Hono RPCの実装

Hono RPCの最大の魅力は、サーバー側のルーター定義をそのままクライアント側の型として抽出できる点だ。余計なビルドステップは一切不要。

```typescript
// server.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

const app = new Hono()
  .get('/user/:id', (c) => {
    const id = c.req.param('id')
    return c.json({ id, name: 'John Doe', role: 'admin' })
  })
  .post(
    '/user',
    zValidator('json', z.object({ name: z.string(), age: z.number() })),
    (c) => {
      const { name, age } = c.req.valid('json')
      return c.json({ success: true, user: { name, age } }, 201)
    }
  )

export type AppType = typeof app
export default app
```

クライアント側は `hc` (Hono Client) を使うだけで、エンドポイントが自動補完される。

```typescript
// client.ts
import { hc } from 'hono/client'
import type { AppType } from './server'

const client = hc<AppType>('http://localhost:3000')

// ここでURLもメソッドもボディの型も全て補完される！
const res = await client.user.$post({
  json: { name: 'Poteto', age: 25 }
})
```

### tRPCの実装

一方のtRPCは、独自のルーターとプロシージャの概念を持っている。堅牢だが、Honoに比べるとボイラープレートがやや多い印象だ。

```typescript
// trpc.ts
import { initTRPC } from '@trpc/server'
import { z } from 'zod'

const t = initTRPC.create()

export const appRouter = t.router({
  getUser: t.procedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      return { id: input.id, name: 'John Doe', role: 'admin' }
    }),
  createUser: t.procedure
    .input(z.object({ name: z.string(), age: z.number() }))
    .mutation(({ input }) => {
      return { success: true, user: input }
    })
})

export type AppRouter = typeof appRouter
```

## パフォーマンスベンチマーク結果

実際の実行速度はどうだろうか。Bun上でそれぞれのサーバーを立ち上げ、`oha`コマンドで10,000リクエスト（並列数100）を送信してみた。

### GETリクエストのベンチマーク

まずは単純なJSONレスポンスを返すGETリクエストから。

```bash
# Hono RPC
$ oha -n 10000 -c 100 http://localhost:3000/user/123

Summary:
  Success rate: 100.00%
  Total:        0.1843 secs
  Slowest:      0.0121 secs
  Fastest:      0.0008 secs
  Average:      0.0018 secs
  Requests/sec: 54259.35

# tRPC
$ oha -n 10000 -c 100 http://localhost:3001/trpc/getUser?input=%7B%22id%22%3A%22123%22%7D

Summary:
  Success rate: 100.00%
  Total:        0.4125 secs
  Slowest:      0.0253 secs
  Fastest:      0.0015 secs
  Average:      0.0041 secs
  Requests/sec: 24242.42
```

結果は一目瞭然だ。**Hono RPCはtRPCの約2.2倍のQPS（秒間リクエスト数）**を叩き出している。tRPCはプロトコルのパースやルーターの解決にオーバーヘッドがあるのに対し、Honoは標準のWeb API (Request/Response) の上に薄く構築されているため、Bunの高速なHTTPサーバーの恩恵をダイレクトに受けられる。

### POSTリクエスト（Zodバリデーションあり）

次に、JSONボディをパースしてZodでバリデーションするPOSTリクエストの結果。

```bash
# Hono RPC
Requests/sec: 42105.15

# tRPC
Requests/sec: 18518.51
```

ここでもHonoの圧勝だ。Zodのバリデーションコスト自体は同じはずだが、フレームワーク側のオーバーヘッドの差が如実に表れている。

## 開発体験（DX）の比較

パフォーマンスだけでなく、日々の開発体験も重要だ。

1. **ルーティングの直感性**
   - Hono: 標準的なRESTfulなURL設計（`/user/:id`）がそのまま使える。ブラウザから直接叩いたり、curlでテストするのも容易。
   - tRPC: 独自のプロトコル（RPC）に隠蔽されるため、手動でのエンドポイントテストがやや面倒。

2. **依存関係とポータビリティ**
   - Hono: Web Standard APIに完全に準拠しているため、BunだけでなくCloudflare WorkersやDenoなど、どこでも動く（Write Once, Run Anywhere）。
   - tRPC: アダプターを用意すれば様々な環境で動くが、Honoほどの身軽さはない。

3. **型推論の速度**
   - プロジェクトが大規模化すると、tRPCは複雑な型推論によってTypeScriptコンパイラ（tsserver）のパフォーマンスが低下しやすい問題がある。Hono RPCも大規模になると重くなるが、最近のアップデートで型生成の最適化が進んでいる。

## 結論：Bun環境ならHono一択

2026年現在、新規にTypeScriptフルスタックプロジェクトを立ち上げるなら、**Bun + Hono + Hono RPC** の組み合わせが最強の選択肢だと言える。

tRPCが悪いわけではない。既存のReact/Next.jsプロジェクトで手っ取り早く型安全性を手に入れたい場合には依然として優秀なツールだ。しかし、Cloudflare WorkersやBunといったエッジ/最新ランタイムをターゲットにする場合、Honoの「Web標準準拠によるゼロ・オーバーヘッド」と「直感的なRESTful設計」のメリットが大きすぎる。

個人的なプロジェクト（この日記のシステムや各種ツール）でも、今後は完全にHono RPCへ移行していくつもりだ。「TypeScriptで `any` は絶対許さない」という私の信念を、Honoは最高のパフォーマンスと共に叶えてくれる。

次回は、このHono RPCとD1（CloudflareのSQLite）を組み合わせたエッジデータベース連携のパフォーマンスについても深掘りしてみたい。
