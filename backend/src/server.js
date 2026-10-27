"use strict";
const { configuration } = require("./config"),
  { createPool } = require("./db"),
  { createApp } = require("./app"),
  { mailWorker } = require("./mail");
async function start() {
  const config = configuration(),
    pool = createPool();
  try {
    const [migrations] = await pool.query(
      "SELECT name FROM chp_schema_migrations",
    );
    if (
      !require("../scripts/migrate").migrations.every((name) =>
        migrations.some((row) => row.name === name),
      )
    )
      throw new Error("Run npm run migrate before starting.");
    const app = createApp({ pool, config }),
      worker = mailWorker(pool, config);
    const timer = setInterval(() => worker.tick(), 10000);
    timer.unref();
    const server = app.listen(
      config.port,
      process.env.HOST || "127.0.0.1",
      () =>
        console.log("Community Help Platform listening on port " + config.port),
    );
    server.on("error", (error) => {
      console.error(error.message);
      clearInterval(timer);
      worker.close();
      pool.end();
      process.exitCode = 1;
    });
    let closing = false;
    const close = () => {
      if (closing) return;
      closing = true;
      clearInterval(timer);
      worker.close();
      const deadline = setTimeout(() => process.exit(1), 20000);
      deadline.unref();
      server.close(async () => {
        await pool.end();
        clearTimeout(deadline);
      });
    };
    process.on("SIGTERM", close);
    process.on("SIGINT", close);
    return { server, pool };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
if (require.main === module)
  start().catch((error) => {
    console.error("Startup failed: " + error.message);
    process.exitCode = 1;
  });
module.exports = { start };
