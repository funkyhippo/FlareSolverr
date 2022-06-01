module.exports = {
  apps: [
    {
      name: "flaresolverr",
      script: "server.js",
      cwd: "./dist",
      max_memory_restart: "480M",
      env: {
        NODE_ENV: "development",
        FLARESOLVERR_SESSION: "sess",
      },
      env_production: {
        NODE_ENV: "production",
        FLARESOLVERR_SESSION: "sess",
      },
    },
  ],
};
