---
title: "BunとHonoで構築する軽量エージェントランタイムのアーキテクチャ設計"
pubDate: 2026-03-19T13:03:00+09:00
description: "Cloudflare WorkersやNode.jsと比較しながら、Bun+Hono+SQLiteを用いた独自AIエージェントランタイムの構築におけるパフォーマンスとDXの優位性について深掘りする。"
tags: ["Bun", "Hono", "TypeScript", "AI", "Architecture"]
---

最近、OpenClawをはじめとしたAIエージェントの自律化・軽量化が進んでいるが、個人的に不満があった。既存のランタイムはNode.js依存だったり、Pythonに引きずられていたりして、「TypeScriptでサクッと動かせて速い」という理想から少し外れていることが多いのだ。

そこで、**Bunの爆速ランタイムとHonoの軽量ルーティング、それからBun内蔵のSQLiteを組み合わせた「俺的・最強エージェントランタイム」**のアーキテクチャを設計し、実際にプロトタイプを組んでみた。本記事では、その設計思想と実際のコード、そしてCloudflare Workersなどと比較した際の強みについてまとめていく。

2026年3月19日（木）の午後、ちょっと時間が空いたので一気に書き上げることにした。

## なぜBun + Honoなのか？

エージェントランタイムに求められる要件は、一般的なWebサーバーとは少し異なる。

1. **ステートの高速な読み書き**: エージェントは短期記憶（セッションごとの文脈）と長期記憶（過去のやり取りやRAG用のベクトル）を頻繁に行き来する。
2. **シェルやファイルシステムへのシームレスなアクセス**: ツール呼び出し（Tool Use）でローカルコマンドを実行したりファイルを読み書きしたりする機能が不可欠。
3. **起動速度と低フットプリント**: コンテナやエッジで大量のエージェントを立ち上げる際、コールドスタートの遅さは致命的になる。

これらの要件を満たすために、以下の技術スタックを選定した。

- **ランタイム**: `Bun`（Node.js互換でありつつ、`Bun.spawn`によるシェル実行や`Bun.file`によるファイル操作が圧倒的に速い）
- **フレームワーク**: `Hono`（エッジ対応の超軽量ルーター。型安全なRPCも標準搭載）
- **データベース**: `bun:sqlite`（C言語拡張を使わずに組み込みでSQLiteが叩けるため、環境構築ゼロで爆速）

### Cloudflare Workersとの比較

「エッジで動かすならCloudflare Workers + D1で良くない？」という意見もあるだろう。確かにWebAPIベースのチャットボットならそれでもいい。

しかし、**ローカルファイルやCLIツールを直接操作する「自律型エージェント」**を作る場合、サンドボックス化されたWorkers環境では限界がある。Bunであれば、ローカル環境のファイルシステムやシェルにフルアクセスしつつ、Honoを使って外部からのWebhook（例えばTelegramやDiscordのイベント）を処理するサーバーを立てることができる。この「ローカルの強み」と「サーバーとしての軽快さ」のハイブリッドが最大の魅力だ。

## アーキテクチャと実装例

実際にどのようなコードになるのか、最小構成のプロトタイプを見てみよう。

### 1. Honoによるエントリーポイントとルーティング

エージェントを操作するためのAPIサーバーをHonoでサクッと立ち上げる。TypeScriptで書けば、`zod`を使ったスキーマバリデーションも強力に機能する（`any`は絶対に許さない）。

```typescript
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { processAgentTask } from './agent'

const app = new Hono()

// エージェントにタスクを投げるエンドポイント
app.post(
  '/api/agent/task',
  zValidator('json', z.object({
    taskId: z.string().uuid(),
    prompt: z.string().min(1),
    allowTools: z.boolean().default(true)
  })),
  async (c) => {
    const { taskId, prompt, allowTools } = c.req.valid('json')
    
    // 非同期でタスクをキューイングして即座にレスポンスを返す
    Bun.spawn(['bun', 'run', 'agent-worker.ts', taskId, prompt])
    
    return c.json({ status: 'queued', taskId })
  }
)

export default {
  port: 3000,
  fetch: app.fetch,
}
```

### 2. bun:sqliteを使った爆速メモリ管理

エージェントの記憶（Memory）を管理するために、外部のDBを立てるのは大げさだ。Bun内蔵のSQLiteを使えば、同期処理のようにサクサクとステートを保存できる。

```typescript
import { Database } from "bun:sqlite";

// メモリ上で動かすか、ファイルに書き出すか選べる
const db = new Database("agent_memory.sqlite");

db.run(`
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    task_id TEXT,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

export function saveMemory(taskId: string, content: string) {
  const query = db.query(`INSERT INTO memories (id, task_id, content) VALUES ($id, $taskId, $content)`);
  query.run({
    $id: crypto.randomUUID(),
    $taskId: taskId,
    $content: content
  });
}

export function getMemory(taskId: string) {
  const query = db.query(`SELECT * FROM memories WHERE task_id = $taskId ORDER BY created_at DESC`);
  return query.all();
}
```

このSQLiteの連携が本当に素晴らしい。Prismaのような重いORMを入れずとも、SQLを直接書いても型安全にラップする仕組み（あるいはDrizzleのBun SQLite対応）を使えば十分だ。

### 3. Bun.spawnによるシェル実行の抽象化

エージェントが「このリポジトリのテストを実行して」と言われた場合、シェルコマンドを叩く必要がある。Bunの`spawn` APIはこれが非常にやりやすい。

```typescript
export async function executeCommand(cmd: string[]) {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const text = await new Response(proc.stdout).text();
  const errText = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { text, errText, exitCode };
}

// エージェントからの呼び出し例
// const result = await executeCommand(["ls", "-la", "src/"]);
```

## 今後の展望

この「Bun + Hono + SQLite」の構成は、自分専用のローカルエージェント（あるいはVPS上で動かす小規模なエージェント群）を構築するためのベストプラクティスになり得ると感じている。

現在のプロトタイプでは単純なコマンド実行とSQLiteへの記憶保存しか実装していないが、今後は以下の機能を拡張していく予定だ。

1. **ベクトル検索の統合**: SQLiteの`sqlite-vss`拡張をBunから呼び出せるようにし、RAG（Retrieval-Augmented Generation）をローカル完結させる。
2. **Hono RPCによるフロントエンド連携**: Next.jsやReact Nativeのフロントエンドから、HonoのRPCクライント（`hc`）を使って完全な型安全でエージェントの状態を監視するダッシュボードを作る。

やはり、自分のためのツールは自分で作るのが一番面白い。「効率厨」としては、無駄なミドルウェアを削ぎ落として、極限まで軽く速いシステムを追求していきたい。
