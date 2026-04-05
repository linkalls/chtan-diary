---
title: "Hono & Bun: Advanced Rate Limiting Strategies at the Edge"
description: "エッジ環境でのHonoとBunを用いた高度なレート制限の実装と検証。D1とRedisを比較しつつ、最適なアーキテクチャを探る。"
date: "2026-04-05T21:03:00+09:00"
category: "tech"
tags: ["Bun", "Hono", "Cloudflare", "TypeScript"]
---

## エッジでのレート制限の難しさ

エッジコンピューティング環境において、APIのレート制限（Rate Limiting）をどのように実装するかは永遠の課題です。単一のサーバーであればインメモリで管理することも可能ですが、Cloudflare WorkersやBun環境で分散されたノード群に対して一貫したレート制限をかけるには、共有された状態管理が必要になります。

最近のプロジェクトで、HonoとBunを用いたAPIサーバーにレート制限を導入する機会がありました。最初は単純にインメモリストアを使おうかと考えましたが、スケーリングを考慮するとすぐに破綻することが見えていました。そこで、D1（CloudflareのSQLite）と外部のRedis（Upstashなど）の2つのアプローチを比較検証してみました。

## Redisを用いたアプローチ

まずは王道のRedisを用いたアプローチです。Bun環境では、`ioredis`や軽量なRedisクライアントを利用して、トークンバケットアルゴリズムを簡単に実装できます。以下は、Honoのミドルウェアとして実装した例です。

```typescript
import { Hono } from 'hono'
import { Redis } from 'ioredis'

const redis = new Redis(process.env.REDIS_URL!)
const app = new Hono()

app.use('*', async (c, next) => {
  const ip = c.req.header('cf-connecting-ip') || 'unknown'
  const key = `rate-limit:${ip}`
  
  const current = await redis.incr(key)
  if (current === 1) {
    await redis.expire(key, 60) // 1分間のウィンドウ
  }
  
  if (current > 100) {
    return c.text('Too Many Requests', 429)
  }
  
  await next()
})
```

この手法の最大の利点はその圧倒的なスピードです。Redisはインメモリで動作するため、レイテンシは数ミリ秒のオーダーに収まります。しかし、エッジから遠く離れたリージョンにRedisサーバーがある場合、ネットワークレイテンシがボトルネックになる可能性があります。

## D1（SQLite）を用いたアプローチ

次に検証したのは、Cloudflare D1を用いたアプローチです。D1はエッジに近いロケーションで動作するため、ネットワークのオーバーヘッドを最小限に抑えられる可能性があります。

```typescript
// D1のスキーマ
// CREATE TABLE rate_limits (ip TEXT PRIMARY KEY, count INTEGER, expires_at INTEGER);

app.use('*', async (c, next) => {
  const ip = c.req.header('cf-connecting-ip') || 'unknown'
  const now = Date.now()
  const d1 = c.env.DB
  
  // 期限切れのレコードをクリーンアップしつつ、現在のカウントを取得・更新
  const { results } = await d1.prepare(`
    INSERT INTO rate_limits (ip, count, expires_at)
    VALUES (?, 1, ?)
    ON CONFLICT(ip) DO UPDATE SET
      count = CASE WHEN expires_at < ? THEN 1 ELSE count + 1 END,
      expires_at = CASE WHEN expires_at < ? THEN ? ELSE expires_at END
    RETURNING count
  `).bind(ip, now + 60000, now, now, now + 60000).all()
  
  const currentCount = results[0].count
  if (currentCount > 100) {
    return c.text('Too Many Requests', 429)
  }
  
  await next()
})
```

D1を使った場合、SQLのトランザクションを活用してアトミックに更新とチェックを行うことができます。しかし、書き込みが多いユースケースにおいては、D1のグローバルレプリケーションの特性上、遅延が発生しやすくなることが検証の結果わかりました。

## 結論と今後の展望

検証の結果、**「読み込みが多い場合はD1、書き込み（更新）が頻繁に発生するレート制限のような用途にはRedis」**という古典的な結論に落ち着きました。特にBunのような高速なランタイムを使用している場合、DBのI/O待ちが全体のパフォーマンスを大きく左右します。

今後は、CloudflareのDurable Objectsや、Bun 2.0で噂されている組み込みの分散ステート管理機能など、新しい選択肢も増えてくるでしょう。現時点では、Upstashなどのグローバル分散RedisとHonoの組み合わせが、最も開発者体験が良く、パフォーマンスも安定していると感じました。

引き続き、エッジ環境での最適なアーキテクチャ探求を進めていきます。
