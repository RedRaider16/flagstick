// Sends queued confirmation emails (public.email_outbox) through Resend.
// Called by the database right after messages are queued, and on a schedule
// for retries. It only ever sends what's already queued, so calling it is safe;
// the Resend key is read from this function's secrets and never leaves here.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { textToHtml } from './html.ts'

interface Mail { id: string; to_email: string; subject: string; body: string }

const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async () => {
  const key = Deno.env.get('RESEND_API_KEY')
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: st, error: stErr } = await sb.from('email_settings').select('enabled, from_name, from_address, reply_to').single()
  if (stErr) return json({ error: stErr.message }, 500)
  if (!st.enabled || !st.from_address) return json({ sent: 0, note: 'Sending is turned off.' })
  if (!key) return json({ sent: 0, note: 'RESEND_API_KEY is not set.' })

  let sent = 0
  let failed = 0
  for (let round = 0; round < 5; round++) {
    const { data: batch, error } = await sb.rpc('claim_emails', { p_limit: 20 })
    if (error) return json({ error: error.message, sent, failed }, 500)
    if (!batch || batch.length === 0) break
    for (const m of batch as Mail[]) {
      let ok = false
      let providerId: string | null = null
      let err: string | null = null
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': m.id },
          body: JSON.stringify({
            from: `${st.from_name} <${st.from_address}>`,
            to: [m.to_email],
            ...(st.reply_to ? { reply_to: st.reply_to } : {}),
            subject: m.subject,
            text: m.body,
            html: textToHtml(m.body, m.subject),
          }),
        })
        const out = await res.json().catch(() => ({}))
        ok = res.ok
        providerId = out?.id ?? null
        if (!ok) err = `${res.status}: ${out?.message ?? out?.name ?? 'send failed'}`
      } catch (e) {
        err = e instanceof Error ? e.message : String(e)
      }
      await sb.rpc('finish_email', { p_id: m.id, p_ok: ok, p_provider_id: providerId, p_error: err })
      if (ok) sent++
      else failed++
    }
  }
  return json({ sent, failed })
})
