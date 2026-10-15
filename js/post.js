// 後製：泛光（太陽、天空、被陽光打亮的地方會微微發光）+ rust 風格的色彩分級。
// 順序：場景 → 第一人稱的手和槍 → 泛光 → 色調映射/轉 sRGB → 光束、調色、暗角、底片顆粒。
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
    uSun: { value: new THREE.Vector2(0.5, 0.5) }, uSunVis: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; uniform vec2 uSun; uniform float uSunVis; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // 光束：從太陽在畫面上的位置往外放射取樣亮的地方，被樹擋住的縫就會變成一道一道的光
      if (uSunVis > 0.001) {
        vec2 delta = (vUv - uSun) * (0.85 / 28.0);
        vec2 uv = vUv; float decay = 1.0, illum = 0.0;
        for (int i = 0; i < 28; i++) {
          uv -= delta;
          vec3 s = texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).rgb;
          illum += max(dot(s, vec3(0.3333)) - 0.74, 0.0) * decay;
          decay *= 0.95;
        }
        c += vec3(1.0, 0.9, 0.74) * illum * 0.06 * uSunVis;
      }
      // 輕微 S 曲線：暗部更沉、亮部更亮
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.24);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.12);
      // 分離色調：陰影偏冷藍、亮部偏暖黃，rust 截圖最明顯的那種調子
      c *= mix(vec3(0.94, 0.98, 1.06), vec3(1.05, 1.0, 0.93), smoothstep(0.12, 0.8, l));
      // 暗角
      vec2 d = vUv - 0.5; d.x *= uRes.x / uRes.y;
      c *= mix(1.0, 0.72, smoothstep(0.42, 1.05, length(d)));
      // 底片顆粒
      c += (hash(vUv * uRes + fract(uTime * 7.13) * 91.7) - 0.5) * 0.026;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

export function createPost(renderer, scene, camera, vmScene, vmCam) {
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  // 手上的槍另外畫在最上層：不清顏色、只清深度
  const vmPass = new RenderPass(vmScene, vmCam);
  vmPass.clear = false;
  vmPass.clearDepth = true;
  composer.addPass(vmPass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.55, 1.6);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  return {
    composer, vmPass, bloom, grade,
    setSize(w, h, pr) {
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      grade.uniforms.uRes.value.set(w * pr, h * pr);
    },
    // sunScreen：太陽投影到畫面上的 uv；sunVis：太陽在畫面附近才有光束（0~1）
    render(dt, t, showVm, sunScreen, sunVis) {
      vmPass.enabled = showVm;
      grade.uniforms.uTime.value = t;
      if (sunScreen) grade.uniforms.uSun.value.copy(sunScreen);
      grade.uniforms.uSunVis.value = sunVis || 0;
      composer.render(dt);
    },
  };
}
