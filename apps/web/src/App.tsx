import type { ActionKind, Street } from '@poker/domain';
import { replay } from '@poker/engine';
import { getPersonality } from '@poker/ai';
import { useEffect, useRef, useState } from 'react';
import { playSound } from './audio/sound';
import { useGame } from './game/useGame';
import { ActionBar } from './panel/ActionBar';
import { DossierPanel } from './panel/DossierPanel';
import { InsightPanel } from './panel/InsightPanel';
import { StatusBar } from './panel/StatusBar';
import { ReplayView } from './replay/ReplayView';
import { PokerTable } from './table/PokerTable';

const KEY_ACTIONS: Readonly<Record<string, ActionKind>> = {
  f: 'fold',
  c: 'call',
  k: 'check',
  b: 'bet',
  r: 'raise',
  a: 'allin',
};

export function App(): React.JSX.Element {
  const game = useGame();
  const [size, setSize] = useState(0);
  const [probe, setProbe] = useState(false);
  const [replayActive, setReplayActive] = useState(false);
  const [selected, setSelected] = useState(0);
  // 默认停在最后一步；ReplayView 与此处都用 min(step, total) 收敛。
  const [step, setStep] = useState(Number.MAX_SAFE_INTEGER);

  const playerTurn =
    game.state !== null && game.phase === 'playing' && game.state.toAct === 'hero';
  const replayHand = game.history[game.history.length - 1 - selected];
  const total = replayHand?.actions.length ?? 0;
  const safeStep = Math.min(step, total);
  const replayState =
    replayActive && replayHand !== undefined
      ? replay(replayHand.config, replayHand.actions.slice(0, safeStep))
      : null;
  const displayState = replayActive ? replayState : game.state;
  const tablePersonality = replayActive && replayHand !== undefined
    ? getPersonality(replayHand.personalityId)
    : game.personality;

  // 音效：街次推进 / 筹码入池 / 本手结算 / 新一手发牌。
  const previousStreet = useRef<Street | undefined>(undefined);
  const previousPot = useRef(0);
  const previousPhase = useRef<'playing' | 'settled'>('playing');
  const previousHand = useRef(game.handIndex);

  useEffect(() => {
    const street = game.state?.street;
    if (street !== undefined && previousStreet.current !== undefined && street !== previousStreet.current) {
      playSound('flip', game.soundOn);
    }
    previousStreet.current = street;
  }, [game.state?.street, game.soundOn]);

  useEffect(() => {
    const pot = game.state?.pot ?? 0;
    if (pot > previousPot.current) playSound('chip', game.soundOn);
    previousPot.current = pot;
  }, [game.state?.pot, game.soundOn]);

  useEffect(() => {
    if (game.phase === 'settled' && previousPhase.current === 'playing') {
      playSound((game.state?.result?.heroNet ?? 0) >= 0 ? 'win' : 'lose', game.soundOn);
    }
    previousPhase.current = game.phase;
  }, [game.phase, game.state?.result?.heroNet, game.soundOn]);

  useEffect(() => {
    if (game.handIndex !== previousHand.current) {
      playSound('deal', game.soundOn);
      previousHand.current = game.handIndex;
    }
  }, [game.handIndex, game.soundOn]);

  // 切换复盘手牌时定位到最后一步。
  useEffect(() => {
    if (replayActive) setStep(total);
  }, [selected, replayActive, total]);

  // 键盘：实时牌局的动作快捷键 + 复盘逐步。
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (replayActive) {
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          setStep((current) => Math.min(total, current + 1));
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          setStep((current) => Math.max(0, current - 1));
        } else if (event.key === 'Escape') {
          setReplayActive(false);
        }
        return;
      }
      if (!playerTurn) return;
      const key = event.key.toLowerCase();
      if (key === 'p') {
        setProbe((current) => !current);
        return;
      }
      const kind = KEY_ACTIONS[key];
      if (kind === undefined) return;
      const legal = game.legal.find((candidate) => candidate.kind === kind);
      if (legal === undefined) return;
      const amount =
        kind === 'call'
          ? legal.min
          : kind === 'allin'
            ? legal.max
            : kind === 'fold' || kind === 'check'
              ? 0
              : Math.min(Math.max(size, legal.min), legal.max);
      game.act(kind, amount, probe);
      setProbe(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [replayActive, total, playerTurn, game.legal, game.act, size, probe]);

  const toggleReplay = (): void => {
    if (!replayActive) setStep(total);
    setReplayActive((current) => !current);
  };

  // 试探是「一次动作」的标记，提交后自动复位，避免后续动作被误记。
  const handleAct = (kind: ActionKind, amount: number, probeFlag: boolean): void => {
    game.act(kind, amount, probeFlag);
    setProbe(false);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">读局</span>
          <span className="brand-sub">READ THE ROOM</span>
        </div>
        <p className="tagline">他不是随机数，他有破绽。读出来，然后施压。</p>
        <div className="topbar-meta">
          <span>第 {game.handIndex + 1} 手</span>
          <span className={game.stats.net >= 0 ? 'win-text' : 'lose-text'}>
            净收益 {game.stats.net >= 0 ? '+' : ''}{game.stats.net}
          </span>
        </div>
      </header>

      <main className="layout">
        <section className="table-column">
          {replayActive && (
            <div className="replay-banner">
              复盘模式 · 第 {game.history.length - selected} 手 · 第 {safeStep}/{total} 步
              <span className="muted">（← → 逐步，Esc 返回实时）</span>
            </div>
          )}
          <div className="table-canvas">
            <PokerTable
              state={displayState}
              personality={tablePersonality}
              thinking={game.thinking && !replayActive}
              replayMode={replayActive}
            />
          </div>

          <StatusBar
            state={game.state}
            personality={game.personality}
            line={game.lastLine}
            intent={game.lastIntent}
            feedback={game.feedback}
            coach={game.coach}
            highlight={game.highlight}
            handIndex={game.handIndex}
            thinking={game.thinking}
            heroStack={game.heroStack}
            villainStack={game.villainStack}
            phase={game.phase}
            stats={game.stats}
            soundOn={game.soundOn}
            onToggleSound={game.toggleSound}
          />

          <ActionBar
            legal={playerTurn && !replayActive ? game.legal : []}
            disabled={!playerTurn || replayActive}
            size={size}
            probe={probe}
            onSizeChange={setSize}
            onProbeChange={setProbe}
            onAct={handleAct}
          />

          <div className="next-hand">
            {replayActive ? (
              <span className="muted">正在重演历史牌局，动作栏已停用。</span>
            ) : game.phase === 'settled' ? (
              <button type="button" className="primary-btn" onClick={game.nextHand}>
                下一手 →
              </button>
            ) : (
              <span className="muted">
                {playerTurn
                  ? '轮到你：选择动作，或把它标记为试探（快捷键 F/K/C/B/R/A/P）'
                  : '对手正在行动…'}
              </span>
            )}
          </div>
        </section>

        <DossierPanel
          dossier={game.dossier}
          personality={game.personality}
          allDossiers={game.allDossiers}
          onPersonalityChange={game.setPersonality}
          onAddHypothesis={game.registerHypothesis}
          onReset={game.reset}
        />
      </main>

      <div className="bottom-row">
        <InsightPanel history={game.history} stats={game.stats} />
        <ReplayView
          history={game.history}
          selected={selected}
          step={step}
          active={replayActive}
          onSelect={setSelected}
          onStep={setStep}
          onToggleActive={toggleReplay}
        />
      </div>

      <footer className="footer">
        单挑无限注现金局 · 全部数据仅存本地 · 零网络请求即可完整可玩
      </footer>
    </div>
  );
}
