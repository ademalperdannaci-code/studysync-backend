import prisma from "../lib/prisma";
import redis from "../lib/redis";

export interface XPEvent {
  type: "POMODORO_COMPLETE" | "TOPIC_COMPLETE" | "DAILY_GOAL" | "STUDY_WITH_FRIEND" | "STREAK_DAY" | "CREATE_ROOM";
  userId: string;
}

const XP_REWARDS: Record<XPEvent["type"], number> = {
  POMODORO_COMPLETE: 10,
  TOPIC_COMPLETE: 25,
  DAILY_GOAL: 50,
  STUDY_WITH_FRIEND: 20,
  STREAK_DAY: 15,
  CREATE_ROOM: 30,
};

function calculateLevel(xp: number): number {
  if (xp < 500) return 1;
  if (xp < 1500) return 5;
  if (xp < 5000) return 10;
  if (xp < 15000) return 20;
  if (xp < 50000) return 30;
  return 50;
}

function getWeekKey(): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const week = Math.floor((now.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${now.getFullYear()}-W${week}`;
}

async function checkAndAwardBadge(userId: string, key: string, condition: boolean): Promise<boolean> {
  if (!condition) return false;
  const existing = await prisma.userBadge.findUnique({ where: { userId_badgeKey: { userId, badgeKey: key } } });
  if (existing) return false;
  await prisma.userBadge.create({ data: { userId, badgeKey: key } });
  return true;
}

export async function awardXP(event: XPEvent): Promise<{ xp: number; newBadges: string[]; leveledUp: boolean }> {
  const xpGain = XP_REWARDS[event.type];
  const user = await prisma.user.findUnique({ where: { id: event.userId } });
  if (!user) throw new Error("User not found");

  const oldLevel = calculateLevel(user.xp);
  const updated = await prisma.user.update({ where: { id: event.userId }, data: { xp: { increment: xpGain } } });
  const newLevel = calculateLevel(updated.xp);

  try {
    await redis.zincrby("leaderboard:alltime", xpGain, event.userId);
    const weekKey = `leaderboard:week:${getWeekKey()}`;
    await redis.zincrby(weekKey, xpGain, event.userId);
    await redis.expire(weekKey, 60 * 60 * 24 * 7);
  } catch (err) {
    console.error("[Gamification] Redis error (Ignored):", err);
  }

  const newBadges: string[] = [];

  const pomCount = await prisma.pomodoroSession.count({ where: { userId: event.userId } });
  const pomCycles = await prisma.pomodoroSession.aggregate({ where: { userId: event.userId }, _sum: { cyclesCompleted: true } });
  const roomCount = await prisma.studyRoom.count({ where: { hostId: event.userId } });
  const freshUser = await prisma.user.findUnique({ where: { id: event.userId } });

  const badgeChecks: Array<[string, boolean]> = [
    ["first_pomodoro", pomCount >= 1],
    ["pomodoro_machine", (pomCycles._sum.cyclesCompleted ?? 0) >= 50],
    ["iron_will", (pomCycles._sum.cyclesCompleted ?? 0) >= 100],
    ["first_room", roomCount >= 1],
    ["week_streak", (freshUser?.streakDays ?? 0) >= 7],
    ["month_streak", (freshUser?.streakDays ?? 0) >= 30],
  ];

  for (const [key, cond] of badgeChecks) {
    const earned = await checkAndAwardBadge(event.userId, key, cond);
    if (earned) newBadges.push(key);
  }

  if (newLevel !== oldLevel) {
    await prisma.user.update({ where: { id: event.userId }, data: { level: newLevel } });
  }

  return { xp: xpGain, newBadges, leveledUp: newLevel > oldLevel };
}
