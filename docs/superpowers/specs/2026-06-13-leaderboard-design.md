# 排行榜系统 & 公网部署 — 设计文档

## 概述

为 Leek Knight 增加全球排行榜系统：玩家通关后提交成绩，可查看所在赛道的全局排名、个人最佳成绩、Top 3 榜单。"你已超过全球 X% 的玩家"提供社交比较驱动。

部署到 Cloudflare Pages + Workers + D1，零成本运维。

---

## 1. 架构

```
玩家浏览器                            Cloudflare
┌──────────────┐                ┌──────────────────┐
│  Leek Knight │  POST/GET      │  Pages Functions │
│  (静态前端)   │ ◄────────────▶ │  /api/leaderboard │
│              │                │         │        │
└──────────────┘                │         ▼        │
                                │     D1 (SQL)     │
                                └──────────────────┘
```

- **前端**：部署到 Cloudflare Pages，全球 CDN
- **API**：Cloudflare Pages Functions（同域，无 CORS）
- **数据库**：Cloudflare D1（SQLite，边缘分布）

## 2. 数据模型

```sql
CREATE TABLE leaderboard (
  id          TEXT PRIMARY KEY,
  stock_code  TEXT NOT NULL,
  stock_name  TEXT NOT NULL,
  player_name TEXT NOT NULL,
  player_id   TEXT NOT NULL,
  initial     REAL NOT NULL,
  final       REAL NOT NULL,
  return_rate REAL NOT NULL,
  progress    REAL NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_return ON leaderboard(stock_code, return_rate DESC);
CREATE INDEX idx_player ON leaderboard(player_id, stock_code);
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 每条记录唯一标识 |
| stock_code | TEXT | 股票代码如 '600519' |
| stock_name | TEXT | 股票名称如 '贵州茅台' |
| player_name | TEXT | 玩家输入的昵称 |
| player_id | UUID | 浏览器指纹（localStorage） |
| initial | REAL | 初始金额 |
| final | REAL | 最终余额 |
| return_rate | REAL | 总收益率 |
| progress | REAL | 完成进度 0.0~1.0 |
| created_at | TEXT | ISO 8601 时间戳 |

## 3. API 设计

### POST /api/leaderboard

提交一次成绩。同一 `player_id` × 同一 `stock_code` 保留最高分（`return_rate DESC LIMIT 1`）。

**请求体：**
```json
{
  "stock_code": "600519",
  "stock_name": "贵州茅台",
  "player_name": "飞车侠",
  "initial": 100000,
  "final": 115300,
  "return_rate": 0.153,
  "progress": 1.0
}
```

**响应体：**
```json
{
  "rank": 42,
  "total_players": 1280,
  "percentile": 96.7,
  "is_personal_best": true,
  "personal_best": {
    "return_rate": 0.153,
    "rank": 42
  },
  "top3": [
    { "player_name": "飞车侠", "return_rate": 0.62, "stock_name": "东方财富", "rank": 1 },
    { "player_name": "稳如狗", "return_rate": 0.48, "stock_name": "比亚迪",   "rank": 2 },
    { "player_name": "韭菜王", "return_rate": 0.39, "stock_name": "宁德时代", "rank": 3 }
  ]
}
```

### GET /api/leaderboard?stock=CODE&limit=10

查询指定股票的 Top N。

**响应体：**
```json
{
  "stock_code": "600519",
  "stock_name": "贵州茅台",
  "total_players": 1280,
  "entries": [
    { "player_name": "飞车侠", "return_rate": 0.62, "final": 162000, "rank": 1, "created_at": "2026-06-13T10:30:00Z" },
    ...
  ]
}
```

## 4. 前端流程

### 4.1 玩家身份

首次访问时生成 UUID 存 localStorage：
```typescript
function getPlayerId(): string {
  const key = 'leek-knight-player-id'
  let id = localStorage.getItem(key)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(key, id)
  }
  return id
}
```

### 4.2 昵称输入

通关后，在结果弹窗中增加一步昵称输入：

```
┌─────────────────────────────────┐
│  🏁 收盘了。                     │
│  你骑完了贵州茅台的整条年度曲线。   │
│                                 │
│  最终模拟资产  ¥115,300          │
│  总收益率      +15.3%            │
│                                 │
│  ─── 提交排行榜 ───             │
│  输入你的昵称                    │
│  ┌──────────────────┐ 🎲       │
│  │ 飞车侠            │          │
│  └──────────────────┘           │
│                                 │
│  [提交成绩]  [再骑一次]  [换赛道] │
└─────────────────────────────────┘
```

- 昵称限制：2-12 个字符，中英文/数字/下划线
- 点 🎲 随机生成一个名字
- 输入为空时禁用提交按钮
- 提交后原地替换为排名结果

### 4.3 随机昵称生成

```typescript
const ADJECTIVES = ['飞车', '稳如', '极限', '极速', '狂暴', '冷静', '热血', '越野', '闪电', '钢铁']
const NOUNS = ['骑士', '猎手', '老狗', '韭菜', '游侠', '车神', '达人', '先锋', '大师', '玩家']

function randomName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return adj + noun
}
```

### 4.4 排名结果展示

提交成功后替换为排名卡片：

```
┌─────────────────────────────────┐
│  🏆 第 42 名                    │
│  你已超过全球 96.7% 的玩家       │
│  📊 个人最佳：第 42 名 (+15.3%)  │
│                                 │
│  ─── 贵州茅台 TOP 3 ───        │
│  🥇 飞车侠  +62.0%  ¥162,000   │
│  🥈 稳如狗  +48.2%  ¥148,200   │
│  🥉 韭菜王  +39.1%  ¥139,100   │
│                                 │
│  [再骑一次]  [查看完整排行榜]    │
└─────────────────────────────────┘
```

### 4.5 完整排行榜页面

点击"查看完整排行榜"后展示 Top 50（分页或滚动加载）：

| # | 昵称 | 股票 | 收益率 | 最终金额 |
|---|------|------|--------|---------|
| 1 | 飞车侠 | 东方财富 | +62.0% | ¥162,000 |
| 2 | 稳如狗 | 比亚迪 | +48.2% | ¥148,200 |
| ... | ... | ... | ... | ... |
| 42 | **你** | 贵州茅台 | **+15.3%** | **¥115,300** |

玩家自己的行高亮显示。

## 5. 后端验证

### 5.1 输入校验

```typescript
function validate(body: any): body is LeaderboardEntry {
  if (typeof body.stock_code !== 'string' || !/^\d{6}$/.test(body.stock_code)) return false
  if (typeof body.player_name !== 'string' || body.player_name.length < 2 || body.player_name.length > 12) return false
  if (typeof body.return_rate !== 'number' || !isFinite(body.return_rate) || body.return_rate > 100 || body.return_rate < -1) return false
  if (typeof body.progress !== 'number' || body.progress < 1.0) return false
  if (typeof body.initial !== 'number' || body.initial < 1000 || body.initial > 10000000) return false
  return true
}
```

### 5.2 防滥用

- **限流**：Cloudflare Pages Functions 自带，可配置 10 req/s per IP
- **只接受完整通关**：`progress >= 1.0`
- **异常值拒绝**：`return_rate > 100` 或 `< -1`
- **同人同股保最高**：INSERT 前先查已有记录，只在新成绩更高时 INSERT

## 6. 部署架构

### 6.1 云资源

| 资源 | 平台 | 免费额度 |
|------|------|---------|
| 前端托管 | Cloudflare Pages | 无限带宽 |
| API | Pages Functions | 10 万请求/天 |
| 数据库 | Cloudflare D1 | 5GB 存储，10 亿行读取/月 |

### 6.2 项目结构新增

```
stock-ridier/
├── functions/
│   └── api/
│       └── leaderboard.js       # Pages Functions handler
├── src/
│   └── ui/
│       ├── leaderboard.ts       # API client
│       └── names.ts             # 随机昵称生成
├── wrangler.toml                # Cloudflare 配置
├── schema.sql                   # D1 建表 SQL
└── ...
```

### 6.3 wrangler.toml

```toml
name = "leek-knight"
pages_build_output_dir = "dist"
compatibility_date = "2026-06-13"

[[d1_databases]]
binding = "DB"
database_name = "leek-knight-db"
database_id = "your-database-id"
```

### 6.4 部署流程

```bash
# 1. 安装 wrangler
npm install -g wrangler

# 2. 登录
wrangler login

# 3. 创建 D1 数据库
wrangler d1 create leek-knight-db

# 4. 执行建表
wrangler d1 execute leek-knight-db --file=schema.sql

# 5. 部署
npm run build
wrangler pages deploy dist/
```

## 7. 涉及文件

| 文件 | 职责 | 类型 |
|------|------|------|
| `functions/api/leaderboard.js` | API handler（POST + GET） | 新建 |
| `schema.sql` | D1 建表语句 | 新建 |
| `wrangler.toml` | Cloudflare 配置 | 新建 |
| `src/ui/names.ts` | 随机昵称生成 | 新建 |
| `src/ui/leaderboard.ts` | API client + 排行榜状态 | 新建 |
| `src/main.ts` | 结果弹窗增加昵称输入 + 排名展示 | 修改 |
| `src/style.css` | 排行榜 UI 样式 | 修改 |
| `README.md` | 部署说明 | 修改 |

## 8. 验收标准

1. 通关后显示昵称输入界面 + 随机昵称按钮
2. 提交后 API 返回排名、百分位、个人最佳、Top 3
3. 同一 player_id + 同一股票保留最高分
4. 进度 < 100% 的结果被拒绝
5. 异常收益率被拒绝
6. GET 接口返回正确的 Top N
7. `npm run build` 后部署到 Cloudflare Pages 可公网访问
8. Pages Functions 可正常读写 D1
