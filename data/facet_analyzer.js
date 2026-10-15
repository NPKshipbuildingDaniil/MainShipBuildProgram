/**
 * ============================================================================
 * ФАЙЛ: facet_analyzer.js
 * НАЗНАЧЕНИЕ: Модуль анализа геометрии и тегирования граней (Facet Labeling Engine)
 *              с резолвером родительской полки (Face-to-Flange Resolver).
 * БЛОК 1: Анализ геометрии листа и деления на:
 *         - SHEET_FACE (лицевые и тыльные грани полок FLANGE),
 *         - THICKNESS_EDGE (торцы / кромки толщины листа с привязкой parentFlangeId),
 *         - BEND_CYLINDER / BEND_FACET_INNER / BEND_FACET_OUTER (цилиндрические гибы),
 *         - BEND_CORNER_SIDE (боковые торцы и скосы 45° зон гиба).
 * ============================================================================
 */

(function() {
    'use strict';

    class FacetAnalyzer {
        /**
         * Анализирует THREE.Mesh и записывает структуры граней в mesh.userData.facets,
         * mesh.userData.facetMap, mesh.userData.flanges, mesh.userData.bends.
         * НЕ меняет mesh.geometry.attributes.position.array и не повреждает Mesh.
         * @param {THREE.Mesh} mesh 
         * @returns {Array} mesh.userData.facets
         */
        static analyze(mesh) {
            if (!mesh || !mesh.geometry) {
                console.error('[FacetAnalyzer] Передан некорректный Mesh');
                return [];
            }

            const geometry = mesh.geometry;
            const posAttr = geometry.attributes.position;
            if (!posAttr) {
                console.error('[FacetAnalyzer] Отсутствуют позиции вершин (position attribute)');
                return [];
            }

            const initialCount = posAttr.count;
            const indexAttr = geometry.index;
            const numTriangles = indexAttr ? (indexAttr.count / 3) : (posAttr.count / 3);

            if (numTriangles === 0) return [];

            // 1. Извлечение треугольников, вычисление нормалей, центроидов и площадей
            const triangles = [];
            const v0 = new THREE.Vector3();
            const v1 = new THREE.Vector3();
            const v2 = new THREE.Vector3();
            const e1 = new THREE.Vector3();
            const e2 = new THREE.Vector3();

            const getVert = (idx, outVec) => {
                const i = indexAttr ? indexAttr.getX(idx) : idx;
                outVec.fromBufferAttribute(posAttr, i);
                return idx;
            };

            // Квантование координат для надежного сопоставления смежных ребер (0.001 мм)
            const quantize = (val) => Math.round(val * 1000) / 1000;
            const getVertKey = (vec) => `${quantize(vec.x)}_${quantize(vec.y)}_${quantize(vec.z)}`;

            const edgeMap = new Map(); // edgeKey -> [triIndex1, triIndex2...]
            const vertMap = new Map(); // vertKey -> [triIndex1, triIndex2...]

            for (let t = 0; t < numTriangles; t++) {
                const i0 = t * 3;
                const i1 = t * 3 + 1;
                const i2 = t * 3 + 2;

                getVert(i0, v0);
                getVert(i1, v1);
                getVert(i2, v2);

                e1.subVectors(v1, v0);
                e2.subVectors(v2, v0);
                const cross = new THREE.Vector3().crossVectors(e1, e2);
                const area = cross.length() * 0.5;
                const normal = cross.clone().normalize();

                if (normal.lengthSq() < 0.001) {
                    normal.set(0, 1, 0);
                }

                const centroid = new THREE.Vector3().addVectors(v0, v1).add(v2).divideScalar(3);

                const k0 = getVertKey(v0);
                const k1 = getVertKey(v1);
                const k2 = getVertKey(v2);

                triangles.push({
                    id: t,
                    v0: v0.clone(),
                    v1: v1.clone(),
                    v2: v2.clone(),
                    normal: normal,
                    centroid: centroid,
                    area: area,
                    keys: [k0, k1, k2],
                    neighbors: []
                });

                [k0, k1, k2].forEach(vk => {
                    if (!vertMap.has(vk)) vertMap.set(vk, []);
                    vertMap.get(vk).push(t);
                });

                const edges = [
                    [k0, k1].sort().join('||'),
                    [k1, k2].sort().join('||'),
                    [k2, k0].sort().join('||')
                ];

                edges.forEach(eKey => {
                    if (!edgeMap.has(eKey)) edgeMap.set(eKey, []);
                    edgeMap.get(eKey).push(t);
                });
            }

            // Связывание смежных треугольников по ребрам
            edgeMap.forEach((triList) => {
                if (triList.length >= 2) {
                    for (let a = 0; a < triList.length; a++) {
                        for (let b = a + 1; b < triList.length; b++) {
                            const tA = triList[a];
                            const tB = triList[b];
                            if (!triangles[tA].neighbors.includes(tB)) triangles[tA].neighbors.push(tB);
                            if (!triangles[tB].neighbors.includes(tA)) triangles[tB].neighbors.push(tA);
                        }
                    }
                }
            });

            // 2. Определение зон гиба (BEND_CYLINDER: криволинейные плавные переходы нормалей)
            const bendTrianglesVisited = new Array(numTriangles).fill(false);
            const bendSectors = [];
            let sectorCounter = 0;

            for (let i = 0; i < numTriangles; i++) {
                if (bendTrianglesVisited[i]) continue;

                let hasBendNeighbor = false;
                for (const nIdx of triangles[i].neighbors) {
                    const dotN = triangles[i].normal.dot(triangles[nIdx].normal);
                    if (dotN >= 0.75 && dotN < 0.999) {
                        hasBendNeighbor = true;
                        break;
                    }
                }

                if (!hasBendNeighbor) continue;

                const sectorFaces = [];
                const queue = [i];
                bendTrianglesVisited[i] = true;

                while (queue.length > 0) {
                    const curr = queue.shift();
                    sectorFaces.push(curr);
                    const currTri = triangles[curr];

                    for (const nIdx of currTri.neighbors) {
                        if (bendTrianglesVisited[nIdx]) continue;
                        const nTri = triangles[nIdx];
                        const dotN = currTri.normal.dot(nTri.normal);
                        
                        // Криволинейная полоса гиба
                        if (dotN >= 0.75) {
                            bendTrianglesVisited[nIdx] = true;
                            queue.push(nIdx);
                        }
                    }
                }

                if (sectorFaces.length > 0) {
                    bendSectors.push({
                        sectorId: sectorCounter++,
                        faces: sectorFaces
                    });
                }
            }

            // 3. Поиск копланарных плоских областей (Flat Coplanar Regions)
            const flatRegions = [];
            const flatVisited = new Array(numTriangles).fill(false);
            // Помечаем треугольники гибов как уже обработанные
            for (let i = 0; i < numTriangles; i++) {
                if (bendTrianglesVisited[i]) flatVisited[i] = true;
            }

            for (let i = 0; i < numTriangles; i++) {
                if (flatVisited[i]) continue;

                const regionFaces = [];
                const queue = [i];
                flatVisited[i] = true;
                const regNormal = triangles[i].normal.clone();

                while (queue.length > 0) {
                    const curr = queue.shift();
                    regionFaces.push(curr);
                    const currTri = triangles[curr];

                    for (const nIdx of currTri.neighbors) {
                        if (!flatVisited[nIdx]) {
                            const nTri = triangles[nIdx];
                            const dotN = regNormal.dot(nTri.normal);
                            const distPlane = Math.abs(regNormal.dot(new THREE.Vector3().subVectors(nTri.centroid, currTri.centroid)));

                            if (dotN >= 0.99 && distPlane <= 0.2) {
                                flatVisited[nIdx] = true;
                                queue.push(nIdx);
                            }
                        }
                    }
                }

                if (regionFaces.length > 0) {
                    let totalArea = 0;
                    const center = new THREE.Vector3();
                    regionFaces.forEach(fIdx => {
                        totalArea += triangles[fIdx].area;
                        center.add(triangles[fIdx].centroid);
                    });
                    center.divideScalar(regionFaces.length);

                    flatRegions.push({
                        id: flatRegions.length,
                        faces: regionFaces,
                        normal: regNormal.clone().normalize(),
                        centroid: center,
                        area: totalArea
                    });
                }
            }

            // 4. Оценка толщины листа t и надежное разделение на SHEET_FACE vs THICKNESS_EDGE
            // Оцениваем t по расстоянию между противоположными параллельными гранями (dotN ≈ -1)
            let detectedThickness = 5.0;
            if (mesh.userData && mesh.userData.specData && (mesh.userData.specData.t || mesh.userData.specData.depth || mesh.userData.specData.th)) {
                detectedThickness = mesh.userData.specData.t || mesh.userData.specData.depth || mesh.userData.specData.th;
            } else {
                let foundDist = null;
                for (let a = 0; a < flatRegions.length; a++) {
                    for (let b = a + 1; b < flatRegions.length; b++) {
                        const rA = flatRegions[a];
                        const rB = flatRegions[b];
                        const dotN = rA.normal.dot(rB.normal);
                        if (dotN < -0.95) {
                            const d = Math.abs(rA.normal.dot(new THREE.Vector3().subVectors(rB.centroid, rA.centroid)));
                            if (d > 0.3 && d < 60.0) {
                                if (foundDist === null || Math.min(rA.area, rB.area) > 100) {
                                    foundDist = d;
                                }
                            }
                        }
                    }
                }
                if (foundDist !== null) detectedThickness = foundDist;
            }
            mesh.userData.thickness = detectedThickness;

            // 5. Формирование структур FLANGE (Полок)
            // Полка FLANGE образуется парой противоположных параллельных поверхностей (лицевой и тыльной),
            // разделенных расстоянием ~ detectedThickness.
            const flanges = [];
            let flangeCounter = 0;
            const planeAssignedToFlange = new Set();

            // Сортируем плоские области по площади (от самых больших к меньшим)
            const sortedRegions = [...flatRegions].sort((a, b) => b.area - a.area);

            // Ищем пары противоположных параллельных граней
            for (let a = 0; a < sortedRegions.length; a++) {
                const rA = sortedRegions[a];
                if (planeAssignedToFlange.has(rA.id)) continue;

                let oppositePlane = null;
                for (let b = a + 1; b < sortedRegions.length; b++) {
                    const rB = sortedRegions[b];
                    if (planeAssignedToFlange.has(rB.id)) continue;

                    const dotN = rA.normal.dot(rB.normal);
                    if (dotN < -0.90) {
                        const dist = Math.abs(rA.normal.dot(new THREE.Vector3().subVectors(rB.centroid, rA.centroid)));
                        if (dist >= 0.2 && dist <= detectedThickness * 2.5 + 2.0) {
                            oppositePlane = rB;
                            break;
                        }
                    }
                }

                // Если найдена противоположная грань листа (пара образует листовую полку)
                if (oppositePlane) {
                    planeAssignedToFlange.add(rA.id);
                    planeAssignedToFlange.add(oppositePlane.id);

                    const fId = flangeCounter++;
                    const frontFaces = [...rA.faces];
                    const backFaces = [...oppositePlane.faces];

                    flanges.push({
                        id: fId,
                        flangeId: fId,
                        type: 'FLANGE',
                        frontFaces: frontFaces,
                        backFaces: backFaces,
                        edgeFaces: [],
                        edgeRegions: [],
                        cornerFaces: [],
                        allFaces: [...frontFaces, ...backFaces],
                        frontNormal: rA.normal.clone().normalize(),
                        backNormal: oppositePlane.normal.clone().normalize(),
                        centroid: rA.centroid.clone(),
                        area: rA.area + oppositePlane.area,
                        adjacentBendSectors: []
                    });
                }
            }

            // Если парных граней не нашлось (например, одиночная пластина или STL без тыльной сетки), берем наибольшую
            if (flanges.length === 0 && sortedRegions.length > 0) {
                const rMain = sortedRegions[0];
                planeAssignedToFlange.add(rMain.id);
                flanges.push({
                    id: 0,
                    flangeId: 0,
                    type: 'FLANGE',
                    frontFaces: [...rMain.faces],
                    backFaces: [],
                    edgeFaces: [],
                    edgeRegions: [],
                    cornerFaces: [],
                    allFaces: [...rMain.faces],
                    frontNormal: rMain.normal.clone().normalize(),
                    backNormal: rMain.normal.clone().negate().normalize(),
                    centroid: rMain.centroid.clone(),
                    area: rMain.area,
                    adjacentBendSectors: []
                });
            }

            // Fallback: Если все еще нет полок
            if (flanges.length === 0) {
                const allFaces = [];
                for (let i = 0; i < numTriangles; i++) allFaces.push(i);
                flanges.push({
                    id: 0,
                    flangeId: 0,
                    type: 'FLANGE',
                    frontFaces: allFaces,
                    backFaces: [],
                    edgeFaces: [],
                    edgeRegions: [],
                    cornerFaces: [],
                    allFaces: allFaces,
                    frontNormal: new THREE.Vector3(0, 1, 0),
                    backNormal: new THREE.Vector3(0, -1, 0),
                    centroid: new THREE.Vector3(0, 0, 0),
                    area: 1000,
                    adjacentBendSectors: []
                });
            }

            // 6. Распределение секторов гиба (BEND_FACET_INNER / BEND_FACET_OUTER)
            const assignedFacetType = new Array(numTriangles).fill(null);
            const assignedFacetSector = new Array(numTriangles).fill(-1);
            const finalFacets = [];
            let facetIdCounter = 0;

            const bends = [];

            bendSectors.forEach((sec) => {
                const sId = sec.sectorId;
                const faces = sec.faces;

                const centroids = faces.map(f => triangles[f].centroid);
                const secCenter = new THREE.Vector3();
                centroids.forEach(c => secCenter.add(c));
                secCenter.divideScalar(centroids.length);

                const innerFaces = [];
                const outerFaces = [];

                const dists = centroids.map(c => c.distanceTo(secCenter));
                const maxDist = Math.max(...dists);
                const minDist = Math.min(...dists);
                const avgDist = (maxDist + minDist) / 2;

                // Находим смежные полки для данного сектора гиба
                const adjFlangeSet = new Set();
                faces.forEach(fIdx => {
                    const tri = triangles[fIdx];
                    for (const nIdx of tri.neighbors) {
                        for (const fl of flanges) {
                            if (fl.frontFaces.includes(nIdx) || fl.backFaces.includes(nIdx)) {
                                adjFlangeSet.add(fl.id);
                            }
                        }
                    }
                });
                const adjFlangeIds = Array.from(adjFlangeSet);

                faces.forEach((fIdx) => {
                    const tri = triangles[fIdx];
                    const toCentroid = new THREE.Vector3().subVectors(tri.centroid, secCenter);
                    const dotNormal = tri.normal.dot(toCentroid);

                    if (tri.centroid.distanceTo(secCenter) < avgDist || dotNormal < 0) {
                        innerFaces.push(fIdx);
                        assignedFacetType[fIdx] = 'BEND_FACET_INNER';
                    } else {
                        outerFaces.push(fIdx);
                        assignedFacetType[fIdx] = 'BEND_FACET_OUTER';
                    }
                    assignedFacetSector[fIdx] = sId;
                });

                if (innerFaces.length > 0) {
                    finalFacets.push({
                        id: facetIdCounter++,
                        type: 'BEND_FACET_INNER',
                        facetType: 'BEND_FACET_INNER',
                        sector: sId,
                        faces: innerFaces,
                        adjacentFlangeIds: adjFlangeIds
                    });
                }

                if (outerFaces.length > 0) {
                    finalFacets.push({
                        id: facetIdCounter++,
                        type: 'BEND_FACET_OUTER',
                        facetType: 'BEND_FACET_OUTER',
                        sector: sId,
                        faces: outerFaces,
                        adjacentFlangeIds: adjFlangeIds
                    });
                }

                bends.push({
                    sectorId: sId,
                    type: 'BEND',
                    innerFaces: innerFaces,
                    outerFaces: outerFaces,
                    sideFaces: [],
                    allFaces: [...innerFaces, ...outerFaces],
                    adjacentFlangeIds: adjFlangeIds,
                    secCenter: secCenter
                });

                // Добавляем сектор в список смежных для полок
                adjFlangeIds.forEach(flId => {
                    const fl = flanges.find(f => f.id === flId);
                    if (fl && !fl.adjacentBendSectors.includes(sId)) {
                        fl.adjacentBendSectors.push(sId);
                    }
                });
            });

            // 7. Помечаем треугольники основных полок
            flanges.forEach(fl => {
                fl.frontFaces.forEach(fIdx => {
                    assignedFacetType[fIdx] = 'SHEET_FACE';
                    assignedFacetSector[fIdx] = fl.id;
                });
                fl.backFaces.forEach(fIdx => {
                    assignedFacetType[fIdx] = 'SHEET_FACE';
                    assignedFacetSector[fIdx] = fl.id;
                });
            });

            // 8. Распределение торцов (THICKNESS_EDGE) и боковых скосов (BEND_CORNER_SIDE)
            // ПРАВИЛО: Любая поверхность, нормаль которой перпендикулярна нормали полки (|dotN| < 0.45)
            // или имеет скос под углом, является ТОРЦОМ (THICKNESS_EDGE)
            for (let i = 0; i < numTriangles; i++) {
                if (assignedFacetType[i] !== null) continue;

                const uTri = triangles[i];
                let bestFlangeId = -1;
                let bestSectorId = -1;
                let minDistToFlange = Infinity;

                // 1. Проверяем топологическую смежность по ребрам/соседям
                for (const nIdx of uTri.neighbors) {
                    for (const fl of flanges) {
                        if (fl.frontFaces.includes(nIdx) || fl.backFaces.includes(nIdx) || fl.edgeFaces.includes(nIdx)) {
                            bestFlangeId = fl.id;
                            break;
                        }
                    }
                    if (bestFlangeId !== -1) break;

                    const sec = assignedFacetSector[nIdx];
                    if (sec !== -1 && (assignedFacetType[nIdx] === 'BEND_FACET_INNER' || assignedFacetType[nIdx] === 'BEND_FACET_OUTER')) {
                        bestSectorId = sec;
                    }
                }

                // 2. Если по соседям не нашли, ищем по минимальному расстоянию до полок
                if (bestFlangeId === -1 && bestSectorId === -1) {
                    flanges.forEach(fl => {
                        const dist = uTri.centroid.distanceTo(fl.centroid);
                        if (dist < minDistToFlange) {
                            minDistToFlange = dist;
                            bestFlangeId = fl.id;
                        }
                    });
                }

                // Определяем тип: торец полки или торец гиба
                if (bestFlangeId !== -1) {
                    const targetFlange = flanges.find(f => f.id === bestFlangeId);
                    const dotN = targetFlange ? Math.abs(uTri.normal.dot(targetFlange.frontNormal)) : 0.0;

                    // Если нормаль ортогональна или под скосом (< 0.85) -> THICKNESS_EDGE
                    if (dotN < 0.85) {
                        assignedFacetType[i] = 'THICKNESS_EDGE';
                        assignedFacetSector[i] = bestFlangeId;
                        targetFlange.edgeFaces.push(i);
                        targetFlange.allFaces.push(i);
                    } else {
                        // Параллельная грань
                        assignedFacetType[i] = 'SHEET_FACE';
                        assignedFacetSector[i] = bestFlangeId;
                        if (targetFlange && targetFlange.frontNormal.dot(uTri.normal) > 0) {
                            targetFlange.frontFaces.push(i);
                        } else if (targetFlange) {
                            targetFlange.backFaces.push(i);
                        }
                        if (targetFlange) targetFlange.allFaces.push(i);
                    }
                } else if (bestSectorId !== -1) {
                    assignedFacetType[i] = 'BEND_CORNER_SIDE';
                    assignedFacetSector[i] = bestSectorId;
                    const bend = bends.find(b => b.sectorId === bestSectorId);
                    if (bend) {
                        bend.sideFaces.push(i);
                        bend.allFaces.push(i);
                    }
                } else {
                    // Резерв: назначаем первой полке как торец
                    assignedFacetType[i] = 'THICKNESS_EDGE';
                    assignedFacetSector[i] = flanges[0].id;
                    flanges[0].edgeFaces.push(i);
                    flanges[0].allFaces.push(i);
                }
            }

            // 9. Группировка ВСЕХ торцов каждой полки на индивидуальные плоские грани (edgeRegions)
            // Гарантирует, что ВСЕ торцы (включая скосы книц, пазы, вырезы) формируют отдельные выбираемые edgeRegions
            flanges.forEach(fl => {
                fl.edgeRegions = [];
                const eFaces = fl.edgeFaces || [];
                const eVisited = new Set();

                for (let i = 0; i < eFaces.length; i++) {
                    const fIdx = eFaces[i];
                    if (eVisited.has(fIdx)) continue;

                    const regionFaces = [];
                    const q = [fIdx];
                    eVisited.add(fIdx);
                    const baseNorm = triangles[fIdx].normal.clone();
                    const baseCent = triangles[fIdx].centroid.clone();

                    while (q.length > 0) {
                        const curr = q.shift();
                        regionFaces.push(curr);
                        const currTri = triangles[curr];

                        // Проверяем топологических соседей
                        for (const nIdx of currTri.neighbors) {
                            if (eFaces.includes(nIdx) && !eVisited.has(nIdx)) {
                                const nTri = triangles[nIdx];
                                const dotN = baseNorm.dot(nTri.normal);
                                const distPlane = Math.abs(baseNorm.dot(new THREE.Vector3().subVectors(nTri.centroid, baseCent)));
                                if (dotN >= 0.88 && distPlane <= 1.5) {
                                    eVisited.add(nIdx);
                                    q.push(nIdx);
                                }
                            }
                        }

                        // Дополнительно: поиск копланарных граней в eFaces (для неиндексированной геометрии)
                        for (let j = 0; j < eFaces.length; j++) {
                            const otherIdx = eFaces[j];
                            if (!eVisited.has(otherIdx)) {
                                const oTri = triangles[otherIdx];
                                const dotN = baseNorm.dot(oTri.normal);
                                const distPlane = Math.abs(baseNorm.dot(new THREE.Vector3().subVectors(oTri.centroid, baseCent)));
                                const distCent = currTri.centroid.distanceTo(oTri.centroid);
                                if (dotN >= 0.94 && distPlane <= 0.8 && distCent < 150.0) {
                                    eVisited.add(otherIdx);
                                    q.push(otherIdx);
                                }
                            }
                        }
                    }

                    if (regionFaces.length > 0) {
                        let totalArea = 0;
                        const center = new THREE.Vector3();
                        regionFaces.forEach(idx => {
                            totalArea += triangles[idx].area;
                            center.add(triangles[idx].centroid);
                        });
                        center.divideScalar(regionFaces.length);

                        fl.edgeRegions.push({
                            id: fl.edgeRegions.length,
                            faces: regionFaces,
                            normal: baseNorm.clone().normalize(),
                            centroid: center,
                            area: totalArea
                        });
                    }
                }

                console.log(`[FacetAnalyzer] Полка ID ${fl.id}: сформировано ${fl.edgeRegions.length} торцевых граней (edgeRegions)`);
            });

            // Добавляем FLANGE структуры в finalFacets для обратной совместимости
            flanges.forEach(fl => {
                finalFacets.push({
                    id: facetIdCounter++,
                    type: 'FLANGE',
                    facetType: 'FLANGE',
                    flangeId: fl.id,
                    faces: fl.allFaces,
                    frontFaces: fl.frontFaces,
                    backFaces: fl.backFaces,
                    edgeFaces: fl.edgeFaces,
                    frontNormal: fl.frontNormal,
                    backNormal: fl.backNormal,
                    centroid: fl.centroid,
                    area: fl.area
                });
            });

            // Добавляем BEND_CORNER_SIDE в finalFacets
            bends.forEach(b => {
                if (b.sideFaces.length > 0) {
                    finalFacets.push({
                        id: facetIdCounter++,
                        type: 'BEND_CORNER_SIDE',
                        facetType: 'BEND_CORNER_SIDE',
                        parentSector: b.sectorId,
                        faces: b.sideFaces,
                        adjacentFlangeIds: b.adjacentFlangeIds
                    });
                }
            });

            // 9. Создание таблицы быстрого резолвинга facetMap[triIndex]
            const facetMap = new Array(numTriangles);
            for (let t = 0; t < numTriangles; t++) {
                const fType = assignedFacetType[t] || 'SHEET_FACE';
                const fSec = assignedFacetSector[t];
                const tri = triangles[t];

                let parentFlangeId = null;
                let flId = null;
                let adjFlanges = [];
                let frontNorm = new THREE.Vector3(0, 1, 0);

                if (fType === 'SHEET_FACE' || fType === 'THICKNESS_EDGE' || fType === 'FLANGE') {
                    flId = fSec;
                    parentFlangeId = fSec;
                    const fl = flanges.find(f => f.id === fSec);
                    if (fl) frontNorm = fl.frontNormal;
                } else if (fType === 'BEND_FACET_INNER' || fType === 'BEND_FACET_OUTER' || fType === 'BEND_CORNER_SIDE') {
                    const b = bends.find(bd => bd.sectorId === fSec);
                    if (b) {
                        adjFlanges = b.adjacentFlangeIds;
                        parentFlangeId = adjFlanges[0] !== undefined ? adjFlanges[0] : 0;
                        const fl = flanges.find(f => f.id === parentFlangeId);
                        if (fl) frontNorm = fl.frontNormal;
                    }
                }

                facetMap[t] = {
                    triIndex: t,
                    type: (fType === 'SHEET_FACE' || fType === 'FLANGE') ? 'SHEET_FACE' : (fType === 'THICKNESS_EDGE' ? 'THICKNESS_EDGE' : (fType === 'BEND_CORNER_SIDE' ? 'BEND_CORNER_SIDE' : 'BEND_CYLINDER')),
                    facetType: fType,
                    flangeId: flId,
                    parentFlangeId: parentFlangeId,
                    adjacentFlangeIds: adjFlanges,
                    isSheetFace: (fType === 'SHEET_FACE' || fType === 'FLANGE'),
                    isThicknessEdge: (fType === 'THICKNESS_EDGE'),
                    isBend: (fType === 'BEND_FACET_INNER' || fType === 'BEND_FACET_OUTER'),
                    normal: tri.normal.clone(),
                    frontNormal: frontNorm.clone(),
                    centroid: tri.centroid.clone(),
                    sector: fSec
                };
            }

            // 10. Сохранение структур в mesh.userData
            mesh.userData.facets = finalFacets;
            mesh.userData.facetMap = facetMap;
            mesh.userData.flanges = flanges;
            mesh.userData.bends = bends;
            mesh.userData.facetSummary = {
                flanges: flanges.length,
                innerBends: finalFacets.filter(f => f.type === 'BEND_FACET_INNER').length,
                outerBends: finalFacets.filter(f => f.type === 'BEND_FACET_OUTER').length,
                cornerSides: finalFacets.filter(f => f.type === 'BEND_CORNER_SIDE').length,
                thickness: detectedThickness,
                vertexCountOriginal: initialCount,
                vertexCountCurrent: posAttr.count
            };

            console.log(`[FacetAnalyzer] Анализ завершен: ${flanges.length} полок, ${bends.length} гибов, толщина t = ${detectedThickness} мм`);
            return mesh.userData.facets;
        }

        /**
         * Резолвер родительской листовой полки (Parent Flange Resolver)
         * Гарантирует, что клик по любой поверхности (лицо, изнанка, торец, скос 45°, радиус гиба)
         * однозначно находит родительскую листовую полку FLANGE с канонической нормалью.
         * @param {THREE.Mesh} mesh 
         * @param {number|object} selectedTarget Индекс треугольника, объект пересечения или ID
         * @returns {object} Структура родительской полки Flange
         */
        static resolveBaseFlange(mesh, selectedTarget) {
            if (!mesh) return null;
            if (!mesh.userData || !mesh.userData.facets || !mesh.userData.facetMap) {
                FacetAnalyzer.analyze(mesh);
            }

            const flanges = mesh.userData.flanges || [];
            if (flanges.length === 0) {
                return (mesh.userData.facets && mesh.userData.facets[0]) || null;
            }

            // Проверка прямого указания flangeId
            if (selectedTarget && selectedTarget.flangeId !== undefined) {
                const found = flanges.find(f => f.id === selectedTarget.flangeId || f.flangeId === selectedTarget.flangeId);
                if (found) return found;
            }

            // Проверка, если клик пришелся на SubMesh внутри rootGroup (при активной развертке)
            if (selectedTarget && selectedTarget.object && selectedTarget.object.userData) {
                const uData = selectedTarget.object.userData;
                const objName = selectedTarget.object.name || '';
                const targetFlange = flanges.find(f => f.id === uData.flangeId || f.flangeId === uData.flangeId) || flanges[0];

                if (objName.startsWith('BaseEdge') || objName.startsWith('EdgeMesh') || uData.isEdgeMesh || uData.selectedEdgeIndex !== undefined) {
                    let edgeIdx = uData.selectedEdgeIndex !== undefined ? uData.selectedEdgeIndex : 0;
                    if (uData.edgeRegion && targetFlange.edgeRegions) {
                        const foundIdx = targetFlange.edgeRegions.findIndex(e => e.id === uData.edgeRegion.id || e === uData.edgeRegion);
                        if (foundIdx !== -1) edgeIdx = foundIdx;
                    }
                    return {
                        id: targetFlange.id,
                        flangeId: targetFlange.flangeId,
                        type: 'FLANGE',
                        frontFaces: [...targetFlange.frontFaces],
                        backFaces: [...targetFlange.backFaces],
                        edgeFaces: targetFlange.edgeFaces || [],
                        edgeRegions: targetFlange.edgeRegions || [],
                        cornerFaces: targetFlange.cornerFaces || [],
                        allFaces: targetFlange.allFaces || [],
                        frontNormal: targetFlange.frontNormal.clone(),
                        backNormal: targetFlange.backNormal ? targetFlange.backNormal.clone() : targetFlange.frontNormal.clone().negate(),
                        centroid: targetFlange.centroid.clone(),
                        area: targetFlange.area,
                        adjacentBendSectors: targetFlange.adjacentBendSectors || [],
                        isEdgeSelected: true,
                        selectedEdgeIndex: edgeIdx,
                        selectedEdge: (targetFlange.edgeRegions && targetFlange.edgeRegions[edgeIdx]) || targetFlange.edgeRegions[0]
                    };
                }

                if (objName.startsWith('FlangeBack')) {
                    return {
                        id: targetFlange.id,
                        flangeId: targetFlange.flangeId,
                        type: 'FLANGE',
                        frontFaces: [...targetFlange.backFaces],
                        backFaces: [...targetFlange.frontFaces],
                        edgeFaces: targetFlange.edgeFaces || [],
                        edgeRegions: targetFlange.edgeRegions || [],
                        cornerFaces: targetFlange.cornerFaces || [],
                        allFaces: targetFlange.allFaces || [],
                        frontNormal: targetFlange.backNormal ? targetFlange.backNormal.clone() : targetFlange.frontNormal.clone().negate(),
                        backNormal: targetFlange.frontNormal ? targetFlange.frontNormal.clone() : targetFlange.backNormal.clone().negate(),
                        centroid: targetFlange.centroid.clone(),
                        area: targetFlange.area,
                        adjacentBendSectors: targetFlange.adjacentBendSectors || [],
                        isBackFaceSelected: true
                    };
                }

                if (uData.faces && typeof selectedTarget.faceIndex === 'number') {
                    const origTri = uData.faces[selectedTarget.faceIndex];
                    if (origTri !== undefined) {
                        return FacetAnalyzer.resolveBaseFlange(mesh, origTri);
                    }
                }

                if (uData.flangeId !== undefined && targetFlange) {
                    return targetFlange;
                }
            }

            let faceIndex = 0;
            if (typeof selectedTarget === 'number') {
                faceIndex = selectedTarget;
            } else if (selectedTarget && typeof selectedTarget.faceIndex === 'number' && selectedTarget.object === mesh) {
                faceIndex = selectedTarget.faceIndex;
            } else if (selectedTarget && typeof selectedTarget.faceIndex === 'number' && !selectedTarget.object) {
                faceIndex = selectedTarget.faceIndex;
            } else if (selectedTarget && selectedTarget.point && mesh.geometry) {
                // Если клик пришелся на произвольную точку в пространстве, находим ближайший треугольник на mesh
                const localPt = mesh.worldToLocal(selectedTarget.point.clone());
                const posAttr = mesh.geometry.attributes.position;
                const indexAttr = mesh.geometry.index;
                const numTriangles = indexAttr ? (indexAttr.count / 3) : (posAttr.count / 3);
                let minDistSq = Infinity;
                let nearestTri = 0;
                const v0 = new THREE.Vector3();
                const v1 = new THREE.Vector3();
                const v2 = new THREE.Vector3();
                const cent = new THREE.Vector3();

                for (let t = 0; t < numTriangles; t++) {
                    const i0 = indexAttr ? indexAttr.getX(t * 3) : t * 3;
                    const i1 = indexAttr ? indexAttr.getX(t * 3 + 1) : t * 3 + 1;
                    const i2 = indexAttr ? indexAttr.getX(t * 3 + 2) : t * 3 + 2;
                    v0.fromBufferAttribute(posAttr, i0);
                    v1.fromBufferAttribute(posAttr, i1);
                    v2.fromBufferAttribute(posAttr, i2);
                    cent.addVectors(v0, v1).add(v2).divideScalar(3);
                    const dSq = cent.distanceToSquared(localPt);
                    if (dSq < minDistSq) {
                        minDistSq = dSq;
                        nearestTri = t;
                    }
                }
                faceIndex = nearestTri;
            }

            const facetMap = mesh.userData.facetMap;
            const facet = (facetMap && facetMap[faceIndex]) ? facetMap[faceIndex] : null;

            let targetFlangeId = null;

            if (facet) {
                // СЛУЧАЙ 1: Клик по широкой листовой грани (SHEET_FACE / FLANGE)
                if (facet.type === 'SHEET_FACE' || facet.facetType === 'FLANGE' || facet.isSheetFace) {
                    targetFlangeId = facet.flangeId !== null ? facet.flangeId : facet.parentFlangeId;
                }
                // СЛУЧАЙ 2: Клик по торцу или кромке толщины (THICKNESS_EDGE)
                else if (facet.type === 'THICKNESS_EDGE' || facet.isThicknessEdge || facet.facetType === 'THICKNESS_EDGE') {
                    targetFlangeId = facet.parentFlangeId;
                }
                // СЛУЧАЙ 3: Клик по криволинейной зоне гиба (BEND_CYLINDER / BEND_FACET)
                else if (facet.type === 'BEND_CYLINDER' || facet.isBend || facet.facetType === 'BEND_FACET_INNER' || facet.facetType === 'BEND_FACET_OUTER') {
                    if (facet.adjacentFlangeIds && facet.adjacentFlangeIds.length > 0) {
                        targetFlangeId = facet.adjacentFlangeIds[0];
                    } else if (facet.parentFlangeId !== null) {
                        targetFlangeId = facet.parentFlangeId;
                    }
                }
                // СЛУЧАЙ 4: Клик по боковому скосу или закрытому углу (BEND_CORNER_SIDE)
                else if (facet.type === 'BEND_CORNER_SIDE' || facet.facetType === 'BEND_CORNER_SIDE') {
                    if (facet.parentFlangeId !== null) {
                        targetFlangeId = facet.parentFlangeId;
                    } else if (facet.adjacentFlangeIds && facet.adjacentFlangeIds.length > 0) {
                        targetFlangeId = facet.adjacentFlangeIds[0];
                    }
                }
            }

            let targetFlange = null;
            if (targetFlangeId !== null && targetFlangeId !== undefined) {
                targetFlange = flanges.find(f => f.id === targetFlangeId || f.flangeId === targetFlangeId);
            }
            if (!targetFlange) {
                targetFlange = flanges[0];
            }

            if (targetFlange) {
                // Если клик пришелся на один из торцов (edgeRegions), передаем информацию о выбранном торце
                if (targetFlange.edgeRegions && targetFlange.edgeRegions.length > 0) {
                    let edgeIdx = targetFlange.edgeRegions.findIndex(eReg => eReg.faces.includes(faceIndex));
                    
                    // Если faceIndex не найден напрямую, но грань в edgeFaces или нормаль ортогональна
                    if (edgeIdx === -1) {
                        if (targetFlange.edgeFaces && targetFlange.edgeFaces.includes(faceIndex)) {
                            // Ищем ближайший edgeRegion по расстоянию центроида
                            const posAttr = mesh.geometry.attributes.position;
                            const indexAttr = mesh.geometry.index;
                            const i0 = indexAttr ? indexAttr.getX(faceIndex * 3) : faceIndex * 3;
                            const i1 = indexAttr ? indexAttr.getX(faceIndex * 3 + 1) : faceIndex * 3 + 1;
                            const i2 = indexAttr ? indexAttr.getX(faceIndex * 3 + 2) : faceIndex * 3 + 2;
                            const v0 = new THREE.Vector3().fromBufferAttribute(posAttr, i0);
                            const v1 = new THREE.Vector3().fromBufferAttribute(posAttr, i1);
                            const v2 = new THREE.Vector3().fromBufferAttribute(posAttr, i2);
                            const faceCent = new THREE.Vector3().addVectors(v0, v1).add(v2).divideScalar(3);

                            let minD = Infinity;
                            targetFlange.edgeRegions.forEach((er, idx) => {
                                const d = er.centroid.distanceTo(faceCent);
                                if (d < minD) {
                                    minD = d;
                                    edgeIdx = idx;
                                }
                            });
                        }
                    }

                    if (edgeIdx !== -1) {
                        return {
                            id: targetFlange.id,
                            flangeId: targetFlange.flangeId,
                            type: 'FLANGE',
                            frontFaces: [...targetFlange.frontFaces],
                            backFaces: [...targetFlange.backFaces],
                            edgeFaces: targetFlange.edgeFaces || [],
                            edgeRegions: targetFlange.edgeRegions || [],
                            cornerFaces: targetFlange.cornerFaces || [],
                            allFaces: targetFlange.allFaces || [],
                            frontNormal: targetFlange.frontNormal.clone(),
                            backNormal: targetFlange.backNormal ? targetFlange.backNormal.clone() : targetFlange.frontNormal.clone().negate(),
                            centroid: targetFlange.centroid.clone(),
                            area: targetFlange.area,
                            adjacentBendSectors: targetFlange.adjacentBendSectors || [],
                            isEdgeSelected: true,
                            selectedEdgeIndex: edgeIdx,
                            selectedEdge: targetFlange.edgeRegions[edgeIdx]
                        };
                    }
                }

                // Если клик пришелся на обратную грань (backFaces), инвертируем полку:
                // Выбранная тыльная грань становится базовой (frontFaces) со своей нормалью
                if (targetFlange.backFaces && targetFlange.backFaces.includes(faceIndex)) {
                    return {
                        id: targetFlange.id,
                        flangeId: targetFlange.flangeId,
                        type: 'FLANGE',
                        frontFaces: [...targetFlange.backFaces],
                        backFaces: [...targetFlange.frontFaces],
                        edgeFaces: targetFlange.edgeFaces || [],
                        edgeRegions: targetFlange.edgeRegions || [],
                        cornerFaces: targetFlange.cornerFaces || [],
                        allFaces: targetFlange.allFaces || [],
                        frontNormal: targetFlange.backNormal ? targetFlange.backNormal.clone() : targetFlange.frontNormal.clone().negate(),
                        backNormal: targetFlange.frontNormal ? targetFlange.frontNormal.clone() : targetFlange.backNormal.clone().negate(),
                        centroid: targetFlange.centroid.clone(),
                        area: targetFlange.area,
                        adjacentBendSectors: targetFlange.adjacentBendSectors || [],
                        isBackFaceSelected: true
                    };
                }

                return targetFlange;
            }

            // По умолчанию возвращаем полку с максимальной площадью (первую)
            return flanges[0];
        }

        /**
         * Временное окрашивание секторов по их типам для визуальной проверки
         * @param {THREE.Mesh} mesh 
         */
        static colorizeFacets(mesh) {
            if (!mesh) return;
            if (!mesh.userData || !mesh.userData.facets) {
                this.analyze(mesh);
            }
            if (!mesh.userData.facets) return;

            if (!mesh.userData._originalMaterial) {
                mesh.userData._originalMaterial = mesh.material;
            }

            const geometry = mesh.geometry;
            const posAttr = geometry.attributes.position;
            const colors = new Float32Array(posAttr.count * 3);
            
            // Цветовая палитра:
            // SHEET_FACE / FLANGE: Сине-голубой (#4A90E2)
            // THICKNESS_EDGE: Темно-серый (#34495E)
            // BEND_FACET_INNER: Ярко-зеленый (#2ECC71)
            // BEND_FACET_OUTER: Ярко-оранжевый (#E67E22)
            // BEND_CORNER_SIDE: Пурпурный (#9B59B6)
            const colorMap = {
                'FLANGE': new THREE.Color(0x4A90E2),
                'SHEET_FACE': new THREE.Color(0x4A90E2),
                'THICKNESS_EDGE': new THREE.Color(0x34495E),
                'BEND_FACET_INNER': new THREE.Color(0x2ECC71),
                'BEND_FACET_OUTER': new THREE.Color(0xE67E22),
                'BEND_CORNER_SIDE': new THREE.Color(0x9B59B6)
            };

            const indexAttr = geometry.index;
            const facetMap = mesh.userData.facetMap;

            if (facetMap) {
                facetMap.forEach((fData, triIdx) => {
                    const c = colorMap[fData.facetType] || colorMap[fData.type] || new THREE.Color(0xcccccc);
                    const i0 = indexAttr ? indexAttr.getX(triIdx * 3) : triIdx * 3;
                    const i1 = indexAttr ? indexAttr.getX(triIdx * 3 + 1) : triIdx * 3 + 1;
                    const i2 = indexAttr ? indexAttr.getX(triIdx * 3 + 2) : triIdx * 3 + 2;

                    [i0, i1, i2].forEach(vIdx => {
                        colors[vIdx * 3] = c.r;
                        colors[vIdx * 3 + 1] = c.g;
                        colors[vIdx * 3 + 2] = c.b;
                    });
                });
            }

            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            mesh.material = new THREE.MeshStandardMaterial({
                vertexColors: true,
                roughness: 0.4,
                metalness: 0.2,
                side: THREE.DoubleSide
            });
            mesh.material.needsUpdate = true;
            console.log('[FacetAnalyzer] Окрашивание секторов применено.');
        }

        /**
         * Сброс временного окрашивания и возврат оригинального материала
         * @param {THREE.Mesh} mesh 
         */
        static resetColorization(mesh) {
            if (mesh && mesh.userData && mesh.userData._originalMaterial) {
                mesh.material = mesh.userData._originalMaterial;
                delete mesh.userData._originalMaterial;
                if (mesh.geometry.attributes.color) {
                    mesh.geometry.deleteAttribute('color');
                }
                mesh.material.needsUpdate = true;
                console.log('[FacetAnalyzer] Возвращен исходный материал.');
            }
        }
    }

    /**
     * Глобальный резолвер родительской полки по объекту пересечения (для внешних вызовов)
     */
    function resolveBaseFlangeFromIntersection(intersect, mesh) {
        if (!mesh) return null;
        return FacetAnalyzer.resolveBaseFlange(mesh, intersect);
    }
    window.resolveBaseFlangeFromIntersection = resolveBaseFlangeFromIntersection;

    // Экспорт в глобальную область
    window.FacetAnalyzer = FacetAnalyzer;
})();

