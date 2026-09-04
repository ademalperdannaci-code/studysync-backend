import { Server as SocketServer } from "socket.io";
import { Server as HttpServer } from "http";
import prisma from "../lib/prisma";
import redis from "../lib/redis";

export function setupSocketServer(httpServer: HttpServer) {
  const io = new SocketServer(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ["websocket", "polling"],
  });

  // Auth middleware (userId via handshake for MVP; TODO: verify JWT)
  io.use((socket, next) => {
    const userId = socket.handshake.auth?.userId;
    if (!userId) return next(new Error("Unauthorized"));
    (socket as any).userId = userId;
    next();
  });

  io.on("connection", (socket) => {
    const userId: string = (socket as any).userId;
    console.log("[Socket] Connected:", userId, socket.id);
    // 🌐 Global Presence
    socket.join("user_$userId");
    
    // Arkadaslara online oldugunu bildir
    prisma.friendship.findMany({
      where: { OR: [{ userId, status: "ACCEPTED" }, { friendId: userId, status: "ACCEPTED" }] }
    }).then((friends) => {
      friends.forEach((f) => {
        const friendId = f.userId === userId ? f.friendId : f.userId;
        socket.to("user_$friendId").emit("friend_presence", { userId, status: "ONLINE" });
      });
    }).catch(() => {});

    socket.on("set_global_presence", async (state: { status: string; text?: string; expiresAt?: number }) => {
      await redis.setex("presence:" + userId, 7200, JSON.stringify(state)).catch(() => {});
      
      const friends = await prisma.friendship.findMany({
        where: { OR: [{ userId, status: "ACCEPTED" }, { friendId: userId, status: "ACCEPTED" }] }
      });
      friends.forEach((f) => {
        const friendId = f.userId === userId ? f.friendId : f.userId;
        io.to("user_$friendId").emit("friend_presence", { userId, ...state });
      });
    });

    socket.on("get_friends_presence", async (friendIds: string[]) => {
      for (const fid of friendIds) {
        const state = await redis.get("presence:" + fid).catch(() => null);
        if (state) {
          socket.emit("friend_presence", { userId: fid, ...JSON.parse(state) });
        }
      }
    });

    // ── Join room ──────────────────────────────────────────────────────────
    socket.on("join_room", async (roomId: string) => {
      socket.join(roomId);
      await prisma.roomMember.upsert({
        where: { roomId_userId: { roomId, userId } },
        create: { roomId, userId, status: "STUDYING" },
        update: { status: "STUDYING" },
      }).catch(() => {});

      const members = await prisma.roomMember.findMany({
        where: { roomId },
        include: { user: { select: { id: true, username: true, level: true, xp: true, avatarUrl: true } } },
      });

      socket.to(roomId).emit("user_joined", { userId, members });
      socket.emit("room_state", { members });

      // Restore active pomodoro state from Redis
      const pomState = await redis.get("room:pomodoro:" + roomId).catch(() => null);
      if (pomState) socket.emit("pomodoro_started", JSON.parse(pomState));
    });

    // ── Leave room ─────────────────────────────────────────────────────────
    socket.on("leave_room", async (roomId: string) => {
      socket.leave(roomId);
      await prisma.roomMember.deleteMany({ where: { roomId, userId } }).catch(() => {});
      const remaining = await prisma.roomMember.findMany({ where: { roomId }, include: { user: { select: { id: true, username: true, level: true } } } });
      io.to(roomId).emit("user_left", { userId, members: remaining });
    });

    // ── Status update ──────────────────────────────────────────────────────
    socket.on("update_status", async ({ roomId, status }: { roomId: string; status: string }) => {
      await prisma.roomMember.updateMany({ where: { roomId, userId }, data: { status: status as any } }).catch(() => {});
      socket.to(roomId).emit("status_updated", { userId, status });
    });

    // ── Topic update broadcast ─────────────────────────────────────────────
    socket.on("update_topic", ({ roomId, topicId, status }: any) => {
      socket.to(roomId).emit("topic_updated", { userId, topicId, status });
    });

    // ── Pomodoro: START ────────────────────────────────────────────────────
    socket.on("start_pomodoro", async ({ roomId, state }: { roomId: string; state: any }) => {
      const payload = { ...state, startedAt: Date.now() };
      await redis.setex("room:pomodoro:" + roomId, 7200, JSON.stringify(payload)).catch(() => {});
      io.to(roomId).emit("pomodoro_started", payload);
    });

    // ── Pomodoro: TICK ─────────────────────────────────────────────────────
    socket.on("pomodoro_tick", ({ roomId, timeLeft }: { roomId: string; timeLeft: number }) => {
      socket.to(roomId).emit("pomodoro_tick", { timeLeft });
    });

    // ── Pomodoro: PAUSE ────────────────────────────────────────────────────
    socket.on("pause_pomodoro", async ({ roomId }: { roomId: string }) => {
      const raw = await redis.get("room:pomodoro:" + roomId).catch(() => null);
      if (raw) {
        const s = JSON.parse(raw);
        await redis.setex("room:pomodoro:" + roomId, 7200, JSON.stringify({ ...s, isRunning: false })).catch(() => {});
      }
      io.to(roomId).emit("pomodoro_paused", { userId });
    });

    // ── Pomodoro: PHASE CHANGE ─────────────────────────────────────────────
    socket.on("pomodoro_phase_change", async ({ roomId, phase }: { roomId: string; phase: string }) => {
      await redis.setex("room:pomodoro:" + roomId, 7200, JSON.stringify({ phase, isRunning: true, startedAt: Date.now(), timeLeft: phase === "work" ? 25 * 60 : 5 * 60 })).catch(() => {});
      io.to(roomId).emit("pomodoro_phase_changed", { phase, startedBy: userId });
    });

    // ── Disconnect ─────────────────────────────────────────────────────────
    socket.on("room_chat", ({ roomId, message }: { roomId: string; message: any }) => {
      socket.to(roomId).emit("room_chat", message);
    });
    socket.on("disconnecting", async () => {
      for (const roomId of socket.rooms) {
        if (roomId === socket.id) continue;
        await prisma.roomMember.deleteMany({ where: { roomId, userId } }).catch(() => {});
        socket.to(roomId).emit("user_left", { userId });
      }
    });

    socket.on("disconnect", async () => {
      console.log("[Socket] Disconnected:", userId);
      await redis.del("presence:" + userId).catch(() => {});
      const friends = await prisma.friendship.findMany({
        where: { OR: [{ userId, status: "ACCEPTED" }, { friendId: userId, status: "ACCEPTED" }] }
      }).catch(() => []);
      friends.forEach((f) => {
        const friendId = f.userId === userId ? f.friendId : f.userId;
        socket.to("user_$friendId").emit("friend_presence", { userId, status: "OFFLINE" });
      });
    });
  });

  return io;
}