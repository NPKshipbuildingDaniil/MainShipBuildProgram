/**
 * ============================================================================
 * ФАЙЛ: /data/command_tooltips.js
 * ============================================================================
 * МИНИ-ИНСТРУКЦИЯ ДЛЯ ОПЕРАТОРА И РАЗРАБОТЧИКОВ:
 * 
 * Данный модуль отвечает за вывод всплывающих подсказок (Tooltip) с описанием команд
 * при удержании курсора над элементами меню приложения.
 * 
 * КАК ДОБАВИТЬ ОПИСАНИЕ К КНОПКЕ ИЛИ КОМАНДЕ В HTML / SVG:
 * Добавьте к элементу (например, <g class="radial-group"> или <button>) два атрибута:
 *   1) data-tooltip-title="Заголовок команды"
 *   2) data-tooltip-desc="Подробное описание назначения и функций команды."
 * 
 * Пример:
 *   <g class="radial-group" data-tooltip-title="Отрезок" data-tooltip-desc="Построение прямых линий на плоскости 2D-эскиза.">
 * 
 * ДИЗАЙН И СТИЛЬ:
 * - Оформлено в молочно-белом стиле приложения (фон #FAF8F5, темный синий заголовок #1E3A8A).
 * - Задержка появления окна: 2 секунды (2000 мс) непрерывного удерживания курсора.
 * - Окно плавно позиционируется и не выходит за видимые края экрана.
 * ============================================================================
 */

(function () {
    let tooltipElem = null;
    let hoverTimer = null;
    let activeGroup = null;
    let mouseX = 0, mouseY = 0;

    function createTooltipElement() {
        if (document.getElementById('radial-hover-tooltip')) {
            tooltipElem = document.getElementById('radial-hover-tooltip');
            return;
        }
        tooltipElem = document.createElement('div');
        tooltipElem.id = 'radial-hover-tooltip';
        tooltipElem.style.cssText = `
            position: fixed;
            z-index: 100000;
            pointer-events: none;
            display: none;
            opacity: 0;
            background: #FAF8F5;
            color: #1E293B;
            border: 1.5px solid #BFDBFE;
            box-shadow: 0 10px 25px -5px rgba(37, 99, 235, 0.18), 0 8px 16px -6px rgba(0, 0, 0, 0.08);
            border-radius: 9px;
            padding: 10px 14px;
            font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
            font-size: 12px;
            max-width: 260px;
            backdrop-filter: blur(8px);
            transition: opacity 0.2s ease-out;
            transform: translate(15px, 15px);
        `;
        document.body.appendChild(tooltipElem);
    }

    function updatePosition(x, y) {
        if (!tooltipElem) return;
        const offset = 15;
        let left = x + offset;
        let top = y + offset;

        const rect = tooltipElem.getBoundingClientRect();
        if (left + rect.width > window.innerWidth - 12) {
            left = x - rect.width - offset;
        }
        if (top + rect.height > window.innerHeight - 12) {
            top = y - rect.height - offset;
        }
        tooltipElem.style.left = left + 'px';
        tooltipElem.style.top = top + 'px';
    }

    function showTooltip(title, desc, x, y) {
        if (!tooltipElem) createTooltipElement();
        tooltipElem.innerHTML = `
            <div style="font-weight: 700; font-size: 13px; color: #1E3A8A; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                <span style="display:inline-block; width:6px; height:6px; background:#2563EB; border-radius:50%;"></span>
                ${title}
            </div>
            <div style="font-size: 11.5px; color: #334155; line-height: 1.45;">${desc}</div>
        `;
        tooltipElem.style.display = 'block';
        updatePosition(x, y);
        requestAnimationFrame(() => {
            if (tooltipElem) tooltipElem.style.opacity = '1';
        });
    }

    function hideTooltip() {
        if (hoverTimer) {
            clearTimeout(hoverTimer);
            hoverTimer = null;
        }
        activeGroup = null;
        if (tooltipElem) {
            tooltipElem.style.opacity = '0';
            tooltipElem.style.display = 'none';
        }
    }

    window.hideRadialTooltip = hideTooltip;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createTooltipElement);
    } else {
        createTooltipElement();
    }

    document.addEventListener('mouseover', (e) => {
        const group = e.target.closest('[data-tooltip-desc]');
        if (!group) return;

        const desc = group.getAttribute('data-tooltip-desc');
        if (!desc) return;

        const title = group.getAttribute('data-tooltip-title') || 'Команда';

        if (activeGroup !== group) {
            hideTooltip();
            activeGroup = group;
            mouseX = e.clientX;
            mouseY = e.clientY;

            // 2 секунды задержки до показа окна
            hoverTimer = setTimeout(() => {
                if (activeGroup === group) {
                    showTooltip(title, desc, mouseX, mouseY);
                }
            }, 2000);
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (activeGroup) {
            mouseX = e.clientX;
            mouseY = e.clientY;
            if (tooltipElem && tooltipElem.style.display === 'block') {
                updatePosition(mouseX, mouseY);
            }
        }
    });

    document.addEventListener('mouseout', (e) => {
        if (!activeGroup) return;
        const group = e.target.closest('[data-tooltip-desc]');
        if (group === activeGroup) {
            if (e.relatedTarget && group.contains(e.relatedTarget)) {
                return;
            }
            hideTooltip();
        }
    });

    document.addEventListener('mousedown', () => {
        hideTooltip();
    });
})();
