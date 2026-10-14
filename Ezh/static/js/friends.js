// Друзья: список, папки, drag-n-drop, синхронизация расписаний.

const campusNames = { 'galosha': 'Галоша', 'gogol': 'Гоголя', 'univer': 'Университетская' };

function loadFriendsOrder() {
    try { let raw = localStorage.getItem('friendsOrder'); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
}
function saveFriendsOrder() {
    try { localStorage.setItem('friendsOrder', JSON.stringify(friendsList.map(f => f.id))); } catch (e) {}
}
function applyFriendsOrder() {
    let order = loadFriendsOrder();
    if (!Array.isArray(order)) return;
    friendsList.sort((a, b) => {
        let ai = order.indexOf(a.id); if (ai === -1) ai = Number.MAX_SAFE_INTEGER;
        let bi = order.indexOf(b.id); if (bi === -1) bi = Number.MAX_SAFE_INTEGER;
        return ai - bi;
    });
}

async function fetchFriends() {
    const loader = document.getElementById('friendsLoader');
    if (loader) loader.style.display = 'block';
    try {
        let list = await apiLoadFriends();
        friendsList = Array.isArray(list) ? list : [];
    } catch (e) { friendsList = []; }

    applyFriendsOrder();
    let ids = new Set(friendsList.map(f => f.id));
    visibleFriends.forEach(id => { if (!ids.has(id)) visibleFriends.delete(id); });
    saveVisibleFriends();

    renderFriendDropdown();
    await fetchAllFriendsSchedules();
    renderFriendsCalendar();
    if (loader) loader.style.display = 'none';
}

function renderFriendDropdown() {
    let dropdownMenu = document.getElementById('friendTogglesDropdown');
    const parts = [];
    parts.push(`<li><a class="dropdown-item text-danger fw-bold" href="#" onclick="hideAllFriends(event)">🚫 Скрыть всех</a></li><li><hr class="dropdown-divider m-0"></li>`);

    let groupsMap = { "": [] };
    customCategories.forEach(c => { if (c) groupsMap[c] = []; });

    friendsList.forEach(f => {
        let cat = f.category || "";
        if (!groupsMap[cat]) {
            groupsMap[cat] = [];
            if (cat) {
                customCategories.push(cat);
                localStorage.setItem('customCategories', JSON.stringify(customCategories));
            }
        }
        groupsMap[cat].push(f);
    });

    let hasAnyGroup = false;
    for (let cat in groupsMap) {
        if (cat === "" && groupsMap[cat].length === 0) continue;
        hasAnyGroup = true;
        let isUnassigned = cat === "";
        let catName = isUnassigned ? "Без папки" : cat;
        let catIcon = isUnassigned ? "👤" : "📁";
        let allVisible = groupsMap[cat].length > 0 && groupsMap[cat].every(f => visibleFriends.has(f.id));
        let catChecked = allVisible ? 'checked' : '';

        let editBtnHtml = !isUnassigned
            ? `<button class="btn btn-sm btn-link text-secondary p-0 ms-2 text-decoration-none" onclick="editCustomCategory('${escapeJsString(cat)}', event)" title="Переименовать папку">✏️</button>
               <button class="btn btn-sm btn-link text-danger p-0 ms-1 text-decoration-none" onclick="deleteCustomCategory('${escapeJsString(cat)}', event)" title="Удалить папку">✕</button>`
            : '';

        parts.push(`
            <li ondragover="allowDrop(event)" ondrop="handleCategoryDrop(event, '${escapeJsString(cat)}')">
                <div class="dropdown-item bg-light d-flex justify-content-between align-items-center border-bottom pb-1 pt-1" onclick="toggleFriendGroup('${escapeJsString(cat)}'); event.stopPropagation();">
                    <div class="form-check m-0 flex-grow-1 d-flex align-items-center" style="cursor: pointer;">
                        <input class="form-check-input me-2" type="checkbox" ${catChecked} style="pointer-events: none;">
                        <label class="form-check-label fw-bold text-primary flex-grow-1 d-flex justify-content-between align-items-center" style="cursor: pointer; font-size: 0.85em;">
                            <span>${catIcon} ${escapeHtml(catName)}</span>
                            ${editBtnHtml}
                        </label>
                    </div>
                </div>
            </li>
        `);

        groupsMap[cat].forEach(f => {
            let isChecked = visibleFriends.has(f.id) ? 'checked' : '';
            parts.push(`
                <li draggable="true" ondragstart="handleDropdownDragStart(event, ${f.id})">
                    <div class="dropdown-item d-flex justify-content-between align-items-center py-1" onclick="toggleFriendVisibility(${f.id}); event.stopPropagation();" style="cursor: grab;">
                        <div class="form-check m-0 flex-grow-1 ms-3" style="cursor: pointer;">
                            <input class="form-check-input" type="checkbox" ${isChecked} style="pointer-events: none;">
                            <label class="form-check-label fw-bold" style="cursor: pointer; font-size: 0.9em;">
                                ⋮ ${escapeHtml(f.name)} <span class="text-muted small fw-normal">(${escapeHtml(f.group)})</span>
                            </label>
                        </div>
                    </div>
                </li>
            `);
        });
    }

    if (!hasAnyGroup) {
        parts.push('<li><span class="dropdown-item text-muted small text-center d-block py-2">Папок и друзей пока нет</span></li>');
    }

    parts.push(`
        <li><hr class="dropdown-divider m-0 mt-2"></li>
        <li class="p-2 pb-1">
            <div class="input-group input-group-sm">
                <input type="text" id="newCategoryInput" class="form-control" placeholder="Создать папку..." onclick="event.stopPropagation();" onkeypress="if(event.key === 'Enter') createNewCategory(event);">
                <button class="btn btn-outline-primary fw-bold" type="button" onclick="createNewCategory(event)">+</button>
            </div>
        </li>
    `);

    dropdownMenu.innerHTML = parts.join('');
}

async function editCustomCategory(oldName, e) {
    e.stopPropagation();
    let newName = prompt("Введите новое название для папки:", oldName);
    if (!newName || newName.trim() === '' || newName === oldName) return;
    newName = newName.trim();

    let idx = customCategories.indexOf(oldName);
    if (idx !== -1) { customCategories[idx] = newName; }
    else { customCategories.push(newName); }
    localStorage.setItem('customCategories', JSON.stringify(customCategories));

    let friendsToUpdate = friendsList.filter(f => (f.category || '') === oldName);
    for (let f of friendsToUpdate) {
        f.category = newName;
        try { await apiUpdateFriend(f.id, {name: f.name, group: f.group, subgroup: f.subgroup, category: newName}); } catch (e) {}
    }
    renderFriendDropdown();
    renderFriendsCalendar();
}

async function deleteCustomCategory(catName, e) {
    e.stopPropagation();
    if (!catName) return;

    const friendsInCat = friendsList.filter(f => (f.category || '') === catName);
    const confirmMsg = friendsInCat.length > 0
        ? `Удалить папку «${catName}»?\n\nДрузья (${friendsInCat.length} шт.) останутся, но переедут в «Без папки».`
        : `Удалить пустую папку «${catName}»?`;
    if (!confirm(confirmMsg)) return;

    for (let f of friendsInCat) {
        f.category = '';
        try {
            await apiUpdateFriend(f.id, {
                name: f.name,
                group: f.group,
                subgroup: f.subgroup,
                category: ''
            });
        } catch (err) { console.error('deleteCustomCategory: update friend failed', err); }
    }

    const idx = customCategories.indexOf(catName);
    if (idx !== -1) customCategories.splice(idx, 1);
    localStorage.setItem('customCategories', JSON.stringify(customCategories));

    renderFriendDropdown();
    renderFriendsCalendar();
}

function toggleFriendGroup(cat) {
    let groupFriends = friendsList.filter(f => (f.category || '') === cat);
    let allVisible = groupFriends.length > 0 && groupFriends.every(f => visibleFriends.has(f.id));
    groupFriends.forEach(f => { allVisible ? visibleFriends.delete(f.id) : visibleFriends.add(f.id); });
    saveVisibleFriends();
    renderFriendDropdown();
    renderFriendsCalendar();
}

function handleDropdownDragStart(e, friendId) {
    draggingDropdownFriendId = friendId;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => { document.getElementById('friendTogglesDropdown').classList.add('show'); }, 10);
}

async function handleCategoryDrop(e, newCategory) {
    e.preventDefault();
    e.stopPropagation();
    if (!draggingDropdownFriendId) return;
    let friend = friendsList.find(f => f.id === draggingDropdownFriendId);
    if (friend && (friend.category || "") !== newCategory) {
        friend.category = newCategory;
        apiUpdateFriend(friend.id, {name: friend.name, group: friend.group, subgroup: friend.subgroup, category: newCategory}).catch(() => {});
        renderFriendDropdown();
    }
    draggingDropdownFriendId = null;
}

function createNewCategory(e) {
    e.stopPropagation();
    e.preventDefault();
    let input = document.getElementById('newCategoryInput');
    let val = input.value.trim();
    if (val && !customCategories.includes(val)) {
        customCategories.push(val);
        localStorage.setItem('customCategories', JSON.stringify(customCategories));
        renderFriendDropdown();
    }
}

function toggleFriendVisibility(id) {
    visibleFriends.has(id) ? visibleFriends.delete(id) : visibleFriends.add(id);
    saveVisibleFriends();
    renderFriendDropdown();
    renderFriendsCalendar();
}

function hideAllFriends(e) {
    if (e) e.preventDefault();
    visibleFriends.clear();
    saveVisibleFriends();
    renderFriendDropdown();
    renderFriendsCalendar();
}

async function fetchAllFriendsSchedules() {
    let promises = friendsList.map(async (friend) => {
        if (!friendsSchedules[friend.id]) {
            try {
                let data = await apiLoadSchedule(friend.group, friend.subgroup);
                friendsSchedules[friend.id] = applyTimeFix(data);
                if (visibleFriends.has(friend.id)) renderFriendsCalendar();
            } catch (e) {
                friendsSchedules[friend.id] = [];
            }
        }
    });
    await Promise.all(promises);
}

async function syncFriendsSchedules(force = false) {
    if (!force) {
        const now = Date.now();
        if (window._lastFriendsSync && now - window._lastFriendsSync < 30 * 60 * 1000) {
            return;
        }
    }
    window._lastFriendsSync = Date.now();

    for (let friend of friendsList) {
        try {
            let newData = applyTimeFix(await apiSyncSchedule(friend.group, friend.subgroup));
            if (Array.isArray(newData) && newData.length > 0) {
                if (friendsSchedules[friend.id] && friendsSchedules[friend.id].length > 0
                    && newData.length < friendsSchedules[friend.id].length * 0.9) {
                    continue;
                }
                if (isScheduleDifferent(newData, friendsSchedules[friend.id])) {
                    friendsSchedules[friend.id] = newData;
                    if (visibleFriends.has(friend.id)) {
                        renderFriendsCalendar();
                        showUpdateNotification(`Расписание друга обновилось: ${friend.name}`);
                    }
                }
            }
        } catch (e) { console.error("Ошибка синхронизации друга", e); }
    }
}

function populateCategorySelect(selectedCategory) {
    let select = document.getElementById('friendCategory');
    select.innerHTML = '<option value="">Без папки</option>';
    customCategories.forEach(cat => {
        select.innerHTML += `<option value="${escapeAttr(cat)}">${escapeHtml(cat)}</option>`;
    });
    select.innerHTML += '<option value="_new" class="fw-bold text-primary">➕ Создать новую...</option>';
    select.value = (selectedCategory && customCategories.includes(selectedCategory)) ? selectedCategory : "";
}

function handleCategorySelect(select) {
    if (select.value === '_new') {
        let newCat = prompt("Введите название новой папки:");
        if (newCat && newCat.trim() !== '') {
            newCat = newCat.trim();
            if (!customCategories.includes(newCat)) {
                customCategories.push(newCat);
                localStorage.setItem('customCategories', JSON.stringify(customCategories));
                renderFriendDropdown();
            }
            populateCategorySelect(newCat);
        } else {
            select.value = "";
        }
    }
}

function showAddFriendModal() {
    editingFriendId = null;
    document.querySelector('#addFriendModal .modal-title').textContent = 'Добавить друга';
    document.getElementById('friendName').value = '';
    document.getElementById('friendGroup').value = '';
    document.getElementById('friendSubgroup').value = '0';
    populateCategorySelect('');
    new bootstrap.Modal(document.getElementById('addFriendModal')).show();
}

function editFriend(id, name, group, subgroup, category) {
    editingFriendId = id;
    document.querySelector('#addFriendModal .modal-title').textContent = 'Редактировать друга';
    document.getElementById('friendName').value = name;
    document.getElementById('friendGroup').value = group;
    document.getElementById('friendSubgroup').value = subgroup;
    populateCategorySelect(category);
    new bootstrap.Modal(document.getElementById('addFriendModal')).show();
}

async function saveFriend() {
    let nameInput = document.getElementById('friendName');
    let groupInput = document.getElementById('friendGroup');
    let subgroupInput = document.getElementById('friendSubgroup');
    let categoryInput = document.getElementById('friendCategory');

    let name = nameInput.value.trim();
    let group = groupInput.value.trim();
    let subgroup = subgroupInput.value;
    let category = categoryInput.value === '_new' ? '' : categoryInput.value;

    if (!name || !group) return alert("Введите имя и группу");

    let myGroup    = (document.getElementById('groupSelect').value || '').trim();
    let mySubgroup = String(document.getElementById('subgroupSelect').value || '0');
    if (myGroup && group.toLowerCase() === myGroup.toLowerCase() && String(subgroup) === mySubgroup) {
        return alert("Друг в той же группе, что и вы");
    }

    await ensureGroupsLoaded();
    if (validGroups.size > 0 && !validGroups.has(group.toUpperCase())) {
        let add = confirm(`Группа «${group}» не найдена в справочнике.\n\nДобавить её в вашу базу?`);
        if (!add) return;
        try {
            await apiAddCustomGroup(group);
            validGroups.add(group.toUpperCase());
            allGroups.push(group);
        } catch (e) {}
    }

    try {
        if (editingFriendId) {
            await apiUpdateFriend(editingFriendId, {name, group, subgroup, category});
        } else {
            let data = await apiCreateFriend({name, group, subgroup, category});
            if (data.id) { visibleFriends.add(data.id); saveVisibleFriends(); }
        }
    } catch (e) { return alert("Не удалось сохранить друга"); }

    nameInput.value = '';
    groupInput.value = '';
    subgroupInput.value = '0';
    populateCategorySelect('');

    bootstrap.Modal.getInstance(document.getElementById('addFriendModal')).hide();
    await fetchFriends();
}

async function deleteFriend(id) {
    if (!confirm("Вы уверены, что хотите удалить этого друга?")) return;
    try {
        await apiDeleteFriend(id);
        visibleFriends.delete(id);
        saveVisibleFriends();
        await fetchFriends();
    } catch (e) { console.error("Ошибка при удалении друга", e); }
}

function _allPairsMatch(myDaySchedule, friendDaySchedule) {
    if (myDaySchedule.length === 0) return false;
    return myDaySchedule.every(myItem =>
        friendDaySchedule.some(fItem =>
            myItem.time_range === fItem.time_range &&
            myItem.lesson === fItem.lesson &&
            (myItem.location || '').trim().toLowerCase() === (fItem.location || '').trim().toLowerCase()
        )
    );
}

function renderFriendsCalendar(dir = null) {
    let container = document.getElementById("friendsCalendarsContainer");
    if (!container) return;
    container.innerHTML = "";

    let btnPrev = document.getElementById("friendsNavPrev");
    let btnNext = document.getElementById("friendsNavNext");
    if (visibleFriends.size >= 2) {
        if (btnPrev) btnPrev.classList.add('show-friends-nav');
        if (btnNext) btnNext.classList.add('show-friends-nav');
    } else {
        if (btnPrev) btnPrev.classList.remove('show-friends-nav');
        if (btnNext) btnNext.classList.remove('show-friends-nav');
    }

    if (!friendsList || friendsList.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">👥</div>
                <div class="empty-state-title">Пока никого нет</div>
                <div class="empty-state-text">Нажмите «+ Добавить друга», чтобы видеть расписание друзей рядом со своим.</div>
            </div>`;
        return;
    }
    if (visibleFriends.size === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🔍</div>
                <div class="empty-state-title">Все друзья скрыты</div>
                <div class="empty-state-text">Выберите, кого показывать, в меню «Кого показывать?».</div>
            </div>`;
        return;
    }

    let realTodayStr = getLocalDateStr(new Date());

    friendsList.forEach(friend => {
        if (!visibleFriends.has(friend.id)) return;

        let friendSched = friendsSchedules[friend.id] || [];
        let wrapper = document.createElement('div');
        wrapper.className = "friend-wrapper bg-white rounded shadow-sm px-2 pb-2 pt-1";
        wrapper.dataset.friendId = friend.id;
        wrapper.draggable = true;

        wrapper.addEventListener('dragstart', (e) => {
            draggingFriendId = friend.id;
            wrapper.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', 'friend:' + friend.id); } catch (err) {}
        });
        wrapper.addEventListener('dragend', () => {
            wrapper.classList.remove('dragging');
            document.querySelectorAll('.friend-wrapper').forEach(w => w.classList.remove('drag-over'));
            draggingFriendId = null;
        });
        wrapper.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (draggingFriendId !== null && draggingFriendId !== friend.id) wrapper.classList.add('drag-over');
        });
        wrapper.addEventListener('dragleave', () => wrapper.classList.remove('drag-over'));
        wrapper.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            wrapper.classList.remove('drag-over');
            if (draggingFriendId === null || draggingFriendId === friend.id) return;
            let fromIdx = friendsList.findIndex(f => f.id === draggingFriendId);
            let toIdx = friendsList.findIndex(f => f.id === friend.id);
            if (fromIdx === -1 || toIdx === -1) return;
            let [moved] = friendsList.splice(fromIdx, 1);
            friendsList.splice(toIdx, 0, moved);
            saveFriendsOrder();
            renderFriendsCalendar();
        });

        let header = document.createElement('div');
        header.className = "fw-bold text-primary mb-2 ps-1 pt-1 friend-header-row d-flex align-items-center";
        header.innerHTML = `
            <span class="friend-drag-handle" title="Перетащите, чтобы изменить порядок">⋮⋮</span>
            <span class="flex-grow-1">👤 ${escapeHtml(friend.name)} <span class="text-muted small fw-normal ms-1">(${escapeHtml(friend.group)})</span></span>
            <button class="btn btn-sm btn-link text-primary p-0 me-2 text-decoration-none" onclick="editFriend(${friend.id}, '${escapeJsString(friend.name)}', '${escapeJsString(friend.group)}', '${friend.subgroup}', '${escapeJsString(friend.category || '')}')" title="Редактировать">✏️</button>
            <button class="btn btn-sm btn-link text-danger p-0 text-decoration-none" onclick="deleteFriend(${friend.id})" title="Удалить">🗑️</button>
        `;
        wrapper.appendChild(header);

        let grid = document.createElement('div');
        grid.className = "calendar-grid w-100";
        grid.classList.remove('slide-left', 'slide-right', 'fade-in');
        void grid.offsetWidth;
        if (dir === 'right')      grid.classList.add('slide-right');
        else if (dir === 'left')  grid.classList.add('slide-left');
        else                      grid.classList.add('fade-in');

        const dayParts = [];

        for (let i = 0; i < 7; i++) {
            let d = new Date(currentBaseDate); d.setDate(d.getDate() + i);
            let dateStr = getLocalDateStr(d);
            let displayDate = d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });

            let daySchedule = friendSched.filter(item => item.date === dateStr);
            daySchedule.sort((a, b) => a.n - b.n);
            let myDaySchedule = cachedSchedule.filter(item => item.date === dateStr);
            myDaySchedule.sort((a, b) => a.n - b.n);

            let isTodayClass = (dateStr === realTodayStr) ? " day-today" : "";
            let html = `<div class="friend-col${isTodayClass}"><div class="friend-day-header">${displayDate}</div>`;

            if (daySchedule.length > 0) {
                let fStart = fixTime(daySchedule[0].time_range.split(' - ')[0]);
                let fEnd = fixTime(daySchedule[daySchedule.length - 1].time_range.split(' - ')[1]);
                let fCampStart = getCampus(daySchedule[0]);
                let fCampEnd = getCampus(daySchedule[daySchedule.length - 1]);

                html += `<div class="fw-bold text-primary mb-2 text-center border-bottom pb-1" style="font-size: 0.8em;">🕒 ${fStart} - ${fEnd}</div>`;

                const allMatch = _allPairsMatch(myDaySchedule, daySchedule);

                if (allMatch) {
                    html += `<div class="shared-class shared-common fw-bold">🤝 Все пары совпадают</div>`;
                } else {
                    daySchedule.forEach(fItem => {
                        let match = myDaySchedule.find(myItem =>
                            myItem.time_range === fItem.time_range &&
                            myItem.lesson === fItem.lesson &&
                            (myItem.location || '').trim().toLowerCase() === (fItem.location || '').trim().toLowerCase()
                        );
                        if (match) html += `<div class="shared-class shared-common fw-bold">🤝 Общая пара в ${fixTime(fItem.time_range.split(' - ')[0])}</div>`;
                    });

                    let myStart = myDaySchedule.length > 0 ? fixTime(myDaySchedule[0].time_range.split(' - ')[0]) : null;
                    let myEnd   = myDaySchedule.length > 0 ? fixTime(myDaySchedule[myDaySchedule.length - 1].time_range.split(' - ')[1]) : null;
                    let myCampStart = myDaySchedule.length > 0 ? getCampus(myDaySchedule[0]) : 'unknown';
                    let myCampEnd   = myDaySchedule.length > 0 ? getCampus(myDaySchedule[myDaySchedule.length - 1]) : 'unknown';

                    if (myStart && fStart === myStart) {
                        if (fCampStart !== 'unknown' && myCampStart !== 'unknown') {
                            if (fCampStart !== myCampStart) {
                                html += `<div class="shared-class shared-warning fw-bold">🚨 Начинаем одновременно в ${fStart}, но в разных корпусах</div>`;
                            } else {
                                let campRu = campusNames[fCampStart] || fCampStart;
                                html += `<div class="shared-class shared-same-campus fw-bold">🏃 Начинаем одновременно в корпусе «${campRu}» в ${fStart}</div>`;
                            }
                        } else {
                            html += `<div class="shared-class shared-info fw-bold">🕒 Начинаем в одно время: ${fStart}</div>`;
                        }
                    }
                    if (myEnd && fEnd === myEnd) {
                        if (fCampEnd !== 'unknown' && myCampEnd !== 'unknown') {
                            if (fCampEnd !== myCampEnd) {
                                html += `<div class="shared-class shared-warning fw-bold">🚨 Заканчиваем одновременно в ${fEnd}, но в разных корпусах</div>`;
                            } else {
                                let campRu = campusNames[fCampEnd] || fCampEnd;
                                html += `<div class="shared-class shared-same-campus fw-bold">🏡 Заканчиваем одновременно в корпусе «${campRu}» в ${fEnd}</div>`;
                            }
                        } else {
                            html += `<div class="shared-class shared-info fw-bold">🕒 Заканчиваем в одно время: ${fEnd}</div>`;
                        }
                    }
                }

                if (showFriends) {
                    html += `<div class="mt-2 border-top pt-2">`;
                    daySchedule.forEach(fItem => {
                        let typeBadge = fItem.type_name ? `<span class="badge bg-secondary ms-1" style="font-size: 0.6em;">${fItem.type_name}</span>` : '';
                        let teacherHtml = (showTeacher && fItem.teacher) ? `<div class="text-muted mt-1" style="font-size: 0.85em;">${escapeHtml(fItem.teacher)}</div>` : '';
                        let locHtml = (showLocation && fItem.location) ? `<div class="text-muted" style="font-size: 0.85em;">${escapeHtml(fItem.location)}</div>` : '';
                        html += `
                            <div class="bg-white border rounded p-1 mb-1 shadow-sm" style="font-size: 0.75em; border-left: 3px solid var(--border-color) !important;">
                                <strong class="text-primary">${fixTime(fItem.time_range)}</strong>${typeBadge}<br>
                                <span title="${escapeHtml(fItem.lesson)}">${escapeHtml(fItem.lesson)}</span>
                                ${teacherHtml}
                                ${locHtml}
                            </div>`;
                    });
                    html += `</div>`;
                }
            } else {
                html += `<div class="text-muted text-center mt-2" style="font-size: 0.8em;">Выходной</div>`;
            }
            html += `</div>`;
            dayParts.push(html);
        }

        grid.innerHTML = dayParts.join('');
        wrapper.appendChild(grid);
        container.appendChild(wrapper);
    });
}