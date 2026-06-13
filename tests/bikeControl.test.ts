import { describe, expect, it } from 'vitest'
import { getTorqueFactor, stepBikeControl, type BikeControlInput } from '../src/game/bikeControl'

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

describe('bike control model', () => {
  it('ramps throttle and rear-wheel speed while accelerate is held', () => {
    const first = stepBikeControl(input({ accelerate: true }))
    const second = stepBikeControl(input({ accelerate: true, throttle: first.throttle, rearWheelAngularVelocity: first.rearWheelAngularVelocity }))

    expect(first.throttle).toBeGreaterThan(0)
    expect(second.throttle).toBeGreaterThan(first.throttle)
    expect(second.rearWheelAngularVelocity).toBeGreaterThan(first.rearWheelAngularVelocity)
    expect(second.tractionForce).toBeGreaterThan(0)
    expect(second.driveMode).toBe('drive')
  })

  it('provides stronger motor acceleration at low speed', () => {
    expect(getTorqueFactor(0)).toBeGreaterThan(getTorqueFactor(10))
    const lowSpeed = stepBikeControl(input({ accelerate: true, throttle: 1 }))
    const highSpeed = stepBikeControl(input({ accelerate: true, throttle: 1, speedX: 10 }))
    expect(lowSpeed.tractionForce).toBeGreaterThan(highSpeed.tractionForce)
  })

  it('adds torque reserve on steep climbs without boosting flat top speed', () => {
    const flat = stepBikeControl(input({ accelerate: true, throttle: 1, roadAngle: 0 }))
    const climb = stepBikeControl(input({ accelerate: true, throttle: 1, roadAngle: -0.7 }))

    expect(climb.tractionForce).toBeGreaterThan(flat.tractionForce)
    expect(climb.rearWheelAngularVelocity).toBeGreaterThan(flat.rearWheelAngularVelocity)
  })

  it('keeps anti-stall drive when the front wheel is the only grounded wheel', () => {
    const frontOnly = stepBikeControl(input({ accelerate: true, throttle: 1, rearGrounded: false, grounded: true, roadAngle: -0.9 }))
    expect(frontOnly.tractionForce).toBeGreaterThan(0)
  })

  it('provides extra breakaway force when nearly stalled', () => {
    const stalled = stepBikeControl(input({ accelerate: true, throttle: 1, speedX: 0.2, roadAngle: -0.9 }))
    const moving = stepBikeControl(input({ accelerate: true, throttle: 1, speedX: 5, roadAngle: -0.9 }))
    expect(stalled.tractionForce).toBeGreaterThan(moving.tractionForce * 2)
  })

  it('brakes at speed and reverses only near a stop with rear traction', () => {
    const braking = stepBikeControl(input({ brake: true, speedX: 5, rearWheelAngularVelocity: 0.4 }))
    const reversing = stepBikeControl(input({ brake: true, speedX: 0.2, rearWheelAngularVelocity: 0 }))
    const continuingReverse = stepBikeControl(input({ brake: true, speedX: -2, rearWheelAngularVelocity: -0.1 }))

    expect(braking.driveMode).toBe('brake')
    expect(braking.rearWheelAngularVelocity).toBeLessThan(0.4)
    expect(reversing.driveMode).toBe('reverse')
    expect(reversing.rearWheelAngularVelocity).toBeLessThan(0)
    expect(continuingReverse.driveMode).toBe('reverse')
  })

  it('does not auto-level the chassis while airborne', () => {
    const airborne = stepBikeControl(input({ grounded: false, rearGrounded: false, chassisAngle: 0.6 }))
    const manualLean = stepBikeControl(input({ grounded: false, rearGrounded: false, leanAxis: -1, chassisAngle: 0.6 }))

    expect(airborne.chassisTorque).toBe(0)
    expect(manualLean.chassisTorque).toBeLessThan(0)
  })

  it('loads the wheels in opposite directions for wheelies and nose-down control', () => {
    const wheelie = stepBikeControl(input({ leanAxis: -1 }))
    const noseDown = stepBikeControl(input({ leanAxis: 1 }))

    expect(wheelie.chassisTorque).toBeLessThan(-0.04)
    expect(wheelie.pitchAngularVelocityTarget).toBeLessThan(0)
    expect(wheelie.pitchLoad).toBeLessThan(0)
    expect(noseDown.chassisTorque).toBeGreaterThan(0.04)
    expect(noseDown.pitchAngularVelocityTarget).toBeGreaterThan(0)
    expect(noseDown.pitchLoad).toBeGreaterThan(0)
  })

  it('keeps applying pitch velocity while a lean key is held', () => {
    const grounded = stepBikeControl(input({ leanAxis: -1, chassisAngularVelocity: 0.04 }))
    const airborne = stepBikeControl(input({ leanAxis: -1, grounded: false, rearGrounded: false }))
    const released = stepBikeControl(input({ leanAxis: 0 }))

    expect(grounded.pitchAngularVelocityTarget).toBe(-0.075)
    expect(airborne.pitchAngularVelocityTarget).toBe(-0.11)
    expect(released.pitchAngularVelocityTarget).toBeNull()
  })

  it('returns zero jump force when jump is not pressed and rear grounded', () => {
    const result = stepBikeControl(input({ rearGrounded: true, jump: false }))

    expect(result.jumpForce).toBe(0)
  })

  it('returns zero jump force when airborne even if jump is pressed', () => {
    const result = stepBikeControl(input({ grounded: false, rearGrounded: false, jump: true }))

    expect(result.jumpForce).toBe(0)
  })

  it('returns positive jump force when jump is pressed from rear-grounded state', () => {
    const result = stepBikeControl(input({ rearGrounded: true, jump: true }))

    expect(result.jumpForce).toBeGreaterThan(0)
  })

  it('returns positive jump force when jump is pressed with only the front wheel grounded', () => {
    const result = stepBikeControl(input({ grounded: true, rearGrounded: false, jump: true }))

    expect(result.jumpForce).toBeGreaterThan(0)
  })

  it('increases jump force with speed', () => {
    const slow = stepBikeControl(input({ rearGrounded: true, jump: true, speedX: 2 }))
    const fast = stepBikeControl(input({ rearGrounded: true, jump: true, speedX: 12 }))

    expect(fast.jumpForce).toBeGreaterThan(slow.jumpForce)
  })
})
