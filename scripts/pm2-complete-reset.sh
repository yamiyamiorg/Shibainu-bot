#!/bin/bash
# scripts/pm2-complete-reset.sh
# PM2を完全にリセットしてBotを再起動するスクリプト

set -e

echo "🛑 PM2 Complete Reset Script"
echo "=============================="
echo ""

# カレントディレクトリを確認
if [ ! -f "package.json" ]; then
  echo "❌ Error: Run this script from the project root directory"
  exit 1
fi

echo "📍 Step 1: Stopping PM2..."
pm2 stop yamichan-bot 2>/dev/null || echo "  (process not running)"
pm2 delete yamichan-bot 2>/dev/null || echo "  (process not found)"

echo ""
echo "🧹 Step 2: Cleaning PM2 cache..."
pm2 flush
rm -rf ~/.pm2/logs/* 2>/dev/null || true
rm -rf ~/.pm2/pids/* 2>/dev/null || true

echo ""
echo "🔄 Step 3: Restarting PM2 daemon..."
pm2 kill
sleep 2
pm2 ping

echo ""
echo "🗑️  Step 4: Cleaning Node.js cache..."
rm -rf node_modules/
rm -f package-lock.json

echo ""
echo "📦 Step 5: Installing dependencies..."
npm install

echo ""
echo "🔧 Step 6: Checking configuration files..."

# .env check
if [ ! -f ".env" ]; then
  echo "❌ .env file not found!"
  exit 1
fi
echo "✅ .env exists"

# GEMINI_API_KEY check
if grep -q "GEMINI_API_KEY=" .env; then
  echo "✅ GEMINI_API_KEY found in .env"
else
  echo "⚠️  GEMINI_API_KEY not found in .env"
fi

# features.conf check
if [ ! -f "features.conf" ]; then
  echo "❌ features.conf not found!"
  exit 1
fi
echo "✅ features.conf exists"

# Check if welcome is enabled
if grep -q "^welcome=true" features.conf; then
  echo "✅ Welcome feature is enabled"
else
  echo "⚠️  Welcome feature is not enabled in features.conf"
fi

# Fix line endings
echo ""
echo "🔧 Step 7: Fixing line endings..."
sed -i 's/\r$//' .env 2>/dev/null || true
sed -i 's/\r$//' features.conf 2>/dev/null || true

echo ""
echo "📁 Step 8: Checking permissions..."
chmod 600 .env
chmod 644 features.conf
chmod 755 data 2>/dev/null || mkdir -p data
chmod 644 data/*.sqlite 2>/dev/null || true

echo ""
echo "🚀 Step 9: Starting with PM2..."
pm2 start ecosystem.config.js

echo ""
echo "⏳ Waiting for bot to initialize..."
sleep 5

echo ""
echo "📊 Step 10: Checking status..."
pm2 status

echo ""
echo "📋 Checking logs for Welcome feature..."
echo "======================================"
pm2 logs yamichan-bot --lines 30 --nostream | grep -E "(feature|welcome)" || echo "No welcome logs found yet"

echo ""
echo "✅ Reset complete!"
echo ""
echo "Next steps:"
echo "1. Monitor logs: pm2 logs yamichan-bot"
echo "2. Check features loaded: pm2 logs yamichan-bot | grep bot.features"
echo "3. Test in Discord: Send 'はじめまして' in test channel"
echo ""
