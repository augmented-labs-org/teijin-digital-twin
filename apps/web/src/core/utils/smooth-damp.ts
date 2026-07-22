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
