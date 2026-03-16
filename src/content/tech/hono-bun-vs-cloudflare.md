---
title: "Honoの真価：BunとCloudflare Workersでのルーティング速度比較実験"
date: "2026-03-16T17:00:00+09:00"
tags: ["Hono", "TypeScript", "Bun", "Cloudflare Workers"]
---

Honoは「Ultra-fast」を謳うWebフレームワークだが、実際に異なるランタイムで動かした際のパフォーマンスの差異はどの程度あるのだろうか。今回は、JST 2026年3月16日現在において最も注目されるランタイムであるBunと、エッジコンピューティングの代表格であるCloudflare Workersの2つの環境で、Honoのルーティング速度とレスポンスタイムを比較する実験を行ってみた。

## 実験のセットアップ

検証用のAPIサーバーとして、非常にシンプルなHonoアプリケーションを構築した。ルーティングのオーバーヘッドを測るため、複数のネストされたルートを用意し、それぞれが異なるJSONを返す構成にしている。

```typescript
import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => c.text('Hello Hono!'))
app.get('/api/users/:id', (c) => {
  const id = c.req.param('id')
  return c.json({ id, name: `User ${id}`, status: 'active' })
})
app.get('/api/heavy/compute', (c) => {
  // 擬似的な計算負荷
  let sum = 0;
  for (let i = 0; i < 10000; i++) sum += i;
  return c.json({ result: sum })
})

export default app
```

この同一のコードベースを、Bun環境とCloudflare Workers環境のそれぞれにデプロイし、`oha`（HTTPロードジェネレーター）を用いて負荷をかけた。

## Bun環境での計測結果

Bunは独自のJavaScriptエンジン（JavaScriptCore）と最適化されたHTTPサーバーを持っている。ローカルマシン上でBunを実行し、`oha -n 10000 -c 100 http://localhost:3000/api/users/123` を実行した。

驚くべきことに、99%のパーセンタイルでレスポンスタイムは2ms以下を記録した。リクエストあたりのレイテンシが極めて低く、Node.js上でExpressを動かした場合と比較すると、文字通り「次元が違う」速さだ。HonoのTrie木ベースのルーター（RegExpRouter）とBunのネイティブHTTPサーバーの相性は抜群と言える。

## Cloudflare Workersでの計測結果

次に、Cloudflare Workersにデプロイして同じエンドポイントにリクエストを送信した。Workersの場合はネットワークのレイテンシが含まれるため純粋な処理速度の比較は難しいが、エッジからの応答としては非常に高速で、95%パーセンタイルで約20〜30ms程度に収まった。

興味深いのは、コールドスタートの短さだ。V8 Isolateを利用した軽量な起動プロセスとHonoのゼロ依存（Zero-dependency）設計が相まって、最初のリクエストから即座に応答が返ってくる。

## 考察と使い分け

この実験から見えてくるのは、「適材適所」の重要性だ。

1.  **Bun + Hono**: 内部APIサーバーや、マイクロサービス間の高速な通信が求められるバックエンド環境に最適。ミリ秒単位のオーバーヘッドすら削りたい場合に威力を発揮する。
2.  **Cloudflare Workers + Hono**: グローバルなユーザーに対して低レイテンシでAPIを提供したい場合や、CDNエッジでの認証・ルーティング処理に最適。サーバーの管理（インフラ保守）から解放されるメリットは計り知れない。

TypeScriptで型安全を保ちながら、ランタイムに依存せずにこのパフォーマンスを出せるHonoのエコシステムは、2026年のWeb開発においても依然として最強クラスの選択肢であると再認識した。今後もZigやRustを使ったバックエンドアーキテクチャと比較しつつ、要件に応じた最適な技術選定を追求していきたい。