import Phaser from 'phaser'
import { calculateReturn, getComboMultiplier, settleBalance } from './balance'
import { stepBikeControl, type DriveMode } from './bikeControl'
import { generateTrack, interpolateTrackY } from './track'
import type { ComboSlot, DualComboState, GeneratedTrack, HudState, RunResult, SettlementPoint, StockDataset } from '../types'

interface RideSceneOptions {
  stock: StockDataset
  initialAmount: number
  onHud: (state: HudState) => void
  onSettle: (point: SettlementPoint, balance: number, previousBalance?: number) => void
  onRespawn: () => void
  onEnd: (result: RunResult) => void
  onEngine: (speed: number) => void
  onSound: (kind: 'gain' | 'loss' | 'land' | 'crash' | 'finish', combo?: number) => void
  onComboBreak?: () => void
}

interface PickupProbe {
  x: number
  y: number
  radius: number
}

export class RideScene extends Phaser.Scene {
  private readonly options: RideSceneOptions
  private track!: GeneratedTrack
  private balance: number
  private chassis!: MatterJS.BodyType
  private rearWheel!: MatterJS.BodyType
  private frontWheel!: MatterJS.BodyType
  private riderHead!: MatterJS.BodyType
  private bikeGraphics!: Phaser.GameObjects.Graphics
  private worldGraphics!: Phaser.GameObjects.Graphics
  private coinGraphics!: Phaser.GameObjects.Graphics
  private fxGraphics!: Phaser.GameObjects.Graphics
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 's' | 'a' | 'd' | 'r' | 'space', Phaser.Input.Keyboard.Key>
  private ended = false
  private startedAt = 0
  private nextSettlement = 0
  private lastHudAt = 0
  private lastLandingAt = 0
  private throttle = 0
  private driveMode: DriveMode = 'coast'
  private leanAxis: -1 | 0 | 1 = 0
  private groundedPairs = new Set<string>()
  private rearGroundedPairs = new Set<string>()
  private dangerPairs = new Set<string>()
  private dangerContactAt = 0
  private respawnProtectedUntil = 0
  private respawning = false
  private tractionRampUntil = 0
  private jumpQueuedUntil = 0
  private particles: Array<{
    x: number
    y: number
    vx: number
    vy: number
    life: number
    color: number
    targetX?: number
    targetY?: number
  }> = []
  private gainCombo: ComboSlot = { count: 0, multiplier: 1, windowUntil: 0 }
  private lossCombo: ComboSlot = { count: 0, multiplier: 1, windowUntil: 0 }
  private frozenUntil = 0
  private physicsFrozen = false
  private flashUntil = 0
  private flashColor = 0xff4d2e
  private readonly COMBO_WINDOW_MS = 6000

  constructor(options: RideSceneOptions) {
    super({ key: 'ride' })
    this.options = options
    this.balance = options.initialAmount
  }

  create(): void {
    this.balance = this.options.initialAmount
    this.ended = false
    this.nextSettlement = 0
    this.lastHudAt = 0
    this.lastLandingAt = 0
    this.throttle = 0
    this.driveMode = 'coast'
    this.leanAxis = 0
    this.jumpQueuedUntil = 0
    this.groundedPairs.clear()
    this.rearGroundedPairs.clear()
    this.dangerPairs.clear()
    this.dangerContactAt = 0
    this.respawnProtectedUntil = 0
    this.respawning = false
    this.tractionRampUntil = 0
    this.particles = []
    this.gainCombo = { count: 0, multiplier: 1, windowUntil: 0 }
    this.lossCombo = { count: 0, multiplier: 1, windowUntil: 0 }
    this.frozenUntil = 0
    this.physicsFrozen = false
    this.flashUntil = 0
    this.flashColor = 0xff4d2e
    this.track = generateTrack(this.options.stock.candles)
    this.matter.world.engine.enabled = true
    this.matter.world.setBounds(0, this.track.minY, this.track.worldWidth, this.track.maxY - this.track.minY, 64, true, true, false, true)
    this.cameras.main.setBackgroundColor('#080a0d')
    this.worldGraphics = this.add.graphics()
    this.coinGraphics = this.add.graphics()
    this.fxGraphics = this.add.graphics()
    this.bikeGraphics = this.add.graphics().setDepth(20)
    this.drawWorld()
    this.createTerrain()
    this.createBike()
    this.bindInput()
    this.bindCollisions()
    this.startedAt = this.time.now
    this.cameras.main.fadeIn(380, 8, 10, 13)
  }

  update(time: number, delta: number): void {
    if (this.ended) return
    const frozen = time < this.frozenUntil
    if (frozen && !this.physicsFrozen) {
      this.matter.world.engine.enabled = false
      this.physicsFrozen = true
    } else if (!frozen && this.physicsFrozen) {
      this.matter.world.engine.enabled = true
      this.physicsFrozen = false
    }
    if (frozen && time < this.tractionRampUntil) {
      this.tractionRampUntil += delta
    }
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

    this.processState(time, frozen)
    this.drawFlashOverlay(time)

    if (Phaser.Input.Keyboard.JustDown(this.keys.r)) {
      this.ensurePhysicsEnabled()
      this.scene.restart()
    }
  }

  private createTerrain(): void {
    const start = this.track.points[0]
    const launchPad = this.matter.add.rectangle(start.x / 2, start.y + 12, start.x + 8, 26, {
      isStatic: true,
      friction: 1.05,
      frictionStatic: 2,
      label: 'terrain',
    })
    launchPad.restitution = 0.02

    for (let index = 0; index < this.track.points.length - 1; index += 1) {
      const left = this.track.points[index]
      const right = this.track.points[index + 1]
      const dx = right.x - left.x
      const dy = right.y - left.y
      const length = Math.hypot(dx, dy) + 8
      const body = this.matter.add.rectangle((left.x + right.x) / 2, (left.y + right.y) / 2 + 12, length, 26, {
        isStatic: true,
        angle: Math.atan2(dy, dx),
        friction: 1.05,
        frictionStatic: 2,
        label: 'terrain',
      })
      body.restitution = 0.02
    }
  }

  private createBike(): void {
    const rearX = this.track.points[0].x - 140
    const frontX = rearX + 80
    const rearY = interpolateTrackY(this.track.points, rearX) - 27
    const frontY = interpolateTrackY(this.track.points, frontX) - 27
    const angle = Math.atan2(frontY - rearY, frontX - rearX)
    const axleOffsetY = 21
    const halfWheelbase = Math.hypot(frontX - rearX, frontY - rearY) / 2
    const chassisX = (rearX + frontX) / 2 + axleOffsetY * Math.sin(angle)
    const chassisY = (rearY + frontY) / 2 - axleOffsetY * Math.cos(angle)
    const headX = chassisX - 7 * Math.cos(angle) + 43 * Math.sin(angle)
    const headY = chassisY - 7 * Math.sin(angle) - 43 * Math.cos(angle)
    const group = this.matter.world.nextGroup(true)
    const collisionFilter = { group }

    this.rearWheel = this.matter.add.circle(rearX, rearY, 23, { collisionFilter, density: 0.0015, friction: 1.05, frictionStatic: 2, frictionAir: 0.006, restitution: 0.02, label: 'bike-wheel' })
    this.frontWheel = this.matter.add.circle(frontX, frontY, 23, { collisionFilter, density: 0.0015, friction: 1.05, frictionStatic: 2, frictionAir: 0.006, restitution: 0.02, label: 'bike-wheel' })
    this.chassis = this.matter.add.rectangle(chassisX, chassisY, 76, 24, { collisionFilter, angle, density: 0.0048, friction: 0.65, frictionAir: 0.018, chamfer: { radius: 7 }, label: 'bike-chassis' })
    this.riderHead = this.matter.add.circle(headX, headY, 11, { collisionFilter, density: 0.001, isSensor: true, label: 'rider-head' })
    this.matter.add.constraint(this.chassis, this.rearWheel, 0, 0.9, { pointA: { x: -halfWheelbase, y: axleOffsetY }, damping: 0.14 })
    this.matter.add.constraint(this.chassis, this.frontWheel, 0, 0.9, { pointA: { x: halfWheelbase, y: axleOffsetY }, damping: 0.14 })
    this.matter.add.constraint(this.chassis, this.riderHead, 0, 0.98, { pointA: { x: -7, y: -43 }, damping: 0.2 })
  }

  private bindInput(): void {
    const keyboard = this.input.keyboard
    if (!keyboard) throw new Error('Keyboard input unavailable')
    keyboard.addCapture([
      Phaser.Input.Keyboard.KeyCodes.UP, Phaser.Input.Keyboard.KeyCodes.DOWN,
      Phaser.Input.Keyboard.KeyCodes.LEFT, Phaser.Input.Keyboard.KeyCodes.RIGHT,
      Phaser.Input.Keyboard.KeyCodes.W, Phaser.Input.Keyboard.KeyCodes.S,
      Phaser.Input.Keyboard.KeyCodes.A, Phaser.Input.Keyboard.KeyCodes.D,
      Phaser.Input.Keyboard.KeyCodes.SPACE,
    ])
    this.keys = keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.UP, down: Phaser.Input.Keyboard.KeyCodes.DOWN,
      left: Phaser.Input.Keyboard.KeyCodes.LEFT, right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      w: Phaser.Input.Keyboard.KeyCodes.W, s: Phaser.Input.Keyboard.KeyCodes.S,
      a: Phaser.Input.Keyboard.KeyCodes.A, d: Phaser.Input.Keyboard.KeyCodes.D,
      r: Phaser.Input.Keyboard.KeyCodes.R,
      space: Phaser.Input.Keyboard.KeyCodes.SPACE,
    }) as typeof this.keys
  }

  private bindCollisions(): void {
    this.matter.world.on('collisionstart', (event: Phaser.Physics.Matter.Events.CollisionStartEvent) => {
      for (const pair of event.pairs) {
        const labels = [pair.bodyA.label, pair.bodyB.label]
        if (!labels.includes('terrain')) continue
        const groundedKey = this.collisionPairKey(pair)
        if (groundedKey) this.groundedPairs.add(groundedKey)
        if (groundedKey && this.pairContainsBody(pair, this.rearWheel)) {
          const wasAirborne = this.rearGroundedPairs.size === 0
          this.rearGroundedPairs.add(groundedKey)
          if (wasAirborne) this.tractionRampUntil = this.time.now + 200
        }
        if (labels.includes('rider-head')) {
          const dangerKey = this.bodyPairKey(pair)
          this.dangerPairs.add(dangerKey)
          if (this.dangerContactAt === 0) this.dangerContactAt = this.time.now
        } else if (labels.includes('bike-wheel') && this.time.now - this.lastLandingAt > 260) {
          const impact = Math.abs(this.chassis.velocity.y)
          if (impact > 4) {
            this.options.onSound('land')
            this.spawnParticles(this.chassis.position.x, this.chassis.position.y + 35, 0xd3b98a, 5)
          }
          this.lastLandingAt = this.time.now
        }
      }
    })
    this.matter.world.on('collisionend', (event: Phaser.Physics.Matter.Events.CollisionEndEvent) => {
      for (const pair of event.pairs) {
        this.groundedPairs.delete(this.collisionPairKey(pair))
        this.rearGroundedPairs.delete(this.collisionPairKey(pair))
        this.dangerPairs.delete(this.bodyPairKey(pair))
      }
      if (this.dangerPairs.size === 0) this.dangerContactAt = 0
    })
  }

  private applyControls(delta: number): void {
    const accelerating = this.keys.up.isDown || this.keys.w.isDown
    const braking = this.keys.down.isDown || this.keys.s.isDown
    const leaningBack = this.keys.left.isDown || this.keys.a.isDown
    const leaningForward = this.keys.right.isDown || this.keys.d.isDown
    if (Phaser.Input.Keyboard.JustDown(this.keys.space)) {
      this.jumpQueuedUntil = this.time.now + 140
    }
    const grounded = this.groundedPairs.size > 0
    const jumping = grounded && this.time.now <= this.jumpQueuedUntil
    const leanAxis: -1 | 0 | 1 = leaningBack === leaningForward ? 0 : leaningBack ? -1 : 1
    this.leanAxis = leanAxis
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
      grounded,
      rearGrounded: this.rearGroundedPairs.size > 0,
      jump: jumping,
    })

    this.throttle = control.throttle
    this.driveMode = control.driveMode
    this.matter.body.setAngularVelocity(this.rearWheel, control.rearWheelAngularVelocity)
    if (control.frontWheelBrakeFactor < 1) {
      this.matter.body.setAngularVelocity(this.frontWheel, this.frontWheel.angularVelocity * control.frontWheelBrakeFactor)
    }
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
    if (control.jumpForce > 0) {
      this.jumpQueuedUntil = 0
      const vy = -control.jumpForce
      for (const body of [this.chassis, this.rearWheel, this.frontWheel, this.riderHead]) {
        this.matter.body.setVelocity(body, {
          x: body.velocity.x,
          y: body.velocity.y + vy,
        })
      }
    }
    if (control.pitchLoad !== 0) {
      this.matter.applyForce(this.frontWheel, { x: 0, y: control.pitchLoad })
      this.matter.applyForce(this.rearWheel, { x: 0, y: -control.pitchLoad })
    }
    if (control.pitchAngularVelocityTarget !== null) {
      this.matter.body.setAngularVelocity(
        this.chassis,
        Phaser.Math.Linear(this.chassis.angularVelocity, control.pitchAngularVelocityTarget, 0.48),
      )
    }
    this.chassis.torque += control.chassisTorque
  }

  private getRoadAngle(x: number): number {
    return Math.atan2(
      interpolateTrackY(this.track.points, x + 36) - interpolateTrackY(this.track.points, x - 36),
      72,
    )
  }

  private collisionPairKey(pair: { bodyA: MatterJS.BodyType, bodyB: MatterJS.BodyType }): string {
    const labels = [pair.bodyA.label, pair.bodyB.label]
    if (!labels.includes('terrain') || !labels.includes('bike-wheel')) return ''
    return `${Math.min(pair.bodyA.id, pair.bodyB.id)}:${Math.max(pair.bodyA.id, pair.bodyB.id)}`
  }

  private bodyPairKey(pair: { bodyA: MatterJS.BodyType, bodyB: MatterJS.BodyType }): string {
    return `${Math.min(pair.bodyA.id, pair.bodyB.id)}:${Math.max(pair.bodyA.id, pair.bodyB.id)}`
  }

  private pairContainsBody(pair: { bodyA: MatterJS.BodyType, bodyB: MatterJS.BodyType }, body: MatterJS.BodyType): boolean {
    return pair.bodyA.id === body.id || pair.bodyB.id === body.id
  }

  private drawWorld(): void {
    const graphics = this.worldGraphics
    graphics.clear()
    graphics.lineStyle(1, 0x252a31, 0.58)
    for (let x = 0; x < this.track.worldWidth; x += 340) graphics.lineBetween(x, this.track.minY, x, this.track.maxY)
    for (let y = this.track.minY; y < this.track.maxY; y += 170) graphics.lineBetween(0, y, this.track.worldWidth, y)

    const candles = this.options.stock.candles
    this.track.points.forEach((point, index) => {
      const candle = candles[index]
      const rising = candle.close >= candle.open
      const color = rising ? 0xff4d2e : 0x18b67b
      const wickScale = 900
      const bodyScale = 720
      const highY = point.y - Math.min(70, Math.max(10, (candle.high / candle.close - 1) * wickScale))
      const lowY = point.y + Math.min(70, Math.max(10, (1 - candle.low / candle.close) * wickScale))
      const bodyDelta = (candle.close / candle.open - 1) * bodyScale
      const openY = point.y + Math.sign(bodyDelta || 1) * Math.max(8, Math.min(54, Math.abs(bodyDelta)))
      graphics.lineStyle(3, color, 0.72).lineBetween(point.x, highY, point.x, lowY)
      graphics.fillStyle(color, 0.62).fillRect(point.x - 9, Math.min(point.y, openY), 18, Math.abs(openY - point.y))
    })

    graphics.lineStyle(36, 0x07080a, 0.92)
    graphics.lineBetween(0, this.track.points[0].y + 13, this.track.points[0].x, this.track.points[0].y + 13)
    for (let index = 0; index < this.track.points.length - 1; index += 1) {
      const left = this.track.points[index]
      const right = this.track.points[index + 1]
      graphics.lineBetween(left.x, left.y + 13, right.x, right.y + 13)
    }
    graphics.lineStyle(5, 0xf1e5ca, 1)
    graphics.lineBetween(0, this.track.points[0].y, this.track.points[0].x, this.track.points[0].y)
    for (let index = 0; index < this.track.points.length - 1; index += 1) {
      const left = this.track.points[index]
      const right = this.track.points[index + 1]
      graphics.lineBetween(left.x, left.y, right.x, right.y)
    }
  }

  private drawCoins(time: number): void {
    const graphics = this.coinGraphics
    const cam = this.cameras.main
    const viewLeft = cam.scrollX - 80
    const viewRight = cam.scrollX + cam.width + 80
    graphics.clear()
    for (let index = 0; index < this.track.settlements.length; index += 1) {
      const point = this.track.settlements[index]
      if (point.settled) continue
      if (point.x < viewLeft || point.x > viewRight) continue
      const positive = point.returnRate >= 0
      const pulse = 1 + Math.sin(time / 145 + index) * 0.1
      const coinRadius = (point.pickupRadius + 2) * pulse
      if (point.requiresJump) {
        graphics.lineStyle(1, positive ? 0xff6b4f : 0x38d39b, 0.3).lineBetween(point.x, point.terrainY - 18, point.x, point.y + point.pickupRadius + 12)
      }
      graphics.fillStyle(positive ? 0xff4d2e : 0x18b67b, 0.13).fillCircle(point.x, point.y, (point.pickupRadius + 16) * pulse)
      graphics.lineStyle(4, positive ? 0xff6b4f : 0x38d39b, 1).strokeCircle(point.x, point.y, coinRadius)
      graphics.fillStyle(positive ? 0xffb000 : 0x95f0ce, 1).fillCircle(point.x, point.y, Math.max(9, point.pickupRadius - 3) * pulse)
      graphics.lineStyle(3, 0x0a0c0f, 0.86).lineBetween(point.x - 6, point.y, point.x + 6, point.y)
      if (positive) graphics.lineBetween(point.x, point.y - 6, point.x, point.y + 6)
    }
  }

  private drawBike(): void {
    const graphics = this.bikeGraphics
    graphics.clear()
    const rear = this.rearWheel.position
    const front = this.frontWheel.position
    const body = this.chassis.position
    const angle = this.chassis.angle
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const rotate = (x: number, y: number): [number, number] => [body.x + x * cos - y * sin, body.y + x * sin + y * cos]

    for (const wheel of [rear, front]) {
      graphics.fillStyle(0x08090b, 1).fillCircle(wheel.x, wheel.y, 24)
      graphics.lineStyle(5, 0xe8ddc5, 1).strokeCircle(wheel.x, wheel.y, 21)
      graphics.lineStyle(2, 0x4d535c, 1)
      for (let spoke = 0; spoke < 6; spoke += 1) {
        const spokeAngle = this.rearWheel.angle + spoke * Math.PI / 3
        graphics.lineBetween(wheel.x, wheel.y, wheel.x + Math.cos(spokeAngle) * 17, wheel.y + Math.sin(spokeAngle) * 17)
      }
    }
    const rearJoint = rotate(-27, 7)
    const frontJoint = rotate(29, 6)
    const seat = rotate(-17, -12)
    const handle = rotate(28, -20)
    graphics.lineStyle(8, 0xff4d2e, 1).lineBetween(rear.x, rear.y, rearJoint[0], rearJoint[1])
    graphics.lineBetween(front.x, front.y, frontJoint[0], frontJoint[1])
    graphics.lineBetween(rearJoint[0], rearJoint[1], frontJoint[0], frontJoint[1])
    graphics.lineStyle(7, 0xffb000, 1).lineBetween(rearJoint[0], rearJoint[1], seat[0], seat[1])
    graphics.lineBetween(seat[0], seat[1], frontJoint[0], frontJoint[1])
    graphics.lineStyle(5, 0xe8ddc5, 1).lineBetween(frontJoint[0], frontJoint[1], handle[0], handle[1])
    graphics.lineBetween(handle[0] - 8 * cos, handle[1] - 8 * sin, handle[0] + 8 * cos, handle[1] + 8 * sin)

    const hip = rotate(-9, -23)
    const shoulder = rotate(-5, -44)
    const head = this.riderHead.position
    graphics.lineStyle(8, 0x2d3138, 1).lineBetween(hip[0], hip[1], shoulder[0], shoulder[1])
    graphics.lineStyle(6, 0xe8ddc5, 1).lineBetween(shoulder[0], shoulder[1], handle[0], handle[1])
    graphics.lineBetween(hip[0], hip[1], frontJoint[0], frontJoint[1])
    graphics.fillStyle(0xffb000, 1).fillCircle(head.x, head.y, 12)
    graphics.fillStyle(0x0a0c0f, 1).fillRect(head.x + 2, head.y - 6, 12, 7)
  }

  private processSettlements(): void {
    const probes = this.getPickupProbes()
    const scanMinX = this.chassis.position.x - 200
    const scanMaxX = this.chassis.position.x + 200
    for (let index = 0; index < this.track.settlements.length; index += 1) {
      const point = this.track.settlements[index]
      if (point.settled) continue
      if (point.x < scanMinX || point.x > scanMaxX) continue
      if (!this.isCoinCollected(point, probes)) continue

      const positive = point.returnRate >= 0
      const kind = positive ? 'gain' : 'loss'
      point.settled = true
      const comboMultiplier = this.advanceCombo(this.time.now, kind)
      const previousBalance = this.balance
      this.balance = settleBalance(this.balance, point.returnRate, comboMultiplier)
      this.options.onSettle(point, this.balance, previousBalance)
      this.options.onSound(positive ? 'gain' : 'loss', kind === 'gain' ? this.gainCombo.count : this.lossCombo.count)
      this.spawnSettlementParticles(point.x, point.y, positive ? 0xff6b4f : 0x38d39b, point.requiresJump ? 26 : 18)
      this.frozenUntil = this.time.now + this.getHitStopDuration(point.returnRate)
      this.flashUntil = this.time.now + 180
      this.flashColor = positive ? 0xff4d2e : 0x18b67b
      this.cameras.main.shake(
        Math.min(400, 180 + Math.abs(point.returnRate) * 300),
        Math.min(0.025, 0.004 + Math.abs(point.returnRate) * 0.18),
      )
    }
    if (this.chassis.position.x >= this.track.points.at(-1)!.x) this.endRun('finished')
  }

  private getPickupProbes(): PickupProbe[] {
    return [
      { x: this.rearWheel.position.x, y: this.rearWheel.position.y, radius: 23 },
      { x: this.frontWheel.position.x, y: this.frontWheel.position.y, radius: 23 },
      { x: this.chassis.position.x, y: this.chassis.position.y, radius: 16 },
      { x: this.riderHead.position.x, y: this.riderHead.position.y, radius: 11 },
    ]
  }

  private isCoinCollected(point: SettlementPoint, probes: PickupProbe[]): boolean {
    return probes.some((probe) => (
      Math.hypot(probe.x - point.x, probe.y - point.y) <= probe.radius + point.pickupRadius
    ))
  }

  private updateNextSettlementIndex(): void {
    const thresholdX = this.chassis.position.x - 150
    const index = this.track.settlements.findIndex((point) => !point.settled && point.x >= thresholdX)
    this.nextSettlement = index === -1 ? this.track.settlements.length : index
  }

  private processState(time: number, frozen: boolean): void {
    this.updateNextSettlementIndex()
    const progress = this.getProgress()
    const candleIndex = Math.min(this.options.stock.candles.length - 1, Math.max(0, Math.round(progress * (this.options.stock.candles.length - 1))))
    const date = this.options.stock.candles[candleIndex].date
    const nextSettlement = this.track.settlements[this.nextSettlement] ?? null
    const previousSettlementIndex = this.nextSettlement === 0 ? 0 : this.track.settlements[this.nextSettlement - 1].endIndex
    const settlementLength = Math.max(1, (nextSettlement?.endIndex ?? candleIndex) - previousSettlementIndex)
    const settlementProgress = Phaser.Math.Clamp((candleIndex - previousSettlementIndex) / settlementLength, 0, 1)
    if (time - this.lastHudAt > 80) {
      this.options.onHud({
        balance: this.balance,
        returnRate: calculateReturn(this.options.initialAmount, this.balance),
        date,
        progress,
        speed: Math.abs(this.chassis.velocity.x),
        throttle: this.throttle,
        grounded: this.groundedPairs.size > 0,
        rearGrounded: this.rearGroundedPairs.size > 0,
        driveMode: this.driveMode,
        leanAxis: this.leanAxis,
        chassisAngle: this.chassis.angle,
        nextSettlementDate: nextSettlement?.endDate ?? null,
        settlementProgress,
        combo: this.getDualComboState(),
        frozenUntil: this.frozenUntil,
      })
      this.lastHudAt = time
    }
    if (frozen) return
    const trackY = interpolateTrackY(this.track.points, this.chassis.position.x)
    const canCrash = time - this.startedAt > 2500 && time > this.respawnProtectedUntil && !this.respawning
    if (canCrash && this.dangerContactAt > 0 && time - this.dangerContactAt > 240) this.respawnBike()
    if (canCrash && (this.chassis.position.y > trackY + 650 || this.chassis.position.x < 20)) this.respawnBike()
  }

  private updateCamera(): void {
    const camera = this.cameras.main
    const lookAhead = Phaser.Math.Clamp(this.chassis.velocity.x * 18, -35, 150)
    camera.scrollX += (this.chassis.position.x + lookAhead - camera.width * 0.34 - camera.scrollX) * 0.08
    camera.scrollY += (this.chassis.position.y - camera.height * 0.54 - camera.scrollY) * 0.055
  }

  private spawnParticles(x: number, y: number, color: number, count: number): void {
    for (let index = 0; index < count; index += 1) {
      this.particles.push({ x, y, vx: Phaser.Math.FloatBetween(-2.8, 2.8), vy: Phaser.Math.FloatBetween(-4.5, -0.8), life: Phaser.Math.Between(350, 850), color })
    }
  }

  private spawnSettlementParticles(x: number, y: number, color: number, count: number): void {
    const cam = this.cameras.main
    const hudX = cam.scrollX + cam.width / 2
    const hudY = cam.scrollY + 88
    const explosionCount = Math.floor(count * 0.6)
    const flyCount = count - explosionCount

    for (let index = 0; index < explosionCount; index += 1) {
      this.particles.push({
        x,
        y,
        vx: Phaser.Math.FloatBetween(-3.5, 3.5),
        vy: Phaser.Math.FloatBetween(-5.5, -1),
        life: Phaser.Math.Between(350, 850),
        color,
      })
    }
    for (let index = 0; index < flyCount; index += 1) {
      this.particles.push({
        x,
        y,
        vx: Phaser.Math.FloatBetween(-1.5, 1.5),
        vy: Phaser.Math.FloatBetween(-3.5, -1),
        life: Phaser.Math.Between(500, 750),
        color,
        targetX: hudX + Phaser.Math.FloatBetween(-80, 80),
        targetY: hudY + Phaser.Math.FloatBetween(-30, 30),
      })
    }
  }

  private drawFlashOverlay(time: number): void {
    if (time >= this.flashUntil) return
    const elapsed = this.flashUntil - time
    const alpha = Math.min(0.22, elapsed / 180 * 0.3)
    const cam = this.cameras.main
    this.fxGraphics.fillStyle(this.flashColor, alpha)
    this.fxGraphics.fillRect(cam.scrollX, cam.scrollY, cam.width, cam.height)
  }

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

  private respawnBike(): void {
    if (this.respawning || this.ended) return
    this.ensurePhysicsEnabled()
    this.respawning = true
    this.options.onRespawn()
    this.options.onSound('crash')
    this.cameras.main.shake(260, 0.01)

    const firstX = this.track.points[0].x
    const lastX = this.track.points.at(-1)!.x
    const rearX = Phaser.Math.Clamp(this.chassis.position.x - 38, firstX, lastX - 90)
    const frontX = rearX + 80
    const rearY = interpolateTrackY(this.track.points, rearX) - 30
    const frontY = interpolateTrackY(this.track.points, frontX) - 30
    const angle = Math.atan2(frontY - rearY, frontX - rearX)
    const axleOffsetY = 21
    const chassisX = (rearX + frontX) / 2 + axleOffsetY * Math.sin(angle)
    const chassisY = (rearY + frontY) / 2 - axleOffsetY * Math.cos(angle)
    const headX = chassisX - 7 * Math.cos(angle) + 43 * Math.sin(angle)
    const headY = chassisY - 7 * Math.sin(angle) - 43 * Math.cos(angle)

    this.spawnParticles(this.chassis.position.x, this.chassis.position.y, 0xffb000, 24)
    this.matter.body.setPosition(this.rearWheel, { x: rearX, y: rearY })
    this.matter.body.setPosition(this.frontWheel, { x: frontX, y: frontY })
    this.matter.body.setPosition(this.chassis, { x: chassisX, y: chassisY })
    this.matter.body.setPosition(this.riderHead, { x: headX, y: headY })
    this.matter.body.setAngle(this.chassis, angle)
    this.matter.body.setAngle(this.riderHead, angle)
    for (const body of [this.rearWheel, this.frontWheel, this.chassis, this.riderHead]) {
      this.matter.body.setVelocity(body, { x: 0, y: 0 })
      this.matter.body.setAngularVelocity(body, 0)
    }
    this.throttle = 0
    this.driveMode = 'coast'
    this.leanAxis = 0
    this.groundedPairs.clear()
    this.rearGroundedPairs.clear()
    this.dangerPairs.clear()
    this.dangerContactAt = 0
    const hadCombo = this.hadActiveCombo()
    this.resetAllCombos()
    if (hadCombo) {
      this.options.onComboBreak?.()
    }
    this.respawnProtectedUntil = this.time.now + 1300

    this.time.delayedCall(220, () => {
      this.respawning = false
      this.cameras.main.flash(160, 255, 176, 0, false)
    })
  }

  private endRun(reason: 'finished'): void {
    if (this.ended) return
    this.frozenUntil = 0
    this.ensurePhysicsEnabled()
    this.ended = true
    this.options.onSound('finish')
    this.cameras.main.shake(140, 0.004)
    const progress = this.getProgress()
    const candleIndex = Math.min(this.options.stock.candles.length - 1, Math.round(progress * (this.options.stock.candles.length - 1)))
    this.time.delayedCall(420, () => this.options.onEnd({
      reason,
      stock: this.options.stock.metadata,
      initialAmount: this.options.initialAmount,
      finalAmount: this.balance,
      progress,
      date: this.options.stock.candles[candleIndex].date,
    }))
  }

  private getProgress(): number {
    const startX = this.track.points[0].x
    const endX = this.track.points.at(-1)!.x
    return Phaser.Math.Clamp((this.chassis.position.x - startX) / (endX - startX), 0, 1)
  }

  private advanceCombo(time: number, kind: 'gain' | 'loss'): number {
    const currentSlot = kind === 'gain' ? this.gainCombo : this.lossCombo
    const otherSlot = kind === 'gain' ? this.lossCombo : this.gainCombo
    const brokeVisibleCombo = otherSlot.count > 1

    if (time < currentSlot.windowUntil) {
      currentSlot.count += 1
    } else {
      currentSlot.count = 1
    }
    currentSlot.windowUntil = time + this.COMBO_WINDOW_MS
    currentSlot.multiplier = getComboMultiplier(currentSlot.count)

    otherSlot.count = 0
    otherSlot.multiplier = 1
    otherSlot.windowUntil = 0
    if (brokeVisibleCombo) this.options.onComboBreak?.()

    return currentSlot.multiplier
  }

  private decayCombos(time: number): void {
    let brokeVisibleCombo = false
    for (const slot of [this.gainCombo, this.lossCombo]) {
      if (slot.count > 0 && time >= slot.windowUntil) {
        brokeVisibleCombo ||= slot.count > 1
        slot.count = 0
        slot.multiplier = 1
        slot.windowUntil = 0
      }
    }
    if (brokeVisibleCombo) this.options.onComboBreak?.()
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

  private ensurePhysicsEnabled(): void {
    this.matter.world.engine.enabled = true
    this.physicsFrozen = false
  }
}
