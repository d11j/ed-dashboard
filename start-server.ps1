<#
.SYNOPSIS
    Elite: Dangerous ダッシュボードのNode.jsサーバーを起動します。

.DESCRIPTION
    このスクリプトは、まず 'npm install' を実行して依存関係をインストールし、
    次に 'npm start' を使ってサーバーを起動します。
#>

Write-Host "依存関係をインストールしています..." -ForegroundColor Green
npm install

Write-Host "サーバーを起動しています... (停止するには Ctrl+C を押してください)" -ForegroundColor Green
npm start

