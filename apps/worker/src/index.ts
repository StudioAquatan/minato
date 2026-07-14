import { bootstrap } from "./bootstrap.js";
import { runWorker } from "./loop.js";

const main = async () => {
  const runtime = await bootstrap();
  const workerId = process.env.WORKER_ID ?? `worker-${process.pid}`;
  const lanes = (process.env.WORKER_LANES ?? "default,parse,index,embed")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const pollMs = Number(process.env.WORKER_POLL_MS ?? 1000);
  const heartbeatMs = Number(process.env.WORKER_HEARTBEAT_MS ?? 5000);
  const staleAfterMs = Number(process.env.WORKER_STALE_MS ?? 60_000);

  const controller = new AbortController();
  const shutdown = () => {
    console.log("shutting down worker...");
    controller.abort();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(
    `worker=${workerId} lanes=${lanes.join(",")} db=${runtime.config.databaseUrl.replace(/:\/\/[^@]+@/, "://***@")}`,
  );

  try {
    await runWorker(
      runtime.deps,
      { workerId, lanes, pollMs, heartbeatMs, staleAfterMs },
      controller.signal,
    );
  } finally {
    await runtime.close();
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
