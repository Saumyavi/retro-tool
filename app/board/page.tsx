'use client';

import {
  useState, useEffect, useRef, useMemo, useCallback,
  createContext, useContext, Suspense,
} from 'react';
import { useSearchParams } from 'next/navigation';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

// ── Design tokens ─────────────────────────────────────────────────────────────
const PALETTE = {
  paper: '#FFF8EC', ink: '#1F1B2E', mute: '#6B6478',
  line: 'rgba(31,27,46,.10)',
  phases: {
    wentWell: { hero: '#FFD56B', sticky: '#FFE08A', soft: '#FFF1C8', ink: '#5B4408' },
    continue:  { hero: '#8FD86A', sticky: '#B6E89A', soft: '#DDF3CB', ink: '#1F4D14' },
    improve:   { hero: '#FF8FA3', sticky: '#FFB1BE', soft: '#FFD6DE', ink: '#6B1027' },
    actions:   { hero: '#6FB1FF', sticky: '#A4CBFF', soft: '#D7E6FF', ink: '#0E3B7A' },
  },
} as const;

type PhaseId = 'wentWell' | 'continue' | 'improve' | 'actions';

const PHASES: { id: PhaseId; title: string; prompt: string }[] = [
  { id: 'wentWell', title: 'Went well',      prompt: 'What worked this sprint? What gave the team energy?' },
  { id: 'continue', title: 'Continue doing', prompt: 'Habits or rituals worth protecting.' },
  { id: 'improve',  title: 'To improve',     prompt: "Friction, anti-patterns — what's bugging you?" },
  { id: 'actions',  title: 'Action items',   prompt: 'Concrete things — who, what, by when.' },
];

const PHASE_IDX = Object.fromEntries(PHASES.map((p, i) => [p.id, i])) as Record<PhaseId, number>;

const CARD_SHAPE = { radius: 10, tiltMax: 0, shadow: '0 2px 6px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.05)' };

const PLACEHOLDERS: Record<PhaseId, [string, string]> = {
  wentWell: ['Add a win…',           'A small thing that made you smile?'],
  continue:  ['Keep doing…',          'A habit worth protecting?'],
  improve:   ['Add a friction point…', "Something that's been bugging you?"],
  actions:   ['Add an action item…',   'Who owns it? When is it done?'],
};

const FF = {
  bricolage: 'var(--ff-bricolage)',
  schibsted:  'var(--ff-schibsted)',
  caveat:    'var(--ff-caveat)',
  jetbrains: 'var(--ff-jetbrains)',
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface RetroCard {
  id: string;
  phase: PhaseId;
  text: string;
  author: string;
  votes: number;
  votedByMe: boolean;
  rotation: number;
  createdAt: number;
  assignee?: string;
  due?: string;
  derivedFrom?: string;
  status?: 'open' | 'done';
}

interface DragState {
  id: string; fromPhase: PhaseId;
  x: number; y: number; ox: number; oy: number; rot: number;
}

interface RetroComment {
  id: string;
  cardId: string;
  author: string;
  text: string;
  createdAt: number;
}

interface ConfettiBurst { id: number; x: number; y: number; }
interface TimerState { running: boolean; secs: number; set: number; }

interface RetroCtxValue {
  cards: RetroCard[];
  participants: string[];
  composerFor: PhaseId | null; setComposerFor: (p: PhaseId | null) => void;
  revealed: boolean; setRevealed: (v: boolean | ((prev: boolean) => boolean)) => void;
  activePhase: PhaseId; setActivePhase: (p: PhaseId) => void;
  timer: TimerState; setTimer: (fn: (t: TimerState) => TimerState) => void;
  drag: DragState | null; setDrag: (d: DragState | null | ((prev: DragState | null) => DragState | null)) => void;
  confetti: ConfettiBurst[];
  userName: string;
  isCreator: boolean;
  spotlightId: string | null;
  setSpotlight: (id: string | null) => Promise<void>;
  comments: RetroComment[];
  addComment: (cardId: string, text: string) => void;
  markDone: (id: string, done: boolean) => void;
  carriedOver: RetroCard[];
  importCarriedOver: () => void;
  dismissCarriedOver: () => void;
  importSelected: (items: RetroCard[]) => Promise<void>;
  team: string;
  roomCode: string;
  addCard: (phase: PhaseId, text: string, opts?: { derivedFrom?: string; author?: string }) => void;
  editCard: (id: string, patch: Partial<RetroCard>) => void;
  deleteCard: (id: string) => void;
  toggleVote: (id: string) => void;
  movePhase: (id: string, to: PhaseId) => void;
  convertToAction: (id: string, headerRef: React.RefObject<HTMLElement | null>) => void;
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function uid() { return 'c-' + Math.random().toString(36).slice(2, 9); }


function dbToComment(row: Record<string, unknown>): RetroComment {
  return {
    id:        row.id as string,
    cardId:    row.card_id as string,
    author:    row.author as string,
    text:      row.text as string,
    createdAt: row.created_at as number,
  };
}

// DB row → RetroCard (merges per-user votedByMe from localStorage)
function dbToCard(row: Record<string, unknown>, votedIds: Set<string>): RetroCard {
  return {
    id:          row.id as string,
    phase:       row.phase as PhaseId,
    text:        row.text as string,
    author:      row.author as string,
    votes:       row.votes as number,
    votedByMe:   votedIds.has(row.id as string),
    rotation:    row.rotation as number,
    createdAt:   row.created_at as number,
    assignee:    row.assignee as string | undefined,
    due:         row.due as string | undefined,
    derivedFrom: row.derived_from as string | undefined,
    status:      (row.status as 'open' | 'done' | undefined) ?? 'open',
  };
}

// ── Context ───────────────────────────────────────────────────────────────────
const RetroCtx = createContext<RetroCtxValue | null>(null);
function useRetro() { return useContext(RetroCtx)!; }

function RetroProvider({ userName, roomCode, team, children }: { userName: string; roomCode: string; team: string; children: React.ReactNode }) {
  const votedKey = `retro-voted-${roomCode}`;
  const getVoted = (): Set<string> => {
    try { return new Set<string>(JSON.parse(localStorage.getItem(votedKey) ?? '[]')); } catch { return new Set(); }
  };
  const saveVoted = (s: Set<string>) => {
    try { localStorage.setItem(votedKey, JSON.stringify([...s])); } catch { /* ignore */ }
  };

  const [isCreator,    setIsCreator]    = useState(false);
  useEffect(() => {
    setIsCreator(localStorage.getItem('retro-creator-' + roomCode) === '1');
  }, [roomCode]);

  const [spotlightId,  setSpotlightId]  = useState<string | null>(null);
  const [comments,     setComments]     = useState<RetroComment[]>([]);
  const [carriedOver,  setCarriedOver]  = useState<RetroCard[]>([]);

  const [cards,        setCards]        = useState<RetroCard[]>([]);
  const [participants, setParticipants] = useState<string[]>([]);
  const [composerFor,  setComposerFor]  = useState<PhaseId | null>(null);
  const [revealed,     _setRevealed]    = useState(false);
  const [activePhase,  setActivePhase]  = useState<PhaseId>('wentWell');
  const revealChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [drag,         setDrag]         = useState<DragState | null>(null);
  const [confetti,     setConfetti]     = useState<ConfettiBurst[]>([]);
  const [timer,        setTimer]        = useState<TimerState>({ running: false, secs: 5 * 60, set: 5 * 60 });

  // Timer tick
  useEffect(() => {
    if (!timer.running) return;
    const t = setInterval(() => setTimer((p) => ({
      ...p, secs: Math.max(0, p.secs - 1), running: p.secs > 1 ? p.running : false,
    })), 1000);
    return () => clearInterval(t);
  }, [timer.running]);

  // Initial fetch + realtime subscriptions
  useEffect(() => {
    let cancelled = false;

    const fetchAll = async () => {
      const [{ data: cardRows }, { data: partRows }, { data: spotRow }, { data: commentRows }] = await Promise.all([
        supabase.from('retro_cards').select('*').eq('room_code', roomCode).order('created_at'),
        supabase.from('retro_participants').select('name').eq('room_code', roomCode),
        supabase.from('retro_spotlight').select('card_id').eq('room_code', roomCode).maybeSingle(),
        supabase.from('retro_comments').select('*').eq('room_code', roomCode).order('created_at'),
      ]);
      if (cancelled) return;
      const voted = getVoted();
      if (cardRows) setCards(cardRows.map((r) => dbToCard(r, voted)));
      if (spotRow) setSpotlightId((spotRow as { card_id: string | null }).card_id);
      if (commentRows) setComments(commentRows.map(dbToComment));

      // Carryover: find open action items from this team's most recent prior retro
      if (team) {
        const { data: prevRooms } = await supabase
          .from('retro_rooms').select('code').eq('team', team).neq('code', roomCode).order('created_at', { ascending: false }).limit(1);
        if (prevRooms && prevRooms.length > 0) {
          const prevCode = prevRooms[0].code;
          const { data: prevActions } = await supabase
            .from('retro_cards').select('*').eq('room_code', prevCode).eq('phase', 'actions').eq('status', 'open').order('created_at');
          if (prevActions && prevActions.length > 0 && !cancelled) {
            const voted = getVoted();
            setCarriedOver(prevActions.map((r) => dbToCard(r, voted)));
          }
        }
      }

      // Register this user as a participant (upsert is safe if already present)
      await supabase.from('retro_participants').upsert({ room_code: roomCode, name: userName }, { onConflict: 'room_code,name' });

      const names = partRows?.map((p: { name: string }) => p.name) ?? [];
      if (!names.includes(userName)) names.push(userName);
      if (!cancelled) setParticipants(names);
    };

    fetchAll();

    const refetchCards = async () => {
      const { data } = await supabase.from('retro_cards').select('*').eq('room_code', roomCode).order('created_at');
      if (data && !cancelled) setCards(data.map((r) => dbToCard(r, getVoted())));
    };
    const refetchParts = async () => {
      const { data } = await supabase.from('retro_participants').select('name').eq('room_code', roomCode);
      if (data && !cancelled) setParticipants(data.map((p: { name: string }) => p.name));
    };
    const refetchComments = async () => {
      const { data } = await supabase.from('retro_comments').select('*').eq('room_code', roomCode).order('created_at');
      if (data && !cancelled) setComments(data.map(dbToComment));
    };

    const cardsSub = supabase
      .channel(`cards-${roomCode}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'retro_cards', filter: `room_code=eq.${roomCode}` }, refetchCards)
      .subscribe();

    const partsSub = supabase
      .channel(`parts-${roomCode}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'retro_participants', filter: `room_code=eq.${roomCode}` }, refetchParts)
      .subscribe();

    const spotlightSub = supabase
      .channel(`db-spotlight-${roomCode}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'retro_spotlight', filter: `room_code=eq.${roomCode}` }, (payload) => {
        if (cancelled) return;
        const next = payload.eventType === 'DELETE' ? null : (payload.new as { card_id: string | null }).card_id ?? null;
        setSpotlightId(next);
      })
      .subscribe();

    const commentsSub = supabase
      .channel(`comments-${roomCode}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'retro_comments', filter: `room_code=eq.${roomCode}` }, refetchComments)
      .subscribe();

    const revealCh = supabase
      .channel(`reveal-${roomCode}`)
      .on('broadcast', { event: 'reveal' }, ({ payload }) => {
        if (!cancelled) _setRevealed(payload.revealed as boolean);
      })
      .subscribe();
    revealChannelRef.current = revealCh;

    return () => {
      cancelled = true;
      cardsSub.unsubscribe();
      partsSub.unsubscribe();
      spotlightSub.unsubscribe();
      commentsSub.unsubscribe();
      revealCh.unsubscribe();
      revealChannelRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, userName]);

  const fireConfetti = useCallback((x: number, y: number) => {
    const id = Date.now() + Math.random();
    setConfetti((c) => [...c, { id, x, y }]);
    setTimeout(() => setConfetti((c) => c.filter((p) => p.id !== id)), 1400);
  }, []);

  const addCard = useCallback(async (phase: PhaseId, text: string, opts: { derivedFrom?: string; author?: string } = {}) => {
    if (!text.trim()) return;
    await supabase.from('retro_cards').insert({
      id: uid(), room_code: roomCode, phase, text: text.trim(),
      author: opts.author ?? userName ?? 'You', votes: 0, rotation: 0, created_at: Date.now(),
      ...(opts.derivedFrom ? { derived_from: opts.derivedFrom } : {}),
    });
  }, [roomCode, userName]);

  const editCard = useCallback(async (id: string, patch: Partial<RetroCard>) => {
    const dbPatch: Record<string, unknown> = {};
    if (patch.text     !== undefined) dbPatch.text     = patch.text;
    if (patch.phase    !== undefined) dbPatch.phase    = patch.phase;
    if (patch.assignee !== undefined) dbPatch.assignee = patch.assignee;
    if (patch.due      !== undefined) dbPatch.due      = patch.due;
    await supabase.from('retro_cards').update(dbPatch).eq('id', id);
  }, []);

  const deleteCard = useCallback(async (id: string) => {
    setCards((cs) => cs.filter((c) => c.id !== id));
    await supabase.from('retro_cards').delete().eq('id', id);
  }, []);

  const toggleVote = useCallback(async (id: string) => {
    const card = cards.find((c) => c.id === id);
    if (!card) return;
    const voted   = getVoted();
    const wasVoted = voted.has(id);
    wasVoted ? voted.delete(id) : voted.add(id);
    saveVoted(voted);
    // Optimistic update so it feels instant
    setCards((cs) => cs.map((c) => c.id !== id ? c : { ...c, votedByMe: !wasVoted, votes: c.votes + (wasVoted ? -1 : 1) }));
    await supabase.from('retro_cards').update({ votes: card.votes + (wasVoted ? -1 : 1) }).eq('id', id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards]);

  const movePhase = useCallback(async (id: string, to: PhaseId) => {
    await supabase.from('retro_cards').update({ phase: to }).eq('id', id);
  }, []);

  const convertToAction = useCallback(async (id: string, headerRef: React.RefObject<HTMLElement | null>) => {
    const src = cards.find((c) => c.id === id);
    if (!src) return;
    await supabase.from('retro_cards').insert({
      id: uid(), room_code: roomCode, phase: 'actions', text: src.text,
      author: userName || 'You', votes: 0, rotation: 0,
      created_at: Date.now(), derived_from: id,
    });
    if (headerRef.current) {
      const rect = headerRef.current.getBoundingClientRect();
      fireConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
  }, [cards, roomCode, userName, fireConfetti]);

  const setSpotlight = useCallback(async (cardId: string | null) => {
    setSpotlightId(cardId);
    await supabase.from('retro_spotlight').upsert({ room_code: roomCode, card_id: cardId });
  }, [roomCode]);

  const addComment = useCallback(async (cardId: string, text: string) => {
    if (!text.trim()) return;
    await supabase.from('retro_comments').insert({
      id: uid(), card_id: cardId, room_code: roomCode,
      author: userName || 'You', text: text.trim(), created_at: Date.now(),
    });
  }, [roomCode, userName]);

  const markDone = useCallback(async (id: string, done: boolean) => {
    setCards((cs) => cs.map((c) => c.id === id ? { ...c, status: done ? 'done' : 'open' } : c));
    await supabase.from('retro_cards').update({ status: done ? 'done' : 'open' }).eq('id', id);
  }, []);

  const importCarriedOver = useCallback(async () => {
    if (carriedOver.length === 0) return;
    await Promise.all(carriedOver.map((c) =>
      supabase.from('retro_cards').insert({
        id: uid(), room_code: roomCode, phase: 'actions',
        text: c.text, author: c.author, votes: 0, rotation: 0,
        created_at: Date.now(), assignee: c.assignee, due: c.due,
        status: 'open',
      })
    ));
    setCarriedOver([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carriedOver, roomCode]);

  const dismissCarriedOver = useCallback(() => setCarriedOver([]), []);

  const importSelected = useCallback(async (items: RetroCard[]) => {
    if (items.length === 0) return;
    await Promise.all(items.map((c) =>
      supabase.from('retro_cards').insert({
        id: uid(), room_code: roomCode, phase: 'actions',
        text: c.text, author: c.author, votes: 0, rotation: 0,
        created_at: Date.now(), assignee: c.assignee, due: c.due,
        status: 'open',
      })
    ));
  }, [roomCode]);

  const setRevealed = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    _setRevealed((prev) => {
      const next = typeof v === 'function' ? v(prev) : v;
      revealChannelRef.current?.send({ type: 'broadcast', event: 'reveal', payload: { revealed: next } });
      return next;
    });
  }, []);

  // Re-broadcast reveal state to late-joining participants (creator only)
  useEffect(() => {
    if (!isCreator || participants.length === 0) return;
    revealChannelRef.current?.send({ type: 'broadcast', event: 'reveal', payload: { revealed } });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants.length]);

  return (
    <RetroCtx.Provider value={{
      cards, participants, composerFor, setComposerFor, revealed, setRevealed,
      activePhase, setActivePhase, timer, setTimer, drag, setDrag,
      confetti, userName, isCreator, spotlightId, setSpotlight,
      comments, addComment, markDone, carriedOver, importCarriedOver, dismissCarriedOver,
      importSelected, team, roomCode,
      addCard, editCard, deleteCard, toggleVote, movePhase, convertToAction,
    }}>
      {children}
    </RetroCtx.Provider>
  );
}

// ── Atoms ─────────────────────────────────────────────────────────────────────
function Avatar({ name, size = 22 }: { name: string; size?: number }) {
  const isAnon = !name || name === 'Anon';
  const hash   = useMemo(() => [...(name || '?')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0), [name]);
  const hue    = hash % 360;
  return (
    <span style={{
      width: size, height: size, borderRadius: size,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: isAnon ? 'transparent' : `oklch(0.85 0.12 ${hue})`,
      border: isAnon ? '1.5px dashed rgba(31,27,46,.35)' : 'none',
      color: isAnon ? PALETTE.mute : PALETTE.ink,
      fontSize: isAnon ? size * 0.5 : size * 0.46,
      fontWeight: 700, flexShrink: 0,
      fontFamily: isAnon ? FF.caveat : FF.schibsted,
    }}>
      {isAnon ? '?' : name.trim()[0].toUpperCase()}
    </span>
  );
}


// ── Confetti ──────────────────────────────────────────────────────────────────
const CONFETTI_COLORS = Object.values(PALETTE.phases).map((p) => p.hero);

function ConfettiBurstEl({ x, y }: { x: number; y: number }) {
  const pieces = useMemo(() => Array.from({ length: 18 }, (_, i) => {
    const ang  = Math.random() * Math.PI * 2;
    const dist = 80 + Math.random() * 140;
    return {
      i, cx: Math.cos(ang) * dist, cy: Math.sin(ang) * dist - 60,
      rot: (Math.random() - 0.5) * 720,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delay: Math.random() * 80,
      w: 6 + Math.random() * 6, h: 10 + Math.random() * 10,
    };
  }), []);
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: 0, height: 0 }}>
      {pieces.map((p) => (
        <span key={p.i} style={{
          position: 'absolute', width: p.w, height: p.h, top: 0, left: '50%',
          background: p.color, borderRadius: 1, pointerEvents: 'none',
          animationName: 'confettiFall', animationDuration: '1100ms',
          animationTimingFunction: 'cubic-bezier(.22,.61,.36,1)',
          animationFillMode: 'forwards', animationDelay: `${p.delay}ms`,
          ['--cx' as string]: `${p.cx}px`,
          ['--cy' as string]: `${p.cy}px`,
          ['--cr' as string]: `${p.rot}deg`,
        }} />
      ))}
    </div>
  );
}

function ConfettiLayer() {
  const { confetti } = useRetro();
  if (typeof document === 'undefined' || confetti.length === 0) return null;
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9998 }}>
      {confetti.map((c) => <ConfettiBurstEl key={c.id} x={c.x} y={c.y} />)}
    </div>,
    document.body,
  );
}

// ── Drag ghost ────────────────────────────────────────────────────────────────
function DragGhost() {
  const r = useRetro();
  if (!r.drag || typeof document === 'undefined') return null;
  const card = r.cards.find((c) => c.id === r.drag!.id);
  if (!card) return null;
  const pc = PALETTE.phases[card.phase];
  return createPortal(
    <div style={{
      position: 'fixed',
      left: r.drag.x - r.drag.ox, top: r.drag.y - r.drag.oy,
      width: 240, pointerEvents: 'none', zIndex: 9999,
      opacity: .95, transform: 'rotate(1.5deg) scale(1.02)',
    }}>
      <div style={{
        background: pc.sticky, color: pc.ink,
        borderRadius: CARD_SHAPE.radius,
        padding: '13px 13px 11px 14px',
        boxShadow: '0 20px 48px rgba(0,0,0,.18)',
        fontSize: 14, fontFamily: FF.schibsted, lineHeight: 1.5, fontWeight: 500,
      }}>
        {card.text}
      </div>
    </div>,
    document.body,
  );
}

// ── Card composer ─────────────────────────────────────────────────────────────
function CardComposer({ phaseId, onClose }: { phaseId: PhaseId; onClose: () => void }) {
  const r  = useRetro();
  const pc = PALETTE.phases[phaseId];
  const [text,   setText]   = useState('');
  const [isAnon, setIsAnon] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const effectiveAuthor = isAnon ? 'Anon' : r.userName;
  const submit = () => {
    if (text.trim()) { r.addCard(phaseId, text, { author: effectiveAuthor }); setText(''); ref.current?.focus(); }
  };
  const submitClose = () => { if (text.trim()) r.addCard(phaseId, text, { author: effectiveAuthor }); onClose(); };

  return (
    <div style={{
      background: pc.sticky, borderRadius: CARD_SHAPE.radius,
      padding: '13px 13px 11px 14px',
      boxShadow: '0 2px 8px rgba(0,0,0,.08)',
    }}>
      <textarea
        ref={ref} value={text} rows={2}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          if (e.key === 'Escape') onClose();
        }}
        placeholder={PLACEHOLDERS[phaseId][0]}
        style={{
          width: '100%', resize: 'none',
          border: '1.5px solid rgba(255,255,255,.5)', outline: 'none',
          background: 'rgba(255,255,255,.55)', color: pc.ink,
          fontFamily: FF.schibsted, fontSize: 13.5, lineHeight: 1.5,
          padding: '8px 10px', borderRadius: 6, fontWeight: 500,
          boxSizing: 'border-box', minHeight: 60,
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
        {/* Anon toggle */}
        <button onClick={() => setIsAnon((a) => !a)} style={{
          display: 'flex', alignItems: 'center', gap: 5, border: 'none',
          background: isAnon ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.4)',
          padding: '3px 8px 3px 6px', borderRadius: 99, cursor: 'pointer',
          fontSize: 10, fontWeight: 700, color: pc.ink,
        }}>
          <span style={{
            width: 20, height: 12, borderRadius: 99, background: isAnon ? pc.ink : 'rgba(0,0,0,.2)',
            position: 'relative', display: 'block', flexShrink: 0, transition: 'background .15s',
          }}>
            <span style={{
              position: 'absolute', top: 2, left: isAnon ? 10 : 2, width: 8, height: 8,
              borderRadius: '50%', background: '#fff', transition: 'left .15s', display: 'block',
            }} />
          </span>
          Anon
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, fontFamily: FF.jetbrains, color: pc.ink, opacity: .5 }}>↵ add</span>
        <button onClick={onClose} style={{ border: 'none', background: 'rgba(0,0,0,.07)', padding: '4px 8px', fontSize: 11, fontWeight: 600, color: pc.ink, cursor: 'pointer', borderRadius: 5 }}>
          Cancel
        </button>
        <button onClick={submitClose} disabled={!text.trim()} style={{
          border: 'none',
          background: text.trim() ? 'rgba(0,0,0,.15)' : 'rgba(0,0,0,.06)',
          color: text.trim() ? pc.ink : `${pc.ink}66`,
          padding: '5px 12px', fontSize: 11, fontWeight: 700, borderRadius: 6,
          cursor: text.trim() ? 'pointer' : 'not-allowed',
        }}>Add</button>
      </div>
    </div>
  );
}

// ── Empty placeholder ─────────────────────────────────────────────────────────
function EmptyPlaceholder({ phaseId, onClick }: { phaseId: PhaseId; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const pc    = PALETTE.phases[phaseId];
  const lines = PLACEHOLDERS[phaseId];
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        border: 'none',
        background: hover ? pc.soft : 'rgba(255,255,255,.18)',
        borderRadius: CARD_SHAPE.radius,
        padding: '22px 14px',
        cursor: 'pointer', textAlign: 'center', width: '100%',
        transition: 'background .18s, transform .12s',
        transform: hover ? 'translateY(-1px)' : 'none',
        boxShadow: hover ? '0 4px 12px rgba(31,27,46,.07)' : '0 1px 3px rgba(31,27,46,.04)',
      }}>
      <div style={{
        width: 28, height: 28, borderRadius: 999,
        background: hover ? pc.hero : 'rgba(31,27,46,.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 10px',
        transition: 'background .18s',
      }}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={hover ? pc.ink : PALETTE.mute} strokeWidth="2.4" strokeLinecap="round">
          <path d="M6 1.5v9M1.5 6h9" />
        </svg>
      </div>
      <div style={{ fontFamily: FF.caveat, fontWeight: 700, fontSize: 16, color: hover ? pc.ink : PALETTE.mute, marginBottom: 3, transition: 'color .18s' }}>
        {lines[0]}
      </div>
      <div style={{ fontFamily: FF.caveat, fontSize: 13, color: PALETTE.mute, opacity: .75 }}>
        {lines[1]}
      </div>
    </button>
  );
}

// ── MenuBtn ───────────────────────────────────────────────────────────────────
function MenuBtn({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        border: 'none', borderRadius: 5, padding: '7px 10px',
        fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
        color: danger ? '#C73E5C' : 'inherit', cursor: 'pointer',
        background: hover ? (danger ? 'rgba(199,62,92,.1)' : 'rgba(0,0,0,.05)') : 'transparent',
      }}>
      {children}
    </button>
  );
}

// ── Retro card ────────────────────────────────────────────────────────────────
function CardView({ card, onConvert }: {
  card: RetroCard;
  onConvert?: (id: string, ref: React.RefObject<HTMLElement | null>) => void;
}) {
  const r  = useRetro();
  const pc = PALETTE.phases[card.phase];
  const [editing,      setEditing]      = useState(false);
  const [draft,        setDraft]        = useState(card.text);
  const [menu,         setMenu]         = useState(false);
  const [voteAnim,     setVoteAnim]     = useState(false);
  const [showComments, setShowComments] = useState(false);
  const commentCount = r.comments.filter((c) => c.cardId === card.id).length;

  const cardRef   = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setDraft(card.text); }, [card.text]);
  useEffect(() => {
    if (!menu) return;
    const off = (e: PointerEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('pointerdown', off, true);
    return () => document.removeEventListener('pointerdown', off, true);
  }, [menu]);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input, textarea, [data-no-drag]')) return;
    if (e.button !== 0) return;
    const startX = e.clientX, startY = e.clientY;
    let started = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!started && Math.hypot(dx, dy) < 6) return;
      if (!started) {
        started = true;
        const rect = cardRef.current!.getBoundingClientRect();
        r.setDrag({ id: card.id, fromPhase: card.phase, x: ev.clientX, y: ev.clientY, ox: startX - rect.left, oy: startY - rect.top, rot: card.rotation });
      } else {
        r.setDrag((d) => d ? { ...d, x: ev.clientX, y: ev.clientY } : null);
      }
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (started) {
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const col = el?.closest?.('[data-retro-column]');
        if (col) {
          const to = col.getAttribute('data-retro-column') as PhaseId;
          if (to !== card.phase) r.movePhase(card.id, to);
        }
        r.setDrag(null);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const isDragging  = r.drag?.id === card.id;
  const isSpotlit   = r.spotlightId === card.id;

  const onVote = (e: React.MouseEvent) => {
    e.stopPropagation();
    setVoteAnim(true);
    r.toggleVote(card.id);
    setTimeout(() => setVoteAnim(false), 300);
  };

  return (
    <div ref={cardRef} onPointerDown={onPointerDown}
      className={`retro-card${isSpotlit ? ' spotlight-card' : ''}`}
      style={{
        position: 'relative', background: pc.sticky, color: pc.ink,
        borderRadius: CARD_SHAPE.radius,
        padding: '16px 16px 14px 16px',
        boxShadow: isDragging
          ? '0 20px 48px rgba(0,0,0,.16)'
          : isSpotlit
          ? `0 0 0 3px ${pc.hero}, 0 12px 32px rgba(0,0,0,.18)`
          : CARD_SHAPE.shadow,
        transform: isDragging ? 'scale(1.03)' : 'none',
        transition: isDragging ? 'none' : 'box-shadow .2s, transform .15s',
        cursor: isDragging ? 'grabbing' : 'grab',
        opacity: isDragging ? 0.25 : 1,
        fontSize: 15, lineHeight: 1.5, fontFamily: FF.schibsted, fontWeight: 500,
        userSelect: editing ? 'text' : 'none',
        width: '100%', boxSizing: 'border-box',
        zIndex: menu ? 20 : isSpotlit ? 10 : 'auto',
      }}>
      {/* Spotlight badge */}
      {isSpotlit && (
        <div data-no-drag style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 8,
          padding: '2px 8px 2px 6px', borderRadius: 99,
          background: pc.hero, color: pc.ink,
          fontSize: 10, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase',
        }}>
          <span className="spotlight-dot" style={{ width: 6, height: 6, borderRadius: 99, background: pc.ink, display: 'block' }} />
          Discussing
        </div>
      )}

      {/* "from improve" badge */}
      {card.derivedFrom && (
        <div data-no-drag style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 6,
          fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
          color: PALETTE.phases.improve.hero, fontFamily: FF.schibsted,
        }}>
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M2 5h7M5 2l3 3-3 3"/></svg>
          from improve
        </div>
      )}

      {/* Body */}
      {editing ? (
        <textarea
          autoFocus value={draft} rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (draft.trim() && draft !== card.text) r.editCard(card.id, { text: draft.trim() });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); (e.target as HTMLElement).blur(); }
            if (e.key === 'Escape') { setDraft(card.text); setEditing(false); }
          }}
          data-no-drag
          style={{
            width: '100%', minHeight: 52, resize: 'none',
            border: '1.5px solid rgba(255,255,255,.5)', outline: 'none',
            background: 'rgba(255,255,255,.55)', color: pc.ink,
            fontFamily: FF.schibsted, fontSize: 13.5, lineHeight: 1.5,
            borderRadius: 6, padding: '8px 10px', marginBottom: 8, boxSizing: 'border-box',
          }}
        />
      ) : (
        <div onDoubleClick={() => setEditing(true)} style={{
          minHeight: 36, marginBottom: 8,
          filter: r.revealed ? 'none' : 'blur(6px)',
          transition: 'filter .25s', wordBreak: 'break-word',
          textDecoration: card.status === 'done' ? 'line-through' : 'none',
          opacity: card.status === 'done' ? 0.55 : 1,
        }}>{card.text}</div>
      )}

      {/* Action item done toggle */}
      {card.phase === 'actions' && (
        <button data-no-drag onClick={() => r.markDone(card.id, card.status !== 'done')} style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none',
          background: card.status === 'done' ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.5)',
          borderRadius: 6, padding: '3px 9px', cursor: 'pointer', marginBottom: 8,
          fontSize: 11, fontWeight: 700, color: pc.ink, fontFamily: FF.schibsted,
          transition: 'background .15s',
        }}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            {card.status === 'done'
              ? <path d="M2 6l3 3 5-5"/>
              : <circle cx="6" cy="6" r="4.5"/>
            }
          </svg>
          {card.status === 'done' ? 'Done' : 'Mark done'}
        </button>
      )}

      {/* Action item meta */}
      {card.phase === 'actions' && (card.assignee || card.due) && (
        <div data-no-drag style={{
          display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8,
        }}>
          {card.assignee && <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', background: pc.soft, color: pc.ink, borderRadius: 4 }}>{card.assignee}</span>}
          {card.due && <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', background: 'rgba(0,0,0,.05)', color: PALETTE.mute, borderRadius: 4, fontFamily: FF.jetbrains }}>⏱ {card.due}</span>}
        </div>
      )}

      {/* Footer */}
      <div ref={footerRef} style={{
        display: 'flex', alignItems: 'center', gap: 6,
        paddingTop: 8, borderTop: '1px solid rgba(0,0,0,.09)',
      }}>
        <Avatar name={card.author} size={18} />
        <span style={{ fontFamily: FF.schibsted, fontSize: 11, color: pc.ink, opacity: .65, flex: 1 }}>{card.author}</span>

        {/* Comments toggle */}
        <button data-no-drag onClick={() => setShowComments((v) => !v)} style={{
          display: 'flex', alignItems: 'center', gap: 3, border: 'none',
          background: showComments ? 'rgba(0,0,0,.12)' : 'transparent',
          padding: '3px 6px', borderRadius: 6, cursor: 'pointer',
          color: pc.ink, opacity: commentCount > 0 ? 1 : 0.45,
          fontSize: 11, fontWeight: 700, transition: 'background .12s',
        }}>
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8a2 2 0 0 1-2 2H4l-2 2V4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v4Z"/>
          </svg>
          {commentCount > 0 && <span>{commentCount}</span>}
        </button>

        {/* Vote */}
        <button data-no-drag onClick={onVote} style={{
          display: 'flex', alignItems: 'center', gap: 4, border: 'none',
          background: card.votedByMe ? 'rgba(0,0,0,.15)' : 'rgba(255,255,255,.4)',
          padding: '3px 8px', borderRadius: 6,
          color: pc.ink,
          cursor: 'pointer', fontWeight: 700, fontSize: 11,
          transition: 'background .12s, color .12s', fontVariantNumeric: 'tabular-nums',
        }}>
          <svg className={voteAnim ? 'vote-bump' : ''} width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 10V2M6 2L2 6M6 2l4 4" />
          </svg>
          <span>{card.votes}</span>
        </button>

        {/* Menu trigger */}
        <button data-no-drag onClick={(e) => { e.stopPropagation(); setMenu((m) => !m); }} style={{
          border: 'none', background: menu ? 'rgba(0,0,0,.1)' : 'transparent',
          padding: '4px 5px', cursor: 'pointer', color: pc.ink, borderRadius: 5,
          display: 'flex', alignItems: 'center', opacity: .7,
        }}>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="currentColor">
            <circle cx="3" cy="7" r="1.3"/><circle cx="7" cy="7" r="1.3"/><circle cx="11" cy="7" r="1.3"/>
          </svg>
        </button>
      </div>

      {/* Context menu */}
      {menu && (
        <div data-no-drag onPointerDown={(e) => e.stopPropagation()} style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 30,
          background: '#fff', borderRadius: 8, padding: 4, minWidth: 175,
          boxShadow: '0 8px 24px rgba(0,0,0,.12), 0 0 0 1px rgba(0,0,0,.07)',
          fontFamily: FF.schibsted, fontSize: 13, color: PALETTE.ink,
        }}>
          <MenuBtn onClick={() => { setMenu(false); setEditing(true); }}>Edit</MenuBtn>
          <MenuBtn onClick={() => { setMenu(false); r.setSpotlight(isSpotlit ? null : card.id); }}>
            {isSpotlit ? '✕  Remove spotlight' : '◎  Spotlight this card'}
          </MenuBtn>
          {card.phase === 'improve' && (
            <MenuBtn onClick={() => { setMenu(false); onConvert?.(card.id, footerRef as React.RefObject<HTMLElement | null>); }}>
              Convert → action item
            </MenuBtn>
          )}
          <div style={{ padding: '6px 8px 2px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', color: PALETTE.mute, fontWeight: 700 }}>Move to</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, padding: '0 4px 4px' }}>
            {PHASES.filter((p) => p.id !== card.phase).map((p) => (
              <button key={p.id} onClick={() => { setMenu(false); r.movePhase(card.id, p.id); }} style={{
                flex: '1 1 calc(50% - 3px)', display: 'flex', alignItems: 'center', gap: 6,
                border: 'none', background: 'rgba(0,0,0,.04)', borderRadius: 6,
                padding: '6px 8px', fontSize: 11, fontWeight: 600,
                color: PALETTE.ink, cursor: 'pointer', fontFamily: FF.schibsted,
              }}>
                <span style={{ width: 7, height: 7, borderRadius: 99, background: PALETTE.phases[p.id].hero, flexShrink: 0 }} />
                {p.title}
              </button>
            ))}
          </div>
          <div style={{ height: 1, background: 'rgba(0,0,0,.07)', margin: '2px 4px 4px' }} />
          <MenuBtn danger onClick={() => { setMenu(false); r.deleteCard(card.id); }}>Delete</MenuBtn>
        </div>
      )}

      {showComments && <CommentThread cardId={card.id} pc={pc} />}
    </div>
  );
}

// ── Comment thread ────────────────────────────────────────────────────────────
function CommentThread({ cardId, pc }: { cardId: string; pc: typeof PALETTE.phases[PhaseId] }) {
  const r = useRetro();
  const cardComments = r.comments.filter((c) => c.cardId === cardId);
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [cardComments.length]);

  const submit = () => {
    if (!draft.trim()) return;
    r.addComment(cardId, draft.trim());
    setDraft('');
  };

  return (
    <div data-no-drag style={{ marginTop: 10, borderTop: `1px solid rgba(0,0,0,.09)`, paddingTop: 8 }}>
      {cardComments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8, maxHeight: 160, overflowY: 'auto' }}>
          {cardComments.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <Avatar name={c.author} size={16} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 700, fontSize: 10, color: pc.ink, fontFamily: FF.schibsted }}>{c.author} </span>
                <span style={{ fontSize: 12, color: pc.ink, fontFamily: FF.schibsted, wordBreak: 'break-word' }}>{c.text}</span>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
      <div style={{ display: 'flex', gap: 5 }}>
        <input
          data-no-drag
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="Reply…"
          style={{
            flex: 1, border: '1.5px solid rgba(0,0,0,.12)', borderRadius: 6,
            background: 'rgba(255,255,255,.55)', color: pc.ink,
            fontFamily: FF.schibsted, fontSize: 12, padding: '5px 8px',
            outline: 'none',
          }}
        />
        <button
          data-no-drag
          onClick={submit}
          disabled={!draft.trim()}
          style={{
            border: 'none', borderRadius: 6, padding: '5px 10px',
            background: draft.trim() ? pc.hero : 'rgba(0,0,0,.07)',
            color: draft.trim() ? pc.ink : 'rgba(0,0,0,.3)',
            fontSize: 11, fontWeight: 700, fontFamily: FF.schibsted, cursor: draft.trim() ? 'pointer' : 'default',
            transition: 'background .12s',
          }}
        >Post</button>
      </div>
    </div>
  );
}

// ── History picker modal ──────────────────────────────────────────────────────
interface PastRetro { code: string; sprintName: string; items: RetroCard[]; }

function HistoryPickerModal({ onClose }: { onClose: () => void }) {
  const r = useRetro();
  const [state,     setState]    = useState<'loading' | 'done' | 'empty' | 'error'>('loading');
  const [history,   setHistory]  = useState<PastRetro[]>([]);
  const [selected,  setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!r.team) { setState('empty'); return; }
    let cancelled = false;
    (async () => {
      const { data: rooms } = await supabase
        .from('retro_rooms').select('code, sprint_name')
        .eq('team', r.team).neq('code', r.roomCode)
        .order('created_at', { ascending: false });
      if (!rooms || rooms.length === 0) { if (!cancelled) setState('empty'); return; }

      const codes = rooms.map((rm: { code: string }) => rm.code);
      const { data: cardRows } = await supabase
        .from('retro_cards').select('*')
        .in('room_code', codes).eq('phase', 'actions')
        .order('created_at');
      if (cancelled) return;
      if (!cardRows) { setState('error'); return; }

      const empty = new Set<string>();
      const retros: PastRetro[] = rooms
        .map((rm: { code: string; sprint_name: string }) => ({
          code:       rm.code,
          sprintName: rm.sprint_name || rm.code,
          items:      cardRows.filter((c: Record<string, unknown>) => c.room_code === rm.code).map((c: Record<string, unknown>) => dbToCard(c, empty)),
        }))
        .filter((rt: PastRetro) => rt.items.length > 0);

      setHistory(retros);
      setState(retros.length === 0 ? 'empty' : 'done');
    })().catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.team, r.roomCode]);

  const toggle = (id: string) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleGroup = (retro: PastRetro) => {
    const ids = retro.items.map((c) => c.id);
    const allOn = ids.every((id) => selected.has(id));
    setSelected((s) => {
      const next = new Set(s);
      if (allOn) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const doImport = async () => {
    const items = history.flatMap((rt) => rt.items).filter((c) => selected.has(c.id));
    if (items.length === 0) return;
    setImporting(true);
    await r.importSelected(items);
    onClose();
  };

  const pc = PALETTE.phases.actions;
  const selectedCount = selected.size;

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(31,27,46,.55)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: PALETTE.paper, borderRadius: 16, width: '100%', maxWidth: 540,
        maxHeight: '82vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 64px rgba(0,0,0,.18)',
        fontFamily: FF.schibsted,
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${PALETTE.line}`, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: PALETTE.mute, marginBottom: 2 }}>
              {r.team || 'Team'} · action history
            </div>
            <div style={{ fontFamily: FF.bricolage, fontWeight: 800, fontSize: 19, color: PALETTE.ink, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              Import past actions
            </div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'rgba(31,27,46,.06)', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 18, color: PALETTE.mute, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 24px' }}>
          {state === 'loading' && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: PALETTE.mute }}>
              <div style={{ width: 22, height: 22, border: `2.5px solid ${PALETTE.line}`, borderTopColor: PALETTE.ink, borderRadius: '50%', animation: 'spin 700ms linear infinite', margin: '0 auto 12px' }} />
              Loading history…
            </div>
          )}
          {state === 'error' && (
            <div style={{ color: PALETTE.phases.improve.ink, background: PALETTE.phases.improve.soft, padding: '12px 16px', borderRadius: 8, fontSize: 13 }}>
              Could not load history. Check your connection and try again.
            </div>
          )}
          {state === 'empty' && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: PALETTE.mute, fontSize: 13 }}>
              {r.team ? 'No past retros found for this team.' : 'Team name not set — create this room with a team name to see history.'}
            </div>
          )}
          {state === 'done' && history.map((retro) => {
            const groupIds = retro.items.map((c) => c.id);
            const allOn    = groupIds.every((id) => selected.has(id));
            const someOn   = groupIds.some((id) => selected.has(id));
            return (
              <div key={retro.code} style={{ marginBottom: 20 }}>
                {/* Sprint header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <button onClick={() => toggleGroup(retro)} style={{
                    width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${allOn ? pc.hero : someOn ? pc.hero : PALETTE.line}`,
                    background: allOn ? pc.hero : someOn ? pc.soft : 'transparent',
                    cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {(allOn || someOn) && <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke={allOn ? pc.ink : pc.ink} strokeWidth="2" strokeLinecap="round"><path d={allOn ? 'M1.5 4.5l2 2 4-4' : 'M1.5 4.5h6'} /></svg>}
                  </button>
                  <span style={{ fontFamily: FF.bricolage, fontWeight: 700, fontSize: 14, color: PALETTE.ink, letterSpacing: '-0.01em' }}>{retro.sprintName}</span>
                  <span style={{ fontFamily: FF.jetbrains, fontSize: 10, color: PALETTE.mute, background: 'rgba(31,27,46,.06)', padding: '1px 7px', borderRadius: 99 }}>{retro.items.length}</span>
                </div>

                {/* Items */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 4 }}>
                  {retro.items.map((card) => {
                    const checked = selected.has(card.id);
                    const done    = card.status === 'done';
                    return (
                      <label key={card.id} style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
                        padding: '8px 10px', borderRadius: 8,
                        background: checked ? pc.soft : 'transparent',
                        border: `1px solid ${checked ? pc.hero : 'transparent'}`,
                        transition: 'background .1s, border-color .1s',
                      }}>
                        <input
                          type="checkbox" checked={checked}
                          onChange={() => toggle(card.id)}
                          style={{ display: 'none' }}
                        />
                        <div style={{
                          width: 16, height: 16, borderRadius: 4, flexShrink: 0, marginTop: 1,
                          border: `1.5px solid ${checked ? pc.hero : PALETTE.line}`,
                          background: checked ? pc.hero : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          transition: 'background .1s, border-color .1s',
                        }}>
                          {checked && <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke={pc.ink} strokeWidth="2.2" strokeLinecap="round"><path d="M1.5 4.5l2 2 4-4" /></svg>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: done ? PALETTE.mute : PALETTE.ink, textDecoration: done ? 'line-through' : 'none', lineHeight: 1.4 }}>
                            {card.text}
                          </div>
                          <div style={{ display: 'flex', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
                            {card.assignee && (
                              <span style={{ fontSize: 10, color: pc.ink, background: pc.soft, padding: '1px 6px', borderRadius: 99, fontWeight: 600 }}>
                                {card.assignee}
                              </span>
                            )}
                            {card.due && (
                              <span style={{ fontSize: 10, color: PALETTE.mute, fontFamily: FF.jetbrains }}>
                                by {card.due}
                              </span>
                            )}
                            <span style={{
                              fontSize: 10, fontWeight: 700, letterSpacing: '.04em',
                              color: done ? PALETTE.mute : pc.ink,
                              textTransform: 'uppercase',
                            }}>
                              {done ? '✓ done' : '○ open'}
                            </span>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        {state === 'done' && (
          <div style={{ padding: '14px 24px', borderTop: `1px solid ${PALETTE.line}`, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            <span style={{ flex: 1, fontSize: 12, color: PALETTE.mute }}>
              {selectedCount === 0 ? 'Select items to import' : `${selectedCount} item${selectedCount > 1 ? 's' : ''} selected`}
            </span>
            <button onClick={onClose} style={{ border: `1px solid ${PALETTE.line}`, background: 'transparent', color: PALETTE.ink, padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FF.schibsted }}>
              Cancel
            </button>
            <button
              onClick={doImport}
              disabled={selectedCount === 0 || importing}
              style={{
                border: 'none', borderRadius: 8, padding: '8px 18px',
                background: selectedCount === 0 || importing ? 'rgba(31,27,46,.12)' : pc.hero,
                color: selectedCount === 0 || importing ? 'rgba(31,27,46,.35)' : pc.ink,
                fontSize: 13, fontWeight: 700, cursor: selectedCount === 0 || importing ? 'not-allowed' : 'pointer',
                fontFamily: FF.schibsted, display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {importing && <span style={{ width: 12, height: 12, border: `2px solid ${pc.ink}40`, borderTopColor: pc.ink, borderRadius: '50%', animation: 'spin 700ms linear infinite', display: 'inline-block' }} />}
              Import{selectedCount > 0 ? ` ${selectedCount}` : ''}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── Retro column ──────────────────────────────────────────────────────────────
function RetroColumn({ phaseId }: { phaseId: PhaseId }) {
  const r    = useRetro();
  const meta = PHASES.find((p) => p.id === phaseId)!;
  const pc   = PALETTE.phases[phaseId];
  const headerRef = useRef<HTMLDivElement>(null);
  const [showHistory, setShowHistory] = useState(false);

  const cards      = r.cards.filter((c) => c.phase === phaseId).sort((a, b) => b.votes - a.votes);
  const [over, setOver] = useState(false);

  useEffect(() => {
    if (!r.drag) { setOver(false); return; }
    const onMove = (e: PointerEvent) => {
      const el  = document.elementFromPoint(e.clientX, e.clientY);
      const col = el?.closest?.(`[data-retro-column="${phaseId}"]`);
      setOver(!!col && r.drag!.fromPhase !== phaseId);
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [r.drag, phaseId]);

  const isComposing = r.composerFor === phaseId;

  return (
    <div data-retro-column={phaseId} style={{
      display: 'flex', flexDirection: 'column', minHeight: 0,
      background: over ? pc.soft : 'transparent',
      borderRadius: 10,
      padding: '14px 14px 16px',
      transition: 'background .15s',
      height: '100%', boxSizing: 'border-box',
      outline: over ? `2px solid ${pc.hero}` : 'none',
      outlineOffset: 2,
    }}>
      {/* Column header */}
      <div ref={headerRef} style={{ flexShrink: 0, marginBottom: 10 }}>
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
          <span style={{
            fontFamily: FF.bricolage, fontWeight: 800, fontSize: 22,
            letterSpacing: '-0.02em', color: PALETTE.ink, flex: 1, lineHeight: 1.1,
          }}>{meta.title}</span>
          <span style={{
            fontFamily: FF.jetbrains, fontSize: 11, fontWeight: 700,
            color: cards.length > 0 ? pc.ink : PALETTE.mute,
            background: cards.length > 0 ? pc.soft : 'rgba(0,0,0,.06)',
            padding: '2px 8px', borderRadius: 99, fontVariantNumeric: 'tabular-nums',
          }}>{String(cards.length).padStart(2, '0')}</span>

          {/* History picker button — actions column only */}
          {phaseId === 'actions' && r.team && (
            <button
              onClick={() => setShowHistory(true)}
              title="Import from past retros"
              style={{
                border: 'none', background: 'rgba(31,27,46,.07)', color: PALETTE.mute,
                width: 26, height: 26, borderRadius: '50%', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 7a6 6 0 1 0 6-6 6 6 0 0 0-4.24 1.76L1 1" />
                <path d="M1 1v3h3" />
                <path d="M7 4v3.5l2.5 1.5" />
              </svg>
            </button>
          )}

          <button
            onClick={() => r.setComposerFor(isComposing ? null : phaseId)}
            style={{
              border: 'none', background: isComposing ? PALETTE.ink : pc.hero, color: isComposing ? '#fff' : pc.ink,
              width: 26, height: 26, borderRadius: '50%', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background .12s', flexShrink: 0,
            }}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
              style={{ transform: isComposing ? 'rotate(45deg)' : 'none', transition: 'transform .15s' }}>
              <path d="M6 1.5v9M1.5 6h9" />
            </svg>
          </button>
        </div>
        {/* Straight underline */}
        <div style={{ height: 3, borderRadius: 99, background: pc.hero, marginBottom: 8 }} />
        {/* Description */}
        <p style={{ margin: 0, fontFamily: FF.schibsted, fontSize: 12, color: PALETTE.mute, lineHeight: 1.4, fontStyle: 'italic' }}>
          {meta.prompt}
        </p>
      </div>

      {/* Carryover banner — actions column only */}
      {phaseId === 'actions' && r.carriedOver.length > 0 && (
        <div style={{
          marginTop: 8, padding: '10px 12px', borderRadius: 8,
          background: pc.soft, border: `1.5px dashed ${pc.hero}`,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 16 }}>↩</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: pc.ink, fontFamily: FF.schibsted }}>
              {r.carriedOver.length} open item{r.carriedOver.length > 1 ? 's' : ''} from last retro
            </div>
            <div style={{ fontSize: 11, color: PALETTE.mute, fontFamily: FF.schibsted, marginTop: 1 }}>
              {r.carriedOver.map((c) => c.text).join(' · ').slice(0, 60)}…
            </div>
          </div>
          <button onClick={r.importCarriedOver} style={{
            border: 'none', borderRadius: 6, padding: '5px 10px',
            background: pc.hero, color: pc.ink, fontSize: 11, fontWeight: 700,
            fontFamily: FF.schibsted, cursor: 'pointer',
          }}>Import</button>
          <button onClick={r.dismissCarriedOver} style={{
            border: 'none', background: 'transparent', cursor: 'pointer',
            color: PALETTE.mute, fontSize: 18, padding: '0 4px', lineHeight: 1,
          }}>×</button>
        </div>
      )}

      {/* Composer */}
      {isComposing && <div style={{ marginBottom: 8, marginTop: 8 }}><CardComposer phaseId={phaseId} onClose={() => r.setComposerFor(null)} /></div>}

      {/* Card list */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        overflowY: 'auto', minHeight: 40, flex: '1 1 auto', marginTop: 8,
      }}>
        {cards.length === 0 && !isComposing && (
          <EmptyPlaceholder phaseId={phaseId} onClick={() => r.setComposerFor(phaseId)} />
        )}
        {cards.map((c) => (
          <CardView key={c.id} card={c} onConvert={(id, ref) => r.convertToAction(id, ref)} />
        ))}
      </div>

      {showHistory && <HistoryPickerModal onClose={() => setShowHistory(false)} />}
    </div>
  );
}

// ── Timer pill ────────────────────────────────────────────────────────────────
function TimerPill() {
  const r   = useRetro();
  const mm  = String(Math.floor(r.timer.secs / 60)).padStart(2, '0');
  const ss  = String(r.timer.secs % 60).padStart(2, '0');
  const pct = (r.timer.secs / (r.timer.set || 1)) * 100;
  const low = r.timer.secs <= 30 && r.timer.secs > 0;

  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState('');
  const inputRef   = useRef<HTMLInputElement>(null);
  const audioCtx   = useRef<AudioContext | null>(null);
  const mutedRef   = useRef(false);
  const [muted, _setMuted] = useState(() => {
    try { return localStorage.getItem('retro-timer-muted') === 'true'; } catch { return false; }
  });
  mutedRef.current = muted;

  const getCtx = () => {
    if (!audioCtx.current) {
      audioCtx.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    return audioCtx.current;
  };

  const playTick = (urgent: boolean) => {
    if (mutedRef.current) return;
    try {
      const ctx = getCtx();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = urgent ? 1000 : 720;
      gain.gain.setValueAtTime(urgent ? 0.18 : 0.11, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.055);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.055);
    } catch { /* ignore if audio unavailable */ }
  };

  const playDone = () => {
    if (mutedRef.current) return;
    try {
      const ctx = getCtx();
      // Ascending three-note chime: C5 → E5 → G5
      [523.25, 659.25, 783.99].forEach((freq, i) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t = ctx.currentTime + i * 0.22;
        gain.gain.setValueAtTime(0.22, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
        osc.start(t);
        osc.stop(t + 0.65);
      });
    } catch { /* ignore */ }
  };

  // Play tick on every second change while running; chime on completion
  const prevSecs = useRef(r.timer.secs);
  useEffect(() => {
    if (!r.timer.running) { prevSecs.current = r.timer.secs; return; }
    if (r.timer.secs < prevSecs.current) {
      if (r.timer.secs === 0) playDone();
      else playTick(r.timer.secs <= 30);
    }
    prevSecs.current = r.timer.secs;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.timer.secs, r.timer.running]);

  const toggleMute = () => {
    _setMuted((m) => {
      const next = !m;
      try { localStorage.setItem('retro-timer-muted', String(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const startEdit = () => {
    if (r.timer.running) return;
    setDraft(`${mm}:${ss}`);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitEdit = () => {
    setEditing(false);
    const [mPart, sPart] = draft.split(':');
    const mins = parseInt(mPart ?? '0', 10) || 0;
    const secs = parseInt(sPart ?? '0', 10) || 0;
    const total = Math.max(10, Math.min(3600, mins * 60 + secs));
    r.setTimer(() => ({ running: false, secs: total, set: total }));
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '4px 4px 4px 10px', borderRadius: 999,
      border: `1.5px solid ${low ? PALETTE.phases.improve.hero : PALETTE.line}`,
      background: low ? PALETTE.phases.improve.soft : 'transparent',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0,
        width: pct + '%', background: PALETTE.phases.wentWell.soft,
        opacity: r.timer.running ? .6 : 0,
        transition: 'width 1s linear, opacity .2s', zIndex: 0,
      }} />
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false); }}
          style={{
            fontFamily: FF.jetbrains, fontWeight: 600, fontSize: 14, color: PALETTE.ink,
            fontVariantNumeric: 'tabular-nums', zIndex: 1, width: 52, textAlign: 'center',
            border: 'none', outline: 'none', background: 'transparent',
          }}
        />
      ) : (
        <div
          onClick={startEdit}
          title={r.timer.running ? '' : 'Click to edit duration'}
          style={{
            fontFamily: FF.jetbrains, fontWeight: 600, fontSize: 14, color: PALETTE.ink,
            fontVariantNumeric: 'tabular-nums', zIndex: 1, minWidth: 42, textAlign: 'center',
            cursor: r.timer.running ? 'default' : 'text',
          }}
        >
          {mm}:{ss}
        </div>
      )}

      {/* Play / pause — initialise AudioContext on click to satisfy browser autoplay policy */}
      <button
        onClick={() => { getCtx(); r.setTimer((t) => ({ ...t, running: !t.running, secs: t.secs === 0 ? t.set : t.secs })); }}
        style={{
          border: 'none',
          background: r.timer.running ? PALETTE.ink : PALETTE.phases.continue.hero,
          color: r.timer.running ? PALETTE.paper : PALETTE.phases.continue.ink,
          width: 26, height: 26, borderRadius: 999, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1, flexShrink: 0,
        }}
      >
        {r.timer.running
          ? <svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor"><rect x="0" y="0" width="3" height="9" rx="1"/><rect x="6" y="0" width="3" height="9" rx="1"/></svg>
          : <svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor"><path d="M1 0l7 4.5L1 9z"/></svg>
        }
      </button>

      {/* Mute toggle */}
      <button
        onClick={toggleMute}
        title={muted ? 'Unmute timer' : 'Mute timer'}
        style={{
          border: 'none', background: 'transparent', cursor: 'pointer',
          color: muted ? PALETTE.mute : PALETTE.ink,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1, flexShrink: 0, padding: '0 2px',
          opacity: muted ? 0.45 : 1,
        }}
      >
        {muted
          ? <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 2.5 4 5.5H1.5v3H4l3 3V2.5Z" /><path d="M11 5l-4 4M11 9l-4-4" />
            </svg>
          : <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 2.5 4 5.5H1.5v3H4l3 3V2.5Z" /><path d="M9.5 5a3 3 0 0 1 0 4" /><path d="M11.5 3a6 6 0 0 1 0 8" />
            </svg>
        }
      </button>
    </div>
  );
}

// ── AI Summary modal ──────────────────────────────────────────────────────────
interface SummaryData {
  headline: string;
  strengths: string[];
  friction: string[];
  actions: string[];
  focus: string;
}

function SummaryModal({ sprintName, code, onClose }: { sprintName: string; code: string; onClose: () => void }) {
  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading');
  const [data,  setData]  = useState<SummaryData | null>(null);

  useEffect(() => {
    fetch('/api/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode: code, sprintName }),
    })
      .then((r) => r.json())
      .then((json) => { if (json.summary) { setData(json.summary); setState('done'); } else setState('error'); })
      .catch(() => setState('error'));
  }, [code, sprintName]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(31,27,46,.55)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: PALETTE.paper, borderRadius: 16, width: '100%', maxWidth: 560,
        maxHeight: '85vh', overflowY: 'auto',
        boxShadow: '0 24px 64px rgba(0,0,0,.18)',
        fontFamily: FF.schibsted,
      }}>
        {/* Modal header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${PALETTE.line}`, display: 'flex', alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: PALETTE.mute, marginBottom: 2 }}>AI Summary</div>
            <div style={{ fontFamily: FF.bricolage, fontWeight: 800, fontSize: 20, color: PALETTE.ink, letterSpacing: '-0.02em' }}>{sprintName}</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'rgba(31,27,46,.06)', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 18, color: PALETTE.mute, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        {/* Content */}
        <div style={{ padding: '20px 24px 24px' }}>
          {state === 'loading' && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: PALETTE.mute }}>
              <div style={{ width: 24, height: 24, border: `2.5px solid ${PALETTE.line}`, borderTopColor: PALETTE.ink, borderRadius: '50%', animation: 'spin 700ms linear infinite', margin: '0 auto 12px' }} />
              Analysing your retro…
            </div>
          )}
          {state === 'error' && (
            <div style={{ color: PALETTE.phases.improve.ink, background: PALETTE.phases.improve.soft, padding: '12px 16px', borderRadius: 8, fontSize: 13 }}>
              Could not generate summary. Make sure <b>GROQ_API_KEY</b> is set in your environment variables.
            </div>
          )}
          {state === 'done' && data && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {/* Headline */}
              <div style={{ background: PALETTE.phases.wentWell.soft, borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: PALETTE.phases.wentWell.ink, marginBottom: 4 }}>Sprint mood</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: PALETTE.ink, lineHeight: 1.4 }}>{data.headline}</div>
              </div>

              {/* Strengths */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: PALETTE.phases.continue.ink, marginBottom: 8 }}>✓ What worked</div>
                {data.strengths.map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 99, background: PALETTE.phases.continue.hero, marginTop: 6, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: PALETTE.ink, lineHeight: 1.5 }}>{s}</span>
                  </div>
                ))}
              </div>

              {/* Friction */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: PALETTE.phases.improve.ink, marginBottom: 8 }}>⚠ Friction points</div>
                {data.friction.map((f, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 99, background: PALETTE.phases.improve.hero, marginTop: 6, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: PALETTE.ink, lineHeight: 1.5 }}>{f}</span>
                  </div>
                ))}
              </div>

              {/* Actions */}
              {data.actions.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: PALETTE.phases.actions.ink, marginBottom: 8 }}>→ Action items</div>
                  {data.actions.map((a, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                      <span style={{ width: 6, height: 6, borderRadius: 99, background: PALETTE.phases.actions.hero, marginTop: 6, flexShrink: 0 }} />
                      <span style={{ fontSize: 13, color: PALETTE.ink, lineHeight: 1.5 }}>{a}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Focus */}
              <div style={{ background: PALETTE.phases.actions.soft, borderRadius: 10, padding: '14px 16px', borderLeft: `3px solid ${PALETTE.phases.actions.hero}` }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: PALETTE.phases.actions.ink, marginBottom: 4 }}>Focus next sprint</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: PALETTE.ink, lineHeight: 1.4 }}>{data.focus}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────
function RetroHeader({ sprintName, team, code }: { sprintName: string; team: string; code: string }) {
  const r = useRetro();
  const [linkCopied,   setLinkCopied]   = useState(false);
  const [showSummary,  setShowSummary]  = useState(false);
  const copyLink = () => {
    navigator.clipboard.writeText(window.location.origin + '/?code=' + code).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  };
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 18, padding: '12px 24px',
      background: PALETTE.paper, borderBottom: `1px solid rgba(0,0,0,.07)`, flexShrink: 0,
    }}>
      {/* Brand + sprint */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8, position: 'relative', flexShrink: 0,
          background: PALETTE.phases.wentWell.hero,
          boxShadow: `4px 4px 0 ${PALETTE.phases.improve.hero}`,
        }}>
          <div style={{ position: 'absolute', inset: 4, borderRadius: 5, background: PALETTE.phases.actions.hero }} />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontFamily: FF.bricolage, fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em', lineHeight: 1, color: PALETTE.ink }}>
              {sprintName}
            </div>
            <Link href="/" style={{
              fontSize: 10, fontFamily: FF.jetbrains, fontWeight: 600,
              color: PALETTE.mute, textDecoration: 'none',
              padding: '3px 7px', borderRadius: 999, background: 'rgba(31,27,46,.05)',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5.5 2L2 5l3.5 3M2 5h6"/>
              </svg>
              lobby
            </Link>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, fontSize: 11, color: PALETTE.mute, fontFamily: FF.jetbrains }}>
            {team && <><span style={{ fontWeight: 600, color: PALETTE.ink }}>{team}</span><span style={{ width: 3, height: 3, borderRadius: 3, background: 'currentColor', opacity: .5 }} /></>}
            <span>code · <b style={{ color: PALETTE.ink }}>{code}</b></span>
            <button onClick={copyLink} style={{
              border: 'none', background: linkCopied ? PALETTE.phases.continue.soft : 'rgba(31,27,46,.06)',
              color: linkCopied ? PALETTE.phases.continue.ink : PALETTE.mute,
              padding: '2px 7px', borderRadius: 5, cursor: 'pointer',
              fontSize: 10, fontWeight: 700, fontFamily: FF.schibsted,
              display: 'inline-flex', alignItems: 'center', gap: 4,
              transition: 'background .15s, color .15s',
            }}>
              {linkCopied ? (
                <><svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 6l3 3 5-5"/></svg> Copied!</>
              ) : (
                <><svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 5H5a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2V7"/><path d="M7 1h4v4"/><path d="M12 1L7 6"/></svg> Copy link</>
              )}
            </button>
          </div>
        </div>
      </div>

      <div style={{ flex: 1 }} />

      {/* Phase selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {PHASES.map((p) => {
          const active = p.id === r.activePhase;
          const pc     = PALETTE.phases[p.id];
          return (
            <button key={p.id} onClick={() => r.setActivePhase(p.id)} style={{
              border: 'none', cursor: 'pointer',
              padding: active ? '6px 12px' : '6px 10px',
              background: active ? pc.hero : 'transparent',
              color: active ? pc.ink : PALETTE.mute,
              borderRadius: 999, fontSize: 12, fontWeight: 700, fontFamily: FF.schibsted,
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'background .15s, color .15s, padding .15s',
            }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: pc.hero, outline: active ? `2px solid ${pc.ink}` : 'none', outlineOffset: -2 }} />
              {p.title}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1 }} />

      {/* Facilitator controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={() => r.isCreator && r.setRevealed((v) => !v)}
          disabled={!r.isCreator}
          title={r.isCreator ? '' : 'Only the room creator can reveal cards'}
          style={{
            border: 'none',
            background: r.revealed ? 'rgba(31,27,46,.06)' : PALETTE.phases.improve.hero,
            padding: '6px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
            color: r.revealed ? PALETTE.mute : PALETTE.phases.improve.ink,
            cursor: r.isCreator ? 'pointer' : 'not-allowed',
            fontFamily: FF.schibsted,
            display: 'flex', alignItems: 'center', gap: 5,
            opacity: r.isCreator ? 1 : 0.45,
          }}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8">
            {r.revealed
              ? <><circle cx="6" cy="6" r="2.2"/><path d="M1 6c1.5-3 3.4-4.5 5-4.5S9.5 3 11 6c-1.5 3-3.4 4.5-5 4.5S2.5 9 1 6Z"/></>
              : <><path d="M2 2l8 8M3.4 3.6C1.9 5 1 6 1 6c1.5 3 3.4 4.5 5 4.5 1.1 0 2.2-.5 3.3-1.3M5.3 4.4A2.2 2.2 0 0 1 8.2 7.3"/></>
            }
          </svg>
          {r.revealed ? 'Revealed' : 'Hidden'}
        </button>

        <TimerPill />

        <button onClick={() => {
          const next = PHASES[(PHASE_IDX[r.activePhase] + 1) % PHASES.length];
          r.setActivePhase(next.id);
          r.setTimer((t) => ({ ...t, secs: t.set, running: true }));
        }} style={{
          border: 'none', background: PALETTE.ink, color: PALETTE.paper,
          padding: '8px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700,
          cursor: 'pointer', fontFamily: FF.schibsted,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          Next phase
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 6h7M6 3l3 3-3 3" />
          </svg>
        </button>

        {r.isCreator && r.cards.length > 0 && (
          <button onClick={() => setShowSummary(true)} style={{
            border: 'none', background: PALETTE.phases.wentWell.hero, color: PALETTE.phases.wentWell.ink,
            padding: '8px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700,
            cursor: 'pointer', fontFamily: FF.schibsted,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            ✨ Wrap up
          </button>
        )}
      </div>

      {showSummary && <SummaryModal sprintName={sprintName} code={code} onClose={() => setShowSummary(false)} />}
    </div>
  );
}

// ── Subheader ─────────────────────────────────────────────────────────────────
function BoardSubheader({ sprintName, code }: { sprintName: string; code: string }) {
  const r          = useRetro();
  const totalCards = r.cards.length;
  const totalVotes = r.cards.reduce((a, c) => a + c.votes, 0);

  const namedParticipants = r.participants.filter((p) => p !== 'Anon');
  const hasAnon           = r.participants.includes('Anon');
  const totalJoined       = r.participants.length;

  const [showParts, setShowParts] = useState(false);
  const partsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showParts) return;
    const off = (e: PointerEvent) => {
      if (partsRef.current && !partsRef.current.contains(e.target as Node)) setShowParts(false);
    };
    document.addEventListener('pointerdown', off, true);
    return () => document.removeEventListener('pointerdown', off, true);
  }, [showParts]);

  const exportPdf = () => {
    const phaseRows = PHASES.map((ph) => {
      const pCards = r.cards.filter((c) => c.phase === ph.id).sort((a, b) => b.votes - a.votes);
      const pc     = PALETTE.phases[ph.id];
      const cardHtml = pCards.map((c) => `
        <div style="background:${pc.sticky};border-radius:4px;padding:12px 14px;margin-bottom:8px;break-inside:avoid;">
          <div style="font-size:14px;line-height:1.4;color:${pc.ink};margin-bottom:6px;">${c.text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
          <div style="font-size:11px;opacity:.7;color:${pc.ink};display:flex;gap:10px;">
            <span>${c.author}</span>
            ${c.votes > 0 ? `<span>▲ ${c.votes}</span>` : ''}
            ${c.assignee ? `<span>→ ${c.assignee}</span>` : ''}
          </div>
        </div>`).join('');
      return `
        <div style="break-inside:avoid-page;margin-bottom:28px;">
          <h2 style="font-size:18px;font-weight:700;margin:0 0 12px;color:${pc.ink};border-left:4px solid ${pc.hero};padding-left:10px;">${ph.title} <span style="font-size:13px;font-weight:400;opacity:.6;">(${pCards.length})</span></h2>
          ${cardHtml || '<p style="color:#888;font-size:13px;">No cards</p>'}
        </div>`;
    }).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${sprintName}</title>
      <style>
        body{font-family:system-ui,sans-serif;padding:32px;color:#1F1B2E;background:#FFF8EC;margin:0}
        h1{font-size:24px;margin:0 0 6px}
        .meta{font-size:12px;color:#6B6478;margin-bottom:28px}
        @media print{body{padding:20px}@page{margin:1.5cm}}
      </style></head><body>
      <h1>${sprintName}</h1>
      <div class="meta">Room: ${code} · ${totalCards} cards · ${totalVotes} votes · ${totalJoined} joined · Exported ${new Date().toLocaleDateString()}</div>
      ${phaseRows}
      <script>window.print();<\/script>
    </body></html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    const win  = window.open(url, '_blank');
    if (win) {
      win.addEventListener('afterprint', () => { URL.revokeObjectURL(url); win.close(); });
    } else {
      // Popup blocked — fall back to same-tab navigation
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sprintName}.html`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, padding: '8px 24px',
      borderBottom: `1px solid rgba(0,0,0,.07)`,
      background: PALETTE.paper, flexShrink: 0,
    }}>
      <div ref={partsRef} style={{ position: 'relative' }}>
        <button onClick={() => setShowParts((v) => !v)} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          border: 'none', background: showParts ? 'rgba(31,27,46,.06)' : 'transparent',
          borderRadius: 8, padding: '4px 8px 4px 4px', cursor: 'pointer',
        }}>
          <div style={{ display: 'flex' }}>
            {namedParticipants.slice(0, 5).map((a, i) => (
              <div key={a} style={{ marginLeft: i === 0 ? 0 : -6, boxShadow: `0 0 0 2px ${PALETTE.paper}`, borderRadius: 999, zIndex: 5 - i, position: 'relative' }}>
                <Avatar name={a} size={24} />
              </div>
            ))}
            {hasAnon && (
              <div style={{ marginLeft: namedParticipants.length > 0 ? -6 : 0, boxShadow: `0 0 0 2px ${PALETTE.paper}`, borderRadius: 999 }}>
                <Avatar name="Anon" size={24} />
              </div>
            )}
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: PALETTE.mute }}>
            <b style={{ color: PALETTE.ink }}>{totalJoined}</b> joined
          </div>
        </button>

        {showParts && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 50,
            background: '#fff', borderRadius: 10, minWidth: 200,
            boxShadow: '0 8px 24px rgba(0,0,0,.12), 0 0 0 1px rgba(0,0,0,.07)',
            padding: '6px 0', fontFamily: FF.schibsted,
          }}>
            <div style={{ padding: '6px 14px 8px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: PALETTE.mute }}>
              {totalJoined} in this room
            </div>
            {r.participants.map((name) => (
              <div key={name} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '6px 14px',
              }}>
                <Avatar name={name} size={22} />
                <span style={{ fontSize: 13, fontWeight: 500, color: PALETTE.ink }}>
                  {name}
                  {name === r.userName && <span style={{ fontSize: 10, color: PALETTE.mute, marginLeft: 6, fontWeight: 600 }}>you</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ width: 1, height: 18, background: PALETTE.line }} />

      <div style={{ fontSize: 12, color: PALETTE.mute, display: 'flex', gap: 10 }}>
        <span><b style={{ color: PALETTE.ink, fontFamily: FF.jetbrains }}>{totalCards}</b> cards</span>
        <span><b style={{ color: PALETTE.ink, fontFamily: FF.jetbrains }}>{totalVotes}</b> votes</span>
      </div>

      <div style={{ flex: 1 }} />

      <button onClick={exportPdf} style={{
        border: `1px solid ${PALETTE.line}`, background: 'transparent', color: PALETTE.ink,
        padding: '5px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600,
        cursor: 'pointer', fontFamily: FF.schibsted,
        display: 'flex', alignItems: 'center', gap: 5,
      }}>
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M6 1v7M3 5l3 3 3-3M2 10h8"/>
        </svg>
        Export PDF
      </button>
    </div>
  );
}

// ── Global CSS ────────────────────────────────────────────────────────────────
const BOARD_CSS = `
  @keyframes confettiFall {
    0%   { transform: translate3d(0,0,0) rotate(0); opacity: 1; }
    100% { transform: translate3d(var(--cx,0), var(--cy,400px), 0) rotate(var(--cr,540deg)); opacity: 0; }
  }
  @keyframes voteBump { 0% { transform:scale(1); } 40% { transform:scale(1.35); } 100% { transform:scale(1); } }
  .vote-bump { animation: voteBump 280ms ease-out; }
  @keyframes spotlightPulse {
    0%, 100% { transform: scale(1); }
    50%       { transform: scale(1.008); }
  }
  @keyframes spotlightDot {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.3; }
  }
  .spotlight-card { animation: spotlightPulse 2s ease-in-out infinite; }
  .spotlight-dot  { animation: spotlightDot  1.2s ease-in-out infinite; }
  .retro-card::after {
    content: '';
    position: absolute;
    bottom: 0; right: 0;
    width: 20px; height: 20px;
    background: linear-gradient(225deg, rgba(0,0,0,.12) 45%, transparent 45%);
    border-radius: 0 0 10px 0;
    pointer-events: none;
  }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-thumb { background: rgba(31,27,46,.18); border-radius: 3px; }
  ::-webkit-scrollbar-track { background: transparent; }
`;

// ── Sticky board ──────────────────────────────────────────────────────────────
function StickyBoard({ sprintName, team, code }: { sprintName: string; team: string; code: string }) {
  return (
    <div style={{
      width: '100%', height: '100vh',
      background: PALETTE.paper,
      color: PALETTE.ink,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      fontFamily: FF.schibsted,
    }}>
      <style>{BOARD_CSS}</style>
      <RetroHeader sprintName={sprintName} team={team} code={code} />
      <BoardSubheader sprintName={sprintName} code={code} />
      <div style={{
        flex: 1, minHeight: 0,
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 12, padding: '16px 20px 20px',
      }}>
        {PHASES.map((p) => <RetroColumn key={p.id} phaseId={p.id} />)}
      </div>
      <DragGhost />
      <ConfettiLayer />
    </div>
  );
}

// ── Board content ─────────────────────────────────────────────────────────────
function BoardContent() {
  const params     = useSearchParams();
  const code       = params.get('code') ?? 'RETRO7';
  const name       = params.get('name') ?? 'You';
  const sprint     = params.get('sprint');
  const team       = params.get('team') ?? '';
  const sprintName = sprint ?? `Retro · ${code}`;

  return (
    <RetroProvider userName={name} roomCode={code} team={team}>
      <StickyBoard sprintName={sprintName} team={team} code={code} />
    </RetroProvider>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function BoardPage() {
  return (
    <Suspense fallback={
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#FFF8EC', fontFamily: 'system-ui', color: '#6B6478', fontSize: 14 }}>
        Opening room…
      </div>
    }>
      <BoardContent />
    </Suspense>
  );
}
