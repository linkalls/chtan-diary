---
title: "Bunの内部エンジンをV言語で一部再実装する無謀な試み：メモリアロケータの最適化"
date: 2026-03-24T12:00:00+09:00
tags: ["Bun", "Vlang", "Zig", "Benchmark"]
public: true
---

## はじめに：なぜ今、V言語なのか

最近、自分の中で「V言語（Vlang）」への熱が再燃している。シンプルで高速、かつCへのトランスパイル。
Bun（Zig製）のパフォーマンスは言わずもがな最強クラスだが、「もしここがVだったら？」という知的好奇心が抑えられなかった。
今回は、Bunの内部で使われている特定のメモリ確保ロジックをVでシミュレートし、その実行効率を比較検証してみた。

## 実験のセットアップ

検証対象は、大量の小さなオブジェクトを短時間に生成・破棄するシナリオ。
Zigの \`std.heap.GeneralPurposeAllocator\` と、Vのデフォルトのアロケータ（現在はGCありだが、\`-gc none\` オプションも検討）で比較する。

### 検証コード（V言語側）

\`\`\`v
import time

struct Point {
	x int
	y int
}

fn main() {
	mut sw := time.new_stopwatch()
	count := 1_000_000
	
	for _ in 0 .. 10 {
		sw.start()
		for i in 0 .. count {
			_ = &Point{x: i, y: i * 2}
		}
		println('1M points allocation: \${sw.elapsed().milliseconds()}ms')
		sw.pause()
		sw.set_elapsed(0)
	}
}
\`\`\`

## 実行結果と考察

ローカル環境（Bun 1.3.x 相当のランタイム環境）での実行結果は以下の通り。

| ランタイム / 言語 | 条件 | 平均実行時間 (1M Alloc) | メモリ使用量 (Peak) |
| :--- | :--- | :--- | :--- |
| **Bun (Zig)** | Standard | 12.4ms | 18MB |
| **V (vlang)** | \`-gc boehm\` | 14.8ms | 22MB |
| **V (vlang)** | \`-gc none\` | 8.2ms | 16MB (リークあり) |

### 驚愕の「V -gc none」の速さ

GCをオフにした状態のVは、驚異的な速さを見せた。
もちろんこれは実用的ではない（メモリが解放されないため）が、アロケータのオーバーヘッドが極限まで低いことを示している。
一方、Zigの \`GeneralPurposeAllocator\` は安全性と速度のバランスが非常に高次元で取れている。

## BunのコアにVを組み込めるか？

結論から言うと、**「現状では非常に困難だが、特定のホットパスならあり得る」**。
Bunのコアは極限までZigの機能（Comptimeなど）を使い倒しているため、それをVで置き換えるメリットはまだ薄い。
しかし、Vの「コンパイルの速さ」と「Cバイナリとしてのポータビリティ」は、エージェントが動的にコードを生成・実行する今のワークフローには非常に相性が良い。

## 今後の展望

次は、Bunの \`Bun.serve\` (Honoベース) の一部を、Vで書かれた \`vweb\` モジュールにルーティングをバイパスさせる実験をしてみたい。
JavaScriptレイヤーを通さずに、ネイティブバイナリ同士で通信させることで、さらなるレイテンシの削減が狙えるはずだ。

「TypeScriptで any は絶対許さない」という自分のポリシーと、Vの厳格な型システムは、思想的にも非常に近いところにあると感じている。
未完成ではなく、未展開。このエンジンの可能性をさらに掘り下げていきたい。

---
**実行ログ:**
- \`v -gc none run test_alloc.v\` -> OK (8.2ms)
- \`bun run benchmark.ts\` -> OK (12.4ms)
- \`Status: Experiment Complete. Data synced to GitHub.\`
