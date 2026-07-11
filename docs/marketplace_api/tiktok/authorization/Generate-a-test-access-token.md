# Generate a test access token

Now that you've [created a test TikTok Seller account](https://partner.tiktokshop.com/docv2/page/create-test-seller-account), you're ready to generate a test access token.
A test access token is an OAuth 2.0 credential that you present to the TikTok Shop API resource server to access the data of the TikTok Shop test Seller that consented to sharing their data with your TikTok Shop App.
In order to generate a test access token, you'll first need to go to your test Seller account, consent to share data with your test TikTok Shop App, and retrieve the **authorization code** in the return URL that you specified when you created your test TikTok Shop App. You'll then pass the authorization code to the TikTok Shop Authorization Server to retrieve an **access token** and a **refresh token**.
To generate a test access token, begin by navigating to the [TikTok Shop Partner Center Console](https://partner-sso.tiktok.com/account/login).
# Domain usage
TikTok Shop authorization-related documents may mention several domains. They serve different purposes:
| Domain | Purpose |
| --- | --- |
| `https://partner.tiktokshop.com` | TikTok Shop Partner Center and developer documentation entry point. Some app creation and OAuth setup guides link to this domain. |
| `https://partner-sso.tiktok.com/account/login` | Partner Center Console sign-in page used before accessing **Development Kits**, **Development Shops**, and app testing tools. |
| `https://auth.tiktok-shops.com` | TikTok Shop Authorization Server for token APIs, including `/api/v2/token/get` and `/api/v2/token/refresh`. Use this domain from a secure backend or trusted API client, not from the browser address bar. |
# Steps

1. Click on **Development Kits > Development Shops**.
2. Click on the test account. In the right hand pane, under **Start Testing**, click on the **Authorize App** button.
3. In the **Authorize a service** dialog box, enable the radio button for your TikTok Shop App.
4. You'll be redirected to the TikTok Shop Seller Center for your test Seller account. Select the duration, enter a contact email though it's not used, and finally click the **Confirm to install** button.
5. You'll be redirected to the **Authorize** dialog box. Select the checkbox next to the acknowledgement, and click the **Authorize** button.
6. You'll be redirected to the **redirect URL** that you specified for your TikTok Shop App when you created it. If you don't have a service at the redirect URL to receive the authorization code, the URL address in your browser will contain your callback URL, so copy and paste the URL to a text document. Select the value that the `code` parameter is set to, this is your **authorization code**.
7. Your authorization code is valid for 30 minutes only, so you'll need to move quickly on the next step. You'll be making an HTTP call to the TikTok Shop Authorization Server. Use a secure backend service, curl, or a trusted API client such as Postman. Do not paste a fully assembled token request URL that contains `app_secret` into a browser address bar, shared screenshots, logs, or untrusted third-party tools. The server address is `https://auth.tiktok-shops.com/api/v2/token/get` and there are four required query parameters:
   1. `app_key`: Your TikTok Shop App application key that was generated for you when you created your TikTok Shop App.
   2. `app_secret`: Your TikTok Shop App secret that was generated for you when you created your TikTok Shop App. Keep this value server-side.
   3. `auth_code`: The `code` parameter from step 6.
   4. `grant_type`: This string must be set exactly to `authorized_code`. Note that this is **not** the standard OAuth 2.0 spelling `authorization_code`; using `authorization_code` will cause the request to fail.
8. The response body for the call in step 7 includes a JSON object named `data`. For the purposes of making your first API call, we'll focus on four properties in this object:
   1. `access_token`: This is the **access token** necessary to make your first API call.
   2. `access_token_expire_in`: This is the expiration date and time for the `access_token`. It's in Unix epoch time. The default access token validity period is seven days.
   3. `refresh_token`: This is the **refresh token** you'll use to generate a new `access_token` once the current date is greater than `access_token_expire_in`.
   4. `refresh_token_expire_in`: This is the expiration date and time of the refresh token in Unix epoch format. Once this date and time has been reached, you must re-authorize your TikTok Shop App starting at step 2 above.

# Example call flow
For step 7 above, call the token endpoint from a secure backend service, curl, or Postman. Use placeholders or environment variables for secrets; do not paste real `app_secret` values into browser address bars, public logs, tickets, or screenshots.
Example curl request:
```Bash
curl -G 'https://auth.tiktok-shops.com/api/v2/token/get' \
  --data-urlencode 'app_key={app_key}' \
  --data-urlencode 'app_secret={app_secret}' \
  --data-urlencode 'auth_code={auth_code_from_redirect}' \
  --data-urlencode 'grant_type=authorized_code'
```

Example Postman setup:
| Setting | Value |
| --- | --- |
| Method | `GET` |
| URL | `https://auth.tiktok-shops.com/api/v2/token/get` |
| Query param `app_key` | `{{app_key}}` |
| Query param `app_secret` | `{{app_secret}}` |
| Query param `auth_code` | `{{auth_code}}` |
| Query param `grant_type` | `authorized_code` |
If all the parameter values are valid, the response will be in JSON text format. For example:
```JSON
{
  "code": 0,
  "message": "success",
  "data": {
    "access_token": "TTP_Fw8rBwAAAAAkW03FYd09DG-9INtpw361hWthei8S3fHX8iPJ5AUv99fLSCYD9-UucaqxTgNRzKZxi5-tfFMtdWqglEt5_iCk",
    "access_token_expire_in": 1660556783,
    "refresh_token": "TTP_NTUxZTNhYTQ2ZDk2YmRmZWNmYWY2YWY2YzkxNGYwNjQ3YjkzYTllYjA0YmNlMw",
    "refresh_token_expire_in": 1691487031,
    "open_id": "7010736057180325637",
    "seller_name": "Jjj test shop",
    "seller_base_region": "ID",
    "user_type": 0,
    "granted_scopes": [
      "seller.affiliate_collaboration.read",
      "seller.affiliate_collaboration.write"
    ]
  },
  "request_id": "2022080809462301024509910319695C45"
}
```

The fields in the response are defined as follows:
| **Parameter** | **Type** | **Description** | **Sample** |
| --- | --- | --- | --- |
| code | int | A machine-readable response code that represents the request result. `0` indicates success. For more information about failure codes, refer to Common error codes. | 0 |
| message | string | A human-readable message that describes the success or failure of the API request. | success |
| request_id | string | ID to track the API request. | 2022080809462301024509910319695C45 |
| data | object | The response data payload. |  |
| access_token | string | User access token needed to make calls to TikTok Shop Open API endpoints. Pass this value in the `x-tts-access-token` header of an API request to authorize the request. | TTP_Fw8rBwAAAAAkW03FYd09DG-9INtpw361hWthei8S3fHX8iPJ5AUv99fLSCYD9-UucaqxTgNRzKZxi5-tfFMtdWqglEt5_iCk |
| access_token_expire_in | Unix timestamp | Expiration timestamp for access token, with default expiration time set to **seven days**. The Unix timestamp represents the date and time the access token will expire. | 1660556783 |
| refresh_token | string | A token to refresh the access token. Store it securely on the server side. | TTP_NTUxZTNhYTQ2ZDk2YmRmZWNmYWY2YWY2YzkxNGYwNjQ3YjkzYTllYjA0YmNlMw |
| refresh_token_expire_in | Unix timestamp | Expiration timestamp for refresh token. The Unix timestamp represents the date and time the refresh token will expire. | 1691487031 |
| open_id | string | An ID used to identify the user who has authorized the retrieval of their data in API calls. | 7010736057180325637 |
| seller_name | string | The name of the seller you are authorizing for your app. | Jjj test shop |
| seller_base_region | string | The region where the seller is based. | ID |
| user_type | int | Type of user returned by the token response. Possible values: `0`: `TTS` (TikTok Shop seller); `1`: `TTC` (TikTok creator); `2`: `PARTNER`; `3`: `PARTNERV2`; `4`: `GS`; `5`: `GSV2`. | 0 |
| granted_scopes | []string | The authorized API scopes for the app. This field includes the **Scope Key** value of the authorized API scopes.  <br> ![Image](https://p16-arcosite-sg.ibyteimg.com/tos-alisg-i-k9wyc2ijk0-sg/044481b7d2fd495989a3ef8bbbc502fa~tplv-k9wyc2ijk0-image.image) <br>  | ["seller.affiliate_collaboration.read","seller.affiliate_collaboration.write"] |
# Refresh an access token
When the access token expires, use the refresh token to request a new access token:
```Bash
curl -G 'https://auth.tiktok-shops.com/api/v2/token/refresh' \
  --data-urlencode 'app_key={app_key}' \
  --data-urlencode 'app_secret={app_secret}' \
  --data-urlencode 'refresh_token={refresh_token}' \
  --data-urlencode 'grant_type=refresh_token'
```

The `grant_type` value for this endpoint must be set exactly to `refresh_token`. If the refresh token has expired, or if the test Seller has revoked authorization, you must generate a new authorization code and repeat the authorization flow.
# Next steps
To continue on the journey to making your first API call, make note of your **access_token** value and securely store the **refresh_token** for future token renewal.
Your next step is to [create a cryptographic hash to sign your API call](https://partner.tiktokshop.com/docv2/page/create-hash-to-sign-your-test-api-call).

