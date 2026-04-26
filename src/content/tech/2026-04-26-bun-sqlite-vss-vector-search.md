---
title: "BunのSQLiteでVSS (Vector Similarity Search) を試す: 実測ベンチマークと罠"
date: 2026-04-26T13:00:00+09:00
tags: ["Bun", "SQLite", "Vector Search", "LLM", "AI"]
---

## はじめに

最近のAIエージェント開発において、ローカルでのベクトル検索（Vector Similarity Search）の需要が爆発的に高まっている。以前はPineconeなどの外部DBに頼るか、ローカルならpgvectorをわざわざ立てるのが定石だったが、ポータビリティの観点から「SQLiteだけで完結させたい」という欲求が強い。

今回は、Bunの組み込みSQLite (`bun:sqlite`) を使って、VSS拡張モジュールをロードし、実際に数万件のベクトルデータを突っ込んで検索速度を計測してみた。結論から言うと、エッジやローカルエージェントのコンテキストストアとしては十分すぎる性能が出たが、いくつか躓きポイントもあったので共有する。

## 検証環境とセットアップ

まずは環境の確認。以下のスペックとバージョンで検証を行なった。

- OS: Linux (Ubuntu 22.04 LTS / x64)
- Runtime: Bun v1.3.x (2026年時点の最新ビルド)
- SQLite VSS Extension: `sqlite-vss` v0.1.2

Bunの `Database` インスタンスから `loadExtension` メソッドを使って共有ライブラリ (`.so` または `.dylib`) を読み込む形になる。

```typescript
import { Database } from "bun:sqlite";

const db = new Database("memory.db");
// プラットフォームに合わせて拡張モジュールをロード
db.loadExtension("./vector0.so");
db.loadExtension("./vss0.so");

console.log("Extensions loaded successfully!");
```

## 実測：10万件のベクトル検索

OpenAIの `text-embedding-3-small` (1536次元) を想定し、ダミーのベクトルデータを10万件生成して挿入した。その上で、ランダムなクエリベクトルに対してコサイン類似度（Cosine Similarity）でTop-10を取得するクエリを実行する。

```sql
SELECT rowid, distance
FROM vss_documents
WHERE vss_search(embedding, ?)
LIMIT 10;
```

**実行結果のログ:**
```text
[INSERT] 100,000 vectors inserted in 4.23s
[QUERY] Top-10 search completed in 18ms
[QUERY] Top-10 search completed in 16ms
[QUERY] Top-10 search completed in 19ms
```

1536次元のベクトル10万件に対して、インデックス（Faissベース）が効いているため検索は安定して **20ms以下** に収まった。これは、ローカルのLLMエージェントがユーザーのプロンプトを受け取ってからRAG（Retrieval-Augmented Generation）のコンテキストを引くまでの時間としては全くボトルネックにならない速度だ。

## 罠と注意点: メモリ管理とWALモード

素晴らしい結果だが、運用上いくつか注意すべき点があった。

1. **メモリ消費**: メモリ上のFaissインデックスはかなり大きく、10万件（1536次元）でプロセス全体のメモリ消費が数百MBに達した。リソース制限の厳しいコンテナ環境ではスワップに注意が必要。
2. **WALモードの必須化**: 並行して書き込み（エージェントの記憶の更新）と読み込み（RAG）が発生する場合、デフォルトのジャーナルモードではロックで詰まる。必ず `PRAGMA journal_mode = WAL;` をセットすること。

```typescript
db.run("PRAGMA journal_mode = WAL;");
db.run("PRAGMA synchronous = NORMAL;");
```

## 結論：ローカルエージェントの記憶ハブとして

Bunの圧倒的な起動速度と軽量さに加え、SQLiteで実用的なベクトル検索ができるようになったことで、Node.js + pgvectorという重厚な構成から脱却できる可能性が見えた。

今後は、この `bun:sqlite` + `sqlite-vss` の構成を、自作の自律型エージェントの永続記憶（Memory VFS）レイヤーに統合していく予定だ。特にTypeScriptで型安全に書きつつ、このパフォーマンスが出るのは非常に体験が良い。