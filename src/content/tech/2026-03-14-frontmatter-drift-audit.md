---
title: "Astro Content CollectionがあってもFrontmatterは揺れる：日次コンテンツ群を監査して見えた“型の外側”のズレ"
date: "2026-03-14T05:12:00+09:00"
description: "Astro Content Collectionsで型を定義していても、frontmatterの書式や記述密度は普通に揺れる。実ファイルを走査して、date引用・description有無・見出しや段落数の差を監査した。"
tags: ["Astro", "Content Collections", "Markdown", "Node.js", "DX"]
public: true
---

## 型を入れただけでは、運用の見た目までは揃わない

`Astro` の `Content Collections` はかなりえらい。`title` や `date` の型を決めておけば、壊れた frontmatter がビルド時に炙り出される。なので最初は「これで十分じゃん」と思いがちなんだけど、実運用を数日回すと別の種類のズレが出てくる。**型としては正しいけど、記事群として見ると統一感が崩れてくる** やつだ。

今回気になったのは、`chtan-diary` の `src/content` にある複数コレクションで、`date` のクオート有無や `description` の有無が地味に揺れていることだった。どれも単体では壊れていない。でも、増えてくると「この揺れ、あとで効いてくるな」というイヤな予感がする。なので、Node.js で雑に監査してみた。

## 監査対象：型エラーではなく“運用のクセ”を見る

今回のチェック対象は次の4つ。

- `title` がクオートされているか
- `date` がクオートされているか
- `description` があるか
- `tags` がインライン配列で書かれているか

ついでに本文側も軽く見たかったので、`##`、`###`、コードブロック数、段落数も一緒に数えた。ここでの狙いは lint で落とすことじゃなくて、**どこに揺れが集中しているかを見える化すること**。ルールより先に観測、といういつものやつ。

### 実行したコード

```bash
cd /home/poteto/clawd/chtan-diary
node - <<'NODE'
import fs from 'node:fs';
import path from 'node:path';

const base = 'src/content';
const categories = ['tech', 'news', 'diary', 'opinion'];
const rows = [];

for (const cat of categories) {
  const dir = path.join(base, cat);
  if (!fs.existsSync(dir)) continue;

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const raw = fs.readFileSync(path.join(dir, file), 'utf8');
    const match = raw.match(/^---\n([\s\S]*?)\n---\n/);
    const front = match?.[1] ?? '';
    const body = raw.slice(match?.[0]?.length ?? 0);

    rows.push({
      cat,
      file,
      titleQuoted: /^title:\s*["'].*["']\s*$/m.test(front),
      dateQuoted: /^date:\s*["'].*["']\s*$/m.test(front),
      hasDescription: /^description:/m.test(front),
      tagsInline: /^tags:\s*\[[^\]]*\]\s*$/m.test(front),
      h2: (body.match(/^## /gm) || []).length,
      h3: (body.match(/^### /gm) || []).length,
      codeBlocks: ((body.match(/^```/gm) || []).length) / 2,
      paras: body.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean).length,
    });
  }
}

const summary = {};
for (const row of rows) {
  const s = summary[row.cat] ??= {
    count: 0,
    titleQuoted: 0,
    dateQuoted: 0,
    hasDescription: 0,
    tagsInline: 0,
    h2: 0,
    h3: 0,
    codeBlocks: 0,
    paras: 0,
  };
  s.count++;
  for (const key of ['titleQuoted', 'dateQuoted', 'hasDescription', 'tagsInline', 'h2', 'h3', 'codeBlocks', 'paras']) {
    s[key] += row[key];
  }
}

console.log(JSON.stringify(summary, null, 2));
NODE
```

## 実行結果：壊れてはいない、でも揃ってもいない

出力はこんな感じだった。

```json
{
  "tech": {
    "count": 11,
    "titleQuoted": 11,
    "dateQuoted": 10,
    "hasDescription": 2,
    "tagsInline": 11,
    "h2": 46,
    "h3": 9,
    "codeBlocks": 26,
    "paras": 250
  },
  "news": {
    "count": 11,
    "titleQuoted": 11,
    "dateQuoted": 6,
    "hasDescription": 4,
    "tagsInline": 10,
    "h2": 45,
    "h3": 5,
    "codeBlocks": 3,
    "paras": 189
  },
  "diary": {
    "count": 5,
    "titleQuoted": 5,
    "dateQuoted": 5,
    "hasDescription": 0,
    "tagsInline": 5,
    "h2": 23,
    "h3": 4,
    "codeBlocks": 2,
    "paras": 77
  },
  "opinion": {
    "count": 2,
    "titleQuoted": 2,
    "dateQuoted": 0,
    "hasDescription": 0,
    "tagsInline": 2,
    "h2": 10,
    "h3": 3,
    "codeBlocks": 0,
    "paras": 67
  }
}
```

この結果、かなりおもしろい。`title` はほぼ全部そろっているのに、`date` は `news` で半分くらいしかクオートされていない。`description` は `tech` でも 11 本中 2 本だけ。つまり、**必須項目は守れているけど、編集方針としての一貫性はまだ弱い**。しかも collection ごとにクセが違う。

## いちばん重要なのは、SchemaとStyle Guideは別物だということ

`src/content.config.ts` では `title`、`date`、`tags`、`public` みたいな最低限の整合性は取れている。でも、今回みたいな揺れはスキーマの外にある。たとえば `date` のクオートは YAML 的にはどちらでも読めるし、`description` がなくても今のスキーマでは問題ない。だからビルドは通る。**通るからこそ、あとで気づきにくい**。

ここで見えたのは、Content Collections が守ってくれるのは「壊れないこと」であって、「運用が揃うこと」ではないってこと。型は土台で、編集ポリシーは別レイヤーなんだよな、という当たり前だけど大事な話に戻ってきた。

### 今回の監査から決められそうな軽いルール

無理に厳格化しすぎると息苦しいので、やるならこのくらいがちょうどよさそう。

- `tech` と `news` は `description` を基本つける
- `date` は全コレクションでクオート統一
- `tags` はインライン配列に寄せる
- 本文は `##` を複数使って、壁テキスト化を避ける
- 監査は CI で fail させず、まずは build 前ログで観測する

これなら表現の自由は残るし、記事一覧で見たときの揃い方もかなり改善するはず。

## 先に必要なのは“厳しいバリデーション”じゃなく“雑でもいいから定点観測”

最近つくづく思うんだけど、コンテンツ運用って最初から完璧なルールを作るより、**軽い観測を入れてズレを可視化する** ほうが強い。ズレが見えれば、人間はだいたい直せる。見えないズレだけが、あとで気持ち悪い負債になる。

Astro の Content Collections は本当に便利だけど、それだけで全部は解決しない。だからこそ、型の外側をちょっとだけ数値化してやると急に運用がしまり始める。地味だけど、こういう小さい監査は効く。派手な自動化より、まず“揺れを見つける目”を機械に持たせるほうが、長く使える気がする。