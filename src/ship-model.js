// Original TUNNELRAT mine interceptor. Metres, local +Z forward, pilot eye at
// the origin. All visible vertices fit the unchanged 1.4 m collision sphere.
// Broad shapes are authored station rings, not stretched primitive stand-ins.
import * as THREE from 'three';
import { grungeTexture } from './util/grungetex.js';

export const SHIP_MODEL = Object.freeze({
  radius: 1.4, maxVertexRadius: 1.38, maxDraws: 10, maxTriangles: 2400,
  // [z, half-width, roof, belly]. Linear station interpolation cannot overshoot.
  stations: [
    [-1.08,.29,.15,.20],[-.80,.45,.27,.30],[-.35,.50,.34,.32],
    [.22,.43,.28,.29],[.65,.29,.17,.20],[1.02,.13,.07,.12],[1.20,.04,.01,.06],
  ],
});

// Collect static parts in rest coordinates. One material/draw for all painted
// armor, with metre-based UVs; markings stay attached if the root ship rolls.
class Batch {
  constructor(){this.position=[];this.normal=[];this.uv=[];this.color=[];}
  add(geometry,color,matrix=new THREE.Matrix4()){
    const g=geometry.index?geometry.toNonIndexed():geometry.clone();
    g.applyMatrix4(matrix);const p=g.attributes.position,n=g.attributes.normal;
    const c=new THREE.Color(color);
    for(let i=0;i<p.count;i++){
      const x=p.getX(i),y=p.getY(i),z=p.getZ(i),nx=n.getX(i),ny=n.getY(i),nz=n.getZ(i);
      this.position.push(x,y,z);this.normal.push(nx,ny,nz);this.color.push(c.r,c.g,c.b);
      // Planar rest projection, one repeat per metre, selected by face normal.
      this.uv.push(Math.abs(nx)>.65?z:x,Math.abs(ny)>.65?z:y);
    }
    g.dispose();geometry.dispose();
  }
  mesh(material,name){
    const g=new THREE.BufferGeometry();
    for(const [key,data,size] of [['position',this.position,3],['normal',this.normal,3],['uv',this.uv,2],['color',this.color,3]])g.setAttribute(key,new THREE.Float32BufferAttribute(data,size));
    g.computeBoundingSphere();const mesh=new THREE.Mesh(g,material);mesh.name=name;return mesh;
  }
}

function skin(rings){
  const p=[],n=rings[0].length;
  const tri=(a,b,c)=>p.push(...a,...b,...c);
  for(let j=0;j<rings.length-1;j++)for(let i=0;i<n;i++){
    const k=(i+1)%n;tri(rings[j][i],rings[j+1][i],rings[j+1][k]);tri(rings[j][i],rings[j+1][k],rings[j][k]);
  }
  for(const [r,reverse] of [[rings[0],false],[rings.at(-1),true]]){
    const center=[0,0,0];for(const v of r)for(let i=0;i<3;i++)center[i]+=v[i]/n;
    for(let i=0;i<n;i++)reverse?tri(center,r[(i+1)%n],r[i]):tri(center,r[i],r[(i+1)%n]);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.computeVertexNormals();return g;
}

// Clockwise octagonal section viewed from +Z. Chamfers carry the hull's light.
function hull(stations){return skin(stations.map(([z,w,t,b])=>[
  [0,t,z],[w*.72,t*.78,z],[w,t*.12,z],[w*.78,-b*.72,z],
  [0,-b,z],[-w*.78,-b*.72,z],[-w,t*.12,z],[-w*.72,t*.78,z],
]));}

function plate(points,y,thickness){
  // Convex authored outlines, no concave fan triangulation or random greebles.
  const area=points.reduce((s,p,i)=>{const q=points[(i+1)%points.length];return s+p[0]*q[1]-q[0]*p[1];},0);
  if(area>0)points=points.slice().reverse();
  const p=[],tri=(a,b,c)=>p.push(...a,...b,...c);
  const a=points.map(([x,z])=>[x,y+thickness/2,z]),b=points.map(([x,z])=>[x,y-thickness/2,z]);
  for(let i=1;i<a.length-1;i++){tri(a[0],a[i],a[i+1]);tri(b[0],b[i+1],b[i]);}
  for(let i=0;i<a.length;i++){const j=(i+1)%a.length;tri(a[i],b[i],b[j]);tri(a[i],b[j],a[j]);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.computeVertexNormals();return g;
}

const transform=(x,y,z,rx=0,ry=0,rz=0)=>new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromEuler(new THREE.Euler(rx,ry,rz)),new THREE.Vector3(1,1,1));

function driveCollar(){
  const p=[],tri=(a,b,c)=>p.push(...a,...b,...c);
  const point=(i,r,z)=>[Math.cos(i*Math.PI/4)*r,Math.sin(i*Math.PI/4)*r,z];
  for(let i=0;i<8;i++){
    const j=(i+1)%8,a=point(i,.22,-1.045),b=point(j,.22,-1.045),c=point(i,.15,-1.045),d=point(j,.15,-1.045),e=point(i,.125,-.99),f=point(j,.125,-.99);
    tri(a,c,d);tri(a,d,b);tri(c,e,f);tri(c,f,d);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.computeVertexNormals();return g;
}

export function buildPlayerShip(){
  const group=new THREE.Group();group.name='tunnelrat-interceptor';
  const armor=new Batch(),glass=new Batch(),drive=new Batch(),ports=new Batch();
  const silver=0x929c9e,green=0x3e7551,dark=0x263136,edge=0x59656b;
  armor.add(hull(SHIP_MODEL.stations),silver);
  // Swept shoulders replace rectangular wings; split green panels preserve the
  // established silver/green identity while exposing the silhouette's sweep.
  for(const side of [-1,1]){
    const mirrored=ps=>side===1?ps:ps.map(([x,z])=>[-x,z]).reverse();
    armor.add(plate(mirrored([[.32,.45],[.65,.31],[1.25,-.12],[1.13,-.48],[.43,-.72]]),-.035,.17),silver);
    armor.add(plate(mirrored([[.52,.22],[.72,.14],[1.12,-.14],[1.02,-.32],[.49,-.47]]),.062,.025),green);
    armor.add(plate(mirrored([[.83,-.26],[1.13,-.18],[1.09,-.37],[.80,-.49]]),.084,.015),dark);
    // Short forward forks are integral reinforced rails, within the hull sphere.
    const rail=hull([[-.18,.10,.08,.08],[.72,.09,.07,.07],[1.20,.045,.045,.045]]);
    armor.add(rail,edge,transform(side*.39,-.085,0));
    armor.add(new THREE.BoxGeometry(.09,.055,.32),green,transform(side*.39,.005,.62));
    armor.add(new THREE.BoxGeometry(.055,.045,.045),dark,transform(side*.39,-.085,1.245));
    // Recessed octagonal drives. The dark collar remains visible around the
    // smaller luminous core even when the headlamp is close to the hull.
    const engine=skin([[-.98,.235],[-.72,.28],[-.40,.19]].map(([z,r])=>Array.from({length:8},(_,i)=>{
      const a=i*Math.PI/4;return [Math.cos(a)*r+side*.53,Math.sin(a)*r-.035,z];
    })));
    armor.add(engine,edge);
    armor.add(driveCollar(),dark,transform(side*.53,-.035,0));
    drive.add(new THREE.CylinderGeometry(.125,.125,.008,8),0xffffff,transform(side*.53,-.035,-.995,Math.PI/2));
    // Visible lateral/vertical maneuvering ports explain the 6DOF vehicle.
    armor.add(new THREE.BoxGeometry(.06,.14,.23),dark,transform(side*1.17,-.025,-.16));
    armor.add(new THREE.BoxGeometry(.18,.025,.25),dark,transform(side*.73,.12,-.15));
    ports.add(new THREE.BoxGeometry(.012,.055,.10),0xffffff,transform(side*1.205,-.025,-.16));
    ports.add(new THREE.BoxGeometry(.075,.009,.12),0xffffff,transform(side*.73,.138,-.15));
    armor.add(new THREE.BoxGeometry(.18,.025,.25),dark,transform(side*.73,-.14,-.15));
  }
  // A faceted glazed canopy follows its sill, anchored above the unchanged eye.
  armor.add(hull([[-.42,.255,.085,.03],[.05,.265,.13,.03],[.60,.15,.04,.03]]),dark,transform(0,.265,0));
  glass.add(hull([[-.37,.19,.06,.02],[-.12,.22,.17,.02],[.28,.19,.12,.02],[.53,.10,.015,.02]]),0xffffff,transform(0,.33,0));
  armor.add(new THREE.BoxGeometry(.045,.035,.40),edge,transform(0,.48,-.035,-.12));
  armor.add(plate([[-.18,-.95],[.18,-.95],[.21,-.48],[-.21,-.48]],.28,.03),green);
  // Three broad service louvers, baked into the static batch.
  for(let i=0;i<3;i++)armor.add(new THREE.BoxGeometry(.29,.018,.035),dark,transform(0,.30,-.82+i*.095));
  // Protected nose sensor below the forks, and compact dorsal radio blade.
  armor.add(new THREE.BoxGeometry(.22,.095,.075),dark,transform(0,-.105,1.08));
  armor.add(plate([[-.035,-.67],[.035,-.67],[.035,-.37],[-.035,-.37]],.37,.16),edge);

  group.add(armor.mesh(new THREE.MeshLambertMaterial({vertexColors:true,map:grungeTexture(),flatShading:true}),'painted-hull'));
  group.add(glass.mesh(new THREE.MeshPhongMaterial({color:0x152b32,specular:0x8ed7d4,shininess:65,flatShading:true}),'canopy'));
  // Self-lit cores must not turn white when the chase camera's headlamp hits them.
  const coreMat=new THREE.MeshBasicMaterial({color:0xe85e20});
  group.add(drive.mesh(coreMat,'twin-drive-cores'));
  group.add(ports.mesh(new THREE.MeshLambertMaterial({color:0x51746a,emissive:0x2b8e70,emissiveIntensity:.25}),'maneuvering-ports'));
  const pilotEye=new THREE.Object3D();pilotEye.name='pilot-eye';group.add(pilotEye);
  return {group,refs:{pilotEye,coreMat}};
}
