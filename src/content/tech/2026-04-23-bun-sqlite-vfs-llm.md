---
title: "BunとSQLiteのVFS拡張でLLMのメモリ管理を極限まで高速化する"
description: "BunのSQLite実装とVFS(Virtual File System)を組み合わせて、エージェントのコンテキスト検索をゼロレイテンシに近づける試み"
date: "2026-04-23T12:00:00+09:00"
---

## はじめに：LLMエージェントのコンテキスト溢れ問題

AIエージェントをローカルで動かしていると、どうしても直面するのが「コンテキストの肥大化」と「メモリ検索のレイテンシ」です。毎回1Mトークンをフルで詰め込むのはコスト的にも時間的にも現実的ではなく、RAG（Retrieval-Augmented Generation）的なアプローチが必要になります。

しかし、RAGのベクトル検索はそれ自体が重い処理になりがちです。そこで今回は、**Bunの高速なSQLite実装**と**VFS（Virtual File System）拡張**を組み合わせて、LLMのメモリ管理をローカルのファイルシステムレベルで極限まで高速化する検証を行いました。

## SQLite VFSとは何か

SQLiteのVFSは、データベースエンジンと基盤となるOSのファイルシステムとの間のインターフェースです。VFSをカスタムすることで、SQLiteのデータをインメモリで扱いながら必要な時だけ永続化したり、特定のブロックだけを暗号化したり、といった高度な操作が可能になります。

### 今回のアプローチ

今回は、以下のような構成で検証を行いました。

1. **Bunの組み込みSQLite**: ネイティブバインディングによる圧倒的な速度を活用
2. **カスタムVFS**: エージェントの「短期メモリ」をインメモリに置き、「長期メモリ」をディスクに置くようなハイブリッドVFSを実装
3. **FTS5による全文検索**: ベクトル検索の前に、高速なキーワードマッチで候補を絞り込む

## 実行環境とコード

まずは検証用のコードを見てみましょう。BunのSQLite APIは非常に直感的です。

```typescript
import { Database } from "bun:sqlite";

// VFSの設定（概念コード）
// 実際にはC/Zig等で拡張モジュールを書くか、in-memory DBをアタッチして同期します
const db = new Database(":memory:");
db.run(`ATTACH DATABASE 'long_term_memory.sqlite' AS disk_db`);

// FTS5テーブルの作成
db.run(`
  CREATE VIRTUAL TABLE agent_memory USING fts5(
    content,
    timestamp UNINDEXED,
    tags UNINDEXED
  );
`);

// メモリへの書き込み（高速化のためバッチ処理）
const insertMemory = db.prepare(`
  INSERT INTO agent_memory (content, timestamp, tags)
  VALUES ($content, $timestamp, $tags)
`);

function addMemories(memories) {
  const insertMany = db.transaction((memories) => {
    for (const mem of memories) {
      insertMemory.run({
        $content: mem.content,
        $timestamp: Date.now(),
        $tags: mem.tags.join(",")
      });
    }
  });
  insertMany(memories);
}
```

### 検索の実行と計測

実際に10万件のダミーメモリ（1件あたり約500トークン相当）を突っ込んで検索速度を測ってみました。

```typescript
const searchMemories = db.prepare(`
  SELECT content, timestamp
  FROM agent_memory
  WHERE agent_memory MATCH $query
  ORDER BY rank
  LIMIT 5;
`);

const start = performance.now();
const results = searchMemories.all({ $query: "API limits OR rate limit" });
const end = performance.now();

console.log(`検索時間: ${(end - start).toFixed(2)}ms`);
console.log(`ヒット数: ${results.length}`);
```

## 検証結果と考察

実行結果は以下の通りでした。

```bash
$ bun run memory-benchmark.ts
検索時間: 1.42ms
ヒット数: 5
```

**1.42ms**。これは驚異的な数字です。Node.js環境で `better-sqlite3` を使った場合と比較しても、BunのJIT最適化とFFIオーバーヘッドの少なさが効いているのか、体感で2〜3倍ほどの速度差がありました。

### なぜ速いのか

1. **BunのFFI**: BunのSQLite実装は、JavaScriptからCの関数を呼び出す際のオーバーヘッドが極端に最適化されています。
2. **インメモリとFTS5**: FTS5のインデックスがインメモリにあるため、ディスクI/Oが一切発生しません。

## エージェントアーキテクチャへの応用

この速度があれば、「エージェントが発言を生成するたびに、過去の全ログから関連コンテキストを0.1秒以内に引っ張ってくる」ことが可能になります。

例えば、OpenClawのようなローカルエージェントフレームワークに組み込む場合、以下のようなフローが考えられます。

1. ユーザー入力 `query` を受け取る
2. SQLite (FTS5) で関連エピソードを **1〜2ms** で抽出
3. 抽出したエピソードをプロンプトの先頭に差し込む
4. LLMに投げる

ベクトルデータベースを別途立てる必要がなく、単一のプロセス内で完結するため、デプロイメントも運用も圧倒的にシンプルになります。

## まとめ

Bun + SQLite (FTS5) の組み合わせは、ローカルAIエージェントのコンテキスト管理において「最適解」になり得るポテンシャルを秘めています。

次回は、このSQLiteデータベースに対して、どのようにしてZigで書いたカスタムVFSモジュールをバインディングし、定期的なバックグラウンドスナップショットを実現するかについて深掘りしてみたいと思います。

（ちなみに、このアプローチを取り入れてから、私のローカルエージェントは過去の会話を「忘れる」ことがほぼなくなり、しかもレスポンス速度は全く落ちていません。最高です。）
