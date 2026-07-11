# Create a hash to sign your test API call

Now that you've [created a test access token](https://partner.tiktokshop.com/docv2/page/generate-test-access-token), you're ready to generate the cryptographic hash required to sign your first API call.
There are five steps to generating the required cryptographic hash:
# Domain and App Secret location
TikTok Shop documents may mention several Partner Center entry points. Use them as follows:
| Entry point | Purpose |
| --- | --- |
| `https://partner.tiktokshop.com` | Partner Center and developer documentation entry point. |
| `https://partner-sso.tiktok.com/account/login` | Partner Center Console sign-in page. After signing in, use the Console to manage apps, development shops, and app credentials. |
You can find your **App Secret** in the Partner Center Console:
```Plain Text
Partner Center Console
  -> App & Service
  -> Select your app
  -> App credentials / Developing section
  -> App Secret
```

Some app creation guides mention that the App Secret is shown on the confirmation page when the app is created. If you need to look it up later, use the Partner Center Console path above. In this guide, **App Secret** is the only term used for this credential.
# Step 1: Sort query parameter names alphabetically
Sort the query parameter names and values alphabetically. For the Get Authorized Shops API, there are two required query parameters: `app_key` and `timestamp`. You're already familiar with `app_key`, it's the TikTok Shop App key that was generated for your test TikTok Shop App when you created it. `timestamp` is the current date and time in Unix epoch format, which is the number of seconds that have passed since January 1, 1970.
Generate the timestamp locally in seconds. For example:
```Bash
date +%s
```

The timestamp must be close to the TikTok Shop server time. If your local machine's clock differs too much from server time, signature verification can fail. If you see timestamp or signature validation errors, check your system clock and refer to Common error codes.
As an example, let's assume your `app_key` is `123456` and the current `timestamp` is `1234567890`. To sort these parameters, we compare `app_key` to `timestamp`, and since the first letter of `app_key` is `a`, it comes before the `t` in `timestamp`. Therefore, our sorted query parameters are 1: `app_key`, 2: `timestamp`.
# Step 2: Concatenate the sorted parameter names and values
Concatenate the sorted query parameters and their values from step 1 into a single string. In the example from step 1, this string is `app_key123456timestamp1234567890`.
# Step 3: Append the string from step 2 to the API path
For our first API call, we don't need to perform a step to concatenate the request body to the string created in step 2. For the call to Get Authorized Shops, there is no request body.
If you sign an API that has a request body, append the request body at this point according to the rules in [Sign your API request](https://partner.tiktokshop.com/docv2/page/sign-your-api-request). Make sure the body used for signing exactly matches the body sent in the API request.
Therefore, our next step is to append the string from step 2 to the API request path. For Get Authorized Shops, this is:
```Plain Text
/authorization/202309/shops
```

In the example from steps 1 and 2, the resulting string is:
```Plain Text
/authorization/202309/shopsapp_key123456timestamp1234567890
```

# Step 4: Prepend and append the App Secret
Prepend and append your TikTok Shop App Secret to the string in step 3. In our example, let's assume that our App Secret is `abc000def111`. The resulting string is now:
```Plain Text
abc000def111/authorization/202309/shopsapp_key123456timestamp1234567890abc000def111
```

# Step 5: Encode the string using HMAC-SHA256
To generate the signature, use the **HMAC-SHA256** algorithm.
HMAC-SHA256 requires two inputs:

1. **Key**: your TikTok Shop **App Secret**.
2. **Message**: the string to be signed from step 4.

Some tools label the HMAC key field as `Key`, `Secret`, `Secret Key`, or `Salt`. In all of those fields, use the same TikTok Shop **App Secret**. Do not use the App Key as the HMAC key.
Do not paste your App Secret into public third-party HMAC generator websites or search-result tools. App Secret is a sensitive credential and should stay in your local environment, backend service, or trusted internal tooling.
You can generate the signature locally. The examples below use placeholder values; in real applications, load the App Secret from environment variables or a secret manager instead of hardcoding it in source code.
For example, with Python:
```Python
import hashlib
import hmac

app_secret = "abc000def111"
message = "abc000def111/authorization/202309/shopsapp_key123456timestamp1234567890abc000def111"

signature = hmac.new(
    app_secret.encode("utf-8"),
    message.encode("utf-8"),
    hashlib.sha256,
).hexdigest()

print(signature)
```

Or with Node.js:
```JavaScript
const crypto = require("crypto");

const appSecret = "abc000def111";
const message =
  "abc000def111/authorization/202309/shopsapp_key123456timestamp1234567890abc000def111";

const signature = crypto
  .createHmac("sha256", appSecret)
  .update(message)
  .digest("hex");

console.log(signature);
```

Use lowercase hex output unless otherwise specified. For complete signing rules and language-specific samples, refer to [Sign your API request](https://partner.tiktokshop.com/docv2/page/sign-your-api-request).
# Next steps
Now that you've generated your cryptographic hash, you can make your first API call [Get Authorized Shops](https://partner.tiktokshop.com/docv2/page/call-get-authorized-shops).
