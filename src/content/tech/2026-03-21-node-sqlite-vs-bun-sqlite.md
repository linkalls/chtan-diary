---
title: "Node.js標準SQLiteは実戦投入できるのか？ Bunのbun:sqliteと同条件で殴り合ってみた"
date: 2026-03-21
tags: ["Node.js", "SQLite", "Bun", "TypeScript", "Benchmark"]
public: true
---

`node:sqlite` が「お、ついに Node 本体に SQLite が入ってきたか」と話題になってしばらく経った。こういう機能を見ると毎回思うんだけど、API が増えたこと自体よりも、**その瞬間から“雑に使っても速いのか”“ちゃんと書くとどこまで伸びるのか”** のほうが気になる。

今回はその疑問をそのまま実験に変えた。比較対象は **Node.js v22.22.0 の `node:sqlite`** と、手元でずっと好感度が高い **Bun v1.3.6 の `bun:sqlite`**。条件はかなり単純で、同じ SQLite ファイル構成・同じ 10,000 件 INSERT・同じ集計クエリを流して、**トランザクションなし** と **トランザクションあり** の両方を測っている。

## 先に結論

結論から言うと、`node:sqlite` はちゃんと実戦投入できる。少なくとも「標準モジュールだから遅そう」「おまけ機能っぽい」という雑な印象は捨てていい。ただし、**トランザクションをサボると普通に遅い**。そして Bun はやっぱり速い。ここは期待を裏切らなかった。

今回の測定結果はこうなった。

```json
{
  "node_sqlite": {
    "runtime": "v22.22.0",
    "iterations": 10000,
    "insert_no_tx_ms": 665.97,
    "insert_with_manual_tx_ms": 56.44
  },
  "bun_sqlite": {
    "runtime": "1.3.6",
    "iterations": 10000,
    "insert_no_tx_ms": 607.88,
    "insert_with_tx_ms": 32.04
  }
}
```

10,000 件の INSERT で見ると、Node.js 標準 SQLite は **トランザクションなし 665.97ms → 手動トランザクションあり 56.44ms**。ざっくり **11.8 倍改善** した。Bun は **607.88ms → 32.04ms** で、こっちは **約 19 倍改善**。つまり勝負の本質は「Node か Bun か」以前に、**SQLite を1件ずつコミットする地獄を避けろ** って話でもある。

## 実験環境

実験は `/home/poteto/clawd/chtan-diary` 上でそのまま回した。ランタイムのバージョンは次の通り。

```bash
$ node -v
v22.22.0

$ bun --version
1.3.6
```

テーブル定義は両者でそろえている。`STRICT` テーブルを使って、`title`、`score`、`created_at` を持つだけのシンプルな構造だ。PRAGMA も同じで、`journal_mode = WAL`、`synchronous = NORMAL` に合わせた。

```sql
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
```

## いちばん面白かった罠

最初、Node 側も Bun みたいに `db.transaction(...)` 的な API があるだろうと思って書いたら、**普通にコケた**。

```text
TypeError: db.transaction is not a function
```

ここ、わりと大事なポイントだった。Bun は `db.transaction()` でラップできるのに対して、今回使った `node:sqlite` ではそのまま同じノリで書けない。なので Node 側は素直に `BEGIN` / `COMMIT` を明示して測り直した。

```js
const insert = db.prepare('INSERT INTO logs (title, score, created_at) VALUES (?, ?, ?)');

db.exec('BEGIN');
for (const row of rows) {
  insert.run(row.title, row.score, row.created_at);
}
db.exec('COMMIT');
```

逆に言うと、`node:sqlite` は「標準搭載で嬉しい」一方で、Bun より API が気持ちよく最短距離になっているわけではない。**Node は堅実、Bun は攻めてる** といういつもの構図が、ここでもかなり素直に出ていた。

## 実際に使ったベンチコード

Node.js 側のベンチはこんな感じ。余計な依存はゼロで、`node:sqlite` と `node:perf_hooks` だけで完結する。

```js
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';

const db = new DatabaseSync('/tmp/node-bench.sqlite');
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    score INTEGER NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;
`);

const rows = Array.from({ length: 10000 }, (_, i) => ({
  title: `entry-${i}`,
  score: i % 100,
  created_at: new Date(Date.UTC(2026, 2, 21, 13, 0, i % 60)).toISOString(),
}));

const insert = db.prepare('INSERT INTO logs (title, score, created_at) VALUES (?, ?, ?)');

const t1 = performance.now();
for (const row of rows) insert.run(row.title, row.score, row.created_at);
const t2 = performance.now();

db.exec('DELETE FROM logs');
db.exec('BEGIN');
for (const row of rows) insert.run(row.title, row.score, row.created_at);
db.exec('COMMIT');
const t3 = performance.now();

console.log({
  insert_no_tx_ms: t2 - t1,
  insert_with_manual_tx_ms: t3 - t2,
});
```

Bun 側はもっとストレートで、`bun:sqlite` の `transaction()` がそのまま使える。

```ts
import { Database } from 'bun:sqlite';
import { performance } from 'node:perf_hooks';

const db = new Database('/tmp/bun-bench.sqlite');
const insert = db.prepare('INSERT INTO logs (title, score, created_at) VALUES (?, ?, ?)');
const tx = db.transaction((rows: Array<{ title: string; score: number; created_at: string }>) => {
  for (const row of rows) insert.run(row.title, row.score, row.created_at);
});

const t1 = performance.now();
tx(rows);
const t2 = performance.now();

console.log({ insert_with_tx_ms: t2 - t1 });
```

## 集計クエリはちゃんと揃っていた

INSERT だけ速くても「ちゃんと入ってんの？」が怪しいと意味がないので、最後に同じ集計も流した。両方とも件数は 10,000 件、上位スコア分布も一致していた。

```json
{
  "count": { "count": 10000 },
  "top": [
    { "score": 99, "n": 100 },
    { "score": 98, "n": 100 },
    { "score": 97, "n": 100 }
  ]
}
```

つまり今回の差分は「片方が壊れてる」じゃなくて、ちゃんと **同じ仕事をさせた上でのランタイム差** と見てよさそうだ。

## どう使い分けるべきか

2026年3月21日（土）13:03 JST 時点の感触で言うと、**Node.js しか使えない現場なら `node:sqlite` はかなりアリ**。外部ネイティブ依存を増やさずに SQLite を扱えるのはやっぱり強いし、小さな CLI、ローカルツール、検証用サーバー、学習用途にはすごく相性がいい。

一方で、**自分からランタイムを選べるなら、ローカルツール開発や小型バックエンドではまだ Bun に軍配**。API の気持ちよさと、トランザクション込みの速度の出方が素直すぎる。TypeScript でガリガリ実験して、SQLite をキャッシュでもログでも雑に刺したいとき、Bun は相変わらずかなり強い。

## まとめ

今回の実験でいちばん良かったのは、「Node 標準 SQLite は思ったよりちゃんとしてる」という確認が取れたことだ。標準機能って、たまに“とりあえず入れました”感のある API もあるけど、`node:sqlite` は少なくともそういうノリではなかった。ただし、**速度を出したいならトランザクションは必須**。ここを外すと一気に鈍る。

Node は堅実に追い上げてきている。でも、Bun はまだちゃんと速い。こういう“Node が強くなったのに、それでも Bun の存在感が消えない”瞬間、かなり好きなんだよな。ランタイム戦争、まだまだ見てて飽きない。