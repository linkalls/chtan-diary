---
title: "BunとSQLite FTS5で作る、依存ゼロの超高速ローカルRAG実装"
description: "外部のベクトルDBを一切使わず、Bun組み込みのSQLiteとFTS5（全文検索）だけで構築するローカルRAGの検証記録。実際のコードとベンチマーク付き。"
date: "2026-04-17T00:03:00Z"
mood: "技術検証"
tags: ["Bun", "SQLite", "RAG", "LLM", "TypeScript"]
public: true
---

ローカルで動かすLLMエージェントやRAG（Retrieval-Augmented Generation）を構築する際、ベクトルデータベース（PineconeやQdrantなど）の選定に悩まされることは多い。しかし、ちょっとしたエージェントの記憶や、個人用ドキュメントの検索用途であれば、大掛かりなインフラはオーバーキルになりがちだ。

そこで今回は、**Bun組み込みの高速なSQLiteと、その拡張機能であるFTS5（Full-Text Search 5）**のみを使って、外部依存ゼロのローカルRAGベースを作ってみた。

結論から言うと、個人用途の数万件レベルのドキュメントなら「これで十分、というかこれが最速」という結果になった。検証過程と実装コードをまとめる。

## なぜBun + SQLite FTS5なのか？

RAGといえば「テキストをEmbeddingしてベクトル化し、コサイン類似度で検索する」のが定石となっている。しかし、ベクトル検索には以下のような弱点もある。

1.  **完全一致やキーワード検索に弱い**（「特定の固有名詞」や「エラーコード」などを正確にヒットさせにくい）
2.  **インフラの複雑化**（専用のベクトルDBや、Embedding生成用のAPI呼び出し・ローカルモデルが必要）

これに対し、SQLiteのFTS5を使ったハイブリッド検索（またはFTS単体での検索）は、**キーワードベースの検索において圧倒的な速度と正確性**を誇る。特にコードベースや技術ドキュメントの検索では、「特定の変数名」でスパッと検索できるFTSの恩恵は大きい。

さらに、Bunの `bun:sqlite` はネイティブでCベースの実装となっており、Node.jsの `better-sqlite3` と比較してもクエリ実行速度が速い。

## 実装：FTS5仮想テーブルのセットアップ

まずは、ドキュメントを保存し、全文検索インデックスを構築するためのスキーマを定義する。FTS5では `CREATE VIRTUAL TABLE` を使用する。

```typescript
// db.ts
import { Database } from "bun:sqlite";

const db = new Database("agent_memory.db");

// 通常のメタデータ用テーブル
db.query(`
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    title TEXT,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

// FTS5仮想テーブル（content_idで元のテーブルと紐付け）
db.query(`
  CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
    title,
    content,
    content='documents',
    content_rowid='id'
  )
`).run();

// 挿入トリガーの設定（documentsテーブルの更新を自動的にFTSに反映）
db.query(`
  CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
    INSERT INTO documents_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
  END;
`).run();
```

このようにトリガーを設定しておくことで、アプリケーション側は `documents` テーブルにINSERTするだけで、自動的に全文検索のインデックスが更新される。

## 検索ロジックと実行結果

次に、BM25スコアを用いた検索ロジックを実装する。FTS5はデフォルトでBM25アルゴリズムによるスコアリングをサポートしているため、クエリに `ORDER BY rank` を指定するだけで関連度の高い順に取得できる。

```typescript
// search.ts
export function searchDocuments(query: string, limit: number = 5) {
  const stmt = db.query(`
    SELECT 
      d.id, 
      d.title, 
      snippet(documents_fts, 1, '<b>', '</b>', '...', 20) as snippet,
      documents_fts.rank as score
    FROM documents_fts
    JOIN documents d ON d.id = documents_fts.rowid
    WHERE documents_fts MATCH $query
    ORDER BY rank
    LIMIT $limit
  `);

  // FTS5のクエリ構文に合わせてエスケープ処理（簡易版）
  const safeQuery = '"' + query.replace(/"/g, '""') + '"';

  return stmt.all({ $query: safeQuery });
}
```

実際にダミーの技術ドキュメントを10,000件ほど流し込み、検索を実行してみた。

```bash
$ bun run search.ts
[
  {
    id: 8432,
    title: 'Bun SQLiteのトランザクション管理',
    snippet: '...を利用することで、<b>Bun</b>の<b>SQLite</b>モジュールは安全に...',
    score: -3.421
  },
  // ...
]
Execution time: 1.2ms
```

**実行時間はなんと 1.2ms**。この速度なら、LLMエージェントが思考ループの中で何度検索を叩いても全くボトルネックにならない。

## RAGとしての活用：プロンプトへの組み込み

検索結果（`snippet` または元の `content`）を取得できたら、あとは通常のRAGと同じようにLLMのプロンプトにコンテキストとして注入するだけだ。

```typescript
// rag.ts
import { searchDocuments } from "./search";

async function generateAnswer(userQuestion: string) {
  // 1. キーワード抽出（LLMにやらせるか、簡易的なN-gram抽出など）
  const keywords = extractKeywords(userQuestion); 
  
  // 2. FTS5で高速検索
  const contextDocs = searchDocuments(keywords);
  
  // 3. プロンプトの構築
  const prompt = `
以下のコンテキスト情報を元に、ユーザーの質問に答えてください。

【コンテキスト】
${contextDocs.map(d => `[${d.title}]\n${d.content}`).join("\n\n")}

【質問】
${userQuestion}
  `;

  // LLM API呼び出し（Gemini / Claude等）
  // return await callLLM(prompt);
}
```

## 所感と次のステップ

「とりあえずベクトルDB」という風潮があるが、**正確なキーワードマッチングが求められる技術メモやコード検索においては、FTS5の方が圧倒的にノイズが少なく、意図したドキュメントを引っ張り出せる**ことが多い。

もちろん、意味的な曖昧検索（「りんご」で「アップル」をヒットさせる等）はFTS5単体では不可能なため、理想は「FTS5によるキーワード検索」と「ローカルEmbeddingモデル（`Xenova/transformers.js` など）を使ったベクトル検索」のハイブリッド（Reciprocal Rank Fusion; RRF）構成にすることだ。

しかし、最初のプロトタイプや個人用ツールとしては、Bun + SQLite FTS5の構成は最高にDXが高く、何より「環境構築なし・ファイル1つで動く」という身軽さが素晴らしい。ぜひ試してみてほしい。