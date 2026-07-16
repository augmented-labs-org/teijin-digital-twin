import { Engine, Scene } from "@babylonjs/core";
import { useCallback, useEffect, useRef, type ComponentProps } from "react";
import { World } from "../core/world";

type BabylonWorldProps = ComponentProps<'canvas'>

export function BabylonWorld(props: BabylonWorldProps) {
    const reactCanvas = useRef(null);

    /*
    
    */

    const onSceneReady = useCallback((scene: Scene) => {
        const world = new World(scene)
    }, [])

    /*

    */

    useEffect(() => {
        const canvas = reactCanvas.current

        if (!canvas) {
            return;
        }

        const engine = new Engine(canvas, true, {

        }, true);

        const scene = new Scene(engine, {

        });

        if (scene.isReady()) {
            onSceneReady(scene);
        } else {
            scene.onReadyObservable.addOnce((scene) => onSceneReady(scene));
        }

        engine.runRenderLoop(() => {
            scene.render();
        });

        const resize = () => {
            scene.getEngine().resize();
        };

        if (window) {
            window.addEventListener("resize", resize);
        }

        return () => {
            scene.getEngine().dispose();

            if (window) {
                window.removeEventListener("resize", resize);
            }
        };
    }, []);

    return <canvas ref={reactCanvas} {...props} />;
}