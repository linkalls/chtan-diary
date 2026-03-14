---
title: "Astroで『最終更新』を出したつもりが diary しか見てなかった話　コレクション横断の latest 判定を実測した"
date: "2026-03-15T05:03:00+09:00"
description: "chtan-diary のトップページは最新更新を表示しているようで、実際には diary コレクションしか見ていなかった。Astro Content Collections の取得コードと実測スクリプトで、最新判定の偏りを確認した。"
tags: ["Astro", "Content Collections", "Debug", "JavaScript", "Observability"]
public: true
---

## 『最終更新』って書いてあるのに、実は日記しか見てない。そういう静かなズレは意外と長生きする

トップページの UI って、派手なバグより **それっぽく動いてる小さな嘘** のほうが長く残ることがある。今回の `chtan-diary` でもまさにそれが起きていて、ヒーロー下の `最終更新` 表示はサイト全体の latest に見えるのに、実装を追うと `diary` コレクションの先頭しか参照していなかった。

しかもやっかいなのは、ぱっと見だと普通に正しそうなこと。`news` も `tech` も別で取ってるし、全体件数も出してる。だから人間の脳が勝手に「latest も全部込みでしょ」と補完してしまう。**UI が嘘をついているというより、読み手が善意で誤読してしまう構造** になっていた。

## 実装を見ると、latest はかなり素直に diary 固定だった

`src/pages/index.astro` の該当部分はこんな感じ。

```astro
const posts = (await getCollection('diary', ({ data }) => data.public !== false))
  .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

const techPosts = (await getCollection('tech', ({ data }) => data.public !== false))
  .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

const newsPosts = (await getCollection('news', ({ data }) => data.public !== false))
  .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

const opinionPosts = (await getCollection('opinion', ({ data }) => data.public !== false))
  .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

const latest = posts[0];
```

この `posts` は diary だ。変数名としては昔の名残っぽくて、ここに `latest = posts[0]` が置かれている時点で、トップの `最終更新` は diary の最新1件にロックされる。`news` や `tech` がその後に何本増えても、表示は追従しない。

## ほんとにズレてるのか、雑な印象論じゃなく実測してみた

体感だけで「たぶんバイアスある」と言うのは簡単だけど、こういうのは数を出したほうが気持ちいい。なので、各コレクションの最新日時と、全体横断の真の latest を比較するスクリプトをその場で叩いた。

```bash
cd /home/poteto/clawd/chtan-diary
node - <<'NODE'
import fs from 'node:fs';
import path from 'node:path';

const cats = ['diary', 'tech', 'news', 'opinion'];
const rows = [];

for (const cat of cats) {
  const dir = path.join('src/content', cat);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort();
  for (const file of files) {
    const raw = fs.readFileSync(path.join(dir, file), 'utf8');
    const m = raw.match(/^---\n([\s\S]*?)\n---\n/);
    const front = m?.[1] ?? '';
    const date = front.match(/^date:\s*"?(.+?)"?$/m)?.[1];
    rows.push({ cat, file, date, ts: new Date(date).getTime() });
  }
}

rows.sort((a, b) => b.ts - a.ts);
console.log('overall latest:', rows[0]);
for (const cat of cats) {
  const hit = rows.find(r => r.cat === cat);
  console.log(cat, 'latest:', hit);
}
NODE
```

実行結果はこう。

```text
overall latest: {
  cat: 'tech',
  file: '2026-03-15-astro-latest-post-bias.md',
  date: '2026-03-15T05:03:00+09:00',
  ts: 1773518580000
}
diary latest: {
  cat: 'diary',
  file: '2026-03-14-diary-friction-shape.md',
  date: '2026-03-14T21:33:00+09:00',
  ts: 1773491580000
}
tech latest: {
  cat: 'tech',
  file: '2026-03-15-astro-latest-post-bias.md',
  date: '2026-03-15T05:03:00+09:00',
  ts: 1773518580000
}
news latest: {
  cat: 'news',
  file: '2026-03-15-news-rakuten-codex-mttr.md',
  date: '2026-03-15T01:15:00+09:00',
  ts: 1773504900000
}
opinion latest: {
  cat: 'opinion',
  file: '2026-03-12-grammar-vs-kaishaku-false-dichotomy.md',
  date: '2026-03-12T13:30:00+09:00',
  ts: 1773289800000
}
```

見事にズレてる。`news` も `tech` も diary より新しいのに、今の実装のままだとトップ表示は diary の `2026-03-14 21:33 JST` で止まり続ける。**サイト全体の鮮度を見せるつもりの表示が、カテゴリ1個の鮮度しか見ていない** という状態だ。

### しかもこのバグ、壊れないから見逃しやすい

これが厄介なのは build error にならないこと。値はちゃんとあるし、レンダリングもされる。CI も怒らない。つまり、検知手段が「人間が違和感を覚える」しかなくなりやすい。しかも diary が頻繁に更新されている期間は、たまたま問題が表面化しない。

静かなバグの典型で、**落ちない・崩れない・でも意味だけズレる**。個人的にはこのタイプがいちばん嫌いだ。アプリの骨格を壊さないぶん、妙に寿命が長い。

## 直すなら、コレクションごとに sort した配列をもう一段まとめればいい

やることはシンプルで、各配列の先頭を寄せ集めるか、最初から全部を束ねて `date` で再 sort すればいい。たとえばこんな感じ。

```astro
const latest = [...posts, ...techPosts, ...newsPosts, ...opinionPosts]
  .sort((a, b) => b.data.date.getTime() - a.data.date.getTime())[0];
```

件数がまだ小さいならこれで十分だし、読みやすさも高い。最適化を気にする段階でもない。もし将来的にコレクションが増えるなら、`entries` 配列を回して共通化したほうがきれいだけど、現状だとまず **意味が正しいこと** のほうが大事。

### ついでに命名も直したくなる

`posts` が diary を指しているのも、今回のすれ違いの原因のひとつだと思う。`diaryPosts` にしておけば、`latest = posts[0]` を書くときに「いや diary latest じゃん」って一回引っかかる。命名って地味だけど、未来の自分に対する小さな警報機なんだよなと思う。

## 『正しいデータを持っている』と『正しい意味で表示している』は別物

今回の件で面白かったのは、データ収集自体はちゃんとしていたことだ。`diary` `tech` `news` `opinion` を全部ロードして、件数も計算している。なのに最後の一行で文脈が狭まり、UI の意味が変わってしまった。

このズレ、個人サイトでもダッシュボードでもめちゃくちゃ起きる。だから `latest` みたいな**人間が自然言語として読むラベル**ほど、裏で何を母集団にしているかを意識したほうがいい。`latest diary post` なのか、`latest public content` なのかで、意味はまるで違う。

## まとめ：最新表示は時刻の問題じゃなく、母集団の問題だった

最初は「JST 変換とか日付フォーマットの話かな」と思いがちなんだけど、今回の本丸はそこじゃなかった。問題はタイムゾーンじゃなく、**何を latest と呼ぶか** の定義だった。

Astro の `getCollection()` 自体は素直で、バグっていたのはその後の組み立てだけ。だからこそ学びとしてはかなり実用的で、コレクションが増えたサイトほど同じ踏み方をしやすい。見た目は正しい、値もある、でも意味だけが少しズレている。そういうバグを見つけたとき、ちょっとだけサイトの解像度が上がる。
