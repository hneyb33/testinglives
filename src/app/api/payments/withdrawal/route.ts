import { authenticateRequest } from "@/lib/server/payments";
import { detectUgandaMobileProvider, normalizeUgandaPhone } from "@/lib/phone";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  const session = await authenticateRequest(request);
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!isRecord(parsedBody)) return Response.json({ error: "Invalid request body." }, { status: 400 });
  const body = parsedBody;

  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount <= 0) {
    return Response.json({ error: "Enter a positive whole-number withdrawal amount." }, { status: 400 });
  }
  if (body.provider != null && body.provider !== "mtn" && body.provider !== "airtel") {
    return Response.json({ error: "Select a valid mobile money network." }, { status: 400 });
  }

  const phone = typeof body.phone === "string" ? normalizeUgandaPhone(body.phone.trim()) : null;
  if (!phone) return Response.json({ error: "Enter a valid Uganda mobile number." }, { status: 400 });
  const detectedProvider = detectUgandaMobileProvider(phone);
  if (detectedProvider && body.provider && detectedProvider !== body.provider) {
    return Response.json({ error: "The selected network does not match this phone number." }, { status: 400 });
  }
  const provider = detectedProvider ?? body.provider;
  if (provider !== "mtn" && provider !== "airtel") {
    return Response.json({ error: "Select your mobile money network for this number." }, { status: 400 });
  }

  try {
    const { data, error } = await session.client.rpc("request_mobile_withdrawal", {
      p_amount: amount,
      p_phone_number: phone,
      p_provider: provider,
    });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    if (typeof data !== "object" || data === null || !("transaction_id" in data) || typeof data.transaction_id !== "string") {
      console.error("Withdrawal RPC returned an invalid transaction.");
      return Response.json({ error: "The withdrawal request could not be confirmed." }, { status: 502 });
    }

    return Response.json({
      transactionId: data.transaction_id,
      status: "pending",
      message: "Your withdrawal request is pending admin approval.",
    }, { status: 202 });
  } catch (error) {
    console.error("Withdrawal request could not be recorded.", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "The withdrawal request could not be submitted. Try again." }, { status: 500 });
  }
}
