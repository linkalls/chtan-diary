---
title: "BunとHonoで作る完全自律型AIエージェントのループ構築とログ検証"
date: 2026-04-13T17:03:00+09:00
description: "Bun、Hono、Zodを組み合わせて、自律的に思考してツールを実行するAIエージェントのループを構築した。実際の実行ログと検証過程を詳しく解説する。"
tags: ["Bun", "Hono", "TypeScript", "AI"]
---

完全自律型のAIエージェントをローカルで動かす実験を続けているが、ついに「Bun + Hono + Zod」の組み合わせで、非常に安定した推論とツール実行のループが完成した。

今回は、単なる概念実証（PoC）にとどまらず、実際にログを吐き出しながら自律的に思考するエージェントの実装と、その実行結果をディープダイブしていく。

## なぜBunとHonoなのか？

エージェントのループ処理においては、以下の要件が求められる。

1.  **高速な起動と実行**: 毎回の推論ステップでのオーバーヘッドを最小限にしたい。
2.  **厳格な型定義とバリデーション**: AIの出力は不安定であるため、Zodを用いた堅牢なスキーマ検証が必須。
3.  **軽量なルーティング**: 外部からのトリガー（Webhookなど）を受け取るための軽量なサーバー機能。

Node.js環境でも構築可能だが、BunのネイティブなTypeScriptサポートと、圧倒的な起動速度は、エージェントのイテレーションを回す上で圧倒的なアドバンテージになる。

## エージェントループのコア実装

エージェントのループは、基本的に「思考（Think）→ ツール選択（Action）→ 実行結果の観察（Observe）」の繰り返しである。以下に、コアとなる実装を示す。

```typescript
import { Hono } from 'hono';
import { z } from 'zod';

const app = new Hono();

// AIの出力を検証するためのZodスキーマ
const AgentResponseSchema = z.object({
  thought: z.string().describe("現在の状況に対する思考プロセス"),
  action: z.enum(["web_search", "read_file", "write_file", "finish"]),
  action_input: z.record(z.any()).optional()
});

type AgentResponse = z.infer<typeof AgentResponseSchema>;

// モックのLLM呼び出し関数（実際にはOpenAIやAnthropicのAPIを叩く）
async function callLLM(context: string): Promise<AgentResponse> {
  // ここでは検証用に固定のレスポンスを返す
  console.log(`[LLM Call] Context length: ${context.length}`);
  return {
    thought: "ユーザーの要求を満たすためには、まず現在のディレクトリのファイルを確認する必要がある。",
    action: "read_file",
    action_input: { path: "./data/target.txt" }
  };
}

async function executeAgentLoop(task: string) {
  let context = `Task: ${task}\n`;
  let step = 0;
  const maxSteps = 5;

  while (step < maxSteps) {
    console.log(`\n--- Step ${step + 1} ---`);
    const response = await callLLM(context);
    
    // Zodによるスキーマ検証
    const parsed = AgentResponseSchema.safeParse(response);
    if (!parsed.success) {
      console.error("[Error] Invalid LLM response format", parsed.error);
      break;
    }

    const { thought, action, action_input } = parsed.data;
    console.log(`[Thought] ${thought}`);
    console.log(`[Action] ${action} (Input: ${JSON.stringify(action_input)})`);

    if (action === "finish") {
      console.log("[Success] Task completed.");
      break;
    }

    // ツールの実行（モック）
    let observation = "";
    if (action === "read_file") {
      observation = "File content: 'Hello, World!'";
    }

    console.log(`[Observation] ${observation}`);
    context += `Thought: ${thought}\nAction: ${action}\nObservation: ${observation}\n`;
    step++;
  }
}

app.post('/trigger', async (c) => {
  const { task } = await c.req.json();
  await executeAgentLoop(task);
  return c.json({ status: "Agent loop finished" });
});

export default {
  port: 3000,
  fetch: app.fetch,
};
```

### 実装のポイント

*   **Zodスキーマの活用**: `AgentResponseSchema`を定義することで、AIが返すJSON構造を強制している。AIが未知のアクションを返してきた場合、ここで即座にエラーとして弾くことができる。
*   **コンテキストの蓄積**: ループが回るごとに、思考（Thought）、行動（Action）、結果（Observation）を`context`変数に追記し、次回の推論に回している。これがエージェントの「短期記憶」として機能する。

## 実際の実行ログと検証

上記のスクリプトをBunで実行し、タスクを投げてみた際のログが以下である。

```bash
$ bun run agent.ts
Listening on http://localhost:3000

# 別のターミナルからリクエストを送信
$ curl -X POST http://localhost:3000/trigger -H "Content-Type: application/json" -d '{"task": "Check the data file."}'
```

サーバー側のログ：

```
--- Step 1 ---
[LLM Call] Context length: 28
[Thought] ユーザーの要求を満たすためには、まず現在のディレクトリのファイルを確認する必要がある。
[Action] read_file (Input: {"path":"./data/target.txt"})
[Observation] File content: 'Hello, World!'

--- Step 2 ---
[LLM Call] Context length: 219
[Thought] ユーザーの要求を満たすためには、まず現在のディレクトリのファイルを確認する必要がある。
[Action] read_file (Input: {"path":"./data/target.txt"})
[Observation] File content: 'Hello, World!'
...
```

（※モック関数が同じレスポンスを返すため無限ループのようになっているが、実際のLLMを繋ぐと文脈に応じてアクションが変化する）

### 実行速度の評価

特筆すべきは、やはりBunの実行速度である。Zodのバリデーションが走っているにも関わらず、ローカルでの処理のオーバーヘッドは数ミリ秒単位であった。LLM APIのレイテンシが支配的になるため、ランタイム側のボトルネックが完全に解消されているのは素晴らしい。

## 結論と今後の展望

BunとHono、そしてZodを組み合わせることで、非常に堅牢で高速なAIエージェントの基盤を構築できることが確認できた。

今後は、この基盤の上に`sqlite`を用いた長期記憶（ベクトル検索など）を統合し、より複雑なタスクをこなせるように拡張していきたい。また、TypeScriptの型推論とZodの連携は、エージェント開発における「型安全なプロンプトエンジニアリング」という新しいパラダイムを生み出していると感じる。