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
//
// The form now submits as multipart/form-data (so it can carry optional
// supporting-document uploads) rather than JSON. JSON is still accepted as a
// fallback for testing/back-compat, but won't carry file attachments.

const MAX_ATTACHMENT_BYTES = 7 * 1024 * 1024; // 7MB per file
const MAX_TOTAL_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15MB combined

const TEXT_FIELDS = [
  'referrer_type', 'referrer_org', 'local_authority',
  'your_name', 'email', 'phone',
  'child_name', 'child_age', 'child_dob', 'year_group',
  'ehcp', 'primary_need', 'attendance_pct', 'exclusions',
  'social_worker', 'camhs', 'child_in_need', 'looked_after',
  'preferred_start', 'days_per_week',
  'details', 'safeguarding'
];

async function fileToBase64(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.BREVO_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'The referral form is not fully set up yet. Please call or email us directly instead.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const fields = {};
  let provisionsInterest = [];
  let botField;
  let attachments = [];
  let attachmentNote = '';

  try {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await request.json();
      botField = body['bot-field'];
      for (const key of TEXT_FIELDS) fields[key] = body[key];
      provisionsInterest = body.provisions_interest
        ? (Array.isArray(body.provisions_interest) ? body.provisions_interest : [body.provisions_interest])
        : [];
      fields.consent = body.consent;
    } else {
      const form = await request.formData();
      botField = form.get('bot-field');
      for (const key of TEXT_FIELDS) fields[key] = form.get(key);
      provisionsInterest = form.getAll('provisions_interest').filter(Boolean);
      fields.consent = form.get('consent');

      // Optional supporting-document uploads.
      let totalBytes = 0;
      const skipped = [];
      for (const file of form.getAll('documents')) {
        if (!file || typeof file.arrayBuffer !== 'function' || !file.size) continue;
        if (file.size > MAX_ATTACHMENT_BYTES) {
          skipped.push(`${file.name} (too large, over 7MB)`);
          continue;
        }
        if (totalBytes + file.size > MAX_TOTAL_ATTACHMENT_BYTES) {
          skipped.push(`${file.name} (combined attachments over 15MB)`);
          continue;
        }
        try {
          const content = await fileToBase64(file);
          attachments.push({ name: file.name || 'document', content });
          totalBytes += file.size;
        } catch (e) {
          skipped.push(`${file.name} (failed to process)`);
        }
      }
      if (skipped.length) {
        attachmentNote = `\n\nNote: the following file(s) could not be attached and were not sent: ${skipped.join(', ')}. Please ask the referrer to email these directly.`;
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

  const {
    referrer_type, referrer_org, local_authority,
    your_name, email, phone,
    child_name, child_age, child_dob, year_group,
    ehcp, primary_need, attendance_pct, exclusions,
    social_worker, camhs, child_in_need, looked_after,
    preferred_start, days_per_week,
    details, safeguarding, consent
  } = fields;

  if (!your_name || !email || !phone || !child_name || !child_age || !details || !safeguarding) {
    return new Response(JSON.stringify({ error: 'Please fill in all required fields.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!consent) {
    return new Response(JSON.stringify({ error: 'Please confirm the information is accurate before submitting.' }), {
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

  // Only show the school/LA commissioning block in the email if at least one
  // of those fields was actually filled in, so parent self-referrals stay short.
  const hasCommissioningDetail = [
    referrer_org, local_authority, child_dob, year_group, ehcp, primary_need,
    attendance_pct, exclusions, social_worker, camhs, child_in_need,
    looked_after, preferred_start, days_per_week
  ].some(Boolean);

  const lines = [
    `Referrer type: ${referrer_type || '(not given)'}`,
    referrer_org ? `Organisation / school: ${referrer_org}` : null,
    `Referrer name: ${your_name}`,
    `Referrer email: ${email}`,
    `Referrer phone: ${phone}`,
    '',
    `Young person's name: ${child_name}`,
    `Young person's age: ${child_age}`,
    provisionsInterest.length ? `Provisions of interest: ${provisionsInterest.join(', ')}` : 'Provisions of interest: (not given)',
    '',
    'Details / support needed:',
    details,
    '',
    'Safeguarding concerns, medical needs or risk factors:',
    safeguarding
  ];

  if (hasCommissioningDetail) {
    lines.push(
      '',
      '--- School / Local Authority commissioning details ---',
      local_authority ? `Local Authority: ${local_authority}` : null,
      year_group ? `Year group / key stage: ${year_group}` : null,
      child_dob ? `Date of birth: ${child_dob}` : null,
      ehcp ? `EHCP: ${ehcp}` : null,
      primary_need ? `Primary area of need: ${primary_need}` : null,
      attendance_pct ? `Current attendance: ${attendance_pct}` : null,
      exclusions ? `Current/recent exclusions: ${exclusions}` : null,
      social_worker ? `Social worker involved: ${social_worker}` : null,
      camhs ? `CAMHS involved: ${camhs}` : null,
      child_in_need ? `Child in need / protection plan: ${child_in_need}` : null,
      looked_after ? `Looked after child: ${looked_after}` : null,
      preferred_start ? `Preferred start date: ${preferred_start}` : null,
      days_per_week ? `Days per week needed: ${days_per_week}` : null
    );
  }

  const textContent = lines.filter((l) => l !== null).join('\n') + attachmentNote;

  const payload = {
    sender: { name: fromName, email: fromEmail },
    to: toEmails.map((e) => ({ email: e })),
    replyTo: { email },
    subject: `New referral: ${child_name} (from ${your_name})`,
    textContent
  };
  if (attachments.length) payload.attachment = attachments;

  try {
    const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': env.BREVO_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload)
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
