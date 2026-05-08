// pm2 ecosystem config — run: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'campaign-worker',
      script: 'hetzner-worker/index.ts',
      interpreter: 'tsx',
      // Restart if it crashes — back off up to 30s between restarts
      restart_delay: 5000,
      max_restarts: 20,
      min_uptime: '10s',
      // Env vars (override with .env or set directly in Hetzner)
      env: {
        NODE_ENV: 'production',
        CAMPAIGN_TICK_MS: '30000',
      },
      // Log rotation
      error_file: 'logs/campaign-worker-error.log',
      out_file: 'logs/campaign-worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
}
