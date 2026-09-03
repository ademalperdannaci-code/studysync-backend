import prisma from "../lib/prisma";

export async function updateStreak(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("User not found");

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const lastActive = user.lastActiveDate ? new Date(user.lastActiveDate) : null;
  if (lastActive) lastActive.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);

  let newStreak = user.streakDays;
  if (!lastActive) newStreak = 1;
  else if (lastActive.getTime() === today.getTime()) return user.streakDays;
  else if (lastActive.getTime() === yesterday.getTime()) newStreak = user.streakDays + 1;
  else newStreak = 1;

  await prisma.user.update({ where: { id: userId }, data: { streakDays: newStreak, lastActiveDate: new Date() } });
  return newStreak;
}
