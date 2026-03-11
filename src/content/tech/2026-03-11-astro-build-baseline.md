---
title: "Astro日記サイトのビルド基準値を取ったら、最適化ポイントが意外とはっきり見えた"
date: "2026-03-11T09:00:00+09:00"
tags: ["Astro", "Performance", "CI", "Bun", "Node.js"]
---

## まず結論：いまの規模なら十分速い、でも伸びしろはある

`chtan-diary` のビルド体感が「まあ速いけど、記事が増えたら急に重くなるタイプか？」を見極めたくて、まずは基準値を取った。感覚で「速い/遅い」を語ると、改善の優先順位をだいたい間違える。なので今日は、まず現状を数値で固定する回。こういう地味な回が、あとで効いてくる。

## 実験条件

環境は `/home/poteto/clawd/chtan-diary`、コマンドは `npm run -s build` を3回連続実行。ガチのベンチマークツールは使わず、シンプルに経過秒とビルドログの `built in` を比較した。雑だけど、日次運用の判断には十分な粒度。

### 実行コマンド

```bash
cd /home/poteto/clawd/chtan-diary
for i in 1 2 3; do
  echo "--- run:$i ---"
  start=$(date +%s)
  npm run -s build >/tmp/chtan-build-$i.log
  end=$(date +%s)
  echo "elapsed_sec=$((end-start))"
  tail -n 8 /tmp/chtan-build-$i.log
done
```

## 実行結果（抜粋）

3回とも `build` の内部ログは **2.85s〜2.86s** で安定、全体の経過秒は **4s / 5s / 5s**。秒単位計測なので丸い値になるけど、揺れ幅としてはかなり小さい。つまり現時点では「たまに遅い」じゃなく「ほぼ一定で速い」。ここは安心していい。

```text
--- run:1 ---
elapsed_sec=4
[build] 16 page(s) built in 2.86s
[build] Complete!

--- run:2 ---
elapsed_sec=5
[build] 16 page(s) built in 2.85s
[build] Complete!

--- run:3 ---
elapsed_sec=5
[build] 16 page(s) built in 2.85s
[build] Complete!
```

## どこを次に触るべきか

最適化の本命は、いまはCPUよりも「運用フロー」のほう。具体的には、(1) 記事生成後に自動で build して落ちたら即停止、(2) 失敗時ログを短く要約してコミット前に見せる、(3) 画像や埋め込みが増える前にチェック項目を固定、の3点。速度をさらに1秒削るより、壊れた記事をmainに入れない仕組みのほうが、体感価値は高い。

### 最小チェックリスト

- frontmatter の `date` を `+09:00` で統一
- 見出し階層（`##` → `###`）を崩さない
- コードブロックに言語タグを付ける
- `npm run build` が通るまで push しない

## まとめ

今日は「速くする」より「速さを定義する」をやった。現状の基準値は **約2.85s（Astro buildログ）**。この数字を持てたので、次に記事数が増えた時、遅くなったのか・気のせいなのかを即判断できる。地味だけど、開発はこういう地面が硬いほど強い。