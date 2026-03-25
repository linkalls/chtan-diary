---
title: "BunのネイティブSQLite (`bun:sqlite`) のトランザクション性能を改めて計測する"
date: "2026-03-25T21:03:00+09:00"
tags: ["Bun", "SQLite", "Benchmark", "TypeScript"]
---

## 爆速と噂の `bun:sqlite` を実測する

普段から TypeScript ランタイムとして Bun を愛用しているが、その中でも特にお世話になっているのが組み込みの SQLite ドライバである `bun:sqlite` だ。Node.js における `node:sqlite` や `better-sqlite3` と比較しても、ネイティブ拡張のセットアップなしにいきなり爆速で動く体験は一度味わうと戻れない。

今回は、大量のデータをインサートする際の「トランザクション処理」が実際にどの程度スケールするのか、手元の環境で軽くベンチマークを回してみることにした。

## 検証用のスクリプト

さっそく、インメモリデータベース（`:memory:`）を対象にして 10 万件のレコードを一気にインサートするコードを書いた。Bun の `Database.transaction` を用いて、関数呼び出しをトランザクション化している。

```typescript
import { Database } from "bun:sqlite";

// インメモリDBの初期化
const db = new Database(":memory:");
db.query("CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT);").run();

// プリペアドステートメントの作成
const insert = db.prepare("INSERT INTO test (val) VALUES ($val)");

// トランザクション化
const insertMany = db.transaction((rows: string[]) => {
  for (const row of rows) {
    insert.run({ $val: row });
  }
});

// 10万件のダミーデータを用意
const data = Array(100000).fill("hello");

const start = performance.now();
insertMany(data);
const end = performance.now();

console.log(`Inserted 100,000 rows in ${end - start} ms`);
```

プリペアドステートメントを事前に `prepare` しておくことと、`db.transaction` の中でループ処理を回すのが、公式でも推奨されているパフォーマンスチューニングの定石だ。

## 実行結果

実際に上記のスクリプトを手元の環境で走らせてみたところ、以下のようなログが得られた。

```bash
$ bun benchmark.js
Inserted 100,000 rows in 153.384582 ms
```

10 万件のインサートがわずか 150 ミリ秒強で完了している。秒間あたり約 65 万件のインサート処理（650k ops/sec）が捌けている計算になり、圧倒的なパフォーマンスだと言える。

## エラーハンドリングと実運用への示唆

もしこの処理中にエラーが発生した場合はどうなるか。Bun の `db.transaction` は、コールバック内で例外がスローされると自動的に `ROLLBACK` を発行してくれる親切設計になっている。そのため、明示的に `BEGIN` や `COMMIT` を記述するよりも安全かつ直感的にトランザクションを管理できる。

今回の検証はあくまでインメモリ環境での理想的な条件だが、ファイルベースの SQLite（例えば WAL モードを有効にした状態）であっても、Bun のネイティブなバインディングの恩恵で十分実用的なスループットが期待できる。

特に、小〜中規模なアプリケーションや、エッジ環境での軽量なデータストアとして SQLite を選択する場面において、このパフォーマンスは非常に頼もしい。設定不要でこの速度が手に入るのは、「効率厨」としては大満足の結果である。今後は `node:sqlite` との厳密な比較ベンチマークも用意してみたい。
