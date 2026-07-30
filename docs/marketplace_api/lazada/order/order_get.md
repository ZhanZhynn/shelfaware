- ···

  - App Console

[Announcement](https://open.lazada.com/apps/announcement/index) [Community](https://open.lazada.com/apps/community/index)   - Documentation

[Contact Us](https://open.lazada.com/?newTab=true)  - ···


- [Sign in](https://open.lazada.com/apps/user/login?redirectURL=https%3A%2F%2Fopen.lazada.com%2Fapps%2Fdoc%2Fapi%3Fpath%3D%252Forder%252Fget) [Sign up](https://open.lazada.com/apps/user/register)


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


Latest update2022-07-25 14:52:57

102310

GetOrder

GET

/order/get

Authorization Required

Description:Use this API to get the list of items for a single order.

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
| order\_id | Number | Yes | The identifier that was assigned to the order by the Seller Center |

Did this chapter help you?

YesNo

## Response Parameters

| Name | Type | Description |
| --- | --- | --- |
| data | Object | Response body |
| address\_shipping | Object | Node that contains additional nodes, which makes up the shipping address: FirstName, LastName, Phone, Phone2, Address1, Address2, City, PostCode, and Country. |
| address5 | String | Third-level address |
| post\_code | String | Post code; Note: This value will not be used in Lazada ID |
| address4 | String | City name |
| last\_name | String | Customer last name |
| country | String | Country |
| address3 | String | State name |
| address2 | String | Not used for now |
| city | String | City name |
| address1 | String | Detailed address |
| phone2 | String | Backup phone number |
| first\_name | String | Customer first name |
| phone | String | Phone number |
| addressDistrict | String | District |
| customer\_last\_name | String | Customer last name |
| gift\_option | Boolean | 1 if item is a gift, and 0 if it is not. |
| voucher\_code | String | Voucher code |
| updated\_at | String | Date and time of the last change to the order. |
| delivery\_info | String | Order delivery information. |
| gift\_message | String | Gift message as specified by the customer |
| branch\_number | String | (For Thailand only) The tax branch code for corporate customers, provided by the customer when placing the order. |
| tax\_code | String | (For Thailand and Vietnam only) The customer's VAT tax code, provided by the customer when placing the order. |
| extra\_attributes | String | Extra attributes which were passed to the Seller Center on getMarketPlaceOrders call. |
| shipping\_fee | String | Shipping fee |
| customer\_first\_name | String | Customer first name |
| payment\_method | String | The method of payment. |
| statuses | String\[\] | Unique status of the items in the order |
| remarks | String | A human-readable remark |
| order\_number | Number | The order number |
| order\_id | Number | Identifier of this order as assigned by the Seller Center |
| voucher | String | Voucher amount |
| national\_registration\_number | String | Required in some countries |
| promised\_shipping\_times | String | Promised shipping time |
| items\_count | Number | Number of items in the order |
| created\_at | String | Date and time when the order was placed |
| price | String | Total amount for this order |
| address\_billing | Object | Node that contains additional nodes, which makes up the shipping address: FirstName, LastName, Phone, Phone2, Address1, Address2, City, PostCode, and Country |
| address3 | String | State name |
| address2 | String | Not used for now |
| city | String | City name |
| address1 | String | Detailed address |
| phone2 | String | Backup phone number |
| first\_name | String | Customer first name |
| phone | String | Phone number |
| address5 | String | Third-level address |
| post\_code | String | Post code; Note: This value will not be used in Lazada ID |
| address4 | String | City name |
| last\_name | String | Customer last name |
| country | String | Country |
| addressDistrict | String | District |
| warehouse\_code | String | Warehouse Code of multi-wh sellers |
| shipping\_fee\_original | String | shipping fee original |
| shipping\_fee\_discount\_seller | String | shipping fee discount from seller |
| shipping\_fee\_discount\_platform | String | shipping fee discount from platform |
| buyer\_note | String | buyer note |
| recipient\_info | Object | Information filled in by the buyer when placing an order |
| passport\_no | String | passport number |
| identify\_no | String | identify card number |
| detail\_address | String | recipient address |
| need\_cancel\_confirm | Boolean | true: seller needs to respond to the cancellation request from buyer |
| is\_cancel\_pending | Boolean | true: seller agrees the cancellation request, waiting for logistic system |

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

[API Testing Tool](https://isvconsole.lazada.com/apps/console/test_api#/order/get) [SDK Download](https://isvconsole.lazada.com/apps/console/sdk_download)

GET

/order/get

- JAVA

- PHP

- .NET

- RUBY

- PYTHON

- CURL


```java
LazopClient client = new LazopClient(url, appkey, appSecret);
LazopRequest request = new LazopRequest();
request.setApiName("/order/get");
request.setHttpMethod("GET");
request.addApiParameter("order_id", "16090");
LazopResponse response = client.execute(request, accessToken);
System.out.println(response.getBody());
Thread.sleep(10);
```

Response

* * *

```json
{
  "code": "0",
  "data": {
    "voucher": "0.00",
    "warehouse_code": "dropshipping",
    "order_number": "300034416",
    "created_at": "2014-10-15 18:36:05 +0800",
    "voucher_code": "3432",
    "gift_option": "0",
    "is_cancel_pending": "true",
    "shipping_fee_discount_platform": "0.00",
    "customer_last_name": "last_name",
    "updated_at": "2014-10-15 18:36:05 +0800",
    "promised_shipping_times": "2017-03-24 16:09:22",
    "price": "99.00",
    "national_registration_number": "1123",
    "shipping_fee_original": "0.00",
    "payment_method": "COD",
    "recipient_info": {
      "identify_no": "012345679",
      "detail_address": "318 tanglin road, phoenix park, #01-59",
      "passport_no": "012345678"
    },
    "buyer_note": "red color",
    "customer_first_name": "First Name",
    "shipping_fee_discount_seller": "0.00",
    "shipping_fee": "0.00",
    "branch_number": "2222",
    "tax_code": "1234",
    "items_count": "1",
    "delivery_info": "1",
    "statuses": [],
    "address_billing": {
      "country": "Singapore",
      "address3": "address3",
      "address2": "address2",
      "city": "Singapore-Central",
      "address1": "22 leonie hill road, #13-01",
      "phone2": "24***22",
      "last_name": "Last Name",
      "phone": "81***8",
      "post_code": "239195",
      "address5": "address5",
      "address4": "address4",
      "addressDistrict": "addressDistrict",
      "first_name": "First Name"
    },
    "extra_attributes": "{\"TaxInvoiceRequested\":\"true\"}",
    "order_id": "16090",
    "need_cancel_confirm": "true",
    "gift_message": "Gift",
    "remarks": "remarks",
    "address_shipping": {
      "country": "Singapore",
      "address3": "address3",
      "address2": "address2",
      "city": "Singapore-Central",
      "address1": "318 tanglin road, phoenix park, #01-59",
      "phone2": "1******2",
      "last_name": "Last Name",
      "phone": "94236248",
      "post_code": "247979",
      "address5": "1******2",
      "address4": "address4",
      "addressDistrict": "addressDistrict",
      "first_name": "First Name"
    }
  },
  "request_id": "0ba2887315178178017221014"
}
```

Please rate this article

Popular Articles

Lazada 2022. All rights reserved.

Emogine cross origin localstorage hub




SUCCESS