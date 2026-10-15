import * as THREE from 'three';
import { COMMON_GLSL, MAT } from '../render/lighting.js';
import { terrainHeight, WORLD_HALF } from './terrainMath.js';

export function createTerrain(shared) {
  const size = WORLD_HALF * 2;
  const seg = 240;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();

  const mat = new THREE.ShaderMaterial({
    uniforms: { ...shared },
    vertexShader: /* glsl */`
      ${COMMON_GLSL}
      varying vec3 vP; varying vec3 vN;
      void main(){
        vec4 wp = modelMatrix*vec4(position, 1.0);
        vP = wp.xyz; vN = normal;
        gl_Position = projectionMatrix*viewMatrix*wp;
      }`,
    fragmentShader: /* glsl */`
      ${COMMON_GLSL}
      varying vec3 vP; varying vec3 vN;
      void main(){
        vec2 p = vP.xz;
        float pd = pathDist(p) + (vnoise(p*0.7) - 0.5)*1.2;
        float pathM = 1.0 - smoothstep(1.4, 2.6, pd);
        float dl = length(p - LAKE_XZ);
        float shore = 1.0 - smoothstep(LAKE_R*0.6, LAKE_R*0.74, dl);
        vec3 ground = vec3(0.07, 0.13, 0.06)*(0.6 + 0.8*(vnoise(p*0.35)*0.6 + vnoise(p*0.8)*0.4));
        vec3 dirt = vec3(0.24, 0.18, 0.12)*(0.6 + 0.7*vnoise(p*2.2));
        dirt *= 0.75 + 0.5*step(0.82, hash12(floor(p*3.0)));   // pebbles
        vec3 mud = vec3(0.10, 0.11, 0.10)*(0.7 + 0.5*vnoise(p*1.5));
        vec3 alb = mix(ground, dirt, pathM);
        alb = mix(alb, mud, shore);
        alb *= 1.0 - uRain*0.25; // wet ground is darker
        alb *= mix(1.0, 0.3, grassDensity(p));   // the glyph grass covers it; keep the soil dark
        vec3 c = shade(alb, normalize(vN), vP, 0.1)*blobShadow(vP);
        gl_FragColor = vec4(c, 1.0);
        WRITE_ID(${MAT.GROUND});
      }`,
  });

  const mesh = new THREE.Mesh(geo, mat);
  return mesh;
}
