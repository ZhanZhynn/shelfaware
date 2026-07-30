- ···

  - App Console

[Announcement](https://open.lazada.com/apps/announcement/index) [Community](https://open.lazada.com/apps/community/index)   - Documentation

[Contact Us](https://open.lazada.com/?newTab=true)  - ···


- [Sign in](https://open.lazada.com/apps/user/login?redirectURL=https%3A%2F%2Fopen.lazada.com%2Fapps%2Fdoc%2Fapi%3Fpath%3D%252Forder%252Freverse%252Fcancel%252Fseller%252Fdecide) [Sign up](https://open.lazada.com/apps/user/register)


AI Assistant![](https://ae-pic-a1.aliexpress-media.com/kf/S00d31076895a492997d996fd48b505505.gif)![](https://ae-pic-a1.aliexpress-media.com/kf/S1df43fd5905043cdaafec6c8bdeb090c5.gif)![](https://ae-pic-a1.aliexpress-media.com/kf/S7813d62b8ecf4c1991c806f44352a7daV.png)

- System API

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



  - [GET\\
    \\
    GetReverseOrderDetail](https://open.lazada.com/apps/doc/api?path=%2Forder%2Freverse%2Freturn%2Fdetail%2Flist)

  - [GET\\
    \\
    GetReverseOrderHistoryList](https://open.lazada.com/apps/doc/api?path=%2Forder%2Freverse%2Freturn%2Fhistory%2Flist)

  - [GET\\
    \\
    GetReverseOrderReasonList](https://open.lazada.com/apps/doc/api?path=%2Forder%2Freverse%2Freason%2Flist)

  - [GET/POST\\
    \\
    GetReverseOrdersForSeller](https://open.lazada.com/apps/doc/api?path=%2Freverse%2Fgetreverseordersforseller)

  - [GET\\
    \\
    InitReverseOrderCancel](https://open.lazada.com/apps/doc/api?path=%2Forder%2Freverse%2Fcancel%2Fcreate)

  - [GET\\
    \\
    InitReverseOrderCancelDecide](https://open.lazada.com/apps/doc/api?path=%2Forder%2Freverse%2Fcancel%2Fseller%2Fdecide)

  - [GET\\
    \\
    ReverseOrderOnlyRefundDecide](https://open.lazada.com/apps/doc/api?path=%2Forder%2Freverse%2Fonlyrefund%2Fseller%2Fdecide)

  - [GET\\
    \\
    ReverseOrderReturnUpdate](https://open.lazada.com/apps/doc/api?path=%2Forder%2Freverse%2Freturn%2Fupdate)
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


Latest update2022-07-28 17:13:46

7329

InitReverseOrderCancelDecide

GET

/order/reverse/cancel/seller/decide

Authorization Required

Description:Seller initiates a cancelation

## Service Endpoints

| Region | Endpoint |
| --- | --- |
| Vietnam | https://api.lazada.vn/rest |
| Singapore | https://api.lazada.sg/rest |
| Philippines | https://api.lazada.com.ph/rest |
| Malaysia | https://api.lazada.com.my/rest |
| Thailand | https://api.lazada.co.th/rest |
| Indonesia | https://api.lazada.co.id/rest |

Did this chapter help you?

YesNo

## Common Parameters

| Name | Type | Required or not | Description |
| --- | --- | --- | --- |
| app\_key | String | Yes | Unique app ID issued by LAZADA Open Platform console when you apply for an app category |
| timestamp | String | Yes | The time stamp of the request e.g. 1517820392000 (which translates to 5 February 2018 08:46:32) with less than 7200s difference from UTC time |
| access\_token | String | Yes | API interface call credentials |
| sign\_method | String | Yes | The HMAC hash algorithm you are using to calculate your signature |
| sign | String | Yes | Part of the authentication process that is used for identifying and verifying who is sending a request (click [here](https://open.lazada.com/apps/doc/doc?nodeId=10450&docId=108068) for details) |

Did this chapter help you?

YesNo

## Parameters

| Name | Type | Required or not | Description |
| --- | --- | --- | --- |
| reverse\_order\_id | Number | Yes | The reverse order to be cancelled |
| agree\_cancel | Boolean | Yes | decision |
| reason\_code | Number | No | reason id |

Did this chapter help you?

YesNo

## Response Parameters

| Name | Type | Description |
| --- | --- | --- |
| data | Object | null |

Did this chapter help you?

YesNo

## Error Code

| Error Code | Error Message | Solution |
| --- | --- | --- |
| 116 | E0116: no seller id | E0116: no seller id |
| 105 | E0105: reverse order id is empty or invalid | E0105: reverse order id is empty or invalid |
| 131 | E0131: no decision for this reverse order | E0131: no decision for this reverse order |
| 106 | E0106: ROC internal error | E0106: ROC internal error |

Did this chapter help you?

YesNo

[API Testing Tool](https://isvconsole.lazada.com/apps/console/test_api#/order/reverse/cancel/seller/decide) [SDK Download](https://isvconsole.lazada.com/apps/console/sdk_download)

GET

/order/reverse/cancel/seller/decide

- JAVA

- PHP

- .NET

- RUBY

- PYTHON

- CURL


```java
LazopClient client = new LazopClient(url, appkey, appSecret);
LazopRequest request = new LazopRequest();
request.setApiName("/order/reverse/cancel/seller/decide");
request.setHttpMethod("GET");
request.addApiParameter("reverse_order_id", "1234567890");
request.addApiParameter("agree_cancel", "false");
request.addApiParameter("reason_code", "0");
LazopResponse response = client.execute(request, accessToken);
System.out.println(response.getBody());
Thread.sleep(10);
```

Response

* * *

```json
{
  "code": "0",
  "request_id": "0ba2887315178178017221014"
}
```

Please rate this article

Popular Articles

Lazada 2022. All rights reserved.

Emogine cross origin localstorage hub




SUCCESS