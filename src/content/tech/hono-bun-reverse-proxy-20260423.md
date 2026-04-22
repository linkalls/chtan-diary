---
title: "Bun + Honoで作る超爆速リバースプロキシ: Edgeの制約を飛び越える"
date: "2026-04-23"
tags: ["Bun", "Hono", "TypeScript", "Performance"]
---

Edgeコンピューティングが全盛の今、Cloudflare Workersなどは非常に便利だが、それでも**特定のユースケースではNode.jsやBunのような環境でフルスタックのサーバーを立ち上げる必要**が出てくる。今回は、CloudflareのようなEdgeの制約（CPU時間、メモリ制限、特定モジュールの非互換性）に縛られず、かつ爆速なリバースプロキシを**BunとHono**の組み合わせで構築・検証してみた。

## なぜBun + Honoなのか？

HonoはEdge（Cloudflare Workers、Deno、Fastly）に最適化されているフレームワークとして有名だが、実は**Bunのビルトインサーバーとの相性も異常に良い**。

Node.jsの`http`モジュールを使うよりも、BunのネイティブAPIを叩いた方が圧倒的にスループットが高い。そして、Honoは内部でBunのAPIを直接叩くアダプタを提供しているため、開発体験はそのままにパフォーマンスだけを極限まで引き上げることができる。

## 実装: シンプルなリバースプロキシ

実際にコードを書いてみる。今回は、特定のエンドポイント（例: `/api/*`）に来たリクエストをバックエンドサーバーに流し、それ以外はローカルで処理するリバースプロキシを作る。

```typescript
// index.ts
import { Hono } from 'hono'

const app = new Hono()

// バックエンドのURL
const BACKEND_URL = 'http://localhost:8080'

// プロキシのメイン処理
app.all('/api/*', async (c) => {
  const url = new URL(c.req.url)
  const targetUrl = new URL(url.pathname + url.search, BACKEND_URL)

  console.log(`[PROXY] Forwarding ${c.req.method} ${url.pathname} to ${targetUrl.toString()}`)

  // リクエストヘッダーのコピー
  const headers = new Headers(c.req.raw.headers)
  headers.set('X-Forwarded-Host', url.host)
  
  try {
    const response = await fetch(targetUrl.toString(), {
      method: c.req.method,
      headers: headers,
      body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : await c.req.raw.blob(),
      redirect: 'manual'
    })

    // レスポンスをそのまま返す
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    })
  } catch (err) {
    console.error(`[PROXY ERROR]`, err)
    return c.text('Bad Gateway', 502)
  }
})

app.get('/', (c) => c.text('Welcome to the fast lane! 🚀'))

export default {
  port: 3000,
  fetch: app.fetch
}
```

このコードの美しさは、`fetch`をそのまま使っている点にある。Node.jsでプロキシを作る場合、`http-proxy`などのライブラリを挟むか、Streamをゴリゴリ書く必要があるが、Bun/Hono環境では標準のWeb APIである`fetch`と`Response`オブジェクトをそのままやり取りするだけで完結する。

## ベンチマーク検証

本当に速いのか？ `oha`（Rust製のHTTP負荷テストツール）を使って、Node.js + Expressの同等実装と比べてみた。

**テスト条件**
- バックエンド: Goで書いたシンプルなEchoサーバー
- クライアント: `oha -n 100000 -c 100 http://localhost:3000/api/echo`

### Node.js + Express (http-proxy-middleware) の結果

```text
Summary:
  Success rate: 100.00%
  Total:        12.4503 secs
  Slowest:      0.0812 secs
  Fastest:      0.0011 secs
  Average:      0.0123 secs
  Requests/sec: 8031.91

  Total data:   14.31 MiB
  Size/request: 150 B
```

### Bun + Hono の結果

```text
Summary:
  Success rate: 100.00%
  Total:        3.8210 secs
  Slowest:      0.0315 secs
  Fastest:      0.0002 secs
  Average:      0.0038 secs
  Requests/sec: 26171.16

  Total data:   14.31 MiB
  Size/request: 150 B
```

## 考察と結論

結果は一目瞭然。**Bun + Honoは、Node.js + Expressの約3.2倍のスループット（8,031 req/sec → 26,171 req/sec）を叩き出した。**

レイテンシ（Average）を見ても、12msから3.8msへと激減している。これは、Bun内部のHTTPパーサーの優秀さと、Honoのルーティングの軽さ、そして標準Web API（Fetch）を通じたストリーム処理のオーバーヘッドの低さが見事に噛み合った結果と言える。

Edgeの制約（実行時間10ms制限や、特定ライブラリが動かない等）に引っかかる重い処理や、WebSocketをゴリゴリに使うリアルタイムサーバーの前段に置くリバースプロキシとして、この構成は現在**最強の選択肢の一つ**かもしれない。

TypeScriptでサクッと書けて、ビルド不要（Bunが直接実行）、しかもRustやGoに匹敵する速度が出る。このエコシステム、やっぱり進化のスピードが異次元だ。
