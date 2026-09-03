import { FastifyInstance } from "fastify";
import { z } from "zod";
import prisma from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { generateLiveKitToken } from "../services/livekitService";
import { awardXP } from "../services/gamificationService";

const createRoomSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["PUBLIC", "PRIVATE"]).default("PUBLIC"),
  maxCapacity: z.number().int().min(2).max(20).default(8),
  voiceEnabled: z.boolean().default(true),
});

export default async function roomRoutes(fastify: FastifyInstance) {
  fastify.get("/rooms", { preHandler: authenticate }, async (request, reply) => {
    const rooms = await prisma.studyRoom.findMany({
      where: { isActive: true, type: "PUBLIC" },
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
      const room = await prisma.studyRoom.create({ data: { ...body.data, hostId: request.user.userId } });
      const gamification = await awardXP({ type: "CREATE_ROOM", userId: request.user.userId });
      return reply.status(201).send({ success: true, data: room, gamification });
    } catch (err: any) {
      console.error("[Rooms] Create error:", err);
      return reply.status(500).send({ success: false, error: err.message || "Failed to create room" });
    }
  });

  fastify.post("/rooms/:id/join", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { inviteCode } = (request.body as { inviteCode?: string }) || {};
    const room = await prisma.studyRoom.findUnique({ where: { id } });
    if (!room || !room.isActive) return reply.status(404).send({ success: false, error: "Room not found" });
    if (room.type === "PRIVATE" && room.inviteCode !== inviteCode)
      return reply.status(403).send({ success: false, error: "Invalid invite code" });
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

  fastify.post("/rooms/:id/voice-token", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const room = await prisma.studyRoom.findUnique({ where: { id } });
    if (!room) return reply.status(404).send({ success: false, error: "Room not found" });
    if (!room.voiceEnabled) return reply.status(400).send({ success: false, error: "Voice not enabled" });
    try {
      const token = await generateLiveKitToken(room.livekitRoomName, request.user.userId, request.user.username);
      return reply.send({ success: true, data: { token, livekitUrl: process.env.LIVEKIT_URL } });
    } catch {
      return reply.status(500).send({ success: false, error: "Failed to generate voice token" });
    }
  });
}
