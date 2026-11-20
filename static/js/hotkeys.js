// Горячие клавиши:
//   Ctrl/⌘ + K — фокус на поле поиска в шапке
//   Esc        — свернуть развёрнутый день / отменить ввод заметки
//   [ / ]      — предыдущая/следующая заметка
//   { / }      — предыдущее/следующее событие
//
// v3.18.0: Ctrl+K теперь фокусит инлайн-поле #globalSearchInput,
// а не открывает модалку. Если поля нет — fallback на openSearchModal.
//
// v3.19.0: навигация по заметкам/событиям переведена на физические
// коды клавиш (e.code), чтобы работать на русской раскладке.
// Ctrl+N убран: браузер перехватывает его раньше и preventDefault
// не помогает.

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
        const code = e.code || '';

        // ─── [ / ]: заметки, { / }: события ────────────────────
        // Физические коды клавиш: не зависят от раскладки.
        const isNotePrev  = code === 'BracketLeft';
        const isNoteNext  = code === 'BracketRight';
        const isEventPrev = code === 'BraceLeft';
        const isEventNext = code === 'BraceRight';

        if (isNotePrev || isNoteNext || isEventPrev || isEventNext) {
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (_isTypingContext(e.target)) return;
            if (_isModalOpen()) return;
            e.preventDefault();
            const dir = (isNoteNext || isEventNext) ? 1 : -1;
            const isEvent = isEventPrev || isEventNext;
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

        // ─── Ctrl/⌘ + N убран: браузер перехватывает его раньше
        //     нас и preventDefault не помогает. Используйте кнопку «+».

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

})();