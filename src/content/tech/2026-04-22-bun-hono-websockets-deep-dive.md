---
title: "Bun + Hono + WebSocketsでゼロ遅延リアルタイム通信を構築する（2026年版）"
description: "BunのネイティブWebSocketサポートとHonoを組み合わせ、圧倒的なパフォーマンスを叩き出すリアルタイム通信のベストプラクティスを検証しました。"
date: 2026-04-22T16:03:00.000Z
author: "chtan"
tags: ["bun", "hono", "websockets", "typescript", "edge"]
---

## はじめに

最近、エッジでのリアルタイム通信の需要が爆発的に高まっていますよね。特にBunとHonoの組み合わせは、開発体験の良さとパフォーマンスの高さから、2026年のデファクトスタンダードになりつつあります。

今回は、BunのネイティブWebSocketサポートをHono上でどう最適に扱うか、実際のコードと検証ログを交えてディープダイブしていきます。

## なぜBun + Honoなのか？

Node.js環境でのWebSocket実装といえば、長らく`ws`や`socket.io`が主流でした。しかし、Bunはランタイムレベルで超高速なWebSocket API（uWebSocketsベース）を内包しています。

Honoの`hono/bun`アダプターを使うことで、このBunのネイティブパワーを直接叩きながら、宣言的で型安全なルーティングが可能です。「TypeScriptで `any` は絶対許さない」というストイックな開発者にとっても、Zodと組み合わせたバリデーションがシームレスにハマります。

### 実装コード：ミニマルなエコーサーバー

まずはベースとなる実装を見てみましょう。

```typescript
import { Hono } from 'hono'
import { createBunWebSocket } from 'hono/bun'
import { z } from 'zod'

const { upgradeWebSocket, websocket } = createBunWebSocket()
const app = new Hono()

// メッセージスキーマの定義
const messageSchema = z.object({
  type: z.enum(['ping', 'chat']),
  payload: z.string(),
})

app.get(
  '/ws',
  upgradeWebSocket((c) => {
    return {
      onMessage(event, ws) {
        try {
          const raw = JSON.parse(event.data.toString())
          const parsed = messageSchema.parse(raw)
          
          if (parsed.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }))
          } else {
            // ブロードキャスト的な処理のモック
            ws.send(JSON.stringify({ type: 'ack', payload: parsed.payload }))
          }
        } catch (e) {
          ws.send(JSON.stringify({ error: 'Invalid payload' }))
        }
      },
      onClose() {
        console.log('Connection closed')
      }
    }
  })
)

export default {
  port: 3000,
  fetch: app.fetch,
  websocket,
}
```

## 検証：本当に「ゼロ遅延」なのか？

実際にベンチマークを回して、Node.js + `ws`の構成と比較してみました。

検証環境：
- MacBook Pro (M4 Max)
- 10,000の同時接続クライアント
- 毎秒1,000メッセージの送受信

### 実行ログと結果

```bash
$ bun run bench.ts

[Bun + Hono]
- Connections: 10,000 established
- Throughput: 145,000 msgs/sec
- P99 Latency: 1.2ms
- Memory Usage: 180MB

[Node 22 + ws]
- Connections: 10,000 established
- Throughput: 85,000 msgs/sec
- P99 Latency: 4.8ms
- Memory Usage: 450MB
```

結果は一目瞭然ですね。メモリ使用量が半分以下に抑えられつつ、スループットは約1.7倍、P99レイテンシに至っては1/4に縮小されています。この「ガベージコレクションの圧迫が少ない」というBunの特性が、コネクションを大量に保持するWebSocketサーバーにおいて劇的な差を生んでいます。

## Zodによる型安全なペイロード検証のオーバーヘッド

よく言われるのが、「すべてのメッセージでZodの`parse`を走らせたら遅くなるのでは？」という懸念です。

確かにオーバーヘッドはゼロではありません。しかし、2026年現在のZod（特にBunのJITと相性が良い）では、シンプルなスキーマであれば1回のパースにかかる時間は数マイクロ秒単位です。

エラーハンドリングを型レベルで担保できるメリットを考えれば、この程度のトレードオフは実務において完全に「買い」だと判断しています。

## まとめ

Bun + HonoでのWebSocket実装は、もはや「実験的なおもちゃ」ではなく、エンタープライズのトラフィックにも余裕で耐えうる堅牢な基盤に進化しています。

次回は、この構成にCloudflare D1やローカルのSQLite（BunのネイティブSQLiteドライバー）を組み合わせた、ステートフルなリアルタイムアプリケーションの構築について深掘りしたいと思います。
