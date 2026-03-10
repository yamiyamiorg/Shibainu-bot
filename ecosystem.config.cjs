// ecosystem.config.js
require('dotenv').config(); // 追加: PM2起動時に.envを読み込む

module.exports = {
  apps: [{
    name: 'yamichan-bot',
    script: './src/index.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      // .envの内容を明示的に渡す
      ...process.env
    },
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    listen_timeout: 3000,
    kill_timeout: 5000,
    wait_ready: false,
    // Graceful shutdown
    shutdown_with_message: true
  }]
};
