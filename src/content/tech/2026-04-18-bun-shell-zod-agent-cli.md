---
title: "Bun ShellとZodで作る堅牢なAgent用CLIツール"
date: "2026-04-18T21:03:00.000+09:00"
description: "AI Agentのツール呼び出しを安定させるため、Bun ShellとZodを組み合わせて型安全なCLIコマンドラッパーを作った話。実コードと検証ログ付き。"
tags: ["Bun", "Zod", "CLI", "Agent"]
---

Agentを作っていると必ずぶつかる壁がある。「CLIツールの呼び出しが不安定で、出力のパースに失敗する」問題だ。

今回は、Bun 1.5+で強化された `Bun Shell` と `Zod` を組み合わせて、Agentから安全に叩ける堅牢なCLIラッパーを自作した話をする。これ、マジでQoLが上がるのでおすすめしたい。

## 従来の課題: シェルコマンドの実行とエラーハンドリング

Node.js時代は `child_process.exec` や `execa` を使っていたと思う。だが、AgentのToolとしてこれらを露出させると、予期せぬエラー（標準エラー出力への謎の警告、想定外の終了コード）でAgentの推論ループごと死ぬことがよくあった。

```typescript
// 従来のエラーが起きやすい例
import { execSync } from "child_process";

function runTool(cmd: string) {
  try {
    const result = execSync(cmd, { encoding: "utf-8" });
    return JSON.parse(result); // ここでパースエラーになりがち
  } catch (e) {
    return { error: "Failed" };
  }
}
```

Agentは `stdout` と `stderr` の違いをそこまで厳密に区別しないし、JSONを返してほしいのにプレーンテキストが混ざってパースエラーになるのが日常茶飯事だった。

## 解決策: Bun Shell × Zod

そこで、Bun Shellのタグ付きテンプレートリテラルと、Zodの強力なスキーマバリデーションを組み合わせる。Bun ShellはデフォルトでPromiseを返し、終了コードが0以外ならエラーを投げてくれる。

```typescript
import { $ } from "bun";
import { z } from "zod";

// 期待するJSONの型を定義
const GitStatusSchema = z.object({
  branch: z.string(),
  changes: z.number(),
  isClean: z.boolean()
});

async function getSafeGitStatus() {
  try {
    // Bun Shellでコマンド実行 (テキストとして取得)
    const text = await $`git status --porcelain`.text();
    
    // Agent向けに構造化
    const lines = text.trim().split("\n").filter(Boolean);
    const data = {
      branch: (await $`git branch --show-current`.text()).trim(),
      changes: lines.length,
      isClean: lines.length === 0
    };

    // Zodでバリデーションして返す
    return GitStatusSchema.parse(data);
  } catch (err) {
    // エラー時もAgentが解釈しやすいフォーマットで返す
    console.error("Shell Execution Error:", err);
    return { error: true, reason: String(err) };
  }
}
```

### 実行結果と検証ログ

実際に上記を走らせてみると、驚くほどスッキリした出力を得られる。

```bash
$ bun run cli.ts
{
  branch: "main",
  changes: 0,
  isClean: true
}
```

もしGitリポジトリ外で実行した場合も、`$` が投げる例外をキャッチして安全なエラーオブジェクトを返す。Agentが「あ、ここGitリポジトリじゃないんだな」と理解して次の行動に移れるのが最大のメリットだ。

## なぜこの構成が最強なのか

1. **エスケープ処理が不要**: Bun Shellの `${var}` 展開は自動でエスケープされるため、OSコマンドインジェクションの脆弱性を防ぎやすい。
2. **型安全**: Zodを通すことで、LLM（Agent）に渡す前に「絶対にこの型である」ことを保証できる。
3. **オーバーヘッドが少ない**: Bunの起動速度と実行速度のおかげで、CLI呼び出しが連続してもNode.jsより圧倒的に速い。

Zodの `safeParse` を使えば、例外を投げずに失敗時の処理もスマートに書ける。

```typescript
const result = GitStatusSchema.safeParse(data);
if (!result.success) {
  return { error: "Invalid Output Format", details: result.error.flatten() };
}
return result.data;
```

Agentのツール開発は「いかに例外を殺し、意味のあるエラーメッセージをLLMに返すか」が勝負になる。Bun ShellとZodの組み合わせは、そのベストプラクティスの一つと言えるだろう。
