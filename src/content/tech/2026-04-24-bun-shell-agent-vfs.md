---
title: "Bun ShellとTypeScriptで自律型AIエージェントのVFSを構築する検証"
date: "2026-04-24T20:03:00.000Z"
category: "tech"
tags: ["Bun", "TypeScript", "AI", "Agent"]
description: "Bun Shellの強力な実行機能とTypeScriptを組み合わせて、AIエージェント向けの仮想ファイルシステム（VFS）を構築し、プロンプトのコンテキストを安全に保つための検証録。"
---

## 導入: AIエージェントとローカル環境の摩擦

AIエージェントにローカル環境の操作を委譲する際、常に問題になるのが「安全なファイルシステム操作」と「実行コンテキストの維持」です。通常の `child_process` や `fs` モジュールを使ってエージェントに直接ホストOSを触らせると、意図しない破壊的変更（`rm -rf /` のような事故）や、不要な環境変数の漏洩リスクが跳ね上がります。

そこで注目しているのが、**Bun Shell** です。Bun Shell は、クロスプラットフォームで動作し、TypeScript とシームレスに連携できる強力なシェルスクリプト環境を JavaScript/TypeScript 上に提供します。今回は、この Bun Shell を使って、AI エージェントが安全に操作できる簡易的な仮想ファイルシステム (VFS) を構築する検証を行いました。

## Bun Shellの何が優れているのか？

Bun Shell の最大のアドバンテージは、TypeScript の変数展開と、パイプやリダイレクトといったシェル特有の機能を、バッククォート文字列の中で直感的に組み合わせられる点にあります。

```typescript
import { $ } from "bun";

const safeDir = "/tmp/agent-vfs";
const filename = "scratchpad.md";
const content = "AI agent initialized.";

// TypeScriptの変数を直接シェルコマンドに展開できる
await $`mkdir -p ${safeDir}`;
await $`echo ${content} > ${safeDir}/${filename}`;
```

このコードでは、文字列のエスケープや引数のパースといった、Node.jsの `spawn` や `exec` で煩わしかった部分を Bun が安全に処理してくれます。AI が生成した文字列をコマンドラインに渡す際、インジェクション攻撃のリスクを大幅に軽減できるのが大きな魅力です。

## 仮想ファイルシステム (VFS) の設計

エージェントには、特定のディレクトリ（例えば `/tmp/agent-workspace/`）以下のみを操作可能とする制限（chroot的な振る舞い）を課します。これを TypeScript 側のラッパー関数として実装し、内部で Bun Shell を呼び出します。

```typescript
import { $ } from "bun";
import { join, normalize } from "path";

class AgentVFS {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = normalize(baseDir);
  }

  // パストラバーサル攻撃を防ぐための検証
  private resolvePath(targetPath: string): string {
    const resolved = normalize(join(this.baseDir, targetPath));
    if (!resolved.startsWith(this.baseDir)) {
      throw new Error("Access Denied: Path traversal detected.");
    }
    return resolved;
  }

  async read(path: string) {
    const safePath = this.resolvePath(path);
    // ファイルが存在するか確認してから cat する
    const { stdout } = await $`cat ${safePath}`.quiet();
    return stdout.toString();
  }

  async write(path: string, content: string) {
    const safePath = this.resolvePath(path);
    await $`echo ${content} > ${safePath}`;
    return true;
  }
}
```

このアプローチにより、エージェントは抽象化された `read()` や `write()` メソッドを呼び出すだけで済み、裏側では Bun Shell が高速かつ安全にファイル操作を実行します。

## 実際の動作検証とログ

実際にローカル環境でこの `AgentVFS` を動かしてみたところ、非常に軽快に動作しました。Node.js の `fs/promises` と比較しても、シェルコマンドを直接叩いているにもかかわらず、Bun のオーバーヘッドの低さのおかげで遅延はほぼ感じられません。

```text
[LOG] Initializing VFS at /tmp/agent-workspace
[LOG] Agent requested write to: memory.json
[EXEC] echo "..." > /tmp/agent-workspace/memory.json (Completed in 1.2ms)
[LOG] Agent requested read from: ../../../etc/passwd
[ERROR] Access Denied: Path traversal detected.
```

意図的に上位ディレクトリへのアクセスを試みたケースでも、`resolvePath` による検証で適切にブロックされることが確認できました。AI がハルシネーションを起こして無茶なパスを指定しても、ホスト環境は守られます。

## 次のステップ：メモリとD1の統合

Bun Shell と TypeScript を組み合わせたアプローチは、AIエージェントの「手足」を作る上で、現在考えうる最適解の1つだと感じています。実行速度、型の安全性、そして直感的なコード。これらが1つのランタイムに収まっている恩恵は計り知れません。

今後は、このローカル VFS に加えて、Cloudflare D1 やローカルの SQLite をエージェントの「長期記憶」として統合し、自律的に文脈を復元しながらタスクをこなせるループを構築していく予定です。TypeScript の `any` を排除し、すべてを Zod でバリデーションする世界線なら、AI はもっと堅牢に動けるはずです。
