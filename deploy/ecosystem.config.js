// PM2 process definition for the full product at athenabot.ai.
// Keeps the SAME pm2 instance name ("athenabot") and path (/opt/apps/athena)
// that host the site today, so nothing about the process identity changes.
//   pm2 start deploy/ecosystem.config.js && pm2 save
const path = require('path');
const appRoot = path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'athenabot',
      script: 'server/server.js',
      cwd: appRoot,                 // /opt/apps/athena on EC2
      instances: 1,
      exec_mode: 'fork',            // single instance: in-memory WS board state + rate maps
      env: { NODE_ENV: 'production' },
      max_memory_restart: '500M',
      autorestart: true,
      watch: false,
      time: true
    }
  ]
};
