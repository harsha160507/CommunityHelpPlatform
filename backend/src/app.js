"use strict";
const express = require("express"),
  helmet = require("helmet"),
  { rateLimit } = require("express-rate-limit"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { authentication, wrap } = require("./middleware"),
  { collection } = require("./pagination");
const v = require("./validation"),
  { publicEligibility } = require("./services");
function createApp({ pool, config, rateLimits = true, logger = console }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use(
    helmet({
      strictTransportSecurity: config.production ? undefined : false,
      contentSecurityPolicy: {
        directives: {
          "upgrade-insecure-requests": config.production ? [] : null,
        },
      },
    }),
  );
  app.use((req, res, next) => {
    const started = Date.now();
    res.setHeader("X-Request-Id", crypto.randomUUID());
    res.on("finish", () =>
      logger.info(
        JSON.stringify({
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - started,
        }),
      ),
    );
    next();
  });
  app.use(express.json({ limit: "32kb" }));
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.headers.origin &&
      req.headers.origin !== config.baseUrl
    )
      return next(
        new v.HttpError(403, "Use the configured application origin."),
      );
    if (
      !["GET", "HEAD"].includes(req.method) &&
      (req.body === null ||
        typeof req.body !== "object" ||
        Array.isArray(req.body))
    )
      return next(new v.HttpError(400, "Request body must be a JSON object."));
    next();
  });
  const limit = (windowMs, max) =>
    rateLimits
      ? rateLimit({
          windowMs,
          limit: max,
          standardHeaders: "draft-8",
          legacyHeaders: false,
          handler: (req, res) =>
            res
              .status(429)
              .json({ message: "Too many attempts. Please try again later." }),
        })
      : (req, res, next) => next();
  const auth = authentication(pool);
  const deps = {
    pool,
    config,
    auth,
    authLimit: limit(15 * 60 * 1000, 20),
    mailLimit: limit(60 * 60 * 1000, 10),
    registerLimit: limit(60 * 60 * 1000, 5),
  };
  app.get("/health/live", (req, res) => res.json({ status: "live" }));
  app.get(
    "/health/ready",
    wrap(async (req, res) => {
      try {
        await pool
          .query(
            "SELECT name FROM chp_schema_migrations WHERE name='003_services.sql'",
          )
          .then(([rows]) => {
            if (!rows.length) throw new Error("Schema not ready");
          });
        res.json({ status: "ready" });
      } catch {
        res.status(503).json({ status: "not_ready" });
      }
    }),
  );
  app.get("/api/config", (req, res) =>
    res.json({
      timezone: config.timezone,
      pollSeconds: 30,
      developmentMailPreview: config.preview,
    }),
  );
  app.get(
    "/api/stats",
    wrap(async (req, res) => {
      const [date, time] = v.cutoff(config.timezone);
      const [[counts]] = await pool.query(
        "SELECT (SELECT COUNT(*) FROM chp_users WHERE role='volunteer' AND disabled=0 AND email_verified=1) AS volunteers,(SELECT COUNT(*) FROM chp_users WHERE role='ngo' AND status='approved' AND disabled=0) AS ngos,(SELECT COUNT(*) FROM chp_events e JOIN chp_users u ON u.id=e.ngo_id WHERE " +
          publicEligibility() +
          ") AS events",
        [date, date, time],
      );
      res.json(counts);
    }),
  );
  app.get(
    "/api/ngos",
    wrap(async (req, res) =>
      collection(pool, req, res, {
        select:
          "SELECT id,name,location,description FROM chp_users WHERE role='ngo' AND status='approved' AND disabled=0 ORDER BY name,id",
        count:
          "SELECT COUNT(*) AS total FROM chp_users WHERE role='ngo' AND status='approved' AND disabled=0",
        key: "ngos",
      }),
    ),
  );
  app.get(
    "/api/activity",
    auth,
    wrap(async (req, res) =>
      collection(pool, req, res, {
        select:
          "SELECT id,message,created_at FROM chp_notifications WHERE user_id=? ORDER BY id DESC",
        count:
          "SELECT COUNT(*) AS total FROM chp_notifications WHERE user_id=?",
        params: [req.user.id],
        key: "activity",
      }),
    ),
  );
  app.use("/api/auth", require("./routes/auth")(deps));
  app.use("/api/admin", require("./routes/admin")(deps));
  app.use("/api/events", require("./routes/events")(deps));
  app.use("/api/volunteers", require("./routes/volunteers")(deps));
  app.use("/api", (req, res) =>
    res.status(404).json({ message: "API route not found." }),
  );
  app.use(
    express.static(path.join(__dirname, "../../frontend"), {
      dotfiles: "deny",
      index: "index.html",
      maxAge: 0,
    }),
  );
  app.use((req, res) => res.status(404).send("Page not found."));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    let status = error.status || 500,
      message = error.message;
    if (error.code === "ER_DUP_ENTRY") {
      status = 409;
      message = "This email or registration already exists.";
    }
    if (["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error.code)) {
      status = 409;
      message = "Another change is in progress. Please retry.";
    }
    if (status >= 500) {
      logger.error(
        JSON.stringify({
          requestId: res.getHeader("X-Request-Id"),
          code: error.code || "INTERNAL_ERROR",
        }),
      );
      message = "The request could not be completed. Please try again.";
    }
    if (error.type === "entity.parse.failed") {
      status = 400;
      message = "Request body must be valid JSON.";
    }
    res.status(status).json({ message });
  });
  return app;
}
module.exports = { createApp };
