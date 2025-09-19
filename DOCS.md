### 利群华容道——可复用的开发逻辑说明

> 本文总结当前项目的前端与后端整体逻辑、数据流、API 契约与可复用的开发套路，便于在新游戏中快速复用与迁移。

---

## 核心架构与数据流

- 前端：纯静态页面 `index.html`（含 UI、玩法逻辑、登录、计时、排行榜展示、管理工具）
- 后端：Cloudflare Worker（`worker/src/index.ts`）
  - D1 数据库：存放每次通关成绩（可排序字段）
  - KV 命名空间：存放“已开始尝试次数”与排行榜缓存
- 通信：前端通过 `WORKER_BASE_URL` 调 Worker 接口；Worker 用 `ALLOWED_ORIGINS` 控制 CORS

---

## 前端逻辑（index.html）

- 玩法与界面
  - 3×3 拼图棋盘（右上角为空格），参考图展示
  - 控件：打乱、排行榜、登录、设置（管理员工具）
  - 弹窗：登录、排行榜、设置、通关提示
- 核心类 `PuzzleGame`
  - 初始化：`loadPeopleData()` 读取 `people.json` → `init()` 创建与渲染 → 延迟自动打乱
  - 棋面状态：`pieceImages` 维护 9 宫格；`movePiece()` 检查相邻与交换；`checkWin()` 胜利判定
  - 打乱：150 次合法随机移动，再把空格合法移回右上
  - 计时：首次有效移动时启动，胜利或重置时停止
  - 登录：用 `people.json` 验证工号+姓名；设置 `currentUser` 并更新“剩余次数”
  - 尝试次数限制：
    - 首次有效移动前调用 `POST /begin` 登记开局（超过 3 次则禁止）
    - 登录后调用 `GET /attempts` 同步“剩余次数”
  - 成绩提交：胜利时 `POST /submit`，字段为 `userId/nickname/moves/timeMs`
  - 排行榜：`GET /leaderboard?limit=50`，前端排序与渲染，高亮当前用户
  - 管理工具（设置内）
    - 清空排行榜：`POST /admin/clear`
    - 编辑用户成绩/次数：`POST /admin/edit`
    - 导出 CSV：`GET /leaderboard?limit=1000` 后前端拼 CSV 下载
- 资源/数据
  - 图片：`origin.png` 与 `split_images/*`
  - 用户表：`people.json`（工号/姓名），失败时使用默认内置

---

## 后端逻辑（worker/src/index.ts）

- 常量与安全
  - `ALLOWED_ORIGINS`: 允许的前端域名（CORS）
  - `MAX_ATTEMPTS = 3`, `ADMIN_PASSWORD = "1314520"`
- 存储职责
  - D1 表 `scores(user_id, nickname, moves, time_ms, created_at)`：每次通关插1行
  - KV：
    - `attempts:${userId}` → `{"attemptsCount","nickname"}`
    - 排行榜短缓存（30 秒），键形如 `leaderboard:top:${limit}:best_per_user:v2:d1`
- 接口一览
  - `OPTIONS`：CORS 预检
  - `GET /leaderboard?limit=50`
    - D1：取每用户最佳一条（时间升序→步数升序→时间早者优先）
    - KV：合并补充/覆盖 `attemptsCount`
  - `GET /attempts?userId=xxx`：返回该用户已开始次数
  - `POST /begin`：未超限则 `attemptsCount+1` 写 KV 并返回；超限 403
  - `POST /submit`：校验字段后写 D1 成绩，清理缓存键
  - 管理：
    - `POST /admin/clear`：清空 D1 scores 与 KV attempts（需口令）
    - `POST /admin/edit`：可设置 `attemptsCount`，并用一条新成绩替换该用户所有历史（需口令）
- 配置（worker/wrangler.toml）
  - 绑定 D1、KV、`ALLOWED_ORIGINS`，设置 `compatibility_date`

---

## API 契约（复用时保持不变或小改）

- 开局登记
  - `POST /begin`
  - Body: `{ userId, nickname }`
  - Resp: `{ ok: boolean, attemptsCount: number }`，超限 403
- 提交成绩
  - `POST /submit`
  - Body: `{ userId, nickname, moves, timeMs }`（均为正整数）
  - Resp: `{ ok: true }`
- 排行榜
  - `GET /leaderboard?limit=50`
  - Resp: `[{ userId, nickname, moves, timeMs, attemptsCount, createdAt? }]`（每用户最佳）
- 查询尝试次数
  - `GET /attempts?userId=xxx`
  - Resp: `{ attemptsCount }`
- 管理
  - `POST /admin/clear` Body: `{ password }`
  - `POST /admin/edit` Body: `{ password, userId, nickname?, moves?, timeMs?, attemptsCount? }`

---

## 可复用开发套路（迁移到新游戏）

- 前端侧
  - 保留“登录 → 开局登记(`/begin`) → 首次有效操作启动计时 → 胜利提交(`/submit`) → 排行榜展示(`/leaderboard`) → 管理工具”的流水线
  - 替换关卡与判胜
    - 换皮拼图：替换图片资源与空格位置，调整 `checkWin()`
    - 换玩法：将你的“操作次数/里程”映射为 `moves`，将“耗时/计时指标”映射为 `timeMs`
  - 登录校验：沿用 `people.json` 或接入你的用户系统（仍输出 `userId/nickname`）
  - 常量：把 `WORKER_BASE_URL` 指向新 Worker 域名
- 后端侧
  - 保持“D1 存成绩、KV 记尝试次数与缓存”的职责划分
  - 若引入新指标：扩展 D1 schema 与排行榜排序规则；前端渲染字段同步调整
  - 复制管理接口，便于运营手工处理

---

## 在新游戏中需要改动的最少项

- 前端
  - `WORKER_BASE_URL`
  - 玩法资源（图片/音效/关卡数据）
  - `PuzzleGame` 中的初始化、`checkWin()`、计分口径（`moves/timeMs` 的定义）
- 后端
  - D1 表结构与查询排序（若指标变化）
  - `ALLOWED_ORIGINS` 与 D1/KV 绑定 ID

---

## 目录与关键文件

- `index.html`：UI、玩法、登录、计时、排行榜、管理工具
- `people.json`：登录白名单（工号/姓名）
- `split_images/*`, `origin.png`：拼图资源
- `worker/src/index.ts`：Worker 路由、D1+KV 存取逻辑、CORS、管理接口
- `worker/wrangler.toml`：环境绑定与变量
- `worker/schema.sql`：D1 表结构（如需迁移/初始化）

---

## 时序流程（玩家一次通关）

1. 玩家登录（校验 `people.json`）
2. 点击拼图块进行首次有效移动 → 前端调用 `POST /begin`
3. 若未超限，开始计时；否则提示不可开始
4. 玩家完成拼图 → 停止计时 → `POST /submit` 写成绩
5. 打开排行榜 → `GET /leaderboard` 展示每用户最佳成绩（含剩余次数）

---

## 运营与安全要点

- CORS 仅放行实际前端域名（`ALLOWED_ORIGINS`）
- 管理口令仅在后端校验；避免在前端硬编码或暴露管理能力
- D1 只存通关记录（便于排序）；KV 只存尝试次数（实时性强）

---

如需基于此文档搭建“新玩法样板”，告诉我游戏类型与计分指标即可。


