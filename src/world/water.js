// Lake surface: rolling ripples, rain rings, a shimmering moon reflection,
// torchlight glints and a pale line of foam along the shore.

import * as THREE from 'three';
import { COMMON_GLSL, MAT } from '../render/lighting.js';
import { LAKE, WATER_LEVEL } from './terrainMath.js';

export function createWater(shared) {
  const geo = new THREE.CircleGeometry(LAKE.r * 0.78, 96);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...shared },
    vertexShader: /* glsl */`
      ${COMMON_GLSL}
      varying vec3 vP;
      void main(){
        vec4 wp = modelMatrix*vec4(position, 1.0);
        vP = wp.xyz;
        gl_Position = projectionMatrix*viewMatrix*wp;
      }`,
    fragmentShader: /* glsl */`
      ${COMMON_GLSL}
      varying vec3 vP;
      float waveH(vec2 p){
        float h = vnoise(p*0.35 + uWindDir*uTime*0.6)*0.6 + vnoise(p*0.9 - uWindDir.yx*uTime*0.9)*0.3;
        h *= 0.35 + uWindStrength*0.5;
        // rain rings
        if (uRain > 0.01){
          vec2 g = p/2.2; vec2 id = floor(g); vec2 f = fract(g) - 0.5;
          float r = hash12(id);
          vec2 c = vec2(hash12(id + 3.1), hash12(id + 7.7)) - 0.5;
          float ph = fract(uTime*0.9 + r);
          float d = length(f - c*0.6);
          h += exp(-pow((d - ph*0.55)*28.0, 2.0))*(1.0 - ph)*0.5*uRain;
        }
        return h;
      }
      void main(){
        vec2 p = vP.xz;
        float e = 0.06;
        float h0 = waveH(p);
        float hx = waveH(p + vec2(e, 0.0));
        float hz = waveH(p + vec2(0.0, e));
        vec3 N = normalize(vec3(-(hx - h0)/e*0.35, 1.0, -(hz - h0)/e*0.35));
        vec3 V = normalize(cameraPosition - vP);
        vec3 R = reflect(-V, N);
        float fres = 0.04 + 0.96*pow(1.0 - max(dot(N, V), 0.0), 5.0);

        vec3 deep = vec3(0.012, 0.025, 0.045);
        vec3 c = deep*lightAll(N, vP, 0.0)*2.5;
        vec3 sky = uFogColor*1.1 + uAmbient*0.8 + uMoonColor*0.15;
        c += sky*fres;

        // moon reflection: sharp disc + soft halo, broken up by ripples
        vec3 moonRef = normalize(vec3(0.12, 0.84, -0.53));
        float md = max(dot(R, moonRef), 0.0);
        c += uMoonColor*(pow(md, 2500.0)*4.0 + pow(md, 120.0)*0.35);

        // torch glints
        for (int i = 0; i < MAX_LIGHTS; i++){
          if (i >= uLightCount) break;
          vec3 d = uLightPos[i].xyz - vP;
          float dist = length(d);
          float att = 1.0 - smoothstep(0.0, uLightPos[i].w*1.8, dist);
          c += uLightColor[i]*pow(max(dot(R, d/dist), 0.0), 60.0)*att*3.0;
        }

        // shore foam
        float depth = WATER_LEVEL - terrainHeight(p);
        float foam = (1.0 - smoothstep(0.0, 0.35, depth))*(0.5 + 0.5*sin(uTime*1.5 + length(p - LAKE_XZ)*3.0));
        c += (uAmbient*2.0 + uMoonColor*0.5 + torchLight(vec3(0.0,1.0,0.0), vP, 0.5)*0.4)*foam;

        c = fogIt(c, vP)*(1.0 + uFlash*3.0);
        gl_FragColor = vec4(c, 1.0);
        WRITE_ID(${MAT.WATER});
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(LAKE.x, WATER_LEVEL, LAKE.z);
  return mesh;
}
