'use client';

import { useState, useEffect, useRef, useCallback, CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// ── Design tokens ────────────────────────────────────────────────────────────
const C = {
  paper:      'var(--paper)',
  ink:        'var(--ink)',
  mute:       'var(--mute)',
  line:       'var(--line)',
  yellow:     'var(--yellow)',
  green:      'var(--green)',
  pink:       'var(--pink)',
  blue:       'var(--blue)',
  yellowSoft: 'var(--yellow-soft)',
  greenSoft:  'var(--green-soft)',
  pinkSoft:   'var(--pink-soft)',
  blueSoft:   'var(--blue-soft)',
};

const FF = {
  bricolage: 'var(--ff-bricolage)',
  schibsted:  'var(--ff-schibsted)',
  caveat:    'var(--ff-caveat)',
  jetbrains: 'var(--ff-jetbrains)',
};

// ── Room code generator ──────────────────────────────────────────────────────
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
function generateRoomCode(): string {
  return Array.from({ length: CODE_LEN }, () =>
    CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)],
  ).join('');
}

const FLOATERS = [
  { text: 'ship-it Friday!',          color: 'yellowSoft', pos: { top: '12%',    left: '8%'   }, r: -7 },
  { text: 'pair more often',          color: 'greenSoft',  pos: { top: '22%',    right: '10%' }, r: 6  },
  { text: 'staging runbook by Mon',   color: 'blueSoft',   pos: { bottom: '14%', right: '6%'  }, r: -4 },
  { text: 'review queue Thursdays?',  color: 'pinkSoft',   pos: { bottom: '18%', left: '7%'   }, r: 5  },
  { text: 'demos worth the noise',    color: 'yellowSoft', pos: { top: '52%',    left: '4%'   }, r: 3  },
  { text: 'async standups · keep',    color: 'greenSoft',  pos: { top: '60%',    right: '4%'  }, r: -6 },
];

const CODE_LEN = 6;

// ── Label style ──────────────────────────────────────────────────────────────
const lblStyle: CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '.06em',
  color: C.mute,
  marginBottom: 6,
};

// ── Arrow icon ───────────────────────────────────────────────────────────────
function Arrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7h8M7 3l4 4-4 4" />
    </svg>
  );
}

// ── Code input ───────────────────────────────────────────────────────────────
function CodeInput({
  value,
  onChange,
  onComplete,
  errorKey,
  validKey,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  errorKey: number | null;
  validKey: number | null;
  disabled: boolean;
}) {
  const hiddenRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const focus = () => hiddenRef.current?.focus();

  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LEN);
    onChange(raw);
    if (raw.length === CODE_LEN) onComplete?.(raw);
  };

  const activeIdx = Math.min(value.length, CODE_LEN - 1);

  return (
    <div style={{ display: 'flex', gap: 8 }} onClick={focus}>
      <input
        ref={hiddenRef}
        type="text"
        inputMode="text"
        autoComplete="one-time-code"
        maxLength={CODE_LEN}
        value={value}
        onChange={handle}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={disabled}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', left: -1000 }}
      />
      {Array.from({ length: CODE_LEN }).map((_, i) => {
        const ch = value[i];
        const isActive = focused && i === activeIdx && !disabled;
        const hasError = !!errorKey && !ch;
        const hasValid = !!validKey;

        return (
          <div
            key={`${i}-${errorKey ?? ''}-${validKey ?? ''}`}
            style={{
              flex: 1,
              aspectRatio: '1 / 1.05',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: FF.bricolage,
              fontWeight: 700,
              fontSize: 30,
              letterSpacing: '-0.02em',
              background: hasError
                ? C.pinkSoft
                : hasValid
                ? C.greenSoft
                : ch
                ? C.paper
                : 'rgba(31,27,46,.04)',
              border: `1.5px solid ${
                hasError
                  ? C.pink
                  : isActive
                  ? C.ink
                  : ch
                  ? 'rgba(31,27,46,.35)'
                  : C.line
              }`,
              borderRadius: 10,
              color: C.ink,
              textTransform: 'uppercase',
              cursor: 'text',
              boxShadow: isActive ? '0 0 0 3px rgba(31,27,46,.08)' : 'none',
              transition: 'background .15s, border-color .15s, box-shadow .15s',
              animation: hasError
                ? 'shake .35s ease-out'
                : hasValid
                ? 'validPulse .6s ease-out'
                : 'none',
            }}
          >
            {ch || (isActive && (
              <span style={{
                width: 2,
                height: 22,
                background: C.ink,
                animation: 'blink 1.1s steps(1) infinite',
              }} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── Tab segmented control ─────────────────────────────────────────────────────
function TabSeg({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [thumb, setThumb] = useState({ left: 3, width: 0 });
  const refs = useRef<Record<string, HTMLButtonElement>>({});

  useEffect(() => {
    const el = refs.current[value];
    if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value]);

  const tabs = [
    { id: 'join',   label: 'Join a retro' },
    { id: 'create', label: 'Start new'    },
  ];

  return (
    <div style={{
      display: 'flex', padding: 3,
      background: 'rgba(31,27,46,.06)',
      borderRadius: '999px',
      marginBottom: 22,
      position: 'relative',
    }}>
      <span style={{
        position: 'absolute',
        top: 3, bottom: 3,
        left: thumb.left,
        width: thumb.width,
        background: C.paper,
        borderRadius: '999px',
        boxShadow: `0 1px 2px rgba(31,27,46,.12), 0 0 0 1px ${C.line}`,
        transition: 'left .2s cubic-bezier(.3,.7,.4,1), width .2s',
      }} />
      {tabs.map((t) => (
        <button
          key={t.id}
          ref={(el) => { if (el) refs.current[t.id] = el; }}
          onClick={() => onChange(t.id)}
          style={{
            flex: 1, border: 0, background: 'transparent',
            fontFamily: FF.schibsted, fontWeight: 600, fontSize: 13,
            color: value === t.id ? C.ink : C.mute,
            padding: '8px 12px',
            borderRadius: '999px',
            cursor: 'pointer',
            transition: 'color .15s',
            position: 'relative', zIndex: 1,
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Create panel ──────────────────────────────────────────────────────────────
function CreatePanel({
  initialName,
  onSubmit,
  submitting,
}: {
  initialName: string;
  onSubmit: (payload: { code: string; name: string; sprint: string; team: string }) => void;
  submitting: boolean;
}) {
  const [sprint,     setSprint]     = useState('Sprint 48');
  const [team,       setTeam]       = useState('Platform team');
  const [localName,  setLocalName]  = useState(initialName);
  const [localAnon,  setLocalAnon]  = useState(false);
  const [code]                      = useState(() => generateRoomCode());

  const canSubmit = (localAnon || localName.trim()) && !submitting;

  const inputStyle: CSSProperties = {
    width: '100%',
    fontFamily: FF.schibsted, fontSize: 15,
    padding: '12px 14px',
    border: `1.5px solid ${C.line}`,
    borderRadius: 10,
    background: 'rgba(31,27,46,.04)',
    color: C.ink,
    outline: 'none',
    transition: 'background .15s, border-color .15s, box-shadow .15s',
  };

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <label style={lblStyle}>Sprint name</label>
        <input style={inputStyle} value={sprint} onChange={(e) => setSprint(e.target.value)} placeholder="Sprint 48" />
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={lblStyle}>Team</label>
        <input style={inputStyle} value={team} onChange={(e) => setTeam(e.target.value)} placeholder="Platform team" />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={lblStyle}>Your name</label>
        <input
          className="name-field"
          style={{ ...inputStyle, opacity: localAnon ? 0.5 : 1 }}
          type="text" maxLength={32}
          value={localAnon ? '' : localName}
          onChange={(e) => setLocalName(e.target.value)}
          placeholder={localAnon ? 'joining anonymously…' : 'what should the team call you?'}
          disabled={localAnon || submitting}
        />
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 12px', background: 'rgba(31,27,46,.03)',
        borderRadius: 10, marginBottom: 14,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>Join anonymously</div>
          <div style={{ fontSize: 11, color: C.mute, marginTop: 2 }}>your cards will say "Anon"</div>
        </div>
        <button
          onClick={() => setLocalAnon((a) => !a)}
          disabled={submitting}
          style={{
            position: 'relative', width: 32, height: 18, border: 0, borderRadius: '999px',
            background: localAnon ? C.ink : 'rgba(31,27,46,.18)',
            cursor: 'pointer', transition: 'background .15s', padding: 0, flexShrink: 0,
          }}
        >
          <span style={{
            position: 'absolute', top: 2, left: 2, width: 14, height: 14,
            borderRadius: '50%', background: '#fff',
            boxShadow: '0 1px 2px rgba(0,0,0,.25)',
            transition: 'transform .15s', display: 'block',
            transform: localAnon ? 'translateX(14px)' : 'none',
          }} />
        </button>
      </div>
      <div style={{
        marginBottom: 18,
        padding: '12px 14px',
        background: C.greenSoft,
        borderRadius: 10,
        color: C.ink,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', opacity: 0.65 }}>
            Your room code
          </div>
          <div style={{ fontFamily: FF.bricolage, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 2 }}>
            {code}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ fontFamily: FF.caveat, fontSize: 15, opacity: 0.75, maxWidth: 130, textAlign: 'right', lineHeight: 1.2 }}>
          share this with your team
        </div>
      </div>
      <button
        style={{
          width: '100%',
          fontFamily: FF.schibsted, fontWeight: 700, fontSize: 15,
          padding: '14px 16px', border: 0, borderRadius: 12,
          background: !canSubmit ? 'rgba(31,27,46,.12)' : C.ink,
          color: !canSubmit ? 'rgba(31,27,46,.4)' : C.paper,
          cursor: !canSubmit ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          boxShadow: !canSubmit ? 'none' : '0 3px 0 rgba(31,27,46,.18), 0 6px 16px rgba(31,27,46,.18)',
        }}
        disabled={!canSubmit}
        onClick={() => onSubmit({ code, name: localAnon ? 'Anon' : localName.trim(), sprint, team })}
      >
        {submitting
          ? <><span style={{ width: 16, height: 16, border: '2px solid rgba(255,248,236,.3)', borderTopColor: C.paper, borderRadius: '50%', animation: 'spin 700ms linear infinite', display: 'inline-block' }} /> Opening room…</>
          : <>Create &amp; open <Arrow /></>
        }
      </button>
    </>
  );
}

// ── Landing page ──────────────────────────────────────────────────────────────
export default function LandingPage() {
  const router = useRouter();
  const [tab, setTab]           = useState<'join' | 'create'>('join');
  const [code, setCode]         = useState('');
  const [name, setName]         = useState('');
  const [anon, setAnon]         = useState(false);
  const [errorKey, setErrorKey] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [hint, setHint]         = useState<{ kind: 'err'; text: string } | null>(null);

  const submit = useCallback(async () => {
    if (code.length !== CODE_LEN) {
      setErrorKey(Date.now());
      setHint({ kind: 'err', text: 'Enter the 6-character room code.' });
      return;
    }
    if (!anon && !name.trim()) {
      setHint({ kind: 'err', text: 'Drop your name, or join anonymously.' });
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.from('retro_rooms').select('code').eq('code', code).maybeSingle();
    // Only block when DB is reachable but room genuinely doesn't exist
    if (!error && data === null) {
      setSubmitting(false);
      setErrorKey(Date.now());
      setHint({ kind: 'err', text: "Room not found. Check the code and try again." });
      return;
    }
    router.push(
      '/board?code=' + encodeURIComponent(code) +
      '&name=' + encodeURIComponent(anon ? 'Anon' : name.trim()) +
      '&sprint=' + encodeURIComponent(`Retro · ${code}`) +
      (anon ? '&anon=1' : ''),
    );
  }, [code, name, anon, router]);

  const submitCreate = useCallback(async (payload: { code: string; name: string; sprint: string; team: string }) => {
    setSubmitting(true);
    try {
      await supabase.from('retro_rooms').insert({ code: payload.code, creator: payload.name });
    } catch { /* table may not exist yet — navigate anyway */ }
    try { localStorage.setItem('retro-creator-' + payload.code, '1'); } catch { /* ignore */ }
    router.push(
      '/board?code=' + encodeURIComponent(payload.code) +
      '&name=' + encodeURIComponent(payload.name) +
      '&sprint=' + encodeURIComponent(payload.sprint + ' · Retrospective') +
      (payload.name === 'Anon' ? '&anon=1' : ''),
    );
  }, [router]);

  const nameField: CSSProperties = {
    width: '100%',
    fontFamily: FF.schibsted, fontSize: 15,
    padding: '12px 14px',
    border: `1.5px solid ${C.line}`,
    borderRadius: 10,
    background: 'rgba(31,27,46,.04)',
    color: C.ink,
    outline: 'none',
    transition: 'background .15s, border-color .15s, box-shadow .15s',
    opacity: (anon || submitting) ? 0.5 : 1,
    cursor: (anon || submitting) ? 'not-allowed' : 'text',
  };

  const joinDisabled = submitting || code.length !== CODE_LEN || (!anon && !name.trim());
  // joinDisabled: requires a full code + name (or anon) — no session lookup needed

  return (
    <>
      <style>{`
        @keyframes drift {
          0%, 100% { transform: translateY(0) rotate(var(--r,0deg)); }
          50% { transform: translateY(-10px) rotate(calc(var(--r,0deg) - 0.5deg)); }
        }
        @keyframes blink { 50% { opacity: 0; } }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-4px); }
          40% { transform: translateX(4px); }
          60% { transform: translateX(-3px); }
          80% { transform: translateX(2px); }
        }
        @keyframes validPulse {
          0% { transform: scale(1); }
          40% { transform: scale(1.06); }
          100% { transform: scale(1); }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pop {
          0% { transform: scale(.94); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        .recent-pill:hover { background: var(--yellow-soft) !important; }
        .join-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 0 rgba(31,27,46,.18), 0 10px 22px rgba(31,27,46,.2) !important;
        }
        .join-btn:active:not(:disabled) {
          transform: translateY(1px);
          box-shadow: 0 1px 0 rgba(31,27,46,.18), 0 3px 10px rgba(31,27,46,.16) !important;
        }
        .name-field:focus {
          border-color: var(--ink) !important;
          background: var(--paper) !important;
          box-shadow: 0 0 0 3px rgba(31,27,46,.08) !important;
        }
      `}</style>

      {/* Dotted background */}
      <div style={{
        position: 'fixed', inset: 0,
        background: C.paper,
        backgroundImage: 'radial-gradient(rgba(31,27,46,.04) 1px, transparent 1px)',
        backgroundSize: '4px 4px',
        zIndex: 0,
      }} />

      {/* Floating sticky notes */}
      {FLOATERS.map((f, i) => (
        <div
          key={i}
          style={{
            position: 'fixed',
            ...(f.pos as CSSProperties),
            width: 168,
            padding: '16px 16px 18px',
            fontFamily: FF.schibsted,
            fontSize: 13,
            fontWeight: 500,
            lineHeight: 1.35,
            background: C[f.color as keyof typeof C],
            color: C.ink,
            boxShadow: '0 1px 0 rgba(0,0,0,.06), 0 8px 22px rgba(31,27,46,.12)',
            borderRadius: 4,
            animation: `drift 6s ease-in-out infinite`,
            animationDelay: `${i * 0.7}s`,
            opacity: 0.85,
            pointerEvents: 'none',
            userSelect: 'none',
            zIndex: 1,
            ['--r' as string]: `${f.r}deg`,
            transform: `rotate(${f.r}deg)`,
          }}
        >
          <div style={{ fontFamily: FF.caveat, fontSize: 18, fontWeight: 600, lineHeight: 1.2 }}>
            {f.text}
          </div>
          <div style={{ marginTop: 8, fontSize: 10, fontFamily: FF.jetbrains, opacity: 0.55, fontWeight: 600 }}>
            — anon
          </div>
        </div>
      ))}

      {/* Center stage */}
      <div style={{
        position: 'relative', zIndex: 5,
        minHeight: '100vh', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        padding: 32,
        overflowY: 'auto',
      }}>
        <div
          onKeyDown={(e) => { if (e.key === 'Enter' && tab === 'join') submit(); }}
          style={{
            position: 'relative',
            background: C.paper,
            width: 460,
            maxWidth: 'calc(100% - 32px)',
            padding: 32,
            borderRadius: 20,
            boxShadow: '0 1px 0 rgba(255,255,255,.7) inset, 0 1px 2px rgba(31,27,46,.04), 0 24px 60px rgba(31,27,46,.14), 0 6px 16px rgba(31,27,46,.06)',
            border: `1px solid ${C.line}`,
          }}
        >
          {/* Brand row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
            <div style={{
              width: 44, height: 44, position: 'relative',
              background: C.yellow, borderRadius: 10,
              boxShadow: `5px 5px 0 ${C.pink}`,
              flexShrink: 0,
            }}>
              <div style={{
                position: 'absolute', inset: 6,
                background: C.blue, borderRadius: 7,
              }} />
            </div>
            <div>
              <div style={{ fontFamily: FF.bricolage, fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em', lineHeight: 1 }}>
                Retro
              </div>
              <div style={{ fontSize: 11, fontFamily: FF.jetbrains, color: C.mute, marginTop: 4 }}>
                asynchronous retrospectives
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ fontFamily: FF.caveat, fontSize: 18, color: C.mute, maxWidth: 140, lineHeight: 1.2, textAlign: 'right' }}>
              hello, friend
            </div>
          </div>

          <TabSeg value={tab} onChange={(v) => setTab(v as 'join' | 'create')} />

          {tab === 'join' ? (
            <>
              {/* Code */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ ...lblStyle, marginBottom: 0 }}>Room code</label>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 10, color: C.mute, fontFamily: FF.jetbrains }}>6 chars</span>
                </div>
                <CodeInput
                  value={code}
                  onChange={(v) => { setCode(v); if (errorKey) setErrorKey(null); if (hint) setHint(null); }}
                  errorKey={errorKey}
                  validKey={null}
                  disabled={submitting}
                />
              </div>

              {/* Name */}
              <div style={{ marginBottom: 12 }}>
                <label style={lblStyle}>Your name</label>
                <input
                  className="name-field"
                  type="text"
                  value={anon ? '' : name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={anon ? 'joining anonymously…' : 'what should the team call you?'}
                  disabled={anon || submitting}
                  maxLength={32}
                  style={{
                    ...nameField,
                    fontFamily: FF.schibsted,
                  }}
                />
              </div>

              {/* Anon toggle */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px',
                background: 'rgba(31,27,46,.03)',
                borderRadius: 10,
                marginBottom: 18,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Join anonymously</div>
                  <div style={{ fontSize: 11, color: C.mute, marginTop: 2 }}>
                    your cards will say "Anon" — the team won't know which are yours.
                  </div>
                </div>
                <button
                  onClick={() => setAnon((a) => !a)}
                  disabled={submitting}
                  style={{
                    position: 'relative', width: 32, height: 18,
                    border: 0, borderRadius: '999px',
                    background: anon ? C.ink : 'rgba(31,27,46,.18)',
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    transition: 'background .15s', padding: 0,
                    flexShrink: 0,
                  }}
                >
                  <span style={{
                    position: 'absolute', top: 2, left: 2,
                    width: 14, height: 14, borderRadius: '50%',
                    background: '#fff',
                    boxShadow: '0 1px 2px rgba(0,0,0,.25)',
                    transition: 'transform .15s',
                    transform: anon ? 'translateX(14px)' : 'none',
                    display: 'block',
                  }} />
                </button>
              </div>

              {/* Hint */}
              {hint && (
                <div style={{
                  marginBottom: 14, padding: '8px 12px', borderRadius: 8,
                  fontSize: 12, fontWeight: 500,
                  background: hint.kind === 'err' ? C.pinkSoft : C.yellowSoft,
                  color: C.ink,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <circle cx="7" cy="7" r="6" />
                    <path d="M7 4v3.5M7 10v.01" />
                  </svg>
                  {hint.text}
                </div>
              )}

              {/* CTA */}
              <button
                className="join-btn"
                disabled={joinDisabled}
                onClick={submit}
                style={{
                  width: '100%',
                  fontFamily: FF.schibsted, fontWeight: 700, fontSize: 15,
                  padding: '14px 16px',
                  border: 0,
                  borderRadius: 12,
                  background: joinDisabled ? 'rgba(31,27,46,.12)' : C.ink,
                  color: joinDisabled ? 'rgba(31,27,46,.4)' : C.paper,
                  cursor: joinDisabled ? 'not-allowed' : 'pointer',
                  transition: 'transform .12s, box-shadow .15s, background .15s',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  boxShadow: joinDisabled ? 'none' : '0 3px 0 rgba(31,27,46,.18), 0 6px 16px rgba(31,27,46,.18)',
                }}
              >
                {submitting
                  ? <><span style={{ width: 16, height: 16, border: '2px solid rgba(255,248,236,.3)', borderTopColor: C.paper, borderRadius: '50%', animation: 'spin 700ms linear infinite', display: 'inline-block' }} /> Dropping you in…</>
                  : <>Drop in <Arrow /></>
                }
              </button>
            </>
          ) : (
            <CreatePanel
              initialName={name}
              onSubmit={submitCreate}
              submitting={submitting}
            />
          )}

          {/* Footer hint */}
          <div style={{ marginTop: 18, textAlign: 'center', fontSize: 12, color: C.mute }}>
            {tab === 'join' ? (
              <>No code?{' '}
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); setTab('create'); }}
                  style={{ color: C.ink, fontWeight: 600, textDecoration: 'none', borderBottom: `1.5px solid ${C.yellow}` }}
                >
                  Start a new retro →
                </a>
              </>
            ) : (
              <>Have a code?{' '}
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); setTab('join'); }}
                  style={{ color: C.ink, fontWeight: 600, textDecoration: 'none', borderBottom: `1.5px solid ${C.yellow}` }}
                >
                  Join one instead →
                </a>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Version mark */}
      <div style={{
        position: 'fixed', bottom: 16, left: 16, zIndex: 6,
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 11, fontFamily: FF.jetbrains, color: C.mute,
      }}>
        <span>made for happier retros · v0.4</span>
      </div>
    </>
  );
}
