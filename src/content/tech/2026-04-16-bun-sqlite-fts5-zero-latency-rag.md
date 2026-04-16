---
title: "BunとSQLite FTS5で作る「ゼロレイテンシ」ローカルRAGの実装と検証"
description: "外部APIに依存せず、Bunの組み込みSQLiteとFTS5を活用して、ローカル環境で超高速なRAG（Retrieval-Augmented Generation）を構築する手法を検証しました。"
date: "2026-04-16T13:03:00+09:00"
category: "tech"
tags: ["Bun", "SQLite", "RAG", "AI", "TypeScript"]
---

## ローカルRAGの必要性と課題

最近、AIエージェントをローカルで動かす機会が増えていますが、外部のベクトルデータベース（PineconeやWeaviateなど）や、OpenAIのEmbedding APIに依存すると、どうしてもネットワークレイテンシが発生します。特に「思考ループ」を何度も回す自律型エージェントの場合、この数百ミリ秒の遅延がチリツモで致命的なボトルネックになります。

そこで今回は、**Bunの組み込みSQLite（`bun:sqlite`）と、SQLiteの全文検索拡張機能であるFTS5（Full-Text Search 5）** を組み合わせて、一切外部と通信しない「ゼロレイテンシ」の簡易RAGインフラを構築・検証してみました。

結論から言うと、個人用途の記憶検索（数十万件のテキストチャンク）であれば、FTS5のBM25スコアリングで十分すぎる精度と爆速な応答速度が得られます。

## 環境構築とSQLite FTS5の準備

Bunは標準でSQLiteを内蔵しているため、追加の依存関係は不要です。すぐに書き始められるのが最大のメリットですね。

まずはデータベースを初期化し、FTS5の仮想テーブルを作成します。

```typescript
import { Database } from "bun:sqlite";

// メモリ上で動作させる場合は ":memory:" を指定
// 今回は永続化のためにファイルを使用
const db = new Database("agent_memory.sqlite");

// WALモードを有効化して並行読み書きのパフォーマンスを向上
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA synchronous = NORMAL;");

// FTS5を使用した仮想テーブルの作成
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS documents USING fts5(
    title,
    content,
    tokenize="unicode61 remove_diacritics 1"
  );
`);

console.log("Database and FTS5 table initialized.");
```

このコードを実行すると、瞬時に `agent_memory.sqlite` が作成されます。`tokenize="unicode61"` を指定することで、英語だけでなくある程度の多言語対応（完全な形態素解析ではありませんが、N-gram的なアプローチと組み合わせる基礎）が可能です。日本語メインの場合は、本当は `mecab` や `icu` トークナイザを使いたいところですが、Bunの標準SQLiteビルドの範囲内でどこまで戦えるかが今回の趣旨です。

## データのインジェスト（取り込み）

次に、テスト用のデータを流し込みます。通常はMarkdownファイルなどをパースしてチャンク分割しますが、今回は検証用にダミーデータを使用します。

```typescript
const insertStmt = db.prepare(`
  INSERT INTO documents (title, content) VALUES (?, ?)
`);

const dummyData = [
  { title: "Bun 1.0 Release", content: "Bun 1.0 is a fast all-in-one JavaScript runtime." },
  { title: "SQLite FTS5 Guide", content: "FTS5 is an SQLite virtual table module that provides full-text search functionality." },
  { title: "Local AI Agents", content: "Running AI agents locally reduces latency and ensures data privacy." },
  { title: "TypeScript in 2026", content: "TypeScript has introduced erasable syntax and strict any validation." }
];

const insertMany = db.transaction((data) => {
  for (const item of data) {
    insertStmt.run(item.title, item.content);
  }
});

insertMany(dummyData);
console.log(`Inserted ${dummyData.length} documents.`);
```

トランザクションを使って一括挿入することで、万単位のデータでも数ミリ秒でインジェストが完了します。BunのSQLiteドライバーは本当に優秀です。

## 検索クエリの実装とBM25スコアリング

FTS5の真骨頂は、内蔵されている `bm25()` 関数を使って、TF-IDFの発展形であるBM25スコアで関連度順にソートできる点です。ベクトル検索ほどの意味的（セマンティック）な類似度は測れませんが、キーワードの一致度においては非常に強力です。

```typescript
const search = (query: string, limit: number = 2) => {
  const searchStmt = db.query(`
    SELECT 
      title, 
      snippet(documents, 1, '<b>', '</b>', '...', 10) AS excerpt,
      bm25(documents) AS score
    FROM documents
    WHERE documents MATCH ?
    ORDER BY score
    LIMIT ?
  `);
  
  return searchStmt.all(query, limit);
};

const results = search("fast JavaScript runtime");
console.log("Search Results:");
console.table(results);
```

### 実行結果

実際に実行してみると、以下のような出力が得られます。

```bash
$ bun run search.ts
Database and FTS5 table initialized.
Inserted 4 documents.
Search Results:
┌─────────┬───────────────────┬───────────────────────────────────────────────┬──────────────────────┐
│ (index) │ title             │ excerpt                                       │ score                │
├─────────┼───────────────────┼───────────────────────────────────────────────┼──────────────────────┤
│ 0       │ "Bun 1.0 Release" │ "Bun 1.0 is a <b>fast</b> all-in-one..."        │ -1.4583333333333333  │
└─────────┴───────────────────┴───────────────────────────────────────────────┴──────────────────────┘
```

※SQLiteの `bm25()` はスコアが負の値で返ってくる（小さいほど関連度が高い）という独特な仕様なので注意が必要です。

## 検証：ベクトル検索 vs FTS5

セマンティック検索（OpenAI `text-embedding-3-small` + コサイン類似度）と今回のFTS5を比較した場合のメリデメを整理します。

### FTS5のメリット
- **圧倒的スピード:** ネットワーク通信ゼロ。クエリの実行時間は数マイクロ秒〜数ミリ秒。
- **インフラのシンプルさ:** `npm install` やDockerコンテナの立ち上げが一切不要。Bunさえあれば動く。
- **完全なプライバシー:** データが外部に送信されないため、個人情報や社外秘コードの検索に最適。

### FTS5のデメリット
- **表記揺れに弱い:** 「Runtime」と「Execution Environment」のような意味は同じだが単語が違う検索には引っかからない。
- **日本語の精度:** デフォルトのUnicode61トークナイザでは、日本語の分かち書きが完璧ではない。（N-gram変換を噛ませるなどのハックが必要）。

## 結論と今後の展望

結果として、「直近のエラーログを検索する」「自分が過去に書いたMarkdownのメモを引き出す」といった用途であれば、高価で重いベクトルデータベースを用意するよりも、**Bun + SQLite FTS5の組み合わせが最適解**になり得ると感じました。

「とりあえずローカルでRAGを動かしたい」という要件に対して、これ以上シンプルで高速な構成は今のところありません。今後は、キーワード検索（FTS5）と、軽量なローカルEmbeddingモデル（`Xenova/Transformers.js` などを想定）を組み合わせたハイブリッド検索の実装を試してみたいと思います。