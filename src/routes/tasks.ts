import { FastifyInstance } from "fastify";
import { z } from "zod";
import prisma from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { awardXP } from "../services/gamificationService";

const subjectSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().default("#6366f1"),
  icon: z.string().default("book"),
});

const topicSchema = z.object({
  title: z.string().min(1).max(200),
  estimatedMinutes: z.number().int().positive().default(25),
  orderIndex: z.number().int().nonnegative().default(0),
});

const topicStatusSchema = z.object({
  status: z.enum(["NOT_STUDIED", "IN_PROGRESS", "COMPLETED"]),
});

export default async function taskRoutes(fastify: FastifyInstance) {
  fastify.get("/subjects", { preHandler: authenticate }, async (request, reply) => {
    const subjects = await prisma.subject.findMany({
      where: { userId: request.user.userId },
      include: { topics: { orderBy: { orderIndex: "asc" } } },
      orderBy: { createdAt: "asc" },
    });
    return reply.send({ success: true, data: subjects });
  });

  fastify.post("/subjects", { preHandler: authenticate }, async (request, reply) => {
    const body = subjectSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.issues });
    const subject = await prisma.subject.create({ data: { ...body.data, userId: request.user.userId } });
    return reply.status(201).send({ success: true, data: subject });
  });

  fastify.put("/subjects/:id", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = subjectSchema.partial().safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.issues });
    await prisma.subject.updateMany({ where: { id, userId: request.user.userId }, data: body.data });
    return reply.send({ success: true });
  });

  fastify.delete("/subjects/:id", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.subject.deleteMany({ where: { id, userId: request.user.userId } });
    return reply.send({ success: true });
  });

  fastify.get("/subjects/:subjectId/topics", { preHandler: authenticate }, async (request, reply) => {
    const { subjectId } = request.params as { subjectId: string };
    const topics = await prisma.topic.findMany({ where: { subjectId }, orderBy: { orderIndex: "asc" } });
    return reply.send({ success: true, data: topics });
  });

  fastify.post("/subjects/:subjectId/topics", { preHandler: authenticate }, async (request, reply) => {
    const { subjectId } = request.params as { subjectId: string };
    const body = topicSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.issues });
    const topic = await prisma.topic.create({ data: { ...body.data, subjectId } });
    return reply.status(201).send({ success: true, data: topic });
  });

  fastify.patch("/topics/:id/status", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = topicStatusSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.issues });

    const updateData: Record<string, unknown> = { status: body.data.status };
    if (body.data.status === "COMPLETED") updateData.completedAt = new Date();

    const topic = await prisma.topic.update({ where: { id }, data: updateData });
    let gamification = null;
    if (body.data.status === "COMPLETED") {
      gamification = await awardXP({ type: "TOPIC_COMPLETE", userId: request.user.userId });
    }
    return reply.send({ success: true, data: topic, gamification });
  });

  fastify.delete("/topics/:id", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.topic.delete({ where: { id } });
    return reply.send({ success: true });
  });
}
