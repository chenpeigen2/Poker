import type { HandRecord, SessionStats } from '@poker/domain';

interface InsightPanelProps {
  history: readonly HandRecord[];
  stats: SessionStats;
}

interface Point {
  aggression: number;
  folded: number;
  net: number;
}

function toSeries(records: readonly HandRecord[]): Point[] {
  return records.map((record) => {
    const villain = record.actions.filter(
      (action) => action.seat === 'villain' && action.kind !== 'post-blind',
    );
    const aggressive = villain.filter(
      (action) => action.kind === 'bet' || action.kind === 'raise' || action.kind === 'allin',
    ).length;
    return {
      aggression: villain.length === 0 ? 0 : aggressive / villain.length,
      folded: villain.some(
        (action) => action.street === 'flop' && action.kind === 'fold',
      )
        ? 1
        : 0,
      net: record.result.heroNet,
    };
  });
}

function polyline(points: Point[], pick: (point: Point) => number): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const y = 86 - pick(points[0]!) * 70;
    return `8,${y} 312,${y}`;
  }
  return points
    .map((point, index) => {
      const x = 8 + (index / (points.length - 1)) * 304;
      const y = 86 - pick(point) * 70;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export function InsightPanel({ history, stats }: InsightPanelProps): React.JSX.Element {
  const points = toSeries(history.slice(-24));
  const probeRate = stats.probes === 0 ? 0 : stats.probeHits / stats.probes;

  const cells: readonly { label: string; value: string; tone?: 'up' | 'down' }[] = [
    { label: '总手数', value: String(stats.hands) },
    {
      label: '净收益',
      value: `${stats.net >= 0 ? '+' : ''}${stats.net}`,
      tone: stats.net >= 0 ? 'up' : 'down',
    },
    { label: '胜 / 负', value: `${stats.wins} / ${stats.losses}` },
    { label: '试探次数', value: String(stats.probes) },
    { label: '试探命中率', value: `${Math.round(probeRate * 100)}%` },
    { label: '最大底池', value: String(stats.bestPot) },
    { label: '大底池胜场', value: String(stats.bigPotsWon) },
    {
      label: '读人转化',
      value: stats.probes === 0 ? '—' : `${Math.round(probeRate * 100)}%`,
    },
  ];

  return (
    <section className="insight">
      <div className="panel-head">
        <h2>行为时间轴</h2>
        <span className="muted">最近 {points.length} 手</span>
      </div>

      <div className="chart-wrap">
        <svg viewBox="0 0 320 96" preserveAspectRatio="none" role="img" aria-label="对手侵略性与翻牌弃牌趋势">
          {[0.25, 0.5, 0.75].map((ratio) => (
            <line
              key={ratio}
              x1={8}
              x2={312}
              y1={86 - ratio * 70}
              y2={86 - ratio * 70}
              stroke="#274038"
              strokeWidth={1}
            />
          ))}
          <polyline points={polyline(points, (p) => p.aggression)} fill="none" stroke="#c9a227" strokeWidth={2.2} />
          <polyline points={polyline(points, (p) => p.folded)} fill="none" stroke="#b9625b" strokeWidth={1.8} strokeDasharray="4 3" />
          {points.map((point, index) => {
            const x = points.length === 1 ? 8 : 8 + (index / (points.length - 1)) * 304;
            const y = 86 - point.aggression * 70;
            return <circle key={index} cx={x} cy={y} r={2.4} fill={point.net > 0 ? '#7fd6a5' : '#e08c84'} />;
          })}
        </svg>
        <div className="chart-legend">
          <span><i className="legend-line gold" /> 侵略性</span>
          <span><i className="legend-line red" /> 翻牌弃牌</span>
          <span><i className="legend-dot" /> 你赢下该手</span>
        </div>
      </div>

      <div className="panel-head sub">
        <h3>会话战绩</h3>
        <span className="muted">跨对手累计</span>
      </div>
      <div className="session-grid">
        {cells.map((cell) => (
          <div key={cell.label} className="session-cell">
            <span className="muted">{cell.label}</span>
            <strong className={cell.tone === 'up' ? 'win-text' : cell.tone === 'down' ? 'lose-text' : ''}>
              {cell.value}
            </strong>
          </div>
        ))}
      </div>
    </section>
  );
}
