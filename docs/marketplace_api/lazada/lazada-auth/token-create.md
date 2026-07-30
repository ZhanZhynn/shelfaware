- ···

  - App Console

[Announcement](https://open.lazada.com/apps/announcement/index) [Community](https://open.lazada.com/apps/community/index)   - Documentation

[Contact Us](https://open.lazada.com/?newTab=true)  - ···


- [Sign in](https://open.lazada.com/apps/user/login?redirectURL=https%3A%2F%2Fopen.lazada.com%2Fapps%2Fdoc%2Fapi%3Fpath%3D%252Fauth%252Ftoken%252Fcreate) [Sign up](https://open.lazada.com/apps/user/register)


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


Latest update2026-06-14 18:30:46

500

GenerateAccessToken

GET/POST

/auth/token/create

No Authorization Required

Description:generate access\_token for call api

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
| code | String | Yes | oauth code, get from app callback URL |
| uuid | String | No | This field is currently invalid, do not use this field please |

Did this chapter help you?

YesNo

## Response Parameters

| Name | Type | Description |
| --- | --- | --- |
| expires\_in | Number | The expiring time of the access token, in seconds |
| account\_id | String | Account ID，Allow null. if(account\_platform=seller\_center) account\_id=null |
| country | String | The country ID (sg:Singapore, my:Malaysia, ph:Philippines, th:Thailand, id:Indonesia, vn:Vietnam) |
| country\_user\_info | Object\[\] | Country user details |
| country | String | The country ID,(sg:Singapore, my:Malaysia, ph:Philippines, th:Thailand, id:Indonesia, vn:Vietnam) |
| seller\_id | String | Seller Id |
| user\_id | String | User Id |
| short\_code | String | Seller short code |
| account\_platform | String | Account platform |
| access\_token | String | Access token |
| account | String | User account(login user) |
| refresh\_expires\_in | String | The expiring time of th refresh token |
| refresh\_token | String | Refresh token, used to refresh the token when “refresh\_expires\_in”>0. |

Did this chapter help you?

YesNo

## Error Code

| Error Code | Error Message | Solution |
| --- | --- | --- |
| MissingParameter | the input parameter “sign” that is mandatory for processing this request is not supplied | 1 |
| IncompleteSignature | The request signature does not conform to lazop standards | 1 |
| InvalidCode | Invalid authorization code | Possible causes, incorrect authorisation url; authorisation code more than half an hour old |
| InvalidCode | Invalid authorization code | 1、please check if your Code is from the callback URL;2、Please check if your Code has already been used, each Code can only be used once;3、Code is valid for 30 minutes, it will expire after 30 minutes;4、Please check whether you are using the endpoints required by the API documentation;5、Please check whether the client id and the appkey of the request are the same when authorizing. |

Did this chapter help you?

YesNo

[API Testing Tool](https://isvconsole.lazada.com/apps/console/test_api#/auth/token/create) [SDK Download](https://isvconsole.lazada.com/apps/console/sdk_download)

GET/POST

/auth/token/create

- JAVA

- PHP

- .NET

- RUBY

- PYTHON

- CURL


```java
LazopClient client = new LazopClient(url, appkey, appSecret);
LazopRequest request = new LazopRequest();
request.setApiName("/auth/token/create");
request.addApiParameter("code", "0_100132_2DL4DV3jcU1UOT7WGI1A4rY91");
request.addApiParameter("uuid", "This field is currently invalid,  do not use this field please");
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
  "account_platform": "seller_center",
  "refresh_expires_in": "60",
  "country_user_info": [\
    {\
      "country": "SG",\
      "user_id": "1001",\
      "seller_id": "1001",\
      "short_code": "SG1001"\
    }\
  ],
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