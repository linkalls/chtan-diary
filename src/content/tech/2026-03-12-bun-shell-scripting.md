---
title: "Bun Shellの表現力：TypeScriptでシェルスクリプトを置き換えるメリット"
description: "Bun Shellを使うことで、bashやzxに頼らずに型安全かつ直感的にスクリプトを書ける理由とその実例を解説する。"
date: "2026-03-12T13:00:00+09:00"
tags: ["Bun", "TypeScript", "Shell"]
---

日々の自動化タスクやCLIツールの開発において、シェルスクリプト（Bash）は長らく最強の座に君臨してきた。しかし、ロジックが複雑になってくると途端にメンテが辛くなる。変数展開の罠、配列の扱いにくさ、そして何より「型がない」という問題だ。

そこで今回は、TypeScriptエンジニアにとっての救世主である **Bun Shell** の実用性について深掘りしていきたい。

## そもそもなぜBun Shellなのか？

Node.js界隈では、Googleの `zx` などを使ってシェル操作をJS/TSでラップする手法が普及している。しかし、Bun Shellはランタイムレベルでシェル操作を統合しているため、外部依存なしに極めて高速に動作する。

一番の恩恵は「型安全なシェル操作」と「JSの強力な文字列操作の融合」だ。

### 基本的な書き方

```typescript
import { $ } from "bun";

// 簡単なコマンド実行
const result = await $`ls -la | grep "package"`.text();
console.log(result);
```

この `$`` ` 構文が肝だ。標準出力をそのまま文字列として受け取れるため、JSONのパースも容易になる。

## 実践：型安全なデータ抽出パイプライン

例えば、特定のディレクトリ内のMarkdownファイルから、フロントマターの特定フィールドだけを抽出してJSON化するスクリプトを考えてみる。Bashだと `jq` や `awk` を駆使することになり、暗号のようなコードが生成されがちだ。

Bunならこう書ける。

```typescript
import { $ } from "bun";
import { readdir } from "node:fs/promises";
import path from "node:path";

const targetDir = "./src/content/tech";
const files = await readdir(targetDir);

const results = [];

for (const file of files) {
  if (!file.endsWith(".md")) continue;
  
  const fullPath = path.join(targetDir, file);
  // catで読み込み、JS側で処理する
  const content = await $`cat ${fullPath}`.text();
  
  // 簡易的なフロントマターのパース
  const titleMatch = content.match(/title:\s*"(.*?)"/);
  if (titleMatch) {
    results.push({
      file,
      title: titleMatch[1]
    });
  }
}

console.log(JSON.stringify(results, null, 2));
```

シェルコマンドの実行結果を直接変数に入れ、JSの正規表現や配列操作に繋げる。このシームレスな体験は一度味わうとBashには戻れない。

## エラーハンドリングの洗練

シェルスクリプトで最も頭を悩ませるのがエラーハンドリングだ。`set -e` をつけるだけでは不十分なケースも多い。

Bun Shellでは、コマンドが非ゼロの終了コードを返した場合、自動的に `ShellError` がスローされる。

```typescript
import { $ } from "bun";

try {
  await $`cat nonexistent_file.txt`;
} catch (error) {
  console.error("コマンドが失敗しました！");
  console.error("終了コード:", error.exitCode);
  console.error("エラー出力:", error.stderr.toString());
}
```

このように、JavaScriptの標準的な `try-catch` フローに乗せることができるため、予期せぬスクリプトの停止を防ぎ、適切なフォールバック処理を構築しやすい。

## 結論：自動化はTypeScriptの時代へ

インフラ管理やCI/CDパイプラインにおいて、「ただコマンドを並べるだけ」ならBashでもいい。しかし、少しでも条件分岐やデータ変換が入るなら、Bun Shell + TypeScriptの組み合わせは圧倒的な開発体験をもたらす。

「TypeScriptで `any` は絶対許さない」という強い意志を持つ開発者にとって、システムの隅々まで型を行き渡らせる手段として、Bun Shellは必須のツールになるだろう。