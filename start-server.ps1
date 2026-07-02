<#
.SYNOPSIS
    Elite: Dangerous ダッシュボードのNode.jsサーバーを起動します。

.DESCRIPTION
    このスクリプトは、まず Node.js がインストールされているかチェックし、
    なければ winget を使って自動インストールを試みます。
    その後、'npm install' を実行して依存関係をインストールし、
    'npm start' を使ってサーバーを起動します。
    .envファイルから設定が自動的に読み込まれます。
#>

# コンソール出力を UTF-8 に設定
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Node.js (node) および npm コマンドの存在チェック
$hasNode = Get-Command "node" -ErrorAction SilentlyContinue
$hasNpm = Get-Command "npm" -ErrorAction SilentlyContinue

if (-not $hasNode -or -not $hasNpm) {
    Write-Host "Node.js がインストールされていないか、環境変数 PATH に登録されていません。" -ForegroundColor Yellow
    Write-Host "本ツールの実行には Node.js が必要です。" -ForegroundColor Yellow
    Write-Host "Windows Package Manager (winget) を使用して Node.js (LTS) をインストールしますか？ (Y/N)" -ForegroundColor Cyan
    
    $choice = Read-Host
    if ($choice -eq 'Y' -or $choice -eq 'y') {
        Write-Host "Node.js (LTS) のインストーラーを起動しています..." -ForegroundColor Green
        # winget で Node.js LTS を通常インストール (対話型)
        winget install -e --id OpenJS.NodeJS.LTS
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "--------------------------------------------------" -ForegroundColor Green
            Write-Host "Node.js のインストールプロセスが終了しました。" -ForegroundColor Green
            Write-Host "新しくインストールされた Node.js の環境変数を反映するため、" -ForegroundColor Yellow
            Write-Host "このウィンドウを一度閉じ、新しく「PowerShellで実行」し直してください。" -ForegroundColor Yellow
            Write-Host "--------------------------------------------------" -ForegroundColor Green
        }
        else {
            Write-Host "winget によるインストールに失敗したか、キャンセルされました (エラーコード: $LASTEXITCODE)。" -ForegroundColor Red
            Write-Host "公式ウェブサイト (https://nodejs.org/) から LTS 版をダウンロードして手動でインストールしてください。" -ForegroundColor Yellow
        }
        Read-Host "Enterキーを押して終了します..."
        exit
    }
    else {
        Write-Host "インストールがキャンセルされました。手動で Node.js をインストールしてから再実行してください。" -ForegroundColor Red
        Read-Host "Enterキーを押して終了します..."
        exit
    }
}

Write-Host "依存関係をインストールしています..." -ForegroundColor Green
npm install

if (-not (Test-Path -Path '.env')) {
    Copy-Item -Path '.env.example' -Destination '.env'
    Write-Host ".envファイルを作成しました。" -ForegroundColor Green
    Write-Host "必要に応じて .env ファイルを編集して OBS_WEBSOCKET_PASSWORD を設定してください。" -ForegroundColor Yellow
}

Write-Host "サーバーを起動しています... (停止するには Ctrl+C を押してください)" -ForegroundColor Green
# package.jsonのstartスクリプトを実行
npm start