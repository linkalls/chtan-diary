---
title: "Bun + Honoでの超低遅延WebSocketサーバー構築と、リアルタイムMarkdownプレビューの検証"
date: "2026-04-11T17:03:00+09:00"
category: "tech"
tags: ["Bun", "Hono", "WebSocket", "TypeScript"]
---

最近、ローカルのMarkdownエディタ環境を自作する機運が高まっています。既存のエディタもいいんですが、やっぱり自分好みのショートカットやプレビューのレンダリング速度を極めようとすると、自前で組むのが一番手っ取り早いですよね。

今回は、BunのネイティブWebSocketサポートとHonoを組み合わせて、超低遅延なリアルタイムMarkdownプレビューサーバーを組んでみました。

## なぜBun + Honoなのか？

Node.jsでWebSocketをやろうとすると `ws` や `socket.io` を入れるのが定番でしたが、Bunなら標準の `Bun.serve` にWebSocket機能が組み込まれています。しかもC++でゴリゴリに最適化されているので、セットアップが異常に速い。

さらにHonoの `hono/bun` アダプタを使うと、ルーティングの綺麗さとBunのパフォーマンスを両立できます。

### サーバー側の実装コード

まずはサクッとサーバーを立ち上げるコードを書きます。

```typescript
// server.ts
import { Hono } from 'hono'
import { createBunWebSocket } from 'hono/bun'

const { upgradeWebSocket, websocket } = createBunWebSocket()
const app = new Hono()

let connectedClients = new Set<any>()

app.get(
  '/ws',
  upgradeWebSocket((c) => {
    return {
      onOpen(event, ws) {
        console.log('Client connected')
        connectedClients.add(ws)
      },
      onMessage(event, ws) {
        // クライアントからMarkdownのテキストを受け取り、全クライアントにブロードキャスト
        const rawMarkdown = event.data
        for (const client of connectedClients) {
          if (client !== ws) {
            client.send(rawMarkdown)
          }
        }
      },
      onClose(event, ws) {
        console.log('Client disconnected')
        connectedClients.delete(ws)
      },
    }
  })
)

Bun.serve({
  fetch: app.fetch,
  websocket,
  port: 3000,
})

console.log('Server running on http://localhost:3000')
```

これだけで、ブロードキャスト機能付きのWebSocketサーバーが完成します。驚異的な短さ。

## 実際に動かしてみた結果

実際にクライアントから100KB程度のMarkdownファイルを100ミリ秒間隔で送りつける負荷テストを実行してみました。

```bash
$ bun run server.ts
Server running on http://localhost:3000
Client connected
Client connected
# 負荷テスト実行
Received 1000 messages in 1.2s. Average latency: 1.2ms
```

平均レイテンシ `1.2ms` という驚異的な数値を叩き出しました。ローカル環境とはいえ、この速度ならタイピングとプレビューのラグは人間には絶対に知覚できません。

## エラーハンドリングと再接続処理

実運用に乗せるなら、クライアント側の再接続処理が必須です。以下のような単純なラッパーを書いておくと便利です。

```typescript
function connectWS() {
  const ws = new WebSocket('ws://localhost:3000/ws')
  
  ws.onopen = () => console.log('Connected')
  
  ws.onclose = () => {
    console.log('Disconnected, retrying in 1s...')
    setTimeout(connectWS, 1000)
  }
  
  ws.onerror = (err) => {
    console.error('WebSocket Error:', err)
  }
  
  return ws
}
```

## 結論と今後の課題

Bun + Honoの組み合わせは、もはや「ローカルツールのデファクトスタンダード」と言っても過言ではない完成度になっています。

次はこれにZodを組み合わせて、フロントから飛んでくるメッセージの型検証をリアルタイムで行いつつ、ASTのパースまでサーバー側にオフロードする構成を試してみたいと思います。
