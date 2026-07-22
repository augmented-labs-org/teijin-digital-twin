import { World } from "@/core/world";
import { Engine, Scene } from "@babylonjs/core";
import { useEffect, useRef, type ComponentProps } from "react";

type BabylonWorldProps = {
    onWorldLoad?: (world: World) => void
} & ComponentProps<'canvas'>

export function BabylonWorld({ onWorldLoad, ...props }: BabylonWorldProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current

        if (!canvas) {
            return
        }

        const engine = new Engine(canvas, true, {}, true)

        // High-DPR phones otherwise render the 3D scene *and* re-rasterize the
        // full-screen GUI layer (all the entity tags) at 2–3× native resolution,
        // which dominates mobile frame time. Cap the effective device-pixel-ratio
        // at 2. hardwareScalingLevel is 1/DPR, so flooring it at 0.5 caps DPR while
        // leaving 1× and 2× displays (most desktops/laptops) untouched.
        const MAX_DPR = 2
        engine.setHardwareScalingLevel(Math.max(engine.getHardwareScalingLevel(), 1 / MAX_DPR))

        const scene = new Scene(engine)

        const onSceneReady = (scene: Scene) => {
            const world = new World(scene)
            world.load().then(() => {
                if (scene.isDisposed) {
                    return
                }
                
                onWorldLoad?.(world)
            })
        }

        if (scene.isReady()) {
            onSceneReady(scene)
        } else {
            scene.onReadyObservable.addOnce(onSceneReady)
        }

        engine.runRenderLoop(() => {
            scene.render()
        })

        const resize = () => {
            engine.resize()
        }

        window.addEventListener("resize", resize)

        const toggleInspector = async () => {
            if (scene.debugLayer.isVisible()) {
                scene.debugLayer.hide()
                return
            }

            await import("@babylonjs/inspector")
            scene.debugLayer.show({ overlay: true })
        }

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "o") {
                event.preventDefault()
                toggleInspector()
            }
        }

        window.addEventListener("keydown", onKeyDown)

        return () => {
            window.removeEventListener("resize", resize)
            window.removeEventListener("keydown", onKeyDown)
            engine.dispose()
        }
    }, [canvasRef, onWorldLoad])

    return <canvas ref={canvasRef} {...props} />;
}
