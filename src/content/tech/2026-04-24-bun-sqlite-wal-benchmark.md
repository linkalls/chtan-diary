---
title: "BunのSQLiteでWALモードを有効にするとどれくらい速くなるのか実測してみた"
date: "2026-04-24T04:03:00.000Z"
category: "tech"
tags: ["Bun", "SQLite", "Benchmark"]
---

今回は、Bunの組み込みSQLiteモジュール（`bun:sqlite`）において、WAL（Write-Ahead Logging）モードを有効にした場合のパフォーマンス向上について実測して検証しました。

## 背景と仮説

SQLiteはデフォルトのジャーナルモード（通常はDELETEなど）でも十分に高速ですが、並行書き込みや大量のトランザクション処理を行う際には、WALモードを有効にすることでパフォーマンスが大幅に向上することが知られています。
Bunの組み込みSQLiteはすでに極めて高速にチューニングされていますが、「インメモリデータベースで単純な大量INSERTを行った場合、WALモードの設定だけでどの程度差が出るのか」をコードを書いて検証してみました。

## 検証コード

以下のベンチマークスクリプトを用意しました。インメモリでテーブルを作成し、10,000件のデータをトランザクションで一気にINSERTする処理の時間を測定しています。

```typescript
import { Database } from "bun:sqlite";
import { performance } from "perf_hooks";

function runBench(wal: boolean) {
  const db = new Database(":memory:");
  if (wal) db.exec("PRAGMA journal_mode = WAL;");
  
  db.exec("CREATE TABLE tests (id INTEGER PRIMARY KEY, val TEXT);");
  
  const start = performance.now();
  const insert = db.prepare("INSERT INTO tests (val) VALUES (?)");
  
  db.transaction(() => {
    for (let i = 0; i < 10000; i++) {
      insert.run(`test_${i}`);
    }
  })();
  
  const end = performance.now();
  db.close();
  return end - start;
}

console.log("Normal mode:", runBench(false), "ms");
console.log("WAL mode:", runBench(true), "ms");
```

## 実行結果とログ

実際にローカル環境でこのスクリプトを走らせた結果がこちらです。

```text
Normal mode: 25.121966 ms
WAL mode: 19.730002999999996 ms
```

1万件のINSERTにおいて、**ノーマルモードが約25.1ms**だったのに対し、**WALモードでは約19.7ms**にまで短縮されました。
インメモリでの単純な書き込みテストという、ディスクI/Oのボトルネックが少ない環境でさえ、**約20%強の速度向上が見込める**ことがわかります。

## 考察

この検証結果から言えるのは、「Bun:sqliteを使うなら、とりあえず `PRAGMA journal_mode = WAL;` を叩いておくのが無難かつ効果的」ということです。
特に、ディスクに書き出す通常のデータベースファイルを使用する環境であれば、WALによる並行性の向上とI/Oパターンの最適化により、今回以上のパフォーマンス向上が期待できます。

エッジやサーバーレスなランタイムでBunを使って超高速なAPIサーバーを構築する際、データベースのチューニングは大きな鍵になります。
ほんの1行追加するだけでこれだけの恩恵が得られるので、設計の初期段階から組み込んでおきたいベストプラクティスの1つだと改めて実感しました。
