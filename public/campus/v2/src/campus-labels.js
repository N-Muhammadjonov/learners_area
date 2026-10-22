/**
 * Learners Area 3D Campus Module Labels
 * Exact dark navy rounded pills positioned across building middle/front faces,
 * with glowing neon borders, crisp typography, and bidirectional interaction.
 */

import * as THREE from 'https://esm.sh/three@0.180.0';

export class CampusLabels {
  constructor(container, camera, onNavigate) {
    this.container = container;
    this.camera = camera;
    this.onNavigate = onNavigate;
    this.labels = [];
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
        el.style.transform = 'translate(-50%, -50%) scale(1.08)';
        window.dispatchEvent(new CustomEvent('campus-module-hover', { detail: { id: m.id, active: true } }));
      });

      el.addEventListener('mouseleave', () => {
        el.style.boxShadow = `0 0 12px ${m.accentHex}66, inset 0 0 6px ${m.accentHex}33`;
        el.style.transform = 'translate(-50%, -50%) scale(1.0)';
        window.dispatchEvent(new CustomEvent('campus-module-hover', { detail: { id: m.id, active: false } }));
      });

      this.overlay.appendChild(el);
      this.labels.push({ el, anchorPos, module: m });
    });
  }

  update(width, height) {
    const tempVec = new THREE.Vector3();

    const placed=[];
    // Screen-space collision handling keeps the buildings visible at low camera angles.
    // Preserve the exact words and SVG icons; only fade colliding labels.
    const ordered=[...this.labels].sort((a,b)=>{
      const da=this.camera.position.distanceToSquared(a.anchorPos);
      const db=this.camera.position.distanceToSquared(b.anchorPos);
      return (a.module.id==="dashboard"?-1:b.module.id==="dashboard"?1:da-db);
    });
    for (const item of ordered) {
      tempVec.copy(item.anchorPos);
      tempVec.project(this.camera);

      // Check if behind camera
      if (tempVec.z > 1.0 || tempVec.z < -1.0 || !Number.isFinite(tempVec.x) || !Number.isFinite(tempVec.y)) {
        item.el.style.display = 'none';
        continue;
      }

      item.el.style.display = 'flex';
      const screenX = (tempVec.x * 0.5 + 0.5) * width;
      const screenY = (-tempVec.y * 0.5 + 0.5) * height;

      item.el.style.left = `${screenX.toFixed(1)}px`;
      item.el.style.top = `${screenY.toFixed(1)}px`;
      const estimatedWidth=Math.min(165,Math.max(80,item.module.name.length*7.2+35));
      const rect={left:screenX-estimatedWidth/2,right:screenX+estimatedWidth/2,
        top:screenY-14,bottom:screenY+14};
      const colliding=placed.some(other=>
        rect.left<other.right+5&&rect.right>other.left-5&&
        rect.top<other.bottom+5&&rect.bottom>other.top-5);
      const clipped=rect.right<0||rect.left>width||rect.bottom<0||rect.top>height;
      item.el.style.visibility=clipped||colliding?'hidden':'visible';
      if(!clipped&&!colliding)placed.push(rect);
    }
  }

  setHighlight(moduleId, active) {
    for (const item of this.labels) {
      if (item.module.id === moduleId) {
        if (active) {
          item.el.style.boxShadow = `0 0 24px ${item.module.accentHex}cc, inset 0 0 10px ${item.module.accentHex}88`;
          item.el.style.transform = 'translate(-50%, -50%) scale(1.12)';
        } else {
          item.el.style.boxShadow = `0 0 12px ${item.module.accentHex}66, inset 0 0 6px ${item.module.accentHex}33`;
          item.el.style.transform = 'translate(-50%, -50%) scale(1.0)';
        }
      }
    }
  }
}
