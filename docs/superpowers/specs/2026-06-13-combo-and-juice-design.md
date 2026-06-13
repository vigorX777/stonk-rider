# Combo 连击 & 跳跃 & 物理手感 — 设计文档 v2

## 概述

在原有结算爆发力设计基础上，增加四项重大改进：
1. **双 Combo 系统**：涨跌独立计数，吃涨断跌，吃跌断涨
2. **真实跳跃**：空格键跳跃，后轮着地触发，速度决定跳跃距离
3. **保留未吃金币**：所有未结算金币持续可见、可回头拾取
4. **落地牵引力渐变**：200ms 缓入，避免"一碰地就窜飞"

---

## 1. 双 Combo 系统

### 1.1 数据模型

```typescript
interface ComboSlot {
  count: number       // 当前 combo 数
  multiplier: number  // 当前乘数
  windowUntil: number // 窗口到期时间戳
}

interface DualComboState {
  gain: ComboSlot
  loss: ComboSlot
}
```

### 1.2 规则

- 吃到 **涨** 金币：`gain.count++`，`loss.count = 0`，gain 窗口重置为 6 秒
- 吃到 **跌** 金币：`loss.count++`，`gain.count = 0`，loss 窗口重置为 6 秒
- 各自独立倒计时，到期各自归零
- 摔车：两个 combo 都归零
- 手动重启：两个 combo 都归零

### 1.3 乘数曲线（双方共用同一曲线）

| Combo | Multiplier |
|-------|-----------|
| 0–1   | ×1.0      |
| 2     | ×1.1      |
| 3     | ×1.2      |
| 4     | ×1.4      |
| 5     | ×1.6      |
| 6     | ×1.8      |
| 7     | ×2.0      |
| 8+    | ×2.5 (cap) |

### 1.4 结算公式

```
新余额 = 当前余额 × (1 + 区间收益率 × 对应 combo 乘数)
```

涨金币用 `gain.multiplier`，跌金币用 `loss.multiplier`。

### 1.5 HUD 显示

两个 combo 同排显示，当前活跃的高亮：

```
涨 COMBO ×1.6  │  跌 COMBO —
```

- gain 活跃时：gain 侧红色脉冲，loss 侧灰色静态
- loss 活跃时：loss 侧绿色脉冲，gain 侧灰色静态
- 都 ≤1 时：两个都灰色静态，不显示乘数

---

## 2. 真实跳跃

### 2.1 按键

**空格键** — 新增第五个操作键。

### 2.2 触发条件

- 任一车轮必须着地（`grounded === true`）
- 空中不可跳跃（无二段跳）
- 冷却：无（物理上每帧 `JustDown` 已约束，不可能连续触发）

### 2.3 力度公式

```typescript
function getJumpForce(speedX: number): number {
  const base = 0.055
  const speedBonus = Math.min(0.045, Math.abs(speedX) / 18 * 0.045)
  return base + speedBonus
}
```

| 速度 (m/s) | 跳跃力 | 效果 |
|-----------|--------|------|
| 0–2       | ~0.055 | 小跳，勉强越过低位金币 |
| 3–8       | 0.06~0.075 | 中等跳跃 |
| 8–18      | 0.08~0.10 | 远跳，高清抛物线 |

### 2.4 应用方式

跳跃力作为 **一次性向上冲量** 作用于车架（`chassis`）：

```typescript
this.matter.applyForce(this.chassis, { x: 0, y: -jumpForce })
```

### 2.5 空中控制

空中仍可使用 `A/←` 翘头和 `D/→` 下压调整姿态，与现有逻辑一致。

---

## 3. 未吃金币保留

### 3.1 渲染

`drawCoins()` 遍历**所有**未结算金币，仅绘制在相机视口内的（含一定边距），不再限制为 `nextSettlement` 到 `nextSettlement+7`。

### 3.2 拾取

`processSettlements()` 遍历**所有**未结算金币，检查是否与拾取探针（车轮/车身/头盔）碰撞。前后分别扫描 200px 范围。玩家可以回头拾取之前跳过的金币。

### 3.3 视觉

已跳过的金币继续用同样的脉冲光晕渲染，不会消失或变淡。

---

## 4. 落地牵引力渐变

### 4.1 问题

当前后轮一着地，`tractionForce` 立即全量生效，导致"弹射起步"的突兀感。

### 4.2 方案

后轮从腾空变为着地时，启动 200ms 牵引力渐变：

```typescript
rampFactor = clamp((now - landingTime) / 200, 0.15, 1.0)
effectiveForce = tractionForce × rampFactor
```

- 0–200ms：牵引力从 15% 线性增长到 100%
- 200ms 后：全量牵引力
- 如果再次腾空，重置渐变计时器

### 4.3 实现位置

在 `RideScene.applyControls()` 中施加牵引力之前计算 rampFactor，不修改 `stepBikeControl` 纯函数。

---

## 5. 结算爆发力增强（v1 保持，适配双 combo）

以下项目从 v1 设计保留，适配双 combo：

- **Hit-Stop**：吃到金币冻结 80–140ms（按涨跌幅）
- **动态震动**：强度 = `min(0.025, 0.004 + |returnRate| × 0.18)`
- **全屏闪色**：涨红跌绿，120ms 衰减
- **定向粒子**：60% 爆炸 + 40% 飞向余额 HUD
- **Toast 分级**：普通/大额(≥3%)/极端(≥7%)
- **余额弹性过冲**：滚动结束后的弹性弹跳

---

## 6. 涉及文件

| 文件 | 变更 |
|------|------|
| `src/types.ts` | ComboSlot、DualComboState，HudState 更新 |
| `src/game/balance.ts` | getComboMultiplier（不变），settleBalance（不变） |
| `src/game/bikeControl.ts` | BikeControlInput 加 jump，Output 加 jumpForce |
| `src/game/RideScene.ts` | 双 combo 追踪、跳跃输入、全金币渲染/拾取、牵引渐变、hit-stop/震动/闪色/粒子 |
| `src/game/LeekKnightGame.ts` | GameCallbacks 扩展 |
| `src/game/audio.ts` | combo-aware 音效、combo break 音效 |
| `src/main.ts` | 双 combo HUD、toast 分级、弹性过冲、combo 断连 |
| `src/style.css` | 双 combo HUD 样式、toast 分级样式 |
| `tests/combo.test.ts` | 双 combo 乘数测试、跳跃力测试 |
| `tests/bikeControl.test.ts` | 跳跃输出测试 |

---

## 7. 验收标准

1. 涨金币和跌金币各自独立计数，互斥（吃涨断跌，吃跌断涨）
2. 各自 6 秒窗口独立倒计时
3. 空格键在任一车轮着地时触发跳跃，空中不可跳
4. 跳跃高度随速度递增
5. 跳过的金币保留在赛道上，回头可拾取
6. 后轮着地时牵引力 200ms 渐入
7. 吃到金币触发 hit-stop、震动、闪色、粒子
8. 双 combo HUD 正确显示活跃/非活跃状态
9. 高 combo 音效升级、combo 断连音效
10. 大额涨跌触发分级 toast
