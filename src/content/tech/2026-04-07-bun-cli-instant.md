---
title: "Bun + TypeScript で CLI ツールを作るなら今。瞬速起動と Commander の組み合わせが最強な理由"
description: "Node.js の起動遅延から解放され、TypeScript をそのまま実行できる Bun を使ったモダンな CLI 開発。実際にコードを書いて実行ログを比較検証してみました。"
date: "2026-04-07T17:00:00+09:00"
tags: ["Bun", "TypeScript", "CLI", "開発体験"]
---

最近、ちょっとした自動化スクリプトやツールを作るのに、もっぱら Bun を使っています。「TypeScript で書いたコードが、トランスパイルなしで一瞬で動く」という体験は、一度味わうと Node.js には戻れなくなりますね。

今回は、CLI ツール作成の定番ライブラリである `commander` を使い、Bun 環境でどれだけサクッと、しかも爆速で動く CLI が作れるのかを検証してみました。

## なぜ CLI に Bun なのか？

CLI ツールにおいて「起動速度」は命です。Node.js で TypeScript を使おうとすると、`ts-node` や `tsx` を挟む必要があり、ちょっとしたコマンドを叩くだけでも数百ミリ秒のオーバーヘッドが発生していました。

しかし、Bun なら TypeScript をネイティブに実行できるため、このオーバーヘッドがほぼゼロになります。

### 実際に書いてみる

適当なディレクトリでセットアップします。

```bash
mkdir bun-cli-test && cd bun-cli-test
bun init -y
bun add commander
bun add -d @types/node
```

そして、シンプルな CLI アプリケーション `index.ts` を作成します。

```typescript
import { Command } from 'commander';
import { $ } from 'bun';

const program = new Command();

program
  .name('my-cli')
  .description('Bunで作った爆速CLI')
  .version('1.0.0');

program
  .command('ping')
  .description('ポンと返します')
  .action(() => {
    console.log('pong! 🏓');
  });

program
  .command('sysinfo')
  .description('システム情報を表示します')
  .action(async () => {
    console.log('OS情報を取得中...');
    const result = await $`uname -a`.text();
    console.log(result.trim());
  });

program.parse();
```

これだけで準備完了です。

## 実行結果とパフォーマンス検証

さっそく実行してみます。まずは普通に `ping` コマンドから。

```bash
$ bun run index.ts ping
pong! 🏓
```

速い。体感的にゼロ秒です。では、実際に `time` コマンドで計測してみましょう。

```bash
$ time bun run index.ts ping
pong! 🏓

real    0m0.038s
user    0m0.025s
sys     0m0.012s
```

**約38ミリ秒**。これは驚異的です。Node.js + `ts-node` の場合、キャッシュなしだと 500ms~1000ms かかることもザラなので、その差は歴然としています。

### シェルコマンドの実行（Bun Shell）

Bun には `$` という強力なシェル実行機能（Bun Shell）が組み込まれています。上の `sysinfo` コマンドでそれを使っているので、実行してみます。

```bash
$ bun run index.ts sysinfo
OS情報を取得中...
Linux poteto-machine 6.8.0-106-generic #106-Ubuntu SMP PREEMPT_DYNAMIC ... x86_64 GNU/Linux
```

外部プロセスの呼び出しも非常にシンプルで直感的です。`child_process` を使っていた時代のごちゃごちゃしたコードとはおさらばできます。

## 単一バイナリへのコンパイル

さらに、Bun の強力な機能として、スクリプトを単一の実行可能ファイルにコンパイルする機能があります。これをやれば、実行環境に Bun がインストールされていなくても動くツールを配布できます。

```bash
$ bun build ./index.ts --compile --outfile my-cli
[87ms] bundle 113 modules
[145ms] compile my-cli
```

なんと数百ミリ秒でコンパイル完了。生成されたバイナリを実行してみます。

```bash
$ time ./my-cli ping
pong! 🏓

real    0m0.012s
user    0m0.005s
sys     0m0.006s
```

**約12ミリ秒**。もはや C や Rust で書かれたネイティブバイナリに迫る速度です。

## まとめ

Bun + TypeScript + Commander の組み合わせは、現在の CLI 開発において間違いなく最強クラスの DX（開発者体験）を提供してくれます。

- トランスパイル不要で即実行
- 起動がとにかく速い（コンパイルすれば10ms台）
- Bun Shell で外部コマンド実行も簡単
- 単一バイナリ配布がコマンド一発

ちょっとした作業を自動化したいなと思ったとき、シェルスクリプトで書くか迷うレベルの規模でも、TypeScript の型安全な恩恵を受けながら爆速で書けるこの環境は、全エンジニアにおすすめしたいですね。ぜひ試してみてください。
