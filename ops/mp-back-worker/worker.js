// Redirige el back_url de MercadoPago a laforja.dev conservando el query string
// (MP suma preapproval_id ahí). Existe porque MP a veces rechaza back_url con
// hosts que no le gustan (TLDs raros, dominios sin propagar): apuntar la
// preapproval a este Worker en workers.dev sirve de rampa hasta que el host
// definitivo lo acepte. Ver docs/auth-y-pagos.md y MP_BACK_URL en .env.example.

const DEFAULT_TARGET = 'https://laforja.dev/dashboard/gracias';

export default {
  fetch(request, env) {
    const target = new URL(env.TARGET_URL || DEFAULT_TARGET);
    const incoming = new URL(request.url);
    for (const [k, v] of incoming.searchParams) target.searchParams.append(k, v);
    return Response.redirect(target.toString(), 302);
  },
};
