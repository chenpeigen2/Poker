import type {
  Action,
  ActionKind,
  Dossier,
  DossierStats,
  GameState,
  HandConfig,
  HandRecord,
  HandResult,
  Highlight,
  Hypothesis,
  Intent,
  LegalAction,
  Personality,
  SessionStats,
  Street,
} from '@poker/domain';
import { emptySessionStats } from '@poker/domain';
import { useCallback, useEffect, useState } from 'react';
import { applyAction, createHand, isHandOver, legalActions, settleStacks } from '@poker/engine';
import {
  addHypothesis,
  decide,
  emptyDossier,
  expressionFor,
  getPersonality,
  recordHand,
  verifyHypotheses,
} from '@poker/ai';
import { buildHighlight } from './highlight';

const STORAGE_KEY = 'duju-session-v2';
const START_STACK = 1000;
const SMALL_BLIND = 5;
const BIG_BLIND = 10;

type Phase = 'playing' | 'settled';

interface Session {
  heroStack: number;
  villainStack: number;
  handIndex: number;
  personalityId: string;
  /** 每个对手一份独立档案，切换人格不再清空读人成果 */
  dossiers: Readonly<Record<string, Dossier>>;
  stats: SessionStats;
  history: HandRecord[];
  state: GameState | null;
  lastIntent: Intent | null;
  lastLine: string;
  feedback: string;
  highlight: Highlight | null;
  recentLosses: number;
  decisionIndex: number;
  phase: Phase;
  soundOn: boolean;
}

interface SavedData {
  heroStack: number;
  villainStack: number;
  handIndex: number;
  personalityId: string;
  recentLosses: number;
  dossiers: Readonly<Record<string, Dossier>>;
  stats: SessionStats;
  history: HandRecord[];
  soundOn: boolean;
}

// ---------------------------------------------------------------------------
// localStorage：所有外部输入按 unknown 收窄，不做双重断言
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const ACTION_KINDS: readonly string[] = [
  'post-blind', 'fold', 'check', 'call', 'bet', 'raise', 'allin',
];
const STREETS: readonly string[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];

function toAction(value: unknown): Action | null {
  if (!isRecord(value)) return null;
  const seat = value.seat === 'hero' || value.seat === 'villain' ? value.seat : null;
  const kind =
    typeof value.kind === 'string' && ACTION_KINDS.includes(value.kind)
      ? (value.kind as ActionKind)
      : null;
  const street =
    typeof value.street === 'string' && STREETS.includes(value.street)
      ? (value.street as Street)
      : null;
  if (seat === null || kind === null || street === null) return null;
  return {
    seat,
    kind,
    street,
    amount: num(value.amount),
    probe: value.probe === true,
  };
}

function toHandResult(value: unknown): HandResult | null {
  if (!isRecord(value)) return null;
  const winner =
    value.winner === 'hero' || value.winner === 'villain' || value.winner === 'split'
      ? value.winner
      : null;
  if (
    winner === null ||
    typeof value.heroNet !== 'number' ||
    typeof value.showdown !== 'boolean' ||
    typeof value.reason !== 'string'
  ) {
    return null;
  }
  return {
    winner,
    heroNet: value.heroNet,
    showdown: value.showdown,
    reason: value.reason,
  };
}

function toHandRecord(value: unknown): HandRecord | null {
  if (!isRecord(value)) return null;
  const config = value.config;
  if (!isRecord(config)) return null;
  const result = toHandResult(value.result);
  if (typeof value.id !== 'string' || !Array.isArray(value.actions) || result === null) {
    return null;
  }
  const actions: Action[] = [];
  for (const item of value.actions) {
    const action = toAction(item);
    if (action !== null) actions.push(action);
  }
  const handConfig: HandConfig = {
    seed: num(config.seed),
    heroStack: num(config.heroStack),
    villainStack: num(config.villainStack),
    smallBlind: num(config.smallBlind),
    bigBlind: num(config.bigBlind),
  };
  return {
    id: value.id,
    config: handConfig,
    actions,
    result,
    heroStackAfter: num(value.heroStackAfter),
    villainStackAfter: num(value.villainStackAfter),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
    personalityId: typeof value.personalityId === 'string' ? value.personalityId : '',
  };
}

function toDossier(value: unknown, fallbackId: string): Dossier {
  if (!isRecord(value)) return emptyDossier(fallbackId);
  const statsValue = value.stats;
  if (!isRecord(statsValue) || typeof value.personalityId !== 'string') {
    return emptyDossier(fallbackId);
  }
  const stats: DossierStats = {
    hands: num(statsValue.hands),
    vpip: num(statsValue.vpip),
    foldToCbet: num(statsValue.foldToCbet),
    aggression: num(statsValue.aggression),
    riverBluffRate: num(statsValue.riverBluffRate),
    avgBetSizing: num(statsValue.avgBetSizing),
    showdownWinRate: num(statsValue.showdownWinRate),
  };
  const hypotheses: Hypothesis[] = [];
  if (Array.isArray(value.hypotheses)) {
    for (const item of value.hypotheses) {
      if (!isRecord(item)) continue;
      if (
        typeof item.id !== 'string' ||
        typeof item.label !== 'string' ||
        typeof item.node !== 'string'
      ) {
        continue;
      }
      const status =
        item.status === 'confirmed' || item.status === 'rejected'
          ? item.status
          : 'testing';
      const evidence = Array.isArray(item.evidence)
        ? item.evidence.flatMap((raw) => {
            if (!isRecord(raw)) return [];
            if (
              typeof raw.handId !== 'string' ||
              typeof raw.note !== 'string' ||
              typeof raw.hit !== 'boolean'
            ) {
              return [];
            }
            const street: Street = STREETS.includes(String(raw.street))
              ? (raw.street as Street)
              : 'preflop';
            return [{ handId: raw.handId, note: raw.note, hit: raw.hit, street }];
          })
        : [];
      hypotheses.push({
        id: item.id,
        label: item.label,
        node: item.node,
        status,
        samples: num(item.samples),
        hits: num(item.hits),
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
        evidence,
      });
    }
  }
  return {
    personalityId: value.personalityId,
    handsSeen: num(value.handsSeen),
    probesUsed: num(value.probesUsed),
    stats,
    hypotheses,
    unlocked: value.unlocked === true,
    lastFeedback:
      typeof value.lastFeedback === 'string' ? value.lastFeedback : '尚未开始观察。',
    readAccuracy: num(value.readAccuracy),
    exploitation: num(value.exploitation),
  };
}

function toSessionStats(value: unknown): SessionStats {
  if (!isRecord(value)) return emptySessionStats();
  return {
    hands: num(value.hands),
    net: num(value.net),
    wins: num(value.wins),
    losses: num(value.losses),
    probes: num(value.probes),
    probeHits: num(value.probeHits),
    bestPot: num(value.bestPot),
    bigPotsWon: num(value.bigPotsWon),
  };
}

function parseSaved(raw: string | null): SavedData {
  const fallback: SavedData = {
    heroStack: START_STACK,
    villainStack: START_STACK,
    handIndex: 0,
    personalityId: 'laochen',
    recentLosses: 0,
    dossiers: {},
    stats: emptySessionStats(),
    history: [],
    soundOn: true,
  };
  if (raw === null) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return fallback;
    const personalityId =
      typeof parsed.personalityId === 'string' ? parsed.personalityId : fallback.personalityId;

    const dossiers: Record<string, Dossier> = {};
    if (isRecord(parsed.dossiers)) {
      for (const [key, value] of Object.entries(parsed.dossiers)) {
        dossiers[key] = toDossier(value, key);
      }
    }
    // 兼容 v1 的单档案结构
    if (Object.keys(dossiers).length === 0 && isRecord(parsed.dossier)) {
      dossiers[personalityId] = toDossier(parsed.dossier, personalityId);
    }

    const history: HandRecord[] = [];
    if (Array.isArray(parsed.history)) {
      for (const item of parsed.history) {
        const record = toHandRecord(item);
        if (record !== null) history.push(record);
      }
    }
    return {
      heroStack: num(parsed.heroStack) || START_STACK,
      villainStack: num(parsed.villainStack) || START_STACK,
      handIndex: num(parsed.handIndex),
      personalityId,
      recentLosses: num(parsed.recentLosses),
      dossiers,
      stats: toSessionStats(parsed.stats),
      history,
      soundOn: parsed.soundOn !== false,
    };
  } catch {
    return fallback;
  }
}

function saveSession(session: Session): void {
  const data: SavedData = {
    heroStack: session.heroStack,
    villainStack: session.villainStack,
    handIndex: session.handIndex,
    personalityId: session.personalityId,
    recentLosses: session.recentLosses,
    dossiers: session.dossiers,
    stats: session.stats,
    history: session.history.slice(-60),
    soundOn: session.soundOn,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // 隐私模式下 localStorage 不可写，游戏仍可继续。
  }
}

// ---------------------------------------------------------------------------
// 一手牌的生命周期
// ---------------------------------------------------------------------------

function startHand(session: Session): Session {
  const config: HandConfig = {
    seed: session.handIndex * 7919 + 104729,
    heroStack: session.heroStack,
    villainStack: session.villainStack,
    smallBlind: SMALL_BLIND,
    bigBlind: BIG_BLIND,
  };
  return {
    ...session,
    state: createHand(config),
    phase: 'playing',
    decisionIndex: 0,
    lastIntent: null,
    lastLine: '',
    feedback: '',
    highlight: null,
  };
}

function activeDossier(session: Session): Dossier {
  return session.dossiers[session.personalityId] ?? emptyDossier(session.personalityId);
}

function settleIfNeeded(session: Session): Session {
  const state = session.state;
  if (state === null || !isHandOver(state) || session.phase === 'settled') return session;
  const result = state.result;
  if (result === null) return session;

  const stacks = settleStacks(state);
  const record: HandRecord = {
    id: `hand-${session.handIndex}-${session.history.length}`,
    config: state.config,
    actions: state.actions,
    result,
    heroStackAfter: stacks.hero,
    villainStackAfter: stacks.villain,
    createdAt: `hand-${session.handIndex}`,
    personalityId: session.personalityId,
  };
  const personality = getPersonality(session.personalityId);
  const before = activeDossier(session);
  let dossier = recordHand(before, record, personality);
  dossier = verifyHypotheses(dossier, record);

  const probes = record.actions.filter((action) => action.probe === true).length;
  const stats: SessionStats = {
    hands: session.stats.hands + 1,
    net: session.stats.net + result.heroNet,
    wins: session.stats.wins + (result.winner === 'hero' ? 1 : 0),
    losses: session.stats.losses + (result.winner === 'villain' ? 1 : 0),
    probes: session.stats.probes + probes,
    probeHits:
      session.stats.probeHits + (probes > 0 && result.winner === 'hero' ? 1 : 0),
    bestPot: Math.max(session.stats.bestPot, state.pot),
    bigPotsWon:
      session.stats.bigPotsWon +
      (result.winner === 'hero' && state.pot >= BIG_BLIND * 8 ? 1 : 0),
  };

  return {
    ...session,
    heroStack: stacks.hero,
    villainStack: stacks.villain,
    history: [...session.history, record],
    dossiers: { ...session.dossiers, [session.personalityId]: dossier },
    stats,
    feedback: dossier.lastFeedback,
    highlight: buildHighlight(record, probes, before.readAccuracy, dossier.readAccuracy),
    recentLosses: result.winner === 'villain' ? session.recentLosses + 1 : 0,
    phase: 'settled',
  };
}

function coachMessage(session: Session): string | null {
  const dossier = activeDossier(session);
  if (session.stats.hands === 0) {
    return '先登记一个假设，再在翻牌把动作标记为「试探」——信息是用筹码买来的。';
  }
  if (dossier.hypotheses.length === 0) {
    return '还没登记假设。写下你准备验证的判断，系统才会在每手结束时给你判定。';
  }
  if (session.stats.hands <= 2) {
    return '注意「信息泄漏」条和对手的思考时长：强牌与艰难决策会明显变慢。';
  }
  if (dossier.probesUsed === 0) {
    return '你还没试探过。check-call 或小 raise 打上「试探」标记，就能开启观察窗口。';
  }
  return null;
}

function initialSession(): Session {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem('duju-session-v1');
  } catch {
    raw = null;
  }
  const saved = parseSaved(raw);
  return startHand({
    heroStack: saved.heroStack,
    villainStack: saved.villainStack,
    handIndex: saved.handIndex,
    personalityId: saved.personalityId,
    dossiers: saved.dossiers,
    stats: saved.stats,
    history: saved.history,
    state: null,
    lastIntent: null,
    lastLine: '',
    feedback: '',
    highlight: null,
    recentLosses: saved.recentLosses,
    decisionIndex: 0,
    phase: 'playing',
    soundOn: saved.soundOn,
  });
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface GameApi {
  state: GameState | null;
  legal: readonly LegalAction[];
  personality: Personality;
  dossier: Dossier;
  allDossiers: readonly Dossier[];
  stats: SessionStats;
  history: readonly HandRecord[];
  handIndex: number;
  heroStack: number;
  villainStack: number;
  lastIntent: Intent | null;
  lastLine: string;
  feedback: string;
  highlight: Highlight | null;
  coach: string | null;
  thinking: boolean;
  phase: Phase;
  soundOn: boolean;
  act: (kind: ActionKind, amount: number, probe: boolean) => void;
  nextHand: () => void;
  setPersonality: (id: string) => void;
  registerHypothesis: (label: string, node: string) => void;
  toggleSound: () => void;
  reset: () => void;
}

export function useGame(): GameApi {
  const [session, setSession] = useState<Session>(initialSession);

  const personality = getPersonality(session.personalityId);
  const state = session.state;
  const thinking = state !== null && !isHandOver(state) && state.toAct === 'villain';
  const legal = state !== null && !isHandOver(state) ? legalActions(state) : [];
  const dossier = activeDossier(session);

  // AI 回合：延时由 Intent.timingMs 决定，把「行动节奏」做成可观察的物理 tell。
  useEffect(() => {
    const current = session.state;
    if (current === null || isHandOver(current) || current.toAct !== 'villain') return;
    const bot = getPersonality(session.personalityId);
    const intent = decide(current, bot, {
      handIndex: session.handIndex,
      decisionIndex: session.decisionIndex,
      recentLosses: session.recentLosses,
      seed: current.config.seed,
    });
    const line = expressionFor(intent, bot);
    const delay = Math.min(2200, Math.max(180, intent.timingMs));
    const timer = window.setTimeout(() => {
      setSession((prev) => {
        if (prev.state !== current) return prev;
        const next = applyAction(prev.state, intent.action);
        return settleIfNeeded({
          ...prev,
          state: next,
          lastIntent: intent,
          lastLine: line,
          decisionIndex: prev.decisionIndex + 1,
        });
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [
    session.state,
    session.personalityId,
    session.handIndex,
    session.decisionIndex,
    session.recentLosses,
  ]);

  useEffect(() => {
    saveSession(session);
  }, [
    session.heroStack,
    session.villainStack,
    session.handIndex,
    session.personalityId,
    session.recentLosses,
    session.dossiers,
    session.stats,
    session.history,
    session.soundOn,
  ]);

  const act = useCallback((kind: ActionKind, amount: number, probe: boolean) => {
    setSession((prev) => {
      const current = prev.state;
      if (
        current === null ||
        prev.phase === 'settled' ||
        isHandOver(current) ||
        current.toAct !== 'hero'
      ) {
        return prev;
      }
      const legalMove = legalActions(current).find((candidate) => candidate.kind === kind);
      if (legalMove === undefined) return prev;
      const clamped = Math.round(Math.min(Math.max(amount, legalMove.min), legalMove.max));
      const action: Action = {
        seat: 'hero',
        kind,
        amount: clamped,
        street: current.street,
        probe,
      };
      return settleIfNeeded({
        ...prev,
        state: applyAction(current, action),
        decisionIndex: prev.decisionIndex + 1,
        feedback: '',
      });
    });
  }, []);

  const nextHand = useCallback(() => {
    setSession((prev) => {
      // 任一方破产时，双方一起回到等额买入，保持「读人」样本可比。
      const busted = prev.heroStack < BIG_BLIND || prev.villainStack < BIG_BLIND;
      return startHand({
        ...prev,
        heroStack: busted ? START_STACK : prev.heroStack,
        villainStack: busted ? START_STACK : prev.villainStack,
        handIndex: prev.handIndex + 1,
      });
    });
  }, []);

  const setPersonality = useCallback((id: string) => {
    setSession((prev) =>
      startHand({
        ...prev,
        personalityId: id,
        // 档案按对手独立保存：切换人格不清空已读出的破绽，且预建空档案便于进度展示。
        dossiers: {
          ...prev.dossiers,
          [id]: prev.dossiers[id] ?? emptyDossier(id),
        },
      }),
    );
  }, []);

  const registerHypothesis = useCallback((label: string, node: string) => {
    setSession((prev) => {
      const current = activeDossier(prev);
      return {
        ...prev,
        dossiers: {
          ...prev.dossiers,
          [prev.personalityId]: addHypothesis(current, label, node),
        },
      };
    });
  }, []);

  const toggleSound = useCallback(() => {
    setSession((prev) => ({ ...prev, soundOn: !prev.soundOn }));
  }, []);

  const reset = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem('duju-session-v1');
    } catch {
      // 忽略
    }
    setSession(
      startHand({
        heroStack: START_STACK,
        villainStack: START_STACK,
        handIndex: 0,
        personalityId: 'laochen',
        dossiers: {},
        stats: emptySessionStats(),
        history: [],
        state: null,
        lastIntent: null,
        lastLine: '',
        feedback: '',
        highlight: null,
        recentLosses: 0,
        decisionIndex: 0,
        phase: 'playing',
        soundOn: true,
      }),
    );
  }, []);

  return {
    state,
    legal,
    personality,
    dossier,
    allDossiers: Object.values(session.dossiers),
    stats: session.stats,
    history: session.history,
    handIndex: session.handIndex,
    heroStack: session.heroStack,
    villainStack: session.villainStack,
    lastIntent: session.lastIntent,
    lastLine: session.lastLine,
    feedback: session.feedback,
    highlight: session.highlight,
    coach: session.phase === 'playing' ? coachMessage(session) : null,
    thinking,
    phase: session.phase,
    soundOn: session.soundOn,
    act,
    nextHand,
    setPersonality,
    registerHypothesis,
    toggleSound,
    reset,
  };
}
