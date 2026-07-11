# Partner authorization guide

# What does partner authorization do?
After partner authorization, the app can call **Affiliate Partner** APIs with the permissions granted by the partner.
Partner authorization is used for partner-owned business category data. Currently, TikTok Shop Partner Center supports this flow only for the **Seller and Scalable Creator Match-Up (TAP)** partner category. For more information about supported endpoints, refer to the **Affiliate Partner** API reference.
# Authorization domains overview
TikTok Shop uses different authorization entry domains for seller, creator, and partner authorization. Use the authorization guide that matches the data owner you are asking to authorize.
| Authorization type | Data owner | US authorization entry | ROW authorization entry | Notes |
| --- | --- | --- | --- | --- |
| Seller authorization | Seller / shop | `https://services.us.tiktokshop.com/open/authorize` | `https://services.tiktokshop.com/open/authorize` | Used for seller-owned shop data and seller API scopes. |
| Creator authorization | Creator | `https://shop.tiktok.com/alliance` | `https://shop.tiktok.com/alliance` | Used for creator authorization flows. Follow the creator authorization guide for the full path and parameters. |
| Partner authorization | Partner | `https://partner.us.tiktokshop.com/open/authorize` | `https://partner.tiktokshop.com/open/authorize` | Used for Affiliate Partner APIs and partner API scopes. |
# Requirements

1. If the app is still in development, the app can only accept authorization from the owner of the app. After launch, the app can accept authorization from other partners.
2. The app must enable partner API scopes, which are the ones starting with `partner` in scope keys:

![Image](https://p16-arcosite-sg.ibyteimg.com/tos-alisg-i-k9wyc2ijk0-sg/dec0b1025fc14dec8878e93266569436~tplv-k9wyc2ijk0-image.image)
# Authorization link
The basic authorization link can be obtained from the **Copy authorization link** button.
![Image](https://p16-arcosite-sg.ibyteimg.com/tos-alisg-i-k9wyc2ijk0-sg/1700c2b084de4d4fac238f4a74de20b9~tplv-k9wyc2ijk0-image.image)
If the app is in development, the developer needs to generate the authorization link manually using the app's `service_id`. You can find `service_id` in **Partner Center > App & Service > select the app/service > Basic Information > Service ID**:
![Image](https://p16-arcosite-sg.ibyteimg.com/tos-alisg-i-k9wyc2ijk0-sg/b919a650b24046c481b58fedf505d340~tplv-k9wyc2ijk0-image.image)
Use the authorization domain that matches the partner's region:
| Partner region | Authorization link |
| --- | --- |
| United States | `https://partner.us.tiktokshop.com/open/authorize?service_id={service_id}` |
| Rest of World (ROW) | `https://partner.tiktokshop.com/open/authorize?service_id={service_id}` |
Adding a `state` parameter is encouraged, but not required for partner authorization. Please see the [OpenID Connect](https://developers.google.com/identity/protocols/oauth2/openid-connect#createxsrftoken) documentation for an example of how to create and confirm a `state`.
# Get and refresh tokens
After the partner approves authorization, TikTok Shop redirects the partner back to the app's configured redirect URL with an authorization code. Exchange this code for an access token before calling Affiliate Partner APIs.

1. Receive the authorization code from the redirect URL.
2. Call the token API from your backend service:

```HTTP
GET https://auth.tiktok-shops.com/api/v2/token/get?app_key={app_key}&app_secret={app_secret}&auth_code={auth_code}&grant_type=authorized_code
```

The successful response includes `access_token`, `access_token_expire_in`, `refresh_token`, `refresh_token_expire_in`, and `granted_scopes`. Store tokens securely on the server side. Do not expose `app_secret`, `access_token`, or `refresh_token` in frontend code.
Use the `access_token` in the `x-tts-access-token` request header when calling Affiliate Partner APIs. Before calling partner-category APIs, call **Get Authorized Category Assets** to confirm the authorized business category and obtain the category asset cipher:
```HTTP
GET /authorization/202405/category_assets
Header: x-tts-access-token: {access_token}
```

The returned `category_assets[].cipher` identifies the authorized partner category asset and is used as an input parameter in Affiliate Partner APIs.
When the access token expires, refresh it with the refresh token:
```HTTP
GET https://auth.tiktok-shops.com/api/v2/token/refresh?app_key={app_key}&app_secret={app_secret}&refresh_token={refresh_token}&grant_type=refresh_token
```

If the refresh token expires or the partner cancels authorization, ask the partner to authorize the app again.
# Partner requirements
Partner authorization grants access only to the business category data that the partner authorizes and the app is approved to access. Currently, Partner Center exposes partner authorization only for the **Seller and Scalable Creator Match-Up (TAP)** category; it does not grant access to unrelated partner business data.
The partner must have successfully enrolled in **Seller and Scalable Creator Match-Up (TAP)**:
![Image](https://p16-arcosite-sg.ibyteimg.com/tos-alisg-i-k9wyc2ijk0-sg/445e0f8141aa4417b224109f48263772~tplv-k9wyc2ijk0-image.image)
Make sure the user chooses **Seller and Scalable Creator Match-Up (TAP)** on the authorization page.
![Image](https://p16-arcosite-sg.ibyteimg.com/tos-alisg-i-k9wyc2ijk0-sg/ffeba3cb3bd74f029a7e4f9d537441e6~tplv-k9wyc2ijk0-image.image)
# Cancel authorization
The partner can cancel authorization from **My account > My authorizations**.
After cancellation, the app should stop calling partner APIs for that partner, treat existing tokens as invalid, and ask the partner to authorize again if access is still required.
![Image](https://p16-arcosite-sg.ibyteimg.com/tos-alisg-i-k9wyc2ijk0-sg/46cf0e4a4a7647e0a811101fec97367b~tplv-k9wyc2ijk0-image.image)
