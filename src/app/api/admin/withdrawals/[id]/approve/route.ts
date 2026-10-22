import { authenticateRequest, createPesaJetClient, createServiceRoleClient, PaymentConfigError } from "@/lib/server/payments";

type PayoutRequest = {
  transaction_id: string;
  reference: string;
  phone_number: string;
  provider: "mtn" | "airtel" | null;
  amount: number;
};

export async function POST(
  request: Request,
  context: RouteContext<"/api/admin/withdrawals/[id]/approve">,
) {
  const session = await authenticateRequest(request);
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (session.user.app_metadata?.role !== "admin") {
    return Response.json({ error: "Administrator access is required." }, { status: 403 });
  }

  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return Response.json({ error: "Invalid withdrawal ID." }, { status: 400 });
  }

  try {
    const pesajet = createPesaJetClient();
    const serviceClient = createServiceRoleClient();
    const { data, error } = await session.client.rpc("begin_pesajet_withdrawal", {
      p_transaction_id: id,
    });
    if (error) return Response.json({ error: error.message }, { status: 409 });

    const payout = data as PayoutRequest;
    const result = await pesajet.payments.create({
      type: "DISBURSEMENT",
      amount: Number(payout.amount),
      currency: "UGX",
      phoneNumber: pesajet.utils.formatPhoneNumber(payout.phone_number),
      ...(payout.provider ? { provider: payout.provider } : {}),
      reference: payout.reference,
      description: "Testing Lives approved withdrawal",
      idempotencyKey: payout.reference,
    });

    if (
      result.type !== "DISBURSEMENT" || Number(result.amount) !== Number(payout.amount) ||
      result.currency !== "UGX" || result.reference !== payout.reference ||
      (payout.provider && result.provider !== payout.provider)
    ) {
      console.error("Withdrawal response did not match the approved request.");
      return Response.json({
        status: "processing",
        message: "Provider response did not match the approved payout. Check the transaction status before retrying.",
      }, { status: 202 });
    }

    const { error: recordError } = await serviceClient.rpc("record_pesajet_payout", {
      p_transaction_id: payout.transaction_id,
      p_provider_transaction_id: result.transactionId,
      p_provider_status: result.status,
      p_failure_reason: result.failureReason ?? null,
      p_provider: result.provider,
    });
    if (recordError) console.error("Withdrawal response could not be recorded.", recordError.message);

    return Response.json({
      transactionId: payout.transaction_id,
      providerTransactionId: result.transactionId,
      status: result.status,
    }, { status: 202 });
  } catch (error) {
    if (error instanceof PaymentConfigError) {
      return Response.json({ error: "Payment service is not configured." }, { status: 503 });
    }
    console.error("Withdrawal initiation failed.", error instanceof Error ? error.message : "Unknown error");
    return Response.json({
      status: "processing",
      message: "Approval is recorded, but payment confirmation is pending. Retry uses the same transaction reference.",
    }, { status: 202 });
  }
}
