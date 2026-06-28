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
      // Safety net: restart gracefully if RSS creeps toward the box's RAM,
      // BEFORE V8 hits its ~2GB heap limit and dies with an uncatchable
      // "FATAL ERROR: Reached heap limit" (which stalled the worker for ~11h
      // on 2026-06-27). The Pinnacle sync now streams page-by-page so it
      // shouldn't get here, but this bounds the blast radius if anything else
      // leaks. 1200M leaves headroom on a 2GB CX11.
      max_memory_restart: '1200M',
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
