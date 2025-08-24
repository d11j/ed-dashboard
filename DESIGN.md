# ED Dashboard

設計資料本資料は、Elite: Dangerous リアルタイムダッシュボードのソフトウェアアーキテクチャ、主要なプロセス、およびAPI仕様の概要を記述する。

## 1. アーキテクチャ概要

本システムは、複数の独立したモジュールで構成されている。

- `server.js`: アプリケーションの中央コントローラーとなる。責務を以下に示す。
  - ExpressサーバーとWebSocketサーバーの起動。
  - 他のすべてのモジュールの初期化と連携。
  - クライアントとのWebSocket接続の管理。
  - OBS WebSocketサーバーとの通信のハンドリング。
  - `JournalProcessor`から発行されるイベント（`update`, `logUpdate`など）をリッスンし、整形済みデータをクライアントにブロードキャストする。
- `src/journalProcessor.js`: アプリケーションのコアロジックモジュールとなる。クラスとして実装されており、ジャーナル処理に関連するすべてのロジックをカプセル化している。責務を以下に示す。
  - `chokidar` を用いたElite: Dangerousのジャーナルディレクトリのファイル変更監視。
  - ジャーナルエントリと Status.json をパースし、アプリケーションの状態を更新。
  - 内部的な状態フラグ（例：戦闘状態、着陸シーケンス）の管理。
  - `EventEmitter`を継承し、状態変更があった際に`update`や`logUpdate`といったイベントを発行（emit）して外部に通知する。
- `src/constants.js`: アプリケーション全体で利用される定数をエクスポートするモジュールとなる。これには以下が含まれる。
  - PORT などのサーバー設定。
  - パイロットのランク定義（FED_RANKS, COMBAT_RANKS など）といった静的なゲームデータ。
- `public/`: クライアントサイドのすべての静的アセットを格納するディレクトリ。
  - `index.html`: UIの主要な構造。
  - `assets/style.css`: UIのスタイル。
  - `assets/script.js`: WebSocket通信と動的なDOM操作のためのクライアントサイドロジック。

## 2. 主要なシーケンス

システム内の主要な相互作用フローを示す。

### ジャーナルファイル変更シーケンス

ジャーナルファイルの変更がUIにリアルタイム更新される流れを以下のシーケンス図に示す。
#processJournalLine は、イベントの種類に応じて #eventHandlers マップから適切な状態更新メソッドを呼び出す。同時に、ロギングメソッド #logEvent を呼び出し、イベントログに記録すべきかどうかの判断を委譲するディスパッチャとして機能する。
```plantuml
@startuml
!theme plain
title ジャーナルファイル変更シーケンス

participant "クライアント (ブラウザ)" as Client
participant "server.js" as Server
participant "JournalProcessor.js\n(EventEmitter)" as Processor

Server -> Processor: .on('update', ...)
Server -> Processor: .on('logUpdate', ...)

Processor -> Processor: onFileChange()
activate Processor
Processor -> Processor: #processFile()
Processor -> Processor: #processJournalLine(line)

group 状態更新処理
    Processor -> Processor: #eventHandlers[event].call()
    note right of Processor: イベントに応じた #handle...() を実行し、\nstateを更新する
    Processor ->> Server: emit('update', state)
    Server -> Server: makePayload(state)
    note right of Server: 派生データ(効率指標)を計算し、\nstateを更新する
    Server -> Client: broadcast(full_update)
end

group イベントログ記録処理
    Processor -> Processor: #logEvent(entry)
    note right of Processor: ログ記録対象のイベントか\n内部のswitchで判断する
    alt ログ対象イベントの場合
        Processor ->> Server: emit('logUpdate', eventLog)
        Server -> Client: broadcast(log_update)
    end
end

deactivate Processor
@enduml
```

### OBS録画状態変更シーケンス

OBSの録画イベントが処理されUIに反映される流れを以下のシーケンス図に示す。

```plantuml
@startuml
!theme plain
title OBS録画状態変更シーケンス

participant "クライアント (ブラウザ)" as Client
participant "server.js" as Server
participant "JournalProcessor.js\n(EventEmitter)" as Processor
participant "OBS WebSocket" as OBS

Server -> Processor: .on('sessionEnd', ...)

OBS ->> Server: on(RecordStateChanged)
Server -> Client: broadcast(obs_recording_state)
Server -> Processor: setRecordingState(isRecording, timestamp)
activate Processor
Processor -> Processor: #logEvent()
Processor ->> Server: emit('logUpdate', eventLog)

deactivate Processor
Server -> Client: broadcast(log_update)

alt セッション終了時
Processor ->> Server: emit('sessionEnd')
Server -> OBS: StopRecord

end
@enduml
```

### レイアウト変更シーケンス

あるクライアントでカードの並び順変更が行われた場合のシーケンス図を示す。

```plantuml
@startuml
!theme plain
title レイアウト変更シーケンス

participant "クライアント (ブラウザ)" as Client
participant "server.js" as Server
participant "他のクライアント" as OtherClient

Client -> Client: D&Dでレイアウト変更
Client -> Server: レイアウト情報
activate Server
Server -> Server: レイアウト情報を保持
Server -> OtherClient: broadcast(レイアウト情報)
deactivate Server
@enduml
```

## 3. 状態遷移

`JournalProcessor`は、ジャーナルファイルに記録される**イベント**と、`Status.json`に記録されるリアルタイムな**状態**の2つの情報源を基に、プレイヤーの状態を管理する。

ジャーナルが「撃破」「ジャンプ完了」といった完了済みのイベントを記録するのに対し、`Status.json`は「ハードポイント展開中」「ランディングギア下降中」といった**継続的な状態**をリアルタイムに反映する。これにより、ジャーナルだけでは検知できない文脈（例: 戦闘の開始）を捉えることが可能となる。

主要な状態と、その遷移トリガーを以下に示す。

- **飛行中 (`InFlight`)**:
  - `Status.json`のフラグ変更 (`Hardpoints Deployed`) により **戦闘中** 状態へ移行する。
  - `Status.json`のフラグ変更 (`Landing Gear Down`) により **着陸シーケンス** 状態へ移行する。
  - `DockingGranted` (ジャーナルイベント) により **着陸シーケンス** 状態へ移行する。
- **戦闘中 (`Combat`)**:
  - `Status.json`のフラグ変更 (`Hardpoints Retracted`) により **飛行中** 状態へ移行する。
- **着陸シーケンス (`LandingSequence`)**:
  - `Status.json`のフラグ変更 (`Landing Gear Up`) により **飛行中** 状態へ移行する。
  - `DockingCancelled` (ジャーナルイベント) により **飛行中** 状態へ移行する。
  - `Docked`または`Touchdown` (ジャーナルイベント) により **着艦 / 着陸** 状態へ移行する。
- **着艦 / 着陸 (`Landed`)**:
  - `Undocked`または`Liftoff` (ジャーナルイベント) により **飛行中** 状態へ移行する。

## 4. WebSocket API仕様

本セクションでは、サーバーとクライアント間のWebSocket通信に関する仕様を定義する。

### 4.1. メッセージフォーマット
すべてのメッセージは、以下の構造を持つJSON文字列として送信される。

```
{
  "type": "message_type",
  "payload": { ... }
}
```
- type: (String) メッセージの種別。
- payload: (Object) メッセージに関連付けられたデータ。

## 4.2. サーバーからクライアントへのメッセージ

サーバーからクライアントへ送信されるメッセージ。

| 種別| 説明| ペイロード例 | 
|:--- |:---|:---|
| full_update | 最新の統計情報をすべて送信する。クライアントの初回接続時や状態リセット後に送信される。| `{ "bounty": { "count": 10, ... }, ... }` |
| log_update | 更新されたイベントログの配列を送信する。| `["[00:00:00] -- 録画開始 --"]`|
| obs_recording_state | OBSの録画ステータスの変更をクライアントに通知する。 | `{ "isRecording": true }`| 
| layout_apply | レイアウトの更新を通知する。 | `{'left-column': ['rank-progression', ...], 'right-column': ['combat', ...]}` |

### 4.3. クライアントからサーバーへのメッセージ

クライアントからサーバーへ送信されるメッセージ。

| 種別 | 説明 | ペイロード |
|:--- |:---|:---|
| reset_stats | サーバーにすべての統計データのリセットを要求する。 | `null` |
| start_obs_recording | サーバーにOBSの録画開始を要求する。 | `null` |
| stop_obs_recording | サーバーにOBSの録画停止を要求する。 | `null` |
| layout_update | レイアウトの変更をサーバに通知する。 | `{'left-column': ['rank-progression', ...], 'right-column': ['combat', ...]}` |