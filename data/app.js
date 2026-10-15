// --- УТИЛИТЫ ---
function updateDate() {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const el = document.getElementById('current-date');
    if (el) el.innerText = 'Сегодня: ' + new Date().toLocaleDateString('ru-RU', options);
}

function showToast(message) {
    const toast = document.getElementById('toast');
    if (toast) {
        toast.innerText = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }
}

// --- БАЗА ДАННЫХ (IndexedDB для сохранения доступа к файлу) ---
const DB_NAME = 'HullNavigatorDB_v2';
const STORE_NAME = 'file_handles';

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (e) => e.target.result.createObjectStore(STORE_NAME);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function saveHandle(handle) {
    const db = await initDB();
    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(handle, 'accountHandle');
        tx.oncomplete = () => resolve();
    });
}

async function getHandle() {
    const db = await initDB();
    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get('accountHandle');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
    });
}

async function clearHandle() {
    const db = await initDB();
    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete('accountHandle');
        tx.oncomplete = () => resolve();
    });
}

// --- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ---
let currentFileHandle = null;
let isTestMode = false;
let requestsData = [];
let documentsData = [];
let foremenList = [];
let logsDataToAppend = [];
let currentUser = { firstName: "Гость", lastName: "" };
let scene, camera, renderer, controls;
let isCameraFlying = false;
let flyTargetPos = null;
let flyTargetLook = null;
let activeZoneCategory = 'production'; // По умолчанию включена категория "Рабочее"

// --- ПАРАМЕТРЫ ПРОГРАММЫ ---
let appSettings = {
    hotkeyDoc: "Ctrl+Ж"
};

// --- ХЕЛПЕРЫ ДЛЯ ЛОГОВ И EXCEL ---
function getSheet(workbook, name) {
    return workbook.getWorksheet(name) || workbook.worksheets.find(ws => ws.name.toLowerCase() === name.toLowerCase());
}

function getColMap(sheet) {
    const map = {};
    if (!sheet) return map;
    const headerRow = sheet.getRow(1);
    if (headerRow) {
        headerRow.eachCell((cell, colNum) => {
            const val = String(getVal(cell)).trim().toLowerCase();
            if (val) map[val] = colNum;
        });
    }
    return map;
}

function addLog(action, details) {
    logsDataToAppend.push({
        date: new Date(),
        action: action,
        details: details
    });
}

function getVal(cell) {
    if (!cell || cell.value === null || cell.value === undefined) return '';
    let v = cell.value;
    if (typeof v === 'object') {
        if (v.result !== undefined) return v.result;
        if (v.richText) return v.richText.map(rt => rt.text).join('');
        if (v.text) return v.text;
        if (v instanceof Date) return v;
    }
    return v;
}

// --- ЛОГИКА АВТОРИЗАЦИИ И ЧТЕНИЯ ---
async function checkAuth() {
    try {
        const storedData = await getHandle();
        if (storedData) {
            const actualHandle = storedData.fileHandle || storedData;
            currentFileHandle = actualHandle;
            if ((await actualHandle.queryPermission({ mode: 'readwrite' })) === 'granted') {
                await readAccountFile(actualHandle);
            } else {
            if (document.getElementById('login-state-new')) document.getElementById('login-state-new').style.display = 'none';
            if (document.getElementById('login-state-resume')) document.getElementById('login-state-resume').style.display = 'block';
            if (document.getElementById('login-overlay')) document.getElementById('login-overlay').classList.remove('hidden');
            }
            return;
        }
    } catch (e) { console.error("Ошибка сессии:", e); }
    
    if (document.getElementById('login-state-new')) document.getElementById('login-state-new').style.display = 'block';
    if (document.getElementById('login-state-resume')) document.getElementById('login-state-resume').style.display = 'none';
    if (document.getElementById('login-overlay')) document.getElementById('login-overlay').classList.remove('hidden');
}

async function resumeSession() {
    try {
        if (currentFileHandle) {
            const permission = await currentFileHandle.requestPermission({ mode: 'readwrite' });
            if (permission === 'granted') {
                await readAccountFile(currentFileHandle);
            } else {
                showToast("Доступ отклонен");
                logout();
            }
        }
    } catch (error) { logout(); }
}

async function selectAccountsFolder() {
    try {
        const rootDirHandle = await window.showDirectoryPicker();
        const accountsList = document.getElementById('accounts-list');
        accountsList.innerHTML = '<p style="color: var(--text-muted); font-size: 13px;">Сканирование...</p>';

        let foundAccounts = [];
        
        // Убрана жесткая привязка к подпапке "Файлы данных".
        // Теперь программа сканирует выбранную вами корневую папку "данные программы".
        for await (const entry of rootDirHandle.values()) {
            if (entry.kind === 'file' && (entry.name.endsWith('.xlsx') || entry.name.endsWith('.xls'))) {
                let lastName = entry.name.match(/_([А-Яа-яA-Za-z]+)_/)?.[1] || entry.name.split('.')[0].replace('ФайлДанных', '').replace(/_/g, '').trim() || "Сотрудник";
                foundAccounts.push({ handle: entry, lastName, fileName: entry.name });
            }
        }

        if (foundAccounts.length === 0) {
            accountsList.innerHTML = '<p style="color: #EF4444; font-size: 13px;">Excel файлы не найдены в выбранной папке.</p>';
            return;
        }

        accountsList.innerHTML = '';
        foundAccounts.forEach(acc => {
            const btn = document.createElement('button');
            btn.className = 'account-btn';
            btn.innerHTML = `<span class="account-name">${acc.lastName}</span><span class="account-file">${acc.fileName}</span>`;
            btn.onclick = () => loadAccountFromHandle(acc.handle, rootDirHandle);
            accountsList.appendChild(btn);
        });

    } catch (error) { 
        console.log("Выбор отменен"); 
    }
}

async function loadAccountFromHandle(fileHandle, rootDirHandle = null) {
    try {
        currentFileHandle = fileHandle;
        const sessionData = rootDirHandle ? { fileHandle, rootDirHandle } : fileHandle;
        await saveHandle(sessionData);
        await readAccountFile(fileHandle);
    } catch(error) {
        showToast("Ошибка доступа к файлу");
    }
}

async function readAccountFile(fileHandle) {
    try {
        const file = await fileHandle.getFile();
        const buffer = await file.arrayBuffer();
        
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        
        // Ищем лист, даже если он назван чуть иначе, или берем самый первый
        const wsMain = getSheet(workbook, 'Общие данные') || workbook.worksheets[0];
        currentUser.firstName = wsMain ? (getVal(wsMain.getCell('B2')) || "Пользователь") : "Пользователь";
        currentUser.lastName = file.name.match(/_([А-Яа-яA-Za-z]+)_/)?.[1] || file.name.split('.')[0].replace('ФайлДанных', '').replace(/_/g, '').trim() || "Сотрудник";

        // Умный сбор ФИО и Пролётов (Склеиваем ячейки из одной строки)
        foremenList = [];
        if (wsMain) {
            for (let r = 3; r <= 20; r++) {
                let rowVals = [];
                for (let c = 4; c <= 7; c++) {
                    let val = String(getVal(wsMain.getCell(r, c)) || '').trim();
                    if (val && val !== 'undefined' && val !== 'null') {
                        rowVals.push(val);
                    }
                }
                if (rowVals.length > 0) {
                    foremenList.push(rowVals.join(' ')); // Получится "Иванов И.И. 6 пролёт"
                }
            }
        }
        foremenList = [...new Set(foremenList)];

        const foremanListEl = document.getElementById('foremen-datalist');
        if(foremanListEl) {
            foremanListEl.innerHTML = foremenList.map(f => `<option value="${f}">`).join('');
        }

        // Загрузка параметров программы
        const wsSettings = getSheet(workbook, 'параметры программы');
        if (wsSettings) {
            wsSettings.eachRow((row, rowNum) => {
                if (rowNum === 1) return;
                const key = String(getVal(row.getCell(1))).trim();
                const val = String(getVal(row.getCell(2))).trim();
                if (key === 'hotkeyDoc' && val) appSettings.hotkeyDoc = val;
            });
        }

        const wsReq = getSheet(workbook, 'заявки');
        requestsData = [];
        if (wsReq) {
            const reqCols = getColMap(wsReq);
            const cDate = reqCols['дата запроса'] || reqCols['дата'] || 1;
            const cFio = reqCols['фио запрашиваемого'] || reqCols['инициатор'] || reqCols['фио'] || 2;
            const cType = reqCols['тип задания'] || reqCols['задание'] || 3;
            const cComm = reqCols['комментарий'] || 4;
            const cStat = reqCols['статус'] || 5;
            const cSDate = reqCols['дата изменения статуса'] || reqCols['обновлено'] || 6;

            wsReq.eachRow((row, rowNum) => {
                if (rowNum === 1) return;
                let statusVal = getVal(row.getCell(cStat));
                let typeVal = getVal(row.getCell(cType));
                if (statusVal || typeVal) {
                    requestsData.push({
                        _rowNum: rowNum,
                        "дата запроса": getVal(row.getCell(cDate)),
                        "фио запрашиваемого": getVal(row.getCell(cFio)),
                        "тип задания": typeVal,
                        "комментарий": getVal(row.getCell(cComm)),
                        "статус": String(statusVal || 'получено').trim(),
                        "дата изменения статуса": getVal(row.getCell(cSDate))
                    });
                }
            });
        }

        const wsDoc = getSheet(workbook, 'документы в производство');
        documentsData = [];
        if (wsDoc) {
            const docCols = getColMap(wsDoc);
            const cDate = docCols['дата'] || 1;
            const cOrder = docCols['заказ'] || docCols['номер заказа'] || 2;
            const cDraw = docCols['чертеж'] || docCols['номер чертежа'] || 3;
            const cMaster = docCols['мастер'] || docCols['пролёт'] || 4;
            const cType = docCols['тип документа'] || docCols['документ'] || 5;
            const cStat = docCols['статус'] || 6;
            const cSDate = docCols['дата изменения статуса'] || docCols['обновлено'] || 7;

            wsDoc.eachRow((row, rowNum) => {
                if (rowNum === 1) return;
                let statusVal = getVal(row.getCell(cStat));
                let typeVal = getVal(row.getCell(cType));
                if (statusVal || typeVal) {
                    documentsData.push({
                        _rowNum: rowNum,
                        "дата": getVal(row.getCell(cDate)),
                        "заказ": getVal(row.getCell(cOrder)),
                        "чертеж": getVal(row.getCell(cDraw)),
                        "мастер": getVal(row.getCell(cMaster)),
                        "тип документа": typeVal,
                        "статус": String(statusVal || 'Оформление').trim(),
                        "дата изменения статуса": getVal(row.getCell(cSDate))
                    });
                }
            });
        }

        const fullName = `${currentUser.firstName} ${currentUser.lastName}`;
        const hName = document.getElementById('header-name');
        if (hName) hName.innerText = fullName;
        const hAv = document.getElementById('header-avatar');
        if (hAv) hAv.innerText = currentUser.firstName.charAt(0);

        const loginOverlay = document.getElementById('login-overlay');
        if (loginOverlay) loginOverlay.classList.add('hidden');
        updateUI();
        switchTab('dashboard');
    } catch (error) {
        console.error(error);
        showToast("Ошибка чтения файла");
        logout();
    }
}

async function logout() {
    await clearHandle();
    currentFileHandle = null;
    const lStateNew = document.getElementById('login-state-new');
    if (lStateNew) lStateNew.style.display = 'block';
    const lStateResume = document.getElementById('login-state-resume');
    if (lStateResume) lStateResume.style.display = 'none';
    const loginOverlay = document.getElementById('login-overlay');
    if (loginOverlay) loginOverlay.classList.remove('hidden');
}

// --- ЛОГИКА ЗАЯВОК (UI И ДАННЫЕ) ---

function updateUI() {
    renderTable();
    if (typeof renderDashTable === 'function') renderDashTable();
    if (typeof renderDocsTable === 'function') renderDocsTable();
    updateStats();
}

function updateStats() {
    let total = requestsData.length;
    let work = 0, quest = 0, done = 0;
    let doneToday = 0;
    
    const today = new Date().toLocaleDateString();

    requestsData.forEach(r => {
        if (r['статус'] === 'в работе') work++;
        else if (r['статус'] === 'вопрос') quest++;
        else if (r['статус'] === 'выполнено') {
            done++;
            if (r['дата изменения статуса'] && new Date(r['дата изменения статуса']).toLocaleDateString() === today) doneToday++;
        }
    });

    const stTotal = document.getElementById('stat-total');
    if (stTotal) stTotal.innerText = total;
    const stWork = document.getElementById('stat-work');
    if (stWork) stWork.innerText = work;
    const stQuest = document.getElementById('stat-quest');
    if (stQuest) stQuest.innerText = quest;
    const stDone = document.getElementById('stat-done');
    if (stDone) stDone.innerText = done;
    
    if (document.getElementById('dash-stat-total')) {
        const dstTotal = document.getElementById('dash-stat-total');
        if (dstTotal) dstTotal.innerText = total;
        const dstWork = document.getElementById('dash-stat-work');
        if (dstWork) dstWork.innerText = work;
        const dstQuest = document.getElementById('dash-stat-quest');
        if (dstQuest) dstQuest.innerText = quest;
        const dstDone = document.getElementById('dash-stat-done');
        if (dstDone) dstDone.innerText = doneToday; // Выполнено именно за сегодня
    }
}

function renderTable() {
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';

    if (requestsData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 40px; color: var(--text-light);">Нет заявок</td></tr>`;
        return;
    }

    // Сортируем по свежести (новые сверху)
    const sortedData = [...requestsData].reverse();

    sortedData.forEach((req) => {
        const originalIndex = requestsData.indexOf(req); // Сохраняем оригинальный индекс для сохранения
        const statusOptions = ['получено', 'в работе', 'вопрос', 'выполнено'];
        
        // Форматируем статус для CSS класса
        const statusClass = `status-${(req['статус'] || 'получено').toLowerCase().replace(/\s+/g, '-')}`;

        const statusSelect = `
            <select class="status-select ${statusClass}" onchange="changeStatus(${originalIndex}, this.value, this)">
                ${statusOptions.map(s => `<option value="${s}" ${req['статус'] === s ? 'selected' : ''}>${s.toUpperCase()}</option>`).join('')}
            </select>
        `;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><div style="font-weight: 500;">${formatDate(req['дата запроса'])}</div></td>
            <td><div style="display:flex; align-items:center; gap:8px;">
                <div style="width:24px; height:24px; border-radius:50%; background:var(--border-light); display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:600;">${(req['фио запрашиваемого']||'?').charAt(0)}</div>
                ${req['фио запрашиваемого'] || 'Неизвестно'}
            </div></td>
            <td style="font-weight: 500;">${req['тип задания'] || '-'}</td>
            <td><div class="cell-comment" title="${req['комментарий']}">${req['комментарий'] || '-'}</div></td>
            <td>${statusSelect}</td>
            <td style="color: var(--text-muted); font-size: 13px;">${formatDate(req['дата изменения статуса'], true)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderDashTable() {
    const tbody = document.getElementById('dash-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    // Берем последние активные или проблемные задачи (до 5 шт)
    const activeTasks = [...requestsData].reverse().filter(r => (r['статус'] || '').toLowerCase() === 'в работе' || (r['статус'] || '').toLowerCase() === 'вопрос').slice(0, 5);

    if (activeTasks.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 40px; color: var(--text-light);">Нет активных срочных задач</td></tr>`;
        return;
    }

    activeTasks.forEach((req) => {
        const statusClass = `status-${(req['статус'] || 'получено').toLowerCase().replace(/\s+/g, '-')}`;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight: 500;">${req['тип задания'] || '-'}</td>
            <td><div style="display:flex; align-items:center; gap:8px;"><div style="width:24px; height:24px; border-radius:50%; background:var(--border-light); display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:600;">${(req['фио запрашиваемого']||'?').charAt(0)}</div>${req['фио запрашиваемого'] || 'Неизвестно'}</div></td>
            <td><span class="status-select ${statusClass}" style="display: inline-block; pointer-events: none;">${(req['статус']||'').toUpperCase()}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

function formatDate(dateStr, includeTime = false) {
    if (!dateStr) return '-';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return String(dateStr).split(' ')[0];
        const opts = { day: '2-digit', month: '2-digit', year: 'numeric' };
        if (includeTime) { opts.hour = '2-digit'; opts.minute = '2-digit'; }
        return d.toLocaleDateString('ru-RU', opts);
    } catch(e) { return '-'; }
}

function renderDocsTable() {
    const tbody = document.getElementById('docs-table-body');
    if(!tbody) return;
    tbody.innerHTML = '';

    if (documentsData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 40px; color: var(--text-light);">Нет документов в производстве</td></tr>`;
        return;
    }

    const sortedData = [...documentsData].reverse();
    sortedData.forEach(doc => {
        const originalIndex = documentsData.indexOf(doc);
        const statusOptions = ['Оформление', 'Архив', 'На столе выдачи', 'Выдано мастеру'];
        
        const statusClass = `status-${(doc['статус'] || 'Оформление').toLowerCase().replace(/\s+/g, '-')}`;

        const statusSelect = `
            <select class="status-select ${statusClass}" onchange="changeDocStatus(${originalIndex}, this.value, this)">
                ${statusOptions.map(s => `<option value="${s}" ${doc['статус'] === s ? 'selected' : ''}>${s.toUpperCase()}</option>`).join('')}
            </select>
        `;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><div style="font-weight: 500;">${formatDate(doc['дата'])}</div></td>
            <td><span class="status-select status-получено" style="pointer-events:none;">${doc['тип документа']}</span></td>
            <td style="font-weight: 600;">${doc['заказ']}</td>
            <td>${doc['чертеж']}</td>
            <td>${doc['мастер']}</td>
            <td>${statusSelect}</td>
        `;
        tbody.appendChild(tr);
    });
}

// --- ЛОГИКА МАРШРУТОВ ---
function populateRouteSelects() {
    if (typeof factoryData === 'undefined' || !factoryData.zones) return;
    const startSel = document.getElementById('route-start');
    const endSel = document.getElementById('route-end');
    if (!startSel || !endSel) return;
    startSel.innerHTML = ''; endSel.innerHTML = '';
    // Сортировка зон по алфавиту для удобства оператора
    const sortedZones = [...factoryData.zones].sort((a,b) => a.text.localeCompare(b.text));
    sortedZones.forEach(z => {
        startSel.add(new Option(z.text, z.id));
        endSel.add(new Option(z.text, z.id));
    });
}
function calculateAndShowRoute() {
    const startId = document.getElementById('route-start').value;
    const endId = document.getElementById('route-end').value;
    if (startId === endId) return showToast('Выберите разные точки для маршрута');
    if (window.showRoute) window.showRoute(startId, endId);
}
function clearRouteUI() { if (window.clearRoute) window.clearRoute(); }

// --- ДЕЙСТВИЯ ---

// Навигация по клавише Enter внутри модальных окон
function setupEnterNavigation(modalId, submitCallback) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    
    const focusable = Array.from(modal.querySelectorAll('input:not([readonly]), select, textarea'));
    
    focusable.forEach((el, index) => {
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                if (el.tagName.toLowerCase() === 'textarea' && !e.ctrlKey) return; // В textarea Enter делает перенос строки
                
                e.preventDefault();
                if (index < focusable.length - 1) {
                    focusable[index + 1].focus();
                } else {
                    submitCallback();
                }
            }
        });
    });
}

// Настройка записи и срабатывания горячих клавиш
function initHotkeys() {
    const input = document.getElementById('setting-hotkey-doc');
    if (input) {
        input.addEventListener('keydown', (e) => {
            e.preventDefault();
            if (e.key === 'Backspace' || e.key === 'Delete') { input.value = ''; return; }
            if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;

            let combo = [];
            if (e.ctrlKey) combo.push('Ctrl');
            if (e.shiftKey) combo.push('Shift');
            if (e.altKey) combo.push('Alt');
            
            combo.push(e.key.toUpperCase());
            input.value = combo.join('+');
        });
    }

    window.addEventListener('keydown', (e) => {
        if (!appSettings.hotkeyDoc) return;
        if ((e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') && !e.ctrlKey && !e.altKey) return;

        let combo = [];
        if (e.ctrlKey) combo.push('Ctrl');
        if (e.shiftKey) combo.push('Shift');
        if (e.altKey) combo.push('Alt');
        if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) combo.push(e.key.toUpperCase());

        if (combo.join('+') === appSettings.hotkeyDoc) {
            e.preventDefault();
            openDocModal();
        }
    });
}

function openCreateModal() {
    document.getElementById('req-type').value = '';
    document.getElementById('req-comment').value = '';
    document.getElementById('create-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('req-type').focus(), 100);
}

function closeCreateModal() {
    document.getElementById('create-modal').classList.add('hidden');
}

async function submitRequest() {
    const type = document.getElementById('req-type').value.trim();
    const comment = document.getElementById('req-comment').value.trim();

    if (!type || !comment) {
        showToast("Заполните все поля");
        return;
    }

    const now = new Date();
    const newRequest = {
        "дата запроса": now,
        "фио запрашиваемого": `${currentUser.firstName} ${currentUser.lastName}`,
        "тип задания": type,
        "комментарий": comment,
        "статус": "получено",
        "дата изменения статуса": now
    };

    requestsData.push(newRequest);
    addLog("Создание заявки", `Тип: ${type}. Статус: получено.`);
    closeCreateModal();
    await saveToExcel();
}

async function changeStatus(index, newStatus, selectElement) {
    const req = requestsData[index];
    if (!req) return;

    const oldStatus = req['статус'];
    req['статус'] = newStatus;
    req['дата изменения статуса'] = new Date();
    
    addLog("Изменение статуса заявки", `Заявка '${req['тип задания']}': ${oldStatus} -> ${newStatus}`);

    // Обновляем цвет селекта немедленно для отклика UI
    selectElement.className = `status-select status-${newStatus.toLowerCase().replace(/\s+/g, '-')}`;
    
    await saveToExcel();
}

function openDocModal() {
    document.getElementById('doc-order').value = '';
    document.getElementById('doc-drawing').value = '';
    document.getElementById('doc-foreman').value = '';
    document.getElementById('doc-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('doc-order').focus(), 100);
}

function closeDocModal() {
    document.getElementById('doc-modal').classList.add('hidden');
}

function openSettingsModal() {
    document.getElementById('setting-hotkey-doc').value = appSettings.hotkeyDoc;
    document.getElementById('settings-modal').classList.remove('hidden');
}

function closeSettingsModal() {
    document.getElementById('settings-modal').classList.add('hidden');
}

async function saveSettings() {
    appSettings.hotkeyDoc = document.getElementById('setting-hotkey-doc').value;
    closeSettingsModal();
    showToast("Настройки сохранены");
    await saveToExcel();
}

async function submitDoc() {
    const order = document.getElementById('doc-order').value.trim();
    const drawing = document.getElementById('doc-drawing').value.trim();
    const foreman = document.getElementById('doc-foreman').value;

    if (!order || !drawing || !foreman) {
        showToast("Заполните заказ, чертеж и выберите мастера");
        return;
    }

    const now = new Date();
    const newDoc = {
        "дата": now,
        "заказ": order,
        "чертеж": drawing,
        "мастер": foreman,
        "тип документа": "Журнал-паспорт",
        "статус": "Оформление",
        "дата изменения статуса": now
    };

    documentsData.push(newDoc);
    addLog("Создание документа", `Журнал-паспорт (Заказ: ${order}, Чертеж: ${drawing}) для мастера ${foreman}`);
    closeDocModal();
    await saveToExcel();
}

async function changeDocStatus(index, newStatus, selectElement) {
    const doc = documentsData[index];
    if (!doc) return;

    const oldStatus = doc['статус'];
    doc['статус'] = newStatus;
    doc['дата изменения статуса'] = new Date();
    
    addLog("Изменение статуса документа", `Журнал-паспорт (Заказ: ${doc['заказ']}): ${oldStatus} -> ${newStatus}`);

    selectElement.className = `status-select status-${newStatus.toLowerCase().replace(/\s+/g, '-')}`;
    await saveToExcel();
}

async function startTestMode() {
    isTestMode = true;
    
    // В тестовом режиме нет файла
    currentFileHandle = null;
    await clearHandle(); // Очищаем сохраненный доступ, чтобы при перезагрузке не было авто-входа

    // Пользователь по умолчанию
    currentUser = { firstName: "Тест", lastName: "Пользователь" };

    // Инициализируем данные пустыми массивами
    requestsData = [];
    documentsData = [];
    foremenList = ["Мастер 1 (Тест)", "Мастер 2 (Тест)", "Мастер 3 (Тест)"];
    logsDataToAppend = [];
    
    const foremanListEl = document.getElementById('foremen-datalist');
    if(foremanListEl) {
        foremanListEl.innerHTML = foremenList.map(f => `<option value="${f}">`).join('');
    }

    // Обновляем UI с тестовым пользователем
    const fullName = `${currentUser.firstName} ${currentUser.lastName}`;
    document.getElementById('header-name').innerText = fullName;
    document.getElementById('header-avatar').innerText = currentUser.firstName.charAt(0);

    // Прячем оверлей и запускаем приложение
    document.getElementById('login-overlay').classList.add('hidden');
    updateUI();
    switchTab('dashboard');
    showToast("Включен тестовый режим. Данные не сохраняются в файл.");
}

async function saveToExcel() {
    if (isTestMode) { showToast("Сохранено в памяти (тестовый режим)"); updateUI(); return; }
    if (!currentFileHandle) { return; }
    try {
        const file = await currentFileHandle.getFile();
        const buffer = await file.arrayBuffer();
        
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        
        // Заявки
        let wsReq = getSheet(workbook, 'заявки');
        if (!wsReq) {
            wsReq = workbook.addWorksheet('Заявки');
            wsReq.addRow(["Дата запроса", "ФИО запрашиваемого", "Тип задания", "Комментарий", "Статус", "Дата изменения статуса"]);
        }
        
        const reqCols = getColMap(wsReq);
        const rDate = reqCols['дата запроса'] || reqCols['дата'] || 1;
        const rFio = reqCols['фио запрашиваемого'] || reqCols['инициатор'] || reqCols['фио'] || 2;
        const rType = reqCols['тип задания'] || reqCols['задание'] || 3;
        const rComm = reqCols['комментарий'] || 4;
        const rStat = reqCols['статус'] || 5;
        const rSDate = reqCols['дата изменения статуса'] || reqCols['обновлено'] || 6;

        requestsData.forEach(req => {
            if (req._rowNum) {
                const row = wsReq.getRow(req._rowNum);
                row.getCell(rStat).value = req["статус"];
                row.getCell(rSDate).value = req["дата изменения статуса"];
                row.commit();
            } else {
                const newRow = wsReq.addRow([]);
                newRow.getCell(rDate).value = req["дата запроса"];
                newRow.getCell(rFio).value = req["фио запрашиваемого"];
                newRow.getCell(rType).value = req["тип задания"];
                newRow.getCell(rComm).value = req["комментарий"];
                newRow.getCell(rStat).value = req["статус"];
                newRow.getCell(rSDate).value = req["дата изменения статуса"];
                newRow.commit();
                req._rowNum = newRow.number;
            }
        });

        // Документы
        let wsDoc = getSheet(workbook, 'документы в производство');
        if (!wsDoc) {
            wsDoc = workbook.addWorksheet('Документы в производство');
            wsDoc.addRow(["Дата", "Заказ", "Чертеж", "Мастер", "Тип документа", "Статус", "Дата изменения статуса"]);
        }
        
        const docCols = getColMap(wsDoc);
        const dDate = docCols['дата'] || 1;
        const dOrder = docCols['заказ'] || docCols['номер заказа'] || 2;
        const dDraw = docCols['чертеж'] || docCols['номер чертежа'] || 3;
        const dMaster = docCols['мастер'] || docCols['пролёт'] || 4;
        const dType = docCols['тип документа'] || docCols['документ'] || 5;
        const dStat = docCols['статус'] || 6;
        const dSDate = docCols['дата изменения статуса'] || docCols['обновлено'] || 7;

        documentsData.forEach(doc => {
            if (doc._rowNum) {
                const row = wsDoc.getRow(doc._rowNum);
                row.getCell(dStat).value = doc["статус"];
                row.getCell(dSDate).value = doc["дата изменения статуса"];
                row.commit();
            } else {
                const newRow = wsDoc.addRow([]);
                newRow.getCell(dDate).value = doc["дата"];
                newRow.getCell(dOrder).value = doc["заказ"];
                newRow.getCell(dDraw).value = doc["чертеж"];
                newRow.getCell(dMaster).value = doc["мастер"];
                newRow.getCell(dType).value = doc["тип документа"];
                newRow.getCell(dStat).value = doc["статус"];
                newRow.getCell(dSDate).value = doc["дата изменения статуса"];
                newRow.commit();
                doc._rowNum = newRow.number;
            }
        });

        // Сборник (Логи)
        if (logsDataToAppend.length > 0) {
            let wsLog = getSheet(workbook, 'сборник');
            if (!wsLog) {
                wsLog = workbook.addWorksheet('Сборник');
                wsLog.addRow(["Дата", "Действие", "Детали"]);
            }
            logsDataToAppend.forEach(log => {
                wsLog.addRow([log.date, log.action, log.details]);
            });
            logsDataToAppend = [];
        }

        // Параметры программы
        let wsSettings = getSheet(workbook, 'параметры программы');
        if (!wsSettings) {
            wsSettings = workbook.addWorksheet('Параметры программы');
            wsSettings.addRow(["Параметр", "Значение"]);
        }
        let foundHotkeyDoc = false;
        wsSettings.eachRow((row, rowNum) => {
            if (rowNum === 1) return;
            if (getVal(row.getCell(1)) === 'hotkeyDoc') {
                row.getCell(2).value = appSettings.hotkeyDoc;
                row.commit();
                foundHotkeyDoc = true;
            }
        });
        if (!foundHotkeyDoc) wsSettings.addRow(['hotkeyDoc', appSettings.hotkeyDoc]);

        const outBuffer = await workbook.xlsx.writeBuffer();
        const writable = await currentFileHandle.createWritable();
        await writable.write(outBuffer);
        await writable.close();

        showToast("Сохранено");
        updateUI(); // Обновляем таблицы и статусы после успешного сохранения
    } catch (error) {
        console.error(error);
        showToast("Ошибка сохранения. Убедитесь, что файл закрыт в Excel.");
    }
}

// --- ЛОГИКА ВКЛАДОК ---
function switchTab(tabId) {
    // Повторное нажатие на летящую кнопку 3D возвращает на главную (Дашборд)
    if (tabId === 'creator' && document.body.classList.contains('fullscreen-creator')) {
        switchTab('dashboard');
        return;
    }

    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const activeTab = document.getElementById('tab-' + tabId);
    if (activeTab) activeTab.classList.add('active');
    
    const viewDashboard = document.getElementById('view-dashboard');
    const viewHome = document.getElementById('view-home');
    const viewRequests = document.getElementById('view-requests');
    const viewDocuments = document.getElementById('view-documents');
    const viewCreator = document.getElementById('view-creator');
    const viewTree = document.getElementById('view-tree');
    
    const mapSidebar = document.getElementById('view-map-sidebar');
    const homeLabels = document.getElementById('home-labels');
    const homeFilters = document.getElementById('view-home-filters');

    if (viewDashboard) viewDashboard.style.display = 'none';
    if (viewHome) viewHome.style.display = 'none';
    if (viewRequests) viewRequests.style.display = 'none';
    if (viewDocuments) viewDocuments.style.display = 'none';
    if (viewCreator) viewCreator.style.display = 'none';
    if (viewTree) viewTree.style.display = 'none';

        // Активация/деактивация полноэкранного режима
        if (tabId === 'creator') {
            document.body.classList.add('fullscreen-creator');
            if (window.creatorLeftPanelOpen && typeof window.toggleCreatorLeftPanel === 'function') window.toggleCreatorLeftPanel();
            if (window.creatorRightPanelOpen && typeof window.toggleCreatorRightPanel === 'function') window.toggleCreatorRightPanel();
            if (!window.creatorBottomPanelOpen && typeof window.toggleCreatorBottomPanel === 'function') window.toggleCreatorBottomPanel();
        } else {
            document.body.classList.remove('fullscreen-creator');
            // Если мы переключаемся С вкладки конструктора, отменяем все активные команды
            if (typeof window.cancelAllCommands === 'function') {
                window.cancelAllCommands();
            }
        }

    const titleEl = document.getElementById('page-title-text');

    if (tabId === 'dashboard') {
        if (viewDashboard) viewDashboard.style.display = 'flex';
        if (titleEl) titleEl.innerText = 'Оперативная сводка';
    } else if (tabId === 'home') {
        viewHome.style.display = 'flex';
        mapSidebar.style.display = 'none';
        homeLabels.style.display = 'block';
        homeFilters.style.display = 'flex';
        if (titleEl) titleEl.innerText = 'Цифровой двойник';
        if (window.setMapMode) window.setMapMode(false);
        setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    } else if (tabId === 'map') {
        viewHome.style.display = 'flex';
        mapSidebar.style.display = 'flex';
        homeLabels.style.display = 'none';
        homeFilters.style.display = 'none';
        closeZonePanel(); // Закрываем панель зоны при переходе в маршруты
        if (titleEl) titleEl.innerText = 'Маршрутизация';
        if (window.setMapMode) window.setMapMode(true);
        setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    } else if (tabId === 'requests') {
        viewRequests.style.display = 'flex';
        if (titleEl) titleEl.innerText = 'Обзор заявок';
    } else if (tabId === 'documents') {
        if (viewDocuments) viewDocuments.style.display = 'flex';
        if (titleEl) titleEl.innerText = 'Оформление Журнал-Паспортов';
    } else if (tabId === 'creator') {
        if (viewCreator) viewCreator.style.display = 'flex';
        if (titleEl) titleEl.innerText = '3D Конструктор';
        if (typeof initCreator3D === 'function') initCreator3D();
        setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
            setTimeout(() => window.dispatchEvent(new Event('resize')), 550); // Повторяем после завершения анимации
    } else if (tabId === 'tree') {
        if (viewTree) viewTree.style.display = 'flex';
        if (titleEl) titleEl.innerText = 'Граф связей';
    }
}

// --- ЛОГИКА СКРЫТИЯ ПАНЕЛЕЙ КОНСТРУКТОРА ---
window.creatorLeftPanelOpen = false;
var creatorLeftPanelOpen = false;
function toggleCreatorLeftPanel() {
    window.creatorLeftPanelOpen = !window.creatorLeftPanelOpen;
    creatorLeftPanelOpen = window.creatorLeftPanelOpen;
    const panel = document.getElementById('creator-left-panel');
    if (!panel) return;
    if (window.creatorLeftPanelOpen) {
        panel.style.width = '260px';
        panel.style.minWidth = '260px';
        panel.style.borderRight = '1px solid var(--border-light)';
    } else {
        panel.style.width = '0px';
        panel.style.minWidth = '0px';
        panel.style.borderRight = 'none';
    }
    setTimeout(() => window.dispatchEvent(new Event('resize')), 310);
}
window.toggleCreatorLeftPanel = toggleCreatorLeftPanel;

window.creatorRightPanelOpen = false;
var creatorRightPanelOpen = false;
function toggleCreatorRightPanel() {
    window.creatorRightPanelOpen = !window.creatorRightPanelOpen;
    creatorRightPanelOpen = window.creatorRightPanelOpen;
    const panel = document.getElementById('creator-right-panel');
    if (!panel) return;
    if (window.creatorRightPanelOpen) {
        panel.style.width = '320px';
        panel.style.minWidth = '320px';
        panel.style.borderLeft = '1px solid var(--border-light)';
    } else {
        panel.style.width = '0px';
        panel.style.minWidth = '0px';
        panel.style.borderLeft = 'none';
    }
    setTimeout(() => window.dispatchEvent(new Event('resize')), 310);
}
window.toggleCreatorRightPanel = toggleCreatorRightPanel;

// --- ЛОГИКА 3D (ИНДУСТРИАЛЬНЫЙ МИНИМАЛИЗМ) ---
function init3D() {
    flyTargetPos = new THREE.Vector3();
    flyTargetLook = new THREE.Vector3();

    const canvas = document.getElementById('canvas-3d');
    if (!canvas) return;
    
    // ЗАЩИТА: Если вкладка скрыта (размер 0x0), берём размеры окна, чтобы 3D-камера не сломалась из-за деления на ноль
    const initWidth = canvas.clientWidth || window.innerWidth || 800;
    const initHeight = canvas.clientHeight || window.innerHeight || 600;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xE8ECF1); 

    // Увеличили дальность обзора с 1000 до 50000, чтобы огромный цех не обрезался
    camera = new THREE.PerspectiveCamera(45, initWidth / initHeight, 0.1, 5000000);
    camera.position.set(0, 6000, 6000);

    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, logarithmicDepthBuffer: true });
    renderer.setSize(initWidth, initHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.minDistance = 0.01;
    controls.maxDistance = 5000000; // Разрешаем камере отдаляться без ограничений
    controls.enableZoom = false; // Zoom to cursor handled manually

    renderer.domElement.addEventListener('wheel', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (!controls || !controls.enabled) return;
        const rect = renderer.domElement.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        const mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const mouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        const mouse = new THREE.Vector2(mouseX, mouseY);

        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 33;
        else if (e.deltaMode === 2) dy *= 100;

        const zoomFactor = Math.pow(1.0015, dy);

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, camera);

        let targetPoint = null;
        if (scene) {
            const intersects = raycaster.intersectObjects(scene.children, true);
            for (let i = 0; i < intersects.length; i++) {
                const hit = intersects[i];
                if (!hit.object || !hit.object.visible) continue;
                if (hit.object.type === 'GridHelper' || hit.object.type === 'Line' || hit.object.type === 'LineSegments') continue;
                targetPoint = hit.point.clone();
                break;
            }
        }

        if (!targetPoint) {
            const viewDir = new THREE.Vector3();
            camera.getWorldDirection(viewDir);
            const targetPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(viewDir.clone().negate(), controls.target);
            targetPoint = new THREE.Vector3();
            const hit = raycaster.ray.intersectPlane(targetPlane, targetPoint);
            if (!hit) {
                targetPoint.copy(controls.target);
            }
        }

        const vCP = camera.position.clone().sub(targetPoint);
        const vTP = controls.target.clone().sub(targetPoint);

        let factor = zoomFactor;
        let distToHit = vCP.length();
        if (distToHit < 1e-4) {
            vCP.set(0, 0, 1);
            distToHit = 1;
        }

        let newDist = distToHit * factor;
        if (newDist < 0.02) {
            factor = 0.02 / distToHit;
            newDist = 0.02;
        } else if (newDist > 10000000.0) {
            factor = 10000000.0 / distToHit;
            newDist = 10000000.0;
        }

        camera.near = Math.min(0.05, Math.max(0.00001, newDist * 0.001));
        camera.far = Math.max(10000000.0, newDist * 20.0);
        camera.updateProjectionMatrix();

        const newCamPos = targetPoint.clone().add(vCP.multiplyScalar(factor));
        const newTarget = targetPoint.clone().add(vTP.multiplyScalar(factor));

        camera.position.copy(newCamPos);
        controls.target.copy(newTarget);
        controls.update();

        isCameraFlying = false;
    }, { passive: false });
    
    // Отключаем плавный подлёт, если пользователь начал вращать камеру вручную
    controls.addEventListener('start', () => {
        isCameraFlying = false;
    });

    // Освещение для четких теней
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x7D8A9A, 0.6);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    // Освещение перенесено высоко вверх, чтобы покрыть весь цех
    dirLight.position.set(3000, 5000, 2000);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 4096;
    dirLight.shadow.mapSize.height = 4096;
    dirLight.shadow.camera.near = 100;
    dirLight.shadow.camera.far = 15000;
    
    // Огромная камера теней для большого цеха
    const d = 5000;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    dirLight.shadow.bias = -0.001;
    scene.add(dirLight);

    // Чистый белый пол (будет четко виден горизонт на фоне 0xEEF2F6)
    // Пол тоже увеличен под реальный масштаб
    const floorGeo = new THREE.PlaneGeometry(50000, 50000);
    const floorMat = new THREE.MeshStandardMaterial({ 
        color: 0xFFFFFF,
        roughness: 0.15,
        metalness: 0.05 
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    if (typeof createFactoryScene === 'function') {
        try {
            createFactoryScene(scene);
            populateRouteSelects();
            createHTMLCallouts();
        } catch (error) {
            console.error("Критическая ошибка при построении цеха:", error);
            showToast("Ошибка данных 3D сцены! Проверьте консоль.");
            createShipbuildingModels();
        }
    } else {
        console.error("Скрипт factory_scene.js не был загружен. Проверьте CORS ограничения (file://).");
        showToast("Внимание: 3D цех не загружен из-за ограничений браузера. Запустите приложение через локальный сервер.");
        createShipbuildingModels();
    }
    
    // Жестко фиксируем фокус камеры в центре 3D-модели
    controls.target.set(0, 0, 0);
    controls.update();

    const tempV = new THREE.Vector3();
    function animate() {
        requestAnimationFrame(animate);
        
        // Плавный подлёт камеры
        if (isCameraFlying) {
            camera.position.lerp(flyTargetPos, 0.06);
            controls.target.lerp(flyTargetLook, 0.06);
            if (camera.position.distanceTo(flyTargetPos) < 10) {
                isCameraFlying = false;
            }
        }
        
        controls.update();
        renderer.render(scene, camera);
        
        // Синхронизация 3D-маркеров с HTML-выносками
        if (window.factoryGroups && window.factoryGroups.zoneMarkers) {
            window.factoryGroups.zoneMarkers.forEach(marker => {
                if (!marker.domElement) return;
                
                tempV.setFromMatrixPosition(marker.matrixWorld);
                tempV.project(camera);
                
                // Если маркер за камерой - прячем
                if (tempV.z > 1 || marker.userData.filteredOut) {
                    marker.domElement.style.display = 'none';
                    marker.visible = false; // Отключаем 3D-линию
                    return;
                }

                marker.visible = true; // Включаем 3D-линию

                // Используем точные дробные значения для максимальной плавности
                const x = (tempV.x * 0.5 + 0.5) * canvas.clientWidth;
                const y = (tempV.y * -0.5 + 0.5) * canvas.clientHeight;
                
                marker.domElement.style.display = 'block';
                
                // Изменяем transform обертки (Hardware Acceleration), это устраняет вибрацию
                marker.domElement.style.transform = `translate(${x}px, ${y - 15}px)`;
                
                if (!marker.innerElement.classList.contains('active')) {
                    marker.domElement.style.zIndex = Math.round((1 - tempV.z) * 100);
                } else {
                    marker.domElement.style.zIndex = 1000;
                }
            });
        }
    }
    animate();

    const resizeObserver = new ResizeObserver(() => {
        const parent = canvas.parentElement;
        if (parent.clientWidth === 0 || parent.clientHeight === 0) return;
        camera.aspect = parent.clientWidth / parent.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(parent.clientWidth, parent.clientHeight);
    });
    resizeObserver.observe(canvas.parentElement);
}

// --- ЛОГИКА ВЫНОСОК И КАМЕРЫ ---
function createHTMLCallouts() {
    const container = document.getElementById('labels-container');
    container.innerHTML = '';
    if (!window.factoryGroups || !window.factoryGroups.zoneMarkers) return;

    window.factoryGroups.zoneMarkers.forEach(marker => {
        // Создаем невидимую обертку
        const wrapper = document.createElement('div');
        wrapper.className = 'zone-marker-wrapper';

        // Внутренняя выноска
        const div = document.createElement('div');
        div.className = 'zone-label';
        div.innerText = marker.userData.name;
        div.onclick = () => focusOnZone(marker, div);
        
        wrapper.appendChild(div);
        container.appendChild(wrapper);
        marker.domElement = wrapper; // Обертка двигается за камерой
        marker.innerElement = div; // Внутренний элемент отвечает за клики и стили
        
        // Инициализируем категорию зоны при создании
        marker.userData.category = getZoneCategory(marker.userData.name);
        marker.userData.filteredOut = marker.userData.category !== activeZoneCategory;
    });
}

function getZoneCategory(text) {
    const lower = text.toLowerCase();
    // Бытовая
    if (/(раздевалка|душев|туалет)/.test(lower)) return 'household';
    // Обеспечение
    if (/(кладова|склад|бойлерная|вентиляц|компрессор|энергетик|электромас|гараж|механик|эстокада)/.test(lower)) return 'support';
    // Рабочее
    if (/(пролёт|пролет|мастер|рентген|маляр|гибщик|очистк|камера)/.test(lower)) return 'production';
    // Администрация (по умолчанию)
    return 'admin';
}

function filterZones(category) {
    // Логика переключателя: если нажата текущая кнопка, отключаем всё
    if (activeZoneCategory === category) {
        activeZoneCategory = null; 
    } else {
        activeZoneCategory = category;
    }

    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.category === activeZoneCategory);
    });

    if (window.factoryGroups && window.factoryGroups.zoneMarkers) {
        window.factoryGroups.zoneMarkers.forEach(marker => {
            marker.userData.filteredOut = (activeZoneCategory === null) || (marker.userData.category !== activeZoneCategory);
        });
    }

    closeZonePanel(); // Всегда закрываем панель при смене фильтра
}

function focusOnZone(marker, domElement) {
    document.querySelectorAll('.zone-label').forEach(el => el.classList.remove('active'));
    if (domElement) domElement.classList.add('active');

    const titleEl = document.getElementById('zone-panel-title');
    if (titleEl) titleEl.innerText = marker.userData.name;
    const panelEl = document.getElementById('zone-panel');
    if (panelEl) panelEl.style.right = '16px';

    const targetWorldPos = new THREE.Vector3();
    marker.getWorldPosition(targetWorldPos);
    flyTargetLook.copy(targetWorldPos);
    // Камера теперь прилетает существенно ближе к выбранной зоне
    flyTargetPos.set(targetWorldPos.x + 600, targetWorldPos.y + 800, targetWorldPos.z + 1200);
    isCameraFlying = true;
}

function closeZonePanel() {
    const panelEl = document.getElementById('zone-panel');
    if (panelEl) panelEl.style.right = '-400px';
    document.querySelectorAll('.zone-label').forEach(el => el.classList.remove('active'));
}

function createShipbuildingModels() {
    const matHull = new THREE.MeshStandardMaterial({ color: 0xE8ECF1, roughness: 0.3, metalness: 0.1 });
    const matAccent = new THREE.MeshStandardMaterial({ color: 0x3355CC, roughness: 0.4, metalness: 0.2 });
    const matDark = new THREE.MeshStandardMaterial({ color: 0x2A3142, roughness: 0.8, metalness: 0.2 });

    const shape = new THREE.Shape();
    shape.moveTo(-3, 0); shape.lineTo(3, 0); shape.lineTo(4, 4); shape.lineTo(-4, 4); shape.lineTo(-3, 0);
    
    const extSettings = { depth: 16, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.1, bevelThickness: 0.1 };
    const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, extSettings), matHull);
    hull.position.set(0, 1, -8); hull.castShadow = true; hull.receiveShadow = true; scene.add(hull);

    const keel1 = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1, 14), matDark);
    keel1.position.set(-2, 0.5, -1); keel1.castShadow = true; keel1.receiveShadow = true; scene.add(keel1);

    const keel2 = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1, 14), matDark);
    keel2.position.set(2, 0.5, -1); keel2.castShadow = true; keel2.receiveShadow = true; scene.add(keel2);

    const bridge = new THREE.Mesh(new THREE.BoxGeometry(5, 3.5, 4), matAccent);
    bridge.position.set(0, 6.75, 2); bridge.castShadow = true; bridge.receiveShadow = true; scene.add(bridge);
}

// --- ИНИЦИАЛИЗАЦИЯ ---
function initializeApp() {
    updateDate();
    checkAuth();
    init3D();
    initHotkeys();
    setupEnterNavigation('doc-modal', submitDoc);
    setupEnterNavigation('create-modal', submitRequest);
}