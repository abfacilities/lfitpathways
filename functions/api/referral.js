// Sends the L-Fit Pathways referral form to the DSLs' inboxes via the Resend REST API.
//
// Cloudflare Pages Function. Calls Resend directly via fetch (no npm SDK) since
// Pages Functions doesn't run `npm install` for the functions/ bundle.
//
// Required environment variable (set in Cloudflare Pages project settings, never in git):
//   RESEND_API_KEY     - API key from resend.com
//
// Optional environment variables:
//   REFERRAL_TO_EMAIL   - Comma-separated list of recipients. Defaults to both DSLs:
//                          adam.byrne@lfitpathways.com,craig.lloyd@lfitpathways.com
//   REFERRAL_FROM_EMAIL - Verified sending address, e.g. "L-Fit Pathways <referrals@lfitpathways.com>".
//                          Defaults to Resend's shared sandbox sender.

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.RESEND_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'The referral form is not fully set up yet. Please call or email us directly instead.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let fields = {};
  let botField;
  try {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await request.json();
      botField = body['bot-field'];
      fields = body;
    } else {
      const form = await request.formData();
      botField = form.get('bot-field');
      for (const key of [
        'referrer_type', 'your_name', 'email', 'phone',
        'child_name', 'child_age', 'provisions_interest', 'details', 'safeguarding'
      ]) {
        fields[key] = form.get(key);
      }
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid request' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Honeypot: bots fill hidden fields, real users leave it blank.
  if (botField) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { referrer_type, your_name, email, phone, child_name, child_age, provisions_interest, details, safeguarding } = fields;

  if (!your_name || !email || !phone || !child_name || !child_age || !details || !safeguarding) {
    return new Response(JSON.stringify({ error: 'Please fill in all required fields.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const toEmails = (env.REFERRAL_TO_EMAIL || 'adam.byrne@lfitpathways.com,craig.lloyd@lfitpathways.com')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  const fromEmail = env.REFERRAL_FROM_EMAIL || 'L-Fit Pathways Website <onboarding@resend.dev>';

  const lines = [
    `Referrer type: ${referrer_type || '(not given)'}`,
    `Referrer name: ${your_name}`,
    `Referrer email: ${email}`,
    `Referrer phone: ${phone}`,
    '',
    `Young person's name: ${child_name}`,
    `Young person's age: ${child_age}`,
    `Provisions of interest: ${provisions_interest || '(not given)'}`,
    '',
    'Details / support needed:',
    details,
    '',
    'Safeguarding concerns, medical needs or risk factors:',
    safeguarding
  ];

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromEmail,
        to: toEmails,
        reply_to: email,
        subject: `New referral: ${child_name} (from ${your_name})`,
        text: lines.join('\n')
      })
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      return new Response(
        JSON.stringify({ error: 'Could not submit your referral. Please try again or contact us directly.', detail: errText }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Could not submit your referral. Please try again or contact us directly.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export async function onRequestGet() {
  return new Response('Method Not Allowed', { status: 405 });
}
