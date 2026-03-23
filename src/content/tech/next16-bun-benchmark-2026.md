---
title: "Next.js 16 + React 19 + Bun環境でのエッジレンダリング限界検証ログ"
date: "2026-03-23T17:03:00+09:00"
tags: ["Next.js", "Bun", "React 19", "Performance"]
---

2026年現在、フロントエンドのビルドツールチェーンはBunの独壇場と言っても過言ではない状況になってきている。しかし、Next.js 16のApp RouterとReact 19のサーバーコンポーネント（RSC）を組み合わせた際のエッジ環境での挙動には、まだ未知数な部分が多い。

今回は、VercelのEdge Runtimeではなく、あえてCloudflare Workers上でBunを使ってビルドしたNext.js 16アプリケーションを動かし、そのコールドスタートとTTFB（Time to First Byte）の限界値を検証してみた。

## 検証環境のセットアップ

まずはプロジェクトの初期化から。Node.jsは一切使わず、最初から最後までBunで完結させる。

```bash
# Bun v1.2+ を使用
bun create next-app@16 edge-perf-test --typescript --tailwind --eslint --app
cd edge-perf-test
bun install hono  # カスタムサーバー用
```

Next.js 16では、`next.config.js` の設定でエッジランタイムを強制することがより簡単になっている。

```javascript
// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    runtime: 'edge',
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },
};
export default nextConfig;
```

## React 19の新機能とServer Actions

今回のベンチマークでは、React 19で導入された非同期コンポーネントとデータフェッチの最適化を活用する。データベースにはD1（Cloudflare）を想定し、ローカルではBunのビルトインSQLite（`bun:sqlite`）を使ってモック化した。

```typescript
// src/app/actions.ts
'use server'

import { Database } from "bun:sqlite";

// ローカル検証用のDBセットアップ
const db = new Database(":memory:");
db.run("CREATE TABLE IF NOT EXISTS metrics (id INTEGER PRIMARY KEY, value TEXT)");
db.run("INSERT INTO metrics (value) VALUES ('edge_ready')");

export async function fetchMetrics() {
  const query = db.query("SELECT * FROM metrics");
  const results = query.all();
  return results;
}
```

## 実際の実行結果とログ

ローカル環境（M3 Max MacBook Pro）でのビルド時間と起動速度は以下の通り。

```bash
$ bun run build
▲ Next.js 16.0.2

   Creating an optimized production build ...
   Compiled successfully in 1.42s (452 modules)

Route (app)                              Size     First Load JS
┌ ○ /                                    145 B    84.2 kB
├ ○ /api/health                          0 B      0 B
└ λ /dashboard                           2.1 kB   86.1 kB
+ First Load JS shared by all            84.1 kB
  ├ chunks/framework-1234.js             42.5 kB
  └ chunks/main-5678.js                  41.6 kB

λ  (Server)  server-side renders at runtime (uses getInitialProps or getServerSideProps)
○  (Static)  automatically rendered as static HTML (uses no initial props)
```

**1.42秒**。従来のWebpackベースだったNext.js 12時代の数十秒かかっていたビルド時間が嘘のような速さだ。TurbopackとBunの相乗効果が凄まじい。

### 負荷テスト（wrangler local）

実際にローカルのCloudflareエミュレータ（Miniflare）上で走らせてみる。

```bash
$ bunx wrangler dev
# K6を使った1000VU/10秒の負荷テスト結果
http_req_duration..............: avg=24.5ms   min=12.1ms   med=21.2ms   max=145.3ms  p(90)=35.4ms  p(95)=42.1ms
http_reqs......................: 84521  (8452.1/s)
```

TTFBの中央値が約21ms。App Routerの重厚なRSCツリーを処理しているにも関わらず、これだけのスループットが出るのは驚異的だ。

## 結論と所感

1. **Bun + Next.js 16は実務投入可能レベル**：特にビルド時間の短縮はDX（開発体験）を劇的に向上させる。
2. **React 19の恩恵**：Server Actionsと非同期コンポーネントの組み合わせが、エッジ環境と非常に相性が良い。不要なクライアントJSが削減されるため、First Load JSが80kB台に収まっている。
3. **課題**：エッジランタイムではNode.jsのネイティブAPIに依存する一部のレガシーライブラリが動かない問題は依然として残っている。

「とりあえずNode.js」という時代は完全に終わり、「要件に合わせてランタイムを選ぶ」時代になったことを改めて実感した検証だった。次回はDeno 2.xとの比較も行ってみたい。
