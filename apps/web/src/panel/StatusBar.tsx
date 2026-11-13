import type { GameState, Highlight, Intent, Personality, SessionStats } from '@poker/domain';
import { STREET_LABELS, cardLabel } from '@poker/domain';

interface StatusBarProps {
  state: GameState | null;
  personality: Personality;
  line: string;
  intent: Intent | null;
  feedback: string;
  coach: string | null;
  highlight: Highlight | null;
  handIndex: number;
  thinking: boolean;
  heroStack: number;
  villainStack: number;
  phase: 'playing' | 'settled';
  stats: SessionStats;
  soundOn: boolean;
  onToggleSound: () => void;
}

const INTENT_LABELS: Readonly<Record<string, string>> = {
  value: '价值下注',
  bluff: '诈唬',
  probe: '试探',
  'pot-control': '控池',
  defense: '防守',
  tilt: '缩手',
  trap: '设陷',
};

export function StatusBar({
  state,
  personality,
  line,
  intent,
  feedback,
  coach,
  highlight,
  handIndex,
  thinking,
  heroStack,
  villainStack,
  phase,
  stats,
  soundOn,
  onToggleSound,
}: StatusBarProps): React.JSX.Element {
  const street = state?.street ?? 'preflop';
  const pot = state?.pot ?? 0;
  const board = state?.board ?? [];
  const result = state?.result ?? null;
  const tell = intent?.tellLevel ?? 0;
  const baseline = personality.params.thinkTimeMs;
  const timing = intent?.timingMs ?? 0;
  const timingDelta = baseline === 0 ? 0 : (timing - baseline) / baseline;

  return (
    <div className="status-bar">
      <div className="status-row">
        <span className="chip-label">第 {handIndex + 1} 手</span>
        <span className="street-tag">{STREET_LABELS[street]}</span>
        <span className="pot">底池 <strong>{pot}</strong></span>
        <span className="stack">你的筹码 <strong>{heroStack}</strong></span>
        <span className="stack">对手筹码 <strong>{villainStack}</strong></span>
        <span className={`session-net ${stats.net >= 0 ? 'win-text' : 'lose-text'}`}>
          总净收益 {stats.net >= 0 ? '+' : ''}{stats.net}
        </span>
        <button type="button" className="sound-btn" onClick={onToggleSound} aria-label="切换音效">
          {soundOn ? '♪ 音效开' : '♪ 音效关'}
        </button>
      </div>

      <div className="board-row">
        <span className="muted">公共牌</span>
        {board.length === 0 ? (
          <span className="muted">尚未发出</span>
        ) : (
          board.map((card, index) => (
            <span key={index} className="playing-card">{cardLabel(card)}</span>
          ))
        )}
      </div>

      <div className="opponent-line">
        <span className="avatar-dot" style={{ background: personality.avatarColor }} />
        <strong>{personality.name}</strong>
        <span className={thinking ? 'thinking' : ''}>
          {thinking ? '正在思考…' : line || '……'}
        </span>
        {intent !== null && (
          <span className="timing-read">
            思考 {(timing / 1000).toFixed(1)}s
            <em className={timingDelta > 0.12 ? 'slower' : timingDelta < -0.12 ? 'faster' : ''}>
              {timingDelta > 0.12 ? '偏慢 · 可能在犹豫' : timingDelta < -0.12 ? '偏快 · 果断' : '平常节奏'}
            </em>
          </span>
        )}
      </div>

      <div className="tell-row">
        <span className="muted">信息泄漏</span>
        <div className="tell-track">
          <div className="tell-fill" style={{ width: `${Math.round(tell * 100)}%` }} />
        </div>
        <span className="muted">
          {intent === null
            ? '—'
            : `${INTENT_LABELS[intent.intent] ?? intent.intent} · ${Math.round(tell * 100)}%`}
        </span>
      </div>

      {coach !== null && phase === 'playing' && (
        <div className="coach-banner">💡 {coach}</div>
      )}

      {highlight !== null && (
        <div className={`highlight-banner ${highlight.net >= 0 ? 'positive' : 'negative'}`}>
          <strong>{highlight.title}</strong>　{highlight.detail}
        </div>
      )}

      {result !== null && phase === 'settled' && (
        <div className={`result-banner ${result.heroNet >= 0 ? 'win' : 'lose'}`}>
          {result.reason}　净收益 <strong>{result.heroNet >= 0 ? '+' : ''}{result.heroNet}</strong>
        </div>
      )}
      {feedback !== '' && <div className="feedback-banner">{feedback}</div>}
    </div>
  );
}
