import * as THREE from 'three';

/**
 * Height fog + distance haze for every built-in material: replaces three's fog chunks so the
 * haze is thickest down over the lake (y ≈ −50) and thins out with altitude. Uses FogExp2's
 * density and color, which the time-of-day rig drives. Call before any material compiles.
 */
export function installHeightFog(opts = { lakeY: -50, scaleHeight: 140, haze: 0.12 }) {
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  C.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogWorld;
#endif`;
  C.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vec4 fogW = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    fogW = batchingMatrix * fogW;
  #endif
  #ifdef USE_INSTANCING
    fogW = instanceMatrix * fogW;
  #endif
  vFogWorld = ( modelMatrix * fogW ).xyz;
#endif`;
  C.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  C.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  float fogDist = length( vFogWorld - cameraPosition );
  #ifdef FOG_EXP2
    // integrate an exponential height profile along the view ray (closed form, average height)
    // (abs: the lake's mirror camera sits below the water; its rays really start at the mirrored height)
    float fogH = max( 0.0, 0.5 * ( ( vFogWorld.y - ${opts.lakeY.toFixed(1)} ) + abs( cameraPosition.y - ${opts.lakeY.toFixed(1)} ) ) );
    float fogFactor = 1.0 - exp( - fogDensity * fogDist * exp( - fogH / ${opts.scaleHeight.toFixed(1)} ) );
    // plus plain distance haze (aerial perspective), so far ridges fade blue even high above the fog
    fogFactor = 1.0 - ( 1.0 - fogFactor ) * exp( - fogDensity * ${opts.haze.toFixed(3)} * fogDist );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, fogDist );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;
}
