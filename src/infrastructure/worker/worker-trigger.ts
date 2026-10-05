import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { logger } from "../../utils/logger";

// On AWS Lambda the worker does not poll. The API starts it when work is queued, and
// each run processes every waiting job before it stops. Without WORKER_FUNCTION_NAME
// (local development) these calls do nothing and the polling worker picks jobs up.
const lambda = env.WORKER_FUNCTION_NAME ? new LambdaClient({}) : undefined;
const RECOVERY_CHECK_INTERVAL_MS = 60_000;
const QUEUED_GRACE_MS = 30_000;
let lastRecoveryCheck = 0;

export async function startWorker() {
  if (!lambda) return;
  try {
    // A non-HTTP payload, so the worker's Lambda Web Adapter delivers it to /events.
    await lambda.send(new InvokeCommand({ FunctionName: env.WORKER_FUNCTION_NAME, InvocationType: "Event",
      Payload: new TextEncoder().encode(JSON.stringify({ source: "aevora-api", reason: "pipeline-job-queued" })) }));
  } catch (error) {
    // The job stays queued; startWorkerIfWorkIsWaiting retries while the ad is open.
    logger.error("Unable to start the pipeline worker.", error);
  }
}

/** Restarts the worker when a job missed its start or its worker stopped mid-run (for example a Lambda timeout). */
export async function startWorkerIfWorkIsWaiting(adId: string) {
  if (!lambda || Date.now() - lastRecoveryCheck < RECOVERY_CHECK_INTERVAL_MS) return;
  lastRecoveryCheck = Date.now();
  const now = new Date();
  try {
    const waiting = await prisma.pipelineJob.count({
      where: {
        adId,
        cancelRequestedAt: null,
        OR: [
          { status: "QUEUED", updatedAt: { lt: new Date(now.getTime() - QUEUED_GRACE_MS) } },
          { status: "RUNNING", leaseExpiresAt: { lt: now } },
        ],
      },
    });
    if (waiting) await startWorker();
  } catch (error) {
    // A recovery check must never fail the request that triggered it.
    logger.error("Unable to check for waiting pipeline jobs.", error);
  }
}
