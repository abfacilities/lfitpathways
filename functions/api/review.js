// Sends "Leave a Review" homepage submissions to the DSLs' inboxes via Brevo,
// for manual moderation. Reviews are NOT published automatically anywhere -
// this only notifies Adam/Craig by email so a genuine review can be added to
// the site by hand once checked.
//
// Cloudflare Pages Function. Calls Brevo directly via fetch (no npm SDK).
//
// Required environment variable (already set for the referral form, reused here):
//   BREVO_API_KEY
//
// Optional environment variables:
//   REVIEW_TO_EMAIL     - Comma-separated recipients. Defaults to both DSLs.
//   REFERRAL_FROM_EMAIL - Reused as the sending address (same verified sender
//                          as the referral form).

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.BREVO_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'Reviews are not accepted yet. Please email us directly instead.' }),
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
      for (const key of ['reviewer_name', 'relationship', 'rating', 'review_text', 'confirm_truthful']) {
        fields[key] = form.get(key);
      }
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid request' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (botField) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { reviewer_name, relationship, rating, review_text, confirm_truthful } = fields;

  if (!reviewer_name || !relationship || !rating || !review_text) {
    return new Response(JSON.stringify({ error: 'Please fill in all required fields.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!confirm_truthful) {
    return new Response(JSON.stringify({ error: 'Please confirm the feedback is truthful before submitting.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const toEmails = (env.REVIEW_TO_EMAIL || env.REFERRAL_TO_EMAIL || 'adam.byrne@lfitpathways.com,craig.lloyd@lfitpathways.com')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);

  const fromName = env.REFERRAL_FROM_NAME || 'L-Fit Pathways Website';
  const fromEmail = env.REFERRAL_FROM_EMAIL || 'adambyrne36@icloud.com';

  const stars = '★'.repeat(Number(rating) || 0) + '☆'.repeat(5 - (Number(rating) || 0));

  const textContent = [
    'New website review submitted (NOT yet published - moderate and add manually if genuine).',
    '',
    `From: ${reviewer_name}`,
    `Relationship: ${relationship}`,
    `Rating: ${stars} (${rating}/5)`,
    '',
    'Review:',
    review_text
  ].join('\n');

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
        subject: `New review submitted by ${reviewer_name} (${rating}/5)`,
        textContent
      })
    });

    if (!brevoRes.ok) {
      const errText = await brevoRes.text();
      return new Response(
        JSON.stringify({ error: 'Could not submit your review. Please try again later.', detail: errText }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Could not submit your review. Please try again later.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export async function onRequestGet() {
  return new Response('Method Not Allowed', { status: 405 });
}
