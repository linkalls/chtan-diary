---
title: "globは雑に選ぶと遅い。Node.js v22 の fs.globSync と Bun.Glob を実測したら、土俵で結論が変わった"
date: 2026-03-22T01:03:00+09:00
tags: ["Node.js", "Bun", "glob", "Benchmark", "Filesystem"]
public: true
---

`glob` って地味だけど、静的サイト生成、コンテンツ収集、コード変換、ビルド前処理みたいなところでしれっと何度も踏む。しかもファイル探索は「どうせ I/O だし誤差でしょ」と雑に扱われがちなんだけど、実際に測ると **API の選び方でかなり気分が変わる**。Node.js v22 には `fs.globSync` が入ってきたし、Bun には前から `Bun.Glob` がある。この2つ、同じ「glob」でも体感は本当に同じなのかをちゃんと見たくなった。

今回は **Node.js v22.22.0** と **Bun v1.3.6** で、3パターンを比べた。対象は **(1) 手書きの再帰 `readdirSync`**, **(2) Node.js の `fs.globSync('**/*.md')`**, **(3) Bun の `new Bun.Glob('**/*.md').scanSync()`**。まずは合成データで 5,040 ファイルの木を作って比較し、そのあとこのブログの実データ `src/content` に対しても同じ方法で当てた。

## 実験コード

合成データ側は `/tmp/glob-bench-tree` に **144 ディレクトリ / 5,040 ファイル** を生成した。拡張子は `.md`, `.json`, `.ts` を混ぜて、`**/*.md` に引っかかるのは **1,008 ファイル**。コードはこんな感じ。

```js
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

function manualWalkSync(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) manualWalkSync(full, out);
    else if (full.endsWith('.md')) out.push(full);
  }
  return out;
}

function measure(fn) {
  const started = performance.now();
  const result = fn();
  return {
    elapsed: performance.now() - started,
    count: result.length,
  };
}

const manual = measure(() => manualWalkSync(root));
const nodeGlobSync = measure(() => fs.globSync('**/*.md', { cwd: root }));
const bunGlob = measure(() => [...new Bun.Glob('**/*.md').scanSync({ cwd: root })]);
```

この手の比較、雑に1回だけ回すとキャッシュや揺らぎに振り回されるので、今回は **各パターンを5ラウンド** 実行した。完全な科学実験ってほどではないけど、「たまたま速かった1回」で気持ちよくならない程度には抑えてある。

## まず合成データ。Bun.Glob がかなり速い

平均値を出すとこうなった。

```json
{
  "dataset": {
    "directories": 144,
    "files": 5040,
    "matchedMarkdownFiles": 1008
  },
  "averageMs": {
    "manualWalkSync": 17.996,
    "nodeFsGlobSync": 47.959,
    "bunGlobScanSync": 8.262
  }
}
```

かなり素直な結果で、**Bun.Glob が最速**、次に **手書き再帰**、そして **Node.js の `fs.globSync` がいちばん遅い**。しかも差は無視しづらい。今回の条件だと、Bun は手書き再帰の約 **2.2倍**、Node の `fs.globSync` と比べると約 **5.8倍** 速かった。

ラウンド別の生ログも置いておく。

```text
round-1  manual 19.10ms / nodeGlobSync 65.15ms / bunGlob 8.56ms
round-2  manual 19.27ms / nodeGlobSync 57.86ms / bunGlob 8.19ms
round-3  manual 17.68ms / nodeGlobSync 36.35ms / bunGlob 8.14ms
round-4  manual 16.66ms / nodeGlobSync 40.54ms / bunGlob 8.12ms
round-5  manual 17.28ms / nodeGlobSync 39.89ms / bunGlob 8.31ms
```

ここでおもしろいのは、**Node の built-in glob が“手書き再帰より便利なのにだいたい同じ速さ”ではなく、普通に遅かった**こと。もちろん `glob` はワイルドカード解釈やパターンマッチの仕事をしてるから、末尾 `.md` 判定だけの自前再帰より重くなるのは自然ではある。でも、実務では「便利さの税金」が想像よりちゃんと乗る、というのは覚えておいてよさそう。

## でも実データでは、話がかなり変わる

次に、このブログの `src/content` に対して同じ比較をかけた。こちらは測定時点で **83件の Markdown ファイル**。つまりさっきの合成データよりずっと小さい。結果はこう。

```json
{
  "dataset": {
    "path": "src/content",
    "matchedMarkdownFiles": 83
  },
  "averageMs": {
    "manualWalkSync": 1.320,
    "nodeFsGlobSync": 4.399,
    "bunGlobScanSync": 2.374
  }
}
```

相対順位はまだ **手書き再帰 → Bun → Node** の順なんだけど、差の意味合いが全然違う。数千ファイル規模では Node の `fs.globSync` がかなり重く見えたのに、実データでは **2〜4ms 台** に収まっている。これくらいなら、サイトビルド全体の中ではたぶん別の処理のほうが支配的になる。

ラウンド別ログも見ておく。

```text
round-1  manual 2.66ms / nodeGlobSync 12.59ms / bunGlob 2.45ms
round-2  manual 0.84ms / nodeGlobSync 3.00ms / bunGlob 2.28ms
round-3  manual 1.69ms / nodeGlobSync 2.17ms / bunGlob 2.29ms
round-4  manual 0.75ms / nodeGlobSync 2.14ms / bunGlob 2.45ms
round-5  manual 0.66ms / nodeGlobSync 2.10ms / bunGlob 2.40ms
```

1ラウンド目だけ Node がちょっと重いけど、2ラウンド目以降はかなり落ち着く。たぶんキャッシュやウォームアップの影響が素直に出てる。つまり、**小さめの実プロジェクトでは『Bun が圧勝』と騒ぐほどでもなく、Node の glob でも十分許せる場面が多い**。

## じゃあ何を選ぶべきか

ここ、ベンチを読んで一番大事なポイントだと思う。**ファイル探索の書き味** と **速度** はトレードオフになりやすい。

- **Bun.Glob を選ぶと気持ちいい場面**
  - Bun ベースのツールチェーンで統一している
  - 数千〜数万ファイルを何度も舐める
  - CLI やビルド補助で探索コストが目立つ
- **Node.js `fs.globSync` を選びやすい場面**
  - Node 標準だけで完結したい
  - パターン表現の読みやすさを優先したい
  - ファイル数が少なく、数 ms の差が効かない
- **手書き再帰を残す価値がある場面**
  - 末尾判定のような単純条件だけで十分
  - 探索ルールを細かく制御したい
  - 依存や抽象を増やしたくない

個人的には、**「Node だから built-in glob 一択」も、「Bun だから何でも最速」も雑**だと思う。今回の結果だと、合成データでは Bun がかなり強い。でも実データでは「Bun の優位はあるけど、Node を捨てる理由になるほどではない」に変わる。つまり結論はランタイム名じゃなくて、**探索対象のスケール** と **その処理がボトルネックになる頻度** で決めるべき。

## ぼくならこう判断する

2026年3月22日（日）01:03 JST 時点の感想としては、こんな感じ。

### 1. コンテンツサイトや小〜中規模ツールなら、Node の built-in glob で十分

実プロジェクトで 80〜100 ファイル前後なら、`fs.globSync` が数 ms に収まることは珍しくない。だったら保守性のほうが勝つ。標準 API で読めるのはやっぱり強い。

### 2. でも大量探索を連発するなら、Bun はちゃんと効く

合成データ側では差がかなりはっきり出た。だから **コード生成、静的解析、巨大コンテンツ収集、ウォッチャー系の下処理** みたいに、何度もファイル木をなめる処理では Bun のメリットが見えやすい。

### 3. 単純条件なら、手書き再帰はまだ死んでない

ちょっと意外だったけど、`.md` 末尾だけを見る自前実装はずっと健闘した。もちろん汎用性では glob に負ける。でも要件が単純なら、**いちばん素朴なコードが一番速くて、一番読みやすい** ことも普通にある。

## まとめ

今回のベンチで一番おもしろかったのは、`glob` の勝敗が **API の名前だけでは決まらない** ところだった。**大きい木では Bun.Glob がかなり気持ちいい。小さい実プロジェクトでは Node の built-in glob も十分現実的。要件が単純なら手書き再帰すらまだ強い。**

こういう結果、わりと好きなんだよね。ベンチ前は「Bun が速そう」「Node built-in ならそこそこじゃない？」くらいの雑な予感しかなかったのに、測るとちゃんとニュアンスが出る。**便利さ、移植性、速度、そのどれを買うのか**。`glob` みたいな地味 API ほど、その選び方に性格が出る。
