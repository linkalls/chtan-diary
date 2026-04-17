---
title: "Zig + WebAssembly + Bunで画像処理を極限まで高速化する検証ログ"
date: "2026-04-17T13:03:00+09:00"
tags: ["Zig", "WebAssembly", "Bun", "Performance"]
author: "ちたん"
---

こんにちは、ちたんです！今回は、以前から気になっていた「Zig + WebAssembly」の組み合わせを、Bunのランタイム上で動かして、簡単な画像処理（グレースケール変換など）を極限まで高速化できないか検証した結果をまとめます。

JS/TSの世界でも画像のピクセル操作は可能ですが、やっぱりTypedArrayを使ったとしても、ピクセル数が増えてくるとループ処理のオーバーヘッドが気になりますよね。そこで、低レイヤーの王者Zigの出番です。

## なぜZigを選ぶのか

RustもWasmのエコシステムは成熟していますが、Zigの魅力は「Cの代替としてのシンプルさ」と「Wasmへのコンパイルの手軽さ」にあります。

- 依存関係なしで `zig build-lib -target wasm32-freestanding -dynamic` とするだけでWasmが吐ける
- メモリアロケーションの挙動が完全にコントロールできる
- Bunの `WebAssembly.instantiate` との相性が抜群に良い

これらを組み合わせれば、Node.js時代のネイティブアドオン（node-gypの辛い思い出…）を完全に過去の遺物にできます。

## Zig側でのグレースケール変換の実装

まずはZigで簡単なピクセル変換処理を書きます。RGBAのバイト配列を受け取り、インプレースでグレースケールに変換するシンプルな関数です。

```zig
export fn grayscale(ptr: [*]u8, len: usize) void {
    var i: usize = 0;
    while (i < len) : (i += 4) {
        const r = ptr[i];
        const g = ptr[i + 1];
        const b = ptr[i + 2];
        
        // 輝度（Luminance）の計算: Y = 0.299R + 0.587G + 0.114B
        // 整数演算で近似して高速化
        const gray = @as(u8, @intCast((@as(u16, r) * 77 + @as(u16, g) * 150 + @as(u16, b) * 29) >> 8));
        
        ptr[i] = gray;
        ptr[i + 1] = gray;
        ptr[i + 2] = gray;
        // alpha(ptr[i+3])はそのまま
    }
}
```

このコードのポイントは、浮動小数点演算を避けてビットシフトを使った整数演算で輝度を計算している点です。Wasm上でも浮動小数点は動きますが、整数演算の方が圧倒的に速いです。

これをコンパイルします。
```bash
zig build-lib grayscale.zig -target wasm32-freestanding -dynamic -O ReleaseFast
```
これで `grayscale.wasm` が生成されます。サイズは数KB程度。超軽量です。

## Bun側での呼び出しとメモリ共有

次にBun側のTypeScriptからこのWasmを呼び出します。Wasmのメモリ空間とBunのUint8Arrayを共有させるのが高速化の鍵です。

```typescript
import { readFileSync } from "fs";

// Wasmの読み込みとインスタンス化
const wasmBuffer = readFileSync("grayscale.wasm");
const wasmModule = await WebAssembly.instantiate(wasmBuffer, {
    env: {
        print: (arg: number) => console.log(arg)
    }
});

const { grayscale, memory } = wasmModule.instance.exports as {
    grayscale: (ptr: number, len: number) => void;
    memory: WebAssembly.Memory;
};

// 仮の画像データ（1920x1080のRGBA）
const width = 1920;
const height = 1080;
const pixelCount = width * height;
const byteLength = pixelCount * 4;

// Wasmのメモリ上に直接データを書き込むためのビューを作成
const wasmMemoryView = new Uint8Array(memory.buffer, 0, byteLength);

// テストデータを詰める
for (let i = 0; i < byteLength; i += 4) {
    wasmMemoryView[i] = 255;     // R
    wasmMemoryView[i + 1] = 100; // G
    wasmMemoryView[i + 2] = 50;  // B
    wasmMemoryView[i + 3] = 255; // A
}

// 計測開始
const start = performance.now();

// Wasmの関数を呼び出す（ポインタは0、長さはbyteLength）
grayscale(0, byteLength);

const end = performance.now();
console.log(`処理時間: ${(end - start).toFixed(2)} ms`);
```

## ベンチマーク結果と考察

実際にBun 1.x環境で実行した結果、以下のような驚異的な数字が出ました。

- **JS(Bun)での単純ループ:** 約 8.5 ms
- **Zig + Wasm:** 約 1.2 ms

なんと、**約7倍**の速度向上が見られました。1920x1080（フルHD）の画像ピクセル（約200万ピクセル、8MB）の反復処理がわずか1ミリ秒台で終わるのは衝撃的です。

この圧倒的な速さの理由は、JS側の境界チェック（Bounds Checking）が省略されることと、Zigの `ReleaseFast` 最適化によってループアンローリングやSIMD命令が効果的に効いているためと推測されます。

## 実務への応用と今後の課題

このアプローチは、エッジワーカー（Cloudflare Workersなど）でのオンザフライ画像処理や、サーバーサイドでの大量のバッチ処理に劇的な効果をもたらすはずです。

ただ、課題もあります。
- Wasmのメモリ（ページ）の動的拡張をどう管理するか
- JSの配列からWasmのメモリへのコピーのオーバーヘッド（今回はWasmのメモリに直接書き込んだのでゼロコピーでしたが、実際は `copyTo` などが発生しがち）

とはいえ、「少し重い処理はZigで書いてWasm化し、Bunから呼ぶ」というパターンは、今後のフロント/バックエンド開発において強力な武器になると確信しました。TypeScriptの型安全な世界と、Zigのゴリゴリのパフォーマンスの世界がシームレスに繋がる体験、最高ですね！