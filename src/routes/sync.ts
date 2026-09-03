import { FastifyInstance } from "fastify";
import { authenticate } from "../middleware/auth";
import prisma from "../lib/prisma";

export default async function syncRoutes(fastify: FastifyInstance) {
  fastify.get("/sync/pull", { preHandler: authenticate }, async (request, reply) => {
    const { lastSyncedAt } = request.query as { lastSyncedAt?: string };
    const since = lastSyncedAt ? new Date(lastSyncedAt) : new Date(0);
    const userId = request.user.userId;

    const [subjects, topics, pomodoroSessions, user] = await Promise.all([
      prisma.subject.findMany({ where: { userId, updatedAt: { gt: since } } }),
      prisma.topic.findMany({ where: { subject: { userId }, updatedAt: { gt: since } } }),
      prisma.pomodoroSession.findMany({ where: { userId, createdAt: { gt: since } } }),
      prisma.user.findUnique({ where: { id: userId }, select: { xp: true, level: true, streakDays: true, totalStudyMinutes: true } }),
    ]);

    return reply.send({ success: true, data: { subjects, topics, pomodoroSessions, user, syncedAt: new Date().toISOString() } });
  });

  fastify.post("/sync/push", { preHandler: authenticate }, async (request, reply) => {
    const { subjects = [], topics = [], pomodoroSessions = [] } = request.body as {
      subjects?: Array<{ id: string; name: string; color: string; icon: string }>;
      topics?: Array<{ id: string; subjectId: string; title: string; status: string; estimatedMinutes: number; orderIndex: number }>;
      pomodoroSessions?: Array<{ id: string; topicId?: string; workMinutes: number; breakMinutes: number; cyclesCompleted: number; startedAt: string; endedAt?: string }>;
    };
    const userId = request.user.userId;

    for (const s of subjects) {
      await prisma.subject.upsert({ where: { id: s.id }, update: { name: s.name, color: s.color, icon: s.icon }, create: { ...s, userId } });
    }
    for (const t of topics) {
      await prisma.topic.upsert({
        where: { id: t.id },
        update: { title: t.title, status: t.status as "NOT_STUDIED" | "IN_PROGRESS" | "COMPLETED", estimatedMinutes: t.estimatedMinutes, orderIndex: t.orderIndex },
        create: { id: t.id, subjectId: t.subjectId, title: t.title, status: t.status as "NOT_STUDIED" | "IN_PROGRESS" | "COMPLETED", estimatedMinutes: t.estimatedMinutes, orderIndex: t.orderIndex },
      });
    }
    for (const p of pomodoroSessions) {
      await prisma.pomodoroSession.upsert({
        where: { id: p.id },
        update: {},
        create: { id: p.id, userId, topicId: p.topicId, workMinutes: p.workMinutes, breakMinutes: p.breakMinutes, cyclesCompleted: p.cyclesCompleted, startedAt: new Date(p.startedAt), endedAt: p.endedAt ? new Date(p.endedAt) : undefined, synced: true },
      });
    }
    return reply.send({ success: true, syncedAt: new Date().toISOString() });
  });
}
