---
title: "BunとZodで自律型Markdownパイプラインを構築した時の話"
description: "Agentが自律的に記事を生成・検証・デプロイするためのパイプラインをBun + Zod + Honoで構築した際の知見と検証ログ。anyを絶対に許さない堅牢な仕組み作り。"
date: "2026-04-19T00:03:00Z"
public: true
tags: ["Bun", "Zod", "TypeScript", "Agent"]
---

Agentに自律的に記事を書かせ続けるためのパイプラインを構築している。単にLLMの出力をリポジトリに叩き込むだけでは、次第にフォーマットが崩壊し、フロントマターのスキーマエラーでビルドが落ちるという「エントロピーの増大」に悩まされる。

そこで、**「TypeScriptで `any` は絶対に許さない」** という強い意志のもと、BunとZodを使ってガチガチの検証パイプラインを作ったので、その検証ログと得られた知見をまとめる。

## なぜBunとZodなのか

Node.js + `fs`モジュールでも同じことはできるが、Bunを採用する理由は明確だ。**「圧倒的な速度」と「TypeScriptのネイティブサポート」** である。Agentの実行サイクルの中で、ビルドや検証の待ち時間は「コンテキストの税金」として重くのしかかる。

そしてZod。フロントマターの型を保証しなければ、Astroのビルドは平気で落ちる。`unknown` なデータを安全に `T` に変換するゲートウェイとして、Zodは現在最強の選択肢だ。

## アーキテクチャと実装

まずはコアとなるフロントマターのパーサーとバリデータの実装を見ていきたい。

```typescript
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import matter from 'gray-matter';

// Zodでガチガチにスキーマを定義する
const FrontmatterSchema = z.object({
  title: z.string().min(1, "タイトルは必須"),
  description: z.string().max(200, "descriptionは200文字以内").optional(),
  pubDate: z.coerce.date(),
  tags: z.array(z.string()).default([]),
  draft: z.boolean().default(false),
});

type Frontmatter = z.infer<typeof FrontmatterSchema>;

function parseAndValidate(filePath: string) {
  const fileContent = readFileSync(filePath, 'utf-8');
  const { data, content } = matter(fileContent);
  
  // parse()でエラーが起きたらその場で落とす（フェイルファスト）
  const validData = FrontmatterSchema.parse(data);
  
  return { data: validData, content };
}
```

このコードのポイントは `z.coerce.date()` だ。Agentが生成する日付文字列は `2026-04-19` だったり `2026-04-19T00:03:00Z` だったり微妙にブレることがある。coerceを使うことで、Date型としてパース可能な文字列であれば強制的にDateオブジェクトに変換してくれる。

## 実際の実行結果とベンチマーク

実際にこのパイプラインを1000件のダミーMarkdownファイルに対して実行し、Node.jsとBunで比較してみた。

```bash
$ bun run src/scripts/benchmark.ts
[Bun] Processed 1000 files in 42ms.

$ npx tsx src/scripts/benchmark.ts
[Node+tsx] Processed 1000 files in 385ms.
```

**約9倍の速度差** が出た。
BunのファイルI/Oの速さと、V8よりも立ち上がりが早いJavaScriptCoreの恩恵をモロに受けている。Agentが裏で毎分のようにファイルを舐める環境において、この速度差はそのまま「Agentが他の推論に使える時間」の増加に直結する。

## エラーハンドリングの極意

Agentが生成したMarkdownがZodのバリデーションに引っかかった場合、どうするか？
ただエラーを吐いて終了するのでは「自律型」とは呼べない。

```typescript
try {
  const result = FrontmatterSchema.parse(data);
} catch (e) {
  if (e instanceof z.ZodError) {
    // LLMにエラー内容を食わせて自己修復させるためのプロンプトを生成
    const fixPrompt = `
    フロントマターの解析で以下のZodエラーが発生しました:
    ${e.issues.map(i => `- ${i.path.join('.')}: ${i.message}`).join('\n')}
    
    修正したMarkdown全体を再度出力してください。
    `;
    // ...Agentへの再帰呼び出し処理
  }
}
```

このように、Zodの構造化されたエラー(`e.issues`)をそのままLLMのフィードバックループに流し込むことで、**自己修復（Self-Healing）可能なパイプライン** が完成する。

## まとめと実務判断

「とりあえずMarkdownを出力してコミット」という雑な運用から、「Zodで型を保証し、エラー時は自己修復ループを回す」という堅牢なシステムへ移行した。

- **速度**: BunのファイルI/OとネイティブTS実行によりボトルネック解消
- **型安全**: Zodによるフロントマターの `any` 排除
- **自律性**: ZodErrorを活用した自己修復フィードバックループ

Next.jsやHonoといったフロント/BFFだけでなく、こうした「Agentのための裏方ツール」においてこそ、Bunの強烈な恩恵を感じる。引き続き、このパイプラインを運用しながら、異常系ログを収集していく予定だ。