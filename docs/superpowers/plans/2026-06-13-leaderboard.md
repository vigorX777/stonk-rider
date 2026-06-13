# 排行榜系统 & 公网部署 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Leek Knight 增加全球排行榜 + 公网部署，玩家通关后提交成绩、查看排名、获取"超过 X% 玩家"的正反馈。

**Architecture:** Cloudflare Pages（前端托管）+ Pages Functions（API）+ D1（SQLite 数据库）。API 同域部署，无 CORS。前端通过 `src/ui/leaderboard.ts` 封装 API 调用，`main.ts` 在通关流程中接入。

**Tech Stack:** TypeScript（前端）, JavaScript（Pages Functions）, Cloudflare D1（SQLite）, wrangler CLI

---

## 文件结构

| 文件 | 职责 | 类型 |
|------|------|------|
| `functions/api/leaderboard.js` | Pages Functions handler：POST 提交/GET 查询 | 新建 |
| `schema.sql` | D1 建表 DDL | 新建 |
| `wrangler.toml` | Cloudflare Pages + D1 绑定配置 | 新建 |
| `src/ui/names.ts` | 随机昵称生成 | 新建 |
| `src/ui/leaderboard.ts` | fetch 封装、类型定义、排行榜状态管理 | 新建 |
| `src/main.ts` | 结果弹窗增加昵称输入 + 排名展示 | 修改 |
| `src/style.css` | 排行榜 UI 样式 | 修改 |
| `README.md` | 部署说明 | 修改 |

---

### Task 1: 数据库 Schema + wrangler 配置

**Files:**
- Create: `schema.sql`
- Create: `wrangler.toml`

- [ ] **Step 1: 创建 `schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS leaderboard (
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

CREATE INDEX IF NOT EXISTS idx_leaderboard_return ON leaderboard(stock_code, return_rate DESC);
CREATE INDEX IF NOT EXISTS idx_leaderboard_player ON leaderboard(player_id, stock_code);
```

- [ ] **Step 2: 创建 `wrangler.toml`**

```toml
name = "leek-knight"
pages_build_output_dir = "dist"
compatibility_date = "2026-06-13"

[[d1_databases]]
binding = "DB"
database_name = "leek-knight-db"
database_id = "PLACEHOLDER"
```

`PLACEHOLDER` 在创建 D1 后替换为实际 database_id。

- [ ] **Step 3: 安装 wrangler 并初始化 D1（手动步骤，用户执行）**

```bash
npm install -g wrangler
wrangler login
wrangler d1 create leek-knight-db
```

记录输出的 `database_id`，填入 `wrangler.toml` 替换 `PLACEHOLDER`。

```bash
wrangler d1 execute leek-knight-db --file=schema.sql
```

Expected: 表创建成功。

- [ ] **Step 4: Commit**

```bash
git add schema.sql wrangler.toml
git commit -m "feat: add D1 schema and wrangler config for leaderboard

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Pages Functions API

**Files:**
- Create: `functions/api/leaderboard.js`

- [ ] **Step 1: 创建 API handler**

```javascript
export async function onRequest(context) {
  const { request, env } = context
  const url = new URL(request.url)

  if (request.method === 'POST') {
    return handlePost(request, env)
  }
  if (request.method === 'GET') {
    return handleGet(url, env)
  }
  return new Response('Method not allowed', { status: 405 })
}

function generateId() {
  return crypto.randomUUID()
}

function validate(body) {
  if (!body || typeof body !== 'object') return false
  if (typeof body.stock_code !== 'string' || !/^\d{6}$/.test(body.stock_code)) return false
  if (typeof body.player_name !== 'string' || body.player_name.length < 2 || body.player_name.length > 12) return false
  if (typeof body.player_id !== 'string' || body.player_id.length < 10) return false
  if (typeof body.return_rate !== 'number' || !isFinite(body.return_rate) || body.return_rate > 100 || body.return_rate < -1) return false
  if (typeof body.progress !== 'number' || body.progress < 1.0) return false
  if (typeof body.initial !== 'number' || body.initial < 1000 || body.initial > 10000000) return false
  if (typeof body.final !== 'number' || !isFinite(body.final)) return false
  if (typeof body.stock_name !== 'string' || body.stock_name.length > 50) return false
  return true
}

async function handlePost(request, env) {
  let body
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!validate(body)) {
    return new Response(JSON.stringify({ error: 'Validation failed' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Check if player already has a better score for this stock
  const existing = await env.DB.prepare(
    'SELECT return_rate FROM leaderboard WHERE player_id = ? AND stock_code = ? ORDER BY return_rate DESC LIMIT 1'
  ).bind(body.player_id, body.stock_code).first()

  const isPersonalBest = !existing || body.return_rate > existing.return_rate

  if (isPersonalBest) {
    await env.DB.prepare(
      `INSERT INTO leaderboard (id, stock_code, stock_name, player_name, player_id, initial, final, return_rate, progress, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      generateId(),
      body.stock_code,
      body.stock_name,
      body.player_name.trim(),
      body.player_id,
      body.initial,
      body.final,
      body.return_rate,
      body.progress,
      new Date().toISOString(),
    ).run()
  }

  // Calculate rank
  const rankResult = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM leaderboard WHERE stock_code = ? AND return_rate > ?'
  ).bind(body.stock_code, body.return_rate).first()

  const totalResult = await env.DB.prepare(
    'SELECT COUNT(DISTINCT player_id) as count FROM leaderboard WHERE stock_code = ?'
  ).bind(body.stock_code).first()

  const rank = (rankResult?.count ?? 0) + 1
  const total = totalResult?.count ?? 1
  const percentile = Math.round((1 - rank / total) * 1000) / 10

  // Get personal best
  const personalBest = await env.DB.prepare(
    'SELECT return_rate FROM leaderboard WHERE player_id = ? AND stock_code = ? ORDER BY return_rate DESC LIMIT 1'
  ).bind(body.player_id, body.stock_code).first()

  const bestRankResult = personalBest
    ? await env.DB.prepare(
        'SELECT COUNT(*) as count FROM leaderboard WHERE stock_code = ? AND return_rate > ?'
      ).bind(body.stock_code, personalBest.return_rate).first()
    : null

  // Get Top 3 (global, across all stocks)
  const top3Result = await env.DB.prepare(
    'SELECT player_name, return_rate, stock_name, stock_code, final FROM leaderboard ORDER BY return_rate DESC LIMIT 3'
  ).all()

  const top3 = (top3Result.results ?? []).map((entry, index) => ({
    player_name: entry.player_name,
    return_rate: entry.return_rate,
    stock_name: entry.stock_name,
    stock_code: entry.stock_code,
    rank: index + 1,
  }))

  return new Response(JSON.stringify({
    rank,
    total_players: total,
    percentile,
    is_personal_best: isPersonalBest,
    personal_best: personalBest
      ? { return_rate: personalBest.return_rate, rank: (bestRankResult?.count ?? 0) + 1 }
      : null,
    top3,
  }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

async function handleGet(url, env) {
  const stock = url.searchParams.get('stock') ?? ''
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '10', 10) || 10))

  let query
  let params
  if (stock) {
    query = 'SELECT player_name, return_rate, final, stock_name, created_at FROM leaderboard WHERE stock_code = ? ORDER BY return_rate DESC LIMIT ?'
    params = [stock, limit]
  } else {
    query = 'SELECT player_name, return_rate, final, stock_name, stock_code, created_at FROM leaderboard ORDER BY return_rate DESC LIMIT ?'
    params = [limit]
  }

  const result = await env.DB.prepare(query).bind(...params).all()
  const totalResult = stock
    ? await env.DB.prepare('SELECT COUNT(DISTINCT player_id) as count FROM leaderboard WHERE stock_code = ?').bind(stock).first()
    : await env.DB.prepare('SELECT COUNT(DISTINCT player_id) as count FROM leaderboard').first()

  const entries = (result.results ?? []).map((entry, index) => ({
    player_name: entry.player_name,
    return_rate: entry.return_rate,
    final: entry.final,
    stock_name: entry.stock_name,
    stock_code: entry.stock_code,
    rank: index + 1,
    created_at: entry.created_at,
  }))

  return new Response(JSON.stringify({
    stock_code: stock || null,
    total_players: totalResult?.count ?? 0,
    entries,
  }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}
```

`functions/api/leaderboard.js` 需要在项目根目录的 `functions/` 目录下。Pages Functions 的文件路径映射为 URL 路径：`functions/api/leaderboard.js` → `/api/leaderboard`。

- [ ] **Step 2: 本地测试 API（需要先完成 Task 1 的 D1 创建）**

```bash
npx wrangler pages dev dist
```

然后用 curl 测试：
```bash
# 测试 POST
curl -X POST http://localhost:8788/api/leaderboard \
  -H "Content-Type: application/json" \
  -d '{"stock_code":"600519","stock_name":"贵州茅台","player_name":"测试","player_id":"test-123-abc-456","initial":100000,"final":115300,"return_rate":0.153,"progress":1.0}'

# 测试 GET
curl http://localhost:8788/api/leaderboard?stock=600519
```

Expected: POST 返回 rank/total/percentile/top3，GET 返回 entries 数组。

- [ ] **Step 3: Commit**

```bash
git add functions/api/leaderboard.js
git commit -m "feat: add leaderboard API handler (POST + GET) for Pages Functions

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 随机昵称生成器

**Files:**
- Create: `src/ui/names.ts`

- [ ] **Step 1: 创建 `src/ui/names.ts`**

```typescript
const ADJECTIVES = [
  '飞车', '稳如', '极限', '极速', '狂暴', '冷静',
  '热血', '越野', '闪电', '钢铁', '追风', '孤胆',
  '沙漠', '山巅', '深渊', '无畏', '暗夜', '黎明',
]

const NOUNS = [
  '骑士', '猎手', '老狗', '韭菜', '游侠', '车神',
  '达人', '先锋', '大师', '玩家', '浪人', '幽灵',
  '舵手', '赌怪', '操盘', '猎豹', '磐石', '烈焰',
]

export function randomName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return adj + noun
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无错误（模块暂未被引用，无类型错误即可）。

- [ ] **Step 3: Commit**

```bash
git add src/ui/names.ts
git commit -m "feat: add random nickname generator

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 排行榜 API Client

**Files:**
- Create: `src/ui/leaderboard.ts`

- [ ] **Step 1: 创建 `src/ui/leaderboard.ts`**

```typescript
export interface LeaderboardEntry {
  player_name: string
  return_rate: number
  final: number
  stock_name: string
  stock_code: string
  rank: number
  created_at?: string
}

export interface LeaderboardSubmitRequest {
  stock_code: string
  stock_name: string
  player_name: string
  player_id: string
  initial: number
  final: number
  return_rate: number
  progress: number
}

export interface LeaderboardSubmitResponse {
  rank: number
  total_players: number
  percentile: number
  is_personal_best: boolean
  personal_best: { return_rate: number; rank: number } | null
  top3: LeaderboardEntry[]
}

export interface LeaderboardQueryResponse {
  stock_code: string | null
  total_players: number
  entries: LeaderboardEntry[]
}

export function getPlayerId(): string {
  const key = 'leek-knight-player-id'
  let id = localStorage.getItem(key)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(key, id)
  }
  return id
}

export async function submitScore(request: LeaderboardSubmitRequest): Promise<LeaderboardSubmitResponse> {
  const response = await fetch('/api/leaderboard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Network error' }))
    throw new Error(error.error ?? `HTTP ${response.status}`)
  }
  return response.json()
}

export async function fetchLeaderboard(stock?: string, limit = 10): Promise<LeaderboardQueryResponse> {
  const params = new URLSearchParams()
  if (stock) params.set('stock', stock)
  params.set('limit', String(limit))
  const response = await fetch(`/api/leaderboard?${params}`)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/ui/leaderboard.ts
git commit -m "feat: add leaderboard API client with submit and query functions

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 通关结果弹窗 — 昵称输入 + 排名展示

**Files:**
- Modify: `src/main.ts`
- Modify: `src/style.css`

- [ ] **Step 1: 修改结果弹窗 HTML 结构**

编辑 `src/main.ts` 的 HTML 模板，替换 `#result-modal` 内的内容（约第 99–101 行）：

```html
  <div id="result-modal" class="result-modal" role="dialog" aria-modal="true">
    <div class="result-card" id="result-card">
      <p id="result-kicker" class="eyebrow"><span></span> RIDE COMPLETE</p>
      <h2 id="result-title">收盘了。</h2>
      <p id="result-copy">你骑完了整条市场曲线。</p>
      <div class="result-number"><span>最终模拟资产</span><strong id="result-balance">¥0</strong><em id="result-return">0%</em></div>
      <div class="result-stats"><div><span>到达日期</span><b id="result-date">--</b></div><div><span>完成进度</span><b id="result-progress">100%</b></div></div>

      <div id="result-leaderboard" class="result-leaderboard" style="display:none">
        <div class="leaderboard-divider"><span>提交排行榜</span></div>
        <label class="leaderboard-name-input">
          <span>输入你的昵称</span>
          <div class="leaderboard-name-row">
            <input id="nickname-input" type="text" minlength="2" maxlength="12" placeholder="你的昵称" autocomplete="off">
            <button id="nickname-random" class="icon-button" type="button" aria-label="随机昵称">🎲</button>
          </div>
          <small class="leaderboard-name-hint">2-12 个字符，中英文/数字</small>
        </label>
        <button id="leaderboard-submit" class="cta-button wide" disabled><span>提交成绩</span><b>↗</b></button>
        <p id="leaderboard-error" class="form-error" role="alert"></p>
      </div>

      <div id="result-ranking" class="result-ranking" style="display:none">
        <div class="leaderboard-divider"><span>全球排名</span></div>
        <div class="ranking-header">
          <b id="ranking-position">🏆 第 — 名</b>
          <span id="ranking-percentile">你已超过全球 —% 的玩家</span>
        </div>
        <div class="ranking-personal">
          <span>📊 个人最佳</span>
          <b id="ranking-best">—</b>
        </div>
        <div class="leaderboard-divider"><span>TOP 3</span></div>
        <ol id="ranking-top3" class="ranking-top3"></ol>
        <button id="ranking-view-all" class="secondary-button">查看完整排行榜</button>
      </div>

      <div class="result-actions">
        <button id="result-retry" class="cta-button"><span>再骑一次</span><b>↻</b></button>
        <button id="result-garage" class="secondary-button">换条赛道</button>
      </div>
    </div>
  </div>

  <div id="full-leaderboard-modal" class="result-modal" role="dialog" aria-modal="true">
    <div class="result-card full-leaderboard-card">
      <p class="eyebrow"><span></span> GLOBAL LEADERBOARD</p>
      <h2>排行榜</h2>
      <div class="leaderboard-filter">
        <label><span>筛选股票</span><select id="leaderboard-filter-stock"></select></label>
      </div>
      <div class="leaderboard-table-wrap">
        <table class="leaderboard-table">
          <thead><tr><th>#</th><th>昵称</th><th>股票</th><th>收益率</th><th>最终金额</th></tr></thead>
          <tbody id="leaderboard-tbody"></tbody>
        </table>
      </div>
      <button id="close-leaderboard" class="secondary-button" style="margin-top:16px">关闭</button>
    </div>
  </div>
```

- [ ] **Step 2: 添加 import 和新函数**

在 `src/main.ts` 顶部 import 区域新增：

```typescript
import { randomName } from './ui/names'
import { getPlayerId, submitScore, fetchLeaderboard, type LeaderboardSubmitResponse } from './ui/leaderboard'
```

在 `showResult` 函数之前新增辅助函数：

```typescript
function resetLeaderboardUI(): void {
  $('#result-leaderboard').style.display = 'block'
  $('#result-ranking').style.display = 'none'
  $<HTMLInputElement>('#nickname-input').value = ''
  $<HTMLButtonElement>('#leaderboard-submit').disabled = true
  $('#leaderboard-error').textContent = ''
}

function renderRankingResult(response: LeaderboardSubmitResponse): void {
  $('#result-leaderboard').style.display = 'none'
  $('#result-ranking').style.display = 'block'
  $('#ranking-position').textContent = `🏆 第 ${response.rank} 名`
  $('#ranking-percentile').textContent = `你已超过全球 ${response.percentile}% 的玩家`
  if (response.personal_best) {
    const sign = response.personal_best.return_rate >= 0 ? '+' : ''
    $('#ranking-best').textContent = `第 ${response.personal_best.rank} 名 (${sign}${(response.personal_best.return_rate * 100).toFixed(2)}%)`
  } else {
    $('#ranking-best').textContent = '首次上榜'
  }
  $('#ranking-top3').innerHTML = response.top3.map((entry) => {
    const medal = entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : '🥉'
    const sign = entry.return_rate >= 0 ? '+' : ''
    return `<li><b>${medal}</b><strong>${escapeHtml(entry.player_name)}</strong><span>${sign}${(entry.return_rate * 100).toFixed(1)}%</span><small>${escapeHtml(entry.stock_name)}</small></li>`
  }).join('')
}

function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}
```

- [ ] **Step 3: 修改 `showResult` 函数加入排行榜逻辑**

替换 `showResult` 函数（约第 377–389 行）：

```typescript
function showResult(result: RunResult): void {
  audio.stopEngine()
  const totalReturn = calculateReturn(result.initialAmount, result.finalAmount)
  $('#result-kicker').innerHTML = `<span></span> ${result.reason === 'finished' ? 'RIDE COMPLETE' : 'MARKET CRASH'}`
  $('#result-title').textContent = result.reason === 'finished' ? '收盘了。' : '翻车了。'
  $('#result-copy').textContent = result.reason === 'finished'
    ? `你骑完了 ${result.stock.name} 的整条年度曲线。`
    : '市场不会等你站稳。调整速度，再试一次。'
  $('#result-balance').textContent = formatMoney(result.finalAmount)
  $('#result-return').textContent = formatPercent(totalReturn)
  $('#result-return').className = totalReturn >= 0 ? 'up' : 'down'
  $('#result-date').textContent = result.date
  $('#result-progress').textContent = `${Math.round(result.progress * 100)}%`

  // Leaderboard: only show for completed runs
  if (result.reason === 'finished' && result.progress >= 1.0) {
    resetLeaderboardUI()
  } else {
    $('#result-leaderboard').style.display = 'none'
    $('#result-ranking').style.display = 'none'
  }

  $('#result-modal').classList.add('is-visible')
}
```

- [ ] **Step 4: 连接昵称输入和提交按钮的事件**

在 `startRide` 函数中（或单独的事件绑定区域），新增事件监听：

在文件末尾（`updateSoundLabels()` 之前）新增事件绑定：

```typescript
// Nickname input validation
$<HTMLInputElement>('#nickname-input').addEventListener('input', () => {
  const value = $<HTMLInputElement>('#nickname-input').value.trim()
  $<HTMLButtonElement>('#leaderboard-submit').disabled = value.length < 2 || value.length > 12
})

// Random nickname button
$('#nickname-random').addEventListener('click', () => {
  $<HTMLInputElement>('#nickname-input').value = randomName()
  $<HTMLButtonElement>('#leaderboard-submit').disabled = false
  audio.play('ui')
})

// Submit score
$('#leaderboard-submit').addEventListener('click', async () => {
  const button = $('#leaderboard-submit') as HTMLButtonElement
  const error = $('#leaderboard-error')
  button.disabled = true
  error.textContent = '提交中…'

  try {
    const currentStock = stockDatasets.get(selectedCode)
    if (!currentStock) throw new Error('Stock data not found')

    const playerId = getPlayerId()
    const playerName = $<HTMLInputElement>('#nickname-input').value.trim()
    const lastBalance = lastAmount
    const finalBalanceEl = $('#result-balance')
    const returnEl = $('#result-return')

    // Parse final balance from displayed text
    const finalBalance = parseFloat(finalBalanceEl.textContent!.replace(/[^0-9.-]/g, ''))
    const returnRate = parseFloat(returnEl.textContent!.replace(/[^0-9.-]/g, '')) / 100

    const response = await submitScore({
      stock_code: currentStock.metadata.code,
      stock_name: currentStock.metadata.name,
      player_name: playerName,
      player_id: playerId,
      initial: lastBalance,
      final: finalBalance || lastBalance,
      return_rate: isNaN(returnRate) ? 0 : returnRate,
      progress: 1.0,
    })

    renderRankingResult(response)
    error.textContent = ''
    audio.play('ui')
  } catch (err) {
    error.textContent = err instanceof Error ? err.message : '提交失败，请稍后重试'
  } finally {
    button.disabled = false
  }
})

// View full leaderboard
$('#ranking-view-all').addEventListener('click', async () => {
  const currentStock = stockDatasets.get(selectedCode)
  const stockCode = currentStock?.metadata.code
  $('#full-leaderboard-modal').classList.add('is-visible')
  await loadFullLeaderboard(stockCode)
})

$('#close-leaderboard').addEventListener('click', () => {
  $('#full-leaderboard-modal').classList.remove('is-visible')
})

async function loadFullLeaderboard(stockCode?: string): Promise<void> {
  try {
    const data = await fetchLeaderboard(stockCode, 50)
    const playerId = getPlayerId()
    const tbody = $('#leaderboard-tbody')
    tbody.innerHTML = data.entries.map((entry) => {
      const sign = entry.return_rate >= 0 ? '+' : ''
      const isMe = false // highlight logic uses player_id; full leaderboard doesn't expose it
      return `<tr class="${isMe ? 'is-me' : ''}">
        <td>${entry.rank}</td>
        <td>${escapeHtml(entry.player_name)}</td>
        <td>${escapeHtml(entry.stock_name)}</td>
        <td class="${entry.return_rate >= 0 ? 'up' : 'down'}">${sign}${(entry.return_rate * 100).toFixed(1)}%</td>
        <td>${formatMoney(entry.final)}</td>
      </tr>`
    }).join('')
  } catch {
    $('#leaderboard-tbody').innerHTML = '<tr><td colspan="5">加载失败，请稍后重试</td></tr>'
  }
}

// Populate stock filter in full leaderboard
function populateLeaderboardFilter(): void {
  const select = $<HTMLSelectElement>('#leaderboard-filter-stock')
  select.innerHTML = '<option value="">全部股票</option>' +
    stocks.map((s) => `<option value="${s.code}">${s.name} (${s.code})</option>`).join('')
  select.addEventListener('change', () => {
    void loadFullLeaderboard(select.value || undefined)
  })
}
```

在 `enterGarage` 函数加载完 stocks 后调用 `populateLeaderboardFilter()`。

- [ ] **Step 5: 新增排行榜 CSS 样式**

在 `src/style.css` 末尾新增：

```css
.result-leaderboard{margin-top:18px;padding-top:18px;border-top:1px solid #2b3037}.leaderboard-divider{display:flex;align-items:center;gap:12px;margin:14px 0;color:#5f6670;font-size:9px;text-transform:uppercase;letter-spacing:.14em}.leaderboard-divider span{flex-shrink:0}.leaderboard-divider:after{content:'';flex:1;height:1px;background:#2b3037}.leaderboard-name-input{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}.leaderboard-name-input>span{color:#858b94;font-size:9px;text-transform:uppercase}.leaderboard-name-row{display:flex;gap:6px}.leaderboard-name-row input{flex:1;background:#0c0e11;border:1px solid #353b44;color:var(--cream);padding:12px;font-family:'Barlow Condensed';font-size:24px;outline:none}.leaderboard-name-row input:focus{border-color:var(--amber)}.leaderboard-name-hint{color:#555c65;font-size:8px}.ranking-header{text-align:center;padding:12px 0}.ranking-header b{display:block;font-family:'Barlow Condensed';font-size:42px;line-height:1;color:var(--amber)}.ranking-header span{color:#858b94;font-size:11px;margin-top:4px;display:block}.ranking-personal{display:flex;justify-content:space-between;align-items:center;background:#0b0d10;padding:10px 12px;margin:8px 0}.ranking-personal span{color:#6f7580;font-size:9px}.ranking-personal b{color:var(--cream);font-size:11px}.ranking-top3{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}.ranking-top3 li{display:grid;grid-template-columns:32px 1fr auto;align-items:center;gap:8px;background:#0b0d10;padding:8px 12px}.ranking-top3 li b{font-size:16px}.ranking-top3 li strong{font-family:'Barlow Condensed';font-size:15px}.ranking-top3 li span{font-size:13px;font-weight:700}.ranking-top3 li small{color:#6f7580;font-size:9px}
.full-leaderboard-card{max-width:600px;max-height:85vh;overflow-y:auto}.leaderboard-filter{margin:12px 0}.leaderboard-filter label{display:flex;flex-direction:column;gap:4px}.leaderboard-filter span{color:#858b94;font-size:9px;text-transform:uppercase}.leaderboard-filter select{background:#0c0e11;border:1px solid #353b44;color:var(--cream);padding:10px;font:inherit;outline:none}.leaderboard-filter select:focus{border-color:var(--amber)}.leaderboard-table-wrap{max-height:55vh;overflow-y:auto}.leaderboard-table{width:100%;border-collapse:collapse;font-size:11px}.leaderboard-table th{text-align:left;color:#6f7580;font-size:8px;text-transform:uppercase;letter-spacing:.1em;padding:8px 6px;border-bottom:1px solid #2b3037;position:sticky;top:0;background:#111419}.leaderboard-table td{padding:8px 6px;border-bottom:1px solid #1e2229}.leaderboard-table tr.is-me td{background:#ffb00012;color:var(--amber)}.leaderboard-table td.up{color:var(--red)}.leaderboard-table td.down{color:var(--green)}
```

- [ ] **Step 6: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 零类型错误。

- [ ] **Step 7: Commit**

```bash
git add src/main.ts src/style.css
git commit -m "feat: add leaderboard submission UI with nickname input and ranking display

- Nickname input with validation (2-12 chars) and random generator
- Submit score to /api/leaderboard on completion
- Ranking result shows position, percentile, personal best, top 3
- Full leaderboard modal with stock filter
- Only shown for 100% completed runs

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 更新 README 和测试

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 更新 README 增加部署和排行榜说明**

在 `README.md` 末尾追加：

```markdown
## 排行榜

通关整条赛道后可提交成绩到全球排行榜。你的排名基于总收益率，同一浏览器同一股票保留最高分。

## 部署

本项目部署在 Cloudflare Pages，后端 API 使用 Pages Functions，数据存储使用 Cloudflare D1。

### 首次部署

```bash
# 1. 安装 wrangler
npm install -g wrangler

# 2. 登录 Cloudflare
wrangler login

# 3. 创建 D1 数据库
wrangler d1 create leek-knight-db
# 将输出的 database_id 填入 wrangler.toml

# 4. 执行建表
wrangler d1 execute leek-knight-db --file=schema.sql

# 5. 构建并部署
npm run build
wrangler pages deploy dist/
```

### 更新部署

```bash
npm run build
wrangler pages deploy dist/
```
```

- [ ] **Step 2: 运行全量测试 + 构建**

```bash
npm run build
npx vitest run
```

Expected: 测试全部通过，构建成功。

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add leaderboard and deployment instructions to README

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: 首次部署（手动步骤，用户执行）

- [ ] **Step 1: 确保已安装 wrangler 并登录**

```bash
npm install -g wrangler
wrangler login
```

- [ ] **Step 2: 创建 D1 数据库**

```bash
wrangler d1 create leek-knight-db
```

复制输出的 `database_id`，编辑 `wrangler.toml` 替换 `PLACEHOLDER`：

```toml
database_id = "your-actual-database-id"
```

- [ ] **Step 3: 执行建表 SQL**

```bash
wrangler d1 execute leek-knight-db --file=schema.sql
```

Expected: ✅ SQL 执行成功。

- [ ] **Step 4: 本地测试 API**

```bash
npx wrangler pages dev dist
```

另开终端测试：
```bash
curl -X POST http://localhost:8788/api/leaderboard \
  -H "Content-Type: application/json" \
  -d '{"stock_code":"600519","stock_name":"贵州茅台","player_name":"测试骑手","player_id":"test-xxx-123","initial":100000,"final":115300,"return_rate":0.153,"progress":1.0}'
```

Expected: 返回 `{"rank":1,"total_players":1,"percentile":0,...}` 格式的 JSON。

- [ ] **Step 5: 构建并部署**

```bash
npm run build
wrangler pages deploy dist/
```

- [ ] **Step 6: 公网验证**

打开部署后的 URL（形如 `https://leek-knight.pages.dev`），完成一轮游戏，提交成绩，验证 API 正常返回排名。

---

## 实现顺序

```
Task 1 (schema.sql + wrangler.toml)   ← 配置基础
Task 2 (Pages Functions API)         ← 后端核心
Task 3 (随机昵称)          ─┐
Task 4 (API client)        ├─ 可并行
Task 5 (DOM UI + CSS)     ─┘
Task 6 (README)                      ← 文档
Task 7 (部署)                         ← 手动执行
```

Tasks 3/4 可并行（无相互依赖），Task 5 依赖 Task 4（import API client）。

## 注意事项

1. **Pages Functions 文件路径**：`functions/api/leaderboard.js` → URL 映射为 `/api/leaderboard`。Cloudflare Pages 自动将 `functions/` 目录下的文件映射为 HTTP 端点。

2. **D1 绑定**：`wrangler.toml` 中的 `[[d1_databases]]` 配置使 `env.DB` 在 Functions 中可用。本地开发用 `--d1=DB` 标志。

3. **CORS**：API 返回 `Access-Control-Allow-Origin: *`，OPTIONS 预检请求单独处理。但如果 API 和前端同域部署（都在 Cloudflare Pages），实际上不需要 CORS — 保留作为安全网。

4. **限流**：Cloudflare Pages 默认提供 DDoS 保护。如需更精细的速率限制，可在 `wrangler.toml` 中配置或通过 Cloudflare Dashboard 的 WAF 规则设置。

5. **成本**：在免费额度内，预计支持 ~10 万玩家/天无任何费用。
