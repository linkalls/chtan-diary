---
title: "BunとTypeScriptの`using`キーワードによるリソース管理：堅牢なAgent Runtimeの構築"
date: 2026-04-24T16:03:00.000Z
tags: ["Bun", "TypeScript", "Agent", "Architecture"]
category: "tech"
---

Agent Runtimeを自作していると、常に直面するのが「リソースのライフサイクル管理」だ。AIエージェントは自律的に動作し、ファイルの読み書き、SQLiteデータベースへの接続、WebSocketの管理、そしてサブプロセスの起動と終了を絶え間なく繰り返す。

このとき、エラー発生時やタスク完了時に確実にリソースを開放しないと、あっという間にメモリリークやファイルディスクリプタの枯渇を引き起こす。今回は、TypeScript 5.2から導入された `using` キーワード（Explicit Resource Management）を、Bun上のAgent Runtimeでどう活用するかを深掘りしていく。

## 従来のリソース管理の課題

これまでのTypeScript（Node.js/Bun）では、リソースの開放は `try/finally` ブロックに依存していた。例えば、Agentの一時的な作業ディレクトリ（Workspace）を作成し、処理が終わったら削除するようなケースを考えてみる。

```typescript
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function runAgentTask() {
  const workspace = await mkdtemp(join(tmpdir(), "agent-"));
  try {
    // Agentの処理をここで実行
    await executeTask(workspace);
  } finally {
    // 確実に削除する
    await rm(workspace, { recursive: true, force: true });
  }
}
```

この書き方自体は間違っていない。しかし、複数のリソース（DB接続、ファイルハンドル、一時ディレクトリ）を扱うようになると、途端に `try/finally` のネストが深くなり、コードの可読性が著しく低下する。

## `using` / `await using` による解決

`using` キーワードを使うと、スコープを抜けた瞬間に自動でリソースの解放処理（`[Symbol.dispose]` または `[Symbol.asyncDispose]`）が呼ばれるようになる。Goの `defer` やRustの `Drop` トレイトに近い感覚だ。

AgentのWorkspace管理クラスを `Symbol.asyncDispose` を使って書き換えてみよう。

```typescript
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

class AgentWorkspace implements AsyncDisposable {
  public readonly path: string;

  private constructor(path: string) {
    this.path = path;
  }

  static async create(): Promise<AgentWorkspace> {
    const path = await mkdtemp(join(tmpdir(), "agent-"));
    console.log(`[Workspace] Created: ${path}`);
    return new AgentWorkspace(path);
  }

  async [Symbol.asyncDispose]() {
    console.log(`[Workspace] Cleaning up: ${this.path}`);
    await rm(this.path, { recursive: true, force: true });
  }
}
```

このクラスを使う側のコードは驚くほどシンプルになる。

```typescript
async function runAgentTask() {
  await using workspace = await AgentWorkspace.create();
  
  // workspace.path を使って処理を行う
  await executeTask(workspace.path);
  
  // ブロックを抜けると自動的に [Symbol.asyncDispose]() が呼ばれる！
}
```

途中でエラー（例外）がスローされた場合でも、確実にクリーンアップ処理が実行されるため、Agentがパニックを起こして死んだ際にゴミファイルが残るのを防げる。

## BunのSQLiteと組み合わせる

Bunの組み込みSQLite (`bun:sqlite`) も、接続のクローズを忘れるとWALファイルが肥大化したり、ロックが残ったりする原因になる。
Agentのメモリ（短期記憶）をSQLiteで管理するケースでは、以下のようにラッパーを作ると安全だ。

```typescript
import { Database } from "bun:sqlite";

class AgentMemoryDb implements Disposable {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    console.log(`[DB] Connected to ${dbPath}`);
  }

  query(sql: string, params: any[]) {
    return this.db.query(sql).all(...params);
  }

  [Symbol.dispose]() {
    console.log("[DB] Closing connection");
    this.db.close();
  }
}

function processMemory() {
  using db = new AgentMemoryDb("agent-memory.sqlite");
  const memories = db.query("SELECT * FROM memories LIMIT ?", [10]);
  console.log(memories);
  // スコープを抜けると db.close() が確実に呼ばれる
}
```

## 複数リソースのスタッキング

Agent Runtimeでは、「DBに繋いで、一時ディレクトリを作って、ログファイルを開く」というように複数のリソースを同時に扱うことが多い。`using` を使うと、これらをフラットに記述できる。

```typescript
async function autonomousLoop() {
  using db = new AgentMemoryDb("memory.sqlite");
  await using workspace = await AgentWorkspace.create();
  await using logger = await AgentLogger.open(workspace.path);

  // 処理ロジック...
}
```

リソースの解放は **宣言した逆順**（logger → workspace → db）で行われる。依存関係があるリソースの片付けもこれで完璧だ。

## まとめ

Agent Runtimeのような「いつ死ぬかわからない、でも状態はきれいに保ちたい」システムにおいて、`using` によるリソース管理は必須級の機能だ。`try/finally` の地獄から抜け出し、本来のLLMとの対話制御やタスク実行のロジックに集中できるようになる。Bunの爆速実行環境とTypeScriptのモダンな構文の組み合わせは、Agent開発において最強の基盤と言っていいだろう。
