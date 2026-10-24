/** Keep labels on the camera-facing lower facade throughout an orbit. */
export function orbitFacingAnchor(anchor,module,cameraPosition,viewDirection,footprint) {
  // Orthographic rays are parallel, so every pavilion uses the same azimuth.
  const view=viewDirection||cameraPosition;
  const azimuth=Math.atan2(view.x,view.z);
  const dx=Math.sin(azimuth),dz=Math.cos(azimuth);
  const radius=module.isCenter?Math.hypot(anchor.x-module.pos.x,anchor.z-module.pos.z):
    footprint?Math.min(footprint.halfWidth/Math.max(.00001,Math.abs(dx)),
                       footprint.halfDepth/Math.max(.00001,Math.abs(dz)))+.6:5.3;
  return {x:module.pos.x+dx*radius,y:anchor.y,z:module.pos.z+dz*radius};
}
