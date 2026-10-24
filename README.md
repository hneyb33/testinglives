# Testing Lives

Community HIV awareness and referral portal built with Next.js, Tailwind CSS, and Supabase Auth. Testing is voluntary; clinical care and test results remain between each person and their qualified healthcare provider.

## Set up

1. Create a Supabase project and enable email authentication.
2. Copy `.env.example` to `.env.local`.
3. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_SITE_URL` in `.env.local`. Use your deployed public URL for `NEXT_PUBLIC_SITE_URL` so shared referral links resolve an absolute Open Graph preview. The share card is the branded 1200×630 banner at `src/app/opengraph-image.jpg` (with a matching `twitter-image.jpg`), which embeds `public/images/logo.jpg`.
4. Add your local app URL (for example, `http://localhost:3000`) to the Supabase Auth URL configuration. Configure the allowed redirect URLs for account confirmation and password recovery.
5. Install dependencies and start the development server:

   ```bash
   npm install
   npm run dev
   ```

## Supabase database

Apply all files in `supabase/migrations/` to the Supabase project before registering members or processing payments. Run them in filename order in the Supabase SQL Editor, or apply them with the Supabase CLI after linking the project (`supabase db push`). The migrations create the plan catalog and tables, referral-aware profile trigger, row-level policies, payment/referral RPCs, and admin-managed community links. A member receives a separate UGX 1,000 bonus only on their first successfully approved deposit. Existing successful deposits count toward eligibility, and the bonus is not backdated.

The first profile can register without an invitation code. Later registrations require a valid code; the profile trigger assigns each member a unique code. A referred member can report test completion without submitting medical results. Separately, the referrer earns the configured commission (15% by default) on each successfully approved deposit; the commission never depends on HIV status or test results. Plans follow the supplied price, daily earnings, and duration table, with no more than three purchases of each plan per member. Daily earnings are credited automatically to wallet balances at 1:00 pm Kampala time by the `daily-test-plan-rewards` pg_cron job; the Claim button remains as a fallback when a scheduled run is missed.

Members enter the amount and Uganda mobile number for a deposit; the payment prompt is sent to that phone and the balance is credited only after confirmation. Withdrawals require the destination phone and amount, use the configured minimum, Kampala-time service window, and fee, and reserve the gross amount while pending. Members can view their transaction status and phone in Records. An administrator verifies reported test completions with `public.review_test_completion(investment_id, approve)`; test verification does not pay a referral reward. The caller must have the `admin` app-metadata role.

The portal supports email/password sign-in, account creation, email-based password recovery, and sign-out. Auth data is sent directly to Supabase Auth; passwords are not stored by the Next.js app.

## Installable app

The app provides a web manifest and Testing Lives home-screen icons. Use **Download app** from the sign-in screen or **My account → Install app** on a supported browser; on iPhone or iPad, open the page in Safari, tap **Share**, then **Add to Home Screen**. Production installation requires HTTPS.

## MarzPay payments

Set `SUPABASE_SERVICE_ROLE_KEY`, `MARZPAY_API_KEY`, `MARZPAY_API_SECRET`, and `MARZPAY_CALLBACK_URL=https://<your-domain>/api/payments/webhook` on the server. `MARZPAY_API_BASE` defaults to `https://wallet.wearemarz.com/api/v1`; optionally set `MARZPAY_WEBHOOK_SECRET` when webhook signing is enabled for the MarzPay business. Never expose these values through `NEXT_PUBLIC_` variables. Subscribe to MarzPay Collections and Send Money, enable API disbursements, and configure any required server IP allowlisting. Configure the same callback URL in MarzPay and use an HTTPS tunnel for local testing.

Apply `supabase/migrations/20261023000100_marzpay_payments.sql` after the existing migrations. Members initiate MarzPay collections to their Uganda mobile-money number; deposits are credited only after a validated completion callback or status check. Withdrawal requests reserve the gross amount and enter the admin queue; a MarzPay disbursement is submitted only after admin approval. Repeated approval actions check the existing MarzPay transaction instead of submitting a second payout. Configure the initial administrator using Supabase Auth `app_metadata.role = "admin"`; user-editable metadata is not accepted for authorization.

### Admin dashboard

Open **My account → Admin dashboard** to review deposits and withdrawals, choose manual or MarzPay withdrawal handling, manage members and balances, inspect referral and active-plan metrics, archive or edit plans, promote administrators by phone number, and update application settings. Ban/unban actions synchronize the profile restriction and Supabase Auth ban; a member ban also blocks plan purchases, earnings claims, and test-completion submissions.

Manual payouts are paid outside the app by an administrator. After sending payment, record the manual payment reference and mark the withdrawal paid; if payment fails, record a reason and the reserved gross amount is refunded. MarzPay payouts are settled by verified callbacks; the admin status-check action polls MarzPay rather than repeating a disbursement. Plan removal archives the plan so existing purchases and transaction history are retained. The dashboard's net revenue figure is an operational estimate: approved deposits minus approved net withdrawals, earnings paid, and referral commissions; it is not an audited accounting balance. Referral-share counts track successful invite-link copies in the app.

Minimum deposit/withdrawal amounts, withdrawal hours and fee, referral commission and rules, welcome copy, and Telegram links are editable in the dashboard Settings tab. Current defaults are UGX 10,000 minimum deposit, UGX 5,000 minimum withdrawal, 09:00–21:00 Kampala time, 20% withdrawal fee, and a 15% referral commission on each successful deposit. Links must be HTTPS destinations on `t.me` or `telegram.me`.
