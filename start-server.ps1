<#
.SYNOPSIS
    Elite: Dangerous �_�b�V���{�[�h��Node.js�T�[�o�[���N�����܂��B

.DESCRIPTION
    ���̃X�N���v�g�́A�܂� 'npm install' �����s���Ĉˑ��֌W���C���X�g�[�����A
    ���� 'npm start' ���g���ăT�[�o�[���N�����܂��B
    .env�t�@�C������ݒ肪�����I�ɓǂݍ��܂�܂��B
#>

Write-Host "�ˑ��֌W���C���X�g�[�����Ă��܂�..." -ForegroundColor Green
npm install

Write-Host "�T�[�o�[���N�����Ă��܂�... (��~����ɂ� Ctrl+C �������Ă�������)" -ForegroundColor Green
# package.json��start�X�N���v�g�����s
npm start