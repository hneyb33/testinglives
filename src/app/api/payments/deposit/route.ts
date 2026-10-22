import { authenticateRequest, createPesaJetClient, createServiceRoleClient, PaymentConfigError } from "@/lib/server/payments";
import { PesaJetError } from "@pesajet/sdk";
import { normalizeUgandaPhone } from "@/lib/phone";

type DepositRequest = {
  amount?: unknown;
  phone?: unknown;
  provider?: unknown;
};

type DepositRecord = {
  transaction_id: string;
  reference: string;
  phone_number: string;
  provider: "mtn" | "airtel" | null;
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
  const phoneInput = typeof body.phone === "string" ? body.phone.trim() : "";
  if (!Number.isInteger(amount) || amount <= 0) {
    return Response.json({ error: "Enter a positive whole-number deposit amount." }, { status: 400 });
  }

  try {
    const pesajet = createPesaJetClient();
    const normalizedPhone = normalizeUgandaPhone(phoneInput);
    if (!normalizedPhone) {
      return Response.json({ error: "Enter a valid Uganda mobile number." }, { status: 400 });
    }
    const phone = pesajet.utils.formatPhoneNumber(normalizedPhone);
    if (!/^\+256\d{9}$/.test(phone)) {
      return Response.json({ error: "Enter a valid Uganda mobile number." }, { status: 400 });
    }
    const detectedProvider = pesajet.utils.detectProvider(phone);
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
    const serviceClient = createServiceRoleClient();
    const { data, error } = await session.client.rpc("request_mobile_deposit", {
      p_amount: amount,
      p_phone_number: phone,
      p_provider: provider,
    });
    if (error) return Response.json({ error: error.message }, { status: 400 });

    const deposit = data as DepositRecord;
    const payment = await pesajet.payments.create({
      type: "COLLECTION",
      amount: deposit.amount,
      currency: "UGX",
      phoneNumber: pesajet.utils.formatPhoneNumber(deposit.phone_number),
      provider: deposit.provider ?? provider,
      reference: deposit.reference,
      description: "Testing Lives deposit",
      idempotencyKey: deposit.reference,
    });

    const responseMismatches: string[] = [];
    if (typeof payment.type !== "string" || payment.type.toUpperCase() !== "COLLECTION") {
      responseMismatches.push("type");
    }
    if (!Number.isFinite(Number(payment.amount)) || Number(payment.amount) !== deposit.amount) {
      responseMismatches.push("amount");
    }
    if (typeof payment.currency !== "string" || payment.currency.toUpperCase() !== "UGX") {
      responseMismatches.push("currency");
    }
    if (payment.reference !== deposit.reference) responseMismatches.push("reference");
    if (payment.provider && payment.provider.toLowerCase() !== deposit.provider) {
      responseMismatches.push("provider");
    }
    if (
      !payment.transactionId ||
      !["PENDING", "PROCESSING", "COMPLETED", "FAILED", "EXPIRED"].includes(payment.status)
    ) {
      responseMismatches.push("transaction metadata");
    }

    if (responseMismatches.length > 0) {
      console.error("Deposit response did not match the initiated request.", {
        mismatches: responseMismatches,
        response: {
          type: payment.type,
          amount: payment.amount,
          currency: payment.currency,
          referenceMatches: payment.reference === deposit.reference,
          provider: payment.provider ?? null,
          status: payment.status,
          hasTransactionId: Boolean(payment.transactionId),
        },
      });
      return Response.json({ error: "The payment provider returned an unexpected response. Check Records before retrying." }, { status: 502 });
    }

    const { error: recordError } = await serviceClient.rpc("record_pesajet_deposit", {
      p_transaction_id: deposit.transaction_id,
      p_provider_transaction_id: payment.transactionId,
      p_provider_status: payment.status,
      p_provider: payment.provider,
    });
    if (recordError) console.error("Deposit response could not be recorded.", recordError.message);

    return Response.json({
      transactionId: deposit.transaction_id,
      providerTransactionId: payment.transactionId,
      status: payment.status,
      phoneNumber: deposit.phone_number,
    }, { status: 202 });
  } catch (error) {
    if (error instanceof PaymentConfigError) {
      return Response.json({ error: "Payment service is not configured." }, { status: 503 });
    }
    if (error instanceof PesaJetError) {
      console.error("Deposit initiation failed.", {
        message: error.message,
        statusCode: error.statusCode,
        errorCode: error.errorCode,
      });
    } else {
      console.error("Deposit initiation failed.", error instanceof Error ? error.message : "Unknown error");
    }
    return Response.json({ error: "The payment prompt could not be confirmed. Check your records before retrying." }, { status: 502 });
  }
}
