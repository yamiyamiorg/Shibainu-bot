#!/bin/bash
# scripts/fix-dependencies.sh
# better-sqlite3インストール問題を修正

set -e

echo "🔧 Fixing dependencies..."
echo ""

# カレントディレクトリを確認
if [ ! -f "package.json" ]; then
  echo "❌ Error: Run this script from the project root directory"
  exit 1
fi

echo "📦 Step 1: Checking current dependencies..."
if npm list better-sqlite3 >/dev/null 2>&1; then
  echo "   ✅ better-sqlite3 is already installed"
  VERSION=$(npm list better-sqlite3 | grep better-sqlite3 | awk '{print $2}')
  echo "   Version: $VERSION"
else
  echo "   ❌ better-sqlite3 is NOT installed"
fi
echo ""

echo "🗑️  Step 2: Cleaning old installations..."
rm -rf node_modules/better-sqlite3 2>/dev/null || true
echo "   ✅ Cleaned"
echo ""

echo "📥 Step 3: Installing better-sqlite3..."
npm install better-sqlite3
echo "   ✅ Installed"
echo ""

echo "✅ Step 4: Verifying installation..."
if npm list better-sqlite3 >/dev/null 2>&1; then
  VERSION=$(npm list better-sqlite3 | grep better-sqlite3 | awk '{print $2}')
  echo "   ✅ better-sqlite3 $VERSION is now installed"
else
  echo "   ❌ Installation failed!"
  exit 1
fi
echo ""

echo "🔄 Step 5: Restarting PM2..."
if pm2 list | grep -q "yamichan-bot"; then
  pm2 restart yamichan-bot
  echo "   ✅ PM2 restarted"
else
  echo "   ⚠️  PM2 process not running"
  echo "   Run: pm2 start ecosystem.config.js"
fi
echo ""

echo "📊 Step 6: Checking logs..."
sleep 3
if pm2 list | grep -q "yamichan-bot"; then
  echo "   Recent logs:"
  pm2 logs yamichan-bot --nostream --lines 10 | grep -E "(welcome|error|Error)" || echo "   No errors found"
else
  echo "   Process not running"
fi
echo ""

echo "✅ Fix complete!"
echo ""
echo "Next steps:"
echo "1. Check logs: pm2 logs yamichan-bot"
echo "2. Verify Welcome: pm2 logs yamichan-bot | grep welcome.feature.setup"
echo "3. Test in Discord"
echo ""
