---
title: "Bun vs Node.js：CLIツール作成における2026年のベストプラクティス"
date: "2026-03-25T17:03:00+09:00"
description: "TypeScriptでCLIツールを作るならBunかNodeか。起動速度とDXの観点から徹底検証しました。"
tags: ["tech", "typescript", "bun", "nodejs"]
---

TypeScriptで簡単なCLIツールを作るとき、とりあえず `ts-node` や `tsx` を使ってNode.jsで走らせるのが長らく定番だった。
しかし、2026年現在、本当にそれがベストな選択肢なのだろうか？
特に、「ちょっとしたスクリプト」から「毎日使う強力なCLI」まで、起動速度はUXに直結する。

今回は、全く同じ処理を行うCLIツールをBunとNode.jsの両方で作成し、実行速度と開発体験（DX）を比較・検証してみた。

## 🚀 検証用コード：単純なファイル検索ツール

まずは、カレントディレクトリ以下のファイルを再帰的に検索し、特定の拡張子を持つファイルの一覧を出力する単純なスクリプトを用意した。

```typescript
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

async function findFiles(dir: string, ext: string): Promise<string[]> {
  const dirents = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(dirents.map((dirent) => {
    const res = join(dir, dirent.name);
    return dirent.isDirectory() ? findFiles(res, ext) : res;
  }));
  return Array.prototype.concat(...files).filter(f => f.endsWith(ext));
}

async function main() {
  const start = performance.now();
  const results = await findFiles(".", ".md");
  const end = performance.now();
  console.log(`Found ${results.length} files in ${(end - start).toFixed(2)}ms`);
}

main();
```

これくらい単純なスクリプトなら、どちらのランタイムでもそのまま動く。
`node:fs` などのコアモジュールを使っていれば、BunはNode.jsとの互換性を高く保っているため、コードの書き換えは不要だ。

## ⏱️ 実行速度の比較

同じマシン（Ubuntu環境）で、巨大なディレクトリ（約10,000ファイル、うち`.md`が1,500ファイル）を対象に実行速度を計測してみた。

### Node.js (v22) + tsx

まずは従来の定番構成。TypeScriptをそのまま実行するために `tsx` を使用する。

```bash
$ npx tsx find.ts
Found 1532 files in 142.35ms
```

悪くはない。しかし、コマンドを叩いてから結果が出るまでに、ほんの一瞬（体感で0.3秒ほど）の「もたつき」を感じる。
これは `tsx` がTypeScriptをトランスパイルするオーバーヘッドがあるためだ。

### Bun

次にBun。TypeScriptをネイティブにサポートしているため、そのまま実行できる。

```bash
$ bun run find.ts
Found 1532 files in 28.14ms
```

**圧倒的だ。**
Node.js + `tsx` と比較して、純粋な処理時間もさることながら、起動から実行終了までの「体感速度」が全く違う。
エンターキーをターン！と叩いた瞬間に結果が出力される。この「待ち時間ゼロ」の感覚は、毎日使うCLIツールにおいて非常に重要だ。

## 📦 単一バイナリへのコンパイル

CLIツールとして配布することを考えると、利用者の環境にNode.jsやBunがインストールされていることを前提にしたくない。
Bunには、スクリプトを単一の実行可能バイナリにコンパイルする機能が標準で備わっている。

```bash
$ bun build ./find.ts --compile --outfile find-md
```

これで生成された `find-md` バイナリを実行してみる。

```bash
$ ./find-md
Found 1532 files in 22.05ms
```

さらに速くなった。JITコンパイルのオーバーヘッドがなくなり、完全にネイティブアプリとして動作している。
Node.jsでも `pkg` や `esbuild` などを駆使すれば単一バイナリ化は可能だが、Bunならコマンド一発で済むという開発体験の良さは圧倒的だ。

## 💡 結論：2026年のCLI開発はBunが第一選択肢

検証の結果、TypeScriptでCLIツールを作る場合、以下の理由からBunを選択するのが現時点でのベストプラクティスと言える。

1. **爆速の起動速度**: TypeScriptをネイティブ実行できるため、トランスパイルのオーバーヘッドがない。
2. **単一バイナリ化が簡単**: `bun build --compile` で即座に配布可能なバイナリを作れる。
3. **Node.js互換性**: 既存の資産（`node:fs` など）をそのまま活かせる。

もちろん、一部の複雑なNode.jsネイティブアドオンに依存している場合はNode.jsを選ぶ理由になるが、純粋なTS/JSで完結するツールであれば、Bun一択と言っても過言ではない。

「効率厨」としては、この起動速度の違いだけでもBunに乗り換える十分な理由になる。
皆さんも、次にCLIツールを作る際はぜひBunを試してみてほしい。
