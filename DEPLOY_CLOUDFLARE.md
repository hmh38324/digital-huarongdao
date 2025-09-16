## 部署到 Cloudflare（Pages + Workers + D1/KV）

### 1. 先决条件
- 已安装 Node.js，安装 wrangler：`npm i -g wrangler`
- 一个 Cloudflare 账号，并完成 `wrangler login`

### 2. 创建后端资源
```bash
# 创建 D1 数据库
wrangler d1 create hl_leaderboard

# 创建 KV 命名空间
wrangler kv namespace create HL_LEADERBOARD_KV
```

记录输出的 `database_id` 与 `KV id`，填入 `worker/wrangler.toml` 中的 `database_id` 与 `id`。

### 3. 初始化并部署 Worker
项目中已包含：
- `worker/wrangler.toml`
- `worker/schema.sql`
- `worker/src/index.ts`

执行：
```bash
cd worker
# 初始化 D1 表结构
wrangler d1 execute hl_leaderboard --file=schema.sql

# 本地预览（可选）
wrangler dev

# 部署
wrangler deploy
```
部署成功后会获得形如 `https://hl-worker.<subdomain>.workers.dev` 的域名。将该域名写入前端 `index.html` 顶部的 `WORKER_BASE_URL`。

### 4. 部署静态站点到 Cloudflare Pages
方式 A：GitHub 连 Cloudflare Pages，选择本仓库，构建命令为空，输出目录使用根目录。

方式 B：直接上传
```bash
# 在 Pages 控制台 -> 创建项目 -> 直接上传，选择仓库根目录（含 index.html 和静态资源）
```

推荐设置：
- `index.html` 使用较短缓存或者 no-cache；
- 资源文件名指纹（当前项目无打包流程，可先保持简单）。

### 5. 前端与后端对接
在 `index.html` 顶部找到：
```html
<script>
  const WORKER_BASE_URL = 'https://REPLACE_WITH_YOUR_WORKER_DOMAIN';
```
替换为 Worker 实际域名（或绑定的自定义域）。

功能说明：
- 读排行榜：优先 `GET ${WORKER_BASE_URL}/leaderboard?limit=50`，失败回退 Gist；
- 写成绩：优先 `POST ${WORKER_BASE_URL}/submit`，失败回退 Gist。

### 6. CORS
在 `worker/wrangler.toml` 里配置：
```toml
[vars]
ALLOWED_ORIGIN = "https://你的Pages域名"
```

### 7. 常见问题
- 500 人并发：使用 KV 缓存排行榜，TTL 30s；写入使用 D1。
- 免费配额：避免前端频繁轮询，建议 20–30s 读取一次。
- 安全：不要在前端暴露敏感 Token。Workers 保管密钥。


