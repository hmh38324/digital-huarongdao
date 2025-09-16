export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  ALLOWED_ORIGIN: string;
}

const json = (data: unknown, origin: string, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
      "cache-control": "no-store",
    },
  });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = env.ALLOWED_ORIGIN || "*";

    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      });
    }

    if (url.pathname === "/leaderboard" && req.method === "GET") {
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);
      const cacheKey = `leaderboard:top:${limit}:best_per_user:v2`;
      const cached = await env.CACHE.get(cacheKey, "json");
      if (cached) return json(cached, origin);

      // 每个用户仅保留最佳一条（步数升序、时间升序、时间早者优先），并返回该用户的总尝试次数
      const { results } = await env.DB.prepare(
        `WITH ranked AS (
           SELECT 
             s.user_id AS userId,
             s.nickname AS nickname,
             s.moves AS moves,
             s.time_ms AS timeMs,
             s.created_at AS createdAt,
             ROW_NUMBER() OVER (PARTITION BY s.user_id ORDER BY s.moves ASC, s.time_ms ASC, s.created_at ASC) AS rn,
             COUNT(*) OVER (PARTITION BY s.user_id) AS attemptsCount
           FROM scores s
         )
         SELECT userId, nickname, moves, timeMs, createdAt, attemptsCount
         FROM ranked
         WHERE rn = 1
         ORDER BY moves ASC, timeMs ASC, createdAt ASC
         LIMIT ?`
      )
        .bind(limit)
        .all();

      env.CACHE.put(cacheKey, JSON.stringify(results), { expirationTtl: 30 }).catch(() => {});
      return json(results, origin);
    }

    if (url.pathname === "/submit" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (!body) return json({ error: "Invalid JSON" }, origin, 400);

      const { userId, nickname, moves, timeMs } = body as {
        userId?: string;
        nickname?: string;
        moves?: number;
        timeMs?: number;
      };

      if (!userId || !nickname || !Number.isInteger(moves) || !Number.isInteger(timeMs)) {
        return json({ error: "Missing or invalid fields" }, origin, 400);
      }

      if (moves <= 0 || timeMs <= 0 || nickname.length > 32) {
        return json({ error: "Bad values" }, origin, 400);
      }

      const createdAt = Date.now();
      await env.DB.prepare(
        `INSERT INTO scores (user_id, nickname, moves, time_ms, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
        .bind(userId, nickname, moves, timeMs, createdAt)
        .run();

      await env.CACHE.delete("leaderboard:top:50").catch(() => {});
      return json({ ok: true }, origin, 201);
    }

    return json({ error: "Not Found" }, origin, 404);
  },
} satisfies ExportedHandler<Env>;


