import { createPesaJetClient, createServiceRoleClient, PaymentConfigError } from "@/lib/server/payments";

export async function POST(request: Request) {
  const signature = request.headers.get("x-webhook-signature");
  if (!signature) return Response.json({ error: "Missing webhook signature." }, { status: 401 });

  try {
    const rawBody = await request.text();
    if (rawBody.length > 64_000) {
      return Response.json({ error: "Webhook payload is too large." }, { status: 413 });
    }

    const pesajet = createPesaJetClient();
    const event = pesajet.webhooks.constructEvent(rawBody, signature);
    const serviceClient = createServiceRoleClient();
    const { error } = await serviceClient.rpc("apply_pesajet_webhook", { p_payload: event });
    if (error) {
      console.error("PesaJet webhook could not be applied.", error.message);
      return Response.json({ error: "Webhook processing failed." }, { status: 500 });
    }

    return Response.json({ received: true });
  } catch (error) {
    if (error instanceof PaymentConfigError) {
      return Response.json({ error: "Webhook service is not configured." }, { status: 503 });
    }
    return Response.json({ error: "Invalid webhook signature or payload." }, { status: 401 });
  }
}
