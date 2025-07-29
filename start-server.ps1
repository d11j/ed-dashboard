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

Write-Host "サーバーを起動しています... (停止するには Ctrl+C を押してください)" -ForegroundColor Green
# package.jsonのstartスクリプトを実行
npm start