import { authenticateRequest, createPesaJetClient, PaymentConfigError } from "@/lib/server/payments";
import { normalizeUgandaPhone } from "@/lib/phone";

export async function POST(request: Request) {
  const session = await authenticateRequest(request);
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });

  let body: { amount?: unknown; phone?: unknown; provider?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const amount = Number(body.amount);
  const phoneInput = typeof body.phone === "string" ? body.phone.trim() : "";
  if (!Number.isInteger(amount) || amount < 5000) {
    return Response.json({ error: "The minimum withdrawal is UGX 5,000." }, { status: 400 });
  }
  try {
    const payments = createPesaJetClient();
    const normalizedPhone = normalizeUgandaPhone(phoneInput);
    if (!normalizedPhone) {
      return Response.json({ error: "Enter a valid Uganda mobile number." }, { status: 400 });
    }
    const phone = payments.utils.formatPhoneNumber(normalizedPhone);
    if (!/^\+256\d{9}$/.test(phone)) {
      return Response.json({ error: "Enter a valid Uganda mobile number." }, { status: 400 });
    }
    const detectedProvider = payments.utils.detectProvider(phone);
    const requestedProvider = body.provider === "mtn" || body.provider === "airtel" ? body.provider : null;
    if (body.provider != null && requestedProvider == null) {
      return Response.json({ error: "Select a valid mobile money network." }, { status: 400 });
    }
    if (detectedProvider && requestedProvider && detectedProvider !== requestedProvider) {
      return Response.json({ error: "The selected network does not match this phone number." }, { status: 400 });
    }
    const provider = detectedProvider ?? requestedProvider;
    if (!provider) {
      return Response.json({ error: "Select your mobile money network for this number." }, { status: 400 });
    }

    const { data, error } = await session.client.rpc("request_mobile_withdrawal", {
      p_amount: amount,
      p_phone_number: phone,
      p_provider: provider,
    });
    if (error) return Response.json({ error: error.message }, { status: 400 });

    const withdrawal = data as { transaction_id: string };
    return Response.json({
      transactionId: withdrawal.transaction_id,
      status: "pending",
      message: "Your withdrawal request is pending admin approval.",
    }, { status: 202 });
  } catch (error) {
    if (error instanceof PaymentConfigError) {
      return Response.json({ error: "The payment service is not configured." }, { status: 503 });
    }
    console.error("Withdrawal request could not be recorded.", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "The withdrawal request could not be submitted. Try again." }, { status: 500 });
  }
}
