import { Expo } from 'expo-server-sdk';
import prisma from '../lib/prisma';

const expo = new Expo();

export const sendPushNotification = async (userId: string, title: string, body: string, data: any = {}) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    // Assuming user has a pushToken field. Since it doesn't, we simulate it via DB or just return if none
    // If you add pushToken to Prisma later, you can send it here.
    // For now we'll just log it.
    console.log([Push Notification] to :  -  - );
  } catch (err) {
    console.error("Failed to send push notification", err);
  }
};