# Seller authorization guide

This guide explains how a **seller** authorizes your app, covering both the direct authorization link and the Seller Center App Store flow, plus renewing and canceling authorization.
> **Which guide do I read?** Start with the Authorization overview for concepts and the token APIs. Use the step-by-step seller authorization guide for the full get-code → exchange-token → refresh sequence. This page focuses on the seller-facing authorization experience (link vs. app store) and the authorization lifecycle.

## Two ways a seller can authorize
| Path | Applies to | Entry point |
| --- | --- | --- |
| **Authorization link** | Custom and public apps | You share a **Copy authorization link** URL with the seller. |
| **Seller Center App Store** | **Public apps only** | The seller installs your published app from the App Store. See Authorization via app store. |
## Authorization via the authorization link
After a seller opens your authorization link, they go through these steps. (Each step below corresponds to a screen in Partner Center; the text describes what the seller does so you can follow along without relying solely on the screenshots.)

1. **Authorization prompt.** The seller sees the consent prompt listing the scopes your app requests, and clicks **Next** under the correct region.
2. **Log in.** The seller logs in to their TikTok Shop seller account (or creates one). If a Seller Center account is already signed in — or they're using a Seller Center test account — this step is skipped.
3. **Confirm details.** The seller reviews and confirms the required information on the form shown.
4. **Approve.** The seller approves authorization for your app.
5. **Redirect.** The seller is redirected to your **Redirect URL**, which carries the temporary `code` (used as `auth_code`) and your `state`. Exchange it for tokens as described in the step-by-step guide.

> ❗ **Important:** After successful approval, the seller is redirected to the **Redirect URL** you configured in your app. This URL contains the `auth_code` needed for the next step.

## What "log in to your app to finish" means
After the redirect, the seller may need to **sign in to your application** (the developer-side product, not TikTok Shop) so your app can associate the new authorization with the seller's account in your system. Implement your Redirect URL handler to read the `code`/`state`, complete sign-in, and then exchange the `auth_code` for tokens.
## Renew authorization
30 days before an authorization expires, an **Upcoming authorization expiration** webhook is triggered (subscribe to it and inspect its payload in the Webhooks overview). To renew, ask the seller to either:

* Open the authorization link again, or
* Navigate to **TikTok Shop Seller Center > App Store > My apps and incidents**.

## Cancel authorization
A seller can cancel authorization under **TikTok Shop Seller Center > App Store > My apps and incidents**. This triggers a **Seller deauthorization** webhook — subscribe to it via the Webhooks overview so your app can revoke stored tokens and stop calling APIs for that seller.
## Testing authorization (development stage)
While your app is in development, online sellers can't authorize it. For testing, use a Seller Center **test account** via the **Development Shops** section of Partner Center. This is the same development-shop flow described in the step-by-step guide — with a test account you go straight to the **seller authorization approval** step and can generate an access token without an authorization link. See the [Seller Center Development Shops User Guide](seller-center-development-shops) to create one.








# 
