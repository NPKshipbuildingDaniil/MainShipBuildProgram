/**
 * ============================================================================
 * ФАЙЛ: cad_clipboard_importer.js
 * НАЗНАЧЕНИЕ: Интерактивный импорт 2D-геометрии (nanoCAD / AutoCAD / SVG) из
 *            буфера обмена в веб-эскиз по комбинации Ctrl+V.
 * ============================================================================
 */

class CadClipboardImporter {
    constructor() {
        this.state = 'IDLE'; // 'IDLE' | 'PASTE_GHOST'
        this.parsedPrimitives = [];
        this.boundingBox = null;
        this.ghostGroup = null;
        this.currentSnappedPos = null;
        this.reportLog = [];
        this.stats = { LINE: 0, CIRCLE: 0, ARC: 0, LWPOLYLINE: 0, SPLINE: 0, ELLIPSE: 0 };
        this.reportPanelEl = null;

        this.initEventListeners();
        this.createReportPanel();
        this.logReport('Модуль CadClipboardImporter инициализирован. Ожидание Ctrl+V в режиме эскиза.', 'info');
    }

    // --- 1. ИНИЦИАЛИЗАЦИЯ СОБЫТИЙ ---
    initEventListeners() {
        // Перехват глобальной вставки (Ctrl+V / Cmd+V)
        window.addEventListener('paste', (e) => this.handlePaste(e));

        // Перехват перемещения мыши для фантома
        window.addEventListener('mousemove', (e) => this.handleMouseMove(e), true);

        // Перехват клика мыши (ЛКМ/ПКМ) для фиксации/отмены вставки
        window.addEventListener('pointerdown', (e) => this.handlePointerDown(e), true);

        // Перехват клавиши Escape для отмены
        window.addEventListener('keydown', (e) => this.handleKeyDown(e), true);

        // Блокировка стандартного контекстного меню при отображении фантома
        window.addEventListener('contextmenu', (e) => {
            if (this.state === 'PASTE_GHOST') {
                e.preventDefault();
            }
        }, true);

        // Блокировка других событий мыши во время/сразу после вставки, чтобы не сбивать инструменты эскиза
        window.addEventListener('pointerup', (e) => {
            if (this.state === 'PASTE_GHOST' || this.wasGhostActiveJustNow) {
                e.preventDefault();
                e.stopPropagation();
            }
        }, true);

        window.addEventListener('click', (e) => {
            if (this.state === 'PASTE_GHOST' || this.wasGhostActiveJustNow) {
                e.preventDefault();
                e.stopPropagation();
                this.wasGhostActiveJustNow = false;
            }
        }, true);

        window.addEventListener('mousedown', (e) => {
            if (this.state === 'PASTE_GHOST') {
                e.preventDefault();
                e.stopPropagation();
            }
        }, true);

        window.addEventListener('mouseup', (e) => {
            if (this.state === 'PASTE_GHOST' || this.wasGhostActiveJustNow) {
                e.preventDefault();
                e.stopPropagation();
            }
        }, true);
    }

    // --- 2. СИСТЕМА ЛОГИРОВАНИЯ И ОТЧЕТА ---
    logReport(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = { timestamp, message, type };
        this.reportLog.push(logEntry);
        console.log(`[CadClipboardImporter ${timestamp}] [${type.toUpperCase()}] ${message}`);
        this.updateReportUI();
    }

    createReportPanel() {
        if (document.getElementById('cad-import-report-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'cad-import-report-panel';
        panel.style.cssText = `
            position: fixed;
            bottom: 24px;
            right: 24px;
            width: 380px;
            max-height: 480px;
            background: rgba(15, 23, 42, 0.92);
            backdrop-filter: blur(12px);
            border: 1px solid rgba(59, 130, 246, 0.3);
            border-radius: 12px;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
            color: #F8FAFC;
            font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
            font-size: 13px;
            z-index: 99999;
            display: none;
            flex-direction: column;
            overflow: hidden;
            transition: opacity 0.2s ease, transform 0.2s ease;
        `;

        panel.innerHTML = `
            <div style="padding: 12px 16px; background: rgba(30, 41, 59, 0.8); border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; align-items: center; gap: 8px; font-weight: 600; color: #60A5FA;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
                    <span>Импорт CAD из буфера</span>
                </div>
                <div style="display: flex; align-items: center; gap: 6px;">
                    <button id="cad-report-toggle-log-btn" style="background: none; border: none; color: #94A3B8; cursor: pointer; padding: 2px 6px; font-size: 11px; border-radius: 4px;" title="Свернуть/Развернуть лог">Лог</button>
                    <button onclick="window.cadClipboardImporter.hideReportPanel()" style="background: none; border: none; color: #94A3B8; cursor: pointer; padding: 2px 6px; font-size: 16px; font-weight: bold; line-height: 1;" title="Закрыть">&times;</button>
                </div>
            </div>
            
            <div id="cad-report-body" style="padding: 14px; display: flex; flex-direction: column; gap: 10px;">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                    <span style="color: #94A3B8;">Статус:</span>
                    <span id="cad-report-status-badge" style="padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; background: rgba(59, 130, 246, 0.2); color: #60A5FA; border: 1px solid rgba(59, 130, 246, 0.4);">
                        IDLE
                    </span>
                </div>

                <div id="cad-report-stats-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; background: rgba(0, 0, 0, 0.25); padding: 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); text-align: center;">
                    <div><div style="font-size: 10px; color: #94A3B8;">LINE</div><div id="cad-stat-line" style="font-weight: 700; color: #38BDF8;">0</div></div>
                    <div><div style="font-size: 10px; color: #94A3B8;">CIRCLE</div><div id="cad-stat-circle" style="font-weight: 700; color: #38BDF8;">0</div></div>
                    <div><div style="font-size: 10px; color: #94A3B8;">ARC</div><div id="cad-stat-arc" style="font-weight: 700; color: #38BDF8;">0</div></div>
                    <div><div style="font-size: 10px; color: #94A3B8;">LWPOLY</div><div id="cad-stat-lwpoly" style="font-weight: 700; color: #38BDF8;">0</div></div>
                    <div><div style="font-size: 10px; color: #94A3B8;">ELLIPSE</div><div id="cad-stat-ellipse" style="font-weight: 700; color: #38BDF8;">0</div></div>
                    <div><div style="font-size: 10px; color: #94A3B8;">SPLINE</div><div id="cad-stat-spline" style="font-weight: 700; color: #38BDF8;">0</div></div>
                </div>

                <div id="cad-report-bbox-info" style="font-size: 11px; color: #CBD5E1; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 6px; display: flex; flex-direction: column; gap: 4px;">
                    <div><strong>Размер (Габариты):</strong> <span id="cad-bbox-size">0.0 x 0.0 мм</span></div>
                    <div><strong>Центр масс:</strong> <span id="cad-bbox-center">(0.0, 0.0)</span></div>
                </div>

                <div id="cad-report-instruction" style="font-size: 11px; color: #FCD34D; background: rgba(245, 158, 11, 0.15); padding: 8px; border-radius: 6px; border: 1px solid rgba(245, 158, 11, 0.3); display: none;">
                    🎯 <strong>PASTE_GHOST:</strong> Переместите курсор в нужную точку и нажмите <strong>ЛКМ</strong> для вставки, или <strong>Esc</strong> для отмены.
                </div>

                <div id="cad-report-log-container" style="max-height: 140px; overflow-y: auto; background: rgba(0, 0, 0, 0.4); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 6px; font-family: monospace; font-size: 10px; display: flex; flex-direction: column; gap: 4px;">
                </div>
            </div>
        `;

        document.body.appendChild(panel);
        this.reportPanelEl = panel;

        const toggleBtn = panel.querySelector('#cad-report-toggle-log-btn');
        const logContainer = panel.querySelector('#cad-report-log-container');
        if (toggleBtn && logContainer) {
            toggleBtn.onclick = () => {
                logContainer.style.display = logContainer.style.display === 'none' ? 'flex' : 'none';
            };
        }
    }

    showReportPanel() {
        if (!this.reportPanelEl) this.createReportPanel();
        this.reportPanelEl.style.display = 'flex';
    }

    hideReportPanel() {
        if (this.reportPanelEl) this.reportPanelEl.style.display = 'none';
    }

    updateReportUI() {
        if (!this.reportPanelEl) return;

        const badge = this.reportPanelEl.querySelector('#cad-report-status-badge');
        if (badge) {
            badge.innerText = this.state;
            if (this.state === 'PASTE_GHOST') {
                badge.style.background = 'rgba(245, 158, 11, 0.2)';
                badge.style.color = '#FBBF24';
                badge.style.borderColor = 'rgba(245, 158, 11, 0.4)';
            } else if (this.state === 'IDLE') {
                badge.style.background = 'rgba(59, 130, 246, 0.2)';
                badge.style.color = '#60A5FA';
                badge.style.borderColor = 'rgba(59, 130, 246, 0.4)';
            }
        }

        const instr = this.reportPanelEl.querySelector('#cad-report-instruction');
        if (instr) {
            instr.style.display = this.state === 'PASTE_GHOST' ? 'block' : 'none';
        }

        // Stats
        const setStat = (id, val) => {
            const el = this.reportPanelEl.querySelector(id);
            if (el) el.innerText = val;
        };
        setStat('#cad-stat-line', this.stats.LINE);
        setStat('#cad-stat-circle', this.stats.CIRCLE);
        setStat('#cad-stat-arc', this.stats.ARC);
        setStat('#cad-stat-lwpoly', this.stats.LWPOLYLINE);
        setStat('#cad-stat-ellipse', this.stats.ELLIPSE);
        setStat('#cad-stat-spline', this.stats.SPLINE);

        // BBox
        if (this.boundingBox) {
            const sizeEl = this.reportPanelEl.querySelector('#cad-bbox-size');
            if (sizeEl) sizeEl.innerText = `${this.boundingBox.width.toFixed(2)} x ${this.boundingBox.height.toFixed(2)} мм`;
            const centerEl = this.reportPanelEl.querySelector('#cad-bbox-center');
            if (centerEl) centerEl.innerText = `(${this.boundingBox.centerX.toFixed(2)}, ${this.boundingBox.centerY.toFixed(2)})`;
        }

        // Logs
        const logContainer = this.reportPanelEl.querySelector('#cad-report-log-container');
        if (logContainer) {
            logContainer.innerHTML = this.reportLog.map(entry => {
                let color = '#94A3B8';
                if (entry.type === 'error') color = '#F87171';
                if (entry.type === 'success') color = '#4ADE80';
                if (entry.type === 'warn') color = '#FBBF24';
                return `<div style="color: ${color};">[${entry.timestamp}] ${entry.message}</div>`;
            }).join('');
            logContainer.scrollTop = logContainer.scrollHeight;
        }

        const debugLogContainer = document.getElementById('debug-cad-log');
        if (debugLogContainer) {
            debugLogContainer.innerHTML = this.reportLog.map(entry => {
                let color = '#94A3B8';
                if (entry.type === 'error') color = '#F87171';
                if (entry.type === 'success') color = '#4ADE80';
                if (entry.type === 'warn') color = '#FBBF24';
                return `<div style="color: ${color}; padding: 2px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">[${entry.timestamp}] ${entry.message}</div>`;
            }).join('');
            debugLogContainer.scrollTop = debugLogContainer.scrollHeight;
        }
    }

    checkSketchPlane() {
        if (typeof isSketchMode === 'undefined' || !isSketchMode || !activeSketchPlane) {
            this.logReport('Вставка заблокирована: для импорта геометрии необходимо сначала зайти в режим 2D-эскиза на плоскости!', 'warn');
            if (typeof showToast === 'function') {
                showToast('Для вставки геометрии сначала выберите плоскость 2D-эскиза!');
            }
            return false;
        }
        return true;
    }

    showPasteModal() {
        if (!this.checkSketchPlane()) return;
        let modal = document.getElementById('cad-paste-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'cad-paste-modal';
            modal.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                background: rgba(15, 23, 42, 0.75); backdrop-filter: blur(8px);
                z-index: 999999; display: flex; align-items: center; justify-content: center;
            `;
            modal.innerHTML = `
                <div style="background: #0F172A; border: 1px solid rgba(59, 130, 246, 0.4); border-radius: 12px; padding: 20px; width: 500px; max-width: 90vw; color: #F8FAFC; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <h3 style="margin:0; font-size: 16px; color: #60A5FA; display:flex; align-items:center; gap:8px;">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
                            Вставка 2D-чертежа (nanoCAD / AutoCAD / C2W)
                        </h3>
                        <button onclick="document.getElementById('cad-paste-modal').style.display='none'" style="background:none; border:none; color:#94A3B8; font-size:20px; cursor:pointer;">&times;</button>
                    </div>
                    <p style="font-size: 13px; color: #94A3B8; margin-bottom: 12px; line-height: 1.4;">
                        Скопируйте чертеж из nanoCAD / AutoCAD (Ctrl+C) и нажмите <strong>Ctrl+V</strong> в поле ниже:
                    </p>
                    <textarea id="cad-paste-textarea" rows="6" placeholder="Вставьте DXF, SVG или JSON геометрию здесь (Ctrl+V)..." style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: #38BDF8; font-family: monospace; font-size: 12px; padding: 10px; resize: vertical; margin-bottom: 12px; outline: none;"></textarea>
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                        <button id="cad-paste-sample-btn" style="padding: 8px 12px; background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.4); border-radius: 6px; color: #60A5FA; cursor: pointer; font-size: 12px; font-weight: 500;">
                            ✨ Вставить пример (Фланец)
                        </button>
                        <div style="display: flex; gap: 8px;">
                            <button onclick="document.getElementById('cad-paste-modal').style.display='none'" style="padding: 8px 16px; background: rgba(255,255,255,0.1); border: none; border-radius: 6px; color: #CBD5E1; cursor: pointer; font-size: 13px;">Отмена</button>
                            <button id="cad-paste-confirm-btn" style="padding: 8px 16px; background: #2563EB; border: none; border-radius: 6px; color: white; cursor: pointer; font-size: 13px; font-weight: 600;">Импортировать</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            const textarea = modal.querySelector('#cad-paste-textarea');
            const confirmBtn = modal.querySelector('#cad-paste-confirm-btn');
            const sampleBtn = modal.querySelector('#cad-paste-sample-btn');

            const processText = () => {
                const val = textarea.value;
                if (val && val.trim().length > 0) {
                    modal.style.display = 'none';
                    textarea.value = '';
                    this.processClipboardText(val);
                }
            };

            textarea.onpaste = () => {
                setTimeout(() => processText(), 50);
            };

            confirmBtn.onclick = () => processText();

            if (sampleBtn) {
                sampleBtn.onclick = () => {
                    const sampleC2W = JSON.stringify({
                        "outerContour": {
                            "autoClosed": true,
                            "entities": [
                                { "type": "LINE", "p1": {"x": 0, "y": 0}, "p2": {"x": 100, "y": 0} },
                                { "type": "ARC", "center": {"x": 100, "y": 25}, "radius": 25, "startAngle": -1.5708, "endAngle": 1.5708 },
                                { "type": "LINE", "p1": {"x": 100, "y": 50}, "p2": {"x": 0, "y": 50} },
                                { "type": "ARC", "center": {"x": 0, "y": 25}, "radius": 25, "startAngle": 1.5708, "endAngle": 4.71239 }
                            ]
                        },
                        "innerEntities": [
                            { "type": "CIRCLE", "center": {"x": 0, "y": 25}, "radius": 10 },
                            { "type": "CIRCLE", "center": {"x": 100, "y": 25}, "radius": 10 },
                            { "type": "CIRCLE", "center": {"x": 50, "y": 25}, "radius": 15 }
                        ]
                    }, null, 2);
                    textarea.value = sampleC2W;
                    processText();
                };
            }
        }
        modal.style.display = 'flex';
        const ta = modal.querySelector('#cad-paste-textarea');
        if (ta) {
            ta.value = '';
            ta.focus();
        }
    }

    triggerClipboardImport() {
        if (!this.checkSketchPlane()) return;
        this.showReportPanel();

        if (navigator.clipboard && navigator.clipboard.readText) {
            navigator.clipboard.readText().then(text => {
                if (text && text.trim().length > 0) {
                    this.processClipboardText(text);
                } else {
                    this.logReport('Буфер обмена пуст или доступ заблокирован браузером. Открытие окна ввода...', 'warn');
                    this.showPasteModal();
                }
            }).catch(err => {
                this.logReport(`Не удалось прочитать буфер напрямую: ${err.message}. Открытие окна ввода...`, 'warn');
                this.showPasteModal();
            });
        } else {
            this.showPasteModal();
        }
    }

    // --- 3. ОБРАБОТКА ИВЕНТА PASTE ---
    handlePaste(e) {
        this.logReport('Событие paste сработало. Фокус: ' + (document.activeElement ? document.activeElement.tagName + ' (id: ' + document.activeElement.id + ')' : 'нет'), 'info');
        if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
            if (document.activeElement.id === 'cad-paste-textarea' || document.activeElement.id === 'debug-cad-textarea') {
                // Let the browser handle the text insertion, we will process it manually via onpaste
                this.logReport('Событие paste оставлено для обработки текстовому полю.', 'info');
                return;
            } else {
                this.logReport('Событие paste проигнорировано (фокус ввода в чужом поле)', 'warn');
                return;
            }
        }

        if (!this.checkSketchPlane()) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        const clipboardData = e.clipboardData || window.clipboardData;
        if (!clipboardData) {
            this.logReport('clipboardData не найден в объекте события. Открытие окна ввода...', 'error');
            this.showPasteModal();
            return;
        }

        const pastedText = clipboardData.getData('text/plain') || clipboardData.getData('text');
        this.logReport(`Перехвачено событие paste (символов: ${pastedText ? pastedText.length : 0})`, 'info');

        if (!pastedText || pastedText.trim().length === 0) {
            this.logReport('Вставлен пустой текст', 'warn');
            this.showPasteModal();
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        this.processClipboardText(pastedText);
    }

    processClipboardText(text) {
        this.logReport('Начало анализа данных из буфера обмена...', 'info');

        let primitives = null;
        const trimmed = (text || '').trim();
        const isJSON = trimmed.startsWith('[') || trimmed.startsWith('{');

        try {
            if (isJSON) {
                this.logReport('Обнаружен формат JSON. Запуск JSON-парсера...', 'info');
                primitives = this.parseJSONText(trimmed);
            } else {
                const isSVG = trimmed.includes('<svg') || trimmed.includes('<path') || trimmed.includes('<line') || trimmed.includes('<circle');
                if (isSVG) {
                    this.logReport('Обнаружен формат SVG. Запуск SVG-парсера...', 'info');
                    primitives = this.parseSVGText(trimmed);
                } else {
                    this.logReport('Запуск DXF-парсера (nanoCAD / AutoCAD)...', 'info');
                    primitives = this.parseDXFText(trimmed);
                }
            }
        } catch (err) {
            this.logReport(`Ошибка во время парсинга: ${err.message}`, 'error');
            this.state = 'IDLE';
            if (typeof showToast === 'function') showToast('Ошибка формата данных буфера обмена');
            return;
        }

        if (!primitives || primitives.length === 0) {
            this.logReport('Буфер не содержит корректных 2D-данных', 'error');
            if (typeof showToast === 'function') showToast('Буфер не содержит корректных 2D-данных');
            this.state = 'IDLE';
            return;
        }

        // Приводим экранные/2D-координаты буфера обмена к ориентации эскиза CAD (Y -> -Y)
        this.mirrorPrimitivesHorizontally(primitives);

        this.parsedPrimitives = primitives;
        this.logReport(`Успешно распарсено примитивов: ${primitives.length}`, 'success');

        // Подсчет статистики
        this.stats = { LINE: 0, CIRCLE: 0, ARC: 0, LWPOLYLINE: 0, SPLINE: 0, ELLIPSE: 0 };
        primitives.forEach(p => {
            if (this.stats[p.type] !== undefined) this.stats[p.type]++;
        });

        // Расчет и нормализация BoundingBox и координат (setupGhost)
        let bbox = null;
        try {
            bbox = this.setupGhost(primitives);
        } catch (err) {
            this.logReport(`Ошибка при расчете габаритов (setupGhost): ${err.message}`, 'error');
            this.state = 'IDLE';
            if (typeof showToast === 'function') showToast('Ошибка при расчете геометрии фантома');
            return;
        }

        if (!bbox) {
            this.logReport('Буфер не содержит корректных 2D-данных', 'error');
            if (typeof showToast === 'function') showToast('Буфер не содержит корректных 2D-данных');
            this.state = 'IDLE';
            return;
        }

        this.logReport(`Габариты BoundingBox: W=${this.boundingBox.width.toFixed(2)}мм, H=${this.boundingBox.height.toFixed(2)}мм, Центр=(${this.boundingBox.centerX.toFixed(2)}, ${this.boundingBox.centerY.toFixed(2)})`, 'info');

        // Создание Фантома
        try {
            this.createGhostMesh(primitives, this.boundingBox);
        } catch (err) {
            this.logReport(`Ошибка при создании меша фантома: ${err.message}`, 'error');
            this.state = 'IDLE';
            if (typeof showToast === 'function') showToast('Ошибка создания 3D фантома');
            return;
        }

        if (typeof showToast === 'function') showToast(`Фантом готов (${primitives.length} объектов). Укажите позицию кликом ЛКМ`);
    }

    // --- АВТО-СОРТИРОВКА И ЗАМЫКАНИЕ КОНТУРА ЛИНИЙ И ДУГ ---
    processAndCloseContour(entities, autoClose) {
        if (!entities || !Array.isArray(entities)) return [];

        const isCurve = e => ['LINE', 'ARC', 'LWPOLYLINE', 'POLYLINE', 'SPLINE'].includes(e.type);
        const curveEntities = entities.filter(e => isCurve(e) && !e.closed && !e.isClosed);
        const nonCurveEntities = entities.filter(e => !isCurve(e) || e.closed || e.isClosed);

        if (curveEntities.length === 0) return entities;

        const tolerance = 0.5; // мм
        const dist = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y);

        const getEndpoints = e => {
            if (e.type === 'LINE') {
                const x1 = e.p1 ? e.p1.x : (e.x1 !== undefined ? e.x1 : 0);
                const y1 = e.p1 ? e.p1.y : (e.y1 !== undefined ? e.y1 : 0);
                const x2 = e.p2 ? e.p2.x : (e.x2 !== undefined ? e.x2 : 0);
                const y2 = e.p2 ? e.p2.y : (e.y2 !== undefined ? e.y2 : 0);
                return { p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 } };
            } else if (e.type === 'ARC') {
                const cx = e.center ? e.center.x : (e.cx !== undefined ? e.cx : 0);
                const cy = e.center ? e.center.y : (e.cy !== undefined ? e.cy : 0);
                const r = e.radius !== undefined ? e.radius : (e.r !== undefined ? e.r : 0);
                const a1 = e.startAngle !== undefined ? e.startAngle : 0;
                const a2 = e.endAngle !== undefined ? e.endAngle : 0;
                const ptA = { x: cx + r * Math.cos(a1), y: cy + r * Math.sin(a1) };
                const ptB = { x: cx + r * Math.cos(a2), y: cy + r * Math.sin(a2) };
                return e.reversed ? { p1: ptB, p2: ptA } : { p1: ptA, p2: ptB };
            } else if (e.points && e.points.length > 0) {
                const p1 = e.points[0];
                const p2 = e.points[e.points.length - 1];
                return {
                    p1: { x: p1.x !== undefined ? p1.x : 0, y: p1.y !== undefined ? p1.y : 0 },
                    p2: { x: p2.x !== undefined ? p2.x : 0, y: p2.y !== undefined ? p2.y : 0 }
                };
            }
            return { p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 } };
        };

        const reverseEntity = (item) => {
            if (item.type === 'LINE') {
                const tmp = item.p1; item.p1 = item.p2; item.p2 = tmp;
                item.x1 = item.p1.x; item.y1 = item.p1.y;
                item.x2 = item.p2.x; item.y2 = item.p2.y;
            } else if (item.type === 'ARC') {
                item.reversed = !item.reversed;
            } else if (item.points) {
                item.points.reverse();
            }
        };

        let pool = curveEntities.map(item => {
            const copy = JSON.parse(JSON.stringify(item));
            const ep = getEndpoints(copy);
            copy.p1 = ep.p1;
            copy.p2 = ep.p2;
            if (copy.type === 'LINE') {
                copy.x1 = ep.p1.x; copy.y1 = ep.p1.y;
                copy.x2 = ep.p2.x; copy.y2 = ep.p2.y;
            } else if (copy.type === 'ARC' || copy.type === 'CIRCLE') {
                const cx = copy.center ? copy.center.x : (copy.cx !== undefined ? copy.cx : 0);
                const cy = copy.center ? copy.center.y : (copy.cy !== undefined ? copy.cy : 0);
                const r = copy.radius !== undefined ? copy.radius : (copy.r !== undefined ? copy.r : 0);
                copy.cx = cx; copy.cy = cy; copy.r = r;
                copy.center = { x: cx, y: cy };
                copy.radius = r;
            }
            return copy;
        });

        let chain = [pool.shift()];

        while (pool.length > 0) {
            const lastItem = chain[chain.length - 1];
            const lastEp = getEndpoints(lastItem);
            const lastPt = lastEp.p2;

            let foundIdx = -1;
            let reverseNeeded = false;

            for (let i = 0; i < pool.length; i++) {
                const candEp = getEndpoints(pool[i]);
                if (dist(lastPt, candEp.p1) < tolerance) {
                    foundIdx = i; break;
                } else if (dist(lastPt, candEp.p2) < tolerance) {
                    foundIdx = i; reverseNeeded = true; break;
                }
            }

            if (foundIdx !== -1) {
                let item = pool.splice(foundIdx, 1)[0];
                if (reverseNeeded) {
                    reverseEntity(item);
                }
                chain.push(item);
            } else {
                chain.push(...pool);
                break;
            }
        }

        if (autoClose && chain.length > 1) {
            const firstEp = getEndpoints(chain[0]);
            const lastEp = getEndpoints(chain[chain.length - 1]);
            const gap = dist(firstEp.p1, lastEp.p2);

            if (gap > 0.05) {
                chain.push({
                    type: 'LINE',
                    role: 'OUTER',
                    p1: { ...lastEp.p2 },
                    p2: { ...firstEp.p1 },
                    x1: lastEp.p2.x, y1: lastEp.p2.y,
                    x2: firstEp.p1.x, y2: firstEp.p1.y
                });
            }
        }

        return [...chain, ...nonCurveEntities];
    }

    // --- 3.5. JSON ПАРСЕР (2D-ГЕОМЕТРИЯ ИЗ БУФЕРА ОБМЕНА) ---
    parseJSONText(text) {
        try {
            const data = JSON.parse(text);
            let rawOuter = [];
            let rawInner = [];
            let autoClose = false;

            if (Array.isArray(data)) {
                rawOuter = data;
            } else if (data && typeof data === 'object') {
                if (data.outerContour) {
                    rawOuter = Array.isArray(data.outerContour.entities) ? data.outerContour.entities : [];
                    autoClose = !!(data.outerContour.autoClose || data.outerContour.autoClosed);
                    rawInner = Array.isArray(data.innerEntities) ? data.innerEntities : [];
                } else if (Array.isArray(data.entities)) {
                    rawOuter = data.entities;
                    autoClose = !!(data.autoClose || data.autoClosed);
                    rawInner = Array.isArray(data.innerEntities) ? data.innerEntities : [];
                } else {
                    rawOuter = [data];
                }
            }

            const parseEntity = (item, defaultRole = 'OUTER') => {
                if (!item || typeof item !== 'object' || !item.type) return null;
                const type = item.type.toUpperCase();
                const role = item.role || defaultRole;

                if (type === 'LINE') {
                    const p1 = item.p1 || {};
                    const p2 = item.p2 || {};
                    const x1 = p1.x !== undefined ? p1.x : (item.x1 !== undefined ? item.x1 : 0);
                    const y1 = p1.y !== undefined ? p1.y : (item.y1 !== undefined ? item.y1 : 0);
                    const x2 = p2.x !== undefined ? p2.x : (item.x2 !== undefined ? item.x2 : 0);
                    const y2 = p2.y !== undefined ? p2.y : (item.y2 !== undefined ? item.y2 : 0);
                    return {
                        type: 'LINE',
                        role,
                        p1: { x: x1, y: y1 },
                        p2: { x: x2, y: y2 },
                        x1, y1, x2, y2
                    };
                } else if (type === 'CIRCLE') {
                    const center = item.center || {};
                    const cx = center.x !== undefined ? center.x : (item.cx !== undefined ? item.cx : 0);
                    const cy = center.y !== undefined ? center.y : (item.cy !== undefined ? item.cy : 0);
                    const r = item.radius !== undefined ? item.radius : (item.r !== undefined ? item.r : 0);
                    return {
                        type: 'CIRCLE',
                        role,
                        center: { x: cx, y: cy },
                        radius: r,
                        cx, cy, r
                    };
                } else if (type === 'ARC') {
                    const center = item.center || {};
                    const cx = center.x !== undefined ? center.x : (item.cx !== undefined ? item.cx : 0);
                    const cy = center.y !== undefined ? center.y : (item.cy !== undefined ? item.cy : 0);
                    const r = item.radius !== undefined ? item.radius : (item.r !== undefined ? item.r : 0);
                    
                    let startAngle = item.startAngle !== undefined ? item.startAngle : 0;
                    let endAngle = item.endAngle !== undefined ? item.endAngle : 0;

                    const isDegree = item.anglesInDegrees || item.unit === 'degrees' || Math.abs(startAngle) > 7 || Math.abs(endAngle) > 7;
                    if (isDegree) {
                        startAngle = (startAngle * Math.PI) / 180;
                        endAngle = (endAngle * Math.PI) / 180;
                    }

                    return {
                        type: 'ARC',
                        role,
                        center: { x: cx, y: cy },
                        radius: r,
                        cx, cy, r,
                        startAngle, endAngle
                    };
                } else if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
                    const points = item.points || [];
                    const isClosed = item.isClosed !== undefined ? item.isClosed : (item.closed !== undefined ? item.closed : false);
                    const mappedPoints = points.map(pt => ({
                        x: pt.x !== undefined ? pt.x : 0,
                        y: pt.y !== undefined ? pt.y : 0
                    }));
                    if (mappedPoints.length > 1) {
                        return {
                            type: 'LWPOLYLINE',
                            role,
                            points: mappedPoints,
                            closed: isClosed,
                            isClosed
                        };
                    }
                } else if (type === 'ELLIPSE') {
                    return {
                        type: 'ELLIPSE',
                        role,
                        cx: item.center ? item.center.x : (item.cx || 0),
                        cy: item.center ? item.center.y : (item.cy || 0),
                        mx: item.mx || 10,
                        my: item.my || 0,
                        ratio: item.ratio || 0.5,
                        startParam: item.startParam || 0,
                        endParam: item.endParam || Math.PI * 2
                    };
                } else if (type === 'SPLINE') {
                    const points = (item.points || []).map(pt => ({
                        x: pt.x !== undefined ? pt.x : 0,
                        y: pt.y !== undefined ? pt.y : 0
                    }));
                    if (points.length > 1) {
                        return { type: 'SPLINE', role, points };
                    }
                }
                return null;
            };

            const rawOuterEntities = rawOuter.map(e => parseEntity(e, 'OUTER')).filter(Boolean);
            const rawInnerEntities = rawInner.map(e => parseEntity(e, 'INNER')).filter(Boolean);

            const processedOuter = this.processAndCloseContour(rawOuterEntities, autoClose);
            processedOuter.forEach(e => e.role = 'OUTER');
            rawInnerEntities.forEach(e => e.role = 'INNER');

            return [...processedOuter, ...rawInnerEntities];
        } catch (e) {
            this.logReport(`Ошибка разбора JSON: ${e.message}`, 'error');
            return null;
        }
    }

    // --- 4. DXF ПАРСЕР (nanoCAD / AutoCAD) ---
    parseDXFText(text) {
        const primitives = [];
        const rawLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        const lines = [];
        for (let j = 0; j < rawLines.length; j++) {
            const trimmed = rawLines[j].trim();
            if (trimmed.length > 0) lines.push(trimmed);
        }

        let i = 0;
        const totalLines = lines.length;

        // Поиск групп кодов DXF
        while (i < totalLines - 1) {
            const code = parseInt(lines[i], 10);
            const val = lines[i + 1] ? lines[i + 1] : '';

            if (code === 0) { // Начало сущности
                const entityType = val.toUpperCase();

                if (['LINE', 'CIRCLE', 'ARC', 'LWPOLYLINE', 'POLYLINE', 'ELLIPSE', 'SPLINE'].includes(entityType)) {
                    i += 2;
                    const entityData = { type: entityType };

                    while (i < totalLines - 1) {
                        const subCode = parseInt(lines[i], 10);
                        const subVal = lines[i + 1] ? lines[i + 1] : '';

                        if (subCode === 0) break; // Завершение текущей сущности

                        // Парсинг параметров в зависимости от кода
                        if (entityType === 'LINE') {
                            if (subCode === 10) entityData.x1 = parseFloat(subVal);
                            if (subCode === 20) entityData.y1 = parseFloat(subVal);
                            if (subCode === 11) entityData.x2 = parseFloat(subVal);
                            if (subCode === 21) entityData.y2 = parseFloat(subVal);
                        } else if (entityType === 'CIRCLE') {
                            if (subCode === 10) entityData.cx = parseFloat(subVal);
                            if (subCode === 20) entityData.cy = parseFloat(subVal);
                            if (subCode === 40) entityData.r = parseFloat(subVal);
                        } else if (entityType === 'ARC') {
                            if (subCode === 10) entityData.cx = parseFloat(subVal);
                            if (subCode === 20) entityData.cy = parseFloat(subVal);
                            if (subCode === 40) entityData.r = parseFloat(subVal);
                            if (subCode === 50) entityData.startAngle = parseFloat(subVal) * (Math.PI / 180); // рад
                            if (subCode === 51) entityData.endAngle = parseFloat(subVal) * (Math.PI / 180);   // рад
                        } else if (entityType === 'LWPOLYLINE' || entityType === 'POLYLINE') {
                            entityData.points = entityData.points || [];
                            entityData.bulges = entityData.bulges || [];
                            if (subCode === 70) entityData.closed = (parseInt(subVal, 10) & 1) !== 0;

                            if (subCode === 10) {
                                entityData.points.push({ x: parseFloat(subVal), y: 0 });
                            }
                            if (subCode === 20 && entityData.points.length > 0) {
                                entityData.points[entityData.points.length - 1].y = parseFloat(subVal);
                            }
                            if (subCode === 42) {
                                entityData.bulges.push(parseFloat(subVal));
                            }
                        } else if (entityType === 'ELLIPSE') {
                            if (subCode === 10) entityData.cx = parseFloat(subVal);
                            if (subCode === 20) entityData.cy = parseFloat(subVal);
                            if (subCode === 11) entityData.mx = parseFloat(subVal);
                            if (subCode === 21) entityData.my = parseFloat(subVal);
                            if (subCode === 40) entityData.ratio = parseFloat(subVal);
                            if (subCode === 41) entityData.startParam = parseFloat(subVal);
                            if (subCode === 42) entityData.endParam = parseFloat(subVal);
                        } else if (entityType === 'SPLINE') {
                            entityData.points = entityData.points || [];
                            if (subCode === 10 || subCode === 11) {
                                entityData.points.push({ x: parseFloat(subVal), y: 0 });
                            }
                            if ((subCode === 20 || subCode === 21) && entityData.points.length > 0) {
                                entityData.points[entityData.points.length - 1].y = parseFloat(subVal);
                            }
                        }

                        i += 2;
                    }

                    // Валидация и добавление примитива
                    if (entityType === 'LINE' && !isNaN(entityData.x1) && !isNaN(entityData.x2)) {
                        primitives.push(entityData);
                    } else if (entityType === 'CIRCLE' && !isNaN(entityData.cx) && !isNaN(entityData.r)) {
                        primitives.push(entityData);
                    } else if (entityType === 'ARC' && !isNaN(entityData.cx) && !isNaN(entityData.r)) {
                        primitives.push(entityData);
                    } else if ((entityType === 'LWPOLYLINE' || entityType === 'POLYLINE') && entityData.points && entityData.points.length > 1) {
                        primitives.push(entityData);
                    } else if (entityType === 'ELLIPSE' && !isNaN(entityData.cx) && !isNaN(entityData.mx)) {
                        if (isNaN(entityData.startParam)) entityData.startParam = 0;
                        if (isNaN(entityData.endParam)) entityData.endParam = Math.PI * 2;
                        primitives.push(entityData);
                    } else if (entityType === 'SPLINE' && entityData.points && entityData.points.length > 1) {
                        primitives.push(entityData);
                    }

                    continue;
                }
            }
            i += 2;
        }

        return primitives;
    }

    // --- 5. SVG ПАРСЕР (ФОЛБЕК ДЛЯ ВЕКТОРНОЙ ГЕОМЕТРИИ) ---
    parseSVGText(svgText) {
        const primitives = [];
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(svgText, 'image/svg+xml');

            // Lines
            doc.querySelectorAll('line').forEach(el => {
                primitives.push({
                    type: 'LINE',
                    x1: parseFloat(el.getAttribute('x1') || 0),
                    y1: parseFloat(el.getAttribute('y1') || 0),
                    x2: parseFloat(el.getAttribute('x2') || 0),
                    y2: parseFloat(el.getAttribute('y2') || 0)
                });
            });

            // Circles
            doc.querySelectorAll('circle').forEach(el => {
                primitives.push({
                    type: 'CIRCLE',
                    cx: parseFloat(el.getAttribute('cx') || 0),
                    cy: parseFloat(el.getAttribute('cy') || 0),
                    r: parseFloat(el.getAttribute('r') || 0)
                });
            });

            // Rectangles -> LWPOLYLINE
            doc.querySelectorAll('rect').forEach(el => {
                const x = parseFloat(el.getAttribute('x') || 0);
                const y = parseFloat(el.getAttribute('y') || 0);
                const w = parseFloat(el.getAttribute('width') || 0);
                const h = parseFloat(el.getAttribute('h') || el.getAttribute('height') || 0);
                primitives.push({
                    type: 'LWPOLYLINE',
                    points: [
                        { x: x, y: y },
                        { x: x + w, y: y },
                        { x: x + w, y: y + h },
                        { x: x, y: y + h }
                    ],
                    closed: true
                });
            });

            // Polylines / Polygons
            doc.querySelectorAll('polyline, polygon').forEach(el => {
                const isPolygon = el.tagName.toLowerCase() === 'polygon';
                const ptsRaw = (el.getAttribute('points') || '').trim().split(/[\s,]+/);
                const points = [];
                for (let k = 0; k < ptsRaw.length - 1; k += 2) {
                    points.push({ x: parseFloat(ptsRaw[k]), y: parseFloat(ptsRaw[k + 1]) });
                }
                if (points.length > 1) {
                    primitives.push({
                        type: 'LWPOLYLINE',
                        points: points,
                        closed: isPolygon
                    });
                }
            });

        } catch (e) {
            this.logReport(`Ошибка разбора SVG: ${e.message}`, 'error');
        }
        return primitives;
    }

    // --- 3.0. ЗЕРКАЛЬНОЕ ОТРАЖЕНИЕ ПО ГОРИЗОНТАЛЬНОЙ ОСИ (Y -> -Y) ---
    mirrorPrimitivesHorizontally(primitives) {
        if (!primitives || !Array.isArray(primitives)) return;
        this.logReport('Отражение геометрии по горизонтальной оси (Y -> -Y)...', 'info');
        primitives.forEach(p => {
            if (p.type === 'LINE') {
                if (p.y1 !== undefined) p.y1 = -p.y1;
                if (p.y2 !== undefined) p.y2 = -p.y2;
                if (p.p1 && p.p1.y !== undefined) p.p1.y = -p.p1.y;
                if (p.p2 && p.p2.y !== undefined) p.p2.y = -p.p2.y;
            } else if (p.type === 'CIRCLE') {
                if (p.cy !== undefined) p.cy = -p.cy;
                if (p.center && p.center.y !== undefined) p.center.y = -p.center.y;
            } else if (p.type === 'ARC') {
                if (p.cy !== undefined) p.cy = -p.cy;
                if (p.center && p.center.y !== undefined) p.center.y = -p.center.y;
                const oldStart = p.startAngle || 0;
                const oldEnd = p.endAngle || 0;
                p.startAngle = -oldEnd;
                p.endAngle = -oldStart;
                const cx = p.cx !== undefined ? p.cx : (p.center ? p.center.x : 0);
                const cy = p.cy !== undefined ? p.cy : (p.center ? p.center.y : 0);
                const r = p.radius !== undefined ? p.radius : (p.r !== undefined ? p.r : 0);
                p.p1 = { x: cx + r * Math.cos(p.startAngle), y: cy + r * Math.sin(p.startAngle) };
                p.p2 = { x: cx + r * Math.cos(p.endAngle), y: cy + r * Math.sin(p.endAngle) };
            } else if (p.type === 'LWPOLYLINE' || p.type === 'POLYLINE' || p.type === 'SPLINE') {
                if (p.points) {
                    p.points.forEach(pt => {
                        if (pt.y !== undefined) pt.y = -pt.y;
                    });
                }
                if (p.p1 && p.p1.y !== undefined) p.p1.y = -p.p1.y;
                if (p.p2 && p.p2.y !== undefined) p.p2.y = -p.p2.y;
                if (p.bulges) {
                    p.bulges = p.bulges.map(b => -b);
                }
            } else if (p.type === 'ELLIPSE') {
                if (p.cy !== undefined) p.cy = -p.cy;
                if (p.my !== undefined) p.my = -p.my;
                if (p.center && p.center.y !== undefined) p.center.y = -p.center.y;
            }
        });
    }

    // --- 3.1. НОРМАЛИЗАЦИЯ И ЦЕНТРИРОВАНИЕ ГЕОМЕТРИИ (setupGhost) ---
    setupGhost(primitives) {
        if (!primitives || primitives.length === 0) return null;

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        const addPoint = (x, y) => {
            if (isNaN(x) || isNaN(y)) return;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        };

        primitives.forEach(p => {
            if (p.type === 'LINE') {
                addPoint(p.x1, p.y1);
                addPoint(p.x2, p.y2);
            } else if (p.type === 'CIRCLE') {
                addPoint(p.cx - p.r, p.cy - p.r);
                addPoint(p.cx + p.r, p.cy + p.r);
            } else if (p.type === 'ARC') {
                const steps = 16;
                let a1 = p.startAngle || 0;
                let a2 = p.endAngle || 0;
                if (a2 < a1) a2 += Math.PI * 2;
                for (let k = 0; k <= steps; k++) {
                    const ang = a1 + (a2 - a1) * (k / steps);
                    addPoint(p.cx + p.r * Math.cos(ang), p.cy + p.r * Math.sin(ang));
                }
            } else if (p.type === 'LWPOLYLINE' || p.type === 'POLYLINE') {
                (p.points || []).forEach(pt => addPoint(pt.x, pt.y));
            } else if (p.type === 'ELLIPSE') {
                const steps = 32;
                const rRatio = p.ratio || 0.5;
                const mLon = Math.hypot(p.mx, p.my);
                const phi = Math.atan2(p.my, p.mx);
                for (let k = 0; k <= steps; k++) {
                    const t = p.startParam + (p.endParam - p.startParam) * (k / steps);
                    const lx = mLon * Math.cos(t);
                    const ly = rRatio * mLon * Math.sin(t);
                    const wx = p.cx + lx * Math.cos(phi) - ly * Math.sin(phi);
                    const wy = p.cy + lx * Math.sin(phi) + ly * Math.cos(phi);
                    addPoint(wx, wy);
                }
            } else if (p.type === 'SPLINE') {
                (p.points || []).forEach(pt => addPoint(pt.x, pt.y));
            }
        });

        if (minX === Infinity) {
            minX = -50; maxX = 50; minY = -50; maxY = 50;
        }

        const width = maxX - minX;
        const height = maxY - minY;
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        const bbox = { minX, maxX, minY, maxY, width, height, centerX, centerY };
        this.boundingBox = bbox;

        // Приведение координат всех примитивов к локальным (относительно геометрического центра)
        primitives.forEach(p => {
            if (p.type === 'LINE') {
                p.x1 -= centerX;
                p.y1 -= centerY;
                p.x2 -= centerX;
                p.y2 -= centerY;
            } else if (p.type === 'CIRCLE' || p.type === 'ARC') {
                p.cx -= centerX;
                p.cy -= centerY;
            } else if (p.type === 'LWPOLYLINE' || p.type === 'POLYLINE') {
                (p.points || []).forEach(pt => {
                    pt.x -= centerX;
                    pt.y -= centerY;
                });
            } else if (p.type === 'ELLIPSE') {
                p.cx -= centerX;
                p.cy -= centerY;
            } else if (p.type === 'SPLINE') {
                (p.points || []).forEach(pt => {
                    pt.x -= centerX;
                    pt.y -= centerY;
                });
            }
        });

        this.logReport(`setupGhost нормализация завершена. Центр исходных данных: (${centerX.toFixed(2)}, ${centerY.toFixed(2)})`, 'info');
        return bbox;
    }

    // Сохраняем обратную совместимость
    calculateBoundingBox(primitives) {
        return this.setupGhost(primitives);
    }

    // --- Вспомогательные безопасные обертки для проекций ---
    safeProject2Dto3D(u, v, basis) {
        if (typeof project2Dto3D === 'function') return project2Dto3D(u, v, basis);
        if (typeof window.project2Dto3D === 'function') return window.window.project2Dto3D(u, v, basis);
        if (typeof window.project2Dto3D === 'function') return window.project2Dto3D(u, v, basis);
        this.logReport('Критическая ошибка: функция project2Dto3D не найдена!', 'error');
        return new THREE.Vector3();
    }

    safeProject3Dto2D(pt3d, basis) {
        if (typeof project3Dto2D === 'function') return project3Dto2D(pt3d, basis);
        if (typeof window.project3Dto2D === 'function') return window.window.project3Dto2D(pt3d, basis);
        if (typeof window.project3Dto2D === 'function') return window.project3Dto2D(pt3d, basis);
        this.logReport('Критическая ошибка: функция project3Dto2D не найдена!', 'error');
        return { u: 0, v: 0 };
    }

    safeGetPlaneBasis(plane) {
        if (typeof getPlaneBasis === 'function') return getPlaneBasis(plane);
        if (typeof window.getPlaneBasis === 'function') return window.window.getPlaneBasis(plane);
        if (typeof window.getPlaneBasis === 'function') return window.getPlaneBasis(plane);
        this.logReport('Критическая ошибка: функция getPlaneBasis не найдена!', 'error');
        return { origin: new THREE.Vector3(), right: new THREE.Vector3(1,0,0), up: new THREE.Vector3(0,1,0) };
    }

    // --- 3.2. ОТРИСОВКА ФАНТОМА (renderGhost) ---
    createGhostMesh(primitives, bbox) {
        // Удаляем предыдущий фантом, если есть
        if (this.ghostGroup) {
            if (typeof sketchGroup !== 'undefined' && sketchGroup) sketchGroup.remove(this.ghostGroup);
            this.ghostGroup = null;
        }

        const group = new THREE.Group();
        group.name = 'cadClipboardGhostGroup';

        // Стиль внешнего контура (OUTER): цвет #38bdf8, стиль линии dash (пунктир [6, 4]), толщина 2px
        const outerLineMat = new THREE.LineDashedMaterial({
            color: 0x38bdf8,
            dashSize: 6,
            gapSize: 4,
            transparent: true,
            opacity: 0.85,
            depthTest: false,
            linewidth: 2
        });

        // Стиль внутренних элементов (INNER): цвет #fbbf24, стиль линии dash (пунктир [6, 4]), толщина 2px
        const innerLineMat = new THREE.LineDashedMaterial({
            color: 0xfbbf24,
            dashSize: 6,
            gapSize: 4,
            transparent: true,
            opacity: 0.85,
            depthTest: false,
            linewidth: 2
        });

        // Bounding Box пунктирный прямоугольник (рисуем синим/нейтральным цветом)
        const hw = bbox.width / 2;
        const hh = bbox.height / 2;
        const bboxPts = [
            new THREE.Vector3(-hw, -hh, 0),
            new THREE.Vector3(hw, -hh, 0),
            new THREE.Vector3(hw, hh, 0),
            new THREE.Vector3(-hw, hh, 0),
            new THREE.Vector3(-hw, -hh, 0)
        ];
        const bboxGeo = new THREE.BufferGeometry().setFromPoints(bboxPts);
        const bboxLine = new THREE.Line(bboxGeo, outerLineMat);
        bboxLine.computeLineDistances();
        group.add(bboxLine);

        // Перекрестие в центре фантома (0,0)
        const crossSize = Math.max(5, Math.min(bbox.width, bbox.height) * 0.08);
        const crossPts = [
            new THREE.Vector3(-crossSize, 0, 0), new THREE.Vector3(crossSize, 0, 0),
            new THREE.Vector3(0, -crossSize, 0), new THREE.Vector3(0, crossSize, 0)
        ];
        const crossGeo = new THREE.BufferGeometry().setFromPoints(crossPts);
        const crossLine = new THREE.LineSegments(crossGeo, outerLineMat);
        crossLine.computeLineDistances();
        group.add(crossLine);

        // Добавляем примитивы (которые уже локализованы/центрированы в setupGhost)
        primitives.forEach(p => {
            const mat = p.role === 'INNER' ? innerLineMat : outerLineMat;

            if (p.type === 'LINE') {
                const geo = new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(p.x1, p.y1, 0),
                    new THREE.Vector3(p.x2, p.y2, 0)
                ]);
                const line = new THREE.Line(geo, mat);
                line.computeLineDistances();
                group.add(line);
            } else if (p.type === 'CIRCLE') {
                const pts = [];
                const steps = 48;
                for (let k = 0; k <= steps; k++) {
                    const a = (k / steps) * Math.PI * 2;
                    pts.push(new THREE.Vector3(p.cx + p.r * Math.cos(a), p.cy + p.r * Math.sin(a), 0));
                }
                const geo = new THREE.BufferGeometry().setFromPoints(pts);
                const circle = new THREE.Line(geo, mat);
                circle.computeLineDistances();
                group.add(circle);
            } else if (p.type === 'ARC') {
                const pts = [];
                const steps = 32;
                let a1 = p.startAngle || 0;
                let a2 = p.endAngle || 0;
                if (a2 < a1) a2 += Math.PI * 2;
                for (let k = 0; k <= steps; k++) {
                    const a = a1 + (a2 - a1) * (k / steps);
                    pts.push(new THREE.Vector3(p.cx + p.r * Math.cos(a), p.cy + p.r * Math.sin(a), 0));
                }
                if (p.reversed) pts.reverse();
                const geo = new THREE.BufferGeometry().setFromPoints(pts);
                const arc = new THREE.Line(geo, mat);
                arc.computeLineDistances();
                group.add(arc);
            } else if (p.type === 'LWPOLYLINE' || p.type === 'POLYLINE') {
                const pts = (p.points || []).map(pt => new THREE.Vector3(pt.x, pt.y, 0));
                if (p.closed && pts.length > 0) pts.push(pts[0].clone());
                if (pts.length > 1) {
                    const geo = new THREE.BufferGeometry().setFromPoints(pts);
                    const poly = new THREE.Line(geo, mat);
                    poly.computeLineDistances();
                    group.add(poly);
                }
            } else if (p.type === 'ELLIPSE') {
                const pts = [];
                const steps = 32;
                const rRatio = p.ratio || 0.5;
                const mLon = Math.hypot(p.mx, p.my);
                const phi = Math.atan2(p.my, p.mx);
                for (let k = 0; k <= steps; k++) {
                    const t = p.startParam + (p.endParam - p.startParam) * (k / steps);
                    const lx = mLon * Math.cos(t);
                    const ly = rRatio * mLon * Math.sin(t);
                    const wx = p.cx + lx * Math.cos(phi) - ly * Math.sin(phi);
                    const wy = p.cy + lx * Math.sin(phi) + ly * Math.cos(phi);
                    pts.push(new THREE.Vector3(wx, wy, 0));
                }
                const geo = new THREE.BufferGeometry().setFromPoints(pts);
                const ell = new THREE.Line(geo, mat);
                ell.computeLineDistances();
                group.add(ell);
            } else if (p.type === 'SPLINE') {
                const pts = (p.points || []).map(pt => new THREE.Vector3(pt.x, pt.y, 0));
                if (pts.length > 1) {
                    const geo = new THREE.BufferGeometry().setFromPoints(pts);
                    const spl = new THREE.Line(geo, mat);
                    spl.computeLineDistances();
                    group.add(spl);
                }
            }
        });

        // Позиционируем группу на активную плоскость эскиза
        const basis = this.safeGetPlaneBasis(activeSketchPlane);
        const origin3d = this.safeProject2Dto3D(0, 0, basis);
        group.position.copy(origin3d);

        // Ориентация фантома в плоскости эскиза
        const rotMat = new THREE.Matrix4();
        rotMat.makeBasis(basis.right, basis.up, new THREE.Vector3().crossVectors(basis.right, basis.up).normalize());
        group.rotation.setFromRotationMatrix(rotMat);

        if (typeof sketchGroup !== 'undefined' && sketchGroup) {
            sketchGroup.add(group);
        } else if (typeof creatorScene !== 'undefined' && creatorScene) {
            creatorScene.add(group);
        }

        this.ghostGroup = group;
        this.state = 'PASTE_GHOST';
        this.logReport('Активирован режим фантома (PASTE_GHOST)', 'info');
    }

    // --- 8. ОБНОВЛЕНИЕ ПОЗИЦИИ ФАНТОМА ---
    updateGhostPosition(targetPos3D) {
        if (!this.ghostGroup || this.state !== 'PASTE_GHOST') return;
        this.ghostGroup.position.copy(targetPos3D);
    }

    // --- 3.3. ПРИМЕНЕНИЕ ТРАНСФОРМАЦИИ И ФИКСАЦИЯ (commitImport) ---
    commitImport(targetWorldPos) {
        if (this.state !== 'PASTE_GHOST' || !this.parsedPrimitives || !this.boundingBox) return;

        this.state = 'COMMIT';
        this.logReport('Фиксация вставки объектов в эскиз (COMMIT)...', 'info');

        const basis = this.safeGetPlaneBasis(activeSketchPlane);
        const target2D = this.safeProject3Dto2D(targetWorldPos, basis);

        let addedSegmentsCount = 0;
        let addedCirclesCount = 0;

        // Создаем временный стек для локальной операции отмены (Undo)
        const previousSegments = typeof sketchSegments !== 'undefined' ? [...sketchSegments] : [];
        const previousCircles = typeof sketchCircles !== 'undefined' ? [...sketchCircles] : [];

        const finalEntities = [];

        // Инициализируем глобальный массив sketchEntities если он не существует
        window.sketchEntities = window.sketchEntities || [];

        // Пересчитываем локальные координаты каждого примитива в мировые
        this.parsedPrimitives.forEach(p => {
            const role = p.role || 'OUTER';
            const entity = { type: p.type, role: role };

            if (p.type === 'LINE') {
                const u1 = target2D.u + p.x1;
                const v1 = target2D.v + p.y1;
                const u2 = target2D.u + p.x2;
                const v2 = target2D.v + p.y2;

                const p1_3d = this.safeProject2Dto3D(u1, v1, basis);
                const p2_3d = this.safeProject2Dto3D(u2, v2, basis);

                if (typeof sketchSegments !== 'undefined') {
                    sketchSegments.push({ start: p1_3d, end: p2_3d, role: role });
                    addedSegmentsCount++;
                }

                entity.start = p1_3d.clone();
                entity.end = p2_3d.clone();
                entity.p1 = { x: u1, y: v1 };
                entity.p2 = { x: u2, y: v2 };
            } else if (p.type === 'CIRCLE') {
                const u = target2D.u + p.cx;
                const v = target2D.v + p.cy;
                const center3d = this.safeProject2Dto3D(u, v, basis);

                if (typeof sketchCircles !== 'undefined') {
                    sketchCircles.push({ center: center3d, radius: p.r, role: role });
                    addedCirclesCount++;
                }

                entity.center = center3d.clone();
                entity.radius = p.r;
                entity.center2d = { x: u, y: v };

                // Отрисовываем меш окружности в эскизе
                if (typeof sketchGroup !== 'undefined' && sketchGroup) {
                    const mat = new THREE.LineBasicMaterial({ color: 0x2A3142, linewidth: 2, depthTest: false });
                    const geo = new THREE.CircleGeometry(p.r, 64);
                    const edges = new THREE.EdgesGeometry(geo, 15);
                    const circleLine = new THREE.LineSegments(edges, mat);
                    circleLine.position.copy(center3d);
                    circleLine.renderOrder = 1;
                    circleLine.isSketchCircleMesh = true;
                    if (typeof alignToPlane === 'function') {
                        alignToPlane(circleLine, activeSketchPlane);
                    }
                    sketchGroup.add(circleLine);
                }
            } else if (p.type === 'ARC') {
                const steps = 24;
                let a1 = p.startAngle || 0;
                let a2 = p.endAngle || 0;
                if (a2 < a1) a2 += Math.PI * 2;

                const arcPoints = [];
                for (let k = 0; k <= steps; k++) {
                    const ang = a1 + (a2 - a1) * (k / steps);
                    const u = (target2D.u + p.cx) + p.r * Math.cos(ang);
                    const v = (target2D.v + p.cy) + p.r * Math.sin(ang);
                    const curPt3d = this.safeProject2Dto3D(u, v, basis);
                    arcPoints.push(curPt3d.clone());
                }
                if (p.reversed) arcPoints.reverse();

                if (typeof sketchSegments !== 'undefined') {
                    for (let k = 0; k < arcPoints.length - 1; k++) {
                        sketchSegments.push({ start: arcPoints[k], end: arcPoints[k + 1], role: role });
                        addedSegmentsCount++;
                    }
                }
                entity.points = arcPoints;
                entity.center2d = { x: target2D.u + p.cx, y: target2D.v + p.cy };
                entity.radius = p.r;
                entity.startAngle = p.startAngle;
                entity.endAngle = p.endAngle;
            } else if (p.type === 'LWPOLYLINE' || p.type === 'POLYLINE') {
                const pts = (p.points || []).map(pt => {
                    const u = target2D.u + pt.x;
                    const v = target2D.v + pt.y;
                    return this.safeProject2Dto3D(u, v, basis);
                });

                if (typeof sketchSegments !== 'undefined') {
                    for (let k = 0; k < pts.length - 1; k++) {
                        sketchSegments.push({ start: pts[k], end: pts[k + 1], role: role });
                        addedSegmentsCount++;
                    }

                    if (p.closed && pts.length > 2) {
                        sketchSegments.push({ start: pts[pts.length - 1], end: pts[0], role: role });
                        addedSegmentsCount++;
                    }
                }
                entity.points = pts;
                entity.closed = p.closed;
                entity.isClosed = p.closed;
            } else if (p.type === 'ELLIPSE') {
                const steps = 32;
                const rRatio = p.ratio || 0.5;
                const mLon = Math.hypot(p.mx, p.my);
                const phi = Math.atan2(p.my, p.mx);

                let lastPt3d = null;
                const ellipsePoints = [];
                for (let k = 0; k <= steps; k++) {
                    const t = p.startParam + (p.endParam - p.startParam) * (k / steps);
                    const lx = mLon * Math.cos(t);
                    const ly = rRatio * mLon * Math.sin(t);
                    const u = (target2D.u + p.cx) + lx * Math.cos(phi) - ly * Math.sin(phi);
                    const v = (target2D.v + p.cy) + lx * Math.sin(phi) + ly * Math.cos(phi);
                    const curPt3d = this.safeProject2Dto3D(u, v, basis);

                    if (lastPt3d && typeof sketchSegments !== 'undefined') {
                        sketchSegments.push({ start: lastPt3d, end: curPt3d, role: role });
                        addedSegmentsCount++;
                    }
                    lastPt3d = curPt3d;
                    ellipsePoints.push(curPt3d.clone());
                }
                entity.points = ellipsePoints;
            } else if (p.type === 'SPLINE') {
                const pts = (p.points || []).map(pt => {
                    return this.safeProject2Dto3D(target2D.u + pt.x, target2D.v + pt.y, basis);
                });

                if (typeof sketchSegments !== 'undefined') {
                    for (let k = 0; k < pts.length - 1; k++) {
                        sketchSegments.push({ start: pts[k], end: pts[k + 1], role: role });
                        addedSegmentsCount++;
                    }
                }
                entity.points = pts;
            }

            finalEntities.push(entity);
            window.sketchEntities.push(entity);
        });

        // Запись операции в Undo/Redo Manager если он существует в системе
        if (typeof window.sketchStore !== 'undefined' && typeof window.sketchStore.addEntities === 'function') {
            window.sketchStore.addEntities(finalEntities);
        }

        // Локальная регистрация Undo/Redo
        this.undoStack = this.undoStack || [];
        this.undoStack.push({
            segmentsBefore: previousSegments,
            circlesBefore: previousCircles,
            segmentsCount: addedSegmentsCount,
            circlesCount: addedCirclesCount
        });

        // Перерисовываем эскиз
        if (typeof window.rebuildSketchLines === 'function') {
            window.rebuildSketchLines();
        }

        // Автоматическая проверка на разрывы и подсветка красными кругами
        if (typeof window.checkAndHighlightSketchGaps === 'function') {
            window.checkAndHighlightSketchGaps({ notifyUser: true, showToastSuccess: true });
        }

        // Очищаем фантом
        this.wasGhostActiveJustNow = true;
        this.cancelImport();
        setTimeout(() => {
            this.wasGhostActiveJustNow = false;
        }, 100);

        this.logReport(`Успешно вставлено объектов: отрезков = ${addedSegmentsCount}, окружностей = ${addedCirclesCount}`, 'success');
        if (typeof showToast === 'function') {
            showToast(`Успешно вставлено в эскиз: ${addedSegmentsCount} отрезков, ${addedCirclesCount} окружностей`);
        }
    }

    // Обратная совместимость
    applyOffsetAndCommit(targetPos3D) {
        this.commitImport(targetPos3D);
    }

    cancelImport() {
        if (this.ghostGroup) {
            if (typeof sketchGroup !== 'undefined' && sketchGroup) sketchGroup.remove(this.ghostGroup);
            else if (typeof creatorScene !== 'undefined' && creatorScene) creatorScene.remove(this.ghostGroup);
            this.ghostGroup = null;
        }
        this.wasGhostActiveJustNow = true;
        setTimeout(() => {
            this.wasGhostActiveJustNow = false;
        }, 100);
        this.state = 'IDLE';
        this.currentSnappedPos = null;
        this.logReport('Импорт завершен/отменен. Состояние IDLE.', 'info');
    }

    // --- 10. ОБРАБОТЧИКИ ДВИЖЕНИЯ И КЛИКОВ МЫШИ ---
    handleMouseMove(e) {
        if (this.state !== 'PASTE_GHOST') return;

        if (!this.mouseleaveBound) {
            const canvas_element = document.getElementById("canvas-creator");
            if (canvas_element) {
                canvas_element.addEventListener('mouseleave', () => {
                    if (this.state === 'PASTE_GHOST') {
                        this.cancelImport();
                        const tooltip = document.getElementById('sketch-hud-tooltip');
                        if (tooltip) tooltip.style.display = 'none';
                        if (typeof showToast === 'function') showToast('Вставка из буфера отменена');
                    }
                });
                this.mouseleaveBound = true;
            }
        }

        if (typeof activeSketchPlane === 'undefined' || !activeSketchPlane || typeof isSketchMode === 'undefined' || !isSketchMode) {
            this.cancelImport();
            return;
        }

        const canvas_element = document.getElementById("canvas-creator");
        if (!canvas_element) return;
        const rect = canvas_element.getBoundingClientRect();
        const mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const mouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        const camera = typeof currentCreatorCamera !== 'undefined' ? currentCreatorCamera : (typeof creatorCamera !== 'undefined' ? creatorCamera : null);
        if (!camera) return;

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), camera);

        if (typeof getSketchPlaneIntersection === 'function' && typeof activeSketchPlane !== 'undefined' && activeSketchPlane) {
            const intersectionPt = getSketchPlaneIntersection(raycaster, activeSketchPlane);
            if (intersectionPt) {
                const snappedPt = typeof applySnapsAndOrtho === 'function' ? applySnapsAndOrtho(intersectionPt, true) : intersectionPt;
                this.currentSnappedPos = snappedPt;
                this.updateGhostPosition(snappedPt);

                const tooltip = document.getElementById('sketch-hud-tooltip');
                if (tooltip) {
                    const basis = this.safeGetPlaneBasis(activeSketchPlane);
                    const local2d = this.safeProject3Dto2D(snappedPt, basis);
                    tooltip.innerText = `[ Вставка CAD: X=${local2d.u.toFixed(1)}, Y=${local2d.v.toFixed(1)} мм | ЛКМ - вставить, ПКМ / Esc - отмена ]`;
                    tooltip.style.display = 'block';
                }
            }
        }
    }

    handlePointerDown(e) {
        if (this.state !== 'PASTE_GHOST') return;

        // ЛКМ фиксация вставки (COMMIT)
        if (e.button === 0 && this.currentSnappedPos) {
            e.preventDefault();
            e.stopPropagation();
            this.commitImport(this.currentSnappedPos);

            const tooltip = document.getElementById('sketch-hud-tooltip');
            if (tooltip) tooltip.style.display = 'none';
        }
        // ПКМ отмена операции
        else if (e.button === 2) {
            e.preventDefault();
            e.stopPropagation();
            this.cancelImport();

            const tooltip = document.getElementById('sketch-hud-tooltip');
            if (tooltip) tooltip.style.display = 'none';

            if (typeof showToast === 'function') showToast('Вставка из буфера отменена');
        }
    }

    handleKeyDown(e) {
        if (this.state !== 'PASTE_GHOST') return;

        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            this.cancelImport();

            const tooltip = document.getElementById('sketch-hud-tooltip');
            if (tooltip) tooltip.style.display = 'none';

            if (typeof showToast === 'function') showToast('Вставка из буфера отменена');
        }
    }
}

// Экспортируем синглтон класс глобально
window.CadClipboardImporter = CadClipboardImporter;

window.triggerCadClipboardImport = function() {
    if (!window.cadClipboardImporter && window.CadClipboardImporter) {
        window.cadClipboardImporter = new window.CadClipboardImporter();
    }
    if (window.cadClipboardImporter) {
        window.cadClipboardImporter.triggerClipboardImport();
    }
};

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => {
        window.cadClipboardImporter = new CadClipboardImporter();
    });
} else {
    window.cadClipboardImporter = new CadClipboardImporter();
}
