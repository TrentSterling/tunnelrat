// Node-only import map for the game's pinned Three.js dependency.
// THREE_MODULE may point to an existing three@0.179.0 build/three.module.js.
import {pathToFileURL} from 'node:url';
import path from 'node:path';
export async function resolve(specifier,context,next){
  if(specifier==='three')return {url:pathToFileURL(path.resolve(process.env.THREE_MODULE||'../validation-deps/node_modules/three/build/three.module.js')).href,shortCircuit:true};
  return next(specifier,context);
}
