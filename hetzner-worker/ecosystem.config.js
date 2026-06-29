// pm2 ecosystem config — run: pm2 start ecosystem.config.js
const fs = require('fs')
const path = require('path')

// Load the worker's real secrets from /app/.env.production and inject them into
// pm2's `env` block. These live in a file (NOT in git) because the Hetzner box
// has no other env source — and relying on the launching shell's environment is
// unreliable: the pm2 daemon spawns apps with its own env, so sourcing the file
// in the deploy script before `pm2 start` did NOT reach the worker (every tick
// threw "SUPABASE_URL: MISSING"). Parsing the file here makes the env
// deterministic regardless of how pm2 is invoked. Plain parser (no dotenv dep):
// KEY=VALUE per line, `export ` prefix and surrounding quotes tolerated.
function loadEnvFile(p) {
  const out = {}
  let raw
  try {
    raw = fs.readFileSync(p, 'utf8')
  } catch {
    return out // file absent (e.g. local dev) — fall back to the static env block
  }
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*?)\s*$/)
    if (!m) continue // comments / blanks
    let v = m[2]
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    out[m[1]] = v
  }
  return out
}

const fileEnv = loadEnvFile(path.join(__dirname, '..', '.env.production'))

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
      // Secrets from /app/.env.production first, then pin the worker-runtime
      // vars so they win regardless of what the file carries.
      env: {
        ...fileEnv,
        NODE_ENV: 'production',
        CAMPAIGN_TICK_MS: fileEnv.CAMPAIGN_TICK_MS || '30000',
        SMS_AI_ENABLED: fileEnv.SMS_AI_ENABLED || 'true',
        // Accept the Supabase URL under either name — sibling apps store it as
        // SUPABASE_URL, the worker reads NEXT_PUBLIC_SUPABASE_URL. Mirror both.
        NEXT_PUBLIC_SUPABASE_URL:
          fileEnv.NEXT_PUBLIC_SUPABASE_URL || fileEnv.SUPABASE_URL || '',
        SUPABASE_URL: fileEnv.SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL || '',
      },
      // Log rotation
      error_file: 'logs/campaign-worker-error.log',
      out_file: 'logs/campaign-worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
}
