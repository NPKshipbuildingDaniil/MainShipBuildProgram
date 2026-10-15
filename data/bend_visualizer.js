/**
 * ============================================================================
 * ФАЙЛ: bend_visualizer.js
 * НАЗНАЧЕНИЕ: Визуальный Стайлинг и Штрихпунктирная Линия (Visual Highlights)
 * БЛОК 4: Подсветка зон гиба акцентным цветным полупрозрачным материалом 
 *         и генерация центральной штрихпунктирной линии нейтральной оси.
 * ============================================================================
 */

(function() {
    'use strict';

    class BendVisualizer {
        /**
         * @param {THREE.Group} rootGroup Иерархическое дерево пивотов (из KinematicTreeBuilder)
         */
        constructor(rootGroup) {
            this.rootGroup = rootGroup;
            this.bendMaterials = [];
            this.dashedLines = [];
            this.isHighlighted = false;

            // Материал для подсветки зон гиба
            this.highlightMaterial = new THREE.MeshStandardMaterial({
                color: 0xff9800,
                transparent: true,
                opacity: 0.5,
                side: THREE.DoubleSide,
                roughness: 0.3,
                metalness: 0.1,
                polygonOffset: true,
                polygonOffsetFactor: -1,
                polygonOffsetUnits: -1
            });
        }

        /**
         * Включает визуальную подсветку зон гиба и генерирует центральные штрихпунктирные линии
         */
        applyHighlights() {
            if (!this.rootGroup) return;

            // 1. Создание декалей (отдельных Mesh с PolygonOffset) для подмеченных граней гиба
            this.rootGroup.traverse((node) => {
                if (node.isMesh && node.name.includes('FacetMesh_Sec')) {
                    // Создаем клон меша для подсветки
                    const highlightMesh = new THREE.Mesh(node.geometry, this.highlightMaterial);
                    highlightMesh.name = node.name + '_Highlight';
                    // Копируем локальные трансформации
                    highlightMesh.position.copy(node.position);
                    highlightMesh.rotation.copy(node.rotation);
                    highlightMesh.scale.copy(node.scale);
                    
                    // Убираем тени для декали
                    highlightMesh.castShadow = false;
                    highlightMesh.receiveShadow = false;

                    node.parent.add(highlightMesh);
                    this.bendMaterials.push(highlightMesh); // Используем массив для хранения созданных декалей
                }
            });

            // 2. Поиск секторов гиба и создание центральных штрихпунктирных линий
            const sectorPivotGroups = new Map(); // sectorId -> array of step pivot groups

            this.rootGroup.traverse((node) => {
                if (node.isGroup && node.userData && node.userData.sectorId !== undefined) {
                    const sId = node.userData.sectorId;
                    if (!sectorPivotGroups.has(sId)) {
                        sectorPivotGroups.set(sId, []);
                    }
                    sectorPivotGroups.get(sId).push(node);
                }
            });

            // Для каждого сектора находим центральный фасет/шаг и генерируем линию
            sectorPivotGroups.forEach((pivotGroups, sectorId) => {
                if (pivotGroups.length === 0) return;

                // Сортируем по stepIndex
                pivotGroups.sort((a, b) => (a.userData.stepIndex || 0) - (b.userData.stepIndex || 0));

                // Центральный пивот k_center = floor(N / 2)
                const centerIdx = Math.floor(pivotGroups.length / 2);
                const centralPivotGroup = pivotGroups[centerIdx];

                // Создаем штрихпунктирную линию нейтральной оси гиба
                const axisDir = centralPivotGroup.userData.axisDir || new THREE.Vector3(1, 0, 0);
                const lineLength = 100; // Протяженность линии гиба (мм)

                // Начальная и конечная точки линии в локальных координатах пивота
                const startPoint = axisDir.clone().multiplyScalar(-lineLength / 2);
                const endPoint = axisDir.clone().multiplyScalar(lineLength / 2);

                const geometry = new THREE.BufferGeometry().setFromPoints([startPoint, endPoint]);

                const lineMaterial = new THREE.LineDashedMaterial({
                    color: 0x000000,
                    dashSize: 4,
                    gapSize: 2,
                    linewidth: 2,
                    scale: 1
                });

                const lineSegments = new THREE.LineSegments(geometry, lineMaterial);
                lineSegments.name = `DashedCenterline_Sec${sectorId}`;
                
                // Вкладываем объект линии в Group_Pivot центрального фасета
                centralPivotGroup.add(lineSegments);

                // Расчет расстояний для корректного отображения штрихпунктира
                lineSegments.computeLineDistances();

                this.dashedLines.push(lineSegments);
            });

            this.isHighlighted = true;
            console.log('[BendVisualizer] Подсветка гибов и штрихпунктирные линии успешно применены.');
        }

        /**
         * Сбрасывает подсветку и удаляет штрихпунктирные линии
         */
        removeHighlights() {
            // Удаление декалей подсветки
            this.bendMaterials.forEach((highlightMesh) => {
                if (highlightMesh.parent) {
                    highlightMesh.parent.remove(highlightMesh);
                }
                // Не удаляем geometry и material, так как они либо клонированы по ссылке (geometry), либо общие (highlightMaterial)
            });
            this.bendMaterials = [];

            // Удаление штрихпунктирных линий из сцены
            this.dashedLines.forEach((line) => {
                if (line.parent) {
                    line.parent.remove(line);
                }
                if (line.geometry) line.geometry.dispose();
                if (line.material) line.material.dispose();
            });
            this.dashedLines = [];

            this.isHighlighted = false;
            console.log('[BendVisualizer] Подсветка и линии сброшены.');
        }

        /**
         * Очистка ресурсов визуализатора
         */
        dispose() {
            this.removeHighlights();
            if (this.highlightMaterial) {
                this.highlightMaterial.dispose();
            }
        }

        /**
         * Переключение состояния подсветки
         */
        toggle() {
            if (this.isHighlighted) {
                this.removeHighlights();
            } else {
                this.applyHighlights();
            }
        }
    }

    // Экспорт в глобальную область
    window.BendVisualizer = BendVisualizer;
})();
