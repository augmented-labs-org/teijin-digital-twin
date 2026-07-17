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
