# Common errors

When making API requests, ensuring the correct structure and format is key to smooth communication with TikTok Shop's servers. This topic covers common gateway and cross-domain errors related to the **request query**, **header**, and **body format**. These fundamental errors occur before business logic processing and must be resolved for a request to be processed successfully.
**Note:**`0` in the response code indicates that the request was successfully processed.
**Business error codes:** This page does not exhaustively list endpoint-specific business errors. For business logic failures, open the corresponding endpoint reference page and check the **Errorcode** section at the bottom of that page. For the full API reference entry point, refer to [TTS API reference docs](https://partner.tiktokshop.com/docv2/page/create-product).
**Recommended troubleshooting path:**

1. Confirm the HTTP status code first, especially `401`, `403`, `404`, `408`, `429`, and `5xx`.
2. Check the API response `code` and `message` together. Some common request-validation failures reuse the same numeric code.
3. If the failure is endpoint-specific, check the endpoint reference page's **Errorcode** section.
4. If the failure is authorization-related, compare the endpoint's required scope with both the app's scopes in Partner Center and the token's `granted_scopes` field.

# Message keyword index for `36009004`
The code `36009004` is reused for multiple different request-validation failures. Do not use the numeric code alone for programmatic branching. Combine it with the response `message` keyword, and log the full response including `request_id`.
| **Message keyword** | **Likely meaning** | **What to check** |
| --- | --- | --- |
| `Missing credentials`, `signature` | The required `sign` query parameter is missing. | Generate a valid signature by referring to Sign your API request. |
| `access_token header is invalid` | The `access_token` header is invalid. | Pass the access token obtained from Get Access Token. |
| `x-tts-access-token header is invalid` | The `x-tts-access-token` header is invalid. | Pass the access token obtained from Get Access Token, and confirm the token belongs to the correct authorization principal. |
| `Invalid app_key` | The `app_key` query parameter is invalid, disabled, deleted, or cannot be resolved. | Check the app key on the **App details** page in **Partner Center**. |
| `timestamp`, `lesser than 0` | The `timestamp` query parameter is negative. | Use a Unix timestamp within the accepted time window. |
| `timestamp`, `earlier than 5 minutes` | The timestamp is too old. | Keep the timestamp within 5 minutes before the current time. |
| `timestamp`, `more than 30 seconds` | The timestamp is too far in the future. | Keep the timestamp no more than 30 seconds beyond the current time. |
| `shop_cipher`, `not required` | The request contains an unnecessary `shop_cipher`. | Remove `shop_cipher` and check the endpoint's required identifier. |
| `category_asset_cipher`, `not required` | The request contains an unnecessary `category_asset_cipher`. | Remove `category_asset_cipher` and check the endpoint's required identifier. |
| `shop_id`, `invalid` | The `shop_id` query parameter is invalid. | Retrieve the correct shop identifier from Get Authorized Shops. |
| `Invalid API version` | The API version is invalid or unsupported. | See the version note in **Parameter errors**. The API versioning guide may use `36009014`, while legacy/common gateway responses may still surface `36009004`; verify the actual response for the endpoint/version being called. |
# General errors
| **Code** <!-- width:90px --> | **Error message** <!-- width:300px --> | **Details and guidance** |
| --- | --- | --- |
| 36009002 | Too many requests. You've made too many requests in a short period of time. | Treat this as a rate-limit condition. The HTTP response should be handled together with the business code: `HTTP 429` and `36009002` both indicate rate limiting. Apply retry/backoff logic, respect `Retry-After` if present, and refer to Rate limits for details. |
| 36009007 | Request timeout. The request to the endpoint timed out. | Please try again, or consider splitting it into smaller requests. |
| 36009009 | Invalid path. The specified path does not match any available endpoint. | Refer to the API documentation for details. |
| 36009010 | Invalid method. The HTTP method used is not supported by this endpoint. | Refer to the API documentation for details. |
| 36009021 | Invalid file size. The uploaded file size exceeds the maximum limit. | Refer to the API documentation for details. |
| 36009022 | Invalid request format. The request body format must be `application/json` for structured data or `multipart/form-data` for binary files. | Refer to the API documentation for details. |
| 36009023 | Invalid request format. The value of the `content-type` header must be `multipart/form-data`. | Refer to the API documentation for details. |
# Authorization errors
| **Code** <!-- width:90px --> | **Error message** <!-- width:300px --> | **Details and guidance** |
| --- | --- | --- |
| **105005** | **Access denied. The app is not authorized to access the endpoint because the access scopes granted for the app or the access token do not contain the required access scope for the endpoint.** | **Most common access-scope failure. Check this first when an API call fails with "Access denied" or when calls from Developer Tool / API Testing Tool fail after app setup.** <br>  <br>  Suggested checks:  <br>  1. Check the granted scopes for the app in **Partner Center** > **App & Service** > **Manage API**. If the required scope is missing, apply or enable it in Partner Center.  <br>  2. Check the granted scopes for the token in the `granted_scopes` field of the Get Access Token response. If the required scope is missing, request the user to reauthorize the required scope, and then generate a new token accordingly. |
| 101000 | Invalid query or header. The `category_asset_cipher` query parameter or `x-tts-access-token` header is invalid. | For `category_asset_cipher`, ensure you retrieve the correct value from the Get Authorized Category Assets endpoint.  <br>  <br>  For `x-tts-access-token`, possible causes include:  <br>  - The token has an invalid `user_type` for this endpoint. See the `user_type` value definitions in Generate a test access token, and check the endpoint's entity tag in API entity tags to confirm whether it expects a seller, creator, partner, shop, or asset-level token.  <br>  - The token is not associated with a shop, or the associated shop does not match the provided `shop_cipher` query parameter.  <br>  <br>  Refer to the authorization guide for details. |
| 36009033 | Access denied. Your IP address is not in the IP allow list configured for this app. | Add your IP address in **Partner Center** > **App & Service**. |
# Authentication errors
| **Code** <!-- width:90px --> | **Error message** <!-- width:300px --> | **Details and guidance** |
| --- | --- | --- |
| 105002 | Expired credentials. The `access_token` or `x-tts-access-token` header has expired. | Refresh your token by using the Get Refresh Token endpoint. |
| 106001 | Invalid credentials. The `sign` query parameter is invalid. | Ensure you generate a valid signature by referring to the guide on signing your request. |
| 36009004 | Missing credentials. The request does not include a required signature in the query. | Generate a signature by referring to the guide on signing your request. |
| 36009004 | Invalid credentials. The `access_token` header is invalid. | Please pass in the `access_token` you obtained from the Get Access Token endpoint. |
| 36009004 | Invalid credentials. The `x-tts-access-token` header is invalid. | Please pass in the `access_token` you obtained from the Get Access Token endpoint. |
| 36009004 | Invalid credentials. Invalid `app_key` query parameter. | Possible reasons include an invalid key format, the app not being found, the app being disabled or deleted, or there was an error in retrieving the required authorization. Ensure you are retrieving the correct value from the **App details** page in **Partner Center**. |
| 36009004 | Invalid timestamp. The value of the `timestamp` query parameter must not be lesser than 0. | Timestamps must lie within the range of 5 minutes before to 30 seconds beyond the current time. |
| 36009004 | Invalid timestamp. The value of the `timestamp` query parameter must not be earlier than 5 minutes before the current time. | Timestamps must lie within the range of 5 minutes before to 30 seconds beyond the current time. |
| 36009004 | Invalid timestamp. The value of the `timestamp` query parameter must not exceed the current time by more than 30 seconds. | Timestamps must lie within the range of 5 minutes before to 30 seconds beyond the current time. |
# Parameter errors
| **Code** <!-- width:90px --> | **Error message** <!-- width:300px --> | **Details and guidance** |
| --- | --- | --- |
| 106013 | Missing identifier. The `shop_cipher` query parameter is required to identify the target shop. | Retrieve this value from the Get Authorized Shops endpoint. |
| 36009004 | Unexpected identifier. The `shop_cipher` query parameter is not required for this request. | Remove it and try again. Refer to the API documentation for details on the identifier required. |
| 36009004 | Unexpected identifier. The `category_asset_cipher` query parameter is not required for this request. | Remove it and try again. Refer to the API documentation for details on the identifier required. |
| 36009004 | Invalid identifier. The `shop_id` query parameter is invalid. | Retrieve the correct value from the Get Authorized Shops endpoint. |
| 36009014 / 36009004 | Invalid API version. The `version` value is invalid or unsupported. | The API versioning topic identifies invalid API versions with `36009014`, while older/common gateway examples may show `36009004` with the same `Invalid API version` message. Until all docs and runtime responses are aligned, handle this condition by checking both the code and the `Invalid API version` message keyword, and verify the actual response for the endpoint/version you are calling. Refer to TTS API versioning and the endpoint reference page for valid versions. |
| 36004004 | Invalid auth code. | The `auth_code` has already been used, is expired, or is invalid. |
