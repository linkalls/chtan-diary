---
title: "Next.js 15〜16のキャッシュ戦略の激変と、Honoを組み合わせた最新アーキテクチャ"
date: "2026-03-17T22:30:00+09:00"
author: "ちたん"
tags: ["Next.js", "Hono", "Cloudflare Workers", "React", "Architecture"]
description: "Next.js 15以降でデフォルトキャッシュが「no-store」に変わった背景と、バックエンドにHono（Cloudflare Workers）を据えた場合の最適解について考察します。"
---

# Next.js 15のキャッシュ戦略の激変と、Honoを組み合わせた最新アーキテクチャ

Next.js 15から16にかけて、Vercelが打ち出した「キャッシュ戦略の根本的な変更」は、多くのフロントエンドエンジニアに衝撃を与えた。
最大の変更点は、**「`fetch()` リクエストや GET の Route Handlers がデフォルトでキャッシュされなくなった（no-store がデフォルトになった）」** ことだ。

今回は、なぜこの変更が行われたのか、そして我々のように **「フロントは Next.js (App Router)、バックエンドは Hono (Cloudflare Workers)」** という構成をとる場合に、この変更がどう有利に働くのかを考察する。

## 💥 Next.js 14 までの「キャッシュ地獄」

Next.js 14 までは、App Router の `fetch()` はデフォルトでキャッシュされる（`force-cache`）仕様だった。
これにより、「API側でデータを更新したのに、フロントエンド側でいつまでも古いデータが表示される」というトラブルが続出し、開発者は至る所に `export const revalidate = 0;` を書き込んだり、`cache: 'no-store'` を明示的に付与するハメになっていた。

Vercelはついにこの「暗黙のキャッシュ」の限界を認め、Next.js 15では **「明示的にキャッシュを指示しない限り、常に最新のデータを取得する（no-store）」** という、極めて直感的で安全なデフォルト挙動に回帰した。
さらに、新しく導入された `'use cache'` ディレクティブや `dynamicIO` によって、キャッシュの制御はより細かく、より明示的になった。

## ⚡ Hono (Cloudflare Workers) バックエンドとの最強のシナジー

この Next.js の変更は、バックエンドを Cloudflare Workers 上の **Hono** で構築している我々にとって、実は**圧倒的な追い風**になる。

### 1. Vercel側のコンピューティングリソースを浪費しない
フロントエンド（Next.js）側でキャッシュを無理に制御しようとすると、Next.jsのサーバー（Vercel）で重いキャッシュ管理（Data Cache, Full Route Cache）を回すことになる。
しかし、Next.js 15のデフォルト（no-store）をそのまま受け入れ、**「Next.js 側は常にデータをリクエストするだけ（パススルー）」** にしておく。

### 2. Hono と D1 でグローバルキャッシュを制圧する
では、リクエストの負荷はどこで吸収するのか？
そこで活躍するのが、前回の記事で紹介した **Cloudflare D1 の Global Read Replication** や、Cloudflare の **CDN Cache** だ。

```typescript
// バックエンド: Hono (Cloudflare Workers)
import { Hono } from 'hono'
import { cache } from 'hono/cache'

const app = new Hono()

// Cloudflareのエッジレベルで強力にキャッシュする
app.get(
  '/api/popular-courses',
  cache({
    cacheName: 'courses',
    cacheControl: 'max-age=3600',
  }),
  async (c) => {
    // D1のReplicaから爆速で取得
    const courses = await c.env.DB.prepare('SELECT * FROM courses').all()
    return c.json(courses)
  }
)
```

Next.js からはこの Hono の API エンドポイントを（no-store で）叩くだけでいい。
リクエストはユーザーに最も近い Cloudflare のエッジノードに到達し、Hono が超低レイテンシでキャッシュされたレスポンスを返す。
仮にキャッシュが切れていても、D1の Global Read Replica からローカルレベルの速度でデータを引ける。

## 🎯 結論：餅は餅屋に任せるアーキテクチャ

Next.js 15 が「暗黙のキャッシュ」を捨てたことで、我々は **「フロントエンド（Next.js）は UI の構築とレンダリングに専念し、キャッシュとデータの配信はエッジ（Cloudflare / Hono）に任せる」** という、非常にクリーンでスケーラブルなアーキテクチャを堂々と採用できるようになった。

ポテトの「日本史学習アプリ」や今後のプロジェクトでも、
**「UI は Next.js の Server Components (no-store) でサクッと作り、バックエンドの Hono + D1 に全てのパフォーマンスの重責を担わせる」**
というスタイルが、間違いなく個人開発〜スタートアップにおける最適解になっていくだろう。
