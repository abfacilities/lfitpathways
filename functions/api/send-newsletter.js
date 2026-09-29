// Secret-protected endpoint that sends a newsletter campaign to the lfitpathways.com
// subscriber list via the Brevo Campaigns REST API. Called either manually (after
// publishing new content) or by the scheduled monthly-digest task - never triggered
// by public traffic.
//
// Required environment variables (set in Cloudflare Pages project settings, never in git):
//   NEWSLETTER_BREVO_API_KEY - Dedicated Brevo API key (Contacts/Campaigns)
//   BREVO_LIST_ID            - Numeric ID of the Brevo contact list holding subscribers
//   NEWSLETTER_SECRET        - Shared secret required in the x-newsletter-secret header
//
// Optional:
//   NEWSLETTER_FROM_EMAIL - Verified sending address. Defaults to adam.byrne@lfitpathways.com
//   NEWSLETTER_FROM_NAME  - Sender display name. Defaults to "L-Fit Pathways"
//
// Expected JSON body: { subject: string, html: string }
//
// Brevo's campaign API creates a campaign, then requires a separate "send now" call
// to actually dispatch it.

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.NEWSLETTER_BREVO_API_KEY || !env.BREVO_LIST_ID || !env.NEWSLETTER_SECRET) {
    return new Response(JSON.stringify({ error: 'Newsletter sending is not fully configured yet.' }), { status: 500 });
  }

  const providedSecret = request.headers.get('x-newsletter-secret');
  if (providedSecret !== env.NEWSLETTER_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let subject, html;
  try {
    ({ subject, html } = await request.json());
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 });
  }

  if (!subject || !html) {
    return new Response(JSON.stringify({ error: 'subject and html are required' }), { status: 400 });
  }

  const fromEmail = env.NEWSLETTER_FROM_EMAIL || 'adam.byrne@lfitpathways.com';
  const fromName = env.NEWSLETTER_FROM_NAME || 'L-Fit Pathways';

  try {
    // Create the campaign
    const createRes = await fetch('https://api.brevo.com/v3/emailCampaigns', {
      method: 'POST',
      headers: {
        'api-key': env.NEWSLETTER_BREVO_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        name: `${subject} - ${new Date().toISOString().slice(0, 10)}`,
        subject,
        sender: { name: fromName, email: fromEmail },
        type: 'classic',
        htmlContent: html,
        recipients: { listIds: [Number(env.BREVO_LIST_ID)] }
      })
    });

    const createData = await createRes.json();
    if (!createRes.ok) {
      return new Response(JSON.stringify({ error: 'Could not create campaign', detail: createData }), { status: 500 });
    }

    // Send it immediately
    const sendRes = await fetch(`https://api.brevo.com/v3/emailCampaigns/${createData.id}/sendNow`, {
      method: 'POST',
      headers: {
        'api-key': env.NEWSLETTER_BREVO_API_KEY,
        Accept: 'application/json'
      }
    });

    if (!sendRes.ok) {
      const sendErrText = await sendRes.text();
      return new Response(JSON.stringify({ error: 'Campaign created but send failed', campaignId: createData.id, detail: sendErrText }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true, campaignId: createData.id }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Request failed', detail: String(err) }), { status: 500 });
  }
}

export async function onRequestGet() {
  return new Response('Method Not Allowed', { status: 405 });
}
