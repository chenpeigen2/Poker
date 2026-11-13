import type { ActionKind, LegalAction } from '@poker/domain';

interface ActionBarProps {
  legal: readonly LegalAction[];
  disabled: boolean;
  size: number;
  probe: boolean;
  onSizeChange: (value: number) => void;
  onProbeChange: (value: boolean) => void;
  onAct: (kind: ActionKind, amount: number, probe: boolean) => void;
}

const LABELS: Readonly<Record<ActionKind, string>> = {
  'post-blind': '盲注',
  fold: '弃牌',
  check: '过牌',
  call: '跟注',
  bet: '下注',
  raise: '加注',
  allin: '全下',
};

const SHORTCUTS: Readonly<Partial<Record<ActionKind, string>>> = {
  fold: 'F',
  check: 'K',
  call: 'C',
  bet: 'B',
  raise: 'R',
  allin: 'A',
};

export function ActionBar({
  legal,
  disabled,
  size,
  probe,
  onSizeChange,
  onProbeChange,
  onAct,
}: ActionBarProps): React.JSX.Element {
  const sizing = legal.find(
    (action) => action.kind === 'bet' || action.kind === 'raise',
  );
  const clampedSize =
    sizing === undefined ? size : Math.min(Math.max(size, sizing.min), sizing.max);

  const submit = (action: LegalAction): void => {
    const amount =
      action.kind === 'call'
        ? action.min
        : action.kind === 'allin'
          ? action.max
          : action.kind === 'bet' || action.kind === 'raise'
            ? clampedSize
            : 0;
    onAct(action.kind, amount, probe);
  };

  return (
    <div className="action-bar">
      <div className="action-buttons">
        {legal.length === 0 && <span className="muted">等待对手行动…</span>}
        {legal.map((action) => (
          <button
            key={action.kind}
            type="button"
            className={`action-btn action-${action.kind}`}
            disabled={disabled}
            aria-label={`${LABELS[action.kind]}${SHORTCUTS[action.kind] === undefined ? '' : `（快捷键 ${SHORTCUTS[action.kind]}）`}`}
            onClick={() => submit(action)}
          >
            {LABELS[action.kind]}
            {action.kind === 'call' && action.min > 0 ? ` ${action.min}` : ''}
            {action.kind === 'allin' ? ` ${action.max}` : ''}
            {SHORTCUTS[action.kind] !== undefined && (
              <kbd>{SHORTCUTS[action.kind]}</kbd>
            )}
          </button>
        ))}
      </div>

      {sizing !== undefined && (
        <div className="sizing-row">
          <span className="muted">注额</span>
          <input
            type="range"
            min={sizing.min}
            max={sizing.max}
            value={clampedSize}
            disabled={disabled}
            aria-label="下注或加注金额"
            onChange={(event) => onSizeChange(Number(event.target.value))}
          />
          <input
            type="number"
            min={sizing.min}
            max={sizing.max}
            value={clampedSize}
            disabled={disabled}
            aria-label="下注或加注金额（数字输入）"
            onChange={(event) => onSizeChange(Number(event.target.value))}
          />
          <span className="muted">{sizing.min} – {sizing.max}</span>
        </div>
      )}

      <label className="probe-toggle">
        <input
          type="checkbox"
          checked={probe}
          disabled={disabled}
          onChange={(event) => onProbeChange(event.target.checked)}
        />
        标记为「试探」——花筹码买一个信息（快捷键 P）
      </label>
    </div>
  );
}
