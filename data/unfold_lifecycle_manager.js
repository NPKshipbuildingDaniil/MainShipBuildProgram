/**
 * ============================================================================
 * ФАЙЛ: unfold_lifecycle_manager.js
 * НАЗНАЧЕНИЕ: Интеграция с UI, Сброс и Управление Памятью (Lifecycle Engine)
 * БЛОК 5: Жизненный цикл развертки (enableUnfold / disableUnfold), UI панель,
 *         обработка клавиши Esc, сброс структуры и полное удаление VRAM ресурсов.
 * ============================================================================
 */

(function() {
    'use strict';

    class UnfoldLifecycleManager {
        constructor() {
            this.activeMesh = null;
            this.rootGroup = null;
            this.controller = null;
            this.visualizer = null;
            this.isActive = false;
            this.uiContainer = null;
            this.escListener = null;
            this.interpolationMarkerGroup = null;
            this.pointInfoHUD = null;

            // Кэш памяти перед стартом для проверки renderer.info.memory
            this.initialMemoryGeometries = 0;
        }

        /**
         * Включает режим развертки для указанного THREE.Mesh
         * @param {THREE.Mesh} mesh Исходная деталь
         * @param {number} baseFaceIndex Индекс базовой грани (Root Base)
         */
        enableUnfold(mesh, baseFaceIndex = 0) {
            if (this.isActive) {
                this.disableUnfold();
            }

            if (!mesh || !mesh.geometry) {
                console.error('[UnfoldLifecycleManager] Некорректный Mesh для развертки');
                if (typeof showToast === 'function') showToast('Ошибка: Выберите деталь для развертки');
                return false;
            }

            if (window.isProfileObject && window.isProfileObject(mesh)) {
                if (typeof showToast === 'function') showToast("Команда 'Развернуть' недоступна для профильного проката.");
                return false;
            }

            const renderer = window.creatorRenderer || window.renderer;
            if (renderer && renderer.info) {
                this.initialMemoryGeometries = renderer.info.memory.geometries;
                console.log(`[UnfoldLifecycleManager] Память перед запуском (Geometries): ${this.initialMemoryGeometries}`);
            }

            this.activeMesh = mesh;

            // 1. Анализ граней (БЛОК 1)
            FacetAnalyzer.analyze(mesh);

            // 2. Построение дерева пивотов (БЛОК 2)
            this.rootGroup = KinematicTreeBuilder.buildTree(mesh, baseFaceIndex);
            if (!this.rootGroup) {
                console.error('[UnfoldLifecycleManager] Не удалось построить дерево пивотов');
                return false;
            }

            // Подъем поверхностей развертки над базовой плоскостью детали (Elevation Offset)
            // чтобы поверхности раскрытия не накладывались на базовую поверхность исходной 3D детали
            const baseNormal = (this.rootGroup.userData && this.rootGroup.userData.baseNormal)
                ? this.rootGroup.userData.baseNormal.clone()
                : new THREE.Vector3(0, 1, 0);

            const elevationDistance = 35.0; // 35 мм подъем над исходной базовой гранью
            const worldBaseNormal = baseNormal.clone().applyQuaternion(mesh.quaternion).normalize();
            const elevationOffset = worldBaseNormal.multiplyScalar(elevationDistance);

            this.rootGroup.position.copy(mesh.position).add(elevationOffset);
            this.rootGroup.quaternion.copy(mesh.quaternion);
            this.rootGroup.scale.copy(mesh.scale);
            this.rootGroup.userData.elevationOffset = elevationOffset;
            this.rootGroup.updateMatrixWorld(true);

            // Сохраняем оригинальный side материала активного mesh для 100% восстановления при выходе
            if (!mesh.userData._originalSide) {
                if (Array.isArray(mesh.material)) {
                    mesh.userData._originalSide = mesh.material.map(m => m ? m.side : THREE.FrontSide);
                } else if (mesh.material) {
                    mesh.userData._originalSide = mesh.material.side;
                }
            }

            // Убеждаемся, что subMesh получают корректное двустороннее освещение с сохранением цвета
            if (Array.isArray(mesh.material)) {
                mesh.material.forEach(m => { if (m) { m.side = THREE.DoubleSide; m.needsUpdate = true; } });
            } else if (mesh.material) {
                mesh.material.side = THREE.DoubleSide;
                mesh.material.needsUpdate = true;
            }

            // Помещаем rootGroup в сцену и сохраняем видимость оригинального 3D тела (mesh.visible = true)
            const targetScene = mesh.parent || window.creatorScene || window.scene;
            if (targetScene) {
                targetScene.add(this.rootGroup);
            }
            mesh.visible = true;

            // 3. Инициализация анимационного контроллера (БЛОК 3)
            this.controller = new UnfoldAnimationController(this.rootGroup);

            // 4. Инициализация визуализатора гибов и штрихпунктиров (БЛОК 4)
            this.visualizer = new BendVisualizer(this.rootGroup);

            this.isActive = true;

            // 5. Подключение обработчика Esc и интерактивного взаимодействия (Hover / Point Interpolation)
            // Окно анимации удалено по запросу пользователя.
            this._bindEscKey();
            this._bindHoverInteraction();

            // Автоматический плавный запуск развертки от 0.0 до 1.0 (700 мс)
            if (this.controller && typeof this.controller.animateTo === 'function') {
                this.controller.animateTo(1.0, 700);
            }

            console.log('[UnfoldLifecycleManager] Режим развертки успешно включен. Исходное 3D тело сохранено.');
            if (typeof showToast === 'function') showToast('Развертка выполнена. Кликните по поверхности для интерполяции точки на 3D модель (Esc для выхода)');
            return true;
        }

        /**
         * Выключает режим развертки, возвращает деталь в исходный вид и полностью очищает VRAM
         */
        disableUnfold() {
            if (!this.isActive) return;

            console.log('[UnfoldLifecycleManager] Выключение режима развертки и очистка VRAM...');

            // 1. Удаление маркеров интерполяции, HUD, обработчика Esc и слушателей Hover
            this.clearInterpolationMarkers();
            this._removePointInfoHUD();
            this._removeUI();
            this._unbindEscKey();
            this._unbindHoverInteraction();

            // 2. Сброс анимации к T = 0.0
            if (this.controller) {
                this.controller.update(0.0);
            }

            // 3. Сброс визуализатора
            if (this.visualizer) {
                this.visualizer.dispose();
            }

            // 4. Возврат оригинального mesh и его свойств материала
            if (this.activeMesh) {
                this.activeMesh.visible = true;

                if (this.activeMesh.geometry && this.activeMesh.geometry.attributes.color) {
                    this.activeMesh.geometry.deleteAttribute('color');
                }

                if (this.activeMesh.userData._originalSide !== undefined) {
                    if (Array.isArray(this.activeMesh.material)) {
                        this.activeMesh.material.forEach((m, idx) => {
                            if (m) {
                                m.side = this.activeMesh.userData._originalSide[idx];
                                m.needsUpdate = true;
                            }
                        });
                    } else if (this.activeMesh.material) {
                        this.activeMesh.material.side = this.activeMesh.userData._originalSide;
                        this.activeMesh.material.needsUpdate = true;
                    }
                    delete this.activeMesh.userData._originalSide;
                }

                if (this.activeMesh.material) {
                    const matList = Array.isArray(this.activeMesh.material) ? this.activeMesh.material : [this.activeMesh.material];
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
                            m.needsUpdate = true;
                        }
                    });
                }
            }

            // 5. Удаление rootGroup из сцены
            if (this.rootGroup) {
                if (this.rootGroup.parent) {
                    this.rootGroup.parent.remove(this.rootGroup);
                }

                // 6. Безопасный Протокол Уничтожения Ресурсов VRAM (Dispose Protocol)
                this._disposeUnfoldResources(this.rootGroup);
                this.rootGroup = null;
            }

            this.controller = null;
            this.visualizer = null;
            this.activeMesh = null;
            this.isActive = false;

            // 7. Проверка памяти renderer.info.memory
            const renderer = window.creatorRenderer || window.renderer;
            if (renderer && renderer.info) {
                const currentMemoryGeometries = renderer.info.memory.geometries;
                console.log(`[UnfoldLifecycleManager] Память после выключения (Geometries): ${currentMemoryGeometries} (Было: ${this.initialMemoryGeometries})`);
            }

            if (typeof showToast === 'function') showToast('Развертка закрыта, модель возвращена в исходный вид');
        }

        /**
         * Протокол уничтожения поддерева и освобождения WebGL VRAM
         * @private
         * @param {THREE.Object3D} object 
         */
        _disposeUnfoldResources(object) {
            if (!object) return;

            object.traverse((node) => {
                if (node.isMesh || node.isLine) {
                    if (node.geometry) {
                        node.geometry.dispose();
                    }
                    if (node.isLine && node.material) {
                        if (Array.isArray(node.material)) {
                            node.material.forEach(m => { if (m && typeof m.dispose === 'function') m.dispose(); });
                        } else if (typeof node.material.dispose === 'function') {
                            node.material.dispose();
                        }
                    }
                }
            });
        }

        /**
         * Удаление UI-панели (если была создана)
         * @private
         */
        _removeUI() {
            if (this.uiContainer && this.uiContainer.parentNode) {
                this.uiContainer.parentNode.removeChild(this.uiContainer);
                this.uiContainer = null;
            }
        }

        /**
         * Точная барицентрическая интерполяция точки с развертки на исходную 3D модель
         * @param {THREE.Mesh} subMesh Саб-меш развертки
         * @param {THREE.Vector3} worldHitPoint Точка клика в мировых координатах
         * @param {number} subFaceIndex Индекс треугольника в геометрии саб-меша
         * @param {Object} [hitFace=null] Объект грани из raycaster hit
         * @returns {Object|null} Данные интерполяции
         */
        interpolateUnfoldedToOriginal(subMesh, worldHitPoint, subFaceIndex, hitFace = null) {
            if (!subMesh || !this.activeMesh || !subMesh.userData || !subMesh.userData.faces) return null;

            const origFaces = subMesh.userData.faces;
            if (origFaces.length === 0) return null;

            let faceIdx = subFaceIndex;
            if (faceIdx === undefined || faceIdx === null || faceIdx < 0 || faceIdx >= origFaces.length) {
                if (hitFace && hitFace.a !== undefined) {
                    faceIdx = Math.floor(hitFace.a / 3);
                } else {
                    faceIdx = 0;
                }
            }
            faceIdx = Math.max(0, Math.min(faceIdx, origFaces.length - 1));

            const origTriIndex = origFaces[faceIdx];
            const subGeo = subMesh.geometry;
            const origGeo = this.activeMesh.geometry;
            if (!subGeo || !origGeo) return null;

            // 1. Точка клика в локальных координатах саб-меша
            const pLocalSub = subMesh.worldToLocal(worldHitPoint.clone());

            // 2. Вершины треугольника саб-меша в его локальных координатах
            const subPos = subGeo.attributes.position;
            const subIndex = subGeo.index;
            let i0Sub, i1Sub, i2Sub;
            if (subIndex) {
                i0Sub = subIndex.getX(faceIdx * 3);
                i1Sub = subIndex.getX(faceIdx * 3 + 1);
                i2Sub = subIndex.getX(faceIdx * 3 + 2);
            } else if (hitFace && hitFace.a !== undefined) {
                i0Sub = hitFace.a;
                i1Sub = hitFace.b;
                i2Sub = hitFace.c;
            } else {
                i0Sub = faceIdx * 3;
                i1Sub = faceIdx * 3 + 1;
                i2Sub = faceIdx * 3 + 2;
            }

            const sA = new THREE.Vector3().fromBufferAttribute(subPos, i0Sub);
            const sB = new THREE.Vector3().fromBufferAttribute(subPos, i1Sub);
            const sC = new THREE.Vector3().fromBufferAttribute(subPos, i2Sub);

            // 3. Вычисление барицентрических координат (u, v, w)
            const v0 = new THREE.Vector3().subVectors(sB, sA);
            const v1 = new THREE.Vector3().subVectors(sC, sA);
            const v2 = new THREE.Vector3().subVectors(pLocalSub, sA);

            const d00 = v0.dot(v0);
            const d01 = v0.dot(v1);
            const d11 = v1.dot(v1);
            const d20 = v2.dot(v0);
            const d21 = v2.dot(v1);

            const denom = d00 * d11 - d01 * d01;
            let u, v, w;
            if (Math.abs(denom) < 1e-12) {
                u = 1 / 3; v = 1 / 3; w = 1 / 3;
            } else {
                v = (d11 * d20 - d01 * d21) / denom;
                w = (d00 * d21 - d01 * d20) / denom;
                u = 1.0 - v - w;
            }

            // Ограничиваем веса пределами [0, 1] и нормализуем сумму
            u = Math.max(0, Math.min(1, u));
            v = Math.max(0, Math.min(1, v));
            w = Math.max(0, Math.min(1, w));
            const sum = u + v + w;
            if (sum > 0.0001) {
                u /= sum; v /= sum; w /= sum;
            }

            // 4. Вершины исходного треугольника на 3D модели
            const origPos = origGeo.attributes.position;
            const origIndex = origGeo.index;
            const i0Orig = origIndex ? origIndex.getX(origTriIndex * 3) : origTriIndex * 3;
            const i1Orig = origIndex ? origIndex.getX(origTriIndex * 3 + 1) : origTriIndex * 3 + 1;
            const i2Orig = origIndex ? origIndex.getX(origTriIndex * 3 + 2) : origTriIndex * 3 + 2;

            const oA = new THREE.Vector3().fromBufferAttribute(origPos, i0Orig);
            const oB = new THREE.Vector3().fromBufferAttribute(origPos, i1Orig);
            const oC = new THREE.Vector3().fromBufferAttribute(origPos, i2Orig);

            // 5. Интерполяция точки в локальных координатах исходной детали
            const origLocalPoint = new THREE.Vector3()
                .addScaledVector(oA, u)
                .addScaledVector(oB, v)
                .addScaledVector(oC, w);

            // 6. Преобразование в мировые координаты исходной 3D детали
            this.activeMesh.updateMatrixWorld(true);
            const origWorldPoint = this.activeMesh.localToWorld(origLocalPoint.clone());

            const normalOrig = new THREE.Vector3().crossVectors(
                new THREE.Vector3().subVectors(oB, oA),
                new THREE.Vector3().subVectors(oC, oA)
            ).normalize().transformDirection(this.activeMesh.matrixWorld).normalize();

            return {
                origWorldPoint: origWorldPoint,
                origLocalPoint: origLocalPoint,
                origNormal: normalOrig,
                unfoldWorldPoint: worldHitPoint.clone(),
                bary: { u, v, w },
                origTriIndex: origTriIndex,
                subMeshName: subMesh.name
            };
        }

        /**
         * Точная барицентрическая интерполяция точки с исходной 3D модели на развертку
         * @param {THREE.Vector3} worldHitPoint Точка клика в мировых координатах
         * @param {number} origTriIndex Индекс треугольника в исходной детали
         * @param {Object} [hitFace=null] Объект грани из raycaster
         * @returns {Object|null}
         */
        interpolateOriginalToUnfolded(worldHitPoint, origTriIndex, hitFace = null) {
            if (!this.activeMesh || !this.controller || !this.controller.subMeshes) return null;

            // Находим subMesh, которому принадлежит origTriIndex
            let targetSubMesh = null;
            let subFaceIdx = -1;
            for (const sm of this.controller.subMeshes) {
                if (sm.userData && sm.userData.faces) {
                    const idx = sm.userData.faces.indexOf(origTriIndex);
                    if (idx !== -1) {
                        targetSubMesh = sm;
                        subFaceIdx = idx;
                        break;
                    }
                }
            }

            if (!targetSubMesh || subFaceIdx === -1) return null;

            const origGeo = this.activeMesh.geometry;
            const origPos = origGeo.attributes.position;
            const origIndex = origGeo.index;
            const i0 = origIndex ? origIndex.getX(origTriIndex * 3) : origTriIndex * 3;
            const i1 = origIndex ? origIndex.getX(origTriIndex * 3 + 1) : origTriIndex * 3 + 1;
            const i2 = origIndex ? origIndex.getX(origTriIndex * 3 + 2) : origTriIndex * 3 + 2;

            const oA = new THREE.Vector3().fromBufferAttribute(origPos, i0);
            const oB = new THREE.Vector3().fromBufferAttribute(origPos, i1);
            const oC = new THREE.Vector3().fromBufferAttribute(origPos, i2);

            const pLocalOrig = this.activeMesh.worldToLocal(worldHitPoint.clone());

            const v0 = new THREE.Vector3().subVectors(oB, oA);
            const v1 = new THREE.Vector3().subVectors(oC, oA);
            const v2 = new THREE.Vector3().subVectors(pLocalOrig, oA);

            const d00 = v0.dot(v0);
            const d01 = v0.dot(v1);
            const d11 = v1.dot(v1);
            const d20 = v2.dot(v0);
            const d21 = v2.dot(v1);

            const denom = d00 * d11 - d01 * d01;
            let u, v, w;
            if (Math.abs(denom) < 1e-12) {
                u = 1 / 3; v = 1 / 3; w = 1 / 3;
            } else {
                v = (d11 * d20 - d01 * d21) / denom;
                w = (d00 * d21 - d01 * d20) / denom;
                u = 1.0 - v - w;
            }

            u = Math.max(0, Math.min(1, u));
            v = Math.max(0, Math.min(1, v));
            w = Math.max(0, Math.min(1, w));
            const sum = u + v + w;
            if (sum > 0.0001) {
                u /= sum; v /= sum; w /= sum;
            }

            const subGeo = targetSubMesh.geometry;
            const subPos = subGeo.attributes.position;
            const subIndex = subGeo.index;
            let i0Sub, i1Sub, i2Sub;
            if (subIndex) {
                i0Sub = subIndex.getX(subFaceIdx * 3);
                i1Sub = subIndex.getX(subFaceIdx * 3 + 1);
                i2Sub = subIndex.getX(subFaceIdx * 3 + 2);
            } else {
                i0Sub = subFaceIdx * 3;
                i1Sub = subFaceIdx * 3 + 1;
                i2Sub = subFaceIdx * 3 + 2;
            }

            const sA = new THREE.Vector3().fromBufferAttribute(subPos, i0Sub);
            const sB = new THREE.Vector3().fromBufferAttribute(subPos, i1Sub);
            const sC = new THREE.Vector3().fromBufferAttribute(subPos, i2Sub);

            const unfoldLocalPoint = new THREE.Vector3()
                .addScaledVector(sA, u)
                .addScaledVector(sB, v)
                .addScaledVector(sC, w);

            targetSubMesh.updateMatrixWorld(true);
            const unfoldWorldPoint = targetSubMesh.localToWorld(unfoldLocalPoint.clone());

            const normalOrig = new THREE.Vector3().crossVectors(
                new THREE.Vector3().subVectors(oB, oA),
                new THREE.Vector3().subVectors(oC, oA)
            ).normalize().transformDirection(this.activeMesh.matrixWorld).normalize();

            return {
                origWorldPoint: worldHitPoint.clone(),
                origLocalPoint: pLocalOrig,
                origNormal: normalOrig,
                unfoldWorldPoint: unfoldWorldPoint,
                bary: { u, v, w },
                origTriIndex: origTriIndex,
                subMeshName: targetSubMesh.name
            };
        }

        /**
         * Отображение визуальных маркеров и связующей линии между точкой развертки и 3D телом
         * @param {THREE.Vector3} unfoldPt Точка на развертке
         * @param {THREE.Vector3} origPt Точка на исходной 3D детали
         * @param {Object} info
         */
        setInterpolationPoint(unfoldPt, origPt, info = null) {
            this.clearInterpolationMarkers();

            const targetScene = (this.activeMesh && this.activeMesh.parent) || window.creatorScene || window.scene;
            if (!targetScene) return;

            const markerGroup = new THREE.Group();
            markerGroup.name = 'UnfoldInterpolationMarkers';

            // Вспомогательная функция создания 3D маркера точки сопряжения
            const createPointMarker = (pt, colorHex, ringColorHex, label) => {
                const pGroup = new THREE.Group();
                pGroup.position.copy(pt);

                // Внешняя сфера
                const sphereGeo = new THREE.SphereGeometry(3.5, 20, 20);
                const sphereMat = new THREE.MeshBasicMaterial({ color: colorHex, depthTest: false });
                const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
                sphereMesh.renderOrder = 999;
                pGroup.add(sphereMesh);

                // Внутреннее светящееся ядро
                const coreGeo = new THREE.SphereGeometry(1.8, 16, 16);
                const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });
                const coreMesh = new THREE.Mesh(coreGeo, coreMat);
                coreMesh.renderOrder = 1000;
                pGroup.add(coreMesh);

                // Кольцевой таргет
                const ringGeo = new THREE.RingGeometry(4.5, 6.5, 32);
                const ringMat = new THREE.MeshBasicMaterial({ color: ringColorHex, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.9 });
                const ringMesh = new THREE.Mesh(ringGeo, ringMat);
                ringMesh.renderOrder = 999;
                pGroup.add(ringMesh);

                // 3D крестовина осей
                const crossMat = new THREE.LineBasicMaterial({ color: colorHex, depthTest: false, transparent: true, opacity: 0.85 });
                const crossSize = 10.0;
                const crossGeo = new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(-crossSize, 0, 0), new THREE.Vector3(crossSize, 0, 0),
                    new THREE.Vector3(0, -crossSize, 0), new THREE.Vector3(0, crossSize, 0),
                    new THREE.Vector3(0, 0, -crossSize), new THREE.Vector3(0, 0, crossSize)
                ]);
                const crossLines = new THREE.LineSegments(crossGeo, crossMat);
                crossLines.renderOrder = 998;
                pGroup.add(crossLines);

                return pGroup;
            };

            // 1. Маркер на развертке (голубой/бирюзовый)
            const unfoldMarker = createPointMarker(unfoldPt, 0x06b6d4, 0x22d3ee, 'Развертка');
            markerGroup.add(unfoldMarker);

            // 2. Маркер точки сопряжения на исходной 3D детали (ярко-оранжевый/красный)
            const origMarker = createPointMarker(origPt, 0xf97316, 0xfb923c, '3D Модель');
            markerGroup.add(origMarker);

            // 3. Соединительная штриховая линия между разверткой и 3D телом
            const linePoints = [unfoldPt.clone(), origPt.clone()];
            const lineGeo = new THREE.BufferGeometry().setFromPoints(linePoints);
            const lineMat = new THREE.LineDashedMaterial({
                color: 0xfacc15,
                dashSize: 4,
                gapSize: 3,
                depthTest: false,
                transparent: true,
                opacity: 0.95
            });
            const connLine = new THREE.Line(lineGeo, lineMat);
            connLine.computeLineDistances();
            connLine.renderOrder = 998;
            markerGroup.add(connLine);

            targetScene.add(markerGroup);
            this.interpolationMarkerGroup = markerGroup;

            // Сохраняем последнюю интерполированную точку в глобальном контексте
            window.lastInterpolatedMatingPoint = {
                world3D: origPt.clone(),
                worldUnfold: unfoldPt.clone(),
                info: info
            };

            // 4. Показываем информационный бейдж
            this._showPointInfoHUD(unfoldPt, origPt, info);
        }

        /**
         * Очистка маркеров интерполяции
         */
        clearInterpolationMarkers() {
            if (this.interpolationMarkerGroup) {
                if (this.interpolationMarkerGroup.parent) {
                    this.interpolationMarkerGroup.parent.remove(this.interpolationMarkerGroup);
                }
                this._disposeUnfoldResources(this.interpolationMarkerGroup);
                this.interpolationMarkerGroup = null;
            }
        }

        /**
         * Отображение компактного инфо-бейджа координат точки
         * @private
         */
        _showPointInfoHUD(unfoldPt, origPt, info) {
            this._removePointInfoHUD();

            const hud = document.createElement('div');
            hud.id = 'unfold-point-info-hud';
            Object.assign(hud.style, {
                position: 'fixed',
                top: '24px',
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: 'rgba(15, 23, 42, 0.92)',
                color: '#ffffff',
                padding: '9px 18px',
                borderRadius: '10px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                fontSize: '13px',
                zIndex: '9999',
                pointerEvents: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                backdropFilter: 'blur(10px)'
            });

            hud.innerHTML = `
                <div style="display: flex; align-items: center; gap: 6px;">
                    <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #06b6d4;"></span>
                    <span>Развертка: <b>[${unfoldPt.x.toFixed(1)}, ${unfoldPt.y.toFixed(1)}, ${unfoldPt.z.toFixed(1)}]</b></span>
                </div>
                <span style="color: #94a3b8; font-weight: 700;">➔</span>
                <div style="display: flex; align-items: center; gap: 6px;">
                    <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #f97316;"></span>
                    <span>3D тело: <b>[${origPt.x.toFixed(1)}, ${origPt.y.toFixed(1)}, ${origPt.z.toFixed(1)}]</b></span>
                </div>
                <span style="font-size: 11px; color: #a5f3fc; background: rgba(6, 182, 212, 0.2); padding: 2px 6px; border-radius: 4px;">Интерполяция</span>
            `;

            document.body.appendChild(hud);
            this.pointInfoHUD = hud;
        }

        /**
         * Удаление инфо-бейджа
         * @private
         */
        _removePointInfoHUD() {
            if (this.pointInfoHUD && this.pointInfoHUD.parentNode) {
                this.pointInfoHUD.parentNode.removeChild(this.pointInfoHUD);
                this.pointInfoHUD = null;
            }
        }

        /**
         * Нажатие клавиши Esc для выхода из режима развертки
         * @private
         */
        _bindEscKey() {
            this._unbindEscKey();
            this.escListener = (e) => {
                if (e.key === 'Escape' || e.code === 'Escape') {
                    console.log('[UnfoldLifecycleManager] Нажата клавиша Esc. Закрытие развертки.');
                    this.disableUnfold();
                }
            };
            window.addEventListener('keydown', this.escListener);
        }

        /**
         * Отключение обработчика Esc
         * @private
         */
        _unbindEscKey() {
            if (this.escListener) {
                window.removeEventListener('keydown', this.escListener);
                this.escListener = null;
            }
        }

        /**
         * Подключение интерактивного наведения (Hover) и кликов по поверхностям (Point Interpolation)
         * @private
         */
        _bindHoverInteraction() {
            this._unbindHoverInteraction();

            const renderer = window.creatorRenderer || window.renderer;
            const dom = (renderer && renderer.domElement) || document.querySelector('canvas') || window;

            let pointerDownPos = { x: 0, y: 0 };

            this.pointerDownListener = (e) => {
                pointerDownPos = { x: e.clientX, y: e.clientY };
            };

            this.pointerMoveListener = (e) => {
                if (!this.isActive || !this.controller || !this.controller.subMeshes) return;
                const cam = window.currentCreatorCamera || window.creatorCamera || window.camera;
                const rend = window.creatorRenderer || window.renderer;
                if (!cam || !rend || !rend.domElement) return;

                const rect = rend.domElement.getBoundingClientRect();
                const mouse = new THREE.Vector2(
                    ((e.clientX - rect.left) / rect.width) * 2 - 1,
                    -((e.clientY - rect.top) / rect.height) * 2 + 1
                );

                const raycaster = new THREE.Raycaster();
                raycaster.setFromCamera(mouse, cam);

                const subHits = raycaster.intersectObjects(this.controller.subMeshes, false);
                if (subHits.length > 0) {
                    this.controller.setHoveredMesh(subHits[0].object);
                    rend.domElement.style.cursor = 'pointer';
                    return;
                }

                if (this.activeMesh && this.activeMesh.visible) {
                    const modelHits = raycaster.intersectObject(this.activeMesh, false);
                    if (modelHits.length > 0) {
                        this.controller.setHoveredMesh(null);
                        rend.domElement.style.cursor = 'pointer';
                        return;
                    }
                }

                this.controller.setHoveredMesh(null);
                rend.domElement.style.cursor = 'default';
            };

            this.pointerClickListener = (e) => {
                if (!this.isActive || !this.controller || !this.controller.subMeshes || !this.activeMesh) return;
                
                // Фильтрация вращения/перетаскивания камеры (если мышь сместилась более чем на 5px)
                const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
                if (dist > 6) return;

                const cam = window.currentCreatorCamera || window.creatorCamera || window.camera;
                const rend = window.creatorRenderer || window.renderer;
                if (!cam || !rend || !rend.domElement) return;

                const rect = rend.domElement.getBoundingClientRect();
                const mouse = new THREE.Vector2(
                    ((e.clientX - rect.left) / rect.width) * 2 - 1,
                    -((e.clientY - rect.top) / rect.height) * 2 + 1
                );

                const raycaster = new THREE.Raycaster();
                raycaster.setFromCamera(mouse, cam);

                // Если нажат Shift/Alt, позволяем переключить базовую поверхность развертки
                if (e.shiftKey || e.altKey) {
                    const candidateList = [...this.controller.subMeshes];
                    if (this.activeMesh && this.activeMesh.visible) candidateList.push(this.activeMesh);
                    const intersects = raycaster.intersectObjects(candidateList, false);
                    if (intersects.length > 0 && window.FacetAnalyzer && typeof window.FacetAnalyzer.resolveBaseFlange === 'function') {
                        const resolvedBase = window.FacetAnalyzer.resolveBaseFlange(this.activeMesh, intersects[0]);
                        if (resolvedBase) {
                            console.log('[UnfoldLifecycleManager] Переключение базовой поверхности:', resolvedBase);
                            this.enableUnfold(this.activeMesh, resolvedBase);
                            return;
                        }
                    }
                }

                // 1. Приоритетный клик по зеленым поверхностям развертки
                const subHits = raycaster.intersectObjects(this.controller.subMeshes, false);
                if (subHits.length > 0) {
                    const hit = subHits[0];
                    const interp = this.interpolateUnfoldedToOriginal(hit.object, hit.point, hit.faceIndex, hit.face);
                    if (interp) {
                        console.log('[UnfoldLifecycleManager] Точка с развертки интерполирована на 3D деталь:', interp);
                        this.setInterpolationPoint(interp.unfoldWorldPoint, interp.origWorldPoint, interp);
                    }
                    return;
                }

                // 2. Клик по исходной 3D детали -> обратная интерполяция на развертку
                if (this.activeMesh && this.activeMesh.visible) {
                    const modelHits = raycaster.intersectObject(this.activeMesh, false);
                    if (modelHits.length > 0) {
                        const hit = modelHits[0];
                        const interp = this.interpolateOriginalToUnfolded(hit.point, hit.faceIndex, hit.face);
                        if (interp) {
                            console.log('[UnfoldLifecycleManager] Точка с 3D детали интерполирована на развертку:', interp);
                            this.setInterpolationPoint(interp.unfoldWorldPoint, interp.origWorldPoint, interp);
                        }
                    }
                }
            };

            this.pointerLeaveListener = () => {
                if (this.controller) {
                    this.controller.setHoveredMesh(null);
                }
                const rend = window.creatorRenderer || window.renderer;
                if (rend && rend.domElement) {
                    rend.domElement.style.cursor = 'default';
                }
            };

            if (dom && dom.addEventListener) {
                dom.addEventListener('pointerdown', this.pointerDownListener);
                dom.addEventListener('pointermove', this.pointerMoveListener);
                dom.addEventListener('click', this.pointerClickListener);
                dom.addEventListener('pointerleave', this.pointerLeaveListener);
            }
        }

        /**
         * Отключение слушателей наведения (Hover) и кликов
         * @private
         */
        _unbindHoverInteraction() {
            const renderer = window.creatorRenderer || window.renderer;
            const dom = (renderer && renderer.domElement) || document.querySelector('canvas') || window;
            if (dom && dom.removeEventListener) {
                if (this.pointerDownListener) dom.removeEventListener('pointerdown', this.pointerDownListener);
                if (this.pointerMoveListener) dom.removeEventListener('pointermove', this.pointerMoveListener);
                if (this.pointerClickListener) dom.removeEventListener('click', this.pointerClickListener);
                if (this.pointerLeaveListener) dom.removeEventListener('pointerleave', this.pointerLeaveListener);
            }
            this.pointerDownListener = null;
            this.pointerMoveListener = null;
            this.pointerClickListener = null;
            this.pointerLeaveListener = null;
            if (renderer && renderer.domElement) {
                renderer.domElement.style.cursor = 'default';
            }
        }
    }

    // Экспорт единого экземпляра менеджера жизненного цикла
    window.unfoldLifecycleManager = new UnfoldLifecycleManager();
    window.UnfoldLifecycleManager = UnfoldLifecycleManager;

    // Вспомогательные глобальные функции для вызова из консоли или UI
    window.createDemoBentPlate = function() {
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.lineTo(100, 0);
        shape.lineTo(100, 10);
        shape.absarc(90, 10, 10, 0, Math.PI / 2, false);
        shape.lineTo(90, 100);
        shape.lineTo(80, 100);
        shape.lineTo(80, 20);
        shape.lineTo(0, 20);
        shape.closePath();

        const extrudeSettings = { depth: 150, bevelEnabled: false };
        const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        geometry.computeVertexNormals();

        const material = new THREE.MeshStandardMaterial({
            color: 0x80a0c0,
            roughness: 0.4,
            metalness: 0.3,
            side: THREE.DoubleSide
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'DemoBentSheetMetal';
        mesh.position.set(0, 0, 0);
        return mesh;
    };

    window.startUnfoldMode = function(mesh, baseFaceIndex = 0) {
        if (!mesh) {
            if (typeof selectedObjects !== 'undefined' && selectedObjects.length > 0 && selectedObjects[0].isMesh) {
                mesh = selectedObjects[0];
            } else if (window.selectedObjects && window.selectedObjects.length > 0 && window.selectedObjects[0].isMesh) {
                mesh = window.selectedObjects[0];
            } else if (window.creatorScene) {
                window.creatorScene.traverse(obj => {
                    if (!mesh && obj.isMesh && obj.visible && (!obj.userData || !obj.userData.isKinematicRoot) && !obj.name.includes('Grid') && !obj.name.includes('Helper')) {
                        mesh = obj;
                    }
                });
            }
        }

        if (!mesh) {
            mesh = window.createDemoBentPlate();
            const targetScene = window.creatorScene || window.scene;
            if (targetScene) targetScene.add(mesh);
        }

        return window.unfoldLifecycleManager.enableUnfold(mesh, baseFaceIndex);
    };

    window.stopUnfoldMode = function() {
        window.unfoldLifecycleManager.disableUnfold();
    };
})();
