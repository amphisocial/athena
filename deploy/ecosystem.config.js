const path = require('path');

const appRoot = path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'athenabot',
      script: './server.js',
      cwd: appRoot,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      // .env is loaded by dotenv from the app root by server.js.
      max_memory_restart: '200M',
      autorestart: true,
      watch: false,
      out_file: '/home/ubuntu/.pm2/logs/athenabot-out.log',
      error_file: '/home/ubuntu/.pm2/logs/athenabot-error.log',
      time: true,
    },
  ],
};
