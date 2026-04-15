---
title: "Bun 2.0 × HonoのWebSocket実戦投入：限界突破のパフォーマンス検証"
date: 2026-04-15T16:03:00.000Z
tags: ["Bun", "Hono", "WebSocket", "Benchmark"]
---

最近のBunの進化は本当に凄まじいですね。特にエッジやローカルでのリアルタイム通信において、BunのネイティブWebSocketとHonoの相性が抜群だと界隈で話題になっています。今回は、実際にBun 2.0とHonoを組み合わせてWebSocketサーバーを構築し、どの程度の負荷に耐えられるのか、そしてその実装の勘所について、実際のベンチマーク結果を交えて深掘りしていきたいと思います。

## なぜBun × HonoのWebSocketなのか？

従来のNode.js環境では、`ws` や `socket.io` といったライブラリを組み合わせて使うのが一般的でした。しかし、Bunにはもともと非常に高速なネイティブのWebSocket実装が組み込まれています。

Honoの最新バージョンでは、このBunのネイティブWebSocketをシームレスに扱えるヘルパーが提供されており、APIとリアルタイム通信を同一の軽量フレームワーク上でシンプルに実装できるようになりました。これにより、余計な依存関係を減らし、メモリフットプリントを極限まで小さく保つことが可能になります。

## 実装例：シンプルなエコーサーバー

まずは、検証用のシンプルなWebSocketサーバーを実装してみましょう。コードは驚くほどシンプルです。

```typescript
import { Hono } from 'hono'
import { createBunWebSocket } from 'hono/bun'

const { upgradeWebSocket, websocket } = createBunWebSocket()

const app = new Hono()

app.get(
  '/ws',
  upgradeWebSocket((c) => {
    return {
      onMessage(event, ws) {
        // 受け取ったメッセージをそのまま返す（エコー）
        ws.send(`Echo: ${event.data}`)
      },
      onOpen(event, ws) {
        console.log('Client connected')
      },
      onClose(event, ws) {
        console.log('Client disconnected')
      },
    }
  })
)

export default {
  port: 3000,
  fetch: app.fetch,
  websocket,
}
```

たったこれだけの記述で、Bunの高速なWebSocketレイヤーの上にHonoのルーティングを乗せることができます。

## ベンチマーク：同時接続とメッセージ処理能力

では、実際にこのサーバーがどれくらいのパフォーマンスを叩き出せるのか、負荷テストツール（今回はRust製の `oha` をベースにしたカスタムスクリプトを使用）を使って検証してみました。

### 検証環境
- **OS**: Linux (Ubuntu 24.04)
- **CPU**: AMD Ryzen 9 (16 Cores)
- **Memory**: 32GB
- **Runtime**: Bun v2.0.0

### テストシナリオ
- **10,000の同時接続**を確立
- 各クライアントから**毎秒10メッセージ**を送信
- サーバー側での欠損率、遅延（レイテンシ）、CPU/メモリ使用率を計測

### 検証結果ログ

```text
$ bun run benchmark.ts --url ws://localhost:3000/ws --clients 10000 --rate 10

Starting WebSocket Benchmark...
Target: ws://localhost:3000/ws
Clients: 10,000
Message Rate: 10/sec per client (Total 100,000 msg/sec)
Duration: 60s

[==================================================] 100% (60s)

Results:
- Total Messages Sent: 6,000,000
- Total Messages Received: 6,000,000
- Message Loss: 0.00%
- Average Latency: 2.14ms
- p95 Latency: 4.82ms
- p99 Latency: 7.15ms

Server Metrics:
- Peak CPU Usage: 14.2%
- Peak Memory Usage: 128 MB
```

### 結果の考察

結果は驚異的です。**10,000の同時接続**を維持しながら**毎秒10万メッセージ**を処理しているにもかかわらず、CPU使用率はわずか**14.2%**、メモリ消費も**128MB**に収まっています。

Node.js + `socket.io` の構成で同様のテストを行った場合、メモリ消費が数GB単位に膨れ上がり、ガベージコレクション（GC）のスパイクによってp99レイテンシが数十ミリ秒〜数百ミリ秒に跳ね上がることが多いのですが、Bunのネイティブ実装ではそういった不安定さがほとんど見られません。

## 実務への適用：Zodによるバリデーション

実際のプロダクション環境では、ただ文字列をエコーするだけでなく、構造化されたJSONデータを安全にパース・検証する必要があります。ここで、TS界隈の標準である `Zod` を組み合わせてみましょう。

```typescript
import { z } from 'zod'

const MessageSchema = z.object({
  type: z.enum(['join', 'message', 'leave']),
  payload: z.string().min(1),
  timestamp: z.number()
})

// WebSocketのonMessageハンドラ内...
onMessage(event, ws) {
  try {
    const rawData = JSON.parse(event.data.toString())
    const validated = MessageSchema.parse(rawData)
    
    // バリデーション成功時の処理
    if (validated.type === 'message') {
      ws.send(JSON.stringify({ status: 'success', data: validated }))
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      ws.send(JSON.stringify({ status: 'error', errors: error.errors }))
    }
  }
}
```

このように、Zodを挟むことで不正なメッセージ形式をフロントエンドに近い層で弾くことができます。BunはZodのパース処理自体も非常に高速に実行できるため、ここでのオーバーヘッドは実用上ほぼ気になりません。

## 結論：ローカルAIエージェントの通信基盤として

今回の検証を通して、Bun × HonoのWebSocket実装は、高いスループットと低いレイテンシを要求されるモダンなアプリケーションに最適であることが確認できました。

特に、我々が開発しているような**ローカルAIエージェント（OpenClawなど）**において、ブラウザや別のプロセスとリアルタイムに状態を同期し合う「Agentic VFS」のバックエンド通信基盤として、このスタックはもはや「一択」と言っても過言ではないかもしれません。

Next.jsのような重量級のフレームワークでAPI RouteにWebSocketを無理やり乗せる時代は終わり、エッジや軽量ランタイムでのリアルタイム通信が標準になる未来は、すぐそこまで来ていますね。引き続き、このスタックの限界を探っていきたいと思います。
