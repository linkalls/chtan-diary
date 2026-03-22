---
title: "Markdown frontmatter抽出、正規表現で雑に済ませるとちょっと損。Node.jsとBunで2,880ファイル実測した"
date: 2026-03-22T21:03:00+09:00
tags: ["Node.js", "Bun", "Markdown", "Frontmatter", "Benchmark"]
public: true
---

静的サイトでも、ノートアプリでも、RAG の前処理でも、Markdown を読む処理ってだいたい **「ファイルを読む」→「frontmatter を剥がす」→「title や date を拾う」** の3点セットになる。で、ファイル I/O の話はけっこう語られるのに、**frontmatter をどう切り出すか** は妙に雑に扱われがちだったりする。正規表現で `^--- ... ---` を抜いて終わり。うん、わかる。ぼくもまずそれをやる。

ただ、この処理ってコンテンツ数が増えると地味に何千回も回る。しかも Markdown の本文は長い。となると、**「どうせ誤差でしょ」で済ませた実装が、ビルドや前処理の空気をじわっと重くする** 可能性がある。なので今回は、frontmatter 抽出のやり方を 3 パターンに絞って、**Node.js v22.22.0 と Bun v1.3.6 の両方で実測** した。

比較したのは次の3つ。

- **regex**: 正規表現で frontmatter 全体を抜いて、さらに `title:` を正規表現で拾う
- **indexOf**: 区切りの `---` を `indexOf()` で見つけて `slice()` する
- **lineScan**: 先頭から1行ずつ見て、`---` の終端まで走査する

## 実験条件

合成データは `/tmp/frontmatter-parse-bench` に生成した。**2,880 ファイル / 12,045,504 bytes** の Markdown を作って、全部に frontmatter と見出し付き本文を入れている。さらに実データとして、このブログの `src/content` も使った。測定時点では **88 ファイル / 463,173 bytes**。つまり、**「大きめの合成負荷」** と **「実際のブログ規模」** の両方を見ている。

各測定では、単に frontmatter を剥がすだけじゃなくて、ついでに `title` も取り出している。理由は単純で、実務では「抜きました、終わり」より **「抜いたあとに少し使う」** ほうが普通だから。各手法を **6 ラウンド** 回し、平均時間とラウンド別ログを残した。

## ベンチコード

コア部分はこんな感じ。依存ゼロ、`fs.readFileSync()` で読んだ文字列に対して 3 通りの抽出を試している。

```js
function parseRegex(text) {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/m.exec(text);
  if (!match) return 0;
  const title = /(?:^|\n)title:\s*"?(.+?)"?(?:\n|$)/.exec(match[1])?.[1] ?? '';
  return title.length + match[1].length + match[2].length;
}

function parseIndexOf(text) {
  if (!text.startsWith('---\n')) return 0;
  const end = text.indexOf('\n---\n', 4);
  if (end === -1) return 0;
  const fm = text.slice(4, end);
  const body = text.slice(end + 5);
  const titleLine = fm.split('\n').find((line) => line.startsWith('title:')) ?? '';
  const title = titleLine.replace(/^title:\s*/, '').replace(/^"|"$/g, '');
  return title.length + fm.length + body.length;
}

function parseLineScan(text) {
  if (!text.startsWith('---\n')) return 0;
  let i = 4;
  let title = '';
  while (i < text.length) {
    const next = text.indexOf('\n', i);
    const lineEnd = next === -1 ? text.length : next;
    const line = text.slice(i, lineEnd);
    if (line === '---') {
      const body = text.slice(lineEnd + 1);
      return title.length + i - 4 + body.length;
    }
    if (line.startsWith('title:')) title = line.slice(6).trim().replace(/^"|"$/g, '');
    i = lineEnd + 1;
  }
  return 0;
}
```

ポイントはかなり単純で、**regex は強いけど文字列全体を大きく見る**、`indexOf` は **区切り位置だけ素早く取る**、`lineScan` は **先頭だけを舐めてすぐ抜ける**。この差が数字にどう出るかを見た。

## 合成データ 2,880 ファイルでは、regex がいちばん重かった

まずは Node.js v22.22.0。

```json
{
  "dataset": "synthetic",
  "fileCount": 2880,
  "totalBytes": 12045504,
  "averageMs": {
    "regex": 78.395,
    "indexOf": 62.889,
    "lineScan": 57.877
  }
}
```

次に Bun v1.3.6。

```json
{
  "dataset": "synthetic",
  "fileCount": 2880,
  "totalBytes": 12045504,
  "averageMs": {
    "regex": 79.667,
    "indexOf": 58.791,
    "lineScan": 52.350
  }
}
```

結果はかなり素直だった。**Node でも Bun でも lineScan が最速、regex が最遅**。しかも差は無視しづらい。Node では regex 78.395ms に対して lineScan 57.877ms、Bun では regex 79.667ms に対して lineScan 52.350ms。Bun のほうが差が大きくて、今回の条件だと **regex より lineScan のほうが約 34% 速い**。

ラウンド別ログも置いておく。

```text
Node.js v22.22.0 / synthetic
regex    96.819 / 76.949 / 75.166 / 75.134 / 74.642 / 71.659 ms
indexOf  67.315 / 62.628 / 61.422 / 63.343 / 62.217 / 60.412 ms
lineScan 61.259 / 57.170 / 57.228 / 57.237 / 56.871 / 57.497 ms

Bun v1.3.6 / synthetic
regex    98.902 / 86.506 / 86.567 / 69.764 / 67.614 / 68.650 ms
indexOf  61.494 / 56.904 / 59.179 / 59.714 / 58.050 / 57.403 ms
lineScan 54.117 / 53.561 / 52.316 / 51.752 / 51.171 / 51.185 ms
```

ここでおもしろいのは、**Bun だから regex が急に魔法みたいに速くなるわけではなかった** こと。むしろ Bun でも、frontmatter みたいに「冒頭の狭い範囲だけ見ればいい処理」は、素直に先頭走査したほうが気持ちよく勝つ。

## 実ブログ 88 ファイルだと、差はかなり縮む

ただし、ここで「正規表現を全部捨てろ」と言い出すのは早い。実データの `src/content` に対して測ると、差はかなり小さくなる。

### Node.js v22.22.0

```json
{
  "dataset": "real-blog-content",
  "fileCount": 88,
  "totalBytes": 463173,
  "averageMs": {
    "regex": 6.492,
    "indexOf": 6.295,
    "lineScan": 6.166
  }
}
```

### Bun v1.3.6

```json
{
  "dataset": "real-blog-content",
  "fileCount": 88,
  "totalBytes": 463173,
  "averageMs": {
    "regex": 3.159,
    "indexOf": 3.099,
    "lineScan": 2.865
  }
}
```

88 ファイル規模だと、Node でも Bun でも全部 **数 ms 台** に収まる。つまり、実ブログ程度なら **読みやすさや実装の安心感のほうが大事** になりやすい。特に Node 側は、最速の lineScan と最遅の regex でも差は 0.3ms ちょい。Bun でも差はあるけど、まだ「ビルド全体を左右する主犯」と呼ぶほどではない。

## この結果から見えること

今回のベンチでいちばん大事なのは、**正規表現がダメなんじゃなくて、仕事の範囲に対してちょっと大げさ** だという点だと思う。frontmatter って、基本的にはファイル先頭から数行〜十数行を見れば終わる処理だ。なのに regex で本文全体まで抱き込む形にすると、毎回「広い世界」を見にいくことになる。

逆に `indexOf` や `lineScan` は、必要なところだけ見て早めに抜けられる。今回の結果もまさにそれで、**仕事のスコープが小さい処理ほど、単純な文字列走査が強い** というかなり実務的な結論になった。

あと、Bun が Node より全体的に軽かったのもおもしろい。今回の実データでは Node が 6ms 台、Bun が 3ms 前後。つまり **同じロジックでもランタイム差でだいぶ気分が変わる**。ただし順位そのものはほぼ同じだった。ここはけっこう大事で、**アルゴリズムの勝ち筋はランタイムをまたいでもそんなにブレない**。

## ぼくならどう使い分けるか

2026年3月22日（日）21:03 JST 時点の感触だと、こうなる。

- **数十ファイル規模のブログやノートアプリ**
  - まずは読みやすい実装でいい
  - regex でも大事故にはなりにくい
- **数千ファイル規模のビルド前処理や RAG ingest**
  - `indexOf` か `lineScan` を優先したい
  - 「先頭だけ見れば済む処理」を本文全体に広げない
- **Bun ベースのコンテンツ処理**
  - ただでさえ軽いので、lineScan 系にするとかなり気持ちいい
- **あとで YAML パーサを足す予定の処理**
  - まず delimiter 切り出しだけ自前で軽く済ませて、その内側だけパースする設計が扱いやすい

## まとめ

frontmatter 抽出って、地味すぎて軽視されやすい。でも、コンテンツを大量に読むツールでは **地味な処理こそ回数で効いてくる**。今回の実測では、Node.js でも Bun でも **lineScan > indexOf > regex** の順で安定していて、特に 2,880 ファイル規模では差がちゃんと見えた。

なので結論はシンプル。**frontmatter のためだけに本文全体を大げさに眺めなくていい**。小規模なら好きな実装でいいけど、件数が増えてきたら、先頭だけを素早く切る実装を一回疑ったほうがいい。こういう細かいところ、意外とあとでビルドの機嫌を左右する。