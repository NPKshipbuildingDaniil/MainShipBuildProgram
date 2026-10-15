let treeNodes = [];
let treeGroups = [];
let treeEdges = [];

let treeScale = 1;
let treePanX = 0;
let treePanY = 0;

let isTreePanning = false;
let startPanX = 0, startPanY = 0;

let isNodeDragging = false;
let draggedNode = null;
let nodeDragOffsetX = 0;
let nodeDragOffsetY = 0;

let isGroupDragging = false;
let draggedGroup = null;
let draggedGroupChildren = [];

let isConnecting = false;
let connectStartNode = null;

let treeNextNodeId = 1;
let treeNextGroupId = 1;

let selectedEdge = null;

const groupColors = [
    { bg: 'rgba(51, 85, 204, 0.1)', border: '#3355CC', text: '#264099' },
    { bg: 'rgba(230, 168, 23, 0.1)', border: '#E6A817', text: '#B38211' },
    { bg: 'rgba(90, 175, 221, 0.1)', border: '#5AAFDD', text: '#4280A3' },
    { bg: 'rgba(224, 48, 48, 0.1)', border: '#E03030', text: '#A82424' },
    { bg: 'rgba(125, 138, 154, 0.1)', border: '#7D8A9A', text: '#5B6470' }
];

function initTreeGraph() {
    const container = document.getElementById('tree-container');
    if (!container) return;
    
    // Инициализация слоя для групп (ниже связей и узлов)
    const workspace = document.getElementById('tree-workspace');
    if (workspace && !document.getElementById('tree-groups')) {
        const groupsContainer = document.createElement('div');
        groupsContainer.id = 'tree-groups';
        groupsContainer.style.cssText = 'position:absolute; top:0; left:0; width:0; height:0; overflow:visible; z-index:1;';
        workspace.insertBefore(groupsContainer, workspace.firstChild);
    }

    // Панорамирование
    container.addEventListener('mousedown', (e) => {
        if (e.button === 1 || e.target === container || e.target.id === 'tree-workspace' || e.target.id === 'tree-nodes' || e.target.classList.contains('tree-group')) {
            // Игнорируем панорамирование, если клик был по ползунку изменения размера группы (правый нижний угол)
            if (e.target.classList.contains('tree-group')) {
                const rect = e.target.getBoundingClientRect();
                const isResizeClick = (e.clientX - rect.left) > rect.width - 20 && (e.clientY - rect.top) > rect.height - 20;
                if (isResizeClick) return; 
            }
            isTreePanning = true;
            startPanX = e.clientX - treePanX;
            startPanY = e.clientY - treePanY;
            container.style.cursor = 'grabbing';
            e.preventDefault();
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (isTreePanning) {
            treePanX = e.clientX - startPanX;
            treePanY = e.clientY - startPanY;
            updateTreeTransform();
        }

        if (isNodeDragging && draggedNode) {
            const rect = container.getBoundingClientRect();
            draggedNode.x = (e.clientX - rect.left - treePanX) / treeScale - nodeDragOffsetX;
            draggedNode.y = (e.clientY - rect.top - treePanY) / treeScale - nodeDragOffsetY;
            updateNodeElement(draggedNode);
            renderEdges();
        } else if (isGroupDragging && draggedGroup) {
            const rect = container.getBoundingClientRect();
            draggedGroup.x = ((e.clientX - rect.left - treePanX) / treeScale) - nodeDragOffsetX;
            draggedGroup.y = ((e.clientY - rect.top - treePanY) / treeScale) - nodeDragOffsetY;
            
            const groupEl = document.querySelector(`.tree-group[data-id="${draggedGroup.id}"]`);
            if (groupEl) { groupEl.style.left = draggedGroup.x + 'px'; groupEl.style.top = draggedGroup.y + 'px'; }

            // Синхронно двигаем всех детей (узлы и вложенные группы)
            draggedGroupChildren.forEach(child => {
                if (child.isGroup) {
                    child.group.x = draggedGroup.x + child.offsetX;
                    child.group.y = draggedGroup.y + child.offsetY;
                    const childEl = document.querySelector(`.tree-group[data-id="${child.group.id}"]`);
                    if (childEl) { childEl.style.left = child.group.x + 'px'; childEl.style.top = child.group.y + 'px'; }
                } else {
                    child.node.x = draggedGroup.x + child.offsetX;
                    child.node.y = draggedGroup.y + child.offsetY;
                    updateNodeElement(child.node);
                }
            });
            renderEdges();
        }

        if (isConnecting) {
            const rect = container.getBoundingClientRect();
            const mouseX = (e.clientX - rect.left - treePanX) / treeScale;
            const mouseY = (e.clientY - rect.top - treePanY) / treeScale;
            renderTempEdge(connectStartNode, mouseX, mouseY);
        }
    });

    window.addEventListener('mouseup', (e) => {
        if (isTreePanning) {
            isTreePanning = false;
            container.style.cursor = 'grab';
        }
        if (isNodeDragging) {
            isNodeDragging = false;
            draggedNode = null;
        }
        if (isGroupDragging) {
            isGroupDragging = false;
            draggedGroup = null;
            draggedGroupChildren = [];
        }
        if (isConnecting) {
            const droppedOnNode = e.target.closest('.tree-node, .tree-group');
            if (droppedOnNode) {
                const endNodeId = droppedOnNode.dataset.id;
                const edgeExists = treeEdges.some(edge => 
                    (edge.source === connectStartNode.id && edge.target === endNodeId) ||
                    (edge.source === endNodeId && edge.target === connectStartNode.id)
                );
                if (endNodeId !== connectStartNode.id && !edgeExists) {
                    treeEdges.push({ source: connectStartNode.id, target: endNodeId, color: '#7D8A9A' });
                }
            }
            isConnecting = false;
            connectStartNode = null;
            const tempEdge = document.getElementById('temp-edge');
            if (tempEdge) tempEdge.remove();
            renderEdges(); 
        }
    });

    // Масштабирование (Зум)
    container.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
        const newScale = Math.max(0.1, Math.min(treeScale * zoomDelta, 5));
        
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        treePanX = mouseX - (mouseX - treePanX) * (newScale / treeScale);
        treePanY = mouseY - (mouseY - treePanY) * (newScale / treeScale);
        treeScale = newScale;

        updateTreeTransform();
    }, { passive: false });
}

function updateTreeTransform() {
    const workspace = document.getElementById('tree-workspace');
    if (workspace) workspace.style.transform = `translate(${treePanX}px, ${treePanY}px) scale(${treeScale})`;
}

window.addTreeNode = function(x = 100, y = 100) {
    const container = document.getElementById('tree-container');
    const rect = container.getBoundingClientRect();
    const cx = (rect.width / 2 - treePanX) / treeScale;
    const cy = (rect.height / 2 - treePanY) / treeScale;

    // x и y теперь - левый верхний угол, поэтому смещаем на половину стандартной ширины/высоты
    const node = { id: 'node_' + treeNextNodeId++, x: cx - 80, y: cy - 40, width: 160, height: 80, text: 'Новый узел' };
    treeNodes.push(node);
    createNodeElement(node);
};

window.addTreeGroup = function() {
    const container = document.getElementById('tree-container');
    const rect = container.getBoundingClientRect();
    const cx = (rect.width / 2 - treePanX) / treeScale;
    const cy = (rect.height / 2 - treePanY) / treeScale;

    const theme = groupColors[treeNextGroupId % groupColors.length];
    const group = { id: 'group_' + treeNextGroupId++, x: cx - 150, y: cy - 150, width: 300, height: 300, text: 'Новая группа', theme: theme };
    treeGroups.push(group);
    createGroupElement(group);
};

function createNodeElement(node) {
    const container = document.getElementById('tree-nodes');
    const el = document.createElement('div');
    el.className = 'tree-node';
    el.dataset.id = node.id;
    el.style.cssText = `position:absolute; left:${node.x}px; top:${node.y}px; width:${node.width}px; height:${node.height}px; background:#fff; border:2px solid var(--accent-primary); border-radius:8px; box-shadow:0 4px 6px rgba(0,0,0,0.1); display:flex; flex-direction:column; resize:both; overflow:hidden; z-index:2;`;
    
    const header = document.createElement('div');
    header.style.cssText = 'height:24px; background:var(--accent-light); border-bottom:1px solid var(--border-light); cursor:move; display:flex; justify-content:space-between; align-items:center; padding:0 8px; flex-shrink:0;';

    const port = document.createElement('div');
    port.innerHTML = '🔗';
    port.style.cssText = 'font-size:12px; cursor:crosshair; user-select:none; filter:grayscale(1);';
    port.title = 'Потяните, чтобы соединить';
    port.onmousedown = (e) => { e.stopPropagation(); isConnecting = true; connectStartNode = node; };

    const delBtn = document.createElement('div');
    delBtn.innerHTML = '×';
    delBtn.style.cssText = 'color:#ef4444; font-weight:bold; font-size:16px; cursor:pointer; line-height:1; padding-bottom:2px;';
    delBtn.onmousedown = (e) => {
        e.stopPropagation();
        treeNodes = treeNodes.filter(n => n.id !== node.id);
        treeEdges = treeEdges.filter(e => e.source !== node.id && e.target !== node.id);
        el.remove();
        renderEdges();
    };

    header.appendChild(port);
    header.appendChild(delBtn);

    // Используем Textarea, чтобы можно было писать длинные тексты
    const input = document.createElement('textarea');
    input.value = node.text;
    input.style.cssText = 'flex:1; width:100%; border:none; outline:none; font-size:14px; font-weight:500; background:transparent; text-align:center; padding:8px; font-family:inherit; resize:none;';
    input.oninput = (e) => node.text = e.target.value;
    input.onmousedown = (e) => e.stopPropagation(); // Блокируем перетаскивание при выделении текста

    el.appendChild(header);
    el.appendChild(input);
    
    // За перетаскивание теперь отвечает только Header узла
    header.onmousedown = (e) => {
        isNodeDragging = true; draggedNode = node;
        const rect = document.getElementById('tree-container').getBoundingClientRect();
        nodeDragOffsetX = ((e.clientX - rect.left - treePanX) / treeScale) - node.x;
        nodeDragOffsetY = ((e.clientY - rect.top - treePanY) / treeScale) - node.y;
        e.stopPropagation();
    };

    // Слушаем изменение размеров узла (CSS resize: both)
    const ro = new ResizeObserver(() => {
        if (el.offsetWidth > 0) {
            node.width = el.offsetWidth;
            node.height = el.offsetHeight;
            renderEdges(); // Перестраиваем стрелки при изменении размера
        }
    });
    ro.observe(el);

    container.appendChild(el);
}

function createGroupElement(group) {
    let container = document.getElementById('tree-groups');
    if (!container) {
        container = document.createElement('div');
        container.id = 'tree-groups';
        container.style.cssText = 'position:absolute; top:0; left:0; width:0; height:0; overflow:visible; z-index:1;';
        const workspace = document.getElementById('tree-workspace');
        if (workspace) workspace.insertBefore(container, workspace.firstChild);
    }
    const el = document.createElement('div');
    el.className = 'tree-group';
    el.dataset.id = group.id;
    el.style.cssText = `position:absolute; left:${group.x}px; top:${group.y}px; width:${group.width}px; height:${group.height}px; background:${group.theme.bg}; border:2px dashed ${group.theme.border}; border-radius:12px; display:flex; flex-direction:column; resize:both; overflow:hidden;`;

    const header = document.createElement('div');
    header.style.cssText = `height:30px; background:rgba(255,255,255,0.5); border-bottom:1px solid ${group.theme.border}; cursor:move; display:flex; justify-content:space-between; align-items:center; padding:0 12px; flex-shrink:0;`;

    const port = document.createElement('div');
    port.innerHTML = '🔗';
    port.style.cssText = 'font-size:14px; cursor:crosshair; user-select:none; filter:grayscale(1);';
    port.title = 'Потяните, чтобы соединить';
    port.onmousedown = (e) => { e.stopPropagation(); isConnecting = true; connectStartNode = group; };

    const input = document.createElement('input');
    input.type = 'text';
    input.value = group.text;
    input.style.cssText = `background:transparent; border:none; outline:none; font-weight:bold; font-size:16px; color:${group.theme.text}; width:80%;`;
    input.oninput = (e) => group.text = e.target.value;
    input.onmousedown = (e) => e.stopPropagation();

    const delBtn = document.createElement('div');
    delBtn.innerHTML = '×';
    delBtn.style.cssText = 'color:#ef4444; font-weight:bold; font-size:20px; cursor:pointer; line-height:1; padding-bottom:2px;';
    delBtn.onmousedown = (e) => {
        e.stopPropagation();
        treeGroups = treeGroups.filter(g => g.id !== group.id);
        treeEdges = treeEdges.filter(e => e.source !== group.id && e.target !== group.id);
        el.remove();
        renderEdges();
    };

    header.appendChild(port);
    header.appendChild(input);
    header.appendChild(delBtn);
    el.appendChild(header);

    header.onmousedown = (e) => {
        isGroupDragging = true; draggedGroup = group;
        const rect = document.getElementById('tree-container').getBoundingClientRect();
        nodeDragOffsetX = ((e.clientX - rect.left - treePanX) / treeScale) - group.x;
        nodeDragOffsetY = ((e.clientY - rect.top - treePanY) / treeScale) - group.y;

        draggedGroupChildren = [];
        
        // Захватываем все вложенные узлы
        treeNodes.forEach(n => {
            if (n.x >= group.x && n.x + n.width <= group.x + group.width &&
                n.y >= group.y && n.y + n.height <= group.y + group.height) {
                draggedGroupChildren.push({ node: n, offsetX: n.x - group.x, offsetY: n.y - group.y });
            }
        });
        
        // Захватываем все вложенные группы
        treeGroups.forEach(g => {
            if (g.id !== group.id &&
                g.x >= group.x && g.x + g.width <= group.x + group.width &&
                g.y >= group.y && g.y + g.height <= group.y + group.height) {
                draggedGroupChildren.push({ isGroup: true, group: g, offsetX: g.x - group.x, offsetY: g.y - group.y });
            }
        });

        e.stopPropagation();
    };

    const ro = new ResizeObserver(() => {
        if (el.offsetWidth > 0) {
            group.width = el.offsetWidth;
            group.height = el.offsetHeight;
            renderEdges();
        }
    });
    ro.observe(el);

    container.appendChild(el);
}

function updateNodeElement(node) {
    const el = document.querySelector(`.tree-node[data-id="${node.id}"]`);
    if (el) { el.style.left = node.x + 'px'; el.style.top = node.y + 'px'; }
}

// Алгоритм Умных Стрелок (Ортогональное прокладывание пути Безье из центров граней)
function getSmartConnection(nodeA, nodeB) {
    const cxA = nodeA.x + (nodeA.width || 0) / 2;
    const cyA = nodeA.y + (nodeA.height || 0) / 2;
    const cxB = nodeB.x + (nodeB.width || 0) / 2;
    const cyB = nodeB.y + (nodeB.height || 0) / 2;

    const dx = cxB - cxA;
    const dy = cyB - cyA;

    let pA, pB, pA_s, pB_s, cpA, cpB;
    const fS = 15; // Длина прямого участка на выходе
    const fE = 20; // Длина прямого участка на входе (специально под стрелку)

    if (Math.abs(dx) > Math.abs(dy)) { // Соединение слева-направо или справа-налево
        if (dx > 0) {
            pA = { x: nodeA.x + (nodeA.width || 0), y: cyA };
            pB = { x: nodeB.x, y: cyB };
            pA_s = { x: pA.x + fS, y: pA.y };
            pB_s = { x: pB.x - fE, y: pB.y };
            const faceDist = pB_s.x - pA_s.x;
            let dist = Math.max(Math.abs(faceDist) * 0.5, Math.abs(dy) * 0.5);
            dist = Math.max(dist, 40);
            cpA = { x: pA_s.x + dist, y: pA_s.y };
            cpB = { x: pB_s.x - dist, y: pB_s.y };
        } else {
            pA = { x: nodeA.x, y: cyA };
            pB = { x: nodeB.x + (nodeB.width || 0), y: cyB };
            pA_s = { x: pA.x - fS, y: pA.y };
            pB_s = { x: pB.x + fE, y: pB.y };
            const faceDist = pA_s.x - pB_s.x;
            let dist = Math.max(Math.abs(faceDist) * 0.5, Math.abs(dy) * 0.5);
            dist = Math.max(dist, 40);
            cpA = { x: pA_s.x - dist, y: pA_s.y };
            cpB = { x: pB_s.x + dist, y: pB_s.y };
        }
    } else { // Соединение сверху-вниз или снизу-вверх
        if (dy > 0) {
            pA = { x: cxA, y: nodeA.y + (nodeA.height || 0) };
            pB = { x: cxB, y: nodeB.y };
            pA_s = { x: pA.x, y: pA.y + fS };
            pB_s = { x: pB.x, y: pB.y - fE };
            const faceDist = pB_s.y - pA_s.y;
            let dist = Math.max(Math.abs(faceDist) * 0.5, Math.abs(dx) * 0.5);
            dist = Math.max(dist, 40);
            cpA = { x: pA_s.x, y: pA_s.y + dist };
            cpB = { x: pB_s.x, y: pB_s.y - dist };
        } else {
            pA = { x: cxA, y: nodeA.y };
            pB = { x: cxB, y: nodeB.y + (nodeB.height || 0) };
            pA_s = { x: pA.x, y: pA.y - fS };
            pB_s = { x: pB.x, y: pB.y + fE };
            const faceDist = pA_s.y - pB_s.y;
            let dist = Math.max(Math.abs(faceDist) * 0.5, Math.abs(dx) * 0.5);
            dist = Math.max(dist, 40);
            cpA = { x: pA_s.x, y: pA_s.y - dist };
            cpB = { x: pB_s.x, y: pB_s.y + dist };
        }
    }

    const ox = 50000, oy = 50000;
    return `M ${pA.x + ox} ${pA.y + oy} L ${pA_s.x + ox} ${pA_s.y + oy} C ${cpA.x + ox} ${cpA.y + oy}, ${cpB.x + ox} ${cpB.y + oy}, ${pB_s.x + ox} ${pB_s.y + oy} L ${pB.x + ox} ${pB.y + oy}`;
}

function renderEdges() {
    const svg = document.getElementById('tree-edges');
    if(!svg) return;
    
    // Удаляем все старые постоянные связи
    const oldPaths = svg.querySelectorAll('g.edge-group, path:not(#temp-edge)');
    oldPaths.forEach(p => p.remove());

    // Генерируем цветные стрелочки (маркеры) в секции <defs>, если их нет
    const palette = ['#7D8A9A', '#E03030', '#E6A817', '#5AAFDD', '#3355CC'];
    let defs = svg.querySelector('defs');
    if (!defs) {
        defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        svg.appendChild(defs);
    }
    palette.forEach(c => {
        const markerId = 'arrowhead-' + c.replace('#', '');
        if (!document.getElementById(markerId)) {
            const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
            marker.id = markerId;
            marker.setAttribute('markerWidth', '10');
            marker.setAttribute('markerHeight', '7');
            marker.setAttribute('refX', '9');
            marker.setAttribute('refY', '3.5');
            marker.setAttribute('orient', 'auto');
            const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            poly.setAttribute('points', '0 0, 10 3.5, 0 7');
            poly.setAttribute('fill', c);
            marker.appendChild(poly);
            defs.appendChild(marker);
        }
    });

    treeEdges.forEach(edge => {
        const source = treeNodes.find(n => n.id === edge.source) || treeGroups.find(g => g.id === edge.source);
        const target = treeNodes.find(n => n.id === edge.target) || treeGroups.find(g => g.id === edge.target);
        if (source && target) {
            const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            group.classList.add('edge-group');
            group.style.cursor = 'pointer';
            group.style.pointerEvents = 'auto'; // Делаем связь кликабельной
            
            const pathData = getSmartConnection(source, target);
            
            const invisiblePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            invisiblePath.setAttribute('d', pathData);
            invisiblePath.setAttribute('fill', 'none');
            invisiblePath.setAttribute('stroke', 'transparent');
            invisiblePath.setAttribute('stroke-width', '20'); // Широкая невидимая область для легкого клика

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', pathData);
            path.setAttribute('fill', 'none');
            
            const color = edge.color || '#7D8A9A';
            path.setAttribute('stroke', color);
            path.setAttribute('stroke-width', '2');
            path.setAttribute('marker-end', `url(#arrowhead-${color.replace('#', '')})`);
            
            group.appendChild(invisiblePath);
            group.appendChild(path);
            
            // Ховер-эффект
            group.onmouseenter = () => path.setAttribute('stroke-width', '4');
            group.onmouseleave = () => path.setAttribute('stroke-width', '2');
            
            // Открытие меню по клику
            group.onmousedown = (e) => {
                e.stopPropagation();
                showEdgeMenu(edge, e.clientX, e.clientY);
            };

            svg.appendChild(group);
        }
    });
}

function renderTempEdge(sourceNode, mouseX, mouseY) {
    const svg = document.getElementById('tree-edges');
    if(!svg) return;
    
    let tempEdge = document.getElementById('temp-edge');
    if (!tempEdge) {
        tempEdge = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        tempEdge.id = 'temp-edge';
        tempEdge.setAttribute('fill', 'none');
        tempEdge.setAttribute('stroke', 'var(--accent-primary)');
        tempEdge.setAttribute('stroke-dasharray', '5,5');
        tempEdge.setAttribute('stroke-width', '2');
        tempEdge.setAttribute('marker-end', 'url(#arrowhead)');
        svg.appendChild(tempEdge);
    }
    
    const nodeB = { x: mouseX, y: mouseY, width: 0, height: 0 };
    tempEdge.setAttribute('d', getSmartConnection(sourceNode, nodeB));
}

// --- МЕНЮ УПРАВЛЕНИЯ СВЯЗЯМИ (ЦВЕТ / УДАЛЕНИЕ) ---
function showEdgeMenu(edge, x, y) {
    selectedEdge = edge;
    let menu = document.getElementById('edge-context-menu');
    if (!menu) {
        menu = document.createElement('div');
        menu.id = 'edge-context-menu';
        menu.style.cssText = 'position:fixed; display:none; background:#fff; border:1px solid var(--border-light); border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.15); padding:12px; z-index:10000; flex-direction:column; gap:12px;';
        document.body.appendChild(menu);

        const title = document.createElement('div');
        title.innerText = 'Цвет связи:';
        title.style.cssText = 'font-size:12px; font-weight:600; color:var(--text-muted); text-align:center;';
        menu.appendChild(title);

        const palette = document.createElement('div');
        palette.style.cssText = 'display:flex; gap:8px; justify-content:center;';
        // Палитра из нового ТЗ
        const colors = ['#7D8A9A', '#E03030', '#E6A817', '#5AAFDD', '#3355CC'];
        colors.forEach(c => {
            const btn = document.createElement('div');
            btn.style.cssText = `width:24px; height:24px; border-radius:50%; background:${c}; cursor:pointer; border:2px solid transparent; transition:transform 0.1s;`;
            btn.onmouseenter = () => btn.style.transform = 'scale(1.2)';
            btn.onmouseleave = () => btn.style.transform = 'scale(1)';
            btn.onclick = () => {
                if (selectedEdge) { selectedEdge.color = c; renderEdges(); }
                menu.style.display = 'none';
            };
            palette.appendChild(btn);
        });
        menu.appendChild(palette);

        const delBtn = document.createElement('button');
        delBtn.innerText = '🗑 Удалить связь';
        delBtn.style.cssText = 'background:#fee2e2; color:#b91c1c; border:none; border-radius:6px; padding:8px; cursor:pointer; font-size:12px; font-weight:bold; transition:background 0.2s;';
        delBtn.onmouseenter = () => delBtn.style.background = '#fca5a5';
        delBtn.onmouseleave = () => delBtn.style.background = '#fee2e2';
        delBtn.onclick = () => {
            if (selectedEdge) { treeEdges = treeEdges.filter(e => e !== selectedEdge); renderEdges(); }
            menu.style.display = 'none';
        };
        menu.appendChild(delBtn);

        // Скрываем меню при клике мимо или скролле
        document.addEventListener('mousedown', (e) => {
            if (menu.style.display === 'flex' && !menu.contains(e.target) && !e.target.closest('.edge-group')) menu.style.display = 'none';
        });
        window.addEventListener('wheel', () => menu.style.display = 'none');
    }
    menu.style.left = (x + 10) + 'px';
    menu.style.top = (y + 10) + 'px';
    menu.style.display = 'flex';
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initTreeGraph);
} else {
    initTreeGraph();
}