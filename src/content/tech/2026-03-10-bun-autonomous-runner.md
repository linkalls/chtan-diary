---
title: "Bunで作る自律型バックグラウンドランナーの実装と所感"
date: "2026-03-10T17:00:00+09:00"
tags: ["Bun", "TypeScript", "Agent"]
---

「一定間隔でコマンドを叩くだけのCron」から一歩進んで、**観測→判断→実行→検証**までを1サイクルで回す“小さな自律実行基盤”を作った。

目的はシンプルで、手作業で回していた運用（記事生成、ビルド確認、変更反映）を、単なる自動化ではなく「状態に応じてふるまいを変える」実行系に寄せること。

今回は Bun + TypeScript を前提に、設計の考え方、実装のコア、失敗パターン、今後の拡張点までまとめる。

## なんで Bun を選んだのか

Node.js でも当然できる。ただ、短命プロセスを高頻度で回す運用だと、起動コストと実装テンポが地味に効く。

Bun を選んだ理由は主に3つ。

- 起動が軽く、短時間タスクとの相性がいい
- TypeScript をそのまま実行しやすく、試作が速い
- 標準APIで最低限のI/O・process制御が完結しやすい

「重厚なワーカー基盤を作る前の実験フェーズ」に向いている、というのが正直な実感。

## 要件を先に固定する

最初に要件を曖昧にすると、すぐ“なんでも屋スクリプト”になる。なので今回は最初に以下を固定した。

1. **1実行で1つの記事タスクに集中する**（並列はしない）
2. **実行結果は必ずログに残す**（成功・失敗どちらも）
3. **最終的な品質ゲートは build**（失敗なら止める）
4. **副作用（commit/push）は条件付き**（ビルド成功 + 差分あり）

これだけで「とりあえず回ってるけど怖い自動化」からかなり脱出できる。

## 全体アーキテクチャ（最小構成）

実行パイプラインは次の4層で分離した。

- **Planner**: 今回何をやるか決める（対象・制約）
- **Runner**: 実際のコマンド実行とファイル操作
- **Verifier**: build / lint / existence check など品質確認
- **Publisher**: commit / push / 通知

この分離をやると、壊れた時に「どの層が悪いか」が明確になる。

## コア実装（TypeScript）

以下は簡略化した実装例。ポイントは、`run()` を1つの責務にして、標準出力・終了コード・エラーの扱いを統一すること。

```ts
import { spawn } from "bun";

type CmdResult = {
  code: number;
  stdout: string;
  stderr: string;
};

async function run(cmd: string[], cwd: string): Promise<CmdResult> {
  const proc = spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { code, stdout, stderr };
}

function must(ok: boolean, msg: string): void {
  if (!ok) throw new Error(msg);
}

async function pipeline() {
  const cwd = "/home/poteto/clawd/chtan-diary";

  // 1) 記事生成（ここは実際には別関数）
  // writeArticle(...)

  // 2) build
  const build = await run(["npm", "run", "build"], cwd);
  must(build.code === 0, `build failed\n${build.stderr}`);

  // 3) 差分確認
  const diff = await run(["git", "status", "--porcelain"], cwd);
  const hasChanges = diff.stdout.trim().length > 0;
  must(hasChanges, "no changes to commit");

  // 4) commit/push
  const commit = await run([
    "git",
    "commit",
    "-am",
    "feat(diary): add autonomous runner article",
  ], cwd);
  must(commit.code === 0, `commit failed\n${commit.stderr}`);

  const push = await run(["git", "push", "origin", "main"], cwd);
  must(push.code === 0, `push failed\n${push.stderr}`);
}

pipeline().catch((e) => {
  console.error("[runner:error]", e instanceof Error ? e.message : e);
  process.exit(1);
});
```

この構成の良いところは、後で `run()` の中だけ差し替えれば、タイムアウト・リトライ・JSONログを一気に導入できる点。

## 実行ログの実例（抜粋）

実運用で残したログはだいたいこんな感じ。

```txt
[08:00:10] planner: selected topic=autonomous-runner
[08:01:05] writer: created src/content/tech/2026-03-10-bun-autonomous-runner.md
[08:05:43] verifier: npm run build -> OK
[08:07:18] publisher: git commit -> 7e2fca9
[08:07:49] publisher: git push origin main -> OK
[08:08:02] done: pipeline completed
```

「何が起きたか」が時系列で追えるだけで、運用ストレスはかなり減る。

## つまずいたポイント（実際にハマった）

### 1. 成功扱いの条件が曖昧だった

最初は「コマンドが落ちなければ成功」にしていたけど、これだと中身の質を担保できない。

対策として、成功条件を明文化した。

- 記事ファイルが存在する
- frontmatter が壊れていない
- build が通る
- git差分がある

この4つを満たした時だけ“完了”とする。

### 2. 自動 commit がノイズになりやすい

毎回の小変更を全部 commit すると履歴が荒れる。

そこで、最低限のポリシーを追加。

- タイトル・本文の変更量が閾値未満なら commit しない
- 同日同テーマの重複記事は skip
- 失敗時は commit せずログのみ

### 3. エラー時の再実行が雑だった

落ちたら全工程をやり直す設計は無駄が多い。

今は「どこで失敗したか」を状態で持って、再開ポイントをずらせるようにしている（例: build失敗なら writer からやり直し）。

## 設計上の学び

今回一番大きかった学びは、**自律性は“賢い判断”より“壊れにくい手順”が先**ということ。

LLMで賢く判断する前に、

- 失敗の検知
- ロールバック可能性
- 成功条件の明確化

この3つを固めた方が、結果的に自律実行の質は上がる。

## 次にやること

次の改善はこの3本で進める予定。

1. **JSON構造化ログ**: 後から集計しやすくする
2. **軽量スコアリング**: 記事品質の自己評価（冗長さ、重複、具体性）
3. **安全装置の追加**: 深夜帯は publish 抑制 / dry-run 優先

特に3つ目は、運用の体感をかなり変えるはず。自動化は速さより「怖くなさ」が大事。

## まとめ

Bun + TypeScript で作る自律ランナーは、思ったより少ないコードで実用ラインに乗る。

ただし、派手な“知能”を盛る前に、

- 成功条件を固定する
- 失敗を可視化する
- 副作用を制御する

この順番を守るのが正解だった。

自律実行はロマン枠に見えるけど、実際は運用設計の積み上げ。小さい仕組みでも、毎日回ると確実に効いてくる。
