- ···

  - App Console

[Announcement](https://open.lazada.com/apps/announcement/index) [Community](https://open.lazada.com/apps/community/index)   - Documentation

[Contact Us](https://open.lazada.com/?newTab=true)  - ···


- [Sign in](https://open.lazada.com/apps/user/login?redirectURL=https%3A%2F%2Fopen.lazada.com%2Fapps%2Fdoc%2Fapi%3Fpath%3D%252Freverse%252Fgetreverseordersforseller) [Sign up](https://open.lazada.com/apps/user/register)


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


Latest update2022-07-28 17:13:33

19765

GetReverseOrdersForSeller

GET/POST

/reverse/getreverseordersforseller

Authorization Required

Description:Use this API to get the list of items for a range of reverse orders.

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
| request\_type\_list | String\[\] | No | request type |
| ofc\_status\_list | String\[\] | No | Limit the ofc status |
| reverse\_order\_id | Number | No | Specify reverse order id |
| trade\_order\_id | Number | No | Specify trade order id |
| page\_size | Number | Yes | Page size, default 10 |
| reverse\_status\_list | String\[\] | No | Limit the reverse status. |
| page\_no | Number | Yes | Page no |
| return\_to\_type | String | No | Return Type. Enum Values：\[RTM, RTW\]（ RTW: return to the lazada warehouse; RTM: return to the seller） |
| dispute\_in\_progress | Boolean | No | Is dispute in progress |
| TradeOrderLineCreatedTimeRangeStart | Number | No | timestamp in Milliseconds |
| TradeOrderLineCreatedTimeRangeEnd | Number | No | timestamp in Milliseconds |
| ReverseOrderLineTimeRangeStart | Number | No | timestamp in Milliseconds |
| ReverseOrderLineTimeRangeEnd | Number | No | timestamp in Milliseconds |
| ReverseOrderLineModifiedTimeRangeStart | Number | No | timestamp in Milliseconds |
| ReverseOrderLineModifiedTimeRangeEnd | Number | No | timestamp in Milliseconds |
| QC\_Decision | String | No | warehouse qc decision, select one from the following: scrap/return\_to\_merchant/return\_to\_merchant\_cb/return\_to\_customer/return\_to\_warehouse/not\_returned |

Did this chapter help you?

YesNo

## Response Parameters

| Name | Type | Description |
| --- | --- | --- |
| result | Object | Response body |
| page\_no | Number | Page no |
| success | Boolean | Result |
| page\_size | Number | Page size |
| total | Number | The total number of data |
| items | Object\[\] | Data list |
| reverse\_order\_id | Number | Reverse order id |
| trade\_order\_id | Number | Trade order id |
| request\_type | String | The order applied by the buyer is: CANCEL; RETURN; ONLY\_ REFUND |
| is\_rtm | Boolean | rtm:true, rtw:false |
| shipping\_type | String | Shipping type |
| reverse\_order\_lines | Object\[\] | Reverse order lines list |
| ofc\_status | String | Ofc status |
| product | Object | Product Object |
| product\_id | Number | Product id |
| product\_sku | String | Product sku |
| buyer | Object | Buyer Object |
| buyer\_id | Number | Buyer id |
| trade\_order\_gmt\_create | Number | trade order create time |
| refund\_amount | Number | refund amount, currency in cent, except VN (for example for SG, 100 equals SGD $1; for VN, 10000 equals VND 10000) |
| reason\_text | String | reverse reason |
| reason\_code | Number | reverse reason code |
| refund\_payment\_method | String | payment method |
| whqc\_decision | String | warehouse decision |
| return\_order\_line\_gmt\_create | Number | reverse order line create time |
| return\_order\_line\_gmt\_modified | Number | reverse order line modified time |
| is\_dispute | Boolean | is in dispute or not |
| seller\_sku\_id | String | seller sku id |
| item\_unit\_price | Number | price, currency in cent, except VN (for example for SG, 100 equals SGD $1; for VN, 10000 equals VND 10000) |
| platform\_sku\_id | String | platform sku id |
| tracking\_number | String | tracking number of return order package |
| receiver\_address | String | receiver address, normally refers to seller address or warehouse address. Not available when customer self-arrange. |
| sla | Number | seller operation sla in milliseconds |
| reverse\_order\_line\_id | Number | Reverse order line id |
| trade\_order\_line\_id | Number | Trade order line id |
| reverse\_status | String | Reverse order status |
| is\_need\_refund | String | Is need refund |

Did this chapter help you?

YesNo

## Error Code

| Error Code | Error Message | Solution |
| --- | --- | --- |
| Mp3SellerApiLimit | Mp3 Seller not support the api - apipath | MP3 sellers cannot call the current API, please readthis document for a list of APIs that can be called by MP3 sellers, and you can call the GetSeller API and check the marketplaceEaseMode field to confirm that the current seller is of type MP3. |

Did this chapter help you?

YesNo

[API Testing Tool](https://isvconsole.lazada.com/apps/console/test_api#/reverse/getreverseordersforseller) [SDK Download](https://isvconsole.lazada.com/apps/console/sdk_download)

GET/POST

/reverse/getreverseordersforseller

- JAVA

- PHP

- .NET

- RUBY

- PYTHON

- CURL


```java
LazopClient client = new LazopClient(url, appkey, appSecret);
LazopRequest request = new LazopRequest();
request.setApiName("/reverse/getreverseordersforseller");
request.addApiParameter("request_type_list", "[\"ONLY_REFUND\"]");
request.addApiParameter("ofc_status_list", "[\"RETURN_CANCELED\"]");
request.addApiParameter("reverse_order_id", "0");
request.addApiParameter("trade_order_id", "0");
request.addApiParameter("page_size", "10");
request.addApiParameter("reverse_status_list", "[\"REQUEST_INITIATE\"]");
request.addApiParameter("page_no", "1");
request.addApiParameter("return_to_type", "RTM");
request.addApiParameter("dispute_in_progress", "true");
request.addApiParameter("TradeOrderLineCreatedTimeRangeStart", "1662430200000");
request.addApiParameter("TradeOrderLineCreatedTimeRangeEnd", "1662430296000");
request.addApiParameter("ReverseOrderLineTimeRangeStart", "1662430270000");
request.addApiParameter("ReverseOrderLineTimeRangeEnd", "1662430296000");
request.addApiParameter("ReverseOrderLineModifiedTimeRangeStart", "1633830696000");
request.addApiParameter("ReverseOrderLineModifiedTimeRangeEnd", "1665366696000");
request.addApiParameter("QC_Decision", "scrap");
LazopResponse response = client.execute(request, accessToken);
System.out.println(response.getBody());
Thread.sleep(10);
```

Response

* * *

```json
{
  "result": {
    "total": "50",
    "success": "true",
    "page_no": "1",
    "items": [\
      {\
        "reverse_order_lines": [\
          {\
            "product": {\
              "product_sku": "0",\
              "product_id": "0"\
            },\
            "return_order_line_gmt_create": "0",\
            "platform_sku_id": "th-1001",\
            "trade_order_gmt_create": "0",\
            "is_need_refund": "true",\
            "reason_text": "Out of stock",\
            "item_unit_price": "0",\
            "sla": "1741672453926",\
            "return_order_line_gmt_modified": "0",\
            "trade_order_line_id": "0",\
            "ofc_status": "RETURN_CANCELED",\
            "seller_sku_id": "th-1000",\
            "refund_payment_method": "Alipay",\
            "buyer": {\
              "buyer_id": "0"\
            },\
            "reason_code": "123",\
            "whqc_decision": "scrap",\
            "reverse_status": "REQUEST_INITIATE",\
            "refund_amount": "0",\
            "tracking_number": "TH2404B29P6D",\
            "receiver_address": "62/4, Lazada Express Co., Ltd, Moo 5, Bang Samak, Bang PaKong, Chachoengsao, 24130 ",\
            "is_dispute": "true",\
            "reverse_order_line_id": "0"\
          }\
        ],\
        "reverse_order_id": "0",\
        "request_type": "CANCEL",\
        "is_rtm": "true",\
        "shipping_type": "DEFAULT",\
        "trade_order_id": "0"\
      }\
    ],
    "page_size": "10"
  },
  "code": "0",
  "request_id": "0ba2887315178178017221014"
}
```

Please rate this article

Popular Articles

Lazada 2022. All rights reserved.

Emogine cross origin localstorage hub




SUCCESS