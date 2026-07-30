- ···

  - App Console

[Announcement](https://open.lazada.com/apps/announcement/index) [Community](https://open.lazada.com/apps/community/index)   - Documentation

[Contact Us](https://open.lazada.com/?newTab=true)  - ···


- [Sign in](https://open.lazada.com/apps/user/login?redirectURL=https%3A%2F%2Fopen.lazada.com%2Fapps%2Fdoc%2Fapi%3Fpath%3D%252Fauth%252Ftoken%252Frefresh) [Sign up](https://open.lazada.com/apps/user/register)


AI Assistant![](https://ae-pic-a1.aliexpress-media.com/kf/S00d31076895a492997d996fd48b505505.gif)![](https://ae-pic-a1.aliexpress-media.com/kf/S1df43fd5905043cdaafec6c8bdeb090c5.gif)![](https://ae-pic-a1.aliexpress-media.com/kf/S7813d62b8ecf4c1991c806f44352a7daV.png)

- System API



  - [GET/POST\\
    \\
    GenerateAccessToken](https://open.lazada.com/apps/doc/api?path=%2Fauth%2Ftoken%2Fcreate)

  - [GET/POST\\
    \\
    GenerateAccessTokenWithOpenId](https://open.lazada.com/apps/doc/api?path=%2Fauth%2Ftoken%2FcreateWithOpenId)

  - [GET/POST\\
    \\
    RefreshAccessToken](https://open.lazada.com/apps/doc/api?path=%2Fauth%2Ftoken%2Frefresh)

  - [GET/POST\\
    \\
    startExportByDataset](https://open.lazada.com/apps/doc/api?path=%2Ffbi%2Fdownload%2FstartExportByDataset)
- Seller API

- Product API

- Cross Boarder Product API

- Product Review API

- Store Decoration API

- Media Center API

- Flexicombo API

- Seller Voucher API

- Free Shipping API

- Early Bird Price API

- Order API

- Return and Refund API

- Fulfillment API

- Logistics API

- FirstMile Bigbag(only for CN)

- Finance API

- Membership API

- FBL API

- Instant Messaging API

- Lazada Logistics API

- E-Tickets API

- LazPay API

- Lazada Wallet Corporate Top-up API

- RedMart API

- Lazada DG API

- Sponsored Solutions API

- Service Market API

- Choice Customized API

- LazLike API

- LazLive API

- Logistics Station API

- LazCredit Risk API

- Content API

- Store Flash Sale API


Latest update2022-07-28 16:53:43

40976

RefreshAccessToken

GET/POST

/auth/token/refresh

No Authorization Required

Description:refresh access\_token, the endpoint is https://auth.lazada.com/rest

## Service Endpoints

| Region | Endpoint |
| --- | --- |
| All | https://auth.lazada.com/rest |

Did this chapter help you?

YesNo

## Common Parameters

| Name | Type | Required or not | Description |
| --- | --- | --- | --- |
| app\_key | String | Yes | Unique app ID issued by LAZADA Open Platform console when you apply for an app category |
| timestamp | String | Yes | The time stamp of the request e.g. 1517820392000 (which translates to 5 February 2018 08:46:32) with less than 7200s difference from UTC time |
| access\_token | String | No | API interface call credentials |
| sign\_method | String | Yes | The HMAC hash algorithm you are using to calculate your signature |
| sign | String | Yes | Part of the authentication process that is used for identifying and verifying who is sending a request (click [here](https://open.lazada.com/apps/doc/doc?nodeId=10450&docId=108068) for details) |

Did this chapter help you?

YesNo

## Parameters

| Name | Type | Required or not | Description |
| --- | --- | --- | --- |
| refresh\_token | String | Yes | refresh\_token |

Did this chapter help you?

YesNo

## Response Parameters

| Name | Type | Description |
| --- | --- | --- |
| expires\_in | Number | The expiring time of the access token, in seconds |
| account\_id | String | Account ID，Allow null. if(account\_platform=seller\_center) account\_id=null |
| country | String | The country ID (sg:Singapore, my:Malaysia, ph:Philippines, th:Thailand, id:Indonesia, vn:Vietnam) |
| country\_user\_info\_list | Object\[\] | Country user details |
| country | String | The country ID (sg:Singapore, my:Malaysia, ph:Philippines, th:Thailand, id:Indonesia, vn:Vietnam) |
| seller\_id | String | Seller ID |
| user\_id | String | User ID |
| short\_code | String | The short code that is assigned to each seller ID by Lazada Seller Center |
| account\_platform | String | Account platform |
| access\_token | String | Access token |
| account | String | User account(login user) |
| refresh\_expires\_in | Number | The expiring time of th refresh token |
| refresh\_token | String | Refresh token, used to refresh the token when “refresh\_expires\_in”>0. |

Did this chapter help you?

YesNo

## Error Code

| Error Code | Error Message | Solution |
| --- | --- | --- |
| IllegalRefreshToken | "The specified refresh token is invalid or expired" | "The specified refresh token is invalid or expired" |
| AUTH\_TYPE\_UNSUPPORTED | XXX can only be authorized by market, not support refresh | The APP has been uploaded to the service market and the validity period of the access token has been bound to the service market order, no need to refresh. |
| IllegalRefreshToken | The specified refresh token is invalid or expired | Please have your seller re-login for authorization. |
| AUTH\_TYPE\_UNSUPPORTED | XXX can only be authorized by market, not support refresh | The APP has been uploaded to the service market and the validity period of the access token has been bound to the service market order, no need to refresh. |
| IllegalRefreshToken | The specified refresh token is invalid or expired | Please have your seller re-login for authorization. |
| AUTH\_TYPE\_UNSUPPORTED | XXX can only be authorized by market, not support refresh | The APP has been uploaded to the service market and the validity period of the access token has been bound to the service market order, no need to refresh. |
| IllegalRefreshToken | The specified refresh token is invalid or expired | Please have your seller re-login for authorization. |
| IllegalRefreshToken | The specified refresh token is invalid or expired | Please have your seller re-login for authorization. |
| AUTH\_TYPE\_UNSUPPORTED | appkey can only be authorized by market, not support refresh | The APP has been uploaded to the service market and the validity period of the access token has been bound to the service market order, no need to refresh. |

Did this chapter help you?

YesNo

[API Testing Tool](https://isvconsole.lazada.com/apps/console/test_api#/auth/token/refresh) [SDK Download](https://isvconsole.lazada.com/apps/console/sdk_download)

GET/POST

/auth/token/refresh

- JAVA

- PHP

- .NET

- RUBY

- PYTHON

- CURL


```java
LazopClient client = new LazopClient(url, appkey, appSecret);
LazopRequest request = new LazopRequest();
request.setApiName("/auth/token/refresh");
request.addApiParameter("refresh_token", "50001600212wcwiOabwyjtEH11acc19aBOvQr9ZYkYDlr987D8BB88LIB8bj");
LazopResponse response = client.execute(request);
System.out.println(response.getBody());
Thread.sleep(10);
```

Response

* * *

```json
{
  "access_token": "50000601c30atpedfgu3LVvik87Ixlsvle3mSoB7701ceb156fPunYZ43GBg",
  "country": "sg",
  "refresh_token": "500016000300bwa2WteaQyfwBMnPxurcA0mXGhQdTt18356663CfcDTYpWoi",
  "account_id": "7063844",
  "code": "0",
  "country_user_info_list": [\
    {\
      "country": "sg",\
      "user_id": "10101",\
      "seller_id": "1001",\
      "short_code": "SG001"\
    }\
  ],
  "account_platform": "seller_center",
  "refresh_expires_in": "60",
  "expires_in": "10",
  "request_id": "0ba2887315178178017221014",
  "account": "xxx@126.com"
}
```

Please rate this article

Popular Articles

Lazada 2022. All rights reserved.

Emogine cross origin localstorage hub




SUCCESS