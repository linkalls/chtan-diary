---
title: "Bun + SQLiteでゼロレイテンシのCLIツールを作る：commanderと組み合わせた超速体験"
date: "2026-04-14T17:03:00.000+09:00"
category: "tech"
tags: ["Bun", "SQLite", "CLI", "TypeScript"]
---

Node.jsからBunへの移行が進む中、特に劇的な体験向上をもたらすのが「CLIツールの開発」だ。起動時間の短さに加え、標準で組み込まれている `bun:sqlite` の圧倒的なパフォーマンスが、これまでのCLI開発の常識を覆しつつある。

今回は、TypeScriptと `commander`、そして `bun:sqlite` を使って、超高速に動作するローカルタスク管理CLIを構築する検証を行った。その結果と実装の要点、そして実際の実行ログをまとめていく。

## なぜBunでCLIを作るのか？

CLIツールにとって「起動速度（Cold Start）」は命だ。Node.jsでTypeScriptを実行しようとすると、どうしても `ts-node` やビルドステップが必要になり、ワンテンポ遅れる感覚がある。GoやRustで書き直すアプローチもあるが、フロントエンドエンジニアにとってTypeScriptの資産やエコシステム（Zodなど）をそのまま使えるのは大きなメリットだ。

BunはTypeScriptをネイティブで実行でき、起動速度はNode.jsの数倍〜数十倍に達する。さらに `bun:sqlite` はネイティブバインディングされており、ローカルに状態を持つCLIツール（メモ帳、タスク管理、履歴保存など）と非常に相性が良い。

## 実装：commander + bun:sqlite

実際に簡単なCLIツール（`task-cli`）を実装してみた。以下はエントリポイントのコードだ。

```typescript
// index.ts
import { Command } from 'commander';
import { Database } from 'bun:sqlite';

const db = new Database('tasks.sqlite', { create: true });
db.query('CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, title TEXT, done BOOLEAN)').run();

const program = new Command();

program
  .name('task-cli')
  .description('Ultra-fast task manager powered by Bun & SQLite')
  .version('1.0.0');

program
  .command('add <title>')
  .description('Add a new task')
  .action((title) => {
    const start = performance.now();
    db.query('INSERT INTO tasks (title, done) VALUES (?, ?)').run(title, false);
    const end = performance.now();
    console.log(`✅ Added: "${title}" (in ${(end - start).toFixed(2)}ms)`);
  });

program
  .command('list')
  .description('List all tasks')
  .action(() => {
    const start = performance.now();
    const tasks = db.query('SELECT * FROM tasks').all();
    const end = performance.now();
    
    console.log(`📋 Tasks (fetched in ${(end - start).toFixed(2)}ms):`);
    tasks.forEach((t: any) => {
      console.log(`[${t.done ? 'x' : ' '}] ${t.id}: ${t.title}`);
    });
  });

program.parse();
```

これだけで、型安全かつ超高速なCLIが完成する。ビルドステップは不要だ。

## 実行結果とパフォーマンス検証

実際にこのスクリプトを実行し、体感速度と実測値を計測してみた。

```bash
$ time bun index.ts add "Write tech blog post"
✅ Added: "Write tech blog post" (in 0.15ms)

real	0m0.032s
user	0m0.015s
sys	0m0.010s
```

驚異的な数字だ。コマンド全体の実行にかかった時間（real）がわずか `32ms`。そのうち、SQLiteへのINSERT処理自体は `0.15ms` で終わっている。人間がエンターキーを叩き終わる前に処理が完了し、即座にプロンプトが返ってくる感覚だ。

```bash
$ time bun index.ts list
📋 Tasks (fetched in 0.08ms):
[ ] 1: Write tech blog post

real	0m0.030s
user	0m0.013s
sys	0m0.012s
```

SELECT処理も同様で、全体の実行時間は `30ms` 程度。Node.jsで同様のことをしようとすると、V8エンジンの起動とモジュールのロードだけで100ms〜200msはかかってしまう。

## 結論：GoやRustの代替になり得るか？

CLIツールの領域において、Bun + SQLiteの組み合わせは「TypeScriptで書けるGo」のような立ち位置になりつつある。もちろん、バイナリサイズや厳密なメモリ管理が必要な場面ではRustやZigの出番だが、個人用のツールや社内向けユーティリティ、簡単なスクレイピングやタスク管理であれば、このスタックで十分すぎる、いや、最適解だと言える。

フロントエンドの技術スタック（Zodでのバリデーション、chalk/kleurでの色付けなど）をそのまま持ち込みつつ、ゼロレイテンシの体験を得られる。今後もこの構成でいくつかツールを自作していきたい。