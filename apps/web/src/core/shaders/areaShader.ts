import { AbstractMesh, Color3, Effect, Engine, Matrix, Nullable, Scene, ShaderMaterial, SubMesh } from "@babylonjs/core";

// Register custom shader code in Babylon's ShaderStore
Effect.ShadersStore["roomVertexShader"] = `
    precision highp float;
    attribute vec3 position;
    uniform mat4 worldViewProjection;
    varying float vLocalY;

    void main(void) {
        vLocalY = position.y;
        gl_Position = worldViewProjection * vec4(position, 1.0);
    }
`;

Effect.ShadersStore["roomFragmentShader"] = `
    precision highp float;
    varying float vLocalY;
    uniform float localMinY;
    uniform float localMaxY;
    uniform vec3 zoneColor;
    uniform float fadePower;
    uniform float baseAlpha;

    void main(void) {
        float factor = clamp((vLocalY - localMinY) / (localMaxY - localMinY), 0.0, 1.0);
        float alphaFade = (1.0 - factor) * baseAlpha;

        gl_FragColor = vec4(zoneColor, alphaFade);
    }
`;

export class AreaMaterial extends ShaderMaterial {
    constructor(name: string, scene: Scene) {
        super(name, scene, {
            vertex: "room",
            fragment: "room"
        }, {
            attributes: ["position"],
            uniforms: ["worldViewProjection", "localMinY", "localMaxY", "zoneColor", "fadePower", "baseAlpha"],
            needAlphaBlending: true
        })
    }

    setup(minY: number, maxY: number, color: Color3, fadePower = 4.0) {
        this.setFloat("localMinY", minY);
        this.setFloat("localMaxY", maxY);
        this.setColor3("zoneColor", color);
        this.setFloat("fadePower", fadePower);

        this.alphaMode = Engine.ALPHA_COMBINE;
        this.backFaceCulling = false;
        this.disableDepthWrite = true;

        this.zOffset = -1; // Pulls the rendered depth slightly forward to prevent fighting
    }

    override bind(world: Matrix, mesh?: AbstractMesh, effectOverride?: Nullable<Effect>, subMesh?: SubMesh) {
        this.setFloat("baseAlpha", this.alpha);
        super.bind(world, mesh, effectOverride, subMesh);
    }
}