---
title: "BunとSQLiteで作る最速のAgent Memory（AI用コンテキストストレージ）の実装"
description: "AIエージェントの会話履歴とコンテキストをBunの高速なSQLiteバインディングで管理し、HonoでAPI化する実践的なアプローチ。"
date: "2026-04-25T17:03:00+09:00"
tags: ["Bun", "SQLite", "Hono", "TypeScript", "AI"]
---

## Agent Memoryの必要性

AIエージェントをローカルで動かす際、最大のボトルネックになるのが「コンテキストの永続化と検索」だ。API呼び出しのたびに数万トークンの過去ログをすべて送信するのはコスト的にも遅延的にも現実的ではない。

そこで、必要なのは**超高速に読み書きでき、ベクトル検索（またはFTS5）が可能なローカルDB**となる。今回は、Node.jsを捨ててBunを採用し、Bun組み込みの超速SQLiteバインディングを使ってAgent Memoryを実装・検証した。

## BunのSQLiteが圧倒的に速い理由

Bunの`bun:sqlite`は、C APIを直接叩くように設計されており、Node.jsの`better-sqlite3`と比較しても数倍のパフォーマンスが出る。特に、JSONのパースと文字列操作においてその真価を発揮する。

```typescript
import { Database } from "bun:sqlite";
import { z } from "zod";

const db = new Database("agent_memory.sqlite", { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec(`
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_session ON memories(session_id);
`);
```

`PRAGMA journal_mode = WAL;` は必須。これを忘れると並行書き込みで簡単にロックアウトされる。

## HonoとZodによる厳格なAPI

「TypeScriptで `any` は絶対許さない」。このスタンスを貫くため、HonoとZodを使ってリクエストとレスポンスの型を完全に縛る。

```typescript
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const app = new Hono();

const memorySchema = z.object({
  sessionId: z.string().uuid(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1),
});

const insertMemory = db.prepare(
  "INSERT INTO memories (id, session_id, role, content) VALUES ($id, $sessionId, $role, $content)"
);

app.post("/memory", zValidator("json", memorySchema), (c) => {
  const data = c.req.valid("json");
  
  insertMemory.run({
    $id: crypto.randomUUID(),
    $sessionId: data.sessionId,
    $role: data.role,
    $content: data.content,
  });

  return c.json({ success: true }, 201);
});
```

HonoのルーティングはBunのHTTPサーバーと完全に統合されているため、オーバーヘッドがほぼゼロだ。

## 実際のパフォーマンス測定

テストデータを10万件投入し、`session_id` で最新の50件を取得するクエリのレイテンシを計測した。

```bash
$ bun run benchmark.ts
[Bun SQLite] Insert 100k rows: 124ms
[Bun SQLite] Fetch latest 50 for session: 0.12ms
```

**0.12ms**。LLMへのAPIリクエスト（数秒かかる）に比べれば、全く無視できる数字だ。インメモリDB（Redisなど）をわざわざ立てる必要性が完全に消滅する。

## 次のステップ：FTS5によるキーワード抽出

単なるログの保存ならこれで十分だが、Agent Memoryとしては「関連する過去の文脈を引っ張り出す」機能が必要になる。

SQLiteのFTS5（Full-Text Search）拡張を使えば、ローカル環境でも軽量なRAG（Retrieval-Augmented Generation）が組める。次回は、このSQLiteデータベース上にFTS5の仮想テーブルを構築し、プロンプトの動的構築を実装していく。
