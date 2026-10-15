/**
 * ============================================================================
 * ФАЙЛ: creator3d_sketch.js
 * НАЗНАЧЕНИЕ: Модуль для логики 2D-эскизирования (черчения) на рабочих плоскостях.
 * ============================================================================
 * ИНФОРМАЦИЯ ДЛЯ НЕЙРОСЕТЕЙ И РАЗРАБОТЧИКОВ:
 * - Этот файл полностью посвящен режиму 2D-эскиза.
 * - Сюда относятся функции отрисовки отрезков, дуг и окружностей 
 *   (addSketchPoint, updateTempShape).
 * - Вся математика магнитных привязок (Snaps) к центрам линий, узлам, 
 *   а также логика ортогонального черчения (F8).
 * - Инструменты создания вспомогательных рабочих плоскостей (МСК, на грани детали).
 * - Алгоритмы замыкания контуров и их последующего выдавливания (performExtrusion).
 */
// TODO: Реализовать функции
window.showSketchPrimitives = function() {
    console.log("showSketchPrimitives");
};
window.extrudeSketch = function() {
    console.log("extrudeSketch");
};
window.showSketchSnaps = function() {
    console.log("showSketchSnaps");
};

/**
 * ============================================================================
 * Блок Топологии: Обрезка (Trim) и Продление (Extend)
 * ============================================================================
 */

let trimExtendPreview = null;
let currentTopologyTarget = null;
let currentTopologyAction = null; // 'trim' or 'extend'
let currentTopologyData = null; 

function getPointScreenDist(pt3d) {
    if (typeof currentCreatorCamera === 'undefined' || !currentCreatorCamera || typeof creatorRenderer === 'undefined' || !creatorRenderer || typeof sketchMouse === 'undefined' || !sketchMouse) {
        return Infinity;
    }
    const canvas = creatorRenderer.domElement;
    if (!canvas) return Infinity;
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;
    
    const p = pt3d.clone().project(currentCreatorCamera);
    if (p.z > 1) return Infinity;
    
    const x = (p.x * 0.5 + 0.5) * w;
    const y = (-p.y * 0.5 + 0.5) * h;
    const mX = (sketchMouse.x * 0.5 + 0.5) * w;
    const mY = (-sketchMouse.y * 0.5 + 0.5) * h;
    return Math.hypot(mX - x, mY - y);
}

function getSegmentScreenDist(start3d, end3d) {
    if (typeof currentCreatorCamera === 'undefined' || !currentCreatorCamera || typeof creatorRenderer === 'undefined' || !creatorRenderer || typeof sketchMouse === 'undefined' || !sketchMouse) {
        return Infinity;
    }
    const canvas = creatorRenderer.domElement;
    if (!canvas) return Infinity;
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;
    
    const p1 = start3d.clone().project(currentCreatorCamera);
    const p2 = end3d.clone().project(currentCreatorCamera);
    if (p1.z > 1 || p2.z > 1) return Infinity;
    
    const x1 = (p1.x * 0.5 + 0.5) * w;
    const y1 = (-p1.y * 0.5 + 0.5) * h;
    const x2 = (p2.x * 0.5 + 0.5) * w;
    const y2 = (-p2.y * 0.5 + 0.5) * h;
    
    const mX = (sketchMouse.x * 0.5 + 0.5) * w;
    const mY = (-sketchMouse.y * 0.5 + 0.5) * h;
    
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-6) return Math.hypot(mX - x1, mY - y1);
    let t = ((mX - x1) * dx + (mY - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(mX - (x1 + t * dx), mY - (y1 + t * dy));
}

window.updateTopologyHover = function(pt) {
    if (typeof sketchTool !== 'undefined' && sketchTool === 'chamfer') {
        if (typeof window.updateChamferHover === 'function') window.updateChamferHover(pt);
        return;
    }
    if (typeof sketchTool !== 'undefined' && sketchTool === 'fillet') {
        if (typeof window.updateFilletHover === 'function') window.updateFilletHover(pt);
        return;
    }

    if (typeof currentDrawPoints !== 'undefined' && currentDrawPoints.length > 0) {
        if (trimExtendPreview) trimExtendPreview.visible = false;
        currentTopologyTarget = null;
        currentTopologyData = null;
        return;
    }

    if (!trimExtendPreview) {
        const material = new THREE.LineBasicMaterial({ 
            color: 0xef4444, 
            linewidth: 3, 
            depthTest: false, 
            transparent: true, 
            opacity: 0.85 
        });
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 0,0,0], 3));
        trimExtendPreview = new THREE.Line(geometry, material);
        trimExtendPreview.renderOrder = 999;
        trimExtendPreview.visible = false;
        if (typeof sketchGroup !== 'undefined' && sketchGroup) {
            sketchGroup.add(trimExtendPreview);
        }
    }

    trimExtendPreview.visible = false;
    currentTopologyTarget = null;
    currentTopologyData = null;

    if (!pt) return;

    const plane = (typeof activeSketchPlane !== 'undefined' && activeSketchPlane) ? activeSketchPlane : null;
    const basis = typeof window.getPlaneBasis === 'function' ? window.getPlaneBasis(plane) : {
        origin: new THREE.Vector3(0,0,0), right: new THREE.Vector3(1,0,0), up: new THREE.Vector3(0,1,0)
    };
    const circs = typeof sketchCircles !== 'undefined' ? sketchCircles : [];

    let closestPrimitive = null; // { type: 'segment'|'circle', object }
    let minDist = Infinity;

    // Сканируем отрезки
    if (sketchSegments && sketchSegments.length > 0) {
        sketchSegments.forEach(seg => {
            if (!seg.start || !seg.end) return;
            const line3 = new THREE.Line3(seg.start, seg.end);
            const closestPt = new THREE.Vector3();
            line3.closestPointToPoint(pt, true, closestPt);
            const dist3d = closestPt.distanceTo(pt);
            const screenPx = getSegmentScreenDist(seg.start, seg.end);
            
            if ((screenPx < 35 || dist3d < 25) && screenPx < minDist) {
                minDist = screenPx;
                closestPrimitive = { type: 'segment', object: seg };
            }
        });
    }

    // Сканируем окружности
    if (circs && circs.length > 0) {
        const mouse2d = window.project3Dto2D(pt, basis);
        circs.forEach(circ => {
            if (!circ || !circ.center || !(circ.radius > 0)) return;
            const circCenter2d = window.project3Dto2D(circ.center, basis);
            const du = mouse2d.u - circCenter2d.u;
            const dv = mouse2d.v - circCenter2d.v;
            const distToCenter2d = Math.hypot(du, dv);
            if (distToCenter2d < 1e-6) return;
            const near2d = {
                u: circCenter2d.u + (du / distToCenter2d) * circ.radius,
                v: circCenter2d.v + (dv / distToCenter2d) * circ.radius
            };
            const near3d = window.project2Dto3D(near2d.u, near2d.v, basis);
            const dist3d = near3d.distanceTo(pt);
            const screenPx = getPointScreenDist(near3d);

            if ((screenPx < 35 || dist3d < 25) && screenPx < minDist) {
                minDist = screenPx;
                closestPrimitive = { type: 'circle', object: circ };
            }
        });
    }

    if (!closestPrimitive) return;

    if (sketchTool === 'trim') {
        trimExtendPreview.material.color.setHex(0xef4444); // красный фантом

        if (closestPrimitive.type === 'segment') {
            const seg = closestPrimitive.object;
            const targetData = window.getSegmentTrimChainTarget(seg, pt, sketchSegments, circs, basis);

            if (targetData && targetData.points && targetData.points.length > 0) {
                trimExtendPreview.geometry.setFromPoints(targetData.points);
                trimExtendPreview.visible = true;

                currentTopologyTarget = seg;
                currentTopologyAction = 'trim';
                currentTopologyData = targetData;
            }

        } else if (closestPrimitive.type === 'circle') {
            const circ = closestPrimitive.object;
            const circCenter2d = window.project3Dto2D(circ.center, basis);
            const R = circ.radius;
            const mouse2d = window.project3Dto2D(pt, basis);
            let mouseAngle = Math.atan2(mouse2d.v - circCenter2d.v, mouse2d.u - circCenter2d.u);
            if (mouseAngle < 0) mouseAngle += Math.PI * 2;

            const sortedAngles = window.getCircleTrimIntersectionAngles(circ, sketchSegments, circs, basis);

            let aStart = 0, aEnd = Math.PI * 2;
            if (sortedAngles && sortedAngles.length > 0) {
                const extAngles = [...sortedAngles, sortedAngles[0] + Math.PI * 2];
                let mAng = mouseAngle;
                if (mAng < sortedAngles[0]) mAng += Math.PI * 2;

                for (let i = 0; i < extAngles.length - 1; i++) {
                    if (mAng >= extAngles[i] - 1e-5 && mAng <= extAngles[i+1] + 1e-5) {
                        aStart = extAngles[i];
                        aEnd = extAngles[i+1];
                        break;
                    }
                }
            }

            const numSamples = Math.max(16, Math.ceil(64 * (aEnd - aStart) / (Math.PI * 2)));
            const pts = [];
            for (let k = 0; k <= numSamples; k++) {
                const ang = aStart + (k / numSamples) * (aEnd - aStart);
                const u = circCenter2d.u + R * Math.cos(ang);
                const v = circCenter2d.v + R * Math.sin(ang);
                pts.push(window.project2Dto3D(u, v, basis));
            }

            trimExtendPreview.geometry.setFromPoints(pts);
            trimExtendPreview.visible = true;

            currentTopologyTarget = circ;
            currentTopologyAction = 'trim';
            currentTopologyData = { type: 'circle', circle: circ, aStart, aEnd, sortedAngles, basis, circCenter2d, R };
        }

    } else if (sketchTool === 'extend') {
        if (closestPrimitive.type === 'segment') {
            const seg = closestPrimitive.object;
            trimExtendPreview.material.color.setHex(0x22c55e); // зеленый фантом

            const a2d = window.project3Dto2D(seg.start, basis);
            const b2d = window.project3Dto2D(seg.end, basis);
            const mouse2d = window.project3Dto2D(pt, basis);
            const tMouse = window.getSegmentParam(a2d, b2d, mouse2d);

            const isForward = tMouse > 0.5;
            const dirStr = isForward ? 'forward' : 'backward';

            const bestT = window.getExtendRayIntersectionParam(seg, sketchSegments, circs, basis, dirStr);
            if (bestT !== null) {
                const pTarget = seg.start.clone().lerp(seg.end, bestT);
                const pOrigin = isForward ? seg.end : seg.start;

                trimExtendPreview.geometry.setFromPoints([pOrigin, pTarget]);
                trimExtendPreview.visible = true;

                currentTopologyTarget = seg;
                currentTopologyAction = 'extend';
                currentTopologyData = { type: 'segment', segment: seg, targetPoint: pTarget, endpointToUpdate: isForward ? 'end' : 'start' };
            }
        }
    }
};

window.getSegmentTrimChainTarget = function(targetSeg, mousePt, allSegments, allCircles, basis) {
    if (!targetSeg || !targetSeg.start || !targetSeg.end) return null;

    const T = window.getTrimIntersectionParams(targetSeg, allSegments, allCircles, basis);
    const a2d = window.project3Dto2D(targetSeg.start, basis);
    const b2d = window.project3Dto2D(targetSeg.end, basis);
    const mouse2d = window.project3Dto2D(mousePt, basis);
    const tMouse = window.getSegmentParam(a2d, b2d, mouse2d);

    let internalIntersection = false;
    let tStart = 0, tEnd = 1;
    for (let i = 0; i < T.length - 1; i++) {
        if (tMouse >= T[i] - 1e-5 && tMouse <= T[i+1] + 1e-5) {
            tStart = T[i];
            tEnd = T[i+1];
            if (tStart > 1e-4 || tEnd < 1 - 1e-4) {
                internalIntersection = true;
            }
            break;
        }
    }

    if (internalIntersection) {
        const pStart = targetSeg.start.clone().lerp(targetSeg.end, tStart);
        const pEnd = targetSeg.start.clone().lerp(targetSeg.end, tEnd);
        return {
            type: 'segment',
            isChain: false,
            segment: targetSeg,
            tStart,
            tEnd,
            pStart,
            pEnd,
            points: [pStart, pEnd]
        };
    }

    // Проверяем, является ли сегмент частью плавной цепочки дуги
    const countTotalSegmentsAtPoint = (point) => {
        let count = 0;
        for (let i = 0; i < allSegments.length; i++) {
            const s = allSegments[i];
            if (!s.start || !s.end) continue;
            if (s.start.distanceTo(point) < 1e-3 || s.end.distanceTo(point) < 1e-3) {
                count++;
            }
        }
        return count;
    };

    const getConnectedSmoothNeighbor = (point, curSeg) => {
        for (let i = 0; i < allSegments.length; i++) {
            const s = allSegments[i];
            if (s === curSeg || !s.start || !s.end) continue;
            let matchPt = null;
            let otherPt = null;
            if (s.start.distanceTo(point) < 1e-3) {
                matchPt = s.start;
                otherPt = s.end;
            } else if (s.end.distanceTo(point) < 1e-3) {
                matchPt = s.end;
                otherPt = s.start;
            }
            if (matchPt) {
                const dirCur = (curSeg.start.distanceTo(point) < 1e-3) 
                    ? curSeg.end.clone().sub(curSeg.start).normalize() 
                    : curSeg.start.clone().sub(curSeg.end).normalize();
                const dirNext = otherPt.clone().sub(matchPt).normalize();
                const dot = dirCur.dot(dirNext);
                if (dot > 0.6) {
                    return { seg: s, matchPt, otherPt };
                }
            }
        }
        return null;
    };

    const chainStart = [];
    let cur = targetSeg;
    let curPt = targetSeg.start;
    while (true) {
        if (countTotalSegmentsAtPoint(curPt) !== 2) break;
        const neighbor = getConnectedSmoothNeighbor(curPt, cur);
        if (!neighbor) break;
        const nextSeg = neighbor.seg;
        const nextT = window.getTrimIntersectionParams(nextSeg, allSegments, allCircles, basis);
        const isNextStartNear = nextSeg.start.distanceTo(curPt) < 1e-3;
        if (nextT && nextT.length > 2) {
            chainStart.push({ seg: nextSeg, trimParam: isNextStartNear ? nextT[1] : nextT[nextT.length - 2], isNearStart: isNextStartNear });
            break;
        }
        chainStart.push({ seg: nextSeg, trimParam: null });
        cur = nextSeg;
        curPt = neighbor.otherPt;
    }

    const chainEnd = [];
    cur = targetSeg;
    curPt = targetSeg.end;
    while (true) {
        if (countTotalSegmentsAtPoint(curPt) !== 2) break;
        const neighbor = getConnectedSmoothNeighbor(curPt, cur);
        if (!neighbor) break;
        const nextSeg = neighbor.seg;
        const nextT = window.getTrimIntersectionParams(nextSeg, allSegments, allCircles, basis);
        const isNextStartNear = nextSeg.start.distanceTo(curPt) < 1e-3;
        if (nextT && nextT.length > 2) {
            chainEnd.push({ seg: nextSeg, trimParam: isNextStartNear ? nextT[1] : nextT[nextT.length - 2], isNearStart: isNextStartNear });
            break;
        }
        chainEnd.push({ seg: nextSeg, trimParam: null });
        cur = nextSeg;
        curPt = neighbor.otherPt;
    }

    const fullChain = [];
    const allChainPoints = [];

    for (let i = chainStart.length - 1; i >= 0; i--) {
        fullChain.push(chainStart[i]);
    }
    fullChain.push({ seg: targetSeg, trimParam: null });
    for (let i = 0; i < chainEnd.length; i++) {
        fullChain.push(chainEnd[i]);
    }

    if (fullChain.length === 1) {
        const pStart = targetSeg.start.clone();
        const pEnd = targetSeg.end.clone();
        return {
            type: 'segment',
            isChain: false,
            segment: targetSeg,
            tStart: 0,
            tEnd: 1,
            pStart,
            pEnd,
            points: [pStart, pEnd]
        };
    }

    for (let i = 0; i < fullChain.length; i++) {
        const item = fullChain[i];
        const s = item.seg;
        if (item.trimParam !== null) {
            const pCut = s.start.clone().lerp(s.end, item.trimParam);
            allChainPoints.push(pCut);
        } else {
            allChainPoints.push(s.start.clone());
            allChainPoints.push(s.end.clone());
        }
    }

    return {
        type: 'segmentChain',
        isChain: true,
        chain: fullChain,
        points: allChainPoints,
        segment: targetSeg
    };
};

window.handleTopologyClick = function() {
    if (!currentTopologyTarget || !currentTopologyData || !currentTopologyAction) return false;
    
    if (currentTopologyAction === 'trim') {
        if (currentTopologyData.type === 'segmentChain' || currentTopologyData.isChain) {
            const { chain } = currentTopologyData;
            if (chain && chain.length > 0) {
                chain.forEach(item => {
                    if (item.trimParam !== null) {
                        const pCut = item.seg.start.clone().lerp(item.seg.end, item.trimParam);
                        if (item.isNearStart) {
                            item.seg.start.copy(pCut);
                        } else {
                            item.seg.end.copy(pCut);
                        }
                    } else {
                        const idx = sketchSegments.indexOf(item.seg);
                        if (idx !== -1) sketchSegments.splice(idx, 1);
                    }
                });
            }
        } else if (currentTopologyData.type === 'segment') {
            const { segment, tStart, tEnd, pStart, pEnd } = currentTopologyData;
            
            if (tStart <= 1e-4 && tEnd >= 1 - 1e-4) {
                const idx = sketchSegments.indexOf(segment);
                if (idx !== -1) sketchSegments.splice(idx, 1);
            } else if (tStart <= 1e-4) {
                segment.start.copy(pEnd);
            } else if (tEnd >= 1 - 1e-4) {
                segment.end.copy(pStart);
            } else {
                const originalEnd = segment.end.clone();
                segment.end.copy(pStart);
                sketchSegments.push({ start: pEnd.clone(), end: originalEnd });
            }
        } else if (currentTopologyData.type === 'circle') {
            const { circle, aStart, aEnd, sortedAngles, basis, circCenter2d, R } = currentTopologyData;
            
            const idx = sketchCircles.indexOf(circle);
            if (idx !== -1) sketchCircles.splice(idx, 1);

            if (sortedAngles && sortedAngles.length >= 2) {
                const extAngles = [...sortedAngles, sortedAngles[0] + Math.PI * 2];
                for (let i = 0; i < extAngles.length - 1; i++) {
                    const iStart = extAngles[i];
                    const iEnd = extAngles[i+1];
                    
                    if (Math.abs(iStart - aStart) < 1e-3 && Math.abs(iEnd - aEnd) < 1e-3) {
                        continue; // Удаляем выделенный сегмент дуги
                    }
                    
                    const numSub = Math.max(12, Math.ceil(48 * (iEnd - iStart) / (Math.PI * 2)));
                    let lastPt = null;
                    for (let k = 0; k <= numSub; k++) {
                        const ang = iStart + (k / numSub) * (iEnd - iStart);
                        const u = circCenter2d.u + R * Math.cos(ang);
                        const v = circCenter2d.v + R * Math.sin(ang);
                        const pt3d = window.project2Dto3D(u, v, basis);
                        if (lastPt) {
                            sketchSegments.push({ start: lastPt, end: pt3d });
                        }
                        lastPt = pt3d;
                    }
                }
            }
        }
        
    } else if (currentTopologyAction === 'extend') {
        const { segment, targetPoint, endpointToUpdate } = currentTopologyData;
        if (endpointToUpdate === 'end') {
            segment.end.copy(targetPoint);
        } else if (endpointToUpdate === 'start') {
            segment.start.copy(targetPoint);
        }
    }
    
    window.rebuildSketchLines();
    
    if (trimExtendPreview) {
        trimExtendPreview.visible = false;
    }
    currentTopologyTarget = null;
    currentTopologyData = null;
    return true;
};

window.rebuildSketchLines = function() {
    if (typeof window.clearSketchGapMarkers === 'function') {
        window.clearSketchGapMarkers();
    }
    const toRemove = [];
    if (typeof sketchGroup !== 'undefined' && sketchGroup) {
        sketchGroup.children.forEach(c => {
            if (c === tempShapePreview || c === trimExtendPreview) return;
            if (typeof chamferPhantomMesh !== 'undefined' && c === chamferPhantomMesh) return;
            if (typeof filletPhantomMesh !== 'undefined' && c === filletPhantomMesh) return;
            if (typeof baseAxisHoverGroup !== 'undefined' && c === baseAxisHoverGroup) return;
            if (typeof activeMirrorLinesGroup !== 'undefined' && c === activeMirrorLinesGroup) return;
            if (c.name === 'baseAxisHoverGroup' || c.name === 'activeMirrorLinesGroup') return;

            if (c.isLine || c.isLineSegments || c.isSketchCircleMesh) {
                toRemove.push(c);
            }
        });
        toRemove.forEach(c => {
            sketchGroup.remove(c);
            if (c.geometry) c.geometry.dispose();
        });
        
        const mat = new THREE.LineBasicMaterial({ color: 0x2A3142, linewidth: 2, depthTest: false });
        sketchSegments.forEach(seg => {
            if (seg.start.distanceTo(seg.end) > 1e-4) {
                const geo = new THREE.BufferGeometry().setFromPoints([seg.start, seg.end]);
                const lineMat = (seg.color || seg.isInfinite) ? new THREE.LineBasicMaterial({ color: seg.color || 0x2563EB, linewidth: 2, depthTest: false }) : mat;
                const line = new THREE.Line(geo, lineMat);
                line.renderOrder = 1;
                sketchGroup.add(line);
            }
        });

        if (typeof sketchCircles !== 'undefined' && sketchCircles) {
            sketchCircles.forEach(circ => {
                if (circ && circ.center && circ.radius > 0) {
                    const geo = new THREE.CircleGeometry(circ.radius, 64);
                    const edges = new THREE.EdgesGeometry(geo, 15);
                    const circleLine = new THREE.LineSegments(edges, mat);
                    circleLine.position.copy(circ.center);
                    circleLine.renderOrder = 1;
                    circleLine.isSketchCircleMesh = true;
                    if (typeof alignToPlane === 'function' && typeof activeSketchPlane !== 'undefined' && activeSketchPlane) {
                        alignToPlane(circleLine, activeSketchPlane);
                    }
                    sketchGroup.add(circleLine);
                }
            });
        }
    }
    
    if (typeof window.invalidateSketchIntersectionsCache === 'function') {
        window.invalidateSketchIntersectionsCache();
    }
    if (typeof window.recomputeSketchCenters === 'function') {
        window.recomputeSketchCenters();
    }

    if (typeof sketchPoints !== 'undefined') {
        sketchPoints.length = 0;
        const seenMap = new Map();
        sketchSegments.forEach(seg => {
            const pArr = (seg.isInfinite && seg.p1 && seg.p2) ? [seg.p1, seg.p2] : [seg.start, seg.end];
            pArr.forEach(p => {
                if (!p) return;
                const k = `${Math.round(p.x * 50)},${Math.round(p.y * 50)},${Math.round(p.z * 50)}`;
                if (!seenMap.has(k)) {
                    seenMap.set(k, true);
                    sketchPoints.push(p.clone());
                }
            });
        });
    }

    if (typeof selectedSketchSegment !== 'undefined' && selectedSketchSegment) {
        if (!sketchSegments || sketchSegments.indexOf(selectedSketchSegment) === -1) {
            if (typeof window.clearSketchSelection === 'function') window.clearSketchSelection();
        } else {
            if (typeof window.updateSketchSelectionVisuals === 'function') window.updateSketchSelectionVisuals();
        }
    } else if (typeof selectedSketchCircle !== 'undefined' && selectedSketchCircle) {
        if (!sketchCircles || sketchCircles.indexOf(selectedSketchCircle) === -1) {
            if (typeof window.clearSketchSelection === 'function') window.clearSketchSelection();
        } else {
            if (typeof window.updateSketchSelectionVisuals === 'function') window.updateSketchSelectionVisuals();
        }
    }
};

window.handleFenceTrim = function(p1, p2) {
    const hasSegments = sketchSegments && sketchSegments.length > 0;
    const hasCircles = typeof sketchCircles !== 'undefined' && sketchCircles && sketchCircles.length > 0;
    if (!hasSegments && !hasCircles) return;

    const plane = (typeof activeSketchPlane !== 'undefined' && activeSketchPlane) ? activeSketchPlane : null;
    const basis = typeof window.getPlaneBasis === 'function' ? window.getPlaneBasis(plane) : {
        origin: new THREE.Vector3(0,0,0), right: new THREE.Vector3(1,0,0), up: new THREE.Vector3(0,1,0)
    };
    const circs = typeof sketchCircles !== 'undefined' ? sketchCircles : [];
    
    const fenceA = window.project3Dto2D(p1, basis);
    const fenceB = window.project3Dto2D(p2, basis);

    let changed = false;

    if (hasSegments) {
        const segmentsToProcess = [...sketchSegments];
        segmentsToProcess.forEach(seg => {
            if (!seg.start || !seg.end) return;
            const segA = window.project3Dto2D(seg.start, basis);
            const segB = window.project3Dto2D(seg.end, basis);
            
            const res = window.intersect2DLines(fenceA, fenceB, segA, segB);
            if (res) {
                const { ta, tb } = res;
                if (ta >= -1e-4 && ta <= 1.0001 && tb >= -1e-4 && tb <= 1.0001) {
                    const clampedTb = Math.max(0, Math.min(1, tb));
                    const hitPt = seg.start.clone().lerp(seg.end, clampedTb);
                    window.performTrimAtPoint(seg, hitPt);
                    changed = true;
                }
            }
        });
    }

    if (hasCircles) {
        const circlesToProcess = [...sketchCircles];
        circlesToProcess.forEach(circ => {
            if (!circ || !circ.center || !(circ.radius > 0)) return;
            const circCenter2d = window.project3Dto2D(circ.center, basis);
            const hits = window.getCircleLineIntersections(circCenter2d, circ.radius, fenceA, fenceB);
            if (hits && hits.length > 0) {
                const hitAngle = hits[0].angle;
                const sortedAngles = window.getCircleTrimIntersectionAngles(circ, sketchSegments, circs, basis);
                if (sortedAngles && sortedAngles.length >= 2) {
                    const extAngles = [...sortedAngles, sortedAngles[0] + Math.PI * 2];
                    let mAng = hitAngle;
                    if (mAng < sortedAngles[0]) mAng += Math.PI * 2;
                    let aStart = 0, aEnd = Math.PI * 2;
                    for (let i = 0; i < extAngles.length - 1; i++) {
                        if (mAng >= extAngles[i] - 1e-5 && mAng <= extAngles[i+1] + 1e-5) {
                            aStart = extAngles[i];
                            aEnd = extAngles[i+1];
                            break;
                        }
                    }
                    const idx = sketchCircles.indexOf(circ);
                    if (idx !== -1) sketchCircles.splice(idx, 1);
                    for (let i = 0; i < extAngles.length - 1; i++) {
                        const iStart = extAngles[i];
                        const iEnd = extAngles[i+1];
                        if (Math.abs(iStart - aStart) < 1e-3 && Math.abs(iEnd - aEnd) < 1e-3) continue;
                        const numSub = Math.max(12, Math.ceil(48 * (iEnd - iStart) / (Math.PI * 2)));
                        let lastPt = null;
                        for (let k = 0; k <= numSub; k++) {
                            const ang = iStart + (k / numSub) * (iEnd - iStart);
                            const u = circCenter2d.u + circ.radius * Math.cos(ang);
                            const v = circCenter2d.v + circ.radius * Math.sin(ang);
                            const pt3d = window.project2Dto3D(u, v, basis);
                            if (lastPt) {
                                sketchSegments.push({ start: lastPt, end: pt3d });
                            }
                            lastPt = pt3d;
                        }
                    }
                    changed = true;
                } else {
                    const idx = sketchCircles.indexOf(circ);
                    if (idx !== -1) {
                        sketchCircles.splice(idx, 1);
                        changed = true;
                    }
                }
            }
        });
    }

    if (changed) {
        window.rebuildSketchLines();
    }
};

window.performTrimAtPoint = function(closestSegment, hitPoint) {
    if (!closestSegment || !closestSegment.start || !closestSegment.end || !hitPoint) return;
    const plane = (typeof activeSketchPlane !== 'undefined' && activeSketchPlane) ? activeSketchPlane : null;
    const basis = typeof window.getPlaneBasis === 'function' ? window.getPlaneBasis(plane) : {
        origin: new THREE.Vector3(0,0,0), right: new THREE.Vector3(1,0,0), up: new THREE.Vector3(0,1,0)
    };
    const circs = typeof sketchCircles !== 'undefined' ? sketchCircles : [];
    
    const T = window.getTrimIntersectionParams(closestSegment, sketchSegments, circs, basis);
    const a2d = window.project3Dto2D(closestSegment.start, basis);
    const b2d = window.project3Dto2D(closestSegment.end, basis);
    const hit2d = window.project3Dto2D(hitPoint, basis);
    const tHit = window.getSegmentParam(a2d, b2d, hit2d);
    
    let tStart = 0, tEnd = 1;
    for (let i = 0; i < T.length - 1; i++) {
        if (tHit >= T[i] - 1e-5 && tHit <= T[i+1] + 1e-5) {
            tStart = T[i];
            tEnd = T[i+1];
            break;
        }
    }
    
    const pStart = closestSegment.start.clone().lerp(closestSegment.end, tStart);
    const pEnd = closestSegment.start.clone().lerp(closestSegment.end, tEnd);
    
    if (tStart <= 1e-4 && tEnd >= 1 - 1e-4) {
        const idx = sketchSegments.indexOf(closestSegment);
        if (idx !== -1) sketchSegments.splice(idx, 1);
    } else if (tStart <= 1e-4) {
        closestSegment.start.copy(pEnd);
    } else if (tEnd >= 1 - 1e-4) {
        closestSegment.end.copy(pStart);
    } else {
        const originalEnd = closestSegment.end.clone();
        closestSegment.end.copy(pStart);
        sketchSegments.push({ start: pEnd.clone(), end: originalEnd });
    }
};

/**
 * ============================================================================
 * Выделение элементов эскиза (Select / Interaction Mode)
 * ============================================================================
 */

let selectedSketchSegment = null;
let selectedSketchCircle = null;
let sketchSelectionGroup = null;

window.clearSketchSelection = function() {
    selectedSketchSegment = null;
    selectedSketchCircle = null;
    if (sketchSelectionGroup) {
        sketchSelectionGroup.visible = false;
    }
    if (typeof sketchHudTooltip !== 'undefined' && sketchHudTooltip && (typeof sketchTool === 'undefined' || !sketchTool)) {
        sketchHudTooltip.style.display = 'none';
    }
};

window.updateSketchSelectionVisuals = function() {
    if (typeof THREE === 'undefined') return;

    if (!sketchSelectionGroup) {
        sketchSelectionGroup = new THREE.Group();
        sketchSelectionGroup.name = 'sketchSelectionGroup';
        sketchSelectionGroup.renderOrder = 30;
        if (typeof creatorScene !== 'undefined' && creatorScene) {
            creatorScene.add(sketchSelectionGroup);
        }
    }

    // Clear existing meshes
    while (sketchSelectionGroup.children.length > 0) {
        const obj = sketchSelectionGroup.children.pop();
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
    }

    if (typeof isSketchMode === 'undefined' || !isSketchMode || typeof activeSketchPlane === 'undefined' || !activeSketchPlane) {
        sketchSelectionGroup.visible = false;
        return;
    }

    const plane = activeSketchPlane;
    const up = plane.userData && plane.userData.up ? plane.userData.up.clone().normalize() : new THREE.Vector3(0, 1, 0);
    const normal = plane.userData && plane.userData.normal ? plane.userData.normal.clone().normalize() : new THREE.Vector3(0, 0, 1);
    const right = new THREE.Vector3().crossVectors(up, normal).normalize();
    const rotMatrix = new THREE.Matrix4().makeBasis(right, up, normal);

    if (selectedSketchSegment && selectedSketchSegment.start && selectedSketchSegment.end) {
        sketchSelectionGroup.visible = true;

        const p1 = selectedSketchSegment.start;
        const p2 = selectedSketchSegment.end;

        // 1. Blue line overlaying segment
        const lineGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
        const lineMat = new THREE.LineBasicMaterial({
            color: 0x2563EB, // Bright blue
            linewidth: 4,
            depthTest: false,
            depthWrite: false
        });
        const lineMesh = new THREE.Line(lineGeo, lineMat);
        lineMesh.renderOrder = 30;
        sketchSelectionGroup.add(lineMesh);

        // 2. Control points (start and end handles)
        const ptRadius = 1.6;
        [p1, p2].forEach(pt => {
            const discGeo = new THREE.CircleGeometry(ptRadius, 24);
            const discMat = new THREE.MeshBasicMaterial({
                color: 0x2563EB,
                side: THREE.DoubleSide,
                depthTest: false,
                depthWrite: false
            });
            const discMesh = new THREE.Mesh(discGeo, discMat);
            discMesh.position.copy(pt);
            discMesh.setRotationFromMatrix(rotMatrix);
            discMesh.renderOrder = 31;

            const ringGeo = new THREE.RingGeometry(ptRadius * 0.8, ptRadius * 1.35, 24);
            const ringMat = new THREE.MeshBasicMaterial({
                color: 0xFFFFFF,
                side: THREE.DoubleSide,
                depthTest: false,
                depthWrite: false
            });
            const ringMesh = new THREE.Mesh(ringGeo, ringMat);
            ringMesh.position.copy(pt);
            ringMesh.setRotationFromMatrix(rotMatrix);
            ringMesh.renderOrder = 32;

            sketchSelectionGroup.add(discMesh, ringMesh);
        });

        // HUD Text
        if (typeof sketchHudTooltip !== 'undefined' && sketchHudTooltip) {
            const len = p1.distanceTo(p2).toFixed(2);
            sketchHudTooltip.innerText = `[ Выделен отрезок: L = ${len} мм ]`;
            sketchHudTooltip.style.display = 'block';
        }

    } else if (selectedSketchCircle && selectedSketchCircle.center && selectedSketchCircle.radius) {
        sketchSelectionGroup.visible = true;

        const center = selectedSketchCircle.center;
        const R = selectedSketchCircle.radius;

        const geo = new THREE.CircleGeometry(R, 64);
        const edges = new THREE.EdgesGeometry(geo);
        const mat = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
            color: 0x2563EB,
            linewidth: 4,
            depthTest: false,
            depthWrite: false
        }));
        mat.position.copy(center);
        mat.setRotationFromMatrix(rotMatrix);
        mat.renderOrder = 30;
        sketchSelectionGroup.add(mat);

        const ptRadius = 1.6;
        const discGeo = new THREE.CircleGeometry(ptRadius, 24);
        const discMat = new THREE.MeshBasicMaterial({ color: 0x2563EB, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
        const discMesh = new THREE.Mesh(discGeo, discMat);
        discMesh.position.copy(center);
        discMesh.setRotationFromMatrix(rotMatrix);
        discMesh.renderOrder = 31;

        const ringGeo = new THREE.RingGeometry(ptRadius * 0.8, ptRadius * 1.35, 24);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.position.copy(center);
        ringMesh.setRotationFromMatrix(rotMatrix);
        ringMesh.renderOrder = 32;

        sketchSelectionGroup.add(discMesh, ringMesh);

        if (typeof sketchHudTooltip !== 'undefined' && sketchHudTooltip) {
            sketchHudTooltip.innerText = `[ Выделена окружность: R = ${R.toFixed(2)} мм ]`;
            sketchHudTooltip.style.display = 'block';
        }

    } else {
        sketchSelectionGroup.visible = false;
        if (typeof sketchHudTooltip !== 'undefined' && sketchHudTooltip && (typeof sketchTool === 'undefined' || !sketchTool)) {
            sketchHudTooltip.style.display = 'none';
        }
    }
};

window.selectSketchPrimitiveAtPoint = function(pt) {
    if (!pt) {
        window.clearSketchSelection();
        return false;
    }

    const plane = (typeof activeSketchPlane !== 'undefined' && activeSketchPlane) ? activeSketchPlane : null;
    const basis = typeof window.getPlaneBasis === 'function' ? window.getPlaneBasis(plane) : {
        origin: new THREE.Vector3(0,0,0), right: new THREE.Vector3(1,0,0), up: new THREE.Vector3(0,1,0)
    };

    let closestPrimitive = null;
    let minDist = Infinity;

    // 1. Check sketchSegments
    if (typeof sketchSegments !== 'undefined' && sketchSegments.length > 0) {
        sketchSegments.forEach(seg => {
            if (!seg || !seg.start || !seg.end) return;
            const line3 = new THREE.Line3(seg.start, seg.end);
            const closestPt = new THREE.Vector3();
            line3.closestPointToPoint(pt, true, closestPt);
            const dist3d = closestPt.distanceTo(pt);
            const screenPx = typeof getSegmentScreenDist === 'function' ? getSegmentScreenDist(seg.start, seg.end) : dist3d;

            if ((screenPx < 35 || dist3d < 25) && screenPx < minDist) {
                minDist = screenPx;
                closestPrimitive = { type: 'segment', object: seg };
            }
        });
    }

    // 2. Check sketchCircles
    if (typeof sketchCircles !== 'undefined' && sketchCircles.length > 0) {
        const mouse2d = window.project3Dto2D(pt, basis);
        sketchCircles.forEach(circ => {
            if (!circ || !circ.center || !(circ.radius > 0)) return;
            const circCenter2d = window.project3Dto2D(circ.center, basis);
            const du = mouse2d.u - circCenter2d.u;
            const dv = mouse2d.v - circCenter2d.v;
            const distToCenter2d = Math.hypot(du, dv);
            if (distToCenter2d < 1e-6) return;
            const near2d = {
                u: circCenter2d.u + (du / distToCenter2d) * circ.radius,
                v: circCenter2d.v + (dv / distToCenter2d) * circ.radius
            };
            const near3d = window.project2Dto3D(near2d.u, near2d.v, basis);
            const dist3d = near3d.distanceTo(pt);
            const screenPx = typeof getPointScreenDist === 'function' ? getPointScreenDist(near3d) : dist3d;

            if ((screenPx < 35 || dist3d < 25) && screenPx < minDist) {
                minDist = screenPx;
                closestPrimitive = { type: 'circle', object: circ };
            }
        });
    }

    if (closestPrimitive) {
        if (closestPrimitive.type === 'segment') {
            selectedSketchSegment = closestPrimitive.object;
            selectedSketchCircle = null;
        } else if (closestPrimitive.type === 'circle') {
            selectedSketchCircle = closestPrimitive.object;
            selectedSketchSegment = null;
        }
        window.updateSketchSelectionVisuals();
        return true;
    } else {
        window.clearSketchSelection();
        return false;
    }
};

/**
 * ============================================================================
 * Блок Инструмента "Фаска" (Chamfer Engine)
 * ============================================================================
 */

let chamferMemory = { d1: 10, d2: 10 };
let activeChamferCorner = null; // { vertex, seg1, type1, dir1, maxD1, seg2, type2, dir2, maxD2 }
let hoverChamferCorner = null;
let chamferPhantomMesh = null;

window.setChamferTool = function() {
    if (typeof setSketchTool === 'function') {
        setSketchTool('chamfer');
    } else {
        sketchTool = 'chamfer';
    }
};

window.findCornerAtVertex = function(vertexPoint, threshold = 0.5) {
    if (typeof sketchSegments === 'undefined' || !sketchSegments || sketchSegments.length < 2) return null;

    const connected = [];
    sketchSegments.forEach(seg => {
        if (!seg || !seg.start || !seg.end) return;
        const dStart = seg.start.distanceTo(vertexPoint);
        const dEnd = seg.end.distanceTo(vertexPoint);

        if (dStart < threshold) {
            connected.push({ segment: seg, vertexType: 'start', otherPt: seg.end });
        } else if (dEnd < threshold) {
            connected.push({ segment: seg, vertexType: 'end', otherPt: seg.start });
        }
    });

    if (connected.length !== 2) return null;

    const c1 = connected[0];
    const c2 = connected[1];

    const len1 = vertexPoint.distanceTo(c1.otherPt);
    const len2 = vertexPoint.distanceTo(c2.otherPt);

    if (len1 < 1e-4 || len2 < 1e-4) return null;

    const dir1 = c1.otherPt.clone().sub(vertexPoint).normalize();
    const dir2 = c2.otherPt.clone().sub(vertexPoint).normalize();

    // Защита от параллельных/коллинеарных прямых
    if (Math.abs(dir1.dot(dir2)) > 0.999) return null;

    return {
        vertex: vertexPoint.clone(),
        seg1: c1.segment,
        type1: c1.vertexType,
        dir1: dir1,
        maxD1: len1,
        seg2: c2.segment,
        type2: c2.vertexType,
        dir2: dir2,
        maxD2: len2
    };
};

window.updateChamferHover = function(pt) {
    if (!pt || typeof sketchSegments === 'undefined' || !sketchSegments || sketchSegments.length < 2) {
        hoverChamferCorner = null;
        if (typeof activeChamferCorner !== 'undefined' && activeChamferCorner) {
            activeSmartSnap = {
                type: 'endpoint',
                color: 'green',
                point: activeChamferCorner.vertex.clone(),
                label: 'Выбран угол'
            };
        } else if (typeof activeSmartSnap !== 'undefined' && activeSmartSnap && (activeSmartSnap.label === 'Угол' || activeSmartSnap.label === 'Выбран угол' || activeSmartSnap.label === 'Угол (Фаска)')) {
            activeSmartSnap = null;
        }
        return;
    }

    let minPx = Infinity;
    let bestCorner = null;

    sketchSegments.forEach(seg => {
        if (!seg || !seg.start || !seg.end) return;
        [seg.start, seg.end].forEach(v => {
            let px = typeof getPointScreenDist === 'function' ? getPointScreenDist(v) : Infinity;
            if (!isFinite(px) || px === Infinity) {
                px = pt ? v.distanceTo(pt) * 20 : Infinity;
            }
            if ((px < 45 || (pt && v.distanceTo(pt) < 10)) && px < minPx) {
                const corner = window.findCornerAtVertex(v, 0.5);
                if (corner) {
                    minPx = px;
                    bestCorner = corner;
                }
            }
        });
    });

    hoverChamferCorner = bestCorner;

    if (hoverChamferCorner) {
        if (typeof activeSmartSnap !== 'undefined') {
            activeSmartSnap = {
                type: 'endpoint',
                color: 'green',
                point: hoverChamferCorner.vertex.clone(),
                label: 'Угол'
            };
        }
    } else if (typeof activeChamferCorner !== 'undefined' && activeChamferCorner) {
        if (typeof activeSmartSnap !== 'undefined') {
            activeSmartSnap = {
                type: 'endpoint',
                color: 'green',
                point: activeChamferCorner.vertex.clone(),
                label: 'Выбран угол'
            };
        }
    } else {
        if (typeof activeSmartSnap !== 'undefined' && activeSmartSnap && (activeSmartSnap.label === 'Угол' || activeSmartSnap.label === 'Выбран угол' || activeSmartSnap.label === 'Угол (Фаска)')) {
            activeSmartSnap = null;
        }
    }
};

window.renderChamferInputs = function(cornerData) {
    window.removeChamferInputs();

    if (!cornerData) return;

    const overlay = document.createElement('div');
    overlay.id = 'chamfer-overlay-ui';
    overlay.style.cssText = 'position: absolute; top:0; left:0; width:100%; height:100%; pointer-events: none; z-index: 8502;';

    const maxD1 = cornerData.maxD1;
    const maxD2 = cornerData.maxD2;
    const d1 = Math.min(chamferMemory.d1, maxD1 - 0.1);
    const d2 = Math.min(chamferMemory.d2, maxD2 - 0.1);
    chamferMemory.d1 = Math.max(0.1, d1);
    chamferMemory.d2 = Math.max(0.1, d2);

    const rem1 = Math.max(0, maxD1 - chamferMemory.d1);
    const rem2 = Math.max(0, maxD2 - chamferMemory.d2);

    overlay.innerHTML = `
        <div class="cad-dim-badge extension active sketch-chamfer-input-group" id="chamfer-input-group-1a">
            <input type="number" id="chamfer-input-d1a" class="cad-dim-input" value="${chamferMemory.d1.toFixed(1)}" step="1" min="0.1">
            <span class="cad-dim-unit">мм</span>
        </div>
        <div class="cad-dim-badge extension active sketch-chamfer-input-group" id="chamfer-input-group-1b">
            <input type="number" id="chamfer-input-rem1b" class="cad-dim-input" value="${rem1.toFixed(1)}" step="1" min="0.1">
            <span class="cad-dim-unit">мм</span>
        </div>
        <div class="cad-dim-badge extension active sketch-chamfer-input-group" id="chamfer-input-group-2a">
            <input type="number" id="chamfer-input-d2a" class="cad-dim-input" value="${chamferMemory.d2.toFixed(1)}" step="1" min="0.1">
            <span class="cad-dim-unit">мм</span>
        </div>
        <div class="cad-dim-badge extension active sketch-chamfer-input-group" id="chamfer-input-group-2b">
            <input type="number" id="chamfer-input-rem2b" class="cad-dim-input" value="${rem2.toFixed(1)}" step="1" min="0.1">
            <span class="cad-dim-unit">мм</span>
        </div>
    `;

    const container = document.getElementById('view-creator') || document.body;
    container.appendChild(overlay);

    const inputD1a = document.getElementById('chamfer-input-d1a');
    const inputRem1b = document.getElementById('chamfer-input-rem1b');
    const inputD2a = document.getElementById('chamfer-input-d2a');
    const inputRem2b = document.getElementById('chamfer-input-rem2b');

    const inputs = [inputD1a, inputRem1b, inputD2a, inputRem2b].filter(Boolean);

    if (inputs.length === 4) {
        setTimeout(() => {
            inputD1a.focus();
            inputD1a.select();
        }, 50);

        inputD1a.addEventListener('input', () => {
            const val = parseFloat(inputD1a.value);
            if (!isNaN(val)) {
                chamferMemory.d1 = val;
                const r1 = Math.max(0, maxD1 - val);
                inputRem1b.value = r1.toFixed(1);
                window.updateChamferPhantom();
            }
        });

        inputRem1b.addEventListener('input', () => {
            const val = parseFloat(inputRem1b.value);
            if (!isNaN(val)) {
                const newD1 = Math.max(0, maxD1 - val);
                chamferMemory.d1 = newD1;
                inputD1a.value = newD1.toFixed(1);
                window.updateChamferPhantom();
            }
        });

        inputD2a.addEventListener('input', () => {
            const val = parseFloat(inputD2a.value);
            if (!isNaN(val)) {
                chamferMemory.d2 = val;
                const r2 = Math.max(0, maxD2 - val);
                inputRem2b.value = r2.toFixed(1);
                window.updateChamferPhantom();
            }
        });

        inputRem2b.addEventListener('input', () => {
            const val = parseFloat(inputRem2b.value);
            if (!isNaN(val)) {
                const newD2 = Math.max(0, maxD2 - val);
                chamferMemory.d2 = newD2;
                inputD2a.value = newD2.toFixed(1);
                window.updateChamferPhantom();
            }
        });

        const handleKeyDown = (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                e.stopPropagation();
                const currIdx = inputs.indexOf(e.target);
                if (currIdx !== -1) {
                    const nextIdx = e.shiftKey ? (currIdx - 1 + 4) % 4 : (currIdx + 1) % 4;
                    inputs[nextIdx].focus();
                    inputs[nextIdx].select();
                }
            } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                window.applyChamfer();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                window.cancelChamferUI();
            }
        };

        inputs.forEach(inp => inp.addEventListener('keydown', handleKeyDown));
    }

    window.updateChamferPhantom();
};

window.renderChamferCadDimensions = function() {
    const svgOverlay = document.getElementById('rect-cad-svg');
    const hudContainer = document.getElementById('rect-cad-hud');
    const badgeHint = document.getElementById('rect-badge-hint');
    if (!svgOverlay) return;

    if (!activeChamferCorner || typeof sketchTool === 'undefined' || sketchTool !== 'chamfer') {
        if (typeof sketchTool !== 'undefined' && sketchTool === 'chamfer') {
            svgOverlay.innerHTML = '';
            if (hudContainer) hudContainer.style.display = 'none';
            if (badgeHint) badgeHint.style.display = 'none';
        }
        return;
    }

    if (hudContainer) hudContainer.style.display = 'block';
    if (badgeHint) {
        badgeHint.style.display = 'block';
        badgeHint.innerHTML = '<kbd>Tab</kbd> выбор размера • <kbd>Enter</kbd> применить фаску • <kbd>Esc</kbd> отмена';
    }

    const { vertex, dir1, maxD1, dir2, maxD2 } = activeChamferCorner;
    const { d1, d2 } = chamferMemory;

    const E1 = vertex.clone().add(dir1.clone().multiplyScalar(maxD1));
    const E2 = vertex.clone().add(dir2.clone().multiplyScalar(maxD2));

    const P1 = vertex.clone().add(dir1.clone().multiplyScalar(Math.min(d1, maxD1)));
    const P2 = vertex.clone().add(dir2.clone().multiplyScalar(Math.min(d2, maxD2)));

    const sV = window.projectWorldToScreen(vertex);
    const sP1 = window.projectWorldToScreen(P1);
    const sE1 = window.projectWorldToScreen(E1);
    const sP2 = window.projectWorldToScreen(P2);
    const sE2 = window.projectWorldToScreen(E2);

    if (!sV.visible && !sP1.visible && !sP2.visible) {
        svgOverlay.innerHTML = '';
        return;
    }

    const isD1Valid = d1 > 0 && d1 < maxD1;
    const isD2Valid = d2 > 0 && d2 < maxD2;

    const color1 = isD1Valid ? '#2563EB' : '#EF4444';
    const color2 = isD2Valid ? '#2563EB' : '#EF4444';

    // Segment 1 screen vector, angle and normal
    const dx1 = sE1.x - sV.x;
    const dy1 = sE1.y - sV.y;
    let angle1 = Math.atan2(dy1, dx1) * 180 / Math.PI;
    if (angle1 > 90 || angle1 < -90) angle1 += 180;

    const len1 = Math.hypot(dx1, dy1) || 1;
    const px1 = -dy1 / len1;
    const py1 = dx1 / len1;

    const dx2_v = sE2.x - sV.x;
    const dy2_v = sE2.y - sV.y;
    const dot1 = px1 * dx2_v + py1 * dy2_v;
    let offset1 = 28;
    if (dot1 > 0) offset1 = -28;

    // Segment 2 screen vector, angle and normal
    const dx2 = sE2.x - sV.x;
    const dy2 = sE2.y - sV.y;
    let angle2 = Math.atan2(dy2, dx2) * 180 / Math.PI;
    if (angle2 > 90 || angle2 < -90) angle2 += 180;

    const len2 = Math.hypot(dx2, dy2) || 1;
    const px2 = -dy2 / len2;
    const py2 = dx2 / len2;

    const dot2 = px2 * dx1 + py2 * dy1;
    let offset2 = 28;
    if (dot2 > 0) offset2 = -28;

    let svgHtml = '';
    if (typeof window.renderCadDimensionSVG === 'function') {
        // Segment 1a (Corner -> Chamfer P1)
        if (Math.hypot(sP1.x - sV.x, sP1.y - sV.y) > 4) {
            svgHtml += window.renderCadDimensionSVG(sV, sP1, color1, offset1);
        }
        // Segment 1b (Chamfer P1 -> End E1)
        if (Math.hypot(sE1.x - sP1.x, sE1.y - sP1.y) > 4) {
            svgHtml += window.renderCadDimensionSVG(sP1, sE1, color1, offset1);
        }
        // Segment 2a (Corner -> Chamfer P2)
        if (Math.hypot(sP2.x - sV.x, sP2.y - sV.y) > 4) {
            svgHtml += window.renderCadDimensionSVG(sV, sP2, color2, offset2);
        }
        // Segment 2b (Chamfer P2 -> End E2)
        if (Math.hypot(sE2.x - sP2.x, sE2.y - sP2.y) > 4) {
            svgHtml += window.renderCadDimensionSVG(sP2, sE2, color2, offset2);
        }
    }

    svgOverlay.innerHTML = svgHtml;

    const group1a = document.getElementById('chamfer-input-group-1a');
    const group1b = document.getElementById('chamfer-input-group-1b');
    const group2a = document.getElementById('chamfer-input-group-2a');
    const group2b = document.getElementById('chamfer-input-group-2b');

    if (group1a) {
        const mid_x = (sV.x + sP1.x) / 2 + px1 * offset1;
        const mid_y = (sV.y + sP1.y) / 2 + py1 * offset1;
        group1a.style.left = `${mid_x}px`;
        group1a.style.top = `${mid_y}px`;
        group1a.style.transform = `translate(-50%, -50%) rotate(${angle1}deg)`;
    }
    if (group1b) {
        const mid_x = (sP1.x + sE1.x) / 2 + px1 * offset1;
        const mid_y = (sP1.y + sE1.y) / 2 + py1 * offset1;
        group1b.style.left = `${mid_x}px`;
        group1b.style.top = `${mid_y}px`;
        group1b.style.transform = `translate(-50%, -50%) rotate(${angle1}deg)`;
    }
    if (group2a) {
        const mid_x = (sV.x + sP2.x) / 2 + px2 * offset2;
        const mid_y = (sV.y + sP2.y) / 2 + py2 * offset2;
        group2a.style.left = `${mid_x}px`;
        group2a.style.top = `${mid_y}px`;
        group2a.style.transform = `translate(-50%, -50%) rotate(${angle2}deg)`;
    }
    if (group2b) {
        const mid_x = (sP2.x + sE2.x) / 2 + px2 * offset2;
        const mid_y = (sP2.y + sE2.y) / 2 + py2 * offset2;
        group2b.style.left = `${mid_x}px`;
        group2b.style.top = `${mid_y}px`;
        group2b.style.transform = `translate(-50%, -50%) rotate(${angle2}deg)`;
    }
};

window.updateChamferPhantom = function() {
    if (!activeChamferCorner) {
        if (chamferPhantomMesh) chamferPhantomMesh.visible = false;
        return;
    }

    const { vertex, dir1, maxD1, dir2, maxD2 } = activeChamferCorner;
    const { d1, d2 } = chamferMemory;

    const group1a = document.getElementById('chamfer-input-group-1a');
    const group1b = document.getElementById('chamfer-input-group-1b');
    const group2a = document.getElementById('chamfer-input-group-2a');
    const group2b = document.getElementById('chamfer-input-group-2b');

    const isD1Valid = d1 > 0 && d1 < maxD1;
    const isD2Valid = d2 > 0 && d2 < maxD2;
    const isValid = isD1Valid && isD2Valid;

    const cls1 = isD1Valid ? 'cad-dim-badge extension active sketch-chamfer-input-group' : 'cad-dim-badge topology active sketch-chamfer-input-group error';
    const cls2 = isD2Valid ? 'cad-dim-badge extension active sketch-chamfer-input-group' : 'cad-dim-badge topology active sketch-chamfer-input-group error';

    if (group1a) group1a.className = cls1;
    if (group1b) group1b.className = cls1;
    if (group2a) group2a.className = cls2;
    if (group2b) group2b.className = cls2;

    if (!chamferPhantomMesh) {
        chamferPhantomMesh = new THREE.Group();

        // Линия среза (синяя сплошная)
        const lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 0,0,0], 3));
        const lineMat = new THREE.LineBasicMaterial({ color: 0x2563EB, linewidth: 3, depthTest: false });
        const cutLine = new THREE.Line(lineGeo, lineMat);
        cutLine.name = 'chamferCutLine';
        cutLine.renderOrder = 9999;
        chamferPhantomMesh.add(cutLine);

        // Срезаемые концы (красный пунктир)
        const tailsGeo = new THREE.BufferGeometry();
        tailsGeo.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 0,0,0, 0,0,0, 0,0,0], 3));
        const tailsMat = new THREE.LineDashedMaterial({ color: 0xEF4444, dashSize: 2, gapSize: 2, linewidth: 2, depthTest: false, transparent: true, opacity: 0.85 });
        const tailsLine = new THREE.LineSegments(tailsGeo, tailsMat);
        tailsLine.name = 'chamferTailsLine';
        tailsLine.renderOrder = 9999;
        chamferPhantomMesh.add(tailsLine);

        if (typeof sketchGroup !== 'undefined' && sketchGroup) {
            sketchGroup.add(chamferPhantomMesh);
        }
    }

    if (!isValid) {
        chamferPhantomMesh.visible = false;
        return;
    }

    const P1 = vertex.clone().add(dir1.clone().multiplyScalar(d1));
    const P2 = vertex.clone().add(dir2.clone().multiplyScalar(d2));

    const cutLine = chamferPhantomMesh.getObjectByName('chamferCutLine');
    if (cutLine) {
        cutLine.geometry.setFromPoints([P1, P2]);
    }

    const tailsLine = chamferPhantomMesh.getObjectByName('chamferTailsLine');
    if (tailsLine) {
        tailsLine.geometry.setFromPoints([vertex, P1, vertex, P2]);
        tailsLine.computeLineDistances();
    }

    chamferPhantomMesh.visible = true;
    window.updateChamferUIOverlay();
};

window.updateChamferUIOverlay = function() {
    window.renderChamferCadDimensions();
};

window.removeChamferInputs = function() {
    const overlay = document.getElementById('chamfer-overlay-ui');
    if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
    }
    const svgOverlay = document.getElementById('rect-cad-svg');
    if (svgOverlay) svgOverlay.innerHTML = '';
    const hudContainer = document.getElementById('rect-cad-hud');
    if (hudContainer && typeof sketchTool !== 'undefined' && sketchTool === 'chamfer') {
        hudContainer.style.display = 'none';
    }
    const badgeHint = document.getElementById('rect-badge-hint');
    if (badgeHint && typeof sketchTool !== 'undefined' && sketchTool === 'chamfer') {
        badgeHint.style.display = 'none';
    }
};

window.cancelChamferUI = function() {
    activeChamferCorner = null;
    window.removeChamferInputs();
    if (chamferPhantomMesh) chamferPhantomMesh.visible = false;
    if (typeof activeSmartSnap !== 'undefined' && activeSmartSnap && (activeSmartSnap.label === 'Выбран угол' || activeSmartSnap.label === 'Угол (Фаска)')) {
        activeSmartSnap = null;
    }
    if (typeof sketchHudTooltip !== 'undefined' && sketchHudTooltip) {
        if (sketchTool === 'chamfer') {
            sketchHudTooltip.innerText = '[ Фаска: Укажите угол ]';
        }
    }
};

window.applyChamfer = function() {
    if (!activeChamferCorner) return false;

    const { vertex, seg1, type1, dir1, seg2, type2, dir2, maxD1, maxD2 } = activeChamferCorner;
    const { d1, d2 } = chamferMemory;

    if (d1 <= 0 || d2 <= 0 || d1 >= maxD1 || d2 >= maxD2) {
        if (typeof showToast === 'function') {
            showToast("Ошибка: длина фаски превышает длину отрезка!");
        }
        return false;
    }

    const P1 = vertex.clone().add(dir1.clone().multiplyScalar(d1));
    const P2 = vertex.clone().add(dir2.clone().multiplyScalar(d2));

    // 1. Модификация отрезка 1
    if (type1 === 'start') {
        seg1.start.copy(P1);
    } else {
        seg1.end.copy(P1);
    }

    // 2. Модификация отрезка 2
    if (type2 === 'start') {
        seg2.start.copy(P2);
    } else {
        seg2.end.copy(P2);
    }

    // 3. Вставка сегмента фаски E_chamfer
    sketchSegments.push({ start: P1.clone(), end: P2.clone() });

    // 4. Обновление графики эскиза
    if (typeof window.rebuildSketchLines === 'function') {
        window.rebuildSketchLines();
    }

    // Очищаем текущий активный угол
    window.cancelChamferUI();

    if (typeof showToast === 'function') {
        showToast(`Фаска построена: d1=${d1} мм, d2=${d2} мм`);
    }

    return true;
};

window.handleChamferClick = function() {
    if (typeof sketchTool === 'undefined' || sketchTool !== 'chamfer') return false;

    if (hoverChamferCorner) {
        if (activeChamferCorner && activeChamferCorner !== hoverChamferCorner) {
            window.applyChamfer();
        }

        activeChamferCorner = hoverChamferCorner;
        window.renderChamferInputs(activeChamferCorner);

        if (typeof sketchHudTooltip !== 'undefined' && sketchHudTooltip) {
            sketchHudTooltip.innerText = '[ Фаска: Укажите следующий угол ]';
        }

        return true;
    }

    if (activeChamferCorner) {
        window.applyChamfer();
        return true;
    }

    return false;
};

window.projectWorldToScreen = function(pt3d) {
    if (typeof currentCreatorCamera === 'undefined' || !currentCreatorCamera || typeof creatorRenderer === 'undefined' || !creatorRenderer) {
        return { x: 0, y: 0, visible: false };
    }
    const canvas = creatorRenderer.domElement;
    if (!canvas) return { x: 0, y: 0, visible: false };
    const rect = canvas.getBoundingClientRect();
    const p = pt3d.clone().project(currentCreatorCamera);
    const x = rect.left + (p.x * 0.5 + 0.5) * rect.width;
    const y = rect.top + (-p.y * 0.5 + 0.5) * rect.height;
    return { x, y, visible: p.z < 1 };
};

// ==========================================
// ИНСТРУМЕНТ «СОПРЯЖЕНИЕ» (FILLET / ROUNDING ENGINE)
// ==========================================

let filletMemory = { radius: 10 };
let activeFilletCorner = null;
let hoverFilletCorner = null;
let filletPhantomMesh = null;

window.setFilletTool = function() {
    if (typeof setSketchTool === 'function') {
        setSketchTool('fillet');
    } else {
        sketchTool = 'fillet';
    }
};

/**
 * Расчет геометрии дуги сопряжения (для фантома и фиксации)
 * @param {THREE.Vector3} V - Вершина угла
 * @param {THREE.Vector3} dir1 - Единичный вектор вдоль 1-го отрезка
 * @param {THREE.Vector3} dir2 - Единичный вектор вдоль 2-го отрезка
 * @param {number} R - Радиус сопряжения (может быть отрицательным)
 */
window.calculateFilletArc = function(V, dir1, dir2, R) {
    if (!V || !dir1 || !dir2 || Math.abs(R) < 1e-4) return null;

    // 1. Угол между векторами
    const dot = Math.min(Math.max(dir1.dot(dir2), -0.9999), 0.9999);
    const theta = Math.acos(dot); // Угол в радианах
    const halfAngle = theta / 2;

    // 2. Длина касательного участка d
    const absR = Math.abs(R);
    const tanHalf = Math.tan(halfAngle);
    if (tanHalf < 1e-6) return null;
    const d = absR / tanHalf;

    // 3. Точки касания P1 и P2
    const P1 = V.clone().add(dir1.clone().multiplyScalar(d));
    const P2 = V.clone().add(dir2.clone().multiplyScalar(d));

    // 4. Вектор биссектрисы
    const bisector = new THREE.Vector3().addVectors(dir1, dir2).normalize();

    // 5. Расчет центра окружности C
    const centerDist = absR / Math.sin(halfAngle);
    const center = V.clone();
    if (R > 0) {
        // Выпуклое сопряжение (срезает угол)
        center.add(bisector.clone().multiplyScalar(centerDist));
    } else {
        // Вогнутое сопряжение (зеркалит дугу)
        center.sub(bisector.clone().multiplyScalar(centerDist));
    }

    // 6. Векторы от центра C к P1 и P2
    const v1 = P1.clone().sub(center).normalize();
    const v2 = P2.clone().sub(center).normalize();

    // 7. Нормаль к плоскости эскиза
    let planeNormal = new THREE.Vector3().crossVectors(dir1, dir2);
    if (planeNormal.lengthSq() < 1e-6) {
        planeNormal = new THREE.Vector3(0, 0, 1);
    } else {
        planeNormal.normalize();
    }

    let angle = v1.angleTo(v2);

    // Направление вращения от v1 к v2 вокруг planeNormal
    let testVec = v1.clone().applyAxisAngle(planeNormal, angle);
    let rotSign = 1;
    if (testVec.distanceTo(v2) > 1e-3) {
        rotSign = -1;
    }

    const points = [];
    const segments = 24;
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const curAngle = angle * t * rotSign;
        const curVec = v1.clone().applyAxisAngle(planeNormal, curAngle);
        points.push(center.clone().add(curVec.multiplyScalar(absR)));
    }

    return {
        P1: P1,
        P2: P2,
        center: center,
        arcPoints: points,
        d: d,
        radius: absR,
        rawR: R,
        theta: theta
    };
};

/**
 * Обновление ховера угла для сопряжения
 */
window.updateFilletHover = function(pt) {
    if (!pt || typeof sketchSegments === 'undefined' || !sketchSegments || sketchSegments.length < 2) {
        hoverFilletCorner = null;
        if (typeof activeFilletCorner !== 'undefined' && activeFilletCorner) {
            activeSmartSnap = {
                type: 'endpoint',
                color: 'green',
                point: activeFilletCorner.vertex.clone(),
                label: 'Выбран угол'
            };
        } else if (typeof activeSmartSnap !== 'undefined' && activeSmartSnap && (activeSmartSnap.label === 'Угол' || activeSmartSnap.label === 'Выбран угол' || activeSmartSnap.label === 'Угол (Сопряжение)')) {
            activeSmartSnap = null;
        }
        return;
    }

    let minPx = Infinity;
    let bestCorner = null;

    sketchSegments.forEach(seg => {
        if (!seg || !seg.start || !seg.end) return;
        [seg.start, seg.end].forEach(v => {
            let px = typeof getPointScreenDist === 'function' ? getPointScreenDist(v) : Infinity;
            if (!isFinite(px) || px === Infinity) {
                px = pt ? v.distanceTo(pt) * 20 : Infinity;
            }
            if ((px < 45 || (pt && v.distanceTo(pt) < 10)) && px < minPx) {
                const corner = window.findCornerAtVertex(v, 0.5);
                if (corner) {
                    minPx = px;
                    bestCorner = corner;
                }
            }
        });
    });

    hoverFilletCorner = bestCorner;

    if (hoverFilletCorner) {
        if (typeof activeSmartSnap !== 'undefined') {
            activeSmartSnap = {
                type: 'endpoint',
                color: 'green',
                point: hoverFilletCorner.vertex.clone(),
                label: 'Угол'
            };
        }
    } else if (typeof activeFilletCorner !== 'undefined' && activeFilletCorner) {
        if (typeof activeSmartSnap !== 'undefined') {
            activeSmartSnap = {
                type: 'endpoint',
                color: 'green',
                point: activeFilletCorner.vertex.clone(),
                label: 'Выбран угол'
            };
        }
    } else {
        if (typeof activeSmartSnap !== 'undefined' && activeSmartSnap && (activeSmartSnap.label === 'Угол' || activeSmartSnap.label === 'Выбран угол' || activeSmartSnap.label === 'Угол (Сопряжение)')) {
            activeSmartSnap = null;
        }
    }
};

/**
 * Отрисовка плавающих размерных инпутов для сопряжения (дизайн как у фаски)
 */
window.renderFilletInputs = function(cornerData) {
    window.removeFilletInputs();

    if (!cornerData) return;

    const overlay = document.createElement('div');
    overlay.id = 'fillet-overlay-ui';
    overlay.style.cssText = 'position: absolute; top:0; left:0; width:100%; height:100%; pointer-events: none; z-index: 8502;';

    const { vertex, dir1, maxD1, dir2, maxD2 } = cornerData;
    let R = filletMemory.radius;
    if (R === undefined || R === null || isNaN(R)) R = 10;
    filletMemory.radius = R;

    overlay.innerHTML = `
        <div class="cad-dim-badge extension active sketch-chamfer-input-group" id="fillet-input-group-r">
            <input type="number" id="fillet-input-r" class="cad-dim-input" value="${R.toFixed(1)}" step="1" style="width: 48px;">
            <span class="cad-dim-unit">мм</span>
        </div>
    `;

    const container = document.getElementById('view-creator') || document.body;
    container.appendChild(overlay);

    const inputR = document.getElementById('fillet-input-r');

    if (inputR) {
        setTimeout(() => {
            inputR.focus();
            inputR.select();
        }, 50);

        inputR.addEventListener('input', () => {
            const val = parseFloat(inputR.value);
            if (!isNaN(val) && val > 0) {
                filletMemory.radius = val;
                window.updateFilletPhantom();
            }
        });

        inputR.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                window.applyFillet();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                window.cancelFilletUI();
            }
        });
    }

    window.updateFilletPhantom();
};

window.renderFilletCadDimensions = function() {
    const svgOverlay = document.getElementById('rect-cad-svg');
    const hudContainer = document.getElementById('rect-cad-hud');
    const badgeW = document.getElementById('rect-badge-w');
    const badgeH = document.getElementById('rect-badge-h');
    const badgeHint = document.getElementById('rect-badge-hint');

    if (badgeW) badgeW.style.display = 'none';
    if (badgeH) badgeH.style.display = 'none';

    if (!svgOverlay) return;

    if (!activeFilletCorner || typeof sketchTool === 'undefined' || sketchTool !== 'fillet') {
        if (typeof sketchTool !== 'undefined' && sketchTool === 'fillet') {
            svgOverlay.innerHTML = '';
            if (hudContainer) hudContainer.style.display = 'none';
            if (badgeHint) badgeHint.style.display = 'none';
        }
        return;
    }

    if (hudContainer) hudContainer.style.display = 'block';
    if (badgeHint) {
        badgeHint.style.display = 'block';
        badgeHint.innerHTML = '<kbd>R</kbd> радиус сопряжения • <kbd>Enter</kbd> применить • <kbd>Esc</kbd> отмена';
    }

    const { vertex, dir1, maxD1, dir2, maxD2 } = activeFilletCorner;
    const R = filletMemory.radius;

    const res = window.calculateFilletArc(vertex, dir1, dir2, R);
    if (!res) {
        svgOverlay.innerHTML = '';
        return;
    }

    const { P1, P2, d, arcPoints, center } = res;

    const sV = window.projectWorldToScreen(vertex);
    const sP1 = window.projectWorldToScreen(P1);
    const sP2 = window.projectWorldToScreen(P2);

    if (!sV.visible && !sP1.visible && !sP2.visible) {
        svgOverlay.innerHTML = '';
        return;
    }

    let svgHtml = '';

    // Линия радиуса к середине дуги
    const arcMidPt = arcPoints && arcPoints.length ? arcPoints[Math.floor(arcPoints.length / 2)] : vertex;
    const sArcMid = window.projectWorldToScreen(arcMidPt);
    const sC = window.projectWorldToScreen(center);

    if (sArcMid && sC && (sArcMid.visible || sC.visible)) {
        svgHtml += `<line x1="${sC.x}" y1="${sC.y}" x2="${sArcMid.x}" y2="${sArcMid.y}" stroke="#10B981" stroke-width="1.5" stroke-dasharray="3 2" opacity="0.85" />`;
        svgHtml += `<circle cx="${sC.x}" cy="${sC.y}" r="3.5" fill="#10B981" />`;
    }

    svgOverlay.innerHTML = svgHtml;

    const groupR = document.getElementById('fillet-input-group-r');

    if (groupR && sArcMid) {
        groupR.style.left = `${sArcMid.x}px`;
        groupR.style.top = `${sArcMid.y - 20}px`;
        groupR.style.transform = `translate(-50%, -50%)`;
    }
};

window.removeFilletInputs = function() {
    const overlay = document.getElementById('fillet-overlay-ui');
    if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
    }
    const svgOverlay = document.getElementById('rect-cad-svg');
    if (svgOverlay) svgOverlay.innerHTML = '';
    const badgeW = document.getElementById('rect-badge-w');
    const badgeH = document.getElementById('rect-badge-h');
    if (badgeW) badgeW.style.display = 'none';
    if (badgeH) badgeH.style.display = 'none';
    const hudContainer = document.getElementById('rect-cad-hud');
    if (hudContainer && typeof sketchTool !== 'undefined' && sketchTool === 'fillet') {
        hudContainer.style.display = 'none';
    }
    const badgeHint = document.getElementById('rect-badge-hint');
    if (badgeHint && typeof sketchTool !== 'undefined' && sketchTool === 'fillet') {
        badgeHint.style.display = 'none';
    }
};

window.updateFilletUIOverlay = function() {
    window.renderFilletCadDimensions();
};

/**
 * Отрисовка фантома сопряжения (живой предпросмотр)
 */
window.updateFilletPhantom = function() {
    if (!activeFilletCorner || typeof sketchTool === 'undefined' || sketchTool !== 'fillet') {
        if (filletPhantomMesh) filletPhantomMesh.visible = false;
        return;
    }

    const { vertex, dir1, maxD1, dir2, maxD2 } = activeFilletCorner;
    const R = filletMemory.radius;

    const groupR = document.getElementById('fillet-input-group-r');

    const res = window.calculateFilletArc(vertex, dir1, dir2, R);
    const isRValid = res && res.d > 0 && res.d < maxD1 && res.d < maxD2;

    if (groupR) groupR.className = isRValid ? 'cad-dim-badge extension active sketch-chamfer-input-group' : 'cad-dim-badge topology active sketch-chamfer-input-group error';

    if (!filletPhantomMesh) {
        filletPhantomMesh = new THREE.Group();

        // 1. Дуга сопряжения (синяя сплошная)
        const arcGeo = new THREE.BufferGeometry();
        const arcMat = new THREE.LineBasicMaterial({ color: 0x2563EB, linewidth: 3, depthTest: false });
        const arcLine = new THREE.Line(arcGeo, arcMat);
        arcLine.name = 'filletArcLine';
        arcLine.renderOrder = 9999;
        filletPhantomMesh.add(arcLine);

        // 2. Хвосты усечения (красный пунктир)
        const tailsGeo = new THREE.BufferGeometry();
        const tailsMat = new THREE.LineDashedMaterial({ color: 0xEF4444, linewidth: 2, dashSize: 2, gapSize: 2, depthTest: false, transparent: true, opacity: 0.85 });
        const tailsLine = new THREE.LineSegments(tailsGeo, tailsMat);
        tailsLine.name = 'filletTailsLine';
        tailsLine.renderOrder = 9999;
        filletPhantomMesh.add(tailsLine);

        if (typeof sketchGroup !== 'undefined' && sketchGroup) {
            sketchGroup.add(filletPhantomMesh);
        }
    }

    if (!isRValid || !res) {
        filletPhantomMesh.visible = false;
        return;
    }

    const arcLine = filletPhantomMesh.getObjectByName('filletArcLine');
    if (arcLine) {
        arcLine.geometry.dispose();
        arcLine.geometry = new THREE.BufferGeometry().setFromPoints(res.arcPoints);
    }

    const tailsLine = filletPhantomMesh.getObjectByName('filletTailsLine');
    if (tailsLine) {
        tailsLine.geometry.dispose();
        tailsLine.geometry = new THREE.BufferGeometry().setFromPoints([vertex, res.P1, vertex, res.P2]);
        tailsLine.computeLineDistances();
    }

    filletPhantomMesh.visible = true;
    window.updateFilletUIOverlay();
};

window.cancelFilletUI = function() {
    window.removeFilletInputs();
    if (filletPhantomMesh) filletPhantomMesh.visible = false;
    activeFilletCorner = null;
    if (typeof activeSmartSnap !== 'undefined' && activeSmartSnap && (activeSmartSnap.label === 'Выбран угол' || activeSmartSnap.label === 'Угол (Сопряжение)')) {
        activeSmartSnap = null;
    }
    if (typeof sketchHudTooltip !== 'undefined' && sketchHudTooltip) {
        if (sketchTool === 'fillet') {
            sketchHudTooltip.innerText = '[ Сопряжение: Укажите угол ]';
        }
    }
};

/**
 * Применение сопряжения к топологии эскиза
 */
window.applyFillet = function() {
    if (!activeFilletCorner) return false;

    const { vertex, seg1, type1, dir1, seg2, type2, dir2, maxD1, maxD2 } = activeFilletCorner;
    const R = filletMemory.radius;

    const res = window.calculateFilletArc(vertex, dir1, dir2, R);
    if (!res || res.d <= 1e-4) return false;

    if (res.d >= maxD1 || res.d >= maxD2) {
        if (typeof showToast === 'function') {
            showToast("Ошибка: радиус сопряжения слишком велик для отрезков!");
        }
        return false;
    }

    // 1. Модификация отрезка 1
    if (type1 === 'start') {
        seg1.start.copy(res.P1);
    } else {
        seg1.end.copy(res.P1);
    }

    // 2. Модификация отрезка 2
    if (type2 === 'start') {
        seg2.start.copy(res.P2);
    } else {
        seg2.end.copy(res.P2);
    }

    // 3. Вставка сегментов дуги сопряжения в массив sketchSegments
    for (let i = 0; i < res.arcPoints.length - 1; i++) {
        sketchSegments.push({
            start: res.arcPoints[i].clone(),
            end: res.arcPoints[i + 1].clone()
        });
    }

    // 4. Обновление графики эскиза
    if (typeof window.rebuildSketchLines === 'function') {
        window.rebuildSketchLines();
    }

    // Очищаем текущий активный угол
    window.cancelFilletUI();

    if (typeof showToast === 'function') {
        showToast(`Сопряжение построено: R=${R} мм`);
    }

    return true;
};

window.handleFilletClick = function() {
    if (typeof sketchTool === 'undefined' || sketchTool !== 'fillet') return false;

    if (hoverFilletCorner) {
        if (activeFilletCorner && activeFilletCorner !== hoverFilletCorner) {
            window.applyFillet();
        }

        activeFilletCorner = hoverFilletCorner;
        window.renderFilletInputs(activeFilletCorner);

        if (typeof sketchHudTooltip !== 'undefined' && sketchHudTooltip) {
            sketchHudTooltip.innerText = '[ Сопряжение: Укажите следующий угол ]';
        }

        return true;
    }

    if (activeFilletCorner) {
        window.applyFillet();
        return true;
    }

    return false;
};

/* =========================================================
 * Блок Топологии: Зеркальное Отражение Эскиза (Mirror Tool)
 * ========================================================= */

let mirrorGroup = null;
let mirrorPhase = 0; // 0: box/object selection, 1: specify axis pt 1, 2: specify axis pt 2
let mirrorBoxStartPt = null;
let mirrorBoxCurrentPt = null;
let isMirrorHoldStarted = false;
let isBoxSelecting = false;
let justFinishedBoxDrag = false;
let mirrorHoldTimer = null;
let selectedMirrorSegments = [];
let selectedMirrorCircles = [];
let mirrorAxisPt1 = null;
let mirrorAxisPt2 = null;
let wasMirrorHoldSuccessful = false;
let ignoreNextMirrorClick = false;

window.MIRROR_FSM = {
    IDLE: 0,
    HOLDING: 1,
    DRAGGING_GHOST: 2,
    COMMIT: 3
};
window.mirrorFSMState = window.MIRROR_FSM.IDLE;
window.justCommittedMirror = false;

let mirrorHoldAnimFrame = null;
let mirrorHoldStartTime = 0;
let isMirrorHolding = false;
const MIRROR_HOLD_DURATION = 450;

window.startMirrorHoldProgress = function(x, y) {
    window.stopMirrorHoldProgress();
    mirrorHoldStartTime = Date.now();
    isMirrorHolding = true;

    const holdRing = document.getElementById('rect-hold-ring');
    const holdCircle = document.getElementById('rect-hold-circle');
    if (!holdRing || !holdCircle) return;

    holdCircle.setAttribute('stroke', '#2563EB');
    holdCircle.style.stroke = '#2563EB';
    holdRing.style.display = 'block';
    holdRing.style.left = `${x}px`;
    holdRing.style.top = `${y}px`;

    const totalDash = 163.36;
    holdCircle.style.strokeDashoffset = totalDash.toString();

    function animateHold() {
        if (!isMirrorHolding) return;
        const elapsed = Date.now() - mirrorHoldStartTime;
        const progress = Math.min(1, elapsed / MIRROR_HOLD_DURATION);

        holdCircle.style.strokeDashoffset = (totalDash * (1 - progress)).toString();

        if (progress < 1) {
            mirrorHoldAnimFrame = requestAnimationFrame(animateHold);
        }
    }
    mirrorHoldAnimFrame = requestAnimationFrame(animateHold);
};

window.stopMirrorHoldProgress = function() {
    isMirrorHolding = false;
    if (mirrorHoldAnimFrame) {
        cancelAnimationFrame(mirrorHoldAnimFrame);
        mirrorHoldAnimFrame = null;
    }
    const holdRing = document.getElementById('rect-hold-ring');
    if (holdRing) holdRing.style.display = 'none';
};

window.getMirrorGroup = function() {
    if (!mirrorGroup) {
        mirrorGroup = new THREE.Group();
        mirrorGroup.name = 'mirrorGroup';
        mirrorGroup.renderOrder = 35;
        if (typeof creatorScene !== 'undefined' && creatorScene) {
            creatorScene.add(mirrorGroup);
        }
    }
    return mirrorGroup;
};

window.clearMirrorPhantoms = function() {
    if (mirrorGroup) {
        while (mirrorGroup.children.length > 0) {
            const child = mirrorGroup.children.pop();
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        }
        mirrorGroup.visible = false;
    }
};

window.resetMirrorState = function() {
    window.mirrorFSMState = window.MIRROR_FSM.IDLE;
    window.justCommittedMirror = false;
    wasMirrorHoldSuccessful = false;
    ignoreNextMirrorClick = false;
    mirrorPhase = 0;
    mirrorBoxStartPt = null;
    mirrorBoxCurrentPt = null;
    isMirrorHoldStarted = false;
    isBoxSelecting = false;
    justFinishedBoxDrag = false;
    selectedMirrorSegments = [];
    selectedMirrorCircles = [];
    mirrorAxisPt1 = null;
    mirrorAxisPt2 = null;
    window.hoveredMirrorBaseAxis = null;
    if (typeof window.clearBaseAxisHoverHighlight === 'function') window.clearBaseAxisHoverHighlight();
    if (mirrorHoldTimer) {
        clearTimeout(mirrorHoldTimer);
        mirrorHoldTimer = null;
    }
    window.stopMirrorHoldProgress();
    window.clearMirrorPhantoms();
    if (typeof creatorControls !== 'undefined' && creatorControls) {
        creatorControls.enabled = true;
    }
    if (typeof sketchHudTooltip !== 'undefined' && sketchHudTooltip && typeof sketchTool !== 'undefined' && sketchTool === 'mirror') {
        sketchHudTooltip.innerText = '[ Зеркало: Выберите объекты (клик/рамка) или кликните по базовой оси / укажите 2 точки осей ]';
    }
};

function reflectPoint2D(p2d, a2d, b2d) {
    const du = b2d.u - a2d.u;
    const dv = b2d.v - a2d.v;
    const lenSq = du * du + dv * dv;
    if (lenSq < 1e-8) return { u: p2d.u, v: p2d.v };

    const relU = p2d.u - a2d.u;
    const relV = p2d.v - a2d.v;
    const proj = (relU * du + relV * dv) / lenSq;

    const closestU = a2d.u + proj * du;
    const closestV = a2d.v + proj * dv;

    return {
        u: 2 * closestU - p2d.u,
        v: 2 * closestV - p2d.v
    };
}

// Вспомогательные функции геометрии для рамки выделения
function segmentsIntersect2D(p1, p2, p3, p4) {
    const denom = (p4.v - p3.v) * (p2.u - p1.u) - (p4.u - p3.u) * (p2.v - p1.v);
    if (Math.abs(denom) < 1e-9) return false;
    const ua = ((p4.u - p3.u) * (p1.v - p3.v) - (p4.v - p3.v) * (p1.u - p3.u)) / denom;
    const ub = ((p2.u - p1.u) * (p1.v - p3.v) - (p2.v - p1.v) * (p1.u - p3.u)) / denom;
    return (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1);
}

function lineSegmentIntersectsBox2D(p1, p2, minU, maxU, minV, maxV) {
    // 1. Конец отрезка внутри прямоугольной рамки
    if (p1.u >= minU && p1.u <= maxU && p1.v >= minV && p1.v <= maxV) return true;
    if (p2.u >= minU && p2.u <= maxU && p2.v >= minV && p2.v <= maxV) return true;

    // 2. Отрезок пересекает хотя бы одну из 4 граней рамки
    const corners = [
        { u: minU, v: minV },
        { u: maxU, v: minV },
        { u: maxU, v: maxV },
        { u: minU, v: maxV }
    ];
    for (let i = 0; i < 4; i++) {
        if (segmentsIntersect2D(p1, p2, corners[i], corners[(i + 1) % 4])) {
            return true;
        }
    }
    return false;
}

function circleIntersectsBox2D(center, radius, minU, maxU, minV, maxV) {
    const clampU = Math.max(minU, Math.min(center.u, maxU));
    const clampV = Math.max(minV, Math.min(center.v, maxV));
    const du = center.u - clampU;
    const dv = center.v - clampV;
    return (du * du + dv * dv) <= (radius * radius);
}

window.renderMirrorGroup = function(pStart, pCurr) {
    const group = window.getMirrorGroup();
    window.clearMirrorPhantoms();
    if (typeof activeSketchPlane === 'undefined' || !activeSketchPlane) return;

    group.visible = true;
    const basis = window.getPlaneBasis(activeSketchPlane);

    // 1. Синяя рамка выделения (пока тянется ЛКМ)
    if (pStart && pCurr) {
        const u1 = window.project3Dto2D(pStart, basis);
        const u2 = window.project3Dto2D(pCurr, basis);

        const pt1 = window.project2Dto3D(u1.u, u1.v, basis);
        const pt2 = window.project2Dto3D(u2.u, u1.v, basis);
        const pt3 = window.project2Dto3D(u2.u, u2.v, basis);
        const pt4 = window.project2Dto3D(u1.u, u2.v, basis);

        // Синий контур
        const boxPoints = [pt1, pt2, pt3, pt4, pt1];
        const lineGeo = new THREE.BufferGeometry().setFromPoints(boxPoints);
        const lineMat = new THREE.LineBasicMaterial({ color: 0x3B82F6, linewidth: 2, depthTest: false });
        const boxLine = new THREE.Line(lineGeo, lineMat);
        group.add(boxLine);

        // Полупрозрачная синяя заливка
        const fillGeo = new THREE.BufferGeometry();
        const verts = new Float32Array([
            pt1.x, pt1.y, pt1.z,  pt2.x, pt2.y, pt2.z,  pt3.x, pt3.y, pt3.z,
            pt1.x, pt1.y, pt1.z,  pt3.x, pt3.y, pt3.z,  pt4.x, pt4.y, pt4.z
        ]);
        fillGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
        const fillMat = new THREE.MeshBasicMaterial({ color: 0x3B82F6, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthTest: false });
        const fillMesh = new THREE.Mesh(fillGeo, fillMat);
        group.add(fillMesh);
    }

    // 2. Зеленая подсветка выделенных объектов
    selectedMirrorSegments.forEach(seg => {
        if (!seg || !seg.start || !seg.end) return;
        const lineGeo = new THREE.BufferGeometry().setFromPoints([seg.start, seg.end]);
        const lineMat = new THREE.LineBasicMaterial({ color: 0x10B981, linewidth: 3, depthTest: false });
        const lineMesh = new THREE.Line(lineGeo, lineMat);
        group.add(lineMesh);
    });

    selectedMirrorCircles.forEach(circ => {
        if (!circ || !circ.center) return;
        const curve = new THREE.EllipseCurve(
            0, 0,
            circ.radius, circ.radius,
            0, 2 * Math.PI,
            false, 0
        );
        const pts2d = curve.getPoints(64);
        const c2d = window.project3Dto2D(circ.center, basis);
        const final3d = pts2d.map(p => window.project2Dto3D(c2d.u + p.x, c2d.v + p.y, basis));

        const circGeo = new THREE.BufferGeometry().setFromPoints(final3d);
        const circMat = new THREE.LineBasicMaterial({ color: 0x10B981, linewidth: 3, depthTest: false });
        const circMesh = new THREE.Line(circGeo, circMat);
        group.add(circMesh);
    });
};

window.renderMirrorAxisAndGhostPreview = function(axis1, cursorPt) {
    window.renderMirrorGroup(); // Re-render selected primitives in green
    const group = window.getMirrorGroup();
    if (typeof activeSketchPlane === 'undefined' || !activeSketchPlane || !axis1 || !cursorPt) return;

    const basis = window.getPlaneBasis(activeSketchPlane);

    // 1. Пунктирная ось отзеркаливания (продленная как бесконечная прямая через axis1 и cursorPt)
    let extStart = axis1.clone();
    let extEnd = cursorPt.clone();
    const len = axis1.distanceTo(cursorPt);
    if (len > 0.0001) {
        const dir = cursorPt.clone().sub(axis1).multiplyScalar(1 / len);
        extStart = axis1.clone().sub(dir.clone().multiplyScalar(2000));
        extEnd = cursorPt.clone().add(dir.clone().multiplyScalar(2000));
    }
    const axisGeo = new THREE.BufferGeometry().setFromPoints([extStart, extEnd]);
    const axisMat = new THREE.LineDashedMaterial({ color: 0x2563EB, dashSize: 4, gapSize: 2, depthTest: false });
    const axisLine = new THREE.Line(axisGeo, axisMat);
    axisLine.computeLineDistances();
    group.add(axisLine);

    // Точки на оси
    [axis1, cursorPt].forEach(p => {
        const dotGeo = new THREE.CircleGeometry(2, 16);
        const dotMat = new THREE.MeshBasicMaterial({ color: 0x2563EB, side: THREE.DoubleSide, depthTest: false });
        const dotMesh = new THREE.Mesh(dotGeo, dotMat);
        dotMesh.position.copy(p);
        if (activeSketchPlane) alignToPlane(dotMesh, activeSketchPlane);
        group.add(dotMesh);
    });

    // 2. Фантом отзеркаленных объектов
    const a2d = window.project3Dto2D(axis1, basis);
    const b2d = window.project3Dto2D(cursorPt, basis);

    const segsToMirror = (selectedMirrorSegments && selectedMirrorSegments.length > 0)
        ? selectedMirrorSegments
        : (typeof sketchSegments !== 'undefined' ? sketchSegments : []);
    const circsToMirror = (selectedMirrorCircles && selectedMirrorCircles.length > 0)
        ? selectedMirrorCircles
        : (typeof sketchCircles !== 'undefined' ? sketchCircles : []);

    segsToMirror.forEach(seg => {
        if (!seg || !seg.start || !seg.end) return;
        const p1_2d = window.project3Dto2D(seg.start, basis);
        const p2_2d = window.project3Dto2D(seg.end, basis);

        const r1_2d = reflectPoint2D(p1_2d, a2d, b2d);
        const r2_2d = reflectPoint2D(p2_2d, a2d, b2d);

        const gStart = window.project2Dto3D(r1_2d.u, r1_2d.v, basis);
        const gEnd = window.project2Dto3D(r2_2d.u, r2_2d.v, basis);

        const ghostGeo = new THREE.BufferGeometry().setFromPoints([gStart, gEnd]);
        const ghostMat = new THREE.LineDashedMaterial({ color: 0x059669, dashSize: 3, gapSize: 2, depthTest: false });
        const ghostLine = new THREE.Line(ghostGeo, ghostMat);
        ghostLine.computeLineDistances();
        group.add(ghostLine);
    });

    circsToMirror.forEach(circ => {
        if (!circ || !circ.center) return;
        const c_2d = window.project3Dto2D(circ.center, basis);
        const rc_2d = reflectPoint2D(c_2d, a2d, b2d);

        const curve = new THREE.EllipseCurve(0, 0, circ.radius, circ.radius, 0, 2 * Math.PI, false, 0);
        const pts2d = curve.getPoints(64);
        const final3d = pts2d.map(p => window.project2Dto3D(rc_2d.u + p.x, rc_2d.v + p.y, basis));

        const ghostGeo = new THREE.BufferGeometry().setFromPoints(final3d);
        const ghostMat = new THREE.LineDashedMaterial({ color: 0x059669, dashSize: 3, gapSize: 2, depthTest: false });
        const ghostLine = new THREE.Line(ghostGeo, ghostMat);
        ghostLine.computeLineDistances();
        group.add(ghostLine);
    });
};

window.updateMirrorSelectionBox = function(pStart, pCurr) {
    if (typeof activeSketchPlane === 'undefined' || !activeSketchPlane) return;
    const basis = window.getPlaneBasis(activeSketchPlane);
    const u1 = window.project3Dto2D(pStart, basis);
    const u2 = window.project3Dto2D(pCurr, basis);

    const minU = Math.min(u1.u, u2.u);
    const maxU = Math.max(u1.u, u2.u);
    const minV = Math.min(u1.v, u2.v);
    const maxV = Math.max(u1.v, u2.v);

    selectedMirrorSegments = [];
    selectedMirrorCircles = [];

    if (typeof sketchSegments !== 'undefined' && sketchSegments) {
        sketchSegments.forEach(seg => {
            if (!seg || !seg.start || !seg.end) return;
            const p1 = window.project3Dto2D(seg.start, basis);
            const p2 = window.project3Dto2D(seg.end, basis);

            if (lineSegmentIntersectsBox2D(p1, p2, minU, maxU, minV, maxV)) {
                selectedMirrorSegments.push(seg);
            }
        });
    }

    if (typeof sketchCircles !== 'undefined' && sketchCircles) {
        sketchCircles.forEach(circ => {
            if (!circ || !circ.center) return;
            const c = window.project3Dto2D(circ.center, basis);
            const r = circ.radius || 0;

            if (circleIntersectsBox2D(c, r, minU, maxU, minV, maxV)) {
                selectedMirrorCircles.push(circ);
            }
        });
    }

    window.renderMirrorGroup(pStart, pCurr);
};

window.activeMirrorLines = window.activeMirrorLines || [];
let activeMirrorLinesGroup = null;
window.hoveredMirrorBaseAxis = null;
let baseAxisHoverGroup = null;

window.getPxDist = function(pt3d) {
    if (!pt3d || typeof currentCreatorCamera === 'undefined' || !currentCreatorCamera) return 999999;
    const canvas = (typeof creatorRenderer !== 'undefined' && creatorRenderer) ? creatorRenderer.domElement : null;
    if (!canvas) return 999999;
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;
    if (typeof sketchMouse === 'undefined' || !sketchMouse) return 999999;
    const mousePx = {
        x: (sketchMouse.x * 0.5 + 0.5) * w,
        y: (-sketchMouse.y * 0.5 + 0.5) * h
    };
    const pr = pt3d.clone().project(currentCreatorCamera);
    if (pr.z < -1 || pr.z > 1) return 999999;
    const px = (pr.x * 0.5 + 0.5) * w;
    const py = (-pr.y * 0.5 + 0.5) * h;
    return Math.hypot(px - mousePx.x, py - mousePx.y);
};

window.clearBaseAxisHoverHighlight = function() {
    if (baseAxisHoverGroup) {
        while (baseAxisHoverGroup.children.length > 0) {
            const child = baseAxisHoverGroup.children.pop();
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        }
    }
};

window.renderBaseAxisHoverHighlight = function(axisType, basis) {
    if (typeof sketchGroup === 'undefined' || !sketchGroup) return;
    if (!baseAxisHoverGroup) {
        baseAxisHoverGroup = new THREE.Group();
        baseAxisHoverGroup.name = 'baseAxisHoverGroup';
        sketchGroup.add(baseAxisHoverGroup);
    } else {
        window.clearBaseAxisHoverHighlight();
    }

    const dir = (axisType === 'X') ? basis.right : basis.up;
    const p1 = basis.origin.clone().sub(dir.clone().multiplyScalar(1000));
    const p2 = basis.origin.clone().add(dir.clone().multiplyScalar(1000));

    // Подсветка при наведении на базовую ось
    const lineGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x06B6D4, linewidth: 3, depthTest: false });
    const lineMesh = new THREE.Line(lineGeo, lineMat);
    lineMesh.renderOrder = 20;
    baseAxisHoverGroup.add(lineMesh);

    // Маркер точки 0 (начало координат)
    const dotGeo = new THREE.CircleGeometry(2.5, 16);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0x06B6D4, side: THREE.DoubleSide, depthTest: false });
    const dotMesh = new THREE.Mesh(dotGeo, dotMat);
    dotMesh.position.copy(basis.origin);
    if (activeSketchPlane) alignToPlane(dotMesh, activeSketchPlane);
    dotMesh.renderOrder = 21;
    baseAxisHoverGroup.add(dotMesh);
};

window.renderActiveMirrorLines = function() {
    if (typeof isSketchMode === 'undefined' || !isSketchMode || !window.activeMirrorLines || window.activeMirrorLines.length === 0) {
        const badges = document.querySelectorAll('.active-mirror-badge');
        badges.forEach(b => b.remove());
        if (activeMirrorLinesGroup) {
            while (activeMirrorLinesGroup.children.length > 0) {
                const child = activeMirrorLinesGroup.children.pop();
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            }
        }
        return;
    }

    if (typeof sketchGroup === 'undefined' || !sketchGroup) return;

    if (!activeMirrorLinesGroup) {
        activeMirrorLinesGroup = new THREE.Group();
        activeMirrorLinesGroup.name = 'activeMirrorLinesGroup';
        sketchGroup.add(activeMirrorLinesGroup);
    } else {
        while (activeMirrorLinesGroup.children.length > 0) {
            const child = activeMirrorLinesGroup.children.pop();
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        }
    }

    window.activeMirrorLines.forEach(axis => {
        if (axis.isBaseAxis) {
            // Более толстая линия для базовой оси-зеркала
            const lineGeo = new THREE.BufferGeometry().setFromPoints([axis.pt1, axis.pt2]);
            const lineMat = new THREE.LineBasicMaterial({ color: 0x2563EB, linewidth: 4, depthTest: false });
            const lineMesh = new THREE.Line(lineGeo, lineMat);
            lineMesh.renderOrder = 12;
            activeMirrorLinesGroup.add(lineMesh);

            const lineGeo2 = new THREE.BufferGeometry().setFromPoints([axis.pt1, axis.pt2]);
            const lineMat2 = new THREE.LineDashedMaterial({ color: 0x0284C7, dashSize: 6, gapSize: 3, depthTest: false });
            const lineMesh2 = new THREE.Line(lineGeo2, lineMat2);
            lineMesh2.computeLineDistances();
            lineMesh2.renderOrder = 13;
            activeMirrorLinesGroup.add(lineMesh2);

            // Точка 0 в центре
            if (axis.origin3d) {
                const dotGeo = new THREE.CircleGeometry(2.5, 16);
                const dotMat = new THREE.MeshBasicMaterial({ color: 0x0284C7, side: THREE.DoubleSide, depthTest: false });
                const dotMesh = new THREE.Mesh(dotGeo, dotMat);
                dotMesh.position.copy(axis.origin3d);
                if (axis.plane) alignToPlane(dotMesh, axis.plane);
                dotMesh.renderOrder = 14;
                activeMirrorLinesGroup.add(dotMesh);
            }
        } else {
            // Пунктирная синяя линия стандартной оси зеркала (продленная как бесконечная прямая через pt1 и pt2)
            let extStart = axis.pt1.clone();
            let extEnd = axis.pt2.clone();
            const len = axis.pt1.distanceTo(axis.pt2);
            if (len > 0.0001) {
                const dir = axis.pt2.clone().sub(axis.pt1).multiplyScalar(1 / len);
                extStart = axis.pt1.clone().sub(dir.clone().multiplyScalar(2000));
                extEnd = axis.pt2.clone().add(dir.clone().multiplyScalar(2000));
            }

            const lineGeo = new THREE.BufferGeometry().setFromPoints([extStart, extEnd]);
            const lineMat = new THREE.LineDashedMaterial({ color: 0x2563EB, dashSize: 4, gapSize: 2, depthTest: false });
            const lineMesh = new THREE.Line(lineGeo, lineMat);
            lineMesh.computeLineDistances();
            lineMesh.renderOrder = 10;
            activeMirrorLinesGroup.add(lineMesh);

            // Точки на оси в местах определения (pt1 и pt2)
            [axis.pt1, axis.pt2].forEach(pt => {
                const dotGeo = new THREE.CircleGeometry(2, 16);
                const dotMat = new THREE.MeshBasicMaterial({ color: 0x2563EB, side: THREE.DoubleSide, depthTest: false });
                const dotMesh = new THREE.Mesh(dotGeo, dotMat);
                dotMesh.position.copy(pt);
                if (axis.plane) alignToPlane(dotMesh, axis.plane);
                dotMesh.renderOrder = 11;
                activeMirrorLinesGroup.add(dotMesh);
            });
        }

        // HTML-плашка с наименованием и крестиком удаления
        let badge = document.getElementById(`mirror-badge-${axis.id}`);
        if (!badge) {
            badge = document.createElement('div');
            badge.id = `mirror-badge-${axis.id}`;
            badge.className = 'active-mirror-badge';
            badge.style.position = 'fixed';
            badge.style.zIndex = '10020';
            badge.style.transform = 'translate(0, -100%)';
            badge.style.background = '#FFFFFF';
            badge.style.color = '#1E40AF';
            badge.style.border = '1px solid #3B82F6';
            badge.style.borderRadius = '12px';
            badge.style.padding = '3px 10px';
            badge.style.fontSize = '12px';
            badge.style.fontWeight = '600';
            badge.style.fontFamily = 'system-ui, -apple-system, sans-serif';
            badge.style.cursor = 'default';
            badge.style.display = 'flex';
            badge.style.alignItems = 'center';
            badge.style.gap = '6px';
            badge.style.boxShadow = '0 2px 10px rgba(37, 99, 235, 0.18)';
            badge.style.pointerEvents = 'auto';

            const badgeLabel = axis.name || (axis.isBaseAxis ? `Базовая ось ${axis.axisType || ''}` : 'Зеркало');
            const btnTitle = axis.isBaseAxis ? 'Снять функцию зеркала' : 'Удалить ось-зеркало';

            badge.innerHTML = `
                <span style="user-select:none; display:inline-flex; align-items:center; gap:4px;">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2563EB" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M5 7l14 10M19 7L5 17"/></svg>
                    ${badgeLabel}
                </span>
                <button class="mirror-del-btn" title="${btnTitle}" style="background:#EF4444; color:#FFFFFF; border:none; border-radius:50%; width:16px; height:16px; font-size:11px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; line-height:1; font-weight:bold; padding:0; margin-left:2px;">✕</button>
            `;

            const btn = badge.querySelector('.mirror-del-btn');
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                ev.preventDefault();
                window.deleteActiveMirrorLine(axis.id);
            });

            document.body.appendChild(badge);
        }
    });

    const allBadges = document.querySelectorAll('.active-mirror-badge');
    allBadges.forEach(b => {
        const id = b.id.replace('mirror-badge-', '');
        if (!window.activeMirrorLines.some(a => a.id === id)) {
            b.remove();
        }
    });

    window.updateActiveMirrorBadges();
};

window.deleteActiveMirrorLine = function(id) {
    if (!window.activeMirrorLines) return;
    const idx = window.activeMirrorLines.findIndex(a => a.id === id);
    if (idx !== -1) {
        const removed = window.activeMirrorLines.splice(idx, 1)[0];
        const badge = document.getElementById(`mirror-badge-${id}`);
        if (badge) badge.remove();
        window.renderActiveMirrorLines();
        if (typeof showToast === 'function') {
            const labelStr = (removed && removed.isBaseAxis) ? `Базовая ось ${removed.axisType || ''}` : 'Отрезок-зеркало';
            showToast(`${labelStr} отключен`);
        }
    }
};

window.updateActiveMirrorBadges = function() {
    if (typeof isSketchMode === 'undefined' || !isSketchMode || !window.activeMirrorLines || window.activeMirrorLines.length === 0) {
        const badges = document.querySelectorAll('.active-mirror-badge');
        badges.forEach(b => b.remove());
        return;
    }
    if (typeof currentCreatorCamera === 'undefined' || typeof creatorRenderer === 'undefined' || !currentCreatorCamera || !creatorRenderer) return;

    window.activeMirrorLines.forEach(axis => {
        const badge = document.getElementById(`mirror-badge-${axis.id}`);
        if (!badge) return;

        // Плашка отображается около первой точки (pt1) или около точки 0 (origin3d) для базовой оси
        const target3d = (axis.isBaseAxis && axis.origin3d) ? axis.origin3d : axis.pt1;
        if (!target3d) return;

        const proj = target3d.clone().project(currentCreatorCamera);

        if (proj.z > 1) {
            badge.style.display = 'none';
            return;
        }

        const rect = creatorRenderer.domElement.getBoundingClientRect();
        const x = (proj.x * 0.5 + 0.5) * rect.width + rect.left + 22;
        const y = (-proj.y * 0.5 + 0.5) * rect.height + rect.top - 18;

        badge.style.left = `${x}px`;
        badge.style.top = `${y}px`;
        badge.style.display = 'flex';
    });
};

window.autoMirrorPrimitive = function(type, prim, skipRebuild = false) {
    if (!window.activeMirrorLines || window.activeMirrorLines.length === 0) return;
    if (prim._fromAutoMirror) return;
    if (typeof activeSketchPlane === 'undefined' || !activeSketchPlane) return;

    const basis = window.getPlaneBasis(activeSketchPlane);
    if (!basis) return;

    let itemsToReflect = [prim];
    let createdNewItems = [];

    window.activeMirrorLines.forEach(axis => {
        if (!axis || !axis.pt1 || !axis.pt2) return;
        const a2d = window.project3Dto2D(axis.pt1, basis);
        const b2d = window.project3Dto2D(axis.pt2, basis);
        const newForThisAxis = [];

        itemsToReflect.forEach(item => {
            if (type === 'segment') {
                if (!item.start || !item.end) return;
                const p1_2d = window.project3Dto2D(item.start, basis);
                const p2_2d = window.project3Dto2D(item.end, basis);

                const r1_2d = reflectPoint2D(p1_2d, a2d, b2d);
                const r2_2d = reflectPoint2D(p2_2d, a2d, b2d);

                const newStart = window.project2Dto3D(r1_2d.u, r1_2d.v, basis);
                const newEnd = window.project2Dto3D(r2_2d.u, r2_2d.v, basis);

                if (newStart.distanceTo(newEnd) < 1e-4) return;

                const distDirect = newStart.distanceTo(item.start) + newEnd.distanceTo(item.end);
                const distFlipped = newStart.distanceTo(item.end) + newEnd.distanceTo(item.start);
                if (distDirect < 1e-3 || distFlipped < 1e-3) return;

                const mirroredSeg = {
                    start: newStart,
                    end: newEnd,
                    isInfinite: item.isInfinite,
                    color: item.color,
                    _fromAutoMirror: true
                };
                newForThisAxis.push(mirroredSeg);
            } else if (type === 'circle') {
                if (!item.center) return;
                const c_2d = window.project3Dto2D(item.center, basis);
                const rc_2d = reflectPoint2D(c_2d, a2d, b2d);
                const newCenter = window.project2Dto3D(rc_2d.u, rc_2d.v, basis);

                if (newCenter.distanceTo(item.center) < 1e-3) return;

                const mirroredCirc = {
                    center: newCenter,
                    radius: item.radius,
                    _fromAutoMirror: true
                };
                newForThisAxis.push(mirroredCirc);
            }
        });

        newForThisAxis.forEach(newItem => {
            itemsToReflect.push(newItem);
            createdNewItems.push(newItem);
        });
    });

    createdNewItems.forEach(newItem => {
        if (type === 'segment' && typeof sketchSegments !== 'undefined' && sketchSegments) {
            sketchSegments.push(newItem);
        } else if (type === 'circle' && typeof sketchCircles !== 'undefined' && sketchCircles) {
            sketchCircles.push(newItem);
        }
    });

    if (!skipRebuild && typeof window.rebuildSketchLines === 'function') {
        window.rebuildSketchLines();
    }
};

window.handleMirrorCommit = function(intersectionPt, e) {
    window.justCommittedMirror = true;
    const pt = intersectionPt || (typeof getSketchPlaneIntersection === 'function' ? getSketchPlaneIntersection(sketchRaycaster, activeSketchPlane) : null);
    if (!pt) return;
    const snappedPt = typeof applySnapsAndOrtho === 'function' ? applySnapsAndOrtho(pt, true) : pt;

    if (mirrorPhase === 0) {
        // СОСТОЯНИЕ 3: COMMIT области выделения
        mirrorBoxCurrentPt = pt.clone();
        window.updateMirrorSelectionBox(mirrorBoxStartPt, mirrorBoxCurrentPt);
        isBoxSelecting = false;

        window.renderMirrorGroup(); // Синяя рамка исчезает, выделенные остаются зелеными

        mirrorPhase = 1;
        window.mirrorFSMState = window.MIRROR_FSM.IDLE;

        if (typeof sketchHudTooltip !== 'undefined' && sketchHudTooltip) {
            sketchHudTooltip.innerText = '[ Зеркало: Укажите первую точку оси ]';
        }
        if (typeof showToast === 'function') {
            showToast("Область зафиксирована. Укажите первую точку оси");
        }
    } else if (mirrorPhase === 2) {
        // СОСТОЯНИЕ 3: COMMIT оси и зеркалирование
        mirrorAxisPt2 = snappedPt.clone();
        if (mirrorAxisPt1 && mirrorAxisPt2 && mirrorAxisPt1.distanceTo(mirrorAxisPt2) > 0.001) {
            window.executeMirrorOperation(mirrorAxisPt1, mirrorAxisPt2);
        } else {
            window.resetMirrorState();
        }
        window.mirrorFSMState = window.MIRROR_FSM.IDLE;
        window.justCommittedMirror = true;
    }
};

window.handleMirrorPointerDown = function(e, pt) {
    if (typeof isSketchMode === 'undefined' || !isSketchMode || typeof sketchTool === 'undefined' || sketchTool !== 'mirror' || typeof activeSketchPlane === 'undefined' || !activeSketchPlane) return;
    if (e.button !== 0) return;

    window.lastMirrorMouseEvt = e;

    const intersectionPt = pt || (typeof getSketchPlaneIntersection === 'function' ? getSketchPlaneIntersection(sketchRaycaster, activeSketchPlane) : null);
    if (!intersectionPt) return;

    // Если находимся в СОСТОЯНИИ 2 (DRAGGING_GHOST) — клик фиксирует P2 (COMMIT)
    if (window.mirrorFSMState === window.MIRROR_FSM.DRAGGING_GHOST) {
        window.handleMirrorCommit(intersectionPt, e);
        return;
    }

    // СОСТОЯНИЕ 0: IDLE -> Зажатие ЛКМ (HOLDING)
    if (window.mirrorFSMState === window.MIRROR_FSM.IDLE) {
        if (mirrorPhase === 0) {
            if (typeof creatorControls !== 'undefined' && creatorControls) {
                creatorControls.enabled = false;
            }

            mirrorBoxStartPt = intersectionPt.clone();
            mirrorBoxCurrentPt = intersectionPt.clone();

            window.mirrorFSMState = window.MIRROR_FSM.HOLDING;
            wasMirrorHoldSuccessful = false;

            // Начать отрисовку кругового синего progress-bar вокруг курсора
            window.startMirrorHoldProgress(e.clientX, e.clientY);

            if (mirrorHoldTimer) clearTimeout(mirrorHoldTimer);
            mirrorHoldTimer = setTimeout(() => {
                // Когда таймер завершился -> СОСТОЯНИЕ 2: DRAGGING_GHOST
                if (window.mirrorFSMState === window.MIRROR_FSM.HOLDING) {
                    window.stopMirrorHoldProgress();
                    window.mirrorFSMState = window.MIRROR_FSM.DRAGGING_GHOST;
                    wasMirrorHoldSuccessful = true;
                    isBoxSelecting = true;

                    if (typeof creatorControls !== 'undefined' && creatorControls) {
                        creatorControls.enabled = true;
                    }

                    if (mirrorBoxStartPt && mirrorBoxCurrentPt) {
                        window.updateMirrorSelectionBox(mirrorBoxStartPt, mirrorBoxCurrentPt);
                    }

                    if (typeof sketchHudTooltip !== 'undefined' && sketchHudTooltip) {
                        sketchHudTooltip.innerText = '[ Зеркало: Перемещайте мышь для выбора области, нажмите ЛКМ для фиксации ]';
                    }
                }
            }, MIRROR_HOLD_DURATION);
        }
    }
};

window.updateMirrorHover = function(pt, snappedPt, mouseEvt) {
    if (typeof isSketchMode === 'undefined' || !isSketchMode || typeof sketchTool === 'undefined' || sketchTool !== 'mirror' || typeof activeSketchPlane === 'undefined' || !activeSketchPlane) return;

    if (mouseEvt) window.lastMirrorMouseEvt = mouseEvt;

    // СОСТОЯНИЕ 1: HOLDING -> обновить положение синего круга загрузки под курсором
    if (window.mirrorFSMState === window.MIRROR_FSM.HOLDING) {
        const holdRing = document.getElementById('rect-hold-ring');
        if (holdRing && window.lastMirrorMouseEvt) {
            holdRing.style.left = `${window.lastMirrorMouseEvt.clientX}px`;
            holdRing.style.top = `${window.lastMirrorMouseEvt.clientY}px`;
        }
        return;
    }

    // СОСТОЯНИЕ 2: DRAGGING_GHOST -> фантом области или оси следует за курсором
    if (window.mirrorFSMState === window.MIRROR_FSM.DRAGGING_GHOST) {
        if (mirrorPhase === 0) {
            const currentPt = pt || (typeof getSketchPlaneIntersection === 'function' ? getSketchPlaneIntersection(sketchRaycaster, activeSketchPlane) : null);
            if (currentPt && mirrorBoxStartPt) {
                mirrorBoxCurrentPt = currentPt.clone();
                window.updateMirrorSelectionBox(mirrorBoxStartPt, mirrorBoxCurrentPt);
            }
        } else if (mirrorPhase === 2 && mirrorAxisPt1) {
            const endPt = snappedPt || pt;
            if (endPt) {
                window.renderMirrorAxisAndGhostPreview(mirrorAxisPt1, endPt);
            }
        }
        return;
    }

    // Проверка наведения на базовую ось X или Y эскиза в состоянии IDLE
    if (typeof activeSketchPlane !== 'undefined' && activeSketchPlane && (mirrorPhase === 0 || mirrorPhase === 1)) {
        const intersectionPt = pt || (typeof getSketchPlaneIntersection === 'function' ? getSketchPlaneIntersection(sketchRaycaster, activeSketchPlane) : null);
        if (intersectionPt && typeof window.getPlaneBasis === 'function' && typeof window.getPxDist === 'function') {
            const basis = window.getPlaneBasis(activeSketchPlane);
            const v = intersectionPt.clone().sub(basis.origin);

            const projX = v.dot(basis.right);
            const closestX = basis.origin.clone().add(basis.right.clone().multiplyScalar(projX));
            const pxDistX = window.getPxDist(closestX);

            const projY = v.dot(basis.up);
            const closestY = basis.origin.clone().add(basis.up.clone().multiplyScalar(projY));
            const pxDistY = window.getPxDist(closestY);

            const HOVER_THRESHOLD = 30; // пикселей
            if (pxDistX < HOVER_THRESHOLD || pxDistY < HOVER_THRESHOLD) {
                const nearestAxis = (pxDistX <= pxDistY) ? 'X' : 'Y';
                const minDist = (pxDistX <= pxDistY) ? pxDistX : pxDistY;
                if (minDist < HOVER_THRESHOLD) {
                    window.hoveredMirrorBaseAxis = nearestAxis;
                    window.renderBaseAxisHoverHighlight(nearestAxis, basis);

                    if (typeof sketchHudTooltip !== 'undefined' && sketchHudTooltip) {
                        sketchHudTooltip.innerText = `[ Зеркало: Нажмите ЛКМ, чтобы сделать Базовую ось ${nearestAxis} зеркалом ]`;
                    }
                    return;
                }
            }
        }
    }

    window.hoveredMirrorBaseAxis = null;
    window.clearBaseAxisHoverHighlight();
};

window.handleMirrorPointerUp = function(e) {
    if (typeof isSketchMode === 'undefined' || !isSketchMode || typeof sketchTool === 'undefined' || sketchTool !== 'mirror') return;
    if (e.button !== 0) return;

    if (typeof creatorControls !== 'undefined' && creatorControls) {
        creatorControls.enabled = true;
    }

    // Если отпустили ЛКМ после успешного таймера (были в HOLDING, а таймер уже сработал)
    if (wasMirrorHoldSuccessful) {
        ignoreNextMirrorClick = true;
        wasMirrorHoldSuccessful = false;
        return;
    }

    // Если отпустили ЛКМ раньше времени таймера (< 450 мс) — отмена
    if (window.mirrorFSMState === window.MIRROR_FSM.HOLDING) {
        window.stopMirrorHoldProgress();
        if (mirrorHoldTimer) {
            clearTimeout(mirrorHoldTimer);
            mirrorHoldTimer = null;
        }
        window.mirrorFSMState = window.MIRROR_FSM.IDLE;
        isBoxSelecting = false;
        mirrorBoxStartPt = null;
        mirrorBoxCurrentPt = null;
    }
};

window.handleMirrorClick = function() {
    if (typeof isSketchMode === 'undefined' || !isSketchMode || typeof sketchTool === 'undefined' || sketchTool !== 'mirror' || typeof activeSketchPlane === 'undefined' || !activeSketchPlane) return;

    if (ignoreNextMirrorClick) {
        ignoreNextMirrorClick = false;
        return;
    }

    if (window.justCommittedMirror) {
        window.justCommittedMirror = false;
        return;
    }

    // Если наведены на базовую ось эскиза — клик делает ее зеркалом!
    if (window.hoveredMirrorBaseAxis && (mirrorPhase === 0 || mirrorPhase === 1)) {
        const axisType = window.hoveredMirrorBaseAxis;
        const basis = window.getPlaneBasis(activeSketchPlane);
        const dir = (axisType === 'X') ? basis.right : basis.up;
        const p1 = basis.origin.clone().sub(dir.clone().multiplyScalar(1000));
        const p2 = basis.origin.clone().add(dir.clone().multiplyScalar(1000));

        const mirrorAxis = {
            id: 'base_axis_' + axisType + '_' + Date.now(),
            pt1: p1,
            pt2: p2,
            plane: activeSketchPlane,
            isBaseAxis: true,
            axisType: axisType,
            name: `Базовая ось ${axisType}`,
            origin3d: basis.origin.clone()
        };

        window.hoveredMirrorBaseAxis = null;
        window.clearBaseAxisHoverHighlight();

        window.executeMirrorOperation(p1, p2, mirrorAxis);
        return;
    }

    const pt = typeof getSketchPlaneIntersection === 'function' ? getSketchPlaneIntersection(sketchRaycaster, activeSketchPlane) : null;
    if (!pt) return;
    const snappedPt = typeof applySnapsAndOrtho === 'function' ? applySnapsAndOrtho(pt, true) : pt;

    if (window.mirrorFSMState === window.MIRROR_FSM.DRAGGING_GHOST) {
        window.handleMirrorCommit(pt);
        return;
    }

    if (window.mirrorFSMState === window.MIRROR_FSM.IDLE) {
        if (mirrorPhase === 0) {
            // Одиночный клик по элементам для их добавления/удаления из подсвеченных
            const primResult = typeof window.selectSketchPrimitiveAtPoint === 'function' ? window.selectSketchPrimitiveAtPoint(snappedPt) : null;
            if (primResult && primResult.object) {
                if (primResult.type === 'segment') {
                    const idx = selectedMirrorSegments.indexOf(primResult.object);
                    if (idx === -1) selectedMirrorSegments.push(primResult.object);
                    else selectedMirrorSegments.splice(idx, 1);
                } else if (primResult.type === 'circle') {
                    const idx = selectedMirrorCircles.indexOf(primResult.object);
                    if (idx === -1) selectedMirrorCircles.push(primResult.object);
                    else selectedMirrorCircles.splice(idx, 1);
                }
                window.renderMirrorGroup();
                if (typeof sketchHudTooltip !== 'undefined' && sketchHudTooltip) {
                    const count = selectedMirrorSegments.length + selectedMirrorCircles.length;
                    sketchHudTooltip.innerText = `[ Зеркало: Выбрано объектов: ${count}. Укажите 1-ю точку оси (клик) или зажмите ЛКМ для рамки ]`;
                }
                return;
            }

            // Клик в пустоту: фиксация первой точки оси (P1)
            mirrorAxisPt1 = snappedPt.clone();
            mirrorPhase = 2;
            window.mirrorFSMState = window.MIRROR_FSM.DRAGGING_GHOST;
            if (typeof sketchHudTooltip !== 'undefined' && sketchHudTooltip) {
                sketchHudTooltip.innerText = '[ Зеркало: Укажите вторую точку оси ]';
            }
            if (typeof showToast === 'function') {
                showToast("Первая точка оси задана. Укажите вторую точку оси");
            }
        } else if (mirrorPhase === 1) {
            mirrorAxisPt1 = snappedPt.clone();
            mirrorPhase = 2;
            window.mirrorFSMState = window.MIRROR_FSM.DRAGGING_GHOST;
            if (typeof sketchHudTooltip !== 'undefined' && sketchHudTooltip) {
                sketchHudTooltip.innerText = '[ Зеркало: Укажите вторую точку оси ]';
            }
            if (typeof showToast === 'function') {
                showToast("Первая точка оси задана. Укажите вторую точку оси");
            }
        } else if (mirrorPhase === 2) {
            window.handleMirrorCommit(snappedPt);
        }
    }
};

window.executeMirrorOperation = function(axis1, axis2, customMirrorAxis) {
    if (typeof activeSketchPlane === 'undefined' || !activeSketchPlane) return;
    const basis = window.getPlaneBasis(activeSketchPlane);

    const a2d = window.project3Dto2D(axis1, basis);
    const b2d = window.project3Dto2D(axis2, basis);

    let countNewSegs = 0;
    let countNewCircs = 0;

    // Регистрация активного отрезка-зеркала
    const mirrorAxis = customMirrorAxis || {
        id: 'mirror_axis_' + Date.now() + '_' + Math.floor(Math.random() * 100000),
        pt1: axis1.clone(),
        pt2: axis2.clone(),
        plane: activeSketchPlane,
        isBaseAxis: false
    };
    window.activeMirrorLines = window.activeMirrorLines || [];
    window.activeMirrorLines.push(mirrorAxis);

    const segsToMirror = (selectedMirrorSegments && selectedMirrorSegments.length > 0)
        ? selectedMirrorSegments
        : (typeof sketchSegments !== 'undefined' ? sketchSegments.slice() : []);

    const circsToMirror = (selectedMirrorCircles && selectedMirrorCircles.length > 0)
        ? selectedMirrorCircles
        : (typeof sketchCircles !== 'undefined' ? sketchCircles.slice() : []);

    segsToMirror.forEach(seg => {
        if (!seg || !seg.start || !seg.end) return;
        const p1_2d = window.project3Dto2D(seg.start, basis);
        const p2_2d = window.project3Dto2D(seg.end, basis);

        const r1_2d = reflectPoint2D(p1_2d, a2d, b2d);
        const r2_2d = reflectPoint2D(p2_2d, a2d, b2d);

        const newStart = window.project2Dto3D(r1_2d.u, r1_2d.v, basis);
        const newEnd = window.project2Dto3D(r2_2d.u, r2_2d.v, basis);

        if (typeof sketchSegments !== 'undefined' && sketchSegments) {
            sketchSegments.push({
                start: newStart,
                end: newEnd,
                isInfinite: seg.isInfinite,
                color: seg.color,
                _fromAutoMirror: true
            });
            countNewSegs++;
        }
    });

    circsToMirror.forEach(circ => {
        if (!circ || !circ.center) return;
        const c_2d = window.project3Dto2D(circ.center, basis);
        const rc_2d = reflectPoint2D(c_2d, a2d, b2d);

        const newCenter = window.project2Dto3D(rc_2d.u, rc_2d.v, basis);

        if (typeof sketchCircles !== 'undefined' && sketchCircles) {
            sketchCircles.push({
                center: newCenter,
                radius: circ.radius,
                _fromAutoMirror: true
            });
            countNewCircs++;
        }
    });

    if (typeof window.rebuildSketchLines === 'function') {
        window.rebuildSketchLines();
    }

    window.renderActiveMirrorLines();

    if (typeof showToast === 'function') {
        const labelStr = mirrorAxis.isBaseAxis ? `Базовая ось ${mirrorAxis.axisType || ''}` : 'Отрезок-зеркало';
        showToast(`${labelStr} построена. Отзеркалено: ${countNewSegs + countNewCircs} объектов`);
    }

    window.resetMirrorState();
    window.justCommittedMirror = true;
};

// --- ГЛОБАЛЬНЫЙ АНАЛИЗАТОР И ПОДСВЕТКА РАЗРЫВОВ КОНТУРА ЭСКИЗА ---
window.sketchGapMarkers = [];

window.clearSketchGapMarkers = function() {
    if (window.sketchGapMarkers && Array.isArray(window.sketchGapMarkers)) {
        window.sketchGapMarkers.forEach(mesh => {
            if (mesh) {
                if (mesh.parent) mesh.parent.remove(mesh);
                if (typeof sketchGroup !== 'undefined' && sketchGroup) sketchGroup.remove(mesh);
                if (typeof creatorScene !== 'undefined' && creatorScene) creatorScene.remove(mesh);
                if (mesh.geometry) mesh.geometry.dispose();
                if (mesh.material) mesh.material.dispose();
            }
        });
        window.sketchGapMarkers.length = 0;
    }
};

window.checkAndHighlightSketchGaps = function(options = {}) {
    window.clearSketchGapMarkers();
    if (typeof sketchSegments === 'undefined' || !sketchSegments || sketchSegments.length === 0) {
        return [];
    }

    const plane = (typeof activeSketchPlane !== 'undefined' && activeSketchPlane) ? activeSketchPlane : null;

    // 1. Собираем все конечные точки отрезков
    const endpoints = [];
    sketchSegments.forEach((seg, segIndex) => {
        if (!seg.start || !seg.end) return;
        if (seg.start.distanceTo(seg.end) < 1e-4) return;

        endpoints.push({ pos3d: seg.start.clone(), segIndex, type: 'start' });
        endpoints.push({ pos3d: seg.end.clone(), segIndex, type: 'end' });
    });

    if (endpoints.length === 0) return [];

    // 2. Авто-замыкание сближенных точек (авто-ремонт микро-разрывов < 0.8мм)
    const AUTO_SNAP_DIST = 0.8;
    let autoSnappedCount = 0;
    for (let i = 0; i < endpoints.length; i++) {
        for (let j = i + 1; j < endpoints.length; j++) {
            if (endpoints[i].segIndex === endpoints[j].segIndex) continue;
            const dist = endpoints[i].pos3d.distanceTo(endpoints[j].pos3d);
            if (dist > 1e-4 && dist <= AUTO_SNAP_DIST) {
                const avg = endpoints[i].pos3d.clone().add(endpoints[j].pos3d).multiplyScalar(0.5);
                const segA = sketchSegments[endpoints[i].segIndex];
                const segB = sketchSegments[endpoints[j].segIndex];
                if (endpoints[i].type === 'start') segA.start.copy(avg); else segA.end.copy(avg);
                if (endpoints[j].type === 'start') segB.start.copy(avg); else segB.end.copy(avg);
                endpoints[i].pos3d.copy(avg);
                endpoints[j].pos3d.copy(avg);
                autoSnappedCount++;
            }
        }
    }

    if (autoSnappedCount > 0 && typeof window.rebuildSketchLines === 'function') {
        // Вызываем перерисовку без сброса маркеров
        const oldClear = window.clearSketchGapMarkers;
        window.clearSketchGapMarkers = () => {};
        window.rebuildSketchLines();
        window.clearSketchGapMarkers = oldClear;
    }

    // 3. Анализ свободных/незамкнутых вершин (степень соединения < 1)
    const CONNECTION_TOL = 0.5; // порог соединения 0.5 мм
    const openEndpoints = [];

    endpoints.forEach((epI, i) => {
        let connCount = 0;
        endpoints.forEach((epJ, j) => {
            if (i === j) return;
            if (epI.pos3d.distanceTo(epJ.pos3d) <= CONNECTION_TOL) {
                connCount++;
            }
        });
        if (connCount === 0) {
            openEndpoints.push(epI);
        }
    });

    // Дедупликация близких точек разрыва для отображения маркеров
    const gapPoints = [];
    openEndpoints.forEach(ep => {
        if (!gapPoints.some(gp => gp.distanceTo(ep.pos3d) < 1.0)) {
            gapPoints.push(ep.pos3d.clone());
        }
    });

    if (gapPoints.length === 0) {
        if (options.showToastSuccess && typeof showToast === 'function') {
            showToast('Проверка эскиза: все контуры замкнуты!');
        }
        return [];
    }

    // 4. Отрисовка красных кругов на местах разрывов
    const targetGroup = (typeof sketchGroup !== 'undefined' && sketchGroup) ? sketchGroup : (typeof creatorScene !== 'undefined' ? creatorScene : null);

    if (targetGroup) {
        gapPoints.forEach(pt => {
            const gapGroup = new THREE.Group();
            gapGroup.position.copy(pt);

            // Красное кольцо
            const ringGeo = new THREE.RingGeometry(2.5, 4.0, 32);
            const ringMat = new THREE.MeshBasicMaterial({ color: 0xFF0000, side: THREE.DoubleSide, depthTest: false });
            const ringMesh = new THREE.Mesh(ringGeo, ringMat);
            ringMesh.renderOrder = 999;
            gapGroup.add(ringMesh);

            // Яркая красная точка в центре
            const dotGeo = new THREE.CircleGeometry(1.5, 16);
            const dotMat = new THREE.MeshBasicMaterial({ color: 0xEF4444, side: THREE.DoubleSide, depthTest: false });
            const dotMesh = new THREE.Mesh(dotGeo, dotMat);
            dotMesh.renderOrder = 1000;
            gapGroup.add(dotMesh);

            if (typeof alignToPlane === 'function' && plane) {
                alignToPlane(gapGroup, plane);
            }

            targetGroup.add(gapGroup);
            window.sketchGapMarkers.push(gapGroup);
        });
    }

    if (options.notifyUser !== false && typeof showToast === 'function') {
        showToast(`Обнаружено ${gapPoints.length} разрывов в контуре! Места разрывов помечены красными кругами.`, 'warn');
    }

    return gapPoints;
};


