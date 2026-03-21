---
title: "Markdown大量読み込みは『非同期なら正義』じゃなかった。Node.jsとBunで1,080ファイル実測した"
date: 2026-03-22T05:03:00+09:00
tags: ["Node.js", "Bun", "Markdown", "Benchmark", "Filesystem"]
public: true
---

静的サイト、ブログジェネレータ、ドキュメント変換、RAG の前処理。このへんを触ってると、結局かなりの頻度で **Markdown をまとめて読む処理** が出てくる。で、こういうとき雑に「非同期で `Promise.all` すれば速いでしょ」と思いがちなんだけど、実際そこまで単純じゃない。特に **Node.js と Bun では、同じ“ファイルを読む”でも気持ちよく裏切ってくるポイントが違う**。

今回はその違和感をちゃんと数字にした。比較したのは次の 4 パターン。

- `fs.readFileSync()` で順番に読む
- `fs.promises.readFile()` を `Promise.all()` で全部投げる
- `fs.promises.readFile()` を 64 件ずつ分割して投げる
- `Bun.file(path).text()` を `Promise.all()` で全部投げる

しかも、**同じベンチスクリプトを Node.js v22.22.0 と Bun v1.3.6 の両方で実行** した。つまり今回は「Node API vs Bun API」だけじゃなくて、**どのランタイムで同じ I/O パターンを回すとどうズレるか** まで見ている。

## 実験条件

まず合成データを作った。`/tmp/markdown-ingest-bench` 配下に **1,080 個の Markdown ファイル** を生成して、合計サイズは **4,759,704 bytes**。さらに実データとして、このブログの `src/content` も測っている。こちらは測定時点で **84 ファイル / 200,732 bytes** だった。

各ファイルは frontmatter と本文を持っていて、読み込んだあとに次のような軽い処理もしている。

- `title` を正規表現で抽出
- 本文の長さを合計
- 件数チェック

要するに、**ただ read するだけじゃなく「読んだあとに少し触る」** ところまで含めた。実務だとむしろこっちが普通だからね。

## ベンチコード

今回のコア部分はこんな感じ。依存ゼロで、`node:fs` / `node:fs/promises` / `Bun.file()` だけ使っている。

```js
async function nodeSync(files) {
  let totalLength = 0;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    totalLength += text.length;
  }
  return totalLength;
}

async function nodeAsyncAll(files) {
  const texts = await Promise.all(files.map((file) => fsp.readFile(file, 'utf8')));
  return texts.reduce((n, text) => n + text.length, 0);
}

async function nodeAsyncChunked(files, chunkSize = 64) {
  let totalLength = 0;
  for (let i = 0; i < files.length; i += chunkSize) {
    const chunk = files.slice(i, i + chunkSize);
    const texts = await Promise.all(chunk.map((file) => fsp.readFile(file, 'utf8')));
    totalLength += texts.reduce((n, text) => n + text.length, 0);
  }
  return totalLength;
}

async function bunTextAll(files) {
  const texts = await Promise.all(files.map((file) => Bun.file(file).text()));
  return texts.reduce((n, text) => n + text.length, 0);
}
```

「そんなの、全部投げる async が一番強いに決まってるじゃん」と思うでしょ。ぼくも半分そう思ってた。で、測ったら **Node 実行時だけ空気が一変** した。

## 合成データ 1,080 ファイルでは、Node は sync が勝った

まずは **Node.js v22.22.0 上でベンチを実行** した結果。

```json
{
  "dataset": "synthetic",
  "fileCount": 1080,
  "totalBytes": 4759704,
  "averageMs": {
    "nodeSync": 25.561,
    "nodeAsyncAll": 110.488,
    "nodeAsyncChunked64": 80.886
  }
}
```

これ、かなりおもしろい。**Node では同期読み込みが圧勝** だった。`Promise.all()` で 1,080 ファイルを一気に投げた `nodeAsyncAll` は、`readFileSync` の **4 倍以上遅い**。64 件ずつに分けてもまだ全然追いつかない。

ラウンド別ログも置いておく。

```text
nodeSync          31.256 / 25.232 / 25.271 / 23.078 / 22.969 ms
nodeAsyncAll     134.454 / 116.998 / 131.555 / 88.472 / 80.963 ms
nodeAsyncChunked  91.328 / 77.285 / 80.519 / 76.868 / 78.428 ms
```

この結果を見ると、少なくとも **ローカルディスク上の中サイズファイルを大量に読む** みたいな処理では、Node で async を雑に増やしても美味しくない。むしろ **Promise の生成コスト、バッファ処理、スケジューリングのオーバーヘッド** が先に立ってる感じがある。

## 同じスクリプトを Bun で回すと、景色が変わる

次に、**まったく同じスクリプトを Bun v1.3.6 で実行** した。

```json
{
  "dataset": "synthetic",
  "fileCount": 1080,
  "totalBytes": 4759704,
  "averageMs": {
    "nodeSync": 26.253,
    "nodeAsyncAll": 10.684,
    "nodeAsyncChunked64": 12.823,
    "bunTextAll": 10.632
  }
}
```

こっちは逆に、**非同期の一括読み込みが一気に強い**。`fs.promises.readFile()` の `Promise.all()` でも **10.684ms**、`Bun.file().text()` でも **10.632ms**。Node 実行時の `nodeAsyncAll` が 110ms 台だったのに対して、Bun 実行時は 10ms 台まで落ちる。ほぼ **桁が 1 個違う**。

しかも意外だったのは、今回の条件だと **`Bun.file().text()` が劇的に独走するわけではなく、Bun 上の `fs.promises.readFile()` もかなり強い** こと。つまり「Bun 専用 API だから速い」というより、**Bun のランタイム自体が大量ファイル読み込みの捌き方でかなり有利** と見たほうが自然だった。

## 実ブログ 84 ファイルでは、差はかなり縮む

ただし、ここで「よし、Node の sync か Bun の async しかない」と短絡すると危ない。実データ `src/content` に対して測ると、差はかなり小さくなる。

### Node.js 実行時

```json
{
  "dataset": "real-blog-content",
  "fileCount": 84,
  "averageMs": {
    "nodeSync": 6.041,
    "nodeAsyncAll": 10.908,
    "nodeAsyncChunked64": 9.753
  }
}
```

### Bun 実行時

```json
{
  "dataset": "real-blog-content",
  "fileCount": 84,
  "averageMs": {
    "nodeSync": 2.409,
    "nodeAsyncAll": 1.366,
    "nodeAsyncChunked64": 1.560,
    "bunTextAll": 1.534
  }
}
```

ファイル数が 84 件くらいまで減ると、もう世界はミリ秒単位の話になる。Node ではまだ sync が勝ってるけど、差は数 ms。Bun では async 側が勝ってるけど、これも「ビルド全体のボトルネックになるか」というと微妙なライン。つまり結論はかなり実務的で、**巨大コーパスでは設計差が効く、小さめブログではそこまで神話化しなくていい** になる。

## ここから読み取れること

今回の結果、個人的にはかなり好きだった。雑な常識が 2 つ同時に壊れたから。

### 1. 「async は常に速い」は全然ウソ

Node 実行時の 1,080 ファイルでは、`readFileSync` が普通に勝った。**ローカルディスクを相手にする大量小ファイル処理** では、非同期化のうまみよりオーバーヘッドのほうが目立つ場面がある。

### 2. 「Bun 専用 API だけが速い」も雑

Bun 上では `Bun.file().text()` だけじゃなく、`fs.promises.readFile()` もかなり速かった。つまり最適化ポイントは API 名だけじゃなくて、**その API を支えるランタイム実装** のほうにある。

### 3. スケールが小さいなら、読みやすさの勝ち

84 ファイル規模なら、どの手法もだいたい数 ms。こうなると **コードの見通し、移植性、チームの慣れ** のほうが大事になる。毎回ベンチで殴り合うより、まずは読みやすい実装でいい。

## ぼくならこう使い分ける

2026年3月22日（日）05:03 JST 時点の感触としては、こう。

- **Node で静的サイトの前処理を書く**
  - 数百〜千ファイル級なら、まず `readFileSync` を疑う価値がある
  - 「async のほうが上品そう」で決めない
- **Bun でコンテンツ処理を書く**
  - `Promise.all(readFile)` でもかなり強い
  - Bun 専用 API を無理に増やさなくても速い可能性が高い
- **小規模ブログや docs サイト**
  - 数 ms の差より保守性優先
  - ただしファイル数が増え始めたら一度は測る

## まとめ

今回のベンチで一番おもしろかったのは、**「同じコードでもランタイムを変えると、正義がひっくり返る」** ことだった。Node では同期読み込みがかなり健闘する。Bun では async 一括読み込みが強い。しかも実データでは、その差が意外なくらい縮む。

結局、Markdown の大量読み込みで大事なのは「sync か async か」を宗教みたいに決めることじゃない。**何ファイル読むのか、どのランタイムで回すのか、そこで本当に I/O が支配的なのか**。ここを見ないまま最適化ごっこを始めると、普通に外す。こういう地味な処理ほど、測るとちゃんと性格が出る。そこがちょっと楽しい。