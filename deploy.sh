
  --no-commands          Discordコマンド登録をスキップ
  --no-restart           既存プロセスを再起動しない（新規起動のみ）
  --db-init              DB初期化を実行（失敗しても継続）
  --pm2-startup          pm2 startup + pm2 save を実行
  --dry-run              実行内容を表示するだけ

Examples:
  ./deploy.sh                    # 通常のデプロイ（再起動含む）
  ./deploy.sh --no-restart       # 新規起動のみ
  ./deploy.sh --no-commands      # コマンド登録なし
EOF
}

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[DRY] $*"
    return 0
  fi
  eval "$@"
}

#========================
# .env を安全に読む
#========================
load_env() {
  local file="$1"
  [[ -f "$file" ]] || error_exit ".envファイルが見つかりません: $file"

  info "環境変数を読み込み中: $file"

  local loaded_count=0

  # shellcheck disable=SC2162
  while IFS= read -r line || [[ -n "$line" ]]; do
    # コメント/空行スキップ
    [[ -z "${line//[[:space:]]/}" ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue

    # export を許容
    line="${line#export }"

    # KEY=VALUE 以外は無視
    if [[ "$line" != *"="* ]]; then
      continue
    fi

    local key="${line%%=*}"
    local val="${line#*=}"

    # 前後空白除去
    key="$(echo "$key" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    val="$(echo "$val" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

    # KEY の妥当性
    if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      continue
    fi

    # 値の外側のクォートを剥がす
    if [[ "$val" =~ ^\".*\"$ ]]; then
      val="${val:1:${#val}-2}"
    elif [[ "$val" =~ ^\'.*\'$ ]]; then
      val="${val:1:${#val}-2}"
    fi

    export "$key=$val"
    ((loaded_count++))
  done < "$file"

  info "環境変数を${loaded_count}個読み込みました"
  
  if [[ "$loaded_count" -eq 0 ]]; then
    warn ".envから環境変数が読み込まれませんでした（空のファイルの可能性）"
  fi
}

#========================
# Node / npm / pm2チェック
#========================
check_node() {
  info "Node.jsバージョンをチェック中..."
  command -v node >/dev/null 2>&1 || error_exit "Node.jsがインストールされていません"
  local node_version
  node_version="$(node -v)"
  info "Node.js: $node_version"

  local major
  major="$(echo "$node_version" | sed 's/^v//' | cut -d'.' -f1)"
  if [[ "$major" -lt 16 ]]; then
    warn "Node.js v16以上推奨（現在: $node_version）"
  fi
}

check_pm2() {
  info "PM2をチェック中..."
  if ! command -v pm2 >/dev/null 2>&1; then
    error_exit "PM2がインストールされていません。先に: npm i -g pm2"
  fi
  info "PM2: v$(pm2 -v)"
}

#========================
# ecosystem.config.jsの削除
#========================
remove_old_ecosystem() {
  if [[ -f "ecosystem.config.js" ]]; then
    warn "ecosystem.config.js が見つかりました（.cjsと競合するため削除します）"
    run "rm -f ecosystem.config.js"
    info "ecosystem.config.js を削除しました"
  fi
}

#========================
# features.confのチェック
#========================
check_features_conf() {
  if [[ ! -f "features.conf" ]]; then
    warn "features.conf が見つかりません"
    return 0
  fi

  # Nukumori機能のチェック
  if grep -q "^nukumori=true" features.conf; then
    warn "features.confでNukumori機能が有効になっています"
    warn "共同開発を前提に一時凍結を推奨（nukumori=false）"
  fi
}

#========================
# 依存関係インストール
#========================
install_deps() {
  [[ "$DO_INSTALL_DEPS" -eq 1 ]] || { info "依存関係インストールをスキップ"; return 0; }

  info "依存関係をインストール中..."
  if [[ -f "package-lock.json" ]]; then
    run "npm ci"
  else
    run "npm install"
  fi
  info "依存関係のインストール完了"
}

#========================
# 必須環境変数チェック
#========================
check_env() {
  info "必須環境変数をチェック中..."

  [[ -n "${DISCORD_TOKEN:-}" ]] || error_exit "DISCORD_TOKEN が設定されていません（.envを確認）"

  if [[ -z "${CLIENT_ID:-}" ]]; then
    warn "CLIENT_ID が未設定です（コマンド登録を行う場合は設定してください）"
  fi

  info "環境変数チェック完了"
}

#========================
# ディレクトリ作成
#========================
create_dirs() {
  info "必要なディレクトリを作成中..."
  run "mkdir -p logs data"

  if [[ ! -d "images" ]]; then
    warn "./images が存在しません（画像機能を使うなら配置してください）"
  fi

  info "ディレクトリ作成完了"
}

#========================
# DB初期化（任意）
#========================
init_db() {
  [[ "$DO_DB_INIT" -eq 1 ]] || { info "DB初期化をスキップ"; return 0; }

  if npm run | grep -qE 'db:init'; then
    info "DB初期化を実行します（失敗しても継続）..."
    set +e
    run "npm run db:init"
    local rc=$?
    set -e
    if [[ $rc -ne 0 ]]; then
      warn "DB初期化に失敗しました（既に初期化済み/パス不備の可能性）"
    else
      info "DB初期化完了"
    fi
  else
    warn "npm run db:init が見つからないためスキップします"
  fi
}

#========================
# Discordコマンド登録
#========================
deploy_commands() {
  [[ "$DO_DEPLOY_COMMANDS" -eq 1 ]] || { info "コマンド登録をスキップ"; return 0; }

  if [[ -z "${CLIENT_ID:-}" ]]; then
    warn "CLIENT_ID 未設定のため、コマンド登録をスキップします"
    return 0
  fi

  if npm run | grep -qE 'deploy:commands'; then
    info "Discordコマンドを登録中..."
    run "npm run deploy:commands"
    info "コマンド登録完了"
  else
    warn "npm run deploy:commands が見つからないためスキップします"
  fi
}

#========================
# 起動入口の自動判別
#========================
detect_entry() {
  if [[ -f "ecosystem.config.cjs" ]]; then
    echo "ecosystem.config.cjs"
    return 0
  fi
  if [[ -f "src/index.js" ]]; then
    echo "src/index.js"
    return 0
  fi
  if [[ -f "index.js" ]]; then
    echo "index.js"
    return 0
  fi
  error_exit "起動入口が見つかりません（ecosystem.config.cjs / src/index.js / index.js が必要）"
}

#========================
# PM2起動/再起動
#========================
start_pm2() {
  info "PM2でボットを起動/更新中..."

  local entry
  entry="$(detect_entry)"
  info "起動入口: $entry"

  # 既存プロセス判定
  if pm2 list | grep -qE "\\b${APP_NAME}\\b"; then
    if [[ "$DO_RESTART" -eq 1 ]]; then
      info "既存プロセスを再起動します: $APP_NAME"
      run "pm2 reload \"$APP_NAME\" --update-env"
      info "PM2で再起動しました: $APP_NAME"
    else
      info "既存プロセスが存在します（再起動なし）: $APP_NAME"
    fi
  else
    # 新規起動
    if [[ "$entry" == "ecosystem.config.cjs" ]]; then
      run "pm2 start ecosystem.config.cjs"
    else
      run "pm2 start \"$entry\" --name \"$APP_NAME\""
    fi
    info "PM2で起動しました: $APP_NAME"
  fi
}

#========================
# PM2 startup（明示時のみ）
#========================
setup_pm2_startup() {
  [[ "$DO_PM2_STARTUP" -eq 1 ]] || { info "PM2 startup 設定をスキップ"; return 0; }

  info "PM2の自動起動を設定します（sudoが必要になる可能性あり）..."
  run "pm2 startup"
  run "pm2 save"
  info "PM2の自動起動設定完了"
}

#========================
# 引数解析
#========================
while [[ $# -gt 0 ]]; do
  case "$1" in
    --workdir) WORKDIR="$2"; shift 2 ;;
    --env) ENV_FILE="$2"; shift 2 ;;
    --name) APP_NAME="$2"; shift 2 ;;
    --no-install) DO_INSTALL_DEPS=0; shift ;;
    --no-commands) DO_DEPLOY_COMMANDS=0; shift ;;
    --no-restart) DO_RESTART=0; shift ;;
    --db-init) DO_DB_INIT=1; shift ;;
    --pm2-startup) DO_PM2_STARTUP=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) error_exit "不明なオプション: $1（--help を参照）" ;;
  esac
done

#========================
# メイン
#========================
echo "========================================="
echo "やみちゃんBot デプロイスクリプト"
echo "========================================="

# ディレクトリ移動
cd "$WORKDIR" || error_exit "workdirに移動できません: $WORKDIR"
info "作業ディレクトリ: $(pwd)"

check_node
check_pm2
remove_old_ecosystem
load_env "$ENV_FILE"
check_env
check_features_conf
install_deps
create_dirs
init_db
deploy_commands
start_pm2

# pm2 save（現在の状態を保存）
run "pm2 save"

# startup は明示フラグ時のみ
setup_pm2_startup

echo ""
echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}デプロイ完了！${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""
info "ステータス確認: pm2 status"
info "ログ確認: pm2 logs $APP_NAME --lines 100"
info "再起動: pm2 reload $APP_NAME"
info "停止: pm2 stop $APP_NAME"
echo ""
