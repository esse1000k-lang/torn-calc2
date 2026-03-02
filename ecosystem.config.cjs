/**
 * PM2 설정 — 서버 크래시 시 자동 재시작
 * 사용: npx pm2 start ecosystem.config.cjs
 * 중지: npx pm2 stop tornfi-community
 * 재시작: npx pm2 restart tornfi-community
 * 로그: npx pm2 logs tornfi-community
 */
module.exports = {
  apps: [
    {
      name: 'tornfi-community',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: { NODE_ENV: 'development' },
      env_production: { NODE_ENV: 'production' },
    },
  ],
};
