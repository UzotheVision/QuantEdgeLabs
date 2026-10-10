/**
 * PM2 process file — the production shape the code already expects:
 * web.js (HTTP + WS + light scanners) and worker.js (all generators,
 * scanners, bots, crons; exits at 4:10 PM ET and PM2 restarts it).
 *
 *   npm ci --include=dev && npm run build
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup     # survive reboots
 */
module.exports = {
  apps: [
    {
      name: 'quantedge-web',
      script: 'dist/web.js',
      env: { NODE_ENV: 'production', PORT: 3000 },
      max_memory_restart: '900M',
      autorestart: true,
      time: true,
    },
    {
      name: 'quantedge-worker',
      script: 'dist/worker.js',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '1800M',
      autorestart: true,   // the 4:10 PM ET self-exit relies on this restart
      time: true,
    },
  ],
};
