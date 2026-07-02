<#
.SYNOPSIS
    Elite: Dangerous ダッシュボードのNode.jsサーバーを起動します。

.DESCRIPTION
    このスクリプトは、まず 'npm install' を実行して依存関係をインストールし、
    次に 'npm start' を使ってサーバーを起動します。
    .envファイルから設定が自動的に読み込まれます。
#>

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