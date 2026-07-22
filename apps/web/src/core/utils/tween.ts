import { Vector3 } from "@babylonjs/core"

/** Critically-damped spring towards `target`, Game Programming Gems / Unity SmoothDamp style. */
export function smoothDampFloat(current: number, target: number, velocity: number, smoothTime: number, dt: number): [number, number] {
    const omega = 2 / smoothTime
    const x = omega * dt
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)

    const change = current - target
    const temp = (velocity + omega * change) * dt
    const nextVelocity = (velocity - omega * temp) * exp
    let output = target + (change + temp) * exp

    // Prevent overshoot past the goal from flipping the sign of the remaining distance.
    if ((target - current > 0) === (output > target)) {
        output = target
        return [output, (output - target) / dt]
    }

    return [output, nextVelocity]
}

export function smoothDampVector3(current: Vector3, target: Vector3, velocity: Vector3, smoothTime: number, dt: number): [Vector3, Vector3] {
    const [x, vx] = smoothDampFloat(current.x, target.x, velocity.x, smoothTime, dt)
    const [y, vy] = smoothDampFloat(current.y, target.y, velocity.y, smoothTime, dt)
    const [z, vz] = smoothDampFloat(current.z, target.z, velocity.z, smoothTime, dt)
    return [new Vector3(x, y, z), new Vector3(vx, vy, vz)]
}

/** Clamp `value` into the `[min, max]` range. */
export function clamp(value: number, min: number, max: number): number {
    return value < min ? min : value > max ? max : value
}

/** Linear interpolation between `a` and `b` by `t` (unclamped). */
export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
}

/** Linear interpolation between two vectors by `t` (unclamped). */
export function lerpVector3(a: Vector3, b: Vector3, t: number): Vector3 {
    return new Vector3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t))
}

/** Inverse of `lerp`: returns the `t` such that `lerp(a, b, t) === value`. */
export function inverseLerp(a: number, b: number, value: number): number {
    return a === b ? 0 : (value - a) / (b - a)
}

/** Re-map `value` from the `[inMin, inMax]` range onto `[outMin, outMax]`. */
export function remap(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
    return lerp(outMin, outMax, inverseLerp(inMin, inMax, value))
}

/** Hermite smoothstep between `edge0` and `edge1`; eases in and out, output clamped to `[0, 1]`. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
    const t = clamp(inverseLerp(edge0, edge1, x), 0, 1)
    return t * t * (3 - 2 * t)
}

/** Higher-order (quintic) smoothstep with zero 1st and 2nd derivatives at the edges. */
export function smootherstep(edge0: number, edge1: number, x: number): number {
    const t = clamp(inverseLerp(edge0, edge1, x), 0, 1)
    return t * t * t * (t * (t * 6 - 15) + 10)
}

/**
 * Framerate-independent exponential smoothing towards `target`.
 * `smoothing` is the fraction remaining after one second; smaller = snappier.
 */
export function damp(current: number, target: number, smoothing: number, dt: number): number {
    return lerp(current, target, 1 - Math.pow(smoothing, dt))
}

export function dampVector3(current: Vector3, target: Vector3, smoothing: number, dt: number): Vector3 {
    const t = 1 - Math.pow(smoothing, dt)
    return lerpVector3(current, target, t)
}

/** Easing functions taking normalized time `t` in `[0, 1]` and returning eased `[0, 1]`. */
export const easing = {
    linear: (t: number): number => t,

    quadIn: (t: number): number => t * t,
    quadOut: (t: number): number => t * (2 - t),
    quadInOut: (t: number): number => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),

    cubicIn: (t: number): number => t * t * t,
    cubicOut: (t: number): number => {
        const u = t - 1
        return u * u * u + 1
    },
    cubicInOut: (t: number): number => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),

    sineIn: (t: number): number => 1 - Math.cos((t * Math.PI) / 2),
    sineOut: (t: number): number => Math.sin((t * Math.PI) / 2),
    sineInOut: (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2,

    expoIn: (t: number): number => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
    expoOut: (t: number): number => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),

    elasticOut: (t: number): number => {
        if (t === 0 || t === 1) return t
        const c = (2 * Math.PI) / 3
        return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c) + 1
    },

    backOut: (t: number): number => {
        const c1 = 1.70158
        const c3 = c1 + 1
        const u = t - 1
        return 1 + c3 * u * u * u + c1 * u * u
    },

    bounceOut: (t: number): number => {
        const n1 = 7.5625
        const d1 = 2.75
        if (t < 1 / d1) return n1 * t * t
        if (t < 2 / d1) {
            const u = t - 1.5 / d1
            return n1 * u * u + 0.75
        }
        if (t < 2.5 / d1) {
            const u = t - 2.25 / d1
            return n1 * u * u + 0.9375
        }
        const u = t - 2.625 / d1
        return n1 * u * u + 0.984375
    },
} as const
