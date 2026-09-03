import { FastifyInstance } from "fastify";
import { z } from "zod";
import prisma from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { awardXP } from "../services/gamificationService";
import { updateStreak } from "../services/streakService";

const sessionSchema = z.object({
  roomId: z.string().uuid().optional(),
  topicId: z.string().uuid().optional(),
  workMinutes: z.number().int().positive().default(25),
  breakMinutes: z.number().int().positive().default(5),
  cyclesCompleted: z.number().int().nonnegative().default(1),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
});

export default async function pomodoroRoutes(fastify: FastifyInstance) {
  fastify.post("/pomodoro/sessions", { preHandler: authenticate }, async (request, reply) => {
    const body = sessionSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.issues });

    const session = await prisma.pomodoroSession.create({
      data: {
        ...body.data,
        userId: request.user.userId,
        startedAt: new Date(body.data.startedAt),
        endedAt: body.data.endedAt ? new Date(body.data.endedAt) : undefined,
      },
    });

    await prisma.user.update({
      where: { id: request.user.userId },
      data: { totalStudyMinutes: { increment: body.data.workMinutes * body.data.cyclesCompleted } },
    });

    const streakDays = await updateStreak(request.user.userId);
    const gamification = await awardXP({ type: "POMODORO_COMPLETE", userId: request.user.userId });
    if (streakDays > 1) {
      const streakResult = await awardXP({ type: "STREAK_DAY", userId: request.user.userId });
      gamification.xp += streakResult.xp;
      gamification.newBadges.push(...streakResult.newBadges);
    }

    return reply.status(201).send({ success: true, data: session, gamification, streakDays });
  });

  fastify.get("/pomodoro/sessions", { preHandler: authenticate }, async (request, reply) => {
    const { limit = "20", offset = "0" } = request.query as { limit?: string; offset?: string };
    const sessions = await prisma.pomodoroSession.findMany({
      where: { userId: request.user.userId },
      orderBy: { startedAt: "desc" },
      take: parseInt(limit),
      skip: parseInt(offset),
      include: { topic: { select: { title: true } } },
    });
    return reply.send({ success: true, data: sessions });
  });
}
