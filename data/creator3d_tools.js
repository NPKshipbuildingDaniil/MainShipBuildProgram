/**
 * ============================================================================
 * ФАЙЛ: creator3d_tools.js
 * НАЗНАЧЕНИЕ: Функции создания конкретных 3D-примитивов и сложных тел.
 * ============================================================================
 * ИНФОРМАЦИЯ ДЛЯ НЕЙРОСЕТЕЙ И РАЗРАБОТЧИКОВ:
 * - В этом файле должно находиться "производство" геометрии.
 * - Функции вида `createPlate`, `createCylinder`, `createKnitsa` и т.д.
 * - Если добавляется новый инструмент в панель (например, "Создать сферу"),
 *   сама функция построения Mesh-а должна быть прописана здесь.
 * - Логика модификации готовой геометрии, такая как `performCutout` 
 *   с использованием операций CSG (вычитание/сложение), также принадлежит
 *   данному модулю.
 */
// --- МОДУЛЬ ПАРАМЕТРИЧЕСКОЙ 3D-ГИБКИ (ВЕРСИЯ 2.0) ---

window.showBend3DDimensions = true;
window.bendDimMarkers = window.bendDimMarkers || [];

window.clearBendDimMarkers = function() {
    if (window.bendDimMarkers) {
        for (const m of window.bendDimMarkers) {
            if (m.htmlElement) m.htmlElement.remove();
        }
        window.bendDimMarkers.length = 0;
    }
};

window.toggle3DBendDimensions = function() {
    const el = document.getElementById('qi-bend-show-dims');
    if (el) {
        window.showBend3DDimensions = el.checked;
    } else {
        window.showBend3DDimensions = !window.showBend3DDimensions;
    }
    if (typeof window.updateBendPhantoms === 'function') {
        window.updateBendPhantoms();
    }
};

window.clearBendPhantoms = function() {
    if (typeof bendPhantoms !== 'undefined') {
        for (const phantom of bendPhantoms) {
            creatorScene.remove(phantom);
            if (phantom.geometry) phantom.geometry.dispose();
            if (phantom.material) phantom.material.dispose();
        }
    }
    bendPhantoms.length = 0;
    window.clearBendDimMarkers();
    if (typeof clearBendHoverPhantom === 'function') {
        clearBendHoverPhantom();
    }
};

window.buildSingleBendPhantom = function(object, edge, options = {}) {
    if (!object || !edge) return null;
    if (typeof window.isProfileObject === 'function' && window.isProfileObject(object)) return null;

    const lenEl = document.getElementById('qi-bend-length');
    const length = options.length !== undefined ? options.length : (lenEl ? (parseFloat(lenEl.value) || 100) : 100);

    const angleEl = document.getElementById('qi-bend-angle');
    const angleDeg = options.angleDeg !== undefined ? options.angleDeg : (angleEl ? (parseFloat(angleEl.value) || 90) : 90);
    const angleRad = THREE.MathUtils.degToRad(angleDeg);

    const invertEl = document.getElementById('qi-bend-invert');
    const invert = options.invert !== undefined ? options.invert : (invertEl ? invertEl.checked : false);

    const plateData = object.userData.specData;
    let t = 10;
    if (edge && typeof edge.thickness === 'number' && edge.thickness > 0) {
        t = edge.thickness;
    } else if (plateData) {
        t = (plateData.t || plateData.th || plateData.wallThick || plateData.thickness || plateData.depth || 10) * (object.scale.y || 1);
    }

    let radiusInput = document.getElementById('qi-bend-radius')?.value;
    let R = (radiusInput !== undefined && radiusInput !== '') ? parseFloat(radiusInput) : t;
    if (isNaN(R) || R < 0) R = t;

    const mode = window.bendRadiusMode || 'inner';
    let Rin, Rout;
    if (mode === 'outer') {
        Rout = Math.max(t + 0.1, R);
        Rin = Math.max(0.1, R - t);
    } else if (mode === 'middle') {
        const Rmid = Math.max(t / 2 + 0.1, R);
        Rin = Math.max(0.1, Rmid - t / 2);
        Rout = Rin + t;
    } else { // 'inner' default
        Rin = Math.max(0.1, R);
        Rout = Rin + t;
    }

    const shape = new THREE.Shape();
    const bendDeduction = Rout * Math.tan(angleRad / 2);
    const straightLength = Math.max(1.0, length - bendDeduction);

    if (!invert) { // Bend UP
        const cx = 0;
        const cy = t/2 + Rin;
        shape.moveTo(0, -t/2);
        shape.absarc(cx, cy, Rout, -Math.PI/2, -Math.PI/2 + angleRad, false);
        
        const endOuterX = cx + Rout * Math.cos(-Math.PI/2 + angleRad);
        const endOuterY = cy + Rout * Math.sin(-Math.PI/2 + angleRad);
        const dirX = Math.cos(angleRad);
        const dirY = Math.sin(angleRad);
        
        const tipOuterX = endOuterX + dirX * straightLength;
        const tipOuterY = endOuterY + dirY * straightLength;
        shape.lineTo(tipOuterX, tipOuterY);
        
        const tipInnerX = tipOuterX - dirY * t;
        const tipInnerY = tipOuterY + dirX * t;
        shape.lineTo(tipInnerX, tipInnerY);
        
        const endInnerX = cx + Rin * Math.cos(-Math.PI/2 + angleRad);
        const endInnerY = cy + Rin * Math.sin(-Math.PI/2 + angleRad);
        shape.lineTo(endInnerX, endInnerY);
        
        shape.absarc(cx, cy, Rin, -Math.PI/2 + angleRad, -Math.PI/2, true);
        shape.lineTo(0, t/2);
        shape.lineTo(0, -t/2);
    } else { // Bend DOWN
        const cx = 0;
        const cy = -t/2 - Rin;
        shape.moveTo(0, t/2);
        shape.absarc(cx, cy, Rout, Math.PI/2, Math.PI/2 - angleRad, true);
        
        const endOuterX = cx + Rout * Math.cos(Math.PI/2 - angleRad);
        const endOuterY = cy + Rout * Math.sin(Math.PI/2 - angleRad);
        
        const dirX = Math.cos(-angleRad);
        const dirY = Math.sin(-angleRad);
        
        const tipOuterX = endOuterX + dirX * straightLength;
        const tipOuterY = endOuterY + dirY * straightLength;
        shape.lineTo(tipOuterX, tipOuterY);
        
        const tipInnerX = tipOuterX + dirY * t;
        const tipInnerY = tipOuterY - dirX * t;
        shape.lineTo(tipInnerX, tipInnerY);
        
        const endInnerX = cx + Rin * Math.cos(Math.PI/2 - angleRad);
        const endInnerY = cy + Rin * Math.sin(Math.PI/2 - angleRad);
        shape.lineTo(endInnerX, endInnerY);
        
        shape.absarc(cx, cy, Rin, Math.PI/2 - angleRad, Math.PI/2, false);
        shape.lineTo(0, -t/2);
        shape.lineTo(0, t/2);
    }

    const edgeWidth = edge.v1.distanceTo(edge.v2);
    const extrudeSettings = { steps: 1, depth: edgeWidth, bevelEnabled: false };
    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geometry.translate(0, 0, -edgeWidth / 2);

    const color = options.color || 0x10B981;
    const opacity = options.opacity !== undefined ? options.opacity : 0.6;

    const material = new THREE.MeshStandardMaterial({
        color: color,
        transparent: true,
        opacity: opacity,
        side: THREE.DoubleSide
    });
    
    let phantom = new THREE.Mesh(geometry, material);
    phantom.userData.edgeWidth = edgeWidth;
    
    const Z_axis = edge.edgeDir ? edge.edgeDir.clone().normalize() : new THREE.Vector3().subVectors(edge.v2, edge.v1).normalize();
    const X_axis = edge.faceNormal.clone().normalize();
    
    let Y_axis;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(object.matrixWorld);
    let broadNormalWorld = new THREE.Vector3(0, 1, 0).applyMatrix3(normalMatrix).normalize();
    if (object.userData && object.userData.specData && object.userData.specData.broadNormal) {
        broadNormalWorld = object.userData.specData.broadNormal.clone().applyMatrix3(normalMatrix).normalize();
    }

    if (edge.thicknessDir) {
        Y_axis = edge.thicknessDir.clone().normalize();
        if (Y_axis.dot(broadNormalWorld) < 0) {
            Y_axis.negate();
        }
    } else {
        Y_axis = broadNormalWorld.clone();
    }
    
    Y_axis.sub(X_axis.clone().multiplyScalar(Y_axis.dot(X_axis))).normalize();
    Z_axis.crossVectors(X_axis, Y_axis).normalize();

    const mat4 = new THREE.Matrix4();
    mat4.makeBasis(X_axis, Y_axis, Z_axis);
    
    phantom.matrixAutoUpdate = false;
    phantom.matrix.copy(mat4);
    
    const faceCenter = new THREE.Vector3().addVectors(edge.v1, edge.v2).multiplyScalar(0.5);
    phantom.matrix.setPosition(faceCenter);
    
    Object.assign(phantom.userData, { sourceObject: object, edge: edge, edgeWidth: edgeWidth });
    return phantom;
};

/**
 * Создание развернутой плоской геометрии гиба, строго сохраняющей структуру вершин 1:1 с 3D гибом.
 */
function createUnfoldedBendGeometry(geometry, params) {
    const { t, Rin, angleRad, invert } = params;
    const geomUnfolded = geometry.clone();
    const pos = geomUnfolded.attributes.position;
    const arr = pos.array;
    const Rmid = Rin + t / 2;
    const L_arc = angleRad * Rmid;

    if (!invert) { // Bend UP
        const cx = 0;
        const cy = t / 2 + Rin;
        const dirX = Math.cos(angleRad);
        const dirY = Math.sin(angleRad);
        const Rout = Rin + t;
        const endOuterX = cx + Rout * Math.cos(-Math.PI / 2 + angleRad);
        const endOuterY = cy + Rout * Math.sin(-Math.PI / 2 + angleRad);

        for (let i = 0; i < pos.count; i++) {
            const idx = i * 3;
            const x = arr[idx];
            const y = arr[idx + 1];

            const dx = x - cx;
            const dy = y - cy;
            const r = Math.hypot(dx, dy);

            let theta = Math.atan2(dy, dx) + Math.PI / 2;
            if (theta < -Math.PI) theta += Math.PI * 2;

            let xFlat, yFlat;
            if (x <= 0.0001 || theta <= 0.0001) {
                xFlat = x;
                yFlat = y;
            } else if (theta <= angleRad + 0.001) {
                xFlat = theta * Rmid;
                yFlat = r - Rmid;
            } else {
                const dFlange = (x - endOuterX) * dirX + (y - endOuterY) * dirY;
                const offset = (x - endOuterX) * (-dirY) + (y - endOuterY) * dirX;
                xFlat = L_arc + Math.max(0, dFlange);
                yFlat = (Rout - Rmid) - offset;
            }

            arr[idx] = xFlat;
            arr[idx + 1] = yFlat;
        }
    } else { // Bend DOWN
        const cx = 0;
        const cy = -t / 2 - Rin;
        const dirX = Math.cos(-angleRad);
        const dirY = Math.sin(-angleRad);
        const Rout = Rin + t;
        const endOuterX = cx + Rout * Math.cos(Math.PI / 2 - angleRad);
        const endOuterY = cy + Rout * Math.sin(Math.PI / 2 - angleRad);

        for (let i = 0; i < pos.count; i++) {
            const idx = i * 3;
            const x = arr[idx];
            const y = arr[idx + 1];

            const dx = x - cx;
            const dy = y - cy;
            const r = Math.hypot(dx, dy);

            let theta = Math.PI / 2 - Math.atan2(dy, dx);
            if (theta < -Math.PI) theta += Math.PI * 2;

            let xFlat, yFlat;
            if (x <= 0.0001 || theta <= 0.0001) {
                xFlat = x;
                yFlat = y;
            } else if (theta <= angleRad + 0.001) {
                xFlat = theta * Rmid;
                yFlat = Rmid - r;
            } else {
                const dFlange = (x - endOuterX) * dirX + (y - endOuterY) * dirY;
                const offset = (x - endOuterX) * (-dirY) + (y - endOuterY) * (-dirX);
                xFlat = L_arc + Math.max(0, dFlange);
                yFlat = (Rmid - Rout) + offset;
            }

            arr[idx] = xFlat;
            arr[idx + 1] = yFlat;
        }
    }

    pos.needsUpdate = true;
    geomUnfolded.computeVertexNormals();
    return geomUnfolded;
}

window.updateBendPhantoms = function() {
    window.clearBendPhantoms();
    
    if (typeof bendState === 'undefined' || bendState !== 2 || typeof bendSelectedEdges === 'undefined' || bendSelectedEdges.length === 0) return;

    const lenEl = document.getElementById('qi-bend-length');
    const length = lenEl ? (parseFloat(lenEl.value) || 100) : 100;

    const angleEl = document.getElementById('qi-bend-angle');
    const angleDeg = angleEl ? (parseFloat(angleEl.value) || 90) : 90;
    const angleRad = THREE.MathUtils.degToRad(angleDeg);

    const invertEl = document.getElementById('qi-bend-invert');
    const invert = invertEl ? invertEl.checked : false;

    for (const item of bendSelectedEdges) {
        const object = item.sourceObject;
        const edge = item.edge;
        
        const plateData = object.userData.specData;
        let t = 10;
        if (edge && typeof edge.thickness === 'number' && edge.thickness > 0) {
            t = edge.thickness;
        } else if (plateData) {
            t = (plateData.t || plateData.th || plateData.wallThick || plateData.thickness || plateData.depth || 10) * (object.scale.y || 1);
        }
        
        let radiusInput = document.getElementById('qi-bend-radius')?.value;
        let R = (radiusInput !== undefined && radiusInput !== '') ? parseFloat(radiusInput) : t;
        if (isNaN(R) || R < 0) R = t;
        
        const mode = window.bendRadiusMode || 'inner';
        let Rin, Rout;
        if (mode === 'outer') {
            Rout = Math.max(t + 0.1, R);
            Rin = Math.max(0.1, R - t);
        } else if (mode === 'middle') {
            const Rmid = Math.max(t / 2 + 0.1, R);
            Rin = Math.max(0.1, Rmid - t / 2);
            Rout = Rin + t;
        } else { // 'inner' default
            Rin = Math.max(0.1, R);
            Rout = Rin + t;
        }

        const shape = new THREE.Shape();
        const sign = invert ? -1 : 1;
        const bendDeduction = Rout * Math.tan(angleRad / 2);
        const straightLength = Math.max(1.0, length - bendDeduction);
        
        if (!invert) { // Bend UP
            const cx = 0;
            const cy = t/2 + Rin;
            shape.moveTo(0, -t/2);
            shape.absarc(cx, cy, Rout, -Math.PI/2, -Math.PI/2 + angleRad, false);
            
            const endOuterX = cx + Rout * Math.cos(-Math.PI/2 + angleRad);
            const endOuterY = cy + Rout * Math.sin(-Math.PI/2 + angleRad);
            const dirX = Math.cos(angleRad);
            const dirY = Math.sin(angleRad);
            
            const tipOuterX = endOuterX + dirX * straightLength;
            const tipOuterY = endOuterY + dirY * straightLength;
            shape.lineTo(tipOuterX, tipOuterY);
            
            const tipInnerX = tipOuterX - dirY * t;
            const tipInnerY = tipOuterY + dirX * t;
            shape.lineTo(tipInnerX, tipInnerY);
            
            const endInnerX = cx + Rin * Math.cos(-Math.PI/2 + angleRad);
            const endInnerY = cy + Rin * Math.sin(-Math.PI/2 + angleRad);
            shape.lineTo(endInnerX, endInnerY);
            
            shape.absarc(cx, cy, Rin, -Math.PI/2 + angleRad, -Math.PI/2, true);
            shape.lineTo(0, t/2);
            shape.lineTo(0, -t/2);
        } else { // Bend DOWN
            const cx = 0;
            const cy = -t/2 - Rin;
            shape.moveTo(0, t/2);
            shape.absarc(cx, cy, Rout, Math.PI/2, Math.PI/2 - angleRad, true); // clockwise
            
            const endOuterX = cx + Rout * Math.cos(Math.PI/2 - angleRad);
            const endOuterY = cy + Rout * Math.sin(Math.PI/2 - angleRad);
            
            const dirX = Math.cos(-angleRad);
            const dirY = Math.sin(-angleRad);
            
            const tipOuterX = endOuterX + dirX * straightLength;
            const tipOuterY = endOuterY + dirY * straightLength;
            shape.lineTo(tipOuterX, tipOuterY);
            
            const tipInnerX = tipOuterX + dirY * t;
            const tipInnerY = tipOuterY - dirX * t;
            shape.lineTo(tipInnerX, tipInnerY);
            
            const endInnerX = cx + Rin * Math.cos(Math.PI/2 - angleRad);
            const endInnerY = cy + Rin * Math.sin(Math.PI/2 - angleRad);
            shape.lineTo(endInnerX, endInnerY);
            
            shape.absarc(cx, cy, Rin, Math.PI/2 - angleRad, Math.PI/2, false);
            shape.lineTo(0, -t/2);
            shape.lineTo(0, t/2);
        }

        const edgeWidth = edge.v1.distanceTo(edge.v2);
        const extrudeSettings = { steps: 1, depth: edgeWidth, bevelEnabled: false };
        const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        geometry.translate(0, 0, -edgeWidth / 2);

        const material = new THREE.MeshStandardMaterial({
            color: 0x7DD3FC,
            transparent: true,
            opacity: 0.75,
            roughness: 0.3,
            metalness: 0.3,
            side: THREE.DoubleSide
        });
        
        let phantom = new THREE.Mesh(geometry, material);
        phantom.userData.edgeWidth = edgeWidth;
        
        const Z_axis = edge.edgeDir ? edge.edgeDir.clone().normalize() : new THREE.Vector3().subVectors(edge.v2, edge.v1).normalize();
        const X_axis = edge.faceNormal.clone().normalize();
        
        let Y_axis;
        if (edge.thicknessDir) {
            Y_axis = edge.thicknessDir.clone().normalize();
        } else {
            const plateWorldY = new THREE.Vector3(0, 1, 0).applyQuaternion(object.getWorldQuaternion(new THREE.Quaternion())).normalize();
            Y_axis = new THREE.Vector3().crossVectors(Z_axis, X_axis).normalize();
            if (Y_axis.dot(plateWorldY) < 0) {
                Z_axis.negate();
                Y_axis.negate();
            }
        }
        
        Y_axis.sub(X_axis.clone().multiplyScalar(Y_axis.dot(X_axis))).normalize();
        Z_axis.crossVectors(X_axis, Y_axis).normalize();
        
        
        // ==== CORNER CLOSING LOGIC ====
        const closeCorners = document.getElementById('qi-bend-close-corners') ? document.getElementById('qi-bend-close-corners').checked : false;
        
        if (closeCorners) {
            let end_negZ = Z_axis.dot(new THREE.Vector3().subVectors(edge.v2, edge.v1)) > 0 ? edge.v1 : edge.v2;
            let end_posZ = Z_axis.dot(new THREE.Vector3().subVectors(edge.v2, edge.v1)) > 0 ? edge.v2 : edge.v1;
            
            let shift_factor_negZ = 0;
            let shift_factor_posZ = 0;

            // Check negZ end
            let adjEdge_negZ = null;
            for (const other of bendSelectedEdges) {
                if (other === item) continue;
                if (other.sourceObject !== object) continue;
                if (other.edge.v1.distanceTo(end_negZ) < 5.0 || other.edge.v2.distanceTo(end_negZ) < 5.0) {
                    adjEdge_negZ = other.edge;
                    break;
                }
            }
            if (adjEdge_negZ) {
                let v_other = adjEdge_negZ.v1.distanceTo(end_negZ) < 5.0 ? adjEdge_negZ.v2 : adjEdge_negZ.v1;
                let dir2 = new THREE.Vector3().subVectors(v_other, end_negZ).normalize();
                let bisect = new THREE.Vector3().addVectors(Z_axis, dir2);
                if (bisect.lengthSq() > 0.001) {
                    let N_miter = new THREE.Vector3().crossVectors(bisect, Y_axis).normalize();
                    let N_local_x = N_miter.dot(X_axis);
                    let N_local_z = N_miter.dot(Z_axis);
                    if (Math.abs(N_local_z) > 0.001) {
                        shift_factor_negZ = -N_local_x / N_local_z;
                    }
                }
            }

            // Check posZ end
            let adjEdge_posZ = null;
            for (const other of bendSelectedEdges) {
                if (other === item) continue;
                if (other.sourceObject !== object) continue;
                if (other.edge.v1.distanceTo(end_posZ) < 5.0 || other.edge.v2.distanceTo(end_posZ) < 5.0) {
                    adjEdge_posZ = other.edge;
                    break;
                }
            }
            if (adjEdge_posZ) {
                let v_other = adjEdge_posZ.v1.distanceTo(end_posZ) < 5.0 ? adjEdge_posZ.v2 : adjEdge_posZ.v1;
                let dir2 = new THREE.Vector3().subVectors(v_other, end_posZ).normalize();
                let dir_away_posZ = Z_axis.clone().negate();
                let bisect = new THREE.Vector3().addVectors(dir_away_posZ, dir2);
                if (bisect.lengthSq() > 0.001) {
                    let N_miter = new THREE.Vector3().crossVectors(bisect, Y_axis).normalize();
                    let N_local_x = N_miter.dot(X_axis);
                    let N_local_z = N_miter.dot(Z_axis);
                    if (Math.abs(N_local_z) > 0.001) {
                        shift_factor_posZ = -N_local_x / N_local_z;
                    }
                }
            }

            if (shift_factor_negZ !== 0 || shift_factor_posZ !== 0) {
                const positionAttribute = geometry.attributes.position;
                for (let j = 0; j < positionAttribute.count; j++) {
                    const vx = positionAttribute.getX(j);
                    const vz = positionAttribute.getZ(j);
                    
                    if (vz < 0) {
                        positionAttribute.setZ(j, vz + vx * shift_factor_negZ);
                    } else {
                        positionAttribute.setZ(j, vz + vx * shift_factor_posZ);
                    }
                }
                geometry.computeVertexNormals();
            }
        }
        // ==============================
        // Generate flat 2D unrolled geometry matching 3D geometry topology 1:1 with miters preserved
        const geomUnfolded = createUnfoldedBendGeometry(geometry, { t, Rin, angleRad, length, invert });
        phantom.userData.unfoldedGeometry = geomUnfolded;
        phantom.userData.edgeWidth = edgeWidth;

        const mat4 = new THREE.Matrix4();
        mat4.makeBasis(X_axis, Y_axis, Z_axis);
        
        phantom.matrixAutoUpdate = false;
        phantom.matrix.copy(mat4);
        
        const faceCenter = new THREE.Vector3().addVectors(edge.v1, edge.v2).multiplyScalar(0.5);
        phantom.matrix.setPosition(faceCenter);
        
        creatorScene.add(phantom);
        
        Object.assign(phantom.userData, {
            sourceObject: object,
            edge: edge,
            edgeWidth: edgeWidth,
            t: t,
            Rin: Rin,
            Rout: Rin + t,
            angleRad: angleRad,
            angleDeg: angleDeg,
            invert: !!invert,
            length: length,
            L_arc: angleRad * (Rin + t / 2)
        });
        bendPhantoms.push(phantom);

        // ==== NATIVE 3D CAD DIMENSION OVERLAYS ====
        if (window.showBend3DDimensions !== false) {
            createCAD3DBendDimensions(phantom, { t, R, Rin, Rout, length, angleDeg, invert, edgeWidth, mode });
        }
    }
}

function createCADSpriteBadge(mainText, color = '#2563EB', bgColor = '#FFFFFF', strokeColor = '#2563EB') {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 100;
    const ctx = canvas.getContext('2d');
    
    ctx.clearRect(0, 0, 256, 100);
    
    const x = 6, y = 6, w = 244, h = 88, r = 14;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    
    ctx.fillStyle = bgColor;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = strokeColor;
    ctx.stroke();
    
    ctx.fillStyle = color;
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(mainText, 128, 50);
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(24, 9.375, 1);
    sprite.renderOrder = 9999;
    return sprite;
}

function createCAD3DBendDimensions(phantom, params) {
    const { t, R, Rin, Rout, length, angleDeg, invert, edgeWidth, mode } = params;
    const angleRad = THREE.MathUtils.degToRad(angleDeg);
    const dimGroup = new THREE.Group();
    dimGroup.name = "CAD_BEND_DIMS";

    const lineMat = new THREE.LineBasicMaterial({ color: 0x2563EB, linewidth: 2, depthTest: false });
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0x2563EB, depthTest: false });

    // Function to create crisp, high-contrast anchor point spheres on the 3D model geometry
    function createAnchorNode(pos, color = 0x2563EB, radius = 1.3) {
        const group = new THREE.Group();
        group.name = "CAD_ANCHOR_NODE";

        // Inner filled point sphere
        const sphereGeo = new THREE.SphereGeometry(radius, 16, 16);
        const sphereMat = new THREE.MeshBasicMaterial({ color: color, depthTest: false });
        const sphere = new THREE.Mesh(sphereGeo, sphereMat);
        sphere.position.copy(pos);
        sphere.renderOrder = 10000;
        group.add(sphere);

        // Outer white contrast halo
        const haloGeo = new THREE.SphereGeometry(radius * 1.5, 16, 16);
        const haloMat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.9, depthTest: false, side: THREE.BackSide });
        const halo = new THREE.Mesh(haloGeo, haloMat);
        halo.position.copy(pos);
        halo.renderOrder = 9999;
        group.add(halo);

        return group;
    }

    function createArrow(pos, dir, size = 3.5) {
        const coneGeo = new THREE.ConeGeometry(size * 0.35, size, 12);
        const cone = new THREE.Mesh(coneGeo, arrowMat);
        cone.renderOrder = 9999;
        cone.position.copy(pos);
        const target = pos.clone().add(dir);
        cone.lookAt(target);
        cone.rotateX(Math.PI / 2);
        return cone;
    }

    let cx = 0, cy = 0;
    let endOuterX = 0, endOuterY = 0;
    let dirX = 0, dirY = 0;
    let nx = 0, ny = 0;
    let startAngle = 0, endAngle = 0;

    if (!invert) {
        cx = 0;
        cy = t/2 + Rin;
        startAngle = -Math.PI / 2;
        endAngle = -Math.PI / 2 + angleRad;
        endOuterX = cx + Rout * Math.cos(endAngle);
        endOuterY = cy + Rout * Math.sin(endAngle);
        dirX = Math.cos(angleRad);
        dirY = Math.sin(angleRad);
        nx = -dirY;
        ny = dirX;
    } else {
        cx = 0;
        cy = -t/2 - Rin;
        startAngle = Math.PI / 2;
        endAngle = Math.PI / 2 - angleRad;
        endOuterX = cx + Rout * Math.cos(endAngle);
        endOuterY = cy + Rout * Math.sin(endAngle);
        dirX = Math.cos(-angleRad);
        dirY = Math.sin(-angleRad);
        nx = dirY;
        ny = -dirX;
    }

    const dimBendDeduction = Rout * Math.tan(angleRad / 2);
    const dimStraightLength = Math.max(1.0, length - dimBendDeduction);
    const tipOuterX = endOuterX + dirX * dimStraightLength;
    const tipOuterY = endOuterY + dirY * dimStraightLength;

    // 1. LENGTH DIMENSION (L)
    // Physical corner vertices on the 3D phantom geometry being measured
    const zCorner = edgeWidth / 2;
    const pModel1 = new THREE.Vector3(endOuterX, endOuterY, zCorner); // Start corner of flange
    const pModel2 = new THREE.Vector3(tipOuterX, tipOuterY, zCorner); // Outer tip corner of flange

    // Add anchor point nodes directly on the physical model's measured points
    dimGroup.add(createAnchorNode(pModel1, 0x2563EB, 1.4));
    dimGroup.add(createAnchorNode(pModel2, 0x2563EB, 1.4));

    const offN = 16;
    const zLen = zCorner + 10;
    const p1 = new THREE.Vector3(endOuterX + nx * offN, endOuterY + ny * offN, zLen);
    const p2 = new THREE.Vector3(tipOuterX + nx * offN, tipOuterY + ny * offN, zLen);

    // Continuous extension line 1: from physical point pModel1 directly to p1 and slightly beyond
    const p1Ext = p1.clone().add(new THREE.Vector3(nx * 4, ny * 4, 0));
    const extGeo1 = new THREE.BufferGeometry().setFromPoints([pModel1, p1, p1Ext]);
    const extLine1 = new THREE.Line(extGeo1, lineMat);
    extLine1.renderOrder = 9999;
    dimGroup.add(extLine1);

    // Continuous extension line 2: from physical point pModel2 directly to p2 and slightly beyond
    const p2Ext = p2.clone().add(new THREE.Vector3(nx * 4, ny * 4, 0));
    const extGeo2 = new THREE.BufferGeometry().setFromPoints([pModel2, p2, p2Ext]);
    const extLine2 = new THREE.Line(extGeo2, lineMat);
    extLine2.renderOrder = 9999;
    dimGroup.add(extLine2);

    // Dimension line between p1 and p2
    const dimGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const dimLine = new THREE.Line(dimGeo, lineMat);
    dimLine.renderOrder = 9999;
    dimGroup.add(dimLine);

    // Dimension line end nodes
    dimGroup.add(createAnchorNode(p1, 0x2563EB, 1.0));
    dimGroup.add(createAnchorNode(p2, 0x2563EB, 1.0));

    const dirP1toP2 = p2.clone().sub(p1).normalize();
    const dirP2toP1 = dirP1toP2.clone().negate();
    dimGroup.add(createArrow(p1, dirP1toP2));
    dimGroup.add(createArrow(p2, dirP2toP1));

    const spriteL = createCADSpriteBadge(`L = ${length} мм`);
    const midP = p1.clone().add(p2).multiplyScalar(0.5);
    spriteL.position.copy(midP).add(new THREE.Vector3(nx * 8, ny * 8, 0));
    dimGroup.add(spriteL);

    // 2. ANGLE DIMENSION (α)
    const zAngleCorner = -edgeWidth / 2;
    const zAngle = zAngleCorner - 10;
    
    // Measured points on physical model for angle
    const pBaseModel = new THREE.Vector3(0, invert ? -t/2 : t/2, zAngleCorner);
    const pCenterModel = new THREE.Vector3(cx, cy, zAngleCorner);
    const pFlangeModel = new THREE.Vector3(endOuterX, endOuterY, zAngleCorner);

    dimGroup.add(createAnchorNode(pBaseModel, 0x1E40AF, 1.4));
    dimGroup.add(createAnchorNode(pCenterModel, 0x1E40AF, 1.4));
    dimGroup.add(createAnchorNode(pFlangeModel, 0x1E40AF, 1.4));

    // Extension lines from physical model points to angle arc plane
    const pBaseArcPlane = pBaseModel.clone().setZ(zAngle);
    const pCenterArcPlane = pCenterModel.clone().setZ(zAngle);
    const pFlangeArcPlane = pFlangeModel.clone().setZ(zAngle);

    const baseRayGeo = new THREE.BufferGeometry().setFromPoints([pBaseModel, pBaseArcPlane]);
    dimGroup.add(new THREE.Line(baseRayGeo, lineMat));

    const centerRayGeo = new THREE.BufferGeometry().setFromPoints([pCenterModel, pCenterArcPlane]);
    dimGroup.add(new THREE.Line(centerRayGeo, lineMat));

    const flangeRayGeo = new THREE.BufferGeometry().setFromPoints([pFlangeModel, pFlangeArcPlane]);
    dimGroup.add(new THREE.Line(flangeRayGeo, lineMat));

    const rArc = Rout + 14;
    const arcPts = [];
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
        const a = startAngle + (endAngle - startAngle) * (i / steps);
        arcPts.push(new THREE.Vector3(cx + rArc * Math.cos(a), cy + rArc * Math.sin(a), zAngle));
    }
    const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPts);
    const arcLine = new THREE.Line(arcGeo, lineMat);
    arcLine.renderOrder = 9999;
    dimGroup.add(arcLine);

    // Radial guide lines from center to arc ends
    if (arcPts.length > 0) {
        const centerToArcStart = new THREE.BufferGeometry().setFromPoints([pCenterArcPlane, arcPts[0]]);
        const centerToArcEnd = new THREE.BufferGeometry().setFromPoints([pCenterArcPlane, arcPts[steps]]);
        const lineStart = new THREE.Line(centerToArcStart, lineMat);
        const lineEnd = new THREE.Line(centerToArcEnd, lineMat);
        lineStart.renderOrder = 9999;
        lineEnd.renderOrder = 9999;
        dimGroup.add(lineStart);
        dimGroup.add(lineEnd);

        dimGroup.add(createAnchorNode(arcPts[0], 0x1E40AF, 1.0));
        dimGroup.add(createAnchorNode(arcPts[steps], 0x1E40AF, 1.0));
    }

    const lastPt = arcPts[steps];
    const prevPt = arcPts[steps - 1];
    const arcDir = lastPt.clone().sub(prevPt).normalize();
    dimGroup.add(createArrow(lastPt, arcDir));

    const midAngle = (startAngle + endAngle) / 2;
    const midArcPos = new THREE.Vector3(cx + (rArc + 12) * Math.cos(midAngle), cy + (rArc + 12) * Math.sin(midAngle), zAngle);
    const spriteA = createCADSpriteBadge(`α = ${angleDeg}°`, '#1E40AF');
    spriteA.position.copy(midArcPos);
    dimGroup.add(spriteA);

    // 3. RADIUS DIMENSION (R)
    const zR = 0;
    let targetR = Rin;
    let rLabelText = `R (внутр) = ${R} мм`;
    
    if (mode === 'outer') {
        targetR = Rout;
        rLabelText = `R (внешн) = ${R} мм`;
    } else if (mode === 'middle') {
        targetR = Rin + t / 2;
        rLabelText = `R (средн) = ${R} мм`;
    }

    const pRCenter = new THREE.Vector3(cx, cy, zR);
    const surfacePos = new THREE.Vector3(cx + targetR * Math.cos(midAngle), cy + targetR * Math.sin(midAngle), zR);
    const rOutPos = new THREE.Vector3(cx + (Rout + 22) * Math.cos(midAngle), cy + (Rout + 22) * Math.sin(midAngle), zR);
    
    // Anchor nodes on radius center and actual measured surface
    dimGroup.add(createAnchorNode(pRCenter, 0x0284C7, 1.4));
    dimGroup.add(createAnchorNode(surfacePos, 0x0284C7, 1.4));
    dimGroup.add(createAnchorNode(rOutPos, 0x0284C7, 1.0));

    // Continuous radius line from center through surface point to badge location
    const rLineGeo = new THREE.BufferGeometry().setFromPoints([pRCenter, surfacePos, rOutPos]);
    const rLine = new THREE.Line(rLineGeo, lineMat);
    rLine.renderOrder = 9999;
    dimGroup.add(rLine);

    const rArrowDir = new THREE.Vector3(cx, cy, zR).sub(surfacePos).normalize();
    dimGroup.add(createArrow(surfacePos, rArrowDir));

    const spriteR = createCADSpriteBadge(rLabelText, '#0284C7');
    spriteR.position.copy(rOutPos).add(new THREE.Vector3(0, 0, 5));
    dimGroup.add(spriteR);

    phantom.add(dimGroup);
}

window.allBends = window.allBends || [];

window.createBendMarker = function(bendRecord) {
    const wrapper = document.createElement('div');
    wrapper.className = 'zone-marker-wrapper';
    wrapper.style.pointerEvents = 'auto';

    const label = document.createElement('div');
    label.className = 'zone-label';
    label.innerText = '(гнуть)';
    label.style.background = '#3355CC';
    label.style.color = '#FFFFFF';
    label.style.borderColor = '#264099';
    label.style.padding = '4px 10px';
    label.style.borderRadius = '12px';
    label.style.fontSize = '12px';
    label.style.fontWeight = '600';
    label.style.cursor = 'pointer';
    label.style.boxShadow = '0 2px 8px rgba(51, 85, 204, 0.4)';
    label.style.userSelect = 'none';
    label.style.transition = 'background-color 0.15s ease, border-color 0.15s ease';
    
    label.onmouseenter = () => {
        label.style.background = '#E03030';
        label.style.borderColor = '#B02020';
    };
    label.onmouseleave = () => {
        label.style.background = '#3355CC';
        label.style.borderColor = '#264099';
    };
    label.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        window.removeBendRecord(bendRecord);
    };
    
    wrapper.appendChild(label);
    const container = document.getElementById('creator-labels-container');
    if (container) container.appendChild(wrapper);
    return wrapper;
};

window.removeBendRecord = function(bendRecord) {
    if (!bendRecord || !bendRecord.object) return;
    
    const object = bendRecord.object;
    
    if (bendRecord.htmlElement) {
        bendRecord.htmlElement.remove();
        bendRecord.htmlElement = null;
    }
    
    if (window.allBends) {
        window.allBends = window.allBends.filter(b => b !== bendRecord);
    }
    
    if (object.userData && object.userData.bendsList) {
        object.userData.bendsList = object.userData.bendsList.filter(b => b !== bendRecord);
    }
    
    window.rebuildObjectFromBends(object);
    if (typeof window.refreshSpecTable === 'function') {
        window.refreshSpecTable();
    }
    
    if (typeof showToast === 'function') showToast("Гиб успешно удален!");
};

window.fixUnfoldedNormals = function(geometry, targetNormal, targetCentroid, mesh) {
    if (!geometry || !geometry.attributes || !geometry.attributes.position) return;
    
    // Safely recompute vertex normals without converting to non-indexed (which causes topology destruction & memory corruption)
    geometry.computeVertexNormals();
    if (geometry.attributes.normal) {
        geometry.attributes.normal.needsUpdate = true;
    }
};

window.sanitizeAndFlattenUnfoldedGeometry = function(geometry, specData, baseFaceData) {
    if (!geometry || !geometry.attributes || !geometry.attributes.position) return;
    if (geometry.boundingBox) geometry.computeBoundingBox();
};

window.findMatchingGeometryEdge = function(baseGeo, localBroadNorm, curLocalV1, curLocalV2, curLocalFaceNorm, curLocalEdgeDir) {
    if (!baseGeo || !baseGeo.attributes || !baseGeo.attributes.position) return null;
    
    const posAttr = baseGeo.attributes.position;
    const indexAttr = baseGeo.index;
    const isIndexed = !!indexAttr;
    const triCount = isIndexed ? indexAttr.count / 3 : posAttr.count / 3;
    
    const getVert = (idx) => new THREE.Vector3(posAttr.getX(idx), posAttr.getY(idx), posAttr.getZ(idx));
    const curMid = new THREE.Vector3().addVectors(curLocalV1, curLocalV2).multiplyScalar(0.5);

    // 1. Собираем все боковые/торцевые треугольники (нормаль перпендикулярна пластевой нормали)
    const sideTriangles = [];
    for (let i = 0; i < triCount; i++) {
        let i0 = isIndexed ? indexAttr.getX(i * 3) : i * 3;
        let i1 = isIndexed ? indexAttr.getX(i * 3 + 1) : i * 3 + 1;
        let i2 = isIndexed ? indexAttr.getX(i * 3 + 2) : i * 3 + 2;

        const v0 = getVert(i0), v1 = getVert(i1), v2 = getVert(i2);
        const norm = new THREE.Vector3().crossVectors(
            new THREE.Vector3().subVectors(v1, v0),
            new THREE.Vector3().subVectors(v2, v0)
        );
        const area = norm.length();
        if (area < 1e-5) continue;
        norm.divideScalar(area);

        if (Math.abs(norm.dot(localBroadNorm)) < 0.35) {
            const planeD = v0.dot(norm);
            sideTriangles.push({
                v0, v1, v2, norm, planeD
            });
        }
    }

    if (sideTriangles.length === 0) return null;

    // 2. Группируем компланарные треугольники в единые боковые/торцевые грани
    const faces = [];
    sideTriangles.forEach(tri => {
        let matchedFace = null;
        for (let f of faces) {
            if (f.norm.dot(tri.norm) > 0.92 && Math.abs(f.planeD - tri.planeD) < 0.8) {
                matchedFace = f;
                break;
            }
        }
        if (matchedFace) {
            matchedFace.tris.push(tri);
        } else {
            faces.push({
                norm: tri.norm.clone(),
                planeD: tri.planeD,
                tris: [tri]
            });
        }
    });

    // 3. Для каждой объединенной грани находим её точные 3D размеры, центроиды и концы (v1, v2)
    let bestEdge = null;
    let minScore = Infinity;

    faces.forEach(face => {
        const norm = face.norm.clone().normalize();
        let edgeDir = new THREE.Vector3().crossVectors(norm, localBroadNorm);
        if (edgeDir.lengthSq() < 1e-5) return;
        edgeDir.normalize();

        const verts = [];
        face.tris.forEach(t => {
            verts.push(t.v0, t.v1, t.v2);
        });

        let minD = Infinity, maxD = -Infinity;
        let minBroad = Infinity, maxBroad = -Infinity;
        let minNorm = Infinity, maxNorm = -Infinity;

        verts.forEach(v => {
            const pE = v.dot(edgeDir);
            if (pE < minD) minD = pE;
            if (pE > maxD) maxD = pE;

            const pB = v.dot(localBroadNorm);
            if (pB < minBroad) minBroad = pB;
            if (pB > maxBroad) maxBroad = pB;

            const pN = v.dot(norm);
            if (pN < minNorm) minNorm = pN;
            if (pN > maxNorm) maxNorm = pN;
        });

        const edgeLen = maxD - minD;
        if (edgeLen < 0.5) return;

        if (curLocalEdgeDir && edgeDir.dot(curLocalEdgeDir) < 0) {
            edgeDir.negate();
            const temp = minD;
            minD = -maxD;
            maxD = -temp;
        }

        const midD = (minD + maxD) / 2;
        const midBroad = (minBroad + maxBroad) / 2;
        const midNorm = (minNorm + maxNorm) / 2;

        const candMid = new THREE.Vector3()
            .addScaledVector(edgeDir, midD)
            .addScaledVector(localBroadNorm, midBroad)
            .addScaledVector(norm, midNorm);

        const candV1 = candMid.clone().addScaledVector(edgeDir, -edgeLen / 2);
        const candV2 = candMid.clone().addScaledVector(edgeDir, edgeLen / 2);

        const dist = candMid.distanceTo(curMid);
        let normAlign = 0;
        if (curLocalFaceNorm) {
            normAlign = (1 - Math.max(0, norm.dot(curLocalFaceNorm)));
        }
        let edgeAlign = 0;
        if (curLocalEdgeDir) {
            edgeAlign = (1 - Math.abs(edgeDir.dot(curLocalEdgeDir)));
        }

        const score = dist + normAlign * 50 + edgeAlign * 50;
        if (score < minScore) {
            minScore = score;
            bestEdge = {
                localV1: candV1,
                localV2: candV2,
                localFaceNormal: norm,
                localEdgeDir: edgeDir,
                localThicknessDir: new THREE.Vector3().crossVectors(norm, edgeDir).normalize(),
                length: edgeLen
            };
        }
    });

    if (bestEdge && minScore < 1000) {
        return bestEdge;
    }
    return null;
};

window.rebuildObjectFromBends = function(object) {
    if (!object || !object.userData || !object.userData.baseGeometry) return;
    if (!window.THREE || !window.THREE.BufferGeometryUtils) return;

    const bends = object.userData.bendsList || [];
    const sd = object.userData.specData || {};
    let currentT = (sd.t || sd.th || sd.wallThick || sd.thickness || sd.depth || 10) * (object.scale.y || 1);
    if (isNaN(currentT) || currentT <= 0) currentT = 10;

    sd.t = currentT;
    sd.th = currentT;
    sd.wallThick = currentT;
    sd.thickness = currentT;
    sd.depth = currentT;

    const invMat = new THREE.Matrix4().copy(object.matrixWorld).invert();

    // Пересчитываем геометрию всех гибов под новую текущую толщину детали currentT
    for (let k = 0; k < bends.length; k++) {
        const bend = bends[k];
        if (bend.edge) {
            let lThick = bend.edge.localThicknessDir;
            if (!lThick && bend.edge.thicknessDir) {
                const invQ = object.quaternion.clone().invert();
                lThick = bend.edge.thicknessDir.clone().applyQuaternion(invQ).normalize();
            }
            if (!lThick) {
                const invQ = object.quaternion.clone().invert();
                const wThick = (bend.edge.faceNormal && bend.edge.edgeDir) ? bend.edge.faceNormal.clone().cross(bend.edge.edgeDir).normalize() : new THREE.Vector3(0, 1, 0);
                lThick = wThick.applyQuaternion(invQ).normalize();
            }

            let localBroadNorm = new THREE.Vector3(0, 1, 0);
            if (object.userData && object.userData.specData && object.userData.specData.broadNormal) {
                localBroadNorm = object.userData.specData.broadNormal.clone().normalize();
            }
            if (lThick.dot(localBroadNorm) < 0) {
                lThick.negate();
            }
            bend.edge.localThicknessDir = lThick;

            if (!bend.edge.localV1_base) {
                const invQ = object.quaternion.clone().invert();
                if (bend.edge.faceNormal) bend.edge.localFaceNormal = bend.edge.faceNormal.clone().applyQuaternion(invQ).normalize();
                if (bend.edge.edgeDir) bend.edge.localEdgeDir = bend.edge.edgeDir.clone().applyQuaternion(invQ).normalize();

                bend.edge.localV1_base = object.worldToLocal(bend.edge.v1.clone());
                bend.edge.localV2_base = object.worldToLocal(bend.edge.v2.clone());
            }

            // Динамический поиск и привязка к ребру новой базовой геометрии
            if (object.userData && object.userData.baseGeometry) {
                const matched = window.findMatchingGeometryEdge(
                    object.userData.baseGeometry,
                    localBroadNorm,
                    bend.edge.localV1_base,
                    bend.edge.localV2_base,
                    bend.edge.localFaceNormal,
                    bend.edge.localEdgeDir
                );
                if (matched) {
                    bend.edge.localV1_base = matched.localV1;
                    bend.edge.localV2_base = matched.localV2;
                    bend.edge.localFaceNormal = matched.localFaceNormal;
                    bend.edge.localEdgeDir = matched.localEdgeDir;
                    bend.edge.localThicknessDir = matched.localThicknessDir;
                    if (matched.length > 0) {
                        bend.edgeWidth = matched.length;
                    }
                }
            }

            object.updateMatrixWorld(true);
            const curLocalV1 = bend.edge.localV1_base.clone();
            const curLocalV2 = bend.edge.localV2_base.clone();

            bend.edge.v1 = object.localToWorld(curLocalV1);
            bend.edge.v2 = object.localToWorld(curLocalV2);
            bend.edge.faceNormal = bend.edge.localFaceNormal.clone().applyQuaternion(object.quaternion).normalize();
            bend.edge.thicknessDir = bend.edge.localThicknessDir.clone().applyQuaternion(object.quaternion).normalize();
            bend.edge.edgeDir = bend.edge.localEdgeDir.clone().applyQuaternion(object.quaternion).normalize();
            bend.edge.thickness = currentT;

            const bendLength = bend.length || bend.edgeWidth || 100;
            const angleDeg = bend.angleDeg || 90;
            const invert = !!bend.invert;
            const radiusMode = bend.radiusMode || 'inner';
            let R = bend.Rin !== undefined ? bend.Rin : currentT;

            const phantom = window.buildSingleBendPhantom(object, bend.edge, {
                length: bendLength,
                angleDeg: angleDeg,
                invert: invert,
                t: currentT,
                Rin: R,
                radiusMode: radiusMode
            });

            if (phantom) {
                phantom.updateMatrixWorld(true);
                const localPhantomGeo = phantom.geometry.clone();
                localPhantomGeo.applyMatrix4(phantom.matrixWorld);
                localPhantomGeo.applyMatrix4(invMat);

                bend.t = currentT;
                bend.localPhantomGeo = localPhantomGeo;
                if (phantom.userData && phantom.userData.unfoldedGeometry) {
                    bend.unfoldedGeometryRaw = phantom.userData.unfoldedGeometry.clone();
                }

                let Rin;
                if (radiusMode === 'outer') Rin = Math.max(0.1, R - currentT);
                else if (radiusMode === 'middle') Rin = Math.max(0.1, R - currentT / 2);
                else Rin = Math.max(0.1, R);

                const edgeWidth = phantom.userData.edgeWidth || bend.edgeWidth || 100;
                const L_arc = (angleDeg * Math.PI / 180) * (Rin + currentT / 2);
                const L_blank = L_arc + bendLength;
                bend.addedVolume = (L_blank * currentT * edgeWidth) / 1000000000;
                bend.L_arc = L_arc;
                bend.Rin = Rin;
                bend.Rout = Rin + currentT;
            }
        }
    }
    
    const prepareGeos = (geos) => {
        const result = [];
        for (let i = 0; i < geos.length; i++) {
            let geo = geos[i];
            if (!geo) continue;
            if (geo.index) geo = geo.toNonIndexed();
            const newGeo = new THREE.BufferGeometry();
            newGeo.setAttribute('position', geo.attributes.position.clone());
            if (geo.attributes.normal) newGeo.setAttribute('normal', geo.attributes.normal.clone());
            else newGeo.computeVertexNormals();
            result.push(newGeo);
        }
        return result;
    };

    const geosFolded = [object.userData.baseGeometry.clone()];
    const geosUnfolded = [object.userData.baseGeometry.clone()];
    let totalAddedVolume = 0;

    const baseGeo = object.userData.baseGeometry;
    if (!baseGeo.boundingBox) baseGeo.computeBoundingBox();
    const szBase = new THREE.Vector3();
    baseGeo.boundingBox.getSize(szBase);

    let defaultBaseNorm = new THREE.Vector3(0, 1, 0);
    if (szBase.x <= szBase.y && szBase.x <= szBase.z) defaultBaseNorm.set(1, 0, 0);
    else if (szBase.y <= szBase.x && szBase.y <= szBase.z) defaultBaseNorm.set(0, 1, 0);
    else defaultBaseNorm.set(0, 0, 1);

    for (let k = 0; k < bends.length; k++) {
        const bend = bends[k];
        if (bend.addedVolume) totalAddedVolume += bend.addedVolume;

        if (bend.localPhantomGeo) {
            geosFolded.push(bend.localPhantomGeo.clone());
        }

        // Вычисляем кинематически привязанную позицию развертки для гиба k
        const rawUnfoldedGeo = bend.unfoldedGeometryRaw || (bend.localUnfoldedGeo ? bend.localUnfoldedGeo.clone() : null);

        if (rawUnfoldedGeo && bend.edge && bend.edge.v1 && bend.edge.v2) {
            const prepF = prepareGeos(geosFolded.slice(0, geosFolded.length - 1));
            const prepU = prepareGeos(geosUnfolded);

            if (prepF.length > 0 && prepU.length > 0) {
                const tempFolded = window.THREE.BufferGeometryUtils.mergeBufferGeometries(prepF);
                const tempUnfolded = window.THREE.BufferGeometryUtils.mergeBufferGeometries(prepU);

                if (tempFolded && tempUnfolded && tempFolded.attributes && tempUnfolded.attributes.position && tempUnfolded.attributes.position) {
                    const posF = tempFolded.attributes.position;
                    const posU = tempUnfolded.attributes.position;
                    const pCount = posF.count;

                    let minDist1 = Infinity, idx1 = 0;
                    let minDist2 = Infinity, idx2 = 0;
                    const tmpV = new THREE.Vector3();

                    for (let i = 0; i < pCount; i++) {
                        tmpV.fromBufferAttribute(posF, i);
                        const d1 = tmpV.distanceToSquared(bend.edge.v1);
                        if (d1 < minDist1) { minDist1 = d1; idx1 = i; }
                        const d2 = tmpV.distanceToSquared(bend.edge.v2);
                        if (d2 < minDist2) { minDist2 = d2; idx2 = i; }
                    }

                    const v1_flat = new THREE.Vector3().fromBufferAttribute(posU, idx1);
                    const v2_flat = new THREE.Vector3().fromBufferAttribute(posU, idx2);
                    const faceCenter_flat = new THREE.Vector3().addVectors(v1_flat, v2_flat).multiplyScalar(0.5);

                    let Z_flat = new THREE.Vector3().subVectors(v2_flat, v1_flat);
                    if (Z_flat.lengthSq() > 0.0001) Z_flat.normalize();
                    else Z_flat.set(0, 0, 1);

                    let Y_flat = defaultBaseNorm.clone();
                    let X_flat = Y_flat.clone().cross(Z_flat);
                    if (X_flat.lengthSq() > 0.0001) X_flat.normalize();
                    else X_flat.set(1, 0, 0);

                    // Вычисляем вектор v_int, указывающий внутрь родительского полигона в районе ребра примыкания
                    let v_int = null;
                    if (tempUnfolded && tempUnfolded.attributes && tempUnfolded.attributes.position) {
                        const posArr = tempUnfolded.attributes.position;
                        const triCount = posArr.count / 3;
                        let bestDistSq = Infinity;
                        const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();

                        for (let tIdx = 0; tIdx < triCount; tIdx++) {
                            pA.fromBufferAttribute(posArr, tIdx * 3);
                            pB.fromBufferAttribute(posArr, tIdx * 3 + 1);
                            pC.fromBufferAttribute(posArr, tIdx * 3 + 2);

                            const dA1 = pA.distanceToSquared(v1_flat), dA2 = pA.distanceToSquared(v2_flat);
                            const dB1 = pB.distanceToSquared(v1_flat), dB2 = pB.distanceToSquared(v2_flat);
                            const dC1 = pC.distanceToSquared(v1_flat), dC2 = pC.distanceToSquared(v2_flat);

                            const hasV1 = (dA1 < 0.1 || dB1 < 0.1 || dC1 < 0.1);
                            const hasV2 = (dA2 < 0.1 || dB2 < 0.1 || dC2 < 0.1);

                            if (hasV1 || hasV2) {
                                const triCenter = new THREE.Vector3().add(pA).add(pB).add(pC).divideScalar(3);
                                const distSq = triCenter.distanceToSquared(faceCenter_flat);
                                if (distSq > 0.0001 && distSq < bestDistSq) {
                                    const dir = triCenter.clone().sub(faceCenter_flat);
                                    dir.sub(Z_flat.clone().multiplyScalar(dir.dot(Z_flat)));
                                    if (dir.lengthSq() > 0.0001) {
                                        bestDistSq = distSq;
                                        v_int = dir.normalize();
                                    }
                                }
                            }
                        }
                    }

                    if (!tempUnfolded.boundingBox) tempUnfolded.computeBoundingBox();
                    const uCenter = new THREE.Vector3();
                    tempUnfolded.boundingBox.getCenter(uCenter);

                    // Вектор от центра детали к ребру гиба (указывает СТРОГО НАРУЖУ)
                    const outDir = faceCenter_flat.clone().sub(uCenter);
                    outDir.sub(Y_flat.clone().multiplyScalar(outDir.dot(Y_flat)));
                    outDir.sub(Z_flat.clone().multiplyScalar(outDir.dot(Z_flat)));

                    if (outDir.lengthSq() > 0.0001) {
                        outDir.normalize();
                        if (X_flat.dot(outDir) < 0) {
                            X_flat.negate();
                        }
                    } else if (v_int && X_flat.dot(v_int) > 0) {
                        X_flat.negate();
                    }
                    Z_flat = X_flat.clone().cross(Y_flat).normalize();

                    const flatMat = new THREE.Matrix4();
                    flatMat.makeBasis(X_flat, Y_flat, Z_flat);
                    flatMat.setPosition(faceCenter_flat);

                    const newUnfoldedGeo = rawUnfoldedGeo.clone();
                    newUnfoldedGeo.applyMatrix4(flatMat);
                    bend.localUnfoldedGeo = newUnfoldedGeo;
                    bend.flatMat = flatMat;
                }
            }
        }

        if (bend.localUnfoldedGeo) {
            geosUnfolded.push(bend.localUnfoldedGeo.clone());
        } else if (bend.localPhantomGeo) {
            geosUnfolded.push(bend.localPhantomGeo.clone());
        }
    }

    const prepF = prepareGeos(geosFolded);
    const prepU = prepareGeos(geosUnfolded);

    let mergedFolded = window.THREE.BufferGeometryUtils.mergeBufferGeometries(prepF);
    let mergedUnfolded = window.THREE.BufferGeometryUtils.mergeBufferGeometries(prepU);

    if (typeof window.sanitizeAndFlattenUnfoldedGeometry === 'function') {
        window.sanitizeAndFlattenUnfoldedGeometry(mergedUnfolded, object.userData.specData, window.unfoldBaseFaceData);
    }

    object.geometry.dispose();
    object.geometry = mergedFolded;
    object.userData.unfoldedBaseGeometry = mergedUnfolded;
    object.userData.savedFoldedPositions = new Float32Array(mergedFolded.attributes.position.array);

    const hasBends = bends.length > 0;
    object.userData.hasBends = hasBends;
    if (object.userData.specData) {
        if (hasBends) {
            object.userData.specData.type = 'bent_plate';
            object.userData.specData.name = 'Лист гнутый';
        } else {
            object.userData.specData.type = object.userData.specData.depth ? 'extrude' : 'plate';
            object.userData.specData.name = 'Лист';
        }
        if (object.userData.specData.t === undefined && object.userData.specData.depth !== undefined) {
            object.userData.specData.t = object.userData.specData.depth;
            object.userData.specData.thickness = object.userData.specData.depth;
        }
    }

    if (object.geometry) object.geometry.computeBoundingBox();
    if (typeof window.extractMeshSpecInfo === 'function') {
        window.extractMeshSpecInfo(object);
    }

    for (let i = object.children.length - 1; i >= 0; i--) {
        const child = object.children[i];
        if (child.isLineSegments) {
            object.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        }
    }
    const newEdges = new THREE.EdgesGeometry(mergedFolded, 15);
    const newLine = new THREE.LineSegments(newEdges, new THREE.LineBasicMaterial({ color: 0x2A3142 }));
    object.add(newLine);

    if (object.userData.specData) {
        const density = window.MaterialDensities ? (window.MaterialDensities[object.userData.specData.material] || 7850) : 7850;
        const spec = object.userData.specData;
        const initialVol = ((spec.t || spec.depth || 10) * (spec.w || 100) * (spec.l || 100)) / 1000000000 || 0;
        const baseMass = initialVol * density;
        object.userData.specData.mass = (baseMass + totalAddedVolume * density).toFixed(2);
    }

    if (typeof updateObjectSpecText === 'function') updateObjectSpecText(object);
};

window.applyQuickBend = function() {
    if (!bendPhantoms || bendPhantoms.length === 0) {
        if (typeof showToast === 'function') showToast("Нет фантомов для применения.");
        return;
    }
    
    if (!window.THREE.BufferGeometryUtils) {
        console.error("BufferGeometryUtils not found");
        if (typeof showToast === 'function') showToast("Ошибка: BufferGeometryUtils не загружен.");
        return;
    }

    // Group phantoms by source object, since we might have selected multiple edges on one or multiple objects
    const phantomsByObject = new Map();
    for (const phantom of bendPhantoms) {
        const obj = phantom.userData.sourceObject;
        if (!phantomsByObject.has(obj)) {
            phantomsByObject.set(obj, []);
        }
        phantomsByObject.get(obj).push(phantom);
    }

    const lenEl = document.getElementById('qi-bend-length');
    const length = lenEl ? (parseFloat(lenEl.value) || 100) : 100;

    const angleEl = document.getElementById('qi-bend-angle');
    const angleDeg = angleEl ? (parseFloat(angleEl.value) || 90) : 90;

    const radEl = document.getElementById('qi-bend-radius');
    let R = radEl && radEl.value !== '' ? parseFloat(radEl.value) : NaN;

    for (const [object, phantoms] of phantomsByObject.entries()) {
        if (typeof window.isProfileObject === 'function' && window.isProfileObject(object)) {
            if (typeof showToast === 'function') showToast("Гибка недоступна для объектов типа Профиль!");
            return;
        }
        if (!object.userData.baseGeometry) {
            object.userData.baseGeometry = object.geometry.clone();
            if (object.userData.specData) {
                object.userData.baseMass = object.userData.specData.mass;
            }
        }
        if (!object.userData.bendsList) {
            object.userData.bendsList = [];
        }

        const invMat = new THREE.Matrix4().copy(object.matrixWorld).invert();

        let t = 10;
        const firstEdge = phantoms[0]?.userData?.edge;
        if (firstEdge && typeof firstEdge.thickness === 'number' && firstEdge.thickness > 0) {
            t = firstEdge.thickness;
        } else if (object.userData.specData) {
            const sd = object.userData.specData;
            t = (sd.t || sd.th || sd.wallThick || sd.thickness || sd.depth || 10) * (object.scale.y || 1);
        }
        if (isNaN(R) || R < 0) R = t;

        const mode = window.bendRadiusMode || 'inner';
        let Rin;
        if (mode === 'outer') Rin = Math.max(0.1, R - t);
        else if (mode === 'middle') Rin = Math.max(0.1, R - t / 2);
        else Rin = Math.max(0.1, R);

        for (const phantom of phantoms) {
            phantom.updateMatrixWorld(true);

            const edgeWidth = phantom.userData.edgeWidth || 100;
            const L_arc = angleDeg * (Math.PI / 180) * (Rin + t / 2);
            const L_blank = L_arc + length;
            const pVolume = (L_blank * t * edgeWidth) / 1000000000;

            const localPhantomGeo = phantom.geometry.clone();
            localPhantomGeo.applyMatrix4(phantom.matrixWorld);
            localPhantomGeo.applyMatrix4(invMat);

            let localUnfoldedGeo = null;
            let bendFlatMat = null;
            if (phantom.userData && phantom.userData.unfoldedGeometry) {
                localUnfoldedGeo = phantom.userData.unfoldedGeometry.clone();
                
                const pMat = phantom.matrixWorld.clone().premultiply(invMat);
                const pPos = new THREE.Vector3();
                const pQuat = new THREE.Quaternion();
                const pScale = new THREE.Vector3();
                pMat.decompose(pPos, pQuat, pScale);

                const xAxis3d = new THREE.Vector3(1, 0, 0).applyQuaternion(pQuat).normalize();
                const zAxis3d = new THREE.Vector3(0, 0, 1).applyQuaternion(pQuat).normalize();

                const baseGeo = object.userData.baseGeometry;
                if (!baseGeo.boundingBox) baseGeo.computeBoundingBox();
                const bCentroid = new THREE.Vector3();
                baseGeo.boundingBox.getCenter(bCentroid);
                const sz = new THREE.Vector3();
                baseGeo.boundingBox.getSize(sz);
                let baseNorm = new THREE.Vector3(0, 1, 0);
                if (sz.x <= sz.y && sz.x <= sz.z) baseNorm.set(1, 0, 0);
                else if (sz.y <= sz.x && sz.y <= sz.z) baseNorm.set(0, 1, 0);
                else baseNorm.set(0, 0, 1);

                let zFlat = zAxis3d.clone().addScaledVector(baseNorm, -zAxis3d.dot(baseNorm));
                if (zFlat.lengthSq() > 0.001) {
                    zFlat.normalize();
                } else {
                    zFlat = xAxis3d.clone().addScaledVector(baseNorm, -xAxis3d.dot(baseNorm)).cross(baseNorm).normalize();
                }
                let xFlat = baseNorm.clone().cross(zFlat).normalize();
                const vRel = pPos.clone().sub(bCentroid);
                const h = vRel.dot(baseNorm);
                const absH = Math.abs(h);
                const inPlane = vRel.clone().addScaledVector(baseNorm, -h);

                // Ensure xFlat points OUTWARD away from bCentroid to avoid self-intersection/overlap
                if (inPlane.lengthSq() > 0.001) {
                    if (xFlat.dot(inPlane) < 0) xFlat.negate();
                } else if (xFlat.dot(xAxis3d) < 0) {
                    xFlat.negate();
                }
                let yFlat = baseNorm.clone();
                zFlat = xFlat.clone().cross(yFlat).normalize();
                
                let pFlat;
                if (absH <= t * 1.2) {
                    pFlat = pPos.clone();
                } else {
                    const s = Math.sign(h) || 1;
                    pFlat = bCentroid.clone().add(inPlane).addScaledVector(xFlat, absH - t * 0.5).addScaledVector(baseNorm, s * t * 0.5);
                }

                const flatMat = new THREE.Matrix4();
                flatMat.makeBasis(xFlat, yFlat, zFlat);
                flatMat.setPosition(pFlat);

                localUnfoldedGeo.applyMatrix4(flatMat);
                bendFlatMat = flatMat.clone();
            }

            let faceCenter = new THREE.Vector3();
            if (phantom.userData.edge) {
                faceCenter.addVectors(phantom.userData.edge.v1, phantom.userData.edge.v2).multiplyScalar(0.5);
            } else {
                phantom.getWorldPosition(faceCenter);
            }
            const localPoint = object.worldToLocal(faceCenter.clone());

            let edgeData = null;
            if (phantom.userData.edge) {
                const e = phantom.userData.edge;
                const edgeT = e.thickness || t || 10;
                const invQ = object.quaternion.clone().invert();

                const normalMatrix = new THREE.Matrix3().getNormalMatrix(object.matrixWorld);
                let broadNormalWorld = new THREE.Vector3(0, 1, 0).applyMatrix3(normalMatrix).normalize();
                if (object.userData && object.userData.specData && object.userData.specData.broadNormal) {
                    broadNormalWorld = object.userData.specData.broadNormal.clone().applyMatrix3(normalMatrix).normalize();
                }

                let wThick = (e.thicknessDir ? e.thicknessDir.clone() : (e.faceNormal && e.edgeDir ? e.faceNormal.clone().cross(e.edgeDir) : new THREE.Vector3(0, 1, 0))).normalize();
                if (wThick.dot(broadNormalWorld) < 0) {
                    wThick.negate();
                }

                const lThick = wThick.clone().applyQuaternion(invQ).normalize();
                const lFaceNorm = e.faceNormal ? e.faceNormal.clone().applyQuaternion(invQ).normalize() : new THREE.Vector3(1, 0, 0);
                const lEdgeDir = e.edgeDir ? e.edgeDir.clone().applyQuaternion(invQ).normalize() : new THREE.Vector3(0, 0, 1);

                const lV1_base = object.worldToLocal(e.v1.clone());
                const lV2_base = object.worldToLocal(e.v2.clone());

                edgeData = {
                    v1: e.v1.clone(),
                    v2: e.v2.clone(),
                    edgeDir: e.edgeDir ? e.edgeDir.clone() : null,
                    faceNormal: e.faceNormal ? e.faceNormal.clone() : null,
                    thicknessDir: wThick.clone(),
                    thickness: edgeT,
                    localV1_base: lV1_base,
                    localV2_base: lV2_base,
                    localThicknessDir: lThick,
                    localFaceNormal: lFaceNorm,
                    localEdgeDir: lEdgeDir
                };
            }

            const bendRecord = {
                id: 'bend_' + Date.now() + '_' + Math.floor(Math.random() * 100000),
                object: object,
                localPoint: localPoint,
                edge: edgeData,
                length: phantom.userData.length || length,
                unfoldedGeometryRaw: phantom.userData.unfoldedGeometry ? phantom.userData.unfoldedGeometry.clone() : null,
                localPhantomGeo: localPhantomGeo,
                localUnfoldedGeo: localUnfoldedGeo,
                addedVolume: pVolume,
                L_arc: L_arc,
                edgeWidth: edgeWidth,
                t: t,
                Rin: phantom.userData.Rin || Rin,
                Rout: phantom.userData.Rout || (Rin + t),
                angleRad: phantom.userData.angleRad || (angleDeg * Math.PI / 180),
                angleDeg: phantom.userData.angleDeg || angleDeg,
                invert: !!phantom.userData.invert,
                flatMat: bendFlatMat,
                htmlElement: null
            };

            bendRecord.htmlElement = window.createBendMarker(bendRecord);
            object.userData.bendsList.push(bendRecord);
            if (!window.allBends) window.allBends = [];
            window.allBends.push(bendRecord);
        }
        
        window.rebuildObjectFromBends(object);
    }
    
    if (typeof window.refreshSpecTable === 'function') {
        window.refreshSpecTable();
    }
    
    if (typeof showToast === 'function') showToast("Гиб успешно добавлен!");
    
    if (typeof cancelAllCommands === 'function') {
        cancelAllCommands();
    } else {
        window.clearBendPhantoms();
        if (typeof bendHoverHighlight !== 'undefined' && bendHoverHighlight) {
            if (typeof creatorScene !== 'undefined') creatorScene.remove(bendHoverHighlight);
            if (bendHoverHighlight.geometry) bendHoverHighlight.geometry.dispose();
            if (bendHoverHighlight.material) bendHoverHighlight.material.dispose();
            bendHoverHighlight = null;
        }
        bendSelectedEdges = [];
        bendState = 0;
        window.closeQuickPanels();
        if (typeof setCreatorActiveTool === 'function') setCreatorActiveTool(null);
        if (typeof setCreatorUIMode === 'function') setCreatorUIMode('default');
    }
};
