import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';

import { authRoutes } from './routes/auth.routes';
import { notificationRoutes } from './routes/notification.routes';
import { taskRoutes } from './routes/task.routes';
import { roomRoutes } from './routes/room.routes';
import { pomodoroRoutes } from './routes/pomodoro.routes';
import { syncRoutes } from './routes/sync.routes';
import { leaderboardRoutes } from './routes/leaderboard.routes';
import { userRoutes } from './routes/user.routes';
import { setupSocketServer } from './websocket';

const fastify = Fastify({
  logger: true,
});

const start = async () => {
  try {
    await fastify.register(cors, { origin: '*' });
    await fastify.register(helmet);
    await fastify.register(jwt, {
      secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    });
    await fastify.register(rateLimit, { max: 100, timeWindow: '1 minute' });

    fastify.get('/health', async () => ({
      status: 'ok',
      timestamp: new Date().toISOString(),
    }));

    await fastify.register(authRoutes);
    await fastify.register(notificationRoutes);
    await fastify.register(taskRoutes);
    await fastify.register(roomRoutes);
    await fastify.register(pomodoroRoutes);
    await fastify.register(syncRoutes);
    await fastify.register(leaderboardRoutes);
    await fastify.register(userRoutes);

    setupSocketServer(fastify.server);

    const PORT = Number(process.env.PORT) || 3000;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`StudySync running on 0.0.0.0:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
