import {
  routes,
  setSessionReady,
  V1Request,
  V1ResponseSessions,
  V1ResponseSolution,
} from "./controllers/v1";
import log from "./services/log";
import { testWebBrowserInstallation } from "./services/sessions";

const app = require("./app");
const version: string = "v" + require("../package.json").version;
const serverPort: number = Number(process.env.PORT) || 8191;
const serverHost: string = process.env.HOST || "0.0.0.0";
const session: string = process.env.FLARESOLVERR_SESSION || "sess";
const targetHosts: string = process.env.TARGET_HOSTS; // Should be comma-separated hosts list, no whitespace

const maxTimeout: number = 120000;

function validateEnvironmentVariables() {
  // ip and port variables are validated by nodejs
  if (
    process.env.LOG_LEVEL &&
    ["error", "warn", "info", "verbose", "debug"].indexOf(
      process.env.LOG_LEVEL
    ) == -1
  ) {
    log.error(
      `The environment variable 'LOG_LEVEL' is wrong. Check the documentation.`
    );
    process.exit(1);
  }
  if (
    process.env.LOG_HTML &&
    ["true", "false"].indexOf(process.env.LOG_HTML) == -1
  ) {
    log.error(
      `The environment variable 'LOG_HTML' is wrong. Check the documentation.`
    );
    process.exit(1);
  }
  if (
    process.env.HEADLESS &&
    ["true", "false"].indexOf(process.env.HEADLESS) == -1
  ) {
    log.error(
      `The environment variable 'HEADLESS' is wrong. Check the documentation.`
    );
    process.exit(1);
  }
  if (!targetHosts) {
    log.error(
      "The environment variable `TARGET_HOSTS` is wrong. Check the fork."
    );
    process.exit(1);
  }
  // todo: fix resolvers
  // try {
  //   getCaptchaSolver();
  // } catch (e) {
  //   log.error(`The environment variable 'CAPTCHA_SOLVER' is wrong. ${e.message}`);
  //   process.exit(1);
  // }
}

const os = require("os");
const memoryDiffMBRestart = 800 * 1024 * 1024; // Tune this
let memorySnapshot: number = undefined;

function memWatchdog() {
  const freeMem = os.freemem();
  console.log(`Snapshot: ${memorySnapshot / 1024 / 1024}MB, free memory: ${freeMem / 1024 / 1024}MB`);
  if (memorySnapshot === undefined) {
    memorySnapshot = freeMem;
  } else if ((memorySnapshot - freeMem) > (memoryDiffMBRestart)) {
    process.exit(1);
  }
  setTimeout(memWatchdog, 5000);
}

async function keepAlive() {
  console.log("Triggering keep-alive session creation.");
  const response: V1ResponseSessions = {
    sessions: [],
    status: "",
    message: "",
    startTimestamp: 0,
    endTimestamp: 0,
    version: "",
  };
  await routes["sessions.list"](
    {
      cmd: "sessions.list",
      session: session,
      maxTimeout: maxTimeout,
    },
    response
  );
  if (!response.sessions.includes(session)) {
    console.log(`Sessions list doesn't include target: ${session}`);
    let success: boolean = false;
    for (let i = 0; i < 10 && !success; i++) {
      try {
        await routes["sessions.create"](
          {
            cmd: "sessions.create",
            session: session,
            maxTimeout: maxTimeout,
          },
          {
            status: "",
            message: "",
            startTimestamp: 0,
            endTimestamp: 0,
            version: "",
          }
        );
        success = true;
      } catch (e) {
        console.log(e);
      }
    }
    if (!success) {
      // Failed
      process.exit(1);
    }
    console.log(`Successfully created session: ${session}`);
  } else {
    console.log("Session is valid.");
  }
  setTimeout(warmCache, 0);
  setTimeout(keepAlive, 40000);
}

async function warmCache() {
  for (const host of targetHosts.split(",")) {
    console.log(`Warming cache of ${host}`);
    const r: (a: V1Request, b: any) => Promise<void> = routes["request.get"];
    const warmingResponse: V1ResponseSolution = {
      solution: undefined,
      status: "",
      message: "",
      startTimestamp: 0,
      endTimestamp: 0,
      version: "",
    };
    await r(
      {
        cmd: "request.get",
        session: session,
        url: host,
        maxTimeout: maxTimeout,
      },
      warmingResponse
    );
    if (warmingResponse.status !== "ok") {
      console.error(`Failed to warm cache for ${host}`);
    } else {
      console.log(`Warmed cache of ${host}`);
    }
  }
  console.log("Cache warmed.");
  setSessionReady(true);
}

// Init
log.info(`FlareSolverr ${version}`);
log.debug("Debug log enabled");

process.on("SIGTERM", () => {
  // Capture signal on Docker Stop #158
  log.info("Process interrupted");
  process.exit(0);
});

process.on("uncaughtException", function (err) {
  // Avoid crashing in NodeJS 17 due to UnhandledPromiseRejectionWarning: Unhandled promise rejection.
  log.error(err);
});

validateEnvironmentVariables();

testWebBrowserInstallation()
  .then(async () => {
    // Start server
    await keepAlive();
    memWatchdog();
    app.listen(serverPort, serverHost, () => {
      log.info(`Listening on http://${serverHost}:${serverPort}`);
    });
  })
  .catch(function (e) {
    log.error(e);
    const msg: string = "" + e;
    if (msg.includes("while trying to connect to the browser!")) {
      log.error(`It seems that the system is too slow to run FlareSolverr. 
    If you are running with Docker, try to remove CPU limits in the container. 
    If not, try setting the 'BROWSER_TIMEOUT' environment variable and the 'maxTimeout' parameter to higher values.`);
    }
    process.exit(1);
  });
