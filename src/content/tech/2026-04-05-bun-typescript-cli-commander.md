---
title: "BunとTypeScriptで作る爆速CLIツール: Commanderを使った実践構築"
description: "Bunの実行速度とTypeScriptの型安全性を活かし、Commanderを使った実践的なCLIツールを構築する手順と検証ログ。"
date: "2026-04-05T20:00:00+09:00"
tags: ["Bun", "TypeScript", "CLI", "Commander"]
---

Node.jsでCLIツールを作る時代は終わりを告げようとしているのかもしれません。最近のCLIツールは軒並みBunやRust、Goで書き直されていますが、手軽さとパフォーマンスのバランスを考えると「Bun + TypeScript」が現在の最適解の一つだと感じています。

今回は、TypeScriptで書いたコードをトランスパイルなしで直接、しかも爆速で実行できるBunの強みを活かして、`Commander`を使った実践的なCLIツールを作ってみたので、その構成や検証結果をまとめておきます。

## なぜBunでCLIを作るのか？

CLIツールにおいて「起動速度」はUXに直結します。Node.jsでTypeScriptを実行しようとすると、`ts-node`や`tsx`を挟む必要があり、どうしても起動に数ミリ秒〜数十ミリ秒のオーバーヘッドがかかります。

BunならTypeScriptをネイティブで解釈し、即座に実行を開始します。さらに、単一のバイナリファイルにコンパイルする機能（`bun build --compile`）も標準で備わっているため、配布も非常に簡単です。

## プロジェクトのセットアップ

まずはプロジェクトの初期化から。おなじみのコマンドですが、Bunを使うと一瞬で終わります。

```bash
mkdir bun-fast-cli && cd bun-fast-cli
bun init
```

必要なパッケージとして、引数パースのデファクトスタンダードである`commander`と、ターミナルの文字に色をつける`chalk`（または軽量な`picocolors`）をインストールします。

```bash
bun add commander picocolors
bun add -d @types/node
```

## エントリポイントの作成

`src/index.ts`を作成し、CLIの骨組みを書いていきます。

```typescript
import { Command } from 'commander';
import pc from 'picocolors';

const program = new Command();

program
  .name('fast-cli')
  .description('BunとTypeScriptで作る爆速CLI')
  .version('1.0.0');

program
  .command('greet')
  .description('挨拶を出力します')
  .argument('<name>', '名前を指定してください')
  .option('-u, --uppercase', '大文字で出力する')
  .action((name, options) => {
    let greeting = `Hello, ${name}!`;
    if (options.uppercase) {
      greeting = greeting.toUpperCase();
    }
    console.log(pc.green(greeting));
  });

program.parse(process.argv);
```

## 実行速度の検証（Node.jsとの比較）

コードが書けたので、さっそく実行してみます。

```bash
bun run src/index.ts greet Poteto
```

**実行結果:**
```text
Hello, Poteto!
```

ここで、以前作ったNode.jsベースのCLIと起動速度を比較してみました。`time`コマンドで計測した結果が以下です。

### Node.js (tsx経由)
```bash
time npx tsx src/index.ts greet Poteto
# 実行時間: 約 0.45秒
```

### Bun (直接実行)
```bash
time bun run src/index.ts greet Poteto
# 実行時間: 約 0.03秒
```

圧倒的です。10倍以上違います。CLIを叩くたびに0.4秒待たされるか、一瞬で返ってくるかの違いは、開発体験（DX）に大きく影響します。

## バイナリ化して配布する

Bunの強力な機能の一つが、依存関係を含めた単一バイナリの生成です。

```bash
bun build ./src/index.ts --compile --outfile fast-cli
```

これだけで、Node.jsもBunもインストールされていない環境でも動くバイナリが生成されます。

```bash
./fast-cli greet Poteto -u
# HELLO, POTETO!
```

## 実務での判断とまとめ

簡単なスクリプトから本格的なツールまで、CLIを作るなら「とりあえずBun」で全く問題ない、むしろメリットしかない状態になっています。

- **メリット**: 起動が早い、TSをそのまま書ける、バイナリ配布が簡単。
- **デメリット**: 一部Node.js依存の古いパッケージが動かない可能性（ただし最近は互換性がかなり高まっている）。

私の場合、ちょっとした自動化スクリプトや、チーム内に配る開発補助ツールはすべてBunに移行しました。特に`bun build --compile`のおかげで、「Nodeのバージョンが〜」といったサポートのコストがゼロになったのが一番の収穫です。

みなさんもぜひ、休日の数時間を使ってBunでCLIツールを書いてみてください。その速さと手軽さに感動するはずです。