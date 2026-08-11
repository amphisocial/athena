// PM2 process definition for Boardsy at athenabot.ai.
// Keeps the SAME pm2 instance name ("athenabot") and path (/opt/apps/athena)
// that currently host the homepage, so nothing about the process changes on EC2.
//   pm2 start deploy/ecosystem.config.js && pm2 save
const path = require('path');
const appRoot = path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'athenabot',
      script: './server.js',
      cwd: appRoot,               // /opt/apps/athena on EC2
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '250M',
      autorestart: true,
      watch: false,
      time: true
    }
  ]
};
