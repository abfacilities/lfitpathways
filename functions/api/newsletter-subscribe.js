// Handles newsletter signups for lfitpathways.com via the Brevo Contacts REST API.
//
// Adds the visitor as a contact to the dedicated Brevo newsletter list
// (BREVO_LIST_ID) so they receive future newsletter sends.
//
// Cloudflare Pages Function. Calls Brevo directly via fetch (no npm SDK),
// matching the pattern used by functions/api/referral.js and review.js.
//
// Required environment variables (set in Cloudflare Pages project settings, never in git):
//   NEWSLETTER_BREVO_API_KEY - Dedicated Brevo API key for newsletter contacts/campaigns
//   BREVO_LIST_ID            - Numeric ID of the Brevo contact list to add subscribers to
//
// Optional environment variables:
//   NEWSLETTER_NOTIFY_TO_EMAIL - Where signup notifications land. Defaults to adam.byrne@lfitpathways.com
//   REFERRAL_FROM_EMAIL        - Reused as the notification sending address (same verified sender)

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.NEWSLETTER_BREVO_API_KEY || !env.BREVO_LIST_ID) {
    return new Response(
      JSON.stringify({ error: 'This form is not fully set up yet. Please email us directly instead.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let email, botField;
  try {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      ({ email, 'bot-field': botField } = await request.json());
    } else {
      const form = await request.formData();
      email = form.get('email');
      botField = form.get('bot-field');
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

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailPattern.test(String(email))) {
    return new Response(JSON.stringify({ error: 'Please enter a valid email address.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const brevoRes = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'api-key': env.NEWSLETTER_BREVO_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        email: String(email),
        listIds: [Number(env.BREVO_LIST_ID)],
        updateEnabled: true
      })
    });

    // Brevo returns 204 if the contact already existed and was just updated,
    // and 201 for a brand-new contact - both mean the subscribe worked.
    if (!brevoRes.ok && brevoRes.status !== 204) {
      const errText = await brevoRes.text();
      return new Response(
        JSON.stringify({ error: 'Could not process your request. Please try again or contact us directly.', detail: errText }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Could not process your request. Please try again or contact us directly.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export async function onRequestGet() {
  return new Response('Method Not Allowed', { status: 405 });
}
