Created with Sketch.Open Platform

[Documentation\\
\\
- \\
Developer Guide\\
\\
- \\
API Reference\\
\\
- \\
Push Mechanism\\
\\
\\
- \\
Terms of Use](https://open.shopee.com/developer-guide)

Support Center

-
Raise Ticket

-
FAQ


[Announcement](https://open.shopee.com/announcements) [Console](https://open.shopee.com/console?from=header)

English

-
English

-
简体中文

-
繁體中文

-
Português (Brasil)

-
Korean

-
Bahasa Indonesia

-
ไทย


Log In


Tables of Contents


Getting Started


Getting Started

>


Authorization and Authentication


Authorization and Authentication

The authorization process


The authorization process

Generating the authorization link


Generating the authorization link

Redirect URL Domain Validation Requirements


Redirect URL Domain Validation Requirements

Notes on Redirect URL Domain Validation


Notes on Redirect URL Domain Validation

Authorization Link Examples


Authorization Link Examples

Acquiring authorizations from shop(s)


Acquiring authorizations from shop(s)

Authorizing from a shop account


Authorizing from a shop account

Authorizing from a main account


Authorizing from a main account

Getting and using the authorization code


Getting and using the authorization code

Getting and refreshing the access\_token


Getting and refreshing the access\_token

GetAccesstoken


GetAccesstoken

RefreshAccessToken


RefreshAccessToken

Refreshing the access\_token and refresh\_token on a shop account


Refreshing the access\_token and refresh\_token on a shop account

Refreshing the access\_token and refresh\_token on a main account


Refreshing the access\_token and refresh\_token on a main account

Canceling authorization


Canceling authorization

Canceling authorization by changing the authorization URL


Canceling authorization by changing the authorization URL

Canceling authorization on Seller Center


Canceling authorization on Seller Center

FAQs on authorization and authentication


FAQs on authorization and authentication

Getting Started


Getting Started

Introduction


Introduction

Developer account registration


Developer account registration

App management


App management

API calls


API calls

Push Mechanism notifications


Push Mechanism notifications

Authorization and Authentication


Authorization and Authentication

Sandbox Testing V2


Sandbox Testing V2

Service Partner Program


Service Partner Program

V2.0 API Call Flow


V2.0 API Call Flow

CNSC API Integration Guide


CNSC API Integration Guide

KRSC API Integration Guide


KRSC API Integration Guide

V2.0 Data Definition


V2.0 Data Definition

Requesting Access to Sensitive Data


Requesting Access to Sensitive Data

TW New Developer Audit


TW New Developer Audit

API Best Practices


API Best Practices

Guidelines for Creating Product


Guidelines for Creating Product

Product creation preparation


Product creation preparation

Creating product


Creating product

Creating global product


Creating global product

Publishing global product


Publishing global product

Variant management


Variant management

Product base info management


Product base info management

Stock & Price Management


Stock & Price Management

Order Management


Order Management

First Mile Binding


First Mile Binding

Return Refund Management


Return Refund Management

SIP best practices


SIP best practices

Shopee On-Platform Ads API Guide


Shopee On-Platform Ads API Guide

Shopee Xpress - Package-free Integration Guide


Shopee Xpress - Package-free Integration Guide

API de Cotação (Logística do Vendedor)


API de Cotação (Logística do Vendedor)

Shopee Entrega Direta


Shopee Entrega Direta

AUTO PARTS: COMPATIBILIDADE DE AUTOPEÇAS


AUTO PARTS: COMPATIBILIDADE DE AUTOPEÇAS

Brazil Open API Best Practice


Brazil Open API Best Practice

Passo a Passo Logistica API


Passo a Passo Logistica API

Ferramenta de Log da Open Platform


Ferramenta de Log da Open Platform

Passo a passo para subir a NF-e através da OpenAPI


Passo a passo para subir a NF-e através da OpenAPI

APIs de orders


APIs de orders

Shopee Open API Platform \| Passo a Passo de Solicitação


Shopee Open API Platform \| Passo a Passo de Solicitação

Open API auth call \| Fluxo autorização


Open API auth call \| Fluxo autorização

Fulfilled by Shopee (BR)


Fulfilled by Shopee (BR)

Quotation API (Entrega Expressa) Developer Guide


Quotation API (Entrega Expressa) Developer Guide

Instant Mart Integration Guide


Instant Mart Integration Guide

Livestream API Integration Guide


Livestream API Integration Guide

Shopee AMS API Integration Guide


Shopee AMS API Integration Guide

Shopee Video API Integration Guide


Shopee Video API Integration Guide

Terms of Use


Terms of Use

Terms of Service


Terms of Service

Data Protection Policy


Data Protection Policy

Platform Partner Rules


Platform Partner Rules

TW Developer Screening


TW Developer Screening

Chatbot Terms of Service


Chatbot Terms of Service

# Authorization and Authentication

Last Updated: 2026-05-13


Language Supported:
English /

简体中文 /

繁體中文 /

Português (Brasil) /

ไทย


Authorization is an important step to using Open API. You need to be authorized by the seller in order for your App to call non-public APIs required for shop management.

You will be authenticated based on the public parameters passed to Open API. If the authentication fails, your call will fail and an error will be returned.

|     |
| --- |
| ⚠️ Note <br>- Authorization Validity<br>The maximum validity period for each authorization is 365 days. Sellers may customize the authorization expiration time during the authorization process. Once the authorization expires, you will need to contact the seller to re-authorize your App.<br>- SIP Shops Authorization<br>If a CB SIP primary shop grants authorization to an application, all SIP linked shops will automatically receive the same authorization. However, API access permissions for linked shops are limited. For more details, please refer to the [FAQ](https://open.shopee.com/faq?top=162&sub=166&page=1&faq=214). |

# The authorization process

There are 3 steps to complete authorization: generating the authorization link, acquiring authorization from shop(s), and getting and refreshing the access\_token.

These will be explained in detail below, along with information on what to prepare before authorization, details of the authorization process, and how to use the information returned after authorization to pass the authentication of the platform.

## Generating the authorization link

To improve integration efficiency, the platform provides a new method for generating authorization links. The authorization link is composed of a fixed authorization URL and authorization parameters. All types of Apps can generate authorization links according to the specifications below.

Note: For Seller in House System Apps, you can log in to the Open Platform > App list > click “Authorize” > fill in Redirect URL to generate an authorization link.

![](https://open.shopee.com/opservice/api/v1/image/download/?image_id=AwcI9KDq2kAasxHvc5J41P2%2FdxfAcI3okQeHbiqAUNk94RGGSxJB0feXlyNMS8S9YERegWzV4ki4AMlGULhn3Q%3D%3D&image_type=png)

For all type of App, you need to create an authorization link with the following specifications. The authorization link comprises a fixed authorization URL and other required parameters.

Fixed authorization URL:

| Environment | Region | URL |
| --- | --- | --- |
| Production | Global (excluding Mainland China and Brazil) | [https://open.shopee.com/auth](https://open.shopee.com/auth) |
| Mainland China | [https://open.shopee.cn/auth](https://open.shopee.cn/auth) |
| Brazil | [https://open.shopee.com.br/auth](https://open.shopee.com.br/auth) |
| Sandbox | Global (excluding Mainland China and Brazil) | [https://open.sandbox.test-stable.shopee.com/auth](https://open.test-stable.shopee.com/auth) |
| Mainland China | [https://open.sandbox.test-stable.](https://open.test-stable.shopee.com/auth) [shopee.cn/auth](https://open.test-stable.shopee.cn/auth) |
| Brazil | [https://open.sandbox.test-stable.](https://open.test-stable.shopee.com/auth) [shopee.com.br/auth](https://open.test-stable.shopee.com.br/auth) |

Other required parameters:

| Parameter name | Type | Required | Description |
| --- | --- | --- | --- |
| partner\_id | int | Yes | partner\_id obtained from the App. |
| auth\_type | string | Yes | The role type to be authorized. Enum values:\- seller: used when authorizing a shop or merchant;\- supplier: used when authorizing suppliers (for SCS users);\- user: used when authorizing users (for livestream-related apps, see[https://open.shopee.com/announcements/1190](https://open.shopee.com/announcements/1190) 。 |
| redirect\_uri | string | Yes | The URL where the authorization code (code) is received after the seller completes authorization.<br>Production environment: If the production callback URL domain of the app is empty, the redirect\_uri domain is not validated; otherwise, it must match the configured production callback URL domain.<br>Sandbox environment: If the sandbox callback URL domain is empty, the redirect\_uri domain is not validated; otherwise, it must match the configured sandbox callback URL domain. |
| response\_type | string | Yes | The authorization type. Fixed value: "code". |
| state | string | No | A random, unguessable string used to prevent CSRF attacks. It will be returned as-is to the redirect\_uri after authorization is completed. |

### Redirect URL Domain Validation Requirements

To ensure seller data security, the platform has introduced domain validation for the callback address (redirect\_uri) in authorization links. All developers are required to configure the Test Redirect URL Domain and Live Redirect URL Domain for each App in the Console.

The redirect\_uri parameter mentioned above refers to the callback URL configured in the App information page. You can view it as follows:

![](https://open.shopee.com/opservice/api/v1/image/download/?image_id=LWlPMk1MPvBKjXYViUTE2s2D%2BtKyBcgoIp81rFFMYbAcfXxCNla2k9%2FUShW3XzK1YaFBklT1Sj9w%2BlQspVK%2FzA%3D%3D&image_type=png)

### Notes on Redirect URL Domain Validation

1\. For Apps that have already been created but have not yet declared a callback URL domain, developers should log in to the Console and complete the configuration in the App edit page as soon as possible. Before the configuration is completed, the platform will not enforce domain validation, and the existing authorization process will not be affected.

2\. If the domain of the redirect\_uri parameter (or the redirect parameter in legacy links) does not match the Redirect URL Domain configured in the Console when generating an authorization link, the platform will return the following error:

"The domain of redirect\_uri is not consistent with the Redirect URL Domain declared in console"

(The domain of the callback URL does not match the Redirect URL Domain declared in the Console.)

### Authorization Link Examples

The following are examples of authorization links for both the Production and Sandbox environments for your reference.

Production Environment:

[https://open.shopee.com/auth?partner\_id=10090&auth\_type=seller&redirect\_uri=https://open.shopee.com&response\_type=code](https://open.shopee.com/auth?partner_id=10090&auth_type=seller&redirect_uri=https://open.shopee.com&response_type=code)

Sandbox Environment:

https://open.test-stable.shopee.com/auth?partner\_id=1000016&auth\_type=seller&redirect\_uri=https://open.test-stable.shopee.com&response\_type=code

|     |
| --- |
| ⚠️ NoteThe timestamp used to calculate the sign is only valid for 5 minutes. After the timestamp and the sign expire, the authorization link will no longer be valid, and you need to generate a new link. |

## Acquiring authorizations from shop(s)

After you share the authorization link with the seller, the seller needs to log in to their account, fill in the verification code sent to their mobile phone, and enter the authorization page.

Account types:

- Shop account: can authorize a single shop;
- Main account: can authorize multiple merchants / shops;
- Sub-account: cannot log in to the authorization page.

### Authorizing from a shop account

1\. The seller fills in their login details and selects Log In.

![](https://open.shopee.com/opservice/api/v1/image/download/?image_id=KBASnrCAFko2mX9S0T89U%2FSoT4CJMyAjC1M1ZSkJQ1ZNGsMzm0ze%2F7IWwW0sm2fwR4Oe0IYvVEzUYBwXbEwctA%3D%3D&image_type=png)

2\. The seller fills in the verification code sent to their mobile phone and selects Verify.

![](https://open.shopee.com/opservice/api/v1/image/download/?image_id=UCU7KvaUzAaB2HKVcZFMWNv%2F%2BQ5uquLHwmjRaybfr8fXkrjrGmyT37Nf4MbtS7bbV2Ac5hCEZLXfPrlPFBAf2Q%3D%3D&image_type=png)

3\. Upon logging in, the seller selects Confirm Authorization.

![](https://open.shopee.com/opservice/api/v1/image/download/?image_id=m%2FSS%2FEpwlZ3gfVkoRF1djvREdKCwVR9jmnlr%2F27y6Di2GBlc4SLS6to8TZpplR%2BcgzYukxpFREyhox1zH5ZdvA%3D%3D&image_type=png)

4\. The system will display an authorization validity period selector. Sellers can choose from preset durations (7 days, 30 days, 90 days, 180 days, or 365 days), or select “Customize Expiration Time” to set any expiration date within 365 days.

5\. After authorization is completed, the frontend page will redirect to the redirect\_uri specified in the authorization link, along with the authorization code (code) and shop ID (shop\_id):

[https://open.shopee.com/?code=xxxxxxxxxx&shop\_id=xxxxxx](https://open.shopee.com/?code=xxxxxxxxxx&shop_id=xxxxxx)

### Authorizing from a main account

1\. To log in to a main account, the seller selects Switch to Sub Account on the login page.

![](https://open.shopee.com/opservice/api/v1/image/download/?image_id=LYatUvT%2Fl8dbnhsm%2BMmkTQmzN%2F5EtrHRXU1xvTFwDYiY9j4Nbvs6%2FZas7rxt5tOp57UEYs3r%2BCU2uYIDPd90sA%3D%3D&image_type=png)

2\. The seller can then fill in their login details and select Log In.

![](https://open.shopee.com/opservice/api/v1/image/download/?image_id=54kRFFgx%2FwQKfDOSLWx%2FxA%2FS8gkeyp2%2FxZ%2BYlQdiBeaSNwpe%2BhFefIE0jzeh%2Fh1a15BGXOB7v%2BliFgZVKPA5%2BA%3D%3D&image_type=png)

3\. The seller selects the shops that need to be authorized.

Note: For cross border sellers, If you need to call the merchant’s API, please remind the seller to select the Auth Merchant checkbox.

![](https://open.shopee.com/opservice/api/v1/image/download/?image_id=clJ%2FGp14b1rbcJubC%2FO9DPSOfrTNvHIdy9PaV%2FdiRYEjg3LGHYATF5k%2BgKl9ljsVyCrHhnnJa69TKjIRDUXKNA%3D%3D&image_type=png)

Local main account authorization:

![](https://open.shopee.com/opservice/api/v1/image/download/?image_id=sU6aM4h8CpO5ULk%2FFPPkwoDldBRTslGuYAAjPFyeVOHjeyHsPcpV8JFjLqg0FGlBSvF%2FyYG2KECYJfphOUxDcw%3D%3D&image_type=png)

4\. If the authorization checkbox is not selected, the system will display a reminder popup.

![](https://open.shopee.com/opservice/api/v1/image/download/?image_id=hRpJhHXiwikqpAMYcOvRUZ5bgWxgkN7%2FShw8OcnqxLoIMCMqQn16GEiE0%2FtSAJx0bCvrGgTP8fD%2BLL%2BW6c1HXA%3D%3D&image_type=png)

5\. The seller selects Confirm Authorization to confirm their selection.

![](https://open.shopee.com/opservice/api/v1/image/download/?image_id=M1jgkj8787sKyfBsBvnvHTQ26QPOPmse%2FMAGZSnZNGsFmvCvHYC0HajOw9bEIPJu7pHgo2dyrwFJqhrP1%2BWMXQ%3D%3D&image_type=png)

6\. After authorization is completed, the frontend page will redirect to the redirect\_uri specified in the authorization link, along with the authorization code (code) and main account ID (main\_account\_id):

[https://open.shopee.com/?code=xxxxxx&main\_account\_id=xxxxxx](https://open.shopee.com/?code=xxxxxx&main_account_id=xxxxxx)

## Getting and using the authorization code

After the seller completes authorization, the frontend page will redirect to the redirect\_uri specified in the authorization link, along with the authorization code (code) and shop\_id / main\_account\_id. Taking main\_account\_id as an example:

[https://open.shopee.com/?code=xxxxxx&main\_account\_id=xxxxxx](https://open.shopee.com/?code=xxxxxx&main_account_id=xxxxxx)

You can use this authorization code (code) to obtain the initial access token (access\_token).

Parameters Returned in the Redirect URL

| Parameter name | Type | Description |
| --- | --- | --- |
| code | string | Returned when the call is successful. This code is used to obtain access\_token and refresh\_token. It is valid for only once and expires after 10 minutes. |
| shop\_id | int | The ID of the shop that just granted authorization to your App. Returned after authorization was done on a shop account. |
| main\_account\_id | int | The ID of the main account that just granted authorization to your shop. . Returned after authorization was done on a main account. |

Note: If the domain of the redirect\_uri parameter (or the redirect parameter in legacy links) does not match the Redirect URL Domain declared in the Console when generating the authorization link, the following error will be returned:

“The domain of redirect\_uri is not consistent with the Redirect URL Domain declared in console”

(The domain of the callback URL is inconsistent with the Redirect URL Domain declared in the Console.)

## Getting and refreshing the access\_token

The access\_token is a dynamic token required for calling non-public APIs. It is valid for 4 hours and can be used multiple times within its validity period.

Before the access\_token expires, you need to use the refresh\_token to call the Refresh Access Token API (RefreshAccessToken) to obtain a new access\_token. The refresh\_token is valid for 30 days.

⚠️ Note

- The access\_token and refresh\_token corresponding to each shop\_id / merchant\_id / user\_id / supplier\_id must be stored separately;
- After a new access\_token is generated, the previous access\_token will remain valid for another 5 minutes;
- Re-authorization will refresh both the refresh\_token and access\_token;
- The RefreshAccessToken API must be called within the authorization validity period;
- If the latest available refresh\_token and access\_token are lost, please refer to the relevant [FAQ](https://open.shopee.com/faq?top=177&sub=180&page=1&faq=216).

### GetAccesstoken

After successful authorization, use the code and shop\_id or main\_account\_id in the redirect URL to call this API. This helps you obtain the shop\_id, merchant\_id, access\_token and refresh\_token.

Request Information

| Path | Details |
| --- | --- |
| Production Environment | [https://partner.shopeemobile.com/api/v2/auth/token/get](https://partner.shopeemobile.com/api/v2/auth/token/get) |
| Sandbox Environment | [https://openplatform.sandbox.test-stable.shopee.sg/api/v2/auth/token/get](https://openplatform.sandbox.test-stable.shopee.sg/api/v2/auth/token/get) |
| Request Method | POST |

Common parameters

| Parameter name | Type | Required | Description |
| --- | --- | --- | --- |
| sign | string | True | The signature obtained by sign base string (order: partner\_id, api path, timestamp...) HMAC-SHA256 hashing with the partner\_key. |
| partner\_id | int | True | The partner\_id obtained from the App. This partner\_id is put into the query. |
| timestamp | int | True | Timestamp, valid for 5 minutes. |

Request parameters:

| Parameter name | Type | Required | Description |
| --- | --- | --- | --- |
| code | string | True | The code in the redirect URL after authorization. It is only valid once and expires after 10 minutes. |
| partner\_id | int | True | The partner\_id obtained from the App. This partner\_id is put into the request body. |
| shop\_id | int | True, input 1 only. | For the shop\_id authorized to you, either the shop\_id or main\_account\_id can be selected as the input parameter. |
| main\_account\_id | int | For the main\_account\_id authorized to you, either the shop\_id or main\_account\_id can be selected as the input parameter. |

Response parameters:

| Parameter name | Type | Description |
| --- | --- | --- |
| request\_id | string | ID of API requests; always returned. Used to diagnose problems. |
| error | string | Error codes for API requests; always returned. When the API call is successful, the error code returned is empty. |
| refresh\_token | string | Returned when the API call is successful. Use refresh\_token to get a new access\_token. Valid for each shop\_id and merchant\_id respectively, for 30 days. |
| access\_token | string | Returned when the API call is successful. A dynamic token that can be used multiple times and expires after 4 hours. |
| expire\_in | int | Returned when the API call is successful. The validity period of the access\_token, in seconds. |
| message | string | Always returned. Provides detailed error information. |
| merchant\_id\_list | int\[ \] | Returned when there is main\_account\_id in the input parameter, including all the merchant\_ids authorized this time under the main account. |
| shop\_id\_list | int\[ \] | Returned when there is main\_account\_id in the input parameter, including all shop\_ids authorized this time under the main account. |
| supplier\_id\_list | int\[\] | Returned when auth\_type=supplier |
| user\_id\_list | int\[\] | Returned when auth\_type=user |

Calculating the sign parameter

The sign parameter is not only a component of the authorization link, but also a parameter used for authentication each time it is called. This section will explain how to create a sign base string and calculate the authentication signature through HMAC-SHA256.

Creating a sign base string

There are 3 types of APIs that require the use of different parameters to create the sign base string. (consistent with its common parameters).

Concatenate the API path (without host) and the common parameters below into a single sign base string in the following order:

- For Shop APIs: partner\_id, api path, timestamp, access\_token, shop\_id
- For Merchant APIs: partner\_id, api path, timestamp, access\_token, merchant\_id
- For Public APIs: partner\_id, api path, timestamp

Calculating the authentication signature

Use HMAC-SHA256 to hash the sign base string, and use the partner key as the encryption key. The hexadecimal all-lowercase hash value is the authentication signature.

Python Code Demo:

Python

```
import hmac
import json
import time
import requests
import hashlib

def shop_auth():
    timest = int(time.time())
    host = "https://partner.shopeemobile.com"
    path = "/api/v2/shop/auth_partner"
    redirect_url = "https://www.baidu.com/"
    partner_id = 80001
    tmp = "test...."
    partner_key = tmp.encode()
    tmp_base_string = "%s%s%s" % (partner_id, path, timest)
    base_string = tmp_base_string.encode()
    sign = hmac.new(partner_key, base_string, hashlib.sha256).hexdigest()
    ##generate api
    url = host + path + "?partner_id=%s&timestamp=%s&sign=%s&redirect=%s" % (partner_id, timest, sign, redirect_url)
    print(url)
```

Go Code Demo:

Go

```
func auth_shop(){
	timest := strconv.FormatInt(time.Now().Unix(),10)
	host := "https://openplatform.sandbox.test-stable.shopee.sg"
	path := "/api/v2/shop/auth_partner"
	redirectUrl := "https://www.baidu.com/"
	partnerId := strconv.Itoa(2006566)
	partnerKey := "1391fd986fe8ec7569bebed75b0c33ee35eb5a305bed7038657a5cd5f75b1c88"
	baseString := fmt.Sprintf("%s%s%s", partnerId,path,timest)
	h := hmac.New(sha256.New,[]byte(partnerKey))
	h.Write([]byte(baseString))
	sign := hex.EncodeToString(h.Sum(nil))
	url := fmt.Sprintf(host+path+"?partner_id=%s&timestamp=%s&sign=%s&redirect=%s", partnerId,timest,sign, redirectUrl)
	fmt.Println(url)
}
```

Java Code Demo:

Java

```
    //generate auth url
    public static void shop_auth(){
        long timest = System.currentTimeMillis() / 1000L;
        String host = "https://partner.shopeemobile.com";
        String path = "/api/v2/shop/auth_partner";
        String redirect_url = "https://www.baidu.com/";
        long partner_id = 123456L;
        String tmp_partner_key = "...";
        String tmp_base_string = String.format("%s%s%s", partner_id, path, timest);
        byte[] partner_key;
        byte[] base_string;
        String sign = "";
        try {
            base_string = tmp_base_string.getBytes("UTF-8");
            partner_key = tmp_partner_key.getBytes("UTF-8");
            Mac mac = Mac.getInstance("HmacSHA256");
            SecretKeySpec secret_key = new SecretKeySpec(partner_key, "HmacSHA256");
            mac.init(secret_key);
            sign = String.format("%064x",new BigInteger(1,mac.doFinal(base_string)));
        } catch (Exception e) {
            e.printStackTrace();
        }
        String url = host + path + String.format("?partner_id=%s&timestamp=%s&sign=%s&redirect=%s", partner_id,timest, sign, redirect_url);
        System.out.println(url);
    }
```

PHP Code Demo:

PHP

```
<?php

function authShop($partnerId, $partnerKey) {
    global $host;
    $path = "/api/v2/shop/auth_partner";
    $redirectUrl = "https://www.baidu.com/";

    $timest = time();
    $baseString = sprintf("%s%s%s", $partnerId, $path, $timest);
    $sign = hash_hmac('sha256', $baseString, $partnerKey);
    $url = sprintf("%s%s?partner_id=%s&timestamp=%s&sign=%s&redirect=%s", $host, $path, $partnerId, $timest, $sign, $redirectUrl);
    return $url;
}

$host="https://openplatform.sandbox.test-stable.shopee.sg";

$partnerId = 847892;
$partnerKey = "57615053704d6470644f554a78656d50484143644964436a5568777544524579";

echo authShop($partnerId, $partnerKey);
?>
```

GetAccesstoken Demo

Python Code Demo:

Python

```
print(shop_auth())
# first time request token
def get_token_shop_level(code, partner_id, tmp_partner_key, shop_id):
    timest = int(time.time())
    host = "https://partner.shopeemobile.com"
    path = "/api/v2/auth/token/get"
    body = {"code": code, "shop_id": shop_id, "partner_id": partner_id}
    tmp_base_string = "%s%s%s" % (partner_id, path, timest)
    base_string = tmp_base_string.encode()
    partner_key = tmp_partner_key.encode()
    sign = hmac.new(partner_key, base_string, hashlib.sha256).hexdigest()
    url = host + path + "?partner_id=%s&timestamp=%s&sign=%s" % (partner_id, timest, sign)
    # print(url)
    headers = {"Content-Type": "application/json"}
    resp = requests.post(url, json=body, headers=headers)
    ret = json.loads(resp.content)
    access_token = ret.get("access_token")
    new_refresh_token = ret.get("refresh_token")
    return access_token, new_refresh_token

def get_token_account_level(code, partner_id, tmp_partner_key, main_account_id):
    timest = int(time.time())
    host = "https://openplatform.sandbox.test-stable.shopee.sg"
    path = "/api/v2/auth/token/get"
    body = {"code": code, "main_account_id": main_account_id, "partner_id": partner_id}
    tmp_base_string = "%s%s%s" % (partner_id, path, timest)
    base_string = tmp_base_string.encode()
    partner_key = tmp_partner_key.encode()
    sign = hmac.new(partner_key, base_string, hashlib.sha256).hexdigest()
    url = host + path + "?partner_id=%s&timestamp=%s&sign=%s" % (partner_id, timest, sign)

    headers = {"Content-Type": "application/json"}
    resp = requests.post(url, json=body, headers=headers)
    ret = json.loads(resp.content)
    access_token = ret.get("access_token")
    new_refresh_token = ret.get("refresh_token")
    return access_token, new_refresh_token
```

Java Code Demo:

Java

```
import com.alibaba.fastjson.JSONObject;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.*;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.text.ParseException;
import java.util.HashMap;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;
import com.alibaba.fastjson.JSON;

public class shop_auth {
    public static void main(String[] args) throws ParseException, IOException {
        shop_auth();
        //get_token_shop_level(code,partner_id,partner_key,shop_id);
    }
    //generate auth url
    public static void shop_auth(){
        long timest = System.currentTimeMillis() / 1000L;
        String host = "https://partner.shopeemobile.com";
        String path = "/api/v2/shop/auth_partner";
        String redirect_url = "https://www.baidu.com/";
        long partner_id = 123456L;
        String tmp_partner_key = "...";
        String tmp_base_string = String.format("%s%s%s", partner_id, path, timest);
        byte[] partner_key;
        byte[] base_string;
        String sign = "";
        try {
            base_string = tmp_base_string.getBytes("UTF-8");
            partner_key = tmp_partner_key.getBytes("UTF-8");
            Mac mac = Mac.getInstance("HmacSHA256");
            SecretKeySpec secret_key = new SecretKeySpec(partner_key, "HmacSHA256");
            mac.init(secret_key);
            sign = String.format("%064x",new BigInteger(1,mac.doFinal(base_string)));
        } catch (Exception e) {
            e.printStackTrace();
        }
        String url = host + path + String.format("?partner_id=%s&timestamp=%s&sign=%s&redirect=%s", partner_id,timest, sign, redirect_url);
        System.out.println(url);
    }

    //shop request for access token for the first time
    public static String[] get_token_shop_level(String code,long partner_id,String tmp_partner_key,long shop_id) throws ParseException,IOException{
        String[] res = new String[2];
        long timest = System.currentTimeMillis() / 1000L;
        String host = "https://partner.shopeemobile.com";
        String path = "/api/v2/auth/token/get";
        String tmp_base_string = String.format("%s%s%s", partner_id, path, timest);
        byte[] partner_key;
        byte[] base_string;
        BigInteger sign = null;
        String result = "";
        try {
            base_string = tmp_base_string.getBytes("UTF-8");
            partner_key = tmp_partner_key.getBytes("UTF-8");
            Mac mac = Mac.getInstance("HmacSHA256");
            SecretKeySpec secret_key = new SecretKeySpec(partner_key, "HmacSHA256");
            mac.init(secret_key);
            sign = new BigInteger(1,mac.doFinal(base_string));
        } catch (Exception e) {
            e.printStackTrace();
        }
        String tmp_url = host + path + String.format("?partner_id=%s&timestamp=%s&sign=%s", partner_id,timest, String.format("%032x",sign));
        URL url = new URL(tmp_url);
        HttpURLConnection conn = null;
        PrintWriter out = null;
        BufferedReader in = null;
        try {
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setDoInput(true);
            conn.setConnectTimeout(30000);
            conn.setReadTimeout(10000);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Accept", "application/json");
            Map<String,Object> map = new HashMap<>();
            map.put("code",code);
            map.put("shop_id",shop_id);
            map.put("partner_id",partner_id);
            String json = JSON.toJSONString(map);
            conn.connect();
            out = new PrintWriter(conn.getOutputStream());
            out.print(json);
            out.flush();
            in = new BufferedReader(new InputStreamReader(conn.getInputStream()));
            String line = "";
            while((line=in.readLine())!=null){
                result +=line;
            }
            JSONObject jsonObject = JSONObject.parseObject(result);
            res[0] = (String) jsonObject.get("access_token");
            res[1] = (String) jsonObject.get("refresh_token");
        } catch(Exception e){
            e.printStackTrace();
        }finally {
            try{
                if(out != null){
                    out.close();
                }
                if(in != null){
                    in.close();
                }
            }catch (IOException ioe){
                ioe.printStackTrace();
            }
        }
        return res;
    }

    //main account request for the access token for the first time
    public static String[] get_token_account_level(String code,long partner_id,String tmp_partner_key,long main_account_id) throws ParseException,IOException{
        String[] res = new String[2];
        long timest = System.currentTimeMillis() / 1000L;
        String host = "https://openplatform.sandbox.test-stable.shopee.sg";
        String path = "/api/v2/auth/token/get";
        String tmp_base_string = String.format("%s%s%s", partner_id, path, timest);
        byte[] partner_key;
        byte[] base_string;
        BigInteger sign = null;
        String result = "";
        try {
            base_string = tmp_base_string.getBytes("UTF-8");
            partner_key = tmp_partner_key.getBytes("UTF-8");
            Mac mac = Mac.getInstance("HmacSHA256");
            SecretKeySpec secret_key = new SecretKeySpec(partner_key, "HmacSHA256");
            mac.init(secret_key);
            sign = new BigInteger(1,mac.doFinal(base_string));
        } catch (Exception e) {
            e.printStackTrace();
        }
        String tmp_url = host + path + String.format("?partner_id=%s&timestamp=%s&sign=%s", partner_id,timest, String.format("%032x",sign));
        URL url = new URL(tmp_url);
        HttpURLConnection conn = null;
        PrintWriter out = null;
        BufferedReader in = null;
        try {
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setDoInput(true);
            conn.setConnectTimeout(30000);
            conn.setReadTimeout(10000);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Accept", "application/json");
            Map<String,Object> map = new HashMap<>();
            map.put("code",code);
            map.put("main_account_id",main_account_id);
            map.put("partner_id",partner_id);
            String json = JSON.toJSONString(map);
            conn.connect();
            out = new PrintWriter(conn.getOutputStream());
            out.print(json);
            out.flush();
            in = new BufferedReader(new InputStreamReader(conn.getInputStream()));
            String line = "";
            while((line=in.readLine())!=null){
                result +=line;
            }
            JSONObject jsonObject = JSONObject.parseObject(result);
            res[0] = (String) jsonObject.get("access_token");
            res[1] = (String) jsonObject.get("refresh_token");
        } catch(Exception e){
            e.printStackTrace();
        }finally {
            try{
                if(out != null){
                    out.close();
                }
                if(in != null){
                    in.close();
                }
            }catch (IOException ioe){
                ioe.printStackTrace();
            }
        }
        return res;
    }
```

PHP Code Demo:

PHP

```
<?php

function getTokenShopLevel($code, $partnerId, $partnerKey, $shopId) {
    global $host;
    $path = "/api/v2/auth/token/get";

    $timest = time();
    $body = array("code" => $code,  "shop_id" => $shopId, "partner_id" => $partnerId);
    $baseString = sprintf("%s%s%s", $partnerId, $path, $timest);
    $sign = hash_hmac('sha256', $baseString, $partnerKey);
    $url = sprintf("%s%s?partner_id=%s&timestamp=%s&sign=%s", $host, $path, $partnerId, $timest, $sign);


    $c = curl_init($url);
    curl_setopt($c, CURLOPT_POST, 1);
    curl_setopt($c, CURLOPT_POSTFIELDS, json_encode($body));
    curl_setopt($c, CURLOPT_HTTPHEADER, array('Content-Type: application/json'));
    curl_setopt($c, CURLOPT_RETURNTRANSFER, 1);
    $resp = curl_exec($c);
    echo "raw result: $resp";

    $ret = json_decode($resp, true);
    $accessToken = $ret["access_token"];
    $newRefreshToken = $ret["refresh_token"];
    echo "\naccess_token: $accessToken, refresh_token: $newRefreshToken raw: $ret"."\n";
    return $ret;
}

function getTokenAccountLevel($code, $partnerId, $partnerKey, $mainAccountId) {
    global $host;
    $path = "/api/v2/auth/token/get";

    $timest = time();
    $body = array("code" => $code,  "main_account_id" => $mainAccountId, "partner_id" => $partnerId);
    $baseString = sprintf("%s%s%s", $partnerId, $path, $timest);

    $sign = hash_hmac('sha256', $baseString, $partnerKey);
    $url = sprintf("%s%s?partner_id=%s&timestamp=%s&sign=%s", $host, $path, $partnerId, $timest, $sign);

    $c = curl_init($url);
    curl_setopt($c, CURLOPT_POST, 1);
    curl_setopt($c, CURLOPT_POSTFIELDS, json_encode($body));
    curl_setopt($c, CURLOPT_HTTPHEADER, array('Content-Type: application/json'));
    curl_setopt($c, CURLOPT_RETURNTRANSFER, 1);
    $result = curl_exec($c);
    echo "\nraw result ".$result."\n";

    $ret = json_decode($result, true);
    $accessToken = $ret["access_token"];
    $newRefreshToken = $ret["refresh_token"];
    echo "\naccess_token: ".$accessToken.", refresh_token: ".$newRefreshToken."\n";
    return $ret;
}

$host="https://partner.shopeemobile.com";

$partnerId = 847892;
$partnerKey = "57615053704d6470644f554a78656d50484143644964436a5568777544524579";

$code="494d7a4a4f5a66524556776f66425453";

// $shopId=200520705;
// getTokenShopLevel($code, $partnerId, $partnerKey, $shopId);

$accountId=19479;
getTokenAccountLevel($code, $partnerId, $partnerKey, $accountId)

?>
```

### RefreshAccessToken

Before the access\_token expires, use the refresh\_token to call this API to obtain a new access\_token and refresh\_token. The new refresh\_token must be used for the next refresh request.

Request Information

| Path | Details |
| --- | --- |
| Production Environment | [https://partner.shopeemobile.com/api/v2/auth/access\_token/get](https://partner.shopeemobile.com/api/v2/auth/access_token/get) |
| Sandbox Environment | [https://openplatform.sandbox.test-stable.shopee.sg/api/v2/auth/access\_token/get](https://openplatform.sandbox.test-stable.shopee.sg/api/v2/auth/access_token/get) |
| Request Method | POST |

|     |
| --- |
| ⚠️ Note<br>For the same main\_account\_id, the initial access\_token and refresh\_token obtained from GetAccessToken are identical. After calling the RefreshAccessToken API separately for each shop\_id and merchant\_id, each shop\_id and merchant\_id will generate its own independent new access\_token and refresh\_token.<br>For example:<br>1\. The initial access\_token / refresh\_token obtained from GetAccessToken is assigned to 7 shop\_ids and 3 merchant\_ids.<br>2\. After the initial access\_token expires, you use the initial refresh\_token to call RefreshAccessToken,and obtain 10 independent sets of access\_token and refresh\_token for each shop\_id and merchant\_id.<br>3\. After this, shop\_id and merchant\_id will no longer share any access\_token or refresh\_token. |

Public parameters:

Consistent with the common parameters of the GetAccessToken API.

| Parameter name | Type | Required | Description |
| --- | --- | --- | --- |
| sign | string | True | The signature obtained by sign base string (order: partner\_id, api path, timestamp...) HMAC-SHA256 hashing with the partner\_key. |
| partner\_id | int | True | The partner\_id obtained from the APP. This partner\_id is put into the query. |
| timestamp | int | True | Timestamp, valid for 5 minutes. |

Request parameters:

| Parameter name | Type | Required | Description |
| --- | --- | --- | --- |
| refresh\_token | string | True | Use refresh\_token to get a new access\_token. Each refresh\_token is valid for 30 days, and can only be used once by either a shop\_id or merchant\_id. |
| partner\_id | int | True | The partner\_id obtained from the App. This partner\_id is inserted into the body. |
| shop\_id | int | Yes, input 1 only. | The shop\_id of the main account that granted authorization to your App. Only the shop\_id or merchant\_id can be selected as the input parameter, and they must be refreshed separately. |
| merchant\_id | int | The merchant\_id for identifying the main account that granted authorization to your App. Only the shop\_id or merchant\_id can be selected as the input parameter, and they must be refreshed separately. |

Response parameters:

| Parameter name | Type | Description |
| --- | --- | --- |
| request\_id | string | ID of API requests; always returned. Used to diagnose problems. |
| error | string | Error codes for API requests; always returned. When the API call is successful, the error code returned is empty. |
| refresh\_token | string | New refresh\_tokenReturned when the API call is successful. Use a refresh\_token to get a new access\_token. Each refresh\_token is valid for 30 days, and can only be used once by either a shop\_id or merchant\_id. |
| access\_token | string | Returned when the API call is successful. Each new access\_token is a dynamic token that can be used multiple times. It expires after 4 hours. |
| expire\_in | int | Returned when the API call is successful. The validity period of the access\_token, in seconds. |
| message | string | Always returned. Provides detailed error information. |
| merchant\_id | int | Returned when the API call is successful. The merchant\_id for this refresh, for identifying each merchant. |
| shop\_id | int | Returned when the API call is successful. The shop\_id for this refresh |
| partner\_id | int | Returned when the API call is successful. The partner\_id you used for this refresh |
| supplier\_id\_list | int\[\] | Return when auth\_type=supplier |
| user\_id\_list | int\[\] | Return when auth\_type=user |

RefreshAccessToken Demo

Python Code Demo:

Python

```
# refresh token

def get_access_token_shop_level(shop_id, partner_id, tmp_partner_key, refresh_token):
    timest = int(time.time())
    host = "https://openplatform.sandbox.test-stable.shopee.sg"
    path = "/api/v2/auth/access_token/get"
    body = {"shop_id": shop_id, "refresh_token": refresh_token,"partner_id":partner_id}
    tmp_base_string = "%s%s%s" % (partner_id, path, timest)
    base_string = tmp_base_string.encode()
    partner_key = tmp_partner_key.encode()
    sign = hmac.new(partner_key, base_string, hashlib.sha256).hexdigest()
    url = host + path + "?partner_id=%s&timestamp=%s&sign=%s" % (partner_id, timest, sign)
    # print(url)
    headers = {"Content-Type": "application/json"}
    resp = requests.post(url, json=body, headers=headers)
    ret = json.loads(resp.content)
    access_token = ret.get("access_token")
    new_refresh_token = ret.get("refresh_token")
    return access_token, new_refresh_token

def get_access_token_merchant_level(merchant_id, partner_id, tmp_partner_key, refresh_token):
    timest = int(time.time())
    host = "https://openplatform.sandbox.test-stable.shopee.sg"
    path = "/api/v2/auth/access_token/get"
    body = {"merchant_id": merchant_id, "refresh_token": refresh_token}
    tmp_base_string = "%s%s%s" % (partner_id, path, timest)
    base_string = tmp_base_string.encode()
    partner_key = tmp_partner_key.encode()
    sign = hmac.new(partner_key, base_string, hashlib.sha256).hexdigest()
    url = host + path + "?partner_id=%s&timestamp=%s&sign=%s" % (partner_id, timest, sign)

    headers = {"Content-Type": "application/json"}
    resp = requests.post(url, json=body, headers=headers)
    ret = json.loads(resp.content)
    access_token = ret.get("access_token")
    new_refresh_token = ret.get("refresh_token")
    return access_token, new_refresh_token

partner_id = 2006566
partner_key = "1a78dde5d6c3342f56ac939cbdd81607654c0e87725e118736ba5e3ae31c579c"
shop_id = 602226924
main_account_id = 31219
merchant_id = 45719
code = "c01204cada7b4cd0e4688154f5a256ca"
print(shop_auth())
# access_token,refresh_token = get_token_shop_level(code,partner_id,partner_key,602226924)
# print(access_token)
# print(refresh_token)
# print(get_access_token_shop_level(shop_id,partner_id,partner_key,refresh_token))

access_token,refresh_token = get_token_account_level(code,partner_id,partner_key,main_account_id)
print(access_token)
print(refresh_token)
print(get_access_token_merchant_level(merchant_id,partner_id,partner_key,refresh_token))

```

Java Code Demo:

Java

```

    //shop refresh the access token
    public static String[] get_access_token_shop_level(String refresh_token,long partner_id,String tmp_partner_key,long shop_id) throws ParseException,IOException{
        String[] res = new String[2];
        long timest = System.currentTimeMillis() / 1000L;
        String host = "https://partner.shopeemobile.com";
        String path = "/api/v2/auth/access_token/get";
        String tmp_base_string = String.format("%s%s%s", partner_id, path, timest);
        byte[] partner_key;
        byte[] base_string;
        BigInteger sign = null;
        String result = "";
        try {
            base_string = tmp_base_string.getBytes("UTF-8");
            partner_key = tmp_partner_key.getBytes("UTF-8");
            Mac mac = Mac.getInstance("HmacSHA256");
            SecretKeySpec secret_key = new SecretKeySpec(partner_key, "HmacSHA256");
            mac.init(secret_key);
            sign = new BigInteger(1,mac.doFinal(base_string));
        } catch (Exception e) {
            e.printStackTrace();
        }
        String tmp_url = host + path + String.format("?partner_id=%s&timestamp=%s&sign=%s", partner_id,timest, String.format("%032x",sign));
        URL url = new URL(tmp_url);
        HttpURLConnection conn = null;
        PrintWriter out = null;
        BufferedReader in = null;
        try {
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setDoInput(true);
            conn.setConnectTimeout(30000);
            conn.setReadTimeout(10000);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Accept", "application/json");
            Map<String,Object> map = new HashMap<>();
            map.put("refresh_token",refresh_token);
            map.put("shop_id",shop_id);
            map.put("partner_id",partner_id);
            String json = JSON.toJSONString(map);
            conn.connect();
            out = new PrintWriter(conn.getOutputStream());
            out.print(json);
            out.flush();
            in = new BufferedReader(new InputStreamReader(conn.getInputStream()));
            String line = "";
            while((line=in.readLine())!=null){
                result +=line;
            }
            JSONObject jsonObject = JSONObject.parseObject(result);
            res[0] = (String) jsonObject.get("access_token");
            res[1] = (String) jsonObject.get("refresh_token");
        } catch(Exception e){
            e.printStackTrace();
        }finally {
            try{
                if(out != null){
                    out.close();
                }
                if(in != null){
                    in.close();
                }
            }catch (IOException ioe){
                ioe.printStackTrace();
            }
        }
        return res;
    }

    //merchant refresh the access token
    public static String[] get_access_token_merchant_level(String refresh_token,long partner_id,String tmp_partner_key,long merchant_id) throws ParseException,IOException{
        String[] res = new String[2];
        long timest = System.currentTimeMillis() / 1000L;
        String host = "https://partner.shopeemobile.com";
        String path = "/api/v2/auth/access_token/get";
        String tmp_base_string = String.format("%s%s%s", partner_id, path, timest);
        byte[] partner_key;
        byte[] base_string;
        BigInteger sign = null;
        String result = "";
        try {
            base_string = tmp_base_string.getBytes("UTF-8");
            partner_key = tmp_partner_key.getBytes("UTF-8");
            Mac mac = Mac.getInstance("HmacSHA256");
            SecretKeySpec secret_key = new SecretKeySpec(partner_key, "HmacSHA256");
            mac.init(secret_key);
            sign = new BigInteger(1,mac.doFinal(base_string));
        } catch (Exception e) {
            e.printStackTrace();
        }
        String tmp_url = host + path + String.format("?partner_id=%s&timestamp=%s&sign=%s", partner_id,timest, String.format("%032x",sign));
        URL url = new URL(tmp_url);
        HttpURLConnection conn = null;
        PrintWriter out = null;
        BufferedReader in = null;
        try {
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setDoInput(true);
            conn.setConnectTimeout(30000);
            conn.setReadTimeout(10000);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Accept", "application/json");
            Map<String,Object> map = new HashMap<>();
            map.put("refresh_token",refresh_token);
            map.put("merchant_id",merchant_id);
            map.put("partner_id",partner_id);
            String json = JSON.toJSONString(map);
            conn.connect();
            out = new PrintWriter(conn.getOutputStream());
            out.print(json);
            out.flush();
            in = new BufferedReader(new InputStreamReader(conn.getInputStream()));
            String line = "";
            while((line=in.readLine())!=null){
                result +=line;
            }
            JSONObject jsonObject = JSONObject.parseObject(result);
            res[0] = (String) jsonObject.get("access_token");
            res[1] = (String) jsonObject.get("refresh_token");
        } catch(Exception e){
            e.printStackTrace();
        }finally {
            try{
                if(out != null){
                    out.close();
                }
                if(in != null){
                    in.close();
                }
            }catch (IOException ioe){
                ioe.printStackTrace();
            }
        }
        return res;
    }
}
```

PHP Code Demo:

PHP

```
<?php

function getAccessTokenShopLevel($partnerId, $partnerKey, $shopId, $refreshToken) {
    global $host;
    $path = "/api/v2/auth/access_token/get";

    $timest = time();
    $body = array("partner_id" => $partnerId, "shop_id" => $shopId, "refresh_token" => $refreshToken);
    $baseString = sprintf("%s%s%s", $partnerId, $path, $timest);
    $sign = hash_hmac('sha256', $baseString, $partnerKey);
    $url = sprintf("%s%s?partner_id=%s&timestamp=%s&sign=%s", $host, $path, $partnerId, $timest, $sign);

    $c = curl_init($url);
    curl_setopt($c, CURLOPT_POST, 1);
    curl_setopt($c, CURLOPT_POSTFIELDS, json_encode($body));
    curl_setopt($c, CURLOPT_HTTPHEADER, array('Content-Type: application/json'));
    curl_setopt($c, CURLOPT_RETURNTRANSFER, 1);

    $result = curl_exec($c);
    echo "\nraw result ".$result."\n";

    $ret = json_decode($result, true);

    $accessToken = $ret["access_token"];
    $newRefreshToken = $ret["refresh_token"];
    echo "\naccess_token: ".$accessToken.", refresh_token: ".$newRefreshToken."\n";
    return $ret;
}

function getAccessTokenMerchantLevel($partnerId, $partnerKey, $merchantId, $refreshToken) {
    global $host;
    $path = "/api/v2/auth/access_token/get";

    $timest = time();
    $body = array("partner_id" => $partnerId, "merchant_id" => $merchantId, "refresh_token" => $refreshToken);
    $baseString = sprintf("%s%s%s", $partnerId, $path, $timest);
    $sign = hash_hmac('sha256', $baseString, $partnerKey);
    $url = sprintf("%s%s?partner_id=%s&timestamp=%s&sign=%s", $host, $path, $partnerId, $timest, $sign);

    $c = curl_init($url);
    curl_setopt($c, CURLOPT_POST, 1);
    curl_setopt($c, CURLOPT_POSTFIELDS, json_encode($body));
    curl_setopt($c, CURLOPT_HTTPHEADER, array('Content-Type: application/json'));
    curl_setopt($c, CURLOPT_RETURNTRANSFER, 1);
    $result = curl_exec($c);
    echo "\nraw result ".$result."\n";

    $ret = json_decode($result, true);
    $accessToken = $ret["access_token"];
    $newRefreshToken = $ret["refresh_token"];
    echo "\naccess_token: ".$accessToken.", refresh_token: ".$newRefreshToken."\n";
    return $ret;
}

$host="https://partner.shopeemobile.com";

$partnerId = 847892;
$partnerKey = "57615053704d6470644f554a78656d50484143644964436a5568777544524579";

// $shopId=200520705;
// $shopRefreshToken="71724c4e68746b546965424c70617244";
// getAccessTokenShopLevel($partnerId, $partnerKey, $shopId, $shopRefreshToken)

$merchantId=1018829;
$merchantRefreshToken="546e5064627042696756455277774f53";
getAccessTokenMerchantLevel($partnerId, $partnerKey, $merchantId, $merchantRefreshToken)

?>
```

### Refreshing the access\_token and refresh\_token on a shop account

1\. Use the code and shop\_id from the redirect URL [https://open.shopee.com/?code=7867624d4e76616648544f6e52625557&shop\_id=54804](https://open.shopee.com/?code=7867624d4e76616648544f6e52625557&shop_id=54804) to call the GetAccessToken API to obtain the first pair of access\_token and refresh\_token.

Query: https://partner.shopeemobile.com/api/v2/auth/token/get?partner\_id=1000016&timestamp=1657263479&sign=9c685bc7e4a74e90f45fe1933f1d72b2d9705acda4093a9fb1ec7e2b57ccea2a

{"shop\_id":54804,

"code":"7867624d4e76616648544f6e52625557",

"partner\_id":1000016

}

2.Save the first pair of access\_token and refresh\_token returned.

{

"refresh\_token": "456e416149664b76745a6a794156794a",

"access\_token": "6a55746e61546f707579627656637464",

"expire\_in": 13859,

"request\_id": "c040b886cfcabdfa5a23af51c595cd1b",

"error": "",

"message": ""

}

3.Call the RefreshAccessToken API to refresh the access\_token and refresh\_token.

Query: https://partner.shopeemobile.com/api/v2/auth/access\_token/get?partner\_id=1000016&timestamp=1657263479&sign=9c685bc7e4a74e90f45fe1933f1d72b2d9705acda4093a9fb1ec7e2b57ccea2a

{"shop\_id":54804,

"refresh\_token":"456e416149664b76745a6a794156794a",

"partner\_id":1000016

}

4.Save the new access\_token and refresh\_token.

{

"partner\_id": 1000016,

"refresh\_token": "666478546b6c63464867685554477a57",

"access\_token": "7a5970754768697552654a466f425573",

"expire\_in": 14400,

"request\_id": "6d79dd0ffe4e070e185c71ca5153cd51",

"error": "",

"message": "",

"shop\_id": 54804

}

### Refreshing the access\_token and refresh\_token on a main account

1.Use the code and main\_account\_id from the URL obtained during authorization to call the GetAccessToken API and obtain the first pair of access\_token and refresh\_token.

Redirect URL: : https://open.shopee.com/?code=644d4e48787873706c5a444c776d4b59&main\_account\_id=10208

Query: https://partner.shopeemobile.com/api/v2/auth/token/get?partner\_id=1000016&timestamp=1657263479&sign=9c685bc7e4a74e90f45fe1933f1d72b2d9705acda4093a9fb1ec7e2b57ccea2a

{"main\_account\_id":10208,

"code":"644d4e48787873706c5a444c776d4b59",

"partner\_id":1000016

}

2.Save the first pair of access\_token and refresh\_token returned.

{

"refresh\_token": "684d42685667777868597a4477587455",

"access\_token": "44776151594778486943647644745361",

"expire\_in": 14344,

"request\_id": "9199e13ee74b22411498209cb5516e24",

"merchant\_id\_list": \[\
\
       1001705\
\
\],

"shop\_id\_list": \[\
\
       33142,\
\
       46154\
\
\],

"error": "",

"message": ""

}

3.Call the RefreshAccessToken API to refresh the access\_token and refresh\_token of shop\_id and merchant\_id respectively

Query: https://partner.shopeemobile.com/api/v2/auth/access\_token/get?partner\_id=1000016&timestamp=1657868745&sign=b78833ddcf533903cfae818bbfcf2b6b630e3bc0c941dd65453632f63bf7b495

{"shop\_id":33142,

"refresh\_token":"684d42685667777868597a4477587455",

"partner\_id":1000016

}

Query: https://partner.shopeemobile.com/api/v2/auth/access\_token/get?partner\_id=1000016&timestamp=1657868745&sign=b78833ddcf533903cfae818bbfcf2b6b630e3bc0c941dd65453632f63bf7b495

{"merchant\_id":1001705,

"refresh\_token":"684d42685667777868597a4477587455",

"partner\_id":1000016

}

4.Save the new access\_token and refresh\_token.

{

"partner\_id": 1000016,

"refresh\_token": "417472546e73504949676279576c477a",

"access\_token": "646d474965714a696177764963775743",

"expire\_in": 14400,

"request\_id": "78e64d11cb6dec6f6669282839fca916",

"error": "",

"message": "",

"shop\_id": 33142

}

{

"partner\_id": 1000016,

"refresh\_token": "715075736d6c6570544364774f437369",

"access\_token": "69634c664a7350696c6b466d5a53714a",

"expire\_in": 14400,

"request\_id": "51eacbc81bd6fa8fddddf1e0ef2dee16",

"error": "",

"message": "",

"merchant\_id": 1001705

}

By following the steps above, you can call the RefreshAccessToken API  within 4 hours to get new access\_token and refresh\_token. Maintaining the API call loop will ensure you can continue to obtain new sets of access\_token and refresh\_token within the authorization validity period.

|     |
| --- |
| ⚠️ NoteIf you did not save the new refresh\_token and access\_token returned, [see possible solutions](https://open.shopee.com/faq?top=177&sub=180&page=1&faq=216). |

# Canceling authorization

You can cancel an authorization by changing the authorization URL or via Seller Center.

### Canceling authorization by changing the authorization URL

Authorization can be revoked either by generating a cancellation authorization link or by performing the operation in Seller Center.

Revoking authorization via cancellation link

The method for generating a cancellation authorization link is the same as that for the authorization link, except that the fixed authorization URL should be replaced with the fixed cancellation authorization URL.

Fixed Cancellation Authorization URL

|     |     |     |
| --- | --- | --- |
| Environment | Region | URL |
| Production | Global (excluding Mainland China and Brazil) | [https://open.shopee.com/cancel\_auth](https://open.shopee.com/cancel_auth) |
| Mainland China | [https://open.shopee.cn/cancel\_auth](https://open.shopee.cn/cancel_auth) |
| Brazil | [https://open.shopee.com.br/cancel\_auth](https://open.shopee.com.br/cancel_auth) |
| Sandbox | Global (excluding Mainland China and Brazil) | [https://open.](https://open.test-stable.shopee.com/cancel_auth) [sandbox.test-stable.](https://open.test-stable.shopee.com/auth) [shopee.com/cancel\_auth](https://open.test-stable.shopee.com/cancel_auth) |
| Mainland China | [https://open.](https://open.test-stable.shopee.cn/cancel_auth) [sandbox.test-stable.](https://open.test-stable.shopee.com/auth) [shopee.cn/cancel\_auth](https://open.test-stable.shopee.cn/cancel_auth) |
| Brazil | [https://open.](https://open.test-stable.shopee.com.br/cancel_auth) [sandbox.test-stable.](https://open.test-stable.shopee.com/auth) [shopee.com.br/cancel\_auth](https://open.test-stable.shopee.com.br/cancel_auth) |

Cancellation Authorization Link Examples

Production Environment:

[https://open.shopee.com/cancel\_auth?partner\_id=10090&auth\_type=seller&redirect\_uri=https://open.shopee.com&response\_type=code](https://open.shopee.com/cancel_auth?partner_id=10090&auth_type=seller&redirect_uri=https://open.shopee.com&response_type=code)

Sandbox Environment:

[https://open.test-stable.shopee.com/cancel\_auth?partner\_id=1000016&auth\_type=seller&redirect\_uri=https://open.test-stable.shopee.com&response\_type=code](https://open.test-stable.shopee.com/cancel_auth?partner_id=1000016&auth_type=seller&redirect_uri=https://open.test-stable.shopee.com&response_type=code)

Cancellation Process

1\. Generate the cancellation authorization link according to the specifications above;

2\. The seller logs in via the cancellation authorization link;

![](https://open.shopee.com/opservice/api/v1/image/download/?image_id=fqiBwLFttdta5Te0%2FnbxzXzFcsupke1%2BNA2OHgx7yb1SY2iwe2LgKaOg0BsWqPAlP3u2RsebI%2F6btGIy3SIXCQ%3D%3D&image_type=png)

3\. The seller clicks “Cancel Authorization” to complete the process. After cancellation, the application will no longer have access to the seller’s information.

![](https://open.shopee.com/opservice/api/v1/image/download/?image_id=o9yQ94Cq36TeoBBlNsV9odZZsWQvw%2FOJYgYXVPSV5PmLUFhnbxkEEZiuLnCXbVCeJ1Cs21BXmBtNdTzaC59LJw%3D%3D&image_type=png)

### Canceling authorization on Seller Center

Local Sellers:

1. The seller logs in to Seller Center and navigates to “Home Page > Platform Partner”;
2. On the Platform Partner page, the seller can view all apps authorized by the shop / main account, along with their authorization expiration time;
3. The seller clicks “Separate” in the action column to revoke authorization for the corresponding application.

![](https://open.shopee.com/opservice/api/v1/image/download/?image_id=yz4bkpogbbBi5skg05Tr68D2FH7NDD9bdcXDaKojflAyCSNELVaU0efUGodlnzFL7AVUcOfVJk33%2Bh4N%2FfpY8w%3D%3D&image_type=png)

CNSC/KRSC Sellers

“Home Page > Open Platform Management”: Sellers can view which apps have been authorized by the main account. In the authorization management page, sellers can directly revoke the authorization relationship for the merchant or shop.

![](https://open.shopee.com/opservice/api/v1/image/download/?image_id=DhqmO1dXSCh%2FsgUDweiMAjJNVZoElu%2FWOygNRX%2Bj5snNNZqD%2BkHsIQXsy9dQFXkc%2Br2AX%2F5inJ97WdBjlhVwfA%3D%3D&image_type=png)

![](https://open.shopee.com/opservice/api/v1/image/download/?image_id=6mZRmlhbl%2FiGafGlKE2V%2FT9EWJb%2BSgKCqGxEph9mSTRLBnsBerBG5YTJR%2B%2BawQiufyHh2F2RgifSi7DdrLIclg%3D%3D&image_type=png)

# FAQs on authorization and authentication

If you encounter errors during the authorization process, you can refer to our [FAQs on authorization and authentication.](https://open.shopee.com/faq?top=177&sub=180&page=1&faq=215)

### User Guide

#### [Developer Guide](https://open.shopee.com/developer-guide/0)

#### [API reference](https://open.shopee.com/documents/v2/v2.ams.get_open_campaign_added_product?module=127&type=1)

#### [Push Mechanism](https://open.shopee.com/push-mechanism/5)

#### [Shopee Open Platform Data Protection Policy](https://open.shopee.com/policy?policy_id=1)

### Shopee Markets

#### [Service Market](https://service.shopee.cn/)

#### [Seller Education Hub (Singapore)](https://seller.shopee.sg/edu)

#### [Seller Education Hub (Malaysia)](https://seller.shopee.com.my/edu)

#### [Seller Education Hub (Thailand)](https://seller.shopee.co.th/edu)

#### [Seller Education Hub (Vietnam)](https://banhang.shopee.vn/edu)

#### [Seller Education Hub (Indonesia)](https://seller.shopee.co.id/edu)

#### [Seller Education Hub (Philippines)](https://seller.shopee.ph/edu)

#### [Seller Education Hub (Brazil)](https://seller.shopee.com.br/edu)

#### [Seller Education Hub (Japan)](https://shopee.jp/edu)

#### [Seller Education Hub (Korea)](https://shopee.kr/edu)

#### [Seller Education Hub (Hongkong)](https://shopee.com.hk/edu)

#### [虾皮卖家学习中心](https://shopee.cn/edu)

### Support

#### [Announcement](https://open.shopee.com/announcements)

#### [FAQ](https://open.shopee.com/faq)

#### [Raise Ticket](https://open.shopee.com/console/raise-ticket)

Copyright @ Shopee 2025