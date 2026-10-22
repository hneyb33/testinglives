# Testing Lives

Community HIV awareness and referral portal built with Next.js, Tailwind CSS, and Supabase Auth. Testing is voluntary; clinical care and test results remain between each person and their qualified healthcare provider.

## Set up

1. Create a Supabase project and enable email authentication.
2. Copy `.env.example` to `.env.local`.
3. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` using the project URL and publishable/anon key from Supabase.
4. Add your local app URL (for example, `http://localhost:3000`) to the Supabase Auth URL configuration. Configure the allowed redirect URLs for account confirmation and password recovery.
5. Install dependencies and start the development server:

   ```bash
   npm install
   npm run dev
   ```

## Supabase database

Apply both files in `supabase/migrations/` to the Supabase project before registering members or processing payments. Run them in filename order in the Supabase SQL Editor, or apply them with the Supabase CLI after linking the project (`supabase db push`). The migrations create the plan catalog and tables, referral-aware profile trigger, row-level read policies, and payment/referral RPCs.

The first profile can register without an invitation code. Later registrations require a valid code; the profile trigger assigns each member a unique code. A referred member can report test completion without submitting medical results. An administrator verifies that report, and only then is a one-time 15% reward on the plan price credited to the referrer. Plans follow the supplied price, daily earnings, and duration table, with no more than three purchases of each plan per member. Daily earnings unlock every 24 hours and can be claimed together when multiple days have accrued.

Deposit requests start at UGX 10,000 and are credited only after PesaJet confirms payment. Withdrawals start at UGX 5,000, are accepted from 9:00 AM to 9:00 PM Africa/Kampala time, carry a 20% fee, and reserve the gross amount while pending. Admins approve or decline withdrawals in the account payout-review page; declined requests are refunded. An administrator must call `public.review_test_completion(investment_id, approve)` to verify test completion; the caller must have the `admin` app-metadata role.

The portal supports email/password sign-in, account creation, email-based password recovery, and sign-out. Auth data is sent directly to Supabase Auth; passwords are not stored by the Next.js app.

## PesaJet payments

Copy `.env.example` to `.env.local` and set `SUPABASE_SERVICE_ROLE_KEY`, `PESAJET_API_KEY`, and `PESAJET_WEBHOOK_SECRET` on the server. Never prefix these secrets with `NEXT_PUBLIC_`. Register `https://<your-domain>/api/payments/webhook` in PesaJet and allow the `x-webhook-signature` header. The public PesaJet docs currently redirect to account sign-in; the integration follows the installed `@pesajet/sdk` README and types. For local development, use a PesaJet-supported public webhook tunnel if provider callbacks cannot reach localhost.

Members initiate UGX 10,000+ collections to their registered phone. Deposits are credited only from a verified PesaJet completion webhook. Withdrawal requests reserve the member's gross amount and enter the admin queue; PesaJet disbursement is not created until an admin approves it. Payout retries reuse the original PesaJet idempotency key. Configure administrator accounts using Supabase Auth `app_metadata.role = "admin"`; user-editable metadata is not accepted for authorization.
