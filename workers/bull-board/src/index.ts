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

import basicAuth from "express-basic-auth";

const boardUser = process.env.BULL_BOARD_USER;
const boardPass = process.env.BULL_BOARD_PASS;

if (!boardUser || !boardPass) {
  throw new Error("[bull-board] BULL_BOARD_USER and BULL_BOARD_PASS environment variables must be set. The board is unprotected.");
} else {
  app.use(
    basicAuth({
      users: { [boardUser]: boardPass },
      challenge: true,
      realm: "CRM Bull Board",
    })
  );
}

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
