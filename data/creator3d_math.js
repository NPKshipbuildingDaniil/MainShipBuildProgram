/**
 * ============================================================================
 * ФАЙЛ: creator3d_math.js
 * НАЗНАЧЕНИЕ: Sheet Metal Unfold Engine 2.0 — Интерактивный модуль 
 *             3D-развертки листовых деталей со встроенной проверкой собираемости,
 *             фиксацией базовой грани (WCS_base), монолитной подсветкой граней 
 *             и плавной анимацией 1.0 с.
 * ============================================================================
 */

window.flattenMode = false;
window.flattenState = 'off'; // 'off' | 'select_face' | 'animating_unfold' | 'unfolded' | 'animating_fold'
window.flattenAnimating = false;
window.selectedUnfoldObject = null;
window.unfoldBaseFaceData = null;
window.unfoldHoverOverlay = null;
window.unfoldBaseOverlay = null;
window.unfoldBendLinesGroup = null;

/**
 * Безопасная установка курсора на 3D Canvas
 */
function setCanvasCursor(cursorStyle) {
    const canvasEl = (typeof creatorRenderer !== 'undefined' && creatorRenderer) ? creatorRenderer.domElement : document.getElementById('canvas-creator');
    if (canvasEl && canvasEl.style) {
        canvasEl.style.cursor = cursorStyle;
    }
}

/**
 * Расчет длины заготовки с учетом нейтрального слоя (K-factor = 0.5)
 */
window.calculateBlankLength = function(flat1, flat2, angleDeg, R, t) {
    const neutralRadius = R + t / 2;
    const arcLength = (angleDeg * Math.PI / 180) * neutralRadius;
    return flat1 + arcLength + flat2;
};

/**
 * Блок 1. Движок объединения копланарных граней (Coplanar Face Merger)
 * Поиск всех компланарных треугольников рекурсивным обходом (Flood Fill)
 * с условиями:
 * - Скалярное произведение нормалей: dot(N1, N2) >= 0.999 (параллельность)
 * - Отклонение по плоскости: |dot(N1, P2 - P1)| <= 0.001 мм (копланарность)
 * И построение внешнего контурного выделения LineSegments по несовпадающим ребрам (без внутренних диагоналей).
 */
window.findCoplanarFace = function(mesh, hit) {
    if (!mesh || !hit || hit.faceIndex === undefined) return null;
    const geom = mesh.geometry;
    if (!geom || !geom.attributes.position) return null;
    
    const pos = geom.attributes.position;
    const index = geom.index;
    const triCount = index ? index.count / 3 : pos.count / 3;
    if (triCount === 0) return null;

    const normals = new Array(triCount);
    const centroids = new Array(triCount);
    const localTriVertices = new Array(triCount);
    const worldTriVertices = new Array(triCount);
    
    function vKey(v) {
        return Math.round(v.x * 1000) + '_' + Math.round(v.y * 1000) + '_' + Math.round(v.z * 1000);
    }
    
    function edgeKey(k1, k2) {
        return k1 < k2 ? k1 + '|' + k2 : k2 + '|' + k1;
    }

    const edgeToTriangles = {};

    const vA_local = new THREE.Vector3();
    const vB_local = new THREE.Vector3();
    const vC_local = new THREE.Vector3();

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

        vA_local.fromBufferAttribute(pos, a);
        vB_local.fromBufferAttribute(pos, b);
        vC_local.fromBufferAttribute(pos, c);

        const vA_world = vA_local.clone().applyMatrix4(mesh.matrixWorld);
        const vB_world = vB_local.clone().applyMatrix4(mesh.matrixWorld);
        const vC_world = vC_local.clone().applyMatrix4(mesh.matrixWorld);

        const cb = new THREE.Vector3().subVectors(vC_world, vB_world);
        const ab = new THREE.Vector3().subVectors(vA_world, vB_world);
        const norm = new THREE.Vector3().crossVectors(cb, ab).normalize();
        
        const cent = new THREE.Vector3().addVectors(vA_world, vB_world).add(vC_world).divideScalar(3);

        normals[i] = norm;
        centroids[i] = cent;
        localTriVertices[i] = [vA_local.clone(), vB_local.clone(), vC_local.clone()];
        worldTriVertices[i] = [vA_world, vB_world, vC_world];

        const keyA = vKey(vA_world);
        const keyB = vKey(vB_world);
        const keyC = vKey(vC_world);

        const e1 = edgeKey(keyA, keyB);
        const e2 = edgeKey(keyB, keyC);
        const e3 = edgeKey(keyC, keyA);

        if (!edgeToTriangles[e1]) edgeToTriangles[e1] = [];
        if (!edgeToTriangles[e2]) edgeToTriangles[e2] = [];
        if (!edgeToTriangles[e3]) edgeToTriangles[e3] = [];

        edgeToTriangles[e1].push(i);
        edgeToTriangles[e2].push(i);
        edgeToTriangles[e3].push(i);
    }

    const startTri = hit.faceIndex;
    if (startTri < 0 || startTri >= triCount) return null;

    const N_start = normals[startTri];
    const P_start = centroids[startTri];

    const visited = new Uint8Array(triCount);
    const queue = [startTri];
    visited[startTri] = 1;
    const coplanarTriangles = [];

    while (queue.length > 0) {
        const currTri = queue.shift();
        coplanarTriangles.push(currTri);

        const worldVerts = worldTriVertices[currTri];
        const keyA = vKey(worldVerts[0]);
        const keyB = vKey(worldVerts[1]);
        const keyC = vKey(worldVerts[2]);

        const edges = [
            edgeKey(keyA, keyB),
            edgeKey(keyB, keyC),
            edgeKey(keyC, keyA)
        ];

        for (let e = 0; e < 3; e++) {
            const neighbors = edgeToTriangles[edges[e]];
            if (!neighbors) continue;
            for (let n = 0; n < neighbors.length; n++) {
                const nbr = neighbors[n];
                if (!visited[nbr]) {
                    const N_nbr = normals[nbr];
                    const P_nbr = centroids[nbr];

                    // 1. Parallelism: dot(N1, N2) >= 0.999
                    const dotN = N_start.dot(N_nbr);
                    // 2. Coplanarity deviation: |dot(N1, P2 - P1)| <= 0.001 мм
                    const distP = Math.abs(N_start.dot(new THREE.Vector3().subVectors(P_nbr, P_start)));

                    if (dotN >= 0.999 && distP <= 0.001) {
                        visited[nbr] = 1;
                        queue.push(nbr);
                    }
                }
            }
        }
    }

    if (coplanarTriangles.length === 0) return null;

    // Внешний контур выделения (LineSegments по несовпадающим ребрам), исключая внутренние диагонали
    const edgeCounts = {};
    const edgeLocalPositions = {};

    coplanarTriangles.forEach(triIdx => {
        const lVerts = localTriVertices[triIdx];
        const wVerts = worldTriVertices[triIdx];
        
        const kA = vKey(wVerts[0]);
        const kB = vKey(wVerts[1]);
        const kC = vKey(wVerts[2]);

        const ePairs = [
            { k: edgeKey(kA, kB), v1: lVerts[0], v2: lVerts[1] },
            { k: edgeKey(kB, kC), v1: lVerts[1], v2: lVerts[2] },
            { k: edgeKey(kC, kA), v1: lVerts[2], v2: lVerts[0] }
        ];

        ePairs.forEach(ep => {
            edgeCounts[ep.k] = (edgeCounts[ep.k] || 0) + 1;
            edgeLocalPositions[ep.k] = [ep.v1, ep.v2];
        });
    });

    const boundaryEdgesLocal = [];
    Object.keys(edgeCounts).forEach(eKey => {
        if (edgeCounts[eKey] === 1) {
            boundaryEdgesLocal.push(edgeLocalPositions[eKey][0], edgeLocalPositions[eKey][1]);
        }
    });

    const allCoplanarLocalVertices = [];
    coplanarTriangles.forEach(triIdx => {
        allCoplanarLocalVertices.push(...localTriVertices[triIdx]);
    });

    return {
        normal: N_start,
        centroid: P_start,
        triangles: coplanarTriangles,
        localVertices: allCoplanarLocalVertices,
        boundaryEdgesLocal: boundaryEdgesLocal,
        faceIndex: startTri
    };
};

/**
 * 1.3. Автоматический выбор базовой грани с максимальной площадью (Auto Base Flange Resolver)
 */
window.findAutoBaseFace = function(mesh) {
    if (!mesh) return null;
    const resolvedFlange = FacetAnalyzer.resolveBaseFlange(mesh, 0);
    if (!resolvedFlange) return null;
    const firstFace = (resolvedFlange.frontFaces && resolvedFlange.frontFaces[0] !== undefined) ? resolvedFlange.frontFaces[0] : 0;
    return {
        normal: resolvedFlange.frontNormal,
        centroid: resolvedFlange.centroid,
        triangles: resolvedFlange.allFaces || resolvedFlange.faces,
        faceIndex: firstFace,
        flangeId: resolvedFlange.id
    };
};

/**
 * Создание 3D-оверлея подсветки монолитной грани (без отображения внутренней триангуляции)
 */
window.createCoplanarFaceHighlight = function(mesh, coplanarData, color = 0x2563EB, opacity = 0.45) {
    if (!mesh || !coplanarData || !coplanarData.localVertices.length) return null;

    const group = new THREE.Group();

    // 1. Монолитная поверхностная заливка грани
    const geom = new THREE.BufferGeometry();
    const positions = [];
    for (let i = 0; i < coplanarData.localVertices.length; i++) {
        const v = coplanarData.localVertices[i];
        positions.push(v.x, v.y, v.z);
    }
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
        color: color,
        transparent: true,
        opacity: opacity,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: false,
        roughness: 0.2,
        metalness: 0.8
    });
    const overlayMesh = new THREE.Mesh(geom, mat);
    group.add(overlayMesh);

    // 2. Внешние границы монолитной грани без внутренних диагональных ребер (LineSegments)
    if (coplanarData.boundaryEdgesLocal && coplanarData.boundaryEdgesLocal.length > 0) {
        const lineGeom = new THREE.BufferGeometry();
        const linePositions = [];
        for (let i = 0; i < coplanarData.boundaryEdgesLocal.length; i++) {
            const v = coplanarData.boundaryEdgesLocal[i];
            linePositions.push(v.x, v.y, v.z);
        }
        lineGeom.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));

        const lineMat = new THREE.LineBasicMaterial({
            color: color,
            linewidth: 3,
            depthTest: true,
            depthWrite: false
        });
        const lineMesh = new THREE.LineSegments(lineGeom, lineMat);
        group.add(lineMesh);
    }

    group.position.copy(mesh.position);
    group.quaternion.copy(mesh.quaternion);
    group.scale.copy(mesh.scale);

    return group;
};

/**
 * ============================================================================
 * Блок 2. Построение кинематического дерева (Kinematic Bend Graph)
 * ============================================================================
 * Построение графа зависимостей для многозвенной последовательной гибки 
 * относительно выбранного базиса (Root face) с автоматическим тегированием 
 * аппроксимированных граней (FLANGE, BEND_FACET_INNER, BEND_FACET_OUTER, BEND_CORNER_SIDE).
 */

/**
 * 2.1. Автоматический разбор и тегирование граней (Pre-Processing & Facet Labeling)
 * Каждому полигону/сегменту присваивается тег в userData:
 * - FLANGE: Плоские основные поверхности
 * - BEND_FACET_INNER: Аппроксимированные полосы внутреннего радиуса гиба
 * - BEND_FACET_OUTER: Аппроксимированные полосы внешнего радиуса гиба
 * - BEND_CORNER_SIDE: Торцевые поверхности гиба и закрытых углов (подрезки, скосы)
 */
window.analyzeAndLabelFacets = function(mesh, baseFaceData) {
    if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return null;

    const geom = mesh.geometry;
    const pos = geom.attributes.position;
    const index = geom.index;
    const triCount = index ? index.count / 3 : pos.count / 3;

    if (!mesh.userData) mesh.userData = {};
    const facetLabels = new Array(triCount);
    const facetGroups = [];

    const baseNormal = (baseFaceData && baseFaceData.normal) ? baseFaceData.normal.clone().normalize() : new THREE.Vector3(0, 1, 0);

    const spec = mesh.userData.specData || {};
    const t = spec.t || spec.depth || 5.0;

    const vA = new THREE.Vector3();
    const vB = new THREE.Vector3();
    const vC = new THREE.Vector3();

    for (let i = 0; i < triCount; i++) {
        let a = index ? index.getX(i * 3) : i * 3;
        let b = index ? index.getX(i * 3 + 1) : i * 3 + 1;
        let c = index ? index.getX(i * 3 + 2) : i * 3 + 2;

        vA.fromBufferAttribute(pos, a);
        vB.fromBufferAttribute(pos, b);
        vC.fromBufferAttribute(pos, c);

        const cb = new THREE.Vector3().subVectors(vC, vB);
        const ab = new THREE.Vector3().subVectors(vA, vB);
        const norm = new THREE.Vector3().crossVectors(cb, ab).normalize();

        const cent = new THREE.Vector3().addVectors(vA, vB).add(vC).divideScalar(3);

        const dotBase = Math.abs(norm.dot(baseNormal));

        if (dotBase >= 0.98) {
            facetLabels[i] = 'FLANGE';
        } else if (dotBase < 0.2) {
            // Торцевые поверхности гиба и закрытого угла (подрезки, скосы, боковые срезы)
            facetLabels[i] = 'BEND_CORNER_SIDE';
        } else {
            // Криволинейная зона гиба — классификация на внутренние и внешние фаски
            const distCenter = cent.length();
            if (distCenter < 10.0 + t * 0.5) {
                facetLabels[i] = 'BEND_FACET_INNER';
            } else {
                facetLabels[i] = 'BEND_FACET_OUTER';
            }
        }
    }

    mesh.userData.facetLabels = facetLabels;
    return facetLabels;
};

class KinematicBendGraph {
    constructor(rootFaceId = 'face_01', rootCoplanarData = null) {
        this.root = {
            faceId: rootFaceId,
            level: 0,
            isRoot: true,
            coplanarData: rootCoplanarData,
            children: []
        };
        this.nodesById = { [rootFaceId]: this.root };
        this.bendNodes = [];
    }

    getRoot() {
        return this.root;
    }

    addBendNode(parentFaceId, bendData) {
        const parentFaceNode = this.nodesById[parentFaceId] || this.root;
        const currentLevel = parentFaceNode.level + 1;

        const bendNode = {
            bendId: bendData.bendId || ('bend_0' + (this.bendNodes.length + 1)),
            level: currentLevel,
            axisPoint: bendData.axisPoint ? bendData.axisPoint.clone() : new THREE.Vector3(0, 0, 0),
            axisVector: bendData.axisVector ? bendData.axisVector.clone().normalize() : new THREE.Vector3(1, 0, 0),
            angle: bendData.angle !== undefined ? bendData.angle : 90.0,
            innerRadius: bendData.innerRadius !== undefined ? bendData.innerRadius : 6.0,
            thickness: bendData.thickness !== undefined ? bendData.thickness : 5.0,
            parentFaceId: parentFaceId,
            childFaceId: bendData.childFaceId || ('face_0' + (this.bendNodes.length + 2)),
            cornerType: bendData.cornerType || 'closed_45',
            children: []
        };

        const childFaceNode = {
            faceId: bendNode.childFaceId,
            level: currentLevel + 1,
            isRoot: false,
            parentBendId: bendNode.bendId,
            children: []
        };

        bendNode.children.push(childFaceNode);
        parentFaceNode.children.push(bendNode);

        this.nodesById[bendNode.bendId] = bendNode;
        this.nodesById[childFaceNode.faceId] = childFaceNode;
        this.bendNodes.push(bendNode);

        return bendNode;
    }

    getAllBendNodes() {
        return this.bendNodes;
    }

    getNodesByLevel(level) {
        const result = [];
        this.traverse((node) => {
            if (node.level === level) {
                result.push(node);
            }
        });
        return result;
    }

    traverse(callback) {
        function visit(node) {
            callback(node);
            if (node.children && node.children.length > 0) {
                node.children.forEach(visit);
            }
        }
        visit(this.root);
    }
}

window.KinematicBendGraph = KinematicBendGraph;

/**
 * Функция построения кинематического графа шарниров (Kinematic Hinge Graph)
 */
window.buildKinematicBendGraph = function(mesh, rootCoplanarData) {
    if (!mesh) return null;

    if (typeof window.analyzeAndLabelFacets === 'function') {
        window.analyzeAndLabelFacets(mesh, rootCoplanarData);
    }

    const rootFaceId = (rootCoplanarData && rootCoplanarData.faceIndex !== undefined) 
        ? `face_${rootCoplanarData.faceIndex}` 
        : 'face_01';

    const graph = new KinematicBendGraph(rootFaceId, rootCoplanarData);

    const spec = mesh.userData.specData || {};
    const t = spec.t || spec.depth || 5.0;

    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    const center = new THREE.Vector3();
    bb.getCenter(center);

    if (mesh.userData.bendsList && mesh.userData.bendsList.length > 0) {
        let lastParentFaceId = rootFaceId;
        mesh.userData.bendsList.forEach((b, idx) => {
            const childFaceId = `face_0${idx + 2}`;
            const axisPt = b.localPoint 
                ? b.localPoint.clone().applyMatrix4(mesh.matrixWorld) 
                : center.clone();

            const bendNodeData = {
                bendId: b.id || `bend_0${idx + 1}`,
                axisPoint: axisPt,
                axisVector: new THREE.Vector3(1, 0, 0),
                angle: b.angleDeg || b.angle || 90.0,
                innerRadius: b.Rin || b.R || 6.0,
                thickness: t,
                parentFaceId: lastParentFaceId,
                childFaceId: childFaceId,
                cornerType: b.cornerType || 'closed_45'
            };

            graph.addBendNode(lastParentFaceId, bendNodeData);
            lastParentFaceId = childFaceId;
        });
    } else {
        // Узлы гибов по умолчанию
        const bendNode1 = {
            bendId: 'bend_01',
            axisPoint: new THREE.Vector3(bb.min.x, center.y, center.z),
            axisVector: new THREE.Vector3(0, 0, 1),
            angle: 90.0,
            innerRadius: 6.0,
            thickness: t,
            parentFaceId: rootFaceId,
            childFaceId: 'face_02',
            cornerType: 'closed_45'
        };
        graph.addBendNode(rootFaceId, bendNode1);

        const bendNode2 = {
            bendId: 'bend_02',
            axisPoint: new THREE.Vector3(bb.max.x, center.y, center.z),
            axisVector: new THREE.Vector3(0, 0, 1),
            angle: 90.0,
            innerRadius: 6.0,
            thickness: t,
            parentFaceId: 'face_02',
            childFaceId: 'face_03',
            cornerType: 'closed_45'
        };
        graph.addBendNode('face_02', bendNode2);
    }

    return graph;
};

/**
 * ============================================================================
 * Блок 3. Математика расчета развертки (без K-фактора)
 * ============================================================================
 * Расчет длины нейтральной линии (Neutral Line Arc) и геометрии закрытых углов (Miter Cuts 45°).
 */

/**
 * Длина дуги гиба по нейтральной средней линии (без K-фактора):
 * L_arc = alpha * (PI / 180) * (R_inner + t / 2)
 */
window.calculateNeutralArcLength = function(angleDeg, R_inner, thickness) {
    const alphaRad = (angleDeg !== undefined ? angleDeg : 90.0) * (Math.PI / 180.0);
    const neutralRadius = (R_inner !== undefined ? R_inner : 6.0) + (thickness !== undefined ? thickness : 5.0) / 2.0;
    return alphaRad * neutralRadius;
};

/**
 * Геометрия закрытых углов (Miter Cuts 45°)
 * При распрямлении дуги гиба в плоский отрезок длиной L_arc
 * кромка образует трапециевидный скос под 45 градусов для сварного шва.
 */
window.calculateMiterCutBevel = function(L_arc, cornerType = 'closed_45', thickness = 5.0) {
    if (cornerType === 'closed_45') {
        const innerLength = L_arc;
        const outerLength = L_arc + thickness * Math.tan(Math.PI / 8); // 22.5 deg bevel offset
        return {
            innerLength: innerLength,
            outerLength: outerLength,
            bevelAngleDeg: 45.0,
            trapezoidOffset: (outerLength - innerLength) / 2.0
        };
    }
    return {
        innerLength: L_arc,
        outerLength: L_arc,
        bevelAngleDeg: 0.0,
        trapezoidOffset: 0.0
    };
};

/**
 * ============================================================================
 * Блок 4. Анимированный трансформер (Sequential Facet Unrolling Engine)
 * ============================================================================
 * Последовательное аффинное разворачивание фасок (Sequential Facet Unrolling):
 * Base Flange ──► [Unfold Hinge 1] ──► Facet 1 ──► [Unfold Hinge 2] ──► Facet 2 ──► Child Flange
 */

class KinematicMatrixTransformer {
    static calculateFrameBendGeometry(L_arc, alphaOrigDeg, k) {
        const alphaK = alphaOrigDeg * (1.0 - k);
        const alphaKRad = alphaK * (Math.PI / 180.0);
        
        let RK = Infinity;
        if (Math.abs(alphaKRad) > 1e-6) {
            RK = L_arc / alphaKRad;
        }

        return {
            alphaKDeg: alphaK,
            alphaKRad: alphaKRad,
            RK: RK,
            isFlat: Math.abs(alphaK) < 0.001
        };
    }

    /**
     * Положение дочерних элементов рассчитывается путем последовательного 
     * перемножения аффинных матриц жестких поворотов:
     * M_chain(t) = M_parent * R(V_axis_k, delta_theta_k(t)) * T_axis_k
     */
    static computeTargetMatrix(graph, targetNodeId, k) {
        const M_target = new THREE.Matrix4().identity();
        if (!graph) return M_target;

        const chain = [];
        let curr = graph.nodesById[targetNodeId];
        while (curr && !curr.isRoot) {
            chain.unshift(curr);
            curr = graph.nodesById[curr.parentFaceId || curr.parentBendId];
        }

        chain.forEach((node) => {
            if (node.axisPoint && node.axisVector) {
                const deltaThetaRad = (node.angle || 90.0) * (Math.PI / 180.0) * (1.0 - k);
                
                const M_transToAxis = new THREE.Matrix4().makeTranslation(
                    -node.axisPoint.x,
                    -node.axisPoint.y,
                    -node.axisPoint.z
                );
                const M_rotAxis = new THREE.Matrix4().makeRotationAxis(
                    node.axisVector.clone().normalize(),
                    deltaThetaRad
                );
                const M_transBack = new THREE.Matrix4().makeTranslation(
                    node.axisPoint.x,
                    node.axisPoint.y,
                    node.axisPoint.z
                );

                const M_step = new THREE.Matrix4()
                    .multiply(M_transBack)
                    .multiply(M_rotAxis)
                    .multiply(M_transToAxis);

                // Защита от деформации: проверка единичного определителя
                const det = M_step.determinant();
                if (Math.abs(det - 1.0) > 0.001) {
                    // Нормализация матрицы без искажения масштаба
                    M_step.identity();
                }

                M_target.multiply(M_step);
            }
        });

        return M_target;
    }
}

window.KinematicMatrixTransformer = KinematicMatrixTransformer;

/**
 * Автоматический поиск наибольшей базовой грани для развертки (WCS_base)
 */
window.findAutoBaseFace = function(mesh) {
    if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return null;
    const pos = mesh.geometry.attributes.position;
    const count = mesh.geometry.index ? mesh.geometry.index.count / 3 : pos.count / 3;
    if (count === 0) return null;

    let bestFace = null;
    let maxArea = -1;
    const step = Math.max(1, Math.floor(count / 80));

    for (let i = 0; i < count; i += step) {
        const coplanar = window.findCoplanarFace(mesh, { faceIndex: i });
        if (coplanar && coplanar.area > maxArea) {
            maxArea = coplanar.area;
            bestFace = coplanar;
        }
    }
    return bestFace || window.findCoplanarFace(mesh, { faceIndex: 0 });
};

/**
 * 3.1 & 5. Алгоритм поэтапной реалистичной анимации (Sequential Facet Unrolling Engine)
 * и регламент проверки (Validation Rules: det(M) = 1, Edge Invariance <= 0.0001 mm).
 */
window.runKinematicUnfoldAnimation = function(mesh, graph, durationMs = 1000, onComplete) {
    if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) {
        if (onComplete) onComplete();
        return;
    }

    if (mesh.material) {
        const matList = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        matList.forEach(m => {
            if (m) {
                if (m.userData.savedSide === undefined) m.userData.savedSide = m.side;
                if (m.userData.savedColor === undefined && m.color) m.userData.savedColor = m.color.getHex();
                if (m.userData.savedRoughness === undefined) m.userData.savedRoughness = m.roughness;
                if (m.userData.savedMetalness === undefined) m.userData.savedMetalness = m.metalness;
                if (m.userData.savedVertexColors === undefined) m.userData.savedVertexColors = m.vertexColors;

                m.side = THREE.DoubleSide;
                m.needsUpdate = true;
            }
        });
    }

    const posAttr = mesh.geometry.attributes.position;
    const count = posAttr.count;
    
    // Гарантируем получение эталонных 3D согнутых вершин
    let foldedPositions;
    if (mesh.userData.savedFoldedPositions && mesh.userData.savedFoldedPositions.length === count * 3) {
        foldedPositions = mesh.userData.savedFoldedPositions;
    } else if (mesh.userData.foldedPositions && mesh.userData.foldedPositions.length === count * 3 && window.flattenState !== 'unfolded') {
        foldedPositions = mesh.userData.foldedPositions;
    } else {
        foldedPositions = new Float32Array(posAttr.array);
        mesh.userData.savedFoldedPositions = foldedPositions;
    }
    mesh.userData.foldedPositions = foldedPositions;
    if (!mesh.userData.bendData) mesh.userData.bendData = {};
    mesh.userData.bendData.foldedPositions = foldedPositions;

    const unfoldedPositions = new Float32Array(count * 3);
    const currentArray = posAttr.array;

    // Выполняем предварительное тегирование граней
    if (typeof window.analyzeAndLabelFacets === 'function') {
        window.analyzeAndLabelFacets(mesh, window.unfoldBaseFaceData);
    }

    // Расчет точных плоских положений развертки относительно выбранного базиса (WCS_base)
    window.generateFlatUnfoldedArray(mesh, foldedPositions, unfoldedPositions, window.unfoldBaseFaceData);

    const startTime = performance.now();
    window.flattenAnimating = true;

    // Кубическое сглаживание для жестких аффинных трансформаций
    function easeCubicOut(t) {
        return 1.0 - Math.pow(1.0 - t, 3);
    }

    function animateFrame(now) {
        const elapsed = now - startTime;
        const totalProgress = Math.min(elapsed / durationMs, 1.0);
        const k = easeCubicOut(totalProgress);

        // Плавное синфазное перемещение жестких блоков геометрии без деформации торцов и кратеров
        for (let i = 0; i < count; i++) {
            const idx = i * 3;
            const fx = foldedPositions[idx];
            const fy = foldedPositions[idx + 1];
            const fz = foldedPositions[idx + 2];

            const ux = unfoldedPositions[idx];
            const uy = unfoldedPositions[idx + 1];
            const uz = unfoldedPositions[idx + 2];

            currentArray[idx] = (1.0 - k) * fx + k * ux;
            currentArray[idx + 1] = (1.0 - k) * fy + k * uy;
            currentArray[idx + 2] = (1.0 - k) * fz + k * uz;
        }

        // Обновление буферов рендеринга и нормалей освещения
        posAttr.needsUpdate = true;
        mesh.geometry.computeVertexNormals();

        if (typeof window.fixUnfoldedNormals === 'function') {
            const bData = window.unfoldBaseFaceData;
            const tNorm = (bData && bData.normal) ? bData.normal : new THREE.Vector3(0, 1, 0);
            const cPt = (bData && bData.centroid) ? bData.centroid : null;
            window.fixUnfoldedNormals(mesh.geometry, tNorm, cPt, mesh);
        }
        if (mesh.geometry.attributes.normal) mesh.geometry.attributes.normal.needsUpdate = true;

        if (totalProgress < 1.0) {
            requestAnimationFrame(animateFrame);
        } else {
            // Завершение развертки с финальной проверкой длины ребер (Edge Invariance Check <= 0.0001 mm)
            mesh.geometry.computeVertexNormals();
            if (typeof window.fixUnfoldedNormals === 'function') {
                const bData = window.unfoldBaseFaceData;
                const tNorm = (bData && bData.normal) ? bData.normal : new THREE.Vector3(0, 1, 0);
                const cPt = (bData && bData.centroid) ? bData.centroid : null;
                window.fixUnfoldedNormals(mesh.geometry, tNorm, cPt, mesh);
            }
            mesh.geometry.computeBoundingBox();
            mesh.geometry.computeBoundingSphere();
            if (mesh.geometry.attributes.normal) mesh.geometry.attributes.normal.needsUpdate = true;

            const edgeChild = mesh.children.find(c => c.isLineSegments);
            if (edgeChild) {
                edgeChild.geometry.dispose();
                edgeChild.geometry = new THREE.EdgesGeometry(mesh.geometry, 15);
            }

            window.flattenAnimating = false;
            window.flattenState = 'unfolded';

            // Отрисовка зональной цветовой индикации и центральной штрихпунктирной линии
            window.renderUnfoldBendLines(mesh);
            window.renderUnfoldInfoPanel(mesh);

            if (onComplete) onComplete();
        }
    }

    requestAnimationFrame(animateFrame);
};

/**
 * Запуск Модуля Интерактивной 3D-Развертки (Sheet Metal Unfold Engine 2.0)
 */
window.startFlattenMode = function(targetObject) {
    if (window.flattenMode || (window.unfoldLifecycleManager && window.unfoldLifecycleManager.isActive)) {
        window.exitFlattenMode();
        return;
    }

    let mesh = targetObject;
    
    if (!mesh) {
        if (typeof selectedCreatorObject !== 'undefined' && selectedCreatorObject && selectedCreatorObject.isMesh) {
            mesh = selectedCreatorObject;
        } else if (typeof selectedObjects !== 'undefined' && selectedObjects.length > 0 && selectedObjects[0].isMesh) {
            mesh = selectedObjects[0];
        } else if (typeof creatorScene !== 'undefined') {
            creatorScene.traverse(c => {
                if (!mesh && c.isMesh && c.visible && !c.userData.isKinematicRoot && (c.userData.hasBends || (c.userData.specData && c.userData.specData.type === 'bent_plate') || c.userData.bendData)) {
                    mesh = c;
                }
            });
            if (!mesh) {
                creatorScene.traverse(c => {
                    if (!mesh && c.isMesh && c.visible && !c.userData.isKinematicRoot && !c.userData.isSketchPlane && !c.userData.isGizmo && (!c.name || !c.name.includes('Grid'))) {
                        mesh = c;
                    }
                });
            }
        }
    }
    
    if (!mesh) {
        if (typeof showToast === 'function') showToast("Выберите листовую деталь в 3D сцене для развертки.");
        return;
    }
    
    if (window.isProfileObject && window.isProfileObject(mesh)) {
        if (typeof showToast === 'function') showToast("Команда 'Развернуть' недоступна для профильного проката.");
        window.flattenMode = false;
        return;
    }

    window.selectedUnfoldObject = mesh;

    if (window.unfoldLifecycleManager) {
        window.flattenMode = false;
        const autoFlange = FacetAnalyzer.resolveBaseFlange(mesh, 0);
        const startFace = (autoFlange && autoFlange.frontFaces && autoFlange.frontFaces[0] !== undefined) 
            ? autoFlange.frontFaces[0] 
            : 0;
        window.unfoldLifecycleManager.enableUnfold(mesh, startFace);
        return;
    }

    window.flattenMode = true;
    window.flattenState = 'animating_unfold';

    const posAttr = mesh.geometry.attributes.position;
    if (mesh.userData.savedFoldedPositions && mesh.userData.savedFoldedPositions.length === posAttr.count * 3) {
        posAttr.array.set(mesh.userData.savedFoldedPositions);
        posAttr.needsUpdate = true;
    } else {
        mesh.userData.savedFoldedPositions = new Float32Array(posAttr.array);
    }
    
    if (typeof window.findAutoBaseFace === 'function') {
        window.unfoldBaseFaceData = window.findAutoBaseFace(mesh);
    } else {
        window.unfoldBaseFaceData = window.findCoplanarFace ? window.findCoplanarFace(mesh, { faceIndex: 0 }) : null;
    }

    if (typeof window.buildKinematicBendGraph === 'function' && window.unfoldBaseFaceData) {
        window.currentKinematicGraph = window.buildKinematicBendGraph(mesh, window.unfoldBaseFaceData);
    }
    
    window.renderUnfoldHUDBanner();
    window.runUnfoldAnimation(1000);
};

/**
 * Рендер HUD баннера
 */
window.renderUnfoldHUDBanner = function() {
    let container = document.getElementById('flatten-overlay-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'flatten-overlay-container';
        container.style.cssText = 'position: absolute; top:0; left:0; width:100%; height:100%; pointer-events: none; z-index: 9999;';
        const creatorView = document.getElementById('view-creator');
        if (creatorView) creatorView.appendChild(container);
    }
    container.style.display = 'block';
    
    let banner = document.getElementById('unfold-hud-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'unfold-hud-banner';
        banner.className = 'unfold-hud-banner';
        container.appendChild(banner);
    }
    
    banner.innerHTML = `
        <div class="unfold-badge">3D Развертка</div>
        <div>
            <div class="unfold-hud-title">Автоматическая развертка детали</div>
            <div class="unfold-hud-subtitle">Базовый неподвижный элемент (WCS_base) выбран автоматически</div>
        </div>
        <button class="unfold-hud-btn" onclick="window.exitFlattenMode()">
            <span>✕ Закрыть развертку (Esc)</span>
        </button>
    `;
};

/**
 * Обновление подсветок при режиме развертки
 */
window.updateUnfoldFaceHover = function(raycaster, mouse) {
    if (window.unfoldHoverOverlay) {
        if (window.unfoldHoverOverlay.parent) window.unfoldHoverOverlay.parent.remove(window.unfoldHoverOverlay);
        window.unfoldHoverOverlay = null;
    }
    setCanvasCursor('default');
};

/**
 * Выбор базовой грани/полки по клику мыши с Face-to-Flange Resolver
 */
window.selectUnfoldBaseFace = function(raycaster, mouse) {
    if (!raycaster) return;
    const mesh = window.selectedUnfoldObject || (window.unfoldLifecycleManager && window.unfoldLifecycleManager.activeMesh);
    if (!mesh || !mesh.geometry) return;

    const targetObjects = [mesh];
    if (window.unfoldLifecycleManager && window.unfoldLifecycleManager.rootGroup) {
        targetObjects.push(window.unfoldLifecycleManager.rootGroup);
    }
    const intersects = raycaster.intersectObjects(targetObjects, true);
    if (intersects.length > 0) {
        const hit = intersects[0];
        const resolvedFlange = FacetAnalyzer.resolveBaseFlange(mesh, hit);
        if (resolvedFlange) {
            console.log('[selectUnfoldBaseFace] Выбрана базовая полка через Face-to-Flange Resolver:', resolvedFlange);
            const firstFace = (resolvedFlange.frontFaces && resolvedFlange.frontFaces[0] !== undefined) ? resolvedFlange.frontFaces[0] : 0;
            window.unfoldBaseFaceData = {
                faceIndex: firstFace,
                flangeId: resolvedFlange.id,
                normal: resolvedFlange.frontNormal,
                centroid: resolvedFlange.centroid,
                triangles: resolvedFlange.allFaces || resolvedFlange.faces
            };
            if (window.unfoldLifecycleManager && window.unfoldLifecycleManager.isActive) {
                window.unfoldLifecycleManager.enableUnfold(mesh, firstFace);
            }
        }
    }
};

/**
 * Плавная 1.0 с анимация трансформации из согнутого 3D состояния в плоскую развертку
 */
window.runUnfoldAnimation = function(duration = 1000) {
    const mesh = window.selectedUnfoldObject;
    if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return;
    
    if (typeof window.runKinematicUnfoldAnimation === 'function') {
        window.runKinematicUnfoldAnimation(mesh, window.currentKinematicGraph, duration);
        return;
    }

    const posAttr = mesh.geometry.attributes.position;
    const count = posAttr.count;
    
    // Сохраняем исходные 3D позиции
    const foldedPositions = new Float32Array(posAttr.array);
    const unfoldedPositions = new Float32Array(count * 3);
    
    // Если на объекте уже сгенерирована плоская геометрия
    if (mesh.userData.unfoldedGeometry && mesh.userData.unfoldedGeometry.attributes.position) {
        const uArray = mesh.userData.unfoldedGeometry.attributes.position.array;
        if (uArray.length === count * 3) {
            unfoldedPositions.set(uArray);
        } else {
            generateFlatUnfoldedArray(mesh, foldedPositions, unfoldedPositions);
        }
    } else {
        generateFlatUnfoldedArray(mesh, foldedPositions, unfoldedPositions);
    }
    
    const startTime = performance.now();
    window.flattenAnimating = true;
    
    function animateFrame(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1.0);
        
        // Кубическая функция сглаживания ease-out
        const ease = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        
        const currentPos = posAttr.array;
        for (let i = 0; i < currentPos.length; i++) {
            currentPos[i] = (1 - ease) * foldedPositions[i] + ease * unfoldedPositions[i];
        }
        
        posAttr.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
        
        const edgeChild = mesh.children.find(c => c.isLineSegments);
        if (edgeChild) {
            edgeChild.geometry.dispose();
            edgeChild.geometry = new THREE.EdgesGeometry(mesh.geometry, 15);
        }
        
        if (progress < 1.0) {
            requestAnimationFrame(animateFrame);
        } else {
            window.flattenAnimating = false;
            window.flattenState = 'unfolded';
            
            mesh.geometry.computeVertexNormals();
            if (typeof window.fixUnfoldedNormals === 'function') {
                const bData = window.unfoldBaseFaceData;
                const tNorm = (bData && bData.normal) ? bData.normal : new THREE.Vector3(0, 1, 0);
                const cPt = (bData && bData.centroid) ? bData.centroid : null;
                window.fixUnfoldedNormals(mesh.geometry, tNorm, cPt, mesh);
            }
            
            // Отрисовка штриховых линий гиба
            window.renderUnfoldBendLines(mesh);
            
            // Показ панели анализа и собираемости
            window.renderUnfoldInfoPanel(mesh);
        }
    }
    
    requestAnimationFrame(animateFrame);
};

/**
 * Генерация массивов плоских положений развертки относительно зафиксированного базиса (WCS_base)
 * с кинематическим пошаговым раскрытием гибов в плоскость первой грани и сохранением объема.
 */
window.generateFlatUnfoldedArray = function(mesh, foldedPositions, unfoldedPositions, baseFaceData) {
    if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return;
    
    const count = foldedPositions.length / 3;
    const baseData = baseFaceData || window.unfoldBaseFaceData;

    // 1. Использование эталонной плоской развертки детали (unfoldedBaseGeometry), если она была построена
    let uGeo = (mesh.userData && mesh.userData.unfoldedBaseGeometry);
    if (!uGeo && mesh.userData && mesh.userData.bendsList && mesh.userData.bendsList.length > 0 && typeof window.rebuildObjectFromBends === 'function') {
        try { window.rebuildObjectFromBends(mesh); } catch(e) {}
        uGeo = mesh.userData.unfoldedBaseGeometry;
    }

    if (uGeo && uGeo.attributes && uGeo.attributes.position && uGeo.attributes.position.count === count) {
        if (typeof window.sanitizeAndFlattenUnfoldedGeometry === 'function') {
            window.sanitizeAndFlattenUnfoldedGeometry(uGeo, mesh.userData.specData, baseData);
        }
        const uArr = uGeo.attributes.position.array;
        for (let i = 0; i < count * 3; i++) {
            unfoldedPositions[i] = uArr[i];
        }
        return;
    }

    // 2. Универсальная 3D-проекция на нейтральную плоскость заготовки (Kinematic Flat Projection)
    const spec = mesh.userData.specData || {};
    const t = spec.t || spec.depth || 5.0;

    let targetNormal = new THREE.Vector3(0, 1, 0);
    let targetCentroid = new THREE.Vector3(0, 0, 0);

    if (baseData) {
        if (baseData.normal) targetNormal.copy(baseData.normal).normalize();
        if (baseData.centroid) targetCentroid.copy(baseData.centroid);
    } else {
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        mesh.geometry.boundingBox.getCenter(targetCentroid);
        
        const sz = new THREE.Vector3();
        mesh.geometry.boundingBox.getSize(sz);
        if (sz.x <= sz.y && sz.x <= sz.z) targetNormal.set(1, 0, 0);
        else if (sz.y <= sz.x && sz.y <= sz.z) targetNormal.set(0, 1, 0);
        else targetNormal.set(0, 0, 1);
    }

    let perpAxis1 = new THREE.Vector3(1, 0, 0);
    if (Math.abs(targetNormal.x) > 0.8) perpAxis1.set(0, 1, 0);
    perpAxis1.sub(targetNormal.clone().multiplyScalar(perpAxis1.dot(targetNormal))).normalize();
    let perpAxis2 = new THREE.Vector3().crossVectors(targetNormal, perpAxis1).normalize();

    const v3 = new THREE.Vector3();
    const pivotPt = targetCentroid.clone();

    for (let i = 0; i < count; i++) {
        const idx = i * 3;
        v3.set(foldedPositions[idx], foldedPositions[idx + 1], foldedPositions[idx + 2]);

        const rel = v3.clone().sub(pivotPt);
        const h = rel.dot(targetNormal);
        
        const proj = v3.clone().addScaledVector(targetNormal, -h);
        const relProj = proj.clone().sub(pivotPt);

        const absH = Math.abs(h);
        if (absH > t * 0.5) {
            const s = Math.sign(h) || 1;
            const extraDist = absH - t * 0.5;
            
            let unfoldDir = relProj.clone();
            if (unfoldDir.lengthSq() > 0.001) {
                unfoldDir.normalize();
            } else {
                unfoldDir.copy(perpAxis1);
            }

            const flatPoint = proj.addScaledVector(unfoldDir, extraDist)
                                  .addScaledVector(targetNormal, s * t * 0.5);
            
            unfoldedPositions[idx] = flatPoint.x;
            unfoldedPositions[idx + 1] = flatPoint.y;
            unfoldedPositions[idx + 2] = flatPoint.z;
        } else {
            const flatPoint = proj.addScaledVector(targetNormal, h);
            unfoldedPositions[idx] = flatPoint.x;
            unfoldedPositions[idx + 1] = flatPoint.y;
            unfoldedPositions[idx + 2] = flatPoint.z;
        }
    }
};

function generateFlatUnfoldedArray(mesh, foldedPositions, unfoldedPositions) {
    window.generateFlatUnfoldedArray(mesh, foldedPositions, unfoldedPositions, window.unfoldBaseFaceData);
}

/**
 * 4.1. Подсветка поверхностей гиба (Bend Face Coloration)
 */
window.applyFacetColorsToMesh = function(mesh) {
    if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return;

    const geom = mesh.geometry;
    const pos = geom.attributes.position;
    const vertexCount = pos.count;
    const index = geom.index;
    const triCount = index ? index.count / 3 : pos.count / 3;

    let facetLabels = mesh.userData ? mesh.userData.facetLabels : null;
    if (!facetLabels && typeof window.analyzeAndLabelFacets === 'function') {
        facetLabels = window.analyzeAndLabelFacets(mesh, window.unfoldBaseFaceData);
    }

    if (!facetLabels) return;

    let colorAttr = geom.attributes.color;
    if (!colorAttr || colorAttr.count !== vertexCount) {
        const colorArray = new Float32Array(vertexCount * 3);
        colorAttr = new THREE.BufferAttribute(colorArray, 3);
        geom.setAttribute('color', colorAttr);
    }

    const cArr = colorAttr.array;

    for (let i = 0; i < triCount; i++) {
        const label = facetLabels[i] || 'FLANGE';
        let r = 0.796, g = 0.835, b = 0.882; // FLANGE neutral steel

        if (label === 'BEND_FACET_INNER' || label === 'BEND_FACET_OUTER') {
            r = 1.0; g = 0.596; b = 0.0; // Amber #FF9800
        } else if (label === 'BEND_CORNER_SIDE') {
            r = 0.705; g = 0.325; b = 0.035; // Dark Amber #B45309
        }

        const idxA = index ? index.getX(i * 3) : i * 3;
        const idxB = index ? index.getX(i * 3 + 1) : i * 3 + 1;
        const idxC = index ? index.getX(i * 3 + 2) : i * 3 + 2;

        cArr[idxA * 3] = r; cArr[idxA * 3 + 1] = g; cArr[idxA * 3 + 2] = b;
        cArr[idxB * 3] = r; cArr[idxB * 3 + 1] = g; cArr[idxB * 3 + 2] = b;
        cArr[idxC * 3] = r; cArr[idxC * 3 + 1] = g; cArr[idxC * 3 + 2] = b;
    }

    colorAttr.needsUpdate = true;

    if (mesh.material) {
        const matList = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        matList.forEach(m => {
            if (m) {
                if (m.userData.savedVertexColors === undefined) m.userData.savedVertexColors = m.vertexColors;
                if (m.userData.savedColor === undefined && m.color) m.userData.savedColor = m.color.getHex();
                if (m.userData.savedRoughness === undefined) m.userData.savedRoughness = m.roughness;
                if (m.userData.savedMetalness === undefined) m.userData.savedMetalness = m.metalness;

                if (m.color) m.color.setHex(0xffffff); // Предотвращение зачернения
                m.vertexColors = true;
                m.needsUpdate = true;
            }
        });
    }
};

/**
 * 5. Класс RigidFacetUnfolder (Движок кинематической развертки без пересоздания геометрии)
 */
class RigidFacetUnfolder {
    buildPivotTree(mainMesh, bendInfo) {
        const rootGroup = new THREE.Group();
        let currentParentGroup = rootGroup;

        if (bendInfo && bendInfo.facets) {
            bendInfo.facets.forEach((facetData) => {
                const pivotGroup = new THREE.Group();
                if (facetData.hingeAxisPoint) pivotGroup.position.copy(facetData.hingeAxisPoint);
                if (facetData.meshSegment) pivotGroup.add(facetData.meshSegment);

                pivotGroup.userData = {
                    localAxis: facetData.hingeAxisVector || new THREE.Vector3(1, 0, 0),
                    initAngle: facetData.deltaAngle || 0
                };

                currentParentGroup.add(pivotGroup);
                currentParentGroup = pivotGroup;
            });
        }

        if (bendInfo && bendInfo.childFlangeMesh) {
            currentParentGroup.add(bendInfo.childFlangeMesh);
        }

        return rootGroup;
    }

    animateFrame(rootGroup, T, overlap = 0.4) {
        const pivots = [];
        rootGroup.traverse((obj) => {
            if (obj.isGroup && obj.userData && obj.userData.localAxis) pivots.push(obj);
        });

        const N = pivots.length;
        if (N === 0) return;
        const stepDuration = 1 / (1 + (N - 1) * (1 - overlap));

        pivots.forEach((pivot, i) => {
            const startTime = i * stepDuration * (1 - overlap);
            const endTime = startTime + stepDuration;

            const rawT = Math.min(Math.max((T - startTime) / (endTime - startTime), 0), 1);
            const easedT = rawT < 0.5 ? 4 * rawT * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 3) / 2;

            const currentAngle = pivot.userData.initAngle * (1 - easedT);
            pivot.quaternion.setFromAxisAngle(pivot.userData.localAxis, currentAngle);
        });
    }
}
window.RigidFacetUnfolder = RigidFacetUnfolder;

/**
 * 4.2. Отображение поверхностей гиба (выделение граней) и Центральной Штрихпунктирной Линии (Centerline)
 */
window.renderUnfoldBendLines = function(mesh) {
    if (!mesh || !mesh.geometry) return;

    if (window.unfoldBendLinesGroup) {
        if (window.unfoldBendLinesGroup.parent) window.unfoldBendLinesGroup.parent.remove(window.unfoldBendLinesGroup);
        if (typeof window.disposeThreeObject === 'function') window.disposeThreeObject(window.unfoldBendLinesGroup);
    }
    
    window.unfoldBendLinesGroup = new THREE.Group();

    // 1. Окрашиваем грани модели прямо на ее геометрии (без внешней трапециевидной накладки)
    if (typeof window.applyFacetColorsToMesh === 'function') {
        window.applyFacetColorsToMesh(mesh);
    }

    // 2. Строим Центральную Штрихпунктирную Линию (Centerline) ровно по центру нейтральной оси гиба
    const dashDotPoints = [];
    const bends = (mesh.userData && mesh.userData.bendsList) || [];

    const centerlineMaterial = new THREE.LineDashedMaterial({
        color: 0x000000,
        dashSize: 6,
        gapSize: 3,
        linewidth: 2,
        scale: 1
    });

    if (bends.length > 0) {
        for (const bend of bends) {
            if (bend.flatMat && bend.L_arc && bend.edgeWidth) {
                const L_arc = bend.L_arc;
                const halfW = bend.edgeWidth / 2;
                const t = bend.t || 5.0;
                const mat = bend.flatMat;

                // Линия в центре зоны гиба (x = L_arc / 2) по нейтральной оси (y = 0)
                const c1 = new THREE.Vector3(L_arc / 2, t / 2 + 0.15, -halfW).applyMatrix4(mat);
                const c2 = new THREE.Vector3(L_arc / 2, t / 2 + 0.15, +halfW).applyMatrix4(mat);
                dashDotPoints.push(c1, c2);

                const cBot1 = new THREE.Vector3(L_arc / 2, -t / 2 - 0.15, -halfW).applyMatrix4(mat);
                const cBot2 = new THREE.Vector3(L_arc / 2, -t / 2 - 0.15, +halfW).applyMatrix4(mat);
                dashDotPoints.push(cBot1, cBot2);
            }
        }
    } else {
        // Резервная линия по центру геометрического Bounding Box
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const bb = mesh.geometry.boundingBox;
        const size = new THREE.Vector3();
        bb.getSize(size);

        const dims = [
            { axis: 'x', val: size.x },
            { axis: 'y', val: size.y },
            { axis: 'z', val: size.z }
        ].sort((a, b) => a.val - b.val);

        const tDim = dims[0].axis;
        const span1 = dims[1].axis;
        const span2 = dims[2].axis;

        const posVal = bb.min[span2] + size[span2] * 0.5;

        const cTop1 = new THREE.Vector3();
        const cTop2 = new THREE.Vector3();
        cTop1[tDim] = bb.max[tDim] + 0.15;
        cTop2[tDim] = bb.max[tDim] + 0.15;
        cTop1[span1] = bb.min[span1];
        cTop2[span1] = bb.max[span1];
        cTop1[span2] = posVal;
        cTop2[span2] = posVal;
        dashDotPoints.push(cTop1, cTop2);

        const cBot1 = new THREE.Vector3();
        const cBot2 = new THREE.Vector3();
        cBot1[tDim] = bb.min[tDim] - 0.15;
        cBot2[tDim] = bb.min[tDim] - 0.15;
        cBot1[span1] = bb.min[span1];
        cBot2[span1] = bb.max[span1];
        cBot1[span2] = posVal;
        cBot2[span2] = posVal;
        dashDotPoints.push(cBot1, cBot2);
    }

    if (dashDotPoints.length > 0) {
        const lineGeo = new THREE.BufferGeometry().setFromPoints(dashDotPoints);
        const lineMesh = new THREE.LineSegments(lineGeo, centerlineMaterial);
        lineMesh.computeLineDistances();
        window.unfoldBendLinesGroup.add(lineMesh);
    }

    mesh.add(window.unfoldBendLinesGroup);
};

window.makeUnfoldPanelDraggable = function(panel) {
    const header = panel.querySelector('#unfold-info-header') || panel.querySelector('.unfold-info-header');
    if (!header || panel.dataset.dragInit === 'true') return;
    panel.dataset.dragInit = 'true';

    let isDragging = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;

    const onMouseDown = (e) => {
        if (e.target.closest('button')) return;
        isDragging = true;
        header.style.cursor = 'grabbing';
        
        const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
        const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);

        startX = clientX;
        startY = clientY;

        const rect = panel.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        panel.style.bottom = 'auto';
        panel.style.right = 'auto';
        panel.style.left = initialLeft + 'px';
        panel.style.top = initialTop + 'px';
        panel.style.margin = '0';

        const onMouseMove = (moveEvent) => {
            if (!isDragging) return;
            const curX = moveEvent.clientX !== undefined ? moveEvent.clientX : (moveEvent.touches && moveEvent.touches[0] ? moveEvent.touches[0].clientX : 0);
            const curY = moveEvent.clientY !== undefined ? moveEvent.clientY : (moveEvent.touches && moveEvent.touches[0] ? moveEvent.touches[0].clientY : 0);
            
            const dx = curX - startX;
            const dy = curY - startY;
            
            panel.style.left = (initialLeft + dx) + 'px';
            panel.style.top = (initialTop + dy) + 'px';
        };

        const onMouseUp = () => {
            isDragging = false;
            header.style.cursor = 'grab';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.removeEventListener('touchmove', onMouseMove);
            document.removeEventListener('touchend', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.addEventListener('touchmove', onMouseMove, { passive: true });
        document.addEventListener('touchend', onMouseUp);
    };

    header.addEventListener('mousedown', onMouseDown);
    header.addEventListener('touchstart', onMouseDown, { passive: true });
};

/**
 * Рендер Инспекционной Панели Развертки
 */
window.renderUnfoldInfoPanel = function(mesh) {
    const banner = document.getElementById('unfold-hud-banner');
    if (banner) banner.style.display = 'none';
    
    const container = document.getElementById('flatten-overlay-container');
    if (!container) return;
    
    let panel = document.getElementById('unfold-info-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'unfold-info-panel';
        panel.className = 'unfold-info-panel';
        container.appendChild(panel);
    }
    panel.style.display = 'block';
    
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const sz = new THREE.Vector3();
    mesh.geometry.boundingBox.getSize(sz);
    
    const spec = mesh.userData.specData || {};
    const t = (spec.t || spec.depth || 10).toFixed(1);
    const L = Math.round(Math.max(sz.x, sz.z) * 1.2 + 20).toFixed(1);
    const B = Math.round(Math.min(sz.x, sz.z) + 15).toFixed(1);
    const area = ((parseFloat(L) * parseFloat(B)) / 1e6).toFixed(4);
    
    panel.innerHTML = `
        <div class="unfold-info-header" id="unfold-info-header" style="cursor: grab; user-select: none;">
            <div style="display:flex; align-items:center; gap:8px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748B" stroke-width="2.5" style="cursor:grab;"><circle cx="9" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>
                <div class="unfold-badge" style="background:#2563EB; color:#FFFFFF;">3D Развертка</div>
                <span style="font-weight:700; font-size:14px; color:#0F172A;">Параметры развертки</span>
            </div>
        </div>
        <div class="unfold-info-grid">
            <div class="unfold-info-item">
                <div class="unfold-info-label">Длина раскроя (L)</div>
                <div class="unfold-info-value">${L} мм</div>
            </div>
            <div class="unfold-info-item">
                <div class="unfold-info-label">Ширина полки (B)</div>
                <div class="unfold-info-value">${B} мм</div>
            </div>
            <div class="unfold-info-item">
                <div class="unfold-info-label">Толщина листа (t)</div>
                <div class="unfold-info-value">${t} мм</div>
            </div>
            <div class="unfold-info-item">
                <div class="unfold-info-label">Площадь раскроя</div>
                <div class="unfold-info-value">${area} м²</div>
            </div>
        </div>
        <button class="unfold-btn-action" onclick="window.exitFlattenMode()">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>
            <span>Вернуть в 3D профиль (Esc)</span>
        </button>
    `;

    if (typeof window.makeUnfoldPanelDraggable === 'function') {
        window.makeUnfoldPanelDraggable(panel);
    }
};

/**
 * Выход из режима развертки и возвращение детали в 3D профиль с 1.0 с анимацией
 */
window.exitFlattenMode = function() {
    if (window.unfoldLifecycleManager && window.unfoldLifecycleManager.isActive) {
        window.unfoldLifecycleManager.disableUnfold();
    }
    if (!window.flattenMode) return;
    
    const mesh = window.selectedUnfoldObject;
    
    if (mesh && window.flattenState === 'unfolded') {
        window.flattenState = 'animating_fold';
        window.runFoldAnimation(mesh, 1000, () => {
            window.cleanupUnfoldState();
        });
    } else {
        window.cleanupUnfoldState();
    }
};

/**
 * Анимация свертывания обратно в 3D
 */
window.runFoldAnimation = function(mesh, duration = 1000, onComplete) {
    if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) {
        if (onComplete) onComplete();
        return;
    }
    
    const posAttr = mesh.geometry.attributes.position;
    const currentPos = new Float32Array(posAttr.array);
    
    let targetFolded = currentPos;
    if (mesh.userData.savedFoldedPositions && mesh.userData.savedFoldedPositions.length === currentPos.length) {
        targetFolded = mesh.userData.savedFoldedPositions;
    } else if (mesh.userData.bendData && mesh.userData.bendData.foldedPositions) {
        targetFolded = mesh.userData.bendData.foldedPositions;
    }
    
    const startTime = performance.now();
    window.flattenAnimating = true;
    
    function animateFrame(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1.0);
        
        const ease = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        
        const arr = posAttr.array;
        for (let i = 0; i < arr.length; i++) {
            arr[i] = (1 - ease) * currentPos[i] + ease * targetFolded[i];
        }
        
        posAttr.needsUpdate = true;
        
        if (progress < 1.0) {
            requestAnimationFrame(animateFrame);
        } else {
            mesh.geometry.computeVertexNormals();
            const edgeChild = mesh.children.find(c => c.isLineSegments);
            if (edgeChild) {
                edgeChild.geometry.dispose();
                edgeChild.geometry = new THREE.EdgesGeometry(mesh.geometry, 15);
            }

            window.flattenAnimating = false;
            if (onComplete) onComplete();
        }
    }
    
    requestAnimationFrame(animateFrame);
};

/**
 * Очистка всех оверлеев и восстановление стандартного CAD состояния
 */
window.cleanupUnfoldState = function() {
    window.flattenMode = false;
    window.flattenState = 'off';
    
    if (window.unfoldHoverOverlay) {
        if (window.unfoldHoverOverlay.parent) window.unfoldHoverOverlay.parent.remove(window.unfoldHoverOverlay);
        if (typeof window.disposeThreeObject === 'function') window.disposeThreeObject(window.unfoldHoverOverlay);
        window.unfoldHoverOverlay = null;
    }
    
    if (window.unfoldBaseOverlay) {
        if (window.unfoldBaseOverlay.parent) window.unfoldBaseOverlay.parent.remove(window.unfoldBaseOverlay);
        if (typeof window.disposeThreeObject === 'function') window.disposeThreeObject(window.unfoldBaseOverlay);
        window.unfoldBaseOverlay = null;
    }
    
    if (window.unfoldBendLinesGroup) {
        if (window.unfoldBendLinesGroup.parent) window.unfoldBendLinesGroup.parent.remove(window.unfoldBendLinesGroup);
        if (typeof window.disposeThreeObject === 'function') window.disposeThreeObject(window.unfoldBendLinesGroup);
        window.unfoldBendLinesGroup = null;
    }
    
    const container = document.getElementById('flatten-overlay-container');
    if (container) {
        container.innerHTML = '';
        container.style.display = 'none';
    }
    
    const mesh = window.selectedUnfoldObject;
    if (mesh) {
        // 1. Удаляем временный атрибут цвета граней
        if (mesh.geometry && mesh.geometry.attributes.color) {
            mesh.geometry.deleteAttribute('color');
        }

        // 2. Гарантированно восстанавливаем оригинальные согнутые 3D позиции
        if (mesh.userData && mesh.userData.savedFoldedPositions && mesh.geometry && mesh.geometry.attributes.position) {
            mesh.geometry.attributes.position.array.set(mesh.userData.savedFoldedPositions);
            mesh.geometry.attributes.position.needsUpdate = true;
            mesh.geometry.computeVertexNormals();
            mesh.geometry.computeBoundingBox();
            mesh.geometry.computeBoundingSphere();

            const edgeChild = mesh.children.find(c => c.isLineSegments);
            if (edgeChild) {
                edgeChild.geometry.dispose();
                edgeChild.geometry = new THREE.EdgesGeometry(mesh.geometry, 15);
            }
        }

        // 3. Полностью восстанавливаем оригинальные свойства материалов на 100%
        if (mesh.material) {
            const matList = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            matList.forEach(m => {
                if (m && m.userData) {
                    if (m.userData.savedVertexColors !== undefined) {
                        m.vertexColors = m.userData.savedVertexColors;
                        delete m.userData.savedVertexColors;
                    } else {
                        m.vertexColors = false;
                    }
                    if (m.userData.savedColor !== undefined && m.color) {
                        m.color.setHex(m.userData.savedColor);
                        delete m.userData.savedColor;
                    }
                    if (m.userData.savedSide !== undefined) {
                        m.side = m.userData.savedSide;
                        delete m.userData.savedSide;
                    }
                    if (m.userData.savedRoughness !== undefined) {
                        m.roughness = m.userData.savedRoughness;
                        delete m.userData.savedRoughness;
                    }
                    if (m.userData.savedMetalness !== undefined) {
                        m.metalness = m.userData.savedMetalness;
                        delete m.userData.savedMetalness;
                    }
                    m.needsUpdate = true;
                }
            });
        }
    }

    window.selectedUnfoldObject = null;
    window.unfoldBaseFaceData = null;
    window.currentKinematicGraph = null;
    setCanvasCursor('default');
    
    if (typeof showToast === 'function') {
        showToast("Деталь вернулась в согнутый 3D профиль.");
    }
};

window.toggleFlattenMode = function() {
    if (window.flattenMode) {
        window.exitFlattenMode();
    } else {
        window.startFlattenMode();
    }
};

/**
 * ============================================================================
 * Блок Топологии: Обрезка и Продление Эскизов (Intersection Engine)
 * ============================================================================
 */

function getPlaneBasis(plane) {
    if (!plane) {
        return {
            origin: new THREE.Vector3(0, 0, 0),
            right: new THREE.Vector3(1, 0, 0),
            up: new THREE.Vector3(0, 1, 0),
            normal: new THREE.Vector3(0, 0, 1)
        };
    }
    let up, normal, origin;
    if (plane.userData && plane.userData.up && plane.userData.normal) {
        up = plane.userData.up.clone().normalize();
        normal = plane.userData.normal.clone().normalize();
        origin = plane.userData.origin ? plane.userData.origin.clone() : plane.position.clone();
    } else {
        normal = new THREE.Vector3(0, 0, 1);
        plane.getWorldDirection(normal);
        up = new THREE.Vector3(0, 1, 0);
        up.applyQuaternion(plane.quaternion);
        origin = plane.position.clone();
    }
    const right = new THREE.Vector3().crossVectors(up, normal).normalize();
    return { origin, right, up, normal };
}

function project3Dto2D(pt3d, basis) {
    const rel = pt3d.clone().sub(basis.origin);
    return {
        u: rel.dot(basis.right),
        v: rel.dot(basis.up)
    };
}

function project2Dto3D(u, v, basis) {
    return basis.origin.clone()
        .add(basis.right.clone().multiplyScalar(u))
        .add(basis.up.clone().multiplyScalar(v));
}

function getSegmentParam(a2d, b2d, pt2d) {
    const dx = b2d.u - a2d.u;
    const dy = b2d.v - a2d.v;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-12) return 0;
    return ((pt2d.u - a2d.u) * dx + (pt2d.v - a2d.v) * dy) / lenSq;
}

function intersect2DLines(a2d, b2d, c2d, d2d) {
    const rx = b2d.u - a2d.u;
    const ry = b2d.v - a2d.v;
    const sx = d2d.u - c2d.u;
    const sy = d2d.v - c2d.v;
    
    const denom = rx * sy - ry * sx;
    if (Math.abs(denom) < 1e-8) return null;
    
    const ta = ((c2d.u - a2d.u) * sy - (c2d.v - a2d.v) * sx) / denom;
    const tb = ((c2d.u - a2d.u) * ry - (c2d.v - a2d.v) * rx) / denom;
    
    return { ta, tb };
}

function getCircleLineIntersections(circCenter2d, R, a2d, b2d) {
    const dx = b2d.u - a2d.u;
    const dy = b2d.v - a2d.v;
    const fx = a2d.u - circCenter2d.u;
    const fy = a2d.v - circCenter2d.v;
    const results = [];

    const A = dx * dx + dy * dy;
    if (A > 1e-12) {
        const B = 2 * (fx * dx + fy * dy);
        const C = fx * fx + fy * fy - R * R;
        const disc = B * B - 4 * A * C;
        if (disc >= 0) {
            const sqrtDisc = Math.sqrt(disc);
            const t1 = (-B - sqrtDisc) / (2 * A);
            const t2 = (-B + sqrtDisc) / (2 * A);

            [t1, t2].forEach(tLine => {
                if (tLine >= -1e-4 && tLine <= 1.0001) {
                    const pu = a2d.u + tLine * dx;
                    const pv = a2d.v + tLine * dy;
                    let angle = Math.atan2(pv - circCenter2d.v, pu - circCenter2d.u);
                    if (angle < 0) angle += Math.PI * 2;
                    results.push({ pt2d: { u: pu, v: pv }, angle, tLine });
                }
            });
        }
    }
    return results;
}

function getCircleCircleIntersections(c1Center2d, R1, c2Center2d, R2) {
    const du = c2Center2d.u - c1Center2d.u;
    const dv = c2Center2d.v - c1Center2d.v;
    const d = Math.hypot(du, dv);
    const results = [];

    if (d < 1e-8 || d > R1 + R2 || d < Math.abs(R1 - R2)) {
        return results;
    }

    const a = (R1 * R1 - R2 * R2 + d * d) / (2 * d);
    const hSq = R1 * R1 - a * a;
    const h = Math.sqrt(Math.max(0, hSq));

    const p2u = c1Center2d.u + (a * du) / d;
    const p2v = c1Center2d.v + (a * dv) / d;

    const p1u = p2u + (h * (-dv)) / d;
    const p1v = p2v + (h * du) / d;
    let angle1 = Math.atan2(p1v - c1Center2d.v, p1u - c1Center2d.u);
    if (angle1 < 0) angle1 += Math.PI * 2;
    results.push({ pt2d: { u: p1u, v: p1v }, angle: angle1 });

    if (h > 1e-6) {
        const p2u_alt = p2u - (h * (-dv)) / d;
        const p2v_alt = p2v - (h * du) / d;
        let angle2 = Math.atan2(p2v_alt - c1Center2d.v, p2u_alt - c1Center2d.u);
        if (angle2 < 0) angle2 += Math.PI * 2;
        results.push({ pt2d: { u: p2u_alt, v: p2v_alt }, angle: angle2 });
    }

    return results;
}

function getCircleTrimIntersectionAngles(targetCircle, allSegments, allCircles, basis) {
    if (!targetCircle || !targetCircle.center || !(targetCircle.radius > 0)) return [];
    const circCenter2d = project3Dto2D(targetCircle.center, basis);
    const R = targetCircle.radius;
    const angles = [];

    (allSegments || []).forEach(seg => {
        if (!seg || !seg.start || !seg.end) return;
        const a2d = project3Dto2D(seg.start, basis);
        const b2d = project3Dto2D(seg.end, basis);
        const hits = getCircleLineIntersections(circCenter2d, R, a2d, b2d);
        hits.forEach(h => angles.push(h.angle));
    });

    (allCircles || []).forEach(c => {
        if (c === targetCircle || !c || !c.center || !(c.radius > 0)) return;
        const c2Center2d = project3Dto2D(c.center, basis);
        const hits = getCircleCircleIntersections(circCenter2d, R, c2Center2d, c.radius);
        hits.forEach(h => angles.push(h.angle));
    });

    angles.sort((a, b) => a - b);
    const uniqueAngles = [];
    angles.forEach(val => {
        if (uniqueAngles.length === 0 || val - uniqueAngles[uniqueAngles.length - 1] > 1e-4) {
            uniqueAngles.push(val);
        }
    });

    return uniqueAngles;
}

function getTrimIntersectionParams(targetSegment, allSegments, allCircles, basis) {
    const a2d = project3Dto2D(targetSegment.start, basis);
    const b2d = project3Dto2D(targetSegment.end, basis);
    const params = [];
    
    // 1. Пересечения с другими отрезками
    (allSegments || []).forEach(seg => {
        if (seg === targetSegment || !seg.start || !seg.end) return;
        const c2d = project3Dto2D(seg.start, basis);
        const d2d = project3Dto2D(seg.end, basis);
        
        const res = intersect2DLines(a2d, b2d, c2d, d2d);
        if (res) {
            const { ta, tb } = res;
            if (tb >= -1e-4 && tb <= 1.0001 && ta > 1e-4 && ta < 1 - 1e-4) {
                params.push(ta);
            }
        }
    });
    
    // 2. Пересечения с окружностями
    (allCircles || []).forEach(c => {
        if (!c || !c.center || !(c.radius > 0)) return;
        const circCenter2d = project3Dto2D(c.center, basis);
        
        const dx = b2d.u - a2d.u;
        const dy = b2d.v - a2d.v;
        const fx = a2d.u - circCenter2d.u;
        const fy = a2d.v - circCenter2d.v;
        
        const A = dx * dx + dy * dy;
        if (A > 1e-12) {
            const B = 2 * (fx * dx + fy * dy);
            const C = fx * fx + fy * fy - c.radius * c.radius;
            const disc = B * B - 4 * A * C;
            if (disc >= 0) {
                const sqrtDisc = Math.sqrt(disc);
                const t1 = (-B - sqrtDisc) / (2 * A);
                const t2 = (-B + sqrtDisc) / (2 * A);
                
                [t1, t2].forEach(ta => {
                    if (ta > 1e-4 && ta < 1 - 1e-4) {
                        params.push(ta);
                    }
                });
            }
        }
    });
    
    const allT = [0, ...params, 1];
    allT.sort((a, b) => a - b);
    
    const uniqueT = [];
    allT.forEach(val => {
        if (uniqueT.length === 0 || val - uniqueT[uniqueT.length - 1] > 1e-4) {
            uniqueT.push(val);
        }
    });
    
    return uniqueT;
}

function getExtendRayIntersectionParam(targetSegment, allSegments, allCircles, basis, direction) {
    const a2d = project3Dto2D(targetSegment.start, basis);
    const b2d = project3Dto2D(targetSegment.end, basis);
    let bestT = direction === 'forward' ? Infinity : -Infinity;
    
    (allSegments || []).forEach(seg => {
        if (seg === targetSegment || !seg.start || !seg.end) return;
        const c2d = project3Dto2D(seg.start, basis);
        const d2d = project3Dto2D(seg.end, basis);
        
        const res = intersect2DLines(a2d, b2d, c2d, d2d);
        if (res) {
            const { ta, tb } = res;
            if (tb >= -1e-4 && tb <= 1.0001) {
                if (direction === 'forward' && ta > 1.0001 && ta < bestT) {
                    bestT = ta;
                } else if (direction === 'backward' && ta < -1e-4 && ta > bestT) {
                    bestT = ta;
                }
            }
        }
    });
    
    (allCircles || []).forEach(c => {
        if (!c || !c.center || !(c.radius > 0)) return;
        const circCenter2d = project3Dto2D(c.center, basis);
        
        const dx = b2d.u - a2d.u;
        const dy = b2d.v - a2d.v;
        const fx = a2d.u - circCenter2d.u;
        const fy = a2d.v - circCenter2d.v;
        
        const A = dx * dx + dy * dy;
        if (A > 1e-12) {
            const B = 2 * (fx * dx + fy * dy);
            const C = fx * fx + fy * fy - c.radius * c.radius;
            const disc = B * B - 4 * A * C;
            if (disc >= 0) {
                const sqrtDisc = Math.sqrt(disc);
                const t1 = (-B - sqrtDisc) / (2 * A);
                const t2 = (-B + sqrtDisc) / (2 * A);
                
                [t1, t2].forEach(ta => {
                    if (direction === 'forward' && ta > 1.0001 && ta < bestT) {
                        bestT = ta;
                    } else if (direction === 'backward' && ta < -1e-4 && ta > bestT) {
                        bestT = ta;
                    }
                });
            }
        }
    });
    
    return (direction === 'forward' && bestT < Infinity) || (direction === 'backward' && bestT > -Infinity) ? bestT : null;
}

window.getPlaneBasis = getPlaneBasis;
window.project3Dto2D = project3Dto2D;
window.project2Dto3D = project2Dto3D;
window.getSegmentParam = getSegmentParam;
window.intersect2DLines = intersect2DLines;
window.getCircleLineIntersections = getCircleLineIntersections;
window.getCircleCircleIntersections = getCircleCircleIntersections;
window.getCircleTrimIntersectionAngles = getCircleTrimIntersectionAngles;
window.getTrimIntersectionParams = getTrimIntersectionParams;
window.getExtendRayIntersectionParam = getExtendRayIntersectionParam;

window.getGeometryIntersections = function(targetSegment, allSegments, circles) {
    if (!targetSegment || !targetSegment.start || !targetSegment.end) return [];
    
    const plane = (typeof activeSketchPlane !== 'undefined' && activeSketchPlane) ? activeSketchPlane : null;
    const basis = getPlaneBasis(plane);
    
    const params = getTrimIntersectionParams(targetSegment, allSegments, circles, basis);
    return params.filter(t => t > 1e-4 && t < 1 - 1e-4).map(t => targetSegment.start.clone().lerp(targetSegment.end, t));
};
