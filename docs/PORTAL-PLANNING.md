# Portal Planning Agent

## 目的

Portal Planning Agentは、カテゴリ、テーマ、地域、対象ポジション、目的を入力すると、カテゴリ別ポータルの検索意図とページ構成を機械可読な計画として返します。CMS-OSのコンテンツ提案、下書き、事実確認、SEO監査、BuilderOS Adapter向け静的公開へそのまま接続できます。

## 入力

| 項目 | 必須 | 内容 |
|---|---:|---|
| `category` | ○ | `legal`、`beauty`などのカテゴリ |
| `theme` | ○ | 2〜100文字の重点テーマ |
| `region` |  | 都道府県、市区町村、商圏などの地域 |
| `audience` | ○ | `customer`、`candidate`、`media`などの対象ポジション |
| `goal` |  | `discovery`、`conversion`、`recruiting`、`regional` |

## 出力

- 検索意図: 基礎理解、比較検討、行動直前、地域探索、応募検討
- ページ案: カテゴリハブ、テーマガイド、事業者一覧、FAQ、地域ページ、求人、相談・依頼
- カバレッジ: 公開事業者、外部案内、公開求人、既存コンテンツ、テーマ一致コンテンツ、対象ロールの表示モジュール
- ギャップ: 事業者不足、外部案内不足、求人不足、テーマ一致コンテンツ不足、未公開、地域未指定、出典確認待ち
- 次アクション: `content.propose`、`content.draft`、`content.fact_check`、`seo.audit`、`publication.build`など
- 計画反映: ページ案を対象ポジション別の`ContentProposal`へ一括変換し、`content.draft`以降の編集フローへ渡せます。

## 権限と分離

- 作成・一覧・取得は事業者ロールだけが利用できます。
- 計画はカテゴリと事業者IDで分離し、他カテゴリ・他事業者の計画は取得できません。
- 計画はJSON StateStoreまたはPostgreSQL移行用の状態ストアへ保存されます。
- 生成結果は推奨案であり、出典確認と人間の承認を経て公開します。

## API/MCP

| REST | MCP | 用途 |
|---|---|---|
| `POST /api/v1/portal-plans` | `portal.plan` | 計画を生成 |
| `GET /api/v1/portal-plans` | `portal.plan.list` | 自社計画を一覧 |
| `GET /api/v1/portal-plans/{planId}` | `portal.plan.get` | 計画を取得 |
| `POST /api/v1/portal-plans/{planId}/apply` | `portal.plan.apply` | 計画から企画案を冪等に作成 |

作成されたページ案は、`content.propose`で企画化し、`content.draft`で下書き、`content.fact_check`と`seo.audit`で検証した後、`publication.build`でCloudflare Pages向け静的ファイルへ変換します。

`portal.plan.apply`を一度実行すると計画に作成済み企画案IDと反映日時が記録されます。同じ計画を再度反映しても企画案は重複作成されません。求人ページは`job`・`candidate`、その他のページは計画の`audience`を引き継ぎます。
