---
title: "Bun + SQLiteでAgentの記憶システムを作る: Vector検索とJSON操作の最適化戦略"
date: 2026-04-11T13:03:00+09:00
description: "AIエージェントの短期・長期記憶をどのように管理するか。外部のベクタデータベースに依存せず、Bunの高速なSQLiteクライアントを用いて自己完結型のメモリシステムを構築・検証した記録と実装パターン。"
tags: ["Bun", "SQLite", "Agent", "Architecture"]
---

最近、ローカルで動かす自律型エージェント（Autonomous Agent）の「記憶（Memory）」の取り扱いについて試行錯誤している。外部のフルマネージドなVector DB（Pineconeなど）を使うのは簡単だが、ネットワーク遅延や依存関係を減らしたい。

そこで、「**Bunの組み込みSQLiteだけで、実践的なAgentメモリシステムはどこまで作れるか？**」というテーマで検証を行った。結論から言うと、個人レベル〜小規模チームの自律タスク程度なら、Bun + SQLiteの組み合わせで十二分に戦えるし、何より**爆速**だ。

今回は、そのアーキテクチャ設計から具体的な実装パターン、そして実際のパフォーマンス検証結果までをまとめる。

## なぜBun + SQLiteなのか？

エージェントの記憶システムに求められる要件は以下の通り：

1. **短期記憶（Short-term Memory）**: 直近の会話やコンテキストの高速な出し入れ。
2. **長期記憶（Long-term Memory）**: 過去の重要な意思決定やルールの永続化と意味検索（Semantic Search）。
3. **メタデータ管理**: いつ、なぜその記憶が保存されたかのJSONデータ。

Node.js + 外部DBの構成だと、どうしてもI/Oのレイテンシがボトルネックになる。しかし、Bun内蔵の `bun:sqlite` は、V8のC++バインディングや余計なオーバーヘッドをバイパスしてZigから直接SQLiteを叩くため、信じられないほど速い。

さらに、SQLiteの `JSON1` 拡張を使えば、柔軟なメタデータ検索もSQL一発で完結する。

## 実装: Agent Memory Databaseの設計

まず、データベースのスキーマを定義する。記憶は大きく「生のテキスト」「ベクトル表現」「付随するJSONメタデータ」の3つから構成される。

```sql
-- schema.sql
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  embedding BLOB, -- ベクトルデータはBLOBとして保存
  metadata TEXT,  -- JSON形式で保存
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_accessed_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
```

### Bunでのセットアップと基本操作

BunのSQLite APIは非常に直感的だ。同期的にサクサク動くのが心地よい。

```typescript
import { Database } from "bun:sqlite";
import { v4 as uuidv4 } from "uuid";

// メモリDBの初期化
const db = new Database("agent_memory.sqlite");

// WALモードを有効にして並行読み書きのパフォーマンスを上げる
db.run("PRAGMA journal_mode = WAL;");
db.run("PRAGMA synchronous = NORMAL;");

interface MemoryMetadata {
  source: string;
  importance: number;
  tags: string[];
}

export function insertMemory(
  content: string, 
  embedding: Float32Array, 
  metadata: MemoryMetadata
) {
  const stmt = db.prepare(`
    INSERT INTO memories (id, content, embedding, metadata)
    VALUES ($id, $content, $embedding, $metadata)
  `);

  stmt.run({
    $id: uuidv4(),
    $content: content,
    // Float32Arrayをバッファに変換してBLOBとして保存
    $embedding: Buffer.from(embedding.buffer),
    $metadata: JSON.stringify(metadata)
  });
}
```

## JSON拡張をフル活用したメタデータ検索

記憶を引き出す際、単に全部舐めるのは非効率だ。「重要度が5以上で、タグに 'system' が含まれる記憶」といったフィルタリングが必要になる。SQLiteのJSON関数を使えば、これが高速に行える。

```typescript
export function getImportantSystemMemories(minImportance: number): any[] {
  const stmt = db.prepare(`
    SELECT id, content, json_extract(metadata, '$.importance') as importance
    FROM memories
    WHERE 
      json_extract(metadata, '$.importance') >= $min
      AND json_extract(metadata, '$.tags') LIKE '%"system"%'
    ORDER BY importance DESC
    LIMIT 10
  `);

  return stmt.all({ $min: minImportance });
}
```

実際にこのクエリを回してみたが、数万件のレコードがあっても数ミリ秒で返ってくる。Agentの思考ループ（Thought Loop）内に組み込んでも全く気にならないレイテンシだ。

## ベクトル検索（コサイン類似度）の実装

一番の課題は**ベクトル検索**だ。SQLiteにはデフォルトでベクトル検索の機能はない（sqlite-vssなどの拡張はあるが、環境構築が煩雑になる）。

そこで、今回は「**SQLiteで候補を絞り込み、Bun側のインメモリでコサイン類似度を計算する**」というアプローチを取った。Bunの実行速度なら、数千件の計算は一瞬で終わる。

```typescript
// コサイン類似度の計算（高速化のために最適化）
function cosineSimilarity(vecA: Float32Array, vecB: Float32Array): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  // SIMDが効くようにシンプルなループで書く
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function searchSimilarMemories(
  queryEmbedding: Float32Array, 
  limit: number = 5
) {
  // まず最近の記憶や特定の条件で1000件程度に絞り込む（Pre-filtering）
  const candidates = db.query(`
    SELECT id, content, embedding
    FROM memories
    ORDER BY created_at DESC
    LIMIT 1000
  `).all() as { id: string, content: string, embedding: Uint8Array }[];

  const results = candidates.map(row => {
    // BLOBからFloat32Arrayへの復元
    const storedEmbedding = new Float32Array(
      row.embedding.buffer, 
      row.embedding.byteOffset, 
      row.embedding.byteLength / 4
    );
    
    return {
      id: row.id,
      content: row.content,
      similarity: cosineSimilarity(queryEmbedding, storedEmbedding)
    };
  });

  // 類似度順にソートして上位を返す
  return results
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
```

### パフォーマンス検証

実際に1536次元（OpenAIの `text-embedding-3-small` に相当）のベクトルデータを1万件保存し、上記の検索処理をベンチマークしてみた。

- **レコード取得**: ~2ms
- **BLOB → Float32Array変換**: ~1ms
- **1000件のコサイン類似度計算 + ソート**: ~4ms
- **合計レイテンシ**: **7〜10ms**

驚異的な数字だ。外部のVector DBにHTTPリクエストを投げるだけで数十〜数百ミリ秒かかることを考えると、**ローカル完結のBun + SQLite構成は、Agentの「思考の瞬発力」を劇的に向上させる**。

## 結論と次のステップ

「とりあえず外部サービスを繋ぐ」という最近のAI開発の風潮に対し、Bun + SQLiteというプリミティブな技術スタックは、圧倒的なパフォーマンスとポータビリティという武器を見せてくれた。

1プロセスで完結するため、デプロイメントも単一のバイナリと1つの `.sqlite` ファイルだけで済む。これは、エッジ環境やローカルPC上で常駐するパーソナルAIアシスタントにとって理想的なアーキテクチャだ。

次のステップとしては、SQLiteのFT5拡張を用いた全文検索（Full-text search）とベクトル検索を組み合わせた「ハイブリッド検索」の実装を試してみたい。また、記憶が肥大化した際の「忘却（Forgetting）」メカニズムも、自律型エージェントには欠かせない要素になるだろう。
