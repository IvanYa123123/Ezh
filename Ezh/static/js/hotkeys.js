// Горячие клавиши:
//   Ctrl/⌘ + K — фокус на поле поиска в шапке
//   Ctrl/⌘ + N — создать заметку на сегодня
//   Esc        — свернуть развёрнутый день / отменить ввод заметки
//
// v3.18.0: Ctrl+K теперь фокусит инлайн-поле #globalSearchInput,
// а не открывает модалку. Если поля нет — fallback на openSearchModal.

(function () {

    function _isTypingContext(el) {
        if (!el) return false;
        const tag = (el.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if (el.isContentEditable) return true;
        return false;
    }

    function _isModalOpen() {
        return document.querySelector('.modal.show') !== null;
    }

    function _isSearchModalOpen() {
        return document.querySelector('#searchModal.show') !== null;
    }

    function _focusInlineSearch() {
        const inline = document.getElementById('globalSearchInput');
        if (inline) {
            inline.focus();
            inline.select();
            return true;
        }
        return false;
    }

    document.addEventListener('keydown', (e) => {

        const key = (e.key || '').toLowerCase();

        // ─── [ / ]: заметки, { / }: события ────────────────────
        // navigateNote()/navigateEvent() были в коде, но без кнопок
        // и клавиш. Скобки выбраны вместо Alt+←/→: в Chrome на Windows
        // Alt+стрелка — это «назад/вперёд» на уровне браузера, и
        // preventDefault от неё не спасает.
        if (key === '[' || key === ']' || key === '{' || key === '}') {
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (_isTypingContext(e.target)) return;
            if (_isModalOpen()) return;
            e.preventDefault();
            const dir = (key === ']' || key === '}') ? 1 : -1;
            const isEvent = (key === '{' || key === '}');
            if (isEvent) {
                if (typeof navigateEventFromHere === 'function') navigateEventFromHere(dir);
            } else if (typeof navigateNoteFromHere === 'function') {
                navigateNoteFromHere(dir);
            }
            return;
        }

        // ─── Ctrl/⌘ + K: фокус на инлайн-поиск ─────────────────
        if (key === 'k' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
            e.preventDefault();

            if (_isSearchModalOpen()) {
                const inp = document.getElementById('searchInput');
                if (inp) { inp.focus(); inp.select(); }
                return;
            }

            if (_focusInlineSearch()) return;

            // Fallback на модалку, если поле почему-то отсутствует
            if (typeof openSearchModal === 'function') openSearchModal();
            return;
        }

        // ─── Ctrl/⌘ + N: заметка на сегодня ────────────────────
        if (key === 'n' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
            if (_isTypingContext(e.target)) return;
            e.preventDefault();
            _openTodayTaskInput();
            return;
        }

        // ─── Esc: свернуть день / отменить ввод заметки ────────
        if (key === 'escape') {

            const t = e.target;
            if (t && t.id && t.id.indexOf('task-input-') === 0) {
                e.preventDefault();
                t.value = '';
                const wrap = document.getElementById(
                    'task-input-wrap-' + t.id.slice('task-input-'.length)
                );
                if (wrap) wrap.style.display = 'none';
                t.blur();
                return;
            }

            if (_isModalOpen()) return;

            if (typeof expandedDayDateStr !== 'undefined' && expandedDayDateStr) {
                e.preventDefault();
                if (typeof toggleExpandDay === 'function') {
                    toggleExpandDay(expandedDayDateStr);
                }
            }
        }
    });

    function _openTodayTaskInput() {
        const today = getLocalDateStr(new Date());
        const wrapId = 'task-input-wrap-' + today;

        if (!document.getElementById(wrapId)) {
            if (typeof goToToday === 'function') {
                goToToday();
            } else if (typeof jumpToDate === 'function') {
                jumpToDate(today);
            }
        }

        requestAnimationFrame(() => {
            const wrap = document.getElementById(wrapId);
            if (!wrap) return;

            const input = document.getElementById('task-input-' + today);
            if (wrap.style.display === 'none' || wrap.style.display === '') {
                if (typeof toggleTaskInput === 'function') toggleTaskInput(today);
            }
            if (input) {
                input.focus();
                const len = input.value.length;
                try { input.setSelectionRange(len, len); } catch (err) {}
            }
        });
    }

})();