---
title: "Redis入門：Bun + Hono + bun.redis で爆速データ基盤を構築する"
description: "Redisの基礎から、Bun v1.3+ の新機能 bun.redis を使った Hono アプリの実装までを徹底解説。"
pubDate: "2026-03-19"
category: "tech"
tags: ["Redis", "Bun", "Hono", "TypeScript", "Backend"]
---

最近、Bun のエコシステムが凄まじい勢いで進化している。特に **Bun v1.3** 以降で安定した `bun.redis` は、Node.js の `ioredis` や `redis` クライアントを置き換えるポテンシャルを秘めている。

今回は、単なる Redis の使い方に留まらず、**「なぜ今 Redis なのか？」** という背景から、Hono と組み合わせた具体的なアーキテクチャまでを深掘りしていく。

## なぜ今、Redis なのか？

現代のウェブアプリケーションにおいて、データベース（RDB）はボトルネックになりやすい。ディスクI/Oが発生し、複雑なクエリはCPUを消費する。ここで登場するのが **Redis (Remote Dictionary Server)** だ。

Redis はメモリ上で動作するキーバリューストアであり、その読み書き速度は RDB とは比較にならない。しかし、単なる「速いDB」として使うのはもったいない。

1. **キャッシュレイヤー**: 重い計算結果やDBクエリを一時保存。
2. **分散ロック**: 複数サーバー間での排他制御。
3. **Pub/Sub**: リアルタイムなメッセージング。
4. **Rate Limiting**: APIの利用制限。

これらを **シングルスレッドイベントループ** というシンプルかつ強力なモデルで実現しているのが Redis の美学だ。

---

## Bun + Hono + bun.redis の最強スタック

僕たちが選ぶべきスタックは、**Bun** と **Hono** だ。
Bun はランタイム自体に Redis クライアント（`bun.redis`）を内蔵しており、追加の依存関係なしに高速な通信が可能になっている。

### 1. 環境構築

まずは Bun プロジェクトを初期化し、Hono を導入する。

```bash
mkdir redis-hono-lab
cd redis-hono-lab
bun init -y
bun add hono
```

Redis サーバーは Docker でサクッと立てるのが一番楽だ。

```bash
docker run -d -p 6379:6379 --name redis-lab redis
```

### 2. bun.redis を使った基本操作

`bun.redis` は標準の Redis コマンドをほぼ網羅している。

```typescript
import { redis } from "bun";

const client = redis({
  hostname: "localhost",
  port: 6379,
});

// 値のセット
await client.set("user:1:name", "Poteto");

// 値の取得
const name = await client.get("user:1:name");
console.log(`Hello, ${name}!`);

// 有期限（TTL）付きのセット
await client.set("session:token", "xyz123", { ex: 3600 });
```

---

## Hono で実装する「インテリジェント・キャッシュ」

実際のアプリケーションでは、DBからの取得結果をキャッシュするパターンが多い。これを Hono のミドルウェア風に抽象化してみる。

### アーキテクチャ図

1. クライアントが `/user/:id` にアクセス。
2. Redis にデータがあるか確認（Cache Hit）。
3. なければ DB (今回は疑似コード) から取得。
4. 取得した結果を Redis に保存（Cache Miss & Fill）。
5. クライアントにレスポンス。

### 実装コード

```typescript
import { Hono } from "hono";
import { redis } from "bun";

const app = new Hono();
const cache = redis();

// 疑似的なDB取得関数
const fetchUserFromDB = async (id: string) => {
  console.log("--- DB Query Executed ---");
  await new Promise(resolve => setTimeout(resolve, 500)); // 遅延をシミュレート
  return { id, name: `User ${id}`, email: `${id}@example.com` };
};

app.get("/user/:id", async (c) => {
  const id = c.req.param("id");
  const cacheKey = `user:${id}`;

  // 1. キャッシュチェック
  const cachedData = await cache.get(cacheKey);
  if (cachedData) {
    console.log("--- Cache Hit! ---");
    return c.json(JSON.parse(cachedData));
  }

  // 2. キャッシュがなければDBから取得
  const user = await fetchUserFromDB(id);

  // 3. 次回のためにキャッシュ（TTL 60秒）
  await cache.set(cacheKey, JSON.stringify(user), { ex: 60 });

  return c.json(user);
});

export default {
  port: 3000,
  fetch: app.fetch,
};
```

---

## 深掘り：Redis のデータ構造を使い倒す

Redis は String だけじゃない。**Hash** や **Sorted Set** を使うことで、より高度なロジックを Redis 側にオフロードできる。

### ランキングシステムの構築（Sorted Set）

例えば、ゲームのハイスコアランキングを作る場合、RDBだと `ORDER BY` が重くなる。Redis の `ZSET` を使えば一瞬だ。

```typescript
// スコアの追加
await cache.zadd("leaderboard", 1500, "player_a");
await cache.zadd("leaderboard", 2000, "player_b");

// トップ3の取得
const topPlayers = await cache.zrange("leaderboard", 0, 2, {
  rev: true,
  withScores: true,
});
console.log(topPlayers);
```

### 考察：bun.redis のパフォーマンス

`bun.redis` は Rust で書かれた Bun のコアに直結しているため、Node.js 経由で JS のラッパーを介すよりもオーバーヘッドが少ない。
特に **パイプライン（Pipelining）** を使った一括送信時のスループットは圧倒的だ。

```typescript
// パイプラインの例
const results = await cache.pipeline([
  ["set", "key1", "val1"],
  ["get", "key1"],
  ["incr", "counter"]
]);
```

---

## 次の一手：分散ロックとレートリミッター

今後、このスタックをさらに活用するなら、**Redlock アルゴリズム** を使った分散ロックの実装や、Hono ミドルウェアとしての **Fixed Window / Sliding Window レートリミッター** の自作に挑戦したい。

Redis は単なる「道具」ではなく、インフラの「神経系」だ。
Bun + Hono というモダンな武器を手に入れた今、僕たちはもっと大胆に、もっと高速なアプリケーションを設計できるはずだ。

さて、次はどのデータ構造をハックしようか？
