---
title: "Bun + Zod で実現する、LLM出力の完全型安全パースとエラーハンドリング"
date: "2026-04-11T21:03:00.000+09:00"
tags: ["Bun", "Zod", "LLM", "TypeScript"]
---

LLMを使ったAgent開発で一番の苦労は「LLMが指定したJSONフォーマットを守らない」ことだ。`response_format: { type: "json_object" }` を指定しても、ハルシネーションで微妙にキーが違ったり、プロパティが欠けたりする。

今回は、**Bunの高速な実行環境**と**Zodの強力なスキーマ検証**を組み合わせて、LLMからの出力を絶対に `any` で扱わず、完全な型安全を保証しながら、パースエラー時の自動リトライまで組み込んだ堅牢なラッパーを作ったので、その構成と検証ログをまとめていく。

## 課題：LLMのJSON出力は信用できない

JSONモードを有効にしても、LLMの出力は所詮「JSONっぽい文字列」にすぎない。以下のような問題が頻発する。

- 数値型を要求しているのに文字列で返してくる（`"age": "28"` など）
- 配列の中に `null` が混入する
- 未定義の余分なキーが含まれている
- そもそもJSONとして壊れている（カンマが抜けているなど）

これをそのまま `JSON.parse()` して `as` で型アサーションするのは、TypeScriptにおいて大罪である。`any` や `as` はバグの温床でしかなく、絶対に許されない。

## Zodによるスキーマ定義とパース

まずはZodを使って、期待するレスポンスのスキーマをガチガチに固める。

```typescript
import { z } from "zod";

// Agentの思考ログとアクションのスキーマ
const AgentResponseSchema = z.object({
  thought: z.string().min(1, "思考ログは必須です"),
  action: z.enum(["search", "read", "write", "finish"]),
  target: z.string().optional(),
  confidence: z.number().min(0).max(100)
}).strict(); // 未定義のキーを許さない

type AgentResponse = z.infer<typeof AgentResponseSchema>;
```

`.strict()` をつけることで、LLMが勝手に気を利かせて追加した謎のプロパティを弾くことができる。

## Bunで実装する坚牢なパーサー関数

Bunの `Bun.file()` や高速なI/Oを活かしつつ、LLMの呼び出しとZodのパースを統合したラッパー関数を実装する。パースに失敗した場合、Zodのエラーメッセージをプロンプトに含めてLLMに再挑戦させる（セルフコレクション）。

```typescript
async function fetchAgentResponseWithRetry(
  prompt: string, 
  maxRetries = 3
): Promise<AgentResponse> {
  let currentPrompt = prompt;

  for (let i = 0; i < maxRetries; i++) {
    // 擬似的なLLM呼び出し（実際はOpenAI API等）
    const rawJsonString = await callLLM(currentPrompt);

    try {
      // 1. JSONとしてパース
      const parsedJson = JSON.parse(rawJsonString);
      
      // 2. Zodでスキーマ検証
      const validData = AgentResponseSchema.parse(parsedJson);
      
      return validData; // 成功！

    } catch (error) {
      if (error instanceof z.ZodError) {
        console.warn(`[Retry ${i + 1}/${maxRetries}] Zod Validation Failed:`, error.errors);
        
        // エラー内容を次のプロンプトにフィードバック
        const errorFeedback = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
        currentPrompt = `${prompt}\n\n【警告】前回の出力は以下のエラーにより拒否されました。修正してください：\n${errorFeedback}`;
      } else {
        console.warn(`[Retry ${i + 1}/${maxRetries}] JSON Parse Failed:`, error);
        currentPrompt = `${prompt}\n\n【警告】前回の出力は有効なJSONではありませんでした。正しいJSON形式で出力してください。`;
      }
    }
  }

  throw new Error("Max retries exceeded. LLM failed to produce valid JSON.");
}
```

### 実行ログ

わざとLLMが不正なフォーマット（`confidence` が文字列）を返したと仮定した場合の実行ログは以下のようになる。

```bash
$ bun run src/agent.ts
[Retry 1/3] Zod Validation Failed: [
  {
    "code": "invalid_type",
    "expected": "number",
    "received": "string",
    "path": ["confidence"],
    "message": "Expected number, received string"
  }
]
... retrying with feedback ...
✅ Success! Parsed Data: { thought: "...", action: "search", target: "Bun Zod", confidence: 95 }
```

エラー箇所（`confidence`）とその理由（`Expected number, received string`）が明確にLLMにフィードバックされるため、2回目のリトライで高確率で修正された正しいJSONが返ってくる。

## まとめ

LLMの出力を `any` で受け取るのはエンジニアとして敗北である。
Bunの高速な実行基盤上で、Zodを使ったスキーマ検証と、ZodErrorの恩恵を活かした自動リトライ（セルフコレクション）を組み込むことで、Agentの動作安定性は飛躍的に向上する。

LLMをシステムに組み込む際は、**「LLMは絶対に間違える」という前提**に立ち、型レベルで厳密に関所を設けるアーキテクチャが必須だ。
