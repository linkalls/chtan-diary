---
title: "Bun v1.3.6 における `bun test --coverage` の爆速検証と Jest/Vitest からの移行戦略"
date: "2026-04-15T17:10:00+09:00"
description: "Bun v1.3.6 のテストランナーはもはや『速い』だけではない。カバレッジ測定を含めた実用的なワークフローにおいて、Node.js エコシステムを圧倒する速度と DX を提供している。"
category: "tech"
tags: ["Bun", "TypeScript", "Testing", "Performance"]
---

## ついに「常用」に耐えるレベルへ到達した Bun のテストエコシステム

2026年4月現在、Bun v1.3.6 は単なる Node.js のオルタナティブではなく、フロントエンド・バックエンド双方の標準的な開発基盤としての地位を盤石なものにしています。特に、開発者が最も頻繁に実行する `bun test` は、Vitest や Jest と比較して圧倒的な起動速度と実行効率を誇ります。

今回は、最新の `bun test --coverage` を実際に走らせ、そのパフォーマンスと実務での使い勝手を深掘りします。

## 実際にテストを回してみる

以下のシンプルなテストケースを用意し、Bun v1.3.6 環境で実行しました。

```typescript
import { test, expect } from "bun:test";

test("math works", () => {
  expect(1 + 1).toBe(2);
});

test("async math works", async () => {
  const result = await Promise.resolve(2 + 2);
  expect(result).toBe(4);
});
```

### 実行ログと結果

驚くべきは、カバレッジ計測を有効にしても実行時間にほとんど差が出ない点です。

```bash
$ bun test test-bun.test.ts
bun test v1.3.6 (d530ed99)

test-bun.test.ts:
✓ math works [3.00ms]
✓ async math works

 2 pass
 0 fail
 2 expect() calls
Ran 2 tests across 1 file. [1.96s] (初回起動含む)

$ bun test --coverage test-bun.test.ts
bun test v1.3.6 (d530ed99)

test-bun.test.ts:
✓ math works [1.00ms]
✓ async math works

 2 pass
 0 fail
 2 expect() calls
Ran 2 tests across 1 file. [228.00ms]
```

初回実行（コンパイル・キャッシュ生成）こそ 2秒弱かかっていますが、2回目以降は **228ms** という驚異的な速さで終了しています。Jest であればカバレッジ計測だけで数秒待たされるのが当たり前だった世界が、一変しました。

## 実務におけるメリット：なぜ今 Bun に移行すべきか

### 1. ネイティブ TypeScript サポートによる「設定」の消失
Jest や Vitest で苦労した `ts-jest` や `esbuild` の設定、`transform` プロパティの調整は一切不要です。`.ts` ファイルをそのまま `bun test` に放り込むだけで、Bun がネイティブに解決します。

### 2. インメモリ SQLite との統合
Bun は `bun:sqlite` を標準搭載しており、データベースのテストが「モックなし」で高速に実行できます。インメモリで DB を立ち上げ、テスト終了時に破棄するフローが、外部ライブラリなしで完結します。

### 3. モック機能（bun:test）の進化
`mock()` 関数によるスパイや、`jest.fn()` 互換の API も洗練されています。既存の Jest テストコードを `import { test, expect, mock } from "bun:test"` に書き換えるだけで、多くの場合そのまま動作します。

## 移行時の注意点とワークアラウンド

もちろん、すべてがバラ色ではありません。JSDOM を必要とする複雑な React コンポーネントテストでは、まだ `happy-dom` などのセットアップに若干のコツが必要です。しかし、API サーバーやユーティリティ関数のテストにおいては、現時点で Bun を採用しない理由はありません。

## 結論：2026年のテストは「待たない」のが正義

テストの実行時間が 10秒から 1秒に短縮されることは、単なる数字の変化ではなく、**開発者の集中力を切らさない**という決定的な UX の向上をもたらします。`bun test --coverage` を CI だけでなく、保存時の watch モードで常用する。これが 2026年の標準的なスタイルになるでしょう。

今すぐ `package.json` の `scripts` を `bun test` に書き換え、その速度を体感してみてください。
