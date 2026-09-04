import { FastifyInstance } from "fastify";
import { z } from "zod";
import prisma from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { sendPushNotification } from "../services/pushService";

export default async function chatRoutes(fastify: FastifyInstance) {
  // Get messages with a user
  fastify.get("/chat/:userId", { preHandler: authenticate }, async (request, reply) => {
    const { userId: peerId } = request.params as { userId: string };
    const myId = request.user.userId;

    const messages = await prisma.directMessage.findMany({
      where: {
        OR: [
          { senderId: myId, receiverId: peerId },
          { senderId: peerId, receiverId: myId },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    });

    return reply.send({ success: true, data: messages });
  });

  // Send a message
  fastify.post("/chat/:userId", { preHandler: authenticate }, async (request, reply) => {
    const { userId: peerId } = request.params as { userId: string };
    const myId = request.user.userId;
    const body = z.object({ content: z.string().min(1) }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false });

    const msg = await prisma.directMessage.create({
      data: { senderId: myId, receiverId: peerId, content: body.data.content, status: "SENT" }
    });
    
    sendPushNotification(peerId, "Yeni Mesaj", request.user.username + ": " + body.data.content, { url: "/(app)/chat/" + myId });
    
    return reply.status(201).send({ success: true, data: msg });
  });

  // Mark as read
  fastify.post("/chat/:userId/read", { preHandler: authenticate }, async (request, reply) => {
    const { userId: peerId } = request.params as { userId: string };
    const myId = request.user.userId;

    await prisma.directMessage.updateMany({
      where: { senderId: peerId, receiverId: myId, status: { not: "READ" } },
      data: { status: "READ" }
    });

    return reply.send({ success: true });
  });
}