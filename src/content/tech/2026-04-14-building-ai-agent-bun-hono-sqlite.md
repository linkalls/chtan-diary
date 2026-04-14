---
title: "BunとHono、SQLiteで爆速のAIエージェントを作る"
description: "BunのネイティブSQLiteとHonoを組み合わせて、超軽量かつ高速なAIエージェントのバックエンドを構築する実践的なガイドです。"
date: "2026-04-14T16:03:00.000Z"
category: "tech"
tags: ["Bun", "Hono", "SQLite", "AI"]
---

## AIエージェントに求められる「速さ」と「軽さ」

AIエージェントを自作しようとしたとき、PythonやNode.jsを選ぶ人は多いと思います。ただ、ローカルで常駐させたり、小回りの効くツールとして使う場合、起動速度やメモリ消費量がネックになることがよくあります。

そこで今回は、**Bun** と **Hono** 、そしてBunに組み込まれている **ネイティブSQLite (`bun:sqlite`)** を使って、超軽量かつ爆速なAIエージェントのバックエンドを構築するアプローチを紹介します。

この組み合わせの最大のメリットは「依存関係の少なさ」と「圧倒的なコールドスタートの速さ」です。

### なぜBunとHonoなのか？

Bunは単なるランタイムではなく、パッケージマネージャー、テストランナー、そしてバンドラーを兼ね備えたオールインワンツールです。特に、SQLiteのドライバが標準で組み込まれているのが強力です。

HonoはEdge環境に最適化された軽量なWebフレームワークで、Bunとの相性も抜群です。この2つを組み合わせることで、ルーティングとデータ永続化を驚くほどシンプルに実装できます。

## 実装：エージェントのコアAPIを作る

さっそく、エージェントの記憶（Memory）を管理するためのシンプルなAPIを作ってみましょう。まずはSQLiteのセットアップからです。

```typescript
// db.ts
import { Database } from "bun:sqlite";

export const db = new Database("agent_memory.sqlite", { create: true });

// テーブルの初期化
db.run(`
  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    context TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
```

これだけでデータベースの準備は完了です。外部パッケージ（例えば `sqlite3` や `better-sqlite3`）をインストールする必要はありません。Bunのランタイムがすべて面倒を見てくれます。

### HonoでAPIルートを定義する

次に、Honoを使ってメモリを追加・取得するためのエンドポイントを定義します。

```typescript
// index.ts
import { Hono } from "hono";
import { db } from "./db";

const app = new Hono();

// メモリの追加
app.post("/memory", async (c) => {
  const body = await c.req.json();
  const context = body.context;

  if (!context) {
    return c.json({ error: "Context is required" }, 400);
  }

  const query = db.query("INSERT INTO memories (context) VALUES (?) RETURNING id");
  const result = query.get(context) as { id: number };

  return c.json({ success: true, id: result.id }, 201);
});

// メモリの取得
app.get("/memory", (c) => {
  const query = db.query("SELECT * FROM memories ORDER BY created_at DESC LIMIT 10");
  const memories = query.all();
  return c.json(memories);
});

export default {
  port: 3000,
  fetch: app.fetch,
};
```

これで、エージェントが過去の対話やコンテキストを保存・取得するためのAPIが完成しました。

## 実行と検証

実際にサーバーを起動して、エンドポイントを叩いてみます。

```bash
$ bun run index.ts
```

起動は一瞬です。APIにデータを投げてみましょう。

```bash
$ curl -X POST http://localhost:3000/memory \
  -H "Content-Type: application/json" \
  -d '{"context": "ユーザーはTypeScriptが好き"}'

{"success":true,"id":1}
```

ちゃんと保存されていますね。取得も試してみます。

```bash
$ curl http://localhost:3000/memory

[{"id":1,"context":"ユーザーはTypeScriptが好き","created_at":"2026-04-14 16:03:00"}]
```

圧倒的なレスポンス速度です。Bunの組み込みSQLiteはCで書かれたネイティブ実装を直接呼び出しているため、Node.js経由でのアクセスに比べてオーバーヘッドが極めて小さくなっています。

## まとめ：ローカルAI時代のスタンダード

AIエージェントのロジック自体が複雑化していく中で、バックエンドやインフラ側のオーバーヘッドは極力減らしたいところです。

Bun + Hono + `bun:sqlite` のスタックは、ローカルで動かすパーソナルAIや、エッジで動く軽量な推論サーバーのバックエンドとして、今後スタンダードになっていくポテンシャルを秘めています。

TypeScriptの型安全性を保ちながら、セットアップの手間をゼロにし、パフォーマンスを最大化する。この開発体験を一度味わうと、もう元の環境には戻れなくなります。
