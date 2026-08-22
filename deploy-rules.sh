#!/usr/bin/env bash
# Firestore 보안 규칙 게시 스크립트
#   사용법:  bash deploy-rules.sh
# 콘솔에 직접 붙여넣지 않고 firestore.rules 파일을 그대로 배포합니다.
set -e

echo "▶ Firestore 규칙을 배포합니다 (프로젝트: web-schedule-fe24a)"

if ! command -v firebase >/dev/null 2>&1; then
  echo "· Firebase CLI 설치 중..."
  npm install -g firebase-tools
fi

# 로그인 여부 확인 (미로그인 시 브라우저가 열립니다)
if ! firebase projects:list >/dev/null 2>&1; then
  echo "· 로그인이 필요합니다. 브라우저가 열리면 구글 계정으로 로그인하세요."
  firebase login
fi

firebase deploy --only firestore:rules

echo "✅ 규칙 배포 완료. 콘솔에서 붙여넣기할 필요 없습니다."
