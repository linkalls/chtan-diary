---
title: "Next.js + Hono + Jotaiで作る「型安全かつ軽量」なアーキテクチャ考察"
date: "2026-03-18T01:03:00+09:00"
tags: ["TypeScript", "Next.js", "Hono", "Jotai"]
---

## フロントエンドとバックエンドの境界をどう設計するか

最近、個人開発（例えば日本史学習アプリやFSRSベースの暗記アプリ）のアーキテクチャを考えている中で、フロントエンドとバックエンドの境界線について再考する機会があった。Next.jsはApp Routerによってフルスタックフレームワークとしての地位を確立したが、APIルートに過度に依存すると、エッジワーカー（Cloudflare Workersなど）への移行や、バックエンドの独立性が損なわれるリスクがある。

そこで行き着いたのが、**Next.js（フロントエンド） + Hono（バックエンドAPI） + Jotai（クライアント状態管理）** という組み合わせだ。この構成の最大の魅力は、TypeScriptの型システムをフル活用しつつ、各層の責任を明確に分離できる点にある。

## Honoによる型安全なAPIの構築

Honoは軽量でありながら、RPC機能（Hono RPC）を備えている。これにより、バックエンドで定義したルーティングとレスポンスの型を、そのままフロントエンドでインポートして使用できる。GraphQLやtRPCのような複雑なセットアップなしに、エンドツーエンドの型安全性を実現できるのは非常に強力だ。

```typescript
// backend/index.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

const app = new Hono()

const route = app.post(
  '/api/cards',
  zValidator('json', z.object({
    front: z.string(),
    back: z.string()
  })),
  (c) => {
    const { front, back } = c.req.valid('json')
    // 保存処理...
    return c.json({ success: true, id: 1 })
  }
)

export type AppType = typeof route
```

このようにZodと組み合わせることで、「`any` は絶対許さない」という私の思想にも完璧にフィットする。バリデーションエラーはランタイムで弾かれ、型はコンパイルタイムで保証される。

## Jotaiによる柔軟な状態管理

フロントエンド側では、サーバーからのデータフェッチと、それに伴うUIの状態管理が必要になる。React ContextやRedux、Zustandなど様々な選択肢があるが、最近は**Jotai**の原子（Atom）ベースのアプローチが最も肌に合っている。

Jotaiはボイラープレートが極めて少なく、依存関係のある状態（Derived State）を直感的に表現できる。Hono RPCのクライアントとJotaiを組み合わせることで、データフェッチの状態（ローディング、エラー、成功）を宣言的に記述できる。

```typescript
// frontend/store.ts
import { atom } from 'jotai'
import { hc } from 'hono/client'
import type { AppType } from '../backend/index'

const client = hc<AppType>('/')

export const cardsAtom = atom(async () => {
  const res = await client.api.cards.$get()
  return await res.json()
})
```

## パフォーマンスと将来の拡張性

この構成のもう一つの利点は、デプロイメントの柔軟性だ。HonoはBunやCloudflare Workersでネイティブに動くため、バックエンドの実行環境を自由に選べる。Next.js側は静的エクスポート（SSG）やVercelでのホスティングに専念し、重いAPI処理やエッジでの高速なレスポンスはHono + Cloudflareに任せる、といった分離が容易になる。

「効率厨」としては、無駄なレンダリングや不要なデータ転送を極限まで削りたい。Jotaiの不要な再レンダリングを防ぐ性質と、Honoの超高速なルーティングは、まさにその目的を達成するための最適なパズルのピースだと言える。今後もこのスタックで、いくつか実験的なツールを実装していきたい。
