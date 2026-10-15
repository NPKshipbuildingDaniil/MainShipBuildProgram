/**
 * ============================================================================
 * ФАЙЛ: creator3d_data.js
 * НАЗНАЧЕНИЕ: Хранение констант, баз данных профилей и свойств материалов.
 * ============================================================================
 * ИНФОРМАЦИЯ ДЛЯ НЕЙРОСЕТЕЙ И РАЗРАБОТЧИКОВ:
 * - Сюда нужно добавлять новые ГОСТы, справочники плотностей материалов 
 *   (сейчас это объект MaterialDensities).
 * - Здесь должны лежать тяжелые массивы данных с координатами точек профилей 
 *   (BULB_DATA_LISP, ANGLE_DATA_LISP, ChannelParams).
 * - Если вводится новый тип профиля (например, двутавр), его табличные 
 *   параметры и логику первичной инициализации следует писать в этот файл,
 *   чтобы не засорять главный скрипт.
 */

// --- БАЗА ДАННЫХ МАТЕРИАЛОВ И ПЛОТНОСТЕЙ (кг/м³) ---
const MaterialDensities = {
    // Судостроительные стали (Углеродистые и низколегированные)
    "Ст3сп / Ст3пс (ГОСТ 380)": 7850,
    "РС А, РС B, РС D, РС E": 7850,
    "РС D32, РС A32, РС E32": 7850,
    "РС D36, РС E36, РС F36": 7850,
    "РС D40, РС E40": 7850,
    "10ХСНД / 15ХСНД (ГОСТ 19281)": 7850,
    
    // Коррозионно-стойкие (нержавеющие) стали
    "12Х18Н10Т": 7920,
    "08Х18Н10": 7900,
    "10Х17Н13М2Т": 7950,
    "20Х13 / 40Х13": 7680,
    
    // Судостроительные алюминиевые сплавы
    "АМг5 / 1561": 2650,
    "АМг6": 2640,
    "АМг3": 2660,
    "Д16 / Д16Т": 2780,
    
    // Специальные сплавы (Титан и Медные сплавы)
    "ПТ-3В / ПТ-3ВУ": 4500,
    "ВТ1-0": 4500,
    "БрАЖ9-4": 7600,
    "Л63 / ЛС59-1": 8430
};

// --- БАЗА ДАННЫХ И КОНВЕРТЕР ПОЛОСОБУЛЬБА (BulbBar) ---
const BULB_DATA_LISP = `
    ("HP 430x14" (66.7 393.6 0.7676) (57.0 430.0 0.0) (0.0 430.0 0.0) (0.0 430.0 0.0) (0.0 0.0 0.0) (14.0 0.0 0.0) (14.0 351.9 -0.2681) (23.7 368.8 0.0))
    ("HP 430x15" (67.7 393.6 0.7676) (58.0 430.0 0.0) (0.0 430.0 0.0) (0.0 430.0 0.0) (0.0 0.0 0.0) (15.0 0.0 0.0) (15.0 351.9 -0.2681) (24.7 368.8 0.0))
    ("HP 430x17" (69.7 393.6 0.7676) (60.0 430.0 0.0) (0.0 430.0 0.0) (0.0 430.0 0.0) (0.0 0.0 0.0) (17.0 0.0 0.0) (17.0 351.9 -0.2681) (26.7 368.8 0.0))
    ("HP 430x19" (71.7 393.6 0.7676) (62.0 430.0 0.0) (0.0 430.0 0.0) (0.0 430.0 0.0) (0.0 0.0 0.0) (19.0 0.0 0.0) (19.0 351.9 -0.2681) (28.7 368.8 0.0))
    ("HP 430x20" (72.7 393.6 0.7676) (63.0 430.0 0.0) (0.0 430.0 0.0) (0.0 430.0 0.0) (0.0 0.0 0.0) (20.0 0.0 0.0) (20.0 351.9 -0.2681) (29.7 368.8 0.0))
    ("HP 400x14" (0.0 400.0 0.0) (54.0 400.0 -0.7672) (63.0 366.4 0.0) (23.0 343.3 0.2679) (14.0 327.7 0.0) (14.0 0.0 0.0) (0.0 0.0 0.0) (0.0 400.0 0.0))
    ("HP 400x15" (0.0 400.0 0.0) (55.0 400.0 -0.7672) (64.0 366.4 0.0) (24.0 343.3 0.2679) (15.0 327.7 0.0) (15.0 0.0 0.0) (0.0 0.0 0.0) (0.0 400.0 0.0))
    ("HP 400x16" (0.0 400.0 0.0) (56.0 400.0 -0.7672) (65.0 366.4 0.0) (25.0 343.3 0.2679) (16.0 327.7 0.0) (16.0 0.0 0.0) (0.0 0.0 0.0) (0.0 400.0 0.0))
    ("HP 370x13" (50.0 370.0 0.0) (0.0 370.0 0.0) (0.0 370.0 0.0) (0.0 0.0 0.0) (13.0 0.0 0.0) (13.0 303.6 -0.2680) (21.2 317.9 0.0) (58.2 339.2 0.7674))
    ("HP 370x14" (51.0 370.0 0.0) (0.0 370.0 0.0) (0.0 370.0 0.0) (0.0 0.0 0.0) (14.0 0.0 0.0) (14.0 303.6 -0.2680) (22.2 317.9 0.0) (59.2 339.2 0.7674))
    ("HP 370x15" (52.0 370.0 0.0) (0.0 370.0 0.0) (0.0 370.0 0.0) (0.0 0.0 0.0) (15.0 0.0 0.0) (15.0 303.6 -0.2680) (23.2 317.9 0.0) (60.2 339.2 0.7674))
    ("HP 340x12" (46.0 340.0 0.0) (0.0 340.0 0.0) (0.0 340.0 0.0) (0.0 0.0 0.0) (12.0 0.0 0.0) (12.0 279.3 -0.2677) (19.5 292.3 0.0) (53.5 312.0 0.7670))
    ("HP 340x13" (47.0 340.0 0.0) (0.0 340.0 0.0) (0.0 340.0 0.0) (0.0 0.0 0.0) (13.0 0.0 0.0) (13.0 279.3 -0.2677) (20.5 292.3 0.0) (54.5 312.0 0.7670))
    ("HP 340x14" (48.0 340.0 0.0) (0.0 340.0 0.0) (0.0 340.0 0.0) (0.0 0.0 0.0) (14.0 0.0 0.0) (14.0 279.3 -0.2677) (21.5 292.3 0.0) (55.5 312.0 0.7670))
    ("HP 320x12" (44.0 320.0 0.0) (0.0 320.0 0.0) (0.0 320.0 0.0) (0.0 0.0 0.0) (12.0 0.0 0.0) (12.0 263.3 -0.2682) (19.0 275.4 0.0) (51.0 293.9 0.7676))
    ("HP 320x13" (45.0 320.0 0.0) (0.0 320.0 0.0) (0.0 320.0 0.0) (0.0 0.0 0.0) (13.0 0.0 0.0) (13.0 263.3 -0.2682) (20.0 275.4 0.0) (52.0 293.9 0.7676))
    ("HP 320x14" (46.0 320.0 0.0) (0.0 320.0 0.0) (0.0 320.0 0.0) (0.0 0.0 0.0) (14.0 0.0 0.0) (14.0 263.3 -0.2682) (21.0 275.4 0.0) (53.0 293.9 0.7676))
    ("HP 300x11" (41.0 300.0 0.0) (0.0 300.0 0.0) (0.0 300.0 0.0) (0.0 0.0 0.0) (11.0 0.0 0.0) (11.0 247.2 -0.2681) (17.5 258.5 0.0) (47.5 275.7 0.7676))
    ("HP 300x12" (42.0 300.0 0.0) (0.0 300.0 0.0) (0.0 300.0 0.0) (0.0 0.0 0.0) (12.0 0.0 0.0) (12.0 247.2 -0.2681) (18.5 258.5 0.0) (48.5 275.7 0.7676))
    ("HP 300x13" (43.0 300.0 0.0) (0.0 300.0 0.0) (0.0 300.0 0.0) (0.0 0.0 0.0) (13.0 0.0 0.0) (13.0 247.2 -0.2681) (19.5 258.5 0.0) (49.5 275.7 0.7676))
    ("HP 280x11" (39.0 280.0 0.0) (0.0 280.0 0.0) (0.0 280.0 0.0) (0.0 0.0 0.0) (11.0 0.0 0.0) (11.0 231.1 -0.2681) (17.0 241.5 0.0) (45.0 257.6 0.7675))
    ("HP 280x12" (40.0 280.0 0.0) (0.0 280.0 0.0) (0.0 280.0 0.0) (0.0 0.0 0.0) (12.0 0.0 0.0) (12.0 231.1 -0.2681) (18.0 241.5 0.0) (46.0 257.6 0.7675))
    ("HP 280x13" (41.0 280.0 0.0) (0.0 280.0 0.0) (0.0 280.0 0.0) (0.0 0.0 0.0) (13.0 0.0 0.0) (13.0 231.1 -0.2681) (19.0 241.5 0.0) (47.0 257.6 0.7675))
    ("HP 260x10" (36.0 260.0 0.0) (0.0 260.0 0.0) (0.0 260.0 0.0) (0.0 0.0 0.0) (10.0 0.0 0.0) (10.0 214.9 -0.2680) (15.5 224.5 0.0) (41.5 239.5 0.7674))
    ("HP 260x11" (37.0 260.0 0.0) (0.0 260.0 0.0) (0.0 260.0 0.0) (0.0 0.0 0.0) (11.0 0.0 0.0) (11.0 214.9 -0.2680) (16.5 224.5 0.0) (42.5 239.5 0.7674))
    ("HP 260x12" (38.0 260.0 0.0) (0.0 260.0 0.0) (0.0 260.0 0.0) (0.0 0.0 0.0) (12.0 0.0 0.0) (12.0 214.9 -0.2680) (17.5 224.5 0.0) (43.5 239.5 0.7674))
    ("HP 240x10" (34.0 240.0 0.0) (0.0 240.0 0.0) (0.0 240.0 0.0) (0.0 0.0 0.0) (10.0 0.0 0.0) (10.0 198.8 -0.2680) (15.0 207.5 0.0) (39.0 221.3 0.7674))
    ("HP 240x11" (35.0 240.0 0.0) (0.0 240.0 0.0) (0.0 240.0 0.0) (0.0 0.0 0.0) (11.0 0.0 0.0) (11.0 198.8 -0.2680) (16.0 207.5 0.0) (40.0 221.3 0.7674))
    ("HP 240x12" (36.0 240.0 0.0) (0.0 240.0 0.0) (0.0 240.0 0.0) (0.0 0.0 0.0) (12.0 0.0 0.0) (12.0 198.8 -0.2680) (17.0 207.5 0.0) (41.0 221.3 0.7674))
    ("HP 220x10" (36.5 203.2 0.7673) (32.0 220.0 0.0) (0.0 220.0 0.0) (0.0 220.0 0.0) (0.0 0.0 0.0) (10.0 0.0 0.0) (10.0 182.7 -0.2679) (14.5 190.5 0.0))
    ("HP 220x11" (37.5 203.2 0.7673) (33.0 220.0 0.0) (0.0 220.0 0.0) (0.0 220.0 0.0) (0.0 0.0 0.0) (11.0 0.0 0.0) (11.0 182.7 -0.2679) (15.5 190.5 0.0))
    ("HP 220x12" (38.5 203.2 0.7673) (34.0 220.0 0.0) (0.0 220.0 0.0) (0.0 220.0 0.0) (0.0 0.0 0.0) (12.0 0.0 0.0) (12.0 182.7 -0.2679) (16.5 190.5 0.0))
    ("HP 200x9"  (29.0 200.0 0.0) (0.0 200.0 0.0) (0.0 200.0 0.0) (0.0 0.0 0.0) (9.0 0.0 0.0) (9.0 166.6 -0.2678) (13.0 173.5 0.0) (33.0 185.1 0.7671))
    ("HP 200x10" (30.0 200.0 0.0) (0.0 200.0 0.0) (0.0 200.0 0.0) (0.0 0.0 0.0) (10.0 0.0 0.0) (10.0 166.6 -0.2678) (14.0 173.5 0.0) (34.0 185.1 0.7671))
    ("HP 200x11" (31.0 200.0 0.0) (0.0 200.0 0.0) (0.0 200.0 0.0) (0.0 0.0 0.0) (11.0 0.0 0.0) (11.0 166.6 -0.2678) (15.0 173.5 0.0) (35.0 185.1 0.7671))
    ("HP 200x12" (32.0 200.0 0.0) (0.0 200.0 0.0) (0.0 200.0 0.0) (0.0 0.0 0.0) (12.0 0.0 0.0) (12.0 166.6 -0.2678) (16.0 173.5 0.0) (36.0 185.1 0.7671))
    ("HP 180x8"  (29.5 166.9 0.7670) (26.0 180.0 0.0) (0.0 180.0 0.0) (0.0 180.0 0.0) (0.0 0.0 0.0) (8.0 0.0 0.0) (8.0 150.5 -0.2677) (11.5 156.5 0.0))
    ("HP 180x9"  (30.5 166.9 0.7670) (27.0 180.0 0.0) (0.0 180.0 0.0) (0.0 180.0 0.0) (0.0 0.0 0.0) (9.0 0.0 0.0) (9.0 150.5 -0.2677) (12.5 156.5 0.0))
    ("HP 180x10" (31.5 166.9 0.7670) (28.0 180.0 0.0) (0.0 180.0 0.0) (0.0 180.0 0.0) (0.0 0.0 0.0) (10.0 0.0 0.0) (10.0 150.5 -0.2677) (13.5 156.5 0.0))
    ("HP 180x11" (32.5 166.9 0.7670) (29.0 180.0 0.0) (0.0 180.0 0.0) (0.0 180.0 0.0) (0.0 0.0 0.0) (11.0 0.0 0.0) (11.0 150.5 -0.2677) (14.5 156.5 0.0))
    ("HP 160x7"  (23.0 160.0 0.0) (0.0 160.0 0.0) (0.0 160.0 0.0) (0.0 0.0 0.0) (7.0 0.0 0.0) (7.0 134.3 -0.2676) (10.0 139.5 0.0) (26.0 148.8 0.7668))
    ("HP 160x8"  (24.0 160.0 0.0) (0.0 160.0 0.0) (0.0 160.0 0.0) (0.0 0.0 0.0) (8.0 0.0 0.0) (8.0 134.3 -0.2676) (11.0 139.5 0.0) (27.0 148.8 0.7668))
    ("HP 160x9"  (25.0 160.0 0.0) (0.0 160.0 0.0) (0.0 160.0 0.0) (0.0 0.0 0.0) (9.0 0.0 0.0) (9.0 134.3 -0.2676) (12.0 139.5 0.0) (28.0 148.8 0.7668))
    ("HP 160x10" (27.0 160.0 0.0) (0.0 160.0 0.0) (0.0 160.0 0.0) (0.0 0.0 0.0) (11.0 0.0 0.0) (11.0 134.3 -0.2676) (14.0 139.5 0.0) (30.0 148.8 0.7668))
    ("HP 140x7"  (20.5 140.0 0.0) (0.0 140.0 0.0) (0.0 140.0 0.0) (0.0 0.0 0.0) (7.0 0.0 0.0) (7.0 117.1 -0.2673) (9.7 121.9 0.0) (23.2 129.7 0.7663))
    ("HP 140x8"  (21.5 140.0 0.0) (0.0 140.0 0.0) (0.0 140.0 0.0) (0.0 0.0 0.0) (8.0 0.0 0.0) (8.0 117.1 -0.2673) (10.7 121.9 0.0) (24.2 129.7 0.7663))
    ("HP 140x9"  (23.5 140.0 0.0) (0.0 140.0 0.0) (0.0 140.0 0.0) (0.0 0.0 0.0) (10.0 0.0 0.0) (10.0 117.1 -0.2673) (12.7 121.9 0.0) (26.2 129.7 0.7663))
    ("HP 120x6"  (18.0 120.0 0.0) (0.0 120.0 0.0) (0.0 120.0 0.0) (0.0 0.0 0.0) (6.0 0.0 0.0) (6.0 99.4 -0.2680) (8.5 103.7 0.0) (20.5 110.7 0.7674))
    ("HP 120x7"  (19.0 120.0 0.0) (0.0 120.0 0.0) (0.0 120.0 0.0) (0.0 0.0 0.0) (7.0 0.0 0.0) (7.0 99.4 -0.2680) (9.5 103.7 0.0) (21.5 110.7 0.7674))
    ("HP 120x8"  (20.0 120.0 0.0) (0.0 120.0 0.0) (0.0 120.0 0.0) (0.0 0.0 0.0) (8.0 0.0 0.0) (8.0 99.4 -0.2680) (10.5 103.7 0.0) (22.5 110.7 0.7674))
    ("HP 100x7"  (20.2 91.6 0.7673) (18.0 100.0 0.0) (0.0 100.0 0.0) (0.0 100.0 0.0) (0.0 0.0 0.0) (7.0 0.0 0.0) (7.0 81.4 -0.2679) (9.2 85.3 0.0))
    ("HP 100x8"  (21.2 91.6 0.7673) (19.0 100.0 0.0) (0.0 100.0 0.0) (0.0 100.0 0.0) (0.0 0.0 0.0) (8.0 0.0 0.0) (8.0 81.4 -0.2679) (10.2 85.3 0.0))
    ("HP 80x5"   (15.0 80.0 -0.7673) (17.0 72.5 0.0) (7.0 66.8 0.2679) (5.0 63.3 0.0) (5.0 0.0 0.0) (0.0 0.0 0.0) (0.0 80.0 0.0) (0.0 80.0 0.0))
    ("HP 80x6"   (16.0 80.0 -0.7673) (18.0 72.5 0.0) (8.0 66.8 0.2679) (6.0 63.3 0.0) (6.0 0.0 0.0) (0.0 0.0 0.0) (0.0 80.0 0.0) (0.0 80.0 0.0))
    ("HP 60x4"   (13.5 60.0 -0.7673) (15.2 53.5 0.0) (5.7 48.0 0.2679) (4.0 45.0 0.0) (4.0 0.0 0.0) (0.0 0.0 0.0) (0.0 60.0 0.0) (0.0 60.0 0.0))
    ("HP 60x5"   (14.5 60.0 -0.7673) (16.2 53.5 0.0) (6.7 48.0 0.2679) (5.0 45.0 0.0) (5.0 0.0 0.0) (0.0 0.0 0.0) (0.0 60.0 0.0) (0.0 60.0 0.0))
    ("HP 60x6"   (15.5 60.0 -0.7673) (17.2 53.5 0.0) (7.7 48.0 0.2679) (6.0 45.0 0.0) (6.0 0.0 0.0) (0.0 0.0 0.0) (0.0 60.0 0.0) (0.0 60.0 0.0))
`;
const BulbProfiles = {};

function initBulbProfiles() {
    const lines = BULB_DATA_LISP.trim().split('\n');
    
    lines.forEach(line => {
        const nameMatch = line.match(/"([^"]+)"/);
        if (!nameMatch) return;
        const name = nameMatch[1];
        const points = [];
        const pointRegex = /\(([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\)/g;
        let match;
        while ((match = pointRegex.exec(line)) !== null) {
            points.push([parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3])]);
        }
        if (points.length > 0) BulbProfiles[name] = points;
    });
    
    const datalist = document.getElementById('bulbbar-datalist');
    if (datalist) {
        datalist.innerHTML = '';
        Object.keys(BulbProfiles).reverse().forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            datalist.appendChild(option);
        });
    }
}

// --- БАЗА ДАННЫХ УГОЛКОВ (Angle Profile) ---
const ANGLE_DATA_LISP = `
    ("L 20x20x3"   (0.0 3.0 0.0) (0.0 0.0 0.0) (20.0 0.0 0.0) (20.0 3.0 0.0) (5.1 3.0 0.4142) (3.0 5.1 0.0) (3.0 20.0 0.0) (0.0 20.0 0.0))
    ("L 20x20x4"   (0.0 4.0 0.0) (0.0 0.0 0.0) (20.0 0.0 0.0) (20.0 4.0 0.0) (6.4 4.0 0.4142) (4.0 6.4 0.0) (4.0 20.0 0.0) (0.0 20.0 0.0))
    ("L 25x25x3"   (0.0 3.0 0.0) (0.0 0.0 0.0) (25.0 0.0 0.0) (25.0 3.0 0.0) (5.1 3.0 0.4142) (3.0 5.1 0.0) (3.0 25.0 0.0) (0.0 25.0 0.0))
    ("L 25x25x4"   (0.0 4.0 0.0) (0.0 0.0 0.0) (25.0 0.0 0.0) (25.0 4.0 0.0) (6.4 4.0 0.4142) (4.0 6.4 0.0) (4.0 25.0 0.0) (0.0 25.0 0.0))
    ("L 30x30x3"   (0.0 3.0 0.0) (0.0 0.0 0.0) (30.0 0.0 0.0) (30.0 3.0 0.0) (5.1 3.0 0.4142) (3.0 5.1 0.0) (3.0 30.0 0.0) (0.0 30.0 0.0))
    ("L 30x30x4"   (0.0 4.0 0.0) (0.0 0.0 0.0) (30.0 0.0 0.0) (30.0 4.0 0.0) (6.4 4.0 0.4142) (4.0 6.4 0.0) (4.0 30.0 0.0) (0.0 30.0 0.0))
    ("L 35x35x3"   (0.0 3.0 0.0) (0.0 0.0 0.0) (35.0 0.0 0.0) (35.0 3.0 0.0) (5.1 3.0 0.4142) (3.0 5.1 0.0) (3.0 35.0 0.0) (0.0 35.0 0.0))
    ("L 35x35x4"   (0.0 4.0 0.0) (0.0 0.0 0.0) (35.0 0.0 0.0) (35.0 4.0 0.0) (6.4 4.0 0.4142) (4.0 6.4 0.0) (4.0 35.0 0.0) (0.0 35.0 0.0))
    ("L 35x35x5"   (0.0 5.0 0.0) (0.0 0.0 0.0) (35.0 0.0 0.0) (35.0 5.0 0.0) (7.7 5.0 0.4142) (5.0 7.7 0.0) (5.0 35.0 0.0) (0.0 35.0 0.0))
    ("L 40x40x3"   (0.0 3.0 0.0) (0.0 0.0 0.0) (40.0 0.0 0.0) (40.0 3.0 0.0) (5.1 3.0 0.4142) (3.0 5.1 0.0) (3.0 40.0 0.0) (0.0 40.0 0.0))
    ("L 40x40x4"   (0.0 4.0 0.0) (0.0 0.0 0.0) (40.0 0.0 0.0) (40.0 4.0 0.0) (6.4 4.0 0.4142) (4.0 6.4 0.0) (4.0 40.0 0.0) (0.0 40.0 0.0))
    ("L 40x40x5"   (0.0 5.0 0.0) (0.0 0.0 0.0) (40.0 0.0 0.0) (40.0 5.0 0.0) (7.7 5.0 0.4142) (5.0 7.7 0.0) (5.0 40.0 0.0) (0.0 40.0 0.0))
    ("L 45x45x4"   (0.0 4.0 0.0) (0.0 0.0 0.0) (45.0 0.0 0.0) (45.0 4.0 0.0) (6.4 4.0 0.4142) (4.0 6.4 0.0) (4.0 45.0 0.0) (0.0 45.0 0.0))
    ("L 45x45x5"   (0.0 5.0 0.0) (0.0 0.0 0.0) (45.0 0.0 0.0) (45.0 5.0 0.0) (7.7 5.0 0.4142) (5.0 7.7 0.0) (5.0 45.0 0.0) (0.0 45.0 0.0))
    ("L 50x50x4"   (0.0 4.0 0.0) (0.0 0.0 0.0) (50.0 0.0 0.0) (50.0 4.0 0.0) (6.4 4.0 0.4142) (4.0 6.4 0.0) (4.0 50.0 0.0) (0.0 50.0 0.0))
    ("L 50x50x5"   (0.0 5.0 0.0) (0.0 0.0 0.0) (50.0 0.0 0.0) (50.0 5.0 0.0) (7.7 5.0 0.4142) (5.0 7.7 0.0) (5.0 50.0 0.0) (0.0 50.0 0.0))
    ("L 50x50x6"   (0.0 6.0 0.0) (0.0 0.0 0.0) (50.0 0.0 0.0) (50.0 6.0 0.0) (9.0 6.0 0.4142) (6.0 9.0 0.0) (6.0 50.0 0.0) (0.0 50.0 0.0))
    ("L 56x56x4"   (0.0 4.0 0.0) (0.0 0.0 0.0) (56.0 0.0 0.0) (56.0 4.0 0.0) (6.4 4.0 0.4142) (4.0 6.4 0.0) (4.0 56.0 0.0) (0.0 56.0 0.0))
    ("L 56x56x5"   (0.0 5.0 0.0) (0.0 0.0 0.0) (56.0 0.0 0.0) (56.0 5.0 0.0) (7.7 5.0 0.4142) (5.0 7.7 0.0) (5.0 56.0 0.0) (0.0 56.0 0.0))
    ("L 63x63x5"   (0.0 5.0 0.0) (0.0 0.0 0.0) (63.0 0.0 0.0) (63.0 5.0 0.0) (7.7 5.0 0.4142) (5.0 7.7 0.0) (5.0 63.0 0.0) (0.0 63.0 0.0))
    ("L 63x63x6"   (0.0 6.0 0.0) (0.0 0.0 0.0) (63.0 0.0 0.0) (63.0 6.0 0.0) (9.0 6.0 0.4142) (6.0 9.0 0.0) (6.0 63.0 0.0) (0.0 63.0 0.0))
    ("L 70x70x5"   (0.0 5.0 0.0) (0.0 0.0 0.0) (70.0 0.0 0.0) (70.0 5.0 0.0) (7.7 5.0 0.4142) (5.0 7.7 0.0) (5.0 70.0 0.0) (0.0 70.0 0.0))
    ("L 70x70x6"   (0.0 6.0 0.0) (0.0 0.0 0.0) (70.0 0.0 0.0) (70.0 6.0 0.0) (9.0 6.0 0.4142) (6.0 9.0 0.0) (6.0 70.0 0.0) (0.0 70.0 0.0))
    ("L 70x70x7"   (0.0 7.0 0.0) (0.0 0.0 0.0) (70.0 0.0 0.0) (70.0 7.0 0.0) (10.3 7.0 0.4142) (7.0 10.3 0.0) (7.0 70.0 0.0) (0.0 70.0 0.0))
    ("L 75x75x5"   (0.0 5.0 0.0) (0.0 0.0 0.0) (75.0 0.0 0.0) (75.0 5.0 0.0) (7.7 5.0 0.4142) (5.0 7.7 0.0) (5.0 75.0 0.0) (0.0 75.0 0.0))
    ("L 75x75x6"   (0.0 6.0 0.0) (0.0 0.0 0.0) (75.0 0.0 0.0) (75.0 6.0 0.0) (9.0 6.0 0.4142) (6.0 9.0 0.0) (6.0 75.0 0.0) (0.0 75.0 0.0))
    ("L 75x75x7"   (0.0 7.0 0.0) (0.0 0.0 0.0) (75.0 0.0 0.0) (75.0 7.0 0.0) (10.3 7.0 0.4142) (7.0 10.3 0.0) (7.0 75.0 0.0) (0.0 75.0 0.0))
    ("L 75x75x8"   (0.0 8.0 0.0) (0.0 0.0 0.0) (75.0 0.0 0.0) (75.0 8.0 0.0) (11.6 8.0 0.4142) (8.0 11.6 0.0) (8.0 75.0 0.0) (0.0 75.0 0.0))
    ("L 80x80x6"   (0.0 6.0 0.0) (0.0 0.0 0.0) (80.0 0.0 0.0) (80.0 6.0 0.0) (9.0 6.0 0.4142) (6.0 9.0 0.0) (6.0 80.0 0.0) (0.0 80.0 0.0))
    ("L 80x80x7"   (0.0 7.0 0.0) (0.0 0.0 0.0) (80.0 0.0 0.0) (80.0 7.0 0.0) (10.3 7.0 0.4142) (7.0 10.3 0.0) (7.0 80.0 0.0) (0.0 80.0 0.0))
    ("L 80x80x8"   (0.0 8.0 0.0) (0.0 0.0 0.0) (80.0 0.0 0.0) (80.0 8.0 0.0) (11.6 8.0 0.4142) (8.0 11.6 0.0) (8.0 80.0 0.0) (0.0 80.0 0.0))
    ("L 90x90x6"   (0.0 6.0 0.0) (0.0 0.0 0.0) (90.0 0.0 0.0) (90.0 6.0 0.0) (9.0 6.0 0.4142) (6.0 9.0 0.0) (6.0 90.0 0.0) (0.0 90.0 0.0))
    ("L 90x90x7"   (0.0 7.0 0.0) (0.0 0.0 0.0) (90.0 0.0 0.0) (90.0 7.0 0.0) (10.3 7.0 0.4142) (7.0 10.3 0.0) (7.0 90.0 0.0) (0.0 90.0 0.0))
    ("L 90x90x8"   (0.0 8.0 0.0) (0.0 0.0 0.0) (90.0 0.0 0.0) (90.0 8.0 0.0) (11.6 8.0 0.4142) (8.0 11.6 0.0) (8.0 90.0 0.0) (0.0 90.0 0.0))
    ("L 90x90x9"   (0.0 9.0 0.0) (0.0 0.0 0.0) (90.0 0.0 0.0) (90.0 9.0 0.0) (12.9 9.0 0.4142) (9.0 12.9 0.0) (9.0 90.0 0.0) (0.0 90.0 0.0))
    ("L 100x100x7" (0.0 7.0 0.0) (0.0 0.0 0.0) (100.0 0.0 0.0) (100.0 7.0 0.0) (10.3 7.0 0.4142) (7.0 10.3 0.0) (7.0 100.0 0.0) (0.0 100.0 0.0))
    ("L 100x100x8" (0.0 8.0 0.0) (0.0 0.0 0.0) (100.0 0.0 0.0) (100.0 8.0 0.0) (11.6 8.0 0.4142) (8.0 11.6 0.0) (8.0 100.0 0.0) (0.0 100.0 0.0))
    ("L 100x100x10" (0.0 10.0 0.0) (0.0 0.0 0.0) (100.0 0.0 0.0) (100.0 10.0 0.0) (14.2 10.0 0.4142) (10.0 14.2 0.0) (10.0 100.0 0.0) (0.0 100.0 0.0))
    ("L 100x100x12" (0.0 12.0 0.0) (0.0 0.0 0.0) (100.0 0.0 0.0) (100.0 12.0 0.0) (16.8 12.0 0.4142) (12.0 16.8 0.0) (12.0 100.0 0.0) (0.0 100.0 0.0))
    ("L 110x110x8" (0.0 8.0 0.0) (0.0 0.0 0.0) (110.0 0.0 0.0) (110.0 8.0 0.0) (11.6 8.0 0.4142) (8.0 11.6 0.0) (8.0 110.0 0.0) (0.0 110.0 0.0))
    ("L 125x125x8" (0.0 8.0 0.0) (0.0 0.0 0.0) (125.0 0.0 0.0) (125.0 8.0 0.0) (11.6 8.0 0.4142) (8.0 11.6 0.0) (8.0 125.0 0.0) (0.0 125.0 0.0))
    ("L 125x125x9" (0.0 9.0 0.0) (0.0 0.0 0.0) (125.0 0.0 0.0) (125.0 9.0 0.0) (12.9 9.0 0.4142) (9.0 12.9 0.0) (9.0 125.0 0.0) (0.0 125.0 0.0))
    ("L 125x125x10" (0.0 10.0 0.0) (0.0 0.0 0.0) (125.0 0.0 0.0) (125.0 10.0 0.0) (14.2 10.0 0.4142) (10.0 14.2 0.0) (10.0 125.0 0.0) (0.0 125.0 0.0))
    ("L 125x125x12" (0.0 12.0 0.0) (0.0 0.0 0.0) (125.0 0.0 0.0) (125.0 12.0 0.0) (16.8 12.0 0.4142) (12.0 16.8 0.0) (12.0 125.0 0.0) (0.0 125.0 0.0))
    ("L 140x140x9" (0.0 9.0 0.0) (0.0 0.0 0.0) (140.0 0.0 0.0) (140.0 9.0 0.0) (12.9 9.0 0.4142) (9.0 12.9 0.0) (9.0 140.0 0.0) (0.0 140.0 0.0))
    ("L 140x140x10" (0.0 10.0 0.0) (0.0 0.0 0.0) (140.0 0.0 0.0) (140.0 10.0 0.0) (14.2 10.0 0.4142) (10.0 14.2 0.0) (10.0 140.0 0.0) (0.0 140.0 0.0))
    ("L 140x140x12" (0.0 12.0 0.0) (0.0 0.0 0.0) (140.0 0.0 0.0) (140.0 12.0 0.0) (16.8 12.0 0.4142) (12.0 16.8 0.0) (12.0 140.0 0.0) (0.0 140.0 0.0))
    ("L 160x160x10" (0.0 10.0 0.0) (0.0 0.0 0.0) (160.0 0.0 0.0) (160.0 10.0 0.0) (14.2 10.0 0.4142) (10.0 14.2 0.0) (10.0 160.0 0.0) (0.0 160.0 0.0))
    ("L 160x160x12" (0.0 12.0 0.0) (0.0 0.0 0.0) (160.0 0.0 0.0) (160.0 12.0 0.0) (16.8 12.0 0.4142) (12.0 16.8 0.0) (12.0 160.0 0.0) (0.0 160.0 0.0))
    ("L 160x160x14" (0.0 14.0 0.0) (0.0 0.0 0.0) (160.0 0.0 0.0) (160.0 14.0 0.0) (19.4 14.0 0.4142) (14.0 19.4 0.0) (14.0 160.0 0.0) (0.0 160.0 0.0))
    ("L 180x180x12" (0.0 12.0 0.0) (0.0 0.0 0.0) (180.0 0.0 0.0) (180.0 12.0 0.0) (16.8 12.0 0.4142) (12.0 16.8 0.0) (12.0 180.0 0.0) (0.0 180.0 0.0))
    ("L 200x200x12" (0.0 12.0 0.0) (0.0 0.0 0.0) (200.0 0.0 0.0) (200.0 12.0 0.0) (16.8 12.0 0.4142) (12.0 16.8 0.0) (12.0 200.0 0.0) (0.0 200.0 0.0))
    ("L 200x200x14" (0.0 14.0 0.0) (0.0 0.0 0.0) (200.0 0.0 0.0) (200.0 14.0 0.0) (19.4 14.0 0.4142) (14.0 19.4 0.0) (14.0 200.0 0.0) (0.0 200.0 0.0))
    ("L 200x200x16" (0.0 16.0 0.0) (0.0 0.0 0.0) (200.0 0.0 0.0) (200.0 16.0 0.0) (22.0 16.0 0.4142) (16.0 22.0 0.0) (16.0 200.0 0.0) (0.0 200.0 0.0))
    ("L 200x200x20" (0.0 20.0 0.0) (0.0 0.0 0.0) (200.0 0.0 0.0) (200.0 20.0 0.0) (27.2 20.0 0.4142) (20.0 27.2 0.0) (20.0 200.0 0.0) (0.0 200.0 0.0))
    ("L 200x200x25 (R6/R18)" (0.0 19.0 0.0) (6.0 19.0 0.4142) (6.0 25.0 0.0) (157.0 25.0 0.0) (175.0 43.0 0.4142) (175.0 194.0 0.0) (181.0 200.0 0.4142) (200.0 200.0 0.0) (200.0 0.0 0.0) (0.0 0.0 0.0))
`;
const AngleProfiles = {};

function initAngleProfiles() {
    const lines = ANGLE_DATA_LISP.trim().split('\n');
    
    lines.forEach(line => {
        const nameMatch = line.match(/"([^"]+)"/);
        if (!nameMatch) return;
        const name = nameMatch[1];
        const points = [];
        const pointRegex = /\(([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\)/g;
        let match;
        while ((match = pointRegex.exec(line)) !== null) {
            points.push([parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3])]);
        }
        if (points.length > 0) AngleProfiles[name] = points;
    });
    
    const datalist = document.getElementById('angle-datalist');
    if (datalist) {
        datalist.innerHTML = '';
        Object.keys(AngleProfiles).reverse().forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            datalist.appendChild(option);
        });
    }
}

function getAngleProfilePoints(type) {
    if (!type) return null;
    if (typeof initAngleProfiles === 'function' && (!AngleProfiles || Object.keys(AngleProfiles).length === 0)) {
        initAngleProfiles();
    }
    const dict = (window.AngleProfiles && Object.keys(window.AngleProfiles).length > 0) ? window.AngleProfiles : AngleProfiles;
    
    const raw = String(type).trim();
    
    // Пытаемся распарсить размеры из имени (например, "L 50x50x5")
    const nums = raw.replace(/х/gi, 'x').match(/\d+(\.\d+)?/g);
    if (nums && nums.length > 0) {
        const parsed = nums.map(Number);
        
        let b1, b2, t;
        if (parsed.length === 1) {
            b1 = parsed[0]; b2 = parsed[0]; t = Math.max(3, Math.round(b1 / 10));
        } else if (parsed.length === 2) {
            b1 = parsed[0]; b2 = parsed[0]; t = parsed[1];
        } else {
            b1 = parsed[0]; b2 = parsed[1]; t = parsed[2];
        }
        
        const r = Math.max(1.5, t * 0.54);
        const rEnd = Math.max(1.0, r * 0.33);
        return [
            [0.0, 0.0, 0.0],
            [b1, 0.0, 0.0],
            [b1, t - rEnd, 0.4142],
            [b1 - rEnd, t, 0.0],
            [t + r, t, -0.4142],
            [t, t + r, 0.0],
            [t, b2 - rEnd, 0.4142],
            [t - rEnd, b2, 0.0],
            [0.0, b2, 0.0]
        ];
    }
    
    // Если не удалось распарсить, используем данные из LISP
    if (dict && dict[raw]) return dict[raw];
    
    if (dict && Object.keys(dict).length > 0) {
        return dict[Object.keys(dict)[0]];
    }
    return null;
}

function isProfileObject(obj) {
    if (!obj || !obj.userData) return false;
    const spec = obj.userData.specData;
    if (spec) {
        if (spec.type === 'profile' || spec.type === 'pipe' || spec.profileType) return true;
        const name = (spec.name || '').toLowerCase();
        if (name.includes('профиль') || name.includes('уголок') || name.includes('полособульб') || name.includes('швеллер') || name.includes('труба') || name.startsWith('l ') || name.startsWith('hp ')) return true;
    }
    if (obj.name) {
        const name = obj.name.toLowerCase();
        if (name.includes('профиль') || name.includes('уголок') || name.includes('полособульб') || name.includes('швеллер') || name.includes('труба') || name.startsWith('l ') || name.startsWith('hp ')) return true;
    }
    return false;
}

// --- БАЗА ДАННЫХ ШВЕЛЛЕРОВ (Channel Profile) ---
const ChannelParams = {
    "Швеллер 5П": [50.0, 32.0, 4.4, 7.0, 6.0, 3.5],
    "Швеллер 6.5П": [65.0, 36.0, 4.4, 7.2, 6.0, 3.5],
    "Швеллер 8П": [80.0, 40.0, 4.5, 7.4, 6.5, 3.5],
    "Швеллер 10П": [100.0, 46.0, 4.5, 7.6, 7.0, 4.0],
    "Швеллер 12П": [120.0, 52.0, 4.8, 7.8, 7.5, 4.5],
    "Швеллер 14П": [140.0, 58.0, 4.9, 8.1, 8.0, 4.5],
    "Швеллер 16П": [160.0, 64.0, 5.0, 8.4, 8.5, 5.0],
    "Швеллер 16aП": [160.0, 68.0, 5.0, 8.4, 8.5, 5.0],
    "Швеллер 18П": [180.0, 70.0, 5.1, 8.7, 9.0, 5.0],
    "Швеллер 18aП": [180.0, 74.0, 5.1, 8.7, 9.0, 5.0],
    "Швеллер 20П": [200.0, 76.0, 5.2, 9.0, 9.5, 5.5],
    "Швеллер 22П": [220.0, 82.0, 5.4, 9.5, 10.0, 6.0],
    "Швеллер 24П": [240.0, 89.0, 5.6, 9.7, 10.5, 6.0],
    "Швеллер 27П": [270.0, 95.0, 6.0, 10.5, 11.0, 6.5],
    "Швеллер 30П": [300.0, 100.0, 6.5, 11.0, 12.0, 7.0],
    "Швеллер 33П": [330.0, 105.0, 7.0, 11.7, 13.0, 7.5],
    "Швеллер 36П": [360.0, 110.0, 7.5, 12.3, 14.0, 8.0],
    "Швеллер 40П": [400.0, 115.0, 8.0, 13.5, 15.0, 8.0]
};

function generateChannelPoints(h, b, s, t_, R, r) {
    return [
        [0.0, 0.0, 0.0],
        [b, 0.0, 0.0],
        [b, h, 0.0],
        [0.0, h, 0.0],
        [0.0, h - (t_ - r), 0.4142],
        [r, h - t_, 0.0],
        [b - s - R, h - t_, -0.4142],
        [b - s, h - t_ - R, 0.0],
        [b - s, t_ + R, -0.4142],
        [b - s - R, t_, 0.0],
        [r, t_, 0.4142],
        [0.0, t_ - r, 0.0]
    ];
}

function initChannelProfiles() {
    const datalist = document.getElementById('channel-datalist');
    if (datalist) {
        datalist.innerHTML = '';
        Object.keys(ChannelParams).forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            datalist.appendChild(option);
        });
    }
}

window.detectProfileCategory = function(val) {
    if (!val) return '';
    const s = String(val).trim().toLowerCase();
    if (s.includes('полособ') || s.includes('бульб') || s.startsWith('hp')) return 'bulbbar';
    if (s.includes('угол') || s === 'l' || s.startsWith('l ') || s.startsWith('l-') || s.includes('angle')) return 'angle';
    if (s.includes('швелл') || s.includes('швелер') || s.includes('channel') || /^\d+[пуayx]$/i.test(s)) return 'channel';
    if (s.includes('труб') || s.startsWith('d') || s.includes('pipe') || s.includes('диам')) return 'pipe';
    return '';
};

function initAllProfileDatalist(category = '') {
    const datalist = document.getElementById('profile-all-datalist');
    if (!datalist) return;
    datalist.innerHTML = '';

    const addOpt = (val, label) => {
        const opt = document.createElement('option');
        opt.value = val;
        if (label) opt.textContent = label;
        datalist.appendChild(opt);
    };

    const cat = window.detectProfileCategory(category);

    if (!cat || cat === 'bulbbar') {
        if (typeof initBulbProfiles === 'function' && (!BulbProfiles || Object.keys(BulbProfiles).length === 0)) initBulbProfiles();
        const dict = (window.BulbProfiles && Object.keys(window.BulbProfiles).length > 0) ? window.BulbProfiles : BulbProfiles;
        if (dict) Object.keys(dict).forEach(name => addOpt(name, `Полособульб ${name}`));
    }
    if (!cat || cat === 'angle') {
        if (typeof initAngleProfiles === 'function' && (!AngleProfiles || Object.keys(AngleProfiles).length === 0)) initAngleProfiles();
        const dict = (window.AngleProfiles && Object.keys(window.AngleProfiles).length > 0) ? window.AngleProfiles : AngleProfiles;
        if (dict) Object.keys(dict).forEach(name => addOpt(name, `Уголок ${name}`));
    }
    if (!cat || cat === 'channel') {
        if (typeof initChannelProfiles === 'function' && (!ChannelParams || Object.keys(ChannelParams).length === 0)) initChannelProfiles();
        const dict = (window.ChannelParams && Object.keys(window.ChannelParams).length > 0) ? window.ChannelParams : ChannelParams;
        if (dict) Object.keys(dict).forEach(name => addOpt(name, `Швеллер ${name}`));
    }
    // Для категории "Труба" список геометрии не навязывается — пользователь вводит свободный размер (DxT) или выбирает отверстие
}

window.onProfileCategoryInput = function(rawVal, forceReset = false) {
    const cat = window.detectProfileCategory(rawVal);
    if (typeof initAllProfileDatalist === 'function') {
        initAllProfileDatalist(cat);
    }
    const typeInput = document.getElementById('qi-profile-type');
    const profilePanel = document.getElementById('quick-input-profile');
    const typeLabel = profilePanel ? profilePanel.querySelector('.quick-input-row:nth-child(2) label') : null;

    if (typeInput) {
        let defaultVal = "HP 200x12, L 50x50x5, 10П...";
        let placeholderVal = defaultVal;
        if (cat === 'bulbbar') {
            defaultVal = "HP 200x12";
            placeholderVal = "HP 200x12...";
            if (typeLabel) typeLabel.textContent = "Номер";
        } else if (cat === 'angle') {
            defaultVal = "L 50x50x5";
            placeholderVal = "L 50x50x5...";
            if (typeLabel) typeLabel.textContent = "Номер";
        } else if (cat === 'channel') {
            defaultVal = "Швеллер 10П";
            placeholderVal = "Швеллер 10П...";
            if (typeLabel) typeLabel.textContent = "Номер";
        } else if (cat === 'pipe') {
            defaultVal = "";
            placeholderVal = "D x t (напр. 108x4, 108 -5) или клик по отверстию";
            if (typeLabel) typeLabel.textContent = "Размер (D x t)";
        } else {
            if (typeLabel) typeLabel.textContent = "Номер";
        }

        typeInput.placeholder = placeholderVal;

        if (forceReset) {
            typeInput.value = (cat && cat !== 'pipe') ? defaultVal : '';
        }

        const panel = document.getElementById('quick-input-profile');
        if (panel && panel.classList.contains('show-preview')) {
            if (typeof updatePreview === 'function') updatePreview('profile');
        }

        if (cat === 'pipe' && typeof window.update3DPipePhantom === 'function') {
            window.update3DPipePhantom();
        }
    }
};
window.onProfileCategoryChange = window.onProfileCategoryInput;

// Экспорт глобальных данных и инициализация профилей
window.BulbProfiles = BulbProfiles;
window.AngleProfiles = AngleProfiles;
window.ChannelParams = ChannelParams;
window.getAngleProfilePoints = getAngleProfilePoints;
window.isProfileObject = isProfileObject;
window.initBulbProfiles = initBulbProfiles;
window.initAngleProfiles = initAngleProfiles;
window.initChannelProfiles = initChannelProfiles;
window.initAllProfileDatalist = initAllProfileDatalist;
window.generateChannelPoints = generateChannelPoints;

try {
    initBulbProfiles();
    initAngleProfiles();
    initChannelProfiles();
    initAllProfileDatalist();
} catch (e) {
    console.warn('Profile init deferred until DOM ready:', e);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initBulbProfiles();
        initAngleProfiles();
        initChannelProfiles();
        initAllProfileDatalist();
    });
}

/**
 * ============================================================================
 * ФУНКЦИЯ: createShapeFromBulgePoly
 * НАЗНАЧЕНИЕ: Создает THREE.Shape из полилинии с дугами (bulge polyline).
 * ============================================================================
 * ИНФОРМАЦИЯ ДЛЯ НЕЙРОСЕТЕЙ И РАЗРАБОТЧИКОВ:
 * - Эта функция необходима для построения профилей (полосбульб, уголок и т.д.),
 *   данные для которых хранятся в формате полилиний с выпуклостью (bulge).
 * - Формат точки: [x, y, bulge]. Bulge - это tan(theta/4), где theta - угол дуги.
 */
function createShapeFromBulgePoly(points) {
    const shape = new THREE.Shape();
    if (!points || points.length === 0) {
        return shape;
    }

    shape.moveTo(points[0][0], points[0][1]);

    for (let i = 0; i < points.length; i++) {
        const p1_arr = points[i];
        const p2_arr = points[(i + 1) % points.length];
        
        const p1 = new THREE.Vector2(p1_arr[0], p1_arr[1]);
        const p2 = new THREE.Vector2(p2_arr[0], p2_arr[1]);
        const bulge = p1_arr[2] || 0;

        if (p1.distanceTo(p2) < 0.0001) {
            continue;
        }

        if (bulge === 0) {
            shape.lineTo(p2.x, p2.y);
        } else {
            const angle = 4 * Math.atan(bulge);
            const distance = p1.distanceTo(p2);
            const radius = Math.abs(0.5 * distance / Math.sin(angle / 2));
            
            const midPoint = new THREE.Vector2().addVectors(p1, p2).multiplyScalar(0.5);
            const chordVec = new THREE.Vector2().subVectors(p2, p1);
            const h = Math.sqrt(Math.max(0, radius * radius - (distance/2) * (distance/2)));
            const perpVec = new THREE.Vector2(-chordVec.y, chordVec.x).normalize();
            const center = midPoint.clone().add(perpVec.multiplyScalar(h * Math.sign(bulge)));
            const startAngle = new THREE.Vector2().subVectors(p1, center).angle();
            const endAngle = new THREE.Vector2().subVectors(p2, center).angle();
            const clockwise = bulge < 0;

            shape.absarc(center.x, center.y, radius, startAngle, endAngle, clockwise);
        }
    }
    return shape;
}
window.createShapeFromBulgePoly = createShapeFromBulgePoly;

// --- ИНФРАСТРУКТУРА ГЕНЕРАЦИИ И ПОИСКА ID СПЕЦИФИКАЦИИ ---

// 1. Генерация уникального ID для позиции спецификации
function generateSpecRowId() {
    return 'row_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
}

// 2. Получение DOM-элемента строки по Mesh
function getSpecRowByMesh(mesh) {
    if (!mesh) return null;
    let curr = mesh;
    let safety = 0;
    const visited = new Set();
    while (curr && safety++ < 200) {
        if (visited.has(curr)) break;
        visited.add(curr);
        if (curr.userData) {
            const rowId = curr.userData.specRowId || (curr.userData.specRow && curr.userData.specRow.dataset ? curr.userData.specRow.dataset.rowId : null);
            if (rowId) {
                const tr = document.querySelector(`tr[data-row-id="${rowId}"]`);
                if (tr) return tr;
            }
        }
        curr = curr.parent;
    }
    return null;
}

// 3. Получение всех Mesh/Group на сцене, привязанных к конкретному rowId
function getMeshesByRowId(scene, rowId) {
    const meshes = [];
    if (!scene) scene = (typeof creatorScene !== 'undefined' ? creatorScene : null);
    if (!scene || !rowId) return meshes;
    
    const stack = [scene];
    const visited = new Set();
    let safety = 0;
    while (stack.length > 0 && safety++ < 5000) {
        const obj = stack.pop();
        if (!obj || visited.has(obj)) continue;
        visited.add(obj);

        if (obj.userData) {
            const rId = obj.userData.specRowId || (obj.userData.specRow && obj.userData.specRow.dataset ? obj.userData.specRow.dataset.rowId : null);
            if (rId === rowId) {
                meshes.push(obj);
            }
        }

        if (obj.children && Array.isArray(obj.children)) {
            for (let i = 0; i < obj.children.length; i++) {
                const child = obj.children[i];
                if (child && !visited.has(child)) {
                    stack.push(child);
                }
            }
        }
    }
    return meshes;
}

// 4. Обновление статуса 3D для строки таблицы
let isUpdatingRow3DStatus = false;
function updateRow3DStatus(tr) {
    if (!tr || isUpdatingRow3DStatus) return;
    isUpdatingRow3DStatus = true;
    try {
        const rowId = tr.dataset.rowId;
        const btn = tr.querySelector('.btn-3d');
        if (!btn) return;

        // Считаем количество связанных 3D-моделей в сцене
        const boundMeshes = window.getMeshesByRowId(typeof creatorScene !== 'undefined' ? creatorScene : null, rowId);

        if (boundMeshes.length > 0) {
            // Статус: Модель(и) существуют на сцене
            btn.dataset.spawned = 'true';
            btn.className = 'btn-3d spawned';
            btn.innerHTML = '⭘';
            btn.title = `Связано с 3D (${boundMeshes.length} шт.)`;
            btn.disabled = false;
        } else {
            // Статус: Модель не создана на сцене
            btn.dataset.spawned = 'false';
            btn.className = 'btn-3d ready';
            btn.innerHTML = '➕';
            btn.title = 'Создать 3D модель';
            btn.disabled = false;
            if (typeof window.validateRowFor3D === 'function') {
                window.validateRowFor3D(tr);
            }
        }
    } finally {
        isUpdatingRow3DStatus = false;
    }
}

// 5. Гарантированное авто-разделение строк при гибе/вырезе
let isHandlingMeshModification = false;
function handleMeshModification(modifiedMesh) {
    if (!modifiedMesh || isHandlingMeshModification) return;
    isHandlingMeshModification = true;
    try {
        const oldTr = window.getSpecRowByMesh(modifiedMesh);
        const scene = typeof creatorScene !== 'undefined' ? creatorScene : null;
        const oldRowId = modifiedMesh.userData ? modifiedMesh.userData.specRowId : null;
        
        const remainingMeshes = (oldRowId && scene) 
            ? window.getMeshesByRowId(scene, oldRowId).filter(m => m !== modifiedMesh)
            : [];

        const newMeshInfo = window.extractMeshSpecInfo ? window.extractMeshSpecInfo(modifiedMesh) : {};
        const nameStr = (newMeshInfo.typeName || newMeshInfo.name || 'Лист') + (newMeshInfo.hasBends || (modifiedMesh.userData && modifiedMesh.userData.hasBends) ? ' (с гибом)' : '');

        if (remainingMeshes.length > 0) {
            // 1. Создаем новую позицию под изменившуюся деталь
            const tbody = document.getElementById('spec-table-body');
            const newTr = window.addSpecTableRow(tbody, {
                name: nameStr,
                size: newMeshInfo.size || '',
                qty: 1,
                mass: newMeshInfo.mass || '0.00'
            });

            // 2. Перепривязываем модифицированный Mesh к новой строке
            window.linkMeshToSpecRow(modifiedMesh, newTr);

            // 3. Обновляем статус и количество ДЛЯ ОБЕИХ СТРОК
            if (oldTr) {
                window.updateRow3DStatus(oldTr);
            }
            window.updateRow3DStatus(newTr);
        } else if (oldTr) {
            // Обновляем наименование/размер в старой строке
            const nameInput = oldTr.querySelector('td:nth-child(3) input');
            const sizeInput = oldTr.querySelector('td:nth-child(4) input');
            if (nameInput && nameStr) {
                nameInput.value = nameStr;
            }
            if (sizeInput && newMeshInfo.size) {
                sizeInput.value = newMeshInfo.size;
            }
            window.updateRow3DStatus(oldTr);
        } else {
            // Нет старой строки, создаем новую
            const tbody = document.getElementById('spec-table-body');
            const newTr = window.addSpecTableRow(tbody, {
                name: nameStr,
                size: newMeshInfo.size || '',
                qty: 1,
                mass: newMeshInfo.mass || '0.00'
            });
            window.linkMeshToSpecRow(modifiedMesh, newTr);
            window.updateRow3DStatus(newTr);
        }

        // 4. Синхронизируем количества в инпутах
        window.syncSpecTableQuantities();
    } finally {
        isHandlingMeshModification = false;
    }
}

// 6. Синхронизация количества по спецификации
let isSyncingSpecQuantities = false;
function syncSpecTableQuantities() {
    if (isSyncingSpecQuantities) return;
    isSyncingSpecQuantities = true;
    try {
        const rows = document.querySelectorAll('#spec-table-body tr');

        rows.forEach(tr => {
            const rowId = tr.dataset.rowId;
            const qtyInput = tr.querySelector('.spec-qty') || tr.querySelector('td:nth-child(5) input');
            const btn = tr.querySelector('.btn-3d');

            if (!rowId || !qtyInput) return;

            const scene = typeof creatorScene !== 'undefined' ? creatorScene : null;

            // Ищем реальные меши в сцене
            const actualMeshesCount = window.getMeshesByRowId(scene, rowId).length;

            // Если у позиции есть модели на сцене
            if (actualMeshesCount > 0) {
                // Принудительно выставляем реальное количество мешей
                qtyInput.value = actualMeshesCount.toString();
                qtyInput.readOnly = true; // Запрещаем ручное редактирование, пока модель на сцене
                qtyInput.title = "Количество управляется из 3D сцены";
            } else {
                // Если модели на сцене нет, пользователь может менять кол-во вручную
                qtyInput.readOnly = false;
                qtyInput.title = "";
            }

            if (typeof window.autoCalculateMass === 'function') {
                window.autoCalculateMass(tr);
            }

            // Заодно обновляем визуальный статус кнопки
            if (typeof window.updateRow3DStatus === 'function') {
                window.updateRow3DStatus(tr);
            }
        });
    } finally {
        isSyncingSpecQuantities = false;
    }
}

// 8. Обработка удаления объекта со сцены
function removeMeshFromScene(mesh) {
    if (!mesh) return;
    const tr = window.getSpecRowByMesh(mesh);
    
    // Удаляем из сцены Three.js
    const scene = typeof creatorScene !== 'undefined' ? creatorScene : null;
    if (scene) {
        scene.remove(mesh);
    }
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
        if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
        else mesh.material.dispose();
    }

    // Синхронизируем таблицу
    if (tr) {
        if (typeof window.updateRow3DStatus === 'function') {
            window.updateRow3DStatus(tr);
        }
        if (typeof window.syncSpecTableQuantities === 'function') {
            window.syncSpecTableQuantities();
        }
    }
}

// 7. Функция жесткой привязки Mesh к строке
let isLinkingMeshToSpecRow = false;
function linkMeshToSpecRow(mesh, tr) {
    if (!mesh || !tr) return;
    
    // Гарантируем наличие ID у строки
    if (!tr.dataset.rowId) {
        tr.dataset.rowId = window.generateSpecRowId();
    }
    
    // Записываем UUID вместо прямой ссылки на DOM
    if (!mesh.userData) mesh.userData = {};
    mesh.userData.specRowId = tr.dataset.rowId;

    if (mesh.isGroup || (mesh.children && mesh.children.length > 0)) {
        mesh.traverse(child => {
            if (child && child !== mesh) {
                if (!child.userData) child.userData = {};
                child.userData.specRowId = tr.dataset.rowId;
            }
        });
    }
    
    if (isLinkingMeshToSpecRow) return;
    isLinkingMeshToSpecRow = true;
    try {
        // Вызываем актуализацию UI и количеств
        if (typeof window.updateRow3DStatus === 'function') {
            window.updateRow3DStatus(tr);
        }
        if (typeof window.syncSpecTableQuantities === 'function') {
            window.syncSpecTableQuantities();
        }
    } finally {
        isLinkingMeshToSpecRow = false;
    }
}

window.generateSpecRowId = generateSpecRowId;
window.getSpecRowByMesh = getSpecRowByMesh;
window.getMeshesByRowId = getMeshesByRowId;
window.updateRow3DStatus = updateRow3DStatus;
window.handleMeshModification = handleMeshModification;
window.syncSpecTableQuantities = syncSpecTableQuantities;
window.removeMeshFromScene = removeMeshFromScene;
window.linkMeshToSpecRow = linkMeshToSpecRow;

// ==========================================
// ПАНЕЛЬ С НАБОРОМ: 2D СХЕМА И ТАБЛИЦА РЕБЕР
// ==========================================

window.panelStiffeners = [];
window.panel2DState = {
    panX: 0,
    panY: 0,
    zoom: 1,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    hoveredIndex: -1,
    initialized: false
};

window.initPanel2DCanvas = function() {
    const canvas = document.getElementById('qi-panel-2d-canvas');
    const wrapper = document.getElementById('panel-2d-canvas-wrapper');
    if (!canvas || !wrapper) return;

    const rect = wrapper.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (rect.width > 0 && rect.height > 0) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
    }

    if (window.panel2DState.initialized) {
        window.renderPanel2DScheme();
        return;
    }
    window.panel2DState.initialized = true;

    // Масштабирование колесиком мыши к точке курсора
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const cRect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - cRect.left;
        const mouseY = e.clientY - cRect.top;

        const factor = e.deltaY < 0 ? 1.15 : 0.87;
        const newZoom = Math.max(0.005, Math.min(50, window.panel2DState.zoom * factor));

        window.panel2DState.panX = mouseX - (mouseX - window.panel2DState.panX) * (newZoom / window.panel2DState.zoom);
        window.panel2DState.panY = mouseY - (mouseY - window.panel2DState.panY) * (newZoom / window.panel2DState.zoom);
        window.panel2DState.zoom = newZoom;

        window.renderPanel2DScheme();
    }, { passive: false });

    // Перетаскивание (Pan)
    canvas.addEventListener('mousedown', (e) => {
        window.panel2DState.isDragging = true;
        window.panel2DState.dragStartX = e.clientX - window.panel2DState.panX;
        window.panel2DState.dragStartY = e.clientY - window.panel2DState.panY;
    });

    window.addEventListener('mousemove', (e) => {
        const cRect = canvas.getBoundingClientRect();
        if (!window.panel2DState.isDragging) {
            if (e.clientX >= cRect.left && e.clientX <= cRect.right && e.clientY >= cRect.top && e.clientY <= cRect.bottom) {
                const mouseX = e.clientX - cRect.left;
                const worldX = (mouseX - window.panel2DState.panX) / window.panel2DState.zoom;
                let foundIndex = -1;
                const threshold = 18 / window.panel2DState.zoom;
                (window.panelStiffeners || []).forEach((st, idx) => {
                    if (Math.abs(st.x - worldX) < threshold) foundIndex = idx;
                });
                if (window.panel2DState.hoveredIndex !== foundIndex) {
                    window.panel2DState.hoveredIndex = foundIndex;
                    window.renderPanel2DScheme();
                }
            } else if (window.panel2DState.hoveredIndex !== -1) {
                window.panel2DState.hoveredIndex = -1;
                window.renderPanel2DScheme();
            }
            return;
        }
        window.panel2DState.panX = e.clientX - window.panel2DState.dragStartX;
        window.panel2DState.panY = e.clientY - window.panel2DState.dragStartY;
        window.renderPanel2DScheme();
    });

    window.addEventListener('mouseup', () => {
        window.panel2DState.isDragging = false;
    });

    if (window.ResizeObserver) {
        const ro = new ResizeObserver(() => {
            const r = wrapper.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
                const dp = window.devicePixelRatio || 1;
                canvas.width = r.width * dp;
                canvas.height = r.height * dp;
                window.renderPanel2DScheme();
            }
        });
        ro.observe(wrapper);
    }
};

window.zoomPanel2D = function(factor) {
    const canvas = document.getElementById('qi-panel-2d-canvas');
    if (!canvas) return;
    const cRect = canvas.getBoundingClientRect();
    const cx = (cRect.width || 460) / 2;
    const cy = (cRect.height || 185) / 2;
    const newZoom = Math.max(0.005, Math.min(50, window.panel2DState.zoom * factor));
    window.panel2DState.panX = cx - (cx - window.panel2DState.panX) * (newZoom / window.panel2DState.zoom);
    window.panel2DState.panY = cy - (cy - window.panel2DState.panY) * (newZoom / window.panel2DState.zoom);
    window.panel2DState.zoom = newZoom;
    window.renderPanel2DScheme();
};

window.resetPanel2DView = function() {
    const canvas = document.getElementById('qi-panel-2d-canvas');
    const wrapper = document.getElementById('panel-2d-canvas-wrapper');
    if (!canvas || !wrapper) return;
    const cRect = wrapper.getBoundingClientRect();
    const w = cRect.width || 460;
    const h = cRect.height || 185;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    const plateL = parseFloat(document.getElementById('qi-panel-l')?.value) || 6000;
    const plateW = parseFloat(document.getElementById('qi-panel-w')?.value) || 2000;

    const marginX = 35;
    const marginY = 30;
    const zX = (w - marginX * 2) / plateL;
    const zY = (h - marginY * 2) / plateW;
    window.panel2DState.zoom = Math.min(zX, zY);
    window.panel2DState.panX = (w - plateL * window.panel2DState.zoom) / 2;
    window.panel2DState.panY = (h - plateW * window.panel2DState.zoom) / 2;

    window.renderPanel2DScheme();
};

window.renderPanel2DScheme = function() {
    const canvas = document.getElementById('qi-panel-2d-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cRect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = cRect.width || 460;
    const h = cRect.height || 185;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // 1. Фон
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(0, 0, w, h);

    const plateL = parseFloat(document.getElementById('qi-panel-l')?.value) || 0;
    const plateW = parseFloat(document.getElementById('qi-panel-w')?.value) || 0;
    const plateT = parseFloat(document.getElementById('qi-panel-t')?.value) || 0;

    if (plateL <= 0 || plateW <= 0) {
        // Отрисовка пустого состояния 2D эскиза с ненавязчивым ориентиром
        const phW = 6000;
        const phH = 2000;
        const marginX = 35;
        const marginY = 30;
        const zX = (w - marginX * 2) / phW;
        const zY = (h - marginY * 2) / phH;
        const phZoom = Math.min(zX, zY);
        const sheetX = (w - phW * phZoom) / 2;
        const sheetY = (h - phH * phZoom) / 2;
        const sheetW = phW * phZoom;
        const sheetH = phH * phZoom;

        ctx.strokeStyle = '#CBD5E1';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(sheetX, sheetY, sheetW, sheetH);
        ctx.setLineDash([]);

        ctx.fillStyle = '#94A3B8';
        ctx.font = '11px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Введите параметры полотнища и набора', w / 2, h / 2);
        ctx.restore();
        return;
    }

    const z = window.panel2DState.zoom;
    const px = window.panel2DState.panX;
    const py = window.panel2DState.panY;

    const sheetX = px;
    const sheetY = py;
    const sheetW = plateL * z;
    const sheetH = plateW * z;

    // Рисуем полотнище листа
    ctx.fillStyle = '#E2E8F0';
    ctx.fillRect(sheetX, sheetY, sheetW, sheetH);

    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(sheetX, sheetY, sheetW, sheetH);

    // Подпись размеров листа в центре
    if (sheetW > 80 && sheetH > 40) {
        ctx.fillStyle = 'rgba(71, 85, 105, 0.4)';
        ctx.font = 'bold 11px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`Лист ${plateT}x${plateW}x${plateL} мм`, sheetX + sheetW / 2, sheetY + sheetH / 2);
    }

    // Верхняя размерная линия (L)
    if (sheetW > 40) {
        const dimY = sheetY - 10;
        ctx.strokeStyle = '#94A3B8';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sheetX, dimY);
        ctx.lineTo(sheetX + sheetW, dimY);
        ctx.moveTo(sheetX, dimY - 4);
        ctx.lineTo(sheetX, dimY + 4);
        ctx.moveTo(sheetX + sheetW, dimY - 4);
        ctx.lineTo(sheetX + sheetW, dimY + 4);
        ctx.stroke();

        ctx.fillStyle = '#475569';
        ctx.font = '10px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`L = ${plateL} мм`, sheetX + sheetW / 2, dimY - 2);
    }

    // Левая размерная линия (W)
    if (sheetH > 30) {
        const dimX = sheetX - 10;
        ctx.strokeStyle = '#94A3B8';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(dimX, sheetY);
        ctx.lineTo(dimX, sheetY + sheetH);
        ctx.moveTo(dimX - 4, sheetY);
        ctx.lineTo(dimX + 4, sheetY);
        ctx.moveTo(dimX - 4, sheetY + sheetH);
        ctx.lineTo(dimX + 4, sheetY + sheetH);
        ctx.stroke();

        ctx.save();
        ctx.translate(dimX - 4, sheetY + sheetH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = '#475569';
        ctx.font = '10px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`W = ${plateW} мм`, 0, 0);
        ctx.restore();
    }

    // Рисуем ребра жесткости (полособульбы)
    const list = window.panelStiffeners || [];
    list.forEach((st, idx) => {
        const isHovered = (window.panel2DState && window.panel2DState.hoveredIndex === idx);
        const topOffVal = (typeof st.topOffset === 'number') ? st.topOffset : (parseFloat(st.topOffset) || 0);
        const botOffVal = (typeof st.botOffset === 'number') ? st.botOffset : (parseFloat(st.botOffset) || 0);

        // Расчет координат Y: положительное смещение = выход за пределы листа, отрицательное = недоход
        const stTopY = sheetY - topOffVal * z;
        const stBotY = sheetY + sheetH + botOffVal * z;

        const side = st.side || '+';
        const rawWebThick = 8;
        const webThickPx = Math.max(2, rawWebThick * z);

        const markLineX = sheetX + st.x * z;
        let webX = markLineX;
        if (side === '+') {
            // Толщина вправо (по левую стенку на разметку)
            webX = markLineX;
        } else if (side === '-') {
            // Толщина влево (по правую стенку на разметку)
            webX = markLineX - webThickPx;
        } else if (side === '=') {
            // Толщина по центру
            webX = markLineX - webThickPx / 2;
        }

        // Линия разметки (оси / привязки)
        ctx.strokeStyle = isHovered ? '#FB923C' : 'rgba(100, 116, 139, 0.4)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(markLineX, Math.min(sheetY, stTopY) - 5);
        ctx.lineTo(markLineX, Math.max(sheetY + sheetH, stBotY) + 5);
        ctx.stroke();
        ctx.setLineDash([]);

        // Тело ребра (стенка полособульба с учетом стороны толщины)
        ctx.fillStyle = isHovered ? '#EA580C' : '#2563EB';
        const barW = Math.max(2, webThickPx);
        const barH = Math.max(2, stBotY - stTopY);
        ctx.fillRect(webX, stTopY, barW, barH);

        // Верхний и нижний торцы ребра (засечки)
        ctx.strokeStyle = isHovered ? '#9A3412' : '#1D4ED8';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(webX - 2, stTopY);
        ctx.lineTo(webX + barW + 2, stTopY);
        ctx.moveTo(webX - 2, stBotY);
        ctx.lineTo(webX + barW + 2, stBotY);
        ctx.stroke();

        // Бейджик с номером ребра
        const badgeY = Math.min(sheetY + 12, stTopY + 12);
        ctx.fillStyle = isHovered ? '#EA580C' : '#2563EB';
        ctx.beginPath();
        ctx.arc(markLineX, badgeY, 7.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 9px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${idx + 1}`, markLineX, badgeY);

        // Отметка расстояния снизу
        if (z > 0.035) {
            ctx.fillStyle = isHovered ? '#EA580C' : '#475569';
            ctx.font = '9px Inter, system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(`${Math.round(st.x)} (${side})`, markLineX, Math.max(sheetY + sheetH, stBotY) + 3);
        }
    });

    ctx.restore();
};

window.initPanelStiffenersFromSpacing = function(force = false) {
    const plateL = parseFloat(document.getElementById('qi-panel-l')?.value);
    const spacing = parseFloat(document.getElementById('qi-panel-spacing')?.value);
    const profType = (document.getElementById('qi-panel-profile')?.value || "").trim() || "HP 160x8";

    if (isNaN(plateL) || isNaN(spacing) || plateL <= 0 || spacing <= 0) {
        window.panelStiffeners = [];
        window.renderPanelTable();
        window.renderPanel2DScheme();
        return;
    }

    let count = Math.floor(plateL / spacing);
    if (count < 1) count = 1;

    const list = [];
    let curX = spacing;
    let idCounter = 1;

    while (curX < plateL) {
        list.push({
            id: idCounter++,
            x: curX,
            topOffset: 0,
            botOffset: 0,
            side: '+',
            profType: profType
        });
        curX += spacing;
    }

    if (list.length === 0) {
        list.push({
            id: 1,
            x: plateL / 2,
            topOffset: 0,
            botOffset: 0,
            side: '+',
            profType: profType
        });
    }

    window.panelStiffeners = list;
    window.renderPanelTable();
    window.renderPanel2DScheme();

    const panel = document.getElementById('quick-input-panel');
    if (panel && panel.classList.contains('show-preview')) {
        if (typeof updatePreview === 'function') updatePreview('panel');
    }
};

window.renderPanelTable = function() {
    const tbody = document.getElementById('qi-panel-stiffeners-tbody');
    if (!tbody) return;

    const plateL = parseFloat(document.getElementById('qi-panel-l')?.value) || 0;
    const list = window.panelStiffeners || [];

    let html = '';
    if (list.length === 0) {
        html += `
            <tr>
                <td colspan="7" style="text-align: center; color: #94A3B8; font-size: 11px; padding: 12px 6px;">
                    Нет ребер жесткости. Введите длину и шпацию или добавьте вручную.
                </td>
            </tr>
        `;
    } else {
        list.forEach((st, idx) => {
            const xLeft = Math.round(st.x);
            const xRight = plateL > 0 ? Math.round(Math.max(0, plateL - st.x)) : 0;
            const topOff = (typeof st.topOffset === 'number') ? st.topOffset : (parseFloat(st.topOffset) || 0);
            const botOff = (typeof st.botOffset === 'number') ? st.botOffset : (parseFloat(st.botOffset) || 0);
            const side = st.side || '+';

            html += `
                <tr data-stiffener-index="${idx}" onmouseenter="if(window.panel2DState){window.panel2DState.hoveredIndex=${idx};window.renderPanel2DScheme();}" onmouseleave="if(window.panel2DState){window.panel2DState.hoveredIndex=-1;window.renderPanel2DScheme();}">
                    <td style="font-weight: 700; color: #2563EB;">${idx + 1}</td>
                    <td><input type="number" step="5" class="panel-inp-top" value="${topOff}" placeholder="0" oninput="window.updateStiffenerParam(${idx}, 'topOffset', this.value)"></td>
                    <td><input type="number" step="5" class="panel-inp-bot" value="${botOff}" placeholder="0" oninput="window.updateStiffenerParam(${idx}, 'botOffset', this.value)"></td>
                    <td><input type="number" min="0" max="${plateL || 10000}" step="10" class="panel-inp-x-left" value="${xLeft}" oninput="window.updateStiffenerParam(${idx}, 'x_left', this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault(); window.cascadeStiffenerShift(${idx}, 'x_left', this.value);}"></td>
                    <td><input type="number" min="0" max="${plateL || 10000}" step="10" class="panel-inp-x-right" value="${xRight}" oninput="window.updateStiffenerParam(${idx}, 'x_right', this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault(); window.cascadeStiffenerShift(${idx}, 'x_right', this.value);}"></td>
                    <td>
                        <select class="panel-side-select" onchange="window.updateStiffenerParam(${idx}, 'side', this.value)" title="Толщина: + (вправо), - (влево), = (по центру)">
                            <option value="+" ${side === '+' ? 'selected' : ''}>+</option>
                            <option value="-" ${side === '-' ? 'selected' : ''}>-</option>
                            <option value="=" ${side === '=' ? 'selected' : ''}>=</option>
                        </select>
                    </td>
                    <td><button type="button" class="panel-delete-stiffener-btn" onclick="window.deleteStiffener(${idx})" title="Удалить ребро">&times;</button></td>
                </tr>
            `;
        });
    }

    html += `
        <tr class="panel-add-stiffener-row">
            <td colspan="7">
                <button type="button" class="panel-add-stiffener-btn" onclick="window.addNewStiffener()">
                    <span style="font-size: 14px; font-weight: 700;">+</span> Добавить ребро жесткости
                </button>
            </td>
        </tr>
    `;

    tbody.innerHTML = html;
};

window.updateStiffenerParam = function(index, field, value) {
    const list = window.panelStiffeners || [];
    if (!list[index]) return;

    const plateL = parseFloat(document.getElementById('qi-panel-l')?.value) || 6000;
    const numVal = parseFloat(value) || 0;

    if (field === 'topOffset') {
        list[index].topOffset = numVal;
    } else if (field === 'botOffset') {
        list[index].botOffset = numVal;
    } else if (field === 'side') {
        list[index].side = (value === '-' || value === '=') ? value : '+';
    } else if (field === 'x_left') {
        list[index].x = Math.max(0, Math.min(plateL, numVal));
        const row = document.querySelector(`tr[data-stiffener-index="${index}"]`);
        if (row) {
            const rightInp = row.querySelector('.panel-inp-x-right');
            if (rightInp) rightInp.value = Math.round(plateL - list[index].x);
        }
    } else if (field === 'x_right') {
        list[index].x = Math.max(0, Math.min(plateL, plateL - numVal));
        const row = document.querySelector(`tr[data-stiffener-index="${index}"]`);
        if (row) {
            const leftInp = row.querySelector('.panel-inp-x-left');
            if (leftInp) leftInp.value = Math.round(list[index].x);
        }
    }

    window.renderPanel2DScheme();

    const panel = document.getElementById('quick-input-panel');
    if (panel && panel.classList.contains('show-preview')) {
        if (typeof updatePreview === 'function') updatePreview('panel');
    }
};

let isCascadingStiffeners = false;
window.cascadeStiffenerShift = function(index, field, value) {
    if (isCascadingStiffeners) return;
    isCascadingStiffeners = true;
    try {
        const list = window.panelStiffeners || [];
        if (!list[index]) return;

        const plateL = parseFloat(document.getElementById('qi-panel-l')?.value) || 6000;
        const spacing = parseFloat(document.getElementById('qi-panel-spacing')?.value) || 500;
        const numVal = parseFloat(value) || 0;

        // 1. Устанавливаем положение текущего ребра
        if (field === 'x_left') {
            list[index].x = Math.max(0, Math.min(plateL, numVal));
        } else if (field === 'x_right') {
            list[index].x = Math.max(0, Math.min(plateL, plateL - numVal));
        }

        // 2. Каскадно пересчитываем координаты всех последующих ребер с шагом шпации от предыдущего
        for (let k = index + 1; k < list.length; k++) {
            list[k].x = Math.min(plateL, list[k - 1].x + spacing);
        }

        // 3. Перерисовываем таблицу, 2D схему и 3D фантом
        window.renderPanelTable();
        window.renderPanel2DScheme();

        const panel = document.getElementById('quick-input-panel');
        if (panel && panel.classList.contains('show-preview')) {
            if (typeof updatePreview === 'function') updatePreview('panel');
        }

        // 4. Восстанавливаем фокус на измененном поле ввода
        setTimeout(() => {
            const selector = field === 'x_left' ? '.panel-inp-x-left' : '.panel-inp-x-right';
            const row = document.querySelector(`tr[data-stiffener-index="${index}"]`);
            if (row) {
                const inp = row.querySelector(selector);
                if (inp) {
                    inp.focus();
                    if (inp.select) inp.select();
                }
            }
        }, 30);
    } finally {
        setTimeout(() => { isCascadingStiffeners = false; }, 60);
    }
};

window.deleteStiffener = function(index) {
    if (!window.panelStiffeners) return;
    window.panelStiffeners.splice(index, 1);
    window.renderPanelTable();
    window.renderPanel2DScheme();

    const panel = document.getElementById('quick-input-panel');
    if (panel && panel.classList.contains('show-preview')) {
        if (typeof updatePreview === 'function') updatePreview('panel');
    }
};

window.addNewStiffener = function() {
    const plateL = parseFloat(document.getElementById('qi-panel-l')?.value) || 6000;
    const spacing = parseFloat(document.getElementById('qi-panel-spacing')?.value) || 500;
    const profType = (document.getElementById('qi-panel-profile')?.value || "HP 160x8").trim() || "HP 160x8";

    const list = window.panelStiffeners || [];
    let newX = spacing;
    let defaultTop = 0;
    let defaultBot = 0;
    let defaultSide = '+';

    if (list.length > 0) {
        const lastSt = list[list.length - 1];
        defaultTop = typeof lastSt.topOffset === 'number' ? lastSt.topOffset : (parseFloat(lastSt.topOffset) || 0);
        defaultBot = typeof lastSt.botOffset === 'number' ? lastSt.botOffset : (parseFloat(lastSt.botOffset) || 0);
        defaultSide = lastSt.side || '+';

        if (lastSt.x + spacing < plateL) {
            newX = lastSt.x + spacing;
        } else {
            let maxGap = 0;
            let gapMid = plateL / 2;
            let prevX = 0;
            list.forEach(st => {
                const gap = st.x - prevX;
                if (gap > maxGap) {
                    maxGap = gap;
                    gapMid = prevX + gap / 2;
                }
                prevX = st.x;
            });
            const endGap = plateL - prevX;
            if (endGap > maxGap) {
                gapMid = prevX + endGap / 2;
            }
            newX = gapMid;
        }
    }

    list.push({
        id: Date.now(),
        x: Math.round(newX),
        topOffset: defaultTop,
        botOffset: defaultBot,
        side: defaultSide,
        profType: profType
    });

    list.sort((a, b) => a.x - b.x);

    window.panelStiffeners = list;
    window.renderPanelTable();
    window.renderPanel2DScheme();

    const panel = document.getElementById('quick-input-panel');
    if (panel && panel.classList.contains('show-preview')) {
        if (typeof updatePreview === 'function') updatePreview('panel');
    }
};

window.onPanelParamChange = function() {
    window.renderPanelTable();
    window.resetPanel2DView();

    const panel = document.getElementById('quick-input-panel');
    if (panel && panel.classList.contains('show-preview')) {
        if (typeof updatePreview === 'function') updatePreview('panel');
    }
};

window.onPanelProfileChange = function() {
    const profType = (document.getElementById('qi-panel-profile')?.value || "HP 160x8").trim();
    if (window.panelStiffeners) {
        window.panelStiffeners.forEach(st => st.profType = profType);
    }
    const panel = document.getElementById('quick-input-panel');
    if (panel && panel.classList.contains('show-preview')) {
        if (typeof updatePreview === 'function') updatePreview('panel');
    }
};

window.onPanelSpacingChange = function() {
    window.initPanelStiffenersFromSpacing(true);
};
