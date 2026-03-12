---
title: "Zero-Shot Type Safety: Using Zod to Constrain AI Outputs"
date: 2026-03-12T16:00:00.000Z
description: "AIの出力を静的型付き言語の関数に渡す際、安全性をどう担保するか。Zodを用いたスキーマバリデーションと、プロンプトエンジニアリングの境界線を探る。"
tags: ["tech", "typescript", "zod", "ai"]
---

AIエージェントの自律化を進めれば進めるほど、LLMの出力をプログラムの別のモジュールへ繋ぐ機会が増える。人間がプロンプトを手打ちしているうちは「ハルシネーションが出たら手動で直す」で済むが、システムに組み込むとなるとそうはいかない。

TypeScriptの `any` を許さない「効率厨」としては、AIが吐き出すJSONを無条件で信用することなど言語道断だ。ここでは、Zodを用いてAIの出力を型安全に扱うアプローチについて、実践的な知見をまとめる。

## LLMの気まぐれな出力をどう飼い慣らすか

通常、LLMにJSONを返させる場合、プロンプトで「必ず指定したJSON形式で返してね」と念を押す。最近のモデル（Gemini 3 ProやGPT-5級）はかなり優秀で、指示を無視して余計な自然言語を混ぜてくることは減った。だが、**「フィールドの欠落」や「型違い（文字列を期待したのに数値が入るなど）」** は依然として起こり得る。

これを素のJavaScriptで `JSON.parse` してそのまま使うのは、地雷原をスキップで進むようなものだ。

## Zodによる防御壁の構築

そこでZodの出番だ。ランタイムでデータの形を検証し、TypeScriptの型推論ともシームレスに連携できる。

```typescript
import { z } from "zod";

// 期待するAIの出力スキーマを定義
const AgentActionSchema = z.object({
  actionType: z.enum(["search", "execute", "respond"]),
  payload: z.record(z.string(), z.any()).optional(),
  reasoning: z.string().describe("Why this action was chosen"),
});

// TypeScriptの型として抽出
type AgentAction = z.infer<typeof AgentActionSchema>;

async function handleAIResponse(rawResponse: string) {
  try {
    const parsedJson = JSON.parse(rawResponse);
    // パースしたJSONをZodでバリデーション
    const safeData = AgentActionSchema.parse(parsedJson);
    
    // ここから下は完全に型安全！ safeData は AgentAction 型として扱える
    console.log(`Executing: ${safeData.actionType}`);
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("AIの出力がスキーマに違反しています:", error.errors);
      // ここでAIにエラー内容をフィードバックし、自己修復ループを回すことも可能
    }
  }
}
```

## Zodの `.describe()` とプロンプトの自動生成

Zodを使う隠れたメリットとして、`.describe()` メソッドがある。スキーマ定義の横に、そのフィールドの意味を人間（あるいはAI）向けに書ける機能だ。

賢いアプローチとしては、**このZodスキーマから逆にLLMへのシステムプロンプト（JSON schema）を自動生成する** という手法がある。これにより、「TypeScriptのコード上の定義」と「AIに渡す指示」が完全に同期する。変更漏れによるランタイムエラーを防げるのだ。

## エラー時の自己修復（Self-Correction）ループ

スキーマバリデーションに失敗した場合、単にプログラムを落とすのではなく、AIにエラーメッセージをそのまま食わせて再生成させるループが有効だ。

```typescript
// (擬似コード)
let attempts = 0;
while (attempts < 3) {
  const result = await llm.generate(prompt);
  const validation = AgentActionSchema.safeParse(JSON.parse(result));
  
  if (validation.success) {
    return validation.data;
  } else {
    // ZodのエラーメッセージをそのままAIに返し、修正を要求する
    prompt += `\nPrevious output failed validation: ${validation.error.message}. Please fix and retry.`;
    attempts++;
  }
}
throw new Error("AI failed to produce valid output after 3 attempts.");
```

この「Zodのエラーメッセージ」は非常に構造化されており、LLMが「どこをどう間違えたか」を理解するのに十分な情報を持っている。

## 結論：型は祈りではなく、強制力である

「AIが正しい形式で返してくれるように」と長々としたプロンプトを書く（祈る）よりも、コード側で厳格なゲートキーパー（Zod）を置き、弾かれたら機械的に再要求する（強制する）方が、結果的にシステムは堅牢になる。

TypeScript環境で自律型エージェントを組むなら、Zod（あるいはそれに類するバリデーションライブラリ）の導入は必須教養と言っていいだろう。
