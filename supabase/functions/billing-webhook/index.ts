// Edge Function `billing-webhook`: avisos de Stripe (alta, renovación, impago,
// cancelación). Sin sesión: la autentica la firma `Stripe-Signature`; en
// config.toml lleva `verify_jwt = false`. Idempotente por evento.
// SIN PROBAR CONTRA STRIPE REAL; la lógica está probada en Node con avisos
// simulados y firmados en la prueba. Variables en docs/facturacion.md.
//
// Dirección para dar de alta en Stripe:
//   https://<proyecto>.supabase.co/functions/v1/billing-webhook
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { RpcClient } from '../_shared/ai/contract.ts';
import { createBillingWebhookHandler } from '../_shared/billing/handlers.ts';
import { createStripeClient } from '../_shared/billing/stripe.ts';

const env = Deno.env.toObject();
const admin = createClient(env.SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
});
const rpc: RpcClient = (fn, args) => admin.rpc(fn, args);
const secrets = (env.STRIPE_WEBHOOK_SECRET ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (secrets.length === 0) console.warn('[billing-webhook] configuración: falta STRIPE_WEBHOOK_SECRET');
if (!env.STRIPE_SECRET_KEY) console.warn('[billing-webhook] configuración: falta STRIPE_SECRET_KEY');

Deno.serve(
  createBillingWebhookHandler({
    rpc,
    stripe: env.STRIPE_SECRET_KEY ? createStripeClient({ secretKey: env.STRIPE_SECRET_KEY }) : null,
    webhookSecrets: secrets,
    log: (event, data) => console.error(`[billing-webhook] ${event}`, JSON.stringify(data)),
  }),
);
