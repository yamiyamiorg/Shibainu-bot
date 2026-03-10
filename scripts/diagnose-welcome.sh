#!/bin/bash
# scripts/diagnose-welcome.sh
# Welcome機能が動作しない原因を診断するスクリプト

echo "🔍 Welcome Feature Diagnostic Script"
echo "====================================="
echo ""

# カレントディレクトリを確認
if [ ! -f "package.json" ]; then
  echo "❌ Error: Run this script from the project root directory"
  exit 1
fi

ISSUES=0

echo "📋 Diagnostic Report"
echo "===================="
echo ""

# 1. PM2 Status
echo "1️⃣  PM2 Status:"
if pm2 list | grep -q "yamichan-bot"; then
  STATUS=$(pm2 list | grep yamichan-bot | awk '{print $10}')
  echo "   ✅ Process found (status: $STATUS)"
else
  echo "   ❌ Process not found"
  ISSUES=$((ISSUES + 1))
fi
echo ""

# 2. Features Config
echo "2️⃣  features.conf:"
if [ -f "features.conf" ]; then
  echo "   ✅ File exists"
  if grep -q "^welcome=true" features.conf; then
    ENV=$(grep "^welcome=" features.conf | cut -d':' -f2)
    echo "   ✅ Welcome enabled (env: ${ENV:-default})"
  else
    echo "   ❌ Welcome is disabled or not found"
    ISSUES=$((ISSUES + 1))
  fi
else
  echo "   ❌ features.conf not found"
  ISSUES=$((ISSUES + 1))
fi
echo ""

# 3. Environment Variables
echo "3️⃣  Environment Variables:"
if [ -f ".env" ]; then
  echo "   ✅ .env file exists"
  if grep -q "GEMINI_API_KEY=" .env; then
    echo "   ✅ GEMINI_API_KEY found"
  else
    echo "   ⚠️  GEMINI_API_KEY not found"
    ISSUES=$((ISSUES + 1))
  fi
else
  echo "   ❌ .env file not found"
  ISSUES=$((ISSUES + 1))
fi
echo ""

# 4. PM2 Logs - Feature Loading
echo "4️⃣  Feature Loading (from logs):"
if pm2 list | grep -q "yamichan-bot"; then
  FEATURES=$(pm2 logs yamichan-bot --nostream --lines 500 | grep "bot.features.loaded" | tail -1)
  if [ -n "$FEATURES" ]; then
    echo "   Found: $FEATURES"
    if echo "$FEATURES" | grep -q "welcome"; then
      echo "   ✅ Welcome feature is loaded"
    else
      echo "   ❌ Welcome feature is NOT loaded"
      ISSUES=$((ISSUES + 1))
    fi
  else
    echo "   ⚠️  No feature loading log found"
  fi
else
  echo "   ⚠️  Process not running"
fi
echo ""

# 5. Welcome Setup Log
echo "5️⃣  Welcome Setup (from logs):"
if pm2 list | grep -q "yamichan-bot"; then
  SETUP=$(pm2 logs yamichan-bot --nostream --lines 500 | grep "welcome.feature.setup" | tail -1)
  if [ -n "$SETUP" ]; then
    echo "   ✅ Found: $SETUP"
  else
    echo "   ❌ Welcome setup log not found"
    ISSUES=$((ISSUES + 1))
  fi
else
  echo "   ⚠️  Process not running"
fi
echo ""

# 6. Database
echo "6️⃣  Database:"
if [ -d "data" ]; then
  echo "   ✅ data/ directory exists"
  if [ -f "data/welcome.sqlite" ]; then
    SIZE=$(stat -f%z "data/welcome.sqlite" 2>/dev/null || stat -c%s "data/welcome.sqlite" 2>/dev/null)
    echo "   ✅ welcome.sqlite exists (size: $SIZE bytes)"
  else
    echo "   ⚠️  welcome.sqlite not found (will be created on first use)"
  fi
else
  echo "   ❌ data/ directory not found"
  ISSUES=$((ISSUES + 1))
fi
echo ""

# 7. Node Modules
echo "7️⃣  Dependencies:"
if [ -d "node_modules" ]; then
  echo "   ✅ node_modules/ exists"
  if [ -d "node_modules/@google/generative-ai" ]; then
    echo "   ✅ @google/generative-ai installed"
  else
    echo "   ❌ @google/generative-ai not found"
    ISSUES=$((ISSUES + 1))
  fi
else
  echo "   ❌ node_modules/ not found"
  ISSUES=$((ISSUES + 1))
fi
echo ""

# 8. Message Event Listeners
echo "8️⃣  Event Listeners Test:"
LISTENER_TEST=$(node -e "
const { loadFeatureConfig } = require('./src/utils/featureConfig');
const config = loadFeatureConfig();
console.log('Welcome enabled:', config.welcome ? config.welcome.enabled : false);
" 2>&1)
echo "   $LISTENER_TEST"
echo ""

# 9. Recent Welcome Logs
echo "9️⃣  Recent Welcome Activity (last 10 logs):"
if pm2 list | grep -q "yamichan-bot"; then
  RECENT=$(pm2 logs yamichan-bot --nostream --lines 200 | grep "welcome\." | tail -10)
  if [ -n "$RECENT" ]; then
    echo "$RECENT" | while read line; do
      echo "   $line"
    done
  else
    echo "   ⚠️  No recent welcome activity"
  fi
else
  echo "   ⚠️  Process not running"
fi
echo ""

# Summary
echo "======================================"
echo "📊 Summary"
echo "======================================"
if [ $ISSUES -eq 0 ]; then
  echo "✅ No critical issues found!"
  echo ""
  echo "If Welcome feature still doesn't work:"
  echo "1. Try: ./scripts/pm2-complete-reset.sh"
  echo "2. Check Discord Developer Portal: Server Members Intent"
  echo "3. Verify channel IDs in logs match your test channel"
else
  echo "⚠️  Found $ISSUES issue(s)"
  echo ""
  echo "Recommended actions:"
  if ! pm2 list | grep -q "yamichan-bot"; then
    echo "1. Start the bot: pm2 start ecosystem.config.js"
  fi
  if ! grep -q "^welcome=true" features.conf 2>/dev/null; then
    echo "2. Enable welcome in features.conf"
  fi
  if ! grep -q "GEMINI_API_KEY=" .env 2>/dev/null; then
    echo "3. Add GEMINI_API_KEY to .env"
  fi
  echo "4. Run complete reset: ./scripts/pm2-complete-reset.sh"
fi
echo ""
