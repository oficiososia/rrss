// Edge Function `billing-checkout`: un propietario o administrador pide la URL
// de Stripe Checkout para contratar un plan. SIN PROBAR CONTRA STRIPE REAL; la
// lógica (../_shared/billing/handlers.ts) está probada en Node con la base de
// datos real y un Stripe simulado. Variables en docs/facturacion.md.
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { RpcClient } from '../_shared/ai/contract.ts';
import { createBillingCheckoutHandler, normalizeAppUrl } from '../_shared/billing/handlers.ts';
import { createStripeClient } from '../_shared/billing/stripe.ts';

const env = Deno.env.toObject();
const admin = createClient(env.SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
});
const rpc: RpcClient = (fn, args) => admin.rpc(fn, args);
const appUrl = normalizeAppUrl(env.BILLING_APP_URL);
if (!env.STRIPE_SECRET_KEY) console.warn('[billing-checkout] configuración: falta STRIPE_SECRET_KEY');
if (!appUrl) console.warn('[billing-checkout] configuración: falta BILLING_APP_URL (https)');

Deno.serve(
  createBillingCheckoutHandler({
    rpc,
    stripe: env.STRIPE_SECRET_KEY ? createStripeClient({ secretKey: env.STRIPE_SECRET_KEY }) : null,
    appUrl,
    allowedOrigin: env.BILLING_ALLOWED_ORIGIN,
    async authenticate(token) {
      const { data, error } = await admin.auth.getUser(token);
      return error || !data.user ? null : { userId: data.user.id };
    },
    log: (event, data) => console.error(`[billing-checkout] ${event}`, JSON.stringify(data)),
  }),
);
