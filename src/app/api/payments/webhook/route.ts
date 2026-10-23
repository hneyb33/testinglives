import {
  createServiceRoleClient,
  PaymentConfigError,
  verifyMarzPayWebhookSignature,
} from "@/lib/server/payments";

export async function POST(request: Request) {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return Response.json({ error: "Could not read webhook payload." }, { status: 400 });
  }
  if (rawBody.length > 64_000) {
    return Response.json({ error: "Webhook payload is too large." }, { status: 413 });
  }
  if (!verifyMarzPayWebhookSignature(rawBody, request.headers)) {
    return Response.json({ error: "Invalid MarzPay webhook signature." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid webhook payload." }, { status: 400 });
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return Response.json({ error: "Invalid webhook payload." }, { status: 400 });
  }

  try {
    const serviceClient = createServiceRoleClient();
    const { error } = await serviceClient.rpc("apply_marzpay_webhook", { p_payload: payload });
    if (error) {
      console.error("MarzPay payment update could not be applied.", error.message);
      return Response.json({ error: "Webhook processing failed." }, { status: 500 });
    }
    return Response.json({ received: true });
  } catch (error) {
    if (error instanceof PaymentConfigError) {
      return Response.json({ error: "Webhook service is not configured." }, { status: 503 });
    }
    console.error("MarzPay webhook processing failed.", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
