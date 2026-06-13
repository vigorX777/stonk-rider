import '@fontsource/barlow-condensed/latin-500.css'
import '@fontsource/barlow-condensed/latin-600.css'
import '@fontsource/barlow-condensed/latin-700.css'
import '@fontsource/barlow-condensed/latin-800.css'
import '@fontsource/barlow-condensed/latin-800-italic.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-600.css'
import './style.css'
import { loadStock, loadStockIndex } from './data/stocks'
import { GameAudio } from './game/audio'
import { calculateReturn, formatMoney, formatPercent } from './game/balance'
import { buildChartGeometry, buildLinePath, type ChartPoint } from './ui/chart'
import { getPlayerId, submitScore, fetchLeaderboard, type LeaderboardSubmitResponse } from './ui/leaderboard'
import { randomName } from './ui/names'
import type { LeekKnightGame } from './game/LeekKnightGame'
import type { ComboSlot, DualComboState, RunResult, SettlementPoint, StockDataset, StockMetadata } from './types'

const app = document.querySelector<HTMLDivElement>('#app')!
const audio = new GameAudio()
let stocks: StockMetadata[] = []
const stockDatasets = new Map<string, StockDataset>()
let selectedCode = localStorage.getItem('leek-knight-stock') ?? '600519'
let currentGame: LeekKnightGame | null = null
let lastAmount = Number(localStorage.getItem('leek-knight-amount') ?? 100000)
let overviewPoints: ChartPoint[] = []
let balanceAnimationUntil = 0
let balanceAnimationFrame = 0
let lastRunResult: RunResult | null = null
let leaderboardFilterReady = false

app.innerHTML = `
  <div class="ambient-grid"></div>
  <main id="landing" class="screen landing-screen is-active">
    <nav class="topbar">
      <a class="brand" href="#"><span class="brand-mark">LK</span><span>韭菜骑士</span></a>
      <div class="topbar-actions">
        <a class="repo-link" href="https://github.com/vigorX777/leek-knight" target="_blank" rel="noreferrer">GitHub Repo</a>
        <button id="sound-top" class="icon-button" aria-label="切换音效">SOUND ON</button>
      </div>
    </nav>
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow"><span></span> A-SHARE PHYSICS EXPERIMENT</p>
        <h1>骑上<br><em>市场曲线</em></h1>
        <p class="hero-lead">把真实 A 股近一年走势变成越野赛道。油门、重心与市场波动，缺一不可。</p>
        <button id="play-now" class="cta-button"><span>PLAY NOW</span><b>→</b></button>
        <p class="disclaimer">娱乐作品 · 历史数据可视化 · 不构成任何投资建议</p>
        <p class="author-credit">Made by <b>vigorxu</b> · 韭菜骑士 / Leek Knight creator</p>
      </div>
        <div class="hero-art" aria-hidden="true">
        <div class="sun"></div><div class="chart-line"></div>
        <div class="bike-poster"><div class="poster-wheel rear"></div><div class="poster-wheel front"></div><div class="poster-frame"></div><div class="poster-rider"></div></div>
        <div class="ticker-strip">600519 <i>+1.92%</i>　300750 <i>-2.14%</i>　002594 <i>+3.08%</i>　601899 <i>+1.33%</i></div>
      </div>
    </section>
    <section class="control-legend"><div><kbd>W / ↑</kbd><span>加速</span></div><div><kbd>S / ↓</kbd><span>刹车</span></div><div><kbd>A / ←</kbd><span>翘头</span></div><div><kbd>D / →</kbd><span>下压</span></div><div><kbd>SPACE</kbd><span>跳跃</span></div><div><kbd>R</kbd><span>重启</span></div></section>
  </main>

  <main id="setup" class="screen setup-screen">
    <nav class="topbar"><button id="back-home" class="text-button">← 返回首页</button><div class="step-indicator"><b>01</b> 选择你的赛道</div></nav>
    <section class="setup-layout">
      <header class="setup-header"><p class="eyebrow"><span></span> MARKET GARAGE</p><h2>选一支股票<br>发动引擎</h2><p>每条赛道都来自真实日线。波动越大，坡度越狠。</p></header>
      <div id="stock-grid" class="stock-grid"><div class="loading-card">正在读取市场赛道…</div></div>
      <aside class="amount-panel">
        <div><span class="panel-index">02</span><h3>初始金额</h3><p>余额将按照每段真实涨跌幅复利变化。</p></div>
        <div class="amount-presets"><button data-amount="10000">¥1万</button><button data-amount="50000">¥5万</button><button data-amount="100000" class="is-selected">¥10万</button></div>
        <label class="amount-input"><span>自定义金额</span><input id="amount" type="number" min="1000" max="10000000" step="1000" value="100000"><b>CNY</b></label>
        <button id="start-ride" class="cta-button wide"><span>START RIDE</span><b>→</b></button>
        <p id="setup-error" class="form-error" role="alert"></p>
      </aside>
    </section>
  </main>

  <main id="game" class="screen game-screen">
    <div id="game-root" tabindex="0"></div>
    <div class="game-vignette"></div>
    <header class="hud-top">
      <button id="exit-game" class="hud-button">× 退出</button>
      <div class="stock-hud"><span id="hud-code">600519</span><b id="hud-name">贵州茅台</b><small id="hud-date">--</small></div>
      <div class="hud-actions"><button id="restart-game" class="hud-button">R 重启</button><button id="sound-game" class="hud-button">声音</button></div>
    </header>
    <section id="balance-hud" class="balance-hud" aria-live="polite">
      <span>模拟资产</span><strong id="hud-balance">¥100,000</strong><em id="hud-return">+0.00%</em>
      <div class="balance-burst" aria-hidden="true">${Array.from({ length: 16 }, (_, index) => `<i style="--i:${index}"></i>`).join('')}</div>
    </section>
    <section class="ride-feedback">
      <header><span id="hud-traction">等待抓地</span><b id="hud-drive-mode">滑行</b></header>
      <div id="hud-pitch" class="pitch-feedback neutral" data-angle="0"><span>A / ←</span><b>车身中立</b><span>D / →</span></div>
      <div class="throttle-meter"><i id="hud-throttle"></i></div>
      <footer><span>油门</span><b id="hud-next-settlement">下一结算 --</b></footer>
      <div class="settlement-meter"><i id="hud-settlement-progress"></i></div>
    </section>
    <aside class="market-overview">
      <header><span>一年走势总览</span><b id="overview-progress">0%</b></header>
      <svg id="overview-chart" viewBox="0 0 300 104" role="img" aria-label="当前股票近一年 K 线总览"></svg>
      <footer><span id="overview-start">--</span><span id="overview-end">--</span></footer>
    </aside>
    <section class="speed-hud"><b id="hud-speed">00</b><span>KM/H</span></section>
    <div class="progress-track"><i id="hud-progress"></i></div>
    <div id="settlement-toast" class="settlement-toast"><small>MARKET PAYOUT</small><b>+2.31%</b><strong>+¥2,310</strong><span>本段收益已结算</span></div>
    <div id="combo-hud" class="combo-hud">
      <div class="combo-slot gain"><b>涨 COMBO</b><strong id="gain-multiplier">—</strong><span id="gain-count"></span></div>
      <div class="combo-slot loss"><b>跌 COMBO</b><strong id="loss-multiplier">—</strong><span id="loss-count"></span></div>
    </div>
    <div id="respawn-toast" class="respawn-toast"><b>摔车</b><span>原地复位 · 继续骑</span></div>
    <div class="game-controls"><span>W / ↑ 油门</span><span>A / ← 翘头</span><span>D / → 下压</span><span>SPACE 跳跃</span><span>S / ↓ 刹车</span></div>
  </main>

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
            <button id="nickname-random" class="icon-button" type="button" aria-label="随机昵称">骰</button>
          </div>
          <small class="leaderboard-name-hint">2-12 个字符，中英文/数字/下划线</small>
        </label>
        <button id="leaderboard-submit" class="cta-button wide" disabled><span>提交成绩</span><b>↗</b></button>
        <p id="leaderboard-error" class="form-error" role="alert"></p>
      </div>

      <div id="result-ranking" class="result-ranking" style="display:none">
        <div class="leaderboard-divider"><span>全球排名</span></div>
        <div class="ranking-header">
          <b id="ranking-position">第 — 名</b>
          <span id="ranking-percentile">你已超过全球 —% 的玩家</span>
        </div>
        <div class="ranking-personal">
          <span>个人最佳</span>
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
      <button id="close-leaderboard" class="secondary-button leaderboard-close">关闭</button>
    </div>
  </div>
  <div id="mobile-warning"><b>请横屏并使用桌面浏览器</b><span>韭菜骑士首版需要键盘控制。</span></div>
`

const $ = <T extends HTMLElement>(selector: string): T => document.querySelector<T>(selector)!

function showScreen(id: 'landing' | 'setup' | 'game'): void {
  document.querySelectorAll('.screen').forEach((screen) => screen.classList.toggle('is-active', screen.id === id))
}

function updateSoundLabels(): void {
  $('#sound-top').textContent = audio.isMuted ? 'SOUND OFF' : 'SOUND ON'
  $('#sound-game').textContent = audio.isMuted ? '声音：关' : '声音：开'
  for (const selector of ['#sound-top', '#sound-game']) {
    const button = $(selector)
    button.dataset.audioState = audio.contextState
    button.dataset.engineRunning = String(audio.engineRunning)
    button.dataset.bgmRunning = String(audio.bgmRunning)
  }
}

function renderStocks(): void {
  $('#stock-grid').innerHTML = stocks.map((stock, index) => {
    const dataset = stockDatasets.get(stock.code)
    const path = dataset ? buildLinePath(dataset.candles.map((candle) => candle.close), 180, 44, 3) : ''
    return `
    <button class="stock-card ${stock.code === selectedCode ? 'is-selected' : ''}" data-code="${stock.code}" style="--delay:${index * 25}ms">
      <div class="stock-card-top"><span>${stock.exchange}:${stock.code}</span><i class="difficulty ${stock.difficulty.toLowerCase()}">${stock.difficulty}</i></div>
      <strong>${stock.name}</strong><small>${stock.sector}</small>
      <div class="mini-chart ${stock.oneYearReturn >= 0 ? 'positive' : 'negative'}"><svg viewBox="0 0 180 44" preserveAspectRatio="none"><path d="${path}"/></svg><span>${stock.dataStart.slice(5)} → ${stock.dataEnd.slice(5)}</span></div>
      <div class="stock-stats"><span>近一年 <b class="${stock.oneYearReturn >= 0 ? 'up' : 'down'}">${formatPercent(stock.oneYearReturn)}</b></span><span>波动 <b>${(stock.volatility * 100).toFixed(1)}%</b></span></div>
    </button>
  `}).join('')
  document.querySelectorAll<HTMLButtonElement>('.stock-card').forEach((button) => button.addEventListener('click', () => {
    selectedCode = button.dataset.code!
    localStorage.setItem('leek-knight-stock', selectedCode)
    document.querySelectorAll('.stock-card').forEach((card) => card.classList.toggle('is-selected', card === button))
    audio.play('ui')
  }))
}

async function enterGarage(): Promise<void> {
  showScreen('setup')
  await audio.unlock().catch(() => undefined)
  audio.play('ui')
  updateSoundLabels()
  if (stocks.length) {
    populateLeaderboardFilter()
    return
  }
  try {
    stocks = await loadStockIndex()
    if (!stocks.some((stock) => stock.code === selectedCode)) selectedCode = stocks[0].code
    const datasets = await Promise.all(stocks.map((stock) => loadStock(stock.code)))
    datasets.forEach((dataset) => stockDatasets.set(dataset.metadata.code, dataset))
    renderStocks()
    populateLeaderboardFilter()
  } catch (error) {
    $('#stock-grid').innerHTML = `<div class="loading-card error">${error instanceof Error ? error.message : '数据加载失败'}</div>`
  }
}

async function startRide(): Promise<void> {
  const error = $('#setup-error')
  const amount = Number($<HTMLInputElement>('#amount').value)
  if (!Number.isFinite(amount) || amount < 1000 || amount > 10000000) {
    error.textContent = '请输入 ¥1,000 到 ¥10,000,000 之间的金额。'
    return
  }
  error.textContent = '正在装载 K 线赛道…'
  const button = $('#start-ride') as HTMLButtonElement
  button.disabled = true
  try {
    await audio.unlock().catch(() => undefined)
    const stock = stockDatasets.get(selectedCode) ?? await loadStock(selectedCode)
    const { LeekKnightGame } = await import('./game/LeekKnightGame')
    lastAmount = amount
    localStorage.setItem('leek-knight-amount', String(amount))
    $('#hud-code').textContent = `${stock.metadata.exchange}:${stock.metadata.code}`
    $('#hud-name').textContent = stock.metadata.name
    $('#hud-balance').textContent = formatMoney(amount)
    $('#hud-return').textContent = '+0.00%'
    $('#hud-date').textContent = stock.metadata.dataStart
    $('#hud-progress').style.width = '0%'
    showScreen('game')
    renderOverview(stock)
    currentGame?.destroy()
    currentGame = new LeekKnightGame(stock, amount, {
      onHud: (state) => {
        if (performance.now() >= balanceAnimationUntil) $('#hud-balance').textContent = formatMoney(state.balance)
        $('#hud-return').textContent = formatPercent(state.returnRate)
        $('#hud-return').className = state.returnRate >= 0 ? 'up' : 'down'
        $('#hud-date').textContent = state.date
        $('#hud-speed').textContent = String(Math.round(state.speed * 6.4)).padStart(2, '0')
        $('#hud-progress').style.width = `${state.progress * 100}%`
        const traction = state.rearGrounded ? '后轮抓地' : state.grounded ? '前轮着地' : '腾空'
        const driveLabels = { drive: '驱动', coast: '滑行', brake: '制动', reverse: '倒车' }
        $('#hud-traction').textContent = traction
        $('#hud-traction').className = state.rearGrounded ? 'has-traction' : state.grounded ? 'partial-traction' : 'is-airborne'
        $('#hud-drive-mode').textContent = driveLabels[state.driveMode]
        $('#hud-drive-mode').className = state.driveMode
        const pitch = $('#hud-pitch')
        pitch.className = `pitch-feedback ${state.leanAxis < 0 ? 'wheelie' : state.leanAxis > 0 ? 'nose-down' : 'neutral'}`
        pitch.querySelector('b')!.textContent = state.leanAxis < 0 ? '翘头' : state.leanAxis > 0 ? '下压' : '车身中立'
        pitch.dataset.angle = state.chassisAngle.toFixed(4)
        $('#hud-throttle').style.width = `${state.throttle * 100}%`
        $('#hud-settlement-progress').style.width = `${state.settlementProgress * 100}%`
        $('#hud-next-settlement').textContent = state.nextSettlementDate ? `下一结算 ${state.nextSettlementDate.slice(5)}` : '全部结算完成'
        updateComboHud(state.combo)
        updateOverview(state.progress)
      },
      onSettle: showSettlement,
      onRespawn: showRespawn,
      onEnd: showResult,
      onEngine: (speed) => audio.setEngineSpeed(speed),
      onSound: (kind, combo) => audio.play(kind, combo),
      onComboBreak: () => {
        audio.playComboBreak()
        showComboBreak()
      },
    })
    $('#game-root').focus({ preventScroll: true })
    await audio.startEngine().catch(() => undefined)
    await audio.startBgm().catch(() => undefined)
    audio.play('ui')
    updateSoundLabels()
    error.textContent = ''
  } catch (loadError) {
    showScreen('setup')
    error.textContent = loadError instanceof Error ? loadError.message : '赛道加载失败'
  } finally {
    button.disabled = false
  }
}

function renderOverview(stock: StockDataset): void {
  const geometry = buildChartGeometry(stock.candles, 300, 104, 76, 8)
  overviewPoints = geometry.points
  const bars = geometry.bars.map((bar) => {
    const color = bar.rising ? '#ff4d2e' : '#18b67b'
    const top = Math.min(bar.openY, bar.closeY)
    const height = Math.max(1.5, Math.abs(bar.openY - bar.closeY))
    return `<line x1="${bar.x.toFixed(2)}" y1="${bar.highY.toFixed(2)}" x2="${bar.x.toFixed(2)}" y2="${bar.lowY.toFixed(2)}" stroke="${color}" stroke-width="1" opacity=".72"/><rect x="${(bar.x - 1.5).toFixed(2)}" y="${top.toFixed(2)}" width="3" height="${height.toFixed(2)}" fill="${color}" opacity=".78"/>`
  }).join('')
  $('#overview-chart').innerHTML = `
    <defs><linearGradient id="overview-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff4d2e" stop-opacity=".24"/><stop offset="1" stop-color="#ff4d2e" stop-opacity="0"/></linearGradient></defs>
    <path d="${geometry.linePath} L292 96 L8 96 Z" fill="url(#overview-fill)" opacity=".6"/>
    <g>${bars}</g>
    <path d="${geometry.linePath}" fill="none" stroke="#f2e7cf" stroke-width="1.4" opacity=".82"/>
    <line id="overview-marker" x1="8" y1="5" x2="8" y2="99" stroke="#ffb000" stroke-width="2"/>
    <circle id="overview-dot" cx="8" cy="${geometry.points[0]?.y ?? 52}" r="4" fill="#ffb000" stroke="#080a0d" stroke-width="2"/>
  `
  $('#overview-start').textContent = stock.metadata.dataStart
  $('#overview-end').textContent = stock.metadata.dataEnd
  updateOverview(0)
}

function updateOverview(progress: number): void {
  if (!overviewPoints.length) return
  const index = Math.min(overviewPoints.length - 1, Math.round(progress * (overviewPoints.length - 1)))
  const point = overviewPoints[index]
  const marker = document.querySelector<SVGLineElement>('#overview-marker')
  const dot = document.querySelector<SVGCircleElement>('#overview-dot')
  marker?.setAttribute('x1', point.x.toFixed(2))
  marker?.setAttribute('x2', point.x.toFixed(2))
  dot?.setAttribute('cx', point.x.toFixed(2))
  dot?.setAttribute('cy', point.y.toFixed(2))
  $('#overview-progress').textContent = `${Math.round(progress * 100)}%`
}

function updateComboHud(combo: DualComboState): void {
  const hud = $('#combo-hud')
  const gainSlot = hud.querySelector<HTMLDivElement>('.combo-slot.gain')!
  const lossSlot = hud.querySelector<HTMLDivElement>('.combo-slot.loss')!

  const updateSlot = (
    slot: HTMLDivElement,
    multiplierSelector: string,
    countSelector: string,
    comboSlot: ComboSlot,
  ): void => {
    const kind = slot.classList.contains('gain') ? 'gain' : 'loss'
    if (comboSlot.count <= 1) {
      slot.className = `combo-slot ${kind}`
      $(multiplierSelector).textContent = '—'
      $(countSelector).textContent = ''
      return
    }

    const tier = comboSlot.count >= 7 ? 'insane' : comboSlot.count >= 5 ? 'great' : comboSlot.count >= 3 ? 'nice' : 'base'
    slot.className = `combo-slot ${kind} is-active is-dominant tier-${tier}`
    $(multiplierSelector).textContent = `×${comboSlot.multiplier.toFixed(1)}`
    $(countSelector).textContent = `${comboSlot.count} 连击`
  }

  updateSlot(gainSlot, '#gain-multiplier', '#gain-count', combo.gain)
  updateSlot(lossSlot, '#loss-multiplier', '#loss-count', combo.loss)
  hud.classList.toggle('has-active', combo.gain.count > 1 || combo.loss.count > 1)
}

function showSettlement(point: SettlementPoint, balance: number, previousBalance = balance / (1 + point.returnRate)): void {
  const toast = $('#settlement-toast')
  const delta = balance - previousBalance
  const positive = point.returnRate >= 0
  const magnitude = Math.abs(point.returnRate)
  const tier = magnitude >= 0.07 ? 'extreme' : magnitude >= 0.03 ? 'big' : 'normal'
  toast.querySelector('small')!.textContent = tier === 'extreme'
    ? (positive ? '暴涨结算' : '暴跌结算')
    : tier === 'big'
      ? (positive ? 'MARKET RALLY' : 'MARKET DUMP')
      : 'MARKET PAYOUT'
  toast.querySelector('b')!.textContent = formatPercent(point.returnRate)
  toast.querySelector('strong')!.textContent = `${positive ? '+' : '-'}${formatMoney(Math.abs(delta))}`
  toast.querySelector('span')!.textContent = positive ? '上涨段收益爆仓入账' : '下跌段亏损强制扣除'
  toast.className = `settlement-toast is-visible ${positive ? 'positive' : 'negative'} tier-${tier}`

  const balanceHud = $('#balance-hud')
  const gameScreen = $('#game')
  balanceHud.className = `balance-hud is-jackpot ${positive ? 'positive' : 'negative'}`
  gameScreen.classList.remove('settlement-positive', 'settlement-negative')
  gameScreen.classList.add(positive ? 'settlement-positive' : 'settlement-negative')
  animateBalance(previousBalance, balance)

  window.setTimeout(() => {
    toast.classList.remove('is-visible')
    balanceHud.className = 'balance-hud'
    gameScreen.classList.remove('settlement-positive', 'settlement-negative')
  }, tier === 'extreme' ? 2000 : 1450)
}

function animateBalance(from: number, to: number): void {
  window.cancelAnimationFrame(balanceAnimationFrame)
  const element = $('#hud-balance')
  const startedAt = performance.now()
  const duration = 850
  const overshootDuration = 200
  balanceAnimationUntil = startedAt + duration + overshootDuration

  const tick = (now: number): void => {
    const elapsed = now - startedAt
    if (elapsed < duration) {
      const progress = Math.min(1, elapsed / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      const slotNoise = progress < 0.7 ? (Math.random() - 0.5) * Math.abs(to - from) * (1 - progress) * 0.22 : 0
      element.textContent = formatMoney(from + (to - from) * eased + slotNoise)
      balanceAnimationFrame = window.requestAnimationFrame(tick)
    } else if (elapsed < duration + overshootDuration) {
      const overshootProgress = (elapsed - duration) / overshootDuration
      const oscillation = Math.sin(overshootProgress * Math.PI * 2.5) * Math.exp(-overshootProgress * 4)
      element.textContent = formatMoney(to + (to - from) * 0.03 * oscillation)
      balanceAnimationFrame = window.requestAnimationFrame(tick)
    } else {
      element.textContent = formatMoney(to)
    }
  }
  balanceAnimationFrame = window.requestAnimationFrame(tick)
}

function showRespawn(): void {
  const toast = $('#respawn-toast')
  toast.classList.remove('is-visible')
  void toast.offsetWidth
  toast.classList.add('is-visible')
  window.setTimeout(() => toast.classList.remove('is-visible'), 900)
}

function showComboBreak(): void {
  const hud = $('#combo-hud')
  if (!hud.classList.contains('has-active')) return
  hud.classList.add('is-breaking')
  window.setTimeout(() => {
    hud.classList.remove('is-breaking', 'has-active')
    hud.querySelectorAll('.combo-slot').forEach((slot) => {
      slot.classList.remove('is-active', 'is-dominant', 'tier-base', 'tier-nice', 'tier-great', 'tier-insane')
    })
    $('#gain-multiplier').textContent = '—'
    $('#loss-multiplier').textContent = '—'
    $('#gain-count').textContent = ''
    $('#loss-count').textContent = ''
  }, 350)
}

function resetLeaderboardUI(): void {
  $('#result-leaderboard').style.display = 'block'
  $('#result-ranking').style.display = 'none'
  $<HTMLInputElement>('#nickname-input').value = ''
  $<HTMLButtonElement>('#leaderboard-submit').disabled = true
  $('#leaderboard-error').textContent = ''
}

function hideLeaderboardUI(): void {
  $('#result-leaderboard').style.display = 'none'
  $('#result-ranking').style.display = 'none'
  $('#leaderboard-error').textContent = ''
}

function renderRankingResult(response: LeaderboardSubmitResponse): void {
  $('#result-leaderboard').style.display = 'none'
  $('#result-ranking').style.display = 'block'
  $('#ranking-position').textContent = `第 ${response.rank} 名`
  $('#ranking-percentile').textContent = `你已超过全球 ${response.percentile.toFixed(1)}% 的玩家`
  $('#ranking-best').textContent = response.personal_best
    ? `第 ${response.personal_best.rank} 名 (${formatPercent(response.personal_best.return_rate)})`
    : '首次上榜'
  $('#ranking-top3').innerHTML = response.top3.map((entry) => {
    const medal = entry.rank === 1 ? '1' : entry.rank === 2 ? '2' : '3'
    return `<li><b>${medal}</b><strong>${escapeHtml(entry.player_name)}</strong><span>${formatPercent(entry.return_rate)}</span><small>${escapeHtml(entry.stock_name)}</small></li>`
  }).join('')
}

async function submitLeaderboardScore(): Promise<void> {
  const result = lastRunResult
  const button = $<HTMLButtonElement>('#leaderboard-submit')
  const error = $('#leaderboard-error')
  const playerName = $<HTMLInputElement>('#nickname-input').value.trim()

  if (!result || result.reason !== 'finished' || result.progress < 1 || !isValidNickname(playerName)) {
    error.textContent = '请输入 2-12 位昵称。'
    button.disabled = !isValidNickname(playerName)
    return
  }

  button.disabled = true
  error.textContent = '提交中…'

  try {
    const response = await submitScore({
      stock_code: result.stock.code,
      stock_name: result.stock.name,
      player_name: playerName,
      player_id: getPlayerId(),
      initial: result.initialAmount,
      final: result.finalAmount,
      return_rate: calculateReturn(result.initialAmount, result.finalAmount),
      progress: result.progress,
    })
    renderRankingResult(response)
    error.textContent = ''
    audio.play('ui')
  } catch (err) {
    error.textContent = err instanceof Error ? err.message : '提交失败，请稍后重试'
  } finally {
    button.disabled = false
  }
}

async function loadFullLeaderboard(stockCode?: string): Promise<void> {
  const tbody = $('#leaderboard-tbody')
  tbody.innerHTML = '<tr><td colspan="5">加载中…</td></tr>'

  try {
    const data = await fetchLeaderboard(stockCode, 50, getPlayerId())
    tbody.innerHTML = data.entries.length
      ? data.entries.map((entry) => `<tr class="${entry.is_current_player ? 'is-me' : ''}">
          <td>${entry.rank}</td>
          <td>${escapeHtml(entry.player_name)}${entry.is_current_player ? '（你）' : ''}</td>
          <td>${escapeHtml(entry.stock_name)}</td>
          <td class="${entry.return_rate >= 0 ? 'up' : 'down'}">${formatPercent(entry.return_rate)}</td>
          <td>${formatMoney(entry.final)}</td>
        </tr>`).join('')
      : '<tr><td colspan="5">还没有成绩，先冲一把。</td></tr>'
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5">${escapeHtml(err instanceof Error ? err.message : '加载失败，请稍后重试')}</td></tr>`
  }
}

function openFullLeaderboard(stockCode?: string): void {
  const select = $<HTMLSelectElement>('#leaderboard-filter-stock')
  select.value = stockCode ?? ''
  $('#full-leaderboard-modal').classList.add('is-visible')
  void loadFullLeaderboard(stockCode)
}

function populateLeaderboardFilter(): void {
  const select = $<HTMLSelectElement>('#leaderboard-filter-stock')
  select.innerHTML = '<option value="">全部股票</option>' +
    stocks.map((stock) => `<option value="${stock.code}">${escapeHtml(stock.name)} (${stock.code})</option>`).join('')

  if (!leaderboardFilterReady) {
    select.addEventListener('change', () => {
      void loadFullLeaderboard(select.value || undefined)
    })
    leaderboardFilterReady = true
  }
}

function isValidNickname(value: string): boolean {
  const length = Array.from(value).length
  return length >= 2 && length <= 12 && /^[\p{Script=Han}A-Za-z0-9_]+$/u.test(value)
}

function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

function showResult(result: RunResult): void {
  audio.stopEngine()
  lastRunResult = result
  const totalReturn = calculateReturn(result.initialAmount, result.finalAmount)
  $('#result-kicker').innerHTML = `<span></span> ${result.reason === 'finished' ? 'RIDE COMPLETE' : 'MARKET CRASH'}`
  $('#result-title').textContent = result.reason === 'finished' ? '收盘了。' : '翻车了。'
  $('#result-copy').textContent = result.reason === 'finished' ? `你骑完了 ${result.stock.name} 的整条年度曲线。` : '市场不会等你站稳。调整速度，再试一次。'
  $('#result-balance').textContent = formatMoney(result.finalAmount)
  $('#result-return').textContent = formatPercent(totalReturn)
  $('#result-return').className = totalReturn >= 0 ? 'up' : 'down'
  $('#result-date').textContent = result.date
  $('#result-progress').textContent = `${Math.round(result.progress * 100)}%`
  if (result.reason === 'finished' && result.progress >= 1) {
    resetLeaderboardUI()
  } else {
    hideLeaderboardUI()
  }
  $('#result-modal').classList.add('is-visible')
}

function exitGame(): void {
  currentGame?.destroy()
  currentGame = null
  audio.stopEngine()
  $('#result-modal').classList.remove('is-visible')
  $('#full-leaderboard-modal').classList.remove('is-visible')
  showScreen('setup')
}

$('#play-now').addEventListener('click', enterGarage)
$('#back-home').addEventListener('click', () => showScreen('landing'))
$('#start-ride').addEventListener('click', startRide)
$('#exit-game').addEventListener('click', exitGame)
$('#restart-game').addEventListener('click', () => {
  $('#result-modal').classList.remove('is-visible')
  currentGame?.restart()
  void Promise.all([audio.startEngine(), audio.startBgm()]).then(updateSoundLabels)
})
$('#result-retry').addEventListener('click', () => {
  $('#result-modal').classList.remove('is-visible')
  currentGame?.restart()
  void Promise.all([audio.startEngine(), audio.startBgm()]).then(updateSoundLabels)
})
$('#result-garage').addEventListener('click', exitGame)
$('#nickname-input').addEventListener('input', () => {
  const value = $<HTMLInputElement>('#nickname-input').value.trim()
  $<HTMLButtonElement>('#leaderboard-submit').disabled = !isValidNickname(value)
})
$('#nickname-random').addEventListener('click', () => {
  $<HTMLInputElement>('#nickname-input').value = randomName()
  $<HTMLButtonElement>('#leaderboard-submit').disabled = false
  audio.play('ui')
})
$('#leaderboard-submit').addEventListener('click', () => { void submitLeaderboardScore() })
$('#ranking-view-all').addEventListener('click', () => openFullLeaderboard(lastRunResult?.stock.code ?? selectedCode))
$('#close-leaderboard').addEventListener('click', () => $('#full-leaderboard-modal').classList.remove('is-visible'))
async function toggleSound(): Promise<void> {
  await audio.unlock().catch(() => undefined)
  audio.toggle()
  await audio.startBgm().catch(() => undefined)
  updateSoundLabels()
}
$('#sound-top').addEventListener('click', () => { void toggleSound() })
$('#sound-game').addEventListener('click', () => { void toggleSound() })

document.querySelectorAll<HTMLButtonElement>('[data-amount]').forEach((button) => button.addEventListener('click', () => {
  $<HTMLInputElement>('#amount').value = button.dataset.amount!
  document.querySelectorAll('[data-amount]').forEach((item) => item.classList.toggle('is-selected', item === button))
  audio.play('ui')
}))
$<HTMLInputElement>('#amount').value = String(lastAmount)
updateSoundLabels()

function startPageBgm(): void {
  void audio.startBgm().then(updateSoundLabels).catch(() => undefined)
}

startPageBgm()
window.addEventListener('pointerdown', startPageBgm, { capture: true })
window.addEventListener('keydown', startPageBgm, { capture: true })
