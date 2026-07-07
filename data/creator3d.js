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

let showCreatorAnnotations = true;
window.toggleCreatorAnnotations = function(val) { showCreatorAnnotations = val; };

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
let isGridVisible = true;
let isOrtho = false;

let sketchPoints = []; // Точки для привязок (Vector3)
let sketchSegments = []; // Отрезки для поиска середин
let sketchCircles = []; // Круги для выдавливания
let snapMarker = null; // Визуальный маркер привязки
let currentDrawPoints = []; // Точки текущего инструмента
let tempShapePreview = null; // Временный Mesh/Line
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
let cutoutState = 0; // Состояние для инструмента выреза
let bendState = 0; // 0: off, 1: select edge
let bendHighlight = null;

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
    creatorScene.background = new THREE.Color(0xE8ECF1); 

    creatorCamera = new THREE.PerspectiveCamera(45, initWidth / initHeight, 1, 10000);
    creatorCamera.position.set(200, 150, 200);
    
    // Ортографическая камера для эскизов
    const frustumSize = 400;
    creatorOrthoCamera = new THREE.OrthographicCamera(-frustumSize * aspect / 2, frustumSize * aspect / 2, frustumSize / 2, -frustumSize / 2, 1, 10000);
    
    currentCreatorCamera = creatorCamera;

    creatorRenderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    creatorRenderer.setSize(initWidth, initHeight);
    creatorRenderer.setPixelRatio(window.devicePixelRatio);

    creatorControls = new THREE.OrbitControls(currentCreatorCamera, creatorRenderer.domElement);
    creatorControls.enableDamping = true;
    creatorControls.dampingFactor = 0.05;
    creatorControls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

    // Освещение сцены конструктора
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x7D8A9A, 0.8);
    creatorScene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight.position.set(200, 500, 300);
    creatorScene.add(dirLight);

    function animateCreator() {
        requestAnimationFrame(animateCreator);
        if (document.getElementById('view-creator').style.display !== 'none') {
            creatorControls.update();
            creatorRenderer.render(creatorScene, currentCreatorCamera);
            
            if (customGizmo && customGizmo.visible) {
                const dist = currentCreatorCamera.position.distanceTo(customGizmo.position);
                const scale = Math.max(dist / 100, 0.1);
                customGizmo.scale.setScalar(scale);
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
        }
    }
    animateCreator();

    // Замена window.resize на ResizeObserver для плавного заполнения холста при скрытии панелей
    const canvasParent = canvas.parentElement;
    const resizeObserver = new ResizeObserver(() => {
        if (document.getElementById('view-creator').style.display !== 'none') {
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
        ['plate', 'cylinder', 'pipe', 'knitsa', 'bulbbar', 'angle', 'channel'].forEach(id => {
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
        
        quickPanel.style.left = menu.style.left;
        quickPanel.style.top = menu.style.top;
        quickPanel.classList.add('active');
        
        // Подтягиваем сгенерированную 3D-иконку из базы
        const origImg = document.getElementById('icon-' + id);
        const img = document.getElementById('quick-icon-' + id);
        if (img && origImg) img.src = origImg.src;

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
window.openQuickCylinder = () => window.openQuickItem('cylinder', 'qi-cyl-d');
window.openQuickPipe = () => window.openQuickItem('pipe', 'qi-pipe-d');
window.openQuickKnitsa = () => window.openQuickItem('knitsa', 'qi-kn-h');
window.openQuickBulbbar = () => window.openQuickItem('bulbbar', 'qi-bulbbar-type');
window.openQuickAngle = () => window.openQuickItem('angle', 'qi-angle-type');
window.openQuickChannel = () => window.openQuickItem('channel', 'qi-channel-type');

window.closeQuickPanels = function() {
    ['plate', 'cylinder', 'pipe', 'knitsa', 'bulbbar', 'angle', 'channel'].forEach(id => {
        const p = document.getElementById('quick-input-' + id);
        if (p) {
            p.classList.remove('active');
        }
    });
    const rm = document.getElementById('radial-menu');
    if (rm) {
        rm.classList.remove('active');
    }
};

window.applyQuickPlate = function() {
    const t = parseFloat(document.getElementById('qi-plate-t').value);
    const w = parseFloat(document.getElementById('qi-plate-w').value);
    const l = parseFloat(document.getElementById('qi-plate-l').value);
    
    if (!isNaN(t) && !isNaN(w) && !isNaN(l) && t > 0 && w > 0 && l > 0) {
        createPlate(t, w, l);
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
    if (!isNaN(d) && !isNaN(t) && !isNaN(l) && d > 0 && t > 0 && l > 0 && t < d / 2) {
        createPipe(d, t, l);
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
        window.closeQuickPanels();
        const canvas = document.getElementById('canvas-creator');
        if(canvas) canvas.focus();
    } else {
        if (typeof showToast === 'function') showToast("Выберите тип и длину");
    }
};

window.cancelAllCommands = function() {
    hideAllCreatorPanels();
    cancelGizmo();
    cutoutState = 0;
    bendState = 0;
    if (bendHighlight) {
        creatorScene.remove(bendHighlight);
        bendHighlight = null;
    }
    // Принудительно скрываем HUD эскиза, даже если сам режим уже был завершен
    if (sketchHudTooltip) {
        sketchHudTooltip.style.display = 'none';
        sketchHudTooltip.innerText = '';
    }
    if (isSketchMode) cancelSketch();
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
    if (window.isCommandActive && window.isCommandActive('tool-bend')) {
        cancelAllCommands();
        return;
    }
    cancelAllCommands();
    // Если команда вызвана из радиального меню, закрываем его
    if (typeof window.closeQuickPanels === 'function') {
        window.closeQuickPanels();
    }

    setCreatorActiveTool('tool-bend');
    hideAllCreatorPanels();
    document.getElementById('creator-inputs-container').style.display = 'block';
    document.getElementById('bend-inputs').style.display = 'flex';

    // Переходим в состояние выбора кромки
    bendState = 1; 
    // Сбрасываем предыдущий выбор
    if (bendHighlight) creatorScene.remove(bendHighlight);
    bendHighlight = null;
    setCreatorUIMode('mate-select'); // Crosshair cursor
};

function cancelGizmo() {
    gizmoState = 0;
    isGizmoDragging = false;
    selectedObjects.forEach(obj => {
        if (obj.userData && obj.userData.originalObjectColor !== undefined) {
            obj.material.color.setHex(obj.userData.originalObjectColor);
        }
    });
    selectedObjects = [];
    if (customGizmo) customGizmo.visible = false;
    if (document.getElementById('canvas-creator')) document.getElementById('canvas-creator').style.cursor = 'default';
}

function startPlateCommand() {
    if (window.isCommandActive && window.isCommandActive('tool-plate')) { cancelAllCommands(); return; }
    cancelAllCommands();
    setCreatorActiveTool('tool-plate');
    hideAllCreatorPanels();
    document.getElementById('creator-inputs-container').style.display = 'block';
    document.getElementById('plate-inputs').style.display = 'flex';
    document.getElementById('plate-t').value = '';
    document.getElementById('plate-w').value = '';
    document.getElementById('plate-l').value = '';
    setTimeout(() => document.getElementById('plate-t').focus(), 100);
}

function startCylinderCommand() {
    if (window.isCommandActive && window.isCommandActive('tool-cylinder')) { cancelAllCommands(); return; }
    cancelAllCommands();
    setCreatorActiveTool('tool-cylinder');
    hideAllCreatorPanels();
    document.getElementById('creator-inputs-container').style.display = 'block';
    document.getElementById('cylinder-inputs').style.display = 'flex';
    document.getElementById('cyl-d').value = '';
    document.getElementById('cyl-l').value = '';
    setTimeout(() => document.getElementById('cyl-d').focus(), 100);
}

function startPipeCommand() {
    if (window.isCommandActive && window.isCommandActive('tool-pipe')) { cancelAllCommands(); return; }
    cancelAllCommands();
    setCreatorActiveTool('tool-pipe');
    hideAllCreatorPanels();
    document.getElementById('creator-inputs-container').style.display = 'block';
    document.getElementById('pipe-inputs').style.display = 'flex';
    document.getElementById('pipe-d').value = '';
    document.getElementById('pipe-t').value = '';
    document.getElementById('pipe-l').value = '';
    setTimeout(() => document.getElementById('pipe-d').focus(), 100);
}

function startBulbBarCommand() {
    if (window.isCommandActive && window.isCommandActive('tool-bulbbar')) { cancelAllCommands(); return; }
    cancelAllCommands();
    setCreatorActiveTool('tool-bulbbar');
    hideAllCreatorPanels();
    document.getElementById('creator-inputs-container').style.display = 'block';
    document.getElementById('bulbbar-inputs').style.display = 'flex';
    document.getElementById('bulbbar-l').value = '';
    setTimeout(() => document.getElementById('bulbbar-type').focus(), 100);
}

function startAngleCommand() {
    if (window.isCommandActive && window.isCommandActive('tool-angle')) { cancelAllCommands(); return; }
    cancelAllCommands();
    setCreatorActiveTool('tool-angle');
    hideAllCreatorPanels();
    document.getElementById('creator-inputs-container').style.display = 'block';
    document.getElementById('angle-inputs').style.display = 'flex';
    document.getElementById('angle-l').value = '';
    setTimeout(() => document.getElementById('angle-type').focus(), 100);
}

function startChannelCommand() {
    if (window.isCommandActive && window.isCommandActive('tool-channel')) { cancelAllCommands(); return; }
    cancelAllCommands();
    setCreatorActiveTool('tool-channel');
    hideAllCreatorPanels();
    document.getElementById('creator-inputs-container').style.display = 'block';
    document.getElementById('channel-inputs').style.display = 'flex';
    document.getElementById('channel-l').value = '';
    setTimeout(() => document.getElementById('channel-type').focus(), 100);
}

window.startCutoutCommand = function() {
    if (window.isCommandActive && window.isCommandActive('tool-cutout')) { cancelAllCommands(); return; }
    cancelAllCommands();
    setCreatorActiveTool('tool-cutout');
    hideAllCreatorPanels();
    document.getElementById('creator-inputs-container').style.display = 'block';
    document.getElementById('cutout-inputs').style.display = 'flex';
    
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
    document.getElementById('creator-inputs-container').style.display = 'block';
    document.getElementById('knitsa-inputs').style.display = 'flex';
    setTimeout(() => document.getElementById('kn-h').focus(), 100);
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
    
    creatorScene.add(mesh);
    creatorControls.target.copy(mesh.position);
    creatorCamera.position.set(l * 1.5, Math.max(h * 2, 50), l * 1.5);
    creatorControls.update();
    
    if (typeof showToast === 'function') showToast(`Создана Кница: ${h}x${l}x${th}`);
    addPartToSpec(`Кница: ${h}x${l}x${th}`, mesh);
};

function setupCreatorInputs() {
    // --- ЛИСТОВОЕ: ПЛАСТИНА ---
    const pt = document.getElementById('plate-t'), pw = document.getElementById('plate-w'), pl = document.getElementById('plate-l');
    pt.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); pw.focus(); } });
    pw.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); pl.focus(); } });
    pl.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            createPlate(parseFloat(pt.value), parseFloat(pw.value), parseFloat(pl.value));
            cancelAllCommands();
        }
    });

    // --- ПРОФИЛЬНОЕ: КРУГ/ЦИЛИНДР ---
    const cd = document.getElementById('cyl-d'), cl = document.getElementById('cyl-l');
    cd.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); cl.focus(); } });
    cl.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            createCylinder(parseFloat(cd.value), parseFloat(cl.value));
            cancelAllCommands();
        }
    });

    // --- ПРОФИЛЬНОЕ: ТРУБА ---
    const pd = document.getElementById('pipe-d'), pth = document.getElementById('pipe-t'), pl_p = document.getElementById('pipe-l');
    pd.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); pth.focus(); } });
    pth.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); pl_p.focus(); } });
    pl_p.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            createPipe(parseFloat(pd.value), parseFloat(pth.value), parseFloat(pl_p.value));
            cancelAllCommands();
        }
    });

    // --- ПРОФИЛЬНОЕ: ПОЛОСОБУЛЬБ ---
    const bbl = document.getElementById('bulbbar-l'), bbt = document.getElementById('bulbbar-type');
    bbl.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            createBulbBar(bbt.value, parseFloat(bbl.value));
            cancelAllCommands();
        }
    });

    // --- ПРОФИЛЬНОЕ: УГОЛОК ---
    const al = document.getElementById('angle-l'), at = document.getElementById('angle-type');
    al.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            createAngleBar(at.value, parseFloat(al.value));
            cancelAllCommands();
        }
    });
    
    // --- ПРОФИЛЬНОЕ: ШВЕЛЛЕР ---
    const cl_l = document.getElementById('channel-l'), cl_t = document.getElementById('channel-type');
    cl_l.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            createChannelBar(cl_t.value, parseFloat(cl_l.value));
            cancelAllCommands();
        }
    });
    
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
                        if (index < ids.length - 1) document.getElementById(ids[index + 1]).focus();
                        else applyFn();
                    } else if(e.key === 'Escape') closeQuickPanels();
                });
            }
        });
    };
    setupQuickHotkeys(['qi-plate-t', 'qi-plate-w', 'qi-plate-l'], applyQuickPlate);
    setupQuickHotkeys(['qi-cyl-d', 'qi-cyl-l'], applyQuickCylinder);
    setupQuickHotkeys(['qi-pipe-d', 'qi-pipe-t', 'qi-pipe-l'], applyQuickPipe);
    setupQuickHotkeys(['qi-kn-h', 'qi-kn-l', 'qi-kn-hbot', 'qi-kn-wtop', 'qi-kn-c', 'qi-kn-th', 'qi-kn-flw'], applyQuickKnitsa);
    setupQuickHotkeys(['qi-bulbbar-type', 'qi-bulbbar-l'], applyQuickBulbbar);
    setupQuickHotkeys(['qi-angle-type', 'qi-angle-l'], applyQuickAngle);
    setupQuickHotkeys(['qi-channel-type', 'qi-channel-l'], applyQuickChannel);
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
        objsToDelete.forEach(obj => {
            // Удаляем выноску из боковой панели, если она есть
            if (obj.userData && obj.userData.specTextSpan) {
                const specItem = obj.userData.specTextSpan.parentElement;
                if (specItem) specItem.remove();
            }
            // Возвращаем активность кнопке "3D", если деталь создана из таблицы
            if (obj.userData && obj.userData.specRow) {
                const btn = obj.userData.specRow.querySelector('.btn-3d');
                if (btn) {
                    btn.dataset.spawned = 'false';
                    btn.disabled = false;
                    btn.className = 'btn-3d ready';
                    btn.innerHTML = '➕';
                    btn.title = 'Создать 3D модель';
                }
            }
            disposeHierarchy(obj);
        });
        cancelGizmo();
        window.closeQuickPanels();
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

    specList.appendChild(item);
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

    mesh.userData.specData = { type: 'plate', t, w, l };
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
    creatorScene.add(mesh);
    creatorControls.target.copy(mesh.position);
    creatorCamera.position.set(d * 2, Math.max(d * 3, 50), l * 1.5);
    creatorControls.update();
    if (typeof showToast === 'function') showToast(`Создан профиль Круг: D${d} L${l}`);
    addPartToSpec(`Круг (Цилиндр): D${d} L${l}`, mesh);
}

function createPipe(dOut, t, l) {
    if (isNaN(dOut) || isNaN(t) || isNaN(l) || dOut <= 0 || t <= 0 || l <= 0 || t >= dOut / 2) {
        if (typeof showToast === 'function') showToast("Ошибка: Некорректные размеры трубы!");
        return;
    }
    const rOut = dOut / 2;
    const rIn = rOut - t;

    const shape = new THREE.Shape();
    shape.absarc(0, 0, rOut, 0, Math.PI * 2, false);
    const holePath = new THREE.Path();
    holePath.absarc(0, 0, rIn, 0, Math.PI * 2, true);
    shape.holes.push(holePath);

    const extrudeSettings = { depth: l, bevelEnabled: false, curveSegments: 32 };
    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geometry.translate(0, 0, -l / 2); // Центрируем по длине

    const material = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, metalness: 0.5, roughness: 0.4 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, rOut, 0);

    const edges = new THREE.EdgesGeometry(geometry, showRadialEdges ? 1 : 15);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x2A3142 }));
    mesh.add(line);

    mesh.userData.specData = { type: 'pipe', dOut, t, l };
    creatorScene.add(mesh);
    creatorControls.target.copy(mesh.position);
    creatorCamera.position.set(dOut * 2, Math.max(dOut * 3, 50), l * 1.5);
    creatorControls.update();
    if (typeof showToast === 'function') showToast(`Создана Труба: D${dOut}x${t} L${l}`);
    addPartToSpec(`Труба: D${dOut}x${t} L${l}`, mesh);
}

function createBulbBar(type, length) {
    if (!BulbProfiles[type]) {
        if (typeof showToast === 'function') showToast(`Ошибка: Профиль '${type}' не найден!`);
        return;
    }
    if (isNaN(length) || length <= 0) {
        if (typeof showToast === 'function') showToast("Ошибка: Некорректная длина!");
        return;
    }

    const points = BulbProfiles[type];
    const shape = createShapeFromBulgePoly(points);
    const extrudeSettings = { depth: length, bevelEnabled: false };
    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);

    const material = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, metalness: 0.5, roughness: 0.4 });
    const mesh = new THREE.Mesh(geometry, material);

    const edges = new THREE.EdgesGeometry(geometry, showRadialEdges ? 1 : 15);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x2A3142 }));
    mesh.add(line);

    mesh.userData.specData = { type: 'profile', name: type, l: length };
    creatorScene.add(mesh);
    creatorControls.target.copy(mesh.position);
    creatorCamera.position.set(200, 200, length * 1.5);
    creatorControls.update();
    
    if (typeof showToast === 'function') showToast(`Создан Полособульб: ${type} L${length}`);
    addPartToSpec(`Полособульб: ${type} L${length}`, mesh);
}

function createAngleBar(type, length) {
    let points = AngleProfiles[type];
    
    // Поддержка нестандартных (неравнобоких и равнобоких) уголков
    if (!points) {
        const cleanType = type.replace(/^(L|Уголок)\s*/i, '').trim();
        const parts = cleanType.split(/[\sxх*]+/).filter(Boolean).map(Number);
        
        if (parts.length === 3 && parts.every(n => !isNaN(n) && n > 0)) {
            // Неравнобокий B1 x B2 x t
            const b1 = parts[0], b2 = parts[1], t = parts[2];
            const r = t * 0.6; // типовой радиус скругления
            points = [ [0.0, t, 0.0], [0.0, 0.0, 0.0], [b1, 0.0, 0.0], [b1, t, 0.0], [t + r, t, -0.4142], [t, t + r, 0.0], [t, b2, 0.0], [0.0, b2, 0.0] ];
        } else if (parts.length === 2 && parts.every(n => !isNaN(n) && n > 0)) {
            // Равнобокий B x t
            const b = parts[0], t = parts[1];
            const r = t * 0.6;
            points = [ [0.0, t, 0.0], [0.0, 0.0, 0.0], [b, 0.0, 0.0], [b, t, 0.0], [t + r, t, -0.4142], [t, t + r, 0.0], [t, b, 0.0], [0.0, b, 0.0] ];
        }
    }

    if (!points) {
        if (typeof showToast === 'function') showToast(`Ошибка: Профиль '${type}' не найден! (Формат через пробел: B1 B2 t)`);
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

    mesh.userData.specData = { type: 'profile', name: type, l: length };
    creatorScene.add(mesh);
    creatorControls.target.copy(mesh.position);
    creatorCamera.position.set(200, 200, length * 1.5);
    creatorControls.update();
    
    if (typeof showToast === 'function') showToast(`Создан Уголок: ${type} L${length}`);
    addPartToSpec(`Уголок: ${type} L${length}`, mesh);
}

function createChannelBar(type, length) {
    let points = null;
    if (ChannelParams[type]) {
        points = generateChannelPoints(...ChannelParams[type]);
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

    mesh.userData.specData = { type: 'profile', name: type, l: length };
    creatorScene.add(mesh);
    creatorControls.target.copy(mesh.position);
    creatorCamera.position.set(200, 200, length * 1.5);
    creatorControls.update();
    
    if (typeof showToast === 'function') showToast(`Создан Швеллер: ${type} L${length}`);
    addPartToSpec(`Швеллер: ${type} L${length}`, mesh);
}

// --- ЛОГИКА ГИЗМО И СЛИПАНИЯ ---

function isDescendant(child, potentialAncestor) {
    let curr = child;
    while (curr) {
        if (curr === potentialAncestor) return true;
        curr = curr.parent;
    }
    return false;
}

function startMateCommand() {
    if (window.isCommandActive && window.isCommandActive('tool-mate')) { cancelAllCommands(); return; }
    cancelAllCommands();
    isSketchMode = false;
    mateState = 1;
    setCreatorActiveTool('tool-mate');
    setCreatorUIMode('mate-select');
    if (typeof showToast === 'function') showToast("Выберите первую грань (станет зелёной)");
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

function createMateMarker(mateObj) {
    const wrapper = document.createElement('div');
    wrapper.className = 'zone-marker-wrapper';
    wrapper.style.pointerEvents = 'auto'; // allow interaction

    const label = document.createElement('div');
    label.className = 'zone-label';
    label.innerText = 'Слипание';
    label.style.background = '#E6A817';
    label.style.color = '#fff';
    label.style.borderColor = '#E6A817';
    
    label.onmouseenter = () => {
        const pA = mateObj.objA.localToWorld(mateObj.faceA_localPoint.clone());
        const nA = mateObj.faceA_localNormal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(mateObj.objA.matrixWorld)).normalize();
        const pB = mateObj.objB.localToWorld(mateObj.faceB_localPoint.clone());
        const nB = mateObj.faceB_localNormal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(mateObj.objB.matrixWorld)).normalize();
        
        mateHighlightGroup.add(createFaceHighlight(pA, nA, 0x5AAFDD), createFaceHighlight(pB, nB, 0xE6A817));
        label.style.transform = 'translate(-50%, -100%) scale(1.1)';
    };
    label.onmouseleave = () => {
        mateHighlightGroup.clear();
        label.style.transform = 'translate(-50%, -100%) scale(1)';
    };
    label.onclick = () => {
        if (confirm("Удалить это ограничение (слипание)?")) {
            allMates = allMates.filter(m => m !== mateObj);
            wrapper.remove();
            const remainingMate = allMates.find(m => m.objB === mateObj.objB);
            if (remainingMate) remainingMate.objA.attach(mateObj.objB); else creatorScene.attach(mateObj.objB);
            mateHighlightGroup.clear();
            if (typeof showToast === 'function') showToast("Слипание удалено");
        }
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
    sketchTool = tool;
    if (tempShapePreview) {
        // Не удаляем, а просто скрываем фантом
        tempShapePreview.visible = false;
        tempShapePreview.geometry.setDrawRange(0, 0);
    }

    closeSketchRadialMenu();

    if (sketchHudTooltip) {
        let toolName = '';
        if (tool === 'line') toolName = 'Отрезок';
        else if (tool === 'circle') toolName = 'Окружность';
        else if (tool === 'arc') toolName = 'Дуга';
        else if (tool === 'rectangle') toolName = 'Прямоугольник';

        if (toolName) {
            sketchHudTooltip.innerText = `[ ${toolName} ]`;
            sketchHudTooltip.style.display = 'block';
        } else {
            sketchHudTooltip.style.display = 'none';
        }
    }
    
    // Обновляем состояние кнопок в радиальном меню эскиза
    const sketchMenu = document.getElementById('sketch-radial-menu');
    if (sketchMenu) {
        ['line', 'rectangle', 'circle', 'arc'].forEach(t => {
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

    ['line', 'circle', 'arc', 'rectangle'].forEach(t => {
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
    if (!sketchRadialMenu) return;
    closeQuickPanels(); // Закрываем другие панели
    
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
    if (sketchRadialMenu) {
        sketchRadialMenu.classList.remove('active');
    }
}

function toggleOrtho(val) {
    isOrtho = val;
}

function setupSketchInteraction(canvas) {
	// --- Логика для вызова радиального меню по двойному клику ПКМ ---
	let lastRightClickTime = 0;
	const DBL_CLICK_THRESHOLD = 300; // 300ms

	// Блокируем стандартное контекстное меню в режиме эскиза и ловим двойной клик
	canvas.addEventListener('contextmenu', e => {
		if (isSketchMode) {
			e.preventDefault();

            // Если мы в процессе рисования (есть начальная точка), одиночный ПКМ отменяет операцию
            if (sketchState === 1 && currentDrawPoints.length > 0) {
                currentDrawPoints = [];
                if (tempShapePreview) {
                    tempShapePreview.visible = false;
                    tempShapePreview.geometry.setDrawRange(0, 0);
                }
                if (snapMarker) snapMarker.visible = false;
                setSketchTool(sketchTool); // Сброс состояния текущего инструмента
                return;
            }

            // Если не рисуем, то двойной клик открывает радиальное меню
			if (sketchState === 1) { 
				const now = Date.now();
				if (now - lastRightClickTime < DBL_CLICK_THRESHOLD) {
					// Двойной клик обнаружен
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
        const rect = canvas.getBoundingClientRect();
        sketchMouse.x = ((e.clientX - rect.left) / canvas.clientWidth) * 2 - 1;
        sketchMouse.y = -((e.clientY - rect.top) / canvas.clientHeight) * 2 + 1;

        // Обновляем луч один раз в начале для всех последующих проверок в этом обработчике
        sketchRaycaster.setFromCamera(sketchMouse, currentCreatorCamera);

        if (sketchHudTooltip && sketchHudTooltip.style.display === 'block') {
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
                // Если 'XYZ' - двигается свободно в плоскости камеры

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
                    deltaWorld.set(0, 0, 0); // Движение заблокировано
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
            function isGizmoPart(o){let c=o;while(c){if(c===customGizmo)return true;c=c.parent;}return false;}
            creatorScene.traverse(c => { 
                if (c.isMesh && c !== snapMarker && !c.userData.isSketchPlane && !c.userData.isSketch && !c.userData.isMateHighlight && !isGizmoPart(c)) {
                    interactable.push(c); 
                }
            });
            const intersects = sketchRaycaster.intersectObjects(interactable, false);
            
            if (intersects.length > 0) {
                let hit = intersects[0].object;
                hit.userData.specRow = linkTargetRow;
                
                linkTargetBtn.dataset.spawned = 'true';
                linkTargetBtn.disabled = false;
                linkTargetBtn.className = 'btn-3d spawned';
                linkTargetBtn.innerHTML = '🔗';
                linkTargetBtn.title = 'Связано с 3D моделью (клик - центрировать)';
                
                if (typeof showToast === 'function') showToast("Модель успешно привязана к спецификации");
                
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

        if (mateState > 0) return;
        if (!isSketchMode) return;
        // Если мы в режиме эскиза и уже поставили первую точку, обновляем фантом
        if (sketchState === 1 && currentDrawPoints.length > 0 && activeSketchPlane) {
            const intersects = sketchRaycaster.intersectObject(activeSketchPlane);
            if (intersects.length > 0) {
                const snappedPt = applySnapsAndOrtho(intersects[0].point, true);
                updateTempShape(snappedPt);
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

    const gizmoPopup = document.getElementById('gizmo-input-popup');
    const gizmoInput = document.getElementById('gizmo-value-input');

    canvas.addEventListener('dblclick', (e) => {
        if (isSketchMode || isGizmoDragging) return;
        let didGizmoClick = false;

        const rect = canvas.getBoundingClientRect();
        sketchMouse.x = ((e.clientX - rect.left) / canvas.clientWidth) * 2 - 1;
        sketchMouse.y = -((e.clientY - rect.top) / canvas.clientHeight) * 2 + 1;

        if (gizmoState === 2 && customGizmo && customGizmo.visible) {
            sketchRaycaster.setFromCamera(sketchMouse, currentCreatorCamera);
            const intersects = sketchRaycaster.intersectObject(customGizmo, true);
            
            if (intersects.length > 0) {
                const hit = intersects[0].object;
                if (hit.userData.gizmoAxis) {
                    e.preventDefault();
                    e.stopPropagation();
                    activeGizmoInputAction = hit.userData.gizmoAxis;
                    
                    gizmoPopup.style.display = 'block';
                    gizmoPopup.style.left = `${e.clientX + 5}px`;
                    gizmoPopup.style.top = `${e.clientY + 5}px`;
                    gizmoInput.value = '';
                    gizmoInput.focus();
                    didGizmoClick = true;
                }
            }
        }

        // Вызов Быстрого кругового меню, если клик был не по Гизмо
        if (!didGizmoClick && mateState === 0) {
            e.preventDefault();
            const hasSelection = selectedObjects.length > 0;
            if (window.openRadialMenu) window.openRadialMenu(e.clientX, e.clientY, hasSelection);
        }
    });

    gizmoInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const value = parseFloat(gizmoInput.value);
            if (!isNaN(value)) {
                applyGizmoValue(value);
            }
            gizmoPopup.style.display = 'none';
            activeGizmoInputAction = null;
        } else if (e.key === 'Escape') {
            gizmoPopup.style.display = 'none';
            activeGizmoInputAction = null;
        }
    });

    document.addEventListener('click', (e) => { if (gizmoPopup && gizmoPopup.style.display === 'block' && !gizmoPopup.contains(e.target)) { gizmoPopup.style.display = 'none'; activeGizmoInputAction = null; } }, true);

    window.addEventListener('pointerup', (e) => {
        if (e.button !== 0) return;
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
        if (e.button !== 0) return;
        
        const rect = canvas.getBoundingClientRect();
        sketchMouse.x = ((e.clientX - rect.left) / canvas.clientWidth) * 2 - 1;
        sketchMouse.y = -((e.clientY - rect.top) / canvas.clientHeight) * 2 + 1;

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
                
                if (mateState === 1) {
                    mateObjectA = intersect.object;
                    mateFaceA = { 
                        point: intersect.point.clone(), 
                        normal: worldNormal.clone(),
                        localNormal: intersect.face.normal.clone(),
                        localPoint: intersect.object.worldToLocal(intersect.point.clone())
                    };
                    mateHighlightA = createFaceHighlight(intersect.point, worldNormal, 0x5AAFDD);
                    creatorScene.add(mateHighlightA);
                    
                    mateState = 2;
                    if (typeof showToast === 'function') showToast("Выберите вторую грань на ДРУГОМ объекте (станет оранжевой)");
                } else if (mateState === 2) {
                    if (intersect.object === mateObjectA) {
                        if (typeof showToast === 'function') showToast("Выберите грань на ДРУГОМ объекте!");
                        return;
                    }
                    
                    mateObjectB = intersect.object;
                    mateFaceB = { point: intersect.point.clone(), normal: worldNormal.clone(), localNormal: intersect.face.normal.clone(), localPoint: intersect.object.worldToLocal(intersect.point.clone()) };
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

        if (mateState === 1 || mateState === 2) {
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
                
                if (mateState === 1) {
                    mateObjectA = intersect.object;
                    mateFaceA = { 
                        point: intersect.point.clone(), 
                        normal: worldNormal.clone(),
                        localNormal: intersect.face.normal.clone(),
                        localPoint: intersect.object.worldToLocal(intersect.point.clone())
                    };
                    mateHighlightA = createFaceHighlight(intersect.point, worldNormal, 0x5AAFDD);
                    creatorScene.add(mateHighlightA);
                    
                    mateState = 2;
                    if (typeof showToast === 'function') showToast("Выберите вторую грань на ДРУГОМ объекте (станет оранжевой)");
                } else if (mateState === 2) {
                    if (intersect.object === mateObjectA) {
                        if (typeof showToast === 'function') showToast("Выберите грань на ДРУГОМ объекте!");
                        return;
                    }
                    
                    mateObjectB = intersect.object;
                    mateFaceB = { point: intersect.point.clone(), normal: worldNormal.clone(), localNormal: intersect.face.normal.clone(), localPoint: intersect.object.worldToLocal(intersect.point.clone()) };
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

        if (bendState === 1 || bendState === 2) { // Теперь работает и после выбора
            sketchRaycaster.setFromCamera(sketchMouse, currentCreatorCamera);
            const interactable = [];
            creatorScene.traverse(c => {
                // Only allow bending plates for now
                if (c.isMesh && c.userData.specData && (c.userData.specData.type === 'plate' || c.userData.specData.type === 'bent_plate')) {
                    interactable.push(c);
                }
            });
            const intersects = sketchRaycaster.intersectObjects(interactable, false);

            if (intersects.length > 0) {
                const intersect = intersects[0]; // Берем первый пересеченный объект
                const object = intersect.object; // Это наша пластина
                const face = intersect.face; // Грань, по которой кликнули
                const point = intersect.point; // Точка клика в мировых координатах

                const geometry = object.geometry; // Геометрия объекта
                const vertices = geometry.attributes.position; // Вершины геометрии
                
                let bestEdge = null;
                let minDistance = Infinity;

                // Ищем ближайшую к точке клика кромку на грани
                const faceIndices = [face.a, face.b, face.c];
                for (let i = 0; i < 3; i++) {
                    const v1_idx = faceIndices[i];
                    const v2_idx = faceIndices[(i + 1) % 3];

                    // Получаем мировые координаты вершин кромки
                    const v1 = new THREE.Vector3().fromBufferAttribute(vertices, v1_idx).applyMatrix4(object.matrixWorld);
                    const v2 = new THREE.Vector3().fromBufferAttribute(vertices, v2_idx).applyMatrix4(object.matrixWorld);

                    // Находим кратчайшее расстояние от точки клика до линии кромки
                    const line = new THREE.Line3(v1, v2);
                    const closestPointOnLine = new THREE.Vector3();
                    line.closestPointToPoint(point, true, closestPointOnLine);
                    const distance = point.distanceTo(closestPointOnLine);

                    if (distance < minDistance) {
                        minDistance = distance;
                        // Сохраняем лучшую найденную кромку
                        bestEdge = { v1, v2, faceNormal: face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(object.matrixWorld)).normalize() };
                    }
                }
                
                if (bestEdge) {
                    // Удаляем старую подсветку, если она была
                    if (bendHighlight) creatorScene.remove(bendHighlight);

                    // Создаем новую подсветку для выбранной кромки
                    const lineMat = new THREE.LineBasicMaterial({ color: 0xE03030, linewidth: 5, depthTest: false });
                    const lineGeo = new THREE.BufferGeometry().setFromPoints([bestEdge.v1, bestEdge.v2]);
                    bendHighlight = new THREE.Line(lineGeo, lineMat);
                    bendHighlight.renderOrder = 999;
                    // Сохраняем данные о кромке и объекте для кнопки "Создать"
                    bendHighlight.userData = { sourceObject: object, edge: bestEdge };
                    creatorScene.add(bendHighlight);
                    
                    // Переходим в состояние "кромка выбрана"
                    bendState = 2;
                    if (typeof showToast === 'function') showToast("Кромка выбрана. Настройте параметры и нажмите 'Создать гиб'.");
                }
            }
            return;
        }

        // --- Логика выбора объектов и эскизирования ---
        if (!isSketchMode) {
            if (isGizmoDragging) return;
            sketchRaycaster.setFromCamera(sketchMouse, currentCreatorCamera);
            if (gizmoState > 0 && sketchRaycaster.intersectObject(customGizmo, true).length > 0 && customGizmo.visible) return;
            const interactable = [];
            function isGizmoPart(o){let c=o;while(c){if(c===customGizmo)return true;c=c.parent;}return false;}
            creatorScene.traverse(c => { if (c.isMesh && c !== snapMarker && !c.userData.isSketchPlane && !c.userData.isSketch && !isGizmoPart(c)) interactable.push(c); });
            const intersects = sketchRaycaster.intersectObjects(interactable, false);
            
            if (!e.shiftKey) {
                selectedObjects.forEach(obj => {
                    if (obj.userData && obj.userData.originalObjectColor !== undefined) {
                        obj.material.color.setHex(obj.userData.originalObjectColor);
                    }
                });
                selectedObjects = [];
            }

            if (intersects.length > 0) {
                const hit = intersects[0].object;
                const idx = selectedObjects.indexOf(hit);
                
                // Подсветка строки спецификации при клике на 3D объект
                if (hit.userData.specRow) {
                    document.querySelectorAll('.spec-table-row').forEach(r => r.classList.remove('selected-row'));
                    hit.userData.specRow.classList.add('selected-row');
                    const scrollContainer = hit.userData.specRow.closest('.table-wrapper') || hit.userData.specRow.closest('div[style*="overflow"]');
                    if (scrollContainer) hit.userData.specRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }

                if (idx > -1) {
                    if (hit.userData.originalObjectColor !== undefined) {
                        hit.material.color.setHex(hit.userData.originalObjectColor);
                    }
                    selectedObjects.splice(idx, 1);
                } else {
                    if (hit.material && hit.material.color) {
                        hit.userData.originalObjectColor = hit.material.color.getHex();
                        hit.material.color.setHex(0x3355CC); 
                    }
                    selectedObjects.push(hit);
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
                // Преобразуем нормаль полигона в мировые координаты с учетом матрицы трансформации объекта
                const normalMatrix = new THREE.Matrix3().getNormalMatrix(intersect.object.matrixWorld);
                const worldNormal = intersect.face.normal.clone().applyMatrix3(normalMatrix).normalize();
                
                let up = new THREE.Vector3(0, 1, 0);
                if (Math.abs(worldNormal.y) > 0.99) up = new THREE.Vector3(0, 0, -Math.sign(worldNormal.y));
                const right = new THREE.Vector3().crossVectors(up, worldNormal).normalize();
                up.crossVectors(worldNormal, right).normalize();
                
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
                        isSketchPlane: true, normal: n.clone(), look: point.clone().add(n.clone().multiplyScalar(500)), up: u.clone(), name: name 
                    };
                    return mesh;
                };

                const p1 = createLocalPlane(0xE03030, worldNormal, up, right, "Face_XY");
                const p2 = createLocalPlane(0x5AAFDD, up, worldNormal.clone().negate(), right, "Face_XZ");
                const p3 = createLocalPlane(0x3355CC, right, up, worldNormal.clone().negate(), "Face_YZ");

                originPlanesGroup.add(p1, p2, p3);
                creatorScene.add(originPlanesGroup);
                
                sketchState = 0;
                if (typeof showToast === 'function') showToast("ЛКМ выберите локальную плоскость для эскиза");
            }
        } else if (sketchState === 1) {
            const intersects = sketchRaycaster.intersectObject(activeSketchPlane);
            if (intersects.length > 0) {
                let pt = applySnapsAndOrtho(intersects[0].point, true);
                addSketchPoint(pt);
            }
        }
    });

    window.addEventListener('keydown', (e) => {
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
        if (mateState > 0 && e.key === 'Escape') {
            if (mateHighlightA) creatorScene.remove(mateHighlightA);
            if (mateHighlightB) creatorScene.remove(mateHighlightB);
            mateState = 0;
            setCreatorUIMode('default');
            if (window.setCreatorActiveTool) window.setCreatorActiveTool(null);
            if (typeof showToast === 'function') showToast("Слипание отменено");
        }
        if (gizmoState > 0 && e.key === 'Escape') {
            cancelAllCommands();
            if (typeof showToast === 'function') showToast("Гизмо отключен");
        }
        if (!isSketchMode) return;
        if (e.key === 'F8') {
            const cb = document.getElementById('sketch-ortho');
            if(cb) { cb.checked = !cb.checked; toggleOrtho(cb.checked); }
        }
    });
}

window.applyBend = function() {
    if (bendState !== 2 || !bendHighlight || !bendHighlight.userData.sourceObject || !bendHighlight.userData.edge) {
        if (typeof showToast === 'function') showToast("Сначала выберите кромку для гиба.");
        return;
    }
    const plateObject = bendHighlight.userData.sourceObject;
    const bendEdge = bendHighlight.userData.edge;
    performBend(plateObject, bendEdge);
    cancelAllCommands();
};

window.performBend = function(plateObject, bendEdge) {
    const length = parseFloat(document.getElementById('bend-length').value) || 100;
    const angleRad = THREE.MathUtils.degToRad(parseFloat(document.getElementById('bend-angle').value) || 90);
    const radius = parseFloat(document.getElementById('bend-radius').value) || 10;

    if (angleRad <= 0 || radius <= 0 || length <= 0) {
        if (typeof showToast === 'function') showToast("Параметры гиба должны быть больше нуля.");
        return;
    }

    const plateData = plateObject.userData.specData;
    const thickness = plateData.t * plateObject.scale.y;
    
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
    const bendNormal = bendEdge.faceNormal.clone(); // Use the face normal directly for thickness direction
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

    // Неподвижная часть
    const p1_stat_top = bendEdge.v1.clone().addScaledVector(stationaryPartNormal, flatStationaryLength);
    const p2_stat_top = bendEdge.v2.clone().addScaledVector(stationaryPartNormal, flatStationaryLength);
    const p3_stat_top = bendEdge.v2.clone(); // This is the bend line
    const p4_stat_top = bendEdge.v1.clone(); // This is the bend line

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
    
    const p1_mov_top = currentInnerPoint;
    const p2_mov_top = currentInnerPoint_otherSide;
    const p3_mov_top = p2_mov_top.clone().addScaledVector(finalDir, length);
    const p4_mov_top = p1_mov_top.clone().addScaledVector(finalDir, length);

    const p1_mov_bottom = currentOuterPoint;
    const p2_mov_bottom = currentOuterPoint_otherSide;
    const p3_mov_bottom = p2_mov_bottom.clone().addScaledVector(finalDir, length);
    const p4_mov_bottom = p1_mov_bottom.clone().addScaledVector(finalDir, length);

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
    newMesh.userData = { ...plateObject.userData, specData: { type: 'bent_plate', name: `Гиб ${plateData.t}x${W_total} L${length} R${radius}` } };
    addPartToSpec(`Гиб ${plateData.t}x${W_total} L${length} R${radius}`, newMesh);

    disposeHierarchy(plateObject);
    creatorScene.add(newMesh);
    if (typeof showToast === 'function') showToast("Гиб успешно создан!");
}

function selectPlane(planeMesh) {
    activeSketchPlane = planeMesh;
    sketchState = 1;
    sketchGroup = new THREE.Group();
    creatorScene.add(sketchGroup);

    if (!tempShapePreview) {
        const geometry = new THREE.BufferGeometry();
        // Выделяем достаточно вершин для любого примитива (окружность/дуга требуют больше всего)
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(65 * 3), 3));
        tempShapePreview = new THREE.Line(geometry, phantomMaterial);
        tempShapePreview.frustumCulled = false;
        creatorScene.add(tempShapePreview);
    }
    
    if (originPlanesGroup) originPlanesGroup.children.forEach(c => { if(c !== planeMesh) c.visible = false; });
    planeMesh.material.opacity = 0.05; // Делаем прозрачнее
    
    // Добавляем сетку для удобства черчения 
    const gridHelper = new THREE.GridHelper(1000, 100, 0x3355CC, 0xCBD5E1);
    gridHelper.rotation.x = Math.PI / 2;
    planeMesh.add(gridHelper);
    planeMesh.userData.gridHelper = gridHelper;

    // Устанавливаем видимость сетки и состояние кнопки в соответствии с глобальными переменными
    gridHelper.visible = isGridVisible;
    const gridBtn = sketchRadialMenu?.querySelector('#sketch-radial-toggle-grid');
    if (gridBtn) gridBtn.classList.toggle('toggle-active', isGridVisible);

    const orthoBtn = sketchRadialMenu?.querySelector('#sketch-radial-toggle-ortho');
    if (orthoBtn) orthoBtn.classList.toggle('toggle-active', isOrtho);

    const snapBtn = sketchRadialMenu?.querySelector('#sketch-radial-toggle-snap');
    if (snapBtn) snapBtn.classList.toggle('toggle-active', isSnapEnabled);

    const targetPos = new THREE.Vector3();
    planeMesh.getWorldPosition(targetPos);

    const lookDir = planeMesh.userData.look;
    
    currentCreatorCamera = creatorOrthoCamera;
    creatorControls.object = currentCreatorCamera;
    creatorControls.enableDamping = false; // Отключаем инерцию для 2D-режима, чтобы остановить любое движение
    creatorControls.enableRotate = false;
    // creatorControls.mouseButtons.RIGHT = null; // ВОССТАНАВЛИВАЕМ ПАНОРАМИРОВАНИЕ: эта строка отключала перенос камеры ПКМ в режиме эскиза
    creatorControls.target.copy(targetPos);

    // --- ИСПРАВЛЕНИЕ ДЛЯ СБРОСА ИНЕРЦИИ ---
    // 1. Вызываем update() один раз. Это применяет остаточную инерцию (из `sphericalDelta` в OrbitControls)
    //    и сразу же сбрасывает ее в ноль, так как enableDamping = false. Камера на мгновение станет "кривой".
    creatorControls.update();

    // 2. Сразу после этого мы ПРИНУДИТЕЛЬНО устанавливаем камеру в идеальное ортогональное положение.
    creatorOrthoCamera.position.copy(lookDir);
    creatorOrthoCamera.up.copy(planeMesh.userData.up);
    creatorOrthoCamera.lookAt(targetPos);
    creatorOrthoCamera.zoom = 2.0;
    creatorOrthoCamera.updateProjectionMatrix();

    // 3. Вызываем update() еще раз. Теперь, когда инерция сброшена, этот вызов просто синхронизирует
    //    внутреннее состояние контроллера с правильным положением камеры, не сдвигая ее.
    creatorControls.update();

    setCreatorUIMode('sketch-draw');
    setSketchTool('line');
}

function applySnapsAndOrtho(pt, applyLength = true) {
    // Привязка к существующим точкам (Snap)
    if (!isSnapEnabled) {
        if(snapMarker) snapMarker.visible = false;
        return pt;
    }

    let snapped = null;
    let minDist = 10 / creatorOrthoCamera.zoom; // Порог привязки зависит от зума
    
    sketchPoints.forEach(sp => {
        if (pt.distanceTo(sp) < minDist) { minDist = pt.distanceTo(sp); snapped = sp.clone(); }
    });
    
    sketchSegments.forEach(seg => {
        const mid = new THREE.Vector3().addVectors(seg.start, seg.end).multiplyScalar(0.5);
        if (pt.distanceTo(mid) < minDist) { minDist = pt.distanceTo(mid); snapped = mid.clone(); }
    });
    
    if (snapped) {
        snapMarker.position.copy(snapped);
        snapMarker.visible = true;
        return snapped;
    } else {
        snapMarker.visible = false;
    }

    // Привязка Орто
    if (isOrtho && currentDrawPoints.length > 0) {
        const startPt = currentDrawPoints[0];
        const dx = Math.abs(pt.x - startPt.x);
        const dy = Math.abs(pt.y - startPt.y);
        const dz = Math.abs(pt.z - startPt.z);
        const v = new THREE.Vector3().subVectors(pt, startPt);
        const up = activeSketchPlane.userData.up;
        const normal = activeSketchPlane.userData.normal;
        const right = new THREE.Vector3().crossVectors(up, normal).normalize();
        
        if (Math.abs(v.dot(up)) > Math.abs(v.dot(right))) {
            pt.copy(startPt).add(up.clone().multiplyScalar(v.dot(up))); // Тянем вдоль UP
        } else {
            pt.copy(startPt).add(right.clone().multiplyScalar(v.dot(right))); // Тянем вдоль RIGHT
        }
    }

    // Если введено точное значение длины/радиуса
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
        if (sketchState === 1 && currentDrawPoints.length > 0) {
            sketchRaycaster.setFromCamera(sketchMouse, currentCreatorCamera);
            const intersects = sketchRaycaster.intersectObject(activeSketchPlane);
            if (intersects.length > 0) {
                    let pt = applySnapsAndOrtho(intersects[0].point, true);
                    addSketchPoint(pt);
            }
        }
        document.getElementById('sketch-val').value = ''; // очистка
    }
}

function addSketchPoint(pt) {
    currentDrawPoints.push(pt.clone());
    if (!sketchPoints.some(p => p.distanceTo(pt) < 0.1)) sketchPoints.push(pt.clone());

    const mat = new THREE.LineBasicMaterial({ color: 0x2A3142, linewidth: 2, depthTest: false });

    if (sketchTool === 'line' && currentDrawPoints.length >= 2) {
        const p1 = currentDrawPoints[currentDrawPoints.length - 2];
        const p2 = currentDrawPoints[currentDrawPoints.length - 1];
        const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
        const line = new THREE.Line(geo, mat);
        line.renderOrder = 1;
        sketchGroup.add(line);
        sketchSegments.push({start: p1.clone(), end: p2.clone()});
        // Для цепочки линий оставляем последнюю точку как начальную для следующего отрезка
        currentDrawPoints = [p2];
    } else if (sketchTool === 'rectangle' && currentDrawPoints.length === 2) {
        const p1 = currentDrawPoints[0];
        const p2 = currentDrawPoints[1];
 
        const up = activeSketchPlane.userData.up;
        const normal = activeSketchPlane.userData.normal;
        const right = new THREE.Vector3().crossVectors(up, normal).normalize();
 
        const v = new THREE.Vector3().subVectors(p2, p1);
        const p3 = p1.clone().add(right.clone().multiplyScalar(v.dot(right)));
        const p4 = p1.clone().add(up.clone().multiplyScalar(v.dot(up)));
 
        const points = [p1, p3, p2, p4];
 
        for (let i = 0; i < 4; i++) {
            const start = points[i];
            const end = points[(i + 1) % 4];
            const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
            const line = new THREE.Line(geo, mat);
            line.renderOrder = 1;
            sketchGroup.add(line);
            sketchSegments.push({ start: start.clone(), end: end.clone() });
        }
        points.forEach(p => { if (!sketchPoints.some(sp => sp.distanceTo(p) < 0.1)) sketchPoints.push(p.clone()); });
        currentDrawPoints = []; // Завершаем команду
    } else if (sketchTool === 'circle' && currentDrawPoints.length === 2) {
        const radius = currentDrawPoints[0].distanceTo(currentDrawPoints[1]);
        const geo = new THREE.CircleGeometry(radius, 64);
        const edges = new THREE.EdgesGeometry(geo, showRadialEdges ? 1 : 15);
        const circleLine = new THREE.LineSegments(edges, mat);
        circleLine.position.copy(currentDrawPoints[0]);
        circleLine.renderOrder = 1;
        alignToPlane(circleLine, activeSketchPlane);
        sketchGroup.add(circleLine);
        sketchCircles.push({ center: currentDrawPoints[0].clone(), radius: radius });
        currentDrawPoints = [];
    } else if (sketchTool === 'arc' && currentDrawPoints.length === 3) {
        // Упрощенная дуга по трем точкам (Центр, Старт, Конец)
        const radius = currentDrawPoints[0].distanceTo(currentDrawPoints[1]);
        const v1 = currentDrawPoints[1].clone().sub(currentDrawPoints[0]).normalize();
        const v2 = currentDrawPoints[2].clone().sub(currentDrawPoints[0]).normalize();
        
        const up = activeSketchPlane.userData.up;
        const normal = activeSketchPlane.userData.normal;
        const right = new THREE.Vector3().crossVectors(up, normal).normalize();
        
        let a1 = Math.atan2(v1.dot(up), v1.dot(right));
        let a2 = Math.atan2(v2.dot(up), v2.dot(right));
        
        let length = a2 - a1;
        if (length < 0) length += Math.PI * 2;

        const curve = new THREE.EllipseCurve(0, 0, radius, radius, a1, a1 + length, false, 0);
        const pts = curve.getPoints(50);
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const arcLine = new THREE.Line(geo, mat);
        arcLine.position.copy(currentDrawPoints[0]);
        arcLine.renderOrder = 1;
        alignToPlane(arcLine, activeSketchPlane);
        sketchGroup.add(arcLine);
        currentDrawPoints = [];
    }

    // Если команда завершена (больше не нужно точек), скрываем фантом
    if (currentDrawPoints.length === 0 && tempShapePreview) {
        tempShapePreview.visible = false;
        tempShapePreview.geometry.setDrawRange(0, 0);
    }
}

function alignToPlane(mesh, activePlane) {
    mesh.rotation.copy(activePlane.rotation);
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
    
    const positions = tempShapePreview.geometry.attributes.position;
    let pointCount = 0;

    // Сбрасываем трансформацию объекта, т.к. точки считаются в мировых координатах
    tempShapePreview.position.set(0, 0, 0);
    tempShapePreview.quaternion.identity();

    switch (sketchTool) {
        case 'line': {
            // Буфер на 2 точки: [p1, p_current]
            positions.setXYZ(0, currentDrawPoints[0].x, currentDrawPoints[0].y, currentDrawPoints[0].z);
            positions.setXYZ(1, pt.x, pt.y, pt.z);
            pointCount = 2;
            break;
        }
        case 'rectangle': {
            const p1 = currentDrawPoints[0];
            const p_current = pt; // p_current - диагональная точка

            const upAxis = activeSketchPlane.userData.up;
            const normal = activeSketchPlane.userData.normal;
            const rightAxis = new THREE.Vector3().crossVectors(upAxis, normal).normalize();

            const v = new THREE.Vector3().subVectors(p_current, p1);
            const widthDelta = rightAxis.clone().multiplyScalar(v.dot(rightAxis));
            const heightDelta = upAxis.clone().multiplyScalar(v.dot(upAxis));

            const P1 = p1;
            const P2 = p1.clone().add(widthDelta);
            const P3 = p_current;
            const P4 = p1.clone().add(heightDelta);

            // Записываем замкнутый контур из 5 точек
            positions.setXYZ(0, P1.x, P1.y, P1.z);
            positions.setXYZ(1, P2.x, P2.y, P2.z);
            positions.setXYZ(2, P3.x, P3.y, P3.z);
            positions.setXYZ(3, P4.x, P4.y, P4.z);
            positions.setXYZ(4, P1.x, P1.y, P1.z);
            pointCount = 5;
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
                const center = currentDrawPoints[0];
                const radius = currentDrawPoints[0].distanceTo(currentDrawPoints[1]);
                const v1 = currentDrawPoints[1].clone().sub(currentDrawPoints[0]).normalize();
                const v2 = pt.clone().sub(currentDrawPoints[0]).normalize();
                
                const upArc = activeSketchPlane.userData.up;
                const rightArc = new THREE.Vector3().crossVectors(upArc, activeSketchPlane.userData.normal).normalize();
                
                let a1 = Math.atan2(v1.dot(upArc), v1.dot(rightArc));
                let a2 = Math.atan2(v2.dot(upArc), v2.dot(rightArc));
                
                let length = a2 - a1;
                if (length < 0) length += Math.PI * 2;

                const segments = 50;
                pointCount = segments + 1;
                for (let i = 0; i <= segments; i++) {
                    const theta = a1 + (length * i / segments);
                    const pointOnArc = center.clone()
                        .add(rightArc.clone().multiplyScalar(radius * Math.cos(theta)))
                        .add(upArc.clone().multiplyScalar(radius * Math.sin(theta)));
                    positions.setXYZ(i, pointOnArc.x, pointOnArc.y, pointOnArc.z);
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
    currentDrawPoints = [];
    activeSketchPlane = null;
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
        const mesh = createIconMesh(id);
        if (!mesh) return;

        scene.add(mesh);
        renderer.render(scene, camera);
        
        const img = document.getElementById('icon-' + id);
        if (img) {
            img.src = iconCanvas.toDataURL('image/png');
            img.style.width = '48px';
            img.style.height = '48px';
            img.style.objectFit = 'contain';
        }
        scene.remove(mesh);
        
        // Дублируем иконку в круговое радиальное меню, если она там предусмотрена
        const radialImg = document.getElementById('radial-icon-' + id);
        if (radialImg) {
            const dataUrl = iconCanvas.toDataURL('image/png');
            radialImg.src = dataUrl;
        }
    }
    
    // Проходим по всем известным ID кнопок и рендерим 3D иконку из их координат
    ['plate', 'cylinder', 'pipe', 'bulbbar', 'angle', 'channel', 'msk', 'face', 'line', 'circle', 'arc', 'extrude', 'mate', 'gizmo', 'knitsa', 'sketch_main', 'affine_main'].forEach(id => {
        renderAndApply(id);
    });

    renderer.dispose();
}

function cancelSketch() {
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
    setCreatorUIMode('default');
    if (window.setCreatorActiveTool) window.setCreatorActiveTool(null);
    
    if (originPlanesGroup) creatorScene.remove(originPlanesGroup);
    if (activeSketchPlane && activeSketchPlane.userData.name === 'CustomPlane') creatorScene.remove(activeSketchPlane);
    if (originPlanesGroup) {
        disposeHierarchy(originPlanesGroup);
        originPlanesGroup = null;
    }
    if (activeSketchPlane && activeSketchPlane.userData.name === 'CustomPlane') {
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
    currentDrawPoints = [];
    activeSketchPlane = null;
    closeSketchRadialMenu();
}

function performExtrusion(segments, circles, up, normal, depth) {
    const absDepth = Math.abs(depth);
    const right = new THREE.Vector3().crossVectors(up, normal).normalize();

    function project(pt) { return new THREE.Vector2(pt.dot(right), pt.dot(up)); }

    let loops = [];
    let segs = segments.map(s => ({ start: project(s.start), end: project(s.end), used: false }));
    
    for (let i = 0; i < segs.length; i++) {
        if (segs[i].used) continue;
        let loop = [segs[i].start, segs[i].end];
        segs[i].used = true;
        
        let currentEnd = segs[i].end;
        let closed = false;
        
        while (!closed) {
            let found = false;
            for (let j = 0; j < segs.length; j++) {
                if (!segs[j].used) {
                    if (segs[j].start.distanceTo(currentEnd) < 1e-4) {
                        currentEnd = segs[j].end;
                        loop.push(currentEnd);
                        segs[j].used = true;
                        found = true;
                        break;
                    } else if (segs[j].end.distanceTo(currentEnd) < 1e-4) {
                        currentEnd = segs[j].start;
                        loop.push(currentEnd);
                        segs[j].used = true;
                        found = true;
                        break;
                    }
                }
            }
            if (!found) break; 
            if (loop[0].distanceTo(currentEnd) < 1e-4) {
                closed = true;
                loop.pop(); // Убираем дублирующуюся точку замыкания
                loops.push(loop);
            }
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

    if (depth < 0) {
        geometry.translate(0, 0, -absDepth); // Сдвигаем назад, если выдавливание отрицательное
    }

    const matrix = new THREE.Matrix4();
    matrix.makeBasis(right, up, normal);
    geometry.applyMatrix4(matrix);

    const material = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, metalness: 0.5, roughness: 0.4 });
    const mesh = new THREE.Mesh(geometry, material);
    
    const edges = new THREE.EdgesGeometry(geometry, showRadialEdges ? 1 : 15);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x2A3142 }));
    mesh.add(line);

    mesh.userData.specData = { type: 'extrude', depth: absDepth };
    return mesh;
}

function extrudeSketchCommand() {
    if (!sketchGroup || (sketchSegments.length === 0 && sketchCircles.length === 0)) {
        if (typeof showToast === 'function') showToast("Эскиз пуст или нет контуров");
        return;
    }

    const depthStr = prompt("Введите толщину выдавливания (мм). Отрицательное число выдавит в обратную сторону:", "10");
    if (!depthStr) return;
    const depth = parseFloat(depthStr);
    if (isNaN(depth) || depth === 0) {
        if (typeof showToast === 'function') showToast("Некорректная толщина");
        return;
    }

    const plane = activeSketchPlane;
    const mesh = performExtrusion(sketchSegments, sketchCircles, plane.userData.up, plane.userData.normal, depth);
    
    if (!mesh) {
        if (typeof showToast === 'function') showToast("Эскиз не содержит замкнутых контуров");
        return;
    }

    creatorScene.add(mesh);

    if (sketchGroup) { creatorScene.remove(sketchGroup); sketchGroup = null; }
    if (tempShapePreview) { creatorScene.remove(tempShapePreview); tempShapePreview = null; }
    if (snapMarker) snapMarker.visible = false;
    
    if (sketchHudTooltip) {
        sketchHudTooltip.style.display = 'none';
        sketchHudTooltip.innerText = '';
    }

    addPartToSpec(`Выдавленный эскиз (${depth}мм)`, mesh);
    
    // Выход из режима эскиза
    isSketchMode = false;
    sketchState = 0;
    setCreatorUIMode('default');
    if (window.setCreatorActiveTool) window.setCreatorActiveTool(null);
    
    if (originPlanesGroup) { creatorScene.remove(originPlanesGroup); originPlanesGroup = null; }
    if (activeSketchPlane && activeSketchPlane.userData.name === 'CustomPlane') creatorScene.remove(activeSketchPlane);
    
    currentCreatorCamera = creatorCamera;
    creatorControls.object = currentCreatorCamera;
    creatorControls.enableRotate = true;
    creatorControls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    creatorControls.enableDamping = true;
    sketchTool = null;
    
    sketchPoints = [];
    sketchSegments = [];
    sketchCircles = [];
    currentDrawPoints = [];
    activeSketchPlane = null;
}

// Глобальная логика для удаления данных в выделенных строках спецификации
document.addEventListener('keydown', function(e) {
    if (e.key === 'Delete') {
        const selectedRows = document.querySelectorAll('.spec-table-row.selected-row');
        if (selectedRows.length > 0) {
            // Не удалять, если фокус находится внутри ячейки и пользователь пытается стереть текст
            if (document.activeElement && document.activeElement.tagName === 'INPUT' && !document.activeElement.closest('.selected-row')) {
                return;
            }
            selectedRows.forEach(r => {
                const inputs = r.querySelectorAll('input.spec-input');
                // Колонка "action" теперь 0, "pos" теперь 1. Позицию (1) оставляем нетронутой.
                inputs.forEach(inp => { if (inp.parentElement.cellIndex !== 1) inp.value = ''; });
                r.classList.remove('selected-row');
                if (window.autoCalculateMass) window.autoCalculateMass(r);
                if (window.validateRowFor3D) window.validateRowFor3D(r);
            });
        }
    }
});

// --- ЛОГИКА НИЖНЕЙ ПАНЕЛИ СПЕЦИФИКАЦИИ ---
let creatorBottomPanelOpen = true;
window.toggleCreatorBottomPanel = function() {
    creatorBottomPanelOpen = !creatorBottomPanelOpen;
    const panel = document.getElementById('creator-bottom-panel');
    if (creatorBottomPanelOpen) {
        panel.style.height = '250px';
        panel.style.minHeight = '250px';
        panel.style.borderTop = '1px solid var(--border-light)';
    } else {
        panel.style.height = '0px';
        panel.style.minHeight = '0px';
        panel.style.borderTop = 'none';
    }
    // Уведомляем 3D-окружение, чтобы оно плавно пересчитало пропорции
    setTimeout(() => window.dispatchEvent(new Event('resize')), 310);
};

window.initSpecTable = function() {
    const tbody = document.getElementById('spec-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    for (let i = 0; i < 5; i++) {
        addSpecTableRow(tbody);
    }
};

window.addSpecTableRow = function(tbody) {
    // Добавляем стили выделения строк программно, если их еще нет
    if (!document.getElementById('creator-spec-styles')) {
        const style = document.createElement('style');
        style.id = 'creator-spec-styles';
        style.innerHTML = `
            .spec-table-row.selected-row input {
                background-color: rgba(99, 102, 241, 0.15) !important;
                color: #1E293B;
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
    
    // Колонки (9 шт): 3D-кнопка перенесена в начало
    const cols = ['action', 'pos', 'name', 'dims', 'qty', 'material', 'mass', 'route', 'comment'];
    
    // Считаем номер позиции
    const rowCount = tbody.children.length + 1;

    // Универсальный обработчик выделения строк
    const handleMousedown = function(e) {
        if (e.ctrlKey || e.shiftKey) {
            e.preventDefault(); // Предотвращаем фокус
            const trNode = this.closest('tr');
            const tbNode = trNode.parentElement;
            const allRows = Array.from(tbNode.children);
            if (e.ctrlKey) {
                trNode.classList.toggle('selected-row');
            } else if (e.shiftKey) {
                let lastIdx = allRows.findIndex(r => r.classList.contains('selected-row'));
                if (lastIdx === -1) lastIdx = 0;
                const curIdx = allRows.indexOf(trNode);
                const min = Math.min(lastIdx, curIdx);
                const max = Math.max(lastIdx, curIdx);
                allRows.forEach(r => r.classList.remove('selected-row'));
                for(let i = min; i <= max; i++) allRows[i].classList.add('selected-row');
            }
        } else {
            const tbNode = this.closest('tbody');
            Array.from(tbNode.children).forEach(r => r.classList.remove('selected-row'));
        }
    };

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
            const btn = document.createElement('button');
            btn.className = 'btn-3d'; 
            btn.innerHTML = '⭘';
            btn.title = 'Ожидание данных...';
            btn.disabled = true;
            btn.onclick = () => { 
                if (btn.dataset.spawned === 'true') {
                    let mesh = null;
                    creatorScene.traverse(c => {
                        if (c.userData && c.userData.specRow === tr) mesh = c;
                    });
                    if (mesh) {
                        const targetPos = new THREE.Vector3();
                        mesh.getWorldPosition(targetPos);
                        creatorControls.target.copy(targetPos);
                        creatorControls.update();
                    }
                } else {
                    if (window.spawn3DFromSpec) window.spawn3DFromSpec(tr, btn); 
                }
            };
            td.style.textAlign = 'center';
            td.appendChild(btn);
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
            }
            
            input.addEventListener('keydown', handleKeydown);
            input.addEventListener('mousedown', handleMousedown);
            td.appendChild(input);
        }
        tr.appendChild(td);
    });
    
    // Слушатель для валидации 3D-кнопки
    tr.addEventListener('input', function() {
        if (window.validateRowFor3D) window.validateRowFor3D(tr);
    });

    // Инициализируем стартовый вид размеров
    updateDimInputs(nameInput, dimsTd, handleKeydown, handleMousedown);
    tbody.appendChild(tr);
    return tr;
};

function getShapeCategory(name) {
    if (!name) return 'free';
    name = name.toLowerCase();
    if (name === 'лист' || name === 'пластина') return 'plate';
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
        const nameInput = tr.querySelector('td:nth-child(2) input');
        if (nameInput && nameInput.value.trim() === '') {
            targetRow = tr;
            break;
        }
    }
    // Если свободных строк нет — создаем новую
    if (!targetRow) targetRow = window.addSpecTableRow(tbody);
    
    const nameInput = targetRow.querySelector('td:nth-child(3) input');
    const qtyInput = targetRow.querySelector('td:nth-child(5) input');
    const matInput = targetRow.querySelector('td:nth-child(6) input');
    
    if (qtyInput && !qtyInput.value) qtyInput.value = '1';
    if (matInput && !matInput.value) matInput.value = 'Ст3сп / Ст3пс (ГОСТ 380)'; 
    
    if (objData.type === 'plate') {
        nameInput.value = 'Лист';
        nameInput.dispatchEvent(new Event('input')); // Запускаем перестройку ячеек размеров
        const dims = targetRow.querySelector('td:nth-child(4)').querySelectorAll('input');
        if (dims.length === 3) { dims[0].value = objData.t; dims[1].value = objData.w; dims[2].value = objData.l; }
    } else if (objData.type === 'cylinder') {
        nameInput.value = 'Цилиндр';
        nameInput.dispatchEvent(new Event('input'));
        const dims = targetRow.querySelector('td:nth-child(4)').querySelectorAll('input');
        if (dims.length === 2) { dims[0].value = objData.d; dims[1].value = objData.l; }
    } else if (objData.type === 'pipe') {
        nameInput.value = 'Труба';
        nameInput.dispatchEvent(new Event('input'));
        const dims = targetRow.querySelector('td:nth-child(4)').querySelectorAll('input');
        if (dims.length === 3) { dims[0].value = objData.dOut; dims[1].value = objData.t; dims[2].value = objData.l; }
    } else if (objData.type === 'profile') {
        const isBulb = objData.name.includes('HP');
        const isAngle = objData.name.includes('L') || objData.name.toLowerCase().includes('уголок');
        nameInput.value = isBulb ? 'Полособульб' : (isAngle ? 'Уголок' : 'Швеллер');
        nameInput.dispatchEvent(new Event('input'));
        const dims = targetRow.querySelector('td:nth-child(4)').querySelectorAll('input');
        if (dims.length === 2) { dims[0].value = objData.name; dims[1].value = objData.l; }
    } else if (objData.type === 'knitsa') {
        nameInput.value = 'Кница';
        nameInput.dispatchEvent(new Event('input'));
        const dims = targetRow.querySelector('td:nth-child(4)').querySelectorAll('input');
        if (dims.length === 3) { dims[0].value = objData.h; dims[1].value = objData.l; dims[2].value = objData.th; }
    }
    
    // Автоскролл к новой добавленной позиции
    const scrollContainer = tbody.parentElement.parentElement;
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
};

// Мощная функция расчета массы на лету (зависит от геометрии и материала)
window.autoCalculateMass = function(tr) {
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
            if (typeof showToast === 'function') showToast("Плотность для этого материала не найдена.");
            return;
        }
    }

    const name = nameInput.value.trim().toLowerCase();
    let volume = 0; // Объем в мм³

    // 1. Пытаемся взять точный объем из уже сгенерированной 3D-модели
    const btn3D = tr.querySelector('.btn-3d');
    let mesh = null;
    if (btn3D && btn3D.dataset.spawned === 'true') {
        creatorScene.traverse(c => {
            if (c.isMesh && c.userData.specRow === tr) mesh = c;
        });
    }
    
    if (mesh && mesh.geometry) {
        const scaleVol = mesh.scale.x * mesh.scale.y * mesh.scale.z;
        volume = calculateGeometryVolume(mesh.geometry) * scaleVol;
    } 
    // 2. Если 3D-модели нет, рассчитываем объем математически или генерируем временную 3D-модель
    else {
        try {
            if (name === 'лист' || name === 'пластина') {
                if (dimsInputs.length === 3) {
                    const t = parseFloat(dimsInputs[0].value) || 0;
                    const w = parseFloat(dimsInputs[1].value) || 0;
                    const l = parseFloat(dimsInputs[2].value) || 0;
                    volume = t * w * l;
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
                    else if (name === 'уголок') points = AngleProfiles[profName];
                    else if (name === 'швеллер' && ChannelParams[profName]) points = generateChannelPoints(...ChannelParams[profName]);
                    
                    if (name === 'полособульб') {
                        const key = Object.keys(BulbProfiles).find(k => k.toLowerCase() === profName.toLowerCase());
                        points = key ? BulbProfiles[key] : null;
                    }
                    else if (name === 'уголок') {
                        const key = Object.keys(AngleProfiles).find(k => k.toLowerCase() === profName.toLowerCase());
                        points = key ? AngleProfiles[key] : null;
                        if (!points) {
                            const cleanType = profName.replace(/^(L|Уголок)\s*/i, '').trim();
                            const parts = cleanType.split(/[\sxх*]+/).filter(Boolean).map(Number);
                            if (parts.length === 3 && parts.every(n => !isNaN(n) && n > 0)) {
                                const b1 = parts[0], b2 = parts[1], t = parts[2];
                                const r = t * 0.6;
                                points = [ [0.0, t, 0.0], [0.0, 0.0, 0.0], [b1, 0.0, 0.0], [b1, t, 0.0], [t + r, t, -0.4142], [t, t + r, 0.0], [t, b2, 0.0], [0.0, b2, 0.0] ];
                            } else if (parts.length === 2 && parts.every(n => !isNaN(n) && n > 0)) {
                                const b = parts[0], t = parts[1];
                                const r = t * 0.6;
                                points = [ [0.0, t, 0.0], [0.0, 0.0, 0.0], [b, 0.0, 0.0], [b, t, 0.0], [t + r, t, -0.4142], [t, t + r, 0.0], [t, b, 0.0], [0.0, b, 0.0] ];
                            }
                        }
                    }
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
        let qty = parseFloat(qtyInput.value) || 1;
        // Конвертируем объем из мм³ в м³, затем умножаем на плотность (кг/м³) и на количество
        const volumeM3 = volume / 1000000000;
        const mass = volumeM3 * density * qty; 
        massInput.value = mass.toFixed(2);
    } else {
        if (typeof showToast === 'function') showToast("Не удалось рассчитать массу. Проверьте правильность размеров.");
    }
};

window.validateRowFor3D = function(tr) {
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
        btn.title = 'Создать 3D модель';
            btn.title = cat === 'free' ? 'Привязать к существующей 3D-модели' : 'Создать 3D модель';
    } else {
        btn.disabled = true;
        btn.className = 'btn-3d';
        btn.innerHTML = '⭘';
        btn.title = 'Ожидание данных...';
    }
};

window.spawn3DFromSpec = function(tr, btn) {
    const name = tr.querySelector('td:nth-child(3) input').value.trim();
    const cat = getShapeCategory(name);
    const dimFields = Array.from(tr.querySelector('td:nth-child(4)').querySelectorAll('input')).map(i => i.value.trim());
    
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
        } else if (cat === 'cylinder') {
            const d = parseFloat(dimFields[0]), l = parseFloat(dimFields[1]), r = d/2;
            const geo = new THREE.CylinderGeometry(r, r, l, 32);
            geo.rotateX(Math.PI / 2);
            mesh = new THREE.Mesh(geo, material);
            mesh.position.set(0, r, 0);
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
        } else if (['bulbbar', 'angle', 'channel'].includes(cat)) {
            const profName = dimFields[0], l = parseFloat(dimFields[1]);
            let points = null;
            if (cat === 'bulbbar') points = BulbProfiles[profName];
            else if (cat === 'angle') points = AngleProfiles[profName];
            else if (cat === 'channel' && ChannelParams[profName]) points = generateChannelPoints(...ChannelParams[profName]);
            
            if (points) {
                const shape = createShapeFromBulgePoly(points);
                mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: l, bevelEnabled: false }), material);
            }
        } else if (cat === 'knitsa') {
            const h = parseFloat(dimFields[0]), l = parseFloat(dimFields[1]), th = parseFloat(dimFields[2]);
            const shape = new THREE.Shape();
            shape.moveTo(0, 0); shape.lineTo(l, 0); shape.lineTo(0, h); shape.lineTo(0, 0);
            mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: th, bevelEnabled: false }), material);
        }
    } catch (e) { console.error("Spawn 3D error", e); }

    if (mesh) {
        mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, showRadialEdges ? 1 : 15), new THREE.LineBasicMaterial({ color: 0x2A3142 })));
        
        // Умное авторазмещение детали (справа от всех существующих)
        mesh.geometry.computeBoundingBox();
        let maxX = 0;
        creatorScene.traverse(c => { if (c.isMesh && c.userData.specRow && c !== mesh) { const b = new THREE.Box3().setFromObject(c); if (b.max.x > maxX) maxX = b.max.x; } });
        mesh.position.x = maxX + 100 - mesh.geometry.boundingBox.min.x; // Сдвиг на 100мм правее самой дальней точки
        
        mesh.userData.specRow = tr;
        creatorScene.add(mesh);
        
        btn.dataset.spawned = 'true';
        btn.disabled = true;
        btn.className = 'btn-3d spawned';
        btn.innerHTML = '🔗';
        btn.title = 'Связано с 3D моделью (клик - центрировать)';
        
        creatorControls.target.copy(mesh.position);
        creatorControls.update();
        if (typeof showToast === 'function') showToast("Деталь сгенерирована по размерам из таблицы");
    } else {
        if (typeof showToast === 'function') showToast("Не удалось сгенерировать 3D модель (неизвестный профиль)");
    }
};