# Cumulus

積雲（cumulus）のように、使わなかった日を少しずつ積み重ねる、家計簿と投資のアプリ。
買い物を記録して、使わなかった日を投資資金として貯める。
GitHub Pages でそのまま公開できる（ビルド不要）。記録はこの端末の中（ブラウザ）だけに保存する。

## できること
- 買い物の記録（現金・バーコード決済・クレジット）。レシートの写真から品目と金額を読み取る（写真は保存しない）
- カレンダー（1画面）：使った金額、使わなかった日（ブタの貯金箱のイラスト）、カードの引き落とし日（カードのイラスト）
- 投資資金：1日あたりの金額を、使わなかった日ごとに貯める。月ごとに集計（月が替わると0円から。先月以前は一覧に残る）
- 投資の記録：実際に投資した金額。月・全期間・期間指定で、貯まった額／投資した額／残りを見られる
- まとめ：週・月・年・期間指定。支払い方法ごとの内訳、クレジットの引き落とし
- クレジットカード：締め日・引き落とし月・引き落とし日を設定し、いつ・いくら引き落とされるかを表示
- メールから自動取り込み：三井住友カードの「ご利用のお知らせ」メールを取り込む（下記）。JCBは書式の見本が届いてから対応

## メールからの自動取り込み
あなたのGoogleアカウントの中に小さなプログラム（`tools/apps-script/Code.gs`）を置き、アプリがそのURLに問い合わせる。

- 読み取るのは、送信元 `@vpass.ne.jp` の「ご利用のお知らせ」だけ。アプリに返すのは、日付・時刻・金額・利用先だけ（本文は返さない）
- 合言葉（TOKEN）が合わない呼び出しには何も返さない。合言葉はアプリが作り、「スクリプトをコピー」で自動で入る
- 重複：同じカード・同じ金額・日付が前後1日以内の手入力の記録があれば、記録しない。同じ日に同額が2回あれば件数で数える
- レシートを後から登録するとき、同じ買い物のメール記録があれば、新しく作らずその記録に品目を反映する（「別の買い物」も選べる）
- 日付は、メール本文の「ご利用日時」（利用日）を使う。届く日が遅れても、重複の判定と記録の日付は利用日で行う
- 取消、買物以外（キャッシングなど）は自動では記録しない
- 取り込んだ目印を残すので、消した記録は再取り込みされない
- 設定の手順は、アプリの「設定 → メールから自動取り込み → 連携の準備をする」に書いてある
- JCBを足すときは、`Code.gs` の `ISSUERS` に送信元と読み取りの関数を足し、`python3 tools/make_gas_source.py` を実行する

## 個人情報の扱い
- カード番号・口座番号などは入力しない（長い数字を含む入力は登録できない）
- 記録はこの端末の中だけ。サーバーには送らない（メール連携を使う場合のみ、自分のGoogleアカウントの小さなプログラムに問い合わせる）

## アイコン
手描きのスケッチ（`tools/icon-source/original.jpg`：雲の上のブタの貯金箱と右上がりの矢印）を、背景が透明の平らな絵にして使っている。

- 作り方：濃い線だけを取り出して太さをそろえ、線で囲まれた面を1色ずつ塗る（鉛筆のハッチングやグラデーションはなし）。色は線と矢印の緑・雲のミント・ブタのピンク・コインの金
- 作り直し：`pip install pillow numpy scipy scikit-image` のあと `python3 tools/make_icons.py`。`icons/` に書き出す
- **どのアイコンも、背景は透過率100%（不透明度ちょうど0）**：`icons/icon-1024.png`（元データ）、`icon-512.png`・`icon-192.png`、`apple-touch-icon.png`（180px。ホーム画面用）、`favicon-32.png`。不透明な背景のアイコン（maskable）は置いていない
- iPhoneのホーム画面：ホーム画面に追加するときに使われるのは `apple-touch-icon.png`。iOSは、WebアプリのアイコンのうちRGBで透明な部分を、黒などの背景にして表示することがある。「クリア」の見た目はiOSがこのアイコンから作り、アプリ側では指定できない。背景が黒く見えて困るときは `python3 tools/make_icons.py --opaque-apple` で、ホーム画面用だけを淡い緑（#dcebe5）の不透明な背景にして作り直せる
- **使わなかった日の貯金箱はアプリアイコンの豚から作る**：カレンダー・凡例・日の画面の絵（`index.html` のスプライト `#i-saved`）は、アイコンの豚とコイン（雲と矢印は除く）をなぞって曲線にしたもの。線・豚・コインの3つの形で、色は `--ill-line` / `--ill-pig` / `--ill-coin`。作り直し：`python3 tools/make_saved_pig.py`（`pip install pillow numpy scipy scikit-image opencv-python-headless`）で `tools/icon-source/saved-pig.svg` ができるので、中身の `<symbol id="i-saved">…</symbol>` を `index.html` のスプライトと差し替える（アイコンを描き直したら、`make_icons.py` のあとにこれも実行する）

## コードの分け方（決まり）
読み込む順番は **core → ui → features → main**。下の層は、上の層を使わない。

| 層 | 置き場所 | 役割 | 決まり |
|---|---|---|---|
| core | `js/core/` | データと計算 | **画面（DOM）に触れない**。保存したあとの画面の更新は、`storage.js` の `onSaved` に `main.js` が入れた処理が行う |
| ui | `js/ui/` | 画面の部品（開閉・選択欄・スワイプ・一覧の行・入力欄） | 業務のルールを持たない。core は使ってよい |
| features | `js/features/` | 画面・機能ごと（1ファイル＝1画面または1機能） | 画面の描画と操作のつなぎだけ。ルールは core に置く |
| main | `js/main.js` | タブの切り替え・見えている画面だけを描く仕組み・起動・画面どうしをつなぐ操作 | 一番上 |

- 各ファイルの先頭に、**役割・依存・実行時・公開** を書く。`依存`＝先に読み込まれている必要があるファイル、`実行時`＝ボタンを押したときなど、実行中にだけ呼ぶファイル、`公開`＝他のファイルから使われる名前
- データの形・上限・初期値・読み込み時の点検は `js/core/model.js` だけに置く（保存データの形を変えるときは、`STATE_VERSION` を上げて `migrate()` で古い形を直す）
- 画面を使わない計算（日付・集計・請求・期間・メールの振り分け・レシートの解析）は core に置き、画面の処理は ui か features に置く
- **`python3 tools/check_structure.py` が、この決まりを検査する**（エラーが0であること）。検査する内容：
  - `js/` の全ファイルが `index.html` に書かれていること（逆も）
  - 先頭の説明があり、`依存` の順番どおりに読み込まれ、使っているファイルが `依存`／`実行時` に書かれていること
  - 下の層が上の層を使っていないこと／core が画面に触れていないこと
  - `公開` の名前が実在し、他のファイルから使われている名前が漏れなく書かれていること
  - 同じ名前を複数のファイルで定義していないこと
  - CSS で使う変数がすべて定義されていること（注意：使われていない class・変数・関数、重複した選択子）
  - 絵文字を使っていないこと（`index.html`・`js/`・`css/`・`Code.gs`。見つけたら「ファイル:行」つきでエラー）
  - `--report` をつけると、ファイル数・行数・重複・未使用の数を出す

## 見た目のルール
- **絵文字は使わない**。印や絵は、`index.html` の先頭にある SVG のスプライト（`<symbol id="i-…">`）に独自のイラストとして描き、`<svg class="…-ic" aria-hidden="true" focusable="false"><use href="#i-…"/></svg>` で置く（使わなかった日 `i-saved`、カード引き落とし `i-card`、投資 `i-up`）
- イラストは、平らな塗り＋深い緑の線だけ（影・グラデーション・動きはなし）。色は `css/base.css` の `--ill-*` の変数だけで決め、明るい設定・暗い設定の両方に値を書く。外部の画像・通信は使わない
- ✓ ✕ ‹ › ▼ ＋ ・ ¥ 〜 のような文字の記号は絵文字ではないので使ってよい。検査は `tools/check_structure.py`

## ファイル構成
```
index.html                    画面の骨組みと、script を読み込む順番
css/base.css                  色（明るい・暗い）・全体の土台・ヘッダー・画面の骨組み
css/calendar.css              カレンダー画面（1画面に収める調整を含む）
css/components.css            部品（切り替えボタン・カード・一覧の行・下のタブ・投資の画面・設定の項目）
css/forms.css                 重ねて開く画面・入力欄・ボタン・メッセージ・選択欄
js/core/util.js               日付・金額・文字の小さな関数
js/core/guard.js              カード番号のような長い数字を見つける
js/core/model.js              データの定義（形・上限・初期値・点検・読み込み時の整え）
js/core/sample.js             見本のデータ／見本を消す
js/core/billing.js            クレジットの締め日・引き落とし日の計算
js/core/stats.js              日付ごとの索引・使った金額・使わなかった日・投資資金の集計
js/core/period.js             週・月・年・期間指定の範囲の計算
js/core/mail-plan.js          メール明細の振り分け（追加・重複・取込済み・要確認）とレシートとの結び付け
js/core/receipt-parse.js      レシートの文字から品目・金額・日付を取り出す
js/core/storage.js            ブラウザの保存領域への読み書き
js/core/gas-source.js         （自動で作る）Code.gs の写し。直接は直さない
js/ui/dom.js                  要素の取得・選択欄の中身・切り替えボタンの表示
js/ui/overlay.js              重ねて開く画面の開閉・2回押しで確定・メッセージ・Escape
js/ui/picker.js               プルダウンの代わりの選択欄
js/ui/sheet-swipe.js          下へスワイプして画面を閉じる
js/ui/rows.js                 一覧の行（買い物・金額つきの行・「ありません」）
js/ui/range-input.js          開始日・終了日の入力欄（まとめと投資で共通）
js/features/calendar.js       カレンダー画面
js/features/day.js            日ごとの画面
js/features/edit.js           買い物の入力画面（メール記録との結び付けを含む）
js/features/receipt.js        レシートの写真の読み取り
js/features/invest.js          投資の画面と、投資の入力画面
js/features/summary.js        まとめ画面
js/features/settings.js       設定（1日あたりの金額・数え始める日・データを消す）
js/features/cards.js          クレジットカードの一覧・設定・次の引き落とし
js/features/mail.js           メール連携（通信・設定・確認の画面）
js/main.js                    タブ・描画の仕組み・日付の更新・起動
tools/build.py                動作確認用に1ファイルへまとめる
tools/check_structure.py      コードの分け方の検査
tools/apps-script/Code.gs     メールを読む、Googleアカウント内のプログラム
tools/make_gas_source.py      Code.gs をアプリ内の「スクリプトをコピー」用に写す
tools/make_icons.py           スケッチからアイコン一式を作る（元の絵は tools/icon-source/）
tools/make_saved_pig.py       アイコンの豚から、使わなかった日の貯金箱（saved-pig.svg）を作る
icons/, manifest.webmanifest  ホーム画面用のアイコンと設定
```

## 保存データの形
ブラウザの `localStorage`（キー `tameru-calendar-v1`。アプリ名を変えても変えない）に、JSONで1つ保存する。読み込むときは `model.js` の `normalize()` が点検し、壊れた項目は捨てる（知らない項目も保存されない）。

| 項目 | 内容 | 型 | 書くところ |
|---|---|---|---|
| `v` | 保存データの版 | 数 | model.js |
| `daily` | 使わなかった日1日あたりの投資資金（円） | 数（0〜1,000,000） | features/settings.js |
| `start` | 数え始める日 | `"YYYY-MM-DD"` | features/settings.js、core/sample.js |
| `sample` | 見本のデータか | 真偽 | core/sample.js |
| `cards[]` | カード：`name` 名前、`close` 締め日（0=月末）、`pay` 引き落とし日（0=月末）、`months` 引き落とし月（1=翌月・2=翌々月） | 配列（30件まで） | features/cards.js、core/mail-plan.js |
| `entries[]` | 買い物：`id`、`date`、`store`、`pay`（cash／code／credit）、`card`、`items[{n,p}]`、`total`、`src`（`"mail"`＝メール由来）、`rc`（レシートと結び付いたか） | 配列 | features/edit.js、core/mail-plan.js |
| `invests[]` | 投資：`id`、`date`、`amount`、`memo` | 配列 | features/invest.js |
| `mail` | メール連携：`url`、`token`（合言葉）、`auto`、`cards.smbc`（記録先のカード名）、`last`（前回の確認の時刻）、`lastNote`、`seen[]`（取り込み済みの目印。1,500件まで） | 辞書 | features/mail.js、core/mail-plan.js |

## カード会社を足すとき（メール連携）
1. `tools/apps-script/Code.gs` の `ISSUERS` に、送信元・検索条件・読み取りの関数を足す（`id` を決める）
2. `python3 tools/make_gas_source.py` を実行して、アプリ内の写しを更新する
3. `js/core/mail-plan.js` の `MAIL_ISSUERS` に、同じ `id` で名前（`name`）と、カード名に含まれる言葉（`hint`）を足す
4. `js/core/model.js` の `normMail` の `cards` に、`id` の項目を足し、`features/mail.js` の設定画面に、記録先のカードの選択欄を足す
5. `python3 tools/check_structure.py` と試験を実行する

## つかいかた（作業用）
- 公開：リポジトリをそのまま GitHub Pages に置く（ビルド不要）
- `python3 tools/build.py` … 動作確認用に、`dist/preview.html` へ1ファイルにまとめる（`--fragment` で共有ページ用の形）
- `python3 tools/check_structure.py [--report]` … コードの分け方の検査
- `python3 tools/make_gas_source.py` … `Code.gs` を直したあとに実行
- `python3 tools/make_icons.py [--opaque-apple]` … アイコンの作り直し
- `python3 tools/make_saved_pig.py` … 使わなかった日の貯金箱の作り直し

## 電池への配慮（すべてのコードに適用する決まり）
- 定期的に動くタイマーを置かない。日付が変わったときの更新は、次の0時に1回だけ動くタイマー（画面が見えていない間は止める）
- 見えていない画面は描かない（開いたときに描く）。記録が変わっていない更新では、画面を描き直さない
- 通信は、アプリを開いたとき・戻ったときだけ。30分以内は調べず、失敗したあとは10分あけ、設定の誤りは直るまで自動では繰り返さない。オフライン時・データ節約中は通信しない
- 指の動きの処理は、スクロールを止めない設定（passive）にする。動かすのは transform と opacity だけ
- 画像の読み取りは、画像を小さくしてから行い、終わったら作業用の部品と画像をすぐ解放する。進み具合の表示は5%ごと
- 保存は、変更があったときだけ。起動時に書き込まない（初回の確認を除く）
- 外部の読み込みは、文字のフォント1つだけ（2種類の太さ）
- 画面の動きは短く、「動きを減らす」設定のときは止める。ダークモードに対応（有機ELの電池を節約）
