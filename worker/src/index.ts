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
    const MAX_ATTEMPTS = 3;

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
      // 不缓存 attemptsCount（需要实时），仅缓存 D1 排序结果
      const cacheKey = `leaderboard:top:${limit}:best_per_user:v2:d1`;
      const cached = await env.CACHE.get(cacheKey, "json");

      // 每个用户仅保留最佳一条（步数升序、时间升序、时间早者优先）
      const { results: d1Rows } = await env.DB.prepare(
        `WITH ranked AS (
           SELECT 
             s.user_id AS userId,
             s.nickname AS nickname,
             s.moves AS moves,
             s.time_ms AS timeMs,
             s.created_at AS createdAt,
             ROW_NUMBER() OVER (PARTITION BY s.user_id ORDER BY s.moves ASC, s.time_ms ASC, s.created_at ASC) AS rn,
             COUNT(*) OVER (PARTITION BY s.user_id) AS completedCount
           FROM scores s
         )
         SELECT userId, nickname, moves, timeMs, createdAt, completedCount
         FROM ranked
         WHERE rn = 1
         ORDER BY moves ASC, timeMs ASC, createdAt ASC
         LIMIT ?`
      )
        .bind(limit)
        .all();

      if (!cached) {
        env.CACHE.put(cacheKey, JSON.stringify(d1Rows), { expirationTtl: 30 }).catch(() => {});
      }

      // 合并 KV 中的 attemptsCount（开始次数），若不存在则回退为 completedCount
      const withAttempts = await Promise.all(
        (cached || d1Rows).map(async (row: any) => {
          const key = `attempts:${row.userId}`;
          const raw = await env.CACHE.get(key);
          const attemptsCount = raw ? parseInt(raw, 10) : row.completedCount || 0;
          return { ...row, attemptsCount };
        })
      );
      return json(withAttempts, origin);
    }

    // 开始一次尝试：增加 KV 计数并返回 attemptsCount
    if (url.pathname === "/begin" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (!body) return json({ error: "Invalid JSON" }, origin, 400);
      const { userId, nickname } = body as { userId?: string; nickname?: string };
      if (!userId || !nickname) return json({ error: "Missing fields" }, origin, 400);

      const key = `attempts:${userId}`;
      const raw = await env.CACHE.get(key);
      let attempts = raw ? parseInt(raw, 10) : 0;
      if (Number.isNaN(attempts) || attempts < 0) attempts = 0;
      if (attempts >= MAX_ATTEMPTS) {
        return json({ ok: false, attemptsCount: attempts, reason: "limit" }, origin, 403);
      }
      attempts += 1;
      await env.CACHE.put(key, String(attempts));
      return json({ ok: true, attemptsCount: attempts }, origin, 200);
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


