/**
 * ============================================================================
 * ФАЙЛ: kinematic_tree_builder.js
 * НАЗНАЧЕНИЕ: Жесткая кинематическая система развертки 3D листовой детали
 *              по шарнирам (Kinematic Hinge Unfold Engine)
 * ============================================================================
 */

(function() {
    'use strict';

    class KinematicTreeBuilder {
        /**
         * Строит детерминированное дерево шарниров THREE.Group на основе BFS обхода графа полок.
         * Выбранная базовая полка (rootFlange) остается абсолютно неподвижной в корне rootGroup.
         * @param {THREE.Mesh} mesh Исходный меш детали
         * @param {number|object} selectedTarget Индекс грани, объект пересечения или ID базовой полки
         * @returns {THREE.Group} Корневая группа rootUnfoldGroup
         */
        static buildTree(mesh, selectedTarget = 0) {
            if (!mesh || !mesh.geometry) {
                console.error('[KinematicTreeBuilder] Некорректный mesh');
                return null;
            }

            // Гарантируем выполнение полного анализа геометрии
            if (!mesh.userData || !mesh.userData.facets || !mesh.userData.flanges || !mesh.userData.facetMap) {
                FacetAnalyzer.analyze(mesh);
            }

            const flanges = mesh.userData.flanges || [];
            const bends = mesh.userData.bends || [];
            const geometry = mesh.geometry;
            const posAttr = geometry.attributes.position;
            const indexAttr = geometry.index;

            // 1. Поиск базовой полки (Root Flange Resolver)
            const rootFlange = FacetAnalyzer.resolveBaseFlange(mesh, selectedTarget);
            if (!rootFlange) {
                console.error('[KinematicTreeBuilder] Не удалось определить базовую полку');
                return null;
            }

            console.log(`[KinematicTreeBuilder] Базовая неподвижная полка (F_root): ID ${rootFlange.id}, нормаль: (${rootFlange.frontNormal.x.toFixed(3)}, ${rootFlange.frontNormal.y.toFixed(3)}, ${rootFlange.frontNormal.z.toFixed(3)})`);

            // Хелпер: координаты 3 вершин треугольника по triIndex
            const getTriVertices = (triIdx) => {
                const i0 = indexAttr ? indexAttr.getX(triIdx * 3) : triIdx * 3;
                const i1 = indexAttr ? indexAttr.getX(triIdx * 3 + 1) : triIdx * 3 + 1;
                const i2 = indexAttr ? indexAttr.getX(triIdx * 3 + 2) : triIdx * 3 + 2;

                const v0 = new THREE.Vector3().fromBufferAttribute(posAttr, i0);
                const v1 = new THREE.Vector3().fromBufferAttribute(posAttr, i1);
                const v2 = new THREE.Vector3().fromBufferAttribute(posAttr, i2);
                return [v0, v1, v2];
            };

            // Хелпер: определение materialIndex треугольника
            const getMaterialIndex = (triIdx) => {
                if (!geometry.groups || geometry.groups.length === 0) return 0;
                const indexOffset = triIdx * 3;
                for (let i = 0; i < geometry.groups.length; i++) {
                    const g = geometry.groups[i];
                    if (indexOffset >= g.start && indexOffset < g.start + g.count) {
                        return g.materialIndex;
                    }
                }
                return 0;
            };

            // Хелпер: создание саб-меша из набора треугольников с центрированной геометрией
            const createSubMesh = (facesList, name, flangeId = null, sectorId = null) => {
                if (!facesList || facesList.length === 0) return null;

                const actualCentroid = new THREE.Vector3();
                let vertCount = 0;
                facesList.forEach(triIdx => {
                    const [v0, v1, v2] = getTriVertices(triIdx);
                    actualCentroid.add(v0).add(v1).add(v2);
                    vertCount += 3;
                });
                if (vertCount > 0) actualCentroid.divideScalar(vertCount);

                const subGeo = new THREE.BufferGeometry();
                const posArray = [];
                const normArray = [];
                const origNormAttr = geometry.attributes.normal;

                facesList.forEach(triIdx => {
                    const i0 = indexAttr ? indexAttr.getX(triIdx * 3) : triIdx * 3;
                    const i1 = indexAttr ? indexAttr.getX(triIdx * 3 + 1) : triIdx * 3 + 1;
                    const i2 = indexAttr ? indexAttr.getX(triIdx * 3 + 2) : triIdx * 3 + 2;

                    const [v0, v1, v2] = getTriVertices(triIdx);
                    // Вершины центрированы относительно собственного геометрического центра actualCentroid
                    posArray.push(
                        v0.x - actualCentroid.x, v0.y - actualCentroid.y, v0.z - actualCentroid.z,
                        v1.x - actualCentroid.x, v1.y - actualCentroid.y, v1.z - actualCentroid.z,
                        v2.x - actualCentroid.x, v2.y - actualCentroid.y, v2.z - actualCentroid.z
                    );

                    if (origNormAttr) {
                        normArray.push(
                            origNormAttr.getX(i0), origNormAttr.getY(i0), origNormAttr.getZ(i0),
                            origNormAttr.getX(i1), origNormAttr.getY(i1), origNormAttr.getZ(i1),
                            origNormAttr.getX(i2), origNormAttr.getY(i2), origNormAttr.getZ(i2)
                        );
                    }
                });

                subGeo.setAttribute('position', new THREE.Float32BufferAttribute(posArray, 3));
                if (normArray.length > 0) {
                    subGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normArray, 3));
                } else {
                    subGeo.computeVertexNormals();
                }

                subGeo.computeBoundingBox();

                // Полупрозрачный зеленый материал для развернутых поверхностей
                const subMat = new THREE.MeshStandardMaterial({
                    color: 0x22c55e,
                    transparent: true,
                    opacity: 0.65,
                    roughness: 0.35,
                    metalness: 0.1,
                    side: THREE.DoubleSide,
                    depthWrite: false
                });

                const subMesh = new THREE.Mesh(subGeo, subMat);
                subMesh.name = name;
                subMesh.castShadow = true;
                subMesh.receiveShadow = true;
                subMesh.userData = {
                    isSubMesh: true,
                    flangeId: flangeId,
                    sectorId: sectorId,
                    faces: facesList,
                    originalMesh: mesh,
                    worldCentroid: actualCentroid.clone(),
                    localCentroid: new THREE.Vector3(0, 0, 0),
                    defaultColor: 0x22c55e,
                    hoverColor: 0x14532d,
                    defaultOpacity: 0.65,
                    hoverOpacity: 0.92
                };
                return subMesh;
            };

            // Хелпер: нахождение линии стыка (Seam Line) между двумя наборами граней
            const getSeamLine = (facesA, facesB, fallbackNormalA, fallbackNormalB) => {
                if (!facesA || facesA.length === 0 || !facesB || facesB.length === 0) {
                    return {
                        pStart: new THREE.Vector3(),
                        pEnd: new THREE.Vector3(),
                        midPoint: new THREE.Vector3(),
                        axisDir: new THREE.Vector3(1, 0, 0),
                        points: []
                    };
                }

                const allPtsA = [];
                facesA.forEach(t => allPtsA.push(...getTriVertices(t)));
                const allPtsB = [];
                facesB.forEach(t => allPtsB.push(...getTriVertices(t)));

                const centA = new THREE.Vector3();
                allPtsA.forEach(p => centA.add(p));
                centA.divideScalar(allPtsA.length || 1);

                const centB = new THREE.Vector3();
                allPtsB.forEach(p => centB.add(p));
                centB.divideScalar(allPtsB.length || 1);

                const normA = (fallbackNormalA || new THREE.Vector3(0, 0, 1)).clone().normalize();
                const normB = (fallbackNormalB || new THREE.Vector3(0, 1, 0)).clone().normalize();

                const seamPts = [];
                const seenKeys = new Set();

                // 1. Поиск совпадающих граничных вершин между наборами граней
                for (const pa of allPtsA) {
                    for (const pb of allPtsB) {
                        if (pa.distanceTo(pb) < 1.5) {
                            const mid = pa.clone().add(pb).multiplyScalar(0.5);
                            const key = `${mid.x.toFixed(1)}_${mid.y.toFixed(1)}_${mid.z.toFixed(1)}`;
                            if (!seenKeys.has(key)) {
                                seenKeys.add(key);
                                seamPts.push(mid);
                            }
                        }
                    }
                }

                // 2. Если прямых совпадений мало, берем вершины грани B, лежащие в плоскости грани A
                if (seamPts.length < 2) {
                    for (const pb of allPtsB) {
                        const distToPlaneA = Math.abs(pb.clone().sub(centA).dot(normA));
                        if (distToPlaneA < 1.0) {
                            const key = `${pb.x.toFixed(1)}_${pb.y.toFixed(1)}_${pb.z.toFixed(1)}`;
                            if (!seenKeys.has(key)) {
                                seenKeys.add(key);
                                seamPts.push(pb.clone());
                            }
                        }
                    }
                }

                // Вычисляем граничные точки pStart, pEnd и midPoint
                let pStart = new THREE.Vector3();
                let pEnd = new THREE.Vector3();
                let midPoint = new THREE.Vector3();
                let maxDist = 0;

                if (seamPts.length >= 2) {
                    for (let i = 0; i < seamPts.length; i++) {
                        for (let j = i + 1; j < seamPts.length; j++) {
                            const d = seamPts[i].distanceTo(seamPts[j]);
                            if (d > maxDist) {
                                maxDist = d;
                                pStart.copy(seamPts[i]);
                                pEnd.copy(seamPts[j]);
                            }
                        }
                    }
                    seamPts.forEach(p => midPoint.add(p));
                    midPoint.divideScalar(seamPts.length);
                } else {
                    // Резервный расчет: проекция centB на плоскость грани A
                    const centBOnA = centB.clone().sub(normA.clone().multiplyScalar(centB.clone().sub(centA).dot(normA)));
                    midPoint.copy(centBOnA);

                    let axis = new THREE.Vector3().crossVectors(normA, normB).normalize();
                    if (axis.lengthSq() < 0.001) {
                        const toB = new THREE.Vector3().subVectors(centBOnA, centA).normalize();
                        axis = new THREE.Vector3().crossVectors(normA, toB).normalize();
                    }
                    if (axis.lengthSq() < 0.001) axis.set(1, 0, 0);

                    pStart.copy(midPoint).addScaledVector(axis, -25);
                    pEnd.copy(midPoint).addScaledVector(axis, 25);
                }

                // Гарантируем, что точка и ось стыка лежат строго в плоскости родительской грани (нулевое смещение по нормали)
                const distFromPlaneA = midPoint.clone().sub(centA).dot(normA);
                midPoint.sub(normA.clone().multiplyScalar(distFromPlaneA));
                pStart.sub(normA.clone().multiplyScalar(pStart.clone().sub(centA).dot(normA)));
                pEnd.sub(normA.clone().multiplyScalar(pEnd.clone().sub(centA).dot(normA)));

                let axisDir = new THREE.Vector3().subVectors(pEnd, pStart).normalize();
                if (axisDir.lengthSq() < 0.001) {
                    axisDir.set(1, 0, 0);
                }
                axisDir.sub(normA.clone().multiplyScalar(axisDir.dot(normA))).normalize();

                return {
                    pStart: pStart,
                    pEnd: pEnd,
                    midPoint: midPoint,
                    axisDir: axisDir,
                    points: seamPts
                };
            };

            // 2. Расчет кинематической трансформации шарнира (Rigid Vector Math)
            const calculateHingeTransform = (parentNormal, childNormal, seamLine, parentFaces, childFaces) => {
                const normP = parentNormal.clone().normalize();
                const normC = childNormal.clone().normalize();

                let axis = seamLine.axisDir.clone();
                axis.sub(normP.clone().multiplyScalar(axis.dot(normP))).normalize();
                if (axis.lengthSq() < 0.001) {
                    axis = new THREE.Vector3().crossVectors(normP, normC).normalize();
                }
                if (axis.lengthSq() < 0.001) {
                    axis = new THREE.Vector3(1, 0, 0);
                }

                const getCentroid = (faces) => {
                    if (!faces || faces.length === 0) return null;
                    const cent = new THREE.Vector3();
                    faces.forEach(t => {
                        const [v0, v1, v2] = getTriVertices(t);
                        cent.add(v0).add(v1).add(v2);
                    });
                    return cent.divideScalar(faces.length * 3);
                };

                const parentCentroid = getCentroid(parentFaces) || new THREE.Vector3(0, 0, 0);
                const childCentroid = getCentroid(childFaces) || seamLine.midPoint.clone().add(normC);

                // Вычисляем углы разворота, приводящие дочернюю грань в плоскость родителя
                const normC_perp = normC.clone().sub(axis.clone().multiplyScalar(normC.dot(axis))).normalize();
                const normP_perp = normP.clone().sub(axis.clone().multiplyScalar(normP.dot(axis))).normalize();

                const sinA = new THREE.Vector3().crossVectors(normC_perp, normP_perp).dot(axis);
                const cosA = THREE.MathUtils.clamp(normC_perp.dot(normP_perp), -1.0, 1.0);
                const theta1 = Math.atan2(sinA, cosA);
                const theta2 = theta1 > 0 ? (theta1 - Math.PI) : (theta1 + Math.PI);

                const candidates = [theta1, theta2, -theta1, -theta2, Math.PI - theta1, -(Math.PI - theta1)];
                let bestAngle = theta1;
                let bestScore = -Infinity;

                const rChild = new THREE.Vector3().subVectors(childCentroid, seamLine.midPoint);

                candidates.forEach(ang => {
                    const q = new THREE.Quaternion().setFromAxisAngle(axis, ang);
                    const testNorm = normC.clone().applyQuaternion(q);

                    // 1. Нормаль после разворота обязана быть строго параллельна родительской нормали
                    const absAlign = Math.abs(testNorm.dot(normP));
                    if (absAlign < 0.85) return;

                    let score = absAlign * 1000;

                    // 2. Центроид дочерней грани обязан лежать строго в плоскости родителя
                    const testChildCent = seamLine.midPoint.clone().add(rChild.clone().applyQuaternion(q));
                    const normOffset = Math.abs(testChildCent.clone().sub(seamLine.midPoint).dot(normP));
                    score -= normOffset * 50000;

                    // 3. Раскрытие должно быть направлено наружу от родителя
                    const distToParent = testChildCent.distanceTo(parentCentroid);
                    score += distToParent * 100;

                    if (score > bestScore) {
                        bestScore = score;
                        bestAngle = ang;
                    }
                });

                return {
                    axis: axis,
                    thetaBend: Math.abs(bestAngle),
                    targetAngle: bestAngle
                };
            };

            // Хелпер: расчет вектора раздвижки (Outward Direction) в плоскости грани
            const calcOutwardDir = (seamLine, regionFaces, regionNormal) => {
                const cent = new THREE.Vector3();
                if (regionFaces && regionFaces.length > 0) {
                    regionFaces.forEach(t => {
                        const [v0, v1, v2] = getTriVertices(t);
                        cent.add(v0).add(v1).add(v2);
                    });
                    cent.divideScalar(regionFaces.length * 3);
                }
                const toCent = new THREE.Vector3().subVectors(cent, seamLine.midPoint);
                const norm = regionNormal.clone().normalize();
                toCent.sub(norm.clone().multiplyScalar(toCent.dot(norm)));
                if (toCent.lengthSq() > 0.001) {
                    return toCent.normalize();
                }
                const axis = seamLine.axisDir.clone().normalize();
                let cross = new THREE.Vector3().crossVectors(norm, axis).normalize();
                if (cross.lengthSq() < 0.001) cross.set(1, 0, 0);
                return cross;
            };

            // 3. Создание корневой группы дерева
            const rootUnfoldGroup = new THREE.Group();
            rootUnfoldGroup.name = 'KinematicTree_Root';
            rootUnfoldGroup.userData = {
                isKinematicRoot: true,
                rootFlangeId: rootFlange.id,
                baseNormal: (rootFlange.isEdgeSelected && rootFlange.selectedEdge) ? rootFlange.selectedEdge.normal.clone() : rootFlange.frontNormal.clone(),
                baseCentroid: rootFlange.centroid.clone()
            };

            const allPivots = [];

            // Функция построения кинематических шарниров для всех поверхностей полки
            const buildFlangeSurfaces = (flange, parentNode, parentPivotWorldPos, parentNormal, baseDepth) => {
                const frontFaces = (flange.frontFaces && flange.frontFaces.length > 0) ? flange.frontFaces : (flange.faces || flange.allFaces);
                const backFaces = flange.backFaces;
                const edgeRegions = flange.edgeRegions || [];

                // СЛУЧАЙ А: Пользователь выбрал ТОЧНЫЙ ТОРЕЦ (Кромку толщины) в качестве базовой плоскости
                if (flange.isEdgeSelected && flange.selectedEdge) {
                    const selEdge = flange.selectedEdge;
                    const selEdgeFaces = selEdge.faces;
                    const selEdgeNormal = selEdge.normal.clone();

                    // 1. Выбранный торец размещается непосредственно в базовом родительском узле (неподвижен)
                    const baseEdgeMesh = createSubMesh(selEdgeFaces, `BaseEdge_${flange.id}`, flange.id, null);
                    if (baseEdgeMesh) {
                        baseEdgeMesh.position.subVectors(baseEdgeMesh.userData.worldCentroid, parentPivotWorldPos);
                        baseEdgeMesh.userData.basePosition = baseEdgeMesh.position.clone();
                        baseEdgeMesh.userData.outwardDir = new THREE.Vector3(0, 0, 0);
                        baseEdgeMesh.userData.isBaseMesh = (parentNode === rootUnfoldGroup);
                        parentNode.add(baseEdgeMesh);
                    }

                    // 2. Лицевая пласть (frontFaces) крепится к выбранному торцу
                    const seamFront = getSeamLine(selEdgeFaces, frontFaces, selEdgeNormal, flange.frontNormal);
                    const hingeFront = calculateHingeTransform(selEdgeNormal, flange.frontNormal, seamFront, selEdgeFaces, frontFaces);
                    const outDirFront = calcOutwardDir(seamFront, frontFaces, selEdgeNormal);

                    const pivotFront = new THREE.Group();
                    pivotFront.name = `Hinge_EdgeToFront_${flange.id}`;
                    pivotFront.position.subVectors(seamFront.midPoint, parentPivotWorldPos);
                    pivotFront.userData = {
                        isHingePivot: true,
                        hinge: {
                            axis: hingeFront.axis.clone(),
                            targetAngle: hingeFront.targetAngle,
                            thetaBend: hingeFront.thetaBend,
                            seamPoint: seamFront.midPoint.clone(),
                            flangeId: flange.id,
                            depth: baseDepth,
                            localProgressOffset: baseDepth * 0.2,
                            basePosition: pivotFront.position.clone(),
                            outwardDir: outDirFront.clone(),
                            gapVector: outDirFront.clone()
                        }
                    };

                    const frontMesh = createSubMesh(frontFaces, `FlangeFront_${flange.id}`, flange.id, null);
                    if (frontMesh) {
                        frontMesh.position.subVectors(frontMesh.userData.worldCentroid, seamFront.midPoint);
                        frontMesh.userData.basePosition = frontMesh.position.clone();
                        frontMesh.userData.outwardDir = outDirFront.clone();
                        pivotFront.add(frontMesh);
                    }

                    // К лицевой пласти прикрепляем все ОСТАЛЬНЫЕ торцы кромки (кроме выбранного базового)
                    const otherEdges = edgeRegions.filter((_, idx) => idx !== flange.selectedEdgeIndex);
                    otherEdges.forEach((eReg, oIdx) => {
                        const seamEdge = getSeamLine(frontFaces, eReg.faces, flange.frontNormal, eReg.normal);
                        const hingeEdge = calculateHingeTransform(flange.frontNormal, eReg.normal, seamEdge, frontFaces, eReg.faces);
                        const outDirEdge = calcOutwardDir(seamEdge, eReg.faces, flange.frontNormal);

                        const pivotEdge = new THREE.Group();
                        pivotEdge.name = `Hinge_FrontToEdge_${flange.id}_${oIdx}`;
                        pivotEdge.position.subVectors(seamEdge.midPoint, seamFront.midPoint);
                        pivotEdge.userData = {
                            isHingePivot: true,
                            hinge: {
                                axis: hingeEdge.axis.clone(),
                                targetAngle: hingeEdge.targetAngle,
                                thetaBend: hingeEdge.thetaBend,
                                seamPoint: seamEdge.midPoint.clone(),
                                flangeId: flange.id,
                                depth: baseDepth + 1,
                                localProgressOffset: (baseDepth + 1) * 0.2,
                                basePosition: pivotEdge.position.clone(),
                                outwardDir: outDirEdge.clone(),
                                gapVector: outDirEdge.clone()
                            }
                        };

                        const edgeMesh = createSubMesh(eReg.faces, `EdgeMesh_${flange.id}_${oIdx}`, flange.id, null);
                        if (edgeMesh) {
                            edgeMesh.position.subVectors(edgeMesh.userData.worldCentroid, seamEdge.midPoint);
                            edgeMesh.userData.basePosition = edgeMesh.position.clone();
                            edgeMesh.userData.outwardDir = outDirEdge.clone();
                            pivotEdge.add(edgeMesh);
                        }

                        pivotFront.add(pivotEdge);
                        allPivots.push(pivotEdge);
                    });

                    parentNode.add(pivotFront);
                    allPivots.push(pivotFront);

                    // 3. Тыльная пласть (backFaces) крепится к выбранному торцу со второй стороны
                    if (backFaces && backFaces.length > 0) {
                        const seamBack = getSeamLine(selEdgeFaces, backFaces, selEdgeNormal, flange.backNormal);
                        const hingeBack = calculateHingeTransform(selEdgeNormal, flange.backNormal, seamBack, selEdgeFaces, backFaces);
                        const outDirBack = calcOutwardDir(seamBack, backFaces, selEdgeNormal);

                        const pivotBack = new THREE.Group();
                        pivotBack.name = `Hinge_EdgeToBack_${flange.id}`;
                        pivotBack.position.subVectors(seamBack.midPoint, parentPivotWorldPos);
                        pivotBack.userData = {
                            isHingePivot: true,
                            hinge: {
                                axis: hingeBack.axis.clone(),
                                targetAngle: hingeBack.targetAngle,
                                thetaBend: hingeBack.thetaBend,
                                seamPoint: seamBack.midPoint.clone(),
                                flangeId: flange.id,
                                depth: baseDepth,
                                localProgressOffset: baseDepth * 0.2,
                                basePosition: pivotBack.position.clone(),
                                outwardDir: outDirBack.clone(),
                                gapVector: outDirBack.clone()
                            }
                        };

                        const backMesh = createSubMesh(backFaces, `FlangeBack_${flange.id}`, flange.id, null);
                        if (backMesh) {
                            backMesh.position.subVectors(backMesh.userData.worldCentroid, seamBack.midPoint);
                            backMesh.userData.basePosition = backMesh.position.clone();
                            backMesh.userData.outwardDir = outDirBack.clone();
                            pivotBack.add(backMesh);
                        }

                        parentNode.add(pivotBack);
                        allPivots.push(pivotBack);
                    }

                    return;
                }

                // СЛУЧАЙ Б: Выбрана широкая ПЛАСТЬ (Лицевая или тыльная)
                // 1. Базовая пласть полки крепится к родительскому узлу
                const frontMesh = createSubMesh(frontFaces, `FlangeFront_${flange.id}`, flange.id, null);
                if (frontMesh) {
                    frontMesh.position.subVectors(frontMesh.userData.worldCentroid, parentPivotWorldPos);
                    frontMesh.userData.basePosition = frontMesh.position.clone();
                    frontMesh.userData.outwardDir = new THREE.Vector3(0, 0, 0);
                    frontMesh.userData.isBaseMesh = (parentNode === rootUnfoldGroup);
                    parentNode.add(frontMesh);
                }

                // 2. Торцы толщины (edgeRegions) раскрываются по шарнирам на кромках базовой пласти
                const createdEdgePivots = [];

                edgeRegions.forEach((eReg, eIdx) => {
                    const seamLine = getSeamLine(frontFaces, eReg.faces, parentNormal, eReg.normal);
                    const hingeData = calculateHingeTransform(parentNormal, eReg.normal, seamLine, frontFaces, eReg.faces);
                    const outDirEdge = calcOutwardDir(seamLine, eReg.faces, parentNormal);

                    const pivotEdge = new THREE.Group();
                    pivotEdge.name = `Hinge_Flange${flange.id}_Edge_${eIdx}`;
                    pivotEdge.position.subVectors(seamLine.midPoint, parentPivotWorldPos);

                    pivotEdge.userData = {
                        isHingePivot: true,
                        hinge: {
                            axis: hingeData.axis.clone(),
                            targetAngle: hingeData.targetAngle,
                            thetaBend: hingeData.thetaBend,
                            seamPoint: seamLine.midPoint.clone(),
                            flangeId: flange.id,
                            edgeIdx: eIdx,
                            depth: baseDepth,
                            localProgressOffset: baseDepth * 0.2,
                            basePosition: pivotEdge.position.clone(),
                            outwardDir: outDirEdge.clone(),
                            gapVector: outDirEdge.clone()
                        }
                    };

                    const edgeMesh = createSubMesh(eReg.faces, `EdgeMesh_${flange.id}_${eIdx}`, flange.id, null);
                    if (edgeMesh) {
                        edgeMesh.position.subVectors(edgeMesh.userData.worldCentroid, seamLine.midPoint);
                        edgeMesh.userData.basePosition = edgeMesh.position.clone();
                        edgeMesh.userData.outwardDir = outDirEdge.clone();
                        pivotEdge.add(edgeMesh);
                    }

                    parentNode.add(pivotEdge);
                    allPivots.push(pivotEdge);

                    createdEdgePivots.push({
                        pivot: pivotEdge,
                        region: eReg,
                        seamLine: seamLine,
                        idx: eIdx,
                        outwardDir: outDirEdge
                    });
                });

                // 3. Обратная пласть полки (backFaces) — прикрепляется к наиболее длинному торцу и раскрывается относительно него
                if (backFaces && backFaces.length > 0) {
                    if (createdEdgePivots.length > 0) {
                        let primaryEdge = createdEdgePivots[0];
                        let maxSeamLen = 0;
                        createdEdgePivots.forEach(ep => {
                            const len = ep.seamLine.pStart.distanceTo(ep.seamLine.pEnd);
                            if (len > maxSeamLen) {
                                maxSeamLen = len;
                                primaryEdge = ep;
                            }
                        });

                        const seamBack = getSeamLine(primaryEdge.region.faces, backFaces, primaryEdge.region.normal, flange.backNormal);
                        const hingeDataBack = calculateHingeTransform(primaryEdge.region.normal, flange.backNormal, seamBack, primaryEdge.region.faces, backFaces);
                        const outDirBack = calcOutwardDir(seamBack, backFaces, primaryEdge.region.normal);

                        const pivotBack = new THREE.Group();
                        pivotBack.name = `Hinge_Flange${flange.id}_BackPlate`;
                        pivotBack.position.subVectors(seamBack.midPoint, primaryEdge.seamLine.midPoint);

                        pivotBack.userData = {
                            isHingePivot: true,
                            hinge: {
                                axis: hingeDataBack.axis.clone(),
                                targetAngle: hingeDataBack.targetAngle,
                                thetaBend: hingeDataBack.thetaBend,
                                seamPoint: seamBack.midPoint.clone(),
                                flangeId: flange.id,
                                depth: baseDepth + 1,
                                localProgressOffset: (baseDepth + 1) * 0.2,
                                basePosition: pivotBack.position.clone(),
                                outwardDir: outDirBack.clone(),
                                gapVector: outDirBack.clone()
                            }
                        };

                        const backMesh = createSubMesh(backFaces, `FlangeBack_${flange.id}`, flange.id, null);
                        if (backMesh) {
                            backMesh.position.subVectors(backMesh.userData.worldCentroid, seamBack.midPoint);
                            backMesh.userData.basePosition = backMesh.position.clone();
                            backMesh.userData.outwardDir = outDirBack.clone();
                            pivotBack.add(backMesh);
                        }

                        primaryEdge.pivot.add(pivotBack);
                        allPivots.push(pivotBack);
                    } else {
                        const backMesh = createSubMesh(backFaces, `FlangeBack_Direct_${flange.id}`, flange.id, null);
                        if (backMesh) {
                            backMesh.position.subVectors(backMesh.userData.worldCentroid, parentPivotWorldPos);
                            backMesh.userData.basePosition = backMesh.position.clone();
                            backMesh.userData.outwardDir = new THREE.Vector3(0, 0, 0);
                            parentNode.add(backMesh);
                        }
                    }
                }
            };

            // 4. Построение дерева поверхностей для базовой неподвижной полки F_root
            const rootBaseNormal = (rootFlange.isEdgeSelected && rootFlange.selectedEdge) ? rootFlange.selectedEdge.normal.clone() : rootFlange.frontNormal.clone();
            buildFlangeSurfaces(rootFlange, rootUnfoldGroup, new THREE.Vector3(0, 0, 0), rootBaseNormal, 1);

            // 5. Построение дерева шарниров волновым алгоритмом (BFS Traversal) для многополочных деталей с гибами
            const visitedFlanges = new Set([rootFlange.id]);
            const visitedBends = new Set();

            const queue = [{
                flange: rootFlange,
                scenegraphNode: rootUnfoldGroup,
                pivotWorldPos: new THREE.Vector3(0, 0, 0),
                currentNormal: rootBaseNormal.clone(),
                depth: 0
            }];

            while (queue.length > 0) {
                const current = queue.shift();
                const parentFlange = current.flange;
                const parentNode = current.scenegraphNode;
                const parentPivotPos = current.pivotWorldPos;
                const parentNormal = current.currentNormal;
                const depth = current.depth;

                // Ищем смежные секторы гибов
                const adjSectors = parentFlange.adjacentBendSectors || [];

                bends.forEach(bend => {
                    const bId = bend.sectorId;
                    if (visitedBends.has(bId)) return;

                    // Проверяем соединение гиба с родительской полкой
                    const isDirectAdj = adjSectors.includes(bId) || (bend.adjacentFlangeIds && bend.adjacentFlangeIds.includes(parentFlange.id));
                    if (!isDirectAdj) return;

                    // Находим смежную дочернюю полку для этого гиба
                    const childFlangeId = bend.adjacentFlangeIds ? bend.adjacentFlangeIds.find(id => id !== parentFlange.id && !visitedFlanges.has(id)) : null;
                    const childFlange = childFlangeId !== null && childFlangeId !== undefined ? flanges.find(f => f.id === childFlangeId) : null;

                    if (!childFlange || visitedFlanges.has(childFlange.id)) return;

                    visitedBends.add(bId);
                    visitedFlanges.add(childFlange.id);

                    // 1. Находим 3D-линию стыка между родительской полкой и зоной гиба
                    const seamLine = getSeamLine(
                        parentFlange.frontFaces || parentFlange.faces,
                        bend.allFaces || bend.innerFaces,
                        parentNormal,
                        childFlange.frontNormal
                    );

                    const hingeData = calculateHingeTransform(parentNormal, childFlange.frontNormal, seamLine, parentFlange.frontFaces || parentFlange.faces, childFlange.frontFaces || childFlange.faces);
                    const outDirBend = calcOutwardDir(seamLine, childFlange.frontFaces || childFlange.faces, parentNormal);

                    // 2. Создаем шарнир (Pivot Group) точно на линии стыка
                    const pivotGroup = new THREE.Group();
                    pivotGroup.name = `Hinge_Flange${parentFlange.id}_to_Flange${childFlange.id}_Sec${bId}`;
                    
                    // Позиция шарнира относительно родительского пивота
                    pivotGroup.position.subVectors(seamLine.midPoint, parentPivotPos);

                    // Метаданные шарнира для анимационного контроллера
                    const localProgressOffset = depth * 0.25;
                    pivotGroup.userData = {
                        isHingePivot: true,
                        hinge: {
                            axis: hingeData.axis.clone(),
                            targetAngle: hingeData.targetAngle,
                            thetaBend: hingeData.thetaBend,
                            seamPoint: seamLine.midPoint.clone(),
                            parentFlangeId: parentFlange.id,
                            childFlangeId: childFlange.id,
                            sectorId: bId,
                            depth: depth,
                            localProgressOffset: localProgressOffset,
                            basePosition: pivotGroup.position.clone(),
                            outwardDir: outDirBend.clone(),
                            gapVector: outDirBend.clone()
                        }
                    };

                    allPivots.push(pivotGroup);

                    // 3. Вкладываем геометрию зоны гиба внутрь шарнира со смещением относительно линии стыка
                    if (bend.allFaces && bend.allFaces.length > 0) {
                        const bendSubMesh = createSubMesh(bend.allFaces, `BendMesh_Sec${bId}`, null, bId);
                        if (bendSubMesh) {
                            bendSubMesh.position.subVectors(bendSubMesh.userData.worldCentroid, seamLine.midPoint);
                            bendSubMesh.userData.basePosition = bendSubMesh.position.clone();
                            bendSubMesh.userData.outwardDir = outDirBend.clone();
                            pivotGroup.add(bendSubMesh);
                        }
                    }

                    // 4. Построение всех поверхностей дочерней полки внутри шарнира
                    buildFlangeSurfaces(childFlange, pivotGroup, seamLine.midPoint, childFlange.frontNormal, depth + 1);

                    // 5. Вкладываем шарнир в родительский узел дерева
                    parentNode.add(pivotGroup);

                    // 6. Добавляем дочернюю полку в очередь BFS для дальнейшего раскрытия ветки
                    queue.push({
                        flange: childFlange,
                        scenegraphNode: pivotGroup,
                        pivotWorldPos: seamLine.midPoint,
                        currentNormal: childFlange.frontNormal.clone(),
                        depth: depth + 1
                    });
                });
            }

            // Fallback: Если остались непосещенные полки (например, плоские составные без дуги гиба)
            flanges.filter(f => !visitedFlanges.has(f.id)).forEach(orphanFlange => {
                buildFlangeSurfaces(orphanFlange, rootUnfoldGroup, new THREE.Vector3(0, 0, 0), orphanFlange.frontNormal, 1);
            });

            rootUnfoldGroup.userData.allPivots = allPivots;
            rootUnfoldGroup.userData.treeSummary = {
                rootFlangeId: rootFlange.id,
                totalPivots: allPivots.length,
                totalFlanges: flanges.length,
                totalBends: bends.length
            };

            console.log(`[KinematicTreeBuilder] Кинематическое дерево успешно построено: ${allPivots.length} шарниров, корень F_${rootFlange.id}`);
            return rootUnfoldGroup;
        }
    }

    // Экспорт в глобальную область
    window.KinematicTreeBuilder = KinematicTreeBuilder;
})();
