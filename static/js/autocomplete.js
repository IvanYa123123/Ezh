// T9-автокомплит для полей ввода групп.
//
// Оптимизации:
//   • Debounce 80 мс на input — при быстром вводе не запускаем render()
//     на каждый keystroke.
//   • Кэш lowercase-версий всех групп (allGroupsLower). Убирает 500+
//     .toLowerCase() на каждый символ. Инвалидируется автоматически
//     при изменении длины allGroups.

const _AC_DEBOUNCE_MS = 80;

// Кэш lowercase-версий allGroups.
let _allGroupsLowerCache = null;

function _getAllGroupsLower() {
    if (!_allGroupsLowerCache || _allGroupsLowerCache.length !== allGroups.length) {
        _allGroupsLowerCache = allGroups.map(g => g.toLowerCase());
    }
    return _allGroupsLowerCache;
}

function initGroupAutocomplete(input) {
    if (!input) return;

    let dropdown = document.createElement('div');
    dropdown.className = 'autocomplete-list';
    document.body.appendChild(dropdown);
    let currentFocus = -1;
    let renderTimer = null;

    function positionDropdown() {
        let rect = input.getBoundingClientRect();
        dropdown.style.left = rect.left + 'px';
        dropdown.style.top = (rect.bottom + 2) + 'px';
        dropdown.style.width = Math.max(rect.width, 280) + 'px';
    }
    function hide() { dropdown.style.display = 'none'; currentFocus = -1; }
    function getItems() { return dropdown.querySelectorAll('.autocomplete-item:not(.autocomplete-empty)'); }
    function updateActive() {
        let items = getItems();
        items.forEach((it, i) => it.classList.toggle('active', i === currentFocus));
        if (items[currentFocus]) items[currentFocus].scrollIntoView({ block: 'nearest' });
    }

    function render() {
        let query = input.value.trim();
        let lower = query.toLowerCase();
        let matches = [];

        if (!lower) {
            matches = allGroups.slice(0, 40);
        } else {
            // Используем кэш lowercase-строк: 500 .toLowerCase() в горячем
            // пути заменены на 500 прямых сравнений.
            const lowerAll = _getAllGroupsLower();
            let starts = [], contains = [];
            for (let i = 0; i < allGroups.length; i++) {
                const gl = lowerAll[i];
                if (gl.startsWith(lower)) starts.push(allGroups[i]);
                else if (gl.includes(lower)) contains.push(allGroups[i]);
            }
            matches = starts.concat(contains).slice(0, 50);
        }
        let exact = lower && _getAllGroupsLower().indexOf(lower) !== -1;

        let html = '';
        if (matches.length === 0 && !query) {
            html = '<div class="autocomplete-item autocomplete-empty">Справочник групп пуст</div>';
        } else if (matches.length === 0) {
            html = '<div class="autocomplete-item autocomplete-empty">Ничего не найдено</div>';
        } else {
            matches.forEach(g => {
                html += `<div class="autocomplete-item" data-value="${escapeAttr(g)}">${highlightMatch(g, query)}</div>`;
            });
        }
        if (query && !exact) {
            html += `<div class="autocomplete-item autocomplete-add" data-add="${escapeAttr(query)}">➕ Добавить группу «${escapeHtml(query)}»</div>`;
        }

        dropdown.innerHTML = html;
        positionDropdown();
        dropdown.style.display = 'block';
        currentFocus = -1;
    }

    function renderDebounced() {
        if (renderTimer) clearTimeout(renderTimer);
        renderTimer = setTimeout(render, _AC_DEBOUNCE_MS);
    }

    input.addEventListener('focus', () => render());
    input.addEventListener('input', renderDebounced);
    input.addEventListener('blur', () => setTimeout(hide, 180));

    input.addEventListener('keydown', (e) => {
        let items = getItems();
        if (dropdown.style.display !== 'block') {
            if (e.key === 'ArrowDown') { render(); e.preventDefault(); }
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            currentFocus = (currentFocus + 1) % Math.max(items.length, 1);
            updateActive();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            currentFocus = (currentFocus - 1 + items.length) % Math.max(items.length, 1);
            updateActive();
        } else if (e.key === 'Enter') {
            if (currentFocus > -1 && items[currentFocus]) {
                e.preventDefault();
                e.stopPropagation();
                items[currentFocus].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            } else if (items.length > 0 && input.value.trim()) {
                let exact = _getAllGroupsLower().indexOf(input.value.trim().toLowerCase()) !== -1;
                if (exact) hide();
            }
        } else if (e.key === 'Escape') {
            hide();
        }
    });

    dropdown.addEventListener('mousedown', async (e) => {
        let item = e.target.closest('.autocomplete-item');
        if (!item) return;
        e.preventDefault();
        e.stopPropagation();
        if (item.dataset.value) {
            input.value = item.dataset.value;
            hide();
            input.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (item.dataset.add) {
            let name = item.dataset.add.trim();
            if (!name) return;
            try {
                let data = await apiAddCustomGroup(name);
                if (data.success) {
                    if (!validGroups.has(name.toUpperCase())) {
                        validGroups.add(name.toUpperCase());
                        allGroups.push(name);
                        // Кэш инвалидируется по длине автоматически.
                    }
                    input.value = name;
                    hide();
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
            } catch (err) { console.error(err); }
        }
    });

    window.addEventListener('scroll', () => {
        if (dropdown.style.display === 'block') positionDropdown();
    }, true);
    window.addEventListener('resize', () => {
        if (dropdown.style.display === 'block') positionDropdown();
    });
}