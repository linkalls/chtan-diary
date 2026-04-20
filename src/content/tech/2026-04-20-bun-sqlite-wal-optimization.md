---
title: "Bun + SQLiteのWALモード最適化: 高頻度書き込み時のパフォーマンスチューニングと実証"
description: "AIエージェントのログやステート管理など、高頻度でSQLiteに書き込む際のBunのパフォーマンスチューニング。WALモードと同期設定によるスループットの劇的な改善を検証します。"
date: "2026-04-20T21:03:00+09:00"
category: "tech"
tags: ["Bun", "SQLite", "Performance", "Agent"]
---

AIエージェントの自律稼働ループや、大量のイベントログをローカルで処理するシステムにおいて、**Bun + SQLite** の組み合わせは事実上のスタンダードになりつつあります。しかし、デフォルト設定のままでは高頻度な並行書き込み時に `database is locked` エラー（SQLITE_BUSY）が発生したり、I/O待ちによるパフォーマンス低下を招くことがあります。

本記事では、Bunの `bun:sqlite` を使用し、**WAL（Write-Ahead Logging）モード** とその他のPragma設定を最適化することで、書き込みスループットを限界まで引き上げる手法を検証します。

## 結論から言うと

SQLiteのパフォーマンスを劇的に改善する黄金の設定（Bun向け）は以下の通りです。

```typescript
import { Database } from "bun:sqlite";

const db = new Database("agent_memory.db");

// 黄金のPragma設定
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA synchronous = NORMAL;");
db.exec("PRAGMA busy_timeout = 5000;");
db.exec("PRAGMA temp_store = MEMORY;");
db.exec("PRAGMA mmap_size = 30000000000;");
```

この数行を追加するだけで、デフォルトの `DELETE` ジャーナルモードと比較して、**書き込みスループットが約3倍〜5倍** に跳ね上がります。

## なぜデフォルトでは遅いのか？

SQLiteのデフォルトのジャーナルモードは `DELETE` です。これはトランザクションごとにロールバックジャーナルを作成し、コミット時に削除するという堅牢な仕組みですが、ディスクI/Oのオーバーヘッドが非常に大きくなります。

さらに、`synchronous = FULL`（デフォルト）では、書き込みごとにOSのfsyncを呼び出し、ディスクへの物理的な書き込み完了を待ちます。AIの推論ログやテンポラリなステート管理など、数ミリ秒単位での永続化が求められるケースでは、これが致命的なボトルネックとなります。

## ベンチマーク：設定ごとのスループット比較

実際にBunを使って、10万件のレコードをInsertするベンチマークを実行してみました。

### 計測用コード (`benchmark.ts`)

```typescript
import { Database } from "bun:sqlite";
import { unlinkSync } from "node:fs";

function runBenchmark(name: string, pragmas: string[]) {
  const dbFile = `test_${name}.db`;
  try { unlinkSync(dbFile); } catch {}
  
  const db = new Database(dbFile);
  for (const p of pragmas) {
    db.exec(p);
  }

  db.exec("CREATE TABLE logs (id INTEGER PRIMARY KEY, msg TEXT, ts DATETIME DEFAULT CURRENT_TIMESTAMP)");

  const insert = db.prepare("INSERT INTO logs (msg) VALUES (?)");
  
  const start = performance.now();
  
  // 10万件のInsert（トランザクションで囲むと速すぎるため、あえて1件ずつ）
  for (let i = 0; i < 100000; i++) {
    insert.run(`Log message number ${i}`);
  }
  
  const end = performance.now();
  console.log(`[${name}] Time: ${(end - start).toFixed(2)} ms`);
  
  db.close();
}

console.log("--- SQLite Insert Benchmark (100,000 rows) ---");

// 1. デフォルト設定
runBenchmark("default", []);

// 2. WALのみ
runBenchmark("wal", [
  "PRAGMA journal_mode = WAL;"
]);

// 3. 黄金の設定 (WAL + NORMAL + etc)
runBenchmark("optimized", [
  "PRAGMA journal_mode = WAL;",
  "PRAGMA synchronous = NORMAL;",
  "PRAGMA temp_store = MEMORY;"
]);
```

### 実行結果とログ

```bash
$ bun run benchmark.ts
--- SQLite Insert Benchmark (100,000 rows) ---
[default] Time: 12450.32 ms
[wal] Time: 4820.15 ms
[optimized] Time: 2150.88 ms
```

ご覧の通りです。
- **デフォルト**: 約12.5秒
- **WALのみ**: 約4.8秒（2.5倍高速化）
- **最適化（WAL + NORMAL）**: 約2.1秒（**約6倍高速化**）

## 各Pragmaの役割と実務判断

それぞれの設定がなぜ効くのか、実務上どう判断すべきかをまとめます。

### 1. `PRAGMA journal_mode = WAL;`
- **効果**: リードとライトのブロックを無くす。書き込みはWALファイルに追記されるため速い。
- **判断**: ほぼすべてのユースケースで必須。ただし、NFSなどのネットワークドライブ上では動作が不安定になるため、ローカルストレージ限定です。

### 2. `PRAGMA synchronous = NORMAL;`
- **効果**: `FULL` はディスク同期を完全に待つが、`NORMAL` はWALの同期タイミングを緩める。
- **判断**: OSがクラッシュした際に最新の数トランザクションを失うリスクがありますが、アプリケーションのクラッシュではデータは失われません。AIの思考ログやキャッシュであれば `NORMAL` で全く問題ありません。決済データなど絶対ロストが許されない場合は `FULL` を維持してください。

### 3. `PRAGMA temp_store = MEMORY;`
- **効果**: 一時テーブルやインデックス作成時のソート用ストレージをディスクではなくRAMに置く。
- **判断**: 複雑な `ORDER BY` や `GROUP BY` を多用する分析系クエリで劇的な効果があります。メモリに余裕のあるサーバーなら推奨。

### 4. `PRAGMA busy_timeout = 5000;`
- **効果**: DBがロックされている際、即座にエラーを吐くのではなく、指定ミリ秒（5秒）だけリトライしながら待機する。
- **判断**: Bunのマルチスレッド（Worker）や別プロセスから同時にSQLiteを触る場合、これがないと `database is locked` 祭りが起きます。必須設定です。

## まとめ

Bunの `bun:sqlite` はもともとNode.jsの `better-sqlite3` などより高速ですが、SQLite自体のPragmaチューニングを行うことで、そのポテンシャルを完全に引き出すことができます。

特に `journal_mode = WAL` と `synchronous = NORMAL` の組み合わせは、ローカルファーストなアプリケーションや自律型AIエージェントの記憶領域（Vector検索やJSONログの保存）において、圧倒的なパフォーマンスをもたらします。

プロジェクトの初期段階で、DB初期化コードに数行足すだけで未来のI/Oボトルネックを防げるので、ぜひテンプレート化しておきましょう。
