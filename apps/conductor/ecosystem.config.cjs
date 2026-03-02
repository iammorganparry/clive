// pm2 deployment configuration for the Conductor
module.exports = {
  apps: [{
    name: "conductor",
    script: "src/index.ts",
    interpreter: "tsx",
    cwd: "/Users/morganparry/repos/clive/apps/conductor",
    env: {
      CONDUCTOR_PORT: 3847,
      CONDUCTOR_MAX_AGENTS: 3,
      CONDUCTOR_WORKSPACE: "/Users/morganparry/repos/clive",
      NODE_ENV: "production",
    },
    max_restarts: 10,
    restart_delay: 5000,
    log_date_format: "YYYY-MM-DD HH:mm:ss",
  }],
};
