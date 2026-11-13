import type { Dossier, Hypothesis, Personality } from '@poker/domain';
import { STREET_LABELS } from '@poker/domain';
import {
  exploitIndex,
  HYPOTHESIS_TEMPLATES,
  PERSONALITIES,
  UNLOCK_AT,
} from '@poker/ai';
import { useState } from 'react';

interface DossierPanelProps {
  dossier: Dossier;
  personality: Personality;
  allDossiers: readonly Dossier[];
  onPersonalityChange: (id: string) => void;
  onAddHypothesis: (label: string, node: string) => void;
  onReset: () => void;
}

const STATUS_LABELS: Readonly<Record<string, string>> = {
  testing: '验证中',
  confirmed: '成立',
  rejected: '不成立',
};

function EvidenceList({ hypothesis }: { hypothesis: Hypothesis }): React.JSX.Element {
  if (hypothesis.evidence.length === 0) {
    return <p className="muted evidence-empty">还没有观察样本。用试探制造证据。</p>;
  }
  return (
    <ul className="evidence-list">
      {hypothesis.evidence.slice(-8).reverse().map((sample, index) => (
        <li key={`${sample.handId}-${index}`}>
          <span className={sample.hit ? 'hit' : 'miss'}>{sample.hit ? '✓' : '✕'}</span>
          <span className="muted">{STREET_LABELS[sample.street]}</span>
          <span>{sample.note}</span>
        </li>
      ))}
    </ul>
  );
}

export function DossierPanel({
  dossier,
  personality,
  allDossiers,
  onPersonalityChange,
  onAddHypothesis,
  onReset,
}: DossierPanelProps): React.JSX.Element {
  const [templateIndex, setTemplateIndex] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const remaining = Math.max(0, UNLOCK_AT - dossier.handsSeen);
  const template = HYPOTHESIS_TEMPLATES[templateIndex] ?? HYPOTHESIS_TEMPLATES[0]!;

  const metrics: readonly { label: string; value: string }[] = [
    { label: '入池率 VPIP', value: `${Math.round(dossier.stats.vpip * 100)}%` },
    { label: '弃牌于 c-bet', value: `${Math.round(dossier.stats.foldToCbet * 100)}%` },
    { label: '侵略性', value: `${Math.round(dossier.stats.aggression * 100)}%` },
    { label: '河牌下注率', value: `${Math.round(dossier.stats.riverBluffRate * 100)}%` },
  ];

  return (
    <aside className="dossier">
      <div className="panel-head">
        <h2>对手档案</h2>
        <span className="muted">已观察 {dossier.handsSeen} 手</span>
      </div>

      <label className="field">
        对手
        <select
          value={personality.id}
          onChange={(event) => onPersonalityChange(event.target.value)}
        >
          {PERSONALITIES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.title}
            </option>
          ))}
        </select>
      </label>

      <p className="blurb">{personality.blurb}</p>
      <div className="tell-list">
        {personality.knownTells.map((tell) => (
          <span key={tell} className="tell-tag">{tell}</span>
        ))}
      </div>

      <div className="read-score">
        <div>
          <span className="muted">可利用性</span>
          <strong>{Math.round(exploitIndex(personality) * 100)}</strong>
        </div>
        <div>
          <span className="muted">读人准确率</span>
          <strong>{Math.round(dossier.readAccuracy * 100)}%</strong>
        </div>
        <div>
          <span className="muted">施压收益</span>
          <strong className={dossier.exploitation >= 0 ? 'win-text' : 'lose-text'}>
            {dossier.exploitation >= 0 ? '+' : ''}{dossier.exploitation}
          </strong>
        </div>
      </div>

      {dossier.lastFeedback !== '' && dossier.lastFeedback !== '尚未开始观察。' && (
        <div className="verdict">{dossier.lastFeedback}</div>
      )}

      {!dossier.unlocked ? (
        <div className="locked">
          还需 <strong>{remaining}</strong> 手才能解锁档案卡。
          <p className="muted">先提出假设，再用试探去验证它。</p>
        </div>
      ) : (
        <div className="metrics">
          {metrics.map((metric) => (
            <div key={metric.label} className="metric">
              <span className="muted">{metric.label}</span>
              <strong>{metric.value}</strong>
            </div>
          ))}
        </div>
      )}

      {allDossiers.length > 1 && (
        <div className="other-dossiers">
          <span className="muted">其他对手的观察进度</span>
          {allDossiers
            .filter((item) => item.personalityId !== personality.id)
            .map((item) => {
              const other = PERSONALITIES.find((p) => p.id === item.personalityId);
              return (
                <div key={item.personalityId} className="mini-dossier">
                  <span>{other?.name ?? item.personalityId}</span>
                  <span className="muted">{item.handsSeen} 手 · {item.hypotheses.length} 个假设</span>
                </div>
              );
            })}
        </div>
      )}

      <div className="panel-head sub">
        <h3>假设登记</h3>
        <span className="muted">试探次数 {dossier.probesUsed}</span>
      </div>
      <div className="hypothesis-add">
        <select
          value={templateIndex}
          onChange={(event) => setTemplateIndex(Number(event.target.value))}
          aria-label="选择假设模板"
        >
          {HYPOTHESIS_TEMPLATES.map((item, index) => (
            <option key={item.node} value={index}>{item.label}</option>
          ))}
        </select>
        <button type="button" onClick={() => onAddHypothesis(template.label, template.node)}>
          登记
        </button>
      </div>

      <ul className="hypothesis-list">
        {dossier.hypotheses.length === 0 && (
          <li className="muted">还没有假设。先写下你准备验证的判断。</li>
        )}
        {dossier.hypotheses.map((hypothesis) => (
          <li key={hypothesis.id} className="hypothesis-item">
            <button
              type="button"
              className="hypothesis-head"
              onClick={() => setExpanded(expanded === hypothesis.id ? null : hypothesis.id)}
              aria-expanded={expanded === hypothesis.id}
            >
              <span className={`status status-${hypothesis.status}`}>
                {STATUS_LABELS[hypothesis.status] ?? hypothesis.status}
              </span>
              <span className="hypothesis-text">{hypothesis.label}</span>
              <span className="muted">{hypothesis.hits}/{hypothesis.samples}</span>
              <span className="expand-mark">{expanded === hypothesis.id ? '−' : '+'}</span>
            </button>
            {expanded === hypothesis.id && <EvidenceList hypothesis={hypothesis} />}
          </li>
        ))}
      </ul>

      <button type="button" className="reset-btn" onClick={onReset}>
        重置牌局与档案
      </button>
    </aside>
  );
}
