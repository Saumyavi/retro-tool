import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  const { roomCode, sprintName } = await req.json();
  if (!roomCode) return NextResponse.json({ error: 'roomCode required' }, { status: 400 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const { data: cards } = await supabase
    .from('retro_cards')
    .select('phase, text, votes, assignee, due')
    .eq('room_code', roomCode)
    .order('votes', { ascending: false });

  if (!cards || cards.length === 0) {
    return NextResponse.json({ error: 'No cards found' }, { status: 400 });
  }

  const fmt = (phase: string) =>
    cards.filter((c) => c.phase === phase)
      .map((c) => `  - ${c.text}${c.votes > 0 ? ` [${c.votes} votes]` : ''}${c.assignee ? ` → ${c.assignee}` : ''}${c.due ? ` by ${c.due}` : ''}`)
      .join('\n') || '  (none)';

  const prompt = `You are summarizing a sprint retrospective titled "${sprintName || roomCode}".

WENT WELL:
${fmt('wentWell')}

CONTINUE DOING:
${fmt('continue')}

TO IMPROVE:
${fmt('improve')}

ACTION ITEMS:
${fmt('actions')}

Return ONLY valid JSON, no markdown, no explanation:
{
  "headline": "one punchy sentence capturing the overall sprint mood",
  "strengths": ["2-3 synthesized strengths (not verbatim card text)"],
  "friction": ["2-3 main friction points to address"],
  "actions": ["each action item, concise"],
  "focus": "the single most important thing the team should focus on next sprint"
}`;

  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    });
    const raw = completion.choices[0].message.content?.trim() ?? '';
    const jsonStart = raw.indexOf('{');
    const jsonEnd   = raw.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON in response');
    const summary = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
    return NextResponse.json({ summary });
  } catch (err) {
    console.error('[summary] error:', err);
    return NextResponse.json({ error: 'Failed to generate summary', detail: String(err) }, { status: 500 });
  }
}
