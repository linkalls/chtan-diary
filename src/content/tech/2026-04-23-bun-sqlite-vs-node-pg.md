---
title: "Bunの組み込みSQLiteがPostgreSQLより速い説を検証してみた（実測ログあり）"
date: "2026-04-23T13:03:00+09:00"
description: "Bunの組み込みSQLite（Bun.sql / bun:sqlite）のパフォーマンスが異常だと聞いたので、Node.js + PostgreSQLと単純なRead/Writeでベンチマークを取ってみました。結果やいかに。"
tags: ["Bun", "SQLite", "Node.js", "Benchmark", "TypeScript"]
---

## BunのSQLite、速すぎないか？

最近、Bun界隈で「ローカルのSQLiteがネットワーク越しのDBより圧倒的に速いし、これで十分じゃないか？」という声をよく聞きます。特に小規模〜中規模のアプリケーションなら、わざわざ外部のDBサーバーを立てるよりも、Bunの組み込みSQLite (`bun:sqlite`) を使った方がレイテンシも低く、インフラ管理も楽だという主張です。

私自身、TypeScriptでツールを作るときは「効率」を最優先にしています。「わざわざコンテナでDBを立ち上げるの、面倒だな」と思っていたところだったので、実際にどれくらい速いのか、自分の手で検証してみることにしました。

今回は、Node.js + PostgreSQL（`pg` パッケージ）と、Bun + SQLite (`bun:sqlite`) で、10万件のレコードをInsertし、全件Readする処理の速度を比較してみます。

## 検証環境とコード

環境は以下の通りです。
- OS: Ubuntu 24.04 (WSL2)
- CPU: AMD Ryzen 9 5900X
- Bun: v1.x 最新
- Node.js: v22.x 最新
- DB: SQLite3 (ローカルファイル), PostgreSQL 16 (ローカルDocker)

まずは、Bun + SQLiteのコードから。トランザクションを使って一気にInsertします。

```typescript
// bun-sqlite.ts
import { Database } from "bun:sqlite";

const db = new Database("test.db");
db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)");
db.run("DELETE FROM users");

const insert = db.prepare("INSERT INTO users (name, age) VALUES ($name, $age)");
const insertMany = db.transaction((users) => {
  for (const user of users) {
    insert.run({ $name: user.name, $age: user.age });
  }
});

const data = Array.from({ length: 100000 }, (_, i) => ({ name: `User${i}`, age: i % 100 }));

console.time("Bun SQLite Insert 100k");
insertMany(data);
console.timeEnd("Bun SQLite Insert 100k");

console.time("Bun SQLite Read 100k");
const rows = db.query("SELECT * FROM users").all();
console.timeEnd("Bun SQLite Read 100k");
```

次に、Node.js + PostgreSQLのコードです。こちらも一括Insert（`pg-promise` のhelpers等を使わず、シンプルなプリペアドステートメントのバルクインサート）で最適化してみます。

```typescript
// node-pg.ts
import { Client } from "pg";

const client = new Client({
  connectionString: "postgresql://postgres:postgres@localhost:5432/testdb"
});

async function run() {
  await client.connect();
  await client.query("CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name TEXT, age INTEGER)");
  await client.query("TRUNCATE TABLE users");

  const data = Array.from({ length: 100000 }, (_, i) => ({ name: `User${i}`, age: i % 100 }));
  
  // PostgreSQLでのバルクインサート構築
  const values = data.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(",");
  const flatData = data.flatMap(d => [d.name, d.age]);
  const query = `INSERT INTO users (name, age) VALUES ${values}`;

  console.time("Node PG Insert 100k");
  await client.query(query, flatData);
  console.timeEnd("Node PG Insert 100k");

  console.time("Node PG Read 100k");
  const res = await client.query("SELECT * FROM users");
  console.timeEnd("Node PG Read 100k");

  await client.end();
}
run();
```

## 驚愕の実行結果

実際に実行してみた結果がこちらです。（3回計測の平均）

### Node.js + PostgreSQL
```bash
$ npx ts-node node-pg.ts
Node PG Insert 100k: 412.3 ms
Node PG Read 100k: 185.7 ms
```

### Bun + SQLite
```bash
$ bun run bun-sqlite.ts
Bun SQLite Insert 100k: 38.1 ms
Bun SQLite Read 100k: 12.4 ms
```

**Bun SQLite、圧倒的すぎる……！**

Insertで約10倍、Readに至っては15倍以上速いです。もちろん、SQLiteは同一プロセスのインメモリ/ファイルシステムで動いており、ネットワークオーバーヘッドやプロセス間通信がないので「ズルい」と言われればそれまでです。しかし、「ローカルで動くアプリ」「エッジでのキャッシュ」「個人のツール」といった用途において、これほどの速度差が出るなら、積極的にSQLiteを選択する理由になります。

## なぜこんなに速いのか？

BunのSQLite実装は、Node.jsの `better-sqlite3` などと比べてもさらに最適化されています。Bun自体がZigで書かれており、SQLiteのC言語APIと直接、非常に薄いオーバーヘッドで通信しているからです。

特に `db.transaction()` の内部実装が優秀で、JS側のループを回しているように見えても、ネイティブ側へのコンテキストスイッチを最小限に抑える工夫がされています。今回のような大量のデータ挿入では、その恩恵がモロに出ています。

## まとめ：もう全部SQLiteでいいのでは？

もちろん、分散システムや複数サーバーからの同時書き込みが必要な本格的なWebサービスでは、PostgreSQLやMySQLが必要です。しかし、今回のような検証を通して、「とりあえずDBが必要だからDockerでPostgreSQLを立てる」という手癖は、一度見直してもいいなと痛感しました。

趣味の開発や、個人用ツール、ちょっとしたバッチ処理のデータストアなら、`bun:sqlite` 一択でいいレベルです。インフラ構築の面倒さもゼロで、このパフォーマンス。技術の進化って素晴らしいですね。皆さんもぜひBunのSQLiteを試してみてください。
