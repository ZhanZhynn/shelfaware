# Integrate Node.js SDK

# Overview
Follow this guide to install the TikTok Shop Node.js SDK, retrieve a seller access token, get an authorized shop's `shop_cipher`, and make your first product API call with [Search Products](https://partner.tiktokshop.com/docv2/page/search-products-202502).
The SDK signs TikTok Shop API requests for you. Use [Sign your API request](https://partner.tiktokshop.com/docv2/page/sign-your-api-request) only when you call OpenAPI endpoints with your own HTTP client instead of the SDK.
This guide uses:
| Task | SDK API or helper | OpenAPI endpoint |
| --- | --- | --- |
| Exchange an authorization code for an access token | `AccessTokenTool.getAccessToken(authCode)` | Authorization token exchange helper in the SDK |
| Get authorized shops and `shop_cipher` | `AuthorizationV202309Api.ShopsGet` | [GET /authorization/202309/shops](https://partner.tiktokshop.com/docv2/page/get-authorized-shops-202309) |
| Search products | `ProductV202502Api.ProductsSearchPost` | [POST /product/202502/products/search](https://partner.tiktokshop.com/docv2/page/search-products-202502) |
Version note: API groups do not always share the same version. For example, this guide uses `AuthorizationV202309Api` for Get Authorized Shops because the current endpoint is `/authorization/202309/shops`, while the Search Products example uses `ProductV202502Api`.
# Prerequisites
Before integrating the SDK, you need:

1. A TikTok Shop app and a test seller account. See [Create a test seller account](https://partner.tiktokshop.com/docv2/page/create-test-seller-account).
2. A seller authorization code from the redirect URL configured for your test app. See [Generate a test access token](https://partner.tiktokshop.com/docv2/page/generate-test-access-token).
3. The latest Node.js SDK package downloaded from Partner Center. SDK packages are generated for your app's enabled scopes and API versions. See [Update SDK](https://partner.tiktokshop.com/docv2/page/update-sdk).

Do not commit `app_key`, `app_secret`, `access_token`, `refresh_token`, authorization codes, or seller data to source control. Load secrets from environment variables or your secret manager.
# Environment
Use a supported Node.js LTS release. As of July 2026, Node.js 22.x and 24.x are supported LTS lines; Node.js 16.x is end-of-life. Check the [Node.js release schedule](https://github.com/nodejs/release#release-schedule) before publishing a new version of this guide.
Recommended baseline:
| Component | Recommendation |
| --- | --- |
| Node.js | 22.x LTS or 24.x LTS |
| TypeScript | Current supported TypeScript major used by your project |
| HTTP client | Use the SDK's generated client. For custom HTTP calls, use Node's built-in `fetch` or another maintained client. Do not add `request` to new projects. |
# Project layout
After downloading and unzipping the SDK, place it in your project and import it by the relative path from your code file to the SDK entry point.
Example layout:
```Plain Text
my-project/
  package.json
  tsconfig.json
  src/
    index.ts
  tiktok-shop-node-sdk/
    index.ts
    api/
    model/
    ...
```

If your demo file is `src/index.ts`, import from the SDK folder with:
```TypeScript
import {
  AccessTokenTool,
  ClientConfiguration,
  TikTokShopNodeApiClient,
} from "../tiktok-shop-node-sdk";
```

If you place the demo file directly inside the SDK root, `from "."` works because it points to that folder's `index.ts`. In an application project, prefer importing from the explicit SDK folder path.
# Installation
Install the dependencies listed in the SDK package you downloaded. If the generated SDK includes its own `package.json`, use that file as the source of truth.
For a new TypeScript project around the SDK, start with a maintained baseline similar to this:
```JSON
{
  "type": "module",
  "scripts": {
    "start": "tsx src/index.ts"
  },
  "dependencies": {
    "tslib": "^2.8.1"
  },
  "devDependencies": {
    "@types/node": "^24",
    "tsx": "^4",
    "typescript": "^6"
  }
}
```

Do not add `request` or `@types/request` to new integrations. The [request](https://www.npmjs.com/package/request) package is deprecated and should not be used for new custom HTTP code. If your downloaded SDK still depends on `request`, download the latest SDK from Partner Center and check whether the generated client has been updated; otherwise keep the dependency only as a compatibility requirement for that specific SDK package.
Add the following to `tsconfig.json`:
```JSON
{
  "compilerOptions": {
    "esModuleInterop": true,
    "moduleResolution": "node",
    "target": "ES2022",
    "module": "ESNext",
    "strict": true
  }
}
```

Install dependencies:
```Shell
npm install
```

You can also use `yarn install` or `pnpm install` if your project standardizes on Yarn or pnpm.
# Configuration
Configure the SDK from environment variables:
```TypeScript
const requiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

ClientConfiguration.globalConfig.app_key = requiredEnv("TTS_APP_KEY");
ClientConfiguration.globalConfig.app_secret = requiredEnv("TTS_APP_SECRET");

const client = new TikTokShopNodeApiClient({
  config: {
    sandbox: process.env.TTS_SANDBOX === "true",
  },
});
```

`sandbox: false` sends requests to the production environment. Use `sandbox: true` only when you are testing against the sandbox or Development Shop environment supported by your SDK package.
# Get Access Token
Use the SDK helper to exchange the one-time seller authorization code for an access token.
```TypeScript
const authCode = requiredEnv("TTS_AUTH_CODE");

const { body: tokenBody } = await AccessTokenTool.getAccessToken(authCode);
console.log("getAccessToken response:", JSON.stringify(tokenBody, null, 2));

const accessToken = tokenBody.data?.access_token;
if (!accessToken) {
  throw new Error("Failed to get access token");
}
```

In production, store the access token, refresh token, and their expiration timestamps in a secure server-side data store. Do not store tokens in frontend code.
# Get Shop Cipher
`shop_cipher` identifies the authorized shop for shop-level APIs such as Search Products. Call [Get Authorized Shops](https://partner.tiktokshop.com/docv2/page/get-authorized-shops-202309) with the seller `accessToken` and use `data.shops[].cipher` from the response.
```TypeScript
const contentType = "application/json";

const { body: shopsGetBody } =
  await client.api.AuthorizationV202309Api.ShopsGet(accessToken, contentType);

console.log("ShopsGet response:", JSON.stringify(shopsGetBody, null, 2));

const shopList = shopsGetBody.data?.shops ?? [];
if (shopList.length === 0) {
  throw new Error("No authorized shops found.");
}

const selectedShop = shopList[0];
const shopId = selectedShop.id;
const shopCipher = selectedShop.cipher;

if (!shopCipher) {
  throw new Error(`No shop_cipher found for shop_id: ${shopId}`);
}

console.log(`Using shop_id: ${shopId}, shop_cipher: ${shopCipher}`);
```

Do not hard-code `shop_cipher`. Always use the cipher for the shop whose products you want to access.
# Search Products
Call [Search Products](https://partner.tiktokshop.com/docv2/page/search-products-202502) after you have both `accessToken` and `shopCipher`.
OpenAPI endpoint:
| Item | Value |
| --- | --- |
| Method and path | `POST /product/202502/products/search` |
| Required query parameter | `page_size`, valid range: 1 to 100 |
| Optional query parameters | `page_token`, `shop_cipher` |
| Required headers | `x-tts-access-token`, `Content-Type: application/json` |
| Optional request body filters | `status`, `seller_skus`, `sku_ids`, `category_version`, `create_time_ge`, `create_time_le`, `update_time_ge`, `update_time_le`, and other fields shown in the endpoint reference |

Node.js SDK method call used in this guide:
| Position | Argument | Meaning |
| --- | --- | --- |
| 1 | `pageSize` | Maps to query parameter `page_size`. |
| 2 | `accessToken` | Sent as `x-tts-access-token`. |
| 3 | `contentType` | Usually `application/json`. |
| 4 | `pageToken` | Optional pagination token. Use `undefined` for the first page. |
| 5 | `searchProductsRequestBody` | Optional JSON body for filters. Use `{}` or `undefined` when you do not need filters. |
| 6 | `shopCipher` | Maps to query parameter `shop_cipher`. |

Different SDK languages may generate different positional argument orders. Do not copy the Java or Go method argument order into Node.js code. Check the generated Node.js SDK method signature in your downloaded SDK when you update the SDK.
```TypeScript
const pageSize = 10;
const pageToken = undefined;
const searchProductsRequestBody = {};

const result = await client.api.ProductV202502Api.ProductsSearchPost(
  pageSize,
  accessToken,
  contentType,
  pageToken,
  searchProductsRequestBody,
  shopCipher
);

console.log("Search Products response:", JSON.stringify(result.body, null, 2));
```

# Complete Demo
```TypeScript
import {
  AccessTokenTool,
  ClientConfiguration,
  TikTokShopNodeApiClient,
} from "../tiktok-shop-node-sdk";

const requiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

ClientConfiguration.globalConfig.app_key = requiredEnv("TTS_APP_KEY");
ClientConfiguration.globalConfig.app_secret = requiredEnv("TTS_APP_SECRET");

const client = new TikTokShopNodeApiClient({
  config: {
    sandbox: process.env.TTS_SANDBOX === "true",
  },
});

const main = async () => {
  const contentType = "application/json";

  const authCode = requiredEnv("TTS_AUTH_CODE");
  const { body: tokenBody } = await AccessTokenTool.getAccessToken(authCode);
  console.log("getAccessToken response:", JSON.stringify(tokenBody, null, 2));

  const accessToken = tokenBody.data?.access_token;
  if (!accessToken) {
    throw new Error("Failed to get access token");
  }

  const { body: shopsGetBody } =
    await client.api.AuthorizationV202309Api.ShopsGet(accessToken, contentType);
  console.log("ShopsGet response:", JSON.stringify(shopsGetBody, null, 2));

  const shopList = shopsGetBody.data?.shops ?? [];
  if (shopList.length === 0) {
    throw new Error("No authorized shops found.");
  }

  const selectedShop = shopList[0];
  const shopId = selectedShop.id;
  const shopCipher = selectedShop.cipher;
  if (!shopCipher) {
    throw new Error(`No shop_cipher found for shop_id: ${shopId}`);
  }

  console.log(`Using shop_id: ${shopId}, shop_cipher: ${shopCipher}`);

  const pageSize = 10;
  const pageToken = undefined;
  const searchProductsRequestBody = {};

  const result = await client.api.ProductV202502Api.ProductsSearchPost(
    pageSize,
    accessToken,
    contentType,
    pageToken,
    searchProductsRequestBody,
    shopCipher
  );

  console.log("Search Products response:", JSON.stringify(result.body, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

Run the demo with environment variables:
```Shell
TTS_APP_KEY="your_app_key" \
TTS_APP_SECRET="your_app_secret" \
TTS_AUTH_CODE="your_auth_code" \
TTS_SANDBOX="true" \
npm run start
```

Use `TTS_SANDBOX="false"` or omit `TTS_SANDBOX` for production.
# SDK Updates
SDK packages are app-specific and generated from the scopes and API versions available to your app. Record the SDK download date or package version in your project so you can reproduce generated method signatures.
Update the SDK when:
| Trigger | Action |
| --- | --- |
| You enable new API scopes for the app | Download the latest SDK from the [SDK download page](https://partner.tiktokshop.com/docv2/page/download-sdk). |
| An API adds a new version or sunsets an old version | Regenerate the SDK and check generated API class names such as `ProductV202502Api`. |
| The SDK framework changes | Reinstall dependencies from the SDK package and rerun your build. |
| Method parameter order changes after regeneration | Update the code according to the generated Node.js method signature instead of copying examples from Java or Go. |

For SDK update behavior, see [Update SDK](https://partner.tiktokshop.com/docv2/page/update-sdk).
