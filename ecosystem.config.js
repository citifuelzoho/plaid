module.exports = {
  apps: [
    {
      name: "plaid",
      script: "./src/server.js",
      cwd: "/var/www/plaid-idv",

      instances: 1,
      exec_mode: "fork",

      env_production: {
        NODE_ENV: "production",
        PORT: 3000
      },

      autorestart: true,
      watch: false,
      max_memory_restart: "500M"
    }
  ]
};