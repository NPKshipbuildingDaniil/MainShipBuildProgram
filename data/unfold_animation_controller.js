/**
 * ============================================================================
 * ФАЙЛ: unfold_animation_controller.js
 * НАЗНАЧЕНИЕ: Анимационный Контроллер (Rigid Forward Kinematics Unfold Engine)
 * БЛОК 4: Каскадная интерполяция анимации разворота шарниров по параметру T ∈ [0.0, 1.0]
 * ============================================================================
 */

(function() {
    'use strict';

    class UnfoldAnimationController {
        /**
         * @param {THREE.Group} rootGroup Корневое дерево шарниров, полученное из KinematicTreeBuilder.buildTree()
         */
        constructor(rootGroup) {
            this.rootGroup = rootGroup;
            this.pivots = [];
            this.subMeshes = [];
            this.hoveredMesh = null;
            this.progress = 0.0; // T ∈ [0.0, 1.0]
            this.overlap = 0.35; // Коэффициент перекрытия каскадной волны
            this.gapMultiplier = 1.0; // Масштаб зазоров
            this.gapDistance = 30.0; // Базовое расстояние зазора в мм
            this._animId = null;
            this._hoverAnimId = null;

            this._initKinematics();
        }

        /**
         * Установка текущей наведенной поверхности (Hover) с плавной анимацией масштабирования
         * @param {THREE.Mesh|null} mesh 
         */
        setHoveredMesh(mesh) {
            if (this.hoveredMesh !== mesh) {
                this.hoveredMesh = mesh;
                this._startHoverTransition();
            }
        }

        /**
         * Плавная покадровая анимация увеличения и подъема наведенной поверхности
         * @private
         */
        _startHoverTransition() {
            if (this._hoverAnimId) return;

            const baseNormal = (this.rootGroup && this.rootGroup.userData && this.rootGroup.userData.baseNormal)
                ? this.rootGroup.userData.baseNormal.clone().normalize()
                : new THREE.Vector3(0, 1, 0);

            const step = () => {
                let stillAnimating = false;
                const e_gap = UnfoldAnimationController.easeInOutCubic(this.progress);
                const baseScale = 1.0 + 0.30 * e_gap;

                if (this.subMeshes && this.subMeshes.length > 0) {
                    this.subMeshes.forEach(mesh => {
                        const isHovered = (mesh === this.hoveredMesh);
                        // При наведении курсора поверхность плавно увеличивается на 10% (scale multiplier 1.10)
                        const targetScaleMult = isHovered ? 1.10 : 1.0;
                        const targetLift = isHovered ? 2.0 : 0.0;

                        if (mesh.userData.currentHoverScale === undefined) mesh.userData.currentHoverScale = 1.0;
                        if (mesh.userData.currentLift === undefined) mesh.userData.currentLift = 0.0;

                        const scaleDiff = targetScaleMult - mesh.userData.currentHoverScale;
                        const liftDiff = targetLift - mesh.userData.currentLift;

                        if (Math.abs(scaleDiff) > 0.005 || Math.abs(liftDiff) > 0.05) {
                            mesh.userData.currentHoverScale += scaleDiff * 0.25;
                            mesh.userData.currentLift += liftDiff * 0.25;
                            stillAnimating = true;
                        } else {
                            mesh.userData.currentHoverScale = targetScaleMult;
                            mesh.userData.currentLift = targetLift;
                        }

                        // Применение масштаба
                        const s = baseScale * mesh.userData.currentHoverScale;
                        mesh.scale.set(s, s, s);

                        // Применение смещения вдоль нормали в локальных координатах родителя
                        if (mesh.userData.initialLocalPos) {
                            if (mesh.parent) {
                                const parentWorldQuat = mesh.parent.getWorldQuaternion(new THREE.Quaternion());
                                const localNormal = baseNormal.clone().applyQuaternion(parentWorldQuat.invert()).normalize();
                                mesh.position.copy(mesh.userData.initialLocalPos)
                                    .addScaledVector(localNormal, mesh.userData.currentLift);
                            } else {
                                mesh.position.copy(mesh.userData.initialLocalPos)
                                    .addScaledVector(baseNormal, mesh.userData.currentLift);
                            }
                        }
                        mesh.updateMatrixWorld(true);

                        // Управление слоями отрисовки и подсветкой
                        mesh.renderOrder = isHovered ? 999 : 0;

                        if (mesh.material) {
                            if (isHovered) {
                                mesh.material.color.setHex(0x15803d); // Deep Dark Green Focus
                                if (mesh.material.emissive) mesh.material.emissive.setHex(0x052e16);
                                mesh.material.opacity = 0.95;
                            } else {
                                mesh.material.color.setHex(0x22c55e); // Standard Green
                                if (mesh.material.emissive) mesh.material.emissive.setHex(0x000000);
                                mesh.material.opacity = 0.65;
                            }
                            mesh.material.transparent = true;
                            mesh.material.needsUpdate = true;
                        }
                    });
                }

                if (stillAnimating) {
                    this._hoverAnimId = requestAnimationFrame(step);
                } else {
                    this._hoverAnimId = null;
                }
            };

            this._hoverAnimId = requestAnimationFrame(step);
        }

        /**
         * Инициализация кинематических шарниров и расчет строго компланарных векторов раздвижки по швам
         * @private
         */
        _initKinematics() {
            if (!this.rootGroup) return;

            const collectedPivots = [];
            const collectedMeshes = [];

            // 1. Сбор всех шарниров и поверхностей кинематического дерева
            this.rootGroup.traverse((node) => {
                if (node.isGroup && node.userData && (node.userData.isHingePivot || node.userData.hinge)) {
                    const hinge = node.userData.hinge;
                    if (hinge && hinge.axis) {
                        collectedPivots.push({
                            group: node,
                            hinge: hinge,
                            depth: hinge.depth || 0,
                            axis: hinge.axis.clone().normalize(),
                            targetAngle: hinge.targetAngle || 0,
                            currentAngle: 0,
                            initialPos: node.position.clone(),
                            inPlaneLocalGap: new THREE.Vector3(1, 0, 0)
                        });
                    }
                }
                if (node.isMesh && node.userData && node.userData.isSubMesh) {
                    if (!node.userData.basePosition) {
                        node.userData.basePosition = node.position.clone();
                    }
                    if (!node.userData.initialLocalPos) {
                        node.userData.initialLocalPos = node.position.clone();
                    }
                    node.userData.currentHoverScale = 1.0;
                    node.userData.currentLift = 0.0;

                    if (!node.userData.localCentroid) {
                        node.geometry.computeBoundingBox();
                        node.userData.localCentroid = node.geometry.boundingBox ? node.geometry.boundingBox.getCenter(new THREE.Vector3()) : new THREE.Vector3();
                    }
                    collectedMeshes.push(node);
                }
            });

            collectedPivots.sort((a, b) => a.depth - b.depth);
            this.pivots = collectedPivots;
            this.subMeshes = collectedMeshes;

            // 2. Временно переводим всё кинематическое дерево в 100% плоское развернутое состояние
            this.pivots.forEach(p => {
                p.group.quaternion.setFromAxisAngle(p.axis, p.targetAngle);
                p.group.position.copy(p.initialPos);
            });
            this.rootGroup.updateMatrixWorld(true);

            // Базовая нормаль развертки (плоскость листа)
            const baseNormal = (this.rootGroup.userData && this.rootGroup.userData.baseNormal)
                ? this.rootGroup.userData.baseNormal.clone().normalize()
                : new THREE.Vector3(0, 0, 1);

            // 3. Функция вычисления центра тяжести грани (SubMesh) в мировых координатах в плоском состоянии
            const getDirectSubMeshWorldCenter = (groupOrNode) => {
                let foundMesh = null;
                for (let i = 0; i < groupOrNode.children.length; i++) {
                    const child = groupOrNode.children[i];
                    if (child.isMesh && child.userData && child.userData.isSubMesh) {
                        foundMesh = child;
                        break;
                    }
                }
                if (!foundMesh && groupOrNode.isMesh && groupOrNode.userData && groupOrNode.userData.isSubMesh) {
                    foundMesh = groupOrNode;
                }
                if (foundMesh) {
                    return foundMesh.getWorldPosition(new THREE.Vector3());
                }
                return null;
            };

            // Базовый центр неподвижной пласти (Base Mesh)
            let baseMeshWorldCenter = null;
            this.rootGroup.traverse(node => {
                if (!baseMeshWorldCenter && node.isMesh && node.userData && node.userData.isBaseMesh) {
                    baseMeshWorldCenter = node.getWorldPosition(new THREE.Vector3());
                }
            });
            if (!baseMeshWorldCenter) {
                baseMeshWorldCenter = getDirectSubMeshWorldCenter(this.rootGroup) || new THREE.Vector3(0, 0, 0);
            }

            // 4. Для каждого шарнира рассчитываем вектор раздвижки и строгое выравнивание по третьей оси (высота плоскости листа)
            const targetFlatPlaneHeight = baseMeshWorldCenter.dot(baseNormal);

            this.pivots.forEach(p => {
                const childCenter = getDirectSubMeshWorldCenter(p.group);

                // Ищем центр родительской грани
                let parentCenter = null;
                let parentNode = p.group.parent;
                while (parentNode) {
                    if (parentNode === this.rootGroup) {
                        parentCenter = baseMeshWorldCenter;
                        break;
                    }
                    const pCenter = getDirectSubMeshWorldCenter(parentNode);
                    if (pCenter) {
                        parentCenter = pCenter;
                        break;
                    }
                    parentNode = parentNode.parent;
                }
                if (!parentCenter) {
                    parentCenter = baseMeshWorldCenter;
                }

                let u_world = new THREE.Vector3();
                if (childCenter && parentCenter) {
                    // Вектор от центра родительской поверхности к центру дочерней поверхности
                    const toChildWorld = new THREE.Vector3().subVectors(childCenter, parentCenter);
                    // Проекция строго на 2D плоскость листа (удаляем составляющую по нормали)
                    toChildWorld.sub(baseNormal.clone().multiplyScalar(toChildWorld.dot(baseNormal)));

                    if (toChildWorld.lengthSq() > 0.0001) {
                        u_world.copy(toChildWorld).normalize();
                    }
                }

                // Резервный расчет, если центры совпадают
                if (u_world.lengthSq() < 0.0001) {
                    if (p.hinge && p.hinge.outwardDir) {
                        u_world.copy(p.hinge.outwardDir).normalize();
                        u_world.sub(baseNormal.clone().multiplyScalar(u_world.dot(baseNormal))).normalize();
                    }
                    if (u_world.lengthSq() < 0.0001) {
                        u_world.set(1, 0, 0);
                    }
                }

                // Переводим мировой вектор u_world в локальную систему координат родительского узла
                const parentWorldQuat = new THREE.Quaternion();
                if (p.group.parent) {
                    p.group.parent.getWorldQuaternion(parentWorldQuat);
                }
                const u_local = u_world.clone().applyQuaternion(parentWorldQuat.clone().invert()).normalize();

                p.inPlaneLocalGap = u_local;
            });

            console.log(`[UnfoldAnimationController] Загружено ${this.pivots.length} кинематических шарниров с зазорами`);

            // Возвращаем модель в исходное 3D состояние (T = 0.0)
            this.update(0.0);
        }

        /**
         * Сглаживание easeInOutCubic
         * @param {number} t ∈ [0..1]
         * @returns {number}
         */
        static easeInOutCubic(t) {
            return t < 0.5 
                ? 4 * t * t * t 
                : 1 - Math.pow(-2 * t + 2, 3) / 2;
        }

        /**
         * Обновление состояния развертки по глобальному параметру времени T
         * @param {number} T Глобальный прогресс [0.0..1.0]
         *                   [0.0 .. 0.70] — угловое кинематическое раскрытие в плоское состояние
         *                   [0.70 .. 1.0] — строго компланарное открытие зазоров по всем швам (ровно gapDistance)
         */
        update(T) {
            this.progress = THREE.MathUtils.clamp(T, 0.0, 1.0);
            const N = this.pivots.length;

            if (N === 0) return;

            const baseNormal = (this.rootGroup && this.rootGroup.userData && this.rootGroup.userData.baseNormal)
                ? this.rootGroup.userData.baseNormal.clone().normalize()
                : new THREE.Vector3(0, 1, 0);

            const T_ROT_END = 0.70;
            const rotProgress = THREE.MathUtils.clamp(this.progress / T_ROT_END, 0.0, 1.0);

            let gapProgress = 0.0;
            if (this.progress > T_ROT_END) {
                gapProgress = THREE.MathUtils.clamp((this.progress - T_ROT_END) / (1.0 - T_ROT_END), 0.0, 1.0);
            }
            const e_gap = UnfoldAnimationController.easeInOutCubic(gapProgress);

            // 1. Каскадное вращение шарниров вокруг осей стыков
            const overlap = this.overlap;
            const stepDuration = 1.0 / (1.0 + (N - 1) * (1.0 - overlap));
            const currentGapOffset = e_gap * this.gapDistance * this.gapMultiplier;

            this.pivots.forEach((p, i) => {
                const startTime = i * stepDuration * (1.0 - overlap);
                const endTime = startTime + stepDuration;

                let t_i = 0.0;
                if (rotProgress > startTime) {
                    t_i = THREE.MathUtils.clamp((rotProgress - startTime) / (endTime - startTime), 0.0, 1.0);
                }

                const e_i = UnfoldAnimationController.easeInOutCubic(t_i);
                const currentAngle = p.targetAngle * e_i;
                p.currentAngle = currentAngle;

                // Угловой поворот
                p.group.quaternion.setFromAxisAngle(p.axis, currentAngle);

                // Раздвижка шва: смещение шарнира относительно его родителя на строго одинаковый зазор в плоскости
                if (p.initialPos && p.inPlaneLocalGap) {
                    p.group.position.copy(p.initialPos)
                        .addScaledVector(p.inPlaneLocalGap, currentGapOffset);
                }
            });

            // 2. Масштабирование поверхностей (+30% в конечной точке) и интерактивное увеличение при наведении (+10%)
            const baseScale = 1.0 + 0.30 * e_gap;

            if (this.subMeshes && this.subMeshes.length > 0) {
                this.subMeshes.forEach(mesh => {
                    const isHovered = (mesh === this.hoveredMesh);
                    const hoverMult = (mesh.userData.currentHoverScale !== undefined) 
                        ? mesh.userData.currentHoverScale 
                        : (isHovered ? 1.10 : 1.0);

                    const lift = (mesh.userData.currentLift !== undefined) 
                        ? mesh.userData.currentLift 
                        : (isHovered ? 2.0 : 0.0);

                    const currentScale = baseScale * hoverMult;
                    mesh.scale.set(currentScale, currentScale, currentScale);

                    if (mesh.userData.initialLocalPos) {
                        if (mesh.parent) {
                            const parentWorldQuat = mesh.parent.getWorldQuaternion(new THREE.Quaternion());
                            const localNormal = baseNormal.clone().applyQuaternion(parentWorldQuat.invert()).normalize();
                            mesh.position.copy(mesh.userData.initialLocalPos)
                                .addScaledVector(localNormal, lift);
                        } else {
                            mesh.position.copy(mesh.userData.initialLocalPos)
                                .addScaledVector(baseNormal, lift);
                        }
                    }
                    mesh.updateMatrixWorld(true);

                    mesh.renderOrder = isHovered ? 999 : 0;

                    // Интерактивное изменение цвета материала
                    if (mesh.material) {
                        if (isHovered) {
                            mesh.material.color.setHex(0x15803d); // Deep Dark Green Focus
                            if (mesh.material.emissive) mesh.material.emissive.setHex(0x052e16);
                            mesh.material.opacity = 0.95;
                        } else {
                            mesh.material.color.setHex(0x22c55e); // Standard Green
                            if (mesh.material.emissive) mesh.material.emissive.setHex(0x000000);
                            mesh.material.opacity = 0.65;
                        }
                        mesh.material.transparent = true;
                        mesh.material.needsUpdate = true;
                    }
                });
            }
        }

        /**
         * Плавная интерполяция к целевому значению прогресса targetT
         * @param {number} targetT Целевое значение [0.0..1.0]
         * @param {number} duration Длительность анимации в мс
         * @param {function} onUpdate Колбэк прогресса
         * @param {function} onComplete Колбэк завершения
         */
        animateTo(targetT, duration = 800, onUpdate = null, onComplete = null) {
            if (this._animId) {
                cancelAnimationFrame(this._animId);
                this._animId = null;
            }

            const startT = this.progress;
            const clampedTarget = THREE.MathUtils.clamp(targetT, 0.0, 1.0);
            const startTime = performance.now();

            const frame = (now) => {
                const elapsed = now - startTime;
                const progressRatio = Math.min(elapsed / duration, 1.0);
                const currentT = startT + (clampedTarget - startT) * progressRatio;

                this.update(currentT);
                if (onUpdate) onUpdate(currentT);

                if (progressRatio < 1.0) {
                    this._animId = requestAnimationFrame(frame);
                } else {
                    this.update(clampedTarget);
                    this._animId = null;
                    if (onUpdate) onUpdate(clampedTarget);
                    if (onComplete) onComplete();
                }
            };

            this._animId = requestAnimationFrame(frame);
        }

        /**
         * Остановка текущей анимации
         */
        stop() {
            if (this._animId) {
                cancelAnimationFrame(this._animId);
                this._animId = null;
            }
        }

        /**
         * Получение текущего прогресса
         */
        getProgress() {
            return this.progress;
        }

        /**
         * Установка коэффициента перекрытия волны
         */
        setOverlap(val) {
            this.overlap = THREE.MathUtils.clamp(val, 0.0, 0.85);
            this.update(this.progress);
        }

        /**
         * Установка множителя зазора между поверхностями
         */
        setGapMultiplier(val) {
            this.gapMultiplier = Math.max(0.0, val);
            this.update(this.progress);
        }
    }

    // Экспорт в глобальную область
    window.UnfoldAnimationController = UnfoldAnimationController;
})();
