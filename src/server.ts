import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { createServer } from "http";
import dotenv from "dotenv";
dotenv.config();

import authRoutes from "./routes/auth";
import notificationRoutes from "./routes/notifications";
import taskRoutes from "./routes/tasks";
import roomRoutes from "./routes/rooms";
import pomodoroRoutes from "./routes/pomodoro";
import syncRoutes from "./routes/sync";
import leaderboardRoutes from "./routes/leaderboard";
import userRoutes from "./routes/users";
import { setupSocketServer } from "./socket/index";

const fastify = Fastify({ logger: { level: process.env.NODE_ENV === "production" ? "warn" : "info" } });

async function start() {
  await fastify.register(cors, { origin: "*" });
  await fastify.register(helmet);
  await fastify.register(jwt, { secret: process.env.JWT_SECRET || "dev-secret-change-in-production" });
  await fastify.register(rateLimit, { max: 100, timeWindow: "1 minute" });

  fastify.get("/health", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

  await fastify.register(authRoutes);
  await fastify.register(taskRoutes);
  await fastify.register(roomRoutes);
  await fastify.register(pomodoroRoutes);
  await fastify.register(syncRoutes);
  await fastify.register(leaderboardRoutes);
  await fastify.register(userRoutes);

  const httpServer = createServer(fastify.server);
  setupSocketServer(httpServer);

  const PORT = parseInt(process.env.PORT || "3000");
  httpServer.listen(PORT, "0.0.0.0", () => {
    fastify.log.info(`StudySync backend running on port ${PORT}`);
  });
}

start().catch((err) => { console.error(err); process.exit(1); });
