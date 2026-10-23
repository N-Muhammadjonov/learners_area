/** Camera-facing labels preserving approved original projection at 45 degrees. */
export function orbitFacingAnchor(anchor,module,cameraPosition) {
  if(module.isCenter)return {x:anchor.x,y:anchor.y,z:anchor.z};
  const azimuth=Math.atan2(cameraPosition.x,cameraPosition.z);
  const base=Math.PI/4;
  const diff=Math.atan2(Math.sin(azimuth-base),Math.cos(azimuth-base));
  const t0=Math.PI/18,t1=Math.PI/4;
  const t=Math.min(1,Math.max(0,(Math.abs(diff)-t0)/(t1-t0)));
  const blend=t*t*(3-2*t);
  const dx=cameraPosition.x-module.pos.x;
  const dz=cameraPosition.z-module.pos.z;
  const dist=Math.max(.00001,Math.hypot(dx,dz));
  const radius=5.3;
  return {
    x:anchor.x*(1-blend)+(module.pos.x+dx/dist*radius)*blend,
    y:anchor.y*(1-blend)+3.1*blend,
    z:anchor.z*(1-blend)+(module.pos.z+dz/dist*radius)*blend
  };
}
