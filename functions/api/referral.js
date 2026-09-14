// Sends the L-Fit Pathways referral form to the DSLs' inboxes via the Brevo
// (formerly Sendinblue) transactional email REST API.
//
// Cloudflare Pages Function. Calls Brevo directly via fetch (no npm SDK) since
// Pages Functions doesn't run `npm install` for the functions/ bundle.
//
// Required environment variable (set in Cloudflare Pages project settings, never in git):
//   BREVO_API_KEY       - API key from app.brevo.com/settings/keys/api
//
// Optional environment variables:
//   REFERRAL_TO_EMAIL   - Comma-separated list of recipients. Defaults to both DSLs:
//                          adam.byrne@lfitpathways.com,craig.lloyd@lfitpathways.com
//   REFERRAL_FROM_EMAIL - Verified sending address, e.g. "L-Fit Pathways <referrals@lfitpathways.com>".
//                          Defaults to the Brevo account's auto-verified sender.

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.BREVO_API_KEY) {
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

  // Brevo wants { email, name } sender/recipient objects rather than a combined
  // "Name <email>" string. Default sender is the auto-verified Brevo account sender.
  const fromName = env.REFERRAL_FROM_NAME || 'L-Fit Pathways Website';
  const fromEmail = env.REFERRAL_FROM_EMAIL || 'adambyrne36@icloud.com';

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
    const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': env.BREVO_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        sender: { name: fromName, email: fromEmail },
        to: toEmails.map((e) => ({ email: e })),
        replyTo: { email },
        subject: `New referral: ${child_name} (from ${your_name})`,
        textContent: lines.join('\n')
      })
    });

    if (!brevoRes.ok) {
      const errText = await brevoRes.text();
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
