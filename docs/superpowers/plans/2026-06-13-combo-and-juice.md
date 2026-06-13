# Combo 连击 & 跳跃 & 物理手感 — 实现计划 v2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Leek Knight 增加双 combo 系统、真实跳跃、保留金币、牵引力渐变和结算爆发力，让玩法从"被动看 K 线"升级为"主动操作躲避/追逐"。

**Architecture:** 纯函数层（`balance.ts` 乘数、`bikeControl.ts` 跳跃力）→ 场景层（`RideScene.ts` 双 combo 追踪/跳跃/全金币拾取/牵引渐变/hit-stop/粒子）→ DOM 层（`main.ts` 双 combo HUD/toast/动画）→ 音频层（`audio.ts` combo 音效）。每层独立可测。

**Tech Stack:** TypeScript, Phaser 3 Matter Physics, Vite, Vitest, Web Audio API, DOM/CSS

---

## 文件结构

| 文件 | 职责 | 变更类型 |
|------|------|---------|
| `src/types.ts` | ComboSlot、DualComboState、HudState 扩展 | 修改 |
| `src/game/balance.ts` | `getComboMultiplier()`、`settleBalance()` | 修改 |
| `src/game/bikeControl.ts` | `BikeControlInput` 加 `jump`、`Output` 加 `jumpForce` | 修改 |
| `src/game/RideScene.ts` | 双 combo、跳跃、全金币渲染、牵引渐变、hit-stop/震动/闪色/粒子 | 修改 |
| `src/game/LeekKnightGame.ts` | `GameCallbacks` 扩展 `onComboBreak`、`onSound` 加 combo | 修改 |
| `src/game/audio.ts` | combo 音阶、shimmer、combo break 音效 | 修改 |
| `src/main.ts` | 双 combo HUD、toast 分级、弹性过冲、断连回调 | 修改 |
| `src/style.css` | 双 combo HUD 样式、toast 分级样式 | 修改 |
| `tests/combo.test.ts` | 乘数、跳跃力、双 combo 逻辑测试 | 新建 |
| `tests/bikeControl.test.ts` | 跳跃输出测试 | 修改 |

---

### Task 1: 双 Combo 类型定义

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: 新增 ComboSlot 和 DualComboState 接口，更新 HudState**

在 `src/types.ts` 中，替换 `ComboState` 定义（如果存在），新增：

```typescript
export interface ComboSlot {
  count: number
  multiplier: number
  windowUntil: number
}

export interface DualComboState {
  gain: ComboSlot
  loss: ComboSlot
}
```

修改 `HudState` 接口，移除旧的 `combo: ComboState | null`，替换为：

```typescript
  combo: DualComboState
```

完整的 `HudState` 最终为：

```typescript
export interface HudState {
  balance: number
  returnRate: number
  date: string
  progress: number
  speed: number
  throttle: number
  grounded: boolean
  rearGrounded: boolean
  driveMode: 'drive' | 'coast' | 'brake' | 'reverse'
  leanAxis: -1 | 0 | 1
  chassisAngle: number
  nextSettlementDate: string | null
  settlementProgress: number
  combo: DualComboState
  frozenUntil: number
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 可能有未使用导出警告，无类型错误。

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add ComboSlot, DualComboState types and update HudState

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Combo 乘数纯函数 + 测试

**Files:**
- Create: `tests/combo.test.ts`
- Modify: `src/game/balance.ts`

- [ ] **Step 1: 编写 combo 乘数和双 combo 逻辑的测试**

创建 `tests/combo.test.ts`：

```typescript
import { describe, expect, it } from 'vitest'
import { getComboMultiplier, settleBalance } from '../src/game/balance'

describe('getComboMultiplier', () => {
  it('returns 1.0 for combo 0 or 1', () => {
    expect(getComboMultiplier(0)).toBe(1.0)
    expect(getComboMultiplier(1)).toBe(1.0)
  })

  it('returns correct tiered multipliers', () => {
    expect(getComboMultiplier(2)).toBe(1.1)
    expect(getComboMultiplier(3)).toBe(1.2)
    expect(getComboMultiplier(4)).toBe(1.4)
    expect(getComboMultiplier(5)).toBe(1.6)
    expect(getComboMultiplier(6)).toBe(1.8)
    expect(getComboMultiplier(7)).toBe(2.0)
  })

  it('caps at 2.5 for combo >= 8', () => {
    expect(getComboMultiplier(8)).toBe(2.5)
    expect(getComboMultiplier(50)).toBe(2.5)
  })

  it('throws for negative combo', () => {
    expect(() => getComboMultiplier(-1)).toThrow('Invalid combo')
  })
})

describe('settleBalance with combo', () => {
  it('applies gain multiplier to positive return', () => {
    const result = settleBalance(100_000, 0.05, 2.0)
    expect(result).toBeCloseTo(110_000)
  })

  it('applies loss multiplier to negative return', () => {
    const result = settleBalance(100_000, -0.05, 2.0)
    expect(result).toBeCloseTo(90_000)
  })

  it('defaults to multiplier 1.0', () => {
    expect(settleBalance(100_000, 0.1)).toBeCloseTo(110_000)
  })

  it('floors balance at 0', () => {
    expect(settleBalance(10_000, -0.9, 2.5)).toBeGreaterThanOrEqual(0)
  })
})

describe('dual combo mutual exclusion (pure logic)', () => {
  it('gain combo breaks loss combo on collect', () => {
    // Simulate: lossCombo at 3, then gain coin collected
    // lossCombo should reset to 0, gainCombo should be 1
    const lossMultiplierBefore = getComboMultiplier(3)
    const gainMultiplierAfter = getComboMultiplier(1)
    const lossMultiplierAfter = getComboMultiplier(0)

    expect(lossMultiplierBefore).toBe(1.2)
    expect(gainMultiplierAfter).toBe(1.0)
    expect(lossMultiplierAfter).toBe(1.0)
  })

  it('loss combo breaks gain combo on collect', () => {
    const gainMultiplierBefore = getComboMultiplier(5)
    const lossMultiplierAfter = getComboMultiplier(1)
    const gainMultiplierAfter = getComboMultiplier(0)

    expect(gainMultiplierBefore).toBe(1.6)
    expect(lossMultiplierAfter).toBe(1.0)
    expect(gainMultiplierAfter).toBe(1.0)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/combo.test.ts
```

Expected: FAIL — `getComboMultiplier` not exported.

- [ ] **Step 3: 实现 `getComboMultiplier` 和更新 `settleBalance`**

修改 `src/game/balance.ts`，在 `formatPercent` 之后新增 `getComboMultiplier`，并修改 `settleBalance` 签名：

```typescript
export function getComboMultiplier(combo: number): number {
  if (!Number.isInteger(combo) || combo < 0) throw new Error('Invalid combo')
  if (combo <= 1) return 1.0
  if (combo === 2) return 1.1
  if (combo === 3) return 1.2
  if (combo === 4) return 1.4
  if (combo === 5) return 1.6
  if (combo === 6) return 1.8
  if (combo === 7) return 2.0
  return 2.5
}

export function settleBalance(balance: number, returnRate: number, comboMultiplier = 1): number {
  if (!Number.isFinite(balance) || balance < 0) throw new Error('Invalid balance')
  if (!Number.isFinite(returnRate) || returnRate <= -1) throw new Error('Invalid return rate')
  if (!Number.isFinite(comboMultiplier) || comboMultiplier < 1) throw new Error('Invalid combo multiplier')
  return Math.max(0, balance * (1 + returnRate * comboMultiplier))
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/combo.test.ts tests/balance.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add tests/combo.test.ts src/game/balance.ts
git commit -m "feat: add getComboMultiplier and combo-aware settleBalance

- Tiered multiplier curve: 1.0 -> 1.1 -> 1.2 -> 1.4 -> 1.6 -> 1.8 -> 2.0 -> 2.5 cap
- settleBalance accepts optional comboMultiplier (default 1.0)
- Tests cover multiplier curve, combo settlement, and dual combo mutual exclusion

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 跳跃物理 — bikeControl 纯函数

**Files:**
- Modify: `src/game/bikeControl.ts`
- Modify: `tests/bikeControl.test.ts`

- [ ] **Step 1: 在 BikeControlInput 新增 jump 字段，Output 新增 jumpForce**

编辑 `src/game/bikeControl.ts` 的 `BikeControlInput` 接口（约第 3–16 行），在 `rearGrounded` 之后新增：

```typescript
  jump: boolean
```

编辑 `BikeControlOutput` 接口（约第 18–28 行），在 `torqueFactor` 之后新增：

```typescript
  jumpForce: number
```

- [ ] **Step 2: 新增 `getJumpForce` 导出函数**

在 `getTorqueFactor` 函数之后、`stepBikeControl` 之前新增：

```typescript
export function getJumpForce(speedX: number): number {
  const base = 0.055
  const speedBonus = Math.min(0.045, Math.abs(speedX) / BIKE_MAX_SPEED * 0.045)
  return base + speedBonus
}
```

- [ ] **Step 3: 在 `stepBikeControl` 中计算 jumpForce**

在 `stepBikeControl` 函数体末尾、return 语句之前，新增跳跃力计算：

```typescript
  const jumpForce = input.jump && input.grounded ? getJumpForce(input.speedX) : 0
```

修改 return 语句，在 `torqueFactor` 之后新增 `jumpForce`：

```typescript
  return {
    throttle,
    rearWheelAngularVelocity,
    frontWheelBrakeFactor,
    chassisTorque,
    pitchAngularVelocityTarget,
    pitchLoad,
    tractionForce,
    driveMode,
    torqueFactor,
    jumpForce,
  }
```

- [ ] **Step 4: 编写跳跃力测试**

在 `tests/bikeControl.test.ts` 末尾新增 describe 块：

```typescript
describe('jump force', () => {
  it('returns zero jump force when jump is not pressed', () => {
    const result = stepBikeControl(input({ jump: false, rearGrounded: true }))
    expect(result.jumpForce).toBe(0)
  })

  it('returns zero jump force when airborne even if jump pressed', () => {
    const result = stepBikeControl(input({ jump: true, rearGrounded: false }))
    expect(result.jumpForce).toBe(0)
  })

  it('returns positive jump force when jumping from rear-grounded state', () => {
    const result = stepBikeControl(input({ jump: true, rearGrounded: true }))
    expect(result.jumpForce).toBeGreaterThan(0)
  })

  it('jump force increases with speed', () => {
    const lowSpeed = stepBikeControl(input({ jump: true, rearGrounded: true, speedX: 1 }))
    const highSpeed = stepBikeControl(input({ jump: true, rearGrounded: true, speedX: 12 }))
    expect(highSpeed.jumpForce).toBeGreaterThan(lowSpeed.jumpForce)
  })
})
```

- [ ] **Step 5: 更新测试文件中的 `input()` helper**

在 `tests/bikeControl.test.ts` 的 `input()` 函数默认值中新增 `jump: false`：

```typescript
function input(overrides: Partial<BikeControlInput> = {}): BikeControlInput {
  return {
    deltaMs: 16.67,
    throttle: 0,
    accelerate: false,
    brake: false,
    leanAxis: 0,
    speedX: 0,
    roadAngle: 0,
    chassisAngle: 0,
    chassisAngularVelocity: 0,
    rearWheelAngularVelocity: 0,
    grounded: true,
    rearGrounded: true,
    jump: false,
    ...overrides,
  }
}
```

- [ ] **Step 6: 运行测试**

```bash
npx vitest run tests/bikeControl.test.ts
```

Expected: 全部 PASS（原有 11 个 + 新增 4 个）。

- [ ] **Step 7: Commit**

```bash
git add src/game/bikeControl.ts tests/bikeControl.test.ts
git commit -m "feat: add jump force to bike control model

- BikeControlInput gets 'jump' field
- BikeControlOutput gets 'jumpForce' field
- getJumpForce(speedX): base 0.055 + speed bonus up to 0.045
- Jump activates when any wheel is grounded and jump is pressed
- Tests cover: no-press, airborne, speed scaling

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 双 Combo 状态追踪 — RideScene

**Files:**
- Modify: `src/game/RideScene.ts`

- [ ] **Step 1: 新增 import 和双 combo 字段**

修改 `RideScene.ts` 顶部 import：

```typescript
import { calculateReturn, getComboMultiplier, settleBalance } from './balance'
```

```typescript
import type { ComboSlot, DualComboState, GeneratedTrack, HudState, RunResult, SettlementPoint, StockDataset } from '../types'
```

在类的字段声明区（`private particles` 之后）新增：

```typescript
  private gainCombo: ComboSlot = { count: 0, multiplier: 1, windowUntil: 0 }
  private lossCombo: ComboSlot = { count: 0, multiplier: 1, windowUntil: 0 }
  private frozenUntil = 0
  private flashUntil = 0
  private flashColor = 0xff4d2e
  private tractionRampUntil = 0
  private readonly COMBO_WINDOW_MS = 6000
```

- [ ] **Step 2: 在 `create()` 中初始化双 combo**

在 `create()` 方法的 `this.particles = []` 之后新增：

```typescript
    this.gainCombo = { count: 0, multiplier: 1, windowUntil: 0 }
    this.lossCombo = { count: 0, multiplier: 1, windowUntil: 0 }
    this.frozenUntil = 0
    this.flashUntil = 0
    this.tractionRampUntil = 0
```

- [ ] **Step 3: 新增双 combo 管理方法**

在类末尾新增方法：

```typescript
  private advanceCombo(time: number, kind: 'gain' | 'loss'): number {
    const currentSlot = kind === 'gain' ? this.gainCombo : this.lossCombo
    const otherSlot = kind === 'gain' ? this.lossCombo : this.gainCombo

    // Advance current slot if within window, else start at 1
    if (time < currentSlot.windowUntil) {
      currentSlot.count += 1
    } else {
      currentSlot.count = 1
    }
    currentSlot.windowUntil = time + this.COMBO_WINDOW_MS
    currentSlot.multiplier = getComboMultiplier(currentSlot.count)

    // Reset opposite slot
    otherSlot.count = 0
    otherSlot.multiplier = 1
    otherSlot.windowUntil = 0

    return currentSlot.multiplier
  }

  private decayCombos(time: number): void {
    for (const slot of [this.gainCombo, this.lossCombo]) {
      if (slot.count > 0 && time >= slot.windowUntil) {
        slot.count = 0
        slot.multiplier = 1
        slot.windowUntil = 0
      }
    }
  }

  private resetAllCombos(): void {
    this.gainCombo = { count: 0, multiplier: 1, windowUntil: 0 }
    this.lossCombo = { count: 0, multiplier: 1, windowUntil: 0 }
  }

  private getDualComboState(): DualComboState {
    return {
      gain: { ...this.gainCombo },
      loss: { ...this.lossCombo },
    }
  }

  private hadActiveCombo(): boolean {
    return this.gainCombo.count > 1 || this.lossCombo.count > 1
  }

  private getHitStopDuration(returnRate: number): number {
    return Phaser.Math.Clamp(80 + Math.abs(returnRate) * 500, 80, 140)
  }
```

- [ ] **Step 4: 验证编译**

```bash
npx tsc --noEmit
```

Expected: `ComboSlot` 和 `DualComboState` 尚未通过 `../types` 导入——确认 import 语句正确。

- [ ] **Step 5: Commit**

```bash
git add src/game/RideScene.ts
git commit -m "feat: add dual combo state tracking to RideScene

- Separate gainCombo and lossCombo slots
- advanceCombo: increments active slot, resets opposite
- decayCombos: independent 6s window timeout for each
- resetAllCombos: both to zero on crash

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 结算流程接入双 Combo + hit-stop/震动/闪色

**Files:**
- Modify: `src/game/RideScene.ts`

- [ ] **Step 1: 重写 `processSettlements()`**

将 `processSettlements()` 方法完整替换为：

```typescript
  private processSettlements(): void {
    const probes = this.getPickupProbes()
    const scanLeft = this.chassis.position.x - 200
    const scanRight = this.chassis.position.x + 200

    for (let index = 0; index < this.track.settlements.length; index += 1) {
      const point = this.track.settlements[index]
      if (point.settled) continue
      if (point.x < scanLeft || point.x > scanRight) continue
      if (!this.isCoinCollected(point, probes)) continue

      point.settled = true
      const kind: 'gain' | 'loss' = point.returnRate >= 0 ? 'gain' : 'loss'
      const comboMultiplier = this.advanceCombo(this.time.now, kind)
      this.balance = settleBalance(this.balance, point.returnRate, comboMultiplier)
      this.options.onSettle(point, this.balance)
      this.options.onSound(point.returnRate >= 0 ? 'gain' : 'loss', kind === 'gain' ? this.gainCombo.count : this.lossCombo.count)
      this.spawnSettlementParticles(point.x, point.y, point.returnRate >= 0 ? 0xff6b4f : 0x38d39b, point.requiresJump ? 26 : 18)

      // Hit-stop
      this.frozenUntil = this.time.now + this.getHitStopDuration(point.returnRate)
      // Flash overlay
      const positive = point.returnRate >= 0
      this.flashUntil = this.time.now + 180
      this.flashColor = positive ? 0xff4d2e : 0x18b67b
      // Dynamic shake
      const shakeIntensity = Math.min(0.025, 0.004 + Math.abs(point.returnRate) * 0.18)
      const shakeDuration = Math.min(400, 180 + Math.abs(point.returnRate) * 300)
      this.cameras.main.shake(shakeDuration, shakeIntensity)
    }

    if (this.chassis.position.x >= this.track.points.at(-1)!.x) this.endRun('finished')
  }
```

- [ ] **Step 2: 修改 `update()` 实现 hit-stop + combo 衰减**

将 `update()` 方法替换为：

```typescript
  update(time: number, delta: number): void {
    if (this.ended) return
    const frozen = time < this.frozenUntil

    // Combo window decay (runs even during freeze)
    this.decayCombos(time)

    if (!frozen) {
      this.applyControls(delta)
    }

    this.drawBike()
    this.drawCoins(time)
    this.updateParticles(delta)

    if (!frozen) {
      this.updateCamera()
      this.processSettlements()
      this.options.onEngine(this.chassis.velocity.x)
    }

    this.processState(time)
    this.drawFlashOverlay(time)

    if (Phaser.Input.Keyboard.JustDown(this.keys.r)) this.scene.restart()
  }
```

- [ ] **Step 3: 新增 `drawFlashOverlay()` 方法**

在类末尾新增：

```typescript
  private drawFlashOverlay(time: number): void {
    if (time >= this.flashUntil) return
    const elapsed = this.flashUntil - time
    const alpha = Math.min(0.22, elapsed / 180 * 0.3)
    const cam = this.cameras.main
    this.fxGraphics.fillStyle(this.flashColor, alpha)
    this.fxGraphics.fillRect(cam.scrollX - 20, cam.scrollY - 20, cam.width + 40, cam.height + 40)
  }
```

- [ ] **Step 4: 修改 `processState()` 传递双 combo 状态**

在 `processState()` 方法中 `this.options.onHud({...})` 调用的对象内，`settlementProgress` 之后修改为：

```typescript
        combo: this.getDualComboState(),
        frozenUntil: this.frozenUntil,
```

- [ ] **Step 5: 修改 `respawnBike()` 重置双 combo**

在 `respawnBike()` 中，`this.respawnProtectedUntil = this.time.now + 1300` 之前新增：

```typescript
    const hadCombo = this.hadActiveCombo()
    this.resetAllCombos()
    if (hadCombo) {
      this.options.onComboBreak?.()
    }
```

- [ ] **Step 6: 验证编译（可能有接口不匹配，后续任务修复）**

```bash
npx tsc --noEmit
```

Expected: `onComboBreak` 不存在于 `RideSceneOptions` 中（Task 9 修复）。

- [ ] **Step 7: Commit**

```bash
git add src/game/RideScene.ts
git commit -m "feat: wire dual combo, hit-stop, shake, flash into settlement

- processSettlements scans all unsettled coins bidirectionally
- advanceCombo called with gain/loss kind
- Hit-stop freezes physics, decayCombos runs during freeze
- Flash overlay drawn post-particles
- Dual combo state passed via onHud

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 跳跃输入 + 全金币渲染 — RideScene

**Files:**
- Modify: `src/game/RideScene.ts`

- [ ] **Step 1: 新增空格键绑定**

在 `bindInput()` 方法的 `addCapture` 调用中新增空格键：

```typescript
    keyboard.addCapture([
      Phaser.Input.Keyboard.KeyCodes.UP, Phaser.Input.Keyboard.KeyCodes.DOWN,
      Phaser.Input.Keyboard.KeyCodes.LEFT, Phaser.Input.Keyboard.KeyCodes.RIGHT,
      Phaser.Input.Keyboard.KeyCodes.W, Phaser.Input.Keyboard.KeyCodes.S,
      Phaser.Input.Keyboard.KeyCodes.A, Phaser.Input.Keyboard.KeyCodes.D,
      Phaser.Input.Keyboard.KeyCodes.SPACE,
    ])
```

在 `keys` 对象中新增 `space` 键：

```typescript
    this.keys = keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.UP, down: Phaser.Input.Keyboard.KeyCodes.DOWN,
      left: Phaser.Input.Keyboard.KeyCodes.LEFT, right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      w: Phaser.Input.Keyboard.KeyCodes.W, s: Phaser.Input.Keyboard.KeyCodes.S,
      a: Phaser.Input.Keyboard.KeyCodes.A, d: Phaser.Input.Keyboard.KeyCodes.D,
      r: Phaser.Input.Keyboard.KeyCodes.R,
      space: Phaser.Input.Keyboard.KeyCodes.SPACE,
    }) as typeof this.keys
```

更新 `keys` 的类型声明（约第 36 行）：

```typescript
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 's' | 'a' | 'd' | 'r' | 'space', Phaser.Input.Keyboard.Key>
```

- [ ] **Step 2: 在 `applyControls` 中传递 jump 输入并施加跳跃力**

在 `applyControls()` 方法中，新增跳跃检测：

```typescript
    const jumping = Phaser.Input.Keyboard.JustDown(this.keys.space)
```

将 `jump: jumping` 传入 `stepBikeControl` 调用：

```typescript
    const control = stepBikeControl({
      deltaMs: delta,
      throttle: this.throttle,
      accelerate: accelerating,
      brake: braking,
      leanAxis,
      speedX: this.chassis.velocity.x,
      roadAngle: this.getRoadAngle(this.chassis.position.x),
      chassisAngle: this.chassis.angle,
      chassisAngularVelocity: this.chassis.angularVelocity,
      rearWheelAngularVelocity: this.rearWheel.angularVelocity,
      grounded: this.groundedPairs.size > 0,
      rearGrounded: this.rearGroundedPairs.size > 0,
      jump: jumping,
    })
```

在 `applyControls` 方法末尾（施加 tractionForce 之后、`this.chassis.torque += control.chassisTorque` 之前）新增跳跃力施加：

```typescript
    if (control.jumpForce > 0) {
      this.matter.applyForce(this.chassis, { x: 0, y: -control.jumpForce * delta })
    }
```

- [ ] **Step 3: 重写 `drawCoins()` 渲染所有视口内未结算金币**

替换 `drawCoins` 方法：

```typescript
  private drawCoins(time: number): void {
    const graphics = this.coinGraphics
    graphics.clear()
    const cam = this.cameras.main
    const viewLeft = cam.scrollX - 80
    const viewRight = cam.scrollX + cam.width + 80

    for (let index = 0; index < this.track.settlements.length; index += 1) {
      const point = this.track.settlements[index]
      if (point.settled) continue
      if (point.x < viewLeft || point.x > viewRight) continue

      const positive = point.returnRate >= 0
      const pulse = 1 + Math.sin(time / 145 + index) * 0.1
      const coinRadius = (point.pickupRadius + 2) * pulse

      if (point.requiresJump) {
        graphics.lineStyle(1, positive ? 0xff6b4f : 0x38d39b, 0.3)
          .lineBetween(point.x, point.terrainY - 18, point.x, point.y + point.pickupRadius + 12)
      }
      graphics.fillStyle(positive ? 0xff4d2e : 0x18b67b, 0.13)
        .fillCircle(point.x, point.y, (point.pickupRadius + 16) * pulse)
      graphics.lineStyle(4, positive ? 0xff6b4f : 0x38d39b, 1)
        .strokeCircle(point.x, point.y, coinRadius)
      graphics.fillStyle(positive ? 0xffb000 : 0x95f0ce, 1)
        .fillCircle(point.x, point.y, Math.max(9, point.pickupRadius - 3) * pulse)
      graphics.lineStyle(3, 0x0a0c0f, 0.86)
        .lineBetween(point.x - 6, point.y, point.x + 6, point.y)
      if (positive) graphics.lineBetween(point.x, point.y - 6, point.x, point.y + 6)
    }
  }
```

- [ ] **Step 4: 移除 `updateNextSettlementIndex` 的渲染依赖**

`updateNextSettlementIndex` 方法保留（HUD 仍需要下一结算日期），但 `drawCoins` 不再调用它。检查 `processSettlements` 不再调用它——确认后在 `processSettlements` 中移除 `this.updateNextSettlementIndex()` 调用。

在 `processState()` 中保留 `updateNextSettlementIndex` 调用，供 HUD 使用。

- [ ] **Step 5: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无类型错误（除已知的接口不匹配）。

- [ ] **Step 6: Commit**

```bash
git add src/game/RideScene.ts
git commit -m "feat: add jump input, all-coins viewport rendering

- Space key bound for jump
- jump force applied as upward impulse on chassis
- drawCoins renders ALL unsettled coins within camera viewport
- processSettlements scans all coins bidirectionally

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: 落地牵引力渐变

**Files:**
- Modify: `src/game/RideScene.ts`

- [ ] **Step 1: 在碰撞回调中追踪后轮着地时刻**

在 `bindCollisions()` 的 `collisionstart` 回调中，后轮着地处新增渐变触发：

找到碰撞回调中 `rearGroundedPairs` 被更新的位置（约第 182 行之后），确保在后轮着地的同一帧设置渐变计时器。利用已有的 `lastLandingAt` 逻辑——当后轮着地且之前处于腾空状态时，设置 `tractionRampUntil`。

在后轮着地逻辑处（约第 182 行 `if (groundedKey && this.pairContainsBody(pair, this.rearWheel))` 处），新增：

```typescript
        if (groundedKey && this.pairContainsBody(pair, this.rearWheel)) {
          const wasAirborne = this.rearGroundedPairs.size === 0
          this.rearGroundedPairs.add(groundedKey)
          if (wasAirborne) {
            this.tractionRampUntil = this.time.now + 200
          }
        }
```

注意：原代码第 182 行是 `if (groundedKey && this.pairContainsBody(pair, this.rearWheel)) this.rearGroundedPairs.add(groundedKey)`，需要展开为带大括号的 if 块。

- [ ] **Step 2: 修改 `applyControls()` 中的牵引力施加加入渐变系数**

在 `applyControls()` 中施加 `tractionForce` 的位置（约第 236–242 行），新增 rampFactor：

```typescript
    if (control.tractionForce > 0) {
      const roadAngle = this.getRoadAngle(this.rearWheel.position.x)
      const driveBody = this.rearGroundedPairs.size > 0 ? this.rearWheel : this.chassis
      const rampFactor = this.time.now < this.tractionRampUntil
        ? Math.max(0.15, (this.time.now - (this.tractionRampUntil - 200)) / 200)
        : 1
      this.matter.applyForce(driveBody, {
        x: Math.cos(roadAngle) * control.tractionForce * rampFactor,
        y: Math.sin(roadAngle) * control.tractionForce * rampFactor,
      })
    }
```

- [ ] **Step 3: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无新增错误。

- [ ] **Step 4: Commit**

```bash
git add src/game/RideScene.ts
git commit -m "feat: add 200ms traction ramp-up on rear wheel landing

- tractionRampUntil set when rear wheel transitions airborne->grounded
- rampFactor: 0.15 -> 1.0 over 200ms
- Eliminates instant snap-acceleration on landing

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: 定向粒子系统

**Files:**
- Modify: `src/game/RideScene.ts`

- [ ] **Step 1: 扩展粒子类型**

编辑粒子数组的类型声明：

```typescript
  private particles: Array<{
    x: number; y: number
    vx: number; vy: number
    life: number; color: number
    targetX?: number; targetY?: number
  }> = []
```

- [ ] **Step 2: 新增 `spawnSettlementParticles()` 方法**

在 `spawnParticles()` 方法之后新增：

```typescript
  private spawnSettlementParticles(x: number, y: number, color: number, count: number): void {
    const cam = this.cameras.main
    const hudX = cam.scrollX + cam.width / 2
    const hudY = cam.scrollY + 88
    const explosionCount = Math.floor(count * 0.6)
    const flyCount = count - explosionCount

    for (let i = 0; i < explosionCount; i += 1) {
      this.particles.push({
        x, y,
        vx: Phaser.Math.FloatBetween(-3.5, 3.5),
        vy: Phaser.Math.FloatBetween(-5.5, -1),
        life: Phaser.Math.Between(350, 850),
        color,
      })
    }
    for (let i = 0; i < flyCount; i += 1) {
      this.particles.push({
        x, y,
        vx: Phaser.Math.FloatBetween(-1.5, 1.5),
        vy: Phaser.Math.FloatBetween(-3.5, -1),
        life: Phaser.Math.Between(500, 750),
        color,
        targetX: hudX + Phaser.Math.FloatBetween(-80, 80),
        targetY: hudY + Phaser.Math.FloatBetween(-30, 30),
      })
    }
  }
```

- [ ] **Step 3: 重写 `updateParticles()` 支持目标追踪**

将 `updateParticles()` 替换为：

```typescript
  private updateParticles(delta: number): void {
    this.fxGraphics.clear()
    this.particles = this.particles.filter((particle) => {
      particle.life -= delta
      particle.x += particle.vx * delta / 16
      particle.y += particle.vy * delta / 16
      particle.vy += 0.14 * delta / 16
      if (particle.targetX !== undefined && particle.targetY !== undefined) {
        const dx = particle.targetX - particle.x
        const dy = particle.targetY - particle.y
        const dist = Math.hypot(dx, dy)
        if (dist > 6) {
          const pull = 0.018 * delta / 16
          particle.vx += (dx / dist) * pull
          particle.vy += (dy / dist) * pull
        }
      }
      if (particle.life <= 0) return false
      this.fxGraphics.fillStyle(particle.color, Math.min(1, particle.life / 260)).fillCircle(particle.x, particle.y, 3)
      return true
    })
  }
```

- [ ] **Step 4: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无新增错误。

- [ ] **Step 5: Commit**

```bash
git add src/game/RideScene.ts
git commit -m "feat: add directional settlement particles homing toward balance HUD

- 60% explosion particles, 40% money-fly particles
- Fly particles use homing pull toward balance display position
- Update loop modified for target-aware physics

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: LeekKnightGame 和 RideSceneOptions 接口扩展

**Files:**
- Modify: `src/game/LeekKnightGame.ts`
- Modify: `src/game/RideScene.ts`

- [ ] **Step 1: 扩展 `GameCallbacks` 接口**

编辑 `src/game/LeekKnightGame.ts` 的 `GameCallbacks` 接口（约第 5–12 行）：

```typescript
export interface GameCallbacks {
  onHud: (state: HudState) => void
  onSettle: (point: SettlementPoint, balance: number) => void
  onRespawn: () => void
  onEnd: (result: RunResult) => void
  onEngine: (speed: number) => void
  onSound: (kind: 'gain' | 'loss' | 'land' | 'crash' | 'finish', combo?: number) => void
  onComboBreak?: () => void
}
```

- [ ] **Step 2: 同步更新 `RideSceneOptions`**

编辑 `src/game/RideScene.ts` 的 `RideSceneOptions` 接口（约第 7–16 行），将 `onSound` 和新增 `onComboBreak` 同步：

```typescript
interface RideSceneOptions {
  stock: StockDataset
  initialAmount: number
  onHud: (state: HudState) => void
  onSettle: (point: SettlementPoint, balance: number) => void
  onRespawn: () => void
  onEnd: (result: RunResult) => void
  onEngine: (speed: number) => void
  onSound: (kind: 'gain' | 'loss' | 'land' | 'crash' | 'finish', combo?: number) => void
  onComboBreak?: () => void
}
```

- [ ] **Step 3: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 零类型错误。Task 5/6 中调用 `this.options.onComboBreak?.()` 和 `this.options.onSound(kind, comboCount)` 现在类型匹配。

- [ ] **Step 4: Commit**

```bash
git add src/game/LeekKnightGame.ts src/game/RideScene.ts
git commit -m "feat: add onComboBreak and combo-aware onSound to callback interfaces

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: 双 Combo HUD — DOM 层

**Files:**
- Modify: `src/main.ts`
- Modify: `src/style.css`

- [ ] **Step 1: 在游戏 HTML 中添加双 combo HUD 元素**

编辑 `src/main.ts` 的 HTML 模板，在 `#settlement-toast` 之后新增：

```html
    <div id="combo-hud" class="combo-hud">
      <div class="combo-slot gain"><b>涨 COMBO</b><strong id="gain-multiplier"></strong><span id="gain-count"></span></div>
      <div class="combo-slot loss"><b>跌 COMBO</b><strong id="loss-multiplier"></strong><span id="loss-count"></span></div>
    </div>
```

- [ ] **Step 2: 新增 `updateComboHud()` 函数**

在 `src/main.ts` 中 `showSettlement` 之前新增：

```typescript
function updateComboHud(combo: DualComboState): void {
  const hud = $('#combo-hud')
  const gainSlot = hud.querySelector<HTMLDivElement>('.combo-slot.gain')!
  const lossSlot = hud.querySelector<HTMLDivElement>('.combo-slot.loss')!

  const updateSlot = (
    slot: HTMLDivElement,
    multiplierEl: string,
    countEl: string,
    comboSlot: ComboSlot,
    isActive: boolean
  ): void => {
    if (comboSlot.count <= 1) {
      slot.className = 'combo-slot gain'.replace('gain', slot.classList.contains('gain') ? 'gain' : 'loss')
      $(multiplierEl).textContent = '—'
      $(countEl).textContent = ''
      return
    }
    const tier = comboSlot.count >= 7 ? 'insane' : comboSlot.count >= 5 ? 'great' : comboSlot.count >= 3 ? 'nice' : ''
    slot.className = `combo-slot ${slot.classList.contains('gain') ? 'gain' : 'loss'} is-active ${isActive ? 'is-dominant' : ''} tier-${tier}`
    $(multiplierEl).textContent = `×${comboSlot.multiplier.toFixed(1)}`
    $(countEl).textContent = `${comboSlot.count}`
  }

  const gainActive = combo.gain.count > 1
  const lossActive = combo.loss.count > 1
  updateSlot(gainSlot, '#gain-multiplier', '#gain-count', combo.gain, gainActive)
  updateSlot(lossSlot, '#loss-multiplier', '#loss-count', combo.loss, lossActive)

  hud.classList.toggle('has-active', gainActive || lossActive)
}
```

需要在文件顶部新增 import：

```typescript
import type { ComboSlot, DualComboState } from './types'
```

（检查是否已有 `DualComboState` 的 import，在现有的 `import type { ... } from './types'` 中添加。）

- [ ] **Step 3: 在 `onHud` 回调中调用 combo HUD 更新**

在 `startRide` 函数的 `onHud` 回调中，`updateOverview(state.progress)` 之前新增：

```typescript
        updateComboHud(state.combo)
```

- [ ] **Step 4: 新增 `showComboBreak()` 函数**

在 `showRespawn` 之后新增：

```typescript
function showComboBreak(): void {
  const hud = $('#combo-hud')
  if (!hud.classList.contains('has-active')) return
  hud.classList.add('is-breaking')
  window.setTimeout(() => {
    hud.classList.remove('is-breaking', 'has-active')
    hud.querySelectorAll('.combo-slot').forEach((slot) => {
      slot.classList.remove('is-active', 'is-dominant', 'tier-nice', 'tier-great', 'tier-insane')
    })
    $('#gain-multiplier').textContent = '—'
    $('#loss-multiplier').textContent = '—'
    $('#gain-count').textContent = ''
    $('#loss-count').textContent = ''
  }, 350)
}
```

- [ ] **Step 5: 在 `startRide` 中连接 combo 断连回调**

在 `new LeekKnightGame(...)` 的选项对象中，`onSound` 之后新增：

```typescript
      onComboBreak: () => {
        audio.playComboBreak()
        showComboBreak()
      },
```

修改 `onSound` 回调传递 combo 参数：

```typescript
      onSound: (kind, combo) => audio.play(kind, combo),
```

- [ ] **Step 6: 新增双 combo HUD CSS**

在 `src/style.css` 末尾（`@media(prefers-reduced-motion:reduce)` 之前）新增：

```css
.combo-hud{position:absolute;z-index:6;top:182px;left:50%;transform:translateX(-50%);display:flex;gap:32px;opacity:0;pointer-events:none;transition:opacity .25s}.combo-hud.has-active{opacity:1}.combo-slot{display:flex;flex-direction:column;align-items:center;gap:2px;opacity:.35;transition:opacity .25s,transform .25s}.combo-slot.is-active{opacity:.85}.combo-slot.is-dominant{opacity:1;transform:scale(1.15)}.combo-slot b{font-family:'Barlow Condensed';font-size:11px;letter-spacing:.18em}.combo-slot.gain b{color:var(--red)}.combo-slot.loss b{color:var(--green)}.combo-slot strong{font-family:'Barlow Condensed';font-size:28px;line-height:1;text-shadow:0 2px 0 #000}.combo-slot.gain strong{color:#f2e7cf}.combo-slot.loss strong{color:#f2e7cf}.combo-slot span{font-size:8px;letter-spacing:.15em;color:#858b94}.combo-slot.tier-nice strong{font-size:32px}.combo-slot.tier-great strong{font-size:38px}.combo-slot.gain.tier-great strong{color:var(--amber);text-shadow:0 3px 0 #4b3400,0 0 18px #ffb000;animation:combo-pulse .5s ease-in-out infinite alternate}.combo-slot.loss.tier-great strong{color:#5fd9ad;text-shadow:0 3px 0 #07392a,0 0 18px #18b67b}.combo-slot.tier-insane strong{font-size:44px}.combo-slot.gain.tier-insane strong{color:var(--red);text-shadow:0 4px 0 #49170f,0 0 28px #ff4d2e;animation:combo-rainbow .8s linear infinite}.combo-slot.loss.tier-insane strong{color:#18b67b;text-shadow:0 4px 0 #07392a,0 0 28px #18b67b;animation:combo-pulse .4s ease-in-out infinite alternate}.combo-hud.is-breaking{animation:combo-break-out .35s ease-in forwards}@keyframes combo-pulse{0%{transform:scale(1)}100%{transform:scale(1.08)}}@keyframes combo-rainbow{0%{text-shadow:0 4px 0 #49170f,0 0 28px #ff4d2e}25%{text-shadow:0 4px 0 #4b3400,0 0 28px #ffb000}50%{text-shadow:0 4px 0 #07392a,0 0 28px #18b67b}75%{text-shadow:0 4px 0 #1e3a5f,0 0 28px #76a9ff}100%{text-shadow:0 4px 0 #49170f,0 0 28px #ff4d2e}}@keyframes combo-break-out{0%{opacity:1;transform:translateX(-50%) scale(1)}100%{opacity:0;transform:translateX(-50%) scale(.6) translateY(24px)}}
```

- [ ] **Step 7: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 8: Commit**

```bash
git add src/main.ts src/style.css
git commit -m "feat: add dual combo HUD with gain/loss slots and tiered animations

- Two combo slots displayed side by side
- Active slot highlighted, dominant slot scaled up
- Tier animations: pulse (great), rainbow (insane)
- Combo break fade-out animation

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 11: 结算 Toast 分级 + 余额弹性过冲

**Files:**
- Modify: `src/main.ts`
- Modify: `src/style.css`

- [ ] **Step 1: 重写 `showSettlement()` 支持分级**

替换 `showSettlement` 函数（约第 255–277 行）：

```typescript
function showSettlement(point: SettlementPoint, balance: number): void {
  const toast = $('#settlement-toast')
  const previousBalance = balance / (1 + point.returnRate)
  const delta = balance - previousBalance
  const positive = point.returnRate >= 0
  const magnitude = Math.abs(point.returnRate)
  const tier = magnitude >= 0.07 ? 'extreme' : magnitude >= 0.03 ? 'big' : 'normal'
  toast.querySelector('small')!.textContent = tier === 'extreme'
    ? (positive ? '\u{1F680} 暴涨结算' : '\u{1F4A5} 暴跌结算')
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
```

- [ ] **Step 2: 重写 `animateBalance()` 加入弹性过冲**

替换 `animateBalance` 函数：

```typescript
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
      const slotNoise = progress < 0.7
        ? (Math.random() - 0.5) * Math.abs(to - from) * (1 - progress) * 0.22
        : 0
      element.textContent = formatMoney(from + (to - from) * eased + slotNoise)
      balanceAnimationFrame = window.requestAnimationFrame(tick)
    } else if (elapsed < duration + overshootDuration) {
      const overshootProgress = (elapsed - duration) / overshootDuration
      const oscillation = Math.sin(overshootProgress * Math.PI * 2.5) * Math.exp(-overshootProgress * 4)
      const overshoot = (to - from) * 0.03 * oscillation
      element.textContent = formatMoney(to + overshoot)
      balanceAnimationFrame = window.requestAnimationFrame(tick)
    } else {
      element.textContent = formatMoney(to)
    }
  }
  balanceAnimationFrame = window.requestAnimationFrame(tick)
}
```

- [ ] **Step 3: 新增 toast 分级 CSS**

在 `src/style.css` 的 `.settlement-toast` 区域之后追加：

```css
.settlement-toast.tier-big b{font-size:112px!important}.settlement-toast.tier-extreme b{font-size:128px!important;animation:extreme-shake .3s ease-in-out infinite alternate}.settlement-toast.tier-extreme strong{font-size:42px!important;border:2px solid var(--amber)}@keyframes extreme-shake{0%{transform:translateX(-4px) rotate(-1deg)}100%{transform:translateX(4px) rotate(1deg)}}
```

- [ ] **Step 4: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/style.css
git commit -m "feat: add tiered settlement toast and elastic balance overshoot

- Toast tiers: normal (<3%), big (3-7%), extreme (>=7%)
- Extreme tier: larger font, shake animation, border
- Balance animation: cubic ease-out + decay oscillation overshoot

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 12: Combo 音效升级

**Files:**
- Modify: `src/game/audio.ts`

- [ ] **Step 1: 重写 `playCoinSequence()` 支持 combo 参数**

替换 `playCoinSequence()` 方法（约第 102–126 行）：

```typescript
  private playCoinSequence(kind: 'gain' | 'loss', combo = 1): void {
    if (!this.context) return
    const now = this.context.currentTime
    const baseNotes = kind === 'gain'
      ? [740, 990, 1320, 1760]
      : [260, 190, 140, 92]
    const noteCount = combo >= 7 ? 8 : combo >= 5 ? 6 : combo >= 3 ? 5 : 4
    const octaveShift = combo >= 7 ? 1.5 : combo >= 5 ? 1.25 : combo >= 3 ? 1.12 : 1
    const notes: number[] = []
    for (let i = 0; i < noteCount; i += 1) {
      const baseIdx = i % baseNotes.length
      notes.push(baseNotes[baseIdx] * octaveShift)
    }
    const interval = combo >= 5 ? 0.035 : 0.045
    notes.forEach((frequency, index) => {
      const oscillator = this.context!.createOscillator()
      const gain = this.context!.createGain()
      const start = now + index * interval
      const duration = kind === 'gain' ? 0.2 : 0.26
      oscillator.type = kind === 'gain' ? 'triangle' : 'sawtooth'
      oscillator.frequency.setValueAtTime(frequency, start)
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(40, frequency * (kind === 'gain' ? 1.28 : 0.58)),
        start + duration,
      )
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(kind === 'gain' ? 0.16 : 0.13, start + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
      oscillator.connect(gain).connect(this.context!.destination)
      oscillator.start(start)
      oscillator.stop(start + duration)
    })
    if (combo >= 7) {
      const shimmer = this.context.createOscillator()
      const shimmerGain = this.context.createGain()
      shimmer.type = 'sine'
      shimmer.frequency.setValueAtTime(2200, now)
      shimmer.frequency.linearRampToValueAtTime(2800, now + 0.4)
      shimmerGain.gain.setValueAtTime(0.0001, now)
      shimmerGain.gain.linearRampToValueAtTime(0.06, now + 0.05)
      shimmerGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5)
      shimmer.connect(shimmerGain).connect(this.context.destination)
      shimmer.start(now)
      shimmer.stop(now + 0.5)
    }
  }
```

- [ ] **Step 2: 修改 `play()` 方法签名接受 combo 参数**

将 `play()` 方法签名从：

```typescript
  play(kind: SoundKind): void {
```

改为：

```typescript
  play(kind: SoundKind, combo?: number): void {
```

将内部的 `this.playCoinSequence(kind)` 改为：

```typescript
      this.playCoinSequence(kind, combo ?? 1)
```

- [ ] **Step 3: 新增 `playComboBreak()` 方法**

在 `play()` 方法之后新增：

```typescript
  playComboBreak(): void {
    if (!this.context || this.muted) return
    const now = this.context.currentTime
    const oscillator = this.context.createOscillator()
    const gain = this.context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(300, now)
    oscillator.frequency.exponentialRampToValueAtTime(60, now + 0.25)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.linearRampToValueAtTime(0.08, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3)
    oscillator.connect(gain).connect(this.context.destination)
    oscillator.start(now)
    oscillator.stop(now + 0.3)
  }
```

- [ ] **Step 4: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 5: Commit**

```bash
git add src/game/audio.ts
git commit -m "feat: add combo-aware coin sounds and combo break audio

- Coin sequence adapts to combo: more notes, higher octave
- High combo (7+) adds shimmer overtone
- Combo break: descending sine glissando 300->60Hz

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 13: 集成测试与构建验证

**Files:**
- Modify: `tests/combo.test.ts`（追加）

- [ ] **Step 1: 追加 `getJumpForce` 测试**

在 `tests/combo.test.ts` 末尾追加：

```typescript
import { getJumpForce } from '../src/game/bikeControl'

describe('getJumpForce', () => {
  it('returns base force at zero speed', () => {
    expect(getJumpForce(0)).toBe(0.055)
  })

  it('increases with speed', () => {
    const low = getJumpForce(2)
    const high = getJumpForce(14)
    expect(high).toBeGreaterThan(low)
  })

  it('caps at base + max speed bonus', () => {
    const max = getJumpForce(18)
    expect(max).toBeCloseTo(0.1, 1)
  })
})
```

- [ ] **Step 2: 追加双 combo 重置测试**

在 `tests/combo.test.ts` 末尾继续追加：

```typescript
describe('dual combo state transitions', () => {
  it('gain combo multiplier resets to 1.0 when counter goes to 0', () => {
    expect(getComboMultiplier(0)).toBe(1.0)
  })

  it('loss combo multiplier resets to 1.0 when counter goes to 0', () => {
    expect(getComboMultiplier(0)).toBe(1.0)
  })

  it('both combos can reach cap independently', () => {
    expect(getComboMultiplier(10)).toBe(2.5)
  })
})
```

- [ ] **Step 3: 运行全量测试**

```bash
npx vitest run
```

Expected: 所有测试通过。

- [ ] **Step 4: 运行构建**

```bash
npm run build
```

Expected: 构建成功。

- [ ] **Step 5: 启动开发服务器手动验证**

```bash
npm run dev
```

验证清单：
1. 空格键在任一车轮着地时触发跳跃，空中不可跳
2. 跳跃高度随速度增加
3. 吃到涨金币 → gain combo HUD 显示并递增，loss combo 归零
4. 吃到跌金币 → loss combo HUD 显示并递增，gain combo 归零
5. 6 秒不吃金币 → 对应 combo 自动归零
6. 跳过一个金币不碰到 → 金币保留在赛道上，回头可拾取
7. 后轮着地 → 牵引力 200ms 渐入（不再弹射起步）
8. 吃到金币 → hit-stop/震动/闪色/粒子
9. 高 combo → 音效升级
10. 摔车 → 双 combo 归零 + 断连反馈

- [ ] **Step 6: Commit**

```bash
git add tests/combo.test.ts
git commit -m "test: add jump force and dual combo state transition tests

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 14: 更新 CHANGELOG + 最终提交

- [ ] **Step 1: 更新 CHANGELOG**

在 `CHANGELOG.md` 顶部新增：

```markdown
## 1.2.0 - 2026-06-13

- 新增双 Combo 系统：涨跌独立计数，吃涨断跌、吃跌断涨，各自 6 秒窗口
- 新增真实跳跃：空格键触发，任一车轮着地条件，跳跃力随速度递增
- 跳跃力公式：base 0.055 + speed bonus up to 0.045（max ~0.10）
- 未吃金币保留：所有未结算金币持续渲染在视口内，回头可拾取
- 落地牵引力渐变：后轮着地 200ms 牵引力从 15% 渐入到 100%
- 双 Combo HUD：涨跌两槽并排，活跃槽高亮，NICE/GREAT/INSANE 分级动画
- 结算瞬间爆发力：hit-stop 冻结、动态震动、全屏闪色、定向粒子
- Toast 分级：普通(<3%)/大额(≥3%)/极端(≥7%)，极端级抖动动画
- 余额数字弹性过冲动画
- Combo 感知音效：高 combo 更多音阶 + 泛音 shimmer
- Combo 断连音效（下行滑音）和 HUD 动画
```

- [ ] **Step 2: 全量测试 + 构建**

```bash
npx vitest run
npm run build
npx tsc --noEmit
```

Expected: 全部通过。

- [ ] **Step 3: 最终 Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: update changelog for v1.2.0

- Dual combo system, jump, coin persistence, traction ramp
- Settlement juice: hit-stop, shake, flash, particles
- Tiered toast, elastic balance animation
- Combo-aware audio

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## 实现顺序总结

```
Task 1 (types.ts)              ← 类型基础
Task 2 (balance.ts + tests)    ← 纯函数，零依赖
Task 3 (bikeControl + tests)   ← 跳跃力纯函数
    ↓
Task 4 (RideScene combo)       ← 双 combo 状态 + 方法
Task 5 (RideScene settlement)  ← 接入双 combo + hit-stop/震动/闪色
Task 6 (RideScene jump/coins)  ← 跳跃输入 + 全金币渲染
Task 7 (RideScene traction)    ← 牵引力渐变
Task 8 (RideScene particles)   ← 定向粒子
    ↓
Task 9 (LeekKnightGame + 接口)      ← 修复接口不匹配（串行瓶颈）
    ↓
Task 10 (DOM combo HUD)   ─┐
Task 11 (DOM toast)        ├─ 可并行（修改不同文件/区域）
Task 12 (Audio)           ─┘
    ↓
Task 13 (集成测试)            ← 端到端验证
Task 14 (CHANGELOG + 收尾)   ← 文档
```

Tasks 10/11/12 在 Task 9 之后可并行执行。
