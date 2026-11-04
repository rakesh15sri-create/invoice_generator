import { useEffect, useRef, useState } from 'react';
import { fmtAmount } from '../../components/ui.jsx';
import { STATUSES, ageLevel, fmtDuration, isOpen } from '../../crm/domain.js';
import { navigate } from '../../route.js';

const HOLD_MS = 350; // touch: press and hold this long before a card can be dragged
const MOVE_PX = 6;

// Pointer-based drag and drop (one code path for mouse, pen and touch).
// Mouse: drag after moving a few pixels. Touch: press and hold first, so the board still scrolls.
function useCardDrag(onDrop) {
  const [drag, setDrag] = useState(null); // { w, x, y, dx, dy, width, over }
  const state = useRef(null);
  const suppressClick = useRef(false);
  const boardRef = useRef(null);
  const beginRef = useRef(null); // starts a drag; set by the effect, used by the touch hold timer

  useEffect(() => {
    const columnAt = (x, y) => document.elementFromPoint(x, y)?.closest('[data-col]')?.dataset.col || null;
    const begin = (s, x, y) => {
      s.active = true;
      navigator.vibrate?.(15);
      setDrag({ w: s.w, x, y, dx: s.dx, dy: s.dy, width: s.width, over: columnAt(x, y) });
    };
    beginRef.current = begin;
    const onMove = (e) => {
      const s = state.current;
      if (!s || e.pointerId !== s.pointerId) return;
      const moved = Math.hypot(e.clientX - s.x0, e.clientY - s.y0) > MOVE_PX;
      if (!s.active) {
        if (s.touch) { if (moved) { clearTimeout(s.timer); state.current = null; } return; } // it's a scroll
        if (!moved) return;
        begin(s, e.clientX, e.clientY);
      }
      // Scroll the board when dragging near its left/right edge.
      const b = boardRef.current?.getBoundingClientRect();
      if (b) {
        if (e.clientX < b.left + 50) boardRef.current.scrollLeft -= 14;
        else if (e.clientX > b.right - 50) boardRef.current.scrollLeft += 14;
      }
      setDrag((d) => d && { ...d, x: e.clientX, y: e.clientY, over: columnAt(e.clientX, e.clientY) });
    };
    const onUp = (e) => {
      const s = state.current;
      if (!s || e.pointerId !== s.pointerId) return;
      clearTimeout(s.timer);
      state.current = null;
      if (!s.active) return;
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 50);
      const to = e.type === 'pointercancel' ? null : columnAt(e.clientX, e.clientY);
      setDrag(null);
      if (to && to !== s.w.status) onDrop(s.w, to);
    };
    // While a touch drag is active, stop the page from scrolling.
    const onTouchMove = (e) => { if (state.current?.active) e.preventDefault(); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('touchmove', onTouchMove);
    };
  }, [onDrop]);

  const handlers = (w) => ({
    onPointerDown: (e) => {
      if (e.button !== 0 || e.target.closest('a,button')) return;
      const r = e.currentTarget.getBoundingClientRect();
      const s = {
        w, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top,
        width: r.width, touch: e.pointerType !== 'mouse', active: false,
      };
      state.current = s;
      if (s.touch) s.timer = setTimeout(() => { if (state.current === s) beginRef.current(s, s.x0, s.y0); }, HOLD_MS);
    },
    onClickCapture: (e) => { if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); } },
    onContextMenu: (e) => { if (state.current) e.preventDefault(); }, // long-press menu on phones
  });

  return { drag, handlers, boardRef };
}

export function WithdrawalCard({ w, now, ghost, ...rest }) {
  const age = now - Date.parse(w.requestedAt);
  const inStatus = now - Date.parse(w.statusSince);
  const open = isOpen(w.status);
  const lastComment = [...(w.history || [])].reverse().find((e) => e.comment)?.comment;
  return (
    <div
      className={`wcard${ghost ? ' ghost' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => navigate(`#/withdrawals/${w.id}`)}
      onKeyDown={(e) => { if (e.key === 'Enter') navigate(`#/withdrawals/${w.id}`); }}
      {...rest}
    >
      <div className="wcard-top">
        <span className="wcard-ref">{w.ref}</span>
        {open && <span className={`age a${ageLevel(age)}`} title={`Requested ${fmtDuration(age)} ago · ${fmtDuration(inStatus)} in this status`}>{fmtDuration(age)}</span>}
      </div>
      <b className="wcard-client">{w.clientName}</b>
      <div className="wcard-amt">{fmtAmount(w.amount, w.currency)}</div>
      <div className="wcard-meta">
        <span title="Account">{w.accountNo}</span>
        {w.rmName && <span title="RM">RM: {w.rmName}</span>}
      </div>
      {lastComment && <div className="wcard-note" title={lastComment}>“{lastComment}”</div>}
    </div>
  );
}

export default function Board({ rows, now, statuses, onMove }) {
  const { drag, handlers, boardRef } = useCardDrag(onMove);
  const shown = statuses ? STATUSES.filter((s) => statuses.includes(s.id)) : STATUSES;

  return (
    <>
      <div className={`board${drag ? ' dragging' : ''}`} ref={boardRef}>
        {shown.map((s) => {
          const items = rows.filter((w) => w.status === s.id);
          const total = items.reduce((m, w) => m.set(w.currency, (m.get(w.currency) || 0) + w.amount), new Map());
          return (
            <section key={s.id} className={`col${drag?.over === s.id && drag.w.status !== s.id ? ' over' : ''}`} data-col={s.id} style={{ '--c': s.color }}>
              <header className="col-head">
                <span className="col-dot" />
                <b>{s.label}</b>
                <span className="col-count">{items.length}</span>
                <small className="col-dept">{s.dept}</small>
              </header>
              {items.length > 0 && (
                <div className="col-sum">{[...total].map(([c, v]) => fmtAmount(v, c)).join(' · ')}</div>
              )}
              <div className="col-cards">
                {items.map((w) => (
                  <WithdrawalCard key={w.id} w={w} now={now} {...handlers(w)} style={drag?.w.id === w.id ? { opacity: 0.35 } : undefined} />
                ))}
                {items.length === 0 && <div className="col-empty">{drag ? 'Drop here' : 'No requests'}</div>}
              </div>
            </section>
          );
        })}
      </div>
      {drag && (
        <div className="drag-layer" style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.width }}>
          <WithdrawalCard w={drag.w} now={now} ghost />
        </div>
      )}
    </>
  );
}
