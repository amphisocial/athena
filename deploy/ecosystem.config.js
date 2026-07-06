module.exports = {
  apps: [
    {
      name: 'athenabot',
      script: './server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      // .env is loaded by dotenv inside server.js itself — PM2 doesn't need
      // to know the SMTP values, it just needs to keep the process alive.
      max_memory_restart: '200M',
      autorestart: true,
      watch: false,
      out_file: '/home/ubuntu/.pm2/logs/athenabot-out.log',
      error_file: '/home/ubuntu/.pm2/logs/athenabot-error.log',
      time: true,
    },
  ],
};
