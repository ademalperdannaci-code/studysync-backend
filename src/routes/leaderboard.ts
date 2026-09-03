import { FastifyInstance } from "fastify";
import { authenticate } from "../middleware/auth";
import redis from "../lib/redis";
import prisma from "../lib/prisma";

function getWeekKey(): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const week = Math.floor((now.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${now.getFullYear()}-W${week}`;
}

export default async function leaderboardRoutes(fastify: FastifyInstance) {
  fastify.get("/leaderboard", { preHandler: authenticate }, async (request, reply) => {
    const { scope = "alltime", limit = "20" } = request.query as { scope?: string; limit?: string };
    const key = scope === "week" ? `leaderboard:week:${getWeekKey()}` : "leaderboard:alltime";
    const top = await redis.zrevrangebyscore(key, "+inf", "-inf", "WITHSCORES", "LIMIT", 0, parseInt(limit));

    const entries: Array<{ userId: string; xp: number; rank: number }> = [];
    for (let i = 0; i < top.length; i += 2) {
      entries.push({ userId: top[i], xp: parseInt(top[i + 1]), rank: Math.floor(i / 2) + 1 });
    }

    const users = await prisma.user.findMany({
      where: { id: { in: entries.map((e) => e.userId) } },
      select: { id: true, username: true, avatarUrl: true, level: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));
    const result = entries.map((e) => ({ ...e, user: userMap.get(e.userId) }));

    const myRank = await redis.zrevrank(key, request.user.userId);
    const myScore = await redis.zscore(key, request.user.userId);

    return reply.send({ success: true, data: { entries: result, myRank: myRank !== null ? myRank + 1 : null, myScore: myScore ? parseInt(myScore) : 0 } });
  });
}
