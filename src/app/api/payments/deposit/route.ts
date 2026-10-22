import { authenticateRequest, createPesaJetClient, createServiceRoleClient, PaymentConfigError } from "@/lib/server/payments";

const PROVIDERS = new Set(["mtn", "airtel"]);

type DepositRequest = {
  amount?: unknown;
  provider?: unknown;
};

type DepositRecord = {
  transaction_id: string;
  reference: string;
  phone_number: string;
  provider: "mtn" | "airtel";
  amount: number;
};

export async function POST(request: Request) {
  const session = await authenticateRequest(request);
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });

  let body: DepositRequest;
  try {
    body = await request.json() as DepositRequest;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const amount = Number(body.amount);
  const provider = typeof body.provider === "string" ? body.provider.toLowerCase() : "";
  if (!Number.isInteger(amount) || amount < 10000) {
    return Response.json({ error: "The minimum deposit is UGX 10,000." }, { status: 400 });
  }
  if (!PROVIDERS.has(provider)) {
    return Response.json({ error: "Choose MTN or Airtel Mobile Money." }, { status: 400 });
  }

  try {
    const pesajet = createPesaJetClient();
    const serviceClient = createServiceRoleClient();
    const { data, error } = await session.client.rpc("request_pesajet_deposit", {
      p_amount: amount,
      p_provider: provider,
    });
    if (error) return Response.json({ error: error.message }, { status: 400 });

    const deposit = data as DepositRecord;
    const payment = await pesajet.payments.create({
      type: "COLLECTION",
      amount: deposit.amount,
      currency: "UGX",
      phoneNumber: pesajet.utils.formatPhoneNumber(deposit.phone_number),
      provider: deposit.provider,
      reference: deposit.reference,
      description: "Testing Lives deposit",
      idempotencyKey: deposit.reference,
    });

    if (
      payment.type !== "COLLECTION" || payment.amount !== deposit.amount ||
      payment.currency !== "UGX" || payment.reference !== deposit.reference ||
      payment.provider !== deposit.provider
    ) {
      console.error("PesaJet collection response did not match the initiated request.");
      return Response.json({ error: "The payment provider returned an unexpected response. Check Records before retrying." }, { status: 502 });
    }

    const { error: recordError } = await serviceClient.rpc("record_pesajet_deposit", {
      p_transaction_id: deposit.transaction_id,
      p_provider_transaction_id: payment.transactionId,
      p_provider_status: payment.status,
    });
    if (recordError) console.error("PesaJet deposit response could not be recorded.", recordError.message);

    return Response.json({
      transactionId: deposit.transaction_id,
      providerTransactionId: payment.transactionId,
      status: payment.status,
      phoneNumber: pesajet.utils.formatPhoneNumber(deposit.phone_number),
    }, { status: 202 });
  } catch (error) {
    if (error instanceof PaymentConfigError) {
      return Response.json({ error: "Payment service is not configured." }, { status: 503 });
    }
    console.error("PesaJet deposit initiation failed.", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "The payment prompt could not be confirmed. Check your records before retrying." }, { status: 502 });
  }
}
