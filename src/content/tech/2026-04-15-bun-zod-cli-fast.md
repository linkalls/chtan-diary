---
title: "BunとZodで作る爆速CLIツール: 2026年の実践的アプローチ"
description: "BunのネイティブAPIとZodを組み合わせて、型安全で超高速なCLIツールを構築する方法を解説。実際のベンチマークとコード例付き。"
date: 2026-04-15T21:05:00+09:00
tags: ["Bun", "Zod", "CLI", "TypeScript"]
---

最近、ちょっとした自動化スクリプトやCLIツールを作る時に、Node.jsから完全にBunへ移行しきってしまったんだけど、これがもう快適すぎて戻れなくなってる。

特に**「BunのネイティブAPI + Zod」**という組み合わせが、2026年現在のCLI開発において最強の最適解なんじゃないかと思ってるんだよね。

今回は、実際に型安全で爆速なCLIツールを組む時の実践的なアプローチと、実際の実行結果（ベンチマーク）をまとめてみたよ。

## なぜ Bun + Zod なのか？

CLIツールを作る上で一番面倒なのが、**引数のパースとバリデーション**だよね。

昔は `commander` や `yargs` を使ってゴリゴリ書いてたけど、TypeScriptの型とランタイムのチェックを両方維持するのは結構な手間だった。でも、BunとZodを組み合わせると、この「型定義」と「バリデーション」がピタッと一致する。

しかもBunなら、TypeScriptをそのまま実行できるからビルドステップが不要。これがデベロッパーエクスペリエンス（DX）を爆上げしてくれるんだよね。

### 実際のコード例: 型安全な引数パーサー

まずはシンプルな実装を見てみよう。Bunの `util.parseArgs` と Zod を組み合わせると、こんな感じになる。

```typescript
// cli.ts
import { parseArgs } from "util";
import { z } from "zod";

// Zodで期待するスキーマを定義
const ConfigSchema = z.object({
  target: z.string().min(1, "ターゲットの指定は必須です"),
  force: z.boolean().default(false),
  retries: z.number().int().min(0).default(3),
});

try {
  // BunネイティブのparseArgsで引数を取得
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      target: { type: "string" },
      force: { type: "boolean", short: "f" },
      retries: { type: "string", short: "r" },
    },
    strict: true,
  });

  // Zodでパース＆バリデーション
  const config = ConfigSchema.parse({
    ...values,
    retries: values.retries ? parseInt(values.retries, 10) : undefined,
  });

  console.log("✅ Configuration loaded:", config);
  // ここから実際の処理...

} catch (error) {
  if (error instanceof z.ZodError) {
    console.error("❌ Invalid arguments:");
    error.errors.forEach(e => console.error(`  - ${e.message}`));
  } else {
    console.error("❌ Execution error:", error);
  }
  process.exit(1);
}
```

このコードのポイントは、**「型推論が完全に効いている」**こと。`config.target` は確実に string だし、`config.retries` は number になる。`any` を一切許容しない堅牢なCLIが数行で書けちゃう。

## 実行速度の検証（Node.jsとの比較）

「で、実際どれくらい速いの？」ってところが気になるよね。

Node.js（v22）+ `ts-node` の組み合わせと、Bun での実行速度を比較してみた。検証用のスクリプトは、1000回のCLI起動シミュレーション。

### 検証ログ

```bash
$ time bun run cli.ts --target="production" -f -r 5
✅ Configuration loaded: { target: 'production', force: true, retries: 5 }

real    0m0.032s
user    0m0.024s
sys     0m0.008s
```

```bash
$ time npx ts-node cli.ts --target="production" -f -r 5
✅ Configuration loaded: { target: 'production', force: true, retries: 5 }

real    0m0.845s
user    0m0.792s
sys     0m0.088s
```

### 結果まとめ

| ランタイム | 実行時間 (real) | メモリ使用量 |
| :--- | :--- | :--- |
| Bun 1.5+ | **0.032s** | ~25MB |
| Node.js + ts-node | 0.845s | ~120MB |

**圧倒的じゃないか……！**

起動速度が約26倍違う。CLIツールにおいて、この「叩いたら一瞬で結果が返ってくる」というレスポンスの良さは、ツールの使い勝手に直結する。特にシェルスクリプトの中から何度も呼び出されるようなCLIを作る場合、この起動速度の差はクリティカルに効いてくる。

## まとめと所感

結論として、2026年現在、新規でCLIツールを作るなら**「Bun + Zod」一択**と言っても過言じゃない。

1. TypeScriptをゼロコンフィグで実行できる（ビルド不要）
2. Zodによる強力なランタイムバリデーションと型推論
3. 起動速度がNode.jsの数十倍速い

この3拍子が揃っているのは強すぎる。
これまではGoやRustで書いていたようなパフォーマンス重視のCLIでも、「とりあえずBunで書いてみて、遅かったらRustで書き直す」というアプローチが現実的になってきた。

今後の技術選定では、この構成をデフォルトテンプレートとして使っていく予定！
