- ···

  - App Console

[Announcement](https://open.lazada.com/apps/announcement/index) [Community](https://open.lazada.com/apps/community/index)   - Documentation

[Contact Us](https://open.lazada.com/?newTab=true)  - ···


- [Sign in](https://open.lazada.com/apps/user/login?redirectURL=https%3A%2F%2Fopen.lazada.com%2Fapps%2Fdoc%2Fapi%3Fpath%3D%252Forder%252Fitems%252Fget) [Sign up](https://open.lazada.com/apps/user/register)


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



  - [GET\\
    \\
    GetDocument](https://open.lazada.com/apps/doc/api?path=%2Forder%2Fdocument%2Fget)

  - [GET\\
    \\
    GetMultipleOrderItems](https://open.lazada.com/apps/doc/api?path=%2Forders%2Fitems%2Fget)

  - [GET/POST\\
    \\
    GetOVOOrders](https://open.lazada.com/apps/doc/api?path=%2Forders%2Fovo%2Fget)

  - [GET\\
    \\
    GetOrder](https://open.lazada.com/apps/doc/api?path=%2Forder%2Fget)

  - [GET\\
    \\
    GetOrderItems](https://open.lazada.com/apps/doc/api?path=%2Forder%2Fitems%2Fget)

  - [GET\\
    \\
    GetOrders](https://open.lazada.com/apps/doc/api?path=%2Forders%2Fget)

  - [GET\\
    \\
    OrderCancelValidate](https://open.lazada.com/apps/doc/api?path=%2Forder%2Freverse%2Fcancel%2Fvalidate)

  - [POST\\
    \\
    SetInvoiceNumber](https://open.lazada.com/apps/doc/api?path=%2Forder%2Finvoice_number%2Fset)
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


Latest update2022-07-21 15:05:05

93888

GetOrderItems

GET

/order/items/get

Authorization Required

Description:Use this API to get the item information of an order.

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
| order\_id | Number | Yes | The identifier that was assigned to the order by the Seller Center. |

Did this chapter help you?

YesNo

## Response Parameters

| Name | Type | Description |
| --- | --- | --- |
| data | Object\[\] | Response body |
| pick\_up\_store\_info | Object | Pick-up Store infos |
| pick\_up\_store\_name | String | Pick-up Store's name |
| pick\_up\_store\_address | String | Pick-up Store's address |
| pick\_up\_store\_code | String | Pick-up Store's id |
| pick\_up\_store\_open\_hour | String\[\] | Pick-up Store's business hours |
| purchase\_order\_number | String | Returned when calling SetPackedByMarketPlace |
| name | String | Product name |
| product\_main\_image | String | Product main image URL |
| item\_price | String | Product price |
| tax\_amount | String | Tax amount |
| status | String | Status |
| cancel\_return\_initiator | String | Indicates who initiated the canceled or returned order. Possible values are cancellation-internal, cancellation-customer, cancellation-failed Delivery, cancellation-seller, return-customer, and refund-internal. |
| voucher\_platform | String | The voucher that is issued by Lazada |
| voucher\_seller | String | The voucher that is issued by the seller |
| order\_type | String | The type of order，maybe Normal, PreSale, Coupon, O2O or InStoreO2O |
| stage\_pay\_status | String | The payment status of Presale order at presale stage. The possible values are null, "unpaid" or "unpaid final payment". (unpaid: presale deposit has not been paid; unpaid final payment: presale deposit is paid but final payment / balance due is not paid) |
| warehouse\_code | String | Warehouse Code of multi-wh sellers |
| voucher\_seller\_lpi | String | The Lazada Bonus that is sponsored by the seller |
| voucher\_platform\_lpi | String | The Lazada Bonus that is sponsored by Lazada |
| buyer\_id | String | Buyer ID |
| shipping\_fee\_original | String | shipping fee original |
| shipping\_fee\_discount\_seller | String | shipping fee discount from seller |
| shipping\_fee\_discount\_platform | String | shipping fee discount from platform |
| voucher\_code\_seller | String | voucher code from seller |
| voucher\_code\_platform | String | voucher code from platform |
| delivery\_option\_sof | String | The mark of whether is seller own fleet, values included 1 and 0. |
| is\_fbl | String | The mark of whether is fulfilled by LAZADA, values included 1 and 0. |
| is\_reroute | String | The mark of whether is secondary sale, values included 1 and 0. |
| reason | String | Cancel, Return or other reason, defined in the table sales\_order\_reason |
| digital\_delivery\_info | String | Digital deliery information |
| promised\_shipping\_time | String | Promised shipping time |
| order\_id | String | Order ID |
| voucher\_amount | String | Voucher amount |
| return\_status | String | Return status |
| shipping\_type | String | Shipping type, Drop-shipping or Warehouse |
| shipment\_provider | String | 3PL shipment provider, such as LEX |
| variation | String | Variation |
| created\_at | String | Time of the feed's creation in ISO 8601 format |
| invoice\_number | String | Invoice number |
| shipping\_amount | String | Shipping fee |
| currency | String | ISO 4217 compatible currency code |
| order\_flag | String | The type of order, Possible values are GUARANTEE, NORMAL and GLOBAL\_COLLECTION. Orders tagged with "GUARANTEE" or "GLOBAL\_COLLECTION" have shorter SLA requirement in order fulfillment. |
| shop\_id | String | Seller name |
| sla\_time\_stamp | String | Time of the ship SLA in ISO 8601 format(yyyy-MM-dd'T'HH:mm:ssXXX) |
| sku | String | Product SKU |
| voucher\_code | String | Not used |
| wallet\_credits | String | Wallet credit |
| updated\_at | String | Time of the feed's last update in ISO 8601 format |
| is\_digital | Number | Is digital goods or not |
| tracking\_code\_pre | String | Not used |
| order\_item\_id | Number | Order item ID |
| package\_id | String | Package source ID |
| tracking\_code | String | Tracking code retrieved from 3PL shipment provider |
| shipping\_service\_cost | Number | Shipping service cost |
| extra\_attributes | String | JSON encoded string with extra attributes |
| paid\_price | String | Paid price |
| shipping\_provider\_type | String | One of the following options: EXPRESS, STANDARD, ECONOMY, INSTANT, SELLER\_OWN\_FLEET, PICKUP\_IN\_STORE or DIGITAL |
| product\_detail\_url | String | Product detail URL |
| shop\_sku | String | Product outer ID |
| reason\_detail | String | Reason detail |
| purchase\_order\_id | String | Returned when calling SetPackedByMarketPlace |
| sku\_id | String | Sku ID |
| product\_id | String | Product ID |
| fulfillment\_sla | String | fulfillment sla info |
| priority\_fulfillment\_tag | String | priority fulfillment tag |
| gift\_wrapping | String | Custom display copywriting on the packaging |
| show\_giftwrapping\_tag | Boolean | Is the gift label visible |
| personalization | String | Engraving service, for engraving custom copywriting |
| show\_personalization\_tag | Boolean | Whether to reveal the engraved service mark |
| payment\_time | Number | Payment time in milliseconds local time |
| supply\_price | String | supply price for mp3 order |
| supply\_price\_currency | String | supply price currency for mp3 order |
| mp3\_order | Boolean | is mp3 order or not |
| semi\_managed | Boolean | is semiManaged order or not |
| biz\_group | Number | 70100 stands for MP, which means JIT merchants fulfill orders by themselves; 70020 indicates choice is warehouse dispatch, which is JIT PO stocking. |
| schedule\_delivery\_start\_timeslot | Number | schedule delivery start timeslot |
| schedule\_delivery\_end\_timeslot | Number | schedule delivery end timeslot |
| need\_cancel\_confirm | Boolean | true: seller needs to respond to the cancellation request from buyer |
| is\_cancel\_pending | Boolean | true: seller agrees the cancellation request, waiting for logistic system |
| cancel\_trigger\_time | Number | If the seller does not respond to cancellation request before this time, the order will auto canceled |
| reverse\_order\_id | Number | reverse order id (cancel order main id) |
| can\_escalate\_pickup | Boolean | can urge the logistics to pick up parcels |

Did this chapter help you?

YesNo

## Error Code

| Error Code | Error Message | Solution |
| --- | --- | --- |
| 16 | E016: "%s" Invalid Order ID | The specified order ID is not valid. |
| 6 | E006: System Error | System Error |
| 16 | Invalid Order ID | The order number in the request does not exist in the current store, please call GetOrders API to synchronize the order list first, or call GetSeller API to check if you are using the access token of the corresponding store. |
| 16 | Invalid Order ID | The order number in the request does not exist in the current store, please call GetOrders API to synchronize the order list first, or call GetSeller API to check if you are using the access token of the corresponding store. |
| 16 | Invalid Order ID | The order number in the request does not exist in the current store, please call GetOrders API to synchronize the order list first, or call GetSeller API to check if you are using the access token of the corresponding store. |

Did this chapter help you?

YesNo

[API Testing Tool](https://isvconsole.lazada.com/apps/console/test_api#/order/items/get) [SDK Download](https://isvconsole.lazada.com/apps/console/sdk_download)

GET

/order/items/get

- JAVA

- PHP

- .NET

- RUBY

- PYTHON

- CURL


```java
LazopClient client = new LazopClient(url, appkey, appSecret);
LazopRequest request = new LazopRequest();
request.setApiName("/order/items/get");
request.setHttpMethod("GET");
request.addApiParameter("order_id", "31202");
LazopResponse response = client.execute(request, accessToken);
System.out.println(response.getBody());
Thread.sleep(10);
```

Response

* * *

```json
{
  "code": "0",
  "data": [\
    {\
      "pick_up_store_info": {\
        "pick_up_store_address": "Ali Center, Shenzhen",\
        "pick_up_store_name": "Alibaba",\
        "pick_up_store_open_hour": [\
          "Sunday 9:00-18:00",\
          "Mondday,Tuesday,Wendnesday,Thursday,Friday 8:00-20:00"\
        ],\
        "pick_up_store_code": "d4b04804-9192-4a8c-8ed1-5ebcd7d3c067"\
      },\
      "tax_amount": "6.48",\
      "reason": "reason",\
      "sla_time_stamp": "2019-06-24T23:59:59+08:00",\
      "show_giftwrapping_tag": "True",\
      "voucher_seller": "0.00",\
      "purchase_order_id": "3454",\
      "payment_time": "1697193374592",\
      "voucher_code_seller": "X234",\
      "voucher_code": "X3453",\
      "package_id": "345",\
      "buyer_id": "1001",\
      "variation": "1",\
      "is_cancel_pending": "true",\
      "biz_group": "70100",\
      "product_id": "12345",\
      "voucher_code_platform": "Y123",\
      "purchase_order_number": "345345",\
      "sku": "BRSD#02",\
      "gift_wrapping": "Happy birthday",\
      "schedule_delivery_start_timeslot": "1719108000000",\
      "order_type": "Normal",\
      "invoice_number": "1342",\
      "show_personalization_tag": "True",\
      "can_escalate_pickup": "true",\
      "cancel_trigger_time": "1754381842018",\
      "cancel_return_initiator": "cancellation-customer",\
      "shop_sku": "BE494HLAAUE3SGAMZ-39898",\
      "is_reroute": "0",\
      "stage_pay_status": "unpaid",\
      "sku_id": "666",\
      "tracking_code_pre": "23534",\
      "order_item_id": "98108",\
      "shop_id": "dawen dp",\
      "order_flag": "GUATANTEE",\
      "is_fbl": "0",\
      "name": "Bean Rester Dooby Red",\
      "delivery_option_sof": "0",\
      "order_id": "31202",\
      "fulfillment_sla": "NEXT_DAY",\
      "need_cancel_confirm": "true",\
      "status": "canceled",\
      "product_main_image": "http://th-live-02.slatic.net/p/3/jianyue-7699-09550735-ccd244666871f12a523c77d68cd76d74-catalog.jpg",\
      "voucher_platform": "0.00",\
      "paid_price": "99.00",\
      "product_detail_url": "http://www.lazada.co.th/535590.html",\
      "warehouse_code": "WH-01",\
      "promised_shipping_time": "2014-10-15 19:12:15 +0800",\
      "shipping_type": "Dropshipping",\
      "created_at": "2014-10-15 19:12:15 +0800",\
      "supply_price": "99.0",\
      "mp3_order": "True",\
      "voucher_seller_lpi": "0.00",\
      "shipping_fee_discount_platform": "0.00",\
      "personalization": "Happy birthday",\
      "wallet_credits": "0.00",\
      "reverse_order_id": "704947701379284",\
      "updated_at": "2014-10-15 19:12:15 +0800",\
      "currency": "SGD",\
      "shipping_provider_type": "standard",\
      "voucher_platform_lpi": "0.00",\
      "shipping_fee_original": "0.00",\
      "schedule_delivery_end_timeslot": "1719140400000",\
      "item_price": "99.00",\
      "is_digital": "0",\
      "shipping_service_cost": "0",\
      "tracking_code": "456",\
      "shipping_fee_discount_seller": "0.00",\
      "shipping_amount": "0.00",\
      "reason_detail": "reason detail",\
      "return_status": "1",\
      "semi_managed": "True",\
      "shipment_provider": "LEL",\
      "priority_fulfillment_tag": "Kirim secepat mungkin_null_null",\
      "voucher_amount": "0.00",\
      "supply_price_currency": "CNY",\
      "digital_delivery_info": "delivery",\
      "extra_attributes": "null"\
    }\
  ],
  "request_id": "0ba2887315178178017221014"
}
```

Please rate this article

Popular Articles

Lazada 2022. All rights reserved.

Emogine cross origin localstorage hub




SUCCESS