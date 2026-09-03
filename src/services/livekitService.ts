import { AccessToken } from "livekit-server-sdk";

export async function generateLiveKitToken(roomName: string, identity: string, name: string): Promise<string> {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) throw new Error("LiveKit credentials not configured");

  const at = new AccessToken(apiKey, apiSecret, { identity, name, ttl: "4h" });
  at.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
  return await at.toJwt();
}
