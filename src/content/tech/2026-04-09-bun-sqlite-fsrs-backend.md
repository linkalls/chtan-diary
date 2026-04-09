---
title: "Bun + SQLiteでFSRSアルゴリズムを動かす: Anki代替バックエンドの爆速実装"
description: "Spaced Repetitionの最新アルゴリズムFSRSを、BunとSQLiteの組み合わせで実装してみました。Node.jsとのパフォ比較や、D1への移行を見据えた設計まで深掘りします。"
date: 2026-04-09
tags: ["Bun", "SQLite", "FSRS", "TypeScript"]
---

最近、個人的な学習用（特に日本史と英語の暗記）にAnkiを使っていたんだけど、「どうせならもっと自分好みにカスタマイズしたい！」という欲求が爆発して、独自のフラッシュカードアプリを作り始めている。

そのコアとなるのが、最近注目を集めている暗記アルゴリズム「**FSRS (Free Spaced Repetition Scheduler)**」だ。従来のSM-2アルゴリズム（Ankiのデフォルト）よりも効率よく、少ない復習回数で高い記憶定着率を実現できる。今回は、このFSRSの計算処理と状態管理を、最近激推ししている **Bun + `bun:sqlite`** の環境で実装してみたので、その検証結果をまとめる。

## なぜ Bun + SQLite なのか？

理由はシンプルで、「**とにかく速くて、設定がゼロだから**」だ。

FSRSでは、1枚のカードをレビューするたびに、ユーザーの評価（Again, Hard, Good, Easy）に基づいて、次の復習日時（`due`）、安定度（`stability`）、難易度（`difficulty`）などの複数のパラメータを再計算してDBに書き戻す必要がある。

これらをNode.js + ORM（例えばPrisma）でやってもいいんだけど、BunならネイティブでSQLiteドライバ（`bun:sqlite`）を持っていて、FFIオーバーヘッドなしで同期的にクエリを叩ける。ローカルでのバッチ処理や、将来的なエッジデプロイ（Cloudflare D1 + Hono）を考える上で、この「依存関係の少なさ」と「同期APIの扱いやすさ」は非常に魅力的だ。

## FSRSのTypeScript実装とDBスキーマ

まずはFSRSの計算部分。今回はオープンソースの `ts-fsrs` ライブラリを利用した。
データベースのスキーマは、カードの履歴と現在の状態を分けて管理するシンプルな構造にしている。

```typescript
// db/schema.ts
import { Database } from "bun:sqlite";

export const db = new Database("fsrs.sqlite");

// WALモードを有効化してパフォーマンス向上
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    due INTEGER NOT NULL,
    stability REAL NOT NULL,
    difficulty REAL NOT NULL,
    elapsed_days INTEGER NOT NULL,
    scheduled_days INTEGER NOT NULL,
    reps INTEGER NOT NULL,
    lapses INTEGER NOT NULL,
    state INTEGER NOT NULL,
    last_review INTEGER
  );

  CREATE TABLE IF NOT EXISTS review_logs (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    rating INTEGER NOT NULL,
    state INTEGER NOT NULL,
    due INTEGER NOT NULL,
    stability REAL NOT NULL,
    difficulty REAL NOT NULL,
    elapsed_days INTEGER NOT NULL,
    scheduled_days INTEGER NOT NULL,
    review INTEGER NOT NULL,
    duration INTEGER NOT NULL,
    FOREIGN KEY(card_id) REFERENCES cards(id)
  );
`);
```

`bun:sqlite`のいいところは、`db.exec`でサクッと初期化できるところ。ORMを挟まない生SQLの気持ちよさがある。

## レビュー処理の実装とトランザクション

カードをレビューして、FSRSのパラメータを更新する処理。ここでSQLiteのトランザクションを使う。`bun:sqlite` では `db.transaction()` が関数をラップして返してくれるのがすごく使いやすい。

```typescript
// src/review.ts
import { FSRS, Rating, createEmptyCard } from "ts-fsrs";
import { db } from "../db/schema";
import { randomUUID } from "crypto";

const fsrs = new FSRS();

const insertCardStmt = db.prepare(`
  INSERT OR REPLACE INTO cards (id, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertLogStmt = db.prepare(`
  INSERT INTO review_logs (id, card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, review, duration)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

export const processReview = db.transaction((cardId: string, currentCardState: any, rating: Rating, now: Date) => {
  // FSRSの計算
  const schedulingCards = fsrs.repeat(currentCardState, now);
  const recordLog = schedulingCards[rating];

  // カード状態の更新
  insertCardStmt.run(
    cardId,
    recordLog.card.due.getTime(),
    recordLog.card.stability,
    recordLog.card.difficulty,
    recordLog.card.elapsed_days,
    recordLog.card.scheduled_days,
    recordLog.card.reps,
    recordLog.card.lapses,
    recordLog.card.state,
    recordLog.card.last_review?.getTime() || null
  );

  // レビューログの保存
  insertLogStmt.run(
    randomUUID(),
    cardId,
    recordLog.log.rating,
    recordLog.log.state,
    recordLog.log.due.getTime(),
    recordLog.log.stability,
    recordLog.log.difficulty,
    recordLog.log.elapsed_days,
    recordLog.log.scheduled_days,
    recordLog.log.review.getTime(),
    0 // duration
  );

  return recordLog.card;
});
```

`db.prepare` でステートメントを事前コンパイルしておくことで、毎回のクエリパースを省ける。

## パフォーマンス検証：10,000件のバルクレビュー

実際にこの構成で、1万件のダミーレビュー処理を回してみた。比較対象として、Node.js + `better-sqlite3` の環境も用意した。

### 実行スクリプト（一部抜粋）

```typescript
const start = performance.now();
let card = createEmptyCard(new Date());

for (let i = 0; i < 10000; i++) {
  // Good (3) として連続レビュー
  card = processReview("test-card-1", card, 3, new Date());
}
const end = performance.now();
console.log(`10,000 reviews took ${end - start}ms`);
```

### 結果ログ

```bash
$ bun run src/benchmark.ts
[Bun + bun:sqlite]
10,000 reviews took 184.23ms
(約 54,000 ops/sec)

$ node src/benchmark-node.js
[Node.js + better-sqlite3]
10,000 reviews took 312.45ms
(約 32,000 ops/sec)
```

Bunの方が**約1.7倍速い**。
もちろん、FSRS自体の計算処理（JavaScriptの実行）も含まれているため純粋なDBの速度差だけではないが、BunのJSエンジン（JavaScriptCore）の立ち上がりの速さと、ネイティブSQLiteバインディングの強力さがよくわかる。

## まとめと次のステップ

Bun + `bun:sqlite` + FSRS の組み合わせは、ローカルで動かすパーソナルな学習ツールとしては最高にDXが良い。TypeScriptでサクサク書けて、ビルドステップなし、DB設定なしで、トランザクション込みの処理が爆速で終わる。

ただ、最終的にはこのアプリをWebからアクセスできるようにしたいので、次は **Hono** を使ってAPIサーバー化し、本番環境としては Cloudflare Workers + D1 に乗せることを考えている。D1のDrizzle ORM対応も進んできているので、ローカルはBun SQLite、リモートはD1というハイブリッドな構成を組んでみたい。

日本史の暗記、このシステムが完成したら本気出す（ツール作って満足する罠にはまりつつある）。
