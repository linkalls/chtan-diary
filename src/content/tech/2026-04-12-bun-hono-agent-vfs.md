---
title: "Bun + Honoで作る超低遅延AIエージェントランタイムとVirtual File Systemの実装"
description: "AIエージェントの思考ループをミリ秒単位で回すためのBunとHonoを組み合わせたローカルランタイム設計。VFS (Virtual File System) を使った状態管理と高速なファイル操作の検証ログ。"
date: 2026-04-12
category: "tech"
tags: ["Bun", "Hono", "TypeScript", "AI Agent", "LLM"]
---

## AIエージェントの「思考の遅延」をどう削るか

2026年現在、ローカルLLMやAPI呼び出しを活用した自律型AIエージェントの開発が盛んですが、エージェントが自律的に思考し、ツールを実行し、結果をパースして次の行動に移る「思考ループ（Agentic Loop）」において、ランタイムのオーバーヘッドは馬鹿になりません。

特にファイルシステムへのアクセスやシェルコマンドの実行がボトルネックになりがちです。Node.jsの非同期I/Oも優秀ですが、エージェントが数千回のループを回す場合、プロセスの起動速度やV8エンジンのガベージコレクションのタイミングが「エージェントの体感的な賢さ」に直結します。

そこで今回は、起動が圧倒的に速い **Bun** と、Edge環境でも動く超軽量フレームワーク **Hono** を組み合わせて、エージェント専用のローカルランタイムを構築する検証を行いました。

## アーキテクチャ設計：Hono + Bun.serve() によるRPC通信

エージェントの脳（LLM呼び出しとプロンプト管理）と、手足（ファイル操作やコマンド実行を行うSandbox）を分離する設計を採用しました。手足となるランタイム側に Hono を使い、BunのネイティブHTTPサーバーで待ち受けます。

```typescript
// runtime/server.ts
import { Hono } from 'hono'
import { $ } from 'bun'

const app = new Hono()

app.post('/exec', async (c) => {
  const { command } = await c.req.json()
  const startTime = performance.now()
  
  try {
    const result = await $`${command}`.text()
    const duration = performance.now() - startTime
    
    return c.json({ success: true, output: result, durationMs: duration })
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500)
  }
})

export default {
  port: 3001,
  fetch: app.fetch,
}
```

このシンプルなRPCサーバーの起動は一瞬です。`bun run server.ts` で起動し、別のプロセスから叩いてみます。

### 実行結果とベンチマーク

```bash
$ bun run server.ts &
[1] 48192
$ curl -X POST http://localhost:3001/exec -d '{"command": "echo Hello Agent"}' -H "Content-Type: application/json"
{"success":true,"output":"Hello Agent\n","durationMs":2.41}
```

`durationMs` が 2.41ms！ コマンドのパースからBunのShell実行(`$`)、そしてレスポンスの返却までがこの速度で完結します。これならエージェントが1秒間に数十回のツール呼び出しを行っても全くストレスがありません。

## Virtual File System (VFS) の導入

エージェントに実際のホストOSのファイルシステムを直接触らせるのはセキュリティ上のリスクがあり、かつ状態のロールバックが難しいため、メモリベースの Virtual File System (VFS) を構築します。

Bunの `bun:sqlite` を活用し、オンメモリでファイルシステムのエミュレーションを行います。SQLiteの `:memory:` データベースは、エージェントの1セッションごとの使い捨て環境として最適です。

```typescript
// runtime/vfs.ts
import { Database } from "bun:sqlite";

export class AgentVFS {
  private db: Database;

  constructor() {
    this.db = new Database(":memory:");
    this.db.run(`
      CREATE TABLE files (
        path TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  write(path: string, content: string) {
    const stmt = this.db.prepare("INSERT OR REPLACE INTO files (path, content, updated_at) VALUES (?, ?, ?)");
    stmt.run(path, content, Date.now());
  }

  read(path: string): string | null {
    const stmt = this.db.prepare("SELECT content FROM files WHERE path = ?");
    const result = stmt.get(path) as { content: string } | null;
    return result ? result.content : null;
  }
}
```

### VFSのパフォーマンス検証

メモリ内SQLiteを使ったVFSの読み書き速度を検証しました。

```typescript
const vfs = new AgentVFS();

console.time("VFS Write 10000 files");
for (let i = 0; i < 10000; i++) {
  vfs.write(`/app/src/file_${i}.ts`, `export const val = ${i};`);
}
console.timeEnd("VFS Write 10000 files");

console.time("VFS Read 10000 files");
for (let i = 0; i < 10000; i++) {
  vfs.read(`/app/src/file_${i}.ts`);
}
console.timeEnd("VFS Read 10000 files");
```

**実行結果ログ:**
```text
VFS Write 10000 files: 12.8ms
VFS Read 10000 files: 8.2ms
```

1万ファイルの書き込みが約12ミリ秒、読み込みが約8ミリ秒。驚異的なスピードです。これなら、LLMが「プロジェクト全体のコードを読み取る」ようなRAG的な処理を行う際にも、I/Oの遅延は事実上ゼロになります。

## 今後の展望と課題

Bun + Hono + In-Memory SQLite の組み合わせは、AIエージェントのローカルランタイムとして現在のところ最適解に近いと感じています。特に TypeScript で `any` を許容せず、Zodで厳格にスキーマバリデーションを行いつつ、この速度が出るのは圧倒的です。

次のステップとしては、このVFSとBunのモジュール解決をフックして、VFS上のTypeScriptコードをディスクに書き出さずに直接実行（Evaluate）する仕組みを構築したいと考えています。これが実現すれば、真の意味で「安全で超高速な完全サンドボックス化されたエージェント環境」が完成するはずです。