import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error("Missing REDIS_URL environment variable");
}

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
});

redis.on("connect", () => {
  console.log("Klyn Redis connected");
});

redis.on("error", (error) => {
  console.error("Klyn Redis error", error);
});

export async function checkRedisHealth() {
  try {
    const result = await redis.ping();
    return result === "PONG";
  } catch {
    return false;
  }
}
