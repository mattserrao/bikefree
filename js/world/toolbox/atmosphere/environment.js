// Toolbox: the sky as environment light (fidelity plan, step 4). The world's own sky dome (sky-dome.js: its gradient,
// sun glow and clouds) is rendered into a prefiltered environment map (PMREM) and set as scene.environment, so every
// PBR material (materials/lit.js) gets its ambient light and its reflections from the sky it stands under: blue from
// above, warm from the sun's side, the horizon's haze in a wet road. Rebuilt when the light changes (time of day) and
// otherwise left alone: a fixed-time map builds it once, behind the loader.
//
//   const env = new SkyEnvironment(renderer)
//   env.update(sky, ground)    rebuild from the sky dome's current look (call after sky.set) over the ground's colour
//   env.texture, env.dispose()
import * as THREE from '../../../../vendor/three.js';

export class SkyEnvironment {
  constructor(renderer) {
    this.renderer = renderer;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.scene = new THREE.Scene();
    // the lower half: the ground's colour (bounce light from below), not the sky's haze
    this.groundMat = new THREE.MeshBasicMaterial({ color: 0x6b6a58, side: THREE.DoubleSide, toneMapped: false });
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(20000, 32).rotateX(-Math.PI / 2), this.groundMat);
    this.ground.position.y = -2;
    this.texture = null;
  }
  /** Render the sky dome's mesh (shared geometry and material, at the origin) into a new PMREM. */
  update(sky, groundColor = null) {
    if (!sky?.mesh) return this.texture;
    const m = new THREE.Mesh(sky.mesh.geometry, sky.mesh.material);
    m.frustumCulled = false;
    if (groundColor) this.groundMat.color.set(groundColor);
    this.scene.clear(); this.scene.add(m, this.ground);
    const rt = this.pmrem.fromScene(this.scene, 0, 1, (sky.mesh.geometry.boundingSphere?.radius || 9000) * 2);
    this.rt?.dispose(); this.rt = rt;
    this.texture = rt.texture;
    return this.texture;
  }
  dispose() { this.rt?.dispose(); this.pmrem.dispose(); this.scene.clear(); this.ground.geometry.dispose(); this.groundMat.dispose(); }
}
