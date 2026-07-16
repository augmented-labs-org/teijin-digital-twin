import { Color3, DirectionalLight, HemisphericLight, MeshBuilder, ShadowGenerator, StandardMaterial, Vector3, type Scene } from "@babylonjs/core";
import { MapCamera } from "./map-camera";

export class World {

    private scene: Scene

    constructor(scene: Scene) {
        this.scene = scene

        const camera = new MapCamera('camera', scene)
        camera.attachControl()

        const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), this.scene)
        hemi.intensity = 0.9
        hemi.groundColor = new Color3(0.82, 0.82, 0.8)
        hemi.specular = Color3.Black()

        const sun = new DirectionalLight('sun', new Vector3(-0.55, -1, -0.35), this.scene)
        sun.position = new Vector3(80, 140, 60)
        sun.intensity = 0.6

        const shadowGenerator = new ShadowGenerator(2048, sun)
        shadowGenerator.useBlurExponentialShadowMap = true
        shadowGenerator.blurKernel = 32
        shadowGenerator.setDarkness(0.35)

        const groundMat = new StandardMaterial('groundMat', this.scene)
        groundMat.diffuseColor = Color3.FromHexString('#fbfaf8')
        groundMat.specularColor = Color3.Black()

        const ground = MeshBuilder.CreateGround('ground', { width: 4000, height: 4000 }, this.scene)
        
        ground.material = groundMat
        ground.receiveShadows = true
        ground.position.y = -0.05
    }

}