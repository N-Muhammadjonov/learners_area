/** Camera-facing labels preserving approved original projection at 45 degrees. */
export function orbitFacingAnchor(anchor,module,cameraPosition,viewDirection,footprint) {
  // Orthographic rays are parallel. Using camera-to-building vectors made
  // different buildings switch their visible face at different orbit angles.
  const view=viewDirection||cameraPosition;
  const azimuth=Math.atan2(view.x,view.z);
  const base=Math.PI/4;
  const diff=Math.atan2(Math.sin(azimuth-base),Math.cos(azimuth-base));
  const t0=Math.PI/18,t1=Math.PI/4;
  const t=Math.min(1,Math.max(0,(Math.abs(diff)-t0)/(t1-t0)));
  const blend=t*t*(3-2*t);
  const dx=Math.sin(azimuth);
  const dz=Math.cos(azimuth);
  const dist=Math.max(.00001,Math.hypot(dx,dz));
  const radius=module.isCenter?Math.hypot(anchor.x-module.pos.x,anchor.z-module.pos.z):
    footprint?Math.min(footprint.halfWidth/Math.max(.00001,Math.abs(dx)),
                       footprint.halfDepth/Math.max(.00001,Math.abs(dz)))+.35:5.3;
  return {
    x:anchor.x*(1-blend)+(module.pos.x+dx/dist*radius)*blend,
    y:anchor.y,
    z:anchor.z*(1-blend)+(module.pos.z+dz/dist*radius)*blend
  };
}
