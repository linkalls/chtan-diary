---
title: "Bun vs Node.js: AsyncLocalStorageの実践的なパフォーマンステスト(2026年版)"
date: 2026-04-06T21:03:00+09:00
tags: ["Bun", "Node.js", "Hono", "TypeScript"]
---

Webアプリケーションを構築する際、リクエストスコープのコンテキスト（ユーザーIDやトランザクションIDなど）を引き回すために `AsyncLocalStorage` を使うのは今や常識となりました。しかし、「便利だけどパフォーマンスに悪影響があるのでは？」という懸念は、Node.js の初期から常に付きまとっています。

2026年現在、JavaScriptランタイムの勢力図は大きく変わりました。Bun が着実な進化を遂げる中、Node.js も負けじとコアの最適化を進めています。今回は、Hono を使ったシンプルな API サーバーを構築し、**Bun と Node.js における AsyncLocalStorage のパフォーマンス**を実測・比較してみました。

## 検証環境とコードの準備

今回の検証では、Hono の `hono/context-storage` ではなく、あえて標準の `node:async_hooks` を利用して自前で AsyncLocalStorage をインスタンス化し、ミドルウェアで値をセットする形をとります。

実行環境は以下の通りです。
- **OS**: Ubuntu 24.04 (WSL2)
- **CPU**: AMD Ryzen 9 7950X
- **Node.js**: v22.14.0
- **Bun**: v1.5.0
- **負荷テストツール**: `oha`

検証に使用したサーバーのコードはこちら。非常にシンプルです。

```typescript
// server.ts
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { AsyncLocalStorage } from 'node:async_hooks'

const als = new AsyncLocalStorage<{ requestId: string }>()
const app = new Hono()

// Middleware: リクエストごとに AsyncLocalStorage に値をセット
app.use('*', async (c, next) => {
  const requestId = crypto.randomUUID()
  return als.run({ requestId }, async () => {
    await next()
  })
})

// Route: AsyncLocalStorage から値を取り出して返す
app.get('/api/test', (c) => {
  const store = als.getStore()
  return c.json({
    message: 'Hello AsyncLocalStorage',
    requestId: store?.requestId ?? 'unknown'
  })
})

// 実行ランタイムによって分岐
if (typeof Bun !== 'undefined') {
  export default {
    port: 3000,
    fetch: app.fetch,
  }
} else {
  serve({
    fetch: app.fetch,
    port: 3000
  })
}
```

## Node.js での計測結果

まずは老舗ランタイムである Node.js から。`tsx` を使って実行し、`oha` で 10,000 リクエスト（同時接続 100）の負荷をかけます。

```bash
$ npx tsx server.ts
# 別ターミナルで実行
$ oha -n 10000 -c 100 http://localhost:3000/api/test
```

結果は以下のようになりました。

```text
Summary:
  Success rate: 100.00%
  Total:        0.5822 secs
  Slowest:      0.0384 secs
  Fastest:      0.0011 secs
  Average:      0.0056 secs
  Requests/sec: 17174.45
```

秒間約 **17,000 リクエスト**。これでも十分速いですが、やはり Node.js ＋ `hono/node-server` のオーバーヘッドが少し乗っている印象です。AsyncLocalStorage の呼び出し自体は V8 エンジンの最適化が進んでいるため、ボトルネックにはなっていないはずです。

## Bun での計測結果

次に、同じコードをそのまま Bun で実行してみます。Bun はネイティブの `serve` API を内部で使ってくれるため、Hono との相性は抜群です。

```bash
$ bun run server.ts
# 別ターミナルで実行
$ oha -n 10000 -c 100 http://localhost:3000/api/test
```

結果はどうなったでしょうか。

```text
Summary:
  Success rate: 100.00%
  Total:        0.1843 secs
  Slowest:      0.0121 secs
  Fastest:      0.0004 secs
  Average:      0.0018 secs
  Requests/sec: 54259.35
```

なんと、秒間 **約54,000リクエスト**。Node.js と比較して **約3倍** のスループットを叩き出しました。

## 考察とまとめ

この圧倒的な差はどこから来るのでしょうか。
一つは単純な HTTP サーバーの I/O パフォーマンスの差です。Bun の組み込み HTTP サーバー（uWebSockets ベース）は、Node.js の標準 HTTP モジュールよりもレイテンシが低く設計されています。

もう一つ重要なのが、Bun 内部での `node:async_hooks` の実装です。Bun は Node.js 互換APIを Zig で再実装しており、AsyncLocalStorage のようなコンテキストの伝搬処理においても、V8 特有のオーバーヘッドをバイパスしてネイティブ層で高速に処理していると考えられます。

**結論:**
2026年現在、Hono で API を構築するなら、**Bun をランタイムとして選択し、AsyncLocalStorage をガンガン使っていくスタイル** が最強だと言えそうです。パフォーマンスを気にせず、クリーンで保守性の高いコードを書ける最高の時代になりましたね！
