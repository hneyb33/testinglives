import { authenticateRequest } from "@/lib/server/payments";

const PROVIDERS = new Set(["mtn", "airtel"]);

export async function POST(request: Request) {
  const session = await authenticateRequest(request);
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });

  let body: { amount?: unknown; provider?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const amount = Number(body.amount);
  const provider = typeof body.provider === "string" ? body.provider.toLowerCase() : "";
  if (!Number.isInteger(amount) || amount < 5000) {
    return Response.json({ error: "The minimum withdrawal is UGX 5,000." }, { status: 400 });
  }
  if (!PROVIDERS.has(provider)) {
    return Response.json({ error: "Choose MTN or Airtel Mobile Money." }, { status: 400 });
  }

  const { data, error } = await session.client.rpc("request_pesajet_withdrawal", {
    p_amount: amount,
    p_provider: provider,
  });
  if (error) return Response.json({ error: error.message }, { status: 400 });

  const withdrawal = data as { transaction_id: string };
  return Response.json({
    transactionId: withdrawal.transaction_id,
    status: "pending",
    message: "Your balance is reserved. PesaJet is contacted only after admin approval.",
  }, { status: 202 });
}
