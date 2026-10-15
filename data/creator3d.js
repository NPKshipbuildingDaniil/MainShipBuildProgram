/**
 * ============================================================================
 * ФАЙЛ: creator3d.js (ГЛАВНЫЙ ОРКЕСТРАТОР 3D СЦЕНЫ)
 * НАЗНАЧЕНИЕ: Инициализация ядра 3D-конструктора, глобальные переменные и UI-мосты.
 * ============================================================================
 * ИНФОРМАЦИЯ ДЛЯ НЕЙРОСЕТЕЙ И РАЗРАБОТЧИКОВ:
 * - Это главный управляющий файл (Точка входа конструктора).
 * - В нем создаются scene, camera, renderer и настраиваются базовые события сцены.
 * - В дальнейшем отсюда следует выносить узкоспециализированную логику в соседние файлы:
 *   -> creator3d_data.js   (Базы данных профилей, материалы, константы)
 *   -> creator3d_tools.js  (Инструменты создания деталей: createPlate, createPipe...)
 *   -> creator3d_math.js   (Сложные геометрические вычисления)
 *   -> creator3d_sketch.js (Движок 2D-эскизирования и привязок)
 *   -> creator3d_gizmo.js  (Инструменты слипания и кастомного манипулятора перемещения)
 */

let creatorScene, creatorCamera, creatorOrthoCamera, creatorRenderer, creatorControls;
let currentCreatorCamera;
let creatorInitialized = false;

// Вспомогательные статические структуры для плавной привязки камеры (минимизация GC)
const _creatorDesiredTarget = new THREE.Vector3(0, 0, 0);
const _creatorCalcBox = new THREE.Box3();

let showCreatorAnnotations = true;
window.toggleCreatorAnnotations = function(val) { 
    showCreatorAnnotations = val; 
    if (typeof updateSmartSnapHUD === 'function') updateSmartSnapHUD();
};

function isAnyPopupOrModalOpen() {
    if (document.querySelector('.quick-input-panel.active')) return true;
    if (document.querySelector('.fullscreen-overlay:not(.hidden)')) return true;
    if (document.querySelector('.radial-menu.active')) return true;
    const gizmo = document.getElementById('gizmo-input-popup');
    if (gizmo && gizmo.style.display !== 'none') return true;
    const sketchRadial = document.getElementById('sketch-radial-menu-container');
    if (sketchRadial && sketchRadial.style.display !== 'none' && sketchRadial.style.display !== '') return true;
    const extrudePanel = document.getElementById('extrude-panel');
    if (extrudePanel && extrudePanel.style.display !== 'none' && extrudePanel.style.display !== '') return true;
    return false;
}
window.isAnyPopupOrModalOpen = isAnyPopupOrModalOpen;

let showRadialEdges = false;
window.toggleCreatorRadialEdges = function(val) { 
    showRadialEdges = val; 
    if (creatorScene) {
        creatorScene.traverse(obj => {
            if (obj.isMesh && obj.userData && obj.userData.specData) {
                obj.children.forEach(child => {
                    if (child.isLineSegments && child.geometry && child.geometry.type === 'EdgesGeometry') {
                        child.geometry.dispose();
                        child.geometry = new THREE.EdgesGeometry(obj.geometry, showRadialEdges ? 1 : 15);
                    }
                });
            }
        });
    }
};

// Глобальные переменные эскиза
let isSketchMode = false;
let sketchState = 0; // 0 - выбор плоскости, 1 - черчение
let activeSketchPlane = null;
let sketchGroup = null;
let originPlanesGroup = null;
let sketchTool = 'line'; // line, circle, arc
let isSnapEnabled = true;
let isSnapPointsEnabled = true;
let isSnapTopologyEnabled = true;
let isSnapExtensionEnabled = true;
let isGridVisible = true;
let isOrtho = false;

let sketchPoints = []; // Точки для привязок (Vector3)
let sketchSegments = []; // Отрезки для поиска середин
let sketchCircles = []; // Круги для выдавливания
let sketchCenters = []; // Кэшированные центры и центроиды для постоянных привязок (Smart Snaps 2.0)
let activeSmartSnap = null; // Текущая активная привязка { point, type, color, label, source3DPt }
let projLineMesh = null; // 3D пунктирная линия пространственной 3D-проекции
let snapMarker = null; // Визуальный маркер привязки
let trackedPoints = []; // Список отслеживаемых точек (Параметр следования)
let trackingCandidate = null; // Ховер кандидата: { point: THREE.Vector3, startTime: number, progress: number }
let lastRemovedTrackedPt = null; // Последняя удаленная точка отслеживания
let activeTrackingRay = null; // Активный луч отслеживания 15°: { origin: Vector3, angle: number, dir: Vector3, point: Vector3, distance: number }
let activeTrackingRays = []; // Все активные лучи отслеживания
let lastRectTrackingRay = null; // Сохраненный луч для построения наклонного прямоугольника
let trackingGuideMesh = null; // 3D линия-направляющая следования
let currentDrawPoints = []; // Точки текущего инструмента
let tempShapePreview = null; // Временный Mesh/Line
let sketchExtrudePhantom = null; // 3D фантом выдавливания

// Переменные динамических размеров 2D прямоугольника (CAD стиль)
let rectActiveDim = -1; // -1: не выбрано, 0: ширина (X), 1: высота (Y)
let rectWidthStr = '';
let rectHeightStr = '';
let rectLockedWidth = null;
let rectLockedHeight = null;
let lastMouseSketchPt = null;
let lastMouseClientX = 0;
let lastMouseClientY = 0;

// Переменные угла и расстояния подобия для Линии / Отрезка
let lineFirstPointBaseSeg = null; // если 1-я точка прямой была поставлена на отрезок
let lineFirstPointBaseCircle = null; // если 1-я точка прямой была поставлена на круг/дугу
let lineAngleActiveDim = 0; // 0: Угол, 1: Подобие
let lineAngleStr = '';
let lineLockedAngle = null;
let lineOffsetStr = '';
let lineLockedOffset = null;

function resetLineAngleAndOffsetState() {
    lineFirstPointBaseSeg = null;
    lineFirstPointBaseCircle = null;
    lineAngleActiveDim = 0;
    lineAngleStr = '';
    lineLockedAngle = null;
    lineOffsetStr = '';
    lineLockedOffset = null;
}

let rectCadDimGroup = null;
let rectCadLineW = null;
let rectCadLineH = null;

function initRectCadGroup() {
    if (rectCadDimGroup) return;
    rectCadDimGroup = new THREE.Group();
    rectCadDimGroup.name = "RectCadDimensions";

    const geoW = new THREE.BufferGeometry();
    geoW.setAttribute('position', new THREE.BufferAttribute(new Float32Array(42), 3));
    const matW = new THREE.LineBasicMaterial({
        color: 0x5AAFDD,
        transparent: true,
        opacity: 0.95
    });
    rectCadLineW = new THREE.LineSegments(geoW, matW);
    rectCadLineW.renderOrder = 9999;

    const geoH = new THREE.BufferGeometry();
    geoH.setAttribute('position', new THREE.BufferAttribute(new Float32Array(42), 3));
    const matH = new THREE.LineBasicMaterial({
        color: 0x5AAFDD,
        transparent: true,
        opacity: 0.95
    });
    rectCadLineH = new THREE.LineSegments(geoH, matH);
    rectCadLineH.renderOrder = 9999;

    rectCadDimGroup.add(rectCadLineW);
    rectCadDimGroup.add(rectCadLineH);
    if (typeof creatorScene !== 'undefined' && creatorScene) {
        creatorScene.add(rectCadDimGroup);
    }
}

function renderCadDimensionSVG(sA, sB, color, offsetPx = 28) {
    if (!sA || !sB) return '';
    const dx = sB.x - sA.x;
    const dy = sB.y - sA.y;
    const len = Math.hypot(dx, dy);
    if (len < 6) return '';

    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;

    const extSign = offsetPx >= 0 ? 1 : -1;
    const extLen = offsetPx + extSign * 8;

    // Extension lines from source points
    const ext1_x1 = sA.x, ext1_y1 = sA.y;
    const ext1_x2 = sA.x + px * extLen, ext1_y2 = sA.y + py * extLen;

    const ext2_x1 = sB.x, ext2_y1 = sB.y;
    const ext2_x2 = sB.x + px * extLen, ext2_y2 = sB.y + py * extLen;

    // Dimension line start & end
    const dim1_x = sA.x + px * offsetPx, dim1_y = sA.y + py * offsetPx;
    const dim2_x = sB.x + px * offsetPx, dim2_y = sB.y + py * offsetPx;

    // Filled arrowheads
    const arrowLen = 13, arrowWidth = 5.5;

    // Arrowhead 1 at dim1 pointing towards dim2 (+u)
    const arr1_p1_x = dim1_x + ux * arrowLen + px * arrowWidth * extSign;
    const arr1_p1_y = dim1_y + uy * arrowLen + py * arrowWidth * extSign;
    const arr1_p2_x = dim1_x + ux * arrowLen - px * arrowWidth * extSign;
    const arr1_p2_y = dim1_y + uy * arrowLen - py * arrowWidth * extSign;

    // Arrowhead 2 at dim2 pointing towards dim1 (-u)
    const arr2_p1_x = dim2_x - ux * arrowLen + px * arrowWidth * extSign;
    const arr2_p1_y = dim2_y - uy * arrowLen + py * arrowWidth * extSign;
    const arr2_p2_x = dim2_x - ux * arrowLen - px * arrowWidth * extSign;
    const arr2_p2_y = dim2_y - uy * arrowLen - py * arrowWidth * extSign;

    return `
        <line x1="${ext1_x1}" y1="${ext1_y1}" x2="${ext1_x2}" y2="${ext1_y2}" stroke="${color}" stroke-width="1.5" stroke-dasharray="3 2" opacity="0.95" />
        <line x1="${ext2_x1}" y1="${ext2_y1}" x2="${ext2_x2}" y2="${ext2_y2}" stroke="${color}" stroke-width="1.5" stroke-dasharray="3 2" opacity="0.95" />
        <line x1="${dim1_x}" y1="${dim1_y}" x2="${dim2_x}" y2="${dim2_y}" stroke="${color}" stroke-width="2.5" />
        <polygon points="${dim1_x},${dim1_y} ${arr1_p1_x},${arr1_p1_y} ${arr1_p2_x},${arr1_p2_y}" fill="${color}" />
        <polygon points="${dim2_x},${dim2_y} ${arr2_p1_x},${arr2_p1_y} ${arr2_p2_x},${arr2_p2_y}" fill="${color}" />
    `;
}
window.renderCadDimensionSVG = renderCadDimensionSVG;

let sketchArcCenters = [];

let rectChamferVal = 0;
let rectConcaveVal = 0;
let rectFilletVal = 0;

let rmbHoldTimer = null;
let rmbHoldAnimFrame = null;
let rmbHoldStartTime = 0;
let isRmbHolding = false;
let rmbHoldPos = { x: 0, y: 0 };
const RMB_HOLD_DURATION = 450; // ms to trigger modifier

function startRmbHoldProgress(x, y) {
    if (!isSketchMode || sketchTool !== 'rectangle' || currentDrawPoints.length !== 1) return;
    stopRmbHoldProgress();
    rmbHoldStartTime = Date.now();
    isRmbHolding = true;
    rmbHoldPos = { x, y };

    const holdRing = document.getElementById('rect-hold-ring');
    const holdCircle = document.getElementById('rect-hold-circle');
    if (!holdRing || !holdCircle) return;

    holdRing.style.display = 'block';
    holdRing.style.left = `${x}px`;
    holdRing.style.top = `${y}px`;

    const totalDash = 163.36;
    holdCircle.style.strokeDashoffset = totalDash.toString();

    function animateHold() {
        if (!isRmbHolding) return;
        const elapsed = Date.now() - rmbHoldStartTime;
        const progress = Math.min(1, elapsed / RMB_HOLD_DURATION);
        
        holdCircle.style.strokeDashoffset = (totalDash * (1 - progress)).toString();

        if (progress >= 1) {
            stopRmbHoldProgress();
            openRectModifierPanel(rmbHoldPos.x, rmbHoldPos.y);
        } else {
            rmbHoldAnimFrame = requestAnimationFrame(animateHold);
        }
    }
    rmbHoldAnimFrame = requestAnimationFrame(animateHold);
}

function stopRmbHoldProgress() {
    isRmbHolding = false;
    if (rmbHoldAnimFrame) {
        cancelAnimationFrame(rmbHoldAnimFrame);
        rmbHoldAnimFrame = null;
    }
    const holdRing = document.getElementById('rect-hold-ring');
    if (holdRing) holdRing.style.display = 'none';
}

function openRectModifierPanel(x, y) {
    if (!isSketchMode || sketchTool !== 'rectangle' || currentDrawPoints.length !== 1) return;
    const panel = document.getElementById('rect-modifier-panel');
    if (!panel) return;

    const width = 210;
    const height = 180;
    let clampX = Math.max(width / 2 + 10, Math.min(window.innerWidth - width / 2 - 10, x));
    let clampY = Math.max(height / 2 + 10, Math.min(window.innerHeight - height / 2 - 10, y));

    panel.style.left = `${clampX}px`;
    panel.style.top = `${clampY}px`;
    panel.style.display = 'block';

    const chamferInp = document.getElementById('rect-mod-chamfer');
    const concaveInp = document.getElementById('rect-mod-concave');
    const filletInp = document.getElementById('rect-mod-fillet');

    if (chamferInp) chamferInp.value = rectChamferVal > 0 ? rectChamferVal : '';
    if (concaveInp) concaveInp.value = rectConcaveVal > 0 ? rectConcaveVal : '';
    if (filletInp) filletInp.value = rectFilletVal > 0 ? rectFilletVal : '';

    if (chamferInp) chamferInp.focus();
}

function closeRectModifierPanel() {
    const panel = document.getElementById('rect-modifier-panel');
    if (panel) panel.style.display = 'none';
}

function initRectModifierEvents() {
    const chamferInp = document.getElementById('rect-mod-chamfer');
    const concaveInp = document.getElementById('rect-mod-concave');
    const filletInp = document.getElementById('rect-mod-fillet');
    const applyBtn = document.getElementById('rect-mod-apply-btn');
    const closeBtn = document.getElementById('rect-mod-close-btn');

    function updateModifierValues(type) {
        if (type === 'chamfer') {
            rectChamferVal = Math.max(0, parseFloat(chamferInp.value) || 0);
            rectConcaveVal = 0; if (concaveInp) concaveInp.value = '';
            rectFilletVal = 0; if (filletInp) filletInp.value = '';
        } else if (type === 'concave') {
            rectConcaveVal = Math.max(0, parseFloat(concaveInp.value) || 0);
            rectChamferVal = 0; if (chamferInp) chamferInp.value = '';
            rectFilletVal = 0; if (filletInp) filletInp.value = '';
        } else if (type === 'fillet') {
            rectFilletVal = Math.max(0, parseFloat(filletInp.value) || 0);
            rectChamferVal = 0; if (chamferInp) chamferInp.value = '';
            rectConcaveVal = 0; if (concaveInp) concaveInp.value = '';
        }

        if (typeof lastMouseSketchPt !== 'undefined' && lastMouseSketchPt && typeof isSketchMode !== 'undefined' && isSketchMode && currentDrawPoints.length === 1) {
            updateTempShape(lastMouseSketchPt);
            updateRectCadDimensions();
        }
    }

    if (chamferInp) {
        chamferInp.addEventListener('input', () => updateModifierValues('chamfer'));
        chamferInp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') closeRectModifierPanel(); });
    }
    if (concaveInp) {
        concaveInp.addEventListener('input', () => updateModifierValues('concave'));
        concaveInp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') closeRectModifierPanel(); });
    }
    if (filletInp) {
        filletInp.addEventListener('input', () => updateModifierValues('fillet'));
        filletInp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') closeRectModifierPanel(); });
    }

    if (applyBtn) {
        applyBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeRectModifierPanel();
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeRectModifierPanel();
        });
    }
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRectModifierEvents);
} else {
    initRectModifierEvents();
}

function getModifiedRectangleGeometry(p1, p_current, activePlane, chamfer, concave, fillet) {
    if (!activePlane || !p1 || !p_current) return { points: [], segments: [], arcCenters: [] };

    const upAxis = activePlane.userData.up.clone().normalize();
    const normal = activePlane.userData.normal.clone().normalize();
    const rightAxis = new THREE.Vector3().crossVectors(upAxis, normal).normalize();

    let e1 = rightAxis.clone();
    let e2 = upAxis.clone();
    const ray = (typeof activeTrackingRay !== 'undefined' && activeTrackingRay) || (typeof lastRectTrackingRay !== 'undefined' && lastRectTrackingRay);
    if (ray && ray.dir) {
        e1 = ray.dir.clone().normalize();
        e2 = new THREE.Vector3().crossVectors(normal, e1).normalize();
    }

    const v = new THREE.Vector3().subVectors(p_current, p1);
    const w = v.dot(e1);
    const h = v.dot(e2);

    const absW = Math.abs(w);
    const absH = Math.abs(h);

    let modType = null;
    let modVal = 0;
    if (chamfer > 0) { modType = 'chamfer'; modVal = chamfer; }
    else if (concave > 0) { modType = 'concave'; modVal = concave; }
    else if (fillet > 0) { modType = 'fillet'; modVal = fillet; }

    const P1 = p1.clone();
    const P2 = p1.clone().add(e1.clone().multiplyScalar(w));
    const P3 = p_current.clone();
    const P4 = p1.clone().add(e2.clone().multiplyScalar(h));

    if (absW < 1e-4 || absH < 1e-4 || !modType || modVal <= 0) {
        return {
            points: [P1, P2, P3, P4, P1.clone()],
            segments: [
                { start: P1.clone(), end: P2.clone() },
                { start: P2.clone(), end: P3.clone() },
                { start: P3.clone(), end: P4.clone() },
                { start: P4.clone(), end: P1.clone() }
            ],
            arcCenters: []
        };
    }

    const maxVal = Math.min(absW / 2, absH / 2);
    const R = Math.min(modVal, maxVal);

    if (R <= 1e-4) {
        return {
            points: [P1, P2, P3, P4, P1.clone()],
            segments: [
                { start: P1.clone(), end: P2.clone() },
                { start: P2.clone(), end: P3.clone() },
                { start: P3.clone(), end: P4.clone() },
                { start: P4.clone(), end: P1.clone() }
            ],
            arcCenters: []
        };
    }

    const signW = Math.sign(w) || 1;
    const signH = Math.sign(h) || 1;
    const u1 = e1.clone().multiplyScalar(signW);
    const u2 = e2.clone().multiplyScalar(signH);

    const C1 = p1.clone();
    const C2 = p1.clone().add(u1.clone().multiplyScalar(absW));
    const C3 = p1.clone().add(u1.clone().multiplyScalar(absW)).add(u2.clone().multiplyScalar(absH));
    const C4 = p1.clone().add(u2.clone().multiplyScalar(absH));

    const A1 = C1.clone().add(u2.clone().multiplyScalar(R));
    const B1 = C1.clone().add(u1.clone().multiplyScalar(R));

    const A2 = C2.clone().sub(u1.clone().multiplyScalar(R));
    const B2 = C2.clone().add(u2.clone().multiplyScalar(R));

    const A3 = C3.clone().sub(u2.clone().multiplyScalar(R));
    const B3 = C3.clone().sub(u1.clone().multiplyScalar(R));

    const A4 = C4.clone().add(u1.clone().multiplyScalar(R));
    const B4 = C4.clone().sub(u2.clone().multiplyScalar(R));

    const arcCenters = [];

    function getCornerArcPoints(Ci, Ai, Bi, cornerIndex) {
        if (modType === 'chamfer') {
            return [Ai.clone(), Bi.clone()];
        }
        let Oi;
        if (modType === 'fillet') {
            if (cornerIndex === 1) Oi = Ci.clone().add(u1.clone().multiplyScalar(R)).add(u2.clone().multiplyScalar(R));
            else if (cornerIndex === 2) Oi = Ci.clone().sub(u1.clone().multiplyScalar(R)).add(u2.clone().multiplyScalar(R));
            else if (cornerIndex === 3) Oi = Ci.clone().sub(u1.clone().multiplyScalar(R)).sub(u2.clone().multiplyScalar(R));
            else if (cornerIndex === 4) Oi = Ci.clone().add(u1.clone().multiplyScalar(R)).sub(u2.clone().multiplyScalar(R));
        } else if (modType === 'concave') {
            Oi = Ci.clone();
        }

        if (Oi) {
            arcCenters.push(Oi.clone());
        }

        const vA = Ai.clone().sub(Oi).divideScalar(R);
        const vB = Bi.clone().sub(Oi).divideScalar(R);

        const steps = 12;
        const arcPts = [];
        for (let k = 0; k <= steps; k++) {
            const theta = (k / steps) * (Math.PI / 2);
            const pt = Oi.clone().add(
                vA.clone().multiplyScalar(Math.cos(theta)).add(vB.clone().multiplyScalar(Math.sin(theta))).multiplyScalar(R)
            );
            arcPts.push(pt);
        }
        return arcPts;
    }

    const c1Pts = getCornerArcPoints(C1, A1, B1, 1);
    const c2Pts = getCornerArcPoints(C2, A2, B2, 2);
    const c3Pts = getCornerArcPoints(C3, A3, B3, 3);
    const c4Pts = getCornerArcPoints(C4, A4, B4, 4);

    const allContourPoints = [];

    function addPoints(ptArr) {
        ptArr.forEach(p => {
            if (allContourPoints.length === 0 || allContourPoints[allContourPoints.length - 1].distanceTo(p) > 1e-5) {
                allContourPoints.push(p);
            }
        });
    }

    addPoints([B4]);
    addPoints(c1Pts);
    addPoints([A2]);
    addPoints(c2Pts);
    addPoints([A3]);
    addPoints(c3Pts);
    addPoints([A4]);
    addPoints(c4Pts);
    if (allContourPoints.length > 0 && allContourPoints[0].distanceTo(allContourPoints[allContourPoints.length - 1]) > 1e-5) {
        allContourPoints.push(allContourPoints[0].clone());
    }

    const segments = [];
    for (let i = 0; i < allContourPoints.length - 1; i++) {
        segments.push({ start: allContourPoints[i].clone(), end: allContourPoints[i + 1].clone() });
    }

    return { points: allContourPoints, segments: segments, arcCenters: arcCenters };
}

function hideRectCadDimensions() {
    if (rectCadDimGroup) rectCadDimGroup.visible = false;
    const hudContainer = document.getElementById('rect-cad-hud');
    if (hudContainer) hudContainer.style.display = 'none';
    const badgeW = document.getElementById('rect-badge-w');
    if (badgeW) badgeW.style.display = 'none';
    const badgeH = document.getElementById('rect-badge-h');
    if (badgeH) badgeH.style.display = 'none';
    const svgOverlay = document.getElementById('rect-cad-svg');
    if (svgOverlay) svgOverlay.innerHTML = '';
    if (typeof sketchHudTooltip !== 'undefined' && sketchHudTooltip && sketchTool === 'rectangle') {
        sketchHudTooltip.style.display = 'none';
    }
}
window.hideRectCadDimensions = hideRectCadDimensions;

function resetRectDimState() {
    rectActiveDim = -1;
    rectWidthStr = '';
    rectHeightStr = '';
    rectLockedWidth = null;
    rectLockedHeight = null;
    rectChamferVal = 0;
    rectConcaveVal = 0;
    rectFilletVal = 0;
    closeRectModifierPanel();
    stopRmbHoldProgress();
    hideRectCadDimensions();
}
window.resetRectDimState = resetRectDimState;

let lineHoverSegment = null;
let lineActiveDim = -1; // -1: none, 0: distance from start (A), 1: distance to end (B)
let lineStr0 = '';
let lineStr1 = '';
let lineLockedDist0 = null;
let lineLockedDist1 = null;

function resetLineCadDimState() {
    lineHoverSegment = null;
    lineActiveDim = -1;
    lineStr0 = '';
    lineStr1 = '';
    lineLockedDist0 = null;
    lineLockedDist1 = null;
    hideRectCadDimensions();
}
window.resetLineCadDimState = resetLineCadDimState;

let trackingActiveDim = -1; // -1: none, 0: Ray 1, 1: Ray 2
let trackingStr0 = '';
let trackingStr1 = '';
let trackingLockedDist0 = null;
let trackingLockedDist1 = null;

function resetTrackingDimState() {
    trackingActiveDim = -1;
    trackingStr0 = '';
    trackingStr1 = '';
    trackingLockedDist0 = null;
    trackingLockedDist1 = null;
}
window.resetTrackingDimState = resetTrackingDimState;

function getClosestPointOnSegment(pt, seg) {
    const A = seg.start;
    const B = seg.end;
    const v = new THREE.Vector3().subVectors(B, A);
    const lenSq = v.lengthSq();
    const L = Math.sqrt(lenSq);
    if (lenSq < 1e-6) return { pt: A.clone(), t: 0, d1: 0, d2: 0, dist: pt.distanceTo(A) };
    const w = new THREE.Vector3().subVectors(pt, A);
    let t = w.dot(v) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const proj = A.clone().add(v.clone().multiplyScalar(t));
    const d1 = t * L;
    const d2 = (1 - t) * L;
    return { pt: proj, t, d1, d2, dist: pt.distanceTo(proj) };
}

function getPxDistForPt(pt3d) {
    if (!pt3d || !currentCreatorCamera) return 999999;
    const canvas = creatorRenderer ? creatorRenderer.domElement : null;
    if (!canvas) return 999999;
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;
    const mousePx = {
        x: (sketchMouse.x * 0.5 + 0.5) * w,
        y: (-sketchMouse.y * 0.5 + 0.5) * h
    };
    const pr = pt3d.clone().project(currentCreatorCamera);
    if (pr.z < -1 || pr.z > 1) return 999999;
    const px = (pr.x * 0.5 + 0.5) * w;
    const py = (-pr.y * 0.5 + 0.5) * h;
    return Math.hypot(px - mousePx.x, py - mousePx.y);
}

function findHoveredSegment(pt) {
    if (isAnyPopupOrModalOpen()) return null;
    if (!sketchSegments || sketchSegments.length === 0 || !pt) return null;
    let bestSeg = null;
    let minPx = 22;
    sketchSegments.forEach(seg => {
        const res = getClosestPointOnSegment(pt, seg);
        const dPx = getPxDistForPt(res.pt);
        if (dPx < minPx) {
            minPx = dPx;
            bestSeg = seg;
        }
    });
    return bestSeg;
}

function getAdjustedLineSegmentPoint(pt) {
    if (!lineHoverSegment) return pt;
    const A = lineHoverSegment.start;
    const B = lineHoverSegment.end;
    const L = A.distanceTo(B);
    if (L < 1e-5) return pt;
    const dir = new THREE.Vector3().subVectors(B, A).normalize();

    let d1 = 0;
    if (lineLockedDist0 !== null) {
        d1 = Math.max(0, Math.min(L, lineLockedDist0));
    } else if (lineLockedDist1 !== null) {
        d1 = Math.max(0, Math.min(L, L - lineLockedDist1));
    } else if (lineActiveDim === 0 && lineStr0.trim() !== '') {
        const val = parseFloat(lineStr0);
        if (!isNaN(val)) d1 = Math.max(0, Math.min(L, val));
        else d1 = getClosestPointOnSegment(pt, lineHoverSegment).d1;
    } else if (lineActiveDim === 1 && lineStr1.trim() !== '') {
        const val = parseFloat(lineStr1);
        if (!isNaN(val)) d1 = Math.max(0, Math.min(L, L - val));
        else d1 = getClosestPointOnSegment(pt, lineHoverSegment).d1;
    } else {
        d1 = getClosestPointOnSegment(pt, lineHoverSegment).d1;
    }

    return A.clone().add(dir.multiplyScalar(d1));
}

function updateLineSegCadDimensions() {
    if (sketchTool !== 'line' || !activeSketchPlane || !lastMouseSketchPt || sketchState !== 1 || isAnyPopupOrModalOpen()) {
        hideRectCadDimensions();
        if (lineHoverSegment && lineActiveDim === -1 && lineLockedDist0 === null && lineLockedDist1 === null) {
            lineHoverSegment = null;
        }
        return;
    }

    if (lineActiveDim === -1 && lineLockedDist0 === null && lineLockedDist1 === null) {
        const candidate = findHoveredSegment(lastMouseSketchPt);
        lineHoverSegment = candidate;
    }

    if (!lineHoverSegment) {
        hideRectCadDimensions();
        return;
    }

    const A = lineHoverSegment.start;
    const B = lineHoverSegment.end;
    const L = A.distanceTo(B);
    if (L < 1e-5) {
        hideRectCadDimensions();
        return;
    }

    const P = getAdjustedLineSegmentPoint(lastMouseSketchPt);
    const d1 = A.distanceTo(P);
    const d2 = P.distanceTo(B);

    const canvas = creatorRenderer ? creatorRenderer.domElement : null;
    if (!canvas || !currentCreatorCamera) return;
    const canvasRect = canvas.getBoundingClientRect();

    function toScreen(pt3d) {
        const pProj = pt3d.clone().project(currentCreatorCamera);
        return {
            x: canvasRect.left + (pProj.x * 0.5 + 0.5) * canvasRect.width,
            y: canvasRect.top + (-pProj.y * 0.5 + 0.5) * canvasRect.height
        };
    }

    // Determine snap theme & color
    let dimTheme = 'construction';
    let dimColor = '#16A34A';

    if (typeof activeTrackingRay !== 'undefined' && activeTrackingRay) {
        dimTheme = 'extension';
        dimColor = '#2563EB';
    } else if (typeof activeSmartSnap !== 'undefined' && activeSmartSnap) {
        if (activeSmartSnap.color === 'red' || activeSmartSnap.type === 'nearest' || activeSmartSnap.type === 'endpoint' || activeSmartSnap.type === 'midpoint' || activeSmartSnap.type === 'center' || activeSmartSnap.type === 'perpendicular' || activeSmartSnap.type === 'intersection') {
            dimTheme = 'topology';
            dimColor = '#DC2626';
        } else if (activeSmartSnap.color === 'blue' || activeSmartSnap.type === 'tracking') {
            dimTheme = 'extension';
            dimColor = '#2563EB';
        }
    }

    const scrA = toScreen(A);
    const scrP = toScreen(P);
    const scrB = toScreen(B);

    let shapeCenter = null;
    let ptsToAvg = [];
    if (typeof sketchPoints !== 'undefined' && sketchPoints && sketchPoints.length > 0) {
        ptsToAvg = sketchPoints;
    } else if (typeof currentDrawPoints !== 'undefined' && currentDrawPoints && currentDrawPoints.length > 0) {
        ptsToAvg = currentDrawPoints;
    }
    if (ptsToAvg.length > 0) {
        let sumX = 0, sumY = 0;
        ptsToAvg.forEach(pt3d => {
            const sc = toScreen(pt3d);
            sumX += sc.x;
            sumY += sc.y;
        });
        shapeCenter = { x: sumX / ptsToAvg.length, y: sumY / ptsToAvg.length };
    }

    const dx1 = scrP.x - scrA.x;
    const dy1 = scrP.y - scrA.y;
    let angle1 = Math.atan2(dy1, dx1) * 180 / Math.PI;
    if (angle1 > 90 || angle1 < -90) angle1 += 180;

    const len1 = Math.hypot(dx1, dy1) || 1;
    const px1 = -dy1 / len1, py1 = dx1 / len1;
    const mid1_edge = { x: (scrA.x + scrP.x) / 2, y: (scrA.y + scrP.y) / 2 };
    let offset1 = 28;
    if (shapeCenter) {
        const outVec1 = { x: mid1_edge.x - shapeCenter.x, y: mid1_edge.y - shapeCenter.y };
        if (px1 * outVec1.x + py1 * outVec1.y < 0) offset1 = -28;
    }
    const mid1 = { x: mid1_edge.x + px1 * offset1, y: mid1_edge.y + py1 * offset1 };

    const dx2 = scrB.x - scrP.x;
    const dy2 = scrB.y - scrP.y;
    let angle2 = Math.atan2(dy2, dx2) * 180 / Math.PI;
    if (angle2 > 90 || angle2 < -90) angle2 += 180;

    const len2 = Math.hypot(dx2, dy2) || 1;
    const px2 = -dy2 / len2, py2 = dx2 / len2;
    const mid2_edge = { x: (scrP.x + scrB.x) / 2, y: (scrP.y + scrB.y) / 2 };
    let offset2 = 28;
    if (shapeCenter) {
        const outVec2 = { x: mid2_edge.x - shapeCenter.x, y: mid2_edge.y - shapeCenter.y };
        if (px2 * outVec2.x + py2 * outVec2.y < 0) offset2 = -28;
    }
    const mid2 = { x: mid2_edge.x + px2 * offset2, y: mid2_edge.y + py2 * offset2 };

    const svgOverlay = document.getElementById('rect-cad-svg');
    let svgHtml = '';
    if (d1 > 0.01) {
        svgHtml += renderCadDimensionSVG(scrA, scrP, dimColor, offset1);
    }
    if (d2 > 0.01) {
        svgHtml += renderCadDimensionSVG(scrP, scrB, dimColor, offset2);
    }
    if (svgOverlay) {
        svgOverlay.innerHTML = svgHtml;
    }

    const hudContainer = document.getElementById('rect-cad-hud');
    const badgeW = document.getElementById('rect-badge-w');
    const badgeH = document.getElementById('rect-badge-h');
    const badgeHint = document.getElementById('rect-badge-hint');

    if (hudContainer && badgeW && badgeH && badgeHint) {
        hudContainer.style.display = 'block';
        badgeW.style.display = 'flex';
        badgeH.style.display = 'flex';

        let valStr0Display = '';
        if (lineActiveDim === 0 && lineStr0 !== '') {
            valStr0Display = lineStr0 + '<span class="cad-dim-cursor"></span>';
        } else if (lineLockedDist0 !== null) {
            valStr0Display = lineLockedDist0.toFixed(1);
        } else if (lineActiveDim === 0 && lineStr0 === '') {
            valStr0Display = d1.toFixed(1) + '<span class="cad-dim-cursor"></span>';
        } else {
            valStr0Display = d1.toFixed(1);
        }

        let cls0 = `cad-dim-badge ${dimTheme} `;
        if (lineActiveDim === 0) cls0 += 'active';
        else if (lineLockedDist0 !== null) cls0 += 'locked';
        else cls0 += 'inactive';

        badgeW.className = cls0;
        badgeW.style.left = `${mid1.x}px`;
        badgeW.style.top = `${mid1.y}px`;
        badgeW.style.transform = `translate(-50%, -50%) rotate(${angle1}deg)`;
        badgeW.innerHTML = `
            <span class="cad-dim-val">${valStr0Display}</span>
            <span class="cad-dim-unit">мм</span>
            ${lineLockedDist0 !== null ? '<span style="font-size:11px;margin-left:2px;">🔒</span>' : ''}
        `;

        let valStr1Display = '';
        if (lineActiveDim === 1 && lineStr1 !== '') {
            valStr1Display = lineStr1 + '<span class="cad-dim-cursor"></span>';
        } else if (lineLockedDist1 !== null) {
            valStr1Display = lineLockedDist1.toFixed(1);
        } else if (lineActiveDim === 1 && lineStr1 === '') {
            valStr1Display = d2.toFixed(1) + '<span class="cad-dim-cursor"></span>';
        } else {
            valStr1Display = d2.toFixed(1);
        }

        let cls1 = `cad-dim-badge ${dimTheme} `;
        if (lineActiveDim === 1) cls1 += 'active';
        else if (lineLockedDist1 !== null) cls1 += 'locked';
        else cls1 += 'inactive';

        badgeH.className = cls1;
        badgeH.style.left = `${mid2.x}px`;
        badgeH.style.top = `${mid2.y}px`;
        badgeH.style.transform = `translate(-50%, -50%) rotate(${angle2}deg)`;
        badgeH.innerHTML = `
            <span class="cad-dim-val">${valStr1Display}</span>
            <span class="cad-dim-unit">мм</span>
            ${lineLockedDist1 !== null ? '<span style="font-size:11px;margin-left:2px;">🔒</span>' : ''}
        `;

        badgeHint.style.display = 'block';
        badgeHint.innerHTML = `<kbd>Tab</kbd> выбор размера • <kbd>Числа</kbd> ввод • <kbd>BS/Del+Tab</kbd> сбросить заморозку`;
    }
}
window.updateLineSegCadDimensions = updateLineSegCadDimensions;

function getAdjustedRectPoint(pt) {
    if (!activeSketchPlane || currentDrawPoints.length === 0 || !pt) return pt;
    const p1 = currentDrawPoints[0];
    const up = activeSketchPlane.userData.up;
    const normal = activeSketchPlane.userData.normal;
    const right = new THREE.Vector3().crossVectors(up, normal).normalize();

    let e1 = right.clone();
    let e2 = up.clone();
    const ray = activeTrackingRay || lastRectTrackingRay;
    if (ray && ray.dir) {
        e1 = ray.dir.clone().normalize();
        e2 = new THREE.Vector3().crossVectors(normal, e1).normalize();
    }

    const v = new THREE.Vector3().subVectors(pt, p1);
    const dotW = v.dot(e1);
    const dotH = v.dot(e2);

    const signW = dotW >= 0 ? 1 : -1;
    const signH = dotH >= 0 ? 1 : -1;

    let w = Math.abs(dotW);
    if (rectLockedWidth !== null) {
        w = rectLockedWidth;
    } else if (rectActiveDim === 0 && rectWidthStr.trim() !== '') {
        const val = parseFloat(rectWidthStr);
        if (!isNaN(val) && val > 0) w = val;
    }

    let h = Math.abs(dotH);
    if (rectLockedHeight !== null) {
        h = rectLockedHeight;
    } else if (rectActiveDim === 1 && rectHeightStr.trim() !== '') {
        const val = parseFloat(rectHeightStr);
        if (!isNaN(val) && val > 0) h = val;
    }

    return p1.clone()
        .add(e1.clone().multiplyScalar(signW * w))
        .add(e2.clone().multiplyScalar(signH * h));
}

function updateRectCadDimensions() {
    if (sketchTool !== 'rectangle' || sketchState !== 1 || currentDrawPoints.length !== 1 || !activeSketchPlane || !lastMouseSketchPt || isAnyPopupOrModalOpen()) {
        hideRectCadDimensions();
        return;
    }

    const p1 = currentDrawPoints[0];
    const p3 = getAdjustedRectPoint(lastMouseSketchPt);

    const up = activeSketchPlane.userData.up.clone().normalize();
    const normal = activeSketchPlane.userData.normal.clone().normalize();
    const right = new THREE.Vector3().crossVectors(up, normal).normalize();

    let e1 = right.clone();
    let e2 = up.clone();
    const ray = activeTrackingRay || lastRectTrackingRay;
    if (ray && ray.dir) {
        e1 = ray.dir.clone().normalize();
        e2 = new THREE.Vector3().crossVectors(normal, e1).normalize();
    }

    const v = new THREE.Vector3().subVectors(p3, p1);
    const dotW = v.dot(e1);
    const dotH = v.dot(e2);

    const rawW = Math.abs(dotW);
    const rawH = Math.abs(dotH);

    const P1 = p1.clone();
    const P2 = p1.clone().add(e1.clone().multiplyScalar(dotW));
    const P3 = p3.clone();
    const P4 = p1.clone().add(e2.clone().multiplyScalar(dotH));

    const canvas = creatorRenderer ? creatorRenderer.domElement : null;
    if (!canvas || !currentCreatorCamera) return;
    const canvasRect = canvas.getBoundingClientRect();

    function toScreen(pt3d) {
        const pProj = pt3d.clone().project(currentCreatorCamera);
        return {
            x: canvasRect.left + (pProj.x * 0.5 + 0.5) * canvasRect.width,
            y: canvasRect.top + (-pProj.y * 0.5 + 0.5) * canvasRect.height
        };
    }

    // Determine snap theme & color:
    let dimTheme = 'construction';
    let dimColor = '#16A34A';

    if (typeof activeTrackingRay !== 'undefined' && activeTrackingRay) {
        dimTheme = 'extension';
        dimColor = '#2563EB';
    } else if (typeof activeSmartSnap !== 'undefined' && activeSmartSnap) {
        if (activeSmartSnap.color === 'red' || activeSmartSnap.type === 'nearest' || activeSmartSnap.type === 'endpoint' || activeSmartSnap.type === 'midpoint' || activeSmartSnap.type === 'center' || activeSmartSnap.type === 'perpendicular' || activeSmartSnap.type === 'intersection') {
            dimTheme = 'topology';
            dimColor = '#DC2626';
        } else if (activeSmartSnap.color === 'blue' || activeSmartSnap.type === 'tracking') {
            dimTheme = 'extension';
            dimColor = '#2563EB';
        }
    }

    const scrP1 = toScreen(P1);
    const scrP2 = toScreen(P2);
    const scrP3 = toScreen(P3);
    const scrP4 = toScreen(P4);

    const rectCenter = {
        x: (scrP1.x + scrP2.x + scrP3.x + scrP4.x) / 4,
        y: (scrP1.y + scrP2.y + scrP3.y + scrP4.y) / 4
    };

    // Width dimension (P1 -> P2)
    const dxW = scrP2.x - scrP1.x;
    const dyW = scrP2.y - scrP1.y;
    let angleW = Math.atan2(dyW, dxW) * 180 / Math.PI;
    if (angleW > 90 || angleW < -90) angleW += 180;

    const lenW = Math.hypot(dxW, dyW) || 1;
    const pxW = -dyW / lenW, pyW = dxW / lenW;
    const midW_edge = { x: (scrP1.x + scrP2.x) / 2, y: (scrP1.y + scrP2.y) / 2 };
    const outVecW = { x: midW_edge.x - rectCenter.x, y: midW_edge.y - rectCenter.y };
    const offsetW = (pxW * outVecW.x + pyW * outVecW.y) >= 0 ? 28 : -28;
    const midW = { x: midW_edge.x + pxW * offsetW, y: midW_edge.y + pyW * offsetW };

    // Height dimension (P2 -> P3)
    const dxH = scrP3.x - scrP2.x;
    const dyH = scrP3.y - scrP2.y;
    let angleH = Math.atan2(dyH, dxH) * 180 / Math.PI;
    if (angleH > 90 || angleH < -90) angleH += 180;

    const lenH = Math.hypot(dxH, dyH) || 1;
    const pxH = -dyH / lenH, pyH = dxH / lenH;
    const midH_edge = { x: (scrP2.x + scrP3.x) / 2, y: (scrP2.y + scrP3.y) / 2 };
    const outVecH = { x: midH_edge.x - rectCenter.x, y: midH_edge.y - rectCenter.y };
    const offsetH = (pxH * outVecH.x + pyH * outVecH.y) >= 0 ? 28 : -28;
    const midH = { x: midH_edge.x + pxH * offsetH, y: midH_edge.y + pyH * offsetH };

    const svgOverlay = document.getElementById('rect-cad-svg');
    let svgHtml = '';

    // Width dimension (P1 -> P2)
    if (rawW > 0.01) {
        svgHtml += renderCadDimensionSVG(scrP1, scrP2, dimColor, offsetW);
    }
    // Height dimension (P2 -> P3)
    if (rawH > 0.01) {
        svgHtml += renderCadDimensionSVG(scrP2, scrP3, dimColor, offsetH);
    }

    if (svgOverlay) {
        svgOverlay.innerHTML = svgHtml;
    }

    const hudContainer = document.getElementById('rect-cad-hud');
    const badgeW = document.getElementById('rect-badge-w');
    const badgeH = document.getElementById('rect-badge-h');
    const badgeHint = document.getElementById('rect-badge-hint');

    if (hudContainer && badgeW && badgeH && badgeHint) {
        hudContainer.style.display = 'block';
        badgeW.style.display = 'flex';
        badgeH.style.display = 'flex';

        // Width Badge
        let valStrW = '';
        if (rectActiveDim === 0 && rectWidthStr !== '') {
            valStrW = rectWidthStr + '<span class="cad-dim-cursor"></span>';
        } else if (rectLockedWidth !== null) {
            valStrW = rectLockedWidth.toFixed(1);
        } else if (rectActiveDim === 0 && rectWidthStr === '') {
            valStrW = rawW.toFixed(1) + '<span class="cad-dim-cursor"></span>';
        } else {
            valStrW = rawW.toFixed(1);
        }

        let clsW = `cad-dim-badge ${dimTheme} `;
        if (rectActiveDim === 0) clsW += 'active';
        else if (rectLockedWidth !== null) clsW += 'locked';
        else clsW += 'inactive';

        badgeW.className = clsW;
        badgeW.style.left = `${midW.x}px`;
        badgeW.style.top = `${midW.y}px`;
        badgeW.style.transform = `translate(-50%, -50%) rotate(${angleW}deg)`;
        badgeW.innerHTML = `
            <span class="cad-dim-val">${valStrW}</span>
            <span class="cad-dim-unit">мм</span>
            ${rectLockedWidth !== null ? '<span style="font-size:11px;margin-left:2px;">🔒</span>' : ''}
        `;

        // Height Badge
        let valStrH = '';
        if (rectActiveDim === 1 && rectHeightStr !== '') {
            valStrH = rectHeightStr + '<span class="cad-dim-cursor"></span>';
        } else if (rectLockedHeight !== null) {
            valStrH = rectLockedHeight.toFixed(1);
        } else if (rectActiveDim === 1 && rectHeightStr === '') {
            valStrH = rawH.toFixed(1) + '<span class="cad-dim-cursor"></span>';
        } else {
            valStrH = rawH.toFixed(1);
        }

        let clsH = `cad-dim-badge ${dimTheme} `;
        if (rectActiveDim === 1) clsH += 'active';
        else if (rectLockedHeight !== null) clsH += 'locked';
        else clsH += 'inactive';

        badgeH.className = clsH;
        badgeH.style.left = `${midH.x}px`;
        badgeH.style.top = `${midH.y}px`;
        badgeH.style.transform = `translate(-50%, -50%) rotate(${angleH}deg)`;
        badgeH.innerHTML = `
            <span class="cad-dim-val">${valStrH}</span>
            <span class="cad-dim-unit">мм</span>
            ${rectLockedHeight !== null ? '<span style="font-size:11px;margin-left:2px;">🔒</span>' : ''}
        `;

        badgeHint.style.display = 'block';
        badgeHint.innerHTML = `<kbd>Tab</kbd> выбор размера • <kbd>Числа</kbd> ввод • <kbd>BS/Del+Tab</kbd> сбросить заморозку`;
    }
}
window.updateRectCadDimensions = updateRectCadDimensions;
function updateRectDimensionHUD() { updateRectCadDimensions(); }
window.updateRectDimensionHUD = updateRectDimensionHUD;

window.clearExtrudePhantom = function() {
    if (sketchExtrudePhantom) {
        if (typeof creatorScene !== 'undefined' && creatorScene) {
            creatorScene.remove(sketchExtrudePhantom);
        }
        if (typeof disposeHierarchy === 'function') {
            disposeHierarchy(sketchExtrudePhantom);
        }
        sketchExtrudePhantom = null;
    }
};

function getNaturalPlaneBasis(worldNormal, currentCam) {
    let n = worldNormal.clone().normalize();
    let up = currentCam ? currentCam.up.clone().projectOnPlane(n) : new THREE.Vector3();
    
    if (up.lengthSq() < 0.001) {
        if (Math.abs(n.y) > 0.9) {
            up.set(0, 0, -1).projectOnPlane(n);
        } else {
            up.set(0, 1, 0).projectOnPlane(n);
            if (up.lengthSq() < 0.001) {
                up.set(0, 0, 1).projectOnPlane(n);
            }
        }
    }
    up.normalize();

    let right = new THREE.Vector3().crossVectors(up, n).normalize();
    up.crossVectors(n, right).normalize();

    return { normal: n, up: up, right: right };
}

window.updateExtrudePhantom = function() {
    window.clearExtrudePhantom();
    if (!activeSketchPlane || (sketchSegments.length === 0 && sketchCircles.length === 0)) {
        return;
    }

    const depthInput = document.getElementById('qi-extrude-depth');
    const angleInput = document.getElementById('qi-extrude-angle');

    let depth = depthInput ? parseFloat(depthInput.value) : 10;
    if (isNaN(depth) || depth === 0) depth = 10;
    let angle = angleInput ? parseFloat(angleInput.value) : 0;
    if (isNaN(angle)) angle = 0;

    const plane = activeSketchPlane;
    const phantomMesh = performExtrusion(sketchSegments, sketchCircles, plane.userData.up, plane.userData.normal, depth, angle);

    if (phantomMesh) {
        if (plane.userData && plane.userData.origin) {
            phantomMesh.position.copy(plane.userData.origin);
        }
        phantomMesh.material = new THREE.MeshStandardMaterial({
            color: 0x5AAFDD,
            transparent: true,
            opacity: 0.45,
            roughness: 0.4,
            metalness: 0.2,
            depthWrite: false
        });
        phantomMesh.userData.isPhantom = true;
        sketchExtrudePhantom = phantomMesh;
        creatorScene.add(sketchExtrudePhantom);
    }

    const panel = document.getElementById('quick-input-extrude');
    if (panel && panel.classList.contains('show-preview') && typeof updatePreview === 'function') {
        updatePreview('extrude');
    }
};

const phantomMaterial = new THREE.LineDashedMaterial({
    color: 0x3399FF,       // Яркий синий для лучшей видимости
    dashSize: 4,           // Увеличенный размер штриха
    gapSize: 2,            // Увеличенный размер промежутка
    transparent: true,
    opacity: 0.85,         // Повышенная непрозрачность
    depthTest: false       // Чтобы фантом не перекрывался сеткой плоскости
});

let sketchHudTooltip = null;
let sketchRadialMenu = null;

let sketchRaycaster = new THREE.Raycaster();
let sketchMouse = new THREE.Vector2();

// Глобальные переменные Гизмо/Слипания
let mateState = 0;
let mateObjectA = null;
let mateFaceA = null;
let mateHighlightA = null;
let mateObjectB = null;
let mateFaceB = null;
let mateHighlightB = null;
let allMates = [];
let mateHighlightGroup = null;
let mateUnfoldedHelper = null;

// Глобальные переменные Гизмо (Перемещение)
let customGizmo = null;
let gizmoState = 0; // 0: выкл, 1: ожидание выбора, 2: выбран объект
let selectedObjects = []; // массив выбранных объектов
let gizmoDragAxis = null;
let gizmoDragPlane = new THREE.Plane();
let gizmoDragStartPoint = new THREE.Vector3();
let gizmoStartPos = new THREE.Vector3();
let selectedObjectsStartData = [];
let hoveredGizmoPart = null;
let isGizmoDragging = false;
let activeGizmoInputAction = null;
function isGizmoPart(o) { if (!customGizmo || !o) return false; let c = o; let safety = 0; while (c) { if (safety++ > 1000) { console.warn("isGizmoPart infinite loop guard triggered."); return false; } if (c === customGizmo) return true; c = c.parent; } return false; }
let cutoutState = 0; // Состояние для инструмента выреза
let bendState = 0; // 0: off, 1: select edge
let bendHoverHighlight = null;
let bendHoverPhantom = null;
let bendSelectedEdges = []; // Array of objects { mesh, edge, sourceObject }
let bendPhantoms = [];

window.clearBendHoverPhantom = function() {
    if (typeof bendHoverPhantom !== 'undefined' && bendHoverPhantom) {
        if (typeof creatorScene !== 'undefined' && creatorScene) creatorScene.remove(bendHoverPhantom);
        if (bendHoverPhantom.geometry) bendHoverPhantom.geometry.dispose();
        if (bendHoverPhantom.material) bendHoverPhantom.material.dispose();
        bendHoverPhantom = null;
    }
};

// Глобальные переменные Привязки 3D к Спецификации
let linkState = 0;
let linkTargetRow = null;
let linkTargetBtn = null;

function initCustomGizmo() {
    customGizmo = new THREE.Group();
    
    // Улучшенные, более яркие "профессиональные" материалы для Гизмо
    const matX = new THREE.MeshBasicMaterial({ color: 0xE03030, depthTest: false, transparent: true, opacity: 0.9 });
    const matY = new THREE.MeshBasicMaterial({ color: 0x5AAFDD, depthTest: false, transparent: true, opacity: 0.9 });
    const matZ = new THREE.MeshBasicMaterial({ color: 0x3355CC, depthTest: false, transparent: true, opacity: 0.9 });
    const matXY = new THREE.MeshBasicMaterial({ color: 0x3355CC, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthTest: false }); // Z plane
    const matXZ = new THREE.MeshBasicMaterial({ color: 0x5AAFDD, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthTest: false }); // Y plane
    const matYZ = new THREE.MeshBasicMaterial({ color: 0xE03030, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthTest: false }); // X plane
    const matCenter = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false });

    const axisGeom = new THREE.CylinderGeometry(0.15, 0.15, 12, 16);
    axisGeom.translate(0, 6, 0);
    
    const scaleBoxGeom = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    scaleBoxGeom.translate(0, 8, 0); // Кубик масштабирования на отметке 8
    
    const coneGeom = new THREE.ConeGeometry(0.8, 2.5, 16);
    coneGeom.translate(0, 13.25, 0); // Стрелка на отметке 13.25

    const makeArrow = (mat, rotX, rotZ, axisName) => {
        const group = new THREE.Group();
        const mesh = new THREE.Mesh(axisGeom, mat.clone());
        const scaleBox = new THREE.Mesh(scaleBoxGeom, mat.clone());
        const cone = new THREE.Mesh(coneGeom, mat.clone());
        group.add(mesh, scaleBox, cone);
        group.rotation.x = rotX;
        group.rotation.z = rotZ;
        mesh.userData.gizmoAxis = axisName;
        scaleBox.userData.gizmoAxis = 'Scale' + axisName;
        cone.userData.gizmoAxis = axisName;
        mesh.userData.originalColor = mat.color.getHex();
        scaleBox.userData.originalColor = mat.color.getHex();
        cone.userData.originalColor = mat.color.getHex();
        return group;
    };

    const planeGeom = new THREE.PlaneGeometry(5, 5);
    const makePlane = (mat, rotX, rotY, pos, axisName) => {
        const mesh = new THREE.Mesh(planeGeom, mat.clone());
        mesh.rotation.x = rotX; mesh.rotation.y = rotY; mesh.position.copy(pos);
        mesh.userData.gizmoAxis = axisName; mesh.userData.originalColor = mat.color.getHex();
        return mesh;
    };

    const ringRadius = 13.25;
    const ringTube = 0.15;
    const torusGeom = new THREE.TorusGeometry(ringRadius, ringTube, 8, 64);
    const pointGeom = new THREE.SphereGeometry(0.3, 8, 8);

    const makeOrbital = (mat, rotX, rotY, rotZ, axisName) => {
        const group = new THREE.Group();
        const ring = new THREE.Mesh(torusGeom, mat.clone());
        ring.userData.gizmoAxis = 'Rotate' + axisName;
        ring.userData.originalColor = mat.color.getHex();
        group.add(ring);

        for (let i = 0; i < 24; i++) {
            const angle = (i * 15) * Math.PI / 180;
            const pt = new THREE.Mesh(pointGeom, matCenter.clone());
            pt.position.set(Math.cos(angle) * ringRadius, Math.sin(angle) * ringRadius, 0);
            pt.userData.gizmoAxis = 'Rotate' + axisName;
            pt.userData.originalColor = matCenter.color.getHex();
            group.add(pt);
        }
        group.rotation.set(rotX, rotY, rotZ);
        return group;
    };

    customGizmo.add(makeArrow(matX, 0, -Math.PI/2, 'X'), makeArrow(matY, 0, 0, 'Y'), makeArrow(matZ, Math.PI/2, 0, 'Z'));
    customGizmo.add(makePlane(matXY, 0, 0, new THREE.Vector3(2.5, 2.5, 0), 'XY'), makePlane(matXZ, Math.PI/2, 0, new THREE.Vector3(2.5, 0, 2.5), 'XZ'), makePlane(matYZ, 0, Math.PI/2, new THREE.Vector3(0, 2.5, 2.5), 'YZ'));
    customGizmo.add(makeOrbital(matZ, 0, 0, 0, 'Z'), makeOrbital(matX, 0, Math.PI/2, 0, 'X'), makeOrbital(matY, Math.PI/2, 0, 0, 'Y'));
    
    const centerBox = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), matCenter);
    centerBox.userData.gizmoAxis = 'XYZ';
    centerBox.userData.originalColor = matCenter.color.getHex();
    customGizmo.add(centerBox);
    
    customGizmo.renderOrder = 999; customGizmo.visible = false;
    creatorScene.add(customGizmo);
}

function initCreator3D() {
    if (creatorInitialized) return;

    // --- ПОЛУЧАЕМ ЭЛЕМЕНТЫ UI ДЛЯ ЭСКИЗА ---
    sketchHudTooltip = document.getElementById('sketch-hud-tooltip');
    sketchRadialMenu = document.getElementById('sketch-radial-menu');

    const canvas = document.getElementById('canvas-creator');
    if (!canvas) return;

    // Инициализация размеров
    const initWidth = canvas.clientWidth || 800;
    const initHeight = canvas.clientHeight || 600;
    const aspect = initWidth / initHeight;

    creatorScene = new THREE.Scene();

    // === PREVIEW INTERCEPTIONS ===
    const originalSceneAdd = creatorScene.add.bind(creatorScene);
    creatorScene.add = function(object) {
        if (window.isPreviewMode && (object.type === 'Mesh' || object.type === 'Group')) {
            window.previewMeshResult = object;
        } else if (!window.isPreviewMode) {
            originalSceneAdd(object);
        }
    };
    // =============================

    creatorScene.background = new THREE.Color(0xE8ECF1); 

    creatorCamera = new THREE.PerspectiveCamera(45, initWidth / initHeight, 0.05, 5000000);
    creatorCamera.position.set(200, 150, 200);
    
    // Ортографическая камера для эскизов
    const frustumSize = 400;
    creatorOrthoCamera = new THREE.OrthographicCamera(-frustumSize * aspect / 2, frustumSize * aspect / 2, frustumSize / 2, -frustumSize / 2, -5000000, 5000000);
    
    currentCreatorCamera = creatorCamera;

    creatorRenderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, logarithmicDepthBuffer: true });
    creatorRenderer.setSize(initWidth, initHeight);
    creatorRenderer.setPixelRatio(window.devicePixelRatio);

    creatorControls = new THREE.OrbitControls(currentCreatorCamera, creatorRenderer.domElement);
    creatorControls.enableDamping = true;
    creatorControls.dampingFactor = 0.05;
    creatorControls.minDistance = 0.01;
    creatorControls.maxDistance = 5000000;
    creatorControls.enableZoom = false; // Отключаем стандартный zoom, так как используем приближение к курсору
    creatorControls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

    // Приближение/отдаление всегда к позиции курсора (в 2D эскизе и в 3D пространстве)
    creatorRenderer.domElement.addEventListener('wheel', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (!creatorControls || !creatorControls.enabled) return;
        const camera = currentCreatorCamera;
        if (!camera) return;

        const rect = creatorRenderer.domElement.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        sketchMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        sketchMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 33;
        else if (e.deltaMode === 2) dy *= 100;

        const zoomFactor = Math.pow(1.0015, dy);

        if (camera.isOrthographicCamera) {
            // 2D эскиз (ортографическая камера)
            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(sketchMouse, camera);

            let plane;
            if (isSketchMode && activeSketchPlane) {
                const normal = activeSketchPlane.userData.normal ? activeSketchPlane.userData.normal.clone().normalize() : new THREE.Vector3(0, 0, 1);
                const planePoint = new THREE.Vector3();
                activeSketchPlane.getWorldPosition(planePoint);
                plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, planePoint);
            } else {
                const viewDir = new THREE.Vector3();
                camera.getWorldDirection(viewDir);
                plane = new THREE.Plane().setFromNormalAndCoplanarPoint(viewDir.clone().negate(), creatorControls.target);
            }

            const pBefore = new THREE.Vector3();
            const hitBefore = raycaster.ray.intersectPlane(plane, pBefore);

            let newZoom = camera.zoom / zoomFactor;
            newZoom = Math.max(0.000001, Math.min(newZoom, 5000000));
            camera.zoom = newZoom;
            camera.updateProjectionMatrix();

            raycaster.setFromCamera(sketchMouse, camera);
            const pAfter = new THREE.Vector3();
            const hitAfter = raycaster.ray.intersectPlane(plane, pAfter);

            if (hitBefore && hitAfter) {
                const shift = pBefore.clone().sub(pAfter);
                camera.position.add(shift);
                creatorControls.target.add(shift);
            }
            creatorControls.update();

            if (isSketchMode && activeSketchPlane) {
                sketchRaycaster.setFromCamera(sketchMouse, camera);
                const pt = getSketchPlaneIntersection(sketchRaycaster, activeSketchPlane);
                if (pt) {
                    lastMouseSketchPt = pt;
                    const snappedPt = applySnapsAndOrtho(pt, true);
                    if (currentDrawPoints.length > 0) {
                        updateTempShape(snappedPt);
                        if (sketchTool === 'rectangle' && currentDrawPoints.length === 1) {
                            if (typeof updateRectDimensionHUD === 'function') updateRectDimensionHUD();
                        }
                    }
                    if (sketchTool === 'trim' || sketchTool === 'extend' || sketchTool === 'chamfer' || sketchTool === 'fillet') {
                        if (typeof updateTopologyHover === 'function') updateTopologyHover(pt);
                    }
                }
                if (typeof updateSmartSnapHUD === 'function') updateSmartSnapHUD();
            }
        } else {
            // 3D пространство (перспективная камера)
            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(sketchMouse, camera);

            let targetPoint = null;

            if (creatorScene) {
                const intersects = raycaster.intersectObjects(creatorScene.children, true);
                for (let i = 0; i < intersects.length; i++) {
                    const hit = intersects[i];
                    if (!hit.object || !hit.object.visible) continue;
                    if (hit.object.type === 'GridHelper' || hit.object.type === 'Line' || hit.object.type === 'LineSegments') continue;
                    if (hit.object.name && (hit.object.name.includes('gizmo') || hit.object.name.includes('Helper') || hit.object.name.includes('Grid') || hit.object.name.includes('mate'))) continue;

                    let isHelperOrGizmo = false;
                    let p = hit.object;
                    while (p) {
                        if (p.name && (p.name.includes('gizmo') || p.name.includes('Helper') || p.name.includes('Grid') || p.name.includes('mate'))) {
                            isHelperOrGizmo = true;
                            break;
                        }
                        if (p.userData && (p.userData.isSketchPlane || p.userData.isMateHelperGroup || p.userData.isMateHelperFace || p.userData.isMateHighlight || p.userData.isMateSymbol || p.userData.isGizmo)) {
                            isHelperOrGizmo = true;
                            break;
                        }
                        p = p.parent;
                    }
                    if (isHelperOrGizmo) continue;

                    targetPoint = hit.point.clone();
                    break;
                }
            }

            if (!targetPoint) {
                const viewDir = new THREE.Vector3();
                camera.getWorldDirection(viewDir);
                const targetPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(viewDir.clone().negate(), creatorControls.target);
                targetPoint = new THREE.Vector3();
                const hit = raycaster.ray.intersectPlane(targetPlane, targetPoint);
                if (!hit) {
                    targetPoint.copy(creatorControls.target);
                }
            }

            const vCP = camera.position.clone().sub(targetPoint);
            const vTP = creatorControls.target.clone().sub(targetPoint);

            let factor = zoomFactor;
            let distToHit = vCP.length();
            if (distToHit < 1e-4) {
                vCP.set(0, 0, 1);
                distToHit = 1;
            }

            let newDist = distToHit * factor;
            // Предотвращаем уход камеры сквозь точку и гарантируем отсутствие исчезновения объектов
            if (newDist < 0.02) {
                factor = 0.02 / distToHit;
                newDist = 0.02;
            } else if (newDist > 10000000.0) {
                factor = 10000000.0 / distToHit;
                newDist = 10000000.0;
            }

            // Динамически адаптируем ближнюю и дальнюю плоскости отсечения
            camera.near = Math.min(0.05, Math.max(0.00001, newDist * 0.001));
            camera.far = Math.max(10000000.0, newDist * 20.0);
            camera.updateProjectionMatrix();

            const newCamPos = targetPoint.clone().add(vCP.multiplyScalar(factor));
            const newTarget = targetPoint.clone().add(vTP.multiplyScalar(factor));

            camera.position.copy(newCamPos);
            creatorControls.target.copy(newTarget);
            creatorControls.update();

            if (isSketchMode && activeSketchPlane) {
                sketchRaycaster.setFromCamera(sketchMouse, camera);
                const pt = getSketchPlaneIntersection(sketchRaycaster, activeSketchPlane);
                if (pt) {
                    lastMouseSketchPt = pt;
                    const snappedPt = applySnapsAndOrtho(pt, true);
                    if (currentDrawPoints.length > 0) {
                        updateTempShape(snappedPt);
                    }
                }
                if (typeof updateSmartSnapHUD === 'function') updateSmartSnapHUD();
            }
        }
    }, { passive: false });

    // Освещение сцены конструктора
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x7D8A9A, 0.8);
    creatorScene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight.position.set(200, 500, 300);
    creatorScene.add(dirLight);

    window.calculateGeometryVolume = function(geometry) {
        if (!geometry || !geometry.attributes || !geometry.attributes.position) return 0;
        const position = geometry.attributes.position;
        const index = geometry.index;
        const facesCount = index ? index.count / 3 : position.count / 3;
        let sum = 0;
        const p1 = new THREE.Vector3();
        const p2 = new THREE.Vector3();
        const p3 = new THREE.Vector3();
        const v3 = new THREE.Vector3();

        for (let i = 0; i < facesCount; i++) {
            let i1, i2, i3;
            if (index) {
                i1 = index.getX(i * 3);
                i2 = index.getX(i * 3 + 1);
                i3 = index.getX(i * 3 + 2);
            } else {
                i1 = i * 3;
                i2 = i * 3 + 1;
                i3 = i * 3 + 2;
            }

            p1.fromBufferAttribute(position, i1);
            p2.fromBufferAttribute(position, i2);
            p3.fromBufferAttribute(position, i3);

            v3.crossVectors(p2, p3);
            sum += p1.dot(v3);
        }
        return Math.abs(sum / 6.0);
    };

    window.getSketchPlaneIntersection = function(raycaster, planeMesh) {
        if (!planeMesh) return null;
        const planeOrigin = new THREE.Vector3();
        planeMesh.getWorldPosition(planeOrigin);

        const normalMatrix = new THREE.Matrix3().getNormalMatrix(planeMesh.matrixWorld);
        let worldNormal = new THREE.Vector3(0, 0, 1).applyMatrix3(normalMatrix).normalize();
        if (planeMesh.userData && planeMesh.userData.normal) {
            worldNormal = planeMesh.userData.normal.clone().normalize();
        }

        const mathPlane = new THREE.Plane();
        mathPlane.setFromNormalAndCoplanarPoint(worldNormal, planeOrigin);

        const targetPoint = new THREE.Vector3();
        const hit = raycaster.ray.intersectPlane(mathPlane, targetPoint);
        if (hit) {
            return targetPoint;
        }
        return null;
    };

    window.updateSketchGridPosition = function() {
        if (!isSketchMode || !activeSketchPlane || !activeSketchPlane.userData.gridHelper) return;
        const gridHelper = activeSketchPlane.userData.gridHelper;
        if (!gridHelper.visible) return;

        gridHelper.position.set(0, 0, 0.01);
    };

    function animateCreator() {
        requestAnimationFrame(animateCreator);
        const vCreator = document.getElementById('view-creator');
        if (vCreator && vCreator.style.display !== 'none') {
            creatorControls.update();
            if (isSketchMode && activeSketchPlane && activeSketchPlane.userData.gridHelper) {
                updateSketchGridPosition();
            }
            if (isSketchMode) {
                if (typeof window.updateActiveMirrorBadges === 'function') window.updateActiveMirrorBadges();
                if (sketchTool === 'rectangle' && currentDrawPoints.length === 1) {
                    updateRectCadDimensions();
                } else if (sketchTool === 'line') {
                    updateLineSegCadDimensions();
                } else if (sketchTool === 'chamfer') {
                    if (typeof window.updateChamferUIOverlay === 'function') window.updateChamferUIOverlay();
                } else if (sketchTool === 'fillet') {
                    if (typeof window.updateFilletUIOverlay === 'function') window.updateFilletUIOverlay();
                }
                if (typeof updateSmartSnapHUD === 'function') updateSmartSnapHUD();
            } else {
                const badges = document.querySelectorAll('.active-mirror-badge');
                if (badges.length > 0) badges.forEach(b => b.remove());
            }
            creatorRenderer.render(creatorScene, currentCreatorCamera);
            if (typeof updateMateUnfoldedHelperAnimation === 'function') {
                updateMateUnfoldedHelperAnimation();
            }
            if (window.isViewCubeActive && window.updateViewCubeOrientation) {
                window.updateViewCubeOrientation();
            }
            
            if (customGizmo && customGizmo.visible) {
                const dist = currentCreatorCamera.position.distanceTo(customGizmo.position);
                const scale = Math.max(dist / 100, 0.1);
                customGizmo.scale.setScalar(scale);
            }

            if (window.flattenMode && typeof window.updateFlattenButtonsPosition === 'function') {
                window.updateFlattenButtonsPosition();
            }

            const canvasRect = canvas.getBoundingClientRect();
            allMates.forEach(m => {
                if (!m.htmlElement) return;
                if (!showCreatorAnnotations) {
                    m.htmlElement.style.display = 'none';
                    return;
                }
                const worldPos = m.objA.localToWorld(m.faceA_localPoint.clone());
                const tempV = worldPos.clone().project(currentCreatorCamera);
                if (tempV.z > 1) { m.htmlElement.style.display = 'none'; } else {
                    m.htmlElement.style.display = 'block';
                    m.htmlElement.style.transform = `translate(${(tempV.x * 0.5 + 0.5) * canvasRect.width}px, ${(tempV.y * -0.5 + 0.5) * canvasRect.height}px)`;
                    m.htmlElement.style.zIndex = Math.round((1 - tempV.z) * 100);
                }
            });

            if (typeof window.allBends !== 'undefined' && Array.isArray(window.allBends)) {
                window.allBends.forEach(b => {
                    if (!b.htmlElement) return;
                    if (!showCreatorAnnotations || !b.object || !b.object.parent || !b.object.visible) {
                        b.htmlElement.style.display = 'none';
                        return;
                    }
                    const worldPos = b.object.localToWorld(b.localPoint.clone());
                    const tempV = worldPos.clone().project(currentCreatorCamera);
                    if (tempV.z > 1) {
                        b.htmlElement.style.display = 'none';
                    } else {
                        b.htmlElement.style.display = 'block';
                        b.htmlElement.style.transform = `translate(${(tempV.x * 0.5 + 0.5) * canvasRect.width}px, ${(tempV.y * -0.5 + 0.5) * canvasRect.height}px)`;
                        b.htmlElement.style.zIndex = Math.round((1 - tempV.z) * 100);
                    }
                });
            }

            if (typeof window.bendDimMarkers !== 'undefined' && Array.isArray(window.bendDimMarkers)) {
                window.bendDimMarkers.forEach(m => {
                    if (!m.htmlElement || !m.worldPos) return;
                    if (!showCreatorAnnotations) {
                        m.htmlElement.style.display = 'none';
                        return;
                    }
                    const tempV = m.worldPos.clone().project(currentCreatorCamera);
                    if (tempV.z > 1) {
                        m.htmlElement.style.display = 'none';
                    } else {
                        m.htmlElement.style.display = 'block';
                        m.htmlElement.style.transform = `translate(${(tempV.x * 0.5 + 0.5) * canvasRect.width}px, ${(tempV.y * -0.5 + 0.5) * canvasRect.height}px)`;
                        m.htmlElement.style.zIndex = Math.round((1 - tempV.z) * 100);
                    }
                });
            }
        }
    }
    animateCreator();

    // Замена window.resize на ResizeObserver для плавного заполнения холста при скрытии панелей
    const canvasParent = canvas.parentElement;
    const resizeObserver = new ResizeObserver(() => {
        const vCreator = document.getElementById('view-creator');
        if (vCreator && vCreator.style.display !== 'none') {
            const w = canvasParent.clientWidth;
            const h = canvasParent.clientHeight;
            if (w === 0 || h === 0) return;
            const aspect = w / h;
            
            creatorCamera.aspect = aspect;
            creatorCamera.updateProjectionMatrix();
            
            creatorOrthoCamera.left = -frustumSize * aspect / 2;
            creatorOrthoCamera.right = frustumSize * aspect / 2;
            creatorOrthoCamera.updateProjectionMatrix();
            
            creatorRenderer.setSize(w, h);
            creatorRenderer.render(creatorScene, currentCreatorCamera);
        }
    });
    resizeObserver.observe(canvasParent);

    // Инициализация маркера привязки
    snapMarker = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 16), new THREE.MeshBasicMaterial({color: 0xE03030, depthTest: false}));
    snapMarker.visible = false;
    creatorScene.add(snapMarker);

    mateHighlightGroup = new THREE.Group();
    creatorScene.add(mateHighlightGroup);

    initBulbProfiles();
    initAngleProfiles();
    initChannelProfiles();
    setupSketchInteraction(canvas);
    initCustomGizmo();
    creatorInitialized = true;
    setupCreatorInputs();
    init3DIcons(); // Инициализация 3D-заменителей для иконок
}

window.isCommandActive = function(toolId) {
    const btn = document.getElementById(toolId);
    return btn && btn.classList.contains('active-tool');
};

window.setCreatorActiveTool = function(toolId) {
    const toolSections = ['section-primitives', 'section-profiles', 'section-gizmo', 'section-sketch-create'];
    toolSections.forEach(secId => {
        const sec = document.getElementById(secId);
        if (!sec) return;
        if (!toolId) {
            sec.style.display = 'block';
            sec.querySelectorAll('.creator-tool-btn').forEach(btn => {
                btn.style.display = 'flex';
                btn.classList.remove('active-tool');
            });
        } else {
            const btn = document.getElementById(toolId);
            if (btn && sec.contains(btn)) {
                sec.style.display = 'block';
                sec.querySelectorAll('.creator-tool-btn').forEach(b => {
                    if (b.id === toolId) {
                        b.style.display = 'flex';
                        b.classList.add('active-tool');
                    } else {
                        b.style.display = 'none';
                    }
                });
            } else {
                sec.style.display = 'none';
            }
        }
    });
};

// --- ЛОГИКА БЫСТРОЙ ПАНЕЛИ (РАДИАЛЬНОЕ МЕНЮ И ОКНО ВВОДА) ---
window.openRadialMenu = function(x, y, hasSelection = false) {
    window.closeQuickPanels();
    const menu = document.getElementById('radial-menu');
    
    if (menu) {
        // Показываем нужный набор кнопок в зависимости от того, есть ли выделенный объект
        const emptyMenu = document.getElementById('radial-menu-empty');
        const selectedMenu = document.getElementById('radial-menu-selected');
        if (emptyMenu) emptyMenu.style.display = hasSelection ? 'none' : 'block';
        if (selectedMenu) selectedMenu.style.display = hasSelection ? 'block' : 'none';

        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.classList.add('active');
    }
    
    function closeMenu(evt) {
        const rm = document.getElementById('radial-menu');
        if (rm && rm.contains(evt.target)) return;
        
        let insideQuickPanel = false;
        ['plate', 'cylinder', 'pipe', 'knitsa', 'profile', 'bulbbar', 'angle', 'channel', 'panel', 'extrude', 'thickness', 'bend'].forEach(id => {
            const p = document.getElementById('quick-input-' + id);
            if (p && p.contains(evt.target)) insideQuickPanel = true;
        });
        if (insideQuickPanel) return;

        window.closeQuickPanels();
        document.removeEventListener('mousedown', window._radialCloseHandler);
    }
    
    if (window._radialCloseHandler) {
        document.removeEventListener('mousedown', window._radialCloseHandler);
    }
    window._radialCloseHandler = closeMenu;
    setTimeout(() => document.addEventListener('mousedown', window._radialCloseHandler), 50);
};

window.openQuickItem = function(id, focusId) {
    const menu = document.getElementById('radial-menu');
    const quickPanel = document.getElementById('quick-input-' + id);
    
    if (menu && quickPanel) {
        menu.classList.remove('active');
        
        if (!quickPanel.dataset.userMoved && (!quickPanel.style.left || quickPanel.style.left === '50%')) {
            quickPanel.style.left = '50%';
            quickPanel.style.top = '50%';
            quickPanel.style.transform = 'translate(-50%, -50%)';
        }
        quickPanel.classList.add('active');
        
        // Подтягиваем сгенерированную 3D-иконку из базы
        const origImg = document.getElementById('radial-icon-' + id) || document.getElementById('icon-' + id);
        const img = document.getElementById('quick-icon-' + id);
        if (img && origImg && origImg.src) img.src = origImg.src;

            // Очищаем все поля ввода при открытии
            const inputs = quickPanel.querySelectorAll('input[type="number"], input[type="text"]');
            inputs.forEach(inp => inp.value = '');

        setTimeout(() => {
            const f = document.getElementById(focusId);
                if (f) { f.focus(); }
        }, 250);
    }
};

window.openQuickPlate = () => window.openQuickItem('plate', 'qi-plate-t');
window.openQuickBend = () => {
    window.startBendCommand();
};
window.openQuickCylinder = () => window.openQuickItem('cylinder', 'qi-cyl-d');
window.openQuickPipe = () => window.openQuickItem('pipe', 'qi-pipe-d');
window.openQuickKnitsa = () => window.openQuickItem('knitsa', 'qi-kn-h');
window.openQuickProfile = () => {
    window.openQuickItem('profile', 'qi-profile-category');
    const catInput = document.getElementById('qi-profile-category');
    if (catInput) {
        catInput.value = '';
        if (typeof window.onProfileCategoryInput === 'function') {
            window.onProfileCategoryInput('');
        }
        setTimeout(() => {
            catInput.focus();
        }, 20);
    }
    const typeInput = document.getElementById('qi-profile-type');
    if (typeInput) {
        typeInput.value = '';
        typeInput.placeholder = 'HP 200x12, L 50x50x5...';
    }
    const lInput = document.getElementById('qi-profile-l');
    if (lInput) lInput.value = '';
};
window.openQuickBulbbar = () => window.openQuickItem('bulbbar', 'qi-bulbbar-type');
window.openQuickAngle = () => window.openQuickItem('angle', 'qi-angle-type');
window.openQuickChannel = () => window.openQuickItem('channel', 'qi-channel-type');
window.openQuickPanel = function() {
    window.openQuickItem('panel', 'qi-panel-t');

    // Поля панели изначально должны быть пустыми
    const tInp = document.getElementById('qi-panel-t');
    const wInp = document.getElementById('qi-panel-w');
    const lInp = document.getElementById('qi-panel-l');
    const profInp = document.getElementById('qi-panel-profile');
    const spInp = document.getElementById('qi-panel-spacing');

    if (tInp) tInp.value = '';
    if (wInp) wInp.value = '';
    if (lInp) lInp.value = '';
    if (profInp) profInp.value = '';
    if (spInp) spInp.value = '';

    window.panelStiffeners = [];
    if (typeof window.renderPanelTable === 'function') window.renderPanelTable();
    if (typeof window.renderPanel2DScheme === 'function') window.renderPanel2DScheme();

    setTimeout(() => {
        if (typeof window.initPanel2DCanvas === 'function') window.initPanel2DCanvas();
        if (typeof window.resetPanel2DView === 'function') window.resetPanel2DView();
    }, 60);
};

window.closeQuickPanels = function() {
    if (typeof window.clearExtrudePhantom === 'function') {
        window.clearExtrudePhantom();
    }
    if (typeof window.clearPipeHoleSelection === 'function') {
        window.clearPipeHoleSelection();
    }
    if (typeof clearHoleHighlight === 'function') {
        clearHoleHighlight();
    }
    ['plate', 'cylinder', 'pipe', 'knitsa', 'profile', 'bulbbar', 'angle', 'channel', 'panel', 'extrude', 'thickness', 'bend'].forEach(id => {
        const p = document.getElementById('quick-input-' + id);
        if (p) {
            p.classList.remove('active');
            p.classList.remove('show-radius-selector');
        }
    });
    const rm = document.getElementById('radial-menu');
    if (rm) {
        rm.classList.remove('active');
    }
    if (typeof bendState !== 'undefined' && bendState === 2) {
        bendState = 0;
        if (typeof bendSelectedEdges !== 'undefined') bendSelectedEdges = [];
        if (typeof clearBendPhantoms === 'function') clearBendPhantoms();
        if (typeof bendHoverHighlight !== 'undefined' && bendHoverHighlight) {
            if (typeof creatorScene !== 'undefined' && creatorScene) creatorScene.remove(bendHoverHighlight);
            if (bendHoverHighlight.geometry) bendHoverHighlight.geometry.dispose();
            if (bendHoverHighlight.material) bendHoverHighlight.material.dispose();
            bendHoverHighlight = null;
        }
        if (typeof setCreatorActiveTool === 'function') setCreatorActiveTool(null);
        if (typeof setCreatorUIMode === 'function') setCreatorUIMode('default');
    }
};

window.resetToSelectMode = function() {
    if (typeof isSketchMode !== 'undefined' && isSketchMode) {
        if (typeof setSketchTool === 'function') {
            setSketchTool(null);
        } else if (typeof sketchTool !== 'undefined') {
            sketchTool = null;
        }
        if (typeof currentDrawPoints !== 'undefined') {
            currentDrawPoints = [];
        }
        if (typeof tempShapePreview !== 'undefined' && tempShapePreview) {
            tempShapePreview.visible = false;
        }
        if (typeof trimExtendPreview !== 'undefined' && trimExtendPreview) {
            trimExtendPreview.visible = false;
        }
        if (typeof sketchHudTooltip !== 'undefined' && sketchHudTooltip) {
            sketchHudTooltip.style.display = 'none';
        }
        if (typeof closeSketchRadialMenu === 'function') {
            closeSketchRadialMenu();
        }
        if (typeof showToast === 'function') {
            showToast("Сброс инструментов. Выбор объектов эскиза");
        }
    } else {
        if (typeof cancelAllCommands === 'function') {
            cancelAllCommands();
        }
        if (typeof setCreatorActiveTool === 'function') {
            setCreatorActiveTool(null);
        }
        if (typeof closeQuickPanels === 'function') {
            closeQuickPanels();
        }
        if (typeof showToast === 'function') {
            showToast("Сброс команд. Выбор объектов");
        }
    }
};

window.applyQuickPlate = function() {
    const t = parseFloat(document.getElementById('qi-plate-t').value);
    const w = parseFloat(document.getElementById('qi-plate-w').value);
    const l = parseFloat(document.getElementById('qi-plate-l').value);
    
    if (!isNaN(t) && !isNaN(w) && !isNaN(l) && t > 0 && w > 0 && l > 0) {
        createPlate(t, w, l);
        if (typeof cancelSketch === "function" && !window.isPreviewMode) cancelSketch();
        window.closeQuickPanels();
        const canvas = document.getElementById('canvas-creator');
        if(canvas) canvas.focus(); // Возвращаем фокус на 3D сцену
    } else {
        if (typeof showToast === 'function') showToast("Введите корректные размеры больше нуля");
    }
};

window.applyQuickCylinder = function() {
    const d = parseFloat(document.getElementById('qi-cyl-d').value);
    const l = parseFloat(document.getElementById('qi-cyl-l').value);
    if (!isNaN(d) && !isNaN(l) && d > 0 && l > 0) {
        createCylinder(d, l);
        if (typeof cancelSketch === "function" && !window.isPreviewMode) cancelSketch();
        window.closeQuickPanels();
        const canvas = document.getElementById('canvas-creator');
        if(canvas) canvas.focus();
    } else {
        if (typeof showToast === 'function') showToast("Введите корректные размеры");
    }
};

window.applyQuickPipe = function() {
    const d = parseFloat(document.getElementById('qi-pipe-d').value);
    const t = parseFloat(document.getElementById('qi-pipe-t').value);
    const l = parseFloat(document.getElementById('qi-pipe-l').value);
    const absT = Math.abs(t);
    if (!isNaN(d) && !isNaN(t) && !isNaN(l) && d > 0 && absT > 0 && l > 0 && (t < 0 || t < d / 2)) {
        createPipe(d, t, l);
        if (typeof cancelSketch === "function" && !window.isPreviewMode) cancelSketch();
        window.closeQuickPanels();
        const canvas = document.getElementById('canvas-creator');
        if(canvas) canvas.focus();
    } else {
        if (typeof showToast === 'function') showToast("Введите корректные размеры");
    }
};

window.applyQuickKnitsa = function() {
    const h = parseFloat(document.getElementById('qi-kn-h').value);
    const l = parseFloat(document.getElementById('qi-kn-l').value);
    const hbot = parseFloat(document.getElementById('qi-kn-hbot').value) || 0;
    const wtop = parseFloat(document.getElementById('qi-kn-wtop').value) || 0;
    const c = parseFloat(document.getElementById('qi-kn-c').value) || 0;
    const th = parseFloat(document.getElementById('qi-kn-th').value);
    const hasflEl = document.getElementById('qi-kn-hasfl');
    const hasFl = hasflEl ? hasflEl.checked : false;
    const flw = parseFloat(document.getElementById('qi-kn-flw').value) || 0;

    if (!isNaN(h) && !isNaN(l) && !isNaN(th) && h > 0 && l > 0 && th > 0) {
        createKnitsa(h, l, hbot, wtop, c, th, hasFl, flw);
        if (typeof cancelSketch === "function" && !window.isPreviewMode) cancelSketch();
        window.closeQuickPanels();
        const canvas = document.getElementById('canvas-creator');
        if(canvas) canvas.focus();
    } else {
        if (typeof showToast === 'function') showToast("Введите корректные размеры");
    }
};

window.applyQuickBulbbar = function() {
    const type = document.getElementById('qi-bulbbar-type').value;
    const l = parseFloat(document.getElementById('qi-bulbbar-l').value);
    if (type && !isNaN(l) && l > 0) {
        createBulbBar(type, l);
        if (typeof cancelSketch === "function" && !window.isPreviewMode) cancelSketch();
        window.closeQuickPanels();
        const canvas = document.getElementById('canvas-creator');
        if(canvas) canvas.focus();
    } else {
        if (typeof showToast === 'function') showToast("Выберите тип и длину");
    }
};

window.applyQuickAngle = function() {
    const type = document.getElementById('qi-angle-type').value;
    const l = parseFloat(document.getElementById('qi-angle-l').value);
    if (type && !isNaN(l) && l > 0) {
        createAngleBar(type, l);
        if (typeof cancelSketch === "function" && !window.isPreviewMode) cancelSketch();
        window.closeQuickPanels();
        const canvas = document.getElementById('canvas-creator');
        if(canvas) canvas.focus();
    } else {
        if (typeof showToast === 'function') showToast("Выберите тип и длину");
    }
};

window.applyQuickChannel = function() {
    const type = document.getElementById('qi-channel-type').value;
    const l = parseFloat(document.getElementById('qi-channel-l').value);
    if (type && !isNaN(l) && l > 0) {
        createChannelBar(type, l);
        if (typeof cancelSketch === "function" && !window.isPreviewMode) cancelSketch();
        window.closeQuickPanels();
        const canvas = document.getElementById('canvas-creator');
        if(canvas) canvas.focus();
    } else {
        if (typeof showToast === 'function') showToast("Выберите тип и длину");
    }
};

window.applyQuickPanel = function() {
    const t = parseFloat(document.getElementById('qi-panel-t')?.value);
    const w = parseFloat(document.getElementById('qi-panel-w')?.value);
    const l = parseFloat(document.getElementById('qi-panel-l')?.value);
    const prof = (document.getElementById('qi-panel-profile')?.value || "").trim() || "HP 160x8";
    const spacing = parseFloat(document.getElementById('qi-panel-spacing')?.value) || 500;

    if (!isNaN(t) && !isNaN(w) && !isNaN(l) && t > 0 && w > 0 && l > 0) {
        createPanel(t, w, l, prof, spacing, 'width', window.panelStiffeners);
        if (typeof cancelSketch === "function" && !window.isPreviewMode) cancelSketch();
        if (!window.isPreviewMode) window.closeQuickPanels();
        const canvas = document.getElementById('canvas-creator');
        if(canvas) canvas.focus();
    } else {
        if (typeof showToast === 'function' && !window.isPreviewMode) showToast("Введите корректные размеры панели (толщина, ширина, длина)");
    }
};

window.applyQuickProfile = function() {
    const rawCategory = document.getElementById('qi-profile-category')?.value || '';
    const category = typeof window.detectProfileCategory === 'function' ? window.detectProfileCategory(rawCategory) : 'bulbbar';
    let type = (document.getElementById('qi-profile-type')?.value || '').trim();
    const l = parseFloat(document.getElementById('qi-profile-l')?.value) || 1000;

    const isPipeSelection = category === 'pipe' || (selectedPipeHole && (!type || category === 'pipe'));

    if (!isPipeSelection && (!type || isNaN(l) || l <= 0)) {
        if (typeof showToast === 'function' && !window.isPreviewMode) showToast("Введите номер профиля и длину больше нуля!");
        return;
    }

    const typeLower = type.toLowerCase();

    // 1. Прямой выбор категории Труба или формат D... / Труба... / ⌀... / 108x4 / Выбранное отверстие
    if (category === 'pipe' || typeLower.startsWith('труба') || /^[dдиам⌀]/i.test(type) || selectedPipeHole || /^\d+(\.\d+)?\s*[xх*x\s/]\s*-?\d+/i.test(type)) {
        let d = selectedPipeHole ? selectedPipeHole.diameter : 108;
        let t = 4;

        if (type) {
            const clean = type.replace(/^(труба|d|диам|диаметр|⌀)\s*/i, '').trim();
            const parts = clean.split(/[xх*x\s/]+/).filter(Boolean).map(parseFloat);
            if (parts.length >= 1 && !isNaN(parts[0]) && parts[0] > 0) {
                d = parts[0];
            }
            if (parts.length >= 2 && !isNaN(parts[1]) && parts[1] !== 0) {
                t = parts[1];
            }
        }

        createPipe(d, t, l);
    }
    // 2. Прямой выбор категории Полособульб или префикс HP / полособульб
    else if (category === 'bulbbar' || typeLower.startsWith('hp') || typeLower.startsWith('полособульб')) {
        createBulbBar(type, l);
    }
    // 3. Прямой выбор категории Уголок или префикс L / уголок
    else if (category === 'angle' || typeLower.startsWith('l ') || typeLower.startsWith('l') || typeLower.startsWith('уголок')) {
        createAngleBar(type, l);
    }
    // 4. Прямой выбор категории Швеллер или префикс Швеллер / суффикс П, У
    else if (category === 'channel' || typeLower.startsWith('швеллер') || /^\d+[пуayx]$/i.test(typeLower)) {
        createChannelBar(type, l);
    }
    // 5. Автоопределение по базам и шаблонам
    else {
        if (typeof initBulbProfiles === 'function' && (!BulbProfiles || Object.keys(BulbProfiles).length === 0)) initBulbProfiles();
        if (typeof initAngleProfiles === 'function' && (!AngleProfiles || Object.keys(AngleProfiles).length === 0)) initAngleProfiles();
        if (typeof initChannelProfiles === 'function' && (!ChannelParams || Object.keys(ChannelParams).length === 0)) initChannelProfiles();

        const bulbDict = (window.BulbProfiles && Object.keys(window.BulbProfiles).length > 0) ? window.BulbProfiles : BulbProfiles;
        const angleDict = (window.AngleProfiles && Object.keys(window.AngleProfiles).length > 0) ? window.AngleProfiles : AngleProfiles;
        const channelDict = (window.ChannelParams && Object.keys(window.ChannelParams).length > 0) ? window.ChannelParams : ChannelParams;

        const clean = type.replace(/[хx\s]/gi, '').toLowerCase();

        const isBulb = bulbDict && (bulbDict[type] || Object.keys(bulbDict).some(k => k.replace(/[хx\s]/gi, '').toLowerCase() === clean) || typeLower.startsWith('hp'));
        const isAngle = angleDict && (angleDict[type] || Object.keys(angleDict).some(k => k.replace(/[хx\s]/gi, '').toLowerCase() === clean) || typeLower.startsWith('l') || typeLower.startsWith('уголок'));
        const isChannel = channelDict && (channelDict[type] || Object.keys(channelDict).some(k => k.replace(/[хx\s]/gi, '').toLowerCase() === clean) || typeLower.startsWith('швеллер') || /^\d+[пуayx]$/i.test(typeLower));
        const isPipePattern = /^(\d+(\.\d+)?)\s*[xх*x\s/]\s*(-?\d+(\.\d+)?)$/i.test(type.replace(/^(труба|d|диам|диаметр|⌀)\s*/i, ''));

        if (isBulb) {
            createBulbBar(type, l);
        } else if (isAngle) {
            createAngleBar(type, l);
        } else if (isChannel) {
            createChannelBar(type, l);
        } else if (isPipePattern) {
            const cleanPipe = type.replace(/^(труба|d|диам|диаметр|⌀)\s*/i, '').trim();
            const parts = cleanPipe.split(/[xх*x\s/]+/).filter(Boolean).map(parseFloat);
            let d = (parts.length >= 1 && !isNaN(parts[0]) && parts[0] > 0) ? parts[0] : (selectedPipeHole ? selectedPipeHole.diameter : 108);
            let t = (parts.length >= 2 && !isNaN(parts[1]) && parts[1] !== 0) ? parts[1] : 4;
            createPipe(d, t, l);
        } else {
            createBulbBar(type, l);
        }
    }

    if (typeof cancelSketch === "function" && !window.isPreviewMode) cancelSketch();
    if (!window.isPreviewMode) window.closeQuickPanels();
    const canvas = document.getElementById('canvas-creator');
    if (canvas) canvas.focus();
};

window.cancelAllCommands = function() {
    if (typeof clearHoleHighlight === 'function') clearHoleHighlight();
    if (typeof clearPipeHoleSelection === 'function') clearPipeHoleSelection();
    if (window.flattenMode && typeof window.exitFlattenMode === 'function') {
        window.exitFlattenMode();
    }
    hideAllCreatorPanels();
    cancelGizmo();
    document.querySelectorAll('.spec-table-row.selected-row').forEach(r => r.classList.remove('selected-row'));
    const rm = document.getElementById('radial-menu');
    if (rm) rm.classList.remove('active');
    cutoutState = 0;
    bendState = 0;
    if (bendHoverHighlight) {
        creatorScene.remove(bendHoverHighlight);
        if(bendHoverHighlight.geometry) bendHoverHighlight.geometry.dispose();
        if(bendHoverHighlight.material) bendHoverHighlight.material.dispose();
        bendHoverHighlight = null;
    }
    clearBendHoverPhantom();
    if (typeof bendSelectedEdges !== 'undefined') {
        bendSelectedEdges = [];
    }
    if (typeof clearBendPhantoms === 'function') clearBendPhantoms();
    // Принудительно скрываем HUD эскиза, даже если сам режим уже был завершен
    if (sketchHudTooltip) {
        sketchHudTooltip.style.display = 'none';
        sketchHudTooltip.innerText = '';
    }
    if (isSketchMode) cancelSketch();
    mateState = 0;
    closeMateHelperBox();
    if (mateHighlightA) {
        creatorScene.remove(mateHighlightA);
        if (mateHighlightA.geometry) mateHighlightA.geometry.dispose();
        if (mateHighlightA.material) mateHighlightA.material.dispose();
        mateHighlightA = null;
    }
    if (mateHighlightB) {
        creatorScene.remove(mateHighlightB);
        if (mateHighlightB.geometry) mateHighlightB.geometry.dispose();
        if (mateHighlightB.material) mateHighlightB.material.dispose();
        mateHighlightB = null;
    }
    clearMateHighlightGroup();
    linkState = 0;
    linkTargetRow = null;
    linkTargetBtn = null;
    if (window.setCreatorActiveTool) window.setCreatorActiveTool(null);
    if (window.closeQuickPanels) window.closeQuickPanels();
    const skTools = document.getElementById('sketch-tools');
    const canvas = document.getElementById('canvas-creator');
    if(skTools) skTools.style.display = 'none';
    if(canvas) canvas.style.cursor = 'default';
};

function setCreatorUIMode(mode) {
    const skTools = document.getElementById('sketch-tools');
    const canvas = document.getElementById('canvas-creator');
    
    if (mode === 'default') {
        if(skTools) skTools.style.display = 'none';
        if(canvas) canvas.style.cursor = 'default';
    } else if (mode === 'sketch-select') {
        if(skTools) skTools.style.display = 'none';
        if(canvas) canvas.style.cursor = 'crosshair';
    } else if (mode === 'sketch-draw') {
        if(skTools) skTools.style.display = 'block';
        if(canvas) canvas.style.cursor = 'crosshair';
    } else if (mode === 'mate-select') {
        if(skTools) skTools.style.display = 'none';
        if(canvas) canvas.style.cursor = 'crosshair';
        } else if (mode === 'link-select') {
            if(skTools) skTools.style.display = 'none';
            if(canvas) canvas.style.cursor = 'pointer';
    }

    // Toggle right panel empty state for 2D sketch mode
    const isSketch = (typeof isSketchMode !== 'undefined' && isSketchMode);
    const rightHeader = document.querySelector('#creator-right-panel .table-header');
    const rightScroll = document.getElementById('right-panel-scroll-container');
    if (rightHeader) rightHeader.style.display = isSketch ? 'none' : 'flex';
    if (rightScroll) rightScroll.style.display = isSketch ? 'none' : 'flex';
}

function hideAllCreatorPanels() {
    const container = document.getElementById('creator-inputs-container');
    if (container) {
        container.style.display = 'none';
        const inputs = container.querySelectorAll('input[type="number"], input[type="text"]');
        inputs.forEach(inp => inp.value = '');
    }
    ['plate-inputs', 'cylinder-inputs', 'pipe-inputs', 'bulbbar-inputs', 'angle-inputs', 'channel-inputs', 'cutout-inputs', 'knitsa-inputs'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
}

window.startLinkMode = function(tr, btn) {
    cancelAllCommands();
    linkState = 1;
    linkTargetRow = tr;
    linkTargetBtn = btn;
    setCreatorUIMode('link-select');
    if (typeof showToast === 'function') showToast("Кликните по 3D-модели для привязки к строке спецификации");
};

window.startBendCommand = function() {
    if (typeof selectedObjects !== 'undefined' && selectedObjects.length > 0 && typeof window.isProfileObject === 'function' && window.isProfileObject(selectedObjects[0])) {
        if (typeof showToast === 'function') showToast("Гибка недоступна для объектов типа Профиль (работает только для листовых деталей)!");
        cancelAllCommands();
        return;
    }
    if (window.isCommandActive && window.isCommandActive('tool-bend')) {
        cancelAllCommands();
        return;
    }
    cancelAllCommands();
    if (typeof window.closeQuickPanels === 'function') {
        window.closeQuickPanels();
    }

    setCreatorActiveTool('tool-bend');
    hideAllCreatorPanels();
    const ciContainer = document.getElementById('creator-inputs-container');
    if (ciContainer) ciContainer.style.display = 'block';
    const bendInputs = document.getElementById('bend-inputs');
    if (bendInputs) bendInputs.style.display = 'flex';

    const quickPanel = document.getElementById('quick-input-bend');
    if (quickPanel) {
        if (!quickPanel.dataset.userMoved && (!quickPanel.style.left || quickPanel.style.left === '50%')) {
            quickPanel.style.left = '50%';
            quickPanel.style.top = '50%';
            quickPanel.style.transform = 'translate(-50%, -50%)';
        }
        quickPanel.classList.add('active');
        const origImg = document.getElementById('radial-icon-bend') || document.getElementById('icon-bend');
        const img = document.getElementById('quick-icon-bend');
        if (img && origImg && origImg.src) img.src = origImg.src;
    }

    bendState = 1; 
    if (bendHoverHighlight) {
        creatorScene.remove(bendHoverHighlight);
        if (bendHoverHighlight.geometry) bendHoverHighlight.geometry.dispose();
        if (bendHoverHighlight.material) bendHoverHighlight.material.dispose();
        bendHoverHighlight = null;
    }
    bendSelectedEdges = [];
    if (typeof clearBendPhantoms === 'function') clearBendPhantoms();
    setCreatorUIMode('mate-select');
    if (typeof showToast === 'function') showToast("Выберите торец детали для гиба");
};

function safeTraverse(entity, callback) {
    if (!entity) return;
    const visited = new Set();
    const stack = [entity];
    let safety = 0;
    while (stack.length > 0 && safety++ < 5000) {
        const obj = stack.pop();
        if (!obj || visited.has(obj)) continue;
        visited.add(obj);
        try {
            callback(obj);
        } catch (err) {
            console.error("Error in safeTraverse callback:", err);
        }
        if (obj.children && Array.isArray(obj.children)) {
            for (let i = 0; i < obj.children.length; i++) {
                const child = obj.children[i];
                if (child && !visited.has(child)) {
                    stack.push(child);
                }
            }
        }
    }
}

function getUnifiedSelectableEntity(obj) {
    if (!obj) return null;
    let curr = obj;
    let target = obj;
    let safety = 0;
    const visited = new Set();
    while (curr && curr !== creatorScene && safety++ < 200) {
        if (visited.has(curr)) break;
        visited.add(curr);
        if (curr.userData) {
            if (curr.userData.parentUnifiedGroup) {
                target = curr.userData.parentUnifiedGroup;
            } else if (curr.userData.isUnifiedGroup || curr.userData.specData?.type === 'panel') {
                target = curr;
            }
        }
        curr = curr.parent;
    }
    return target;
}

function setEntitySelectionColor(entity, isSelected) {
    if (!entity) return;
    const highlightColor = 0x2563EB;
    safeTraverse(entity, c => {
        if (c.isMesh && c.material) {
            const mats = Array.isArray(c.material) ? c.material : [c.material];
            mats.forEach(mat => {
                if (mat && mat.color) {
                    if (isSelected) {
                        const curHex = mat.color.getHex();
                        if (c.userData.originalObjectColor === undefined || c.userData.originalObjectColor === highlightColor) {
                            c.userData.originalObjectColor = (curHex === highlightColor) ? 0xFFFFFF : curHex;
                        }
                        mat.color.setHex(highlightColor);
                    } else {
                        const restoreHex = (c.userData.originalObjectColor !== undefined && c.userData.originalObjectColor !== highlightColor)
                            ? c.userData.originalObjectColor 
                            : 0xFFFFFF;
                        mat.color.setHex(restoreHex);
                        delete c.userData.originalObjectColor;
                    }
                }
            });
        }
    });
}

function cancelGizmo() {
    gizmoState = 0;
    isGizmoDragging = false;
    if (typeof selectedObjects !== 'undefined' && selectedObjects) {
        selectedObjects.forEach(obj => {
            setEntitySelectionColor(obj, false);
        });
        selectedObjects = [];
    }
    if (typeof window.selectedObjects !== 'undefined' && window.selectedObjects) {
        window.selectedObjects = [];
    }
    if (typeof creatorScene !== 'undefined' && creatorScene) {
        creatorScene.traverse(c => {
            if (c.isMesh && c.material) {
                const mats = Array.isArray(c.material) ? c.material : [c.material];
                mats.forEach(m => {
                    if (m && m.color) {
                        if (c.userData && c.userData.originalObjectColor !== undefined && c.userData.originalObjectColor !== 0x2563EB) {
                            m.color.setHex(c.userData.originalObjectColor);
                        } else if (m.color.getHex() === 0x2563EB) {
                            m.color.setHex(0xFFFFFF);
                        }
                    }
                });
                if (c.userData) delete c.userData.originalObjectColor;
            }
        });
    }
    if (customGizmo) customGizmo.visible = false;
    document.querySelectorAll('.spec-table-row.selected-row').forEach(r => r.classList.remove('selected-row'));
    const canvas = document.getElementById('canvas-creator');
    if (canvas) canvas.style.cursor = 'default';
}

function startPlateCommand() {
    if (window.isCommandActive && window.isCommandActive('tool-plate')) { cancelAllCommands(); return; }
    cancelAllCommands();
    setCreatorActiveTool('tool-plate');
    hideAllCreatorPanels();
    const cic = document.getElementById('creator-inputs-container');
    if (cic) cic.style.display = 'block';
    const pi = document.getElementById('plate-inputs');
    if (pi) pi.style.display = 'flex';
    const pt = document.getElementById('plate-t'); if (pt) pt.value = '';
    const pw = document.getElementById('plate-w'); if (pw) pw.value = '';
    const pl = document.getElementById('plate-l'); if (pl) pl.value = '';
    setTimeout(() => { const pt = document.getElementById('plate-t'); if (pt) pt.focus(); }, 100);
}

function startCylinderCommand() {
    if (window.isCommandActive && window.isCommandActive('tool-cylinder')) { cancelAllCommands(); return; }
    cancelAllCommands();
    setCreatorActiveTool('tool-cylinder');
    hideAllCreatorPanels();
    const cic = document.getElementById('creator-inputs-container');
    if (cic) cic.style.display = 'block';
    const ci = document.getElementById('cylinder-inputs');
    if (ci) ci.style.display = 'flex';
    const cd = document.getElementById('cyl-d'); if (cd) cd.value = '';
    const cl = document.getElementById('cyl-l'); if (cl) cl.value = '';
    setTimeout(() => { const cd = document.getElementById('cyl-d'); if (cd) cd.focus(); }, 100);
}

function startPipeCommand() {
    if (window.isCommandActive && window.isCommandActive('tool-pipe')) { cancelAllCommands(); return; }
    cancelAllCommands();
    setCreatorActiveTool('tool-pipe');
    hideAllCreatorPanels();
    const cic = document.getElementById('creator-inputs-container');
    if (cic) cic.style.display = 'block';
    const pi = document.getElementById('pipe-inputs');
    if (pi) pi.style.display = 'flex';
    const pd = document.getElementById('pipe-d'); if (pd) pd.value = '';
    const pt = document.getElementById('pipe-t'); if (pt) pt.value = '';
    const pl = document.getElementById('pipe-l'); if (pl) pl.value = '';
    setTimeout(() => { const pd = document.getElementById('pipe-d'); if (pd) pd.focus(); }, 100);
}

function startBulbBarCommand() {
    if (window.isCommandActive && window.isCommandActive('tool-bulbbar')) { cancelAllCommands(); return; }
    cancelAllCommands();
    setCreatorActiveTool('tool-bulbbar');
    hideAllCreatorPanels();
    const cic = document.getElementById('creator-inputs-container');
    if (cic) cic.style.display = 'block';
    const bi = document.getElementById('bulbbar-inputs');
    if (bi) bi.style.display = 'flex';
    const bl = document.getElementById('bulbbar-l'); if (bl) bl.value = '';
    setTimeout(() => { const bt = document.getElementById('bulbbar-type'); if (bt) bt.focus(); }, 100);
}

function startAngleCommand() {
    if (window.isCommandActive && window.isCommandActive('tool-angle')) { cancelAllCommands(); return; }
    cancelAllCommands();
    setCreatorActiveTool('tool-angle');
    hideAllCreatorPanels();
    const cic = document.getElementById('creator-inputs-container');
    if (cic) cic.style.display = 'block';
    const ai = document.getElementById('angle-inputs');
    if (ai) ai.style.display = 'flex';
    const al = document.getElementById('angle-l'); if (al) al.value = '';
    setTimeout(() => { const at = document.getElementById('angle-type'); if (at) at.focus(); }, 100);
}

function startChannelCommand() {
    if (window.isCommandActive && window.isCommandActive('tool-channel')) { cancelAllCommands(); return; }
    cancelAllCommands();
    setCreatorActiveTool('tool-channel');
    hideAllCreatorPanels();
    const cic = document.getElementById('creator-inputs-container');
    if (cic) cic.style.display = 'block';
    const chi = document.getElementById('channel-inputs');
    if (chi) chi.style.display = 'flex';
    const chl = document.getElementById('channel-l'); if (chl) chl.value = '';
    setTimeout(() => { const ct = document.getElementById('channel-type'); if (ct) ct.focus(); }, 100);
}

window.startCutoutCommand = function() {
    if (window.isCommandActive && window.isCommandActive('tool-cutout')) { cancelAllCommands(); return; }
    cancelAllCommands();
    setCreatorActiveTool('tool-cutout');
    hideAllCreatorPanels();
    const cic = document.getElementById('creator-inputs-container');
    if (cic) cic.style.display = 'block';
    const coi = document.getElementById('cutout-inputs');
    if (coi) coi.style.display = 'flex';
    
    cutoutState = 1;
    setCreatorUIMode('mate-select'); // Включаем прицел
    if (typeof showToast === 'function') showToast("Кликните по грани объекта, где нужно сделать вырез");
};

window.performCutout = function(targetObj, worldPoint, worldNormal) {
    if (typeof CSG === 'undefined') {
        if (typeof showToast === 'function') showToast("Библиотека CSG не загружена. Проверьте подключение к интернету.");
        return;
    }

    const dStr = document.getElementById('cutout-d').value;
    const isThrough = document.getElementById('cutout-through').checked;
    const depthStr = document.getElementById('cutout-depth').value;
    
    let d = parseFloat(dStr);
    let depth = parseFloat(depthStr);
    
    if (isNaN(d) || d <= 0) d = 10;
    if (isNaN(depth) || depth <= 0) depth = 10;
    
    if (isThrough) {
        depth = 5000;
    }
    
    const r = d / 2;
    const overlap = 2.0; 
    const actualDepth = depth + overlap;
    
    const actualCutterGeo = new THREE.CylinderGeometry(r, r, actualDepth, 32);
    actualCutterGeo.translate(0, -(actualDepth / 2) + overlap, 0);
    
    const cutterMat = new THREE.MeshBasicMaterial({color: 0xE03030});
    const cutterMesh = new THREE.Mesh(actualCutterGeo, cutterMat);
    
    cutterMesh.position.copy(worldPoint);
    
    const up = new THREE.Vector3(0, 1, 0);
    cutterMesh.quaternion.setFromUnitVectors(up, worldNormal);
    
    cutterMesh.updateMatrix();
    targetObj.updateMatrix();

    try {
        const bspTarget = CSG.fromMesh(targetObj);
        const bspCutter = CSG.fromMesh(cutterMesh);
        
        const bspResult = bspTarget.subtract(bspCutter);
        const resultMesh = CSG.toMesh(bspResult, targetObj.matrix, targetObj.material);
        
        resultMesh.castShadow = true;
        resultMesh.receiveShadow = true;
        resultMesh.userData = Object.assign({}, targetObj.userData);
        
        const parent = targetObj.parent;
        if (parent) {
            parent.remove(targetObj);
            parent.add(resultMesh);
        } else {
            disposeHierarchy(targetObj);
            creatorScene.add(resultMesh);
        }
        
        resultMesh.children.slice().forEach(child => {
            if (child.isLineSegments) resultMesh.remove(child);
        });
        const edges = new THREE.EdgesGeometry(resultMesh.geometry, showRadialEdges ? 1 : 15);
        const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x2A3142 }));
        resultMesh.add(line);
        
        const idx = selectedObjects.indexOf(targetObj);
        if (idx > -1) {
            selectedObjects.splice(idx, 1);
            if (selectedObjects.length === 0) cancelGizmo();
        }
        
        // Очищаем временную геометрию резца
        actualCutterGeo.dispose();
        cutterMat.dispose();
        
        if (resultMesh.userData.specTextSpan) {
            const specItem = resultMesh.userData.specTextSpan.parentElement;
            if (specItem) {
                const spans = specItem.querySelectorAll('span');
                const delBtn = spans[spans.length - 1];
                if (delBtn) {
                    delBtn.onclick = () => {
                        disposeHierarchy(resultMesh);
                        specItem.remove();
                    };
                }
            }
        }

        if (targetObj.userData && (targetObj.userData.specRowId || targetObj.userData.specRow)) {
            resultMesh.userData.specRowId = targetObj.userData.specRowId || (targetObj.userData.specRow && targetObj.userData.specRow.dataset ? targetObj.userData.specRow.dataset.rowId : null);
        }

        if (typeof window.handleMeshModification === 'function') {
            window.handleMeshModification(resultMesh);
        } else if (typeof window.refreshSpecTable === 'function') {
            window.refreshSpecTable();
        }

        if (typeof showToast === 'function') showToast("Вырез успешно создан");
    } catch (e) {
        console.error("CSG Error:", e);
        if (typeof showToast === 'function') showToast("Ошибка при создании выреза. Возможно, слишком сложная геометрия.");
    }
};

window.startKnitsaCommand = function() {
    if (window.isCommandActive && window.isCommandActive('tool-knitsa')) { cancelAllCommands(); return; }
    cancelAllCommands();
    setCreatorActiveTool('tool-knitsa');
    hideAllCreatorPanels();
    const cic = document.getElementById('creator-inputs-container');
    if (cic) cic.style.display = 'block';
    const ki = document.getElementById('knitsa-inputs');
    if (ki) ki.style.display = 'flex';
    setTimeout(() => { const knh = document.getElementById('kn-h'); if (knh) knh.focus(); }, 100);
};

window.applyKnitsa = function() {
    const h = parseFloat(document.getElementById('kn-h').value);
    const l = parseFloat(document.getElementById('kn-l').value);
    const hbot = parseFloat(document.getElementById('kn-hbot').value);
    const wtop = parseFloat(document.getElementById('kn-wtop').value);
    const c = parseFloat(document.getElementById('kn-c').value);
    const th = parseFloat(document.getElementById('kn-th').value);
    const hasFl = document.getElementById('kn-hasfl').checked;
    const flw = parseFloat(document.getElementById('kn-flw').value);

    if (isNaN(h) || isNaN(l) || isNaN(hbot) || isNaN(wtop) || isNaN(c) || isNaN(th) || (hasFl && isNaN(flw))) {
        if (typeof showToast === 'function') showToast("Проверьте правильность введенных данных");
        return;
    }

    createKnitsa(h, l, hbot, wtop, c, th, hasFl, flw);
    cancelAllCommands();
};

window.createKnitsa = function(h, l, hbot, wtop, c, th, hasFl, flw) {
    const shape = new THREE.Shape();
    shape.moveTo(0, c);
    shape.lineTo(c, 0);
    shape.lineTo(l, 0);
    shape.lineTo(l, hbot);
    shape.lineTo(wtop, h);
    shape.lineTo(0, h);
    shape.lineTo(0, c);

    let webGeo = new THREE.ExtrudeGeometry(shape, { depth: th, bevelEnabled: false });
    let mat = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, metalness: 0.5, roughness: 0.4 });
    let mesh = new THREE.Mesh(webGeo, mat);

    if (hasFl) {
        const dx = wtop - l;
        const dy = h - hbot;
        const len = Math.hypot(dx, dy);

        const flShape = new THREE.Shape();
        flShape.moveTo(0, 0);
        flShape.lineTo(len, 0);
        flShape.lineTo(len, th);
        flShape.lineTo(0, th);
        flShape.lineTo(0, 0);
        
        const flDepth = th + flw;
        const flGeo = new THREE.ExtrudeGeometry(flShape, { depth: flDepth, bevelEnabled: false });
        const flMesh = new THREE.Mesh(flGeo, mat);
        
        flMesh.rotation.z = Math.atan2(dy, dx);
        flMesh.position.set(l, hbot, 0);
        
        flMesh.updateMatrix();
        mesh.updateMatrix();

        try {
            if (typeof CSG !== 'undefined') {
                const bspWeb = CSG.fromMesh(mesh);
                const bspFl = CSG.fromMesh(flMesh);
                const bspResult = bspWeb.union(bspFl);
                mesh = CSG.toMesh(bspResult, mesh.matrix, mesh.material);
            } else {
                throw new Error("CSG missing");
            }
        } catch (e) {
            const g = new THREE.Group();
            g.add(mesh);
            g.add(flMesh);
            mesh = g;
        }
    }

    const geom = mesh.geometry || webGeo;
    const edges = new THREE.EdgesGeometry(geom, showRadialEdges ? 1 : 15);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x2A3142 }));
    mesh.add(line);

    mesh.userData.specData = { type: 'knitsa', name: `Кница ${h}x${l}x${th}`, h: h, l: l, th: th };
    mesh.userData.specOriginalName = `Кница ${h}x${l}x${th}`;
    
    if (window.isPreviewMode) {
        window.previewMeshResult = mesh;
        return;
    }

    creatorScene.add(mesh);
    creatorControls.target.copy(mesh.position);
    creatorCamera.position.set(l * 1.5, Math.max(h * 2, 50), l * 1.5);
    creatorControls.update();
    
    if (typeof showToast === 'function') showToast(`Создана Кница: ${h}x${l}x${th}`);
    addPartToSpec(`Кница: ${h}x${l}x${th}`, mesh);
};

function setupCreatorInputs() {
    window.applySidebarPlate = function() {
        const pt = document.getElementById('plate-t');
        const pw = document.getElementById('plate-w');
        const pl = document.getElementById('plate-l');
        if (pt && pw && pl) {
            const t = parseFloat(pt.value), w = parseFloat(pw.value), l = parseFloat(pl.value);
            if (!isNaN(t) && !isNaN(w) && !isNaN(l) && t > 0 && w > 0 && l > 0) {
                createPlate(t, w, l);
                cancelAllCommands();
            } else if (typeof showToast === 'function') {
                showToast("Введите корректные размеры пластины!");
            }
        }
    };

    window.applySidebarCylinder = function() {
        const cd = document.getElementById('cyl-d');
        const cl = document.getElementById('cyl-l');
        if (cd && cl) {
            const d = parseFloat(cd.value), l = parseFloat(cl.value);
            if (!isNaN(d) && !isNaN(l) && d > 0 && l > 0) {
                createCylinder(d, l);
                cancelAllCommands();
            } else if (typeof showToast === 'function') {
                showToast("Введите корректные размеры цилиндра!");
            }
        }
    };

    window.applySidebarPipe = function() {
        const pd = document.getElementById('pipe-d');
        const pth = document.getElementById('pipe-t');
        const pl_p = document.getElementById('pipe-l');
        if (pd && pth && pl_p) {
            const d = parseFloat(pd.value), t = parseFloat(pth.value), l = parseFloat(pl_p.value);
            const absT = Math.abs(t);
            if (!isNaN(d) && !isNaN(t) && !isNaN(l) && d > 0 && absT > 0 && l > 0) {
                createPipe(d, t, l);
                cancelAllCommands();
            } else if (typeof showToast === 'function') {
                showToast("Введите корректные размеры трубы!");
            }
        }
    };

    window.applySidebarBulbBar = function() {
        const bbt = document.getElementById('bulbbar-type');
        const bbl = document.getElementById('bulbbar-l');
        if (bbt && bbl) {
            const type = bbt.value;
            const l = parseFloat(bbl.value);
            if (type && !isNaN(l) && l > 0) {
                createBulbBar(type, l);
                cancelAllCommands();
            } else if (typeof showToast === 'function') {
                showToast("Выберите тип и длину полособульба!");
            }
        }
    };

    window.applySidebarAngleBar = function() {
        const at = document.getElementById('angle-type');
        const al = document.getElementById('angle-l');
        if (at && al) {
            const type = at.value;
            const l = parseFloat(al.value);
            if (type && !isNaN(l) && l > 0) {
                createAngleBar(type, l);
                cancelAllCommands();
            } else if (typeof showToast === 'function') {
                showToast("Выберите тип и длину уголка!");
            }
        }
    };

    window.applySidebarChannelBar = function() {
        const cl_t = document.getElementById('channel-type');
        const cl_l = document.getElementById('channel-l');
        if (cl_t && cl_l) {
            const type = cl_t.value;
            const l = parseFloat(cl_l.value);
            if (type && !isNaN(l) && l > 0) {
                createChannelBar(type, l);
                cancelAllCommands();
            } else if (typeof showToast === 'function') {
                showToast("Выберите тип и длину швеллера!");
            }
        }
    };

    // --- ЛИСТОВОЕ: ПЛАСТИНА ---
    const pt = document.getElementById('plate-t'), pw = document.getElementById('plate-w'), pl = document.getElementById('plate-l');
    if (pt && pw && pl) {
        pt.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); pw.focus(); } });
        pw.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); pl.focus(); } });
        pl.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                window.applySidebarPlate();
            }
        });
    }

    // --- ПРОФИЛЬНОЕ: КРУГ/ЦИЛИНДР ---
    const cd = document.getElementById('cyl-d'), cl = document.getElementById('cyl-l');
    if (cd && cl) {
        cd.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); cl.focus(); } });
        cl.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                window.applySidebarCylinder();
            }
        });
    }

    // --- ПРОФИЛЬНОЕ: ТРУБА ---
    const pd = document.getElementById('pipe-d'), pth = document.getElementById('pipe-t'), pl_p = document.getElementById('pipe-l');
    if (pd && pth && pl_p) {
        pd.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); pth.focus(); } });
        pth.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); pl_p.focus(); } });
        pl_p.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                window.applySidebarPipe();
            }
        });
    }

    // --- ПРОФИЛЬНОЕ: ПОЛОСОБУЛЬБ ---
    const bbl = document.getElementById('bulbbar-l'), bbt = document.getElementById('bulbbar-type');
    if (bbl && bbt) {
        bbl.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                window.applySidebarBulbBar();
            }
        });
    }

    // --- ПРОФИЛЬНОЕ: УГОЛОК ---
    const al = document.getElementById('angle-l'), at = document.getElementById('angle-type');
    if (al && at) {
        al.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                window.applySidebarAngleBar();
            }
        });
    }
    
    // --- ПРОФИЛЬНОЕ: ШВЕЛЛЕР ---
    const cl_l = document.getElementById('channel-l'), cl_t = document.getElementById('channel-type');
    if (cl_l && cl_t) {
        cl_l.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                window.applySidebarChannelBar();
            }
        });
    }
    
    // --- ЛИСТОВОЕ: КНИЦА ---
    const kh = document.getElementById('kn-h'), kl = document.getElementById('kn-l');
    const khbot = document.getElementById('kn-hbot'), kwtop = document.getElementById('kn-wtop');
    const kc = document.getElementById('kn-c'), kth = document.getElementById('kn-th');
    const khasfl = document.getElementById('kn-hasfl'), kflw = document.getElementById('kn-flw');

    if (kh && kl && khbot && kwtop && kc && kth && khasfl && kflw) {
        kh.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); kl.focus(); } });
        kl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); khbot.focus(); } });
        khbot.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); kwtop.focus(); } });
        kwtop.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); kc.focus(); } });
        kc.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); kth.focus(); } });
        kth.addEventListener('keydown', e => { 
            if (e.key === 'Enter') { 
                e.preventDefault(); 
                if (khasfl.checked) { kflw.focus(); } 
                else { applyKnitsa(); }
            } 
        });
        kflw.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); applyKnitsa(); } });
    }

    // Горячие клавиши для Быстрой Панели
    const setupQuickHotkeys = (ids, applyFn) => {
        ids.forEach((id, index) => {
            const el = document.getElementById(id);
            if(el) {
                el.addEventListener('keydown', e => {
                    if(e.key === 'Enter') {
                        e.preventDefault();
                        const nextId = ids[index + 1];
                        const nextEl = nextId ? document.getElementById(nextId) : null;
                        if (nextEl) {
                            nextEl.focus();
                            if (typeof nextEl.select === 'function') nextEl.select();
                        } else applyFn();
                    } else if(e.key === 'Escape') closeQuickPanels();
                });
            }
        });
    };
    setupQuickHotkeys(['qi-plate-t', 'qi-plate-w', 'qi-plate-l'], applyQuickPlate);
    setupQuickHotkeys(['qi-cyl-d', 'qi-cyl-l'], applyQuickCylinder);
    setupQuickHotkeys(['qi-pipe-d', 'qi-pipe-t', 'qi-pipe-l'], applyQuickPipe);
    setupQuickHotkeys(['qi-kn-h', 'qi-kn-l', 'qi-kn-hbot', 'qi-kn-wtop', 'qi-kn-c', 'qi-kn-th', 'qi-kn-flw'], applyQuickKnitsa);
    setupQuickHotkeys(['qi-profile-category', 'qi-profile-type', 'qi-profile-l'], applyQuickProfile);
    setupQuickHotkeys(['qi-bulbbar-type', 'qi-bulbbar-l'], applyQuickBulbbar);
    setupQuickHotkeys(['qi-angle-type', 'qi-angle-l'], applyQuickAngle);
    setupQuickHotkeys(["qi-extrude-depth", "qi-extrude-angle"], applyQuickExtrude);
    setupQuickHotkeys(["qi-thickness-value", "qi-thickness-height"], applyQuickThickness);
    setupQuickHotkeys(['qi-channel-type', 'qi-channel-l'], applyQuickChannel);
    setupQuickHotkeys(['qi-panel-t', 'qi-panel-w', 'qi-panel-l', 'qi-panel-profile', 'qi-panel-spacing'], applyQuickPanel);
    setupQuickHotkeys(['qi-bend-length', 'qi-bend-angle', 'qi-bend-radius'], () => { if (typeof window.applyQuickBend === 'function') window.applyQuickBend(); });

    ['qi-bend-length', 'qi-bend-angle', 'qi-bend-radius', 'qi-bend-invert', 'qi-bend-close-corners', 'qi-bend-show-dims'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', () => {
                if (typeof window.updateBendPhantoms === 'function') window.updateBendPhantoms();
            });
            el.addEventListener('change', () => {
                if (typeof window.updateBendPhantoms === 'function') window.updateBendPhantoms();
            });
        }
    });
}

// Функция корректного удаления объектов из памяти GPU
function disposeHierarchy(node) {
    if (!node) return;
    node.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach(mat => mat.dispose());
            else child.material.dispose();
        }
    });
    if (node.parent) node.parent.remove(node);
}

window.deleteSelectedObject = function() {
    if (selectedObjects.length > 0) {
        const objsToDelete = [...selectedObjects];
        const affectedRows = new Set();

        objsToDelete.forEach(obj => {
            // Удаляем выноску из боковой панели, если она есть
            if (obj.userData && obj.userData.specTextSpan) {
                const specItem = obj.userData.specTextSpan.parentElement;
                if (specItem) specItem.remove();
            }
            if (obj.userData) {
                const specTr = window.getSpecRowByMesh(obj);
                if (specTr) affectedRows.add(specTr);
            }
            // Удаляем связанные ограничения слипания и их DOM-маркеры
            const objMates = allMates.filter(m => m.objA === obj || m.objB === obj);
            objMates.forEach(m => {
                if (m.htmlElement && m.htmlElement.parentElement) {
                    m.htmlElement.remove();
                }
            });
            allMates = allMates.filter(m => m.objA !== obj && m.objB !== obj);
            disposeHierarchy(obj);
        });

        affectedRows.forEach(tr => {
            if (typeof window.updateRow3DStatus === 'function') {
                window.updateRow3DStatus(tr);
            }
            if (typeof window.syncSpecTableQuantities === 'function') {
                window.syncSpecTableQuantities();
            }
        });

        cancelGizmo();
        window.closeQuickPanels();
        if (typeof window.refreshSpecTable === 'function') window.refreshSpecTable();
        if (typeof showToast === 'function') showToast("Объект удалён");
    }
};

function updateObjectSpecText(obj) {
    if (!obj.userData.specTextSpan || !obj.userData.specData) return;
    const d = obj.userData.specData;
    const sx = obj.scale.x, sy = obj.scale.y, sz = obj.scale.z;
    let text = obj.userData.specOriginalName;
    
    if (d.type === 'plate') text = `Пластина: ${(d.t*sy).toFixed(1)}x${(d.w*sx).toFixed(1)}x${(d.l*sz).toFixed(1)}`;
    else if (d.type === 'cylinder') text = `Круг (Цилиндр): D${(d.d*sx).toFixed(1)} L${(d.l*sz).toFixed(1)}`;
    else if (d.type === 'pipe') text = `Труба: D${(d.dOut*sx).toFixed(1)}x${(d.t*sx).toFixed(1)} L${(d.l*sz).toFixed(1)}`;
    else if (d.type === 'profile') text = `${d.name} L${(d.l*sz).toFixed(1)} (Масштаб: ${sx.toFixed(2)}, ${sy.toFixed(2)})`;
    else if (d.type === 'extrude') text = `Выдавленный эскиз (${(d.depth*sz).toFixed(1)}мм) (Масштаб: ${sx.toFixed(2)}, ${sy.toFixed(2)})`;
    
    obj.userData.specTextSpan.innerText = text;
}

function addPartToSpec(name, object3D) {
    const specList = document.getElementById('creator-spec-list');
    if (!specList) return;
    
    const item = document.createElement('div');
    item.style.cssText = `
        padding: 10px; 
        background: white; 
        border: 1px solid var(--border-light); 
        border-radius: var(--radius-sm); 
        font-size: 13px; 
        font-weight: 500;
        color: var(--text-dark); 
        box-shadow: var(--shadow-sm);
        margin-bottom: 4px;
    `;
    
    const textSpan = document.createElement('span');
    textSpan.innerText = name;
    item.appendChild(textSpan);

    if (object3D) {
        object3D.userData.specTextSpan = textSpan;
        object3D.userData.specOriginalName = name;
    }

    const delBtn = document.createElement('span');
    delBtn.innerText = '✕';
    delBtn.style.cssText = 'color: #E03030; cursor: pointer; float: right; font-weight: bold; padding: 0 4px;';
    delBtn.onclick = () => {
        if(object3D) disposeHierarchy(object3D);
        item.remove();
    };
    item.appendChild(delBtn);

    if (object3D && object3D.userData.isSketch) {
        const extrudeBtn = document.createElement('span');
        extrudeBtn.innerText = 'Выдавить';
        extrudeBtn.style.cssText = 'color: #5AAFDD; cursor: pointer; float: right; font-weight: bold; margin-right: 12px; font-size: 12px;';
        extrudeBtn.onclick = () => {
            const depthStr = prompt("Введите толщину выдавливания (мм). Отрицательное число выдавит в обратную сторону:", "10");
            if (!depthStr) return;
            const depth = parseFloat(depthStr);
            if (isNaN(depth) || depth === 0) return;
            
            const mesh = performExtrusion(object3D.userData.segments, object3D.userData.circles, object3D.userData.up, object3D.userData.normal, depth);
            if (!mesh) { if (typeof showToast === 'function') showToast("Ошибка: нет замкнутых контуров"); return; }
            creatorScene.add(mesh);
            disposeHierarchy(object3D); // Удаляем исходный плоский эскиз
            item.remove();
            addPartToSpec(`Выдавленный эскиз (${depth}мм)`, mesh);
        };
        item.appendChild(extrudeBtn);
    }

    if (specList) {
        specList.appendChild(item);
    }

    if (object3D && (object3D.isMesh || object3D.isGroup || (object3D.userData && object3D.userData.isPanel)) && window.isSpecCreated && typeof window.autoAssignMeshToSpecTable === 'function') {
        window.autoAssignMeshToSpecTable(object3D);
    }
}

function createPlate(t, w, l) {
    if (isNaN(t) || isNaN(w) || isNaN(l) || t <= 0 || w <= 0 || l <= 0) {
        if (typeof showToast === 'function') showToast("Ошибка: Размеры должны быть больше нуля!");
        return;
    }

    // В Three.js: X - ширина(w), Y - толщина(t), Z - длина(l)
    const geometry = new THREE.BoxGeometry(w, t, l);
    const material = new THREE.MeshStandardMaterial({ 
        color: 0xFFFFFF, 
        metalness: 0.5, 
        roughness: 0.4 
    });
    const mesh = new THREE.Mesh(geometry, material);
    
    // Помещаем пластину так, чтобы нижняя грань лежала ровно на сетке
    mesh.position.set(0, t / 2, 0);

    // Добавляем белые контуры для эффекта CAD чертежа
    const edges = new THREE.EdgesGeometry(geometry, showRadialEdges ? 1 : 15);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x2A3142 })); 
    mesh.add(line);

    mesh.userData.specData = { 
        type: 'plate', 
        t: t, th: t, thickness: t, wallThick: t, depth: t,
        w: w, l: l,
        broadNormal: new THREE.Vector3(0, 1, 0)
    };
    if (window.isPreviewMode) {
        window.previewMeshResult = mesh;
        return;
    }
    creatorScene.add(mesh);

    creatorControls.target.copy(mesh.position);
    creatorCamera.position.set(w * 1.5, Math.max(t * 5, 50), l * 1.5);
    creatorControls.update();

    if (typeof showToast === 'function') showToast(`Создана пластина: ${t}x${w}x${l}`);
    addPartToSpec(`Пластина: ${t}x${w}x${l}`, mesh);
}

function createCylinder(d, l) {
    if (isNaN(d) || isNaN(l) || d <= 0 || l <= 0) {
        if (typeof showToast === 'function') showToast("Ошибка: Размеры должны быть больше нуля!");
        return;
    }
    const r = d / 2;
    const geometry = new THREE.CylinderGeometry(r, r, l, 32);
    geometry.rotateX(Math.PI / 2); // Ориентируем профиль вдоль оси Z
    
    const material = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, metalness: 0.5, roughness: 0.4 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, r, 0);

    const edges = new THREE.EdgesGeometry(geometry, showRadialEdges ? 1 : 15);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x2A3142 }));
    mesh.add(line);

    mesh.userData.specData = { type: 'cylinder', d, l };
    if (window.isPreviewMode) {
        window.previewMeshResult = mesh;
        return;
    }
    creatorScene.add(mesh);
    creatorControls.target.copy(mesh.position);
    creatorCamera.position.set(d * 2, Math.max(d * 3, 50), l * 1.5);
    creatorControls.update();
    if (typeof showToast === 'function') showToast(`Создан профиль Круг: D${d} L${l}`);
    addPartToSpec(`Круг (Цилиндр): D${d} L${l}`, mesh);
}

let currentHoleHighlightMesh = null;
let activeHoverHole = null;
let currentPipe3DPhantom = null;
let selectedPipeHole = null;

window.clearPipe3DPhantom = function() {
    if (currentPipe3DPhantom) {
        if (currentPipe3DPhantom.parent) {
            currentPipe3DPhantom.parent.remove(currentPipe3DPhantom);
        }
        if (currentPipe3DPhantom.geometry) currentPipe3DPhantom.geometry.dispose();
        if (currentPipe3DPhantom.material) currentPipe3DPhantom.material.dispose();
        currentPipe3DPhantom = null;
    }
};

window.clearPipeHoleSelection = function() {
    selectedPipeHole = null;
    window.clearPipe3DPhantom();
};

window.update3DPipePhantom = function() {
    if (!isPipeModeActive() || !selectedPipeHole) {
        window.clearPipe3DPhantom();
        return;
    }

    let dVal = NaN;
    let tVal = NaN;
    let lVal = NaN;

    const pd = document.getElementById('pipe-d') || document.getElementById('qi-pipe-d');
    const pt = document.getElementById('pipe-t') || document.getElementById('qi-pipe-t');
    const pl = document.getElementById('pipe-l') || document.getElementById('qi-pipe-l');

    if (pd && pd.value) dVal = parseFloat(pd.value);
    if (pt && pt.value) tVal = parseFloat(pt.value);
    if (pl && pl.value) lVal = parseFloat(pl.value);

    const qprof = document.getElementById('quick-input-profile');
    if (qprof && qprof.classList.contains('active')) {
        const typeStr = (document.getElementById('qi-profile-type')?.value || '').trim();
        const lInp = document.getElementById('qi-profile-l');
        if (lInp && lInp.value) {
            const parsedL = parseFloat(lInp.value);
            if (!isNaN(parsedL) && parsedL > 0) lVal = parsedL;
        }

        if (typeStr) {
            const clean = typeStr.replace(/^(труба|d|диам|диаметр|⌀)\s*/i, '').trim();
            const parts = clean.split(/[xх*x\s/]+/).filter(Boolean).map(parseFloat);
            if (parts.length >= 1 && !isNaN(parts[0]) && parts[0] > 0) {
                dVal = parts[0];
            }
            if (parts.length >= 2 && !isNaN(parts[1]) && parts[1] !== 0) {
                tVal = parts[1];
            }
        }
    }

    if (isNaN(lVal) || lVal <= 0) lVal = 1000;
    if (isNaN(dVal) || dVal <= 0) dVal = selectedPipeHole.diameter;
    if (isNaN(tVal) || tVal === 0) tVal = 10;

    const absT = Math.abs(tVal);
    let rOut, rIn;
    const isCenteredInHole = (tVal > 0);

    if (tVal > 0) {
        // Положительная толщина: толщина уходит к центру, наружный диаметр равен диаметру отверстия
        if (tVal >= dVal / 2) {
            window.clearPipe3DPhantom();
            return;
        }
        rOut = dVal / 2;
        rIn = rOut - absT;
    } else {
        // Отрицательная толщина: толщина идет от центра, внутренний диаметр равен диаметру отверстия
        rIn = dVal / 2;
        rOut = rIn + absT;
    }

    const shape = new THREE.Shape();
    shape.absarc(0, 0, rOut, 0, Math.PI * 2, false);
    const holePath = new THREE.Path();
    holePath.absarc(0, 0, rIn, 0, Math.PI * 2, true);
    shape.holes.push(holePath);

    const extrudeSettings = { depth: lVal, bevelEnabled: false, curveSegments: 32 };
    const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);

    const mat = new THREE.MeshStandardMaterial({
        color: 0x10B981,
        transparent: true,
        opacity: 0.65,
        metalness: 0.2,
        roughness: 0.3,
        depthTest: true
    });

    const phantomMesh = new THREE.Mesh(geo, mat);

    const edges = new THREE.EdgesGeometry(geo, 20);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x047857 });
    const line = new THREE.LineSegments(edges, lineMat);
    phantomMesh.add(line);

    if (isCenteredInHole) {
        // Положительная толщина: труба располагается по центру по длине в отверстии
        geo.translate(0, 0, -lVal / 2);
        const defaultAxis = new THREE.Vector3(0, 0, 1);
        const q = new THREE.Quaternion().setFromUnitVectors(defaultAxis, selectedPipeHole.worldAxis);
        phantomMesh.quaternion.copy(q);
        phantomMesh.position.copy(selectedPipeHole.worldCenter);
    } else {
        // Отрицательная толщина: труба располагается по торцу к отверстию - к поверхности (пласти)
        geo.translate(0, 0, 0);
        const defaultAxis = new THREE.Vector3(0, 0, 1);
        const targetDir = selectedPipeHole.outwardAxis || selectedPipeHole.worldAxis;
        const q = new THREE.Quaternion().setFromUnitVectors(defaultAxis, targetDir);
        phantomMesh.quaternion.copy(q);
        phantomMesh.position.copy(selectedPipeHole.topFaceCenter || selectedPipeHole.worldCenter);
    }

    phantomMesh.userData.isPhantom = true;

    window.clearPipe3DPhantom();

    currentPipe3DPhantom = phantomMesh;
    creatorScene.add(currentPipe3DPhantom);
};

document.addEventListener('input', (e) => {
    if (e.target && e.target.id && (
        e.target.id.includes('pipe') || 
        e.target.id.includes('qi-pipe') ||
        e.target.id.includes('qi-profile')
    )) {
        if (typeof window.update3DPipePhantom === 'function') {
            window.update3DPipePhantom();
        }
    }
});

function clearHoleHighlight() {
    if (currentHoleHighlightMesh) {
        if (currentHoleHighlightMesh.parent) {
            currentHoleHighlightMesh.parent.remove(currentHoleHighlightMesh);
        }
        if (currentHoleHighlightMesh.geometry) currentHoleHighlightMesh.geometry.dispose();
        if (currentHoleHighlightMesh.material) currentHoleHighlightMesh.material.dispose();
        currentHoleHighlightMesh = null;
    }
    activeHoverHole = null;
}

function isPipeModeActive() {
    if (window.isCommandActive && window.isCommandActive('tool-pipe')) return true;
    const pi = document.getElementById('pipe-inputs');
    if (pi && pi.style.display !== 'none' && pi.style.display !== '') return true;
    const qp = document.getElementById('quick-input-pipe');
    if (qp && qp.classList.contains('active')) return true;
    const qprof = document.getElementById('quick-input-profile');
    if (qprof && qprof.classList.contains('active')) return true;
    return false;
}

function findCylindricalHole(intersect) {
    if (!intersect || !intersect.object || !intersect.face) return null;
    const mesh = intersect.object;
    const geo = mesh.geometry;
    if (!geo || !geo.attributes.position) return null;

    const posAttr = geo.attributes.position;
    const indexAttr = geo.index;
    const faceCount = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;
    let startFaceIdx = intersect.faceIndex;
    if (startFaceIdx === undefined || startFaceIdx < 0 || startFaceIdx >= faceCount) return null;

    if (!geo.userData._vertToFaces) {
        const vertToFaces = new Map();
        const QUANT = 1000;
        const tmpV = new THREE.Vector3();
        for (let k = 0; k < faceCount; k++) {
            const i0 = indexAttr ? indexAttr.getX(k * 3) : k * 3;
            const i1 = indexAttr ? indexAttr.getX(k * 3 + 1) : k * 3 + 1;
            const i2 = indexAttr ? indexAttr.getX(k * 3 + 2) : k * 3 + 2;
            [i0, i1, i2].forEach(idx => {
                tmpV.fromBufferAttribute(posAttr, idx);
                const key = `${Math.round(tmpV.x * QUANT)},${Math.round(tmpV.y * QUANT)},${Math.round(tmpV.z * QUANT)}`;
                if (!vertToFaces.has(key)) vertToFaces.set(key, []);
                vertToFaces.get(key).push(k);
            });
        }
        geo.userData._vertToFaces = vertToFaces;
    }

    const vertToFaces = geo.userData._vertToFaces;

    const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
    const cb = new THREE.Vector3(), ab = new THREE.Vector3();
    function getLocalNorm(k, outNorm) {
        const i0 = indexAttr ? indexAttr.getX(k * 3) : k * 3;
        const i1 = indexAttr ? indexAttr.getX(k * 3 + 1) : k * 3 + 1;
        const i2 = indexAttr ? indexAttr.getX(k * 3 + 2) : k * 3 + 2;
        vA.fromBufferAttribute(posAttr, i0);
        vB.fromBufferAttribute(posAttr, i1);
        vC.fromBufferAttribute(posAttr, i2);
        cb.subVectors(vC, vB);
        ab.subVectors(vA, vB);
        cb.cross(ab).normalize();
        outNorm.copy(cb);
    }

    const startNorm = new THREE.Vector3();
    getLocalNorm(startFaceIdx, startNorm);

    // Если кликнули по плоской грани пластины вблизи отверстия, ищем прилегающую грань стенки отверстия
    const hitLocal = intersect.point ? intersect.point.clone().applyMatrix4(new THREE.Matrix4().copy(mesh.matrixWorld).invert()) : null;
    let candidateFaceIdx = startFaceIdx;
    
    const QUANT = 1000;
    const i0_init = indexAttr ? indexAttr.getX(startFaceIdx * 3) : startFaceIdx * 3;
    const i1_init = indexAttr ? indexAttr.getX(startFaceIdx * 3 + 1) : startFaceIdx * 3 + 1;
    const i2_init = indexAttr ? indexAttr.getX(startFaceIdx * 3 + 2) : startFaceIdx * 3 + 2;
    const initIndices = [i0_init, i1_init, i2_init];
    
    // Проверим, является ли текущая грань стенкой цилиндра
    let foundCylNbr = false;
    for (let idx of initIndices) {
        vA.fromBufferAttribute(posAttr, idx);
        const key = `${Math.round(vA.x * QUANT)},${Math.round(vA.y * QUANT)},${Math.round(vA.z * QUANT)}`;
        const list = vertToFaces.get(key) || [];
        for (let f of list) {
            if (f !== startFaceIdx) {
                const nbrNorm = new THREE.Vector3();
                getLocalNorm(f, nbrNorm);
                if (Math.abs(startNorm.dot(nbrNorm)) < 0.3) {
                    candidateFaceIdx = f;
                    foundCylNbr = true;
                    break;
                }
            }
        }
        if (foundCylNbr) break;
    }

    startFaceIdx = candidateFaceIdx;
    getLocalNorm(startFaceIdx, startNorm);

    const visited = new Set();
    const queue = [startFaceIdx];
    visited.add(startFaceIdx);
    const holeFaces = [startFaceIdx];
    const normalsMap = new Map();
    normalsMap.set(startFaceIdx, startNorm.clone());

    const tmpNorm = new THREE.Vector3();

    while (queue.length > 0) {
        const curr = queue.shift();
        const currNorm = normalsMap.get(curr);

        const i0 = indexAttr ? indexAttr.getX(curr * 3) : curr * 3;
        const i1 = indexAttr ? indexAttr.getX(curr * 3 + 1) : curr * 3 + 1;
        const i2 = indexAttr ? indexAttr.getX(curr * 3 + 2) : curr * 3 + 2;

        const neighborSet = new Set();
        [i0, i1, i2].forEach(idx => {
            vA.fromBufferAttribute(posAttr, idx);
            const key = `${Math.round(vA.x * QUANT)},${Math.round(vA.y * QUANT)},${Math.round(vA.z * QUANT)}`;
            const list = vertToFaces.get(key);
            if (list) {
                list.forEach(f => neighborSet.add(f));
            }
        });

        neighborSet.forEach(nbr => {
            if (!visited.has(nbr)) {
                getLocalNorm(nbr, tmpNorm);
                const dot = currNorm.dot(tmpNorm);
                if (dot > 0.5) {
                    visited.add(nbr);
                    queue.push(nbr);
                    holeFaces.push(nbr);
                    normalsMap.set(nbr, tmpNorm.clone());
                }
            }
        });
    }

    if (holeFaces.length < 3) return null;

    let norm1 = startNorm;
    let norm2 = null;
    for (let f of holeFaces) {
        const n = normalsMap.get(f);
        if (Math.abs(n.dot(norm1)) < 0.9) {
            norm2 = n;
            break;
        }
    }

    if (!norm2) return null;

    const axisLocal = new THREE.Vector3().crossVectors(norm1, norm2).normalize();
    if (axisLocal.lengthSq() < 0.001) return null;

    for (let f of holeFaces) {
        const n = normalsMap.get(f);
        if (Math.abs(n.dot(axisLocal)) > 0.25) return null;
    }

    const uAxis = new THREE.Vector3();
    if (Math.abs(axisLocal.z) < 0.8) uAxis.set(0, 0, 1);
    else uAxis.set(1, 0, 0);
    const vAxis = new THREE.Vector3().crossVectors(axisLocal, uAxis).normalize();
    uAxis.crossVectors(vAxis, axisLocal).normalize();

    const projPoints = [];
    const vertKeySet = new Set();
    let minH = Infinity, maxH = -Infinity;

    holeFaces.forEach(f => {
        const i0 = indexAttr ? indexAttr.getX(f * 3) : f * 3;
        const i1 = indexAttr ? indexAttr.getX(f * 3 + 1) : f * 3 + 1;
        const i2 = indexAttr ? indexAttr.getX(f * 3 + 2) : f * 3 + 2;
        [i0, i1, i2].forEach(idx => {
            if (!vertKeySet.has(idx)) {
                vertKeySet.add(idx);
                vA.fromBufferAttribute(posAttr, idx);
                const u = vA.dot(uAxis);
                const v = vA.dot(vAxis);
                const h = vA.dot(axisLocal);
                if (h < minH) minH = h;
                if (h > maxH) maxH = h;
                projPoints.push({ u, v, localPos: vA.clone() });
            }
        });
    });

    if (projPoints.length < 4) return null;

    const p0 = projPoints[0];
    let p1 = projPoints[1];
    let maxD1 = 0;
    projPoints.forEach(p => {
        const d = (p.u - p0.u)**2 + (p.v - p0.v)**2;
        if (d > maxD1) { maxD1 = d; p1 = p; }
    });

    let p2 = p1;
    let maxD2 = 0;
    projPoints.forEach(p => {
        const d0 = (p.u - p0.u)**2 + (p.v - p0.v)**2;
        const d1 = (p.u - p1.u)**2 + (p.v - p1.v)**2;
        const minD = Math.min(d0, d1);
        if (minD > maxD2) { maxD2 = minD; p2 = p; }
    });

    const ax = p0.u, ay = p0.v;
    const bx = p1.u, by = p1.v;
    const cx = p2.u, cy = p2.v;
    const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(D) < 1e-6) return null;

    const ux = ((ax*ax + ay*ay)*(by - cy) + (bx*bx + by*by)*(cy - ay) + (cx*cx + cy*cy)*(ay - by)) / D;
    const uy = ((ax*ax + ay*ay)*(cx - bx) + (bx*bx + by*by)*(ax - cx) + (cx*cx + cy*cy)*(bx - ax)) / D;
    const radiusLocal = Math.sqrt((ax - ux)**2 + (ay - uy)**2);

    if (radiusLocal < 0.5 || radiusLocal > 5000) return null;

    let validCount = 0;
    projPoints.forEach(p => {
        const r = Math.sqrt((p.u - ux)**2 + (p.v - uy)**2);
        if (Math.abs(r - radiusLocal) < Math.max(1.0, radiusLocal * 0.08)) {
            validCount++;
        }
    });

    if (validCount / projPoints.length < 0.75) return null;

    const hCenter = (minH !== Infinity && maxH !== -Infinity) ? (minH + maxH) / 2 : 0;
    const hDepth = (minH !== Infinity && maxH !== -Infinity) ? Math.max(1.0, maxH - minH) : 10.0;

    const centerLocal = new THREE.Vector3();
    centerLocal.addScaledVector(uAxis, ux);
    centerLocal.addScaledVector(vAxis, uy);
    centerLocal.addScaledVector(axisLocal, hCenter);

    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const worldAxis = axisLocal.clone().applyMatrix3(normalMatrix).normalize();
    const worldCenter = centerLocal.clone().applyMatrix4(mesh.matrixWorld);

    // Определяем направление наружу от поверхности (пласти)
    const toHit = intersect.point ? intersect.point.clone().sub(worldCenter) : new THREE.Vector3();
    const projDist = toHit.dot(worldAxis);
    const outwardAxis = (projDist >= 0 ? worldAxis.clone() : worldAxis.clone().negate());
    const topFaceCenter = worldCenter.clone().addScaledVector(outwardAxis, hDepth / 2);

    return {
        mesh,
        faceIndices: holeFaces,
        radius: radiusLocal,
        diameter: radiusLocal * 2,
        worldCenter,
        worldAxis,
        outwardAxis,
        topFaceCenter,
        holeDepth: hDepth
    };
}

function createHoleHighlightMesh(mesh, holeFaces) {
    const srcGeo = mesh.geometry;
    const posAttr = srcGeo.attributes.position;
    const indexAttr = srcGeo.index;

    const positions = [];
    const normals = [];

    const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
    const nA = new THREE.Vector3(), nB = new THREE.Vector3(), nC = new THREE.Vector3();
    const normAttr = srcGeo.attributes.normal;

    holeFaces.forEach(f => {
        const i0 = indexAttr ? indexAttr.getX(f * 3) : f * 3;
        const i1 = indexAttr ? indexAttr.getX(f * 3 + 1) : f * 3 + 1;
        const i2 = indexAttr ? indexAttr.getX(f * 3 + 2) : f * 3 + 2;

        vA.fromBufferAttribute(posAttr, i0);
        vB.fromBufferAttribute(posAttr, i1);
        vC.fromBufferAttribute(posAttr, i2);

        positions.push(vA.x, vA.y, vA.z, vB.x, vB.y, vB.z, vC.x, vC.y, vC.z);

        if (normAttr) {
            nA.fromBufferAttribute(normAttr, i0);
            nB.fromBufferAttribute(normAttr, i1);
            nC.fromBufferAttribute(normAttr, i2);
            normals.push(nA.x, nA.y, nA.z, nB.x, nB.y, nB.z, nC.x, nC.y, nC.z);
        }
    });

    const highlightGeo = new THREE.BufferGeometry();
    highlightGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (normals.length > 0) {
        highlightGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    } else {
        highlightGeo.computeVertexNormals();
    }

    const highlightMat = new THREE.MeshStandardMaterial({
        color: 0x10B981,
        roughness: 0.2,
        metalness: 0.1,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthTest: true,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2
    });

    const highlightMesh = new THREE.Mesh(highlightGeo, highlightMat);
    highlightMesh.matrixAutoUpdate = false;
    highlightMesh.matrix.copy(mesh.matrixWorld);
    highlightMesh.userData.isHoleHighlight = true;

    const edges = new THREE.EdgesGeometry(highlightGeo, 15);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x059669, linewidth: 2 });
    const line = new THREE.LineSegments(edges, lineMat);
    highlightMesh.add(line);

    return highlightMesh;
}

window.updatePipeHoleHover = function() {
    if (!isPipeModeActive()) {
        clearHoleHighlight();
        return;
    }

    const interactable = [];
    creatorScene.traverse(c => {
        if (c.isMesh && c.visible && !c.userData.isSketchPlane && !c.userData.isSketch && !c.userData.isHoleHighlight && !c.userData.isPhantom && c !== snapMarker && c !== currentHoleHighlightMesh && c !== currentPipe3DPhantom) {
            interactable.push(c);
        }
    });

    if (interactable.length === 0) {
        clearHoleHighlight();
        return;
    }

    const intersects = sketchRaycaster.intersectObjects(interactable, false);
    if (intersects.length === 0) {
        clearHoleHighlight();
        return;
    }

    const intersect = intersects[0];
    const hole = findCylindricalHole(intersect);

    if (!hole) {
        clearHoleHighlight();
        return;
    }

    if (activeHoverHole && activeHoverHole.mesh === hole.mesh && Math.abs(activeHoverHole.diameter - hole.diameter) < 0.1 && activeHoverHole.worldCenter.distanceTo(hole.worldCenter) < 1.0) {
        return;
    }

    clearHoleHighlight();

    currentHoleHighlightMesh = createHoleHighlightMesh(hole.mesh, hole.faceIndices);
    creatorScene.add(currentHoleHighlightMesh);
    activeHoverHole = hole;
};

function createPipe(dInput, tInput, l) {
    const absT = Math.abs(tInput);
    if (isNaN(dInput) || isNaN(tInput) || isNaN(l) || dInput <= 0 || absT <= 0 || l <= 0) {
        if (typeof showToast === 'function') showToast("Ошибка: Некорректные размеры трубы!");
        return;
    }

    let dOut, t, rOut, rIn;
    const isCenteredInHole = (tInput > 0);

    if (tInput > 0) {
        if (tInput >= dInput / 2) {
            if (typeof showToast === 'function') showToast("Ошибка: Толщина стенки должна быть меньше радиуса трубы!");
            return;
        }
        dOut = dInput;
        t = tInput;
        rOut = dOut / 2;
        rIn = rOut - t;
    } else {
        // tInput < 0: dInput is inner diameter (thickness goes outward)
        rIn = dInput / 2;
        t = absT;
        rOut = rIn + t;
        dOut = rOut * 2;
    }

    const shape = new THREE.Shape();
    shape.absarc(0, 0, rOut, 0, Math.PI * 2, false);
    const holePath = new THREE.Path();
    holePath.absarc(0, 0, rIn, 0, Math.PI * 2, true);
    shape.holes.push(holePath);

    const extrudeSettings = { depth: l, bevelEnabled: false, curveSegments: 32 };
    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);

    const material = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, metalness: 0.5, roughness: 0.4 });
    const mesh = new THREE.Mesh(geometry, material);

    if (selectedPipeHole) {
        if (isCenteredInHole) {
            // Положительная толщина: труба располагается по центру по длине в отверстии
            geometry.translate(0, 0, -l / 2);
            const defaultAxis = new THREE.Vector3(0, 0, 1);
            const q = new THREE.Quaternion().setFromUnitVectors(defaultAxis, selectedPipeHole.worldAxis);
            mesh.quaternion.copy(q);
            mesh.position.copy(selectedPipeHole.worldCenter);
        } else {
            // Отрицательная толщина: труба располагается по торцу к отверстию - к поверхности (пласти)
            geometry.translate(0, 0, 0);
            const defaultAxis = new THREE.Vector3(0, 0, 1);
            const targetDir = selectedPipeHole.outwardAxis || selectedPipeHole.worldAxis;
            const q = new THREE.Quaternion().setFromUnitVectors(defaultAxis, targetDir);
            mesh.quaternion.copy(q);
            mesh.position.copy(selectedPipeHole.topFaceCenter || selectedPipeHole.worldCenter);
        }
    } else {
        geometry.translate(0, 0, -l / 2);
        mesh.position.set(0, rOut, 0);
    }

    const edges = new THREE.EdgesGeometry(geometry, showRadialEdges ? 1 : 15);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x2A3142 }));
    mesh.add(line);

    mesh.userData.specData = { 
        type: 'pipe', 
        profileType: 'pipe',
        category: 'pipe',
        typeName: 'Труба',
        name: `⌀${dOut.toFixed(1)}x${tInput < 0 ? `-${t}` : `${t}`}`,
        profileName: `⌀${dOut.toFixed(1)}x${tInput < 0 ? `-${t}` : `${t}`}`,
        dOut, 
        d: dOut, 
        dInput,
        t: (tInput < 0 ? -t : t), 
        th: (tInput < 0 ? -t : t),
        wallThick: (tInput < 0 ? -t : t),
        l, 
        depth: l,
        tInput 
    };

    if (window.isPreviewMode) {
        window.previewMeshResult = mesh;
        return;
    }
    creatorScene.add(mesh);

    if (typeof window.clearPipeHoleSelection === 'function') {
        window.clearPipeHoleSelection();
    }
    creatorControls.target.copy(mesh.position);
    creatorCamera.position.set(dOut * 2, Math.max(dOut * 3, 50), l * 1.5);
    creatorControls.update();
    const tDesc = tInput < 0 ? `-${t}` : `${t}`;
    if (typeof showToast === 'function') showToast(`Создана Труба: D${dOut.toFixed(1)}x${tDesc} L${l}`);
    addPartToSpec(`Труба: D${dOut.toFixed(1)}x${tDesc} L${l}`, mesh);
}

function createBulbBar(type, length) {
    if (typeof initBulbProfiles === 'function' && (!BulbProfiles || Object.keys(BulbProfiles).length === 0)) {
        initBulbProfiles();
    }
    let points = BulbProfiles[type];
    if (!points && window.BulbProfiles) {
        points = window.BulbProfiles[type];
    }
    if (!points) {
        const clean = (type || '').trim().toLowerCase().replace(/[хx\s]/gi, '');
        const dict = (window.BulbProfiles && Object.keys(window.BulbProfiles).length > 0) ? window.BulbProfiles : BulbProfiles;
        const key = Object.keys(dict).find(k => k.trim().toLowerCase().replace(/[хx\s]/gi, '') === clean);
        if (key) points = dict[key];
    }
    if (!points) {
        const numMatch = (type || '').match(/\d+/);
        if (numMatch) {
            const num = numMatch[0];
            const dict = (window.BulbProfiles && Object.keys(window.BulbProfiles).length > 0) ? window.BulbProfiles : BulbProfiles;
            const key = Object.keys(dict).find(k => k.includes(num));
            if (key) points = dict[key];
        }
    }
    if (!points) {
        const dict = (window.BulbProfiles && Object.keys(window.BulbProfiles).length > 0) ? window.BulbProfiles : BulbProfiles;
        const keys = Object.keys(dict);
        if (keys.length > 0) points = dict[keys[0]];
    }
    if (!points) {
        if (typeof showToast === 'function') showToast(`Ошибка: Профиль '${type}' не найден!`);
        return;
    }
    if (isNaN(length) || length <= 0) {
        if (typeof showToast === 'function') showToast("Ошибка: Некорректная длина!");
        return;
    }

    const shape = createShapeFromBulgePoly(points);
    const extrudeSettings = { depth: length, bevelEnabled: false };
    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);

    const material = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, metalness: 0.5, roughness: 0.4 });
    const mesh = new THREE.Mesh(geometry, material);

    const edges = new THREE.EdgesGeometry(geometry, showRadialEdges ? 1 : 15);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x2A3142 }));
    mesh.add(line);

    mesh.userData.specData = { type: 'profile', name: type, l: length, profileType: 'bulbbar' };
    if (window.isPreviewMode) {
        window.previewMeshResult = mesh;
        return;
    }
    creatorScene.add(mesh);
    creatorControls.target.copy(mesh.position);
    creatorCamera.position.set(200, 200, length * 1.5);
    creatorControls.update();
    
    if (typeof showToast === 'function') showToast(`Создан Полособульб: ${type} L${length}`);
    addPartToSpec(`Полособульб: ${type} L${length}`, mesh);
}

function createAngleBar(type, length) {
    const points = (typeof getAngleProfilePoints === 'function') 
        ? getAngleProfilePoints(type) 
        : (window.getAngleProfilePoints ? window.getAngleProfilePoints(type) : null);

    if (!points) {
        if (typeof showToast === 'function') showToast(`Ошибка: Профиль '${type}' не найден!`);
        return;
    }
    if (isNaN(length) || length <= 0) {
        if (typeof showToast === 'function') showToast("Ошибка: Некорректная длина!");
        return;
    }

    const shape = createShapeFromBulgePoly(points);
    const extrudeSettings = { depth: length, bevelEnabled: false };
    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);

    const material = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, metalness: 0.5, roughness: 0.4 });
    const mesh = new THREE.Mesh(geometry, material);

    const edges = new THREE.EdgesGeometry(geometry, showRadialEdges ? 1 : 15);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x2A3142 }));
    mesh.add(line);

    mesh.name = `Уголок: ${type} L${length}`;
    mesh.userData.specData = { type: 'profile', name: type, l: length, profileType: 'angle' };

    if (window.isPreviewMode && typeof window.previewMeshResult !== 'undefined') {
        window.previewMeshResult = mesh;
        return;
    }

    creatorScene.add(mesh);
    creatorControls.target.copy(mesh.position);
    creatorCamera.position.set(200, 200, length * 1.5);
    creatorControls.update();
    
    if (typeof showToast === 'function') showToast(`Создан Уголок: ${type} L${length}`);
    addPartToSpec(`Уголок: ${type} L${length}`, mesh);
}

function createChannelBar(type, length) {
    if (typeof initChannelProfiles === 'function' && (!ChannelParams || Object.keys(ChannelParams).length === 0)) {
        initChannelProfiles();
    }
    let points = null;
    let params = ChannelParams[type];
    if (!params && window.ChannelParams) {
        params = window.ChannelParams[type];
    }
    if (!params) {
        const clean = (type || '').trim().toLowerCase().replace(/[хx\sпП]/gi, '');
        const dict = (window.ChannelParams && Object.keys(window.ChannelParams).length > 0) ? window.ChannelParams : ChannelParams;
        const key = Object.keys(dict).find(k => k.trim().toLowerCase().replace(/[хx\sпП]/gi, '') === clean);
        if (key) params = dict[key];
    }
    if (!params) {
        const numMatch = (type || '').match(/\d+/);
        if (numMatch) {
            const num = numMatch[0];
            const dict = (window.ChannelParams && Object.keys(window.ChannelParams).length > 0) ? window.ChannelParams : ChannelParams;
            const key = Object.keys(dict).find(k => k.includes(num));
            if (key) params = dict[key];
        }
    }
    if (params) {
        points = generateChannelPoints(...params);
    }
    if (!points) {
        const cleanType = (type || '').replace(/^(Швеллер)\s*/i, '').trim();
        const parts = cleanType.split(/[\sxх*,\s]+/).filter(Boolean).map(Number);
        if (parts.length >= 6 && parts.every(n => !isNaN(n) && n > 0)) {
            points = generateChannelPoints(...parts);
        }
    }
    if (!points) {
        const dict = (window.ChannelParams && Object.keys(window.ChannelParams).length > 0) ? window.ChannelParams : ChannelParams;
        const keys = Object.keys(dict);
        if (keys.length > 0) points = generateChannelPoints(...dict[keys[0]]);
    }

    if (!points) {
        if (typeof showToast === 'function') showToast(`Ошибка: Профиль '${type}' не найден! (Выберите из списка)`);
        return;
    }
    if (isNaN(length) || length <= 0) {
        if (typeof showToast === 'function') showToast("Ошибка: Некорректная длина!");
        return;
    }

    const shape = createShapeFromBulgePoly(points);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false });
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xFFFFFF, metalness: 0.5, roughness: 0.4 }));
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, showRadialEdges ? 1 : 15), new THREE.LineBasicMaterial({ color: 0x2A3142 })));

    mesh.userData.specData = { type: 'profile', name: type, l: length, profileType: 'channel' };
    if (window.isPreviewMode) {
        window.previewMeshResult = mesh;
        return;
    }
    creatorScene.add(mesh);
    creatorControls.target.copy(mesh.position);
    creatorCamera.position.set(200, 200, length * 1.5);
    creatorControls.update();
    
    if (typeof showToast === 'function') showToast(`Создан Швеллер: ${type} L${length}`);
    addPartToSpec(`Швеллер: ${type} L${length}`, mesh);
}

function createRawStiffenerShape(profType, points, isBulb = false, isAngle = false) {
    let webThick = 8;
    let profHeight = 160;

    const match = (profType || '').match(/[\dxX*хХ]+[xX*хХ](\d+(?:\.\d+)?)/);
    if (match) {
        webThick = parseFloat(match[1]) || 8;
    }
    const hMatch = (profType || '').match(/(\d+(?:\.\d+)?)/);
    if (hMatch) {
        profHeight = parseFloat(hMatch[1]) || 160;
    }

    if (points && points.length >= 4) {
        let maxH = 0;
        points.forEach(p => {
            if (p[1] > maxH) maxH = p[1];
        });
        if (maxH > 0) profHeight = maxH;

        points.forEach(pt => {
            if (Math.abs(pt[1]) < 0.05 && pt[0] > 0.05) {
                webThick = pt[0];
            }
        });

        if (typeof createShapeFromBulgePoly === 'function') {
            return { shape: createShapeFromBulgePoly(points), webThick };
        }
    }

    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(webThick, 0);
    shape.lineTo(webThick, profHeight);
    shape.lineTo(0, profHeight);
    shape.closePath();
    return { shape, webThick };
}

function mergeBufferGeometriesSafe(geometries) {
    if (!geometries || geometries.length === 0) return null;
    if (geometries.length === 1) return geometries[0];
    if (typeof THREE !== 'undefined' && THREE.BufferGeometryUtils && typeof THREE.BufferGeometryUtils.mergeBufferGeometries === 'function') {
        return THREE.BufferGeometryUtils.mergeBufferGeometries(geometries, false);
    }
    let totalPositions = 0;
    let totalNormals = 0;
    let totalIndices = 0;
    let hasIndices = false;

    geometries.forEach(geo => {
        const pos = geo.attributes.position;
        if (pos) totalPositions += pos.array.length;
        const norm = geo.attributes.normal;
        if (norm) totalNormals += norm.array.length;
        if (geo.index) {
            totalIndices += geo.index.array.length;
            hasIndices = true;
        } else if (pos) {
            totalIndices += pos.count;
            hasIndices = true;
        }
    });

    const merged = new THREE.BufferGeometry();
    const mergedPos = new Float32Array(totalPositions);
    const mergedNorm = new Float32Array(totalNormals > 0 ? totalNormals : totalPositions);
    const mergedInd = hasIndices ? new Uint32Array(totalIndices) : null;

    let posOffset = 0;
    let normOffset = 0;
    let indOffset = 0;
    let vertexCountOffset = 0;

    geometries.forEach(geo => {
        const pos = geo.attributes.position;
        const norm = geo.attributes.normal;
        const ind = geo.index;
        const vCount = pos ? pos.count : 0;

        if (pos) {
            mergedPos.set(pos.array, posOffset);
            posOffset += pos.array.length;
        }
        if (norm) {
            mergedNorm.set(norm.array, normOffset);
            normOffset += norm.array.length;
        } else if (pos) {
            normOffset += pos.array.length;
        }

        if (hasIndices) {
            if (ind) {
                for (let i = 0; i < ind.array.length; i++) {
                    mergedInd[indOffset + i] = ind.array[i] + vertexCountOffset;
                }
                indOffset += ind.array.length;
            } else if (pos) {
                for (let i = 0; i < vCount; i++) {
                    mergedInd[indOffset + i] = i + vertexCountOffset;
                }
                indOffset += vCount;
            }
        }
        vertexCountOffset += vCount;
    });

    merged.setAttribute('position', new THREE.BufferAttribute(mergedPos, 3));
    if (mergedNorm && mergedNorm.length > 0) {
        merged.setAttribute('normal', new THREE.BufferAttribute(mergedNorm, 3));
    } else {
        merged.computeVertexNormals();
    }
    if (mergedInd) {
        merged.setIndex(new THREE.BufferAttribute(mergedInd, 1));
    }
    return merged;
}

function buildStiffenerMesh(profType, points, isBulb, isAngle, plateW, plateL, plateT, stX, xOffset, topOff, botOff, steelMat) {
    const filletData = createStiffenerShapeWithFillet(profType, points, isBulb, isAngle);
    const rawData = createRawStiffenerShape(profType, points, isBulb, isAngle);

    const filletShape = filletData.shape;
    const rawShape = rawData.shape;
    const webThick = filletData.webThick;
    const filletRadius = filletData.filletRadius;

    // Ребро идет вдоль Z: от zStart до zEnd
    // topOff > 0: вылет наружу (свес), topOff < 0: недоход (отступ внутрь)
    // botOff > 0: вылет наружу (свес), botOff < 0: недоход (отступ внутрь)
    let zStart = -plateW / 2 - topOff;
    let zEnd = plateW / 2 + botOff;
    if (zEnd < zStart) {
        const tmp = zStart;
        zStart = zEnd;
        zEnd = tmp;
    }
    const totalLength = Math.max(1, zEnd - zStart);

    // Границы основного листа по оси Z: [-plateW/2, plateW/2]
    const plateMinZ = -plateW / 2;
    const plateMaxZ = plateW / 2;

    // Проверяем, есть ли основание (металл листа) по оси X
    const hasBaseUnderX = (stX >= -0.001 && stX <= plateL + 0.001);

    const geos = [];

    // 1. Участок консоли сверху (z < plateMinZ): вне листа -> БЕЗ сопряжения
    const topCantileverLen = Math.max(0, Math.min(zEnd, plateMinZ) - zStart);
    if (topCantileverLen > 0.001) {
        const g1 = new THREE.ExtrudeGeometry(rawShape, { depth: topCantileverLen, bevelEnabled: false });
        geos.push(g1);
    }

    // 2. Участок над листом (в пределах [-plateW/2, plateW/2])
    const plateSegStart = Math.max(zStart, plateMinZ);
    const plateSegEnd = Math.min(zEnd, plateMaxZ);
    const plateSegLen = Math.max(0, plateSegEnd - plateSegStart);
    if (plateSegLen > 0.001) {
        // Если под ребром есть лист по X, используем сопряжение, иначе плоский профиль
        const segShape = hasBaseUnderX ? filletShape : rawShape;
        const g2 = new THREE.ExtrudeGeometry(segShape, { depth: plateSegLen, bevelEnabled: false });
        const segZOffset = plateSegStart - zStart;
        if (segZOffset > 0.0001) {
            g2.translate(0, 0, segZOffset);
        }
        geos.push(g2);
    }

    // 3. Участок консоли снизу (z > plateMaxZ): вне листа -> БЕЗ сопряжения
    const botCantileverStart = Math.max(zStart, plateMaxZ);
    const botCantileverLen = Math.max(0, zEnd - botCantileverStart);
    if (botCantileverLen > 0.001) {
        const g3 = new THREE.ExtrudeGeometry(rawShape, { depth: botCantileverLen, bevelEnabled: false });
        const segZOffset = botCantileverStart - zStart;
        if (segZOffset > 0.0001) {
            g3.translate(0, 0, segZOffset);
        }
        geos.push(g3);
    }

    let finalGeo;
    if (geos.length === 1) {
        finalGeo = geos[0];
    } else if (geos.length > 1) {
        finalGeo = mergeBufferGeometriesSafe(geos);
        geos.forEach(g => g.dispose());
    } else {
        finalGeo = new THREE.ExtrudeGeometry(hasBaseUnderX ? filletShape : rawShape, { depth: totalLength, bevelEnabled: false });
    }

    const stMesh = new THREE.Mesh(finalGeo, steelMat ? steelMat.clone() : new THREE.MeshStandardMaterial({ color: 0xFFFFFF, metalness: 0.5, roughness: 0.4 }));
    const stEdges = new THREE.EdgesGeometry(finalGeo, typeof showRadialEdges !== 'undefined' && showRadialEdges ? 1 : 15);
    const stLine = new THREE.LineSegments(stEdges, new THREE.LineBasicMaterial({ color: 0x2A3142 }));
    stMesh.add(stLine);

    stMesh.position.set(-plateL / 2 + stX + xOffset, plateT, zStart);

    return { stMesh, webThick, filletRadius, totalLength };
}

function createStiffenerShapeWithFillet(profType, points, isBulb = false, isAngle = false) {
    let webThick = 8;
    let profHeight = 160;

    const match = (profType || '').match(/[\dxX*хХ]+[xX*хХ](\d+(?:\.\d+)?)/);
    if (match) {
        webThick = parseFloat(match[1]) || 8;
    }
    const hMatch = (profType || '').match(/(\d+(?:\.\d+)?)/);
    if (hMatch) {
        profHeight = parseFloat(hMatch[1]) || 160;
    }

    if (points && points.length >= 4) {
        let maxH = 0;
        points.forEach(p => {
            if (p[1] > maxH) maxH = p[1];
        });
        if (maxH > 0) profHeight = maxH;
    }

    const R = webThick; // Сопряжение с базовой панелью равно толщине стенки

    const helperAddArc = (shape, p1_arr, p2_arr) => {
        const p1 = new THREE.Vector2(p1_arr[0], p1_arr[1]);
        const p2 = new THREE.Vector2(p2_arr[0], p2_arr[1]);
        const bulge = p1_arr[2] || 0;
        if (p1.distanceTo(p2) < 0.0001) return;
        if (!bulge || Math.abs(bulge) < 1e-6) {
            shape.lineTo(p2.x, p2.y);
        } else {
            const angle = 4 * Math.atan(bulge);
            const distance = p1.distanceTo(p2);
            const radius = Math.abs(0.5 * distance / Math.sin(angle / 2));
            const midPoint = new THREE.Vector2().addVectors(p1, p2).multiplyScalar(0.5);
            const chordVec = new THREE.Vector2().subVectors(p2, p1);
            const h = Math.sqrt(Math.max(0, radius * radius - (distance / 2) * (distance / 2)));
            const perpVec = new THREE.Vector2(-chordVec.y, chordVec.x).normalize();
            const center = midPoint.clone().add(perpVec.multiplyScalar(h * Math.sign(bulge)));
            const startAngle = new THREE.Vector2().subVectors(p1, center).angle();
            const endAngle = new THREE.Vector2().subVectors(p2, center).angle();
            const clockwise = bulge < 0;
            shape.absarc(center.x, center.y, radius, startAngle, endAngle, clockwise);
        }
    };

    if (points && points.length >= 4) {
        let i0 = -1; // vertex at (0, 0)
        let i1 = -1; // vertex at (webThick, 0)
        const N = points.length;

        for (let i = 0; i < N; i++) {
            const pt = points[i];
            if (Math.abs(pt[0]) < 0.05 && Math.abs(pt[1]) < 0.05) {
                i0 = i;
            } else if (Math.abs(pt[1]) < 0.05 && pt[0] > 0.05) {
                i1 = i;
                webThick = pt[0];
            }
        }

        if (i0 !== -1 && i1 !== -1) {
            const shape = new THREE.Shape();

            if ((i0 + 1) % N === i1) {
                // Контур идет: i1 -> ... -> i0 (по верху профиля)
                // Начинаем с правой стенки (webThick, R)
                shape.moveTo(webThick, R);

                const nextIdx = (i1 + 1) % N;
                helperAddArc(shape, [webThick, R, points[i1][2] || 0], points[nextIdx]);

                let cur = nextIdx;
                while (cur !== i0 && (cur + 1) % N !== i0) {
                    const nxt = (cur + 1) % N;
                    helperAddArc(shape, points[cur], points[nxt]);
                    cur = nxt;
                }

                if (cur !== i0) {
                    helperAddArc(shape, points[cur], [0, R, 0]);
                }

                // Левое сопряжение: плавно переходит от x=0, y=R к x=-R, y=0
                shape.absarc(-R, R, R, 0, -Math.PI / 2, true);

                // Нижняя граница по пластине панели
                shape.lineTo(webThick + R, 0);

                // Правое сопряжение: плавно переходит от x=webThick+R, y=0 к x=webThick, y=R
                shape.absarc(webThick + R, R, R, -Math.PI / 2, -Math.PI, true);

                shape.closePath();
                return { shape, webThick, filletRadius: R };

            } else if ((i1 + 1) % N === i0) {
                // Контур идет: i0 -> ... -> i1 (по верху профиля)
                // Начинаем с левой стенки (0, R)
                shape.moveTo(0, R);

                const nextIdx = (i0 + 1) % N;
                helperAddArc(shape, [0, R, points[i0][2] || 0], points[nextIdx]);

                let cur = nextIdx;
                while (cur !== i1 && (cur + 1) % N !== i1) {
                    const nxt = (cur + 1) % N;
                    helperAddArc(shape, points[cur], points[nxt]);
                    cur = nxt;
                }

                if (cur !== i1) {
                    helperAddArc(shape, points[cur], [webThick, R, 0]);
                }

                // Правое сопряжение: от x=webThick, y=R к x=webThick+R, y=0
                shape.absarc(webThick + R, R, R, -Math.PI, -Math.PI / 2, false);

                // Нижняя граница по пластине панели
                shape.lineTo(-R, 0);

                // Левое сопряжение: от x=-R, y=0 к x=0, y=R
                shape.absarc(-R, R, R, -Math.PI / 2, 0, false);

                shape.closePath();
                return { shape, webThick, filletRadius: R };
            }
        }
    }

    const shape = new THREE.Shape();
    shape.moveTo(-R, 0);
    shape.lineTo(webThick + R, 0);
    shape.absarc(webThick + R, R, R, -Math.PI / 2, -Math.PI, true);
    shape.lineTo(webThick, profHeight);
    shape.lineTo(0, profHeight);
    shape.lineTo(0, R);
    shape.absarc(-R, R, R, 0, -Math.PI / 2, true);
    shape.closePath();
    return { shape, webThick, filletRadius: R };
}

function createPanel(plateT, plateW, plateL, profType, spacing, dir = 'length', customStiffeners = null) {
    plateT = parseFloat(plateT) || 10;
    plateW = parseFloat(plateW) || 2000;
    plateL = parseFloat(plateL) || 6000;
    spacing = parseFloat(spacing) || 500;
    profType = (profType || 'HP 160x8').trim();

    if (plateT <= 0 || plateW <= 0 || plateL <= 0) {
        if (typeof showToast === 'function') showToast("Ошибка: Размеры листа должны быть больше нуля!");
        return;
    }

    if (typeof initBulbProfiles === 'function' && (!BulbProfiles || Object.keys(BulbProfiles).length === 0)) {
        initBulbProfiles();
    }

    const panelGroup = new THREE.Group();
    panelGroup.name = `Панель ${plateT}x${plateW}x${plateL} (${profType})`;
    panelGroup.userData.isUnifiedGroup = true;
    panelGroup.userData.isPanel = true;

    const steelMat = new THREE.MeshStandardMaterial({ 
        color: 0xFFFFFF, 
        metalness: 0.5, 
        roughness: 0.4 
    });

    // 1. Основной лист (полотнище/настил)
    // BoxGeometry(L, T, W) -> L по оси X, T по оси Y, W по оси Z
    const plateGeo = new THREE.BoxGeometry(plateL, plateT, plateW);
    const plateMesh = new THREE.Mesh(plateGeo, steelMat.clone());
    plateMesh.position.set(0, plateT / 2, 0);
    const plateEdges = new THREE.EdgesGeometry(plateGeo, showRadialEdges ? 1 : 15);
    const plateLine = new THREE.LineSegments(plateEdges, new THREE.LineBasicMaterial({ color: 0x2A3142 }));
    plateMesh.add(plateLine);
    plateMesh.name = `Лист ${plateT}x${plateW}x${plateL}`;
    plateMesh.userData.isPanelPlate = true;
    plateMesh.userData.specData = { 
        type: 'plate', 
        t: plateT, th: plateT, thickness: plateT, wallThick: plateT, depth: plateT,
        w: plateW, l: plateL,
        plateW: plateW, plateL: plateL, plateT: plateT,
        broadNormal: new THREE.Vector3(0, 1, 0)
    };
    plateMesh.userData.parentUnifiedGroup = panelGroup;
    panelGroup.add(plateMesh);

    // 2. Получение профиля набора
    let points = null;
    let isBulb = false;
    let isAngle = false;

    const dict = (window.BulbProfiles && Object.keys(window.BulbProfiles).length > 0) ? window.BulbProfiles : BulbProfiles;
    if (dict) {
        if (dict[profType]) {
            points = dict[profType];
            isBulb = true;
        } else {
            const clean = profType.toLowerCase().replace(/[хx\s]/gi, '');
            const key = Object.keys(dict).find(k => k.toLowerCase().replace(/[хx\s]/gi, '') === clean);
            if (key) {
                points = dict[key];
                isBulb = true;
            }
        }
    }

    if (!points && typeof getAngleProfilePoints === 'function') {
        points = getAngleProfilePoints(profType);
        if (points) isAngle = true;
    }

    if (!points && dict && Object.keys(dict).length > 0) {
        points = dict["HP 160x8"] || dict[Object.keys(dict)[0]];
        isBulb = true;
    }

    // Ребра жесткости
    const stiffenersToBuild = (customStiffeners && customStiffeners.length > 0) 
        ? customStiffeners 
        : (window.panelStiffeners && window.panelStiffeners.length > 0 ? window.panelStiffeners : null);

    let stiffenerCount = 0;
    let panelFilletRadius = 8;

    if (stiffenersToBuild && stiffenersToBuild.length > 0) {
        stiffenerCount = stiffenersToBuild.length;
        stiffenersToBuild.forEach((st, idx) => {
            const topOff = parseFloat(st.topOffset) || 0;
            const botOff = parseFloat(st.botOffset) || 0;
            const stX = parseFloat(st.x) || 0;
            const stProfType = st.profType || profType;

            let stPts = points;
            let stIsBulb = isBulb;
            let stIsAngle = isAngle;
            if (stProfType !== profType) {
                stPts = dict ? (dict[stProfType] || null) : null;
                if (stPts) {
                    stIsBulb = true;
                    stIsAngle = false;
                } else if (typeof getAngleProfilePoints === 'function') {
                    stPts = getAngleProfilePoints(stProfType);
                    stIsAngle = !!stPts;
                    stIsBulb = !stPts;
                }
            }

            let xOffset = 0;
            const match = (stProfType || '').match(/[\dxX*хХ]+[xX*хХ](\d+(?:\.\d+)?)/);
            const approxWeb = match ? (parseFloat(match[1]) || 8) : 8;

            if (st.side === '-') {
                xOffset = -approxWeb;
            } else if (st.side === '=') {
                xOffset = -approxWeb / 2;
            } else {
                xOffset = 0;
            }

            const { stMesh, webThick, filletRadius, totalLength } = buildStiffenerMesh(
                stProfType, stPts, stIsBulb, stIsAngle, 
                plateW, plateL, plateT, stX, xOffset, topOff, botOff, steelMat
            );
            panelFilletRadius = filletRadius;

            stMesh.name = `Ребро ${idx + 1}: ${stProfType} L${Math.round(totalLength)}`;
            stMesh.userData.isPanelStiffener = true;
            stMesh.userData.filletRadius = filletRadius;
            stMesh.userData.parentUnifiedGroup = panelGroup;
            stMesh.userData.specData = {
                type: 'profile',
                profileType: stIsBulb ? 'bulbbar' : (stIsAngle ? 'angle' : 'rib'),
                name: stProfType,
                l: totalLength,
                filletRadius: filletRadius
            };
            panelGroup.add(stMesh);
        });
    } else {
        stiffenerCount = Math.floor(plateL / spacing);
        if (stiffenerCount < 1) stiffenerCount = 1;
        const effectiveSpacing = plateL / (stiffenerCount + 1);
        const startCoord = -plateL / 2 + effectiveSpacing;

        for (let i = 0; i < stiffenerCount; i++) {
            const coord = startCoord + i * effectiveSpacing;
            const stX = coord + plateL / 2;
            const match = (profType || '').match(/[\dxX*хХ]+[xX*хХ](\d+(?:\.\d+)?)/);
            const approxWeb = match ? (parseFloat(match[1]) || 8) : 8;
            const xOffset = -approxWeb / 2;

            const { stMesh, filletRadius, totalLength } = buildStiffenerMesh(
                profType, points, isBulb, isAngle,
                plateW, plateL, plateT, stX, xOffset, 0, 0, steelMat
            );
            panelFilletRadius = filletRadius;

            stMesh.name = `Ребро ${i+1}: ${profType} L${plateW}`;
            stMesh.userData.isPanelStiffener = true;
            stMesh.userData.filletRadius = filletRadius;
            stMesh.userData.parentUnifiedGroup = panelGroup;
            stMesh.userData.specData = {
                type: 'profile',
                profileType: isBulb ? 'bulbbar' : (isAngle ? 'angle' : 'rib'),
                name: profType,
                l: totalLength,
                filletRadius: filletRadius
            };
            panelGroup.add(stMesh);
        }
    }

    panelGroup.userData.isPanel = true;
    panelGroup.userData.specData = {
        type: 'panel',
        name: 'ПКО',
        category: 'plate',
        typeName: 'ПКО',
        plateT: plateT,
        plateW: plateW,
        plateL: plateL,
        profileType: profType,
        stiffenerSpacing: spacing,
        stiffenerCount: stiffenerCount,
        stiffenerDir: 'width',
        l: plateL,
        w: plateW,
        t: plateT,
        size: `${plateT}x${plateW}x${plateL}`,
        filletRadius: panelFilletRadius
    };

    if (window.isPreviewMode) {
        window.previewMeshResult = panelGroup;
        return;
    }

    creatorScene.add(panelGroup);

    creatorControls.target.copy(panelGroup.position);
    creatorCamera.position.set(plateL * 0.9, Math.max(plateW, plateL) * 0.7, plateW * 0.9);
    creatorControls.update();

    const toastMsg = `Создано ПКО: Лист ${plateT}x${plateW}x${plateL}, ${stiffenerCount}x ${profType}`;
    if (typeof showToast === 'function') showToast(toastMsg);
    addPartToSpec(`ПКО: ${plateT}x${plateW}x${plateL} [${stiffenerCount}x ${profType}]`, panelGroup);
}

// --- ЛОГИКА ГИЗМО И СЛИПАНИЯ ---

function isDescendant(child, potentialAncestor) {
    if (!child || !potentialAncestor) return false;
    let curr = child;
    let safety = 0;
    const visited = new Set();
    while (curr && safety++ < 200) {
        if (visited.has(curr)) break;
        visited.add(curr);
        if (curr === potentialAncestor) return true;
        curr = curr.parent;
    }
    return false;
}

// --- ИНТЕРАКТИВНЫЙ ГАБАРИТНЫЙ КУБ-РАЗВЕРТКА ДЛЯ ВЫБОРА ТОНКИХ ГРАНЕЙ (MATE HELPER BOX) ---

function closeMateHelperBox() {
    if (!mateUnfoldedHelper) return;
    if (mateUnfoldedHelper.group) {
        creatorScene.remove(mateUnfoldedHelper.group);
        mateUnfoldedHelper.group.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) child.material.forEach(m => m && m.dispose());
                else child.material.dispose();
            }
        });
    }
    mateUnfoldedHelper = null;
    const canvas = document.getElementById("canvas-creator");
    if (canvas) canvas.style.cursor = 'default';
    if (sketchHudTooltip && !isSketchMode) {
        sketchHudTooltip.style.display = 'none';
        sketchHudTooltip.innerText = '';
    }
}
window.closeMateHelperBox = closeMateHelperBox;

// Вспомогательная функция вычисления 2D Convex Hull
function compute2DConvexHull(points) {
    if (points.length <= 3) return points.slice();
    const pts = points.slice().sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (let p of pts) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
}

// Упрощение коллинеарных вершин многоугольника для чистых прямых кромок и диагоналей
function simplify2DPolygon(pts) {
    if (pts.length <= 3) return pts;
    const res = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
        const prev = pts[(i - 1 + n) % n];
        const cur = pts[i];
        const next = pts[(i + 1) % n];
        const v1 = new THREE.Vector2().subVectors(cur, prev).normalize();
        const v2 = new THREE.Vector2().subVectors(next, cur).normalize();
        const cross = Math.abs(v1.x * v2.y - v1.y * v2.x);
        if (cross > 0.02) {
            res.push(cur);
        }
    }
    return res.length >= 3 ? res : pts;
}

function openMateUnfoldedHelper(targetObject, hitPointWorld, hitNormalLocal, hitFaceIndex = 0) {
    if (!targetObject || !targetObject.geometry) return;
    closeMateHelperBox();

    if (window.unfoldLifecycleManager) {
        if (window.unfoldLifecycleManager.isActive) {
            window.unfoldLifecycleManager.disableUnfold();
            return;
        }
        window.unfoldLifecycleManager.enableUnfold(targetObject, {
            faceIndex: hitFaceIndex !== undefined ? hitFaceIndex : 0,
            point: hitPointWorld,
            normal: hitNormalLocal,
            object: targetObject
        });
        return;
    }

    targetObject.geometry.computeBoundingBox();
    const bbox = targetObject.geometry.boundingBox;
    if (!bbox) return;

    const min = bbox.min.clone();
    const max = bbox.max.clone();
    const rawSize = new THREE.Vector3().subVectors(max, min);
    const center = new THREE.Vector3().addVectors(max, min).multiplyScalar(0.5);

    const scaleFactor = 1.3;
    const sx = Math.max(rawSize.x * scaleFactor, 12);
    const sy = Math.max(rawSize.y * scaleFactor, 12);
    const sz = Math.max(rawSize.z * scaleFactor, 12);

    // 6 ориентированных граней ориентированного габарита
    const allFaces = [
        { id: '+Z', name: 'Пласть [+Z] (Лицевая сторона)', normal: new THREE.Vector3(0, 0, 1), realCenter: new THREE.Vector3(center.x, center.y, max.z) },
        { id: '-Z', name: 'Пласть [-Z] (Обратная сторона / Выдра)', normal: new THREE.Vector3(0, 0, -1), realCenter: new THREE.Vector3(center.x, center.y, min.z) },
        { id: '+X', name: 'Торец [+X] (Правая грань)', normal: new THREE.Vector3(1, 0, 0), realCenter: new THREE.Vector3(max.x, center.y, center.z) },
        { id: '-X', name: 'Торец [-X] (Левая грань)', normal: new THREE.Vector3(-1, 0, 0), realCenter: new THREE.Vector3(min.x, center.y, center.z) },
        { id: '+Y', name: 'Торец [+Y] (Верхняя грань)', normal: new THREE.Vector3(0, 1, 0), realCenter: new THREE.Vector3(center.x, max.y, center.z) },
        { id: '-Y', name: 'Торец [-Y] (Нижняя грань)', normal: new THREE.Vector3(0, -1, 0), realCenter: new THREE.Vector3(center.x, min.y, center.z) }
    ];

    // Находим базовую опорную грань, по которой был произведен правый клик
    let baseIdx = 0;
    let maxDot = -Infinity;
    const targetLocalNorm = hitNormalLocal ? hitNormalLocal.clone().normalize() : new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < allFaces.length; i++) {
        const dot = allFaces[i].normal.dot(targetLocalNorm);
        if (dot > maxDot) {
            maxDot = dot;
            baseIdx = i;
        }
    }
    const baseFace = allFaces[baseIdx];

    // Определяем локальные ортонормированные оси U, V, N и габариты W, H, D
    let U = new THREE.Vector3();
    let V = new THREE.Vector3();
    const N = baseFace.normal.clone();
    let W = sx, H = sy, D = sz;
    let rawD = rawSize.z;

    if (Math.abs(N.z) > 0.8) {
        U.set(N.z > 0 ? 1 : -1, 0, 0);
        V.set(0, 1, 0);
        W = sx; H = sy; D = sz;
        rawD = rawSize.z;
    } else if (Math.abs(N.x) > 0.8) {
        U.set(0, N.x > 0 ? 1 : -1, 0);
        V.set(0, 0, 1);
        W = sy; H = sz; D = sx;
        rawD = rawSize.x;
    } else {
        U.set(0, 0, N.y > 0 ? 1 : -1);
        V.set(1, 0, 0);
        W = sz; H = sx; D = sy;
        rawD = rawSize.y;
    }

    // Извлечение реального 2D полигона внешнего контура (кницы, скосы, эскизы, вырезы)
    let poly2D = [];
    try {
        if (Math.abs(N.z) > 0.8 && targetObject.userData && targetObject.userData.sketchSource && targetObject.userData.sketchSource.segments) {
            const segs = targetObject.userData.sketchSource.segments;
            if (segs.length >= 3) {
                const c2d = new THREE.Vector2(center.x, center.y);
                for (let k = 0; k < segs.length; k++) {
                    const sk = segs[k].start;
                    poly2D.push(new THREE.Vector2(sk.x, sk.y).sub(c2d).multiplyScalar(scaleFactor));
                }
            }
        }
    } catch (e) {
        poly2D = [];
    }

    // Если полигон не из эскиза, извлекаем реальные 3D вершины геометрии на плоскости
    if (poly2D.length < 3 && targetObject.geometry && targetObject.geometry.attributes && targetObject.geometry.attributes.position) {
        const posAttr = targetObject.geometry.attributes.position;
        const pts2d = [];
        for (let i = 0; i < posAttr.count; i++) {
            const vx = posAttr.getX(i);
            const vy = posAttr.getY(i);
            const vz = posAttr.getZ(i);
            const v = new THREE.Vector3(vx, vy, vz).sub(center);
            const uCoord = v.dot(U) * scaleFactor;
            const vCoord = v.dot(V) * scaleFactor;
            pts2d.push(new THREE.Vector2(uCoord, vCoord));
        }
        const hull = compute2DConvexHull(pts2d);
        poly2D = simplify2DPolygon(hull);
    }

    // Если точек мало — стандартный 4-угольный габарит
    if (poly2D.length < 3) {
        poly2D = [
            new THREE.Vector2(-W / 2, -H / 2),
            new THREE.Vector2(W / 2, -H / 2),
            new THREE.Vector2(W / 2, H / 2),
            new THREE.Vector2(-W / 2, H / 2)
        ];
    }

    // Строим форму пласти
    const baseShape = new THREE.Shape();
    baseShape.moveTo(poly2D[0].x, poly2D[0].y);
    for (let i = 1; i < poly2D.length; i++) {
        baseShape.lineTo(poly2D[i].x, poly2D[i].y);
    }
    baseShape.closePath();

    // Создаем матрицу базиса для ориентации опорной плоскости
    const basisMatrix = new THREE.Matrix4().makeBasis(U, V, N);
    const baseQuat = new THREE.Quaternion().setFromRotationMatrix(basisMatrix);

    const helperGroup = new THREE.Group();
    helperGroup.name = 'mateUnfoldedHelperGroup';
    helperGroup.userData.isMateHelperGroup = true;

    // Внутренняя группа, позиционируемая над базовой гранью
    const baseGroup = new THREE.Group();
    baseGroup.position.copy(center).addScaledVector(N, rawD / 2);
    baseGroup.quaternion.copy(baseQuat);
    baseGroup.scale.set(1.0, 1.0, 1.0);
    helperGroup.add(baseGroup);

    const plates = [];

    // Фабрика создания интерактивной грани с неоновой рамкой
    function createFacePlate(width, height, faceInfo, axisU, axisV, customGeom) {
        const geo = customGeom || new THREE.PlaneGeometry(width, height);
        const mat = new THREE.MeshBasicMaterial({
            color: 0x00E676,
            transparent: true,
            opacity: 0.38,
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = 'mateHelperFaceMesh';
        mesh.renderOrder = 9999;

        const edgesGeo = new THREE.EdgesGeometry(geo);
        const edgesMat = new THREE.LineBasicMaterial({
            color: 0x00FF88,
            linewidth: 2,
            transparent: true,
            opacity: 0.95,
            depthTest: false
        });
        const edgesLine = new THREE.LineSegments(edgesGeo, edgesMat);
        edgesLine.name = 'mateHelperFaceEdges';
        edgesLine.renderOrder = 10000;
        mesh.add(edgesLine);

        mesh.userData = {
            isMateHelperFace: true,
            targetObject: targetObject,
            originalLocalNormal: (faceInfo && faceInfo.normal) ? faceInfo.normal.clone() : N.clone(),
            originalLocalPoint: (faceInfo && faceInfo.realCenter) ? faceInfo.realCenter.clone() : center.clone(),
            faceName: faceInfo ? faceInfo.name : 'Грань',
            axisU: axisU ? axisU.clone() : new THREE.Vector3(1, 0, 0),
            axisV: axisV ? axisV.clone() : new THREE.Vector3(0, 1, 0),
            scaleFactor: scaleFactor
        };

        const plateObj = {
            mesh: mesh,
            edgesLine: edgesLine,
            currentHoverScale: 1.0,
            targetHoverScale: 1.0
        };
        plates.push(plateObj);
        return plateObj;
    }

    // 1. Опорная пласть (Base Face)
    const basePlate = createFacePlate(W, H, baseFace, U, V, new THREE.ShapeGeometry(baseShape));
    basePlate.mesh.position.set(0, 0, 0);
    baseGroup.add(basePlate.mesh);

    // 2. Генерация торцов по ВСЕМ ребрам многоугольника (включая диагональные скосы книц)
    const edgeHinges = [];
    let longestEdgeIdx = 0;
    let longestEdgeLen = 0;
    const numEdges = poly2D.length;

    for (let i = 0; i < numEdges; i++) {
        const p1 = poly2D[i];
        const p2 = poly2D[(i + 1) % numEdges];

        const edgeVec = new THREE.Vector2().subVectors(p2, p1);
        const edgeLen = edgeVec.length();
        if (edgeLen < 0.01) continue;

        if (edgeLen > longestEdgeLen) {
            longestEdgeLen = edgeLen;
            longestEdgeIdx = i;
        }

        const mid = new THREE.Vector2().addVectors(p1, p2).multiplyScalar(0.5);
        const tangent = edgeVec.clone().normalize();
        // Внешняя нормаль к ребру
        let norm2D = new THREE.Vector2(tangent.y, -tangent.x);
        if (norm2D.dot(mid) < 0) {
            norm2D.negate();
        }

        // Локальная 3D-нормаль грани в координатах детали
        const edge3DNormal = new THREE.Vector3().addScaledVector(U, norm2D.x).addScaledVector(V, norm2D.y).normalize();
        const edge3DPoint = center.clone().addScaledVector(U, mid.x / scaleFactor).addScaledVector(V, mid.y / scaleFactor);

        // Имя грани (распознавание диагонального скоса)
        const isDiagonal = (Math.abs(norm2D.x) > 0.15 && Math.abs(norm2D.y) > 0.15);
        const faceTitle = isDiagonal 
            ? `Торец [Диагональный скос] (${Math.round(edgeLen / scaleFactor)} мм)`
            : `Торец [Кромка ${i + 1}] (${Math.round(edgeLen / scaleFactor)} мм)`;

        // Надежная иерархия шарнира: Anchor (позиция/ориентация в плоскости) -> Rotator (вращение X)
        const anchor = new THREE.Group();
        anchor.position.set(mid.x, mid.y, 0);
        const rotZ = Math.atan2(norm2D.y, norm2D.x) - Math.PI / 2;
        anchor.rotation.z = rotZ;

        const rotator = new THREE.Group();
        rotator.rotation.x = Math.PI / 2; // Исходно сложен под 90° в 3D
        anchor.add(rotator);

        // Планка торца
        const edgePlate = createFacePlate(edgeLen, D, {
            normal: edge3DNormal,
            realCenter: edge3DPoint,
            name: faceTitle
        }, new THREE.Vector3().addScaledVector(U, tangent.x).addScaledVector(V, tangent.y), N);

        edgePlate.mesh.position.set(0, D / 2, 0);
        rotator.add(edgePlate.mesh);
        baseGroup.add(anchor);

        edgeHinges.push({
            anchor: anchor,
            rotator: rotator,
            baseMid: mid.clone(),
            norm2D: norm2D.clone(),
            edgeLen: edgeLen,
            edgePlate: edgePlate
        });
    }

    // 3. Обратная пласть / Выдра (раскладывается наружу от самого длинного ребра)
    let oppositeHingeAnchor = null;
    let oppositeRotator = null;
    let oppHeight = H;

    if (edgeHinges.length > 0) {
        const bestHinge = edgeHinges[longestEdgeIdx];
        oppositeHingeAnchor = new THREE.Group();
        oppositeHingeAnchor.position.set(0, D, 0);

        oppositeRotator = new THREE.Group();
        oppositeRotator.rotation.x = Math.PI / 2;
        oppositeHingeAnchor.add(oppositeRotator);

        const oppFace = allFaces.find(f => f.normal.dot(N) < -0.8) || allFaces[1];
        const oppPlate = createFacePlate(W, H, oppFace, U, V, new THREE.ShapeGeometry(baseShape));
        oppPlate.mesh.position.set(0, H / 2, 0);
        oppositeRotator.add(oppPlate.mesh);

        bestHinge.rotator.add(oppositeHingeAnchor);
    }

    helperGroup.position.copy(targetObject.position);
    helperGroup.quaternion.copy(targetObject.quaternion);
    helperGroup.scale.set(1.0, 1.0, 1.0);

    creatorScene.add(helperGroup);

    const margin = 16;

    mateUnfoldedHelper = {
        group: helperGroup,
        baseGroup: baseGroup,
        targetObject: targetObject,
        plates: plates,
        edgeHinges: edgeHinges,
        oppositeRotator: oppositeRotator,
        oppositeHingeAnchor: oppositeHingeAnchor,
        dims: { W, H, D, margin, rawD },
        centerLocal: center.clone(),
        normalLocal: N.clone(),
        hoveredFaceMesh: null,
        startTime: performance.now(),
        animDuration: 600,
        animating: true
    };

    if (typeof showToast === 'function') {
        showToast(`Развертка детали сформирована (${plates.length} поверхностей): выберите грань кликом ЛКМ`);
    }
}
window.openMateUnfoldedHelper = openMateUnfoldedHelper;

function updateMateUnfoldedHelperAnimation() {
    if (!mateUnfoldedHelper) return;
    const now = performance.now();
    const data = mateUnfoldedHelper;

    if (data.animating) {
        const elapsed = now - data.startTime;
        const p = Math.min(1.0, elapsed / data.animDuration);
        // Плавный Ease In-Out Cubic для непрерывного движения
        const ease = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;

        const { D, margin, rawD } = data.dims;

        // Плавное масштабирование от 1.0x (облегает модель) до 1.3x (увеличенная развертка)
        const curScale = 1.0 + 0.3 * ease;
        data.baseGroup.scale.set(curScale, curScale, 1.0);

        // Плавный подъем развертки над поверхностью детали
        const liftDist = (rawD / 2) + (D / 2 + 10 - rawD / 2) * ease;
        data.baseGroup.position.copy(data.centerLocal).addScaledVector(data.normalLocal, liftDist);

        // Вращение шарниров от 90° к 0° и раздвижка зазоров (gap)
        const theta = (1 - ease) * (Math.PI / 2);
        const gap = margin * ease;

        if (data.edgeHinges) {
            data.edgeHinges.forEach(eh => {
                eh.anchor.position.x = eh.baseMid.x * curScale + eh.norm2D.x * gap;
                eh.anchor.position.y = eh.baseMid.y * curScale + eh.norm2D.y * gap;
                eh.rotator.rotation.x = theta;
            });
        }

        if (data.oppositeHingeAnchor && data.oppositeRotator) {
            data.oppositeHingeAnchor.position.y = D + gap;
            data.oppositeRotator.rotation.x = theta;
        }

        if (p >= 1.0) {
            if (data.edgeHinges) {
                data.edgeHinges.forEach(eh => {
                    eh.anchor.position.x = eh.baseMid.x * 1.3 + eh.norm2D.x * margin;
                    eh.anchor.position.y = eh.baseMid.y * 1.3 + eh.norm2D.y * margin;
                    eh.rotator.rotation.x = 0;
                });
            }
            if (data.oppositeHingeAnchor && data.oppositeRotator) {
                data.oppositeHingeAnchor.position.y = D + margin;
                data.oppositeRotator.rotation.x = 0;
            }
            data.animating = false;
        }
    }

    // Плавное интерактивное масштабирование граней при наведении
    data.plates.forEach(p => {
        const isHovered = (data.hoveredFaceMesh === p.mesh);
        p.targetHoverScale = isHovered ? 1.15 : 1.0;
        p.currentHoverScale += (p.targetHoverScale - p.currentHoverScale) * 0.22;
        p.mesh.scale.setScalar(p.currentHoverScale);

        if (isHovered) {
            p.mesh.material.opacity = 0.82;
            p.mesh.material.color.setHex(0x00FFAA);
            p.edgesLine.material.color.setHex(0xFFFFFF);
        } else {
            p.mesh.material.opacity = 0.38;
            p.mesh.material.color.setHex(0x00E676);
            p.edgesLine.material.color.setHex(0x00FF88);
        }
    });
}
window.updateMateUnfoldedHelperAnimation = updateMateUnfoldedHelperAnimation;

function updateMateHelperHover(raycaster) {
    if (!mateUnfoldedHelper || !mateUnfoldedHelper.plates) return;
    const meshes = mateUnfoldedHelper.plates.map(p => p.mesh);
    const intersects = raycaster.intersectObjects(meshes, false);
    const canvas = document.getElementById("canvas-creator");

    if (intersects.length > 0) {
        const hitMesh = intersects[0].object;
        mateUnfoldedHelper.hoveredFaceMesh = hitMesh;
        if (canvas) canvas.style.cursor = 'pointer';
    } else {
        mateUnfoldedHelper.hoveredFaceMesh = null;
        if (canvas) canvas.style.cursor = 'default';
    }

    // Скрываем подсказку под курсором в 3D режиме развертки
    if (sketchHudTooltip && !isSketchMode) {
        sketchHudTooltip.style.display = 'none';
        sketchHudTooltip.innerText = '';
    }
}
window.updateMateHelperHover = updateMateHelperHover;

function handleMateHelperFaceClick(hitMesh, hitPointWorld) {
    if (!hitMesh || !hitMesh.userData || !hitMesh.userData.isMateHelperFace) return false;
    const targetObj = hitMesh.userData.targetObject;
    const localNorm = hitMesh.userData.originalLocalNormal;
    const localPt = hitMesh.userData.originalLocalPoint;

    // Точная интерполяция точки клика на исходную поверхность 3D-модели
    let interpolatedLocalPt = localPt.clone();
    if (hitPointWorld && hitMesh.userData.axisU && hitMesh.userData.axisV) {
        const localHit = hitMesh.worldToLocal(hitPointWorld.clone());
        const scale = hitMesh.userData.scaleFactor || 1.3;
        const du = localHit.x / scale;
        const dv = localHit.y / scale;
        interpolatedLocalPt.addScaledVector(hitMesh.userData.axisU, du);
        interpolatedLocalPt.addScaledVector(hitMesh.userData.axisV, dv);
    }

    const normalMatrix = new THREE.Matrix3().getNormalMatrix(targetObj.matrixWorld);
    const worldNormal = localNorm.clone().applyMatrix3(normalMatrix).normalize();
    const worldPoint = targetObj.localToWorld(interpolatedLocalPt.clone());

    closeMateHelperBox();

    if (mateState === 1) {
        mateObjectA = targetObj;
        mateFaceA = {
            point: worldPoint.clone(),
            normal: worldNormal.clone(),
            localNormal: localNorm.clone(),
            localPoint: interpolatedLocalPt.clone()
        };
        if (mateHighlightA) creatorScene.remove(mateHighlightA);
        mateHighlightA = createFaceHighlight(worldPoint, worldNormal, 0x5AAFDD);
        creatorScene.add(mateHighlightA);

        mateState = 2;
        if (typeof showToast === 'function') {
            showToast("Первая грань выбрана. Теперь выберите грань на ДРУГОМ объекте (ПКМ для развертки)");
        }
        return true;
    } else if (mateState === 2) {
        if (targetObj === mateObjectA) {
            if (typeof showToast === 'function') showToast("Выберите грань на ДРУГОМ объекте!");
            return true;
        }

        mateObjectB = targetObj;
        mateFaceB = {
            point: worldPoint.clone(),
            normal: worldNormal.clone(),
            localNormal: localNorm.clone(),
            localPoint: interpolatedLocalPt.clone()
        };
        if (mateHighlightB) creatorScene.remove(mateHighlightB);
        mateHighlightB = createFaceHighlight(worldPoint, worldNormal, 0xE6A817);
        creatorScene.add(mateHighlightB);

        mateState = 0;
        setCreatorUIMode('default');
        if (window.setCreatorActiveTool) window.setCreatorActiveTool(null);

        animateMate(mateObjectA, mateFaceA, mateObjectB, mateFaceB, mateHighlightA, mateHighlightB);
        return true;
    }
    return false;
}
window.handleMateHelperFaceClick = handleMateHelperFaceClick;

function handleMateContextMenu(e) {
    if (window.unfoldLifecycleManager && window.unfoldLifecycleManager.isActive) {
        window.unfoldLifecycleManager.disableUnfold();
        if (typeof showToast === 'function') showToast("Развертка закрыта");
        return;
    }
    if (mateUnfoldedHelper) {
        closeMateHelperBox();
        if (typeof showToast === 'function') showToast("Развертка закрыта");
        return;
    }

    const canvas_element = document.getElementById("canvas-creator");
    if (!canvas_element) return;
    const rect = canvas_element.getBoundingClientRect();
    sketchMouse.x = ((e.clientX - rect.left) / canvas_element.clientWidth) * 2 - 1;
    sketchMouse.y = -((e.clientY - rect.top) / canvas_element.clientHeight) * 2 + 1;
    sketchRaycaster.setFromCamera(sketchMouse, currentCreatorCamera);

    const interactable = [];
    creatorScene.traverse(c => {
        if (c.isMesh && !c.userData.isSketchPlane && !c.userData.isSketch && c !== snapMarker && !c.userData.isMateHighlight && !c.userData.isMateSymbol && !c.userData.isGizmo) {
            interactable.push(c);
        }
    });

    const intersects = sketchRaycaster.intersectObjects(interactable, false);
    if (intersects.length > 0) {
        const hit = intersects[0];
        if (mateState === 2 && hit.object === mateObjectA) {
            if (typeof showToast === 'function') showToast("Для второго сопряжения выберите ДРУГОЙ объект!");
            return;
        }
        openMateUnfoldedHelper(hit.object, hit.point, hit.face ? hit.face.normal : null, hit.faceIndex !== undefined ? hit.faceIndex : 0);
    }
}
window.handleMateContextMenu = handleMateContextMenu;

function startMateCommand() {
    if (window.isCommandActive && window.isCommandActive('tool-mate')) { cancelAllCommands(); return; }
    cancelAllCommands();
    closeMateHelperBox();
    isSketchMode = false;
    mateState = 1;
    setCreatorActiveTool('tool-mate');
    setCreatorUIMode('mate-select');
    if (typeof showToast === 'function') showToast("Выберите первую грань (ЛКМ по грани или ПКМ для развертки)");
}

function createFaceHighlight(point, normal, color) {
    const geo = new THREE.CircleGeometry(3, 32);
    const mat = new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide, transparent: true, opacity: 0.8, depthTest: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(point);
    
    const defaultNormal = new THREE.Vector3(0, 0, 1);
    mesh.quaternion.setFromUnitVectors(defaultNormal, normal);
    
    mesh.userData.isMateHighlight = true;
    return mesh;
}

function clearMateHighlightGroup() {
    if (!mateHighlightGroup) return;
    while (mateHighlightGroup.children.length > 0) {
        const child = mateHighlightGroup.children[0];
        mateHighlightGroup.remove(child);
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach(m => m && m.dispose());
            else child.material.dispose();
        }
    }
}

function removeMateConstraint(mateObj, wrapper) {
    if (!mateObj) return;

    // Удаляем сопряжение из активного списка ограничений
    allMates = allMates.filter(m => m !== mateObj);

    // Удаляем HTML-элемент аннотации
    if (wrapper && wrapper.parentElement) {
        wrapper.remove();
    } else if (mateObj.htmlElement && mateObj.htmlElement.parentElement) {
        mateObj.htmlElement.remove();
    }
    mateObj.htmlElement = null;

    // Перепривязываем объект: если есть другие сопряжения — к их родителю, иначе к сцене
    if (mateObj.objB) {
        const remainingMate = allMates.find(m => m.objB === mateObj.objB);
        if (remainingMate && remainingMate.objA) {
            remainingMate.objA.attach(mateObj.objB);
        } else if (typeof creatorScene !== 'undefined' && creatorScene) {
            creatorScene.attach(mateObj.objB);
        }
    }

    // Очищаем подсветку граней и освобождаем VRAM
    clearMateHighlightGroup();

    if (typeof showToast === 'function') {
        showToast("Слипание удалено (ограничение снято)");
    }
}
window.removeMateConstraint = removeMateConstraint;

function createMateMarker(mateObj) {
    const wrapper = document.createElement('div');
    wrapper.className = 'zone-marker-wrapper';
    wrapper.style.pointerEvents = 'auto'; // allow interaction

    const label = document.createElement('div');
    label.className = 'zone-label';
    label.innerText = 'Слипание';
    label.style.background = '#E6A817';
    label.style.color = '#fff';
    label.style.borderColor = '#B38211';
    label.style.cursor = 'pointer';
    label.style.userSelect = 'none';
    label.style.padding = '4px 10px';
    label.style.borderRadius = '12px';
    label.style.fontSize = '12px';
    label.style.fontWeight = '600';
    label.style.boxShadow = '0 2px 8px rgba(230, 168, 23, 0.4)';
    label.style.transition = 'all 0.15s ease';
    label.title = 'Нажмите, чтобы снять ограничение слипания';
    
    label.onmouseenter = () => {
        clearMateHighlightGroup();
        if (mateObj.objA && mateObj.objB) {
            const pA = mateObj.objA.localToWorld(mateObj.faceA_localPoint.clone());
            const nA = mateObj.faceA_localNormal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(mateObj.objA.matrixWorld)).normalize();
            const pB = mateObj.objB.localToWorld(mateObj.faceB_localPoint.clone());
            const nB = mateObj.faceB_localNormal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(mateObj.objB.matrixWorld)).normalize();
            
            mateHighlightGroup.add(createFaceHighlight(pA, nA, 0x5AAFDD), createFaceHighlight(pB, nB, 0xE6A817));
        }
        label.style.background = '#E03030';
        label.style.borderColor = '#B02020';
        label.style.boxShadow = '0 2px 8px rgba(224, 48, 48, 0.4)';
        label.style.transform = 'translate(-50%, -100%) scale(1.1)';
    };
    label.onmouseleave = () => {
        clearMateHighlightGroup();
        label.style.background = '#E6A817';
        label.style.borderColor = '#B38211';
        label.style.boxShadow = '0 2px 8px rgba(230, 168, 23, 0.4)';
        label.style.transform = 'translate(-50%, -100%) scale(1)';
    };
    label.onclick = (e) => {
        if (e) {
            e.stopPropagation();
            e.preventDefault();
        }
        removeMateConstraint(mateObj, wrapper);
    };
    
    wrapper.appendChild(label);
    const container = document.getElementById('creator-labels-container');
    if (container) container.appendChild(wrapper);
    return wrapper;
}

function animateMate(objA, faceA, objB, faceB, hlA, hlB) {
    const parent = objB.parent;
    creatorScene.attach(objB);

    const startWorldPos = objB.position.clone();
    const startWorldQuat = objB.quaternion.clone();

    // Собираем все текущие ограничения объекта
    const prevMates = allMates.filter(m => m.objB === objB);
    
    // Умное авто-определение типа слипания (Mate или Flush)
    let isFlush = false;
    if (prevMates.length > 0) {
        // Если уже есть ограничения (деталь не свободна), проверяем конфликт
        // Если поверхности уже смотрят примерно в одну сторону, мы избегаем 
        // переворота на 180 градусов и делаем выравнивание в одной плоскости (Flush)
        if (faceB.normal.dot(faceA.normal) > 0) {
            isFlush = true;
        }
    }
    // Если деталь полностью свободна (prevMates.length === 0), всегда делаем стыковое слипание (Mate)

    const newMate = {
        id: Date.now(),
        objA: objA,
        objB: objB,
        faceA_localPoint: faceA.localPoint.clone(),
        faceA_localNormal: faceA.localNormal.clone(),
        faceB_localPoint: faceB.localPoint.clone(),
        faceB_localNormal: faceB.localNormal.clone(),
        isFlush: isFlush
    };

    const allCurrentMates = [...prevMates, newMate];

    let matesToSolve = [];
    for (let m of allCurrentMates) {
        const objA_matrix = m.objA.matrixWorld;
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(objA_matrix);
        matesToSolve.push({
            N_A: m.faceA_localNormal.clone().applyMatrix3(normalMatrix).normalize(),
            P_A: m.objA.localToWorld(m.faceA_localPoint.clone()),
            localN_B: m.faceB_localNormal.clone(),
            localP_B: m.faceB_localPoint.clone(),
            isFlush: m.isFlush
        });
    }

    // Последовательный математический решатель (Solver) ограничений
    let curPos = startWorldPos.clone();
    let curQuat = startWorldQuat.clone();
    let lockedNormals = [];

    for (let mate of matesToSolve) {
        const N_A = mate.N_A.clone();
        const P_A = mate.P_A.clone();
        const N_B = mate.localN_B.clone().applyQuaternion(curQuat).normalize();
        const targetN = mate.isFlush ? N_A.clone() : N_A.clone().negate();

        // Фикс вращения
        if (lockedNormals.length === 0) {
            const q = new THREE.Quaternion().setFromUnitVectors(N_B, targetN);
            curQuat.premultiply(q);
        } else if (lockedNormals.length === 1) {
            const n1 = lockedNormals[0];
            const nbProj = N_B.clone().projectOnPlane(n1).normalize();
            const ntProj = targetN.clone().projectOnPlane(n1).normalize();
            if (nbProj.lengthSq() > 0.01 && ntProj.lengthSq() > 0.01) {
                let angle = nbProj.angleTo(ntProj);
                const cross = nbProj.clone().cross(ntProj);
                if (cross.dot(n1) < 0) angle = -angle;
                const q = new THREE.Quaternion().setFromAxisAngle(n1, angle);
                curQuat.premultiply(q);
            }
        }
        lockedNormals.push(targetN.clone());

        // Фикс перемещения (сохраняя прошлые привязки)
        const P_B_rot = mate.localP_B.clone().applyQuaternion(curQuat).add(curPos);
        const dist = P_A.clone().sub(P_B_rot).dot(N_A);

        let translation = new THREE.Vector3();
        if (lockedNormals.length === 1) {
            translation = N_A.clone().multiplyScalar(dist);
        } else if (lockedNormals.length === 2) {
            const n1 = lockedNormals[0];
            let V = N_A.clone().sub(n1.clone().multiplyScalar(N_A.dot(n1)));
            if (V.lengthSq() > 1e-6) {
                translation = V.multiplyScalar(dist / V.lengthSq());
            }
        } else if (lockedNormals.length >= 3) {
            const n1 = lockedNormals[0];
            const n2 = lockedNormals[1];
            let V = n1.clone().cross(n2);
            if (V.lengthSq() > 1e-6 && Math.abs(V.dot(N_A)) > 1e-6) {
                translation = V.multiplyScalar(dist / V.dot(N_A));
            }
        }
        curPos.add(translation);
    }

    const finalWorldPos = curPos;
    const finalWorldQuat = curQuat;

    let startTime = null;
    const duration = 800;

    function step(timestamp) {
        if (!startTime) startTime = timestamp;
        const progress = Math.min((timestamp - startTime) / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3);

        objB.position.lerpVectors(startWorldPos, finalWorldPos, ease);
        objB.quaternion.slerpQuaternions(startWorldQuat, finalWorldQuat, ease);
        objB.updateMatrixWorld();
        
        if (progress < 1) {
            requestAnimationFrame(step);
        } else {
            if (hlA) creatorScene.remove(hlA);
            if (hlB) creatorScene.remove(hlB);
            
            const targetParent = prevMates.length > 0 ? parent : objA;
            if (targetParent && targetParent !== creatorScene && !isDescendant(targetParent, objB)) {
                targetParent.attach(objB);
            }

            newMate.htmlElement = createMateMarker(newMate);
            allMates.push(newMate);

            if (typeof showToast === 'function') showToast("Детали соединены!");
        }
    }
    requestAnimationFrame(step);
}

function startGizmoCommand() {
    if (window.isCommandActive && window.isCommandActive('tool-gizmo')) { cancelAllCommands(); return; }
    cancelAllCommands();
    setCreatorActiveTool('tool-gizmo');
    isSketchMode = false;
    mateState = 0;
    gizmoState = 1;
    if (customGizmo) customGizmo.visible = false;
    const canvas = document.getElementById('canvas-creator');
    if(canvas) canvas.style.cursor = 'default';
    if (typeof showToast === 'function') showToast("ЛКМ выберите 3D объект");
}

// --- ЛОГИКА ЭСКИЗИРОВАНИЯ ---

function startSketchCommand() {
    if (window.isCommandActive && window.isCommandActive('tool-msk')) { cancelAllCommands(); return; }
    cancelAllCommands();
    isSketchMode = true;
    sketchState = 0;
    setCreatorActiveTool('tool-msk');
    setCreatorUIMode('sketch-select');
    
    // Если плоскости МСК остались от прошлой отмены - удалим
    if (originPlanesGroup) {
        creatorScene.remove(originPlanesGroup);
        originPlanesGroup = null;
    }
    
    // Создаем три базовые плоскости
    originPlanesGroup = new THREE.Group();
    const pGeo = new THREE.PlaneGeometry(2000, 2000);
    const edges = new THREE.EdgesGeometry(pGeo, showRadialEdges ? 1 : 15);
    const lMat = new THREE.LineBasicMaterial({ color: 0x3355CC, linewidth: 2 });

    const createLocalPlane = (color, n, u, r, name) => {
        const mesh = new THREE.Mesh(pGeo, new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }));
        mesh.add(new THREE.LineSegments(edges, lMat));
        mesh.position.set(0, 0, 0);
        const matrix = new THREE.Matrix4();
        matrix.makeBasis(r, u, n);
        mesh.setRotationFromMatrix(matrix);
        mesh.userData = { 
            isSketchPlane: true,
             normal: n.clone(),
             look: new THREE.Vector3().add(n.clone().multiplyScalar(500)),
             up: u.clone(),
             origin: mesh.position.clone(),
             name: name 
        };
        return mesh;
    };
    
    const pXY = createLocalPlane(0xE03030, new THREE.Vector3(0,0,1), new THREE.Vector3(0,1,0), new THREE.Vector3(1,0,0), "XY");
    const pXZ = createLocalPlane(0x5AAFDD, new THREE.Vector3(0,1,0), new THREE.Vector3(0,0,-1), new THREE.Vector3(1,0,0), "XZ");
    const pYZ = createLocalPlane(0x3355CC, new THREE.Vector3(1,0,0), new THREE.Vector3(0,1,0), new THREE.Vector3(0,0,-1), "YZ");

    originPlanesGroup.add(pXY, pXZ, pYZ);
    creatorScene.add(originPlanesGroup);
    
    if (typeof showToast === 'function') showToast("ЛКМ выберите плоскость для эскиза");
}

function startSketchOnFaceCommand() {
    if (window.isCommandActive && window.isCommandActive('tool-face')) { cancelAllCommands(); return; }
    cancelAllCommands();
    isSketchMode = true;
    sketchState = 2; // Режим выбора грани существующей 3D модели
    setCreatorActiveTool('tool-face');
    setCreatorUIMode('sketch-select');
    if (typeof showToast === 'function') showToast("ЛКМ выберите плоскую грань на 3D модели");
}

function setSketchTool(tool) {
    if (currentDrawPoints.length > 0) currentDrawPoints = [];
    resetRectDimState();
    resetLineCadDimState();
    if (sketchTool === 'chamfer' && tool !== 'chamfer') {
        if (typeof window.cancelChamferUI === 'function') window.cancelChamferUI();
    }
    if (sketchTool === 'fillet' && tool !== 'fillet') {
        if (typeof window.cancelFilletUI === 'function') window.cancelFilletUI();
    }
    if (sketchTool === 'mirror' && tool !== 'mirror') {
        if (typeof window.resetMirrorState === 'function') window.resetMirrorState();
    }
    if (tool === 'mirror') {
        if (typeof window.resetMirrorState === 'function') window.resetMirrorState();
    }
    sketchTool = tool;

    if (!tool || tool === 'trim' || tool === 'extend' || tool === 'chamfer' || tool === 'fillet' || tool === 'mirror') {
        activeSmartSnap = null;
        activeTrackingRay = null;
        activeTrackingRays = [];
        trackingCandidate = null;
        if (typeof snapMarker !== 'undefined' && snapMarker) snapMarker.visible = false;
        if (typeof trackingGuideMesh !== 'undefined' && trackingGuideMesh) trackingGuideMesh.visible = false;
        if (typeof updateSmartSnapHUD === 'function') updateSmartSnapHUD();
    }

    if (tool !== null) {
        if (typeof window.clearSketchSelection === 'function') window.clearSketchSelection();
    } else {
        if (typeof window.updateSketchSelectionVisuals === 'function') window.updateSketchSelectionVisuals();
    }

    if (tempShapePreview) {
        // Не удаляем, а просто скрываем фантом
        tempShapePreview.visible = false;
        tempShapePreview.geometry.setDrawRange(0, 0);
    }

    closeSketchRadialMenu();

    if (sketchHudTooltip) {
        let toolName = '';
        if (tool === 'line') toolName = 'Отрезок';
        else if (tool === 'infiniline') toolName = 'Линия';
        else if (tool === 'circle') toolName = 'Окружность';
        else if (tool === 'arc') toolName = 'Дуга';
        else if (tool === 'rectangle') toolName = 'Прямоугольник';
        else if (tool === 'trim') toolName = 'Обрезать';
        else if (tool === 'extend') toolName = 'Продлить';
        else if (tool === 'chamfer') toolName = 'Фаска';
        else if (tool === 'fillet') toolName = 'Сопряжение';
        else if (tool === 'mirror') toolName = 'Зеркало';

        if (toolName) {
            sketchHudTooltip.innerText = tool === 'arc' ? '[ Дуга: Укажите начало ]' : (tool === 'chamfer' ? '[ Фаска: Укажите угол ]' : (tool === 'fillet' ? '[ Сопряжение: Укажите угол ]' : (tool === 'mirror' ? '[ Зеркало: Выберите объекты ]' : `[ ${toolName} ]`)));
            sketchHudTooltip.style.display = 'block';
        } else {
            sketchHudTooltip.style.display = 'none';
        }
    }
    
    // Обновляем состояние кнопок в радиальном меню эскиза
    const sketchMenu = document.getElementById('sketch-radial-menu');
    if (sketchMenu) {
        ['line', 'infiniline', 'rectangle', 'circle', 'arc', 'trim', 'extend', 'chamfer', 'fillet', 'mirror'].forEach(t => {
            const group = sketchMenu.querySelector(`#sketch-radial-tool-${t}`);
            if (group) {
                group.classList.remove('toggle-active');
            }
        });
        const activeGroup = sketchMenu.querySelector(`#sketch-radial-tool-${tool}`);
        if (activeGroup) {
            activeGroup.classList.add('toggle-active');
        }
    }

    ['line', 'infiniline', 'circle', 'arc', 'rectangle', 'trim', 'extend', 'chamfer', 'fillet', 'mirror'].forEach(t => {
        const btn = document.getElementById('btn-tool-' + t);
        if (btn) {
                btn.style.background = t === tool ? 'var(--accent-light)' : '#FFFFFF';
                btn.style.color = t === tool ? 'var(--accent-primary)' : 'var(--text-dark)';
                const img = btn.querySelector('img');
                if (img) {
                    img.style.filter = t === tool ? 'drop-shadow(0 4px 8px rgba(99, 102, 241, 0.4))' : 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))';
                }
        }
    });
}

window.toggleSketchSnapPoints = function(btn) {
    isSnapPointsEnabled = !isSnapPointsEnabled;
    if (btn) btn.classList.toggle('toggle-active', isSnapPointsEnabled);
    isSnapEnabled = isSnapPointsEnabled || isSnapTopologyEnabled || isSnapExtensionEnabled;
    if (typeof showToast === 'function') {
        showToast(isSnapPointsEnabled ? "Привязка 'Точки' включена" : "Привязка 'Точки' отключена");
    }
};

window.toggleSketchSnapTopology = function(btn) {
    isSnapTopologyEnabled = !isSnapTopologyEnabled;
    if (btn) btn.classList.toggle('toggle-active', isSnapTopologyEnabled);
    isSnapEnabled = isSnapPointsEnabled || isSnapTopologyEnabled || isSnapExtensionEnabled;
    if (typeof showToast === 'function') {
        showToast(isSnapTopologyEnabled ? "Привязка 'Топология' включена" : "Привязка 'Топология' отключена");
    }
};

window.toggleSketchSnapExtension = function(btn) {
    isSnapExtensionEnabled = !isSnapExtensionEnabled;
    if (btn) btn.classList.toggle('toggle-active', isSnapExtensionEnabled);
    isSnapEnabled = isSnapPointsEnabled || isSnapTopologyEnabled || isSnapExtensionEnabled;
    if (typeof showToast === 'function') {
        showToast(isSnapExtensionEnabled ? "Привязка 'Продолжение' включена" : "Привязка 'Продолжение' отключена");
    }
};

window.toggleSketchOrtho = function(btn) {
    isOrtho = !isOrtho;
    btn.classList.toggle('toggle-active', isOrtho);
    const cb = document.getElementById('sketch-ortho');
    if(cb) cb.checked = isOrtho;
}

window.toggleSketchSnap = function(btn) {
    isSnapEnabled = !isSnapEnabled;
    btn.classList.toggle('toggle-active', isSnapEnabled);
}

window.toggleSketchGrid = function(btn) {
    isGridVisible = !isGridVisible;
    btn.classList.toggle('toggle-active', isGridVisible);
    if (activeSketchPlane && activeSketchPlane.userData.gridHelper) {
        activeSketchPlane.userData.gridHelper.visible = isGridVisible;
    }
}

window.openSketchRadialMenu = function(x, y) {
    if (!sketchRadialMenu) {
        sketchRadialMenu = document.getElementById('sketch-radial-menu');
    }
    const container = document.getElementById('sketch-radial-menu-container');
    if (container) {
        container.style.display = 'block';
    }
    if (!sketchRadialMenu) return;
    closeQuickPanels(); // Закрываем другие панели
    
    // Синхронизация состояний кнопок привязок
    const snapPointsBtn = sketchRadialMenu.querySelector('#sketch-radial-toggle-snap-points');
    if (snapPointsBtn) snapPointsBtn.classList.toggle('toggle-active', isSnapPointsEnabled);

    const snapTopologyBtn = sketchRadialMenu.querySelector('#sketch-radial-toggle-snap-topology');
    if (snapTopologyBtn) snapTopologyBtn.classList.toggle('toggle-active', isSnapTopologyEnabled);

    const snapExtensionBtn = sketchRadialMenu.querySelector('#sketch-radial-toggle-snap-extension');
    if (snapExtensionBtn) snapExtensionBtn.classList.toggle('toggle-active', isSnapExtensionEnabled);

    const gridBtn = sketchRadialMenu.querySelector('#sketch-radial-toggle-grid');
    if (gridBtn) gridBtn.classList.toggle('toggle-active', isGridVisible);
    
    sketchRadialMenu.style.left = `${x}px`;
    sketchRadialMenu.style.top = `${y}px`;
    sketchRadialMenu.classList.add('active');

    // Handler для закрытия меню по клику вне его
    function closeMenuOnClickOutside(event) {
        if (sketchRadialMenu && !sketchRadialMenu.contains(event.target)) {
            closeSketchRadialMenu();
        }
    }

    // Устанавливаем обработчик с небольшой задержкой, чтобы он не сработал от того же клика, что открыл меню
    setTimeout(() => {
        document.addEventListener('mousedown', closeMenuOnClickOutside, { once: true });
    }, 50);
}

window.closeSketchRadialMenu = function() {
    if (window.hideRadialTooltip) window.hideRadialTooltip();
    const container = document.getElementById('sketch-radial-menu-container');
    if (container) {
        container.style.display = 'none';
    }
    const srm = sketchRadialMenu || document.getElementById('sketch-radial-menu');
    if (srm) {
        srm.classList.remove('active');
    }
}

function toggleOrtho(val) {
    isOrtho = val;
}

function setupSketchInteraction(canvas) {
	// --- Логика для вызова радиального меню по двойному клику ПКМ ---
	let lastRightClickTime = 0;
	const DBL_CLICK_THRESHOLD = 400; // 400ms

	// Блокируем стандартное контекстное меню браузера на 3D/2D холсте и обрабатываем ПКМ
	canvas.addEventListener('contextmenu', e => {
		e.preventDefault();
		if (mateState === 1 || mateState === 2) {
			if (typeof handleMateContextMenu === 'function') {
				handleMateContextMenu(e);
			}
			return;
		}
		if (isSketchMode) {
            const modPanel = document.getElementById('rect-modifier-panel');
            if (modPanel && modPanel.style.display === 'block') {
                return;
            }

            // Если мы в процессе рисования (есть начальная точка), одиночный ПКМ отменяет операцию
            if (sketchState === 1 && currentDrawPoints.length > 0) {
                if (sketchTool === 'arc' && currentDrawPoints.length === 2) {
                    currentDrawPoints.pop();
                    if (sketchHudTooltip) sketchHudTooltip.innerText = '[ Дуга: Укажите точку на дуге ]';
                } else {
                    currentDrawPoints = [];
                    if (tempShapePreview) {
                        tempShapePreview.visible = false;
                        tempShapePreview.geometry.setDrawRange(0, 0);
                    }
                    if (snapMarker) snapMarker.visible = false;
                    resetRectDimState();
                    setSketchTool(sketchTool); // Сброс состояния текущего инструмента
                }
                return;
            }

            // Если не рисуем, то двойной клик ПКМ открывает радиальное меню 2D команд
			if (sketchState === 1) { 
				const now = Date.now();
				if (now - lastRightClickTime < DBL_CLICK_THRESHOLD) {
					if (window.openSketchRadialMenu) {
						window.openSketchRadialMenu(e.clientX, e.clientY);
					}
					lastRightClickTime = 0; // Сброс таймера
				} else {
					lastRightClickTime = now;
				}
			}
		}
	});

    canvas.addEventListener('mousemove', (e) => {
        const canvas_element = document.getElementById("canvas-creator");
                        const rect = canvas_element.getBoundingClientRect();
        sketchMouse.x = ((e.clientX - rect.left) / canvas.clientWidth) * 2 - 1;
        sketchMouse.y = -((e.clientY - rect.top) / canvas.clientHeight) * 2 + 1;

        // Обновляем луч один раз в начале для всех последующих проверок в этом обработчике
        sketchRaycaster.setFromCamera(sketchMouse, currentCreatorCamera);

        if (typeof updatePipeHoleHover === 'function') updatePipeHoleHover();

        if (window.unfoldLifecycleManager && window.unfoldLifecycleManager.isActive && window.unfoldLifecycleManager.controller) {
            const meshes = window.unfoldLifecycleManager.controller.subMeshes || [];
            const subHits = sketchRaycaster.intersectObjects(meshes, false);
            if (subHits.length > 0) {
                window.unfoldLifecycleManager.controller.setHoveredMesh(subHits[0].object);
                canvas.style.cursor = 'pointer';
            } else {
                window.unfoldLifecycleManager.controller.setHoveredMesh(null);
                canvas.style.cursor = 'default';
            }
        }

        if (mateUnfoldedHelper && typeof updateMateHelperHover === 'function') {
            updateMateHelperHover(sketchRaycaster);
        }

        if (window.flattenMode) {
            if (typeof window.updateUnfoldFaceHover === 'function') {
                window.updateUnfoldFaceHover(sketchRaycaster, sketchMouse);
            }
            return;
        }

        lastMouseClientX = e.clientX;
        lastMouseClientY = e.clientY;

        if (sketchHudTooltip && sketchHudTooltip.style.display === 'block' && !(sketchTool === 'rectangle' && currentDrawPoints.length === 1)) {
            sketchHudTooltip.style.left = `${e.clientX}px`;
            sketchHudTooltip.style.top = `${e.clientY}px`;
        }

        if (isGizmoDragging && selectedObjects.length > 0 && !isSketchMode) { // Этот блок не трогаем
            const planeIntersect = new THREE.Vector3();
            const intersectResult = sketchRaycaster.ray.intersectPlane(gizmoDragPlane, planeIntersect);
            if (intersectResult) {
                let deltaWorld = planeIntersect.clone().sub(gizmoDragStartPoint);
                
                if (gizmoDragAxis === 'X') deltaWorld.projectOnVector(new THREE.Vector3(1, 0, 0));
                else if (gizmoDragAxis === 'Y') deltaWorld.projectOnVector(new THREE.Vector3(0, 1, 0));
                else if (gizmoDragAxis === 'Z') deltaWorld.projectOnVector(new THREE.Vector3(0, 0, 1));
                else if (gizmoDragAxis === 'XY') deltaWorld.projectOnPlane(new THREE.Vector3(0, 0, 1));
                else if (gizmoDragAxis === 'XZ') deltaWorld.projectOnPlane(new THREE.Vector3(0, 1, 0));
                else if (gizmoDragAxis === 'YZ') deltaWorld.projectOnPlane(new THREE.Vector3(1, 0, 0));
                let isScale = gizmoDragAxis.startsWith('Scale');
                let isRotate = gizmoDragAxis.startsWith('Rotate');
                let realAxisName = gizmoDragAxis.replace('Scale', '').replace('Rotate', '');
                
                let axis = new THREE.Vector3();
                if (realAxisName === 'X') axis.set(1, 0, 0);
                else if (realAxisName === 'Y') axis.set(0, 1, 0);
                else if (realAxisName === 'Z') axis.set(0, 0, 1);

                if (isRotate) {
                    let vStart = gizmoDragStartPoint.clone().sub(gizmoStartPos);
                    let vCurrent = planeIntersect.clone().sub(gizmoStartPos);
                    let distToCenter = vCurrent.length();
                    let angle = vStart.angleTo(vCurrent);
                    let sign = Math.sign(vStart.clone().cross(vCurrent).dot(axis));
                    let theta = angle * sign;
                    
                    // Учитываем текущий масштаб Гизмо (зависит от расстояния камеры) для правильной работы магнита
                    let currentScale = customGizmo.scale.x;
                    let scaledRadius = 13.25 * currentScale;
                    
                    if (Math.abs(distToCenter - scaledRadius) < 4.0 * currentScale) {
                        const step = 15 * Math.PI / 180;
                        theta = Math.round(theta / step) * step;
                    }
                    
                    const qRot = new THREE.Quaternion().setFromAxisAngle(axis, theta);
                    selectedObjectsStartData.forEach(data => {
                        const localPos = data.startWorldPos.clone().sub(gizmoStartPos);
                        localPos.applyQuaternion(qRot);
                        const newWorldPos = gizmoStartPos.clone().add(localPos);
                        if (data.obj.parent) data.obj.parent.worldToLocal(newWorldPos);
                        data.obj.position.copy(newWorldPos);
                        const newQuat = qRot.clone().multiply(data.startQuat);
                        data.obj.quaternion.copy(newQuat);
                        data.obj.updateMatrixWorld();
                    });
                    return;
                }
                
                if (isScale) {
                    let deltaAxis = deltaWorld.dot(axis);
                    let scaleFactor = Math.max(0.01, 1 + deltaAxis / 10);
                    
                    selectedObjectsStartData.forEach(data => {
                        if (realAxisName === 'X') data.obj.scale.x = data.startScale.x * scaleFactor;
                        if (realAxisName === 'Y') data.obj.scale.y = data.startScale.y * scaleFactor;
                        if (realAxisName === 'Z') data.obj.scale.z = data.startScale.z * scaleFactor;
                        
                        let localPosOffset = data.startWorldPos.clone().sub(gizmoStartPos);
                        if (realAxisName === 'X') localPosOffset.x *= scaleFactor;
                        if (realAxisName === 'Y') localPosOffset.y *= scaleFactor;
                        if (realAxisName === 'Z') localPosOffset.z *= scaleFactor;
                        
                        const newWorldPos = gizmoStartPos.clone().add(localPosOffset);
                        if (data.obj.parent) data.obj.parent.worldToLocal(newWorldPos);
                        data.obj.position.copy(newWorldPos);
                        data.obj.updateMatrixWorld();
                        updateObjectSpecText(data.obj);
                    });
                    return;
                }

                if (realAxisName === 'X') deltaWorld.projectOnVector(new THREE.Vector3(1, 0, 0));
                else if (realAxisName === 'Y') deltaWorld.projectOnVector(new THREE.Vector3(0, 1, 0));
                else if (realAxisName === 'Z') deltaWorld.projectOnVector(new THREE.Vector3(0, 0, 1));
                else if (realAxisName === 'XY') deltaWorld.projectOnPlane(new THREE.Vector3(0, 0, 1));
                else if (realAxisName === 'XZ') deltaWorld.projectOnPlane(new THREE.Vector3(0, 1, 0));
                else if (realAxisName === 'YZ') deltaWorld.projectOnPlane(new THREE.Vector3(1, 0, 0));

                let constrainedNormals = [];
                for (const data of selectedObjectsStartData) {
                    const objMates = allMates.filter(m => m.objB === data.obj);
                    for (let m of objMates) {
                        const objA_world = m.objA.matrixWorld;
                        const n = m.faceA_localNormal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(objA_world)).normalize();
                        constrainedNormals.push(n);
                    }
                }
                
                if (constrainedNormals.length === 1) {
                    deltaWorld.projectOnPlane(constrainedNormals[0]);
                } else if (constrainedNormals.length === 2) {
                    const lineDir = constrainedNormals[0].clone().cross(constrainedNormals[1]).normalize();
                    deltaWorld.copy(lineDir.clone().multiplyScalar(deltaWorld.dot(lineDir)));
                } else if (constrainedNormals.length >= 3) {
                    deltaWorld.set(0, 0, 0);
                }

                if (deltaWorld.lengthSq() > 0) {
                    customGizmo.position.copy(gizmoStartPos).add(deltaWorld);
                    selectedObjectsStartData.forEach(data => {
                        const newWorldPos = data.startWorldPos.clone().add(deltaWorld);
                        if (data.obj.parent) {
                            data.obj.parent.worldToLocal(newWorldPos);
                        }
                        data.obj.position.copy(newWorldPos);
                        data.obj.updateMatrixWorld();
                    });
                }
            }
            return;
        }

        if (linkState === 1) {
            const interactable = [];
            function isGizmoPart(o){let c=o;let safety=0;while(c){if(safety++ > 1000){console.warn("isGizmoPart infinite loop guard triggered.");return false;}if(c===customGizmo)return true;c=c.parent;}return false;}
            creatorScene.traverse(c => { 
                if (c.isMesh && c !== snapMarker && !c.userData.isSketchPlane && !c.userData.isSketch && !c.userData.isMateHighlight && !isGizmoPart(c)) {
                    interactable.push(c); 
                }
            });
            const intersects = sketchRaycaster.intersectObjects(interactable, false);
            
            if (intersects.length > 0) {
                let hit = intersects[0].object;
                if (window.linkSpecRowToMesh) {
                    window.linkSpecRowToMesh(linkTargetRow, hit);
                }
                
                linkState = 0;
                linkTargetRow = null;
                linkTargetBtn = null;
                setCreatorUIMode('default');
            }
            return;
        }
        if (!isGizmoDragging && customGizmo && customGizmo.visible && gizmoState === 2 && !isSketchMode) {
            const intersects = sketchRaycaster.intersectObject(customGizmo, true);
            if (intersects.length > 0) {
                const hit = intersects[0].object;
                if (hoveredGizmoPart !== hit) {
                    if (hoveredGizmoPart && hoveredGizmoPart.userData.originalColor !== undefined) {
                        hoveredGizmoPart.material.color.setHex(hoveredGizmoPart.userData.originalColor);
                    }
                    hoveredGizmoPart = hit;
                    if (hoveredGizmoPart.userData.originalColor !== undefined) {
                        const c = new THREE.Color(hoveredGizmoPart.userData.originalColor);
                        c.lerp(new THREE.Color(0xffffff), 0.4);
                        hoveredGizmoPart.material.color.copy(c);
                    }
                    canvas.style.cursor = 'pointer';
                }
            } else {
                if (hoveredGizmoPart) {
                    if (hoveredGizmoPart.userData.originalColor !== undefined) {
                        hoveredGizmoPart.material.color.setHex(hoveredGizmoPart.userData.originalColor);
                    }
                    hoveredGizmoPart = null;
                    canvas.style.cursor = 'default';
                }
            }
        }

        if (bendState === 1 || bendState === 2) {
            const interactable = [];
            creatorScene.traverse(c => {
                if (c.isMesh && c.visible && !c.userData.isGizmo && !c.userData.isPhantom) {
                    const isProf = (typeof window.isProfileObject === 'function') ? window.isProfileObject(c) : false;
                    if ((c.userData.specData || c.userData.hasBends) && !isProf) {
                        interactable.push(c);
                    }
                }
            });
            const intersects = sketchRaycaster.intersectObjects(interactable, false);
            if (intersects.length > 0) {
                const intersect = intersects[0];
                const object = intersect.object;
                const face = intersect.face;
                
                const normal = face.normal.clone().normalize();
                const pos = object.geometry.attributes.position;
                const index = object.geometry.index;
                
                const getVertexKey = (v) => `${v.x.toFixed(1)},${v.y.toFixed(1)},${v.z.toFixed(1)}`;
                
                const triCount = index ? index.count / 3 : pos.count / 3;
                const vertexToTris = {};
                const triNormals = [];
                
                for (let i = 0; i < triCount; i++) {
                    let a, b, c;
                    if (index) {
                        a = index.getX(i * 3);
                        b = index.getX(i * 3 + 1);
                        c = index.getX(i * 3 + 2);
                    } else {
                        a = i * 3;
                        b = i * 3 + 1;
                        c = i * 3 + 2;
                    }
                    
                    const vA = new THREE.Vector3().fromBufferAttribute(pos, a);
                    const vB = new THREE.Vector3().fromBufferAttribute(pos, b);
                    const vC = new THREE.Vector3().fromBufferAttribute(pos, c);
                    
                    const cb = new THREE.Vector3().subVectors(vC, vB);
                    const ab = new THREE.Vector3().subVectors(vA, vB);
                    const triNormal = cb.cross(ab).normalize();
                    triNormals.push(triNormal);
                    
                    const keys = [getVertexKey(vA), getVertexKey(vB), getVertexKey(vC)];
                    for (const key of keys) {
                        if (!vertexToTris[key]) vertexToTris[key] = [];
                        vertexToTris[key].push(i);
                    }
                }
                
                const startTri = intersect.faceIndex !== undefined ? intersect.faceIndex : 0;

                const getTriVertices = (triIdx) => {
                    let a, b, c;
                    if (index) {
                        a = index.getX(triIdx * 3);
                        b = index.getX(triIdx * 3 + 1);
                        c = index.getX(triIdx * 3 + 2);
                    } else {
                        a = triIdx * 3;
                        b = triIdx * 3 + 1;
                        c = triIdx * 3 + 2;
                    }
                    return [
                        new THREE.Vector3().fromBufferAttribute(pos, a),
                        new THREE.Vector3().fromBufferAttribute(pos, b),
                        new THREE.Vector3().fromBufferAttribute(pos, c)
                    ];
                };

                // 1. Reject curved fillet/bend surfaces
                const startVerts = getTriVertices(startTri);
                const startKeys = startVerts.map(v => getVertexKey(v));
                const edgeNeighborSet = new Set();
                
                for (let i = 0; i < 3; i++) {
                    const k1 = startKeys[i];
                    const k2 = startKeys[(i + 1) % 3];
                    const tris1 = vertexToTris[k1] || [];
                    const tris2 = vertexToTris[k2] || [];
                    for (const t1 of tris1) {
                        if (t1 !== startTri && tris2.includes(t1)) {
                            edgeNeighborSet.add(t1);
                        }
                    }
                }

                let isCurvedSurface = false;
                for (const n of edgeNeighborSet) {
                    if (triNormals[n]) {
                        const dotN = triNormals[n].dot(normal);
                        if (dotN > 0.10 && dotN < 0.998) {
                            isCurvedSurface = true;
                            break;
                        }
                    }
                }

                if (isCurvedSurface) {
                    canvas.style.cursor = 'default';
                    if (bendHoverHighlight) {
                        creatorScene.remove(bendHoverHighlight);
                        if (bendHoverHighlight.geometry) bendHoverHighlight.geometry.dispose();
                        if (bendHoverHighlight.material) bendHoverHighlight.material.dispose();
                        bendHoverHighlight = null;
                    }
                    return;
                }

                // 2. Flood-fill coplanar triangles from startTri
                const faceTris = [startTri];
                const initVisited = new Set([startTri]);
                const initQueue = [startTri];
                
                while (initQueue.length > 0) {
                    const curr = initQueue.shift();
                    const verts = getTriVertices(curr);
                    const keys = verts.map(v => getVertexKey(v));
                    for (const key of keys) {
                        const neighbors = vertexToTris[key] || [];
                        for (const n of neighbors) {
                            if (!initVisited.has(n) && triNormals[n] && triNormals[n].dot(normal) > 0.995) {
                                initVisited.add(n);
                                initQueue.push(n);
                                faceTris.push(n);
                            }
                        }
                    }
                }

                const spec = object.userData.specData;
                let sheetT = 10;
                if (spec) {
                    if (typeof spec.t === 'number') sheetT = spec.t;
                    else if (typeof spec.th === 'number') sheetT = spec.th;
                    else if (typeof spec.wallThick === 'number') sheetT = spec.wallThick;
                    else if (typeof spec.thickness === 'number') sheetT = spec.thickness;
                    else if (typeof spec.depth === 'number') sheetT = spec.depth;
                } else if (object.geometry) {
                    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
                    if (object.geometry.boundingBox) {
                        const sz = new THREE.Vector3().subVectors(object.geometry.boundingBox.max, object.geometry.boundingBox.min);
                        sheetT = Math.min(sz.x, sz.y, sz.z);
                    }
                }
                const minScale = Math.min(Math.abs(object.scale.x), Math.abs(object.scale.y), Math.abs(object.scale.z));
                sheetT = Math.max(0.5, sheetT * (minScale || 1));

                // Определяем локальную ось толщины детали по ее параметрам и геометрии
                let localThicknessAxis = null;
                if (object.userData && object.userData.specData) {
                    if (object.userData.specData.broadNormal) {
                        localThicknessAxis = object.userData.specData.broadNormal.clone();
                    } else {
                        const stype = object.userData.specData.type;
                        if (stype === 'plate' || stype === 'knitsa') {
                            localThicknessAxis = new THREE.Vector3(0, 1, 0);
                        }
                    }
                }
                if (!localThicknessAxis && object.geometry) {
                    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
                    const bb = object.geometry.boundingBox;
                    if (bb) {
                        const szX = bb.max.x - bb.min.x;
                        const szY = bb.max.y - bb.min.y;
                        const szZ = bb.max.z - bb.min.z;
                        if (Math.abs(szX - sheetT) < 2.0) localThicknessAxis = new THREE.Vector3(1, 0, 0);
                        else if (Math.abs(szY - sheetT) < 2.0) localThicknessAxis = new THREE.Vector3(0, 1, 0);
                        else if (Math.abs(szZ - sheetT) < 2.0) localThicknessAxis = new THREE.Vector3(0, 0, 1);
                    }
                }

                // Compute face vertices and centroid
                let faceCentroid = new THREE.Vector3();
                let vertCount = 0;
                const uniqueFaceVerts = [];
                const faceVertSet = new Set();

                for (const triIdx of faceTris) {
                    const verts = getTriVertices(triIdx);
                    for (const v of verts) {
                        const k = getVertexKey(v);
                        if (!faceVertSet.has(k)) {
                            faceVertSet.add(k);
                            uniqueFaceVerts.push(v);
                            faceCentroid.add(v);
                            vertCount++;
                        }
                    }
                }
                if (vertCount > 0) faceCentroid.divideScalar(vertCount);

                // Build 2D basis for plane of faceTris
                let u_dir = new THREE.Vector3(1, 0, 0);
                if (Math.abs(normal.dot(u_dir)) > 0.9) {
                    u_dir = new THREE.Vector3(0, 1, 0);
                }
                u_dir.crossVectors(normal, u_dir).normalize();
                let v_dir = new THREE.Vector3().crossVectors(normal, u_dir).normalize();

                let minU = Infinity, maxU = -Infinity;
                let minV = Infinity, maxV = -Infinity;
                for (const v of uniqueFaceVerts) {
                    const rel = new THREE.Vector3().subVectors(v, faceCentroid);
                    const u = rel.dot(u_dir);
                    const v_val = rel.dot(v_dir);
                    if (u < minU) minU = u;
                    if (u > maxU) maxU = u;
                    if (v_val < minV) minV = v_val;
                    if (v_val > maxV) maxV = v_val;
                }
                const extentU = maxU - minU;
                const extentV = maxV - minV;

                let bestEdge = null;

                // Строгая математическая проверка: Торец ли эта грань (isEndFace)?
                const maxExtent = Math.max(extentU, extentV);
                const minExtent = Math.min(extentU, extentV);

                let isEndFace = false;
                if (localThicknessAxis) {
                    const dotThick = Math.abs(normal.dot(localThicknessAxis));
                    if (dotThick < 0.25) {
                        isEndFace = true; // Нормаль перпендикулярна толщине -> 100% торец
                    } else if (dotThick > 0.75) {
                        isEndFace = false; // Нормаль параллельна толщине -> 100% пласть
                    } else {
                        isEndFace = (minExtent <= 1.8 * sheetT);
                    }
                } else {
                    isEndFace = (minExtent <= 1.8 * sheetT) || (minExtent <= 0.25 * maxExtent && minExtent <= 3.0 * sheetT);
                }

                if (isEndFace) {
                    let edgeDir, thicknessDir, length;
                    if (Math.abs(extentU - sheetT) < Math.abs(extentV - sheetT) || extentU <= extentV) {
                        thicknessDir = u_dir.clone();
                        edgeDir = v_dir.clone();
                        length = extentV;
                    } else {
                        thicknessDir = v_dir.clone();
                        edgeDir = u_dir.clone();
                        length = extentU;
                    }

                    const v1 = faceCentroid.clone().addScaledVector(edgeDir, -length / 2);
                    const v2 = faceCentroid.clone().addScaledVector(edgeDir, length / 2);

                    const normalMatrix = new THREE.Matrix3().getNormalMatrix(object.matrixWorld);
                    const worldV1 = v1.clone().applyMatrix4(object.matrixWorld);
                    const worldV2 = v2.clone().applyMatrix4(object.matrixWorld);
                    const worldNormal = normal.clone().applyMatrix3(normalMatrix).normalize();
                    const worldThick = thicknessDir.clone().applyMatrix3(normalMatrix).normalize();
                    const worldEdgeDir = edgeDir.clone().applyMatrix3(normalMatrix).normalize();

                    const dist1 = intersect.point.distanceTo(worldV1);
                    const dist2 = intersect.point.distanceTo(worldV2);
                    const cornerDistThreshold = Math.max(12, Math.min(length * 0.28, 40));
                    const isCorner = (dist1 < cornerDistThreshold || dist2 < cornerDistThreshold);

                    // Определение плоскости ориентации в пространстве по нормали торца (XY, XZ, YZ)
                    const absNx = Math.abs(worldNormal.x);
                    const absNy = Math.abs(worldNormal.y);
                    const absNz = Math.abs(worldNormal.z);
                    let planeStr = 'XY';
                    if (absNz >= absNx && absNz >= absNy) {
                        planeStr = 'XY';
                    } else if (absNy >= absNx && absNy >= absNz) {
                        planeStr = 'XZ';
                    } else {
                        planeStr = 'YZ';
                    }

                    const elemType = isCorner ? ('corner_' + planeStr) : ('edgeEnd_' + planeStr);

                    const actualThickness = (extentU <= extentV) ? extentU : extentV;
                    bestEdge = {
                        v1: worldV1,
                        v2: worldV2,
                        faceNormal: worldNormal,
                        thicknessDir: worldThick,
                        edgeDir: worldEdgeDir,
                        localLength: length,
                        thickness: actualThickness,
                        elementType: elemType
                    };
                } else {
                    // CASE 2: Наведение на ПЛАСТЬ (большая поверхность пластины/фланца)
                    const edgeMap = new Map();
                    for (const triIdx of faceTris) {
                        const verts = getTriVertices(triIdx);
                        for (let i = 0; i < 3; i++) {
                            const v1 = verts[i];
                            const v2 = verts[(i + 1) % 3];
                            const k1 = getVertexKey(v1);
                            const k2 = getVertexKey(v2);
                            const edgeKey = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
                            if (!edgeMap.has(edgeKey)) {
                                edgeMap.set(edgeKey, { count: 0, v1: v1.clone(), v2: v2.clone() });
                            }
                            edgeMap.get(edgeKey).count++;
                        }
                    }

                    const boundarySegments = [];
                    for (const entry of edgeMap.values()) {
                        if (entry.count === 1) {
                            boundarySegments.push(entry);
                        }
                    }

                    const lineGroups = [];
                    for (const seg of boundarySegments) {
                        const len = seg.v1.distanceTo(seg.v2);
                        if (len < 0.1) continue;
                        const sDir = new THREE.Vector3().subVectors(seg.v2, seg.v1).normalize();
                        
                        let foundGroup = null;
                        for (const g of lineGroups) {
                            if (Math.abs(g.dir.dot(sDir)) > 0.99) {
                                const dist1 = new THREE.Vector3().subVectors(seg.v1, g.point).cross(g.dir).length();
                                if (dist1 < 1.0) {
                                    foundGroup = g;
                                    break;
                                }
                            }
                        }
                        if (foundGroup) {
                            foundGroup.segments.push(seg);
                        } else {
                            lineGroups.push({
                                dir: sDir.clone(),
                                point: seg.v1.clone(),
                                segments: [seg]
                            });
                        }
                    }

                    const hitPointLocal = object.worldToLocal(intersect.point.clone());
                    let bestGroup = null;
                    let minDist = Infinity;
                    const maxDistThreshold = Math.max(30, 3 * sheetT);

                    for (const g of lineGroups) {
                        // Исключаем ребра, идущие вдоль вектора толщины (перпендикулярные плоскости грани)
                        if (Math.abs(g.dir.dot(normal)) > 0.5) continue;

                        let minProj = Infinity, maxProj = -Infinity;
                        let p1 = null, p2 = null;
                        for (const seg of g.segments) {
                            const pr1 = seg.v1.dot(g.dir);
                            const pr2 = seg.v2.dot(g.dir);
                            if (pr1 < minProj) { minProj = pr1; p1 = seg.v1; }
                            if (pr1 > maxProj) { maxProj = pr1; p2 = seg.v1; }
                            if (pr2 < minProj) { minProj = pr2; p1 = seg.v2; }
                            if (pr2 > maxProj) { maxProj = pr2; p2 = seg.v2; }
                        }
                        const spanLength = maxProj - minProj;
                        if (spanLength >= 0.5 * sheetT && p1 && p2) {
                            const segVector = new THREE.Vector3().subVectors(p2, p1);
                            const segLenSq = segVector.lengthSq();
                            let distToSeg = Infinity;
                            if (segLenSq > 1e-6) {
                                const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(hitPointLocal, p1).dot(segVector) / segLenSq));
                                const projection = p1.clone().addScaledVector(segVector, t);
                                distToSeg = hitPointLocal.distanceTo(projection);
                            }
                            
                            if (distToSeg <= maxDistThreshold && distToSeg < minDist) {
                                minDist = distToSeg;
                                const midP = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
                                bestGroup = { p1, p2, midP, dir: g.dir, length: spanLength };
                            }
                        }
                    }

                    if (bestGroup) {
                        const eDir = bestGroup.dir.clone();
                        let outNormal = new THREE.Vector3().crossVectors(eDir, normal).normalize();
                        const toMid = new THREE.Vector3().subVectors(bestGroup.midP, faceCentroid);
                        if (toMid.dot(outNormal) < 0) {
                            outNormal.negate();
                        }

                        const endFaceCenter = bestGroup.midP.clone().addScaledVector(normal, -sheetT / 2);
                        const v1 = endFaceCenter.clone().addScaledVector(eDir, -bestGroup.length / 2);
                        const v2 = endFaceCenter.clone().addScaledVector(eDir, bestGroup.length / 2);

                        const normalMatrix = new THREE.Matrix3().getNormalMatrix(object.matrixWorld);
                        const worldV1 = v1.clone().applyMatrix4(object.matrixWorld);
                        const worldV2 = v2.clone().applyMatrix4(object.matrixWorld);
                        const worldOutNormal = outNormal.clone().applyMatrix3(normalMatrix).normalize();
                        const worldThick = normal.clone().applyMatrix3(normalMatrix).normalize();
                        const worldEdgeDir = eDir.clone().applyMatrix3(normalMatrix).normalize();

                        // Для пласти определяем ориентацию плоскости по нормали самой пласти (worldThick)
                        const absTx = Math.abs(worldThick.x);
                        const absTy = Math.abs(worldThick.y);
                        const absTz = Math.abs(worldThick.z);
                        let planeStr = 'XY';
                        if (absTz >= absTx && absTz >= absTy) {
                            planeStr = 'XY';
                        } else if (absTy >= absTx && absTy >= absTz) {
                            planeStr = 'XZ';
                        } else {
                            planeStr = 'YZ';
                        }

                        const isTopFace = (worldThick.y > 0.01) || (Math.abs(worldThick.y) <= 0.01 && (worldThick.z > 0.01 || worldThick.x > 0.01));
                        const elemType = (isTopFace ? 'topFace_' : 'bottomFace_') + planeStr;

                        bestEdge = {
                            v1: worldV1,
                            v2: worldV2,
                            faceNormal: worldOutNormal,
                            thicknessDir: worldThick,
                            edgeDir: worldEdgeDir,
                            localLength: bestGroup.length,
                            thickness: sheetT,
                            elementType: elemType
                        };
                    }
                }

                if (!bestEdge) {
                    canvas.style.cursor = 'default';
                    const hudElem = document.getElementById('sketch-hud-tooltip');
                    if (hudElem) hudElem.style.display = 'none';
                    if (bendHoverHighlight) {
                        creatorScene.remove(bendHoverHighlight);
                        if (bendHoverHighlight.geometry) bendHoverHighlight.geometry.dispose();
                        if (bendHoverHighlight.material) bendHoverHighlight.material.dispose();
                        bendHoverHighlight = null;
                    }
                    return;
                }

                canvas.style.cursor = 'pointer';

                const worldV1 = bestEdge.v1;
                const worldV2 = bestEdge.v2;
                const worldNormal = bestEdge.faceNormal;
                const worldThick = bestEdge.thicknessDir;
                const worldEdgeDir = bestEdge.edgeDir;
                const targetCorner = (intersect.point.distanceTo(worldV1) < intersect.point.distanceTo(worldV2)) ? 'v1' : 'v2';

                if (bendHoverHighlight) {
                    if (!bendHoverHighlight.userData.edge || 
                        bendHoverHighlight.userData.edge.faceNormal.distanceTo(worldNormal) > 0.05 || 
                        bendHoverHighlight.userData.sourceObject !== object ||
                        bendHoverHighlight.userData.edge.elementType !== bestEdge.elementType ||
                        (bestEdge.elementType.startsWith('corner') && bendHoverHighlight.userData.targetCorner !== targetCorner) ||
                        bendHoverHighlight.userData.edge.v1.distanceTo(worldV1) > 2.0 ||
                        bendHoverHighlight.userData.edge.v2.distanceTo(worldV2) > 2.0) {
                        creatorScene.remove(bendHoverHighlight);
                        if (bendHoverHighlight.geometry) bendHoverHighlight.geometry.dispose();
                        if (bendHoverHighlight.material) bendHoverHighlight.material.dispose();
                        bendHoverHighlight = null;
                        clearBendHoverPhantom();
                    }
                }

                const existingIndex = typeof bendSelectedEdges !== 'undefined' ? bendSelectedEdges.findIndex(item => {
                    if (item.sourceObject !== object) return false;
                    const d11 = item.edge.v1.distanceTo(worldV1);
                    const d22 = item.edge.v2.distanceTo(worldV2);
                    const d12 = item.edge.v1.distanceTo(worldV2);
                    const d21 = item.edge.v2.distanceTo(worldV1);
                    return (d11 < 2.0 && d22 < 2.0) || (d12 < 2.0 && d21 < 2.0);
                }) : -1;
                const isSelected = existingIndex !== -1;

                const highlightColor = isSelected ? 0xEF4444 : 0x10B981;

                if (!bendHoverHighlight) {
                    let hGeo;
                    let centerWorld = new THREE.Vector3().addVectors(worldV1, worldV2).multiplyScalar(0.5);
                    let basisY = worldThick;
                    let basisZ = worldNormal;

                    if (bestEdge.elementType.startsWith('corner')) {
                        const cornerLen = Math.max(12, Math.min(bestEdge.localLength * 0.28, 40));
                        hGeo = new THREE.BoxGeometry(cornerLen, sheetT * 1.2, sheetT * 0.6);
                        const offsetDir = (targetCorner === 'v1') ? (-bestEdge.localLength / 2 + cornerLen / 2) : (bestEdge.localLength / 2 - cornerLen / 2);
                        centerWorld.addScaledVector(worldEdgeDir, offsetDir);
                    } else if (bestEdge.elementType.includes('Face')) {
                        hGeo = new THREE.BoxGeometry(bestEdge.localLength, sheetT, 0.4);
                        basisY = worldThick;
                        basisZ = worldNormal;
                    } else {
                        hGeo = new THREE.BoxGeometry(bestEdge.localLength, sheetT, 0.2);
                    }

                    const hMat = new THREE.MeshBasicMaterial({ 
                        color: highlightColor, 
                        transparent: true, 
                        opacity: (bestEdge.elementType.startsWith('corner') ? 0.75 : 0.65), 
                        depthTest: false, 
                        side: THREE.DoubleSide 
                    });
                    bendHoverHighlight = new THREE.Mesh(hGeo, hMat);
                    bendHoverHighlight.renderOrder = 999;

                    const mat4 = new THREE.Matrix4();
                    mat4.makeBasis(worldEdgeDir, basisY, basisZ);
                    mat4.setPosition(centerWorld);

                    bendHoverHighlight.matrixAutoUpdate = false;
                    bendHoverHighlight.matrix.copy(mat4);

                    bendHoverHighlight.userData = { sourceObject: object, edge: bestEdge, targetCorner: targetCorner };
                    creatorScene.add(bendHoverHighlight);
                } else {
                    bendHoverHighlight.material.color.setHex(highlightColor);
                    bendHoverHighlight.userData.edge = bestEdge;
                    bendHoverHighlight.userData.targetCorner = targetCorner;
                }

                // Убираем тексты/надписи
                const hudElem = document.getElementById('sketch-hud-tooltip');
                if (hudElem) hudElem.style.display = 'none';

                // Фантом гиба при наведении (если ребро еще не выбрано)
                if (!isSelected) {
                    if (!bendHoverPhantom || 
                        bendHoverPhantom.userData.edge !== bestEdge || 
                        bendHoverPhantom.userData.sourceObject !== object) {
                        clearBendHoverPhantom();
                        if (typeof window.buildSingleBendPhantom === 'function') {
                            bendHoverPhantom = window.buildSingleBendPhantom(object, bestEdge, { color: 0x10B981, opacity: 0.55 });
                            if (bendHoverPhantom) {
                                creatorScene.add(bendHoverPhantom);
                            }
                        }
                    }
                } else {
                    clearBendHoverPhantom();
                }
            } else {
                canvas.style.cursor = 'default';
                const hudElem = document.getElementById('sketch-hud-tooltip');
                if (hudElem) hudElem.style.display = 'none';
                if (bendHoverHighlight) {
                    creatorScene.remove(bendHoverHighlight);
                    if (bendHoverHighlight.geometry) bendHoverHighlight.geometry.dispose();
                    if (bendHoverHighlight.material) bendHoverHighlight.material.dispose();
                    bendHoverHighlight = null;
                }
                clearBendHoverPhantom();
            }
            return;
        }

        if (mateState > 0) return;
        if (!isSketchMode) return;
        // В режиме эскиза вычисляем точку на бесконечной плоскости
        if (sketchState === 1 && activeSketchPlane) {
            const pt = getSketchPlaneIntersection(sketchRaycaster, activeSketchPlane);
            if (pt) {
                lastMouseSketchPt = pt;
                
                const snappedPt = applySnapsAndOrtho(pt, true);
                if (currentDrawPoints.length > 0) {
                    updateTempShape(snappedPt);
                    if (sketchTool === 'rectangle' && currentDrawPoints.length === 1) {
                        updateRectDimensionHUD();
                    }
                }
                
                if (sketchTool === 'trim' || sketchTool === 'extend' || sketchTool === 'chamfer' || sketchTool === 'fillet') {
                    if (typeof updateTopologyHover === 'function') updateTopologyHover(pt);
                } else if (sketchTool === 'mirror') {
                    if (typeof window.updateMirrorHover === 'function') window.updateMirrorHover(pt, snappedPt, e);
                }
            } else {
                if(snapMarker) snapMarker.visible = false;
            }
        }
    });

    function applyGizmoValue(value) {
        if (!activeGizmoInputAction || selectedObjects.length === 0) return;

        const action = activeGizmoInputAction;
        const isScale = action.startsWith('Scale');
        const isRotate = action.startsWith('Rotate');
        const isTranslate = !isScale && !isRotate;

        const realAxisName = action.replace('Scale', '').replace('Rotate', '');
        
        const gizmoCenter = customGizmo.position.clone();

        if (isTranslate) {
            const worldTranslation = new THREE.Vector3();
            if (realAxisName === 'X') worldTranslation.x = value;
            else if (realAxisName === 'Y') worldTranslation.y = value;
            else if (realAxisName === 'Z') worldTranslation.z = value;
            
            selectedObjects.forEach(obj => {
                const worldPos = new THREE.Vector3();
                obj.getWorldPosition(worldPos);
                worldPos.add(worldTranslation);
                if (obj.parent) {
                    obj.parent.worldToLocal(worldPos);
                }
                obj.position.copy(worldPos);
                obj.updateMatrixWorld(true);
            });
            customGizmo.position.add(worldTranslation);

        } else if (isScale) {
            if (value <= 0) {
                if (typeof showToast === 'function') showToast("Коэффициент масштабирования должен быть больше нуля.");
                return;
            }
            
            selectedObjects.forEach(obj => {
                const worldPos = new THREE.Vector3();
                obj.getWorldPosition(worldPos);

                const localPos = new THREE.Vector3().subVectors(worldPos, gizmoCenter);

                if (realAxisName === 'X') {
                    obj.scale.x *= value;
                    localPos.x *= value;
                } else if (realAxisName === 'Y') {
                    obj.scale.y *= value;
                    localPos.y *= value;
                } else if (realAxisName === 'Z') {
                    obj.scale.z *= value;
                    localPos.z *= value;
                }

                const newWorldPos = new THREE.Vector3().addVectors(gizmoCenter, localPos);
                
                if (obj.parent) {
                    obj.parent.worldToLocal(newWorldPos);
                }
                obj.position.copy(newWorldPos);

                obj.updateMatrixWorld(true);
                updateObjectSpecText(obj);
            });

        } else if (isRotate) {
            const angle = THREE.MathUtils.degToRad(value);
            const axis = new THREE.Vector3();
            if (realAxisName === 'X') axis.set(1, 0, 0);
            else if (realAxisName === 'Y') axis.set(0, 1, 0);
            else if (realAxisName === 'Z') axis.set(0, 0, 1);

            const qRot = new THREE.Quaternion().setFromAxisAngle(axis, angle);

            selectedObjects.forEach(obj => {
                const worldPos = new THREE.Vector3();
                obj.getWorldPosition(worldPos);

                const posRelToGizmo = new THREE.Vector3().subVectors(worldPos, gizmoCenter);
                posRelToGizmo.applyQuaternion(qRot);
                const newWorldPos = new THREE.Vector3().addVectors(gizmoCenter, posRelToGizmo);
                
                if (obj.parent) {
                    obj.parent.worldToLocal(newWorldPos);
                }
                obj.position.copy(newWorldPos);

                const parentWorldQuatInv = new THREE.Quaternion();
                if (obj.parent) obj.parent.getWorldQuaternion(parentWorldQuatInv).invert();
                obj.quaternion.premultiply(parentWorldQuatInv).premultiply(qRot).premultiply(parentWorldQuatInv.invert());
                
                obj.updateMatrixWorld(true);
            });
        }
    }

    window.confirmGizmoInput = function() {
        const gizmoPopup = document.getElementById('gizmo-input-popup');
        const gizmoInput = document.getElementById('gizmo-value-input');
        if (gizmoInput && gizmoInput.value !== '') {
            const value = parseFloat(gizmoInput.value);
            if (!isNaN(value)) {
                applyGizmoValue(value);
            }
        }
        if (gizmoPopup) gizmoPopup.style.display = 'none';
        activeGizmoInputAction = null;
    };

    canvas.addEventListener('dblclick', (e) => {
        if (isSketchMode || isGizmoDragging) return;
        let didGizmoClick = false;

        const canvas_element = document.getElementById("canvas-creator") || canvas;
        const rect = canvas_element.getBoundingClientRect();
        sketchMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        sketchMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        const gizmoPopup = document.getElementById('gizmo-input-popup');
        const gizmoInput = document.getElementById('gizmo-value-input');
        const gizmoTitle = document.getElementById('gizmo-input-title');

        if (customGizmo && customGizmo.visible) {
            sketchRaycaster.setFromCamera(sketchMouse, currentCreatorCamera);
            const intersects = sketchRaycaster.intersectObject(customGizmo, true);
            
            if (intersects.length > 0) {
                let hitObj = intersects[0].object;
                let axis = null;
                let cur = hitObj;
                while (cur) {
                    if (cur.userData && cur.userData.gizmoAxis) {
                        axis = cur.userData.gizmoAxis;
                        break;
                    }
                    cur = cur.parent;
                }

                if (axis) {
                    e.preventDefault();
                    e.stopPropagation();
                    activeGizmoInputAction = axis;
                    
                    if (gizmoTitle) {
                        if (axis.startsWith('Rotate')) {
                            gizmoTitle.textContent = `Поворот ${axis.replace('Rotate','')}: угол (°)`;
                        } else if (axis.startsWith('Scale')) {
                            gizmoTitle.textContent = `Масштаб ${axis.replace('Scale','')}: фактор`;
                        } else {
                            gizmoTitle.textContent = `Смещение ${axis}: значение (мм)`;
                        }
                    }

                    if (gizmoPopup) {
                        gizmoPopup.style.display = 'block';
                        const maxX = window.innerWidth - 180;
                        const maxY = window.innerHeight - 100;
                        gizmoPopup.style.left = `${Math.min(e.clientX + 5, maxX)}px`;
                        gizmoPopup.style.top = `${Math.min(e.clientY + 5, maxY)}px`;
                    }
                    if (gizmoInput) {
                        gizmoInput.value = '';
                        setTimeout(() => gizmoInput.focus(), 50);
                    }
                    didGizmoClick = true;
                }
            }
        }

        // Вызов Быстрого кругового меню, если клик был не по Гизмо
        if (!didGizmoClick && mateState === 0) {
            e.preventDefault();
            const hasSelection = (typeof selectedObjects !== 'undefined' && selectedObjects.length > 0);
            if (window.openRadialMenu) window.openRadialMenu(e.clientX, e.clientY, hasSelection);
        }
    });

    const gizmoInputEl = document.getElementById('gizmo-value-input');
    if (gizmoInputEl) {
        gizmoInputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                window.confirmGizmoInput();
            } else if (e.key === 'Escape') {
                const gizmoPopup = document.getElementById('gizmo-input-popup');
                if (gizmoPopup) gizmoPopup.style.display = 'none';
                activeGizmoInputAction = null;
            }
        });
    }

    document.addEventListener('click', (e) => { 
        const gizmoPopup = document.getElementById('gizmo-input-popup');
        if (gizmoPopup && gizmoPopup.style.display === 'block' && !gizmoPopup.contains(e.target)) { 
            gizmoPopup.style.display = 'none'; 
            activeGizmoInputAction = null; 
        } 
    }, true);

    window.addEventListener('pointerup', (e) => {
        if (e.button === 2) {
            if (isRmbHolding) {
                stopRmbHoldProgress();
                if (isSketchMode && sketchState === 1 && currentDrawPoints.length > 0) {
                    currentDrawPoints = [];
                    if (tempShapePreview) {
                        tempShapePreview.visible = false;
                        tempShapePreview.geometry.setDrawRange(0, 0);
                    }
                    if (snapMarker) snapMarker.visible = false;
                    resetRectDimState();
                    setSketchTool(sketchTool);
                }
            }
            return;
        }
        if (e.button !== 0) return;
        if (isSketchMode && sketchTool === 'mirror') {
            if (typeof window.handleMirrorPointerUp === 'function') {
                window.handleMirrorPointerUp(e);
            }
        }
        if (isGizmoDragging) {
            isGizmoDragging = false;
            creatorControls.enabled = true;
            if (customGizmo) {
                customGizmo.traverse(child => { 
                    if (child.isMesh && child.userData.originalColor !== undefined) {
                        child.material.color.setHex(child.userData.originalColor); 
                    }
                });
            }
        }
    });

    // Захватываем событие ДО OrbitControls (с помощью capture: true)
    canvas.addEventListener('pointerdown', (e) => {
        if (e.button === 2) {
            if (mateState > 0 || mateUnfoldedHelper) {
                // В режиме слипания/развертки ПКМ открывает/закрывает развертку без сдвига OrbitControls
                return;
            }
            if (isSketchMode && sketchTool === 'rectangle') {
                startRmbHoldProgress(e.clientX, e.clientY);
            }
            return;
        }
        if (e.button !== 0) return;
        
        const canvas_element = document.getElementById("canvas-creator");
        const rect = canvas_element.getBoundingClientRect();
        sketchMouse.x = ((e.clientX - rect.left) / canvas.clientWidth) * 2 - 1;
        sketchMouse.y = -((e.clientY - rect.top) / canvas.clientHeight) * 2 + 1;

        if (mateState > 0 || mateUnfoldedHelper) {
            sketchRaycaster.setFromCamera(sketchMouse, currentCreatorCamera);
            if (mateUnfoldedHelper && mateUnfoldedHelper.plates) {
                const helperMeshes = mateUnfoldedHelper.plates.map(p => p.mesh);
                const helperHits = sketchRaycaster.intersectObjects(helperMeshes, false);
                if (helperHits.length > 0) {
                    e.stopPropagation();
                    return;
                }
            }
        }

        if (isSketchMode && sketchTool === 'mirror') {
            sketchRaycaster.setFromCamera(sketchMouse, currentCreatorCamera);
            const pt = getSketchPlaneIntersection(sketchRaycaster, activeSketchPlane);
            if (typeof window.handleMirrorPointerDown === 'function') {
                window.handleMirrorPointerDown(e, pt);
            }
        }

        if (bendState === 1 || bendState === 2) {
            console.log("Bend click! bendHoverHighlight:", !!bendHoverHighlight);
            if (bendHoverHighlight) {
                // Add or remove from selection
                const hEdge = bendHoverHighlight.userData.edge;
                const existingIndex = bendSelectedEdges.findIndex(item => {
                    if (item.sourceObject !== bendHoverHighlight.userData.sourceObject) return false;
                    const d11 = item.edge.v1.distanceTo(hEdge.v1);
                    const d22 = item.edge.v2.distanceTo(hEdge.v2);
                    const d12 = item.edge.v1.distanceTo(hEdge.v2);
                    const d21 = item.edge.v2.distanceTo(hEdge.v1);
                    return (d11 < 1.0 && d22 < 1.0) || (d12 < 1.0 && d21 < 1.0);
                });
                console.log('existingIndex', existingIndex, 'bendSelectedEdges length', bendSelectedEdges.length);
                if (existingIndex !== -1) {
                    bendSelectedEdges.splice(existingIndex, 1);
                } else {
                    bendSelectedEdges.push({
                        edge: bendHoverHighlight.userData.edge,
                        sourceObject: bendHoverHighlight.userData.sourceObject
                    });
                }
                
                if (bendSelectedEdges.length > 0) {
                    bendState = 2;
                } else {
                    bendState = 1;
                }
                const quickPanel = document.getElementById('quick-input-bend');
                if (quickPanel) {
                    if (!quickPanel.dataset.userMoved && (!quickPanel.style.left || quickPanel.style.left === '50%')) {
                        quickPanel.style.left = '50%';
                        quickPanel.style.top = '50%';
                        quickPanel.style.transform = 'translate(-50%, -50%)';
                    }
                    quickPanel.classList.add('active');
                }
                const menu = document.getElementById('radial-menu');
                if (menu) menu.classList.remove('active');
                clearBendHoverPhantom();
                if (typeof window.updateBendPhantoms === 'function') window.updateBendPhantoms();
            }
            return;
        }

        if (gizmoState === 2 && !isSketchMode) {
            sketchRaycaster.setFromCamera(sketchMouse, currentCreatorCamera);
            const intersects = sketchRaycaster.intersectObject(customGizmo, true);
            if (intersects.length > 0) {
                const hit = intersects[0].object;
                if (hit.userData.gizmoAxis) {
                    e.stopPropagation(); // Блокируем вращение камеры
                    isGizmoDragging = true; gizmoDragAxis = hit.userData.gizmoAxis; creatorControls.enabled = false;
                    const camDir = new THREE.Vector3(); currentCreatorCamera.getWorldDirection(camDir);
                    let planeNormal = new THREE.Vector3();
                    let axis = new THREE.Vector3();
                    let isPlane = false;
                    let isRotate = gizmoDragAxis.startsWith('Rotate');
                    
                    let realAxisName = gizmoDragAxis.replace('Scale', '').replace('Rotate', '');

                    if (realAxisName === 'X') axis.set(1, 0, 0);
                    else if (realAxisName === 'Y') axis.set(0, 1, 0);
                    else if (realAxisName === 'Z') axis.set(0, 0, 1);
                    else if (realAxisName === 'XY') { axis.set(0, 0, 1); isPlane = true; }
                    else if (realAxisName === 'XZ') { axis.set(0, 1, 0); isPlane = true; }
                    else if (realAxisName === 'YZ') { axis.set(1, 0, 0); isPlane = true; }
                    
                    if (realAxisName === 'XYZ') {
                        planeNormal.copy(camDir).negate();
                    } else if (isPlane) {
                        planeNormal.copy(axis);
                    } else if (isRotate) {
                        planeNormal.copy(axis);
                    } else {
                        planeNormal.crossVectors(axis, camDir).cross(axis).normalize();
                        if (planeNormal.lengthSq() < 0.01) planeNormal.set(0, 1, 0); // fallback
                    }

                    gizmoDragPlane.setFromNormalAndCoplanarPoint(planeNormal, customGizmo.position);
                    const planeIntersect = new THREE.Vector3();
                    const intersectResult = sketchRaycaster.ray.intersectPlane(gizmoDragPlane, planeIntersect);
                    if (intersectResult) { 
                        gizmoDragStartPoint.copy(planeIntersect); 
                        gizmoStartPos.copy(customGizmo.position);
                        selectedObjectsStartData = selectedObjects.map(obj => {
                            const startWorldPos = new THREE.Vector3();
                            obj.getWorldPosition(startWorldPos);
                            return { obj: obj, startWorldPos: startWorldPos, startScale: obj.scale.clone(), startQuat: obj.quaternion.clone() };
                        });
                    }
                }
            }
            return;
        }
    }, { capture: true });

    canvas.addEventListener('click', (e) => {
        const canvasRect = canvas.getBoundingClientRect();
        sketchMouse.x = ((e.clientX - canvasRect.left) / canvas.clientWidth) * 2 - 1;
        sketchMouse.y = -((e.clientY - canvasRect.top) / canvas.clientHeight) * 2 + 1;

        if (typeof isPipeModeActive === 'function' && isPipeModeActive() && activeHoverHole) {
            selectedPipeHole = {
                worldCenter: activeHoverHole.worldCenter.clone(),
                worldAxis: activeHoverHole.worldAxis.clone(),
                outwardAxis: (activeHoverHole.outwardAxis ? activeHoverHole.outwardAxis.clone() : activeHoverHole.worldAxis.clone()),
                topFaceCenter: (activeHoverHole.topFaceCenter ? activeHoverHole.topFaceCenter.clone() : activeHoverHole.worldCenter.clone()),
                holeDepth: activeHoverHole.holeDepth || 10,
                diameter: activeHoverHole.diameter,
                mesh: activeHoverHole.mesh
            };

            const diamVal = activeHoverHole.diameter;
            const dStr = (Math.round(diamVal * 10) / 10).toString();

            const pd = document.getElementById('pipe-d');
            if (pd) {
                pd.value = dStr;
                pd.dispatchEvent(new Event('input', { bubbles: true }));
            }
            const qpd = document.getElementById('qi-pipe-d');
            if (qpd) {
                qpd.value = dStr;
                qpd.dispatchEvent(new Event('input', { bubbles: true }));
            }

            const pt = document.getElementById('pipe-t') || document.getElementById('qi-pipe-t');
            const pl = document.getElementById('pipe-l') || document.getElementById('qi-pipe-l');
            if (pt && (!pt.value || parseFloat(pt.value) === 0)) {
                pt.value = '10';
                pt.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (pl && (!pl.value || parseFloat(pl.value) <= 0)) {
                pl.value = '100';
                pl.dispatchEvent(new Event('input', { bubbles: true }));
            }

            // Интеграция с панелью "Профиль" -> "Труба"
            const qprof = document.getElementById('quick-input-profile');
            if (qprof && qprof.classList.contains('active')) {
                const catInp = document.getElementById('qi-profile-category');
                if (catInp) {
                    catInp.value = 'Труба';
                    if (typeof window.onProfileCategoryInput === 'function') {
                        window.onProfileCategoryInput('Труба', false);
                    }
                }
                const typeInp = document.getElementById('qi-profile-type');
                if (typeInp) {
                    typeInp.value = `⌀${dStr}x10`;
                    typeInp.dispatchEvent(new Event('input', { bubbles: true }));
                }
                const lInp = document.getElementById('qi-profile-l');
                if (lInp && (!lInp.value || parseFloat(lInp.value) <= 0)) {
                    lInp.value = '1000';
                    lInp.dispatchEvent(new Event('input', { bubbles: true }));
                }
                if (typeInp) {
                    typeInp.focus();
                    if (typeInp.select) typeInp.select();
                }
                if (qprof.classList.contains('show-preview') && typeof updatePreview === 'function') {
                    updatePreview('profile');
                }
            } else if (pt) {
                pt.focus();
                if (pt.select) pt.select();
            }

            if (typeof showToast === 'function') {
                showToast(`Вырез ⌀${dStr} мм выбран. Отображён фантом трубы`);
            }

            const qp = document.getElementById('quick-input-pipe');
            if (qp && qp.classList.contains('active') && typeof updatePreview === 'function') {
                updatePreview('pipe');
            }

            if (typeof window.update3DPipePhantom === 'function') {
                window.update3DPipePhantom();
            }
            return;
        }

        // Режим развертки (Unfold Mode)
        if (window.unfoldLifecycleManager && window.unfoldLifecycleManager.isActive) {
            const rect = canvas.getBoundingClientRect();
            sketchMouse.x = ((e.clientX - rect.left) / canvas.clientWidth) * 2 - 1;
            sketchMouse.y = -((e.clientY - rect.top) / canvas.clientHeight) * 2 + 1;
            sketchRaycaster.setFromCamera(sketchMouse, currentCreatorCamera);

            // 1. Если активен режим сопряжения деталей (Mating Mode)
            if (mateState === 1 || mateState === 2) {
                const subMeshes = (window.unfoldLifecycleManager.controller && window.unfoldLifecycleManager.controller.subMeshes) 
                    ? window.unfoldLifecycleManager.controller.subMeshes 
                    : (window.unfoldLifecycleManager.rootGroup ? [window.unfoldLifecycleManager.rootGroup] : []);
                
                const unfoldHits = sketchRaycaster.intersectObjects(subMeshes, true);
                if (unfoldHits.length > 0) {
                    const hit = unfoldHits[0];
                    const originalObj = window.unfoldLifecycleManager.activeMesh;
                    if (originalObj) {
                        // Точная барицентрическая интерполяция точки с саб-меша развертки на исходное 3D тело!
                        let worldPoint, worldNormal, localNormal, localPoint;
                        const interp = window.unfoldLifecycleManager.interpolateUnfoldedToOriginal(hit.object, hit.point, hit.faceIndex, hit.face);
                        if (interp && interp.origWorldPoint) {
                            worldPoint = interp.origWorldPoint.clone();
                            localPoint = interp.origLocalPoint.clone();
                            worldNormal = interp.origNormal ? interp.origNormal.clone() : hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(originalObj.matrixWorld)).normalize();
                            localNormal = originalObj.worldToLocal(worldPoint.clone().add(worldNormal)).sub(localPoint).normalize();
                        } else {
                            const normalMatrix = new THREE.Matrix3().getNormalMatrix(originalObj.matrixWorld);
                            worldNormal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
                            worldPoint = hit.point.clone();
                            localNormal = hit.face.normal.clone();
                            localPoint = originalObj.worldToLocal(hit.point.clone());
                        }

                        // Устанавливаем визуальный маркер сопряжения на 3D модели
                        window.unfoldLifecycleManager.setInterpolationPoint(hit.point, worldPoint, interp);

                        // Закрываем развертку после выбора грани для сопряжения
                        window.unfoldLifecycleManager.disableUnfold();

                        if (mateState === 1) {
                            mateObjectA = originalObj;
                            mateFaceA = { 
                                point: worldPoint, 
                                normal: worldNormal, 
                                localNormal: localNormal, 
                                localPoint: localPoint 
                            };
                            if (mateHighlightA) creatorScene.remove(mateHighlightA);
                            mateHighlightA = createFaceHighlight(worldPoint, worldNormal, 0x5AAFDD);
                            creatorScene.add(mateHighlightA);
                            
                            mateState = 2;
                            if (typeof showToast === 'function') showToast("Первая грань выбрана на 3D модели. Теперь выберите грань на ДРУГОМ объекте");
                            return;
                        } else if (mateState === 2) {
                            if (originalObj === mateObjectA) {
                                if (typeof showToast === 'function') showToast("Выберите грань на ДРУГОМ объекте!");
                                return;
                            }
                            
                            mateObjectB = originalObj;
                            mateFaceB = { 
                                point: worldPoint, 
                                normal: worldNormal, 
                                localNormal: localNormal, 
                                localPoint: localPoint 
                            };
                            if (mateHighlightB) creatorScene.remove(mateHighlightB);
                            mateHighlightB = createFaceHighlight(worldPoint, worldNormal, 0xE6A817);
                            creatorScene.add(mateHighlightB);
                            
                            mateState = 0;
                            setCreatorUIMode('default');
                            if (window.setCreatorActiveTool) window.setCreatorActiveTool(null);
                            
                            animateMate(mateObjectA, mateFaceA, mateObjectB, mateFaceB, mateHighlightA, mateHighlightB);
                            return;
                        }
                    }
                }
            }

            // 2. Стандартный клик по развертке вне сопряжения -> интерполяция и установка точки на 3D теле
            const subMeshes = (window.unfoldLifecycleManager.controller && window.unfoldLifecycleManager.controller.subMeshes) 
                ? window.unfoldLifecycleManager.controller.subMeshes 
                : [];
            const candidateList = [...subMeshes];
            const activeM = window.unfoldLifecycleManager.activeMesh;
            if (activeM && activeM.visible) candidateList.push(activeM);

            const unfoldHits = sketchRaycaster.intersectObjects(candidateList, false);
            if (unfoldHits.length > 0) {
                const hit = unfoldHits[0];

                // Смена базовой грани только по Shift/Alt
                if (e.shiftKey || e.altKey) {
                    if (typeof window.selectUnfoldBaseFace === 'function') {
                        window.selectUnfoldBaseFace(sketchRaycaster, sketchMouse);
                    }
                    return;
                }

                if (hit.object.userData && hit.object.userData.isSubMesh) {
                    const interp = window.unfoldLifecycleManager.interpolateUnfoldedToOriginal(hit.object, hit.point, hit.faceIndex, hit.face);
                    if (interp) {
                        console.log('[UnfoldLifecycleManager] Точка с развертки интерполирована на 3D деталь:', interp);
                        window.unfoldLifecycleManager.setInterpolationPoint(interp.unfoldWorldPoint, interp.origWorldPoint, interp);
                    }
                    return;
                } else if (hit.object === activeM) {
                    const interp = window.unfoldLifecycleManager.interpolateOriginalToUnfolded(hit.point, hit.faceIndex, hit.face);
                    if (interp) {
                        console.log('[UnfoldLifecycleManager] Точка с 3D тела интерполирована на развертку:', interp);
                        window.unfoldLifecycleManager.setInterpolationPoint(interp.unfoldWorldPoint, interp.origWorldPoint, interp);
                    }
                    return;
                }
            }
            return;
        }

        if (window.flattenMode) {
            const rect = canvas.getBoundingClientRect();
            sketchMouse.x = ((e.clientX - rect.left) / canvas.clientWidth) * 2 - 1;
            sketchMouse.y = -((e.clientY - rect.top) / canvas.clientHeight) * 2 + 1;
            sketchRaycaster.setFromCamera(sketchMouse, currentCreatorCamera);
            if (typeof window.selectUnfoldBaseFace === 'function') {
                window.selectUnfoldBaseFace(sketchRaycaster, sketchMouse);
            }
            return;
        }

        if (cutoutState === 1) {
            sketchRaycaster.setFromCamera(sketchMouse, currentCreatorCamera);
            const interactable = [];
            creatorScene.traverse(c => { 
                if (c.isMesh && !c.userData.isSketchPlane && !c.userData.isSketch && c !== snapMarker && !c.userData.isMateHighlight && !c.userData.isMateSymbol) {
                    interactable.push(c); 
                }
            });
            const intersects = sketchRaycaster.intersectObjects(interactable, false);
            
            if (intersects.length > 0) {
                const intersect = intersects[0];
                const normalMatrix = new THREE.Matrix3().getNormalMatrix(intersect.object.matrixWorld);
                const worldNormal = intersect.face.normal.clone().applyMatrix3(normalMatrix).normalize();
                
                performCutout(intersect.object, intersect.point, worldNormal);
                cutoutState = 0;
                setCreatorUIMode('default');
                if (window.setCreatorActiveTool) window.setCreatorActiveTool(null);
            }
            return;
        }

        
        if (mateState === 1 || mateState === 2) {
            sketchRaycaster.setFromCamera(sketchMouse, currentCreatorCamera);

            // Если открыта кинематическая развертка — проверяем клик по ее саб-мешам для выбора грани
            if (window.unfoldLifecycleManager && window.unfoldLifecycleManager.isActive && window.unfoldLifecycleManager.rootGroup) {
                const unfoldHits = sketchRaycaster.intersectObjects([window.unfoldLifecycleManager.rootGroup], true);
                if (unfoldHits.length > 0) {
                    const hit = unfoldHits[0];
                    const originalObj = window.unfoldLifecycleManager.activeMesh;
                    if (originalObj) {
                        const normalMatrix = new THREE.Matrix3().getNormalMatrix(originalObj.matrixWorld);
                        const worldNormal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
                        const worldPoint = hit.point.clone();
                        const localNormal = hit.face.normal.clone();
                        const localPoint = originalObj.worldToLocal(hit.point.clone());

                        window.unfoldLifecycleManager.disableUnfold();

                        if (mateState === 1) {
                            mateObjectA = originalObj;
                            mateFaceA = { 
                                point: worldPoint, 
                                normal: worldNormal, 
                                localNormal: localNormal, 
                                localPoint: localPoint 
                            };
                            if (mateHighlightA) creatorScene.remove(mateHighlightA);
                            mateHighlightA = createFaceHighlight(worldPoint, worldNormal, 0x5AAFDD);
                            creatorScene.add(mateHighlightA);
                            
                            mateState = 2;
                            if (typeof showToast === 'function') showToast("Первая грань выбрана. Теперь выберите грань на ДРУГОМ объекте (ЛКМ или ПКМ для развертки)");
                            return;
                        } else if (mateState === 2) {
                            if (originalObj === mateObjectA) {
                                if (typeof showToast === 'function') showToast("Выберите грань на ДРУГОМ объекте!");
                                return;
                            }
                            
                            mateObjectB = originalObj;
                            mateFaceB = { 
                                point: worldPoint, 
                                normal: worldNormal, 
                                localNormal: localNormal, 
                                localPoint: localPoint 
                            };
                            if (mateHighlightB) creatorScene.remove(mateHighlightB);
                            mateHighlightB = createFaceHighlight(worldPoint, worldNormal, 0xE6A817);
                            creatorScene.add(mateHighlightB);
                            
                            mateState = 0;
                            setCreatorUIMode('default');
                            if (window.setCreatorActiveTool) window.setCreatorActiveTool(null);
                            
                            animateMate(mateObjectA, mateFaceA, mateObjectB, mateFaceB, mateHighlightA, mateHighlightB);
                            return;
                        }
                    }
                }
            }

            // Если открыт габаритный куб-развертка — проверяем клик по его раскрытым граням
            if (mateUnfoldedHelper && mateUnfoldedHelper.plates) {
                const helperMeshes = mateUnfoldedHelper.plates.map(p => p.mesh);
                const helperHits = sketchRaycaster.intersectObjects(helperMeshes, false);
                if (helperHits.length > 0) {
                    handleMateHelperFaceClick(helperHits[0].object, helperHits[0].point);
                    return;
                }
            }

            const interactable = [];
            creatorScene.traverse(c => { 
                if (c.isMesh && !c.userData.isSketchPlane && !c.userData.isSketch && c !== snapMarker && !c.userData.isMateHighlight && !c.userData.isMateSymbol && !c.userData.isGizmo) {
                    interactable.push(c); 
                }
            });
            const intersects = sketchRaycaster.intersectObjects(interactable, false);
            
            if (intersects.length > 0) {
                const intersect = intersects[0];
                const normalMatrix = new THREE.Matrix3().getNormalMatrix(intersect.object.matrixWorld);
                const worldNormal = intersect.face.normal.clone().applyMatrix3(normalMatrix).normalize();
                
                if (mateState === 1) {
                    mateObjectA = intersect.object;
                    mateFaceA = { 
                        point: intersect.point.clone(), 
                        normal: worldNormal.clone(),
                        localNormal: intersect.face.normal.clone(),
                        localPoint: intersect.object.worldToLocal(intersect.point.clone())
                    };
                    if (mateHighlightA) creatorScene.remove(mateHighlightA);
                    mateHighlightA = createFaceHighlight(intersect.point, worldNormal, 0x5AAFDD);
                    creatorScene.add(mateHighlightA);
                    
                    mateState = 2;
                    if (typeof showToast === 'function') showToast("Выберите вторую грань на ДРУГОМ объекте (ЛКМ или ПКМ для развертки)");
                } else if (mateState === 2) {
                    if (intersect.object === mateObjectA) {
                        if (typeof showToast === 'function') showToast("Выберите грань на ДРУГОМ объекте!");
                        return;
                    }
                    
                    mateObjectB = intersect.object;
                    mateFaceB = { point: intersect.point.clone(), normal: worldNormal.clone(), localNormal: intersect.face.normal.clone(), localPoint: intersect.object.worldToLocal(intersect.point.clone()) };
                    if (mateHighlightB) creatorScene.remove(mateHighlightB);
                    mateHighlightB = createFaceHighlight(intersect.point, worldNormal, 0xE6A817);
                    creatorScene.add(mateHighlightB);
                    
                    mateState = 0;
                    setCreatorUIMode('default');
                    if (window.setCreatorActiveTool) window.setCreatorActiveTool(null);
                    
                    animateMate(mateObjectA, mateFaceA, mateObjectB, mateFaceB, mateHighlightA, mateHighlightB);
                }
            }
            return;
        }

        if (cutoutState === 1) {
            sketchRaycaster.setFromCamera(sketchMouse, currentCreatorCamera);
            const interactable = [];
            creatorScene.traverse(c => { 
                if (c.isMesh && !c.userData.isSketchPlane && !c.userData.isSketch && c !== snapMarker && !c.userData.isMateHighlight && !c.userData.isMateSymbol) {
                    interactable.push(c); 
                }
            });
            const intersects = sketchRaycaster.intersectObjects(interactable, false);
            
            if (intersects.length > 0) {
                const intersect = intersects[0];
                const normalMatrix = new THREE.Matrix3().getNormalMatrix(intersect.object.matrixWorld);
                const worldNormal = intersect.face.normal.clone().applyMatrix3(normalMatrix).normalize();
                
                performCutout(intersect.object, intersect.point, worldNormal);
                cutoutState = 0;
                setCreatorUIMode('default');
                if (window.setCreatorActiveTool) window.setCreatorActiveTool(null);
            }
            return;
        }

        if (!isSketchMode) {
            if (isGizmoDragging) return;
            sketchRaycaster.setFromCamera(sketchMouse, currentCreatorCamera);
            if (gizmoState > 0 && sketchRaycaster.intersectObject(customGizmo, true).length > 0 && customGizmo.visible) return;
            const interactable = [];
            function isGizmoPart(o){let c=o;let safety=0;while(c){if(safety++ > 1000){console.warn("isGizmoPart infinite loop guard triggered.");return false;}if(c===customGizmo)return true;c=c.parent;}return false;}
            safeTraverse(creatorScene, c => { if (c.isMesh && c !== snapMarker && !c.userData.isSketchPlane && !c.userData.isSketch && !isGizmoPart(c)) interactable.push(c); });
            const intersects = sketchRaycaster.intersectObjects(interactable, false);

            if (!e.shiftKey) {
                const prevSelected = [...selectedObjects];
                const hit = intersects.length > 0 ? intersects[0].object : null;
                const targetEntity = hit ? getUnifiedSelectableEntity(hit) : null;
                const isSameSingleObject = targetEntity && prevSelected.length === 1 && prevSelected[0] === targetEntity;

                selectedObjects.forEach(obj => {
                    setEntitySelectionColor(obj, false);
                });
                selectedObjects = [];

                if (targetEntity) {
                    if (isSameSingleObject) {
                        // Clicked already selected object -> toggle off (deselect)
                        document.querySelectorAll('.spec-table-row.selected-row').forEach(r => r.classList.remove('selected-row'));
                    } else {
                        // Select new object
                        setEntitySelectionColor(targetEntity, true);
                        selectedObjects.push(targetEntity);

                        // Highlight specification row
                        const specRowTr = window.getSpecRowByMesh(targetEntity) || window.getSpecRowByMesh(hit);
                        if (specRowTr) {
                            document.querySelectorAll('.spec-table-row').forEach(r => r.classList.remove('selected-row'));
                            specRowTr.classList.add('selected-row');
                            const scrollContainer = specRowTr.closest('.table-wrapper') || specRowTr.closest('div[style*="overflow"]');
                            if (scrollContainer) specRowTr.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                    }
                } else {
                    // Clicked empty space -> deselect all
                    document.querySelectorAll('.spec-table-row.selected-row').forEach(r => r.classList.remove('selected-row'));
                }
            } else {
                if (intersects.length > 0) {
                    const hit = intersects[0].object;
                    const targetEntity = getUnifiedSelectableEntity(hit);
                    const idx = selectedObjects.indexOf(targetEntity);
                    
                    const specRowTr = window.getSpecRowByMesh(targetEntity) || window.getSpecRowByMesh(hit);
                    if (specRowTr) {
                        specRowTr.classList.toggle('selected-row');
                    }

                    if (idx > -1) {
                        setEntitySelectionColor(targetEntity, false);
                        selectedObjects.splice(idx, 1);
                    } else {
                        setEntitySelectionColor(targetEntity, true);
                        selectedObjects.push(targetEntity);
                    }
                }
            }
            
            if (selectedObjects.length > 0) {
                const box = new THREE.Box3();
                selectedObjects.forEach(obj => box.expandByObject(obj));
                const center = new THREE.Vector3();
                box.getCenter(center);
                customGizmo.position.copy(center);
                customGizmo.visible = true; 
                gizmoState = 2; 
                canvas.style.cursor = 'default';
            } else { 
                customGizmo.visible = false; 
                gizmoState = 1; 
            }
            return;
        }

        if (!isSketchMode) return;

        sketchRaycaster.setFromCamera(sketchMouse, currentCreatorCamera);
        
        if (sketchState === 0) {
            const intersects = sketchRaycaster.intersectObjects(originPlanesGroup.children);
            if (intersects.length > 0) {
                selectPlane(intersects[0].object);
            }
        } else if (sketchState === 2) {
            // Выбор грани на 3D объекте
            const interactable = [];
            creatorScene.traverse(c => { if (c.isMesh && c !== snapMarker && !c.userData.isSketchPlane && !c.userData.isSketch) interactable.push(c); });
            const intersects = sketchRaycaster.intersectObjects(interactable, false);
            
            if (intersects.length > 0) {
                const intersect = intersects[0];
                const point = intersect.point;
                // Нормаль полигона в мировых координатах
                const normalMatrix = new THREE.Matrix3().getNormalMatrix(intersect.object.matrixWorld);
                let worldNormal = intersect.face.normal.clone().applyMatrix3(normalMatrix).normalize();
                
                const b1 = getNaturalPlaneBasis(worldNormal, creatorCamera);
                const b2 = getNaturalPlaneBasis(b1.up, creatorCamera);
                const b3 = getNaturalPlaneBasis(b1.right, creatorCamera);
                
                if (originPlanesGroup) {
                    creatorScene.remove(originPlanesGroup);
                }
                originPlanesGroup = new THREE.Group();

                const pGeo = new THREE.PlaneGeometry(200, 200);
                const edges = new THREE.EdgesGeometry(pGeo, showRadialEdges ? 1 : 15);
                const lMat = new THREE.LineBasicMaterial({ color: 0x3355CC, linewidth: 2 });

                const createLocalPlane = (color, n, u, r, name) => {
                    const mesh = new THREE.Mesh(pGeo, new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }));
                    mesh.add(new THREE.LineSegments(edges, lMat));
                    mesh.position.copy(point);
                    const matrix = new THREE.Matrix4();
                    matrix.makeBasis(r, u, n);
                    mesh.setRotationFromMatrix(matrix);
                    mesh.userData = { 
                        isSketchPlane: true, normal: n.clone(), look: point.clone().add(n.clone().multiplyScalar(500)), up: u.clone(), origin: point.clone(), name: name 
                    };
                    return mesh;
                };

                const p1 = createLocalPlane(0xE03030, b1.normal, b1.up, b1.right, "Face_XY");
                const p2 = createLocalPlane(0x5AAFDD, b2.normal, b2.up, b2.right, "Face_XZ");
                const p3 = createLocalPlane(0x3355CC, b3.normal, b3.up, b3.right, "Face_YZ");

                originPlanesGroup.add(p1, p2, p3);
                creatorScene.add(originPlanesGroup);
                
                sketchState = 0;
                if (typeof showToast === 'function') showToast("ЛКМ выберите локальную плоскость для эскиза");
            }
        } else if (sketchState === 1 && activeSketchPlane) {
            if (sketchTool === 'chamfer') {
                if (typeof window.handleChamferClick === 'function') {
                    window.handleChamferClick();
                }
            } else if (sketchTool === 'fillet') {
                if (typeof window.handleFilletClick === 'function') {
                    window.handleFilletClick();
                }
            } else if (sketchTool === 'mirror') {
                if (typeof window.handleMirrorClick === 'function') {
                    window.handleMirrorClick();
                }
            } else if (sketchTool === 'extend') {
                if (typeof handleTopologyClick === 'function') handleTopologyClick();
            } else if (sketchTool === 'trim') {
                const pt = getSketchPlaneIntersection(sketchRaycaster, activeSketchPlane);
                
                // Сначала пытаемся отработать клик по выделенному сегменту
                let handled = false;
                if (typeof handleTopologyClick === 'function') {
                    handled = handleTopologyClick();
                }
                
                // Иначе рисуем фантомную линию (fence trim)
                if (!handled && pt) {
                    let snappedPt = applySnapsAndOrtho(pt, true);
                    if (currentDrawPoints.length === 0) {
                        currentDrawPoints.push(snappedPt);
                    } else {
                        currentDrawPoints.push(snappedPt);
                        if (typeof handleFenceTrim === 'function') handleFenceTrim(currentDrawPoints[0], currentDrawPoints[1]);
                        currentDrawPoints = [];
                        if (tempShapePreview) tempShapePreview.visible = false;
                    }
                }
            } else {
                const pt = getSketchPlaneIntersection(sketchRaycaster, activeSketchPlane);
                if (pt) {
                    if (!sketchTool) {
                        if (typeof window.selectSketchPrimitiveAtPoint === 'function') {
                            window.selectSketchPrimitiveAtPoint(pt);
                        }
                    } else {
                        let snappedPt = applySnapsAndOrtho(pt, true);
                        if (sketchTool === 'rectangle' && currentDrawPoints.length === 1) {
                            snappedPt = getAdjustedRectPoint(snappedPt);
                        }
                        addSketchPoint(snappedPt);
                        resetTrackingDimState();
                        resetLineCadDimState();
                    }
                }
            }
        }
    });

    window.addEventListener('keydown', (e) => {
        if (window.flattenMode && e.key === 'Escape') {
            if (typeof window.exitFlattenMode === 'function') window.exitFlattenMode();
            return;
        }
        if (bendState > 0 && e.key === 'Escape') {
            cancelAllCommands();
            if (typeof showToast === 'function') showToast("Создание гиба отменено");
        }
        if (linkState > 0 && e.key === 'Escape') {
            linkState = 0;
            linkTargetRow = null;
            linkTargetBtn = null;
            setCreatorUIMode('default');
            if (typeof showToast === 'function') showToast("Привязка отменена");
        }
        if ((mateState > 0 || mateUnfoldedHelper) && e.key === 'Escape') {
            closeMateHelperBox();
            if (mateHighlightA) {
                creatorScene.remove(mateHighlightA);
                if (mateHighlightA.geometry) mateHighlightA.geometry.dispose();
                if (mateHighlightA.material) mateHighlightA.material.dispose();
                mateHighlightA = null;
            }
            if (mateHighlightB) {
                creatorScene.remove(mateHighlightB);
                if (mateHighlightB.geometry) mateHighlightB.geometry.dispose();
                if (mateHighlightB.material) mateHighlightB.material.dispose();
                mateHighlightB = null;
            }
            clearMateHighlightGroup();
            mateState = 0;
            mateObjectA = null;
            mateFaceA = null;
            mateObjectB = null;
            mateFaceB = null;
            setCreatorUIMode('default');
            if (window.setCreatorActiveTool) window.setCreatorActiveTool(null);
            if (sketchHudTooltip && !isSketchMode) {
                sketchHudTooltip.style.display = 'none';
                sketchHudTooltip.innerText = '';
            }
            if (typeof showToast === 'function') showToast("Слипание отменено");
            return;
        }
        if (gizmoState > 0 && e.key === 'Escape') {
            cancelAllCommands();
            if (typeof showToast === 'function') showToast("Гизмо отключен");
        }
        if (e.key === 'Escape' && !isSketchMode) {
            cancelAllCommands();
            return;
        }
        if (!isSketchMode) return;

        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (typeof selectedSketchSegment !== 'undefined' && selectedSketchSegment) {
                const idx = sketchSegments.indexOf(selectedSketchSegment);
                if (idx !== -1) sketchSegments.splice(idx, 1);
                if (typeof window.clearSketchSelection === 'function') window.clearSketchSelection();
                if (typeof window.rebuildSketchLines === 'function') window.rebuildSketchLines();
                if (typeof showToast === 'function') showToast("Отрезок удален");
                e.preventDefault();
                return;
            } else if (typeof selectedSketchCircle !== 'undefined' && selectedSketchCircle) {
                const idx = sketchCircles.indexOf(selectedSketchCircle);
                if (idx !== -1) sketchCircles.splice(idx, 1);
                if (typeof window.clearSketchSelection === 'function') window.clearSketchSelection();
                if (typeof window.rebuildSketchLines === 'function') window.rebuildSketchLines();
                if (typeof showToast === 'function') showToast("Окружность удалена");
                e.preventDefault();
                return;
            }
        }
        
        if (e.key === 'Escape') {
            if ((typeof selectedSketchSegment !== 'undefined' && selectedSketchSegment) || (typeof selectedSketchCircle !== 'undefined' && selectedSketchCircle)) {
                if (typeof window.clearSketchSelection === 'function') window.clearSketchSelection();
                return;
            }
            if (sketchTool === 'trim' || sketchTool === 'extend') {
                sketchTool = null;
                if (typeof trimExtendPreview !== 'undefined' && trimExtendPreview) {
                    trimExtendPreview.visible = false;
                }
                if (sketchHudTooltip) sketchHudTooltip.style.display = 'none';
            } else if (sketchTool === 'chamfer') {
                if (typeof window.cancelChamferUI === 'function') window.cancelChamferUI();
                setSketchTool(null);
            } else if (sketchTool === 'fillet') {
                if (typeof window.cancelFilletUI === 'function') window.cancelFilletUI();
                setSketchTool(null);
            } else if (sketchTool === 'mirror') {
                if (typeof window.resetMirrorState === 'function') window.resetMirrorState();
                setSketchTool(null);
            } else if (currentDrawPoints.length > 0) {
                if (sketchTool === 'arc' && currentDrawPoints.length === 2) {
                    currentDrawPoints.pop();
                    if (sketchHudTooltip) sketchHudTooltip.innerText = '[ Дуга: Укажите точку на дуге ]';
                } else {
                    currentDrawPoints = [];
                    if (tempShapePreview) tempShapePreview.visible = false;
                    if (sketchHudTooltip && sketchTool === 'arc') sketchHudTooltip.innerText = '[ Дуга: Укажите начало ]';
                }
            } else {
                setSketchTool(null);
            }
        }

        if (e.key === 'F8') {
            const cb = document.getElementById('sketch-ortho');
            if(cb) { cb.checked = !cb.checked; toggleOrtho(cb.checked); }
        }

        const hasTrackingContext = (typeof activeTrackingRays !== 'undefined' && activeTrackingRays && activeTrackingRays.length > 0) ||
                                   (typeof activeTrackingRay !== 'undefined' && activeTrackingRay && activeTrackingRay !== null) ||
                                   trackingActiveDim !== -1 || trackingLockedDist0 !== null || (trackingStr0 && trackingStr0 !== '');

        if (hasTrackingContext) {
            if (e.key === 'Tab') {
                e.preventDefault();
                e.stopPropagation();

                const numRays = (typeof activeTrackingRays !== 'undefined' && activeTrackingRays) ? activeTrackingRays.length : 1;
                if (trackingActiveDim === -1) {
                    trackingActiveDim = 0;
                    if (trackingLockedDist0 !== null && trackingStr0 === '') {
                        trackingStr0 = trackingLockedDist0.toString();
                    }
                } else if (trackingActiveDim === 0) {
                    if (trackingStr0.trim() !== '') {
                        const val = parseFloat(trackingStr0);
                        if (!isNaN(val) && val > 0) trackingLockedDist0 = val;
                        else trackingLockedDist0 = null;
                    } else {
                        if (activeSmartSnap && activeSmartSnap.point && activeTrackingRay) {
                            const curD = activeTrackingRay.origin.distanceTo(activeSmartSnap.point);
                            if (curD > 0.01) trackingLockedDist0 = Math.round(curD * 10) / 10;
                        }
                    }

                    if (numRays >= 2) {
                        trackingActiveDim = 1;
                        if (trackingLockedDist1 !== null && trackingStr1 === '') {
                            trackingStr1 = trackingLockedDist1.toString();
                        }
                    } else {
                        trackingActiveDim = 0;
                    }
                } else if (trackingActiveDim === 1) {
                    if (trackingStr1.trim() !== '') {
                        const val = parseFloat(trackingStr1);
                        if (!isNaN(val) && val > 0) trackingLockedDist1 = val;
                        else trackingLockedDist1 = null;
                    } else {
                        trackingLockedDist1 = null;
                    }

                    trackingActiveDim = 0;
                    if (trackingLockedDist0 !== null && trackingStr0 === '') {
                        trackingStr0 = trackingLockedDist0.toString();
                    }
                }

                if (lastMouseSketchPt && activeSketchPlane) {
                    applySnapsAndOrtho(lastMouseSketchPt, true);
                }
                updateSmartSnapHUD();
                if (lastMouseSketchPt) updateTempShape(lastMouseSketchPt);
                return;
            }

            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                if (trackingActiveDim === 0 && trackingStr0.trim() !== '') {
                    const val = parseFloat(trackingStr0);
                    if (!isNaN(val) && val > 0) trackingLockedDist0 = val;
                } else if (trackingActiveDim === 1 && trackingStr1.trim() !== '') {
                    const val = parseFloat(trackingStr1);
                    if (!isNaN(val) && val > 0) trackingLockedDist1 = val;
                }
                if (lastMouseSketchPt && activeSketchPlane) {
                    const snappedPt = applySnapsAndOrtho(lastMouseSketchPt, true);
                    addSketchPoint(snappedPt);
                    resetTrackingDimState();
                    resetLineCadDimState();
                }
                return;
            }

            if (e.key === 'Backspace') {
                e.preventDefault();
                e.stopPropagation();
                if (trackingActiveDim === 0) {
                    trackingStr0 = trackingStr0.slice(0, -1);
                    if (trackingStr0 === '') trackingLockedDist0 = null;
                    else {
                        const val = parseFloat(trackingStr0);
                        if (!isNaN(val) && val > 0) trackingLockedDist0 = val;
                    }
                } else if (trackingActiveDim === 1) {
                    trackingStr1 = trackingStr1.slice(0, -1);
                    if (trackingStr1 === '') trackingLockedDist1 = null;
                    else {
                        const val = parseFloat(trackingStr1);
                        if (!isNaN(val) && val > 0) trackingLockedDist1 = val;
                    }
                }
                if (lastMouseSketchPt && activeSketchPlane) {
                    applySnapsAndOrtho(lastMouseSketchPt, true);
                }
                updateSmartSnapHUD();
                if (lastMouseSketchPt) updateTempShape(lastMouseSketchPt);
                return;
            }

            if (e.key === 'Delete') {
                e.preventDefault();
                e.stopPropagation();
                if (trackingActiveDim === 0) {
                    trackingStr0 = '';
                    trackingLockedDist0 = null;
                } else if (trackingActiveDim === 1) {
                    trackingStr1 = '';
                    trackingLockedDist1 = null;
                }
                if (lastMouseSketchPt && activeSketchPlane) {
                    applySnapsAndOrtho(lastMouseSketchPt, true);
                }
                updateSmartSnapHUD();
                if (lastMouseSketchPt) updateTempShape(lastMouseSketchPt);
                return;
            }

            if (/^[0-9.,]$/.test(e.key)) {
                e.preventDefault();
                e.stopPropagation();
                const char = (e.key === ',' ? '.' : e.key);
                if (trackingActiveDim === -1) {
                    trackingActiveDim = 0;
                }
                if (trackingActiveDim === 0) {
                    if (char === '.' && trackingStr0.includes('.')) return;
                    trackingStr0 += char;
                    const val = parseFloat(trackingStr0);
                    if (!isNaN(val) && val > 0) trackingLockedDist0 = val;
                } else if (trackingActiveDim === 1) {
                    if (char === '.' && trackingStr1.includes('.')) return;
                    trackingStr1 += char;
                    const val = parseFloat(trackingStr1);
                    if (!isNaN(val) && val > 0) trackingLockedDist1 = val;
                }
                if (lastMouseSketchPt && activeSketchPlane) {
                    applySnapsAndOrtho(lastMouseSketchPt, true);
                }
                updateSmartSnapHUD();
                if (lastMouseSketchPt) updateTempShape(lastMouseSketchPt);
                return;
            }
        }

        if (sketchTool === 'rectangle' && currentDrawPoints.length === 1) {
            if (e.key === 'Tab') {
                e.preventDefault();
                e.stopPropagation();

                if (rectActiveDim === -1) {
                    rectActiveDim = 0; // select Width
                    if (rectLockedWidth !== null && rectWidthStr === '') {
                        rectWidthStr = rectLockedWidth.toString();
                    }
                } else if (rectActiveDim === 0) {
                    if (rectWidthStr.trim() !== '') {
                        const val = parseFloat(rectWidthStr);
                        if (!isNaN(val) && val > 0) {
                            rectLockedWidth = val;
                        } else {
                            rectLockedWidth = null;
                        }
                    } else {
                        rectLockedWidth = null;
                    }
                    rectActiveDim = 1; // move to Height
                    if (rectLockedHeight !== null && rectHeightStr === '') {
                        rectHeightStr = rectLockedHeight.toString();
                    }
                } else if (rectActiveDim === 1) {
                    if (rectHeightStr.trim() !== '') {
                        const val = parseFloat(rectHeightStr);
                        if (!isNaN(val) && val > 0) {
                            rectLockedHeight = val;
                        } else {
                            rectLockedHeight = null;
                        }
                    } else {
                        rectLockedHeight = null;
                    }
                    rectActiveDim = 0; // cycle back to Width
                    if (rectLockedWidth !== null && rectWidthStr === '') {
                        rectWidthStr = rectLockedWidth.toString();
                    }
                }

                updateRectDimensionHUD();
                if (lastMouseSketchPt) updateTempShape(lastMouseSketchPt);
                return;
            }

            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                if (rectActiveDim === 0 && rectWidthStr.trim() !== '') {
                    const val = parseFloat(rectWidthStr);
                    if (!isNaN(val) && val > 0) rectLockedWidth = val;
                } else if (rectActiveDim === 1 && rectHeightStr.trim() !== '') {
                    const val = parseFloat(rectHeightStr);
                    if (!isNaN(val) && val > 0) rectLockedHeight = val;
                }
                if (lastMouseSketchPt && activeSketchPlane) {
                    const p2 = getAdjustedRectPoint(lastMouseSketchPt);
                    addSketchPoint(p2);
                }
                return;
            }

            if (rectActiveDim !== -1) {
                if (e.key === 'Backspace') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (rectActiveDim === 0) {
                        rectWidthStr = rectWidthStr.slice(0, -1);
                        if (rectWidthStr === '') rectLockedWidth = null;
                    } else if (rectActiveDim === 1) {
                        rectHeightStr = rectHeightStr.slice(0, -1);
                        if (rectHeightStr === '') rectLockedHeight = null;
                    }
                    updateRectDimensionHUD();
                    if (lastMouseSketchPt) updateTempShape(lastMouseSketchPt);
                    return;
                }

                if (e.key === 'Delete') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (rectActiveDim === 0) {
                        rectWidthStr = '';
                        rectLockedWidth = null;
                    } else if (rectActiveDim === 1) {
                        rectHeightStr = '';
                        rectLockedHeight = null;
                    }
                    updateRectDimensionHUD();
                    if (lastMouseSketchPt) updateTempShape(lastMouseSketchPt);
                    return;
                }

                if (/^[0-9.,]$/.test(e.key)) {
                    e.preventDefault();
                    e.stopPropagation();
                    const char = (e.key === ',' ? '.' : e.key);
                    if (rectActiveDim === 0) {
                        if (char === '.' && rectWidthStr.includes('.')) return;
                        rectWidthStr += char;
                    } else if (rectActiveDim === 1) {
                        if (char === '.' && rectHeightStr.includes('.')) return;
                        rectHeightStr += char;
                    }
                    updateRectDimensionHUD();
                    if (lastMouseSketchPt) updateTempShape(lastMouseSketchPt);
                    return;
                }
            }
        }

        if (sketchTool === 'infiniline' && currentDrawPoints.length === 1) {
            if (e.key === 'Tab') {
                e.preventDefault();
                e.stopPropagation();

                if (lineFirstPointBaseSeg || lineFirstPointBaseCircle) {
                    lineAngleActiveDim = 1;
                } else {
                    lineAngleActiveDim = 0;
                }

                updateSmartSnapHUD();
                if (lastMouseSketchPt) updateTempShape(lastMouseSketchPt);
                return;
            }

            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();

                if (lineFirstPointBaseSeg || lineFirstPointBaseCircle) {
                    if (lineLockedOffset === null && lineOffsetStr.trim() !== '') {
                        const val = parseFloat(lineOffsetStr);
                        if (!isNaN(val)) lineLockedOffset = val;
                    }
                    if (lastMouseSketchPt && activeSketchPlane) {
                        const p2 = getAdjustedLinePoint(lastMouseSketchPt);
                        addSketchPoint(p2);
                    }
                } else {
                    if (lineAngleActiveDim === 0 && lineAngleStr.trim() !== '') {
                        const val = parseFloat(lineAngleStr);
                        if (!isNaN(val)) lineLockedAngle = val;
                    }
                    if (lastMouseSketchPt && activeSketchPlane) {
                        const p2 = getAdjustedLinePoint(lastMouseSketchPt);
                        addSketchPoint(p2);
                    }
                }
                return;
            }

            if (e.key === 'Backspace') {
                e.preventDefault();
                e.stopPropagation();

                if (lineFirstPointBaseSeg || lineFirstPointBaseCircle || lineAngleActiveDim === 1) {
                    lineOffsetStr = lineOffsetStr.slice(0, -1);
                    if (lineOffsetStr === '') lineLockedOffset = null;
                } else {
                    lineAngleStr = lineAngleStr.slice(0, -1);
                    if (lineAngleStr === '') lineLockedAngle = null;
                }

                updateSmartSnapHUD();
                if (lastMouseSketchPt) updateTempShape(lastMouseSketchPt);
                return;
            }

            if (e.key === 'Delete') {
                e.preventDefault();
                e.stopPropagation();

                if (lineFirstPointBaseSeg || lineFirstPointBaseCircle || lineAngleActiveDim === 1) {
                    lineOffsetStr = '';
                    lineLockedOffset = null;
                } else {
                    lineAngleStr = '';
                    lineLockedAngle = null;
                }

                updateSmartSnapHUD();
                if (lastMouseSketchPt) updateTempShape(lastMouseSketchPt);
                return;
            }

            if (/^[0-9.,-]$/.test(e.key)) {
                e.preventDefault();
                e.stopPropagation();
                const char = (e.key === ',' ? '.' : e.key);

                if (lineFirstPointBaseSeg || lineFirstPointBaseCircle || lineAngleActiveDim === 1) {
                    if (char === '.' && lineOffsetStr.includes('.')) return;
                    lineOffsetStr += char;
                    const val = parseFloat(lineOffsetStr);
                    if (!isNaN(val)) lineLockedOffset = val;
                } else {
                    if (char === '.' && lineAngleStr.includes('.')) return;
                    lineAngleStr += char;
                    const val = parseFloat(lineAngleStr);
                    if (!isNaN(val)) lineLockedAngle = val;
                }

                updateSmartSnapHUD();
                if (lastMouseSketchPt) updateTempShape(lastMouseSketchPt);
                return;
            }
        }

        if (sketchTool === 'line' && (lineHoverSegment || lineActiveDim !== -1)) {
            if (e.key === 'Tab') {
                e.preventDefault();
                e.stopPropagation();

                if (lineActiveDim === -1) {
                    lineActiveDim = 0;
                    if (lineLockedDist0 !== null && lineStr0 === '') {
                        lineStr0 = lineLockedDist0.toString();
                    }
                } else if (lineActiveDim === 0) {
                    if (lineStr0.trim() !== '') {
                        const val = parseFloat(lineStr0);
                        if (!isNaN(val) && val >= 0) lineLockedDist0 = val;
                        else lineLockedDist0 = null;
                    } else {
                        lineLockedDist0 = null;
                    }
                    lineActiveDim = 1;
                    if (lineLockedDist1 !== null && lineStr1 === '') {
                        lineStr1 = lineLockedDist1.toString();
                    }
                } else if (lineActiveDim === 1) {
                    if (lineStr1.trim() !== '') {
                        const val = parseFloat(lineStr1);
                        if (!isNaN(val) && val >= 0) lineLockedDist1 = val;
                        else lineLockedDist1 = null;
                    } else {
                        lineLockedDist1 = null;
                    }
                    lineActiveDim = 0;
                    if (lineLockedDist0 !== null && lineStr0 === '') {
                        lineStr0 = lineLockedDist0.toString();
                    }
                }

                updateLineSegCadDimensions();
                if (lastMouseSketchPt) updateTempShape(lastMouseSketchPt);
                return;
            }

            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                if (lineActiveDim === 0 && lineStr0.trim() !== '') {
                    const val = parseFloat(lineStr0);
                    if (!isNaN(val) && val >= 0) lineLockedDist0 = val;
                } else if (lineActiveDim === 1 && lineStr1.trim() !== '') {
                    const val = parseFloat(lineStr1);
                    if (!isNaN(val) && val >= 0) lineLockedDist1 = val;
                }
                if (lastMouseSketchPt && activeSketchPlane && lineHoverSegment) {
                    const p = getAdjustedLineSegmentPoint(lastMouseSketchPt);
                    addSketchPoint(p);
                    resetLineCadDimState();
                }
                return;
            }

            if (lineActiveDim !== -1) {
                if (e.key === 'Backspace') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (lineActiveDim === 0) {
                        lineStr0 = lineStr0.slice(0, -1);
                        if (lineStr0 === '') lineLockedDist0 = null;
                    } else if (lineActiveDim === 1) {
                        lineStr1 = lineStr1.slice(0, -1);
                        if (lineStr1 === '') lineLockedDist1 = null;
                    }
                    updateLineSegCadDimensions();
                    if (lastMouseSketchPt) updateTempShape(lastMouseSketchPt);
                    return;
                }

                if (e.key === 'Delete') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (lineActiveDim === 0) {
                        lineStr0 = '';
                        lineLockedDist0 = null;
                    } else if (lineActiveDim === 1) {
                        lineStr1 = '';
                        lineLockedDist1 = null;
                    }
                    updateLineSegCadDimensions();
                    if (lastMouseSketchPt) updateTempShape(lastMouseSketchPt);
                    return;
                }

                if (/^[0-9.,]$/.test(e.key)) {
                    e.preventDefault();
                    e.stopPropagation();
                    const char = (e.key === ',' ? '.' : e.key);
                    if (lineActiveDim === 0) {
                        if (char === '.' && lineStr0.includes('.')) return;
                        lineStr0 += char;
                    } else if (lineActiveDim === 1) {
                        if (char === '.' && lineStr1.includes('.')) return;
                        lineStr1 += char;
                    }
                    updateLineSegCadDimensions();
                    if (lastMouseSketchPt) updateTempShape(lastMouseSketchPt);
                    return;
                }
            }
        }
    });
}

window.applyBend = function() {
    if (typeof applyQuickBend === 'function' && typeof bendPhantoms !== 'undefined' && bendPhantoms.length > 0) {
        applyQuickBend();
        return;
    }
    if (bendState !== 2 || !bendHoverHighlight || !bendHoverHighlight.userData.sourceObject || !bendHoverHighlight.userData.edge) {
        if (typeof showToast === 'function') showToast("Сначала выберите кромку для гиба.");
        return;
    }
    const plateObject = bendHoverHighlight.userData.sourceObject;
    if (typeof window.isProfileObject === 'function' && window.isProfileObject(plateObject)) {
        if (typeof showToast === 'function') showToast("Гибка недоступна для объектов типа Профиль!");
        return;
    }
    const bendEdge = bendHoverHighlight.userData.edge;
    if (typeof window.buildSingleBendPhantom === 'function' && typeof window.applyQuickBend === 'function') {
        const phantom = window.buildSingleBendPhantom(plateObject, bendEdge, {});
        if (phantom) {
            if (typeof bendPhantoms === 'undefined') window.bendPhantoms = [];
            window.bendPhantoms = [phantom];
            window.applyQuickBend();
            if (typeof window.clearBendPhantoms === 'function') window.clearBendPhantoms();
            cancelAllCommands();
            return;
        }
    }
    performBend(plateObject, bendEdge);
    cancelAllCommands();
};

window.performBend = function(plateObject, bendEdge) {
    if (typeof window.isProfileObject === 'function' && window.isProfileObject(plateObject)) {
        if (typeof showToast === 'function') showToast("Гибка недоступна для объектов типа Профиль!");
        return;
    }
    const lenEl = document.getElementById('bend-length') || document.getElementById('qi-bend-length');
    const angleEl = document.getElementById('bend-angle') || document.getElementById('qi-bend-angle');
    const radEl = document.getElementById('bend-radius') || document.getElementById('qi-bend-radius');
    const length = parseFloat(lenEl ? lenEl.value : 100) || 100;
    const angleRad = THREE.MathUtils.degToRad(parseFloat(angleEl ? angleEl.value : 90) || 90);
    const radius = parseFloat(radEl ? radEl.value : 10) || 10;

    if (angleRad <= 0 || radius <= 0 || length <= 0) {
        if (typeof showToast === 'function') showToast("Параметры гиба должны быть больше нуля.");
        return;
    }

    const plateData = plateObject.userData.specData || {};
    const thickness = (plateData.t || plateData.th || plateData.thickness || plateData.wallThick || plateData.depth || 10) * (plateObject.scale.y || 1);
    
    // Get plate's local dimensions and orientation relative to bend edge
    const inversePlateMatrix = new THREE.Matrix4().copy(plateObject.matrixWorld).invert();
    const localBendV1 = bendEdge.v1.clone().applyMatrix4(inversePlateMatrix);
    const localBendV2 = bendEdge.v2.clone().applyMatrix4(inversePlateMatrix);
    const localBendEdgeDir = new THREE.Vector3().subVectors(localBendV2, localBendV1).normalize();

    let W_total; // Total width of the plate perpendicular to the bend line
    if (Math.abs(localBendEdgeDir.dot(new THREE.Vector3(1, 0, 0))) > 0.9) { // Bend edge is along local X
        W_total = plateData.l * plateObject.scale.z;
    } else if (Math.abs(localBendEdgeDir.dot(new THREE.Vector3(0, 0, 1))) > 0.9) { // Bend edge is along local Z
        W_total = plateData.w * plateObject.scale.x;
    } else {
        if (typeof showToast === 'function') showToast("Ошибка: Гиб должен быть вдоль одной из основных осей пластины.");
        return;
    }

    const flatStationaryLength = W_total - length;

    if (flatStationaryLength < 0) {
        if (typeof showToast === 'function') showToast("Длина неподвижной части не может быть отрицательной. Уменьшите длину подвижной части.");
        return;
    }

    // 1. Определяем оси и размеры
    const edgeDir = new THREE.Vector3().subVectors(bendEdge.v2, bendEdge.v1).normalize();
    const thickDir = (bendEdge.thicknessDir ? bendEdge.thicknessDir.clone() : bendEdge.faceNormal.clone().cross(edgeDir)).normalize();
    const bendNormal = thickDir.clone();
    const stationaryPartNormal = new THREE.Vector3().crossVectors(edgeDir, bendNormal).normalize();

    // 2. Создаем новую геометрию
    const vertices = [];
    const faces = [];
    const segments = 16; // Качество скругления
    
    // Helper to add a quad (two triangles)
    const addQuad = (v1, v2, v3, v4) => {
        const offset = vertices.length / 3;
        vertices.push(...v1, ...v2, ...v3, ...v4);
        faces.push(offset, offset + 1, offset + 2);
        faces.push(offset, offset + 2, offset + 3);
    };

    // Неподвижная часть: v1 и v2 находятся по центру торца (endFaceCenter)
    const midV1 = bendEdge.v1.clone();
    const midV2 = bendEdge.v2.clone();

    const p3_stat_top = midV2.clone().addScaledVector(bendNormal, thickness / 2); // Top bend line
    const p4_stat_top = midV1.clone().addScaledVector(bendNormal, thickness / 2); // Top bend line
    const p1_stat_top = p4_stat_top.clone().addScaledVector(stationaryPartNormal, flatStationaryLength);
    const p2_stat_top = p3_stat_top.clone().addScaledVector(stationaryPartNormal, flatStationaryLength);

    const p1_stat_bottom = p1_stat_top.clone().addScaledVector(bendNormal, -thickness);
    const p2_stat_bottom = p2_stat_top.clone().addScaledVector(bendNormal, -thickness);
    const p3_stat_bottom = p3_stat_top.clone().addScaledVector(bendNormal, -thickness);
    const p4_stat_bottom = p4_stat_top.clone().addScaledVector(bendNormal, -thickness);

    addQuad(p1_stat_top.toArray(), p2_stat_top.toArray(), p3_stat_top.toArray(), p4_stat_top.toArray()); // Top surface
    addQuad(p4_stat_bottom.toArray(), p3_stat_bottom.toArray(), p2_stat_bottom.toArray(), p1_stat_bottom.toArray()); // Bottom surface
    addQuad(p4_stat_top.toArray(), p3_stat_top.toArray(), p3_stat_bottom.toArray(), p4_stat_bottom.toArray()); // Side 1 (bend line)
    addQuad(p1_stat_bottom.toArray(), p1_stat_top.toArray(), p2_stat_top.toArray(), p2_stat_bottom.toArray()); // Side 2 (outer edge)

    // Гиб
    // The bend arc center (in the plane perpendicular to edgeDir)
    const bendArcCenter = bendEdge.v1.clone().addScaledVector(bendNormal, -radius);

    let currentInnerPoint = bendEdge.v1.clone(); // Point on the inner surface at the start of the bend
    let currentOuterPoint = bendEdge.v1.clone().addScaledVector(bendNormal, -thickness); // Point on the outer surface at the start of the bend

    // Points along the other side of the bend edge
    const edgeOffset = new THREE.Vector3().subVectors(bendEdge.v2, bendEdge.v1);
    let currentInnerPoint_otherSide = currentInnerPoint.clone().add(edgeOffset);
    let currentOuterPoint_otherSide = currentOuterPoint.clone().add(edgeOffset);

    for (let i = 1; i <= segments; i++) {
        const theta = (angleRad / segments) * i;
        const q = new THREE.Quaternion().setFromAxisAngle(edgeDir, theta);
        
        const nextInnerPoint = currentInnerPoint.clone().sub(bendArcCenter).applyQuaternion(q).add(bendArcCenter);
        const nextOuterPoint = currentOuterPoint.clone().sub(bendArcCenter).applyQuaternion(q).add(bendArcCenter);
        
        const nextInnerPoint_otherSide = nextInnerPoint.clone().add(edgeOffset);
        const nextOuterPoint_otherSide = nextOuterPoint.clone().add(edgeOffset);

        // Top surface of bend segment
        addQuad(currentInnerPoint.toArray(), currentInnerPoint_otherSide.toArray(), nextInnerPoint_otherSide.toArray(), nextInnerPoint.toArray());
        // Bottom surface of bend segment
        addQuad(nextOuterPoint.toArray(), nextOuterPoint_otherSide.toArray(), currentOuterPoint_otherSide.toArray(), currentOuterPoint.toArray());
        // Inner side of bend segment
        addQuad(currentInnerPoint.toArray(), nextInnerPoint.toArray(), nextOuterPoint.toArray(), currentOuterPoint.toArray());
        // Outer side of bend segment
        addQuad(nextInnerPoint_otherSide.toArray(), currentInnerPoint_otherSide.toArray(), currentOuterPoint_otherSide.toArray(), nextOuterPoint_otherSide.toArray());

        currentInnerPoint = nextInnerPoint;
        currentOuterPoint = nextOuterPoint;
        currentInnerPoint_otherSide = nextInnerPoint_otherSide;
        currentOuterPoint_otherSide = nextOuterPoint_otherSide;
    }

    // Подвижная часть
    const finalDir = stationaryPartNormal.clone().applyAxisAngle(edgeDir, angleRad);
    const Rout_bend = radius + thickness;
    const bendDeduction_bend = Rout_bend * Math.tan(angleRad / 2);
    const straightLength_bend = Math.max(1.0, length - bendDeduction_bend);
    
    const p1_mov_top = currentInnerPoint;
    const p2_mov_top = currentInnerPoint_otherSide;
    const p3_mov_top = p2_mov_top.clone().addScaledVector(finalDir, straightLength_bend);
    const p4_mov_top = p1_mov_top.clone().addScaledVector(finalDir, straightLength_bend);

    const p1_mov_bottom = currentOuterPoint;
    const p2_mov_bottom = currentOuterPoint_otherSide;
    const p3_mov_bottom = p2_mov_bottom.clone().addScaledVector(finalDir, straightLength_bend);
    const p4_mov_bottom = p1_mov_bottom.clone().addScaledVector(finalDir, straightLength_bend);

    addQuad(p1_mov_top.toArray(), p2_mov_top.toArray(), p3_mov_top.toArray(), p4_mov_top.toArray()); // Top surface
    addQuad(p4_mov_bottom.toArray(), p3_mov_bottom.toArray(), p2_mov_bottom.toArray(), p1_mov_bottom.toArray()); // Bottom surface
    addQuad(p1_mov_top.toArray(), p4_mov_top.toArray(), p4_mov_bottom.toArray(), p1_mov_bottom.toArray()); // Side 1 (inner edge)
    addQuad(p3_mov_top.toArray(), p2_mov_top.toArray(), p2_mov_bottom.toArray(), p3_mov_bottom.toArray()); // Side 2 (outer edge)

    const newGeo = new THREE.BufferGeometry();
    newGeo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    newGeo.setIndex(faces);
    newGeo.computeVertexNormals();

    const newMesh = new THREE.Mesh(newGeo, plateObject.material.clone());
    newMesh.castShadow = true;
    newMesh.position.copy(plateObject.position); // Inherit position
    newMesh.quaternion.copy(plateObject.quaternion); // Inherit rotation
    newMesh.receiveShadow = true;
    newMesh.userData = { 
        ...plateObject.userData, 
        hasBends: true,
        specData: { 
            ...plateData,
            type: 'bent_plate', 
            name: `Гиб ${plateData.t || 10}x${W_total} L${length} R${radius}`,
            t: plateData.t || 10,
            th: plateData.t || 10,
            thickness: plateData.t || 10,
            wallThick: plateData.t || 10,
            depth: plateData.t || 10
        } 
    };
    if (typeof window.handleMeshModification === 'function') {
        window.handleMeshModification(newMesh);
    } else {
        addPartToSpec(`Гиб ${plateData.t}x${W_total} L${length} R${radius}`, newMesh);
    }

    disposeHierarchy(plateObject);
    creatorScene.add(newMesh);
    if (typeof showToast === 'function') showToast("Гиб успешно создан!");
}

function selectPlane(planeMesh) {
    activeSketchPlane = planeMesh;
    sketchState = 1;
    isSketchMode = true;
    if (typeof cancelGizmo === 'function') cancelGizmo();
    if (typeof customGizmo !== 'undefined' && customGizmo) customGizmo.visible = false;
    sketchGroup = new THREE.Group();
    creatorScene.add(sketchGroup);

    recomputeSketchCenters();

    if (!tempShapePreview) {
        const geometry = new THREE.BufferGeometry();
        // Выделяем достаточно вершин для любого примитива (окружность/дуга требуют больше всего)
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(256 * 3), 3));
        tempShapePreview = new THREE.Line(geometry, phantomMaterial);
        tempShapePreview.frustumCulled = false;
        creatorScene.add(tempShapePreview);
    }
    
    if (originPlanesGroup) originPlanesGroup.children.forEach(c => { if(c !== planeMesh) c.visible = false; });
    planeMesh.material.opacity = 0.05; // Делаем прозрачнее
    
    // Добавляем сетку для удобства черчения (бесконечный охват с динамическим смещением)
    const gridHelper = new THREE.GridHelper(50000, 5000, 0x3355CC, 0xCBD5E1);
    gridHelper.rotation.x = Math.PI / 2;
    if (gridHelper.material) gridHelper.material.depthWrite = false;
    planeMesh.add(gridHelper);
    planeMesh.userData.gridHelper = gridHelper;

    // Устанавливаем видимость сетки и состояние кнопки в соответствии с глобальными переменными
    gridHelper.visible = isGridVisible;
    const gridBtn = sketchRadialMenu?.querySelector('#sketch-radial-toggle-grid');
    if (gridBtn) gridBtn.classList.toggle('toggle-active', isGridVisible);

    const snapPointsBtn = sketchRadialMenu?.querySelector('#sketch-radial-toggle-snap-points');
    if (snapPointsBtn) snapPointsBtn.classList.toggle('toggle-active', isSnapPointsEnabled);

    const snapTopologyBtn = sketchRadialMenu?.querySelector('#sketch-radial-toggle-snap-topology');
    if (snapTopologyBtn) snapTopologyBtn.classList.toggle('toggle-active', isSnapTopologyEnabled);

    const snapExtensionBtn = sketchRadialMenu?.querySelector('#sketch-radial-toggle-snap-extension');
    if (snapExtensionBtn) snapExtensionBtn.classList.toggle('toggle-active', isSnapExtensionEnabled);

    const targetPos = new THREE.Vector3();
    planeMesh.getWorldPosition(targetPos);

    let normal = planeMesh.userData.normal ? planeMesh.userData.normal.clone() : new THREE.Vector3(0, 0, 1);
    let up = planeMesh.userData.up ? planeMesh.userData.up.clone() : new THREE.Vector3(0, 1, 0);

    const lookDir = targetPos.clone().add(normal.clone().multiplyScalar(500));
    
    currentCreatorCamera = creatorOrthoCamera;
    creatorControls.object = currentCreatorCamera;
    creatorControls.enableDamping = false; // Отключаем инерцию для 2D-режима, чтобы остановить любое движение
    creatorControls.enableRotate = false;
    creatorControls.target.copy(targetPos);

    creatorControls.update();

    creatorOrthoCamera.position.copy(lookDir);
    creatorOrthoCamera.up.copy(up);
    creatorOrthoCamera.lookAt(targetPos);
    creatorOrthoCamera.zoom = 2.0;
    creatorOrthoCamera.updateProjectionMatrix();

    creatorControls.update();

    setCreatorUIMode('sketch-draw');
    setSketchTool('line');

    if (typeof window.updateExtrudePhantom === 'function') {
        window.updateExtrudePhantom();
    }
}

// ==========================================
// СИСТЕМА ИНТЕЛЛЕКТУАЛЬНЫХ ПРИВЯЗОК (SMART SNAPS 2.0)
// ==========================================

function getSnapSVG(type, colorClass) {
    let stroke = '#10B981';
    let fill = 'rgba(16,185,129,0.2)';
    if (colorClass === 'orange') {
        stroke = '#F59E0B';
        fill = 'rgba(245,158,11,0.2)';
    } else if (colorClass === 'blue') {
        stroke = '#2563EB';
        fill = 'rgba(37,99,235,0.2)';
    } else if (colorClass === 'red') {
        stroke = '#DC2626';
        fill = 'rgba(220,38,38,0.2)';
    } else if (colorClass === 'green') {
        stroke = '#16A34A';
        fill = 'rgba(22,163,74,0.2)';
    }
    switch (type) {
        case 'quadrant':
            return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><polygon points="12,2 22,12 12,22 2,12" fill="${fill}" stroke="${stroke}" stroke-width="3" stroke-linejoin="round"/></svg>`;
        case 'endpoint':
            return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" fill="${fill}" stroke="${stroke}" stroke-width="3.5"/></svg>`;
        case 'midpoint':
            return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><polygon points="12,3 22,20 2,20" fill="${fill}" stroke="${stroke}" stroke-width="3.5" stroke-linejoin="round"/></svg>`;
        case 'nearest':
            return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4,4 L20,20 L20,4 L4,20 Z" fill="${fill}" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
        case 'perpendicular':
            return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3,20 L21,20 M12,20 L12,4" stroke="${stroke}" stroke-width="3.5" stroke-linecap="round"/></svg>`;
        case 'intersection':
            return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><line x1="4" y1="4" x2="20" y2="20" stroke="${stroke}" stroke-width="3.5" stroke-linecap="round"/><line x1="20" y1="4" x2="4" y2="20" stroke="${stroke}" stroke-width="3.5" stroke-linecap="round"/></svg>`;
        case 'center':
            return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/><line x1="12" y1="2" x2="12" y2="22" stroke="${stroke}" stroke-width="2"/><line x1="2" y1="12" x2="22" y2="12" stroke="${stroke}" stroke-width="2"/></svg>`;
        case 'tracking':
            return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" stroke="${stroke}" stroke-width="2" stroke-dasharray="2 2"/><line x1="12" y1="3" x2="12" y2="21" stroke="${stroke}" stroke-width="1.5"/><line x1="3" y1="12" x2="21" y2="12" stroke="${stroke}" stroke-width="1.5"/></svg>`;
        default:
            return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="6" fill="${fill}" stroke="${stroke}" stroke-width="3"/></svg>`;
    }
}

let cachedSketchIntersections = null;
let sketchIntersectionsDirty = true;

function invalidateSketchIntersectionsCache() {
    sketchIntersectionsDirty = true;
    cachedSketchIntersections = null;
}
window.invalidateSketchIntersectionsCache = invalidateSketchIntersectionsCache;

let cachedSketchSolids = null;
let sketchSolidsDirty = true;

function invalidateSketchSolidsCache() {
    sketchSolidsDirty = true;
    cachedSketchSolids = null;
}
window.invalidateSketchSolidsCache = invalidateSketchSolidsCache;

function recomputeSketchCenters() {
    sketchCenters = [];
    if (!activeSketchPlane) return;

    const origin = (activeSketchPlane.userData && activeSketchPlane.userData.origin) 
        ? activeSketchPlane.userData.origin.clone() 
        : activeSketchPlane.position.clone();
    sketchCenters.push({ type: 'center', point: origin, label: 'Начало координат (0,0)' });

    if (sketchCircles && sketchCircles.length > 0) {
        const up = activeSketchPlane.userData.up ? activeSketchPlane.userData.up.clone().normalize() : new THREE.Vector3(0, 1, 0);
        const normal = activeSketchPlane.userData.normal ? activeSketchPlane.userData.normal.clone().normalize() : new THREE.Vector3(0, 0, 1);
        const right = new THREE.Vector3().crossVectors(up, normal).normalize();

        sketchCircles.forEach(c => {
            if (c && c.center) {
                // 1. Центр окружности
                sketchCenters.push({ type: 'center', point: c.center.clone(), label: 'Центр окружности' });

                // 2. 4 контрольные точки окружности (квадранты: сверху, снизу, справа, слева)
                if (c.radius > 0) {
                    sketchCenters.push({ type: 'quadrant', point: c.center.clone().add(up.clone().multiplyScalar(c.radius)), label: 'Верхняя точка окружности' });
                    sketchCenters.push({ type: 'quadrant', point: c.center.clone().add(up.clone().multiplyScalar(-c.radius)), label: 'Нижняя точка окружности' });
                    sketchCenters.push({ type: 'quadrant', point: c.center.clone().add(right.clone().multiplyScalar(c.radius)), label: 'Правая точка окружности' });
                    sketchCenters.push({ type: 'quadrant', point: c.center.clone().add(right.clone().multiplyScalar(-c.radius)), label: 'Левая точка окружности' });
                }
            }
        });
    }

    if (sketchSegments && sketchSegments.length >= 3 && sketchSegments.length <= 150) {
        const seenMap = new Map();
        const pts = [];
        sketchSegments.forEach(s => {
            const k1 = `${Math.round(s.start.x * 100)},${Math.round(s.start.y * 100)},${Math.round(s.start.z * 100)}`;
            const k2 = `${Math.round(s.end.x * 100)},${Math.round(s.end.y * 100)},${Math.round(s.end.z * 100)}`;
            if (!seenMap.has(k1)) { seenMap.set(k1, true); pts.push(s.start.clone()); }
            if (!seenMap.has(k2)) { seenMap.set(k2, true); pts.push(s.end.clone()); }
        });
        if (pts.length >= 3) {
            const centroid = new THREE.Vector3();
            pts.forEach(p => centroid.add(p));
            centroid.divideScalar(pts.length);
            sketchCenters.push({ type: 'center', point: centroid, label: 'Центроид' });
        }
    }

    if (typeof sketchArcCenters !== 'undefined' && sketchArcCenters && sketchArcCenters.length > 0) {
        sketchArcCenters.forEach(ac => {
            sketchCenters.push({ type: 'center', point: ac.clone(), label: 'Центр дуги' });
        });
    }
}
window.recomputeSketchCenters = recomputeSketchCenters;

function projectPointToSketchPlane(p3d) {
    if (!activeSketchPlane) return p3d.clone();
    const normal = activeSketchPlane.userData.normal ? activeSketchPlane.userData.normal.clone().normalize() : new THREE.Vector3(0, 0, 1);
    const origin = (activeSketchPlane.userData && activeSketchPlane.userData.origin) ? activeSketchPlane.userData.origin.clone() : activeSketchPlane.position.clone();
    const diff = p3d.clone().sub(origin);
    const dist = diff.dot(normal);
    return p3d.clone().sub(normal.clone().multiplyScalar(dist));
}

function getAllSketchIntersections() {
    if (!activeSketchPlane) return [];
    if (!sketchIntersectionsDirty && cachedSketchIntersections !== null) {
        return cachedSketchIntersections;
    }

    const intersections = [];

    const up = activeSketchPlane.userData.up ? activeSketchPlane.userData.up.clone().normalize() : new THREE.Vector3(0, 1, 0);
    const normal = activeSketchPlane.userData.normal ? activeSketchPlane.userData.normal.clone().normalize() : new THREE.Vector3(0, 0, 1);
    const right = new THREE.Vector3().crossVectors(up, normal).normalize();
    const origin = (activeSketchPlane.userData && activeSketchPlane.userData.origin) ? activeSketchPlane.userData.origin.clone() : activeSketchPlane.position.clone();

    function to2D(p3d) {
        const diff = p3d.clone().sub(origin);
        return { u: diff.dot(right), v: diff.dot(up) };
    }

    function to3D(u, v) {
        return origin.clone().add(right.clone().multiplyScalar(u)).add(up.clone().multiplyScalar(v));
    }

    const segs = (sketchSegments || []).slice();
    if (window.activeMirrorLines && window.activeMirrorLines.length > 0) {
        window.activeMirrorLines.forEach(axis => {
            if (axis && axis.pt1 && axis.pt2) {
                segs.push({ start: axis.pt1, end: axis.pt2, isInfinite: true });
            }
        });
    }
    const circs = sketchCircles || [];

    // Bounding-box acceleration and pre-projecting 2D coordinates
    const segs2D = segs.map(s => {
        const a2d = to2D(s.start);
        const b2d = to2D(s.end);
        return {
            s: s,
            a2d: a2d,
            b2d: b2d,
            minU: Math.min(a2d.u, b2d.u),
            maxU: Math.max(a2d.u, b2d.u),
            minV: Math.min(a2d.v, b2d.v),
            maxV: Math.max(a2d.v, b2d.v)
        };
    });
    const circs2D = circs.map(c => ({
        c: c,
        center2d: (c && c.center) ? to2D(c.center) : null
    }));

    // 1. Отрезки и Бесконечные линии между собой (с Bounding Box отсечением)
    for (let i = 0; i < segs2D.length; i++) {
        for (let j = i + 1; j < segs2D.length; j++) {
            const item1 = segs2D[i];
            const item2 = segs2D[j];
            const s1 = item1.s, s2 = item2.s;

            if (!s1.isInfinite && !s2.isInfinite) {
                if (item1.maxU < item2.minU - 1e-4 || item1.minU > item2.maxU + 1e-4 ||
                    item1.maxV < item2.minV - 1e-4 || item1.minV > item2.maxV + 1e-4) {
                    continue;
                }
            }

            const a2d = item1.a2d, b2d = item1.b2d;
            const c2d = item2.a2d, d2d = item2.b2d;

            const res = typeof window.intersect2DLines === 'function' ? window.intersect2DLines(a2d, b2d, c2d, d2d) : null;
            if (res) {
                const { ta, tb } = res;
                const validA = s1.isInfinite || (ta >= -1e-4 && ta <= 1.0001);
                const validB = s2.isInfinite || (tb >= -1e-4 && tb <= 1.0001);
                if (validA && validB) {
                    const u = a2d.u + ta * (b2d.u - a2d.u);
                    const v = a2d.v + ta * (b2d.v - a2d.v);
                    intersections.push(to3D(u, v));
                }
            }
        }
    }

    // 2. Отрезки и Бесконечные линии с Окружностями
    for (let i = 0; i < segs2D.length; i++) {
        for (let j = 0; j < circs2D.length; j++) {
            const s = segs2D[i].s;
            const a2d = segs2D[i].a2d, b2d = segs2D[i].b2d;
            const c = circs2D[j].c;
            const cCenter2d = circs2D[j].center2d;
            if (!c || !cCenter2d || !c.radius) continue;

            const hits = typeof window.getCircleLineIntersections === 'function' ? window.getCircleLineIntersections(cCenter2d, c.radius, a2d, b2d) : [];
            hits.forEach(hit => {
                if (s.isInfinite || (hit.tLine >= -1e-4 && hit.tLine <= 1.0001)) {
                    intersections.push(to3D(hit.pt2d.u, hit.pt2d.v));
                }
            });
        }
    }

    // 3. Окружности с Окружностями
    for (let i = 0; i < circs2D.length; i++) {
        for (let j = i + 1; j < circs2D.length; j++) {
            const item1 = circs2D[i], item2 = circs2D[j];
            const c1 = item1.c, c2 = item2.c;
            const c12d = item1.center2d, c22d = item2.center2d;
            if (!c1 || !c2 || !c12d || !c22d) continue;

            const hits = typeof window.getCircleCircleIntersections === 'function' ? window.getCircleCircleIntersections(c12d, c1.radius, c22d, c2.radius) : [];
            hits.forEach(hit => {
                intersections.push(to3D(hit.pt2d.u, hit.pt2d.v));
            });
        }
    }

    cachedSketchIntersections = intersections;
    sketchIntersectionsDirty = false;
    return cachedSketchIntersections;
}

function findSegmentAtPoint(p) {
    if (!sketchSegments || sketchSegments.length === 0 || !p) return null;
    let bestSeg = null;
    let minDist = 0.25;
    for (let i = 0; i < sketchSegments.length; i++) {
        const seg = sketchSegments[i];
        const v = seg.end.clone().sub(seg.start);
        const len = v.length();
        if (len < 1e-6) continue;
        const u = v.clone().divideScalar(len);
        const proj = p.clone().sub(seg.start).dot(u);

        let d = 999;
        if (seg.isInfinite) {
            const ptProj = seg.start.clone().add(u.clone().multiplyScalar(proj));
            d = p.distanceTo(ptProj);
        } else if (proj >= -0.05 && proj <= len + 0.05) {
            const ptProj = seg.start.clone().add(u.clone().multiplyScalar(proj));
            d = p.distanceTo(ptProj);
        }
        if (d < minDist) {
            minDist = d;
            bestSeg = seg;
        }
    }
    return bestSeg;
}

function findCircleAtPoint(p) {
    if (!sketchCircles || sketchCircles.length === 0 || !p) return null;
    let bestCircle = null;
    let minDist = 25.0; // порог захвата круга
    for (let i = 0; i < sketchCircles.length; i++) {
        const c = sketchCircles[i];
        if (!c || !c.center) continue;
        const distCenter = p.distanceTo(c.center);
        const distEdge = Math.abs(distCenter - c.radius);
        if (distEdge < minDist || distCenter < minDist) {
            minDist = Math.min(distEdge, distCenter);
            bestCircle = c;
        }
    }
    return bestCircle;
}

function calculate3PointArc(p1, p2, p3, segments = 50) {
    const D = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
    
    // Если точки лежат на одной прямой — возвращаем отрезок
    if (Math.abs(D) < 1e-5 || p1.distanceTo(p2) < 1e-3 || p2.distanceTo(p3) < 1e-3 || p1.distanceTo(p3) < 1e-3) {
        return [p1.clone(), p3.clone()];
    }

    // 1. Вычисление центра C(xc, yc)
    const p1Sq = p1.x * p1.x + p1.y * p1.y;
    const p2Sq = p2.x * p2.x + p2.y * p2.y;
    const p3Sq = p3.x * p3.x + p3.y * p3.y;

    const xc = (p1Sq * (p2.y - p3.y) + p2Sq * (p3.y - p1.y) + p3Sq * (p1.y - p2.y)) / D;
    const yc = (p1Sq * (p3.x - p2.x) + p2Sq * (p1.x - p3.x) + p3Sq * (p2.x - p1.x)) / D;
    const center = new THREE.Vector2(xc, yc);

    // 2. Радиус и полярные углы
    const radius = center.distanceTo(p1);
    let a1 = Math.atan2(p1.y - yc, p1.x - xc);
    let a2 = Math.atan2(p2.y - yc, p2.x - xc);
    let a3 = Math.atan2(p3.y - yc, p3.x - xc);

    // 3. Определение направления (CCW / CW)
    const cross = (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
    const counterClockwise = cross > 0;

    // Нормализация углов для правильного построения дуги от a1 до a3 через a2
    if (!counterClockwise) {
        if (a1 < a3) a1 += 2 * Math.PI;
        if (a2 < a3) a2 += 2 * Math.PI;
        if (a1 < a2) a1 += 2 * Math.PI;
    } else {
        if (a3 < a1) a3 += 2 * Math.PI;
        if (a2 < a1) a2 += 2 * Math.PI;
        if (a3 < a2) a3 += 2 * Math.PI;
    }

    // 4. Генерация точек дуги
    const points = [];
    const angleStep = (a3 - a1) / segments;

    for (let i = 0; i <= segments; i++) {
        const angle = a1 + i * angleStep;
        points.push(new THREE.Vector2(
            xc + radius * Math.cos(angle),
            yc + radius * Math.sin(angle)
        ));
    }

    return points;
}

function getAdjustedLinePoint(cursorPt) {
    if (sketchTool !== 'infiniline' || currentDrawPoints.length !== 1 || !activeSketchPlane || !cursorPt) return cursorPt;
    const p1 = currentDrawPoints[0];

    const up = activeSketchPlane.userData.up ? activeSketchPlane.userData.up.clone().normalize() : new THREE.Vector3(0, 1, 0);
    const normal = activeSketchPlane.userData.normal ? activeSketchPlane.userData.normal.clone().normalize() : new THREE.Vector3(0, 0, 1);
    const right = new THREE.Vector3().crossVectors(up, normal).normalize();

    let finalPt = cursorPt.clone();

    // 1. Подобие (Parallel Offset) только для Прямой (infiniline)
    if (sketchTool === 'infiniline' && lineFirstPointBaseSeg) {
        const seg = lineFirstPointBaseSeg;
        const segDir = seg.end.clone().sub(seg.start).normalize();
        const segPerp = new THREE.Vector3().crossVectors(segDir, normal).normalize();

        let offsetVal = lineLockedOffset;
        if (offsetVal === null && lineOffsetStr.trim() !== '') {
            const parsed = parseFloat(lineOffsetStr);
            if (!isNaN(parsed)) offsetVal = parsed;
        }

        const vCursor = cursorPt.clone().sub(p1);
        let side = Math.sign(vCursor.dot(segPerp));
        if (side === 0) side = 1;

        if (offsetVal === null) {
            offsetVal = Math.abs(vCursor.dot(segPerp));
        }

        const originParallel = p1.clone().add(segPerp.clone().multiplyScalar(offsetVal * side));
        return originParallel.clone().add(segDir.clone().multiplyScalar(10.0));
    }

    // 2. Угол
    let angleVal = lineLockedAngle;
    if (angleVal === null && lineAngleStr.trim() !== '') {
        const parsed = parseFloat(lineAngleStr);
        if (!isNaN(parsed)) angleVal = parsed;
    }

    const v = cursorPt.clone().sub(p1);
    const x = v.dot(right);
    const y = v.dot(up);
    const dist = Math.hypot(x, y);

    let deg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;

    if (angleVal !== null) {
        deg = angleVal;
    } else if (isSnapExtensionEnabled || isSnapPointsEnabled) {
        const snapDeg = Math.round(deg / 15) * 15 % 360;
        let diff = Math.abs(deg - snapDeg);
        if (diff > 180) diff = 360 - diff;
        if (diff < 5) {
            deg = snapDeg;
        }
    }

    const rad = deg * Math.PI / 180;
    const dir = right.clone().multiplyScalar(Math.cos(rad)).add(up.clone().multiplyScalar(Math.sin(rad)));

    finalPt = p1.clone().add(dir.multiplyScalar(Math.max(dist, 0.1)));
    return finalPt;
}

function getSnapThresholdWorld() {
    const canvas = creatorRenderer ? creatorRenderer.domElement : null;
    const h = canvas ? canvas.clientHeight : 600;
    const zoom = (currentCreatorCamera && currentCreatorCamera.isOrthographicCamera) ? (currentCreatorCamera.zoom || 1) : 1;
    return Math.max(0.8, (15 / (h / 400)) / zoom);
}

function evaluateSmartSnap(cursorPt) {
    if (!activeSketchPlane || !isSnapEnabled || !currentCreatorCamera) return null;

    const canvas = creatorRenderer ? creatorRenderer.domElement : null;
    const w = canvas ? canvas.clientWidth : 800;
    const h = canvas ? canvas.clientHeight : 600;

    const mousePx = {
        x: (sketchMouse.x * 0.5 + 0.5) * w,
        y: (-sketchMouse.y * 0.5 + 0.5) * h
    };

    function getPxDist(pt3d) {
        if (!pt3d) return 999999;
        const pr = pt3d.clone().project(currentCreatorCamera);
        if (pr.z < -1 || pr.z > 1) return 999999;
        const px = (pr.x * 0.5 + 0.5) * w;
        const py = (-pr.y * 0.5 + 0.5) * h;
        return Math.hypot(px - mousePx.x, py - mousePx.y);
    }

    function isNearCenter(pt) {
        if (!sketchCenters || sketchCenters.length === 0) return false;
        return sketchCenters.some(c => c.point.distanceTo(pt) < 0.001);
    }

    // 0. Приоритет: Привязка к активным осям зеркала и фантому
    if (isSnapPointsEnabled) {
        if (window.activeMirrorLines && window.activeMirrorLines.length > 0) {
            let bestMpt = null;
            let bestMType = '';
            let bestMLabel = '';
            let minMPx = 22;

            window.activeMirrorLines.forEach(axis => {
                if (!axis || !axis.pt1 || !axis.pt2) return;
                // Концы оси
                [axis.pt1, axis.pt2].forEach(pt => {
                    const dPx = getPxDist(pt);
                    if (dPx < minMPx) {
                        minMPx = dPx;
                        bestMpt = pt;
                        bestMType = 'endpoint';
                        bestMLabel = 'Конец зеркала';
                    }
                });
                // Середина оси
                const mid = axis.pt1.clone().add(axis.pt2).multiplyScalar(0.5);
                const dMidPx = getPxDist(mid);
                if (dMidPx < minMPx) {
                    minMPx = dMidPx;
                    bestMpt = mid;
                    bestMType = 'midpoint';
                    bestMLabel = 'Середина зеркала';
                }
            });

            if (bestMpt) {
                return { point: bestMpt.clone(), type: bestMType, color: 'blue', label: bestMLabel };
            }
        }

        if (typeof sketchTool !== 'undefined' && sketchTool === 'mirror' && typeof mirrorPhase !== 'undefined' && mirrorPhase === 2 && typeof mirrorAxisPt1 !== 'undefined' && mirrorAxisPt1) {
            const d1Px = getPxDist(mirrorAxisPt1);
            if (d1Px < 22) {
                return { point: mirrorAxisPt1.clone(), type: 'endpoint', color: 'red', label: 'Первая точка оси' };
            }

            if (typeof activeSketchPlane !== 'undefined' && activeSketchPlane && typeof reflectPoint2D === 'function' && typeof selectedMirrorSegments !== 'undefined' && typeof selectedMirrorCircles !== 'undefined') {
                const basis = window.getPlaneBasis(activeSketchPlane);
                const a2d = window.project3Dto2D(mirrorAxisPt1, basis);
                const b2d = window.project3Dto2D(cursorPt, basis);

                let bestPhantomPt = null;
                let phantomLabel = '';
                let minPhantomPx = 22;

                selectedMirrorSegments.forEach(seg => {
                    if (!seg || !seg.start || !seg.end) return;
                    const p1_2d = window.project3Dto2D(seg.start, basis);
                    const p2_2d = window.project3Dto2D(seg.end, basis);
                    const r1_2d = reflectPoint2D(p1_2d, a2d, b2d);
                    const r2_2d = reflectPoint2D(p2_2d, a2d, b2d);

                    const gStart = window.project2Dto3D(r1_2d.u, r1_2d.v, basis);
                    const gEnd = window.project2Dto3D(r2_2d.u, r2_2d.v, basis);
                    const gMid = gStart.clone().add(gEnd).multiplyScalar(0.5);

                    [gStart, gEnd].forEach(pt => {
                        const dPx = getPxDist(pt);
                        if (dPx < minPhantomPx) {
                            minPhantomPx = dPx;
                            bestPhantomPt = pt;
                            phantomLabel = 'Фантом (Конец)';
                        }
                    });
                    const dMidPx = getPxDist(gMid);
                    if (dMidPx < minPhantomPx) {
                        minPhantomPx = dMidPx;
                        bestPhantomPt = gMid;
                        phantomLabel = 'Фантом (Середина)';
                    }
                });

                selectedMirrorCircles.forEach(circ => {
                    if (!circ || !circ.center) return;
                    const c_2d = window.project3Dto2D(circ.center, basis);
                    const rc_2d = reflectPoint2D(c_2d, a2d, b2d);
                    const gCenter = window.project2Dto3D(rc_2d.u, rc_2d.v, basis);

                    const dPx = getPxDist(gCenter);
                    if (dPx < minPhantomPx) {
                        minPhantomPx = dPx;
                        bestPhantomPt = gCenter;
                        phantomLabel = 'Фантом (Центр)';
                    }
                });

                if (bestPhantomPt) {
                    return { point: bestPhantomPt.clone(), type: 'endpoint', color: 'green', label: phantomLabel };
                }
            }
        }
    }

    // 1. Приоритет: Конец (Endpoint)
    if (isSnapPointsEnabled && sketchPoints && sketchPoints.length > 0) {
        let bestPt = null;
        let minPx = 22;
        for (let i = 0; i < sketchPoints.length; i++) {
            const sp = sketchPoints[i];
            if (isNearCenter(sp)) continue;
            const dPx = getPxDist(sp);
            if (dPx < minPx) {
                minPx = dPx;
                bestPt = sp;
            }
        }
        if (bestPt) {
            return { point: bestPt.clone(), type: 'endpoint', color: 'red', label: 'Конец' };
        }
    }

    // 1.5. Приоритет: Пересечение (Intersection)
    if (isSnapPointsEnabled || isSnapTopologyEnabled) {
        const intersections = getAllSketchIntersections();
        let bestInter = null;
        let minPx = 22;
        for (let i = 0; i < intersections.length; i++) {
            const ptInter = intersections[i];
            const dPx = getPxDist(ptInter);
            if (dPx < minPx) {
                minPx = dPx;
                bestInter = ptInter;
            }
        }
        if (bestInter) {
            return { point: bestInter.clone(), type: 'intersection', color: 'green', label: 'Пересечение' };
        }
    }

    // 2. Приоритет: Середина (Midpoint)
    if (isSnapPointsEnabled && sketchSegments && sketchSegments.length > 0) {
        let bestMid = null;
        let minPx = 22;
        for (let i = 0; i < sketchSegments.length; i++) {
            const seg = sketchSegments[i];
            const mid = new THREE.Vector3().addVectors(seg.start, seg.end).multiplyScalar(0.5);
            const dPx = getPxDist(mid);
            if (dPx < minPx) {
                minPx = dPx;
                bestMid = mid;
            }
        }
        if (bestMid) {
            return { point: bestMid, type: 'midpoint', color: 'red', label: 'Середина' };
        }
    }

    // 3. Приоритет: Центр / Центроид (Center)
    if (isSnapPointsEnabled && sketchCenters && sketchCenters.length > 0) {
        let bestC = null;
        let minPx = 22;
        for (let i = 0; i < sketchCenters.length; i++) {
            const c = sketchCenters[i];
            const dPx = getPxDist(c.point);
            if (dPx < minPx) {
                minPx = dPx;
                bestC = c;
            }
        }
        if (bestC) {
            return { point: bestC.point.clone(), type: 'center', color: 'red', label: bestC.label || 'Центр' };
        }
    }

    // 4. Приоритет: Перпендикуляр (Perpendicular) - перпендикуляр к объекту (отрезку или окружности)
    if (isSnapPointsEnabled && currentDrawPoints && currentDrawPoints.length > 0) {
        const pStart = currentDrawPoints[currentDrawPoints.length - 1];
        let bestPerp = null;
        let minPx = 24;

        // 4a. Перпендикуляр к существующим отрезкам
        if (sketchSegments && sketchSegments.length > 0) {
            for (let i = 0; i < sketchSegments.length; i++) {
                const seg = sketchSegments[i];
                const v = new THREE.Vector3().subVectors(seg.end, seg.start);
                const Lsq = v.lengthSq();
                if (Lsq < 1e-6) continue;
                
                const L = Math.sqrt(Lsq);
                const u = v.clone().divideScalar(L);
                const tPerp = new THREE.Vector3().subVectors(pStart, seg.start).dot(u);
                const pPerp = seg.start.clone().add(u.clone().multiplyScalar(tPerp));
                
                if (pPerp.distanceTo(pStart) > 0.01 && tPerp >= -0.2 * L && tPerp <= 1.2 * L) {
                    const dPx = getPxDist(pPerp);
                    if (dPx < minPx) {
                        minPx = dPx;
                        bestPerp = pPerp;
                    }
                }
            }
        }

        // 4b. Перпендикуляр к окружностям
        if (sketchCircles && sketchCircles.length > 0) {
            for (let i = 0; i < sketchCircles.length; i++) {
                const c = sketchCircles[i];
                if (!c || !c.center || !c.radius) continue;
                const v = c.center.clone().sub(pStart);
                if (v.lengthSq() < 1e-6) continue;
                const dir = v.normalize();
                
                const pPerp1 = c.center.clone().sub(dir.clone().multiplyScalar(c.radius));
                const pPerp2 = c.center.clone().add(dir.clone().multiplyScalar(c.radius));

                [pPerp1, pPerp2].forEach(pP => {
                    if (pP.distanceTo(pStart) > 0.01) {
                        const dPx = getPxDist(pP);
                        if (dPx < minPx) {
                            minPx = dPx;
                            bestPerp = pP;
                        }
                    }
                });
            }
        }

        if (bestPerp) {
            return { point: bestPerp, type: 'perpendicular', color: 'red', label: 'Перпендикуляр' };
        }
    }

    // 5. Приоритет: Ближайшая (Nearest) / Топология - скользит по отрезкам, окружностям и осям зеркала
    if (isSnapTopologyEnabled) {
        let bestNear = null;
        let minNearPx = 22;
        let bestNearLabel = 'Ближайшая';

        if (window.activeMirrorLines && window.activeMirrorLines.length > 0) {
            window.activeMirrorLines.forEach(axis => {
                if (!axis || !axis.pt1 || !axis.pt2) return;
                const v = new THREE.Vector3().subVectors(axis.pt2, axis.pt1);
                const Lsq = v.lengthSq();
                if (Lsq < 1e-6) return;
                let t = new THREE.Vector3().subVectors(cursorPt, axis.pt1).dot(v) / Lsq;
                const pNear = axis.pt1.clone().add(v.clone().multiplyScalar(t));
                const dPx = getPxDist(pNear);
                if (dPx < minNearPx) {
                    minNearPx = dPx;
                    bestNear = pNear;
                    bestNearLabel = 'Ось зеркала';
                }
            });
        }

        if (sketchSegments && sketchSegments.length > 0) {
            for (let i = 0; i < sketchSegments.length; i++) {
                const seg = sketchSegments[i];
                const v = new THREE.Vector3().subVectors(seg.end, seg.start);
                const Lsq = v.lengthSq();
                if (Lsq < 1e-6) continue;
                let t = new THREE.Vector3().subVectors(cursorPt, seg.start).dot(v) / Lsq;
                t = Math.max(0, Math.min(1, t));
                const pNear = seg.start.clone().add(v.clone().multiplyScalar(t));
                const dPx = getPxDist(pNear);
                if (dPx < minNearPx) {
                    minNearPx = dPx;
                    bestNear = pNear;
                    bestNearLabel = 'Ближайшая';
                }
            }
        }

        if (sketchCircles && sketchCircles.length > 0) {
            for (let i = 0; i < sketchCircles.length; i++) {
                const c = sketchCircles[i];
                if (c && c.center && c.radius) {
                    const dir = cursorPt.clone().sub(c.center);
                    if (dir.lengthSq() > 1e-6) {
                        const pNearCircle = c.center.clone().add(dir.normalize().multiplyScalar(c.radius));
                        const dPx = getPxDist(pNearCircle);
                        if (dPx < minNearPx) {
                            minNearPx = dPx;
                            bestNear = pNearCircle;
                            bestNearLabel = 'Ближайшая';
                        }
                    }
                }
            }
        }

        if (bestNear) {
            return { point: bestNear, type: 'nearest', color: bestNearLabel === 'Ось зеркала' ? 'blue' : 'red', label: bestNearLabel };
        }
    }

    // 6. Приоритет: 3D Проекция от объемной модели (Топология)
    if (isSnapTopologyEnabled) {
        if (!cachedSketchSolids || sketchSolidsDirty) {
            cachedSketchSolids = [];
            creatorScene.traverse(c => {
                if (!c.isMesh || !c.visible) return;
                if (c.userData.isSketchPlane || c.userData.isSketch || c.userData.isPhantom || c.userData.isGrid || c.userData.isGizmo || c.userData.isHoleHighlight || c.userData.isMateHighlight || c === snapMarker || isGizmoPart(c)) return;
                if (c.name && (c.name.includes('Grid') || c.name.includes('Mirror') || c.name.includes('Sketch') || c.name.includes('active') || c.name.includes('Plane') || c.name.includes('Axis') || c.name.includes('Helper') || c.name.includes('ghost'))) return;
                if (c.userData.specData || c.userData.isSolidBody || c.userData.isExtrude || c.userData.isUserSolid) {
                    cachedSketchSolids.push(c);
                }
            });
            sketchSolidsDirty = false;
        }

        if (cachedSketchSolids.length > 0 && sketchRaycaster) {
            const intersects = sketchRaycaster.intersectObjects(cachedSketchSolids, true);
            if (intersects.length > 0) {
                const hit = intersects[0];
                let p3d = hit.point.clone();
                if (hit.object && hit.object.geometry && hit.object.geometry.attributes.position) {
                    const posAttr = hit.object.geometry.attributes.position;
                    const matrixWorld = hit.object.matrixWorld;
                    let bestVertPx = 30;
                    const tempV = new THREE.Vector3();
                    const checkIndices = [];
                    if (hit.face) {
                        checkIndices.push(hit.face.a, hit.face.b, hit.face.c);
                    }
                    const maxChecks = Math.min(posAttr.count, 200);
                    const step = Math.max(1, Math.floor(posAttr.count / maxChecks));
                    for (let vi = 0; vi < posAttr.count; vi += step) {
                        checkIndices.push(vi);
                    }
                    for (let i = 0; i < checkIndices.length; i++) {
                        const vi = checkIndices[i];
                        if (vi < posAttr.count) {
                            tempV.fromBufferAttribute(posAttr, vi).applyMatrix4(matrixWorld);
                            const dPx = getPxDist(tempV);
                            if (dPx < bestVertPx) {
                                bestVertPx = dPx;
                                p3d.copy(tempV);
                            }
                        }
                    }
                }

                const pProj = projectPointToSketchPlane(p3d);
                const dPx = getPxDist(pProj);
                if (dPx < 25) {
                    return { point: pProj, type: 'endpoint', color: 'red', label: '3D Проекция', source3DPt: p3d };
                }
            }
        }
    }

    return null;
}

function getScreenPxDist(pt3d) {
    if (!pt3d || !currentCreatorCamera || !creatorRenderer) return 999999;
    const canvas = creatorRenderer.domElement;
    if (!canvas) return 999999;
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;
    const pr = pt3d.clone().project(currentCreatorCamera);
    if (pr.z < -1 || pr.z > 1) return 999999;
    const px = (pr.x * 0.5 + 0.5) * w;
    const py = (-pr.y * 0.5 + 0.5) * h;
    const mousePxX = (sketchMouse.x * 0.5 + 0.5) * w;
    const mousePxY = (-sketchMouse.y * 0.5 + 0.5) * h;
    return Math.hypot(px - mousePxX, py - mousePxY);
}

function getPlaneLinesIntersection(r1, r2, plane) {
    if (!plane || !plane.userData || !plane.userData.up || !plane.userData.normal) return null;
    const up = plane.userData.up.clone().normalize();
    const normal = plane.userData.normal.clone().normalize();
    const right = new THREE.Vector3().crossVectors(up, normal).normalize();

    const o1 = r1.origin;
    const o2 = r2.origin;
    const v1 = r1.dir;
    const v2 = r2.dir;

    const x1 = o1.dot(right), y1 = o1.dot(up);
    const dx1 = v1.dot(right), dy1 = v1.dot(up);

    const x2 = o2.dot(right), y2 = o2.dot(up);
    const dx2 = v2.dot(right), dy2 = v2.dot(up);

    const det = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(det) < 1e-4) return null;

    const t1 = ((x2 - x1) * dy2 - (y2 - y1) * dx2) / det;
    return o1.clone().add(v1.clone().multiplyScalar(t1));
}

function updateSmartSnapHUD() {
    const hud = document.getElementById('smart-snap-hud');
    if (!hud) return;

    const canvas = creatorRenderer ? creatorRenderer.domElement : null;
    if (!canvas || !currentCreatorCamera) {
        hud.style.display = 'none';
        hud.innerHTML = '';
        return;
    }
    const canvasRect = canvas.getBoundingClientRect();

    function toScreen(pt3d) {
        const pProj = pt3d.clone().project(currentCreatorCamera);
        return {
            x: (pProj.x * 0.5 + 0.5) * canvasRect.width,
            y: (-pProj.y * 0.5 + 0.5) * canvasRect.height,
            visible: pProj.z >= -1 && pProj.z <= 1
        };
    }

    if (!isSketchMode || !activeSketchPlane || sketchState !== 1 || isAnyPopupOrModalOpen() || !sketchTool || sketchTool === 'trim' || sketchTool === 'extend' || sketchTool === 'chamfer' || sketchTool === 'fillet') {
        if ((sketchTool === 'chamfer' || sketchTool === 'fillet') && activeSmartSnap && (activeSmartSnap.label === 'Угол' || activeSmartSnap.label === 'Выбран угол' || activeSmartSnap.label === 'Угол (Фаска)' || activeSmartSnap.label === 'Угол (Сопряжение)')) {
            hud.style.display = 'block';
            const scr = toScreen(activeSmartSnap.point);
            if (scr.visible) {
                const svg = getSnapSVG(activeSmartSnap.type, activeSmartSnap.color);
                hud.innerHTML = `
                    <div class="smart-snap-marker ${activeSmartSnap.color}" style="left:${scr.x}px; top:${scr.y}px;">
                        <div class="smart-snap-icon">${svg}</div>
                        <span class="smart-snap-label">${activeSmartSnap.label}</span>
                    </div>
                `;
            } else {
                hud.innerHTML = '';
            }
            if (projLineMesh) projLineMesh.visible = false;
            if (trackingGuideMesh) trackingGuideMesh.visible = false;
            if (snapMarker) snapMarker.visible = false;
            return;
        }

        hud.style.display = 'none';
        hud.innerHTML = '';
        if (projLineMesh) projLineMesh.visible = false;
        if (trackingGuideMesh) trackingGuideMesh.visible = false;
        if (snapMarker) snapMarker.visible = false;
        return;
    }

    // Обновляем прогресс кандидата отслеживания
    if (trackingCandidate) {
        const elapsed = Date.now() - trackingCandidate.startTime;
        trackingCandidate.progress = Math.min(1.0, elapsed / 1000);
        if (trackingCandidate.progress >= 1.0) {
            const isTracked = trackedPoints.some(tp => tp.point.distanceTo(trackingCandidate.point) < 0.05);
            if (!isTracked) {
                trackedPoints.push({
                    point: trackingCandidate.point.clone(),
                    addedTime: Date.now(),
                    label: 'Отслеживание'
                });
                if (typeof showToast === 'function') {
                    showToast("Точка отслеживания добавлена (привязка 15°)");
                }
            }
            trackingCandidate = null;
        }
    }

    hud.style.display = 'block';

    let html = '';

    // 1. Постоянные центры
    if (sketchCenters && sketchCenters.length > 0) {
        sketchCenters.forEach(c => {
            const scr = toScreen(c.point);
            if (!scr.visible) return;
            const isHovered = activeSmartSnap && activeSmartSnap.type === 'center' && activeSmartSnap.point.distanceTo(c.point) < 0.1;
            const activeCls = isHovered ? 'active' : '';
            html += `
                <div class="smart-snap-center-perm ${activeCls}" style="left:${scr.x}px; top:${scr.y}px;" title="${c.label}">
                    ${getSnapSVG('center', 'green')}
                </div>
            `;
        });
    }

    // 2. Отслеживаемые точки (Маркер 15° секторов и отображение угла около самой точки)
    if (trackedPoints && trackedPoints.length > 0) {
        trackedPoints.forEach(tp => {
            const scr = toScreen(tp.point);
            if (!scr.visible) return;
            const activeRayForTp = (typeof activeTrackingRays !== 'undefined' && activeTrackingRays) ?
                activeTrackingRays.find(r => r.origin.distanceTo(tp.point) < 0.05) : null;
            const angleBadge = activeRayForTp ? `<div class="tracked-point-angle-badge">${activeRayForTp.angle}°</div>` : '';

            html += `
                <div class="smart-snap-tracked-point" style="left:${scr.x}px; top:${scr.y}px;" title="${tp.label || 'Отслеживаемая точка'} (15°)">
                    <svg width="36" height="36" viewBox="-18 -18 36 36" style="overflow:visible;">
                        <circle cx="0" cy="0" r="15" fill="rgba(37, 99, 235, 0.12)" stroke="#2563EB" stroke-width="1.5" stroke-dasharray="2 2" />
                        <g stroke="#2563EB" stroke-width="1" opacity="0.75">
                            <line x1="-15" y1="0" x2="15" y2="0" />
                            <line x1="0" y1="-15" x2="0" y2="15" />
                            <line x1="-10.6" y1="-10.6" x2="10.6" y2="10.6" />
                            <line x1="-10.6" y1="10.6" x2="10.6" y2="-10.6" />
                            <line x1="-14.5" y1="-3.9" x2="14.5" y2="3.9" />
                            <line x1="-3.9" y1="-14.5" x2="3.9" y2="14.5" />
                            <line x1="3.9" y1="-14.5" x2="-3.9" y2="14.5" />
                            <line x1="14.5" y1="-3.9" x2="-14.5" y2="3.9" />
                            <line x1="-13" y1="-7.5" x2="13" y2="7.5" />
                            <line x1="-7.5" y1="-13" x2="7.5" y2="13" />
                            <line x1="7.5" y1="-13" x2="-7.5" y2="13" />
                            <line x1="13" y1="-7.5" x2="-13" y2="7.5" />
                        </g>
                        <circle cx="0" cy="0" r="4" fill="#2563EB" stroke="#FFFFFF" stroke-width="1.5" />
                    </svg>
                    ${angleBadge}
                </div>
            `;
        });
    }

    // 3. Анимация задержки (заполняющийся синий круг)
    if (trackingCandidate && trackingCandidate.progress > 0 && trackingCandidate.progress < 1.0) {
        const scr = toScreen(trackingCandidate.point);
        if (scr.visible) {
            const r = 16;
            const circ = 2 * Math.PI * r;
            const strokeDash = circ * trackingCandidate.progress;
            html += `
                <div class="smart-snap-tracking-candidate" style="left:${scr.x}px; top:${scr.y}px;">
                    <svg width="40" height="40" viewBox="0 0 40 40" style="overflow:visible;">
                        <circle cx="20" cy="20" r="${r}" fill="none" stroke="rgba(37, 99, 235, 0.25)" stroke-width="3" />
                        <circle cx="20" cy="20" r="${r}" fill="none" stroke="#2563EB" stroke-width="3.5"
                                stroke-dasharray="${circ}" stroke-dashoffset="${circ - strokeDash}"
                                transform="rotate(-90 20 20)" stroke-linecap="round" />
                    </svg>
                </div>
            `;
        }
    }

    // 4. Активный маркер смарт-привязки
    const showLabel = (typeof showCreatorAnnotations !== 'undefined') ? showCreatorAnnotations : true;

    if (activeSmartSnap) {
        const scr = toScreen(activeSmartSnap.point);
        if (scr.visible) {
            const colorClass = activeSmartSnap.color;
            const svg = getSnapSVG(activeSmartSnap.type, colorClass);
            const labelHtml = (showLabel && activeSmartSnap.type !== 'tracking' && activeSmartSnap.label)
                ? `<span class="smart-snap-label">${activeSmartSnap.label}</span>`
                : '';
            html += `
                <div class="smart-snap-marker ${colorClass}" style="left:${scr.x}px; top:${scr.y}px;">
                    <div class="smart-snap-icon">${svg}</div>
                    ${labelHtml}
                </div>
            `;
        }

        if (activeSmartSnap.source3DPt) {
            if (!projLineMesh) {
                const lineGeo = new THREE.BufferGeometry();
                lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
                const lineMat = new THREE.LineDashedMaterial({
                    color: 0xF59E0B,
                    dashSize: 2,
                    gapSize: 1.5,
                    depthTest: false
                });
                projLineMesh = new THREE.Line(lineGeo, lineMat);
                projLineMesh.renderOrder = 999;
                creatorScene.add(projLineMesh);
            }
            const posAttr = projLineMesh.geometry.attributes.position;
            const s3d = activeSmartSnap.source3DPt;
            const proj = activeSmartSnap.point;
            posAttr.setXYZ(0, s3d.x, s3d.y, s3d.z);
            posAttr.setXYZ(1, proj.x, proj.y, proj.z);
            posAttr.needsUpdate = true;
            projLineMesh.computeLineDistances();
            projLineMesh.visible = true;
        } else if (projLineMesh) {
            projLineMesh.visible = false;
        }
    } else {
        if (projLineMesh) projLineMesh.visible = false;
    }

    // 4.5 Размеры вдоль лучей отслеживания (компактная размерная линия со стрелками и выносными линиями)
    if (typeof activeTrackingRays !== 'undefined' && activeTrackingRays && activeTrackingRays.length > 0 && activeSmartSnap && activeSmartSnap.point) {
        activeTrackingRays.forEach((ray, rayIdx) => {
            const pStart = ray.origin;
            const pEnd = activeSmartSnap.point;
            const dist3D = pStart.distanceTo(pEnd);
            if (dist3D < 0.5) return;

            const scr1 = toScreen(pStart);
            const scr2 = toScreen(pEnd);
            if (!scr1.visible || !scr2.visible) return;

            const x1 = scr1.x, y1 = scr1.y;
            const x2 = scr2.x, y2 = scr2.y;
            const dx = x2 - x1, dy = y2 - y1;
            const len = Math.hypot(dx, dy);
            if (len < 12) return;

            const ux = dx / len, uy = dy / len;
            const px = -uy, py = ux;

            const offsetDist = 28;
            const extLen = 36;

            const ext1_x1 = x1, ext1_y1 = y1;
            const ext1_x2 = x1 + px * extLen, ext1_y2 = y1 + py * extLen;

            const ext2_x1 = x2, ext2_y1 = y2;
            const ext2_x2 = x2 + px * extLen, ext2_y2 = y2 + py * extLen;

            const dim1_x = x1 + px * offsetDist, dim1_y = y1 + py * offsetDist;
            const dim2_x = x2 + px * offsetDist, dim2_y = y2 + py * offsetDist;

            const arrowLen = 14, arrowWidth = 6.5;
            const arr1_p1_x = dim1_x + ux * arrowLen + px * arrowWidth;
            const arr1_p1_y = dim1_y + uy * arrowLen + py * arrowWidth;
            const arr1_p2_x = dim1_x + ux * arrowLen - px * arrowWidth;
            const arr1_p2_y = dim1_y + uy * arrowLen - py * arrowWidth;

            const arr2_p1_x = dim2_x - ux * arrowLen + px * arrowWidth;
            const arr2_p1_y = dim2_y - uy * arrowLen + py * arrowWidth;
            const arr2_p2_x = dim2_x - ux * arrowLen - px * arrowWidth;
            const arr2_p2_y = dim2_y - uy * arrowLen - py * arrowWidth;

            const midX = (dim1_x + dim2_x) / 2;
            const midY = (dim1_y + dim2_y) / 2;

            let angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
            if (angleDeg > 90 || angleDeg < -90) {
                angleDeg += 180;
            }

            const isActive = (trackingActiveDim === rayIdx);
            const lockedVal = (rayIdx === 0 ? trackingLockedDist0 : trackingLockedDist1);
            const strVal = (rayIdx === 0 ? trackingStr0 : trackingStr1);
            const isLocked = (lockedVal !== null);

            let valStrDisplay = '';
            if (isActive && strVal !== '') {
                valStrDisplay = strVal + '<span class="cad-dim-cursor"></span>';
            } else if (isLocked) {
                valStrDisplay = lockedVal.toFixed(1);
            } else if (isActive && strVal === '') {
                valStrDisplay = dist3D.toFixed(1) + '<span class="cad-dim-cursor"></span>';
            } else {
                valStrDisplay = dist3D.toFixed(1);
            }

            const bg = isLocked ? 'rgba(254,252,232,0.98)' : (isActive ? 'rgba(248,250,252,0.98)' : '#FFFFFF');
            const textColor = isLocked ? '#0B192C' : (isActive ? '#1D4ED8' : '#1E40AF');
            const borderStyle = isActive ? '2px solid #2563EB' : (isLocked ? '2px solid #D97706' : '1.5px solid #2563EB');
            const shadow = isActive ? '0 0 0 3px rgba(37,99,235,0.25), 0 8px 20px rgba(37,99,235,0.3)' : (isLocked ? '0 0 0 3px rgba(217,119,6,0.2), 0 6px 16px rgba(217,119,6,0.25)' : '0 3px 10px rgba(37,99,235,0.25)');

            html += `
                <svg style="position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; overflow:visible; z-index:9008;">
                    <line x1="${ext1_x1}" y1="${ext1_y1}" x2="${ext1_x2}" y2="${ext1_y2}" stroke="#2563EB" stroke-width="1.5" stroke-dasharray="3 2" opacity="0.9" />
                    <line x1="${ext2_x1}" y1="${ext2_y1}" x2="${ext2_x2}" y2="${ext2_y2}" stroke="#2563EB" stroke-width="1.5" stroke-dasharray="3 2" opacity="0.9" />
                    <line x1="${dim1_x}" y1="${dim1_y}" x2="${dim2_x}" y2="${dim2_y}" stroke="#2563EB" stroke-width="2.5" />
                    <polygon points="${dim1_x},${dim1_y} ${arr1_p1_x},${arr1_p1_y} ${arr1_p2_x},${arr1_p2_y}" fill="#2563EB" />
                    <polygon points="${dim2_x},${dim2_y} ${arr2_p1_x},${arr2_p1_y} ${arr2_p2_x},${arr2_p2_y}" fill="#2563EB" />
                </svg>
                <div style="position:absolute; left:${midX}px; top:${midY}px; transform: translate(-50%, -50%) rotate(${angleDeg}deg);
                            background:${bg}; color:${textColor}; border:${borderStyle}; font-size:16px; font-weight:800;
                            font-family:'JetBrains Mono','Fira Code',monospace,sans-serif; padding:4px 12px; border-radius:8px;
                            box-shadow:${shadow}; white-space:nowrap; pointer-events:none; z-index:9009;">
                    ${valStrDisplay} мм ${isLocked ? '<span style="font-size:11px;margin-left:2px;">🔒</span>' : ''}
                </div>
            `;
        });

        const badgeHint = document.getElementById('rect-badge-hint');
        if (badgeHint) {
            badgeHint.style.display = 'block';
            badgeHint.innerHTML = `<kbd>Tab</kbd> выбор размера • <kbd>Числа</kbd> ввод • <kbd>BS/Del+Tab</kbd> сбросить заморозку`;
        }
    }

    // 5. 3D Линии-направляющие следования (активные лучи)
    if (typeof activeTrackingRays !== 'undefined' && activeTrackingRays && activeTrackingRays.length > 0 && isSketchMode && activeSketchPlane) {
        if (!trackingGuideMesh) {
            const lineGeo = new THREE.BufferGeometry();
            lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24), 3));
            const lineMat = new THREE.LineDashedMaterial({
                color: 0x2563EB,
                dashSize: 4,
                gapSize: 3,
                depthTest: false
            });
            trackingGuideMesh = new THREE.LineSegments(lineGeo, lineMat);
            trackingGuideMesh.renderOrder = 9999;
            creatorScene.add(trackingGuideMesh);
        }
        const posAttr = trackingGuideMesh.geometry.attributes.position;
        let idx = 0;
        activeTrackingRays.forEach(ray => {
            const origin = ray.origin;
            const dir = ray.dir;
            const p1 = origin.clone().sub(dir.clone().multiplyScalar(2000));
            const p2 = origin.clone().add(dir.clone().multiplyScalar(2000));
            posAttr.setXYZ(idx++, p1.x, p1.y, p1.z);
            posAttr.setXYZ(idx++, p2.x, p2.y, p2.z);
        });
        trackingGuideMesh.geometry.setDrawRange(0, idx);
        posAttr.needsUpdate = true;
        trackingGuideMesh.computeLineDistances();
        trackingGuideMesh.visible = true;
    } else if (trackingGuideMesh) {
        trackingGuideMesh.visible = false;
    }

    // 6. Угол и расстояние подобия для Прямой (infiniline) при первой выбранной точке
    if (sketchTool === 'infiniline' && currentDrawPoints.length === 1) {
        const p1 = currentDrawPoints[0];
        const scr1 = toScreen(p1);
        if (scr1.visible) {
            const ptCurr = lastMouseSketchPt || p1;
            const up = activeSketchPlane.userData.up ? activeSketchPlane.userData.up.clone().normalize() : new THREE.Vector3(0, 1, 0);
            const normal = activeSketchPlane.userData.normal ? activeSketchPlane.userData.normal.clone().normalize() : new THREE.Vector3(0, 0, 1);
            const right = new THREE.Vector3().crossVectors(up, normal).normalize();

            if (lineFirstPointBaseCircle) {
                const c = lineFirstPointBaseCircle;
                const currOffsetMm = Math.abs(ptCurr.distanceTo(c.center) - c.radius);

                let offsetValDisplay = '';
                if (lineOffsetStr !== '') {
                    offsetValDisplay = lineOffsetStr + '<span class="cad-dim-cursor"></span>';
                } else if (lineLockedOffset !== null) {
                    offsetValDisplay = lineLockedOffset.toFixed(1);
                } else {
                    offsetValDisplay = currOffsetMm.toFixed(1) + '<span class="cad-dim-cursor"></span>';
                }

                let clsOffset = `cad-dim-badge extension active`;
                if (lineLockedOffset !== null) clsOffset = `cad-dim-badge extension locked`;

                html += `
                    <div style="position:absolute; left:${scr1.x}px; top:${scr1.y - 32}px; transform:translate(-50%, -100%); pointer-events:none; z-index:9999;">
                        <div class="${clsOffset}">
                            <span class="cad-dim-tag">Подобие:</span>
                            <span class="cad-dim-val">${offsetValDisplay}</span>
                            <span class="cad-dim-unit">мм</span>
                            ${lineLockedOffset !== null ? '<span style="font-size:11px;margin-left:2px;">🔒</span>' : ''}
                        </div>
                    </div>
                `;
            } else if (lineFirstPointBaseSeg) {
                let currOffsetMm = 0;
                const seg = lineFirstPointBaseSeg;
                const segDir = seg.end.clone().sub(seg.start).normalize();
                const segPerp = new THREE.Vector3().crossVectors(segDir, normal).normalize();
                currOffsetMm = Math.abs(ptCurr.clone().sub(p1).dot(segPerp));

                let offsetValDisplay = '';
                if (lineOffsetStr !== '') {
                    offsetValDisplay = lineOffsetStr + '<span class="cad-dim-cursor"></span>';
                } else if (lineLockedOffset !== null) {
                    offsetValDisplay = lineLockedOffset.toFixed(1);
                } else {
                    offsetValDisplay = currOffsetMm.toFixed(1) + '<span class="cad-dim-cursor"></span>';
                }

                let clsOffset = `cad-dim-badge extension active`;
                if (lineLockedOffset !== null) clsOffset = `cad-dim-badge extension locked`;

                html += `
                    <div style="position:absolute; left:${scr1.x}px; top:${scr1.y - 32}px; transform:translate(-50%, -100%); pointer-events:none; z-index:9999;">
                        <div class="${clsOffset}">
                            <span class="cad-dim-tag">Подобие:</span>
                            <span class="cad-dim-val">${offsetValDisplay}</span>
                            <span class="cad-dim-unit">мм</span>
                            ${lineLockedOffset !== null ? '<span style="font-size:11px;margin-left:2px;">🔒</span>' : ''}
                        </div>
                    </div>
                `;
            } else {
                const v = ptCurr.clone().sub(p1);
                const x = v.dot(right);
                const y = v.dot(up);
                let currAngleDeg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;

                let angleValDisplay = '';
                if (lineAngleStr !== '') {
                    angleValDisplay = lineAngleStr + '<span class="cad-dim-cursor"></span>';
                } else if (lineLockedAngle !== null) {
                    angleValDisplay = lineLockedAngle.toFixed(1);
                } else {
                    angleValDisplay = currAngleDeg.toFixed(1) + '<span class="cad-dim-cursor"></span>';
                }

                let clsAngle = `cad-dim-badge extension active`;
                if (lineLockedAngle !== null) clsAngle = `cad-dim-badge extension locked`;

                let ringHtml = '';
                if (sketchTool === 'infiniline') {
                    let activeDeg = currAngleDeg;
                    if (lineLockedAngle !== null) activeDeg = lineLockedAngle;

                    const rad = activeDeg * Math.PI / 180;
                    const cosA = Math.cos(rad);
                    const sinA = Math.sin(rad);
                    const x1 = (-18 * cosA).toFixed(1);
                    const y1 = (18 * sinA).toFixed(1);
                    const x2 = (18 * cosA).toFixed(1);
                    const y2 = (-18 * sinA).toFixed(1);

                    ringHtml = `
                        <div class="smart-snap-angle-ring" style="position:absolute; left:${scr1.x}px; top:${scr1.y}px; transform:translate(-50%, -50%); pointer-events:none; z-index:9998;">
                            <svg width="60" height="60" viewBox="-30 -30 60 60" style="overflow:visible;">
                                <circle cx="0" cy="0" r="18" fill="rgba(37, 99, 235, 0.08)" stroke="#2563EB" stroke-width="1.5" stroke-dasharray="2 2" />
                                <g stroke="#2563EB" stroke-width="1" opacity="0.35">
                                    <line x1="-18" y1="0" x2="18" y2="0" />
                                    <line x1="0" y1="-18" x2="0" y2="18" />
                                    <line x1="-12.7" y1="-12.7" x2="12.7" y2="12.7" />
                                    <line x1="-12.7" y1="12.7" x2="12.7" y2="-12.7" />
                                </g>
                                <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#2563EB" stroke-width="2.5" stroke-linecap="round" />
                                <circle cx="0" cy="0" r="3" fill="#2563EB" stroke="#FFFFFF" stroke-width="1.5" />
                            </svg>
                        </div>
                    `;
                }

                html += `
                    ${ringHtml}
                    <div style="position:absolute; left:${scr1.x}px; top:${scr1.y - 32}px; transform:translate(-50%, -100%); pointer-events:none; z-index:9999;">
                        <div class="${clsAngle}">
                            <span class="cad-dim-tag">Угол:</span>
                            <span class="cad-dim-val">${angleValDisplay}</span>
                            <span class="cad-dim-unit">°</span>
                            ${lineLockedAngle !== null ? '<span style="font-size:11px;margin-left:2px;">🔒</span>' : ''}
                        </div>
                    </div>
                `;
            }
        }
    }

    if (hud.innerHTML !== html) {
        hud.innerHTML = html;
    }
}
window.updateSmartSnapHUD = updateSmartSnapHUD;

function applySnapsAndOrtho(pt, applyLength = true) {
    if (!isSketchMode || !activeSketchPlane || sketchState !== 1 || isAnyPopupOrModalOpen() || !sketchTool || sketchTool === 'trim' || sketchTool === 'extend' || sketchTool === 'chamfer' || sketchTool === 'fillet') {
        activeSmartSnap = null;
        activeTrackingRay = null;
        activeTrackingRays = [];
        trackingCandidate = null;
        if (snapMarker) snapMarker.visible = false;
        if (trackingGuideMesh) trackingGuideMesh.visible = false;
        updateSmartSnapHUD();
        return pt;
    }

    if (!isSnapEnabled) {
        activeSmartSnap = null;
        activeTrackingRay = null;
        activeTrackingRays = [];
        trackingCandidate = null;
        if (snapMarker) snapMarker.visible = false;
        if (trackingGuideMesh) trackingGuideMesh.visible = false;
        updateSmartSnapHUD();
        if (sketchTool === 'line' && typeof lineHoverSegment !== 'undefined' && lineHoverSegment && (lineLockedDist0 !== null || lineLockedDist1 !== null || (lineActiveDim !== -1 && (lineStr0 || lineStr1)))) {
            return getAdjustedLineSegmentPoint(pt);
        }
        return pt;
    }

    // Если у текущего зафиксированного отрезка вводится конкретное число - отдаем жесткий приоритет этому значению
    if (sketchTool === 'line' && typeof lineHoverSegment !== 'undefined' && lineHoverSegment && (lineLockedDist0 !== null || lineLockedDist1 !== null || (lineActiveDim !== -1 && ((lineStr0 && lineStr0.trim() !== '') || (lineStr1 && lineStr1.trim() !== ''))))) {
        activeSmartSnap = null;
        activeTrackingRay = null;
        activeTrackingRays = [];
        trackingCandidate = null;
        if (snapMarker) snapMarker.visible = false;
        if (trackingGuideMesh) trackingGuideMesh.visible = false;
        updateSmartSnapHUD();
        return getAdjustedLineSegmentPoint(pt);
    }

    // 1. Вычисляем стандартную смарт-привязку
    let smartRes = evaluateSmartSnap(pt);

    // 2. Обновляем кандидата на отслеживание (с кулдауном 2 сек) если включено "Продолжение"
    if (isSnapExtensionEnabled) {
        let hoverTrackedIdx = -1;
        const now = Date.now();
        if (smartRes) {
            hoverTrackedIdx = trackedPoints.findIndex(tp => {
                if (tp.addedTime && (now - tp.addedTime < 2000)) return false;
                return tp.point.distanceTo(smartRes.point) < 0.08;
            });
        }
        if (hoverTrackedIdx === -1 && trackedPoints && trackedPoints.length > 0) {
            for (let i = 0; i < trackedPoints.length; i++) {
                const tp = trackedPoints[i];
                if (tp.addedTime && (now - tp.addedTime < 2000)) continue;
                if (getScreenPxDist(tp.point) < 18) {
                    hoverTrackedIdx = i;
                    break;
                }
            }
        }

        if (hoverTrackedIdx !== -1) {
            // Навелись на уже отслеживаемую точку -> сразу удаляем ее!
            const removed = trackedPoints.splice(hoverTrackedIdx, 1)[0];
            lastRemovedTrackedPt = removed ? removed.point.clone() : null;
            trackingCandidate = null;
            if (typeof showToast === 'function') {
                showToast("Точка отслеживания отключена");
            }
        } else if (smartRes && (smartRes.type === 'endpoint' || smartRes.type === 'midpoint' || smartRes.type === 'center' || smartRes.type === 'quadrant')) {
            const isRecentlyRemoved = lastRemovedTrackedPt && lastRemovedTrackedPt.distanceTo(smartRes.point) < 0.08;
            if (!isRecentlyRemoved) {
                if (trackingCandidate && trackingCandidate.point.distanceTo(smartRes.point) < 0.05) {
                    // Кандидат удерживается
                } else {
                    trackingCandidate = {
                        point: smartRes.point.clone(),
                        startTime: Date.now(),
                        progress: 0
                    };
                }
            } else {
                trackingCandidate = null;
            }
        } else {
            trackingCandidate = null;
            if (!smartRes || (lastRemovedTrackedPt && smartRes.point.distanceTo(lastRemovedTrackedPt) >= 0.1)) {
                lastRemovedTrackedPt = null;
            }
        }
    } else {
        trackingCandidate = null;
    }

    // 3. Проверка лучей отслеживания 15° от всех trackedPoints (если включено "Продолжение")
    let matchedRays = [];
    const hasLockedOrTypedDist = (trackingLockedDist0 !== null || (trackingActiveDim === 0 && trackingStr0.trim() !== ''));

    if (isSnapExtensionEnabled && trackedPoints && trackedPoints.length > 0) {
        const up = activeSketchPlane.userData.up.clone().normalize();
        const normal = activeSketchPlane.userData.normal.clone().normalize();
        const right = new THREE.Vector3().crossVectors(up, normal).normalize();

        for (let i = 0; i < trackedPoints.length; i++) {
            const tp = trackedPoints[i];
            const v = new THREE.Vector3().subVectors(pt, tp.point);
            const x = v.dot(right);
            const y = v.dot(up);
            const dist = Math.hypot(x, y);

            if (dist > 0.05) { // Отодвинулись от точки отслеживания
                let rad = Math.atan2(y, x);
                let deg = (rad * 180 / Math.PI + 360) % 360;
                let snapDeg = Math.round(deg / 15) * 15 % 360;

                let deltaDeg = Math.abs(deg - snapDeg);
                if (deltaDeg > 180) deltaDeg = 360 - deltaDeg;

                const rayRad = snapDeg * Math.PI / 180;
                const dirRay = right.clone().multiplyScalar(Math.cos(rayRad))
                    .add(up.clone().multiplyScalar(Math.sin(rayRad))).normalize();

                const pRay = tp.point.clone().add(dirRay.clone().multiplyScalar(dist));
                const dPx = getScreenPxDist(pRay);

                const maxDPx = hasLockedOrTypedDist ? 180 : 25;
                const maxDeg = hasLockedOrTypedDist ? 30 : 3.5;

                if (dPx < maxDPx || deltaDeg < maxDeg) {
                    matchedRays.push({
                        tp: tp,
                        origin: tp.point.clone(),
                        angle: snapDeg,
                        dir: dirRay,
                        point: pRay,
                        distance: dist
                    });
                }
            }
        }

        if (matchedRays.length === 0 && hasLockedOrTypedDist && activeTrackingRay) {
            matchedRays.push(activeTrackingRay);
        }
    }

    if (matchedRays.length === 1) {
        const matchedRay = matchedRays[0];
        activeTrackingRay = matchedRay;
        activeTrackingRays = matchedRays;

        let effDist = matchedRay.distance;
        if (trackingLockedDist0 !== null) {
            effDist = trackingLockedDist0;
        } else if (trackingActiveDim === 0 && trackingStr0.trim() !== '') {
            const v = parseFloat(trackingStr0);
            if (!isNaN(v) && v > 0) effDist = v;
        }

        matchedRay.point = matchedRay.origin.clone().add(matchedRay.dir.clone().multiplyScalar(effDist));

        if (!smartRes || smartRes.type === 'nearest' || smartRes.type === 'tracking') {
            smartRes = {
                point: matchedRay.point.clone(),
                type: 'tracking',
                color: 'blue',
                label: ''
            };
        }
    } else if (matchedRays.length >= 2) {
        const r1 = matchedRays[0];
        const r2 = matchedRays[1];
        activeTrackingRay = r1;
        activeTrackingRays = [r1, r2];

        const intersectPt = getPlaneLinesIntersection(r1, r2, activeSketchPlane);
        if (intersectPt) {
            const rawD1 = r1.origin.distanceTo(intersectPt);
            const rawD2 = r2.origin.distanceTo(intersectPt);

            let effD1 = rawD1;
            if (trackingLockedDist0 !== null) effD1 = trackingLockedDist0;
            else if (trackingActiveDim === 0 && trackingStr0.trim() !== '') {
                const v = parseFloat(trackingStr0);
                if (!isNaN(v) && v > 0) effD1 = v;
            }

            let effD2 = rawD2;
            if (trackingLockedDist1 !== null) effD2 = trackingLockedDist1;
            else if (trackingActiveDim === 1 && trackingStr1.trim() !== '') {
                const v = parseFloat(trackingStr1);
                if (!isNaN(v) && v > 0) effD2 = v;
            }

            let resPoint = intersectPt.clone();
            if (trackingLockedDist0 !== null || (trackingActiveDim === 0 && trackingStr0.trim() !== '')) {
                resPoint = r1.origin.clone().add(r1.dir.clone().multiplyScalar(effD1));
            } else if (trackingLockedDist1 !== null || (trackingActiveDim === 1 && trackingStr1.trim() !== '')) {
                resPoint = r2.origin.clone().add(r2.dir.clone().multiplyScalar(effD2));
            }

            if (!smartRes || smartRes.type === 'nearest' || smartRes.type === 'tracking') {
                smartRes = {
                    point: resPoint,
                    type: 'tracking',
                    color: 'blue',
                    label: ''
                };
            }
        }
    } else {
        if (!hasLockedOrTypedDist) {
            activeTrackingRay = null;
            activeTrackingRays = [];
            resetTrackingDimState();
        }
    }

    if (smartRes) {
        activeSmartSnap = smartRes;
        if (snapMarker) snapMarker.visible = false;
        pt.copy(smartRes.point);
    } else {
        activeSmartSnap = null;
        if (snapMarker) snapMarker.visible = false;

        if (sketchTool === 'line' && typeof lineHoverSegment !== 'undefined' && lineHoverSegment) {
            const adj = getAdjustedLineSegmentPoint(pt);
            pt.copy(adj);
        } else if (isOrtho && currentDrawPoints.length > 0) {
            const startPt = currentDrawPoints[0];
            const v = new THREE.Vector3().subVectors(pt, startPt);
            const up = activeSketchPlane.userData.up;
            const normal = activeSketchPlane.userData.normal;
            const right = new THREE.Vector3().crossVectors(up, normal).normalize();
            
            if (Math.abs(v.dot(up)) > Math.abs(v.dot(right))) {
                pt.copy(startPt).add(up.clone().multiplyScalar(v.dot(up)));
            } else {
                pt.copy(startPt).add(right.clone().multiplyScalar(v.dot(right)));
            }
        }
    }

    updateSmartSnapHUD();

    if (applyLength) {
        const valInput = document.getElementById('sketch-val');
        if (valInput && valInput.value && currentDrawPoints.length > 0) {
            const length = parseFloat(valInput.value);
            if (!isNaN(length) && length > 0) {
                const dir = new THREE.Vector3().subVectors(pt, currentDrawPoints[0]).normalize();
                pt.copy(currentDrawPoints[0]).add(dir.multiplyScalar(length));
            }
        }
    }
    return pt;
}

function onSketchValEnter(e) {
    if (e.key === 'Enter') {
        if (sketchState === 1 && currentDrawPoints.length > 0 && activeSketchPlane) {
            sketchRaycaster.setFromCamera(sketchMouse, currentCreatorCamera);
            const pt = getSketchPlaneIntersection(sketchRaycaster, activeSketchPlane);
            if (pt) {
                let snappedPt = applySnapsAndOrtho(pt, true);
                addSketchPoint(snappedPt);
            }
        }
        document.getElementById('sketch-val').value = ''; // очистка
    }
}

function addSketchPoint(pt) {
    currentDrawPoints.push(pt.clone());
    if (!sketchPoints.some(p => p.distanceTo(pt) < 0.1)) sketchPoints.push(pt.clone());
    trackingCandidate = null;
    lastRemovedTrackedPt = pt.clone();

    if (sketchTool === 'infiniline' && currentDrawPoints.length === 1) {
        lineFirstPointBaseSeg = findSegmentAtPoint(currentDrawPoints[0]);
        lineFirstPointBaseCircle = lineFirstPointBaseSeg ? null : findCircleAtPoint(currentDrawPoints[0]);
        lineAngleActiveDim = (lineFirstPointBaseSeg || lineFirstPointBaseCircle) ? 1 : 0;
        lineAngleStr = '';
        lineLockedAngle = null;
        lineOffsetStr = '';
        lineLockedOffset = null;
    } else if (sketchTool === 'line') {
        lineFirstPointBaseSeg = null;
        lineFirstPointBaseCircle = null;
    }

    const mat = new THREE.LineBasicMaterial({ color: 0x2A3142, linewidth: 2, depthTest: false });

    if (sketchTool === 'circle' && currentDrawPoints.length === 2) {
        const radius = currentDrawPoints[0].distanceTo(currentDrawPoints[1]);
        const geo = new THREE.CircleGeometry(radius, 64);
        const edges = new THREE.EdgesGeometry(geo, showRadialEdges ? 1 : 15);
        const circleLine = new THREE.LineSegments(edges, mat);
        circleLine.position.copy(currentDrawPoints[0]);
        circleLine.renderOrder = 1;
        circleLine.isSketchCircleMesh = true;
        alignToPlane(circleLine, activeSketchPlane);
        sketchGroup.add(circleLine);
        const newCirc = { center: currentDrawPoints[0].clone(), radius: radius };
        sketchCircles.push(newCirc);
        if (typeof window.autoMirrorPrimitive === 'function') window.autoMirrorPrimitive('circle', newCirc);
        currentDrawPoints = [];
    } else if (sketchTool === 'arc' && currentDrawPoints.length === 3) {
        // Построение дуги по трем точкам (P1 — Начало, P2 — Точка на дуге, P3 — Конец)
        const p1 = currentDrawPoints[0];
        const p2 = currentDrawPoints[1];
        const p3 = currentDrawPoints[2];

        if (p3.distanceTo(p1) > 1e-4 && p3.distanceTo(p2) > 1e-4) {
            const up = activeSketchPlane.userData.up ? activeSketchPlane.userData.up.clone().normalize() : new THREE.Vector3(0, 1, 0);
            const normal = activeSketchPlane.userData.normal ? activeSketchPlane.userData.normal.clone().normalize() : new THREE.Vector3(0, 0, 1);
            const right = new THREE.Vector3().crossVectors(up, normal).normalize();
            const origin = (activeSketchPlane.userData && activeSketchPlane.userData.origin) ? activeSketchPlane.userData.origin.clone() : new THREE.Vector3(0, 0, 0);

            const project = (p3d) => {
                const rel = p3d.clone().sub(origin);
                return new THREE.Vector2(rel.dot(right), rel.dot(up));
            };
            const unproject = (p2d) => {
                return origin.clone().add(right.clone().multiplyScalar(p2d.x)).add(up.clone().multiplyScalar(p2d.y));
            };

            const p1_2d = project(p1);
            const p2_2d = project(p2);
            const p3_2d = project(p3);

            const arcPts2D = calculate3PointArc(p1_2d, p2_2d, p3_2d, 50);
            const worldPts = arcPts2D.map(unproject);

            const geo = new THREE.BufferGeometry().setFromPoints(worldPts);
            const arcLine = new THREE.Line(geo, mat);
            arcLine.renderOrder = 1;
            sketchGroup.add(arcLine);

            for (let i = 0; i < worldPts.length - 1; i++) {
                const newSeg = { start: worldPts[i].clone(), end: worldPts[i+1].clone() };
                sketchSegments.push(newSeg);
                if (typeof window.autoMirrorPrimitive === 'function') window.autoMirrorPrimitive('segment', newSeg, true);
            }
            if (typeof window.rebuildSketchLines === 'function') window.rebuildSketchLines();
            if (sketchHudTooltip) sketchHudTooltip.innerText = '[ Дуга: Укажите точкой конец ]';
        } else if (currentDrawPoints.length === 2) {
            if (sketchHudTooltip) sketchHudTooltip.innerText = '[ Дуга: Укажите конец ]';
        }
    }

    if (sketchTool === 'line' && currentDrawPoints.length >= 2) {
        const p1 = currentDrawPoints[currentDrawPoints.length - 2];
        const rawP2 = currentDrawPoints[currentDrawPoints.length - 1];
        const p2 = getAdjustedLinePoint(rawP2);
        currentDrawPoints[currentDrawPoints.length - 1] = p2;
        const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
        const line = new THREE.Line(geo, mat);
        line.renderOrder = 1;
        sketchGroup.add(line);
        const newSeg = {start: p1.clone(), end: p2.clone()};
        sketchSegments.push(newSeg);
        if (typeof window.autoMirrorPrimitive === 'function') window.autoMirrorPrimitive('segment', newSeg);
        // Для цепочки линий оставляем последнюю точку как начальную для следующего отрезка
        currentDrawPoints = [p2];
        resetLineAngleAndOffsetState();
    } else if (sketchTool === 'infiniline' && currentDrawPoints.length >= 2) {
        if (lineFirstPointBaseCircle) {
            const c = lineFirstPointBaseCircle;
            const p1 = currentDrawPoints[0];
            const rawP2 = currentDrawPoints[1];
            const distCenter = rawP2.distanceTo(c.center);
            let offsetVal = lineLockedOffset;
            if (offsetVal === null && lineOffsetStr.trim() !== '') {
                const parsed = parseFloat(lineOffsetStr);
                if (!isNaN(parsed)) offsetVal = parsed;
            }
            if (offsetVal === null) {
                offsetVal = distCenter - c.radius;
            }
            let newRadius = c.radius + offsetVal;
            if (newRadius < 0.1) newRadius = 0.1;

            sketchCircles.push({ center: c.center.clone(), radius: newRadius });

            const lineMat = new THREE.LineBasicMaterial({ color: 0x2563EB, linewidth: 2, depthTest: false });
            const geo = new THREE.CircleGeometry(newRadius, 64);
            const edges = new THREE.EdgesGeometry(geo, 1);
            const circleLine = new THREE.LineSegments(edges, lineMat);
            circleLine.position.copy(c.center);
            circleLine.renderOrder = 1;
            circleLine.isSketchCircleMesh = true;
            alignToPlane(circleLine, activeSketchPlane);
            sketchGroup.add(circleLine);

            currentDrawPoints = [];
            resetLineAngleAndOffsetState();
        } else if (lineFirstPointBaseSeg) {
            const p1 = currentDrawPoints[0];
            const rawP2 = currentDrawPoints[1];
            const seg = lineFirstPointBaseSeg;
            const segDir = seg.end.clone().sub(seg.start).normalize();
            const normal = activeSketchPlane.userData.normal ? activeSketchPlane.userData.normal.clone().normalize() : new THREE.Vector3(0, 0, 1);
            const segPerp = new THREE.Vector3().crossVectors(segDir, normal).normalize();

            const vCursor = rawP2.clone().sub(p1);
            let side = Math.sign(vCursor.dot(segPerp));
            if (side === 0) side = 1;

            let offsetVal = lineLockedOffset;
            if (offsetVal === null && lineOffsetStr.trim() !== '') {
                const parsed = parseFloat(lineOffsetStr);
                if (!isNaN(parsed)) offsetVal = parsed;
            }
            if (offsetVal === null) {
                offsetVal = Math.abs(vCursor.dot(segPerp));
            }

            const originParallel = p1.clone().add(segPerp.clone().multiplyScalar(offsetVal * side));
            const start = originParallel.clone().sub(segDir.clone().multiplyScalar(100000));
            const end = originParallel.clone().add(segDir.clone().multiplyScalar(100000));
            const blueMat = new THREE.LineBasicMaterial({ color: 0x2563EB, linewidth: 2, depthTest: false });
            const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
            const line = new THREE.Line(geo, blueMat);
            line.renderOrder = 1;
            sketchGroup.add(line);
            sketchSegments.push({ start, end, isInfinite: true, color: 0x2563EB, p1: originParallel.clone(), p2: originParallel.clone().add(segDir) });
            if (!sketchPoints.some(sp => sp.distanceTo(originParallel) < 0.1)) sketchPoints.push(originParallel.clone());

            currentDrawPoints = [];
            resetLineAngleAndOffsetState();
        } else {
            const p1 = currentDrawPoints[0];
            const rawP2 = currentDrawPoints[1];
            const p2 = getAdjustedLinePoint(rawP2);
            currentDrawPoints[1] = p2;
            const dir = p2.clone().sub(p1);
            if (dir.lengthSq() > 1e-6) {
                dir.normalize();
                const start = p1.clone().sub(dir.clone().multiplyScalar(100000));
                const end = p1.clone().add(dir.clone().multiplyScalar(100000));
                const blueMat = new THREE.LineBasicMaterial({ color: 0x2563EB, linewidth: 2, depthTest: false });
                const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
                const line = new THREE.Line(geo, blueMat);
                line.renderOrder = 1;
                sketchGroup.add(line);
                sketchSegments.push({ start, end, isInfinite: true, color: 0x2563EB, p1: p1.clone(), p2: p2.clone() });
                if (!sketchPoints.some(sp => sp.distanceTo(p1) < 0.1)) sketchPoints.push(p1.clone());
                if (!sketchPoints.some(sp => sp.distanceTo(p2) < 0.1)) sketchPoints.push(p2.clone());
            }
            currentDrawPoints = [];
            resetLineAngleAndOffsetState();
        }
    } else if (sketchTool === 'rectangle' && currentDrawPoints.length === 2) {
        const p1 = currentDrawPoints[0];
        const p2 = getAdjustedRectPoint(currentDrawPoints[1]);
        currentDrawPoints[1] = p2;

        const geom = getModifiedRectangleGeometry(p1, p2, activeSketchPlane, rectChamferVal, rectConcaveVal, rectFilletVal);

        for (let i = 0; i < geom.segments.length; i++) {
            const seg = geom.segments[i];
            const geo = new THREE.BufferGeometry().setFromPoints([seg.start, seg.end]);
            const line = new THREE.Line(geo, mat);
            line.renderOrder = 1;
            sketchGroup.add(line);
            const newSeg = { start: seg.start.clone(), end: seg.end.clone() };
            sketchSegments.push(newSeg);
            if (typeof window.autoMirrorPrimitive === 'function') window.autoMirrorPrimitive('segment', newSeg);
        }
        geom.points.forEach(p => {
            if (!sketchPoints.some(sp => sp.distanceTo(p) < 0.1)) sketchPoints.push(p.clone());
        });
        if (geom.arcCenters && geom.arcCenters.length > 0) {
            geom.arcCenters.forEach(ac => {
                if (!sketchPoints.some(sp => sp.distanceTo(ac) < 0.1)) sketchPoints.push(ac.clone());
                if (!sketchArcCenters.some(sac => sac.distanceTo(ac) < 0.1)) sketchArcCenters.push(ac.clone());
            });
        }
        currentDrawPoints = []; // Завершаем команду
        resetRectDimState();
        if (sketchHudTooltip) {
            sketchHudTooltip.style.display = 'none';
            sketchHudTooltip.innerHTML = '';
        }
    } else if (sketchTool === 'circle' && currentDrawPoints.length === 2) {
        const radius = currentDrawPoints[0].distanceTo(currentDrawPoints[1]);
        const geo = new THREE.CircleGeometry(radius, 64);
        const edges = new THREE.EdgesGeometry(geo, showRadialEdges ? 1 : 15);
        const circleLine = new THREE.LineSegments(edges, mat);
        circleLine.position.copy(currentDrawPoints[0]);
        circleLine.renderOrder = 1;
        circleLine.isSketchCircleMesh = true;
        alignToPlane(circleLine, activeSketchPlane);
        sketchGroup.add(circleLine);
        const newCirc = { center: currentDrawPoints[0].clone(), radius: radius };
        sketchCircles.push(newCirc);
        if (typeof window.autoMirrorPrimitive === 'function') window.autoMirrorPrimitive('circle', newCirc);
        currentDrawPoints = [];
    } else if (sketchTool === 'arc' && currentDrawPoints.length === 3) {
        // Построение дуги по трем точкам (P1 — Начало, P2 — Точка на дуге, P3 — Конец)
        const p1 = currentDrawPoints[0];
        const p2 = currentDrawPoints[1];
        const p3 = currentDrawPoints[2];

        if (p3.distanceTo(p1) > 1e-4 && p3.distanceTo(p2) > 1e-4) {
            const up = activeSketchPlane.userData.up ? activeSketchPlane.userData.up.clone().normalize() : new THREE.Vector3(0, 1, 0);
            const normal = activeSketchPlane.userData.normal ? activeSketchPlane.userData.normal.clone().normalize() : new THREE.Vector3(0, 0, 1);
            const right = new THREE.Vector3().crossVectors(up, normal).normalize();
            const origin = (activeSketchPlane.userData && activeSketchPlane.userData.origin) ? activeSketchPlane.userData.origin.clone() : new THREE.Vector3(0, 0, 0);

            const project = (p3d) => {
                const rel = p3d.clone().sub(origin);
                return new THREE.Vector2(rel.dot(right), rel.dot(up));
            };
            const unproject = (p2d) => {
                return origin.clone().add(right.clone().multiplyScalar(p2d.x)).add(up.clone().multiplyScalar(p2d.y));
            };

            const p1_2d = project(p1);
            const p2_2d = project(p2);
            const p3_2d = project(p3);

            const arcPts2D = calculate3PointArc(p1_2d, p2_2d, p3_2d, 50);
            const worldPts = arcPts2D.map(unproject);

            const geo = new THREE.BufferGeometry().setFromPoints(worldPts);
            const arcLine = new THREE.Line(geo, mat);
            arcLine.renderOrder = 1;
            sketchGroup.add(arcLine);

            for (let i = 0; i < worldPts.length - 1; i++) {
                const newArcSeg = { start: worldPts[i].clone(), end: worldPts[i+1].clone() };
                sketchSegments.push(newArcSeg);
                if (typeof window.autoMirrorPrimitive === 'function') window.autoMirrorPrimitive('segment', newArcSeg);
            }

            const arcEndpoints = [worldPts[0], worldPts[worldPts.length - 1]];
            arcEndpoints.forEach(p => { if (!sketchPoints.some(sp => sp.distanceTo(p) < 0.1)) sketchPoints.push(p.clone()); });
        }

        currentDrawPoints = [];
        if (sketchHudTooltip) {
            sketchHudTooltip.innerText = '[ Дуга: Укажите начало ]';
        }
    }

    // Если команда завершена (больше не нужно точек), скрываем фантом
    if (currentDrawPoints.length === 0 && tempShapePreview) {
        tempShapePreview.visible = false;
        tempShapePreview.geometry.setDrawRange(0, 0);
    }
    recomputeSketchCenters();
    if (typeof window.updateExtrudePhantom === 'function' && (document.getElementById('quick-input-extrude')?.classList.contains('active') || sketchExtrudePhantom)) {
        window.updateExtrudePhantom();
    }
}

function alignToPlane(mesh, activePlane) {
    if (activePlane) {
        mesh.quaternion.copy(activePlane.quaternion);
    }
}

function updateTempShape(pt) {
    // Фантом рисуется только в состоянии "Тяга"
    if (sketchState !== 1 || !tempShapePreview || !pt || currentDrawPoints.length === 0) {
        if (tempShapePreview) {
            tempShapePreview.visible = false;
            tempShapePreview.geometry.setDrawRange(0, 0);
        }
        return;
    }

    if (!tempShapePreview.visible) tempShapePreview.visible = true;
    
    if (tempShapePreview.material) {
        if (sketchTool === 'infiniline') {
            tempShapePreview.material.color.setHex(0x2563EB);
        } else {
            tempShapePreview.material.color.setHex(0x3355CC);
        }
        tempShapePreview.material.dashSize = 2;
        tempShapePreview.material.gapSize = 2;
    }
    
    const positions = tempShapePreview.geometry.attributes.position;
    let pointCount = 0;

    // Сбрасываем трансформацию объекта, т.к. точки считаются в мировых координатах
    tempShapePreview.position.set(0, 0, 0);
    tempShapePreview.quaternion.identity();

    switch (sketchTool) {
        case 'trim':
            positions.setXYZ(0, currentDrawPoints[0].x, currentDrawPoints[0].y, currentDrawPoints[0].z);
            positions.setXYZ(1, pt.x, pt.y, pt.z);
            pointCount = 2;
            break;
        case 'line': {
            const adjPt = getAdjustedLinePoint(pt);
            positions.setXYZ(0, currentDrawPoints[0].x, currentDrawPoints[0].y, currentDrawPoints[0].z);
            positions.setXYZ(1, adjPt.x, adjPt.y, adjPt.z);
            pointCount = 2;
            break;
        }
        case 'infiniline': {
            if (lineFirstPointBaseCircle && currentDrawPoints.length === 1) {
                const c = lineFirstPointBaseCircle;
                const center = c.center;
                let offsetVal = lineLockedOffset;
                if (offsetVal === null && lineOffsetStr.trim() !== '') {
                    const parsed = parseFloat(lineOffsetStr);
                    if (!isNaN(parsed)) offsetVal = parsed;
                }
                if (offsetVal === null) {
                    offsetVal = pt.distanceTo(center) - c.radius;
                }
                let radius = c.radius + offsetVal;
                if (radius < 0.1) radius = 0.1;

                const segments = 64;
                pointCount = segments + 1;
                const up = activeSketchPlane.userData.up;
                const right = new THREE.Vector3().crossVectors(up, activeSketchPlane.userData.normal).normalize();
                for (let i = 0; i <= segments; i++) {
                    const theta = (i / segments) * Math.PI * 2;
                    const pointOnCircle = center.clone()
                        .add(right.clone().multiplyScalar(radius * Math.cos(theta)))
                        .add(up.clone().multiplyScalar(radius * Math.sin(theta)));
                    positions.setXYZ(i, pointOnCircle.x, pointOnCircle.y, pointOnCircle.z);
                }
            } else if (lineFirstPointBaseSeg && currentDrawPoints.length === 1) {
                const p1 = currentDrawPoints[0];
                const seg = lineFirstPointBaseSeg;
                const segDir = seg.end.clone().sub(seg.start).normalize();
                const normal = activeSketchPlane.userData.normal ? activeSketchPlane.userData.normal.clone().normalize() : new THREE.Vector3(0, 0, 1);
                const segPerp = new THREE.Vector3().crossVectors(segDir, normal).normalize();

                const vCursor = pt.clone().sub(p1);
                let side = Math.sign(vCursor.dot(segPerp));
                if (side === 0) side = 1;

                let offsetVal = lineLockedOffset;
                if (offsetVal === null && lineOffsetStr.trim() !== '') {
                    const parsed = parseFloat(lineOffsetStr);
                    if (!isNaN(parsed)) offsetVal = parsed;
                }
                if (offsetVal === null) {
                    offsetVal = Math.abs(vCursor.dot(segPerp));
                }

                const originParallel = p1.clone().add(segPerp.clone().multiplyScalar(offsetVal * side));
                const start = originParallel.clone().sub(segDir.clone().multiplyScalar(100000));
                const end = originParallel.clone().add(segDir.clone().multiplyScalar(100000));
                positions.setXYZ(0, start.x, start.y, start.z);
                positions.setXYZ(1, end.x, end.y, end.z);
                pointCount = 2;
            } else {
                const p1 = currentDrawPoints[0];
                const adjPt = getAdjustedLinePoint(pt);
                const dir = adjPt.clone().sub(p1);
                if (dir.lengthSq() > 1e-6) {
                    dir.normalize();
                    const start = p1.clone().sub(dir.clone().multiplyScalar(100000));
                    const end = p1.clone().add(dir.clone().multiplyScalar(100000));
                    positions.setXYZ(0, start.x, start.y, start.z);
                    positions.setXYZ(1, end.x, end.y, end.z);
                    pointCount = 2;
                }
            }
            break;
        }
        case 'rectangle': {
            const p1 = currentDrawPoints[0];
            const p_current = getAdjustedRectPoint(pt); // p_current - диагональная точка с учетом зафиксированных размеров
            const geom = getModifiedRectangleGeometry(p1, p_current, activeSketchPlane, rectChamferVal, rectConcaveVal, rectFilletVal);
            const pts = geom.points;

            for (let i = 0; i < pts.length; i++) {
                positions.setXYZ(i, pts[i].x, pts[i].y, pts[i].z);
            }
            pointCount = pts.length;
            break;
        }
        case 'circle': {
            const center = currentDrawPoints[0];
            const radius = center.distanceTo(pt);
            pointCount = 0;
            if (radius > 0) {
                const segments = 64;
                pointCount = segments + 1;
                const up = activeSketchPlane.userData.up;
                const right = new THREE.Vector3().crossVectors(up, activeSketchPlane.userData.normal).normalize();
                for (let i = 0; i <= segments; i++) {
                    const theta = (i / segments) * Math.PI * 2;
                    const pointOnCircle = center.clone()
                        .add(right.clone().multiplyScalar(radius * Math.cos(theta)))
                        .add(up.clone().multiplyScalar(radius * Math.sin(theta)));
                    positions.setXYZ(i, pointOnCircle.x, pointOnCircle.y, pointOnCircle.z);
                }
            }
            break;
        }
        case 'arc': {
            if (currentDrawPoints.length === 1) {
                positions.setXYZ(0, currentDrawPoints[0].x, currentDrawPoints[0].y, currentDrawPoints[0].z);
                positions.setXYZ(1, pt.x, pt.y, pt.z);
                pointCount = 2;
            } else if (currentDrawPoints.length === 2) {
                const p1 = currentDrawPoints[0];
                const p2 = currentDrawPoints[1];
                const p3 = pt;

                const up = activeSketchPlane.userData.up ? activeSketchPlane.userData.up.clone().normalize() : new THREE.Vector3(0, 1, 0);
                const normal = activeSketchPlane.userData.normal ? activeSketchPlane.userData.normal.clone().normalize() : new THREE.Vector3(0, 0, 1);
                const right = new THREE.Vector3().crossVectors(up, normal).normalize();
                const origin = (activeSketchPlane.userData && activeSketchPlane.userData.origin) ? activeSketchPlane.userData.origin.clone() : new THREE.Vector3(0, 0, 0);

                const project = (p3d) => {
                    const rel = p3d.clone().sub(origin);
                    return new THREE.Vector2(rel.dot(right), rel.dot(up));
                };
                const unproject = (p2d) => {
                    return origin.clone().add(right.clone().multiplyScalar(p2d.x)).add(up.clone().multiplyScalar(p2d.y));
                };

                const p1_2d = project(p1);
                const p2_2d = project(p2);
                const p3_2d = project(p3);

                const arcPts2D = calculate3PointArc(p1_2d, p2_2d, p3_2d, 50);
                const worldPts = arcPts2D.map(unproject);

                pointCount = worldPts.length;
                for (let i = 0; i < worldPts.length; i++) {
                    positions.setXYZ(i, worldPts[i].x, worldPts[i].y, worldPts[i].z);
                }
            }
            break;
        }
    }

    tempShapePreview.geometry.setDrawRange(0, pointCount);
    positions.needsUpdate = true;
    // Критично для корректного отображения пунктира!
    tempShapePreview.computeLineDistances(); 
}

function saveSketchCommand() {
    if (typeof window.clearSketchSelection === 'function') window.clearSketchSelection();
    if (!sketchGroup || sketchGroup.children.length === 0) {
        showToast("Эскиз пуст");
        cancelSketch();
        return;
    }
    if(tempShapePreview) { creatorScene.remove(tempShapePreview); tempShapePreview = null; }
    if(snapMarker) snapMarker.visible = false;
    if (sketchHudTooltip) {
        sketchHudTooltip.style.display = 'none';
        sketchHudTooltip.innerText = '';
    }
    
    // Записываем данные для будущего выдавливания
    sketchGroup.userData = {
        isSketch: true,
        segments: sketchSegments.map(s => ({start: s.start.clone(), end: s.end.clone()})),
        circles: sketchCircles.map(c => ({center: c.center.clone(), radius: c.radius})),
        up: activeSketchPlane.userData.up.clone(),
        normal: activeSketchPlane.userData.normal.clone()
    };
    
    addPartToSpec(`Эскиз`, sketchGroup);
    
    // Выход из режима эскиза
    isSketchMode = false;
    sketchTool = null;
    sketchState = 0;
    window.activeMirrorLines = [];
    window.hoveredMirrorBaseAxis = null;
    if (typeof window.clearBaseAxisHoverHighlight === 'function') window.clearBaseAxisHoverHighlight();
    if (typeof window.renderActiveMirrorLines === 'function') window.renderActiveMirrorLines();
    document.querySelectorAll('.active-mirror-badge').forEach(b => b.remove());
    setCreatorUIMode('default');
    if (window.setCreatorActiveTool) window.setCreatorActiveTool(null);
    
    if (originPlanesGroup) { creatorScene.remove(originPlanesGroup); originPlanesGroup = null; }
    if (activeSketchPlane && activeSketchPlane.userData.name === 'CustomPlane') creatorScene.remove(activeSketchPlane);
    
    // Возврат перспективы
    currentCreatorCamera = creatorCamera;
    creatorControls.object = currentCreatorCamera;
    creatorControls.enableRotate = true;
    creatorControls.mouseButtons.RIGHT = THREE.MOUSE.PAN; // Возвращаем панорамирование ПКМ
    creatorControls.enableDamping = true; // Включаем инерцию обратно для 3D
    sketchPoints = [];
    sketchSegments = [];
    sketchCircles = [];
    sketchCenters = [];
    sketchArcCenters = [];
    trackedPoints = [];
    trackingCandidate = null;
    lastRemovedTrackedPt = null;
    activeTrackingRay = null;
    lastRectTrackingRay = null;
    activeSmartSnap = null;
    currentDrawPoints = [];
    activeSketchPlane = null;
    updateSmartSnapHUD();
}

// --- ВСТРОЕННЫЙ ДВИЖОК 3D-ИКОНОК ---
function init3DIcons() {
    const iconCanvas = document.createElement('canvas');
    iconCanvas.width = 256; // Ультравысокое разрешение для красоты и резкости
    iconCanvas.height = 256;
    
    const renderer = new THREE.WebGLRenderer({ canvas: iconCanvas, alpha: true, antialias: true });
    renderer.setClearColor(0x000000, 0);
    if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    if (THREE.ACESFilmicToneMapping) renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 4.5);
    camera.lookAt(0, 0, 0);

    // Добавляем премиальное студийное освещение
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x7D8A9A, 0.9);
    scene.add(hemiLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);
    const pointLight = new THREE.PointLight(0xffffff, 1.5, 20);
    pointLight.position.set(-4, -4, 5);
    scene.add(pointLight);

    // Функция создания меша иконки с нуля
    function createIconMesh(id) {
        const group = new THREE.Group();
        
        // Палитра премиальных глянцевых материалов (PhysicalMaterial)
        const mainMat = new THREE.MeshPhysicalMaterial({ color: 0x7D8A9A, metalness: 0.2, roughness: 0.4, clearcoat: 1.0, clearcoatRoughness: 0.1 });
        const darkMat = new THREE.MeshPhysicalMaterial({ color: 0x2A3142, metalness: 0.7, roughness: 0.2, clearcoat: 0.6 });
        const accentMat = new THREE.MeshPhysicalMaterial({ color: 0x3355CC, metalness: 0.4, roughness: 0.2, clearcoat: 0.8 });
        const redMat = new THREE.MeshPhysicalMaterial({ color: 0xE03030, metalness: 0.3, roughness: 0.2, clearcoat: 0.8 });
        const greenMat = new THREE.MeshPhysicalMaterial({ color: 0x5AAFDD, metalness: 0.3, roughness: 0.2, clearcoat: 0.8 });
        const edgeMat = new THREE.LineBasicMaterial({ color: 0x2A3142, linewidth: 2 });

        switch(id) {
            case 'plate':
                const plateGeo = new THREE.BoxGeometry(2.4, 0.4, 2.4);
                const plateMesh = new THREE.Mesh(plateGeo, mainMat);
                plateMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(plateGeo, 15), edgeMat));
                group.add(plateMesh);
                group.rotation.set(0.4, 0.4, 0);
                break;
            case 'cylinder':
                const cylGeo = new THREE.CylinderGeometry(1, 1, 2.4, 32);
                const cylMesh = new THREE.Mesh(cylGeo, mainMat);
                cylMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(cylGeo, 15), edgeMat));
                group.add(cylMesh);
                group.rotation.set(0.4, 0.4, 0);
                break;
            case 'pipe':
                const pipeShape = new THREE.Shape();
                pipeShape.absarc(0, 0, 1, 0, Math.PI * 2, false);
                const pipeHole = new THREE.Path();
                pipeHole.absarc(0, 0, 0.85, 0, Math.PI * 2, true); // тонкая стенка как у профиля
                pipeShape.holes.push(pipeHole);
                const pipeGeo = new THREE.ExtrudeGeometry(pipeShape, { depth: 30, bevelEnabled: false, curveSegments: 32 }); // длинный экструд
                const pipeMesh = new THREE.Mesh(pipeGeo, mainMat);
                pipeMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(pipeGeo, 15), edgeMat));
                group.add(pipeMesh);
                group.rotation.set(0.4, 0.4, 0);
                break;
            case 'bulbbar':
                const bbShape = createShapeFromBulgePoly(BulbProfiles["HP 200x12"] || BulbProfiles[Object.keys(BulbProfiles)[0]]);
                const bbGeo = new THREE.ExtrudeGeometry(bbShape, {depth: 30, bevelEnabled: false});
                const bbMesh = new THREE.Mesh(bbGeo, mainMat);
                bbMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(bbGeo, 15), edgeMat));
                group.add(bbMesh);
                group.rotation.set(0.4, 0.4, 0);
                break;
            case 'profile':
                const profShape = createShapeFromBulgePoly(BulbProfiles["HP 200x12"] || BulbProfiles[Object.keys(BulbProfiles)[0]]);
                const profGeo = new THREE.ExtrudeGeometry(profShape, {depth: 30, bevelEnabled: false});
                const profMesh = new THREE.Mesh(profGeo, mainMat);
                profMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(profGeo, 15), edgeMat));
                group.add(profMesh);
                group.rotation.set(0.4, 0.4, 0);
                break;
            case 'angle':
                const angleShape = createShapeFromBulgePoly(AngleProfiles["L 50x50x5"] || AngleProfiles[Object.keys(AngleProfiles)[0]]);
                const angleGeo = new THREE.ExtrudeGeometry(angleShape, {depth: 30, bevelEnabled: false});
                const angleMesh = new THREE.Mesh(angleGeo, mainMat);
                angleMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(angleGeo, 15), edgeMat));
                group.add(angleMesh);
                group.rotation.set(0.4, 0.4, 0);
                break;
            case 'channel':
                const chanPts = generateChannelPoints(...(ChannelParams["Швеллер 10П"] || [100, 46, 4.5, 7.6, 7, 4]));
                const chanShape = createShapeFromBulgePoly(chanPts);
                const chanGeo = new THREE.ExtrudeGeometry(chanShape, {depth: 30, bevelEnabled: false});
                const chanMesh = new THREE.Mesh(chanGeo, mainMat);
                chanMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(chanGeo, 15), edgeMat));
                group.add(chanMesh);
                group.rotation.set(0.4, 0.4, 0);
                break;
            case 'panel':
                const panGeo = new THREE.BoxGeometry(2.4, 0.2, 2.4);
                const panMesh = new THREE.Mesh(panGeo, mainMat);
                panMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(panGeo, 15), edgeMat));
                group.add(panMesh);
                [-0.6, 0.6].forEach(posX => {
                    const stGeo = new THREE.BoxGeometry(0.15, 0.8, 2.4);
                    const stMesh = new THREE.Mesh(stGeo, mainMat);
                    stMesh.position.set(posX, 0.5, 0);
                    stMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(stGeo, 15), edgeMat));
                    group.add(stMesh);
                });
                group.rotation.set(0.4, 0.4, 0);
                break;
            case 'msk':
                const mskOrigin = new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 32), darkMat);
                group.add(mskOrigin);
                const createAxis = (dir, color) => {
                    const arrGroup = new THREE.Group();
                    const endPoint = dir.clone().multiplyScalar(1.2);
                    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(), endPoint), 32, 0.1, 12), color);
                    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 32), color);
                    sphere.position.copy(endPoint);
                    arrGroup.add(tube, sphere);
                    return arrGroup;
                };
                group.add(createAxis(new THREE.Vector3(1, 0, 0), redMat));
                group.add(createAxis(new THREE.Vector3(0, 1, 0), greenMat));
                group.add(createAxis(new THREE.Vector3(0, 0, 1), accentMat));
                group.rotation.set(0.4, 0.5, 0);
                break;
            case 'face':
                const points = [
                    new THREE.Vector3(-0.8, -0.8, -0.8), new THREE.Vector3(0.8, -0.8, -0.8),
                    new THREE.Vector3(0.8, 0.8, -0.8), new THREE.Vector3(-0.8, 0.8, -0.8),
                    new THREE.Vector3(-0.8, -0.8, 0.8), new THREE.Vector3(0.8, -0.8, 0.8),
                    new THREE.Vector3(0.8, 0.8, 0.8), new THREE.Vector3(-0.8, 0.8, 0.8)
                ];
                const edges = [ [0,1],[1,2],[2,3],[3,0], [4,5],[5,6],[6,7],[7,4], [0,4],[1,5],[2,6],[3,7] ];
                edges.forEach(edge => {
                    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(points[edge[0]], points[edge[1]]), 2, 0.08, 8), darkMat);
                    group.add(tube);
                });
                const topFacePoints = [points[3], points[2], points[6], points[7]];
                const topFacePath = new THREE.CatmullRomCurve3(topFacePoints, true);
                const topFaceTube = new THREE.Mesh(new THREE.TubeGeometry(topFacePath, 32, 0.1, 8, true), accentMat);
                group.add(topFaceTube);
                group.rotation.set(0.4, 0.5, 0);
                break;
            case 'line':
                const tubeGeo = new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(-0.8, -0.8, 0), new THREE.Vector3(0.8, 0.8, 0)), 32, 0.15, 12, false);
                const lineMesh = new THREE.Mesh(tubeGeo, darkMat);
                const p1 = new THREE.Mesh(new THREE.SphereGeometry(0.25, 32, 32), accentMat);
                p1.position.set(-0.8, -0.8, 0);
                const p2 = new THREE.Mesh(new THREE.SphereGeometry(0.25, 32, 32), accentMat);
                p2.position.set(0.8, 0.8, 0);
                group.add(lineMesh, p1, p2);
                break;
            case 'circle':
                const circleGeo = new THREE.CircleGeometry(1.1, 64);
                const circleMesh = new THREE.Mesh(circleGeo, mainMat);
                const circleEdges = new THREE.EdgesGeometry(circleGeo);
                const circleLine = new THREE.LineSegments(circleEdges, edgeMat);
                group.add(circleMesh, circleLine);
                group.rotation.set(0.3, 0.3, 0);
                break;
            case 'arc':
                const arcTorus = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.15, 32, 64, Math.PI * 1.5), darkMat);
                arcTorus.rotation.z = Math.PI / 4;
                const ap1 = new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 32), accentMat);
                ap1.position.set(Math.cos(Math.PI/4)*0.8, Math.sin(Math.PI/4)*0.8, 0);
                const ap2 = new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 32), accentMat);
                ap2.position.set(Math.cos(Math.PI/4 + Math.PI*1.5)*0.8, Math.sin(Math.PI/4 + Math.PI*1.5)*0.8, 0);
                const apCenter = new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 32), greenMat);
                group.add(arcTorus, ap1, ap2, apCenter);
                group.rotation.set(0.2, 0.2, 0);
                break;
            case 'extrude':
                const bot = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.2, 32), mainMat);
                bot.position.y = -0.6;
                const top = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.2, 32), accentMat);
                top.position.y = 0.6;
                const midMat = new THREE.MeshPhysicalMaterial({ color: 0x3355CC, transparent: true, opacity: 0.3, roughness: 0.1, transmission: 0.9 });
                const mid = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1, 32), midMat);
                mid.position.y = 0;
                
                const extrArrow = new THREE.Group();
                const aCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.8, 16), redMat);
                aCyl.position.y = 0.4;
                const aCone = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.4, 16), redMat);
                aCone.position.y = 1.0;
                extrArrow.add(aCyl, aCone);
                extrArrow.position.x = 1.0;
                extrArrow.position.y = -0.4;

                group.add(bot, top, mid, extrArrow);
                group.rotation.set(0.4, -0.4, 0);
                break;
            case 'mate':
                const g1 = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), mainMat);
                g1.position.set(-0.5, 0, 0);
                const g2 = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), accentMat);
                g2.position.set(0.5, 0, 0);
                
                const arrGroup = new THREE.Group();
                const a1 = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.4, 16), greenMat);
                a1.position.set(-0.3, 0.7, 0);
                a1.rotation.z = -Math.PI / 2;
                const a2 = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.4, 16), redMat);
                a2.position.set(0.3, 0.7, 0);
                a2.rotation.z = Math.PI / 2;
                arrGroup.add(a1, a2);
                
                group.add(g1, g2, arrGroup);
                group.rotation.set(0.4, 0.4, 0);
                break;
            case 'gizmo':
                const makeAx = (dir, clr) => { const gr = new THREE.Group(); const p = dir.clone().multiplyScalar(1.2); const t = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(), p), 32, 0.1, 12), clr); const c = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.5, 16), clr); c.position.copy(p); c.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir); gr.add(t, c); return gr; };
                group.add(makeAx(new THREE.Vector3(1, 0, 0), redMat));
                group.add(makeAx(new THREE.Vector3(0, 1, 0), greenMat));
                group.add(makeAx(new THREE.Vector3(0, 0, 1), accentMat));
                group.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), mainMat));
                group.rotation.set(0.4, 0.5, 0);
                break;
            case 'knitsa':
                const knShape = new THREE.Shape();
                knShape.moveTo(0, 2.0); knShape.lineTo(0, 0.4); knShape.lineTo(0.4, 0);
                knShape.lineTo(2.0, 0); knShape.lineTo(2.0, 0.4); knShape.lineTo(0.4, 2.0); knShape.lineTo(0, 2.0);
                const knGeo = new THREE.ExtrudeGeometry(knShape, {depth: 0.2, bevelEnabled: false});
                const knMesh = new THREE.Mesh(knGeo, mainMat);
                knMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(knGeo, 15), edgeMat));
                const flgGeo = new THREE.BoxGeometry(2.26, 0.2, 0.8);
                const flgMesh = new THREE.Mesh(flgGeo, mainMat);
                flgMesh.rotation.z = -Math.PI / 4; 
                flgMesh.position.set(1.2, 1.2, 0.4);
                flgMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(flgGeo, 15), edgeMat));
                group.add(knMesh, flgMesh);
                group.rotation.set(0.2, 0.4, 0);
                break;
            case 'sketch_main':
                const smPlaneGeo = new THREE.PlaneGeometry(2.4, 2.4);
                const smPlaneMat = new THREE.MeshPhysicalMaterial({ color: 0x5AAFDD, metalness: 0.1, roughness: 0.8, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
                const smPlane = new THREE.Mesh(smPlaneGeo, smPlaneMat);
                smPlane.rotation.x = -Math.PI / 4;
                
                const smLineGeo = new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(-0.8, 0.1, -0.8), new THREE.Vector3(0.8, 0.1, 0.8)), 8, 0.08, 8, false);
                const smLine = new THREE.Mesh(smLineGeo, darkMat);
                
                const smCylGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.4, 16);
                const smCyl = new THREE.Mesh(smCylGeo, redMat);
                smCyl.position.set(0.8, 0.6, 0.8);
                smCyl.rotation.z = Math.PI / 4;
                
                group.add(smPlane, smLine, smCyl);
                group.rotation.set(0.3, 0.4, 0);
                break;
            case 'affine_main':
                const amCenter = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), mainMat);
                const makeAxisAm = (dir, color) => {
                    const gr = new THREE.Group();
                    const end = dir.clone().multiplyScalar(1.3);
                    const t = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(), end), 8, 0.08, 8), color);
                    const c = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.4, 16), color);
                    c.position.copy(end); c.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir);
                    gr.add(t, c); return gr;
                };
                const amRing = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.06, 16, 64), accentMat);
                amRing.rotation.x = Math.PI / 2;
                group.add(amCenter, makeAxisAm(new THREE.Vector3(1, 0, 0), redMat), makeAxisAm(new THREE.Vector3(0, 1, 0), greenMat), makeAxisAm(new THREE.Vector3(0, 0, 1), accentMat), amRing);
                group.rotation.set(0.5, 0.5, 0);
                break;
            case 'bend':
                const bendShape = new THREE.Shape();
                bendShape.moveTo(0, 0); bendShape.lineTo(2.0, 0); bendShape.lineTo(2.0, 0.4);
                bendShape.lineTo(0.4, 0.4); bendShape.lineTo(0.4, 2.0); bendShape.lineTo(0, 2.0);
                const bendGeo = new THREE.ExtrudeGeometry(bendShape, { depth: 2.0, bevelEnabled: false });
                const bendMesh = new THREE.Mesh(bendGeo, mainMat);
                bendMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(bendGeo, 15), edgeMat));
                group.add(bendMesh);
                group.rotation.set(0.3, 0.4, 0);
                break;
            case 'thickness':
                const thBase = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.2, 2.0), mainMat);
                const thTop = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.2, 2.0), accentMat);
                thTop.position.y = 0.8;
                const thArr = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 16), redMat);
                thArr.position.y = 0.3;
                const thCone = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.3, 16), redMat);
                thCone.position.y = 0.6;
                group.add(thBase, thTop, thArr, thCone);
                group.rotation.set(0.4, 0.4, 0);
                break;
        }

        const box = new THREE.Box3().setFromObject(group);
        const center = new THREE.Vector3();
        box.getCenter(center);
        
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 2.7 / (maxDim || 1); // Увеличенный масштаб
        
        group.scale.setScalar(scale);
        group.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
        
        return group;
    }

    function renderAndApply(id) {
        try {
            const mesh = createIconMesh(id);
            if (!mesh) return;

            scene.add(mesh);
            renderer.render(scene, camera);
            const dataUrl = iconCanvas.toDataURL('image/png');
            
            const img = document.getElementById('icon-' + id);
            if (img) {
                img.src = dataUrl;
                img.style.width = '48px';
                img.style.height = '48px';
                img.style.objectFit = 'contain';
            }
            
            // Дублируем иконку в круговое радиальное меню, если она там предусмотрена
            const radialImg = document.getElementById('radial-icon-' + id);
            if (radialImg) {
                radialImg.src = dataUrl;
            }

            // Дублируем иконку в плавающие окна (quick input panels)
            const quickImg = document.getElementById('quick-icon-' + id);
            if (quickImg) {
                quickImg.src = dataUrl;
            }

            scene.remove(mesh);
        } catch (err) {
            console.error('Error generating 3D icon for ' + id + ':', err);
        }
    }
    
    // Проходим по всем известным ID кнопок и рендерим 3D иконку из их координат
    ['plate', 'cylinder', 'pipe', 'panel', 'profile', 'bulbbar', 'angle', 'channel', 'bend', 'extrude', 'thickness', 'msk', 'face', 'line', 'circle', 'arc', 'mate', 'gizmo', 'knitsa', 'sketch_main', 'affine_main'].forEach(id => {
        renderAndApply(id);
    });

    renderer.dispose();
}

window.init3DIcons = init3DIcons;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => { if (typeof THREE !== 'undefined') init3DIcons(); }, 100);
    });
} else {
    setTimeout(() => { if (typeof THREE !== 'undefined') init3DIcons(); }, 100);
}

function cancelSketch() {
    if (window.editingMeshParentGroup) {
        window.editingMeshParentGroup.visible = true;
        window.editingMeshParentGroup = null;
    }
    if (window.editingMeshTarget) {
        window.editingMeshTarget.visible = true;
        window.editingMeshTarget = null;
    }
    resetRectDimState();
    resetLineCadDimState();
    if (typeof window.clearSketchSelection === 'function') window.clearSketchSelection();
    if (typeof window.clearExtrudePhantom === 'function') window.clearExtrudePhantom();
    if (sketchGroup) creatorScene.remove(sketchGroup);
    if (tempShapePreview) { creatorScene.remove(tempShapePreview); tempShapePreview = null; }
    if (sketchGroup) {
        disposeHierarchy(sketchGroup);
        sketchGroup = null;
    }
    if (tempShapePreview) {
        tempShapePreview.visible = false;
        tempShapePreview.geometry.setDrawRange(0, 0);
    }
    if (snapMarker) snapMarker.visible = false;
    if (sketchHudTooltip) {
        sketchHudTooltip.style.display = 'none';
        sketchHudTooltip.innerText = '';
    }
    sketchTool = null;
    isSketchMode = false;
    sketchState = 0;
    window.activeMirrorLines = [];
    window.hoveredMirrorBaseAxis = null;
    if (typeof window.clearBaseAxisHoverHighlight === 'function') window.clearBaseAxisHoverHighlight();
    if (typeof window.renderActiveMirrorLines === 'function') window.renderActiveMirrorLines();
    document.querySelectorAll('.active-mirror-badge').forEach(b => b.remove());
    setCreatorUIMode('default');
    if (window.setCreatorActiveTool) window.setCreatorActiveTool(null);
    
    if (originPlanesGroup) creatorScene.remove(originPlanesGroup);
    if (activeSketchPlane && (activeSketchPlane.userData.name === 'CustomPlane' || activeSketchPlane.userData.name === 'TopologyEditPlane')) creatorScene.remove(activeSketchPlane);
    if (originPlanesGroup) {
        disposeHierarchy(originPlanesGroup);
        originPlanesGroup = null;
    }
    if (activeSketchPlane && (activeSketchPlane.userData.name === 'CustomPlane' || activeSketchPlane.userData.name === 'TopologyEditPlane')) {
        disposeHierarchy(activeSketchPlane);
        activeSketchPlane = null;
    }
    currentCreatorCamera = creatorCamera;
    creatorControls.object = currentCreatorCamera;
    creatorControls.enableRotate = true;
    creatorControls.mouseButtons.RIGHT = THREE.MOUSE.PAN; // Возвращаем панорамирование ПКМ
    creatorControls.enableDamping = true; // Включаем инерцию обратно для 3D
    sketchPoints = [];
    sketchSegments = [];
    sketchCircles = [];
    sketchCenters = [];
    sketchArcCenters = [];
    activeSmartSnap = null;
    currentDrawPoints = [];
    activeSketchPlane = null;
    updateSmartSnapHUD();
    closeSketchRadialMenu();
}

function performExtrusion(segments, circles, up, normal, depth, draftAngle = 0) {
    const absDepth = Math.abs(depth);
    const right = new THREE.Vector3().crossVectors(up, normal).normalize();

    const origin = (activeSketchPlane && activeSketchPlane.userData && activeSketchPlane.userData.origin) 
        ? activeSketchPlane.userData.origin.clone() 
        : new THREE.Vector3(0, 0, 0);

    function project(pt) {
        const rel = pt.clone().sub(origin);
        return new THREE.Vector2(rel.dot(right), rel.dot(up));
    }

    let loops = [];
    let segs = segments
        .filter(s => !s.isInfinite && !s.isAuxiliary && !s.isStiffenerLine)
        .map(s => ({ start: project(s.start), end: project(s.end), used: false }));
    const TOL = 1.0; // Порог 1мм для авто-сшивания и сборки контура

    // Авто-сшивание точек в 2D перед сборкой
    for (let i = 0; i < segs.length; i++) {
        for (let j = i + 1; j < segs.length; j++) {
            if (segs[i].start.distanceTo(segs[j].start) < TOL) {
                const avg = segs[i].start.clone().add(segs[j].start).multiplyScalar(0.5);
                segs[i].start.copy(avg); segs[j].start.copy(avg);
            }
            if (segs[i].start.distanceTo(segs[j].end) < TOL) {
                const avg = segs[i].start.clone().add(segs[j].end).multiplyScalar(0.5);
                segs[i].start.copy(avg); segs[j].end.copy(avg);
            }
            if (segs[i].end.distanceTo(segs[j].start) < TOL) {
                const avg = segs[i].end.clone().add(segs[j].start).multiplyScalar(0.5);
                segs[i].end.copy(avg); segs[j].start.copy(avg);
            }
            if (segs[i].end.distanceTo(segs[j].end) < TOL) {
                const avg = segs[i].end.clone().add(segs[j].end).multiplyScalar(0.5);
                segs[i].end.copy(avg); segs[j].end.copy(avg);
            }
        }
    }
    
    for (let i = 0; i < segs.length; i++) {
        if (segs[i].used) continue;
        let loop = [segs[i].start, segs[i].end];
        segs[i].used = true;
        
        let currentStart = loop[0];
        let currentEnd = loop[loop.length - 1];
        let closed = false;
        
        let expanding = true;
        let safetyCount = 0;
        while (expanding && !closed) {
            if (safetyCount++ > 5000) {
                console.warn("performExtrusion stitch loop infinite loop guard triggered.");
                break;
            }
            expanding = false;

            // 1. Expand forward from currentEnd
            for (let j = 0; j < segs.length; j++) {
                if (!segs[j].used) {
                    if (segs[j].start.distanceTo(currentEnd) < TOL) {
                        currentEnd = segs[j].end;
                        loop.push(currentEnd);
                        segs[j].used = true;
                        expanding = true;
                        break;
                    } else if (segs[j].end.distanceTo(currentEnd) < TOL) {
                        currentEnd = segs[j].start;
                        loop.push(currentEnd);
                        segs[j].used = true;
                        expanding = true;
                        break;
                    }
                }
            }

            // Check if loop closed at currentEnd
            if (currentEnd.distanceTo(currentStart) < TOL && loop.length > 2) {
                closed = true;
                loop.pop();
                loops.push(loop);
                break;
            }

            // 2. Expand backward from currentStart
            for (let j = 0; j < segs.length; j++) {
                if (!segs[j].used) {
                    if (segs[j].end.distanceTo(currentStart) < TOL) {
                        currentStart = segs[j].start;
                        loop.unshift(currentStart);
                        segs[j].used = true;
                        expanding = true;
                        break;
                    } else if (segs[j].start.distanceTo(currentStart) < TOL) {
                        currentStart = segs[j].end;
                        loop.unshift(currentStart);
                        segs[j].used = true;
                        expanding = true;
                        break;
                    }
                }
            }

            // Check if loop closed at currentStart
            if (currentStart.distanceTo(currentEnd) < TOL && loop.length > 2) {
                closed = true;
                loop.pop();
                loops.push(loop);
                break;
            }
        }

        if (!closed && currentStart.distanceTo(currentEnd) < 2.0 && loop.length > 2) {
            closed = true;
            loop.pop();
            loops.push(loop);
        }
    }

    circles.forEach(c => {
        const center2d = project(c.center);
        const r = c.radius;
        const pts = [];
        for (let i = 0; i < 64; i++) {
            const a = (i / 64) * Math.PI * 2;
            pts.push(new THREE.Vector2(center2d.x + Math.cos(a) * r, center2d.y + Math.sin(a) * r));
        }
        loops.push(pts);
    });

    if (loops.length === 0) return null;

    function polygonArea(pts) {
        let area = 0;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            area += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
        }
        return Math.abs(area / 2);
    }

    // Сортируем контуры по площади. Самый большой контур будет основой.
    loops.sort((a, b) => polygonArea(b) - polygonArea(a));

    const outerLoop = loops[0];
    const shape = new THREE.Shape(outerLoop);

    // Все остальные контуры записываем в отверстия
    for (let i = 1; i < loops.length; i++) {
        shape.holes.push(new THREE.Path(loops[i]));
    }

    const extrudeSettings = { depth: absDepth, bevelEnabled: false };
    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    
    if (draftAngle !== 0) {
        const positionAttribute = geometry.attributes.position;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < positionAttribute.count; i++) {
            const x = positionAttribute.getX(i);
            const y = positionAttribute.getY(i);
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const rad = draftAngle * Math.PI / 180;
        const tan = Math.tan(rad);
        
        for (let i = 0; i < positionAttribute.count; i++) {
            const x = positionAttribute.getX(i);
            const y = positionAttribute.getY(i);
            const z = positionAttribute.getZ(i);
            const zDist = Math.abs(z);
            const dx = x - cx;
            const dy = y - cy;
            const r = Math.sqrt(dx * dx + dy * dy);
            
            if (r > 1e-4) {
                const scale = Math.max(0.01, 1 + (zDist * tan) / r);
                positionAttribute.setXY(i, cx + dx * scale, cy + dy * scale);
            }
        }
        geometry.computeVertexNormals();
    }

    if (depth < 0) {
        geometry.translate(0, 0, -absDepth); // Сдвигаем назад, если выдавливание отрицательное
    }

    const matrix = new THREE.Matrix4();
    matrix.makeBasis(right, up, normal);
    geometry.applyMatrix4(matrix);

    const material = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, metalness: 0.5, roughness: 0.4 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(origin);
    
    const edges = new THREE.EdgesGeometry(geometry, showRadialEdges ? 1 : 15);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x2A3142 }));
    mesh.add(line);

    mesh.userData.specData = {
        type: 'extrude',
        t: absDepth,
        th: absDepth,
        thickness: absDepth,
        wallThick: absDepth,
        depth: absDepth,
        broadNormal: normal.clone()
    };
    mesh.userData.sketchSource = {
        segments: segments.map(s => ({ start: s.start.clone(), end: s.end.clone(), isInfinite: s.isInfinite, color: s.color })),
        circles: circles.map(c => ({ center: c.center.clone(), radius: c.radius })),
        up: up.clone(),
        normal: normal.clone(),
        origin: origin.clone(),
        depth: depth,
        draftAngle: draftAngle
    };
    return mesh;
}

function extrudeSketchCommand() {
    if (typeof openExtrudePanel === 'function') {
        openExtrudePanel();
    }
}

// Функция удаления строки спецификации без удаления 3D моделей из сцены
window.deleteSpecRow = function(tr) {
    if (!tr) return;
    const rowId = tr.dataset.rowId;
    if (typeof creatorScene !== 'undefined' && creatorScene && rowId) {
        creatorScene.traverse(c => {
            if (c.isMesh && c.userData) {
                if (c.userData.specRowId === rowId || (c.userData.specRow && c.userData.specRow.dataset && c.userData.specRow.dataset.rowId === rowId)) {
                    delete c.userData.specRowId;
                    delete c.userData.specRow;
                }
            }
        });
    }
    if (tr.parentElement) {
        tr.parentElement.removeChild(tr);
    }
};

// Глобальная логика для удаления выделенных строк спецификации (3D модель сохраняется!)
document.addEventListener('keydown', function(e) {
    if (e.key === 'Delete') {
        const selectedRows = document.querySelectorAll('.spec-table-row.selected-row');
        if (selectedRows.length > 0) {
            // Не удалять строку, если фокус внутри текстового поля (пользователь редактирует текст)
            if (document.activeElement && document.activeElement.tagName === 'INPUT' && document.activeElement.selectionStart !== document.activeElement.selectionEnd) {
                return;
            }
            // Если выделены строки — удаляем их из спецификации (3D модель при этом сохраняется)
            selectedRows.forEach(r => {
                window.deleteSpecRow(r);
            });
            if (typeof window.refreshSpecTable === 'function') {
                window.refreshSpecTable();
            }
            if (typeof showToast === 'function') {
                showToast("Выделенные позиции удалены из спецификации (3D модели сохранены)");
            }
        }
    }
});

// --- ЛОГИКА НИЖНЕЙ ПАНЕЛИ СПЕЦИФИКАЦИИ ---
window.creatorBottomPanelOpen = false;
var creatorBottomPanelOpen = false;
function toggleCreatorBottomPanel(forceState) {
    if (typeof forceState === 'boolean') {
        window.creatorBottomPanelOpen = forceState;
    } else {
        window.creatorBottomPanelOpen = !window.creatorBottomPanelOpen;
    }
    creatorBottomPanelOpen = window.creatorBottomPanelOpen;
    const panel = document.getElementById('creator-bottom-panel');
    if (!panel) return;
    if (window.creatorBottomPanelOpen) {
        panel.style.height = '250px';
        panel.style.minHeight = '250px';
        panel.style.borderTop = '1px solid var(--border-light, #CBD5E1)';
    } else {
        panel.style.height = '0px';
        panel.style.minHeight = '0px';
        panel.style.borderTop = 'none';
    }
    // Уведомляем 3D-окружение, чтобы оно плавно пересчитало пропорции
    setTimeout(() => window.dispatchEvent(new Event('resize')), 310);
}
window.toggleCreatorBottomPanel = toggleCreatorBottomPanel;

window.isSpecCreated = false;

window.isRealUserDetailMesh = function(c) {
    if (!c) return false;

    // 0. Если это корневая группа панели (ПКО)
    if (c.userData && (c.userData.isPanel || c.userData.isUnifiedGroup || c.userData.specData?.type === 'panel')) {
        return true;
    }

    if (!c.isMesh || !c.geometry) return false;

    // Исключаем под-меши панели (лист и ребра входят в состав единого ПКО)
    if (c.userData && c.userData.parentUnifiedGroup) {
        return false;
    }
    if (c.parent && c.parent.userData && (c.parent.userData.isPanel || c.parent.userData.isUnifiedGroup)) {
        return false;
    }

    // 1. Проверяем иерархическую видимость в сцене
    let curr = c;
    while (curr) {
        if (curr.visible === false) return false;
        curr = curr.parent;
    }

    // 2. Исключаем элементы служебных плагинов и разметки
    if (c.userData) {
        if (c.userData.isSketchPlane || c.userData.isSketch || c.userData.isPhantom || 
            c.userData.isGrid || c.userData.isGizmo || c.userData.isHelper || 
            c.userData.isHoleHighlight || c.userData.isMateHighlight || c.userData.isSnapMarker || 
            c.userData.isDimension || c.userData.isTrackingGuide || c.userData.isProjLine) {
            return false;
        }
    }

    // 3. Проверяем родителей на принадлежность к сервисной группе
    curr = c;
    while (curr) {
        if (curr === customGizmo || curr === originPlanesGroup || 
            (typeof sketchGroup !== 'undefined' && curr === sketchGroup) ||
            (typeof mateHighlightGroup !== 'undefined' && curr === mateHighlightGroup) ||
            (typeof rectCadDimGroup !== 'undefined' && curr === rectCadDimGroup) ||
            (typeof sketchExtrudePhantom !== 'undefined' && curr === sketchExtrudePhantom) ||
            (typeof currentPipe3DPhantom !== 'undefined' && curr === currentPipe3DPhantom) ||
            (typeof snapMarker !== 'undefined' && curr === snapMarker)) {
            return false;
        }
        const name = curr.name || '';
        if (name.includes('gizmo') || name.includes('Gizmo') || name.includes('Helper') || 
            name.includes('Grid') || name.includes('Plane') || name.includes('plane') || 
            name.includes('phantom') || name.includes('Phantom') || name.includes('ghost') || 
            name.includes('Sketch') || name.includes('sketch') || name.includes('Axis') || 
            name.includes('Highlight') || name.includes('DimGroup') || name.includes('snap')) {
            return false;
        }
        curr = curr.parent;
    }

    // 4. Если у объекта есть явные признаки специфицируемой 3D-детали:
    if (c.userData && (c.userData.specData || c.userData.specRowId || c.userData.isSolidBody || 
                       c.userData.isExtrude || c.userData.isUserSolid || c.userData.isDetail || 
                       c.userData.isPlate || c.userData.isPipe || c.userData.isProfile || 
                       c.userData.isBentPlate || c.userData.hasBends)) {
        return true;
    }

    // 5. Проверка типа и параметров геометрии
    if (c.type === 'Mesh' && c.geometry.attributes && c.geometry.attributes.position && c.geometry.attributes.position.count > 0) {
        // Пропускаем слишком крупные плоскости построения (200x200 / 2000x2000)
        if (c.geometry.type === 'PlaneGeometry' && c.geometry.parameters && (c.geometry.parameters.width >= 100 || c.geometry.parameters.height >= 100)) {
            return false;
        }
        return true;
    }

    return false;
};

window.handleSpecCreateSave = function() {
    const btn = document.getElementById('btn-spec-create-save');
    const tbody = document.getElementById('spec-table-body');
    const isFirstTime = !window.isSpecCreated;
    
    if (isFirstTime) {
        window.isSpecCreated = true;
        if (btn) btn.innerText = 'Сохранить';
        if (tbody) {
            tbody.innerHTML = '';

            const validEntities = [];
            const visitedEntities = new Set();
            if (typeof creatorScene !== 'undefined' && creatorScene) {
                creatorScene.traverse(c => {
                    if (c.userData && (c.userData.isPanel || c.userData.isUnifiedGroup)) {
                        if (!visitedEntities.has(c)) {
                            visitedEntities.add(c);
                            validEntities.push(c);
                        }
                    } else if (window.isRealUserDetailMesh(c)) {
                        const unified = (typeof getUnifiedSelectableEntity === 'function') ? getUnifiedSelectableEntity(c) : null;
                        const ent = (unified && (unified.userData?.isPanel || unified.userData?.isUnifiedGroup)) ? unified : c;
                        if (!visitedEntities.has(ent)) {
                            visitedEntities.add(ent);
                            validEntities.push(ent);
                        }
                    }
                });
            }

            if (validEntities.length > 0) {
                validEntities.forEach(ent => {
                    window.autoAssignMeshToSpecTable(ent);
                });
            } else {
                // В 3D нет деталей - создаем ровно одну пустую позицию для заполнения вручную
                window.addSpecTableRow(tbody);
            }
        }
        if (typeof showToast === 'function') showToast("Спецификация создана");
    } else {
        if (tbody) {
            Array.from(tbody.children).forEach(tr => {
                if (window.autoCalculateMass) window.autoCalculateMass(tr);
                if (window.validateRowFor3D) window.validateRowFor3D(tr);
            });
        }
        if (typeof showToast === 'function') showToast("Спецификация сохранена");
    }
};

window.refreshSpecTable = function() {
    const tbody = document.getElementById('spec-table-body');
    if (!tbody) return;

    let splitsOccurred = false;

    // 1. Проверяем детали у каждой позиции и разделяем их, если геометрия/гибка/топология изменилась
    const initialRows = Array.from(tbody.children);
    initialRows.forEach(tr => {
        if (!tr.dataset.rowId) tr.dataset.rowId = window.generateSpecRowId();
        const linkedMeshes = window.getMeshesByRowId(creatorScene, tr.dataset.rowId);

        if (linkedMeshes.length > 1) {
            // Группируем детали по совпадению геометрии
            const groups = [];
            linkedMeshes.forEach(mesh => {
                let group = groups.find(g => window.areMeshesIdentical(g[0], mesh));
                if (group) {
                    group.push(mesh);
                } else {
                    groups.push([mesh]);
                }
            });

            if (groups.length > 1) {
                splitsOccurred = true;

                // Находим группу, которая сохраняет исходный статус строки tr (например, негнутый Лист)
                const trNameInput = tr.querySelector('td:nth-child(3) input');
                const trNameVal = trNameInput ? trNameInput.value.trim().toLowerCase() : '';

                let stayIndex = groups.findIndex(g => {
                    const info = window.extractMeshSpecInfo(g[0]);
                    if (!info) return false;
                    if (trNameVal && info.typeName.toLowerCase() === trNameVal) return true;
                    if (!info.isBent && (trNameVal === 'лист' || trNameVal === '')) return true;
                    return false;
                });

                if (stayIndex < 0) stayIndex = 0;

                const primaryGroup = groups[stayIndex];
                const splitGroups = groups.filter((g, idx) => idx !== stayIndex);

                // primaryGroup остается на исходной строке tr
                primaryGroup.forEach(m => { window.linkMeshToSpecRow(m, tr); });
                const qtyInput = tr.querySelector('td:nth-child(5) input');
                if (qtyInput) qtyInput.value = primaryGroup.length.toString();

                // Синхронизируем tr с её остающейся деталью
                const stayInfo = window.extractMeshSpecInfo(primaryGroup[0]);
                if (stayInfo) {
                    window.populateRowFromMeshInfo(tr, stayInfo);
                }

                // Изменившиеся (отколовшиеся) группы переносим в новые или подходящие существующие строки
                splitGroups.forEach(subGroup => {
                    const refMesh = subGroup[0];
                    let matchedOtherRow = null;
                    const currentRows = Array.from(tbody.children);
                    for (let otherTr of currentRows) {
                        if (otherTr === tr) continue;
                        if (!otherTr.dataset.rowId) otherTr.dataset.rowId = window.generateSpecRowId();
                        const otherMeshes = window.getMeshesByRowId(creatorScene, otherTr.dataset.rowId);
                        if (otherMeshes.length > 0 && window.areMeshesIdentical(otherMeshes[0], refMesh)) {
                            matchedOtherRow = otherTr;
                            break;
                        }
                    }

                    if (matchedOtherRow) {
                        subGroup.forEach(m => { window.linkMeshToSpecRow(m, matchedOtherRow); });
                        const updatedOtherMeshes = window.getMeshesByRowId(creatorScene, matchedOtherRow.dataset.rowId);
                        const qtyInp = matchedOtherRow.querySelector('td:nth-child(5) input');
                        if (qtyInp) qtyInp.value = updatedOtherMeshes.length.toString();
                        if (window.autoCalculateMass) window.autoCalculateMass(matchedOtherRow);
                    } else {
                        // Создаем новую позицию под изменившуюся деталь
                        const newTr = window.addSpecTableRow(tbody);
                        subGroup.forEach(m => { window.linkMeshToSpecRow(m, newTr); });
                        const qtyInp = newTr.querySelector('td:nth-child(5) input');
                        if (qtyInp) qtyInp.value = subGroup.length.toString();
                        const subInfo = window.extractMeshSpecInfo(subGroup[0]);
                        if (subInfo) window.populateRowFromMeshInfo(newTr, subInfo);
                        if (window.autoCalculateMass) window.autoCalculateMass(newTr);
                    }
                });
            }
        } else if (linkedMeshes.length >= 1) {
            // Если есть связанная(ые) деталь(и), синхронизируем количество, наименование и размеры с её текущим состоянием
            const qtyInput = tr.querySelector('td:nth-child(5) input');
            if (qtyInput) {
                qtyInput.value = linkedMeshes.length.toString();
                qtyInput.readOnly = true;
                qtyInput.title = "Количество управляется из 3D сцены";
            }
            const m0 = linkedMeshes[0];
            const info = window.extractMeshSpecInfo(m0);
            if (info) {
                window.populateRowFromMeshInfo(tr, info);
            }
        }
    });

    // 2. Удаляем пустые строки, созданные под 3D, если 3D-модели были полностью удалены
    Array.from(tbody.children).forEach(tr => {
        const btn = tr.querySelector('.btn-3d');
        const isSpawned = btn && btn.dataset.spawned === 'true';
        if (isSpawned) {
            let hasMesh = tr.dataset.rowId ? (window.getMeshesByRowId(creatorScene, tr.dataset.rowId).length > 0) : false;
            if (!hasMesh) {
                tr.remove();
            }
        }
    });

    // 3. Перенумеровываем позиции по порядку (1, 2, 3...)
    const remainingRows = Array.from(tbody.children);
    if (remainingRows.length === 0) return;

    let posCounter = 1;
    remainingRows.forEach(tr => {
        const posInput = tr.querySelector('td:nth-child(2) input');
        if (posInput) {
            posInput.value = posCounter.toString();
            posCounter++;
        }
        if (window.autoCalculateMass) window.autoCalculateMass(tr);
        if (window.validateRowFor3D) window.validateRowFor3D(tr);
    });

    if (typeof window.syncSpecTableQuantities === 'function') window.syncSpecTableQuantities();

    if (splitsOccurred) {
        if (typeof showToast === 'function') showToast("Позиции обновлены. Изменившиеся детали выделены в отдельные позиции!");
    } else {
        if (typeof showToast === 'function') showToast("Позиции спецификации обновлены");
    }
};

window.initSpecTable = function() {
    const tbody = document.getElementById('spec-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    window.isSpecCreated = false;
    const btn = document.getElementById('btn-spec-create-save');
    if (btn) btn.innerText = 'Создать';
};


window.isProfileObject = function(mesh) {
    if (!mesh || !mesh.isMesh) return false;
    if (mesh.userData && mesh.userData.isProfile) return true;
    if (mesh.userData && mesh.userData.specData) {
        const t = mesh.userData.specData.type;
        if (t === 'profile' || t === 'pipe' || t === 'bulbbar' || t === 'angle' || t === 'channel') return true;
    }
    const nameStr = (mesh.name || '').toLowerCase();
    if (nameStr.includes('полособульб') || nameStr.includes('уголок') || nameStr.includes('швеллер') || nameStr.includes('профиль') || nameStr.includes('труба')) return true;
    return false;
};

window.populateRowFromMeshInfo = function(tr, info) {
    if (!tr || !info) return;
    const nameInput = tr.querySelector('td:nth-child(3) input');
    const dimTd = tr.querySelector('td:nth-child(4)');
    const matInput = tr.querySelector('td:nth-child(6) input');

    if (nameInput) {
        const targetName = info.typeName || 'Лист';
        if (nameInput.value !== targetName) {
            nameInput.value = targetName;
            nameInput.dispatchEvent(new Event('input'));
        }
    }

    const cat = info.category || (nameInput ? getShapeCategory(nameInput.value.trim()) : 'plate');
    const dimInputs = Array.from(dimTd.querySelectorAll('input.spec-input'));

    if (cat === 'plate' && dimInputs.length === 3) {
        if (dimInputs[0]) dimInputs[0].value = (info.t !== undefined && info.t !== null) ? info.t : '';
        if (dimInputs[1]) dimInputs[1].value = (info.w !== undefined && info.w !== null) ? info.w : '';
        if (dimInputs[2]) dimInputs[2].value = (info.l !== undefined && info.l !== null) ? info.l : '';
    } else if (cat === 'pipe' && dimInputs.length === 3) {
        const dVal = (info.dOut !== undefined && info.dOut !== null) ? info.dOut : (info.d !== undefined ? info.d : '');
        if (dimInputs[0]) dimInputs[0].value = dVal;
        if (dimInputs[1]) dimInputs[1].value = (info.t !== undefined && info.t !== null) ? info.t : '';
        if (dimInputs[2]) dimInputs[2].value = (info.l !== undefined && info.l !== null) ? info.l : '';
    } else if (cat === 'cylinder' && dimInputs.length === 2) {
        const dVal = (info.d !== undefined && info.d !== null) ? info.d : (info.dOut !== undefined ? info.dOut : '');
        if (dimInputs[0]) dimInputs[0].value = dVal;
        if (dimInputs[1]) dimInputs[1].value = (info.l !== undefined && info.l !== null) ? info.l : '';
    } else if ((cat === 'bulbbar' || cat === 'angle' || cat === 'channel' || cat === 'profile') && dimInputs.length === 2) {
        if (dimInputs[0]) dimInputs[0].value = info.profileName || info.profName || info.name || '';
        if (dimInputs[1]) dimInputs[1].value = (info.l !== undefined && info.l !== null) ? info.l : '';
    } else if (cat === 'knitsa' && dimInputs.length === 3) {
        if (dimInputs[0]) dimInputs[0].value = (info.h !== undefined && info.h !== null) ? info.h : '';
        if (dimInputs[1]) dimInputs[1].value = (info.l !== undefined && info.l !== null) ? info.l : '';
        if (dimInputs[2]) dimInputs[2].value = (info.th !== undefined && info.th !== null) ? info.th : (info.t || '');
    } else if (dimInputs.length === 1) {
        dimInputs[0].value = info.size || '';
    }

    if (matInput && !matInput.value) {
        matInput.value = info.material || 'Сталь Ст3';
    }

    if (window.autoCalculateMass) window.autoCalculateMass(tr);
    if (window.validateRowFor3D) window.validateRowFor3D(tr);
};

window.extractMeshSpecInfo = function(mesh) {
    if (!mesh) return null;

    let specData = mesh.userData ? mesh.userData.specData : null;
    const meshName = (mesh.name || '').toLowerCase();
    const specName = (specData && specData.name) ? String(specData.name).toLowerCase() : '';
    const specType = (specData && (specData.type || specData.profileType)) ? String(specData.type || specData.profileType).toLowerCase() : '';

    // Обработка ПКО / Панелей (включая группы)
    if (mesh.userData && (mesh.userData.isPanel || specType === 'panel' || specName === 'пко' || meshName.includes('пко') || meshName.includes('панель') || specName.includes('панель'))) {
        const plateT = (specData && (specData.plateT || specData.t || specData.th)) || 10;
        const plateW = (specData && (specData.plateW || specData.w)) || 1000;
        const plateL = (specData && (specData.plateL || specData.l)) || 2000;
        const size = `${plateT}x${plateW}x${plateL}`;
        return {
            category: 'plate',
            typeName: 'ПКО',
            profileType: (specData && specData.profileType) || null,
            profileName: '',
            isBent: false,
            dOut: null,
            d: null,
            t: plateT,
            w: plateW,
            l: plateL,
            h: null,
            th: null,
            size: size,
            material: (specData && specData.material) || 'Сталь Ст3'
        };
    }

    if (!mesh.isMesh) return null;

    if (mesh.geometry && !mesh.geometry.boundingBox) {
        mesh.geometry.computeBoundingBox();
    }

    const box = mesh.geometry ? mesh.geometry.boundingBox : new THREE.Box3();
    const sx = Math.abs(mesh.scale ? mesh.scale.x : 1);
    const sy = Math.abs(mesh.scale ? mesh.scale.y : 1);
    const sz = Math.abs(mesh.scale ? mesh.scale.z : 1);

    const sizeX = Math.abs((box.max.x - box.min.x) * sx);
    const sizeY = Math.abs((box.max.y - box.min.y) * sy);
    const sizeZ = Math.abs((box.max.z - box.min.z) * sz);

    const sortedDims = [sizeX, sizeY, sizeZ].sort((a, b) => a - b);

    let isBent = false;
    if (mesh.userData) {
        if (mesh.userData.hasBends || mesh.userData.bends || (mesh.userData.bendsList && mesh.userData.bendsList.length > 0) || (specData && specData.type === 'bent_plate')) {
            isBent = true;
        }
    }

    // 1. Определение трубы
    const isPipe = specType === 'pipe' || meshName.includes('труба') || specName.includes('труба') || meshName.includes('pipe');
    
    // 2. Определение полособульба
    const isBulb = specType === 'bulbbar' || meshName.includes('полособульб') || specName.includes('полособульб') || (specData && (specData.profName || '').startsWith('HP')) || (specData && (specData.name || '').startsWith('HP'));
    
    // 3. Определение уголка
    const isAngle = specType === 'angle' || meshName.includes('уголок') || specName.includes('уголок') || (specData && (specData.profName || '').startsWith('L ')) || (specData && (specData.name || '').startsWith('L '));
    
    // 4. Определение швеллера
    const isChannel = specType === 'channel' || meshName.includes('швеллер') || specName.includes('швеллер');

    // 5. Определение круг / цилиндр
    const isCylinder = specType === 'cylinder' || meshName.includes('цилиндр') || meshName.includes('круг') || meshName.includes('пруток') || specName.includes('цилиндр');

    // 6. Определение кницы
    const isKnitsa = specType === 'knitsa' || meshName.includes('кница') || specName.includes('кница');

    let category = 'plate';
    let typeName = 'Лист';
    let profileType = null;
    let profileName = '';
    let dOut = null;
    let d = null;
    let t = null;
    let w = null;
    let l = null;
    let h = null;
    let th = null;
    let size = '';

    if (isPipe) {
        category = 'pipe';
        typeName = 'Труба';
        profileType = 'pipe';
        
        dOut = (specData && (specData.dOut !== undefined ? specData.dOut : specData.d)) || Math.round(sortedDims[1] * 10) / 10;
        let tVal = (specData && specData.t !== undefined) ? Math.abs(specData.t) : (specData && (specData.wallThick || specData.th) ? Math.abs(specData.wallThick || specData.th) : 3.5);
        t = Math.round(tVal * 10) / 10;
        l = (specData && specData.l !== undefined) ? specData.l : Math.round(sortedDims[2] * 10) / 10;
        dOut = Math.round(dOut * 10) / 10;
        l = Math.round(l * 10) / 10;
        profileName = `⌀${dOut}x${t}`;
        size = `⌀${dOut}x${t} L=${l}`;
        d = dOut;
    } else if (isBulb) {
        category = 'bulbbar';
        typeName = 'Полособульб';
        profileType = 'bulbbar';
        profileName = (specData && (specData.profName || specData.name)) || 'HP 100x6';
        l = (specData && specData.l !== undefined) ? specData.l : Math.round(sortedDims[2] * 10) / 10;
        l = Math.round(l * 10) / 10;
        size = `${profileName} L=${l}`;
    } else if (isAngle) {
        category = 'angle';
        typeName = 'Уголок';
        profileType = 'angle';
        profileName = (specData && (specData.profName || specData.name)) || 'L 75x75x6';
        l = (specData && specData.l !== undefined) ? specData.l : Math.round(sortedDims[2] * 10) / 10;
        l = Math.round(l * 10) / 10;
        size = `${profileName} L=${l}`;
    } else if (isChannel) {
        category = 'channel';
        typeName = 'Швеллер';
        profileType = 'channel';
        profileName = (specData && (specData.profName || specData.name)) || 'Швеллер 16П';
        l = (specData && specData.l !== undefined) ? specData.l : Math.round(sortedDims[2] * 10) / 10;
        l = Math.round(l * 10) / 10;
        size = `${profileName} L=${l}`;
    } else if (isCylinder) {
        category = 'cylinder';
        typeName = 'Цилиндр';
        profileType = 'cylinder';
        d = (specData && (specData.d !== undefined ? specData.d : specData.dOut)) || Math.round(sortedDims[0] * 10) / 10;
        l = (specData && specData.l !== undefined) ? specData.l : Math.round(sortedDims[2] * 10) / 10;
        d = Math.round(d * 10) / 10;
        l = Math.round(l * 10) / 10;
        profileName = `⌀${d}`;
        size = `⌀${d} L=${l}`;
    } else if (isKnitsa) {
        category = 'knitsa';
        typeName = 'Кница';
        h = (specData && specData.h !== undefined) ? specData.h : Math.round(sortedDims[1] * 10) / 10;
        l = (specData && specData.l !== undefined) ? specData.l : Math.round(sortedDims[2] * 10) / 10;
        th = (specData && (specData.th !== undefined ? specData.th : specData.t)) || Math.round(sortedDims[0] * 10) / 10;
        h = Math.round(h * 10) / 10;
        l = Math.round(l * 10) / 10;
        th = Math.round(th * 10) / 10;
        t = th;
        size = `${h}x${l} s=${th}`;
    } else {
        // Лист / Лист гнутый
        category = 'plate';
        typeName = isBent ? 'Лист гнутый' : 'Лист';

        let geomT, geomW, geomL;
        let uGeo = (isBent && mesh.userData) ? (mesh.userData.unfoldedBaseGeometry || mesh.userData.unfoldedGeometry) : null;
        if (isBent && !uGeo && mesh.userData && mesh.userData.bendsList && mesh.userData.bendsList.length > 0 && typeof window.rebuildObjectFromBends === 'function') {
            try { window.rebuildObjectFromBends(mesh); } catch(e) {}
            uGeo = mesh.userData ? (mesh.userData.unfoldedBaseGeometry || mesh.userData.unfoldedGeometry) : null;
        }

        if (isBent && uGeo) {
            if (!uGeo.boundingBox) uGeo.computeBoundingBox();
            const uBox = uGeo.boundingBox;
            const uDimX = Math.round(Math.abs((uBox.max.x - uBox.min.x) * sx) * 10) / 10;
            const uDimY = Math.round(Math.abs((uBox.max.y - uBox.min.y) * sy) * 10) / 10;
            const uDimZ = Math.round(Math.abs((uBox.max.z - uBox.min.z) * sz) * 10) / 10;

            if (uDimY <= uDimX && uDimY <= uDimZ) {
                geomT = uDimY; geomW = uDimX; geomL = uDimZ;
            } else if (uDimX <= uDimY && uDimX <= uDimZ) {
                geomT = uDimX; geomW = uDimY; geomL = uDimZ;
            } else {
                geomT = uDimZ; geomW = uDimX; geomL = uDimY;
            }
        } else {
            const dimX = Math.round(sizeX * 10) / 10;
            const dimY = Math.round(sizeY * 10) / 10;
            const dimZ = Math.round(sizeZ * 10) / 10;

            if (dimY <= dimX && dimY <= dimZ) {
                geomT = dimY; geomW = dimX; geomL = dimZ;
            } else if (dimX <= dimY && dimX <= dimZ) {
                geomT = dimX; geomW = dimY; geomL = dimZ;
            } else {
                geomT = dimZ; geomW = dimX; geomL = dimY;
            }
        }

        t = (specData && typeof specData.t === 'number' && specData.t > 0) ? specData.t : geomT;
        w = geomW;
        l = geomL;
        size = `${t}x${w}x${l}`;
    }

    // Сохраняем актуализированные параметры в mesh.userData.specData
    if (specData) {
        specData.category = category;
        specData.typeName = typeName;
        if (profileType) specData.profileType = profileType;
        if (profileName) specData.profileName = profileName;
        if (dOut !== null) specData.dOut = dOut;
        if (d !== null) specData.d = d;
        if (t !== null) specData.t = t;
        if (w !== null) specData.w = w;
        if (l !== null) specData.l = l;
        if (h !== null) specData.h = h;
        if (th !== null) specData.th = th;
        specData.size = size;
        if (isBent) {
            specData.type = 'bent_plate';
            specData.name = 'Лист гнутый';
        } else if (category === 'plate') {
            if (!specData.type || specData.type === 'bent_plate') specData.type = 'plate';
            if (!specData.name || specData.name === 'Лист гнутый') specData.name = 'Лист';
        }
    }

    return {
        category: category,
        typeName: typeName,
        profileType: profileType,
        profileName: profileName,
        isBent: isBent,
        dOut: dOut,
        d: d,
        t: t,
        w: w,
        l: l,
        h: h,
        th: th,
        size: size,
        material: (specData && specData.material) || 'Сталь Ст3'
    };
};

window.areMeshesIdentical = function(mesh1, mesh2) {
    if (!mesh1 || !mesh2) return false;
    if (mesh1 === mesh2) return true;

    const info1 = window.extractMeshSpecInfo(mesh1);
    const info2 = window.extractMeshSpecInfo(mesh2);
    if (!info1 || !info2) return false;

    if (info1.category !== info2.category) return false;
    if (info1.typeName !== info2.typeName) return false;
    if (info1.isBent !== info2.isBent) return false;

    // Сравнение параметров и количества гибов
    const bends1 = (mesh1.userData && mesh1.userData.bendsList) ? mesh1.userData.bendsList : [];
    const bends2 = (mesh2.userData && mesh2.userData.bendsList) ? mesh2.userData.bendsList : [];
    if (bends1.length !== bends2.length) return false;
    for (let i = 0; i < bends1.length; i++) {
        const b1 = bends1[i];
        const b2 = bends2[i];
        if (Math.abs((b1.angleDeg || 90) - (b2.angleDeg || 90)) > 0.1) return false;
        if (Math.abs((b1.length || b1.edgeWidth || 100) - (b2.length || b2.edgeWidth || 100)) > 0.5) return false;
    }

    // Сравнение топологии / количества вершин в геометрии (для 2D редактирования и вырезов)
    if (mesh1.geometry && mesh2.geometry) {
        const p1 = mesh1.geometry.attributes.position;
        const p2 = mesh2.geometry.attributes.position;
        if (p1 && p2 && p1.count !== p2.count) return false;
        const idx1 = mesh1.geometry.index;
        const idx2 = mesh2.geometry.index;
        if ((idx1 ? idx1.count : 0) !== (idx2 ? idx2.count : 0)) return false;
    }

    if (info1.category === 'plate') {
        if (Math.abs(info1.t - info2.t) > 0.5) return false;
        if (Math.abs(info1.w - info2.w) > 0.5) return false;
        if (Math.abs(info1.l - info2.l) > 0.5) return false;
    } else if (info1.category === 'pipe') {
        const d1 = info1.dOut || info1.d || 0;
        const d2 = info2.dOut || info2.d || 0;
        if (Math.abs(d1 - d2) > 0.5) return false;
        if (Math.abs((info1.t || 0) - (info2.t || 0)) > 0.2) return false;
        if (Math.abs((info1.l || 0) - (info2.l || 0)) > 0.5) return false;
    } else if (info1.category === 'cylinder') {
        const d1 = info1.d || info1.dOut || 0;
        const d2 = info2.d || info2.dOut || 0;
        if (Math.abs(d1 - d2) > 0.5) return false;
        if (Math.abs((info1.l || 0) - (info2.l || 0)) > 0.5) return false;
    } else if (info1.category === 'knitsa') {
        if (Math.abs((info1.h || 0) - (info2.h || 0)) > 0.5) return false;
        if (Math.abs((info1.l || 0) - (info2.l || 0)) > 0.5) return false;
        if (Math.abs((info1.th || info1.t || 0) - (info2.th || info2.t || 0)) > 0.2) return false;
    } else if (['bulbbar', 'angle', 'channel', 'profile'].includes(info1.category)) {
        if (info1.profileName && info2.profileName && info1.profileName !== info2.profileName) return false;
        if (Math.abs((info1.l || 0) - (info2.l || 0)) > 0.5) return false;
    } else {
        if (Math.abs((info1.t || 0) - (info2.t || 0)) > 0.5) return false;
        if (Math.abs((info1.l || 0) - (info2.l || 0)) > 0.5) return false;
    }

    return true;
};

window.linkSpecRowToMesh = function(tr, mesh) {
    if (!mesh || !tr) return;

    if (!tr.dataset.rowId) tr.dataset.rowId = window.generateSpecRowId();
    mesh.userData.specRowId = tr.dataset.rowId;

    const posInput = tr.querySelector('td:nth-child(2) input');
    const posNum = posInput ? posInput.value.trim() : '';

    const existingMeshes = window.getMeshesByRowId(creatorScene, tr.dataset.rowId);

    if (existingMeshes.includes(mesh) && existingMeshes.length > 1) {
        if (typeof showToast === 'function') showToast(`Деталь уже привязана к позиции ${posNum}`);
        return;
    }

    const info = window.extractMeshSpecInfo(mesh);
    if (!info) return;

    if (existingMeshes.length > 1) {
        // Проверка совпадения габаритов со второй деталью
        const baseMesh = existingMeshes[0];
        const isIdentical = window.areMeshesIdentical(baseMesh, mesh);

        if (isIdentical) {
            window.linkMeshToSpecRow(mesh, tr);
            const newCount = existingMeshes.length;
            const qtyInput = tr.querySelector('td:nth-child(5) input');
            if (qtyInput) {
                qtyInput.value = newCount.toString();
            }
            if (window.autoCalculateMass) window.autoCalculateMass(tr);

            if (typeof showToast === 'function') {
                showToast(`Детали совпадают по габаритам! Добавлена к позиции ${posNum} (Количество: ${newCount})`);
            }
        } else {
            const baseInfo = window.extractMeshSpecInfo(baseMesh);
            if (typeof showToast === 'function') {
                showToast(`Различаются габариты или тип! Позиция ${posNum} (${baseInfo ? baseInfo.typeName : ''}) не совпадает с деталью (${info.typeName})`);
            }
            return;
        }
    } else {
        window.linkMeshToSpecRow(mesh, tr);
        window.populateRowFromMeshInfo(tr, info);

        let qtyInput = tr.querySelector('td:nth-child(5) input');
        if (qtyInput && (!qtyInput.value || qtyInput.value === '0')) qtyInput.value = '1';

        if (typeof showToast === 'function') {
            showToast(`Деталь (${info.typeName}) успешно привязана к позиции ${posNum}`);
        }
    }

    const inputs = Array.from(tr.querySelectorAll('input.spec-input'));
    inputs.forEach(input => {
        input.style.transition = 'background-color 0.5s';
        input.style.backgroundColor = 'rgba(255, 215, 0, 0.4)';
        setTimeout(() => {
            input.style.backgroundColor = 'transparent';
            setTimeout(() => { input.style.transition = ''; }, 500);
        }, 300);
    });
};

window.autoAssignMeshToSpecTable = function(mesh, scene) {
    if (!window.isSpecCreated) return null;
    if (!mesh || (!mesh.isMesh && !mesh.isGroup && !(mesh.userData && mesh.userData.isPanel))) return null;
    if (typeof window.isRealUserDetailMesh === 'function' && !window.isRealUserDetailMesh(mesh)) return null;
    if (!scene) scene = (typeof creatorScene !== 'undefined' ? creatorScene : null);

    // 1. Сначала проверяем, жива ли еще привязка по ID
    let tr = window.getSpecRowByMesh(mesh);
    if (tr) {
        window.updateRow3DStatus(tr);
        return tr;
    }

    // 2. Если ID нет или строка удалена — ищем по мягкому совпадению (Fallback)
    const meshInfo = window.extractMeshSpecInfo ? window.extractMeshSpecInfo(mesh) : null;
    const tbody = document.getElementById('spec-table-body');
    const rows = tbody ? Array.from(tbody.children) : [];

    if (meshInfo) {
        const mName = (meshInfo.typeName || meshInfo.name || '').trim();
        const mSize = (meshInfo.size || meshInfo.profileName || '').trim();

        for (let r of rows) {
            const nameInput = r.querySelector('td:nth-child(3) input');
            const sizeInputs = Array.from(r.querySelector('td:nth-child(4)').querySelectorAll('input.spec-input'));

            if (nameInput && sizeInputs.length > 0) {
                const rName = nameInput.value.trim();
                if (rName && rName.toLowerCase() === mName.toLowerCase()) {
                    // Проверяем совпадение габаритов
                    let matches = true;
                    if (meshInfo.category === 'plate' && sizeInputs.length === 3) {
                        if (parseFloat(sizeInputs[0].value) !== meshInfo.t || parseFloat(sizeInputs[1].value) !== meshInfo.w || parseFloat(sizeInputs[2].value) !== meshInfo.l) matches = false;
                    } else if (meshInfo.category === 'pipe' && sizeInputs.length === 3) {
                        if (parseFloat(sizeInputs[0].value) !== (meshInfo.dOut || meshInfo.d) || parseFloat(sizeInputs[1].value) !== meshInfo.t || parseFloat(sizeInputs[2].value) !== meshInfo.l) matches = false;
                    } else if (['bulbbar', 'angle', 'channel'].includes(meshInfo.category) && sizeInputs.length === 2) {
                        if (sizeInputs[0].value.trim() !== meshInfo.profileName || parseFloat(sizeInputs[1].value) !== meshInfo.l) matches = false;
                    }
                    if (matches) {
                        window.linkMeshToSpecRow(mesh, r);
                        return r;
                    }
                }
            }
        }
    }

    // Также проверяем идентичность с другими 3D объектами существующих строк
    if (tbody && scene) {
        for (let trRow of rows) {
            if (!trRow.dataset.rowId) trRow.dataset.rowId = window.generateSpecRowId();
            const existingMeshes = window.getMeshesByRowId(scene, trRow.dataset.rowId);
            if (existingMeshes.length > 0) {
                const m0 = existingMeshes[0];
                if (window.areMeshesIdentical(m0, mesh)) {
                    window.linkMeshToSpecRow(mesh, trRow);
                    return trRow;
                }
            }
        }
    }

    // 3. Если совпадений нет вообще — создаем новую строку и наполняем её через populateRowFromMeshInfo
    const newTr = window.addSpecTableRow(tbody);
    if (meshInfo) {
        window.populateRowFromMeshInfo(newTr, meshInfo);
    }
    window.linkMeshToSpecRow(mesh, newTr);
    return newTr;
};

window.selectSpecRowAndFocus3D = function(tr, options = {}) {
    if (!tr) return;
    const isMultiSelect = options.ctrlKey || options.shiftKey;

    const tbNode = tr.parentElement;
    if (tbNode) {
        if (!isMultiSelect) {
            Array.from(tbNode.children).forEach(r => r.classList.remove('selected-row'));
            tr.classList.add('selected-row');
        } else if (options.ctrlKey) {
            tr.classList.toggle('selected-row');
        } else if (options.shiftKey) {
            const allRows = Array.from(tbNode.children);
            let lastIdx = allRows.findIndex(r => r.classList.contains('selected-row'));
            if (lastIdx === -1) lastIdx = 0;
            const curIdx = allRows.indexOf(tr);
            const min = Math.min(lastIdx, curIdx);
            const max = Math.max(lastIdx, curIdx);
            allRows.forEach(r => r.classList.remove('selected-row'));
            for (let i = min; i <= max; i++) allRows[i].classList.add('selected-row');
        }
    } else {
        tr.classList.add('selected-row');
    }

    const selectedRows = tbNode ? Array.from(tbNode.querySelectorAll('.spec-table-row.selected-row')) : [tr];

    // Deselect current 3D objects (restoring original colors)
    if (typeof selectedObjects !== 'undefined' && selectedObjects) {
        selectedObjects.forEach(obj => {
            setEntitySelectionColor(obj, false);
        });
        selectedObjects = [];
    }

    // Find all 3D entities associated with all selected spec rows
    const targetEntities = new Set();
    if (typeof creatorScene !== 'undefined' && creatorScene) {
        const selectedRowIds = selectedRows.map(r => r.dataset.rowId).filter(Boolean);
        creatorScene.traverse(c => {
            if (c.userData) {
                const rId = c.userData.specRowId || (c.userData.specRow && c.userData.specRow.dataset ? c.userData.specRow.dataset.rowId : null);
                if (rId && selectedRowIds.includes(rId)) {
                    const unified = getUnifiedSelectableEntity(c);
                    targetEntities.add(unified || c);
                }
            }
        });
    }

    // Highlight target entities
    targetEntities.forEach(ent => {
        setEntitySelectionColor(ent, true);
        selectedObjects.push(ent);
    });

    // Move gizmo to center
    if (selectedObjects.length > 0 && typeof customGizmo !== 'undefined' && customGizmo) {
        const box = new THREE.Box3();
        selectedObjects.forEach(m => box.expandByObject(m));
        const center = box.getCenter(new THREE.Vector3());
        customGizmo.position.copy(center);
        customGizmo.visible = true;
        if (typeof gizmoState !== 'undefined') gizmoState = 2;
    } else if (typeof customGizmo !== 'undefined' && customGizmo) {
        customGizmo.visible = false;
    }

    // Camera zoom / framing to fit target entities
    const targetArray = Array.from(targetEntities);
    if (targetArray.length > 0 && typeof creatorCamera !== 'undefined' && creatorCamera && typeof creatorControls !== 'undefined' && creatorControls) {
        const box = new THREE.Box3();
        targetArray.forEach(mesh => box.expandByObject(mesh));

        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z, 20);

        const fov = (creatorCamera.fov || 45) * (Math.PI / 180);
        let dist = (maxDim / 2) / Math.tan(fov / 2);
        dist = Math.max(dist * 1.5, 60);

        const dir = new THREE.Vector3().subVectors(creatorCamera.position, creatorControls.target);
        if (dir.lengthSq() < 0.0001) dir.set(1, 1, 1);
        dir.normalize();

        const newPos = center.clone().add(dir.multiplyScalar(dist));

        creatorControls.target.copy(center);
        creatorCamera.position.copy(newPos);
        if (typeof creatorOrthoCamera !== 'undefined' && creatorOrthoCamera) {
            creatorOrthoCamera.position.copy(newPos);
        }
        creatorControls.update();
    }
};

// === КОМАНДЫ СЕГМЕНТА "ВИД" И ВИДОВОЙ КУБ (VIEW CUBE) ===
window.showAnnotations = true;
window.showFilletLines = true;
window.isViewCubeActive = false;

window.toggleAnnotations = function(btn) {
    window.showAnnotations = !window.showAnnotations;
    if (btn) btn.classList.toggle('toggle-active', window.showAnnotations);
    
    // Синхронизируем состояния всех элементов UI
    const radBtn1 = document.getElementById('radial-toggle-annotations');
    const radBtn2 = document.getElementById('sketch-radial-toggle-annotations');
    const toggleChk = document.getElementById('toggle-annotations');
    if (radBtn1) radBtn1.classList.toggle('toggle-active', window.showAnnotations);
    if (radBtn2) radBtn2.classList.toggle('toggle-active', window.showAnnotations);
    if (toggleChk) toggleChk.checked = window.showAnnotations;
    
    const dimGroup = (typeof creatorScene !== 'undefined' && creatorScene) ? creatorScene.getObjectByName('dimensionsGroup') : null;
    if (dimGroup) dimGroup.visible = window.showAnnotations;
    
    const hudHud = document.getElementById('smart-snap-hud');
    if (hudHud) hudHud.style.display = window.showAnnotations ? 'block' : 'none';
    
    const labelsContainer = document.getElementById('creator-labels-container');
    if (labelsContainer) labelsContainer.style.display = window.showAnnotations ? 'block' : 'none';
    
    if (typeof showToast === 'function') {
        showToast(`Аннотации: ${window.showAnnotations ? 'Включены' : 'Выключены'}`);
    }
};

window.toggleFilletLines = function(btn) {
    window.showFilletLines = !window.showFilletLines;
    if (btn) btn.classList.toggle('toggle-active', window.showFilletLines);
    
    const radBtn1 = document.getElementById('radial-toggle-fillet-lines');
    const radBtn2 = document.getElementById('sketch-radial-toggle-fillet-lines');
    const toggleChk = document.getElementById('toggle-radial-edges');
    if (radBtn1) radBtn1.classList.toggle('toggle-active', window.showFilletLines);
    if (radBtn2) radBtn2.classList.toggle('toggle-active', window.showFilletLines);
    if (toggleChk) toggleChk.checked = window.showFilletLines;
    
    if (typeof creatorScene !== 'undefined' && creatorScene) {
        creatorScene.traverse(c => {
            if (c.userData && c.userData.isFilletLine) {
                c.visible = window.showFilletLines;
            }
        });
    }
    
    if (typeof showToast === 'function') {
        showToast(`Линии на скруглениях: ${window.showFilletLines ? 'Включены' : 'Выключены'}`);
    }
};

window.openViewCube = function() {
    window.isViewCubeActive = true;
    const widget = document.getElementById('view-cube-widget');
    if (widget) widget.style.display = 'flex';
    
    // Переключаем в режим аксонометрии/изометрии (ортогональный вид без угла схождения)
    if (typeof creatorOrthoCamera !== 'undefined' && creatorOrthoCamera) {
        currentCreatorCamera = creatorOrthoCamera;
        if (typeof creatorControls !== 'undefined' && creatorControls) {
            creatorControls.object = currentCreatorCamera;
        }
    }
    
    if (window.updateViewCubeOrientation) {
        window.updateViewCubeOrientation();
    }
    
    initViewCubeEvents();
    
    if (typeof showToast === 'function') {
        showToast('Видовой куб активирован (Изометрия / Ортогональный вид)');
    }
};

window.closeViewCube = function() {
    window.isViewCubeActive = false;
    const widget = document.getElementById('view-cube-widget');
    if (widget) widget.style.display = 'none';
    
    if (typeof showToast === 'function') {
        showToast('Видовой куб закрыт');
    }
};

window.updateViewCubeOrientation = function() {
    const cubeEl = document.getElementById('view-cube-3d');
    if (!cubeEl || !window.isViewCubeActive) return;
    
    const camera = (typeof currentCreatorCamera !== 'undefined' && currentCreatorCamera) ? currentCreatorCamera : creatorCamera;
    if (!camera) return;

    // Извлекаем вращение камеры из инверсной матрицы вида
    const matrix = new THREE.Matrix4();
    matrix.extractRotation(camera.matrixWorldInverse);
    
    const e = matrix.elements;
    // В CSS 3D ось Y направлена вниз (в отличие от Three.js, где Y вверх).
    // Сопряжение с Sy = diag(1, -1, 1, 1) исправляет инверсию верх/низ и Север/Юг:
    const cssMatrix = [
        e[0],  -e[1], e[2],  e[3],
       -e[4],   e[5], -e[6], e[7],
        e[8],  -e[9], e[10], e[11],
        e[12], e[13], e[14], e[15]
    ].join(',');
    
    cubeEl.style.transform = `matrix3d(${cssMatrix})`;
};

window.handleCubeFaceClick = function(faceName, e) {
    if (e) e.stopPropagation();
    
    // Гарантируем ортогональный вид (изометрия / без угла схождения)
    if (typeof creatorOrthoCamera !== 'undefined' && creatorOrthoCamera) {
        currentCreatorCamera = creatorOrthoCamera;
        if (typeof creatorControls !== 'undefined' && creatorControls) {
            creatorControls.object = currentCreatorCamera;
        }
    }
    
    if (typeof set3DView === 'function') {
        set3DView(faceName);
    }
    
    if (window.updateViewCubeOrientation) {
        window.updateViewCubeOrientation();
    }
};

let _isCubeEventsInited = false;
function initViewCubeEvents() {
    if (_isCubeEventsInited) return;
    _isCubeEventsInited = true;
    
    const viewport = document.getElementById('view-cube-viewport');
    const cubeHeader = document.getElementById('view-cube-header');
    const cubeWidget = document.getElementById('view-cube-widget');
    
    // --- Логика переноса самого окна видового куба по экрану ---
    if (cubeHeader && cubeWidget) {
        let isCubeWinDragging = false;
        let winStartX = 0, winStartY = 0;
        let winInitLeft = 0, winInitTop = 0;

        cubeHeader.addEventListener('mousedown', (e) => {
            if (e.target.closest('button')) return;
            isCubeWinDragging = true;
            winStartX = e.clientX;
            winStartY = e.clientY;

            const rect = cubeWidget.getBoundingClientRect();
            winInitLeft = rect.left;
            winInitTop = rect.top;

            cubeWidget.style.right = 'auto';
            cubeWidget.style.transform = 'none';
            cubeWidget.style.left = winInitLeft + 'px';
            cubeWidget.style.top = winInitTop + 'px';
            cubeWidget.style.cursor = 'grabbing';
            cubeHeader.style.cursor = 'grabbing';
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isCubeWinDragging) return;
            const dx = e.clientX - winStartX;
            const dy = e.clientY - winStartY;

            let newLeft = winInitLeft + dx;
            let newTop = winInitTop + dy;

            const maxLeft = window.innerWidth - cubeWidget.offsetWidth - 10;
            const maxTop = window.innerHeight - cubeWidget.offsetHeight - 10;
            newLeft = Math.max(10, Math.min(newLeft, maxLeft));
            newTop = Math.max(10, Math.min(newTop, maxTop));

            cubeWidget.style.left = newLeft + 'px';
            cubeWidget.style.top = newTop + 'px';
        });

        window.addEventListener('mouseup', () => {
            if (isCubeWinDragging) {
                isCubeWinDragging = false;
                if (cubeWidget) cubeWidget.style.cursor = 'default';
                if (cubeHeader) cubeHeader.style.cursor = 'grab';
            }
        });
    }

    if (!viewport) return;
    
    let isCubeDragging = false;
    let cubePrevMouseX = 0;
    let cubePrevMouseY = 0;
    
    viewport.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('cube-face')) return;
        isCubeDragging = true;
        cubePrevMouseX = e.clientX;
        cubePrevMouseY = e.clientY;
        viewport.style.cursor = 'grabbing';
    });
    
    window.addEventListener('mousemove', (e) => {
        if (!isCubeDragging || !window.isViewCubeActive) return;
        const deltaX = e.clientX - cubePrevMouseX;
        const deltaY = e.clientY - cubePrevMouseY;
        cubePrevMouseX = e.clientX;
        cubePrevMouseY = e.clientY;
        
        const camera = (typeof currentCreatorCamera !== 'undefined' && currentCreatorCamera) ? currentCreatorCamera : creatorCamera;
        if (!camera || typeof creatorControls === 'undefined' || !creatorControls) return;
        
        const target = creatorControls.target;
        const offset = camera.position.clone().sub(target);
        
        // Вращаем вокруг вертикальной оси (Y)
        const yawAngle = -deltaX * 0.008;
        offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), yawAngle);
        
        // Вращаем вокруг правого вектора камеры (pitch)
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const pitchAngle = -deltaY * 0.008;
        offset.applyAxisAngle(right, pitchAngle);
        
        camera.position.copy(target.clone().add(offset));
        camera.lookAt(target);
        creatorControls.update();
        
        if (window.updateViewCubeOrientation) window.updateViewCubeOrientation();
    });
    
    window.addEventListener('mouseup', () => {
        if (isCubeDragging) {
            isCubeDragging = false;
            if (viewport) viewport.style.cursor = 'grab';
        }
    });
    
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && window.isViewCubeActive) {
            window.closeViewCube();
        }
    });
}

window.set3DView = function(viewType) {
    if (typeof creatorCamera === 'undefined' || !creatorCamera || typeof creatorControls === 'undefined' || !creatorControls) return;

    // Считаем габаритный бокс всех 3D моделей сцены
    const box = new THREE.Box3();
    let count = 0;
    if (typeof creatorScene !== 'undefined' && creatorScene) {
        creatorScene.traverse(c => {
            if (typeof window.isRealUserDetailMesh === 'function') {
                if (window.isRealUserDetailMesh(c)) {
                    box.expandByObject(c);
                    count++;
                }
            } else if (c.isMesh && c.visible && !c.userData.isSketchPlane && !c.userData.isSketch) {
                box.expandByObject(c);
                count++;
            }
        });
    }

    const center = count > 0 ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 0, 0);
    const size = count > 0 ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(100, 100, 100);
    const maxDim = Math.max(size.x, size.y, size.z, 50);

    const fov = (creatorCamera.fov || 45) * (Math.PI / 180);
    let dist = (maxDim / 2) / Math.tan(fov / 2);
    dist = Math.max(dist * 1.6, 120);

    creatorControls.target.copy(center);
    if (typeof currentCreatorCamera !== 'undefined' && currentCreatorCamera) {
        currentCreatorCamera.up.set(0, 1, 0);
    }

    let offset = new THREE.Vector3();
    switch (viewType) {
        case 'iso':
        case 'isometric':
            offset.set(dist * 0.8, dist * 0.6, dist * 0.8);
            break;
        case 'front':
            offset.set(0, 0, dist);
            break;
        case 'back':
            offset.set(0, 0, -dist);
            break;
        case 'top':
            offset.set(0, dist, 0.0001);
            if (currentCreatorCamera) currentCreatorCamera.up.set(0, 0, -1);
            break;
        case 'bottom':
            offset.set(0, -dist, 0.0001);
            if (currentCreatorCamera) currentCreatorCamera.up.set(0, 0, 1);
            break;
        case 'left':
            offset.set(-dist, 0, 0);
            break;
        case 'right':
            offset.set(dist, 0, 0);
            break;
        case 'fit':
        case 'all':
            const currentDir = new THREE.Vector3().subVectors(creatorCamera.position, creatorControls.target);
            if (currentDir.lengthSq() < 1e-4) currentDir.set(1, 0.8, 1);
            currentDir.normalize();
            offset.copy(currentDir.multiplyScalar(dist));
            break;
        default:
            offset.set(dist * 0.8, dist * 0.6, dist * 0.8);
    }

    const newCamPos = center.clone().add(offset);
    creatorCamera.position.copy(newCamPos);
    if (typeof creatorOrthoCamera !== 'undefined' && creatorOrthoCamera) {
        creatorOrthoCamera.position.copy(newCamPos);
    }
    creatorControls.update();

    if (typeof showToast === 'function') {
        const viewNames = {
            iso: 'Изометрия',
            front: 'Спереди (XY)',
            back: 'Сзади',
            top: 'Сверху (XZ)',
            bottom: 'Снизу',
            left: 'Слева (YZ)',
            right: 'Справа',
            fit: 'Показать всё'
        };
        showToast(`Вид: ${viewNames[viewType] || viewType}`);
    }
};

window.addSpecTableRow = function(tbody) {
    window.isSpecCreated = true;
    const btnSpec = document.getElementById('btn-spec-create-save');
    if (btnSpec) btnSpec.innerText = 'Сохранить';
    // Добавляем стили выделения строк программно, если их еще нет
    if (!document.getElementById('creator-spec-styles')) {
        const style = document.createElement('style');
        style.id = 'creator-spec-styles';
        style.innerHTML = `
            .spec-table-row.selected-row td {
                background-color: #DCEBFE !important;
                border-color: #BFDBFE !important;
            }
            .spec-table-row.selected-row td:first-child {
                border-left: none !important;
            }
            .spec-table-row.selected-row input {
                color: #1E3A8A !important;
                font-weight: 500;
            }
        `;
        document.head.appendChild(style);
    }
    
    // Инициализируем Datalist материалов, если его еще нет
    if (!document.getElementById('material-datalist')) {
        const matDl = document.createElement('datalist');
        matDl.id = 'material-datalist';
        Object.keys(MaterialDensities).forEach(matName => {
            const opt = document.createElement('option');
            opt.value = matName;
            matDl.appendChild(opt);
        });
        document.body.appendChild(matDl);
    }

    if (!tbody) tbody = document.getElementById('spec-table-body');
    const tr = document.createElement('tr');
    tr.className = 'spec-table-row';
    tr.dataset.rowId = (typeof window.generateSpecRowId === 'function' ? window.generateSpecRowId() : ('row_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)));
    
    // Колонки (9 шт): 3D-кнопка перенесена в начало
    const cols = ['action', 'pos', 'name', 'dims', 'qty', 'material', 'mass', 'route', 'comment'];
    
    // Считаем номер позиции
    const rowCount = tbody.children.length + 1;

    // Универсальный обработчик выделения строк
    const handleMousedown = function(e) {
        if (e.ctrlKey || e.shiftKey) {
            e.preventDefault(); // Предотвращаем фокус
        }
        const trNode = this.closest('tr') || tr;
        if (window.selectSpecRowAndFocus3D) {
            window.selectSpecRowAndFocus3D(trNode, { ctrlKey: e.ctrlKey, shiftKey: e.shiftKey });
        }
    };

    tr.addEventListener('mousedown', function(e) {
        if (e.target.tagName === 'BUTTON' || e.target.classList.contains('btn-3d')) return;
        if (e.ctrlKey || e.shiftKey) {
            e.preventDefault();
        }
        if (window.selectSpecRowAndFocus3D) {
            window.selectSpecRowAndFocus3D(tr, { ctrlKey: e.ctrlKey, shiftKey: e.shiftKey });
        }
    });

    // Универсальный обработчик навигации (Enter, Стрелочки)
    const handleKeydown = function(e) {
        const currentInput = this;
        const currentRow = currentInput.closest('tr');
        const tb = currentRow.parentElement;
        const allRows = Array.from(tb.children);
        const rowIndex = allRows.indexOf(currentRow);
        const rowInputs = Array.from(currentRow.querySelectorAll('input.spec-input'));
        const currentIndex = rowInputs.indexOf(currentInput);

        if (e.key === 'Enter') {
            e.preventDefault();
            
            // Обработка автоматического расчета массы по Enter, если поле пустое
            const massInput = currentRow.querySelector('td:nth-child(7) input');
            if (currentInput === massInput && massInput.value.trim() === '') {
                if (window.autoCalculateMass) window.autoCalculateMass(currentRow);
            }

            if (currentIndex < rowInputs.length - 1) {
                rowInputs[currentIndex + 1].focus();
            } else {
                const nextRow = allRows[rowIndex + 1];
                if (nextRow) {
                    const nextInputs = Array.from(nextRow.querySelectorAll('input.spec-input'));
                    if (nextInputs.length > 0) nextInputs[0].focus();
                } else {
                    const newRow = window.addSpecTableRow(tb);
                    const firstInput = newRow.querySelector('input.spec-input');
                    if (firstInput) firstInput.focus();
                    const scrollContainer = tb.parentElement.parentElement;
                    scrollContainer.scrollTop = scrollContainer.scrollHeight;
                }
            }
        } else if (e.key === 'ArrowRight') {
            if (currentInput.selectionStart === currentInput.value.length && currentIndex < rowInputs.length - 1) {
                e.preventDefault();
                rowInputs[currentIndex + 1].focus();
            }
        } else if (e.key === 'ArrowLeft') {
            if (currentInput.selectionStart === 0 && currentIndex > 0) {
                e.preventDefault();
                rowInputs[currentIndex - 1].focus();
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prevRow = allRows[rowIndex - 1];
            if (prevRow) {
                const prevInputs = Array.from(prevRow.querySelectorAll('input.spec-input'));
                const targetIndex = Math.min(currentIndex, prevInputs.length - 1);
                if (prevInputs[targetIndex]) prevInputs[targetIndex].focus();
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            const nextRow = allRows[rowIndex + 1];
            if (nextRow) {
                const nextInputs = Array.from(nextRow.querySelectorAll('input.spec-input'));
                const targetIndex = Math.min(currentIndex, nextInputs.length - 1);
                if (nextInputs[targetIndex]) nextInputs[targetIndex].focus();
            }
        }
    };

    let nameInput = null;
    let dimsTd = null;

    cols.forEach((col) => {
        const td = document.createElement('td');
        
        if (col === 'dims') {
            dimsTd = td;
        } else if (col === 'action') {
            const actionContainer = document.createElement('div');
            actionContainer.style.display = 'flex';
            actionContainer.style.alignItems = 'center';
            actionContainer.style.justifyContent = 'center';
            actionContainer.style.gap = '4px';

            const btn = document.createElement('button');
            btn.className = 'btn-3d'; 
            btn.innerHTML = '⭘';
            btn.title = 'Ожидание данных...';
            btn.disabled = true;
            btn.onclick = (e) => {
                // Suppress if dragged
                if (btn.dataset.suppressClick === "true") {
                    btn.dataset.suppressClick = "false";
                    return;
                } 
                if (btn.dataset.spawned === 'true') {
                    const meshes = window.getMeshesByRowId(creatorScene, tr.dataset.rowId);
                    if (meshes.length > 0) {
                        const targetPos = new THREE.Vector3();
                        meshes[0].getWorldPosition(targetPos);
                        creatorControls.target.copy(targetPos);
                        creatorControls.update();
                    }
                } else {
                    if (window.spawn3DFromSpec) window.spawn3DFromSpec(tr, btn); 
                }
            };

            const btnDel = document.createElement('button');
            btnDel.className = 'btn-spec-del';
            btnDel.innerHTML = '🗑️';
            btnDel.title = 'Удалить позицию из спецификации (3D модель сохранится в сцене)';
            btnDel.style.background = 'none';
            btnDel.style.border = 'none';
            btnDel.style.cursor = 'pointer';
            btnDel.style.fontSize = '12px';
            btnDel.style.padding = '2px 4px';
            btnDel.style.borderRadius = '4px';
            btnDel.style.opacity = '0.6';
            btnDel.style.transition = 'opacity 0.2s, background-color 0.2s';
            btnDel.onmouseover = () => { btnDel.style.opacity = '1.0'; btnDel.style.backgroundColor = '#FEE2E2'; };
            btnDel.onmouseout = () => { btnDel.style.opacity = '0.6'; btnDel.style.backgroundColor = 'transparent'; };
            btnDel.onclick = (e) => {
                e.stopPropagation();
                window.deleteSpecRow(tr);
                if (typeof window.refreshSpecTable === 'function') window.refreshSpecTable();
                if (typeof showToast === 'function') showToast("Позиция удалена из спецификации (3D модель сохранена)");
            };

            actionContainer.appendChild(btn);
            actionContainer.appendChild(btnDel);
            td.appendChild(actionContainer);

            // DRAG AND DROP LOGIC
            btn.removeAttribute('disabled'); // Allow drag start
            td.style.cursor = 'grab';
            
            let isDragging = false;
            let startX = 0, startY = 0;
            let dragLine = null;
            let hoveredMesh = null;
            let origColor = null;
            
            td.addEventListener("dragstart", e => e.preventDefault());
            td.addEventListener('pointerdown', (e) => {
                if (e.button !== 0) return;
                
                startX = e.clientX;
                startY = e.clientY;
                isDragging = false;
                
                const onMove = (ev) => {
                    if (!isDragging) {
                        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 5) {
                            isDragging = true;
                            // Add SVG overlay
                            dragLine = document.createElement('div');
                            dragLine.style.position = 'fixed';
                            dragLine.style.top = '0';
                            dragLine.style.left = '0';
                            dragLine.style.width = '100vw';
                            dragLine.style.height = '100vh';
                            dragLine.style.pointerEvents = 'none';
                            dragLine.style.zIndex = '999999';
                            dragLine.innerHTML = `<svg width="100%" height="100%"><line id="spec-drag-line" x1="${startX}" y1="${startY}" x2="${ev.clientX}" y2="${ev.clientY}" stroke="#E6A817" stroke-width="3" stroke-dasharray="5,5" opacity="0.8"/></svg>`;
                            document.body.appendChild(dragLine);
                        }
                    }
                    
                    if (isDragging) {
                        const line = document.getElementById('spec-drag-line');
                        if (line) {
                            line.setAttribute('x2', ev.clientX);
                            line.setAttribute('y2', ev.clientY);
                        }
                        
                        const canvas_element = document.getElementById("canvas-creator");
                        const rect = canvas_element.getBoundingClientRect();
                        const mx = ((ev.clientX - rect.left) / canvas_element.clientWidth) * 2 - 1;
                        const my = -((ev.clientY - rect.top) / canvas_element.clientHeight) * 2 + 1;
                        
                        sketchRaycaster.setFromCamera({x: mx, y: my}, currentCreatorCamera);
                        const interactable = [];
                        creatorScene.traverse(c => {
                            if (c.isMesh && c !== snapMarker && !c.userData.isSketchPlane && !c.userData.isSketch && !c.userData.isMateHighlight && !c.userData.isMateSymbol) {
                                // Also skip gizmo
                                let isGiz = false;
                                let curr = c;
                                while(curr) { if (curr === customGizmo) { isGiz = true; break; } curr = curr.parent; }
                                if (!isGiz) interactable.push(c);
                            }
                        });
                        const intersects = sketchRaycaster.intersectObjects(interactable, false);
                        
                        if (intersects.length > 0) {
                            const hit = intersects[0].object;
                            if (hoveredMesh !== hit) {
                                if (hoveredMesh && origColor !== null) {
                                    hoveredMesh.material.color.setHex(origColor);
                                }
                                hoveredMesh = hit;
                                origColor = hit.material.color.getHex();
                                hit.material.color.setHex(0xE6A817); // Yellowish
                            }
                        } else {
                            if (hoveredMesh && origColor !== null) {
                                hoveredMesh.material.color.setHex(origColor);
                            }
                            hoveredMesh = null;
                            origColor = null;
                        }
                    }
                };
                
                const onUp = (ev) => {
                    document.removeEventListener('pointermove', onMove);
                    document.removeEventListener('pointerup', onUp);
                    
                    if (dragLine) {
                        dragLine.remove();
                        dragLine = null;
                    }
                    
                    if (isDragging) {
                        ev.stopPropagation(); // prevent click
                        if (btn.contains(ev.target)) btn.dataset.suppressClick = "true";
                        if (hoveredMesh) {
                            if (origColor !== null) {
                                hoveredMesh.material.color.setHex(origColor);
                            }
                            window.linkSpecRowToMesh(tr, hoveredMesh);
                            hoveredMesh = null;
                            origColor = null;
                        }
                    }
                };
                
                document.addEventListener('pointermove', onMove);
                document.addEventListener('pointerup', onUp);
            });
            // END DRAG AND DROP
        } else {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'spec-input';
            
            if (col === 'pos') {
                input.value = rowCount;
                input.style.textAlign = 'center';
            } else if (col === 'name') {
                input.setAttribute('list', 'spec-names-list');
                nameInput = input;
                // Слушаем ввод для перестройки размеров
                input.addEventListener('input', () => updateDimInputs(nameInput, dimsTd, handleKeydown, handleMousedown));
            }
            else if (col === 'material') {
                input.setAttribute('list', 'material-datalist');
            } else if (col === 'qty') {
                input.addEventListener('input', () => {
                    if (window.autoCalculateMass) window.autoCalculateMass(tr);
                    if (window.syncSpecRowMeshes) window.syncSpecRowMeshes(tr);
                });
            }

            if (input.hasAttribute('list')) {
                input.addEventListener('focus', function() {
                    if (typeof this.showPicker === 'function') {
                        try { this.showPicker(); } catch(e) {}
                    }
                });
            }
            
            input.addEventListener('keydown', handleKeydown);
            input.addEventListener('mousedown', handleMousedown);
            td.appendChild(input);
        }
        tr.appendChild(td);
    });
    
    // Слушатель для валидации 3D-кнопки и синхронизации моделей
    tr.addEventListener('input', function() {
        if (window.validateRowFor3D) window.validateRowFor3D(tr);
        if (window.syncSpecRowMeshes) window.syncSpecRowMeshes(tr);
    });

    // Инициализируем стартовый вид размеров
    updateDimInputs(nameInput, dimsTd, handleKeydown, handleMousedown);
    tbody.appendChild(tr);
    return tr;
};

function getShapeCategory(name) {
    if (!name) return 'free';
    name = name.toLowerCase();
    if (name === 'лист' || name === 'пластина' || name === 'лист гнутый' || name.includes('лист') || name.includes('гиб') || name === 'пко' || name.includes('пко') || name === 'панель' || name.includes('панель') || name === 'полотнище' || name.includes('полотнище')) return 'plate';
    if (name === 'труба') return 'pipe';
    if (name === 'цилиндр' || name === 'круг' || name === 'круг (цилиндр)') return 'cylinder';
    if (name === 'полособульб') return 'bulbbar';
    if (name === 'уголок') return 'angle';
    if (name === 'швеллер') return 'channel';
    if (name === 'кница') return 'knitsa';
    return 'free';
}

function updateDimInputs(nameInput, dimsTd, keydownHandler, mousedownHandler) {
    if (!nameInput || !dimsTd) return;
    const cat = getShapeCategory(nameInput.value.trim());
    
    // Защита от потери фокуса при каждом нажатии, если тип не изменился
    if (dimsTd.dataset.currentCategory === cat) return;
    dimsTd.dataset.currentCategory = cat;
    
    dimsTd.innerHTML = '';
    
    let placeholders = [];
    let lists = [];
    if (cat === 'plate') placeholders = ['t (толщ)', 'B (шир)', 'L (дл)'];
    else if (cat === 'pipe') placeholders = ['D', 't (ст)', 'L'];
    else if (cat === 'cylinder') placeholders = ['D', 'L'];
    else if (cat === 'bulbbar') { placeholders = ['Профиль', 'L']; lists = ['bulbbar-datalist', null]; }
    else if (cat === 'angle') { placeholders = ['Профиль', 'L']; lists = ['angle-datalist', null]; }
    else if (cat === 'channel') { placeholders = ['Профиль', 'L']; lists = ['channel-datalist', null]; }
    else if (cat === 'knitsa') placeholders = ['h', 'l', 't (толщ)'];
    else placeholders = ['Свободные размеры']; // 'свободная' или неизвестная форма

    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.width = '100%';
    container.style.height = '100%';

    placeholders.forEach((ph, i) => {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'spec-input';
        inp.placeholder = ph;
        inp.style.flex = '1';
        inp.style.minWidth = '0';
        inp.style.textAlign = 'center';
        
        if (lists[i]) {
            inp.setAttribute('list', lists[i]);
            inp.addEventListener('focus', function() {
                if (typeof this.showPicker === 'function') {
                    try { this.showPicker(); } catch(e) {}
                }
            });
        }
        
        if (i < placeholders.length - 1) {
            inp.style.borderRight = '1px solid var(--border-light)';
        }
        inp.addEventListener('keydown', keydownHandler);
        inp.addEventListener('mousedown', mousedownHandler);
        container.appendChild(inp);
    });

    dimsTd.appendChild(container);
}

window.addPartToSpecTable = function(objData) {
    const tbody = document.getElementById('spec-table-body');
    if (!tbody) return;
    
    // Ищем первую полностью пустую строку (где нет наименования)
    let targetRow = null;
    for (let tr of tbody.children) {
        const nameInput = tr.querySelector('td:nth-child(3) input');
        if (nameInput && nameInput.value.trim() === '') {
            targetRow = tr;
            break;
        }
    }
    // Если свободных строк нет — создаем новую
    if (!targetRow) targetRow = window.addSpecTableRow(tbody);
    
    const qtyInput = targetRow.querySelector('td:nth-child(5) input');
    const matInput = targetRow.querySelector('td:nth-child(6) input');
    
    if (qtyInput && !qtyInput.value) qtyInput.value = '1';
    if (matInput && !matInput.value) matInput.value = objData.material || 'Сталь Ст3'; 
    
    let info = { ...objData };
    if (objData.type === 'panel' || objData.name === 'ПКО' || objData.typeName === 'ПКО') {
        info.category = 'plate';
        info.typeName = 'ПКО';
        info.t = objData.plateT || objData.t || 10;
        info.w = objData.plateW || objData.w || 1000;
        info.l = objData.plateL || objData.l || 2000;
    } else if (objData.type === 'plate') {
        info.category = 'plate';
        info.typeName = 'Лист';
    } else if (objData.type === 'cylinder') {
        info.category = 'cylinder';
        info.typeName = 'Цилиндр';
    } else if (objData.type === 'pipe') {
        info.category = 'pipe';
        info.typeName = 'Труба';
        info.profileType = 'pipe';
    } else if (objData.type === 'profile' || objData.type === 'bulbbar' || objData.type === 'angle' || objData.type === 'channel') {
        const isBulb = (objData.name && objData.name.includes('HP')) || objData.type === 'bulbbar';
        const isAngle = (objData.name && (objData.name.includes('L') || objData.name.toLowerCase().includes('уголок'))) || objData.type === 'angle';
        info.typeName = isBulb ? 'Полособульб' : (isAngle ? 'Уголок' : 'Швеллер');
        info.category = isBulb ? 'bulbbar' : (isAngle ? 'angle' : 'channel');
        info.profileType = info.category;
        info.profileName = objData.name || objData.profName || '';
    } else if (objData.type === 'knitsa') {
        info.category = 'knitsa';
        info.typeName = 'Кница';
        info.th = objData.th || objData.t;
    }

    window.populateRowFromMeshInfo(targetRow, info);
    
    // Автоскролл к новой добавленной позиции
    const scrollContainer = tbody.parentElement.parentElement;
    if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
};

// Мощная функция расчета массы на лету (зависит от геометрии и материала)
let isCalculatingMass = false;
window.autoCalculateMass = function(tr) {
    if (!tr || isCalculatingMass) return;
    isCalculatingMass = true;
    try {
        const nameInput = tr.querySelector('td:nth-child(3) input');
        const dimsInputs = tr.querySelector('td:nth-child(4)').querySelectorAll('input');
        const qtyInput = tr.querySelector('td:nth-child(5) input');
        const matInput = tr.querySelector('td:nth-child(6) input');
        const massInput = tr.querySelector('td:nth-child(7) input');
        
        if (!nameInput || !matInput || !massInput || !dimsInputs) return;
        
        const matName = matInput.value.trim();
        let density = MaterialDensities[matName];
        
        // Резервная проверка (если ввели вручную часть названия)
        if (!density) {
            const matLower = matName.toLowerCase();
            if (matLower.includes('сталь') || matLower.includes('вст') || matLower.includes('ст3')) density = 7850;
            else if (matLower.includes('алюм') || matLower.includes('амг')) density = 2660;
            else {
                return;
            }
        }

        const name = nameInput.value.trim().toLowerCase();
        let volume = 0; // Объем в мм³

        // 1. Пытаемся взять точный объем из уже сгенерированной 3D-модели (включая группы деталей)
        const btn3D = tr.querySelector('.btn-3d');
        let mesh = null;
        if (btn3D && btn3D.dataset.spawned === 'true' && tr.dataset.rowId) {
            const meshes = window.getMeshesByRowId(creatorScene, tr.dataset.rowId);
            if (meshes.length > 0) {
                // Если среди мешей есть группа панели или ссылка на нее
                const rootPanel = meshes.find(m => m.userData && (m.userData.isPanel || m.userData.isUnifiedGroup));
                if (rootPanel) {
                    mesh = rootPanel;
                } else if (meshes[0].userData && meshes[0].userData.parentUnifiedGroup) {
                    mesh = meshes[0].userData.parentUnifiedGroup;
                } else {
                    mesh = meshes[0];
                }
            }
        }
        
        if (mesh) {
            if (mesh.isGroup || (mesh.children && mesh.children.length > 0 && mesh.userData && mesh.userData.isPanel)) {
                let totalGroupVol = 0;
                mesh.traverse(child => {
                    if (child.isMesh && child.geometry && !child.userData.isGizmo && !child.userData.isSketchPlane && !child.userData.isSketch && !child.userData.isDimension && !child.userData.isProjLine) {
                        const s = child.scale || { x: 1, y: 1, z: 1 };
                        const childScaleVol = (s.x || 1) * (s.y || 1) * (s.z || 1);
                        totalGroupVol += calculateGeometryVolume(child.geometry) * childScaleVol;
                    }
                });
                volume = totalGroupVol;
            } else if (mesh.geometry) {
                const scaleVol = (mesh.scale ? mesh.scale.x * mesh.scale.y * mesh.scale.z : 1);
                volume = calculateGeometryVolume(mesh.geometry) * scaleVol;
            }
        } 
        // 2. Если 3D-модели нет, рассчитываем объем математически или генерируем временную 3D-модель
        if (volume <= 0) {
            try {
                if (name === 'лист' || name === 'пластина' || name === 'лист гнутый') {
                    if (dimsInputs.length === 3) {
                        const t = parseFloat(dimsInputs[0].value) || 0;
                        const w = parseFloat(dimsInputs[1].value) || 0;
                        const l = parseFloat(dimsInputs[2].value) || 0;
                        volume = t * w * l;
                    }
                } else if (name === 'пко' || name === 'панель' || name.includes('пко') || name.includes('панель')) {
                    if (dimsInputs.length === 3) {
                        const t = parseFloat(dimsInputs[0].value) || 0;
                        const w = parseFloat(dimsInputs[1].value) || 0;
                        const l = parseFloat(dimsInputs[2].value) || 0;
                        volume = t * w * l;
                        
                        // Добавляем объем ребер жесткости (по фактическому или стандартному профилю HP 160x8)
                        let ribArea = 1592; // стандартное сечение HP 160x8 в мм²
                        const profType = tr.dataset.profileType || (mesh && mesh.userData && mesh.userData.specData && mesh.userData.specData.profileType) || "HP 160x8";
                        if (typeof BulbProfiles !== 'undefined' && BulbProfiles[profType]) {
                            const pts = BulbProfiles[profType];
                            const sh = createShapeFromBulgePoly(pts);
                            if (sh) {
                                const pts2d = sh.getPoints();
                                if (THREE.ShapeUtils && THREE.ShapeUtils.area) ribArea = Math.abs(THREE.ShapeUtils.area(pts2d));
                            }
                        }
                        const spacing = parseFloat(tr.dataset.stiffenerSpacing) || 500;
                        const count = Math.max(1, Math.floor(l / spacing));
                        volume += count * ribArea * w;
                    }
                } else if (name === 'труба') {
                    if (dimsInputs.length === 3) {
                        const dOut = parseFloat(dimsInputs[0].value) || 0;
                        const t = parseFloat(dimsInputs[1].value) || 0;
                        const l = parseFloat(dimsInputs[2].value) || 0;
                        const rOut = dOut / 2;
                        const rIn = rOut - t;
                        if (rIn > 0) volume = Math.PI * (rOut*rOut - rIn*rIn) * l;
                    }
                } else if (name === 'цилиндр' || name === 'круг' || name === 'круг (цилиндр)') {
                    if (dimsInputs.length === 2) {
                        const d = parseFloat(dimsInputs[0].value) || 0;
                        const l = parseFloat(dimsInputs[1].value) || 0;
                        const r = d / 2;
                        volume = Math.PI * r * r * l;
                    }
                } else if (name === 'кница') {
                    if (dimsInputs.length === 3) {
                        const h = parseFloat(dimsInputs[0].value) || 0;
                        const l = parseFloat(dimsInputs[1].value) || 0;
                        const th = parseFloat(dimsInputs[2].value) || 0;
                        // Упрощенный расчет по прямоугольному треугольнику
                        volume = (h * l / 2) * th;
                    }
                } else if (['полособульб', 'уголок', 'швеллер'].includes(name)) {
                    // Генерируем 3D-профиль в памяти для максимально точного снятия объема
                    if (dimsInputs.length === 2) {
                        const profName = dimsInputs[0].value.trim();
                        const l = parseFloat(dimsInputs[1].value) || 0;
                        let points = null;
                        if (name === 'полособульб') points = BulbProfiles[profName];
                        else if (name === 'уголок') points = getAngleProfilePoints(profName);
                        else if (name === 'швеллер') {
                            const key = Object.keys(ChannelParams).find(k => k.toLowerCase() === profName.toLowerCase());
                            if (key) points = generateChannelPoints(...ChannelParams[key]);
                        }

                        if (points && l > 0) {
                            const shape = createShapeFromBulgePoly(points);
                            const tempGeo = new THREE.ExtrudeGeometry(shape, { depth: l, bevelEnabled: false });
                            volume = calculateGeometryVolume(tempGeo);
                            tempGeo.dispose(); // Очищаем память
                            const pts2d = shape.getPoints();
                            let area = 0;
                            if (THREE.ShapeUtils && THREE.ShapeUtils.area) { area = Math.abs(THREE.ShapeUtils.area(pts2d)); }
                            else { for (let i = 0, j = pts2d.length - 1; i < pts2d.length; j = i++) { area += (pts2d[j].x + pts2d[i].x) * (pts2d[j].y - pts2d[i].y); } area = Math.abs(area / 2); }
                            volume = area * l;
                        }
                    }
                }
            } catch (e) {
                console.error("Ошибка расчета:", e);
            }
        }
            
        if (volume > 0) {
            // Конвертируем объем из мм³ в м³, затем умножаем на плотность (кг/м³) для 1 ед. детали
            const volumeM3 = volume / 1000000000;
            const mass = volumeM3 * density; 
            massInput.value = mass.toFixed(2);
        }
    } finally {
        isCalculatingMass = false;
    }
};

let isValidatingRowFor3D = false;
window.validateRowFor3D = function(tr) {
    if (!tr || isValidatingRowFor3D) return;
    isValidatingRowFor3D = true;
    try {
        const btn = tr.querySelector('.btn-3d');
        if (!btn || btn.dataset.spawned === 'true') return; // Если уже создано - не меняем статус

        const pos = (tr.querySelector('td:nth-child(2) input').value || '').trim();
        const name = (tr.querySelector('td:nth-child(3) input').value || '').trim();
        const cat = getShapeCategory(name);
        const dimFields = Array.from(tr.querySelector('td:nth-child(4)').querySelectorAll('input')).map(i => i.value.trim());
        const qty = parseFloat(tr.querySelector('td:nth-child(5) input').value) || 0;
        const mat = (tr.querySelector('td:nth-child(6) input').value || '').trim();
        
        let dimsValid = false;
        if (['plate', 'cylinder', 'pipe', 'knitsa'].includes(cat)) {
            dimsValid = dimFields.length > 0 && dimFields.every(v => parseFloat(v) > 0);
        } else if (['bulbbar', 'angle', 'channel'].includes(cat)) {
            dimsValid = dimFields.length === 2 && dimFields[0] !== '' && parseFloat(dimFields[1]) > 0;
        } else if (cat === 'free') {
            dimsValid = true;
        }

        if (pos && dimsValid && qty > 0 && mat) {
            btn.disabled = false;
            btn.className = 'btn-3d ready';
            btn.innerHTML = '➕';
            btn.title = cat === 'free' ? 'Привязать к существующей 3D-модели' : 'Создать 3D модель';
        } else {
            btn.disabled = true;
            btn.className = 'btn-3d';
            btn.innerHTML = '⭘';
            btn.title = 'Ожидание данных...';
        }
    } finally {
        isValidatingRowFor3D = false;
    }
};

function cloneUserData(userData) {
    if (!userData) return {};
    const copy = { ...userData };
    if (userData.specData && typeof userData.specData === 'object') {
        copy.specData = { ...userData.specData };
    }
    return copy;
}

let isSyncingSpecRowMeshes = false;
window.syncSpecRowMeshes = function(tr) {
    if (!tr || !tr.dataset.rowId || isSyncingSpecRowMeshes) return;
    const btn = tr.querySelector('.btn-3d');
    if (!btn || btn.dataset.spawned !== 'true') return;

    isSyncingSpecRowMeshes = true;
    try {
        const nameInput = tr.querySelector('td:nth-child(3) input');
    const cat = nameInput ? getShapeCategory(nameInput.value.trim()) : 'free';
    const dimInputs = Array.from(tr.querySelector('td:nth-child(4)').querySelectorAll('input')).map(i => parseFloat(i.value));

    const qtyInput = tr.querySelector('td:nth-child(5) input');
    if (!qtyInput) return;
    const targetQty = Math.max(1, parseInt(qtyInput.value, 10) || 1);

    const existingMeshes = window.getMeshesByRowId(creatorScene, tr.dataset.rowId);

    if (existingMeshes.length === 0) return;

    // Проверяем изменение габаритов (толщины, ширины, длины) из таблицы для пластин/гнутых листов
    if (cat === 'plate' && dimInputs.length >= 1) {
        const newT = dimInputs[0];
        const newW = dimInputs[1];
        const newL = dimInputs[2];

        if (!isNaN(newT) && newT > 0) {
            existingMeshes.forEach(mesh => {
                if (!mesh.userData.specData) mesh.userData.specData = {};
                const sd = mesh.userData.specData;
                const oldT = sd.t || sd.thickness || sd.depth;
                const tChanged = oldT !== newT;
                const wChanged = !isNaN(newW) && newW > 0 && sd.w !== newW;
                const lChanged = !isNaN(newL) && newL > 0 && sd.l !== newL;

                if (tChanged || wChanged || lChanged) {
                    sd.t = newT; sd.th = newT; sd.thickness = newT; sd.wallThick = newT; sd.depth = newT;
                    if (!isNaN(newW) && newW > 0) sd.w = newW;
                    if (!isNaN(newL) && newL > 0) sd.l = newL;

                    const curW = sd.w || 100;
                    const curL = sd.l || 100;

                    if (mesh.userData.bendsList && mesh.userData.bendsList.length > 0) {
                        mesh.updateMatrixWorld(true);
                        mesh.userData.bendsList.forEach(b => {
                            if (b.edge) {
                                const initT = b.edge.thickness || b.t || oldT || 10;
                                const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
                                let broadNormalWorld = new THREE.Vector3(0, 1, 0).applyMatrix3(normalMatrix).normalize();
                                if (mesh.userData && mesh.userData.specData && mesh.userData.specData.broadNormal) {
                                    broadNormalWorld = mesh.userData.specData.broadNormal.clone().applyMatrix3(normalMatrix).normalize();
                                }

                                let wThick = b.edge.thicknessDir ? b.edge.thicknessDir.clone().normalize() : new THREE.Vector3(0, 1, 0);
                                if (wThick.dot(broadNormalWorld) < 0) {
                                    wThick.negate();
                                }

                                let wV1_base = null, wV2_base = null;
                                if (b.edge.localV1_base && b.edge.localV2_base) {
                                    wV1_base = mesh.localToWorld(b.edge.localV1_base.clone());
                                    wV2_base = mesh.localToWorld(b.edge.localV2_base.clone());
                                } else if (b.edge.v1 && b.edge.v2) {
                                    wV1_base = b.edge.v1.clone();
                                    wV2_base = b.edge.v2.clone();
                                }
                                if (wV1_base && wV2_base) {
                                    b._tempWorldV1Base = wV1_base;
                                    b._tempWorldV2Base = wV2_base;
                                }
                            }
                        });
                    }

                    if (mesh.userData.sketchSource) {
                        if (typeof performExtrusion === 'function') {
                            const newExtrude = performExtrusion(
                                mesh.userData.sketchSource.segments,
                                mesh.userData.sketchSource.circles,
                                mesh.userData.sketchSource.up,
                                mesh.userData.sketchSource.normal,
                                newT,
                                mesh.userData.sketchSource.draftAngle
                            );
                            if (newExtrude && newExtrude.geometry) {
                                mesh.userData.baseGeometry.dispose();
                                mesh.userData.baseGeometry = newExtrude.geometry.clone();
                            }
                        }
                    } else {
                        mesh.userData.baseGeometry.dispose();
                        mesh.userData.baseGeometry = new THREE.BoxGeometry(curW, newT, curL);
                        mesh.position.setY(newT / 2);
                    }

                    if (mesh.userData.bendsList && mesh.userData.bendsList.length > 0) {
                        mesh.updateMatrixWorld(true);
                        mesh.userData.bendsList.forEach(b => {
                            if (b._tempWorldV1Base && b._tempWorldV2Base) {
                                b.edge.localV1_base = mesh.worldToLocal(b._tempWorldV1Base.clone());
                                b.edge.localV2_base = mesh.worldToLocal(b._tempWorldV2Base.clone());

                                const invQ = mesh.quaternion.clone().invert();
                                let lThick = b.edge.thicknessDir ? b.edge.thicknessDir.clone().applyQuaternion(invQ).normalize() : new THREE.Vector3(0, 1, 0);
                                let localBroadNorm = new THREE.Vector3(0, 1, 0);
                                if (mesh.userData && mesh.userData.specData && mesh.userData.specData.broadNormal) {
                                    localBroadNorm = mesh.userData.specData.broadNormal.clone().normalize();
                                }
                                if (lThick.dot(localBroadNorm) < 0) {
                                    lThick.negate();
                                }
                                b.edge.localThicknessDir = lThick;

                                if (b.edge.faceNormal) {
                                    b.edge.localFaceNormal = b.edge.faceNormal.clone().applyQuaternion(invQ).normalize();
                                }
                                if (b.edge.edgeDir) {
                                    b.edge.localEdgeDir = b.edge.edgeDir.clone().applyQuaternion(invQ).normalize();
                                }

                                delete b._tempWorldV1Base;
                                delete b._tempWorldV2Base;
                            }
                        });
                    }

                    if (mesh.userData.hasBends || (mesh.userData.bendsList && mesh.userData.bendsList.length > 0)) {
                        if (typeof window.rebuildObjectFromBends === 'function') {
                            window.rebuildObjectFromBends(mesh);
                        }
                    } else {
                        mesh.geometry.dispose();
                        mesh.geometry = mesh.userData.baseGeometry.clone();

                        // Обновляем контуры
                        for (let i = mesh.children.length - 1; i >= 0; i--) {
                            const child = mesh.children[i];
                            if (child.isLineSegments) {
                                mesh.remove(child);
                                if (child.geometry) child.geometry.dispose();
                                if (child.material) child.material.dispose();
                            }
                        }
                        const edges = new THREE.EdgesGeometry(mesh.geometry, typeof showRadialEdges !== 'undefined' && showRadialEdges ? 1 : 15);
                        const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x2A3142 }));
                        mesh.add(line);
                    }
                }
            });
        }
    }

    const currentCount = existingMeshes.length;

    if (targetQty > currentCount) {
        const baseMesh = existingMeshes[0];
        const baseRealColor = (baseMesh.userData && baseMesh.userData.originalObjectColor !== undefined)
            ? baseMesh.userData.originalObjectColor
            : baseMesh.material.color.getHex();
        const box = new THREE.Box3().setFromObject(baseMesh);
        const sizeX = Math.max(10, box.max.x - box.min.x);
        const sizeZ = Math.max(10, box.max.z - box.min.z);
        const gap = 20;

        for (let i = currentCount; i < targetQty; i++) {
            const cloneGeo = baseMesh.geometry.clone();
            const cloneMat = baseMesh.material.clone();
            cloneMat.color.setHex(baseRealColor);
            const copyMesh = new THREE.Mesh(cloneGeo, cloneMat);
            copyMesh.add(new THREE.LineSegments(
                new THREE.EdgesGeometry(cloneGeo, typeof showRadialEdges !== 'undefined' && showRadialEdges ? 1 : 15), 
                new THREE.LineBasicMaterial({ color: 0x2A3142 })
            ));
            
            const col = i % 5;
            const row = Math.floor(i / 5);
            copyMesh.position.set(
                baseMesh.position.x + col * (sizeX + gap),
                baseMesh.position.y,
                baseMesh.position.z + row * (sizeZ + gap)
            );
            copyMesh.userData = cloneUserData(baseMesh.userData);
            copyMesh.userData.originalObjectColor = baseRealColor;
            window.linkMeshToSpecRow(copyMesh, tr);
            creatorScene.add(copyMesh);
        }
        if (typeof showToast === 'function') showToast(`Количество деталей в 3D: ${targetQty}`);
    } else if (targetQty < currentCount) {
        const toRemove = existingMeshes.slice(targetQty);
        toRemove.forEach(m => {
            if (typeof disposeHierarchy === 'function') disposeHierarchy(m);
            else if (m.parent) m.parent.remove(m);
        });
        if (typeof showToast === 'function') showToast(`Количество деталей в 3D: ${targetQty}`);
    }
    } finally {
        isSyncingSpecRowMeshes = false;
    }
};

window.copySelectedObjects = function(count = 1) {
    let targetMeshes = [...(selectedObjects || [])];

    // Если в 3D ничего не выбрано, ищем выделенную строчку в спецификации
    if (targetMeshes.length === 0) {
        const selectedRow = document.querySelector('.spec-table-row.selected-row');
        if (selectedRow && selectedRow.dataset.rowId) {
            targetMeshes.push(...window.getMeshesByRowId(creatorScene, selectedRow.dataset.rowId));
            // Если модель еще не создана в 3D
            if (targetMeshes.length === 0) {
                const btn = selectedRow.querySelector('.btn-3d');
                if (btn && typeof window.spawn3DFromSpec === 'function') {
                    window.spawn3DFromSpec(selectedRow, btn);
                    targetMeshes.push(...window.getMeshesByRowId(creatorScene, selectedRow.dataset.rowId));
                }
            }
        }
    }

    if (targetMeshes.length === 0) {
        if (typeof showToast === 'function') showToast("Сначала выберите деталь в 3D или строку в спецификации");
        return;
    }
    
    const numCopies = (typeof count === 'number' && count > 0) ? count : 1;
    const newCreatedObjects = [];
    
    targetMeshes.forEach((origMesh) => {
        if (!origMesh || !origMesh.geometry) return;

        const box = new THREE.Box3().setFromObject(origMesh);
        const sizeX = Math.max(10, box.max.x - box.min.x);
        const sizeZ = Math.max(10, box.max.z - box.min.z);
        const gap = 20;

        const tr = origMesh.userData ? window.getSpecRowByMesh(origMesh) : null;
        let existingMeshes = [];
        if (tr && tr.dataset.rowId) {
            existingMeshes = window.getMeshesByRowId(creatorScene, tr.dataset.rowId);
        }

        const basePos = (existingMeshes.length > 0) ? existingMeshes[0].position.clone() : origMesh.position.clone();
        const startIdx = (existingMeshes.length > 0) ? existingMeshes.length : (origMesh.userData._copyCount || 1);

        const realColor = (origMesh.userData && origMesh.userData.originalObjectColor !== undefined)
            ? origMesh.userData.originalObjectColor
            : origMesh.material.color.getHex();

        for (let i = 0; i < numCopies; i++) {
            const cloneGeo = origMesh.geometry.clone();
            const cloneMat = origMesh.material.clone();
            cloneMat.color.setHex(realColor);
            const cloneMesh = new THREE.Mesh(cloneGeo, cloneMat);
            
            const edges = new THREE.LineSegments(
                new THREE.EdgesGeometry(cloneGeo, typeof showRadialEdges !== 'undefined' && showRadialEdges ? 1 : 15),
                new THREE.LineBasicMaterial({ color: 0x2A3142 })
            );
            cloneMesh.add(edges);

            const currIdx = startIdx + i;
            const col = currIdx % 5;
            const row = Math.floor(currIdx / 5);
            
            const offsetX = col * (sizeX + gap);
            const offsetZ = row * (sizeZ + gap);

            cloneMesh.position.set(basePos.x + offsetX, basePos.y, basePos.z + offsetZ);
            cloneMesh.rotation.copy(origMesh.rotation);
            cloneMesh.scale.copy(origMesh.scale);

            cloneMesh.userData = cloneUserData(origMesh.userData);
            cloneMesh.userData._copyCount = currIdx + 1;
            cloneMesh.userData.originalObjectColor = realColor;

            if (tr) {
                const qtyInput = tr.querySelector('td:nth-child(5) input');
                if (qtyInput) {
                    const curQty = parseInt(qtyInput.value, 10) || 1;
                    qtyInput.value = curQty + 1;
                    if (window.autoCalculateMass) window.autoCalculateMass(tr);
                }
                window.linkMeshToSpecRow(cloneMesh, tr);
            }

            creatorScene.add(cloneMesh);
            newCreatedObjects.push(cloneMesh);
        }
        origMesh.userData._copyCount = startIdx + numCopies;
    });

    if (selectedObjects && selectedObjects.length > 0) {
        selectedObjects.forEach(obj => {
            if (obj.userData && obj.userData.originalObjectColor !== undefined) {
                obj.material.color.setHex(obj.userData.originalObjectColor);
            }
        });
    }
    selectedObjects = newCreatedObjects;
    selectedObjects.forEach(mesh => {
        if (mesh.material && mesh.material.color) {
            // mesh.userData.originalObjectColor is set to realColor
            mesh.material.color.setHex(0x2563EB);
        }
    });

    if (selectedObjects.length > 0 && typeof customGizmo !== 'undefined') {
        const box = new THREE.Box3();
        selectedObjects.forEach(obj => box.expandByObject(obj));
        const center = new THREE.Vector3();
        box.getCenter(center);
        customGizmo.position.copy(center);
        customGizmo.visible = true;
        gizmoState = 2;
    }

    if (typeof showToast === 'function') {
        showToast(numCopies === 1 ? "Создана копия детали" : `Создано копий: ${numCopies}`);
    }
};

window.spawn3DFromSpec = function(tr, btn) {
    if (!btn.classList.contains('ready') && !btn.classList.contains('spawned') && getShapeCategory(tr.querySelector('td:nth-child(3) input').value.trim()) !== 'free') return;
    const name = tr.querySelector('td:nth-child(3) input').value.trim();
    const cat = getShapeCategory(name);
    const dimFields = Array.from(tr.querySelector('td:nth-child(4)').querySelectorAll('input')).map(i => i.value.trim());
    const qtyInput = tr.querySelector('td:nth-child(5) input');
    const targetQty = Math.max(1, parseInt(qtyInput ? qtyInput.value : 1) || 1);

    if (cat === 'free') {
        if (window.startLinkMode) window.startLinkMode(tr, btn);
        return;
    }

    let mesh = null;
    const material = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, metalness: 0.5, roughness: 0.4 });

    try {
        if (cat === 'plate') {
            const t = parseFloat(dimFields[0]), w = parseFloat(dimFields[1]), l = parseFloat(dimFields[2]);
            mesh = new THREE.Mesh(new THREE.BoxGeometry(w, t, l), material);
            mesh.position.set(0, t/2, 0);
            mesh.userData.specData = {
                type: 'plate',
                t: t, th: t, thickness: t, wallThick: t, depth: t,
                w: w, l: l,
                broadNormal: new THREE.Vector3(0, 1, 0)
            };
        } else if (cat === 'cylinder') {
            const d = parseFloat(dimFields[0]), l = parseFloat(dimFields[1]), r = d/2;
            const geo = new THREE.CylinderGeometry(r, r, l, 32);
            geo.rotateX(Math.PI / 2);
            mesh = new THREE.Mesh(geo, material);
            mesh.position.set(0, r, 0);
            mesh.userData.specData = {
                type: 'cylinder',
                d: d, l: l, t: l, depth: l,
                broadNormal: new THREE.Vector3(0, 0, 1)
            };
        } else if (cat === 'pipe') {
            const dOut = parseFloat(dimFields[0]), t_w = parseFloat(dimFields[1]), l = parseFloat(dimFields[2]);
            const rOut = dOut/2, rIn = rOut - t_w;
            const shape = new THREE.Shape();
            shape.absarc(0, 0, rOut, 0, Math.PI * 2, false);
            const hole = new THREE.Path();
            hole.absarc(0, 0, rIn, 0, Math.PI * 2, true);
            shape.holes.push(hole);
            const geo = new THREE.ExtrudeGeometry(shape, { depth: l, bevelEnabled: false, curveSegments: 32 });
            geo.translate(0, 0, -l / 2);
            mesh = new THREE.Mesh(geo, material);
            mesh.position.set(0, rOut, 0);
            mesh.userData.specData = {
                type: 'pipe',
                profileType: 'pipe',
                category: 'pipe',
                typeName: 'Труба',
                name: `⌀${dOut}x${t_w}`,
                profileName: `⌀${dOut}x${t_w}`,
                dOut: dOut, d: dOut, t: t_w, th: t_w, wallThick: t_w, l: l, depth: l,
                broadNormal: new THREE.Vector3(0, 0, 1)
            };
        } else if (['bulbbar', 'angle', 'channel'].includes(cat)) {
            const profName = dimFields[0], l = parseFloat(dimFields[1]);
            let points = null;
            if (cat === 'bulbbar') points = BulbProfiles[profName];
            else if (cat === 'angle') points = (typeof getAngleProfilePoints === 'function' ? getAngleProfilePoints(profName) : AngleProfiles[profName]) || AngleProfiles[profName];
            else if (cat === 'channel') {
                const key = Object.keys(ChannelParams).find(k => k.toLowerCase() === profName.toLowerCase());
                if (key) points = generateChannelPoints(...ChannelParams[key]);
            }
            
            if (points) {
                const shape = createShapeFromBulgePoly(points);
                mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: l, bevelEnabled: false }), material);
                mesh.userData.specData = {
                    type: 'profile',
                    profileType: cat,
                    category: cat,
                    typeName: cat === 'bulbbar' ? 'Полособульб' : (cat === 'angle' ? 'Уголок' : 'Швеллер'),
                    name: profName,
                    profName: profName,
                    profileName: profName,
                    l: l, t: l, depth: l,
                    broadNormal: new THREE.Vector3(0, 0, 1)
                };
            }
        } else if (cat === 'knitsa') {
            const h = parseFloat(dimFields[0]), l = parseFloat(dimFields[1]), th = parseFloat(dimFields[2]);
            const shape = new THREE.Shape();
            shape.moveTo(0, 0); shape.lineTo(l, 0); shape.lineTo(0, h); shape.lineTo(0, 0);
            mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: th, bevelEnabled: false }), material);
            mesh.userData.specData = {
                type: 'knitsa',
                h: h, l: l, th: th, t: th, thickness: th, depth: th,
                broadNormal: new THREE.Vector3(0, 0, 1)
            };
        }
    } catch (e) { console.error("Spawn 3D error", e); }

    if (mesh) {
        mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, typeof showRadialEdges !== 'undefined' && showRadialEdges ? 1 : 15), new THREE.LineBasicMaterial({ color: 0x2A3142 })));
        
        // Умное авторазмещение детали (справа от всех существующих)
        mesh.geometry.computeBoundingBox();
        let maxX = 0;
        creatorScene.traverse(c => { if (c.isMesh && (c.userData.specRowId || c.userData.specRow) && c !== mesh) { const b = new THREE.Box3().setFromObject(c); if (b.max.x > maxX) maxX = b.max.x; } });
        const basePosX = maxX + 100 - mesh.geometry.boundingBox.min.x;
        mesh.position.set(basePosX, mesh.position.y, 0);
        window.linkMeshToSpecRow(mesh, tr);
        creatorScene.add(mesh);

        // Bounding box dimensions for grid layout
        const box = new THREE.Box3().setFromObject(mesh);
        const sizeX = Math.max(10, box.max.x - box.min.x);
        const sizeZ = Math.max(10, box.max.z - box.min.z);
        const gap = 20;

        const baseRealColor = (mesh.userData && mesh.userData.originalObjectColor !== undefined)
            ? mesh.userData.originalObjectColor
            : mesh.material.color.getHex();

        for (let i = 1; i < targetQty; i++) {
            const cloneGeo = mesh.geometry.clone();
            const cloneMat = mesh.material.clone();
            cloneMat.color.setHex(baseRealColor);
            const copyMesh = new THREE.Mesh(cloneGeo, cloneMat);
            copyMesh.add(new THREE.LineSegments(
                new THREE.EdgesGeometry(cloneGeo, typeof showRadialEdges !== 'undefined' && showRadialEdges ? 1 : 15), 
                new THREE.LineBasicMaterial({ color: 0x2A3142 })
            ));
            
            const col = i % 5;
            const row = Math.floor(i / 5);
            copyMesh.position.set(
                basePosX + col * (sizeX + gap),
                mesh.position.y,
                row * (sizeZ + gap)
            );
            copyMesh.userData = cloneUserData(mesh.userData);
            copyMesh.userData.originalObjectColor = baseRealColor;
            window.linkMeshToSpecRow(copyMesh, tr);
            creatorScene.add(copyMesh);
        }
        
        window.updateRow3DStatus(tr);
        if (window.selectSpecRowAndFocus3D) {
            window.selectSpecRowAndFocus3D(tr);
        }
        if (typeof showToast === 'function') showToast(`Сгенерировано деталей: ${targetQty}`);
    } else {
        if (typeof showToast === 'function') showToast("Не удалось сгенерировать 3D модель (неизвестный профиль)");
    }
};
window.openExtrudePanel = function() {
    closeQuickPanels();
    const panel = document.getElementById('quick-input-extrude');
    if (panel) {
        panel.style.left = '50%';
        panel.style.top = '50%';
        panel.classList.add('active');
        const origImg = document.getElementById('radial-icon-extrude') || document.getElementById('icon-extrude');
        const img = document.getElementById('quick-icon-extrude');
        if (img && origImg && origImg.src) img.src = origImg.src;
        const depthInput = document.getElementById('qi-extrude-depth');
        if (depthInput) {
            depthInput.focus();
            depthInput.select();
        }
    }

    ['qi-extrude-depth', 'qi-extrude-angle'].forEach(id => {
        const input = document.getElementById(id);
        if (input && !input.dataset.phantomBound) {
            input.addEventListener('input', () => {
                if (typeof window.updateExtrudePhantom === 'function') {
                    window.updateExtrudePhantom();
                }
            });
            input.dataset.phantomBound = "true";
        }
    });

    if (typeof window.updateExtrudePhantom === 'function') {
        window.updateExtrudePhantom();
    }
};

window.applyQuickExtrude = function() {
    if (typeof window.clearExtrudePhantom === 'function' && !window.isPreviewMode) {
        window.clearExtrudePhantom();
    }
    if (!sketchGroup || (sketchSegments.length === 0 && sketchCircles.length === 0)) {
        if (typeof showToast === 'function' && !window.isPreviewMode) showToast("Эскиз пуст или нет контуров");
        return;
    }
    const depthInput = document.getElementById('qi-extrude-depth');
    const angleInput = document.getElementById('qi-extrude-angle');
    
    const depth = parseFloat(depthInput.value);
    const angle = parseFloat(angleInput.value) || 0;
    
    if (isNaN(depth) || depth === 0) {
        if (typeof showToast === 'function' && !window.isPreviewMode) showToast("Некорректная толщина выдавливания");
        return;
    }
    
    const plane = activeSketchPlane;
    if (!plane) return;
    const mesh = performExtrusion(sketchSegments, sketchCircles, plane.userData.up, plane.userData.normal, depth, angle);
    
    if (!mesh) {
        if (typeof window.checkAndHighlightSketchGaps === 'function') {
            window.checkAndHighlightSketchGaps({ notifyUser: true });
        }
        if (typeof showToast === 'function' && !window.isPreviewMode) showToast("Невозможно выдавить незамкнутый эскиз! Места разрывов помечены красными кругами.", "error");
        return;
    }
    
    if (window.isPreviewMode) {
        window.previewMeshResult = mesh;
        return;
    }

    // Позиционируем
    const originWorld = activeSketchPlane.userData.origin || new THREE.Vector3();
    mesh.position.copy(originWorld);
    
    if (window.editingMeshTarget) {
        const targetMesh = window.editingMeshTarget;
        window.editingMeshTarget = null;
        
        // Preserve original position, orientation and scale so the object doesn't flip/rotate
        const savedPos = targetMesh.position.clone();
        const savedQuat = targetMesh.quaternion.clone();
        const savedScale = targetMesh.scale.clone();

        targetMesh.geometry.dispose();
        targetMesh.geometry = mesh.geometry;
        
        while (targetMesh.children.length > 0) {
            const child = targetMesh.children[0];
            targetMesh.remove(child);
            if (child.geometry) child.geometry.dispose();
        }
        while (mesh.children.length > 0) {
            const child = mesh.children[0];
            mesh.remove(child);
            targetMesh.add(child);
        }
        
        // Capture world bottom base points for all bends before position change
        if (targetMesh && targetMesh.userData && targetMesh.userData.bendsList) {
            targetMesh.updateMatrixWorld(true);
            targetMesh.userData.bendsList.forEach(b => {
                if (b.edge) {
                    const initT = b.edge.thickness || b.t || 10;
                    const normalMatrix = new THREE.Matrix3().getNormalMatrix(targetMesh.matrixWorld);
                    let broadNormalWorld = new THREE.Vector3(0, 1, 0).applyMatrix3(normalMatrix).normalize();
                    if (targetMesh.userData && targetMesh.userData.specData && targetMesh.userData.specData.broadNormal) {
                        broadNormalWorld = targetMesh.userData.specData.broadNormal.clone().applyMatrix3(normalMatrix).normalize();
                    }

                    let wThick = b.edge.thicknessDir ? b.edge.thicknessDir.clone().normalize() : new THREE.Vector3(0, 1, 0);
                    if (wThick.dot(broadNormalWorld) < 0) {
                        wThick.negate();
                    }

                    let wV1_base = null, wV2_base = null;
                    if (b.edge.localV1_base && b.edge.localV2_base) {
                        wV1_base = targetMesh.localToWorld(b.edge.localV1_base.clone());
                        wV2_base = targetMesh.localToWorld(b.edge.localV2_base.clone());
                    } else if (b.edge.v1 && b.edge.v2) {
                        wV1_base = b.edge.v1.clone();
                        wV2_base = b.edge.v2.clone();
                    }
                    if (wV1_base && wV2_base) {
                        b._tempWorldV1Base = wV1_base;
                        b._tempWorldV2Base = wV2_base;
                    }
                }
            });
        }

        targetMesh.position.copy(originWorld);
        targetMesh.quaternion.copy(savedQuat);
        targetMesh.scale.copy(savedScale);
        targetMesh.updateMatrixWorld(true);

        // Re-map world base points to targetMesh's new local coordinate system
        if (targetMesh && targetMesh.userData && targetMesh.userData.bendsList) {
            targetMesh.userData.bendsList.forEach(b => {
                if (b._tempWorldV1Base && b._tempWorldV2Base) {
                    b.edge.localV1_base = targetMesh.worldToLocal(b._tempWorldV1Base.clone());
                    b.edge.localV2_base = targetMesh.worldToLocal(b._tempWorldV2Base.clone());

                    const invQ = targetMesh.quaternion.clone().invert();
                    let lThick = b.edge.thicknessDir ? b.edge.thicknessDir.clone().applyQuaternion(invQ).normalize() : new THREE.Vector3(0, 1, 0);
                    let localBroadNorm = new THREE.Vector3(0, 1, 0);
                    if (targetMesh.userData && targetMesh.userData.specData && targetMesh.userData.specData.broadNormal) {
                        localBroadNorm = targetMesh.userData.specData.broadNormal.clone().normalize();
                    }
                    if (lThick.dot(localBroadNorm) < 0) {
                        lThick.negate();
                    }
                    b.edge.localThicknessDir = lThick;

                    if (b.edge.faceNormal) {
                        b.edge.localFaceNormal = b.edge.faceNormal.clone().applyQuaternion(invQ).normalize();
                    }
                    if (b.edge.edgeDir) {
                        b.edge.localEdgeDir = b.edge.edgeDir.clone().applyQuaternion(invQ).normalize();
                    }

                    delete b._tempWorldV1Base;
                    delete b._tempWorldV2Base;
                }
            });
        }

        const hasBends = !!(targetMesh.userData && (
            targetMesh.userData.hasBends ||
            (targetMesh.userData.bendsList && targetMesh.userData.bendsList.length > 0) ||
            (targetMesh.userData.specData && targetMesh.userData.specData.type === 'bent_plate')
        ));
        
        targetMesh.userData.baseGeometry = mesh.geometry.clone();

        targetMesh.userData.specData = {
            ...(targetMesh.userData.specData || {}),
            type: hasBends ? 'bent_plate' : ((targetMesh.userData.specData && (targetMesh.userData.specData.type === 'plate' || targetMesh.userData.specData.type === 'bent_plate')) ? 'plate' : 'extrude'),
            t: Math.abs(depth),
            th: Math.abs(depth),
            thickness: Math.abs(depth),
            wallThick: Math.abs(depth),
            depth: Math.abs(depth),
            broadNormal: plane.userData.normal.clone()
        };

        if (hasBends) {
            targetMesh.userData.hasBends = true;
            if (targetMesh.userData.bendsList && targetMesh.userData.bendsList.length > 0) {
                if (typeof window.rebuildObjectFromBends === 'function') {
                    try {
                        window.rebuildObjectFromBends(targetMesh);
                    } catch (e) {
                        console.error("Rebuilding bends failed:", e);
                    }
                }
            }
        }
        
        targetMesh.userData.sketchSource = {
            segments: sketchSegments.map(s => ({ start: s.start.clone(), end: s.end.clone(), isInfinite: s.isInfinite, color: s.color })),
            circles: sketchCircles.map(c => ({ center: c.center.clone(), radius: c.radius })),
            up: plane.userData.up.clone(),
            normal: plane.userData.normal.clone(),
            origin: originWorld.clone(),
            depth: depth,
            draftAngle: angle
        };

        targetMesh.visible = true;
        
        if (window.editingMeshParentGroup) {
            window.editingMeshParentGroup.visible = true;
            if (window.editingMeshParentGroup.userData && window.editingMeshParentGroup.userData.specData) {
                const pSpec = window.editingMeshParentGroup.userData.specData;
                pSpec.plateT = Math.abs(depth);
                pSpec.t = Math.abs(depth);
                if (targetMesh.geometry) {
                    targetMesh.geometry.computeBoundingBox();
                    if (targetMesh.geometry.boundingBox) {
                        const szX = Math.abs(targetMesh.geometry.boundingBox.max.x - targetMesh.geometry.boundingBox.min.x);
                        const szZ = Math.abs(targetMesh.geometry.boundingBox.max.z - targetMesh.geometry.boundingBox.min.z);
                        if (szX > 0) { pSpec.plateL = Math.round(szX); pSpec.l = Math.round(szX); }
                        if (szZ > 0) { pSpec.plateW = Math.round(szZ); pSpec.w = Math.round(szZ); }
                    }
                }
            }
            const groupTr = window.getSpecRowByMesh(window.editingMeshParentGroup);
            if (groupTr && window.autoCalculateMass) {
                window.autoCalculateMass(groupTr);
            }
            window.editingMeshParentGroup = null;
        }
        
        const tr = window.getSpecRowByMesh(targetMesh);
        if (tr) {
            const posInput = tr.querySelector('td:nth-child(2) input');
            const nameInput = tr.querySelector('td:nth-child(3) input');
            const dimTd = tr.querySelector('td:nth-child(4)');
            const dimInputs = dimTd ? dimTd.querySelectorAll('input') : [];
            const commentInput = tr.querySelector('td:nth-child(9) input');

            if (posInput && (!posInput.value.trim() || isNaN(parseFloat(posInput.value.trim())))) {
                const tbody = tr.parentElement;
                if (tbody) {
                    const rowIdx = Array.from(tbody.children).indexOf(tr) + 1;
                    posInput.value = rowIdx.toString();
                }
            }

            if (targetMesh.geometry) targetMesh.geometry.computeBoundingBox();
            const info = window.extractMeshSpecInfo(targetMesh);
            if (info) {
                if (nameInput) {
                    nameInput.value = info.typeName;
                    nameInput.dispatchEvent(new Event('input'));
                }
                if (info.category === 'plate' && dimInputs.length >= 3) {
                    if (dimInputs[0]) dimInputs[0].value = (info.t !== undefined ? info.t : Math.abs(depth)).toString();
                    if (dimInputs[1]) dimInputs[1].value = (info.w !== undefined ? info.w : '').toString();
                    if (dimInputs[2]) dimInputs[2].value = (info.l !== undefined ? info.l : '').toString();
                }
            }

            if (commentInput) {
                commentInput.value = `Выдавленный эскиз (${depth}мм)`;
            }
            if (window.autoCalculateMass) window.autoCalculateMass(tr);
        }
        
        cancelSketch();
        closeQuickPanels();
        if (typeof window.refreshSpecTable === 'function') {
            window.refreshSpecTable();
        }
        if (typeof showToast === 'function') showToast("3D тело обновлено по эскизу");
        return;
    }

    creatorScene.add(mesh);
    addPartToSpec(`Выдавленный эскиз (${depth}мм)`, mesh);
    
    cancelSketch(); // Выходим из режима эскиза
    closeQuickPanels();
    if (typeof showToast === 'function') showToast("Эскиз выдавлен");
};

let selectedThicknessDirection = 'side1';

window.selectThicknessDirection = function(dir) {
    selectedThicknessDirection = dir;
    ['side1', 'side2', 'mid'].forEach(d => {
        const btn = document.getElementById('qi-thickness-dir-' + d);
        if (btn) {
            if (d === dir) {
                btn.classList.add('active');
                btn.style.borderColor = '#2563EB';
                btn.style.background = '#EFF6FF';
                btn.style.color = '#1E40AF';
            } else {
                btn.classList.remove('active');
                btn.style.borderColor = '#CBD5E1';
                btn.style.background = '#F8FAFC';
                btn.style.color = '#475569';
            }
        }
    });
    if (typeof window.updateThicknessPhantom === 'function') {
        window.updateThicknessPhantom();
    }
};

window.openThicknessPanel = function() {
    closeQuickPanels();
    const panel = document.getElementById('quick-input-thickness');
    if (panel) {
        panel.style.left = '50%';
        panel.style.top = '50%';
        panel.classList.add('active');
        const origImg = document.getElementById('radial-icon-thickness') || document.getElementById('icon-thickness');
        const img = document.getElementById('quick-icon-thickness');
        if (img && origImg && origImg.src) img.src = origImg.src;
        const valInput = document.getElementById('qi-thickness-value');
        if (valInput) {
            valInput.focus();
            valInput.select();
        }
    }

    ['qi-thickness-value', 'qi-thickness-height'].forEach(id => {
        const input = document.getElementById(id);
        if (input && !input.dataset.phantomBound) {
            input.addEventListener('input', () => {
                if (typeof window.updateThicknessPhantom === 'function') {
                    window.updateThicknessPhantom();
                }
            });
            input.dataset.phantomBound = "true";
        }
    });

    if (typeof window.updateThicknessPhantom === 'function') {
        window.updateThicknessPhantom();
    }
};

window.updateThicknessPhantom = function() {
    window.clearExtrudePhantom();
    if (!sketchGroup || (sketchSegments.length === 0 && sketchCircles.length === 0)) {
        return;
    }

    const valueInput = document.getElementById('qi-thickness-value');
    const heightInput = document.getElementById('qi-thickness-height');

    let thickness = valueInput ? parseFloat(valueInput.value) : 3;
    if (isNaN(thickness) || thickness <= 0) thickness = 3;
    let height = heightInput ? parseFloat(heightInput.value) : 50;
    if (isNaN(height) || height <= 0) height = 50;

    const plane = activeSketchPlane;
    if (!plane) return;

    const phantomMesh = performThickness(sketchSegments, sketchCircles, plane.userData.up, plane.userData.normal, thickness, height, selectedThicknessDirection);

    if (phantomMesh) {
        if (plane.userData && plane.userData.origin) {
            phantomMesh.position.copy(plane.userData.origin);
        }
        phantomMesh.material = new THREE.MeshStandardMaterial({
            color: 0x3B82F6,
            transparent: true,
            opacity: 0.45,
            roughness: 0.4,
            metalness: 0.2,
            depthWrite: false
        });
        phantomMesh.userData.isPhantom = true;
        sketchExtrudePhantom = phantomMesh;
        creatorScene.add(sketchExtrudePhantom);
    }

    const panel = document.getElementById('quick-input-thickness');
    if (panel && panel.classList.contains('show-preview')) {
        updatePreview('thickness');
    }
};

function performThickness(segments, circles, up, normal, thickness, height, direction = 'side1') {
    const absThickness = Math.abs(thickness) || 3;
    const absHeight = Math.abs(height) || 50;
    const right = new THREE.Vector3().crossVectors(up, normal).normalize();

    const origin = (activeSketchPlane && activeSketchPlane.userData && activeSketchPlane.userData.origin) 
        ? activeSketchPlane.userData.origin.clone() 
        : new THREE.Vector3(0, 0, 0);

    function project(pt) {
        const rel = pt.clone().sub(origin);
        return new THREE.Vector2(rel.dot(right), rel.dot(up));
    }

    if ((!segments || segments.length === 0) && (!circles || circles.length === 0)) {
        return null;
    }

    let shapes = [];

    // 1. Circles
    if (circles && circles.length > 0) {
        circles.forEach(c => {
            const center2d = project(c.center);
            const r = c.radius;
            let rOuter, rInner;
            if (direction === 'side1') {
                rOuter = r + absThickness;
                rInner = r;
            } else if (direction === 'side2') {
                rOuter = r;
                rInner = Math.max(0.1, r - absThickness);
            } else {
                rOuter = r + absThickness / 2;
                rInner = Math.max(0.1, r - absThickness / 2);
            }

            const shape = new THREE.Shape();
            shape.absarc(center2d.x, center2d.y, rOuter, 0, Math.PI * 2, false);

            if (rInner > 0.05) {
                const holePath = new THREE.Path();
                holePath.absarc(center2d.x, center2d.y, rInner, 0, Math.PI * 2, true);
                shape.holes.push(holePath);
            }
            shapes.push(shape);
        });
    }

    // 2. Line Segments
    if (segments && segments.length > 0) {
        let segs = segments.map(s => ({ start: project(s.start), end: project(s.end), used: false }));

        let chains = [];
        const TOL = 1e-3;

        for (let i = 0; i < segs.length; i++) {
            if (segs[i].used) continue;
            let chain = [segs[i].start, segs[i].end];
            segs[i].used = true;

            let currentStart = chain[0];
            let currentEnd = chain[chain.length - 1];
            let closed = false;

            let expanding = true;
            let safetyCount = 0;
            while (expanding && !closed) {
                if (safetyCount++ > 5000) {
                    console.warn("performThickness stitch loop infinite loop guard triggered.");
                    break;
                }
                expanding = false;

                // 1. Expand forward from currentEnd
                for (let j = 0; j < segs.length; j++) {
                    if (!segs[j].used) {
                        if (segs[j].start.distanceTo(currentEnd) < TOL) {
                            currentEnd = segs[j].end;
                            chain.push(currentEnd);
                            segs[j].used = true;
                            expanding = true;
                            break;
                        } else if (segs[j].end.distanceTo(currentEnd) < TOL) {
                            currentEnd = segs[j].start;
                            chain.push(currentEnd);
                            segs[j].used = true;
                            expanding = true;
                            break;
                        }
                    }
                }

                // Check if loop closed at currentEnd
                if (currentEnd.distanceTo(currentStart) < TOL && chain.length > 2) {
                    closed = true;
                    chain.pop();
                    break;
                }

                // 2. Expand backward from currentStart
                for (let j = 0; j < segs.length; j++) {
                    if (!segs[j].used) {
                        if (segs[j].end.distanceTo(currentStart) < TOL) {
                            currentStart = segs[j].start;
                            chain.unshift(currentStart);
                            segs[j].used = true;
                            expanding = true;
                            break;
                        } else if (segs[j].start.distanceTo(currentStart) < TOL) {
                            currentStart = segs[j].end;
                            chain.unshift(currentStart);
                            segs[j].used = true;
                            expanding = true;
                            break;
                        }
                    }
                }

                // Check if loop closed at currentStart
                if (currentStart.distanceTo(currentEnd) < TOL && chain.length > 2) {
                    closed = true;
                    chain.pop();
                    break;
                }
            }

            chains.push({ points: chain, isClosed: closed });
        }

        chains.forEach(ch => {
            const pts = ch.points;
            if (pts.length < 2) return;

            if (ch.isClosed && pts.length >= 3) {
                // Determine polygon orientation using Shoelace formula on 2D points
                let area = 0;
                const numPts = pts.length;
                for (let i = 0; i < numPts; i++) {
                    const j = (i + 1) % numPts;
                    area += (pts[i].x * pts[j].y - pts[j].x * pts[i].y);
                }
                
                let polyCCW = pts.slice();
                // If area < 0, polygon is Clockwise (CW), so reverse it to make it Counter-Clockwise (CCW)
                if (area < 0) {
                    polyCCW.reverse();
                }

                const n = polyCCW.length;
                
                // Calculate outward offset vectors for each vertex of polyCCW
                let outerLoop = [];
                let innerLoop = [];

                for (let i = 0; i < n; i++) {
                    const prev = polyCCW[(i - 1 + n) % n];
                    const curr = polyCCW[i];
                    const next = polyCCW[(i + 1) % n];

                    const v1 = curr.clone().sub(prev).normalize();
                    const v2 = next.clone().sub(curr).normalize();

                    // For CCW polygon, right-turn vector (v.y, -v.x) points OUTWARD
                    const n1_out = new THREE.Vector2(v1.y, -v1.x);
                    const n2_out = new THREE.Vector2(v2.y, -v2.x);

                    let m_out = n1_out.clone().add(n2_out).normalize();
                    let dot = m_out.dot(n1_out);
                    let miter = dot > 0.1 ? (1 / dot) : 1.0;
                    miter = Math.min(miter, 3.0);

                    if (direction === 'side1') { // Outward
                        outerLoop.push(curr.clone().addScaledVector(m_out, absThickness * miter));
                        innerLoop.push(curr.clone());
                    } else if (direction === 'side2') { // Inward
                        outerLoop.push(curr.clone());
                        innerLoop.push(curr.clone().addScaledVector(m_out, -absThickness * miter));
                    } else { // mid (Centered)
                        outerLoop.push(curr.clone().addScaledVector(m_out, (absThickness / 2) * miter));
                        innerLoop.push(curr.clone().addScaledVector(m_out, (-absThickness / 2) * miter));
                    }
                }

                // outerLoop is CCW and forms the outer boundary
                const shape = new THREE.Shape();
                if (outerLoop.length > 0) {
                    shape.moveTo(outerLoop[0].x, outerLoop[0].y);
                    for (let k = 1; k < outerLoop.length; k++) {
                        shape.lineTo(outerLoop[k].x, outerLoop[k].y);
                    }
                    shape.closePath();
                }

                // innerLoop is CCW; reversing it makes it CW for hole
                const holePts = innerLoop.slice().reverse();
                if (holePts.length > 0) {
                    const holePath = new THREE.Path();
                    holePath.moveTo(holePts[0].x, holePts[0].y);
                    for (let k = 1; k < holePts.length; k++) {
                        holePath.lineTo(holePts[k].x, holePts[k].y);
                    }
                    holePath.closePath();
                    shape.holes.push(holePath);
                }

                shapes.push(shape);

            } else {
                let dLeft = 0, dRight = 0;
                if (direction === 'side1') {
                    dLeft = absThickness;
                    dRight = 0;
                } else if (direction === 'side2') {
                    dLeft = 0;
                    dRight = absThickness;
                } else {
                    dLeft = absThickness / 2;
                    dRight = absThickness / 2;
                }

                const num = pts.length;
                let leftPts = [];
                let rightPts = [];

                for (let i = 0; i < num; i++) {
                    let n;
                    let miter = 1.0;
                    if (i === 0) {
                        const v = pts[1].clone().sub(pts[0]).normalize();
                        n = new THREE.Vector2(-v.y, v.x);
                    } else if (i === num - 1) {
                        const v = pts[num - 1].clone().sub(pts[num - 2]).normalize();
                        n = new THREE.Vector2(-v.y, v.x);
                    } else {
                        const v1 = pts[i].clone().sub(pts[i - 1]).normalize();
                        const v2 = pts[i + 1].clone().sub(pts[i]).normalize();
                        const n1 = new THREE.Vector2(-v1.y, v1.x);
                        const n2 = new THREE.Vector2(-v2.y, v2.x);
                        n = n1.clone().add(n2).normalize();
                        let dot = n.dot(n1);
                        miter = dot > 0.1 ? 1 / dot : 1.0;
                        miter = Math.min(miter, 3.0);
                    }

                    leftPts.push(pts[i].clone().addScaledVector(n, dLeft * miter));
                    rightPts.push(pts[i].clone().addScaledVector(n, -dRight * miter));
                }

                let polygonLoop = [...leftPts];
                for (let i = rightPts.length - 1; i >= 0; i--) {
                    polygonLoop.push(rightPts[i]);
                }

                const shape = new THREE.Shape();
                if (polygonLoop.length > 0) {
                    shape.moveTo(polygonLoop[0].x, polygonLoop[0].y);
                    for (let k = 1; k < polygonLoop.length; k++) {
                        shape.lineTo(polygonLoop[k].x, polygonLoop[k].y);
                    }
                    shape.closePath();
                }
                shapes.push(shape);
            }
        });
    }

    if (shapes.length === 0) return null;

    const geometries = shapes.map(sh => new THREE.ExtrudeGeometry(sh, { depth: absHeight, bevelEnabled: false }));
    
    let combinedGeometry;
    if (geometries.length === 1) {
        combinedGeometry = geometries[0];
    } else {
        if (typeof THREE.BufferGeometryUtils !== 'undefined' && THREE.BufferGeometryUtils.mergeGeometries) {
            combinedGeometry = THREE.BufferGeometryUtils.mergeGeometries(geometries);
        } else if (typeof BufferGeometryUtils !== 'undefined' && BufferGeometryUtils.mergeBufferGeometries) {
            combinedGeometry = BufferGeometryUtils.mergeBufferGeometries(geometries);
        } else {
            combinedGeometry = geometries[0];
        }
    }

    const matrix = new THREE.Matrix4();
    matrix.makeBasis(right, up, normal);
    combinedGeometry.applyMatrix4(matrix);

    const material = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, metalness: 0.5, roughness: 0.4 });
    const mesh = new THREE.Mesh(combinedGeometry, material);
    mesh.position.copy(origin);

    const edges = new THREE.EdgesGeometry(combinedGeometry, (typeof showRadialEdges !== 'undefined' && showRadialEdges) ? 1 : 15);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x2A3142 }));
    mesh.add(line);

    mesh.userData.specData = {
        type: 'extrude',
        t: absThickness,
        th: absThickness,
        thickness: absThickness,
        wallThick: absThickness,
        depth: absHeight,
        height: absHeight,
        broadNormal: normal.clone()
    };
    mesh.userData.sketchSource = {
        segments: segments.map(s => ({ start: s.start.clone(), end: s.end.clone(), isInfinite: s.isInfinite, color: s.color })),
        circles: circles.map(c => ({ center: c.center.clone(), radius: c.radius })),
        up: up.clone(),
        normal: normal.clone(),
        origin: origin.clone(),
        depth: absHeight,
        thickness: absThickness,
        direction: direction
    };

    return mesh;
}

window.applyQuickThickness = function() {
    if (typeof window.clearExtrudePhantom === 'function' && !window.isPreviewMode) {
        window.clearExtrudePhantom();
    }
    if (!sketchGroup || (sketchSegments.length === 0 && sketchCircles.length === 0)) {
        if (typeof showToast === 'function' && !window.isPreviewMode) showToast("Эскиз пуст");
        return;
    }
    const valueInput = document.getElementById('qi-thickness-value');
    const heightInput = document.getElementById('qi-thickness-height');

    const thickness = parseFloat(valueInput.value);
    const height = parseFloat(heightInput.value);

    if (isNaN(thickness) || thickness <= 0 || isNaN(height) || height <= 0) {
        if (typeof showToast === 'function' && !window.isPreviewMode) showToast("Некорректная толщина или высота");
        return;
    }

    const plane = activeSketchPlane;
    if (!plane) return;
    const mesh = performThickness(sketchSegments, sketchCircles, plane.userData.up, plane.userData.normal, thickness, height, selectedThicknessDirection);

    if (!mesh) {
        if (typeof showToast === 'function' && !window.isPreviewMode) showToast("Не удалось построить геометрию");
        return;
    }

    if (window.isPreviewMode) {
        window.previewMeshResult = mesh;
        return;
    }

    const originWorld = activeSketchPlane.userData.origin || new THREE.Vector3();
    mesh.position.copy(originWorld);

    if (window.editingMeshTarget) {
        const targetMesh = window.editingMeshTarget;
        window.editingMeshTarget = null;

        const savedPos = targetMesh.position.clone();
        const savedQuat = targetMesh.quaternion.clone();
        const savedScale = targetMesh.scale.clone();

        targetMesh.geometry.dispose();
        targetMesh.geometry = mesh.geometry;

        while (targetMesh.children.length > 0) {
            const child = targetMesh.children[0];
            targetMesh.remove(child);
            if (child.geometry) child.geometry.dispose();
        }
        while (mesh.children.length > 0) {
            const child = mesh.children[0];
            mesh.remove(child);
            targetMesh.add(child);
        }

        targetMesh.position.copy(originWorld);
        targetMesh.quaternion.copy(savedQuat);
        targetMesh.scale.copy(savedScale);
        targetMesh.updateMatrixWorld(true);

        targetMesh.userData.specData = {
            ...(targetMesh.userData.specData || {}),
            type: 'extrude',
            t: thickness,
            th: thickness,
            thickness: thickness,
            depth: height,
            height: height
        };

        targetMesh.visible = true;

        if (window.editingMeshParentGroup) {
            window.editingMeshParentGroup.visible = true;
            window.editingMeshParentGroup = null;
        }

        if (typeof showToast === 'function') showToast("Деталь обновлена по эскизу");
    } else {
        creatorScene.add(mesh);
        if (typeof extractMeshSpecInfo === 'function') {
            extractMeshSpecInfo(mesh);
        }
        if (typeof addPartToSpec === 'function') {
            addPartToSpec(`Деталь с толщиной (${thickness}x${height}мм)`, mesh);
        }
        if (typeof showToast === 'function') showToast("Деталь создана по толщине");
    }

    cancelSketch();
    closeQuickPanels();
};

window.getOrCreateSketchSource = function(mesh) {
    if (!mesh) return null;

    let targetMesh = mesh;
    if (mesh.isGroup || (mesh.children && mesh.children.length > 0 && !mesh.geometry)) {
        let base = null;
        mesh.traverse(c => {
            if (!base && c.isMesh && c.geometry && (c.userData.isBasePlate || c.userData.isPanelPlate || (c.name && (c.name.includes('Основание') || c.name.includes('Лист') || c.name.includes('Плита') || c.name.includes('ПКО'))))) {
                base = c;
            }
        });
        if (!base) {
            mesh.traverse(c => {
                if (!base && c.isMesh && c.geometry) base = c;
            });
        }
        if (base) targetMesh = base;
    }

    if (targetMesh.userData && targetMesh.userData.sketchSource) {
        return targetMesh.userData.sketchSource;
    }
    if (targetMesh.userData && targetMesh.userData.isSketch) {
        return {
            segments: (targetMesh.userData.segments || []).map(s => ({ start: s.start.clone(), end: s.end.clone(), isInfinite: s.isInfinite, color: s.color })),
            circles: (targetMesh.userData.circles || []).map(c => ({ center: c.center.clone(), radius: c.radius })),
            up: targetMesh.userData.up ? targetMesh.userData.up.clone() : new THREE.Vector3(0, 1, 0),
            normal: targetMesh.userData.normal ? targetMesh.userData.normal.clone() : new THREE.Vector3(0, 0, 1),
            origin: targetMesh.position.clone(),
            depth: 10,
            draftAngle: 0
        };
    }
    const spec = (mesh.userData && mesh.userData.specData) || (targetMesh.userData && targetMesh.userData.specData) || null;
    if (spec) {
        const type = spec.type;
        const origin = targetMesh.position.clone();
        
        let normal = spec.broadNormal ? spec.broadNormal.clone() : new THREE.Vector3(0, 0, 1).applyQuaternion(targetMesh.quaternion);
        let up = new THREE.Vector3(0, 1, 0).applyQuaternion(targetMesh.quaternion);
        if (Math.abs(up.dot(normal)) > 0.9) {
            up = new THREE.Vector3(1, 0, 0).applyQuaternion(targetMesh.quaternion);
        }
        const right = new THREE.Vector3().crossVectors(up, normal).normalize();
        up.crossVectors(normal, right).normalize();

        if (type === 'plate' || type === 'bent_plate' || type === 'panel' || mesh.userData.isPanel || targetMesh.userData.isPanel) {
            const w = spec.plateW || spec.w || 1000;
            const l = spec.plateL || spec.l || 2000;
            const t = spec.plateT || spec.t || spec.thickness || 10;
            const hw = w / 2;
            const hl = l / 2;

            let normal = spec.broadNormal 
                ? spec.broadNormal.clone().applyQuaternion(targetMesh.quaternion) 
                : new THREE.Vector3(0, 1, 0).applyQuaternion(targetMesh.quaternion);
                
            let up = new THREE.Vector3(0, 0, -1).applyQuaternion(targetMesh.quaternion);
            if (Math.abs(up.dot(normal)) > 0.9) {
                up = new THREE.Vector3(1, 0, 0).applyQuaternion(targetMesh.quaternion);
            }
            const right = new THREE.Vector3().crossVectors(up, normal).normalize();
            up.crossVectors(normal, right).normalize();

            const isBoxCentered = !targetMesh.userData.sketchSource && (targetMesh.geometry && targetMesh.geometry.type === 'BoxGeometry');
            const plateOrigin = isBoxCentered 
                ? targetMesh.position.clone().sub(normal.clone().multiplyScalar(t / 2))
                : targetMesh.position.clone();
            
            const p1 = plateOrigin.clone().add(right.clone().multiplyScalar(-hl)).add(up.clone().multiplyScalar(-hw));
            const p2 = plateOrigin.clone().add(right.clone().multiplyScalar(hl)).add(up.clone().multiplyScalar(-hw));
            const p3 = plateOrigin.clone().add(right.clone().multiplyScalar(hl)).add(up.clone().multiplyScalar(hw));
            const p4 = plateOrigin.clone().add(right.clone().multiplyScalar(-hl)).add(up.clone().multiplyScalar(hw));
            
            return {
                segments: [
                    { start: p1, end: p2 },
                    { start: p2, end: p3 },
                    { start: p3, end: p4 },
                    { start: p4, end: p1 }
                ],
                circles: [],
                up, normal, origin: plateOrigin,
                depth: t,
                w: w,
                l: l,
                draftAngle: 0
            };
        } else {
            const origin = targetMesh.position.clone();
            let normal = spec.broadNormal ? spec.broadNormal.clone().applyQuaternion(targetMesh.quaternion) : new THREE.Vector3(0, 0, 1).applyQuaternion(targetMesh.quaternion);
            let up = new THREE.Vector3(0, 1, 0).applyQuaternion(targetMesh.quaternion);
            if (Math.abs(up.dot(normal)) > 0.9) {
                up = new THREE.Vector3(1, 0, 0).applyQuaternion(targetMesh.quaternion);
            }
            const right = new THREE.Vector3().crossVectors(up, normal).normalize();
            up.crossVectors(normal, right).normalize();

            if (type === 'cylinder') {
                const d = spec.d || 100;
                const l = spec.l || 500;
                return {
                    segments: [],
                    circles: [{ center: origin.clone(), radius: d / 2 }],
                    up, normal, origin,
                    depth: l,
                    draftAngle: 0
                };
            } else if (type === 'knitsa') {
                const h = spec.h || 200;
                const l = spec.l || 200;
                const th = spec.th || 10;
                const p1 = origin.clone();
                const p2 = origin.clone().add(right.clone().multiplyScalar(l));
                const p3 = origin.clone().add(up.clone().multiplyScalar(h));
                return {
                    segments: [
                        { start: p1, end: p2 },
                        { start: p2, end: p3 },
                        { start: p3, end: p1 }
                    ],
                    circles: [],
                    up, normal, origin,
                    depth: th,
                    draftAngle: 0
                };
            } else if (type === 'extrude') {
                const depth = spec.depth || spec.t || 10;
                return {
                    segments: [],
                    circles: [],
                    up, normal, origin,
                    depth,
                    draftAngle: 0
                };
            }
        }
    }
    return null;
};

window.editSelectedSketch = function() {
    let entity = null;
    if (typeof selectedObjects !== 'undefined' && selectedObjects.length > 0) {
        entity = selectedObjects[0];
    } else if (window.selectedObjects && window.selectedObjects.length > 0) {
        entity = window.selectedObjects[0];
    }
    
    if (!entity) {
        if (typeof showToast === 'function') showToast("Выберите 3D объект для редактирования топологии");
        return;
    }

    let targetMesh = entity;
    let parentGroup = null;

    if (entity.isGroup || (entity.children && entity.children.length > 0 && !entity.geometry)) {
        parentGroup = entity;
        let base = null;
        entity.traverse(c => {
            if (!base && c.isMesh && c.geometry && (c.userData.isBasePlate || c.userData.isPanelPlate || (c.name && (c.name.includes('Основание') || c.name.includes('Лист') || c.name.includes('Плита') || c.name.includes('ПКО'))))) {
                base = c;
            }
        });
        if (!base) {
            entity.traverse(c => {
                if (!base && c.isMesh && c.geometry) base = c;
            });
        }
        if (base) targetMesh = base;
    }

    const sketchSource = window.getOrCreateSketchSource(entity) || window.getOrCreateSketchSource(targetMesh);
    if (!sketchSource || (!sketchSource.segments.length && !sketchSource.circles.length)) {
        if (typeof showToast === 'function') showToast("У выбранного объекта нет данных эскиза");
        return;
    }

    window.editingMeshParentGroup = parentGroup;
    window.editingMeshTarget = targetMesh;

    if (parentGroup) {
        parentGroup.visible = false;
    } else {
        targetMesh.visible = false;
    }

    // Скрываем 3D гизмо и очищаем выделение
    if (typeof cancelGizmo === 'function') cancelGizmo();
    if (typeof customGizmo !== 'undefined' && customGizmo) customGizmo.visible = false;
    if (typeof selectedObjects !== 'undefined') {
        selectedObjects.forEach(obj => {
            if (obj.userData && obj.userData.originalObjectColor !== undefined && obj.material && obj.material.color) {
                obj.material.color.setHex(obj.userData.originalObjectColor);
                delete obj.userData.originalObjectColor;
            }
        });
        selectedObjects = [];
    }

    const origin = sketchSource.origin ? sketchSource.origin.clone() : targetMesh.position.clone();
    const up = sketchSource.up ? sketchSource.up.clone() : new THREE.Vector3(0, 1, 0);
    const normal = sketchSource.normal ? sketchSource.normal.clone() : new THREE.Vector3(0, 0, 1);

    const planeMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(5000, 5000),
        new THREE.MeshBasicMaterial({ color: 0x5AAFDD, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false })
    );
    planeMesh.position.copy(origin);
    const right = new THREE.Vector3().crossVectors(up, normal).normalize();
    const matrix = new THREE.Matrix4();
    matrix.makeBasis(right, up, normal);
    planeMesh.setRotationFromMatrix(matrix);
    planeMesh.userData = {
        isSketchPlane: true,
        normal: normal.clone(),
        up: up.clone(),
        origin: origin.clone(),
        name: 'TopologyEditPlane'
    };
    creatorScene.add(planeMesh);

    selectPlane(planeMesh);

    // Центрируем камеру и подбираем комфортный 2D масштаб для основания
    const maxDim = Math.max(sketchSource.w || 1000, sketchSource.l || 1000, 500);
    if (currentCreatorCamera && currentCreatorCamera.isOrthographicCamera) {
        currentCreatorCamera.zoom = Math.max(0.2, Math.min(3.0, 1200 / maxDim));
        currentCreatorCamera.updateProjectionMatrix();
    }

    window.rebuildSketchLines = function() {
        if (!sketchGroup) return;
        sketchGroup.clear();
        const lineMat = new THREE.LineBasicMaterial({ color: 0x1E293B, linewidth: 2, depthTest: false });
        const bulbMat = new THREE.LineBasicMaterial({ color: 0x2563EB, linewidth: 2, depthTest: false });
        const blueMat = new THREE.LineBasicMaterial({ color: 0x2563EB, linewidth: 2, depthTest: false });

        sketchSegments.forEach(s => {
            let mat = lineMat;
            if (s.isStiffenerBulb || s.color === 0x2563EB) {
                mat = bulbMat;
            } else if (s.isInfinite) {
                mat = blueMat;
            }
            const geo = new THREE.BufferGeometry().setFromPoints([s.start, s.end]);
            const line = new THREE.Line(geo, mat);
            line.renderOrder = 1;
            sketchGroup.add(line);
        });

        sketchCircles.forEach(c => {
            const geo = new THREE.CircleGeometry(c.radius, 64);
            const edges = new THREE.EdgesGeometry(geo, typeof showRadialEdges !== 'undefined' && showRadialEdges ? 1 : 15);
            const circleLine = new THREE.LineSegments(edges, lineMat);
            circleLine.position.copy(c.center);
            circleLine.renderOrder = 1;
            circleLine.isSketchCircleMesh = true;
            if (typeof alignToPlane === 'function' && activeSketchPlane) {
                alignToPlane(circleLine, activeSketchPlane);
            }
            sketchGroup.add(circleLine);
        });

        if (typeof recomputeSketchCenters === 'function') recomputeSketchCenters();
    };

    sketchSegments = sketchSource.segments.map(s => ({
        start: s.start.clone(),
        end: s.end.clone(),
        isInfinite: s.isInfinite || false,
        color: s.color || 0x1E293B
    }));
    sketchCircles = sketchSource.circles.map(c => ({
        center: c.center.clone(),
        radius: c.radius
    }));

    if (sketchGroup) {
        sketchGroup.clear();
    } else {
        sketchGroup = new THREE.Group();
        creatorScene.add(sketchGroup);
    }

    const lineMat = new THREE.LineBasicMaterial({ color: 0x1E293B, linewidth: 2, depthTest: false });

    sketchSegments.forEach(s => {
        const geo = new THREE.BufferGeometry().setFromPoints([s.start, s.end]);
        const line = new THREE.Line(geo, lineMat);
        line.renderOrder = 1;
        sketchGroup.add(line);
        if (!sketchPoints.some(sp => sp.distanceTo(s.start) < 0.1)) sketchPoints.push(s.start.clone());
        if (!sketchPoints.some(sp => sp.distanceTo(s.end) < 0.1)) sketchPoints.push(s.end.clone());
    });

    sketchCircles.forEach(c => {
        const geo = new THREE.CircleGeometry(c.radius, 64);
        const edges = new THREE.EdgesGeometry(geo, showRadialEdges ? 1 : 15);
        const circleLine = new THREE.LineSegments(edges, lineMat);
        circleLine.position.copy(c.center);
        circleLine.renderOrder = 1;
        circleLine.isSketchCircleMesh = true;
        alignToPlane(circleLine, activeSketchPlane);
        sketchGroup.add(circleLine);
    });

    // Ребра жесткости в топологии: отображаем ровно 3 линии для каждого ребра
    // (две линии - основание/ножки стенки, третья линия - габарит по бульбе/полке)
    const stiffenerMeshes = [];
    const searchRoot = parentGroup || (entity.isGroup ? entity : null);
    if (searchRoot) {
        searchRoot.traverse(c => {
            if (c.isMesh && (c.userData.isPanelStiffener || (c.name && c.name.includes('Ребро')) || (c.userData.specData && c.userData.specData.type === 'profile'))) {
                stiffenerMeshes.push(c);
            }
        });
    }

    if (stiffenerMeshes.length > 0) {
        const bulbDict = (window.BulbProfiles && Object.keys(window.BulbProfiles).length > 0) ? window.BulbProfiles : BulbProfiles;
        const bulbMat = new THREE.LineBasicMaterial({ color: 0x2563EB, linewidth: 2, depthTest: false });

        stiffenerMeshes.forEach(stMesh => {
            const spec = stMesh.userData.specData || {};
            const stName = spec.name || stMesh.name || 'HP 160x8';
            let pts = bulbDict ? bulbDict[stName] : null;
            if (!pts && typeof getAngleProfilePoints === 'function') pts = getAngleProfilePoints(stName);

            let webThick = 8;
            let bulbMaxX = 25;

            if (pts && pts.length >= 4) {
                let maxH = 0;
                let maxX = 0;
                pts.forEach(p => {
                    if (p[0] > maxX) maxX = p[0];
                    if (p[1] > maxH) maxH = p[1];
                });
                pts.forEach(pt => {
                    if (Math.abs(pt[1]) < 0.05 && pt[0] > 0.05) {
                        webThick = pt[0];
                    }
                });
                bulbMaxX = maxX > 0 ? maxX : (webThick + 25);
            } else {
                const match = (stName || '').match(/[\dxX*хХ]+[xX*хХ](\d+(?:\.\d+)?)/);
                if (match) webThick = parseFloat(match[1]) || 8;
                bulbMaxX = webThick + 25;
            }

            let totalLen = spec.l || 0;
            if (!totalLen || totalLen <= 0) {
                if (stMesh.geometry) {
                    stMesh.geometry.computeBoundingBox();
                    if (stMesh.geometry.boundingBox) {
                        totalLen = Math.abs(stMesh.geometry.boundingBox.max.z - stMesh.geometry.boundingBox.min.z);
                    }
                }
            }
            if (!totalLen || totalLen <= 0) totalLen = sketchSource.w || 1000;

            // Три линии в мировых координатах:
            // 1. Левая кромка ножки у основания (x=0)
            // 2. Правая кромка ножки у основания (x=webThick)
            // 3. Габаритная линия по бульбе (x=bulbMaxX)
            const l1_start = stMesh.localToWorld(new THREE.Vector3(0, 0, 0));
            const l1_end   = stMesh.localToWorld(new THREE.Vector3(0, 0, totalLen));

            const l2_start = stMesh.localToWorld(new THREE.Vector3(webThick, 0, 0));
            const l2_end   = stMesh.localToWorld(new THREE.Vector3(webThick, 0, totalLen));

            const l3_start = stMesh.localToWorld(new THREE.Vector3(bulbMaxX, 0, 0));
            const l3_end   = stMesh.localToWorld(new THREE.Vector3(bulbMaxX, 0, totalLen));

            const seg1 = { start: l1_start, end: l1_end, isStiffenerLine: true, color: 0x1E293B };
            const seg2 = { start: l2_start, end: l2_end, isStiffenerLine: true, color: 0x1E293B };
            const seg3 = { start: l3_start, end: l3_end, isStiffenerLine: true, isStiffenerBulb: true, color: 0x2563EB };

            sketchSegments.push(seg1, seg2, seg3);

            // Отрисовка в sketchGroup
            [seg1, seg2].forEach(s => {
                const geo = new THREE.BufferGeometry().setFromPoints([s.start, s.end]);
                const line = new THREE.Line(geo, lineMat);
                line.renderOrder = 1;
                sketchGroup.add(line);
                if (!sketchPoints.some(sp => sp.distanceTo(s.start) < 0.1)) sketchPoints.push(s.start.clone());
                if (!sketchPoints.some(sp => sp.distanceTo(s.end) < 0.1)) sketchPoints.push(s.end.clone());
            });

            const geoBulb = new THREE.BufferGeometry().setFromPoints([seg3.start, seg3.end]);
            const bulbLine = new THREE.Line(geoBulb, bulbMat);
            bulbLine.renderOrder = 1;
            sketchGroup.add(bulbLine);
            if (!sketchPoints.some(sp => sp.distanceTo(seg3.start) < 0.1)) sketchPoints.push(seg3.start.clone());
            if (!sketchPoints.some(sp => sp.distanceTo(seg3.end) < 0.1)) sketchPoints.push(seg3.end.clone());
        });
    }

    recomputeSketchCenters();

    const depthInput = document.getElementById('qi-extrude-depth');
    if (depthInput && sketchSource.depth) {
        depthInput.value = sketchSource.depth.toString();
    }

    if (typeof showToast === 'function') showToast("Топология: вид сверху на основание. Редактируйте контур или добавьте вырезы.");
};

// Скрипт для перетаскивания панелей
function initDraggablePanels() {
    document.querySelectorAll('.quick-input-panel').forEach(panel => {
        const header = panel.querySelector('.quick-input-header');
        if (!header) return;

        let isDragging = false;
        let startX, startY;
        let initialLeft, initialTop;

        header.style.cursor = 'grab';

        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('button')) return;
            isDragging = true;
            panel.dataset.userMoved = 'true';
            header.style.cursor = 'grabbing';
            
            startX = e.clientX;
            startY = e.clientY;
            
            const rect = panel.getBoundingClientRect();
            // panel has transform: translate(-50%, -50%). So left and top are the center.
            // Actually, if we just manage left/top as the style, we can extract the current style values.
            // Or better, convert the panel to not use transform for dragging, or adjust left/top and keep transform.
            let styleLeft = panel.style.left;
            let styleTop = panel.style.top;
            
            if (styleLeft.endsWith('%')) {
                initialLeft = window.innerWidth * parseFloat(styleLeft) / 100;
            } else {
                initialLeft = parseFloat(styleLeft) || rect.left + rect.width / 2;
            }
            
            if (styleTop.endsWith('%')) {
                initialTop = window.innerHeight * parseFloat(styleTop) / 100;
            } else {
                initialTop = parseFloat(styleTop) || rect.top + rect.height / 2;
            }

            panel.style.left = initialLeft + 'px';
            panel.style.top = initialTop + 'px';

            function onMouseMove(moveEvent) {
                if (!isDragging) return;
                const dx = moveEvent.clientX - startX;
                const dy = moveEvent.clientY - startY;
                
                initialLeft += dx;
                initialTop += dy;
                
                panel.style.left = initialLeft + 'px';
                panel.style.top = initialTop + 'px';
                
                startX = moveEvent.clientX;
                startY = moveEvent.clientY;
            }

            function onMouseUp() {
                isDragging = false;
                header.style.cursor = 'grab';
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            }

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    });
}
initDraggablePanels();

// === PREVIEW SYSTEM ===
window.isPreviewMode = false;
window.previewMeshResult = null;



// Intercept updateSpecificationTable
if (typeof updateSpecificationTable === 'function') {
    const originalUpdateSpec = updateSpecificationTable;
    window.updateSpecificationTable = function() {
        if (!window.isPreviewMode) {
            originalUpdateSpec();
        }
    }
}

window.previewManagers = {};

window.togglePhantom = function(id) {
    const panel = document.getElementById('quick-input-' + id);
    if (!panel) return;
    
    const isShowing = panel.classList.toggle('show-preview');

    if (id === 'panel') {
        const btn = document.getElementById('qi-panel-phantom-btn');
        if (btn) btn.innerText = isShowing ? 'Скрыть фантом' : 'Показать фантом';
        setTimeout(() => {
            if (typeof window.initPanel2DCanvas === 'function') window.initPanel2DCanvas();
            if (typeof window.resetPanel2DView === 'function') window.resetPanel2DView();
        }, 100);
    }

    if (isShowing) {
        if (!window.previewManagers[id]) {
            initPreview(id);
        }
        updatePreview(id);
        
        // Add event listeners to input fields to auto-update
        const inputs = panel.querySelectorAll('input');
        inputs.forEach(inp => {
            if (!inp.dataset.previewBound) {
                inp.addEventListener('input', () => {
                    if (panel.classList.contains('show-preview')) {
                        updatePreview(id);
                    }
                });
                inp.dataset.previewBound = "true";
            }
        });
    }
};

function initPreview(id) {
    const container = document.getElementById('preview-canvas-' + id);
    if (!container) return;
    
    const pScene = new THREE.Scene();
    pScene.background = new THREE.Color(0xf0f0f0);
    
    // Grid and axes
    const gridHelper = new THREE.GridHelper(1000, 100, 0x888888, 0xcccccc);
    pScene.add(gridHelper);
    const axesHelper = new THREE.AxesHelper(100);
    pScene.add(axesHelper);
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    pScene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(500, 1000, 500);
    pScene.add(directionalLight);
    
    const pCamera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 1, 10000);
    pCamera.position.set(500, 500, 500);
    pCamera.lookAt(0,0,0);
    
    const pRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    pRenderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(pRenderer.domElement);
    
    const pControls = new THREE.OrbitControls(pCamera, pRenderer.domElement);
    pControls.enableDamping = true;
    
    window.previewManagers[id] = {
        scene: pScene, camera: pCamera, renderer: pRenderer, controls: pControls, meshGroup: new THREE.Group()
    };
    pScene.add(window.previewManagers[id].meshGroup);
    
    function animatePreview() {
        requestAnimationFrame(animatePreview);
        const panel = document.getElementById('quick-input-' + id);
        if (panel && panel.classList.contains('show-preview')) {
            if (pRenderer.domElement.clientWidth !== container.clientWidth || pRenderer.domElement.clientHeight !== container.clientHeight) {
                const w = container.clientWidth;
                const h = container.clientHeight;
                if (w > 0 && h > 0) {
                    pRenderer.setSize(w, h);
                    pCamera.aspect = w / h;
                    pCamera.updateProjectionMatrix();
                }
            }
            pControls.update();
            pRenderer.render(pScene, pCamera);
        }
    }
    animatePreview();
}

function updatePreview(id) {
    const pm = window.previewManagers[id];
    if (!pm) return;
    
    pm.meshGroup.clear();
    
    window.isPreviewMode = true;
    window.previewMeshResult = null;
    
    const origClose = window.closeQuickPanels;
    const origToast = window.showToast;
    const origCancel = window.cancelSketch;
    window.closeQuickPanels = () => {};
    window.showToast = () => {};
    window.cancelSketch = () => {};
    const origAddPartToSpec = window.addPartToSpec;
    window.addPartToSpec = () => {};
    
    const origCamPosSet = creatorCamera.position.set;
    const origCamTargetCopy = creatorControls.target.copy;
    const origControlsUpdate = creatorControls.update;
    creatorCamera.position.set = () => {};
    creatorControls.target.copy = () => {};
    creatorControls.update = () => {};
    
    const panel = document.getElementById('quick-input-' + id);
    const inputs = panel ? panel.querySelectorAll('input') : [];
    const oldValues = [];
    inputs.forEach(inp => {
        oldValues.push(inp.value);
        const allowNeg = inp.id === 'qi-pipe-t';
        const numVal = parseFloat(inp.value);
        const isInvalidNum = isNaN(numVal) || (allowNeg ? numVal === 0 : numVal <= 0);
        if (!inp.value || (inp.type === 'number' && isInvalidNum)) {
            if (inp.type === 'text') {
                 const currentCat = (document.getElementById('qi-profile-category')?.value || '').toLowerCase();
                 const isPipe = currentCat.includes('труб') || currentCat.includes('pipe');
                 if (inp.id.includes('profile-category')) inp.value = "Полособульб";
                 else if (inp.id.includes('profile-type')) inp.value = isPipe ? "108x4" : "HP 200x12";
                 else if (inp.id.includes('bulbbar')) inp.value = "HP 200x12";
                 else if (inp.id.includes('panel-profile')) inp.value = "HP 160x8";
                 else if (inp.id.includes('angle')) inp.value = "Уголок 50x5";
                 else if (inp.id.includes('channel')) inp.value = "Швеллер 10П";
            } else {
                 if (inp.id.includes('extrude-angle')) inp.value = "0";
                 else if (inp.id === 'qi-panel-w') inp.value = "2000";
                 else if (inp.id === 'qi-panel-l') inp.value = "6000";
                 else if (inp.id === 'qi-profile-l') inp.value = "1000";
                 else if (inp.id === 'qi-panel-spacing') inp.value = "500";
                 else if (inp.id.includes('-t') || inp.id.includes('-th')) inp.value = "10";
                 else inp.value = "100";
            }
        }
    });

    const applyFnName = 'applyQuick' + id.charAt(0).toUpperCase() + id.slice(1);
    if (typeof window[applyFnName] === 'function') {
        window[applyFnName]();
    }
    
    inputs.forEach((inp, i) => {
        inp.value = oldValues[i];
    });

    
    window.closeQuickPanels = origClose;
    window.showToast = origToast;
        window.cancelSketch = origCancel;
    window.addPartToSpec = origAddPartToSpec;
    creatorCamera.position.set = origCamPosSet;
    creatorControls.target.copy = origCamTargetCopy;
    creatorControls.update = origControlsUpdate;
    window.addPartToSpec = origAddPartToSpec;
    creatorCamera.position.set = origCamPosSet;
    creatorControls.target.copy = origCamTargetCopy;
    creatorControls.update = origControlsUpdate;

    window.isPreviewMode = false;
    
    if (window.previewMeshResult) {
        window.previewMeshResult.position.set(0,0,0);
        if (window.previewMeshResult.rotation) {
             window.previewMeshResult.rotation.set(0,0,0);
        }
        pm.meshGroup.add(window.previewMeshResult);
        console.log("Added mesh to preview", id, window.previewMeshResult);
        
        const box = new THREE.Box3().setFromObject(window.previewMeshResult);
        if (!box.isEmpty()) {
            const center = new THREE.Vector3();
            box.getCenter(center);
            const size = new THREE.Vector3();
            box.getSize(size);
            
            const maxDim = Math.max(size.x, size.y, size.z, 10);
            const fov = pm.camera.fov * (Math.PI / 180);
            let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
            cameraZ *= 2; 
            
            pm.camera.position.set(center.x + cameraZ*0.8, center.y + cameraZ*0.8, center.z + cameraZ);
            pm.camera.lookAt(center);
            pm.controls.target.copy(center);
            pm.controls.update();
        }
    }
}
// === END PREVIEW SYSTEM ===
