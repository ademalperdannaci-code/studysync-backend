import { FastifyInstance } from "fastify";
import prisma from "../lib/prisma";
import { authenticate } from "../middleware/auth";

export default async function notificationRoutes(fastify: FastifyInstance) {
  // Get all notifications
  fastify.get("/notifications", { preHandler: authenticate }, async (request, reply) => {
    const notifications = await prisma.notification.findMany({
      where: { userId: request.user.userId },
      orderBy: { createdAt: "desc" },
    });
    return reply.send({ success: true, data: notifications });
  });

  // Mark all as read
  fastify.post("/notifications/read", { preHandler: authenticate }, async (request, reply) => {
    await prisma.notification.updateMany({
      where: { userId: request.user.userId, isRead: false },
      data: { isRead: true },
    });
    return reply.send({ success: true });
  });

  // Delete all read notifications (optional)
  fastify.delete("/notifications/read", { preHandler: authenticate }, async (request, reply) => {
    await prisma.notification.deleteMany({
      where: { userId: request.user.userId, isRead: true },
    });
    return reply.send({ success: true });
  });
}