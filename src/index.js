import express from "express";
import bodyParser from "body-parser";
import { Octokit } from "@octokit/rest";
import { verifyWebhookSignature } from "@hygraph/utils";
import debounce from "lodash.debounce";
import Statsig from "statsig-node";
import * as Sentry from "@sentry/node";

const STATSIG_SECRET_KEY = process.env.STATSIG_SECRET_KEY;
const APP_ENVIRONMENT = process.env.APP_ENVIRONMENT || "production";
const HYGRAPH_SECRET_BYPASS = process.env.HYGRAPH_SECRET_BYPASS;
const secret = process.env.HYGRAPH_SECRET;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const SENTRY_DSN = process.env.SENTRY_DSN;

Sentry.init({
  dsn: SENTRY_DSN,
  // Setting this option to true will send default PII data to Sentry.
  // For example, automatic IP address collection on events
  sendDefaultPii: true,
  environment: process.env.APP_ENVIRONMENT || "production",
});

const app = express();
app.use(bodyParser.json());
const user = { userID: "yummy-release-service" };

const octokit = new Octokit({
  auth: GITHUB_TOKEN,
});

const triggerRelease = debounce(async () => {
  try {
    await octokit.rest.actions.createWorkflowDispatch({
      owner: "yummy-recipes",
      repo: "yummy-next",
      workflow_id: "deploy.yml",
      ref: "master",
    });
    Statsig.logEvent(user, "succeed release_webhook_trigger");
  } catch (e) {
    Statsig.logEvent(user, "failed release_webhook_trigger", {
      reason: "exception",
    });
    Sentry.captureException(e);
    console.error(e);
  }
}, 30000);

app.get("/", (req, res) => {
  res.send("OK");
  Statsig.logEvent(user, "succeed release_webhook_healthcheck");
});

app.post("/", (req, res) => {
  const body = req.body || {};
  const signature = req.headers["gcms-signature"] || "";

  let isValid = false;
  try {
    isValid = Boolean(HYGRAPH_SECRET_BYPASS)
      ? true
      : verifyWebhookSignature({ body, signature, secret });
  } catch (e) {
    Statsig.logEvent(user, "failed release_webhook_verification", {
      reason: "exception",
    });
    Sentry.captureException(e);
    console.error(e);
  }

  if (!isValid) {
    Statsig.logEvent(user, "failed release_webhook_verification", {
      reason: "invalid_signature",
    });
    return res.status(401).send("Invalid signature");
  }

  triggerRelease();
  Statsig.logEvent(user, "started release_webhook_trigger");
  res.send("OK");
});

const port = process.env.PORT || 3000;

await Statsig.initialize(
  STATSIG_SECRET_KEY,
  { environment: { tier: APP_ENVIRONMENT } } // optional, if not set, for >v6.0.0, sdk will default to be production
);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
