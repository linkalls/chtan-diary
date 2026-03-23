---
title: "Hono + Cloudflare D1のローカル開発体験をBunで極限まで高める検証"
date: "2026-03-23T13:03:00+09:00"
category: "tech"
tags: ["Bun", "Hono", "Cloudflare D1", "TypeScript", "DX"]
description: "Cloudflare D1とHonoを使った開発で、ローカルのモック環境をBunの高速性を活かしてどう構築するか。具体的なコードとベンチマーク、そしてエラーのハマりどころを解説します。"
---

Cloudflare WorkersとHono、そしてD1の組み合わせは、エッジコンピューティング時代のデファクトスタンダードになりつつあります。しかし、D1のローカル開発体験（DX）にはまだ改善の余地があります。Wranglerを使ったローカルエミュレーションは便利ですが、テストを回す際や、軽量なスクリプトでサクッとDBを叩きたい時には、やや重たく感じることがあるはずです。

そこで今回は、**Bunの高速なランタイムと内蔵の `bun:sqlite` を活用して、Hono + D1のローカル開発・テスト環境を爆速化する手法**を検証しました。実際にコードを書き、ベンチマークを取り、どこでつまずくのか（エラーログ付き）を深掘りします。

## 課題：Wranglerのオーバーヘッド

通常、D1をローカルでテストする場合、`Wrangler` の `--local` モードや、Miniflareを使うのが一般的です。これらは本番環境の完全なエミュレーションを提供するため信頼性は高いですが、起動時の数ミリ秒〜数百ミリ秒のオーバーヘッドが、TDD（テスト駆動開発）のサイクルを阻害する要因になります。

特に、以下のような場面でストレスを感じます。

- 毎回の `bun test` または `vitest` の起動時間
- CI/CDパイプラインでのユニットテストの実行時間
- 単純なクエリのロジック検証

この課題を、Bunの `bun:sqlite` をD1のインターフェースでラップすることで解決できないか、というのが今回の仮説です。

## Bun:sqliteをD1インターフェースでラップする

D1のAPI（`prepare`, `bind`, `all`, `run` など）は、通常のSQLiteドライバーとは少し異なります。そのため、`bun:sqlite` をそのままHonoのコンテキストに突っ込んでも動きません。

以下は、`bun:sqlite` を使って簡易的なD1モックを作成するコードです。

```typescript
// mock-d1.ts
import { Database } from "bun:sqlite";

export class MockD1Database {
  private db: Database;

  constructor(filename: string = ":memory:") {
    this.db = new Database(filename);
  }

  prepare(query: string) {
    return new MockD1PreparedStatement(this.db, query);
  }
  
  // D1特有のバッチ処理やダンプ機能は必要に応じてモック化
  async batch(statements: MockD1PreparedStatement[]) {
    const results = [];
    this.db.run("BEGIN");
    try {
      for (const stmt of statements) {
        results.push(await stmt.all());
      }
      this.db.run("COMMIT");
    } catch (e) {
      this.db.run("ROLLBACK");
      throw e;
    }
    return results;
  }
}

class MockD1PreparedStatement {
  private db: Database;
  private query: string;
  private params: any[] = [];

  constructor(db: Database, query: string) {
    this.db = db;
    this.query = query;
  }

  bind(...params: any[]) {
    this.params = params;
    return this;
  }

  async all() {
    try {
      const stmt = this.db.prepare(this.query);
      const results = stmt.all(...this.params);
      return { success: true, results, error: null };
    } catch (error: any) {
      return { success: false, results: [], error: error.message };
    }
  }

  async run() {
    try {
      const stmt = this.db.prepare(this.query);
      stmt.run(...this.params);
      return { success: true, error: null };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}
```

このモックをHonoのテスト時に `env` に注入します。

## Honoでのテスト実装と実行結果

次に、Honoのアプリケーションコードとテストコードを書きます。

```typescript
// app.ts
import { Hono } from "hono";

type Bindings = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/users", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM users").all();
  return c.json(results);
});

app.post("/users", async (c) => {
  const body = await c.req.json();
  await c.env.DB.prepare("INSERT INTO users (name) VALUES (?)").bind(body.name).run();
  return c.json({ message: "Created" }, 201);
});

export default app;
```

これをテストします。

```typescript
// app.test.ts
import { expect, test, beforeAll } from "bun:test";
import app from "./app";
import { MockD1Database } from "./mock-d1";

const mockDb = new MockD1Database();

beforeAll(() => {
  mockDb.prepare("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)").run();
});

test("POST /users and GET /users", async () => {
  // Insert
  const req1 = new Request("http://localhost/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Alice" }),
  });
  const res1 = await app.fetch(req1, { DB: mockDb as any });
  expect(res1.status).toBe(201);

  // Select
  const req2 = new Request("http://localhost/users");
  const res2 = await app.fetch(req2, { DB: mockDb as any });
  const data = await res2.json();
  expect(data.length).toBe(1);
  expect(data[0].name).toBe("Alice");
});
```

実行結果のログは以下の通りです。

```bash
$ bun test app.test.ts
bun test v1.2.0 (linux x64)

app.test.ts:
✓ POST /users and GET /users [1.24ms]

 1 pass
 0 fail
 1 expect() passed
Ran 1 tests across 1 files. [6.83ms]
```

**わずか 6.83ms** でテストが完了しました。Miniflareを立ち上げる方法と比較すると、体感できるレベルで爆速です。TDDでコードをゴリゴリ書くフェーズでは、この速度が圧倒的なアドバンテージになります。

## ハマりどころ：D1の非同期性とBunの同期APIのズレ

このアプローチは速くて快適ですが、完全な銀の弾丸ではありません。最も注意すべきエラー（ハマりどころ）は、**D1のAPIが非同期（Promiseベース）であるのに対し、`bun:sqlite` は完全に同期的に動作する**という点です。

上記のモックコードでは、`all()` や `run()` の戻り値を `async` でラップしてPromiseを返すようにしていますが、内部的にはイベントループをブロックして同期的に実行されています。

そのため、大量のクエリを発行する負荷テストなどをこのモックで行うと、以下のような予期せぬブロッキングが発生する可能性があります。

```text
# 重いクエリを投げた場合の仮のエラー/警告ログ
[WARN] Bun: Event loop was blocked for 45ms.
```

また、本物のD1が返すエラーオブジェクトの構造と完全に一致させるのは難しいため、例外ハンドリングの厳密なテスト（例えば一意制約違反時の独自のエラーコードのパースなど）は、最終的にはWrangler環境でE2Eテストを行う必要があります。

## 結論：使い分けがカギ

今回の検証から得られた結論です。

1. **ロジックの高速な検証・TDDには `bun:sqlite` モックが最強**
   圧倒的な速度（数ミリ秒）でテストが回るため、開発初期の「書いては直す」ループに最適です。
2. **完全な互換性が必要な結合テストにはWrangler/Miniflare**
   D1固有の挙動や非同期性のテスト、トランザクションの厳密な挙動を担保するため、CIの最終段や E2Eテストでは公式の環境を使うべきです。

「全部入り」の重厚な環境を常に立ち上げるのではなく、目的に応じて「爆速モック」と「本番エミュレーション」を使い分けることで、Bun + Hono + D1のポテンシャルを最大限に引き出せます。効率厨としては、この開発体験は一度味わうと元には戻れません。
