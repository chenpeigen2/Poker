import type { HandRecord } from '@poker/domain';
import { SEAT_LABELS, STREET_LABELS, cardLabel } from '@poker/domain';
import { replay } from '@poker/engine';

const ACTION_LABELS: Readonly<Record<string, string>> = {
  'post-blind': '盲注',
  fold: '弃牌',
  check: '过牌',
  call: '跟注',
  bet: '下注',
  raise: '加注',
  allin: '全下',
};

interface ReplayViewProps {
  history: readonly HandRecord[];
  selected: number;
  step: number;
  active: boolean;
  onSelect: (index: number) => void;
  onStep: (value: number) => void;
  onToggleActive: () => void;
}

export function ReplayView({
  history,
  selected,
  step,
  active,
  onSelect,
  onStep,
  onToggleActive,
}: ReplayViewProps): React.JSX.Element {
  const hand = history[history.length - 1 - selected];
  const total = hand?.actions.length ?? 0;
  const safeStep = Math.min(step, total);
  const partial = hand === undefined ? null : replay(hand.config, hand.actions.slice(0, safeStep));
  const visibleActions = hand?.actions.slice(0, safeStep) ?? [];

  return (
    <section className="replay">
      <div className="panel-head">
        <h2>复盘</h2>
        <div className="replay-controls">
          <span className="muted">共 {history.length} 手记录</span>
          {history.length > 0 && (
            <button
              type="button"
              className={active ? 'replay-toggle active' : 'replay-toggle'}
              onClick={onToggleActive}
            >
              {active ? '返回实时牌局' : '在 3D 牌桌上重演'}
            </button>
          )}
        </div>
      </div>

      {history.length === 0 ? (
        <p className="muted">打完第一手后，这里会逐步回放每一步决策。</p>
      ) : (
        <>
          <div className="hand-picker">
            {history.slice(-12).reverse().map((record, index) => (
              <button
                key={record.id}
                type="button"
                className={index === selected ? 'active' : ''}
                onClick={() => onSelect(index)}
              >
                第 {history.length - index} 手
              </button>
            ))}
          </div>

          <div className="replay-scrub">
            <input
              type="range"
              min={0}
              max={total}
              value={safeStep}
              aria-label="复盘步进"
              onChange={(event) => onStep(Number(event.target.value))}
            />
            <button type="button" onClick={() => onStep(Math.max(0, safeStep - 1))}>←</button>
            <button type="button" onClick={() => onStep(Math.min(total, safeStep + 1))}>→</button>
            <span className="muted">{safeStep} / {total} 步</span>
            <span className="muted">← → 键可逐步，Esc 返回实时</span>
          </div>

          {partial !== null && (
            <div className="replay-state">
              <span className="street-tag">{STREET_LABELS[partial.street]}</span>
              <span>底池 <strong>{partial.pot}</strong></span>
              <span className="muted">
                公共牌 {partial.board.map(cardLabel).join(' ') || '—'}
              </span>
              {partial.result !== null && (
                <span className={partial.result.heroNet >= 0 ? 'win-text' : 'lose-text'}>
                  {partial.result.reason}（{partial.result.heroNet >= 0 ? '+' : ''}{partial.result.heroNet}）
                </span>
              )}
            </div>
          )}

          <ol className="action-log">
            {visibleActions.map((action, index) => (
              <li key={index} className={action.kind === 'post-blind' ? 'blind' : ''}>
                <span className="muted">{STREET_LABELS[action.street]}</span>
                <strong>{SEAT_LABELS[action.seat]}</strong>
                {ACTION_LABELS[action.kind] ?? action.kind}
                {action.amount > 0 ? ` ${action.amount}` : ''}
                {action.probe === true && <span className="probe-tag">试探</span>}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
