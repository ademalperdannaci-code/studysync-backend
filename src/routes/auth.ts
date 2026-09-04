import { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import prisma from "../lib/prisma";

const registerSchema = z.object({
  username: z.string().min(3).max(20),
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post("/auth/register", async (request, reply) => {
    const body = registerSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.issues });

    const { username, email, password } = body.data;
    console.log('Validating body...');
    const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { username }] } });
    console.log('Checked existing:', existing);
    if (existing) return reply.status(409).send({ success: false, error: "Email or username already taken" });

    console.log('Hashing password...');
    const passwordHash = await bcrypt.hash(password, 12);
    console.log('Creating user...');
    const user = await prisma.user.create({
      data: { username, email, passwordHash },
      select: { id: true, username: true, email: true, xp: true, level: true },
    });

    console.log('Created user:', user.id);
    const accessToken = fastify.jwt.sign({ userId: user.id, email: user.email, username: user.username } as any, { expiresIn: "15m" });
    const refreshToken = fastify.jwt.sign({ userId: user.id, type: "refresh" } as any, { expiresIn: "30d" });

    return reply.status(201).send({ success: true, data: { user, accessToken, refreshToken } });
  });

  fastify.post("/auth/login", async (request, reply) => {
    const body = loginSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.issues });

    const { email, password } = body.data;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return reply.status(401).send({ success: false, error: "Invalid credentials" });
    }

    console.log('Created user:', user.id);
    const accessToken = fastify.jwt.sign({ userId: user.id, email: user.email, username: user.username } as any, { expiresIn: "15m" });
    const refreshToken = fastify.jwt.sign({ userId: user.id, type: "refresh" } as any, { expiresIn: "30d" });

    return reply.send({
      success: true,
      data: { user: { id: user.id, username: user.username, email: user.email, xp: user.xp, level: user.level, streakDays: user.streakDays }, accessToken, refreshToken },
    });
  });

  fastify.post("/auth/refresh", async (request, reply) => {
    const { refreshToken } = request.body as { refreshToken: string };
    try {
      const payload = fastify.jwt.verify<{ userId: string; type: string }>(refreshToken);
      if (payload.type !== "refresh") throw new Error("Invalid type");
      const user = await prisma.user.findUnique({ where: { id: payload.userId } });
      if (!user) throw new Error("Not found");
      console.log('Created user:', user.id);
    const accessToken = fastify.jwt.sign({ userId: user.id, email: user.email, username: user.username }, { expiresIn: "15m" });
      return reply.send({ success: true, data: { accessToken } });
    } catch {
      return reply.status(401).send({ success: false, error: "Invalid refresh token" });
    }
  });
}
