---
title: "Bun Shell vs Node.js child_process: Agent環境での最適解を探る"
date: "2026-04-26T21:03:00+09:00"
tags: ["Bun", "Node.js", "Agent", "TypeScript"]
---

Agentを構築する際、OSのコマンドを叩く処理は避けて通れません。今回は、Agent環境における「シェル実行」に焦点を当て、Bun Shellと従来のNode.js `child_process` を比較検証してみました。

結論から言うと、Agentの実行基盤としては**Bun Shellの圧勝**です。特にエラーハンドリングとストリーミングの簡潔さが桁違いでした。

## Node.js child_processの辛いところ

従来のNode.jsでシェルコマンドを実行し、その出力をLLMに渡す場合、以下のようなボイラープレートが必要になります。

```typescript
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

async function runCommand(cmd: string) {
  try {
    const { stdout, stderr } = await execAsync(cmd);
    if (stderr) {
      console.warn("Stderr output:", stderr);
    }
    return stdout;
  } catch (error) {
    console.error("Command failed:", error);
    throw error;
  }
}
```

これでもシンプルに書いていますが、実際にはタイムアウト処理や、`spawn` を使ったリアルタイムなストリーミング処理が必要になり、コードはすぐに複雑化します。Agentが自律的にコマンドを組み立てて実行する際、エスケープ処理の漏れによる脆弱性も懸念されます。

## Bun Shellの美しさ

一方、Bun 1.0以降で導入されたBun Shell（`$`）を使うと、この複雑さが一掃されます。

```typescript
import { $ } from "bun";

async function runAgentCommand(dir: string) {
  // 自動でエスケープされ、かつ直感的に書ける
  const result = await $`ls -la ${dir}`.quiet();
  
  if (result.exitCode !== 0) {
    return `Error: ${result.stderr.toString()}`;
  }
  
  return result.stdout.toString();
}
```

テンプレートリテラルを使うことで、変数が安全にエスケープされます。これはLLMが生成した不確定な引数を渡す際に、セキュリティ上の大きなメリットになります。

## 実行結果の比較

実際に100回連続で軽いコマンド（`echo "hello"` や `ls`）を回すベンチマークを取ってみました。

* **Node.js (exec)**: 約 420ms
* **Bun Shell**: 約 180ms

プロセス起動のオーバーヘッドがBunの方が小さく、結果としてレスポンスが早くなります。Agentが何度もシェルを叩いて環境を探索するような「ReAct」ループにおいては、この差が塵積もって大きな遅延の違いとなります。

## 柔軟なリダイレクトとパイプ

さらにBun ShellがAgent向けに優れているのは、パイプ処理が言語仕様レベルで統合されている点です。

```typescript
const text = await $`cat log.txt | grep "ERROR" | wc -l`.text();
```

Node.jsでこれをやろうとすると、複数の `spawn` を繋ぐか、`shell: true` にしてOSのシェルに丸投げすることになりますが、Bunならクロスプラットフォームで動作します。

## まとめ

Agent開発において、「如何にして外部ツール（コマンド）を安全かつ高速に実行・ハンドリングするか」はアーキテクチャの要です。

Bun Shellは、**安全性（自動エスケープ）、パフォーマンス、そして何よりDX（書きやすさ）**の全てにおいて、Node.jsの `child_process` を凌駕しています。これから自律型AI AgentやCLIツールを作るなら、迷わずBunを採用すべきだと確信しました。
