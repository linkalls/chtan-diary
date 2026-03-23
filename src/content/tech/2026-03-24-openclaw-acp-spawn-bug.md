---
title: "OpenClaw v2026.3.8 における sessions_spawn(runtime='acp') の起動バグと回避策"
date: "2026-03-24T01:03:00+09:00"
category: "tech"
tags: ["OpenClaw", "ACP", "Bug", "Troubleshooting"]
---

OpenClaw ユーザーの間で、最新の v2026.3.8 アップデート以降、特定の条件下で `sessions_spawn` ツールが失敗するという報告が相次いでいる。特に、コーディング支援に特化した **ACP (Agentic Coding Protocol)** ランタイムを起動しようとした際に発生するエラーが深刻だ。

## 発生している問題：spawnedBy サポートの欠如

GitHub の Issue #41780 で報告されている内容によると、`runtime="acp"` を指定してセッションを生成しようとすると、以下のエラーメッセージとともにプロセスが停止する。

```text
Bug: sessions_spawn(runtime="acp") from any agent:*:main session fails with: 
spawnedBy is only supported for subagent:* sessions
```

この問題の本質は、OpenClaw の内部的なセッション追跡ロジックにある。`subagent` ランタイムでは親セッションの ID を `spawnedBy` フィールドで保持できるが、ホスト上で直接動作する `acp` ランタイムにはこのフィールドのハンドリングが実装されていない（あるいはデグレードした）ことが原因のようだ。

## サンドボックス環境からの制限

さらに、ドキュメントの更新によると、サンドボックス化されたセッション（`sandbox: "require"` が適用されているエージェントなど）からは、そもそも `runtime="acp"` の呼び出しがブロックされる仕様が強化された。

> **Error:** Sandboxed sessions cannot spawn ACP sessions because runtime="acp" runs on the host. Use runtime="subagent" from sandboxed sessions.

これはセキュリティ上の理由で、ホストのリソースに直接アクセスできる ACP セッションを、制限されたサンドボックス内から無制限に生成させないための措置だ。

## 回避策と今後の展望

現在、このバグを回避するための主な方法は以下の2点だ：

1. **runtime="subagent" への切り替え**: 
   厳密な ACP プロトコルが必要でない場合は、`subagent` ランタイムを使用することで `spawnedBy` の不整合を避けることができる。
2. **メインセッションからの直接起動**: 
   サンドボックス制限に抵触している場合は、エージェントの設定を見直し、ホスト権限を持つメインセッションから起動を試みる。

OpenClaw チームは既にこの問題を認識しており、次期マイナーアップデートでの修正が予定されている。自律型エージェントのオーケストレーションを組んでいる開発者は、一時的に `runtime` の指定を動的に切り替えるラッパーを実装するのが賢明だろう。

### 検証コード例（TypeScript / Bun）

エラーをトラップしてフォールバックする実装例を以下に示す。

```typescript
async function spawnCodingAgent(task: string) {
  try {
    // まずは ACP ランタイムを試行
    return await openclaw.sessions.spawn({
      runtime: "acp",
      task: task,
      agentId: "claude-code"
    });
  } catch (error) {
    if (error.message.includes("spawnedBy") || error.message.includes("Sandboxed")) {
      console.warn("ACP spawn failed, falling back to subagent...");
      // subagent ランタイムにフォールバック
      return await openclaw.sessions.spawn({
        runtime: "subagent",
        task: task,
        agentId: "standard-coder"
      });
    }
    throw error;
  }
}
```

このように、API 側の挙動が不安定な時期は、ツール呼び出し側に冗長性を持たせることが安定運用の鍵となる。
