---
title: "Google、ADKにGitHub・Stripe・Notion・MongoDBまで雪崩れ込ませる。エージェント開発は『モデル選び』から『配線の覇権争い』へ入った"
date: 2026-03-22T17:20:00+09:00
tags:
  - google
  - adk
  - ai-agents
  - mcp
  - developer-tools
  - github
  - integrations
public: true
---

## いま起きてるのは新しいSDKの話じゃない。Googleが“エージェントの配線盤”そのものを取りにきたって話だ

Googleが **Agent Development Kit（ADK）** の統合エコシステム拡張を発表して、GitHub、GitLab、Postman、Notion、Linear、MongoDB、Pinecone、Stripe、PayPal、ElevenLabs みたいな名前が一気に並んだ。こういう一覧って、普通は「提携先が増えました」で流しがちなんだけど、今回はそこじゃない。重要なのは、**エージェント開発のしんどさがモデル精度より“外部サービスとの接続”に移っている** とGoogleが完全に認めたことだ。

ここ数か月のAI開発って、どのモデルが強いか以上に、**どれだけ少ない glue code で本番っぽい仕事をやらせられるか** の勝負になってる。検索して、GitHubを読んで、タスク管理を見て、DBを叩いて、決済や通知まで流す。そのたびに認証、状態管理、エラー処理、観測、再試行を書いていたら、エージェントを作ってるのか、接着剤工場を運営してるのかわからなくなる。Googleはそこへ、かなり露骨に踏み込んできた。

## 追加された統合の顔ぶれがいやらしく強い。全部“実務の導線”に刺さっている

今回並んだ統合をざっくり見るだけでも、Googleの狙いははっきりしてる。コード系では **GitHub / GitLab / Postman / Daytona / Restate**、プロジェクト管理では **Notion / Atlassian / Asana / Linear**、データでは **MongoDB / Chroma / Pinecone**、メモリ層では **GoodMem / Qdrant**、観測では **AgentOps / Phoenix / Weave / MLflow**、さらに **Stripe / PayPal / Mailgun / ElevenLabs** まで入ってくる。これ、単に「道具が増えた」じゃなくて、**エージェントが会社の中で実際に触りたくなる場所** がひととおり揃い始めた、ということだ。

しかも構成の置き方がうまい。Googleは「全部Google製で囲います」とは言っていない。むしろ **McpToolset** や plugin アーキテクチャを前面に出して、サードパーティ統合を“ADKの標準的な拡張ポイント”として扱っている。要するに、囲い込みのやり方が古典的なロックインじゃない。**『どうせみんな外部ツールを使うんでしょ。その接続レイヤーだけGoogleの流儀にしておくね』** という、だいぶ現代的でしたたかな攻め方だ。

### 今回の発表で見えてきたポイント

- 競争の主戦場が **モデル性能そのもの** から **統合済みの実務スタック** へ移っている
- ADK は単体SDKというより **MCP時代のハブ** を狙っている
- GitHub や Stripe のような“結果に直結するサービス”が増え、デモ用途から実務用途へ寄っている
- 観測系ツールの拡充で、**作るだけじゃなく運用する** 前提が見えている
- Google Cloud 既存資産と接続したときの相乗効果がかなり大きい

## 一番いやらしいのは、Googleが“モデル”ではなく“選択コストの低さ”を売り始めたことだ

ADKの説明を見ると、コアロジックをツール実装に結びつけず、設定を差し替えるだけで統合を追加できる世界観をかなり強く押している。ここで効いてくるのはベンチマークの数字じゃない。**開発者が今日の午後に試せるかどうか** だ。新しいフレームワークや新しいエージェント基盤が失敗しやすいのは、「思想はいいけど、最初の接続で疲れる」から。でも今回のADKは、その最初の疲れをかなり削りにきている。

たとえば GitHub 連携の例では、Python で `McpToolset` を追加して、HTTPベースのMCP接続先を設定するだけでツール群をぶら下げられる。もちろん現実の本番運用では認証、権限、監査、読み取り専用設定、失敗時の分岐が必要になる。でも逆に言えば、その段階に入る前の「とりあえず社内repoを読ませてみたい」「issue一覧をまとめさせたい」みたいな検証は、かなり短い距離で始められる。

```python
from google.adk.agents import Agent
from google.adk.tools.mcp_tool import McpToolset
from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPServerParams

root_agent = Agent(
    model="gemini-3-flash-preview",
    name="github_agent",
    instruction="Help users get information from GitHub",
    tools=[
        McpToolset(
            connection_params=StreamableHTTPServerParams(
                url="https://api.githubcopilot.com/mcp/",
                headers={
                    "Authorization": "Bearer YOUR_GITHUB_TOKEN",
                    "X-MCP-Toolsets": "all",
                    "X-MCP-Readonly": "true",
                },
            ),
        )
    ],
)
```

このサンプル自体は短い。でも短いからこそ意味がある。いま開発者が欲しいのは、壮大な未来図より **5分で“動く入口”に触れること** だからだ。

## じゃあOpenAIやAnthropicよりGoogleが一歩先かというと、そこはまだ雑に言えない

ここは冷静に見たい。ADKの統合群はたしかに魅力的だけど、エージェント開発で本当に効くのは、統合数よりも **権限設計・失敗耐性・観測のしやすさ・ツール選択の安定性** だ。ツールが増えるほど、モデルがいつ何を叩くかの制御は難しくなるし、トラブル時のデバッグ範囲も広がる。MCP的な世界は夢が大きい反面、**接続できること** と **安全に運用できること** の間に、かなり深い谷がある。

それでも今回のGoogleは無視しにくい。理由は単純で、これがただの「対応サービス追加」じゃなく、**エージェントを本番導線へ載せるための部品表を先回りで埋める動き** だからだ。モデルが多少強い、弱いよりも、開発チームが「うちのNotionとGitHubとStripeとMongoDBにつなげて試せる？」と聞いた瞬間に、答えが **はい、しかもそれなりに筋の良い形で** になってくる。この差はじわじわ効く。

## 2026年のエージェント競争は“頭の良さ”じゃなく“仕事場の広さ”で決まり始めている

昔のLLMニュースは、だいたいパラメータ数とかベンチとかで盛り上がっていた。でもいまの勝負は違う。モデルが賢いだけでは足りなくて、**どこまで現実の道具箱に手を伸ばせるか** が問われている。GitHubを触れないエージェント、Notionを読めないエージェント、支払いも通知もできないエージェントは、結局“気の利いたチャット”から抜け出しにくい。

Googleの今回の一手は、まさにそこを取りにきたものに見える。Geminiを中心に据えつつ、MCPっぽい接続世界、観測基盤、クラウド資産、そしてサードパーティサービス群を束ねて、**『エージェントに仕事をさせる場所』そのものをGoogle流に再編しようとしている**。これ、見た目以上に野心的だ。

## まとめると、ADK統合拡張は「また提携増えた」で済ませると見誤る。Googleはエージェントのインフラ層を静かに食い始めている

派手なモデル名の更新に比べると、統合エコシステムの話は地味に見える。でも実際には、ここがいちばん本番に近い。なぜなら、企業や個人開発者が最終的に困るのは「モデルのIQ不足」より **配線・権限・観測・運用の泥臭さ** だからだ。Googleはその泥に対して、「じゃあ最初からそれっぽい道を敷いておきます」と言い始めた。

これはかなり強い。というか、ちょっと怖い。エージェント時代の覇権って、もしかすると“最高性能の頭脳”じゃなく、**いちばん自然に外部世界へ接続できる足回り** が握るのかもしれない。今回のADK拡張は、その空気をかなりはっきり言語化した発表だった。

### ソース

- Google Developers Blog: <https://developers.googleblog.com/supercharge-your-ai-agents-adk-integrations-ecosystem/>
- ADK integrations docs: <https://google.github.io/adk-docs/integrations/>
- ADK MCP tools docs: <https://google.github.io/adk-docs/tools-custom/mcp-tools/>
