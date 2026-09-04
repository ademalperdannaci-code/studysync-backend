import { FastifyInstance } from "fastify";
import { z } from "zod";
import prisma from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { awardXP } from "../services/gamificationService";

const createRoomSchema = z.object({
  name: z.string().min(1).max(100),
  maxCapacity: z.number().int().min(2).max(20).default(8),
});

export default async function roomRoutes(fastify: FastifyInstance) {
  fastify.get("/rooms", { preHandler: authenticate }, async (request, reply) => {
    const rooms = await prisma.studyRoom.findMany({
      where: { isActive: true },
      include: { host: { select: { id: true, username: true, avatarUrl: true } }, _count: { select: { members: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return reply.send({ success: true, data: rooms });
  });

  fastify.get("/rooms/:id", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const room = await prisma.studyRoom.findUnique({
      where: { id },
      include: {
        host: { select: { id: true, username: true, avatarUrl: true } },
        members: { include: { user: { select: { id: true, username: true, avatarUrl: true, level: true } } } },
      },
    });
    if (!room) return reply.status(404).send({ success: false, error: "Room not found" });
    return reply.send({ success: true, data: room });
  });

  fastify.post("/rooms", { preHandler: authenticate }, async (request, reply) => {
    const body = createRoomSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.issues });
    try {
      const room = await prisma.studyRoom.create({ data: { ...body.data, type: "PUBLIC", voiceEnabled: false, hostId: request.user.userId } });
      const gamification = await awardXP({ type: "CREATE_ROOM", userId: request.user.userId });
      return reply.status(201).send({ success: true, data: room, gamification });
    } catch (err: any) {
      console.error("[Rooms] Create error:", err);
      return reply.status(500).send({ success: false, error: err.message || "Failed to create room" });
    }
  });

  fastify.post("/rooms/:id/join", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const room = await prisma.studyRoom.findUnique({ where: { id } });
    if (!room || !room.isActive) return reply.status(404).send({ success: false, error: "Room not found" });
    
    const count = await prisma.roomMember.count({ where: { roomId: id } });
    if (count >= room.maxCapacity) return reply.status(409).send({ success: false, error: "Room is full" });
    await prisma.roomMember.upsert({
      where: { roomId_userId: { roomId: id, userId: request.user.userId } },
      update: { status: "STUDYING", joinedAt: new Date() },
      create: { roomId: id, userId: request.user.userId },
    });
    return reply.send({ success: true, data: { roomId: id } });
  });

  fastify.delete("/rooms/:id/leave", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.roomMember.deleteMany({ where: { roomId: id, userId: request.user.userId } });
    return reply.send({ success: true });
  });

  fastify.delete("/rooms/:id", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const room = await prisma.studyRoom.findUnique({ where: { id }, include: { host: true } });
    if (!room) return reply.status(404).send({ success: false, error: "Room not found" });
    
    const isAdmin = request.user.email === process.env.ADMIN_EMAIL;
    if (room.hostId !== request.user.userId && !isAdmin) {
      return reply.status(403).send({ success: false, error: "Unauthorized" });
    }
    
    await prisma.studyRoom.update({ where: { id }, data: { isActive: false } });
    return reply.send({ success: true, message: "Room deleted" });
  });

  fastify.patch("/rooms/:id", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ name: z.string().min(1).max(100).optional() }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.issues });
    
    const room = await prisma.studyRoom.findUnique({ where: { id }, include: { host: true } });
    if (!room) return reply.status(404).send({ success: false, error: "Room not found" });
    
    const isAdmin = request.user.email === process.env.ADMIN_EMAIL;
    if (room.hostId !== request.user.userId && !isAdmin) {
      return reply.status(403).send({ success: false, error: "Unauthorized" });
    }
    
    const updated = await prisma.studyRoom.update({ where: { id }, data: { ...body.data } });
    return reply.send({ success: true, data: updated });
  });
}