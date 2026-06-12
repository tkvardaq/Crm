import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { Queue } from "bullmq";
import express from "express";
import { QueueName } from "@crm/shared";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const PORT = parseInt(process.env.BULL_BOARD_PORT || "3010", 10);

function parseConnectionOpts() {
	try {
		const u = new URL(REDIS_URL);
		return {
			host: u.hostname || "localhost",
			port: Number(u.port) || 6379,
			password: u.password || undefined,
		};
	} catch {
		return { host: "localhost", port: 6379, password: undefined };
	}
}

const connectionOptions = parseConnectionOpts();

let queues: Queue[] = [];

function getQueues() {
	if (queues.length === 0) {
		queues = Object.values(QueueName).map(
			(name) => new Queue(name, { connection: connectionOptions })
		);
	}
	return queues;
}

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/");

createBullBoard({
	queues: getQueues().map((q) => new BullMQAdapter(q)),
	serverAdapter,
});

const app = express();

app.use("/", (req, res, next) => {
  const secret = process.env.BULL_BOARD_SECRET;
  if (secret) {
    const valid = req.headers["x-bull-board-secret"] === secret;
    if (!valid) {
      res.setHeader("WWW-Authenticate", "Basic");
      return res.status(401).send("Unauthorized");
    }
  }
  next();
});

app.use("/", serverAdapter.getRouter());

const server = app.listen(PORT, () => {
  console.log(`[bull-board] Running at http://localhost:${PORT}`);
});

async function shutdown() {
  console.log("[bull-board] Shutting down...");
  await Promise.all(getQueues().map((q) => q.close()));
  await new Promise<void>((res) => server.close(() => res()));
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
