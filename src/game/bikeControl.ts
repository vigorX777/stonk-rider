export type DriveMode = 'drive' | 'coast' | 'brake' | 'reverse'

export interface BikeControlInput {
  deltaMs: number
  throttle: number
  accelerate: boolean
  brake: boolean
  leanAxis: -1 | 0 | 1
  speedX: number
  roadAngle: number
  chassisAngle: number
  chassisAngularVelocity: number
  rearWheelAngularVelocity: number
  grounded: boolean
  rearGrounded: boolean
  jump: boolean
}

export interface BikeControlOutput {
  throttle: number
  rearWheelAngularVelocity: number
  frontWheelBrakeFactor: number
  chassisTorque: number
  pitchAngularVelocityTarget: number | null
  pitchLoad: number
  tractionForce: number
  jumpForce: number
  driveMode: DriveMode
  torqueFactor: number
}

export const BIKE_MAX_SPEED = 18
const MAX_WHEEL_SPEED = 1

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function moveTowards(value: number, target: number, maxDelta: number): number {
  if (Math.abs(target - value) <= maxDelta) return target
  return value + Math.sign(target - value) * maxDelta
}

export function getTorqueFactor(speedX: number): number {
  const speedRatio = clamp(Math.abs(speedX) / BIKE_MAX_SPEED, 0, 1)
  return 0.45 + 0.55 * Math.pow(1 - speedRatio, 1.25)
}

export function getJumpForce(speedX: number): number {
  const base = 8
  const speedBonus = Math.min(5, Math.abs(speedX) / BIKE_MAX_SPEED * 5)
  return base + speedBonus
}

export function stepBikeControl(input: BikeControlInput): BikeControlOutput {
  const frame = clamp(input.deltaMs / 16.67, 0.25, 2)
  const wantsDrive = input.accelerate && !input.brake
  const throttleTarget = wantsDrive ? 1 : 0
  const throttleRate = throttleTarget > input.throttle ? 0.1 : 0.12
  const throttle = moveTowards(input.throttle, throttleTarget, throttleRate * frame)
  const torqueFactor = getTorqueFactor(input.speedX)

  let driveMode: DriveMode = wantsDrive ? 'drive' : 'coast'
  let rearWheelAngularVelocity = input.rearWheelAngularVelocity
  let frontWheelBrakeFactor = 1
  let tractionForce = 0

  if (wantsDrive) {
    const tractionFactor = input.rearGrounded ? 1 : input.grounded ? 0.68 : 0.32
    const climbFactor = 1 + clamp(-input.roadAngle / 1.1, 0, 1) * 3.5
    const antiStallFactor = 1 + clamp((3 - Math.abs(input.speedX)) / 3, 0, 1) * 2
    const acceleration = 0.08 * torqueFactor * tractionFactor * climbFactor * antiStallFactor * Math.max(0.35, throttle) * frame
    rearWheelAngularVelocity = moveTowards(rearWheelAngularVelocity, MAX_WHEEL_SPEED * throttle, acceleration)
    if (input.grounded && input.speedX < BIKE_MAX_SPEED) {
      tractionForce = 0.022 * throttle * torqueFactor * climbFactor * antiStallFactor * frame
    }
  } else if (input.brake) {
    const reversing = input.speedX < 0.35 && input.rearGrounded
    driveMode = reversing ? 'reverse' : 'brake'
    rearWheelAngularVelocity = reversing
      ? moveTowards(rearWheelAngularVelocity, -0.22, 0.009 * frame)
      : rearWheelAngularVelocity * Math.pow(0.84, frame)
    frontWheelBrakeFactor = Math.pow(0.86, frame)
  } else {
    rearWheelAngularVelocity *= Math.pow(0.994, frame)
  }

  const leanStrength = input.grounded ? 0.062 : 0.048
  let chassisTorque = input.leanAxis * leanStrength * frame
  const pitchLoad = input.grounded ? input.leanAxis * 0.011 * frame : 0
  const pitchAngularVelocityTarget = input.leanAxis === 0
    ? null
    : input.leanAxis * (input.grounded ? 0.075 : 0.11)
  const jumpForce = input.jump && input.grounded ? getJumpForce(input.speedX) : 0
  if (input.leanAxis === 0 && input.grounded) {
    const angleError = Math.atan2(
      Math.sin(input.roadAngle - input.chassisAngle),
      Math.cos(input.roadAngle - input.chassisAngle),
    )
    const stabilization = angleError * 0.013 - input.chassisAngularVelocity * 0.032
    chassisTorque += clamp(stabilization, -0.01, 0.01) * frame
  }

  return {
    throttle,
    rearWheelAngularVelocity,
    frontWheelBrakeFactor,
    chassisTorque,
    pitchAngularVelocityTarget,
    pitchLoad,
    tractionForce,
    jumpForce,
    driveMode,
    torqueFactor,
  }
}
