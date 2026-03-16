---
title: "ZigとWebAssemblyの最強タッグ：超軽量バイナリでブラウザを制圧する実験"
date: "2026-03-16"
tags: ["Zig", "WebAssembly", "Wasm", "低レイヤー", "パフォーマンス"]
---

Webフロントエンドのパフォーマンス最適化において、もはやWebAssembly (Wasm) は特別な技術ではなくなりつつある。しかし、CやRustでWasmをビルドする際の「環境構築の面倒さ」や「バイナリサイズの肥大化」に頭を悩ませている開発者は少なくないだろう。

そこで今回注目したいのが、**Zig** だ。ZigはC言語の代替を目指して開発されたプログラミング言語でありながら、その標準機能として信じられないほどシームレスなWasm出力サポートを備えている。

## なぜZig × Wasmなのか？

Zigの最大の特徴は、ツールチェーンが最初からクロスコンパイルを前提として設計されている点だ。特別なプラグインや複雑なビルドスクリプトを記述することなく、コマンド一発でWasmバイナリを生成できる。

さらに、Zigはランタイムやガベージコレクションを持たないため、出力されるWasmバイナリは極限まで小さくなる。これは、ロード時間が直結するWeb環境において決定的な優位性をもたらす。

## 実際に最小のWasmを作ってみる

百聞は一見に如かず。実際にZigで単純な足し算を行うWasmモジュールを作成してみよう。

```zig
// math.zig
export fn add(a: i32, b: i32) i32 {
    return a + b;
}
```

たったこれだけだ。`export` キーワードをつけることで、外部（つまりJavaScript側）からこの関数を呼び出せるようになる。

これをコンパイルするコマンドも驚くほどシンプルだ。

```bash
zig build-exe math.zig -target wasm32-freestanding -fno-entry -O ReleaseSmall
```

`-target wasm32-freestanding` でWasm出力を指定し、`-fno-entry` でメイン関数（`main`）がないことをコンパイラに伝える。そして `-O ReleaseSmall` をつけることで、バイナリサイズを極限まで削ぎ落とす。

## 生成されたバイナリの小ささに驚愕する

手元の環境で実行してみたところ、生成された `math.wasm` のサイズはわずか **数十バイト** だった。Rustなどで同様のコードをコンパイルすると、設定次第では数キロバイトまで膨れ上がることもあるため、この軽さは圧倒的だ。

JavaScriptからの呼び出しも、標準のWebAssembly APIを使って非常に直感的に行える。

```javascript
// index.html
async function init() {
    const response = await fetch('math.wasm');
    const bytes = await response.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes);
    
    console.log("Result of 5 + 7 =", instance.exports.add(5, 7)); // 12
}
init();
```

## メモリ操作と文字列の受け渡し

足し算などの単純な計算は簡単だが、実用的なアプリケーションでは文字列や配列のやり取りが不可欠になる。ZigとJavaScriptの間でメモリを共有する場合、Zig側のアロケータをJavaScriptから操作するような設計が必要になる。

Zigには `std.heap.page_allocator` や独自のカスタムアロケータを簡単に組み込む機能があるため、Wasmの線形メモリを効率的に管理できる。この「メモリのレイアウトを完全にコントロールできる」という低レイヤー言語ならではの特性が、Wasm開発において非常に心地よい。

## まとめ：ZigはWasm開発の最適解の一つ

TypeScript中心のWeb開発において、どうしてもパフォーマンスが必要なボトルネック部分だけをWasm化したいというケースは多い。その際、Zigは「学習コスト」「環境構築コスト」「バイナリサイズ」のすべての面で、非常に魅力的な選択肢となっている。

今後、Next.jsやHonoといったフレームワークの裏側で、密かにZig製Wasmが稼働するアーキテクチャが増えてくるかもしれない。引き続き、Zigの動向とエコシステムの進化を追っていきたい。
