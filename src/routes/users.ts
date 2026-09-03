import { FastifyInstance } from "fastify";
import { z } from "zod";
import prisma from "../lib/prisma";
import { authenticate } from "../middleware/auth";

export default async function userRoutes(fastify: FastifyInstance) {
  // Kendi profili getir
  fastify.get("/users/me", { preHandler: authenticate }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user.userId },
      select: { id: true, username: true, email: true, avatarUrl: true, xp: true, level: true, streakDays: true, totalStudyMinutes: true, createdAt: true },
    });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });
    const badges = await prisma.userBadge.findMany({ where: { userId: request.user.userId }, orderBy: { earnedAt: "desc" } });
    return reply.send({ success: true, data: { ...user, badges } });
  });

  // Profil guncelle
  fastify.patch("/users/me", { preHandler: authenticate }, async (request, reply) => {
    const schema = z.object({ username: z.string().min(3).max(20).optional(), avatarUrl: z.string().url().optional() });
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.issues });
    const user = await prisma.user.update({ where: { id: request.user.userId }, data: body.data, select: { id: true, username: true, avatarUrl: true } });
    return reply.send({ success: true, data: user });
  });

  // Kullanici ara
  fastify.get("/users/search", { preHandler: authenticate }, async (request, reply) => {
    const { q } = request.query as { q: string };
    if (!q || q.length < 2) return reply.status(400).send({ success: false, error: "Query too short" });
    const users = await prisma.user.findMany({
      where: { username: { contains: q, mode: "insensitive" }, NOT: { id: request.user.userId } },
      select: { id: true, username: true, avatarUrl: true, level: true },
      take: 10,
    });
    return reply.send({ success: true, data: users });
  });

  // Arkadaslik istegi gonder
  fastify.post("/friendships", { preHandler: authenticate }, async (request, reply) => {
    const { friendId } = request.body as { friendId: string };
    const existing = await prisma.friendship.findFirst({ where: { OR: [{ userId: request.user.userId, friendId }, { userId: friendId, friendId: request.user.userId }] } });
    if (existing) return reply.status(409).send({ success: false, error: "Friendship already exists" });
    const friendship = await prisma.friendship.create({ data: { userId: request.user.userId, friendId, status: "PENDING" } });
    return reply.status(201).send({ success: true, data: friendship });
  });

  // Arkadaslik istegini kabul et
  fastify.patch("/friendships/:id/accept", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const f = await prisma.friendship.findFirst({ where: { id, friendId: request.user.userId, status: "PENDING" } });
    if (!f) return reply.status(404).send({ success: false, error: "Friendship request not found" });
    await prisma.friendship.update({ where: { id }, data: { status: "ACCEPTED" } });
    return reply.send({ success: true });
  });

  // Arkadaslari listele
  fastify.get("/friendships", { preHandler: authenticate }, async (request, reply) => {
    const friendships = await prisma.friendship.findMany({
      where: { OR: [{ userId: request.user.userId, status: "ACCEPTED" }, { friendId: request.user.userId, status: "ACCEPTED" }] },
      include: {
        user: { select: { id: true, username: true, avatarUrl: true, level: true, xp: true } },
        friend: { select: { id: true, username: true, avatarUrl: true, level: true, xp: true } },
      },
    });
    const friends = friendships.map((f) => f.userId === request.user.userId ? f.friend : f.user);
    return reply.send({ success: true, data: friends });
  });

  // Bekleyen istekler
  fastify.get("/friendships/pending", { preHandler: authenticate }, async (request, reply) => {
    const pending = await prisma.friendship.findMany({
      where: { friendId: request.user.userId, status: "PENDING" },
      include: { user: { select: { id: true, username: true, avatarUrl: true } } },
    });
    return reply.send({ success: true, data: pending });
  });
}