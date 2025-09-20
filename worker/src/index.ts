export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
     ALLOWED_ORIGINS: string; // comma-separated origins
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
    const requestOrigin = req.headers.get("origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
    const origin = allowed.includes(requestOrigin) ? requestOrigin : allowed[0] || "*";
    const MAX_ATTEMPTS = 3;
    const ADMIN_PASSWORD = "1314520";

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
             ROW_NUMBER() OVER (PARTITION BY s.user_id ORDER BY s.time_ms ASC, s.moves ASC, s.created_at ASC) AS rn,
             COUNT(*) OVER (PARTITION BY s.user_id) AS completedCount
           FROM scores s
         )
         SELECT userId, nickname, moves, timeMs, createdAt, completedCount
         FROM ranked
         WHERE rn = 1
         ORDER BY timeMs ASC, moves ASC, createdAt ASC
         LIMIT ?`
      )
        .bind(limit)
        .all();

      if (!cached) {
        env.CACHE.put(cacheKey, JSON.stringify(d1Rows), { expirationTtl: 30 }).catch(() => {});
      }

      const baseRows: any[] = cached || d1Rows;

      // 读取 KV 中所有已开始的用户，key 前缀 attempts:
      const kvKeys = await env.CACHE.list({ prefix: "attempts:" });
      const kvRows: any[] = [];
      for (const k of kvKeys.keys) {
        const raw = await env.CACHE.get(k.name);
        if (!raw) continue;
        let attemptsCount = 0;
        let nickname: string | undefined = undefined;
        try {
          const obj = JSON.parse(raw as any);
          attemptsCount = typeof obj.attemptsCount === "number" ? obj.attemptsCount : parseInt(String(obj.attemptsCount || 0), 10);
          nickname = obj.nickname;
        } catch {
          attemptsCount = parseInt(raw, 10) || 0;
        }
        const userId = k.name.replace(/^attempts:/, "");
        kvRows.push({ userId, nickname, attemptsCount });
      }

      // 合并：若 D1 有记录，用其最佳成绩，并用 KV 的 attemptsCount 覆盖；
      // 若 KV 有但 D1 没有，补充一条仅含 attemptsCount 的记录。
      const byId = new Map<string, any>();
      for (const r of baseRows) byId.set(r.userId, { ...r, attemptsCount: r.completedCount || r.attemptsCount || 0 });
      for (const r of kvRows) {
        if (byId.has(r.userId)) {
          const cur = byId.get(r.userId);
          cur.attemptsCount = r.attemptsCount;
          if (!cur.nickname && r.nickname) cur.nickname = r.nickname;
          byId.set(r.userId, cur);
        } else {
          byId.set(r.userId, { userId: r.userId, nickname: r.nickname, attemptsCount: r.attemptsCount });
        }
      }

      const merged = Array.from(byId.values());
      return json(merged, origin);
    }

    // 获取某用户的已开始尝试次数（用于登录后同步剩余次数）
    if (url.pathname === "/attempts" && req.method === "GET") {
      const userId = url.searchParams.get("userId");
      if (!userId) return json({ error: "Missing userId" }, origin, 400);
      const raw = await env.CACHE.get(`attempts:${userId}`);
      let attemptsCount = 0;
      if (raw) {
        try {
          const obj = JSON.parse(raw as any);
          attemptsCount = typeof obj.attemptsCount === "number" ? obj.attemptsCount : parseInt(String(obj.attemptsCount || 0), 10);
        } catch {
          attemptsCount = parseInt(raw, 10) || 0;
        }
      }
      return json({ attemptsCount }, origin);
    }
    // 开始一次尝试：增加 KV 计数并返回 attemptsCount
    if (url.pathname === "/begin" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (!body) return json({ error: "Invalid JSON" }, origin, 400);
      const { userId, nickname } = body as { userId?: string; nickname?: string };
      if (!userId || !nickname) return json({ error: "Missing fields" }, origin, 400);

      const key = `attempts:${userId}`;
      const raw = await env.CACHE.get(key);
      let attempts = 0;
      if (raw) {
        try {
          const obj = JSON.parse(raw as any);
          attempts = typeof obj.attemptsCount === "number" ? obj.attemptsCount : parseInt(String(obj.attemptsCount || 0), 10);
        } catch {
          attempts = parseInt(raw, 10) || 0;
        }
      }
      if (attempts >= MAX_ATTEMPTS) {
        return json({ ok: false, attemptsCount: attempts, reason: "limit" }, origin, 403);
      }
      attempts += 1;
      await env.CACHE.put(key, JSON.stringify({ attemptsCount: attempts, nickname }));
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

    // ===== Admin endpoints (simple password check) =====
    if (url.pathname === "/admin/clear" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      const password = body && (body.password as string);
      if (password !== ADMIN_PASSWORD) return json({ error: "Unauthorized" }, origin, 401);

      // Clear D1 scores
      await env.DB.exec(`DELETE FROM scores`).catch(() => {});

      // Clear KV attempts
      const kvKeys = await env.CACHE.list({ prefix: "attempts:" });
      let deleted = 0;
      for (const k of kvKeys.keys) {
        await env.CACHE.delete(k.name).catch(() => {});
        deleted += 1;
      }
      // Invalidate leaderboard cache keys (various limits)
      await env.CACHE.delete("leaderboard:top:50:best_per_user:v2:d1").catch(() => {});

      return json({ ok: true, deletedAttempts: deleted }, origin, 200);
    }

    if (url.pathname === "/admin/edit" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (!body) return json({ error: "Invalid JSON" }, origin, 400);
      const { password, userId, nickname, moves, timeMs, attemptsCount } = body as {
        password?: string;
        userId?: string;
        nickname?: string;
        moves?: number;
        timeMs?: number;
        attemptsCount?: number;
      };
      if (password !== ADMIN_PASSWORD) return json({ error: "Unauthorized" }, origin, 401);
      if (!userId) return json({ error: "Missing userId" }, origin, 400);

      // Update KV attempts if provided
      if (typeof attemptsCount === "number" && attemptsCount >= 0) {
        await env.CACHE.put(`attempts:${userId}`, JSON.stringify({ attemptsCount, nickname }), { expirationTtl: undefined }).catch(() => {});
      }

      // Replace user's score: delete existing rows then insert a new one
      if (Number.isInteger(moves) && Number.isInteger(timeMs) && (moves as number) > 0 && (timeMs as number) > 0) {
        const createdAt = Date.now();
        // delete old scores for this user to avoid stale 0ms records winning the ranking
        await env.DB.prepare(`DELETE FROM scores WHERE user_id = ?`).bind(userId).run().catch(() => {});
        await env.DB.prepare(
          `INSERT INTO scores (user_id, nickname, moves, time_ms, created_at) VALUES (?, ?, ?, ?, ?)`
        ).bind(userId, nickname || null, moves, timeMs, createdAt).run().catch(() => {});
        await env.CACHE.delete("leaderboard:top:50:best_per_user:v2:d1").catch(() => {});
      }

      return json({ ok: true }, origin, 200);
    }

    return json({ error: "Not Found" }, origin, 404);
  },
} satisfies ExportedHandler<Env>;


