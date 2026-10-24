/**
 * Learners Area 3D Campus Module Labels
 * Exact dark navy rounded pills positioned across building middle/front faces,
 * with glowing neon borders, crisp typography, and bidirectional interaction.
 */

import * as THREE from '../vendor/three-runtime.js';
import { orbitFacingAnchor } from './campus-label-anchors.js';

export class CampusLabels {
  constructor(container, camera, onNavigate) {
    this.container = container;
    this.camera = camera;
    this.onNavigate = onNavigate;
    this.labels = [];
    this.viewDirection=new THREE.Vector3();
    this.overlay = document.createElement('div');
    this.overlay.className = 'campus-labels-overlay';
    this.overlay.style.zIndex = '20';
    this.container.appendChild(this.overlay);
  }

  initLabels(modules, iconSvgMap) {
    // Clear previous
    this.overlay.innerHTML = '';
    this.labels = [];

    modules.forEach(m => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'campus-module-label';
      el.style.setProperty('--module-accent',m.accentHex);
      el.style.transform='translate(-50%, -50%) scale(1.08)';
      el.style.backgroundColor = 'rgba(8, 15, 29, 0.92)';
      el.style.border = `1.5px solid ${m.accentHex}`;
      el.style.boxShadow = `0 0 12px ${m.accentHex}66, inset 0 0 6px ${m.accentHex}33`;
      el.setAttribute('aria-label', `Navigate to ${m.name}`);
      el.setAttribute('data-module-id', m.id);

      const iconSvg = iconSvgMap[m.icon] || '';
      el.innerHTML = `
        <span class="module-icon inline-flex shrink-0 w-3.5 h-3.5" style="color: ${m.accentHex}; fill: ${m.accentHex};">${iconSvg}</span>
        <span class="module-text whitespace-nowrap text-[0.8125rem] font-medium leading-none">${m.name}</span>
      `;

      // 3D Anchor position: calibrated label position
      const anchorPos = m.labelPos 
        ? new THREE.Vector3(m.labelPos.x, m.labelPos.y, m.labelPos.z)
        : new THREE.Vector3(m.pos.x + (m.labelOffset?.x || 0), m.pos.y + (m.labelOffset?.y || 0), m.pos.z + (m.labelOffset?.z || 0));

      // Event handlers
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.onNavigate) this.onNavigate(m);
      });

      el.addEventListener('mouseenter', () => {
        el.style.boxShadow = `0 0 20px ${m.accentHex}aa, inset 0 0 8px ${m.accentHex}66`;
        el.style.transform = 'translate(-50%, -50%) scale(1.1664)';
        window.dispatchEvent(new CustomEvent('campus-module-hover', { detail: { id: m.id, active: true } }));
      });

      el.addEventListener('mouseleave', () => {
        el.style.boxShadow = `0 0 12px ${m.accentHex}66, inset 0 0 6px ${m.accentHex}33`;
        el.style.transform = 'translate(-50%, -50%) scale(1.08)';
        window.dispatchEvent(new CustomEvent('campus-module-hover', { detail: { id: m.id, active: false } }));
      });

      this.overlay.appendChild(el);
      this.labels.push({ el, anchorPos, module: m });
    });
  }

  update(width, height) {
    this.camera.updateMatrixWorld();
    this.camera.getWorldDirection(this.viewDirection).negate();
    const point=new THREE.Vector3();
    const occupied=[];
    // Keep every available label on screen. Previously a collision led to
    // visibility:hidden and made buildings inaccessible when orbiting.
    const ordered=[...this.labels].sort((a,b)=>{
      if(a.module.isCenter)return -1;
      if(b.module.isCenter)return 1;
      return 0; // stable module order avoids collision-layout swaps while orbiting
    });
    for(const item of ordered){
      const anchor=orbitFacingAnchor(item.anchorPos,item.module,this.camera.position,this.viewDirection,item.footprint);
      point.set(anchor.x,anchor.y,anchor.z).project(this.camera);
      const el=item.el;
      if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.z>1||point.z< -1){
        el.style.visibility='hidden';
        continue;
      }
      el.style.display='flex';
      el.style.visibility='visible';
      const halfW=Math.max(31,(el.offsetWidth||105)*1.08/2);
      const halfH=Math.max(10,(el.offsetHeight||24)*1.08/2);
      const margin=6;
      const baseX=THREE.MathUtils.clamp((point.x*.5+.5)*width,halfW+margin,Math.max(halfW+margin,width-halfW-margin));
      const baseY=THREE.MathUtils.clamp((-point.y*.5+.5)*height,halfH+margin,Math.max(halfH+margin,height-halfH-margin));
      const rectAt=(x,y)=>({left:x-halfW,right:x+halfW,top:y-halfH,bottom:y+halfH});
      const overlap=(a,b)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*
                           Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
      let selected=null;
      let minimum=Infinity;
      // Search nearby screen positions rather than dropping the label entirely.
      const stride=halfH*2+8;
      for(let ring=0;ring<=11;ring++){
        const offsets=ring===0?[[0,0]]:
          [[0,-ring*stride],[0,ring*stride],[-ring*18,0],[ring*18,0],
           [-ring*12,-ring*stride],[ring*12,ring*stride]];
        for(const [ox,oy] of offsets){
          const x=THREE.MathUtils.clamp(baseX+ox,halfW+margin,Math.max(halfW+margin,width-halfW-margin));
          const y=THREE.MathUtils.clamp(baseY+oy,halfH+margin,Math.max(halfH+margin,height-halfH-margin));
          const box=rectAt(x,y);
          const total=occupied.reduce((cost,old)=>cost+overlap(box,old),0);
          const cost=total*1000+Math.abs(ox)+Math.abs(oy);
          if(cost<minimum){minimum=cost;selected={x,y,box};}
          if(total===0)break;
        }
        if(minimum<1000)break;
      }
      if(!selected)continue;
      occupied.push(selected.box);
      el.style.left=`${selected.x.toFixed(1)}px`;
      el.style.top=`${selected.y.toFixed(1)}px`;
      el.style.zIndex=String(item.module.isCenter?3:2);
    }
  }

  setHighlight(moduleId, active) {
    for (const item of this.labels) {
      if (item.module.id === moduleId) {
        if (active) {
          item.el.style.boxShadow = `0 0 24px ${item.module.accentHex}cc, inset 0 0 10px ${item.module.accentHex}88`;
          item.el.style.transform = 'translate(-50%, -50%) scale(1.1664)';
        } else {
          item.el.style.boxShadow = `0 0 12px ${item.module.accentHex}66, inset 0 0 6px ${item.module.accentHex}33`;
          item.el.style.transform = 'translate(-50%, -50%) scale(1.08)';
        }
      }
    }
  }
}
