const MOBILE_URL = process.env.FLEXPAY_MOBILE_URL || 'https://backend.flexpay.cd/api/rest/v1/paymentService';
const CARD_URL = process.env.FLEXPAY_CARD_URL || 'https://cardpayment.flexpay.cd/v1.1/pay';
const CHECK_URL = process.env.FLEXPAY_CHECK_URL || 'https://apicheck.flexpaie.com/api/rest/v1/check/';

const MERCHANT = () => process.env.FLEXPAY_MERCHANT || 'MARCO_SERVICE';
const TOKEN = () => process.env.FLEXPAY_TOKEN || '';
const BEARER = () => (TOKEN().startsWith('Bearer ') ? TOKEN() : 'Bearer ' + TOKEN());

async function postJson(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: BEARER() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000)
  });
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { code: '1', message: 'Réponse invalide: ' + text.slice(0, 200) }; }
}

// Paiement Mobile Money (push USSD sur le téléphone du client)
async function payMobile({ phone, reference, amount, currency, callbackUrl }) {
  return postJson(MOBILE_URL, {
    merchant: MERCHANT(),
    type: '1',
    phone,
    reference,
    amount: String(amount),
    currency,
    callbackUrl
  });
}

// Paiement carte bancaire (retourne une URL de paiement à ouvrir)
async function payCard({ reference, amount, currency, description, baseUrl }) {
  return postJson(CARD_URL, {
    authorization: BEARER(),
    merchant: MERCHANT(),
    reference,
    amount: String(amount),
    currency,
    description,
    callback_url: baseUrl + '/api/flexpay/callback',
    approve_url: baseUrl + '/?ref=' + encodeURIComponent(reference),
    cancel_url: baseUrl + '/?ref=' + encodeURIComponent(reference) + '&cancel=1',
    decline_url: baseUrl + '/?ref=' + encodeURIComponent(reference) + '&decline=1',
    home_url: baseUrl + '/'
  });
}

// Vérification: 'paid' | 'failed' | 'pending'
async function checkOrder(orderNumber) {
  try {
    const r = await fetch(CHECK_URL + encodeURIComponent(orderNumber), {
      headers: { Authorization: BEARER() },
      signal: AbortSignal.timeout(20000)
    });
    const j = await r.json();
    if (String(j.code) !== '0') return 'pending';
    const s = String(j.transaction && j.transaction.status);
    if (s === '0') return 'paid';
    if (s === '1') return 'failed';
    return 'pending';
  } catch (e) {
    return 'pending';
  }
}

module.exports = { payMobile, payCard, checkOrder };
